import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeSync,
} from "node:fs";
import { constants } from "node:fs";
import { resolve } from "node:path";

import type { JsonValue, ToolDefinition, ToolOutcome } from "@cardiary/engine-adapter";
import type { ToolProcessSpec } from "@cardiary/engine-adapter";
import { resolvePath, type PathRoots } from "@cardiary/domain";

import { LOCAL_TOOL_NAMES } from "../../permissions/actions.js";
import type { CommandSandbox } from "../../permissions/sandbox.js";
import { formatToolOutput, type SpillWriter, type ToolOutputLimits } from "./output.js";

/** 一個工具執行時需要的環境；由模組啟用時建立一次。 */
export interface LocalToolsEnvironment {
  readonly workingDir: string;
  readonly folderRoot: string;
  readonly limits: ToolOutputLimits;
  readonly spill: SpillWriter;
  /** 指令的預設逾時；逾時就對整個 process group 送訊號。 */
  readonly commandTimeoutMs: number;
  /** 單次讀檔的位元組上限；超過就請模型改用指令讀片段。 */
  readonly maxReadBytes: number;
  /** 列目錄的項目上限。 */
  readonly maxListEntries: number;
  /** `run_command` 的作業系統沙盒；`null` 代表不可用，指令一律拒絕。 */
  readonly sandbox: CommandSandbox | null;
}

/** 預設值；測試可以縮小，讓截斷與上限真的被觸發。 */
export const DEFAULT_LOCAL_TOOLS_LIMITS = {
  commandTimeoutMs: 120_000,
  maxReadBytes: 2 * 1024 * 1024,
  maxListEntries: 500,
} as const;

/**
 * 四個工具。每個工具只做一件事，輸入轉成一個 `PermissionAction` 之後才
 * 可能被執行（見 `permissions/actions.ts`）。
 */
