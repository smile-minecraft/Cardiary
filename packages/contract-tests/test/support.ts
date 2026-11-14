import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { WebSocket } from "ws";

const HOST_ENTRY = new URL("../../host/dist/main.js", import.meta.url).pathname;
const SCHEMA_PATH = new URL("../../protocol/schema/protocol.schema.json", import.meta.url);

let schemaValidator: ((data: unknown) => boolean) | null = null;
let schemaErrors: (() => string) | null = null;

/** 用正式 schema 驗每一則收到的 frame；契約測試不匯入閘道內部模組。 */
async function validateFrame(frame: unknown): Promise<void> {
  if (!schemaValidator) {
    const schema = JSON.parse(await readFile(SCHEMA_PATH, "utf8")) as object;
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    const validator = ajv.compile(schema);
    schemaValidator = (data: unknown) => validator(data);
    schemaErrors = () => JSON.stringify(validator.errors);
  }
  if (!schemaValidator(frame)) {
    throw new Error(`frame 不符合協定 schema：${schemaErrors?.()}\n${JSON.stringify(frame)}`);
  }
}

export interface TestFolder {
  readonly path: string;
  readonly folderId: string;
}

export async function makeFolder(): Promise<TestFolder> {
  const path = await mkdtemp(join(tmpdir(), "cardiary-contract-"));
  await mkdir(join(path, "state"), { recursive: true });
  await mkdir(join(path, "tmp"), { recursive: true });
  const folderId = `contract_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await writeFile(
    join(path, "state", "folder.json"),
    JSON.stringify({ format: 1, folderId, createdAt: new Date().toISOString(), createdBy: "test" }),
  );
  return { path, folderId };
}

export interface ReadyFrame {
  readonly type: "ready";
  readonly protocol: number;
  readonly pid: number;
  readonly clientPort: number;
  readonly folderId: string;
  readonly epoch: string;
  readonly clientToken?: string;
}

export interface ServiceOptions {
  readonly scripts?: readonly (readonly Record<string, unknown>[])[];
  readonly demo?: boolean;
  /** 控制模式：沒有 --folder，走 init／ready 與 NDJSON。 */
  readonly control?: boolean;
  readonly clientToken?: string;
  readonly controlToken?: string;
  readonly brokerToken?: string;
}

export interface SpawnedService {
  readonly folder: TestFolder;
  readonly ready: ReadyFrame;
  readonly clientToken: string;
  readonly controlToken: string;
  readonly brokerToken: string;
  readonly stderr: () => string;
  readonly stdoutLines: () => readonly string[];
  /** 控制模式：送一則控制請求並等回應。 */
  controlRequest(
    route: string,
    payload?: Record<string, unknown>,
    token?: string,
  ): Promise<Record<string, unknown>>;
  /** 控制模式：送一則原始 frame（測試壞 frame）。 */
  controlRaw(line: string): void;
  /** 控制模式：自訂 broker 回應。 */
  setBrokerHandler(
    handler: (route: string, payload: Record<string, unknown>) => Record<string, unknown> | null,
  ): void;
  stop(): Promise<void>;
}

/** 啟動一個獨立執行的主機服務（控制面或獨立模式），回傳埠與 Token。 */
export async function spawnService(options: ServiceOptions = {}): Promise<SpawnedService> {
  const folder = await makeFolder();
  const args = [HOST_ENTRY];
  const clientToken = options.clientToken ?? "C".repeat(43);
  const controlToken = options.controlToken ?? "T".repeat(43);
  const brokerToken = options.brokerToken ?? "B".repeat(43);
  let scriptPath: string | null = null;
  if (options.scripts) {
    scriptPath = join(folder.path, "script.json");
    await writeFile(scriptPath, JSON.stringify(options.scripts));
  }
  if (!options.control) {
    args.push("--folder", folder.path);
  }
  if (options.demo) args.push("--demo");
  if (scriptPath) args.push("--script", scriptPath);
  const child = spawn(process.execPath, args, {
    env: {
      ...process.env,
      TMPDIR: join(folder.path, "tmp"),
      TMP: join(folder.path, "tmp"),
      TEMP: join(folder.path, "tmp"),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdoutLines: string[] = [];
  let stderrText = "";
  const responses = new Map<string, (frame: Record<string, unknown>) => void>();
  let brokerHandler:
    ((route: string, payload: Record<string, unknown>) => Record<string, unknown> | null) | null =
    null;
  const pendingBroker = new Map<string, (frame: Record<string, unknown>) => void>();

  const send = (frame: Record<string, unknown>): void => {
    child.stdin?.write(`${JSON.stringify(frame)}\n`);
  };

  const onLine = (line: string): void => {
    stdoutLines.push(line);
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(line) as Record<string, unknown>;
    } catch {
      throw new Error(`stdout 出現非 JSON 內容：${line}`);
    }
    if (frame.kind === "hello") {
      send({
        v: 1,
        kind: "hello-ack",
        role: "shell",
        auth: { token: controlToken },
      });
      return;
    }
    if (frame.kind === "request" && typeof frame.route === "string") {
      const reply = brokerHandler?.(frame.route, (frame.payload as Record<string, unknown>) ?? {});
      if (reply !== null && reply !== undefined) {
        send({
          v: 1,
          kind: "response",
          id: `resp_${String(frame.id)}`,
          replyTo: frame.id,
          auth: { token: controlToken },
          ok: true,
          payload: reply,
        });
      }
      return;
    }
    if (frame.kind === "response" && typeof frame.replyTo === "string") {
      const resolvePending = pendingBroker.get(frame.replyTo) ?? responses.get(frame.replyTo);
      if (resolvePending) {
        pendingBroker.delete(frame.replyTo);
        responses.delete(frame.replyTo);
        resolvePending(frame);
      }
    }
  };

  if (options.control) {
    child.stdin?.write(
      `${JSON.stringify({
        type: "init",
        protocol: 1,
        token: controlToken,
        brokerToken,
        folder: { path: folder.path },
        clientToken,
      })}\n`,
    );
  }

  const lines = createInterface({ input: child.stdout });
  let resolveReady: ((frame: ReadyFrame) => void) | null = null;
  let rejectReady: ((error: Error) => void) | null = null;
  const readyPromise = new Promise<ReadyFrame>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  lines.on("line", (line) => {
    try {
      const frame = JSON.parse(line) as Record<string, unknown>;
      if (frame.type === "ready" && resolveReady) {
        resolveReady(frame as unknown as ReadyFrame);
        resolveReady = null;
        rejectReady = null;
        return;
      }
    } catch {
      rejectReady?.(new Error(`stdout 出現非 JSON 內容：${line}`));
      return;
    }
    onLine(line);
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrText += chunk;
  });
  const timer = setTimeout(() => rejectReady?.(new Error("等不到 ready")), 10_000);
  timer.unref?.();
  const ready = await readyPromise;
  clearTimeout(timer);

  const effectiveClientToken = ready.clientToken ?? clientToken;
  return {
    folder,
    ready,
    clientToken: effectiveClientToken,
    controlToken,
    brokerToken,
    stderr: () => stderrText,
    stdoutLines: () => stdoutLines,
    setBrokerHandler(handler) {
      brokerHandler = handler;
    },
    controlRaw(line) {
      child.stdin?.write(`${line}\n`);
    },
    async controlRequest(route, payload = {}, token = controlToken) {
      const id = `ctl_${Math.random().toString(36).slice(2, 10)}`;
      const promise = new Promise<Record<string, unknown>>((resolve) => {
        responses.set(id, resolve);
      });
      send({ v: 1, kind: "request", id, route, auth: { token }, payload });
      return promise;
    },
    async stop() {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await waitForExit(child, 5000);
      lines.close();
    },
  };
}

function waitForExit(child: ChildProcess, ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, ms);
    timer.unref?.();
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export interface ProtocolClient {
  readonly frames: Array<Record<string, unknown>>;
  request(type: string, payload?: Record<string, unknown>, id?: string): string;
  send(frame: Record<string, unknown>): void;
  hello(token: string | null, protocol?: { min: number; max: number }): Promise<string>;
  waitFor<T extends Record<string, unknown>>(
    predicate: (frame: Record<string, unknown>) => boolean,
    ms?: number,
  ): Promise<T>;
  waitForReply(replyTo: string, ms?: number): Promise<Record<string, unknown>>;
  waitForEvent(type: string, ms?: number): Promise<Record<string, unknown>>;
  readonly closed: boolean;
  close(): Promise<void>;
}

/** 契約測試客戶端：每一則收到的 frame 都用正式 schema 驗過。 */
export async function connect(url: string): Promise<ProtocolClient> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const frames: Array<Record<string, unknown>> = [];
  const waiters: Array<() => void> = [];
  let counter = 0;
  let closed = false;
  ws.on("message", (data) => {
    const frame = JSON.parse(data.toString()) as Record<string, unknown>;
    void validateFrame(frame).then(() => {
      frames.push(frame);
      for (const waiter of waiters.splice(0)) waiter();
    });
  });
  ws.on("close", () => {
    closed = true;
    for (const waiter of waiters.splice(0)) waiter();
  });
  const client: ProtocolClient = {
    frames,
    request(type, payload = {}, id) {
      const requestId = id ?? `req_${++counter}`;
      ws.send(JSON.stringify({ v: 1, kind: "request", id: requestId, type, payload }));
      return requestId;
    },
    send(frame) {
      ws.send(JSON.stringify(frame));
    },
    async hello(token, protocol = { min: 1, max: 1 }) {
      return client.request("system.hello", {
        protocol,
        client: { name: "contract", version: "0", platform: "other", instanceId: "contract-1" },
        ...(token === null ? {} : { auth: { token } }),
      });
    },
    async waitFor(predicate, ms = 4000) {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const found = frames.find(predicate);
        if (found) return found as never;
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
          setTimeout(resolve, 20).unref?.();
        });
      }
      throw new Error(
        `等待 frame 逾時；已收到：${frames.map((frame) => String(frame.type ?? frame.kind)).join(",")}`,
      );
    },
    waitForReply(replyTo, ms) {
      return client.waitFor((frame) => frame.replyTo === replyTo, ms);
    },
    waitForEvent(type, ms) {
      return client.waitFor((frame) => frame.kind === "event" && frame.type === type, ms);
    },
    get closed() {
      return closed;
    },
    async close() {
      if (closed) return;
      await new Promise<void>((resolve) => {
        ws.once("close", () => resolve());
        ws.close();
      });
    },
  };
  return client;
}

export async function connectAndHello(
  service: SpawnedService,
  token = service.clientToken,
): Promise<ProtocolClient> {
  const client = await connect(`ws://127.0.0.1:${service.ready.clientPort}/v1/ws`);
  const requestId = await client.hello(token);
  const reply = await client.waitForReply(requestId);
  if (reply.kind === "error") {
    throw new Error(`hello 失敗：${String(reply.code)}`);
  }
  return client;
}

export async function waitUntil(check: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("條件等待逾時");
}
