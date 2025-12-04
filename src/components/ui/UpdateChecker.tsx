import { useState, useEffect, useCallback } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { ask } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";

type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "ready" | "error";

export function UpdateChecker() {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [showBanner, setShowBanner] = useState(false);

  const checkForUpdates = useCallback(async () => {
    try {
      setStatus("checking");
      setError(null);

      const updateInfo = await check();

      if (updateInfo) {
        setUpdate(updateInfo);
        setStatus("available");
        setShowBanner(true);
      } else {
        setStatus("idle");
      }
    } catch (err) {
      console.error("Update check failed:", err);
      setError(String(err));
      setStatus("error");
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (!update) return;

    try {
      setStatus("downloading");
      setProgress(0);

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            console.log("Download started, total:", event.data.contentLength);
            break;
          case "Progress":
            const percent = Math.round(
              ((event.data.chunkLength || 0) / (update.currentVersion.length || 1)) * 100
            );
            setProgress(Math.min(percent, 100));
            break;
          case "Finished":
            console.log("Download finished");
            break;
        }
      });

      setStatus("ready");

      const shouldRelaunch = await ask(
        "La mise à jour a été installée. Voulez-vous redémarrer l'application maintenant ?",
        {
          title: "Mise à jour prête",
          kind: "info",
        }
      );

      if (shouldRelaunch) {
        await relaunch();
      }
    } catch (err) {
      console.error("Update download failed:", err);
      setError(String(err));
      setStatus("error");
    }
  }, [update]);

  // Check for updates on startup (with a small delay)
  useEffect(() => {
    const timer = setTimeout(() => {
      checkForUpdates();
    }, 3000);

    return () => clearTimeout(timer);
  }, [checkForUpdates]);

  // Don't show anything if no update or hidden
  if (!showBanner || status === "idle" || status === "checking") {
    return null;
  }

  return (
    <div className="fixed bottom-20 right-4 z-50 max-w-sm">
      <div className="bg-dark-800/95 backdrop-blur-sm border border-dark-700/50 rounded-xl shadow-lg p-4">
        {status === "available" && (
          <>
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-accent-500/20 flex items-center justify-center">
                <svg className="w-4 h-4 text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium text-white">Mise à jour disponible</h3>
                <p className="text-xs text-dark-400 mt-0.5">
                  Version {update?.version} est disponible
                </p>
              </div>
              <button
                onClick={() => setShowBanner(false)}
                className="text-dark-500 hover:text-dark-300 transition"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setShowBanner(false)}
                className="flex-1 px-3 py-1.5 text-xs text-dark-400 hover:text-white bg-dark-700 hover:bg-dark-600 rounded-lg transition"
              >
                Plus tard
              </button>
              <button
                onClick={downloadAndInstall}
                className="flex-1 px-3 py-1.5 text-xs text-white bg-accent-600 hover:bg-accent-500 rounded-lg transition"
              >
                Mettre à jour
              </button>
            </div>
          </>
        )}

        {status === "downloading" && (
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0">
              <svg className="w-5 h-5 text-accent-400 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm text-white">Téléchargement en cours...</p>
              <div className="w-full h-1.5 bg-dark-700 rounded-full mt-2 overflow-hidden">
                <div
                  className="h-full bg-accent-500 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {status === "ready" && (
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm text-white">Mise à jour prête !</p>
              <p className="text-xs text-dark-400">Redémarre l'app pour appliquer</p>
            </div>
            <button
              onClick={() => relaunch()}
              className="px-3 py-1.5 text-xs text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition"
            >
              Redémarrer
            </button>
          </div>
        )}

        {status === "error" && (
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white">Erreur de mise à jour</p>
              <p className="text-xs text-dark-400 mt-0.5 truncate">{error}</p>
            </div>
            <button
              onClick={() => setShowBanner(false)}
              className="text-dark-500 hover:text-dark-300 transition"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
