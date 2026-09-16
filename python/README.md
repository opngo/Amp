# Amp Python tools

A third front end for the same library, written with the standard library only.
No pip install, no build step, no Electron: it runs on a media box, a NAS, a
server or inside a container.

```bash
python python/gui.py                  # Tkinter window: library, search, downloads
python python/tui.py                  # terminal UI for AudioBookBay downloads
python python/server.py               # optional HTTP server for the built web app
python -m pytest python/tests         # tests, no network required
```

Full documentation: [docs/python.md](../docs/python.md),
[docs/remote-server.md](../docs/remote-server.md).

## Package

| Module | Contents |
| --- | --- |
| `amp_py/paths.py` | Data, cache, cover and transcript locations; `AMP_DATA_DIR` overrides |
| `amp_py/library.py` | `LibraryStore`, `Book`, `Chapter`, grouping, import, stats |
| `amp_py/abb.py` | AudioBookBay search and detail parsing, mirror rotation |
| `amp_py/qbittorrent.py` | Web API client: login, search, transfers, finished files |
| `amp_py/player.py` | mpv over JSON IPC, with vlc and ffplay fallbacks |
| `amp_py/transcribe.py` | Whisper probing, jobs, progress parsing |
| `amp_py/config.py` | settings.json, the same keys as the desktop app |
| `amp_py/server.py` | The HTTP API with range requests and token auth |

## Data

By default the tools use the same folder as the desktop app
(`~/.local/share/amp` on Linux, `~/Library/Application Support/amp` on macOS,
`%APPDATA%/amp` on Windows), so a library imported in one place is visible in the
others. Point them somewhere else with `--library`/`--settings`, or with the
`AMP_DATA_DIR` and `AMP_CONFIG_DIR` environment variables:

```bash
AMP_DATA_DIR=~/audiobooks/amp python python/gui.py
```

## Requirements

Python 3.10 or newer. Then, all optional:

- Tkinter for `gui.py` (`sudo apt install python3-tk` on Debian and Ubuntu)
- Curses for the interactive `tui.py` (Windows: `pip install windows-curses`;
  the scriptable flags work without it)
- `mpv`, `vlc` or `ffplay` for playback
- qBittorrent with the Web UI enabled, for downloads
- whisper.cpp or `pip install openai-whisper`, for transcription

Each tool reports what it cannot find and keeps working for everything else:

```bash
python python/gui.py --check
python python/tui.py --print-settings
python python/server.py --print-url
```

## Tests

```bash
python -m pytest python/tests -q
```

The suite covers grouping in both modes, chapter rules, JSON round-trips,
AudioBookBay parsing against markup from the live site, magnets, sizes,
qBittorrent payloads, whisper progress and HTTP range parsing. It never touches
the network.
