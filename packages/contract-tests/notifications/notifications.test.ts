import { afterEach, describe, expect, it } from "vitest";

import {
  connectAndHello,
  spawnService,
  type ProtocolClient,
  type SpawnedService,
} from "../test/support.js";

/**
 * 通知與排程的協定契約：對真的主機行程跑，不直接呼叫模組。
 *
 * 涵蓋：
 * - 代理提議排程的審批路徑：核准前不存在、拒絕後不存在、審批沒有「一律允許」。
 * - `notification.changed` 事件、未讀計數、標記已讀、通知轉成卡片與重送去重。
 * - 通知流沒有 `notification.reply`；未知訊息回 `unsupported`。
 */

const services: SpawnedService[] = [];
const clients: ProtocolClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) {
    await client.close().catch(() => undefined);
  }
  for (const service of services.splice(0)) {
    await service.stop().catch(() => undefined);
  }
});

async function boot(options: {
  readonly scripts?: readonly (readonly Record<string, unknown>[])[];
}): Promise<{ service: SpawnedService; client: ProtocolClient }> {
  const service = await spawnService(
    options.scripts === undefined ? {} : { scripts: options.scripts },
  );
  services.push(service);
  const client = await connectAndHello(service);
  clients.push(client);
  return { service, client };
}

async function createSession(client: ProtocolClient): Promise<string> {
  const id = client.request("session.create", {
    clientRequestId: `cr-${Math.random().toString(36).slice(2)}`,
  });
  const reply = await client.waitForReply(id);
  const sessionId = (reply.payload as { session: { id: string } }).session.id;
  const subscribe = client.request("session.subscribe", { sessionId });
  await client.waitForReply(subscribe);
  return sessionId;
}

async function send(client: ProtocolClient, sessionId: string, text: string): Promise<string> {
  const id = client.request("session.send_message", {
    sessionId,
    text,
    delivery: "queue",
    clientMessageId: `cm-${Math.random().toString(36).slice(2)}`,
  });
  const reply = await client.waitForReply(id);
  return (reply.payload as { turnId: string }).turnId;
}

async function systemSubscribe(client: ProtocolClient): Promise<void> {
  const id = client.request("system.subscribe", {});
  await client.waitForReply(id);
}

async function requestPayload<T>(
  client: ProtocolClient,
  type: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const id = client.request(type, payload);
  const reply = await client.waitForReply(id, 8000);
  if (reply.kind === "error") {
    throw new Error(
      `${type} 失敗：${String((reply as { code?: string }).code)} ${String((reply as { message?: string }).message)}`,
    );
  }
  return reply.payload as T;
}

/** 模組命名空間的包裝：`module.*` 請求的 payload 是 `{ data }`，回應也是。 */
async function moduleRequest<T>(
  client: ProtocolClient,
  type: string,
  data: Record<string, unknown>,
): Promise<T> {
  const reply = await requestPayload<{ data: T }>(client, type, { data });
  return reply.data;
}

function approvalRequests(client: ProtocolClient) {
  return client.frames.filter((frame) => frame.type === "approval.requested");
}

function toolResults(client: ProtocolClient) {
  return client.frames.filter((frame) => frame.type === "stream.tool_result");
}

async function waitForToolResult(client: ProtocolClient, count = 1) {
  await client.waitFor(() => toolResults(client).length >= count, 10_000);
  const result = toolResults(client)[count - 1];
  if (result === undefined) {
    throw new Error(`等不到第 ${count} 個工具結果`);
  }
  return result;
}

const PROPOSE_SCHEDULE = {
  title: "每日備份檢查",
  kind: "daily",
  spec: { time: "04:00" },
  task: { type: "agent", prompt: "檢查昨天的備份是否成功" },
};

