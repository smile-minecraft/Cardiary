import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { baselineEmotion, type EmotionState } from "@cardiary/domain";

export class EmotionStore {
  readonly #path: string;
  readonly #diagnose: (message: string) => void;

  constructor(stateDirectory: string, diagnose: (message: string) => void) {
    this.#path = join(stateDirectory, "emotion.json");
    this.#diagnose = diagnose;
  }

  read(now: Date): EmotionState {
    let text: string;
    try {
      text = readFileSync(this.#path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return baselineEmotion(now);
      throw error;
    }
    try {
      const value: unknown = JSON.parse(text);
      if (!isEmotionState(value)) throw new Error("invalid emotion state");
      return value;
    } catch {
      this.#diagnose("情緒狀態檔案損毀，已回到基準值。");
      return baselineEmotion(now);
    }
  }

  write(state: EmotionState): void {
    mkdirSync(dirname(this.#path), { recursive: true });
    const temporary = `${this.#path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(state)}\n`, { flag: "wx", mode: 0o600 });
      renameSync(temporary, this.#path);
    } finally {
      // 清理只針對 rename 前就失敗的暫存檔；不覆蓋 try 的錯誤。
      try {
        unlinkSync(temporary);
      } catch {
        /* 已 rename 或無權刪除都可忽略 */
      }
    }
  }
}

function isEmotionState(value: unknown): value is EmotionState {
  if (value === null || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  const numberIn = (key: string, min: number): boolean =>
    typeof state[key] === "number" &&
    Number.isFinite(state[key]) &&
    state[key] >= min &&
    state[key] <= 1;
  return (
    numberIn("valence", -1) &&
    numberIn("arousal", 0) &&
    numberIn("confidence", 0) &&
    numberIn("focus", 0) &&
    typeof state.updatedAt === "string" &&
    Number.isFinite(Date.parse(state.updatedAt))
  );
}
