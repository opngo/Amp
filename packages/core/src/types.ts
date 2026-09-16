/**
 * Amp shared domain types. Used by the Electron main process, the React
 * renderer, the marketing site and mirrored (snake_case) by the Python tools.
 */

export type ID = string;

/** Where a chapter/track came from. */
export interface Chapter {
  id: ID;
  /** 1-based index inside the book. */
  index: number;
  title: string;
  /** Seconds. */
  start: number;
  /** Seconds. */
  duration: number;
  /** Absolute path for one-file-per-chapter books. */
  file?: string;
  /** M4B chapter id (chpl / QuickTime) when read from embedded metadata. */
  embeddedId?: number;
  /** Manually marked by the user (kept on re-scan). */
  manual?: boolean;
}

export interface ChapterRule {
  /** Glob-ish matcher: "Chapter *", "* - Track *", or a RegExp source. */
  pattern: string;
  /** Title template, {n} = capture, {name} = file basename. */
  template: string;
  /** Chapters shorter than this many seconds are merged into the previous one. */
  minSeconds?: number;
}

export interface Book {
  id: ID;
  title: string;
  author: string;
  narrator?: string;
  series?: string;
  seriesIndex?: number;
  album?: string;
  year?: number;
  genres: string[];
  /** Playback speed for this book; falls back to the global default. */
  speed?: number | null;
  /**
   * Where the listener stopped inside each chapter, keyed by chapter index.
   *
   * A bookmark is something you make; this is something the player keeps. Long
   * books are read in pieces and a listener hops between chapters - the fourth
   * chapter of a forty-chapter book is easy to leave half heard - so the offset
   * inside every chapter is remembered separately from the overall progress, and
   * coming back to a chapter continues where it was left. Seconds from the start
   * of that chapter, so the value stays right when chapter boundaries move.
   */
  chapterStops?: Record<string, number>;
  /**
   * Colour tag chosen from the library context menu. It is only ever a label:
   * the interface draws a dot and can filter by it.
   */
  color?: string | null;
  description?: string;
  /** Absolute path of the m4b file or the folder holding the chapters. */
  sourcePath: string;
  /** "single" = one m4b/mp3/mp4 file, "multi" = folder of tracks. */
  kind: "single" | "multi";
  chapters: Chapter[];
  /** Total length in seconds. */
  duration: number;
  /** Path to an cover file (cached in the app data dir) if extracted/selected. */
  coverPath?: string;
  /** Data URL used by the web build + instant first paint. */
  coverDataUrl?: string;
  /** Wide artwork for Home, the player backdrop and the detail header.

   *  A banner is decoration, not identification: when a book has none the
   *  interface draws generated art from its cover colours instead of a file.
   */
  bannerPath?: string;
  bannerUrl?: string;
  /** Data URL for a chosen banner, so a browser client can render it directly. */
  bannerDataUrl?: string;
  /**
   * Display-only URL for clients that play through an Amp server. The host adds
   * it when it answers with the library and drops it again on save, so it never
   * ends up in the stored library.json.
   */
  coverUrl?: string;
  folderId?: ID | null;
  tags: string[];
  favorite: boolean;
  /** Playback memory. */
  progress: number;
  lastPlayedAt?: number;
  addedAt: number;
  updatedAt: number;
  /** Palette derived from the cover, powers adaptive theming. */
  palette?: Palette;
  /** Size on disk in bytes. */
  sizeBytes?: number;
  codec?: string;
  bitrate?: number;
  /** True when the book was imported from a torrent download. */
  torrent?: { hash?: string; source?: string; title?: string };
  /** Position when the library is sorted manually (drag-free reordering). */
  manualOrder?: number;
}

export interface Bookmark {
  id: ID;
  bookId: ID;
  /** Seconds from the start of the book. */
  position: number;
  chapterIndex: number;
  label: string;
  note?: string;
  color?: string;
  createdAt: number;
}

export interface Folder {
  id: ID;
  name: string;
  /** Nesting: a folder whose parentId points at another folder sits inside it. */
  parentId?: ID | null;
  color?: string;
  /** Watch this folder for new files (auto-import). */
  watch?: boolean;
  path?: string;
  /**
   * A locked folder hides its contents until it is unlocked with its PIN.
   *
   * The point is a shelf that is not for everybody - a gift being saved, a
   * book being read for a surprise - so a locked folder reports its name and
   * its colour and nothing else: no covers, no titles, no counts. The PIN is
   * never stored, only a hash of it (`lockHash`).
   */
  locked?: boolean;
  /** Salted hash of the folder PIN; the PIN itself is not kept anywhere. */
  lockHash?: string;
  createdAt: number;
}

