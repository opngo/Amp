/**
 * Tray icon and its menu.
 *
 * Amp keeps playing when the window is closed: closing hides to tray, and the
 * tray (plus a global shortcut, configurable in Settings) brings it back. The
 * tray menu mirrors the most used transport controls.
 */

import { Menu, Tray, app, nativeImage } from "electron";
import path from "node:path";
import type { Book, PlaybackState, Settings } from "@amp/core";
import { formatDuration } from "@amp/core";
import { focusMainWindow, getMainWindow, sendCommand, setMini } from "./windows";

let tray: Tray | null = null;

export interface TrayHooks {
  settings(): Settings;
  nowPlaying(): { book?: Book; state: PlaybackState } | undefined;
  quit(): void;
}

function trayIcon(): Electron.NativeImage {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, "tray.png")
    : path.join(__dirname, "../../resources/tray.png");
  const image = nativeImage.createFromPath(base);
  if (process.platform === "darwin") {
    image.setTemplateImage(true);
  }
  return image.isEmpty() ? nativeImage.createEmpty() : image;
}

function trackLabel(playing: { book?: Book; state: PlaybackState } | undefined): string {
  const book = playing?.book;
  if (!book) return "Nothing playing";
  const position = playing?.state.position ?? 0;
  return `${book.title} - ${formatDuration(position)}`;
}

export function createTray(hooks: TrayHooks): Tray {
  tray = new Tray(trayIcon());
  tray.setToolTip("Amp - audiobooks");
  updateTrayMenu(hooks);
  tray.on("click", () => focusMainWindow());
  tray.on("double-click", () => focusMainWindow());
  return tray;
}

export function updateTrayMenu(hooks: TrayHooks): void {
  if (!tray) return;
  const playing = hooks.nowPlaying();
  const state = playing?.state;
  const settings = hooks.settings();
  const isPlaying = Boolean(state?.playing);

  const menu = Menu.buildFromTemplate([
    { label: trackLabel(playing), enabled: false },
    ...(playing?.book
      ? ([
          { type: "separator" as const },
          {
            label: isPlaying ? "Pause" : "Play",
            click: () => sendCommand("toggle"),
          },
          { label: "Next chapter", click: () => sendCommand("nextChapter") },
          { label: "Previous chapter", click: () => sendCommand("prevChapter") },
          { label: `Skip forward ${settings.playback.skipSeconds}s`, click: () => sendCommand("skipForward") },
          { label: `Skip back ${settings.playback.skipBackSeconds}s`, click: () => sendCommand("skipBack") },
          { type: "separator" as const },
          { label: "Add bookmark", click: () => sendCommand("bookmark") },
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    { type: "separator" },
    { label: "Show Amp", click: () => focusMainWindow() },
    {
      label: "Mini player",
      type: "checkbox",
      checked: settings.window.mini,
      click: (item) => {
        setMini(item.checked, { ...settings, window: { ...settings.window, mini: item.checked } });
      },
    },
    {
      label: "Always on top",
      type: "checkbox",
      checked: settings.window.alwaysOnTop,
      click: (item) => sendCommand("alwaysOnTop", item.checked),
    },
    { type: "separator" },
    { label: "Preferences", click: () => {
        focusMainWindow();
        sendCommand("route", "settings");
      } },
    { label: "Quit Amp", click: () => hooks.quit() },
  ]);

  tray.setContextMenu(menu);
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}

export function trayExists(): boolean {
  return Boolean(tray);
}

export function windowVisible(): boolean {
  const window = getMainWindow();
  return Boolean(window?.isVisible());
}
