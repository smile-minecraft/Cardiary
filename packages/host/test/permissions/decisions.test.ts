import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ApprovalRequestDraft, ToolPermissionVerdict } from "@cardiary/engine-adapter";
import { FakeApprovalService } from "@cardiary/engine-fake";

import { ApprovalAllowlistStore } from "../../src/permissions/allowlist.js";
import { PermissionDecisionService } from "../../src/permissions/decisions.js";
import { createToolPermissionGate } from "../../src/permissions/gate.js";
import { MemoryApprovalLedger } from "../../src/storage/memory.js";
import { openPermissionFixture, type PermissionFixture } from "./support.js";

let fixture: PermissionFixture;
let store: ApprovalAllowlistStore;
let approvals: FakeApprovalService;
let decisions: PermissionDecisionService;
const clock = { now: () => new Date("2026-11-15T00:00:00.000Z") };
const human = { kind: "human" as const, clientId: "client-1" };

beforeEach(() => {
  fixture = openPermissionFixture();
  store = new ApprovalAllowlistStore(fixture.storage.state);
  approvals = new FakeApprovalService({ ledger: new MemoryApprovalLedger(), clock });
  decisions = new PermissionDecisionService({ approvals, allowlist: store, now: clock.now });
  writeFileSync(join(fixture.project, "notes.md"), "notes");
});

afterEach(() => {
  fixture.cleanup();
});

function gate() {
  return createToolPermissionGate({
    workingDir: fixture.project,
    folderRoot: fixture.folder,
    allowlist: store,
  });
}

async function ask(toolName: string, input: unknown) {
  const verdict = await gate().evaluate({
    conversationId: "c1",
    turnId: "t1",
    toolCallId: "call-1",
    toolName,
    input: input as never,
    replay: "unsafe",
    permissionMode: "hard-rules",
  });
  if (verdict.kind !== "ask-human") {
    throw new Error(`預期 ask-human，得到 ${verdict.kind}`);
  }
  const draft: ApprovalRequestDraft = {
    conversationId: "c1",
    turnId: "t1",
    toolCallId: "call-1",
    action: verdict.action,
    risk: verdict.risk,
    requestedBy: { kind: "tool", toolName },
  };
  const request = await approvals.request(draft);
  return { verdict: verdict as Extract<ToolPermissionVerdict, { kind: "ask-human" }>, request };
}

