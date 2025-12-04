# HydrowLand

Application de communication P2P (peer-to-peer) pour discuter et partager avec vos amis.

## Fonctionnalités

- **Chat en temps réel** - Messagerie instantanée entre pairs
- **Communication vocale** - Audio en temps réel avec suppression du bruit
- **Partage d'écran** - Partagez votre écran avec les autres utilisateurs
- **Architecture P2P** - Connexion directe entre utilisateurs via WebRTC, sans serveur central
- **Mises à jour automatiques** - Recevez les dernières versions automatiquement

## Technologies

- **Frontend** : React + TypeScript + Tailwind CSS
- **Backend** : Rust + Tauri 2.x
- **Communication** : WebRTC (webrtc-rs)
- **Audio** : Opus codec + suppression du bruit (nnnoiseless)

## Installation

### Téléchargement

Rendez-vous sur la page [Releases](https://github.com/HydrowZer/HydrowLand/releases) pour télécharger la dernière version :

- **macOS (Apple Silicon)** : `.dmg`
- **Windows** : `.msi` ou `.exe`
- **Linux** : `.AppImage` ou `.deb`

### Compilation depuis les sources

#### Prérequis

- Node.js 20+
- Rust (stable)
- Dépendances système :
  - **macOS** : `brew install opus`
  - **Ubuntu/Debian** : `sudo apt-get install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev libasound2-dev libopus-dev libpipewire-0.3-dev libgbm-dev`

#### Build

```bash
# Installer les dépendances
npm ci

# Lancer en mode développement
npm run tauri dev

# Compiler pour la production
npm run tauri build
```

## Utilisation

1. **Héberger un serveur** - Cliquez sur "Héberger" et partagez votre adresse IP avec vos amis
2. **Rejoindre un serveur** - Entrez l'adresse IP de l'hôte pour vous connecter
3. **Communiquer** - Utilisez le chat, activez le micro, ou partagez votre écran

## Licence

MIT
