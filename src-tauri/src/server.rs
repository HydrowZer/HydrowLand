use parking_lot::RwLock;
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ServerError {
    #[error("Server not running")]
    NotRunning,
    #[error("Already hosting")]
    AlreadyHosting,
    #[error("Already connected to a server")]
    AlreadyConnected,
    #[error("Config error: {0}")]
    ConfigError(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub code: String,
    pub username: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Peer {
    pub id: String,
    pub username: String,
    pub is_host: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    pub code: String,
    pub is_hosting: bool,
    pub username: String,
    pub peers: Vec<Peer>,
}

/// Génère un code serveur de 6 caractères
fn generate_server_code() -> String {
    const CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut rng = rand::thread_rng();
    (0..6)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

/// Chemin vers le fichier de config
fn config_path() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("hydrowland");
    fs::create_dir_all(&config_dir).ok();
    config_dir.join("server.json")
}

/// Charger la config depuis le fichier
fn load_config() -> Option<ServerConfig> {
    let path = config_path();
    if path.exists() {
        let content = fs::read_to_string(&path).ok()?;
        serde_json::from_str(&content).ok()
    } else {
        None
    }
}

/// Sauvegarder la config dans le fichier
fn save_config(config: &ServerConfig) -> Result<(), ServerError> {
    let path = config_path();
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| ServerError::ConfigError(e.to_string()))?;
    fs::write(&path, content)
        .map_err(|e| ServerError::ConfigError(e.to_string()))?;
    Ok(())
}

/// État global du serveur
#[derive(Default)]
pub struct ServerState {
    config: RwLock<Option<ServerConfig>>,
    is_hosting: RwLock<bool>,
    connected_to: RwLock<Option<String>>, // Code du serveur rejoint
    peers: RwLock<Vec<Peer>>,
}

impl ServerState {
    pub fn new() -> Self {
        let config = load_config();
        Self {
            config: RwLock::new(config),
            is_hosting: RwLock::new(false),
            connected_to: RwLock::new(None),
            peers: RwLock::new(Vec::new()),
        }
    }

    /// Récupérer ou créer la config serveur
    pub fn get_or_create_config(&self, username: String) -> ServerConfig {
        let mut config = self.config.write();

        if let Some(ref mut cfg) = *config {
            // Mettre à jour le username si différent
            if cfg.username != username {
                cfg.username = username;
                save_config(cfg).ok();
            }
            cfg.clone()
        } else {
            // Créer une nouvelle config
            let new_config = ServerConfig {
                code: generate_server_code(),
                username,
            };
            save_config(&new_config).ok();
            *config = Some(new_config.clone());
            new_config
        }
    }

    /// Obtenir la config actuelle
    pub fn get_config(&self) -> Option<ServerConfig> {
        self.config.read().clone()
    }

    /// Mettre à jour le username
    pub fn set_username(&self, username: String) -> Result<(), ServerError> {
        let mut config = self.config.write();
        if let Some(ref mut cfg) = *config {
            cfg.username = username;
            save_config(cfg)?;
        }
        Ok(())
    }

    /// Démarrer l'hébergement du serveur
    pub fn start_hosting(&self, username: String) -> Result<ServerInfo, ServerError> {
        if *self.is_hosting.read() {
            return Err(ServerError::AlreadyHosting);
        }
        if self.connected_to.read().is_some() {
            return Err(ServerError::AlreadyConnected);
        }

        let config = self.get_or_create_config(username.clone());
        *self.is_hosting.write() = true;

        // Ajouter l'hôte comme premier peer
        let mut peers = self.peers.write();
        peers.clear();
        peers.push(Peer {
            id: "local".to_string(),
            username: username.clone(),
            is_host: true,
        });

        tracing::info!("Server started with code: {}", config.code);

        Ok(ServerInfo {
            code: config.code,
            is_hosting: true,
            username,
            peers: peers.clone(),
        })
    }

    /// Rejoindre un serveur
    pub fn join_server(&self, code: String, username: String) -> Result<ServerInfo, ServerError> {
        if *self.is_hosting.read() {
            return Err(ServerError::AlreadyHosting);
        }
        if self.connected_to.read().is_some() {
            return Err(ServerError::AlreadyConnected);
        }

        let code = code.to_uppercase();
        *self.connected_to.write() = Some(code.clone());

        // Mettre à jour le username dans la config
        self.get_or_create_config(username.clone());

        // Ajouter l'utilisateur local comme peer
        let mut peers = self.peers.write();
        peers.clear();
        peers.push(Peer {
            id: "local".to_string(),
            username: username.clone(),
            is_host: false,
        });

        tracing::info!("Joined server with code: {}", code);

        Ok(ServerInfo {
            code,
            is_hosting: false,
            username,
            peers: peers.clone(),
        })
    }

    /// Quitter le serveur / arrêter l'hébergement
    pub fn disconnect(&self) -> Result<(), ServerError> {
        *self.is_hosting.write() = false;
        *self.connected_to.write() = None;
        self.peers.write().clear();

        tracing::info!("Disconnected from server");
        Ok(())
    }

    /// Obtenir les infos du serveur actuel
    pub fn get_server_info(&self) -> Option<ServerInfo> {
        let config = self.config.read();
        let is_hosting = *self.is_hosting.read();
        let connected_to = self.connected_to.read().clone();
        let peers = self.peers.read().clone();

        if is_hosting {
            config.as_ref().map(|cfg| ServerInfo {
                code: cfg.code.clone(),
                is_hosting: true,
                username: cfg.username.clone(),
                peers,
            })
        } else if let Some(code) = connected_to {
            config.as_ref().map(|cfg| ServerInfo {
                code,
                is_hosting: false,
                username: cfg.username.clone(),
                peers,
            })
        } else {
            None
        }
    }

    /// Ajouter un peer
    pub fn add_peer(&self, peer: Peer) {
        let mut peers = self.peers.write();
        if !peers.iter().any(|p| p.id == peer.id) {
            peers.push(peer);
        }
    }

    /// Retirer un peer
    pub fn remove_peer(&self, peer_id: &str) {
        self.peers.write().retain(|p| p.id != peer_id);
    }

    /// Vérifier si connecté
    pub fn is_connected(&self) -> bool {
        *self.is_hosting.read() || self.connected_to.read().is_some()
    }
}
