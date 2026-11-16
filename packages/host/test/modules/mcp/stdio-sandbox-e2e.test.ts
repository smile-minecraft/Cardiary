/**
 * stdio MCP 伺服器的端到端沙盒邊界（不是只比對 profile 文字）。
 *
 * 這裡走真正的 `createMcpClient` stdio 路徑：它內部呼叫
 * `createMcpStdioSandbox`，用真的 `/usr/bin/sandbox-exec -p <profile>` 啟動一個
 * 真的 node MCP 子行程，再以換行分隔的 JSON-RPC 通訊。伺服器提供 `write_file`
 * 工具，讓測試指定路徑請子行程寫入；結果由 host 端再獨立驗證檔案是否真的
 * 被建立或改寫，不只相信子行程的自報。
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
const readline = require("node:readline");

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
}

function callTool(params) {
  const name = params && params.name;
  const args = (params && params.arguments) || {};
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
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError: payload.ok !== true,
  };
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
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
    reply(id, { tools: [{ name: "write_file", description: "寫檔", inputSchema: { type: "object" } }] });
  } else if (method === "tools/call") {
    reply(id, callTool(message.params));
  } else {
    reply(id, {});
  }
});
`;

let root = "";
let client: McpClient | null = null;
let registry: SpawnRegistry | null = null;

afterEach(async () => {
  await client?.close();
  client = null;
  await registry?.cancelAll(1_000);
  await registry?.waitAll();
  registry = null;
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

describe.skipIf(process.platform !== "darwin")("stdio MCP 的真正 sandbox-exec 寫入邊界", () => {
  it("子行程只寫得進工作目錄，正本區與資料夾外都寫不進", async () => {
    const { folderRoot, stateFile, outsideDir, workingDir, script } = setup();

    // 真的產生 sandbox。macOS 上 sandbox-exec 不可用時 createMcpStdioSandbox
    // 回 null，這裡直接失敗，不靜默跳過。
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
    client = createMcpClient(server, {
      folderRoot,
      spawn: registry,
      logger: { debug: () => undefined, warn: () => undefined },
    });

    const tools = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain("write_file");

    // 工作目錄內可寫，host 端也讀得到內容。
    const allowed = join(workingDir, "allowed.txt");
    expect(
      writeResult(await client.callTool("write_file", { path: allowed, content: "ok" })),
    ).toEqual({
      ok: true,
    });
    expect(readFileSync(allowed, "utf8")).toBe("ok");

    // state/mcp-servers.json 正本不可寫，內容完全不變。
    expect(
      writeResult(await client.callTool("write_file", { path: stateFile, content: "HACKED" })).ok,
    ).toBe(false);
    expect(readFileSync(stateFile, "utf8")).toBe(STATE_JSON);

    // cards / assets / state 底下同時驗證子行程回失敗，且 host 端沒有多出檔案。
    for (const name of ["cards", "assets", "state"]) {
      const target = join(folderRoot, name, "notes.txt");
      expect(
        writeResult(await client.callTool("write_file", { path: target, content: "HACKED" })).ok,
        `${name} 的寫入應被拒`,
      ).toBe(false);
      expect(existsSync(target), `${name} 不應出現 notes.txt`).toBe(false);
    }

    // 資料夾外（同層暫存資料夾）寫不進。
    const outside = join(outsideDir, "notes.txt");
    expect(
      writeResult(await client.callTool("write_file", { path: outside, content: "HACKED" })).ok,
    ).toBe(false);
    expect(existsSync(outside)).toBe(false);
  });
});
