import { describe, expect, it } from "vitest";
import { applyEmotionTurn, baselineEmotion, decayEmotion } from "../../src/emotion/index.js";

const start = new Date("2026-01-01T00:00:00.000Z");

describe("emotion", () => {
  it("decays halfway to each baseline in six hours", () => {
    const state = {
      valence: 1,
      arousal: 1,
      confidence: 0,
      focus: 1,
      updatedAt: start.toISOString(),
    };
    const result = decayEmotion(state, new Date("2026-01-01T06:00:00.000Z"));
    expect(result.valence).toBeCloseTo(0.5);
    expect(result.arousal).toBeCloseTo(0.75);
    expect(result.confidence).toBeCloseTo(0.25);
    expect(result.focus).toBeCloseTo(0.75);
    const afterTwelveHours = decayEmotion(state, new Date("2026-01-01T12:00:00.000Z"));
    expect(afterTwelveHours.valence).toBeCloseTo(0.25);
    expect(afterTwelveHours.arousal).toBeCloseTo(0.625);
  });

  it("limits each change and clamps values to their allowed ranges", () => {
    const initial = { ...baselineEmotion(start), valence: 0.95, arousal: 0.05 };
    const result = applyEmotionTurn(
      initial,
      { valence: 1, arousal: -1, confidence: 1, focus: -1 },
      start,
    );
    expect(result.valence).toBe(1);
    expect(result.arousal).toBe(0);
    expect(result.confidence).toBeCloseTo(0.65);
    expect(result.focus).toBeCloseTo(0.35);
  });
});
