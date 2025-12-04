import { useState, useEffect } from "react";
import { useServerStore } from "../../stores/serverStore";
import * as api from "../../services/tauriApi";
import { ThemeToggle } from "../ui/ThemeToggle";

export function ServerLobby() {
  const [joinCode, setJoinCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [myServerCode, setMyServerCode] = useState<string | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState("");

  const { username, setUsername, setServerInfo } = useServerStore();

  // Charger le code serveur au démarrage
  useEffect(() => {
    api.getServerConfig(username).then((config) => {
      setMyServerCode(config.code);
    });
  }, [username]);

  const handleHost = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const info = await api.startHosting(username);
      setServerInfo(info);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      const info = await api.joinServer(joinCode.trim().toUpperCase(), username);
      setServerInfo(info);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  };

  const startEditingName = () => {
    setTempName(username);
    setIsEditingName(true);
  };

  const saveName = () => {
    if (tempName.trim()) {
      setUsername(tempName.trim());
      api.setUsername(tempName.trim());
    }
    setIsEditingName(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-900 relative">
      {/* Subtle gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-accent-900/10 via-dark-900 to-dark-900 pointer-events-none" />

      {/* Theme toggle in corner */}
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>

      <div className="relative z-10 w-full max-w-sm px-6">
        {/* Logo & Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-accent-500 to-accent-700 flex items-center justify-center shadow-glow">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">HydrowLand</h1>
          <p className="text-dark-400 text-sm mt-1">Chat vocal peer-to-peer</p>
        </div>

        {/* Username */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <span className="text-dark-500 text-sm">Connecté en tant que</span>
          {isEditingName ? (
            <input
              type="text"
              value={tempName}
              onChange={(e) => setTempName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => e.key === "Enter" && saveName()}
              className="px-2 py-1 bg-dark-800 border border-dark-700 rounded-lg text-white text-sm text-center w-28 focus:border-accent-500/50 focus:outline-none"
              autoFocus
              maxLength={20}
            />
          ) : (
            <button
              onClick={startEditingName}
              className="text-accent-400 hover:text-accent-300 font-medium text-sm transition"
            >
              {username}
            </button>
          )}
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-6 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-2">
            <svg className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        )}

        {/* Main card */}
        <div className="bg-dark-800/50 backdrop-blur-sm border border-dark-700/50 rounded-2xl p-6">
          {/* Host section */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-dark-400 text-sm">Ton serveur</span>
              <code className="font-mono text-lg text-white font-semibold tracking-widest">
                {myServerCode || "..."}
              </code>
            </div>
            <button
              onClick={handleHost}
              disabled={isLoading}
              className="w-full py-3 px-4 bg-accent-600 hover:bg-accent-500 disabled:bg-dark-700 disabled:text-dark-500 disabled:cursor-not-allowed text-white font-medium rounded-xl transition flex items-center justify-center gap-2 shadow-glow-sm hover:shadow-glow"
            >
              {isLoading ? (
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                  Héberger
                </>
              )}
            </button>
            <p className="text-dark-500 text-xs mt-2 text-center">
              Partage ce code avec tes amis
            </p>
          </div>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-dark-700/50" />
            </div>
            <div className="relative flex justify-center">
              <span className="px-3 bg-dark-800/50 text-dark-500 text-xs uppercase tracking-wider">ou</span>
            </div>
          </div>

          {/* Join section */}
          <form onSubmit={handleJoin}>
            <label htmlFor="code" className="block text-sm text-dark-400 mb-2">
              Rejoindre un ami
            </label>
            <input
              type="text"
              id="code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="CODE"
              className="w-full px-4 py-3 bg-dark-900 border border-dark-700/50 rounded-xl text-white placeholder-dark-600 focus:border-accent-500/50 focus:outline-none transition text-center text-xl tracking-[0.3em] font-mono"
              maxLength={6}
            />
            <button
              type="submit"
              disabled={isLoading || joinCode.length !== 6}
              className="w-full mt-3 py-3 px-4 bg-dark-700 hover:bg-dark-600 disabled:bg-dark-800 disabled:text-dark-600 disabled:cursor-not-allowed text-white font-medium rounded-xl border border-dark-600/50 transition"
            >
              Rejoindre
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-dark-600 text-xs mt-6">
          Connexion P2P sécurisée • Pas de serveur central
        </p>
      </div>
    </div>
  );
}
