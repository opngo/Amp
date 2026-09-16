/**
 * Settings defaults + migrations. The same object is persisted by the
 * Electron main process (electron-store), the web build (localStorage) and
 * read by the Python tools so every surface stays in sync.
 */

import { DEFAULT_CHAPTER_RULES } from "./library";
import { DEFAULT_SHORTCUTS } from "./keys";
import type { Settings, ThemeMode } from "./types";

export const SETTINGS_VERSION = 8;

export const defaultSettings: Settings = {
  version: SETTINGS_VERSION,
  theme: "light" as ThemeMode,
  adaptiveColors: true,
  accent: "#6c8cff",
  // A soft tint from the cover: accent colour plus a slowly moving radial
  // gradient. The strength is fixed on purpose - it stays subtle and the
  // interface stays white, so there is no transparency to tune.
  background: { mode: "ambient", intensity: 0.6, animated: true },
  corners: { radius: 0, playerRadius: 0, style: "smooth" },
  ui: { sidebarCollapsed: false },
  visualizer: {
    mode: "wave",
    lines: 2,
    sensitivity: 1,
    thickness: 2,
    spacing: 10,
    smooth: 0.72,
    glow: true,
    mirror: false,
    opacity: 85,
    bloom: 60,
    peaks: true,
    reflection: false,
    fill: true,
    rotation: 22,
    decay: 72,
  },
  cover: { shape: "square", glow: 0.35, shadow: 0.6, parallax: true },
  player: { layout: "bar", widgetAlwaysOnTop: true, blur: 18 },
  playback: {
    speed: 1,
    skipSeconds: 30,
    skipBackSeconds: 15,
    volume: 1,
    muted: false,
    resume: true,
    sleepFade: 20,
    stopAfterChapter: false,
    resumeRewind: 5,
    autoNext: true,
    restoreLast: true,
    // Chapter stops: hop back into the fourth chapter of a long book and it
    // continues where it was left, not at its first sentence.
    rememberChapters: true,
  },
  equalizer: {
    enabled: false,
    preset: "spoken",
    gains: [-3, -2, -1, 1, 3, 4, 3, 1, -1, -2],
    preamp: 1,
    balance: 0,
  },
  audio: {
    outputDevice: "",
    channelMode: "stereo",
    normalize: true,
    crossfade: 0,
    trimSilence: false,
  },
  library: {
    groupFolders: true,
    chapterRules: DEFAULT_CHAPTER_RULES,
    autoImport: [],
    watchFolders: true,
    scanOnStart: true,
    coverSearchProvider: "openlibrary",
    sort: { key: "added", direction: "desc", foldersFirst: true },
  },
  torrents: {
    qbittorrent: {
      url: "http://127.0.0.1:8080",
      username: "admin",
      password: "adminadmin",
      category: "amp-audiobooks",
      savePath: "",
      sequential: true,
    },
    sources: [
      {
        id: "audiobookbay",
        name: "AudiobookBay",
        kind: "scraper",
        enabled: true,
        baseUrl: "https://audiobookbay.lu",
      },
      {
        id: "audiobookbay-alt",
        name: "AudiobookBay (mirror)",
        kind: "scraper",
        enabled: true,
        baseUrl: "https://audiobookbay.is",
      },
    ],
    minSeeders: 0,
    autoImport: true,
    preferredQuality: "m4b",
  },
  transcription: {
    enabled: false,
    provider: "whisper-cpp",
    model: "base",
    binaryPath: "whisper",
    language: "auto",
    translate: false,
  },
  server: {
    enabled: false,
    port: 7777,
    host: "0.0.0.0",
    token: "",
    transcode: false,
    maxBitrate: 128,
  },
  shortcuts: { ...DEFAULT_SHORTCUTS },
  startRoute: "home",
  // Only the desktop build can honour these; the browser shows them as
  // desktop-only rather than pretending.
  desktop: { launchOnStartup: false, startHidden: true },
  window: {
    alwaysOnTop: false,
    widgetAlwaysOnTop: true,
    mini: false,
    miniSize: { width: 380, height: 560 },
  },
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Deep merge that keeps arrays from the patch (settings arrays are atomic). */
export function mergeSettings(base: Settings, patch: DeepPartial<Settings>): Settings {
  const output: Record<string, unknown> = { ...(base as unknown as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === undefined) continue;
    const current = output[key];
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      current !== null &&
      typeof current === "object" &&
      !Array.isArray(current)
    ) {
      output[key] = mergeSettings(current as Settings, value as DeepPartial<Settings>) as unknown as Settings;
    } else {
      output[key] = value;
    }
  }
  return output as unknown as Settings;
}

