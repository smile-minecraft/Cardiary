import { describe, expect, it } from "vitest";

import {
  MAX_RELATED_PATHS,
  buildSummaryPrompt,
  encodeSummaryFooter,
  extractRelatedPaths,
  parseSummaryFooter,
  planCompaction,
  renderTranscript,
  summaryTitle,
  type CompactionMessage,
} from "../../src/context/index.js";

function message(cursor: string, overrides: Partial<CompactionMessage> = {}): CompactionMessage {
  return { cursor, role: "user", text: cursor, tokenEstimate: 1000, ...overrides };
}

describe("壓縮範圍", () => {
  it("保留最近的 token 量，前面的才摘要", () => {
    const messages = [message("m1"), message("m2"), message("m3"), message("m4")];

    const plan = planCompaction(messages, { keepRecentTokens: 2000 });

    expect(plan?.keepFromCursor).toBe("m3");
    expect(plan?.dropped.map((item) => item.cursor)).toEqual(["m1", "m2"]);
    expect(plan?.kept.map((item) => item.cursor)).toEqual(["m3", "m4"]);
    expect(plan?.droppedTokens).toBe(2000);
  });

  it("未完成的工具呼叫之前一定保留，不能把呼叫和結果切開", () => {
    const messages = [
      message("m1"),
      message("m2"),
      message("m3", {
        role: "assistant",
        tool: { callId: "call_1", name: "card_patch", completed: false },
        tokenEstimate: 100,
      }),
      message("m4", {
        role: "tool",
        tool: { callId: "call_1", name: "card_patch", completed: false },
        tokenEstimate: 100,
      }),
    ];

    const plan = planCompaction(messages, { keepRecentTokens: 100 });

    expect(plan?.keepFromCursor).toBe("m3");
  });

  it("沒有東西可丟時不做壓縮", () => {
    expect(planCompaction([message("m1")], { keepRecentTokens: 8000 })).toBeNull();
    expect(planCompaction([], { keepRecentTokens: 8000 })).toBeNull();
    expect(planCompaction([message("m1"), message("m2")], { keepRecentTokens: 10_000 })).toBeNull();
  });
});

describe("相關路徑", () => {
  it("從工具參數抽出 path 類欄位，重複的只留一次", () => {
    const paths = extractRelatedPaths([
      '{"path":"src/a.ts","other":1}',
      '{"file_path":"src/b.ts"}',
      '{"filePath":"src/a.ts"}',
      "沒有路徑",
    ]);

    expect(paths).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("最多留 20 條，保留最新的", () => {
    const texts = Array.from(
      { length: MAX_RELATED_PATHS + 5 },
      (_value, index) => `{"path":"src/file-${index}.ts"}`,
    );

    const paths = extractRelatedPaths(texts);

    expect(paths).toHaveLength(MAX_RELATED_PATHS);
    expect(paths[0]).toBe("src/file-5.ts");
    expect(paths.at(-1)).toBe(`src/file-${MAX_RELATED_PATHS + 4}.ts`);
  });
});

describe("摘要卡的血緣", () => {
  it("標記寫進內文後可以完整讀回", () => {
    const body = `摘要內容\n\n${encodeSummaryFooter({
      conversationId: "conv_1",
      fromCursor: "entry_1",
      toCursor: "entry_9",
    })}`;

    expect(parseSummaryFooter(body)).toEqual({
      conversationId: "conv_1",
      fromCursor: "entry_1",
      toCursor: "entry_9",
    });
  });

  it("保留範圍寫進標記後可以完整讀回；舊標記仍讀得到前三個欄位", () => {
    const body = `摘要內容\n\n${encodeSummaryFooter({
      conversationId: "conv_1",
      fromCursor: "entry_1",
      toCursor: "entry_9",
      keepFromCursor: "entry_5",
    })}`;

    expect(parseSummaryFooter(body)).toEqual({
      conversationId: "conv_1",
      fromCursor: "entry_1",
      toCursor: "entry_9",
      keepFromCursor: "entry_5",
    });

    const legacy = `舊摘要\n\n<!-- cardiary:compaction ${JSON.stringify({
      conversationId: "conv_1",
      fromCursor: "entry_1",
      toCursor: "entry_9",
    })} -->`;
    expect(parseSummaryFooter(legacy)).toEqual({
      conversationId: "conv_1",
      fromCursor: "entry_1",
      toCursor: "entry_9",
    });
    // 舊標記沒有保留範圍，呼叫端要自己認出來。
    expect(parseSummaryFooter(legacy)?.keepFromCursor).toBeUndefined();
  });

  it("沒有標記或標記壞掉時回 null", () => {
    expect(parseSummaryFooter("只有摘要")).toBeNull();
    expect(parseSummaryFooter("<!-- cardiary:compaction {壞掉} -->")).toBeNull();
    expect(parseSummaryFooter('<!-- cardiary:compaction {"conversationId":1} -->')).toBeNull();
  });

  it("標題帶壓縮時間，方便分辨先後", () => {
    expect(summaryTitle("2026-11-15T04:00:00.000Z")).toBe("短期記憶 2026-11-15T04:00:00.000Z");
  });
});

describe("摘要提示", () => {
  it("提示包含保留重點、相關路徑、額外指示與逐字稿", () => {
    const prompt = buildSummaryPrompt({
      transcript: "使用者：修好測試\n\n助理：正在看",
      relatedPaths: ["src/a.ts"],
      instructions: "保留測試名稱",
    });

    expect(prompt).toContain("正在進行的步驟");
    expect(prompt).toContain("還沒完成的工具呼叫");
    expect(prompt).toContain("- src/a.ts");
    expect(prompt).toContain("保留測試名稱");
    expect(prompt).toContain("使用者：修好測試");
  });

  it("逐字稿標出工具結果，讓摘要模型分得出角色", () => {
    const text = renderTranscript([
      message("m1", { role: "assistant", text: "呼叫工具" }),
      message("m2", {
        role: "tool",
        text: "完成",
        tool: { callId: "call_1", name: "card_patch", completed: true },
      }),
    ]);

    expect(text).toContain("助理：");
    expect(text).toContain("工具結果（工具 card_patch）：");
  });
});
