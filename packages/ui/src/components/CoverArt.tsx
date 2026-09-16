import { Music4 } from "lucide-react";
import type { CSSProperties } from "react";

/**
 * Square cover art with a graceful fallback.
 *
 * Every cover in Amp is square: the audio file's embedded art, a downloaded
 * image, or the generated gradient placeholder that matches the book's
 * adaptive palette.
 */
export interface CoverArtProps {
  src?: string | null;
  alt: string;
  /** CSS size for the square, e.g. "52px" or "100%". */
  size?: string | number;
  radius?: number;
  /** Two colours used for the placeholder gradient (from the cover palette). */
  colorA?: string;
  colorB?: string;
  className?: string;
  style?: CSSProperties;
}

export function CoverArt({
  src,
  alt,
  size = "100%",
  radius = 8,
  colorA = "#6c8cff",
  colorB = "#ff9ecb",
  className,
  style,
}: CoverArtProps) {
  const box: CSSProperties = {
    width: typeof size === "number" ? `${size}px` : size,
    aspectRatio: "1 / 1",
    borderRadius: radius,
    overflow: "hidden",
    position: "relative",
    flex: "0 0 auto",
    background: `linear-gradient(140deg, ${colorA}, ${colorB})`,
    ...style,
  };

  if (!src) {
    return (
      <div className={className} style={box} role="img" aria-label={alt}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            color: "rgba(255,255,255,0.82)",
          }}
        >
          <Music4 size="38%" aria-hidden />
        </div>
      </div>
    );
  }

  return (
    <div className={className} style={box}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    </div>
  );
}
