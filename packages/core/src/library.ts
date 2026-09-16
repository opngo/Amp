/**
 * Library logic: turning scanned files into books, grouping, sorting,
 * filtering, stats. Pure functions only - the Electron main process feeds
 * them file metadata and the renderer can re-run the same code in web mode.
 */

import type {
  Playlist, Book, Chapter, ChapterRule, Folder, ID, LibraryState, SortKey, AppStats,
} from "./types";

export interface ScannedFile {
  path: string;
  /** Directory containing the file. */
  dir: string;
  name: string;
  ext: string;
  sizeBytes: number;
  duration?: number;
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  narrator?: string;
  genre?: string[];
  year?: number;
  trackNumber?: number;
  discNumber?: number;
  description?: string;
  /** Embedded chapters (m4b `chpl`, QuickTime, ID3 CHAP). */
  chapters?: { title?: string; start: number; duration: number; id?: number }[];
  /** Cheap embedded art detection - the bytes are pulled lazily. */
  hasCover?: boolean;
  codec?: string;
  bitrate?: number;
  mtime: number;
}

export const AUDIO_EXTENSIONS = [
  "m4b",
  "m4a",
  "mp3",
  "mp4",
  "m4v",
  "aac",
  "flac",
  "ogg",
  "opus",
  "wav",
  "wma",
  "webm",
  "mkv",
] as const;

export const DEFAULT_CHAPTER_RULES: ChapterRule[] = [
  { pattern: "^(?:chapter|ch|part|track|disc|cd)\\s*[\\-_ ]?(\\d{1,3})", template: "Chapter {n}" },
  { pattern: "^(\\d{1,3})[\\.\\-_ ]+(.+)$", template: "{name}" },
];

export function isAudioFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return (AUDIO_EXTENSIONS as readonly string[]).includes(ext);
}

export function extOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  const idx = base.lastIndexOf(".");
  return idx === -1 ? "" : base.slice(idx + 1).toLowerCase();
}

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function dirname(path: string): string {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts.join("/") || "/";
}

export function stripExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx <= 0 ? name : name.slice(0, idx);
}

/** Sorting that keeps "Track 2" before "Track 10". */
export function naturalCompare(a: string, b: string): number {
  const chunk = /(\d+)|(\D+)/g;
  const ax = a.toLowerCase().match(chunk) ?? [];
  const bx = b.toLowerCase().match(chunk) ?? [];
  const len = Math.min(ax.length, bx.length);
  for (let i = 0; i < len; i += 1) {
    const an = Number(ax[i]);
    const bn = Number(bx[i]);
    const bothNumeric = !Number.isNaN(an) && !Number.isNaN(bn);
    if (bothNumeric) {
      if (an !== bn) return an - bn;
    } else if (ax[i] !== bx[i]) {
      return ax[i] < bx[i] ? -1 : 1;
    }
  }
  return ax.length - bx.length;
}

/**
 * Turn a file name into a chapter title/index using the user's rules.
 * Falls back to the natural sort order of the file inside the folder.
 */
export function chapterFromFilename(
  name: string,
  rules: ChapterRule[] = DEFAULT_CHAPTER_RULES,
  fallbackIndex = 1,
): { title: string; index: number } {
  const base = stripExtension(name).replace(/_/g, " ").trim();
  for (const rule of rules) {
    let re: RegExp;
    try {
      re = new RegExp(rule.pattern, "i");
    } catch {
      continue;
    }
    const match = base.match(re);
    if (!match) continue;
    const captured = match[1];
    const rest = match[2];
    let title = rule.template
      .replace(/\{n\}/g, captured?.padStart(captured.length > 2 ? captured.length : 2, "0") ?? "")
      .replace(/\{name\}/g, (rest ?? base).trim())
      .replace(/\{base\}/g, base)
      .trim();
    if (!title) title = base;
    return { title, index: Number(captured) || fallbackIndex };
  }
  return { title: base, index: fallbackIndex };
}

