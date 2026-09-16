"""Audio metadata for the Python side of Amp.

The desktop app reads tags with `music-metadata` plus a hand written MP4
chapter reader. The Python tools (``gui.py``, ``server.py``, ``tui.py`` and the
seeding script) need the same information when they import a folder, and they
must not depend on ffmpeg being installed, so this module reads the containers
directly with the standard library only.

What it understands:

* MP4 family (``.m4b``, ``.m4a``, ``.mp4``, ``.m4v``) - duration from ``mvhd``,
  tags from the iTunes ``ilst`` box, cover art from ``covr``, and chapters from
  either the Nero ``chpl`` box or the dedicated chapter track referenced by the
  audio track's ``tref/chap`` entry (sample tables: ``stts``, ``stsz``,
  ``stsc``, ``stco``/``co64``).
* MP3 (and other MPEG audio) - ID3v2 tags plus frame based duration, honouring
  the Xing/Info header so variable bitrate files report the right length.
* Anything else - WAV through the ``wave`` module, and nothing at all rather
  than a guess when the format is unknown.

Everything degrades quietly: a broken tag never stops an import, it just leaves
the field empty.
"""

from __future__ import annotations

import os
import struct
import wave
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

__all__ = [
    "AudioMeta",
    "read_metadata",
    "read_mp4",
    "read_id3",
    "read_wav",
    "is_mp4_family",
]

MP4_SUFFIXES = {".m4b", ".m4a", ".mp4", ".m4v", ".mov", ".aax"}
MP3_SUFFIXES = {".mp3", ".mp2", ".mpa"}
WAV_SUFFIXES = {".wav", ".wave"}
MAX_MOOV_BYTES = 64 * 1024 * 1024

# iTunes tag atoms -> our field names. `----` atoms carry a mean/name pair and
# are handled separately, because Audible and friends put narrators there.
ILST_TEXT = {
    b"\xa9nam": "title",
    b"\xa9ART": "author",
    b"\xa9alb": "album",
    b"\xa9gen": "genre",
    b"\xa9day": "year",
    # Audiobook tools follow the music convention: the author goes in the
    # artist atom and the narrator in the composer atom.
    b"\xa9wrt": "narrator",
    b"desc": "description",
    b"ldes": "description",
    b"\xa9cmt": "comment",
    b"grp ": "group",
    b"cprt": "copyright",
    b"trkn": "track",
}


@dataclass
class AudioMeta:
    """Everything Amp can learn about an audio file without decoding it."""

    duration: float = 0.0
    title: str | None = None
    author: str | None = None
    narrator: str | None = None
    album: str | None = None
    genres: list[str] = field(default_factory=list)
    year: int | None = None
    description: str | None = None
    #: (title, start seconds, end seconds)
    chapters: list[tuple[str, float, float]] = field(default_factory=list)
    cover: bytes | None = None
    cover_mime: str | None = None
    bitrate: int | None = None
    codec: str | None = None

    def merged_with(self, other: "AudioMeta") -> "AudioMeta":
        """Fill empty fields from *other* (used to merge ID3 and lame headers)."""
        for name in ("title", "author", "narrator", "album", "description", "cover", "cover_mime", "codec"):
            if getattr(self, name) in (None, "", b""):
                setattr(self, name, getattr(other, name))
        if not self.duration:
            self.duration = other.duration
        if not self.genres:
            self.genres = list(other.genres)
        if not self.chapters:
            self.chapters = list(other.chapters)
        self.year = self.year or other.year
        self.bitrate = self.bitrate or other.bitrate
        return self


# --------------------------------------------------------------- helpers ----


def _u16(data: bytes, offset: int) -> int:
    return struct.unpack_from(">H", data, offset)[0]


def _u32(data: bytes, offset: int) -> int:
    return struct.unpack_from(">I", data, offset)[0]


def _u64(data: bytes, offset: int) -> int:
    return struct.unpack_from(">Q", data, offset)[0]


