import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CACHE_APPLICATION_ID,
  CACHE_SCHEMA_VERSION,
  FolderLayout,
  FolderManager,
  FolderStateMachine,
  Storage,
  StorageError,
  folderIdentityPath,
  toSystemStatus,
} from "../src/index.js";
import { createTempRoot, openTestStorage, type TempRoot } from "./helpers/temp.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

function temp(label = "folder"): TempRoot {
  const root = createTempRoot(label);
  cleanups.push(root.cleanup);
  return root;
}

function open(tempRoot: TempRoot): Storage {
  const storage = openTestStorage(tempRoot);
  cleanups.push(() => storage.close());
  return storage;
}

describe("資料夾不存在", () => {
  it("回報 unavailable，而且不建立任何目錄", () => {
    const tempRoot = temp();
    const missing = path.join(tempRoot.root, "not-mounted", "Cardiary");
    const manager = new FolderManager(new FolderLayout(missing));
    const result = manager.open({ initialize: true });
    expect(result.state).toBe("unavailable");
    expect(result.reason).toBe("missing");
    expect(existsSync(missing)).toBe(false);
    expect(existsSync(path.dirname(missing))).toBe(false);
  });

  it("Storage.open 丟 folder-unavailable，不建立根資料夾", () => {
    const tempRoot = temp();
    const missing = path.join(tempRoot.root, "missing-folder");
    expect(() => Storage.open({ path: missing, initialize: true })).toThrowError(StorageError);
    expect(existsSync(missing)).toBe(false);
  });
});

describe("初始化與身分", () => {
  it("空資料夾初始化九個子資料夾、資料庫與 folder.json", () => {
    const tempRoot = temp();
    const storage = open(tempRoot);
    expect(storage.folderState).toBe("ready");
    expect(storage.folderId).not.toBeNull();
    for (const name of [
      "cards",
      "assets",
      "boards",
      "skills",
      "state",
      "modules",
      "cache",
      "tmp",
      "logs",
    ]) {
      expect(existsSync(path.join(tempRoot.folder, name)), name).toBe(true);
    }
    expect(existsSync(path.join(tempRoot.folder, "state/cardiary.sqlite"))).toBe(true);
    expect(existsSync(path.join(tempRoot.folder, "state/engine.sqlite"))).toBe(true);
    const identityPath = folderIdentityPath(storage.layout);
    const identity = JSON.parse(readFileSync(identityPath, "utf8")) as {
      format: number;
      folderId: string;
    };
    expect(identity.format).toBe(1);
    expect(identity.folderId).toBe(storage.folderId);
  });

  it("重複開啟同一個資料夾不出錯，folderId 不變", () => {
    const tempRoot = temp();
    const first = open(tempRoot);
    const folderId = first.folderId;
    first.close();
    const second = open(tempRoot);
    expect(second.folderId).toBe(folderId);
  });

  it("根資料夾不是空的又沒有 folder.json：mismatch，不初始化", () => {
    const tempRoot = temp();
    const file = path.join(tempRoot.folder, "使用者檔案.txt");
    rmSync(tempRoot.folder, { recursive: true, force: true });
    mkdirSync(tempRoot.folder);
    writeFileSync(file, "keep");
    const manager = new FolderManager(new FolderLayout(tempRoot.folder));
    const result = manager.open({ initialize: true });
    expect(result.state).toBe("mismatch");
    expect(result.reason).toBe("not_empty");
    expect(readFileSync(file, "utf8")).toBe("keep");
    expect(existsSync(path.join(tempRoot.folder, "cards"))).toBe(false);
  });

  it("folderId 與殼記錄的不符：mismatch，不寫入", () => {
    const tempRoot = temp();
    const first = open(tempRoot);
    const identityBefore = readFileSync(folderIdentityPath(first.layout), "utf8");
    first.close();
    const manager = new FolderManager(new FolderLayout(tempRoot.folder));
    const result = manager.open({ expectedFolderId: "01OTHERFOLDER000000000000000" });
    expect(result.state).toBe("mismatch");
    expect(result.reason).toBe("folder_mismatch");
    expect(readFileSync(folderIdentityPath(first.layout), "utf8")).toBe(identityBefore);
  });

  it("state 目錄或資料庫不見了：mismatch，不自動重建", () => {
    const tempRoot = temp();
    const first = open(tempRoot);
    first.close();
    rmSync(path.join(tempRoot.folder, "cards"), { recursive: true, force: true });
    const manager = new FolderManager(new FolderLayout(tempRoot.folder));
    expect(manager.open().reason).toBe("structure_missing");

    const secondTemp = temp();
    const second = open(secondTemp);
    second.close();
    rmSync(path.join(secondTemp.folder, "state/cardiary.sqlite"), { force: true });
    const secondManager = new FolderManager(new FolderLayout(secondTemp.folder));
    const result = secondManager.open();
    expect(result.state).toBe("mismatch");
    expect(result.reason).toBe("state_missing");
  });
});

