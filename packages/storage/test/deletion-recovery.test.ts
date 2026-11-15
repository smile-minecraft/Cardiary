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
  CardIndexStore,
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

  it("崩潰後依意圖的 card_ids 與 asset_ids 補刪卡片檔", async () => {
    const tempRoot = temp();
    const first = open(tempRoot);
    const engine = seedSmall(first);
    const cardsDirectory = path.join(tempRoot.folder, "cards");
    const assetsDirectory = path.join(tempRoot.folder, "assets");
    mkdirSync(cardsDirectory, { recursive: true });
    mkdirSync(assetsDirectory, { recursive: true });
    const exclusive = "01RECOVERYCARD000000000001";
    const shared = "01RECOVERYCARD000000000002";
    const pinned = "01RECOVERYCARD000000000003";
    const exclusiveAsset = `${"a".repeat(63)}1`;
    const sharedAsset = `${"b".repeat(63)}2`;
    const pinnedAsset = `${"c".repeat(63)}3`;
    const writeCard = (cardId: string, assetId: string): void => {
      writeFileSync(
        path.join(cardsDirectory, `${cardId}.md`),
        [
          "---",
          `id: ${cardId}`,
          "kind: image",
          "title: 卡片",
          `created: ${nowIso()}`,
          `asset: assets/${assetId}.png`,
          "---",
          `${MARKER} ${cardId}`,
        ].join("\n"),
      );
      writeFileSync(path.join(assetsDirectory, `${assetId}.png`), `${MARKER} ${assetId}`);
    };
    writeCard(exclusive, exclusiveAsset);
    writeCard(shared, sharedAsset);
    writeCard(pinned, pinnedAsset);
    const now = nowIso();
    for (const [cardId, pinnedValue] of [
      [exclusive, 0],
      [shared, 0],
      [pinned, 1],
    ] as const) {
      first.state.run(
        `INSERT INTO card_state (card_id, persona, freshness, freshness_at, lifecycle, pinned, updated_at)
         VALUES (?, 'default', 100, ?, 'live', ?, ?)`,
        cardId,
        now,
        pinnedValue,
        now,
      );
    }
    const reference = (conversationId: string, cardId: string): void => {
      first.state.run(
        `INSERT INTO conversation_cards
           (conversation_id, card_id, first_loaded_at, last_loaded_at, load_count)
         VALUES (?, ?, ?, ?, 1)`,
        conversationId,
        cardId,
        now,
        now,
      );
    };
    reference("1", exclusive);
    reference("2", exclusive);
    reference("1", shared);
    reference("9", shared);
    reference("1", pinned);

    await expect(
      first.deletions.deleteConversation("1", {
        onAfterCardiaryCommit: () => {
          throw new Error("simulated crash");
        },
      }),
    ).rejects.toThrowError("simulated crash");

    const intent = first.deletions.getIntent("1");
    expect(intent?.phase).toBe("rows");
    expect(intent?.cardIds).toEqual([exclusive]);
    expect(intent?.assetIds).toEqual([exclusiveAsset]);
    // 列已提交，卡片檔還沒動：重啟後要補完。
    expect(existsSync(path.join(cardsDirectory, `${exclusive}.md`))).toBe(true);
    expect(existsSync(path.join(assetsDirectory, `${exclusiveAsset}.png`))).toBe(true);
    first.close();

    const second = open(tempRoot);
    await second.deletions.recoverAtStartup({});
    expect(second.deletions.getIntent("1")).toBeNull();
    expect(existsSync(path.join(cardsDirectory, `${exclusive}.md`))).toBe(false);
    expect(existsSync(path.join(cardsDirectory, `${shared}.md`))).toBe(true);
    expect(existsSync(path.join(cardsDirectory, `${pinned}.md`))).toBe(true);
    expect(
      second.state.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM conversation_cards WHERE card_id = ?",
        shared,
      )?.n,
    ).toBe(1);
    // 原檔依意圖的 asset_ids 補刪；共享與釘選卡片的原檔不受影響。
    expect(existsSync(path.join(assetsDirectory, `${exclusiveAsset}.png`))).toBe(false);
    expect(existsSync(path.join(assetsDirectory, `${sharedAsset}.png`))).toBe(true);
    expect(existsSync(path.join(assetsDirectory, `${pinnedAsset}.png`))).toBe(true);
    // 對整個資料夾做字串搜尋，專屬卡片與原檔的內容都不能留下。
    expect(
      byteSearch(tempRoot.folder, [`${MARKER} ${exclusive}`, `${MARKER} ${exclusiveAsset}`]),
    ).toEqual([]);
    expect(engine.count("SELECT COUNT(*) AS n FROM conversations WHERE id IN (1, 2)")).toBe(0);
  });

  it("移除意圖時順便清掉快取索引的幽靈列與原檔", async () => {
    const tempRoot = temp();
    const first = open(tempRoot);
    seedSmall(first);
    const cardsDirectory = path.join(tempRoot.folder, "cards");
    const assetsDirectory = path.join(tempRoot.folder, "assets");
    mkdirSync(cardsDirectory, { recursive: true });
    mkdirSync(assetsDirectory, { recursive: true });
    const cardId = "01RECOVERYGHOST00000000001";
    const assetId = `${"d".repeat(63)}4`;
    writeFileSync(
      path.join(cardsDirectory, `${cardId}.md`),
      [
        "---",
        `id: ${cardId}`,
        "kind: image",
        "title: 幽靈卡",
        `asset: assets/${assetId}.png`,
        "---",
        `${MARKER} ghost`,
      ].join("\n"),
    );
    writeFileSync(path.join(assetsDirectory, `${assetId}.png`), `${MARKER} ${assetId}`);
    const now = nowIso();
    first.state.run(
      `INSERT INTO card_state (card_id, persona, freshness, freshness_at, lifecycle, pinned, updated_at)
       VALUES (?, 'default', 100, ?, 'live', 0, ?)`,
      cardId,
      now,
      now,
    );
    first.state.run(
      `INSERT INTO conversation_cards
         (conversation_id, card_id, first_loaded_at, last_loaded_at, load_count)
       VALUES ('1', ?, ?, ?, 1)`,
      cardId,
      now,
      now,
    );
    const index = new CardIndexStore({ db: first.cache });
    index.putAssetMeta({ assetId, mediaType: "image/png", sizeBytes: 1 });
    first.cache.run(
      `INSERT INTO card_index
         (card_id, path, mtime_ms, size_bytes, content_hash, revision, kind, title, title_norm,
          summary, created_at, updated_at, persona, asset_id, supersedes, broken, broken_reason, indexed_at)
       VALUES (?, ?, 1, 1, 'hash', '', 'image', '幽靈卡', '幽靈卡', NULL, ?, NULL, 'default', ?, NULL, 0, NULL, ?)`,
      cardId,
      `cards/${cardId}.md`,
      now,
      assetId,
      now,
    );
    first.cache.run("INSERT INTO asset_refs (asset_id, card_id) VALUES (?, ?)", assetId, cardId);

    // 列刪完、卡片檔還在時中斷；意圖停在 vacuum，啟動由 removeIntent 收尾。
    await expect(
      first.deletions.deleteConversation("1", {
        onVacuumStart: () => {
          throw new Error("simulated crash");
        },
      }),
    ).rejects.toThrowError("simulated crash");
    expect(existsSync(path.join(cardsDirectory, `${cardId}.md`))).toBe(true);
    first.close();

    const second = open(tempRoot);
    second.deletions.removeIntent("1");
    expect(second.deletions.getIntent("1")).toBeNull();
    expect(existsSync(path.join(cardsDirectory, `${cardId}.md`))).toBe(false);
    expect(existsSync(path.join(assetsDirectory, `${assetId}.png`))).toBe(false);
    // 快取索引不留幽靈列：card.list 與原檔引用都不會再看到它。
    expect(
      second.cache.get("SELECT 1 AS one FROM card_index WHERE card_id = ?", cardId),
    ).toBeUndefined();
    expect(
      second.cache.get("SELECT 1 AS one FROM asset_refs WHERE asset_id = ?", assetId),
    ).toBeUndefined();
    expect(byteSearch(tempRoot.folder, [`${MARKER} ghost`, `${MARKER} ${assetId}`])).toEqual([]);
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
