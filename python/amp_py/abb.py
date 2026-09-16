"""AudioBookBay client for Python.

The search page carries everything the queue needs to know (title, format,
bitrate, size, detail link); the detail page carries the torrent's info hash
and trackers, which is all that is required to build a magnet link. Parsing
mirrors packages/core/src/torrents.ts so all three front ends agree.
"""

from __future__ import annotations

import html
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Iterator

MIRRORS = (
    "https://audiobookbay.lu",
    "https://audiobookbay.is",
    "https://audiobookbay.se",
    "https://theaudiobookbay.se",
    "https://audiobookbay.li",
)

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/126.0 Safari/537.36 Amp/0.9 (+https://github.com/amp-app/amp)"
)

SIZE_UNITS = {"B": 1, "KB": 1024, "MB": 1024**2, "GB": 1024**3, "TB": 1024**4}

# Post cards only: "class=post" matches, "class=post-content" does not.
POST_SPLIT = re.compile(r'<div[^>]+class="[^"]*(?<![\w-])post(?![\w-])[^"]*"', re.IGNORECASE)
TAG_RE = re.compile(r"<[^>]+>")


def strip_tags(value: str) -> str:
    text = TAG_RE.sub(" ", value)
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def parse_size(text: str) -> int:
    """'881.82 MBs' -> 924655288."""
    match = re.search(r"([\d.,]+)\s*([KMGT]?)B", text, re.IGNORECASE)
    if not match:
        return 0
    amount = float(match.group(1).replace(",", ""))
    unit = f"{match.group(2).upper()}B"
    return int(round(amount * SIZE_UNITS.get(unit, 1)))


def build_magnet(info_hash: str, name: str, trackers: list[str] | None = None) -> str:
    quote = lambda value: urllib.parse.quote(value, safe="")  # noqa: E731 - tiny local helper
    parts = [f"xt=urn:btih:{info_hash.lower()}", f"dn={quote(name)}"]
    for tracker in trackers or []:
        parts.append(f"tr={quote(tracker)}")
    return "magnet:?" + "&".join(parts)


def parse_magnet(uri: str) -> dict[str, Any] | None:
    if not uri.startswith("magnet:"):
        return None
    query = urllib.parse.parse_qs(uri[7:].lstrip("?"))
    raw_hash = (query.get("xt") or [""])[0]
    info_hash = raw_hash.rsplit(":", 1)[-1]
    if not re.fullmatch(r"[0-9a-fA-F]{32,40}", info_hash):
        return None
    return {
        "infoHash": info_hash.lower(),
        "name": urllib.parse.unquote((query.get("dn") or [""])[0]),
        "trackers": [urllib.parse.unquote(item) for item in query.get("tr", [])],
    }


@dataclass
class AbbResult:
    title: str
    detail_url: str = ""
    size_text: str = ""
    size_bytes: int = 0
    format: str = ""
    bitrate: str = ""
    category: str = ""
    language: str = ""
    posted: str = ""
    cover_url: str = ""
    direct_url: str = ""
    info_hash: str = ""
    magnet: str = ""
    trackers: list[str] = field(default_factory=list)
    parsed_author: str = ""
    score: float = 0.0

    @property
    def display_size(self) -> str:
        if self.size_text:
            return self.size_text
        from .library import format_bytes

        return format_bytes(self.size_bytes) if self.size_bytes else "unknown"


# "72.25</span> MBs": the unit sits outside the span that holds the number, so
# the closing tag has to be part of the match before it is stripped again.
SIZE_VALUE = r"(\d[\d.,]*(?:</[^>]*>)?\s*[KMGT]?B(?:ytes?|s)?)"


def _after_label(block: str, label: str, pattern: str) -> str:
    """Value after 'Label:' allowing a few tags to sit in between."""
    match = re.search(
        rf"{label}\s*:(?:\s|</?[\w!-][^>]*>){{0,6}}{pattern}",
        block,
        re.IGNORECASE,
    )
    if not match:
        return ""
    return strip_tags(match.group(1)).rstrip(" /|,;:-").strip()


def absolute_url(url: str, base: str = MIRRORS[0]) -> str:
    """AudioBookBay links are site relative; the API hands out full URLs.

    Cards carry `href="/abss/<slug>/"`, and both the interface (Open page) and
    the magnet resolution need something a browser or urllib can open.
    """
    if not url:
        return ""
    if url.startswith(("http://", "https://", "magnet:")):
        return url
    return f"{base.rstrip('/')}/{url.lstrip('/')}"


