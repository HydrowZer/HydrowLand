export interface Participant {
  id: string;
  username: string;
  is_muted: boolean;
  is_screen_sharing: boolean;
  is_host: boolean;
}

export interface Room {
  code: string;
  participants: Participant[];
  max_participants: number;
  created_at: number;
}

// Server types
export interface ServerConfig {
  code: string;
  username: string;
}

export interface Peer {
  id: string;
  username: string;
  is_host: boolean;
}

export interface ServerInfo {
  code: string;
  is_hosting: boolean;
  username: string;
  peers: Peer[];
}

export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: number;
}

export interface ConnectionOffer {
  sdp_base64: string;
  is_offer: boolean;
}

export interface ChatMessage {
  type: "chat";
  sender: string;
  content: string;
  timestamp: number;
}
