//! Audio-enabled mesh manager extension
//! Adds WebRTC audio track support to the existing mesh network

use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::mpsc;
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::{MediaEngine, MIME_TYPE_OPUS};
use webrtc::api::APIBuilder;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::interceptor::registry::Registry;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;
use webrtc::rtp_transceiver::rtp_codec::{RTCRtpCodecCapability, RTCRtpCodecParameters, RTPCodecType};
use webrtc::rtp_transceiver::rtp_transceiver_direction::RTCRtpTransceiverDirection;
use webrtc::track::track_local::TrackLocal;
use webrtc::track::track_remote::TrackRemote;
use webrtc::data_channel::RTCDataChannel;
use webrtc::data_channel::data_channel_message::DataChannelMessage;

use super::audio_track::{LocalAudioTrack, OPUS_CLOCK_RATE, OPUS_PAYLOAD_TYPE};
use super::signaling::{ConnectionOffer, SignalingMessage};
use crate::audio::CHANNELS;

pub type MessageSender = mpsc::UnboundedSender<String>;
pub type AudioPacketSender = mpsc::UnboundedSender<(String, Vec<u8>)>;

/// Peer entry with audio track support
struct AudioPeerEntry {
    peer_connection: Arc<RTCPeerConnection>,
    data_channel: Option<Arc<RTCDataChannel>>,
    local_audio_track: Option<Arc<LocalAudioTrack>>,
    username: String,
}

/// Audio-enabled mesh manager
pub struct AudioMeshManager {
    /// Map of peer_id -> AudioPeerEntry
    peers: Arc<RwLock<HashMap<String, AudioPeerEntry>>>,
    /// Local username
    local_username: Arc<RwLock<Option<String>>>,
    /// Channel for chat messages to frontend
    message_tx: Arc<RwLock<Option<MessageSender>>>,
    /// Channel for incoming audio packets
    audio_rx_tx: Arc<RwLock<Option<AudioPacketSender>>>,
    /// Local audio track template (shared SSRC concept)
    local_audio_enabled: Arc<RwLock<bool>>,
}

impl Default for AudioMeshManager {
    fn default() -> Self {
        Self::new()
    }
}

impl AudioMeshManager {
    pub fn new() -> Self {
        Self {
            peers: Arc::new(RwLock::new(HashMap::new())),
            local_username: Arc::new(RwLock::new(None)),
            message_tx: Arc::new(RwLock::new(None)),
            audio_rx_tx: Arc::new(RwLock::new(None)),
            local_audio_enabled: Arc::new(RwLock::new(false)),
        }
    }

    pub fn set_username(&self, username: String) {
        *self.local_username.write() = Some(username);
    }

    pub fn set_message_sender(&self, tx: MessageSender) {
        *self.message_tx.write() = Some(tx);
    }

    pub fn set_audio_receiver(&self, tx: AudioPacketSender) {
        *self.audio_rx_tx.write() = Some(tx);
    }

    pub fn enable_local_audio(&self, enabled: bool) {
        *self.local_audio_enabled.write() = enabled;
    }

    pub fn is_audio_enabled(&self) -> bool {
        *self.local_audio_enabled.read()
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

    /// Create media engine with Opus codec
    fn create_media_engine() -> Result<MediaEngine, String> {
        let mut m = MediaEngine::default();

        // Register Opus codec for audio
        m.register_codec(
            RTCRtpCodecParameters {
                capability: RTCRtpCodecCapability {
                    mime_type: MIME_TYPE_OPUS.to_owned(),
                    clock_rate: OPUS_CLOCK_RATE,
                    channels: CHANNELS,
                    sdp_fmtp_line: "minptime=10;useinbandfec=1".to_owned(),
                    rtcp_feedback: vec![],
                },
                payload_type: OPUS_PAYLOAD_TYPE,
                ..Default::default()
            },
            RTPCodecType::Audio,
        )
        .map_err(|e| format!("Failed to register Opus codec: {}", e))?;

        // Also register default codecs for compatibility
        m.register_default_codecs()
            .map_err(|e| format!("Failed to register default codecs: {}", e))?;

        Ok(m)
    }

    async fn create_peer_connection(&self) -> Result<Arc<RTCPeerConnection>, String> {
        let mut m = Self::create_media_engine()?;

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

    /// Create a local audio track for a peer
    fn create_local_audio_track(&self, peer_id: &str) -> Result<LocalAudioTrack, String> {
        let username = self.local_username.read().clone().unwrap_or_else(|| "user".to_string());
        let track_id = format!("audio-{}", peer_id);
        let stream_id = format!("stream-{}", username);
        LocalAudioTrack::new(&track_id, &stream_id)
    }

    /// Setup remote audio track handler
    fn setup_remote_track_handler(&self, pc: &Arc<RTCPeerConnection>, peer_id: String) {
        let audio_tx = self.audio_rx_tx.clone();
        let peer_id_clone = peer_id.clone();

        pc.on_track(Box::new(move |track, _receiver, _transceiver| {
            let audio_tx = audio_tx.clone();
            let peer_id = peer_id_clone.clone();

            Box::pin(async move {
                if track.kind() == webrtc::rtp_transceiver::rtp_codec::RTPCodecType::Audio {
                    tracing::info!("Received audio track from peer {}", peer_id);

                    // Read RTP packets from the track
                    let track = track.clone();
                    let audio_tx = audio_tx.clone();
                    let peer_id = peer_id.clone();

                    tokio::spawn(async move {
                        let mut buf = vec![0u8; 1500];
                        loop {
                            match track.read(&mut buf).await {
                                Ok((rtp_packet, _attributes)) => {
                                    // Extract Opus payload from RTP packet
                                    let payload = rtp_packet.payload.to_vec();
                                    if !payload.is_empty() {
                                        if let Some(tx) = audio_tx.read().as_ref() {
                                            let _ = tx.send((peer_id.clone(), payload));
                                        }
                                    }
                                }
                                Err(e) => {
                                    tracing::warn!("Error reading audio track: {}", e);
                                    break;
                                }
                            }
                        }
                    });
                }
            })
        }));
    }

    /// Create offer with audio track
    pub async fn create_offer_for_peer(
        &self,
        peer_id: &str,
        peer_username: &str,
    ) -> Result<ConnectionOffer, String> {
        let pc = self.create_peer_connection().await?;

        // Setup remote track handler
        self.setup_remote_track_handler(&pc, peer_id.to_string());

        // Create and add local audio track if audio is enabled
        let local_audio_track = if *self.local_audio_enabled.read() {
            let audio_track = self.create_local_audio_track(peer_id)?;

            // Add track to peer connection
            pc.add_track(audio_track.track())
                .await
                .map_err(|e| format!("Failed to add audio track: {}", e))?;

            Some(Arc::new(audio_track))
        } else {
            // Add transceiver for receiving audio even if not sending
            pc.add_transceiver_from_kind(
                webrtc::rtp_transceiver::rtp_codec::RTPCodecType::Audio,
                Some(webrtc::rtp_transceiver::RTCRtpTransceiverInit {
                    direction: RTCRtpTransceiverDirection::Recvonly,
                    send_encodings: vec![],
                }),
            )
            .await
            .map_err(|e| format!("Failed to add audio transceiver: {}", e))?;
            None
        };

        // Create data channel for chat
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
                AudioPeerEntry {
                    peer_connection: pc.clone(),
                    data_channel: Some(dc),
                    local_audio_track,
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

    /// Accept offer with audio track
    pub async fn accept_offer_from_peer(
        &self,
        peer_id: &str,
        peer_username: &str,
        offer_base64: &str,
    ) -> Result<ConnectionOffer, String> {
        let pc = self.create_peer_connection().await?;

        // Setup remote track handler
        self.setup_remote_track_handler(&pc, peer_id.to_string());

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
            })
        }));

