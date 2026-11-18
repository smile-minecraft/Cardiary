import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  connectAndHello,
  spawnService,
  type ProtocolClient,
  type SpawnedService,
  type TestFolder,
} from "../test/support.js";

/**
 * 白板的協定契約：對真的主機行程跑，驗白板的檔案正本、事件與代理工具的兩層控制。
 *
 * 工具曝光（建立對話時釘選哪些工具組）與執行期防禦（呼叫當下再查一次模式）是兩層，
 * 都要有證據：這裡用預設模式驗新卡可以建、用「先 full 再切回受限」驗既有對話留著
 * 工具時仍會被拒絕，並且稽核檔留下紀錄。
 */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function newUlid(): string {
  let time = BigInt(Date.now());
  const timePart = new Array<string>(10);
  for (let index = 9; index >= 0; index -= 1) {
    timePart[index] = CROCKFORD[Number(time & 31n)] as string;
    time >>= 5n;
  }
  const randomPart = new Array<string>(16);
  for (let index = 0; index < 16; index += 1) {
    randomPart[index] = CROCKFORD[Math.floor(Math.random() * 32)] as string;
  }
  return `${timePart.join("")}${randomPart.join("")}`;
}

const services: SpawnedService[] = [];
const clients: ProtocolClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) {
    await client.close().catch(() => undefined);
  }
  for (const service of services.splice(0)) {
    await service.stop().catch(() => undefined);
  }
});

async function boot(
  options: {
    readonly scripts?: readonly (readonly Record<string, unknown>[])[];
    readonly folder?: TestFolder;
  } = {},
): Promise<{ service: SpawnedService; client: ProtocolClient }> {
  const service = await spawnService(options);
  services.push(service);
  const client = await connectAndHello(service);
  clients.push(client);
  return { service, client };
}

async function request<T = Record<string, unknown>>(
  client: ProtocolClient,
  type: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const id = client.request(type, payload);
  const reply = await client.waitForReply(id, 10_000);
  if (reply.kind === "error") {
    throw new Error(`${type} 失敗：${String(reply.code)} ${String(reply.message)}`);
  }
  return reply.payload as T;
}

async function requestRaw(
  client: ProtocolClient,
  type: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const id = client.request(type, payload);
  return client.waitForReply(id, 10_000);
}

async function subscribeSystem(client: ProtocolClient): Promise<void> {
  const id = client.request("system.subscribe", {});
  await client.waitForReply(id, 10_000);
}

interface BoardPayload {
  readonly board: {
    readonly id: string;
    readonly title: string;
    readonly updatedAt: string;
    readonly createdAt: string;
    readonly items: readonly unknown[];
    readonly inbox: ReadonlyArray<{
      readonly id: string;
      readonly cardId: string;
      readonly origin: string;
      readonly projectedBy?: string;
    }>;
    readonly edges: readonly unknown[];
    readonly groups: readonly unknown[];
  };
}

async function createBoard(client: ProtocolClient, title: string): Promise<BoardPayload["board"]> {
  const boardId = newUlid();
  const payload = await request<BoardPayload>(client, "board.create", {
    boardId,
    title,
    clientRequestId: `board-create-${Math.random().toString(36).slice(2)}`,
  });
  return payload.board;
}

async function createCard(client: ProtocolClient): Promise<string> {
  const payload = await request<{ card: { cardId: string } }>(client, "card.create", {
    kind: "note",
    title: `白板來源 ${Math.random().toString(36).slice(2, 8)}`,
    body: "來源卡內文。\n",
    clientRequestId: `card-create-${Math.random().toString(36).slice(2)}`,
  });
  return payload.card.cardId;
}

async function createSession(client: ProtocolClient): Promise<string> {
  const id = client.request("session.create", { clientRequestId: `cr-${Math.random()}` });
  const reply = await client.waitForReply(id, 10_000);
  if (reply.kind === "error") {
    throw new Error(`session.create 失敗：${String(reply.message)}`);
  }
  return (reply.payload as { session: { id: string } }).session.id;
}

function approvalRequests(client: ProtocolClient) {
  return client.frames.filter((frame) => frame.type === "approval.requested");
}

