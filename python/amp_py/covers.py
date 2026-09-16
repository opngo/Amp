"""Cover and banner search for the HTTP server.

The desktop app searches Open Library and Google Books straight from the main
process. When the interface runs in a browser - against the tailscale server,
for instance - the host has to do that work instead, because the page cannot
reach those services on its own. Both providers are public and need no key.
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from typing import Any

USER_AGENT = "Amp/1.0 (audiobook player)"
TIMEOUT = 8.0


def _get_json(url: str) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:  # noqa: S310 - fixed https hosts
        return json.loads(response.read().decode("utf-8", "replace"))


def open_library(query: str, limit: int) -> list[dict[str, str]]:
    """Covers from Open Library, which are the ones that survive a book's print run."""
    url = (
        "https://openlibrary.org/search.json?"
        + urllib.parse.urlencode({"q": query, "limit": limit, "fields": "title,author_name,cover_i"})
    )
    payload = _get_json(url)
    found: list[dict[str, str]] = []
    for doc in payload.get("docs", []):
        cover_id = doc.get("cover_i")
        if not cover_id:
            continue
        authors = doc.get("author_name") or []
        found.append(
            {
                "url": f"https://covers.openlibrary.org/b/id/{cover_id}-L.jpg",
                "thumbnail": f"https://covers.openlibrary.org/b/id/{cover_id}-M.jpg",
                "title": str(doc.get("title", "")),
                "author": str(authors[0]) if authors else "",
                "provider": "openlibrary",
            }
        )
    return found[:limit]


def google_books(query: str, limit: int) -> list[dict[str, str]]:
    """Covers from Google Books, which is better for recent audiobooks."""
    url = "https://www.googleapis.com/books/v1/volumes?" + urllib.parse.urlencode({"q": query, "maxResults": limit})
    payload = _get_json(url)
    found: list[dict[str, str]] = []
    for item in payload.get("items", []):
        info = item.get("volumeInfo", {})
        links = info.get("imageLinks") or {}
        image = links.get("extraLarge") or links.get("large") or links.get("medium") or links.get("thumbnail")
        if not image:
            continue
        authors = info.get("authors") or []
        found.append(
            {
                "url": image.replace("http://", "https://"),
                "thumbnail": (links.get("smallThumbnail") or image).replace("http://", "https://"),
                "title": str(info.get("title", "")),
                "author": str(authors[0]) if authors else "",
                "provider": "googlebooks",
            }
        )
    return found[:limit]


def search_covers(query: str, provider: str = "all", limit: int = 12) -> list[dict[str, str]]:
    """Query the providers and hand back one de-duplicated list, best match first.

    A provider that is unreachable, rate limited or simply has nothing is not an
    error: the caller gets whatever the other one returned.
    """
    cleaned = query.strip()
    if not cleaned:
        return []
    sources = []
    if provider in ("all", "openlibrary"):
        sources.append(open_library)
    if provider in ("all", "googlebooks"):
        sources.append(google_books)
    if not sources:
        sources = [open_library, google_books]

    results: list[dict[str, str]] = []
    for source in sources:
        try:
            results.extend(source(cleaned, limit))
        except Exception:  # noqa: BLE001 - a dead provider must not fail the request
            continue

    lowered = cleaned.lower()
    seen: set[str] = set()
    unique: list[dict[str, str]] = []
    for item in results:
        if item["url"] in seen:
            continue
        seen.add(item["url"])
        unique.append(item)

    def score(item: dict[str, str]) -> tuple[int, int]:
        title = item.get("title", "").lower()
        exact = 0 if title.startswith(lowered) else 1
        return (exact, len(title))

    unique.sort(key=score)
    return unique[:limit]