export interface Playlist {
  id: ID;
  name: string;
  description?: string;
  bookIds: ID[];
  /** Start this list in a random order every time it plays. */
  shuffled?: boolean;
  coverBookId?: ID;
  createdAt: number;
  updatedAt: number;
}

export interface QueueItem {
  bookId: ID;
  addedAt: number;
}

export interface LibraryState {
  version: number;
  books: Book[];
  folders: Folder[];
  playlists: Playlist[];
  bookmarks: Bookmark[];
  queue: QueueItem[];
  history: { bookId: ID; at: number; position: number }[];
}

/* ---------------------------------------------------------------------------
 * Torrent / acquisition
 * ------------------------------------------------------------------------- */

export interface TorrentSource {
  id: string;
  name: string;
  /** Shown in the UI, e.g. "public tracker index". */
  kind: "scraper" | "api" | "rss";
  enabled: boolean;
  baseUrl: string;
}

export interface TorrentResult {
  id: string;
  /** Source id that produced the result. */
  source: string;
  title: string;
  /** Size in bytes when known. */
  size?: number;
  sizeText?: string;
  /** Release date as text, when the source only gives a formatted date. */
  postedText?: string;
  /** Relevance score computed from the release name against the query. */
  score?: number;
  seeders?: number;
  leechers?: number;
  magnet?: string;
  infoHash?: string;
  /** Detail page URL. */
  url?: string;
  category?: string;
  postedAt?: number;
  coverUrl?: string;
  description?: string;
  /** Parsed from the title when the source gives us nothing structured. */
  parsed?: { author?: string; narrator?: string; year?: number; bitrate?: string; format?: string };
}

export interface DownloadItem {
  hash: string;
  name: string;
  state: string;
  /** 0..1 */
  progress: number;
  /** bytes/s */
  downloadSpeed: number;
  uploadSpeed: number;
  eta?: number;
  size: number;
  downloaded: number;
  savePath: string;
  /** Set once the torrent content has been added to the library. */
  bookId?: ID;
  result?: TorrentResult;
  addedAt: number;
}

export interface QBittorrentConfig {
  url: string;
  username: string;
  password: string;
  category: string;
  savePath?: string;
  /** Start downloads paused / add to top of queue. */
  sequential: boolean;
}

/* ---------------------------------------------------------------------------
 * Settings
 * ------------------------------------------------------------------------- */

/**
 * The visualizer shapes.
 *
 * "cover" draws the bar ring around the artwork following its real corner
 * radius; "orbit" is the same spectrum bent into a halo; "aurora" is the
 * softest of them, layered ribbons that drift with the voice. The rest are
 * free-standing drawings below or behind the cover.
 */
export type VisualizerMode = "wave" | "bars" | "mirror" | "cover" | "aurora" | "orbit" | "off";
export type ThemeMode = "dark" | "light" | "system" | "adaptive";

