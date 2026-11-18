import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

import {
  HOST_SERVICE_NAMES,
  type AlwaysAllowDecisionOutcome,
  type AlwaysAllowService,
} from "../src/modules/contract.js";
import type { FakeModelStep } from "@cardiary/engine-fake";
import { TestClient, startTestHost, waitUntil, type TestHost } from "./helpers.js";

const MODULES_DIRECTORY = fileURLToPath(new URL("../dist/modules", import.meta.url));

const hosts: TestHost[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const host of hosts.splice(0)) {
    await host.close();
  }
});

async function boot(options?: Parameters<typeof startTestHost>[0]): Promise<TestHost> {
  const host = await startTestHost(options);
  hosts.push(host);
  return host;
}

async function helloClient(host: TestHost, token = host.token): Promise<TestClient> {
  const client = await TestClient.connect(host.url);
  const requestId = await client.hello(token);
  await client.waitForReply(requestId);
  return client;
}

async function subscribeSession(client: TestClient, sessionId: string): Promise<void> {
  const id = client.request("session.subscribe", { sessionId });
  await client.waitForReply(id);
}

async function createSession(client: TestClient): Promise<string> {
  const id = client.request("session.create", { clientRequestId: `cr-${Math.random()}` });
  const reply = await client.waitForReply(id);
  return (reply.payload?.session as { id: string }).id;
}

