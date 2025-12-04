import { useState } from "react";
import { ScreenPicker } from "./ScreenPicker";
import {
  screenStartSharing,
  screenStopSharing,
  screenClearSelection,
  type CaptureSourceInfo,
} from "../../services/tauriApi";

interface ScreenShareButtonProps {
  isSharing: boolean;
  onSharingChange: (sharing: boolean, source?: CaptureSourceInfo) => void;
}

export function ScreenShareButton({ isSharing, onSharingChange }: ScreenShareButtonProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleClick = async () => {
    if (isSharing) {
      // Stop sharing
      try {
        await screenStopSharing();
        await screenClearSelection();
        onSharingChange(false);
      } catch (err) {
        console.error("Failed to stop sharing:", err);
      }
    } else {
      // Open picker to start sharing
      setPickerOpen(true);
    }
  };

  const handleSourceSelect = async (source: CaptureSourceInfo) => {
    try {
      await screenStartSharing();
      onSharingChange(true, source);
    } catch (err) {
      console.error("Failed to start sharing:", err);
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        className={`p-3 rounded-full transition-colors ${
          isSharing
            ? "bg-green-600 hover:bg-green-700 text-white"
            : "bg-zinc-700 hover:bg-zinc-600 text-zinc-300"
        }`}
        title={isSharing ? "Stop sharing" : "Share screen"}
      >
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          {isSharing ? (
            // Stop icon when sharing
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
            />
          ) : (
            // Screen share icon
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          )}
        </svg>
      </button>

      <ScreenPicker
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handleSourceSelect}
      />
    </>
  );
}
