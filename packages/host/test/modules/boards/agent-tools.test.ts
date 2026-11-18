import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { newCardId, type BoardDocument } from "@cardiary/domain";
import type {
  JsonValue,
  ToolBundleDraft,
  ToolDefinition,
  ToolExecutionContext,
  ToolOutcome,
} from "@cardiary/engine-adapter";
import { BoardFileStore, FolderLayout, FreshnessStore, Storage } from "@cardiary/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createBoardsToolBundles } from "../../../src/modules/boards/tools.js";
import {
  BOARDS_BUNDLE_ID,
  BOARDS_FULL_BUNDLE_ID,
  pinToolBundles,
  type BoardsAgentMode,
} from "../../../src/modules/boards/policy.js";
import { BoardService } from "../../../src/modules/boards/service.js";
import type { AuditEntry } from "../../../src/permissions/audit.js";

const T0 = "2026-01-01T00:00:00.000Z";
const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

interface Fixture {
  readonly service: BoardService;
  readonly store: BoardFileStore;
  readonly freshness: FreshnessStore;
  readonly bundles: ReturnType<typeof createBoardsToolBundles>;
  readonly audit: AuditEntry[];
  readonly events: Array<{ boardId: string; change: string }>;
  readonly setMode: (mode: BoardsAgentMode) => void;
}

function setup(mode: BoardsAgentMode = "full"): Fixture {
  const root = mkdtempSync(join(tmpdir(), "cardiary-board-tools-"));
  const layout = new FolderLayout(root);
  const clock = { now: new Date(T0) };
  const storage = Storage.open({ path: root, initialize: true });
  const freshness = new FreshnessStore({
    db: storage.state,
    now: () => clock.now,
    halfLifeDays: 30,
  });
  const store = new BoardFileStore({ layout, now: () => clock.now });
  store.ensureDirectory();
  const audit: AuditEntry[] = [];
  const events: Array<{ boardId: string; change: string }> = [];
  const service = new BoardService(
    store,
    () => clock.now,
    (event) => events.push({ boardId: event.boardId, change: event.change }),
    {
      get: async (cardId: string) => ({ cardId }),
      create: async () => ({ cardId: newCardId() }),
    },
    freshness,
  );
  let currentMode = mode;
  const bundles = createBoardsToolBundles({
    service,
    agentMode: () => currentMode,
    audit: { appendAudit: (entry) => audit.push(entry) },
    now: () => clock.now,
  });
  const cleanup = (): void => {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  };
  cleanups.push(cleanup);
  return {
    service,
    store,
    freshness,
    bundles,
    audit,
    events,
    setMode: (next) => {
      currentMode = next;
    },
  };
}

interface BoardItems {
  readonly boardId: string;
  readonly itemA: string;
  readonly itemB: string;
  readonly cardA: string;
  readonly cardB: string;
}

async function boardWithTwoItems(fixture: Fixture): Promise<BoardItems> {
  const board = await fixture.service.create(newCardId(), "白板");
  const itemA = newCardId();
  const itemB = newCardId();
  const cardA = newCardId();
  const cardB = newCardId();
  await fixture.service.project({
    boardId: board.id,
    itemId: itemA,
    cardId: cardA,
    position: { x: 10, y: 10 },
    origin: "canvas",
    projectedBy: "user",
  });
  await fixture.service.project({
    boardId: board.id,
    itemId: itemB,
    cardId: cardB,
    position: { x: 80, y: 80 },
    origin: "canvas",
    projectedBy: "user",
  });
  return { boardId: board.id, itemA, itemB, cardA, cardB };
}

async function saveAsUser(
  fixture: Fixture,
  boardId: string,
  change: (board: BoardDocument) => BoardDocument,
): Promise<BoardDocument> {
  const board = fixture.service.get(boardId);
  return fixture.service.save(change(board), board.updatedAt);
}

async function addUserGroup(fixture: Fixture, boardId: string, groupId: string): Promise<void> {
  await saveAsUser(fixture, boardId, (board) => ({
    ...board,
    groups: [...board.groups, { id: groupId, label: "使用者的分組" }],
  }));
}

