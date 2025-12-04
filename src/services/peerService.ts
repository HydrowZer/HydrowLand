import Peer, { DataConnection } from "peerjs";

export type MessageHandler = (peerId: string, data: unknown) => void;
export type ConnectionHandler = (peerId: string, username: string) => void;
export type DisconnectionHandler = (peerId: string) => void;

interface PeerMessage {
  type: "chat" | "audio" | "announce" | "ping" | "pong" | "speaking" | "screen" | "screen-state";
  payload: unknown;
}

// Configuration ICE avec serveurs STUN/TURN publics fiables
const ICE_SERVERS: RTCIceServer[] = [
  // Google STUN servers (très fiables)
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  // Cloudflare STUN
  { urls: "stun:stun.cloudflare.com:3478" },
  // OpenRelay TURN servers (gratuit, fiable)
  {
    urls: "turn:openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443?transport=tcp",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

// Configuration PeerJS commune
const PEER_CONFIG = {
  debug: 1,
  config: {
    iceServers: ICE_SERVERS,
    iceCandidatePoolSize: 10,
  },
};

export interface ConnectionQuality {
  latency: number; // ms
  status: "excellent" | "good" | "fair" | "poor" | "disconnected";
}

class PeerService {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private username: string = "";
  private pingTimestamps: Map<string, number> = new Map();
  private latencies: Map<string, number> = new Map();
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  // Reconnection state
  private isHost: boolean = false;
  private serverCode: string = "";
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 2000;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private intentionalDisconnect: boolean = false;

  // Callbacks
  private onMessage: MessageHandler | null = null;
  private onPeerConnected: ConnectionHandler | null = null;
  private onPeerDisconnected: DisconnectionHandler | null = null;
  private onReady: (() => void) | null = null;
  private onError: ((error: string) => void) | null = null;
  private onLatencyUpdate: ((peerId: string, latency: number) => void) | null = null;
  private onReconnecting: ((attempt: number, maxAttempts: number) => void) | null = null;
  private onReconnected: (() => void) | null = null;

  setCallbacks(callbacks: {
    onMessage?: MessageHandler;
    onPeerConnected?: ConnectionHandler;
    onPeerDisconnected?: DisconnectionHandler;
    onReady?: () => void;
    onError?: (error: string) => void;
    onLatencyUpdate?: (peerId: string, latency: number) => void;
    onReconnecting?: (attempt: number, maxAttempts: number) => void;
    onReconnected?: () => void;
  }) {
    this.onMessage = callbacks.onMessage || null;
    this.onPeerConnected = callbacks.onPeerConnected || null;
    this.onPeerDisconnected = callbacks.onPeerDisconnected || null;
    this.onReady = callbacks.onReady || null;
    this.onError = callbacks.onError || null;
    this.onLatencyUpdate = callbacks.onLatencyUpdate || null;
    this.onReconnecting = callbacks.onReconnecting || null;
    this.onReconnected = callbacks.onReconnected || null;
  }

  /**
   * Héberger un serveur avec un code donné
   */
  async host(serverCode: string, username: string): Promise<void> {
    this.username = username;
    this.serverCode = serverCode;
    this.isHost = true;
    this.intentionalDisconnect = false;
    this.reconnectAttempts = 0;

    return new Promise((resolve, reject) => {
      // Créer le peer avec le code serveur comme ID
      this.peer = new Peer(`hydrow-${serverCode}`, PEER_CONFIG);

      this.peer.on("open", (id) => {
        console.log("Hosting as:", id);
        this.reconnectAttempts = 0;
        this.onReady?.();
        resolve();
      });

      this.peer.on("connection", (conn) => {
        this.handleIncomingConnection(conn);
      });

      this.peer.on("error", (err) => {
        console.error("Peer error:", err);
        if (err.type === "unavailable-id") {
          this.onError?.("Ce code serveur est déjà utilisé. Réessaie dans quelques minutes.");
        } else {
          this.onError?.(err.message);
        }
        reject(err);
      });

      this.peer.on("disconnected", () => {
        console.log("Disconnected from signaling server");
        this.handleDisconnection();
      });
    });
  }

  /**
   * Rejoindre un serveur existant
   */
  async join(serverCode: string, username: string): Promise<void> {
    this.username = username;
    this.serverCode = serverCode;
    this.isHost = false;
    this.intentionalDisconnect = false;
    this.reconnectAttempts = 0;

    return new Promise((resolve, reject) => {
      // Créer un peer avec un ID aléatoire
      this.peer = new Peer(PEER_CONFIG);

      this.peer.on("open", (id) => {
        console.log("My peer ID:", id);

        // Se connecter à l'hôte
        const hostPeerId = `hydrow-${serverCode}`;
        console.log("Connecting to host:", hostPeerId);

        const conn = this.peer!.connect(hostPeerId, {
          reliable: true,
          metadata: { username },
        });

        conn.on("open", () => {
          console.log("Connected to host!");
          this.connections.set(hostPeerId, conn);
          this.setupConnectionHandlers(conn, hostPeerId);

          // Annoncer notre présence
          this.sendTo(hostPeerId, {
            type: "announce",
            payload: { username },
          });

          this.reconnectAttempts = 0;
          this.onPeerConnected?.(hostPeerId, "Host");
          this.onReady?.();
          resolve();
        });

        conn.on("error", (err) => {
          console.error("Connection error:", err);
          this.onError?.("Impossible de se connecter. Vérifie le code serveur.");
          reject(err);
        });
      });

      this.peer.on("error", (err) => {
        console.error("Peer error:", err);
        if (err.type === "peer-unavailable") {
          this.onError?.("Serveur introuvable. Vérifie que l'hôte est en ligne.");
        } else {
          this.onError?.(err.message);
        }
        reject(err);
      });

      this.peer.on("disconnected", () => {
        console.log("Disconnected from signaling server");
        this.handleDisconnection();
      });

      // Gérer les connexions entrantes (pour mesh avec autres invités)
      this.peer.on("connection", (conn) => {
        this.handleIncomingConnection(conn);
      });
    });
  }

  private handleIncomingConnection(conn: DataConnection) {
    const peerId = conn.peer;
    const metadata = conn.metadata as { username?: string } | undefined;
    const peerUsername = metadata?.username || "Inconnu";

    console.log("Incoming connection from:", peerId, "username:", peerUsername);

    conn.on("open", () => {
      this.connections.set(peerId, conn);
      this.setupConnectionHandlers(conn, peerId);
      this.onPeerConnected?.(peerId, peerUsername);
    });
  }

  /**
   * Handle unexpected disconnection and attempt reconnection
   */
  private handleDisconnection() {
    if (this.intentionalDisconnect) {
      console.log("Intentional disconnect, not attempting reconnection");
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log("Max reconnection attempts reached");
      this.onError?.("Connexion perdue. Impossible de se reconnecter après plusieurs tentatives.");
      return;
    }

    this.reconnectAttempts++;
    console.log(`Attempting reconnection (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    this.onReconnecting?.(this.reconnectAttempts, this.maxReconnectAttempts);

    // Exponential backoff
    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);

    this.reconnectTimeout = setTimeout(async () => {
      try {
        // Clean up old peer
        if (this.peer && !this.peer.destroyed) {
          this.peer.destroy();
        }

        // Attempt to reconnect
        if (this.isHost) {
          await this.host(this.serverCode, this.username);
        } else {
          await this.join(this.serverCode, this.username);
        }

        console.log("Reconnection successful!");
        this.onReconnected?.();
      } catch (err) {
        console.error("Reconnection failed:", err);
        this.handleDisconnection();
      }
    }, delay);
  }

  /**
   * Cancel any pending reconnection attempts
   */
  private cancelReconnection() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.reconnectAttempts = 0;
  }

  private setupConnectionHandlers(conn: DataConnection, peerId: string) {
    conn.on("data", (data) => {
      const msg = data as PeerMessage;

      if (msg.type === "announce") {
        const payload = msg.payload as { username: string };
        this.onPeerConnected?.(peerId, payload.username);
      } else if (msg.type === "ping") {
        // Respond immediately with pong
        const payload = msg.payload as { timestamp: number };
        this.sendTo(peerId, { type: "pong", payload: { timestamp: payload.timestamp } });
      } else if (msg.type === "pong") {
        // Calculate latency from round-trip time
        const payload = msg.payload as { timestamp: number };
        const sentTime = this.pingTimestamps.get(peerId);
        if (sentTime && payload.timestamp === sentTime) {
          const latency = Math.round((Date.now() - sentTime) / 2);
          this.latencies.set(peerId, latency);
          this.onLatencyUpdate?.(peerId, latency);
        }
      } else {
        this.onMessage?.(peerId, msg);
      }
    });

    conn.on("close", () => {
      console.log("Connection closed:", peerId);
      this.connections.delete(peerId);
      this.onPeerDisconnected?.(peerId);
    });

    conn.on("error", (err) => {
      console.error("Connection error with", peerId, ":", err);
    });
  }

  /**
   * Envoyer un message à un peer spécifique
   */
  sendTo(peerId: string, message: PeerMessage) {
    const conn = this.connections.get(peerId);
    if (conn && conn.open) {
      conn.send(message);
    }
  }

  /**
   * Envoyer un message à tous les peers
   */
  broadcast(message: PeerMessage) {
    this.connections.forEach((conn) => {
      if (conn.open) {
        conn.send(message);
      }
    });
  }

  /**
   * Envoyer un message chat
   */
  sendChat(content: string) {
    this.broadcast({
      type: "chat",
      payload: {
        sender: this.username,
        content,
        timestamp: Date.now(),
      },
    });
  }

  /**
   * Envoyer des données audio
   */
  sendAudio(samples: number[]) {
    this.broadcast({
      type: "audio",
      payload: {
        sender: this.username,
        samples,
      },
    });
  }

  /**
   * Démarrer la mesure de latence périodique
   */
  startPingInterval() {
    if (this.pingInterval) return;

    this.pingInterval = setInterval(() => {
      this.pingAllPeers();
    }, 3000); // Ping every 3 seconds

    // Ping immediately
    this.pingAllPeers();
  }

  /**
   * Arrêter la mesure de latence
   */
  stopPingInterval() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Ping tous les peers connectés
   */
  private pingAllPeers() {
    const timestamp = Date.now();
    this.connections.forEach((conn, peerId) => {
      if (conn.open) {
        this.pingTimestamps.set(peerId, timestamp);
        this.sendTo(peerId, { type: "ping", payload: { timestamp } });
      }
    });
  }

  /**
   * Obtenir la latence d'un peer
   */
  getLatency(peerId: string): number | null {
    return this.latencies.get(peerId) ?? null;
  }

  /**
   * Obtenir la latence moyenne
   */
  getAverageLatency(): number | null {
    if (this.latencies.size === 0) return null;
    const total = Array.from(this.latencies.values()).reduce((a, b) => a + b, 0);
    return Math.round(total / this.latencies.size);
  }

  /**
   * Obtenir la qualité de connexion basée sur la latence
   */
  getConnectionQuality(): ConnectionQuality {
    const latency = this.getAverageLatency();
    if (latency === null || this.connections.size === 0) {
      return { latency: 0, status: "disconnected" };
    }

    let status: ConnectionQuality["status"];
    if (latency < 50) {
      status = "excellent";
    } else if (latency < 100) {
      status = "good";
    } else if (latency < 200) {
      status = "fair";
    } else {
      status = "poor";
    }

    return { latency, status };
  }

  /**
   * Obtenir le nombre de peers connectés
   */
  getPeerCount(): number {
    return this.connections.size;
  }

  /**
   * Obtenir la liste des peers
   */
  getPeers(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Vérifier si connecté
   */
  isConnected(): boolean {
    return this.peer !== null && !this.peer.destroyed;
  }

  /**
   * Se déconnecter (intentionnellement)
   */
  disconnect() {
    // Mark as intentional to prevent auto-reconnection
    this.intentionalDisconnect = true;
    this.cancelReconnection();

    this.stopPingInterval();
    this.latencies.clear();
    this.pingTimestamps.clear();

    this.connections.forEach((conn) => {
      conn.close();
    });
    this.connections.clear();

    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }

    // Reset state
    this.serverCode = "";
    this.isHost = false;
  }
}

// Singleton
export const peerService = new PeerService();
