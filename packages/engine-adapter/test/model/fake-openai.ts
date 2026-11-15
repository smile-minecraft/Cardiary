import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * 最小的 OpenAI 相容端點。
 *
 * 只處理 `POST /v1/chat/completions` 與 `GET /v1/models`；測試用它觀察
 * 實際送出的請求（模型、授權標頭）並回固定內容，不連外網。
 */

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: Record<string, unknown>;
}

export type ChatBehavior =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "status";
      readonly status: number;
      readonly body: string;
      /** 錯誤回應要附帶的 header；測試用它模擬代理回顯請求內容。 */
      readonly headers?: Readonly<Record<string, string>>;
    }
  | {
      /**
       * 原樣寫出 `text/event-stream` 的內容，測試用它模擬 200 串流中途
       * 送來的 error 事件（可以把金鑰切在兩個 chunk 裡）。
       */
      readonly kind: "stream-raw";
      readonly chunks: readonly string[];
    }
  | { readonly kind: "hang" };

export interface FakeOpenAIOptions {
  readonly chat: (request: RecordedRequest) => ChatBehavior;
  readonly models?: readonly Record<string, unknown>[];
}

export interface FakeOpenAI {
  readonly baseUrl: string;
  readonly requests: readonly RecordedRequest[];
  close(): Promise<void>;
}

export async function startFakeOpenAI(options: FakeOpenAIOptions): Promise<FakeOpenAI> {
  const requests: RecordedRequest[] = [];
  const server = createServer((request, response) => {
    void handle(request, response);
  });
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readBody(request);
    const recorded: RecordedRequest = {
      method: request.method ?? "",
      path: request.url ?? "",
      headers: request.headers as Record<string, string | undefined>,
      body,
    };
    requests.push(recorded);
    if (request.method === "GET" && request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ object: "list", data: options.models ?? [] }));
      return;
    }
    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      const behavior = options.chat(recorded);
      if (behavior.kind === "status") {
        response.writeHead(behavior.status, {
          "content-type": "application/json",
          ...behavior.headers,
        });
        response.end(behavior.body);
        return;
      }
      if (behavior.kind === "hang") {
        // 不回應也不關閉；呼叫端要靠取消或逾時結束。
        return;
      }
      if (behavior.kind === "stream-raw") {
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        });
        for (const chunk of behavior.chunks) {
          response.write(chunk);
        }
        response.end();
        return;
      }
      streamText(response, modelOf(recorded.body), behavior.text);
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "not found" } }));
  }
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function modelOf(body: Record<string, unknown>): string {
  return typeof body.model === "string" ? body.model : "fake-model";
}

function streamText(response: ServerResponse, model: string, text: string): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const base = {
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    created: 0,
    model,
  };
  const chunk = (delta: Record<string, unknown>, finishReason: string | null): string =>
    `data: ${JSON.stringify({
      ...base,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    })}\n\n`;
  response.write(chunk({ role: "assistant", content: "" }, null));
  // 逐字送出，讓引擎看到真正的串流增量。
  for (const character of [...text]) {
    response.write(chunk({ content: character }, null));
  }
  response.write(
    `data: ${JSON.stringify({
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 8, completion_tokens: text.length, total_tokens: 8 + text.length },
    })}\n\n`,
  );
  response.end("data: [DONE]\n\n");
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}
