import { useState, useEffect } from "react";
import { useServerStore } from "../../stores/serverStore";
import * as api from "../../services/tauriApi";

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
    <div className="min-h-screen flex items-center justify-center bg-dark-900">
      <div className="bg-dark-800 p-8 rounded-2xl shadow-xl w-full max-w-md">
        {/* Header avec pseudo éditable */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-4">HydrowLand</h1>

          <div className="flex items-center justify-center gap-2">
            <span className="text-dark-400">Pseudo :</span>
            {isEditingName ? (
              <input
                type="text"
                value={tempName}
                onChange={(e) => setTempName(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => e.key === "Enter" && saveName()}
                className="px-2 py-1 bg-dark-700 border border-dark-600 rounded text-white text-center w-32"
                autoFocus
                maxLength={20}
              />
            ) : (
              <button
                onClick={startEditingName}
                className="text-primary-400 hover:text-primary-300 font-medium"
              >
                {username}
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-6">
          {/* Mon serveur */}
          <div className="bg-dark-700/50 p-4 rounded-lg">
            <div className="flex items-center justify-between mb-3">
              <span className="text-dark-300 text-sm">Mon serveur</span>
              <span className="font-mono text-xl text-white tracking-widest">
                {myServerCode || "..."}
              </span>
            </div>
            <button
              onClick={handleHost}
              disabled={isLoading}
              className="w-full py-3 px-4 bg-primary-600 hover:bg-primary-700 disabled:bg-dark-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              Héberger
            </button>
            <p className="text-dark-500 text-xs mt-2 text-center">
              Tes amis peuvent rejoindre avec ce code
            </p>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-dark-600"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-dark-800 text-dark-500">ou</span>
            </div>
          </div>

          {/* Rejoindre un serveur */}
          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <label htmlFor="code" className="block text-sm font-medium text-dark-300 mb-2">
                Rejoindre un ami
              </label>
              <input
                type="text"
                id="code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="CODE"
                className="w-full px-4 py-3 bg-dark-700 border border-dark-600 rounded-lg text-white placeholder-dark-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition text-center text-xl tracking-widest font-mono"
                maxLength={6}
              />
            </div>

            <button
              type="submit"
              disabled={isLoading || joinCode.length !== 6}
              className="w-full py-3 px-4 bg-dark-700 hover:bg-dark-600 disabled:bg-dark-700 disabled:text-dark-500 disabled:cursor-not-allowed text-white font-medium rounded-lg border border-dark-600 transition"
            >
              Rejoindre
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
