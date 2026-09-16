"""qBittorrent Web API (v2) client, standard library only.

Same request shapes as the desktop app and the TUI: log in, add a magnet or a
.torrent file, poll the transfer list, pick the audio files out of a finished
download. Credentials come from settings.json, never from the command line.
"""

from __future__ import annotations

import json
import mimetypes
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any

FINISHED_STATES = {
    "uploading",
    "stalledUP",
    "pausedUP",
    "queuedUP",
    "forcedUP",
    "completed",
}

AUDIO_RE = None


@dataclass
class QbConfig:
    url: str = "http://127.0.0.1:8080"
    username: str = "admin"
    password: str = ""
    category: str = "amp-audiobooks"
    save_path: str = ""
    sequential: bool = True

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "QbConfig":
        return cls(
            url=str(data.get("url", cls.url)),
            username=str(data.get("username", cls.username)),
            password=str(data.get("password", cls.password)),
            category=str(data.get("category", cls.category)),
            save_path=str(data.get("savePath", data.get("save_path", ""))),
            sequential=bool(data.get("sequential", True)),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "url": self.url,
            "username": self.username,
            "password": self.password,
            "category": self.category,
            "savePath": self.save_path,
            "sequential": self.sequential,
        }


@dataclass
class Torrent:
    hash: str
    name: str
    state: str
    progress: float
    download_speed: int
    upload_speed: int
    eta: int
    size: int
    downloaded: int
    save_path: str
    added_at: float = 0.0
    files: list[dict[str, Any]] = field(default_factory=list)

    @property
    def finished(self) -> bool:
        return self.state in FINISHED_STATES

    @property
    def human_state(self) -> str:
        return {
            "downloading": "Downloading",
            "stalledDL": "Stalled",
            "metaDL": "Fetching metadata",
            "queuedDL": "Queued",
            "pausedDL": "Paused",
            "uploading": "Seeding",
            "pausedUP": "Finished",
            "error": "Error",
        }.get(self.state, self.state)


def normalize_torrent(raw: dict[str, Any]) -> Torrent:
    return Torrent(
        hash=str(raw.get("hash", "")),
        name=str(raw.get("name", "Unknown")),
        state=str(raw.get("state", "unknown")),
        progress=float(raw.get("progress", 0.0)),
        download_speed=int(raw.get("dlspeed", 0)),
        upload_speed=int(raw.get("upspeed", 0)),
        eta=int(raw.get("eta", 0)),
        size=int(raw.get("size", 0)),
        downloaded=int(raw.get("downloaded", 0)),
        save_path=str(raw.get("save_path") or raw.get("savepath") or ""),
        added_at=float(raw.get("added_on", 0)),
    )


def pick_audio_files(names: list[str]) -> list[str]:
    suffixes = (".m4b", ".m4a", ".mp3", ".mp4", ".flac", ".ogg", ".opus", ".aac")
    return [name for name in names if name.lower().endswith(suffixes)]


def torrent_file_paths(name: str, save_path: str = "", content_path: str = "") -> list[str]:
    """Every plausible on-disk path for one file inside a torrent.

    qBittorrent describes a torrent twice: ``save_path`` is the folder it
    downloads into, ``content_path`` is the thing on disk (the file for a
    single-file torrent, the outermost folder for a multi-file one) and the name
    in ``/torrents/files`` is the path inside the torrent, which normally
    repeats that outermost folder. Joining the wrong pair is how a finished
    download that is plainly on disk gets reported as missing - which the user
    sees as "imported 0 books". Every combination is returned, best first, and
    the caller keeps the first that exists.
    """
    name = name.lstrip("/\\")
    base = os.path.basename(name.replace("\\", "/"))
    save = save_path.rstrip("/\\")
    content = content_path.rstrip("/\\")
    separator = "\\" if ("\\" in (save or content) and "/" not in (save or content)) else "/"

    def join(root: str, part: str) -> str:
        if not root:
            return part
        if not part:
            return root
        return f"{root.rstrip('/\\')}{separator}{part.lstrip('/\\')}"

    candidates = [
        join(save, name),
        join(content, name),
        join(content, base),
        join(save, base),
    ]
    if content and os.path.basename(content.replace("\\", "/")) == base:
        candidates.append(content)
    seen: list[str] = []
    for candidate in candidates:
        if candidate and candidate not in seen:
            seen.append(candidate)
    return seen