def _fourcc(data: bytes, offset: int) -> bytes:
    return data[offset : offset + 4]


def _text(raw: bytes) -> str | None:
    """UTF-8 (or Latin-1 as a fallback) text out of an ``ilst`` data box."""
    if not raw:
        return None
    cleaned = raw.split(b"\x00")[0] if raw[0:1] == b"\x00" else raw
    for encoding in ("utf-8", "utf-16", "latin-1"):
        try:
            value = cleaned.decode(encoding).strip()
        except (UnicodeDecodeError, AttributeError):
            continue
        value = value.replace("\x00", "").strip()
        if value:
            return value
    return None


def is_mp4_family(path: str | Path) -> bool:
    return Path(path).suffix.lower() in MP4_SUFFIXES


# ------------------------------------------------------------------ MP4 ----


def _boxes(data: bytes, start: int, end: int) -> list[tuple[bytes, int, int]]:
    """The boxes directly inside a byte range: (type, payload start, payload end)."""
    out: list[tuple[bytes, int, int]] = []
    position = start
    limit = min(end, len(data))
    while position + 8 <= limit:
        size = _u32(data, position)
        header = 8
        if size == 1:
            if position + 16 > limit:
                break
            size = _u64(data, position + 8)
            header = 16
        elif size == 0:
            size = limit - position
        if size < header or position + size > limit:
            break
        out.append((_fourcc(data, position + 4), position + header, position + size))
        position += size
    return out


def _first(data: bytes, start: int, end: int, wanted: bytes) -> tuple[int, int] | None:
    for kind, child_start, child_end in _boxes(data, start, end):
        if kind == wanted:
            return child_start, child_end
    return None


def _all(data: bytes, start: int, end: int, wanted: bytes) -> list[tuple[int, int]]:
    return [(child_start, child_end) for kind, child_start, child_end in _boxes(data, start, end) if kind == wanted]


def _find_path(data: bytes, start: int, end: int, path: list[bytes]) -> tuple[int, int] | None:
    current = (start, end)
    for kind in path:
        found = _first(data, current[0], current[1], kind)
        if not found:
            return None
        current = found
    return current


def _ilst_values(ilst_start: int, ilst_end: int, data: bytes) -> tuple[dict[str, str], bytes | None, str | None, list[str]]:
    """Read the iTunes metadata atoms collected in an ``ilst`` box."""
    fields: dict[str, str] = {}
    cover: bytes | None = None
    cover_mime: str | None = None
    narrators: list[str] = []

    for kind, item_start, item_end in _boxes(data, ilst_start, ilst_end):
        values = _all(data, item_start, item_end, b"data")
        if not values:
            continue
        for value_start, value_end in values:
            if value_end - value_start < 8:
                continue
            data_type = _u32(data, value_start)
            payload = data[value_start + 8 : value_end]
            if kind == b"covr":
                cover = payload
                cover_mime = {13: "image/jpeg", 14: "image/png", 27: "image/bmp"}.get(data_type & 0xFFFFFF, "image/jpeg")
                continue
            if kind == b"----":
                # Freeform atoms: mean/name identify the field, data the value.
                name_box = _first(data, item_start, item_end, b"name")
                mean_box = _first(data, item_start, item_end, b"mean")
                name = _text(data[name_box[0] + 4 : name_box[1]]) if name_box else None
                mean = _text(data[mean_box[0] + 4 : mean_box[1]]) if mean_box else None
                label = f"{mean}:{name}".lower()
                text = _text(payload)
                if not text:
                    continue
                if "narrat" in label:
                    narrators.append(text)
                elif "author" in label or "artist" in label:
                    fields.setdefault("author", text)
                elif "title" in label:
                    fields.setdefault("title", text)
                elif "genre" in label:
                    fields.setdefault("genre", text)
                elif "year" in label or "date" in label:
                    fields.setdefault("year", text)
                continue
            text = _text(payload)
            if not text:
                continue
            mapped = ILST_TEXT.get(kind)
            if mapped:
                fields.setdefault(mapped, text)
            elif kind == b"tmpo":
                pass

    return fields, cover, cover_mime, narrators


