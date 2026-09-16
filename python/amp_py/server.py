"""Optional remote server for Amp.

Serves the built web app plus a small JSON API and range-capable audio
streaming, so a phone or another machine on the tailnet can browse and play the
same library. Endpoints match apps/desktop's Electron server:

    GET  /api/health                     liveness probe
    GET  /api/library                    the whole library JSON
    PUT  /api/library                    replace it (the web app keeps it in sync)
    GET  /api/settings                   sanitised settings (no passwords)
    GET  /api/cover?bookId=<id>          cover art (`&which=banner` for banners)
    POST /api/cover  {bookId, dataUrl|url, which}   store chosen artwork
    POST /api/cover/extract {bookId}     pull the embedded cover out of a file
    GET  /api/audio?path=<abs path>      audio stream with HTTP range support
    POST /api/import  {"paths": [...]}   import files/folders by path
    GET  /api/search?q=<query>           AudioBookBay search
    GET  /api/qbittorrent                is the host's qBittorrent reachable
    GET  /api/torrents                   transfers from the host's qBittorrent
    GET  /api/transcript?bookId=<id>     finished transcript, when present

Every request needs the token (?token=... or Authorization: Bearer ...) so a
shared network is not enough to reach the library.
"""

from __future__ import annotations

import json
import mimetypes
import posixpath
import threading
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from . import paths
from .abb import AbbClient, build_magnet, detail_files
from .library import LibraryStore, import_paths
from .config import Settings
from .covers import search_covers

# Artwork the interface chooses travels over the protocol as a data URL or a URL
# the host should fetch. The host is the only one who can write to its own disk,
# so it does the storing and answers with a path the caller can keep.
_IMAGE_SUFFIXES = {"image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "image/jpeg": ".jpg"}


def decode_image(data_url: str) -> tuple[bytes, str]:
    """Bytes and file suffix for a `data:` URL. Raises ValueError if malformed."""
    header, _, payload = data_url.partition(",")
    if not payload or not header.startswith("data:"):
        raise ValueError("Expected a data URL")
    mime = header[5:].split(";")[0] or "image/jpeg"
    if not mime.startswith("image/"):
        raise ValueError(f"Not an image: {mime}")
    import base64

    import binascii

    try:
        raw = base64.b64decode(payload, validate=False)
    except (binascii.Error, ValueError) as error:  # pragma: no cover - defensive
        raise ValueError("The image data could not be decoded") from error
    return raw, _IMAGE_SUFFIXES.get(mime, ".jpg")


def fetch_image(url: str, timeout: float = 20.0) -> tuple[bytes, str]:
    """Download an image, with the suffix taken from its content type."""
    import urllib.request

    request = urllib.request.Request(url, headers={"User-Agent": "Amp/1.0 (+audiobooks)"})
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - user supplied art
        payload = response.read()
        mime = (response.headers.get("Content-Type") or "image/jpeg").split(";")[0].strip()
    if not mime.startswith("image/"):
        raise ValueError(f"That address is not an image ({mime})")
    return payload, _IMAGE_SUFFIXES.get(mime, ".jpg")


CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
    ".m4b": "audio/mp4",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".opus": "audio/opus",
}


def content_type(path: Path) -> str:
    return CONTENT_TYPES.get(path.suffix.lower()) or mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def parse_range(header: str | None, size: int) -> tuple[int, int] | None:
    """Parse a Range header into an inclusive (start, end) pair."""
    if not header or not header.startswith("bytes="):
        return None
    spec = header[len("bytes=") :].split(",")[0]
    start_text, _, end_text = spec.partition("-")
    try:
        if start_text:
            start = int(start_text)
            end = int(end_text) if end_text else size - 1
        else:  # suffix range: last N bytes
            length = int(end_text or 0)
            start = max(0, size - length)
            end = size - 1
    except ValueError:
        return None
    if start > end or start >= size:
        return None
    return start, min(end, size - 1)