export function localToolDefinitions(environment: LocalToolsEnvironment): ToolDefinition[] {
  const roots: PathRoots = {
    workingDir: environment.workingDir,
    folderRoot: environment.folderRoot,
  };

  return [
    {
      name: LOCAL_TOOL_NAMES.readFile,
      description:
        "讀取一個文字檔。路徑相對於工作目錄；讀取會跟隨符號連結，但依解析後的位置分類權限。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "檔案路徑；相對路徑以工作目錄為基準。" },
        },
        required: ["path"],
        additionalProperties: false,
      },
      replay: "safe",
      async execute(input, context): Promise<ToolOutcome> {
        const failure = assertWorkingDir(context.workingDir, environment);
        if (failure !== null) return failure;
        const path = stringField(input, "path");
        if (path === null) {
          return { ok: false, message: "read_file 需要 path 字串" };
        }
        const resolved = resolvePath(path, roots);
        if (!resolved.ok) {
          return {
            ok: false,
            message: resolved.reason,
            diagnostics: [{ code: "permission-denied" }],
          };
        }
        let stats;
        try {
          stats = statSync(resolved.path.resolved);
        } catch {
          return { ok: false, message: `檔案不存在：${resolved.path.resolved}` };
        }
        if (!stats.isFile()) {
          return { ok: false, message: `不是檔案：${resolved.path.resolved}` };
        }
        if (stats.size > environment.maxReadBytes) {
          return {
            ok: false,
            message: `檔案 ${stats.size} bytes 超過單次讀取上限 ${environment.maxReadBytes}；請用 run_command 讀取需要的片段。`,
          };
        }
        let text: string;
        try {
          text = readFileNoFollow(resolved.path.resolved);
        } catch (error) {
          return { ok: false, message: `讀取失敗：${describeError(error)}` };
        }
        const output = formatToolOutput(
          text,
          environment.limits,
          { tempDir: context.tempDir, turnId: context.turnId, callId: context.callId },
          environment.spill,
        );
        return {
          ok: true,
          content: [{ type: "text", text: output.text }],
          ...(output.truncated ? { diagnostics: [{ code: "output-truncated" as const }] } : {}),
        };
      },
    },
    {
      name: LOCAL_TOOL_NAMES.writeFile,
      description: "寫入一個文字檔。目標是符號連結時拒絕；包含建立、覆寫與附加三種模式。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "檔案路徑；相對路徑以工作目錄為基準。" },
          content: { type: "string", description: "要寫入的文字。" },
          mode: {
            type: "string",
            enum: ["create", "replace", "append"],
            description: "create 只建立、replace 覆寫、append 附加；預設 replace。",
          },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
      replay: "unsafe",
      async execute(input, context): Promise<ToolOutcome> {
        const failure = assertWorkingDir(context.workingDir, environment);
        if (failure !== null) return failure;
        const path = stringField(input, "path");
        const content = stringField(input, "content");
        if (path === null || content === null) {
          return { ok: false, message: "write_file 需要 path 與 content 字串" };
        }
        const resolved = resolvePath(path, roots);
        if (!resolved.ok) {
          return {
            ok: false,
            message: resolved.reason,
            diagnostics: [{ code: "permission-denied" }],
          };
        }
        const mode = stringField(input, "mode") ?? "replace";
        if (mode !== "create" && mode !== "replace" && mode !== "append") {
          return { ok: false, message: `不支援的寫入模式：${mode}` };
        }
        if (resolved.path.isSymlink) {
          return { ok: false, message: "目標是符號連結；write_file 不跟隨連結。" };
        }
        return writeFile(resolved.path.resolved, content, mode);
      },
    },
    {
      name: LOCAL_TOOL_NAMES.listDirectory,
      description: "列出一個目錄的項目；不跟隨符號連結，排序後回傳名稱。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "目錄路徑；省略時用工作目錄。" },
        },
        additionalProperties: false,
      },
      replay: "safe",
      async execute(input, context): Promise<ToolOutcome> {
        const failure = assertWorkingDir(context.workingDir, environment);
        if (failure !== null) return failure;
        const path = stringField(input, "path") ?? ".";
        const resolved = resolvePath(path, roots);
        if (!resolved.ok) {
          return {
            ok: false,
            message: resolved.reason,
            diagnostics: [{ code: "permission-denied" }],
          };
        }
        return listDirectory(resolved.path.resolved, environment);
      },
    },
    {
      name: LOCAL_TOOL_NAMES.runCommand,
      description:
        "在工作目錄執行一個 shell 指令；子行程經共用 wrapper，stdio 只有 pipe，TMPDIR 在資料夾的 tmp，外層由作業系統沙盒限制寫入與敏感讀取。",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "要執行的指令；由 /bin/sh -c 執行。" },
          cwd: { type: "string", description: "工作目錄；省略時用工作目錄。" },
        },
        required: ["command"],
        additionalProperties: false,
      },
      replay: "unsafe",
      async execute(input, context): Promise<ToolOutcome> {
        const failure = assertWorkingDir(context.workingDir, environment);
        if (failure !== null) return failure;
        const command = stringField(input, "command");
        if (command === null) {
          return { ok: false, message: "run_command 需要 command 字串" };
        }
        const cwdInput = stringField(input, "cwd") ?? ".";
        const cwd = resolvePath(cwdInput, roots);
        if (!cwd.ok) {
          return { ok: false, message: cwd.reason, diagnostics: [{ code: "permission-denied" }] };
        }
        let stats;
        try {
          stats = statSync(cwd.path.resolved);
        } catch {
          return { ok: false, message: `工作目錄不存在：${cwd.path.resolved}` };
        }
        if (!stats.isDirectory()) {
          return { ok: false, message: `不是目錄：${cwd.path.resolved}` };
        }
        return runCommand(command, cwd.path.resolved, context, environment);
      },
    },
  ];
}