/** 投影工具一律詢問人類；核准之後才輪到執行期防禦判斷模式。 */
async function approveNext(client: ProtocolClient, count: number): Promise<void> {
  await client.waitFor(() => approvalRequests(client).length >= count, 10_000);
  const request = approvalRequests(client)[count - 1];
  const approvalId = (request?.payload as { approvalId?: string } | undefined)?.approvalId;
  if (approvalId === undefined) {
    throw new Error(`第 ${count} 個審批沒有 approvalId`);
  }
  const id = client.request("approval.decide", { approvalId, optionId: "approve" });
  const reply = await client.waitForReply(id, 10_000);
  if (reply.kind === "error") {
    throw new Error(`approval.decide 失敗：${String(reply.message)}`);
  }
}

async function subscribeSession(client: ProtocolClient, sessionId: string): Promise<void> {
  const id = client.request("session.subscribe", { sessionId });
  await client.waitForReply(id, 10_000);
}

async function send(client: ProtocolClient, sessionId: string, text: string): Promise<string> {
  const id = client.request("session.send_message", {
    sessionId,
    text,
    delivery: "queue",
    clientMessageId: `cm-${Math.random().toString(36).slice(2)}`,
  });
  const reply = await client.waitForReply(id, 10_000);
  return (reply.payload as { turnId: string }).turnId;
}

async function waitForTurnEnd(client: ProtocolClient, turnId: string): Promise<void> {
  await client.waitFor(
    (frame) =>
      frame.type === "stream.turn_state" &&
      (frame.payload as { turnId?: string }).turnId === turnId &&
      ["completed", "failed", "interrupted"].includes(
        (frame.payload as { state?: string }).state ?? "",
      ),
    10_000,
  );
}

function toolResults(client: ProtocolClient) {
  return client.frames.filter((frame) => frame.type === "stream.tool_result");
}

async function waitForToolResult(client: ProtocolClient, count = 1) {
  await client.waitFor(() => toolResults(client).length >= count, 10_000);
  const result = toolResults(client)[count - 1];
  if (result === undefined) {
    throw new Error(`等不到第 ${count} 個工具結果`);
  }
  return result;
}

/** 工具結果的 `output`：失敗時是 `{ text }`，成功時結構化資料在 `data`。 */
function toolOutputText(result: Record<string, unknown>): string {
  const output = (result.payload as { output?: { text?: string } }).output;
  return output?.text ?? "";
}

function toolOutputData(result: Record<string, unknown>): Record<string, unknown> {
  const output = (result.payload as { output?: { data?: unknown } }).output;
  const data = output?.data;
  if (data === null || typeof data !== "object") {
    throw new Error(`工具結果沒有結構化資料：${JSON.stringify(result.payload)}`);
  }
  return data as Record<string, unknown>;
}

async function setSetting(client: ProtocolClient, key: string, value: string): Promise<void> {
  const id = client.request("system.settings.set", {
    changes: [{ key, value }],
    clientRequestId: `settings-${Math.random().toString(36).slice(2)}`,
  });
  const reply = await client.waitForReply(id, 10_000);
  if (reply.kind === "error") {
    throw new Error(`system.settings.set 失敗：${String(reply.message)}`);
  }
}

function boardChangedNext(client: ProtocolClient, boardId: string, change: string) {
  return client.waitFor(
    (frame) =>
      frame.type === "board.changed" &&
      (frame.payload as { boardId?: string; change?: string }).boardId === boardId &&
      (frame.payload as { change?: string }).change === change,
    10_000,
  );
}

