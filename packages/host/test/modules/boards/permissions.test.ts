import { describe, expect, it } from "vitest";

import { createToolPermissionGate } from "../../../src/permissions/gate.js";

const gate = createToolPermissionGate({
  workingDir: "/project",
  folderRoot: "/data",
  allowlist: { match: () => null },
});

function request(toolName: string) {
  return {
    conversationId: "conversation",
    turnId: "turn",
    toolCallId: "call",
    toolName,
    input: { boardId: "board", title: "title", body: "body" },
    replay: "unsafe" as const,
    permissionMode: "hard-rules" as const,
  };
}

describe("白板工具權限", () => {
  it("同時建卡和放進白板沿用建立卡片的自動放行規則", async () => {
    expect(await gate.evaluate(request("create_card_on_board"))).toEqual({ kind: "allow" });
  });

  it("投影既有卡片每次都要求人類確認", async () => {
    const verdict = await gate.evaluate(request("project_card_to_board"));
    expect(verdict.kind).toBe("ask-human");
    if (verdict.kind === "ask-human") expect(verdict.action.details).toBeUndefined();
  });
});
