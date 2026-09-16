/** Canvas host for the visualizer. Mode/lines/etc come straight from settings. */

import { useRef } from "react";
import type { Settings } from "@amp/core";
import { useVisualizer } from "../../hooks/useVisualizer";
import { DEFAULT_VISUALIZER, type VisualizerConfig } from "../../audio/visualizer";

export function VisualizerCanvas({
  settings,
  coverRef,
  color,
  colorAlt,
  className = "amp-visualizer",
}: {
  settings: Settings;
  coverRef?: React.RefObject<HTMLElement | null>;
  color?: string;
  colorAlt?: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const config: VisualizerConfig = {
    ...DEFAULT_VISUALIZER,
    mode: settings.visualizer.mode,
    lines: settings.visualizer.lines,
    sensitivity: settings.visualizer.sensitivity,
    thickness: settings.visualizer.thickness,
    spacing: settings.visualizer.spacing,
    smooth: settings.visualizer.smooth,
    glow: settings.visualizer.glow,
    mirror: settings.visualizer.mirror,
    opacity: settings.visualizer.opacity,
    color: color ?? "var(--amp-accent)",
    colorAlt: colorAlt ?? "var(--amp-accent-3)",
  };

  useVisualizer(canvasRef, { config, coverRef });

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}
