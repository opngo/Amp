/**
 * The visualizer.
 *
 * Six shapes, all drawn from the same analysed spectrum:
 *
 *   wave    - one smooth line that moves with the voice, the old Siri gesture.
 *   bars    - classic spectrum bars, with peak caps and an optional reflection.
 *   mirror  - the same bars mirrored around a centre line.
 *   cover   - the signature: rings riding the cover's own rounded rectangle,
 *             the outermost ones fading out steeply as they move away.
 *   aurora  - layered ribbons drifting over each other, the softest shape.
 *   orbit   - the spectrum bent into a halo, turning slowly.
 *
 * Everything is parametric (line count, thickness, spacing, sensitivity,
 * smoothing, glow strength, decay, drift) and every colour comes from the
 * cover palette, so the drawing never introduces a colour of its own.
 *
 * Motion that is not audio - the drift of a ribbon, the turn of the halo, the
 * travelling highlight on the ring - reads `state.time`, which keeps every
 * frame reproducible from the same inputs and lets the drawing stay alive at
 * low volume without inventing levels that were never measured.
 */

import type { Settings } from "@amp/core";

/** The visualizer half of the settings object. */
export type VisualizerSettings = Settings["visualizer"];

export interface CoverRect {
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number;
}

export interface VisualizerConfig extends VisualizerSettings {
  color: string;
  colorAlt: string;
}

export type VisualizerMode = "wave" | "bars" | "mirror" | "cover" | "aurora" | "orbit" | "off";

