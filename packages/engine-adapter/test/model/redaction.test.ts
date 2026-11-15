import { describe, expect, it } from "vitest";

import {
  redactError,
  redactingTransformStream,
  secretRedactor,
  REDACTED,
} from "../../src/internal/model/redaction.js";
import { redactingFetch, retryAfterMsFrom } from "../../src/internal/model/provider-response.js";

const SECRET = "sk-test-redaction-0001";

describe("憑證清洗", () => {
  it("原文、Bearer、JSON 跳脫與 URL 編碼形式都換成固定文字", () => {
    const redact = secretRedactor(SECRET);
    const encoded = encodeURIComponent(SECRET);
    const escaped = JSON.stringify(SECRET).slice(1, -1);
    const text = [
      `Incorrect API key provided: ${SECRET}`,
      `Authorization: Bearer ${SECRET}`,
      `encoded=${encoded}`,
      `lower=${encoded.toLowerCase()}`,
      `escaped=${escaped}`,
    ].join("\n");
    const redacted = redact(text);
    expect(redacted).not.toContain(SECRET);
    expect(redacted).not.toContain(encoded.toLowerCase());
    expect(redacted).toContain(REDACTED);
  });

  it("比對不分大小寫，金鑰的大寫形式也會被換掉", () => {
    const redact = secretRedactor("ab-secret-cd");
    expect(redact("AB-SECRET-CD")).toBe(REDACTED);
    expect(redact("about ab-secret-cd and Ab-Secret-Cd")).toBe(`about ${REDACTED} and ${REDACTED}`);
  });

  it("空金鑰不產生任何樣式，文字原樣保留", () => {
    const redact = secretRedactor("");
    expect(redact("")).toBe("");
    expect(redact("plain text 123")).toBe("plain text 123");
    expect(redact("plain text 123")).not.toContain(REDACTED);
  });

  it("重複跳脫的形式也換掉（引擎持久化前還會再 stringify 一層）", () => {
    const secret = 'sk-proj-"slash\\key"';
    const redact = secretRedactor(secret);
    const esc = (text: string): string => JSON.stringify(text).slice(1, -1);
    // 單層跳脫：訊息裡的 json= 欄位；引擎把錯誤再 stringify 一次後的兩層跳脫。
    // 第 4 層是最後一層有承諾的深度（MAX_JSON_ESCAPE_DEPTH），第 5 層不在承諾內。
    for (const level of [1, 2, 3, 4]) {
      const needle = Array.from({ length: level }, () => "").reduce((text) => esc(text), secret);
      expect(redact(`json=${needle}`)).toBe(`json=${REDACTED}`);
    }
  });

  it("錯誤的 message、stack、headers 與 cause 鏈都清洗", () => {
    const redact = secretRedactor(SECRET);
    const deepest = Object.assign(new Error(`connect failed with Bearer ${SECRET}`), {
      code: "ECONNREFUSED",
    });
    const middle = new Error("fetch failed", { cause: deepest });
    const error = Object.assign(new Error(`Unauthorized: ${SECRET}`), {
      cause: middle,
      headers: new Headers({ "x-echo": `Bearer ${SECRET}` }),
      body: `{"key":"${SECRET}"}`,
    });
    const redacted = redactError(error, redact) as Error & {
      cause: Error & { cause: Error };
      headers: Headers;
      body: string;
      stack?: string;
    };
    const texts = [
      redacted.message,
      redacted.stack ?? "",
      redacted.body,
      redacted.headers.get("x-echo") ?? "",
      redacted.cause.message,
      redacted.cause.cause.message,
    ];
    for (const text of texts) {
      expect(text).not.toContain(SECRET);
    }
    expect(redacted.cause.cause.message).toContain("[redacted]");
  });
});

