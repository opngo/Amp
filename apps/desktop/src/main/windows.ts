/**
 * Window management.
 *
 * Amp runs in one window that can shrink into the portrait mini player - no
 * second window, no lost playback state, and the tray can always bring it
 * back. Bounds and mini size are persisted so the widget reappears exactly
 * where it was left.
 */

import { BrowserWindow, screen, shell } from "electron";
import path from "node:path";
import type { Settings } from "@amp/core";

export interface WindowState {
  mini: boolean;
  focused: boolean;
  alwaysOnTop: boolean;
}

type Emit = (channel: string, payload: unknown) => void;

let mainWindow: BrowserWindow | null = null;
let mini = false;
/** True while the window is parked next to the tray as a flyout. */
let flyout = false;
let flyoutRestore: Electron.Rectangle | null = null;
let restoreBounds: { x?: number; y?: number; width: number; height: number } | null = null;
let emit: Emit = () => undefined;

export function setWindowEmitter(fn: Emit): void {
  emit = fn;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function isMini(): boolean {
  return mini;
}

function windowState(): WindowState {
  return {
    mini,
    focused: mainWindow?.isFocused() ?? false,
    alwaysOnTop: mainWindow?.isAlwaysOnTop() ?? false,
  };
}

function broadcast(): void {
  emit("player:window-state", windowState());
}

export interface CreateWindowOptions {
  settings: Settings;
  devServerUrl?: string;
  rendererDir: string;
  preloadPath: string;
  onClose: () => void;
}

export function createMainWindow(options: CreateWindowOptions): BrowserWindow {
  const { settings, devServerUrl, rendererDir, preloadPath, onClose } = options;

  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: "#07080f",
    title: "Amp",
    // Amp draws no title bar of its own: on macOS the traffic lights sit over
    // the sidebar, and on Windows and Linux the window keeps its native frame.
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    ...(process.platform === "darwin" ? { trafficLightPosition: { x: 14, y: 14 } } : {}),
    frame: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      webSecurity: true,
    },
  });

  // Keep the preload path explicit: electron-vite compiles it to out/preload.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(path.join(rendererDir, "index.html"));
  }

  window.once("ready-to-show", () => {
    if (!settings.window.mini) window.show();
    window.setAlwaysOnTop(settings.window.alwaysOnTop);
  });

  window.on("focus", broadcast);
  window.on("blur", broadcast);
  window.on("close", () => {
    onClose();
  });
  window.on("closed", () => {
    mainWindow = null;
  });

  mainWindow = window;
  return window;
}

/** Show or hide the widget; the window itself is resized, never recreated. */
export function setMini(next: boolean, settings: Settings): void {
  const window = mainWindow;
  if (!window) return;
  if (next === mini) return;

  if (next) {
    const bounds = window.getBounds();
    restoreBounds = bounds;
    const { width, height } = settings.window.miniSize;
    const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
    const x = Math.min(
      Math.max(bounds.x, display.workArea.x),
      display.workArea.x + display.workArea.width - width,
    );
    const y = Math.min(
      Math.max(bounds.y, display.workArea.y),
      display.workArea.y + display.workArea.height - height,
    );
    window.setResizable(true);
    window.setMinimumSize(300, 380);
    window.setBounds({ x, y, width, height }, true);
    window.setAlwaysOnTop(settings.window.widgetAlwaysOnTop, "floating");
    window.setSkipTaskbar(true);
    mini = true;
    window.show();
    window.focus();
  } else {
    const target = restoreBounds ?? { width: 1180, height: 780 };
    window.setMinimumSize(720, 480);
    window.setBounds(target, true);
    window.setAlwaysOnTop(settings.window.alwaysOnTop);
    window.setSkipTaskbar(false);
    mini = false;
    window.show();
    window.focus();
  }
  window.webContents.send("player:mini-changed", mini);
  broadcast();
}

export function setMiniSize(size: { width: number; height: number }): void {
  if (!mainWindow || !mini) return;
  mainWindow.setBounds({ ...mainWindow.getBounds(), width: size.width, height: size.height }, true);
  broadcast();
}

export function setAlwaysOnTop(value: boolean, settings: Settings): void {
  if (!mainWindow) return;
  mainWindow.setAlwaysOnTop(value);
  if (mini && !value) mainWindow.setAlwaysOnTop(false);
  void settings;
  broadcast();
}

/**
 * The flyout.
 *
 * A small always-on-top window that sits where the operating system puts its
 * own flyouts: the bottom right of the work area, next to the tray, out of the
 * taskbar. It is the same window and the same renderer - the player notices the
 * size and folds itself down to the compact layout - so nothing is recreated
 * and playback is never interrupted. Toggling it again puts the window back
 * exactly where it was.
 */
export function toggleFlyout(): boolean {
  const window = mainWindow;
  if (!window) return false;
  if (flyout) {
    window.setAlwaysOnTop(false);
    window.setSkipTaskbar(false);
    window.setMinimumSize(720, 480);
    window.setBounds(flyoutRestore ?? { width: 1180, height: 780 }, true);
    flyout = false;
    window.show();
    window.focus();
    broadcast();
    return false;
  }

  flyoutRestore = window.getBounds();
  const width = 520;
  const height = 292;
  const display = screen.getDisplayNearestPoint({ x: flyoutRestore.x, y: flyoutRestore.y });
  const x = display.workArea.x + display.workArea.width - width - 12;
  const y = display.workArea.y + display.workArea.height - height - 12;
  window.setMinimumSize(360, 220);
  window.setBounds({ x, y, width, height }, true);
  window.setAlwaysOnTop(true, "floating");
  window.setSkipTaskbar(true);
  flyout = true;
  window.show();
  window.focus();
  broadcast();
  return true;
}

export function isFlyout(): boolean {
  return flyout;
}

export function windowAction(action: "minimize" | "maximize" | "close" | "fullscreen" | "flyout"): void {
  const window = mainWindow;
  if (!window) return;
  switch (action) {
    case "minimize":
      window.minimize();
      break;
    case "maximize":
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
      break;
    case "fullscreen":
      window.setFullScreen(!window.isFullScreen());
      break;
    case "flyout":
      toggleFlyout();
      break;
    case "close":
      window.close();
      break;
  }
  broadcast();
}

/** Push a playback command from the tray, media keys or a global hotkey. */
export function sendCommand(command: string, payload?: unknown): void {
  mainWindow?.webContents.send("player:command", { command, payload });
}

export function focusMainWindow(): void {
  const window = mainWindow;
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

export function currentWindowState(): WindowState {
  return windowState();
}
