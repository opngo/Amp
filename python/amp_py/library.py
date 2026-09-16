"""The Amp library, in Python.

A library is one JSON file: books, folders, playlists, bookmarks and the
playback queue. The grouping rules match the TypeScript core exactly, so a
library written by the desktop app opens here unchanged (and the other way
around): a folder of tracks can become one book with many chapters, or one
book per file.
"""

from __future__ import annotations

import json
import os
import re
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable, Iterator

from . import media, paths


def now_ms() -> float:
    """Current time in milliseconds, the unit every timestamp in Amp uses."""
    return time.time() * 1000.0


def to_ms(value: float) -> float:
    """Accept either unit from older files: anything below year 2001 is seconds."""
    if value <= 0:
        return 0.0
    return value * 1000.0 if value < 1_000_000_000_000 else value

AUDIO_EXTENSIONS = (
    "m4b",
    "m4a",
    "mp3",
    "mp4",
    "flac",
    "ogg",
    "opus",
    "aac",
    "wav",
)

CONTAINER_EXTENSIONS = ("m4b", "m4a")

DEFAULT_CHAPTER_RULES: list[tuple[str, str]] = [
    (r"^(?:chapter|ch)[\s._-]*(\d+)$", "Chapter {n}"),
    (r"^(\d{1,3})[\s._-]+(.*)$", "{n}. {name}"),
    (r"^(?:part|pt)[\s._-]*(\d+)$", "Part {n}"),
    (r"^track[\s._-]*(\d+)$", "Track {n}"),
]


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def is_audio_file(name: str) -> bool:
    return Path(name).suffix.lower().lstrip(".") in AUDIO_EXTENSIONS


def natural_key(text: str) -> tuple:
    """Sort key so 'track 2' comes before 'track 10'."""
    return tuple(
        int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", str(text))
    )


@dataclass
class Chapter:
    id: str
    index: int
    title: str
    start: float
    duration: float
    file: str | None = None

    @property
    def end(self) -> float:
        return self.start + self.duration


