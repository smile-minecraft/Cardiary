import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  connectAndHello,
  spawnService,
  type ProtocolClient,
  type SpawnedService,
} from "../test/support.js";

/**
 * M5 整合驗收的跨模組繞過嘗試（工作 work-714d0eb7，威脅清單 docs/design/m5.md 第 3 節）。
 *
 * 單一模組的負面測試都已存在；這裡把「人開了全部允許」和其他控制面組合起來，
 * 確認代理仍然不能提高權限：
 * - 全部允許範圍內的寫檔確實自動放行（正向對照，證明全部允許真的生效）。
 * - 範圍涵蓋整個資料夾時，寫權限模式正本、MCP 設定正本仍被拒絕。
 * - 全部允許不涵蓋非唯讀指令：`run_command` 在範圍內仍要人核准，核准前不執行。
 * - 範圍外的寫檔仍要人核准。
 * - 緊急全部暫停之後，原本範圍內的寫檔回到要人核准。
 * - 排程任務（背景回合）在全部允許下也碰不到受保護的狀態檔。
 */

const running: SpawnedService[] = [];
const clients: ProtocolClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => undefined);
  for (const service of running.splice(0)) await service.stop().catch(() => undefined);
});

async function boot(
  scripts: readonly (readonly Record<string, unknown>[])[],
  options: { readonly control?: boolean } = {},
): Promise<{ service: SpawnedService; client: ProtocolClient }> {
  const service = await spawnService({
    scripts,
    ...(options.control === true ? { control: true } : {}),
  });
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

async function grantAllowAll(
  client: ProtocolClient,
  tools: string[],
  paths: string[],
): Promise<void> {
  await reply(client, "system.permissions.grant_allow_all", {
    tools,
    paths,
    clientRequestId: `grant-${Math.random()}`,
  });
}

async function startTurn(client: ProtocolClient, text: string): Promise<string> {
  const created = await reply(client, "session.create", { clientRequestId: `cr-${Math.random()}` });
  const sessionId = (created.payload as { session: { id: string } }).session.id;
  await reply(client, "session.subscribe", { sessionId });
  await reply(client, "session.send_message", {
    sessionId,
    text,
    delivery: "queue",
    clientMessageId: `cm-${Math.random()}`,
  });
  return sessionId;
}

function toolResults(client: ProtocolClient) {
  return client.frames.filter((frame) => frame.type === "stream.tool_result");
}

function approvals(client: ProtocolClient) {
  return client.frames.filter((frame) => frame.type === "approval.requested");
}

/** 等到工具結果或審批其中一個先出現。 */
async function firstOutcome(client: ProtocolClient): Promise<"result" | "approval"> {
  await client.waitFor(
    () => toolResults(client).length > 0 || approvals(client).length > 0,
    10_000,
  );
  return approvals(client).length > 0 ? "approval" : "result";
}

function status(frame: Record<string, unknown> | undefined): string | undefined {
  return (frame?.payload as { status?: string } | undefined)?.status;
}

describe("M5 跨模組繞過嘗試（全部允許開啟時）", { timeout: 60_000 }, () => {
  it("正向對照：全部允許範圍內的寫檔自動放行，不建立審批", async () => {
    const { service, client } = await boot([
      [{ kind: "tool", toolName: "write_file", input: { path: "work/ok.md", content: "允許" } }],
    ]);
    await mkdir(join(service.folder.path, "work"), { recursive: true });
    await grantAllowAll(client, ["write_file"], [join(service.folder.path, "work")]);
    await startTurn(client, "寫檔");
    expect(await firstOutcome(client)).toBe("result");
    expect(status(toolResults(client)[0])).toBe("ok");
    expect(approvals(client)).toHaveLength(0);
    expect(await readFile(join(service.folder.path, "work", "ok.md"), "utf8")).toBe("允許");
  });

  it.each(["state/agent-permissions.json", "state/mcp-servers.json"])(
    "範圍涵蓋整個資料夾時，寫受保護狀態檔 %s 仍被拒絕，不建立審批、檔案不變",
    async (target) => {
      const { service, client } = await boot([
        [{ kind: "tool", toolName: "write_file", input: { path: target, content: "{}" } }],
      ]);
      await grantAllowAll(client, ["write_file"], [service.folder.path]);
      const before = await readFile(join(service.folder.path, target), "utf8").catch(() => null);
      await startTurn(client, "改權限檔");
      expect(await firstOutcome(client)).toBe("result");
      expect(status(toolResults(client)[0])).toBe("error");
      expect(approvals(client)).toHaveLength(0);
      const after = await readFile(join(service.folder.path, target), "utf8").catch(() => null);
      expect(after).toBe(before);
      // 權限模式本身沒有被改：全部允許仍是人開的那一份。
      const modes = await reply(client, "system.permissions.get", {});
      expect((modes.payload as { allowAll?: { tools: string[] } }).allowAll?.tools).toEqual([
        "write_file",
      ]);
    },
  );

  it("全部允許不涵蓋非唯讀指令：範圍內的 run_command 仍要人核准，核准前不執行", async () => {
    const { service, client } = await boot([
      [
        {
          kind: "tool",
          toolName: "run_command",
          input: { command: "touch escaped-by-allow-all.txt" },
        },
      ],
    ]);
    await grantAllowAll(client, ["run_command"], [service.folder.path]);
    await startTurn(client, "執行指令");
    const outcome = await firstOutcome(client);
    if (outcome === "result") {
      expect(status(toolResults(client)[0])).toBe("error");
    } else {
      expect(approvals(client)).toHaveLength(1);
    }
    await expect(stat(join(service.folder.path, "escaped-by-allow-all.txt"))).rejects.toThrow();
  });

  it("範圍外的寫檔仍要人核准", async () => {
    const { service, client } = await boot([
      [
        {
          kind: "tool",
          toolName: "write_file",
          input: { path: "other/out.md", content: "範圍外" },
        },
      ],
    ]);
    await mkdir(join(service.folder.path, "work"), { recursive: true });
    await mkdir(join(service.folder.path, "other"), { recursive: true });
    await grantAllowAll(client, ["write_file"], [join(service.folder.path, "work")]);
    await startTurn(client, "寫範圍外");
    expect(await firstOutcome(client)).toBe("approval");
    await expect(stat(join(service.folder.path, "other", "out.md"))).rejects.toThrow();
  });

  it("全部允許只放行列出的工具：範圍內但沒列的工具仍要人核准", async () => {
    const { service, client } = await boot([
      [{ kind: "tool", toolName: "write_file", input: { path: "work/unlisted.md", content: "x" } }],
    ]);
    await mkdir(join(service.folder.path, "work"), { recursive: true });
    await grantAllowAll(client, ["read_file"], [join(service.folder.path, "work")]);
    await startTurn(client, "寫沒列的工具");
    expect(await firstOutcome(client)).toBe("approval");
  });

  it("緊急全部暫停之後，原本範圍內的寫檔回到要人核准", async () => {
    const { service, client } = await boot(
      [
        [
          {
            kind: "tool",
            toolName: "write_file",
            input: { path: "work/after-pause.md", content: "x" },
          },
        ],
      ],
      { control: true },
    );
    await mkdir(join(service.folder.path, "work"), { recursive: true });
    await grantAllowAll(client, ["write_file"], [join(service.folder.path, "work")]);
    await reply(client, "approval.pause_all", { reason: "契約測試" });
    // 比照殼：人在 Mac 上恢復之後才能開新的回合；恢復不會讓全部允許回來。
    const resumed = await service.controlRequest("control.resume", {});
    expect(resumed.ok, JSON.stringify(resumed)).toBe(true);
    await startTurn(client, "暫停後寫檔");
    expect(await firstOutcome(client)).toBe("approval");
    await expect(stat(join(service.folder.path, "work", "after-pause.md"))).rejects.toThrow();
  });

  it("排程任務在全部允許下也寫不到受保護的狀態檔", async () => {
    const { service, client } = await boot([
      [
        {
          kind: "tool",
          toolName: "write_file",
          input: { path: "state/agent-permissions.json", content: "{}" },
        },
      ],
    ]);
    await grantAllowAll(client, ["write_file"], [service.folder.path]);
    const before = await readFile(
      join(service.folder.path, "state", "agent-permissions.json"),
      "utf8",
    );
    await reply(client, "module.scheduler.create", {
      data: {
        name: "繞過測試排程",
        kind: "once",
        spec: { at: "2020-01-01T00:00:00.000Z" },
        task: { type: "agent", prompt: "改權限檔" },
      },
    });
    // 背景回合沒有被這個客戶端訂閱；等它的對話出現並結束，再檢查檔案。
    let finished = false;
    const deadline = Date.now() + 15_000;
    while (!finished && Date.now() < deadline) {
      const listed = await reply(client, "session.list", {});
      const sessions = (
        listed.payload as {
          sessions: Array<{ title?: string; status?: string; messageCount?: number }>;
        }
      ).sessions;
      const background = sessions.find((session) => session.title === "排程：繞過測試排程");
      finished =
        background !== undefined &&
        (background.messageCount ?? 0) > 0 &&
        background.status !== "running";
      if (!finished) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(finished, "排程的背景回合應該跑完").toBe(true);
    const after = await readFile(
      join(service.folder.path, "state", "agent-permissions.json"),
      "utf8",
    );
    expect(after).toBe(before);
    expect(JSON.parse(after).allowAll?.tools).toEqual(["write_file"]);
    // 暫存寫入也不能留下：受保護檔案旁邊沒有半寫檔。
    await writeFile(join(service.folder.path, "work-marker"), "ok");
  });
});
