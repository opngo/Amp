#!/usr/bin/env python3
"""Amp Python GUI - a small Tkinter companion for the Electron app.

Use it on a machine where you do not want a full desktop stack (a media box, a
NAS, a container with X forwarding). It reads the same library.json and
settings.json as the desktop app, so books imported here show up there.

    python gui.py
    python gui.py --library ~/books/library.json

Tabs:
    Library     books on disk, import a folder, play with mpv, transcribe
    Search      AudioBookBay search, send results to qBittorrent
    Downloads   transfer list: pause, resume, remove, import into the library
    Settings    qBittorrent credentials, import mode, whisper model, server
"""

from __future__ import annotations

import argparse
import threading
from pathlib import Path
from typing import Any, Callable
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from amp_py import paths  # noqa: E402
from amp_py.abb import AbbClient, AbbResult  # noqa: E402
from amp_py.config import Settings  # noqa: E402
from amp_py.library import LibraryStore, format_bytes, format_duration, import_paths  # noqa: E402
from amp_py.player import Player, detect_player  # noqa: E402
from amp_py.qbittorrent import QBittorrentClient, QbConfig  # noqa: E402
from amp_py.transcribe import Transcriber, probe_whisper  # noqa: E402

try:
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk
except ImportError as error:  # pragma: no cover - headless machines
    print(f"Tkinter is not available ({error}).", file=sys.stderr)
    print("Install it (Debian/Ubuntu: sudo apt install python3-tk) or use tui.py instead.", file=sys.stderr)
    raise SystemExit(2)

APP_TITLE = "Amp"