@dataclass
class Book:
    id: str
    title: str
    author: str
    source_path: str
    kind: str = "single"  # "single" container, or "multi" folder of tracks
    chapters: list[Chapter] = field(default_factory=list)
    duration: float = 0.0
    folder_id: str | None = None
    tags: list[str] = field(default_factory=list)
    favorite: bool = False
    progress: float = 0.0
    size_bytes: int = 0
    cover_path: str | None = None
    # A cover the user picked from a remote source, or one kept inline. These
    # are user data, not display helpers: dropping them lost the artwork the
    # moment the library was saved through the server.
    cover_url: str | None = None
    cover_data_url: str | None = None
    # The wide banner is a separate image from the square cover. It is chosen in
    # the interface, so the server has to keep it: dropping it here meant a
    # banner set in the web app disappeared the next time the library was saved.
    banner_path: str | None = None
    banner_url: str | None = None
    banner_data_url: str | None = None
    genres: list[str] = field(default_factory=list)
    description: str | None = None
    year: int | None = None
    series_index: float | None = None
    album: str | None = None
    codec: str | None = None
    bitrate: int | None = None
    # Playback memory + manual ordering: the interface sorts on these, so they
    # have to survive a round trip through the server.
    # Timestamps are milliseconds since the epoch, matching the library format
    # the desktop app writes. seconds_ago() below is the only place that thinks
    # in seconds.
    last_played_at: float = 0.0
    manual_order: int = 0
    palette: dict[str, Any] | None = None
    narrator: str | None = None
    series: str | None = None
    # Colour tag: one of the palette names the desktop app offers, or None.
    color: str | None = None
    added_at: float = field(default_factory=now_ms)
    updated_at: float = field(default_factory=now_ms)
    torrent: dict[str, Any] | None = None

    def load_from_json(self, payload: dict[str, Any]) -> "LibraryStore":
        """Replace the in-memory library from an already parsed payload."""
        self.books = [Book.from_json(item) for item in payload.get("books", [])]
        self.folders = list(payload.get("folders", []))
        self.playlists = list(payload.get("playlists", []))
        self.bookmarks = list(payload.get("bookmarks", []))
        self.queue = list(payload.get("queue", []))
        self.history = list(payload.get("history", []))
        self._loaded_mtime = self._mtime()
        return self

    def to_json(self) -> dict[str, Any]:
        data = asdict(self)
        data["sourcePath"] = data.pop("source_path")
        data["folderId"] = data.pop("folder_id")
        data["sizeBytes"] = data.pop("size_bytes")
        data["coverPath"] = data.pop("cover_path")
        data["coverUrl"] = data.pop("cover_url")
        data["coverDataUrl"] = data.pop("cover_data_url")
        data["bannerPath"] = data.pop("banner_path")
        data["bannerUrl"] = data.pop("banner_url")
        data["bannerDataUrl"] = data.pop("banner_data_url")
        data["addedAt"] = data.pop("added_at")
        data["updatedAt"] = data.pop("updated_at")
        data["genres"] = list(self.genres)
        data["tags"] = list(self.tags)
        data["color"] = self.color
        data["seriesIndex"] = data.pop("series_index")
        data["lastPlayedAt"] = data.pop("last_played_at")
        data["manualOrder"] = data.pop("manual_order")
        return data

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "Book":
        chapters = [
            Chapter(
                id=chapter.get("id", _new_id("ch")),
                index=int(chapter.get("index", index + 1)),
                title=chapter.get("title", f"Chapter {index + 1}"),
                start=float(chapter.get("start", 0)),
                duration=float(chapter.get("duration", 0)),
                file=chapter.get("file"),
            )
            for index, chapter in enumerate(data.get("chapters", []))
        ]
        return cls(
            id=data.get("id", _new_id("bk")),
            title=data.get("title", "Untitled"),
            author=data.get("author", "Unknown"),
            source_path=data.get("sourcePath") or data.get("source_path", ""),
            kind=data.get("kind", "single"),
            chapters=chapters,
            duration=float(data.get("duration", 0)),
            folder_id=data.get("folderId", data.get("folder_id")),
            tags=list(data.get("tags", [])),
            favorite=bool(data.get("favorite", False)),
            progress=float(data.get("progress", 0)),
            size_bytes=int(data.get("sizeBytes", data.get("size_bytes", 0))),
            cover_path=data.get("coverPath", data.get("cover_path")),
            cover_url=data.get("coverUrl", data.get("cover_url")),
            cover_data_url=data.get("coverDataUrl", data.get("cover_data_url")),
            banner_path=data.get("bannerPath", data.get("banner_path")),
            banner_url=data.get("bannerUrl", data.get("banner_url")),
            banner_data_url=data.get("bannerDataUrl", data.get("banner_data_url")),
            genres=list(data.get("genres", [])),
            color=data.get("color"),
            description=data.get("description"),
            year=int(data["year"]) if data.get("year") else None,
            series_index=float(data["seriesIndex"]) if data.get("seriesIndex") is not None else None,
            album=data.get("album"),
            codec=data.get("codec"),
            bitrate=int(data["bitrate"]) if data.get("bitrate") else None,
            last_played_at=to_ms(float(data.get("lastPlayedAt", data.get("last_played_at", 0)) or 0)),
            manual_order=int(data.get("manualOrder", data.get("manual_order", 0)) or 0),
            palette=data.get("palette"),
            narrator=data.get("narrator"),
            series=data.get("series"),
            added_at=to_ms(float(data.get("addedAt", data.get("added_at", now_ms())))),
            updated_at=to_ms(float(data.get("updatedAt", data.get("updated_at", now_ms())))),
            torrent=data.get("torrent"),
        )

    def primary_file(self) -> str:
        for chapter in self.chapters:
            if chapter.file:
                return chapter.file
        return self.source_path

    def files(self) -> list[str]:
        found: list[str] = []
        for chapter in self.chapters:
            if chapter.file and chapter.file not in found:
                found.append(chapter.file)
        if not found and self.source_path:
            found.append(self.source_path)
        return found


