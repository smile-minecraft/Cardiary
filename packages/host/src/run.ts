import { PassThrough, type Readable } from "node:stream";
import { isAbsolute, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { JSONObject } from "@cardiary/protocol";

import { startHost, type RunningHost } from "./bootstrap.js";
import type { FolderInfo } from "./control/broker.js";
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
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
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
      case "--script": {
        script = argv[index + 1];
        index += 1;
        break;
      }
      case "--control":
        control = true;
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
  let host: RunningHost;
  try {
    host = await startHost({
      folderPath,
      clientToken,
      logger,
      demo: args.demo,
      scripts,
      ...(args.port === undefined ? {} : { port: args.port }),
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
  let host: RunningHost;
  try {
    host = await startHost({
      folderPath: init.folder.path,
      clientToken,
      logger,
      demo: args.demo,
      scripts,
      ...(args.port === undefined ? {} : { port: args.port }),
      maintenanceNotifier: async (lifecycle, operationId) => {
        await channelRef
          ?.notify("notify.maintenance", { lifecycle, operationId })
          .catch(() => undefined);
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
  channel.onRequest("control.health", async () => toJson(host.service.health()));
  channel.onRequest("control.pause", async (payload) => {
    const reason = typeof payload.reason === "string" ? payload.reason : "user";
    const deadlineMs = typeof payload.deadlineMs === "number" ? payload.deadlineMs : undefined;
    const result = await host.service.pause(reason, deadlineMs);
    return toJson(result);
  });
  channel.onRequest("control.resume", async () => toJson(await host.service.resume()));
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
    logger.warn("hello 交握失敗，控制通道關閉");
    channel.close("handshake_failed");
    return 0;
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
