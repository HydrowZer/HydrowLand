import { useServerStore } from "./stores/serverStore";
import { ServerLobby } from "./components/server/ServerLobby";
import { ServerView } from "./components/server/ServerView";
import { ScreenViewerPage } from "./pages/ScreenViewerPage";
import { ThemeProvider } from "./contexts/ThemeContext";
import { UpdateChecker } from "./components/ui/UpdateChecker";

function AppContent() {
  const { serverInfo } = useServerStore();

  // Check if we're in the screen viewer window
  const isScreenViewerWindow = window.location.hash === "#screen-viewer";

  if (isScreenViewerWindow) {
    return <ScreenViewerPage />;
  }

  // Si pas connecté à un serveur, afficher le lobby
  if (!serverInfo) {
    return (
      <>
        <ServerLobby />
        <UpdateChecker />
      </>
    );
  }

  // Sinon afficher le serveur
  return (
    <>
      <ServerView />
      <UpdateChecker />
    </>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

export default App;
