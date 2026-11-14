import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { createRequire } from "node:module";
import { WebSocket } from "ws";

const HOST_ENTRY = new URL("../../host/dist/main.js", import.meta.url).pathname;
const SCHEMA_PATH = new URL("../../protocol/schema/protocol.schema.json", import.meta.url);

let schemaValidator: ((data: unknown) => boolean) | null = null;
let schemaErrors: (() => string) | null = null;

/** 用正式 schema 驗每一則收到的 frame；契約測試不匯入閘道內部模組。 */
async function validateFrame(frame: unknown): Promise<void> {
  if (!schemaValidator) {
    const schema = JSON.parse(await readFile(SCHEMA_PATH, "utf8")) as object;
    // Ajv 的 CJS 型別在 NodeNext 下無法直接 default import；測試只需要最小介面。
    const require = createRequire(import.meta.url);
    const Ajv2020 = require("ajv/dist/2020.js") as new (options?: object) => {
      compile(schema: object): ((data: unknown) => boolean) & { errors?: unknown };
    };
    const addFormats = require("ajv-formats") as (ajv: unknown) => void;
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

export async function makeFolder(requestedFolderId?: string): Promise<TestFolder> {
  const path = await mkdtemp(join(tmpdir(), "cardiary-contract-"));
  await mkdir(join(path, "state"), { recursive: true });
  await mkdir(join(path, "tmp"), { recursive: true });
  const folderId =
    requestedFolderId ??
    `contract_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
  /** 控制模式：故意不回 hello-ack，用來驗證服務會退出。 */
  readonly skipHelloAck?: boolean;
  /** 控制模式：改寫 init 的內容（測試 init 失敗）。 */
  readonly initOverride?: Record<string, unknown>;
  /** 測試故障注入：啟動 N 毫秒後關閉事件日誌。 */
  readonly faultCloseEventLogMs?: number;
  /** 測試故障注入：讓第一個 request_dedupe complete 不寫入。 */
  readonly faultSkipDedupeComplete?: boolean;
  /** 測試故障注入：啟動 N 毫秒後關閉執行期狀態庫。 */
  readonly faultCloseRuntimeMs?: number;
}

export interface SpawnedService {
  readonly folder: TestFolder;
  readonly ready: ReadyFrame;
  readonly clientToken: string;
  readonly controlToken: string;
  readonly brokerToken: string;
  readonly stderr: () => string;
  readonly stdoutLines: () => readonly string[];
  /** 控制模式收到的通知（notify.*）。 */
  readonly notifications: () => readonly Record<string, unknown>[];
  /** 服務行程結束時 resolve；測試 init／hello 失敗要退出。 */
  readonly exited: Promise<number | null>;
  /** 控制模式：送一則控制請求並等回應。 */
  controlRequest(
    route: string,
    payload?: Record<string, unknown>,
    token?: string,
    timeoutMs?: number,
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
  if (options.faultCloseEventLogMs !== undefined) {
    args.push("--fault-close-event-log", String(options.faultCloseEventLogMs));
  }
  if (options.faultSkipDedupeComplete === true) {
    args.push("--fault-skip-dedupe-complete");
  }
  if (options.faultCloseRuntimeMs !== undefined) {
    args.push("--fault-close-runtime", String(options.faultCloseRuntimeMs));
  }
  const child = spawn(process.execPath, args, {
    env: {
      ...process.env,
      TMPDIR: join(folder.path, "tmp"),
      TMP: join(folder.path, "tmp"),
      TEMP: join(folder.path, "tmp"),
      CARDIARY_TEST_FAULTS: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdoutLines: string[] = [];
  const notifications: Array<Record<string, unknown>> = [];
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
    if (frame.kind === "notification") {
      notifications.push(frame);
      return;
    }
    if (frame.kind === "hello") {
      if (options.skipHelloAck !== true) {
        send({
          v: 1,
          kind: "hello-ack",
          role: "shell",
          auth: { token: controlToken },
        });
      }
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
    const initFrame = options.initOverride ?? {
      type: "init",
      protocol: 1,
      token: controlToken,
      brokerToken,
      folder: { path: folder.path },
      clientToken,
    };
    child.stdin?.write(`${JSON.stringify(initFrame)}\n`);
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
  const exited = new Promise<number | null>((resolve) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
      return;
    }
    child.once("exit", (code) => resolve(code));
  });
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
    notifications: () => notifications,
    exited,
    setBrokerHandler(handler) {
      brokerHandler = handler;
    },
    controlRaw(line) {
      child.stdin?.write(`${line}\n`);
    },
    async controlRequest(route, payload = {}, token = controlToken, timeoutMs = 10_000) {
      const id = `ctl_${Math.random().toString(36).slice(2, 10)}`;
      const promise = new Promise<Record<string, unknown>>((resolve) => {
        responses.set(id, resolve);
      });
      send({ v: 1, kind: "request", id, route, auth: { token }, payload });
      if (timeoutMs <= 0) return promise;
      const timeout = new Promise<Record<string, unknown>>((resolve) => {
        const timer = setTimeout(() => resolve({ __timeout: true }), timeoutMs);
        timer.unref?.();
      });
      return Promise.race([promise, timeout]);
    },
    async stop() {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await waitForExit(child, 5000);
      lines.close();
    },
  };
}

/** 帶故障注入旗標但不給測試環境變數：正式入口應該拒絕。 */
export async function spawnFaultFlagWithoutEnv(): Promise<{
  readonly code: number | null;
  readonly stderr: string;
}> {
  const folder = await makeFolder();
  const child = spawn(
    process.execPath,
    [HOST_ENTRY, "--folder", folder.path, "--fault-close-event-log", "100"],
    {
      env: {
        ...process.env,
        TMPDIR: join(folder.path, "tmp"),
        TMP: join(folder.path, "tmp"),
        TEMP: join(folder.path, "tmp"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const code = await Promise.race([
    new Promise<number | null>((resolve) => child.once("exit", (value) => resolve(value))),
    new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve(-1);
      }, 5000);
      timer.unref?.();
    }),
  ]);
  return { code, stderr };
}

/** 用故意錯誤的 init 啟動控制模式，回傳退出碼與 stderr（測試 init 失敗要退出）。 */
export async function spawnExpectInitFailure(): Promise<{
  readonly code: number | null;
  readonly stderr: string;
}> {
  const folder = await makeFolder();
  const child = spawn(process.execPath, [HOST_ENTRY], {
    env: {
      ...process.env,
      TMPDIR: join(folder.path, "tmp"),
      TMP: join(folder.path, "tmp"),
      TEMP: join(folder.path, "tmp"),
      CARDIARY_TEST_FAULTS: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdin?.write(
    `${JSON.stringify({
      type: "init",
      protocol: 2,
      token: "T".repeat(43),
      brokerToken: "B".repeat(43),
      folder: { path: folder.path },
    })}\n`,
  );
  const code = await Promise.race([
    new Promise<number | null>((resolve) => child.once("exit", (value) => resolve(value))),
    new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve(-1);
      }, 5000);
      timer.unref?.();
    }),
  ]);
  return { code, stderr };
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
  readonly closeCode: number | null;
  readonly closeReason: string;
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
  let closeCode: number | null = null;
  let closeReason = "";
  ws.on("message", (data) => {
    const frame = JSON.parse(data.toString()) as Record<string, unknown>;
    void validateFrame(frame).then(() => {
      frames.push(frame);
      for (const waiter of waiters.splice(0)) waiter();
    });
  });
  ws.on("close", (code, reason) => {
    closed = true;
    closeCode = code;
    closeReason = reason.toString();
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
    get closeCode() {
      return closeCode;
    },
    get closeReason() {
      return closeReason;
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
