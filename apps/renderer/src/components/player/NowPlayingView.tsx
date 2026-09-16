/**
 * The full player.
 *
 * Apple Music in spirit: one wide surface, the artwork on one side, the title
 * and the controls on the other, and nothing that looks like a settings panel.
 * Everything that is configuration - equalizer, sleep timer, output device,
 * bookmarks, the queue - lives behind the overflow button, because a listener
 * pressing play does not want to see it.
 *
 * Layout adapts instead of breaking: two columns when there is room, the
 * artwork on top of a single column when there is not, and the transport row
 * never wraps (the chapter menu shrinks first).
 */

import {
  Bookmark,
  Check,
  ChevronUp,
  Ellipsis,
  Heart,
  ListMusic,
  Minimize2,
  Moon,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  SkipBack,
  SkipForward,
  Speaker,
  Gauge,
  ListOrdered,
} from "lucide-react";
import { useMemo } from "react";
import { Divider, DropdownMenu, Slider } from "reshaped";
import { formatTime, sleepLabel } from "@amp/core";
import { useLibraryStore } from "../../store/useLibraryStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { useUiStore } from "../../store/useUiStore";
import { BannerArt } from "../common/BannerArt";
import { CoverStage } from "./CoverStage";
import { ChapterSelect } from "./ChapterSelect";

function SpeedSlider() {
  const speed = usePlayerStore((s) => s.state.speed);
  const setSpeed = usePlayerStore((s) => s.setSpeed);

  return (
    <div className="amp-np-row amp-np-speed-row">
      <span className="amp-np-label">
        <Gauge size={15} />
        Speed
      </span>
      <div className="amp-np-slider">
        <Slider
          name="speed"
          min={0.5}
          max={3}
          step={0.05}
          value={speed}
          onChange={({ value }) => setSpeed(Number(value.toFixed(2)))}
          attributes={{ "aria-label": "Playback speed" }}
        />
      </div>
      <button type="button" className="amp-np-value" onClick={() => setSpeed(1)} title="Reset to 1x">
        {`${Number(speed.toFixed(2))}x`}
      </button>
    </div>
  );
}

function VolumeSlider() {
  const volume = usePlayerStore((s) => s.state.volume);
  const muted = usePlayerStore((s) => s.state.muted);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);

  return (
    <div className="amp-np-row">
      <span className="amp-np-label">
        <Speaker size={15} />
        Volume
      </span>
      <div className="amp-np-slider">
        <Slider
          name="volume"
          min={0}
          max={1.5}
          step={0.01}
          value={muted ? 0 : volume}
          onChange={({ value }) => {
            if (value === 0) {
              if (!muted) toggleMute();
            } else {
              if (muted) toggleMute();
              setVolume(value);
            }
          }}
          attributes={{ "aria-label": "Volume" }}
        />
      </div>
      <button type="button" className="amp-np-value" onClick={toggleMute} title={muted ? "Unmute" : "Mute"}>
        {muted ? "Muted" : `${Math.round(volume * 100)}%`}
      </button>
    </div>
  );
}