def chapter_from_filename(name: str) -> str | None:
    """Title a chapter from its file name using the default rules."""
    stem = Path(name).stem.strip()
    for pattern, template in DEFAULT_CHAPTER_RULES:
        match = re.match(pattern, stem, re.IGNORECASE)
        if not match:
            continue
        number = match.group(1) if match.groups() else ""
        rest = match.group(2).strip() if len(match.groups()) > 1 and match.group(2) else stem
        return template.format(n=number, name=rest)
    return None


def build_chapters(files: list[Path], durations: dict[str, float] | None = None) -> list[Chapter]:
    """One chapter per track, offsets accumulated from durations (or 0 when unknown)."""
    durations = durations or {}
    chapters: list[Chapter] = []
    cursor = 0.0
    for index, path in enumerate(files, start=1):
        duration = float(durations.get(str(path), 0.0))
        title = chapter_from_filename(path.name) or Path(path).stem
        chapters.append(
            Chapter(
                id=_new_id("ch"),
                index=index,
                title=title,
                start=cursor,
                duration=duration,
                file=str(path),
            )
        )
        cursor += duration
    return chapters


def walk_audio(root: Path, max_depth: int = 6) -> Iterator[Path]:
    """Yield audio files under a path, skipping hidden and junk directories."""
    skip = {"node_modules", ".git", "@eaDir", "$RECYCLE.BIN", "System Volume Information"}
    if root.is_file():
        if is_audio_file(root.name):
            yield root
        return

    base_depth = len(root.parts)
    for dirpath, dirnames, filenames in os.walk(root):
        current = Path(dirpath)
        if len(current.parts) - base_depth >= max_depth:
            dirnames[:] = []
            continue
        dirnames[:] = [name for name in dirnames if not name.startswith(".") and name not in skip]
        for filename in sorted(filenames, key=natural_key):
            if filename.startswith("."):
                continue
            if is_audio_file(filename):
                yield current / filename


def extract_cover(source: str, book_id: str, meta: "media.AudioMeta") -> str | None:
    """Write embedded cover art next to the library so /api/cover can serve it.

    The desktop app writes covers into the same directory, which is what makes
    a cover that was read on one machine visible from every other client of the
    tailscale server.
    """
    if not meta.cover:
        return None
    extension = {
        "image/png": "png",
        "image/webp": "webp",
        "image/bmp": "bmp",
    }.get(meta.cover_mime or "", "jpg")
    try:
        paths.ensure_dirs()
        target = paths.covers_dir() / f"{book_id}.{extension}"
        target.write_bytes(meta.cover)
    except OSError:
        return None
    _ = source  # kept in the signature: covers are named after the book, not the file
    return str(target)


def apply_metadata(book: Book, meta: "media.AudioMeta", overwrite: bool = False) -> Book:
    """Fill a freshly imported book from the file's own tags and chapters."""
    if meta.title and (overwrite or book.title in ("", Path(book.source_path).stem)):
        book.title = meta.title
    if meta.author:
        book.author = meta.author
    if meta.narrator:
        book.narrator = meta.narrator
    if meta.album:
        book.album = meta.album
    if meta.genres:
        book.genres = list(meta.genres)
    if meta.year:
        book.year = meta.year
    if meta.description:
        book.description = meta.description
    if meta.codec:
        book.codec = meta.codec
    if meta.bitrate:
        book.bitrate = int(meta.bitrate)
    if meta.duration and not book.duration:
        book.duration = meta.duration
    if meta.cover:
        book.cover_path = extract_cover(book.source_path, book.id, meta)
    return book


