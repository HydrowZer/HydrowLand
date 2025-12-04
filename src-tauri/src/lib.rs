
mod audio;
mod commands;
mod room;
mod server;
mod webrtc;

pub use commands::audio::AudioState;
pub use room::RoomState;
pub use server::ServerState;
pub use webrtc::{MeshManager, WebRTCManager};

/// Commande de test pour vérifier l'IPC
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Salut {} ! Bienvenue sur HydrowLand", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(RoomState::default())
        .manage(ServerState::new())
        .manage(WebRTCManager::new())
        .manage(MeshManager::new())
        .manage(AudioState::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            // Server commands
            commands::server::get_server_config,
            commands::server::set_username,
            commands::server::start_hosting,
            commands::server::join_server,
            commands::server::disconnect,
            commands::server::get_server_info,
            commands::server::is_connected,
            // Room commands (legacy)
            commands::room::create_room,
            commands::room::join_room,
            commands::room::leave_room,
            commands::room::get_room_info,
            // Single peer WebRTC commands (backward compatible)
            commands::webrtc::create_webrtc_offer,
            commands::webrtc::accept_webrtc_offer,
            commands::webrtc::accept_webrtc_answer,
            commands::webrtc::send_chat_message,
            commands::webrtc::is_webrtc_connected,
            commands::webrtc::close_webrtc,
            // Mesh commands (multi-peer)
            commands::webrtc::mesh_init,
            commands::webrtc::mesh_create_offer,
            commands::webrtc::mesh_accept_offer,
            commands::webrtc::mesh_accept_answer,
            commands::webrtc::mesh_send_chat,
            commands::webrtc::mesh_get_peers,
            commands::webrtc::mesh_peer_count,
            commands::webrtc::mesh_is_connected,
            commands::webrtc::mesh_remove_peer,
            commands::webrtc::mesh_close_all,
            commands::webrtc::mesh_announce_peer,
            // Audio commands
            commands::audio::audio_init,
            commands::audio::audio_start_voice,
            commands::audio::audio_stop_voice,
            commands::audio::audio_set_mute,
            commands::audio::audio_is_muted,
            commands::audio::audio_is_voice_active,
            commands::audio::audio_list_input_devices,
            commands::audio::audio_list_output_devices,
            commands::audio::audio_encode,
            commands::audio::audio_decode,
            commands::audio::audio_add_peer_samples,
            commands::audio::audio_set_peer_volume,
            commands::audio::audio_remove_peer,
            commands::audio::audio_set_master_volume,
            commands::audio::audio_get_master_volume,
            commands::audio::audio_cleanup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
