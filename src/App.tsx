import { useServerStore } from "./stores/serverStore";
import { ServerLobby } from "./components/server/ServerLobby";
import { ServerView } from "./components/server/ServerView";

function App() {
  const { serverInfo } = useServerStore();

  // Si pas connecté à un serveur, afficher le lobby
  if (!serverInfo) {
    return <ServerLobby />;
  }

  // Sinon afficher le serveur
  return <ServerView />;
}

export default App;
