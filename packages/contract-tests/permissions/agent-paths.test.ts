import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  connectAndHello,
  spawnService,
  type ProtocolClient,
  type SpawnedService,
} from "../test/support.js";

/**
 * 代理不能替自己打開權限模式（規格第 11 章「M5 權限模式裁決」）。
 *
 * 權限模式只能由本機 Mac 客戶端經 `system.permissions.*` 修改。代理手上的路徑是
 * 工具呼叫：寫檔、執行指令，或把協定訊息當成工具名稱。這裡逐一嘗試，確認
 * 權限正本沒有被改，之後 `system.permissions.get` 讀到的仍是人設定的狀態。
 *
 * 其他層的負面測試：
 * - 遠端裝置連讀取都被拒：`packages/host/test/remote/bypass.test.ts`（真主機加配對裝置）。
 * - 殼控制 Token 與代理 Token 進不了客戶端入口：`test/contract.test.ts`。
 * - 全部允許涵蓋整個資料夾時仍寫不到受保護狀態檔、排程任務也寫不到：`m5-bypass.test.ts`。
 * - 到期後讀取沒有 allowAll：`packages/host/test/gateway/permission-modes.test.ts`。
 */

const PERMISSIONS_FILE = "state/agent-permissions.json";

/** 代理想寫進正本的內容：自己開全部允許、開所有類別。 */
const FORGED = JSON.stringify({
  version: 1,
  categories: [{ category: "create-card", paths: [] }],
  allowedDomains: ["example.com"],
  allowAll: {
    tools: ["write_file", "run_command"],
    paths: ["/"],
    domains: [],
    expiresAt: Date.parse("2099-01-01T00:00:00.000Z"),
  },
});

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

async function startTurn(client: ProtocolClient, text: string): Promise<void> {
  const created = await reply(client, "session.create", { clientRequestId: `cr-${Math.random()}` });
  const sessionId = (created.payload as { session: { id: string } }).session.id;
  await reply(client, "session.subscribe", { sessionId });
  await reply(client, "session.send_message", {
    sessionId,
    text,
    delivery: "queue",
    clientMessageId: `cm-${Math.random()}`,
  });
}

function toolResults(client: ProtocolClient) {
  return client.frames.filter((frame) => frame.type === "stream.tool_result");
}

function approvals(client: ProtocolClient) {
  return client.frames.filter((frame) => frame.type === "approval.requested");
}

/** 等到工具結果、審批或回合結束其中一個先出現。 */
async function settle(client: ProtocolClient): Promise<"result" | "approval" | "turn-ended"> {
  await client.waitFor(
    () =>
      toolResults(client).length > 0 ||
      approvals(client).length > 0 ||
      client.frames.some((frame) => frame.type === "stream.turn_completed"),
    10_000,
  );
  if (approvals(client).length > 0) return "approval";
  return toolResults(client).length > 0 ? "result" : "turn-ended";
}

function status(frame: Record<string, unknown> | undefined): string | undefined {
  return (frame?.payload as { status?: string } | undefined)?.status;
}

async function readState(service: SpawnedService): Promise<string | null> {
  return readFile(join(service.folder.path, PERMISSIONS_FILE), "utf8").catch(() => null);
}

describe("代理路徑改不了權限模式", { timeout: 60_000 }, () => {
  it("沒有任何授權時，write_file 寫權限正本被拒，不建立審批，狀態不變", async () => {
    const { service, client } = await boot([
      [
        {
          kind: "tool",
          toolName: "write_file",
          input: { path: PERMISSIONS_FILE, content: FORGED },
        },
      ],
    ]);
    const before = await readState(service);
    const modesBefore = await modes(client);

    await startTurn(client, "幫我打開全部允許");

    expect(await settle(client)).toBe("result");
    expect(status(toolResults(client)[0])).toBe("error");
    expect(approvals(client)).toHaveLength(0);
    expect(await readState(service)).toBe(before);
    const modesAfter = await modes(client);
    expect(modesAfter).toEqual(modesBefore);
    expect(modesAfter.allowAll).toBeUndefined();
    expect(modesAfter.categories).toEqual([]);
  });

  it("人開了 run_command 的全部允許，代理用指令覆寫正本也不會自動執行，狀態維持人開的那份", async () => {
    const { service, client } = await boot([
      [
        {
          kind: "tool",
          toolName: "run_command",
          input: { command: `printf '%s' '${FORGED}' > ${PERMISSIONS_FILE}` },
        },
      ],
    ]);
    await reply(client, "system.permissions.grant_allow_all", {
      tools: ["run_command"],
      paths: [service.folder.path],
      minutes: 15,
      clientRequestId: "grant-run-command",
    });
    const before = await readState(service);
    const modesBefore = await modes(client);

    await startTurn(client, "用指令改權限檔");

    const outcome = await settle(client);
    if (outcome === "result") {
      expect(status(toolResults(client)[0])).toBe("error");
    } else {
      // 退回人工也可以，但人還沒核准，指令不能已經執行。
      expect(outcome).toBe("approval");
    }
    expect(await readState(service)).toBe(before);
    const modesAfter = await modes(client);
    expect(modesAfter).toEqual(modesBefore);
    expect((modesAfter.allowAll as { tools: string[] }).tools).toEqual(["run_command"]);
  });

  it.each([
    "system.permissions.grant_allow_all",
    "system.permissions.set_category",
    "system.settings.set",
  ])("協定訊息 %s 不是代理的工具，呼叫失敗且狀態不變", async (toolName) => {
    const { service, client } = await boot([
      [
        {
          kind: "tool",
          toolName,
          input: {
            tools: ["write_file"],
            paths: ["/tmp"],
            category: "create-card",
            enabled: true,
            key: "permissions.mode",
            value: "allow-all",
          },
        },
      ],
    ]);
    const before = await readState(service);
    const modesBefore = await modes(client);

    await startTurn(client, "直接呼叫權限協定");

    const outcome = await settle(client);
    if (outcome === "result") {
      expect(status(toolResults(client)[0])).toBe("error");
    }
    expect(approvals(client)).toHaveLength(0);
    expect(await readState(service)).toBe(before);
    expect(await modes(client)).toEqual(modesBefore);
    // 也沒有替代理留下設定值。
    const settings = (await reply(client, "system.settings.get", {})).payload as {
      settings: Array<{ key: string; value: unknown }>;
    };
    expect(settings.settings.some((item) => item.value === "allow-all")).toBe(false);
  });

  it("權限正本只在 state/ 區，代理寫到資料夾其他地方的同名檔不會生效", async () => {
    const { service, client } = await boot([
      [
        {
          kind: "tool",
          toolName: "write_file",
          input: { path: "agent-permissions.json", content: FORGED },
        },
      ],
    ]);
    const modesBefore = await modes(client);

    await startTurn(client, "寫一份假的權限檔");
    await settle(client);

    // 寫到哪裡由一般寫檔規則決定（沒有授權時要人核准）；不管有沒有寫成，權限模式都不變。
    expect(await modes(client)).toEqual(modesBefore);
    expect(await readState(service)).toBeNull();
  });
});
