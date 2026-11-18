/**
 * stdio MCP 伺服器的端到端沙盒邊界（不是只比對 profile 文字）。
 *
 * 這裡走真正的 `createMcpClient` stdio 路徑：它內部呼叫
 * `createMcpStdioSandbox`，用真的 `/usr/bin/sandbox-exec -p <profile>` 啟動一個
 * 真的 node MCP 子行程，再以換行分隔的 JSON-RPC 通訊。伺服器提供 `write_file`
 * 工具，讓測試指定路徑請子行程寫入；另一個 `net_connect` 工具讓子行程真的
 * 對 host 的 TCP listener 發出連線。結果由 host 端再獨立驗證檔案是否真的
 * 被建立或改寫、listener 是否收到連線，不只相信子行程的自報。
 *
 * 硬連結／符號連結的防線已由 `hardlink-guard.test.ts` 用真的 `linkSync` 覆蓋，
 * 這裡依需求只驗證實際子行程的寫入成敗。
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
import { createServer, type AddressInfo, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { McpServerRecord } from "@cardiary/domain";

import { createMcpClient, type McpClient } from "../../../src/modules/mcp/client.js";
import { createMcpStdioSandbox } from "../../../src/modules/mcp/sandbox.js";
import { SANDBOX_EXEC_PATH } from "../../../src/permissions/sandbox.js";
import { SpawnRegistry } from "../../../src/spawn/wrapper.js";

const SERVER_ID = "e2e-writes";
const STATE_JSON = '{"servers":[]}';

/**
 * 真的 MCP stdio 伺服器：從 stdin 讀 JSON-RPC，回 initialize / tools/list，
 * 並用 write_file 工具實際呼叫 fs.writeFileSync，把成功或錯誤碼放回結果。
 */
const SERVER_SCRIPT = `
const fs = require("node:fs");
const net = require("node:net");
const readline = require("node:readline");

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
}

/** 非同步工具：回传一个 Promise，line handler 会 await 后再 reply。 */
function callTool(params) {
  const name = params && params.name;
  const args = (params && params.arguments) || {};
  if (name === "net_connect") {
    return new Promise((resolve) => {
      const socket = net.connect({ host: args.host, port: args.port });
      let done = false;
      const finish = (payload) => {
        if (done) return;
        done = true;
        socket.destroy();
        resolve({ content: [{ type: "text", text: JSON.stringify(payload) }], isError: payload.ok !== true });
      };
      socket.once("connect", () => finish({ ok: true }));
      socket.once("error", (error) => finish({ ok: false, code: error && error.code ? error.code : String(error) }));
      setTimeout(() => finish({ ok: false, code: "TIMEOUT" }), 2000);
    });
  }
  let payload;
  if (name === "write_file") {
    try {
      fs.writeFileSync(args.path, args.content, "utf8");
      payload = { ok: true };
    } catch (error) {
      payload = { ok: false, code: error && error.code ? error.code : String(error) };
    }
  } else {
    payload = { ok: false, code: "unknown_tool" };
  }
  return Promise.resolve({
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError: payload.ok !== true,
  });
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const method = message.method;
  const id = message.id;
  if (method === "notifications/initialized") return;
  if (id === undefined) return;
  if (method === "initialize") {
    reply(id, {
      protocolVersion: "2025-06-18",
      capabilities: {},
      serverInfo: { name: "e2e", version: "1.0.0" },
    });
  } else if (method === "tools/list") {
    reply(id, { tools: [
      { name: "write_file", description: "寫檔", inputSchema: { type: "object" } },
      { name: "net_connect", description: "連 TCP", inputSchema: { type: "object" } },
    ] });
  } else if (method === "tools/call") {
    reply(id, await callTool(message.params));
  } else {
    reply(id, {});
  }
});
`;

let root = "";
let client: McpClient | null = null;
let registry: SpawnRegistry | null = null;
let listener: Server | null = null;
let connections = 0;