class QBittorrentClient:
    """Thin wrapper over the qBittorrent Web UI API."""

    def __init__(self, config: QbConfig, timeout: float = 10.0) -> None:
        self.config = config
        self.timeout = timeout
        self.base = config.url.rstrip("/")
        self.cookie: str | None = None

    # ----------------------------------------------------------- plumbing --
    def _request(
        self,
        path: str,
        method: str = "GET",
        data: bytes | None = None,
        content_type: str | None = None,
        referer: bool = False,
    ) -> tuple[int, bytes]:
        headers = {"User-Agent": "amp/0.9"}
        if self.cookie:
            headers["Cookie"] = self.cookie
        if content_type:
            headers["Content-Type"] = content_type
        if referer:
            headers["Referer"] = self.base
        request = urllib.request.Request(
            f"{self.base}{path}", data=data, headers=headers, method=method
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                cookie = response.headers.get("Set-Cookie")
                if cookie:
                    self.cookie = cookie.split(";")[0]
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()
        except (urllib.error.URLError, TimeoutError) as error:
            raise ConnectionError(
                f"Cannot reach qBittorrent at {self.base}: {_reason(error)}. "
                "Start qBittorrent and enable Tools, Options, Web UI."
            ) from error

    def _json(self, path: str) -> Any:
        status, body = self._request(path)
        if status != 200:
            raise ConnectionError(f"qBittorrent answered {status} for {path}")
        return json.loads(body.decode("utf-8", errors="replace") or "null")

    def login(self) -> None:
        payload = urllib.parse.urlencode(
            {"username": self.config.username, "password": self.config.password}
        ).encode()
        status, body = self._request(
            "/api/v2/auth/login",
            method="POST",
            data=payload,
            content_type="application/x-www-form-urlencoded",
            referer=True,
        )
        text = body.decode("utf-8", errors="replace").strip()
        if status != 200 or text != "Ok.":
            self.cookie = None
            raise ConnectionError("qBittorrent rejected the credentials in settings.json")
        self.cookie = self.cookie or ""

    def _ensure_login(self) -> None:
        if not self.cookie:
            self.login()

    # -------------------------------------------------------------- api ----
    def version(self) -> str:
        status, body = self._request("/api/v2/app/version")
        if status != 200:
            raise ConnectionError(f"qBittorrent answered {status}")
        return body.decode().strip()

    def test(self) -> dict[str, Any]:
        try:
            version = self.version()
            self._ensure_login()
            return {"ok": True, "version": version, "message": f"Connected to qBittorrent {version}"}
        except ConnectionError as error:
            return {"ok": False, "message": str(error)}

    def add_magnet(self, magnet: str, name: str | None = None) -> None:
        self._ensure_login()
        fields = {
            "urls": magnet,
            "category": self.config.category,
            "paused": "false",
            "autoTMM": "false",
        }
        if self.config.save_path:
            fields["savepath"] = self.config.save_path
        if self.config.sequential:
            fields["sequentialDownload"] = "true"
            fields["firstLastPiecePrio"] = "true"
        if name:
            fields["rename"] = name
        status, body = self._request(
            "/api/v2/torrents/add",
            method="POST",
            data=urllib.parse.urlencode(fields).encode(),
            content_type="application/x-www-form-urlencoded",
        )
        if status != 200 or b"Fails" in body:
            raise ConnectionError("qBittorrent refused the torrent")

    def add_file(self, path: str, name: str | None = None) -> None:
        """Upload a .torrent file as multipart/form-data."""
        self._ensure_login()
        boundary = "----ampformboundary7f3a"
        filename = name or path.split("/")[-1]
        content_type = mimetypes.guess_type(path)[0] or "application/x-bittorrent"
        with open(path, "rb") as handle:
            payload = handle.read()

        parts: list[bytes] = []

        def field(key: str, value: str) -> None:
            parts.append(
                f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()
            )

        field("category", self.config.category)
        field("paused", "false")
        if self.config.save_path:
            field("savepath", self.config.save_path)
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="torrents"; filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n".encode()
        )
        parts.append(payload)
        parts.append(f"\r\n--{boundary}--\r\n".encode())
        body = b"".join(parts)
        status, response = self._request(
            "/api/v2/torrents/add",
            method="POST",
            data=body,
            content_type=f"multipart/form-data; boundary={boundary}",
        )
        if status != 200 or b"Fails" in response:
            raise ConnectionError("qBittorrent refused the torrent file")

    def list(self) -> list[Torrent]:
        self._ensure_login()
        raw = self._json("/api/v2/torrents/info")
        return [normalize_torrent(item) for item in raw or []]

    def pause(self, torrent_hash: str) -> None:
        self._post("/api/v2/torrents/pause", {"hashes": torrent_hash})

    def resume(self, torrent_hash: str) -> None:
        self._post("/api/v2/torrents/resume", {"hashes": torrent_hash})

    def remove(self, torrent_hash: str, delete_files: bool = False) -> None:
        self._post(
            "/api/v2/torrents/delete",
            {"hashes": torrent_hash, "deleteFiles": "true" if delete_files else "false"},
        )

    def _post(self, path: str, fields: dict[str, str]) -> None:
        self._ensure_login()
        self._request(
            path,
            method="POST",
            data=urllib.parse.urlencode(fields).encode(),
            content_type="application/x-www-form-urlencoded",
        )

    def files(self, torrent_hash: str) -> list[dict[str, Any]]:
        self._ensure_login()
        raw = self._json(f"/api/v2/torrents/files?hash={urllib.parse.quote(torrent_hash)}") or []
        info = self._json(f"/api/v2/torrents/info?hashes={urllib.parse.quote(torrent_hash)}") or []
        save_path = str(info[0].get("save_path", "")) if info else ""
        content_path = str(info[0].get("content_path", "")) if info else ""
        out: list[dict[str, Any]] = []
        for item in raw:
            name = str(item.get("name", ""))
            candidates = torrent_file_paths(name, save_path, content_path)
            # The first path that is really on disk wins; when none of them is,
            # the most likely one is returned so the error names a real place.
            path = candidates[-1] if candidates else ""
            for candidate in candidates:
                if os.path.exists(candidate):
                    path = candidate
                    break
            out.append(
                {
                    "name": name,
                    "size": int(item.get("size", 0)),
                    "progress": float(item.get("progress", 0)),
                    "path": path,
                }
            )
        return out

    def finished_audio_files(self, torrent_hash: str) -> list[dict[str, Any]]:
        """Audio members of a finished download that are readable right now.

        A torrent that says it is finished is not always all there - sampled
        audio, a companion PDF - and one missing member used to fail the whole
        import. Members that are present are returned; the caller decides what
        to do about the rest.
        """
        files = self.files(torrent_hash)
        wanted = set(pick_audio_files([item["name"] for item in files]))
        # Prefer the m4b when a torrent carries both an m4b and split mp3s of the
        # same book, so the book is not imported twice.
        chosen = [item for item in files if item["name"] in wanted]
        m4b = [item for item in chosen if item["name"].lower().endswith(".m4b")]
        if m4b:
            chosen = m4b
        return [item for item in chosen if not item.get("path") or os.path.exists(str(item["path"]))]

    def search(self, query: str, category: str = "all", timeout: float = 8.0) -> list[dict[str, Any]]:
        """Search through the qBittorrent search plugin when one is installed."""
        self._ensure_login()
        import time

        status, body = self._request(
            "/api/v2/search/start?pattern="
            f"{urllib.parse.quote(query)}&plugins=all&category={urllib.parse.quote(category)}"
        )
        if status != 200:
            raise ConnectionError(
                "The qBittorrent search plugin is unavailable. Install search-plugins, or search AudioBookBay instead."
            )
        search_id = json.loads(body.decode() or "{}").get("id")
        deadline = time.time() + timeout
        while time.time() < deadline:
            state = self._json(f"/api/v2/search/status?id={search_id}") or [{}]
            if state and state[0].get("status") == "Stopped":
                break
            time.sleep(0.35)
        results = self._json(f"/api/v2/search/results?id={search_id}&limit=80") or {}
        self._request(f"/api/v2/search/stop?id={search_id}")
        return list(results.get("results", []))


__all__ = [
    "QBittorrentClient",
    "QbConfig",
    "Torrent",
    "FINISHED_STATES",
    "normalize_torrent",
    "pick_audio_files",
    "torrent_file_paths",
]

def _reason(error: BaseException) -> str:
    """A short, human reason for a failed connection.

    urllib wraps the socket error in a URLError whose string carries the
    brackets and errno of the original exception; libraries and users only need
    the sentence.
    """
    cause = getattr(error, "reason", error)
    if isinstance(cause, ConnectionRefusedError) or "Connection refused" in str(cause):
        return "connection refused, nothing is listening on that port"
    if isinstance(cause, TimeoutError) or "timed out" in str(cause).lower():
        return "the request timed out"
    text = str(cause).strip()
    if text.startswith("<") and text.endswith(">"):
        text = text[1:-1]
    return text or "the connection failed"
