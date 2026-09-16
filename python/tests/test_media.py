"""Tests for the dependency free metadata reader.

The interesting cases are the ones that a naive reader gets wrong: the MPEG
version to sample rate table (a reversed table reports a 72 second file as 288
seconds), chapter titles that live in ``mdat`` rather than in ``moov``, and the
two layouts of iTunes metadata atoms.
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from amp_py import media  # noqa: E402

AUDIOBOOKS = Path("/home/user/Audiobooks")
TEMPEST = AUDIOBOOKS / "Tempest" / "Tempest.m4b"
ALCHEMIST = AUDIOBOOKS / "The Alchemist" / "01-alchemist.mp3"


# ------------------------------------------------------------------ tables --


def test_mpeg_version_to_sample_rate_table_is_not_reversed():
    """0b11 is MPEG 1 (not 2.5); mixing it up silently scales the duration by 4."""
    assert media.MPEG_RATES[3][0] == 44100
    assert media.MPEG_RATES[2][0] == 22050
    assert media.MPEG_RATES[0][0] == 11025


def test_bitrate_tables_are_layer_three():
    assert media.MPEG_BITRATES_V1_L3[7] == 96
    assert media.MPEG_BITRATES_V2_L3[8] == 64


def test_mp3_duration_matches_a_real_file():
    found = media.read_metadata(ALCHEMIST)
    assert found.duration == pytest.approx(72.045, abs=0.05)
    assert found.bitrate == 96000


def test_mp3_tags_and_cover_are_read():
    found = media.read_metadata(ALCHEMIST)
    assert found.title == "The Alchemist"
    assert found.author == "Paulo Coelho"
    assert found.genres == ["Fiction"]
    # The file declares image/png in its APIC frame; the bytes agree, and the
    # reader trusts the magic over the declaration.
    assert found.cover and found.cover.startswith(b"\x89PNG")
    assert found.cover_mime == "image/png"


# --------------------------------------------------------------------- mp4 --


@pytest.mark.skipif(not TEMPEST.exists(), reason="sample m4b not present")
def test_m4b_duration_and_tags():
    found = media.read_metadata(TEMPEST)
    assert found.duration == pytest.approx(72.0, abs=0.05)
    assert found.title == "Tempest: The Lyrian Sea, Book 1"
    # artist atom is the author, composer atom the narrator
    assert found.author == "Victoria Aveyard"
    assert found.narrator == "Amanda Dolan"
    assert found.genres == ["Fantasy"]
    assert found.year == 2026
    assert found.cover and found.cover.startswith(b"\x89PNG")
    assert found.cover_mime == "image/png"


@pytest.mark.skipif(not TEMPEST.exists(), reason="sample m4b not present")
def test_m4b_chapters_match_the_file():
    """Three 24 second chapters, titles read out of mdat via stco offsets."""
    found = media.read_metadata(TEMPEST)
    assert [(title, round(start), round(end)) for title, start, end in found.chapters] == [
        ("Chapter 01", 0, 24),
        ("Chapter 02", 24, 48),
        ("Chapter 03", 48, 72),
    ]


def test_missing_file_returns_empty_metadata():
    found = media.read_metadata(AUDIOBOOKS / "nope" / "nothing.m4b")
    assert found.duration == 0.0
    assert found.chapters == []


def test_unknown_container_is_not_guessed():
    found = media.read_metadata(Path(__file__).resolve())
    assert found.duration == 0.0 and found.title is None


def test_is_mp4_family():
    assert media.is_mp4_family("book.m4b")
    assert media.is_mp4_family("Book.M4A")
    assert not media.is_mp4_family("track.wav")


# ---------------------------------------------------------------- wav path --


def test_wav_duration_from_the_header():
    wav = AUDIOBOOKS / "Blindsight" / "Chapter 01.wav"
    if not wav.exists():
        pytest.skip("sample wav not present")
    found = media.read_metadata(wav)
    assert found.duration == pytest.approx(12.0, abs=0.01)
    assert found.codec == "PCM"


# ------------------------------------------------------------ box plumbing --


def test_boxes_within_walks_siblings():
    payload = struct.pack(">I", 16) + b"mvhd" + b"\x00" * 8 + struct.pack(">I", 16) + b"free" + b"\x00" * 8
    boxes = media._boxes(payload, 0, len(payload))
    assert [kind for kind, _start, _end in boxes] == [b"mvhd", b"free"]


def test_boxes_within_stops_on_a_broken_size():
    payload = struct.pack(">I", 4) + b"junk" + struct.pack(">I", 16) + b"mvhd" + b"\x00" * 8
    assert media._boxes(payload, 0, len(payload)) == []


def test_64_bit_box_sizes_are_understood():
    payload = struct.pack(">I", 1) + b"mdat" + struct.pack(">Q", 24) + b"\x00" * 8
    boxes = media._boxes(payload, 0, len(payload))
    assert boxes and boxes[0][0] == b"mdat"


def test_merged_with_fills_only_empty_fields():
    first = media.AudioMeta(duration=10.0, title="A")
    second = media.AudioMeta(duration=99.0, title="B", author="Someone")
    merged = first.merged_with(second)
    assert (merged.duration, merged.title, merged.author) == (10.0, "A", "Someone")
