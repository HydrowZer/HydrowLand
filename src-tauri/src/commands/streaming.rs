//! Audio streaming commands
//! Provides Tauri commands for the complete audio pipeline

use tauri::{AppHandle, State};

use crate::audio::{AudioStreamingService, AudioPacket};

/// State wrapper for the streaming service
pub struct StreamingState {
    pub service: AudioStreamingService,
}

impl StreamingState {
    pub fn new() -> Self {
        Self {
            service: AudioStreamingService::new(),
        }
    }
}

impl Default for StreamingState {
    fn default() -> Self {
        Self::new()
    }
}

/// Initialize the streaming service with app handle
#[tauri::command]
pub fn streaming_init(
    state: State<'_, StreamingState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    state.service.set_app_handle(app_handle);
    tracing::info!("Streaming service initialized");
    Ok(())
}

/// Start audio capture (microphone)
#[tauri::command]
pub fn streaming_start_capture(state: State<'_, StreamingState>) -> Result<(), String> {
    state.service.start_capture()
}

/// Stop audio capture
#[tauri::command]
pub fn streaming_stop_capture(state: State<'_, StreamingState>) {
    state.service.stop_capture();
}

/// Start audio playback (speakers)
#[tauri::command]
pub fn streaming_start_playback(state: State<'_, StreamingState>) -> Result<(), String> {
    state.service.start_playback()
}

/// Stop audio playback
#[tauri::command]
pub fn streaming_stop_playback(state: State<'_, StreamingState>) {
    state.service.stop_playback();
}

/// Set mute state
#[tauri::command]
pub fn streaming_set_muted(state: State<'_, StreamingState>, muted: bool) {
    state.service.set_muted(muted);
}

/// Get mute state
#[tauri::command]
pub fn streaming_is_muted(state: State<'_, StreamingState>) -> bool {
    state.service.is_muted()
}

/// Check if capturing
#[tauri::command]
pub fn streaming_is_capturing(state: State<'_, StreamingState>) -> bool {
    state.service.is_capturing()
}

/// Check if playing
#[tauri::command]
pub fn streaming_is_playing(state: State<'_, StreamingState>) -> bool {
    state.service.is_playing()
}

/// Get current audio level
#[tauri::command]
pub fn streaming_get_level(state: State<'_, StreamingState>) -> f32 {
    state.service.current_level()
}

/// Set input device
#[tauri::command]
pub fn streaming_set_input_device(
    state: State<'_, StreamingState>,
    device_name: Option<String>,
) -> Result<(), String> {
    state.service.set_input_device(device_name)
}

/// Get selected input device
#[tauri::command]
pub fn streaming_get_input_device(state: State<'_, StreamingState>) -> Option<String> {
    state.service.get_input_device()
}

/// Set output device
#[tauri::command]
pub fn streaming_set_output_device(
    state: State<'_, StreamingState>,
    device_name: Option<String>,
) -> Result<(), String> {
    state.service.set_output_device(device_name)
}

/// List input devices
#[tauri::command]
pub fn streaming_list_input_devices(state: State<'_, StreamingState>) -> Result<Vec<String>, String> {
    state.service.list_input_devices()
}

/// List output devices
#[tauri::command]
pub fn streaming_list_output_devices(state: State<'_, StreamingState>) -> Result<Vec<String>, String> {
    state.service.list_output_devices()
}

/// Enable/disable noise suppression
#[tauri::command]
pub fn streaming_set_noise_suppression(state: State<'_, StreamingState>, enabled: bool) {
    state.service.set_noise_suppression(enabled);
}

/// Check if noise suppression is enabled
#[tauri::command]
pub fn streaming_is_noise_suppression_enabled(state: State<'_, StreamingState>) -> bool {
    state.service.is_noise_suppression_enabled()
}

/// Get the next outgoing audio packet (for sending to peers)
/// Returns None if no packet is available
#[tauri::command]
pub fn streaming_get_outgoing_packet(state: State<'_, StreamingState>) -> Option<AudioPacket> {
    state.service.get_outgoing_packet()
}

/// Receive audio from a peer
#[tauri::command]
pub fn streaming_receive_audio(
    state: State<'_, StreamingState>,
    peer_id: String,
    opus_data: Vec<u8>,
) -> Result<(), String> {
    state.service.receive_peer_audio(&peer_id, &opus_data)
}

/// Remove a peer (cleanup when they disconnect)
#[tauri::command]
pub fn streaming_remove_peer(state: State<'_, StreamingState>, peer_id: String) {
    state.service.remove_peer(&peer_id);
}

/// Clear all peers
#[tauri::command]
pub fn streaming_clear_peers(state: State<'_, StreamingState>) {
    state.service.clear_peers();
}

/// Start both capture and playback for voice chat
#[tauri::command]
pub fn streaming_start_voice(
    state: State<'_, StreamingState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    state.service.set_app_handle(app_handle);
    state.service.start_capture()?;
    state.service.start_playback()?;
    state.service.set_muted(true); // Start muted
    tracing::info!("Voice streaming started (muted)");
    Ok(())
}

/// Stop both capture and playback
#[tauri::command]
pub fn streaming_stop_voice(state: State<'_, StreamingState>) {
    state.service.stop_capture();
    state.service.stop_playback();
    state.service.clear_peers();
    tracing::info!("Voice streaming stopped");
}
