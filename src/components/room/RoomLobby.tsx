import { useState } from "react";
import { useRoomStore } from "../../stores/roomStore";
import * as api from "../../services/tauriApi";

export function RoomLobby() {
  const [joinCode, setJoinCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { username, setRoom, setLocalParticipant } = useRoomStore();

  const handleCreateRoom = async () => {
    if (!username) return;
    setIsLoading(true);
    setError(null);

    try {
      const room = await api.createRoom(username);
      setRoom(room);
      const localP = room.participants.find((p) => p.is_host);
      if (localP) setLocalParticipant(localP);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !joinCode.trim()) return;
    setIsLoading(true);
    setError(null);

    try {
      const room = await api.joinRoom(joinCode.trim().toUpperCase(), username);
      setRoom(room);
      const localP = room.participants.find((p) => !p.is_host);
      if (localP) setLocalParticipant(localP);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-900">
      <div className="bg-dark-800 p-8 rounded-2xl shadow-xl w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">HydrowLand</h1>
          <p className="text-dark-400">
            Salut <span className="text-primary-400">{username}</span> !
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-6">
          {/* Create Room */}
          <button
            onClick={handleCreateRoom}
            disabled={isLoading}
            className="w-full py-4 px-4 bg-primary-600 hover:bg-primary-700 disabled:bg-dark-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition flex items-center justify-center gap-2"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            Creer une room
          </button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-dark-600"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-dark-800 text-dark-500">ou</span>
            </div>
          </div>

          {/* Join Room */}
          <form onSubmit={handleJoinRoom} className="space-y-4">
            <div>
              <label
                htmlFor="code"
                className="block text-sm font-medium text-dark-300 mb-2"
              >
                Code de la room
              </label>
              <input
                type="text"
                id="code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="ABC123"
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