/** #rrggbb + alpha, or the colour passed through when it is not hex. */
export function withAlpha(hex: string, alpha: number): string {
  const value = hex.trim();
  if (!value.startsWith("#")) return value;
  const short = value.length === 4;
  const r = parseInt(short ? value[1] + value[1] : value.slice(1, 3), 16);
  const g = parseInt(short ? value[2] + value[2] : value.slice(3, 5), 16);
  const b = parseInt(short ? value[3] + value[3] : value.slice(5, 7), 16);
  if ([r, g, b].some((part) => Number.isNaN(part))) return value;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

/** Moves a colour slightly per line so stacked lines read as a gradient. */
export function hslShift(base: string, line: number, total: number, alt?: string): string {
  if (total <= 1) return base;
  if (alt && line === total - 1) return alt;
  const mix = line / Math.max(1, total - 1);
  if (!base.startsWith("#") || base.length < 7) return base;
  const r = parseInt(base.slice(1, 3), 16);
  const g = parseInt(base.slice(3, 5), 16);
  const b = parseInt(base.slice(5, 7), 16);
  const toward = alt && alt.startsWith("#") && alt.length >= 7 ? alt : base;
  const tr = parseInt(toward.slice(1, 3), 16);
  const tg = parseInt(toward.slice(3, 5), 16);
  const tb = parseInt(toward.slice(5, 7), 16);
  const lerp = (a: number, c: number) => Math.round(a + (c - a) * mix);
  return `#${[lerp(r, tr), lerp(g, tg), lerp(b, tb)]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Two hex colours into one, for gradients that have to be built by hand. */
export function mixColor(a: string, b: string, amount: number): string {
  if (!a.startsWith("#") || !b.startsWith("#") || a.length < 7 || b.length < 7) return a;
  const mix = Math.max(0, Math.min(1, amount));
  const part = (offset: number) =>
    Math.round(
      parseInt(a.slice(offset, offset + 2), 16) +
        (parseInt(b.slice(offset, offset + 2), 16) - parseInt(a.slice(offset, offset + 2), 16)) * mix,
    );
  return `#${[part(1), part(3), part(5)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

/* ---------------------------------------------------------------------------
 * Sampling helpers: a spectrum array is coarse, the drawings are not
 * ------------------------------------------------------------------------ */

/** Smoothstep interpolation across a level array, `t` in 0..1. */
export function sampleAt(levels: Float32Array, t: number): number {
  const last = levels.length - 1;
  const x = Math.max(0, Math.min(1, t)) * last;
  const index = Math.floor(x);
  const fraction = x - index;
  const a = levels[index] ?? 0;
  const b = levels[Math.min(last, index + 1)] ?? a;
  const smooth = fraction * fraction * (3 - 2 * fraction);
  return a + (b - a) * smooth;
}

/** The same ramp folded in half: band 0 at both ends, the low end in the middle. */
export function mirroredAt(levels: Float32Array, t: number): number {
  const folded = t <= 0.5 ? t * 2 : (1 - t) * 2;
  return sampleAt(levels, folded);
}

/** A moving average over `radius` neighbours, wrapping at both ends. */
export function smoothSeries(values: number[], radius = 2): number[] {
  if (radius <= 0 || values.length === 0) return values.slice();
  return values.map((_, index) => {
    let sum = 0;
    let weight = 0;
    for (let k = -radius; k <= radius; k += 1) {
      const w = 1 - Math.abs(k) / (radius + 1);
      sum += (values[(index + k + values.length) % values.length] ?? 0) * w;
      weight += w;
    }
    return sum / Math.max(1e-6, weight);
  });
}

/**
 * How strongly line `line` of `series` shows.
 *
 * The ring around the cover stacks outward, so the decay control lives here:
 * a low decay keeps the outer rings visible as nested contours, a high decay
 * fades them out fast and leaves a single clean edge against the artwork.
 */
export function ringAlpha(line: number, series: number, decay: number): number {
  if (series <= 1) return 1;
  const exponent = 1 + Math.max(0, Math.min(100, decay)) / 33;
  return Math.pow(1 - line / series, exponent);
}

/**
 * Points around a rounded rectangle, each with the outward normal.
 *
 * The points are spread over the whole outline in proportion to how long each
 * piece is, corners included. That matters more than it sounds: the ring pushes
 * every sample away from the artwork by the level of the band sitting there, so
 * a long edge carrying only two points would draw a straight line through a
 * moving spectrum. Corners stay round because they are sampled as arcs.
 */
export function roundedRectPoints(
  rect: CoverRect,
  count: number,
): { x: number; y: number; nx: number; ny: number }[] {
  const radius = Math.max(0, Math.min(rect.radius ?? 0, Math.min(rect.width, rect.height) / 2));
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  const straight: number[] = [rect.width - radius * 2, rect.height - radius * 2];
  const arc = (Math.PI / 2) * radius;
  const perimeter = Math.max(1e-6, straight[0] * 2 + straight[1] * 2 + arc * 4);
  const points: { x: number; y: number; nx: number; ny: number }[] = [];

  /** `n` steps from one end of a segment to the other, both included. */
  const run = (n: number, at: (t: number) => { x: number; y: number; nx: number; ny: number }) => {
    for (let i = 0; i <= n; i += 1) points.push(at(i / n));
  };
  const steps = (length: number) => Math.max(1, Math.round((count * length) / perimeter));

  // top edge, left to right
  run(steps(straight[0]), (t) => ({ x: left + radius + straight[0] * t, y: top, nx: 0, ny: -1 }));
  // corner: top right
  run(steps(arc), (t) => {
    const angle = -Math.PI / 2 + (Math.PI / 2) * t;
    return {
      x: right - radius + Math.cos(angle) * radius,
      y: top + radius + Math.sin(angle) * radius,
      nx: Math.cos(angle),
      ny: Math.sin(angle),
    };
  });
  // right edge, downwards
  run(steps(straight[1]), (t) => ({ x: right, y: top + radius + straight[1] * t, nx: 1, ny: 0 }));
  // corner: bottom right
  run(steps(arc), (t) => {
    const angle = (Math.PI / 2) * t;
    return {
      x: right - radius + Math.cos(angle) * radius,
      y: bottom - radius + Math.sin(angle) * radius,
      nx: Math.cos(angle),
      ny: Math.sin(angle),
    };
  });
  // bottom edge, right to left
  run(steps(straight[0]), (t) => ({ x: right - radius - straight[0] * t, y: bottom, nx: 0, ny: 1 }));
  // corner: bottom left
  run(steps(arc), (t) => {
    const angle = Math.PI / 2 + (Math.PI / 2) * t;
    return {
      x: left + radius + Math.cos(angle) * radius,
      y: bottom - radius + Math.sin(angle) * radius,
      nx: Math.cos(angle),
      ny: Math.sin(angle),
    };
  });
  // left edge, upwards
  run(steps(straight[1]), (t) => ({ x: left, y: bottom - radius - straight[1] * t, nx: -1, ny: 0 }));
  // corner: top left, closing the loop
  run(steps(arc), (t) => {
    const angle = Math.PI + (Math.PI / 2) * t;
    return {
      x: left + radius + Math.cos(angle) * radius,
      y: top + radius + Math.sin(angle) * radius,
      nx: Math.cos(angle),
      ny: Math.sin(angle),
    };
  });

  return points;
}

/** Curves through an open run of points, ending exactly on the last sample. */
function openCurve(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[]): void {
  if (points.length < 2) return;
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length - 1; i += 1) {
    const current = points[i];
    const next = points[i + 1];
    ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
}

/**
 * The glow.
 *
 * The canvas is copied back over itself, blurred, in `lighter` mode - the same
 * trick every audio toy uses, and the reason a thin line reads as light rather
 * than paint. The copy is made with the transform reset: under a device pixel
 * ratio of 2 the transformed draw was twice the size of the canvas, which is
 * why the glow used to look like a smear instead of a halo.
 */
function bloomPass(ctx: CanvasRenderingContext2D, config: VisualizerConfig, amount = 1, inset = 0): void {
  if (!config.glow) return;
  const strength = Math.max(0, Math.min(100, config.bloom ?? 60)) / 100;
  if (strength <= 0.02) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  /*
   * The bloom is a blurred copy of the canvas drawn back over itself, and a
   * blur spreads outwards: without a clip the copy smears the drawing right up
   * to the last pixel of the canvas, where the edge cuts it off. The caller
   * passes the room it left inside the canvas, and the glow stays in it.
   */
  const blur = 2.5 + 15 * strength;
  const margin = Math.max(inset, blur);
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  if (width - margin * 2 > 4 && height - margin * 2 > 4) {
    ctx.beginPath();
    ctx.rect(margin, margin, width - margin * 2, height - margin * 2);
    ctx.clip();
  }
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = (0.14 + 0.4 * strength) * Math.max(0, Math.min(1, amount));
  ctx.filter = `blur(${blur.toFixed(1)}px)`;
  ctx.drawImage(ctx.canvas, 0, 0);
  ctx.restore();
}

function glowStrength(config: VisualizerConfig): number {
  if (!config.glow) return 0;
  return 8 + (Math.max(0, Math.min(100, config.bloom ?? 60)) / 100) * 22;
}

/**
 * How much room a shape that stands on a baseline keeps inside its canvas.
 *
 * Peaks reach the top of the box and the glow reaches the sides, so both need
 * room or the canvas edge cuts them: a line that ends in a straight cut reads
 * as a drawing that was clipped rather than one that was finished.
 */
export function baselinePad(config: VisualizerConfig): number {
  return Math.min(30, config.thickness * 1.6 + glowStrength(config) * 0.7);
}

/** Gradient from the drawing colour into the second colour, with alpha ends. */
function strokeGradient(
  ctx: CanvasRenderingContext2D,
  config: VisualizerConfig,
  from: { x: number; y: number },
  to: { x: number; y: number },
  alpha: number,
): CanvasGradient {
  const gradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
  gradient.addColorStop(0, withAlpha(config.color, alpha));
  gradient.addColorStop(0.55, withAlpha(mixColor(config.color, config.colorAlt, 0.6), alpha * 0.94));
  gradient.addColorStop(1, withAlpha(config.colorAlt, alpha * 0.8));
  return gradient;
}

/* ---------------------------------------------------------------------------
 * Bars
 * ------------------------------------------------------------------------ */

/** Spectrum bars on a baseline, or mirrored around a centre line. */
export function drawBars(
  ctx: CanvasRenderingContext2D,
  state: VisualizerState,
  config: VisualizerConfig,
  width: number,
  height: number,
): void {
  const levels = state.levels;
  const count = Math.max(8, Math.min(levels.length, Math.round(width / 9)));
  const series = Math.max(1, Math.round(config.lines));
  const gap = Math.max(1, Math.min(3, width / (count * 14)));
  const barWidth = Math.max(1, (width - gap * (count - 1)) / count);
  const radius = Math.min(barWidth / 2, Math.max(1, config.thickness * 1.1));
  ctx.clearRect(0, 0, width, height);

  const center = config.mirror ? height / 2 : height;
  const maxHeight = (config.mirror ? height / 2 : height) * 0.94;
  const top = config.mirror ? 0 : 0;

  for (let line = 0; line < series; line += 1) {
    const scale = 1 - line * 0.14;
    const alpha = (config.opacity / 100) * (1 - line * 0.2);
    const color = hslShift(config.color, line, series, config.colorAlt);
    const gradient = ctx.createLinearGradient(0, center, 0, top);
    gradient.addColorStop(0, withAlpha(color, alpha));
    gradient.addColorStop(1, withAlpha(mixColor(color, config.colorAlt, 0.75), alpha * 0.55));
    ctx.fillStyle = gradient;

    for (let i = 0; i < count; i += 1) {
      const value = sampleAt(levels, i / Math.max(1, count - 1)) * scale * config.sensitivity;
      const barHeight = Math.max(1.5, value * maxHeight - line * 2);
      const x = i * (barWidth + gap);
      ctx.beginPath();
      ctx.roundRect(x, center - barHeight, barWidth, config.mirror ? barHeight * 2 : barHeight, radius);
      ctx.fill();
    }

    // Peak caps: a thin bright line that hangs where the bar has been, then
    // falls back. They are what makes a bar meter look measured rather than
    // painted, so they are drawn in the alternate colour on purpose.
    if (config.peaks) {
      ctx.fillStyle = withAlpha(config.colorAlt, alpha * 0.85);
      const capHeight = Math.max(1.5, config.thickness * 0.7);
      for (let i = 0; i < count; i += 1) {
        const peak = sampleAt(state.peaks, i / Math.max(1, count - 1)) * scale * config.sensitivity;
        const level = sampleAt(levels, i / Math.max(1, count - 1)) * scale * config.sensitivity;
        if (peak <= level + 0.02) continue;
        const y = center - Math.min(maxHeight, peak * maxHeight) - capHeight;
        ctx.beginPath();
        ctx.roundRect(i * (barWidth + gap), y, barWidth, capHeight, capHeight / 2);
        ctx.fill();
      }
    }
  }

  // A dimmed copy of the bars below the baseline, fading out as it falls. In
  // mirror mode the shape is already symmetric, so there is nothing to reflect.
  if (config.reflection && !config.mirror) {
    const fade = ctx.createLinearGradient(0, center, 0, center + maxHeight * 0.6);
    fade.addColorStop(0, withAlpha(config.color, (config.opacity / 100) * 0.3));
    fade.addColorStop(1, withAlpha(config.color, 0));
    ctx.fillStyle = fade;
    for (let i = 0; i < count; i += 1) {
      const value = sampleAt(levels, i / Math.max(1, count - 1)) * config.sensitivity;
      const barHeight = Math.max(1.5, value * maxHeight * 0.5);
      ctx.beginPath();
      ctx.roundRect(i * (barWidth + gap), center + 2, barWidth, barHeight, radius);
      ctx.fill();
    }
  }

  bloomPass(ctx, config, 0.7, baselinePad(config));
}

/* ---------------------------------------------------------------------------
 * Wave
 * ------------------------------------------------------------------------ */

/**
 * One smooth line through the spectrum, the way a voice assistant draws a
 * listening wave: points joined by curves, no vertical edges, ends tapering
 * into the baseline. With a fill it becomes a rolling hill; with the mirror
 * switch it becomes the symmetric version of the same gesture.
 */
export function drawWave(
  ctx: CanvasRenderingContext2D,
  state: VisualizerState,
  config: VisualizerConfig,
  width: number,
  height: number,
): void {
  const count = Math.max(24, Math.round(width / 5));
  const series = Math.max(1, Math.round(config.lines));
  const mid = height / 2;
  const amplitude = height / 2 - Math.max(6, config.thickness);
  ctx.clearRect(0, 0, width, height);

  for (let line = 0; line < series; line += 1) {
    const spread = 1 - line * 0.2;
    const color = hslShift(config.color, line, series, config.colorAlt);
    const alpha = (config.opacity / 100) * (1 - line * 0.18);
    const phase = state.time * (0.12 + line * 0.05) + line * 0.14;
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i += 1) {
      const t = i / Math.max(1, count - 1);
      const raw = sampleAt(state.levels, (t + phase * 0.02) % 1);
      // A window that goes to zero at both ends: the line meets the silence.
      const taper = Math.sin(t * Math.PI);
      const wobble = 1 + 0.08 * Math.sin(state.time * 0.7 + t * 6 + line);
      const value = raw * spread * config.sensitivity * taper * wobble;
      // The band is the drawing's whole allowance: a wave at half of it reads
      // as a flat line with a shiver, which is not what anyone chose it for.
      points.push({ x: t * width, y: mid - value * amplitude * 0.92 });
    }

    if (config.fill) {
      const fill = ctx.createLinearGradient(0, mid - amplitude, 0, mid + amplitude);
      fill.addColorStop(0, withAlpha(color, alpha * 0.03));
      fill.addColorStop(0.5, withAlpha(mixColor(color, config.colorAlt, 0.5), alpha * 0.3));
      fill.addColorStop(1, withAlpha(color, alpha * 0.03));
      ctx.fillStyle = fill;
      ctx.beginPath();
      if (config.mirror) {
        // Filled between the curve and its own mirror: a leaf of light.
        const mirrored = points.map((point) => ({ x: point.x, y: mid + (mid - point.y) }));
        openCurve(ctx, points);
        openCurve(ctx, mirrored.reverse());
        ctx.closePath();
      } else {
        openCurve(ctx, points);
        ctx.lineTo(width, mid);
        ctx.lineTo(0, mid);
        ctx.closePath();
      }
      ctx.fill();
    }

    ctx.beginPath();
    ctx.lineWidth = Math.max(1, config.thickness);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = strokeGradient(ctx, config, { x: 0, y: 0 }, { x: width, y: 0 }, alpha);
    const glow = glowStrength(config);
    if (glow > 0) {
      ctx.shadowBlur = glow;
      ctx.shadowColor = withAlpha(mixColor(color, config.colorAlt, 0.5), 0.5 * (config.opacity / 100));
    }
    openCurve(ctx, points);
    if (config.mirror) {
      const mirrored = points.map((point) => ({ x: point.x, y: mid + (mid - point.y) }));
      openCurve(ctx, mirrored.reverse());
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  bloomPass(ctx, config, 0.85, baselinePad(config));
}

/* ---------------------------------------------------------------------------
 * Aurora
 * ------------------------------------------------------------------------ */

/**
 * Ribbons of light.
 *
 * Four curves read the spectrum at different offsets and drift at different
 * speeds, each filled down to a moving baseline with a gradient that ends in
 * nothing. Drawn in `lighter` mode over a wide blur, the overlaps build the
 * soft banded look of an aurora instead of four separate lines - which is why
 * this mode ignores thickness and leans on bloom.
 */
export function drawAurora(
  ctx: CanvasRenderingContext2D,
  state: VisualizerState,
  config: VisualizerConfig,
  width: number,
  height: number,
): void {
  const ribbons = Math.max(3, Math.round(config.lines) + 2);
  const count = Math.max(28, Math.round(width / 12));
  const mid = height / 2;
  ctx.clearRect(0, 0, width, height);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let line = 0; line < ribbons; line += 1) {
    const t = ribbons <= 1 ? 0 : line / (ribbons - 1);
    const color = hslShift(config.color, line, ribbons, config.colorAlt);
    const alpha = (config.opacity / 100) * (0.1 + 0.16 * (1 - t));
    const drift = state.time * (0.05 + t * 0.07);
    const lift = (t - 0.5) * height * 0.42;
    const span = height * (0.16 + 0.1 * (1 - t));
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i += 1) {
      const x = i / Math.max(1, count - 1);
      const band = sampleAt(state.levels, (x + drift * 0.06 + t * 0.3) % 1) * config.sensitivity;
      const taper = Math.sin(x * Math.PI) ** 0.7;
      const wave =
        Math.sin(x * 4.2 + state.time * (0.28 + t * 0.16) + line) * 0.16 +
        Math.sin(x * 9.4 - state.time * 0.19 + line * 0.8) * 0.07;
      points.push({
        x: x * width,
        y: mid + lift + (wave - band * 0.7 * taper) * span * 2,
      });
    }

    // The ribbon body: a gradient from the line down to its baseline, which is
    // the part that reads as light rather than as a stroke.
    const lowest = Math.max(...points.map((point) => point.y)) + span * 0.4;
    const fill = ctx.createLinearGradient(0, mid + lift - span, 0, lowest);
    fill.addColorStop(0, withAlpha(mixColor(color, config.colorAlt, 0.4), alpha * 0.05));
    fill.addColorStop(0.45, withAlpha(color, alpha * 0.85));
    fill.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = fill;
    ctx.beginPath();
    openCurve(ctx, points);
    ctx.lineTo(width, lowest);
    ctx.lineTo(0, lowest);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.lineWidth = Math.max(1, config.thickness * 0.8);
    ctx.lineCap = "round";
    ctx.strokeStyle = withAlpha(mixColor(color, "#ffffff", 0.18), alpha * 1.5);
    ctx.shadowBlur = glowStrength(config) * 1.6;
    ctx.shadowColor = withAlpha(color, 0.6 * (config.opacity / 100));
    openCurve(ctx, points);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.restore();

  bloomPass(ctx, config, 1, baselinePad(config));
}

/* ---------------------------------------------------------------------------
 * Orbit
 * ------------------------------------------------------------------------ */

/**
 * The spectrum bent into a halo around the centre of the canvas: radial bars
 * with rounded ends, mirrored so the halo reads left/right symmetric, turning
 * at the speed set by the rotation control, with the outer rings fading the
 * further they sit from the middle.
 */
export function drawOrbit(
  ctx: CanvasRenderingContext2D,
  state: VisualizerState,
  config: VisualizerConfig,
  width: number,
  height: number,
  rect?: CoverRect | null,
): void {
  const series = Math.max(1, Math.round(config.lines));
  const min = Math.min(width, height);
  /*
   * Around the cover, not around the canvas.
   *
   * The canvas is a rectangle with the cover somewhere inside it, so a halo
   * centred on the canvas drifts off the artwork - on a wide window it sweeps
   * across whatever else shares the screen. With the cover's bounds in hand the
   * spokes start at its corner and reach outwards from there.
   */
  const framed = rect && rect.width > 0;
  const cx = framed ? rect.x + rect.width / 2 : width / 2;
  const cy = framed ? rect.y + rect.height / 2 : height / 2;
  const coverReach = framed ? Math.hypot(rect.width, rect.height) / 2 : 0;
  const spokes = Math.max(48, Math.min(220, Math.round(min / 3)));
  const scale = Math.max(1, Math.abs(ctx.getTransform().a) || 1);
  const boxReach =
    Math.min(ctx.canvas.width / scale, ctx.canvas.height / scale) / 2 -
    (config.thickness + glowStrength(config) * 0.5 + 4);
  const inner = framed ? coverReach + config.spacing * 0.4 : min * 0.24;
  // The spokes grow outwards from wherever they start, so the reach is what is
  // left between there and the canvas edge: a spoke that runs off the box is a
  // line with no end, which is not a halo.
  const room = Math.max(6, boxReach - inner - config.spacing * 0.5 * (series - 1));
  const reach = framed
    ? Math.max(6, Math.min(Math.min(coverReach * 0.55, width * 0.12), room))
    : Math.max(6, Math.min(min * 0.3, room));
  const spin = state.time * (config.rotation / 100) * 0.55;
  ctx.clearRect(0, 0, width, height);

  for (let line = 0; line < series; line += 1) {
    const offset = config.spacing * 0.5 * line;
    const color = hslShift(config.color, line, series, config.colorAlt);
    const alpha = (config.opacity / 100) * ringAlpha(line, series, config.decay);
    ctx.lineWidth = Math.max(1, config.thickness) * (1 - line * 0.12);
    ctx.lineCap = "round";
    ctx.strokeStyle = withAlpha(color, alpha);
    const glow = glowStrength(config);
    for (let i = 0; i < spokes; i += 1) {
      const around = i / spokes;
      const angle = around * Math.PI * 2 + spin * (1 - line * 0.12);
      const level = mirroredAt(state.levels, around) * config.sensitivity;
      const length = Math.max(1.5, level * reach * (1 - line * 0.12));
      const start = inner + offset;
      const x1 = cx + Math.cos(angle) * start;
      const y1 = cy + Math.sin(angle) * start;
      const x2 = cx + Math.cos(angle) * (start + length);
      const y2 = cy + Math.sin(angle) * (start + length);
      ctx.beginPath();
      if (glow > 0) {
        ctx.shadowBlur = glow;
        ctx.shadowColor = withAlpha(color, 0.4 * (config.opacity / 100));
      }
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // A single hairline orbit: without it the bars float, with it they read as
    // a ring that happens to be loud.
    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = withAlpha(color, alpha * 0.35);
    ctx.arc(cx, cy, inner + offset, 0, Math.PI * 2);
    ctx.stroke();
  }

  bloomPass(ctx, config, 0.9);
}

/* ---------------------------------------------------------------------------
 * The ring around the cover
 * ------------------------------------------------------------------------ */

/**
 * The signature mode: rings of sound drawn as circles around the cover.
 *
 * These used to be outlines that followed the artwork's own rounded rectangle,
 * and every point was pushed along the outline's normal. On a square cover that
 * reads as a lens - an oval that grows corners at the edges - and the loudest
 * parts of the spectrum threw points sideways instead of outward. Circles are
 * what the shape wants to be: the artwork is the middle of a pond, the spectrum
 * is the ripple, and the ripple is the same distance away in every direction.
 * The first circle clears the cover's corners; each ring past it steps outward
 * with less alpha, so the drawing fades into the page instead of framing it.
 *
 * Nothing in here pulses. The rings move because the audio moves, and stop when
 * it stops; no value depends on the clock.
 */
/**
 * Circles around the cover.
 *
 * The shape the listener asked for: concentric rings centred on the artwork,
 * marching outwards with the voice. Every ring is a real circle - the radius is
 * modulated per angle, so the ring breathes outwards where the spectrum is loud
 * and sits still where it is quiet - and nothing here moves on a timer of its
 * own. There used to be a sine term riding the radius and a highlight chasing
 * each ring: between them the rings pulsed whether or not audio was playing,
 * which is the "oval wave that never stops" this replaced. A ring moved by the
 * audio alone is the point of a visualizer; a ring moved by the clock is just
 * an animation.
 *
 * The innermost circle clears the cover's corners - half the diagonal, not half
 * the width - or the ring would cut through the artwork on a square cover. If
 * the outermost ring would be wider than the canvas, the whole set is scaled to
 * fit: a ring clipped by its own box stops being a circle.
 */
export function drawCoverRing(
  ctx: CanvasRenderingContext2D,
  state: VisualizerState,
  config: VisualizerConfig,
  rect: CoverRect,
  maxPush = 30,
): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const series = Math.max(1, Math.round(config.lines));
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  /*
   * A circle that sits around a square cover has to clear its corners, and the
   * corners of this interface are rounded by 22 percent - so the tip of a corner
   * is 0.62 of the cover's width from the centre, not the 0.71 of a sharp one.
   * Sizing the innermost circle there keeps the rings close to the artwork
   * instead of floating a diagonal away from it.
   */
  const coverReach = Math.max(rect.width, rect.height) * 0.62;
  // A push that reads as a halo around a 380px cover is a blob around a 116px
  // one (the compact flyout), so the reach follows the artwork.
  const reach = Math.max(8, Math.min(maxPush, rect.width * 0.1));
  const samples = 180;
  const step = Math.max(6, config.spacing * 0.9);
  const glow = glowStrength(config);

  /*
   * Fit the whole set into the canvas.
   *
   * The canvas is scaled for the device pixel ratio by the host, so the box the
   * circles have to live in is the canvas' size in *CSS* pixels - the backing
   * store is dpr times larger. Reading the backing store here (which is what it
   * did) gave a HiDPI screen twice the room it has, the fit never kicked in, and
   * the outer rings were cut into crescents by the canvas edge: an oval sweeping
   * across the page instead of circles around the cover.
   */
  const scale = Math.max(1, Math.abs(ctx.getTransform().a) || 1);
  const boxReach =
    Math.min(ctx.canvas.width / scale, ctx.canvas.height / scale) / 2 -
    (config.thickness + glow * 0.5 + 4);
  const widest = coverReach + step * (series - 1) + reach + config.thickness + glow;
  const fit = widest > boxReach && widest > 0 ? Math.max(0.2, boxReach / widest) : 1;

  for (let line = 0; line < series; line += 1) {
    const base = (coverReach + step * line) * fit;
    const color = hslShift(config.color, line, series, config.colorAlt);
    const alpha = (config.opacity / 100) * ringAlpha(line, series, config.decay);
    /*
     * Each ring reads the spectrum from a slightly different place, so the set
     * ripples through itself instead of moving as one disc. The offset is per
     * ring and constant, not a function of time.
     */
    const phase = (line * 0.19) % 1;
    const raw: number[] = [];
    for (let i = 0; i < samples; i += 1) {
      const around = i / samples;
      const level = mirroredAt(state.levels, (around + phase) % 1);
      raw.push(level * reach * fit * config.sensitivity * (1 - line * 0.12));
    }
    /*
     * The smoothing window wraps around the ends: a ring closes, so the samples
     * either side of the seam are neighbours and the window has to say so, or
     * there is a visible kink where the last sample meets the first.
     */
    const wrapped = [...raw.slice(-4), ...raw, ...raw.slice(0, 4)];
    // The window wraps at the seam: the last sample's neighbours are the first
    // ones, so the ring closes without a kink where it starts.
    const smoothed = smoothSeries(wrapped, 4).slice(4, 4 + samples);

    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1, config.thickness) * (1 - line * 0.08);
    ctx.strokeStyle = withAlpha(
      line % 2 === 0 ? color : mixColor(color, config.colorAlt, 0.5),
      alpha,
    );
    if (glow > 0) {
      ctx.shadowBlur = glow;
      ctx.shadowColor = withAlpha(color, 0.4 * (config.opacity / 100));
    }
    // Thread the curve through the midpoints between samples: a 180-sided
    // circle drawn as a smooth closed ring, with no seam where it starts.
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i < samples; i += 1) {
      const angle = (i / samples) * Math.PI * 2 - Math.PI / 2;
      const radius = base + Math.max(0, smoothed[i]);
      points.push({ x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius });
    }
    const middle = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    });
    const head = middle(points[samples - 1], points[0]);
    ctx.beginPath();
    ctx.moveTo(head.x, head.y);
    for (let i = 0; i < samples; i += 1) {
      const current = points[i];
      const next = middle(current, points[(i + 1) % samples]);
      ctx.quadraticCurveTo(current.x, current.y, next.x, next.y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  bloomPass(ctx, config, 0.9);
}

/* ---------------------------------------------------------------------------
 * Dispatch
 * ------------------------------------------------------------------------ */

/** Dispatch used by the React canvas component. */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  state: VisualizerState,
  config: VisualizerConfig,
  coverRect: CoverRect | null,
): void {
  const dpr = window.devicePixelRatio || 1;
  const width = ctx.canvas.width / dpr;
  const height = ctx.canvas.height / dpr;
  /*
   * Give the shapes that stand on a baseline some room inside their own canvas.
   *
   * A peak that reaches the top of the box and a glow that reaches the side are
   * both cut off by the canvas edge, and a line that ends in a straight cut
   * reads as a drawing that was clipped rather than one that was finished. The
   * padding is the room the tallest peak and the widest glow need.
   */
  const pad = baselinePad(config);
  const drawBaseline = (
    fn: (innerWide: number, innerHigh: number) => void,
  ) => {
    ctx.save();
    ctx.translate(pad, pad);
    fn(Math.max(8, width - pad * 2), Math.max(8, height - pad * 2));
    ctx.restore();
  };
  switch (config.mode) {
    case "bars":
      drawBaseline((w, h) => drawBars(ctx, state, { ...config, mirror: false }, w, h));
      break;
    case "mirror":
      drawBaseline((w, h) => drawBars(ctx, state, { ...config, mirror: true }, w, h));
      break;
    case "wave":
      drawBaseline((w, h) => drawWave(ctx, state, config, w, h));
      break;
    case "aurora":
      drawBaseline((w, h) => drawAurora(ctx, state, config, w, h));
      break;
    case "orbit":
      drawOrbit(ctx, state, config, width, height, coverRect);
      break;
    case "cover":
      if (coverRect) drawCoverRing(ctx, state, config, coverRect);
      else drawOrbit(ctx, state, config, width, height);
      break;
    case "off":
    default:
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      break;
  }
}

