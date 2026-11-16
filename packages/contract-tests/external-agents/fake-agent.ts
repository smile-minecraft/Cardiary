import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 契約測試用的假代理。
 *
 * 假代理只說供應商真正的協定：opencode 說 ACP（JSON-RPC over NDJSON），
 * claude-code 說 stream-json。橋接層不認識「假的」格式，所以這組測試跑的
 * 是產品路徑：行程啟動、沙盒、訊息正規化、審批、狀態與清理。
 *
 * 假代理把執行了什麼寫進工作目錄的 `agent.log`（沙盒只允許寫工作目錄與
 * 自己的暫存區），測試用它證明「動作有沒有真的執行」與「有沒有重跑」。
 */

export type FakeAgentMode =
  "complete" | "fail" | "hang" | "permission" | "complete-stubborn" | "permission-pair";

export interface FakeAgentOptions {
  readonly kind: "opencode" | "claude-code";
  readonly mode: FakeAgentMode;
  /** 代理要執行、且需要權限的動作成功時寫入的檔案；只有被核准才寫。 */
  readonly markerFile: string;
  /** 工作目錄；`agent.log` 寫在這裡。 */
  readonly workingDirectory: string;
  /** 進度計畫的步驟名稱；省略表示不送進度。 */
  readonly steps?: readonly string[];
}

export interface FakeAgent {
  /** 給 `CARDIARY_AGENT_COMMAND_*` 用的執行檔。 */
  readonly command: string;
  readonly logPath: string;
  /** 讀回代理寫下的紀錄；尚未執行時回傳空陣列。 */
  readLog(): Promise<readonly Record<string, unknown>[]>;
}