function streamedResponse(chunks: readonly Uint8Array[], contentType?: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: contentType === undefined ? {} : { "content-type": contentType },
  });
}

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("200 串流的清洗", () => {
  const prefix = 'data: {"error":{"message":"Incorrect API key provided: ';
  const suffix = '","type":"invalid_request_error"}}\n\ndata: [DONE]\n\n';
  const payload = `${prefix}${SECRET}${suffix}`;

  for (const chunkCount of [1, 3, 17, 64]) {
    it(`error 事件裡的金鑰在切成 ${chunkCount} 個 chunk 時也換掉`, async () => {
      const chunks: Uint8Array[] = [];
      for (let index = 0; index < chunkCount; index++) {
        chunks.push(
          bytesOf(
            payload.slice(
              Math.floor((index * payload.length) / chunkCount),
              Math.floor(((index + 1) * payload.length) / chunkCount),
            ),
          ),
        );
      }
      const guarded = redactingFetch(
        async () => streamedResponse(chunks, "text/event-stream"),
        SECRET,
      );
      const response = await guarded("http://127.0.0.1/v1/chat/completions", { method: "POST" });
      const text = await response.text();
      expect(text).not.toContain(SECRET);
      expect(text).toContain("[redacted]");
      expect(text.startsWith("data: ")).toBe(true);
      expect(text.endsWith("data: [DONE]\n\n")).toBe(true);
    });
  }

  it("金鑰橫跨兩個 chunk 的邊界時換掉", async () => {
    const split = payload.indexOf(SECRET) + Math.floor(SECRET.length / 2);
    const guarded = redactingFetch(
      async () =>
        streamedResponse(
          [bytesOf(payload.slice(0, split)), bytesOf(payload.slice(split))],
          "text/event-stream",
        ),
      SECRET,
    );
    const response = await guarded("http://127.0.0.1/v1/chat/completions", { method: "POST" });
    const text = await response.text();
    expect(text).not.toContain(SECRET);
    expect(text).toContain("[redacted]");
  });

  it("中文字橫跨兩個 chunk 時輸出不壞掉", async () => {
    const content = 'data: {"choices":[{"delta":{"content":"串流內容好"}}]}\n\ndata: [DONE]\n\n';
    const bytes = bytesOf(content);
    // 切在「串」（e4 b8 b2）的第一個位元組後面，斷在多位元組字元中間。
    const charStart = bytes.findIndex((byte, index) => byte === 0xe4 && bytes[index + 1] === 0xb8);
    const cut = Math.max(1, Math.min(charStart + 1, bytes.length - 1));
    const guarded = redactingFetch(
      async () =>
        streamedResponse([bytes.subarray(0, cut), bytes.subarray(cut)], "text/event-stream"),
      SECRET,
    );
    const response = await guarded("http://127.0.0.1/v1/chat/completions", { method: "POST" });
    expect(await response.text()).toBe(content);
  });

  it("包住串流的 transform 在 flush 時才送出尾巴，金鑰沒有跨 chunk 殘留", async () => {
    const secretBytes = bytesOf(`before ${SECRET} after`);
    const middle = Math.floor(secretBytes.length / 2);
    const first = new TextDecoder().decode(secretBytes.subarray(0, middle));
    const second = new TextDecoder().decode(secretBytes.subarray(middle));
    const input = new ReadableStream<string>({
      start(controller) {
        controller.enqueue(first);
        controller.enqueue(second);
        controller.close();
      },
    });
    const output = await new Response(
      input.pipeThrough(redactingTransformStream(SECRET)).pipeThrough(new TextEncoderStream()),
    ).text();
    expect(output).toBe(`before ${REDACTED} after`);
  });

  it("沒有金鑰時，串流內容一個字都不改", async () => {
    const content =
      'data: {"choices":[{"delta":{"content":"no secrets here"}}]}\n\ndata: [DONE]\n\n';
    const guarded = redactingFetch(
      async () => streamedResponse([bytesOf(content)], "text/event-stream"),
      SECRET,
    );
    const response = await guarded("http://127.0.0.1/v1/chat/completions", { method: "POST" });
    expect(await response.text()).toBe(content);
  });

  it("空金鑰的串流一個字都不改", async () => {
    const content = "no keys here at all";
    const input = new ReadableStream<string>({
      start(controller) {
        controller.enqueue(content);
        controller.close();
      },
    });
    const output = await new Response(
      input.pipeThrough(redactingTransformStream("")).pipeThrough(new TextEncoderStream()),
    ).text();
    expect(output).toBe(content);
  });

  it("200 的 JSON body 也清洗", async () => {
    const body = `{"error":{"message":"Incorrect API key provided: ${SECRET}"}}`;
    const guarded = redactingFetch(
      async () => streamedResponse([bytesOf(body)], "application/json"),
      SECRET,
    );
    const response = await guarded("http://127.0.0.1/v1/chat/completions", { method: "POST" });
    const text = await response.text();
    expect(text).not.toContain(SECRET);
    expect(text).toContain("[redacted]");
  });

  it("200 的非文字 content-type body 也清洗（其實是文字的 octet-stream）", async () => {
    const body = `{"error":{"message":"Incorrect API key provided: ${SECRET}"}}`;
    const encoded = bytesOf(body);
    const guarded = redactingFetch(
      async () =>
        new Response(encoded, {
          status: 200,
          headers: {
            "content-type": "application/octet-stream",
            "content-length": String(encoded.length),
          },
        }),
      SECRET,
    );
    const response = await guarded("http://127.0.0.1/v1/chat/completions", { method: "POST" });
    const text = await response.text();
    expect(text).not.toContain(SECRET);
    expect(text).toContain("[redacted]");
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    // body 改寫過，長度欄位一定要拿掉。
    expect(response.headers.get("content-length")).toBeNull();
  });

  it("200 的非文字 content-type body（無效 UTF-8）也換掉逐位元組相同的金鑰", async () => {
    const prefix = new Uint8Array([0xff, 0xfe, 0x00, 0x81]);
    const sse = `data: {"error":{"message":"Incorrect API key provided: ${SECRET}"}}\n\n`;
    const bytes = new Uint8Array([...prefix, ...bytesOf(sse)]);
    const guarded = redactingFetch(
      async () => streamedResponse([bytes], "application/octet-stream"),
      SECRET,
    );
    const response = await guarded("http://127.0.0.1/v1/chat/completions", { method: "POST" });
    const raw = new Uint8Array(await response.arrayBuffer());
    // 二進位前綴原樣保留，金鑰的位置換成固定文字。
    expect([...raw.subarray(0, prefix.length)]).toEqual([...prefix]);
    const asText = new TextDecoder().decode(raw);
    expect(asText).not.toContain(SECRET);
    expect(asText).toContain("[redacted]");
  });

  it("200 的非文字 content-type body 沒有金鑰時，內容一個位元組都不改", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
    const guarded = redactingFetch(
      async () => streamedResponse([bytes], "application/octet-stream"),
      SECRET,
    );
    const response = await guarded("http://127.0.0.1/v1/chat/completions", { method: "POST" });
    const raw = new Uint8Array(await response.arrayBuffer());
    expect([...raw]).toEqual([...bytes]);
  });
});

