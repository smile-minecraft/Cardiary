import { rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMediaToolBundle } from "../../../src/modules/media/tools.js";
import { fakeBroker, fakeModels, makeMediaFixture, type MediaFixture } from "./helpers.js";

const fixtures: MediaFixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close();
});

async function fixture(
  options: Parameters<typeof makeMediaFixture>[0] = {},
): Promise<MediaFixture> {
  const created = await makeMediaFixture(options);
  fixtures.push(created);
  return created;
}

async function pngBytes(): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({
      create: { width: 120, height: 80, channels: 3, background: { r: 200, g: 80, b: 30 } },
    })
      .png()
      .toBuffer(),
  );
}

async function* chunks(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}

const IMAGE_MODEL = {
  providers: [
    {
      providerId: "local",
      models: [{ modelId: "vision", input: ["text", "image"] as const }],
    },
  ],
  resolved: [{ role: "main", ref: { providerId: "local", modelId: "vision" } }],
};

const TEXT_ONLY_MODEL = {
  providers: [
    {
      providerId: "local",
      models: [{ modelId: "text", input: ["text"] as const }],
    },
  ],
  resolved: [{ role: "main", ref: { providerId: "local", modelId: "text" } }],
};

async function imageCard(f: MediaFixture): Promise<string> {
  const bytes = await pngBytes();
  const blob = await f.store.put({ bytes: chunks(bytes), mediaType: "image/png" });
  const imported = await f.media.import({
    blobId: blob.blobId,
    title: "翻牌測試",
  });
  return imported.card.cardId;
}

/** 翻牌工具與它需要的工具呼叫環境。 */
function flipTool(f: MediaFixture) {
  const bundle = createMediaToolBundle({ media: f.media });
  const tool = bundle.tools[0];
  if (tool === undefined) throw new Error("找不到 card_flip");
  const context = {
    conversationId: "conv",
    turnId: "turn",
    callId: "call",
    toolName: "card_flip",
    signal: new AbortController().signal,
    tempDir: join(f.folder, "tmp"),
    workingDir: f.folder,
    requestApproval: async () => ({ outcome: "approved" }),
    spawn: () => {
      throw new Error("不需要子行程");
    },
  };
  return { tool, context: context as never };
}

