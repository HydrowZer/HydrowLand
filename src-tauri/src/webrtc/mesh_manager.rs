use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::mpsc;
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::MediaEngine;
use webrtc::api::APIBuilder;
use webrtc::data_channel::data_channel_message::DataChannelMessage;
use webrtc::data_channel::RTCDataChannel;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::interceptor::registry::Registry;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;

use super::signaling::{ConnectionOffer, SignalingMessage};

pub type MessageSender = mpsc::UnboundedSender<String>;

/// Represents a single peer connection with its data channel
struct PeerEntry {
    peer_connection: Arc<RTCPeerConnection>,
    data_channel: Option<Arc<RTCDataChannel>>,
    username: String,
}

/// Manages a mesh network of WebRTC peer connections
pub struct MeshManager {
    /// Map of peer_id -> PeerEntry
    peers: Arc<RwLock<HashMap<String, PeerEntry>>>,
    /// Local username
    local_username: Arc<RwLock<Option<String>>>,
    /// Channel to send received messages to frontend
    message_tx: Arc<RwLock<Option<MessageSender>>>,
    /// List of known peer usernames for mesh coordination
    known_peers: Arc<RwLock<Vec<String>>>,
}

impl Default for MeshManager {
    fn default() -> Self {
        Self::new()
    }
}

impl MeshManager {
    pub fn new() -> Self {
        Self {
            peers: Arc::new(RwLock::new(HashMap::new())),
            local_username: Arc::new(RwLock::new(None)),
            message_tx: Arc::new(RwLock::new(None)),
            known_peers: Arc::new(RwLock::new(Vec::new())),
        }
    }

    pub fn set_username(&self, username: String) {
        *self.local_username.write() = Some(username);
    }

    pub fn set_message_sender(&self, tx: MessageSender) {
        *self.message_tx.write() = Some(tx);
    }

    pub fn get_local_username(&self) -> Option<String> {
        self.local_username.read().clone()
    }

    pub fn get_connected_peers(&self) -> Vec<String> {
        self.peers
            .read()
            .values()
            .map(|p| p.username.clone())
            .collect()
    }

    pub fn peer_count(&self) -> usize {
        self.peers.read().len()
    }

    async fn create_peer_connection(&self) -> Result<Arc<RTCPeerConnection>, String> {
        let mut m = MediaEngine::default();
        m.register_default_codecs()
            .map_err(|e| format!("Failed to register codecs: {}", e))?;

        let mut registry = Registry::new();
        registry = register_default_interceptors(registry, &mut m)
            .map_err(|e| format!("Failed to register interceptors: {}", e))?;

        let api = APIBuilder::new()
            .with_media_engine(m)
            .with_interceptor_registry(registry)
            .build();

        let config = RTCConfiguration {
            ice_servers: vec![
                RTCIceServer {
                    urls: vec!["stun:stun.l.google.com:19302".to_owned()],
                    ..Default::default()
                },
                RTCIceServer {
                    urls: vec!["stun:stun.cloudflare.com:3478".to_owned()],
                    ..Default::default()
                },
            ],
            ..Default::default()
        };

        let peer_connection = api
            .new_peer_connection(config)
            .await
            .map_err(|e| format!("Failed to create peer connection: {}", e))?;

        Ok(Arc::new(peer_connection))
    }

    /// Create an offer for a new peer (used by initiator)
    pub async fn create_offer_for_peer(&self, peer_id: &str, peer_username: &str) -> Result<ConnectionOffer, String> {
        let pc = self.create_peer_connection().await?;

        // Create data channel
        let dc = pc
            .create_data_channel("chat", None)
            .await
            .map_err(|e| format!("Failed to create data channel: {}", e))?;

        self.setup_data_channel(peer_id.to_string(), dc.clone()).await;

        // Store peer entry
        {
            let mut peers = self.peers.write();
            peers.insert(
                peer_id.to_string(),
                PeerEntry {
                    peer_connection: pc.clone(),
                    data_channel: Some(dc),
                    username: peer_username.to_string(),
                },
            );
        }

        // Create offer
        let offer = pc
            .create_offer(None)
            .await
            .map_err(|e| format!("Failed to create offer: {}", e))?;

        pc.set_local_description(offer.clone())
            .await
            .map_err(|e| format!("Failed to set local description: {}", e))?;

        // Wait for ICE gathering
        self.wait_for_ice_gathering(&pc).await;

        let local_desc = pc
            .local_description()
            .await
            .ok_or("No local description")?;

        let sdp_json = serde_json::to_string(&local_desc)
            .map_err(|e| format!("Failed to serialize SDP: {}", e))?;

        use base64::Engine;
        let encoded = base64::engine::general_purpose::STANDARD.encode(sdp_json.as_bytes());

        Ok(ConnectionOffer {
            sdp_base64: encoded,
            is_offer: true,
        })
    }