/**
 * Older settings files (and the Python companion) have stored the indexer list
 * as plain ids. The interface reads `.enabled` off each entry, so strings are
 * widened here rather than silently disabling search.
 */
function normalizeSources(input: unknown): Settings["torrents"]["sources"] {
  if (!Array.isArray(input)) return defaultSettings.torrents.sources;
  const sources = input
    .map((entry) => {
      if (typeof entry === "string") {
        return {
          id: entry,
          name: entry === "audiobookbay" ? "AudiobookBay" : entry,
          kind: "scraper" as const,
          enabled: true,
          baseUrl: entry === "audiobookbay" ? "https://audiobookbay.lu" : "",
        };
      }
      if (entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string") {
        const source = entry as Settings["torrents"]["sources"][number];
        return { ...source, enabled: source.enabled !== false };
      }
      return null;
    })
    .filter((entry): entry is Settings["torrents"]["sources"][number] => entry !== null);
  return sources.length ? sources : defaultSettings.torrents.sources;
}

/** Migrate older settings files forward. */
export function migrateSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== "object") return { ...defaultSettings, shortcuts: { ...DEFAULT_SHORTCUTS } };
  const input = raw as Partial<Settings> & { version?: number };
  let settings = mergeSettings(defaultSettings, input as DeepPartial<Settings>);
  if (!settings.version || settings.version < 2) {
    // v1 stored "radius" as a string, v2 uses numbers (rem).
    settings = mergeSettings(settings, {
      corners: {
        radius:
          Number.parseFloat(
            String((input.corners as { radius?: unknown })?.radius ?? 0).replace(/[^0-9.-]/g, ""),
          ) || 0,
      },
      theme: (input as { theme?: string }).theme === "auto" ? "adaptive" : settings.theme,
      library: {
        groupFolders: (input as { library?: { groupFolders?: boolean } }).library?.groupFolders ?? true,
      },
    });
  }
  if (!settings.version || settings.version < 3) {
    settings.visualizer = mergeSettings(defaultSettings, { visualizer: settings.visualizer }).visualizer;
    settings.transcription = { ...defaultSettings.transcription, ...settings.transcription };
  }
  if (!settings.version || settings.version < 4) {
    // v4 is the white, ambient-tint look: the old full-cover gradient becomes
    // the subtle radial tint, and an unset theme means light rather than dark.
    const mode = (input.background as { mode?: string } | undefined)?.mode;
    if (!mode || mode === "cover-gradient" || mode === "blur") {
      settings.background = { ...settings.background, mode: "ambient" };
    }
    const theme = (input as { theme?: string }).theme;
    if (!theme || theme === "adaptive") settings.theme = "light";
    if ((input.background as { mode?: string } | undefined)?.mode === "off") {
      settings.background = { ...settings.background, mode: "off" };
    }
  }
  if (!settings.version || settings.version < 6) {
    // v6 added the Apple style corner shape and a remembered sidebar state. A
    // v5 file has neither, and mergeSettings would quietly hand out the
    // defaults anyway - be explicit so the intent is written down once.
    settings.corners = {
      ...settings.corners,
      style: settings.corners.style === "round" ? "round" : "smooth",
    };
    settings.ui = { ...settings.ui, sidebarCollapsed: Boolean(settings.ui.sidebarCollapsed) };
  }
  // The visualizer used to have six shapes including "outline" and "radial".
  // They are now one ring that follows the cover, plus the three free shapes.
  const legacyModes: Record<string, Settings["visualizer"]["mode"]> = {
    outline: "cover",
    radial: "cover",
    mirror: "mirror",
    bars: "bars",
    wave: "wave",
    cover: "cover",
    aurora: "aurora",
    orbit: "orbit",
    off: "off",
  };
  if (!settings.version || settings.version < 7) {
    // v7 grew the visualizer: a soft fill, peak caps, a reflection, a turning
    // halo and a decay control for the ring around the cover. Files written by
    // a v6 build have none of them, and mergeSettings would hand out the
    // defaults silently - write the intent down instead.
    const previous = settings.visualizer ?? defaultSettings.visualizer;
    settings.visualizer = {
      ...defaultSettings.visualizer,
      ...previous,
      bloom: Number.isFinite(Number(previous.bloom))
        ? Number(previous.bloom)
        : defaultSettings.visualizer.bloom,
      rotation: Number.isFinite(Number(previous.rotation))
        ? Number(previous.rotation)
        : defaultSettings.visualizer.rotation,
      decay: Number.isFinite(Number(previous.decay))
        ? Number(previous.decay)
        : defaultSettings.visualizer.decay,
    };
  }
  const wantedMode = legacyModes[String(settings.visualizer?.mode ?? "")] ?? defaultSettings.visualizer.mode;
  settings.visualizer = {
    ...defaultSettings.visualizer,
    ...settings.visualizer,
    mode: wantedMode,
    lines: Math.max(1, Math.min(4, Number(settings.visualizer?.lines) || 2)),
    opacity: Math.max(
      10,
      Math.min(100, Number(settings.visualizer?.opacity) || defaultSettings.visualizer.opacity),
    ),
    bloom: Math.max(0, Math.min(100, Number(settings.visualizer?.bloom ?? defaultSettings.visualizer.bloom))),
    rotation: Math.max(
      0,
      Math.min(100, Number(settings.visualizer?.rotation ?? defaultSettings.visualizer.rotation)),
    ),
    decay: Math.max(
      20,
      Math.min(100, Number(settings.visualizer?.decay ?? defaultSettings.visualizer.decay)),
    ),
  };

  // Applied every time: these are shape fixes, not version upgrades.
  settings.torrents = {
    ...settings.torrents,
    sources: normalizeSources((input.torrents as { sources?: unknown } | undefined)?.sources),
    minSeeders: Number(settings.torrents.minSeeders) || 0,
  };
  const routes: Settings["startRoute"][] = ["home", "library", "nowplaying"];
  if (!routes.includes(settings.startRoute)) settings.startRoute = "home";
  // Rewind-on-resume is a small nicety; keep it inside a sane range.
  settings.playback.resumeRewind = Math.max(0, Math.min(30, Number(settings.playback.resumeRewind) || 0));
  return {
    ...settings,
    version: SETTINGS_VERSION,
    shortcuts: { ...DEFAULT_SHORTCUTS, ...settings.shortcuts },
  };
}

export function resetSettings(): Settings {
  return JSON.parse(JSON.stringify(defaultSettings)) as Settings;
}

/** Export/import profile as JSON (Settings > Backup). */
export function exportProfile(settings: Settings, extra: Record<string, unknown> = {}): string {
  return JSON.stringify(
    { generatedBy: "amp", generatedAt: new Date().toISOString(), settings, ...extra },
    null,
    2,
  );
}

export interface ImportedProfile {
  settings: Settings;
  bookmarks?: unknown[];
  playlists?: unknown[];
}

export function parseProfile(json: string): ImportedProfile {
  const parsed = JSON.parse(json) as { settings?: unknown; bookmarks?: unknown[]; playlists?: unknown[] };
  return {
    settings: migrateSettings(parsed.settings ?? parsed),
    bookmarks: parsed.bookmarks,
    playlists: parsed.playlists,
  };
}

export const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "Light (default)" },
  { value: "adaptive", label: "Adaptive - light, colour from the cover" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Follow the system" },
];
