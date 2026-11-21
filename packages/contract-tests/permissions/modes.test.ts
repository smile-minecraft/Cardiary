import { realpathSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import {
  connectAndHello,
  spawnService,
  type ProtocolClient,
  type SpawnedService,
  type TestFolder,
} from "../test/support.js";

/**
 * 權限模式的協定契約（規格第 11 章「M5 權限模式裁決」）。
 *
 * 只由人開啟：本機 Mac 客戶端可以讀寫 System One 類別、可委派網域與全部允許；
 * 全部允許一定要限定路徑或網域，沒有期限、主機重啟後保留，直到人撤銷；緊急
 * 全部暫停會撤銷全部允許並通知客戶端。遠端裝置被拒的負面測試在
 * `packages/host/test/remote/bypass.test.ts`。
 */

interface ModesState {
  readonly categories: Array<{ category: string; paths: string[] }>;
  readonly availableCategories: string[];
  readonly allowedDomains: string[];
  readonly allowAll?: { tools: string[]; paths: string[]; domains: string[] };
}

const running: SpawnedService[] = [];

afterEach(async () => {
  for (const service of running.splice(0)) await service.stop().catch(() => undefined);
});

async function boot(
  folder?: TestFolder,
): Promise<{ service: SpawnedService; client: ProtocolClient }> {
  const service = await spawnService(folder === undefined ? {} : { folder });
  running.push(service);
  const client = await connectAndHello(service);
  return { service, client };
}

let counter = 0;

async function call(
  client: ProtocolClient,
  type: string,
  payload: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  counter += 1;
  const body =
    type === "system.permissions.get" ? payload : { clientRequestId: `pm-${counter}`, ...payload };
  return client.waitForReply(client.request(type, body), 10_000);
}

function state(reply: Record<string, unknown>): ModesState {
  expect(reply.kind, JSON.stringify(reply)).toBe("response");
  return reply.payload as ModesState;
}

describe("權限模式", () => {
  it("預設全部關閉；四個可開啟的類別，沒有期限設定", async () => {
    const { client } = await boot();
    const initial = state(await call(client, "system.permissions.get"));
    expect(initial.categories).toEqual([]);
    expect(initial.allowedDomains).toEqual([]);
    expect(initial.allowAll).toBeUndefined();
    expect([...initial.availableCategories].sort()).toEqual(
      ["create-card", "git-readonly", "own-notification", "read-only-files"].sort(),
    );
    expect(initial).not.toHaveProperty("defaultAllowAllMinutes");
    expect(initial).not.toHaveProperty("maxAllowAllMinutes");
  });

  it("開啟全部允許：只有範圍沒有期限，system 串流收到變更；撤銷後消失", async () => {
    const { service, client } = await boot();
    await call(client, "system.subscribe");
    const granted = state(
      await call(client, "system.permissions.grant_allow_all", {
        tools: ["write_file"],
        paths: [service.folder.path],
      }),
    );
    expect(granted.allowAll?.tools).toEqual(["write_file"]);
    expect(granted.allowAll).not.toHaveProperty("expiresAt");
    await client.waitFor(
      (frame) =>
        frame.type === "system.permissions.changed" &&
        (frame.payload as ModesState).allowAll !== undefined,
      10_000,
    );

    const revoked = state(await call(client, "system.permissions.revoke_allow_all"));
    expect(revoked.allowAll).toBeUndefined();
    expect(state(await call(client, "system.permissions.get")).allowAll).toBeUndefined();
  });

  it.each([
    ["沒有限定路徑或網域", { tools: ["write_file"], paths: [] }, "paths"],
    ["沒有工具", { tools: [], paths: ["/tmp/x"] }, "tools"],
    ["相對路徑", { tools: ["write_file"], paths: ["relative/dir"] }, "tools"],
  ])("全部允許的範圍不合法時被拒：%s", async (_label, payload, field) => {
    const { client } = await boot();
    const reply = await call(client, "system.permissions.grant_allow_all", payload);
    expect(reply.kind).toBe("error");
    expect(reply.code).toBe("invalid_message");
    if (field !== "tools") {
      expect((reply.details as { field?: string } | undefined)?.field).toBe(field);
    }
    expect(state(await call(client, "system.permissions.get")).allowAll).toBeUndefined();
  });

  it("緊急全部暫停撤銷全部允許，並在 system 串流通知", async () => {
    const { service, client } = await boot();
    await call(client, "system.subscribe");
    state(
      await call(client, "system.permissions.grant_allow_all", {
        tools: ["write_file"],
        paths: [service.folder.path],
      }),
    );
    const paused = await call(client, "approval.pause_all", { reason: "契約測試" });
    expect(paused.kind, JSON.stringify(paused)).toBe("response");
    await client.waitFor(
      (frame) =>
        frame.type === "system.permissions.changed" &&
        (frame.payload as ModesState).allowAll === undefined,
      10_000,
    );
    expect(state(await call(client, "system.permissions.get")).allowAll).toBeUndefined();
  });

  it("全部允許在主機重啟後仍然開著，直到人撤銷", async () => {
    const { service, client } = await boot();
    state(
      await call(client, "system.permissions.grant_allow_all", {
        tools: ["write_file"],
        paths: [service.folder.path],
      }),
    );

    await client.close();
    await service.stop();
    running.splice(running.indexOf(service), 1);
    const restarted = await boot(service.folder);
    const after = state(await call(restarted.client, "system.permissions.get"));
    expect(after.allowAll).toEqual({
      tools: ["write_file"],
      paths: [realpathSync.native(service.folder.path)],
      domains: [],
    });

    const revoked = state(await call(restarted.client, "system.permissions.revoke_allow_all"));
    expect(revoked.allowAll).toBeUndefined();
  });

  it("System One 類別：路徑類別要絕對路徑，非路徑類別不能帶路徑；重啟後仍在", async () => {
    const { service, client } = await boot();
    const relative = await call(client, "system.permissions.set_category", {
      category: "read-only-files",
      enabled: true,
      paths: ["notes"],
    });
    expect(relative.code).toBe("invalid_message");
    const withPaths = await call(client, "system.permissions.set_category", {
      category: "create-card",
      enabled: true,
      paths: [service.folder.path],
    });
    expect(withPaths.code).toBe("invalid_message");
    const unknown = await call(client, "system.permissions.set_category", {
      category: "delete-files",
      enabled: true,
      paths: [],
    });
    expect(unknown.kind).toBe("error");

    state(
      await call(client, "system.permissions.set_category", {
        category: "read-only-files",
        enabled: true,
        paths: [service.folder.path],
      }),
    );
    const enabled = state(
      await call(client, "system.permissions.set_category", {
        category: "create-card",
        enabled: true,
        paths: [],
      }),
    );
    expect(enabled.categories.map((entry) => entry.category).sort()).toEqual([
      "create-card",
      "read-only-files",
    ]);

    await client.close();
    await service.stop();
    running.splice(running.indexOf(service), 1);
    const restarted = await boot(service.folder);
    const after = state(await call(restarted.client, "system.permissions.get"));
    // 授權存成真實路徑（macOS 的暫存目錄經過 /var → /private/var 符號連結）。
    expect(after.categories).toEqual(
      expect.arrayContaining([
        { category: "read-only-files", paths: [realpathSync.native(service.folder.path)] },
        { category: "create-card", paths: [] },
      ]),
    );

    const disabled = state(
      await call(restarted.client, "system.permissions.set_category", {
        category: "create-card",
        enabled: false,
        paths: [],
      }),
    );
    expect(disabled.categories.map((entry) => entry.category)).toEqual(["read-only-files"]);
  });

  it("可委派網域：localhost 與私有網段被拒，正常網域可以設定", async () => {
    const { client } = await boot();
    for (const domain of ["localhost", "10.0.0.1", "api.internal"]) {
      const reply = await call(client, "system.permissions.set_domains", { domains: [domain] });
      expect(reply.kind, `${domain} 應被拒`).toBe("error");
    }
    const set = state(
      await call(client, "system.permissions.set_domains", { domains: ["docs.example.com"] }),
    );
    expect(set.allowedDomains).toEqual(["docs.example.com"]);
  });
});