def _metadata_block(data: bytes, moov_start: int, moov_end: int) -> tuple[dict[str, str], bytes | None, str | None, list[str]]:
    udta = _first(data, moov_start, moov_end, b"udta")
    if not udta:
        return {}, None, None, []
    meta = _first(data, udta[0], udta[1], b"meta")
    if not meta:
        return {}, None, None, []
    # `meta` is a full box (4 byte version/flags) in ISO files) but a plain
    # container in some QuickTime writers, so look at where the children start.
    start, end = meta
    if _u32(data, start) != 0 and _fourcc(data, start + 4) in (b"hdlr", b"ilst", b"keys"):
        pass  # QuickTime style: the first child box starts immediately
    else:
        start += 4
    ilst = _first(data, start, end, b"ilst")
    if not ilst:
        return {}, None, None, []
    return _ilst_values(ilst[0], ilst[1], data)


def _chpl_chapters(data: bytes, moov_start: int, moov_end: int) -> list[tuple[str, float, float]]:
    """Nero style ``chpl`` box: 8 byte header then (start, title) tables."""
    udta = _first(data, moov_start, moov_end, b"udta")
    if not udta:
        return []
    chpl = _first(data, udta[0], udta[1], b"chpl")
    if not chpl:
        return []
    start, end = chpl
    if end - start < 9:
        return []
    count = data[start + 8]
    position = start + 9
    raw: list[tuple[float, str]] = []
    for _ in range(count):
        if position + 9 > end:
            break
        timestamp = _u64(data, position) / 10_000_000.0  # 100 nanosecond units
        length = data[position + 8]
        position += 9
        title = data[position : position + length].decode("utf-8", "replace")
        position += length
        raw.append((timestamp, title.strip()))
    out: list[tuple[str, float, float]] = []
    for index, (timestamp, title) in enumerate(raw):
        following = raw[index + 1][0] if index + 1 < len(raw) else None
        out.append((title or f"Chapter {index + 1}", timestamp, following if following is not None else 0.0))
    return out


def _sample_sizes(data: bytes, stbl: tuple[int, int]) -> list[int]:
    stsz = _first(data, stbl[0], stbl[1], b"stsz")
    if not stsz:
        return []
    start, end = stsz
    fixed = _u32(data, start + 4)
    count = _u32(data, start + 8)
    if fixed:
        return [fixed] * count
    sizes = []
    position = start + 12
    for _ in range(count):
        if position + 4 > end:
            break
        sizes.append(_u32(data, position))
        position += 4
    return sizes


def _sample_offsets(data: bytes, stbl: tuple[int, int], sizes: list[int]) -> list[int]:
    """Absolute byte offset of every sample, following stsc + stco/co64."""
    stsc = _first(data, stbl[0], stbl[1], b"stsc")
    if not stsc:
        return []
    chunk_offsets: list[int] = []
    stco = _first(data, stbl[0], stbl[1], b"stco")
    co64 = _first(data, stbl[0], stbl[1], b"co64")
    if stco:
        count = _u32(data, stco[0] + 4)
        for index in range(count):
            position = stco[0] + 8 + index * 4
            if position + 4 > stco[1]:
                break
            chunk_offsets.append(_u32(data, position))
    elif co64:
        count = _u32(data, co64[0] + 4)
        for index in range(count):
            position = co64[0] + 8 + index * 8
            if position + 8 > co64[1]:
                break
            chunk_offsets.append(_u64(data, position))
    if not chunk_offsets:
        return []

    entries: list[tuple[int, int, int]] = []
    start, end = stsc
    count = _u32(data, start + 4)
    for index in range(count):
        position = start + 8 + index * 12
        if position + 12 > end:
            break
        entries.append((_u32(data, position), _u32(data, position + 4), _u32(data, position + 8)))
    if not entries:
        return []

    offsets: list[int] = []
    sample = 0
    for index, (first_chunk, per_chunk, _description) in enumerate(entries):
        last_chunk = entries[index + 1][0] - 1 if index + 1 < len(entries) else len(chunk_offsets)
        for chunk in range(first_chunk, min(last_chunk, len(chunk_offsets)) + 1):
            offset = chunk_offsets[chunk - 1]
            for _ in range(per_chunk):
                if sample >= len(sizes):
                    break
                offsets.append(offset)
                offset += sizes[sample]
                sample += 1
    return offsets


