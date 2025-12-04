#![allow(dead_code)]

//! Audio streaming service
//! Manages the complete audio pipeline: capture -> encode -> transmit -> receive -> decode -> playback

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Host, SampleFormat, Stream, StreamConfig};
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

use super::denoise::SharedDenoiser;
use super::encoder::{OpusDecoder, OpusEncoder};
use super::{CHANNELS, SAMPLES_PER_FRAME, SAMPLE_RATE};

/// Audio packet ready for network transmission
#[derive(Clone, Debug, Serialize)]
pub struct AudioPacket {
    /// Opus-encoded audio data
    pub data: Vec<u8>,
    /// Timestamp in samples
    pub timestamp: u64,
}

/// Event payload for audio level updates
#[derive(Clone, Serialize)]
pub struct AudioLevelEvent {
    pub level: f32,
    pub is_speaking: bool,
    pub rms: f32,
}

/// Threshold for "speaking" detection
const SPEAKING_THRESHOLD: f32 = 0.02;

/// Per-peer playback state
struct PeerPlayback {
    decoder: OpusDecoder,
    samples_buffer: Vec<f32>,
    last_activity: std::time::Instant,
}

/// Complete audio streaming manager
pub struct AudioStreamingService {
    host: Host,

    // Capture state
    capture_stream: Arc<Mutex<Option<Stream>>>,
    is_capturing: Arc<AtomicBool>,
    is_muted: Arc<AtomicBool>,
    selected_input_device: Arc<Mutex<Option<String>>>,

    // Playback state
    playback_stream: Arc<Mutex<Option<Stream>>>,
    is_playing: Arc<AtomicBool>,
    selected_output_device: Arc<Mutex<Option<String>>>,

    // Audio processing
    denoiser: SharedDenoiser,
    encoder: Arc<Mutex<Option<OpusEncoder>>>,

    // Per-peer audio reception
    peer_playback: Arc<Mutex<HashMap<String, PeerPlayback>>>,

    // Mixed output samples ready for playback
    playback_buffer: Arc<Mutex<Vec<f32>>>,

    // Channel for encoded audio packets to send
    outgoing_audio_tx: Arc<Mutex<Option<mpsc::UnboundedSender<AudioPacket>>>>,
    outgoing_audio_rx: Arc<Mutex<Option<mpsc::UnboundedReceiver<AudioPacket>>>>,

    // Current audio level
    current_level: Arc<Mutex<f32>>,

    // App handle for events
    app_handle: Arc<Mutex<Option<AppHandle>>>,

    // Timestamp counter
    timestamp: Arc<Mutex<u64>>,
}

impl AudioStreamingService {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::unbounded_channel();

