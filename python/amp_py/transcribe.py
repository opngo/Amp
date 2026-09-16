"""Whisper runner for the Python side.

Amp never bundles a model: it looks for whisper.cpp or the OpenAI Python
package, runs the job and writes srt/vtt/txt/json next to the book. Both
dialects print progress differently, so the parser here understands both.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from . import paths

BINARIES = ("whisper-cli", "whisper-cpp", "main", "whisper", "whisper-ctranslate2")

MODELS: dict[str, int] = {
    "tiny.en": 75,
    "base.en": 142,
    "small.en": 466,
    "medium.en": 1500,
    "base": 142,
    "small": 466,
    "large-v3": 3100,
}

PROGRESS_RE = re.compile(r"(\d{1,3})\s*%")
SEGMENT_RE = re.compile(r"(\d+)\s*/\s*(\d+)")
TRANSCRIPT_LINE_RE = re.compile(r"^\s*\[[\d:.,\->\s]+\]\s*(.+)$")


def probe_whisper() -> dict[str, Any]:
    for name in BINARIES:
        binary = shutil.which(name)
        if not binary:
            continue
        kind = "openai-whisper" if name.startswith("whisper") and "cl" not in name else "whisper.cpp"
        models = []
        if paths.models_dir().exists():
            models = [item.name for item in paths.models_dir().glob("*.bin")]
        return {
            "available": True,
            "binary": binary,
            "kind": kind,
            "models": models,
            "message": f"Using {kind} at {binary}",
        }
    return {
        "available": False,
        "binary": None,
        "kind": None,
        "models": [],
        "message": "Whisper was not found. Install whisper.cpp or `pip install openai-whisper`.",
    }


def parse_progress(line: str) -> dict[str, Any] | None:
    """Understand both whisper.cpp and openai-whisper stderr lines."""
    text = line.strip()
    if not text:
        return None
    percent = PROGRESS_RE.search(text)
    if percent:
        value = max(0, min(100, int(percent.group(1))))
        segment = SEGMENT_RE.search(text)
        return {
            "percent": value,
            "status": "done" if value >= 100 else "running",
            "message": f"{segment.group(1)} of {segment.group(2)} segments" if segment else None,
        }
    if re.search(r"error|failed|cannot|couldn't", text, re.IGNORECASE):
        return {"status": "error", "message": text[:200]}
    if re.search(r"detecting language|loading model|processing", text, re.IGNORECASE):
        return {"status": "loading", "message": text[:200]}
    transcript = TRANSCRIPT_LINE_RE.match(text)
    if transcript:
        return {"status": "running", "message": transcript.group(1)[:160]}
    return None


def build_args(
    kind: str,
    input_path: str,
    output_dir: str,
    model: str = "base.en",
    language: str | None = None,
    threads: int | None = None,
    translate: bool = False,
) -> list[str]:
    threads = threads or max(1, min(8, (os.cpu_count() or 2) // 2))
    if kind == "whisper.cpp":
        model_path = str(paths.models_dir() / f"{model}.bin")
        args = [
            "-m",
            model_path,
            "-f",
            input_path,
            "-of",
            str(Path(output_dir) / "transcript"),
            "-osrt",
            "-ovtt",
            "-otxt",
            "-t",
            str(threads),
            "--print-progress",
        ]
        if language:
            args += ["-l", language]
        if translate:
            args.append("--translate")
        return args
    args = [
        input_path,
        "--model",
        model,
        "--output_dir",
        output_dir,
        "--output_format",
        "srt,vtt,txt,json",
        "--verbose",
        "False",
        "--threads",
        str(threads),
    ]
    if language:
        args += ["--language", language]
    if translate:
        args += ["--task", "translate"]
    return args


@dataclass
class Job:
    id: str
    book_id: str
    input_path: str
    model: str = "base.en"
    status: str = "queued"  # queued | running | done | error | cancelled
    progress: float = 0.0
    log: list[str] = field(default_factory=list)
    started_at: float = 0.0
    finished_at: float | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "bookId": self.book_id,
            "status": self.status,
            "progress": self.progress,
            "log": self.log[-200:],
            "startedAt": self.started_at,
            "finishedAt": self.finished_at,
            "error": self.error,
        }


class Transcriber:
    """Run transcription jobs in the background and keep their state."""

    def __init__(self, on_update: Callable[[Job], None] | None = None) -> None:
        self.jobs: dict[str, Job] = {}
        self.processes: dict[str, subprocess.Popen[str]] = {}
        self.on_update = on_update

    def start(
        self,
        book_id: str,
        input_path: str,
        model: str = "base.en",
        language: str | None = None,
        translate: bool = False,
    ) -> Job:
        probe = probe_whisper()
        if not probe["available"]:
            raise RuntimeError(probe["message"])

        job = Job(
            id=f"job_{uuid.uuid4().hex[:8]}",
            book_id=book_id,
            input_path=input_path,
            model=model,
            status="running",
            started_at=time.time(),
        )
        output_dir = paths.transcripts_dir() / book_id
        output_dir.mkdir(parents=True, exist_ok=True)
        args = build_args(
            "whisper.cpp" if probe["kind"] == "whisper.cpp" else "openai-whisper",
            input_path,
            str(output_dir),
            model=model,
            language=language,
            translate=translate,
        )
        self.jobs[job.id] = job
        process = subprocess.Popen(
            [probe["binary"], *args],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        self.processes[job.id] = process

        def pump() -> None:
            assert process.stdout is not None
            for line in process.stdout:
                job.log.append(line.rstrip())
                if len(job.log) > 400:
                    job.log = job.log[-200:]
                progress = parse_progress(line)
                if not progress:
                    continue
                if progress.get("percent") is not None:
                    job.progress = progress["percent"] / 100
                if progress.get("status") == "error":
                    job.status = "error"
                    job.error = progress.get("message")
                if self.on_update:
                    self.on_update(job)
            code = process.wait()
            job.finished_at = time.time()
            if job.status != "cancelled":
                if code == 0:
                    job.status = "done"
                    job.progress = 1.0
                    job.log.append("Transcript ready")
                else:
                    job.status = "error"
                    job.error = job.error or f"Whisper exited with code {code}"
            self.processes.pop(job.id, None)
            if self.on_update:
                self.on_update(job)

        threading.Thread(target=pump, name=f"amp-whisper-{job.id}", daemon=True).start()
        return job

    def cancel(self, job_id: str) -> bool:
        process = self.processes.get(job_id)
        job = self.jobs.get(job_id)
        if not process or not job:
            return False
        job.status = "cancelled"
        job.finished_at = time.time()
        process.terminate()
        return True

    def status(self, job_id: str) -> dict[str, Any] | None:
        job = self.jobs.get(job_id)
        return job.to_dict() if job else None

    def list(self) -> list[dict[str, Any]]:
        return [job.to_dict() for job in self.jobs.values()]

    def transcript(self, book_id: str) -> dict[str, Any] | None:
        directory = paths.transcripts_dir() / book_id
        srt = directory / "transcript.srt"
        text_file = directory / "transcript.txt"
        payload_file = directory / "transcript.json"
        if not srt.exists() and not text_file.exists() and not payload_file.exists():
            return None

        language = "en"
        cues: list[dict[str, Any]] = []
        text = ""
        if payload_file.exists():
            try:
                payload = json.loads(payload_file.read_text(encoding="utf-8"))
                language = payload.get("language", language)
                text = payload.get("text", "")
                cues = [
                    {"start": seg["start"], "end": seg["end"], "text": seg["text"].strip()}
                    for seg in payload.get("segments", [])
                ]
            except (json.JSONDecodeError, KeyError):
                pass
        if text_file.exists():
            text = text or text_file.read_text(encoding="utf-8")
        return {"bookId": book_id, "language": language, "cues": cues, "text": text.strip()}


__all__ = ["Transcriber", "Job", "probe_whisper", "parse_progress", "build_args", "MODELS"]