describe("協定閘道", () => {
  it("沒有 Token 的連線收不到任何狀態；錯誤 Token 與控制 Token 也不行", async () => {
    const host = await boot();
    const anonymous = await TestClient.connect(host.url);
    await anonymous.hello(null);
    const error = await anonymous.waitFor(
      (frame) => frame.kind === "error" && frame.code === "auth_invalid",
    );
    expect(error.code).toBe("auth_invalid");
    const subscribeId = anonymous.request("system.subscribe", {});
    const subscribeError = await anonymous.waitForReply(subscribeId);
    expect(subscribeError.code).toBe("not_authenticated");
    expect(anonymous.frames.some((frame) => frame.kind === "event")).toBe(false);

    const wrong = await TestClient.connect(host.url);
    await wrong.hello("B".repeat(43));
    expect(
      (await wrong.waitFor((frame) => frame.kind === "error" && frame.code === "auth_invalid"))
        .code,
    ).toBe("auth_invalid");

    const control = await TestClient.connect(host.url);
    await control.hello("C".repeat(43));
    expect(
      (await control.waitFor((frame) => frame.kind === "error" && frame.code === "auth_invalid"))
        .code,
    ).toBe("auth_invalid");

    await anonymous.close();
    await wrong.close();
    await control.close();
  });

  it("版本不相容時回 incompatible_version 並關閉連線", async () => {
    const host = await boot();
    const client = await TestClient.connect(host.url);
    const requestId = await client.hello(host.token, { min: 2, max: 3 });
    const error = await client.waitForReply(requestId);
    expect(error.code).toBe("incompatible_version");
    expect((error.details as { serverMin: number; serverMax: number }).serverMin).toBe(1);
    await waitUntil(() => client.closed);
  });

  it("hello 之後訂閱系統串流，拿到快照與從 1 開始的序號", async () => {
    const host = await boot();
    const client = await helloClient(host);
    const subscribeId = client.request("system.subscribe", {});
    const reply = await client.waitForReply(subscribeId);
    const payload = reply.payload as {
      stream: string;
      seq: number;
      epoch: string;
      resyncRequired: boolean;
      snapshot?: unknown;
    };
    expect(payload.stream).toBe("system");
    expect(payload.seq).toBe(1);
    expect(payload.resyncRequired).toBe(true);
    expect(payload.snapshot).toBeDefined();
    expect(payload.epoch).toBe(host.host.epoch);
    await client.close();
  });

  it("建立會話、送訊息、收串流；兩個客戶端同時觀看同一場對話", async () => {
    const host = await boot({
      scripts: [[{ kind: "text", text: "第一輪回覆", chunkSize: 2 }]],
    });
    const first = await helloClient(host);
    const second = await helloClient(host);
    const sessionId = await createSession(first);
    const subscribeA = first.request("session.subscribe", { sessionId });
    const subscribeB = second.request("session.subscribe", { sessionId });
    await first.waitForReply(subscribeA);
    await second.waitForReply(subscribeB);
    const sendId = first.request("session.send_message", {
      sessionId,
      text: "你好",
      delivery: "queue",
      clientMessageId: "cm-1",
    });
    const send = await first.waitForReply(sendId);
    expect((send.payload as { disposition: string }).disposition).toBe("started");
    await first.waitForEvent("stream.message_completed");
    await second.waitForEvent("stream.message_completed");
    const completed = second.frames.find((frame) => frame.type === "stream.message_completed");
    const entry = (completed?.payload as { entry: { text: string } }).entry;
    expect(entry.text).toBe("第一輪回覆");
    const started = first.frames.find((frame) => frame.type === "stream.turn_started");
    expect(started?.seq).toBe(1);
    await first.close();
    await second.close();
  });

  it("session.send_message 接受 steer 並把 delivery 傳給引擎； idle 時 disposition started", async () => {
    const host = await boot({ scripts: [[{ kind: "text", text: "好的" }]] });
    const client = await helloClient(host);
    const sessionId = await createSession(client);
    const subscribe = client.request("session.subscribe", { sessionId });
    await client.waitForReply(subscribe);
    const spy = vi.spyOn(
      host.host.engine as unknown as {
        sendMessageWithClientId(request: { delivery: string }): Promise<unknown>;
      },
      "sendMessageWithClientId",
    );
    const sendId = client.request("session.send_message", {
      sessionId,
      text: "插話",
      delivery: "steer",
    });
    const reply = await client.waitForReply(sendId);
    expect((reply.payload as { disposition: string }).disposition).toBe("started");
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ delivery: "steer" }));
    await client.waitForEvent("stream.message_completed");
    await client.close();
  });

  it("會話生成中 steer 不中止串流、不排隊在回合後；引擎收到 steered", async () => {
    const host = await boot({
      scripts: [
        [{ kind: "text", text: "abcdefghij", chunkSize: 1, delayMs: 10 }],
        [{ kind: "text", text: "第二輪" }],
      ],
    });
    const client = await helloClient(host);
    const sessionId = await createSession(client);
    const subscribe = client.request("session.subscribe", { sessionId });
    await client.waitForReply(subscribe);
    const spy = vi.spyOn(
      host.host.engine as unknown as {
        sendMessageWithClientId(request: { delivery: string }): Promise<unknown>;
      },
      "sendMessageWithClientId",
    );
    const first = client.request("session.send_message", {
      sessionId,
      text: "開始",
      delivery: "queue",
    });
    await client.waitForReply(first);
    await client.waitForEvent("stream.text_delta");

    const steer = client.request("session.send_message", {
      sessionId,
      text: "換個方向",
      delivery: "steer",
    });
    const steerReply = await client.waitForReply(steer);
    const payload = steerReply.payload as {
      disposition: string;
      queuedBehindTurnId?: string;
    };
    expect(payload.disposition).toBe("started");
    expect(payload.queuedBehindTurnId).toBeUndefined();
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ delivery: "steer" }));

    const completed = await client.waitFor(
      (frame) =>
        frame.type === "stream.message_completed" &&
        (frame.payload as { entry: { text?: string } }).entry.text === "abcdefghij",
      5000,
    );
    expect(completed.type).toBe("stream.message_completed");
    const interrupted = client.frames.some(
      (frame) =>
        frame.type === "stream.turn_state" &&
        (frame.payload as { state?: string }).state === "interrupted",
    );
    expect(interrupted).toBe(false);
    await client.close();
  });

  it("delivery 不是 queue、steer、interrupt 時回 invalid_message", async () => {
    const host = await boot();
    const client = await helloClient(host);
    const sessionId = await createSession(client);
    const sendId = client.request("session.send_message", {
      sessionId,
      text: "嗨",
      delivery: "later",
    });
    const reply = await client.waitForReply(sendId);
    expect(reply.code).toBe("invalid_message");
    expect((reply.details as { field: string }).field).toBe("delivery");
    await client.close();
  });

  it("斷線重連：同一個 epoch 補送；舊 epoch 或缺 epoch 一律 resync 快照", async () => {
    const host = await boot({
      scripts: [[{ kind: "text", text: "回覆" }]],
    });
    const first = await helloClient(host);
    const sessionId = await createSession(first);
    const subscribe = first.request("session.subscribe", { sessionId });
    await first.waitForReply(subscribe);
    const send = first.request("session.send_message", {
      sessionId,
      text: "嗨",
      delivery: "queue",
    });
    await first.waitForReply(send);
    await first.waitForEvent("stream.turn_state");
    const boundary = Math.max(
      ...first.frames
        .filter((frame) => frame.kind === "event" && typeof frame.seq === "number")
        .map((frame) => frame.seq as number),
    );
    await first.close();

    const replay = await helloClient(host);
    const replayId = replay.request("session.subscribe", {
      sessionId,
      lastSeq: 1,
      epoch: host.host.epoch,
    });
    const replayReply = await replay.waitForReply(replayId);
    const replayPayload = replayReply.payload as { resyncRequired: boolean; seq: number };
    expect(replayPayload.resyncRequired).toBe(false);
    expect(replayPayload.seq).toBe(boundary);
    const replayed = replay.frames.filter(
      (frame) => frame.kind === "event" && frame.type !== "stream.text_delta",
    );
    expect(replayed.some((frame) => frame.seq === boundary)).toBe(true);

    const staleEpoch = await helloClient(host);
    const staleId = staleEpoch.request("session.subscribe", {
      sessionId,
      lastSeq: 1,
      epoch: "old-epoch",
    });
    const stale = await staleEpoch.waitForReply(staleId);
    expect((stale.payload as { resyncRequired: boolean }).resyncRequired).toBe(true);
    expect((stale.payload as { snapshot: unknown }).snapshot).toBeDefined();

    const noEpoch = await helloClient(host);
    const noEpochId = noEpoch.request("session.subscribe", { sessionId, lastSeq: 1 });
    const noEpochReply = await noEpoch.waitForReply(noEpochId);
    expect((noEpochReply.payload as { resyncRequired: boolean }).resyncRequired).toBe(true);

    await replay.close();
    await staleEpoch.close();
    await noEpoch.close();
  });

  it("文字增量不進事件日誌、不佔序號；補送窗口以外的序號回 resync", async () => {
    const host = await boot({
      scripts: [[{ kind: "text", text: "abcdef", chunkSize: 1 }]],
      limits: { replayWindow: 2 },
    });
    const client = await helloClient(host);
    const sessionId = await createSession(client);
    const subscribe = client.request("session.subscribe", { sessionId });
    await client.waitForReply(subscribe);
    const send = client.request("session.send_message", {
      sessionId,
      text: "嗨",
      delivery: "queue",
    });
    await client.waitForReply(send);
    await client.waitForEvent("stream.turn_state");
    const deltas = client.frames.filter((frame) => frame.type === "stream.text_delta");
    expect(deltas.length).toBeGreaterThan(1);
    const durable = client.frames.filter(
      (frame) => frame.kind === "event" && frame.type !== "stream.text_delta",
    );
    const deltaSeqs = new Set(deltas.map((frame) => frame.seq));
    const durableSeqs = new Set(durable.map((frame) => frame.seq));
    expect(new Set(deltaSeqs).size).toBeLessThan(deltas.length);
    expect([...deltaSeqs].every((seq) => durableSeqs.has(seq))).toBe(true);
    const stored = host.host.storage.events.snapshot();
    expect(stored.some((event) => event.kind === "stream.text_delta")).toBe(false);

    const reconnect = await helloClient(host);
    const tooOld = reconnect.request("session.subscribe", {
      sessionId,
      lastSeq: 1,
      epoch: host.host.epoch,
    });
    const tooOldReply = await reconnect.waitForReply(tooOld);
    expect((tooOldReply.payload as { resyncRequired: boolean }).resyncRequired).toBe(true);
    await client.close();
    await reconnect.close();
  });

  it("快照的 streaming 接手進行中的文字，超過上限標記 truncated", async () => {
    const host = await boot({
      scripts: [[{ kind: "text", text: "x".repeat(40), chunkSize: 1, delayMs: 8 }]],
      limits: { streamingBufferBytes: 16 },
    });
    const client = await helloClient(host);
    const sessionId = await createSession(client);
    const subscribe = client.request("session.subscribe", { sessionId });
    await client.waitForReply(subscribe);
    const send = client.request("session.send_message", {
      sessionId,
      text: "嗨",
      delivery: "queue",
    });
    await client.waitForReply(send);
    await client.waitForEvent("stream.text_delta");
    await waitUntil(
      () => client.frames.filter((frame) => frame.type === "stream.text_delta").length >= 24,
    );
    const late = await helloClient(host);
    const lateId = late.request("session.subscribe", { sessionId });
    const snapshotReply = await late.waitForReply(lateId);
    const snapshot = (
      snapshotReply.payload as {
        snapshot: {
          streaming?: { text: string; truncated?: boolean; turnId: string; messageId: string };
        };
      }
    ).snapshot;
    expect(snapshot.streaming).toBeDefined();
    expect(snapshot.streaming?.text.length).toBeLessThanOrEqual(16);
    expect(snapshot.streaming?.truncated).toBe(true);
    expect(snapshot.streaming?.turnId.length).toBeGreaterThan(0);
    await client.waitForEvent("stream.message_completed", 5000);
    const completed = client.frames.find((frame) => frame.type === "stream.message_completed");
    expect((completed?.payload as { entry: { text: string } }).entry.text).toHaveLength(40);
    await client.close();
    await late.close();
  });

  it("審批：先持久化再回應；重複決定回 conflict 並帶回第一個結果", async () => {
    const host = await boot({
      scripts: [
        [
          { kind: "tool", toolName: "demo.echo", input: { text: "工具輸出" } },
          { kind: "text", text: "完成" },
        ],
      ],
    });
    const client = await helloClient(host);
    const sessionId = await createSession(client);
    const subscribe = client.request("session.subscribe", { sessionId });
    await client.waitForReply(subscribe);
    const send = client.request("session.send_message", {
      sessionId,
      text: "用工具",
      delivery: "queue",
    });
    await client.waitForReply(send);
    const requested = await client.waitForEvent("approval.requested");
    const approvalId = (requested.payload as { approvalId: string }).approvalId;
    const ledger = host.host.storage.approvals as { calls: string[] };
    expect(ledger.calls.some((call) => call.startsWith("approval.record"))).toBe(true);

    const decideId = client.request("approval.decide", { approvalId, optionId: "approve" });
    const decided = await client.waitForReply(decideId);
    const persisted = (decided.payload as { persisted: boolean }).persisted;
    expect(persisted).toBe(true);
    expect(ledger.calls.some((call) => call.startsWith("approval.commitDecision"))).toBe(true);
    const decidedEvent = await client.waitForEvent("approval.decided");
    expect((decidedEvent.payload as { effect: string }).effect).toBe("approve");

    const secondId = client.request("approval.decide", { approvalId, optionId: "deny" });
    const conflict = await client.waitForReply(secondId);
    expect(conflict.code).toBe("conflict");
    expect((conflict.details as { decision: { effect: string } }).decision.effect).toBe("approve");
    await client.close();
  });

  it("排程背景對話的審批請求標明來源排程，一般會話不帶", async () => {
    const host = await boot({
      scripts: [
        [
          { kind: "tool", toolName: "demo.echo", input: { text: "排程輸出" } },
          { kind: "text", text: "完成" },
        ],
        [
          { kind: "tool", toolName: "demo.echo", input: { text: "一般輸出" } },
          { kind: "text", text: "完成" },
        ],
      ],
    });
    const client = await helloClient(host);
    const settings = await host.host.engine.getModelSettings();
    const scheduled = await host.host.engine.createConversation({
      title: "排程：每日摘要",
      purpose: "background-task",
      model: settings.roles.main,
      systemContext: "你是排程助理。",
      toolBundles: [{ bundleId: "demo", generation: 1 }],
      permissionMode: "hard-rules",
    });
    await subscribeSession(client, scheduled.id);
    client.request("session.send_message", {
      sessionId: scheduled.id,
      text: "用工具",
      delivery: "queue",
    });
    const scheduleRequested = await client.waitForEvent("approval.requested");
    const schedulePayload = scheduleRequested.payload as { sourceScheduleName?: string };
    expect(schedulePayload.sourceScheduleName).toBe("每日摘要");
    await client.close();

    const plain = await helloClient(host);
    const plainId = await createSession(plain);
    await subscribeSession(plain, plainId);
    plain.request("session.send_message", {
      sessionId: plainId,
      text: "用工具",
      delivery: "queue",
    });
    const plainRequested = await plain.waitForEvent("approval.requested");
    const plainPayload = plainRequested.payload as { sourceScheduleName?: string };
    expect(plainPayload.sourceScheduleName).toBeUndefined();
    await plain.close();
  });

  it("緊急全部暫停中止回合並回報受影響的會話", async () => {
    const host = await boot({
      scripts: [[{ kind: "text", text: "很久", chunkSize: 1, delayMs: 20 }]],
    });
    const client = await helloClient(host);
    const sessionId = await createSession(client);
    const subscribe = client.request("session.subscribe", { sessionId });
    await client.waitForReply(subscribe);
    const send = client.request("session.send_message", {
      sessionId,
      text: "開始",
      delivery: "queue",
    });
    await client.waitForReply(send);
    await client.waitForEvent("stream.text_delta");
    const pauseId = client.request("approval.pause_all", { reason: "緊急" });
    const paused = await client.waitForReply(pauseId);
    expect((paused.payload as { interruptedSessionIds: string[] }).interruptedSessionIds).toContain(
      sessionId,
    );
    const interrupted = await client.waitFor(
      (frame) =>
        frame.type === "stream.turn_state" &&
        (frame.payload as { state?: string } | undefined)?.state === "interrupted",
    );
    expect((interrupted.payload as { state: string }).state).toBe("interrupted");
    await client.close();
  });

  it("登錄模組命名空間後可路由；未登錄回 not_found；模組事件有 seq", async () => {
    const host = await boot();
    host.host.gateway.registerModuleNamespace("cards", async (payload) => ({
      echo: payload.query ?? null,
    }));
    const client = await helloClient(host);
    const requestId = client.request("module.cards.search", { data: { query: "x" } });
    const reply = await client.waitForReply(requestId);
    expect((reply.payload as { data: { echo: string } }).data.echo).toBe("x");

    const unknownId = client.request("module.unknown.search", { data: {} });
    const unknown = await client.waitForReply(unknownId);
    expect(unknown.code).toBe("not_found");

    const subscribeId = client.request("system.subscribe", {});
    await client.waitForReply(subscribeId);
    const before = host.host.gateway.streamLog.boundary("system");
    const seq = await host.host.gateway.emitModuleEvent({
      type: "module.cards.changed",
      stream: "system",
      data: { cardId: "c1" },
    });
    expect(seq).toBe(before + 1);
    const event = await client.waitForEvent("module.cards.changed");
    expect((event.payload as { data: { cardId: string } }).data.cardId).toBe("c1");
    await client.close();
  });

  it("request_dedupe 的 pending 恢復：有 resource_id 就補回應，判斷不了回 result_unknown", async () => {
    const host = await boot();
    const client = await helloClient(host);
    const first = client.request("session.create", { clientRequestId: "cr-recover" });
    const created = await client.waitForReply(first);
    const sessionId = (created.payload as { session: { id: string } }).session.id;
    const dedupe = host.host.storage.dedupe as unknown as {
      seed(record: {
        key: string;
        kind: "session-create";
        state: "pending";
        resourceId: string | null;
        response: null;
        claimedAt: string;
        completedAt: null;
      }): void;
    };
    dedupe.seed({
      key: "session-create:cr-again",
      kind: "session-create",
      state: "pending",
      resourceId: sessionId,
      response: null,
      claimedAt: new Date().toISOString(),
      completedAt: null,
    });
    const recovered = client.request("session.create", { clientRequestId: "cr-again" });
    const reply = await client.waitForReply(recovered);
    expect((reply.payload as { session: { id: string } }).session.id).toBe(sessionId);

    dedupe.seed({
      key: "session-create:cr-old",
      kind: "session-create",
      state: "pending",
      resourceId: "conv_missing",
      response: null,
      claimedAt: new Date(Date.now() - 120_000).toISOString(),
      completedAt: null,
    });
    const unknown = client.request("session.create", { clientRequestId: "cr-old" });
    const conflict = await client.waitForReply(unknown);
    expect(conflict.code).toBe("conflict");
    expect((conflict.details as { reason: string }).reason).toBe("result_unknown");
    await client.close();
  });

  it("回合開始時寫 turn_index，送訊息回傳的 turnId 與事件一致", async () => {
    const host = await boot({ scripts: [[{ kind: "text", text: "好" }]] });
    const client = await helloClient(host);
    const sessionId = await createSession(client);
    const subscribe = client.request("session.subscribe", { sessionId });
    await client.waitForReply(subscribe);
    const send = client.request("session.send_message", {
      sessionId,
      text: "嗨",
      delivery: "queue",
    });
    const reply = await client.waitForReply(send);
    const turnId = (reply.payload as { turnId: string }).turnId;
    const messageId = (reply.payload as { userMessageId: string }).userMessageId;
    await client.waitForEvent("stream.turn_started");
    expect(await host.host.storage.turnIndex.get(sessionId, messageId)).toBe(turnId);
    await client.close();
  });

  it("會話列表與歷史分頁可用；事件是先落地才送出", async () => {
    const host = await boot({ scripts: [[{ kind: "text", text: "歷史回覆" }]] });
    const client = await helloClient(host);
    const sessionId = await createSession(client);
    await subscribeSession(client, sessionId);
    const send = client.request("session.send_message", {
      sessionId,
      text: "嗨",
      delivery: "queue",
    });
    await client.waitForReply(send);
    const completed = await client.waitForEvent("stream.message_completed");
    // 收到事件的當下，事件日誌已經有這一列（先落地再送出）。
    const stream = `session:${sessionId}`;
    expect(
      host.host.storage.events
        .snapshot()
        .some((event) => event.stream === stream && event.seq === (completed.seq as number)),
    ).toBe(true);
    const listId = client.request("session.list", { limit: 10 });
    const list = await client.waitForReply(listId);
    const sessions = (list.payload as { sessions: Array<{ id: string }> }).sessions;
    expect(sessions.some((session) => session.id === sessionId)).toBe(true);
    const historyId = client.request("session.get_history", { sessionId, limit: 10 });
    const history = await client.waitForReply(historyId);
    const entries = (history.payload as { entries: Array<{ role: string; text: string }> }).entries;
    expect(entries.some((entry) => entry.role === "assistant" && entry.text === "歷史回覆")).toBe(
      true,
    );
    await client.close();
  });

  it("HTTP 沒有登記的路由回 not_found；PUT 這類方法仍被拒絕", async () => {
    const host = await boot();
    const response = await fetch(`http://127.0.0.1:${host.host.port}/v1/blobs/x`, {
      method: "POST",
      headers: { authorization: `Bearer ${host.token}` },
    });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("not_found");
    const put = await fetch(`http://127.0.0.1:${host.host.port}/v1/blobs/x`, {
      method: "PUT",
      headers: { authorization: `Bearer ${host.token}` },
    });
    expect(put.status).toBe(400);
    expect(((await put.json()) as { code: string }).code).toBe("unsupported");
    const unauthorized = await fetch(`http://127.0.0.1:${host.host.port}/v1/blobs/x`);
    expect(unauthorized.status).toBe(401);
    await host.close();
  });
});

