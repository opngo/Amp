import { describe, expect, it } from "vitest";
import { defaultSettings, exportProfile, mergeSettings, migrateSettings, parseProfile, resetSettings, SETTINGS_VERSION } from "../settings";

describe("settings", () => {
  it("has a complete default tree", () => {
    expect(defaultSettings.version).toBe(SETTINGS_VERSION);
    expect(defaultSettings.equalizer.gains).toHaveLength(10);
    expect(defaultSettings.corners.radius).toBe(0);
    expect(Object.keys(defaultSettings.shortcuts).length).toBeGreaterThan(30);
  });

  it("deep merges without dropping defaults", () => {
    const merged = mergeSettings(defaultSettings, { playback: { speed: 1.75 }, equalizer: { enabled: true } });
    expect(merged.playback.speed).toBe(1.75);
    expect(merged.playback.skipSeconds).toBe(defaultSettings.playback.skipSeconds);
    expect(merged.equalizer.enabled).toBe(true);
    expect(merged.equalizer.preset).toBe("spoken");
  });

  it("keeps arrays atomic", () => {
    const merged = mergeSettings(defaultSettings, { equalizer: { gains: [1, 2, 3] } });
    expect(merged.equalizer.gains).toEqual([1, 2, 3]);
  });

  it("ignores undefined patches", () => {
    const merged = mergeSettings(defaultSettings, { accent: undefined });
    expect(merged.accent).toBe(defaultSettings.accent);
  });

  it("migrates v1 payloads", () => {
    const migrated = migrateSettings({ version: 1, theme: "auto", corners: { radius: "12px" } });
    expect(migrated.version).toBe(SETTINGS_VERSION);
    expect(migrated.theme).toBe("adaptive");
    expect(migrated.corners.radius).toBe(12);
    expect(migrated.transcription).toBeDefined();
  });

  it("backfills v5 files with the corner shape and the sidebar state", () => {
    // A v5 file predates both fields; reading it must not leave holes that the
    // interface then has to guess about.
    const migrated = migrateSettings({ version: 5, corners: { radius: 1, playerRadius: 2 } });
    expect(migrated.version).toBe(SETTINGS_VERSION);
    expect(migrated.corners.style).toBe("smooth");
    expect(migrated.ui.sidebarCollapsed).toBe(false);
    expect(migrateSettings({ version: 5, ui: { sidebarCollapsed: undefined } }).ui.sidebarCollapsed).toBe(false);
  });

  it("keeps a plain round corner choice through the migration", () => {
    const migrated = migrateSettings({ version: 5, corners: { radius: 1, playerRadius: 1, style: "round" } });
    expect(migrated.corners.style).toBe("round");
  });

  it("gives a v6 file the visualizer options that v7 added", () => {
    // A v6 file knows nothing about the fill, the peak caps, the reflection,
    // the turning halo or the decay of the ring around the cover.
    const migrated = migrateSettings({
      version: 6,
      visualizer: { mode: "cover", lines: 3, sensitivity: 1.4, thickness: 3, spacing: 8, smooth: 0.6, glow: true, mirror: false, opacity: 70 },
    });
    expect(migrated.version).toBe(SETTINGS_VERSION);
    expect(migrated.visualizer.mode).toBe("cover");
    expect(migrated.visualizer.lines).toBe(3);
    expect(migrated.visualizer.bloom).toBe(defaultSettings.visualizer.bloom);
    expect(migrated.visualizer.rotation).toBe(defaultSettings.visualizer.rotation);
    expect(migrated.visualizer.decay).toBe(defaultSettings.visualizer.decay);
    expect(migrated.visualizer.fill).toBe(defaultSettings.visualizer.fill);
    expect(migrated.visualizer.peaks).toBe(defaultSettings.visualizer.peaks);
    expect(migrated.visualizer.reflection).toBe(false);
  });

  it("keeps the new visualizer settings the listener chose", () => {
    const migrated = migrateSettings({
      version: 6,
      visualizer: { mode: "aurora", bloom: 15, rotation: 90, decay: 99, reflection: true, fill: false, peaks: false },
    });
    expect(migrated.visualizer.mode).toBe("aurora");
    expect(migrated.visualizer.bloom).toBe(15);
    expect(migrated.visualizer.rotation).toBe(90);
    expect(migrated.visualizer.decay).toBe(99);
    expect(migrated.visualizer.reflection).toBe(true);
    expect(migrated.visualizer.fill).toBe(false);
  });

  it("holds the new visualizer numbers inside their range", () => {
    const migrated = migrateSettings({ visualizer: { bloom: 900, rotation: -40, decay: 3 } });
    expect(migrated.visualizer.bloom).toBe(100);
    expect(migrated.visualizer.rotation).toBe(0);
    expect(migrated.visualizer.decay).toBe(20);
  });

  it("keeps the shapes it knows and hands out nothing for the rest", () => {
    expect(migrateSettings({ visualizer: { mode: "aurora" } }).visualizer.mode).toBe("aurora");
    expect(migrateSettings({ visualizer: { mode: "orbit" } }).visualizer.mode).toBe("orbit");
    expect(migrateSettings({ visualizer: { mode: "hologram" } }).visualizer.mode).toBe("wave");
  });

  it("falls back to defaults on garbage input", () => {
    expect(migrateSettings(null).version).toBe(SETTINGS_VERSION);
    expect(migrateSettings("nope").accent).toBe(defaultSettings.accent);
  });

  it("exports and re-imports a profile", () => {
    const json = exportProfile(defaultSettings, { bookmarks: [] });
    const profile = parseProfile(json);
    expect(profile.settings.version).toBe(SETTINGS_VERSION);
    expect(profile.bookmarks).toEqual([]);
  });

  it("reset returns a fresh object", () => {
    const a = resetSettings();
    a.accent = "#000000";
    expect(defaultSettings.accent).not.toBe("#000000");
  });
});

describe("indexer list shapes", () => {
  it("widens plain source ids into enabled indexers", () => {
    // The Python companion used to store `"sources": ["audiobookbay"]`, which
    // left the interface with nothing it could read `.enabled` from.
    const settings = migrateSettings({ torrents: { sources: ["audiobookbay"] } });
    expect(settings.torrents.sources).toHaveLength(1);
    expect(settings.torrents.sources[0].id).toBe("audiobookbay");
    expect(settings.torrents.sources[0].enabled).toBe(true);
    expect(settings.torrents.minSeeders).toBe(0);
  });

  it("keeps a source that was switched off", () => {
    const settings = migrateSettings({
      torrents: { sources: [{ id: "audiobookbay", name: "ABB", kind: "scraper", enabled: false, baseUrl: "" }] },
    });
    expect(settings.torrents.sources[0].enabled).toBe(false);
  });

  it("falls back to the defaults when the list is missing", () => {
    expect(migrateSettings({}).torrents.sources.length).toBeGreaterThan(0);
  });
});
