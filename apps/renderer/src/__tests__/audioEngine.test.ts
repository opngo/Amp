/**
 * The position ticker.
 *
 * Amp is designed to spend most of its life minimised or in the tray, where
 * animation frames stop being delivered. The engine therefore has to report the
 * playhead from a timer plus the media element's own events, not from
 * requestAnimationFrame.
 */

import { describe, expect, it, vi } from "vitest";
import { AudioEngine, audioDiagnostics } from "../audio/audioEngine";

class FakeAudio extends EventTarget {
  src = "";
  currentTime = 0;
  /** A real file has a length; the engine reads it to tell a file that ended
      from an element that was reset. */
  duration = 12;
  paused = true;
  /** The element's own "the file ran out" flag, which a reset clears. */
  ended = false;
  readyState = 4;
  playbackRate = 1;
  preload = "";
  volume = 1;
  muted = false;
  error: MediaError | null = null;

  async play() {
    this.paused = false;
    this.ended = false;
    this.dispatchEvent(new Event("play"));
  }

  pause() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }

  /** What the browser does when a file plays to its end. */
  finish() {
    this.paused = true;
    this.ended = true;
    this.dispatchEvent(new Event("pause"));
    this.dispatchEvent(new Event("ended"));
  }

  /** What the browser does when src is assigned a new file. */
  resetTo(next: string) {
    this.src = next;
    this.currentTime = 0;
    this.ended = false;
    this.duration = Number.NaN;
    this.readyState = 0;
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
    this.dispatchEvent(new Event("ended"));
    this.readyState = 4;
  }
}

function installFakes() {
  const created: FakeAudio[] = [];
  vi.stubGlobal("Audio", function AudioStub(this: unknown) {
    const element = new FakeAudio();
    created.push(element);
    return element;
  });
  vi.stubGlobal("AudioContext", undefined);
  vi.stubGlobal("webkitAudioContext", undefined);
  return created;
}

/**
 * The events that decide whether a book keeps reading itself.
 *
 * A folder of tracks is the case that matters: when a file runs out the browser
 * pauses the element, fires "ended", and - because the next file is assigned to
 * the same element - can flush one more "ended" from the file that just went
 * away. Reporting those as the listener pressing pause stopped the book at the
 * first chapter boundary; acting on the leftover advanced two chapters at once.
 */
describe("AudioEngine media events", () => {
  it("does not report the pause that comes with the end of a file", async () => {
    installFakes();
    const engine = new AudioEngine();
    const events: string[] = [];
    engine.on((event) => events.push(event.type));

    await engine.load("blob:one", { autoplay: true });
    events.length = 0;
    (engine.getElement() as unknown as FakeAudio).finish();

    // The file ending is a chapter boundary, not a pause: the store reads
    // "ended" and carries on, and a "paused" here would stop it first.
    expect(events).toContain("ended");
    expect(events).not.toContain("paused");
  });

  it("still reports a pause the listener asked for", async () => {
    installFakes();
    const engine = new AudioEngine();
    const events: string[] = [];
    engine.on((event) => events.push(event.type));

    await engine.load("blob:one", { autoplay: true });
    events.length = 0;
    engine.pause();
    expect(events).toContain("paused");
  });

  it("drops the leftover events a source change flushes", async () => {
    installFakes();
    const engine = new AudioEngine();
    const events: string[] = [];
    engine.on((event) => events.push(event.type));

    await engine.load("blob:one", { autoplay: true });
    events.length = 0;
    (engine.getElement() as unknown as FakeAudio).resetTo("blob:two");

    // A reset element has no data and no position: neither event belongs to a
    // file that played.
    expect(events).not.toContain("paused");
    expect(events).not.toContain("ended");
  });

  it("treats an aborted play as the normal case of moving between files", async () => {
    installFakes();
    const engine = new AudioEngine();
    const errors: string[] = [];
    engine.on((event) => {
      if (event.type === "error") errors.push(event.message);
    });

    const element = engine.ensureElement();
    const abort = new Error("The play() request was interrupted by a new load request.");
    abort.name = "AbortError";
    vi.spyOn(element as unknown as { play: () => Promise<void> }, "play").mockRejectedValueOnce(abort);

    await engine.load("blob:two", { autoplay: true });
    expect(errors).toHaveLength(0);
  });

  it("reports a play failure that is not an abort", async () => {
    installFakes();
    const engine = new AudioEngine();
    const errors: string[] = [];
    engine.on((event) => {
      if (event.type === "error") errors.push(event.message);
    });

    const failure = new Error("no decoder for this");
    failure.name = "NotSupportedError";
    engine.ensureElement();
    vi.spyOn(engine.getElement() as unknown as { play: () => Promise<void> }, "play").mockRejectedValueOnce(
      failure,
    );

    await engine.load("blob:three", { autoplay: true });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/could not read|decoder|codec/i);
  });
});

