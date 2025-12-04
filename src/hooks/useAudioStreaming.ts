import { useEffect, useRef, useCallback, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import * as api from "../services/tauriApi";
import { peerService } from "../services/peerService";

interface AudioLevelEvent {
  level: number;
  is_speaking: boolean;
  rms: number;
}

interface UseAudioStreamingOptions {
  enabled: boolean;
  onSpeakingChange?: (peerId: string, isSpeaking: boolean) => void;
}

export function useAudioStreaming({ enabled, onSpeakingChange }: UseAudioStreamingOptions) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [localLevel, setLocalLevel] = useState(0);
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const [peerLevels, setPeerLevels] = useState<Map<string, number>>(new Map());
  const [peerSpeaking, setPeerSpeaking] = useState<Map<string, boolean>>(new Map());

  const audioLoopRef = useRef<number | null>(null);
  const isRunningRef = useRef(false);

  // Initialize the streaming service
  const initialize = useCallback(async () => {
    if (isInitialized) return;

    try {
      await api.streamingStartVoice();
      setIsInitialized(true);
      console.log("[AudioStreaming] Initialized");
    } catch (e) {
      console.error("[AudioStreaming] Failed to initialize:", e);
    }
  }, [isInitialized]);

  // Cleanup
  const cleanup = useCallback(async () => {
    isRunningRef.current = false;
    if (audioLoopRef.current) {
      cancelAnimationFrame(audioLoopRef.current);
      audioLoopRef.current = null;
    }

    try {
      await api.streamingStopVoice();
      setIsInitialized(false);
      console.log("[AudioStreaming] Cleaned up");
    } catch (e) {
      console.error("[AudioStreaming] Cleanup error:", e);
    }
  }, []);

  // Audio send loop - polls for encoded packets and sends them
  const startAudioLoop = useCallback(() => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;

    const loop = async () => {
      if (!isRunningRef.current) return;

      try {
        // Get encoded audio packet from backend
        const packet = await api.streamingGetOutgoingPacket();

        if (packet && packet.data.length > 0) {
          // Send to all peers via PeerJS data channel
          peerService.broadcast({
            type: "audio",
            payload: {
              data: packet.data,
              timestamp: packet.timestamp,
            },
          });
        }
      } catch (e) {
        // Ignore errors during normal operation
      }

      // Schedule next iteration (~20ms for 50fps, matching Opus frame rate)
      audioLoopRef.current = window.setTimeout(() => {
        if (isRunningRef.current) {
          loop();
        }
      }, 20) as unknown as number;
    };

    loop();
  }, []);

  // Stop the audio loop
  const stopAudioLoop = useCallback(() => {
    isRunningRef.current = false;
    if (audioLoopRef.current) {
      clearTimeout(audioLoopRef.current);
      audioLoopRef.current = null;
    }
  }, []);

  // Handle incoming audio from peers
  const handlePeerAudio = useCallback(async (peerId: string, audioData: number[]) => {
    try {
      await api.streamingReceiveAudio(peerId, audioData);
    } catch (e) {
      console.error("[AudioStreaming] Failed to receive audio from peer:", peerId, e);
    }
  }, []);

  // Handle peer speaking state (from their isSpeaking events)
  const handlePeerSpeaking = useCallback((peerId: string, speaking: boolean) => {
    setPeerSpeaking(prev => {
      const next = new Map(prev);
      next.set(peerId, speaking);
      return next;
    });
    onSpeakingChange?.(peerId, speaking);
  }, [onSpeakingChange]);

  // Setup message handler for incoming audio
  useEffect(() => {
    if (!enabled || !isInitialized) return;

    const originalCallbacks = {
      onMessage: peerService["onMessage"],
    };

    // Wrap the existing message handler
    peerService.setCallbacks({
      ...originalCallbacks,
      onMessage: (peerId: string, data: unknown) => {
        const msg = data as { type: string; payload: unknown };

        if (msg.type === "audio") {
          const payload = msg.payload as { data: number[]; timestamp: number };
          handlePeerAudio(peerId, payload.data);
        } else if (msg.type === "speaking") {
          const payload = msg.payload as { isSpeaking: boolean };
          handlePeerSpeaking(peerId, payload.isSpeaking);
        } else {
          // Pass through to original handler
          originalCallbacks.onMessage?.(peerId, data);
        }
      },
    });

    return () => {
      // Restore original callbacks
      if (originalCallbacks.onMessage) {
        peerService.setCallbacks({ onMessage: originalCallbacks.onMessage });
      }
    };
  }, [enabled, isInitialized, handlePeerAudio, handlePeerSpeaking]);

  // Listen for local audio level events
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      unlisten = await listen<AudioLevelEvent>("audio-level", (event) => {
        setLocalLevel(event.payload.level);
        const speaking = event.payload.is_speaking;
        setLocalSpeaking(speaking);

        // Broadcast speaking state to peers (throttled)
        if (enabled && isInitialized) {
          peerService.broadcast({
            type: "speaking",
            payload: { isSpeaking: speaking },
          });
        }
      });
    };

    setup();
    return () => unlisten?.();
  }, [enabled, isInitialized]);

  // Main effect - start/stop based on enabled state
  useEffect(() => {
    if (enabled) {
      initialize().then(() => {
        startAudioLoop();
      });
    } else {
      stopAudioLoop();
    }

    return () => {
      stopAudioLoop();
    };
  }, [enabled, initialize, startAudioLoop, stopAudioLoop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  // Set mute state
  const setMuted = useCallback(async (muted: boolean) => {
    try {
      await api.streamingSetMuted(muted);
    } catch (e) {
      console.error("[AudioStreaming] Failed to set mute:", e);
    }
  }, []);

  // Remove a peer when they disconnect
  const removePeer = useCallback(async (peerId: string) => {
    try {
      await api.streamingRemovePeer(peerId);
      setPeerLevels(prev => {
        const next = new Map(prev);
        next.delete(peerId);
        return next;
      });
      setPeerSpeaking(prev => {
        const next = new Map(prev);
        next.delete(peerId);
        return next;
      });
    } catch (e) {
      console.error("[AudioStreaming] Failed to remove peer:", e);
    }
  }, []);

  return {
    isInitialized,
    localLevel,
    localSpeaking,
    peerLevels,
    peerSpeaking,
    setMuted,
    removePeer,
    cleanup,
  };
}
