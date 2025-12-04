use tauri::State;
use crate::server::{ServerConfig, ServerInfo, ServerState};

/// Obtenir ou créer la config serveur
#[tauri::command]
pub fn get_server_config(state: State<ServerState>, username: String) -> ServerConfig {
    state.get_or_create_config(username)
}

/// Mettre à jour le username
#[tauri::command]
pub fn set_username(state: State<ServerState>, username: String) -> Result<(), String> {
    state.set_username(username).map_err(|e| e.to_string())
}

/// Démarrer l'hébergement
#[tauri::command]
pub fn start_hosting(state: State<ServerState>, username: String) -> Result<ServerInfo, String> {
    state.start_hosting(username).map_err(|e| e.to_string())
}

/// Rejoindre un serveur
#[tauri::command]
pub fn join_server(
    state: State<ServerState>,
    code: String,
    username: String,
) -> Result<ServerInfo, String> {
    state.join_server(code, username).map_err(|e| e.to_string())
}

/// Se déconnecter
#[tauri::command]
pub fn disconnect(state: State<ServerState>) -> Result<(), String> {
    state.disconnect().map_err(|e| e.to_string())
}

/// Obtenir les infos du serveur actuel
#[tauri::command]
pub fn get_server_info(state: State<ServerState>) -> Option<ServerInfo> {
    state.get_server_info()
}

/// Vérifier si connecté
#[tauri::command]
pub fn is_connected(state: State<ServerState>) -> bool {
    state.is_connected()
}
