"""qBittorrent payload normalisation and file selection."""

from __future__ import annotations

from amp_py.qbittorrent import QbConfig, normalize_torrent, pick_audio_files


def test_normalize_torrent_maps_api_fields():
    torrent = normalize_torrent(
        {
            "hash": "abc123",
            "name": "Dune",
            "state": "downloading",
            "progress": 0.42,
            "dlspeed": 1024,
            "upspeed": 12,
            "eta": 300,
            "size": 10**9,
            "downloaded": 4 * 10**8,
            "save_path": "/downloads/audiobooks",
            "added_on": 1700000000,
        }
    )
    assert torrent.hash == "abc123"
    assert torrent.progress == 0.42
    assert torrent.human_state == "Downloading"
    assert torrent.finished is False


def test_finished_states_are_recognised():
    assert normalize_torrent({"state": "pausedUP"}).finished is True
    assert normalize_torrent({"state": "uploading"}).finished is True
    assert normalize_torrent({"state": "stalledDL"}).finished is False
    assert normalize_torrent({"state": "pausedUP"}).human_state == "Finished"


def test_pick_audio_files_ignores_artwork_and_nfo():
    picked = pick_audio_files(
        ["book/01.mp3", "book/book.m4b", "book/cover.jpg", "book/book.nfo", "book/book.cue"]
    )
    assert picked == ["book/01.mp3", "book/book.m4b"]


def test_config_round_trip():
    config = QbConfig(url="http://box:8080/", username="amp", password="secret", save_path="/books")
    data = config.to_dict()
    assert QbConfig.from_dict(data).save_path == "/books"
    assert QbConfig.from_dict({}).url == "http://127.0.0.1:8080"


def test_client_reports_connection_errors_clearly():
    client = __import__("amp_py.qbittorrent", fromlist=["QBittorrentClient"]).QBittorrentClient(
        QbConfig(url="http://127.0.0.1:1", password="x")
    )
    result = client.test()
    assert result["ok"] is False
    assert "qBittorrent" in result["message"]
