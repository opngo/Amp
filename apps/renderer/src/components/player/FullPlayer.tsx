/**
 * The immersive player.
 *
 * One surface, the whole window, built out of layers that move: a slow wash of
 * the cover's colours, three drifting orbs, the artwork breathing in the
 * middle of a ring visualizer, and - on the other side - the book, stated once
 * and stated large.
 *
 * Layout rules, in the order they matter:
 *
 *   1. Nothing that can be configured is on the face of it. Chapters, output,
 *      equalizer, sleep, tray live behind the overflow button or in Settings.
 *   2. The transport is under the artwork, never at the bottom of the window,
 *      so the eye does not have to travel to find play.
 *   3. Speed and volume sit in a corner as one small control that opens when
 *      asked. They are the two things a listener changes mid-sentence, so they
 *      are close; they are not things anybody reads, so they take no space.
 *   4. Everything is measured against the viewport. There is no arrangement
 *      that fits one screen and breaks on another: the columns stack under
 *      1000px, the type scales with a clamp, and under 620px by 460px - a
 *      flyout window parked next to the tray - the same surface becomes the
 *      compact form: cover, title, transport, nothing else.
 *
 * Closing it offers the tray, because a window that goes away while a book is
 * playing should ask first.
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  AppWindow,
  Bookmark,
  BookmarkX,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Gauge,
  Heart,
  ListMusic,
  ListOrdered,
  Minimize,
  Moon,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  X,
  SlidersHorizontal,
  Speaker,
  VolumeX,
} from "lucide-react";
import { Divider, DropdownMenu, Slider, Text } from "reshaped";
import { chapterAt, formatTime, sleepLabel } from "@amp/core";
import { wrapsCover } from "../../audio/visualizer";
import { useLibraryStore } from "../../store/useLibraryStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { useUiStore } from "../../store/useUiStore";
import { bridgeIfReady } from "../../platform/bridge";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { CoverStage } from "./CoverStage";
import { VisualizerCanvas } from "./VisualizerCanvas";
import { Scrubber } from "./Scrubber";

/* ---------------------------------------------------------------------------
 * The corner: speed and volume, folded away until asked for
 * ------------------------------------------------------------------------ */

/**
 * The audio corner.
 *
 * Collapsed it is one small row of numbers - the two settings people actually
 * move while listening - and nothing else. Opening it lifts a panel out of the
 * corner with the sliders, the output device and the equalizer switch, drawn
 * the way a system flyout is drawn: soft, rounded, translucent, and gone the
 * moment attention moves elsewhere.
 */
