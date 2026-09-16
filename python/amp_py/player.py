"""Playback bridge for the Python side.

Playback is delegated to whatever is installed: mpv (controlled over its JSON
IPC socket), or vlc / ffplay with a fire-and-forget subprocess. This keeps the
Python tools useful on a headless box where bundling an audio stack would be
absurd, while still supporting play, pause, seek, chapter jumps, speed and
volume when mpv is present.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

BACKENDS = ("mpv", "vlc", "ffplay", "cvlc")


def detect_player() -> str | None:
    for backend in BACKENDS:
        if shutil.which(backend):
            return backend
    return None


def mpv_available() -> bool:
    return shutil.which("mpv") is not None


@dataclass
class PlaybackState:
    playing: bool = False
    position: float = 0.0
    duration: float = 0.0
    speed: float = 1.0
    volume: int = 100
    paused: bool = True


class Player:
    """Control a local media player, preferring mpv's IPC socket."""

    def __init__(self, backend: str | None = None, socket_path: str | None = None) -> None:
        self.backend = backend or detect_player()
        self.socket_path = socket_path or os.path.join(
            tempfile.gettempdir(), f"amp-mpv-{os.getpid()}.sock"
        )
        self.process: subprocess.Popen[bytes] | None = None
        self.current_file: str | None = None
        self.start_offset = 0.0
        self.state = PlaybackState()

    # ------------------------------------------------------------ plumbing --
    @property
    def available(self) -> bool:
        return self.backend is not None

    def _connect(self, timeout: float = 0.4) -> socket.socket | None:
        if not self.socket_path or not os.path.exists(self.socket_path):
            return None
        try:
            connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            connection.settimeout(timeout)
            connection.connect(self.socket_path)
            return connection
        except OSError:
            return None

    def _command(self, *args: Any) -> Any:
        """Send one mpv command and read its reply."""
        connection = self._connect()
        if not connection:
            return None
        try:
            payload = json.dumps({"command": list(args)}).encode() + b"\n"
            connection.sendall(payload)
            time.sleep(0.05)
            data = connection.recv(65536)
            if not data:
                return None
            for line in data.decode(errors="replace").splitlines():
                try:
                    parsed = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if "data" in parsed:
                    return parsed["data"]
            return None
        finally:
            connection.close()

    def _property(self, name: str) -> Any:
        return self._command("get_property", name)

    # ------------------------------------------------------------- public ---
    def play(self, path: str | Path, start: float = 0.0, speed: float = 1.0) -> bool:
        """Start (or restart) playback of a file at `start` seconds."""
        if not self.available:
            raise RuntimeError(
                "No supported player found. Install mpv (recommended) or vlc/ffplay."
            )
        self.stop()
        file_path = str(path)
        self.current_file = file_path
        self.start_offset = start

        if self.backend == "mpv":
            if os.path.exists(self.socket_path):
                os.unlink(self.socket_path)
            self.process = subprocess.Popen(
                [
                    "mpv",
                    "--no-video",
                    "--really-quiet",
                    f"--input-ipc-server={self.socket_path}",
                    f"--start={start}",
                    f"--speed={speed}",
                    file_path,
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        elif self.backend in {"vlc", "cvlc"}:
            self.process = subprocess.Popen(
                [self.backend, "--intf", "dummy", f"--start-time={start}", f"--rate={speed}", file_path],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        else:  # ffplay has no control interface; it is a fallback for listening only.
            self.process = subprocess.Popen(
                ["ffplay", "-nodisp", "-autoexit", "-ss", str(start), file_path],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

        self.state = PlaybackState(playing=True, paused=False, position=start, speed=speed)
        return True

    def toggle(self) -> None:
        if self.backend == "mpv":
            self._command("cycle", "pause")
            self.state.paused = not self.state.paused
            self.state.playing = not self.state.paused
        elif self.process and self.process.poll() is None:
            # Without an IPC socket we can only stop and resume from scratch.
            self.stop()

    def pause(self) -> None:
        if self.backend == "mpv":
            self._command("set_property", "pause", True)
            self.state.paused = True
            self.state.playing = False

    def resume(self) -> None:
        if self.backend == "mpv":
            self._command("set_property", "pause", False)
            self.state.paused = False
            self.state.playing = True

    def seek(self, seconds: float, absolute: bool = False) -> None:
        if self.backend == "mpv":
            if absolute:
                self._command("set_property", "time-pos", max(0.0, seconds))
                self.state.position = max(0.0, seconds)
            else:
                self._command("seek", seconds)
                self.state.position = max(0.0, self.state.position + seconds)

    def skip(self, seconds: float) -> None:
        self.seek(seconds, absolute=False)

    def set_speed(self, speed: float) -> None:
        if self.backend == "mpv":
            self._command("set_property", "speed", speed)
        self.state.speed = speed

    def set_volume(self, volume: int) -> None:
        volume = max(0, min(100, int(volume)))
        if self.backend == "mpv":
            self._command("set_property", "volume", volume)
        self.state.volume = volume

    def position(self) -> float:
        if self.backend == "mpv":
            value = self._property("time-pos")
            if isinstance(value, (int, float)):
                self.state.position = float(value)
            duration = self._property("duration")
            if isinstance(duration, (int, float)):
                self.state.duration = float(duration)
        elif self.process and self.process.poll() is not None:
            self.state.playing = False
        return self.state.position

    def is_running(self) -> bool:
        return bool(self.process and self.process.poll() is None)

    def stop(self) -> None:
        if self.backend == "mpv":
            self._command("quit")
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:  # pragma: no cover - defensive
                self.process.kill()
        self.process = None
        self.state.playing = False
        self.state.paused = True

    def status(self) -> dict[str, Any]:
        return {
            "backend": self.backend,
            "available": self.available,
            "file": self.current_file,
            "playing": self.state.playing,
            "paused": self.state.paused,
            "position": round(self.position(), 2),
            "duration": round(self.state.duration, 2),
            "speed": self.state.speed,
            "volume": self.state.volume,
        }


__all__ = ["Player", "PlaybackState", "detect_player", "mpv_available", "BACKENDS"]
