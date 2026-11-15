import { describe, expect, it } from "vitest";

import { applyPatch, applyUnifiedDiff, CardPatchError } from "../../src/cards/index.js";

describe("統一 diff 套用", () => {
  it("單一 hunk 修改內文", () => {
    const body = "alpha\nbeta\ngamma\n";
    const diff = "@@ -1,3 +1,3 @@\n alpha\n-beta\n+BETA\n gamma\n";
    expect(applyUnifiedDiff(body, diff)).toBe("alpha\nBETA\ngamma\n");
  });

  it("多個 hunk", () => {
    const body = "one\ntwo\nthree\nfour\nfive\nsix\nseven\n";
    const diff = "@@ -1,2 +1,2 @@\n-one\n+ONE\n two\n@@ -6,2 +6,2 @@\n-six\n+SIX\n seven\n";
    expect(applyUnifiedDiff(body, diff)).toBe("ONE\ntwo\nthree\nfour\nfive\nSIX\nseven\n");
  });

  it("新增一行", () => {
    const body = "a\nb\n";
    const diff = "@@ -1,2 +1,3 @@\n a\n+added\n b\n";
    expect(applyUnifiedDiff(body, diff)).toBe("a\nadded\nb\n");
  });

  it("刪除一行", () => {
    const body = "a\nb\nc\n";
    const diff = "@@ -1,3 +1,2 @@\n a\n-b\n c\n";
    expect(applyUnifiedDiff(body, diff)).toBe("a\nc\n");
  });

  it("整段取代格式", () => {
    expect(applyPatch("舊內文", { format: "replace", text: "新內文" })).toBe("新內文");
  });

  it("上下文不符時丟 CardPatchError", () => {
    const body = "alpha\nbeta\n";
    const diff = "@@ -1,2 +1,2 @@\n alpha\n-wrong\n+BETA\n";
    expect(() => applyUnifiedDiff(body, diff)).toThrow(CardPatchError);
  });

  it("補丁沒有 hunk 丟 CardPatchError", () => {
    expect(() => applyUnifiedDiff("a\n", "--- a\n+++ b\n")).toThrow(CardPatchError);
  });

  it("補丁行數與標頭不符丟 CardPatchError", () => {
    const diff = "@@ -1,2 +1,2 @@\n-a\n+b\n";
    expect(() => applyUnifiedDiff("a\n", diff)).toThrow(CardPatchError);
  });

  it("支援 git 風格的額外標頭行", () => {
    const body = "a\nb\n";
    const diff =
      "diff --git a/f b/f\nindex 123..456 100644\n--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n-a\n+A\n b\n";
    expect(applyUnifiedDiff(body, diff)).toBe("A\nb\n");
  });

  it("忽略 \\ No newline at end of file 標記", () => {
    const body = "a\nb";
    const diff = "@@ -2 +2 @@\n-b\n+c\n\\ No newline at end of file\n";
    expect(applyUnifiedDiff(body, diff)).toBe("a\nc");
  });

  it("內文末尾有換行時套用後仍保留", () => {
    const body = "a\nb\n";
    const diff = "@@ -1,2 +1,2 @@\n-a\n+A\n b\n";
    expect(applyUnifiedDiff(body, diff)).toBe("A\nb\n");
  });

  it("內文開頭新增一行（oldStart = 0）", () => {
    const body = "old\n";
    const diff = "@@ -0,0 +1 @@\n+new\n";
    expect(applyUnifiedDiff(body, diff)).toBe("new\nold\n");
  });
});
