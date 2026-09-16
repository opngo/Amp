"""Library grouping, JSON round-trips and formatting."""

from __future__ import annotations

import json
import time
from pathlib import Path

from amp_py.library import (
    Book,
    LibraryStore,
    chapter_from_filename,
    format_bytes,
    format_duration,
    group_files,
    import_paths,
    natural_key,
    walk_audio,
)


def make_tree(tmp_path: Path) -> Path:
    """A folder of tracks plus a single m4b container, like a real library."""
    folder = tmp_path / "Neuromancer"
    folder.mkdir()
    for index in (1, 2, 10):
        (folder / f"Track {index}.mp3").write_bytes(b"x" * 10)

    container = tmp_path / "Dune.m4b"
    container.write_bytes(b"y" * 32)
    (tmp_path / "cover.jpg").write_bytes(b"z")
    return folder


def test_natural_sort_puts_track_2_before_track_10():
    names = ["Track 10.mp3", "Track 2.mp3", "Track 1.mp3"]
    assert sorted(names, key=natural_key) == ["Track 1.mp3", "Track 2.mp3", "Track 10.mp3"]


def test_chapter_titles_come_from_filenames():
    assert chapter_from_filename("Track 4.mp3") == "Track 4"
    assert chapter_from_filename("Chapter 12.m4b") == "Chapter 12"
    assert chapter_from_filename("3 - The Sprawl.mp3") == "3. The Sprawl"


def test_walk_audio_skips_non_audio_and_hidden(tmp_path):
    (tmp_path / "a.mp3").write_bytes(b"a")
    (tmp_path / "notes.txt").write_text("ignore")
    hidden = tmp_path / ".cache"
    hidden.mkdir()
    (hidden / "b.mp3").write_bytes(b"b")
    found = [path.name for path in walk_audio(tmp_path)]
    assert found == ["a.mp3"]


def test_group_folders_creates_one_book_with_many_chapters(tmp_path):
    folder = make_tree(tmp_path)
    books = group_files(sorted(walk_audio(folder)), group_folders=True)
    assert len(books) == 1
    book = books[0]
    assert book.kind == "multi"
    assert book.title == "Neuromancer"
    assert [chapter.index for chapter in book.chapters] == [1, 2, 3]
    assert [chapter.title for chapter in book.chapters] == ["Track 1", "Track 2", "Track 10"]
    assert len(book.files()) == 3


def test_group_folders_off_creates_one_book_per_file(tmp_path):
    folder = make_tree(tmp_path)
    books = group_files(sorted(walk_audio(folder)), group_folders=False)
    assert len(books) == 3
    assert all(book.kind == "single" for book in books)
    assert {book.title for book in books} == {"Track 1", "Track 2", "Track 10"}


def test_containers_are_always_their_own_book(tmp_path):
    folder = make_tree(tmp_path)
    (folder / "Interview.m4b").write_bytes(b"c" * 5)
    books = group_files(sorted(walk_audio(folder)), group_folders=True)
    kinds = {book.kind: book.title for book in books}
    assert kinds["single"] == "Interview"
    assert kinds["multi"] == "Neuromancer"


def test_import_and_reimport_is_idempotent(tmp_path):
    folder = make_tree(tmp_path)
    store = LibraryStore(tmp_path / "library.json")
    first = import_paths(store, [str(folder)], group_folders=False)
    assert first["added"] == 3

    store.load()
    second = import_paths(store, [str(folder)], group_folders=False)
    assert second["added"] == 0
    assert len(store.books) == 3


def test_library_json_round_trip(tmp_path):
    path = tmp_path / "library.json"
    store = LibraryStore(path)
    store.books.append(
        Book(
            id="bk_test",
            title="Dune",
            author="Frank Herbert",
            source_path="/books/dune.m4b",
            duration=3600,
            size_bytes=1024,
        )
    )
    store.folders.append({"id": "fd_1", "name": "Sci-Fi"})
    store.save()

    reloaded = LibraryStore(path).load()
    assert reloaded.books[0].title == "Dune"
    assert reloaded.books[0].to_json()["sourcePath"] == "/books/dune.m4b"
    assert reloaded.folders[0]["name"] == "Sci-Fi"
    assert reloaded.stats()["hours"] == 1.0


def test_search_and_progress(tmp_path):
    store = LibraryStore(tmp_path / "library.json")
    store.books.append(Book(id="b1", title="Piranesi", author="Susanna Clarke", source_path="/x"))
    store.books.append(Book(id="b2", title="Blindsight", author="Peter Watts", source_path="/y"))
    assert [book.id for book in store.search("pira")] == ["b1"]
    assert [book.id for book in store.search("watts")] == ["b2"]

    store.record_progress("b1", 123.0)
    assert store.find("b1").progress == 123.0
    assert store.remove("b2") is True
    assert len(store.books) == 1


def test_formatters():
    assert format_duration(59) == "0:59"
    assert format_duration(3661) == "1:01:01"
    assert format_bytes(1024) == "1.0 KB"
    assert format_bytes(5) == "5 B"


def test_reload_if_changed_picks_up_external_writes(tmp_path):
    """Another tool (or the desktop app) may rewrite the library file."""
    path = tmp_path / "library.json"
    store = LibraryStore(str(path))
    store.save()
    assert store.reload_if_changed() is False  # nothing changed yet

    payload = json.loads(path.read_text())
    payload["books"] = [
        {
            "id": "bk_outside",
            "title": "Written By Another Tool",
            "sourcePath": "/tmp/outside.m4b",
            "kind": "single",
            "duration": 60,
            "chapters": [{"id": "ch_1", "index": 1, "title": "One", "start": 0, "duration": 60}],
            "addedAt": 1_789_428_286_760,
        }
    ]
    time.sleep(0.01)
    path.write_text(json.dumps(payload))

    assert store.reload_if_changed() is True
    assert [book.title for book in store.books] == ["Written By Another Tool"]


def test_timestamps_are_milliseconds(tmp_path):
    """Seconds written by an older file are widened, so dates do not read 1970."""
    path = tmp_path / "library.json"
    path.write_text(json.dumps({"books": [{"id": "bk_old", "title": "Old", "addedAt": 1_789_428_286}]}))
    store = LibraryStore(str(path)).load()
    assert store.books[0].added_at == 1_789_428_286_000


def test_fresh_books_are_stamped_in_milliseconds():
    book = Book(id="bk_fresh", title="Fresh", author="Nobody", source_path="/tmp/fresh.m4b")
    assert book.added_at > 1_000_000_000_000


def test_save_only_reloads_when_the_file_really_changed(tmp_path):
    """A stale in-memory copy must not be able to clobber a newer file."""
    store = LibraryStore(str(tmp_path / "library.json"))
    store.books.append(Book(id="bk_1", title="First", author="A", source_path="/x/1.wav"))
    store.save()
    assert store.reload_if_changed() is False, "same fingerprint means nothing changed"

    newer = LibraryStore(str(tmp_path / "library.json")).load()
    newer.books.append(Book(id="bk_2", title="Second", author="B", source_path="/x/2.wav"))
    newer.save()

    assert store.reload_if_changed() is True
    assert [book.id for book in store.books] == ["bk_1", "bk_2"]

    payload = json.loads((tmp_path / "library.json").read_text())
    assert any(book["title"] == "Second" for book in payload["books"])