afterEach(async () => {
  await client?.close();
  client = null;
  await registry?.cancelAll(1_000);
  await registry?.waitAll();
  registry = null;
  if (listener !== null) {
    await new Promise<void>((resolve) => listener!.close(() => resolve()));
    listener = null;
  }
  connections = 0;
  if (root !== "") {
    rmSync(root, { recursive: true, force: true });
    root = "";
  }
});

function setup(): {
  folderRoot: string;
  stateFile: string;
  outsideDir: string;
  workingDir: string;
  script: string;
} {
  root = realpathSync(mkdtempSync(join(tmpdir(), "cardiary-mcp-sandbox-e2e-")));
  const folderRoot = join(root, "Cardiary");
  const workingDir = join(folderRoot, "tmp", "mcp", SERVER_ID);
  for (const dir of [
    join(folderRoot, "state"),
    join(folderRoot, "cards"),
    join(folderRoot, "assets"),
    workingDir,
  ]) {
    mkdirSync(dir, { recursive: true });
  }
  const stateFile = join(folderRoot, "state", "mcp-servers.json");
  writeFileSync(stateFile, STATE_JSON, "utf8");
  const outsideDir = join(root, "outside");
  mkdirSync(outsideDir, { recursive: true });
  const script = join(root, "server.cjs");
  writeFileSync(script, SERVER_SCRIPT, "utf8");
  return { folderRoot, stateFile, outsideDir, workingDir, script };
}

/** 解讀伺服器放回 tools/call 結果裡的 payload。 */
function writeResult(result: { text: string }): { ok: boolean; code?: string } {
  return JSON.parse(result.text) as { ok: boolean; code?: string };
}