function SoundCorner() {
  const speed = usePlayerStore((s) => s.state.speed);
  const setSpeed = usePlayerStore((s) => s.setSpeed);
  const volume = usePlayerStore((s) => s.state.volume);
  const muted = usePlayerStore((s) => s.state.muted);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const openDialog = useUiStore((s) => s.openDialog);
  const eqEnabled = useSettingsStore((s) => s.settings.equalizer.enabled);
  const update = useSettingsStore((s) => s.update);
  const open = useUiStore((s) => s.soundPanelOpen);
  const setOpen = useUiStore((s) => s.setSoundPanelOpen);

  const percent = muted ? 0 : Math.round(volume * 100);

  return (
    <div className="amp-corner" data-open={open}>
      {open ? (
        <button
          type="button"
          className="amp-corner-scrim"
          aria-label="Close the sound controls"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <div className="amp-corner-panel" role="group" aria-label="Sound">
        <div className="amp-corner-row">
          <span className="amp-corner-label">
            <Gauge size={14} />
            Speed
          </span>
          <div className="amp-corner-slider">
            <Slider
              name="cornerSpeed"
              min={0.5}
              max={3}
              step={0.05}
              value={speed}
              onChange={({ value }) => setSpeed(Number(value.toFixed(2)))}
              attributes={{ "aria-label": "Playback speed" }}
            />
          </div>
          <button type="button" className="amp-corner-value" onClick={() => setSpeed(1)} title="Reset to 1x">
            {`${Number(speed.toFixed(2))}x`}
          </button>
        </div>
        <div className="amp-corner-row">
          <button
            type="button"
            className="amp-corner-label amp-corner-label-button"
            onClick={toggleMute}
            title={muted ? "Unmute" : "Mute"}
          >
            {muted ? <VolumeX size={14} /> : <Speaker size={14} />}
            Volume
          </button>
          <div className="amp-corner-slider">
            <Slider
              name="cornerVolume"
              min={0}
              max={1.5}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={({ value }) => {
                if (value === 0) {
                  if (!muted) toggleMute();
                  return;
                }
                if (muted) toggleMute();
                setVolume(value);
              }}
              attributes={{ "aria-label": "Volume" }}
            />
          </div>
          <button
            type="button"
            className="amp-corner-value"
            onClick={toggleMute}
            title={muted ? "Unmute" : "Mute"}
          >
            {muted ? "Muted" : `${percent}%`}
          </button>
        </div>
        <Divider />
        <div className="amp-corner-actions">
          <button type="button" className="amp-corner-action" onClick={() => openDialog({ kind: "output" })}>
            <Speaker size={14} />
            Output
          </button>
          <button
            type="button"
            className="amp-corner-action"
            onClick={() => void update({ equalizer: { enabled: !eqEnabled } })}
          >
            <Check size={14} style={{ opacity: eqEnabled ? 1 : 0.25 }} />
            Equalizer
          </button>
          <button type="button" className="amp-corner-action" onClick={() => openDialog({ kind: "eq" })}>
            <SlidersHorizontal size={14} />
            Curve
          </button>
        </div>
      </div>

      <button
        type="button"
        className="amp-corner-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title="Speed and volume"
      >
        <Gauge size={15} />
        <span>{`${Number(speed.toFixed(2))}x`}</span>
        <span className="amp-corner-dot" />
        {muted ? <VolumeX size={15} /> : <Speaker size={15} />}
        <span>{muted ? "off" : `${percent}%`}</span>
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * The overflow menu
 * ------------------------------------------------------------------------ */

/** Everything that is not worth a button on a player this size. */
function PlayerOverflow() {
  const book = usePlayerStore((s) => s.book);
  const position = usePlayerStore((s) => s.state.position);
  const sleepRemaining = usePlayerStore((s) => s.state.sleepRemaining);
  const addBookmark = usePlayerStore((s) => s.addBookmark);
  const openDialog = useUiStore((s) => s.openDialog);
  const setRoute = useUiStore((s) => s.setRoute);
  const setMini = useUiStore((s) => s.setMini);
  const toast = useUiStore((s) => s.toast);
  const eqEnabled = useSettingsStore((s) => s.settings.equalizer.enabled);
  const update = useSettingsStore((s) => s.update);
  const favorite = useLibraryStore((s) =>
    book ? s.state.books.find((item) => item.id === book.id)?.favorite : false,
  );
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);

  return (
    <DropdownMenu
      position="bottom-end"
      fallbackPositions={["top-end", "bottom-start"]}
      trapFocusMode="action-menu"
    >
      <DropdownMenu.Trigger>
        {(attributes) => (
          <button
            {...attributes}
            type="button"
            className="amp-fullp-icon"
            aria-label="More options"
            title="More options"
          >
            <Ellipsis size={19} />
          </button>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <DropdownMenu.Item
          icon={Bookmark}
          onClick={() =>
            void addBookmark().then(() =>
              toast({ title: `Bookmarked ${formatTime(position)}`, tone: "success" }),
            )
          }
        >
          Bookmark here
        </DropdownMenu.Item>
        <DropdownMenu.Item
          icon={ListMusic}
          onClick={() => openDialog({ kind: "bookmarks", bookId: book?.id ?? "" })}
        >
          Bookmarks
        </DropdownMenu.Item>
        <DropdownMenu.Item icon={ListOrdered} onClick={() => setRoute("queue")}>
          Up next
        </DropdownMenu.Item>
        <DropdownMenu.Item icon={Heart} onClick={() => book && void toggleFavorite(book.id)}>
          {favorite ? "Remove from favourites" : "Add to favourites"}
        </DropdownMenu.Item>
        <Divider />
        <DropdownMenu.Item icon={Moon} onClick={() => openDialog({ kind: "sleep" })}>
          <span className="amp-menu-row">
            <span>Sleep timer</span>
            {sleepRemaining !== null ? (
              <span className="amp-menu-note">{sleepLabel(sleepRemaining)}</span>
            ) : null}
          </span>
        </DropdownMenu.Item>
        <DropdownMenu.Item
          icon={Gauge}
          onClick={() => {
            void update({ equalizer: { enabled: !eqEnabled } });
            toast({ title: eqEnabled ? "Equalizer off" : "Equalizer on", tone: "info" });
          }}
        >
          <span className="amp-menu-row">
            <span>Equalizer</span>
            {eqEnabled ? <Check size={13} /> : null}
          </span>
        </DropdownMenu.Item>
        <DropdownMenu.Item icon={Speaker} onClick={() => openDialog({ kind: "output" })}>
          Audio output
        </DropdownMenu.Item>
        <Divider />
        <DropdownMenu.Item
          icon={AppWindow}
          onClick={() => {
            toast({
              title: "Compact flyout",
              description: "Amp shrinks into a small always-on-top window that keeps playing.",
              tone: "info",
            });
            void bridgeIfReady()?.player.window("flyout");
          }}
        >
          Show as a flyout
        </DropdownMenu.Item>
        <DropdownMenu.Item
          icon={Minimize}
          onClick={() => {
            setMini(true);
            void update({ window: { mini: true } });
          }}
        >
          Mini widget
        </DropdownMenu.Item>
        <DropdownMenu.Item
          icon={Minimize}
          onClick={() => {
            void bridgeIfReady()?.player.hideToTray();
          }}
        >
          Add to the tray
        </DropdownMenu.Item>
        <DropdownMenu.Item icon={ChevronDown} onClick={() => useUiStore.getState().setPlayerVisible(false)}>
          Hide the player bar
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}

/* ---------------------------------------------------------------------------
 * Transport
 * ------------------------------------------------------------------------ */

function Transport({ large = false }: { large?: boolean }) {
  const state = usePlayerStore((s) => s.state);
  const toggle = usePlayerStore((s) => s.toggle);
  const nextChapter = usePlayerStore((s) => s.nextChapter);
  const prevChapter = usePlayerStore((s) => s.prevChapter);
  const skip = usePlayerStore((s) => s.skip);
  const settings = useSettingsStore((s) => s.settings);
  const size = large ? 26 : 21;

  return (
    <div className="amp-fullp-transport" data-large={large}>
      <button
        type="button"
        className="amp-fullp-icon"
        onClick={() => skip(-settings.playback.skipBackSeconds)}
        aria-label={`Back ${settings.playback.skipBackSeconds} seconds`}
        title={`Back ${settings.playback.skipBackSeconds}s`}
      >
        <RotateCcw size={size - 3} />
      </button>
      <button
        type="button"
        className="amp-fullp-icon"
        onClick={() => void prevChapter()}
        aria-label="Previous chapter"
        title="Previous chapter"
      >
        <SkipBack size={size - 2} />
      </button>
      <button
        type="button"
        className="amp-fullp-play"
        onClick={() => void toggle()}
        aria-label={state.playing ? "Pause" : "Play"}
        data-playing={state.playing}
      >
        {state.playing ? <Pause size={size} /> : <Play size={size} />}
      </button>
      <button
        type="button"
        className="amp-fullp-icon"
        onClick={() => void nextChapter()}
        aria-label="Next chapter"
        title="Next chapter"
      >
        <SkipForward size={size - 2} />
      </button>
      <button
        type="button"
        className="amp-fullp-icon"
        onClick={() => skip(settings.playback.skipSeconds)}
        aria-label={`Forward ${settings.playback.skipSeconds} seconds`}
        title={`Forward ${settings.playback.skipSeconds}s`}
      >
        <RotateCw size={size - 3} />
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * The column under the title
 * ------------------------------------------------------------------------ */

type Pane = "chapters" | "queue" | "bookmarks";
const PANES: Pane[] = ["chapters", "queue", "bookmarks"];

/* ---------------------------------------------------------------------------
 * The player
 * ------------------------------------------------------------------------ */

export function FullPlayer({ variant }: { variant: "page" | "overlay" }) {
  const chapterStopFor = usePlayerStore((s) => s.chapterStopFor);
  const book = usePlayerStore((s) => s.book);
  const state = usePlayerStore((s) => s.state);
  const chapter = usePlayerStore((s) => s.currentChapter());
  const seekChapter = usePlayerStore((s) => s.seekChapter);
  const setRoute = useUiStore((s) => s.setRoute);
  const openDialog = useUiStore((s) => s.openDialog);
  const toast = useUiStore((s) => s.toast);
  const palette = useSettingsStore((s) => s.palette);
  const settings = useSettingsStore((s) => s.settings);
  const ring = wrapsCover(settings.visualizer.mode);
  const loadBook = usePlayerStore((s) => s.loadBook);
  const seek = usePlayerStore((s) => s.seek);
  const queue = useLibraryStore((s) => s.state.queue);
  const books = useLibraryStore((s) => s.state.books);
  const bookmarks = useLibraryStore((s) => s.state.bookmarks);
  const removeFromQueue = useLibraryStore((s) => s.removeFromQueue);
  const removeBookmark = useLibraryStore((s) => s.removeBookmark);
  /*
   * The column under the title used to be the chapter list and nothing else,
   * with a chapter dropdown above it. The dropdown is gone - the chevrons that
   * stood beside it now move this section between the chapters, the queue and
   * the bookmarks, which is what a listener reaches for while a book is playing.
   */
  const [pane, setPane] = useState<Pane>("chapters");
  const stepPane = useCallback((step: number) => {
    setPane((current) => {
      const index = PANES.indexOf(current);
      return PANES[(index + step + PANES.length) % PANES.length];
    });
  }, []);
  const bookmarksForBook = useMemo(
    () =>
      bookmarks
        .filter((mark) => mark.bookId === book?.id)
        .slice()
        .sort((a, b) => a.position - b.position),
    [bookmarks, book?.id],
  );
  // A short or narrow window is a flyout: the same surface, folded down to the
  // four things that still fit. The desktop build can park this next to the
  // tray (Player overflow > Show as a flyout).
  const flyout = useMediaQuery("(max-width: 620px), (max-height: 460px)");
  const wide = useMediaQuery("(min-width: 1000px)");

  const leave = useCallback(() => {
    const ui = useUiStore.getState();
    // One layer at a time: the corner panel folds away before the player does.
    if (ui.soundPanelOpen) {
      ui.setSoundPanelOpen(false);
      return;
    }
    if (variant === "overlay") {
      ui.setPlayerFullscreen(false);
      if (ui.route === "nowplaying") ui.setRoute("library");
    } else {
      setRoute("library");
    }
    // Closing the player is not the same as quitting, and it is not the same as
    // wanting the window gone either - ask once, and let the answer be "no".
    if (variant === "overlay" && state.playing) {
      toast({
        title: "Amp keeps playing outside the player",
        description: "Put it in the tray and it will keep reading while the window is out of the way.",
        tone: "info",
        action: {
          label: "Add to the tray",
          run: () => {
            void bridgeIfReady()?.player.hideToTray();
          },
        },
      });
    }
  }, [variant, setRoute, toast, state.playing]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leave]);

  if (!book) {
    return (
      <section className="amp-fullp" data-variant={variant}>
        <div className="amp-fullp-empty">
          <Text variant="title-4" weight="medium">
            Nothing is playing
          </Text>
          <Text variant="body-2" color="neutral-faded">
            Pick a book from the library and it will take over this surface.
          </Text>
          <button type="button" className="amp-fullp-ghost" onClick={() => setRoute("library")}>
            Go to the library
          </button>
        </div>
      </section>
    );
  }

  const PANE_LABELS: Record<Pane, { title: string; count: string }> = {
    chapters: {
      title: "Chapters",
      count: `${book.chapters.length}`,
    },
    queue: {
      title: "Up next",
      count: `${queue.length}`,
    },
    bookmarks: {
      title: "Bookmarks",
      count: `${bookmarksForBook.length}`,
    },
  };
  const jumpToBookmark = async (position: number) => {
    await seek(position);
    if (!state.playing) void loadBook(book, { position, autoplay: true });
  };
  const progress = Math.min(1, Math.max(0, state.position / Math.max(1, book.duration)));
  const chapterProgress = chapter
    ? Math.max(0, Math.min(1, (state.position - chapter.start) / Math.max(1, chapter.duration)))
    : 0;
  const remaining = Math.max(0, book.duration - state.position) / (state.speed || 1);

  return (
    <section
      className="amp-fullp"
      data-variant={variant}
      data-flyout={flyout ? "true" : undefined}
      data-wide={wide ? "true" : undefined}
      data-playing={state.playing}
      style={
        {
          "--np-accent": palette?.primary ?? "var(--amp-accent)",
          "--np-accent-alt": palette?.accent ?? "var(--amp-accent-2)",
        } as CSSProperties
      }
    >
      {/* The moving layers. None of them carry information; all of them carry
          the cover's colours across the surface, slowly, so the page breathes. */}
      <div className="amp-fullp-motion" aria-hidden>
        <span className="amp-fullp-orb amp-fullp-orb-a" />
        <span className="amp-fullp-orb amp-fullp-orb-b" />
        <span className="amp-fullp-orb amp-fullp-orb-c" />
        <span className="amp-fullp-sheen" />
      </div>

      <header className="amp-fullp-top">
        <button type="button" className="amp-fullp-ghost" onClick={leave}>
          <ChevronDown size={17} />
          {variant === "overlay" ? "Leave the player" : "Back"}
        </button>
        <div className="amp-fullp-top-right">
          <button
            type="button"
            className="amp-fullp-icon"
            aria-label="Bookmark this spot"
            title="Bookmark this spot"
            onClick={() =>
              void usePlayerStore
                .getState()
                .addBookmark()
                .then(() => toast({ title: `Bookmarked ${formatTime(state.position)}`, tone: "success" }))
            }
          >
            <Bookmark size={18} />
          </button>
          <button
            type="button"
            className="amp-fullp-icon"
            aria-label="Edit this book"
            title="Edit this book"
            onClick={() => openDialog({ kind: "editBook", bookId: book.id })}
          >
            <SlidersHorizontal size={18} />
          </button>
          <PlayerOverflow />
        </div>
      </header>

      <div className="amp-fullp-body">
        {/* The artwork, the transport and the sound: one side. */}
        <div className="amp-fullp-stage">
          <div className="amp-fullp-art" data-playing={state.playing}>
            <CoverStage
              maxSize={flyout ? 116 : wide ? 380 : 300}
              reserve={flyout ? 210 : 330}
              caption={false}
              visualizer={ring}
            />
          </div>
          {/* The baseline shapes get their own band: a wave or a row of bars
              laid over the transport is decoration you cannot read. The ring
              and the halo stay with the artwork, where they belong. */}
          {ring || flyout ? null : (
            <div className="amp-fullp-viz">
              <VisualizerCanvas settings={settings} color={palette?.primary} colorAlt={palette?.accent} />
            </div>
          )}
          <Transport large={!flyout} />
          <div className="amp-fullp-scrub">
            <Scrubber times={false} />
          </div>
          <div className="amp-fullp-readout">
            <span className="amp-fullp-time">{formatTime(state.position)}</span>
            <span className="amp-fullp-chapter-name">
              {chapter ? `${chapter.index}. ${chapter.title}` : "Chapter list"}
            </span>
            <span className="amp-fullp-time">{`-${formatTime(remaining)}`}</span>
          </div>
        </div>

        {/* The book, stated once and stated large. */}
        <div className="amp-fullp-info">
          <span className="amp-fullp-kicker" key={`k-${book.id}`}>
            {state.playing ? "Now playing" : "Paused"}
          </span>
          <h1 className="amp-fullp-title" key={book.id}>
            {book.title}
          </h1>
          <p className="amp-fullp-byline">
            {book.author}
            {book.narrator ? ` - narrated by ${book.narrator}` : ""}
          </p>

          <div className="amp-fullp-meta">
            <span className="amp-fullp-chip" title="Elapsed in this chapter">
              {chapterReadout(chapterProgress)}
            </span>
            {bookmarksForBook.length > 0 && (
              <span className="amp-fullp-chip" title="Bookmarks in this book">
                {`${bookmarksForBook.length} bookmark${bookmarksForBook.length === 1 ? "" : "s"}`}
              </span>
            )}
          </div>

          {flyout ? null : (
            <div className="amp-fullp-section">
              {/* One column, three readings of the same book: what is left to
                  hear, what is queued after it, and the places marked by hand.
                  The chevrons move between them, so the section that used to
                  hold a chapter dropdown holds the queue and the bookmarks
                  too, without another row of furniture. */}
              <div className="amp-fullp-section-head">
                <button
                  type="button"
                  className="amp-fullp-icon amp-fullp-section-step"
                  aria-label="Previous section"
                  title="Previous section"
                  onClick={() => stepPane(-1)}
                >
                  <ChevronLeft size={17} />
                </button>
                <span className="amp-fullp-section-title">
                  {PANE_LABELS[pane].title}
                  <span className="amp-fullp-section-count">{PANE_LABELS[pane].count}</span>
                </span>
                <button
                  type="button"
                  className="amp-fullp-icon amp-fullp-section-step"
                  aria-label="Next section"
                  title="Next section"
                  onClick={() => stepPane(1)}
                >
                  <ChevronRight size={17} />
                </button>
              </div>

              {pane === "chapters" ? (
            <div className="amp-fullp-chapters" role="list" aria-label="Chapters">
              {book.chapters.map((item, index) => {
                const current = index === state.chapterIndex;
                const started = state.position >= item.start + item.duration;
                // A chapter that was left partway through says so, and clicking
                // it carries on from there rather than from its first word.
                const stop = current ? null : chapterStopFor(index);
                const inside = current ? Math.max(0, state.position - item.start) : (stop ?? 0);
                const left = Math.max(0, item.duration - inside);
                return (
                  <button
                    type="button"
                    role="listitem"
                    key={item.id}
                    className="amp-fullp-chapter"
                    data-current={current}
                    data-done={started}
                    onClick={() => void seekChapter(index)}
                    title={`${item.title} - ${formatTime(item.duration)}`}
                  >
                    <span className="amp-fullp-chapter-index">{String(index + 1).padStart(2, "0")}</span>
                    <span className="amp-fullp-chapter-title">
                      {item.title}
                      {stop !== null && (
                        <span className="amp-fullp-chapter-note">
                          {`Continue with the remaining ${formatTime(left)}`}
                        </span>
                      )}
                    </span>
                    <span className="amp-fullp-chapter-time">
                      {current ? formatTime(inside) : formatTime(item.duration)}
                    </span>
                  </button>
                );
              })}
            </div>
              ) : null}

              {pane === "queue" ? (
                <div className="amp-fullp-chapters" role="list" aria-label="Queue">
                  {queue.length === 0 ? (
                    <p className="amp-fullp-pane-empty">
                      Nothing is queued. Add books from the library and they play one after another.
                    </p>
                  ) : (
                    queue.map((item, index) => {
                      const queued = books.find((candidate) => candidate.id === item.bookId);
                      if (!queued) return null;
                      return (
                        <div
                          key={item.bookId}
                          role="listitem"
                          className="amp-fullp-chapter"
                          data-current={queued.id === book.id}
                        >
                          <span className="amp-fullp-chapter-index">{String(index + 1).padStart(2, "0")}</span>
                          <button
                            type="button"
                            className="amp-fullp-chapter-open"
                            onClick={() => void loadBook(queued, { autoplay: true })}
                            title={`Play ${queued.title}`}
                          >
                            <span className="amp-fullp-chapter-title">{queued.title}</span>
                            <span className="amp-fullp-chapter-note">{queued.author}</span>
                          </button>
                          <button
                            type="button"
                            className="amp-fullp-chapter-drop"
                            aria-label={`Remove ${queued.title} from the queue`}
                            title="Remove from the queue"
                            onClick={() => removeFromQueue(queued.id)}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : null}

              {pane === "bookmarks" ? (
                <div className="amp-fullp-chapters" role="list" aria-label="Bookmarks">
                  {bookmarksForBook.length === 0 ? (
                    <p className="amp-fullp-pane-empty">
                      No bookmarks in this book yet. The bookmark button at the top marks the spot you are on.
                    </p>
                  ) : (
                    bookmarksForBook.map((mark) => (
                      <div key={mark.id} role="listitem" className="amp-fullp-chapter">
                        <span className="amp-fullp-chapter-index">{formatTime(mark.position)}</span>
                        <button
                          type="button"
                          className="amp-fullp-chapter-open"
                          onClick={() => void jumpToBookmark(mark.position)}
                          title={`Go to ${formatTime(mark.position)}`}
                        >
                          <span className="amp-fullp-chapter-title">{mark.label || "Bookmark"}</span>
                          <span className="amp-fullp-chapter-note">
                            {book.chapters[chapterAt(book.chapters, mark.position)]?.title ?? ""}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="amp-fullp-chapter-drop"
                          aria-label="Remove this bookmark"
                          title="Remove the bookmark"
                          onClick={() => removeBookmark(mark.id)}
                        >
                          <BookmarkX size={14} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          )}

          {flyout ? null : (
            <div className="amp-fullp-facts">
              <span>{`${Math.round(progress * 100)}% of ${formatTime(book.duration)}`}</span>
              <span className="amp-fullp-sep" />
              <span>{`${book.chapters.length} chapter${book.chapters.length === 1 ? "" : "s"}`}</span>
              <span className="amp-fullp-sep" />
              <span>{book.kind === "multi" ? `${book.chapters.length} files` : "One file"}</span>
              <span className="amp-fullp-sep" />
              <span
                role="button"
                tabIndex={0}
                className="amp-fullp-link"
                onClick={() => setRoute("library")}
                onKeyDown={(event) => {
                  if (event.key === "Enter") setRoute("library");
                }}
              >
                Back to the library
              </span>
            </div>
          )}
        </div>
      </div>

      <SoundCorner />
    </section>
  );
}

/** How far into the chapter the listener is, as a sentence rather than a bar. */
function chapterReadout(chapterProgress: number): string {
  if (!Number.isFinite(chapterProgress)) return "";
  return `Chapter ${Math.round(chapterProgress * 100)}% read`;
}

export default FullPlayer;
