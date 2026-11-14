import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EngineLogger, ToolPermissionGate } from "@cardiary/engine-adapter";
import { FakeEngine } from "@cardiary/engine-fake";
import { afterEach, describe, expect, it } from "vitest";

import {
  m0PermissionGate,
  startHost,
  type HostEngine,
  type StartHostOptions,
} from "../src/index.js";
import { TestClient, startTestHost, type TestHost } from "./helpers.js";
import type { RunningHost } from "../src/index.js";

function wrapEngine(engine: FakeEngine, order: string[]): HostEngine {
  return new Proxy(engine, {
    get(target, property, receiver) {
      if (property === "open") {
        const open = target.open.bind(target);
        return async () => {
          order.push("open");
          return open();
        };
      }
      if (property === "deleteConversation") {
        const remove = target.deleteConversation.bind(target);
        return async (id: string, deleteOptions?: { includeBranches?: boolean }) => {
          order.push(`delete:${id}`);
          return remove(id, deleteOptions);
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as HostEngine;
}

const hosts: TestHost[] = [];
const freeHosts: RunningHost[] = [];

afterEach(async () => {
  for (const host of hosts.splice(0)) {
    await host.close();
  }
  for (const host of freeHosts.splice(0)) {
    await host.service.abort("test").catch(() => undefined);
  }
});

async function boot(options?: Parameters<typeof startTestHost>[0]): Promise<TestHost> {
  const host = await startTestHost(options);
  hosts.push(host);
  return host;
}

function eventsCalls(host: TestHost): string[] {
  return (host.host.storage.events as unknown as { calls: string[] }).calls;
}

function runtimeCalls(host: TestHost): string[] {
  return (host.host.storage.runtime as unknown as { calls: string[] }).calls;
}

async function startToolTurn(host: TestHost): Promise<TestClient> {
  const client = await TestClient.connect(host.url);
  const hello = await client.hello(host.token);
  await client.waitForReply(hello);
  const create = client.request("session.create", { clientRequestId: `cr-${Math.random()}` });
  const created = await client.waitForReply(create);
  const sessionId = (created.payload as { session: { id: string } }).session.id;
  client.request("session.subscribe", { sessionId });
  client.request("session.send_message", { sessionId, text: "用工具", delivery: "queue" });
  const requested = await client.waitForEvent("approval.requested");
  const approvalId = (requested.payload as { approvalId: string }).approvalId;
  const decide = client.request("approval.decide", { approvalId, optionId: "approve" });
  await client.waitForReply(decide);
  await client.waitForEvent("stream.tool_call");
  return client;
}

describe("生命週期", () => {
  it("pause：先提交最後一則 system.status 再 checkpoint 與關閉；殺掉工具；epoch 不變", async () => {
    const timeline: string[] = [];
    const host = await boot({
      trace: (entry) => timeline.push(entry),
      scripts: [
        [
          { kind: "tool", toolName: "demo.exec", input: { seconds: 5 } },
          { kind: "text", text: "完成" },
        ],
      ],
    });
    const client = await startToolTurn(host);
    const before = host.host.epoch;
    const result = await host.host.service.pause("user", 200);
    expect(result.state).toBe("paused");
    expect(result.terminatedProcesses).toBeGreaterThanOrEqual(1);
    expect(host.host.service.health().state).toBe("paused");
    expect(host.host.epoch).toBe(before);
    const statusIndexes = timeline
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.startsWith("events.append:system:system.status"))
      .map(({ index }) => index);
    const checkpointIndex = timeline.lastIndexOf("runtime.checkpointAndClose");
    expect(statusIndexes.length).toBeGreaterThan(0);
    expect(checkpointIndex).toBeGreaterThan(-1);
    expect(Math.max(...statusIndexes)).toBeLessThan(checkpointIndex);
    const calls = eventsCalls(host);
    expect(host.host.storage.events.closed).toBe(true);
    expect(host.host.engine.getStatus().state).toBe("paused");
    const appended = calls.filter((call) => call.startsWith("events.append:system:")).length;
    await host.host.service.pause("user", 200);
    expect(calls.filter((call) => call.startsWith("events.append:system:")).length).toBe(appended);
    await client.close();
  }, 15_000);

  it("resume 使用 reopen()、不換 epoch，之後真的跑完一個新回合", async () => {
    const host = await boot({ scripts: [[{ kind: "text", text: "第一輪" }]] });
    await host.host.service.pause("user", 100);
    const epoch = host.host.epoch;
    const calls = runtimeCalls(host);
    const before = calls.length;
    const result = await host.host.service.resume();
    expect(result.state).toBe("ready");
    expect(result.engineReopened).toBe(true);
    expect(result.epoch).toBe(epoch);
    const after = calls.slice(before);
    expect(after).toContain("runtime.reopen");
    expect(after).not.toContain("runtime.open");
    expect(host.host.engine.getStatus().state).toBe("running");
    const client = await TestClient.connect(host.url);
    const hello = await client.hello(host.token);
    await client.waitForReply(hello);
    const create = client.request("session.create", { clientRequestId: `cr-${Math.random()}` });
    const created = await client.waitForReply(create);
    const sessionId = (created.payload as { session: { id: string } }).session.id;
    client.request("session.subscribe", { sessionId });
    client.request("session.send_message", { sessionId, text: "恢復後", delivery: "queue" });
    const completed = await client.waitForEvent("stream.message_completed", 5000);
    expect((completed.payload as { entry: { text: string } }).entry.text).toBe("第一輪");
    await client.close();
  });

  it("paused 的 shutdown 重開狀態庫寫 clean_shutdown = 1", async () => {
    const host = await boot();
    await host.host.service.pause("user", 100);
    const calls = runtimeCalls(host);
    const result = await host.host.service.shutdown("user");
    expect(result).toEqual({ state: "closed", cleanShutdown: true });
    const markIndex = calls.indexOf("runtime.markCleanShutdown:user");
    const closeIndex = calls.lastIndexOf("runtime.checkpointAndClose");
    expect(markIndex).toBeGreaterThan(-1);
    expect(markIndex).toBeLessThan(closeIndex);
  });

  it("paused 但資料夾換了身分時回 cleanShutdown: false，且不寫別人的 DB", async () => {
    const host = await boot();
    await host.host.service.pause("user", 100);
    const calls = runtimeCalls(host);
    const before = calls.filter((call) => call.startsWith("runtime.markCleanShutdown")).length;
    await writeFile(
      join(host.folder.path, "state", "folder.json"),
      JSON.stringify({
        format: 1,
        folderId: "another-folder",
        createdAt: new Date().toISOString(),
        createdBy: "test",
      }),
    );
    const result = await host.host.service.shutdown("user");
    expect(result.cleanShutdown).toBe(false);
    expect(result.reason).toBe("folder_mismatch");
    expect(calls.filter((call) => call.startsWith("runtime.markCleanShutdown")).length).toBe(
      before,
    );
  });

  it("執行中的 shutdown 先提交 clean_shutdown 再 checkpoint 與關閉", async () => {
    const host = await boot();
    const calls = runtimeCalls(host);
    const eventCalls = eventsCalls(host);
    const result = await host.host.service.shutdown("user");
    expect(result.cleanShutdown).toBe(true);
    const markIndex = calls.indexOf("runtime.markCleanShutdown:user");
    const closeIndex = calls.lastIndexOf("runtime.checkpointAndClose");
    expect(markIndex).toBeGreaterThan(-1);
    expect(markIndex).toBeLessThan(closeIndex);
    expect(eventCalls).toContain("events.close");
  });

  it("stdin 中斷與 SIGTERM 只關資料庫，不設 clean_shutdown", async () => {
    const host = await boot();
    const calls = runtimeCalls(host);
    await host.host.service.abort("stdin_end");
    expect(calls.some((call) => call.startsWith("runtime.markCleanShutdown"))).toBe(false);
    expect(calls).toContain("runtime.checkpointAndClose");
  });

  it("刪除意圖在啟動時先補完，才開 Harness", async () => {
    const folder = await (await import("./helpers.js")).makeFolder();
    const order: string[] = [];
    const options: StartHostOptions = {
      folderPath: folder.path,
      clientToken: "E".repeat(43),
      deletionIntents: ["conv_pending"],
      engineFactory: (input) => {
        const engine = new FakeEngine({
          environment: {
            stateDir: join(folder.path, "state"),
            tempDir: join(folder.path, "tmp"),
            defaultWorkingDir: folder.path,
          },
          approvals: input.storage.approvals,
          permissionGate: m0PermissionGate as ToolPermissionGate,
          credentials: input.credentials,
          logger: input.logger as EngineLogger,
        });
        return wrapEngine(engine, order);
      },
    };
    const host = await startHost(options);
    freeHosts.push(host);
    expect(order).toEqual(["delete:conv_pending", "open"]);
    expect(await host.storage.deletions.pending()).toEqual([]);
  });

  it("維護通知：開始與結束各一次，health 在操作中顯示 lifecycle", async () => {
    const states: string[] = [];
    const host = await boot({
      maintenanceNotifier: async (lifecycle) => {
        states.push(lifecycle);
      },
    });
    const lifecycle = await host.host.service.withMaintenance(
      "deleting",
      async () => host.host.service.health().lifecycle,
    );
    expect(lifecycle).toBe("deleting");
    expect(states).toEqual(["deleting", "idle"]);
  });

  it("儲存失效：送 fatal、停止受理、回報 storage-failed", async () => {
    const failures: string[] = [];
    const host = await boot({
      fatalNotifier: async (reason, detail) => {
        failures.push(`${reason}:${detail}`);
      },
    });
    await host.host.service.failStorage("EIO");
    expect(failures).toEqual(["storage_io:EIO"]);
    expect(host.host.service.health().state).toBe("storage-failed");
    expect(host.host.gateway.accepting).toBe(false);
  });

  it("生命週期槽位：第二個操作回 busy", async () => {
    const host = await boot();
    const first = host.host.service.pause("user", 100);
    await expect(host.host.service.resume()).rejects.toMatchObject({ code: "busy" });
    await first;
  });

  it("重啟後是新的 epoch（記憶體替身沒有持久化）", async () => {
    const folder = await (await import("./helpers.js")).makeFolder();
    const first = await startTestHost({ folder });
    const firstEpoch = first.host.epoch;
    await first.host.service.abort("test");
    const second = await startHost({ folderPath: folder.path, clientToken: "G".repeat(43) });
    freeHosts.push(second);
    expect(second.epoch).not.toBe(firstEpoch);
  });
});
