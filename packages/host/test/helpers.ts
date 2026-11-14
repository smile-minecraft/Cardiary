import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

import { startHost, type RunningHost, type StartHostOptions } from "../src/index.js";

export interface TestFolder {
  readonly path: string;
  readonly folderId: string;
}

let counter = 0;

export async function makeFolder(folderId?: string): Promise<TestFolder> {
  const path = await mkdtemp(join(tmpdir(), "cardiary-host-"));
  await mkdir(join(path, "state"), { recursive: true });
  await mkdir(join(path, "tmp"), { recursive: true });
  counter += 1;
  const id = folderId ?? `folder_${counter}_${Date.now().toString(36)}`;
  await writeFile(
    join(path, "state", "folder.json"),
    JSON.stringify({
      format: 1,
      folderId: id,
      createdAt: new Date().toISOString(),
      createdBy: "test",
    }),
  );
  return { path, folderId: id };
}

export interface TestHost {
  readonly host: RunningHost;
  readonly folder: TestFolder;
  readonly token: string;
  readonly url: string;
  close(): Promise<void>;
}

export async function startTestHost(
  options?: Partial<StartHostOptions> & { readonly folder?: TestFolder },
): Promise<TestHost> {
  const { folder: providedFolder, ...rest } = options ?? {};
  const folder = providedFolder ?? (await makeFolder());
  const token = "A".repeat(43);
  const host = await startHost({
    demo: true,
    ...rest,
    folderPath: folder.path,
    clientToken: token,
  });
  return {
    host,
    folder,
    token,
    url: `ws://127.0.0.1:${host.port}/v1/ws`,
    close: async () => {
      await host.service.shutdown("test").catch(() => undefined);
    },
  };
}

type Frame = {
  readonly kind: string;
  readonly type?: string;
  readonly replyTo?: string;
  readonly code?: string;
  readonly payload?: Record<string, unknown>;
  readonly [key: string]: unknown;
};

/** 最小 WebSocket 測試客戶端：送出請求、等回應或事件。 */
export class TestClient {
  readonly frames: Frame[] = [];
  readonly #ws: WebSocket;
  #counter = 0;
  closeCode: number | null = null;
  closeReason = "";

  private constructor(ws: WebSocket) {
    this.#ws = ws;
    ws.on("message", (data) => {
      this.frames.push(JSON.parse(data.toString()) as Frame);
    });
    ws.on("close", (code, reason) => {
      this.closeCode = code;
      this.closeReason = reason.toString();
    });
  }

  static async connect(url: string): Promise<TestClient> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    return new TestClient(ws);
  }

  send(frame: Record<string, unknown>): void {
    this.#ws.send(JSON.stringify(frame));
  }

  request(type: string, payload: Record<string, unknown> = {}, id?: string): string {
    const requestId = id ?? `req_${++this.#counter}`;
    this.send({ v: 1, kind: "request", id: requestId, type, payload });
    return requestId;
  }

  async hello(token: string | null, protocol = { min: 1, max: 1 }): Promise<string> {
    const requestId = this.request("system.hello", {
      protocol,
      client: { name: "test", version: "0", platform: "other", instanceId: "test-1" },
      ...(token === null ? {} : { auth: { token } }),
    });
    return requestId;
  }

  async waitFor<T extends Frame>(predicate: (frame: Frame) => boolean, ms = 3000): Promise<T> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const found = this.frames.find(predicate);
      if (found) return found as T;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(
      `等待 frame 逾時：${this.frames.map((frame) => frame.type ?? frame.kind).join(",")}`,
    );
  }

  async waitForReply(replyTo: string, ms = 3000): Promise<Frame> {
    return this.waitFor((frame) => frame.replyTo === replyTo, ms);
  }

  async waitForEvent(type: string, ms = 3000): Promise<Frame> {
    return this.waitFor((frame) => frame.kind === "event" && frame.type === type, ms);
  }

  get closed(): boolean {
    return this.#ws.readyState === WebSocket.CLOSED || this.#ws.readyState === WebSocket.CLOSING;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    await new Promise<void>((resolve) => {
      this.#ws.once("close", () => resolve());
      this.#ws.close();
    });
  }
}

export async function waitUntil(check: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("條件等待逾時");
}
