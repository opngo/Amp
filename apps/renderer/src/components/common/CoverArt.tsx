/**
 * Cover art with a generated fallback, optional glow ring, and an
 * `interactive` prop for the parallax tilt used on the now-playing stage.
 */

import { useMemo, useRef, useState } from "react";
import type { Book } from "@amp/core";
import { useEmbeddedCover } from "../../platform/artwork";

export function initialsOf(title: string): string {
  const words = title.split(/\s+/).filter((w) => w.length > 2);
  const letters = (words.length >= 2 ? [words[0], words[1]] : [words[0] ?? title])
    .map((w) => w?.[0]?.toUpperCase() ?? "")
    .join("");
  return letters || "AB";
}

interface CoverArtProps {
  book: Pick<Book, "id" | "title" | "author" | "coverDataUrl" | "coverPath" | "coverUrl">;
  size?: number | string;
  glow?: number;
  interactive?: boolean;
  onClick?: () => void;
  className?: string;
  /** Rendered inside the cover (used for the mini "now playing" badge). */
  children?: React.ReactNode;
}

export function CoverArt({
  book,
  size,
  glow,
  interactive = false,
  onClick,
  className,
  children,
}: CoverArtProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [failed, setFailed] = useState(false);
  // The embedded cover from the audio file is the default: a picked one wins,
  // and an empty book asks the host once and remembers the answer.
  const resolved = useEmbeddedCover(book);
  const src = failed ? null : resolved;
  const initials = useMemo(() => initialsOf(book.title), [book.title]);

  const onMove = (event: React.MouseEvent) => {
    if (!interactive || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    ref.current.style.transform = `perspective(900px) rotateY(${x * 8}deg) rotateX(${-y * 8}deg) translateY(-2px)`;
  };

  const reset = () => {
    setHover(false);
    if (ref.current) ref.current.style.transform = "";
  };

  return (
    <div
      ref={ref}
      className={className ? `amp-cover ${className}` : "amp-cover"}
      data-hover={hover}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseMove={onMove}
      onMouseLeave={reset}
      style={{
        width: size,
        height: size,
        boxShadow:
          glow !== undefined
            ? `0 0 ${Math.round(60 * glow)}px color-mix(in srgb, var(--amp-tint) ${Math.round(glow * 60)}%, transparent)`
            : undefined,
      }}
    >
      {src ? (
        <img
          src={src}
          alt={`${book.title} cover`}
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="amp-cover-fallback" aria-hidden>
          {initials}
        </div>
      )}
      {children}
    </div>
  );
}
