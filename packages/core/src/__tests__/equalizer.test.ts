import { describe, expect, it } from "vitest";
import { EQ_BANDS, EQ_PRESETS, autoPreamp, clampGain, clampPreamp, dbToGain, eqBandsFor, gainToDb, meterLevel, presetById, resampleGains } from "../equalizer";

describe("equalizer", () => {
  it("ships well formed presets", () => {
    expect(EQ_BANDS).toHaveLength(10);
    for (const preset of EQ_PRESETS) {
      expect(preset.gains).toHaveLength(10);
      for (const gain of preset.gains) expect(clampGain(gain)).toBe(gain);
    }
    expect(presetById("flat").gains.every((g) => g === 0)).toBe(true);
    expect(presetById("does-not-exist").id).toBe("flat");
  });

  it("converts db and gain both ways", () => {
    expect(dbToGain(0)).toBeCloseTo(1, 6);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 2);
    expect(gainToDb(dbToGain(3))).toBeCloseTo(3, 5);
  });

  it("clamps gains and preamp", () => {
    expect(clampGain(99)).toBe(12);
    expect(clampGain(-99)).toBe(-12);
    expect(clampPreamp(99)).toBe(12);
    expect(clampPreamp(-99)).toBe(-18);
  });

  it("resamples presets onto other band counts", () => {
    const five = resampleGains([0, 0, 0, 0, 6, 6, 0, 0, 0, 0], 5);
    expect(five).toHaveLength(5);
    expect(five[2]).toBeGreaterThan(3);
    const same = resampleGains([1, 2, 3], 3);
    expect(same).toEqual([1, 2, 3]);
    expect(resampleGains([], 4)).toEqual([0, 0, 0, 0]);
  });

  it("computes headroom preamp", () => {
    expect(autoPreamp([0, 0, 0])).toBe(0);
    expect(autoPreamp([6, 0, 0])).toBeLessThanOrEqual(0);
    expect(autoPreamp([-6, 0, 0])).toBeGreaterThan(0);
  });

  it("generates band centres", () => {
    const bands = eqBandsFor(10);
    expect(bands[0]).toBe(20);
    expect(bands[9]).toBe(20000);
  });

  it("measures signal level", () => {
    expect(meterLevel([])).toBe(0);
    expect(meterLevel([0, 0, 0])).toBe(0);
    expect(meterLevel([1, 1, 1])).toBe(1);
    expect(meterLevel([1, 0, 0], true)).toBeGreaterThan(0.9);
  });
});