describe("AudioEngine position reporting", () => {
  it("keeps reporting the playhead without animation frames", async () => {
    vi.useFakeTimers();
    const created = installFakes();
    const engine = new AudioEngine();
    const times: number[] = [];
    engine.on((event) => {
      if (event.type === "time") times.push(event.time);
    });

    await engine.load("blob:audio", { autoplay: true });
    const element = created[0];
    expect(element.paused).toBe(false);

    // The clock moves while the window is hidden and no frame is ever rendered.
    element.currentTime = 4.5;
    await vi.advanceTimersByTimeAsync(300);
    expect(times.at(-1)).toBeCloseTo(4.5, 5);

    element.currentTime = 9;
    await vi.advanceTimersByTimeAsync(300);
    expect(times.at(-1)).toBe(9);
    vi.useRealTimers();
  });

  it("stops ticking when playback pauses, and reports a seek at once", async () => {
    vi.useFakeTimers();
    installFakes();
    const engine = new AudioEngine();
    const times: number[] = [];
    engine.on((event) => {
      if (event.type === "time") times.push(event.time);
    });

    await engine.load("blob:audio", { autoplay: true });
    engine.pause();
    times.length = 0;
    await vi.advanceTimersByTimeAsync(600);
    expect(times).toHaveLength(0);

    engine.seek(11);
    expect(times.at(-1)).toBe(11);
    vi.useRealTimers();
  });
});

/**
 * The effects graph, and what happens when the machine will not give it an
 * output.
 *
 * This is the bug that used to force a relaunch: a refused graph left the media
 * element captured by a context that produced no sound, and the next book built
 * the same refused graph again. Silent player, moving clock, no way back.
 */
class FakeAudioContext {
  static mode: "ok" | "throws" | "throwsAfterSource" = "ok";
  state: AudioContextState = "running";
  currentTime = 0;
  destination = { name: "destination" };
  created = 0;

  constructor() {
    if (FakeAudioContext.mode === "throws") throw new Error("driver refused the audio context");
  }

  private node(name: string) {
    return {
      name,
      connect(target: unknown) {
        return target;
      },
      disconnect() {
        /* no-op */
      },
      gain: { value: 0, setTargetAtTime() {}, cancelScheduledValues() {}, linearRampToValueAtTime() {} },
      pan: { setTargetAtTime() {} },
      frequency: { value: 0 },
      Q: { value: 0 },
      fftSize: 2048,
      smoothingTimeConstant: 0.75,
      frequencyBinCount: 1024,
      channelCount: 2,
      channelCountMode: "max",
      channelInterpretation: "speakers",
      get parent() {
        return self;
      },
    };
  }

  createMediaElementSource() {
    this.created += 1;
    return this.node(`source${this.created}`);
  }
  createBiquadFilter() {
    return this.node("band");
  }
  createGain() {
    return this.node("gain");
  }
  createStereoPanner() {
    // The interesting failure: the element is already captured by the context
    // when the build falls over, so keeping it means silence.
    if (FakeAudioContext.mode === "throwsAfterSource") throw new Error("no panner on this build");
    return this.node("panner");
  }
  createAnalyser() {
    return this.node("analyser");
  }
  createChannelSplitter() {
    return this.node("splitter");
  }
  createChannelMerger() {
    return this.node("merger");
  }
  async resume() {}
  async close() {}
}