/**
 * Which shapes wrap the artwork and which stand on their own.
 *
 * The ring follows the cover's outline and the halo rings whatever it is
 * centred on, so both want the cover's space. The others are horizontal
 * drawings, and laying them over the transport made them unreadable.
 */
export function wrapsCover(mode: VisualizerMode): boolean {
  return mode === "cover" || mode === "orbit";
}

export const VISUALIZER_MODES: { value: VisualizerMode; label: string; hint: string }[] = [
  { value: "wave", label: "Wave", hint: "One smooth line that moves with the voice" },
  { value: "bars", label: "Bars", hint: "Spectrum bars with peak caps" },
  { value: "mirror", label: "Mirror", hint: "Bars mirrored around the centre line" },
  { value: "cover", label: "Circles on the cover", hint: "Concentric circles that push outwards with the voice" },
  { value: "aurora", label: "Aurora", hint: "Layered ribbons of light drifting over each other" },
  { value: "orbit", label: "Orbit", hint: "Spokes around the cover, turning slowly" },
  { value: "off", label: "Off", hint: "Static cover, no motion" },
];

/* ---------------------------------------------------------------------------
 * Sampling: turning analyser data into the level arrays everything draws from
 * ------------------------------------------------------------------------ */

/**
 * One frame of analyser data, kept between renders so the animations smooth
 * out instead of flickering frame to frame. `time` is the drawing clock in
 * seconds: it drives the drift, the turn and the travelling highlight.
 */
