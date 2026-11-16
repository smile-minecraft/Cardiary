import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import { ControlChannel } from "../../src/control/channel.js";
import { LineWriter } from "../../src/control/ndjson.js";
import { SilentLogger } from "../../src/logging.js";

const TOKEN = "T".repeat(43);
const BROKER = "B".repeat(43);
const OCR = "broker.recognition.ocr";
const AUDIO = "broker.recognition.transcribe";

async function harness() {
  const input = new PassThrough();
  const lines: Array<Record<string, unknown>> = [];
  const channel = new ControlChannel({
    input,
    writer: new LineWriter((chunk, callback) => {
      lines.push(JSON.parse(chunk) as Record<string, unknown>);
      callback(null);
    }),
    token: TOKEN,
    brokerToken: BROKER,
    logger: new SilentLogger(),
    brokerTimeoutMs: 1000,
  });
  channel.start();
  const handshake = channel.handshake();
  input.write(
    `${JSON.stringify({ v: 1, kind: "hello-ack", role: "shell", auth: { token: TOKEN } })}\n`,
  );
  await handshake;
  const requests = () => lines.filter((line) => line.kind === "request");
  const reply = (request: Record<string, unknown>, payload: Record<string, unknown>) => {
    input.write(
      `${JSON.stringify({ v: 1, kind: "response", id: `reply_${String(request.id)}`, replyTo: request.id, auth: { token: TOKEN }, ok: true, payload })}\n`,
    );
  };
  return { channel, requests, reply };
}

async function waitUntil(check: () => boolean) {
  const deadline = Date.now() + 1000;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("等待請求逾時");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("服務端代理請求佇列", () => {
  it("同一路由按順序送出並回傳對應結果", async () => {
    const h = await harness();
    const first = h.channel.requestBroker(OCR, { text: "first" });
    const second = h.channel.requestBroker(OCR, { text: "second" });
    await waitUntil(() => h.requests().length === 1);
    expect(h.requests()[0]?.payload).toEqual({ text: "first" });
    h.reply(h.requests()[0]!, { result: "one" });
    await expect(first).resolves.toEqual({ result: "one" });
    await waitUntil(() => h.requests().length === 2);
    expect(h.requests()[1]?.payload).toEqual({ text: "second" });
    h.reply(h.requests()[1]!, { result: "two" });
    await expect(second).resolves.toEqual({ result: "two" });
    h.channel.close();
  });

  it("逾時讓同路由佇列失敗，遲到回覆不影響後續請求", async () => {
    const h = await harness();
    const first = h.channel.requestBroker(OCR, { text: "first" }, { timeoutMs: 30 });
    const second = h.channel.requestBroker(OCR, { text: "second" });
    const results = Promise.allSettled([first, second]);
    await waitUntil(() => h.requests().length === 1);
    const expired = h.requests()[0]!;
    const outcomes = await results;
    expect(outcomes.map((result) => result.status === "rejected" && result.reason.code)).toEqual([
      "timeout",
      "timeout",
    ]);
    expect(h.requests()).toHaveLength(1);
    const third = h.channel.requestBroker(OCR, { text: "third" });
    await waitUntil(() => h.requests().length === 2);
    h.reply(expired, { result: "late" });
    expect(h.channel.closed).toBe(false);
    h.reply(h.requests()[1]!, { result: "three" });
    await expect(third).resolves.toEqual({ result: "three" });
    h.channel.close();
  });

  it("關閉時在途與排隊請求都收到 unavailable", async () => {
    const h = await harness();
    const first = h.channel.requestBroker(OCR, {});
    const second = h.channel.requestBroker(OCR, {});
    const results = Promise.allSettled([first, second]);
    await waitUntil(() => h.requests().length === 1);
    h.channel.close();
    expect(
      (await results).map((result) => result.status === "rejected" && result.reason.code),
    ).toEqual(["unavailable", "unavailable"]);
  });

  it("取消排隊請求不影響同路由的其他請求", async () => {
    const h = await harness();
    const controller = new AbortController();
    const first = h.channel.requestBroker(OCR, { order: 1 });
    const cancelled = h.channel.requestBroker(OCR, { order: 2 }, { signal: controller.signal });
    const third = h.channel.requestBroker(OCR, { order: 3 });
    const cancellation = expect(cancelled).rejects.toMatchObject({ code: "cancelled" });
    await waitUntil(() => h.requests().length === 1);
    controller.abort();
    await cancellation;
    h.reply(h.requests()[0]!, { order: 1 });
    await expect(first).resolves.toEqual({ order: 1 });
    await waitUntil(() => h.requests().length === 2);
    expect(h.requests()[1]?.payload).toEqual({ order: 3 });
    h.reply(h.requests()[1]!, { order: 3 });
    await expect(third).resolves.toEqual({ order: 3 });
    h.channel.close();
  });

  it("取消在途請求後忽略遲到回覆，並繼續佇列", async () => {
    const h = await harness();
    const controller = new AbortController();
    const first = h.channel.requestBroker(OCR, {}, { signal: controller.signal });
    const second = h.channel.requestBroker(OCR, { order: 2 });
    const cancellation = expect(first).rejects.toMatchObject({ code: "cancelled" });
    await waitUntil(() => h.requests().length === 1);
    const cancelled = h.requests()[0]!;
    controller.abort();
    await cancellation;
    await waitUntil(() => h.requests().length === 2);
    h.reply(cancelled, { order: 1 });
    expect(h.channel.closed).toBe(false);
    h.reply(h.requests()[1]!, { order: 2 });
    await expect(second).resolves.toEqual({ order: 2 });
    h.channel.close();
  });

  it("只保留最近 64 個逾時或取消的請求識別碼", async () => {
    const h = await harness();
    for (let i = 0; i < 65; i++) {
      const controller = new AbortController();
      const pending = h.channel.requestBroker(OCR, { order: i }, { signal: controller.signal });
      const cancellation = expect(pending).rejects.toMatchObject({ code: "cancelled" });
      await waitUntil(() => h.requests().length === i + 1);
      controller.abort();
      await cancellation;
    }
    h.reply(h.requests()[64]!, {});
    expect(h.channel.closed).toBe(false);
    h.reply(h.requests()[0]!, {});
    expect(h.channel.closed).toBe(true);
    expect(h.channel.closeReason).toBe("invalid_message");
  });

  it("不同路由能同時送出", async () => {
    const h = await harness();
    const first = h.channel.requestBroker(OCR, {});
    const second = h.channel.requestBroker(AUDIO, {});
    await waitUntil(() => h.requests().length === 2);
    expect(h.requests().map((request) => request.route)).toEqual([OCR, AUDIO]);
    h.reply(h.requests()[1]!, { result: "audio" });
    await expect(second).resolves.toEqual({ result: "audio" });
    h.reply(h.requests()[0]!, { result: "ocr" });
    await expect(first).resolves.toEqual({ result: "ocr" });
    h.channel.close();
  });
});
