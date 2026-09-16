/**
 * The visualizer's maths and its drawing calls.
 *
 * jsdom has no canvas, so these tests hand `drawFrame` and the shape functions
 * a recording 2D context. That is enough to pin the parts worth pinning: the
 * ring fades outward the way the decay control says it should, the contour
 * follows the cover's real rounded rectangle, the reflection and the peak caps
 * only draw when they are switched on, and the glow pass copies the canvas at
 * the right size (it used to be drawn through the device pixel ratio, which
 * made a 2x smear instead of a halo).
 */

import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_VISUALIZER,
  VisualizerState,
  drawFrame,
  mirroredAt,
  mixColor,
  ringAlpha,
  roundedRectPoints,
  sampleAt,
  smoothSeries,
  type CoverRect,
  type VisualizerConfig,
} from "../audio/visualizer";

interface Recording {
  ctx: CanvasRenderingContext2D;
  calls: Record<string, number>;
  draws: string[];
}

function recordingContext(width = 800, height = 600): Recording {
  const calls: Record<string, number> = {};
  const draws: string[] = [];
  const gradient = { addColorStop: vi.fn() };
  const bump = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
    draws.push(name);
  };
  const ctx = {
    canvas: { width, height },
    clearRect: () => bump("clearRect"),
    beginPath: () => bump("beginPath"),
    closePath: () => bump("closePath"),
    moveTo: () => bump("moveTo"),
    lineTo: () => bump("lineTo"),
    quadraticCurveTo: () => bump("quadraticCurveTo"),
    arc: () => bump("arc"),
    roundRect: () => bump("roundRect"),
    fill: () => bump("fill"),
    fillRect: () => bump("fillRect"),
    stroke: () => bump("stroke"),
    save: () => bump("save"),
    restore: () => bump("restore"),
    rect: () => bump("rect"),
    clip: () => bump("clip"),
    // The padded shapes are drawn inside a translated box, and the ring maths
    // reads the current scale to measure its room in CSS pixels.
    translate: () => bump("translate"),
    scale: () => bump("scale"),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) as DOMMatrix,
    setTransform: vi.fn((...args: number[]) => {
      // Only the identity reset matters to these tests.
      if (args.join(",") === "1,0,0,1,0,0") bump("setTransformIdentity");
      else bump("setTransform");
    }),
    drawImage: () => bump("drawImage"),
    createLinearGradient: () => gradient,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    shadowBlur: 0,
    shadowColor: "transparent",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    filter: "none",
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls, draws };
}

function levels(size = 160, shape: (t: number) => number = (t) => 0.3 + 0.6 * t): VisualizerState {
  const state = new VisualizerState(size);
  for (let i = 0; i < size; i += 1) state.levels[i] = shape(i / (size - 1));
  for (let i = 0; i < size; i += 1) state.peaks[i] = Math.min(1, (state.levels[i] ?? 0) + 0.2);
  state.time = 3.5;
  return state;
}

function config(patch: Partial<VisualizerConfig> = {}): VisualizerConfig {
  return { ...DEFAULT_VISUALIZER, color: "#6c8cff", colorAlt: "#b06cff", ...patch };
}

const cover: CoverRect = { x: 200, y: 120, width: 240, height: 240, radius: 12 };

describe("visualizer maths", () => {
  it("interpolates the spectrum smoothly and hits both ends", () => {
    const data = new Float32Array([0, 1]);
    expect(sampleAt(data, 0)).toBe(0);
    expect(sampleAt(data, 1)).toBe(1);
    expect(sampleAt(data, 0.5)).toBeCloseTo(0.5, 5);
    // Smoothstep, not linear: the quarter point is below the straight line.
    expect(sampleAt(data, 0.25)).toBeLessThan(0.25);
  });

  it("folds the ramp in half so a ring closes without a seam", () => {
    const data = new Float32Array([0, 0.5, 1]);
    expect(mirroredAt(data, 0)).toBeCloseTo(mirroredAt(data, 1), 6);
    expect(mirroredAt(data, 0.5)).toBeCloseTo(1, 5);
    expect(mirroredAt(data, 0.25)).toBeCloseTo(mirroredAt(data, 0.75), 6);
  });

  it("smooths a spike without moving the baseline", () => {
    const smoothed = smoothSeries([0, 0, 1, 0, 0], 2);
    expect(smoothed[2]).toBeLessThan(1);
    expect(smoothed[2]).toBeGreaterThan(0.3);
    expect(smoothed[0]).toBeCloseTo(smoothed[4], 6);
    expect(Math.max(...smoothed)).toBeLessThanOrEqual(1);
  });

  it("fades the outer rings steadily, and faster at a higher decay", () => {
    const series = 4;
    const gentle = [0, 1, 2, 3].map((line) => ringAlpha(line, series, 20));
    const steep = [0, 1, 2, 3].map((line) => ringAlpha(line, series, 95));
    expect(gentle[0]).toBe(1);
    expect(steep[0]).toBe(1);
    for (let i = 1; i < series; i += 1) {
      expect(steep[i]).toBeLessThan(gentle[i]);
      expect(steep[i]).toBeLessThan(steep[i - 1]);
    }
    // One ring has nothing to fade towards.
    expect(ringAlpha(0, 1, 95)).toBe(1);
  });

  it("traces the cover's rounded rectangle and stays inside it", () => {
    const points = roundedRectPoints(cover, 120);
    expect(points.length).toBeGreaterThan(60);
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(cover.x - 0.001);
      expect(point.x).toBeLessThanOrEqual(cover.x + cover.width + 0.001);
      expect(point.y).toBeGreaterThanOrEqual(cover.y - 0.001);
      expect(point.y).toBeLessThanOrEqual(cover.y + cover.height + 0.001);
      // Unit normals: the ring can be pushed outward by a known distance.
      expect(Math.hypot(point.nx, point.ny)).toBeCloseTo(1, 5);
    }
    // The corners are arcs, so no point sits exactly on the sharp corner.
    const topLeftCorner = Math.hypot(cover.x - points[0].x, cover.y - points[0].y);
    expect(topLeftCorner).toBeGreaterThan(cover.radius! - 0.5);
  });

  it("spreads its points over the whole outline, corners and edges alike", () => {
    const points = roundedRectPoints(cover, 240);
    const onStraight = points.filter((point) => Math.abs(point.y - cover.y) < 0.001);
    // The long edge carries a real number of samples, not two.
    expect(onStraight.length).toBeGreaterThan(40);
  });

  it("draws the bare rectangle when the artwork has square corners", () => {
    const square = roundedRectPoints({ ...cover, radius: 0 }, 60);
    const xs = square.map((point) => point.x);
    const ys = square.map((point) => point.y);
    expect(Math.min(...xs)).toBeCloseTo(cover.x, 3);
    expect(Math.max(...xs)).toBeCloseTo(cover.x + cover.width, 3);
    expect(Math.min(...ys)).toBeCloseTo(cover.y, 3);
    expect(Math.max(...ys)).toBeCloseTo(cover.y + cover.height, 3);
  });

  it("mixes two hex colours without leaving the hex format", () => {
    expect(mixColor("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixColor("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixColor("var(--amp-accent)", "#ffffff", 0.5)).toBe("var(--amp-accent)");
  });
});

