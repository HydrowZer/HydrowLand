import { check, Update } from "@tauri-apps/plugin-updater";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { listen } from "@tauri-apps/api/event";

type UpdateListener = (state: UpdateState) => void;

export interface UpdateState {
  status: "idle" | "checking" | "available" | "downloading" | "ready" | "error";
  progress: number;
  error: string | null;
  update: Update | null;
  showBanner: boolean;
}

class UpdateService {
  private state: UpdateState = {
    status: "idle",
    progress: 0,
    error: null,
    update: null,
    showBanner: false,
  };

  private listeners: Set<UpdateListener> = new Set();

  subscribe(listener: UpdateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((listener) => listener(this.state));
  }

  private setState(partial: Partial<UpdateState>) {
    this.state = { ...this.state, ...partial };
    this.notify();
  }

  getState(): UpdateState {
    return this.state;
  }

  hideBanner() {
    this.setState({ showBanner: false });
  }

  async checkForUpdates(manual = false): Promise<void> {
    try {
      this.setState({ status: "checking", error: null });

      const updateInfo = await check();

      if (updateInfo) {
        this.setState({
          update: updateInfo,
          status: "available",
          showBanner: true,
        });
      } else {
        this.setState({ status: "idle" });
        if (manual) {
          await message("Tu utilises déjà la dernière version.", {
            title: "Aucune mise à jour",
            kind: "info",
          });
        }
      }
    } catch (err) {
      console.error("Update check failed:", err);
      this.setState({
        error: String(err),
        status: "error",
      });
      if (manual) {
        await message(`Erreur lors de la vérification : ${err}`, {
          title: "Erreur",
          kind: "error",
        });
      }
    }
  }

  async downloadAndInstall(): Promise<void> {
    const { update } = this.state;
    if (!update) return;

    try {
      this.setState({ status: "downloading", progress: 0 });

      let totalSize = 0;
      let downloadedSize = 0;

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            totalSize = event.data.contentLength || 0;
            console.log("Download started, total:", totalSize);
            break;
          case "Progress":
            downloadedSize += event.data.chunkLength || 0;
            const percent = totalSize > 0 ? Math.round((downloadedSize / totalSize) * 100) : 0;
            this.setState({ progress: Math.min(percent, 100) });
            break;
          case "Finished":
            console.log("Download finished");
            break;
        }
      });

      this.setState({ status: "ready" });

      const shouldRelaunch = await ask(
        "La mise à jour a été installée. Voulez-vous redémarrer l'application maintenant ?",
        {
          title: "Mise à jour prête",
          kind: "info",
        }
      );

      if (shouldRelaunch) {
        await relaunch();
      }
    } catch (err) {
      console.error("Update download failed:", err);
      this.setState({
        error: String(err),
        status: "error",
      });
    }
  }

  async relaunchApp(): Promise<void> {
    await relaunch();
  }

  // Listen for menu event from Rust
  setupMenuListener(): void {
    listen("check-for-updates", () => {
      this.checkForUpdates(true);
    });
  }
}

export const updateService = new UpdateService();

// Setup menu listener immediately
updateService.setupMenuListener();