export interface GroupOptions {
  groupFolders: boolean;
  chapterRules: ChapterRule[];
  /** Existing books, used to keep ids/progress stable across re-scans. */
  existing?: Book[];
  idFactory?: () => ID;
}

let idCounter = 0;
export function newId(prefix = "bk"): string {
  idCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${rand}`;
}

/** Order files inside a folder: disc/track tags first, then natural name order. */
export function sortScannedFiles(files: ScannedFile[]): ScannedFile[] {
  return [...files].sort((a, b) => {
    const ad = a.discNumber ?? 0;
    const bd = b.discNumber ?? 0;
    if (ad !== bd) return ad - bd;
    const at = a.trackNumber ?? 0;
    const bt = b.trackNumber ?? 0;
    if (at && bt && at !== bt) return at - bt;
    return naturalCompare(a.name, b.name);
  });
}

function chapterStartOffsets(durations: number[]): number[] {
  const starts: number[] = [];
  let acc = 0;
  for (const d of durations) {
    starts.push(acc);
    acc += d;
  }
  return starts;
}

function pickTitle(files: ScannedFile[], dir: string): string {
  if (files.length === 1) {
    const f = files[0];
    return f.album || f.title || stripExtension(f.name);
  }
  const album = files.find((f) => f.album)?.album;
  if (album) return album;
  const folder = dir.split(/[\\/]/).filter(Boolean).pop();
  return folder ? folder : stripExtension(files[0].name);
}

function buildSingleBook(file: ScannedFile, id: ID, addedAt: number): Book {
  const chapters: Chapter[] = (file.chapters ?? []).map((c, i) => ({
    id: `${id}:c${i}`,
    index: i + 1,
    title: c.title?.trim() || `Chapter ${i + 1}`,
    start: Math.max(0, c.start),
    duration: Math.max(0, c.duration),
    embeddedId: c.id,
  }));
  const embeddedTotal = chapters.reduce((acc, c) => acc + c.duration, 0);
  if (chapters.length === 0) {
    const duration = file.duration ?? 0;
    chapters.push({
      id: `${id}:c0`,
      index: 1,
      title: "Full book",
      start: 0,
      duration,
    });
  }
  const duration = Math.max(file.duration ?? 0, embeddedTotal);
  return {
    id,
    title: pickTitle([file], file.dir),
    author: file.albumArtist || file.artist || "Unknown author",
    narrator: file.narrator,
    album: file.album,
    series: undefined,
    year: file.year,
    genres: file.genre ?? [],
    description: file.description,
    sourcePath: file.path,
    kind: "single",
    chapters,
    duration,
    tags: [],
    favorite: false,
    progress: 0,
    addedAt,
    updatedAt: file.mtime || addedAt,
    sizeBytes: file.sizeBytes,
    codec: file.codec,
    bitrate: file.bitrate,
  };
}

/**
 * Build a multi-file book: every file is a chapter, offsets are computed from
 * the durations so the player can treat the folder as one continuous stream.
 */
export function buildMultiBook(files: ScannedFile[], id: ID, addedAt: number, rules: ChapterRule[]): Book {
  const ordered = sortScannedFiles(files);
  const durations = ordered.map((f) => f.duration ?? 0);
  const starts = chapterStartOffsets(durations);
  const chapters: Chapter[] = ordered.map((file, i) => {
    const parsed = chapterFromFilename(file.name, rules, i + 1);
    const embedded = file.chapters?.[0];
    return {
      id: `${id}:c${i}`,
      index: parsed.index || i + 1,
      title: file.title || embedded?.title || parsed.title,
      start: starts[i],
      duration: durations[i],
      file: file.path,
    };
  });
  const dir = ordered[0].dir;
  const first = ordered[0];
  const author = ordered.find((f) => f.albumArtist)?.albumArtist || ordered.find((f) => f.artist)?.artist || "Unknown author";
  return {
    id,
    title: pickTitle(ordered, dir),
    author,
    narrator: ordered.find((f) => f.narrator)?.narrator,
    album: first.album,
    year: first.year,
    genres: ordered.flatMap((f) => f.genre ?? []).slice(0, 6),
    description: ordered.find((f) => f.description)?.description,
    sourcePath: dir,
    kind: "multi",
    chapters,
    duration: durations.reduce((a, b) => a + b, 0),
    tags: [],
    favorite: false,
    progress: 0,
    addedAt,
    updatedAt: Math.max(...ordered.map((f) => f.mtime), addedAt),
    sizeBytes: ordered.reduce((a, f) => a + f.sizeBytes, 0),
    codec: first.codec,
    bitrate: first.bitrate,
  };
}

/**
 * The import brain. One m4b file -> one book. A folder of loose tracks ->
 * either one book with many chapters, or one book per file, depending on
 * `groupFolders`. Existing books are matched by source path so progress,
 * bookmarks and covers survive a re-scan.
 */
export function groupFilesIntoBooks(files: ScannedFile[], options: GroupOptions): Book[] {
  const { groupFolders, chapterRules, existing = [], idFactory = () => newId("bk") } = options;
  const byDir = new Map<string, ScannedFile[]>();
  for (const file of files) {
    const list = byDir.get(file.dir);
    if (list) list.push(file);
    else byDir.set(file.dir, [file]);
  }

  const known = new Map(existing.map((b) => [b.sourcePath, b]));
  const books: Book[] = [];

  for (const [dir, dirFiles] of byDir) {
    // m4b / m4a containers are always a whole book on their own.
    const containers = dirFiles.filter((f) => ["m4b", "m4a"].includes(f.ext));
    const tracks = dirFiles.filter((f) => !["m4b", "m4a"].includes(f.ext));

    for (const file of containers) {
      const previous = known.get(file.path);
      const id = previous?.id ?? idFactory();
      const book = buildSingleBook(file, id, previous?.addedAt ?? Date.now());
      books.push(carryOver(previous, book));
    }

    if (tracks.length === 0) continue;

    // One loose file is always its own book, grouping or not.
    if (groupFolders && tracks.length > 1) {
      const previous = known.get(dir);
      const id = previous?.id ?? idFactory();
      const book = buildMultiBook(tracks, id, previous?.addedAt ?? Date.now(), chapterRules);
      books.push(carryOver(previous, book));
    } else {
      for (const file of tracks) {
        const previous = known.get(file.path);
        const id = previous?.id ?? idFactory();
        const book = buildSingleBook(file, id, previous?.addedAt ?? Date.now());
        books.push(carryOver(previous, book));
      }
    }
  }

  return books.sort((a, b) => naturalCompare(a.title, b.title));
}

/** Preserve user data (progress, tags, covers, bookmarks-relevant ids) on re-scan. */
export function carryOver(previous: Book | undefined, next: Book): Book {
  if (!previous) return next;
  const manualChapters = new Map(
    previous.chapters.filter((c) => c.manual).map((c) => [c.index, c] as const),
  );
  const chapters = next.chapters.map((c) => {
    const manual = manualChapters.get(c.index);
    return manual ? { ...c, title: manual.title, manual: true } : c;
  });
  return {
    ...next,
    id: previous.id,
    addedAt: previous.addedAt,
    progress: Math.min(previous.progress, Math.max(0, next.duration - 1)),
    lastPlayedAt: previous.lastPlayedAt,
    favorite: previous.favorite,
    tags: previous.tags,
    folderId: previous.folderId,
    coverPath: previous.coverPath,
    coverDataUrl: previous.coverDataUrl,
    palette: previous.palette,
    series: previous.series,
    seriesIndex: previous.seriesIndex,
    narrator: previous.narrator ?? next.narrator,
    author: previous.author === "Unknown author" ? next.author : previous.author,
    chapters,
  };
}

export function reindexChapters(chapters: Chapter[]): Chapter[] {
  return chapters.map((c, i) => ({ ...c, index: i + 1, start: Math.max(0, c.start) }));
}

/** Recompute offsets/durations after the user reorders or splits tracks. */
export function relayoutChapters(chapters: Chapter[]): Chapter[] {
  let acc = 0;
  return chapters.map((c, i) => {
    const next = { ...c, index: i + 1, start: acc };
    acc += Math.max(0, c.duration);
    return next;
  });
}

/* --------------------------------------------------------------------------
 * Editing helpers (context-menu actions in the library)
 * ------------------------------------------------------------------------ */

export function moveChapter(chapters: Chapter[], from: number, to: number): Chapter[] {
  const list = [...chapters];
  if (from < 0 || from >= list.length) return list;
  const [item] = list.splice(from, 1);
  list.splice(Math.max(0, Math.min(list.length, to)), 0, item);
  return relayoutChapters(list);
}

export function mergeChapters(chapters: Chapter[], index: number): Chapter[] {
  if (index < 0 || index >= chapters.length - 1) return chapters;
  const list = [...chapters];
  const [a, b] = [list[index], list[index + 1]];
  list.splice(index, 2, {
    ...a,
    title: a.title,
    duration: a.duration + b.duration,
    file: a.file ?? b.file,
  });
  return reindexChapters(list);
}

export function splitChapter(chapters: Chapter[], index: number, atSeconds: number): Chapter[] {
  const chapter = chapters[index];
  if (!chapter) return chapters;
  const offset = Math.max(1, Math.min(chapter.duration - 1, atSeconds));
  const list = [...chapters];
  const first: Chapter = { ...chapter, duration: offset };
  const second: Chapter = {
    ...chapter,
    id: `${chapter.id}-b`,
    title: `${chapter.title} (part 2)`,
    duration: chapter.duration - offset,
    start: chapter.start + offset,
    manual: true,
  };
  if (chapter.file) delete second.file;
  list.splice(index, 1, first, second);
  return reindexChapters(list);
}

/** "Split into separate books" / "Group as one book" library actions. */
export function splitBookIntoBooks(book: Book, idFactory: () => ID = () => newId("bk")): Book[] {
  return book.chapters.map((chapter, i) => ({
    ...book,
    id: idFactory(),
    title: book.chapters.length > 1 ? chapter.title : book.title,
    kind: chapter.file ? "single" : "single",
    sourcePath: chapter.file ?? book.sourcePath,
    chapters: [
      { ...chapter, id: `${chapter.id}-s${i}`, index: 1, start: 0, title: chapter.title },
    ],
    duration: chapter.duration,
    progress: 0,
    addedAt: Date.now(),
  }));
}

export function mergeBooks(books: Book[], idFactory: () => ID = () => newId("bk")): Book {
  const [first] = books;
  const all = [...books];
  const files = all.flatMap((b) => (b.kind === "multi" ? [b.sourcePath] : [b.sourcePath]));
  const chapters = relayoutChapters(
    all.flatMap((book) =>
      (book.chapters.length > 0
        ? book.chapters
        : [{ id: `${book.id}:c0`, index: 1, title: book.title, start: 0, duration: book.duration, file: book.sourcePath }]
      ).map((c) => ({
        ...c,
        id: `${book.id}:${c.id}`,
        title: book.chapters.length === 1 && book.title !== c.title ? `${book.title} - ${c.title}` : c.title,
        file: c.file ?? (book.kind === "single" ? book.sourcePath : undefined),
      })),
    ),
  );
  return {
    ...first,
    id: idFactory(),
    title: first.series ? `${first.series}` : first.album || first.title,
    kind: "multi",
    sourcePath: dirname(files[0]),
    chapters,
    duration: chapters.reduce((a, c) => a + c.duration, 0),
    sizeBytes: all.reduce((a, b) => a + (b.sizeBytes ?? 0), 0),
    progress: 0,
    tags: [...new Set(all.flatMap((b) => b.tags))],
    addedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/* --------------------------------------------------------------------------
 * Query helpers
 * ------------------------------------------------------------------------ */

export function chapterAt(chapters: Chapter[], position: number): number {
  if (chapters.length === 0) return 0;
  for (let i = chapters.length - 1; i >= 0; i -= 1) {
    if (position >= chapters[i].start - 0.05) return i;
  }
  return 0;
}

export function bookProgress(book: Book): number {
  if (!book.duration) return 0;
  return Math.max(0, Math.min(1, book.progress / book.duration));
}

export function bookRemaining(book: Book, speed = 1): number {
  return Math.max(0, (book.duration - book.progress) / (speed || 1));
}

export function isFinished(book: Book): boolean {
  return book.duration > 0 && book.progress / book.duration > 0.985;
}

export function sortBooks(books: Book[], key: SortKey, direction: "asc" | "desc" = "asc"): Book[] {
  const dir = direction === "asc" ? 1 : -1;
  const value = (book: Book): string | number => {
    switch (key) {
      case "manual":
        return book.manualOrder ?? book.addedAt;
      case "title":
        return book.title.toLowerCase();
      case "author":
        return book.author.toLowerCase();
      case "added":
        return book.addedAt;
      case "lastPlayed":
        return book.lastPlayedAt ?? 0;
      case "progress":
        return book.duration ? book.progress / book.duration : 0;
      case "duration":
        return book.duration;
      case "series":
        return `${book.series ?? "~"}${String(book.seriesIndex ?? 0).padStart(4, "0")}`.toLowerCase();
      case "year":
        return book.year ?? 0;
      default:
        return book.title.toLowerCase();
    }
  };
  return [...books].sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return naturalCompare(String(av), String(bv)) * dir;
  });
}

export interface FilterQuery {
  text?: string;
  folderId?: ID | null | "all";
  tag?: string;
  favorite?: boolean;
  inProgress?: boolean;
  finished?: boolean;
  series?: string;
  author?: string;
  narrator?: string;
  genre?: string;
  /** Colour tag from the context menu. */
  color?: string;
  /** Every folder id a filter should include, nesting included. */
  folderIds?: ID[];
}

export function matchesQuery(book: Book, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  // Fold accents so "le guin" finds "Le Guin" and "bronte" finds "Brontë".
  const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const haystack = fold(
    [
      book.title,
      book.author,
      book.narrator,
      book.series,
      book.album,
      // The rest of the metadata is searchable too: a year, a folder, a genre,
      // a colour tag or the file name all find the book they belong to.
      book.year ? String(book.year) : "",
      book.description,
      book.codec,
      book.color,
      basename(book.sourcePath ?? ""),
      ...(book.tags ?? []),
      ...(book.genres ?? []),
    ]
      .filter(Boolean)
      .join(" "),
  );
  const needle = fold(q);
  if (haystack.includes(needle)) return true;
  // token AND matching for multi word queries
  return needle.split(/\s+/).every((token) => haystack.includes(token));
}

export function filterBooks(books: Book[], filter: FilterQuery): Book[] {
  return books.filter((book) => {
    // A folder includes the folders inside it, so opening "Science fiction"
    // shows the books filed under the authors nested within it as well.
    if (filter.folderIds && filter.folderIds.length > 0) {
      if (!book.folderId || !filter.folderIds.includes(book.folderId)) return false;
    } else if (filter.folderId && filter.folderId !== "all" && book.folderId !== filter.folderId) {
      return false;
    }
    if (filter.tag && !book.tags.includes(filter.tag)) return false;
    if (filter.author && book.author !== filter.author) return false;
    if (filter.narrator && book.narrator !== filter.narrator) return false;
    if (filter.series && book.series !== filter.series) return false;
    if (filter.genre && !(book.genres ?? []).includes(filter.genre)) return false;
    if (filter.color && book.color !== filter.color) return false;
    if (filter.favorite && !book.favorite) return false;
    if (filter.inProgress && (book.progress <= 0 || isFinished(book))) return false;
    if (filter.finished && !isFinished(book)) return false;
    if (filter.author && book.author !== filter.author) return false;
    if (filter.text && !matchesQuery(book, filter.text)) return false;
    return true;
  });
}

/**
 * Everything the sidebar can browse, counted from the real library.
 *
 * A facet with no entries is left out of the interface entirely - Amp never
 * renders a heading that leads nowhere.
 */
export function facetCounts(books: Book[]) {
  const authors = new Map<string, number>();
  const narrators = new Map<string, number>();
  const series = new Map<string, number>();
  const genres = new Map<string, number>();
  const tags = new Map<string, number>();
  const colors = new Map<string, number>();
  for (const book of books) {
    if (book.author && book.author !== "Unknown") authors.set(book.author, (authors.get(book.author) ?? 0) + 1);
    if (book.narrator) narrators.set(book.narrator, (narrators.get(book.narrator) ?? 0) + 1);
    if (book.series) series.set(book.series, (series.get(book.series) ?? 0) + 1);
    for (const genre of book.genres ?? []) genres.set(genre, (genres.get(genre) ?? 0) + 1);
    for (const tag of book.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    if (book.color) colors.set(book.color, (colors.get(book.color) ?? 0) + 1);
  }
  const sortEntries = (map: Map<string, number>) =>
    [...map.entries()].sort((a, b) => b[1] - a[1] || naturalCompare(a[0], b[0]));
  return {
    authors: sortEntries(authors),
    narrators: sortEntries(narrators),
    series: sortEntries(series),
    genres: sortEntries(genres),
    tags: sortEntries(tags),
    colors: sortEntries(colors),
  };
}

/** The colour tags the interface offers, in a fixed order. */
export const COLOR_TAGS: { value: string; label: string }[] = [
  { value: "red", label: "Red" },
  { value: "orange", label: "Orange" },
  { value: "yellow", label: "Yellow" },
  { value: "green", label: "Green" },
  { value: "blue", label: "Blue" },
  { value: "purple", label: "Purple" },
  { value: "grey", label: "Grey" },
];

export function colorTagValue(color: string): string {
  const found = COLOR_TAGS.find((entry) => entry.value === color);
  return found ? found.label : color;
}

export function computeStats(state: LibraryState): AppStats {
  const hours = state.books.reduce((acc, b) => acc + b.duration, 0) / 3600;
  const listenedSeconds = state.books.reduce((acc, b) => acc + b.progress, 0);
  const finished = state.books.filter(isFinished).length;
  const days = new Set(
    state.history.map((h) => new Date(h.at).toISOString().slice(0, 10)),
  );
  let streak = 0;
  const cursor = new Date();
  for (;;) {
    const key = cursor.toISOString().slice(0, 10);
    if (days.has(key)) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else if (streak === 0) {
      cursor.setDate(cursor.getDate() - 1);
      const prev = cursor.toISOString().slice(0, 10);
      if (!days.has(prev)) break;
    } else break;
  }
  return {
    books: state.books.length,
    chapters: state.books.reduce((acc, b) => acc + b.chapters.length, 0),
    hours: Math.round(hours * 10) / 10,
    listenedSeconds,
    finished,
    streakDays: streak,
  };
}

/** Empty-state library skeleton, also used as the import target shape. */
export function emptyLibrary(): LibraryState {
  return {
    version: 1,
    books: [],
    folders: [],
    playlists: [],
    bookmarks: [],
    queue: [],
    history: [],
  };
}

/**
 * Fill in the fields a stored library might be missing.
 *
 * The library.json file is a public interface: the Electron main process, the
 * Python server and hand edits all write it. A book that arrives without
 * `tags`/`genres` arrays used to take the whole interface down, so every
 * reader funnels through here first.
 */
/**
 * Timestamps in milliseconds.
 *
 * The Python companions used to write seconds, and a library imported with them
 * showed dates in 1970. Seconds are recognised and widened here so an old file
 * heals on load instead of looking broken.
 */
function millis(value: unknown, empty = Date.now()): number {
  const time = Number(value ?? 0);
  // 0 stays 0 where it means "never" (lastPlayedAt) and falls back to now where
  // the field is required (addedAt, updatedAt).
  if (!Number.isFinite(time) || time <= 0) return value === 0 ? 0 : empty;
  return time < 1_000_000_000_000 ? time * 1000 : time;
}

/** Playback speeds Amp accepts, clamped to what the engine can render. */
export function clampSpeed(speed: number): number {
  return Math.max(0.25, Math.min(5, Math.round(speed * 100) / 100));
}

export function normalizeBook(raw: Book & Partial<Book>): Book {
  const chapters = Array.isArray(raw.chapters) ? raw.chapters : [];
  return {
    ...raw,
    id: raw.id,
    title: raw.title || "Untitled",
    author: raw.author || "Unknown",
    kind: raw.kind === "multi" ? "multi" : "single",
    chapters: chapters.map((chapter, index) => ({
      ...chapter,
      id: chapter.id ?? `ch_${index + 1}`,
      index: chapter.index ?? index + 1,
      title: chapter.title ?? `Chapter ${index + 1}`,
      start: Number(chapter.start ?? 0),
      duration: Number(chapter.duration ?? 0),
    })),
    duration: Number(raw.duration ?? chapters.reduce((acc, c) => acc + Number(c.duration ?? 0), 0)),
    sourcePath: raw.sourcePath ?? "",
    genres: Array.isArray(raw.genres) ? raw.genres : [],
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    color: typeof raw.color === "string" && raw.color ? raw.color : null,
    // A book keeps its own speed once one has been chosen for it.
    speed: typeof raw.speed === "number" && raw.speed > 0 ? clampSpeed(raw.speed) : null,
    // Per-chapter stops are kept per chapter index and dropped when they are
    // not finite: a corrupt entry should cost one chapter's resume, not the
    // library file.
    chapterStops: normalizeChapterStops(raw.chapterStops),
    favorite: Boolean(raw.favorite),
    progress: Number(raw.progress ?? 0),
    addedAt: millis(raw.addedAt),
    updatedAt: millis(raw.updatedAt ?? raw.addedAt),
    // Optional timestamps stay optional: an unplayed book has none.
    lastPlayedAt: raw.lastPlayedAt === undefined ? undefined : millis(raw.lastPlayedAt, 0),
  };
}

/** Keep only finite, positive chapter offsets. */
function normalizeChapterStops(input: unknown): Record<string, number> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const output: Record<string, number> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const chapter = Number(key);
    const offset = Number(value);
    if (!Number.isInteger(chapter) || chapter < 0) continue;
    if (!Number.isFinite(offset) || offset <= 0) continue;
    output[String(chapter)] = offset;
  }
  return Object.keys(output).length ? output : undefined;
}

/**
 * Where the listener stopped in a chapter, in seconds from its start.
 *
 * Null means "no stop recorded", which is what a chapter that was never heard
 * or was heard from end to end looks like.
 */
export function chapterStop(book: Book, chapterIndex: number): number | null {
  const value = book.chapterStops?.[String(chapterIndex)];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const chapter = book.chapters[chapterIndex];
  if (chapter && chapter.duration > 0 && value >= chapter.duration - 1) return null;
  return value;
}

/** How much of a chapter is left, in seconds. */
export function chapterRemaining(book: Book, chapterIndex: number, position?: number): number {
  const chapter = book.chapters[chapterIndex];
  if (!chapter) return 0;
  const inside =
    position === undefined
      ? (chapterStop(book, chapterIndex) ?? 0)
      : Math.max(0, position - chapter.start);
  return Math.max(0, chapter.duration - inside);
}

/**
 * Record a stop. Returns a new map, or null when the change is too small to be
 * worth writing - the library file is written on every pause and chapter change,
 * and a stop that moved by a second is not news.
 */
export function withChapterStop(
  book: Book,
  chapterIndex: number,
  offset: number,
  minimumDelta = 2,
): Record<string, number> | null {
  const chapter = book.chapters[chapterIndex];
  if (!chapter) return null;
  const clamped = Math.max(0, Math.min(offset, Math.max(0, chapter.duration - 1)));
  const current = book.chapterStops?.[String(chapterIndex)] ?? 0;
  const finished = chapter.duration > 0 && clamped >= chapter.duration - 2;
  if (finished && current === 0) return null;
  if (Math.abs(clamped - current) < minimumDelta && !finished) return null;
  const next = { ...(book.chapterStops ?? {}) };
  if (finished) delete next[String(chapterIndex)];
  else next[String(chapterIndex)] = Math.round(clamped);
  return next;
}

/**
 * A folder keeps its nesting only when the parent really exists.
 *
 * A deleted parent used to leave an orphan pointing at nothing, which a tree
 * view cannot draw: the child is lifted to the top level instead.
 */
export function normalizeFolder(raw: Folder, all: Folder[] = []): Folder {
  const parentId = raw.parentId ?? null;
  const parentExists = parentId ? all.some((folder) => folder.id === parentId) : false;
  return {
    ...raw,
    name: raw.name || "Folder",
    parentId: parentExists ? parentId : null,
    color: typeof raw.color === "string" && raw.color ? raw.color : undefined,
    locked: Boolean(raw.locked && raw.lockHash),
  };
}

/** Every folder underneath this one, deepest last (children before grandchildren). */
export function folderDescendants(folders: Folder[], rootId: ID): Folder[] {
  const output: Folder[] = [];
  let frontier = folders.filter((folder) => folder.parentId === rootId);
  const seen = new Set<ID>();
  while (frontier.length) {
    for (const folder of frontier) {
      if (seen.has(folder.id)) continue;
      seen.add(folder.id);
      output.push(folder);
    }
    frontier = folders.filter((folder) => folder.parentId && seen.has(folder.parentId));
  }
  return output;
}

/** The ids to include when a folder is opened: itself and everything inside it. */
export function folderScope(folders: Folder[], folderId: ID): Set<ID> {
  const ids = new Set<ID>([folderId]);
  for (const folder of folderDescendants(folders, folderId)) ids.add(folder.id);
  return ids;
}

export function normalizePlaylist(raw: Playlist): Playlist {
  return {
    ...raw,
    name: raw.name || "Playlist",
    bookIds: Array.isArray(raw.bookIds) ? raw.bookIds : [],
    shuffled: Boolean(raw.shuffled),
  };
}

export function normalizeLibrary(raw: Partial<LibraryState> | null | undefined): LibraryState {
  return {
    version: 1,
    books: (raw?.books ?? []).map((book) => normalizeBook(book as Book)),
    folders: (raw?.folders ?? []).map((folder) => normalizeFolder(folder as Folder)),
    playlists: (raw?.playlists ?? []).map((playlist) => normalizePlaylist(playlist as Playlist)),
    bookmarks: raw?.bookmarks ?? [],
    queue: raw?.queue ?? [],
    history: raw?.history ?? [],
  };
}

export function dedupeBooks(books: Book[]): Book[] {
  const seen = new Map<string, Book>();
  for (const book of books) {
    const key = book.sourcePath;
    const existing = seen.get(key);
    if (!existing || existing.updatedAt < book.updatedAt) seen.set(key, book);
  }
  return [...seen.values()];
}

/**
 * Every audio file that makes up a book, in chapter order.
 *
 * "single" books point at one m4b/mp3/mp4 file; "multi" books are a folder of
 * tracks, where each chapter may name its own file (and falls back to the
 * book's source path for embedded-chapter containers).
 */
export function bookFiles(book: Book): string[] {
  if (book.kind === "multi" && book.chapters?.length) {
    const files = book.chapters.map((chapter) => chapter.file).filter((file): file is string => Boolean(file));
    if (files.length) return Array.from(new Set(files));
  }
  return book.sourcePath ? [book.sourcePath] : [];
}

/** The file Amp should probe, stream from, or write chapters into. */
export function bookPrimaryFile(book: Book): string {
  const files = bookFiles(book);
  if (files.length) return files[0];
  return book.sourcePath;
}

/** File size for a book when the scan recorded it. */
export function bookSizeBytes(book: Book): number {
  return book.sizeBytes ?? 0;
}