/** 用真的 sandbox-exec 啟動 MCP 子行程，回連好的 client。 */
async function startSandboxedClient(script: string): Promise<McpClient> {
  const folderRoot = join(root, "Cardiary");
  const sandbox = createMcpStdioSandbox({ folderRoot, serverId: SERVER_ID });
  expect(sandbox).not.toBeNull();
  expect(sandbox!.executable).toBe(SANDBOX_EXEC_PATH);
  expect(sandbox!.profile).toContain("(deny network*)");

  const server: McpServerRecord = {
    serverId: SERVER_ID,
    name: "E2E",
    transport: "stdio",
    command: process.execPath,
    args: [script],
    allowedHosts: [],
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  registry = new SpawnRegistry();
  const started = createMcpClient(server, {
    folderRoot,
    spawn: registry,
    logger: { debug: () => undefined, warn: () => undefined },
  });
  client = started;
  return started;
}

/** 在 host 端起一個 127.0.0.1 TCP listener，記錄是否收到連線。 */
async function startListener(): Promise<number> {
  connections = 0;
  listener = createServer(() => {
    connections += 1;
  });
  await new Promise<void>((resolve) => listener!.listen(0, "127.0.0.1", resolve));
  return (listener!.address() as AddressInfo).port;
}

describe.skipIf(process.platform !== "darwin")("stdio MCP 的真正 sandbox-exec 寫入邊界", () => {
  it("子行程只寫得進工作目錄，正本區與資料夾外都寫不進", async () => {
    const { folderRoot, stateFile, outsideDir, workingDir, script } = setup();
    const mcp = await startSandboxedClient(script);

    const tools = await mcp.listTools();
    expect(tools.map((tool) => tool.name)).toContain("write_file");

    // 工作目錄內可寫，host 端也讀得到內容。
    const allowed = join(workingDir, "allowed.txt");
    expect(writeResult(await mcp.callTool("write_file", { path: allowed, content: "ok" }))).toEqual(
      {
        ok: true,
      },
    );
    expect(readFileSync(allowed, "utf8")).toBe("ok");

    // state/mcp-servers.json 正本不可寫，內容完全不變。
    expect(
      writeResult(await mcp.callTool("write_file", { path: stateFile, content: "HACKED" })).ok,
    ).toBe(false);
    expect(readFileSync(stateFile, "utf8")).toBe(STATE_JSON);

    // cards / assets / state 底下同時驗證子行程回失敗，且 host 端沒有多出檔案。
    for (const name of ["cards", "assets", "state"]) {
      const target = join(folderRoot, name, "notes.txt");
      expect(
        writeResult(await mcp.callTool("write_file", { path: target, content: "HACKED" })).ok,
        `${name} 的寫入應被拒`,
      ).toBe(false);
      expect(existsSync(target), `${name} 不應出現 notes.txt`).toBe(false);
    }

    // 資料夾外（同層暫存資料夾）寫不進。
    const outside = join(outsideDir, "notes.txt");
    expect(
      writeResult(await mcp.callTool("write_file", { path: outside, content: "HACKED" })).ok,
    ).toBe(false);
    expect(existsSync(outside)).toBe(false);
  });

  it("授權持久資料後可寫自己的目錄，未授權時寫被拒；其他 modules 仍拒絕", async () => {
    const { folderRoot, script } = setup();
    // 授權後：沙盒額外放行 modules/mcp/<SERVER_ID>/，子行程寫得進去。
    const granted = createMcpClient(
      {
        serverId: SERVER_ID,
        name: "E2E",
        transport: "stdio",
        command: process.execPath,
        args: [script],
        allowedHosts: [],
        enabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        folderRoot,
        spawn: (registry = new SpawnRegistry()),
        logger: { debug: () => undefined, warn: () => undefined },
        persistentData: true,
      },
    );
    client = granted;
    const mine = join(folderRoot, "modules", "mcp", SERVER_ID);
    const target = join(mine, "notes.txt");
    expect(
      writeResult(await granted.callTool("write_file", { path: target, content: "persist" })).ok,
    ).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("persist");

    // 授權後也只能寫自己的目錄，其他伺服器的目錄仍拒絕。
    mkdirSync(join(folderRoot, "modules", "mcp", "other-server"), { recursive: true });
    const other = join(folderRoot, "modules", "mcp", "other-server", "notes.txt");
    expect(
      writeResult(await granted.callTool("write_file", { path: other, content: "no" })).ok,
    ).toBe(false);
    expect(existsSync(other)).toBe(false);

    await granted.close();
    client = null;
    await registry?.cancelAll(1_000);
    await registry?.waitAll();
    registry = null;

    // 未授權：同一個目錄寫不進。
    const denied = createMcpClient(
      {
        serverId: SERVER_ID,
        name: "E2E",
        transport: "stdio",
        command: process.execPath,
        args: [script],
        allowedHosts: [],
        enabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        folderRoot,
        spawn: (registry = new SpawnRegistry()),
        logger: { debug: () => undefined, warn: () => undefined },
      },
    );
    client = denied;
    const rejected = join(mine, "denied.txt");
    expect(
      writeResult(await denied.callTool("write_file", { path: rejected, content: "no" })).ok,
    ).toBe(false);
    expect(existsSync(rejected)).toBe(false);

    // 其他伺服器的目錄即使授權後也寫不進。
    await denied.close();
    client = null;
    await registry?.cancelAll(1_000);
    await registry?.waitAll();
    registry = null;
  });

  it("子行程無法連到 host 的 localhost TCP server，網路被沙盒封鎖", async () => {
    const { script } = setup();
    const port = await startListener();
    const mcp = await startSandboxedClient(script);

    const tools = await mcp.listTools();
    expect(tools.map((tool) => tool.name)).toContain("net_connect");

    // 子行程真的對 host listener 發出 net.connect；沙盒下必須失敗。
    const result = writeResult(await mcp.callTool("net_connect", { host: "127.0.0.1", port }));
    expect(result, "沙盒下的 net.connect 應因權限被拒").toEqual({ ok: false, code: "EPERM" });

    // host 端另外驗證沒有收到任何連線，不只信子行程自報。
    expect(connections, "host 不應收到子行程的連線").toBe(0);
  });
});