describe("AudioEngine effects graph", () => {
  it("keeps playing when the system refuses to open an audio context", async () => {
    const created = installFakes();
    FakeAudioContext.mode = "throws";
    vi.stubGlobal("AudioContext", FakeAudioContext as unknown as typeof AudioContext);

    const engine = new AudioEngine();
    await engine.load("blob:book", { autoplay: true, position: 0 });

    // Nothing captured the element, so the original one keeps playing and there
    // is no reason to replace it.
    expect(engine.isGraphRefused()).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0]?.paused).toBe(false);
    expect(created[0]?.src).toBe("blob:book");

    vi.stubGlobal("AudioContext", undefined);
    FakeAudioContext.mode = "ok";
  });

  it("replaces an element that a failed graph build already captured", async () => {
    const created = installFakes();
    FakeAudioContext.mode = "throwsAfterSource";
    vi.stubGlobal("AudioContext", FakeAudioContext as unknown as typeof AudioContext);

    const engine = new AudioEngine();
    await engine.load("blob:book", { autoplay: true, position: 0 });

    // The first element is captured by a context that cannot produce sound, so
    // playback moves to a fresh element at the same spot - the difference
    // between a player that keeps working and one that needs a relaunch.
    expect(engine.isGraphRefused()).toBe(true);
    expect(created.length).toBeGreaterThan(1);
    expect(created.at(-1)?.paused).toBe(false);
    expect(created.at(-1)?.src).toBe("blob:book");

    vi.stubGlobal("AudioContext", undefined);
    FakeAudioContext.mode = "ok";
  });

  it("does not rebuild a refused graph on the next book", async () => {
    const created = installFakes();
    FakeAudioContext.mode = "throws";
    vi.stubGlobal("AudioContext", FakeAudioContext as unknown as typeof AudioContext);

    const engine = new AudioEngine();
    await engine.load("blob:first", { autoplay: true });
    const attemptsAfterFirst = created.length;
    await engine.load("blob:second", { autoplay: true });

    // One swap for the first book, one for the second: the refusals are not
    // retried behind the listener's back, which is what kept the player silent.
    expect(engine.isGraphRefused()).toBe(true);
    expect(created.length).toBeLessThanOrEqual(attemptsAfterFirst + 1);
    expect(created.at(-1)?.paused).toBe(false);

    vi.stubGlobal("AudioContext", undefined);
    FakeAudioContext.mode = "ok";
  });

  it("comes back with effects when the listener asks for them", async () => {
    const created = installFakes();
    FakeAudioContext.mode = "throws";
    vi.stubGlobal("AudioContext", FakeAudioContext as unknown as typeof AudioContext);
    const engine = new AudioEngine();
    await engine.load("blob:book", { autoplay: true });
    expect(engine.isGraphRefused()).toBe(true);

    FakeAudioContext.mode = "ok";
    const ok = await engine.retryGraph();
    expect(ok).toBe(true);
    expect(engine.isGraphRefused()).toBe(false);
    expect(engine.getAnalyser()).not.toBeNull();
    expect(created.at(-1)?.paused).toBe(false);

    vi.stubGlobal("AudioContext", undefined);
  });
});

describe("AudioEngine output device", () => {
  it("does not re-issue the switch for the device already in use", async () => {
    const created = installFakes();
    const engine = new AudioEngine();
    await engine.load("blob:book");
    const live = engine.getElement() as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    let calls = 0;
    live.setSinkId = async () => {
      calls += 1;
    };

    expect(await engine.setOutputDevice("speakers")).toBe(true);
    expect(await engine.setOutputDevice("speakers")).toBe(true);
    expect(calls).toBe(1);
    expect(created).toHaveLength(1);
  });

  it("tells the truth when the device cannot be claimed", async () => {
    installFakes();
    const engine = new AudioEngine();
    await engine.load("blob:book");
    const live = engine.getElement() as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    live.setSinkId = async () => {
      throw new Error("NotFoundError");
    };
    expect(await engine.setOutputDevice("ghost")).toBe(false);
  });
});

describe("repairing a stop nobody asked for", () => {
  it("reloads the same spot, in the same chapter, when the element went quiet", async () => {
    const created = installFakes();
    const engine = new AudioEngine();
    await engine.load("blob:book", { position: 42, autoplay: true });
    const before = engine.getElement();
    // The failure this repairs: the element is paused while the listener still
    // expects sound - a settings change, a device that went away, a driver that
    // dropped the stream. Changing chapter used to be the only cure.
    before?.pause();

    expect(await engine.recover("test")).toBe(true);
    const after = engine.getElement();
    expect(after).not.toBe(before);
    expect(after?.currentTime).toBe(42);
    expect(after?.paused).toBe(false);
    expect(created.length).toBeGreaterThan(1);
  });

  it("does nothing at all while the element is playing", async () => {
    const created = installFakes();
    const engine = new AudioEngine();
    await engine.load("blob:book", { position: 10, autoplay: true });
    expect(await engine.recover("test")).toBe(true);
    expect(created).toHaveLength(1);
  });
});

describe("audio diagnostics", () => {
  it("records what the pipeline did, so Settings can explain itself", () => {
    expect(Array.isArray(audioDiagnostics())).toBe(true);
  });
});
