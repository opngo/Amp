import React from "react";
import ReactDOM from "react-dom/client";
import { Reshaped } from "reshaped";
// Order matters: the theme tokens first (spacing, type, radii), then the
// component styles, then Amp's own bridge and layout.
// Inter: the open source stand-in for SF Pro, so the interface looks the same
// on Windows and Linux as it does on a Mac. Systems that have the real SF Pro
// use it first - see the font stacks in styles/globals.css.
import "@fontsource-variable/inter";
import "reshaped/themes/slate/theme.css";
import "reshaped/bundle.css";
import "./styles/reshaped.css";
import "./styles/globals.css";
import { App } from "./App";
import { getBridge, isConnected } from "./platform/bridge";
import { useLibraryStore } from "./store/useLibraryStore";
import { usePlayerStore } from "./store/usePlayerStore";
import { useSettingsStore } from "./store/useSettingsStore";
import { useUiStore } from "./store/useUiStore";
import { engine } from "./audio/audioEngine";

// A handle for the smoke tests: the engine owns the audio element, which is not
// part of the DOM, so there is no other way to look at it from outside.
if (typeof window !== "undefined") window.__ampEngine = engine;

async function boot() {
  // Resolve the host first (Electron preload, or an Amp server in a browser) so
  // every store has a backend before the first paint.
  getBridge()
    .then(() => {
      useUiStore.getState().setConnected(isConnected());
      return useSettingsStore.getState().load();
    })
    .then(() => usePlayerStore.getState().bind())
    .then(() => useLibraryStore.getState().load())
    // Reopen the last book paused where it stopped, so the player is there the
    // moment the window appears.
    .then(() => usePlayerStore.getState().restoreLastBook())
    .catch((error: unknown) => {
      useUiStore.getState().toast({
        title: "Could not reach the host",
        description: error instanceof Error ? error.message : String(error),
        tone: "danger",
      });
    })
    .finally(() => useUiStore.getState().setReady(true));

  const root = document.getElementById("root");
  if (!root) throw new Error("#root is missing");

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <Reshaped theme="slate" defaultColorMode="light" defaultViewport="l">
        <App />
      </Reshaped>
    </React.StrictMode>,
  );
}

void boot();
