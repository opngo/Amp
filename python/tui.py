#!/usr/bin/env python3
"""Amp terminal UI - AudioBookBay search and downloads.

Deliberately narrow in scope: the TUI is for finding an audiobook on
AudioBookBay and getting it into qBittorrent. Playback and library management
belong to the desktop app or gui.py.

Interactive:
    python tui.py

Scriptable (no TTY needed):
    python tui.py --search "project hail mary"
    python tui.py --search dune --download 1
    python tui.py --queue
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from typing import Any

# curses is optional. On Windows it is not part of the standard library (it
# lives in the `windows-curses` package), and some minimal Python builds omit
# the `_curses` extension module entirely - importing it at the top of the file
# would take the whole TUI down with "ModuleNotFoundError: No module named
# '_curses'" even for the scriptable flags that never draw anything.
try:  # pragma: no cover - depends on the platform
    import curses
except ImportError:  # pragma: no cover
    curses = None  # type: ignore[assignment]

CURSES_HELP = """\
Amp's interactive terminal UI needs the curses module, which this Python does
not have.

  Windows      pip install windows-curses
  Debian/Ubuntu  sudo apt install python3-curses
  Alpine       apk add ncurses
  macOS        the system Python includes it; a pyenv build needs ncurses headers

Everything else works without it, for example:

  python tui.py --search "project hail mary"
  python tui.py --search dune --download 1
  python tui.py --queue
"""

sys.path.insert(0, str(Path(__file__).resolve().parent))

from amp_py import paths  # noqa: E402
from amp_py.abb import AbbClient, AbbResult  # noqa: E402
from amp_py.config import Settings  # noqa: E402
from amp_py.library import format_bytes  # noqa: E402
from amp_py.qbittorrent import QBittorrentClient  # noqa: E402

HELP_TEXT = """\
Keys
  /            search AudioBookBay
  Enter        open the selected result / download it
  d            download the selected result (magnet to qBittorrent)
  t            show the torrent table for the selection
  q or Esc     back / quit
  r            refresh the transfer list
  p            pause the selected transfer
  u            resume the selected transfer
  x            remove the selected transfer (files are kept)
  Tab          switch between results and transfers
