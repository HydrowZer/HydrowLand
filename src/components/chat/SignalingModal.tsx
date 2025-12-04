import { useState } from "react";
import * as api from "../../services/tauriApi";
import { useServerStore } from "../../stores/serverStore";

interface SignalingModalProps {
  isHost: boolean;
  onConnected: () => void;
  onClose: () => void;
}

export function SignalingModal({ isHost, onConnected, onClose }: SignalingModalProps) {
  const { username } = useServerStore();
  const [step, setStep] = useState<"generate" | "waiting" | "paste">(
    isHost ? "generate" : "paste"
  );
  const [offer, setOffer] = useState("");
  const [remoteData, setRemoteData] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const generateOffer = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.createWebRTCOffer(username || "Anonymous");
      setOffer(result.sdp_base64);
      setStep("waiting");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const acceptRemoteOffer = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.acceptWebRTCOffer(remoteData.trim(), username || "Anonymous");
      setOffer(result.sdp_base64);
      setStep("waiting");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const acceptAnswer = async () => {
    setLoading(true);
    setError("");
    try {
      await api.acceptWebRTCAnswer(remoteData.trim());
      onConnected();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(offer);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-dark-800 rounded-xl p-6 max-w-lg w-full mx-4 shadow-xl">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-white">
            {isHost ? "Inviter un ami" : "Rejoindre la room"}
          </h2>
          <button
            onClick={onClose}
            className="text-dark-400 hover:text-white transition"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="bg-red-900/50 text-red-200 p-3 rounded-lg mb-4 text-sm">
            {error}
          </div>
        )}

        {isHost ? (
          // Host flow
          <>
            {step === "generate" && (
              <div className="space-y-4">
                <p className="text-dark-300 text-sm">
                  Genere un code de connexion a partager avec ton ami.
                </p>
                <button
                  onClick={generateOffer}
                  disabled={loading}
                  className="w-full py-3 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg transition disabled:opacity-50"
                >
                  {loading ? "Generation..." : "Generer le code"}
                </button>
              </div>
            )}

            {step === "waiting" && (
              <div className="space-y-4">
                <p className="text-dark-300 text-sm">
                  1. Copie ce code et envoie-le a ton ami (Discord, SMS, etc.)
                </p>
                <div className="relative">
                  <textarea
                    readOnly
                    value={offer}
                    className="w-full h-24 bg-dark-900 text-white text-xs font-mono p-3 rounded-lg resize-none"
                  />
                  <button
                    onClick={copyToClipboard}
                    className="absolute top-2 right-2 p-2 bg-dark-700 hover:bg-dark-600 rounded-lg transition"
                    title="Copier"
                  >
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>

                <p className="text-dark-300 text-sm">
                  2. Colle la reponse de ton ami ici:
                </p>
                <textarea
                  value={remoteData}
                  onChange={(e) => setRemoteData(e.target.value)}
                  placeholder="Colle la reponse ici..."
                  className="w-full h-24 bg-dark-900 text-white text-xs font-mono p-3 rounded-lg resize-none placeholder-dark-500"
                />
                <button
                  onClick={acceptAnswer}
                  disabled={loading || !remoteData.trim()}
                  className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition disabled:opacity-50"
                >
                  {loading ? "Connexion..." : "Se connecter"}
                </button>
              </div>
            )}
          </>
        ) : (
          // Joiner flow
          <>
            {step === "paste" && (
              <div className="space-y-4">
                <p className="text-dark-300 text-sm">
                  1. Colle le code de connexion de l'hote:
                </p>
                <textarea
                  value={remoteData}
                  onChange={(e) => setRemoteData(e.target.value)}
                  placeholder="Colle le code de connexion ici..."
                  className="w-full h-24 bg-dark-900 text-white text-xs font-mono p-3 rounded-lg resize-none placeholder-dark-500"
                />
                <button
                  onClick={acceptRemoteOffer}
                  disabled={loading || !remoteData.trim()}
                  className="w-full py-3 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg transition disabled:opacity-50"
                >
                  {loading ? "Generation..." : "Generer ma reponse"}
                </button>
              </div>
            )}

            {step === "waiting" && (
              <div className="space-y-4">
                <p className="text-dark-300 text-sm">
                  2. Copie ce code et envoie-le a l'hote:
                </p>
                <div className="relative">
                  <textarea
                    readOnly
                    value={offer}
                    className="w-full h-24 bg-dark-900 text-white text-xs font-mono p-3 rounded-lg resize-none"
                  />
                  <button
                    onClick={copyToClipboard}
                    className="absolute top-2 right-2 p-2 bg-dark-700 hover:bg-dark-600 rounded-lg transition"
                    title="Copier"
                  >
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>
                <p className="text-dark-300 text-sm">
                  Une fois que l'hote a entre ta reponse, la connexion s'etablira automatiquement.
                </p>
                <button
                  onClick={onConnected}
                  className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition"
                >
                  C'est fait !
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
