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
    <div className={`flex ${isLocal ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[70%] rounded-lg px-4 py-2 ${
          isLocal ? "bg-primary-600 text-white" : "bg-dark-700 text-white"
        }`}
      >
        {!isLocal && (
          <p className="text-xs text-primary-300 font-medium mb-1">
            {msg.senderName}
          </p>
        )}
        <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
        <p className="text-xs opacity-60 text-right mt-1">
          {formatTime(msg.timestamp)}
        </p>
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
      // Use 'auto' instead of 'smooth' for better performance
      messagesEndRef.current.scrollIntoView({ behavior: "auto" });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, scrollToBottom]);

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
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Messages area */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0"
      >
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
            <ChatMessage
              key={msg.id}
              msg={msg}
              isLocal={msg.senderId === "local"}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 border-t border-dark-700 p-4">
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
