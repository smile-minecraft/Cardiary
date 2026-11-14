import { PassThrough, type Readable } from "node:stream";
import { isAbsolute, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { JSONObject } from "@cardiary/protocol";
import { createScriptedModels, scriptedModelSettings } from "@cardiary/engine-adapter";
import type {
  EngineModelSource,
  ModelSettings,
  ProviderCredentialSource,
} from "@cardiary/engine-adapter";
import type { CredentialRef, ProviderCredential } from "@cardiary/engine-adapter";

import { startHost, UnavailableCredentials, type RunningHost } from "./bootstrap.js";
import type { FolderInfo } from "./control/broker.js";
import { BrokerClient, BrokerCredentialSource } from "./control/broker.js";
import { ControlChannel } from "./control/channel.js";
import { CONTROL_PROTOCOL } from "./control/frames.js";
import type { ProtocolSink } from "./control/stdoutGuard.js";
import type { FakeModelStep } from "@cardiary/engine-fake";
import { StderrLogger } from "./logging.js";
import { generateToken, isValidToken } from "./tokens.js";
import { PROTOCOL_VERSION } from "./version.js";

export interface ReadyFrame {
  readonly type: "ready";
  readonly protocol: 1;
  readonly pid: number;
  readonly clientPort: number;
  readonly folderId: string;
  readonly epoch: string;
  /**
   * 本機 client Token。
   *
   * 設計文件把簽發者放在殼；控制面的 `init` 沒有這個欄位。服務接受
   * `init.clientToken`（選用），沒帶時自己產生並放在 `ready` 給殼轉交。
   */
  readonly clientToken?: string;
}

export interface InitFrame {
  readonly type: "init";
  readonly protocol: number;
  readonly token: string;
  readonly brokerToken: string;
  readonly folder: { readonly path: string };
  readonly limits?: { readonly maxFrameBytes?: number; readonly healthIntervalMs?: number };
  readonly clientToken?: string;
}

interface ParsedArgs {
  readonly folder?: string;
  readonly port?: number;
  readonly demo: boolean;
  readonly script?: string;
  readonly control: boolean;
  readonly engine: "pi" | "fake";
  readonly initializeFolder: boolean;
  readonly faultCloseEventLogMs?: number;
  readonly faultCloseRuntimeMs?: number;
  readonly faultSkipDedupeComplete: boolean;
}

class InitError extends Error {
  readonly reason: string;

  constructor(reason: string, message: string) {
    super(message);
    this.name = "InitError";
    this.reason = reason;
  }
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  let folder: string | undefined;
  let port: number | undefined;
  let demo = false;
  let script: string | undefined;
  let control = false;
  let engine: "pi" | "fake" = "pi";
  let initializeFolder = false;
  let faultCloseEventLogMs: number | undefined;
  let faultCloseRuntimeMs: number | undefined;
  let faultSkipDedupeComplete = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--engine": {
        const value = argv[index + 1];
        engine = value === "fake" ? "fake" : "pi";
        index += 1;
        break;
      }
      case "--folder": {
        folder = argv[index + 1];
        index += 1;
        break;
      }
      case "--port": {
        const value = argv[index + 1];
        port = value === undefined ? undefined : Number.parseInt(value, 10);
        index += 1;
        break;
      }
      case "--demo":
        demo = true;
        break;
      case "--initialize-folder":
        initializeFolder = true;
        break;
      case "--script": {
        script = argv[index + 1];
        index += 1;
        break;
      }
      case "--control":
        control = true;
        break;
      case "--fault-close-event-log": {
        const value = argv[index + 1];
        faultCloseEventLogMs = value === undefined ? undefined : Number.parseInt(value, 10);
        index += 1;
        break;
      }
      case "--fault-close-runtime": {
        const value = argv[index + 1];
        faultCloseRuntimeMs = value === undefined ? undefined : Number.parseInt(value, 10);
        index += 1;
        break;
      }
      case "--fault-skip-dedupe-complete":
        faultSkipDedupeComplete = true;
        break;
      default:
        break;
    }
  }
  return {
    ...(folder === undefined ? {} : { folder }),
    ...(port === undefined ? {} : { port }),
    demo,
    ...(script === undefined ? {} : { script }),
    control,
    engine,
    initializeFolder,
    ...(faultCloseEventLogMs === undefined ? {} : { faultCloseEventLogMs }),
    ...(faultCloseRuntimeMs === undefined ? {} : { faultCloseRuntimeMs }),
    faultSkipDedupeComplete,
  };
}

