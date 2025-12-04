import { useState, useEffect } from "react";
import { useServerStore } from "../../stores/serverStore";
import * as api from "../../services/tauriApi";
import { peerService } from "../../services/peerService";
import { ChatPanel } from "../chat/ChatPanel";
import { VoiceControls } from "../voice/VoiceControls";

interface ConnectedPeer {
  id: string;
  username: string;
}

export function ServerView() {
  const { serverInfo, username, disconnect: storeDisconnect, addMessage } = useServerStore();
  const [isConnecting, setIsConnecting] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [peers, setPeers] = useState<ConnectedPeer[]>([]);

  const isHost = serverInfo?.is_hosting ?? false;

  // Connexion automatique au montage
  useEffect(() => {
    if (!serverInfo) return;

    const connect = async () => {
      setIsConnecting(true);
      setError(null);

      peerService.setCallbacks({
        onReady: () => {
          console.log("PeerJS ready!");
          setIsConnecting(false);
          setIsConnected(true);
        },
        onError: (err) => {
          console.error("PeerJS error:", err);
          setError(err);
          setIsConnecting(false);
        },
        onPeerConnected: (peerId, peerUsername) => {
          console.log("Peer connected:", peerId, peerUsername);
          setPeers((prev) => {
            if (prev.some((p) => p.id === peerId)) return prev;
            return [...prev, { id: peerId, username: peerUsername }];
          });
        },
        onPeerDisconnected: (peerId) => {
          console.log("Peer disconnected:", peerId);
          setPeers((prev) => prev.filter((p) => p.id !== peerId));
        },
        onMessage: (peerId, data) => {
          const msg = data as { type: string; payload: unknown };
          if (msg.type === "chat") {
            const payload = msg.payload as {
              sender: string;
              content: string;
              timestamp: number;
            };
            addMessage({
              id: crypto.randomUUID(),
              senderId: peerId,
              senderName: payload.sender,
              content: payload.content,
              timestamp: payload.timestamp,
            });
          }
        },
      });

      try {
        if (isHost) {
          await peerService.host(serverInfo.code, username);
        } else {
          await peerService.join(serverInfo.code, username);
        }
      } catch (e) {
        console.error("Failed to connect:", e);
      }
    };

    connect();

    return () => {
      peerService.disconnect();
    };
  }, [serverInfo, username, isHost, addMessage]);

  const handleLeave = async () => {
    peerService.disconnect();
    try {
      await api.disconnect();
    } catch (e) {
      console.error("Failed to disconnect:", e);
    }
    storeDisconnect();
  };

  const copyCode = () => {
    if (serverInfo?.code) {
      navigator.clipboard.writeText(serverInfo.code);
    }
  };

  if (!serverInfo) return null;

  return (
    <div className="min-h-screen bg-dark-900 flex flex-col">
      {/* Header */}
      <header className="bg-dark-800 border-b border-dark-700 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-white">HydrowLand</h1>
          <div className="flex items-center gap-2 bg-dark-700 px-3 py-1.5 rounded-lg">
            <span className="text-dark-400 text-sm">
              {isHost ? "Mon serveur:" : "Serveur:"}
            </span>
            <code className="text-primary-400 font-mono font-bold">
              {serverInfo.code}
            </code>
            <button
              onClick={copyCode}
              className="text-dark-400 hover:text-white transition"
              title="Copier le code"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>

          {/* Status */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${
            isConnecting ? "bg-yellow-900/50" :
            isConnected ? "bg-green-900/50" : "bg-red-900/50"
          }`}>
            <div className={`w-2 h-2 rounded-full ${
              isConnecting ? "bg-yellow-400 animate-pulse" :
              isConnected ? "bg-green-400" : "bg-red-400"
            }`} />
            <span className={`text-sm ${
              isConnecting ? "text-yellow-400" :
              isConnected ? "text-green-400" : "text-red-400"
            }`}>
              {isConnecting ? "Connexion..." :
               isConnected ? (isHost ? "En ligne" : "Connecté") : "Erreur"}
            </span>
          </div>
        </div>

        <button
          onClick={handleLeave}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition"
        >
          Quitter
        </button>
      </header>

      {/* Error banner */}
      {error && (
        <div className="bg-red-900/50 border-b border-red-700 px-6 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex">
        {/* Sidebar - Peers */}
        <aside className="w-64 bg-dark-800 border-r border-dark-700 p-4">
          <h2 className="text-sm font-semibold text-dark-400 uppercase tracking-wider mb-4">
            Connectés ({peers.length + 1})
          </h2>

          <ul className="space-y-2">
            {/* Moi */}
            <li className="flex items-center gap-3 p-2 rounded-lg bg-dark-700/50">
              <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center text-white font-medium text-sm">
                {username.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate">
                  {username}
                  <span className="text-dark-400 ml-1">(toi)</span>
                </p>
                <p className="text-dark-500 text-xs">
                  {isHost ? "Host" : "Membre"}
                </p>
              </div>
            </li>

            {/* Autres peers */}
            {peers.map((peer) => (
              <li
                key={peer.id}
                className="flex items-center gap-3 p-2 rounded-lg bg-dark-700/50"
              >
                <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center text-white font-medium text-sm">
                  {peer.username.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">
                    {peer.username}
                  </p>
                  <p className="text-dark-500 text-xs">Membre</p>
                </div>
              </li>
            ))}
          </ul>

          {isHost && isConnected && peers.length === 0 && (
            <div className="mt-4 p-3 bg-dark-700/30 rounded-lg">
              <p className="text-dark-400 text-xs text-center">
                Partage ton code <span className="text-primary-400 font-mono">{serverInfo.code}</span> pour que tes amis puissent te rejoindre
              </p>
            </div>
          )}
        </aside>

        {/* Main area - Chat */}
        <main className="flex-1 flex flex-col">
          <ChatPanel isConnected={isConnected} />
          <VoiceControls isConnected={isConnected} />
        </main>
      </div>
    </div>
  );
}
