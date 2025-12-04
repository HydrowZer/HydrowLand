import { useState } from "react";
import { useRoomStore } from "../../stores/roomStore";
import * as api from "../../services/tauriApi";
import { SignalingModal } from "../chat/SignalingModal";
import { ChatPanel } from "../chat/ChatPanel";
import { VoiceControls } from "../voice/VoiceControls";

export function RoomView() {
  const { room, username, leaveRoom: storeLeaveRoom } = useRoomStore();
  const [showSignaling, setShowSignaling] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  const isHost = room?.participants[0]?.username === username;

  const handleLeave = async () => {
    try {
      await api.closeWebRTC();
      await api.leaveRoom();
      storeLeaveRoom();
    } catch (e) {
      console.error("Failed to leave room:", e);
      storeLeaveRoom();
    }
  };

  const copyCode = () => {
    if (room?.code) {
      navigator.clipboard.writeText(room.code);
    }
  };

  const handleConnected = () => {
    setIsConnected(true);
    setShowSignaling(false);
  };

  if (!room) return null;

  return (
    <div className="min-h-screen bg-dark-900 flex flex-col">
      {/* Header */}
      <header className="bg-dark-800 border-b border-dark-700 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-white">HydrowLand</h1>
          <div className="flex items-center gap-2 bg-dark-700 px-3 py-1.5 rounded-lg">
            <span className="text-dark-400 text-sm">Room:</span>
            <code className="text-primary-400 font-mono font-bold">
              {room.code}
            </code>
            <button
              onClick={copyCode}
              className="text-dark-400 hover:text-white transition"
              title="Copier le code"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
            </button>
          </div>
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${
            isConnected ? "bg-green-900/50" : "bg-yellow-900/50"
          }`}>
            <div className={`w-2 h-2 rounded-full ${
              isConnected ? "bg-green-400" : "bg-yellow-400 animate-pulse"
            }`} />
            <span className={`text-sm ${
              isConnected ? "text-green-400" : "text-yellow-400"
            }`}>
              {isConnected ? "Connecte" : "Non connecte"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isConnected && (
            <button
              onClick={() => setShowSignaling(true)}
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition"
            >
              {isHost ? "Inviter" : "Se connecter"}
            </button>
          )}
          <button
            onClick={handleLeave}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition"
          >
            Quitter
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex">
        {/* Sidebar - Participants */}
        <aside className="w-64 bg-dark-800 border-r border-dark-700 p-4">
          <h2 className="text-sm font-semibold text-dark-400 uppercase tracking-wider mb-4">
            Participants ({room.participants.length}/{room.max_participants})
          </h2>

          <ul className="space-y-2">
            {room.participants.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-3 p-2 rounded-lg bg-dark-700/50"
              >
                <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center text-white font-medium text-sm">
                  {p.username.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">
                    {p.username}
                    {p.username === username && (
                      <span className="text-dark-400 ml-1">(toi)</span>
                    )}
                  </p>
                  <p className="text-dark-500 text-xs">
                    {p.is_host ? "Host" : "Membre"}
                  </p>
                </div>

                {/* Mute indicator */}
                {p.is_muted && (
                  <svg
                    className="w-4 h-4 text-red-500"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
                    <line
                      x1="3"
                      y1="3"
                      x2="21"
                      y2="21"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                  </svg>
                )}
              </li>
            ))}
          </ul>
        </aside>

        {/* Main area - Chat */}
        <main className="flex-1 flex flex-col">
          <ChatPanel isConnected={isConnected} />

          {/* Voice controls */}
          <VoiceControls isConnected={isConnected} />
        </main>
      </div>

      {/* Signaling Modal */}
      {showSignaling && (
        <SignalingModal
          isHost={isHost}
          onConnected={handleConnected}
          onClose={() => setShowSignaling(false)}
        />
      )}
    </div>
  );
}
