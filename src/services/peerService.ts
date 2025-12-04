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

// Liste des serveurs PeerJS à essayer (avec fallback)
interface PeerServerConfig {
  host: string;
  port: number;
  path: string;
  secure: boolean;
}

const PEER_SERVERS: PeerServerConfig[] = [
  // peerjs.92k.de est actuellement plus stable que le serveur officiel
  { host: "peerjs.92k.de", port: 443, path: "/", secure: true },
  // Serveur PeerJS officiel (backup - parfois instable)
  { host: "0.peerjs.com", port: 443, path: "/", secure: true },
  // Autre serveur alternatif
  { host: "peer.herokuapp.com", port: 443, path: "/", secure: true },
];

// Index du serveur actuel (géré par la classe PeerService)

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
  private connectionTimeout: ReturnType<typeof setTimeout> | null = null;
  private intentionalDisconnect: boolean = false;
  private currentServerIndex: number = 0;
  private isReconnecting: boolean = false;

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
   * Get PeerJS config for current server
   */
  private getPeerConfig() {
    const server = PEER_SERVERS[this.currentServerIndex];
    return {
      debug: 1,
      host: server.host,
      port: server.port,
      path: server.path,
      secure: server.secure,
      config: {
        iceServers: ICE_SERVERS,
        iceCandidatePoolSize: 10,
      },
    };
  }

  /**
   * Try the next PeerJS server in the list
   * @returns true if there are more servers to try, false if we've cycled through all
   */
  private tryNextServer(): boolean {
    this.currentServerIndex = (this.currentServerIndex + 1) % PEER_SERVERS.length;
    console.log(`[PeerJS] Trying server: ${PEER_SERVERS[this.currentServerIndex].host}`);
    return this.currentServerIndex !== 0;
  }

  /**
   * Héberger un serveur avec un code donné
   */
  async host(serverCode: string, username: string): Promise<void> {
    this.username = username;
    this.serverCode = serverCode;
    this.isHost = true;
    this.intentionalDisconnect = false;
    // Only reset server index on fresh connection (not reconnection)
    if (!this.isReconnecting) {
      this.currentServerIndex = 0;
      this.reconnectAttempts = 0;
    }

    return new Promise((resolve, reject) => {
      let resolved = false;

      const cleanup = () => {
        if (this.connectionTimeout) {
          clearTimeout(this.connectionTimeout);
          this.connectionTimeout = null;
        }
      };

      // Clear any existing timeout before creating a new one
      cleanup();

      // Timeout si la connexion au serveur de signaling prend trop de temps (10 secondes)
      this.connectionTimeout = setTimeout(() => {
        if (!resolved && !this.intentionalDisconnect) {
          resolved = true;
          console.error("[PeerJS] Host connection timeout after 10s");
          this.onError?.("Timeout de connexion au serveur de signaling.");
          reject(new Error("Connection timeout"));
        }
      }, 10000);

      // Créer le peer avec le code serveur comme ID
      const config = this.getPeerConfig();
      console.log(`[PeerJS] Hosting: connecting to signaling server ${config.host}...`);
      this.peer = new Peer(`hydrow-${serverCode}`, config);

      this.peer.on("open", (id) => {
        if (resolved) return;
        resolved = true;
        cleanup();

        console.log("[PeerJS] Hosting as:", id);
        // Connection successful - reset reconnection state
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        this.currentServerIndex = 0;
        this.onReady?.();
        resolve();
      });

      this.peer.on("connection", (conn) => {
        this.handleIncomingConnection(conn);
      });

      this.peer.on("error", (err) => {
        if (resolved) return;
        resolved = true;
        cleanup();

        console.error("[PeerJS] Host peer error:", err.type, err.message);
        if (err.type === "unavailable-id") {
          this.onError?.("Ce code serveur est déjà utilisé. Réessaie dans quelques minutes.");
        } else if (err.type === "network") {
          this.onError?.("Erreur réseau. Vérifie ta connexion internet.");
        } else if (err.type === "server-error") {
          this.onError?.("Le serveur de signaling ne répond pas. Réessaye dans quelques instants.");
        } else {
          this.onError?.(err.message);
        }
        reject(err);
      });

      this.peer.on("disconnected", () => {
        console.log("[PeerJS] Host disconnected from signaling server");
        if (!resolved) {
          this.handleDisconnection();
        }
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
    // Only reset server index on fresh connection (not reconnection)
    if (!this.isReconnecting) {
      this.currentServerIndex = 0;
      this.reconnectAttempts = 0;
    }

    return new Promise((resolve, reject) => {
      let resolved = false;

      const cleanup = () => {
        if (this.connectionTimeout) {
          clearTimeout(this.connectionTimeout);
          this.connectionTimeout = null;
        }
      };

      // Clear any existing timeout before creating a new one
      cleanup();

      // Timeout si la connexion prend trop de temps (15 secondes)
      this.connectionTimeout = setTimeout(() => {
        if (!resolved && !this.intentionalDisconnect) {
          resolved = true;
          console.error("[PeerJS] Connection timeout after 15s");
          this.onError?.("Timeout de connexion. Le serveur ne répond pas.");
          reject(new Error("Connection timeout"));
        }
      }, 15000);

      // Créer un peer avec un ID aléatoire
      const config = this.getPeerConfig();
      console.log(`[PeerJS] Connecting to signaling server ${config.host}...`);
      this.peer = new Peer(config);

      this.peer.on("open", (id) => {
        console.log("[PeerJS] Connected to signaling server, my peer ID:", id);

        // Se connecter à l'hôte
        const hostPeerId = `hydrow-${serverCode}`;
        console.log("[PeerJS] Attempting to connect to host:", hostPeerId);

        const conn = this.peer!.connect(hostPeerId, {
          reliable: true,
          metadata: { username },
        });

        conn.on("open", () => {
          if (resolved) return;
          resolved = true;
          cleanup();

          console.log("[PeerJS] Connected to host!");
          this.connections.set(hostPeerId, conn);
          this.setupConnectionHandlers(conn, hostPeerId);

          // Annoncer notre présence
          this.sendTo(hostPeerId, {
            type: "announce",
            payload: { username },
          });

          // Connection successful - reset reconnection state
          this.reconnectAttempts = 0;
          this.isReconnecting = false;
          this.currentServerIndex = 0;
          this.onPeerConnected?.(hostPeerId, "Host");
          this.onReady?.();
          resolve();
        });

        conn.on("error", (err) => {
          if (resolved) return;
          resolved = true;
          cleanup();

          console.error("[PeerJS] Connection to host error:", err);
          this.onError?.("Impossible de se connecter. Vérifie le code serveur.");
          reject(err);
        });
      });

      this.peer.on("error", (err) => {
        if (resolved) return;
        resolved = true;
        cleanup();

        console.error("[PeerJS] Peer error:", err.type, err.message);
        if (err.type === "peer-unavailable") {
          this.onError?.("Serveur introuvable. Vérifie que l'hôte est en ligne.");
        } else if (err.type === "network") {
          this.onError?.("Erreur réseau. Vérifie ta connexion internet.");
        } else if (err.type === "server-error") {
          this.onError?.("Le serveur de signaling ne répond pas. Réessaye dans quelques instants.");
        } else {
          this.onError?.(err.message);
        }
        reject(err);
      });

      this.peer.on("disconnected", () => {
        console.log("[PeerJS] Disconnected from signaling server");
        if (!resolved) {
          this.handleDisconnection();
        }
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

    // Essayer le serveur suivant à chaque tentative
    const hasMoreServers = this.tryNextServer();

    if (this.reconnectAttempts >= this.maxReconnectAttempts * PEER_SERVERS.length) {
      console.log("Max reconnection attempts reached on all servers");
      this.onError?.("Connexion perdue. Impossible de se reconnecter après plusieurs tentatives sur tous les serveurs.");
      // Reset server index for next time
      this.currentServerIndex = 0;
      return;
    }

    this.reconnectAttempts++;
    this.isReconnecting = true;
    const serverName = PEER_SERVERS[this.currentServerIndex].host;
    console.log(`Attempting reconnection (${this.reconnectAttempts}) on server: ${serverName}`);
    this.onReconnecting?.(this.reconnectAttempts, this.maxReconnectAttempts * PEER_SERVERS.length);

    // Délai plus court entre les serveurs, plus long si on a fait le tour
    const delay = hasMoreServers ? 1000 : this.reconnectDelay * Math.pow(1.5, Math.floor(this.reconnectAttempts / PEER_SERVERS.length));

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
    this.isReconnecting = false;
    this.currentServerIndex = 0;
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
    // Mark as intentional to prevent auto-reconnection and timeout errors
    this.intentionalDisconnect = true;
    this.cancelReconnection();

    // Cancel any pending connection timeout
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }

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
