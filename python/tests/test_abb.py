"""AudioBookBay parsing tests, using markup copied from the live site."""

from __future__ import annotations

from amp_py.abb import (
    AbbClient,
    build_magnet,
    detail_files,
    parse_detail,
    parse_magnet,
    parse_search,
    parse_size,
    rank,
    strip_tags,
)

SEARCH_PAGE = """
<html><body>
<div class="post">
  <h2 class="post-title"><a href="https://audiobookbay.lu/abss/proaject-hail-mary-andy-weir/">Project Hail Mary - Andy Weir</a></h2>
  <div class="post-content">
    <p><strong>Category:</strong> Sci-Fi<br /><strong>Language:</strong> English <strong>Keywords:</strong> Andy Weir Project Hail Mary</p>
    <p><img src="https://m.media-amazon.com/images/I/51b6fvQr1-L.jpg" /></p>
    <p><strong>Posted:</strong> 14 Nov 2021<br /><strong>Format:</strong> M4B / <strong>Bitrate:</strong> 128 Kbps</p>
    <p>File Size: 881.82 MBs</p>
    <p><a href="https://audiobookbay.lu/dload-now?ll=84Andy_Weir___Project_Hail_Mary">Direct Download</a></p>
  </div>
</div>
<div class="post">
  <h2 class="post-title"><a href="https://audiobookbay.lu/abss/entirve-audiobooks-collection-various/">Entire Audiobooks Collection - Various</a></h2>
  <div class="post-content">
    <p><strong>Category:</strong> Other</p>
    <p><strong>Format:</strong> M4B / <strong>Bitrate:</strong> Mixed</p>
    <p>File Size: 788.39 GBs</p>
  </div>
</div>
<nav><h2 class="post-title"><a href="https://audiobookbay.lu/audio-books/type/sci-fi/">Sci-Fi</a></h2></nav>
</body></html>
"""

# The live site puts the number in a coloured span and the unit outside it.
SPAN_SIZE_PAGE = """
<html><body>
<div class="post">
  <h2 class="post-title"><a href="https://audiobookbay.lu/abss/a-lovers-haunting-carrie-bates/">A Lover's Haunting - Carrie Bates</a></h2>
  <div class="post-info">Category: Adults Parasite Romance <br />Language: English</div>
  <div class="post-content">
    <p>Posted: 14 Sep 2026<br />Format: <span style='color:#a00;'>M4B</span> / Bitrate: <span style='color:#a00;'>96 Kbps</span></p>
    <p>File Size: <span style='color:#00f;'>72.25</span> MBs</p>
  </div>
</div>
</body></html>
"""

DETAIL_PAGE = """
<html><head><title>Project Hail Mary - Andy Weir Audiobook M4B </title></head><body>
<h1 class="post-title">Project Hail Mary - Andy Weir</h1>
<p>Written by <a href="https://audiobookbay.lu/?s=andy+weir">Andy Weir</a></p>
<p>Format: M4B</p><p>Bitrate: 128 Kbps</p><p>Unabridged</p><p>Narrator: Ray Porter</p>
<table>
<tr><td>Tracker:</td><td>udp://tracker.opentrackr.org:1337/announce</td></tr>
<tr><td>Tracker:</td><td>udp://open.stealth.si:80/announce</td></tr>
<tr><td>Andy Weir - Project Hail Mary.jpg 58.56 KBs</td></tr>
<tr><td>Andy Weir - Project Hail Mary.m4b 881.76 MBs</td></tr>
<tr><td>Combined File Size:</td><td>881.82 MBs</td></tr>
<tr><td>Info Hash:</td><td>ad5fae5ffda056f9f45131045d140326bbafc4dc</td></tr>
<tr><td>Torrent Download</td><td><a href="https://audiobookbay.lu/downld0?downfs=84">Torrent Free Downloads</a> |
  <a href="magnet:?xt=urn:btih:ad5fae5ffda056f9f45131045d140326bbafc4dc"><img src="/images/magnet.gif" /></a></td></tr>
</table>
</body></html>
"""


