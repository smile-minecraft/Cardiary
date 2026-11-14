import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EngineLogger, ToolPermissionGate } from "@cardiary/engine-adapter";
import { FakeEngine } from "@cardiary/engine-fake";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MemoryApprovalLedger,
  MemoryDeletionIntents,
  MemoryEventLog,
  MemoryRequestDedupe,
  MemoryRuntimeState,
  MemoryTurnIndex,
  m0PermissionGate,
  startHost,
  type HostEngine,
  type RuntimeStateSnapshot,
  type StartHostOptions,
  type StorageBundle,
} from "../src/index.js";
import { TestClient, startTestHost, waitUntil, type TestHost } from "./helpers.js";
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
    expect(host.host.spawn.runningCount).toBe(0);
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

  it("pause 在提交前失敗會走 failStorage，不回假的 paused，重試也不是 databasesClosed:true", async () => {
    const failures: string[] = [];
    const host = await boot({
      fatalNotifier: async (reason, detail) => {
        failures.push(`${reason}:${detail}`);
      },
    });
    await (host.host.storage.events as unknown as { close(): Promise<void> }).close();
    await expect(host.host.service.pause("unmount", 100)).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(failures[0]?.startsWith("storage_io:")).toBe(true);
    expect(host.host.service.health().state).toBe("storage-failed");
    await expect(host.host.service.pause("unmount", 100)).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(failures).toHaveLength(1);
  });

  it("shutdown 的儲存寫入失敗會走 failStorage：notify.fatal、1011，不回 cleanShutdown", async () => {
    const failures: string[] = [];
    const host = await boot({
      fatalNotifier: async (reason, detail) => {
        failures.push(`${reason}:${detail}`);
      },
    });
    const client = await TestClient.connect(host.url);
    const hello = await client.hello(host.token);
    await client.waitForReply(hello);
    // 實際的 StorageFailure：狀態庫已關閉，markCleanShutdown 會失敗。
    await (
      host.host.storage.runtime as unknown as { checkpointAndClose(): Promise<void> }
    ).checkpointAndClose();
    await expect(host.host.service.shutdown("user")).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(failures[0]?.startsWith("storage_io:")).toBe(true);
    expect(host.host.service.health().state).toBe("storage-failed");
    expect(host.host.service.databasesClosed).toBe(false);
    await waitUntil(() => client.closed, 4000);
    expect(client.closeCode).toBe(1011);
    expect(client.closeReason).toBe("storage_failure");
  });

  it("resume 部分失敗後 pause 不會回假的 databasesClosed", async () => {
    const host = await boot();
    await host.host.service.pause("user", 100);
    const checkpointCalls = runtimeCalls(host).filter(
      (call) => call === "runtime.checkpointAndClose",
    ).length;
    const resumeSpy = vi
      .spyOn(host.host.engine, "resume")
      .mockRejectedValueOnce(new Error("resume 失敗"));
    const resumed = await host.host.service.resume();
    expect(resumed.state).toBe("degraded");
    expect(resumed.reason).toBe("engine_reopen_failed");
    expect(host.host.service.databasesClosed).toBe(false);
    const paused = await host.host.service.pause("user", 100);
    expect(paused.databasesClosed).toBe(true);
    expect(runtimeCalls(host).filter((call) => call === "runtime.checkpointAndClose").length).toBe(
      checkpointCalls + 1,
    );
    expect(host.host.service.databasesClosed).toBe(true);
    resumeSpy.mockRestore();
  });

  it("執行中的 shutdown 取消工具並等它們結束", async () => {
    const host = await boot({
      scripts: [
        [
          { kind: "tool", toolName: "demo.exec", input: { seconds: 5 } },
          { kind: "text", text: "完成" },
        ],
      ],
    });
    const client = await startToolTurn(host);
    expect(host.host.spawn.runningCount).toBeGreaterThanOrEqual(1);
    const result = await host.host.service.shutdown("user");
    expect(result.cleanShutdown).toBe(true);
    expect(host.host.spawn.runningCount).toBe(0);
    await client.close();
  }, 15_000);

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

  it("control.pause 保留已串流文字：resume 後快照仍有 interrupted 訊息", async () => {
    const host = await boot({
      scripts: [[{ kind: "text", text: "y".repeat(60), chunkSize: 1, delayMs: 15 }]],
    });
    const client = await TestClient.connect(host.url);
    const hello = await client.hello(host.token);
    await client.waitForReply(hello);
    const create = client.request("session.create", { clientRequestId: "cr-partial" });
    const created = await client.waitForReply(create);
    const sessionId = (created.payload as { session: { id: string } }).session.id;
    client.request("session.subscribe", { sessionId });
    client.request("session.send_message", { sessionId, text: "開始", delivery: "queue" });
    await client.waitForEvent("stream.text_delta");
    await waitUntil(
      () => client.frames.filter((frame) => frame.type === "stream.text_delta").length >= 10,
    );
    const accumulated = client.frames
      .filter((frame) => frame.type === "stream.text_delta")
      .map((frame) => (frame.payload as { delta: string }).delta)
      .join("");
    const paused = await host.host.service.pause("user", 200);
    expect(paused.state).toBe("paused");
    const resumed = await host.host.service.resume();
    expect(resumed.state).toBe("ready");
    const late = await TestClient.connect(host.url);
    const lateHello = await late.hello(host.token);
    await late.waitForReply(lateHello);
    const subscribe = late.request("session.subscribe", { sessionId });
    const snapshotReply = await late.waitForReply(subscribe);
    const entries = (
      snapshotReply.payload as {
        snapshot: { entries: Array<{ role: string; status?: string; text: string }> };
      }
    ).snapshot.entries;
    const interrupted = entries.find(
      (entry) => entry.role === "assistant" && entry.status === "interrupted",
    );
    expect(interrupted).toBeDefined();
    expect(interrupted?.text.length ?? 0).toBeGreaterThanOrEqual(accumulated.length);
    expect(interrupted?.text.startsWith(accumulated)).toBe(true);
    await client.close();
    await late.close();
  }, 15_000);

  it("control.resume 只接受同一個資料夾路徑：不同路徑回 unavailable，不換資料夾", async () => {
    const { makeFolder } = await import("./helpers.js");
    const original = await makeFolder();
    const host = await startTestHost({ folder: original });
    hosts.push(host);
    await host.host.service.pause("user", 100);
    const reopensBefore = runtimeCalls(host).filter((call) => call === "runtime.reopen").length;
    const otherPath = await makeFolder(original.folderId);
    await expect(host.host.service.resume(otherPath.path)).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(runtimeCalls(host).filter((call) => call === "runtime.reopen").length).toBe(
      reopensBefore,
    );
    expect(host.host.service.health().folderId).toBe(original.folderId);
    expect(host.host.service.statusInput().displayName).toBe(original.path.split("/").pop());
    const resumed = await host.host.service.resume(original.path);
    expect(resumed.state).toBe("ready");
    expect(resumed.folderId).toBe(original.folderId);
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

  it("啟動順序：先讀 runtime_state，才寫第一則事件", async () => {
    const timeline: string[] = [];
    const host = await boot({ trace: (entry) => timeline.push(entry) });
    const runtimeIndex = timeline.indexOf("runtime.open");
    const firstEventIndex = timeline.findIndex((entry) => entry.startsWith("events.append:"));
    expect(runtimeIndex).toBeGreaterThan(-1);
    expect(firstEventIndex).toBeGreaterThan(runtimeIndex);
    void host;
  });

  it("resume 發現 epoch 不一致：釋放不可信 handle，pause 不寫入、shutdown 不寫 clean_shutdown", async () => {
    const folder = await (await import("./helpers.js")).makeFolder();
    const runtimeInner = new MemoryRuntimeState();
    const runtimeCalls: string[] = [];
    const mismatchedEpoch = "01MISMATCHMISMATCHMISMATCH";
    const runtime = {
      async open(): Promise<RuntimeStateSnapshot> {
        runtimeCalls.push("open");
        return runtimeInner.open();
      },
      async reopen(): Promise<RuntimeStateSnapshot> {
        runtimeCalls.push("reopen");
        const snapshot = await runtimeInner.reopen();
        return { ...snapshot, epoch: mismatchedEpoch };
      },
      current(): RuntimeStateSnapshot | null {
        return runtimeInner.current();
      },
      async markCleanShutdown(reason: string): Promise<void> {
        runtimeCalls.push(`markCleanShutdown:${reason}`);
        return runtimeInner.markCleanShutdown(reason);
      },
      async checkpointAndClose(): Promise<void> {
        runtimeCalls.push("checkpoint");
        return runtimeInner.checkpointAndClose();
      },
      async close(): Promise<void> {
        runtimeCalls.push("close");
        return runtimeInner.close();
      },
      get opened(): boolean {
        return runtimeInner.opened;
      },
    };
    const events = new MemoryEventLog();
    const storage: StorageBundle = {
      events,
      runtime,
      dedupe: new MemoryRequestDedupe(),
      approvals: new MemoryApprovalLedger(),
      turnIndex: new MemoryTurnIndex(),
      deletions: new MemoryDeletionIntents(),
      folder: {
        path: folder.path,
        folderId: folder.folderId,
        displayName: "mismatch-test",
        writable: true,
      },
    };
    const host = await startHost({
      folderPath: folder.path,
      clientToken: "M".repeat(43),
      demo: true,
      storage,
    });
    freeHosts.push(host);
    await host.service.pause("user", 100);
    expect(host.service.databasesClosed).toBe(true);
    const appends = () => events.calls.filter((call) => call.startsWith("events.append")).length;
    const appendsBefore = appends();
    const checkpointsBefore = runtimeCalls.filter((call) => call === "checkpoint").length;
    const marksBefore = runtimeCalls.filter((call) => call.startsWith("markCleanShutdown")).length;

    const resumed = await host.service.resume();
    expect(resumed.state).toBe("degraded");
    expect(resumed.reason).toBe("folder_mismatch");
    expect(host.service.databasesClosed).toBe(true);
    expect(runtimeCalls).toContain("close");
    expect(runtimeCalls.filter((call) => call === "checkpoint").length).toBe(checkpointsBefore);
    expect(events.calls).toContain("events.close");
    expect(runtimeInner.opened).toBe(false);

    await expect(host.service.pause("user", 100)).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(appends()).toBe(appendsBefore);
    expect(runtimeCalls.filter((call) => call === "checkpoint").length).toBe(checkpointsBefore);
    expect(runtimeCalls.filter((call) => call.startsWith("markCleanShutdown")).length).toBe(
      marksBefore,
    );

    const shutdown = await host.service.shutdown("user");
    expect(shutdown).toEqual({
      state: "closed",
      cleanShutdown: false,
      reason: "folder_mismatch",
    });
    expect(appends()).toBe(appendsBefore);
    expect(runtimeCalls.filter((call) => call === "checkpoint").length).toBe(checkpointsBefore);
    expect(runtimeCalls.filter((call) => call.startsWith("markCleanShutdown")).length).toBe(
      marksBefore,
    );
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
