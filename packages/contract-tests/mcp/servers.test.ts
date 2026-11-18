import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  connectAndHello,
  spawnService,
  type ProtocolClient,
  type SpawnedService,
} from "../test/support.js";

/**
 * MCP 協定契約：對真的主机行程跑。
 *
 * 新增伺服器走得過人工审批才會寫入正本；這裡用一個立即結束的指令，
 * 只驗證審批與狀態，不依賴伺服器顺利啟動。
 */
let service: SpawnedService;
let client: ProtocolClient;

async function listServers(): Promise<Record<string, unknown>[]> {
  const id = client.request("mcp.servers.list", {});
  const reply = await client.waitForReply(id);
  const payload = reply.payload as { servers: Record<string, unknown>[] };
  return payload.servers;
}

beforeAll(async () => {
  service = await spawnService();
  client = await connectAndHello(service);
  const subscribe = client.request("system.subscribe", {});
  await client.waitForReply(subscribe);
}, 20_000);

afterAll(async () => {
  await client?.close().catch(() => undefined);
  await service?.stop().catch(() => undefined);
});

describe("MCP 伺服器審批契約", () => {
  it("新增建立審批，核准前清單是空的，核准後才出現伺服器", async () => {
    const addId = client.request("mcp.server.add", {
      name: "契約測試伺服器",
      transport: "stdio",
      command: "/usr/bin/true",
      allowedHosts: [],
    });
    const addReply = await client.waitForReply(addId);
    const approvalId = (addReply.payload as { approvalId: string }).approvalId;
    expect(approvalId).toBeTruthy();

    // 核准前客戶端要在 system 串流上看到 approval.requested；MCP 清單是空的。
    const requested = await client.waitFor(
      (frame) =>
        frame.kind === "event" &&
        frame.type === "approval.requested" &&
        (frame.payload as { approvalId?: string }).approvalId === approvalId,
      5000,
    );
    expect((requested.payload as { scope?: { kind?: string } }).scope?.kind).toBe(
      "settings_change",
    );
    expect(await listServers()).toEqual([]);

    await client.waitForReply(
      client.request("approval.decide", { approvalId, optionId: "approve" }),
    );
    const decided = await client.waitFor(
      (frame) =>
        frame.kind === "event" &&
        frame.type === "approval.decided" &&
        (frame.payload as { approvalId?: string }).approvalId === approvalId,
      5000,
    );
    expect(decided.payload).toMatchObject({ sessionId: "", effect: "approve" });

    let servers: Record<string, unknown>[] = [];
    for (let attempt = 0; attempt < 50 && servers.length === 0; attempt += 1) {
      servers = await listServers();
      if (servers.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({ name: "契約測試伺服器", enabled: true });

    const removeId = client.request("mcp.server.remove", {
      serverId: servers[0]!.serverId,
    });
    await client.waitForReply(removeId);
    expect(await listServers()).toEqual([]);
  }, 20_000);

  it("新增請求的 URL 含使用者資訊時，協定層直接拒絕且不建立審批", async () => {
    const approvalsBefore = client.frames.filter(
      (frame) => frame.kind === "event" && frame.type === "approval.requested",
    ).length;

    const addId = client.request("mcp.server.add", {
      name: "帶帳密的伺服器",
      transport: "http",
      url: "https://user:pw@api.example.com/mcp",
      allowedHosts: ["api.example.com"],
    });
    const reply = await client.waitForReply(addId);

    expect(reply.kind).toBe("error");
    expect(reply.code).toBe("invalid_message");
    expect(String(reply.message)).toContain("url 不能含使用者資訊");

    const approvalsAfter = client.frames.filter(
      (frame) => frame.kind === "event" && frame.type === "approval.requested",
    ).length;
    expect(approvalsAfter, "被拒絕的請求不應建立審批").toBe(approvalsBefore);
    expect(await listServers()).toEqual([]);
  }, 20_000);
});
