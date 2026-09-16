/**
 * jsdom shims for the browser APIs the UI touches. Kept intentionally small:
 * anything the app cannot do in a test environment is guarded in the code.
 */

if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  if (!("ResizeObserver" in window)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  }

  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 16) as unknown as number) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = ((handle: number) => window.clearTimeout(handle)) as typeof window.cancelAnimationFrame;
  }

  if (!("mediaSession" in navigator)) {
    Object.defineProperty(navigator, "mediaSession", {
      value: { metadata: null, setActionHandler: () => undefined, setPositionState: () => undefined },
      configurable: true,
    });
  }

  // jsdom has no audio codecs; every play() call is a no-op in tests.
  window.HTMLMediaElement.prototype.play = async function play() {
    this.dispatchEvent(new Event("play"));
  };
  window.HTMLMediaElement.prototype.pause = function pause() {
    this.dispatchEvent(new Event("pause"));
  };
  window.HTMLMediaElement.prototype.load = function load() {
    /* no-op */
  };

  window.URL.createObjectURL = window.URL.createObjectURL ?? (() => "blob:amp-test");
  window.URL.revokeObjectURL = window.URL.revokeObjectURL ?? (() => undefined);
}