"""


class TuiState:
    def __init__(self, settings: Settings, client: AbbClient) -> None:
        self.settings = settings
        self.abb = client
        self.query = ""
        self.results: list[AbbResult] = []
        self.transfers: list[dict[str, Any]] = []
        self.selected = 0
        self.mode = "results"
        self.status = "Press / to search AudioBookBay"
        self.detail: AbbResult | None = None

    # ------------------------------------------------------------- actions --
    def search(self, query: str) -> None:
        self.query = query
        self.status = f"Searching for {query}..."
        try:
            self.results = self.abb.search(query, limit=40)
            self.status = f"{len(self.results)} result(s) for {query}" if self.results else f"No results for {query}"
        except Exception as error:  # noqa: BLE001 - surfaced in the status bar
            self.results = []
            self.status = str(error)
        self.selected = 0
        self.mode = "results"

    def qb_client(self) -> QBittorrentClient:
        return QBittorrentClient(self.settings.qbittorrent)

    def refresh_transfers(self) -> None:
        try:
            client = self.qb_client()
            self.transfers = [
                {
                    "hash": item.hash,
                    "name": item.name,
                    "state": item.human_state,
                    "progress": item.progress,
                    "size": item.size,
                    "speed": item.download_speed,
                }
                for item in client.list()
            ]
            self.status = f"{len(self.transfers)} transfer(s)"
        except Exception as error:  # noqa: BLE001
            self.transfers = []
            self.status = str(error)

    def download(self, result: AbbResult) -> None:
        try:
            client = self.qb_client()
            if not result.magnet and result.detail_url:
                self.status = "Resolving magnet..."
                result = self.abb.resolve(result.detail_url)
            if not result.magnet:
                self.status = "That post has no magnet link or info hash"
                return
            client.add_magnet(result.magnet, result.title)
            self.status = f"Queued {result.title} in qBittorrent"
            self.refresh_transfers()
        except Exception as error:  # noqa: BLE001
            self.status = str(error)

    def show_detail(self, result: AbbResult) -> None:
        try:
            self.detail = self.abb.detail(result.detail_url)
            self.status = f"{self.detail.title} - {self.detail.size_text or 'size unknown'}"
        except Exception as error:  # noqa: BLE001
            self.status = str(error)


# --------------------------------------------------------------------- curses
def draw(stdscr: "curses._CursesWindow", state: TuiState) -> None:
    curses.curs_set(0)
    stdscr.erase()
    height, width = stdscr.getmaxyx()

    title = f" Amp {state.settings.data.get('version', '')} - AudioBookBay "
    stdscr.addstr(0, 0, title.ljust(width - 1), curses.A_REVERSE)
    stdscr.addstr(1, 0, f"Query: {state.query or '(none)'}"[: width - 1])

    rows = height - 6
    if state.mode == "transfers":
        stdscr.addstr(2, 0, "Transfers"[: width - 1], curses.A_BOLD)
        for index, item in enumerate(state.transfers[:rows]):
            marker = ">" if index == state.selected else " "
            line = (
                f"{marker} {item['name'][: width - 40]}  {item['progress'] * 100:5.1f}%  "
                f"{item['state']}  {format_bytes(item['size'])}  {format_bytes(item['speed'])}/s"
            )
            attribute = curses.A_REVERSE if index == state.selected else curses.A_NORMAL
            stdscr.addstr(3 + index, 0, line[: width - 1], attribute)
    else:
        header = "Results" if state.results else "No results yet - press / to search"
        stdscr.addstr(2, 0, header[: width - 1], curses.A_BOLD)
        for index, result in enumerate(state.results[:rows]):
            marker = ">" if index == state.selected else " "
            line = (
                f"{marker} {result.title[: width - 34]}  "
                f"{result.display_size:>10}  {result.format or '?':>4}  {result.bitrate or ''}"
            )
            attribute = curses.A_REVERSE if index == state.selected else curses.A_NORMAL
            stdscr.addstr(3 + index, 0, line[: width - 1], attribute)

    if state.detail:
        details = state.detail
        info = (
            f"{details.title} - {details.parsed_author or 'unknown author'} - "
            f"{details.size_text or 'size unknown'} - {len(details.trackers)} tracker(s)"
        )
        stdscr.addstr(height - 3, 0, info[: width - 1])

    stdscr.addstr(height - 2, 0, state.status[: width - 1], curses.A_DIM)
    stdscr.addstr(height - 1, 0, "/ search   Enter download   t transfers   r refresh   ? help   q quit"[: width - 1], curses.A_DIM)
    stdscr.refresh()


def prompt(stdscr: "curses._CursesWindow", label: str) -> str:
    height, width = stdscr.getmaxyx()
    curses.curs_set(1)
    curses.echo()
    stdscr.addstr(height - 2, 0, " " * (width - 1))
    stdscr.addstr(height - 2, 0, label[: width - 1])
    stdscr.refresh()
    try:
        value = stdscr.getstr(height - 2, len(label), width - len(label) - 2)
    except curses.error:
        value = b""
    curses.noecho()
    curses.curs_set(0)
    return value.decode(errors="replace").strip()


def run_curses(state: TuiState) -> int:
    if curses is None:  # pragma: no cover - platform dependent
        print(CURSES_HELP, file=sys.stderr)
        return 2

    def main(stdscr: "curses._CursesWindow") -> int:
        state.refresh_transfers()
        while True:
            draw(stdscr, state)
            key = stdscr.getch()

            if key in (ord("q"), 27):
                if state.mode == "transfers":
                    state.mode = "results"
                    continue
                return 0
            if key == ord("?"):
                stdscr.erase()
                for index, line in enumerate(HELP_TEXT.splitlines()):
                    stdscr.addstr(index, 0, line[: stdscr.getmaxyx()[1] - 1])
                stdscr.addstr(len(HELP_TEXT.splitlines()) + 1, 0, "Press any key to return")
                stdscr.getch()
            elif key == ord("/"):
                query = prompt(stdscr, "Search: ")
                if query:
                    state.search(query)
            elif key == curses.KEY_UP:
                state.selected = max(0, state.selected - 1)
            elif key == curses.KEY_DOWN:
                limit = len(state.transfers) if state.mode == "transfers" else len(state.results)
                state.selected = min(max(0, limit - 1), state.selected + 1)
            elif key == 9:  # Tab
                state.mode = "transfers" if state.mode == "results" else "results"
                state.selected = 0
            elif key == ord("r"):
                state.refresh_transfers()
            elif key == ord("t"):
                state.mode = "transfers"
                state.refresh_transfers()
                state.selected = 0
            elif key in (10, 13, curses.KEY_ENTER, ord("d")):
                if state.mode == "results" and state.results:
                    state.download(state.results[state.selected])
                elif state.mode == "transfers" and state.transfers:
                    state.refresh_transfers()
            elif key == ord("p") and state.transfers:
                try:
                    state.qb_client().pause(state.transfers[state.selected]["hash"])
                    state.status = "Paused"
                    state.refresh_transfers()
                except Exception as error:  # noqa: BLE001
                    state.status = str(error)
            elif key == ord("u") and state.transfers:
                try:
                    state.qb_client().resume(state.transfers[state.selected]["hash"])
                    state.status = "Resumed"
                    state.refresh_transfers()
                except Exception as error:  # noqa: BLE001
                    state.status = str(error)
            elif key == ord("x") and state.transfers:
                try:
                    state.qb_client().remove(state.transfers[state.selected]["hash"])
                    state.status = "Removed (files kept)"
                    state.refresh_transfers()
                except Exception as error:  # noqa: BLE001
                    state.status = str(error)

    return curses.wrapper(main)


# ---------------------------------------------------------------- plain mode
def run_plain(state: TuiState, args: argparse.Namespace) -> int:
    if args.search:
        state.search(args.search)
        print(f"\n{state.status}\n")
        for index, result in enumerate(state.results, start=1):
            print(
                f"{index:>3}. {result.title}\n"
                f"     {result.display_size:>10}  {result.format or '?'}  {result.bitrate or '?'}  "
                f"{result.posted}\n     {result.detail_url}"
            )
        if args.download:
            if not 1 <= args.download <= len(state.results):
                print("Download index out of range", file=sys.stderr)
                return 2
            state.download(state.results[args.download - 1])
            print(state.status)
        return 0

    if args.queue:
        state.refresh_transfers()
        print(state.status)
        for item in state.transfers:
            print(f"  {item['progress'] * 100:5.1f}%  {item['state']:<10} {item['name']}")
        return 0

    if not sys.stdout.isatty():
        print("Not a terminal. Use --search <query> or --queue, or see --help.", file=sys.stderr)
        return 2
    return run_curses(state)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Amp terminal UI for AudioBookBay downloads",
        epilog="Without curses installed, use --search, --download and --queue.",
    )
    parser.add_argument("--search", help="search AudioBookBay and print results")
    parser.add_argument("--download", type=int, help="with --search, queue result N in qBittorrent")
    parser.add_argument("--queue", action="store_true", help="print the qBittorrent transfer list")
    parser.add_argument("--mirror", action="append", help="extra AudioBookBay mirror to try")
    parser.add_argument("--settings", metavar="PATH", help="path to settings.json")
    parser.add_argument(
        "--print-settings",
        action="store_true",
        help="print the effective configuration (qBittorrent, mirrors, paths) and exit",
    )
    args = parser.parse_args(argv)

    paths.ensure_dirs()
    settings = Settings.load(args.settings)

    if args.print_settings:
        qb = settings.qbittorrent
        print("qBittorrent")
        print(f"  url      : {qb.url}")
        print(f"  username : {qb.username}")
        print(f"  category : {qb.category}")
        print(f"  save path: {qb.save_path or '(client default)'}")
        print("AudioBookBay")
        for mirror in AbbClient(mirrors=args.mirror).mirrors:
            print(f"  mirror   : {mirror}")
        print("Paths")
        print(f"  data     : {paths.app_data_dir()}")
        print(f"  library  : {paths.library_file()}")
        print(f"  settings : {paths.settings_file()}")
        return 0

    client = AbbClient(mirrors=args.mirror)
    state = TuiState(settings, client)

    try:
        return run_plain(state, args)
    except KeyboardInterrupt:
        print("\nInterrupted")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