def _track_timescale(data: bytes, start: int, end: int) -> int:
    """The media timescale of a track (mdhd), defaulting to milliseconds."""
    mdia = _first(data, start, end, b"mdia")
    if not mdia:
        return 1000
    mdhd = _first(data, mdia[0], mdia[1], b"mdhd")
    if not mdhd:
        return 1000
    version = data[mdhd[0]]
    return _u32(data, mdhd[0] + (20 if version == 1 else 12)) or 1000


@dataclass
class _Track:
    """The few parts of a track this module cares about."""

    track_id: int
    start: int
    end: int
    stbl: tuple[int, int]
    timescale: int
    codec: bytes
    #: track id this track is a chapter track for (tref/chap), or None.
    chapter_for: int | None = None


def _tracks(data: bytes, moov_start: int, moov_end: int) -> list[_Track]:
    out: list[_Track] = []
    for start, end in _all(data, moov_start, moov_end, b"trak"):
        tkhd = _first(data, start, end, b"tkhd")
        track_id = 0
        if tkhd:
            version = data[tkhd[0]]
            track_id = _u32(data, tkhd[0] + (20 if version == 1 else 12))
        mdia = _first(data, start, end, b"mdia")
        minf = _first(data, mdia[0], mdia[1], b"minf") if mdia else None
        stbl = _first(data, minf[0], minf[1], b"stbl") if minf else None
        if not stbl:
            continue
        stsd = _first(data, stbl[0], stbl[1], b"stsd")
        codec = b""
        if stsd and stsd[1] - stsd[0] >= 16:
            codec = _fourcc(data, stsd[0] + 12)
        chapter_for = None
        tref = _first(data, start, end, b"tref")
        if tref:
            chap = _first(data, tref[0], tref[1], b"chap")
            if chap and chap[1] - chap[0] >= 4:
                chapter_for = _u32(data, chap[0])
        out.append(
            _Track(
                track_id=track_id,
                start=start,
                end=end,
                stbl=stbl,
                timescale=_track_timescale(data, start, end),
                codec=codec,
                chapter_for=chapter_for,
            )
        )
    return out


def _chapter_track_chapters(
    data: bytes,
    moov_start: int,
    moov_end: int,
    read_at: "Callable[[int, int], bytes] | None" = None,
) -> list[tuple[str, float, float]]:
    """Chapters from the text track referenced by an audio track's tref/chap.

    Chapter durations come from ``stts`` (one sample per chapter), titles from
    the sample bytes themselves, which is what an encoder like ffmpeg writes.
    Those samples live in ``mdat``, and ``stco``/``co64`` record their offsets
    from the start of the *file*, so they have to be read through ``read_at``
    rather than out of the moov box held in memory.
    """
    tracks = _tracks(data, moov_start, moov_end)
    wanted = {track.chapter_for for track in tracks if track.chapter_for}
    if not wanted:
        return []
    chapter_track = next((track for track in tracks if track.track_id in wanted), None)
    if chapter_track is None:
        return []

    stts = _first(data, chapter_track.stbl[0], chapter_track.stbl[1], b"stts")
    if not stts:
        return []
    durations: list[float] = []
    entries = _u32(data, stts[0] + 4)
    position = stts[0] + 8
    for _ in range(entries):
        if position + 8 > stts[1]:
            break
        count = _u32(data, position)
        delta = _u32(data, position + 4)
        durations.extend([delta / chapter_track.timescale] * count)
        position += 8
    if not durations:
        return []

    sizes = _sample_sizes(data, chapter_track.stbl)
    offsets = _sample_offsets(data, chapter_track.stbl, sizes) if sizes else []

    chapters: list[tuple[str, float, float]] = []
    cursor = 0.0
    for index, duration in enumerate(durations):
        title = ""
        if read_at and index < len(offsets) and index < len(sizes):
            sample = read_at(offsets[index], sizes[index])
            if len(sample) >= 2:
                length = _u16(sample, 0)
                body = sample[2 : 2 + length] if 0 < length <= len(sample) - 2 else sample
                title = body.decode("utf-8", "replace").strip()
        chapters.append((title or f"Chapter {index + 1}", cursor, cursor + duration))
        cursor += duration
    return chapters


