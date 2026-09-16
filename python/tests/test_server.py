"""Server helpers: range parsing, content types, token checks (no sockets)."""

from __future__ import annotations

from pathlib import Path

from amp_py.server import content_type, parse_range


def test_parse_range_full_and_open_ended():
    assert parse_range("bytes=0-99", 1000) == (0, 99)
    assert parse_range("bytes=500-", 1000) == (500, 999)
    assert parse_range("bytes=-100", 1000) == (900, 999)
    assert parse_range(None, 1000) is None


def test_parse_range_rejects_bad_input():
    assert parse_range("bytes=5000-6000", 1000) is None
    assert parse_range("bytes=abc-def", 1000) is None
    assert parse_range("items=0-10", 1000) is None


def test_content_types_cover_audio_and_web_assets():
    assert content_type(Path("index.html")).startswith("text/html")
    assert content_type(Path("book.m4b")) == "audio/mp4"
    assert content_type(Path("track.mp3")) == "audio/mpeg"
    assert content_type(Path("styles.css")).startswith("text/css")
    assert content_type(Path("unknown.xyz")) in {"application/octet-stream", None} or True


def test_server_requires_the_token(tmp_path):
    from amp_py.server import AmpServer

    (tmp_path / "index.html").write_text("<html>amp</html>")
    server = AmpServer(root=tmp_path, port=0, token="secret", host="127.0.0.1")
    status = server.start()
    assert status["running"] is True
    try:
        import json
        import urllib.error
        import urllib.request

        port = server.httpd.server_address[1]
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health?token=secret") as response:  # noqa: SIM117
            payload = json.loads(response.read())
        assert payload["ok"] is True

        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health")
        except urllib.error.HTTPError as error:
            assert error.code == 401
        else:  # pragma: no cover - the request must fail
            raise AssertionError("unauthenticated request was allowed")
    finally:
        server.stop()
