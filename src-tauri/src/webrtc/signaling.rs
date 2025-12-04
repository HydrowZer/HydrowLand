use serde::{Deserialize, Serialize};

/// Represents a connection offer or answer encoded in base64
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionOffer {
    pub sdp_base64: String,
    pub is_offer: bool,
}

/// Messages sent over the data channel
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SignalingMessage {
    /// Chat message
    #[serde(rename = "chat")]
    Chat {
        sender: String,
        content: String,
        timestamp: u64,
    },

    /// User joined notification
    #[serde(rename = "user_joined")]
    UserJoined { username: String },

    /// User left notification
    #[serde(rename = "user_left")]
    UserLeft { username: String },

    /// Ping for keepalive
    #[serde(rename = "ping")]
    Ping { timestamp: u64 },

    /// Pong response
    #[serde(rename = "pong")]
    Pong { timestamp: u64 },

    /// Peer offer relay (for mesh signaling)
    #[serde(rename = "peer_offer")]
    PeerOffer {
        from_peer: String,
        sdp_base64: String,
    },

    /// Peer answer relay (for mesh signaling)
    #[serde(rename = "peer_answer")]
    PeerAnswer {
        from_peer: String,
        sdp_base64: String,
    },

    /// Announce a new peer joined (for mesh coordination)
    #[serde(rename = "new_peer_announce")]
    NewPeerAnnounce { username: String },

    /// Request to connect to a peer (mesh expansion)
    #[serde(rename = "connect_request")]
    ConnectRequest {
        peer_id: String,
        peer_username: String,
    },
}

impl SignalingMessage {
    pub fn chat(sender: String, content: String) -> Self {
        Self::Chat {
            sender,
            content,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        }
    }

    pub fn user_joined(username: String) -> Self {
        Self::UserJoined { username }
    }

    pub fn user_left(username: String) -> Self {
        Self::UserLeft { username }
    }
}
