import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { OCR_TIMEOUT_MS, TRANSCRIBE_TIMEOUT_MS } from "../../../src/modules/media/recognition.js";

/**
 * 辨識完成後，主機還要寫文字替身與建卡；客戶端的等待上限至少要多留這麼多。
 */
const POST_RECOGNITION_BUDGET_MS = 30_000;

async function readRepositoryFile(relativePath: string): Promise<string> {
  return readFile(new URL(`../../../../../${relativePath}`, import.meta.url), "utf8");
}

async function swiftMediaImportTimeoutMs(): Promise<number> {
  const source = await readRepositoryFile(
    "apple/CardiaryKit/Sources/CardiaryKit/Client/MediaImportLimits.swift",
  );
  const match = /requestTimeout:\s*Duration\s*=\s*\.seconds\((\d+)\)/.exec(source);
  if (!match) {
    throw new Error("MediaImportLimits.swift 找不到 requestTimeout 的秒數");
  }
  return Number(match[1]) * 1000;
}

describe("媒體匯入的等待上限", () => {
  it("殼端等得比主機的辨識上限久，慢速 OCR 才不會被誤判逾時", async () => {
    const clientTimeoutMs = await swiftMediaImportTimeoutMs();
    expect(clientTimeoutMs).toBeGreaterThanOrEqual(OCR_TIMEOUT_MS + POST_RECOGNITION_BUDGET_MS);
    expect(clientTimeoutMs).toBeGreaterThanOrEqual(
      TRANSCRIBE_TIMEOUT_MS + POST_RECOGNITION_BUDGET_MS,
    );
  });

  it("匯入請求真的採用媒體匯入的期限，而不是一般請求的預設值", async () => {
    const connection = await readRepositoryFile(
      "apple/CardiaryKit/Sources/CardiaryKit/Client/CardiaryConnection.swift",
    );
    expect(connection).toMatch(/options:\s*RequestOptions\s*=\s*MediaImportLimits\.requestOptions/);
  });
});