function insideTmp(folderPath: string): boolean {
  const target = resolve(folderPath, "tmp");
  const current = resolve(tmpdir());
  const rel = relative(target, current);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function loadScripts(
  path: string | undefined,
): Promise<readonly (readonly FakeModelStep[])[]> {
  if (!path) return [];
  const { readFile } = await import("node:fs/promises");
  const raw = await readFile(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new InitError("script_invalid", "腳本必須是陣列");
  return parsed as FakeModelStep[][];
}

/**
 * 控制面的金鑰來源：通道建立前一律回報不可用，建立後改問殼。
 *
 * 轉接層只會在真的要呼叫模型時取值，所以這裡可以晚一步接到 broker。
 */
class LazyBrokerCredentials implements ProviderCredentialSource {
  #source: ProviderCredentialSource | null = null;

  use(source: ProviderCredentialSource): void {
    this.#source = source;
  }

  async resolve(ref: CredentialRef): Promise<ProviderCredential> {
    if (this.#source === null) {
      throw Object.assign(new Error("控制面尚未建立，沒有金鑰來源"), {
        code: "model-unavailable",
      });
    }
    return this.#source.resolve(ref);
  }
}

/**
 * 依 `--engine` 決定組裝；Pi Durable 需要模型來源，測試用腳本化的模型
 * 把 `--script` 的每一步轉成一則固定回應。
 */
function assemblyFor(
  args: ParsedArgs,
  scripts: readonly (readonly FakeModelStep[])[],
  credentials: ProviderCredentialSource,
): {
  readonly assembly: "pi" | "fake";
  readonly credentials: ProviderCredentialSource;
  readonly models?: EngineModelSource;
  readonly modelSettings?: ModelSettings;
} {
  if (args.engine === "fake") {
    return { assembly: "fake", credentials };
  }
  if (scripts.length === 0) {
    return { assembly: "pi", credentials };
  }
  const scripted = createScriptedModels();
  for (const turn of scripts) {
    for (const step of turn) {
      if (step.kind === "text") {
        scripted.text(step.text);
      } else if (step.kind === "tool") {
        scripted.toolCall(step.toolName, step.input ?? null);
      }
    }
  }
  return {
    assembly: "pi",
    credentials,
    models: scripted.source,
    modelSettings: scriptedModelSettings(),
  };
}

/** 讀 stdin 的第一行（`init`），其餘資料留給控制通道。 */
function readInit(
  input: Readable,
  timeoutMs: number,
): Promise<{ line: string; remainder: PassThrough }> {
  return new Promise((resolvePromise, reject) => {
    const remainder = new PassThrough();
    let buffer = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new InitError("timeout", "等不到 init"));
      }
    }, timeoutMs);
    timer.unref?.();
    const onData = (chunk: string | Buffer): void => {
      if (settled) {
        remainder.write(chunk);
        return;
      }
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const index = buffer.indexOf("\n");
      if (index < 0) {
        if (buffer.length > 64 * 1024) {
          settled = true;
          clearTimeout(timer);
          reject(new InitError("invalid_message", "init 超過長度上限"));
        }
        return;
      }
      const line = buffer.slice(0, index).replace(/\r$/, "");
      const rest = buffer.slice(index + 1);
      if (rest.length > 0) remainder.write(rest);
      buffer = "";
      settled = true;
      clearTimeout(timer);
      // 保留監聽：init 之後的資料全部轉給控制通道。
      resolvePromise({ line, remainder });
    };
    input.on("data", onData);
    input.once("end", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new InitError("stdin_end", "stdin 在 init 之前結束"));
      }
      remainder.end();
    });
  });
}

function parseInit(line: string): InitFrame {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new InitError("invalid_message", "init 不是合法 JSON");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new InitError("invalid_message", "init 必須是物件");
  }
  const frame = parsed as Record<string, unknown>;
  if (frame.type !== "init") throw new InitError("invalid_message", "第一行必須是 init");
  if (frame.protocol !== CONTROL_PROTOCOL) {
    throw new InitError("protocol_mismatch", "控制面版本不符");
  }
  if (!isValidToken(frame.token)) throw new InitError("invalid_token", "控制 Token 格式不正確");
  if (!isValidToken(frame.brokerToken)) {
    throw new InitError("invalid_token", "代理 Token 格式不正確");
  }
  if (frame.token === frame.brokerToken) {
    throw new InitError("invalid_token", "控制 Token 與代理 Token 不能相同");
  }
  const folder = frame.folder as Record<string, unknown> | undefined;
  if (typeof folder !== "object" || folder === null || typeof folder.path !== "string") {
    throw new InitError("invalid_folder", "init 缺少 folder.path");
  }
  if (!isAbsolute(folder.path)) {
    throw new InitError("invalid_folder", "folder.path 必須是絕對路徑");
  }
  if (frame.clientToken !== undefined && !isValidToken(frame.clientToken)) {
    throw new InitError("invalid_token", "clientToken 格式不正確");
  }
  return {
    type: "init",
    protocol: frame.protocol,
    token: frame.token,
    brokerToken: frame.brokerToken,
    folder: { path: folder.path },
    ...(frame.limits === undefined
      ? {}
      : { limits: frame.limits as NonNullable<InitFrame["limits"]> }),
    ...(frame.clientToken === undefined ? {} : { clientToken: frame.clientToken as string }),
  };
}