const AGENT_SOURCE = String.raw`import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const plan = JSON.parse(readFileSync(new URL("./plan.json", import.meta.url), "utf8"));
const log = (entry) => appendFileSync(plan.logFile, JSON.stringify({ at: Date.now(), ...entry }) + "\n");
const send = (frame) => process.stdout.write(JSON.stringify(frame) + "\n");

log({ event: "start", pid: process.pid, argv: process.argv.slice(2) });

// 真正的 ACP／Claude Code 收到完成回應也不會自己退出，會等著處理下一輪。
// 假代理也一樣：送完完成訊息就留著，由卡片這端關 stdin 來結束它。
const permissionWaiters = new Map();
const waitPermission = (id) =>
  new Promise((resolve) => {
    permissionWaiters.set(String(id), resolve);
  });
const resolvePermission = (id, allowed) => {
  const waiter = permissionWaiters.get(String(id));
  if (!waiter) return;
  permissionWaiters.delete(String(id));
  waiter(allowed);
};

if (plan.mode === "complete-stubborn") {
  // 用來逼出 SIGKILL 路徑：連 stdin 關閉與 SIGTERM 都忽略。
  process.on("SIGTERM", () => log({ event: "sigterm-ignored" }));
}

function stayAlive() {
  log({ event: "persistent" });
  setInterval(() => undefined, 1000);
}

function finish(stopReason) {
  send({ jsonrpc: "2.0", id: 100, result: { stopReason } });
  log({ event: "completed" });
  stayAlive();
}

function claudeFinish(subtype, text) {
  send({ type: "result", subtype, result: text, session_id: "sess_fake" });
  log({ event: "completed" });
  stayAlive();
}

async function runAcpPrompt() {
  log({ event: "prompt" });
  if (plan.mode === "fail") {
    process.stderr.write("假代理故意失敗\n");
    setTimeout(() => process.exit(3), 10);
    return;
  }
  if (plan.steps && plan.steps.length > 0) {
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "sess_fake",
        update: {
          sessionUpdate: "plan",
          entries: plan.steps.map((content, index) => ({
            content,
            status: index === 0 ? "completed" : "in_progress",
          })),
        },
      },
    });
    log({ event: "progress" });
  }
  if (plan.mode === "permission") {
    send({
      jsonrpc: "2.0",
      id: 42,
      method: "session/request_permission",
      params: {
        sessionId: "sess_fake",
        toolCall: {
          toolName: "bash",
          title: "執行 bash 指令",
          rawInput: { command: "touch marker" },
        },
      },
    });
    const allowed = await waitPermission(42);
    log({ event: allowed ? "permission-allowed" : "permission-denied", id: 42 });
    if (allowed) writeFileSync(plan.markerFile, "executed\n");
  }
  if (plan.mode === "permission-pair") {
    // 兩筆同時送出，各自等决定；核准其中一筆不該覆蓋另一筆的回覆。
    for (const id of [42, 43]) {
      send({
        jsonrpc: "2.0",
        id,
        method: "session/request_permission",
        params: {
          sessionId: "sess_fake",
          toolCall: {
            toolName: "bash",
            title: "執行 bash 指令 " + id,
            rawInput: { command: "touch marker-" + id },
          },
        },
      });
    }
    const replies = await Promise.all([waitPermission(42), waitPermission(43)]);
    for (const [index, allowed] of replies.entries()) {
      const id = 42 + index;
      log({ event: allowed ? "permission-allowed" : "permission-denied", id });
      if (allowed) writeFileSync(plan.markerFile + "-" + id, "executed\n");
    }
  }
  if (plan.mode === "hang") {
    log({ event: "hanging" });
    setInterval(() => undefined, 1000);
    return;
  }
  finish("end_turn");
}

async function runClaudePrompt() {
  log({ event: "prompt" });
  if (plan.mode === "fail") {
    process.stderr.write("假代理故意失敗\n");
    setTimeout(() => process.exit(3), 10);
    return;
  }
  send({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: "開始執行" }] },
    session_id: "sess_fake",
  });
  if (plan.mode === "permission") {
    send({
      type: "control_request",
      request_id: "perm_1",
      request: {
        subtype: "can_use_tool",
        tool_name: "Bash",
        input: { command: "touch marker" },
        description: "執行 bash 指令",
      },
    });
    const allowed = await waitPermission("perm_1");
    log({ event: allowed ? "permission-allowed" : "permission-denied", id: "perm_1" });
    if (allowed) writeFileSync(plan.markerFile, "executed\n");
  }
  if (plan.mode === "permission-pair") {
    for (const id of ["perm_1", "perm_2"]) {
      send({
        type: "control_request",
        request_id: id,
        request: {
          subtype: "can_use_tool",
          tool_name: "Bash",
          input: { command: "touch marker-" + id },
          description: "執行 bash 指令 " + id,
        },
      });
    }
    const replies = await Promise.all([waitPermission("perm_1"), waitPermission("perm_2")]);
    for (const [index, allowed] of replies.entries()) {
      const id = index === 0 ? "perm_1" : "perm_2";
      log({ event: allowed ? "permission-allowed" : "permission-denied", id });
      if (allowed) writeFileSync(plan.markerFile + "-" + id, "executed\n");
    }
  }
  if (plan.mode === "hang") {
    log({ event: "hanging" });
    setInterval(() => undefined, 1000);
    return;
  }
  claudeFinish("success", "假代理完成");
}

function handleAcp(frame) {
  if (frame.method === "initialize") {
    send({ jsonrpc: "2.0", id: frame.id, result: { protocolVersion: 1, agentCapabilities: {} } });
    return;
  }
  if (frame.method === "session/new") {
    send({ jsonrpc: "2.0", id: frame.id, result: { sessionId: "sess_fake" } });
    return;
  }
  if (frame.method === "session/set_config_option") {
    send({ jsonrpc: "2.0", id: frame.id, result: {} });
    return;
  }
  if (frame.method === "session/cancel") {
    log({ event: "cancel" });
    if (plan.mode === "complete-stubborn") return;
    setTimeout(() => process.exit(0), 10);
    return;
  }
  if (frame.method === "session/prompt") {
    void runAcpPrompt();
    return;
  }
  if ((String(frame.id) === "42" || String(frame.id) === "43") && frame.result) {
    const outcome = frame.result.outcome ?? {};
    const allowed = outcome.outcome === "selected" && outcome.optionId !== "reject_once";
    log({ event: "permission-reply", id: String(frame.id), outcome });
    resolvePermission(frame.id, allowed);
    return;
  }
}

function handleClaude(frame) {
  if (frame.type === "control_request" && frame.request?.subtype === "initialize") {
    send({
      type: "control_response",
      response: { subtype: "success", request_id: frame.request_id, response: {} },
    });
    return;
  }
  if (frame.type === "control_request" && frame.request?.subtype === "interrupt") {
    log({ event: "interrupt" });
    if (plan.mode === "complete-stubborn") return;
    setTimeout(() => process.exit(0), 10);
    return;
  }
  if (
    frame.type === "control_response" &&
    (frame.response?.request_id === "perm_1" || frame.response?.request_id === "perm_2")
  ) {
    const allowed = frame.response?.response?.behavior === "allow";
    log({ event: "permission-reply", id: frame.response.request_id, allowed });
    resolvePermission(frame.response.request_id, allowed);
    return;
  }
  if (frame.type === "user") {
    void runClaudePrompt();
  }
}

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const text = line.trim();
  if (text.length === 0) return;
  let frame;
  try {
    frame = JSON.parse(text);
  } catch {
    log({ event: "bad-frame", text });
    return;
  }
  if (plan.kind === "opencode") handleAcp(frame);
  else handleClaude(frame);
});
lines.on("close", () => {
  log({ event: "stdin-closed" });
  // hang 與 complete-stubborn 故意留著，讓測試有機會驗證上層真的會送信號殺行程。
  if (plan.mode !== "hang" && plan.mode !== "complete-stubborn") process.exit(0);
});
`;

/** 安裝一份假代理，回傳可直接放進 `CARDIARY_AGENT_COMMAND_*` 的執行檔。 */
export async function installFakeAgent(options: FakeAgentOptions): Promise<FakeAgent> {
  const dir = await mkdtemp(join(tmpdir(), "cardiary-fake-agent-"));
  const logPath = join(options.workingDirectory, "agent.log");
  const script = join(dir, "agent.mjs");
  const wrapper = join(dir, "agent");
  await writeFile(
    join(dir, "plan.json"),
    JSON.stringify({
      kind: options.kind,
      mode: options.mode,
      markerFile: options.markerFile,
      logFile: logPath,
      steps: options.steps ?? null,
    }),
    "utf8",
  );
  await writeFile(script, AGENT_SOURCE, "utf8");
  await writeFile(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, "utf8");
  await chmod(wrapper, 0o755);
  return {
    command: wrapper,
    logPath,
    async readLog() {
      const { readFile } = await import("node:fs/promises");
      try {
        return (await readFile(logPath, "utf8"))
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .map((line) => JSON.parse(line) as Record<string, unknown>);
      } catch {
        return [];
      }
    },
  };
}
