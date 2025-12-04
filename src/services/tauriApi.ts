import { invoke } from "@tauri-apps/api/core";
import type { Room, ConnectionOffer, ServerConfig, ServerInfo } from "../types/room";

// ============ SERVER API ============

export const getServerConfig = (username: string): Promise<ServerConfig> =>
  invoke("get_server_config", { username });

export const setUsername = (username: string): Promise<void> =>
  invoke("set_username", { username });

export const startHosting = (username: string): Promise<ServerInfo> =>
  invoke("start_hosting", { username });

export const joinServer = (code: string, username: string): Promise<ServerInfo> =>
  invoke("join_server", { code, username });

export const disconnect = (): Promise<void> => invoke("disconnect");

export const getServerInfo = (): Promise<ServerInfo | null> =>
  invoke("get_server_info");

export const isConnected = (): Promise<boolean> => invoke("is_connected");

// ============ ROOM API (legacy) ============

// Room Management
export const createRoom = (username: string): Promise<Room> =>
  invoke("create_room", { username });

export const joinRoom = (code: string, username: string): Promise<Room> =>
  invoke("join_room", { code, username });

export const leaveRoom = (): Promise<void> => invoke("leave_room");

export const getRoomInfo = (): Promise<Room | null> => invoke("get_room_info");

// WebRTC (Single Peer - backward compatible)
export const createWebRTCOffer = (username: string): Promise<ConnectionOffer> =>
  invoke("create_webrtc_offer", { username });

export const acceptWebRTCOffer = (
  offerBase64: string,
  username: string
): Promise<ConnectionOffer> =>
  invoke("accept_webrtc_offer", { offerBase64, username });

export const acceptWebRTCAnswer = (answerBase64: string): Promise<void> =>
  invoke("accept_webrtc_answer", { answerBase64 });

export const sendChatMessage = (message: string): Promise<void> =>
  invoke("send_chat_message", { message });

export const isWebRTCConnected = (): Promise<boolean> =>
  invoke("is_webrtc_connected");

export const closeWebRTC = (): Promise<void> => invoke("close_webrtc");

// ============ MESH API (Multi-peer) ============

export const meshInit = (username: string): Promise<void> =>
  invoke("mesh_init", { username });

export const meshCreateOffer = (
  peerId: string,
  peerUsername: string
): Promise<ConnectionOffer> =>
  invoke("mesh_create_offer", { peerId, peerUsername });

export const meshAcceptOffer = (
  peerId: string,
  peerUsername: string,
  offerBase64: string
): Promise<ConnectionOffer> =>
  invoke("mesh_accept_offer", { peerId, peerUsername, offerBase64 });

export const meshAcceptAnswer = (
  peerId: string,
  answerBase64: string
): Promise<void> => invoke("mesh_accept_answer", { peerId, answerBase64 });

export const meshSendChat = (message: string): Promise<void> =>
  invoke("mesh_send_chat", { message });

export const meshGetPeers = (): Promise<string[]> => invoke("mesh_get_peers");

export const meshPeerCount = (): Promise<number> => invoke("mesh_peer_count");

export const meshIsConnected = (): Promise<boolean> =>
  invoke("mesh_is_connected");

export const meshRemovePeer = (peerId: string): Promise<void> =>
  invoke("mesh_remove_peer", { peerId });

export const meshCloseAll = (): Promise<void> => invoke("mesh_close_all");

export const meshAnnouncePeer = (peerUsername: string): Promise<void> =>
  invoke("mesh_announce_peer", { peerUsername });

// ============ AUDIO API ============

export const audioInit = (): Promise<void> => invoke("audio_init");

export const audioStartVoice = (): Promise<void> => invoke("audio_start_voice");

export const audioStopVoice = (): Promise<void> => invoke("audio_stop_voice");

export const audioSetMute = (muted: boolean): Promise<void> =>
  invoke("audio_set_mute", { muted });

export const audioIsMuted = (): Promise<boolean> => invoke("audio_is_muted");

export const audioIsVoiceActive = (): Promise<boolean> =>
  invoke("audio_is_voice_active");

export const audioGetLevel = (): Promise<number> => invoke("audio_get_level");

export const audioListInputDevices = (): Promise<string[]> =>
  invoke("audio_list_input_devices");

export const audioListOutputDevices = (): Promise<string[]> =>
  invoke("audio_list_output_devices");

export const audioEncode = (samples: number[]): Promise<number[]> =>
  invoke("audio_encode", { samples });

export const audioDecode = (data: number[]): Promise<number[]> =>
  invoke("audio_decode", { data });

export const audioAddPeerSamples = (
  peerId: string,
  samples: number[]
): Promise<void> => invoke("audio_add_peer_samples", { peerId, samples });

export const audioSetPeerVolume = (
  peerId: string,
  volume: number
): Promise<void> => invoke("audio_set_peer_volume", { peerId, volume });

export const audioRemovePeer = (peerId: string): Promise<void> =>
  invoke("audio_remove_peer", { peerId });

export const audioSetMasterVolume = (volume: number): Promise<void> =>
  invoke("audio_set_master_volume", { volume });

export const audioGetMasterVolume = (): Promise<number> =>
  invoke("audio_get_master_volume");

export const audioCleanup = (): Promise<void> => invoke("audio_cleanup");

export const audioSetInputDevice = (deviceName: string | null): Promise<void> =>
  invoke("audio_set_input_device", { deviceName });

export const audioGetInputDevice = (): Promise<string | null> =>
  invoke("audio_get_input_device");

export const audioSetNoiseSuppression = (enabled: boolean): Promise<void> =>
  invoke("audio_set_noise_suppression", { enabled });

export const audioIsNoiseSuppressionEnabled = (): Promise<boolean> =>
  invoke("audio_is_noise_suppression_enabled");