describe("白板協定", () => {
  it("建立白板→存→重讀一致；兩個客戶端都收到 board.changed", async () => {
    const { service } = await boot();
    const client = clients[clients.length - 1] as ProtocolClient;
    const second = await connectAndHello(service);
    clients.push(second);
    await subscribeSystem(client);
    await subscribeSystem(second);

    const boardId = newUlid();
    const created = await request<BoardPayload>(client, "board.create", {
      boardId,
      title: "第一份白板",
      clientRequestId: `board-create-${Math.random().toString(36).slice(2)}`,
    });
    await boardChangedNext(client, boardId, "created");
    await boardChangedNext(second, boardId, "created");

    const renamed = await request<BoardPayload>(client, "board.save", {
      board: { ...created.board, title: "搬家後的名字" },
      baseUpdatedAt: created.board.updatedAt,
      clientRequestId: `board-save-${Math.random().toString(36).slice(2)}`,
    });
    expect(renamed.board.title).toBe("搬家後的名字");
    expect(Date.parse(renamed.board.updatedAt)).toBeGreaterThan(
      Date.parse(created.board.updatedAt),
    );
    await boardChangedNext(client, boardId, "updated");
    await boardChangedNext(second, boardId, "updated");

    const got = await request<BoardPayload>(client, "board.get", { boardId });
    expect(got.board).toMatchObject({ id: boardId, title: "搬家後的名字" });

    const expected = JSON.parse(
      await readFile(join(service.folder.path, "boards", `${boardId}.json`), "utf8"),
    ) as { id: string; title: string; schema: number };
    expect(expected).toMatchObject({ id: boardId, title: "搬家後的名字", schema: 1 });
  }, 20_000);

  it("過期的 baseUpdatedAt 回 conflict，白板內容不被蓋掉", async () => {
    const { client } = await boot();
    const created = await createBoard(client, "單寫者比對");

    await request<BoardPayload>(client, "board.save", {
      board: { ...created, title: "第一次" },
      baseUpdatedAt: created.updatedAt,
      clientRequestId: `board-save-${Math.random().toString(36).slice(2)}`,
    });
    // 用第一次存之前的版本再存一次：一定要被拒絕。
    const reply = await requestRaw(client, "board.save", {
      board: { ...created, title: "蓋掉別人" },
      baseUpdatedAt: created.updatedAt,
      clientRequestId: `board-save-${Math.random().toString(36).slice(2)}`,
    });
    expect(reply.kind).toBe("error");
    expect(reply.code).toBe("conflict");

    const got = await request<BoardPayload>(client, "board.get", {
      boardId: created.id,
    });
    expect(got.board.title).toBe("第一次");
  }, 20_000);

  it("連線與分組存進檔案正本，重讀文件仍完整", async () => {
    const { service, client } = await boot();
    const created = await createBoard(client, "連線與分組");
    const cardA = await createCard(client);
    const cardB = await createCard(client);
    const itemA = newUlid();
    const itemB = newUlid();
    const groupId = newUlid();
    const edgeId = newUlid();

    const saved = await request<BoardPayload>(client, "board.save", {
      board: {
        ...created,
        items: [
          {
            id: itemA,
            cardId: cardA,
            position: { x: 0, y: 0 },
            size: { width: 240, height: 160 },
            pinned: false,
            origin: "canvas",
            projectedBy: "user",
            groupId,
          },
          {
            id: itemB,
            cardId: cardB,
            position: { x: 320, y: 0 },
            size: { width: 240, height: 160 },
            pinned: false,
            origin: "canvas",
            projectedBy: "user",
            groupId,
          },
        ],
        edges: [{ id: edgeId, from: itemA, to: itemB }],
        groups: [{ id: groupId, label: "比較組" }],
      },
      baseUpdatedAt: created.updatedAt,
      clientRequestId: `board-save-${Math.random().toString(36).slice(2)}`,
    });
    expect(saved.board.edges).toEqual([{ id: edgeId, from: itemA, to: itemB }]);
    expect(saved.board.groups).toEqual([{ id: groupId, label: "比較組" }]);

    const got = await request<BoardPayload>(client, "board.get", {
      boardId: created.id,
    });
    expect(got.board.edges).toEqual([{ id: edgeId, from: itemA, to: itemB }]);
    expect(got.board.groups).toEqual([{ id: groupId, label: "比較組" }]);

    const onDisk = JSON.parse(
      await readFile(join(service.folder.path, "boards", `${created.id}.json`), "utf8"),
    ) as { edges: unknown[]; groups: unknown[] };
    expect(onDisk.edges).toEqual([{ id: edgeId, from: itemA, to: itemB }]);
    expect(onDisk.groups).toEqual([{ id: groupId, label: "比較組" }]);
  }, 20_000);

  it("受限模式（預設）新卡投影：代理建卡進收件區，投影標記 agent", async () => {
    const boardId = newUlid();
    const itemId = newUlid();
    const { client } = await boot({
      scripts: [
        [
          {
            kind: "tool",
            toolName: "create_card_on_board",
            input: {
              boardId,
              title: "代理整理的重點",
              body: "這張卡由代理建立並留在收件區。",
              itemId,
            },
          },
        ],
      ],
    });
    await request<BoardPayload>(client, "board.create", {
      boardId,
      title: "代理白板",
      clientRequestId: `board-create-${Math.random().toString(36).slice(2)}`,
    });
    const sessionId = await createSession(client);
    await subscribeSession(client, sessionId);
    const turnId = await send(client, sessionId, "請整理重點");
    await waitForTurnEnd(client, turnId);

    const result = await waitForToolResult(client);
    expect((result.payload as { status: string }).status, toolOutputText(result)).toBe("ok");
    const tool = toolOutputData(result) as {
      boardId: string;
      cardId: string;
      itemId: string;
      inboxSize: number;
    };
    expect(tool).toMatchObject({ boardId, itemId, inboxSize: 1 });

    const got = await request<BoardPayload>(client, "board.get", { boardId });
    expect(got.board.inbox).toHaveLength(1);
    expect(got.board.inbox[0]).toMatchObject({
      id: itemId,
      origin: "inbox",
      projectedBy: "agent",
    });
    // 卡片本體真的進了卡片庫。
    const card = await request<{ card: { cardId: string; title: string } }>(client, "card.get", {
      cardId: tool.cardId,
    });
    expect(card.card.title).toBe("代理整理的重點");
  }, 20_000);

  it("受限模式：先 full 建好對話再切回受限，project_card_to_board 被拒絕並寫稽核", async () => {
    const boardId = newUlid();
    // 先開一個不帶腳本的短暫行程，用人類協定建立一張既有卡片；代理不能建這張。
    const firstBoot = await boot();
    const cardId = await createCard(firstBoot.client);
    await request<BoardPayload>(firstBoot.client, "board.create", {
      boardId,
      title: "模式切換白板",
      clientRequestId: `board-create-${Math.random().toString(36).slice(2)}`,
    });
    await firstBoot.service.stop();
    const index = services.indexOf(firstBoot.service);
    services.splice(index, 1);

    // 重開同一個資料夾；腳本裡帶著這張既有卡片的 id。
    const { service, client } = await boot({
      folder: firstBoot.service.folder,
      scripts: [
        [
          {
            kind: "tool",
            toolName: "project_card_to_board",
            input: { boardId, cardId, itemId: newUlid() },
          },
          { kind: "text", text: "投影完成。" },
        ],
        [
          {
            kind: "tool",
            toolName: "project_card_to_board",
            input: { boardId, cardId, itemId: newUlid() },
          },
          { kind: "text", text: "再投影一次。" },
        ],
      ],
    });
    await setSetting(client, "boards.agentMode", "full");
    const sessionId = await createSession(client);
    await subscribeSession(client, sessionId);

    // 第一個回合：full 模式，投影工具已曝光，呼叫成功。
    const turn1 = await send(client, sessionId, "投影第一次");
    await approveNext(client, 1);
    await waitForTurnEnd(client, turn1);
    const ok = await waitForToolResult(client, 1);
    expect((ok.payload as { status: string }).status, toolOutputText(ok)).toBe("ok");

    // 切回受限模式；同一個對話已經釘選了工具組，執行期防禦要擋下來。
    await setSetting(client, "boards.agentMode", "respect-user-content");
    const turn2 = await send(client, sessionId, "投影第二次");
    await approveNext(client, 2);
    await waitForTurnEnd(client, turn2);
    const denied = await waitForToolResult(client, 2);
    expect((denied.payload as { status: string }).status).toBe("error");
    expect(toolOutputText(denied)).toContain("policy-denied");

    const auditFile = join(service.folder.path, "state", "agent-audit.jsonl");
    const audit = await readFile(auditFile, "utf8");
    const entries = audit
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(
      entries.some(
        (entry) => entry.kind === "policy-denied" && entry.tool === "project_card_to_board",
      ),
    ).toBe(true);
  }, 30_000);

  it("收件區的投影可以取消；畫布不受影響", async () => {
    const boardId = newUlid();
    const itemId = newUlid();
    const { client } = await boot({
      scripts: [
        [
          {
            kind: "tool",
            toolName: "create_card_on_board",
            input: {
              boardId,
              title: "代理先放收件區",
              body: "等待使用者決定。",
              itemId,
            },
          },
        ],
      ],
    });
    await request<BoardPayload>(client, "board.create", {
      boardId,
      title: "收件區白板",
      clientRequestId: `board-create-${Math.random().toString(36).slice(2)}`,
    });
    const sessionId = await createSession(client);
    await subscribeSession(client, sessionId);
    const turnId = await send(client, sessionId, "幫我建一張卡");
    await waitForTurnEnd(client, turnId);
    await waitForToolResult(client);

    const removed = await request<BoardPayload>(client, "board.unproject_card", {
      boardId,
      itemId,
    });
    expect(removed.board.inbox).toHaveLength(0);
    expect(removed.board.items).toHaveLength(0);
  }, 20_000);
});
