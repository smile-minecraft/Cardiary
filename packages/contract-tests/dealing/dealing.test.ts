/**
 * 開局發牌的持久化契約：對真的主機行程跑。
 *
 * 發牌機率與來源必須寫進正本，重啟行程後 `context.get` 仍然帶得出來；
 * 行程內的暫存不能是唯一的來源。
 */

import path from "node:path";

import { describe, expect, it } from "vitest";

import { openStateDatabase } from "../../storage/src/state-schema.js";
import {
  connectAndHello,
  spawnService,
  type ProtocolClient,
  type SpawnedService,
} from "../test/support.js";

interface DealEntry {
  readonly entryId: string;
  readonly layer: string;
  readonly cardId?: string;
  readonly dealProbability?: number;
  readonly dealSource?: string;
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

describe("開局發牌的持久化契約", () => {
  it("重啟後 context.get 仍帶發牌機率與來源", async () => {
    const scripts = [[{ kind: "text", text: "摘要" }]] as const;
    const first: SpawnedService = await spawnService({ scripts });
    const folder = first.folder;
    const sessionId = "restart-deal-session";
    let client: ProtocolClient | undefined;
    try {
      // 先建立一張真的卡：組裝時會讀卡片內容，卡片不存在會把開局項目清掉。
      client = await connectAndHello(first);
      const created = await request<{ card: { cardId: string } }>(client, "card.create", {
        kind: "note",
        title: "被發的卡",
        body: "這張卡的重點是持久化。",
        clientRequestId: `deal-persist-${Date.now().toString(36)}`,
      });
      const cardId = created.card.cardId;
      await client.close();
      client = undefined;
      await first.stop();

      // 直接把一筆已發牌的開局卡寫進正本，模擬「發完牌就關機」。
      const { db } = openStateDatabase({
        filePath: path.join(folder.path, "state", "cardiary.sqlite"),
        appVersion: "test",
        backupDirectory: path.join(folder.path, "tmp"),
      });
      try {
        db.run(
          `INSERT INTO context_entries (
             entry_id, conversation_id, layer, card_id, title, token_estimate, state, position,
             added_at, deal_probability, deal_source
           ) VALUES (?, ?, 'opening-memory', ?, '被發的卡', 12, 'active', 0, ?, 0.9, 'system-one')`,
          `${sessionId}:deal:${cardId}`,
          sessionId,
          cardId,
          new Date().toISOString(),
        );
      } finally {
        db.close();
      }

      // 重啟同一個資料夾，重新讀取上下文。
      const second = await spawnService({ folder, scripts });
      try {
        client = await connectAndHello(second);
        const payload = await request<{ context: { entries: DealEntry[] } }>(
          client,
          "context.get",
          { sessionId },
        );
        const opening = payload.context.entries.filter((entry) => entry.layer === "opening-memory");
        expect(opening).toHaveLength(1);
        expect(opening[0]?.dealProbability).toBe(0.9);
        expect(opening[0]?.dealSource).toBe("system-one");
      } finally {
        await second.stop();
      }
    } finally {
      await client?.close().catch(() => undefined);
      await first.stop().catch(() => undefined);
    }
  });
});
