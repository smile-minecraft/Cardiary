import { readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  connectAndHello,
  spawnService,
  type ProtocolClient,
  type SpawnedService,
} from "../test/support.js";

/**
 * 排程任務在 System One 委派類別全開時，仍然不能提高權限（工作 work-714d0eb7，
 * 威脅清單 docs/design/m5.md 第 3.4 節與「排程與子代理在各權限模式下」）。
 *
 * 人在 Mac 上把四個可委派類別都打開、路徑涵蓋整個資料夾，排程的背景回合：
 * - 寫權限正本：硬規則先擋，不建立審批，檔案與權限模式不變。
 * - 執行非唯讀指令：不在任何委派類別裡，退回人工審批，核准前不執行。
 *
 * 全部允許下的排程任務在 `m5-bypass.test.ts`。子代理目前沒有任何協定訊息或代理工具
 * 能建立（見本檔最後一組），所以「子代理在各權限模式下」沒有可走的路徑。
 */

const PERMISSIONS_FILE = "state/agent-permissions.json";

const running: SpawnedService[] = [];
const clients: ProtocolClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => undefined);
  for (const service of running.splice(0)) await service.stop().catch(() => undefined);
});

async function boot(
  scripts: readonly (readonly Record<string, unknown>[])[],
): Promise<{ service: SpawnedService; client: ProtocolClient }> {
  const service = await spawnService({ scripts });
  running.push(service);
  const client = await connectAndHello(service);
  clients.push(client);
  await reply(client, "system.subscribe", {});
  return { service, client };
}

async function reply(
  client: ProtocolClient,
  type: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const frame = await client.waitForReply(client.request(type, payload), 10_000);
  expect(frame.kind, `${type}: ${JSON.stringify(frame)}`).toBe("response");
  return frame;
}

async function modes(client: ProtocolClient): Promise<Record<string, unknown>> {
  return (await reply(client, "system.permissions.get", {})).payload as Record<string, unknown>;
}

/** 人把四個可委派類別全部打開；路徑類別涵蓋整個資料夾。 */
async function enableAllCategories(client: ProtocolClient, folder: string): Promise<void> {
  const available = (await modes(client)).availableCategories as string[];
  expect(available.length).toBeGreaterThan(0);
  for (const category of available) {
    const withPath = await client.waitForReply(
      client.request("system.permissions.set_category", {
        category,
        enabled: true,
        paths: [folder],
        clientRequestId: `cat-${category}`,
      }),
      10_000,
    );
    if (withPath.kind === "response") continue;
    // 非路徑類別不能帶路徑。
    await reply(client, "system.permissions.set_category", {
      category,
      enabled: true,
      paths: [],
      clientRequestId: `cat-${category}-nopath`,
    });
  }
  const enabled = ((await modes(client)).categories as Array<{ category: string }>).map(
    (entry) => entry.category,
  );
  expect([...enabled].sort()).toEqual([...available].sort());
}

async function scheduleNow(client: ProtocolClient, name: string, prompt: string): Promise<void> {
  await reply(client, "module.scheduler.create", {
    data: {
      name,
      kind: "once",
      spec: { at: "2020-01-01T00:00:00.000Z" },
      task: { type: "agent", prompt },
    },
  });
}

interface SessionSummary {
  readonly id: string;
  readonly title?: string;
  readonly status?: string;
  readonly messageCount?: number;
}

async function backgroundSession(
  client: ProtocolClient,
  name: string,
  done: (session: SessionSummary) => boolean,
): Promise<SessionSummary> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const listed = await reply(client, "session.list", {});
    const sessions = (listed.payload as { sessions: SessionSummary[] }).sessions;
    const found = sessions.find((session) => session.title === `排程：${name}`);
    if (found !== undefined && done(found)) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`等不到排程「${name}」的背景回合`);
}

describe("排程任務在 System One 類別全開時", { timeout: 60_000 }, () => {
  it("寫權限正本被硬規則擋下，不建立審批，檔案與權限模式不變", async () => {
    const { service, client } = await boot([
      [{ kind: "tool", toolName: "write_file", input: { path: PERMISSIONS_FILE, content: "{}" } }],
    ]);
    await enableAllCategories(client, service.folder.path);
    const before = await readFile(join(service.folder.path, PERMISSIONS_FILE), "utf8");
    const modesBefore = await modes(client);

    await scheduleNow(client, "System One 寫正本", "改權限檔");
    await backgroundSession(
      client,
      "System One 寫正本",
      (session) => (session.messageCount ?? 0) > 0 && session.status !== "running",
    );

    expect(client.frames.filter((frame) => frame.type === "approval.requested")).toHaveLength(0);
    expect(await readFile(join(service.folder.path, PERMISSIONS_FILE), "utf8")).toBe(before);
    expect(await modes(client)).toEqual(modesBefore);
  });

  it("非唯讀指令不在任何委派類別裡，退回人工審批，核准前不執行", async () => {
    const { service, client } = await boot([
      [
        {
          kind: "tool",
          toolName: "run_command",
          input: { command: "touch escaped-by-system-one.txt" },
        },
      ],
    ]);
    await enableAllCategories(client, service.folder.path);

    await scheduleNow(client, "System One 指令", "執行指令");
    const session = await backgroundSession(client, "System One 指令", () => true);
    // 背景回合沒有人訂閱；訂閱時的快照會帶出它正在等的審批。
    let pending: { scope?: { target?: string } } | undefined;
    const deadline = Date.now() + 15_000;
    while (pending === undefined && Date.now() < deadline) {
      const subscribed = await reply(client, "session.subscribe", { sessionId: session.id });
      pending = (subscribed.payload as { snapshot?: { pendingApproval?: typeof pending } }).snapshot
        ?.pendingApproval;
      if (pending === undefined) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(pending?.scope?.target).toBe("run_command");

    await expect(stat(join(service.folder.path, "escaped-by-system-one.txt"))).rejects.toThrow();
    // 委派沒有替它消耗任何自動放行次數。
    const audit = await readFile(
      join(service.folder.path, "state", "agent-audit.jsonl"),
      "utf8",
    ).catch(() => "");
    expect(audit).not.toContain("run_command");
  });
});

describe("子代理沒有可建立的入口", () => {
  it("協定 schema 沒有建立子代理的請求訊息", () => {
    // 若之後要讓代理或客戶端建立子代理，System One 的每場對話 20 次上限目前以
    // request.conversationId 計算，子代理有自己的對話 id，會各自拿到 20 次；
    // 屆時要改成以根對話計算，並在這裡補負面測試。
    const schema = readFileSync(
      join(import.meta.dirname, "..", "..", "protocol", "schema", "protocol.schema.json"),
      "utf8",
    );
    const types = [...schema.matchAll(/"const": "([a-z_.]+)"/g)].map((match) => match[1]!);
    expect(types.length).toBeGreaterThan(50);
    expect(types.filter((type) => type.includes("subagent"))).toEqual([]);
  });
});
