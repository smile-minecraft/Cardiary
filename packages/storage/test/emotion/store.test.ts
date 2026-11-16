import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EmotionStore } from "../../src/emotion/index.js";

describe("EmotionStore", () => {
  it("records a diagnostic and returns baseline for a corrupted file", () => {
    const root = mkdtempSync(join(tmpdir(), "cardiary-emotion-"));
    try {
      writeFileSync(join(root, "emotion.json"), "{broken");
      const messages: string[] = [];
      const store = new EmotionStore(root, (message) => messages.push(message));
      const now = new Date("2026-01-01T00:00:00.000Z");
      const state = store.read(now);
      expect(state).toEqual({
        valence: 0,
        arousal: 0.5,
        confidence: 0.5,
        focus: 0.5,
        updatedAt: now.toISOString(),
      });
      expect(messages).toHaveLength(1);
      store.write(state);
      expect(JSON.parse(readFileSync(join(root, "emotion.json"), "utf8"))).toEqual(state);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
