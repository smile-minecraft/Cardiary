import { describe, expect, it } from "vitest";

import {
  CONTEXT_LAYERS,
  SYSTEM_LAYERS,
  assembleSystemContext,
  layerIndex,
  volatileStateText,
  type SystemSection,
} from "../../src/context/index.js";

describe("八層的固定順序", () => {
  it("層的順序固定，不隨輸入順序改變", () => {
    const sections: SystemSection[] = [
      { layer: "other-cards", title: "追加卡", text: "第三張" },
      { layer: "bedrock", title: "基岩", text: "不可改的設定" },
      { layer: "persona", title: "人格", text: "說話直接" },
    ];

    const text = assembleSystemContext(sections);

    expect(text.indexOf("## 基岩")).toBeLessThan(text.indexOf("## 人格"));
    expect(text.indexOf("## 人格")).toBeLessThan(text.indexOf("## 追加卡"));
  });

  it("八層的順序就是規格書的順序", () => {
    expect(CONTEXT_LAYERS).toEqual([
      "bedrock",
      "persona",
      "core-memory",
      "opening-memory",
      "short-term-memory",
      "other-cards",
      "working-context",
      "volatile-state",
    ]);
    expect(SYSTEM_LAYERS).toHaveLength(6);
    expect(layerIndex("working-context")).toBe(6);
    expect(layerIndex("volatile-state")).toBe(7);
  });

  it("同一層內依輸入順序排列，空內容不佔位置", () => {
    const text = assembleSystemContext([
      { layer: "other-cards", title: "第一張", text: "甲" },
      { layer: "other-cards", title: "空的", text: "" },
      { layer: "other-cards", title: "第二張", text: "乙" },
    ]);

    expect(text).toBe("## 第一張\n\n甲\n\n## 第二張\n\n乙");
  });

  it("逐字稿與尾端層不會被合成固定前綴", () => {
    const text = assembleSystemContext([
      { layer: "bedrock", title: "基岩", text: "設定" },
      { layer: "working-context", title: "對話內容", text: "不該出現" },
      { layer: "volatile-state", title: "目前時間", text: "不該出現" },
    ]);

    expect(text).toBe("## 基岩\n\n設定");
  });

  it("同樣的輸入一定得到同樣的位元組", () => {
    const sections: SystemSection[] = [
      { layer: "bedrock", title: "基岩", text: "設定" },
      { layer: "persona", title: "人格", text: "直接" },
    ];

    expect(assembleSystemContext(sections)).toBe(assembleSystemContext([...sections].reverse()));
  });
});

describe("第 8 層的尾端文字", () => {
  it("是 RFC 3339 加時區名稱，同一時刻位元組相同", () => {
    const now = new Date("2026-11-15T04:05:06.000Z");

    const text = volatileStateText(now, "Asia/Taipei");

    expect(text).toBe("目前時間：2026-11-15T04:05:06.000Z（Asia/Taipei）");
    expect(volatileStateText(now, "Asia/Taipei")).toBe(text);
  });

  it("不同時刻的內容不同，所以不能放進固定前綴", () => {
    const first = volatileStateText(new Date("2026-11-15T04:05:06.000Z"), "Asia/Taipei");
    const second = volatileStateText(new Date("2026-11-15T04:05:07.000Z"), "Asia/Taipei");

    expect(first).not.toBe(second);
  });
});
