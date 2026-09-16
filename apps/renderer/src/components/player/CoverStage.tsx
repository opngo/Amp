/**
 * The now playing stage: cover art with the outline/radial visualizer traced
 * around it, glow, parallax and an optional progress ring.
 */

import { useEffect, useRef, useState } from "react";
import { Text } from "reshaped";
import { formatTime } from "@amp/core";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { CoverArt } from "../common/CoverArt";
import { VisualizerCanvas } from "./VisualizerCanvas";

/**
 * Cover art size for the current window.
 *
 * The stage is the tallest thing on the now playing screen and it is the only
 * part that can give: everything under it (title, scrubber, transport) is fixed
 * furniture. Capping the cover to the window height keeps those controls above
 * the fold instead of hiding them behind the player bar.
 */
function stageSize(maxSize: number, reserve: number): number {
  if (typeof window === "undefined") return maxSize;
  // Everything around the cover - the window chrome, the title, the scrubber,
  // the transport, the player bar - is fixed furniture; the cover gets what is
  // left. In the player bar that is a lot, on the immersive player much less,
  // which is why the caller passes its own number.
  return Math.round(Math.min(maxSize, Math.max(150, window.innerHeight - reserve)));
}

export function CoverStage({
  maxSize = 320,
  reserve = 690,
  caption = true,
  visualizer = true,
}: {
  maxSize?: number;
  reserve?: number;
  /** The immersive player prints its own readout, so it hides this one. */
  caption?: boolean;
  /**
   * False when the caller draws the visualizer itself. The shapes that wrap the
   * artwork (the ring, the halo) belong here, around the cover; the ones that
   * stand on a baseline get a band of their own instead of being laid over the
   * transport, and the caller is the one that knows which is which.
   */
  visualizer?: boolean;
}) {
  const [size, setSize] = useState(() => stageSize(maxSize, reserve));
  const settings = useSettingsStore((s) => s.settings);
  const palette = useSettingsStore((s) => s.palette);
  const book = usePlayerStore((s) => s.book);
  const chapter = usePlayerStore((s) => s.currentChapter());
  const position = usePlayerStore((s) => s.state.position);
  const coverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => setSize(stageSize(maxSize, reserve));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [maxSize, reserve]);

  if (!book) return null;

  return (
    <div className="amp-stage" style={{ padding: 26, position: "relative" }}>
      {visualizer ? (
        <VisualizerCanvas
          settings={settings}
          coverRef={coverRef}
          color={palette?.primary}
          colorAlt={palette?.accent}
        />
      ) : null}
      <div ref={coverRef} style={{ width: size, maxWidth: "100%" }}>
        <CoverArt book={book} interactive glow={settings.cover.glow} />
      </div>
      {/* The outline visualizer draws a little outside the cover, so the
          caption sits well clear of it instead of inside the glow. */}
      {caption ? (
        <div style={{ display: "grid", justifyItems: "center", gap: 3, marginTop: 30 }}>
          {chapter ? (
            <Text variant="caption-2" color="neutral-faded" numeric>
              {`Chapter ${chapter.index} of ${book.chapters.length} - ${formatTime(position)} elapsed`}
            </Text>
          ) : (
            <Text variant="caption-2" color="neutral-faded" numeric>
              {`${formatTime(position)} elapsed`}
            </Text>
          )}
        </div>
      ) : null}
    </div>
  );
}
