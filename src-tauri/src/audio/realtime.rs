//! Real-time audio capture with Tauri events
//! Captures microphone input and emits audio level events to the frontend

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Host, SampleFormat, Stream};
use parking_lot::Mutex;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

use super::denoise::SharedDenoiser;

/// Event payload for audio level updates
#[derive(Clone, Serialize)]
pub struct AudioLevelEvent {
    /// Audio level from 0.0 to 1.0
    pub level: f32,
    /// Whether the user is speaking (level > threshold)
    pub is_speaking: bool,
    /// Raw RMS value
    pub rms: f32,
}

/// Threshold for "speaking" detection
const SPEAKING_THRESHOLD: f32 = 0.02;

/// Minimum samples before processing (~20ms at 48kHz)
const MIN_SAMPLES_FOR_PROCESSING: usize = 960;

/// Calculate RMS (Root Mean Square) of audio samples
fn calculate_rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_squares: f32 = samples.iter().map(|s| s * s).sum();
    (sum_squares / samples.len() as f32).sqrt()
}

/// Convert RMS to normalized level (0.0 to 1.0)
fn rms_to_level(rms: f32) -> f32 {
    // Convert to dB scale and normalize
    // -60dB to 0dB range
    let db = 20.0 * rms.max(1e-10).log10();
    let normalized = (db + 60.0) / 60.0;
    normalized.clamp(0.0, 1.0)
}

/// Real-time audio capture manager
pub struct RealtimeCapture {
    host: Host,
    stream: Arc<Mutex<Option<Stream>>>,
    is_capturing: Arc<AtomicBool>,
    is_muted: Arc<AtomicBool>,
    current_level: Arc<Mutex<f32>>,
    selected_device: Arc<Mutex<Option<String>>>,
    app_handle: Arc<Mutex<Option<AppHandle>>>,
    denoiser: SharedDenoiser,
}

impl RealtimeCapture {
    pub fn new() -> Self {
        Self {
            host: cpal::default_host(),
            stream: Arc::new(Mutex::new(None)),
            is_capturing: Arc::new(AtomicBool::new(false)),
            is_muted: Arc::new(AtomicBool::new(true)),
            current_level: Arc::new(Mutex::new(0.0)),
            selected_device: Arc::new(Mutex::new(None)),
            app_handle: Arc::new(Mutex::new(None)),
            denoiser: SharedDenoiser::new(),
        }
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

    /// Set the input device by name. Pass None for default device.
    /// If currently capturing, restarts with the new device.
    pub fn set_input_device(&self, device_name: Option<String>) -> Result<(), String> {
        tracing::info!("set_input_device called with: {:?}", device_name);

        let was_capturing = self.is_capturing.load(Ordering::SeqCst);
        tracing::info!("was_capturing: {}", was_capturing);

        // Store the selected device first
        *self.selected_device.lock() = device_name.clone();
        tracing::info!("Device name stored");

        // Stop current stream if running
        if was_capturing {
            tracing::info!("Stopping current stream...");
            // Drop the stream explicitly
            *self.stream.lock() = None;
            self.is_capturing.store(false, Ordering::SeqCst);
            *self.current_level.lock() = 0.0;
            tracing::info!("Stream stopped");

            // Small delay to let the audio system settle
            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        // Get the app handle before starting
        let app_handle = self.app_handle.lock().clone();

        // Restart if was capturing
        if was_capturing {
            if let Some(app) = app_handle {
                tracing::info!("Restarting capture with new device...");
                match self.start(app) {
                    Ok(_) => tracing::info!("Capture restarted successfully"),
                    Err(e) => {
                        tracing::error!("Failed to restart capture: {}", e);
                        return Err(e);
                    }
                }
            } else {
                tracing::warn!("No app handle available for restart");
            }
        }

        Ok(())
    }

    /// Get the currently selected device name
    pub fn get_selected_device(&self) -> Option<String> {
        self.selected_device.lock().clone()
    }

    /// Get a device by name, or the default if None
    fn get_device(&self, name: Option<&str>) -> Result<cpal::Device, String> {
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
                .ok_or_else(|| "No default input device available".to_string()),
        }
    }

    /// Start capturing and emitting audio level events
    pub fn start(&self, app_handle: AppHandle) -> Result<(), String> {
        if self.is_capturing.load(Ordering::SeqCst) {
            return Ok(()); // Already capturing
        }

        // Store app handle for potential restart
        *self.app_handle.lock() = Some(app_handle.clone());

        // Get the selected device or default
        let selected = self.selected_device.lock().clone();
        let device = self.get_device(selected.as_deref())?;

        let device_name = device.name().unwrap_or_default();
        tracing::info!("Starting audio capture on: {}", device_name);

        // Use the device's default configuration instead of forcing a specific one
        let supported_config = device
            .default_input_config()
            .map_err(|e| format!("Failed to get default input config: {}", e))?;

        tracing::info!(
            "Using device config: {} Hz, {} channels, {:?}",
            supported_config.sample_rate().0,
            supported_config.channels(),
            supported_config.sample_format()
        );

        let config = supported_config.config();
        let sample_rate = config.sample_rate.0;
        let channels = config.channels as usize;

        // Configure denoiser with the device's sample rate
        self.denoiser.set_sample_rate(sample_rate);
        self.denoiser.reset();

        // Calculate samples per frame based on actual sample rate (~20ms worth)
        let samples_per_frame = (sample_rate as usize * 20) / 1000;

        let is_muted = self.is_muted.clone();
        let current_level = self.current_level.clone();
        let app = app_handle.clone();
        let denoiser = self.denoiser.clone();

        // Accumulator for samples (mono-converted)
        let sample_buffer: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::with_capacity(samples_per_frame * 2)));

