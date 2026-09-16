/**
 * The wide artwork card used on Home and New.
 *
 * Cover art fills the card, the caption sits on it over a scrim: title, one
 * line of metadata, and whatever action applies (play, resume, download). The
 * scrim is driven by the theme, never by a literal colour.
 */

import { Play, Pause } from "lucide-react";

export function HeroCard({
  art,
  title,
  meta,
  progress,
  playing,
  onOpen,
  onPlay,
  action,
}: {
  art: React.ReactNode;
  title: string;
  meta: string;
  /** 0..1, drawn as a hairline under the caption. */
  progress?: number;
  playing?: boolean;
  onOpen?: () => void;
  onPlay?: () => void;
  action?: React.ReactNode;
}) {
  return (
    <div className="amp-feature">
      <button type="button" className="amp-feature-art" onClick={onOpen ?? onPlay} aria-label={title}>
        {art}
        <span className="amp-feature-scrim" aria-hidden />
        <span className="amp-feature-text">
          <span className="amp-feature-title">{title}</span>
          <span className="amp-feature-meta">{meta}</span>
        </span>
        {progress !== undefined && (
          <span className="amp-feature-progress" aria-hidden>
            <span style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }} />
          </span>
        )}
      </button>
      <div className="amp-feature-actions">
        {onPlay && (
          <button type="button" className="amp-chip" data-active onClick={onPlay}>
            {playing ? <Pause size={14} /> : <Play size={14} />}
            {playing ? "Pause" : progress && progress > 0 ? "Resume" : "Play"}
          </button>
        )}
        {action}
      </div>
    </div>
  );
}

export function heroMeta(parts: Array<string | number | undefined | null>): string {
  return parts.filter((part): part is string | number => part !== undefined && part !== null && part !== "").join(" - ");
}
