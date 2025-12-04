import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

let viewerWindow: WebviewWindow | null = null;

/**
 * Open the screen share viewer in a new window
 */
export async function openScreenViewerWindow(): Promise<void> {
  // Close existing window if any
  if (viewerWindow) {
    try {
      await viewerWindow.close();
    } catch {
      // Window might already be closed
    }
    viewerWindow = null;
  }

  // Create new window
  viewerWindow = new WebviewWindow("screen-viewer", {
    url: "index.html#screen-viewer",
    title: "Partage d'écran - HydrowLand",
    width: 1280,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    resizable: true,
    center: true,
    decorations: true,
    alwaysOnTop: false,
    focus: true,
  });

  // Listen for window close event
  viewerWindow.once("tauri://destroyed", () => {
    viewerWindow = null;
  });

  // Wait for window to be created
  await new Promise<void>((resolve, reject) => {
    viewerWindow!.once("tauri://created", () => resolve());
    viewerWindow!.once("tauri://error", (e) => reject(e));
  });
}

/**
 * Close the screen share viewer window if open
 */
export async function closeScreenViewerWindow(): Promise<void> {
  if (viewerWindow) {
    try {
      await viewerWindow.close();
    } catch {
      // Window might already be closed
    }
    viewerWindow = null;
  }
}

/**
 * Check if the viewer window is open
 */
export function isScreenViewerWindowOpen(): boolean {
  return viewerWindow !== null;
}