    /// Accept an offer from a peer (used by responder)
    pub async fn accept_offer_from_peer(
        &self,
        peer_id: &str,
        peer_username: &str,
        offer_base64: &str,
    ) -> Result<ConnectionOffer, String> {
        let pc = self.create_peer_connection().await?;

        // Setup handler for incoming data channel
        let peers = self.peers.clone();
        let message_tx = self.message_tx.clone();
        let peer_id_clone = peer_id.to_string();

        pc.on_data_channel(Box::new(move |dc: Arc<RTCDataChannel>| {
            let peers = peers.clone();
            let message_tx = message_tx.clone();
            let peer_id = peer_id_clone.clone();

            Box::pin(async move {
                tracing::info!("Data channel '{}' opened from peer {}", dc.label(), peer_id);

                // Store data channel in peer entry
                {
                    let mut peers_lock = peers.write();
                    if let Some(entry) = peers_lock.get_mut(&peer_id) {
                        entry.data_channel = Some(dc.clone());
                    }
                }

                // Setup message handler
                let tx = message_tx.read().clone();
                dc.on_message(Box::new(move |msg: DataChannelMessage| {
                    let tx = tx.clone();
                    Box::pin(async move {
                        if let Ok(text) = String::from_utf8(msg.data.to_vec()) {
                            if let Some(ref sender) = tx {
                                let _ = sender.send(text);
                            }
                        }
                    })
                }));

                dc.on_open(Box::new(|| {
                    tracing::info!("Data channel opened!");
                    Box::pin(async {})
                }));
            })
        }));

        // Store peer entry (without data channel yet, will be set in on_data_channel)
        {
            let mut peers = self.peers.write();
            peers.insert(
                peer_id.to_string(),
                PeerEntry {
                    peer_connection: pc.clone(),
                    data_channel: None,
                    username: peer_username.to_string(),
                },
            );
        }

        // Decode and set remote description
        use base64::Engine;
        let sdp_json = base64::engine::general_purpose::STANDARD
            .decode(offer_base64)
            .map_err(|e| format!("Failed to decode offer: {}", e))?;

        let sdp_str =
            String::from_utf8(sdp_json).map_err(|e| format!("Invalid UTF-8 in offer: {}", e))?;

        let offer: RTCSessionDescription =
            serde_json::from_str(&sdp_str).map_err(|e| format!("Failed to parse offer: {}", e))?;

        pc.set_remote_description(offer)
            .await
            .map_err(|e| format!("Failed to set remote description: {}", e))?;

        // Create answer
        let answer = pc
            .create_answer(None)
            .await
            .map_err(|e| format!("Failed to create answer: {}", e))?;

        pc.set_local_description(answer)
            .await
            .map_err(|e| format!("Failed to set local description: {}", e))?;

        // Wait for ICE gathering
        self.wait_for_ice_gathering(&pc).await;

        let local_desc = pc
            .local_description()
            .await
            .ok_or("No local description")?;

        let sdp_json = serde_json::to_string(&local_desc)
            .map_err(|e| format!("Failed to serialize answer: {}", e))?;

        let encoded = base64::engine::general_purpose::STANDARD.encode(sdp_json.as_bytes());

        Ok(ConnectionOffer {
            sdp_base64: encoded,
            is_offer: false,
        })
    }

    /// Accept an answer from a peer
    pub async fn accept_answer_from_peer(&self, peer_id: &str, answer_base64: &str) -> Result<(), String> {
        let pc = {
            let peers = self.peers.read();
            peers
                .get(peer_id)
                .map(|e| e.peer_connection.clone())
                .ok_or_else(|| format!("No peer connection for {}", peer_id))?
        };

        use base64::Engine;
        let sdp_json = base64::engine::general_purpose::STANDARD
            .decode(answer_base64)
            .map_err(|e| format!("Failed to decode answer: {}", e))?;

        let sdp_str =
            String::from_utf8(sdp_json).map_err(|e| format!("Invalid UTF-8 in answer: {}", e))?;

        let answer: RTCSessionDescription =
            serde_json::from_str(&sdp_str).map_err(|e| format!("Failed to parse answer: {}", e))?;

        pc.set_remote_description(answer)
            .await
            .map_err(|e| format!("Failed to set remote description: {}", e))?;

        tracing::info!("Answer from peer {} accepted", peer_id);
        Ok(())
    }

