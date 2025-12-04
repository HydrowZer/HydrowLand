
mod audio;
mod commands;
mod room;
mod screen;
mod server;
mod video;
mod webrtc;

pub use commands::audio::AudioState;
pub use commands::audio_mesh::AudioMeshState;
pub use commands::screen::ScreenState;
pub use commands::screen_stream::ScreenStreamState;
pub use room::RoomState;
pub use screen::ScreenCapture;
pub use server::ServerState;
pub use webrtc::{AudioMeshManager, MeshManager, WebRTCManager};

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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .manage(RoomState::default())
        .manage(ServerState::new())
        .manage(WebRTCManager::new())
        .manage(MeshManager::new())
        .manage(AudioState::default())
        .manage(AudioMeshState::default())
        .manage(ScreenState::default())
        .manage(ScreenStreamState::default())
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
            // Audio commands (local processing)
            commands::audio::audio_init,
            commands::audio::audio_start_voice,
            commands::audio::audio_stop_voice,
            commands::audio::audio_set_mute,
            commands::audio::audio_is_muted,
            commands::audio::audio_is_voice_active,
            commands::audio::audio_get_level,
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
            commands::audio::audio_set_input_device,
            commands::audio::audio_get_input_device,
            commands::audio::audio_set_noise_suppression,
            commands::audio::audio_is_noise_suppression_enabled,
            // Audio mesh commands (WebRTC audio streaming)
            commands::audio_mesh::audio_mesh_init,
            commands::audio_mesh::audio_mesh_enable_audio,
            commands::audio_mesh::audio_mesh_is_audio_enabled,
            commands::audio_mesh::audio_mesh_create_offer,
            commands::audio_mesh::audio_mesh_accept_offer,
            commands::audio_mesh::audio_mesh_accept_answer,
            commands::audio_mesh::audio_mesh_broadcast_audio,
            commands::audio_mesh::audio_mesh_send_audio_to_peer,
            commands::audio_mesh::audio_mesh_send_chat,
            commands::audio_mesh::audio_mesh_get_peers,
            commands::audio_mesh::audio_mesh_peer_count,
            commands::audio_mesh::audio_mesh_is_connected,
            commands::audio_mesh::audio_mesh_remove_peer,
            commands::audio_mesh::audio_mesh_close_all,
            commands::audio_mesh::audio_mesh_calculate_level,
            commands::audio_mesh::audio_mesh_is_speaking,
            // Screen capture commands
            commands::screen::screen_list_monitors,
            commands::screen::screen_list_windows,
            commands::screen::screen_list_sources,
            commands::screen::screen_select_monitor,
            commands::screen::screen_select_window,
            commands::screen::screen_clear_selection,
            commands::screen::screen_get_selection,
            commands::screen::screen_check_permission,
            commands::screen::screen_request_permission,
            commands::screen::screen_capture_preview,
            commands::screen::screen_start_sharing,
            commands::screen::screen_stop_sharing,
            commands::screen::screen_is_sharing,
            commands::screen::screen_capture_frame,
            // Screen streaming commands
            commands::screen_stream::screen_stream_start,
            commands::screen_stream::screen_stream_stop,
            commands::screen_stream::screen_stream_is_active,
            commands::screen_stream::screen_stream_get_stats,
            commands::screen_stream::screen_stream_get_current_frame,
            commands::screen_stream::screen_stream_set_fps,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