        let err_fn = |err| {
            tracing::error!("Audio capture error: {}", err);
        };

        // Build the stream based on the sample format
        let stream = match supported_config.sample_format() {
            SampleFormat::F32 => {
                device.build_input_stream(
                    &config,
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        process_audio_data(
                            data,
                            channels,
                            samples_per_frame,
                            &sample_buffer,
                            &is_muted,
                            &current_level,
                            &app,
                            &denoiser,
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
                let app = app_handle.clone();
                let denoiser = self.denoiser.clone();

                device.build_input_stream(
                    &config,
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        // Convert i16 to f32
                        let float_data: Vec<f32> = data.iter()
                            .map(|&s| s as f32 / i16::MAX as f32)
                            .collect();
                        process_audio_data(
                            &float_data,
                            channels,
                            samples_per_frame,
                            &sample_buffer,
                            &is_muted,
                            &current_level,
                            &app,
                            &denoiser,
                        );
                    },
                    err_fn,
                    None,
                )
            }
            SampleFormat::U16 => {
                let sample_buffer = Arc::new(Mutex::new(Vec::with_capacity(samples_per_frame * 2)));
                let is_muted = self.is_muted.clone();
                let current_level = self.current_level.clone();
                let app = app_handle.clone();
                let denoiser = self.denoiser.clone();

                device.build_input_stream(
                    &config,
                    move |data: &[u16], _: &cpal::InputCallbackInfo| {
                        // Convert u16 to f32
                        let float_data: Vec<f32> = data.iter()
                            .map(|&s| (s as f32 / u16::MAX as f32) * 2.0 - 1.0)
                            .collect();
                        process_audio_data(
                            &float_data,
                            channels,
                            samples_per_frame,
                            &sample_buffer,
                            &is_muted,
                            &current_level,
                            &app,
                            &denoiser,
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

        stream.play().map_err(|e| format!("Failed to start audio stream: {}", e))?;

        *self.stream.lock() = Some(stream);
        self.is_capturing.store(true, Ordering::SeqCst);

        tracing::info!("Audio capture started successfully");
        Ok(())
    }

    /// Stop capturing
    pub fn stop(&self) {
        if !self.is_capturing.load(Ordering::SeqCst) {
            return;
        }

        *self.stream.lock() = None;
        self.is_capturing.store(false, Ordering::SeqCst);
        *self.current_level.lock() = 0.0;

        tracing::info!("Audio capture stopped");
    }

    /// Set mute state
    pub fn set_muted(&self, muted: bool) {
        self.is_muted.store(muted, Ordering::SeqCst);
        if muted {
            *self.current_level.lock() = 0.0;
        }
    }

    /// Get mute state
    pub fn is_muted(&self) -> bool {
        self.is_muted.load(Ordering::SeqCst)
    }

    /// Check if currently capturing
    pub fn is_capturing(&self) -> bool {
        self.is_capturing.load(Ordering::SeqCst)
    }

    /// Get current audio level
    pub fn current_level(&self) -> f32 {
        *self.current_level.lock()
    }
}

/// Process audio data and emit events
fn process_audio_data(
    data: &[f32],
    channels: usize,
    samples_per_frame: usize,
    sample_buffer: &Arc<Mutex<Vec<f32>>>,
    is_muted: &Arc<AtomicBool>,
    current_level: &Arc<Mutex<f32>>,
    app: &AppHandle,
    denoiser: &SharedDenoiser,
) {
    let mut buffer = sample_buffer.lock();

    // Convert to mono if needed by averaging channels
    if channels > 1 {
        for chunk in data.chunks(channels) {
            let mono: f32 = chunk.iter().sum::<f32>() / channels as f32;
            buffer.push(mono);
        }
    } else {
        buffer.extend_from_slice(data);
    }

    // Process when we have enough samples
    while buffer.len() >= samples_per_frame {
        let samples: Vec<f32> = buffer.drain(..samples_per_frame).collect();

        // Apply noise reduction if enabled
        let processed_samples = denoiser.process(&samples);

        // Calculate audio level from processed (denoised) samples
        let rms = calculate_rms(&processed_samples);
        let level = if is_muted.load(Ordering::SeqCst) {
            0.0 // Show 0 when muted
        } else {
            rms_to_level(rms)
        };

        // Update current level
        *current_level.lock() = level;

        // Emit event to frontend
        let event = AudioLevelEvent {
            level,
            is_speaking: !is_muted.load(Ordering::SeqCst) && rms > SPEAKING_THRESHOLD,
            rms,
        };

        let _ = app.emit("audio-level", event);
    }
}

impl Default for RealtimeCapture {
    fn default() -> Self {
        Self::new()
    }
}

// Safety: Stream is managed through Arc<Mutex> and atomic flags
unsafe impl Send for RealtimeCapture {}
unsafe impl Sync for RealtimeCapture {}