describe("visualizer drawing", () => {
  const modes = ["wave", "bars", "mirror", "cover", "aurora", "orbit", "off"] as const;

  it.each(modes)("draws %s without throwing", (mode) => {
    const { ctx, calls } = recordingContext();
    drawFrame(ctx, levels(), config({ mode }), mode === "cover" ? cover : null);
    expect(calls.clearRect).toBeGreaterThanOrEqual(1);
    if (mode === "off") expect(calls.stroke ?? 0).toBe(0);
    else expect((calls.stroke ?? 0) + (calls.fill ?? 0) + (calls.fillRect ?? 0)).toBeGreaterThan(0);
  });

  it("falls back to the halo when there is no artwork to trace", () => {
    const { ctx, calls } = recordingContext();
    drawFrame(ctx, levels(), config({ mode: "cover" }), null);
    // The orbit draws radial bars and its hairline ring; the ring-around-cover
    // path would not have drawn anything at all.
    expect(calls.stroke).toBeGreaterThan(10);
  });

  it("draws one copy per ring, so more lines means more contours", () => {
    const one = recordingContext();
    drawFrame(one.ctx, levels(), config({ mode: "cover", lines: 1 }), cover);
    const three = recordingContext();
    drawFrame(three.ctx, levels(), config({ mode: "cover", lines: 3 }), cover);
    expect(three.calls.stroke!).toBeGreaterThan((one.calls.stroke ?? 0) * 2);
  });

  it("copies the canvas at its own size for the glow", () => {
    const glow = recordingContext(1200, 800);
    drawFrame(glow.ctx, levels(), config({ mode: "bars", glow: true, bloom: 80 }), null);
    expect(glow.calls.drawImage).toBeGreaterThan(0);
    // The copy happens outside the device pixel ratio, or the glow is drawn at
    // double size and reads as a smear.
    expect(glow.calls.setTransformIdentity).toBeGreaterThan(0);

    const plain = recordingContext();
    drawFrame(plain.ctx, levels(), config({ mode: "bars", glow: false }), null);
    expect(plain.calls.drawImage ?? 0).toBe(0);
  });

  it("leaves the glow out when its strength is turned down to nothing", () => {
    const { ctx, calls } = recordingContext();
    drawFrame(ctx, levels(), config({ mode: "wave", glow: true, bloom: 0 }), null);
    expect(calls.drawImage ?? 0).toBe(0);
  });

  it("only reflects the bars when the reflection is on", () => {
    const off = recordingContext();
    drawFrame(off.ctx, levels(), config({ mode: "bars", reflection: false, glow: false }), null);
    const on = recordingContext();
    drawFrame(on.ctx, levels(), config({ mode: "bars", reflection: true, glow: false }), null);
    expect(on.calls.roundRect!).toBeGreaterThan(off.calls.roundRect ?? 0);
  });

  it("only draws peak caps when they are switched on", () => {
    const off = recordingContext();
    drawFrame(off.ctx, levels(), config({ mode: "bars", peaks: false, glow: false }), null);
    const on = recordingContext();
    drawFrame(on.ctx, levels(), config({ mode: "bars", peaks: true, glow: false }), null);
    expect(on.calls.roundRect!).toBeGreaterThan(off.calls.roundRect ?? 0);
  });

  it("fills under the wave only when the fill is on", () => {
    const off = recordingContext();
    drawFrame(off.ctx, levels(), config({ mode: "wave", fill: false, glow: false }), null);
    const on = recordingContext();
    drawFrame(on.ctx, levels(), config({ mode: "wave", fill: true, glow: false }), null);
    expect(on.calls.fill!).toBeGreaterThan(off.calls.fill ?? 0);
  });

  it("keeps the halo in place when it is told not to turn", () => {
    const still = recordingContext();
    const state = levels();
    drawFrame(still.ctx, state, config({ mode: "orbit", rotation: 0 }), null);
    const first = still.draws.length;
    state.time += 10;
    drawFrame(still.ctx, state, config({ mode: "orbit", rotation: 0 }), null);
    expect(still.draws.length).toBe(first * 2);
  });
});
