import { request as httpRequest } from "node:http";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  connectAndHello,
  spawnService,
  type ProtocolClient,
  type SpawnedService,
} from "../test/support.js";

/**
 * 多模態原檔的 HTTP 契約：對真的主機行程跑。
 *
 * 大型內容只走 HTTP，不走 WebSocket；這一組驗認證、上限、ETag、Range、
 * HEAD 與縮圖變體。匯入成卡片走 `media.import`，在下面的協定組驗。
 */

/** 1×1 PNG；sharp 讀得出來，足以驗縮圖。 */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function baseUrl(service: SpawnedService): string {
  return `http://127.0.0.1:${service.ready.clientPort}`;
}

function bearer(service: SpawnedService): Record<string, string> {
  return { authorization: `Bearer ${service.clientToken}` };
}

interface BlobInfo {
  readonly blobId: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
}

async function upload(
  service: SpawnedService,
  bytes: Uint8Array,
  mediaType = "image/png",
): Promise<BlobInfo> {
  const response = await fetch(`${baseUrl(service)}/v1/blobs`, {
    method: "POST",
    headers: { ...bearer(service), "content-type": mediaType },
    body: bytes,
  });
  expect(response.status).toBe(201);
  return (await response.json()) as BlobInfo;
}

/** 每個測試用不同內容，避免 blobId 去重讓測試互相影響。 */
function imageBytes(variant: number): Uint8Array {
  return new Uint8Array(Buffer.concat([TINY_PNG, Buffer.from([variant])]));
}

/** 用原始 http 送出「宣告很大、實際沒有內容」的上傳，驗 413 不讀檔。 */
function uploadWithDeclaredLength(input: {
  readonly port: number;
  readonly token: string;
  readonly headers: Record<string, string>;
  readonly body?: Buffer;
}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port: input.port,
        path: "/v1/blobs",
        method: "POST",
        headers: {
          authorization: `Bearer ${input.token}`,
          "content-type": "image/png",
          ...input.headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.on("error", reject);
    request.end(input.body);
  });
}

