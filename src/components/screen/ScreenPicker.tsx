import { useState, useEffect, useCallback } from "react";
import {
  screenListSources,
  screenSelectMonitor,
  screenSelectWindow,
  screenCapturePreview,
  screenCheckPermission,
  screenRequestPermission,
  type CaptureSourceInfo,
} from "../../services/tauriApi";

interface ScreenPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (source: CaptureSourceInfo) => void;
}

export function ScreenPicker({ isOpen, onClose, onSelect }: ScreenPickerProps) {
  const [sources, setSources] = useState<CaptureSourceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<CaptureSourceInfo | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<"monitors" | "windows">("monitors");

  const loadSources = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const allSources = await screenListSources(false);
      setSources(allSources);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const checkPermission = useCallback(async () => {
    try {
      const granted = await screenCheckPermission();
      setHasPermission(granted);
      if (granted) {
        loadSources();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [loadSources]);

  const requestPermission = useCallback(async () => {
    try {
      const granted = await screenRequestPermission();
      setHasPermission(granted);
      if (granted) {
        loadSources();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [loadSources]);

  useEffect(() => {
    if (isOpen) {
      checkPermission();
    }
  }, [isOpen, checkPermission]);

  const handleSourceSelect = async (source: CaptureSourceInfo) => {
    setSelectedSource(source);
    setPreviewLoading(true);
    setPreview(null);

    try {
      // Select the source in backend
      if (source.type === "Monitor") {
        await screenSelectMonitor(source.id);
      } else {
        await screenSelectWindow(source.id);
      }

      // Get preview
      const previewData = await screenCapturePreview(400);
      setPreview(previewData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleConfirm = () => {
    if (selectedSource) {
      onSelect(selectedSource);
      onClose();
    }
  };

  const monitors = sources.filter((s) => s.type === "Monitor");
  const windows = sources.filter((s) => s.type === "Window");

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 rounded-lg shadow-xl w-[700px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-700">
          <h2 className="text-lg font-semibold text-white">Share Screen</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Permission Request */}
        {hasPermission === false && (
          <div className="p-6 text-center">
            <div className="text-yellow-400 mb-4">
              <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="text-white text-lg font-medium mb-2">Screen Recording Permission Required</h3>
            <p className="text-zinc-400 mb-4">
              HydrowLand needs permission to capture your screen. Please grant access in System Preferences.
            </p>
            <button
              onClick={requestPermission}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
            >
              Request Permission
            </button>
          </div>
        )}

        {/* Loading */}
        {hasPermission === null && (
          <div className="p-6 text-center text-zinc-400">
            <div className="animate-spin w-8 h-8 border-2 border-zinc-600 border-t-blue-500 rounded-full mx-auto mb-4" />
            Checking permissions...
          </div>
        )}

        {/* Main Content */}
        {hasPermission === true && (
          <>
            {/* Tabs */}
            <div className="flex border-b border-zinc-700">
              <button
                onClick={() => setActiveTab("monitors")}
                className={`flex-1 py-3 px-4 text-sm font-medium transition-colors ${
                  activeTab === "monitors"
                    ? "text-blue-400 border-b-2 border-blue-400"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                Screens ({monitors.length})
              </button>
              <button
                onClick={() => setActiveTab("windows")}
                className={`flex-1 py-3 px-4 text-sm font-medium transition-colors ${
                  activeTab === "windows"
                    ? "text-blue-400 border-b-2 border-blue-400"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                Windows ({windows.length})
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden flex">
              {/* Source List */}
              <div className="w-1/2 border-r border-zinc-700 overflow-y-auto p-4">
                {loading ? (
                  <div className="text-center text-zinc-400 py-8">
                    <div className="animate-spin w-6 h-6 border-2 border-zinc-600 border-t-blue-500 rounded-full mx-auto mb-2" />
                    Loading sources...
                  </div>
                ) : error ? (
                  <div className="text-center text-red-400 py-8">
                    <p>{error}</p>
                    <button
                      onClick={loadSources}
                      className="mt-2 text-blue-400 hover:text-blue-300"
                    >
                      Retry
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {activeTab === "monitors" &&
                      monitors.map((source) => (
                        <SourceItem
                          key={`monitor-${source.id}`}
                          source={source}
                          isSelected={
                            selectedSource?.type === "Monitor" &&
                            selectedSource.id === source.id
                          }
                          onClick={() => handleSourceSelect(source)}
                        />
                      ))}
                    {activeTab === "windows" &&
                      windows.map((source) => (
                        <SourceItem
                          key={`window-${source.id}`}
                          source={source}
                          isSelected={
                            selectedSource?.type === "Window" &&
                            selectedSource.id === source.id
                          }
                          onClick={() => handleSourceSelect(source)}
                        />
                      ))}
                    {activeTab === "monitors" && monitors.length === 0 && (
                      <p className="text-zinc-500 text-center py-4">No monitors found</p>
                    )}
                    {activeTab === "windows" && windows.length === 0 && (
                      <p className="text-zinc-500 text-center py-4">No windows found</p>
                    )}
                  </div>
                )}
              </div>

              {/* Preview */}
              <div className="w-1/2 p-4 flex flex-col">
                <h3 className="text-sm font-medium text-zinc-400 mb-2">Preview</h3>
                <div className="flex-1 bg-zinc-800 rounded-lg overflow-hidden flex items-center justify-center">
                  {previewLoading ? (
                    <div className="text-zinc-400">
                      <div className="animate-spin w-6 h-6 border-2 border-zinc-600 border-t-blue-500 rounded-full mx-auto mb-2" />
                      Loading preview...
                    </div>
                  ) : preview ? (
                    <img
                      src={`data:image/png;base64,${preview}`}
                      alt="Preview"
                      className="max-w-full max-h-full object-contain"
                    />
                  ) : (
                    <p className="text-zinc-500">Select a source to preview</p>
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between p-4 border-t border-zinc-700">
              <button
                onClick={loadSources}
                className="text-zinc-400 hover:text-white transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-zinc-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={!selectedSource}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg transition-colors"
                >
                  Share
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface SourceItemProps {
  source: CaptureSourceInfo;
  isSelected: boolean;
  onClick: () => void;
}

function SourceItem({ source, isSelected, onClick }: SourceItemProps) {
  const isMonitor = source.type === "Monitor";

  return (
    <button
      onClick={onClick}
      className={`w-full p-3 rounded-lg text-left transition-colors ${
        isSelected
          ? "bg-blue-600/20 border border-blue-500"
          : "bg-zinc-800 hover:bg-zinc-700 border border-transparent"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded ${isMonitor ? "bg-purple-600/20" : "bg-green-600/20"}`}>
          {isMonitor ? (
            <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-medium truncate">
            {isMonitor
              ? source.name || `Display ${source.id + 1}`
              : source.title}
          </p>
          <p className="text-zinc-400 text-sm truncate">
            {isMonitor
              ? `${source.width}x${source.height}${source.is_primary ? " (Primary)" : ""}`
              : source.app_name}
          </p>
        </div>
      </div>
    </button>
  );
}
