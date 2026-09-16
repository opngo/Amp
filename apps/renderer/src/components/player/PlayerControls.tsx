/** Play/pause, skip, speed, sleep, repeat, shuffle, volume, EQ - the whole bar. */

import { Button, Slider, Text } from "reshaped";
import {
  Bookmark,
  Gauge,
  Heart,
  Moon,
  Pause,
  Play,
  Repeat,
  Repeat1,
  RotateCcw,
  RotateCw,
  Shuffle,
  SlidersHorizontal,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { formatTime, sleepLabel } from "@amp/core";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { useUiStore } from "../../store/useUiStore";
import { useLibraryStore } from "../../store/useLibraryStore";

export function TransportControls({ compact = false }: { compact?: boolean }) {
  const { state, toggle, nextChapter, prevChapter, skip } = usePlayerStore();
  const settings = useSettingsStore((s) => s.settings);
  const book = usePlayerStore((s) => s.book);
  const addBookmark = usePlayerStore((s) => s.addBookmark);
  const toast = useUiStore((s) => s.toast);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <Button
        size="small"
        variant="ghost"
        icon={RotateCcw}
        onClick={() => skip(-settings.playback.skipBackSeconds)}
        attributes={{ "aria-label": `Back ${settings.playback.skipBackSeconds}s` }}
      />
      <Button size="small" variant="ghost" icon={SkipBack} onClick={() => void prevChapter()} attributes={{ "aria-label": "Previous chapter" }} />
      <Button
        size={compact ? "small" : "medium"}
        variant="solid"
        color="primary"
        rounded
        icon={state.playing ? Pause : Play}
        onClick={() => void toggle()}
        attributes={{ "aria-label": state.playing ? "Pause" : "Play" }}
      />
      <Button size="small" variant="ghost" icon={SkipForward} onClick={() => void nextChapter()} attributes={{ "aria-label": "Next chapter" }} />
      <Button
        size="small"
        variant="ghost"
        icon={RotateCw}
        onClick={() => skip(settings.playback.skipSeconds)}
        attributes={{ "aria-label": `Forward ${settings.playback.skipSeconds}s` }}
      />
      <Button
        size="small"
        variant="ghost"
        icon={Bookmark}
        onClick={() =>
          void addBookmark().then(() => toast({ title: `Bookmarked ${book ? formatTime(state.position) : ""}`, tone: "success" }))
        }
        attributes={{ "aria-label": "Bookmark", title: "Bookmark this spot" }}
      />
    </div>
  );
}

export function SpeedControl({ compact = false }: { compact?: boolean } = {}) {
  const speed = usePlayerStore((s) => s.state.speed);
  const setSpeed = usePlayerStore((s) => s.setSpeed);

  return (
    <div className="amp-slim-control" title={`Playback speed ${speed}x`}>
      <Gauge size={15} style={{ opacity: 0.65 }} />
      <Slider
        name="speed"
        min={0.5}
        max={3}
        step={0.05}
        value={speed}
        onChange={({ value }) => setSpeed(Number(value.toFixed(2)))}
        attributes={{ style: { width: compact ? 76 : 116 }, "aria-label": "Playback speed" }}
      />
      <Text variant="caption-2" numeric color="neutral-faded">
        {speed}x
      </Text>
    </div>
  );
}

export function VolumeControl({ compact = false }: { compact?: boolean }) {
  const volume = usePlayerStore((s) => s.state.volume);
  const muted = usePlayerStore((s) => s.state.muted);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const Icon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: compact ? 110 : 160 }}>
      <Button size="small" variant="ghost" icon={Icon} onClick={toggleMute} attributes={{ "aria-label": "Mute" }} />
      <Slider
        name="volume"
        min={0}
        max={1.5}
        step={0.01}
        value={muted ? 0 : volume}
        onChange={({ value }) => {
          if (value === 0) toggleMute();
          else setVolume(value);
        }}
        attributes={{ style: { width: compact ? 70 : 120 } }}
      />
      {!compact && (
        <Text variant="caption-2" numeric color="neutral-faded">
          {Math.round((muted ? 0 : volume) * 100)}%
        </Text>
      )}
    </div>
  );
}

export function ToggleRow({ compact = false }: { compact?: boolean }) {
  const repeat = usePlayerStore((s) => s.state.repeat);
  const shuffle = usePlayerStore((s) => s.state.shuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const sleepRemaining = usePlayerStore((s) => s.state.sleepRemaining);
  const openDialog = useUiStore((s) => s.openDialog);
  const eqEnabled = useSettingsStore((s) => s.settings.equalizer.enabled);
  const update = useSettingsStore((s) => s.update);
  const book = usePlayerStore((s) => s.book);
  const favorite = useLibraryStore((s) => (book ? s.state.books.find((b) => b.id === book.id)?.favorite : false));
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
      <Button
        size="small"
        variant={shuffle ? "solid" : "ghost"}
        color={shuffle ? "primary" : "neutral"}
        icon={Shuffle}
        onClick={toggleShuffle}
        attributes={{ "aria-label": "Shuffle" }}
      />
      <Button
        size="small"
        variant={repeat !== "off" ? "solid" : "ghost"}
        color={repeat !== "off" ? "primary" : "neutral"}
        icon={repeat === "chapter" ? Repeat1 : Repeat}
        onClick={cycleRepeat}
        attributes={{ "aria-label": `Repeat: ${repeat}` }}
      />
      {!compact && (
        <Button
          size="small"
          variant="ghost"
          icon={SlidersHorizontal}
          highlighted={eqEnabled}
          onClick={() => void update({ equalizer: { enabled: !eqEnabled } })}
          attributes={{ "aria-label": "Equalizer" }}
        />
      )}
      <Button
        size="small"
        variant={sleepRemaining !== null ? "solid" : "ghost"}
        color={sleepRemaining !== null ? "primary" : "neutral"}
        icon={Moon}
        onClick={() => openDialog({ kind: "sleep" })}
        attributes={{ "aria-label": "Sleep timer" }}
      >
        {sleepRemaining !== null ? sleepLabel(sleepRemaining) : undefined}
      </Button>
      {book && (
        <Button
          size="small"
          variant="ghost"
          icon={Heart}
          highlighted={Boolean(favorite)}
          onClick={() => void toggleFavorite(book.id)}
          attributes={{ "aria-label": "Favourite" }}
        />
      )}
    </div>
  );
}
