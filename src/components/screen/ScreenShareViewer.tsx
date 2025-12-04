import { useState, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import type { EncodedFrameData, StreamStats } from "../../services/tauriApi";
import * as api from "../../services/tauriApi";

interface ScreenShareViewerProps {
  /** Whether the local user is the one sharing */
  isLocalShare?: boolean;
  /** Callback when viewer is closed */
  onClose?: () => void;
  /** Optional class name */
  className?: string;
}

export function ScreenShareViewer({
  isLocalShare = false,
  onClose,
  className = "",
}: ScreenShareViewerProps) {
  const [currentFrame, setCurrentFrame] = useState<EncodedFrameData | null>(null);
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLImageElement>(null);

  // Listen for screen frames from backend
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;

    const setupListener = async () => {
      unlistenFn = await listen<EncodedFrameData>("screen-frame", (event) => {
        setCurrentFrame(event.payload);
      });
    };

    setupListener();

    // Also try to get current frame for late joiners
    api.screenStreamGetCurrentFrame().then((frame) => {
      if (frame && !currentFrame) {
        setCurrentFrame(frame);
      }
    });

    return () => {
      if (unlistenFn) {
        unlistenFn();
      }
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

  // Handle fullscreen
  const toggleFullscreen = async () => {
    if (!containerRef.current) return;

    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (e) {
      console.error("Fullscreen error:", e);
    }
  };

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  // Format bytes for display
  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  if (!currentFrame) {
    return (
      <div className={`flex items-center justify-center bg-dark-900 ${className}`}>
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-dark-400">En attente du flux vidéo...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative bg-black flex items-center justify-center ${className} ${
        isFullscreen ? "w-screen h-screen" : ""
      }`}
    >
      {/* Video frame */}
      <img
        ref={frameRef}
        src={`data:image/jpeg;base64,${currentFrame.data}`}
        alt="Screen share"
        className="max-w-full max-h-full object-contain"
        style={{
          imageRendering: "auto",
        }}
      />

      {/* Controls overlay */}
      <div className="absolute top-0 left-0 right-0 p-2 bg-gradient-to-b from-black/70 to-transparent opacity-0 hover:opacity-100 transition-opacity">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-white text-sm font-medium">
              {isLocalShare ? "Votre écran" : "Partage d'écran"}
            </span>
            <span className="text-dark-400 text-xs">
              {currentFrame.width} x {currentFrame.height}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Stats toggle */}
            <button
              onClick={() => setShowStats(!showStats)}
              className={`p-1.5 rounded transition ${
                showStats
                  ? "bg-primary-600 text-white"
                  : "bg-dark-700/80 text-dark-300 hover:text-white"
              }`}
              title="Statistiques"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </button>

            {/* Fullscreen toggle */}
            <button
              onClick={toggleFullscreen}
              className="p-1.5 rounded bg-dark-700/80 text-dark-300 hover:text-white transition"
              title={isFullscreen ? "Quitter le plein écran" : "Plein écran"}
            >
              {isFullscreen ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9L4 4m0 0v4m0-4h4m6-1v4m0 0h4m-4 0l5 5m-9 4v4m0 0h4m-4 0l5-5m-14 0l5 5m5-5v4m0 0l5-5m0 5h-4" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              )}
            </button>

            {/* Close button */}
            {onClose && (
              <button
                onClick={onClose}
                className="p-1.5 rounded bg-red-600/80 text-white hover:bg-red-600 transition"
                title="Fermer"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Stats panel */}
      {showStats && stats && (
        <div className="absolute bottom-2 left-2 bg-black/80 rounded-lg p-3 text-xs text-white font-mono">
          <div className="space-y-1">
            <div className="flex justify-between gap-4">
              <span className="text-dark-400">FPS:</span>
              <span>{stats.fps}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-dark-400">Frames:</span>
              <span>{stats.frames_sent.toLocaleString()}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-dark-400">Total:</span>
              <span>{formatBytes(stats.total_bytes)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-dark-400">Avg frame:</span>
              <span>{formatBytes(stats.avg_frame_size)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-dark-400">Résolution:</span>
              <span>{currentFrame.width}x{currentFrame.height}</span>
            </div>
          </div>
        </div>
      )}

      {/* Frame number indicator (debug) */}
      <div className="absolute bottom-2 right-2 text-xs text-dark-500 font-mono">
        #{currentFrame.frame_number}
      </div>
    </div>
  );
}