describe("供應商錯誤回應的清洗", () => {
  it("401 的 body 與 headers 在交回 pi-ai 前就換掉，成功回應內容不變", async () => {
    const body = JSON.stringify({
      error: { message: `Incorrect API key provided: ${SECRET} (Bearer ${SECRET})` },
    });
    const guarded = redactingFetch(async () => {
      return new Response(body, {
        status: 401,
        headers: {
          "content-type": "application/json",
          "x-echo-authorization": `Bearer ${SECRET}`,
        },
      });
    }, SECRET);
    const response = await guarded("http://127.0.0.1/v1/chat/completions", { method: "POST" });
    expect(response.status).toBe(401);
    const text = await response.text();
    expect(text).not.toContain(SECRET);
    expect(text).toContain("[redacted]");
    expect(response.headers.get("x-echo-authorization")).not.toContain(SECRET);
    expect(response.headers.get("content-length")).toBeNull();

    const ok = redactingFetch(async () => new Response("串流內容", { status: 200 }), SECRET);
    const okay = await ok("http://127.0.0.1/v1/chat/completions", { method: "POST" });
    expect(await okay.text()).toBe("串流內容");
  });

  it("失敗的 fetch 本身也清洗：丟出的錯誤訊息不含金鑰", async () => {
    const guarded = redactingFetch(async () => {
      throw new TypeError(`fetch failed: ${SECRET}`);
    }, SECRET);
    const error = await guarded("http://127.0.0.1/v1/chat/completions", {}).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(SECRET);
  });

  it("供應商的 Retry-After 轉成毫秒欄位，跟著錯誤原文走", async () => {
    const guarded = redactingFetch(async () => {
      return new Response(JSON.stringify({ error: { message: "rate limit reached" } }), {
        status: 429,
        headers: { "retry-after": "3", "content-type": "application/json" },
      });
    }, SECRET);
    const response = await guarded("http://127.0.0.1/v1/chat/completions", {});
    const text = await response.text();
    expect(retryAfterMsFrom(text)).toBe(3_000);
    expect(response.status).toBe(429);
  });

  it("沒有 Retry-After 的錯誤不會多出等待時間欄位", async () => {
    const guarded = redactingFetch(async () => {
      return new Response("boom", { status: 500 });
    }, SECRET);
    const response = await guarded("http://127.0.0.1/v1/chat/completions", {});
    expect(retryAfterMsFrom(await response.text())).toBeUndefined();
  });
});
