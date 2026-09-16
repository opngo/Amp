"""Settings for the Python tools.

The Python side reads the same settings.json the desktop app exports, but only
touches the keys it understands and leaves everything else intact.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import paths
from .qbittorrent import QbConfig

DEFAULTS: dict[str, Any] = {
    "version": 3,
    "library": {"groupFolders": True},
    "torrents": {
        "qbittorrent": QbConfig().to_dict(),
        # Same shape as core/settings.ts: the indexers are objects, so the
        # interface can read `.enabled` off them.
        "sources": [
            {
                "id": "audiobookbay",
                "name": "AudiobookBay",
                "kind": "scraper",
                "enabled": True,
                "baseUrl": "https://audiobookbay.lu",
            },
            {
                "id": "audiobookbay-alt",
                "name": "AudiobookBay (mirror)",
                "kind": "scraper",
                "enabled": True,
                "baseUrl": "https://audiobookbay.is",
            },
        ],
        "minSeeders": 0,
        "autoImport": True,
        "preferredQuality": "m4b",
    },
    "transcription": {"model": "base.en", "language": "en"},
    "server": {"port": 8787, "host": "0.0.0.0", "enabled": False, "token": ""},
    "documentCount": 0,
}


def _merge(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    output = dict(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(output.get(key), dict):
            output[key] = _merge(output[key], value)
        else:
            output[key] = value
    return output


def _widen_sources(value: Any) -> list[dict[str, Any]] | None:
    """Accept plain indexer ids and return the objects the interface reads."""
    if not isinstance(value, list):
        return None
    widened: list[dict[str, Any]] = []
    for entry in value:
        if isinstance(entry, str):
            default = next((item for item in DEFAULTS["torrents"]["sources"] if item["id"] == entry), None)
            widened.append(
                dict(default)
                if default
                else {"id": entry, "name": entry, "kind": "scraper", "enabled": True, "baseUrl": ""}
            )
        elif isinstance(entry, dict) and isinstance(entry.get("id"), str):
            widened.append({**entry, "enabled": entry.get("enabled", True) is not False})
    return widened or None


@dataclass
class Settings:
    data: dict[str, Any] = field(default_factory=lambda: json.loads(json.dumps(DEFAULTS)))

    @classmethod
    def load(cls, path: str | None = None) -> "Settings":
        target = Path(path) if path else paths.settings_file()
        try:
            raw = json.loads(target.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return cls()
        merged = _merge(json.loads(json.dumps(DEFAULTS)), raw)
        torrents = merged.setdefault("torrents", {})
        widened = _widen_sources(torrents.get("sources"))
        if widened is not None:
            torrents["sources"] = widened
        torrents.setdefault("minSeeders", 0)
        return cls(merged)

    def save(self, path: str | None = None) -> None:
        target = Path(path) if path else paths.settings_file()
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(self.data, indent=2), encoding="utf-8")

    # --------------------------------------------------------------- access --
    @property
    def qbittorrent(self) -> QbConfig:
        return QbConfig.from_dict(self.data.get("torrents", {}).get("qbittorrent", {}))

    @qbittorrent.setter
    def qbittorrent(self, config: QbConfig) -> None:
        self.data.setdefault("torrents", {})["qbittorrent"] = config.to_dict()

    @property
    def group_folders(self) -> bool:
        return bool(self.data.get("library", {}).get("groupFolders", True))

    @property
    def server(self) -> dict[str, Any]:
        return dict(self.data.get("server", DEFAULTS["server"]))

    @property
    def transcription(self) -> dict[str, Any]:
        return dict(self.data.get("transcription", DEFAULTS["transcription"]))

    def get(self, key: str, fallback: Any = None) -> Any:
        return self.data.get(key, fallback)

    def update(self, patch: dict[str, Any]) -> "Settings":
        self.data = _merge(self.data, patch)
        return self


__all__ = ["Settings", "DEFAULTS"]