/**
 * 服務入口的兩種模式：
 * - 控制模式（無 `--folder`）：stdin 第一行 `init`，stdout 第一行 `ready`，
 *   之後同一對 pipe 走 NDJSON。
 * - 獨立模式（`--folder`）：沒有控制面、沒有 stdin 租約，只提供客戶端協定；
 *   `ready` 寫在 stdout 供啟動者取得埠與 client Token。
 */
export async function run(
  argv: readonly string[],
  sink: ProtocolSink,
  streams: { readonly input?: Readable; readonly stderr?: NodeJS.WritableStream } = {},
): Promise<number> {
  const logger = new StderrLogger("host");
  const stderr = streams.stderr ?? process.stderr;
  const input = streams.input ?? process.stdin;
  const args = parseArgs(argv);
  const usesFaultInjection =
    args.faultCloseEventLogMs !== undefined ||
    args.faultCloseRuntimeMs !== undefined ||
    args.faultSkipDedupeComplete;
  if (usesFaultInjection && process.env.CARDIARY_TEST_FAULTS !== "1") {
    stderr.write("故障注入旗標只供測試使用；需要 CARDIARY_TEST_FAULTS=1。\n");
    return 2;
  }
  if (args.folder === undefined) {
    return runControl(args, sink, logger, stderr, input);
  }
  return runIndependent(args, sink, logger, stderr);
}

async function runIndependent(
  args: ParsedArgs,
  sink: ProtocolSink,
  logger: StderrLogger,
  stderr: NodeJS.WritableStream,
): Promise<number> {
  const folderPath = args.folder;
  if (folderPath === undefined) {
    stderr.write("缺少 --folder\n");
    return 2;
  }
  if (!insideTmp(folderPath)) {
    stderr.write("TMPDIR/TMP/TEMP 必須指向 <folder>/tmp；請在啟動前設定環境變數。\n");
    return 2;
  }
  const clientToken = generateToken();
  const scripts = await loadScripts(args.script);
  const credentials = new UnavailableCredentials();
  const assembly = assemblyFor(args, scripts, credentials);
  let host: RunningHost;
  try {
    host = await startHost({
      folderPath,
      clientToken,
      logger,
      demo: args.demo,
      scripts,
      initializeFolder: args.initializeFolder,
      ...assembly,
      ...(args.port === undefined ? {} : { port: args.port }),
      ...(args.faultCloseEventLogMs === undefined
        ? {}
        : { faultCloseEventLogAfterMs: args.faultCloseEventLogMs }),
      ...(args.faultCloseRuntimeMs === undefined
        ? {}
        : { faultCloseRuntimeAfterMs: args.faultCloseRuntimeMs }),
      ...(args.faultSkipDedupeComplete ? { faultSkipDedupeComplete: true } : {}),
      fatalNotifier: async () => {
        setTimeout(() => process.exit(70), 50).unref?.();
      },
    });
  } catch (error) {
    stderr.write(`服務啟動失敗：${messageOf(error)}\n`);
    return 2;
  }
  const ready: ReadyFrame = {
    type: "ready",
    protocol: PROTOCOL_VERSION,
    pid: process.pid,
    clientPort: host.port,
    folderId: host.service.folder.folderId,
    epoch: host.epoch,
    clientToken,
  };
  await sink.writeLine(JSON.stringify(ready));
  const stop = (signal: string): void => {
    void host.service.abort(signal).then(async () => {
      await sink.flush();
      process.exit(0);
    });
  };
  process.once("SIGTERM", () => stop("sigterm"));
  process.once("SIGINT", () => stop("sigint"));
  return new Promise<number>(() => undefined);
}

