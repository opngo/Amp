/**
 * The stores on `window.__amp`.
 *
 * Amp is a local application: the same window that runs the interface is the
 * one somebody debugs, and the desktop build has DevTools a keystroke away.
 * Having the stores reachable there means a question like "what does the
 * library think this book is" is answered in the console instead of guessed at.
 * The visual smoke test uses the same handle to drive the interface.
 *
 * This is a handle, not an API: it is not imported by anything the interface
 * renders, and nothing depends on it being there.
 */

import { audioDiagnostics, engine } from "../audio/audioEngine";
import { useLibraryStore } from "../store/useLibraryStore";
import { usePlayerStore } from "../store/usePlayerStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { useUiStore } from "../store/useUiStore";

export interface DebugHandles {
  /** The audio engine: the media element, the graph, the last few lines of log. */
  engine: typeof engine;
  audioDiagnostics: typeof audioDiagnostics;
  library: typeof useLibraryStore;
  player: typeof usePlayerStore;
  settings: typeof useSettingsStore;
  ui: typeof useUiStore;
  version: string;
}

export function exposeDebugHandles(): void {
  if (typeof window === "undefined") return;
  const target = window as unknown as { __amp?: DebugHandles };
  target.__amp = {
    engine,
    audioDiagnostics,
    library: useLibraryStore,
    player: usePlayerStore,
    settings: useSettingsStore,
    ui: useUiStore,
    version: "0.9.0",
  };
}