def group_files(
    files: Iterable[Path],
    group_folders: bool = True,
    durations: dict[str, float] | None = None,
    read_tags: bool = True,
) -> list[Book]:
    """Turn scanned files into books, mirroring apps/desktop's grouping rules."""
    by_dir: dict[str, list[Path]] = {}
    for path in files:
        by_dir.setdefault(str(path.parent), []).append(path)

    # One pass over the files, so tags are read once no matter how they group.
    tags: dict[str, "media.AudioMeta"] = {}
    if read_tags:
        for path in files:
            suffix = path.suffix.lower()
            if suffix not in media.MP4_SUFFIXES | media.MP3_SUFFIXES | media.WAV_SUFFIXES:
                continue
            found = media.read_metadata(path)
            if found.duration:
                durations = {**(durations or {}), str(path): found.duration}
            if found.title or found.author or found.cover or found.chapters:
                tags[str(path)] = found

    books: list[Book] = []
    for directory, entries in sorted(by_dir.items()):
        entries = sorted(entries, key=lambda item: natural_key(item.name))
        containers = [p for p in entries if p.suffix.lower().lstrip(".") in CONTAINER_EXTENSIONS]
        tracks = [p for p in entries if p not in containers]

        for container in containers:
            meta = tags.get(str(container))
            total = float((durations or {}).get(str(container), 0.0))
            if meta and meta.chapters:
                chapters = [
                    Chapter(id=_new_id("ch"), index=index + 1, title=title, start=start, duration=max(0.0, end - start))
                    for index, (title, start, end) in enumerate(meta.chapters)
                ]
                total = total or chapters[-1].start + chapters[-1].duration
            else:
                chapters = [
                    Chapter(id=_new_id("ch"), index=1, title=container.stem, start=0.0, duration=total)
                ]
            book = Book(
                id=_new_id("bk"),
                title=container.stem,
                author="Unknown",
                source_path=str(container),
                kind="single",
                chapters=chapters,
                duration=total,
                size_bytes=container.stat().st_size if container.exists() else 0,
            )
            if meta:
                apply_metadata(book, meta)
            books.append(book)

        if not tracks:
            continue

        if group_folders and len(tracks) > 1:
            chapters = build_chapters(tracks, durations)
            first = tags.get(str(tracks[0]))
            book = Book(
                id=_new_id("bk"),
                title=(first.album if first and first.album else Path(directory).name),
                author=(first.author if first and first.author else "Unknown"),
                source_path=directory,
                kind="multi",
                chapters=chapters,
                duration=sum(chapter.duration for chapter in chapters),
                size_bytes=sum(p.stat().st_size for p in tracks if p.exists()),
            )
            if first:
                apply_metadata(book, first, overwrite=True)
                book.title = first.album or Path(directory).name
                book.chapters = chapters
            books.append(book)
        else:
            for track in tracks:
                duration = float((durations or {}).get(str(track), 0.0))
                meta = tags.get(str(track))
                book = Book(
                    id=_new_id("bk"),
                    title=track.stem,
                    author="Unknown",
                    source_path=str(track),
                    kind="single",
                    chapters=[
                        Chapter(
                            id=_new_id("ch"),
                            index=1,
                            title=(meta.chapters[0][0] if meta and meta.chapters else track.stem),
                            start=0.0,
                            duration=duration,
                        )
                    ],
                    duration=duration,
                    size_bytes=track.stat().st_size if track.exists() else 0,
                )
                if meta:
                    apply_metadata(book, meta)
                books.append(book)
    return books


def import_paths(
    store: "LibraryStore",
    input_paths: Iterable[str | Path],
    group_folders: bool = True,
    folder_id: str | None = None,
) -> dict[str, Any]:
    """Scan paths and add the resulting books to the library."""
    found: list[Path] = []
    for entry in input_paths:
        found.extend(walk_audio(Path(entry).expanduser()))

    books = group_files(found, group_folders=group_folders)
    known = {book.source_path for book in store.books}
    added = 0
    for book in books:
        if folder_id and book.folder_id is None:
            book.folder_id = folder_id
        if book.source_path in known:
            continue
        store.books.append(book)
        added += 1
    store.save()
    return {"added": added, "books": books, "scanned": len(found)}


