import Peer, { DataConnection } from "peerjs";

export type MessageHandler = (peerId: string, data: unknown) => void;
export type ConnectionHandler = (peerId: string, username: string) => void;
export type DisconnectionHandler = (peerId: string) => void;

interface PeerMessage {
  type: "chat" | "audio" | "announce" | "ping";
  payload: unknown;
}

class PeerService {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private username: string = "";

  // Callbacks
  private onMessage: MessageHandler | null = null;
  private onPeerConnected: ConnectionHandler | null = null;
  private onPeerDisconnected: DisconnectionHandler | null = null;
  private onReady: (() => void) | null = null;
  private onError: ((error: string) => void) | null = null;

  setCallbacks(callbacks: {
    onMessage?: MessageHandler;
    onPeerConnected?: ConnectionHandler;
    onPeerDisconnected?: DisconnectionHandler;
    onReady?: () => void;
    onError?: (error: string) => void;
  }) {
    this.onMessage = callbacks.onMessage || null;
    this.onPeerConnected = callbacks.onPeerConnected || null;
    this.onPeerDisconnected = callbacks.onPeerDisconnected || null;
    this.onReady = callbacks.onReady || null;
    this.onError = callbacks.onError || null;
  }

  /**
   * Héberger un serveur avec un code donné
   */
  async host(serverCode: string, username: string): Promise<void> {
    this.username = username;

    return new Promise((resolve, reject) => {
      // Créer le peer avec le code serveur comme ID
      this.peer = new Peer(`hydrow-${serverCode}`, {
        debug: 1,
      });

      this.peer.on("open", (id) => {
        console.log("Hosting as:", id);
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
      });
    });
  }

  /**
   * Rejoindre un serveur existant
   */
  async join(serverCode: string, username: string): Promise<void> {
    this.username = username;

    return new Promise((resolve, reject) => {
      // Créer un peer avec un ID aléatoire
      this.peer = new Peer({
        debug: 1,
      });

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

  private setupConnectionHandlers(conn: DataConnection, peerId: string) {
    conn.on("data", (data) => {
      const msg = data as PeerMessage;
      console.log("Received from", peerId, ":", msg);

      if (msg.type === "announce") {
        const payload = msg.payload as { username: string };
        this.onPeerConnected?.(peerId, payload.username);
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
   * Se déconnecter
   */
  disconnect() {
    this.connections.forEach((conn) => {
      conn.close();
    });
    this.connections.clear();

    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
  }
}

// Singleton
export const peerService = new PeerService();
