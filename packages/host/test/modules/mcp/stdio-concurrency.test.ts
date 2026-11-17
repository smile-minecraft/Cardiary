/**
 * 真子行程上的連線併發：初始化完成前，所有呼叫都要等同一個初始化 promise；
 * 重複 close 也要共用同一次關行程，不能提前回來。
 *
 * 子行程的行為由 host 寫的檔案控制：
 * - 啟動時把自己的 pid 寫到 pid，把收到的 method 依序記到 methods.log；
 * - 收到 initialize 後等 gate 檔出現才回，並在回之前記 __initialize_responded；
 * - 忽略 SIGTERM，只能被 SIGKILL 殺掉，讓「第二個 close 提前回」穩定現形。
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createMcpClient } from "../../../src/modules/mcp/client.js";
import { SpawnRegistry } from "../../../src/spawn/wrapper.js";

const CONTROLLED_SCRIPT = `
const fs = require("node:fs");
const readline = require("node:readline");
process.on("SIGTERM", () => {});
fs.writeFileSync("pid", String(process.pid));
function append(line) { fs.appendFileSync("methods.log", line + "\\n"); }
function waitGate() {
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (fs.existsSync("gate")) { clearInterval(timer); resolve(); }
    }, 5);
  });
}
function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
}
readline.createInterface({ input: process.stdin }).on("line", async (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  append(message.method);
  if (message.method === "initialize") {
    await waitGate();
    append("__initialize_responded");
    reply(message.id, { protocolVersion: "2025-06-18", capabilities: {} });
  } else if (message.method === "tools/list") {
    reply(message.id, { tools: [{ name: "echo" }] });
  } else if (message.method === "tools/call") {
    reply(message.id, { content: [], isError: false });
  }
});
`;

let root = "";
let registry: SpawnRegistry;

afterEach(async () => {
  await registry?.cancelAll(1_000);
  await registry?.waitAll();
  if (root !== "") rmSync(root, { recursive: true, force: true });
  root = "";
});

function setup(): void {
  root = realpathSync(mkdtempSync(join(tmpdir(), "cardiary-mcp-concurrent-")));
  mkdirSync(join(root, "state"), { recursive: true });
  registry = new SpawnRegistry();
}

function workingDir(serverId: string): string {
  return join(root, "tmp", "mcp", serverId);
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return predicate();
}

function methods(serverId: string): string[] {
  const file = join(workingDir(serverId), "methods.log");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.length > 0);
}

function makeClient(serverId: string) {
  const record = {
    serverId,
    name: "可控伺服器",
    transport: "stdio" as const,
    command: process.execPath,
    args: ["-e", CONTROLLED_SCRIPT],
    allowedHosts: [],
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  return createMcpClient(record, {
    folderRoot: root,
    spawn: registry,
    logger: { debug: () => undefined, warn: () => undefined },
  });
}

function expectExited(pid: number): void {
  expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
}

describe.skipIf(process.platform !== "darwin")("stdio 初始化與關閉的併發", () => {
  it("呼叫並行時都等初始化回應後才送 tools/list 與 tools/call", async () => {
    setup();
    const serverId = "concurrent-init";
    const client = makeClient(serverId);

    const listing = client.listTools();
    const call = client.callTool("echo", {});

    // 等子行程收到 initialize；此時 gate 還沒開，初始化回應尚未送出。
    expect(await waitFor(() => methods(serverId).includes("initialize"), 3_000)).toBe(true);
    // 給「跳過等待、提前送出 tools/call」一個 bounded 觀察窗口。開 gate 前
    // 先等它出現，讓修正前的錯誤穩定現形；這不是拿定時器假裝初始化 ready。
    await waitFor(() => methods(serverId).includes("tools/call"), 500);
    // 開 gate 讓 initialize 回應，初始化才完成。
    writeFileSync(join(workingDir(serverId), "gate"), "1");
    await Promise.all([listing, call]);

    const order = methods(serverId);
    expect(order[0]).toBe("initialize");
    expect(order).toContain("__initialize_responded");
    const responseIndex = order.indexOf("__initialize_responded");
    expect(
      order.slice(0, responseIndex).filter((m) => m === "tools/list" || m === "tools/call"),
      "初始化回應前不該送出 tools/list 或 tools/call",
    ).toEqual([]);
    await client.close();
  });

  it("兩次並行 close 都等到子行程真正結束才回來", async () => {
    setup();
    const serverId = "double-close";
    const client = makeClient(serverId);
    const listing = client.listTools();
    const rejection = listing.then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(await waitFor(() => methods(serverId).includes("initialize"), 3_000)).toBe(true);
    const pid = Number(readFileSync(join(workingDir(serverId), "pid"), "utf8"));

    const first = client.close();
    const second = client.close();
    await second;
    // 第二個 close 回來時，子行程必須已經被殺掉；提前回來就抓到錯誤。
    expectExited(pid);
    await first;
    expect(await rejection, "初始化中的清單應以 closed 拒絕").toMatchObject({ code: "closed" });
    expect(registry.runningCount).toBe(0);
  });
});
