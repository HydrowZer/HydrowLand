import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

interface AudioLevelMeterProps {
  /** Unique identifier for the audio source (peer_id or "local") */
  sourceId: string;
  /** Audio level 0.0-1.0 */
  level: number;
  /** Whether this source is currently speaking */
  isSpeaking?: boolean;
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Orientation */
  orientation?: "horizontal" | "vertical";
  /** Show label */
  showLabel?: boolean;
  /** Label text */
  label?: string;
}

/**
 * Audio level meter component for visual feedback
 * Shows audio level as animated bars
 */
export function AudioLevelMeter({
  sourceId: _sourceId,
  level,
  isSpeaking = false,
  size = "md",
  orientation = "horizontal",
  showLabel = false,
  label,
}: AudioLevelMeterProps) {
  const [animatedLevel, setAnimatedLevel] = useState(0);
  const rafRef = useRef<number>();

  // Smooth animation for level changes
  useEffect(() => {
    const animate = () => {
      setAnimatedLevel((prev) => {
        const diff = level - prev;
        // Rise fast, fall slow
        const speed = diff > 0 ? 0.3 : 0.1;
        const newLevel = prev + diff * speed;
        return Math.abs(diff) < 0.01 ? level : newLevel;
      });
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [level]);

  // Size configurations
  const sizes = {
    sm: { bars: 4, barWidth: 2, barHeight: 8, gap: 1 },
    md: { bars: 5, barWidth: 3, barHeight: 16, gap: 2 },
    lg: { bars: 8, barWidth: 4, barHeight: 24, gap: 2 },
  };

  const config = sizes[size];

  // Generate bars
  const bars = Array.from({ length: config.bars }, (_, i) => {
    const threshold = (i + 1) / config.bars;
    const isActive = animatedLevel >= threshold;
    const isPartial = !isActive && animatedLevel > (i / config.bars);
    const partialHeight = isPartial
      ? ((animatedLevel - (i / config.bars)) / (1 / config.bars)) * 100
      : 0;

    // Color gradient from green to yellow to red
    let color = "bg-green-500";
    if (threshold > 0.8) {
      color = "bg-red-500";
    } else if (threshold > 0.6) {
      color = "bg-yellow-500";
    }

    return (
      <div
        key={i}
        className={`rounded-sm transition-all duration-75 ${
          orientation === "vertical" ? "w-full" : "h-full"
        }`}
        style={{
          [orientation === "vertical" ? "height" : "width"]: config.barWidth,
          [orientation === "vertical" ? "width" : "height"]: config.barHeight,
        }}
      >
        <div
          className={`rounded-sm transition-colors duration-75 ${
            isActive ? color : isPartial ? color : "bg-dark-600"
          }`}
          style={{
            [orientation === "vertical" ? "height" : "width"]: isActive
              ? "100%"
              : isPartial
              ? `${partialHeight}%`
              : "100%",
            [orientation === "vertical" ? "width" : "height"]: "100%",
            opacity: isActive ? 1 : isPartial ? 0.6 : 0.3,
          }}
        />
      </div>
    );
  });

  return (
    <div className="flex items-center gap-2">
      {showLabel && label && (
        <span
          className={`text-xs truncate max-w-[80px] ${
            isSpeaking ? "text-green-400 font-medium" : "text-dark-400"
          }`}
        >
          {label}
        </span>
      )}

      <div
        className={`flex items-end ${
          orientation === "vertical" ? "flex-col" : "flex-row"
        }`}
        style={{ gap: config.gap }}
      >
        {bars}
      </div>

      {/* Speaking indicator dot */}
      {isSpeaking && (
        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
      )}
    </div>
  );
}

/**
 * Compact audio indicator for participant lists
 */
interface AudioIndicatorProps {
  level: number;
  isMuted?: boolean;
  isSpeaking?: boolean;
}

export function AudioIndicator({
  level,
  isMuted = false,
  isSpeaking = false,
}: AudioIndicatorProps) {
  if (isMuted) {
    return (
      <div className="w-4 h-4 rounded-full bg-red-600/20 flex items-center justify-center">
        <svg
          className="w-3 h-3 text-red-500"
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
          <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="2" />
        </svg>
      </div>
    );
  }

  // Dynamic ring based on audio level
  const ringOpacity = Math.min(level * 2, 1);
  const ringScale = 1 + level * 0.3;

  return (
    <div className="relative w-4 h-4">
      {/* Pulsing ring when speaking */}
      {isSpeaking && (
        <div
          className="absolute inset-0 rounded-full bg-green-500/30 animate-ping"
          style={{
            transform: `scale(${ringScale})`,
            opacity: ringOpacity,
          }}
        />
      )}

      {/* Base indicator */}
      <div
        className={`w-4 h-4 rounded-full transition-colors duration-150 ${
          isSpeaking ? "bg-green-500" : level > 0.1 ? "bg-green-600/50" : "bg-dark-600"
        }`}
      />
    </div>
  );
}

/**
 * Hook for calculating audio level from samples
 */
export function useAudioLevel() {
  const calculateLevel = async (samples: number[]): Promise<number> => {
    try {
      return await invoke<number>("audio_mesh_calculate_level", { samples });
    } catch (e) {
      console.error("Failed to calculate audio level:", e);
      return 0;
    }
  };

  const isSpeaking = async (samples: number[]): Promise<boolean> => {
    try {
      return await invoke<boolean>("audio_mesh_is_speaking", { samples });
    } catch (e) {
      console.error("Failed to check speaking:", e);
      return false;
    }
  };

  return { calculateLevel, isSpeaking };
}