/** 工具與權限閘道必須用同一個工作目錄；不同就拒絕執行（fail closed）。 */
function assertWorkingDir(
  workingDir: string,
  environment: LocalToolsEnvironment,
): ToolOutcome | null {
  let actual: string;
  try {
    // 引擎給的是主機啟動時的路徑，可能還沒 realpath（例如 macOS 的 /var）；
    // 權限閘道用的是正規形式，所以兩邊都 realpath 之後再比。
    actual = realpathSync(workingDir);
  } catch {
    try {
      actual = resolve(workingDir);
    } catch {
      actual = workingDir;
    }
  }
  if (actual !== environment.workingDir) {
    return {
      ok: false,
      message: `工具的工作目錄（${workingDir}）與權限閘道的不一致；拒絕執行。`,
      diagnostics: [{ code: "permission-denied" }],
    };
  }
  return null;
}

function readFileNoFollow(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}

function writeFile(
  path: string,
  content: string,
  mode: "create" | "replace" | "append",
): ToolOutcome {
  try {
    if (lstatSync(path).isSymbolicLink()) {
      return { ok: false, message: "目標是符號連結；write_file 不跟隨連結。" };
    }
  } catch {
    // 目標不存在：交給 open 的 O_CREAT。
  }
  const flags =
    constants.O_WRONLY |
    constants.O_CREAT |
    constants.O_NOFOLLOW |
    (mode === "append" ? constants.O_APPEND : constants.O_TRUNC) |
    (mode === "create" ? constants.O_EXCL : 0);
  let fd: number;
  try {
    fd = openSync(path, flags, 0o644);
  } catch (error) {
    return { ok: false, message: `寫入失敗：${describeError(error)}` };
  }
  try {
    const data = Buffer.from(content, "utf8");
    writeSync(fd, data);
    return {
      ok: true,
      content: [{ type: "text", text: `已寫入 ${data.byteLength} bytes：${path}` }],
      metadata: { renderer: "module.local-tools.write", data: { path, bytes: data.byteLength } },
    };
  } finally {
    closeSync(fd);
  }
}

function listDirectory(path: string, environment: LocalToolsEnvironment): ToolOutcome {
  let entries;
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch (error) {
    return { ok: false, message: `列出目錄失敗：${describeError(error)}` };
  }
  const names = entries
    .map((entry) => {
      if (entry.isSymbolicLink()) return `${entry.name}@`;
      if (entry.isDirectory()) return `${entry.name}/`;
      return entry.name;
    })
    .sort((left, right) => left.localeCompare(right));
  const exceeded = names.length > environment.maxListEntries;
  const shown = exceeded ? names.slice(0, environment.maxListEntries) : names;
  const header = `${path}\n${shown.join("\n")}`;
  const text = exceeded
    ? `${header}\n…（共 ${names.length} 項，只顯示前 ${environment.maxListEntries} 項）`
    : header;
  return {
    ok: true,
    content: [{ type: "text", text }],
    ...(exceeded ? { diagnostics: [{ code: "output-truncated" }] } : {}),
  };
}

