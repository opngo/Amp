/**
 * Keyboard shortcuts: default map, accelerator matching and pretty printing.
 * The renderer and the Electron main process share these definitions so a
 * window level shortcut and an in-app shortcut never drift apart.
 */

export interface ShortcutAction {
  id: string;
  label: string;
  group: "Playback" | "Navigation" | "Library" | "Window" | "Player" | "App";
  default: string;
  /** Handled by the global shortcut service, works while the app is in the tray. */
  global?: boolean;
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: "playPause", label: "Play / pause", group: "Playback", default: "Space", global: true },
  {
    id: "playPauseGlobal",
    label: "Play / pause (system wide)",
    group: "Playback",
    default: "MediaPlayPause",
    global: true,
  },
  { id: "nextChapter", label: "Next chapter", group: "Playback", default: "Ctrl+Right", global: true },
  { id: "prevChapter", label: "Previous chapter", group: "Playback", default: "Ctrl+Left", global: true },
  { id: "nextBook", label: "Next book in queue", group: "Playback", default: "Ctrl+Shift+Right" },
  { id: "prevBook", label: "Previous book in queue", group: "Playback", default: "Ctrl+Shift+Left" },
  { id: "skipForward", label: "Skip forward", group: "Playback", default: "Right" },
  { id: "skipBack", label: "Skip back", group: "Playback", default: "Left" },
  { id: "skipForwardLong", label: "Skip forward 60s", group: "Playback", default: "Shift+Right" },
  { id: "skipBackLong", label: "Skip back 60s", group: "Playback", default: "Shift+Left" },
  { id: "speedUp", label: "Increase speed", group: "Playback", default: "]" },
  { id: "speedDown", label: "Decrease speed", group: "Playback", default: "[" },
  { id: "resetSpeed", label: "Reset speed to 1x", group: "Playback", default: "Ctrl+0" },
  { id: "volumeUp", label: "Volume up", group: "Playback", default: "Up" },
  { id: "volumeDown", label: "Volume down", group: "Playback", default: "Down" },
  { id: "mute", label: "Mute", group: "Playback", default: "M" },
  { id: "bookmark", label: "Add bookmark", group: "Playback", default: "B", global: true },
  { id: "sleepTimer", label: "Sleep timer menu", group: "Playback", default: "Shift+S" },
  { id: "eq", label: "Toggle equalizer", group: "Playback", default: "Ctrl+E" },
  { id: "visualizer", label: "Cycle visualizer", group: "Player", default: "V" },
  { id: "togglePlayer", label: "Show / hide player", group: "Player", default: "P" },
  { id: "immersive", label: "Immersive player", group: "Player", default: "F" },
  { id: "focusSearch", label: "Search library", group: "Navigation", default: "Ctrl+F" },
  { id: "goLibrary", label: "Go to library", group: "Navigation", default: "Ctrl+1" },
  { id: "goPlayer", label: "Go to now playing", group: "Navigation", default: "Ctrl+2" },
  { id: "goDownloads", label: "Go to downloads / search", group: "Navigation", default: "Ctrl+3" },
  { id: "goPlaylists", label: "Go to playlists", group: "Navigation", default: "Ctrl+4" },
  { id: "goQueue", label: "Go to queue", group: "Navigation", default: "Ctrl+5" },
  { id: "goSettings", label: "Go to settings", group: "Navigation", default: "Ctrl+," },
  { id: "importFiles", label: "Import files", group: "Library", default: "Ctrl+O" },
  { id: "importFolder", label: "Import folder", group: "Library", default: "Ctrl+Shift+O" },
  { id: "rescan", label: "Rescan library", group: "Library", default: "F5" },
  { id: "toggleMini", label: "Toggle mini widget", group: "Window", default: "Ctrl+Shift+M", global: true },
  { id: "toggleTray", label: "Hide to tray", group: "Window", default: "Ctrl+W" },
  { id: "wake", label: "Wake window from tray", group: "Window", default: "Alt+Shift+A", global: true },
  { id: "alwaysOnTop", label: "Toggle always on top", group: "Window", default: "Ctrl+Shift+T" },
  { id: "toggleFullscreen", label: "Full screen", group: "Window", default: "F11" },
  { id: "stats", label: "Listening stats", group: "App", default: "Ctrl+I" },
  { id: "transcribe", label: "Transcribe current book", group: "App", default: "Ctrl+Shift+W" },
  { id: "quit", label: "Quit Amp", group: "App", default: "Ctrl+Q" },
];

export const DEFAULT_SHORTCUTS: Record<string, string> = Object.fromEntries(
  SHORTCUT_ACTIONS.map((a) => [a.id, a.default]),
);

/** Actions that may be registered with the operating system. */
export const GLOBAL_SHORTCUT_IDS: string[] = SHORTCUT_ACTIONS.filter((a) => a.global).map((a) => a.id);

/**
 * Can this accelerator be taken from the whole system?
 *
 * Registering a bare key globally does not just fail: it works, and then the
 * application never receives that key again. Space and P were being registered
 * this way, which is exactly why pressing them appeared to do nothing. A global
 * binding has to be something another program would not miss - a modifier
 * combination or a media key: function keys and bare letters belong to the
 * application that has focus.
 */
