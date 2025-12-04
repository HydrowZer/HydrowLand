#![allow(dead_code)]

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::audio::{AudioCapture, AudioMixer, AudioPlayback, OpusDecoder, OpusEncoder, RealtimeCapture};

/// Thread-safe audio state wrapper
pub struct AudioState {
    mixer: Mutex<AudioMixer>,
    realtime: RealtimeCapture,
    is_voice_active: Mutex<bool>,
    master_volume: Mutex<f32>,
}

// Safety: AudioState only contains Mutex-protected data and thread-safe RealtimeCapture
unsafe impl Send for AudioState {}
unsafe impl Sync for AudioState {}

impl AudioState {
    pub fn new() -> Self {
        Self {
            mixer: Mutex::new(AudioMixer::new()),
            realtime: RealtimeCapture::new(),
            is_voice_active: Mutex::new(false),
            master_volume: Mutex::new(1.0),
        }
    }
}

impl Default for AudioState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AudioDevice {
    pub name: String,
    pub is_default: bool,
}

/// Initialize audio system (no-op for now, but kept for API consistency)
#[tauri::command]
pub fn audio_init(_audio: State<'_, AudioState>) -> Result<(), String> {
    tracing::info!("Audio system initialized");
    Ok(())
}

/// Start voice capture with real-time level monitoring
/// This starts capturing from the microphone and emits "audio-level" events
#[tauri::command]
pub fn audio_start_voice(
    audio: State<'_, AudioState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    let mut active = audio.is_voice_active.lock();
    if *active {
        return Ok(()); // Already active
    }

    // Start real-time capture
    audio.realtime.start(app_handle)?;

    *active = true;
    tracing::info!("Voice capture started");
    Ok(())
}

/// Stop voice capture
#[tauri::command]
pub fn audio_stop_voice(audio: State<'_, AudioState>) -> Result<(), String> {
    audio.realtime.stop();
    *audio.is_voice_active.lock() = false;
    tracing::info!("Voice capture stopped");
    Ok(())
}

/// Set mute state
#[tauri::command]
pub fn audio_set_mute(audio: State<'_, AudioState>, muted: bool) {
    audio.realtime.set_muted(muted);
    tracing::info!("Mute set to: {}", muted);
}

/// Get mute state
#[tauri::command]
pub fn audio_is_muted(audio: State<'_, AudioState>) -> bool {
    audio.realtime.is_muted()
}

/// Check if voice is active
#[tauri::command]
pub fn audio_is_voice_active(audio: State<'_, AudioState>) -> bool {
    *audio.is_voice_active.lock()
}

/// Get current audio level (0.0 - 1.0)
#[tauri::command]
pub fn audio_get_level(audio: State<'_, AudioState>) -> f32 {
    audio.realtime.current_level()
}

/// List available input devices (microphones)
#[tauri::command]
pub fn audio_list_input_devices() -> Result<Vec<String>, String> {
    AudioCapture::list_devices()
}

/// List available output devices (speakers)
#[tauri::command]
pub fn audio_list_output_devices() -> Result<Vec<String>, String> {
    AudioPlayback::list_devices()
}

/// Encode audio samples to Opus (for sending over network)
/// Creates encoder on-demand (stateless encoding)
#[tauri::command]
pub fn audio_encode(samples: Vec<f32>) -> Result<Vec<u8>, String> {
    let mut encoder = OpusEncoder::new()?;
    encoder.encode(&samples)
}

/// Decode Opus audio (from network)
/// Creates decoder on-demand (stateless decoding)
#[tauri::command]
pub fn audio_decode(data: Vec<u8>) -> Result<Vec<f32>, String> {
    let mut decoder = OpusDecoder::new()?;
    decoder.decode(&data)
}

/// Add peer audio to mixer
#[tauri::command]
pub fn audio_add_peer_samples(audio: State<'_, AudioState>, peer_id: String, samples: Vec<f32>) {
    audio.mixer.lock().add_peer_samples(&peer_id, samples);
}

/// Set peer volume (0.0 - 1.0)
#[tauri::command]
pub fn audio_set_peer_volume(audio: State<'_, AudioState>, peer_id: String, volume: f32) {
    audio.mixer.lock().set_peer_volume(&peer_id, volume);
}

/// Remove peer from mixer
#[tauri::command]
pub fn audio_remove_peer(audio: State<'_, AudioState>, peer_id: String) {
    audio.mixer.lock().remove_peer(&peer_id);
}

/// Set master volume (0.0 - 1.0)
#[tauri::command]
pub fn audio_set_master_volume(audio: State<'_, AudioState>, volume: f32) {
    let clamped = volume.clamp(0.0, 1.0);
    *audio.master_volume.lock() = clamped;
    audio.mixer.lock().set_master_volume(clamped);
}

/// Get master volume
#[tauri::command]
pub fn audio_get_master_volume(audio: State<'_, AudioState>) -> f32 {
    *audio.master_volume.lock()
}

/// Clean up audio resources
#[tauri::command]
pub fn audio_cleanup(audio: State<'_, AudioState>) {
    audio.realtime.stop();
    *audio.is_voice_active.lock() = false;
    audio.mixer.lock().clear();
    tracing::info!("Audio cleaned up");
}

/// Set input device by name. Pass null/None for default device.
#[tauri::command]
pub fn audio_set_input_device(
    audio: State<'_, AudioState>,
    device_name: Option<String>,
) -> Result<(), String> {
    tracing::info!("Setting input device to: {:?}", device_name);
    audio.realtime.set_input_device(device_name)
}

/// Get currently selected input device name (None if using default)
#[tauri::command]
pub fn audio_get_input_device(audio: State<'_, AudioState>) -> Option<String> {
    audio.realtime.get_selected_device()
}

/// Enable or disable noise suppression
#[tauri::command]
pub fn audio_set_noise_suppression(audio: State<'_, AudioState>, enabled: bool) {
    audio.realtime.set_noise_suppression(enabled);
}

/// Check if noise suppression is enabled
#[tauri::command]
pub fn audio_is_noise_suppression_enabled(audio: State<'_, AudioState>) -> bool {
    audio.realtime.is_noise_suppression_enabled()
}
