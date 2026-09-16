/// <reference types="vite/client" />

/** Globals used for the tiny drag-and-drop reorder helpers. */
declare global {
  interface Window {
    __ampQueueDragIndex?: number;
    __ampPlaylistDragId?: string;
    /** Debug handle for the audio engine, used by the smoke tests. */
    __ampEngine?: import("./audio/audioEngine").AudioEngine;
  }
}

export {};