export class VisualizerState {
  /** 0..1 per band, used by every mode. */
  levels: Float32Array;
  /** -1..1 time domain samples, used by the wave. */
  wave: Float32Array;
  /** Peak-hold, so bars and the ring fall back instead of snapping. */
  peaks: Float32Array;
  /** Seconds since the canvas started drawing. */
  time = 0;

  constructor(size = 160) {
    this.levels = new Float32Array(size);
    this.wave = new Float32Array(size);
    this.peaks = new Float32Array(size);
  }
}

export const DEFAULT_VISUALIZER: VisualizerConfig = {
  mode: "wave",
  lines: 2,
  sensitivity: 1,
  thickness: 2,
  spacing: 10,
  smooth: 0.72,
  glow: true,
  mirror: false,
  opacity: 85,
  bloom: 60,
  peaks: true,
  reflection: false,
  fill: true,
  rotation: 22,
  decay: 72,
  color: "#6c8cff",
  colorAlt: "#b06cff",
};

/**
 * Frequency data into `count` bands.
 *
 * The groups follow the ear rather than the spectrum: bands are more tightly
 * spaced at the bottom, where speech and music live, so an audiobook produces
 * visible movement instead of a dead line. Smoothing keeps the motion calm.
 */
export function sampleLevels(
  state: VisualizerState,
  frequency: Uint8Array,
  config: Pick<VisualizerConfig, "smooth" | "sensitivity">,
  count: number,
): void {
  const bins = frequency.length;
  const smooth = Math.max(0.05, Math.min(0.96, config.smooth));
  const levels = state.levels;
  for (let band = 0; band < levels.length; band += 1) {
    const from = Math.floor(Math.pow(band / levels.length, 1.8) * bins);
    const to = Math.max(from + 1, Math.floor(Math.pow((band + 1) / levels.length, 1.8) * bins));
    let sum = 0;
    let peak = 0;
    for (let i = from; i < to && i < bins; i += 1) {
      sum += frequency[i];
      peak = Math.max(peak, frequency[i]);
    }
    const average = (sum * 0.6 + peak * 0.4) / Math.max(1, to - from) / 255;
    const boosted = Math.min(1, Math.pow(average, 0.75) * (config.sensitivity || 1));
    const previous = levels[band] ?? 0;
    // Rise quickly, fall slowly: that is what reads as a live meter.
    const rate = boosted > previous ? 1 - smooth * 0.5 : 1 - smooth;
    levels[band] = previous + (boosted - previous) * Math.max(0.05, Math.min(1, rate));
    state.peaks[band] = Math.max(levels[band], (state.peaks[band] ?? 0) * 0.965);
  }
  void count;
}

/** Time-domain data into the wave buffer, smoothed the same way. */
export function sampleWave(state: VisualizerState, time: Uint8Array, count: number, smooth: number): void {
  const wave = state.wave;
  const rate = Math.max(0.05, Math.min(1, 1 - smooth));
  for (let i = 0; i < wave.length; i += 1) {
    const source = time[Math.floor((i / wave.length) * time.length)] ?? 128;
    const value = (source - 128) / 128;
    wave[i] = (wave[i] ?? 0) + (value - (wave[i] ?? 0)) * rate;
    // The wave mode draws from the same level array as everything else, so the
    // absolute value of the signal lands there too (with its sign kept in
    // `wave` for callers that want the raw shape). The curve is compressed on
    // purpose: speech spends most of its time well under full scale, and a
    // faithful mapping would draw a nearly flat line at every normal volume.
    const magnitude = Math.min(1, Math.pow(Math.abs(wave[i]) * 1.8, 0.8));
    state.levels[i] = magnitude;
  }
  void count;
}
