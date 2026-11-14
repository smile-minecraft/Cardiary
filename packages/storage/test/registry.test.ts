import {
  existsSync,
  linkSync,
  mkdirSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DiagnosticLogger, Storage, StorageError } from "../src/index.js";
import { byteSearch } from "../src/testing.js";
import { createTempRoot, openTestStorage, type TempRoot } from "./helpers/temp.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

function temp(label = "registry"): TempRoot {
  const root = createTempRoot(label);
  cleanups.push(root.cleanup);
  return root;
}

function open(tempRoot: TempRoot): Storage {
  const storage = openTestStorage(tempRoot);
  cleanups.push(() => storage.close());
  return storage;
}

function write(folder: string, relativePath: string, content = "x"): string {
  const absolute = path.join(folder, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
  return absolute;
}

describe("掃描與回收", () => {
  it("未登記與過期的非正本檔案被回收；正本不受影響", () => {
    const tempRoot = temp();
    const storage = open(tempRoot);
    write(tempRoot.folder, "cache/unregistered.txt");
    write(tempRoot.folder, "cache/registered.txt");
    write(tempRoot.folder, "cache/expired.txt");
    write(tempRoot.folder, "cards/original.md", "keep");
    storage.registry.register({
      relPath: "cache/registered.txt",
      ownerKind: "index",
      sizeBytes: 1,
    });
    storage.registry.register({
      relPath: "cache/expired.txt",
      ownerKind: "task",
      ownerId: "task-1",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    storage.state.run(
      "INSERT INTO file_registry (id, zone, rel_path, owner_kind, state, created_at, renewed_at, last_used_at) VALUES ('ghost', 'cache', 'cache/missing.txt', 'index', 'live', 'now', 'now', 'now')",
    );

    const report = storage.registry.scan({ now: new Date() });
    expect(report.removedUnregistered).toBe(1);
    expect(report.removedExpired).toBe(1);
    expect(report.removedMissingRows).toBe(1);
    expect(existsSync(path.join(tempRoot.folder, "cache/unregistered.txt"))).toBe(false);
    expect(existsSync(path.join(tempRoot.folder, "cache/expired.txt"))).toBe(false);
    expect(existsSync(path.join(tempRoot.folder, "cache/registered.txt"))).toBe(true);
    expect(existsSync(path.join(tempRoot.folder, "cards/original.md"))).toBe(true);
    expect(storage.registry.get("cache/missing.txt")).toBeNull();
  });

  it("引擎溢出檔在工具執行中被跳過，任務結束後被清掉", () => {
    const tempRoot = temp();
    const storage = open(tempRoot);
    const overflow = "tmp/tmp-ABC123/pi-output-1234.log";
    write(tempRoot.folder, overflow, "output");
    write(tempRoot.folder, "tmp/other.log", "other");

    const during = storage.registry.scan({ activeToolCalls: 1 });
    expect(during.skippedOverflow).toBe(1);
    expect(existsSync(path.join(tempRoot.folder, overflow))).toBe(true);
    expect(existsSync(path.join(tempRoot.folder, "tmp/other.log"))).toBe(false);

    const after = storage.registry.scan({ activeToolCalls: 0 });
    expect(after.removedUnregistered).toBe(1);
    expect(existsSync(path.join(tempRoot.folder, overflow))).toBe(false);
  });

  it("任務結束時依時間窗清掉引擎溢出檔", () => {
    const tempRoot = temp();
    const storage = open(tempRoot);
    const inside = write(tempRoot.folder, "tmp/tmp-ABC123/pi-output-inside.log");
    const outside = write(tempRoot.folder, "tmp/tmp-DEF456/pi-output-outside.log");
    const longAgo = (Date.now() - 60 * 60 * 1000) / 1000;
    utimesSync(outside, longAgo, longAgo);
    const removed = storage.registry.cleanupToolOutputs({
      sinceMs: Date.now() - 5 * 60 * 1000,
    });
    expect(removed).toBe(1);
    expect(existsSync(inside)).toBe(false);
    expect(existsSync(outside)).toBe(true);
  });

  it("啟動時清空整個 tmp", () => {
    const tempRoot = temp();
    const storage = open(tempRoot);
    write(tempRoot.folder, "tmp/tmp-ABC123/pi-output-x.log");
    write(tempRoot.folder, "tmp/nested/deep/file.txt");
    storage.registry.register({
      relPath: "tmp/nested/deep/file.txt",
      ownerKind: "task",
      ownerId: "t",
    });
    expect(storage.registry.prepareStartup()).toBeGreaterThanOrEqual(2);
    expect(existsSync(path.join(tempRoot.folder, "tmp/tmp-ABC123"))).toBe(false);
    expect(existsSync(path.join(tempRoot.folder, "tmp/nested"))).toBe(false);
    expect(storage.registry.list().filter((row) => row.zone === "tmp")).toHaveLength(0);
  });

  it("符號連結只刪連結，目錄連結不跟隨", () => {
    const tempRoot = temp();
    const storage = open(tempRoot);
    const target = path.join(tempRoot.root, "outside-target.txt");
    writeFileSync(target, "keep");
    const targetDir = path.join(tempRoot.root, "outside-dir");
    mkdirSync(targetDir);
    writeFileSync(path.join(targetDir, "keep.txt"), "keep");
    symlinkSync(target, path.join(tempRoot.folder, "cache/file-link"));
    symlinkSync(targetDir, path.join(tempRoot.folder, "cache/dir-link"));

    const report = storage.registry.scan({ now: new Date() });
    expect(report.removedSymlinks).toBe(2);
    expect(existsSync(path.join(tempRoot.folder, "cache/file-link"))).toBe(false);
    expect(existsSync(path.join(tempRoot.folder, "cache/dir-link"))).toBe(false);
    expect(readFileSync(target, "utf8")).toBe("keep");
    expect(readFileSync(path.join(targetDir, "keep.txt"), "utf8")).toBe("keep");
  });

  it("硬連結不刪，回報為違規", () => {
    const tempRoot = temp();
    const storage = open(tempRoot);
    const target = path.join(tempRoot.root, "outside-hardlink.txt");
    writeFileSync(target, "same");
    linkSync(target, path.join(tempRoot.folder, "cache/hardlink"));
    const report = storage.registry.scan({ now: new Date() });
    expect(report.skippedHardLinks).toBe(1);
    expect(report.violations.map((violation) => violation.kind)).toContain("hard-link");
    expect(existsSync(path.join(tempRoot.folder, "cache/hardlink"))).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("same");
  });

  it("登記簿拒絕正本區的路徑", () => {
    const storage = open(temp());
    expect(() =>
      storage.registry.register({ relPath: "cards/card.md", ownerKind: "index" }),
    ).toThrowError(StorageError);
    expect(() =>
      storage.registry.register({ relPath: "../outside.txt", ownerKind: "index" }),
    ).toThrowError(StorageError);
  });
});

describe("容量淘汰與主人清理", () => {
  it("超過上限時依 last_used_at 由舊到新淘汰，索引檔不動", () => {
    const tempRoot = temp();
    const storage = open(tempRoot);
    write(tempRoot.folder, "cache/old.bin", "a".repeat(100));
    write(tempRoot.folder, "cache/new.bin", "b".repeat(100));
    storage.registry.register({
      relPath: "cache/old.bin",
      ownerKind: "index",
      sizeBytes: 100,
      now: "2026-01-01T00:00:00.000Z",
    });
    storage.registry.register({
      relPath: "cache/new.bin",
      ownerKind: "index",
      sizeBytes: 100,
      now: "2026-02-01T00:00:00.000Z",
    });
    const indexSize = storage.cache.fileSize();
    const report = storage.registry.evictCache({ limitBytes: indexSize + 100 });
    expect(report.removedFiles).toBe(1);
    expect(existsSync(path.join(tempRoot.folder, "cache/old.bin"))).toBe(false);
    expect(existsSync(path.join(tempRoot.folder, "cache/new.bin"))).toBe(true);
    expect(existsSync(path.join(tempRoot.folder, "cache/index.sqlite"))).toBe(true);
  });

  it("刪除主人的登記列與檔案，其他主人不受影響", () => {
    const tempRoot = temp();
    const storage = open(tempRoot);
    write(tempRoot.folder, "tmp/conversation-1/a.txt");
    write(tempRoot.folder, "tmp/conversation-2/b.txt");
    storage.registry.register({
      relPath: "tmp/conversation-1/a.txt",
      ownerKind: "conversation",
      ownerId: "conversation-1",
    });
    storage.registry.register({
      relPath: "tmp/conversation-2/b.txt",
      ownerKind: "conversation",
      ownerId: "conversation-2",
    });
    expect(storage.registry.purgeOwner("conversation", ["conversation-1"])).toBe(1);
    expect(existsSync(path.join(tempRoot.folder, "tmp/conversation-1/a.txt"))).toBe(false);
    expect(existsSync(path.join(tempRoot.folder, "tmp/conversation-2/b.txt"))).toBe(true);
    expect(storage.registry.listByOwner("conversation", "conversation-2")).toHaveLength(1);
  });
});

describe("診斷日誌", () => {
  it("只寫白名單欄位；內容類欄位直接被拒絕", () => {
    const tempRoot = temp();
    const storage = open(tempRoot);
    storage.logs.log("info", "turn.completed", {
      sessionId: "conversation-1",
      turnId: "turn_1",
      durationMs: 12,
      status: "completed",
    });
    expect(() =>
      storage.logs.log("info", "tool.input", { content: "DELETED_MARKER_SHOULD_NOT_LOG" }),
    ).toThrowError(/白名單/);
    const hits = byteSearch(path.join(tempRoot.folder, "logs"), ["DELETED_MARKER_SHOULD_NOT_LOG"]);
    expect(hits).toEqual([]);
  });

  it("輪替會刪掉超過天數與超過大小的舊檔", () => {
    const tempRoot = temp();
    const storage = open(tempRoot);
    const logsDir = path.join(tempRoot.folder, "logs");
    const old = path.join(logsDir, "service-2020-01-01.log");
    writeFileSync(old, "old");
    const oldTime = new Date("2020-01-01T00:00:00.000Z").getTime() / 1000;
    utimesSync(old, oldTime, oldTime);

    const logger = new DiagnosticLogger(storage.layout, { maxBytes: 10, retainDays: 7 });
    writeFileSync(path.join(logsDir, "service-2026-01-01.log"), "a".repeat(8));
    writeFileSync(path.join(logsDir, "service-2026-01-02.log"), "b".repeat(8));
    const result = logger.rotate();
    expect(result.deletedFiles).toBeGreaterThanOrEqual(2);
    expect(existsSync(old)).toBe(false);
    expect(
      readFileSync(path.join(logsDir, "service-2026-01-02.log"), "utf8").length,
    ).toBeLessThanOrEqual(8);
  });
});
