/**
 * The bottom bar: frosted glass over whatever is behind it, artwork and titles
 * on the left, transport in the middle, the quieter controls on the right.
 *
 * The transport keeps a bookmark button (that is the action a listener reaches
 * for while driving) and an overflow menu holds the rest, so the bar stays a
 * bar instead of a toolbar.
 */

import {
  Bookmark,
  Check,
  Ellipsis,
  Gauge,
  Heart,
  ListMusic,
  ListOrdered,
  Maximize2,
  Minimize2,
  Moon,
  SlidersHorizontal,
  Speaker,
} from "lucide-react";
import { useState } from "react";
import { DropdownMenu, Divider } from "reshaped";
import { formatTime, sleepLabel } from "@amp/core";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { useUiStore } from "../../store/useUiStore";
import { useLibraryStore } from "../../store/useLibraryStore";
import { CoverArt } from "../common/CoverArt";
import { MarqueeText } from "../common/MarqueeText";
import { ChapterSelect } from "./ChapterSelect";
import { SpeedControl, TransportControls, VolumeControl } from "./PlayerControls";
import { Scrubber } from "./Scrubber";

function BarMenu() {
  const book = usePlayerStore((s) => s.book);
  const sleepRemaining = usePlayerStore((s) => s.state.sleepRemaining);
  const openDialog = useUiStore((s) => s.openDialog);
  const setRoute = useUiStore((s) => s.setRoute);
  const setPlayerVisible = useUiStore((s) => s.setPlayerVisible);
  const setMini = useUiStore((s) => s.setMini);
  const update = useSettingsStore((s) => s.update);
  const eqEnabled = useSettingsStore((s) => s.settings.equalizer.enabled);
  const favorite = useLibraryStore((s) =>
    book ? s.state.books.find((item) => item.id === book.id)?.favorite : false,
  );
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);

  return (
    <DropdownMenu
      position="top-end"
      fallbackPositions={["bottom-end", "top-start"]}
      trapFocusMode="action-menu"
    >
      <DropdownMenu.Trigger>
        {(attributes) => (
          <button
            {...attributes}
            type="button"
            className="amp-bar-icon"
            aria-label="More player options"
            title="More player options"
          >
            <Ellipsis size={17} />
          </button>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <DropdownMenu.Item
          icon={Gauge}
          onClick={() => {
            void update({ equalizer: { enabled: !eqEnabled } });
          }}
        >
          <span className="amp-menu-row">
            <span>Equalizer</span>
            {eqEnabled ? <Check size={13} /> : null}
          </span>
        </DropdownMenu.Item>
        <DropdownMenu.Item icon={SlidersHorizontal} onClick={() => openDialog({ kind: "eq" })}>
          Equalizer settings
        </DropdownMenu.Item>
        <DropdownMenu.Item icon={Moon} onClick={() => openDialog({ kind: "sleep" })}>
          <span className="amp-menu-row">
            <span>Sleep timer</span>
            {sleepRemaining !== null ? (
              <span className="amp-menu-note">{sleepLabel(sleepRemaining)}</span>
            ) : null}
          </span>
        </DropdownMenu.Item>
        <DropdownMenu.Item icon={Speaker} onClick={() => openDialog({ kind: "output" })}>
          Audio output
        </DropdownMenu.Item>
        <Divider />
        <DropdownMenu.Item icon={ListOrdered} onClick={() => setRoute("queue")}>
          Up next
        </DropdownMenu.Item>
        <DropdownMenu.Item
          icon={ListMusic}
          onClick={() => openDialog({ kind: "bookmarks", bookId: book?.id ?? "" })}
        >
          Bookmarks
        </DropdownMenu.Item>
        <DropdownMenu.Item icon={Heart} onClick={() => book && void toggleFavorite(book.id)}>
          {favorite ? "Remove from favourites" : "Add to favourites"}
        </DropdownMenu.Item>
        <Divider />
        <DropdownMenu.Item
          icon={Minimize2}
          onClick={() => {
            setMini(true);
            void update({ window: { mini: true } });
          }}
        >
          Mini player
        </DropdownMenu.Item>
        <DropdownMenu.Item icon={Ellipsis} onClick={() => setPlayerVisible(false)}>
          Hide the player bar
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}

export function PlayerBar() {
  const book = usePlayerStore((s) => s.book);
  const chapter = usePlayerStore((s) => s.currentChapter());
  const position = usePlayerStore((s) => s.state.position);
  const addBookmark = usePlayerStore((s) => s.addBookmark);
  const error = usePlayerStore((s) => s.error);
  const loading = usePlayerStore((s) => s.loading);
  const setPlayerFullscreen = useUiStore((s) => s.setPlayerFullscreen);
  const toast = useUiStore((s) => s.toast);
  const [bookmarked, setBookmarked] = useState(false);

  if (!book) return null;

  return (
    <div className="amp-player">
      <div className="amp-player-scrub">
        <Scrubber times={false} />
      </div>

      <button
        className="amp-no-drag amp-player-now"
        onClick={() => setPlayerFullscreen(true)}
        style={{ background: "none", border: 0, color: "inherit", cursor: "pointer", textAlign: "left" }}
        title="Open the immersive player"
      >
        <span className="amp-player-cover">
          <CoverArt book={book} />
        </span>
        <span style={{ minWidth: 0, display: "grid", gap: 1 }}>
          <MarqueeText text={book.title} />
          <span className="amp-player-subtitle">
            {error ? error : loading ? "Loading..." : `${book.author}${chapter ? ` - ${chapter.title}` : ""}`}
          </span>
        </span>
      </button>

      <div className="amp-player-controls">
        <TransportControls />
        <span className="amp-player-time" aria-label="Elapsed and total time">
          {formatTime(position)}
          <span style={{ color: "var(--amp-text-3)" }}> / {formatTime(book.duration)}</span>
        </span>
      </div>

      <div className="amp-player-extras">
        <span className="amp-player-chapter">
          <ChapterSelect compact />
        </span>
        <span className="amp-player-speed">
          <SpeedControl />
        </span>
        <span className="amp-player-volume">
          <VolumeControl compact />
        </span>
        <button
          type="button"
          className="amp-bar-icon"
          data-active={bookmarked}
          aria-label="Bookmark this spot"
          title="Bookmark this spot"
          onClick={() =>
            void addBookmark().then(() => {
              setBookmarked(true);
              window.setTimeout(() => setBookmarked(false), 1200);
              toast({ title: `Bookmarked ${formatTime(position)}`, tone: "success" });
            })
          }
        >
          <Bookmark size={16} />
        </button>
        <button
          type="button"
          className="amp-bar-icon"
          aria-label="Immersive player"
          title="Immersive player (F)"
          onClick={() => setPlayerFullscreen(true)}
        >
          <Maximize2 size={16} />
        </button>
        <BarMenu />
      </div>
    </div>
  );
}