async function runControl(
  args: ParsedArgs,
  sink: ProtocolSink,
  logger: StderrLogger,
  stderr: NodeJS.WritableStream,
  input: Readable,
): Promise<number> {
  let init: InitFrame;
  let remainder: PassThrough;
  try {
    const first = await readInit(input, 10_000);
    init = parseInit(first.line);
    remainder = first.remainder;
  } catch (error) {
    const reason = error instanceof InitError ? error.reason : "invalid_message";
    stderr.write(`init 失敗：${reason}\n`);
    // stdin 的監聽會讓事件迴圈繼續活著；init 失敗時要主動收掉。
    input.destroy();
    return 2;
  }
  if (!insideTmp(init.folder.path)) {
    logger.warn("TMPDIR 不在 <folder>/tmp 底下；暫存檔可能落在資料夾外", {
      tmpdir: tmpdir(),
    });
  }
  const scripts = await loadScripts(args.script);
  const clientToken =
    init.clientToken !== undefined &&
    init.clientToken !== init.token &&
    init.clientToken !== init.brokerToken
      ? init.clientToken
      : generateToken();
  let channelRef: ControlChannel | null = null;
  const credentials = new LazyBrokerCredentials();
  const assembly = assemblyFor(args, scripts, credentials);
  let host: RunningHost;
  try {
    host = await startHost({
      folderPath: init.folder.path,
      clientToken,
      logger,
      demo: args.demo,
      scripts,
      initializeFolder: args.initializeFolder,
      ...assembly,
      ...(args.port === undefined ? {} : { port: args.port }),
      ...(args.faultCloseEventLogMs === undefined
        ? {}
        : { faultCloseEventLogAfterMs: args.faultCloseEventLogMs }),
      ...(args.faultCloseRuntimeMs === undefined
        ? {}
        : { faultCloseRuntimeAfterMs: args.faultCloseRuntimeMs }),
      ...(args.faultSkipDedupeComplete ? { faultSkipDedupeComplete: true } : {}),
      maintenanceNotifier: async (lifecycle, operationId) => {
        await channelRef
          ?.notify("notify.maintenance", { lifecycle, operationId })
          .catch(() => undefined);
      },
      fatalNotifier: async (reason, detail) => {
        await channelRef?.notify("notify.fatal", { reason, detail }).catch(() => undefined);
        // 留一點時間讓 notify.fatal、control.pause 的回應與客戶端 1011 送出去。
        setTimeout(() => process.exit(70), 150).unref?.();
      },
    });
  } catch (error) {
    stderr.write(`服務啟動失敗：${messageOf(error)}\n`);
    return 2;
  }

  const channel = new ControlChannel({
    input: remainder,
    writer: sink,
    token: init.token,
    brokerToken: init.brokerToken,
    logger,
    ...(init.limits?.maxFrameBytes === undefined
      ? {}
      : { maxFrameBytes: init.limits.maxFrameBytes }),
    onStorageFailure: async (detail) => {
      await host.service.failStorage(detail);
    },
    onClose: (reason) => {
      if (reason === "stdin_end" || reason === "write_failed") {
        void host.service.abort(`control_${reason}`).then(async () => {
          await sink.flush();
          process.exit(0);
        });
      }
    },
  });
  channelRef = channel;
  credentials.use(new BrokerCredentialSource(new BrokerClient(channel)));
  channel.onRequest("control.health", async () => toJson(host.service.health()));
  channel.onRequest("control.pause", async (payload) => {
    const reason = typeof payload.reason === "string" ? payload.reason : "user";
    const deadlineMs = typeof payload.deadlineMs === "number" ? payload.deadlineMs : undefined;
    const result = await host.service.pause(reason, deadlineMs);
    return toJson(result);
  });
  channel.onRequest("control.resume", async (payload) => {
    const folder = payload.folder as Record<string, unknown> | undefined;
    const folderPath = typeof folder?.path === "string" ? folder.path : undefined;
    return toJson(await host.service.resume(folderPath));
  });
  channel.onRequest("control.shutdown", async (payload) => {
    const reason = typeof payload.reason === "string" ? payload.reason : "user";
    const result = await host.service.shutdown(reason);
    setImmediate(async () => {
      await sink.flush();
      process.exit(0);
    });
    return toJson(result);
  });
  const ready: ReadyFrame = {
    type: "ready",
    protocol: PROTOCOL_VERSION,
    pid: process.pid,
    clientPort: host.port,
    folderId: host.service.folder.folderId,
    epoch: host.epoch,
  };
  await sink.writeLine(JSON.stringify(ready));
  channel.start();
  try {
    await channel.handshake();
  } catch {
    logger.warn("hello 交握失敗，關閉控制通道與客戶端入口");
    channel.close("handshake_failed");
    await host.gateway.close().catch(() => undefined);
    await host.service.abort("handshake_failed").catch(() => undefined);
    input.destroy();
    return 2;
  }
  const stop = (signal: string): void => {
    void host.service.abort(signal).then(async () => {
      await sink.flush();
      process.exit(0);
    });
  };
  process.once("SIGTERM", () => stop("sigterm"));
  process.once("SIGINT", () => stop("sigint"));
  return new Promise<number>(() => undefined);
}

function toJson(value: unknown): JSONObject {
  return JSON.parse(JSON.stringify(value)) as JSONObject;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type { FolderInfo };
