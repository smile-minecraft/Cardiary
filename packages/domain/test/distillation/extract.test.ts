import { describe, expect, it } from "vitest";

import {
  MEMORY_TEXT_MAX_LENGTH,
  memoryCardTitleAndSummary,
  memoryContentHash,
  normalizeMemoryText,
  validateDistillationOutput,
} from "../../src/distillation/index.js";

describe("正規化與內容雜湊", () => {
  it("連續空白壓成一個、去頭尾、NFC 正規化", () => {
    expect(normalizeMemoryText("  使用者\n\t偏好　雙空白  ")).toBe("使用者 偏好 雙空白");
    // 全形空白也在 \s 內；字形本身（NFD/NFC）先統一再比較。
    expect(normalizeMemoryText("e\u0301")).toBe("é");
  });

  it("不同內容雜湊不同、相同內容雜湊一致", () => {
    const left = memoryContentHash({ type: "fact", text: "使用者 住在台北" });
    const right = memoryContentHash({ type: "fact", text: "使用者住在台北" });
    // 換行與連續空白正規化為一個空格，內容相同雜湊相同。
    const same = memoryContentHash({ type: "fact", text: "使用者\n住在台北" });
    expect(left).not.toBe(right);
    expect(left).toBe(same);
  });

  it("type 不同時雜湊不同", () => {
    const fact = memoryContentHash({ type: "fact", text: "要換帶磁碟的機器" });
    const decision = memoryContentHash({ type: "decision", text: "要換帶磁碟的機器" });
    expect(fact).not.toBe(decision);
  });
});

describe("提煉輸出驗證", () => {
  it("items 不是陣列、type 不合法、text 空或超過 500 字都算失敗", () => {
    expect(validateDistillationOutput(null).ok).toBe(false);
    expect(validateDistillationOutput({ items: "nope" }).ok).toBe(false);
    expect(validateDistillationOutput({ items: [{ type: "opinion", text: "x" }] }).ok).toBe(false);
    expect(validateDistillationOutput({ items: [{ type: "fact", text: "   " }] }).ok).toBe(false);
    expect(
      validateDistillationOutput({
        items: [{ type: "fact", text: "a".repeat(MEMORY_TEXT_MAX_LENGTH + 1) }],
      }).ok,
    ).toBe(false);
    expect(
      validateDistillationOutput({
        items: [{ type: "fact", text: "a".repeat(MEMORY_TEXT_MAX_LENGTH) }],
      }).ok,
    ).toBe(true);
  });

  it("任何一條不合格就整張卡失敗；空 items 是合法結果", () => {
    const result = validateDistillationOutput({
      items: [
        { type: "fact", text: "甲事實成立" },
        { type: "wrong", text: "壞的一條" },
      ],
    });
    expect(result.ok).toBe(false);
    expect(validateDistillationOutput({ items: [] })).toEqual({ ok: true, items: [] });
  });

  it("輸出全部收下時保留順序並正規化文字", () => {
    const result = validateDistillationOutput({
      items: [
        { type: "preference", text: "  偏好雙空白   的輸入  " },
        { type: "decision", text: "改用 SSD" },
      ],
    });
    if (!result.ok) throw new Error("應通過驗證");
    expect(result.items).toEqual([
      { type: "preference", text: "偏好雙空白 的輸入" },
      { type: "decision", text: "改用 SSD" },
    ]);
  });
});

describe("記憶卡標題與摘要", () => {
  it("模型沒給標題時從內文衍生，超過上限截斷", () => {
    const longText = "甲".repeat(100);
    const { title } = memoryCardTitleAndSummary({}, longText);
    expect(Array.from(title)).toHaveLength(40);
  });

  it("標題整理掉換行與多餘空白；摘要只取第一行", () => {
    const { title, summary } = memoryCardTitleAndSummary(
      { title: "  使用者\n希望\t換\t\t電腦  ", summary: "第一行。\n第二行被捨棄。" },
      "內文",
    );
    expect(title).toBe("使用者 希望 換 電腦");
    expect(summary).toBe("第一行。");
  });
});
