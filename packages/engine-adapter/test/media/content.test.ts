import { describe, expect, it } from "vitest";

import type { ContentBlock } from "../../src/conversation.js";
import type { ToolContent } from "../../src/tools.js";
import {
  convertModelContent,
  convertToolContent,
  type MediaAssetReader,
} from "../../src/internal/media/content.js";

const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

function readerOf(assetId: string, bytes: Uint8Array): MediaAssetReader {
  return {
    read: (id) => (id === assetId ? { bytes, mediaType: "image/png" } : null),
  };
}

describe("媒體內容區塊轉換", () => {
  it("同一張圖片轉兩次，送出的位元組與 MIME 完全相同", async () => {
    const blocks: ContentBlock[] = [
      { type: "text", text: "看一下這張圖" },
      { type: "image", assetId: "asset-1", mediaType: "image/png" },
    ];
    const options = {
      modelInput: ["text", "image"] as const,
      reader: readerOf("asset-1", PNG_BYTES),
    };

    const first = await convertModelContent(blocks, options);
    const second = await convertModelContent(blocks, options);

    expect(first.content).toEqual(second.content);
    const parts = first.content as readonly { type: string; data?: string; mimeType?: string }[];
    const image = parts.find((part) => part.type === "image");
    expect(image).toEqual({
      type: "image",
      data: Buffer.from(PNG_BYTES).toString("base64"),
      mimeType: "image/png",
    });
  });

  it("模型不支援圖片時回文字替身與原因", async () => {
    const result = await convertModelContent(
      [{ type: "image", assetId: "asset-1", mediaType: "image/png" }],
      { modelInput: ["text"], reader: readerOf("asset-1", PNG_BYTES) },
    );

    expect(result.content).toContain("model_input_unsupported:image");
    expect(result.content).toContain("主模型不支援圖片輸入");
    expect(result.fallbacks).toEqual([
      { assetId: "asset-1", kind: "image", reason: "model_input_unsupported:image" },
    ]);
  });

  it("沒有原檔讀取或讀不到位元組時回文字替身，不丟錯", async () => {
    const noReader = await convertModelContent(
      [{ type: "image", assetId: "asset-1", mediaType: "image/png" }],
      { modelInput: ["text", "image"] },
    );
    expect(noReader.fallbacks[0]?.reason).toBe("media_reader_unavailable");

    const missing = await convertModelContent(
      [{ type: "image", assetId: "asset-2", mediaType: "image/png" }],
      { modelInput: ["text", "image"], reader: readerOf("asset-1", PNG_BYTES) },
    );
    expect(missing.fallbacks[0]?.reason).toBe("media_asset_unavailable");
    expect(missing.content).toContain("讀不到原檔位元組");
  });

  it("音訊即使模型支援也回文字替身，原因是引擎沒有音訊區塊", async () => {
    const result = await convertModelContent(
      [{ type: "audio", assetId: "audio-1", mediaType: "audio/mp4" }],
      { modelInput: ["text", "image", "audio"] },
    );

    expect(result.fallbacks[0]?.reason).toBe("engine_input_unsupported:audio");
    expect(result.content).toContain("引擎 1.5.2 沒有音訊內容區塊");
  });

  it("工具結果的圖片同樣轉成引擎區塊，不退回 assetId 文字", async () => {
    const content: ToolContent[] = [
      { type: "text", text: "已載入圖片" },
      { type: "image", assetId: "asset-1", mediaType: "image/png" },
    ];
    const result = await convertToolContent(content, {
      modelInput: ["text", "image"],
      reader: readerOf("asset-1", PNG_BYTES),
    });

    expect(result.content).toEqual([
      { type: "text", text: "已載入圖片" },
      {
        type: "image",
        data: Buffer.from(PNG_BYTES).toString("base64"),
        mimeType: "image/png",
      },
    ]);
    expect(JSON.stringify(result.content)).not.toContain("[image asset-1]");
  });

  it("工具帶來的位元組優先於媒體服務，送出的就是翻牌當下的縮圖", async () => {
    const thumbnail = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
    const result = await convertToolContent(
      [{ type: "image", assetId: "asset-1", mediaType: "image/jpeg", bytes: thumbnail }],
      {
        modelInput: ["text", "image"],
        // 媒體服務若被誤用會回不同位元組，測試就會失敗。
        reader: readerOf("asset-1", PNG_BYTES),
      },
    );

    expect(result.content).toEqual([
      {
        type: "image",
        data: Buffer.from(thumbnail).toString("base64"),
        mimeType: "image/jpeg",
      },
    ]);
  });

  it("工具帶來位元組時，沒有媒體服務也能送出圖片", async () => {
    const result = await convertToolContent(
      [{ type: "image", assetId: "asset-1", mediaType: "image/png", bytes: PNG_BYTES }],
      { modelInput: ["text", "image"] },
    );

    expect(result.fallbacks).toEqual([]);
    expect(result.content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
  });
});