class LibraryStore:
    """JSON-backed library with the same shape as the TypeScript core."""

    def __init__(self, path: str | Path | None = None) -> None:
        self.path = Path(path) if path else paths.library_file()
        self.books: list[Book] = []
        self.folders: list[dict[str, Any]] = []
        self.playlists: list[dict[str, Any]] = []
        self.bookmarks: list[dict[str, Any]] = []
        self.queue: list[dict[str, Any]] = []
        self.history: list[dict[str, Any]] = []
        self._loaded_mtime: float | None = None

    def _mtime(self) -> float | None:
        """Fingerprint of the file on disk: modification time *and* size.

        Modification time alone is not enough: several writers (the desktop app,
        this server, a seeding script) can touch the file within the same
        timestamp tick, and a missed change means the next save writes stale
        books back over the file.
        """
        try:
            stat = self.path.stat()
        except OSError:
            return None
        return stat.st_mtime_ns * 1000 + stat.st_size

    # ---------------------------------------------------------------- io ----
    def load(self) -> "LibraryStore":
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return self
        self.books = [Book.from_json(item) for item in raw.get("books", [])]
        self.folders = list(raw.get("folders", []))
        self.playlists = list(raw.get("playlists", []))
        self.bookmarks = list(raw.get("bookmarks", []))
        self.queue = list(raw.get("queue", []))
        self.history = list(raw.get("history", []))
        self._loaded_mtime = self._mtime()
        return self

    def load_from_json(self, payload: dict[str, Any]) -> "LibraryStore":
        """Replace the in-memory library from an already parsed payload."""
        self.books = [Book.from_json(item) for item in payload.get("books", [])]
        self.folders = list(payload.get("folders", []))
        self.playlists = list(payload.get("playlists", []))
        self.bookmarks = list(payload.get("bookmarks", []))
        self.queue = list(payload.get("queue", []))
        self.history = list(payload.get("history", []))
        self._loaded_mtime = self._mtime()
        return self

    def reload_if_changed(self) -> bool:  # noqa: D401
        """Pick up edits made outside the server (the desktop app, another tool).

        The library file is the source of truth, and it can change while the
        server is running: the desktop app imports a book, or a seed script
        rewrites it. Comparing the modification time keeps every client on the
        same data without a restart.
        """
        stamp = self._mtime()
        if stamp is None:
            return False
        if self._loaded_mtime is not None and stamp == self._loaded_mtime:
            return False
        self.load()
        return True

    def to_json(self) -> dict[str, Any]:
        return {
            "version": 1,
            "books": [book.to_json() for book in self.books],
            "folders": self.folders,
            "playlists": self.playlists,
            "bookmarks": self.bookmarks,
            "queue": self.queue,
            "history": self.history,
        }

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_suffix(".tmp")
        temp.write_text(json.dumps(self.to_json(), indent=2), encoding="utf-8")
        temp.replace(self.path)
        self._loaded_mtime = self._mtime()

    # ------------------------------------------------------------- queries --
    def find(self, book_id: str) -> Book | None:
        return next((book for book in self.books if book.id == book_id), None)

    def search(self, query: str) -> list[Book]:
        needle = query.lower().strip()
        if not needle:
            return list(self.books)
        return [
            book
            for book in self.books
            if needle in book.title.lower()
            or needle in book.author.lower()
            or (book.narrator and needle in book.narrator.lower())
            or (book.series and needle in book.series.lower())
            or any(needle in tag.lower() for tag in book.tags)
        ]

    def stats(self) -> dict[str, Any]:
        total_seconds = sum(book.duration for book in self.books)
        finished = sum(1 for book in self.books if book.duration and book.progress >= book.duration - 30)
        return {
            "books": len(self.books),
            "chapters": sum(len(book.chapters) for book in self.books),
            "hours": round(total_seconds / 3600, 1),
            "diskBytes": sum(book.size_bytes for book in self.books),
            "finished": finished,
            "folders": len(self.folders),
            "playlists": len(self.playlists),
        }

    def remove(self, book_id: str) -> bool:
        before = len(self.books)
        self.books = [book for book in self.books if book.id != book_id]
        self.save()
        return len(self.books) != before

    def record_progress(self, book_id: str, position: float) -> None:
        book = self.find(book_id)
        if not book:
            return
        book.progress = position
        book.updated_at = now_ms()
        self.history.append({"bookId": book_id, "at": now_ms(), "position": position})
        self.history = self.history[-500:]
        self.save()


def format_duration(seconds: float) -> str:
    seconds = max(0, int(seconds))
    hours, remainder = divmod(seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


def format_bytes(value: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1024 or unit == "TB":
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024
    return f"{value:.1f} TB"
