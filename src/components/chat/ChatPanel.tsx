import { useState, useRef, useEffect } from "react";
import { useServerStore } from "../../stores/serverStore";
import { peerService } from "../../services/peerService";

interface ChatPanelProps {
  isConnected: boolean;
}

export function ChatPanel({ isConnected }: ChatPanelProps) {
  const { username, messages, addMessage } = useServerStore();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || !isConnected || sending) return;

    const content = input.trim();
    setInput("");
    setSending(true);

    try {
      // Envoyer via PeerJS
      peerService.sendChat(content);

      // Ajouter notre propre message à la liste
      addMessage({
        id: crypto.randomUUID(),
        senderId: "local",
        senderName: username,
        content,
        timestamp: Date.now(),
      });
    } catch (e) {
      console.error("Failed to send message:", e);
      setInput(content);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="flex-1 flex flex-col">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-dark-500">
            <p className="text-center">
              {isConnected
                ? "Aucun message. Commence la conversation!"
                : "Connecte-toi pour commencer a chatter."}
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${
                msg.senderId === "local" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[70%] rounded-lg px-4 py-2 ${
                  msg.senderId === "local"
                    ? "bg-primary-600 text-white"
                    : "bg-dark-700 text-white"
                }`}
              >
                {msg.senderId !== "local" && (
                  <p className="text-xs text-primary-300 font-medium mb-1">
                    {msg.senderName}
                  </p>
                )}
                <p className="text-sm whitespace-pre-wrap break-words">
                  {msg.content}
                </p>
                <p className="text-xs opacity-60 text-right mt-1">
                  {formatTime(msg.timestamp)}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-dark-700 p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isConnected ? "Ecris ton message..." : "Connecte-toi d'abord..."
            }
            disabled={!isConnected || sending}
            className="flex-1 bg-dark-700 text-white rounded-lg px-4 py-3 placeholder-dark-500 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!isConnected || !input.trim() || sending}
            className="px-4 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
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
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