def read_mp4(path: str | Path) -> AudioMeta:
    """Read an MP4 family file (m4b, m4a, mp4) without decoding it."""
    meta = AudioMeta()
    path = Path(path)
    size = os.path.getsize(path)
    with path.open("rb") as handle:
        def read_at(offset: int, length: int) -> bytes:
            handle.seek(offset)
            return handle.read(length)

        head = handle.read(4096)
        moov_start: int | None = None
        moov_size = 0
        position = 0
        while position + 8 <= size:
            handle.seek(position)
            header = handle.read(16)
            if len(header) < 8:
                break
            box_size = _u32(header, 0)
            header_size = 8
            if box_size == 1:
                box_size = _u64(header, 8)
                header_size = 16
            elif box_size == 0:
                box_size = size - position
            if box_size < header_size:
                break
            if _fourcc(header, 4) == b"moov":
                moov_start = position + header_size
                moov_size = box_size - header_size
                break
            position += box_size
        if moov_start is None or moov_size > MAX_MOOV_BYTES:
            return meta
        handle.seek(moov_start)
        data = handle.read(moov_size)
        moov_end = len(data)

        # -- structure: duration, tracks, chapters (needs the open handle) --
        mvhd = _first(data, 0, moov_end, b"mvhd")
        if mvhd:
            version = data[mvhd[0]]
            if version == 1:
                timescale = _u32(data, mvhd[0] + 20) or 1000
                duration = _u64(data, mvhd[0] + 24)
            else:
                timescale = _u32(data, mvhd[0] + 12) or 1000
                duration = _u32(data, mvhd[0] + 16)
            meta.duration = round(duration / timescale, 3)

        chapters = _chapter_track_chapters(data, 0, moov_end, read_at)
        if not chapters:
            chapters = _chpl_chapters(data, 0, moov_end)
        meta.chapters = chapters

        fields, cover, cover_mime, narrators = _metadata_block(data, 0, moov_end)

    meta.title = fields.get("title")
    meta.author = fields.get("author")
    meta.album = fields.get("album")
    meta.description = fields.get("description")
    # A freeform NARRATOR atom wins; the composer atom is the usual fallback.
    meta.narrator = (narrators[0] if narrators else None) or fields.get("narrator")
    if fields.get("genre"):
        meta.genres = [part.strip() for part in fields["genre"].replace(";", ",").split(",") if part.strip()]
    if fields.get("year"):
        digits = "".join(char for char in fields["year"][:4] if char.isdigit())
        meta.year = int(digits) if len(digits) == 4 else None
    meta.cover = cover
    meta.cover_mime = cover_mime
    if head[4:8] == b"ftyp":
        meta.codec = "MPEG-4 audio"
    return meta


# ------------------------------------------------------------------ ID3 ----


def _synchsafe(data: bytes, offset: int) -> int:
    return (data[offset] << 21) | (data[offset + 1] << 14) | (data[offset + 2] << 7) | data[offset + 3]