describe("翻牌", () => {
  it("同一張圖片卡翻兩次位元組完全相同；縮圖在 cache/thumbs，刪掉重產仍相同", async () => {
    const f = await fixture({
      recognition: fakeBroker({ ocr: { available: true, text: "測試圖片" } }),
      models: fakeModels(),
      modelState: IMAGE_MODEL,
      conversationModel: { provider: "local", model: "vision" },
    });
    const cardId = await imageCard(f);
    const first = await f.media.flip({ cardId, conversationId: "conv" });
    expect(first.loaded).toBe(true);
    expect(first.mediaType).toBe("image/jpeg");
    expect(first.bytes?.byteLength).toBeGreaterThan(0);
    const second = await f.media.flip({ cardId, conversationId: "conv" });
    expect(Buffer.from(second.bytes ?? []).equals(Buffer.from(first.bytes ?? []))).toBe(true);
    const thumbs = readdirSync(join(f.folder, "cache", "thumbs"));
    expect(thumbs).toHaveLength(1);
    expect(existsSync(join(f.folder, "cache", "thumbs", thumbs[0] as string))).toBe(true);

    rmSync(join(f.folder, "cache"), { recursive: true, force: true });
    const rebuilt = await f.media.flip({ cardId, conversationId: "conv" });
    expect(Buffer.from(rebuilt.bytes ?? []).equals(Buffer.from(first.bytes ?? []))).toBe(true);
  });

  it("主模型不支援圖片時回文字替身與原因，回合不失敗", async () => {
    const f = await fixture({
      recognition: fakeBroker({ ocr: { available: true, text: "測試圖片" } }),
      models: fakeModels(),
      modelState: TEXT_ONLY_MODEL,
      conversationModel: { provider: "local", model: "text" },
    });
    const cardId = await imageCard(f);
    const result = await f.media.flip({ cardId, conversationId: "conv" });
    expect(result.loaded).toBe(false);
    expect(result.reason).toBe("model_input_unsupported:image");
    expect(result.text).toContain("## OCR 文字");
  });

  it("音訊一律回文字替身：needAudio=true 時標引擎原因，沒有讀原檔也不算載入", async () => {
    const f = await fixture({
      recognition: fakeBroker({
        transcribe: { available: true, text: "逐字稿內容" },
      }),
      models: fakeModels(),
      modelState: {
        providers: [
          {
            providerId: "local",
            models: [{ modelId: "audio", input: ["text", "audio"] as const }],
          },
        ],
        resolved: [{ role: "main", ref: { providerId: "local", modelId: "audio" } }],
      },
      conversationModel: { provider: "local", model: "audio" },
    });
    const bytes = new TextEncoder().encode("audio-original-bytes");
    const blob = await f.store.put({ bytes: chunks(bytes), mediaType: "audio/mp4" });
    const imported = await f.media.import({ blobId: blob.blobId });
    const read = vi.spyOn(f.store, "read");
    const textOnly = await f.media.flip({
      cardId: imported.card.cardId,
      conversationId: "conv",
    });
    expect(textOnly.loaded).toBe(false);
    expect(textOnly.reason).toBe("audio_not_requested");
    expect(textOnly.text).toContain("## 逐字稿");
    const requested = await f.media.flip({
      cardId: imported.card.cardId,
      conversationId: "conv",
      needAudio: true,
    });
    expect(requested.loaded).toBe(false);
    expect(requested.reason).toBe("engine_input_unsupported:audio");
    expect(requested.bytes).toBeUndefined();
    expect(requested.text).toContain("## 逐字稿");
    expect(read).not.toHaveBeenCalled();
    // 沒有載入原檔就不算一次翻牌載入：`card_loads` 沒有紀錄。
    const loads = f.storage.state.get<{ readonly n: number }>(
      "SELECT COUNT(*) AS n FROM card_loads WHERE card_id = ?",
      imported.card.cardId,
    );
    expect(Number(loads?.n ?? -1)).toBe(0);
  });

  it("模型不支援音訊且 needAudio=true 時，回文字替身並標模型原因", async () => {
    const f = await fixture({
      recognition: fakeBroker({
        transcribe: { available: true, text: "逐字稿內容" },
      }),
      models: fakeModels(),
      modelState: TEXT_ONLY_MODEL,
      conversationModel: { provider: "local", model: "text" },
    });
    const bytes = new TextEncoder().encode("audio-original-bytes");
    const blob = await f.store.put({ bytes: chunks(bytes), mediaType: "audio/mp4" });
    const imported = await f.media.import({ blobId: blob.blobId });
    const result = await f.media.flip({
      cardId: imported.card.cardId,
      conversationId: "conv",
      needAudio: true,
    });
    expect(result.loaded).toBe(false);
    expect(result.reason).toBe("model_input_unsupported:audio");
    expect(result.text).toContain("## 逐字稿");
  });

  it("card_flip 工具對音訊回純文字替身，不再宣稱已載入原檔", async () => {
    const f = await fixture({
      recognition: fakeBroker({
        transcribe: { available: true, text: "逐字稿內容" },
      }),
      models: fakeModels(),
      modelState: {
        providers: [
          {
            providerId: "local",
            models: [{ modelId: "audio", input: ["text", "audio"] as const }],
          },
        ],
        resolved: [{ role: "main", ref: { providerId: "local", modelId: "audio" } }],
      },
      conversationModel: { provider: "local", model: "audio" },
    });
    const bytes = new TextEncoder().encode("audio-original-bytes");
    const blob = await f.store.put({ bytes: chunks(bytes), mediaType: "audio/mp4" });
    const imported = await f.media.import({ blobId: blob.blobId });
    const { tool, context } = flipTool(f);
    const outcome = await tool.execute({ cardId: imported.card.cardId, needAudio: true }, context);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.content.every((block) => block.type === "text")).toBe(true);
    const text = outcome.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n");
    expect(text).toContain("engine_input_unsupported:audio");
    expect(text).toContain("## 逐字稿");
    const metadata = outcome.metadata as { loaded: boolean; reason: string };
    expect(metadata.loaded).toBe(false);
    expect(metadata.reason).toBe("engine_input_unsupported:audio");
  });

  it("card_flip 工具回圖片內容區塊與固定的位元組摘要", async () => {
    const f = await fixture({
      recognition: fakeBroker({ ocr: { available: true, text: "測試圖片" } }),
      models: fakeModels(),
      modelState: IMAGE_MODEL,
      conversationModel: { provider: "local", model: "vision" },
    });
    const cardId = await imageCard(f);
    const { tool, context } = flipTool(f);
    const outcome = await tool.execute({ cardId }, context);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const metadata = outcome.metadata as {
      loaded: boolean;
      sha256: string;
      byteLength: number;
    };
    expect(metadata.loaded).toBe(true);
    expect(metadata.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(outcome.content.some((block) => block.type === "image")).toBe(true);
    const again = await tool.execute({ cardId }, context);
    expect(again.ok && (again.metadata as { sha256: string }).sha256).toBe(metadata.sha256);
  });
});
