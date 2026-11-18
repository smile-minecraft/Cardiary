import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { installFakeAgent } from "../external-agents/fake-agent.js";
import {
  connectAndHello,
  spawnService,
  type ProtocolClient,
  type SpawnedService,
  type TestFolder,
} from "../test/support.js";

/**
 * 第 13 章正常操作的組合驗收：同一個資料夾、產品組裝，MCP 伺服器與外部代理
 * 都正常配置，沒有故障注入，也沒有繞過任何一層。
 *
 * 這裡驗的是三件事在同一個資料夾裡一起成立：
 * ① 任務跑完與主機重啟後暫存區乾淨，而且清理只動 tmp、不動正本；
 * ② 刪除一場對話後整個資料夾找不到它的內容，MCP 正本與代理快取不受影響；
 * ③ 整個快取區刪掉後重啟，服務回到可用、資料讀得回來、MCP 重新連上。
 *
 * MCP 用真的 stdio 伺服器行程（走核准與 sandbox-exec），外部代理用既有的
 * ACP 假代理。模組內部的行為（沙盒白名單、工具呼叫、權限細節）仍由各自的
 * 單元與 e2e 測試負責，這裡不重複。
 */

const darwin = process.platform === "darwin";
/** 每個案例都要真的 spawn 主機、MCP 伺服器與代理行程。 */
const TEST_TIMEOUT = 90_000;

/** 真的 MCP stdio 伺服器：啟動時在工作目錄留下記號，回應 initialize 與 tools/list。 */
const MCP_SERVER_SCRIPT = `
const fs = require("node:fs");
const readline = require("node:readline");

fs.writeFileSync("mcp-ran.txt", "MCP-RAN\\n", "utf8");

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.method === "notifications/initialized") return;
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    reply(message.id, {
      protocolVersion: "2025-06-18",
      capabilities: {},
      serverInfo: { name: "composed-acceptance", version: "1.0.0" },
    });
  } else if (message.method === "tools/list") {
    reply(message.id, {
      tools: [{ name: "noop", description: "沒有作用", inputSchema: { type: "object" } }],
    });
  } else {
    reply(message.id, {});
  }
});
`;

const services: SpawnedService[] = [];
const clients: ProtocolClient[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) {
    await client.close().catch(() => undefined);
  }
  for (const service of services.splice(0)) {
    await service.stop().catch(() => undefined);
  }
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

async function request<T = Record<string, unknown>>(
  client: ProtocolClient,
  type: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const id = client.request(type, payload);
  const reply = await client.waitForReply(id, 20_000);
  if (reply.kind === "error") {
    throw new Error(`${type} 失敗：${String(reply.code)} ${String(reply.message)}`);
  }
  return reply.payload as T;
}

interface Booted {
  readonly service: SpawnedService;
  readonly client: ProtocolClient;
}

async function boot(
  options: {
    folder?: TestFolder;
    env?: Record<string, string>;
    initializeFolder?: boolean;
    scripts?: readonly (readonly Record<string, unknown>[])[];
  } = {},
): Promise<Booted> {
  const service = await spawnService({
    engine: "pi",
    // 腳本化的模型設定讓會話有主力模型可用；沒有它 session.create 會拒絕。
    scripts: options.scripts ?? [[{ kind: "text", text: "好" }]],
    ...(options.folder === undefined ? {} : { folder: options.folder }),
    ...(options.initializeFolder === undefined
      ? {}
      : { initializeFolder: options.initializeFolder }),
    ...(options.env === undefined ? {} : { env: options.env }),
  });
  services.push(service);
  const client = await connectAndHello(service);
  clients.push(client);
  await request(client, "system.subscribe", {});
  return { service, client };
}

/** 關掉客戶端與主機行程；同一個資料夾要重開之前一定先收掉這一份。 */
async function shutdown(booted: Booted): Promise<void> {
  await booted.client.close().catch(() => undefined);
  clients.splice(clients.indexOf(booted.client), 1);
  await booted.service.stop().catch(() => undefined);
  services.splice(services.indexOf(booted.service), 1);
}

