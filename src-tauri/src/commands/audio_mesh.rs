//! Audio mesh commands for WebRTC audio streaming
//! Provides Tauri commands for audio-enabled mesh networking

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::webrtc::{AudioMeshManager, ConnectionOffer, calculate_audio_level};

/// Audio level info for a peer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioLevelInfo {
    pub peer_id: String,
    pub level: f32,  // 0.0 to 1.0
    pub is_speaking: bool,
}

/// State for audio mesh operations
pub struct AudioMeshState {
    manager: AudioMeshManager,
}

impl AudioMeshState {
    pub fn new() -> Self {
        Self {
            manager: AudioMeshManager::new(),
        }
    }

    pub fn manager(&self) -> &AudioMeshManager {
        &self.manager
    }
}

impl Default for AudioMeshState {
    fn default() -> Self {
        Self::new()
    }
}

// ============ AUDIO MESH COMMANDS ============

/// Initialize audio mesh with username
#[tauri::command]
pub fn audio_mesh_init(state: State<'_, AudioMeshState>, username: String) {
    state.manager().set_username(username);
}

/// Enable/disable local audio
#[tauri::command]
pub fn audio_mesh_enable_audio(state: State<'_, AudioMeshState>, enabled: bool) {
    state.manager().enable_local_audio(enabled);
}

/// Check if audio is enabled
#[tauri::command]
pub fn audio_mesh_is_audio_enabled(state: State<'_, AudioMeshState>) -> bool {
    state.manager().is_audio_enabled()
}

/// Create offer for a peer with audio support
#[tauri::command]
pub async fn audio_mesh_create_offer(
    state: State<'_, AudioMeshState>,
    peer_id: String,
    peer_username: String,
) -> Result<ConnectionOffer, String> {
    state.manager().create_offer_for_peer(&peer_id, &peer_username).await
}

/// Accept offer from a peer with audio support
#[tauri::command]
pub async fn audio_mesh_accept_offer(
    state: State<'_, AudioMeshState>,
    peer_id: String,
    peer_username: String,
    offer_base64: String,
) -> Result<ConnectionOffer, String> {
    state.manager().accept_offer_from_peer(&peer_id, &peer_username, &offer_base64).await
}

/// Accept answer from a peer
#[tauri::command]
pub async fn audio_mesh_accept_answer(
    state: State<'_, AudioMeshState>,
    peer_id: String,
    answer_base64: String,
) -> Result<(), String> {
    state.manager().accept_answer_from_peer(&peer_id, &answer_base64).await
}

/// Send audio to all peers (broadcast)
/// opus_data: Opus-encoded audio bytes
#[tauri::command]
pub async fn audio_mesh_broadcast_audio(
    state: State<'_, AudioMeshState>,
    opus_data: Vec<u8>,
) -> Result<(), String> {
    state.manager().broadcast_audio(&opus_data).await
}

/// Send audio to specific peer
#[tauri::command]
pub async fn audio_mesh_send_audio_to_peer(
    state: State<'_, AudioMeshState>,
    peer_id: String,
    opus_data: Vec<u8>,
) -> Result<(), String> {
    state.manager().send_audio_to_peer(&peer_id, &opus_data).await
}

/// Send chat message to all peers
#[tauri::command]
pub async fn audio_mesh_send_chat(
    state: State<'_, AudioMeshState>,
    message: String,
) -> Result<(), String> {
    state.manager().send_chat_message(&message).await
}

/// Get list of connected peers
#[tauri::command]
pub fn audio_mesh_get_peers(state: State<'_, AudioMeshState>) -> Vec<String> {
    state.manager().get_connected_peers()
}

/// Get peer count
#[tauri::command]
pub fn audio_mesh_peer_count(state: State<'_, AudioMeshState>) -> usize {
    state.manager().peer_count()
}

/// Check if connected to any peer
#[tauri::command]
pub fn audio_mesh_is_connected(state: State<'_, AudioMeshState>) -> bool {
    state.manager().is_connected()
}

/// Remove a peer
#[tauri::command]
pub fn audio_mesh_remove_peer(state: State<'_, AudioMeshState>, peer_id: String) {
    state.manager().remove_peer(&peer_id);
}

/// Close all connections
#[tauri::command]
pub fn audio_mesh_close_all(state: State<'_, AudioMeshState>) {
    state.manager().close_all();
}

/// Calculate audio level from samples (utility for frontend)
#[tauri::command]
pub fn audio_mesh_calculate_level(samples: Vec<f32>) -> f32 {
    calculate_audio_level(&samples)
}

/// Speaking threshold (audio level above this = speaking)
const SPEAKING_THRESHOLD: f32 = 0.1;

/// Check if samples indicate speaking
#[tauri::command]
pub fn audio_mesh_is_speaking(samples: Vec<f32>) -> bool {
    calculate_audio_level(&samples) > SPEAKING_THRESHOLD
}
