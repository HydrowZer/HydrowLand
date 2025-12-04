import { useState, useEffect } from "react";
import { peerService, type ConnectionQuality } from "../../services/peerService";

interface ConnectionIndicatorProps {
  isConnected: boolean;
}

export function ConnectionIndicator({ isConnected }: ConnectionIndicatorProps) {
  const [quality, setQuality] = useState<ConnectionQuality>({
    latency: 0,
    status: "disconnected",
  });

  useEffect(() => {
    if (!isConnected) {
      setQuality({ latency: 0, status: "disconnected" });
      return;
    }

    // Start ping interval
    peerService.startPingInterval();

    // Poll for quality updates
    const interval = setInterval(() => {
      setQuality(peerService.getConnectionQuality());
    }, 1000);

    return () => {
      clearInterval(interval);
      peerService.stopPingInterval();
    };
  }, [isConnected]);

  const getStatusColor = () => {
    switch (quality.status) {
      case "excellent":
        return "text-green-400";
      case "good":
        return "text-green-300";
      case "fair":
        return "text-yellow-400";
      case "poor":
        return "text-red-400";
      default:
        return "text-dark-500";
    }
  };

  const getBarCount = () => {
    switch (quality.status) {
      case "excellent":
        return 4;
      case "good":
        return 3;
      case "fair":
        return 2;
      case "poor":
        return 1;
      default:
        return 0;
    }
  };

  const barCount = getBarCount();

  return (
    <div className="flex items-center gap-2">
      {/* Signal bars */}
      <div className="flex items-end gap-0.5 h-4">
        {[1, 2, 3, 4].map((bar) => (
          <div
            key={bar}
            className={`w-1 rounded-sm transition-colors ${
              bar <= barCount ? getStatusColor().replace("text-", "bg-") : "bg-dark-600"
            }`}
            style={{ height: `${bar * 25}%` }}
          />
        ))}
      </div>

      {/* Latency text */}
      {quality.status !== "disconnected" && quality.latency > 0 && (
        <span className={`text-xs font-mono ${getStatusColor()}`}>
          {quality.latency}ms
        </span>
      )}
    </div>
  );
}
