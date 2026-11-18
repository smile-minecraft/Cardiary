/**
 * 沒有共同協定探針的三個模組：emotion、local-tools、retrieval。
 *
 * 這三個模組的行為要看檔案、腳本化回合或連帶停用才觀察得到，所以和
 * `PROBE_CASES` 分開；三者的模組集合加起來仍是完整的 16 個第一方模組。
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createNoteCard,
  createSession,
  infoOf,
  mapModules,
  request,
  sendMessage,
  setEnabled,
  startHarness,
  stopHarness,
  subscribeSession,
  waitForToolResult,
  type Harness,
} from "./support.js";

interface EmotionFile {
  readonly valence: number;
  readonly updatedAt: string;
}

function statusEvents(harness: Harness): number {
  return harness.client.frames.filter((frame) => frame.type === "module.retrieval.status").length;
}

describe("沒有共同協定探針的模組", () => {
  it("emotion：停用後不再寫入情緒檔，重新啟用後恢復", async () => {
    const harness = await startHarness();
    try {
      const { client } = harness;
      const sessionId = await createSession(client);
      const emotionPath = join(harness.folder.path, "state", "emotion.json");

      await sendMessage(client, sessionId, "謝謝你，太好了");
      const firstRaw = await readFile(emotionPath, "utf8");
      const first = JSON.parse(firstRaw) as EmotionFile;
      expect(first.valence, "正向訊息應提高 valence").toBeGreaterThan(0);

      const disabled = await setEnabled(client, "emotion", false);
      expect(disabled).toMatchObject({ enabled: false, state: "inactive" });
      expect(disabled.failure ?? null).toBeNull();

      await sendMessage(client, sessionId, "謝謝你，太好了");
      expect(await readFile(emotionPath, "utf8"), "停用時情緒檔不應被改寫").toBe(firstRaw);

      const enabled = await setEnabled(client, "emotion", true);
      expect(enabled).toMatchObject({ enabled: true, state: "active" });
      expect(enabled.failure ?? null).toBeNull();

      await sendMessage(client, sessionId, "謝謝你，太好了");
      const resumed = JSON.parse(await readFile(emotionPath, "utf8")) as EmotionFile;
      expect(resumed.valence, "重新啟用後應繼續累積").toBeGreaterThan(first.valence);
      expect(resumed.updatedAt).not.toBe(first.updatedAt);
    } finally {
      await stopHarness(harness);
    }
  }, 60_000);

  it("local-tools：停用後工具呼叫回 tool_unavailable，重新啟用後恢復", async () => {
    const readProbe = [{ kind: "tool", toolName: "read_file", input: { path: "probe.txt" } }];
    const harness = await startHarness({
      scripts: [[...readProbe], [...readProbe], [...readProbe]],
    });
    try {
      const { client } = harness;
      await writeFile(join(harness.folder.path, "probe.txt"), "本地工具探針\n", "utf8");
      const sessionId = await createSession(client);
      await subscribeSession(client, sessionId);

      await sendMessage(client, sessionId, "讀取探針檔");
      const active = await waitForToolResult(client, 1);
      expect((active.payload as { status?: string }).status).toBe("ok");

      const disabled = await setEnabled(client, "local-tools", false);
      expect(disabled).toMatchObject({ enabled: false, state: "inactive" });
      expect(disabled.failure ?? null).toBeNull();

      await sendMessage(client, sessionId, "再讀一次探針檔");
      const blocked = await waitForToolResult(client, 2);
      expect((blocked.payload as { status?: string }).status).toBe("error");
      const diagnostics = (blocked.payload as { diagnostics?: Array<{ code?: string }> })
        .diagnostics;
      expect(diagnostics?.map((diagnostic) => diagnostic.code)).toContain("tool_unavailable");

      const enabled = await setEnabled(client, "local-tools", true);
      expect(enabled).toMatchObject({ enabled: true, state: "active" });
      expect(enabled.failure ?? null).toBeNull();

      // 既有對話釘選停用前的工具組 generation；重新啟用只對新對話生效。
      const restoredSessionId = await createSession(client);
      await subscribeSession(client, restoredSessionId);
      await sendMessage(client, restoredSessionId, "恢復後再讀探針檔");
      const restored = await waitForToolResult(client, 3);
      expect((restored.payload as { status?: string }).status).toBe("ok");
      expect((restored.payload as { sessionId?: string }).sessionId).toBe(restoredSessionId);
      const modules = await mapModules(client);
      expect(
        [...modules.values()].filter((info) => info.state === "failed"),
        "不應有模組 failed",
      ).toEqual([]);
    } finally {
      await stopHarness(harness);
    }
  }, 60_000);

  it("retrieval：停用後 dealing 連帶停用、卡片搜尋降級仍可用；重新啟用後一起恢復", async () => {
    const harness = await startHarness();
    try {
      const { client } = harness;
      await request(client, "system.subscribe", {});
      const sessionId = await createSession(client);
      const title = `降級檢索探針 ${Date.now()}`;
      const cardId = await createNoteCard(client, title);

      const before = statusEvents(harness);
      const disabled = await setEnabled(client, "retrieval", false);
      expect(disabled).toMatchObject({ enabled: false, state: "inactive" });
      expect(disabled.failure ?? null).toBeNull();

      const dealing = await infoOf(client, "dealing");
      expect(dealing.enabled, "dealing 仍是使用者啟用的").toBe(true);
      expect(dealing.state, "dealing 應被連帶停用").toBe("inactive");
      expect(dealing.failure ?? null).toBeNull();

      const search = await request(client, "card.search", { query: title });
      const hits =
        (search.payload as { hits?: Array<{ card?: { cardId?: string } }> } | undefined)?.hits ??
        [];
      expect(
        hits.map((hit) => hit.card?.cardId),
        "檢索停用時 card.search 應走全文搜尋",
      ).toContain(cardId);

      await sendMessage(client, sessionId, "檢索停用時仍可送訊息");

      const enabled = await setEnabled(client, "retrieval", true);
      expect(enabled).toMatchObject({ enabled: true, state: "active" });
      expect(enabled.failure ?? null).toBeNull();

      const recovered = await infoOf(client, "dealing");
      expect(recovered.enabled).toBe(true);
      expect(recovered.state, "重新啟用 retrieval 後 dealing 應一起恢復").toBe("active");
      expect(recovered.failure ?? null).toBeNull();

      await client.waitFor(() => statusEvents(harness) > before, 10_000);
      expect(statusEvents(harness), "重新啟用應收到 module.retrieval.status").toBeGreaterThan(
        before,
      );
    } finally {
      await stopHarness(harness);
    }
  }, 60_000);
});