export interface Settings {
  version: number;
  theme: ThemeMode;
  /** Accent sampled from the cover when true. */
  adaptiveColors: boolean;
  accent: string;
  background: {
    mode: "ambient" | "cover-gradient" | "solid" | "mesh" | "off";
    intensity: number;
    animated: boolean;
  };
  corners: {
    /** rem, 0 = square corners. */
    radius: number;
    /** Extra rounding for the player surface only. */
    playerRadius: number;
    /** "smooth" draws Apple-style continuous corners where the engine supports it. */
    style: "round" | "smooth";
  };
  visualizer: {
    mode: VisualizerMode;
    /** 1..4 stacked lines drawn around/behind the cover. */
    lines: number;
    sensitivity: number;
    thickness: number;
    /** "cover" mode: distance from the cover edge in px. */
    spacing: number;
    smooth: number;
    glow: boolean;
    mirror: boolean;
    /** 10..100 - how strongly the drawing shows through. */
    opacity: number;
    /** 0..100 - how wide the glow spreads behind the drawing. */
    bloom: number;
    /** Floating caps above the bars, falling back a little slower. */
    peaks: boolean;
    /** A dimmed mirror copy under the bars. */
    reflection: boolean;
    /** Soft gradient fill under the wave and the ribbons. */
    fill: boolean;
    /** 0..100 - how fast the halo turns. */
    rotation: number;
    /** 20..100 - how quickly the ring fades as it moves away from the cover. */
    decay: number;
  };
  cover: { shape: "square" | "rounded" | "circle"; glow: number; shadow: number; parallax: boolean };
  ui: {
    /** The sidebar can fold down to an icon rail. */
    sidebarCollapsed: boolean;
  };
  player: { layout: "bar" | "widget" | "full"; widgetAlwaysOnTop: boolean; blur: number };
  playback: {
    speed: number;
    skipSeconds: number;
    skipBackSeconds: number;
    volume: number;
    muted: boolean;
    /** Remember position per book. */
    resume: boolean;
    /** Fade out over N seconds for the sleep timer. */
    sleepFade: number;
    /** Stop after the current chapter. */
    stopAfterChapter: boolean;
    /** Seconds to step back when resuming a book, so nothing is lost. */
    resumeRewind: number;
    /** Keep going into the next queued book when one finishes. */
    autoNext: boolean;
    /** Load the book you were last listening to when Amp starts, paused. */
    restoreLast: boolean;
    /** Remember where each chapter was left and resume there. */
    rememberChapters: boolean;
  };
  equalizer: {
    enabled: boolean;
    preset: string;
    /** 10 band gains in dB, -12..12 */
    gains: number[];
    preamp: number;
    balance: number;
  };
  audio: {
    /** Output device id, "" = system default. */
    outputDevice: string;
    channelMode: "stereo" | "mono" | "swap";
    normalize: boolean;
    crossfade: number;
    /** Trim leading/trailing silence on chapter boundaries. */
    trimSilence: boolean;
  };
  library: {
    /** Group sibling audio files in a folder into one book. */
    groupFolders: boolean;
    chapterRules: ChapterRule[];
    autoImport: string[];
    watchFolders: boolean;
    scanOnStart: boolean;
    coverSearchProvider: "openlibrary" | "googlebooks" | "itunes";
    sort: { key: SortKey; direction: "asc" | "desc"; foldersFirst: boolean };
  };
  torrents: {
    qbittorrent: QBittorrentConfig;
    sources: TorrentSource[];
    /** Only add magnets from trackers that returned seeders > 0. */
    minSeeders: number;
    autoImport: boolean;
    preferredQuality: string;
  };
  transcription: {
    enabled: boolean;
    provider: "local-whisper" | "whisper-cpp" | "openai";
    model: string;
    binaryPath: string;
    language: string;
    translate: boolean;
  };
  server: {
    enabled: boolean;
    port: number;
    /** Bind address; use the tailscale IP to only expose on the tailnet. */
    host: string;
    token: string;
    transcode: boolean;
    maxBitrate: number;
  };
  shortcuts: Record<string, string>;
  /** The desktop app's own habits - a browser has no login items. */
  desktop: {
    /** Start Amp when the user signs in. */
    launchOnStartup: boolean;
    /** Start into the tray, with the window closed, so nothing pops up. */
    startHidden: boolean;
  };
  /** Where the window opens: the landing page, the library, or the player. */
  startRoute: "home" | "library" | "nowplaying";
  window: {
    alwaysOnTop: boolean;
    /** The mini widget floats above other windows by default. */
    widgetAlwaysOnTop: boolean;
    mini: boolean;
    miniSize: { width: number; height: number };
  };
}

export type SortKey =
  "manual" | "title" | "author" | "added" | "lastPlayed" | "progress" | "duration" | "series" | "year";

/* ---------------------------------------------------------------------------
 * Palette / theming
 * ------------------------------------------------------------------------- */

export interface Palette {
  /** Most dominant colour, "#rrggbb". */
  primary: string;
  secondary: string;
  accent: string;
  text: string;
  muted: string;
  /** Full gradient stops for the app background. */
  gradient: string[];
  /** Average luminance 0..1 of the cover. */
  luminance: number;
  dark: boolean;
}

export interface WhisperCue {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptDoc {
  bookId: ID;
  language: string;
  model: string;
  createdAt: number;
  cues: WhisperCue[];
  /** Full text, useful for the library-wide search. */
  text: string;
}

export interface TranscriberJob {
  id: ID;
  bookId: ID;
  chapterIndexes: number[];
  status: "queued" | "running" | "done" | "error" | "cancelled";
  progress: number;
  log: string[];
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

export interface AppStats {
  books: number;
  chapters: number;
  hours: number;
  listenedSeconds: number;
  finished: number;
  streakDays: number;
}
