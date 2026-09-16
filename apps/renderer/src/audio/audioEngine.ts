/**
 * The audio engine: one HTMLAudioElement wired into a WebAudio graph so the
 * equalizer, balance, channel mode, preamp and the visualizer analyser all
 * share a single playback path.
 *
 *   <audio> -> MediaElementSource -> [10 biquad bands] -> channel -> preamp
 *           -> balance -> analyser -> master gain -> destination
 */

import { EQ_BANDS, clampGain, dbToGain, autoPreamp, resampleGains } from "@amp/core";
import { describeMediaError, explainFailedSource } from "./capabilities";

export type EngineEvent =
  | { type: "time"; time: number; duration: number }
  | { type: "ended" }
  | { type: "playing" }
  | { type: "paused" }
  | { type: "waiting" }
  | { type: "error"; message: string }
  | { type: "ready"; duration: number }
  | { type: "ratechange"; rate: number }
  /** Something was worked around; the message is written for the listener. */
  | { type: "notice"; message: string }
  /**
   * The effects graph is up, or given up on. `refused` is the same answer
   * `isGraphRefused()` gives, raised as an event so Settings can show the
   * retry without asking the engine every frame.
   */
  | { type: "graph"; refused: boolean; pending?: boolean };

type Handler = (event: EngineEvent) => void;

export interface EqConfig {
  enabled: boolean;
  gains: number[];
  preamp: number;
}

/** True for the DOMException a superseded load() produces: play() interrupted. */
function isAbort(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === "AbortError";
}

export class AudioEngine {
  private element: HTMLAudioElement | null = null;
  private context: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private bands: BiquadFilterNode[] = [];
  private bandFrequencies: number[] = [];
  private preamp: GainNode | null = null;
  private balanceNode: StereoPannerNode | null = null;
  /** Downmix / channel-swap stage between the EQ and the balance. */
  private channelBus: GainNode | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private merger: ChannelMergerNode | null = null;
  private analyser: AnalyserNode | null = null;
  private master: GainNode | null = null;
  private handlers = new Set<Handler>();
  private ticker: number | null = null;
  private graphReady = false;
  private channelMode: "stereo" | "mono" | "swap" = "stereo";
  private eq: EqConfig = { enabled: false, gains: new Array(EQ_BANDS.length).fill(0), preamp: 0 };
  private volume = 1;
  private muted = false;
  /** Set while a stalled output pipeline is being worked around. */
  private recovering = false;
  /** Last source handed to the element, used to explain a decode refusal. */
  private currentUrl = "";
  private stalledOnce = false;
  private stallWatchdog: number | null = null;
  /**
   * The system refused the effects graph at least once.
   *
   * A media element can be handed to exactly one AudioContext, for its whole
   * life: `createMediaElementSource` captures it, and there is no way to give it
   * back. If the context it was handed to cannot produce sound - a driver the
   * browser never manages to claim - the element is silent for good, while the
   * transport happily counts up. Rebuilding the graph on the next book is
   * therefore how the app used to silence itself permanently: the only cure was
   * quitting and relaunching.
   *
   * So a refusal is remembered for the session, and the graph is not built again
   * until the listener asks for it (Settings > Try the effects graph again).
   */
  private graphRefused = false;
  /**
   * The graph is built and waiting for the first user gesture.
   *
   * A context created outside a gesture starts suspended and refuses to resume,
   * and an element captured by a context that never runs is silent. So the
   * element is handed over only once the context is running; until then this is
   * set, the interface says "starting with your first click" instead of
   * blaming the system, and a one-shot listener retries on the next click or
   * key press.
   */
  private graphPending = false;
  private gestureHooked = false;
  /** A build is in flight; the gesture retry must not start a second one. */
  private building = false;
  /** The live gesture listener, kept so it can be taken off again. */
  private gestureRetry: (() => void) | null = null;
  /**
   * The visualizer's own analyser, for machines that will not build the graph.
   *
   * `createMediaElementSource` captures an element for life, so when the graph
   * fails the element is left alone and the effects are off for good. The
   * element can still *report* what it is playing, though: `captureStream()`
   * hands out a stream of its output without capturing it, and a bare
   * AudioContext can analyse that stream in a separate graph that touches
   * nothing. Real levels, no equalizer, and no risk to the sound.
   */
  private fallbackAnalyser: AnalyserNode | null = null;
  private fallbackContext: AudioContext | null = null;
  private fallbackStream: MediaStream | null = null;
  private fallbackTried = false;
  /** The channel mode the graph is currently wired for, so rewiring is a no-op when it has not changed. */
  private routedMode: "stereo" | "mono" | "swap" | null = null;
  /** Last balance handed to the panner. */
  private balance = 0;
  /** Last sink id handed to setSinkId, so re-selecting the same one is a no-op. */
  private sinkId = "";

  /** Must be called from a user gesture the first time (browser policy). */
  ensureElement(): HTMLAudioElement {
    if (this.element) return this.element;
    this.element = this.createElement();
    return this.element;
  }