def parse_search(page: str, base: str = MIRRORS[0]) -> list[AbbResult]:
    """Parse a `/?s=<query>` page into results, newest metadata included."""
    results: list[AbbResult] = []
    for block in POST_SPLIT.split(page)[1:]:
        heading = re.search(r"<h2[^>]*>(.*?)</h2>", block, re.IGNORECASE | re.DOTALL)
        if not heading:
            continue
        title = strip_tags(heading.group(1))
        if not title:
            continue

        link = re.search(r'href="([^"]*?/abss/[^"]*)"', block, re.IGNORECASE)
        image = re.search(r'<img[^>]+src="([^"]+)"', block, re.IGNORECASE)
        direct = re.search(r'href="([^"]*(?:dload-now|dedl|dodl|dl-)[^"]*)"', block, re.IGNORECASE)

        result = AbbResult(
            title=title,
            detail_url=(
                absolute_url(link.group(1), base)
                if link
                else f"{base}/?s={title.replace(' ', '+')}"
            ),
            size_text=_after_label(block, "File Size", SIZE_VALUE),
            format=_after_label(block, "Format", r"([^<]{1,40})"),
            bitrate=_after_label(block, "Bitrate", r"([^<]{1,40})"),
            category=_after_label(block, "Category", r"([^<]{1,60})"),
            language=_after_label(block, "Language", r"([^<]{1,40})"),
            posted=_after_label(block, "Posted", r"([^<]{1,40})"),
            cover_url=image.group(1) if image else "",
            direct_url=direct.group(1) if direct else "",
        )
        if result.size_text:
            result.size_bytes = parse_size(result.size_text)
        results.append(result)
    return results


def parse_detail(page: str, base: str = MIRRORS[0], detail_url: str = "") -> AbbResult:
    """Parse an /abss/<slug>/ page: torrent table, files, magnet."""
    title_match = re.search(r"<h1[^>]*>(.*?)</h1>", page, re.IGNORECASE | re.DOTALL)
    if not title_match:
        title_match = re.search(r"<title>(.*?)</title>", page, re.IGNORECASE | re.DOTALL)
    title = strip_tags(title_match.group(1)) if title_match else "Unknown"
    title = re.sub(r"\s*Audiobook.*$", "", title).strip()

    author_match = re.search(r"Written by\s*<a[^>]*>(.*?)</a>", page, re.IGNORECASE | re.DOTALL)
    author = strip_tags(author_match.group(1)) if author_match else ""
    if not author and " - " in title:
        author = title.split(" - ", 1)[1]

    info_hash = ""
    hash_match = re.search(
        r"Info Hash:\s*(?:</strong>)?[\s\S]{0,60}?([0-9a-fA-F]{40})", page, re.IGNORECASE
    )
    if hash_match:
        info_hash = hash_match.group(1).lower()

    trackers = []
    for match in re.finditer(r"(?:udp|https?)://[^\s\"'<>]+announce", page, re.IGNORECASE):
        if match.group(0) not in trackers:
            trackers.append(match.group(0))

    magnet_match = re.search(r'href="(magnet:[^"]+)"', page, re.IGNORECASE)
    magnet = magnet_match.group(1) if magnet_match else ""
    if not magnet and info_hash:
        magnet = build_magnet(info_hash, title, trackers)

    torrent_match = re.search(
        r'href="([^"]*)"[^>]*>\s*(?:Torrent Free Downloads|Torrent Download)', page, re.IGNORECASE
    )
    direct_match = re.search(
        r'href="([^"]*)"[^>]*>\s*(?:Start Direct Download|Direct Download)', page, re.IGNORECASE
    )

    cover_match = re.search(r'<img[^>]+src="(https?://[^"]+\.(?:jpg|jpeg|png|webp))"', page, re.IGNORECASE)

    return AbbResult(
        title=title,
        detail_url=detail_url or base,
        info_hash=info_hash,
        magnet=magnet,
        trackers=trackers,
        size_text=_after_label(page, "Combined File Size", r"(\d[\d.,]*\s*[KMGT]?Bs?)"),
        format=_after_label(page, "Format", r"([^<]{1,40})"),
        bitrate=_after_label(page, "Bitrate", r"([^<]{1,40})"),
        cover_url=cover_match.group(1) if cover_match else "",
        direct_url=direct_match.group(1) if direct_match else "",
        parsed_author=author,
    )


def detail_files(page: str) -> list[tuple[str, int]]:
    """File list from a detail page: (name, size)."""
    pattern = re.compile(
        r"([^\n<>|]+\.(?:m4b|mp3|mp4|m4a|flac|ogg|opus|aac|zip|rar|jpg|jpeg|png|cue|nfo|txt))\s+([\d.,]+\s*[KMGT]?Bs?)",
        re.IGNORECASE,
    )
    files: list[tuple[str, int]] = []
    for match in pattern.finditer(page):
        name = strip_tags(match.group(1)).strip()
        if name and len(name) < 240:
            files.append((name, parse_size(match.group(2))))
    return files


