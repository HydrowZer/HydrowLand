use parking_lot::RwLock;
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

#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub sender: String,
    pub content: String,
    pub timestamp: u64,
}

pub struct WebRTCManager {
    peer_connection: Arc<RwLock<Option<Arc<RTCPeerConnection>>>>,
    data_channel: Arc<RwLock<Option<Arc<RTCDataChannel>>>>,
    message_tx: Arc<RwLock<Option<MessageSender>>>,
    local_username: Arc<RwLock<Option<String>>>,
}

impl Default for WebRTCManager {
    fn default() -> Self {
        Self::new()
    }
}

impl WebRTCManager {
    pub fn new() -> Self {
        Self {
            peer_connection: Arc::new(RwLock::new(None)),
            data_channel: Arc::new(RwLock::new(None)),
            message_tx: Arc::new(RwLock::new(None)),
            local_username: Arc::new(RwLock::new(None)),
        }
    }

    pub fn set_username(&self, username: String) {
        *self.local_username.write() = Some(username);
    }

    pub fn set_message_sender(&self, tx: MessageSender) {
        *self.message_tx.write() = Some(tx);
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

        let pc = Arc::new(peer_connection);
        *self.peer_connection.write() = Some(pc.clone());

        Ok(pc)
    }

    /// Create an offer (for the host)
    pub async fn create_offer(&self) -> Result<ConnectionOffer, String> {
        let pc = self.create_peer_connection().await?;

        // Create data channel
        let dc = pc
            .create_data_channel("chat", None)
            .await
            .map_err(|e| format!("Failed to create data channel: {}", e))?;

        self.setup_data_channel(dc.clone()).await;
        *self.data_channel.write() = Some(dc);

        // Create offer
        let offer = pc
            .create_offer(None)
            .await
            .map_err(|e| format!("Failed to create offer: {}", e))?;

        // Set local description
        pc.set_local_description(offer.clone())
            .await
            .map_err(|e| format!("Failed to set local description: {}", e))?;

        // Wait for ICE gathering to complete
        self.wait_for_ice_gathering().await;

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

    /// Accept an offer and create an answer (for the joiner)
    pub async fn accept_offer(&self, offer_base64: &str) -> Result<ConnectionOffer, String> {
        let pc = self.create_peer_connection().await?;

        // Setup handler for when we receive the data channel
        let dc_lock = self.data_channel.clone();
        let message_tx = self.message_tx.read().clone();
        let username = self.local_username.read().clone();

        pc.on_data_channel(Box::new(move |dc: Arc<RTCDataChannel>| {
            let dc_lock = dc_lock.clone();
            let message_tx = message_tx.clone();
            let username = username.clone();

            Box::pin(async move {
                tracing::info!("Data channel '{}' opened", dc.label());
                *dc_lock.write() = Some(dc.clone());

                // Setup message handlers
                let tx = message_tx.clone();
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

                dc.on_open(Box::new(move || {
                    tracing::info!("Data channel opened for {}", username.clone().unwrap_or_default());
                    Box::pin(async {})
                }));
            })
        }));

        // Decode and set remote description (the offer)
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
        self.wait_for_ice_gathering().await;

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

    /// Accept the answer (for the host, after receiving joiner's answer)
    pub async fn accept_answer(&self, answer_base64: &str) -> Result<(), String> {
        let pc = self
            .peer_connection
            .read()
            .clone()
            .ok_or("No peer connection")?;

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

        tracing::info!("Answer accepted, connection establishing...");
        Ok(())
    }

    async fn setup_data_channel(&self, dc: Arc<RTCDataChannel>) {
        let message_tx = self.message_tx.read().clone();

        dc.on_open(Box::new(move || {
            tracing::info!("Data channel opened!");
            Box::pin(async {})
        }));

        let tx = message_tx.clone();
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

        dc.on_close(Box::new(|| {
            tracing::info!("Data channel closed");
            Box::pin(async {})
        }));
    }

    async fn wait_for_ice_gathering(&self) {
        // Simple wait for ICE candidates (in production, you'd want a proper state machine)
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
    }

    /// Send a chat message
    pub async fn send_message(&self, message: &str) -> Result<(), String> {
        let dc = self
            .data_channel
            .read()
            .clone()
            .ok_or("No data channel available")?;

        let username = self
            .local_username
            .read()
            .clone()
            .unwrap_or_else(|| "Anonymous".to_string());

        let chat_msg = SignalingMessage::Chat {
            sender: username,
            content: message.to_string(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        };

        let json = serde_json::to_string(&chat_msg)
            .map_err(|e| format!("Failed to serialize message: {}", e))?;

        dc.send_text(json)
            .await
            .map_err(|e| format!("Failed to send message: {}", e))?;

        Ok(())
    }

    pub fn is_connected(&self) -> bool {
        self.data_channel.read().is_some()
    }

    pub fn close(&self) {
        // Take ownership of pc before closing (no async needed for cleanup)
        let pc_opt = self.peer_connection.write().take();
        *self.data_channel.write() = None;
        *self.message_tx.write() = None;

        // Close in background if needed
        if let Some(pc) = pc_opt {
            tokio::spawn(async move {
                let _ = pc.close().await;
            });
        }
    }
}