describe("可重建的區域", () => {
  it("cache、tmp、logs 不見了會自動重建", () => {
    const tempRoot = temp();
    const first = open(tempRoot);
    first.close();
    for (const name of ["cache", "tmp", "logs"]) {
      rmSync(path.join(tempRoot.folder, name), { recursive: true, force: true });
    }
    const second = open(tempRoot);
    expect(second.folderState).toBe("ready");
    for (const name of ["cache", "tmp", "logs"]) {
      expect(existsSync(path.join(tempRoot.folder, name)), name).toBe(true);
    }
  });

  it("刪除整個快取區後重新啟動，快取資料庫以正確 header 重建", () => {
    const tempRoot = temp();
    const first = open(tempRoot);
    first.cache.exec("CREATE TABLE cache_marker (value TEXT)");
    first.cache.run("INSERT INTO cache_marker (value) VALUES ('old')");
    first.close();
    rmSync(path.join(tempRoot.folder, "cache"), { recursive: true, force: true });

    const second = open(tempRoot);
    expect(second.folderState).toBe("ready");
    expect(existsSync(path.join(tempRoot.folder, "cache/index.sqlite"))).toBe(true);
    expect(Number(second.cache.pragma("application_id"))).toBe(CACHE_APPLICATION_ID);
    expect(Number(second.cache.pragma("user_version"))).toBe(CACHE_SCHEMA_VERSION);
    expect(second.cache.tableExists("cache_marker")).toBe(false);
    expect(second.state.get("SELECT 1 AS ok")).toEqual({ ok: 1 });
  });
});

describe("執行中的資料夾監控", () => {
  it("資料夾消失時發出暫停通知，恢復後發出續跑通知", () => {
    const tempRoot = temp();
    const storage = open(tempRoot);
    const moved = path.join(tempRoot.root, "Cardiary-moved");
    renameSync(tempRoot.folder, moved);
    expect(storage.folder.poll()).toEqual({ type: "pause", reason: "missing" });
    expect(storage.folder.state).toBe("unavailable");
    renameSync(moved, tempRoot.folder);
    expect(storage.folder.poll()).toEqual({ type: "resume" });
    expect(storage.folder.state).toBe("ready");
  });
});

