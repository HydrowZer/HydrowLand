import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import * as api from "../../services/tauriApi";
import { AudioLevelMeter } from "./AudioLevelMeter";
import { ScreenShareButton } from "../screen/ScreenShareButton";
import type { CaptureSourceInfo } from "../../services/tauriApi";

interface AudioLevelEvent {
  level: number;
  is_speaking: boolean;
  rms: number;
}

interface VoiceControlsProps {
  isConnected: boolean;
}

export function VoiceControls({ isConnected }: VoiceControlsProps) {
  const [isMuted, setIsMuted] = useState(true);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [masterVolume, setMasterVolume] = useState(100);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [inputDevices, setInputDevices] = useState<string[]>([]);
  const [outputDevices, setOutputDevices] = useState<string[]>([]);
  const [showDevices, setShowDevices] = useState(false);
  const [selectedInputDevice, setSelectedInputDevice] = useState<string>("");
  const [selectedOutputDevice, setSelectedOutputDevice] = useState<string>("");
  const [noiseSuppressionEnabled, setNoiseSuppressionEnabled] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  // Note: screenShareSource will be used in Phase 8 for WebRTC video track
  const [_screenShareSource, setScreenShareSource] = useState<CaptureSourceInfo | null>(null);

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

  // Listen for audio level events from the backend
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await listen<AudioLevelEvent>("audio-level", (event) => {
        setAudioLevel(event.payload.level);
        setIsSpeaking(event.payload.is_speaking);
      });
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  // Load audio devices and get currently selected device
  useEffect(() => {
    const loadDevices = async () => {
      try {
        const [inputs, outputs, currentInput, noiseSuppressionState] = await Promise.all([
          api.audioListInputDevices(),
          api.audioListOutputDevices(),
          api.audioGetInputDevice(),
          api.audioIsNoiseSuppressionEnabled(),
        ]);
        setInputDevices(inputs);
        setOutputDevices(outputs);
        setNoiseSuppressionEnabled(noiseSuppressionState);
        // Set selected input device (empty string means default)
        if (currentInput && inputs.includes(currentInput)) {
          setSelectedInputDevice(currentInput);
        } else if (inputs.length > 0) {
          setSelectedInputDevice(inputs[0]);
        }
        // For output, just select the first one as default for now
        if (outputs.length > 0) {
          setSelectedOutputDevice(outputs[0]);
        }
      } catch (e) {
        console.error("Failed to load audio devices:", e);
      }
    };
    loadDevices();
  }, []);

  const toggleMute = async () => {
    try {
      const newMuted = !isMuted;

      // Start voice capture if not already active
      if (!isVoiceActive) {
        await api.audioStartVoice();
        setIsVoiceActive(true);
      }

      await api.audioSetMute(newMuted);
      setIsMuted(newMuted);

      if (newMuted) {
        setAudioLevel(0);
        setIsSpeaking(false);
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

  const handleInputDeviceChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const deviceName = e.target.value;
    setSelectedInputDevice(deviceName);
    try {
      // Pass null for first device (default), otherwise the device name
      await api.audioSetInputDevice(deviceName || null);
      console.log("Input device changed to:", deviceName || "default");
    } catch (e) {
      console.error("Failed to change input device:", e);
    }
  };

  const handleOutputDeviceChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const deviceName = e.target.value;
    setSelectedOutputDevice(deviceName);
    // Note: Output device selection is not yet implemented in the backend
    // This just updates the UI state for now
    console.log("Output device selected:", deviceName);
  };

  const handleNoiseSuppressionToggle = async () => {
    const newState = !noiseSuppressionEnabled;
    setNoiseSuppressionEnabled(newState);
    try {
      await api.audioSetNoiseSuppression(newState);
      console.log("Noise suppression:", newState ? "enabled" : "disabled");
    } catch (e) {
      console.error("Failed to toggle noise suppression:", e);
      // Revert on error
      setNoiseSuppressionEnabled(!newState);
    }
  };

  return (
    <div className="bg-dark-800 border-t border-dark-700 p-4 flex items-center justify-center gap-4">
      {/* Audio Level Meter */}
      <div className="flex items-center gap-2">
        <AudioLevelMeter
          sourceId="local"
          level={audioLevel}
          isSpeaking={isSpeaking}
          size="md"
          orientation="horizontal"
        />
      </div>

      {/* Mute/Unmute Button */}
      <div className="relative">
        <button
          onClick={toggleMute}
          disabled={!isConnected}
          className={`p-3 rounded-full transition relative ${
            !isConnected
              ? "bg-dark-700 text-dark-500 cursor-not-allowed"
              : isMuted
              ? "bg-red-600 hover:bg-red-700 text-white"
              : "bg-green-600 hover:bg-green-700 text-white"
          }`}
          title={isMuted ? "Activer le micro" : "Couper le micro"}
        >
          {/* Speaking indicator ring */}
          {!isMuted && isSpeaking && (
            <span className="absolute inset-0 rounded-full animate-ping bg-green-400 opacity-30" />
          )}

          {isMuted ? (
            // Muted icon (with slash)
            <svg className="w-6 h-6 relative z-10" fill="currentColor" viewBox="0 0 24 24">
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
            <svg className="w-6 h-6 relative z-10" fill="currentColor" viewBox="0 0 24 24">
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
                <select
                  className="w-full bg-dark-600 text-white text-sm rounded px-2 py-1 border border-dark-500"
                  value={selectedInputDevice}
                  onChange={handleInputDeviceChange}
                >
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
                <select
                  className="w-full bg-dark-600 text-white text-sm rounded px-2 py-1 border border-dark-500"
                  value={selectedOutputDevice}
                  onChange={handleOutputDeviceChange}
                >
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

            {/* Noise Suppression Toggle */}
            <div className="mt-3 pt-3 border-t border-dark-600">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-xs font-semibold text-dark-400 uppercase">
                  Reduction du bruit
                </span>
                <button
                  onClick={handleNoiseSuppressionToggle}
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    noiseSuppressionEnabled ? "bg-primary-500" : "bg-dark-500"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                      noiseSuppressionEnabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Screen Share Button */}
      <ScreenShareButton
        isSharing={isScreenSharing}
        onSharingChange={(sharing, source) => {
          setIsScreenSharing(sharing);
          setScreenShareSource(source || null);
          if (sharing && source) {
            console.log("Started sharing:", source.type === "Monitor" ? `Monitor ${source.id}` : source.title);
          } else {
            console.log("Stopped sharing");
          }
        }}
      />

      {/* Connection Status */}
      {!isConnected && (
        <span className="text-dark-500 text-sm ml-2">
          Connectez-vous pour activer l'audio
        </span>
      )}
    </div>
  );
}
