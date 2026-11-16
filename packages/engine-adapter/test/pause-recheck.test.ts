import { describe, expect, it } from "vitest";

import { bundleOf, createFixture, toolThenAnswer, waitFor } from "./support.js";
import type { ToolDefinition, ToolPermissionGate, ToolPermissionVerdict } from "../src/index.js";

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

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("緊急暫停重檢", () => {
  it("權限判定完成後已暫停，工具不會被呼叫", async () => {
    const counter = { runs: 0 };
    const gateCalls = { count: 0 };
    const pending = deferred<ToolPermissionVerdict>();
    const gate: ToolPermissionGate = {
      evaluate: async () => {
        gateCalls.count += 1;
        return pending.promise;
      },
    };
    const fixture = await createFixture({ gate });
    try {
      await fixture.adapter.tools.register(bundleOf("test.pause", [countingTool(counter)], 1));
      const conversation = await fixture.adapter.createConversation({
        model: { provider: "faux", model: "faux-1" },
        systemContext: "前綴",
        toolBundles: [{ bundleId: "test.pause", generation: 1 }],
      });
      fixture.faux.setResponses(toolThenAnswer("count", {}, "完成"));
      const sending = fixture.adapter
        .sendMessage({
          conversationId: conversation.id,
          content: [{ type: "text", text: "執行工具" }],
          delivery: "queue",
          sender: { kind: "human", clientId: "test" },
        })
        .catch(() => undefined);

      await waitFor(() => (gateCalls.count > 0 ? true : undefined), "等待權限判定");

      // 模型已經回覆工具呼叫、權限判定還懸著的時候按下緊急暫停；
      // 接著才讓判定回來（放行），工具仍然不能執行。
      // 模型已經回覆工具呼叫、權限判定還懸著的時候按下緊急暫停；接著才讓
      // 判定回來（放行）。暫停與工具任務互相等待，先讓兩者同時跑。
      const pausing = fixture.adapter.pauseAll("測試緊急暫停");
      pending.resolve({ kind: "allow" });
      await pausing;

      await sending;

      await waitFor(async () => {
        const conversationNow = await fixture.adapter.getConversation(conversation.id);
        return conversationNow !== null && conversationNow.state !== "running" ? true : undefined;
      }, "等待回合結束");

      expect(counter.runs).toBe(0);
    } finally {
      await fixture.cleanup();
    }
  }, 20000);
});