describe("代理提議排程的審批路徑", () => {
  it("核准前排程不存在、審批沒有「一律允許」、核准後以 createdBy=agent 建立", async () => {
    const { client } = await boot({
      scripts: [[{ kind: "tool", toolName: "schedule_propose", input: PROPOSE_SCHEDULE }]],
    });
    const sessionId = await createSession(client);
    await send(client, sessionId, "幫我每天04:00檢查備份");

    const requested = await client.waitForEvent("approval.requested", 10_000);
    const payload = requested.payload as {
      approvalId: string;
      options: Array<{ id: string; effect: string }>;
    };
    // schedule_propose 沒有可白名單的動作分類：不提供「一律允許」。
    expect(payload.options.map((option) => option.effect)).not.toContain("approve_always");

    // 核准前：沒有這個排程。
    const before = await moduleRequest<{ schedules: Array<Record<string, unknown>> }>(
      client,
      "module.scheduler.list",
      {},
    );
    expect(before.schedules).toHaveLength(0);

    const id = client.request("approval.decide", {
      approvalId: payload.approvalId,
      optionId: "approve",
    });
    const decided = await client.waitForReply(id, 8000);
    expect((decided.payload as { effect: string }).effect).toBe("approve");

    const result = await waitForToolResult(client);
    expect((result.payload as { status: string }).status).toBe("ok");

    // 核准後：存在，createdBy 是 agent。
    const after = await moduleRequest<{
      schedules: Array<{ name: string; createdBy: string; kind: string }>;
    }>(client, "module.scheduler.list", {});
    expect(after.schedules).toHaveLength(1);
    expect(after.schedules[0]?.createdBy).toBe("agent");
    expect(after.schedules[0]?.name).toBe("每日備份檢查");
    expect(after.schedules[0]?.kind).toBe("daily");
  });

  it("拒絕後排程不存在；工具結果是拒絕", async () => {
    const { client } = await boot({
      scripts: [[{ kind: "tool", toolName: "schedule_propose", input: PROPOSE_SCHEDULE }]],
    });
    const sessionId = await createSession(client);
    await send(client, sessionId, "幫我每天04:00檢查備份");

    const requested = await client.waitForEvent("approval.requested", 10_000);
    const payload = requested.payload as { approvalId: string };
    const id = client.request("approval.decide", {
      approvalId: payload.approvalId,
      optionId: "deny",
    });
    await client.waitForReply(id, 8000);

    const result = await waitForToolResult(client);
    expect((result.payload as { status: string }).status).not.toBe("ok");

    const after = await moduleRequest<{ schedules: Array<unknown> }>(
      client,
      "module.scheduler.list",
      {},
    );
    expect(after.schedules).toHaveLength(0);
  });
});

