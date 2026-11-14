import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  Database,
  STATE_APPLICATION_ID,
  Storage,
  fullVacuumAndMeasure,
  incrementalVacuumAndCheckpoint,
  newUlid,
  nowIso,
} from "../src/index.js";
import { byteSearch } from "../src/testing.js";
import { EngineFixture } from "./helpers/engine.js";
import { createTempRoot, openTestStorage, type TempRoot } from "./helpers/temp.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

const MARKER = "RECOVERY_MARKER_8d7c6b5a";

function temp(label = "recovery"): TempRoot {
  const root = createTempRoot(label);
  cleanups.push(root.cleanup);
  return root;
}

function open(tempRoot: TempRoot): Storage {
  const storage = openTestStorage(tempRoot);
  cleanups.push(() => storage.close());
  return storage;
}

function seedSmall(storage: Storage): EngineFixture {
  const engine = new EngineFixture(storage.engine.filePath);
  cleanups.push(() => engine.close());
  engine.insertConversation(1, { text: `${MARKER} root` });
  engine.insertConversation(2, { parentId: 1, text: `${MARKER} branch` });
  engine.insertEntry(10, 1, `${MARKER} entry`);
  engine.insertEntry(20, 2, `${MARKER} branch entry`);
  engine.insertClientRequestIndexes(1, "req-recovery", 500, 501);
  storage.events.append({
    stream: "session:1",
    kind: "stream.turn_started",
    payload: { marker: MARKER },
  });
  storage.turns.record({
    turnId: "turn_1",
    conversationId: "1",
    triggerMessageId: "message-1",
    startedAt: nowIso(),
  });
  return engine;
}

describe("刪除意圖與啟動恢復", () => {
  it("Cardiary 交易提交後中斷：重開後在開 Harness 之前完成刪除", async () => {
    const tempRoot = temp();
    const first = open(tempRoot);
    const engine = seedSmall(first);
    await expect(
      first.deletions.deleteConversation("1", {
        onAfterCardiaryCommit: () => {
          throw new Error("simulated crash");
        },
      }),
    ).rejects.toThrowError("simulated crash");

    const intent = first.deletions.getIntent("1");
    expect(intent?.phase).toBe("rows");
    expect(engine.count("SELECT COUNT(*) AS n FROM conversations WHERE id IN (1, 2)")).toBe(2);
    expect(first.events.count("session:1")).toBe(0);
    first.close();

    const second = open(tempRoot);
    const order: string[] = [];
    const recovered = await second.deletions.recoverAtStartup({
      openHarness: async () => {
        order.push("harness");
        expect(second.deletions.getIntent("1")).toBeNull();
        expect(
          second.engine.get<{ n: number }>(
            "SELECT COUNT(*) AS n FROM conversations WHERE id IN (1, 2)",
          )?.n,
        ).toBe(0);
        expect(second.events.count("session:1")).toBe(0);
      },
    });
    expect(recovered).toBe(1);
    expect(order).toEqual(["harness"]);
    expect(byteSearch(tempRoot.folder, [MARKER])).toEqual([]);
  });

  it("Cardiary 交易提交後、檔案刪一半：恢復完成列刪除，孤兒檔由掃描回收", async () => {
    const tempRoot = temp();
    const first = open(tempRoot);
    const engine = seedSmall(first);
    const cacheDir = path.join(tempRoot.folder, "cache/thumbs");
    mkdirSync(cacheDir, { recursive: true });
    const firstFile = path.join(cacheDir, "a.png");
    const secondFile = path.join(cacheDir, "b.png");
    writeFileSync(firstFile, `${MARKER}-a`);
    writeFileSync(secondFile, `${MARKER}-b`);
    first.registry.register({
      relPath: "cache/thumbs/a.png",
      ownerKind: "conversation",
      ownerId: "1",
    });
    first.registry.register({
      relPath: "cache/thumbs/b.png",
      ownerKind: "conversation",
      ownerId: "1",
    });

    await expect(
      first.deletions.deleteConversation("1", {
        onAfterFileDelete: () => {
          throw new Error("crash after one file");
        },
      }),
    ).rejects.toThrowError("crash after one file");
    expect(first.deletions.getIntent("1")?.phase).toBe("rows");
    expect(existsSync(firstFile) || existsSync(secondFile)).toBe(true);
    first.close();

    const second = open(tempRoot);
    await second.deletions.recoverAtStartup({});
    expect(second.deletions.getIntent("1")).toBeNull();
    expect(engine.count("SELECT COUNT(*) AS n FROM conversations WHERE id IN (1, 2)")).toBe(0);
    // 設計接受的窗口：登記列已刪、孤兒檔還在，等掃描回收。
    expect(byteSearch(tempRoot.folder, [MARKER]).length).toBeGreaterThan(0);
    second.registry.scan({ now: new Date() });
    expect(byteSearch(tempRoot.folder, [MARKER])).toEqual([]);
  });

  it("真空階段中斷：只重做 checkpoint／incremental_vacuum／integrity_check，不重刪列", async () => {
    const tempRoot = temp();
    const first = open(tempRoot);
    const engine = seedSmall(first);
    await expect(
      first.deletions.deleteConversation("1", {
        onVacuumStart: () => {
          throw new Error("crash before vacuum");
        },
      }),
    ).rejects.toThrowError("crash before vacuum");
    expect(first.deletions.getIntent("1")?.phase).toBe("vacuum");
    expect(engine.count("SELECT COUNT(*) AS n FROM conversations WHERE id IN (1, 2)")).toBe(0);
    first.close();

    const second = open(tempRoot);
    // phase=vacuum 的重跑不得再碰資料列：模擬恢復途中新增的一列必須留著。
    second.state.run(
      "INSERT INTO approvals (id, approval_key, scope, session_id, turn_id, tool_name, action_kind, status, request_json, requested_at) VALUES (?, 'sentinel', 'tool', '1', 'turn_sentinel', 'bash', 'tool-execution', 'pending', '{}', ?)",
      newUlid(),
      nowIso(),
    );
    const recovered = await second.deletions.recoverAtStartup({});
    expect(recovered).toBe(1);
    expect(second.deletions.getIntent("1")).toBeNull();
    expect(
      second.state.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM approvals WHERE approval_key = 'sentinel'",
      )?.n,
    ).toBe(1);
    expect(second.state.integrityCheck()).toBe("ok");
    expect(second.engine.integrityCheck()).toBe("ok");
  });

  it("恢復是冪等的：沒有意圖列時不會做任何事", async () => {
    const storage = open(temp());
    expect(await storage.deletions.recoverAtStartup({})).toBe(0);
  });
});