describe("狀態機與協定對照", () => {
  it("只允許設計表上的轉換", () => {
    const machine = new FolderStateMachine();
    expect(machine.transition("verifying")).toBe("verifying");
    expect(machine.transition("ready")).toBe("ready");
    expect(machine.transition("paused")).toBe("paused");
    expect(machine.transition("verifying")).toBe("verifying");
    expect(machine.transition("ready")).toBe("ready");
    expect(() => machine.transition("unselected")).toThrowError(/不允許/);
    expect(machine.transition("unavailable")).toBe("unavailable");
    expect(machine.transition("verifying")).toBe("verifying");
    expect(machine.transition("mismatch")).toBe("mismatch");
  });

  it("八態對 SystemStatus 的對照表一致", () => {
    const common = { displayName: "Cardiary" };
    expect(toSystemStatus("unselected", common)).toEqual({
      folder: { state: "not_selected", displayName: "Cardiary", writable: false },
      service: null,
    });
    expect(toSystemStatus("verifying", common)).toEqual({
      folder: { state: "ready", displayName: "Cardiary", writable: false, reason: "verifying" },
      service: { state: "degraded" },
    });
    expect(toSystemStatus("ready", common)).toEqual({
      folder: { state: "ready", displayName: "Cardiary", writable: true },
      service: { state: "running" },
    });
    expect(toSystemStatus("paused", { ...common, reason: "unmounting" })).toEqual({
      folder: { state: "ready", displayName: "Cardiary", writable: true, reason: "unmounting" },
      service: { state: "paused" },
    });
    expect(toSystemStatus("unavailable", { ...common, reason: "missing" })).toEqual({
      folder: { state: "unavailable", displayName: "Cardiary", writable: false, reason: "missing" },
      service: { state: "paused" },
    });
    expect(toSystemStatus("mismatch", common)).toEqual({
      folder: {
        state: "unavailable",
        displayName: "Cardiary",
        writable: false,
        reason: "mismatch",
      },
      service: { state: "degraded" },
    });
    expect(toSystemStatus("migrating", common)).toEqual({
      folder: {
        state: "unavailable",
        displayName: "Cardiary",
        writable: false,
        reason: "migrating",
      },
      service: { state: "paused" },
    });
    expect(toSystemStatus("migration-failed", common)).toEqual({
      folder: {
        state: "unavailable",
        displayName: "Cardiary",
        writable: false,
        reason: "migration_failed",
      },
      service: { state: "degraded" },
    });
    expect(toSystemStatus("unavailable", { ...common, serviceActive: false })).toEqual({
      folder: { state: "unavailable", displayName: "Cardiary", writable: false },
      service: null,
    });
  });
});

describe("儲存失效", () => {
  it("資料庫讀寫錯誤標成 storage-failed 並停止寫入，不重開失效的資料庫", () => {
    const tempRoot = temp();
    const storage = open(tempRoot);
    storage.events.append({ stream: "system", kind: "system.status", payload: { ok: true } });
    storage.state.failForTests(new Error("SQLITE_IOERR: disk I/O error"));
    expect(storage.state.failed).toBe(true);
    expect(storage.folder.state).toBe("unavailable");
    expect(storage.folder.reason).toBe("io_error");
    expect(() =>
      storage.events.append({ stream: "system", kind: "system.status", payload: { after: true } }),
    ).toThrowError(/storage-failed/);
    expect(() => storage.state.reopen()).toThrowError(StorageError);
    try {
      storage.state.reopen();
    } catch (error) {
      expect((error as StorageError).code).toBe("storage-failed");
    }
  });
});

describe("檔案系統與鎖檔", () => {
  it("非 APFS 只回警告，不阻擋", () => {
    const tempRoot = temp();
    const storage = open(tempRoot);
    storage.close();
    const storage2 = Storage.open({
      path: tempRoot.folder,
      statfs: () => ({ type: 0 }),
    });
    cleanups.push(() => storage2.close());
    expect(storage2.folderState).toBe("ready");
    expect(storage2.folderResult.warnings.map((warning) => warning.code)).toContain(
      "non-apfs-filesystem",
    );
  });

  it("同一個資料夾只允許一個服務行程", () => {
    const tempRoot = temp();
    const first = open(tempRoot);
    const second = new FolderManager(new FolderLayout(tempRoot.folder));
    const result = second.open();
    expect(result.state).toBe("unavailable");
    expect(result.reason).toBe("already_running");
    first.close();
    const third = new FolderManager(new FolderLayout(tempRoot.folder));
    expect(third.open().state).toBe("ready");
    third.close();
  });
});
