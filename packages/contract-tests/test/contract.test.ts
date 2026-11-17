import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  connect,
  connectAndHello,
  engineUnderTest,
  makeFolder,
  spawnExpectInitFailure,
  spawnFaultFlagWithoutEnv,
  spawnService,
  waitUntil,
  type ProtocolClient,
  type SpawnedService,
} from "./support.js";

const exec = promisify(execFile);
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
  const service = await spawnService({ demo: true, ...options });
  services.push(service);
  return service;
}

async function client(service: SpawnedService): Promise<ProtocolClient> {
  const connected = await connectAndHello(service);
  clients.push(connected);
  return connected;
}

async function createSession(connected: ProtocolClient): Promise<string> {
  const id = connected.request("session.create", { clientRequestId: `cr-${Math.random()}` });
  const reply = await connected.waitForReply(id);
  expect(reply.kind, JSON.stringify(reply)).toBe("response");
  return (reply.payload as { session: { id: string } }).session.id;
}

async function subscribe(connected: ProtocolClient, sessionId: string): Promise<void> {
  const id = connected.request("session.subscribe", { sessionId });
  await connected.waitForReply(id);
}

describe("以 node 直接啟動的主機服務", () => {
  it("hello、系統訂閱與 schema 驗證；含系統狀態與檢索狀態兩個開機事件", async () => {
    const service = await boot();
    const connected = await client(service);
    // 帶 lastSeq=0 與目前 epoch，回放從 1 開始的開機事件。
    const subscribeId = connected.request("system.subscribe", {
      lastSeq: 0,
      epoch: service.ready.epoch,
    });
    const reply = await connected.waitForReply(subscribeId);
    const payload = reply.payload as { seq: number; epoch: string; resyncRequired: boolean };
    expect(payload.epoch).toBe(service.ready.epoch);
    expect(payload.resyncRequired).toBe(false);
    expect(service.ready.clientPort).toBeGreaterThan(0);
    // connectAndHello 已經用正式 schema 驗過 hello 回應。
    expect(connected.frames[0]?.type).toBe("system.hello");
    // 結構性斷言：開機事件包含 system.status 與 module.retrieval.status，
    // 不依賴固定順序，也不假設固定的 seq 數字。
    const systemStatus = await connected.waitFor(
      (frame) => frame.kind === "event" && frame.type === "system.status",
    );
    const retrievalStatus = await connected.waitFor(
      (frame) => frame.kind === "event" && frame.type === "module.retrieval.status",
    );
    const replayed = [systemStatus, retrievalStatus].map((frame) => Number(frame.seq));
    expect(replayed.every((seq) => Number.isFinite(seq))).toBe(true);
    expect(payload.seq).toBeGreaterThanOrEqual(Math.max(...replayed));
  });

  it("無 Token、錯 Token、控制 Token 都拿不到狀態；URL 帶 Token 也无效", async () => {
    const service = await boot();
    const anonymous = await connect(
      `ws://127.0.0.1:${service.ready.clientPort}/v1/ws?token=${service.clientToken}`,
    );
    clients.push(anonymous);
    await anonymous.hello(null);
    const error = await anonymous.waitFor((frame) => frame.kind === "error");
    expect(error.code).toBe("auth_invalid");
    expect(anonymous.frames.some((frame) => frame.kind === "event")).toBe(false);

    const wrong = await connect(`ws://127.0.0.1:${service.ready.clientPort}/v1/ws`);
    clients.push(wrong);
    await wrong.hello("Z".repeat(43));
    expect((await wrong.waitFor((frame) => frame.kind === "error")).code).toBe("auth_invalid");

    const control = await connect(`ws://127.0.0.1:${service.ready.clientPort}/v1/ws`);
    clients.push(control);
    await control.hello(service.controlToken);
    expect((await control.waitFor((frame) => frame.kind === "error")).code).toBe("auth_invalid");
  });

  it("版本不相容回 incompatible_version 並關閉連線", async () => {
    const service = await boot();
    const connected = await connect(`ws://127.0.0.1:${service.ready.clientPort}/v1/ws`);
    clients.push(connected);
    await connected.hello(service.clientToken, { min: 2, max: 2 });
    const error = await connected.waitFor((frame) => frame.kind === "error");
    expect(error.code).toBe("incompatible_version");
    expect((error.details as { serverMin: number }).serverMin).toBe(1);
    await waitUntil(() => connected.closed);
  });

  it("建立對話、送訊息、串流；兩個客戶端同時觀看", async () => {
    const service = await boot({
      scripts: [[{ kind: "text", text: "契約測試回覆", chunkSize: 3 }]],
    });
    const first = await client(service);
    const second = await client(service);
    const sessionId = await createSession(first);
    await subscribe(first, sessionId);
    await subscribe(second, sessionId);
    const send = first.request("session.send_message", {
      sessionId,
      text: "你好",
      delivery: "queue",
      clientMessageId: "cm-1",
    });
    const accepted = await first.waitForReply(send);
    expect((accepted.payload as { disposition: string }).disposition).toBe("started");
    const listed = await first.waitForReply(first.request("session.list", {}));
    const summary = (
      listed.payload as { sessions: Array<{ id: string; title: string }> }
    ).sessions.find((session) => session.id === sessionId);
    expect(summary?.title).toBe("你好");
    const [completedA, completedB] = await Promise.all([
      first.waitForEvent("stream.message_completed"),
      second.waitForEvent("stream.message_completed"),
    ]);
    const entryA = (completedA.payload as { entry: { text: string; status: string } }).entry;
    const entryB = (completedB.payload as { entry: { text: string } }).entry;
    expect(entryA.text).toBe("契約測試回覆");
    expect(entryA.status).toBe("complete");
    expect(entryB.text).toBe("契約測試回覆");
    const started = first.frames.find((frame) => frame.type === "stream.turn_started");
    expect(started?.seq).toBe(1);
  });

  it("首則訊息的標題在產品主機重啟後仍可列出", async () => {
    const first = await boot({ engine: "pi", scripts: [[{ kind: "text", text: "好的" }]] });
    const connected = await client(first);
    const sessionId = await createSession(connected);
    await subscribe(connected, sessionId);
    const sent = connected.request("session.send_message", {
      sessionId,
      text: "安排週末旅程",
      delivery: "queue",
      clientMessageId: "title-first",
    });
    const sendReply = await connected.waitForReply(sent);
    expect(sendReply.kind, JSON.stringify(sendReply)).toBe("response");
    await connected.waitForEvent("stream.message_completed");
    await connected.close();
    await first.stop();
    const restarted = await boot({ engine: "pi", folder: first.folder, scripts: [] });
    const reopened = await client(restarted);
    const listed = await reopened.waitForReply(reopened.request("session.list", {}));
    const summary = (
      listed.payload as { sessions: Array<{ id: string; title: string }> }
    ).sessions.find((session) => session.id === sessionId);
    expect(summary?.title).toBe("安排週末旅程");
  });

  it("封存的對話在主機重啟後仍帶有封存時間，取消後不再帶欄位", async () => {
    const first = await boot({ engine: "pi", scripts: [[{ kind: "text", text: "ok" }]] });
    const connected = await client(first);
    const sessionId = await createSession(connected);
    const normalId = await createSession(connected);
    const archived = await connected.waitForReply(
      connected.request("session.archive", { sessionId, purgeAfterDays: 30 }),
    );
    expect(archived.kind, JSON.stringify(archived)).toBe("response");
    const archive = (archived.payload as { archive: { archivedAt: string; purgeAt: string } })
      .archive;
    await connected.close();
    await first.stop();

    const restarted = await boot({ engine: "pi", folder: first.folder });
    const reopened = await client(restarted);
    const list = async () => {
      const result = await reopened.waitForReply(reopened.request("session.list", {}));
      return (result.payload as { sessions: Array<{ id: string; archive?: typeof archive }> })
        .sessions;
    };
    const summaries = await list();
    expect(summaries.find((session) => session.id === sessionId)?.archive).toEqual(archive);
    expect(summaries.find((session) => session.id === normalId)).not.toHaveProperty("archive");

    const unarchived = await reopened.waitForReply(
      reopened.request("session.unarchive", { sessionId }),
    );
    expect(unarchived.kind, JSON.stringify(unarchived)).toBe("response");
    expect((await list()).find((session) => session.id === sessionId)).not.toHaveProperty(
      "archive",
    );
  });

  it("中途插話：先中斷目前回合再開始新回合，已生成內容標成 interrupted", async () => {
    const service = await boot({
      scripts: [
        [{ kind: "text", text: "x".repeat(30), chunkSize: 1, delayMs: 15 }],
        [{ kind: "text", text: "第二輪" }],
      ],
    });
    const connected = await client(service);
    const sessionId = await createSession(connected);
    await subscribe(connected, sessionId);
    const first = connected.request("session.send_message", {
      sessionId,
      text: "第一則",
      delivery: "queue",
      clientMessageId: "cm-a",
    });
    await connected.waitForReply(first);
    await connected.waitForEvent("stream.text_delta");
    const second = connected.request("session.send_message", {
      sessionId,
      text: "插話",
      delivery: "interrupt",
      clientMessageId: "cm-b",
    });
    const reply = await connected.waitForReply(second);
    expect((reply.payload as { disposition: string }).disposition).toBe("interrupted_then_started");
    const interrupted = await connected.waitFor(
      (frame) =>
        frame.type === "stream.message_completed" &&
        (frame.payload as { entry: { status: string } }).entry.status === "interrupted",
    );
    expect((interrupted.payload as { entry: { status: string } }).entry.status).toBe("interrupted");
    const final = await connected.waitFor(
      (frame) =>
        frame.type === "stream.message_completed" &&
        (frame.payload as { entry: { text: string } }).entry.text === "第二輪",
      6000,
    );
    expect(final.type).toBe("stream.message_completed");
  });

  it("審批核准與拒絕都走持久化順序，重複決定回 conflict", async () => {
    const service = await boot({
      scripts: [
        [
          { kind: "tool", toolName: "demo.echo", input: { text: "工具輸出" } },
          { kind: "text", text: "核准後完成" },
        ],
        [
          { kind: "tool", toolName: "demo.echo", input: { text: "被拒絕" } },
          { kind: "text", text: "拒絕後完成" },
        ],
      ],
    });
    const connected = await client(service);
    const sessionId = await createSession(connected);
    await subscribe(connected, sessionId);

    const first = connected.request("session.send_message", {
      sessionId,
      text: "核准",
      delivery: "queue",
      clientMessageId: "cm-approve",
    });
    await connected.waitForReply(first);
    const requested = await connected.waitForEvent("approval.requested");
    const approvalId = (requested.payload as { approvalId: string }).approvalId;
    const decide = connected.request("approval.decide", { approvalId, optionId: "approve" });
    const decided = await connected.waitForReply(decide);
    expect((decided.payload as { persisted: boolean }).persisted).toBe(true);
    await connected.waitForEvent("approval.decided");
    const secondDecide = connected.request("approval.decide", { approvalId, optionId: "deny" });
    const conflict = await connected.waitForReply(secondDecide);
    expect(conflict.code).toBe("conflict");
    expect((conflict.details as { decision: { effect: string } }).decision.effect).toBe("approve");
    const toolResult = await connected.waitForEvent("stream.tool_result");
    expect((toolResult.payload as { status: string }).status).toBe("ok");

    const second = connected.request("session.send_message", {
      sessionId,
      text: "拒絕",
      delivery: "queue",
      clientMessageId: "cm-deny",
    });
    await connected.waitForReply(second);
    const requested2 = await connected.waitFor(
      (frame) =>
        frame.type === "approval.requested" &&
        (frame.payload as { approvalId: string }).approvalId !== approvalId,
    );
    const approvalId2 = (requested2.payload as { approvalId: string }).approvalId;
    const deny = connected.request("approval.decide", {
      approvalId: approvalId2,
      optionId: "deny",
    });
    await connected.waitForReply(deny);
    const denied = await connected.waitFor(
      (frame) =>
        frame.type === "stream.tool_result" &&
        (frame.payload as { toolCallId: string }).toolCallId !==
          (toolResult.payload as { toolCallId: string }).toolCallId,
    );
    const deniedPayload = denied.payload as {
      status: string;
      diagnostics: Array<{ code: string }>;
    };
    expect(deniedPayload.status).toBe("error");
    expect(deniedPayload.diagnostics.map((diagnostic) => diagnostic.code)).toContain("denied");
  });

  it("文字增量不進事件日誌：斷線重連只補送耐久事件，完成事件帶完整文字", async () => {
    const service = await boot({
      scripts: [[{ kind: "text", text: "z".repeat(30), chunkSize: 1, delayMs: 10 }]],
    });
    const first = await client(service);
    const sessionId = await createSession(first);
    await subscribe(first, sessionId);
    first.request("session.send_message", { sessionId, text: "嗨", delivery: "queue" });
    await first.waitForEvent("stream.text_delta");
    await first.close();
    await new Promise((resolve) => setTimeout(resolve, 600));

    const second = await client(service);
    const subscribeId = second.request("session.subscribe", {
      sessionId,
      lastSeq: 1,
      epoch: service.ready.epoch,
    });
    const reply = await second.waitForReply(subscribeId);
    expect((reply.payload as { resyncRequired: boolean }).resyncRequired).toBe(false);
    const completion = await second.waitFor(
      (frame) => frame.type === "stream.message_completed",
      6000,
    );
    expect((completion.payload as { entry: { text: string } }).entry.text).toHaveLength(30);
    // 補送與即時事件裡都不能有 text_delta（它不落地、也不補送）。
    const deltasAfterSubscribe = second.frames.filter(
      (frame) =>
        frame.type === "stream.text_delta" &&
        typeof frame.seq === "number" &&
        (frame.seq as number) <= ((reply.payload as { seq: number }).seq ?? 0),
    );
    expect(deltasAfterSubscribe).toHaveLength(0);
  });

  it("重連時用會話快照的 streaming 接手進行中的文字", async () => {
    const service = await boot({
      scripts: [[{ kind: "text", text: "w".repeat(30), chunkSize: 1, delayMs: 15 }]],
    });
    const first = await client(service);
    const sessionId = await createSession(first);
    await subscribe(first, sessionId);
    first.request("session.send_message", { sessionId, text: "嗨", delivery: "queue" });
    await first.waitForEvent("stream.text_delta");
    const late = await client(service);
    const subscribeId = late.request("session.subscribe", { sessionId });
    const reply = await late.waitForReply(subscribeId);
    const snapshot = (
      reply.payload as {
        snapshot: { streaming?: { text: string; turnId: string; messageId: string } };
      }
    ).snapshot;
    expect(snapshot.streaming).toBeDefined();
    expect(snapshot.streaming?.text.length).toBeGreaterThan(0);
    expect(snapshot.streaming?.turnId).toBeTruthy();
    const completion = await late.waitFor(
      (frame) => frame.type === "stream.message_completed",
      8000,
    );
    expect((completion.payload as { entry: { text: string } }).entry.text).toHaveLength(30);
  });

  it("重送同一個 clientRequestId 與 clientMessageId 不會建立第二份資源", async () => {
    const service = await boot({ scripts: [[{ kind: "text", text: "回覆" }]] });
    const connected = await client(service);
    const firstCreate = connected.request("session.create", { clientRequestId: "cr-same" });
    const created = await connected.waitForReply(firstCreate);
    const sessionId = (created.payload as { session: { id: string } }).session.id;
    const secondCreate = connected.request("session.create", { clientRequestId: "cr-same" });
    const again = await connected.waitForReply(secondCreate);
    expect((again.payload as { session: { id: string } }).session.id).toBe(sessionId);
    await subscribe(connected, sessionId);
    const firstSend = connected.request("session.send_message", {
      sessionId,
      text: "嗨",
      delivery: "queue",
      clientMessageId: "cm-same",
    });
    const sent = await connected.waitForReply(firstSend);
    const secondSend = connected.request("session.send_message", {
      sessionId,
      text: "嗨",
      delivery: "queue",
      clientMessageId: "cm-same",
    });
    const resent = await connected.waitForReply(secondSend);
    expect((resent.payload as { userMessageId: string }).userMessageId).toBe(
      (sent.payload as { userMessageId: string }).userMessageId,
    );
  });

  it("緊急全部暫停回報受影響的會話，回合標成 interrupted", async () => {
    const service = await boot({
      scripts: [[{ kind: "text", text: "y".repeat(30), chunkSize: 1, delayMs: 15 }]],
    });
    const connected = await client(service);
    const sessionId = await createSession(connected);
    await subscribe(connected, sessionId);
    connected.request("session.send_message", { sessionId, text: "開始", delivery: "queue" });
    await connected.waitForEvent("stream.text_delta");
    const pause = connected.request("approval.pause_all", { reason: "緊急" });
    const paused = await connected.waitForReply(pause);
    expect((paused.payload as { interruptedSessionIds: string[] }).interruptedSessionIds).toContain(
      sessionId,
    );
    await connected.waitFor(
      (frame) =>
        frame.type === "stream.turn_state" &&
        (frame.payload as { state: string }).state === "interrupted",
    );
  });

  it("斷線重連可以補送；舊 epoch 或太舊的序號拿到 resync 快照", async () => {
    const service = await boot({ scripts: [[{ kind: "text", text: "回覆" }]] });
    const first = await client(service);
    const sessionId = await createSession(first);
    await subscribe(first, sessionId);
    first.request("session.send_message", { sessionId, text: "嗨", delivery: "queue" });
    await first.waitFor(
      (frame) =>
        frame.type === "stream.turn_state" &&
        (frame.payload as { state: string }).state === "completed",
    );
    // 回合完成後引擎才送耐久事件 context.changed（Pi 組裝的順序）；等它到齊
    // 再取邊界，否則邊界會少算後續的耐久序號。
    await first.waitForEvent("context.changed", 5000);
    const boundary = Math.max(
      ...first.frames
        .filter((frame) => frame.kind === "event" && typeof frame.seq === "number")
        .map((frame) => frame.seq as number),
    );
    await first.close();

    const replay = await client(service);
    const replayId = replay.request("session.subscribe", {
      sessionId,
      lastSeq: 1,
      epoch: service.ready.epoch,
    });
    const replayReply = await replay.waitForReply(replayId);
    const payload = replayReply.payload as { resyncRequired: boolean; seq: number };
    expect(payload.resyncRequired).toBe(false);
    expect(payload.seq).toBe(boundary);

    const stale = await client(service);
    const staleId = stale.request("session.subscribe", {
      sessionId,
      lastSeq: 1,
      epoch: "01OLDOLDLDLDLDLDLDLDLDLDLD",
    });
    const staleReply = await stale.waitForReply(staleId);
    expect((staleReply.payload as { resyncRequired: boolean }).resyncRequired).toBe(true);
    expect((staleReply.payload as { snapshot: unknown }).snapshot).toBeDefined();

    // 重啟後是新的 epoch；舊序號一律 resync。
    await service.stop();
    const restarted = await spawnService({ demo: true });
    services.push(restarted);
    expect(restarted.ready.epoch).not.toBe(service.ready.epoch);
    const afterRestart = await client(restarted);
    const subscribeId = afterRestart.request("system.subscribe", {
      lastSeq: boundary,
      epoch: service.ready.epoch,
    });
    const afterReply = await afterRestart.waitForReply(subscribeId);
    expect((afterReply.payload as { resyncRequired: boolean }).resyncRequired).toBe(true);
    expect((afterReply.payload as { epoch: string }).epoch).toBe(restarted.ready.epoch);
  });

  it("模組命名空間：未登錄的請求回 not_found，hello 回報模組能力", async () => {
    const service = await boot();
    const connected = await client(service);
    const hello = connected.frames.find((frame) => frame.type === "system.hello");
    expect((hello?.payload as { capabilities: { modules: boolean } }).capabilities.modules).toBe(
      true,
    );
    const id = connected.request("module.cards.search", { data: {} });
    const reply = await connected.waitForReply(id);
    expect(reply.code).toBe("not_found");
  });

  // 假引擎是記憶體替身，重啟後沒有資料可接；這一項只在產品組裝跑。
  it.skipIf(engineUnderTest() === "fake")(
    "重開服務後同一個資料夾續用，同一筆 clientRequestId 不會建立第二個對話",
    async () => {
      const service = await boot({ scripts: [[{ kind: "text", text: "好" }]] });
      const first = await client(service);
      const created = first.request("session.create", { clientRequestId: "restart-1" });
      const createdReply = await first.waitForReply(created);
      const sessionId = (createdReply.payload as { session: { id: string } }).session.id;
      await first.close();
      await service.stop();
      services.splice(services.indexOf(service), 1);

      const again = await spawnService({
        demo: true,
        folder: service.folder,
        scripts: [[{ kind: "text", text: "好" }]],
      });
      services.push(again);
      const connected = await client(again);
      const replay = connected.request("session.create", { clientRequestId: "restart-1" });
      const replayReply = await connected.waitForReply(replay);
      expect((replayReply.payload as { session: { id: string } }).session.id).toBe(sessionId);
      await connected.close();
    },
  );
});

