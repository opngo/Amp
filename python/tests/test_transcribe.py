"""Whisper progress parsing and command construction."""

from __future__ import annotations

from amp_py.transcribe import build_args, parse_progress, probe_whisper


def test_parses_whisper_cpp_percentages():
    progress = parse_progress("whisper_print_progress_callback: progress = 43%")
    assert progress["percent"] == 43
    assert progress["status"] == "running"


def test_parses_python_cli_segment_counters():
    progress = parse_progress(" 43%|####      | 13/30 [00:12<00:16, 1.2it/s]")
    assert progress["percent"] == 43
    assert progress["message"] == "13 of 30 segments"


def test_clamps_and_flags_completion():
    assert parse_progress("progress = 140%")["percent"] == 100
    assert parse_progress("progress = 100%")["status"] == "done"


def test_reading_states_and_errors():
    assert parse_progress("error: model not found")["status"] == "error"
    assert parse_progress("Detecting language using up to the first 30 seconds")["status"] == "loading"
    assert parse_progress("") is None
    assert parse_progress("[00:00:12.000 --> 00:00:15.000]  The spice must flow")["message"] == "The spice must flow"


def test_openai_args_and_cpp_args():
    openai = build_args("openai-whisper", "/books/dune.m4b", "/tmp/out", model="small.en", language="en", threads=4)
    assert openai[0] == "/books/dune.m4b"
    assert "--output_format" in openai
    assert openai[openai.index("--threads") + 1] == "4"

    cpp = build_args("whisper.cpp", "/books/dune.m4b", "/tmp/out", model="base.en", language="auto", threads=6)
    assert cpp[cpp.index("-m") + 1].endswith("base.en.bin")
    assert cpp[cpp.index("-of") + 1].endswith("transcript")
    assert "-osrt" in cpp


def test_probe_reports_something_useful():
    probe = probe_whisper()
    assert set(probe) >= {"available", "binary", "kind", "models", "message"}
    assert isinstance(probe["message"], str) and probe["message"]
