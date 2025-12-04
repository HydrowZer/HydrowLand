import { useState, useRef, useEffect } from "react";
import type { EncodedFrameData } from "../../services/tauriApi";

interface RemoteScreenViewerProps {
  peerUsername: string;
  frame: EncodedFrameData | null;
  onClose: () => void;
}

export function RemoteScreenViewer({
  peerUsername,
  frame,
  onClose,
}: RemoteScreenViewerProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  if (isMinimized) {
    return (
      <div className="fixed bottom-20 right-4 z-50">
        <button
          onClick={() => setIsMinimized(false)}
          className="flex items-center gap-2 px-3 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg shadow-lg transition"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <span className="text-sm font-medium">{peerUsername}</span>
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`fixed z-50 bg-black flex flex-col ${
        isFullscreen
          ? "inset-0 w-screen h-screen"
          : "top-4 left-4 right-4 bottom-20 rounded-xl overflow-hidden shadow-2xl border border-dark-700"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-dark-800/90 backdrop-blur border-b border-dark-700">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-white text-sm font-medium">
            {peerUsername} partage son écran
          </span>
          {frame && (
            <span className="text-dark-400 text-xs">
              {frame.width} x {frame.height}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Minimize */}
          <button
            onClick={() => setIsMinimized(true)}
            className="p-1.5 rounded bg-dark-700/80 text-dark-300 hover:text-white transition"
            title="Minimiser"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
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
          <button
            onClick={onClose}
            className="p-1.5 rounded bg-red-600/80 text-white hover:bg-red-600 transition"
            title="Fermer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Video frame */}
      <div className="flex-1 flex items-center justify-center bg-black overflow-hidden">
        {frame ? (
          <img
            src={`data:image/jpeg;base64,${frame.data}`}
            alt={`Écran de ${peerUsername}`}
            className="max-w-full max-h-full object-contain"
            style={{ imageRendering: "auto" }}
          />
        ) : (
          <div className="text-center">
            <div className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-dark-400">En attente du flux vidéo...</p>
          </div>
        )}
      </div>

      {/* Frame info */}
      {frame && (
        <div className="absolute bottom-2 right-2 text-xs text-dark-500 font-mono bg-black/50 px-2 py-1 rounded">
          #{frame.frame_number}
        </div>
      )}
    </div>
  );
}
