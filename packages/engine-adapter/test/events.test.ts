import { describe, expect, it } from "vitest";

import { bundleOf, createFixture, gateWith, toolThenAnswer } from "./support.js";
import type { EngineEvent, ToolDefinition } from "../src/index.js";

const progressTool: ToolDefinition = {
  name: "work",
  description: "回報進度後完成",
  replay: "safe",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  async execute(_input, context) {
    context.reportProgress?.({ message: "一半", fraction: 0.5 });
    context.reportProgress?.({ message: "快好了", fraction: 0.9 });
    return { ok: true, content: [{ type: "text", text: "work-done" }] };
  },
};

describe("事件流", () => {
  it("文字增量、工具開始、工具進度與工具結果都送到訂閱者，序號嚴格遞增", async () => {
    const fixture = await createFixture({
      gate: gateWith({ kind: "allow" }),
      eventBufferSize: 4,
    });
    try {
      await fixture.adapter.tools.register(bundleOf("test.events", [progressTool], 1));
      const conversation = await fixture.adapter.createConversation({
        model: { provider: "faux", model: "faux-1" },
        systemContext: "前綴",
        toolBundles: [{ bundleId: "test.events", generation: 1 }],
      });
      const subscription = fixture.adapter.subscribe({ conversationId: conversation.id });
      const events: EngineEvent[] = [];
      const collected = (async () => {
        for await (const event of subscription.events) {
          events.push(event);
          if (event.kind === "turn.completed") {
            return;
          }
        }
      })();

      fixture.faux.setResponses(toolThenAnswer("work", {}, "全部完成"));
      await fixture.adapter.sendMessage({
        conversationId: conversation.id,
        content: [{ type: "text", text: "開始" }],
        delivery: "queue",
        sender: { kind: "human", clientId: "test" },
      });
      await collected;

      const kinds = events.map((event) => event.kind);
      expect(kinds).toContain("assistant.text.delta");
      expect(kinds).toContain("tool.started");
      expect(kinds).toContain("tool.progress");
      expect(kinds).toContain("tool.finished");

      const finished = events.find((event) => event.kind === "tool.finished");
      expect(finished?.kind === "tool.finished" ? finished.outcome.ok : null).toBe(true);

      const deltas = events
        .filter((event) => event.kind === "assistant.text.delta")
        .map((event) => (event.kind === "assistant.text.delta" ? event.text : ""));
      expect(deltas.join("")).toContain("全部完成");

      const seqs = events.map((event) => event.seq);
      expect(seqs).toEqual([...seqs].sort((left, right) => left - right));
      expect(new Set(seqs).size).toBe(seqs.length);
      expect(seqs[0]).toBe(1);

      // 從中途的序號補送：只回後面的事件，沒有 gap。
      const latest = seqs[seqs.length - 1] ?? 1;
      const replay = fixture.adapter.subscribe({
        conversationId: conversation.id,
        afterSeq: latest - 2,
      });
      expect(replay.replay.gap).toBe(false);
      const replayed: number[] = [];
      for await (const event of replay.events) {
        replayed.push(event.seq);
        if (replayed.length === 2) {
          break;
        }
      }
      expect(replayed).toEqual([latest - 1, latest]);
      replay.close();

      // 要求太舊的序號：緩衝已經沒有，回報 gap。
      const stale = fixture.adapter.subscribe({ conversationId: conversation.id, afterSeq: 1 });
      expect(stale.replay.gap).toBe(true);
      stale.close();
      subscription.close();
    } finally {
      await fixture.cleanup();
    }
  }, 30000);

  it("工具失敗時 tool.finished 的 ok 是 false", async () => {
    const failing: ToolDefinition = {
      name: "work",
      description: "一定失敗",
      replay: "safe",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      async execute() {
        return { ok: false, message: "壞掉了" };
      },
    };
    const fixture = await createFixture({ gate: gateWith({ kind: "allow" }) });
    try {
      await fixture.adapter.tools.register(bundleOf("test.events", [failing], 1));
      const conversation = await fixture.adapter.createConversation({
        model: { provider: "faux", model: "faux-1" },
        systemContext: "前綴",
        toolBundles: [{ bundleId: "test.events", generation: 1 }],
      });
      const subscription = fixture.adapter.subscribe({ conversationId: conversation.id });
      const events: EngineEvent[] = [];
      void (async () => {
        for await (const event of subscription.events) {
          events.push(event);
        }
      })();
      fixture.faux.setResponses(toolThenAnswer("work", {}, "知道了"));
      await fixture.adapter.sendMessage({
        conversationId: conversation.id,
        content: [{ type: "text", text: "跑" }],
        delivery: "queue",
        sender: { kind: "human", clientId: "test" },
      });
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const found = events.find((event) => event.kind === "tool.finished");
        if (found !== undefined) {
          expect(found.kind === "tool.finished" ? found.outcome.ok : null).toBe(false);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      subscription.close();
    } finally {
      await fixture.cleanup();
    }
  }, 30000);
});
