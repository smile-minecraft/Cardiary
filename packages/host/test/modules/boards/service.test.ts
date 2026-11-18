import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { newCardId } from "@cardiary/domain";
import { BoardFileStore, FolderLayout } from "@cardiary/storage";
import { afterEach, describe, expect, it } from "vitest";

import { BoardService } from "../../../src/modules/boards/service.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface CreatedCard {
  readonly cardId: string;
  readonly kind: "note";
  readonly title: string;
  readonly body: string;
  readonly sources?: readonly string[];
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), "cardiary-board-service-"));
  roots.push(root);
  const store = new BoardFileStore({ layout: new FolderLayout(root) });
  store.ensureDirectory();
  const events: unknown[] = [];
  const createdCards: CreatedCard[] = [];
  const cards = {
    async get(cardId: string) {
      return { cardId };
    },
    async create(input: CreatedCard) {
      createdCards.push(input);
      return { cardId: input.cardId };
    },
  };
  const service = new BoardService(
    store,
    () => new Date("2026-01-01T00:00:00.000Z"),
    (event) => {
      events.push(event);
    },
    cards,
  );
  return { store, service, events, createdCards };
}

describe("白板服務", () => {
  it("建立、儲存與重讀；相同毫秒內的版本也必須不同", async () => {
    const { service, store, events } = setup();
    const original = await service.create(newCardId(), "白板");
    const saved = await service.save({ ...original, title: "新名稱" }, original.updatedAt);
    expect(saved.updatedAt).not.toBe(original.updatedAt);
    expect(store.read(original.id)?.board).toEqual(saved);
    expect(events).toHaveLength(2);
    await expect(
      service.save({ ...original, title: "過期版本" }, original.updatedAt),
    ).rejects.toMatchObject({
      code: "conflict",
    });
    expect(store.read(original.id)?.board).toEqual(saved);
  });

  it("同一個 id 重送建立會拿到同一份白板，不報錯", async () => {
    const { service, events } = setup();
    const id = newCardId();
    const first = await service.create(id, "白板");
    const second = await service.create(id, "白板");
    expect(second).toEqual(first);
    expect(events).toHaveLength(1);
  });

  it("把新卡投影到收件區，重送同一個 itemId 不會多一筆", async () => {
    const { service } = setup();
    const board = await service.create(newCardId(), "白板");
    const itemId = newCardId();
    const cardId = newCardId();
    const projected = await service.project({
      boardId: board.id,
      itemId,
      cardId,
      position: { x: 0, y: 0 },
      origin: "inbox",
      projectedBy: "agent",
    });
    expect(projected.inbox).toHaveLength(1);
    expect(projected.inbox[0]).toMatchObject({
      id: itemId,
      cardId,
      origin: "inbox",
      projectedBy: "agent",
    });
    expect(projected.items).toHaveLength(0);

    const again = await service.project({
      boardId: board.id,
      itemId,
      cardId,
      position: { x: 0, y: 0 },
      origin: "inbox",
      projectedBy: "agent",
    });
    expect(again).toEqual(projected);
  });

  it("並行投影兩張卡都留得住，後寫的版本以前一次為基準", async () => {
    const { service, store } = setup();
    const board = await service.create(newCardId(), "白板");
    await Promise.all([
      service.project({
        boardId: board.id,
        itemId: newCardId(),
        cardId: newCardId(),
        position: { x: 0, y: 0 },
        origin: "canvas",
        projectedBy: "user",
      }),
      service.project({
        boardId: board.id,
        itemId: newCardId(),
        cardId: newCardId(),
        position: { x: 40, y: 40 },
        origin: "canvas",
        projectedBy: "user",
      }),
    ]);
    const stored = store.read(board.id)?.board;
    expect(stored?.items).toHaveLength(2);
    expect(stored?.updatedAt).not.toBe(board.updatedAt);
  });

  it("取消投影收件區項目會真的移除", async () => {
    const { service } = setup();
    const board = await service.create(newCardId(), "白板");
    const itemId = newCardId();
    await service.project({
      boardId: board.id,
      itemId,
      cardId: newCardId(),
      position: { x: 0, y: 0 },
      origin: "inbox",
      projectedBy: "agent",
    });
    const after = await service.unproject(board.id, itemId);
    expect(after.inbox).toHaveLength(0);
  });

  it("建卡投影帶血緣，重送回傳同一張卡", async () => {
    const { service, createdCards } = setup();
    const board = await service.create(newCardId(), "白板");
    const source = newCardId();
    const itemId = newCardId();
    const created = await service.createCard({
      boardId: board.id,
      itemId,
      title: "整理",
      body: "整理後的內容",
      position: { x: 0, y: 0 },
      origin: "canvas",
      projectedBy: "user",
      derivedFrom: [source],
    });
    expect(createdCards).toEqual([
      {
        cardId: created.cardId,
        kind: "note",
        title: "整理",
        body: "整理後的內容",
        sources: [source],
      },
    ]);
    expect(created.board.items[0]).toMatchObject({ id: itemId, cardId: created.cardId });

    const retry = await service.createCard({
      boardId: board.id,
      itemId,
      title: "整理",
      body: "整理後的內容",
      position: { x: 0, y: 0 },
      origin: "canvas",
      projectedBy: "user",
      derivedFrom: [source],
    });
    expect(retry.cardId).toBe(created.cardId);
    expect(createdCards).toHaveLength(1);
  });
});