  private createElement(): HTMLAudioElement {
    const element = new Audio();
    element.preload = "metadata";
    element.crossOrigin = "anonymous";
    (element as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
    element.addEventListener("ended", () => {
      /*
       * A source change resets the element, and the reset can flush one last
       * `ended` event for the file that was just replaced. That event arrives
       * with no data loaded - readyState 0, currentTime 0 - and acting on it
       * walks the library two chapters in one go and leaves the second file
       * loaded but not playing. A file that genuinely ended has data and a
       * length; anything else is a leftover and is dropped.
       */
      if (element.readyState === 0) return;
      if (!Number.isFinite(element.duration) || element.duration <= 0) return;
      this.emit({ type: "ended" });
    });
    element.addEventListener("play", () => this.emit({ type: "playing" }));
    element.addEventListener("pause", () => {
      /*
       * Two pauses are not the listener pressing pause, and reporting them as
       * such stops the book at every chapter boundary:
       *
       *   - the media finishing: the element pauses first and fires "ended"
       *     second, so the pause arrives with `ended` already true;
       *   - a source change resetting the element: no data, no position.
       *
       * The interface decides what a real pause means; the engine only reports
       * the ones the element did not cause itself.
       */
      if (element.ended) return;
      if (element.readyState === 0 && element.currentTime === 0) return;
      this.emit({ type: "paused" });
    });
    element.addEventListener("waiting", () => this.emit({ type: "waiting" }));
    element.addEventListener("loadedmetadata", () =>
      this.emit({ type: "ready", duration: Number.isFinite(element.duration) ? element.duration : 0 }),
    );
    element.addEventListener("ratechange", () =>
      this.emit({ type: "ratechange", rate: element.playbackRate }),
    );
    // The element keeps reporting progress even when the window is minimised and
    // animation frames have stopped, which is how Amp spends most of its life.
    element.addEventListener("timeupdate", () => this.emitPosition());
    element.addEventListener("durationchange", () => this.emitPosition());
    element.addEventListener("error", () =>
      this.emit({ type: "error", message: this.describeError(element) }),
    );
    return element;
  }

  /**
   * A refused play() is either the autoplay policy or a format this build
   * cannot decode, and the DOMException text is the same for both.
   *
   * When the codec is fine, the element's own error is the better answer: it
   * distinguishes "the file could not be read" from "the browser refused this
   * page's attempt to start audio", and those need different fixes.
   */
  private explainRefusal(url: string, error: unknown): string {
    const codec = explainFailedSource(url);
    if (codec) return codec;
    if (this.element?.error) return this.describeError(this.element);
    return `Playback was blocked: ${(error as Error).message}`;
  }

  private describeError(element: HTMLAudioElement): string {
    // The element knows its own source, in case the error arrives before a load
    // recorded one.
    const source = this.currentUrl || element.currentSrc || element.src || "";
    return describeMediaError(element.error?.code, source);
  }

  /**
   * Build the WebAudio graph.
   *
   * Safe to call repeatedly, and safe to fail: on a system that will not give
   * the graph an output, this returns quietly and leaves the element playing on
   * its own. It must never leave the element captured by a half-built graph,
   * because that outcome is silent and permanent.
   */
  async initGraph(): Promise<void> {
    if (this.graphReady || !this.element) return;
    // A refusal is remembered, but a *pending* graph is not: it is retried on
    // every gesture, every play and every load until it comes up.
    if (this.graphRefused || this.building) return;
    this.building = true;
    try {
      await this.buildGraph();
    } finally {
      this.building = false;
    }
  }

  private async buildGraph(): Promise<void> {
    // Re-guarded here: the split from initGraph is what takes the narrowing
    // away, and the element can be swapped by a restart while a build is
    // waiting for the context to start.
    const element = this.element;
    if (!element) return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      // No Web Audio at all. Nothing to retry later, but the interface should
      // still be able to say why there is no equalizer.
      this.graphRefused = true;
      this.graphPending = false;
      this.emit({ type: "graph", refused: true });
      return;
    }
    let context: AudioContext | null = null;
    // From here on, "captured" means the element belongs to this context and
    // can never be given back: the only cure is a fresh element.
    let captured = false;
    try {
      context = new Ctor();
      if (context.state !== "running") {
        await this.resumeOrWait(context);
      }
      if (context.state !== "running") throw new ContextWaiting();
      this.context = context;
      this.source = context.createMediaElementSource(element);
      captured = true;
      this.bands = this.createBandChain(context);
      this.preamp = context.createGain();
      this.channelBus = context.createGain();
      this.balanceNode = context.createStereoPanner();
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.75;
      this.master = context.createGain();
      this.routedMode = null;

      let node: AudioNode = this.source;
      node = node.connect(this.firstBand());
      node = this.lastBand().connect(this.preamp);
      node = this.preamp.connect(this.channelBus);
      node = this.channelBus.connect(this.balanceNode);
      node = this.balanceNode.connect(this.analyser);
      node = this.analyser.connect(this.master);
      node.connect(context.destination);
      this.graphReady = true;
      this.graphRefused = false;
      this.graphPending = false;
      this.applyEq(this.eq);
      this.applyVolume();
      this.routeChannelMode();
      this.balance = Number.NaN;
      this.setBalance(0);
      this.emit({ type: "graph", refused: false });
      void logAudio("effects graph live: equalizer and visualizer are running");
    } catch (error) {
      const waiting = error instanceof ContextWaiting;
      closeContext(context);
      this.context = null;
      if (!captured) {
        /*
         * Nothing was taken from the element, so it is still playing straight
         * to the output. This is the ordinary case on a machine where the
         * window opens before the listener touches anything: the whole graph
         * waits for a gesture rather than reporting a failure, and the element
         * keeps its sound the entire time.
         */
        if (waiting) {
          this.graphPending = true;
          this.graphRefused = false;
          this.armGestureRetry();
          void logAudio("effects graph waiting for a user gesture before it starts");
          this.emit({ type: "graph", refused: false, pending: true });
        } else {
          this.graphRefused = true;
          this.graphPending = false;
          // The equalizer is gone but the visualizer does not have to be: its
          // fallback reads the element without capturing it.
          this.ensureAnalyserFallback();
          this.emit({ type: "graph", refused: true });
          void logAudio(
            `effects graph refused (${error instanceof Error ? error.message : String(error)})`,
          );
        }
        return;
      }
      if (waiting) {
        // The context took the element and then would not run: hand playback
        // back to a fresh element and try again on the next gesture.
        this.graphPending = true;
        this.graphRefused = false;
        this.emit({ type: "graph", refused: false, pending: true });
        await this.restart(
          element,
          this.currentUrl || element.src,
          element.currentTime,
          element.playbackRate,
          { withGraph: false },
        );
        this.armGestureRetry();
        return;
      }
      // The graph is not usable on this machine. The element may already be
      // captured by the failed context, in which case keeping it would mean
      // silence: hand playback to a fresh element with no graph at all.
      await this.abandonGraph(error);
    }
  }

