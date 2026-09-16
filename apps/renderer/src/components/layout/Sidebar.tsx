/**
 * Navigation, and nothing else.
 *
 * One column holds every place in Amp: search at the top, then the library
 * views, the parts of the library that actually exist (authors, narrators,
 * series, genres, colour tags), folders, playlists and a short tools group at
 * the bottom. Rows appear only when they lead somewhere real - an empty library
 * shows no headings at all - and each destination is listed exactly once.
 */

import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  Clock,
  Compass,
  Download,
  FileText,
  Home,
  FolderTree,
  ListOrdered,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  X,
} from "lucide-react";
import { flattenTree, folderTree, formatBytes, isFinished, type Book } from "@amp/core";
import { useLibraryStore } from "../../store/useLibraryStore";
import { useDownloadsStore } from "../../store/useDownloadsStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { useUiStore, type BrowseFacet, type Route } from "../../store/useUiStore";
import { AmpLogo } from "@amp/ui";

/** Windows narrower than this fold the sidebar by themselves. */
function useNarrowSidebar(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 1080px)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1080px)");
    const onChange = () => setNarrow(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

/** Stable stand-in so the cover hook runs even when nothing is playing. */
const EMPTY_COVER = { id: "", coverUrl: undefined, coverPath: undefined, coverDataUrl: undefined };
import { useCoverSrc } from "../../platform/artwork";
import { AddMenu } from "../library/AddMenu";

const COLOR_HEX: Record<string, string> = {
  red: "#e5484d",
  orange: "#f76b15",
  yellow: "#e2b100",
  green: "#30a46c",
  blue: "#0091ff",
  purple: "#8e4ec6",
  grey: "#8b8d98",
};

export function colorHex(color: string | null | undefined): string {
  if (!color) return "var(--amp-text-3)";
  return COLOR_HEX[color] ?? color;
}

function Row({
  label,
  icon,
  active,
  onClick,
  count,
  trailing,
  indent,
}: {
  label: string;
  icon?: React.ReactNode;
  active?: boolean;
  onClick: () => void;
  count?: number;
  trailing?: React.ReactNode;
  indent?: boolean;
}) {
  return (
    <button className="amp-nav-item" data-active={active} onClick={onClick} style={indent ? { paddingLeft: 26 } : undefined}>
      <span className="amp-nav-icon" style={{ display: "inline-flex", width: 18, justifyContent: "center", color: "inherit" }}>{icon}</span>
      <span className="amp-nav-label" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {count !== undefined && <span className="amp-nav-count">{count}</span>}
      {trailing}
    </button>
  );
}

function Heading({ label, action }: { label: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 8px" }}>
      <span className="amp-sidebar-heading">{label}</span>
      {action}
    </div>
  );
}

export function Sidebar() {
  const state = useLibraryStore((s) => s.state);
  const filter = useLibraryStore((s) => s.filter);
  const setFilter = useLibraryStore((s) => s.setFilter);
  const setSort = useLibraryStore((s) => s.setSort);
  const addFolder = useLibraryStore((s) => s.addFolder);
  const removeFolder = useLibraryStore((s) => s.removeFolder);
  const route = useUiStore((s) => s.route);
  const setRoute = useUiStore((s) => s.setRoute);
  const select = useUiStore((s) => s.select);
  const browseFacet = useUiStore((s) => s.browseFacet);
  const setBrowseFacet = useUiStore((s) => s.setBrowseFacet);
  const openDialog = useUiStore((s) => s.openDialog);
  const connected = useUiStore((s) => s.connected);
  const speed = usePlayerStore((s) => s.state.speed);
  const playing = usePlayerStore((s) => s.book);
  const isPlaying = usePlayerStore((s) => s.state.playing);
  const selectedPlaylistId = useUiStore((s) => s.selectedPlaylistId);
  const unlocked = useUiStore((s) => s.unlocked);
  const selectPlaylist = useUiStore((s) => s.selectPlaylist);
  const downloads = useDownloadsStore((s) => s.downloads);
  const activeTransfers = downloads.filter((item) => item.state === "downloading" || item.state === "stalled").length;

  const [search, setSearch] = useState(filter.text);
  const [newFolder, setNewFolder] = useState("");
  const [showFolderInput, setShowFolderInput] = useState(false);

  // Folders are drawn as a tree in the sidebar too: indentation, colour and a
  // lock instead of a count, so a nested shelf is recognisable at a glance.
  const folderRows = useMemo(() => flattenTree(folderTree(state.folders)), [state.folders]);
  const inProgress = state.books.filter((book) => book.progress > 0 && !isFinished(book)).length;
  const finished = state.books.filter(isFinished).length;
  const nowPlayingCover = useCoverSrc(playing ?? EMPTY_COVER);
  const narrow = useNarrowSidebar();
  const totalBytes = state.books.reduce((sum, book) => sum + (book.sizeBytes ?? 0), 0);
  const queueCount = state.queue.length;

  const go = (target: Route, patch?: Partial<typeof filter>) => {
    if (patch) setFilter(patch);
    setRoute(target);
  };

  /** Browse is a page; the sidebar entries open it on the right facet. */
  const openFacet = (facet: BrowseFacet) => {
    setBrowseFacet(facet);
    setRoute("browse");
  };

  const libraryFiltered =
    filter.author !== null ||
    filter.narrator !== null ||
    filter.series !== null ||
    filter.genre !== null ||
    filter.color !== null ||
    Boolean(filter.text) ||
    filter.favorite ||
    filter.inProgress ||
    filter.folderId !== "all";

  const clearFacets = () =>
    setFilter({
      text: "",
      author: null,
      narrator: null,
      series: null,
      genre: null,
      color: null,
      tag: null,
      favorite: false,
      inProgress: false,
      folderId: "all",
    });

  const submitSearch = (value: string) => {
    setSearch(value);
    setFilter({ text: value });
    if (route !== "library") setRoute("library");
    select(null);
  };

  const hasLibrary = state.books.length > 0;
  const collapsed = useSettingsStore((s) => s.settings.ui.sidebarCollapsed);
  const updateSettings = useSettingsStore((s) => s.update);

  /**
   * A narrow window folds the sidebar into an icon rail on its own. Once the
   * reader touches the toggle that choice is theirs and the width stops
   * deciding for them - otherwise the rail could never be opened on a laptop.
   */
  const [railByChoice, setRailByChoice] = useState<boolean | null>(null);
  const rail = railByChoice ?? (collapsed || narrow);

  const toggleRail = () => {
    const next = !rail;
    setRailByChoice(next);
    void updateSettings({ ui: { sidebarCollapsed: next } });
  };

  return (
    <aside className="amp-sidebar" data-collapsed={rail ? "true" : "false"}>
      <div className="amp-sidebar-brand">
        <AmpLogo size={26} title="Amp" />
        <div className="amp-sidebar-label" style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 650, letterSpacing: "-0.02em" }}>Amp</div>
          <div style={{ fontSize: 11.5, color: "var(--amp-text-3)" }}>Audiobooks</div>
        </div>
        <button
          type="button"
          className="amp-sidebar-toggle"
          aria-label={rail ? "Expand the sidebar" : "Collapse the sidebar"}
          title={rail ? "Expand the sidebar" : "Collapse the sidebar"}
          onClick={toggleRail}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <div className="amp-sidebar-add">
        <AddMenu variant="primary" label={rail ? "" : "Add to library"} />
      </div>

      <label className="amp-search-field">
        <Search size={14} />
        <input
          id="amp-search-input"
          value={search}
          onChange={(event) => submitSearch(event.target.value)}
          onFocus={() => {
            if (route !== "library") go("library");
          }}
          placeholder="Search titles, authors, narrators"
          aria-label="Search your library"
        />
        {search && (
          <button type="button" aria-label="Clear search" onClick={() => submitSearch("")}>
            <X size={13} />
          </button>
        )}
      </label>

      <nav className="amp-sidebar-group">
        <Row
          label="Home"
          icon={<Home size={16} />}
          active={route === "home"}
          onClick={() => go("home", libraryFiltered ? { text: "" } : undefined)}
        />
        <Row
          label="New"
          icon={<Sparkles size={16} />}
          active={route === "search"}
          onClick={() => setRoute("search")}
        />
        <Row
          label="Downloads"
          icon={<Download size={16} />}
          active={route === "downloads"}
          onClick={() => setRoute("downloads")}
          count={activeTransfers || undefined}
        />
      </nav>

      {hasLibrary && (
        <nav className="amp-sidebar-group">
          <Heading label="Library" />
          <Row
            label="All books"
            icon={<BookOpen size={16} />}
            active={route === "library" && !libraryFiltered}
            onClick={() => {
              clearFacets();
              setRoute("library");
            }}
            count={state.books.length}
          />
          <Row
            label="Continue listening"
            icon={<Clock size={16} />}
            active={route === "library" && filter.inProgress}
            onClick={() => go("library", { inProgress: true, favorite: false })}
            count={inProgress}
          />
          <Row
            label="Finished"
            icon={<CheckCircle2 size={16} />}
            active={route === "library" && filter.favorite}
            onClick={() => go("library", { favorite: true, inProgress: false })}
            count={finished}
          />
          <Row
            label="Folders"
            icon={<FolderTree size={16} />}
            active={route === "folders"}
            onClick={() => setRoute("folders")}
            count={state.folders.length || undefined}
          />
          <Row
            label="Queue"
            icon={<ListOrdered size={16} />}
            active={route === "queue"}
            onClick={() => setRoute("queue")}
            count={state.queue.length || undefined}
          />
        </nav>
      )}

      {hasLibrary && (
        <nav className="amp-sidebar-group">
          {/* One entry, not six.
              Authors, narrators, series, genres, tags and colours are facets of
              the same page - the Browse page already has them as tabs - so the
              sidebar has no business repeating them as if they were separate
              destinations. */}
          <Row
            label="Browse"
            icon={<Compass size={16} />}
            active={route === "browse"}
            count={state.books.length || undefined}
            onClick={() => openFacet(browseFacet)}
          />
        </nav>
      )}

      {hasLibrary && (
        <nav className="amp-sidebar-group">
          <Heading
            label="Folders"
            action={
              <button className="amp-icon-button" aria-label="New folder" onClick={() => setShowFolderInput((v) => !v)}>
                <Plus size={14} />
              </button>
            }
          />
          {showFolderInput && (
            <form
              style={{ display: "flex", gap: 6, padding: "0 8px" }}
              onSubmit={(event) => {
                event.preventDefault();
                if (!newFolder.trim()) return;
                void addFolder(newFolder.trim());
                setNewFolder("");
                setShowFolderInput(false);
              }}
            >
              <input
                autoFocus
                className="amp-inline-input"
                value={newFolder}
                onChange={(event) => setNewFolder(event.target.value)}
                placeholder="Folder name"
                aria-label="Folder name"
              />
            </form>
          )}
          {folderRows.map(({ folder, depth, children }) => {
            const locked = Boolean(folder.locked && !unlocked.includes(folder.id));
            return (
              <div
                key={folder.id}
                style={{ display: "flex", alignItems: "center", paddingLeft: depth * 12 }}
              >
                <Row
                  label={folder.name}
                  icon={
                    locked ? (
                      <Lock size={13} />
                    ) : (
                      <span className="amp-dot" style={{ background: folder.color ?? "var(--amp-tint)" }} />
                    )
                  }
                  active={filter.folderId === folder.id}
                  onClick={() => {
                    if (locked) {
                      openDialog({ kind: "folderLock", folderId: folder.id, mode: "unlock" });
                      return;
                    }
                    setSort("manual", "asc");
                    go("library", { folderId: folder.id });
                  }}
                  count={
                    locked
                      ? undefined
                      : state.books.filter((book) => book.folderId === folder.id).length ||
                        children.length ||
                        undefined
                  }
                />
                <button
                  className="amp-icon-button"
                  onClick={() => void removeFolder(folder.id, true)}
                  aria-label={`Delete folder ${folder.name}`}
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </nav>
      )}

      <nav className="amp-sidebar-group">
        <Heading
          label="Playlists"
          action={
            <button
              className="amp-icon-button"
              aria-label="New playlist"
              onClick={() => openDialog({ kind: "newPlaylist" })}
            >
              <Plus size={14} />
            </button>
          }
        />
        {state.playlists.length === 0 && (
          <div className="amp-sidebar-note">Playlists collect books across folders.</div>
        )}
        {state.playlists.map((playlist) => (
          <Row
            key={playlist.id}
            label={playlist.name}
            icon={<ListOrdered size={16} />}
            active={route === "playlists" && selectedPlaylistId === playlist.id}
            onClick={() => {
              selectPlaylist(playlist.id);
              setRoute("playlists");
            }}
            count={playlist.bookIds.length}
          />
        ))}
      </nav>

      <div className="amp-sidebar-footer">
        {connected && (
          <>
            {queueCount > 0 && (
              <Row
                label="Up next"
                icon={<ListOrdered size={16} />}
                active={route === "queue"}
                onClick={() => setRoute("queue")}
                count={queueCount}
              />
            )}
            <Row
              label="Transcripts"
              icon={<FileText size={16} />}
              active={route === "transcript"}
              onClick={() => setRoute("transcript")}
            />
            <Row
              label="Settings"
              icon={<SettingsIcon size={16} />}
              active={route === "settings"}
              onClick={() => setRoute("settings")}
            />
          </>
        )}

        {playing && (
          <button
            className="amp-sidebar-now"
            data-playing={isPlaying}
            onClick={() => setRoute("nowplaying")}
            title="Open the full player"
          >
            <span className="amp-sidebar-now-cover">
              {nowPlayingCover ? (
                <img src={nowPlayingCover} alt="" />
              ) : (
                <span>{playing.title.slice(0, 2).toUpperCase()}</span>
              )}
            </span>
            <span style={{ minWidth: 0, display: "grid" }}>
              <span className="amp-sidebar-now-title">{playing.title}</span>
              <span className="amp-sidebar-now-meta">
                {`${bookProgress(playing)}% - ${playing.author}${speed === 1 ? "" : ` - ${speed}x`}`}
              </span>
            </span>
            <span style={{ display: "inline-flex", gap: 2, color: "var(--amp-tint)" }}>
              {[0, 1, 2].map((index) => (
                <span
                  key={index}
                  className="amp-eq-dot"
                  data-paused={!isPlaying}
                  style={{ animationDelay: `${index * 160}ms`, height: 11 }}
                />
              ))}
            </span>
          </button>
        )}

        {state.books.length > 0 && (
          <button className="amp-sidebar-stats" onClick={() => setRoute("stats")}>
            {state.books.length} books - {formatBytes(totalBytes)}
          </button>
        )}
      </div>
    </aside>
  );
}

function bookProgress(book: Book): number {
  if (!book.duration) return 0;
  return Math.min(100, Math.round((book.progress / book.duration) * 100));
}