    async fn setup_data_channel(&self, peer_id: String, dc: Arc<RTCDataChannel>) {
        let message_tx = self.message_tx.clone();

        dc.on_open(Box::new(move || {
            tracing::info!("Data channel opened for peer!");
            Box::pin(async {})
        }));

        let tx = message_tx.read().clone();
        dc.on_message(Box::new(move |msg: DataChannelMessage| {
            let tx = tx.clone();
            Box::pin(async move {
                if let Ok(text) = String::from_utf8(msg.data.to_vec()) {
                    tracing::info!("Received message: {}", text);
                    if let Some(ref sender) = tx {
                        let _ = sender.send(text);
                    }
                }
            })
        }));

        let peer_id_clone = peer_id.clone();
        dc.on_close(Box::new(move || {
            tracing::info!("Data channel closed for peer {}", peer_id_clone);
            Box::pin(async {})
        }));
    }

    async fn wait_for_ice_gathering(&self, _pc: &Arc<RTCPeerConnection>) {
        // Simple wait for ICE candidates
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
    }

    /// Send a message to a specific peer
    pub async fn send_to_peer(&self, peer_id: &str, message: &str) -> Result<(), String> {
        let dc = {
            let peers = self.peers.read();
            peers
                .get(peer_id)
                .and_then(|e| e.data_channel.clone())
                .ok_or_else(|| format!("No data channel for peer {}", peer_id))?
        };

        dc.send_text(message.to_string())
            .await
            .map_err(|e| format!("Failed to send to peer: {}", e))?;

        Ok(())
    }

    /// Broadcast a message to all connected peers
    pub async fn broadcast(&self, message: &str) -> Result<(), String> {
        let peer_ids: Vec<String> = self.peers.read().keys().cloned().collect();

        for peer_id in peer_ids {
            if let Err(e) = self.send_to_peer(&peer_id, message).await {
                tracing::warn!("Failed to send to peer {}: {}", peer_id, e);
            }
        }

        Ok(())
    }

    /// Send a chat message to all peers
    pub async fn send_chat_message(&self, content: &str) -> Result<(), String> {
        let username = self
            .local_username
            .read()
            .clone()
            .unwrap_or_else(|| "Anonymous".to_string());

        let msg = SignalingMessage::Chat {
            sender: username,
            content: content.to_string(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        };

        let json = serde_json::to_string(&msg)
            .map_err(|e| format!("Failed to serialize message: {}", e))?;

        self.broadcast(&json).await
    }

    /// Remove a peer connection
    pub fn remove_peer(&self, peer_id: &str) {
        let entry = self.peers.write().remove(peer_id);
        if let Some(entry) = entry {
            tokio::spawn(async move {
                let _ = entry.peer_connection.close().await;
            });
        }
    }

    /// Check if connected to any peer
    pub fn is_connected(&self) -> bool {
        let peers = self.peers.read();
        peers.values().any(|e| e.data_channel.is_some())
    }

    /// Close all peer connections
    pub fn close_all(&self) {
        let entries: Vec<PeerEntry> = self.peers.write().drain().map(|(_, v)| v).collect();
        for entry in entries {
            tokio::spawn(async move {
                let _ = entry.peer_connection.close().await;
            });
        }
    }

    /// Relay a peer offer to another peer (for in-band signaling)
    pub async fn relay_peer_offer(
        &self,
        from_peer_id: &str,
        to_peer_id: &str,
        offer_base64: &str,
    ) -> Result<(), String> {
        let msg = SignalingMessage::PeerOffer {
            from_peer: from_peer_id.to_string(),
            sdp_base64: offer_base64.to_string(),
        };

        let json = serde_json::to_string(&msg)
            .map_err(|e| format!("Failed to serialize peer offer: {}", e))?;

        self.send_to_peer(to_peer_id, &json).await
    }

    /// Relay a peer answer to another peer
    pub async fn relay_peer_answer(
        &self,
        from_peer_id: &str,
        to_peer_id: &str,
        answer_base64: &str,
    ) -> Result<(), String> {
        let msg = SignalingMessage::PeerAnswer {
            from_peer: from_peer_id.to_string(),
            sdp_base64: answer_base64.to_string(),
        };

        let json = serde_json::to_string(&msg)
            .map_err(|e| format!("Failed to serialize peer answer: {}", e))?;

        self.send_to_peer(to_peer_id, &json).await
    }

    /// Announce a new peer to all existing peers
    pub async fn announce_new_peer(&self, new_peer_username: &str) -> Result<(), String> {
        let msg = SignalingMessage::NewPeerAnnounce {
            username: new_peer_username.to_string(),
        };

        let json = serde_json::to_string(&msg)
            .map_err(|e| format!("Failed to serialize announcement: {}", e))?;

        self.broadcast(&json).await
    }
}
