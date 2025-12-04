import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Room, Participant, Message } from "../types/room";

export interface ConnectedPeer {
  peerId: string;
  username: string;
  connectedAt: number;
}

interface RoomState {
  // User state
  username: string | null;
  setUsername: (username: string) => void;

  // Room state
  room: Room | null;
  setRoom: (room: Room | null) => void;

  // Local participant
  localParticipant: Participant | null;
  setLocalParticipant: (participant: Participant | null) => void;

  // Messages
  messages: Message[];
  addMessage: (message: Message) => void;
  clearMessages: () => void;

  // Mesh peers
  connectedPeers: ConnectedPeer[];
  addPeer: (peer: ConnectedPeer) => void;
  removePeer: (peerId: string) => void;
  clearPeers: () => void;

  // Actions
  leaveRoom: () => void;
}

export const useRoomStore = create<RoomState>()(
  persist(
    (set) => ({
      // User state
      username: null,
      setUsername: (username) => set({ username }),

      // Room state
      room: null,
      setRoom: (room) => set({ room }),

      // Local participant
      localParticipant: null,
      setLocalParticipant: (localParticipant) => set({ localParticipant }),

      // Messages
      messages: [],
      addMessage: (message) =>
        set((state) => ({ messages: [...state.messages, message] })),
      clearMessages: () => set({ messages: [] }),

      // Mesh peers
      connectedPeers: [],
      addPeer: (peer) =>
        set((state) => {
          // Don't add if already exists
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
      leaveRoom: () =>
        set({
          room: null,
          localParticipant: null,
          messages: [],
          connectedPeers: [],
        }),
    }),
    {
      name: "hydrowland-storage",
      partialize: (state) => ({ username: state.username }),
    }
  )
);