  /**
   * Resume, or decide that this context is waiting for a gesture.
   *
   * Chromium rejects resume() outside a user gesture, and in some builds the
   * promise simply never settles. Neither is a broken graph, so both end here
   * as "wait" rather than as an exception the caller would report as a refusal.
   */
  private async resumeOrWait(context: AudioContext): Promise<void> {
    try {
      await Promise.race([
        context.resume().then(() => undefined),
        new Promise<void>((_resolve, reject) => {
          window.setTimeout(() => reject(new ContextWaiting()), 1200);
        }),
      ]);
    } catch (error) {
      if (error instanceof ContextWaiting) throw error;
      throw new ContextWaiting();
    }
  }

  /**
   * One click or key press is all a suspended context needs.
   *
   * The listener is installed once, on the window, and removes itself as soon
   * as it has been used: the point is to catch the *first* gesture, whenever
   * and wherever it arrives.
   */
  private armGestureRetry(): void {
    if (this.gestureHooked || typeof window === "undefined") return;
    this.gestureHooked = true;
    /*
     * The listener stays until the graph is up, not for one gesture. A click
     * that arrives while a build is already in flight, or a build that lands
     * a millisecond before the gesture, would otherwise leave the graph waiting
     * for a gesture that has already happened.
     */
    const retry = () => {
      if (this.graphReady || this.graphRefused) {
        this.disarmGestureRetry();
        return;
      }
      if (this.building) return;
      void this.initGraph().then(() => {
        if (this.graphReady || this.graphRefused) this.disarmGestureRetry();
      });
    };
    window.addEventListener("pointerdown", retry, true);
    window.addEventListener("keydown", retry, true);
    window.addEventListener("touchstart", retry, true);
    this.gestureRetry = retry;
  }

  private disarmGestureRetry(): void {
    if (!this.gestureRetry || typeof window === "undefined") return;
    window.removeEventListener("pointerdown", this.gestureRetry, true);
    window.removeEventListener("keydown", this.gestureRetry, true);
    window.removeEventListener("touchstart", this.gestureRetry, true);
    this.gestureRetry = null;
    this.gestureHooked = false;
  }

  /**
   * Give up on the effects graph and keep the sound.
   *
   * Called when building the graph failed, or when the graph came up but
   * produced no audio (the stall watchdog). The element in use may be captured,
   * so a new one takes over from the same position, without a graph.
   */
  private async abandonGraph(cause: unknown): Promise<void> {
    const wasPlaying = Boolean(this.element && !this.element.paused);
    const position = this.element?.currentTime ?? 0;
    const rate = this.element?.playbackRate ?? 1;
    const url = this.currentUrl || this.element?.src || "";
    const captured = Boolean(this.source);
    this.graphRefused = true;
    this.graphPending = false;
    this.stalledOnce = true;
    this.teardownGraph();
    this.ensureAnalyserFallback();
    this.emit({ type: "graph", refused: true });
    void logAudio(
      `effects graph refused (${cause instanceof Error ? cause.message : String(cause)}); playing without it`,
    );
    if (!captured || !url) return;
    // A captured element cannot be un-captured: replace it to get sound back.
    await this.restart(this.element as HTMLAudioElement, url, position, rate, { withGraph: false });
    if (!wasPlaying) this.element?.pause();
  }