def test_parse_size_units():
    assert parse_size("881.82 MBs") == round(881.82 * 1024**2)
    assert parse_size("1.03 GBs") == round(1.03 * 1024**3)
    assert parse_size("1.74 KBs") == round(1.74 * 1024)
    assert parse_size("nonsense") == 0


def test_strip_tags_decodes_entities():
    assert strip_tags("This Land &#8217;Is &amp; <strong>Ours</strong>") == "This Land \u2019Is & Ours"


def test_parse_search_skips_navigation_and_reads_card_fields():
    results = parse_search(SEARCH_PAGE)
    assert len(results) == 2
    first = results[0]
    assert first.title == "Project Hail Mary - Andy Weir"
    assert first.detail_url.endswith("/abss/proaject-hail-mary-andy-weir/")
    assert first.format == "M4B"
    assert first.bitrate == "128 Kbps"
    assert first.category == "Sci-Fi"
    assert first.posted == "14 Nov 2021"
    assert first.size_bytes == round(881.82 * 1024**2)
    assert first.cover_url.endswith("51b6fvQr1-L.jpg")
    assert "dload-now" in first.direct_url


def test_rank_prefers_the_single_book_over_a_collection():
    results = rank(parse_search(SEARCH_PAGE), "project hail mary")
    assert results[0].title.startswith("Project Hail Mary")
    assert "Collection" in results[-1].title


def test_parse_detail_builds_a_magnet_and_file_list():
    detail = parse_detail(DETAIL_PAGE, detail_url="https://audiobookbay.lu/abss/proaject-hail-mary-andy-weir/")
    assert detail.title == "Project Hail Mary - Andy Weir"
    assert detail.parsed_author == "Andy Weir"
    assert detail.info_hash == "ad5fae5ffda056f9f45131045d140326bbafc4dc"
    assert len(detail.trackers) == 2
    assert "urn:btih:ad5fae5ffda056f9f45131045d140326bbafc4dc" in detail.magnet
    assert detail.size_text == "881.82 MBs"
    assert detail.format == "M4B"
    names = [name for name, _size in detail_files(DETAIL_PAGE)]
    assert "Andy Weir - Project Hail Mary.m4b" in names


def test_magnet_round_trip():
    magnet = build_magnet(
        "AD5FAE5FFDA056F9F45131045D140326BBAFC4DC",
        "Project Hail Mary",
        ["udp://tracker.opentrackr.org:1337/announce"],
    )
    parsed = parse_magnet(magnet)
    assert parsed is not None
    assert parsed["infoHash"] == "ad5fae5ffda056f9f45131045d140326bbafc4dc"
    assert parsed["name"] == "Project Hail Mary"
    assert parsed["trackers"] == ["udp://tracker.opentrackr.org:1337/announce"]
    assert parse_magnet("https://example.com") is None

def test_file_size_survives_markup_between_number_and_unit():
    """The colour span holds digits, so the value has to be read after the tags
    are gone - the old pattern could not reach past `color:#00f`."""
    rows = parse_search(SPAN_SIZE_PAGE)
    assert len(rows) == 1
    assert rows[0].size_text == "72.25 MBs"
    assert rows[0].size_bytes == round(72.25 * 1024**2)
    assert rows[0].format == "M4B"
    assert rows[0].bitrate == "96 Kbps"


def test_rank_records_the_score_it_sorted_by():
    rows = parse_search(SEARCH_PAGE)
    ranked = rank(rows, "project hail mary")
    assert ranked[0].title.startswith("Project Hail Mary")
    assert ranked[0].score > ranked[-1].score
    assert rank(rows, "")[0].score == 0.0


def test_latest_returns_the_post_cards_from_a_front_page():
    """The new-releases view reuses the search parser, minus the navigation."""
    class Stub(AbbClient):
        def fetch(self, url, timeout=None):  # noqa: ARG002 - stub
            return SEARCH_PAGE

    client = Stub(mirrors=["https://example.invalid"])
    rows = client.latest()
    assert [row.title for row in rows] == [
        "Project Hail Mary - Andy Weir",
        "Entire Audiobooks Collection - Various",
    ]