/** 安裝一支會說 ACP 的假代理，回傳啟動主機時要注入的環境變數與工作目錄。 */
async function fakeAgentEnv(): Promise<{ env: Record<string, string>; workingDirectory: string }> {
  const workingDirectory = await mkdtemp(join(tmpdir(), "cardiary-composed-agent-"));
  tempDirs.push(workingDirectory);
  const agent = await installFakeAgent({
    kind: "opencode",
    mode: "complete",
    markerFile: join(workingDirectory, "marker.txt"),
    workingDirectory,
    steps: ["整理結果"],
  });
  return { env: { CARDIARY_AGENT_COMMAND_OPENCODE: agent.command }, workingDirectory };
}

interface AgentStatePayload {
  readonly agentSessionId: string;
  readonly status: string;
}

/** 核准啟動、等到工作階段停止；回傳代理工作階段 id。 */
async function runAgentToCompletion(
  client: ProtocolClient,
  workingDirectory: string,
): Promise<string> {
  const started = await request<{ agentSessionId: string; approvalId: string }>(
    client,
    "agent.start",
    {
      agentKind: "opencode",
      workingDirectory,
      prompt: "把結果整理好",
    },
  );
  await request(client, "approval.decide", {
    approvalId: started.approvalId,
    optionId: "approve",
  });
  await client.waitFor(
    (frame) =>
      frame.kind === "event" &&
      frame.type === "agent.state_changed" &&
      (frame.payload as AgentStatePayload).agentSessionId === started.agentSessionId &&
      (frame.payload as AgentStatePayload).status === "stopped",
    30_000,
  );
  return started.agentSessionId;
}

interface McpServerInfo {
  readonly serverId: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly state: string;
  readonly failure?: string;
  readonly persistentData?: { allowed: boolean };
}

async function listMcpServers(client: ProtocolClient): Promise<readonly McpServerInfo[]> {
  const payload = await request<{ servers: McpServerInfo[] }>(client, "mcp.servers.list", {});
  return payload.servers;
}

/**
 * 等到指定的伺服器真的連上。伺服器由主機在背景啟動，剛 hello 完的清單在
 * 連線建立前會顯示 `disabled`（狀態只有 disabled／ready／failed，沒有
 * 「啟動中」）；重用既有資料夾重啟時不能只看第一眼。時限內沒就緒，或啟動
 * 失敗，都讓測試失敗並帶上最後看到的狀態。
 */
