import { useEffect, useRef } from "react";

export type VisualizerMode = "bars" | "wave" | "outline" | "mirror" | "radial" | "off";

export interface VisualizerSettings {
  mode: VisualizerMode;
  /** How many concentric outlines / stacked waves to draw. */
  lines: number;
  sensitivity: number;
  thickness: number;
  spacing: number;
  smooth: number;
  glow: boolean;
  mirror: boolean;
  color: string;
  colorAlt: string;
}

export interface VisualizerCanvasProps {
  /** Frequency data 0..1, already scaled by the audio analyser. */
  data: Uint8Array | number[];
  settings: VisualizerSettings;
  width: number;
  height: number;
  /** Optional cover rectangle so the outline mode can hug the artwork. */
  coverRect?: { x: number; y: number; width: number; height: number } | null;
  className?: string;
}

function barHeight(value: number, index: number, count: number, sensitivity: number): number {
  const taper = 1 - Math.abs(index / count - 0.5) * 0.6;
  return Math.max(2, Math.min(1, (value / 255) * sensitivity) * taper);
}

/**
 * The visualizer used by both the desktop app and the website: one canvas, six
 * modes, no dependencies. It draws a single frame per render, so callers keep
 * the requestAnimationFrame loop (see the renderer's useVisualizer hook).
 */
export function VisualizerCanvas({
  data,
  settings,
  width,
  height,
  coverRect,
  className,
}: VisualizerCanvasProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || settings.mode === "off") return;
    const dpr = typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const gradient = ctx.createLinearGradient(0, height, width, 0);
    gradient.addColorStop(0, settings.color);
    gradient.addColorStop(1, settings.colorAlt);
    ctx.strokeStyle = gradient;
    ctx.fillStyle = gradient;
    ctx.lineWidth = settings.thickness;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (settings.glow) {
      ctx.shadowColor = settings.color;
      ctx.shadowBlur = settings.thickness * 4;
    }

    const count = data.length;
    if (count === 0) return;

    if (settings.mode === "bars" || settings.mode === "mirror") {
      const barWidth = width / count;
      for (let i = 0; i < count; i += 1) {
        const value = barHeight(data[i], i, count, settings.sensitivity);
        const barHeightPx = value * height * (settings.mode === "mirror" ? 0.5 : 0.9);
        const x = i * barWidth;
        ctx.globalAlpha = 0.55 + 0.45 * value;
        ctx.fillRect(x + barWidth * 0.18, height - barHeightPx, barWidth * 0.64, barHeightPx);
        if (settings.mode === "mirror") {
          ctx.globalAlpha *= 0.6;
          ctx.fillRect(x + barWidth * 0.18, 0, barWidth * 0.64, barHeightPx);
        }
      }
      ctx.globalAlpha = 1;
      return;
    }

    const lines = Math.max(1, settings.lines);
    for (let line = 0; line < lines; line += 1) {
      const inset = line * settings.spacing;
      const rect = coverRect
        ? {
            x: coverRect.x - inset,
            y: coverRect.y - inset,
            width: coverRect.width + inset * 2,
            height: coverRect.height + inset * 2,
          }
        : { x: inset, y: inset, width: width - inset * 2, height: height - inset * 2 };

      if (settings.mode === "outline") {
        const amp = barHeight(data[Math.floor((count * (line + 1)) / (lines + 1))], line, lines, settings.sensitivity);
        const offset = amp * 14;
        ctx.beginPath();
        ctx.roundRect(
          rect.x + offset * 0.4,
          rect.y + offset * 0.4,
          Math.max(4, rect.width - offset * 0.8),
          Math.max(4, rect.height - offset * 0.8),
          Math.min(28, rect.width * 0.08),
        );
        ctx.globalAlpha = 0.9 - line * 0.18;
        ctx.stroke();
        continue;
      }

      // wave / radial
      ctx.beginPath();
      const points = 128;
      const centerX = rect.x + rect.width / 2;
      const centerY = rect.y + rect.height / 2;
      for (let i = 0; i <= points; i += 1) {
        const t = i / points;
        const value = data[Math.floor(t * (count - 1))] ?? 0;
        const amp = ((value / 255) * settings.sensitivity * rect.height) / 6;
        if (settings.mode === "radial") {
          const angle = t * Math.PI * 2 - Math.PI / 2;
          const radiusX = rect.width / 2 + amp;
          const radiusY = rect.height / 2 + amp;
          const x = centerX + Math.cos(angle) * radiusX;
          const y = centerY + Math.sin(angle) * radiusY;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        } else {
          const x = rect.x + t * rect.width;
          const y = centerY + Math.sin(t * Math.PI * 2 + line) * amp;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.globalAlpha = 0.85 - line * 0.16;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }, [data, settings, width, height, coverRect]);

  return <canvas ref={ref} className={className} style={{ width, height }} aria-hidden />;
}
