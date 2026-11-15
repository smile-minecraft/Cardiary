import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  connectAndHello,
  spawnService,
  type ProtocolClient,
  type SpawnedService,
  type TestFolder,
} from "../test/support.js";

/**
 * 本機檔案與終端機的協定契約：對真的主機行程跑，不直接呼叫模組。
 *
 * 這一組刻意不用 `--demo`：只有模組自己的工具組會被釘選到新對話，
 * 權限閘道、「一律允許」的決定入口與白名單也都是產品組裝的那幾條路徑。
 * 預設的 `--engine fake` 只換掉模型；`CARDIARY_CONTRACT_ENGINE=pi` 會讓
 * 同一份測試對產品引擎再跑一次。
 *
 * 對話刪除與 30 天保留清理在協定上沒有入口（`session.delete` 仍是
 * schema-only），所以「白名單不隨對話消失」由 `packages/host/test`
 * 的儲存層測試負責；這裡驗的是跨行程重啟後仍然有效。
 */

const services: SpawnedService[] = [];
const clients: ProtocolClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) {
    await client.close().catch(() => undefined);
  }
  for (const service of services.splice(0)) {
    await service.stop().catch(() => undefined);
  }
});

interface Booted {
  readonly service: SpawnedService;
  readonly client: ProtocolClient;
}

async function boot(options: {
  readonly scripts: readonly (readonly Record<string, unknown>[])[];
  readonly folder?: TestFolder;
}): Promise<Booted> {
  const service = await spawnService({
    scripts: options.scripts,
    ...(options.folder === undefined ? {} : { folder: options.folder }),
  });
  services.push(service);
  const client = await connectAndHello(service);
  clients.push(client);
  return { service, client };
}

async function createSession(client: ProtocolClient): Promise<string> {
  const id = client.request("session.create", { clientRequestId: `cr-${Math.random()}` });
  const reply = await client.waitForReply(id);
  const sessionId = (reply.payload as { session: { id: string } }).session.id;
  const subscribe = client.request("session.subscribe", { sessionId });
  await client.waitForReply(subscribe);
  return sessionId;
}

async function send(client: ProtocolClient, sessionId: string, text: string): Promise<string> {
  const id = client.request("session.send_message", {
    sessionId,
    text,
    delivery: "queue",
    clientMessageId: `cm-${Math.random()}`,
  });
  const reply = await client.waitForReply(id);
  return (reply.payload as { turnId: string }).turnId;
}

/** 等到這個回合結束；不同引擎的失敗回合可能是 completed 或 interrupted。 */
async function waitForTurnEnd(client: ProtocolClient, turnId: string): Promise<void> {
  await client.waitFor(
    (frame) =>
      frame.type === "stream.turn_state" &&
      (frame.payload as { turnId?: string }).turnId === turnId &&
      ["completed", "failed", "interrupted"].includes(
        (frame.payload as { state?: string }).state ?? "",
      ),
    10_000,
  );
}

function approvalRequests(client: ProtocolClient) {
  return client.frames.filter((frame) => frame.type === "approval.requested");
}

function toolResults(client: ProtocolClient) {
  return client.frames.filter((frame) => frame.type === "stream.tool_result");
}

/** 等到第 `count` 個工具結果出現；同一回合可能有多個。 */
async function waitForToolResult(client: ProtocolClient, count = 1) {
  await client.waitFor(() => toolResults(client).length >= count, 10_000);
  const result = toolResults(client)[count - 1];
  if (result === undefined) {
    throw new Error(`等不到第 ${count} 個工具結果`);
  }
  return result;
}

async function decide(
  client: ProtocolClient,
  approvalId: string,
  optionId: "approve" | "deny" | "always",
): Promise<Record<string, unknown>> {
  const id = client.request("approval.decide", { approvalId, optionId });
  return client.waitForReply(id);
}

