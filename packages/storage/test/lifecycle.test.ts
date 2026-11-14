import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  Database,
  LifecycleCoordinator,
  RuntimeStateStore,
  STATE_APPLICATION_ID,
  StorageError,
  readFolderIdentity,
  type EngineLifecyclePort,
  type ToolSupervisor,
} from "../src/index.js";
import { createTempRoot, openTestStorage, type TempRoot } from "./helpers/temp.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

function temp(label = "lifecycle"): TempRoot {
  const root = createTempRoot(label);
  cleanups.push(root.cleanup);
  return root;
}

function enginePort(log: string[]): EngineLifecyclePort {
  return {
    suspend: async () => {
      log.push("engine.suspend");
    },
    resume: async () => {
      log.push("engine.resume");
    },
    close: async () => {
      log.push("engine.close");
    },
  };
}

function supervisor(log: string[], options: { active?: number } = {}): ToolSupervisor {
  let active = options.active ?? 0;
  return {
    cancelAll: async () => {
      log.push("tools.cancel");
      active = 0;
    },
    activeToolCalls: () => active,
  };
}

describe("pause 與 shutdown 的順序", () => {
  it("pause 先取消工具、提交最後一則 system.status，再 checkpoint 與關閉", async () => {
    const tempRoot = temp();
    const trace: string[] = [];
    const storage = openTestStorage(tempRoot, { trace: (operation) => trace.push(operation) });
    cleanups.push(() => storage.close());
    const log: string[] = [];
    const coordinator = new LifecycleCoordinator({
      runtime: storage.runtime,
      events: storage.events,
      supervisor: supervisor(log),
      deadlineMs: 1000,
    });
    const epoch = storage.runtime.read()?.epoch;
    const baseline = trace.length;
    await coordinator.pause({
      finalStatus: {
        stream: "system",
        kind: "system.status",
        payload: { folder: { state: "ready" }, service: { state: "paused" } },
      },
      engine: enginePort(log),
    });
    const relevant = trace.slice(baseline);
    expect(log).toEqual(["tools.cancel", "engine.suspend"]);
    expect(relevant).toContain("checkpoint");
    expect(relevant).toContain("close");
    expect(relevant.indexOf("checkpoint")).toBeLessThan(relevant.indexOf("close"));
    expect(storage.state.isClosed).toBe(true);

    const raw = Database.open(tempRoot.folder + "/state/cardiary.sqlite", {
      expectedApplicationId: STATE_APPLICATION_ID,
    });
    const snapshot = raw.get<{ epoch: string; clean_shutdown: number }>(
      "SELECT epoch, clean_shutdown FROM runtime_state WHERE id = 1",
    );
    const event = raw.get<{ payload: string }>(
      "SELECT payload FROM event_log WHERE kind = 'system.status' ORDER BY id DESC LIMIT 1",
    );
    raw.close();
    expect(snapshot?.epoch).toBe(epoch);
    expect(snapshot?.clean_shutdown).toBe(0);
    expect(JSON.parse(event?.payload ?? "{}")).toMatchObject({ service: { state: "paused" } });
  });

  it("pause 後 resume：epoch 不變、clean_shutdown 仍是 0、狀態庫可寫", async () => {
    const tempRoot = temp();
    const storage = openTestStorage(tempRoot);
    cleanups.push(() => storage.close());
    const log: string[] = [];
    const coordinator = new LifecycleCoordinator({
      runtime: storage.runtime,
      events: storage.events,
      supervisor: supervisor(log),
    });
    const epoch = storage.runtime.read()?.epoch;
    await coordinator.pause({
      finalStatus: { stream: "system", kind: "system.status", payload: { paused: true } },
      engine: enginePort(log),
    });
    await coordinator.resume({ engine: enginePort(log) });
    expect(storage.runtime.read()?.epoch).toBe(epoch);
    expect(storage.runtime.read()?.cleanShutdown).toBe(false);
    expect(log).toEqual(["tools.cancel", "engine.suspend", "engine.resume"]);
    expect(
      storage.events.append({ stream: "system", kind: "system.status", payload: { back: true } })
        .streamSeq,
    ).toBeGreaterThan(0);
  });

  it("shutdown 先提交 clean_shutdown = 1，再 checkpoint 與關閉", async () => {
    const tempRoot = temp();
    const trace: string[] = [];
    const storage = openTestStorage(tempRoot, { trace: (operation) => trace.push(operation) });
    cleanups.push(() => storage.close());
    const log: string[] = [];
    const coordinator = new LifecycleCoordinator({
      runtime: storage.runtime,
      events: storage.events,
      supervisor: supervisor(log),
    });
    const baseline = trace.length;
    await coordinator.shutdown({ engine: enginePort(log) });
    const relevant = trace.slice(baseline);
    expect(relevant.indexOf("runtime_state:mark-clean-shutdown")).toBeGreaterThanOrEqual(0);
    expect(relevant.indexOf("checkpoint")).toBeGreaterThan(
      relevant.indexOf("runtime_state:mark-clean-shutdown"),
    );
    expect(relevant.indexOf("close")).toBeGreaterThan(relevant.indexOf("checkpoint"));
    expect(log).toEqual(["tools.cancel", "engine.close"]);

    const raw = Database.open(path.join(tempRoot.folder, "state/cardiary.sqlite"), {
      expectedApplicationId: STATE_APPLICATION_ID,
    });
    const row = raw.get<{ clean_shutdown: number }>(
      "SELECT clean_shutdown FROM runtime_state WHERE id = 1",
    );
    raw.close();
    expect(row?.clean_shutdown).toBe(1);
  });

  it("stdin 中斷：只關資料庫，不寫 clean_shutdown = 1", () => {
    const tempRoot = temp();
    const storage = openTestStorage(tempRoot);
    cleanups.push(() => storage.close());
    const coordinator = new LifecycleCoordinator({
      runtime: storage.runtime,
      events: storage.events,
      supervisor: supervisor([]),
    });
    coordinator.closeAfterDisconnect();
    expect(storage.state.isClosed).toBe(true);
    const raw = Database.open(path.join(tempRoot.folder, "state/cardiary.sqlite"), {
      expectedApplicationId: STATE_APPLICATION_ID,
    });
    const row = raw.get<{ clean_shutdown: number }>(
      "SELECT clean_shutdown FROM runtime_state WHERE id = 1",
    );
    raw.close();
    expect(row?.clean_shutdown).toBe(0);
  });

  it("SIGTERM 類的未標記關閉：clean_shutdown 保持 0，下次 open 換 epoch", () => {
    const tempRoot = temp();
    const first = openTestStorage(tempRoot);
    const epoch = first.runtime.read()?.epoch as string;
    const coordinator = new LifecycleCoordinator({
      runtime: first.runtime,
      events: first.events,
      supervisor: supervisor([]),
    });
    coordinator.closeAfterDisconnect();
    first.close();

    const second = openTestStorage(tempRoot);
    cleanups.push(() => second.close());
    const snapshot = second.runtime.read();
    expect(snapshot?.epoch).not.toBe(epoch);
    expect(snapshot?.cleanShutdown).toBe(false);
  });

  it("工具還在執行時 pause 不繼續關閉", async () => {
    const tempRoot = temp();
    const storage = openTestStorage(tempRoot);
    cleanups.push(() => storage.close());
    const coordinator = new LifecycleCoordinator({
      runtime: storage.runtime,
      events: storage.events,
      supervisor: supervisor([], { active: 1 }),
    });
    // 這個 supervisor 的 cancelAll 會把 active 設成 0；用不會清的版本測拒絕。
    const stubborn: ToolSupervisor = {
      cancelAll: async () => {
        // 故意不清。
      },
      activeToolCalls: () => 1,
    };
    const strict = new LifecycleCoordinator({
      runtime: storage.runtime,
      events: storage.events,
      supervisor: stubborn,
    });
    await expect(
      strict.pause({
        finalStatus: { stream: "system", kind: "system.status", payload: {} },
        engine: enginePort([]),
      }),
    ).rejects.toThrowError(StorageError);
    expect(storage.state.isClosed).toBe(false);
    void coordinator;
  });
});

