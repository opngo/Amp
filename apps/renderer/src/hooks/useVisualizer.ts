/**
 * Drives a visualizer canvas: resizes for device pixel ratio, reads the
 * analyser each animation frame and draws the configured style. Also exposes
 * the smoothed level array so other UI (the eq meters, the cover glow) can
 * react to the audio without a second analyser.
 */

import { useEffect, useRef } from "react";
import { engine } from "../audio/audioEngine";
import {
  DEFAULT_VISUALIZER,
  VisualizerState,
  drawFrame,
  sampleLevels,
  sampleWave,
  type CoverRect,
  type VisualizerConfig,
} from "../audio/visualizer";

export interface UseVisualizerOptions {
  config: VisualizerConfig;
  /** Element whose bounds are traced in outline/radial modes. */
  coverRef?: React.RefObject<HTMLElement | null>;
  /** Scale for the level meter consumers. */
  onLevels?: (levels: Float32Array) => void;
  paused?: boolean;
}

const BAR_COUNT = 96;
const WAVE_COUNT = 160;

export function useVisualizer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  options: UseVisualizerOptions,
): void {
  const stateRef = useRef(new VisualizerState(Math.max(BAR_COUNT, WAVE_COUNT)));
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    let frame = 0;
    const state = stateRef.current;

    const resize = (canvas: HTMLCanvasElement) => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width * dpr));
      const height = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return ctx;
    };

    const render = () => {
      frame = window.requestAnimationFrame(render);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = resize(canvas);
      if (!ctx) return;
      const { config, coverRef, onLevels } = optionsRef.current;
      if (config.mode === "off") {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }
      const analyser = engine.getAnalyser();
      if (analyser) {
        const freq = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(freq);
        sampleLevels(state, freq, config, BAR_COUNT);
        if (config.mode === "wave") {
          const time = new Uint8Array(analyser.fftSize);
          analyser.getByteTimeDomainData(time);
          sampleWave(state, time, WAVE_COUNT, Math.min(0.95, config.smooth));
        }
        onLevels?.(state.levels);
      } else {
        /*
         * No analyser: the graph has not started yet (a context waiting for the
         * first click), or this machine has no Web Audio at all.
         *
         * The canvas is drawn either way. A blank surface reads as "the
         * visualizer is broken", and the listener is left staring at the
         * absence of the thing they configured. What is drawn instead is the
         * quiet version of the chosen shape - the same form at a resting level,
         * moving at the pace of a breath - which says "nothing is wrong, there
         * is simply no audio to measure yet". The levels handed to the meters
         * stay low for the same reason: nothing here claims to be sound.
         */
        const t = performance.now() / 1400;
        for (let i = 0; i < state.levels.length; i += 1) {
          const target = 0.06 + 0.035 * Math.sin(t + i * 0.24);
          state.levels[i] = state.levels[i] * 0.92 + target * 0.08;
        }
        onLevels?.(state.levels);
      }

      let coverRect: CoverRect | null = null;
      const cover = coverRef?.current;
      if (cover) {
        const coverBounds = cover.getBoundingClientRect();
        const canvasBounds = canvas.getBoundingClientRect();
        coverRect = {
          x: coverBounds.left - canvasBounds.left,
          y: coverBounds.top - canvasBounds.top,
          width: coverBounds.width,
          height: coverBounds.height,
          radius: parseFloat(getComputedStyle(cover).borderTopLeftRadius) || 0,
        };
      }
      drawFrame(ctx, state, config, coverRect);
    };

    frame = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(frame);
  }, [canvasRef, options]);
}

export { DEFAULT_VISUALIZER };
