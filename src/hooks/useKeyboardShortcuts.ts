import { useEffect, useCallback } from "react";

interface KeyboardShortcuts {
  onToggleMute?: () => void;
  onToggleScreenShare?: () => void;
  onToggleDeafen?: () => void;
  enabled?: boolean;
}

/**
 * Hook for global keyboard shortcuts
 * - M: Toggle mute
 * - S: Toggle screen share
 * - D: Toggle deafen (future)
 */
export function useKeyboardShortcuts({
  onToggleMute,
  onToggleScreenShare,
  onToggleDeafen,
  enabled = true,
}: KeyboardShortcuts) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in input fields
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      // Don't trigger if modifier keys are pressed (except for specific combos)
      if (event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }

      switch (event.key.toLowerCase()) {
        case "m":
          event.preventDefault();
          onToggleMute?.();
          break;
        case "s":
          event.preventDefault();
          onToggleScreenShare?.();
          break;
        case "d":
          event.preventDefault();
          onToggleDeafen?.();
          break;
      }
    },
    [onToggleMute, onToggleScreenShare, onToggleDeafen]
  );

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown, enabled]);
}
