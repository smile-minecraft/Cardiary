import { afterEach, describe, expect, it } from "vitest";

import {
  connectAndHello,
  spawnService,
  type ProtocolClient,
  type SpawnedService,
} from "./support.js";

/**
 * 同一組協定行為，換成產品組裝：`@cardiary/storage` 的持久化儲存加上
 * Pi Durable 轉接層，模型用腳本化的假供應商。
 *
 * 這份檔案證明閘道以上完全不依賴假引擎；假引擎的完整腳本行為仍由
 * `contract.test.ts` 涵蓋。
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

async function boot(options: Parameters<typeof spawnService>[0] = {}): Promise<SpawnedService> {
  const service = await spawnService({ demo: true, engine: "pi", ...options });
  services.push(service);
  return service;
}

async function client(service: SpawnedService): Promise<ProtocolClient> {
  const connected = await connectAndHello(service);
  clients.push(connected);
  return connected;
}

describe("Pi Durable 組裝的契約", () => {
  it("hello、系統訂閱與 seq 從 1 開始", async () => {
    const service = await boot();
    const connected = await client(service);
    const subscribeId = connected.request("system.subscribe", {});
    const reply = await connected.waitForReply(subscribeId);
    const payload = reply.payload as { seq: number; epoch: string };
    expect(payload.seq).toBeGreaterThanOrEqual(1);
    expect(payload.epoch.length).toBeGreaterThan(0);
    await connected.close();
  });

  it("建立對話、送訊息、串流完成", async () => {
    const service = await boot({
      scripts: [[{ kind: "text", text: "真實引擎回覆" }]],
    });
    const connected = await client(service);
    const created = connected.request("session.create", { clientRequestId: "pi-1" });
    const createdReply = await connected.waitForReply(created);
    const sessionId = (createdReply.payload as { session: { id: string } }).session.id;
    const subscribeId = connected.request("session.subscribe", { sessionId });
    await connected.waitForReply(subscribeId);
    const send = connected.request("session.send_message", {
      sessionId,
      text: "你好",
      delivery: "queue",
      clientMessageId: "pi-cm-1",
    });
    await connected.waitForReply(send);
    const completed = await connected.waitForEvent("stream.message_completed", 20000);
    const entry = (completed.payload as { entry: { text: string; status: string } }).entry;
    expect(entry.text).toBe("真實引擎回覆");
    expect(entry.status).toBe("complete");
    await connected.close();
  });

  it("審批先落地再回應，決定後工具續跑", async () => {
    const service = await boot({
      scripts: [
        [
          { kind: "tool", toolName: "demo.echo", input: { text: "引擎工具輸出" } },
          { kind: "text", text: "核准後完成" },
        ],
      ],
    });
    const connected = await client(service);
    const created = connected.request("session.create", { clientRequestId: "pi-2" });
    const createdReply = await connected.waitForReply(created);
    const sessionId = (createdReply.payload as { session: { id: string } }).session.id;
    const subscribeId = connected.request("session.subscribe", { sessionId });
    await connected.waitForReply(subscribeId);
    const send = connected.request("session.send_message", {
      sessionId,
      text: "跑工具",
      delivery: "queue",
      clientMessageId: "pi-cm-2",
    });
    await connected.waitForReply(send);
    const requested = await connected.waitForEvent("approval.requested", 20000);
    const approvalId = (requested.payload as { approvalId: string }).approvalId;
    const decide = connected.request("approval.decide", { approvalId, optionId: "approve" });
    const decided = await connected.waitForReply(decide);
    expect((decided.payload as { persisted: boolean }).persisted).toBe(true);
    const toolResult = await connected.waitForEvent("stream.tool_result", 20000);
    expect((toolResult.payload as { status: string }).status).toBe("ok");
    const completed = await connected.waitForEvent("stream.message_completed", 20000);
    expect((completed.payload as { entry: { text: string } }).entry.text).toBe("核准後完成");
    await connected.close();
  });

  it("重開服務後同一個資料夾續用，同一筆 clientRequestId 不會建立第二個對話", async () => {
    const service = await boot();
    const first = await client(service);
    const created = first.request("session.create", { clientRequestId: "pi-3" });
    const createdReply = await first.waitForReply(created);
    const sessionId = (createdReply.payload as { session: { id: string } }).session.id;
    await first.close();
    await service.stop();
    services.splice(services.indexOf(service), 1);

    const again = await spawnService({
      demo: true,
      engine: "pi",
      folder: service.folder,
    });
    services.push(again);
    const connected = await client(again);
    const replay = connected.request("session.create", { clientRequestId: "pi-3" });
    const replayReply = await connected.waitForReply(replay);
    expect((replayReply.payload as { session: { id: string } }).session.id).toBe(sessionId);
    await connected.close();
  });
});