describe("多模態原檔 HTTP 端點", () => {
  let service: SpawnedService;

  beforeAll(async () => {
    service = await spawnService({});
  }, 30_000);

  afterAll(async () => {
    await service?.stop();
  });

  it("沒有或錯的 Token 一律回 401 錯誤信封", async () => {
    const missing = await fetch(`${baseUrl(service)}/v1/blobs/${"a".repeat(64)}`);
    expect(missing.status).toBe(401);
    const missingBody = (await missing.json()) as Record<string, unknown>;
    expect(missingBody).toMatchObject({ v: 1, kind: "error", code: "auth_invalid" });
    expect(typeof missingBody.message).toBe("string");

    const wrong = await fetch(`${baseUrl(service)}/v1/blobs/${"a".repeat(64)}`, {
      headers: { authorization: `Bearer ${"Z".repeat(43)}` },
    });
    expect(wrong.status).toBe(401);
    expect(((await wrong.json()) as Record<string, unknown>).code).toBe("auth_invalid");
  });

  it("上傳以內容雜湊命名；同一個檔案上傳兩次回同一個識別碼", async () => {
    const first = await upload(service, new Uint8Array(TINY_PNG));
    expect(first.blobId).toMatch(/^[0-9a-f]{64}$/);
    expect(first.mediaType).toBe("image/png");
    expect(first.sizeBytes).toBe(TINY_PNG.byteLength);

    const second = await upload(service, new Uint8Array(TINY_PNG));
    expect(second.blobId).toBe(first.blobId);
  });

  it("GET 回原檔位元組與 ETag；If-None-Match 命中回 304 且沒有內容", async () => {
    const info = await upload(service, new Uint8Array(TINY_PNG));
    const response = await fetch(`${baseUrl(service)}/v1/blobs/${info.blobId}`, {
      headers: bearer(service),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("etag")).toBe(`"${info.blobId}"`);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(Buffer.from(await response.arrayBuffer()).equals(TINY_PNG)).toBe(true);

    const cached = await fetch(`${baseUrl(service)}/v1/blobs/${info.blobId}`, {
      headers: { ...bearer(service), "if-none-match": `"${info.blobId}"` },
    });
    expect(cached.status).toBe(304);
    expect(cached.headers.get("etag")).toBe(`"${info.blobId}"`);
    expect(await cached.text()).toBe("");
  });

  it("Range 回 206 與正確片段；不合法的 Range 回 416", async () => {
    const info = await upload(service, new Uint8Array(TINY_PNG));
    const partial = await fetch(`${baseUrl(service)}/v1/blobs/${info.blobId}`, {
      headers: { ...bearer(service), range: "bytes=0-7" },
    });
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe(`bytes 0-7/${TINY_PNG.byteLength}`);
    expect(partial.headers.get("content-length")).toBe("8");
    expect(Buffer.from(await partial.arrayBuffer()).equals(TINY_PNG.subarray(0, 8))).toBe(true);

    const invalid = await fetch(`${baseUrl(service)}/v1/blobs/${info.blobId}`, {
      headers: { ...bearer(service), range: `bytes=${TINY_PNG.byteLength}-` },
    });
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get("content-range")).toBe(`bytes */${TINY_PNG.byteLength}`);
    expect(((await invalid.json()) as Record<string, unknown>).code).toBe("invalid_message");
  });

  it("HEAD 回相同的標頭但不傳內容", async () => {
    const info = await upload(service, new Uint8Array(TINY_PNG));
    const response = await fetch(`${baseUrl(service)}/v1/blobs/${info.blobId}`, {
      method: "HEAD",
      headers: bearer(service),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe(String(TINY_PNG.byteLength));
    expect(response.headers.get("etag")).toBe(`"${info.blobId}"`);
    expect(await response.text()).toBe("");
  });

  it("縮圖變體是 JPEG，位元組固定；刪掉 thumbs 後重產仍相同", async () => {
    const info = await upload(service, new Uint8Array(TINY_PNG));
    const first = await fetch(`${baseUrl(service)}/v1/blobs/${info.blobId}?variant=thumb`, {
      headers: bearer(service),
    });
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("image/jpeg");
    expect(first.headers.get("etag")).toBe(`"${info.blobId}-thumb"`);
    const firstBytes = Buffer.from(await first.arrayBuffer());
    expect(firstBytes.byteLength).toBeGreaterThan(0);
    // JPEG 的 SOI 標記：ff d8。
    expect(firstBytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));

    const again = await fetch(`${baseUrl(service)}/v1/blobs/${info.blobId}?variant=thumb`, {
      headers: bearer(service),
    });
    expect(Buffer.from(await again.arrayBuffer()).equals(firstBytes)).toBe(true);

    // 只刪縮圖快取；cache 的索引資料庫還在執行中，不整包刪。
    await rm(join(service.folder.path, "cache", "thumbs"), { recursive: true, force: true });
    const rebuilt = await fetch(`${baseUrl(service)}/v1/blobs/${info.blobId}?variant=thumb`, {
      headers: bearer(service),
    });
    expect(rebuilt.status).toBe(200);
    expect(Buffer.from(await rebuilt.arrayBuffer()).equals(firstBytes)).toBe(true);
  });

  it("超過 100 MB 上限回 413 payload_too_large，不讀內容", async () => {
    const response = await uploadWithDeclaredLength({
      port: service.ready.clientPort,
      token: service.clientToken,
      headers: { "content-length": String(100 * 1024 * 1024 + 1) },
    });
    expect(response.status).toBe(413);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body).toMatchObject({ v: 1, kind: "error", code: "payload_too_large" });
  });

  it("不支援的媒體類型回 415；缺 Content-Type 回 400", async () => {
    const unsupported = await fetch(`${baseUrl(service)}/v1/blobs`, {
      method: "POST",
      headers: { ...bearer(service), "content-type": "application/pdf" },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(unsupported.status).toBe(415);
    expect(((await unsupported.json()) as Record<string, unknown>).code).toBe("unsupported");

    const missing = await fetch(`${baseUrl(service)}/v1/blobs`, {
      method: "POST",
      headers: bearer(service),
      body: new Uint8Array([1, 2, 3]),
    });
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as Record<string, unknown>).code).toBe("invalid_message");
  });

  it("找不到的原檔回 404；不支援的 variant 回 400", async () => {
    const missing = await fetch(`${baseUrl(service)}/v1/blobs/${"b".repeat(64)}`, {
      headers: bearer(service),
    });
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as Record<string, unknown>).code).toBe("not_found");

    const info = await upload(service, new Uint8Array(TINY_PNG));
    const badVariant = await fetch(`${baseUrl(service)}/v1/blobs/${info.blobId}?variant=original`, {
      headers: bearer(service),
    });
    expect(badVariant.status).toBe(400);
    expect(((await badVariant.json()) as Record<string, unknown>).code).toBe("invalid_message");
  });
});