export function isSafeGlobalAccelerator(accelerator: string): boolean {
  const trimmed = accelerator.trim();
  if (!trimmed) return false;
  const parts = trimmed.split("+").map((part) => part.trim().toLowerCase());
  // "CommandOrControl" and friends count as modifiers, not as keys.
  const hasModifier = parts.some((part) =>
    /(ctrl|control|cmd|command|meta|super|alt|option|^mod$)/.test(part),
  );
  if (hasModifier) return true;
  // Media and volume keys exist to be global.
  return /^(media|volume|mute)/.test(parts[parts.length - 1] ?? "");
}

/**
 * The bindings to hand to the operating system: the actions that are meant to
 * work while Amp is in the tray, with anything unsafe left in the app.
 */
export function globalShortcutPayload(
  shortcuts: Record<string, string> = DEFAULT_SHORTCUTS,
  defaults: Record<string, string> = {},
): Record<string, string> {
  const payload: Record<string, string> = {};
  for (const id of GLOBAL_SHORTCUT_IDS) {
    const accelerator = shortcuts[id] || DEFAULT_SHORTCUTS[id] || defaults[id] || "";
    if (!isSafeGlobalAccelerator(accelerator)) continue;
    payload[id] = accelerator;
  }
  // Host level bindings (the tray wake key) are registered separately, by name.
  for (const [id, accelerator] of Object.entries(defaults)) {
    if (payload[id]) continue;
    if (isSafeGlobalAccelerator(accelerator)) payload[id] = accelerator;
  }
  return payload;
}

export function shortcutFor(settings: { shortcuts?: Record<string, string> }, id: string): string {
  const custom = settings.shortcuts?.[id];
  if (custom) return custom;
  return SHORTCUT_ACTIONS.find((a) => a.id === id)?.default ?? "";
}

interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const KEY_ALIASES: Record<string, string> = {
  " ": "space",
  spacebar: "space",
  esc: "escape",
  arrowup: "up",
  arrowdown: "down",
  arrowleft: "left",
  arrowright: "right",
  del: "delete",
  return: "enter",
  mediaplaypause: "mediaplaypause",
  "media track next": "medianexttrack",
  "media track previous": "mediaprevioustrack",
};

export function normalizeKey(key: string): string {
  const lower = key.toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}

/**
 * Split "Ctrl+Shift+K" into a normalised object. `mod` is accepted as an alias
 * for Cmd on macOS and Ctrl elsewhere so the defaults work on every platform.
 */
export function parseAccelerator(accelerator: string) {
  const parts = accelerator
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  const result = { ctrl: false, meta: false, alt: false, shift: false, key: "" };
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "ctrl" || lower === "control" || lower === "mod") result.ctrl = true;
    else if (lower === "cmd" || lower === "command" || lower === "meta" || lower === "super")
      result.meta = true;
    else if (lower === "alt" || lower === "option") result.alt = true;
    else if (lower === "shift") result.shift = true;
    else result.key = normalizeKey(part);
  }
  return result;
}

export function eventToAccelerator(event: KeyLike): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.metaKey) parts.push("Meta");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  let key = event.key;
  const named: Record<string, string> = {
    " ": "Space",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Escape: "Escape",
    Enter: "Enter",
    Backspace: "Backspace",
    Delete: "Delete",
    Tab: "Tab",
  };
  key = named[key] ?? key;
  if (key.length === 1) key = key.toUpperCase();
  if (["Control", "Meta", "Alt", "Shift"].includes(key)) return parts.join("+") || key;
  // Media keys arrive without modifiers.
  if (key === "Unidentified" && event.code) key = event.code;
  return [...parts, key].join("+");
}

/** Does a keyboard event match an accelerator string? */
export function matchesShortcut(event: KeyLike, accelerator: string): boolean {
  if (!accelerator) return false;
  const target = parseAccelerator(accelerator);
  const key = normalizeKey(event.key === "Unidentified" && event.code ? event.code : event.key);
  if (target.key && target.key !== key) {
    // Allow both "space" and "spacebar", and media keys via code.
    return false;
  }
  if (target.ctrl !== event.ctrlKey) return false;
  if (target.meta !== event.metaKey) return false;
  if (target.alt !== event.altKey) return false;
  if (target.shift !== event.shiftKey) return false;
  return true;
}

const PRETTY: Record<string, string> = {
  ctrl: "Ctrl",
  meta: "Cmd",
  alt: "Alt",
  shift: "Shift",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  space: "Space",
  mediaplaypause: "Media Play",
};

export function prettyAccelerator(accelerator: string): string {
  if (!accelerator) return "Not set";
  return accelerator
    .split("+")
    .map((part) => PRETTY[part.toLowerCase()] ?? (part.length === 1 ? part.toUpperCase() : part))
    .join(" + ");
}

export function findAction(
  accelerator: string,
  shortcuts: Record<string, string> = DEFAULT_SHORTCUTS,
): string | null {
  for (const [id, value] of Object.entries(shortcuts)) {
    if (value && value.toLowerCase() === accelerator.toLowerCase()) return id;
  }
  return null;
}

export function shortcutGroups(): { group: ShortcutAction["group"]; actions: ShortcutAction[] }[] {
  const order: ShortcutAction["group"][] = ["Playback", "Player", "Navigation", "Library", "Window", "App"];
  return order.map((group) => ({ group, actions: SHORTCUT_ACTIONS.filter((a) => a.group === group) }));
}