        Self {
            host: cpal::default_host(),
            capture_stream: Arc::new(Mutex::new(None)),
            is_capturing: Arc::new(AtomicBool::new(false)),
            is_muted: Arc::new(AtomicBool::new(true)),
            selected_input_device: Arc::new(Mutex::new(None)),
            playback_stream: Arc::new(Mutex::new(None)),
            is_playing: Arc::new(AtomicBool::new(false)),
            selected_output_device: Arc::new(Mutex::new(None)),
            denoiser: SharedDenoiser::new(),
            encoder: Arc::new(Mutex::new(None)),
            peer_playback: Arc::new(Mutex::new(HashMap::new())),
            playback_buffer: Arc::new(Mutex::new(Vec::with_capacity(SAMPLES_PER_FRAME * 10))),
            outgoing_audio_tx: Arc::new(Mutex::new(Some(tx))),
            outgoing_audio_rx: Arc::new(Mutex::new(Some(rx))),
            current_level: Arc::new(Mutex::new(0.0)),
            app_handle: Arc::new(Mutex::new(None)),
            timestamp: Arc::new(Mutex::new(0)),
        }
    }

    /// Set the app handle for emitting events
    pub fn set_app_handle(&self, app: AppHandle) {
        *self.app_handle.lock() = Some(app);
    }

    /// Enable or disable noise suppression
    pub fn set_noise_suppression(&self, enabled: bool) {
        self.denoiser.set_enabled(enabled);
        tracing::info!("Noise suppression: {}", if enabled { "enabled" } else { "disabled" });
    }

    /// Check if noise suppression is enabled
    pub fn is_noise_suppression_enabled(&self) -> bool {
        self.denoiser.is_enabled()
    }

    /// Set input device by name (None for default)
    pub fn set_input_device(&self, device_name: Option<String>) -> Result<(), String> {
        let was_capturing = self.is_capturing.load(Ordering::SeqCst);

        *self.selected_input_device.lock() = device_name;

        if was_capturing {
            self.stop_capture();
            std::thread::sleep(std::time::Duration::from_millis(100));
            self.start_capture()?;
        }

        Ok(())
    }

    /// Get selected input device
    pub fn get_input_device(&self) -> Option<String> {
        self.selected_input_device.lock().clone()
    }

    /// Set output device by name (None for default)
    pub fn set_output_device(&self, device_name: Option<String>) -> Result<(), String> {
        let was_playing = self.is_playing.load(Ordering::SeqCst);

        *self.selected_output_device.lock() = device_name;

        if was_playing {
            self.stop_playback();
            std::thread::sleep(std::time::Duration::from_millis(100));
            self.start_playback()?;
        }

        Ok(())
    }

    /// Get input device by name or default
    fn get_input_device_by_name(&self, name: Option<&str>) -> Result<cpal::Device, String> {
        match name {
            Some(device_name) => {
                let devices = self.host.input_devices()
                    .map_err(|e| format!("Failed to enumerate devices: {}", e))?;

                for device in devices {
                    if let Ok(n) = device.name() {
                        if n == device_name {
                            return Ok(device);
                        }
                    }
                }
                Err(format!("Device '{}' not found", device_name))
            }
            None => self.host
                .default_input_device()
                .ok_or_else(|| "No default input device".to_string()),
        }
    }

    /// Get output device by name or default
    fn get_output_device_by_name(&self, name: Option<&str>) -> Result<cpal::Device, String> {
        match name {
            Some(device_name) => {
                let devices = self.host.output_devices()
                    .map_err(|e| format!("Failed to enumerate devices: {}", e))?;

                for device in devices {
                    if let Ok(n) = device.name() {
                        if n == device_name {
                            return Ok(device);
                        }
                    }
                }
                Err(format!("Device '{}' not found", device_name))
            }
            None => self.host
                .default_output_device()
                .ok_or_else(|| "No default output device".to_string()),
        }
    }

    /// Start audio capture
    pub fn start_capture(&self) -> Result<(), String> {
        if self.is_capturing.load(Ordering::SeqCst) {
            return Ok(());
        }

        // Initialize encoder
        let encoder = OpusEncoder::new()?;
        *self.encoder.lock() = Some(encoder);

        let selected = self.selected_input_device.lock().clone();
        let device = self.get_input_device_by_name(selected.as_deref())?;

        let device_name = device.name().unwrap_or_default();
        tracing::info!("Starting audio capture on: {}", device_name);

        // Use native sample rate
        let supported_config = device
            .default_input_config()
            .map_err(|e| format!("Failed to get input config: {}", e))?;

        let config = supported_config.config();
        let sample_rate = config.sample_rate.0;
        let channels = config.channels as usize;

        // Configure denoiser
        self.denoiser.set_sample_rate(sample_rate);
        self.denoiser.reset();

        // Calculate samples per frame for this device
        let samples_per_frame = (sample_rate as usize * 20) / 1000; // 20ms

        // Clone all the shared state we need
        let is_muted = self.is_muted.clone();
        let current_level = self.current_level.clone();
        let app_handle = self.app_handle.clone();
        let denoiser = self.denoiser.clone();
        let encoder = self.encoder.clone();
        let outgoing_tx = self.outgoing_audio_tx.clone();
        let timestamp = self.timestamp.clone();

        // Buffer for accumulating samples
        let sample_buffer: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::with_capacity(samples_per_frame * 2)));

        // Resampling state if needed
        let needs_resampling = sample_rate != SAMPLE_RATE;
        let resample_ratio = SAMPLE_RATE as f64 / sample_rate as f64;

        let err_fn = |err| {
            tracing::error!("Audio capture error: {}", err);
        };

        let stream = match supported_config.sample_format() {
            SampleFormat::F32 => {
                device.build_input_stream(
                    &config,
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        process_capture(
                            data,
                            channels,
                            samples_per_frame,
                            needs_resampling,
                            resample_ratio,
                            &sample_buffer,
                            &is_muted,
                            &current_level,
                            &app_handle,
                            &denoiser,
                            &encoder,
                            &outgoing_tx,
                            &timestamp,
                        );
                    },
                    err_fn,
                    None,
                )
            }
            SampleFormat::I16 => {
                let sample_buffer = Arc::new(Mutex::new(Vec::with_capacity(samples_per_frame * 2)));
                let is_muted = self.is_muted.clone();
                let current_level = self.current_level.clone();
                let app_handle = self.app_handle.clone();
                let denoiser = self.denoiser.clone();
                let encoder = self.encoder.clone();
                let outgoing_tx = self.outgoing_audio_tx.clone();
                let timestamp = self.timestamp.clone();

                device.build_input_stream(
                    &config,
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        let float_data: Vec<f32> = data.iter()
                            .map(|&s| s as f32 / i16::MAX as f32)
                            .collect();
                        process_capture(
                            &float_data,
                            channels,
                            samples_per_frame,
                            needs_resampling,
                            resample_ratio,
                            &sample_buffer,
                            &is_muted,
                            &current_level,
                            &app_handle,
                            &denoiser,
                            &encoder,
                            &outgoing_tx,
                            &timestamp,
                        );
                    },
                    err_fn,
                    None,
                )
            }
            format => {
                return Err(format!("Unsupported sample format: {:?}", format));
            }
        }.map_err(|e| format!("Failed to build input stream: {}", e))?;

        stream.play().map_err(|e| format!("Failed to start capture: {}", e))?;

        *self.capture_stream.lock() = Some(stream);
        self.is_capturing.store(true, Ordering::SeqCst);

        tracing::info!("Audio capture started");
        Ok(())
    }

    /// Stop audio capture
    pub fn stop_capture(&self) {
        if !self.is_capturing.load(Ordering::SeqCst) {
            return;
        }

        *self.capture_stream.lock() = None;
        *self.encoder.lock() = None;
        self.is_capturing.store(false, Ordering::SeqCst);
        *self.current_level.lock() = 0.0;

        tracing::info!("Audio capture stopped");
    }

    /// Start audio playback
    pub fn start_playback(&self) -> Result<(), String> {
        if self.is_playing.load(Ordering::SeqCst) {
            return Ok(());
        }

        let selected = self.selected_output_device.lock().clone();
        let device = self.get_output_device_by_name(selected.as_deref())?;

        let device_name = device.name().unwrap_or_default();
        tracing::info!("Starting audio playback on: {}", device_name);

        let config = StreamConfig {
            channels: CHANNELS,
            sample_rate: cpal::SampleRate(SAMPLE_RATE),
            buffer_size: cpal::BufferSize::Fixed(SAMPLES_PER_FRAME as u32),
        };

        let playback_buffer = self.playback_buffer.clone();

        let stream = device.build_output_stream(
            &config,
            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                let mut buffer = playback_buffer.lock();

                for sample in data.iter_mut() {
                    *sample = buffer.pop().unwrap_or(0.0);
                }
            },
            |err| {
                tracing::error!("Audio playback error: {}", err);
            },
            None,
        ).map_err(|e| format!("Failed to build output stream: {}", e))?;

        stream.play().map_err(|e| format!("Failed to start playback: {}", e))?;

        *self.playback_stream.lock() = Some(stream);
        self.is_playing.store(true, Ordering::SeqCst);

        tracing::info!("Audio playback started");
        Ok(())
    }

    /// Stop audio playback
    pub fn stop_playback(&self) {
        if !self.is_playing.load(Ordering::SeqCst) {
            return;
        }

        *self.playback_stream.lock() = None;
        self.is_playing.store(false, Ordering::SeqCst);
        self.playback_buffer.lock().clear();

        tracing::info!("Audio playback stopped");
    }

    /// Set mute state
    pub fn set_muted(&self, muted: bool) {
        self.is_muted.store(muted, Ordering::SeqCst);
        if muted {
            *self.current_level.lock() = 0.0;
        }
        tracing::info!("Mute set to: {}", muted);
    }

    /// Get mute state
    pub fn is_muted(&self) -> bool {
        self.is_muted.load(Ordering::SeqCst)
    }

    /// Check if capturing
    pub fn is_capturing(&self) -> bool {
        self.is_capturing.load(Ordering::SeqCst)
    }

    /// Check if playing
    pub fn is_playing(&self) -> bool {
        self.is_playing.load(Ordering::SeqCst)
    }

    /// Get current audio level
    pub fn current_level(&self) -> f32 {
        *self.current_level.lock()
    }

    /// Get the next encoded audio packet (non-blocking)
    pub fn get_outgoing_packet(&self) -> Option<AudioPacket> {
        if let Some(rx) = self.outgoing_audio_rx.lock().as_mut() {
            rx.try_recv().ok()
        } else {
            None
        }
    }

    /// Receive audio from a peer
    pub fn receive_peer_audio(&self, peer_id: &str, opus_data: &[u8]) -> Result<(), String> {
        let mut peers = self.peer_playback.lock();

        // Create decoder for new peer
        let playback = peers.entry(peer_id.to_string()).or_insert_with(|| {
            PeerPlayback {
                decoder: OpusDecoder::new().expect("Failed to create decoder"),
                samples_buffer: Vec::with_capacity(SAMPLES_PER_FRAME * 4),
                last_activity: std::time::Instant::now(),
            }
        });

        playback.last_activity = std::time::Instant::now();

        // Decode the audio
        let samples = playback.decoder.decode(opus_data)?;
        playback.samples_buffer.extend_from_slice(&samples);

        // Mix into playback buffer
        // For now, just add samples directly (simple mixing)
        let mut output = self.playback_buffer.lock();
        for sample in samples {
            output.push(sample);
        }

        // Limit buffer size
        while output.len() > SAMPLES_PER_FRAME * 20 {
            output.remove(0);
        }

        Ok(())
    }

    /// Remove a peer
    pub fn remove_peer(&self, peer_id: &str) {
        self.peer_playback.lock().remove(peer_id);
    }

    /// Clear all peers
    pub fn clear_peers(&self) {
        self.peer_playback.lock().clear();
        self.playback_buffer.lock().clear();
    }

    /// List input devices
    pub fn list_input_devices(&self) -> Result<Vec<String>, String> {
        let devices = self.host.input_devices()
            .map_err(|e| format!("Failed to enumerate input devices: {}", e))?;

        Ok(devices.filter_map(|d| d.name().ok()).collect())
    }

    /// List output devices
    pub fn list_output_devices(&self) -> Result<Vec<String>, String> {
        let devices = self.host.output_devices()
            .map_err(|e| format!("Failed to enumerate output devices: {}", e))?;

        Ok(devices.filter_map(|d| d.name().ok()).collect())
    }
}