describe("本機檔案與終端機的權限契約", () => {
  it("讀工作目錄的檔案自動放行，不建立審批", async () => {
    const { service, client } = await boot({
      scripts: [[{ kind: "tool", toolName: "read_file", input: { path: "notes.md" } }]],
    });
    await writeFile(join(service.folder.path, "notes.md"), "筆記內容\n");
    const sessionId = await createSession(client);
    await send(client, sessionId, "讀檔");

    const result = await waitForToolResult(client);
    expect((result.payload as { status: string }).status).toBe("ok");
    expect(approvalRequests(client)).toHaveLength(0);
  });

  it("寫檔建立審批；核准後才寫入", async () => {
    const { service, client } = await boot({
      scripts: [
        [
          {
            kind: "tool",
            toolName: "write_file",
            input: { path: "approved.md", content: "核准後寫入" },
          },
        ],
      ],
    });
    const sessionId = await createSession(client);
    await send(client, sessionId, "寫檔");

    const requested = await client.waitForEvent("approval.requested", 10_000);
    const payload = requested.payload as {
      approvalId: string;
      options: Array<{ id: string; effect: string }>;
    };
    expect(payload.options.map((option) => option.effect)).toContain("approve_always");

    const reply = await decide(client, payload.approvalId, "approve");
    const decided = reply.payload as { effect: string; persisted: boolean };
    expect(decided.effect).toBe("approve");
    expect(decided.persisted).toBe(true);

    const result = await waitForToolResult(client);
    expect((result.payload as { status: string }).status).toBe("ok");
    expect(await readFile(join(service.folder.path, "approved.md"), "utf8")).toBe("核准後寫入");
  });

  it("核准並一律允許後，下一個對話的寫檔不再詢問", async () => {
    const { service, client } = await boot({
      scripts: [
        [
          {
            kind: "tool",
            toolName: "write_file",
            input: { path: "first.md", content: "第一次" },
          },
        ],
        [
          {
            kind: "tool",
            toolName: "write_file",
            input: { path: "second.md", content: "第二次" },
          },
        ],
      ],
    });
    const firstSession = await createSession(client);
    await send(client, firstSession, "第一次");

    const requested = await client.waitForEvent("approval.requested", 10_000);
    const approvalId = (requested.payload as { approvalId: string }).approvalId;
    const reply = await decide(client, approvalId, "always");
    const decided = reply.payload as { effect: string; persisted: boolean };
    expect(decided.effect).toBe("approve_always");
    expect(decided.persisted).toBe(true);
    await client.waitForEvent("approval.decided", 10_000);

    const secondSession = await createSession(client);
    await send(client, secondSession, "第二次");
    const second = await waitForToolResult(client, 2);
    expect((second.payload as { status: string }).status).toBe("ok");
    expect(approvalRequests(client)).toHaveLength(1);
    expect(await readFile(join(service.folder.path, "second.md"), "utf8")).toBe("第二次");
  });

  it("一律允許的決定跨主機重啟仍然有效", async () => {
    const first = await boot({
      scripts: [
        [
          {
            kind: "tool",
            toolName: "write_file",
            input: { path: "granted.md", content: "白名單" },
          },
        ],
      ],
    });
    const firstSession = await createSession(first.client);
    await send(first.client, firstSession, "建立白名單");
    const requested = await first.client.waitForEvent("approval.requested", 10_000);
    await decide(first.client, (requested.payload as { approvalId: string }).approvalId, "always");
    await waitForToolResult(first.client);

    await first.client.close().catch(() => undefined);
    await first.service.stop();

    const second = await boot({
      folder: first.service.folder,
      scripts: [
        [
          {
            kind: "tool",
            toolName: "write_file",
            input: { path: "after-restart.md", content: "重啟後" },
          },
        ],
      ],
    });
    const sessionId = await createSession(second.client);
    await send(second.client, sessionId, "重啟後寫檔");
    const result = await waitForToolResult(second.client);
    expect((result.payload as { status: string }).status).toBe("ok");
    expect(approvalRequests(second.client)).toHaveLength(0);
    expect(await readFile(join(first.service.folder.path, "after-restart.md"), "utf8")).toBe(
      "重啟後",
    );
  });

  it("代理沒有寫白名單的路徑：未知工具失敗，重啟後寫檔仍要審批", async () => {
    const first = await boot({
      scripts: [
        [
          {
            kind: "tool",
            toolName: "grant_allowlist",
            input: { toolName: "write_file", scopeKey: "*" },
          },
        ],
      ],
    });
    const refusedSession = await createSession(first.client);
    const refusedTurn = await send(first.client, refusedSession, "嘗試寫白名單");
    const settled = await first.client.waitFor(
      (frame) =>
        frame.type === "approval.requested" ||
        (frame.type === "stream.turn_state" &&
          (frame.payload as { turnId?: string }).turnId === refusedTurn &&
          ["completed", "failed", "interrupted"].includes(
            (frame.payload as { state?: string }).state ?? "",
          )),
      10_000,
    );
    // 產品引擎會先為未知工具建立審批；拒絕之後回合才會結束。
    if (settled.type === "approval.requested") {
      const approvalId = (settled.payload as { approvalId: string }).approvalId;
      await decide(first.client, approvalId, "deny").catch(() => undefined);
      await waitForTurnEnd(first.client, refusedTurn);
    }
    // 未知工具不能成功。
    expect(
      toolResults(first.client).some(
        (frame) => (frame.payload as { status?: string }).status === "ok",
      ),
    ).toBe(false);

    await first.client.close().catch(() => undefined);
    await first.service.stop();

    const second = await boot({
      folder: first.service.folder,
      scripts: [
        [
          {
            kind: "tool",
            toolName: "write_file",
            input: { path: "a.md", content: "a" },
          },
        ],
      ],
    });
    // 用不存在的審批送「一律允許」也不能留下授權。
    const bogus = await decide(second.client, "apr_does_not_exist", "always");
    expect(bogus.kind).toBe("error");
    expect(bogus.code).toBe("not_found");

    const sessionId = await createSession(second.client);
    await send(second.client, sessionId, "寫 a");
    const requested = await second.client.waitForEvent("approval.requested", 10_000);
    await decide(
      second.client,
      (requested.payload as { approvalId: string }).approvalId,
      "approve",
    );
    await second.client.waitFor(
      (frame) =>
        frame.type === "stream.tool_result" &&
        (frame.payload as { status?: string }).status === "ok",
      10_000,
    );
    expect(await readFile(join(first.service.folder.path, "a.md"), "utf8")).toBe("a");
  }, 30_000);
});