describe("審批決定與一律允許", () => {
  it("核准一次不會寫白名單；下一次仍然詢問", async () => {
    const { request } = await ask("write_file", { path: "new.md", content: "x" });
    const outcome = await decisions.decide({
      requestId: request.id,
      effect: "approve",
      decidedBy: human,
    });
    expect(outcome.outcome).toBe("accepted");
    expect(outcome.outcome === "accepted" && outcome.allowlist).toBeNull();
    expect(store.list()).toHaveLength(0);
    expect(
      (
        await gate().evaluate({
          conversationId: "c1",
          turnId: "t2",
          toolCallId: "call-2",
          toolName: "write_file",
          input: { path: "new.md", content: "x" } as never,
          replay: "unsafe",
          permissionMode: "hard-rules",
        })
      ).kind,
    ).toBe("ask-human");
  });

  it("核准並勾選一律允許後，下一次同工具同目錄不再詢問", async () => {
    const { request } = await ask("write_file", { path: "new.md", content: "x" });
    const outcome = await decisions.decide({
      requestId: request.id,
      effect: "approve_always",
      decidedBy: human,
    });
    expect(outcome.outcome).toBe("accepted");
    if (outcome.outcome !== "accepted") return;
    expect(outcome.allowlist?.toolName).toBe("write_file");
    expect(outcome.allowlist?.scopeKey).toBe(fixture.project);
    expect(outcome.allowlist?.actionKind).toBe("fs.write");
    const next = await gate().evaluate({
      conversationId: "c1",
      turnId: "t2",
      toolCallId: "call-2",
      toolName: "write_file",
      input: { path: "sub/other.md", content: "y" } as never,
      replay: "unsafe",
      permissionMode: "hard-rules",
    });
    expect(next).toEqual({ kind: "allow" });
  });

  it("拒絕不會寫白名單", async () => {
    const { request } = await ask("write_file", { path: "new.md", content: "x" });
    const outcome = await decisions.decide({
      requestId: request.id,
      effect: "reject",
      decidedBy: human,
    });
    expect(outcome.outcome).toBe("accepted");
    expect(store.list()).toHaveLength(0);
  });

  it("沒有白名單分類的審批不能一律允許，而且不會先寫決定", async () => {
    const verdict = await gate().evaluate({
      conversationId: "c1",
      turnId: "t1",
      toolCallId: "call-1",
      toolName: "unknown_tool",
      input: { x: 1 } as never,
      replay: "unsafe",
      permissionMode: "hard-rules",
    });
    expect(verdict.kind).toBe("ask-human");
    if (verdict.kind !== "ask-human") return;
    const request = await approvals.request({
      conversationId: "c1",
      turnId: "t1",
      toolCallId: "call-1",
      action: verdict.action,
      risk: verdict.risk,
      requestedBy: { kind: "tool", toolName: "unknown_tool" },
    });
    const outcome = await decisions.decide({
      requestId: request.id,
      effect: "approve_always",
      decidedBy: human,
    });
    expect(outcome.outcome).toBe("cannot-always-allow");
    expect(store.list()).toHaveLength(0);
    const latest = await approvals.get(request.id);
    expect(latest?.status).toBe("pending");
  });

  it("已經被拒絕的審批再送一律允許，不會補寫白名單", async () => {
    const { request } = await ask("write_file", { path: "new.md", content: "x" });
    await decisions.decide({ requestId: request.id, effect: "reject", decidedBy: human });
    const outcome = await decisions.decide({
      requestId: request.id,
      effect: "approve_always",
      decidedBy: human,
    });
    expect(outcome.outcome).toBe("already-decided");
    expect(store.list()).toHaveLength(0);
  });

  it("先前核准之後再送一律允許，不寫白名單", async () => {
    const { request } = await ask("write_file", { path: "new.md", content: "x" });
    const first = await decisions.decide({
      requestId: request.id,
      effect: "approve",
      decidedBy: human,
    });
    expect(first.outcome).toBe("accepted");
    const outcome = await decisions.decide({
      requestId: request.id,
      effect: "approve_always",
      decidedBy: human,
    });
    expect(outcome.outcome).toBe("already-decided");
    expect(outcome.outcome === "already-decided" && outcome.allowlist).toBeNull();
    expect(store.list()).toHaveLength(0);
  });

  it("兩個客戶端同時送一律允許，只有落地的那一次寫白名單", async () => {
    const { request } = await ask("write_file", { path: "new.md", content: "x" });
    const [a, b] = await Promise.all([
      decisions.decide({ requestId: request.id, effect: "approve_always", decidedBy: human }),
      decisions.decide({ requestId: request.id, effect: "approve_always", decidedBy: human }),
    ]);
    expect([a.outcome, b.outcome].sort()).toEqual(["accepted", "already-decided"]);
    const accepted = a.outcome === "accepted" ? a : b;
    const decided = a.outcome === "already-decided" ? a : b;
    expect(accepted.outcome === "accepted" && accepted.allowlist?.toolName).toBe("write_file");
    expect(decided.outcome === "already-decided" && decided.allowlist).toBeNull();
    expect(store.list()).toHaveLength(1);
  });

  it("白名單存在時，禁止項仍然拒絕", async () => {
    const { request } = await ask("write_file", { path: "new.md", content: "x" });
    await decisions.decide({ requestId: request.id, effect: "approve_always", decidedBy: human });
    const blocked = await gate().evaluate({
      conversationId: "c1",
      turnId: "t3",
      toolCallId: "call-3",
      toolName: "write_file",
      input: { path: ".env", content: "secret" } as never,
      replay: "unsafe",
      permissionMode: "hard-rules",
    });
    expect(blocked.kind).toBe("deny");
  });

  it("找不到審批時回 not-found", async () => {
    expect(
      (await decisions.decide({ requestId: "apr_missing", effect: "approve", decidedBy: human }))
        .outcome,
    ).toBe("not-found");
  });
});
