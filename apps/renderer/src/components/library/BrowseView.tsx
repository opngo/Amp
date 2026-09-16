/**
 * Browse: the library by author, narrator, series and genre.
 *
 * The sidebar rows used to only expand in place, which left a reader with a
 * name and nowhere to go. This is the page they belong to: pick a facet, see
 * everything filed under it, and open the library filtered to it.
 */

import { useMemo, useState } from "react";
import { Button, Text } from "reshaped";
import { LibraryBig, Mic, Tag, Users, Wand2, X } from "lucide-react";
import { COLOR_TAGS, facetCounts, formatDuration, type Book } from "@amp/core";
import { useLibraryStore } from "../../store/useLibraryStore";
import { useUiStore } from "../../store/useUiStore";
import { EmptyState } from "../common/EmptyState";
import type { BrowseFacet } from "../../store/useUiStore";

type FacetKey = BrowseFacet;

interface FacetTab {
  key: FacetKey;
  label: string;
  icon: typeof Users;
  /** Empty when the library has nothing filed under this facet at all. */
  empty: string;
}

const TABS: FacetTab[] = [
  {
    key: "authors",
    label: "Authors",
    icon: Users,
    empty: "No authors yet. Import a book with an author tag, or set one in the metadata editor.",
  },
  {
    key: "narrators",
    label: "Narrators",
    icon: Mic,
    empty: "No narrators yet. Amp reads the narrator from the file tags when the book has one.",
  },
  {
    key: "series",
    label: "Series",
    icon: LibraryBig,
    empty: "No series yet. Set a series name in the metadata editor to group a run of books.",
  },
  {
    key: "genres",
    label: "Genres",
    icon: Wand2,
    empty: "No genres yet. Genres come from the file tags, and can be edited by hand.",
  },
  {
    key: "tags",
    label: "Tags",
    icon: Tag,
    empty: "No tags yet. Tags are free-form: add them in the metadata editor.",
  },
  {
    key: "colors",
    label: "Colour tags",
    icon: Tag,
    empty: "No colour tags yet. Colour a book from its right-click menu to sort the shelf at a glance.",
  },
];