/** Everything you reach for less often than play. */
function PlayerMenu() {
  const book = usePlayerStore((s) => s.book);
  const sleepRemaining = usePlayerStore((s) => s.state.sleepRemaining);
  const addBookmark = usePlayerStore((s) => s.addBookmark);
  const position = usePlayerStore((s) => s.state.position);
  const openDialog = useUiStore((s) => s.openDialog);
  const setRoute = useUiStore((s) => s.setRoute);
  const setPlayerVisible = useUiStore((s) => s.setPlayerVisible);
  const toast = useUiStore((s) => s.toast);
  const eqEnabled = useSettingsStore((s) => s.settings.equalizer.enabled);
  const favorite = useLibraryStore((s) => (book ? s.state.books.find((item) => item.id === book.id)?.favorite : false));
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);
  const update = useSettingsStore((s) => s.update);
  const setMini = useUiStore((s) => s.setMini);

  return (
    <DropdownMenu position="bottom-end" fallbackPositions={["top-end", "bottom-start"]} trapFocusMode="action-menu">
      <DropdownMenu.Trigger>
        {(attributes) => (
          <button {...attributes} type="button" className="amp-np-icon" aria-label="More options" title="More options">
            <Ellipsis size={18} />
          </button>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <DropdownMenu.Item icon={Bookmark} onClick={() => void addBookmark().then(() => toast({ title: `Bookmarked ${formatTime(position)}`, tone: "success" }))}>
          Bookmark here
        </DropdownMenu.Item>
        <DropdownMenu.Item icon={ListMusic} onClick={() => openDialog({ kind: "bookmarks", bookId: book?.id ?? "" })}>
          Bookmarks
        </DropdownMenu.Item>
        <DropdownMenu.Item icon={ListOrdered} onClick={() => setRoute("queue")}>
          Up next
        </DropdownMenu.Item>
        <Divider />
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
        <DropdownMenu.Item icon={SlidersHorizontal} onClick={() => openDialog({ kind: "eq" })}>
          Equalizer settings
        </DropdownMenu.Item>
        <DropdownMenu.Item icon={Moon} onClick={() => openDialog({ kind: "sleep" })}>
          <span className="amp-menu-row">
            <span>Sleep timer</span>
            {sleepRemaining !== null ? <span className="amp-menu-note">{sleepLabel(sleepRemaining)}</span> : null}
          </span>
        </DropdownMenu.Item>
        <DropdownMenu.Item icon={Speaker} onClick={() => openDialog({ kind: "output" })}>
          Audio output
        </DropdownMenu.Item>
        <Divider />
        <DropdownMenu.Item icon={Heart} onClick={() => book && void toggleFavorite(book.id)}>
          {favorite ? "Remove from favourites" : "Add to favourites"}
        </DropdownMenu.Item>
        <DropdownMenu.Item
          icon={Minimize2}
          onClick={() => {
            setMini(true);
            void update({ window: { mini: true } });
          }}
        >
          Mini player
        </DropdownMenu.Item>
        <DropdownMenu.Item icon={ChevronUp} onClick={() => setPlayerVisible(false)}>
          Hide the player bar
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}

export function NowPlayingView() {
  const book = usePlayerStore((s) => s.book);
  const chapter = usePlayerStore((s) => s.currentChapter());
  const state = usePlayerStore((s) => s.state);
  const toggle = usePlayerStore((s) => s.toggle);
  const nextChapter = usePlayerStore((s) => s.nextChapter);
  const prevChapter = usePlayerStore((s) => s.prevChapter);
  const skip = usePlayerStore((s) => s.skip);
  const seek = usePlayerStore((s) => s.seek);
  const settings = useSettingsStore((s) => s.settings);
  const palette = useSettingsStore((s) => s.palette);
  const openDialog = useUiStore((s) => s.openDialog);
  const setRoute = useUiStore((s) => s.setRoute);
  const addBookmark = usePlayerStore((s) => s.addBookmark);
  const toast = useUiStore((s) => s.toast);

  const progress = useMemo(() => {
    if (!book) return 0;
    return Math.min(1, Math.max(0, state.position / Math.max(1, book.duration)));
  }, [book, state.position]);

  if (!book) {
    return (
      <div className="amp-np amp-np-empty">
        <p className="amp-empty-hint">Nothing is playing. Pick a book and press play.</p>
        <button type="button" className="amp-chip" onClick={() => setRoute("library")}>
          Go to the library
        </button>
      </div>
    );
  }

  const chapterProgress = chapter ? (state.position - chapter.start) / Math.max(1, chapter.duration) : 0;
  return (
    <section className="amp-np" data-playing={state.playing}>
      <div className="amp-np-backdrop" aria-hidden>
        <BannerArt book={book} palette={palette} blur={26} />
      </div>

      <div className="amp-np-body">
        <div className="amp-np-info">
          <span className="amp-np-kicker">{state.playing ? "Now playing" : "Paused"}</span>
          <h1 className="amp-np-title">{book.title}</h1>
          <p className="amp-np-byline">
            {book.author}
            {book.narrator ? ` - narrated by ${book.narrator}` : ""}
          </p>

          <div className="amp-np-progress">
            <div
              className="amp-np-bar"
              role="slider"
              tabIndex={0}
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={Math.round(book.duration)}
              aria-valuenow={Math.round(state.position)}
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                seek(((event.clientX - box.left) / box.width) * book.duration);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") seek(state.position + settings.playback.skipSeconds);
                if (event.key === "ArrowLeft") seek(state.position - settings.playback.skipBackSeconds);
              }}
            >
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
              {chapterProgress > 0 && (
                <span
                  className="amp-np-chapter-bar"
                  style={{
                    left: `${(chapter?.start ?? 0) / Math.max(1, book.duration) * 100}%`,
                    width: `${(chapter?.duration ?? 0) / Math.max(1, book.duration) * 100}%`,
                  }}
                />
              )}
            </div>
            <p className="amp-np-readout">
              {formatTime(state.position)} of {formatTime(book.duration)} - {formatTime(Math.max(0, book.duration - state.position))} left at{" "}
              {state.speed}x
            </p>
          </div>

          <div className="amp-np-sound">
            <SpeedSlider />
            <VolumeSlider />
          </div>
        </div>

        <div className="amp-np-art">
          <CoverStage />
          <p className="amp-np-art-meta">
            {`${Math.round(progress * 100)}% of ${formatTime(book.duration)}`}
          </p>
        </div>
      </div>

      <footer className="amp-np-transport">
        <div className="amp-np-transport-left">
          <ChapterSelect compact />
        </div>
        <div className="amp-np-transport-center">
          <button type="button" className="amp-np-icon" onClick={() => skip(-settings.playback.skipBackSeconds)} aria-label={`Back ${settings.playback.skipBackSeconds} seconds`}>
            <RotateCcw size={19} />
          </button>
          <button type="button" className="amp-np-icon" onClick={() => void prevChapter()} aria-label="Previous chapter">
            <SkipBack size={20} />
          </button>
          <button type="button" className="amp-np-play" onClick={() => void toggle()} aria-label={state.playing ? "Pause" : "Play"}>
            {state.playing ? <Pause size={24} /> : <Play size={24} />}
          </button>
          <button type="button" className="amp-np-icon" onClick={() => void nextChapter()} aria-label="Next chapter">
            <SkipForward size={20} />
          </button>
          <button type="button" className="amp-np-icon" onClick={() => skip(settings.playback.skipSeconds)} aria-label={`Forward ${settings.playback.skipSeconds} seconds`}>
            <RotateCw size={19} />
          </button>
        </div>
        <div className="amp-np-transport-right">
          <button
            type="button"
            className="amp-np-icon"
            aria-label="Bookmark this spot"
            title="Bookmark this spot"
            onClick={() =>
              void addBookmark().then(() => toast({ title: `Bookmarked ${formatTime(state.position)}`, tone: "success" }))
            }
          >
            <Bookmark size={18} />
          </button>
          <button
            type="button"
            className="amp-np-icon"
            aria-label="Edit this book"
            title="Edit this book"
            onClick={() => openDialog({ kind: "editBook", bookId: book.id })}
          >
            <SlidersHorizontal size={18} />
          </button>
          <PlayerMenu />
        </div>
      </footer>
    </section>
  );
}
