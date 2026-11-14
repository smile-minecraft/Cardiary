import { describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { ToolCall } from "@earendil-works/pi-ai";

import {
  approvalTool,
  bundleOf,
  createFixture,
  gateWith,
  toolThenAnswer,
  waitFor,
} from "./support.js";
import { createInMemoryApprovalLedger } from "../src/index.js";
import type { ApprovalLedger, EngineEvent, ToolDefinition, ToolPermissionGate } from "../src/index.js";

function countingTool(counter: { runs: number }): ToolDefinition {
  return {
    name: "count",
    description: "計算執行次數",
    replay: "safe",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      counter.runs += 1;
      return { ok: true, content: [{ type: "text", text: `runs=${counter.runs}` }] };
    },
  };
}

/** 包一層 ledger，記錄「決定先寫入、工具才被喚醒」的順序。 */
function orderedLedger(log: string[]): ApprovalLedger {
  const inner = createInMemoryApprovalLedger();
  return {
    ...inner,
    async commitDecision(decision) {
      const result = await inner.commitDecision(decision);
      log.push(`commit:${result}`);
      return result;
    },
  };
}

describe("審批", () => {
  it("核准後工具執行、拒絕後工具不執行", async () => {
    const counter = { runs: 0 };
    const fixture = await createFixture();
    try {
      await fixture.adapter.tools.register(
        bundleOf("test.approve", [approvalTool({ name: "deploy", run: async () => { counter.runs += 1; } })], 1),
      );
      const approveConversation = await fixture.adapter.createConversation({
        model: { provider: "faux", model: "faux-1" },
        systemContext: "前綴",
        toolBundles: [{ bundleId: "test.approve", generation: 1 }],
      });
      fixture.faux.setResponses(toolThenAnswer("deploy", {}, "部署完成"));
      const first = await fixture.adapter.sendMessage({
        conversationId: approveConversation.id,
        content: [{ type: "text", text: "部署" }],
        delivery: "queue",
        sender: { kind: "human", clientId: "test" },
      });
      const pending = await waitFor(async () => {
        const list = await fixture.adapter.approvals.listPending({ conversationId: approveConversation.id });
        return list.length > 0 ? list : undefined;
      }, "等待審批請求");
      expect(pending[0]?.approvalKey).toMatch(/^[0-9a-f]{64}$/);
      const decided = await fixture.adapter.approvals.decide({
        requestId: pending[0]!.id,
        verdict: "approve",
        decidedBy: { kind: "human", clientId: "test" },
      });
      expect(decided.outcome).toBe("accepted");
      await waitFor(async () => {
        const conversation = await fixture.adapter.getConversation(approveConversation.id);
        return conversation?.state === "idle" ? true : undefined;
      }, "第一輪完成");
      expect(counter.runs).toBe(1);

      // 拒絕：新的對話與新的回合，工具不執行。
      fixture.faux.setResponses(toolThenAnswer("deploy", {}, "略過"));
      const denyConversation = await fixture.adapter.createConversation({
        model: { provider: "faux", model: "faux-1" },
        systemContext: "前綴",
        toolBundles: [{ bundleId: "test.approve", generation: 1 }],
      });
      await fixture.adapter.sendMessage({
        conversationId: denyConversation.id,
        content: [{ type: "text", text: "再部署一次" }],
        delivery: "queue",
        sender: { kind: "human", clientId: "test" },
      });
      const secondPending = await waitFor(async () => {
        const list = await fixture.adapter.approvals.listPending({ conversationId: denyConversation.id });
        return list.length > 0 ? list : undefined;
      }, "等待第二個審批請求");
      const denied = await fixture.adapter.approvals.decide({
        requestId: secondPending[0]!.id,
        verdict: "deny",
        decidedBy: { kind: "human", clientId: "test" },
      });
      expect(denied.outcome).toBe("accepted");
      await waitFor(async () => {
        const conversation = await fixture.adapter.getConversation(denyConversation.id);
        return conversation?.state === "idle" ? true : undefined;
      }, "第二輪完成");
      expect(counter.runs).toBe(1);
      void first;
    } finally {
      await fixture.cleanup();
    }
  }, 20000);

  it("同一個 approval_key 的兩個並行請求只留一筆 pending", async () => {
    const fixture = await createFixture();
    try {
      const draft = {
        conversationId: "conv-1",
        turnId: "turn_55",
        toolCallId: "call-1",
        action: {
          kind: "tool-execution" as const,
          summary: "部署",
          toolName: "deploy",
          toolInput: { target: "prod", options: { b: 2, a: 1 } },
        },
        risk: "medium" as const,
        requestedBy: { kind: "tool" as const, toolName: "deploy" },
      };
      const [left, right] = await Promise.all([
        fixture.adapter.approvals.request(draft),
        fixture.adapter.approvals.request({ ...draft, toolCallId: "call-2" }),
      ]);
      expect(left.id).toBe(right.id);
      const pending = await fixture.adapter.approvals.listPending({ conversationId: "conv-1" });
      expect(pending).toHaveLength(1);

      // 鍵的輸入順序不影響結果。
      const reordered = await fixture.adapter.approvals.request({
        ...draft,
        action: { ...draft.action, toolInput: { options: { a: 1, b: 2 }, target: "prod" } },
      });
      expect(reordered.id).toBe(left.id);

      await fixture.adapter.approvals.decide({
        requestId: left.id,
        verdict: "approve",
        decidedBy: { kind: "human", clientId: "test" },
      });
      // 已核准後重跑同一個請求：直接回已核准，不建立新 pending。
      const again = await fixture.adapter.approvals.request(draft);
      expect(again.status).toBe("approved");
      const after = await fixture.adapter.approvals.listPending({ conversationId: "conv-1" });
      expect(after).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("核准決定先寫入 ledger 再喚醒工具，重啟後 replay-safe 工具讀到決定直接續跑", async () => {
    const log: string[] = [];
    const ledger = orderedLedger(log);
    const counter = { runs: 0 };
    const gate: ToolPermissionGate = {
      evaluate: async () => ({
        kind: "ask-human",
        action: { kind: "tool-execution", summary: "部署" },
        risk: "medium",
      }),
    };
    const tool = approvalTool({
      name: "deploy",
      replay: "safe",
      run: async () => {
        counter.runs += 1;
        log.push("run");
      },
    });
    const first = await createFixture({ ledger, gate });
    await first.adapter.tools.register(bundleOf("test.safe", [tool], 1));
    const conversation = await first.adapter.createConversation({
      model: { provider: "faux", model: "faux-1" },
      systemContext: "前綴",
      toolBundles: [{ bundleId: "test.safe", generation: 1 }],
    });
    first.faux.setResponses(toolThenAnswer("deploy", {}, "完成"));
    const sent = await first.adapter.sendMessage({
      conversationId: conversation.id,
      content: [{ type: "text", text: "部署" }],
      delivery: "queue",
      sender: { kind: "human", clientId: "test" },
      clientMessageId: "msg-safe",
    });
    const pending = await waitFor(async () => {
      const list = await first.adapter.approvals.listPending();
      return list.length > 0 ? list : undefined;
    }, "等待審批");
    await first.adapter.approvals.decide({
      requestId: pending[0]!.id,
      verdict: "approve",
      decidedBy: { kind: "human", clientId: "test" },
    });
    await waitFor(async () => (counter.runs === 1 ? true : undefined), "工具執行");
    expect(log).toEqual(["commit:committed", "run"]);

    // 模擬重啟：同一個 ledger，新的轉接層實例。
    await first.close();
    const second = await createFixture({ root: first.root, ledger });
    try {
      await second.adapter.tools.register(bundleOf("test.safe", [tool], 1));
      const restored = await second.adapter.restoreConversation(conversation.id);
      expect(restored.conversation.id).toBe(conversation.id);
      const original = await second.adapter.findMessageByClientId(conversation.id, "msg-safe");
      expect(original?.turnId).toBe(sent.turnId);
      const request = await second.adapter.approvals.request({
        conversationId: conversation.id,
        turnId: original?.turnId ?? "",
        action: {
          kind: "tool-execution",
          summary: "部署",
          toolName: "deploy",
          toolInput: {},
        },
        risk: "medium",
        requestedBy: { kind: "tool", toolName: "deploy" },
      });
      expect(request.status).toBe("approved");
      const resolution = await second.adapter.approvals.waitForDecision(request.id);
      expect(resolution.outcome).toBe("approved");
      expect(resolution.decision?.verdict).toBe("approve");
      // 工具沒有因為重啟再執行一次（這一輪已經完成）。
      expect(counter.runs).toBe(1);
    } finally {
      await second.cleanup();
    }
  }, 20000);

  it("逾時把請求標成 expired，等待者拿到 expired", async () => {
    const fixture = await createFixture();
    try {
      const request = await fixture.adapter.approvals.request({
        conversationId: "conv-2",
        turnId: "turn_1",
        toolCallId: "call-1",
        action: { kind: "tool-execution", summary: "等一下", toolName: "wait", toolInput: {} },
        risk: "low",
        requestedBy: { kind: "tool", toolName: "wait" },
        timeoutMs: 10,
      });
      const resolution = await fixture.adapter.approvals.waitForDecision(request.id);
      expect(resolution.outcome).toBe("expired");
    } finally {
      await fixture.cleanup();
    }
  });

  it("權限閘道 deny 時工具不執行，回 permission-denied", async () => {
    const counter = { runs: 0 };
    const fixture = await createFixture({ gate: gateWith({ kind: "deny", reason: "硬規則禁止" }) });
    try {
      await fixture.adapter.tools.register(bundleOf("test.deny", [countingTool(counter)], 1));
      const conversation = await fixture.adapter.createConversation({
        model: { provider: "faux", model: "faux-1" },
        systemContext: "前綴",
        toolBundles: [{ bundleId: "test.deny", generation: 1 }],
      });
      fixture.faux.setResponses([
        fauxAssistantMessage([fauxToolCall("count", {}) as ToolCall], { stopReason: "toolUse" }),
        fauxAssistantMessage("好"),
      ]);
      const events: EngineEvent[] = [];
      const subscription = fixture.adapter.subscribe({ conversationId: conversation.id });
      void (async () => {
        for await (const event of subscription.events) {
          events.push(event);
        }
      })();
      await fixture.adapter.sendMessage({
        conversationId: conversation.id,
        content: [{ type: "text", text: "跑" }],
        delivery: "queue",
        sender: { kind: "human", clientId: "test" },
      });
      const finished = await waitFor(async () => {
        const found = events.find((event) => event.kind === "tool.finished");
        return found?.kind === "tool.finished" ? found : undefined;
      }, "工具結果事件", 10000);
      expect(finished.outcome.ok).toBe(false);
      expect(counter.runs).toBe(0);
      subscription.close();
    } finally {
      await fixture.cleanup();
    }
  }, 20000);
});

function requestTurnId(recovered: readonly { turnId: string }[]): string {
  return recovered[0]?.turnId ?? "turn_1";
}