describe("審查修正的回歸測試", () => {
  it("客戶端 Token 比較走常數時間函式：hello 與 HTTP 的錯誤變體都被拒絕", async () => {
    const host = await boot();
    const variants = [`${host.token.slice(0, 42)}B`, host.token.slice(0, 42), `${host.token}A`];
    for (const variant of variants) {
      const connected = await TestClient.connect(host.url);
      await connected.hello(variant);
      const error = await connected.waitFor(
        (frame) => frame.kind === "error" && frame.code === "auth_invalid",
      );
      expect(error.code).toBe("auth_invalid");
      await connected.close();
    }
    for (const variant of variants) {
      const response = await fetch(`http://127.0.0.1:${host.host.port}/v1/blobs/x`, {
        headers: { authorization: `Bearer ${variant}` },
      });
      expect(response.status).toBe(401);
    }
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../src/gateway/server.ts", import.meta.url), "utf8"),
    );
    expect(source).toContain("constantTimeEqual(token, this.#options.clientToken)");
    expect(source).toContain("constantTimeEqual(auth, this.#options.clientToken)");
    expect(source).not.toContain("token !== this.#options.clientToken");
  });

  it("session.create 的 clientRequestId 會傳給引擎；pending 且沒有 resource_id 時補回應", async () => {
    const host = await boot();
    const client = await helloClient(host);
    const first = client.request("session.create", { clientRequestId: "cr-pass-through" });
    const created = await client.waitForReply(first);
    const sessionId = (created.payload as { session: { id: string } }).session.id;
    // 模擬「引擎已建立、主機還沒寫 resource_id」就中斷：pending、resource_id 為 NULL。
    const dedupe = host.host.storage.dedupe as unknown as {
      seed(record: {
        key: string;
        kind: "session-create";
        state: "pending";
        resourceId: null;
        response: null;
        claimedAt: string;
        completedAt: null;
      }): void;
    };
    dedupe.seed({
      key: "session-create:cr-pass-through",
      kind: "session-create",
      state: "pending",
      resourceId: null,
      response: null,
      claimedAt: new Date().toISOString(),
      completedAt: null,
    });
    const retry = client.request("session.create", { clientRequestId: "cr-pass-through" });
    const recovered = await client.waitForReply(retry);
    expect((recovered.payload as { session: { id: string } }).session.id).toBe(sessionId);
    await client.close();
  });

  it("approval.decided 排在回應之後、工具結果之前，且有 running turn_state", async () => {
    const host = await boot({
      scripts: [
        [
          { kind: "tool", toolName: "demo.echo", input: { text: "順序" } },
          { kind: "text", text: "完成" },
        ],
      ],
    });
    const client = await helloClient(host);
    const sessionId = await createSession(client);
    await subscribeSession(client, sessionId);
    client.request("session.send_message", { sessionId, text: "用工具", delivery: "queue" });
    const requested = await client.waitForEvent("approval.requested");
    const approvalId = (requested.payload as { approvalId: string }).approvalId;
    const decideId = client.request("approval.decide", { approvalId, optionId: "approve" });
    await client.waitForReply(decideId);
    await client.waitForEvent("stream.tool_result");
    const indexOf = (predicate: (frame: (typeof client.frames)[number]) => boolean): number =>
      client.frames.findIndex(predicate);
    const responseIndex = indexOf(
      (frame) => frame.replyTo === decideId && frame.kind === "response",
    );
    const decidedIndex = indexOf((frame) => frame.type === "approval.decided");
    const toolResultIndex = indexOf((frame) => frame.type === "stream.tool_result");
    const runningIndex = indexOf(
      (frame) =>
        frame.type === "stream.turn_state" &&
        (frame.payload as { state?: string } | undefined)?.state === "running" &&
        frame.seq !== undefined &&
        client.frames.indexOf(frame) > indexOf((f) => f.type === "approval.requested"),
    );
    expect(responseIndex).toBeGreaterThan(-1);
    expect(decidedIndex).toBeGreaterThan(responseIndex);
    expect(toolResultIndex).toBeGreaterThan(decidedIndex);
    expect(runningIndex).toBeGreaterThan(-1);
    await client.close();
  });

  it("pause_all 保留待審批、不重複送 interrupted、殺掉工具子行程，恢復後可再送", async () => {
    const host = await boot({
      scripts: [
        [
          { kind: "tool", toolName: "demo.exec", input: { seconds: 5 } },
          { kind: "text", text: "第一輪" },
        ],
        [
          { kind: "tool", toolName: "demo.echo", input: { text: "待審批" } },
          { kind: "text", text: "第二輪" },
        ],
        [{ kind: "text", text: "恢復後" }],
      ],
    });
    const first = await helloClient(host);
    const runningSession = await createSession(first);
    await subscribeSession(first, runningSession);
    first.request("session.send_message", {
      sessionId: runningSession,
      text: "用工具",
      delivery: "queue",
    });
    const requested = await first.waitForEvent("approval.requested");
    const runningApprovalId = (requested.payload as { approvalId: string }).approvalId;
    const decide = first.request("approval.decide", {
      approvalId: runningApprovalId,
      optionId: "approve",
    });
    await first.waitForReply(decide);
    const toolCall = await first.waitForEvent("stream.tool_call");
    const toolCallId = (toolCall.payload as { toolCallId: string }).toolCallId;
    await waitUntil(() => host.host.spawn.runningCount >= 1);

    const second = await helloClient(host);
    const waitingSession = await createSession(second);
    await subscribeSession(second, waitingSession);
    second.request("session.send_message", {
      sessionId: waitingSession,
      text: "等待審批",
      delivery: "queue",
    });
    const pendingRequested = await second.waitFor((frame) => frame.type === "approval.requested");
    const pendingApprovalId = (pendingRequested.payload as { approvalId: string }).approvalId;

    const pauseId = first.request("approval.pause_all", { reason: "緊急" });
    const paused = await first.waitForReply(pauseId);
    const interruptedIds = (paused.payload as { interruptedSessionIds: string[] })
      .interruptedSessionIds;
    expect(interruptedIds).toContain(runningSession);
    expect(interruptedIds).toContain(waitingSession);
    await waitUntil(() => host.host.spawn.runningCount === 0);
    const interrupted = first.frames.filter(
      (frame) =>
        frame.type === "stream.turn_state" &&
        (frame.payload as { state?: string } | undefined)?.state === "interrupted" &&
        (frame.payload as { turnId?: string }).turnId !== undefined,
    );
    // 每個被中止的回合只有一則 interrupted；不因 pause_all 再補一則。
    const turnIds = new Set(
      interrupted.map((frame) => (frame.payload as { turnId: string }).turnId),
    );
    expect(interrupted).toHaveLength(turnIds.size);
    expect(
      interrupted.some(
        (frame) =>
          (frame.payload as { turnId: string }).turnId ===
          (toolCall.payload as { turnId: string }).turnId,
      ),
    ).toBe(true);

    const resultAfterPause = first.frames.filter(
      (frame) =>
        frame.type === "stream.tool_result" &&
        (frame.payload as { toolCallId?: string }).toolCallId === toolCallId &&
        first.frames.indexOf(frame) > first.frames.indexOf(paused),
    );
    expect(resultAfterPause).toHaveLength(0);

    // 待審批保留：快照的 pendingApproval 還在，之後仍可決定。
    const late = await helloClient(host);
    const subscribeId = late.request("session.subscribe", { sessionId: waitingSession });
    const snapshot = await late.waitForReply(subscribeId);
    const pendingApproval = (
      snapshot.payload as { snapshot?: { pendingApproval?: { approvalId?: string } } }
    ).snapshot?.pendingApproval;
    expect(pendingApproval?.approvalId).toBe(pendingApprovalId);
    const decideLater = late.request("approval.decide", {
      approvalId: pendingApprovalId,
      optionId: "deny",
    });
    const decidedLater = await late.waitForReply(decideLater);
    expect((decidedLater.payload as { persisted: boolean }).persisted).toBe(true);

    // 恢復（M0 用 control.resume 解除緊急暫停）之後可以再送訊息。
    const resumed = await host.host.service.resume();
    expect(resumed.state).toBe("ready");
    const send = late.request("session.send_message", {
      sessionId: waitingSession,
      text: "恢復後",
      delivery: "queue",
    });
    await late.waitForReply(send);
    const completed = await late.waitFor(
      (frame) =>
        frame.type === "stream.message_completed" &&
        (frame.payload as { entry: { text: string } }).entry.text === "恢復後",
      5000,
    );
    expect(completed.type).toBe("stream.message_completed");
    await first.close();
    await late.close();
  }, 15_000);

  it("heartbeat：沒有回 pong 的連線會被關閉", async () => {
    const host = await boot({ limits: { heartbeatSeconds: 1 } });
    const raw = new WebSocket(host.url, { autoPong: false });
    await new Promise<void>((resolve, reject) => {
      raw.once("open", () => resolve());
      raw.once("error", reject);
    });
    await waitUntil(() => raw.readyState === WebSocket.CLOSED, 6000);
    expect(raw.readyState).toBe(WebSocket.CLOSED);
  }, 10_000);

  it("儲存失效：事件日誌失效後送訊息，fatalNotifier 被呼叫且客戶端收到 1011", async () => {
    const failures: string[] = [];
    const host = await boot({
      fatalNotifier: async (reason, detail) => {
        failures.push(`${reason}:${detail}`);
      },
    });
    const client = await helloClient(host);
    const sessionId = await createSession(client);
    await subscribeSession(client, sessionId);
    await (host.host.storage.events as unknown as { close(): Promise<void> }).close();
    client.request("session.send_message", { sessionId, text: "觸發", delivery: "queue" });
    await waitUntil(() => failures.length > 0, 4000);
    expect(failures[0]?.startsWith("storage_io:")).toBe(true);
    await waitUntil(() => client.closeCode !== null, 4000);
    expect(client.closeCode).toBe(1011);
    expect(client.closeReason).toBe("storage_failure");
    expect(host.host.service.health().state).toBe("storage-failed");
  });

  it("客戶端請求入口的 StorageFailure 也走 fatal：module 寫事件失敗會關閉 1011", async () => {
    const failures: string[] = [];
    const host = await boot({
      fatalNotifier: async (reason, detail) => {
        failures.push(`${reason}:${detail}`);
      },
    });
    const client = await helloClient(host);
    await (host.host.storage.events as unknown as { close(): Promise<void> }).close();
    client.request("module.demo.emit", { data: { action: "emit", value: 1 } });
    await waitUntil(() => failures.length > 0, 4000);
    expect(failures[0]?.startsWith("storage_io:")).toBe(true);
    await waitUntil(() => client.closeCode !== null, 4000);
    expect(client.closeCode).toBe(1011);
    expect(client.closeReason).toBe("storage_failure");
  });

  it("去重恢復走 resource_id 的 getConversation，不被假引擎自己的回查找遮蔽", async () => {
    const host = await boot();
    const client = await helloClient(host);
    const create = client.request("session.create", { title: "spy" });
    const created = await client.waitForReply(create);
    const sessionId = (created.payload as { session: { id: string } }).session.id;
    const getConversation = vi.spyOn(host.host.engine, "getConversation");
    const findByRequest = vi.spyOn(host.host.engine, "findConversationByClientRequestId");
    const dedupe = host.host.storage.dedupe as unknown as {
      seed(record: {
        key: string;
        kind: "session-create";
        state: "pending";
        resourceId: string;
        response: null;
        claimedAt: string;
        completedAt: null;
      }): void;
    };
    dedupe.seed({
      key: "session-create:cr-spy",
      kind: "session-create",
      state: "pending",
      resourceId: sessionId,
      response: null,
      claimedAt: new Date().toISOString(),
      completedAt: null,
    });
    const retry = client.request("session.create", { clientRequestId: "cr-spy" });
    const recovered = await client.waitForReply(retry);
    expect((recovered.payload as { session: { id: string } }).session.id).toBe(sessionId);
    expect(getConversation).toHaveBeenCalledWith(sessionId);
    expect(findByRequest).not.toHaveBeenCalled();
    await client.close();
  });

  it("expired 與 withdrawn 不送 approval.decided，也不會被誤報成 reject", async () => {
    const host = await boot();
    const client = await helloClient(host);
    const sessionId = await createSession(client);
    await subscribeSession(client, sessionId);
    const draft = {
      conversationId: sessionId,
      turnId: "turn_manual",
      action: {
        kind: "tool-execution" as const,
        summary: "手動審批",
        toolName: "demo.echo",
        toolInput: { text: "expire" },
      },
      risk: "unknown" as const,
      requestedBy: { kind: "tool" as const, toolName: "demo.echo" },
      timeoutMs: 30,
    };
    const expiring = await host.host.engine.approvals.request(draft);
    await client.waitFor(
      (frame) =>
        frame.type === "approval.requested" &&
        (frame.payload as { approvalId?: string }).approvalId === expiring.id,
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(client.frames.some((frame) => frame.type === "approval.decided")).toBe(false);
    const expiringSnapshot = await helloClient(host);
    const expiringSubscribe = expiringSnapshot.request("session.subscribe", { sessionId });
    const expiringReply = await expiringSnapshot.waitForReply(expiringSubscribe);
    expect(
      (expiringReply.payload as { snapshot?: { pendingApproval?: unknown } }).snapshot
        ?.pendingApproval,
    ).toBeUndefined();

    const withdrawn = await host.host.engine.approvals.request({
      ...draft,
      action: { ...draft.action, toolInput: { text: "withdraw" } },
      timeoutMs: 5000,
    });
    await client.waitFor(
      (frame) =>
        frame.type === "approval.requested" &&
        (frame.payload as { approvalId?: string }).approvalId === withdrawn.id,
    );
    await host.host.engine.approvals.withdraw(withdrawn.id, "測試撤回");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(client.frames.some((frame) => frame.type === "approval.decided")).toBe(false);
    await client.close();
    await expiringSnapshot.close();
  });

  it("M0 只顯示最舊的待審批；有 pending 時拒絕新回合，決定後才放行", async () => {
    const host = await boot();
    const client = await helloClient(host);
    const sessionId = await createSession(client);
    await subscribeSession(client, sessionId);
    const base = {
      conversationId: sessionId,
      turnId: "turn_manual",
      action: {
        kind: "tool-execution" as const,
        summary: "手動審批",
        toolName: "demo.echo",
      },
      risk: "unknown" as const,
      requestedBy: { kind: "tool" as const, toolName: "demo.echo" },
      timeoutMs: 5000,
    };
    const first = await host.host.engine.approvals.request({
      ...base,
      action: { ...base.action, toolInput: { text: "first" } },
    });
    await client.waitFor(
      (frame) =>
        frame.type === "approval.requested" &&
        (frame.payload as { approvalId?: string }).approvalId === first.id,
    );
    const second = await host.host.engine.approvals.request({
      ...base,
      action: { ...base.action, toolInput: { text: "second" } },
    });
    await client.waitFor(
      (frame) =>
        frame.type === "approval.requested" &&
        (frame.payload as { approvalId?: string }).approvalId === second.id,
    );
    const subscribeId = client.request("session.subscribe", { sessionId });
    const snapshot = await client.waitForReply(subscribeId);
    expect(
      (snapshot.payload as { snapshot?: { pendingApproval?: { approvalId?: string } } }).snapshot
        ?.pendingApproval?.approvalId,
    ).toBe(first.id);
    const blocked = client.request("session.send_message", {
      sessionId,
      text: "先送",
      delivery: "queue",
    });
    const blockedReply = await client.waitForReply(blocked);
    expect(blockedReply.code).toBe("busy");
    expect((blockedReply.details as { reason?: string }).reason).toBe("pending_approval");
    expect((blockedReply.details as { approvalId?: string }).approvalId).toBe(first.id);
    await host.host.engine.approvals.decide({
      requestId: first.id,
      verdict: "approve",
      decidedBy: { kind: "human", clientId: "a" },
    });
    await waitUntil(() => client.frames.some((frame) => frame.type === "approval.decided"));
    const subscribeAgain = client.request("session.subscribe", { sessionId });
    const snapshotAgain = await client.waitForReply(subscribeAgain);
    expect(
      (snapshotAgain.payload as { snapshot?: { pendingApproval?: { approvalId?: string } } })
        .snapshot?.pendingApproval?.approvalId,
    ).toBe(second.id);
    const blockedAgain = client.request("session.send_message", {
      sessionId,
      text: "還是先送",
      delivery: "queue",
    });
    expect((await client.waitForReply(blockedAgain)).code).toBe("busy");
    await host.host.engine.approvals.decide({
      requestId: second.id,
      verdict: "deny",
      decidedBy: { kind: "human", clientId: "a" },
    });
    await waitUntil(
      () => client.frames.filter((frame) => frame.type === "approval.decided").length >= 2,
    );
    const send = client.request("session.send_message", {
      sessionId,
      text: "可以送了",
      delivery: "queue",
    });
    const sent = await client.waitForReply(send);
    expect(sent.kind).toBe("response");
    await client.waitFor(
      (frame) =>
        frame.type === "stream.message_completed" &&
        (frame.payload as { entry: { text: string } }).entry.text === "收到。",
      5000,
    );
    await client.close();
  });

  it("首則訊息讓清單顯示內容摘要，後續訊息不覆寫標題", async () => {
    const host = await boot({ scripts: [[{ kind: "text", text: "收到" }]] });
    const client = await helloClient(host);
    const sessionId = await createSession(client);
    const send = client.request("session.send_message", {
      sessionId,
      text: "請幫我整理旅行計畫",
      delivery: "queue",
    });
    expect((await client.waitForReply(send)).kind).toBe("response");
    const list = await client.waitForReply(client.request("session.list", {}));
    const summary = (
      list.payload as { sessions: Array<{ id: string; title: string }> }
    ).sessions.find((session) => session.id === sessionId);
    expect(summary?.title).toBe("請幫我整理旅行計畫");
    await client.close();
  });

  it("session.list 的 messageCount 會反映已完成的訊息", async () => {
    const host = await boot({ scripts: [[{ kind: "text", text: "計數" }]] });
    const client = await helloClient(host);
    const sessionId = await createSession(client);
    await subscribeSession(client, sessionId);
    client.request("session.send_message", { sessionId, text: "嗨", delivery: "queue" });
    await client.waitForEvent("stream.message_completed");
    const listId = client.request("session.list", { limit: 10 });
    const list = await client.waitForReply(listId);
    const summary = (
      list.payload as { sessions: Array<{ id: string; messageCount: number }> }
    ).sessions.find((session) => session.id === sessionId);
    expect(summary?.messageCount).toBe(2);
    await client.close();
  });
});