describe("私有控制面（黑箱）", () => {
  it("ready 帶殼簽發的 clientToken，客戶端用同一把連得上", async () => {
    const issued = "C".repeat(43);
    const service = await boot({ control: true, clientToken: issued });
    expect(service.ready.clientToken).toBe(issued);
    const connected = await client(service);
    const subscribeId = connected.request("system.subscribe", {});
    const reply = await connected.waitForReply(subscribeId);
    expect((reply.payload as { seq: number }).seq).toBeGreaterThanOrEqual(1);
  });

  it("init 沒帶 clientToken 時服務自己產生一把並在 ready 回報", async () => {
    const service = await boot({ control: true, omitClientToken: true });
    const token = service.ready.clientToken;
    expect(typeof token).toBe("string");
    expect(token?.length).toBe(43);
    expect(token).not.toBe(service.controlToken);
    expect(token).not.toBe(service.brokerToken);
    const connected = await client(service);
    await connected.close();
  });

  it("init.clientToken 與控制或代理 Token 重複時直接拒絕，不默默替換", async () => {
    const duplicatedControl = await spawnExpectInitFailure({
      protocol: 1,
      clientToken: "T".repeat(43),
    });
    expect(duplicatedControl.code).toBe(2);
    expect(duplicatedControl.stderr).toContain("init 失敗：invalid_token");

    const duplicatedBroker = await spawnExpectInitFailure({
      protocol: 1,
      clientToken: "B".repeat(43),
    });
    expect(duplicatedBroker.code).toBe(2);
    expect(duplicatedBroker.stderr).toContain("init 失敗：invalid_token");
  });

  it("init／ready／hello／hello-ack、health、路由白名單與 Token 驗證", async () => {
    const service = await boot({ control: true });
    const health = await service.controlRequest("control.health");
    expect(health.ok).toBe(true);
    const payload = health.payload as { state: string; epoch: string; lifecycle: string };
    expect(payload.state).toBe("running");
    expect(payload.epoch).toBe(service.ready.epoch);
    expect(payload.lifecycle).toBe("idle");

    const unknown = await service.controlRequest("broker.keychain.list");
    expect(unknown.ok).toBe(false);
    expect((unknown.error as { code: string }).code).toBe("unsupported_route");

    const wrong = await service.controlRequest("control.health", {}, "W".repeat(43));
    expect(wrong.ok).toBe(false);
    expect(wrong.payload).toBeUndefined();
    expect((wrong.error as { code: string }).code).toBe("unauthorized");

    // stdout 只有 JSON frame，沒有其他內容。
    for (const line of service.stdoutLines()) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("pause 與 resume：epoch 不變，resume 後客戶端還能跑完一個新回合", async () => {
    const service = await boot({
      control: true,
      scripts: [[{ kind: "text", text: "恢復後回覆" }]],
    });
    const connected = await client(service);
    const epoch = service.ready.epoch;
    const paused = await service.controlRequest("control.pause", { reason: "user" });
    expect(paused.ok).toBe(true);
    expect((paused.payload as { state: string }).state).toBe("paused");
    const healthPaused = await service.controlRequest("control.health");
    expect((healthPaused.payload as { state: string }).state).toBe("paused");
    const resumed = await service.controlRequest("control.resume", {});
    expect((resumed.payload as { state: string }).state).toBe("ready");
    expect((resumed.payload as { epoch: string }).epoch).toBe(epoch);
    const sessionId = await createSession(connected);
    await subscribe(connected, sessionId);
    connected.request("session.send_message", { sessionId, text: "恢復後", delivery: "queue" });
    const completed = await connected.waitForEvent("stream.message_completed");
    expect((completed.payload as { entry: { text: string } }).entry.text).toBe("恢復後回覆");
  });

  it("shutdown 回 cleanShutdown: true，且回應寫完才結束", async () => {
    const service = await boot({ control: true });
    const shutdown = await service.controlRequest("control.shutdown", { reason: "user" });
    expect((shutdown.payload as { state: string }).state).toBe("closed");
    expect((shutdown.payload as { cleanShutdown: boolean }).cleanShutdown).toBe(true);
    await waitUntil(() => service.stdoutLines().length >= 1);
  });

  it("控制面不開 TCP listener、沒有檔案路徑端點；Token 不在行程參數與日誌", async () => {
    if (process.platform !== "darwin") return;
    const service = await boot({ control: true });
    const pid = service.ready.pid;
    const listeners = await exec("lsof", ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN"]);
    const rows = listeners.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("127.0.0.1");
    expect(rows[0]).toContain(String(service.ready.clientPort));

    const sockets = await exec("lsof", ["-nP", "-a", "-p", String(pid), "-U"]).catch(() => ({
      stdout: "",
    }));
    for (const line of sockets.stdout.split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/);
      const name = parts[parts.length - 1] ?? "";
      if (name.length === 0) continue;
      expect(name.startsWith("->0x") || name.startsWith("0x")).toBe(true);
    }

    const args = await exec("ps", ["-o", "args=", "-p", String(pid)]);
    expect(args.stdout).not.toContain(service.clientToken);
    expect(args.stdout).not.toContain(service.controlToken);
    expect(args.stdout).not.toContain(service.brokerToken);
    expect(service.stderr()).not.toContain(service.clientToken);
    expect(service.stderr()).not.toContain(service.controlToken);
    expect(service.stderr()).not.toContain(service.brokerToken);
  });
});

describe("審查修正的契約驗證", () => {
  it("殼控制 Token 與代理 Token 都不能用於客戶端入口", async () => {
    const service = await boot({ control: true });
    for (const token of [service.controlToken, service.brokerToken]) {
      const connected = await connect(`ws://127.0.0.1:${service.ready.clientPort}/v1/ws`);
      clients.push(connected);
      await connected.hello(token);
      const error = await connected.waitFor((frame) => frame.kind === "error");
      expect(error.code).toBe("auth_invalid");
      expect(connected.frames.some((frame) => frame.kind === "event")).toBe(false);
    }
    const valid = await client(service);
    const hello = valid.frames.find((frame) => frame.type === "system.hello");
    expect(hello?.kind).toBe("response");
  });

  it("approval_key：同一個回合、同一個工具與輸入只問一次", async () => {
    const service = await boot({
      scripts: [
        [
          { kind: "tool", toolName: "demo.echo", input: { text: "same" } },
          { kind: "tool", toolName: "demo.echo", input: { text: "same" } },
          { kind: "text", text: "完成" },
        ],
      ],
    });
    const connected = await client(service);
    const sessionId = await createSession(connected);
    await subscribe(connected, sessionId);
    connected.request("session.send_message", {
      sessionId,
      text: "重跑",
      delivery: "queue",
      clientMessageId: "cm-repeat",
    });
    const requested = await connected.waitFor((frame) => frame.type === "approval.requested");
    const approvalId = (requested.payload as { approvalId: string }).approvalId;
    const decide = connected.request("approval.decide", { approvalId, optionId: "approve" });
    await connected.waitForReply(decide);
    await connected.waitFor(
      (frame) =>
        frame.type === "stream.message_completed" &&
        (frame.payload as { entry: { text: string } }).entry.text === "完成",
      5000,
    );
    const approvals = connected.frames.filter((frame) => frame.type === "approval.requested");
    expect(approvals).toHaveLength(1);
    const results = connected.frames.filter(
      (frame) =>
        frame.type === "stream.tool_result" &&
        (frame.payload as { status?: string }).status === "ok",
    );
    expect(results).toHaveLength(2);
    const ui = connected.frames.find((frame) => frame.type === "stream.ui");
    expect((ui?.payload as { renderer?: string }).renderer).toBe("demo.echo");
  });

  it("pause_all 取消工具子行程；control.resume 之後可以再送訊息", async () => {
    const service = await boot({
      control: true,
      scripts: [
        [
          { kind: "tool", toolName: "demo.exec", input: { seconds: 5 } },
          { kind: "text", text: "第一輪" },
        ],
        [{ kind: "text", text: "恢復後" }],
      ],
    });
    const connected = await client(service);
    const sessionId = await createSession(connected);
    await subscribe(connected, sessionId);
    connected.request("session.send_message", {
      sessionId,
      text: "用工具",
      delivery: "queue",
    });
    const requested = await connected.waitFor((frame) => frame.type === "approval.requested");
    const approvalId = (requested.payload as { approvalId: string }).approvalId;
    const decide = connected.request("approval.decide", { approvalId, optionId: "approve" });
    await connected.waitForReply(decide);
    const toolCall = await connected.waitForEvent("stream.tool_call");
    const toolCallId = (toolCall.payload as { toolCallId: string }).toolCallId;
    await new Promise((resolve) => setTimeout(resolve, 100));
    const pause = connected.request("approval.pause_all", { reason: "緊急" });
    const paused = await connected.waitForReply(pause);
    const interruptedFrame = await connected.waitFor(
      (frame) =>
        frame.type === "stream.turn_state" &&
        (frame.payload as { state: string }).state === "interrupted",
    );
    const pausedTurnId = (interruptedFrame.payload as { turnId: string }).turnId;
    const afterPauseIndex = connected.frames.indexOf(paused);
    const lateResults = connected.frames.filter(
      (frame) =>
        frame.type === "stream.tool_result" &&
        (frame.payload as { toolCallId?: string }).toolCallId === toolCallId &&
        connected.frames.indexOf(frame) > afterPauseIndex,
    );
    expect(lateResults).toHaveLength(0);

    const resumed = await service.controlRequest("control.resume", {});
    expect((resumed.payload as { state: string }).state).toBe("ready");
    const send = connected.request("session.send_message", {
      sessionId,
      text: "恢復後",
      delivery: "queue",
    });
    await connected.waitForReply(send);
    // 這裡驗的是「恢復後還能再跑完一個回合」，不是文字內容：緊急暫停會
    // 影響腳本化的模型回應被哪一輪用掉，兩種組裝不保證同一段文字。
    const completed = await connected.waitFor(
      (frame) =>
        frame.type === "stream.message_completed" &&
        (frame.payload as { entry: { status: string } }).entry.status === "complete" &&
        (frame.payload as { turnId: string }).turnId !== pausedTurnId,
      6000,
    );
    expect(completed.type).toBe("stream.message_completed");
  }, 20_000);

  it("init 失敗與 hello 交握失敗都會結束行程", async () => {
    const failedInit = await spawnExpectInitFailure();
    expect(failedInit.code).toBe(2);
    expect(failedInit.stderr).toContain("init 失敗");
    expect(failedInit.stderr).not.toContain("T".repeat(43));

    const service = await spawnService({ demo: true, control: true, skipHelloAck: true });
    const code = await Promise.race([
      service.exited,
      new Promise<number | null>((resolve) => setTimeout(() => resolve(-1), 8000)),
    ]);
    expect(code).toBe(2);
    const closed = await fetch(`http://127.0.0.1:${service.ready.clientPort}/v1/blobs/x`, {
      headers: { authorization: `Bearer ${service.clientToken}` },
    }).catch(() => null);
    expect(closed).toBeNull();
  }, 20_000);

  it("以協定可觀測的假引擎行為：seq、turnId、補送與冪等鍵", async () => {
    const service = await boot({ scripts: [[{ kind: "text", text: "可觀測" }]] });
    const connected = await client(service);
    const create = connected.request("session.create", { clientRequestId: "cr-observe" });
    const created = await connected.waitForReply(create);
    const sessionId = (created.payload as { session: { id: string } }).session.id;
    await subscribe(connected, sessionId);
    const send = connected.request("session.send_message", {
      sessionId,
      text: "嗨",
      delivery: "queue",
      clientMessageId: "cm-observe",
    });
    const receipt = await connected.waitForReply(send);
    const userMessageId = (receipt.payload as { userMessageId: string }).userMessageId;
    const turnId = (receipt.payload as { turnId: string }).turnId;
    expect(turnId).toBe(`turn_${userMessageId}`);
    await connected.waitFor(
      (frame) =>
        frame.type === "stream.turn_state" &&
        (frame.payload as { state: string }).state === "completed",
    );
    const durableSeqs = connected.frames
      .filter((frame) => frame.kind === "event" && frame.type !== "stream.text_delta")
      .map((frame) => frame.seq as number);
    expect(durableSeqs[0]).toBe(1);
    expect([...durableSeqs].sort((left, right) => left - right)).toEqual(durableSeqs);
    const replay = await client(service);
    const replayId = replay.request("session.subscribe", {
      sessionId,
      lastSeq: 1,
      epoch: service.ready.epoch,
    });
    const replayReply = await replay.waitForReply(replayId);
    expect((replayReply.payload as { resyncRequired: boolean }).resyncRequired).toBe(false);
    const resentCreate = connected.request("session.create", { clientRequestId: "cr-observe" });
    const resent = await connected.waitForReply(resentCreate);
    expect((resent.payload as { session: { id: string } }).session.id).toBe(sessionId);
    const resentSend = connected.request("session.send_message", {
      sessionId,
      text: "嗨",
      delivery: "queue",
      clientMessageId: "cm-observe",
    });
    const resentReceipt = await connected.waitForReply(resentSend);
    expect((resentReceipt.payload as { userMessageId: string }).userMessageId).toBe(userMessageId);
  });
});

describe("複審非阻擋項", () => {
  it("儲存失效：送 notify.fatal、客戶端 1011、行程以 70 結束", async () => {
    const service = await boot({
      control: true,
      faultCloseEventLogMs: 200,
      scripts: [[{ kind: "text", text: "不會完成" }]],
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const connected = await client(service);
    const create = connected.request("session.create", { clientRequestId: "cr-fatal" });
    const created = await connected.waitForReply(create);
    const sessionId = (created.payload as { session: { id: string } }).session.id;
    connected.request("session.send_message", { sessionId, text: "觸發", delivery: "queue" });
    await waitUntil(
      () => service.notifications().some((frame) => frame.route === "notify.fatal"),
      5000,
    );
    const fatal = service.notifications().find((frame) => frame.route === "notify.fatal");
    expect((fatal?.payload as { reason?: string }).reason).toBe("storage_io");
    const code = await Promise.race([
      service.exited,
      new Promise<number | null>((resolve) => setTimeout(() => resolve(-1), 5000)),
    ]);
    expect(code).toBe(70);
    await waitUntil(() => connected.closed, 5000);
    expect(connected.closeCode).toBe(1011);
    expect(connected.closeReason).toBe("storage_failure");
  }, 20_000);

  it("模組事件外殼：module API 觸發的 module.* 事件可從協定觀測", async () => {
    const service = await boot();
    const connected = await client(service);
    const subscribe = connected.request("system.subscribe", {});
    await connected.waitForReply(subscribe);
    const emit = connected.request("module.demo.emit", {
      data: { action: "emit", value: 42 },
    });
    const reply = await connected.waitForReply(emit);
    expect((reply.payload as { data: { emitted: boolean } }).data.emitted).toBe(true);
    const event = await connected.waitFor((frame) => frame.type === "module.demo.changed");
    expect((event.payload as { data: { value: number } }).data.value).toBe(42);
    expect(typeof event.seq).toBe("number");
  });

  it("去重恢復：服務自己留下的 pending（resource_id 已寫）重送會補回應", async () => {
    const service = await boot({
      faultSkipDedupeComplete: true,
      scripts: [[{ kind: "text", text: "好" }]],
    });
    const connected = await client(service);
    const first = connected.request("session.create", { clientRequestId: "cr-pending" });
    const created = await connected.waitForReply(first);
    const sessionId = (created.payload as { session: { id: string } }).session.id;
    // 第一個 complete 被故障注入跳過：dedupe 停在 pending、resource_id 已寫。
    const retry = connected.request("session.create", { clientRequestId: "cr-pending" });
    const recovered = await connected.waitForReply(retry);
    expect((recovered.payload as { session: { id: string } }).session.id).toBe(sessionId);
    const again = connected.request("session.create", { clientRequestId: "cr-pending" });
    const completed = await connected.waitForReply(again);
    expect((completed.payload as { session: { id: string } }).session.id).toBe(sessionId);
  });

  it("control.resume 換路徑回 unavailable，不換資料夾也不重開狀態庫", async () => {
    const service = await boot({ control: true });
    const healthBefore = await service.controlRequest("control.health");
    const folderId = (healthBefore.payload as { folderId: string }).folderId;
    const paused = await service.controlRequest("control.pause", { reason: "user" });
    expect((paused.payload as { state: string }).state).toBe("paused");
    const otherPath = await makeFolder(folderId);
    const resumed = await service.controlRequest("control.resume", {
      folder: { path: otherPath.path },
    });
    expect(resumed.ok).toBe(false);
    expect((resumed.error as { code: string }).code).toBe("unavailable");
    const healthAfter = await service.controlRequest("control.health");
    expect((healthAfter.payload as { state: string }).state).toBe("paused");
    expect((healthAfter.payload as { folderId: string }).folderId).toBe(folderId);
    const samePath = await service.controlRequest("control.resume", {
      folder: { path: service.folder.path },
    });
    expect((samePath.payload as { state: string }).state).toBe("ready");
  });
});

describe("第三次審查的必須先修", () => {
  it("control.pause 遇到儲存失效：notify.fatal、1011、exit 70，重試不是 databasesClosed:true", async () => {
    const service = await boot({ control: true, faultCloseEventLogMs: 300 });
    const connected = await client(service);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const pause = await service.controlRequest(
      "control.pause",
      { reason: "unmount" },
      service.controlToken,
      3000,
    );
    expect(pause.ok).toBe(false);
    expect((pause.error as { code: string }).code).toBe("unavailable");
    expect((pause.payload as { databasesClosed?: boolean } | undefined)?.databasesClosed).not.toBe(
      true,
    );
    const retry = await service.controlRequest(
      "control.pause",
      { reason: "unmount" },
      service.controlToken,
      500,
    );
    const retryTimeout = (retry as { __timeout?: boolean }).__timeout === true;
    expect(retryTimeout || retry.ok === false).toBe(true);
    expect((retry.payload as { databasesClosed?: boolean } | undefined)?.databasesClosed).not.toBe(
      true,
    );
    await waitUntil(
      () => service.notifications().some((frame) => frame.route === "notify.fatal"),
      5000,
    );
    const fatal = service.notifications().find((frame) => frame.route === "notify.fatal");
    expect((fatal?.payload as { reason?: string }).reason).toBe("storage_io");
    const code = await Promise.race([
      service.exited,
      new Promise<number | null>((resolve) => setTimeout(() => resolve(-1), 5000)),
    ]);
    expect(code).toBe(70);
    await waitUntil(() => connected.closed, 5000);
    expect(connected.closeCode).toBe(1011);
    expect(connected.closeReason).toBe("storage_failure");
  }, 20_000);

  it("故障注入旗標在正式入口被拒絕（需要 CARDIARY_TEST_FAULTS=1）", async () => {
    const result = await spawnFaultFlagWithoutEnv();
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("故障注入旗標只供測試使用");
  }, 10_000);
});

describe("第三次審查的 shutdown 缺口", () => {
  it("control.shutdown 遇到儲存失效：notify.fatal、1011、exit 70，不回 cleanShutdown:true", async () => {
    const service = await boot({ control: true, faultCloseRuntimeMs: 300 });
    const connected = await client(service);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const shutdown = await service.controlRequest(
      "control.shutdown",
      { reason: "user" },
      service.controlToken,
      3000,
    );
    expect(shutdown.ok).toBe(false);
    expect((shutdown.error as { code: string }).code).toBe("unavailable");
    expect((shutdown.payload as { cleanShutdown?: boolean } | undefined)?.cleanShutdown).not.toBe(
      true,
    );
    await waitUntil(
      () => service.notifications().some((frame) => frame.route === "notify.fatal"),
      5000,
    );
    const fatal = service.notifications().find((frame) => frame.route === "notify.fatal");
    expect((fatal?.payload as { reason?: string }).reason).toBe("storage_io");
    const code = await Promise.race([
      service.exited,
      new Promise<number | null>((resolve) => setTimeout(() => resolve(-1), 5000)),
    ]);
    expect(code).toBe(70);
    await waitUntil(() => connected.closed, 5000);
    expect(connected.closeCode).toBe(1011);
    expect(connected.closeReason).toBe("storage_failure");
  }, 20_000);
});
