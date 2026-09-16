"""A finished download becomes a book.

The report this pins: the file is plainly on disk in the download folder, the
transfer says it is finished, and the library says nothing was imported. The
cause was the path qBittorrent's file list was resolved against - the torrent
root joined to a name that already contained it - so nothing was found and the
import failed with an error that read as "0 books".

These tests run the real client against a stand-in qBittorrent Web API and real
files in a temporary folder, then hand the result to the real importer.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from amp_py.library import LibraryStore, import_paths
from amp_py.qbittorrent import QbConfig, QBittorrentClient, torrent_file_paths


class FakeQbittorrent(BaseHTTPRequestHandler):
    """Just enough of the Web UI API: login, one finished torrent, its files."""

    torrents: list[dict] = []
    files: list[dict] = []
    save_path = "/downloads"
    content_path = "/downloads/Blindsight"
    seen_paths: list[str] = []

    def log_message(self, *_args):  # keep the test output clean
        return

    def _json(self, payload):
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Set-Cookie", "SID=test; path=/")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802 (http.server naming)
        FakeQbittorrent.seen_paths.append(self.path)
        if self.path.startswith("/api/v2/app/version"):
            self._json("4.6.0")
        elif self.path.startswith("/api/v2/torrents/info"):
            self._json(self.torrents)
        elif self.path.startswith("/api/v2/torrents/files"):
            self._json(self.files)
        else:
            self._json([])

    def do_POST(self):  # noqa: N802
        if self.path.startswith("/api/v2/auth/login"):
            body = b"Ok."
            self.send_response(200)
            self.send_header("Set-Cookie", "SID=test; path=/")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self._json({})


@pytest.fixture
def fake_qb():
    server = ThreadingHTTPServer(("127.0.0.1", 0), FakeQbittorrent)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    FakeQbittorrent.seen_paths = []
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


def make_torrent(folder: Path, *, with_extras: bool = False) -> tuple[list[dict], list[dict]]:
    """Three chapter files a torrent reports, plus optionally one that is gone."""
    (folder / "Blindsight").mkdir(parents=True, exist_ok=True)
    files = []
    for index in (1, 2, 3):
        target = folder / "Blindsight" / f"Chapter 0{index}.mp3"
        target.write_bytes(b"ID3" + bytes(64))
        files.append({"name": f"Blindsight/Chapter 0{index}.mp3", "size": 67, "progress": 1})
    if with_extras:
        # A member the torrent lists but that is not on disk (a sample, or a
        # piece that never arrived). This used to fail the whole import.
        files.append({"name": "Blindsight/extra-interview.mp3", "size": 67, "progress": 1})
        files.append({"name": "Blindsight/cover.jpg", "size": 10, "progress": 1})
    torrents = [
        {
            "hash": "deadbeef",
            "name": "Blindsight",
            "state": "uploading",
            "progress": 1.0,
            "size": 3 * 67,
            "downloaded": 3 * 67,
            "save_path": str(folder),
            "content_path": str(folder / "Blindsight"),
        }
    ]
    return torrents, files


def test_file_paths_cover_every_shape_qbittorrent_reports():
    repeated = torrent_file_paths("Blindsight/Chapter 01.mp3", "/downloads", "/downloads/Blindsight")
    assert repeated[0] == "/downloads/Blindsight/Chapter 01.mp3"
    assert len(set(repeated)) == len(repeated)

    relative = torrent_file_paths("Chapter 01.mp3", "/downloads", "/downloads/Blindsight")
    assert "/downloads/Blindsight/Chapter 01.mp3" in relative

    single = torrent_file_paths("Blindsight.m4b", "/downloads", "/downloads/Blindsight.m4b")
    assert single[0] == "/downloads/Blindsight.m4b"


def test_finished_download_imports_as_books(fake_qb, tmp_path):
    folder = tmp_path / "downloads"
    torrents, files = make_torrent(folder)
    FakeQbittorrent.torrents = torrents
    FakeQbittorrent.files = files

    client = QBittorrentClient(QbConfig(url=fake_qb, username="a", password="b"))
    audio = client.finished_audio_files("deadbeef")
    assert len(audio) == 3
    for item in audio:
        assert Path(item["path"]).exists(), item["path"]

    store = LibraryStore(tmp_path / "library.json")
    result = import_paths(store, [item["path"] for item in audio], group_folders=True)
    assert result["added"] == 1, result
    assert store.books[0].title
    assert len(store.books[0].chapters) == 3


def test_one_missing_member_does_not_lose_the_book(fake_qb, tmp_path):
    folder = tmp_path / "downloads"
    torrents, files = make_torrent(folder, with_extras=True)
    FakeQbittorrent.torrents = torrents
    FakeQbittorrent.files = files

    client = QBittorrentClient(QbConfig(url=fake_qb, username="a", password="b"))
    audio = client.finished_audio_files("deadbeef")
    names = {item["name"] for item in audio}
    assert "Blindsight/extra-interview.mp3" not in names
    assert "Blindsight/cover.jpg" not in names
    assert len(audio) == 3

    store = LibraryStore(tmp_path / "library.json")
    result = import_paths(store, [item["path"] for item in audio], group_folders=True)
    assert result["added"] == 1


def test_m4b_wins_over_split_mp3s(fake_qb, tmp_path):
    folder = tmp_path / "downloads"
    (folder / "Book").mkdir(parents=True, exist_ok=True)
    (folder / "Book" / "Book.m4b").write_bytes(b"\x00" * 32)
    (folder / "Book" / "Chapter 01.mp3").write_bytes(b"ID3")
    FakeQbittorrent.torrents = [
        {
            "hash": "cafe",
            "name": "Book",
            "state": "uploading",
            "progress": 1.0,
            "save_path": str(folder),
            "content_path": str(folder / "Book"),
        }
    ]
    FakeQbittorrent.files = [
        {"name": "Book/Book.m4b", "size": 32, "progress": 1},
        {"name": "Book/Chapter 01.mp3", "size": 3, "progress": 1},
    ]
    client = QBittorrentClient(QbConfig(url=fake_qb, username="a", password="b"))
    audio = client.finished_audio_files("cafe")
    assert [item["name"] for item in audio] == ["Book/Book.m4b"]


def test_a_single_file_torrent_resolves_to_the_file(fake_qb, tmp_path):
    folder = tmp_path / "downloads"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "Blindsight.m4b").write_bytes(b"\x00" * 16)
    FakeQbittorrent.torrents = [
        {
            "hash": "f00d",
            "name": "Blindsight.m4b",
            "state": "uploading",
            "progress": 1.0,
            "save_path": str(folder),
            "content_path": str(folder / "Blindsight.m4b"),
        }
    ]
    FakeQbittorrent.files = [{"name": "Blindsight.m4b", "size": 16, "progress": 1}]
    client = QBittorrentClient(QbConfig(url=fake_qb, username="a", password="b"))
    audio = client.finished_audio_files("f00d")
    assert [item["path"] for item in audio] == [str(folder / "Blindsight.m4b")]