  /** True when Amp is playing without the equalizer and the visualizer. */
  isGraphRefused(): boolean {
    return this.graphRefused;
  }

  /** True while the graph is only waiting for the first gesture. */
  isGraphPending(): boolean {
    return this.graphPending;
  }

  /** True when the analyser is connected: the visualizer has data to draw. */
  hasAnalyser(): boolean {
    return this.analyser !== null || this.fallbackAnalyser !== null;
  }

  /**
   * A stream of the element's output, without capturing the element.
   *
   * Used only when the effects graph will not build: the equalizer stays off,
   * the sound is untouched, and the visualizer still draws the real audio.
   */
  private ensureAnalyserFallback(): AnalyserNode | null {
    if (this.fallbackAnalyser) return this.fallbackAnalyser;
    if (this.analyser) return this.analyser;
    if (this.fallbackTried || typeof window === "undefined" || !this.element) return null;
    this.fallbackTried = true;
    const element = this.element as HTMLMediaElement & { captureStream?: () => MediaStream };
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor || typeof element.captureStream !== "function") return null;
    try {
      const stream = element.captureStream();
      const track = stream.getAudioTracks()[0];
      if (!track) return null;
      const context = new Ctor();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      if (context.state === "suspended") void context.resume().catch(() => undefined);
      this.fallbackContext = context;
      this.fallbackStream = stream;
      this.fallbackAnalyser = analyser;
      void logAudio("visualizer is reading the element's own output (no effects graph)");
      return analyser;
    } catch {
      // captureStream is not everywhere, and a stream from a tainted element
      // fails here: the canvas then simply has nothing to draw.
      return null;
    }
  }

  private teardownFallback(): void {
    try {
      this.fallbackStream?.getTracks().forEach((track) => track.stop());
    } catch {
      /* already stopped */
    }
    try {
      void this.fallbackContext?.close();
    } catch {
      /* already closed */
    }
    this.fallbackStream = null;
    this.fallbackContext = null;
    this.fallbackAnalyser = null;
    this.fallbackTried = false;
  }

  /**
   * Try the effects graph once more, on a fresh element.
   *
   * The listener asks for this from Settings. It rebuilds on a new element
   * because the current one may still be captured by the context that failed.
   * Returns true when the graph came up.
   */
  async retryGraph(): Promise<boolean> {
    this.graphRefused = false;
    this.graphPending = false;
    this.stalledOnce = false;
    this.teardownFallback();
    const element = this.element;
    if (!element) return false;
    const url = this.currentUrl || element.src;
    if (!url) return false;
    const wasPlaying = !element.paused;
    const position = element.currentTime;
    const rate = element.playbackRate;
    this.teardownGraph();
    this.element = this.createElement();
    this.element.playbackRate = rate;
    this.element.volume = this.muted ? 0 : Math.min(1, this.volume);
    this.element.src = url;
    await this.initGraph();
    if (position > 0) this.element.currentTime = position;
    if (wasPlaying) {
      try {
        await this.element.play();
      } catch {
        /* the caller sees isGraphRefused() and the transport state */
      }
    }
    this.armStallWatchdog();
    this.emit({ type: "graph", refused: this.graphRefused });
    return this.graphReady;
  }

  private createBandChain(context: AudioContext): BiquadFilterNode[] {
    this.bandFrequencies = EQ_BANDS as unknown as number[];
    return this.bandFrequencies.map((frequency, i) => {
      const filter = context.createBiquadFilter();
      filter.type = i === 0 ? "lowshelf" : i === this.bandFrequencies.length - 1 ? "highshelf" : "peaking";
      filter.frequency.value = frequency;
      filter.Q.value = 1.1;
      filter.gain.value = 0;
      return filter;
    });
  }

  private firstBand(): BiquadFilterNode {
    return this.bands[0];
  }

  private lastBand(): BiquadFilterNode {
    return this.bands[this.bands.length - 1];
  }

  getAnalyser(): AnalyserNode | null {
    if (this.analyser) return this.analyser;
    // The fallback is only interesting while the graph is out of action, and
    // building it costs a stream plus a context, so it is not tried on the
    // happy path.
    if (this.graphRefused) return this.ensureAnalyserFallback();
    return null;
  }

  getContext(): AudioContext | null {
    return this.context;
  }

  /**
   * The media element itself.
   *
   * It is never in the DOM - the engine owns it - which makes playback state
   * invisible to devtools and to the smoke tests. This accessor is the way in.
   */
  getElement(): HTMLAudioElement | null {
    return this.element;
  }

  async contextResume(): Promise<void> {
    const context = this.context;
    if (!context || context.state === "running") return;
    try {
      await context.resume();
    } catch {
      // Autoplay policy, not a fault: the graph is built and will render as
      // soon as a gesture arrives. Logged once, never shouted about.
      this.armGestureRetry();
      void logAudio("audio context is suspended; the first click will start it");
    }
  }

  setEq(config: Partial<EqConfig>): void {
    const next = { ...this.eq, ...config };
    // Settings are written on every slider drag, and re-ramping ten filters per
    // event is audible as a stutter. Identical settings do nothing at all.
    if (sameEq(this.eq, next)) return;
    this.eq = next;
    this.applyEq(this.eq);
  }

  private applyEq(config: EqConfig): void {
    if (!this.graphReady) return;
    const gains = config.enabled
      ? resampleGains(config.gains, this.bands.length)
      : new Array(this.bands.length).fill(0);
    const now = this.context?.currentTime ?? 0;
    this.bands.forEach((band, i) => {
      const value = clampGain(gains[i] ?? 0);
      band.gain.cancelScheduledValues(now);
      band.gain.linearRampToValueAtTime(value, now + 0.08);
    });
    const preampDb = config.enabled ? autoPreamp(config.gains, config.preamp) : 0;
    if (this.preamp && this.context) {
      this.preamp.gain.setTargetAtTime(dbToGain(preampDb), this.context.currentTime, 0.05);
    }
  }

  setBalance(balance: number): void {
    const value = Math.max(-1, Math.min(1, balance));
    if (value === this.balance) return;
    this.balance = value;
    if (!this.balanceNode || !this.context) return;
    this.balanceNode.pan.setTargetAtTime(value, this.context.currentTime, 0.03);
  }

  setVolume(volume: number, muted = this.muted): void {
    if (volume === this.volume && muted === this.muted) return;
    this.volume = volume;
    this.muted = muted;
    this.applyVolume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolume();
  }

  private applyVolume(): void {
    const target = this.muted ? 0 : this.volume;
    if (this.element) this.element.volume = Math.min(1, target);
    if (this.master && this.context) {
      // Node-side gain gives us >1 boosts for quiet recordings.
      this.master.gain.setTargetAtTime(target > 1 ? target : 1, this.context.currentTime, 0.05);
    }
  }

  setChannelMode(mode: "stereo" | "mono" | "swap"): void {
    // Rewiring the channel bus tears the preamp off the graph and puts it back.
    // Doing that on every settings write - an accent colour, a visualizer
    // option - was a dropout for no reason; only a real change re-routes.
    if (mode === this.channelMode && this.routedMode === mode) return;
    this.channelMode = mode;
    this.routeChannelMode();
  }

  /**
   * Rewire the stage that sits between the EQ and the balance.
   *
   *   stereo -> straight through
   *   mono   -> the bus downmixes to one channel (speakers interpretation)
   *   swap   -> splitter/merger cross the two channels
   *
   * Everything upstream of this node stays untouched, so switching never
   * interrupts playback.
   */
  private routeChannelMode(): void {
    const context = this.context;
    if (!context || !this.preamp || !this.channelBus || !this.balanceNode) return;
    if (this.routedMode === this.channelMode) return;
    // Build the replacement path first, then swap. If building throws, the old
    // path is still connected and playback carries on instead of going silent.
    let splitter: ChannelSplitterNode | null = null;
    let merger: ChannelMergerNode | null = null;
    if (this.channelMode === "swap") {
      try {
        splitter = context.createChannelSplitter(2);
        merger = context.createChannelMerger(2);
      } catch (error) {
        void logAudio(
          `channel swap unavailable (${error instanceof Error ? error.message : String(error)}); staying stereo`,
        );
        this.channelMode = "stereo";
        splitter = null;
        merger = null;
      }
    }
    try {
      this.preamp.disconnect();
    } catch {
      /* nothing connected yet */
    }
    if (this.splitter) {
      try {
        this.splitter.disconnect();
      } catch {
        /* already gone */
      }
      this.splitter = null;
    }
    if (this.merger) {
      try {
        this.merger.disconnect();
      } catch {
        /* already gone */
      }
      this.merger = null;
    }

    try {
      if (this.channelMode === "swap" && splitter && merger) {
        this.preamp.connect(splitter);
        splitter.connect(merger, 0, 1);
        splitter.connect(merger, 1, 0);
        merger.connect(this.channelBus);
        this.splitter = splitter;
        this.merger = merger;
        this.channelBus.channelCount = 2;
        this.channelBus.channelCountMode = "max";
        this.channelBus.channelInterpretation = "speakers";
      } else {
        this.preamp.connect(this.channelBus);
        const mono = this.channelMode === "mono";
        this.channelBus.channelCount = mono ? 1 : 2;
        this.channelBus.channelCountMode = mono ? "explicit" : "max";
        this.channelBus.channelInterpretation = "speakers";
      }
      this.routedMode = this.channelMode;
    } catch (error) {
      // The preamp is off the graph at this point: put it back the plain way,
      // because a disconnected preamp is silence.
      try {
        this.preamp.connect(this.channelBus);
        this.routedMode = "stereo";
        this.channelMode = "stereo";
      } catch {
        /* nothing else to try; the watchdog will rebuild */
      }
      void logAudio(
        `channel routing failed (${error instanceof Error ? error.message : String(error)}); staying stereo`,
      );
    }
  }

  getChannelMode(): "stereo" | "mono" | "swap" {
    return this.channelMode;
  }

  /**
   * Pick an output device (Electron/Chromium exposes setSinkId).
   *
   * Re-issuing the switch for the device already in use stops playback on some
   * systems, so a no-op is skipped, and a switch that interrupts playback is
   * followed by a resume: the listener changed output, not the play state.
   */
  async setOutputDevice(deviceId: string): Promise<boolean> {
    const element = this.element as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!element?.setSinkId) return false;
    if (deviceId === this.sinkId) return true;
    const wasPlaying = !element.paused;
    const position = element.currentTime;
    try {
      await element.setSinkId(deviceId);
      this.sinkId = deviceId;
    } catch (error) {
      void logAudio(`setSinkId(${deviceId || "default"}) failed: ${(error as Error).message}`);
      return false;
    }
    if (wasPlaying) {
      try {
        if (element.paused) await element.play();
        if (Math.abs(element.currentTime - position) > 0.5) element.currentTime = position;
      } catch {
        /* the transport state tells the listener what happened */
      }
    }
    return true;
  }

  /** Fade to silence then run a callback - used by the sleep timer. */
  async fadeTo(target: number, seconds: number): Promise<void> {
    if (!this.element) return;
    const start = this.volume;
    const steps = Math.max(1, Math.round(seconds * 10));
    for (let i = 1; i <= steps; i += 1) {
      const value = start + (target - start) * (i / steps);
      this.setVolume(value, false);
      await new Promise((resolve) => setTimeout(resolve, (seconds * 1000) / steps));
    }
  }

  async load(
    url: string,
    options: { position?: number; autoplay?: boolean; rate?: number } = {},
  ): Promise<void> {
    this.currentUrl = url;
    this.ensureElement();
    await this.initGraph();
    // Building the graph can fail and hand playback to a fresh element, so
    // address whichever element is live after the attempt - holding the old
    // handle here was how a refused graph turned into silence.
    const element = this.element ?? this.ensureElement();
    await this.contextResume();
    element.src = url;
    element.playbackRate = options.rate ?? element.playbackRate ?? 1;
    if (options.position && options.position > 0) {
      element.currentTime = options.position;
    }
    if (options.autoplay) {
      try {
        await element.play();
      } catch (error) {
        // Moving between the files of a book aborts the play() that was still
        // starting: that is the normal case, not a failure to report. Anything
        // else keeps the honest message it has always had.
        if (!isAbort(error)) this.emit({ type: "error", message: this.explainRefusal(url, error) });
      }
      this.armStallWatchdog();
    }
  }

  /**
   * Start the current source, repairing the element first if it is broken.
   *
   * This is the cure for "play does nothing until I change the chapter": after
   * a device switch or a settings write the element can be left with a decode
   * error or no source at all, and play() resolves happily on a dead element
   * while the transport says it is playing. Changing the chapter reloaded the
   * file, which is why that looked like the fix. A fresh element on the same
   * file, at the same position, does the same job without losing the place.
   */
  async ensurePlaying(position?: number): Promise<boolean> {
    const element = this.element;
    const url = this.currentUrl || element?.src || "";
    if (!element || !url) return false;
    const stuck = element.error !== null || element.readyState === 0 || !element.src;
    if (stuck) {
      const at = position ?? element.currentTime ?? 0;
      await this.restart(element, url, at, element.playbackRate || 1, { withGraph: true });
      return !this.element?.paused;
    }
    await this.play();
    return !this.isPaused();
  }

  /**
   * Put the sound back where it was, without touching the chapter.
   *
   * A settings change, an output device that disappeared, a driver that dropped
   * the stream or a suspended context can all leave the element paused - or
   * alive but silent - while the transport still says playing. Until now the
   * only repair was changing chapter, which is exactly the bug: reloading at the
   * position that was already reached is that repair, done automatically. The
   * listener hears a short gap and the same sentence carries on.
   *
   * Returns true when the element is playing by the time it is done.
   */
  async recover(reason = "watchdog"): Promise<boolean> {
    if (this.recovering) return !this.isPaused();
    this.recovering = true;
    try {
      // A context that got suspended is the quiet half of the problem: resume
      // it before deciding the element needs reloading.
      await this.contextResume();
      if (this.fallbackContext && this.fallbackContext.state === "suspended") {
        try {
          await this.fallbackContext.resume();
        } catch {
          /* the fallback analyser is decoration; it can stay suspended */
        }
      }
      const element = this.element;
      const url = this.currentUrl || element?.src || "";
      if (element && !element.paused && element.readyState >= 2) return true;
      if (!url) return false;
      const position = element?.currentTime ?? 0;
      const rate = element?.playbackRate ?? 1;
      await this.restart(element ?? this.ensureElement(), url, position, rate, {
        withGraph: this.graphReady,
      });
      const playing = !this.element?.paused;
      void logAudio(
        `${playing ? "playback repaired" : "repair failed"} after ${reason} at ${position.toFixed(1)}s`,
      );
      return playing;
    } finally {
      this.recovering = false;
    }
  }

  async play(): Promise<void> {
    this.ensureElement();
    // Pressing play is a gesture: the suspended context gets its chance here,
    // which is what makes "the visualizer never starts" impossible on a machine
    // whose window opened before anyone touched it.
    if (this.graphPending) this.graphRefused = false;
    await this.initGraph();
    const element = this.element ?? this.ensureElement();
    element.volume = this.muted ? 0 : this.volume;
    await this.contextResume();
    try {
      await element.play();
    } catch (error) {
      if (!isAbort(error)) {
        this.emit({
          type: "error",
          message: this.explainRefusal(this.currentUrl || element.currentSrc, error),
        });
      }
    }
    this.startTicker();
    this.armStallWatchdog();
  }

  /**
   * Watch for the one failure that reports success.
   *
   * On some audio stacks - a device that never opens, a driver the browser
   * cannot claim - `play()` resolves and the element fires "playing", yet the
   * clock never moves: the pipeline is up but nothing is being rendered. Amp
   * cannot fix the sound card, but it can notice within a second and rebuild
   * itself: first the Web Audio graph, and if that still does not take, plain
   * playback with the effects switched off. Silence with a spinning play
   * button is the one outcome worth all this trouble.
   */
  private armStallWatchdog(): void {
    if (this.stallWatchdog !== null) window.clearTimeout(this.stallWatchdog);
    const element = this.element;
    if (!element) return;
    const startedAt = element.currentTime;
    this.stallWatchdog = window.setTimeout(() => {
      this.stallWatchdog = null;
      if (this.recovering || !this.element || this.element.paused) return;
      if (Math.abs(this.element.currentTime - startedAt) > 0.05) return;
      void this.recoverFromStall();
    }, 1400);
  }

  private async recoverFromStall(): Promise<void> {
    const element = this.element;
    if (!element) return;
    const position = element.currentTime;
    const url = this.currentUrl || element.src;
    const rate = element.playbackRate;
    this.recovering = true;
    // A media element can only ever feed one AudioContext, so the way to start
    // over is a fresh element - with a fresh graph, or with no graph at all.
    if (!this.stalledOnce) {
      this.stalledOnce = true;
      await this.restart(element, url, position, rate, { withGraph: true });
    } else {
      await this.restart(element, url, position, rate, { withGraph: false });
      // Remember this for the rest of the session: rebuilding the graph on the
      // next book is what used to kill the sound until the app was restarted.
      this.graphRefused = true;
      // The visualizer does not need the effects graph to see the audio: the
      // element can report its own output. Close the analyser over the new
      // element now, so a rebuilt element never leaves a blank canvas behind.
      this.ensureAnalyserFallback();
      this.emit({
        type: "notice",
        message:
          "Playing without the equalizer after the audio output stalled twice. The visualizer keeps following the sound. Settings can rebuild the effects graph.",
      });
    }
    this.recovering = false;
  }

  /** Swap in a new media element and resume where the stalled one left off. */
  private async restart(
    previous: HTMLAudioElement,
    url: string,
    position: number,
    rate: number,
    options: { withGraph: boolean },
  ): Promise<void> {
    try {
      previous.pause();
    } catch {
      /* nothing to pause */
    }
    this.teardownGraph();
    this.currentUrl = url;
    this.element = this.createElement();
    this.element.playbackRate = rate;
    this.element.volume = this.muted ? 0 : this.volume;
    this.element.src = url;
    if (options.withGraph) await this.initGraph();
    else this.graphReady = false;
    if (position > 0) this.element.currentTime = position;
    try {
      await this.element.play();
    } catch (error) {
      if (!isAbort(error)) this.emit({ type: "error", message: this.explainRefusal(url, error) });
    }
    this.armStallWatchdog();
  }

  /** Drop the Web Audio graph: the nodes belong to the element that is going away. */
  private teardownGraph(): void {
    try {
      this.source?.disconnect();
    } catch {
      /* already detached */
    }
    try {
      void this.context?.close();
    } catch {
      /* already closed */
    }
    this.source = null;
    this.context = null;
    this.analyser = null;
    this.master = null;
    this.preamp = null;
    this.channelBus = null;
    this.balanceNode = null;
    this.splitter = null;
    this.merger = null;
    this.bands = [];
    this.graphReady = false;
  }

  pause(): void {
    this.element?.pause();
    this.stopTicker();
  }

  async toggle(): Promise<void> {
    const element = this.ensureElement();
    if (element.paused) await this.play();
    else this.pause();
  }

  seek(seconds: number): void {
    if (!this.element) return;
    this.element.currentTime = Math.max(0, seconds);
    this.emitPosition();
  }

  setRate(rate: number): void {
    if (!this.element) return;
    const value = Math.max(0.25, Math.min(5, rate));
    // The settings store re-applies the saved speed on every write; setting the
    // same rate again restarts nothing, but writing the property does cost a
    // frame of silence on some audio stacks.
    if (this.element.playbackRate === value) return;
    this.element.playbackRate = value;
    // Keep speech intelligible: pitch correction stays on by default.
    const ext = this.element as HTMLAudioElement & { preservesPitch?: boolean };
    ext.preservesPitch = true;
  }

  getTime(): number {
    return this.element?.currentTime ?? 0;
  }

  getDuration(): number {
    const value = this.element?.duration ?? 0;
    return Number.isFinite(value) ? value : 0;
  }

  isPaused(): boolean {
    return this.element?.paused ?? true;
  }

  private emitPosition(): void {
    if (!this.element) return;
    this.emit({
      type: "time",
      time: this.element.currentTime,
      duration: Number.isFinite(this.element.duration) ? this.element.duration : 0,
    });
  }

  /**
   * Smooth position updates while the window is visible.
   *
   * A timer, not requestAnimationFrame: frames stop when the window is hidden or
   * minimised (background tab, window in the tray), and a player that keeps
   * playing has to keep reporting where it is.
   */
  private startTicker(): void {
    if (this.ticker !== null) return;
    this.ticker = window.setInterval(() => this.emitPosition(), 250);
  }

  private stopTicker(): void {
    if (this.ticker !== null) {
      window.clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  on(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private emit(event: EngineEvent): void {
    if (event.type === "playing") this.startTicker();
    if (event.type === "paused" || event.type === "ended") this.stopTicker();
    for (const handler of this.handlers) handler(event);
  }

  /** Media Session integration for OS level controls. */
  bindMediaSession(handlers: {
    play: () => void;
    pause: () => void;
    next: () => void;
    previous: () => void;
    seekTo?: (time: number) => void;
    seekBackward?: () => void;
    seekForward?: () => void;
    speed?: (rate: number) => void;
  }): void {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const safe = (action: MediaSessionAction, handler: MediaSessionActionHandler) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* unsupported action - ignore */
      }
    };
    safe("play", () => handlers.play());
    safe("pause", () => handlers.pause());
    safe("nexttrack", () => handlers.next());
    safe("previoustrack", () => handlers.previous());
    if (handlers.seekTo) safe("seekto", (details) => handlers.seekTo?.(details.seekTime ?? 0));
    if (handlers.seekBackward) safe("seekbackward", () => handlers.seekBackward?.());
    if (handlers.seekForward) safe("seekforward", () => handlers.seekForward?.());
    if (handlers.speed) safe("settempo" as MediaSessionAction, () => handlers.speed?.(1));
  }
}