function toolOf(bundle: ToolBundleDraft, name: string): ToolDefinition {
  const tool = bundle.tools.find((entry) => entry.name === name);
  if (tool === undefined) throw new Error(`找不到工具 ${name}`);
  return tool;
}

async function call(
  fixture: Fixture,
  name: string,
  input: { readonly [key: string]: JsonValue },
  context: { readonly conversationId?: string; readonly callId?: string } = {},
): Promise<ToolOutcome> {
  return toolOf(fixture.bundles.full, name).execute(input, context as ToolExecutionContext);
}

async function callIn(
  bundle: ToolBundleDraft,
  name: string,
  input: { readonly [key: string]: JsonValue },
  context: { readonly conversationId?: string; readonly callId?: string } = {},
): Promise<ToolOutcome> {
  return toolOf(bundle, name).execute(input, context as ToolExecutionContext);
}

function jsonOf(outcome: ToolOutcome): { readonly [key: string]: JsonValue } {
  if (!outcome.ok) throw new Error(outcome.message);
  const content = outcome.content.find((entry) => entry.type === "json");
  if (content === undefined || content.type !== "json") throw new Error("工具沒有回傳 json");
  return content.value as { readonly [key: string]: JsonValue };
}

async function callJson(
  fixture: Fixture,
  name: string,
  input: { readonly [key: string]: JsonValue },
  context: { readonly conversationId?: string; readonly callId?: string } = {},
): Promise<{ readonly [key: string]: JsonValue }> {
  return jsonOf(await call(fixture, name, input, context));
}

function withoutVersion(board: BoardDocument): BoardDocument {
  return { ...board, updatedAt: "version" };
}

function changeIdOf(value: { readonly [key: string]: JsonValue }): string {
  const changeId = value.changeId;
  if (typeof changeId !== "string") throw new Error(`沒有 changeId：${JSON.stringify(value)}`);
  return changeId;
}

async function undo(fixture: Fixture, boardId: string, changeId: string) {
  return callJson(fixture, "undo_board_change", { boardId, changeId });
}