describe("一律允許", () => {
  interface AlwaysAllowServiceCalls {
    readonly policyChecks: string[];
    readonly decisions: { requestId: string; effect: string; clientId: string }[];
    readonly granted: string[];
    alwaysAllowed: boolean;
  }

  function provideAlwaysAllowService(host: TestHost): AlwaysAllowServiceCalls {
    const calls: AlwaysAllowServiceCalls = {
      policyChecks: [],
      decisions: [],
      granted: [],
      alwaysAllowed: true,
    };
    const service: AlwaysAllowService = {
      async canAlwaysAllow(requestId) {
        calls.policyChecks.push(requestId);
        return calls.alwaysAllowed;
      },
      async decide(input) {
        calls.decisions.push({
          requestId: input.requestId,
          effect: input.effect,
          clientId: input.decidedBy.clientId,
        });
        const result = await host.host.engine.approvals.decide({
          requestId: input.requestId,
          verdict: "approve",
          decidedBy: input.decidedBy,
          ...(input.note === undefined ? {} : { note: input.note }),
        });
        if (result.outcome === "accepted") {
          calls.granted.push(input.requestId);
          return { outcome: "accepted", decision: result.decision };
        }
        if (result.outcome === "already-decided") {
          return { outcome: "already-decided", decision: result.decision };
        }
        if (result.outcome === "not-found") return { outcome: "not-found" };
        if (result.outcome === "expired") return { outcome: "expired" };
        return { outcome: "withdrawn" };
      },
    };
    host.host.hostServices.provide(HOST_SERVICE_NAMES.permissionDecision, service);
    return calls;
  }

  function approvalOptions(frame: {
    payload?: Record<string, unknown>;
  }): { id: string; label: string; effect: string }[] {
    return (frame.payload as { options: { id: string; label: string; effect: string }[] }).options;
  }

  function toolScript(): readonly (readonly FakeModelStep[])[] {
    return [
      [
        { kind: "tool", toolName: "demo.echo", input: { text: "內容" } },
        { kind: "text", text: "完成" },
      ],
    ];
  }

  async function requestToolApproval(
    client: TestClient,
  ): Promise<{ sessionId: string; approvalId: string }> {
    const sessionId = await createSession(client);
    await subscribeSession(client, sessionId);
    client.request("session.send_message", {
      sessionId,
      text: "用工具",
      delivery: "queue",
    });
    const requested = await client.waitForEvent("approval.requested");
    return {
      sessionId,
      approvalId: (requested.payload as { approvalId: string }).approvalId,
    };
  }

  it("沒有權限服務時不提供一律允許；送 always 回明確的 unsupported", async () => {
    const host = await boot({ scripts: toolScript() });
    const client = await helloClient(host);
    const { approvalId } = await requestToolApproval(client);
    const requested = client.frames.find((frame) => frame.type === "approval.requested");
    expect(approvalOptions(requested!).map((option) => option.id)).toEqual(["approve", "deny"]);

    const decide = client.request("approval.decide", { approvalId, optionId: "always" });
    const reply = await client.waitForReply(decide);
    expect(reply.code).toBe("unsupported");
    expect((reply.details as { reason: string }).reason).toBe("always_unavailable");

    // 審批還在；改用核准一次照常進行。
    const approve = client.request("approval.decide", { approvalId, optionId: "approve" });
    const approved = await client.waitForReply(approve);
    expect((approved.payload as { persisted: boolean }).persisted).toBe(true);
    const result = await client.waitForEvent("stream.tool_result");
    expect((result.payload as { status: string }).status).toBe("ok");
    await client.close();
  });

  it("政策不允許時不提供一律允許；送 always 回 unsupported，服務決定不被呼叫", async () => {
    const host = await boot({ scripts: toolScript() });
    const service = provideAlwaysAllowService(host);
    service.alwaysAllowed = false;
    const client = await helloClient(host);
    const { approvalId } = await requestToolApproval(client);
    const requested = client.frames.find((frame) => frame.type === "approval.requested");
    expect(approvalOptions(requested!).map((option) => option.id)).toEqual(["approve", "deny"]);

    const decide = client.request("approval.decide", { approvalId, optionId: "always" });
    const reply = await client.waitForReply(decide);
    expect(reply.code).toBe("unsupported");
    expect((reply.details as { reason: string }).reason).toBe("always_not_allowed");
    expect(service.decisions).toEqual([]);
    expect(service.granted).toEqual([]);

    const approve = client.request("approval.decide", { approvalId, optionId: "approve" });
    expect((await client.waitForReply(approve)).code).toBeUndefined();
    await client.close();
  });

  it("政策允許時提供一律允許；always 經服務決定，回應與事件都是 approve_always", async () => {
    const host = await boot({ scripts: toolScript() });
    const service = provideAlwaysAllowService(host);
    const client = await helloClient(host);
    const { approvalId } = await requestToolApproval(client);
    const requested = client.frames.find((frame) => frame.type === "approval.requested");
    expect(approvalOptions(requested!)).toEqual([
      { id: "approve", label: "核准", effect: "approve" },
      { id: "always", label: "一律允許", effect: "approve_always" },
      { id: "deny", label: "拒絕", effect: "reject" },
    ]);

    // 第二個客戶端的快照也帶有一律允許。
    const sessionId = (requested!.payload as { sessionId: string }).sessionId;
    const second = await helloClient(host);
    const snapshotId = second.request("session.subscribe", { sessionId });
    const secondSnapshot = await second.waitForReply(snapshotId);
    expect(
      (
        secondSnapshot.payload as { snapshot?: { pendingApproval?: { options: { id: string }[] } } }
      ).snapshot?.pendingApproval?.options.map((option) => option.id),
    ).toEqual(["approve", "always", "deny"]);

    const decided = client.waitForEvent("approval.decided");
    const decide = client.request("approval.decide", { approvalId, optionId: "always" });
    const reply = await client.waitForReply(decide);
    expect((reply.payload as { effect: string }).effect).toBe("approve_always");
    expect((reply.payload as { persisted: boolean }).persisted).toBe(true);
    expect(service.policyChecks).toContain(approvalId);
    expect(service.decisions).toEqual([
      { requestId: approvalId, effect: "approve_always", clientId: "test-1" },
    ]);
    expect(service.granted).toEqual([approvalId]);
    const decidedEvent = await decided;
    expect((decidedEvent.payload as { effect: string }).effect).toBe("approve_always");

    const result = await client.waitForEvent("stream.tool_result");
    expect((result.payload as { status: string }).status).toBe("ok");
    await client.close();
    await second.close();
  });

  /**
   * 回傳固定結果的假服務；用來逐一驗閘道對每種結果的映射。
   * 記錄 decide 的呼叫次數與是否被要求寫白名單，不只驗回應。
   */
  function provideCannedAlwaysAllowService(
    host: TestHost,
    decideOutcome: (requestId: string) => AlwaysAllowDecisionOutcome,
  ): { calls: { decide: number }; granted: string[] } {
    const calls = { decide: 0 };
    const granted: string[] = [];
    const service: AlwaysAllowService = {
      async canAlwaysAllow() {
        return true;
      },
      async decide(input) {
        calls.decide += 1;
        const outcome = decideOutcome(input.requestId);
        if (outcome.outcome === "accepted") granted.push(input.requestId);
        return outcome;
      },
    };
    host.host.hostServices.provide(HOST_SERVICE_NAMES.permissionDecision, service);
    return { calls, granted };
  }

  function acceptedOutcome(requestId: string): AlwaysAllowDecisionOutcome {
    return {
      outcome: "accepted",
      decision: {
        requestId,
        verdict: "approve",
        decidedAt: new Date().toISOString(),
        decidedBy: { kind: "human", clientId: "test-1" },
      },
    };
  }

  it("approve 之後再送 always：不呼叫權限服務，回 conflict，不寫白名單", async () => {
    const host = await boot({ scripts: toolScript() });
    const service = provideAlwaysAllowService(host);
    const client = await helloClient(host);
    const { approvalId } = await requestToolApproval(client);

    const approve = client.request("approval.decide", { approvalId, optionId: "approve" });
    expect((await client.waitForReply(approve)).code).toBeUndefined();

    const decide = client.request("approval.decide", { approvalId, optionId: "always" });
    const reply = await client.waitForReply(decide);
    expect(reply.code).toBe("conflict");
    const details = reply.details as {
      decision: { verdict: string; effect: string };
    };
    expect(details.decision.verdict).toBe("approve");
    expect(details.decision.effect).toBe("approve");
    expect(service.decisions).toEqual([]);
    expect(service.granted).toEqual([]);
    await client.close();
  });

  it("一律允許之後再送 always：第二次不呼叫 decide，回 conflict", async () => {
    const host = await boot({ scripts: toolScript() });
    const service = provideAlwaysAllowService(host);
    const client = await helloClient(host);
    const { approvalId } = await requestToolApproval(client);

    const first = client.request("approval.decide", { approvalId, optionId: "always" });
    expect((await client.waitForReply(first)).code).toBeUndefined();
    expect(service.decisions).toHaveLength(1);
    expect(service.granted).toEqual([approvalId]);

    const second = client.request("approval.decide", { approvalId, optionId: "always" });
    const reply = await client.waitForReply(second);
    expect(reply.code).toBe("conflict");
    const details = reply.details as { decision: { verdict: string } };
    expect(details.decision.verdict).toBe("approve");
    expect(service.decisions).toHaveLength(1);
    expect(service.granted).toEqual([approvalId]);
    await client.close();
  });

  it("審批已撤回再送 always：不呼叫 decide，回 conflict withdrawn，不寫白名單", async () => {
    const host = await boot({ scripts: toolScript() });
    const service = provideAlwaysAllowService(host);
    const client = await helloClient(host);
    const { approvalId } = await requestToolApproval(client);
    await host.host.engine.approvals.withdraw(approvalId, "測試撤回");

    const decide = client.request("approval.decide", { approvalId, optionId: "always" });
    const reply = await client.waitForReply(decide);
    expect(reply.code).toBe("conflict");
    expect((reply.details as { reason: string }).reason).toBe("withdrawn");
    expect(service.decisions).toEqual([]);
    expect(service.granted).toEqual([]);
    await client.close();
  });

  it("權限服務回 expired：閘道回 conflict approval_expired，不寫白名單", async () => {
    const host = await boot({ scripts: toolScript() });
    const canned = provideCannedAlwaysAllowService(host, () => ({ outcome: "expired" }));
    const client = await helloClient(host);
    const { approvalId } = await requestToolApproval(client);

    const decide = client.request("approval.decide", { approvalId, optionId: "always" });
    const reply = await client.waitForReply(decide);
    expect(reply.code).toBe("conflict");
    expect((reply.details as { reason: string }).reason).toBe("approval_expired");
    expect(canned.calls.decide).toBe(1);
    expect(canned.granted).toEqual([]);
    await client.close();
  });

  it("權限服務回 withdrawn：閘道回 conflict withdrawn，不寫白名單", async () => {
    const host = await boot({ scripts: toolScript() });
    const canned = provideCannedAlwaysAllowService(host, () => ({ outcome: "withdrawn" }));
    const client = await helloClient(host);
    const { approvalId } = await requestToolApproval(client);

    const decide = client.request("approval.decide", { approvalId, optionId: "always" });
    const reply = await client.waitForReply(decide);
    expect(reply.code).toBe("conflict");
    expect((reply.details as { reason: string }).reason).toBe("withdrawn");
    expect(canned.calls.decide).toBe(1);
    expect(canned.granted).toEqual([]);
    await client.close();
  });

  it("權限服務回 not-found：閘道回 not_found，不寫白名單", async () => {
    const host = await boot({ scripts: toolScript() });
    const canned = provideCannedAlwaysAllowService(host, () => ({ outcome: "not-found" }));
    const client = await helloClient(host);
    const { approvalId } = await requestToolApproval(client);

    const decide = client.request("approval.decide", { approvalId, optionId: "always" });
    const reply = await client.waitForReply(decide);
    expect(reply.code).toBe("not_found");
    expect(canned.calls.decide).toBe(1);
    expect(canned.granted).toEqual([]);
    await client.close();
  });

  it("權限服務回 cannot-always-allow：閘道回 unsupported always_not_allowed，帶 policy，不寫白名單", async () => {
    const host = await boot({ scripts: toolScript() });
    const canned = provideCannedAlwaysAllowService(host, () => ({
      outcome: "cannot-always-allow",
      reason: "tool_policy_terminal",
    }));
    const client = await helloClient(host);
    const { approvalId } = await requestToolApproval(client);

    const decide = client.request("approval.decide", { approvalId, optionId: "always" });
    const reply = await client.waitForReply(decide);
    expect(reply.code).toBe("unsupported");
    const details = reply.details as { reason: string; policy: string };
    expect(details.reason).toBe("always_not_allowed");
    expect(details.policy).toBe("tool_policy_terminal");
    expect(canned.calls.decide).toBe(1);
    expect(canned.granted).toEqual([]);
    await client.close();
  });

  it("權限服務回 already-decided：閘道回 conflict，不寫白名單", async () => {
    const host = await boot({ scripts: toolScript() });
    const canned = provideCannedAlwaysAllowService(host, (requestId) => ({
      outcome: "already-decided",
      decision: {
        requestId,
        verdict: "approve",
        decidedAt: new Date().toISOString(),
        decidedBy: { kind: "human", clientId: "test-1" },
      },
    }));
    const client = await helloClient(host);
    const { approvalId } = await requestToolApproval(client);

    const decide = client.request("approval.decide", { approvalId, optionId: "always" });
    const reply = await client.waitForReply(decide);
    expect(reply.code).toBe("conflict");
    const details = reply.details as { decision: { verdict: string } };
    expect(details.decision.verdict).toBe("approve");
    expect(canned.calls.decide).toBe(1);
    expect(canned.granted).toEqual([]);
    await client.close();
  });

  it("權限服務回 accepted：閘道回 approve_always 且 persisted，白名單只寫一次", async () => {
    const host = await boot({ scripts: toolScript() });
    const canned = provideCannedAlwaysAllowService(host, acceptedOutcome);
    const client = await helloClient(host);
    const { approvalId } = await requestToolApproval(client);

    const decide = client.request("approval.decide", { approvalId, optionId: "always" });
    const reply = await client.waitForReply(decide);
    expect((reply.payload as { effect: string }).effect).toBe("approve_always");
    expect((reply.payload as { persisted: boolean }).persisted).toBe(true);
    expect(canned.calls.decide).toBe(1);
    expect(canned.granted).toEqual([approvalId]);
    await client.close();
  });

  it("政策查詢丟錯時不提供一律允許，審批沒有整體失敗", async () => {
    const host = await boot({ scripts: toolScript() });
    host.host.hostServices.provide(HOST_SERVICE_NAMES.permissionDecision, {
      async canAlwaysAllow(): Promise<boolean> {
        throw new Error("政策服務壞了");
      },
      async decide(): Promise<never> {
        throw new Error("不該被呼叫");
      },
    });
    const client = await helloClient(host);
    const { approvalId } = await requestToolApproval(client);
    const requested = client.frames.find((frame) => frame.type === "approval.requested");
    expect(approvalOptions(requested!).map((option) => option.id)).toEqual(["approve", "deny"]);
    const approve = client.request("approval.decide", { approvalId, optionId: "approve" });
    expect((await client.waitForReply(approve)).code).toBeUndefined();
    await client.close();
  });
});