        // Create and add local audio track if audio is enabled
        let local_audio_track = if *self.local_audio_enabled.read() {
            let audio_track = self.create_local_audio_track(peer_id)?;

            pc.add_track(audio_track.track())
                .await
                .map_err(|e| format!("Failed to add audio track: {}", e))?;

            Some(Arc::new(audio_track))
        } else {
            pc.add_transceiver_from_kind(
                webrtc::rtp_transceiver::rtp_codec::RTPCodecType::Audio,
                Some(webrtc::rtp_transceiver::RTCRtpTransceiverInit {
                    direction: RTCRtpTransceiverDirection::Recvonly,
                    send_encodings: vec![],
                }),
            )
            .await
            .map_err(|e| format!("Failed to add audio transceiver: {}", e))?;
            None
        };

        // Store peer entry (without data channel yet)
        {
            let mut peers = self.peers.write();
            peers.insert(
                peer_id.to_string(),
                AudioPeerEntry {
                    peer_connection: pc.clone(),
                    data_channel: None,
                    local_audio_track,
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

    /// Accept answer from peer
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

    /// Send audio to all peers
    pub async fn broadcast_audio(&self, opus_data: &[u8]) -> Result<(), String> {
        // Collect tracks first to avoid holding lock across await
        let tracks: Vec<(String, Arc<LocalAudioTrack>)> = {
            let peers = self.peers.read();
            peers
                .iter()
                .filter_map(|(id, entry)| {
                    entry.local_audio_track.as_ref().map(|t| (id.clone(), t.clone()))
                })
                .collect()
        };

        for (peer_id, track) in tracks {
            if let Err(e) = track.send_audio(opus_data).await {
                tracing::warn!("Failed to send audio to peer {}: {}", peer_id, e);
            }
        }

        Ok(())
    }

    /// Send audio to specific peer
    pub async fn send_audio_to_peer(&self, peer_id: &str, opus_data: &[u8]) -> Result<(), String> {
        // Get track without holding lock across await
        let track = {
            let peers = self.peers.read();
            peers.get(peer_id).and_then(|e| e.local_audio_track.clone())
        };

        if let Some(track) = track {
            track.send_audio(opus_data).await?;
        }

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
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
    }

    /// Send chat message to all peers
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

        self.broadcast_message(&json).await
    }

    /// Broadcast message to all peers
    pub async fn broadcast_message(&self, message: &str) -> Result<(), String> {
        let peer_ids: Vec<String> = self.peers.read().keys().cloned().collect();

        for peer_id in peer_ids {
            if let Err(e) = self.send_to_peer(&peer_id, message).await {
                tracing::warn!("Failed to send to peer {}: {}", peer_id, e);
            }
        }

        Ok(())
    }

    /// Send message to specific peer
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

    /// Remove peer
    pub fn remove_peer(&self, peer_id: &str) {
        let entry = self.peers.write().remove(peer_id);
        if let Some(entry) = entry {
            tokio::spawn(async move {
                let _ = entry.peer_connection.close().await;
            });
        }
    }

    /// Check if connected
    pub fn is_connected(&self) -> bool {
        let peers = self.peers.read();
        peers.values().any(|e| e.data_channel.is_some())
    }

    /// Close all connections
    pub fn close_all(&self) {
        let entries: Vec<AudioPeerEntry> = self.peers.write().drain().map(|(_, v)| v).collect();
        for entry in entries {
            tokio::spawn(async move {
                let _ = entry.peer_connection.close().await;
            });
        }
    }
}