async function waitForMcpReady(
  client: ProtocolClient,
  serverId: string,
  ms = 15_000,
): Promise<McpServerInfo> {
  const deadline = Date.now() + ms;
  let latest: McpServerInfo | undefined;
  while (Date.now() < deadline) {
    latest = (await listMcpServers(client)).find((server) => server.serverId === serverId);
    if (latest?.state === "ready") return latest;
    if (latest?.state === "failed") {
      throw new Error(`MCP 伺服器 ${serverId} 啟動失敗：${String(latest.failure)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`MCP 伺服器 ${serverId} 沒有在時限內就緒：${JSON.stringify(latest ?? null)}`);
}

/** 新增一個真的 stdio MCP 伺服器，核准 persistentData，等到狀態 ready。 */
async function addMcpServer(
  client: ProtocolClient,
  scriptPath: string,
  name: string,
): Promise<McpServerInfo> {
  const added = await request<{ approvalId: string }>(client, "mcp.server.add", {
    name,
    transport: "stdio",
    command: process.execPath,
    args: [scriptPath],
    allowedHosts: [],
    persistentData: true,
    clientRequestId: `composed-mcp-${Math.random().toString(36).slice(2)}`,
  });
  await request(client, "approval.decide", {
    approvalId: added.approvalId,
    optionId: "approve",
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const servers = await listMcpServers(client);
    const ready = servers.find((server) => server.name === name && server.state === "ready");
    if (ready !== undefined) return ready;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `MCP 伺服器 ${name} 沒有在時限內就緒：${JSON.stringify(await listMcpServers(client))}`,
  );
}

/** 把 MCP 伺服器腳本寫到資料夾外，讓主機的沙盒能讀、測試能重複使用。 */
async function writeMcpScript(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cardiary-composed-mcp-"));
  tempDirs.push(dir);
  const path = join(dir, "server.cjs");
  await writeFile(path, MCP_SERVER_SCRIPT, "utf8");
  return path;
}

/** 遞迴列出資料夾裡的檔案（含 -wal／-shm），回傳相對於 root 的路徑。 */
async function walkFiles(root: string, prefix = ""): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(join(root, prefix), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const relative = prefix === "" ? entry.name : join(prefix, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await walkFiles(root, relative)));
      continue;
    }
    found.push(relative);
  }
  return found;
}

/** 整個資料夾找不到這段文字；找到時回傳檔案路徑，找不到回 null。 */
async function findInFolder(root: string, needle: string): Promise<string | null> {
  const expected = Buffer.from(needle, "utf8");
  for (const relative of await walkFiles(root)) {
    const content = await readFile(join(root, relative)).catch(() => null);
    if (content === null) continue;
    if (content.includes(expected)) return relative;
  }
  return null;
}

/** 遞迴列出樹狀結構（檔案與目錄都算），用來比較資料夾內外的增減。 */
async function listTree(root: string, prefix = ""): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(join(root, prefix), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const relative = prefix === "" ? entry.name : join(prefix, entry.name);
    found.push(relative);
    if (entry.isDirectory()) found.push(...(await listTree(root, relative)));
  }
  return found;
}

async function listAgents(client: ProtocolClient): Promise<readonly Record<string, unknown>[]> {
  const payload = await request<{ agents: Record<string, unknown>[] }>(client, "agent.list", {});
  return payload.agents;
}

async function usageCategories(client: ProtocolClient): Promise<string[]> {
  const payload = await request<{ usage: Array<{ category: string }> }>(
    client,
    "storage.usage",
    {},
  );
  return payload.usage.map((item) => item.category);
}

/** 等一個非同步條件成立；`waitUntil` 只收同步條件，這裡需要重讀磁碟。 */
async function eventually(check: () => Promise<boolean>, ms = 15_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("條件等待逾時");
}

describe.skipIf(!darwin)("第 13 章組合驗收（MCP 與外部代理正常配置）", () => {
  it(
    "任務跑完與重啟後暫存區乾淨，清理只動 tmp，代理紀錄與 MCP 都還在",
    async () => {
      const agent = await fakeAgentEnv();
      const script = await writeMcpScript();
      const first = await boot({ env: agent.env });
      const folder = first.service.folder;
      const server = await addMcpServer(first.client, script, "組合驗收 MCP");
      expect(server.persistentData?.allowed).toBe(true);

      // MCP 真的跑起來了：伺服器行程在自己的工作目錄留下記號。
      const mcpRan = join(folder.path, "tmp", "mcp", server.serverId, "mcp-ran.txt");
      await eventually(async () => existsSync(mcpRan));
      expect(await readFile(mcpRan, "utf8")).toContain("MCP-RAN");

      const agentSessionId = await runAgentToCompletion(first.client, agent.workingDirectory);
      expect(existsSync(join(folder.path, "cache", "agents", agentSessionId, "session.json"))).toBe(
        true,
      );
      // 代理任務結束就清掉自己的暫存目錄，不等主機重啟。
      await eventually(async () => !existsSync(join(folder.path, "tmp", "agents", agentSessionId)));
      expect(await readdir(join(folder.path, "tmp", "agents")).catch(() => [])).toEqual([]);

      // 模擬前一次執行留下的殘留：只有主機啟動的清理會把它收掉。
      await mkdir(join(folder.path, "tmp", "agents", "stale-session"), { recursive: true });
      await writeFile(
        join(folder.path, "tmp", "agents", "stale-session", "session.json"),
        "{}",
        "utf8",
      );
      await writeFile(join(folder.path, "tmp", "leftover.txt"), "殘留", "utf8");
      await shutdown(first);

      const second = await boot({ folder });
      // 核准綁定跨重啟仍相符：伺服器自動重連，授權的資料目錄也還在。
      const restartedServer = await waitForMcpReady(second.client, server.serverId);
      expect(restartedServer).toMatchObject({
        enabled: true,
        persistentData: { allowed: true },
      });
      expect(await listMcpServers(second.client)).toHaveLength(1);

      // 重啟後暫存區只剩執行中的 MCP 自己的工作目錄；上一次留下的殘留與
      // 代理暫存都由啟動清理收掉。
      await eventually(async () => !existsSync(join(folder.path, "tmp", "leftover.txt")));
      expect(await readdir(join(folder.path, "tmp", "agents")).catch(() => [])).toEqual([]);
      const tmpTop = await readdir(join(folder.path, "tmp"));
      expect(tmpTop).toEqual(["mcp"]);

      // 清理不動快取：代理紀錄讀得回來，MCP 重新連上並再次跑起來。
      const agents = await listAgents(second.client);
      const completedAgent = agents.find((record) => record["agentSessionId"] === agentSessionId);
      // 協定的 AgentStatus 沒有 completed；完成的代理以 stopped 呈現，結果
      // 寫在 message。兩者一起驗，才不會把「使用者停止」也當成完成。
      expect(completedAgent).toMatchObject({
        status: "stopped",
        message: "代理完成任務",
      });
      await eventually(async () => existsSync(mcpRan));
      expect(await readFile(mcpRan, "utf8")).toContain("MCP-RAN");
    },
    TEST_TIMEOUT,
  );

  it(
    "刪除對話後整個資料夾找不到合成內容，MCP 正本與代理快取不受影響",
    async () => {
      const agent = await fakeAgentEnv();
      const script = await writeMcpScript();
      const booted = await boot({ env: agent.env });
      const folder = booted.service.folder;
      const server = await addMcpServer(booted.client, script, "刪除驗收 MCP");
      const persistentDir = join(folder.path, "modules", "mcp", server.serverId);
      // 伺服器自己有權寫入的正本（工具呼叫由 MCP 沙盒 e2e 驗證，這裡直接放檔案）。
      await writeFile(join(persistentDir, "keep.txt"), "正本保留", "utf8");
      const agentSessionId = await runAgentToCompletion(booted.client, agent.workingDirectory);

      const marker = `COMPOSED-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const created = await request<{ session: { id: string } }>(booted.client, "session.create", {
        title: "組合驗收對話",
        clientRequestId: `composed-session-${Math.random().toString(36).slice(2)}`,
      });
      const sessionId = created.session.id;
      await request(booted.client, "session.subscribe", { sessionId });
      await request(booted.client, "session.send_message", {
        sessionId,
        text: `${marker} 的使用者訊息`,
        delivery: "queue",
      });
      await booted.client.waitForEvent("stream.message_completed", 30_000);
      const card = await request<{ card: { cardId: string } }>(booted.client, "card.create", {
        kind: "note",
        title: "組合驗收卡片",
        body: `${marker} 的卡片內容`,
        clientRequestId: `composed-card-${Math.random().toString(36).slice(2)}`,
      });
      await request(booted.client, "card.get", { cardId: card.card.cardId, sessionId });
      expect(await findInFolder(folder.path, marker)).not.toBeNull();

      const preview = await request<{ exclusiveCards: number }>(
        booted.client,
        "session.deletion_preview",
        { sessionId },
      );
      expect(preview.exclusiveCards).toBe(1);
      await request(booted.client, "session.delete", {
        sessionId,
        clientRequestId: `composed-delete-${Math.random().toString(36).slice(2)}`,
      });

      // 含 -wal／-shm 的整個資料夾都找不到對話與卡片的內容。
      expect(await findInFolder(folder.path, marker)).toBeNull();
      // 正本與快取不受對話刪除影響。
      expect(await readFile(join(persistentDir, "keep.txt"), "utf8")).toBe("正本保留");
      expect(existsSync(join(folder.path, "cache", "agents", agentSessionId, "session.json"))).toBe(
        true,
      );

      // 重啟後仍然查不到，MCP 正本與代理紀錄也都還在。
      await shutdown(booted);
      const restarted = await boot({ folder, env: agent.env });
      const restartedServer = await waitForMcpReady(restarted.client, server.serverId);
      expect(restartedServer).toMatchObject({
        enabled: true,
        persistentData: { allowed: true },
      });
      expect(await findInFolder(folder.path, marker)).toBeNull();
      expect(await readFile(join(persistentDir, "keep.txt"), "utf8")).toBe("正本保留");
      expect(await listAgents(restarted.client)).toHaveLength(1);
    },
    TEST_TIMEOUT,
  );

  it(
    "整個快取區刪掉後重啟：服務可用、正本讀得回來、索引重建、MCP 重新連上",
    async () => {
      const agent = await fakeAgentEnv();
      const script = await writeMcpScript();
      const first = await boot({ env: agent.env });
      const folder = first.service.folder;
      const server = await addMcpServer(first.client, script, "快取重建 MCP");
      const persistentDir = join(folder.path, "modules", "mcp", server.serverId);
      await writeFile(join(persistentDir, "keep.txt"), "正本保留", "utf8");
      const agentSessionId = await runAgentToCompletion(first.client, agent.workingDirectory);

      const created = await request<{ session: { id: string } }>(first.client, "session.create", {
        title: "快取重建對話",
        clientRequestId: `composed-cache-session-${Math.random().toString(36).slice(2)}`,
      });
      const sessionId = created.session.id;
      const card = await request<{ card: { cardId: string } }>(first.client, "card.create", {
        kind: "note",
        title: "快取重建卡片",
        body: "快取刪掉之後仍要讀得到",
        clientRequestId: `composed-cache-card-${Math.random().toString(36).slice(2)}`,
      });

      await shutdown(first);

      // 整個快取區刪掉，不是只刪索引檔。
      await rm(join(folder.path, "cache"), { recursive: true, force: true });
      await expect(stat(join(folder.path, "cache"))).rejects.toMatchObject({ code: "ENOENT" });

      const second = await boot({ folder, env: agent.env });

      // 服務回到可用：七類用量、資料讀得回來。
      expect(await usageCategories(second.client)).toEqual([
        "cards",
        "assets",
        "cache",
        "state",
        "logs",
        "tmp",
        "shellState",
      ]);
      const sessions = await request<{ sessions: Array<{ id: string }> }>(
        second.client,
        "session.list",
        { limit: 10 },
      );
      expect(sessions.sessions.map((session) => session.id)).toContain(sessionId);
      const readBack = await request<{ card: { body: string } }>(second.client, "card.get", {
        cardId: card.card.cardId,
        sessionId,
      });
      expect(readBack.card.body).toBe("快取刪掉之後仍要讀得到");

      // 快取目錄與索引由儲存層重建；正本不受影響。
      expect(existsSync(join(folder.path, "cache", "index.sqlite"))).toBe(true);
      expect((await stat(join(folder.path, "cache", "index.sqlite"))).size).toBeGreaterThan(0);
      expect(await readFile(join(persistentDir, "keep.txt"), "utf8")).toBe("正本保留");

      // MCP 伺服器連線重建；代理工作階段屬於快取，清掉後從新工作階段開始。
      const restartedServer = await waitForMcpReady(second.client, server.serverId);
      expect(restartedServer).toMatchObject({
        enabled: true,
        persistentData: { allowed: true },
      });
      expect(await listMcpServers(second.client)).toHaveLength(1);
      expect(await listAgents(second.client)).toEqual([]);
      expect(existsSync(join(folder.path, "cache", "agents", agentSessionId))).toBe(false);
    },
    TEST_TIMEOUT,
  );

  it(
    "MCP 與外部代理都跑過一輪，資料夾外沒有新增任何檔案",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "cardiary-composed-root-"));
      tempDirs.push(root);
      const path = join(root, "Cardiary");
      await mkdir(path);
      const folder: TestFolder = { path, folderId: "" };
      const agent = await fakeAgentEnv();
      const script = await writeMcpScript();
      const before = await listTree(root);

      const booted = await boot({ folder, env: agent.env, initializeFolder: true });
      const server = await addMcpServer(booted.client, script, "邊界驗收 MCP");
      await runAgentToCompletion(booted.client, agent.workingDirectory);
      await request(booted.client, "card.create", {
        kind: "note",
        title: "邊界驗收卡片",
        body: "資料夾外的寫入要為零",
        clientRequestId: `composed-boundary-${Math.random().toString(36).slice(2)}`,
      });

      const during = await listTree(root);
      const added = during.filter((entry) => !before.includes(entry));
      const outside = added.filter(
        (entry) => entry !== "Cardiary" && !entry.startsWith("Cardiary/"),
      );
      expect(outside).toEqual([]);
      expect(existsSync(join(folder.path, "modules", "mcp", server.serverId))).toBe(true);
    },
    TEST_TIMEOUT,
  );
});
