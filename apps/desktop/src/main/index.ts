/**
 * Amp desktop entry point.
 *
 * Boot order: load settings and the library from disk, register every IPC
 * handler, create the window, then attach the tray and the global shortcuts.
 * Closing the window hides Amp to the tray; quitting is explicit (menu, tray,
 * Ctrl+Q) so playback is never lost by accident.
 */

import { BrowserWindow, app, net, powerSaveBlocker, protocol } from "electron";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { mediaUrlToPath } from "@amp/core";
import { appState } from "./state";
import { ensureDirs, logLine } from "./store";
import { registerIpc } from "./ipc";
import { createMainWindow, focusMainWindow, getMainWindow, sendCommand, setWindowEmitter } from "./windows";
import { createTray, destroyTray, updateTrayMenu } from "./tray";
import { registerGlobalShortcuts, unregisterGlobalShortcuts } from "./shortcuts";
import { probeWhisper } from "./whisper";
import { hasFfmpeg } from "./chapters";
import { mediaErrorHeaders, planMediaResponse } from "./mediaResponse";
import { applyLoginItem, startedHidden } from "./startup";

void net; // kept for the media protocol helpers above

const isDev = !app.isPackaged;

/**
 * Audio and artwork are streamed from disk through a custom scheme instead of
 * `file://`, so seeking works in the dev server build too (an http page cannot
 * load file:// media). The scheme is privileged and only serves absolute paths.
 *
 * `corsEnabled` is not optional: the player reads with `crossOrigin =
 * "anonymous"` because WebAudio needs untainted samples, which turns every
 * request into a CORS request. Without it Chromium refuses the response before
 * the headers are even looked at, and the media element reports "no supported
 * source was found" - the same message as a missing codec, which is how this
 * stayed hidden.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: "amp-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true,
    },
  },
]);

async function handleMediaRequest(request: Request): Promise<Response> {
  // A preflight, or a HEAD: answer with the headers and no body.
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: mediaErrorHeaders() });

  // Accept both forms: the encoded form the preload builds, and a plain path
  // after the host (a hand written URL, or a bookmarked one).
  const filePath =
    mediaUrlToPath(request.url) ?? decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ""));
  if (!filePath) {
    return new Response("Missing path", { status: 400, headers: mediaErrorHeaders("missing-path") });
  }

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    // Worth a line in the log: a file that moved is the most common reason a
    // book stops playing, and the page only sees "unsupported source".
    const reason = (error as NodeJS.ErrnoException).code ?? "unreadable";
    void logLine(`media 404 ${filePath} (${reason})`);
    return new Response("Not found", { status: 404, headers: mediaErrorHeaders("not-found") });
  }
  if (!stat.isFile()) {
    void logLine(`media 404 ${filePath} (not a file)`);
    return new Response("Not a file", { status: 404, headers: mediaErrorHeaders("not-a-file") });
  }

  const plan = planMediaResponse({ filePath, size: stat.size, range: request.headers.get("range") });
  if (plan.status === 416) {
    return new Response(null, { status: 416, headers: plan.headers });
  }

  const stream =
    plan.status === 206
      ? createReadStream(filePath, { start: plan.start, end: plan.end })
      : createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    status: plan.status,
    headers: plan.headers,
  });
}

let quitting = false;
let blockerId: number | null = null;

// One Amp at a time: a second launch focuses the window that already runs.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => focusMainWindow());
  void main();
}

async function main(): Promise<void> {
  await app.whenReady();
  await ensureDirs();
  await appState.load();
  await logLine(
    `amp ${app.getVersion()} starting on ${process.platform} (electron ${process.versions.electron})`,
  );

  protocol.handle("amp-media", handleMediaRequest);
  registerIpc();
  setWindowEmitter((channel, payload) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload);
  });

  const preloadPath = path.join(__dirname, "../preload/index.js");
  const rendererDir = path.join(__dirname, "../renderer");
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;

  // The login item is registered from the settings file, so a machine that was
  // set up once keeps starting Amp after the settings were edited elsewhere.
  applyLoginItem(appState.settings);

  createMainWindow({
    settings: appState.settings,
    devServerUrl: isDev ? devServerUrl : undefined,
    rendererDir,
    preloadPath,
    onClose: () => {
      if (quitting) return;
      // Closing hides to the tray; the app keeps playing audio.
      getMainWindow()?.hide();
      updateTrayMenu(trayHooks);
    },
  });

  /*
   * Started by the login item with "start hidden" on: go straight to the tray.
   * Amp is a player, and a window that opens itself at every sign-in is the
   * fastest way to be uninstalled. The tray icon and the global shortcut are
   * already up by the time this runs.
   */
  if (startedHidden()) getMainWindow()?.hide();

  createTray(trayHooks);

  const shortcuts = await registerGlobalShortcuts({
    playPause: "MediaPlayPause",
    nextTrack: "MediaNextTrack",
    previousTrack: "MediaPreviousTrack",
    showWindow: appState.settings.shortcuts.showWindow ?? "CommandOrControl+Shift+A",
    nextChapter: appState.settings.shortcuts.nextChapter,
    previousChapter: appState.settings.shortcuts.previousChapter,
    skipForward: appState.settings.shortcuts.skipForward,
  });
  if (!shortcuts.ok) {
    await logLine(`shortcuts: could not register ${shortcuts.failed.join(", ")}`);
  }

  // Report optional feature availability once, so the UI can hide dead ends.
  const [ffmpeg, whisper] = await Promise.all([hasFfmpeg(), probeWhisper()]);
  await logLine(`features: ffmpeg=${ffmpeg} whisper=${whisper.available ? whisper.kind : "missing"}`);

  appState.on("playback", () => {
    updateTrayMenu(trayHooks);
    // Keep the machine awake while something is playing.
    if (appState.playback.playing) {
      if (blockerId === null) blockerId = powerSaveBlocker.start("prevent-app-suspension");
    } else if (blockerId !== null) {
      powerSaveBlocker.stop(blockerId);
      blockerId = null;
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow({
        settings: appState.settings,
        devServerUrl: isDev ? devServerUrl : undefined,
        rendererDir,
        preloadPath,
        onClose: () => getMainWindow()?.hide(),
      });
    } else {
      focusMainWindow();
    }
  });

  app.on("window-all-closed", () => {
    // On macOS apps stay alive without windows; elsewhere the tray keeps Amp.
    if (process.platform === "darwin") return;
    if (quitting) app.quit();
  });
}

const trayHooks = {
  settings: () => appState.settings,
  nowPlaying: () => appState.nowPlaying(),
  quit: () => {
    quitting = true;
    app.quit();
  },
};

app.on("before-quit", () => {
  quitting = true;
});

app.on("will-quit", () => {
  unregisterGlobalShortcuts();
  destroyTray();
  void logLine("amp shutting down");
});

// Menu accelerators that reach the main process rather than the renderer.
app.on("browser-window-created", (_event, window) => {
  window.webContents.on("before-input-event", (_inputEvent, input) => {
    if (input.type !== "keyDown") return;
    const key = input.key.toLowerCase();
    const mod = process.platform === "darwin" ? input.meta : input.control;
    if (mod && key === "q") {
      quitting = true;
      app.quit();
    }
    if (mod && key === "m") sendCommand("toggleMini");
    if (key === "space" && input.shift && mod) focusMainWindow();
  });
});
