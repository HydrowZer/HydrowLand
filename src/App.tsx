import { useServerStore } from "./stores/serverStore";
import { ServerLobby } from "./components/server/ServerLobby";
import { ServerView } from "./components/server/ServerView";
import { ScreenViewerPage } from "./pages/ScreenViewerPage";

function App() {
  const { serverInfo } = useServerStore();

  // Check if we're in the screen viewer window
  const isScreenViewerWindow = window.location.hash === "#screen-viewer";

  if (isScreenViewerWindow) {
    return <ScreenViewerPage />;
  }

  // Si pas connecté à un serveur, afficher le lobby
  if (!serverInfo) {
    return <ServerLobby />;
  }

  // Sinon afficher le serveur
  return <ServerView />;
}

export default App;
