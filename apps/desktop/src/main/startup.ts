/**
 * Starting Amp with the operating system.
 *
 * Electron owns this, not the settings file: `app.setLoginItemSettings` is what
 * the OS reads at login, and a checkbox that only remembered a preference
 * without registering anything would be a lie. The setting and the login item
 * are written together, and the interface reads back what the OS says.
 */

import { app } from "electron";
import type { Settings } from "@amp/core";

export interface StartupState {
  /** False where the platform has no login-item concept we can drive. */
  supported: boolean;
  openAtLogin: boolean;
  startHidden: boolean;
}

export function applyLoginItem(settings: Pick<Settings, "desktop">): StartupState {
  const startHidden = Boolean(settings.desktop?.startHidden);
  const openAtLogin = Boolean(settings.desktop?.launchOnStartup);
  try {
    app.setLoginItemSettings({
      openAtLogin,
      // The window stays closed on a hidden start; the tray and the global
      // shortcut are how it is brought back. `openAsHidden` only exists on
      // macOS, so it is passed through a wide type rather than pretended about.
      ...({ openAsHidden: startHidden } as Record<string, unknown>),
      args: startHidden ? ["--hidden"] : [],
    });
  } catch {
    /* Not supported here: the checkbox will say so rather than claim success. */
  }
  const item = app.getLoginItemSettings();
  return {
    supported: process.platform !== "linux",
    openAtLogin: item.openAtLogin ?? openAtLogin,
    startHidden,
  };
}

/** Was this launch the one the login item started? */
export function startedHidden(): boolean {
  return process.argv.includes("--hidden") && Boolean(app.getLoginItemSettings().wasOpenedAtLogin);
}
