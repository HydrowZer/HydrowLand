import { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { useServerStore } from "../../stores/serverStore";
import * as api from "../../services/tauriApi";
import type { EncodedFrameData } from "../../services/tauriApi";
import { peerService } from "../../services/peerService";
import { ChatPanel } from "../chat/ChatPanel";
import { VoiceControls, type VoiceControlsRef } from "../voice/VoiceControls";
import { ToastContainer } from "../ui/Toast";
import { ConnectionIndicator } from "../ui/ConnectionIndicator";
import { ThemeToggle } from "../ui/ThemeToggle";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useToast } from "../../hooks/useToast";
import { RemoteScreenViewer } from "../screen/RemoteScreenViewer";

interface ConnectedPeer {
  id: string;
  username: string;
}

interface AudioLevelEvent {
  level: number;
  is_speaking: boolean;
  rms: number;
}

interface SpeakingState {
  [odId: string]: boolean;
}

interface RemoteScreenShare {
  peerId: string;
  peerUsername: string;
  frame: EncodedFrameData | null;
}

export function ServerView() {
  const { serverInfo, username, disconnect: storeDisconnect, addMessage } = useServerStore();
  const [isConnecting, setIsConnecting] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [peers, setPeers] = useState<ConnectedPeer[]>([]);
  const [speakingStates, setSpeakingStates] = useState<SpeakingState>({});
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const [_audioStreamingEnabled, setAudioStreamingEnabled] = useState(false);
  const [remoteScreenShare, setRemoteScreenShare] = useState<RemoteScreenShare | null>(null);
  const [isLocalScreenSharing, setIsLocalScreenSharing] = useState(false);
  const voiceControlsRef = useRef<VoiceControlsRef>(null);
  const audioLoopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioLoopRunningRef = useRef(false);
  const { toasts, toast, removeToast } = useToast();

  const isHost = serverInfo?.is_hosting ?? false;

  // Handle receiving screen frames from peers
  const handlePeerScreenFrame = useCallback((peerId: string, frameData: EncodedFrameData) => {
    setRemoteScreenShare((prev) => {
      if (!prev || prev.peerId !== peerId) return prev;
      return { ...prev, frame: frameData };
    });
  }, []);

  // Handle peer screen sharing state change
  const handlePeerScreenState = useCallback((peerId: string, isSharing: boolean, peerUsername: string) => {
    if (isSharing) {
      setRemoteScreenShare({
        peerId,
        peerUsername,
        frame: null,
      });
      toast.info(`${peerUsername} partage son écran`);
    } else {
      setRemoteScreenShare((prev) => {
        if (prev?.peerId === peerId) {
          toast.info(`${peerUsername} a arrêté le partage`);
          return null;
        }
        return prev;
      });
    }
  }, [toast]);

  // Listen for local screen frames and broadcast to peers
  useEffect(() => {
    if (!isConnected) return;

    let unlisten: (() => void) | undefined;
    let lastFrameTime = 0;
    const minFrameInterval = 33; // ~30fps max for network

    const setupListener = async () => {
      unlisten = await listen<EncodedFrameData>("screen-frame", (event) => {
        const now = Date.now();
        // Throttle to avoid overwhelming the network
        if (now - lastFrameTime < minFrameInterval) return;
        lastFrameTime = now;

        // Track that we're sharing
        if (!isLocalScreenSharing) {
          setIsLocalScreenSharing(true);
          // Notify peers we started sharing
          peerService.broadcast({
            type: "screen-state",
            payload: { isSharing: true, username },
          });
        }

        // Broadcast frame to all peers
        peerService.broadcast({
          type: "screen",
          payload: event.payload,
        });
      });
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [isConnected, isLocalScreenSharing, username]);

  // Notify peers when we stop sharing
  useEffect(() => {
    const checkSharingStatus = async () => {
      try {
        const isSharing = await api.screenIsSharing();
        if (!isSharing && isLocalScreenSharing) {
          setIsLocalScreenSharing(false);
          peerService.broadcast({
            type: "screen-state",
            payload: { isSharing: false, username },
          });
        }
      } catch {
        // Ignore errors
      }
    };

    const interval = setInterval(checkSharingStatus, 1000);
    return () => clearInterval(interval);
  }, [isLocalScreenSharing, username]);

  // Handle receiving audio from peers
  const handlePeerAudio = useCallback(async (peerId: string, audioData: number[]) => {
    try {
      await api.streamingReceiveAudio(peerId, audioData);
    } catch (e) {
      // Silently ignore errors during normal operation
    }
  }, []);

  // Audio send loop - polls for encoded packets and sends them
  const startAudioLoop = useCallback(() => {
    if (audioLoopRunningRef.current) return;
    audioLoopRunningRef.current = true;

    const loop = async () => {
      if (!audioLoopRunningRef.current) return;

      try {
        const packet = await api.streamingGetOutgoingPacket();
        if (packet && packet.data.length > 0) {
          peerService.broadcast({
            type: "audio",
            payload: {
              data: packet.data,
              timestamp: packet.timestamp,
            },
          });
        }
      } catch (e) {
        // Ignore errors
      }

      // Schedule next iteration (~20ms for 50fps, matching Opus frame rate)
      audioLoopRef.current = setTimeout(() => {
        if (audioLoopRunningRef.current) {
          loop();
        }
      }, 20);
    };

    loop();
    console.log("[Audio] Streaming loop started");
  }, []);

  const stopAudioLoop = useCallback(() => {
    audioLoopRunningRef.current = false;
    if (audioLoopRef.current) {
      clearTimeout(audioLoopRef.current);
      audioLoopRef.current = null;
    }
    console.log("[Audio] Streaming loop stopped");
  }, []);

  // Initialize audio streaming when connected
  useEffect(() => {
    if (!isConnected) return;

    const initAudio = async () => {
      try {
        await api.streamingStartVoice();
        setAudioStreamingEnabled(true);
        startAudioLoop();
        console.log("[Audio] Streaming service initialized");
      } catch (e) {
        console.error("[Audio] Failed to initialize streaming:", e);
      }
    };

    initAudio();

    return () => {
      stopAudioLoop();
      api.streamingStopVoice().catch(console.error);
      setAudioStreamingEnabled(false);
    };
  }, [isConnected, startAudioLoop, stopAudioLoop]);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onToggleMute: () => voiceControlsRef.current?.toggleMute(),
    onToggleScreenShare: () => voiceControlsRef.current?.toggleScreenShare(),
    enabled: isConnected,
  });

  // Listen for local audio level to detect when we're speaking
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let lastSpeakingState = false;

    const setupListener = async () => {
      unlisten = await listen<AudioLevelEvent>("audio-level", (event) => {
        const isSpeaking = event.payload.is_speaking;
        setLocalSpeaking(isSpeaking);

        // Broadcast speaking state to peers (only when state changes)
        if (isSpeaking !== lastSpeakingState) {
          lastSpeakingState = isSpeaking;
          peerService.broadcast({
            type: "speaking",
            payload: { is_speaking: isSpeaking },
          });
        }
      });
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

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
          toast.success(`${peerUsername} a rejoint`);
        },
        onPeerDisconnected: (peerId) => {
          console.log("Peer disconnected:", peerId);
          // Clean up audio for this peer
          api.streamingRemovePeer(peerId).catch(console.error);
          // Clean up screen share if this peer was sharing
          setRemoteScreenShare((prev) => (prev?.peerId === peerId ? null : prev));
          // Find peer username before removing and show notification
          setPeers((prev) => {
            const disconnectedPeer = prev.find((p) => p.id === peerId);
            if (disconnectedPeer) {
              toast.warning(`${disconnectedPeer.username} a quitté`);
            }
            return prev.filter((p) => p.id !== peerId);
          });
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
          } else if (msg.type === "speaking") {
            const payload = msg.payload as { is_speaking: boolean };
            setSpeakingStates((prev) => ({
              ...prev,
              [peerId]: payload.is_speaking,
            }));
          } else if (msg.type === "audio") {
            // Handle incoming audio from peer
            const payload = msg.payload as { data: number[]; timestamp: number };
            handlePeerAudio(peerId, payload.data);
          } else if (msg.type === "screen") {
            // Handle incoming screen frame from peer
            const payload = msg.payload as EncodedFrameData;
            handlePeerScreenFrame(peerId, payload);
          } else if (msg.type === "screen-state") {
            // Handle peer screen sharing state change
            const payload = msg.payload as { isSharing: boolean; username: string };
            handlePeerScreenState(peerId, payload.isSharing, payload.username);
          }
        },
        onReconnecting: (attempt, maxAttempts) => {
          toast.warning(`Reconnexion en cours... (${attempt}/${maxAttempts})`);
          setIsConnecting(true);
          setIsConnected(false);
        },
        onReconnected: () => {
          toast.success("Reconnecté !");
          setIsConnecting(false);
          setIsConnected(true);
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
        // Si on arrive ici sans que onError ait été appelé, on s'assure que l'UI n'est plus bloquée
        setIsConnecting(false);
        if (!error) {
          setError(e instanceof Error ? e.message : "Échec de la connexion");
        }
      }
    };

    connect();

    return () => {
      peerService.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverInfo?.code, serverInfo?.is_hosting, username, isHost]);

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
      toast.success("Code copié !");
    }
  };

  if (!serverInfo) return null;

  return (
    <div className="h-screen bg-dark-900 flex overflow-hidden">
      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* Sidebar */}
      <aside className="w-60 bg-dark-850 border-r border-dark-700/50 flex flex-col">
        {/* Logo & Server Info */}
        <div className="p-4 border-b border-dark-700/50">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-sm font-semibold text-white tracking-tight">HydrowLand</h1>
            <ThemeToggle />
          </div>

          {/* Server code */}
          <button
            onClick={copyCode}
            className="w-full flex items-center justify-between px-3 py-2 bg-dark-800 hover:bg-dark-700 rounded-lg transition group"
          >
            <span className="text-dark-400 text-xs">{isHost ? "Ton serveur" : "Serveur"}</span>
            <div className="flex items-center gap-2">
              <code className="text-accent-400 font-mono font-semibold text-sm">{serverInfo.code}</code>
              <svg className="w-3.5 h-3.5 text-dark-500 group-hover:text-dark-300 transition" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
          </button>
        </div>

        {/* Status indicator */}
        <div className="px-4 py-3 border-b border-dark-700/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${
                isConnecting ? "bg-amber-400 animate-pulse" :
                isConnected ? "bg-emerald-400" : "bg-red-400"
              }`} />
              <span className="text-xs text-dark-400">
                {isConnecting ? "Connexion..." :
                 isConnected ? "Connecté" : "Erreur"}
              </span>
            </div>
            {isConnected && peers.length > 0 && (
              <ConnectionIndicator isConnected={isConnected} />
            )}
          </div>
        </div>

        {/* Members list */}
        <div className="flex-1 overflow-y-auto p-3">
          <h2 className="text-[11px] font-medium text-dark-500 uppercase tracking-wider mb-2 px-1">
            En ligne — {peers.length + 1}
          </h2>

          <ul className="space-y-0.5">
            {/* Current user */}
            <li className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-dark-800 transition">
              <div className="relative">
                {localSpeaking && (
                  <div className="absolute -inset-0.5 rounded-full bg-emerald-500/40 animate-pulse" />
                )}
                <div className={`relative w-7 h-7 rounded-full bg-gradient-to-br from-accent-500 to-accent-700 flex items-center justify-center text-white font-medium text-xs ${
                  localSpeaking ? "ring-2 ring-emerald-400" : ""
                }`}>
                  {username.charAt(0).toUpperCase()}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-white font-medium truncate">
                  {username}
                  <span className="text-dark-500 font-normal ml-1">(toi)</span>
                </p>
              </div>
              {isHost && (
                <span className="text-[10px] text-accent-400 bg-accent-500/10 px-1.5 py-0.5 rounded">Host</span>
              )}
            </li>

            {/* Other peers */}
            {peers.map((peer) => {
              const isSpeaking = speakingStates[peer.id] ?? false;
              return (
                <li
                  key={peer.id}
                  className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-dark-800 transition"
                >
                  <div className="relative">
                    {isSpeaking && (
                      <div className="absolute -inset-0.5 rounded-full bg-emerald-500/40 animate-pulse" />
                    )}
                    <div className={`relative w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center text-white font-medium text-xs ${
                      isSpeaking ? "ring-2 ring-emerald-400" : ""
                    }`}>
                      {peer.username.charAt(0).toUpperCase()}
                    </div>
                  </div>
                  <p className="text-[13px] text-white font-medium truncate flex-1">
                    {peer.username}
                  </p>
                </li>
              );
            })}
          </ul>

          {isHost && isConnected && peers.length === 0 && (
            <div className="mt-4 p-3 bg-dark-800/50 rounded-lg border border-dark-700/50">
              <p className="text-dark-400 text-xs text-center leading-relaxed">
                Partage ton code pour inviter des amis
              </p>
            </div>
          )}
        </div>

        {/* Leave button */}
        <div className="p-3 border-t border-dark-700/50">
          <button
            onClick={handleLeave}
            className="w-full px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Quitter
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-h-0 bg-dark-900">
        {/* Error banner */}
        {error && (
          <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2.5 flex items-center gap-2">
            <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-red-300 text-sm">{error}</span>
          </div>
        )}

        {/* Chat Panel - takes all available space */}
        <div className="flex-1 min-h-0">
          <ChatPanel isConnected={isConnected} />
        </div>

        {/* Voice Controls - fixed at bottom */}
        <VoiceControls ref={voiceControlsRef} isConnected={isConnected} />
      </main>

      {/* Remote Screen Share Viewer */}
      {remoteScreenShare && (
        <RemoteScreenViewer
          peerUsername={remoteScreenShare.peerUsername}
          frame={remoteScreenShare.frame}
          onClose={() => setRemoteScreenShare(null)}
        />
      )}
    </div>
  );
}