def _id3_frame_text(payload: bytes) -> str | None:
    if not payload:
        return None
    encoding = payload[0]
    body = payload[1:]
    codecs = {0: "latin-1", 1: "utf-16", 2: "utf-16-be", 3: "utf-8"}
    return _text(body) if False else _decode(body, codecs.get(encoding, "utf-8"))


def _decode(body: bytes, encoding: str) -> str | None:
    try:
        value = body.decode(encoding, "replace").replace("\x00", "").strip()
    except (LookupError, UnicodeDecodeError):
        return None
    return value or None


ID3_TEXT_FRAMES = {
    "TIT2": "title",
    "TT2": "title",
    "TPE1": "author",
    "TP1": "author",
    "TALB": "album",
    "TAL": "album",
    "TCON": "genre",
    "TCO": "genre",
    "TDRC": "year",
    "TYER": "year",
    "TYE": "year",
    "COMM": "description",
    "TCOM": "author",
    "TPE2": "narrator",
    "TP2": "narrator",
    "TIT3": "narrator",
}


def read_id3(path: str | Path) -> AudioMeta:
    """ID3v2 tags plus a frame based duration estimate for MPEG audio."""
    meta = AudioMeta()
    path = Path(path)
    size = os.path.getsize(path)
    with path.open("rb") as handle:
        def read_at(offset: int, length: int) -> bytes:
            handle.seek(offset)
            return handle.read(length)

        header = handle.read(10)
        tag_size = 0
        if header[:3] == b"ID3":
            tag_size = _synchsafe(header, 6) + 10
            flags = header[5]
            if flags & 0x10:
                tag_size += 10  # footer
            handle.seek(10)
            body = handle.read(min(tag_size, 16 * 1024 * 1024))
            _read_id3_frames(body, meta)
        # Duration: find the first frame header after the tag.
        handle.seek(tag_size)
        chunk = handle.read(8192)
    _estimate_mpeg_duration(chunk, size - tag_size, meta)
    return meta


def _read_id3_frames(body: bytes, meta: AudioMeta) -> None:
    position = 0
    while position + 10 <= len(body):
        frame_id = body[position : position + 4].decode("latin-1")
        if not frame_id.strip("\x00") or not frame_id[0].isalnum():
            break
        frame_size = _u32(body, position + 4)
        if frame_size <= 0 or position + 10 + frame_size > len(body):
            break
        payload = body[position + 10 : position + 10 + frame_size]
        position += 10 + frame_size
        if frame_id == "APIC" and meta.cover is None:
            mime, image = _id3_picture(payload)
            meta.cover = image
            meta.cover_mime = mime
            continue
        field_name = ID3_TEXT_FRAMES.get(frame_id)
        if not field_name:
            continue
        if frame_id == "COMM":
            # Comment frames: encoding, language (3), short description, text.
            if len(payload) < 5:
                continue
            encoding = {0: "latin-1", 1: "utf-16", 2: "utf-16-be", 3: "utf-8"}.get(payload[0], "utf-8")
            rest = payload[4:]
            separator = b"\x00\x00" if encoding.startswith("utf-16") else b"\x00"
            parts = rest.split(separator, 1)
            text = _decode(parts[-1], encoding)
        else:
            text = _id3_frame_text(payload)
        if not text:
            continue
        if field_name == "genre":
            meta.genres = [part.strip() for part in text.replace(";", ",").split(",") if part.strip()][:4]
        elif field_name == "year":
            digits = "".join(char for char in text[:4] if char.isdigit())
            if len(digits) == 4:
                meta.year = int(digits)
        elif getattr(meta, field_name, None) in (None, ""):
            setattr(meta, field_name, text)


