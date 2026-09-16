import { useMemo } from "react";
/** Listening stats and library health. */

import { Badge, Button, Divider, Text } from "reshaped";
import { BookOpen, Clock, Flame, HardDrive, Library, ListTree, Trophy, Trash2 } from "lucide-react";
import { bookProgress, computeStats, formatBytes, formatDuration, isFinished } from "@amp/core";
import { useLibraryStore } from "../../store/useLibraryStore";
import { useUiStore } from "../../store/useUiStore";
import { StatCard } from "../common/StatCard";

export function StatsView() {
  const state = useLibraryStore((s) => s.state);
  const stats = useMemo(() => computeStats(state), [state]);
  const booksCount = state.books.length;
  const openDialog = useUiStore((s) => s.openDialog);
  const toast = useUiStore((s) => s.toast);

  const byAuthor = [...state.books.reduce((map, book) => {
    map.set(book.author, (map.get(book.author) ?? 0) + book.duration);
    return map;
  }, new Map<string, number>())]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const mostListened = [...state.books].sort((a, b) => b.progress - a.progress).slice(0, 6);
  const diskBytes = state.books.reduce((acc, book) => acc + (book.sizeBytes ?? 0), 0);

  const historyByDay = state.history.reduce((map, entry) => {
    const key = new Date(entry.at).toISOString().slice(0, 10);
    map.set(key, (map.get(key) ?? 0) + 1);
    return map;
  }, new Map<string, number>());
  const last14 = Array.from({ length: 14 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (13 - index));
    const key = date.toISOString().slice(0, 10);
    return { key, count: historyByDay.get(key) ?? 0 };
  });
  const peak = Math.max(1, ...last14.map((day) => day.count));

  return (
    <div style={{ display: "grid", gap: 18, paddingBottom: 20 }}>
      <div>
        <Text variant="headline-3" weight="bold">
          Listening stats
        </Text>
        <Text variant="caption-1" color="neutral-faded">
          Everything is computed locally from your library file - nothing leaves this machine.
        </Text>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <StatCard icon={Library} label="Books" value={booksCount} hint={`${stats.finished} finished`} />
        <StatCard icon={ListTree} label="Chapters" value={stats.chapters} />
        <StatCard icon={Clock} label="Library length" value={`${stats.hours}h`} />
        <StatCard icon={BookOpen} label="Listened" value={formatDuration(stats.listenedSeconds)} />
        <StatCard icon={Flame} label="Streak" value={`${stats.streakDays} day(s)`} hint="history based" />
        <StatCard icon={HardDrive} label="On disk" value={formatBytes(diskBytes)} />
      </div>

      <div className="amp-panel" style={{ padding: 14, display: "grid", gap: 10 }}>
        <Text variant="featured-5" weight="semibold">
          Last 14 days
        </Text>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 90 }}>
          {last14.map((day) => (
            <div
              key={day.key}
              style={{ display: "grid", justifyItems: "center", gap: 4, flex: 1 }}
              title={`${day.key}: ${day.count} sessions`}
            >
              <div
                style={{
                  width: "100%",
                  height: `${Math.max(4, (day.count / peak) * 70)}px`,
                  background: "linear-gradient(180deg, var(--amp-accent), var(--amp-accent-2))",
                  borderRadius: "var(--amp-radius)",
                  transition: "height 300ms var(--amp-ease)",
                }}
              />
              <Text variant="caption-2" color="neutral-faded">
                {day.key.slice(8)}
              </Text>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16 }}>
        <section className="amp-panel" style={{ padding: 14, display: "grid", gap: 8 }}>
          <Text variant="featured-5" weight="semibold">
            Audio by author
          </Text>
          {byAuthor.map(([author, seconds]) => (
            <div key={author} style={{ display: "grid", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <Text variant="caption-1">{author}</Text>
                <Text variant="caption-1" color="neutral-faded">
                  {formatDuration(seconds)}
                </Text>
              </div>
              <div className="amp-player-progress" style={{ height: 4 }}>
                <span style={{ width: `${(seconds / byAuthor[0][1]) * 100}%` }} />
              </div>
            </div>
          ))}
        </section>

        <section className="amp-panel" style={{ padding: 14, display: "grid", gap: 8 }}>
          <Text variant="featured-5" weight="semibold">
            Farthest along
          </Text>
          {mostListened.map((book) => (
            <div key={book.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Text variant="caption-1" maxLines={1} attributes={{ style: { flex: 1 } }}>
                {book.title}
              </Text>
              <Badge size="small" variant="faded">
                {Math.round(bookProgress(book) * 100)}%
              </Badge>
              {isFinished(book) && (
                <Badge size="small" color="positive">
                  <Trophy size={10} /> done
                </Badge>
              )}
            </div>
          ))}
        </section>
      </div>

      <Divider />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button variant="outline" onClick={() => openDialog({ kind: "about" })}>
          Library and data info
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            void navigator.clipboard
              ?.writeText(JSON.stringify({ stats, books: state.books.length }, null, 2))
              .then(() => toast({ title: "Stats copied as JSON", tone: "success" }))
          }
        >
          Copy stats JSON
        </Button>
        <Button variant="ghost" onClick={() => void useLibraryStore.getState().rescan()}>
          Rescan library for new files
        </Button>
        <Button
          variant="ghost"
          color="critical"
          icon={Trash2}
          onClick={() => {
            useLibraryStore.setState((store) => ({ state: { ...store.state, history: [] } }));
            void useLibraryStore.getState().persist();
            toast({ title: "Listening history cleared", tone: "info" });
          }}
        >
          Clear history
        </Button>
      </div>
    </div>
  );
}
