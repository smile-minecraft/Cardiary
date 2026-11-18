import { describe, expect, it } from "vitest";

import { parseBlocks } from "../src/lib/markdown";

describe("Markdown 區塊解析", () => {
  it("段落、清單與段落之間各自成塊", () => {
    const blocks = parseBlocks("整理成三件事：\n\n1. 早上\n2. 下午\n\n要我先寫哪一件？");
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "list", "paragraph"]);
    expect(blocks[1]).toEqual({ kind: "list", ordered: true, items: ["早上", "下午"] });
  });

  it("清單後面緊接一般文字時，文字不會被吞進清單", () => {
    const blocks = parseBlocks("- 一\n- 二\n結尾");
    expect(blocks).toEqual([
      { kind: "list", ordered: false, items: ["一", "二"] },
      { kind: "paragraph", lines: ["結尾"] },
    ]);
  });

  it("程式碼區塊保留原文，裡面的 Markdown 不解析", () => {
    const blocks = parseBlocks("```\n# 不是標題\n<b>不是 HTML</b>\n```");
    expect(blocks).toEqual([{ kind: "code", text: "# 不是標題\n<b>不是 HTML</b>" }]);
  });

  it("標題與引言", () => {
    expect(parseBlocks("## 今天\n> 先分類再丟")).toEqual([
      { kind: "heading", level: 2, text: "今天" },
      { kind: "quote", lines: ["先分類再丟"] },
    ]);
  });

  it("原始 HTML 只是段落文字", () => {
    expect(parseBlocks("<script>alert(1)</script>")).toEqual([
      { kind: "paragraph", lines: ["<script>alert(1)</script>"] },
    ]);
  });
});
