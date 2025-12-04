import { useState, useRef, useEffect, useCallback, memo } from "react";
import { useServerStore } from "../../stores/serverStore";
import { peerService } from "../../services/peerService";
import type { Message } from "../../types/room";

interface ChatPanelProps {
  isConnected: boolean;
}

// Memoized message component to prevent re-renders
const ChatMessage = memo(function ChatMessage({
  msg,
  isLocal,
}: {
  msg: Message;
  isLocal: boolean;
}) {
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className={`group flex gap-3 px-4 py-2 hover:bg-dark-800/30 transition ${isLocal ? "flex-row-reverse" : ""}`}>
      {/* Avatar */}
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white font-medium text-xs ${
        isLocal
          ? "bg-gradient-to-br from-accent-500 to-accent-700"
          : "bg-gradient-to-br from-emerald-500 to-emerald-700"
      }`}>
        {msg.senderName.charAt(0).toUpperCase()}
      </div>

      {/* Message content */}
      <div className={`flex flex-col max-w-[70%] ${isLocal ? "items-end" : "items-start"}`}>
        <div className="flex items-baseline gap-2 mb-1">
          <span className={`text-[13px] font-semibold ${isLocal ? "text-accent-400" : "text-emerald-400"}`}>
            {isLocal ? "Toi" : msg.senderName}
          </span>
          <span className="text-[11px] text-dark-500">
            {formatTime(msg.timestamp)}
          </span>
        </div>
        <div className={`px-3 py-2 rounded-xl ${
          isLocal
            ? "bg-accent-600/20 border border-accent-500/30"
            : "bg-dark-800 border border-dark-700/50"
        }`}>
          <p className="text-[14px] text-white leading-relaxed whitespace-pre-wrap break-words">
            {msg.content}
          </p>
        </div>
      </div>
    </div>
  );
});

export function ChatPanel({ isConnected }: ChatPanelProps) {
  const { username, messages, addMessage } = useServerStore();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const shouldAutoScroll = useRef(true);

  // Check if user is near bottom before adding new message
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (container) {
      const { scrollTop, scrollHeight, clientHeight } = container;
      // Auto-scroll if within 100px of bottom
      shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 100;
    }
  }, []);

  const scrollToBottom = useCallback(() => {
    if (shouldAutoScroll.current && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "auto" });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, scrollToBottom]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + "px";
    }
  }, [input]);

  const handleSend = useCallback(() => {
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
  }, [input, isConnected, sending, addMessage, username]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="h-full flex flex-col">
      {/* Messages area */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto py-4"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <div className="w-12 h-12 rounded-full bg-dark-800 flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-dark-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="text-dark-400 text-sm">
              {isConnected
                ? "Aucun message pour l'instant"
                : "En attente de connexion..."}
            </p>
            {isConnected && (
              <p className="text-dark-500 text-xs mt-1">
                Envoie un message pour commencer
              </p>
            )}
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                msg={msg}
                isLocal={msg.senderId === "local"}
              />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input area - fixed at bottom */}
      <div className="flex-shrink-0 border-t border-dark-700/50 p-4 bg-dark-900">
        <div className="flex gap-3">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isConnected ? "Ecris un message..." : "Connexion en cours..."}
            disabled={!isConnected || sending}
            rows={1}
            className="flex-1 min-w-0 bg-dark-800 text-white text-[14px] rounded-xl px-4 py-3 placeholder-dark-500 border border-dark-700/50 focus:border-accent-500/50 outline-none ring-0 resize-none disabled:opacity-50 transition"
            style={{ minHeight: "46px", maxHeight: "120px" }}
          />

          <button
            onClick={handleSend}
            disabled={!isConnected || !input.trim() || sending}
            className="flex-shrink-0 w-[46px] h-[46px] flex items-center justify-center bg-accent-600 hover:bg-accent-500 disabled:bg-dark-700 disabled:text-dark-500 text-white rounded-xl transition disabled:cursor-not-allowed"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Keyboard hint */}
        <p className="text-[11px] text-dark-500 mt-2 px-1">
          Appuie sur <kbd className="px-1.5 py-0.5 bg-dark-800 rounded text-dark-400">Entrée</kbd> pour envoyer
        </p>
      </div>
    </div>
  );
}