describe("工具結果轉成協定輸出", () => {
  async function runTool(host: TestHost): Promise<Record<string, unknown>> {
    const client = await helloClient(host);
    const sessionId = await createSession(client);
    await subscribeSession(client, sessionId);
    const send = client.request("session.send_message", {
      sessionId,
      text: "用工具",
      delivery: "queue",
    });
    await client.waitForReply(send);
    const requested = await client.waitForEvent("approval.requested");
    const approvalId = (requested.payload as { approvalId: string }).approvalId;
    const decide = client.request("approval.decide", { approvalId, optionId: "approve" });
    await client.waitForReply(decide);
    const result = await client.waitForEvent("stream.tool_result");
    await client.close();
    return result.payload as Record<string, unknown>;
  }

  it("只有一段 JSON 文字時還原成 data，text 保持原樣", async () => {
    const host = await boot({
      scripts: [
        [
          {
            kind: "tool",
            toolName: "demo.echo",
            input: { text: '{"boardId":"b1","inboxSize":2}' },
          },
          { kind: "text", text: "完成" },
        ],
      ],
    });
    const payload = await runTool(host);
    expect(payload.status).toBe("ok");
    expect(payload.output).toEqual({
      text: '{"boardId":"b1","inboxSize":2}',
      data: { boardId: "b1", inboxSize: 2 },
    });
  });

  it("純文字不是 JSON 時只留 text，不硬塞 data", async () => {
    const host = await boot({
      scripts: [
        [
          { kind: "tool", toolName: "demo.echo", input: { text: "不是 JSON 的結果" } },
          { kind: "text", text: "完成" },
        ],
      ],
    });
    const payload = await runTool(host);
    expect(payload.output).toEqual({ text: "不是 JSON 的結果" });
  });
});

