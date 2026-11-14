import { afterEach, describe, expect, it } from "vitest";

import { TestClient, startTestHost, waitUntil, type TestHost } from "./helpers.js";

const hosts: TestHost[] = [];

afterEach(async () => {
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

  it("不是 127.0.0.1 的路徑與端點都不提供狀態變更", async () => {
    const host = await boot();
    const response = await fetch(`http://127.0.0.1:${host.host.port}/v1/blobs/x`, {
      method: "POST",
      headers: { authorization: `Bearer ${host.token}` },
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("unsupported");
    const unauthorized = await fetch(`http://127.0.0.1:${host.host.port}/v1/blobs/x`);
    expect(unauthorized.status).toBe(401);
    await host.close();
  });
});