describe("白板代理工具（完全操作模式）", () => {
  it("受限模式在執行期拒絕每個完全操作工具，並留下稽核", async () => {
    const fixture = setup("respect-user-content");
    const board = await fixture.service.create(newCardId(), "白板");
    const before = fixture.service.get(board.id);
    const names = fixture.bundles.full.tools.map((tool) => tool.name);
    expect(names).toHaveLength(9);

    for (const name of names) {
      const outcome = await call(fixture, name, {});
      expect(outcome.ok, name).toBe(false);
      if (outcome.ok) continue;
      expect(outcome.message, name).toContain("policy-denied");
    }
    expect(fixture.audit).toHaveLength(names.length);
    for (const [index, entry] of fixture.audit.entries()) {
      expect(entry).toMatchObject({
        kind: "policy-denied",
        tool: names[index],
        reason: "full-mode-required",
      });
      expect(entry.argsHash).toBe(createHash("sha256").update(JSON.stringify({})).digest("hex"));
    }
    expect(fixture.service.get(board.id)).toEqual(before);
  });

  it("受限模式不釘選完全操作與投影工具組，但仍保留建卡工具", () => {
    const fixture = setup("respect-user-content");
    const all = [fixture.bundles.create, fixture.bundles.project, fixture.bundles.full];
    expect(pinToolBundles(all, "respect-user-content").map((bundle) => bundle.bundleId)).toEqual([
      BOARDS_BUNDLE_ID,
    ]);
    expect(pinToolBundles(all, "full").map((bundle) => bundle.bundleId)).toContain(
      BOARDS_FULL_BUNDLE_ID,
    );
  });

  it("切回完全操作模式後同一個工具可以執行", async () => {
    const fixture = setup("respect-user-content");
    const { boardId, itemA } = await boardWithTwoItems(fixture);
    expect(
      (await call(fixture, "move_board_item", { boardId, itemId: itemA, x: 1, y: 1 })).ok,
    ).toBe(false);
    fixture.setMode("full");
    const result = await callJson(fixture, "move_board_item", {
      boardId,
      itemId: itemA,
      x: 1,
      y: 1,
    });
    expect(changeIdOf(result)).toBeTypeOf("string");
    expect(fixture.service.get(boardId).items[0]?.position).toEqual({ x: 1, y: 1 });
  });

  it("移動後可以復原，白板檔回到變更前", async () => {
    const fixture = setup();
    const { boardId, itemA } = await boardWithTwoItems(fixture);
    const before = fixture.service.get(boardId);
    const result = await callJson(fixture, "move_board_item", {
      boardId,
      itemId: itemA,
      x: 240,
      y: 120,
    });
    expect(fixture.service.get(boardId).items.find((item) => item.id === itemA)?.position).toEqual({
      x: 240,
      y: 120,
    });
    const undone = await undo(fixture, boardId, changeIdOf(result));
    expect(undone.undone).toBe(true);
    expect(withoutVersion(fixture.service.get(boardId))).toEqual(withoutVersion(before));
    expect(fixture.store.read(boardId)?.board).toEqual(fixture.service.get(boardId));
  });

  it("連線後可以復原", async () => {
    const fixture = setup();
    const { boardId, itemA, itemB } = await boardWithTwoItems(fixture);
    const before = fixture.service.get(boardId);
    const edgeId = newCardId();
    const result = await callJson(fixture, "connect_board_items", {
      boardId,
      from: itemA,
      to: itemB,
      edgeId,
      label: "相關",
    });
    expect(fixture.service.get(boardId).edges).toEqual([
      { id: edgeId, from: itemA, to: itemB, label: "相關" },
    ]);
    await undo(fixture, boardId, changeIdOf(result));
    expect(withoutVersion(fixture.service.get(boardId))).toEqual(withoutVersion(before));
  });

  it("移除連線後可以復原", async () => {
    const fixture = setup();
    const { boardId, itemA, itemB } = await boardWithTwoItems(fixture);
    const edgeId = newCardId();
    await saveAsUser(fixture, boardId, (board) => ({
      ...board,
      edges: [{ id: edgeId, from: itemA, to: itemB }],
    }));
    const before = fixture.service.get(boardId);
    const result = await callJson(fixture, "disconnect_board_items", { boardId, edgeId });
    expect(fixture.service.get(boardId).edges).toHaveLength(0);
    await undo(fixture, boardId, changeIdOf(result));
    expect(withoutVersion(fixture.service.get(boardId))).toEqual(withoutVersion(before));
  });

  it("建立分組後可以復原", async () => {
    const fixture = setup();
    const { boardId } = await boardWithTwoItems(fixture);
    const before = fixture.service.get(boardId);
    const groupId = newCardId();
    const result = await callJson(fixture, "create_board_group", {
      boardId,
      label: "主題",
      groupId,
    });
    expect(fixture.service.get(boardId).groups).toEqual([{ id: groupId, label: "主題" }]);
    await undo(fixture, boardId, changeIdOf(result));
    expect(withoutVersion(fixture.service.get(boardId))).toEqual(withoutVersion(before));
  });

  it("把項目放進分組後可以復原", async () => {
    const fixture = setup();
    const { boardId, itemA } = await boardWithTwoItems(fixture);
    const groupId = newCardId();
    await addUserGroup(fixture, boardId, groupId);
    const before = fixture.service.get(boardId);
    const result = await callJson(fixture, "assign_board_item_to_group", {
      boardId,
      itemId: itemA,
      groupId,
    });
    expect(fixture.service.get(boardId).items.find((item) => item.id === itemA)?.groupId).toBe(
      groupId,
    );
    await undo(fixture, boardId, changeIdOf(result));
    expect(withoutVersion(fixture.service.get(boardId))).toEqual(withoutVersion(before));
  });

  it("移除分組後可以復原，分組內的項目也一起回來", async () => {
    const fixture = setup();
    const { boardId, itemA } = await boardWithTwoItems(fixture);
    const groupId = newCardId();
    await addUserGroup(fixture, boardId, groupId);
    await saveAsUser(fixture, boardId, (board) => ({
      ...board,
      items: board.items.map((item) => (item.id === itemA ? { ...item, groupId } : item)),
    }));
    const before = fixture.service.get(boardId);
    const result = await callJson(fixture, "remove_board_group", { boardId, groupId });
    expect(fixture.service.get(boardId).groups).toHaveLength(0);
    expect(
      fixture.service.get(boardId).items.find((item) => item.id === itemA)?.groupId,
    ).toBeUndefined();
    await undo(fixture, boardId, changeIdOf(result));
    expect(withoutVersion(fixture.service.get(boardId))).toEqual(withoutVersion(before));
  });

  it("釘選後可以復原，釘選狀態也回到變更前", async () => {
    const fixture = setup();
    const { boardId, itemA, cardA } = await boardWithTwoItems(fixture);
    const before = fixture.service.get(boardId);
    expect(fixture.freshness.get(cardA).pinned).toBe(false);
    const result = await callJson(fixture, "pin_board_item", {
      boardId,
      itemId: itemA,
      pinned: true,
    });
    expect(fixture.service.get(boardId).items.find((item) => item.id === itemA)?.pinned).toBe(true);
    expect(fixture.freshness.get(cardA).pinned).toBe(true);
    await undo(fixture, boardId, changeIdOf(result));
    expect(withoutVersion(fixture.service.get(boardId))).toEqual(withoutVersion(before));
    expect(fixture.freshness.get(cardA).pinned).toBe(false);
  });

  it("移除項目後可以復原，卡片本體不受影響，釘選也一起還原", async () => {
    const fixture = setup();
    const { boardId, itemB, cardB } = await boardWithTwoItems(fixture);
    await saveAsUser(fixture, boardId, (board) => ({
      ...board,
      items: board.items.map((item) => (item.id === itemB ? { ...item, pinned: true } : item)),
    }));
    expect(fixture.freshness.get(cardB).pinned).toBe(true);
    const before = fixture.service.get(boardId);
    const result = await callJson(fixture, "remove_board_item", { boardId, itemId: itemB });
    expect(fixture.service.get(boardId).items.some((item) => item.id === itemB)).toBe(false);
    expect(fixture.freshness.get(cardB).pinned).toBe(false);
    await undo(fixture, boardId, changeIdOf(result));
    expect(withoutVersion(fixture.service.get(boardId))).toEqual(withoutVersion(before));
    expect(fixture.freshness.get(cardB).pinned).toBe(true);
  });

  it("投影既有卡片後可以復原，收件區回到變更前", async () => {
    const fixture = setup();
    const { boardId } = await boardWithTwoItems(fixture);
    const before = fixture.service.get(boardId);
    const cardId = newCardId();
    const itemId = newCardId();
    const projected = jsonOf(
      await callIn(fixture.bundles.project, "project_card_to_board", {
        boardId,
        cardId,
        itemId,
      }),
    );
    expect(fixture.service.get(boardId).inbox).toHaveLength(1);
    const undone = await undo(fixture, boardId, changeIdOf(projected));
    expect(undone.undone).toBe(true);
    expect(withoutVersion(fixture.service.get(boardId))).toEqual(withoutVersion(before));
  });

  it("建立新卡並投影後可以復原白板；卡片本體不會被 undo 刪除", async () => {
    const fixture = setup();
    const { boardId } = await boardWithTwoItems(fixture);
    const before = fixture.service.get(boardId);
    const created = jsonOf(
      await callIn(fixture.bundles.create, "create_card_on_board", {
        boardId,
        title: "代理整理",
        body: "內容",
      }),
    );
    expect(fixture.service.get(boardId).inbox).toHaveLength(1);
    const undone = await undo(fixture, boardId, changeIdOf(created));
    expect(undone.undone).toBe(true);
    expect(withoutVersion(fixture.service.get(boardId))).toEqual(withoutVersion(before));
  });

  it("每塊白板只留最近 20 筆代理變更", async () => {
    const fixture = setup();
    const { boardId, itemA } = await boardWithTwoItems(fixture);
    const changeIds: string[] = [];
    for (let index = 0; index < 21; index += 1) {
      const result = await callJson(fixture, "move_board_item", {
        boardId,
        itemId: itemA,
        x: 1000 + index,
        y: 1000 + index,
      });
      changeIds.push(changeIdOf(result));
    }
    const oldest = await call(fixture, "undo_board_change", {
      boardId,
      changeId: changeIds[0] as string,
    });
    expect(oldest.ok).toBe(false);
    if (!oldest.ok) expect(oldest.message).toContain("找不到這筆代理變更");
    const newest = await undo(fixture, boardId, changeIds[20] as string);
    expect(newest.undone).toBe(true);
  });

  it("重送同一個連線或分組呼叫不會多一筆", async () => {
    const fixture = setup();
    const { boardId, itemA, itemB } = await boardWithTwoItems(fixture);
    const edgeId = newCardId();
    const context = { conversationId: "conversation", callId: "call-1" };
    const first = await callJson(
      fixture,
      "connect_board_items",
      { boardId, from: itemA, to: itemB, edgeId },
      context,
    );
    const retry = await callJson(
      fixture,
      "connect_board_items",
      { boardId, from: itemA, to: itemB, edgeId },
      context,
    );
    expect(fixture.service.get(boardId).edges).toHaveLength(1);
    expect(retry.changeId).toBe(first.changeId);
    expect(changeIdOf(first)).toBeTypeOf("string");

    const groupId = newCardId();
    const groupFirst = await callJson(fixture, "create_board_group", {
      boardId,
      label: "主題",
      groupId,
    });
    const groupRetry = await callJson(fixture, "create_board_group", {
      boardId,
      label: "主題",
      groupId,
    });
    expect(fixture.service.get(boardId).groups).toHaveLength(1);
    expect(groupRetry.changeId).toBe(groupFirst.changeId);
  });

  it("只能復原最近一筆代理變更；較舊的要先復原新的", async () => {
    const fixture = setup();
    const { boardId, itemA } = await boardWithTwoItems(fixture);
    const first = await callJson(fixture, "move_board_item", {
      boardId,
      itemId: itemA,
      x: 1,
      y: 1,
    });
    const second = await callJson(fixture, "move_board_item", {
      boardId,
      itemId: itemA,
      x: 2,
      y: 2,
    });

    const older = await call(fixture, "undo_board_change", {
      boardId,
      changeId: changeIdOf(first),
    });
    expect(older.ok).toBe(false);
    if (!older.ok) expect(older.message).toContain("還有其他代理變更");

    await undo(fixture, boardId, changeIdOf(second));
    const restored = await undo(fixture, boardId, changeIdOf(first));
    expect(restored.undone).toBe(true);
    expect(fixture.service.get(boardId).items[0]?.position).toEqual({ x: 10, y: 10 });
  });

  it("使用者改過白板後，代理的 undo 回 conflict，不覆蓋使用者內容", async () => {
    const fixture = setup();
    const { boardId, itemA } = await boardWithTwoItems(fixture);
    const result = await callJson(fixture, "move_board_item", {
      boardId,
      itemId: itemA,
      x: 300,
      y: 300,
    });
    await saveAsUser(fixture, boardId, (board) => ({ ...board, title: "使用者改名" }));
    const outcome = await call(fixture, "undo_board_change", {
      boardId,
      changeId: changeIdOf(result),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain("被改過");
    expect(fixture.service.get(boardId).title).toBe("使用者改名");
    expect(fixture.service.get(boardId).items.find((item) => item.id === itemA)?.position).toEqual({
      x: 300,
      y: 300,
    });
  });

  it("重送同一個 undo 不會再復原一次", async () => {
    const fixture = setup();
    const { boardId, itemA } = await boardWithTwoItems(fixture);
    const result = await callJson(fixture, "move_board_item", {
      boardId,
      itemId: itemA,
      x: 50,
      y: 50,
    });
    const changeId = changeIdOf(result);
    const first = await undo(fixture, boardId, changeId);
    const version = fixture.service.get(boardId).updatedAt;
    const eventCount = fixture.events.length;
    const second = await undo(fixture, boardId, changeId);
    expect(first.undone).toBe(true);
    expect(second.undone).toBe(false);
    expect(fixture.service.get(boardId).updatedAt).toBe(version);
    expect(fixture.events).toHaveLength(eventCount);
  });

  it("使用者操作沒有 changeId，不能復原", async () => {
    const fixture = setup();
    const { boardId } = await boardWithTwoItems(fixture);
    await saveAsUser(fixture, boardId, (board) => ({ ...board, title: "使用者改名" }));
    const outcome = await call(fixture, "undo_board_change", {
      boardId,
      changeId: newCardId(),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain("找不到這筆代理變更");
    expect(fixture.service.get(boardId).title).toBe("使用者改名");
  });
});
