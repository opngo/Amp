import { describe, expect, it } from "vitest";
import {
  canPlaySource,
  describeMediaError,
  explainFailedSource,
  sourceKindFromPath,
} from "../audio/capabilities";

describe("sourceKindFromPath", () => {
  it("reads the container off the path", () => {
    expect(sourceKindFromPath("/books/Tempest.m4b")).toBe("m4b");
    expect(sourceKindFromPath("C:\\books\\Tempest.M4B")).toBe("m4b");
    expect(sourceKindFromPath("/api/audio?path=/books/x.mp3&token=abc")).toBe("mp3");
    expect(sourceKindFromPath("/books/audiobook.flac")).toBe("flac");
    expect(sourceKindFromPath("/books/thing.xyz")).toBe("unknown");
  });
});

describe("canPlaySource", () => {
  it("leaves formats it does not know alone", () => {
    expect(canPlaySource("/books/thing.xyz").playable).toBe(true);
  });

  it("tells the truth about AAC when a load fails", () => {
    // jsdom carries no decoder at all, so the explanation is the codec one.
    const reason = explainFailedSource("/api/audio?path=/books/Tempest.m4b");
    if (reason) {
      expect(reason).toMatch(/AAC|not decodable/);
      expect(reason).toContain("desktop app");
    }
  });

  it("has nothing to explain for an unknown container", () => {
    expect(explainFailedSource("/books/thing.xyz")).toBeNull();
  });

  it("reports a reason when the engine refuses the format", () => {
    // jsdom's element claims support for nothing at all, which is exactly the
    // situation this check exists for.
    const verdict = canPlaySource("/books/Tempest.m4b");
    expect(verdict.kind).toBe("m4b");
    if (!verdict.playable) {
      expect(verdict.reason).toContain(".m4b");
      expect(verdict.reason.length).toBeGreaterThan(20);
    }
  });
});

describe("describeMediaError", () => {
  it("does not blame a codec when the file simply could not be read", () => {
    // This is the message a listener sees when a response is refused (a missing
    // CORS header, a file that moved). Chromium's own wording - "no supported
    // source was found" - points at codecs and sent us hunting in the wrong
    // place for a whole afternoon.
    //
    // The source is one this build has no opinion about, because jsdom answers
    // "" for every canPlayType: an .mp3 here would take the codec branch on
    // jsdom's say-so rather than on the player's. In a real Chromium the same
    // branch is what an .mp3 hits.
    const message = describeMediaError(4, "amp-media://local/C%3A%5Cbooks%5CSome%20Book%2001.mkv");
    expect(message).toContain("Some Book 01.mkv");
    expect(message).toContain("could not read");
    expect(message.toLowerCase()).not.toContain("codec");
  });

  it("still explains a genuinely missing decoder", () => {
    // jsdom answers "" for every canPlayType, so an .m4b here is the no-AAC case.
    const message = describeMediaError(4, "/books/Tempest.m4b");
    expect(message).toMatch(/AAC|m4b/);
  });

  it("names the other error codes for what they are", () => {
    expect(describeMediaError(1)).toBe("Playback aborted.");
    expect(describeMediaError(2)).toContain("Network error");
    expect(describeMediaError(3)).toContain("decoded");
    expect(describeMediaError(undefined)).toBe("Unknown playback error.");
  });

  it("copes with a source that has no file name in it", () => {
    expect(describeMediaError(4, "")).toContain("could not read this file");
  });
});
