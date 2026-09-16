"""Amp for Python.

The Python side of Amp is deliberately dependency-free: it uses only the
standard library so it can run on a headless box, a Raspberry Pi or inside a
container. Three entry points build on it:

    gui.py      small Tkinter companion app (library, search, downloads)
    tui.py      terminal UI for AudioBookBay downloads
    server.py   optional remote server (the same API as the desktop app)

Everything shared lives in this package: the JSON library, the AudioBookBay
parser, the qBittorrent Web API client, an mpv/vlc playback bridge and the
Whisper runner.
"""

from .library import LibraryStore, import_paths, AUDIO_EXTENSIONS
from .abb import AbbClient, parse_detail, parse_search
from .qbittorrent import QBittorrentClient, QbConfig
from .player import Player, detect_player
from .transcribe import Transcriber, probe_whisper

__version__ = "0.9.0"

__all__ = [
    "LibraryStore",
    "import_paths",
    "AUDIO_EXTENSIONS",
    "AbbClient",
    "parse_detail",
    "parse_search",
    "QBittorrentClient",
    "QbConfig",
    "Player",
    "detect_player",
    "Transcriber",
    "probe_whisper",
    "__version__",
]