class GuiApp:
    def __init__(self, root: tk.Tk, library_path: str | None = None, settings_path: str | None = None) -> None:
        self.root = root
        self.root.title(f"{APP_TITLE} - audiobooks")
        self.root.geometry("1080x680")
        self.root.minsize(880, 560)

        paths.ensure_dirs()
        self.settings = Settings.load(settings_path)
        self.library = LibraryStore(library_path).load()
        self.abb = AbbClient()
        self.player = Player()
        self.transcriber = Transcriber(on_update=self._on_transcribe_update)
        self.results: list[AbbResult] = []
        self.transfers: list[Any] = []
        self.status_var = tk.StringVar(value=self._startup_status())

        self._build_style()
        self._build_layout()
        self.refresh_library()
        self.root.after(400, self._poll_transfers)
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    # ---------------------------------------------------------------- chrome
    def _build_style(self) -> None:
        style = ttk.Style()
        try:
            style.theme_use("clam")
        except tk.TclError:  # pragma: no cover - platform dependent
            pass
        style.configure(".", padding=4)
        style.configure("TNotebook.Tab", padding=(14, 8))
        style.configure("Muted.TLabel", foreground="#666666")

    def _build_layout(self) -> None:
        notebook = ttk.Notebook(self.root)
        notebook.pack(fill="both", expand=True, padx=10, pady=(10, 4))

        self.library_tab = ttk.Frame(notebook)
        self.search_tab = ttk.Frame(notebook)
        self.downloads_tab = ttk.Frame(notebook)
        self.settings_tab = ttk.Frame(notebook)
        notebook.add(self.library_tab, text="Library")
        notebook.add(self.search_tab, text="Search")
        notebook.add(self.downloads_tab, text="Downloads")
        notebook.add(self.settings_tab, text="Settings")

        self._build_library_tab()
        self._build_search_tab()
        self._build_downloads_tab()
        self._build_settings_tab()

        bar = ttk.Frame(self.root)
        bar.pack(fill="x", padx=12, pady=(0, 10))
        ttk.Label(bar, textvariable=self.status_var, style="Muted.TLabel").pack(side="left")

    # --------------------------------------------------------------- library
    def _build_library_tab(self) -> None:
        toolbar = ttk.Frame(self.library_tab)
        toolbar.pack(fill="x", pady=(6, 6))
        ttk.Button(toolbar, text="Import files", command=self.import_files).pack(side="left")
        ttk.Button(toolbar, text="Import folder", command=self.import_folder).pack(side="left", padx=6)
        ttk.Button(toolbar, text="Rescan", command=self.rescan).pack(side="left")
        ttk.Button(toolbar, text="Play", command=self.play_selected).pack(side="left", padx=6)
        ttk.Button(toolbar, text="Pause/Resume", command=self.toggle_playback).pack(side="left")
        ttk.Button(toolbar, text="Transcribe", command=self.transcribe_selected).pack(side="left", padx=6)
        self.group_var = tk.BooleanVar(value=self.settings.group_folders)
        ttk.Checkbutton(
            toolbar,
            text="Group a folder of tracks into one book",
            variable=self.group_var,
            command=self._save_grouping,
        ).pack(side="right")

        search_row = ttk.Frame(self.library_tab)
        search_row.pack(fill="x", pady=(0, 6))
        ttk.Label(search_row, text="Filter").pack(side="left")
        self.filter_var = tk.StringVar()
        entry = ttk.Entry(search_row, textvariable=self.filter_var)
        entry.pack(side="left", fill="x", expand=True, padx=6)
        self.filter_var.trace_add("write", lambda *_: self.refresh_library())

        columns = ("title", "author", "chapters", "length", "size", "progress")
        self.book_tree = ttk.Treeview(self.library_tab, columns=columns, show="headings", height=16)
        for column, label, width in (
            ("title", "Title", 320),
            ("author", "Author", 200),
            ("chapters", "Chapters", 80),
            ("length", "Length", 100),
            ("size", "Size", 100),
            ("progress", "Progress", 100),
        ):
            self.book_tree.heading(column, text=label)
            self.book_tree.column(column, width=width, anchor="w")
        self.book_tree.pack(fill="both", expand=True)
        self.book_tree.bind("<Double-1>", lambda _event: self.play_selected())

        self.stats_label = ttk.Label(self.library_tab, style="Muted.TLabel")
        self.stats_label.pack(anchor="w", pady=(6, 0))

    def _save_grouping(self) -> None:
        self.settings.update({"library": {"groupFolders": self.group_var.get()}})
        self.settings.save()
        self.status_var.set(f"Import mode: {'one book per folder' if self.group_var.get() else 'one book per file'}")

    def refresh_library(self) -> None:
        self.book_tree.delete(*self.book_tree.get_children())
        needle = self.filter_var.get().lower().strip()
        books = [book for book in self.library.books if needle in book.title.lower() or needle in book.author.lower()] if needle else list(self.library.books)
        for book in books:
            progress = f"{book.progress / book.duration * 100:.0f}%" if book.duration else "new"
            self.book_tree.insert(
                "",
                "end",
                iid=book.id,
                values=(
                    book.title,
                    book.author,
                    len(book.chapters),
                    format_duration(book.duration),
                    format_bytes(book.size_bytes),
                    progress,
                ),
            )
        stats = self.library.stats()
        self.stats_label.configure(
            text=(
                f"{stats['books']} books - {stats['chapters']} chapters - {stats['hours']} hours - "
                f"{format_bytes(stats['diskBytes'])} on disk - library: {self.library.path}"
            )
        )

    def _selected_book(self):
        selection = self.book_tree.selection()
        return self.library.find(selection[0]) if selection else None

    def import_files(self) -> None:
        chosen = filedialog.askopenfilenames(
            title="Add audiobooks",
            filetypes=[
                ("Audiobooks", "*.m4b *.m4a *.mp3 *.mp4 *.flac *.ogg *.opus *.aac"),
                ("All files", "*.*"),
            ],
        )
        if chosen:
            self._import(list(chosen))

    def import_folder(self) -> None:
        chosen = filedialog.askdirectory(title="Add a folder of audiobooks")
        if chosen:
            self._import([chosen])

    def _import(self, paths_in: list[str]) -> None:
        result = import_paths(self.library, paths_in, group_folders=self.group_var.get())
        self.library.load()
        self.refresh_library()
        self.status_var.set(f"Imported {result['added']} book(s) from {result['scanned']} file(s)")

    def rescan(self) -> None:
        roots = {str(Path(book.source_path).parent) if book.kind == "single" else book.source_path for book in self.library.books}
        if not roots:
            self.status_var.set("Nothing to rescan yet")
            return
        self._import(sorted(roots))

    def play_selected(self) -> None:
        book = self._selected_book()
        if not book:
            self.status_var.set("Select a book first")
            return
        try:
            self.player.play(book.primary_file(), start=book.progress)
            self.status_var.set(f"Playing {book.title} with {self.player.backend}")
        except Exception as error:  # noqa: BLE001
            self.status_var.set(str(error))

    def toggle_playback(self) -> None:
        if not self.player.is_running():
            self.play_selected()
            return
        self.player.toggle()
        book = self._selected_book()
        if book:
            self.library.record_progress(book.id, self.player.position())
        self.status_var.set("Paused" if self.player.state.paused else "Playing")

    def transcribe_selected(self) -> None:
        book = self._selected_book()
        if not book:
            self.status_var.set("Select a book first")
            return
        probe = probe_whisper()
        if not probe["available"]:
            messagebox.showwarning("Whisper not found", probe["message"])
            return
        job = self.transcriber.start(
            book.id,
            book.primary_file(),
            model=self.settings.transcription.get("model", "base.en"),
            language=self.settings.transcription.get("language") or None,
        )
        self.status_var.set(f"Transcribing {book.title} ({job.id})")

    def _on_transcribe_update(self, job) -> None:
        def update() -> None:
            self.status_var.set(f"Transcription {job.id}: {job.progress * 100:.0f}% ({job.status})")

        self.root.after(0, update)

    # ---------------------------------------------------------------- search
    def _build_search_tab(self) -> None:
        row = ttk.Frame(self.search_tab)
        row.pack(fill="x", pady=(6, 6))
        ttk.Label(row, text="AudioBookBay").pack(side="left")
        self.search_var = tk.StringVar()
        entry = ttk.Entry(row, textvariable=self.search_var)
        entry.pack(side="left", fill="x", expand=True, padx=6)
        entry.bind("<Return>", lambda _event: self.do_search())
        ttk.Button(row, text="Search", command=self.do_search).pack(side="left")
        ttk.Button(row, text="Download", command=self.download_selected).pack(side="left", padx=6)
        ttk.Button(row, text="Open details", command=self.open_details).pack(side="left")

        columns = ("title", "size", "format", "bitrate", "category", "posted")
        self.result_tree = ttk.Treeview(self.search_tab, columns=columns, show="headings", height=16)
        for column, label, width in (
            ("title", "Title", 420),
            ("size", "Size", 100),
            ("format", "Format", 80),
            ("bitrate", "Bitrate", 110),
            ("category", "Category", 180),
            ("posted", "Posted", 120),
        ):
            self.result_tree.heading(column, text=label)
            self.result_tree.column(column, width=width, anchor="w")
        self.result_tree.pack(fill="both", expand=True)
        self.result_tree.bind("<Double-1>", lambda _event: self.download_selected())

    def do_search(self) -> None:
        query = self.search_var.get().strip()
        if not query:
            return
        self.status_var.set(f"Searching for {query}...")

        def worker() -> None:
            try:
                results = self.abb.search(query, limit=40)
            except Exception as error:  # noqa: BLE001
                self.root.after(0, lambda: self.status_var.set(str(error)))
                return
            self.root.after(0, lambda: self._show_results(results, query))

        threading.Thread(target=worker, daemon=True).start()

    def _show_results(self, results: list[AbbResult], query: str) -> None:
        self.results = results
        self.result_tree.delete(*self.result_tree.get_children())
        for index, result in enumerate(results):
            self.result_tree.insert(
                "",
                "end",
                iid=str(index),
                values=(
                    result.title,
                    result.display_size,
                    result.format or "?",
                    result.bitrate or "?",
                    result.category,
                    result.posted,
                ),
            )
        self.status_var.set(f"{len(results)} result(s) for {query}")

    def _selected_result(self) -> AbbResult | None:
        selection = self.result_tree.selection()
        return self.results[int(selection[0])] if selection else None

    def open_details(self) -> None:
        result = self._selected_result()
        if not result:
            return
        import webbrowser

        webbrowser.open(result.detail_url)

    def download_selected(self) -> None:
        result = self._selected_result()
        if not result:
            self.status_var.set("Select a search result first")
            return

        def worker() -> None:
            try:
                client = QBittorrentClient(self.settings.qbittorrent)
                target = result
                if not target.magnet:
                    target = self.abb.resolve(result.detail_url)
                if not target.magnet:
                    self.root.after(0, lambda: self.status_var.set("That post has no magnet link"))
                    return
                client.add_magnet(target.magnet, target.title)
                self.root.after(0, lambda: self.status_var.set(f"Queued {target.title}"))
            except Exception as error:  # noqa: BLE001
                self.root.after(0, lambda: self.status_var.set(str(error)))

        threading.Thread(target=worker, daemon=True).start()

    # ------------------------------------------------------------- downloads
    def _build_downloads_tab(self) -> None:
        toolbar = ttk.Frame(self.downloads_tab)
        toolbar.pack(fill="x", pady=(6, 6))
        ttk.Button(toolbar, text="Refresh", command=self.refresh_transfers).pack(side="left")
        ttk.Button(toolbar, text="Pause", command=lambda: self._transfer_action("pause")).pack(side="left", padx=6)
        ttk.Button(toolbar, text="Resume", command=lambda: self._transfer_action("resume")).pack(side="left")
        ttk.Button(toolbar, text="Remove", command=lambda: self._transfer_action("remove")).pack(side="left", padx=6)
        ttk.Button(toolbar, text="Import finished", command=self.import_finished).pack(side="left")

        columns = ("name", "state", "progress", "size", "speed", "eta")
        self.transfer_tree = ttk.Treeview(self.downloads_tab, columns=columns, show="headings", height=16)
        for column, label, width in (
            ("name", "Name", 420),
            ("state", "State", 120),
            ("progress", "Progress", 100),
            ("size", "Size", 110),
            ("speed", "Speed", 110),
            ("eta", "ETA", 100),
        ):
            self.transfer_tree.heading(column, text=label)
            self.transfer_tree.column(column, width=width, anchor="w")
        self.transfer_tree.pack(fill="both", expand=True)

    def _poll_transfers(self) -> None:
        self.refresh_transfers(silent=True)
        self.root.after(4000, self._poll_transfers)

    def refresh_transfers(self, silent: bool = False) -> None:
        try:
            client = QBittorrentClient(self.settings.qbittorrent)
            self.transfers = client.list()
        except Exception as error:  # noqa: BLE001
            if not silent:
                self.status_var.set(str(error))
            return
        selected = self.transfer_tree.selection()
        self.transfer_tree.delete(*self.transfer_tree.get_children())
        for item in self.transfers:
            eta = format_duration(item.eta) if item.eta and item.eta < 86400 * 3 else "-"
            self.transfer_tree.insert(
                "",
                "end",
                iid=item.hash,
                values=(
                    item.name,
                    item.human_state,
                    f"{item.progress * 100:.1f}%",
                    format_bytes(item.size),
                    f"{format_bytes(item.download_speed)}/s" if item.download_speed else "-",
                    eta,
                ),
            )
        if selected:
            self.transfer_tree.selection_set(selected)
        if not silent:
            self.status_var.set(f"{len(self.transfers)} transfer(s)")

    def _transfer_action(self, action: str) -> None:
        selection = self.transfer_tree.selection()
        if not selection:
            self.status_var.set("Select a transfer first")
            return
        torrent_hash = selection[0]
        try:
            client = QBittorrentClient(self.settings.qbittorrent)
            if action == "pause":
                client.pause(torrent_hash)
            elif action == "resume":
                client.resume(torrent_hash)
            else:
                client.remove(torrent_hash, delete_files=False)
            self.status_var.set(f"{action.capitalize()}d")
            self.refresh_transfers(silent=True)
        except Exception as error:  # noqa: BLE001
            self.status_var.set(str(error))

    def import_finished(self) -> None:
        selection = self.transfer_tree.selection()
        if not selection:
            self.status_var.set("Select a finished transfer first")
            return
        torrent_hash = selection[0]

        def worker() -> None:
            try:
                client = QBittorrentClient(self.settings.qbittorrent)
                files = client.finished_audio_files(torrent_hash)
                if not files:
                    self.root.after(0, lambda: self.status_var.set("No audio files in that transfer yet"))
                    return
                result = import_paths(
                    self.library,
                    [file["path"] for file in files if file["path"]],
                    group_folders=self.group_var.get(),
                )
                self.library.load()

                def done() -> None:
                    self.refresh_library()
                    self.status_var.set(f"Imported {result['added']} book(s) from the download")

                self.root.after(0, done)
            except Exception as error:  # noqa: BLE001
                self.root.after(0, lambda: self.status_var.set(str(error)))

        threading.Thread(target=worker, daemon=True).start()

    # --------------------------------------------------------------- settings
    def _build_settings_tab(self) -> None:
        frame = ttk.Frame(self.settings_tab, padding=12)
        frame.pack(fill="both", expand=True)

        qb = self.settings.qbittorrent
        self.vars: dict[str, tk.StringVar] = {
            "url": tk.StringVar(value=qb.url),
            "username": tk.StringVar(value=qb.username),
            "password": tk.StringVar(value=qb.password),
            "category": tk.StringVar(value=qb.category),
            "save_path": tk.StringVar(value=qb.save_path),
            "model": tk.StringVar(value=self.settings.transcription.get("model", "base.en")),
            "language": tk.StringVar(value=self.settings.transcription.get("language", "en")),
            "port": tk.StringVar(value=str(self.settings.server.get("port", 8787))),
            "token": tk.StringVar(value=str(self.settings.server.get("token", ""))),
        }

        rows: list[tuple[str, str, bool]] = [
            ("qBittorrent URL", "url", False),
            ("Username", "username", False),
            ("Password", "password", True),
            ("Category", "category", False),
            ("Save path", "save_path", False),
            ("Whisper model", "model", False),
            ("Transcription language", "language", False),
            ("Server port", "port", False),
            ("Server token", "token", True),
        ]
        for index, (label, key, secret) in enumerate(rows):
            ttk.Label(frame, text=label).grid(row=index, column=0, sticky="w", pady=4)
            entry = ttk.Entry(frame, textvariable=self.vars[key], width=52, show="*" if secret else "")
            entry.grid(row=index, column=1, sticky="we", pady=4, padx=8)
        frame.columnconfigure(1, weight=1)

        buttons = ttk.Frame(frame)
        buttons.grid(row=len(rows), column=0, columnspan=2, sticky="w", pady=(12, 0))
        ttk.Button(buttons, text="Test connection", command=self.test_qbittorrent).pack(side="left")
        ttk.Button(buttons, text="Save settings", command=self.save_settings).pack(side="left", padx=6)
        ttk.Button(buttons, text="Open data folder", command=self.open_data_folder).pack(side="left")

        info = ttk.Label(
            frame,
            style="Muted.TLabel",
            justify="left",
            text=(
                f"Player: {detect_player() or 'none found (install mpv)'}\n"
                f"Whisper: {probe_whisper()['message']}\n"
                f"Library: {self.library.path}\n"
                f"Settings: {paths.settings_file()}"
            ),
        )
        info.grid(row=len(rows) + 1, column=0, columnspan=2, sticky="w", pady=(16, 0))

    def _collect_settings(self) -> None:
        config = QbConfig(
            url=self.vars["url"].get(),
            username=self.vars["username"].get(),
            password=self.vars["password"].get(),
            category=self.vars["category"].get() or "amp-audiobooks",
            save_path=self.vars["save_path"].get(),
            sequential=True,
        )
        self.settings.qbittorrent = config
        self.settings.update(
            {
                "transcription": {
                    "model": self.vars["model"].get() or "base.en",
                    "language": self.vars["language"].get() or "en",
                },
                "server": {
                    "port": int(self.vars["port"].get() or 8787),
                    "token": self.vars["token"].get(),
                    "host": "0.0.0.0",
                },
            }
        )

    def save_settings(self) -> None:
        self._collect_settings()
        self.settings.save()
        self.status_var.set("Settings saved")

    def test_qbittorrent(self) -> None:
        self._collect_settings()

        def worker() -> None:
            result = QBittorrentClient(self.settings.qbittorrent).test()
            self.root.after(0, lambda: self.status_var.set(result["message"]))

        threading.Thread(target=worker, daemon=True).start()

    def open_data_folder(self) -> None:
        import subprocess

        opener = {"darwin": "open", "win32": "explorer"}.get(sys.platform, "xdg-open")
        subprocess.Popen([opener, str(paths.app_data_dir())])

    # ----------------------------------------------------------------- close
    def _startup_status(self) -> str:
        pieces = [f"{len(self.library.books)} books"]
        pieces.append(f"player: {detect_player() or 'none'}")
        pieces.append(f"whisper: {'ready' if probe_whisper()['available'] else 'not found'}")
        return " - ".join(pieces)

    def _on_close(self) -> None:
        self.player.stop()
        self.settings.save()
        self.root.destroy()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Amp Python GUI")
    parser.add_argument("--library", help="path to library.json")
    parser.add_argument("--settings", help="path to settings.json")
    parser.add_argument("--check", action="store_true", help="report what the environment supports and exit")
    args = parser.parse_args(argv)

    if args.check:
        print(f"player   : {detect_player() or 'none found'}")
        print(f"whisper  : {probe_whisper()['message']}")
        print(f"data dir : {paths.app_data_dir()}")
        print(f"library  : {args.library or paths.library_file()}")
        return 0

    root = tk.Tk()
    GuiApp(root, library_path=args.library, settings_path=args.settings)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
