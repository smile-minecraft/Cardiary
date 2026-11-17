import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ApprovalRequest } from "@cardiary/engine-adapter";
import { afterEach, describe, expect, it } from "vitest";

import { PersistentStorage } from "../../src/storage/persistent.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

function externalRequest(input: {
  readonly id: string;
  readonly approvalKey: string;
  readonly requestId: string;
}): ApprovalRequest {
  return {
    id: input.id,
    status: "pending",
    requestedAt: "2026-05-01T00:00:00.000Z",
    expiresAt: null,
    approvalKey: input.approvalKey,
    draft: {
      externalAgent: { sessionId: "agent-1", requestId: input.requestId },
      action: {
        kind: "tool-execution",
        summary: "OpenCode 想執行 bash",
        toolName: "bash",
        toolInput: { command: "ls" },
      },
      risk: "high",
      requestedBy: { kind: "agent", agentId: "agent-1" },
      timeoutMs: null,
    },
  };
}

describe("外部代理審批的持久化", () => {
  it("關閉重開後同一筆請求讀回相同決定，不同請求維持各自待決", async () => {
    const root = await mkdtemp(join(tmpdir(), "cardiary-approval-ledger-"));
    roots.push(root);
    const first = PersistentStorage.open({ path: root, initialize: true });
    const created = await first.approvals.record(
      externalRequest({ id: "approval-1", approvalKey: "key-1", requestId: "permission:1" }),
    );
    expect(created.kind).toBe("created");
    const committed = await first.approvals.commitDecision({
      requestId: "approval-1",
      verdict: "approve",
      decidedAt: "2026-05-01T00:00:05.000Z",
      decidedBy: { kind: "human", clientId: "test" },
    });
    expect(committed).toBe("committed");
    first.close();

    const second = PersistentStorage.open({ path: root });
    try {
      const again = await second.approvals.record(
        externalRequest({ id: "approval-1", approvalKey: "key-1", requestId: "permission:1" }),
      );
      expect(again.kind).toBe("decided");
      expect(again.request.status).toBe("approved");
      expect(again.request.decision?.verdict).toBe("approve");
      // 外部代理的身分跟著請求持久化，重開後仍看得出是哪個工作階段。
      expect(again.request.draft.externalAgent).toEqual({
        sessionId: "agent-1",
        requestId: "permission:1",
      });

      const byKey = await second.approvals.findByApprovalKey("key-1");
      expect(byKey?.status).toBe("approved");

      const other = await second.approvals.record(
        externalRequest({ id: "approval-2", approvalKey: "key-2", requestId: "permission:2" }),
      );
      expect(other.kind).toBe("created");
      expect(other.request.status).toBe("pending");
    } finally {
      second.close();
    }
  });
});