def _score(result: AbbResult, query: str) -> float:
    title = result.title.lower()
    needle = query.lower().strip()
    words = [word for word in re.split(r"\W+", needle) if len(word) > 2]
    score = 0.0
    if needle and needle in title:
        score += 60
    score += 12 * sum(1 for word in words if word in title)
    if re.search(r"\bm4b\b", f"{result.format} {title}", re.IGNORECASE):
        score += 14
    if re.search(r"collection|complete|bundle|various|\d+\s*audiobooks", title):
        score -= 40
    if result.size_bytes > 4 * 1024**3:
        score -= 18
    if 0 < result.size_bytes < 1.6 * 1024**3:
        score += 6
    return score


def rank(results: list[AbbResult], query: str) -> list[AbbResult]:
    """Best match first, recording each score so callers can show or reuse it."""
    for item in results:
        item.score = _score(item, query) if query else 0.0
    return sorted(results, key=lambda item: item.score, reverse=True)


class AbbClient:
    """Search and fetch details, rotating mirrors when one is blocked."""

    def __init__(self, mirrors: list[str] | None = None, timeout: float = 15.0) -> None:
        self.mirrors = mirrors or list(MIRRORS)
        self.timeout = timeout
        self.active_mirror: str | None = None
        self.last_error: str | None = None

    # ------------------------------------------------------------- network --
    def absolute(self, url: str, mirror: str | None = None) -> str:
        """Resolve a site relative link against the mirror in use."""
        return absolute_url(url, mirror or self.active_mirror or self.mirrors[0])

    def fetch(self, url: str, timeout: float | None = None) -> str:
        url = self.absolute(url)
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "en-US,en;q=0.9",
            },
        )
        with urllib.request.urlopen(request, timeout=timeout or self.timeout) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            return response.read().decode(charset, errors="replace")

    def _mirror_order(self) -> Iterator[str]:
        if self.active_mirror:
            yield self.active_mirror
        for mirror in self.mirrors:
            if mirror != self.active_mirror:
                yield mirror

    def search(self, query: str, limit: int | None = None) -> list[AbbResult]:
        errors: list[str] = []
        for mirror in self._mirror_order():
            try:
                page = self.fetch(f"{mirror}/?s={urllib.parse.quote(query)}")
            except (urllib.error.URLError, TimeoutError, OSError) as error:  # pragma: no cover - network
                errors.append(f"{mirror}: {error}")
                continue
            self.active_mirror = mirror
            results = rank(parse_search(page, mirror), query)
            return results[:limit] if limit else results
        self.last_error = "; ".join(errors) or "no mirrors configured"
        raise RuntimeError(f"AudioBookBay is unreachable ({self.last_error})")

    def latest(self, limit: int | None = None) -> list[AbbResult]:
        """The newest posts: the front page of a mirror, newest first.

        AudioBookBay lists new posts on its front page with exactly the same
        card markup as a search page, so the same parser reads it.
        """
        errors: list[str] = []
        for mirror in self._mirror_order():
            try:
                page = self.fetch(f"{mirror}/")
            except (urllib.error.URLError, TimeoutError, OSError) as error:  # pragma: no cover - network
                errors.append(f"{mirror}: {error}")
                continue
            self.active_mirror = mirror
            results = [
                item
                for item in parse_search(page, mirror)
                if "/abss/" in item.detail_url and (item.size_text or item.format)
            ]
            if results:
                return results[:limit] if limit else results
            errors.append(f"{mirror}: no posts parsed")
        self.last_error = "; ".join(errors) or "no mirrors configured"
        raise RuntimeError(f"AudioBookBay is unreachable ({self.last_error})")

    def detail(self, url: str) -> AbbResult:
        absolute = self.absolute(url)
        return parse_detail(self.fetch(absolute, timeout=self.timeout * 1.5), detail_url=absolute)

    def resolve(self, url: str) -> AbbResult:
        """Detail lookup that always ends with a magnet when the page has a hash."""
        result = self.detail(url)
        if result.magnet or not result.info_hash:
            return result
        result.magnet = build_magnet(result.info_hash, result.title, result.trackers)
        return result

__all__ = [
    "AbbClient",
    "AbbResult",
    "MIRRORS",
    "build_magnet",
    "parse_detail",
    "parse_magnet",
    "parse_search",
    "parse_size",
    "rank",
    "detail_files",
    "strip_tags",
]
