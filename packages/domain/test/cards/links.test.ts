import { describe, expect, it } from "vitest";

import { extractOutgoingLinks, normalizeLinkText } from "../../src/cards/index.js";

describe("[[ ]] 連結", () => {
  it("依出現順序取出目標，同目標只留第一次", () => {
    expect(
      extractOutgoingLinks("參考 [[會議筆記]] 與 [[01JCX8Q3W7Z9K5V2N4M6P8R0T1]]、[[會議筆記]]。"),
    ).toEqual([
      { target: "會議筆記", ordinal: 0 },
      { target: "01JCX8Q3W7Z9K5V2N4M6P8R0T1", ordinal: 1 },
    ]);
  });

  it("目標可以是標題（含空白）", () => {
    expect(extractOutgoingLinks("見 [[我的  卡片：甲]]")).toEqual([
      { target: "我的  卡片：甲", ordinal: 0 },
    ]);
  });

  it("空的目標與不完整的語法不算連結", () => {
    expect(extractOutgoingLinks("[[]] [[]] [ [單括號] ] plain")).toEqual([]);
  });

  it("標題比對的正規化：大小寫與空白", () => {
    expect(normalizeLinkText("  My   Card ：甲 ")).toBe(normalizeLinkText("my card ：甲"));
  });
});