export function BrowseView() {
  const allBooks = useLibraryStore((s) => s.state.books);
  const folders = useLibraryStore((s) => s.state.folders);
  const unlocked = useUiStore((s) => s.unlocked);
  // Browse counts and lists the same books the library shows: a locked folder
  // does not leak its titles through the Authors tab.
  const books = useMemo(() => {
    const hidden = new Set(
      folders.filter((folder) => folder.locked && !unlocked.includes(folder.id)).map((folder) => folder.id),
    );
    if (hidden.size === 0) return allBooks;
    return allBooks.filter((book) => !book.folderId || !hidden.has(book.folderId));
  }, [allBooks, folders, unlocked]);
  const setFilter = useLibraryStore((s) => s.setFilter);
  const filter = useLibraryStore((s) => s.filter);
  const setSort = useLibraryStore((s) => s.setSort);
  const select = useUiStore((s) => s.select);
  const setRoute = useUiStore((s) => s.setRoute);
  // The sidebar opens this page on a facet, so the chosen tab lives in the UI
  // store rather than inside the view.
  const active = useUiStore((s) => s.browseFacet);
  const setActive = useUiStore((s) => s.setBrowseFacet);
  const [query, setQuery] = useState("");

  const facets = useMemo(() => facetCounts(books), [books]);
  const tab = TABS.find((item) => item.key === active) ?? TABS[0];
  const entries = facets[active];

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const label = (value: string) =>
      active === "colors" ? (COLOR_TAGS.find((tag) => tag.value === value)?.label ?? value) : value;
    const filtered = needle
      ? entries.filter(([value]) => label(value).toLowerCase().includes(needle))
      : entries;
    return filtered.map(([value, count]) => {
      const matching = books.filter((book) => bookBelongsTo(book, active, value));
      const seconds = matching.reduce((sum, book) => sum + book.duration, 0);
      return { value, label: label(value), count, seconds };
    });
  }, [entries, query, active, books]);

  const open = (value: string) => {
    setSort("title", "asc");
    select(null);
    if (active === "colors") setFilter({ color: value });
    else if (active === "tags") setFilter({ text: value });
    else if (active === "genres") setFilter({ genre: value });
    else if (active === "series") setFilter({ series: value });
    else if (active === "narrators") setFilter({ narrator: value });
    else setFilter({ author: value });
    setRoute("library");
  };

  const activeFilter =
    filter.author ??
    filter.narrator ??
    filter.series ??
    filter.genre ??
    filter.color ??
    (filter.text || null);

  if (books.length === 0) {
    return (
      <EmptyState
        icon={LibraryBig}
        title="Nothing to browse yet"
        description="Authors, narrators, series and genres are built from your own library. Add a book and they fill in by themselves."
      />
    );
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="amp-content-header">
        <div style={{ display: "grid", gap: 3 }}>
          <h1 className="amp-page-title">Browse</h1>
          <span className="amp-page-subtitle">
            {`Everything in the library by ${tab.label.toLowerCase()} - ${books.length} book${books.length === 1 ? "" : "s"} in total`}
          </span>
        </div>
        {activeFilter && (
          <div className="amp-toolbar amp-toolbar-end">
            <span className="amp-chip" style={{ cursor: "default" }}>
              Filtering: {activeFilter}
            </span>
            <Button
              variant="ghost"
              size="small"
              icon={X}
              onClick={() =>
                setFilter({ author: null, narrator: null, series: null, genre: null, color: null, text: "" })
              }
            >
              Clear
            </Button>
          </div>
        )}
      </div>

      <div className="amp-toolbar">
        {TABS.map((item) => {
          const Icon = item.icon;
          const count = facets[item.key].length;
          return (
            <button
              key={item.key}
              type="button"
              className="amp-chip"
              data-active={item.key === active}
              onClick={() => {
                setActive(item.key);
                setQuery("");
              }}
            >
              <Icon size={14} />
              {item.label}
              <span style={{ color: "var(--amp-text-3)" }}>{count}</span>
            </button>
          );
        })}
      </div>

      {entries.length === 0 ? (
        <EmptyState icon={tab.icon} title={`No ${tab.label.toLowerCase()}`} description={tab.empty} />
      ) : (
        <>
          <input
            className="amp-inline-input"
            style={{ maxWidth: 320 }}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Filter ${tab.label.toLowerCase()}`}
            aria-label={`Filter ${tab.label}`}
          />
          <div className="amp-browse-grid">
            {shown.map((entry) => (
              <button
                key={entry.value}
                type="button"
                className="amp-browse-card"
                onClick={() => open(entry.value)}
              >
                <span className="amp-browse-name">{entry.label}</span>
                <span className="amp-browse-meta">
                  <Text variant="caption-1" color="neutral-faded">
                    {`${entry.count} book${entry.count === 1 ? "" : "s"} - ${formatDuration(entry.seconds)}`}
                  </Text>
                </span>
              </button>
            ))}
          </div>
          {shown.length === 0 && (
            <Text variant="caption-1" color="neutral-faded">
              {`Nothing under ${tab.label.toLowerCase()} matches "${query.trim()}".`}
            </Text>
          )}
        </>
      )}
    </div>
  );
}

/** Whether a book is filed under one facet value. */
function bookBelongsTo(book: Book, key: FacetKey, value: string): boolean {
  switch (key) {
    case "authors":
      return book.author === value;
    case "narrators":
      return book.narrator === value;
    case "series":
      return book.series === value;
    case "genres":
      return book.genres.includes(value);
    case "tags":
      return book.tags.includes(value);
    case "colors":
      return book.color === value;
    default:
      return false;
  }
}
