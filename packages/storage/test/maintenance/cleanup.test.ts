import { createHash } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CardFileStore,
  CardIndexStore,
  FolderLayout,
  StorageCleanup,
  StorageError,
  type Storage,
} from "../../src/index.js";
import { createTempRoot, openTestStorage, type TempRoot } from "../helpers/temp.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

function fixture(options: { readonly activeToolCalls?: () => number } = {}): {
  temp: TempRoot;
  storage: Storage;
  layout: FolderLayout;
  cleanup: StorageCleanup;
} {
  const temp = createTempRoot("cleanup");
  const storage = openTestStorage(temp);
  cleanups.push(() => {
    storage.close();
    temp.cleanup();
  });
  return {
    temp,
    storage,
    layout: storage.layout,
    cleanup: new StorageCleanup({
      layout: storage.layout,
      cache: () => storage.cache,
      ...(options.activeToolCalls === undefined
        ? {}
        : { activeToolCalls: options.activeToolCalls }),
    }),
  };
}

function put(layout: FolderLayout, relativePath: string, content: string): void {
  const absolute = layout.absolute(relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function totalBytes(layout: FolderLayout): number {
  return layout
    .listTree(layout.root)
    .filter((entry) => !entry.isDirectory)
    .reduce((sum, entry) => sum + entry.size, 0);
}

describe("儲存用量", () => {
  it("六類用量加總等於資料夾實際檔案大小，正本不可清", () => {
    const { layout, cleanup } = fixture();
    put(layout, "cards/a.md", "card");
    put(layout, "assets/a.png", "asset");
    put(layout, "cache/thumb.bin", "cache");
    put(layout, "state/data.json", "state");
    put(layout, "logs/host.log", "log");
    put(layout, "tmp/scratch.txt", "temp");

    const usage = cleanup.usage();
    expect(usage.map((item) => item.category)).toEqual([
      "cards",
      "assets",
      "cache",
      "state",
      "logs",
      "tmp",
    ]);
    expect(usage.reduce((sum, item) => sum + item.bytes, 0)).toBe(totalBytes(layout));
    for (const item of usage) {
      if (item.category === "cards" || item.category === "assets" || item.category === "state") {
        expect(item.cleanableBytes, item.category).toBe(0);
      }
    }
    expect(usage.find((item) => item.category === "tmp")?.cleanableBytes).toBe(4);
  });
});

describe("清理白名單", () => {
  it("拒絕正本與未知類別，連空清單也拒絕", () => {
    const { cleanup } = fixture();
    for (const category of ["cards", "assets", "boards", "skills", "state", "modules", "nope"]) {
      expect(() => cleanup.preview([category]), category).toThrowError(StorageError);
      expect(() => cleanup.apply([category]), category).toThrowError(StorageError);
    }
    expect(() => cleanup.preview([])).toThrowError(/非空陣列/);
  });

  it("沒預覽不能執行，預覽後目標變了也不能執行", () => {
    const { layout, cleanup } = fixture();
    put(layout, "cache/a.bin", "a");
    expect(() => cleanup.apply(["cache"])).toThrowError(/必須先預覽/);

    expect(cleanup.preview(["cache"]).targets).toEqual([{ category: "cache", items: 1, bytes: 1 }]);
    put(layout, "cache/b.bin", "b");
    expect(() => cleanup.apply(["cache"])).toThrowError(/目標已改變/);
    expect(existsSync(layout.absolute("cache/a.bin"))).toBe(true);
    expect(existsSync(layout.absolute("cache/b.bin"))).toBe(true);
  });

  it("只有預覽允許的類別會被刪除，預覽與實際清單一致並留紀錄", () => {
    const { layout, cleanup } = fixture();
    put(layout, "cache/a.bin", "abc");
    put(layout, "tmp/a.txt", "hello");
    put(layout, "logs/a.log", "log");
    put(layout, "cards/keep.md", "keep");
    put(layout, "state/settings.json", "{}");

    const preview = cleanup.preview(["cache", "temp", "logs"]);
    expect(preview.targets).toEqual([
      { category: "cache", items: 1, bytes: 3 },
      { category: "temp", items: 1, bytes: 5 },
      { category: "logs", items: 1, bytes: 3 },
    ]);
    const applied = cleanup.apply(["cache", "temp", "logs"]);
    expect(applied.targets).toEqual(preview.targets);
    expect(applied.totalBytes).toBe(preview.totalBytes);
    expect(existsSync(layout.absolute("cache/a.bin"))).toBe(false);
    expect(existsSync(layout.absolute("tmp/a.txt"))).toBe(false);
    expect(existsSync(layout.absolute("logs/a.log"))).toBe(false);
    expect(readFileSync(layout.absolute("cards/keep.md"), "utf8")).toBe("keep");
    expect(existsSync(layout.absolute("state/settings.json"))).toBe(true);

    const record = JSON.parse(
      readFileSync(layout.absolute("state/storage-cleanup.json"), "utf8"),
    ) as { recordId: string; targets: unknown; totalBytes: number };
    expect(record.recordId).toBe(applied.recordId);
    expect(record.targets).toEqual(applied.targets);
    expect(record.totalBytes).toBe(applied.totalBytes);
  });

  it("快取索引資料庫本身不會被 cache 清理刪除", () => {
    const { layout, storage, cleanup } = fixture();
    new CardIndexStore({ db: storage.cache });
    put(layout, "cache/thumb.bin", "abc");
    expect(cleanup.preview(["cache"]).targets[0]).toEqual({
      category: "cache",
      items: 1,
      bytes: 3,
    });
    cleanup.apply(["cache"]);
    expect(existsSync(layout.absolute("cache/thumb.bin"))).toBe(false);
    expect(existsSync(layout.absolute("cache/index.sqlite"))).toBe(true);
  });

  it("MCP 工具快取算進 cache 類別，清掉之後可以重建", () => {
    const { layout, cleanup } = fixture();
    const content = JSON.stringify({ version: 1, serverId: "local", tools: [] });
    put(layout, "cache/mcp/local/tools.json", content);
    expect(cleanup.preview(["cache"]).targets[0]).toEqual({
      category: "cache",
      items: 1,
      bytes: Buffer.byteLength(content),
    });
    cleanup.apply(["cache"]);
    expect(existsSync(layout.absolute("cache/mcp/local/tools.json"))).toBe(false);
  });
});

describe("符號連結與執行中的暫存", () => {
  it("快取裡的符號連結只刪連結，區外目標不動", () => {
    const { temp, layout, cleanup } = fixture();
    const outside = path.join(temp.root, "outside.txt");
    writeFileSync(outside, "outside");
    symlinkSync(outside, layout.absolute("cache/link"));
    const preview = cleanup.preview(["cache"]);
    expect(preview.targets[0]?.category).toBe("cache");
    expect(preview.targets[0]?.items).toBe(1);
    expect(preview.targets[0]?.bytes).toBeGreaterThan(0);
    cleanup.apply(["cache"]);
    expect(existsSync(layout.absolute("cache/link"))).toBe(false);
    expect(readFileSync(outside, "utf8")).toBe("outside");
  });

  it("硬連結不列入預覽也不刪除", () => {
    const { temp, layout, cleanup } = fixture();
    const outside = path.join(temp.root, "hardlink.txt");
    writeFileSync(outside, "same inode");
    linkSync(outside, layout.absolute("cache/hard.txt"));
    expect(cleanup.preview(["cache"]).targets[0]).toEqual({
      category: "cache",
      items: 0,
      bytes: 0,
    });
    cleanup.apply(["cache"]);
    expect(readFileSync(outside, "utf8")).toBe("same inode");
    expect(existsSync(layout.absolute("cache/hard.txt"))).toBe(true);
  });

  it("工具還在執行時不清它產生的暫存", () => {
    const { layout, cleanup } = fixture({ activeToolCalls: () => 1 });
    put(layout, "tmp/tmp-abc123/pi-output-session.log", "running");
    put(layout, "tmp/other.txt", "done");
    expect(cleanup.preview(["temp"]).targets[0]).toEqual({
      category: "temp",
      items: 1,
      bytes: 4,
    });
    cleanup.apply(["temp"]);
    expect(existsSync(layout.absolute("tmp/tmp-abc123/pi-output-session.log"))).toBe(true);
    expect(existsSync(layout.absolute("tmp/other.txt"))).toBe(false);
  });
});

describe("清除後重啟", () => {
  it("清除可重建的索引後關閉再重開，索引表可重新寫入", () => {
    // indexedRecord 是測試手工建好的紀錄，直接交給 CardIndexStore.rebuild；
    // 這裡沒有從 cards/ 掃描檔案重建索引。檔案掃描重建由
    // packages/host/test/modules/cards/library.test.ts 與
    // packages/contract-tests/cards/cards.test.ts 覆蓋。
    const temp = createTempRoot("cleanup-restart");
    cleanups.push(temp.cleanup);

    const cardId = "01J00000000000000000000005";
    const cardText = `---\nid: ${cardId}\n---\n\n重啟前寫下的卡片內容\n`;

    const storage = openTestStorage(temp);
    let storageOpen: Storage | undefined = storage;
    cleanups.push(() => storageOpen?.close());

    const files = new CardFileStore({ layout: storage.layout });
    files.ensureDirectory();
    files.write({ cardId, text: cardText });
    const contentHash = createHash("sha256").update(cardText).digest("hex");
    const fileStat = statSync(storage.layout.absolute(`cards/${cardId}.md`));
    const indexedRecord = {
      cardId,
      path: `cards/${cardId}.md`,
      mtimeMs: Math.trunc(fileStat.mtimeMs),
      sizeBytes: fileStat.size,
      contentHash,
      indexedAt: "2026-11-15T00:00:00.000Z",
      broken: false as const,
      revision: "rev-1",
      kind: "note",
      title: "重啟測試",
      body: "重啟前寫下的卡片內容",
      tags: [],
      sources: [],
      links: [],
      persona: "default",
      createdAt: "2026-11-15T00:00:00.000Z",
    };
    const index = new CardIndexStore({ db: storage.cache });
    index.upsert(indexedRecord);
    expect(index.count()).toBe(1);

    const cleanup = new StorageCleanup({
      layout: storage.layout,
      cache: () => storage.cache,
    });
    cleanup.preview(["indexes"]);
    cleanup.apply(["indexes"]);
    expect(storage.cache.countRows("card_index")).toBe(0);

    storage.close();
    storageOpen = undefined;

    const reopened = openTestStorage(temp);
    storageOpen = reopened;
    try {
      expect(reopened.folderState).toBe("ready");
      const reopenedFiles = new CardFileStore({ layout: reopened.layout });
      expect(reopenedFiles.read(cardId)?.text).toBe(cardText);
      const reopenedIndex = new CardIndexStore({ db: reopened.cache });
      expect(reopened.cache.countRows("card_index")).toBe(0);
      reopenedIndex.rebuild([indexedRecord]);
      expect(reopenedIndex.get(cardId)?.title).toBe("重啟測試");
    } finally {
      reopened.close();
      storageOpen = undefined;
    }
  });
});

describe("可重建索引", () => {
  it("清空索引表但保留快取資料庫，預覽與實際釋放空間一致", () => {
    const { storage, cleanup } = fixture();
    const index = new CardIndexStore({ db: storage.cache });
    index.putAssetMeta({ assetId: "asset-1", mediaType: "image/png", sizeBytes: 1 });
    index.setReady(true);
    storage.cache.run(
      `INSERT INTO card_index
         (card_id, path, mtime_ms, size_bytes, content_hash, revision, kind, title, title_norm,
          summary, created_at, updated_at, persona, asset_id, supersedes, broken, broken_reason, indexed_at)
       VALUES ('card-1', 'cards/card-1.md', 1, 1, 'hash', '', 'note', '卡', '卡',
               NULL, '2026-01-01T00:00:00.000Z', NULL, 'default', NULL, NULL, 0, NULL, '2026-01-01T00:00:00.000Z')`,
    );

    const preview = cleanup.preview(["indexes"]);
    expect(preview.targets[0]?.category).toBe("indexes");
    expect(preview.targets[0]?.items).toBeGreaterThan(0);
    const applied = cleanup.apply(["indexes"]);
    expect(applied.targets).toEqual(preview.targets);
    expect(storage.cache.countRows("card_index")).toBe(0);
    expect(existsSync(storage.layout.absolute("cache/index.sqlite"))).toBe(true);
  });
});
