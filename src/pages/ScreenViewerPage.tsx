import { useState, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { EncodedFrameData, StreamStats } from "../services/tauriApi";
import * as api from "../services/tauriApi";

/**
 * Standalone page for the screen share viewer window.
 * This page is opened in a separate Tauri window.
 */
export function ScreenViewerPage() {
  const [currentFrame, setCurrentFrame] = useState<EncodedFrameData | null>(null);
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [isStreaming, setIsStreaming] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  // Listen for screen frames from backend
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;
    let checkInterval: ReturnType<typeof setInterval>;

    const setupListener = async () => {
      unlistenFn = await listen<EncodedFrameData>("screen-frame", (event) => {
        setCurrentFrame(event.payload);
        setIsStreaming(true);
      });
    };

    setupListener();

    // Also try to get current frame for late joiners
    api.screenStreamGetCurrentFrame().then((frame) => {
      if (frame && !currentFrame) {
        setCurrentFrame(frame);
      }
    });

    // Check if streaming is still active - close window if stopped
    checkInterval = setInterval(async () => {
      try {
        const isActive = await api.screenStreamIsActive();
        if (!isActive) {
          setIsStreaming(false);
          // Close this window when streaming stops
          const currentWindow = getCurrentWindow();
          await currentWindow.close();
        }
      } catch (e) {
        console.error("Failed to check stream status:", e);
      }
    }, 500);

    return () => {
      if (unlistenFn) {
        unlistenFn();
      }
      clearInterval(checkInterval);
    };
  }, []);

  // Periodically update stats
  useEffect(() => {
    if (!showStats) return;

    const interval = setInterval(async () => {
      try {
        const newStats = await api.screenStreamGetStats();
        setStats(newStats);
      } catch (e) {
        console.error("Failed to get stream stats:", e);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [showStats]);

  // Handle close
  const handleClose = async () => {
    const currentWindow = getCurrentWindow();
    await currentWindow.close();
  };

  // Format bytes for display
  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  if (!currentFrame) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-dark-900">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-dark-400">En attente du flux vidéo...</p>
          {!isStreaming && (
            <p className="text-red-400 mt-2">Le partage a été arrêté</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-screen w-screen relative bg-black flex items-center justify-center"
    >
      {/* Video frame */}
      <img
        src={`data:image/jpeg;base64,${currentFrame.data}`}
        alt="Screen share"
        className="max-w-full max-h-full object-contain"
        draggable={false}
      />

      {/* Controls overlay - always visible in this window */}
      <div className="absolute top-0 left-0 right-0 p-3 bg-gradient-to-b from-black/80 to-transparent">
        <div className="flex items-center justify-between" data-tauri-drag-region>
          <div className="flex items-center gap-3">
            <span className="text-white text-sm font-medium">
              Partage d'écran
            </span>
            <span className="text-dark-400 text-xs">
              {currentFrame.width} x {currentFrame.height}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Stats toggle */}
            <button
              onClick={() => setShowStats(!showStats)}
              className={`p-2 rounded-lg transition ${
                showStats
                  ? "bg-primary-600 text-white"
                  : "bg-dark-700/80 text-dark-300 hover:text-white hover:bg-dark-600/80"
              }`}
              title="Statistiques"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </button>

            {/* Close button */}
            <button
              onClick={handleClose}
              className="p-2 rounded-lg bg-red-600/80 text-white hover:bg-red-600 transition"
              title="Fermer"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Stats panel */}
      {showStats && stats && (
        <div className="absolute bottom-4 left-4 bg-black/90 rounded-lg p-4 text-sm text-white font-mono border border-dark-700">
          <h3 className="text-dark-400 font-semibold mb-2">Statistiques</h3>
          <div className="space-y-1.5">
            <div className="flex justify-between gap-6">
              <span className="text-dark-400">FPS:</span>
              <span className="text-green-400">{stats.fps}</span>
            </div>
            <div className="flex justify-between gap-6">
              <span className="text-dark-400">Frames:</span>
              <span>{stats.frames_sent.toLocaleString()}</span>
            </div>
            <div className="flex justify-between gap-6">
              <span className="text-dark-400">Total:</span>
              <span>{formatBytes(stats.total_bytes)}</span>
            </div>
            <div className="flex justify-between gap-6">
              <span className="text-dark-400">Avg frame:</span>
              <span>{formatBytes(stats.avg_frame_size)}</span>
            </div>
            <div className="flex justify-between gap-6">
              <span className="text-dark-400">Résolution:</span>
              <span>{currentFrame.width}x{currentFrame.height}</span>
            </div>
          </div>
        </div>
      )}

      {/* Frame number indicator */}
      <div className="absolute bottom-4 right-4 text-xs text-dark-500 font-mono bg-black/50 px-2 py-1 rounded">
        Frame #{currentFrame.frame_number}
      </div>
    </div>
  );
}
