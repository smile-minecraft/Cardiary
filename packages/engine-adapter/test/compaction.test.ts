import { describe, expect, it } from "vitest";

import { bundleOf, createFixture, gateWith, toolThenAnswer } from "./support.js";
import type { EngineAdapter, EngineEvent, ToolDefinition } from "../src/index.js";

function echoTool(version: string): ToolDefinition {
  return {
    name: "echo",
    description: version,
    replay: "safe",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      return { ok: true, content: [{ type: "text", text: version }] };
    },
  };
}

describe("壓縮時換版", () => {
  it("預告的工具組變更在下一次壓縮套用，之後的回合用新版", async () => {
    const fixture = await createFixture({ gate: gateWith({ kind: "allow" }) });
    try {
      await fixture.adapter.tools.register(bundleOf("test.compact", [echoTool("v1")], 1));
      const conversation = await fixture.adapter.createConversation({
        model: { provider: "faux", model: "faux-1" },
        systemContext: "前綴",
        toolBundles: [{ bundleId: "test.compact", generation: 1 }],
      });
      fixture.faux.setResponses(toolThenAnswer("echo", {}, "第一輪"));
      await fixture.adapter.sendMessage({
        conversationId: conversation.id,
        content: [{ type: "text", text: "先用舊版" }],
        delivery: "queue",
        sender: { kind: "human", clientId: "test" },
      });
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const current = await fixture.adapter.getConversation(conversation.id);
        if (current?.state === "idle") {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      await fixture.adapter.tools.register(bundleOf("test.compact", [echoTool("v2")], 2));
      const events: EngineEvent[] = [];
      const subscription = fixture.adapter.subscribe({ conversationId: conversation.id });
      void (async () => {
        for await (const event of subscription.events) {
          events.push(event);
        }
      })();
      await fixture.adapter.stageConversationUpdate(conversation.id, {
        reason: "module-reload",
        toolBundles: [{ bundleId: "test.compact", generation: 2 }],
      });

      // 進行中的對話仍是釘選的舊版。
      const before = await fixture.adapter.getConversation(conversation.id);
      expect(before?.toolBundles[0]?.generation).toBe(1);

      await (
        fixture.adapter as unknown as { debugAppendCompaction(id: string): Promise<void> }
      ).debugAppendCompaction(conversation.id);
      await waitUntil(async () => {
        const catalog = await (
          fixture.adapter as unknown as {
            describeCatalog(): Promise<{
              conversations: Record<string, { toolBundles: readonly { generation: number }[] }>;
            }>;
          }
        ).describeCatalog();
        return catalog.conversations[conversation.id]?.toolBundles[0]?.generation === 2;
      }, "壓縮後套用新版本");

      const compacted = events.find((event) => event.kind === "conversation.compacted");
      expect(compacted?.kind === "conversation.compacted" ? compacted.appliedUpdate : null).toBe(
        true,
      );

      fixture.faux.setResponses(toolThenAnswer("echo", {}, "第二輪"));
      await fixture.adapter.sendMessage({
        conversationId: conversation.id,
        content: [{ type: "text", text: "換版後再跑" }],
        delivery: "queue",
        sender: { kind: "human", clientId: "test" },
      });
      await waitUntil(async () => {
        const history = await fixture.adapter.readConversationHistory({
          conversationId: conversation.id,
        });
        return history.messages.some(
          (message) =>
            message.role === "tool" &&
            message.content.some((block) => block.type === "text" && block.text.includes("v2")),
        );
      }, "換版後用新版工具");
      subscription.close();
    } finally {
      await fixture.cleanup();
    }
  }, 40000);

  /** 讀catalog 裡對話的已套用狀態；describeCatalog 是轉接層的除錯方法。 */
  async function catalogOf(
    adapter: EngineAdapter,
    id: string,
  ): Promise<{
    systemContext: string;
    toolBundles: readonly { bundleId: string; generation: number }[];
    stagedUpdate: { systemContext: string | null } | null;
  }> {
    const catalog = await (
      adapter as unknown as {
        describeCatalog(): Promise<{
          conversations: Record<
            string,
            {
              systemContext: string;
              toolBundles: readonly { bundleId: string; generation: number }[];
              stagedUpdate: { systemContext: string | null } | null;
            }
          >;
        }>;
      }
    ).describeCatalog();
    const meta = catalog.conversations[id];
    if (meta === undefined) throw new Error(`找不到對話 ${id} 的catalog 資料`);
    return meta;
  }

  /** 等預告被壓縮套用：watcher 清除 stagedUpdate 時，catalog 也寫回已套用值。 */
  async function compactAndApply(adapter: EngineAdapter, id: string): Promise<void> {
    // 讓 stageConversationUpdate 啟動的 watcher 先記下目前 entry 當基準。
    await new Promise((resolve) => setTimeout(resolve, 150));
    await (
      adapter as unknown as { debugAppendCompaction(id: string): Promise<void> }
    ).debugAppendCompaction(id);
    await waitUntil(
      async () => (await catalogOf(adapter, id)).stagedUpdate === null,
      "壓縮套用預告",
    );
  }

  it("前綴 A→B 套用後再預告回 A，下次壓縮真的換回 A", async () => {
    const fixture = await createFixture({ gate: gateWith({ kind: "allow" }) });
    try {
      const conversation = await fixture.adapter.createConversation({
        model: { provider: "faux", model: "faux-1" },
        systemContext: "前綴 A",
        toolBundles: [],
      });
      await fixture.adapter.stageConversationUpdate(conversation.id, {
        reason: "context-refresh",
        systemContext: "前綴 B",
      });
      await compactAndApply(fixture.adapter, conversation.id);
      expect((await catalogOf(fixture.adapter, conversation.id)).systemContext).toBe("前綴 B");

      await fixture.adapter.stageConversationUpdate(conversation.id, {
        reason: "context-refresh",
        systemContext: "前綴 A",
      });
      await compactAndApply(fixture.adapter, conversation.id);
      expect((await catalogOf(fixture.adapter, conversation.id)).systemContext).toBe("前綴 A");
    } finally {
      await fixture.cleanup();
    }
  }, 40000);

  it("同一批預告中前綴 A→B→A 取消，不留下待套用更新", async () => {
    const fixture = await createFixture({ gate: gateWith({ kind: "allow" }) });
    try {
      const conversation = await fixture.adapter.createConversation({
        model: { provider: "faux", model: "faux-1" },
        systemContext: "前綴 A",
        toolBundles: [],
      });
      await fixture.adapter.stageConversationUpdate(conversation.id, {
        reason: "context-refresh",
        systemContext: "前綴 B",
      });
      await fixture.adapter.stageConversationUpdate(conversation.id, {
        reason: "context-refresh",
        systemContext: "前綴 A",
      });
      expect((await catalogOf(fixture.adapter, conversation.id)).stagedUpdate).toBeNull();
    } finally {
      await fixture.cleanup();
    }
  }, 40000);

  it("前綴與工具組以兩種先後順序預告，壓縮同時套用", async () => {
    for (const contextFirst of [true, false]) {
      const fixture = await createFixture({ gate: gateWith({ kind: "allow" }) });
      try {
        await fixture.adapter.tools.register(bundleOf("test.merge", [echoTool("v1")], 1));
        await fixture.adapter.tools.register(bundleOf("test.merge", [echoTool("v2")], 2));
        const conversation = await fixture.adapter.createConversation({
          model: { provider: "faux", model: "faux-1" },
          systemContext: "前綴 A",
          toolBundles: [{ bundleId: "test.merge", generation: 1 }],
        });
        const prefixUpdate = {
          reason: "module-reload" as const,
          systemContext: "前綴 B",
        };
        const pinsUpdate = {
          reason: "module-reload" as const,
          toolBundles: [{ bundleId: "test.merge", generation: 2 }],
        };
        if (contextFirst) {
          await fixture.adapter.stageConversationUpdate(conversation.id, prefixUpdate);
          await fixture.adapter.stageConversationUpdate(conversation.id, pinsUpdate);
        } else {
          await fixture.adapter.stageConversationUpdate(conversation.id, pinsUpdate);
          await fixture.adapter.stageConversationUpdate(conversation.id, prefixUpdate);
        }
        await compactAndApply(fixture.adapter, conversation.id);
        const meta = await catalogOf(fixture.adapter, conversation.id);
        expect(meta.systemContext).toBe("前綴 B");
        expect(meta.toolBundles).toEqual([{ bundleId: "test.merge", generation: 2 }]);
      } finally {
        await fixture.cleanup();
      }
    }
  }, 60000);

  it("取消工具組預告但保留固定前綴", async () => {
    const fixture = await createFixture({ gate: gateWith({ kind: "allow" }) });
    try {
      await fixture.adapter.tools.register(bundleOf("test.merge", [echoTool("v1")], 1));
      await fixture.adapter.tools.register(bundleOf("test.merge", [echoTool("v2")], 2));
      const conversation = await fixture.adapter.createConversation({
        model: { provider: "faux", model: "faux-1" },
        systemContext: "前綴 A",
        toolBundles: [{ bundleId: "test.merge", generation: 1 }],
      });
      await fixture.adapter.stageConversationUpdate(conversation.id, {
        reason: "module-reload",
        systemContext: "前綴 B",
        toolBundles: [{ bundleId: "test.merge", generation: 2 }],
      });
      await fixture.adapter.stageConversationUpdate(conversation.id, {
        reason: "module-reload",
        toolBundles: [{ bundleId: "test.merge", generation: 1 }],
      });
      await compactAndApply(fixture.adapter, conversation.id);
      const meta = await catalogOf(fixture.adapter, conversation.id);
      expect(meta.systemContext).toBe("前綴 B");
      expect(meta.toolBundles).toEqual([{ bundleId: "test.merge", generation: 1 }]);
    } finally {
      await fixture.cleanup();
    }
  }, 40000);

  it("重複預告相同的前綴與工具組不留下待套用更新", async () => {
    const fixture = await createFixture({ gate: gateWith({ kind: "allow" }) });
    try {
      await fixture.adapter.tools.register(bundleOf("test.merge", [echoTool("v1")], 1));
      const conversation = await fixture.adapter.createConversation({
        model: { provider: "faux", model: "faux-1" },
        systemContext: "前綴 A",
        toolBundles: [{ bundleId: "test.merge", generation: 1 }],
      });
      await fixture.adapter.stageConversationUpdate(conversation.id, {
        reason: "module-reload",
        systemContext: "前綴 A",
        toolBundles: [{ bundleId: "test.merge", generation: 1 }],
      });
      expect((await catalogOf(fixture.adapter, conversation.id)).stagedUpdate).toBeNull();
      expect((await catalogOf(fixture.adapter, conversation.id)).systemContext).toBe("前綴 A");
    } finally {
      await fixture.cleanup();
    }
  }, 40000);
});

async function waitUntil(
  check: () => Promise<boolean | undefined>,
  label: string,
  timeoutMs = 10000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await check()) === true) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`等待逾時：${label}`);
}
