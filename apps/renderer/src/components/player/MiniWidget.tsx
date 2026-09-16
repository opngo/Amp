/**
 * The resizable mini widget: a narrow portrait window with just the cover,
 * visualizer, scrubber and transport - designed to sit in a corner of the
 * screen while you work. Toggle with Ctrl+Shift+M from anywhere.
 */

import { useEffect } from "react";
import { Button, Text } from "reshaped";
import { ChevronDown, ListMusic, Moon, Pause, Play, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { bookProgress, formatTime } from "@amp/core";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { useUiStore } from "../../store/useUiStore";
import { CoverArt } from "../common/CoverArt";
import { MarqueeText } from "../common/MarqueeText";
import { ChapterSelect } from "./ChapterSelect";
import { Waveform } from "../common/Waveform";
import { Scrubber } from "./Scrubber";
import { getBridge } from "../../platform/bridge";

export function MiniWidget({ onExpand }: { onExpand: () => void }) {
  const book = usePlayerStore((s) => s.book);
  const state = usePlayerStore((s) => s.state);
  const toggle = usePlayerStore((s) => s.toggle);
  const nextChapter = usePlayerStore((s) => s.nextChapter);
  const prevChapter = usePlayerStore((s) => s.prevChapter);
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const setRoute = useUiStore((s) => s.setRoute);

  // Remember the widget size so it reopens the way the user left it.
  useEffect(() => {
    const host = window.amp;
    if (!host) return;
    void host.player.setMiniSize(settings.window.miniSize);
    void host.player.setAlwaysOnTop(settings.window.widgetAlwaysOnTop);
    void host.player.setMini(true);
  }, [settings.window.miniSize, settings.window.widgetAlwaysOnTop]);

  if (!book) {
    return (
      <div className="amp-mini" style={{ justifyContent: "center", alignItems: "center" }}>
        <Text variant="body-2" color="neutral-faded">
          Nothing playing yet
        </Text>
        <Button variant="outline" onClick={onExpand}>
          Back to the library
        </Button>
      </div>
    );
  }

  return (
    <div className="amp-mini">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--amp-accent)" }}>
          <Waveform active={state.playing} bars={4} height={14} />
          <Text variant="caption-1" color="neutral-faded">
            Amp
          </Text>
        </span>
        <div style={{ display: "flex", gap: 2 }}>
          <Button
            size="small"
            variant="ghost"
            icon={ListMusic}
            onClick={() => {
              void getBridge().then(() => onExpand());
              setRoute("queue");
            }}
            attributes={{ "aria-label": "Queue" }}
          />
          <Button
            size="small"
            variant="ghost"
            icon={Moon}
            highlighted={state.sleepRemaining !== null}
            onClick={() => useUiStore.getState().openDialog({ kind: "sleep" })}
            attributes={{ "aria-label": "Sleep timer" }}
          />
          <Button size="small" variant="ghost" icon={ChevronDown} onClick={onExpand} attributes={{ "aria-label": "Expand" }} />
        </div>
      </div>

      <CoverArt book={book} interactive />

      <div style={{ display: "grid", gap: 2, textAlign: "center" }}>
        <MarqueeText text={book.title} className="amp-no-drag" />
        <Text variant="caption-1" color="neutral-faded" maxLines={1}>
          {book.author}
        </Text>
      </div>

      <Scrubber />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        <Button size="small" variant="ghost" icon={SkipBack} onClick={() => void prevChapter()} attributes={{ "aria-label": "Previous chapter" }} />
        <Button
          variant="solid"
          color="primary"
          rounded
          icon={state.playing ? Pause : Play}
          onClick={() => void toggle()}
          attributes={{ "aria-label": state.playing ? "Pause" : "Play" }}
        />
        <Button size="small" variant="ghost" icon={SkipForward} onClick={() => void nextChapter()} attributes={{ "aria-label": "Next chapter" }} />
      </div>

      <ChapterSelect compact />

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Volume2 size={13} style={{ opacity: 0.6 }} />
        <input
          type="range"
          min={0}
          max={1.5}
          step={0.01}
          value={state.muted ? 0 : state.volume}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (value === 0) usePlayerStore.getState().toggleMute();
            else usePlayerStore.getState().setVolume(value);
          }}
          style={{ flex: 1, accentColor: "var(--amp-accent)" }}
          aria-label="Volume"
        />
        <Text variant="caption-2" numeric color="neutral-faded">
          {formatTime(state.position)}
        </Text>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Text variant="caption-2" color="neutral-faded">
          {Math.round(bookProgress(book) * 100)}% of the book
        </Text>
        <Button
          size="small"
          variant="ghost"
          onClick={() => void update({ window: { widgetAlwaysOnTop: !settings.window.widgetAlwaysOnTop } })}
        >
          {settings.window.widgetAlwaysOnTop ? "Always on top: on" : "Always on top: off"}
        </Button>
      </div>
    </div>
  );
}
