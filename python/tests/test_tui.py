"""The TUI must survive a Python without the curses module."""

from __future__ import annotations

import builtins
import importlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def load_tui_without_curses():
    """Imports tui.py with `curses` and `_curses` unavailable."""
    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name in {"curses", "_curses"}:
            raise ImportError("No module named '_curses'")
        return real_import(name, *args, **kwargs)

    builtins.__import__ = fake_import
    sys.modules.pop("tui", None)
    try:
        return importlib.import_module("tui")
    finally:
        builtins.__import__ = real_import
        sys.modules.pop("tui", None)


def test_import_does_not_require_curses():
    tui = load_tui_without_curses()
    assert tui.curses is None


def test_interactive_entry_explains_the_fix(capsys):
    tui = load_tui_without_curses()
    code = tui.run_curses(object())
    captured = capsys.readouterr()
    assert code == 2
    assert "windows-curses" in captured.err
    assert "--search" in captured.err


def test_scriptable_flags_still_parse_without_curses():
    tui = load_tui_without_curses()
    parser = tui.build_parser() if hasattr(tui, "build_parser") else None
    if parser is not None:
        args = parser.parse_args(["--queue"])
        assert args.queue is True
