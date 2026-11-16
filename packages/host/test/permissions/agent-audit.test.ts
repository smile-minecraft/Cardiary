import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AgentAudit } from "../../src/permissions/agent-audit.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup() {
  const root = mkdtempSync(join(tmpdir(), "cardiary-audit-"));
  roots.push(root);
  mkdirSync(join(root, "state"));
  return { audit: new AgentAudit(join(root, "state"), 450), dir: join(root, "state") };
}

describe("代理稽核", () => {
  it("只記參數雜湊，輪替後刪除指定對話並保留其他對話", () => {
    const { audit, dir } = setup();
    const write = (conversationId: string, input: string) =>
      audit.append({
        conversationId,
        tool: "read_file",
        input: { path: input },
        reason: "System One 通過",
        probability: 0.9,
        modelId: "test-model",
      });
    write("remove", "private-input");
    write("keep", "other-input");
    write("remove", "private-input");
    const current = readFileSync(join(dir, "agent-audit.jsonl"), "utf8");
    const rotated = readFileSync(join(dir, "agent-audit.jsonl.1"), "utf8");
    expect(current + rotated).not.toContain("private-input");
    expect(current + rotated).not.toContain("other-input");
    expect(current + rotated).toContain('"inputHash"');
    audit.removeConversations(["remove"]);
    const remaining =
      readFileSync(join(dir, "agent-audit.jsonl"), "utf8") +
      readFileSync(join(dir, "agent-audit.jsonl.1"), "utf8");
    expect(remaining).not.toContain('"conversationId":"remove"');
    expect(remaining).toContain('"conversationId":"keep"');
  });
});