describe("暫停中關閉與資料夾身分", () => {
  it("同一個 folderId 與 epoch：用 reopen 寫 1 回 true", async () => {
    const tempRoot = temp();
    const storage = openTestStorage(tempRoot);
    cleanups.push(() => storage.close());
    const folderId = storage.folderId as string;
    const epoch = storage.runtime.read()?.epoch as string;
    storage.runtime.checkpointAndClose();
    const result = storage.runtime.shutdownWhilePaused({
      layout: storage.layout,
      expectedFolderId: folderId,
      expectedEpoch: epoch,
    });
    expect(result).toBe(true);
    const raw = Database.open(path.join(tempRoot.folder, "state/cardiary.sqlite"), {
      expectedApplicationId: STATE_APPLICATION_ID,
    });
    expect(
      raw.get<{ clean_shutdown: number }>("SELECT clean_shutdown FROM runtime_state WHERE id = 1")
        ?.clean_shutdown,
    ).toBe(1);
    raw.close();
  });

  it("folderId 不符回 false，而且不寫任何東西", async () => {
    const tempRoot = temp();
    const storage = openTestStorage(tempRoot);
    cleanups.push(() => storage.close());
    const epoch = storage.runtime.read()?.epoch as string;
    storage.runtime.checkpointAndClose();
    const result = storage.runtime.shutdownWhilePaused({
      layout: storage.layout,
      expectedFolderId: "01DIFFERENTFOLDER0000000000",
      expectedEpoch: epoch,
    });
    expect(result).toBe(false);
    const raw = Database.open(path.join(tempRoot.folder, "state/cardiary.sqlite"), {
      expectedApplicationId: STATE_APPLICATION_ID,
    });
    expect(
      raw.get<{ clean_shutdown: number }>("SELECT clean_shutdown FROM runtime_state WHERE id = 1")
        ?.clean_shutdown,
    ).toBe(0);
    raw.close();
  });

  it("資料夾不在時 paused shutdown 回 false", () => {
    const tempRoot = temp();
    const storage = openTestStorage(tempRoot);
    const folderId = storage.folderId as string;
    const epoch = storage.runtime.read()?.epoch as string;
    const moved = path.join(tempRoot.root, "Cardiary-moved");
    storage.runtime.checkpointAndClose();
    renameSync(tempRoot.folder, moved);
    try {
      const result = storage.runtime.shutdownWhilePaused({
        layout: storage.layout,
        expectedFolderId: folderId,
        expectedEpoch: epoch,
      });
      expect(result).toBe(false);
    } finally {
      renameSync(moved, tempRoot.folder);
      storage.close();
    }
  });

  it("狀態庫 reopen 失敗時 paused shutdown 回 false", () => {
    const tempRoot = temp();
    const storage = openTestStorage(tempRoot);
    cleanups.push(() => storage.close());
    const folderId = storage.folderId as string;
    const epoch = storage.runtime.read()?.epoch as string;
    storage.runtime.checkpointAndClose();
    const databasePath = path.join(tempRoot.folder, "state/cardiary.sqlite");
    rmSync(databasePath, { force: true });
    mkdirSync(databasePath);
    const result = storage.runtime.shutdownWhilePaused({
      layout: storage.layout,
      expectedFolderId: folderId,
      expectedEpoch: epoch,
    });
    expect(result).toBe(false);
    rmSync(databasePath, { recursive: true, force: true });
  });

  it("epoch 不符回 false，也不寫 1", async () => {
    const tempRoot = temp();
    const storage = openTestStorage(tempRoot);
    cleanups.push(() => storage.close());
    const folderId = storage.folderId as string;
    storage.runtime.checkpointAndClose();
    const result = storage.runtime.shutdownWhilePaused({
      layout: storage.layout,
      expectedFolderId: folderId,
      expectedEpoch: "01WRONGEPOCH000000000000000",
    });
    expect(result).toBe(false);
    const raw = Database.open(path.join(tempRoot.folder, "state/cardiary.sqlite"), {
      expectedApplicationId: STATE_APPLICATION_ID,
    });
    expect(
      raw.get<{ clean_shutdown: number }>("SELECT clean_shutdown FROM runtime_state WHERE id = 1")
        ?.clean_shutdown,
    ).toBe(0);
    raw.close();
  });

  it("同一個路徑換成另一個資料夾：回 false，不寫別人的資料庫", () => {
    const tempRoot = temp();
    const storageA = openTestStorage(tempRoot);
    cleanups.push(() => storageA.close());
    const epochA = storageA.runtime.read()?.epoch as string;
    storageA.runtime.checkpointAndClose();
    storageA.close();

    const otherRoot = temp("other-folder");
    const storageB = openTestStorage(otherRoot);
    const folderIdB = storageB.folderId as string;
    storageB.close();

    // 把 A 路徑上的身分與狀態庫換成 B 的（模擬同一路徑掛到另一個 Cardiary 資料夾）。
    copyFileSync(
      path.join(otherRoot.folder, "state/cardiary.sqlite"),
      path.join(tempRoot.folder, "state/cardiary.sqlite"),
    );
    copyFileSync(
      path.join(otherRoot.folder, "state/folder.json"),
      path.join(tempRoot.folder, "state/folder.json"),
    );
    const layoutA = storageA.layout;
    expect(readFolderIdentity(layoutA)).toMatchObject({
      kind: "ok",
      identity: { folderId: folderIdB },
    });
    const reopened = Database.open(path.join(tempRoot.folder, "state/cardiary.sqlite"), {
      expectedApplicationId: STATE_APPLICATION_ID,
    });
    const runtime = new RuntimeStateStore(reopened);
    const result = runtime.shutdownWhilePaused({
      layout: layoutA,
      expectedFolderId: folderIdB,
      expectedEpoch: epochA,
    });
    expect(result).toBe(false);
    const after = Database.open(path.join(tempRoot.folder, "state/cardiary.sqlite"), {
      expectedApplicationId: STATE_APPLICATION_ID,
    });
    expect(
      after.get<{ clean_shutdown: number }>("SELECT clean_shutdown FROM runtime_state WHERE id = 1")
        ?.clean_shutdown,
    ).toBe(0);
    after.close();
  });
});