describe("system stream 的宿主審批投影", () => {
  function hostApprovalDraft(suffix: string) {
    return {
      action: {
        kind: "module-enable" as const,
        summary: `允許新增 MCP 伺服器「拒絕測試-${suffix}」`,
        details: [{ label: "名稱", value: `拒絕測試-${suffix}` }],
        toolInput: {
          name: `拒絕測試-${suffix}`,
          transport: "stdio",
          command: "/usr/bin/true",
          allowedHosts: [],
        },
      },
      risk: "high" as const,
      requestedBy: { kind: "host" as const, component: "mcp" },
      hostApproval: { component: "mcp", requestId: `host-${suffix}-${Math.random()}` },
    };
  }

  it("外部代理審批不進 system 串流；宿主審批拒絕後送出 effect=reject", async () => {
    const host = await boot();
    const client = await helloClient(host);
    const subscribeId = client.request("system.subscribe", {});
    await client.waitForReply(subscribeId);

    const external = await host.host.engine.approvals.request({
      externalAgent: { sessionId: "agent-1", requestId: "permission:1" },
      action: {
        kind: "tool-execution" as const,
        summary: "外部代理工具呼叫",
        toolName: "demo.echo",
        toolInput: { text: "external" },
      },
      risk: "high" as const,
      requestedBy: { kind: "agent" as const, agentId: "agent-1" },
      timeoutMs: 60_000,
    });

    const hostApproval = await host.host.engine.approvals.request(hostApprovalDraft("exclude"));
    const requested = await client.waitFor(
      (frame) =>
        frame.kind === "event" &&
        frame.type === "approval.requested" &&
        (frame.payload as { approvalId?: string }).approvalId === hostApproval.id,
    );
    expect((requested.payload as { sessionId?: string }).sessionId).toBe("");

    // 等外部代理審批的處理結束之後再比對，避免假陰性。
    await new Promise((resolve) => setTimeout(resolve, 150));
    const leaked = client.frames.filter(
      (frame) =>
        frame.kind === "event" &&
        (frame.payload as { approvalId?: string } | undefined)?.approvalId === external.id,
    );
    expect(leaked).toEqual([]);

    const decideId = client.request("approval.decide", {
      approvalId: hostApproval.id,
      optionId: "deny",
    });
    await client.waitForReply(decideId);
    const decided = await client.waitForEvent("approval.decided");
    expect(decided.payload).toMatchObject({
      approvalId: hostApproval.id,
      sessionId: "",
      effect: "reject",
    });

    // 外部代理審批決定後同樣不會出現在 system 串流。
    await host.host.engine.approvals.decide({
      requestId: external.id,
      verdict: "deny",
      decidedBy: { kind: "human", clientId: "test" },
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const leakedAfterDecision = client.frames.filter(
      (frame) =>
        frame.kind === "event" &&
        (frame.payload as { approvalId?: string } | undefined)?.approvalId === external.id,
    );
    expect(leakedAfterDecision).toEqual([]);
    await client.close();
  });

  it("system.subscribe 快照帶待決宿主審批、不列已過期；決定後清單為空", async () => {
    const host = await boot();
    const client = await helloClient(host);

    const expiring = await host.host.engine.approvals.request({
      ...hostApprovalDraft("expiring"),
      timeoutMs: 5,
    });
    const pending = await host.host.engine.approvals.request(hostApprovalDraft("pending"));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const subscribeId = client.request("system.subscribe", {});
    const reply = await client.waitForReply(subscribeId);
    const payload = reply.payload as {
      resyncRequired?: boolean;
      pendingApprovals?: Array<{
        approvalId?: string;
        sessionId?: string;
        scope?: { kind?: string };
      }>;
    };
    expect(payload.resyncRequired).toBe(true);
    const ids = (payload.pendingApprovals ?? []).map((entry) => entry.approvalId);
    expect(ids).toContain(pending.id);
    expect(ids).not.toContain(expiring.id);
    expect(
      (payload.pendingApprovals ?? []).every(
        (entry) => entry.sessionId === "" && entry.scope?.kind === "settings_change",
      ),
    ).toBe(true);

    await client.waitForReply(
      client.request("approval.decide", { approvalId: pending.id, optionId: "deny" }),
    );
    // 決定之後再要求快照：這筆不再列出。
    const again = await helloClient(host);
    const againSubscribe = again.request("system.subscribe", {});
    const againReply = await again.waitForReply(againSubscribe);
    const againPayload = againReply.payload as {
      pendingApprovals?: Array<{ approvalId?: string }>;
    };
    expect((againPayload.pendingApprovals ?? []).map((entry) => entry.approvalId)).not.toContain(
      pending.id,
    );
    await again.close();
    await client.close();
  });

  it("自填 agent: 前綴的 instanceId 不會變成代理；human-only 設定仍看得到", async () => {
    const host = await boot({ modulesDirectory: MODULES_DIRECTORY });
    const client = await TestClient.connect(host.url);
    // 直接送 hello，自填 agent: 開頭的 instanceId；閘道只驗人類的 token，
    // 身分由閘道指派，不會採用這個字串。
    const helloReply = await client.waitForReply(
      client.request("system.hello", {
        protocol: { min: 1, max: 1 },
        client: { name: "test", version: "0", platform: "other", instanceId: "agent:evil" },
        auth: { token: host.token },
      }),
    );
    expect(helloReply.kind).toBe("response");

    const setReply = await client.waitForReply(
      client.request("system.models.set", {
        providers: [
          {
            providerId: "local",
            kind: "local",
            displayName: "本機",
            baseUrl: "http://127.0.0.1:1/v1",
            models: [{ modelId: "local-model", contextWindow: 32_768, input: ["text"] }],
          },
        ],
        clientRequestId: "agent-prefix-1",
      }),
    );
    expect(setReply.kind).toBe("response");

    const changesReply = await client.waitForReply(client.request("settings.changes.list", {}));
    const changes = (
      changesReply.payload as {
        changes: Array<{ key: string; proposedBy: string }>;
      }
    ).changes;
    expect(changes.find((entry) => entry.key === "models.providers")?.proposedBy).toBe(
      "user:agent:evil",
    );

    const settingsReply = await client.waitForReply(client.request("system.settings.get", {}));
    const items = (settingsReply.payload as { settings: Array<{ key: string }> }).settings;
    expect(items.map((entry) => entry.key)).toContain("permissions.mode");
    await client.close();
  });
});