describe("B1 刪除殘留與 secure_delete", () => {
  function makeDatabase(secureDelete: boolean): { db: Database; filePath: string } {
    const directory = mkdtempSync(path.join(tmpdir(), "secure-delete-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, "probe.sqlite");
    const db = Database.open(filePath, {
      create: { applicationId: STATE_APPLICATION_ID, autoVacuum: "incremental" },
      busyTimeoutMs: 5000,
      secureDelete: false,
    });
    if (secureDelete) {
      db.exec("PRAGMA secure_delete = ON");
    } else {
      db.exec("PRAGMA secure_delete = OFF");
    }
    db.exec("CREATE TABLE probe (id INTEGER PRIMARY KEY, body TEXT NOT NULL) STRICT");
    return { db, filePath };
  }

  function countMarker(filePath: string): number {
    const content = readFileSync(filePath);
    const needle = Buffer.from(MARKER, "utf8");
    let count = 0;
    let index = 0;
    while (index <= content.length - needle.length) {
      const found = content.indexOf(needle, index);
      if (found === -1) {
        break;
      }
      count += 1;
      index = found + needle.length;
    }
    return count;
  }

  it("對照組：secure_delete=OFF 時刪除加 checkpoint 仍找得到標記；ON 時 0 殘留", () => {
    const off = makeDatabase(false);
    const on = makeDatabase(true);
    for (const { db } of [off, on]) {
      for (let index = 0; index < 200; index += 1) {
        db.run("INSERT INTO probe (body) VALUES (?)", `${MARKER}-${index}-${"x".repeat(400)}`);
      }
      db.run("DELETE FROM probe");
      db.checkpoint();
    }
    expect(countMarker(off.filePath)).toBeGreaterThan(0);
    expect(countMarker(on.filePath)).toBe(0);
    off.db.close();
    on.db.close();
  });
});

describe("縮檔後再 checkpoint 才量大小", () => {
  function seededDatabase(): { db: Database; filePath: string } {
    const directory = mkdtempSync(path.join(tmpdir(), "vacuum-probe-"));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, "vacuum.sqlite");
    const db = Database.open(filePath, {
      create: { applicationId: STATE_APPLICATION_ID, autoVacuum: "incremental" },
      busyTimeoutMs: 5000,
    });
    db.exec("CREATE TABLE probe (id INTEGER PRIMARY KEY, body TEXT NOT NULL) STRICT");
    db.transaction((tx) => {
      for (let index = 0; index < 3000; index += 1) {
        tx.run("INSERT INTO probe (body) VALUES (?)", `${MARKER}-${index}-${"y".repeat(300)}`);
      }
    });
    db.checkpoint();
    return { db, filePath };
  }

  it("incremental_vacuum 之後再 checkpoint，主檔下降而不是只縮 WAL", () => {
    const { db } = seededDatabase();
    db.run("DELETE FROM probe");
    db.checkpoint();
    const before = db.fileSize();
    const freed = incrementalVacuumAndCheckpoint(db);
    expect(freed).toBeGreaterThan(0);
    expect(db.fileSize()).toBeLessThan(before);
    const wal = `${db.filePath}-wal`;
    expect(statSync(wal).size).toBe(0);
    expect(db.integrityCheck()).toBe("ok");
    db.close();
  });

  it("完整 VACUUM 之後再 checkpoint，主檔再下降且 WAL 清空", () => {
    const { db } = seededDatabase();
    db.run("DELETE FROM probe");
    db.checkpoint();
    incrementalVacuumAndCheckpoint(db);
    const beforeVacuum = db.fileSize();
    const after = fullVacuumAndMeasure(db);
    expect(after).toBeLessThanOrEqual(beforeVacuum);
    expect(statSync(`${db.filePath}-wal`).size).toBe(0);
    expect(Number(db.pragma("freelist_count"))).toBe(0);
    db.close();
  });
});