class AmpRequestHandler(BaseHTTPRequestHandler):
    server_version = "AmpPython/0.9"

    # injected by AmpServer
    root: Path
    library: LibraryStore
    settings: Settings
    token: str
    abb: AbbClient

    def log_message(self, fmt: str, *args: Any) -> None:  # keep the console quiet
        if getattr(self.server, "verbose", False):
            super().log_message(fmt, *args)

    # ---------------------------------------------------------------- helpers
    def _authorized(self, query: dict[str, list[str]]) -> bool:
        if not self.token:
            return True
        provided = (query.get("token") or [""])[0]
        if not provided:
            header = self.headers.get("Authorization", "")
            provided = header.replace("Bearer ", "").strip()
        return provided == self.token

    def _cors(self) -> None:
        """Let the web app talk to a server on another origin.

        The bundled page is served from the same origin, so this is only needed
        when the UI is opened from a different address (a dev server, or the
        `?server=` deep link). Range requests need the exposed headers or the
        seek bar cannot read the stream length.
        """
        origin = self.headers.get("Origin")
        self.send_header("Access-Control-Allow-Origin", origin or "*")
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, Range")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length")

    def _json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path, download: bool = False) -> None:
        if not path.exists() or not path.is_file():
            self._json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
            return
        size = path.stat().st_size
        byte_range = parse_range(self.headers.get("Range"), size)
        start, end = byte_range if byte_range else (0, size - 1)
        status = HTTPStatus.PARTIAL_CONTENT if byte_range else HTTPStatus.OK
        self.send_response(status)
        self.send_header("Content-Type", content_type(path))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        if byte_range:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        if download:
            self.send_header("Content-Disposition", f'attachment; filename="{path.name}"')
        self._cors()
        self.end_headers()
        # A player that seeks (or a tab that closes) aborts the response; that
        # is normal media behaviour and should not print a traceback.
        try:
            with path.open("rb") as handle:
                handle.seek(start)
                remaining = end - start + 1
                while remaining > 0:
                    chunk = handle.read(min(64 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            return

    def _recover_cover(self, book: Any) -> Path | None:
        """Extract embedded cover art for a book whose cached cover is missing."""
        if book is None:
            return None
        from . import media

        sources = [book.cover_path] if book.cover_path else []
        sources.extend(chapter.file for chapter in book.chapters if chapter.file)
        sources.append(book.source_path)
        for source in sources:
            if not source:
                continue
            candidate = Path(source)
            if not candidate.is_file():
                continue
            found = media.read_metadata(candidate)
            if not found.cover:
                continue
            extension = {"image/png": "png", "image/webp": "webp", "image/bmp": "bmp"}.get(found.cover_mime or "", "jpg")
            target = paths.covers_dir() / f"{book.id}.{extension}"
            try:
                paths.ensure_dirs()
                target.write_bytes(found.cover)
            except OSError:
                return None
            book.cover_path = str(target)
            self.library.save()
            return target
        return None

    def _search_row(self, item: Any, score: float = 0.0) -> dict[str, Any]:
        """One AudioBookBay row in the shape the interface expects."""
        from .abb import absolute_url

        # Rows may still carry a site relative href from an older parser: the
        # interface opens these in a browser and the resolver fetches them.
        url = absolute_url(item.detail_url or "")
        return {
            "id": item.info_hash or url,
            "title": item.title,
            "url": url,
            "size": item.size_bytes,
            "sizeText": item.size_text,
            "format": item.format,
            "bitrate": item.bitrate,
            "category": item.category,
            "coverUrl": item.cover_url,
            "postedText": item.posted,
            "infoHash": item.info_hash or None,
            "magnet": item.magnet or None,
            "score": score,
            "source": "audiobookbay",
        }

    # ------------------------------------------------------------------ verbs
    def do_OPTIONS(self) -> None:  # noqa: N802 (http.server naming)
        """CORS preflight: the renderer sends an Authorization header."""
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Content-Length", "0")
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802 (http.server naming)
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        if not self._authorized(query):
            self._json(HTTPStatus.UNAUTHORIZED, {"error": "Invalid or missing token"})
            return

        route = posixpath.normpath(parsed.path)
        try:
            if route == "/api/health":
                self._json(200, {"ok": True, "app": "amp", "python": True})
                return
            if route == "/api/library":
                # The file is the source of truth and other tools write to it.
                self.library.reload_if_changed()
                self._json(200, self.library.to_json())
                return
            if route == "/api/settings":
                data = json.loads(json.dumps(self.settings.data))
                qb = data.get("torrents", {}).get("qbittorrent", {})
                qb.pop("password", None)
                self._json(200, data)
                return
            if route == "/api/stats":
                self._json(200, self.library.stats())
                return
            if route == "/api/cover":
                book_id = (query.get("bookId") or [""])[0]
                # One endpoint serves both kinds of artwork: `which=banner`
                # reads the banner cache and the banner the book points at.
                which = (query.get("which") or ["cover"])[0]
                is_banner = which == "banner"
                book = next((item for item in self.library.books if item.id == book_id), None)
                for suffix in (".jpg", ".jpeg", ".png", ".webp"):
                    for directory in (
                        (paths.banners_dir(), paths.covers_dir())
                        if is_banner
                        else (paths.covers_dir(),)
                    ):
                        candidate = directory / f"{book_id}{suffix}"
                        if candidate.exists():
                            self._send_file(candidate)
                            return
                # Fall back to the art the library points at, so an image that
                # was chosen or extracted elsewhere still shows in the browser.
                # Guard the book itself first: an unknown id has no fields to
                # read, and reaching for one turned a 404 into a 500.
                pointed_value = None
                if book is not None:
                    pointed_value = book.banner_path if is_banner else book.cover_path
                pointed = Path(pointed_value) if pointed_value else None
                if pointed and pointed.is_file():
                    self._send_file(pointed)
                    return
                # Nothing cached: read the artwork out of the audio file itself.
                # A cache directory can be cleared or copied between machines,
                # and the cover is still in the book.
                if not is_banner:
                    recovered = self._recover_cover(book)
                    if recovered is not None:
                        self._send_file(recovered)
                        return
                self._json(HTTPStatus.NOT_FOUND, {"error": "No banner" if is_banner else "No cover"})
                return
            if route == "/api/covers":
                # Cover and banner search on behalf of a browser client: the
                # page cannot reach Open Library itself.
                query_text = (query.get("q") or [""])[0]
                provider = (query.get("provider") or ["all"])[0]
                try:
                    found = search_covers(query_text, provider)
                except Exception as error:  # pragma: no cover - defensive
                    self._json(HTTPStatus.BAD_GATEWAY, {"error": str(error), "candidates": []})
                    return
                candidates = [
                    {
                        "id": item["url"],
                        "title": item.get("title", ""),
                        "author": item.get("author") or None,
                        "thumbnail": item.get("thumbnail") or item["url"],
                        "full": item["url"],
                        "source": item.get("provider", "openlibrary"),
                    }
                    for item in found
                ]
                self._json(200, {"candidates": candidates})
                return
            if route == "/api/audio":
                target = Path((query.get("path") or [""])[0])
                if not target.is_absolute():
                    self._json(HTTPStatus.BAD_REQUEST, {"error": "Absolute path required"})
                    return
                self._send_file(target)
                return
            if route == "/api/qbittorrent":
                from .qbittorrent import QBittorrentClient

                client = QBittorrentClient(self.settings.qbittorrent)
                probe = client.test()
                # The probe itself worked: "not reachable" is the answer, not an
                # error, so a client is not left with a console full of failures.
                self._json(
                    HTTPStatus.OK,
                    {
                        "ok": bool(probe.get("ok")),
                        "version": probe.get("version"),
                        "message": probe.get("message"),
                        "url": self.settings.qbittorrent.url,
                        "category": self.settings.qbittorrent.category,
                    },
                )
                return
            if route == "/api/torrents":
                from .qbittorrent import QBittorrentClient

                client = QBittorrentClient(self.settings.qbittorrent)
                # A client that is not running is a normal state, not a server
                # fault: answer with the reason and an empty list.
                try:
                    transfers = client.list()
                    reason = None
                except (ConnectionError, OSError, ValueError) as error:
                    transfers = []
                    reason = str(error)
                self._json(
                    HTTPStatus.OK,
                    {
                        "ok": reason is None,
                        "error": reason,
                        "torrents": [
                            {
                                "hash": item.hash,
                                "name": item.name,
                                "state": item.state,
                                "humanState": item.human_state,
                                "progress": item.progress,
                                "downloadSpeed": item.download_speed,
                                "uploadSpeed": item.upload_speed,
                                "eta": item.eta,
                                "size": item.size,
                                "downloaded": item.downloaded,
                                "savePath": item.save_path,
                                "addedAt": int(item.added_at * 1000) if item.added_at else 0,
                            }
                            for item in transfers
                        ]
                    },
                )
                return
            if route == "/api/transcript":
                from .transcribe import Transcriber

                book_id = (query.get("bookId") or [""])[0]
                doc = Transcriber().transcript(book_id)
                # "No transcript yet" is a normal answer, not a failure: the
                # page asks for every book it shows, and a 404 in the console
                # for each of them looks like a broken app.
                self._json(200, {"doc": doc, "ok": doc is not None})
                return
            if route == "/api/search":
                query_text = (query.get("q") or [""])[0]
                # An empty query is the new-releases view: the front page of a
                # mirror, newest first.
                results = (
                    self.abb.search(query_text, limit=40) if query_text else self.abb.latest(limit=40)
                )
                self._json(
                    200,
                    {
                        "query": query_text,
                        "results": [self._search_row(item, item.score) for item in results],
                    },
                )
                return

            # static files, falling back to index.html for client routes
            relative = route.lstrip("/") or "index.html"
            candidate = (self.root / relative).resolve()
            if not str(candidate).startswith(str(self.root.resolve())):
                self._json(HTTPStatus.FORBIDDEN, {"error": "Forbidden"})
                return
            if candidate.is_file():
                self._send_file(candidate)
                return
            index = self.root / "index.html"
            if index.exists():
                self._send_file(index)
                return
            self._json(
                HTTPStatus.NOT_FOUND,
                {
                    "error": "Web build not found",
                    "hint": "Build it with `npm run build:web` and pass --root apps/renderer/dist",
                },
            )
        except Exception as error:  # pragma: no cover - defensive
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(error)})

    def do_PUT(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        if not self._authorized(query):
            self._json(HTTPStatus.UNAUTHORIZED, {"error": "Invalid or missing token"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(body or b"{}")
        except json.JSONDecodeError:
            self._json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON"})
            return
        if posixpath.normpath(parsed.path) == "/api/library":
            # Read what is on disk first. A client may be holding a copy from
            # before another writer (the desktop app, an import) changed the
            # file, and saving a stale copy over it loses books.
            self.library.reload_if_changed()
            self.library.load_from_json(payload)
            self.library.save()
            self._json(200, {"ok": True})
            return
        self._json(HTTPStatus.METHOD_NOT_ALLOWED, {"error": "Unsupported endpoint"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        if not self._authorized(query):
            self._json(HTTPStatus.UNAUTHORIZED, {"error": "Invalid or missing token"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length else b"{}"
        route = posixpath.normpath(parsed.path)

        if route == "/api/import":
            self.library.reload_if_changed()
            try:
                payload = json.loads(body or b"{}")
            except json.JSONDecodeError:
                self._json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON"})
                return
            result = import_paths(
                self.library,
                payload.get("paths", []),
                group_folders=bool(payload.get("groupFolders", self.settings.group_folders)),
            )
            self._json(
                200,
                {
                    "added": result["added"],
                    "scanned": result["scanned"],
                    "books": [book.to_json() for book in result["books"]],
                },
            )
            return

        if route == "/api/resolve":
            try:
                payload = json.loads(body or b"{}")
            except json.JSONDecodeError:
                self._json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON"})
                return
            url = str(payload.get("url") or "")
            info_hash = str(payload.get("infoHash") or "")
            name = str(payload.get("name") or "audiobook")
            if info_hash:
                self._json(200, {"magnet": build_magnet(info_hash, name), "infoHash": info_hash})
                return
            if not url:
                self._json(HTTPStatus.BAD_REQUEST, {"error": "Missing url"})
                return
            # Fetch the release page and turn what is there into a magnet.
            detail = self.abb.resolve(url)
            magnet = detail.magnet or (build_magnet(detail.info_hash, detail.title) if detail.info_hash else "")
            if not magnet:
                self._json(HTTPStatus.NOT_FOUND, {"error": "No magnet or info hash on that page"})
                return
            self._json(
                200,
                {
                    "magnet": magnet,
                    "infoHash": detail.info_hash,
                    "title": detail.title,
                    "trackers": detail.trackers,
                    "files": [{"name": file_name, "size": size} for file_name, size in detail_files(self.abb.fetch(url))],
                },
            )
            return

        if route == "/api/cover/extract":
            # Pull the artwork out of the audio file itself, cache it, and tell
            # the caller where it went.
            self.library.reload_if_changed()
            try:
                payload = json.loads(body or b"{}")
            except json.JSONDecodeError:
                self._json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON"})
                return
            book = next((item for item in self.library.books if item.id == payload.get("bookId")), None)
            if book is None:
                self._json(HTTPStatus.NOT_FOUND, {"error": "No such book"})
                return
            found = self._recover_cover(book)
            if found is None:
                self._json(HTTPStatus.NOT_FOUND, {"error": "No embedded cover in that file"})
                return
            book.cover_path = str(found)
            self.library.save()
            self._json(200, {"path": book.cover_path})
            return

        if route == "/api/cover":
            # Store artwork the interface picked: inline bytes, or a URL to
            # fetch. `which` says whether it is the square cover or the banner.
            self.library.reload_if_changed()
            try:
                payload = json.loads(body or b"{}")
            except json.JSONDecodeError:
                self._json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON"})
                return
            book_id = str(payload.get("bookId") or "")
            is_banner = str(payload.get("which") or "cover") == "banner"
            book = next((item for item in self.library.books if item.id == book_id), None)
            if book is None:
                self._json(HTTPStatus.NOT_FOUND, {"error": "No such book"})
                return
            try:
                if payload.get("dataUrl"):
                    raw, suffix = decode_image(str(payload["dataUrl"]))
                elif payload.get("url"):
                    raw, suffix = fetch_image(str(payload["url"]))
                else:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": "Send a dataUrl or a url"})
                    return
            except Exception as error:
                self._json(HTTPStatus.BAD_GATEWAY, {"error": str(error)})
                return
            directory = paths.banners_dir() if is_banner else paths.covers_dir()
            paths.ensure_dirs()
            # One image per book per kind: clear the old extensions first so a
            # png replacing a jpg cannot leave two candidates behind.
            for stale in directory.glob(f"{book_id}.*"):
                stale.unlink(missing_ok=True)
            target = directory / f"{book_id}{suffix}"
            target.write_bytes(raw)
            stored = str(target)
            if is_banner:
                book.banner_path = stored
                book.banner_url = None
                book.banner_data_url = None
            else:
                book.cover_path = stored
                book.cover_url = None
                book.cover_data_url = None
            self.library.save()
            self._json(200, {"path": stored})
            return

        if route == "/api/download":
            try:
                payload = json.loads(body or b"{}")
            except json.JSONDecodeError:
                self._json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON"})
                return
            magnetic = payload.get("magnet")
            if not magnetic:
                self._json(HTTPStatus.BAD_REQUEST, {"error": "Missing magnet"})
                return
            from .qbittorrent import QBittorrentClient

            client = QBittorrentClient(self.settings.qbittorrent)
            try:
                client.add_magnet(magnetic, payload.get("name"))
            except (ConnectionError, OSError, ValueError) as error:
                # Answer like a normal API instead of dropping the connection:
                # the caller has a reason to show now.
                self._json(
                    HTTPStatus.SERVICE_UNAVAILABLE,
                    {"ok": False, "error": str(error)},
                )
                return
            self._json(200, {"ok": True})
            return

        self._json(HTTPStatus.METHOD_NOT_ALLOWED, {"error": "Unsupported endpoint"})


class AmpServer:
    """Threaded HTTP server, bound to 0.0.0.0 by default for tailnet access."""

    def __init__(
        self,
        root: str | Path,
        library: LibraryStore | None = None,
        settings: Settings | None = None,
        port: int | None = None,
        host: str | None = None,
        token: str | None = None,
        verbose: bool = False,
    ) -> None:
        self.root = Path(root)
        self.library = library or LibraryStore()
        self.library.load()
        self.settings = settings or Settings.load()
        server_config = self.settings.server
        # `port=0` is meaningful (let the OS pick), so only None falls back.
        self.port = int(port if port is not None else server_config.get("port", 8787))
        self.host = host or server_config.get("host", "0.0.0.0")
        self.token = token if token is not None else str(server_config.get("token") or "")
        self.verbose = verbose
        self.abb = AbbClient()
        self.httpd: ThreadingHTTPServer | None = None
        self.thread: threading.Thread | None = None

    def status(self) -> dict[str, Any]:
        return {
            "running": self.httpd is not None,
            "url": f"http://{self.host}:{self.port}/?token={self.token}" if self.httpd else None,
            "root": str(self.root),
        }

    def _handler_class(self) -> type[AmpRequestHandler]:
        handler = type("BoundAmpHandler", (AmpRequestHandler,), {})
        handler.root = self.root
        handler.library = self.library
        handler.settings = self.settings
        handler.token = self.token
        handler.abb = self.abb
        return handler

    def start(self, block: bool = False) -> dict[str, Any]:
        handler = self._handler_class()
        self.httpd = ThreadingHTTPServer((self.host, self.port), handler)
        self.httpd.verbose = self.verbose  # type: ignore[attr-defined]
        if block:
            self.httpd.serve_forever()
            return self.status()
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        return self.status()

    def stop(self) -> dict[str, Any]:
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()
            self.httpd = None
        if self.thread:
            self.thread.join(timeout=3)
            self.thread = None
        return {"running": False}

    def tailscale_url(self) -> str | None:
        """Best-effort tailnet URL, when the CLI is installed."""
        import subprocess

        try:
            output = subprocess.run(
                ["tailscale", "ip", "-4"], capture_output=True, text=True, timeout=4
            )
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return None
        address = output.stdout.strip().splitlines()[0] if output.stdout.strip() else ""
        if not address.startswith("100."):
            return None
        return f"http://{address}:{self.port}/?token={self.token}"


__all__ = ["AmpServer", "AmpRequestHandler", "parse_range", "content_type"]