describe("排程執行與通知", () => {
  it("緊急全部暫停中止執行中的排程任務，執行紀錄標成 cancelled", async () => {
    const { client } = await boot({
      scripts: [[{ kind: "text", text: "排程任務執行中".repeat(20), chunkSize: 1, delayMs: 50 }]],
    });
    await systemSubscribe(client);
    // 一般對話沒有進行中的回合；緊急暫停不該把它算進受影響的會話。
    const idleSessionId = await createSession(client);

    const created = await moduleRequest<{ schedule: { scheduleId: string } }>(
      client,
      "module.scheduler.create",
      {
        name: "慢速排程",
        kind: "once",
        spec: { at: "2020-01-01T00:00:00.000Z" },
        task: { type: "agent", prompt: "做一件很久的事" },
      },
    );

    // 背景任務會建立標題「排程：名稱」的對話；等它出現、使用者訊息已落地（回合已開始），
    // 再送緊急暫停。不訂閱背景會話的串流：回合在訂閱前就開始，重播的 frame 不是這個測試要驗的。
    let backgroundSessionId: string | undefined;
    const deadline = Date.now() + 10_000;
    while (backgroundSessionId === undefined && Date.now() < deadline) {
      const listed = await requestPayload<{
        sessions: Array<{ id: string; title?: string; messageCount?: number }>;
      }>(client, "session.list", {});
      const background = listed.sessions.find((session) => session.title === "排程：慢速排程");
      if (background !== undefined && (background.messageCount ?? 0) > 0) {
        backgroundSessionId = background.id;
      }
      if (backgroundSessionId === undefined) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    expect(backgroundSessionId).toBeDefined();
    const backgroundId = backgroundSessionId as string;

    const pauseId = client.request("approval.pause_all", { reason: "測試緊急暫停" });
    const paused = await client.waitForReply(pauseId);
    const interrupted = (paused.payload as { interruptedSessionIds: string[] })
      .interruptedSessionIds;
    expect(interrupted).toContain(backgroundId);
    expect(interrupted).not.toContain(idleSessionId);

    // 排程服務收到中止的回合後，執行紀錄要標成 cancelled。
    let runs: Array<{ status: string; conversationId?: string }> = [];
    const runsDeadline = Date.now() + 10_000;
    while (runs.length === 0 && Date.now() < runsDeadline) {
      const result = await moduleRequest<{
        runs: Array<{ status: string; conversationId?: string }>;
      }>(client, "module.scheduler.runs", { scheduleId: created.schedule.scheduleId });
      runs = result.runs;
      if (runs.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("cancelled");
    expect(runs[0]?.conversationId).toBe(backgroundId);
  }, 40_000);

  it("建立已經過期的一次性排程：背景任務執行後產生通知，可轉卡且重送去重，可標記已讀", async () => {
    const { client } = await boot({ scripts: [[{ kind: "text", text: "一切正常" }]] });
    await systemSubscribe(client);

    // 過去的時間 → 建立當下就是到期的排程，模組會在啟動或「poke」時補跑一次。
    const created = await moduleRequest<{
      schedule: { scheduleId: string; createdBy: string; nextRunAt: string };
    }>(client, "module.scheduler.create", {
      name: "立即檢查",
      kind: "once",
      spec: { at: "2020-01-01T00:00:00.000Z" },
      task: { type: "agent", prompt: "回報一句狀態" },
    });
    expect(created.schedule.createdBy).toBe("user");

    const event = await client.waitForEvent("notification.changed", 25_000);
    const notification = (
      event.payload as {
        notification: {
          notificationId: string;
          kind: string;
          title: string;
          body: string;
          createdAt: string;
        };
      }
    ).notification;
    expect(notification.kind).toBe("schedule");
    expect(notification.title).toBe("立即檢查");

    const listed = await requestPayload<{
      notifications: Array<{ notificationId: string }>;
      totalUnread: number;
    }>(client, "notification.list", {});
    expect(listed.notifications.map((item) => item.notificationId)).toContain(
      notification.notificationId,
    );
    expect(listed.totalUnread).toBeGreaterThanOrEqual(1);

    // 轉成卡片：kind note、標籤有「通知」。
    const card = await requestPayload<{
      card: { cardId: string; kind: string; tags: string[]; title: string };
      deduped: boolean;
    }>(client, "notification.create_card", { notificationId: notification.notificationId });
    expect(card.card.kind).toBe("note");
    expect(card.card.tags).toContain("通知");
    expect(card.deduped).toBe(false);

    // 重送同一則通知：同一張卡、deduped = true。
    const again = await requestPayload<{
      card: { cardId: string };
      deduped: boolean;
    }>(client, "notification.create_card", { notificationId: notification.notificationId });
    expect(again.card.cardId).toBe(card.card.cardId);
    expect(again.deduped).toBe(true);

    const read = await requestPayload<{ updated: number; totalUnread: number }>(
      client,
      "notification.mark_read",
      { ids: [notification.notificationId] },
    );
    expect(read.updated).toBe(1);

    const remaining = await requestPayload<{
      notifications: Array<{ notificationId: string }>;
      totalUnread: number;
    }>(client, "notification.list", { unreadOnly: true });
    expect(remaining.notifications.map((item) => item.notificationId)).not.toContain(
      notification.notificationId,
    );
  }, 40_000);

  it("通知流沒有 reply 路徑；不存在的 notification 訊息回 not_found", async () => {
    const { client } = await boot({});
    // 通知命名空間只有 list／mark_read／create_card；
    // 對話串只能用「轉成卡片再 context.add_card」討論，沒有 reply 訊息。
    const id = client.request("notification.reply", { notificationId: "ntf_test" });
    const reply = await client.waitForReply(id, 6000);
    expect(reply.kind).toBe("error");
    expect(String((reply as { code?: string }).code)).toBe("not_found");
    expect(approvalRequests(client)).toHaveLength(0);
  });
});
