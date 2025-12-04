use tauri::State;
use crate::room::{Room, RoomState};

/// Créer une nouvelle room
#[tauri::command]
pub fn create_room(
    state: State<RoomState>,
    username: String,
) -> Result<Room, String> {
    state.create_room(username).map_err(|e| e.to_string())
}

/// Rejoindre une room existante
#[tauri::command]
pub fn join_room(
    state: State<RoomState>,
    code: String,
    username: String,
) -> Result<Room, String> {
    state.join_room(&code, username).map_err(|e| e.to_string())
}

/// Quitter la room actuelle
#[tauri::command]
pub fn leave_room(state: State<RoomState>) -> Result<(), String> {
    state.leave_room().map_err(|e| e.to_string())
}

/// Obtenir les infos de la room actuelle
#[tauri::command]
pub fn get_room_info(state: State<RoomState>) -> Result<Option<Room>, String> {
    Ok(state.get_current_room())
}