impl Default for AudioStreamingService {
    fn default() -> Self {
        Self::new()
    }
}

// Safety: All state is protected by Arc<Mutex> or atomic operations
unsafe impl Send for AudioStreamingService {}
unsafe impl Sync for AudioStreamingService {}

/// Process captured audio data
fn process_capture(
    data: &[f32],
    channels: usize,
    samples_per_frame: usize,
    needs_resampling: bool,
    resample_ratio: f64,
    sample_buffer: &Arc<Mutex<Vec<f32>>>,
    is_muted: &Arc<AtomicBool>,
    current_level: &Arc<Mutex<f32>>,
    app_handle: &Arc<Mutex<Option<AppHandle>>>,
    denoiser: &SharedDenoiser,
    encoder: &Arc<Mutex<Option<OpusEncoder>>>,
    outgoing_tx: &Arc<Mutex<Option<mpsc::UnboundedSender<AudioPacket>>>>,
    timestamp: &Arc<Mutex<u64>>,
) {
    let mut buffer = sample_buffer.lock();

    // Convert to mono
    if channels > 1 {
        for chunk in data.chunks(channels) {
            let mono: f32 = chunk.iter().sum::<f32>() / channels as f32;
            buffer.push(mono);
        }
    } else {
        buffer.extend_from_slice(data);
    }

    // Process complete frames
    while buffer.len() >= samples_per_frame {
        let samples: Vec<f32> = buffer.drain(..samples_per_frame).collect();

        // Resample to 48kHz if needed
        let samples_48k = if needs_resampling {
            resample(&samples, resample_ratio)
        } else {
            samples.clone()
        };

        // Apply noise reduction
        let processed = denoiser.process(&samples_48k);

        // Calculate level
        let rms = calculate_rms(&processed);
        let level = if is_muted.load(Ordering::SeqCst) {
            0.0
        } else {
            rms_to_level(rms)
        };

        *current_level.lock() = level;

        // Emit level event
        if let Some(app) = app_handle.lock().as_ref() {
            let event = AudioLevelEvent {
                level,
                is_speaking: !is_muted.load(Ordering::SeqCst) && rms > SPEAKING_THRESHOLD,
                rms,
            };
            let _ = app.emit("audio-level", event);
        }

        // Encode and queue for transmission if not muted
        if !is_muted.load(Ordering::SeqCst) {
            // Ensure we have exactly SAMPLES_PER_FRAME samples
            let to_encode = if processed.len() == SAMPLES_PER_FRAME {
                processed
            } else if processed.len() > SAMPLES_PER_FRAME {
                processed[..SAMPLES_PER_FRAME].to_vec()
            } else {
                // Pad with zeros
                let mut padded = processed;
                padded.resize(SAMPLES_PER_FRAME, 0.0);
                padded
            };

            if let Some(enc) = encoder.lock().as_mut() {
                match enc.encode(&to_encode) {
                    Ok(encoded) => {
                        let mut ts = timestamp.lock();
                        let packet = AudioPacket {
                            data: encoded,
                            timestamp: *ts,
                        };
                        *ts += SAMPLES_PER_FRAME as u64;

                        if let Some(tx) = outgoing_tx.lock().as_ref() {
                            let _ = tx.send(packet);
                        }
                    }
                    Err(e) => {
                        tracing::warn!("Failed to encode audio: {}", e);
                    }
                }
            }
        }
    }
}

/// Calculate RMS of samples
fn calculate_rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_squares: f32 = samples.iter().map(|s| s * s).sum();
    (sum_squares / samples.len() as f32).sqrt()
}

/// Convert RMS to normalized level
fn rms_to_level(rms: f32) -> f32 {
    let db = 20.0 * rms.max(1e-10).log10();
    let normalized = (db + 60.0) / 60.0;
    normalized.clamp(0.0, 1.0)
}

/// Simple linear resampling
fn resample(samples: &[f32], ratio: f64) -> Vec<f32> {
    let output_len = (samples.len() as f64 * ratio).ceil() as usize;
    let mut output = Vec::with_capacity(output_len);

    for i in 0..output_len {
        let src_idx = i as f64 / ratio;
        let idx_floor = src_idx.floor() as usize;
        let idx_ceil = (idx_floor + 1).min(samples.len().saturating_sub(1));
        let frac = src_idx - idx_floor as f64;

        let sample = if idx_floor < samples.len() {
            let s1 = samples[idx_floor];
            let s2 = samples.get(idx_ceil).copied().unwrap_or(s1);
            s1 + (s2 - s1) * frac as f32
        } else {
            0.0
        };

        output.push(sample);
    }

    output
}
