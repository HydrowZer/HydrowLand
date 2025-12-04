#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use tauri::State;
use crate::webrtc::{ConnectionOffer, MeshManager, WebRTCManager};

/// Create a WebRTC offer (host creates this first)
#[tauri::command]
pub async fn create_webrtc_offer(
    webrtc: State<'_, WebRTCManager>,
    username: String,
) -> Result<ConnectionOffer, String> {
    webrtc.set_username(username);
    webrtc.create_offer().await
}

/// Accept an offer and create an answer (joiner does this)
#[tauri::command]
pub async fn accept_webrtc_offer(
    webrtc: State<'_, WebRTCManager>,
    offer_base64: String,
    username: String,
) -> Result<ConnectionOffer, String> {
    webrtc.set_username(username);
    webrtc.accept_offer(&offer_base64).await
}

/// Accept an answer (host does this after receiving joiner's answer)
#[tauri::command]
pub async fn accept_webrtc_answer(
    webrtc: State<'_, WebRTCManager>,
    answer_base64: String,
) -> Result<(), String> {
    webrtc.accept_answer(&answer_base64).await
}

/// Send a chat message over WebRTC
#[tauri::command]
pub async fn send_chat_message(
    webrtc: State<'_, WebRTCManager>,
    message: String,
) -> Result<(), String> {
    webrtc.send_message(&message).await
}

/// Check if WebRTC is connected
#[tauri::command]
pub fn is_webrtc_connected(webrtc: State<'_, WebRTCManager>) -> bool {
    webrtc.is_connected()
}

/// Close WebRTC connection
#[tauri::command]
pub fn close_webrtc(webrtc: State<'_, WebRTCManager>) -> Result<(), String> {
    webrtc.close();
    Ok(())
}

// ============ MESH COMMANDS ============

#[derive(Debug, Serialize, Deserialize)]
pub struct PeerInfo {
    pub peer_id: String,
    pub username: String,
}

/// Initialize mesh with username
#[tauri::command]
pub fn mesh_init(mesh: State<'_, MeshManager>, username: String) {
    mesh.set_username(username);
}

/// Create offer for a specific peer (mesh)
#[tauri::command]
pub async fn mesh_create_offer(
    mesh: State<'_, MeshManager>,
    peer_id: String,
    peer_username: String,
) -> Result<ConnectionOffer, String> {
    mesh.create_offer_for_peer(&peer_id, &peer_username).await
}

/// Accept offer from a peer (mesh)
#[tauri::command]
pub async fn mesh_accept_offer(
    mesh: State<'_, MeshManager>,
    peer_id: String,
    peer_username: String,
    offer_base64: String,
) -> Result<ConnectionOffer, String> {
    mesh.accept_offer_from_peer(&peer_id, &peer_username, &offer_base64).await
}

/// Accept answer from a peer (mesh)
#[tauri::command]
pub async fn mesh_accept_answer(
    mesh: State<'_, MeshManager>,
    peer_id: String,
    answer_base64: String,
) -> Result<(), String> {
    mesh.accept_answer_from_peer(&peer_id, &answer_base64).await
}

/// Send chat message to all peers (mesh)
#[tauri::command]
pub async fn mesh_send_chat(
    mesh: State<'_, MeshManager>,
    message: String,
) -> Result<(), String> {
    mesh.send_chat_message(&message).await
}

/// Get list of connected peers
#[tauri::command]
pub fn mesh_get_peers(mesh: State<'_, MeshManager>) -> Vec<String> {
    mesh.get_connected_peers()
}

/// Get peer count
#[tauri::command]
pub fn mesh_peer_count(mesh: State<'_, MeshManager>) -> usize {
    mesh.peer_count()
}

/// Check if mesh has any connections
#[tauri::command]
pub fn mesh_is_connected(mesh: State<'_, MeshManager>) -> bool {
    mesh.is_connected()
}

/// Remove a specific peer
#[tauri::command]
pub fn mesh_remove_peer(mesh: State<'_, MeshManager>, peer_id: String) {
    mesh.remove_peer(&peer_id);
}

/// Close all mesh connections
#[tauri::command]
pub fn mesh_close_all(mesh: State<'_, MeshManager>) {
    mesh.close_all();
}

/// Announce new peer to all connected peers
#[tauri::command]
pub async fn mesh_announce_peer(
    mesh: State<'_, MeshManager>,
    peer_username: String,
) -> Result<(), String> {
    mesh.announce_new_peer(&peer_username).await
}
