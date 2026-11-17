import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  connectAndHello,
  engineUnderTest,
  spawnService,
  type ProtocolClient,
  type SpawnedService,
} from "../test/support.js";

/**
 * MCP 審批跨重啟的契約：核准流程不留下「核准了但沒有寫正本」的孤兒。
 *
 * 假引擎是記憶體替身，重啟後沒有資料可接；這一組只在產品組裝跑。
 */

let service: SpawnedService;

beforeAll(async () => {
  service = await spawnService();
}, 20_000);

afterAll(async () => {
  await service?.stop().catch(() => undefined);
});

describe("MCP 審批跨重啟", () => {
  it.skipIf(engineUnderTest() === "fake")(
    "重啟後待決的新增仍可決定，核准後伺服器出現在清單裡",
    async () => {
      const folder = service.folder;
      const first = await connectAndHello(service);
      const subscribe = first.request("system.subscribe", {});
      await first.waitForReply(subscribe);

      const addId = first.request("mcp.server.add", {
        name: "重啟測試伺服器",
        transport: "stdio",
        command: "/usr/bin/true",
        allowedHosts: [],
      });
      const addReply = await first.waitForReply(addId);
      const approvalId = (addReply.payload as { approvalId: string }).approvalId;
      expect(approvalId).toBeTruthy();
      const requested = await first.waitFor(
        (frame) =>
          frame.kind === "event" &&
          frame.type === "approval.requested" &&
          (frame.payload as { approvalId?: string }).approvalId === approvalId,
        5000,
      );
      expect((requested.payload as { scope?: { kind?: string } }).scope?.kind).toBe(
        "settings_change",
      );
      // 核准之前先重啟：審批列在 SQLite，等待者隨行程消失。
      await first.close().catch(() => undefined);
      await service.stop();

      const restarted = await spawnService({ folder });
      const client: ProtocolClient = await connectAndHello(restarted);
      try {
        const resubscribe = client.request("system.subscribe", {});
        const reply = await client.waitForReply(resubscribe);
        const payload = reply.payload as {
          resyncRequired?: boolean;
          snapshot?: unknown;
          pendingApprovals?: Array<{
            approvalId?: string;
            sessionId?: string;
            scope?: { kind?: string };
          }>;
        };
        expect(payload.resyncRequired).toBe(true);
        expect(payload.snapshot).toBeTruthy();
        const pending = (payload.pendingApprovals ?? []).find(
          (entry) => entry.approvalId === approvalId,
        );
        expect(pending).toBeDefined();
        expect(pending?.sessionId).toBe("");
        expect(pending?.scope?.kind).toBe("settings_change");

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
          const id = client.request("mcp.servers.list", {});
          const listReply = await client.waitForReply(id);
          servers = (listReply.payload as { servers: Record<string, unknown>[] }).servers;
          if (servers.length === 0) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
        expect(servers).toHaveLength(1);
        expect(servers[0]).toMatchObject({ name: "重啟測試伺服器", enabled: true });
      } finally {
        await client.close().catch(() => undefined);
        await restarted.stop().catch(() => undefined);
      }
    },
    40_000,
  );
});
