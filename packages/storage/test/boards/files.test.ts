import { writeFileSync, utimesSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createBoard, newCardId, projectCard } from "@cardiary/domain";

import { StorageError } from "../../src/errors.js";
import { BoardFileStore } from "../../src/boards/files.js";
import { FolderLayout } from "../../src/paths.js";
import { createTempRoot } from "../helpers/temp.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

const clockMs = Date.UTC(2026, 0, 1);

function setup(label = "boards-files"): {
  temp: ReturnType<typeof createTempRoot>;
  store: BoardFileStore;
} {
  const temp = createTempRoot(label);
  cleanups.push(temp.cleanup);
  const layout = new FolderLayout(temp.folder);
  const store = new BoardFileStore({
    layout,
    now: () => new Date(clockMs),
  });
  store.ensureDirectory();
  return { temp, store };
}

function sampleBoard(updatedAt = "2026-01-01T00:00:00.000Z") {
  return projectCard({
    board: createBoard({ id: newCardId(), title: "我的白板", now: updatedAt }),
    itemId: newCardId(),
    cardId: newCardId(),
    position: { x: 12, y: 34 },
    now: updatedAt,
  });
}

describe("BoardFileStore", () => {
  it("寫入後能原樣讀回，檔案落在 boards/<id>.json", () => {
    const { temp, store } = setup();
    const board = sampleBoard();
    const entry = store.write(board);

    expect(entry.boardId).toBe(board.id);
    expect(entry.fileName).toBe(`${board.id}.json`);
    expect(store.read(board.id)?.board).toEqual(board);
    expect(store.list().map((item) => item.boardId)).toEqual([board.id]);
    expect(store.listIds()).toEqual([board.id]);
    expect(temp.folder).toBeTruthy();
  });

  it("舊白板預設空收件區與畫布來源", () => {
    const { store } = setup();
    const board = sampleBoard();
    const oldJson = JSON.stringify(board, (key, value: unknown) =>
      key === "inbox" || key === "origin" ? undefined : value,
    );
    writeFileSync(store.absolutePath(board.id), oldJson);

    const loaded = store.read(board.id)?.board;
    expect(loaded?.inbox).toEqual([]);
    expect(loaded?.items[0]?.origin).toBe("canvas");
  });

  it("代理投影保留在收件區並記錄來源", () => {
    const { store } = setup();
    const board = sampleBoard();
    const inboxItem = {
      ...board.items[0]!,
      origin: "inbox" as const,
      projectedBy: "agent" as const,
    };
    const updated = { ...board, items: [], inbox: [inboxItem] };
    store.write(updated);

    expect(store.read(board.id)?.board).toEqual(updated);
  });

  it("不存在的白板回 undefined，刪除後也回 undefined", () => {
    const { store } = setup();
    const board = sampleBoard();
    expect(store.read(board.id)).toBeUndefined();
    store.write(board);
    expect(store.remove(board.id)).toBe(true);
    expect(store.read(board.id)).toBeUndefined();
    expect(store.remove(board.id)).toBe(false);
  });

  it("白板 id 不可逃出 boards/ 目錄", () => {
    const { store } = setup();
    expect(() => store.absolutePath("../cards/secret.json")).toThrow(StorageError);
    expect(() => store.absolutePath("/etc/passwd")).toThrow(StorageError);
    expect(() => store.absolutePath("..\u0000")).toThrow(StorageError);
  });

  it("樂觀鎖：expectedUpdatedAt 過期時拒絕寫入", () => {
    const { store } = setup();
    const board = sampleBoard();
    store.write(board);
    const stale = { ...board, updatedAt: "2025-01-01T00:00:00.000Z" };
    try {
      store.write(stale, { expectedUpdatedAt: "2025-01-01T00:00:00.000Z" });
      throw new Error("預期衝突");
    } catch (error) {
      expect(error).toBeInstanceOf(StorageError);
      expect((error as StorageError).details["reason"]).toBe("conflict");
    }
    // 原本的檔案沒有被覆寫。
    expect(store.read(board.id)?.board).toEqual(board);
  });

  it("損壞的 JSON 回 invalid-input，不回 undefined", () => {
    const { store } = setup();
    const board = sampleBoard();
    writeFileSync(store.absolutePath(board.id), "{not json");
    try {
      store.read(board.id);
      throw new Error("預期讀取失敗");
    } catch (error) {
      expect(error).toBeInstanceOf(StorageError);
      expect((error as StorageError).code).toBe("invalid-input");
    }
  });

  it("格式正確但欄位不合法的白板也拒絕讀取", () => {
    const { store } = setup();
    const board = sampleBoard();
    writeFileSync(
      store.absolutePath(board.id),
      JSON.stringify({ ...board, items: [{ ...board.items[0]!, pinned: "yes" }] }),
    );
    try {
      store.read(board.id);
      throw new Error("預期讀取失敗");
    } catch (error) {
      expect(error).toBeInstanceOf(StorageError);
      expect((error as StorageError).code).toBe("invalid-input");
    }
  });

  it("啟動清暫存檔只刪老舊的 .tmp-*", () => {
    const { store } = setup();
    const board = sampleBoard();
    store.write(board);
    const oldTemp = path.join(store.directory, `.tmp-${board.id}.aaaaaaaa.tmp`);
    const freshTemp = path.join(store.directory, `.tmp-${board.id}.bbbbbbbb.tmp`);
    writeFileSync(oldTemp, "{}");
    writeFileSync(freshTemp, "{}");
    utimesSync(oldTemp, new Date(clockMs - 3_600_001), new Date(clockMs - 3_600_001));

    expect(store.cleanupTempFiles()).toEqual([`.tmp-${board.id}.aaaaaaaa.tmp`]);
    expect(store.read(board.id)?.board).toEqual(board);
  });
});
