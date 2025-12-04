#!/usr/bin/env python3
"""
Serveur WebSocket de signaling pour HydrowLand
Remplace PeerJS pour la découverte et connexion des peers WebRTC
"""

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Optional
import websockets
from websockets.server import WebSocketServerProtocol

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

@dataclass
class Peer:
    """Représente un peer connecté"""
    ws: WebSocketServerProtocol
    peer_id: str
    username: str
    room: Optional[str] = None

@dataclass
class Room:
    """Représente une room/salon"""
    code: str
    host_id: str
    peers: dict[str, Peer] = field(default_factory=dict)

class SignalingServer:
    def __init__(self):
        self.peers: dict[str, Peer] = {}  # peer_id -> Peer
        self.rooms: dict[str, Room] = {}  # room_code -> Room
        self.ws_to_peer: dict[WebSocketServerProtocol, str] = {}  # ws -> peer_id

    async def handle_connection(self, ws: WebSocketServerProtocol):
        """Gère une nouvelle connexion WebSocket"""
        peer_id = None
        try:
            async for message in ws:
                try:
                    data = json.loads(message)
                    peer_id = await self.handle_message(ws, data)
                except json.JSONDecodeError:
                    await self.send_error(ws, "Invalid JSON")
                except Exception as e:
                    logger.error(f"Error handling message: {e}")
                    await self.send_error(ws, str(e))
        except websockets.exceptions.ConnectionClosed:
            logger.info(f"Connection closed for peer: {peer_id}")
        finally:
            if peer_id:
                await self.handle_disconnect(peer_id)

    async def handle_message(self, ws: WebSocketServerProtocol, data: dict) -> Optional[str]:
        """Traite un message entrant"""
        msg_type = data.get("type")
        peer_id = self.ws_to_peer.get(ws)

        if msg_type == "register":
            return await self.handle_register(ws, data)
        elif msg_type == "host":
            return await self.handle_host(ws, data, peer_id)
        elif msg_type == "join":
            return await self.handle_join(ws, data, peer_id)
        elif msg_type == "signal":
            await self.handle_signal(data, peer_id)
        elif msg_type == "broadcast":
            await self.handle_broadcast(data, peer_id)
        elif msg_type == "message":
            await self.handle_direct_message(data, peer_id)
        elif msg_type == "leave":
            await self.handle_leave(peer_id)
        else:
            await self.send_error(ws, f"Unknown message type: {msg_type}")

        return peer_id

    async def handle_register(self, ws: WebSocketServerProtocol, data: dict) -> str:
        """Enregistre un nouveau peer"""
        peer_id = data.get("peerId")
        username = data.get("username", "Inconnu")

        if not peer_id:
            import uuid
            peer_id = str(uuid.uuid4())[:8]

        # Si ce peer_id existe déjà, le déconnecter
        if peer_id in self.peers:
            old_peer = self.peers[peer_id]
            await self.handle_disconnect(peer_id)
            try:
                await old_peer.ws.close()
            except:
                pass

        peer = Peer(ws=ws, peer_id=peer_id, username=username)
        self.peers[peer_id] = peer
        self.ws_to_peer[ws] = peer_id

        logger.info(f"Peer registered: {peer_id} ({username})")

        await self.send(ws, {
            "type": "registered",
            "peerId": peer_id
        })

        return peer_id

    async def handle_host(self, ws: WebSocketServerProtocol, data: dict, peer_id: str) -> str:
        """Crée une nouvelle room en tant qu'hôte"""
        if not peer_id:
            await self.send_error(ws, "Must register first")
            return peer_id

        room_code = data.get("room")
        if not room_code:
            await self.send_error(ws, "Room code required")
            return peer_id

        # Vérifier si la room existe déjà
        if room_code in self.rooms:
            await self.send(ws, {
                "type": "error",
                "error": "room-exists",
                "message": "Ce code serveur est déjà utilisé"
            })
            return peer_id

        # Créer la room
        peer = self.peers[peer_id]
        peer.room = room_code

        room = Room(code=room_code, host_id=peer_id)
        room.peers[peer_id] = peer
        self.rooms[room_code] = room

        logger.info(f"Room created: {room_code} by {peer_id}")

        await self.send(ws, {
            "type": "hosted",
            "room": room_code
        })

        return peer_id

    async def handle_join(self, ws: WebSocketServerProtocol, data: dict, peer_id: str) -> str:
        """Rejoint une room existante"""
        if not peer_id:
            await self.send_error(ws, "Must register first")
            return peer_id

        room_code = data.get("room")
        if not room_code:
            await self.send_error(ws, "Room code required")
            return peer_id

        # Vérifier si la room existe
        if room_code not in self.rooms:
            await self.send(ws, {
                "type": "error",
                "error": "room-not-found",
                "message": "Serveur introuvable"
            })
            return peer_id

        room = self.rooms[room_code]
        peer = self.peers[peer_id]
        peer.room = room_code

        # Informer les autres peers de la room
        existing_peers = []
        for other_id, other_peer in room.peers.items():
            existing_peers.append({
                "peerId": other_id,
                "username": other_peer.username,
                "isHost": other_id == room.host_id
            })
            # Notifier le peer existant du nouveau venu
            await self.send(other_peer.ws, {
                "type": "peer-joined",
                "peerId": peer_id,
                "username": peer.username
            })

        # Ajouter le peer à la room
        room.peers[peer_id] = peer

        logger.info(f"Peer {peer_id} joined room {room_code}")

        # Envoyer la confirmation avec la liste des peers
        await self.send(ws, {
            "type": "joined",
            "room": room_code,
            "peers": existing_peers,
            "hostId": room.host_id
        })

        return peer_id

    async def handle_signal(self, data: dict, peer_id: str):
        """Relaye un signal WebRTC (offer/answer/ice) à un peer"""
        if not peer_id:
            return

        target_id = data.get("to")
        signal_data = data.get("data")

        if not target_id or not signal_data:
            return

        if target_id not in self.peers:
            logger.warning(f"Signal target not found: {target_id}")
            return

        target = self.peers[target_id]
        await self.send(target.ws, {
            "type": "signal",
            "from": peer_id,
            "data": signal_data
        })

    async def handle_broadcast(self, data: dict, peer_id: str):
        """Broadcast un message à tous les peers de la room"""
        if not peer_id or peer_id not in self.peers:
            return

        peer = self.peers[peer_id]
        if not peer.room or peer.room not in self.rooms:
            return

        room = self.rooms[peer.room]
        message_data = data.get("data")

        for other_id, other_peer in room.peers.items():
            if other_id != peer_id:
                await self.send(other_peer.ws, {
                    "type": "broadcast",
                    "from": peer_id,
                    "data": message_data
                })

    async def handle_direct_message(self, data: dict, peer_id: str):
        """Envoie un message direct à un peer"""
        if not peer_id:
            return

        target_id = data.get("to")
        message_data = data.get("data")

        if not target_id or target_id not in self.peers:
            return

        target = self.peers[target_id]
        await self.send(target.ws, {
            "type": "message",
            "from": peer_id,
            "data": message_data
        })

    async def handle_leave(self, peer_id: str):
        """Gère le départ volontaire d'un peer"""
        await self.handle_disconnect(peer_id)

    async def handle_disconnect(self, peer_id: str):
        """Gère la déconnexion d'un peer"""
        if peer_id not in self.peers:
            return

        peer = self.peers[peer_id]
        room_code = peer.room

        # Retirer de la room
        if room_code and room_code in self.rooms:
            room = self.rooms[room_code]
            if peer_id in room.peers:
                del room.peers[peer_id]

            # Notifier les autres peers
            for other_id, other_peer in room.peers.items():
                await self.send(other_peer.ws, {
                    "type": "peer-left",
                    "peerId": peer_id
                })

            # Si l'hôte part ou la room est vide, supprimer la room
            if peer_id == room.host_id or len(room.peers) == 0:
                # Notifier tous les peers que la room ferme
                for other_id, other_peer in list(room.peers.items()):
                    await self.send(other_peer.ws, {
                        "type": "room-closed",
                        "reason": "host-left" if peer_id == room.host_id else "empty"
                    })
                    other_peer.room = None
                del self.rooms[room_code]
                logger.info(f"Room {room_code} closed")

        # Nettoyer
        if peer.ws in self.ws_to_peer:
            del self.ws_to_peer[peer.ws]
        del self.peers[peer_id]

        logger.info(f"Peer disconnected: {peer_id}")

    async def send(self, ws: WebSocketServerProtocol, data: dict):
        """Envoie un message JSON"""
        try:
            await ws.send(json.dumps(data))
        except websockets.exceptions.ConnectionClosed:
            pass

    async def send_error(self, ws: WebSocketServerProtocol, message: str):
        """Envoie un message d'erreur"""
        await self.send(ws, {
            "type": "error",
            "message": message
        })

async def main():
    server = SignalingServer()

    async with websockets.serve(
        server.handle_connection,
        "0.0.0.0",
        8765,
        ping_interval=30,
        ping_timeout=10
    ):
        logger.info("Serveur de signaling démarré sur ws://0.0.0.0:8765")
        await asyncio.Future()  # Run forever

if __name__ == "__main__":
    asyncio.run(main())
