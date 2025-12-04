import { useState, useEffect } from "react";
import * as api from "../../services/tauriApi";

interface VoiceControlsProps {
  isConnected: boolean;
}

export function VoiceControls({ isConnected }: VoiceControlsProps) {
  const [isMuted, setIsMuted] = useState(true);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [masterVolume, setMasterVolume] = useState(100);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [inputDevices, setInputDevices] = useState<string[]>([]);
  const [outputDevices, setOutputDevices] = useState<string[]>([]);
  const [showDevices, setShowDevices] = useState(false);

  // Initialize audio on mount
  useEffect(() => {
    const init = async () => {
      try {
        await api.audioInit();
        const muted = await api.audioIsMuted();
        setIsMuted(muted);
        const volume = await api.audioGetMasterVolume();
        setMasterVolume(Math.round(volume * 100));
      } catch (e) {
        console.error("Failed to initialize audio:", e);
      }
    };
    init();

    return () => {
      api.audioCleanup().catch(console.error);
    };
  }, []);

  // Load audio devices
  useEffect(() => {
    const loadDevices = async () => {
      try {
        const [inputs, outputs] = await Promise.all([
          api.audioListInputDevices(),
          api.audioListOutputDevices(),
        ]);
        setInputDevices(inputs);
        setOutputDevices(outputs);
      } catch (e) {
        console.error("Failed to load audio devices:", e);
      }
    };
    loadDevices();
  }, []);

  const toggleMute = async () => {
    try {
      const newMuted = !isMuted;
      await api.audioSetMute(newMuted);
      setIsMuted(newMuted);

      if (!newMuted && !isVoiceActive) {
        await api.audioStartVoice();
        setIsVoiceActive(true);
      }
    } catch (e) {
      console.error("Failed to toggle mute:", e);
    }
  };

  const handleVolumeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value);
    setMasterVolume(value);
    try {
      await api.audioSetMasterVolume(value / 100);
    } catch (e) {
      console.error("Failed to set volume:", e);
    }
  };

  return (
    <div className="bg-dark-800 border-t border-dark-700 p-4 flex items-center justify-center gap-4">
      {/* Mute/Unmute Button */}
      <div className="relative">
        <button
          onClick={toggleMute}
          disabled={!isConnected}
          className={`p-3 rounded-full transition ${
            !isConnected
              ? "bg-dark-700 text-dark-500 cursor-not-allowed"
              : isMuted
              ? "bg-red-600 hover:bg-red-700 text-white"
              : "bg-green-600 hover:bg-green-700 text-white"
          }`}
          title={isMuted ? "Activer le micro" : "Couper le micro"}
        >
          {isMuted ? (
            // Muted icon (with slash)
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
              <line
                x1="3"
                y1="3"
                x2="21"
                y2="21"
                stroke="currentColor"
                strokeWidth="2.5"
              />
            </svg>
          ) : (
            // Unmuted icon
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
            </svg>
          )}
        </button>
      </div>

      {/* Volume Control */}
      <div className="relative">
        <button
          onClick={() => setShowVolumeSlider(!showVolumeSlider)}
          disabled={!isConnected}
          className={`p-3 rounded-full transition ${
            !isConnected
              ? "bg-dark-700 text-dark-500 cursor-not-allowed"
              : "bg-dark-700 hover:bg-dark-600 text-white"
          }`}
          title="Volume"
        >
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
            {masterVolume === 0 ? (
              <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
            ) : masterVolume < 50 ? (
              <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
            ) : (
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
            )}
          </svg>
        </button>

        {/* Volume Slider Popup */}
        {showVolumeSlider && isConnected && (
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 p-3 bg-dark-700 rounded-lg shadow-lg">
            <input
              type="range"
              min="0"
              max="100"
              value={masterVolume}
              onChange={handleVolumeChange}
              className="w-24 h-2 bg-dark-600 rounded-lg appearance-none cursor-pointer accent-primary-500"
            />
            <div className="text-center text-xs text-dark-300 mt-1">
              {masterVolume}%
            </div>
          </div>
        )}
      </div>

      {/* Audio Devices Button */}
      <div className="relative">
        <button
          onClick={() => setShowDevices(!showDevices)}
          disabled={!isConnected}
          className={`p-3 rounded-full transition ${
            !isConnected
              ? "bg-dark-700 text-dark-500 cursor-not-allowed"
              : "bg-dark-700 hover:bg-dark-600 text-white"
          }`}
          title="Peripheriques audio"
        >
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>

        {/* Devices Popup */}
        {showDevices && isConnected && (
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 p-4 bg-dark-700 rounded-lg shadow-lg min-w-[250px]">
            <div className="mb-3">
              <h4 className="text-xs font-semibold text-dark-400 uppercase mb-2">
                Microphone
              </h4>
              {inputDevices.length > 0 ? (
                <select className="w-full bg-dark-600 text-white text-sm rounded px-2 py-1 border border-dark-500">
                  {inputDevices.map((device, i) => (
                    <option key={i} value={device}>
                      {device}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-dark-400 text-sm">Aucun micro detecte</p>
              )}
            </div>

            <div>
              <h4 className="text-xs font-semibold text-dark-400 uppercase mb-2">
                Sortie audio
              </h4>
              {outputDevices.length > 0 ? (
                <select className="w-full bg-dark-600 text-white text-sm rounded px-2 py-1 border border-dark-500">
                  {outputDevices.map((device, i) => (
                    <option key={i} value={device}>
                      {device}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-dark-400 text-sm">
                  Aucune sortie detectee
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Screen Share Placeholder */}
      <button
        className="p-3 rounded-full bg-dark-700 text-dark-500 cursor-not-allowed"
        disabled
        title="Partage d'ecran - bientot disponible"
      >
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
      </button>

      {/* Connection Status */}
      {!isConnected && (
        <span className="text-dark-500 text-sm ml-2">
          Connectez-vous pour activer l'audio
        </span>
      )}
    </div>
  );
}
