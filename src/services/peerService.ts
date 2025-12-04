export type MessageHandler = (peerId: string, data: unknown) => void;
export type ConnectionHandler = (peerId: string, username: string) => void;
export type DisconnectionHandler = (peerId: string) => void;

interface PeerMessage {
  type: "chat" | "audio" | "announce" | "ping" | "pong" | "speaking" | "screen" | "screen-state";
  payload: unknown;
}

// Configuration du serveur WebSocket de signaling
const SIGNALING_SERVER = "wss://cabochards.duckdns.org";

// Configuration ICE avec serveurs STUN/TURN publics fiables
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
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

export interface ConnectionQuality {
  latency: number;
  status: "excellent" | "good" | "fair" | "poor" | "disconnected";
}

interface PeerConnection {
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  username: string;
}

class PeerService {
  private ws: WebSocket | null = null;
  private myPeerId: string = "";
  private username: string = "";
  private serverCode: string = "";
  private isHost: boolean = false;

  // WebRTC peer connections
  private peerConnections: Map<string, PeerConnection> = new Map();
  private pendingCandidates: Map<string, RTCIceCandidateInit[]> = new Map();

  // Ping/latency tracking
  private pingTimestamps: Map<string, number> = new Map();
  private latencies: Map<string, number> = new Map();
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  // Reconnection state
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 2000;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private connectionTimeout: ReturnType<typeof setTimeout> | null = null;
  private intentionalDisconnect: boolean = false;
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
   * Connecte au serveur WebSocket de signaling
   */
  private connectToSignaling(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      console.log(`[Signaling] Connexion à ${SIGNALING_SERVER}...`);
      this.ws = new WebSocket(SIGNALING_SERVER);

      const timeout = setTimeout(() => {
        reject(new Error("Connection timeout"));
        this.ws?.close();
      }, 10000);

      this.ws.onopen = () => {
        clearTimeout(timeout);
        console.log("[Signaling] Connecté au serveur");
        resolve();
      };

      this.ws.onerror = (error) => {
        clearTimeout(timeout);
        console.error("[Signaling] Erreur:", error);
        reject(new Error("Erreur de connexion au serveur de signaling"));
      };

      this.ws.onclose = () => {
        console.log("[Signaling] Déconnecté");
        if (!this.intentionalDisconnect) {
          this.handleDisconnection();
        }
      };

      this.ws.onmessage = (event) => {
        this.handleSignalingMessage(JSON.parse(event.data));
      };
    });
  }

  /**
   * Envoie un message au serveur de signaling
   */
  private sendToSignaling(data: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  /**
   * Gère les messages du serveur de signaling
   */
  private async handleSignalingMessage(msg: Record<string, unknown>) {
    const type = msg.type as string;

    switch (type) {
      case "registered":
        this.myPeerId = msg.peerId as string;
        console.log("[Signaling] Enregistré avec ID:", this.myPeerId);
        break;

      case "hosted":
        console.log("[Signaling] Room créée:", msg.room);
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        this.onReady?.();
        break;

      case "joined": {
        console.log("[Signaling] Rejoint la room:", msg.room);
        const peers = msg.peers as Array<{ peerId: string; username: string; isHost: boolean }>;

        // Créer des connexions WebRTC avec tous les peers existants
        for (const peer of peers) {
          await this.createPeerConnection(peer.peerId, peer.username, true);
        }

        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        this.onReady?.();
        break;
      }

      case "peer-joined": {
        const peerId = msg.peerId as string;
        const username = msg.username as string;
        console.log("[Signaling] Nouveau peer:", peerId, username);
        // Le nouveau peer va initier la connexion, on attend son offer
        this.pendingCandidates.set(peerId, []);
        break;
      }

      case "peer-left": {
        const peerId = msg.peerId as string;
        console.log("[Signaling] Peer parti:", peerId);
        this.closePeerConnection(peerId);
        this.onPeerDisconnected?.(peerId);
        break;
      }

      case "signal": {
        const fromPeer = msg.from as string;
        const signalData = msg.data as Record<string, unknown>;
        await this.handleSignalData(fromPeer, signalData);
        break;
      }

      case "room-closed":
        console.log("[Signaling] Room fermée:", msg.reason);
        this.onError?.("Le serveur a été fermé par l'hôte.");
        this.disconnect();
        break;

      case "error": {
        const error = msg.error as string;
        const message = msg.message as string;
        console.error("[Signaling] Erreur:", error, message);

        if (error === "room-exists") {
          this.onError?.("Ce code serveur est déjà utilisé. Réessaie dans quelques minutes.");
        } else if (error === "room-not-found") {
          this.onError?.("Serveur introuvable. Vérifie que l'hôte est en ligne.");
        } else {
          this.onError?.(message);
        }
        break;
      }
    }
  }

  /**
   * Gère les données de signaling WebRTC (offer/answer/ice)
   */
  private async handleSignalData(fromPeer: string, data: Record<string, unknown>) {
    const signalType = data.type as string;

    if (signalType === "offer") {
      console.log("[WebRTC] Offer reçu de:", fromPeer);
      const username = data.username as string || "Inconnu";
      await this.handleOffer(fromPeer, username, data.sdp as string);
    } else if (signalType === "answer") {
      console.log("[WebRTC] Answer reçu de:", fromPeer);
      await this.handleAnswer(fromPeer, data.sdp as string);
    } else if (signalType === "ice-candidate") {
      await this.handleIceCandidate(fromPeer, data.candidate as RTCIceCandidateInit);
    }
  }

  /**
   * Crée une connexion WebRTC avec un peer
   */
  private async createPeerConnection(peerId: string, username: string, initiator: boolean): Promise<void> {
    console.log(`[WebRTC] Création connexion avec ${peerId} (initiator: ${initiator})`);

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peerConn: PeerConnection = { pc, dc: null, username };
    this.peerConnections.set(peerId, peerConn);
    this.pendingCandidates.set(peerId, []);

    // Gestion des ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendToSignaling({
          type: "signal",
          to: peerId,
          data: {
            type: "ice-candidate",
            candidate: event.candidate.toJSON(),
          },
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC] ICE state avec ${peerId}:`, pc.iceConnectionState);
      if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
        this.closePeerConnection(peerId);
        this.onPeerDisconnected?.(peerId);
      }
    };

    // Si on est l'initiateur, créer le data channel
    if (initiator) {
      const dc = pc.createDataChannel("data", { ordered: true });
      peerConn.dc = dc;
      this.setupDataChannel(dc, peerId, username);

      // Créer et envoyer l'offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      this.sendToSignaling({
        type: "signal",
        to: peerId,
        data: {
          type: "offer",
          sdp: offer.sdp,
          username: this.username,
        },
      });
    } else {
      // Sinon, attendre le data channel
      pc.ondatachannel = (event) => {
        peerConn.dc = event.channel;
        this.setupDataChannel(event.channel, peerId, username);
      };
    }
  }

  /**
   * Gère un offer WebRTC entrant
   */
  private async handleOffer(peerId: string, username: string, sdp: string) {
    let peerConn = this.peerConnections.get(peerId);

    if (!peerConn) {
      await this.createPeerConnection(peerId, username, false);
      peerConn = this.peerConnections.get(peerId)!;
    }

    const pc = peerConn.pc;
    await pc.setRemoteDescription({ type: "offer", sdp });

    // Appliquer les ICE candidates en attente
    const pending = this.pendingCandidates.get(peerId) || [];
    for (const candidate of pending) {
      await pc.addIceCandidate(candidate);
    }
    this.pendingCandidates.set(peerId, []);

    // Créer et envoyer l'answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this.sendToSignaling({
      type: "signal",
      to: peerId,
      data: {
        type: "answer",
        sdp: answer.sdp,
      },
    });
  }

  /**
   * Gère un answer WebRTC entrant
   */
  private async handleAnswer(peerId: string, sdp: string) {
    const peerConn = this.peerConnections.get(peerId);
    if (!peerConn) return;

    await peerConn.pc.setRemoteDescription({ type: "answer", sdp });

    // Appliquer les ICE candidates en attente
    const pending = this.pendingCandidates.get(peerId) || [];
    for (const candidate of pending) {
      await peerConn.pc.addIceCandidate(candidate);
    }
    this.pendingCandidates.set(peerId, []);
  }

  /**
   * Gère un ICE candidate entrant
   */
  private async handleIceCandidate(peerId: string, candidate: RTCIceCandidateInit) {
    const peerConn = this.peerConnections.get(peerId);

    if (peerConn && peerConn.pc.remoteDescription) {
      await peerConn.pc.addIceCandidate(candidate);
    } else {
      // Stocker pour plus tard
      const pending = this.pendingCandidates.get(peerId) || [];
      pending.push(candidate);
      this.pendingCandidates.set(peerId, pending);
    }
  }

  /**
   * Configure le data channel
   */
  private setupDataChannel(dc: RTCDataChannel, peerId: string, username: string) {
    dc.onopen = () => {
      console.log(`[WebRTC] DataChannel ouvert avec ${peerId}`);
      this.onPeerConnected?.(peerId, username);
    };

    dc.onclose = () => {
      console.log(`[WebRTC] DataChannel fermé avec ${peerId}`);
    };

    dc.onmessage = (event) => {
      const msg = JSON.parse(event.data) as PeerMessage;

      if (msg.type === "ping") {
        const payload = msg.payload as { timestamp: number };
        this.sendTo(peerId, { type: "pong", payload: { timestamp: payload.timestamp } });
      } else if (msg.type === "pong") {
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
    };
  }

  /**
   * Ferme une connexion peer
   */
  private closePeerConnection(peerId: string) {
    const peerConn = this.peerConnections.get(peerId);
    if (peerConn) {
      peerConn.dc?.close();
      peerConn.pc.close();
      this.peerConnections.delete(peerId);
    }
    this.pendingCandidates.delete(peerId);
    this.latencies.delete(peerId);
    this.pingTimestamps.delete(peerId);
  }

  /**
   * Héberger un serveur avec un code donné
   */
  async host(serverCode: string, username: string): Promise<void> {
    this.username = username;
    this.serverCode = serverCode;
    this.isHost = true;
    this.intentionalDisconnect = false;

    if (!this.isReconnecting) {
      this.reconnectAttempts = 0;
    }

    return new Promise(async (resolve, reject) => {
      try {
        await this.connectToSignaling();

        // S'enregistrer
        this.sendToSignaling({
          type: "register",
          peerId: `host-${serverCode}`,
          username,
        });

        // Attendre l'enregistrement puis créer la room
        await new Promise((r) => setTimeout(r, 100));

        this.sendToSignaling({
          type: "host",
          room: serverCode,
        });

        // Le callback onReady sera appelé quand on reçoit "hosted"
        const timeout = setTimeout(() => {
          reject(new Error("Timeout"));
        }, 10000);

        const originalOnReady = this.onReady;
        this.onReady = () => {
          clearTimeout(timeout);
          this.onReady = originalOnReady;
          originalOnReady?.();
          resolve();
        };

        const originalOnError = this.onError;
        this.onError = (error) => {
          clearTimeout(timeout);
          this.onError = originalOnError;
          originalOnError?.(error);
          reject(new Error(error));
        };
      } catch (err) {
        this.onError?.("Impossible de se connecter au serveur de signaling.");
        reject(err);
      }
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

    if (!this.isReconnecting) {
      this.reconnectAttempts = 0;
    }

    return new Promise(async (resolve, reject) => {
      try {
        await this.connectToSignaling();

        // S'enregistrer avec un ID aléatoire
        const randomId = Math.random().toString(36).substring(2, 10);
        this.sendToSignaling({
          type: "register",
          peerId: `guest-${randomId}`,
          username,
        });

        // Attendre l'enregistrement puis rejoindre
        await new Promise((r) => setTimeout(r, 100));

        this.sendToSignaling({
          type: "join",
          room: serverCode,
        });

        // Le callback onReady sera appelé quand on reçoit "joined"
        const timeout = setTimeout(() => {
          reject(new Error("Timeout"));
        }, 15000);

        const originalOnReady = this.onReady;
        this.onReady = () => {
          clearTimeout(timeout);
          this.onReady = originalOnReady;
          originalOnReady?.();
          resolve();
        };

        const originalOnError = this.onError;
        this.onError = (error) => {
          clearTimeout(timeout);
          this.onError = originalOnError;
          originalOnError?.(error);
          reject(new Error(error));
        };
      } catch (err) {
        this.onError?.("Impossible de se connecter au serveur de signaling.");
        reject(err);
      }
    });
  }

  /**
   * Gère la déconnexion et tente une reconnexion
   */
  private handleDisconnection() {
    if (this.intentionalDisconnect) {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log("Max reconnection attempts reached");
      this.onError?.("Connexion perdue. Impossible de se reconnecter.");
      return;
    }

    this.reconnectAttempts++;
    this.isReconnecting = true;
    console.log(`Tentative de reconnexion (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    this.onReconnecting?.(this.reconnectAttempts, this.maxReconnectAttempts);

    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);

    this.reconnectTimeout = setTimeout(async () => {
      try {
        if (this.isHost) {
          await this.host(this.serverCode, this.username);
        } else {
          await this.join(this.serverCode, this.username);
        }
        console.log("Reconnexion réussie!");
        this.onReconnected?.();
      } catch (err) {
        console.error("Échec de reconnexion:", err);
        this.handleDisconnection();
      }
    }, delay);
  }

  /**
   * Annule les tentatives de reconnexion
   */
  private cancelReconnection() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.reconnectAttempts = 0;
    this.isReconnecting = false;
  }

  /**
   * Envoyer un message à un peer spécifique
   */
  sendTo(peerId: string, message: PeerMessage) {
    const peerConn = this.peerConnections.get(peerId);
    if (peerConn?.dc?.readyState === "open") {
      peerConn.dc.send(JSON.stringify(message));
    }
  }

  /**
   * Envoyer un message à tous les peers
   */
  broadcast(message: PeerMessage) {
    this.peerConnections.forEach((peerConn) => {
      if (peerConn.dc?.readyState === "open") {
        peerConn.dc.send(JSON.stringify(message));
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
    }, 3000);

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
    this.peerConnections.forEach((peerConn, peerId) => {
      if (peerConn.dc?.readyState === "open") {
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
    if (latency === null || this.peerConnections.size === 0) {
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
    return this.peerConnections.size;
  }

  /**
   * Obtenir la liste des peers
   */
  getPeers(): string[] {
    return Array.from(this.peerConnections.keys());
  }

  /**
   * Vérifier si connecté
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Se déconnecter (intentionnellement)
   */
  disconnect() {
    this.intentionalDisconnect = true;
    this.cancelReconnection();

    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }

    this.stopPingInterval();
    this.latencies.clear();
    this.pingTimestamps.clear();

    // Fermer toutes les connexions WebRTC
    this.peerConnections.forEach((_, peerId) => {
      this.closePeerConnection(peerId);
    });
    this.peerConnections.clear();
    this.pendingCandidates.clear();

    // Notifier le serveur et fermer la connexion
    if (this.ws) {
      this.sendToSignaling({ type: "leave" });
      this.ws.close();
      this.ws = null;
    }

    this.serverCode = "";
    this.isHost = false;
    this.myPeerId = "";
  }
}

// Singleton
export const peerService = new PeerService();
