import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  connect,
  connectAndHello,
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
  return (reply.payload as { session: { id: string } }).session.id;
}

async function subscribe(connected: ProtocolClient, sessionId: string): Promise<void> {
  const id = connected.request("session.subscribe", { sessionId });
  await connected.waitForReply(id);
}

describe("以 node 直接啟動的主機服務", () => {
  it("hello、系統訂閱與 schema 驗證；seq 從 1 開始", async () => {
    const service = await boot();
    const connected = await client(service);
    const subscribeId = connected.request("system.subscribe", {});
    const reply = await connected.waitForReply(subscribeId);
    const payload = reply.payload as { seq: number; epoch: string; resyncRequired: boolean };
    expect(payload.seq).toBe(1);
    expect(payload.resyncRequired).toBe(true);
    expect(payload.epoch).toBe(service.ready.epoch);
    expect(service.ready.clientPort).toBeGreaterThan(0);
    // connectAndHello 已經用正式 schema 驗過 hello 回應。
    expect(connected.frames[0]?.type).toBe("system.hello");
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
});

describe("私有控制面（黑箱）", () => {
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
