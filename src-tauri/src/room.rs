use parking_lot::RwLock;
use rand::Rng;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

#[derive(Error, Debug)]
pub enum RoomError {
    #[error("Room not found")]
    NotFound,
    #[error("Room is full (max {0} participants)")]
    Full(usize),
    #[error("Invalid room code")]
    InvalidCode,
    #[error("Already in a room")]
    AlreadyInRoom,
    #[error("Not in a room")]
    NotInRoom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Participant {
    pub id: String,
    pub username: String,
    pub is_muted: bool,
    pub is_screen_sharing: bool,
    pub is_host: bool,
}

impl Participant {
    pub fn new(username: String, is_host: bool) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            username,
            is_muted: true,
            is_screen_sharing: false,
            is_host,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Room {
    pub code: String,
    pub participants: Vec<Participant>,
    pub max_participants: usize,
    pub created_at: u64,
}

impl Room {
    pub fn new(host: Participant) -> Self {
        Self {
            code: generate_room_code(),
            participants: vec![host],
            max_participants: 5,
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        }
    }

    pub fn add_participant(&mut self, participant: Participant) -> Result<(), RoomError> {
        if self.participants.len() >= self.max_participants {
            return Err(RoomError::Full(self.max_participants));
        }
        self.participants.push(participant);
        Ok(())
    }

    pub fn remove_participant(&mut self, id: &str) {
        self.participants.retain(|p| p.id != id);
    }
}

/// Génère un code de room de 6 caractères alphanumériques
fn generate_room_code() -> String {
    const CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut rng = rand::thread_rng();
    (0..6)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

/// État global de la room (géré par Tauri)
#[derive(Default)]
pub struct RoomState {
    current_room: RwLock<Option<Room>>,
    local_participant: RwLock<Option<Participant>>,
}

impl RoomState {
    pub fn create_room(&self, username: String) -> Result<Room, RoomError> {
        let mut current = self.current_room.write();
        if current.is_some() {
            return Err(RoomError::AlreadyInRoom);
        }

        let host = Participant::new(username, true);
        let room = Room::new(host.clone());

        *self.local_participant.write() = Some(host);
        *current = Some(room.clone());

        tracing::info!("Room created with code: {}", room.code);
        Ok(room)
    }

    pub fn join_room(&self, code: &str, username: String) -> Result<Room, RoomError> {
        let mut current = self.current_room.write();
        if current.is_some() {
            return Err(RoomError::AlreadyInRoom);
        }

        // Pour l'instant en P2P, on crée une room locale avec le code donné
        // La vraie connexion P2P sera ajoutée en Phase 3
        let participant = Participant::new(username, false);
        let room = Room {
            code: code.to_uppercase(),
            participants: vec![participant.clone()],
            max_participants: 5,
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        };

        *self.local_participant.write() = Some(participant);
        *current = Some(room.clone());

        tracing::info!("Joined room with code: {}", code);
        Ok(room)
    }

    pub fn leave_room(&self) -> Result<(), RoomError> {
        let mut current = self.current_room.write();
        if current.is_none() {
            return Err(RoomError::NotInRoom);
        }

        *current = None;
        *self.local_participant.write() = None;

        tracing::info!("Left room");
        Ok(())
    }

    pub fn get_current_room(&self) -> Option<Room> {
        self.current_room.read().clone()
    }

    pub fn get_local_participant(&self) -> Option<Participant> {
        self.local_participant.read().clone()
    }
}
