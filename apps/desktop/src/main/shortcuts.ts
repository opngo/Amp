/**
 * Global shortcuts (they work when Amp is in the tray or behind other apps)
 * plus in-app accelerators that the renderer handles itself.
 */

import { globalShortcut } from "electron";
import { eventToAccelerator, isSafeGlobalAccelerator, prettyAccelerator } from "@amp/core";
import { focusMainWindow, sendCommand } from "./windows";
import { logLine } from "./store";

/**
 * The actions Amp registers globally. Everything else stays in-app so it can
 * never steal keys from other applications.
 */
export const GLOBAL_ACTION_DEFAULTS: Record<string, string> = {
  playPause: "MediaPlayPause",
  nextTrack: "MediaNextTrack",
  previousTrack: "MediaPreviousTrack",
  showWindow: "CommandOrControl+Shift+A",
};

export interface RegisterResult {
  ok: boolean;
  registered: string[];
  failed: string[];
  /** Bindings left to the in-app handler because a global grab would be rude. */
  inApp?: string[];
}

/** Register the user's global bindings, skipping ones the OS refuses. */
export async function registerGlobalShortcuts(bindings: Record<string, string>): Promise<RegisterResult> {
  globalShortcut.unregisterAll();
  const registered: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];

  for (const [action, accelerator] of Object.entries(bindings)) {
    if (!accelerator) continue;
    const pretty = prettyAccelerator(accelerator);
    // A plain key registered globally is taken from every other application,
    // and from Amp's own window: the renderer then never sees Space or P.
    // Those stay in-app, where the keydown handler picks them up.
    if (!isSafeGlobalAccelerator(accelerator)) {
      skipped.push(`${pretty} -> ${action}`);
      continue;
    }
    try {
      const ok = globalShortcut.register(accelerator, () => {
        if (action === "showWindow") focusMainWindow();
        else if (action === "playPause") sendCommand("toggle");
        else if (action === "nextTrack") sendCommand("nextChapter");
        else if (action === "previousTrack") sendCommand("prevChapter");
        else sendCommand(action);
      });
      if (ok) registered.push(`${pretty} -> ${action}`);
      else failed.push(pretty);
    } catch (error) {
      failed.push(pretty);
      await logLine(
        `shortcuts: ${accelerator} rejected - ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  await logLine(
    `shortcuts: registered ${registered.length}, failed ${failed.length}, in-app ${skipped.length}` +
      (skipped.length ? ` (${skipped.join(", ")})` : ""),
  );
  return { ok: failed.length === 0, registered, failed, inApp: skipped };
}

export function unregisterGlobalShortcuts(): void {
  globalShortcut.unregisterAll();
}

export function shortcutFromEvent(event: Electron.Input): string | null {
  return eventToAccelerator({
    key: event.key,
    code: event.code,
    control: event.control,
    meta: event.meta,
    alt: event.alt,
    shift: event.shift,
  } as never);
}

export { sendCommand, focusMainWindow };
