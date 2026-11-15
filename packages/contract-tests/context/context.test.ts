import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  connectAndHello,
  spawnService,
  type ProtocolClient,
  type SpawnedService,
} from "../test/support.js";

/**
 * 上下文類協定的契約：對真的主機行程跑。
 *
 * 這組只驗視圖、追加、移除標記與事件；壓縮需要模型，沒有設定模型時
 * `context.compact` 只代表排入，完成與否由主機日誌與單元測試負責。
 */

interface ContextView {
  readonly sessionId: string;
  readonly version: number;
  readonly entries: readonly {
    readonly entryId: string;
    readonly layer: string;
    readonly cardId?: string;
    readonly title: string;
    readonly tokenEstimate: number;
    readonly state: string;
    readonly position: number;
  }[];
  readonly usedTokens: number;
  readonly budgetTokens: number;
  readonly contextWindow: number;
  readonly compactionThreshold: number;
}

interface ContextTest {
  readonly service: SpawnedService;
  readonly client: ProtocolClient;
}

let shared: ContextTest;

beforeAll(async () => {
  // Pi 組裝沒有腳本時是正式組裝（模型由主機設定決定），`session.create` 會
  // 被模型檢查擋下；給一個腳本讓兩種組裝都能建立對話，腳本只在壓縮真的
  // 呼叫模型時用到。
  const service = await spawnService({ scripts: [[{ kind: "text", text: "摘要" }]] });
  const client = await connectAndHello(service);
  shared = { service, client };
}, 20_000);

afterAll(async () => {
  await shared?.client.close().catch(() => undefined);
  await shared?.service.stop().catch(() => undefined);
});

async function request<T = Record<string, unknown>>(
  client: ProtocolClient,
  type: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const id = client.request(type, payload);
  const reply = await client.waitForReply(id, 10_000);
  if (reply.kind === "error") {
    throw new Error(`${type} 失敗：${String(reply.code)} ${String(reply.message)}`);
  }
  return reply.payload as T;
}

async function createSession(client: ProtocolClient): Promise<string> {
  const payload = await request<{ session: { id: string } }>(client, "session.create", {
    title: "上下文契約",
    clientRequestId: `ctx-${Math.random().toString(36).slice(2)}`,
  });
  const sessionId = payload.session.id;
  const subscribe = client.request("session.subscribe", { sessionId });
  await client.waitForReply(subscribe, 10_000);
  return sessionId;
}

async function createNote(client: ProtocolClient): Promise<string> {
  const payload = await request<{ card: { cardId: string } }>(client, "card.create", {
    kind: "note",
    title: "上下文的筆記",
    body: "這段文字會進第 6 層。",
    clientRequestId: `ctx-card-${Math.random().toString(36).slice(2)}`,
  });
  return payload.card.cardId;
}

/** 每一項 tokenEstimate 的加總等於 usedTokens，且順序是八層的固定順序。 */
function expectConsistent(view: ContextView): void {
  expect(view.usedTokens).toBe(view.entries.reduce((sum, entry) => sum + entry.tokenEstimate, 0));
  expect(view.contextWindow).toBeGreaterThanOrEqual(1);
  expect(view.budgetTokens).toBeGreaterThanOrEqual(0);
  const order = [
    "bedrock",
    "persona",
    "core-memory",
    "opening-memory",
    "short-term-memory",
    "other-cards",
    "working-context",
    "volatile-state",
  ];
  const indexes = view.entries.map((entry) => order.indexOf(entry.layer));
  expect(indexes.every((index) => index >= 0)).toBe(true);
  expect([...indexes].sort((left, right) => left - right)).toEqual(indexes);
}

describe("上下文協定", () => {
  it("context.get 回分層視圖；加卡只往後追加、移除只標記，事件掛在會話串流", async () => {
    const { client } = shared;
    const sessionId = await createSession(client);

    const initial = await request<{ context: ContextView }>(client, "context.get", { sessionId });
    expect(initial.context.sessionId).toBe(sessionId);
    expectConsistent(initial.context);
    expect(initial.context.entries.some((entry) => entry.layer === "working-context")).toBe(true);

    const cardId = await createNote(client);
    const added = await request<{ context: ContextView }>(client, "context.add_card", {
      sessionId,
      cardId,
    });
    expectConsistent(added.context);
    const cardEntry = added.context.entries.find((entry) => entry.cardId === cardId);
    expect(cardEntry?.layer).toBe("other-cards");
    expect(cardEntry?.state).toBe("active");

    await client.waitFor(
      (frame) =>
        frame.type === "context.changed" &&
        (frame.payload as { sessionId?: string }).sessionId === sessionId,
      10_000,
    );

    const removed = await request<{ context: ContextView }>(client, "context.remove_card", {
      sessionId,
      cardId,
    });
    expectConsistent(removed.context);
    const removedEntry = removed.context.entries.find((entry) => entry.cardId === cardId);
    expect(removedEntry?.state).toBe("pending-removal");
    expect(removed.context.version).toBeGreaterThan(added.context.version);

    const compact = await request<{ scheduled: boolean }>(client, "context.compact", {
      sessionId,
    });
    expect(compact.scheduled).toBe(true);
  }, 30_000);

  it("第二場對話的上下文互不影響", async () => {
    const { client } = shared;
    const first = await createSession(client);
    const second = await createSession(client);
    const cardId = await createNote(client);
    await request(client, "context.add_card", { sessionId: first, cardId });

    const other = await request<{ context: ContextView }>(client, "context.get", {
      sessionId: second,
    });
    expect(other.context.entries.some((entry) => entry.cardId === cardId)).toBe(false);
    expectConsistent(other.context);
  }, 20_000);
});
