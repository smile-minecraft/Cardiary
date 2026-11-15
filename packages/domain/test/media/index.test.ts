import { describe, expect, it } from "vitest";

import {
  composeTextStandIn,
  defaultMediaTitle,
  extensionOfMediaType,
  mediaKindOf,
  normalizeMediaType,
} from "../../src/media/index.js";

describe("媒體類型", () => {
  it("只接受圖片與音訊，帶參數的 Content-Type 也能辨識", () => {
    expect(mediaKindOf("image/png")).toBe("image");
    expect(mediaKindOf("image/jpeg; charset=binary")).toBe("image");
    expect(mediaKindOf("audio/mp4")).toBe("audio");
    expect(mediaKindOf("application/pdf")).toBeUndefined();
    expect(mediaKindOf("text/plain")).toBeUndefined();
    expect(normalizeMediaType(" Audio/MP4 ; x=1")).toBe("audio/mp4");
    expect(extensionOfMediaType("image/jpeg")).toBe("jpg");
    expect(extensionOfMediaType("audio/mpeg")).toBe("mp3");
    expect(extensionOfMediaType("application/pdf")).toBeUndefined();
  });
});

describe("文字替身", () => {
  it("圖片把描述與 OCR 排成內文，來源標明本機與小模型", () => {
    const standIn = composeTextStandIn({
      kind: "image",
      description: "一張會議白板的照片。",
      ocrText: "預算 120 萬\n排程延到三月",
    });
    expect(standIn.sources).toEqual({
      ocr: "local",
      description: "small-model",
      transcript: "none",
      summary: "none",
    });
    expect(standIn.text).toContain("## 描述");
    expect(standIn.text).toContain("會議白板");
    expect(standIn.text).toContain("## OCR 文字");
    expect(standIn.text).toContain("預算 120 萬");
    expect(standIn.text).not.toContain("## 缺少的部分");
  });

  it("音訊把摘要與逐字稿排成內文", () => {
    const standIn = composeTextStandIn({
      kind: "audio",
      summary: "討論搬家與租約。",
      transcript: "我們下週去看房子。",
    });
    expect(standIn.sources.summary).toBe("small-model");
    expect(standIn.sources.transcript).toBe("local");
    expect(standIn.text).toContain("## 摘要");
    expect(standIn.text).toContain("## 逐字稿");
    expect(standIn.text).toContain("下週去看房子");
  });

  it("缺少本機辨識時留空並標明，不假裝完整", () => {
    const standIn = composeTextStandIn({ kind: "image" });
    expect(standIn.sources.ocr).toBe("none");
    expect(standIn.sources.description).toBe("none");
    expect(standIn.text).toContain("## 缺少的部分");
    expect(standIn.text).toContain("本機 OCR 沒有產生文字");
    expect(standIn.missing.length).toBeGreaterThan(0);
  });

  it("外部提供的缺少說明會保留，且不重複", () => {
    const standIn = composeTextStandIn({
      kind: "audio",
      missing: ["殼路由回 available:false：not_authorized"],
    });
    expect(standIn.text).toContain("殼路由回 available:false：not_authorized");
    expect(standIn.text.match(/本機語音轉文字沒有產生逐字稿/g)).toHaveLength(1);
  });

  it("文字被截斷時標明", () => {
    const standIn = composeTextStandIn({
      kind: "image",
      ocrText: "前段文字",
      truncated: true,
    });
    expect(standIn.text).toContain("只保留前段");
  });
});

describe("預設標題", () => {
  it("用第一段內容加內容雜湊，沒有內容時用種類名稱", () => {
    expect(
      defaultMediaTitle({
        kind: "image",
        blobId: "a".repeat(64),
        text: "> 文字替身\n\n## OCR 文字\n\n會議記錄\n",
      }),
    ).toBe("會議記錄（aaaaaaaa）");
    expect(defaultMediaTitle({ kind: "audio", blobId: "b".repeat(64), text: "> 文字替身\n" })).toBe(
      "音訊（bbbbbbbb）",
    );
  });
});
