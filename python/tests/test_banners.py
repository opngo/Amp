"""Banners: the wide artwork that is not the cover.

Two things have to hold. The server must be able to serve a banner over HTTP
(the web build cannot read an absolute path on the host), and a banner has to
survive a round trip through the library JSON - dropping the field on save made
a banner chosen in the interface disappear on the next write.
"""

from __future__ import annotations

import json
import urllib.parse
from pathlib import Path

import pytest

from amp_py import paths
from amp_py.library import Book, LibraryStore


def make_store(tmp_path: Path) -> LibraryStore:
    return LibraryStore(tmp_path / "library.json")


def test_book_round_trips_its_banner(tmp_path: Path):
    book = Book(
        id="bk_banner",
        title="Piranesi",
        author="Susanna Clarke",
        source_path="/books/piranesi.m4b",
        banner_path="C:\\Users\\me\\Amp\\banners\\bk_banner.jpg",
        banner_url="https://example.test/wide.jpg",
        banner_data_url="data:image/png;base64,AAA",
    )
    store = make_store(tmp_path)
    store.books = [book]
    store.save()

    written = json.loads((tmp_path / "library.json").read_text())["books"][0]
    assert written["bannerPath"] == "C:\\Users\\me\\Amp\\banners\\bk_banner.jpg"
    assert written["bannerUrl"] == "https://example.test/wide.jpg"
    assert written["bannerDataUrl"] == "data:image/png;base64,AAA"

    reread = make_store(tmp_path)
    reread.load()
    assert reread.books[0].banner_path == book.banner_path
    assert reread.books[0].banner_url == book.banner_url
    assert reread.books[0].banner_data_url == book.banner_data_url


def test_banner_cache_directory_sits_next_to_covers():
    assert paths.banners_dir().name == "banners"
    assert paths.banners_dir().parent == paths.covers_dir().parent


def test_server_serves_a_cached_banner(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """`/api/cover?which=banner` answers with the banner file itself."""
    monkeypatch.setenv("AMP_DATA_DIR", str(tmp_path / "data"))
    banner = paths.banners_dir() / "bk_web.jpg"
    banner.parent.mkdir(parents=True, exist_ok=True)
    banner.write_bytes(b"\xff\xd8\xffJPEG-bytes")

    (tmp_path / "web").mkdir()
    (tmp_path / "web" / "index.html").write_text("<html>amp</html>")

    from amp_py.server import AmpServer

    server = AmpServer(root=tmp_path / "web", port=0, token="secret", host="127.0.0.1")
    assert server.start()["running"] is True
    try:
        import urllib.request

        port = server.httpd.server_address[1]
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}/api/cover?bookId=bk_web&which=banner&token=secret"
        ) as response:
            assert response.status == 200
            assert response.headers["Content-Type"].startswith("image/jpeg")
            assert response.read() == b"\xff\xd8\xffJPEG-bytes"

        # The same book, asked for its cover, has nothing to send.
        import urllib.error

        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/cover?bookId=bk_web&token=secret")
        except urllib.error.HTTPError as error:
            assert error.code == 404
        else:  # pragma: no cover - the request must fail
            raise AssertionError("a banner was served as a cover")
    finally:
        server.stop()


def test_server_falls_back_to_the_banner_the_book_points_at(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """A banner chosen elsewhere still shows: the library row is the fallback."""
    monkeypatch.setenv("AMP_DATA_DIR", str(tmp_path / "data"))
    chosen = tmp_path / "chosen-wide.png"
    chosen.write_bytes(b"\x89PNG-bytes")

    (tmp_path / "web").mkdir()
    (tmp_path / "web" / "index.html").write_text("<html>amp</html>")

    from amp_py.server import AmpServer

    store = LibraryStore(tmp_path / "library.json")
    store.books = [
        Book(
            id="bk_pointed",
            title="Neuromancer",
            author="William Gibson",
            source_path=str(tmp_path / "neuromancer.m4b"),
            banner_path=str(chosen),
        )
    ]
    store.save()

    server = AmpServer(
        root=tmp_path / "web",
        library=LibraryStore(tmp_path / "library.json"),
        port=0,
        token="secret",
        host="127.0.0.1",
    )
    assert server.start()["running"] is True
    try:
        import urllib.request

        port = server.httpd.server_address[1]
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}/api/cover?bookId=bk_pointed&which=banner&token=secret"
        ) as response:
            assert response.status == 200
            assert response.read() == b"\x89PNG-bytes"
    finally:
        server.stop()


