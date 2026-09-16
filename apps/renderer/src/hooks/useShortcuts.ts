/**
 * Wires the shortcut table to real input events and to the OS/global
 * shortcuts registered by the Electron main process.
 */

import { useEffect } from "react";
import {
  DEFAULT_SHORTCUTS,
  globalShortcutPayload,
  matchesShortcut,
  SHORTCUT_ACTIONS,
  shortcutFor,
  type Settings,
} from "@amp/core";

/** Host level keys that are not part of the editable table. */
const GLOBAL_HOST_DEFAULTS: Record<string, string> = {
  showWindow: "CommandOrControl+Shift+A",
  nextTrack: "MediaNextTrack",
  previousTrack: "MediaPreviousTrack",
};
import { VISUALIZER_MODES } from "../audio/visualizer";
import { bridgeIfReady } from "../platform/bridge";
import { handleCommand, usePlayerStore } from "../store/usePlayerStore";
import { useLibraryStore } from "../store/useLibraryStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { useUiStore } from "../store/useUiStore";

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || element.isContentEditable;
}

export function useShortcuts(): void {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);

  // Only the actions that are meant to work while Amp is in the tray are handed
  // to the operating system. Everything else stays here: registering Space or P
  // globally takes the key away from this window, which is the opposite of what
  // a play/pause shortcut is for.
  useEffect(() => {
    const host = bridgeIfReady();
    if (!host) return;
    void host.player.setGlobalShortcuts(globalShortcutPayload(settings.shortcuts, GLOBAL_HOST_DEFAULTS));
  }, [settings.shortcuts]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const bindings = { ...DEFAULT_SHORTCUTS, ...settings.shortcuts };
      const typing = isTypingTarget(event.target);
      const modifier = event.ctrlKey || event.metaKey || event.altKey;

      for (const action of SHORTCUT_ACTIONS) {
        const accelerator = shortcutFor({ shortcuts: bindings }, action.id);
        if (!accelerator || !matchesShortcut(event, accelerator)) continue;
        if (typing && !modifier) continue; // never steal plain keys while typing
        event.preventDefault();
        runAction(action.id);
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settings.shortcuts, update]);
}

/** The human name of a visualizer shape, for toasts and menus. */
function labelForMode(mode: string): string {
  return VISUALIZER_MODES.find((entry) => entry.value === mode)?.label ?? mode;
}

/** Shared entry point for in-app shortcuts, tray commands and media keys. */
export function runAction(id: string): void {
  const player = usePlayerStore.getState();
  const library = useLibraryStore.getState();
  const ui = useUiStore.getState();
  const settings = useSettingsStore.getState();

  switch (id) {
    case "playPause":
    case "playPauseGlobal":
      void player.toggle();
      break;
    case "nextChapter":
      void player.nextChapter();
      break;
    case "prevChapter":
      void player.prevChapter();
      break;
    case "nextBook":
      void player.nextBook();
      break;
    case "prevBook":
      void player.prevBook();
      break;
    case "skipForward":
      player.skip(settings.settings.playback.skipSeconds);
      break;
    case "skipBack":
      player.skip(-settings.settings.playback.skipBackSeconds);
      break;
    case "skipForwardLong":
      player.skip(60);
      break;
    case "skipBackLong":
      player.skip(-60);
      break;
    case "speedUp":
      player.nudgeSpeed(1);
      break;
    case "speedDown":
      player.nudgeSpeed(-1);
      break;
    case "resetSpeed":
      player.setSpeed(1);
      break;
    case "volumeUp":
      player.setVolume(Math.min(1.5, player.state.volume + 0.05));
      break;
    case "volumeDown":
      player.setVolume(Math.max(0, player.state.volume - 0.05));
      break;
    case "mute":
      player.toggleMute();
      break;
    case "bookmark":
      void player.addBookmark().then(() => ui.toast({ title: "Bookmark added", tone: "success" }));
      break;
    case "sleepTimer":
      ui.openDialog({ kind: "sleep" });
      break;
    case "eq":
      void settings.update({ equalizer: { enabled: !settings.settings.equalizer.enabled } });
      ui.toast({
        title: settings.settings.equalizer.enabled ? "Equalizer off" : "Equalizer on",
        tone: "info",
      });
      break;
    case "visualizer": {
      // The list of shapes lives with the drawing code, so a new shape is
      // reachable from the keyboard the moment it exists.
      const modes = VISUALIZER_MODES.map((entry) => entry.value);
      const current = modes.indexOf(settings.settings.visualizer.mode);
      const next = modes[(current + 1) % modes.length];
      void settings.update({ visualizer: { mode: next } });
      ui.toast({ title: `Visualizer: ${labelForMode(next)}`, tone: "info" });
      break;
    }
    case "togglePlayer":
      ui.setPlayerVisible(!ui.playerVisible);
      break;
    case "immersive":
      ui.setPlayerFullscreen(!ui.playerFullscreen);
      break;
    case "focusSearch":
      // The only search field lives in the sidebar; focus it wherever we are.
      document.getElementById("amp-search-input")?.focus();
      break;
    case "goLibrary":
      ui.setRoute("library");
      break;
    case "goPlayer":
      ui.setRoute("nowplaying");
      break;
    case "goDownloads":
      ui.setRoute("search");
      break;
    case "goPlaylists":
      ui.setRoute("playlists");
      break;
    case "goQueue":
      ui.setRoute("queue");
      break;
    case "goSettings":
      ui.setRoute("settings");
      break;
    case "importFiles":
      void library.importFromDialog("files").then((result) => {
        if (result.added) ui.toast({ title: `${result.added} book(s) imported`, tone: "success" });
      });
      break;
    case "importFolder":
      void library.importFromDialog("folder").then((result) => {
        if (result.added) ui.toast({ title: `${result.added} book(s) imported`, tone: "success" });
      });
      break;
    case "rescan":
      void library
        .rescan()
        .then((result) =>
          ui.toast({ title: `Library scanned - ${result.books.length} new/updated`, tone: "success" }),
        );
      break;
    case "toggleMini":
      ui.setMini(!ui.mini);
      void settings.update({ window: { mini: !ui.mini } });
      break;
    case "toggleTray":
      void bridgeIfReady()?.player.hideToTray();
      break;
    case "wake":
      void bridgeIfReady()?.player.wake();
      break;
    case "alwaysOnTop": {
      const next = !settings.settings.window.alwaysOnTop;
      void settings.update({ window: { alwaysOnTop: next } });
      void bridgeIfReady()?.player.setAlwaysOnTop(next);
      break;
    }
    case "toggleFullscreen":
      void bridgeIfReady()?.player.window("fullscreen");
      break;
    case "stats":
      ui.setRoute("stats");
      break;
    case "transcribe":
      ui.openDialog({ kind: "transcribe", bookId: player.state.bookId ?? ui.selectedBookId ?? "" });
      break;
    case "quit":
      void bridgeIfReady()?.player.quit();
      break;
    default:
      void handleCommand(id);
  }
}

export function useHostCommands(): void {
  useEffect(() => {
    const host = bridgeIfReady();
    if (!host) return;
    return host.player.onCommand((command) => runAction(command));
  }, []);
}

/** Settings helper used by the shortcut editor. */
export function bindingFor(settings: Settings, id: string): string {
  return shortcutFor(settings, id);
}