// ============ AUDIO MESH API (WebRTC Audio Streaming) ============

export const audioMeshInit = (username: string): Promise<void> =>
  invoke("audio_mesh_init", { username });

export const audioMeshEnableAudio = (enabled: boolean): Promise<void> =>
  invoke("audio_mesh_enable_audio", { enabled });

export const audioMeshIsAudioEnabled = (): Promise<boolean> =>
  invoke("audio_mesh_is_audio_enabled");

export const audioMeshCreateOffer = (
  peerId: string,
  peerUsername: string
): Promise<ConnectionOffer> =>
  invoke("audio_mesh_create_offer", { peerId, peerUsername });

export const audioMeshAcceptOffer = (
  peerId: string,
  peerUsername: string,
  offerBase64: string
): Promise<ConnectionOffer> =>
  invoke("audio_mesh_accept_offer", { peerId, peerUsername, offerBase64 });

export const audioMeshAcceptAnswer = (
  peerId: string,
  answerBase64: string
): Promise<void> => invoke("audio_mesh_accept_answer", { peerId, answerBase64 });

export const audioMeshBroadcastAudio = (opusData: number[]): Promise<void> =>
  invoke("audio_mesh_broadcast_audio", { opusData });

export const audioMeshSendAudioToPeer = (
  peerId: string,
  opusData: number[]
): Promise<void> => invoke("audio_mesh_send_audio_to_peer", { peerId, opusData });

export const audioMeshSendChat = (message: string): Promise<void> =>
  invoke("audio_mesh_send_chat", { message });

export const audioMeshGetPeers = (): Promise<string[]> =>
  invoke("audio_mesh_get_peers");

export const audioMeshPeerCount = (): Promise<number> =>
  invoke("audio_mesh_peer_count");

export const audioMeshIsConnected = (): Promise<boolean> =>
  invoke("audio_mesh_is_connected");

export const audioMeshRemovePeer = (peerId: string): Promise<void> =>
  invoke("audio_mesh_remove_peer", { peerId });

export const audioMeshCloseAll = (): Promise<void> =>
  invoke("audio_mesh_close_all");

export const audioMeshCalculateLevel = (samples: number[]): Promise<number> =>
  invoke("audio_mesh_calculate_level", { samples });

export const audioMeshIsSpeaking = (samples: number[]): Promise<boolean> =>
  invoke("audio_mesh_is_speaking", { samples });

// ============ SCREEN CAPTURE API ============

export interface MonitorInfo {
  id: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  is_primary: boolean;
  scale_factor: number;
}

export interface WindowInfo {
  id: number;
  title: string;
  app_name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  is_minimized: boolean;
}

export type CaptureSourceInfo =
  | { type: "Monitor" } & MonitorInfo
  | { type: "Window" } & WindowInfo;

export type CaptureSource =
  | { type: "Monitor"; id: number }
  | { type: "Window"; id: number };

export const screenListMonitors = (): Promise<MonitorInfo[]> =>
  invoke("screen_list_monitors");

export const screenListWindows = (
  includeMinimized?: boolean
): Promise<WindowInfo[]> =>
  invoke("screen_list_windows", { includeMinimized: includeMinimized ?? false });

export const screenListSources = (
  includeMinimized?: boolean
): Promise<CaptureSourceInfo[]> =>
  invoke("screen_list_sources", { includeMinimized: includeMinimized ?? false });

export const screenSelectMonitor = (monitorId: number): Promise<void> =>
  invoke("screen_select_monitor", { monitorId });

export const screenSelectWindow = (windowId: number): Promise<void> =>
  invoke("screen_select_window", { windowId });

export const screenClearSelection = (): Promise<void> =>
  invoke("screen_clear_selection");

export const screenGetSelection = (): Promise<CaptureSource | null> =>
  invoke("screen_get_selection");

export const screenCheckPermission = (): Promise<boolean> =>
  invoke("screen_check_permission");

export const screenRequestPermission = (): Promise<boolean> =>
  invoke("screen_request_permission");

export const screenCapturePreview = (maxWidth?: number): Promise<string> =>
  invoke("screen_capture_preview", { maxWidth: maxWidth ?? 400 });

export const screenStartSharing = (): Promise<void> =>
  invoke("screen_start_sharing");

export const screenStopSharing = (): Promise<void> =>
  invoke("screen_stop_sharing");

export const screenIsSharing = (): Promise<boolean> =>
  invoke("screen_is_sharing");

export const screenCaptureFrame = (): Promise<string> =>
  invoke("screen_capture_frame");

// ============ SCREEN STREAMING API ============

export interface EncodedFrameData {
  data: string; // Base64 encoded JPEG
  width: number;
  height: number;
  is_keyframe: boolean;
  frame_number: number;
  timestamp: number;
}

export interface StreamStats {
  is_streaming: boolean;
  fps: number;
  frames_sent: number;
  total_bytes: number;
  avg_frame_size: number;
}

export const screenStreamStart = (fps?: number): Promise<void> =>
  invoke("screen_stream_start", { fps });

export const screenStreamStop = (): Promise<void> =>
  invoke("screen_stream_stop");

export const screenStreamIsActive = (): Promise<boolean> =>
  invoke("screen_stream_is_active");

export const screenStreamGetStats = (): Promise<StreamStats> =>
  invoke("screen_stream_get_stats");

export const screenStreamGetCurrentFrame = (): Promise<EncodedFrameData | null> =>
  invoke("screen_stream_get_current_frame");

export const screenStreamSetFps = (fps: number): Promise<void> =>
  invoke("screen_stream_set_fps", { fps });

// Test command
export const greet = (name: string): Promise<string> =>
  invoke("greet", { name });
