"""Where Amp keeps its files, following each platform's conventions."""

from __future__ import annotations

import os
import sys
from pathlib import Path


def app_data_dir() -> Path:
    """Where the app keeps its data (library, covers, transcripts, downloads).

    ``AMP_DATA_DIR`` moves it somewhere else. That is how the preview keeps its
    covers next to the web build, and how a portable install stays self
    contained instead of writing to the user profile.
    """
    override = os.environ.get("AMP_DATA_DIR")
    if override:
        return Path(override).expanduser()
    if sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    elif os.name == "nt":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / "amp"


def config_dir() -> Path:
    if os.name == "nt":
        return app_data_dir()
    base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return base / "amp"


def cache_dir() -> Path:
    base = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
    return base / "amp"


def library_file() -> Path:
    return app_data_dir() / "library.json"


def settings_file() -> Path:
    return config_dir() / "settings.json"


def covers_dir() -> Path:
    return app_data_dir() / "covers"


def banners_dir() -> Path:
    return app_data_dir() / "banners"


def transcripts_dir() -> Path:
    return app_data_dir() / "transcripts"


def models_dir() -> Path:
    return cache_dir() / "models"


def downloads_file() -> Path:
    return app_data_dir() / "downloads.json"


def ensure_dirs() -> None:
    for directory in (app_data_dir(), config_dir(), cache_dir(), covers_dir(), banners_dir(), transcripts_dir()):
        directory.mkdir(parents=True, exist_ok=True)