interface ImportResponse {
  readonly cardId: string;
  readonly kind: "image" | "audio";
  readonly textStandIn: {
    readonly sources: {
      readonly ocr: "local" | "none";
      readonly description: "small-model" | "none";
      readonly transcript: "local" | "none";
      readonly summary: "small-model" | "none";
    };
    readonly missingParts: string[];
  };
  readonly deduped: boolean;
}

async function call<T = Record<string, unknown>>(
  client: ProtocolClient,
  type: string,
  payload: Record<string, unknown>,
  ms = 15_000,
): Promise<T> {
  const id = client.request(type, payload);
  const reply = await client.waitForReply(id, ms);
  if (reply.kind === "error") {
    throw new Error(`${type} 失敗：${String(reply.code)} ${String(reply.message)}`);
  }
  return reply.payload as T;
}

describe("media.import 協定", () => {
  let service: SpawnedService;
  let client: ProtocolClient;
  const brokerCalls: Array<{ route: string; payload: Record<string, unknown> }> = [];

  beforeAll(async () => {
    service = await spawnService({ control: true });
    service.setBrokerHandler((route, payload) => {
      brokerCalls.push({ route, payload });
      if (route === "broker.recognition.ocr") {
        return { available: true, text: "預算 120 萬\n排程延到三月", locale: "zh-Hant" };
      }
      if (route === "broker.recognition.transcribe") {
        return { available: true, text: "我們下週去看房子。", locale: "zh-TW" };
      }
      return null;
    });
    client = await connectAndHello(service);
  }, 30_000);

  afterAll(async () => {
    await client?.close().catch(() => undefined);
    await service?.stop().catch(() => undefined);
  });

  it("上傳 blob 後匯入圖片：產生卡片與文字替身，內文看得到 OCR", async () => {
    const blob = await upload(service, imageBytes(1));
    const response = await call<ImportResponse>(client, "media.import", {
      blobId: blob.blobId,
      title: "會議白板",
      tags: ["會議"],
      ocrLocales: ["zh-Hant"],
    });
    expect(response.cardId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(response.kind).toBe("image");
    expect(response.deduped).toBe(false);
    expect(response.textStandIn.sources.ocr).toBe("local");
    expect(response.textStandIn.sources.transcript).toBe("none");

    const ocrCall = brokerCalls.find((entry) => entry.route === "broker.recognition.ocr");
    expect(ocrCall?.payload.locales).toEqual(["zh-Hant"]);

    const card = await call<{
      card: { title: string; body: string; kind: string; asset?: { blobId: string } };
    }>(client, "card.get", { cardId: response.cardId });
    expect(card.card.title).toBe("會議白板");
    expect(card.card.kind).toBe("image");
    expect(card.card.asset?.blobId).toBe(blob.blobId);
    expect(card.card.body).toContain("## OCR 文字");
    expect(card.card.body).toContain("預算 120 萬");
  });

  it("同一個 blobId 重送回同一張卡，deduped 為 true", async () => {
    const blob = await upload(service, imageBytes(2));
    const first = await call<ImportResponse>(client, "media.import", { blobId: blob.blobId });
    const second = await call<ImportResponse>(client, "media.import", { blobId: blob.blobId });
    expect(second.cardId).toBe(first.cardId);
    expect(second.deduped).toBe(true);
    expect(second.textStandIn.sources).toEqual(first.textStandIn.sources);
    expect(second.textStandIn.missingParts).toEqual(first.textStandIn.missingParts);
  });

  it("音訊的 locale 傳給語音轉文字，摘要在文字替身裡", async () => {
    const blob = await upload(service, new TextEncoder().encode("fake audio"), "audio/mp4");
    const response = await call<ImportResponse>(client, "media.import", {
      blobId: blob.blobId,
      locale: "zh-TW",
    });
    expect(response.kind).toBe("audio");
    expect(response.textStandIn.sources.transcript).toBe("local");
    expect(response.textStandIn.sources.ocr).toBe("none");

    const transcribeCall = brokerCalls.find(
      (entry) => entry.route === "broker.recognition.transcribe",
    );
    expect(transcribeCall?.payload.locale).toBe("zh-TW");

    const card = await call<{ card: { body: string } }>(client, "card.get", {
      cardId: response.cardId,
    });
    expect(card.card.body).toContain("## 逐字稿");
    expect(card.card.body).toContain("下週去看房子");
  });

  it("未知的 blobId 回 not_found", async () => {
    const id = client.request("media.import", { blobId: "f".repeat(64) });
    const reply = await client.waitForReply(id);
    expect(reply).toMatchObject({ kind: "error", code: "not_found" });
  });
});

describe("同時匯入圖片", () => {
  it("兩個客戶端都能取得 OCR 並寫進各自的卡片", async () => {
    const service = await spawnService({ control: true });
    const clients: ProtocolClient[] = [];
    try {
      const firstClient = await connectAndHello(service);
      clients.push(firstClient);
      const secondClient = await connectAndHello(service);
      clients.push(secondClient);
      const [firstBlob, secondBlob] = await Promise.all([
        upload(service, imageBytes(10)),
        upload(service, imageBytes(11)),
      ]);
      const requests = () =>
        service
          .stdoutLines()
          .map((line) => JSON.parse(line) as Record<string, unknown>)
          .filter((frame) => frame.kind === "request" && frame.route === "broker.recognition.ocr");
      const waitForRequests = async (count: number) => {
        const deadline = Date.now() + 5000;
        while (requests().length < count) {
          if (Date.now() >= deadline) throw new Error("等待 OCR 請求逾時");
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      };
      const reply = (frame: Record<string, unknown>, text: string) => {
        service.controlRaw(
          JSON.stringify({
            v: 1,
            kind: "response",
            id: `response_${String(frame.id)}`,
            replyTo: frame.id,
            auth: { token: service.controlToken },
            ok: true,
            payload: { available: true, text },
          }),
        );
      };
      const first = call<ImportResponse>(firstClient, "media.import", { blobId: firstBlob.blobId });
      await waitForRequests(1);
      let secondFinished = false;
      const second = call<ImportResponse>(secondClient, "media.import", {
        blobId: secondBlob.blobId,
      }).finally(() => {
        secondFinished = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(secondFinished).toBe(false);
      expect(requests()).toHaveLength(1);
      reply(requests()[0]!, "第一張辨識文字");
      await waitForRequests(2);
      reply(requests()[1]!, "第二張辨識文字");
      const results = await Promise.all([first, second]);
      expect(results.map((result) => result.textStandIn.sources.ocr)).toEqual(["local", "local"]);
      const cards = await Promise.all(
        results.map((result) =>
          call<{ card: { body: string } }>(firstClient, "card.get", { cardId: result.cardId }),
        ),
      );
      expect(cards[0]?.card.body).toContain("第一張辨識文字");
      expect(cards[1]?.card.body).toContain("第二張辨識文字");
    } finally {
      await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
      await service.stop();
    }
  }, 30_000);
});

describe("media.import 沒有殼", () => {
  let service: SpawnedService;
  let client: ProtocolClient;

  beforeAll(async () => {
    service = await spawnService({});
    client = await connectAndHello(service);
  }, 30_000);

  afterAll(async () => {
    await client?.close().catch(() => undefined);
    await service?.stop().catch(() => undefined);
  });

  it("匯入仍完成，回應與卡片都標明缺少本機辨識", async () => {
    const blob = await upload(service, imageBytes(3));
    const response = await call<ImportResponse>(client, "media.import", { blobId: blob.blobId });
    expect(response.textStandIn.sources).toEqual({
      ocr: "none",
      description: "none",
      transcript: "none",
      summary: "none",
    });
    expect(response.textStandIn.missingParts.join()).toContain("no_shell");

    const card = await call<{ card: { body: string } }>(client, "card.get", {
      cardId: response.cardId,
    });
    expect(card.card.body).toContain("## 缺少的部分");
    expect(card.card.body).toContain("no_shell");
  });
});
