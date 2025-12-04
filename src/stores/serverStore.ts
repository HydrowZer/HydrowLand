import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ServerInfo, Message } from "../types/room";

export interface ConnectedPeer {
  peerId: string;
  username: string;
  connectedAt: number;
}

interface ServerState {
  // User
  username: string;
  setUsername: (username: string) => void;

  // Server
  serverInfo: ServerInfo | null;
  setServerInfo: (info: ServerInfo | null) => void;

  // Messages
  messages: Message[];
  addMessage: (message: Message) => void;
  clearMessages: () => void;

  // Connected peers (WebRTC)
  connectedPeers: ConnectedPeer[];
  addPeer: (peer: ConnectedPeer) => void;
  removePeer: (peerId: string) => void;
  clearPeers: () => void;

  // Actions
  disconnect: () => void;
}

// Génère un pseudo aléatoire
function generateUsername(): string {
  const adjectives = ["Cool", "Super", "Mega", "Turbo", "Hyper", "Ultra"];
  const nouns = ["Panda", "Tiger", "Dragon", "Phoenix", "Wolf", "Eagle"];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 100);
  return `${adj}${noun}${num}`;
}

export const useServerStore = create<ServerState>()(
  persist(
    (set) => ({
      // User - généré automatiquement si pas défini
      username: generateUsername(),
      setUsername: (username) => set({ username }),

      // Server
      serverInfo: null,
      setServerInfo: (serverInfo) => set({ serverInfo }),

      // Messages
      messages: [],
      addMessage: (message) =>
        set((state) => ({ messages: [...state.messages, message] })),
      clearMessages: () => set({ messages: [] }),

      // Connected peers
      connectedPeers: [],
      addPeer: (peer) =>
        set((state) => {
          if (state.connectedPeers.some((p) => p.peerId === peer.peerId)) {
            return state;
          }
          return { connectedPeers: [...state.connectedPeers, peer] };
        }),
      removePeer: (peerId) =>
        set((state) => ({
          connectedPeers: state.connectedPeers.filter((p) => p.peerId !== peerId),
        })),
      clearPeers: () => set({ connectedPeers: [] }),

      // Actions
      disconnect: () =>
        set({
          serverInfo: null,
          messages: [],
          connectedPeers: [],
        }),
    }),
    {
      name: "hydrowland-server",
      partialize: (state) => ({ username: state.username }),
    }
  )
);