def test_posting_a_banner_url_stores_it_on_the_host(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """The interface sends a URL; the host is the one who can write it to disk."""
    monkeypatch.setenv("AMP_DATA_DIR", str(tmp_path / "data"))
    (tmp_path / "web").mkdir()
    (tmp_path / "web" / "index.html").write_text("<html>amp</html>")
    store = LibraryStore(tmp_path / "library.json")
    store.books = [Book(id="bk_art", title="Piranesi", author="Susanna Clarke", source_path="/books/p.m4b")]
    store.save()

    from amp_py import server as server_module
    from amp_py.server import AmpServer

    # A stand-in for the network: the bytes and the content type a real fetch
    # would return, so the test never depends on Open Library being up.
    monkeypatch.setattr(server_module, "fetch_image", lambda _url: (b"\xff\xd8\xffwide", ".jpg"))

    server = AmpServer(
        root=tmp_path / "web", library=LibraryStore(tmp_path / "library.json"), port=0, token="secret", host="127.0.0.1"
    )
    assert server.start()["running"] is True
    try:
        import urllib.request

        port = server.httpd.server_address[1]
        request = urllib.request.Request(
            f"http://127.0.0.1:{port}/api/cover?token=secret",
            data=json.dumps({"bookId": "bk_art", "which": "banner", "url": "https://example.test/wide.jpg"}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request) as response:
            stored = json.loads(response.read())["path"]

        assert Path(stored).name == "bk_art.jpg"
        assert Path(stored).read_bytes() == b"\xff\xd8\xffwide"

        # The library now points at the stored banner, and the URL is gone: the
        # file is the truth from here on.
        saved = LibraryStore(tmp_path / "library.json")
        saved.load()
        assert saved.books[0].banner_path == stored
        assert saved.books[0].banner_url is None
    finally:
        server.stop()


def test_posting_a_cover_data_url_replaces_the_old_extension(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """A png replacing a jpg must not leave two candidates in the cache."""
    monkeypatch.setenv("AMP_DATA_DIR", str(tmp_path / "data"))
    (tmp_path / "web").mkdir()
    (tmp_path / "web" / "index.html").write_text("<html>amp</html>")
    store = LibraryStore(tmp_path / "library.json")
    store.books = [Book(id="bk_pick", title="Tempest", author="Peter Watts", source_path="/books/t.m4b")]
    store.save()

    paths.covers_dir().mkdir(parents=True, exist_ok=True)
    (paths.covers_dir() / "bk_pick.jpg").write_bytes(b"old jpg")

    from amp_py.server import AmpServer

    server = AmpServer(
        root=tmp_path / "web", library=LibraryStore(tmp_path / "library.json"), port=0, token="secret", host="127.0.0.1"
    )
    assert server.start()["running"] is True
    try:
        import base64
        import urllib.request

        png = b"\x89PNG\r\n\x1a\ncover-bytes"
        data_url = "data:image/png;base64," + base64.b64encode(png).decode()
        port = server.httpd.server_address[1]
        request = urllib.request.Request(
            f"http://127.0.0.1:{port}/api/cover?token=secret",
            data=json.dumps({"bookId": "bk_pick", "dataUrl": data_url}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request) as response:
            assert response.status == 200

        assert sorted(p.name for p in paths.covers_dir().glob("bk_pick.*")) == ["bk_pick.png"]
        assert (paths.covers_dir() / "bk_pick.png").read_bytes() == png
    finally:
        server.stop()


def test_artwork_for_an_unknown_book_is_a_404(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AMP_DATA_DIR", str(tmp_path / "data"))
    (tmp_path / "web").mkdir()
    (tmp_path / "web" / "index.html").write_text("<html>amp</html>")

    from amp_py.server import AmpServer

    server = AmpServer(
        root=tmp_path / "web", library=LibraryStore(tmp_path / "library.json"), port=0, token="secret", host="127.0.0.1"
    )
    assert server.start()["running"] is True
    try:
        import urllib.error
        import urllib.request

        port = server.httpd.server_address[1]
        for body in ({"bookId": "nope", "dataUrl": "data:image/png;base64,AAA"}, {"bookId": "nope"}):
            request = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/cover?token=secret",
                data=json.dumps(body).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                urllib.request.urlopen(request)
            except urllib.error.HTTPError as error:
                assert error.code == 404
            else:  # pragma: no cover - the request must fail
                raise AssertionError("an unknown book was accepted")

        request = urllib.request.Request(
            f"http://127.0.0.1:{port}/api/cover/extract?token=secret",
            data=json.dumps({"bookId": "nope"}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            urllib.request.urlopen(request)
        except urllib.error.HTTPError as error:
            assert error.code == 404
        else:  # pragma: no cover - the request must fail
            raise AssertionError("extraction for an unknown book was accepted")
    finally:
        server.stop()


def test_audio_carries_cors_headers_and_ranges(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """The playback path over HTTP.

    The player reads with `crossOrigin = "anonymous"` (WebAudio needs clean
    samples for the equalizer), so a response without CORS headers is refused.
    A client that has read the headers can also seek, which is what the range
    support is for.
    """
    monkeypatch.setenv("AMP_DATA_DIR", str(tmp_path / "data"))
    (tmp_path / "web").mkdir()
    (tmp_path / "web" / "index.html").write_text("<html>amp</html>")
    audio = tmp_path / "book.mp3"
    audio.write_bytes(bytes(range(256)) * 4)

    from amp_py.server import AmpServer

    server = AmpServer(
        root=tmp_path / "web", library=LibraryStore(tmp_path / "library.json"), port=0, token="secret", host="127.0.0.1"
    )
    assert server.start()["running"] is True
    try:
        import urllib.request

        port = server.httpd.server_address[1]
        quoted = urllib.parse.quote(str(audio))

        request = urllib.request.Request(
            f"http://127.0.0.1:{port}/api/audio?path={quoted}&token=secret",
            headers={"Origin": "http://example.test"},
        )
        with urllib.request.urlopen(request) as response:
            assert response.status == 200
            assert response.headers["Access-Control-Allow-Origin"] in {"*", "http://example.test"}
            assert "Content-Range" in response.headers["Access-Control-Expose-Headers"]
            assert response.headers["Accept-Ranges"] == "bytes"
            assert response.headers["Content-Type"] == "audio/mpeg"

        # An open ended range is how a player resumes: it must be 206 from the
        # requested offset, not the whole file again.
        ranged = urllib.request.Request(
            f"http://127.0.0.1:{port}/api/audio?path={quoted}&token=secret",
            headers={"Range": "bytes=512-", "Origin": "http://example.test"},
        )
        with urllib.request.urlopen(ranged) as response:
            assert response.status == 206
            assert response.headers["Content-Range"] == f"bytes 512-1023/{audio.stat().st_size}"
            assert response.headers["Content-Length"] == "512"
            assert response.headers["Access-Control-Allow-Origin"] in {"*", "http://example.test"}
    finally:
        server.stop()
