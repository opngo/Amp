/**
 * Home: what you were listening to, what arrived recently, and nothing else.
 *
 * Every shelf is built from the real library, and a shelf with nothing in it is
 * not rendered at all - no empty placeholders, no invented rows. When the
 * library itself is empty the shell shows the first-run panel instead.
 */

import { useMemo } from "react";
import { Headphones, Play, Sparkles } from "lucide-react";
import { formatBytes, formatDuration, isFinished, type Book } from "@amp/core";
import { useLibraryStore } from "../../store/useLibraryStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useUiStore } from "../../store/useUiStore";
import { BookCard } from "../library/BookCard";
import { AddMenu } from "../library/AddMenu";
import { HeroCard, heroMeta } from "./HeroCard";
import { BannerArt } from "../common/BannerArt";

export function HomeView() {
  const state = useLibraryStore((s) => s.state);
  const setRoute = useUiStore((s) => s.setRoute);
  const select = useUiStore((s) => s.select);
  const book = usePlayerStore((s) => s.book);
  const playing = usePlayerStore((s) => s.state.playing);
  const position = usePlayerStore((s) => s.state.position);
  const loadBook = usePlayerStore((s) => s.loadBook);
  const toggle = usePlayerStore((s) => s.toggle);

  const books = state.books;
  // Rounding 6 minutes to "0.1 hours" reads like a bug: show real units.
  const totalSeconds = books.reduce((acc, item) => acc + item.duration, 0);
  const span = totalSeconds >= 3600 ? `${Math.round((totalSeconds / 3600) * 10) / 10} hours` : formatDuration(totalSeconds);
  const bytes = books.reduce((acc, item) => acc + (item.sizeBytes ?? 0), 0);

  const continueListening = useMemo(
    () =>
      books
        .filter((item) => item.progress > 0 && !isFinished(item))
        .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0)),
    [books],
  );
  const recentlyAdded = useMemo(
    () => [...books].sort((a, b) => b.addedAt - a.addedAt).slice(0, 12),
    [books],
  );

  const openBook = (item: Book) => {
    select(item.id);
    setRoute("library");
  };

  const play = (item: Book, fromStart = false) => {
    void loadBook(item, { position: fromStart ? 0 : item.progress, autoplay: true });
  };

  /**
   * The two wide cards: whatever is in progress, otherwise the newest books.
   * They are the same books the shelves below show, so the feature row keeps
   * the shelves from repeating them under a different heading.
   */
  const featured = (continueListening.length > 0 ? continueListening : recentlyAdded).slice(0, 2);
  const featuredIds = new Set(featured.map((item) => item.id));
  const shelfContinue = continueListening.filter((item) => !featuredIds.has(item.id));
  const shelfRecent = recentlyAdded.filter((item) => !featuredIds.has(item.id));

  if (books.length === 0) {
    return <EmptyLibrary />;
  }

  return (
    <div className="amp-page">
      <header className="amp-page-header">
        <div>
          <h1 className="amp-page-title">Home</h1>
          <p className="amp-page-subtitle">
            {books.length} book{books.length === 1 ? "" : "s"} - {span} - {formatBytes(bytes)}
          </p>
        </div>
        <div className="amp-page-actions">
          <AddMenu />
        </div>
      </header>

      {featured.length > 0 && (
        <section className="amp-section">
          <h2 className="amp-section-title">
            {continueListening.length > 0 ? "Keep listening" : "Start with these"}
          </h2>
          <div className="amp-feature-row">
            {featured.map((item) => {
              const current = book?.id === item.id;
              return (
                <HeroCard
                  key={item.id}
                  art={<BannerArt book={item} />}
                  title={item.title}
                  meta={heroMeta([
                    item.author,
                    item.narrator ? `read by ${item.narrator}` : null,
                    current
                      ? position < 60
                        ? "Picked up where you left off"
                        : `${Math.floor(position / 60)} min into the chapter`
                      : item.progress > 0
                        ? `${Math.round((item.progress / Math.max(1, item.duration)) * 100)}% listened`
                        : `${item.chapters.length} chapter${item.chapters.length === 1 ? "" : "s"}`,
                  ])}
                  progress={item.progress > 0 ? item.progress / Math.max(1, item.duration) : undefined}
                  playing={current && playing}
                  onOpen={() => openBook(item)}
                  onPlay={() => (current ? void toggle() : play(item))}
                />
              );
            })}
          </div>
        </section>
      )}

      {shelfContinue.length > 0 && (
        <section className="amp-section">
          <div className="amp-section-head">
            <h2 className="amp-section-title">Pick up where you left off</h2>
            <button
              className="amp-link"
              onClick={() => {
                useLibraryStore.getState().setFilter({ inProgress: true, favorite: false });
                setRoute("library");
              }}
            >
              See all
            </button>
          </div>
          <div className="amp-shelf">
            {shelfContinue.slice(0, 10).map((item, index) => (
              <BookCard key={item.id} book={item} index={index} />
            ))}
          </div>
        </section>
      )}

      {shelfRecent.length > 0 && (
      <section className="amp-section">
        <div className="amp-section-head">
          <h2 className="amp-section-title">Recently added</h2>
          <button
            className="amp-link"
            onClick={() => {
              useLibraryStore.getState().setSort("added", "desc");
              setRoute("library");
            }}
          >
            See all
          </button>
        </div>
        <div className="amp-shelf">
          {shelfRecent.map((item, index) => (
            <BookCard key={item.id} book={item} index={index} />
          ))}
        </div>
      </section>
      )}

      <section className="amp-section">
        <button className="amp-summary" onClick={() => setRoute("stats")}>
          <Play size={14} />
          {`${books.length} books, ${span}, ${formatBytes(bytes)} on disk`}
          <span className="amp-link">Library stats</span>
        </button>
      </section>
    </div>
  );
}

/**
 * What an empty library shows.
 *
 * This used to be a modal tutorial that covered the app and, if anything went
 * wrong with its dismissal, stayed there. It is now part of the page: three
 * facts about how importing works, and the one button that starts it.
 */
function EmptyLibrary() {
  return (
    <div className="amp-page amp-empty-library">
      <header className="amp-empty-head">
        <Sparkles size={18} />
        <h1 className="amp-page-title">Welcome to Amp</h1>
        <p className="amp-page-subtitle">
          Amp plays what is already on this computer. Nothing is copied, and the library is yours to move around:
          it lives in a JSON file next to your settings.
        </p>
        <div className="amp-empty-action">
          <AddMenu variant="primary" label="Add your first folder" />
        </div>
      </header>

      <div className="amp-empty-grid">
        <article className="amp-empty-card">
          <h2>Point it at a folder</h2>
          <p>
            Pick the folder that holds your audiobooks and Amp works out the rest. Sub-folders are scanned too, and
            files are read where they are.
          </p>
        </article>
        <article className="amp-empty-card">
          <h2>One book, or many</h2>
          <p>
            A folder of tracks can become one audiobook with a chapter per file, or one audiobook per file. The
            choice is on the Add button, and it is remembered.
          </p>
        </article>
        <article className="amp-empty-card">
          <h2>Chapters that work</h2>
          <p>
            m4b chapters and cover art are read from the file itself, including the many encoders that put the
            chapter table at the end.
          </p>
        </article>
      </div>

      <p className="amp-empty-hint">
        <Headphones size={14} />
        Already have files open in another window? Drag them onto Amp.
      </p>
    </div>
  );
}