async function runCommand(
  command: string,
  cwd: string,
  context: Parameters<ToolDefinition["execute"]>[1],
  environment: LocalToolsEnvironment,
): Promise<ToolOutcome> {
  const sandbox = environment.sandbox;
  if (sandbox === null || !existsSync(sandbox.executable)) {
    return sandboxFailureOutcome("sandbox-unavailable");
  }
  const spec: ToolProcessSpec = {
    // sandbox-exec 是最外層；/bin/sh 與它的子行程都繼承同一個沙盒。
    command: sandbox.executable,
    args: ["-p", sandbox.profile, "/bin/sh", "-c", command],
    cwd,
    stdio: "pipe",
  };
  let child;
  try {
    child = context.spawn(spec);
  } catch {
    return {
      ok: false,
      message: "無法啟動作業系統沙盒（sandbox-unavailable）；指令沒有執行。",
      diagnostics: [{ code: "tool-unavailable", message: "sandbox-unavailable" }],
    };
  }

  let timedOut = false;
  let aborted = false;
  const killLater = (): void => {
    const timer = setTimeout(() => child.terminate("SIGKILL"), 2000);
    timer.unref?.();
  };
  const timer = setTimeout(() => {
    timedOut = true;
    child.terminate("SIGTERM");
    killLater();
  }, environment.commandTimeoutMs);
  timer.unref?.();
  const onAbort = (): void => {
    aborted = true;
    child.terminate("SIGTERM");
    killLater();
  };
  if (context.signal.aborted) {
    onAbort();
  } else {
    context.signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    const result = await child.collect();
    if (!timedOut && !aborted) {
      if (result.signal === null && (result.code === null || result.code < 0)) {
        // spawn 失敗（例如找不到 sandbox-exec）時沒有訊號，結束碼是 Node
        // 的負 errno（-2 是 ENOENT）。不能當成一般失敗，否則等於默默沒有
        // 套用到沙盒。
        return sandboxFailureOutcome("sandbox-unavailable");
      }
      // 即使結束碼是 0，子殼層裡的拒絕仍會出現在 stderr；一樣不把原文回給模型。
      const sandboxFailure = diagnoseSandboxFailure(result.stderr);
      if (sandboxFailure !== null) {
        return sandboxFailureOutcome(sandboxFailure);
      }
    }
    const raw = [
      `exit code: ${String(result.code ?? result.signal ?? "unknown")}`,
      result.stdout,
      result.stderr.length === 0 ? "" : `[stderr]\n${result.stderr}`,
    ]
      .filter((part) => part.length > 0)
      .join("\n");
    const output = formatToolOutput(
      raw,
      environment.limits,
      { tempDir: context.tempDir, turnId: context.turnId, callId: context.callId },
      environment.spill,
    );
    const diagnostics = [
      ...(output.truncated ? [{ code: "output-truncated" as const }] : []),
      ...(timedOut ? [{ code: "timed-out" as const }] : []),
      ...(aborted ? [{ code: "paused" as const }] : []),
    ];
    if (aborted) {
      return { ok: false, message: `指令被取消\n${output.text}`, diagnostics };
    }
    if (timedOut) {
      return {
        ok: false,
        message: `指令逾時（${environment.commandTimeoutMs} ms）\n${output.text}`,
        diagnostics,
      };
    }
    return result.code === 0
      ? {
          ok: true,
          content: [{ type: "text", text: output.text }],
          ...(diagnostics.length > 0 ? { diagnostics } : {}),
        }
      : { ok: false, message: output.text, diagnostics };
  } finally {
    clearTimeout(timer);
    context.signal.removeEventListener("abort", onAbort);
  }
}

/**
 * 子行程的 stderr 是不是 sandbox 造成的失敗。
 *
 * 拒絕時子行程會收到 EPERM 並印出自己的錯誤（`Operation not permitted`）；
 * `sandbox-exec` 自己套用 profile 失敗時會用 `sandbox-exec:` 開頭。這裡只
 * 用來分類，原始字串不會回給模型（見 `sandboxFailureOutcome`）。
 */
function diagnoseSandboxFailure(stderr: string): "sandbox-denied" | "sandbox-unavailable" | null {
  if (/operation not permitted|sandbox_apply/i.test(stderr)) {
    return "sandbox-denied";
  }
  if (/^sandbox-exec:/m.test(stderr)) {
    return "sandbox-unavailable";
  }
  return null;
}

/** sandbox 失敗的統一回覆；不轉貼 OS 原文、路徑或子行程 stderr。 */
function sandboxFailureOutcome(failure: "sandbox-denied" | "sandbox-unavailable"): ToolOutcome {
  if (failure === "sandbox-denied") {
    return {
      ok: false,
      message:
        "作業系統拒絕了這個指令（sandbox-denied）：它嘗試碰觸受保護的路徑，或離開允許的寫入範圍。",
      diagnostics: [{ code: "permission-denied", message: "sandbox-denied" }],
    };
  }
  return {
    ok: false,
    message: "作業系統的沙盒不可用（sandbox-unavailable）；為了安全起見，指令沒有執行。",
    diagnostics: [{ code: "tool-unavailable", message: "sandbox-unavailable" }],
  };
}

function stringField(input: JsonValue, key: string): string | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  const value = (input as { [key: string]: unknown })[key];
  return typeof value === "string" ? value : null;
}

function describeError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code;
  return code === undefined ? String(error) : code;
}