def _sniff_image(data: bytes) -> str | None:
    """The real image type, from the magic bytes. Embedded mime strings lie."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"GIF8"):
        return "image/gif"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp"
    if data.startswith(b"BM"):
        return "image/bmp"
    return None


def _id3_picture(payload: bytes) -> tuple[str | None, bytes]:
    """APIC frame: encoding, mime, NUL, picture type, description, NUL, image."""
    if len(payload) < 4:
        return None, b""
    encoding = payload[0]
    rest = payload[1:]
    mime_end = rest.find(b"\x00")
    if mime_end < 0:
        return None, rest
    declared = rest[:mime_end].decode("latin-1", "replace").split("\x00")[0] or None
    after = rest[mime_end + 1 :]
    if after:
        after = after[1:]  # picture type
    terminator = b"\x00\x00" if encoding in (1, 2) else b"\x00"
    parts = after.split(terminator, 1)
    image = parts[1] if len(parts) == 2 and parts[1] else after
    return _sniff_image(image) or declared, image


MPEG_BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
MPEG_BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
# Keyed by the 2 bit version field: 0 = MPEG 2.5, 2 = MPEG 2, 3 = MPEG 1
# (1 is reserved). Getting this backwards silently reports MPEG 2.5 lengths
# for MPEG 1 files, which is how a 72 second file "becomes" 288 seconds.
MPEG_RATES = {0: [11025, 12000, 8000], 2: [22050, 24000, 16000], 3: [44100, 48000, 32000]}


def _estimate_mpeg_duration(chunk: bytes, audio_bytes: int, meta: AudioMeta) -> None:
    """Duration from the first frame header, using Xing/Info when present."""
    for index in range(0, max(0, len(chunk) - 4)):
        header = _u32(chunk, index)
        if header & 0xFFE00000 != 0xFFE00000:
            continue
        version = (header >> 19) & 0x3
        layer = (header >> 17) & 0x3
        bitrate_index = (header >> 12) & 0xF
        rate_index = (header >> 10) & 0x3
        if version == 1 or layer != 1 or bitrate_index in (0, 15) or rate_index == 3:
            continue
        table = MPEG_BITRATES_V1_L3 if version == 3 else MPEG_BITRATES_V2_L3
        bitrate = table[bitrate_index] * 1000
        sample_rate = MPEG_RATES.get(version, MPEG_RATES[0])[rate_index]
        meta.codec = "MPEG audio"
        meta.bitrate = bitrate

        # Xing/Info sits in the first frame, 4 bytes past the side information.
        side = 32 if version == 3 else 17
        xing = chunk.find(b"Xing", index, index + 200) if b"Xing" in chunk[index : index + 220] else -1
        if xing < 0:
            xing = chunk.find(b"Info", index, index + 200) if b"Info" in chunk[index : index + 220] else -1
        if xing > 0 and xing + 12 <= len(chunk):
            flags = _u32(chunk, xing + 4)
            cursor = xing + 8
            if flags & 0x1 and cursor + 4 <= len(chunk):
                frames = _u32(chunk, cursor)
                spf = 1152 if version == 3 else 576
                if frames:
                    meta.duration = round(frames * spf / sample_rate, 3)
                    return
            _ = side
        if bitrate:
            meta.duration = round(audio_bytes * 8 / bitrate, 3)
        return


# ------------------------------------------------------------------ WAV ----


def read_wav(path: str | Path) -> AudioMeta:
    meta = AudioMeta(codec="PCM")
    try:
        with wave.open(str(path), "rb") as handle:
            rate = handle.getframerate() or 1
            meta.duration = round(handle.getnframes() / float(rate), 3)
            meta.bitrate = rate * handle.getsampwidth() * handle.getnchannels() * 8
    except (wave.Error, OSError, EOFError):
        return meta
    return meta


# ------------------------------------------------------------- entrance ----


def read_metadata(path: str | Path) -> AudioMeta:
    """Best effort metadata for any supported file; never raises."""
    path = Path(path)
    suffix = path.suffix.lower()
    try:
        if suffix in MP4_SUFFIXES:
            return read_mp4(path)
        if suffix in MP3_SUFFIXES:
            return read_id3(path)
        if suffix in WAV_SUFFIXES:
            return read_wav(path)
    except (OSError, struct.error, ValueError, MemoryError):
        return AudioMeta()
    return AudioMeta()