/**
 * Raised when the audio context exists but is not allowed to run yet. Not an
 * error the listener should ever see: it means "waiting for a gesture".
 */
class ContextWaiting extends Error {
  constructor() {
    super("The audio context is waiting for a user gesture");
    this.name = "ContextWaiting";
  }
}

/** Close a context we are not going to use, without letting it throw. */
function closeContext(context: AudioContext | null): void {
  try {
    void context?.close();
  } catch {
    /* already closed, or never opened */
  }
}

/** Are these the same equalizer curve? */
function sameEq(a: EqConfig, b: EqConfig): boolean {
  if (a.enabled !== b.enabled || a.preamp !== b.preamp) return false;
  if (a.gains.length !== b.gains.length) return false;
  return a.gains.every((value, index) => value === b.gains[index]);
}

export const engine = new AudioEngine();

/**
 * Turn a failed load into a sentence. A Chromium build without the AAC decoder
 * reports the same "no supported source" text as a file that is simply broken,
 * so the format is checked before the raw message is handed on.
 */
export function explainPlaybackError(url: string, error: unknown): string {
  return explainFailedSource(url) ?? (error as Error)?.message ?? "Playback failed.";
}

/**
 * A short, readable trail of what the audio pipeline did.
 *
 * The failures worth knowing about here - a refused effects graph, a refused
 * output device - are invisible in the interface by design (playback carries on
 * without them), so they are recorded instead of shouted. Settings shows them,
 * which is how "why is the equalizer doing nothing" gets an answer without a
 * devtools console.
 */
const AUDIO_LOG_LIMIT = 12;
const audioLog: string[] = [];

function logAudio(message: string): void {
  const stamp = new Date().toISOString().slice(11, 19);
  audioLog.push(`${stamp} ${message}`);
  if (audioLog.length > AUDIO_LOG_LIMIT) audioLog.shift();
}

/** The recent audio pipeline notes, newest last. */
export function audioDiagnostics(): string[] {
  return [...audioLog];
}