describe("暫停時的工具子行程", () => {
  it("pause 會等工具被殺掉才回應；回應後沒有新的寫入", async () => {
    const tempRoot = temp();
    const storage = openTestStorage(tempRoot);
    cleanups.push(() => storage.close());
    const output = path.join(tempRoot.out, "late-write.txt");
    const script = `const fs = require("node:fs"); setTimeout(() => fs.writeFileSync(${JSON.stringify(output)}, "late"), 400); setTimeout(() => {}, 5000);`;
    const child = spawn(process.execPath, ["-e", script], {
      detached: true,
      stdio: "ignore",
    });
    const supervisorWithProcess: ToolSupervisor = {
      cancelAll: async () => {
        try {
          process.kill(-(child.pid as number), "SIGKILL");
        } catch {
          // 已結束。
        }
        await new Promise<void>((resolve) => {
          child.once("exit", () => resolve());
          setTimeout(() => resolve(), 1000);
        });
      },
      activeToolCalls: () => 0,
    };
    const coordinator = new LifecycleCoordinator({
      runtime: storage.runtime,
      events: storage.events,
      supervisor: supervisorWithProcess,
    });
    await coordinator.pause({
      finalStatus: { stream: "system", kind: "system.status", payload: { paused: true } },
      engine: enginePort([]),
    });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(existsSync(output)).toBe(false);
    writeFileSync(path.join(tempRoot.out, "cleanup-marker"), "ok");
  });
});
