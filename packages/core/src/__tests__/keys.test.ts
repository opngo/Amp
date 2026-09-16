import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHORTCUTS,
  eventToAccelerator,
  findAction,
  globalShortcutPayload,
  isSafeGlobalAccelerator,
  matchesShortcut,
  parseAccelerator,
  prettyAccelerator,
  shortcutFor,
  SHORTCUT_ACTIONS,
  shortcutGroups,
} from "../keys";

const evt = (partial: Partial<KeyboardEvent>): KeyboardEvent =>
  ({
    key: "a",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...partial,
  }) as KeyboardEvent;

describe("shortcut table", () => {
  it("has unique ids and no duplicate defaults in the same group", () => {
    const ids = SHORTCUT_ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(DEFAULT_SHORTCUTS)).toHaveLength(SHORTCUT_ACTIONS.length);
  });

  it("groups every action", () => {
    const groups = shortcutGroups();
    const total = groups.reduce((acc, g) => acc + g.actions.length, 0);
    expect(total).toBe(SHORTCUT_ACTIONS.length);
  });

  it("resolves user overrides", () => {
    expect(shortcutFor({ shortcuts: { playPause: "K" } }, "playPause")).toBe("K");
    expect(shortcutFor({}, "playPause")).toBe("Space");
    expect(shortcutFor({}, "nope")).toBe("");
  });
});

describe("accelerator parsing", () => {
  it("parses modifiers and keys", () => {
    expect(parseAccelerator("Ctrl+Shift+K")).toEqual({ ctrl: true, meta: false, alt: false, shift: true, key: "k" });
    expect(parseAccelerator("Space").key).toBe("space");
    expect(parseAccelerator("MediaPlayPause").key).toBe("mediaplaypause");
  });

  it("prints pretty labels", () => {
    expect(prettyAccelerator("Ctrl+Shift+M")).toBe("Ctrl + Shift + M");
    expect(prettyAccelerator("")).toBe("Not set");
    expect(prettyAccelerator("mediaplaypause")).toBe("Media Play");
  });

  it("builds accelerators from events", () => {
    expect(eventToAccelerator(evt({ key: "k", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+K");
    expect(eventToAccelerator(evt({ key: " " }))).toBe("Space");
    expect(eventToAccelerator(evt({ key: "ArrowLeft" }))).toBe("Left");
    expect(eventToAccelerator(evt({ key: "Control", ctrlKey: true }))).toBe("Ctrl");
    expect(eventToAccelerator(evt({ key: "Shift", shiftKey: true }))).toBe("Shift");
  });

  it("matches events to shortcuts", () => {
    expect(matchesShortcut(evt({ key: " " }), "Space")).toBe(true);
    expect(matchesShortcut(evt({ key: " " }), "Ctrl+Space")).toBe(false);
    expect(matchesShortcut(evt({ key: "ArrowRight", ctrlKey: true }), "Ctrl+Right")).toBe(true);
    expect(matchesShortcut(evt({ key: "b" }), "B")).toBe(true);
    expect(matchesShortcut(evt({ key: "b", altKey: true }), "B")).toBe(false);
    expect(matchesShortcut(evt({ key: "x" }), "")).toBe(false);
  });

  it("finds conflicting actions", () => {
    expect(findAction("Space")).toBe("playPause");
    expect(findAction("Ctrl+Shift+F9")).toBeNull();
  });
});

describe("globalShortcutPayload", () => {
  it("keeps Space and P in the app", () => {
    // Registering these with the OS is how the play/pause and player keys
    // stopped reaching the window.
    const payload = globalShortcutPayload({ playPause: "Space", togglePlayer: "P", nextChapter: "Ctrl+Right" });
    expect(payload.playPause).toBeUndefined();
    expect(payload.togglePlayer).toBeUndefined();
    expect(payload.nextChapter).toBe("Ctrl+Right");
  });

  it("keeps media keys and modified keys, and takes host bindings", () => {
    const payload = globalShortcutPayload({ playPause: "MediaPlayPause" }, { showWindow: "CommandOrControl+Shift+A" });
    expect(payload.playPause).toBe("MediaPlayPause");
    expect(payload.showWindow).toBe("CommandOrControl+Shift+A");
  });

  it("leaves bare navigation keys alone", () => {
    for (const key of ["Right", "Left", "M", "B", "]", "Up", "F5", "F11", "Space", ""]) {
      expect(isSafeGlobalAccelerator(key)).toBe(false);
    }
    for (const key of ["Ctrl+Right", "Alt+Shift+A", "MediaPlayPause", "CommandOrControl+Q", "MediaTrackNext"]) {
      expect(isSafeGlobalAccelerator(key)).toBe(true);
    }
  });
});
