import { create } from "zustand";
import { defaultSettings, migrateSettings, type Palette, type Settings } from "@amp/core";
import { bridgeIfReady, getBridge } from "../platform/bridge";
import { applyTheme } from "./theme";

interface SettingsStore {
  settings: Settings;
  ready: boolean;
  palette: Palette | null;
  load(): Promise<void>;
  setPalette(palette: Palette | null): void;
  update(patch: DeepPartialSettings): Promise<void>;
  replace(settings: Settings): Promise<void>;
  reset(): Promise<void>;
  apply(): void;
}

type DeepPartialSettings = {
  [K in keyof Settings]?: Settings[K] extends object ? Partial<Settings[K]> : Settings[K];
};

const prefersDark = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches !== false;

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: defaultSettings,
  ready: false,
  palette: null,

  async load() {
    const host = await getBridge();
    const settings = migrateSettings(await host.settings.load());
    set({ settings, ready: true });
    get().apply();
  },

  setPalette(palette) {
    set({ palette });
    get().apply();
  },

  async update(patch) {
    const next: Settings = {
      ...get().settings,
      ...patch,
      background: { ...get().settings.background, ...(patch.background ?? {}) },
      corners: { ...get().settings.corners, ...(patch.corners ?? {}) },
      visualizer: { ...get().settings.visualizer, ...(patch.visualizer ?? {}) },
      cover: { ...get().settings.cover, ...(patch.cover ?? {}) },
      ui: { ...get().settings.ui, ...(patch.ui ?? {}) },
      player: { ...get().settings.player, ...(patch.player ?? {}) },
      playback: { ...get().settings.playback, ...(patch.playback ?? {}) },
      equalizer: { ...get().settings.equalizer, ...(patch.equalizer ?? {}) },
      audio: { ...get().settings.audio, ...(patch.audio ?? {}) },
      library: { ...get().settings.library, ...(patch.library ?? {}) },
      torrents: {
        ...get().settings.torrents,
        ...(patch.torrents ?? {}),
        qbittorrent: { ...get().settings.torrents.qbittorrent, ...(patch.torrents?.qbittorrent ?? {}) },
      },
      transcription: { ...get().settings.transcription, ...(patch.transcription ?? {}) },
      server: { ...get().settings.server, ...(patch.server ?? {}) },
      shortcuts: { ...get().settings.shortcuts, ...((patch.shortcuts ?? {}) as Record<string, string>) },
      window: { ...get().settings.window, ...(patch.window ?? {}) },
      desktop: { ...get().settings.desktop, ...(patch.desktop ?? {}) },
    };
    set({ settings: next });
    get().apply();
    const host = bridgeIfReady();
    await host?.settings.save(next);
  },

  async replace(settings) {
    const next = migrateSettings(settings);
    set({ settings: next });
    get().apply();
    const host = bridgeIfReady();
    await host?.settings.save(next);
  },

  async reset() {
    await get().replace(defaultSettings);
  },

  apply() {
    applyTheme(get().settings, get().palette, prefersDark());
  },
}));

export const selectSettings = (state: SettingsStore) => state.settings;
