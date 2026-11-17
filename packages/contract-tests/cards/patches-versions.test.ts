import { afterEach, describe, expect, it } from "vitest";

import {
  connectAndHello,
  spawnService,
  type ProtocolClient,
  type SpawnedService,
} from "../test/support.js";

/**
 * 版本歷史與待決補丁清單的協定契約：對真的主機行程跑。
 *
 * App 的卡片詳情頁在載入時會先打 `card.patches.list`、再打
 * `card.versions.list`，任一失敗就顯示同一個逾時錯誤。這一組測試對真實
 * 閘道跑同樣的順序，並把接受、拒絕、還原都走一遍，釘住整條路徑。
 */

const services: SpawnedService[] = [];
const clients: ProtocolClient[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => undefined);
  for (const service of services.splice(0)) await service.stop().catch(() => undefined);
});

async function request<T>(
  client: ProtocolClient,
  type: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const reply = await client.waitForReply(client.request(type, payload), 10000);
  if (reply.kind === "error")
    throw new Error(`${type}: ${String(reply.code)} ${String(reply.message)}`);
  return reply.payload as T;
}

const PATCH = "--- a\n+++ b\n@@ -1,2 +1,2 @@\n one\n-two\n+changed\n";

describe("補丁與版本清單", () => {
  it("連續列出待決補丁與版本，並完成接受、拒絕、還原", async () => {
    // 第一階段：建卡，查出初始 revision。
    const first = await spawnService();
    services.push(first);
    const setupClient = await connectAndHello(first);
    clients.push(setupClient);
    const created = await request<{ card: { cardId: string } }>(setupClient, "card.create", {
      kind: "note",
      title: "版本歷史測試",
      body: "one\ntwo\n",
      clientRequestId: "create-patch-list",
    });
    const cardId = created.card.cardId;
    const initial = await request<{ card: { revision: string } }>(setupClient, "card.get", {
      cardId,
    });
    const baseRevision = initial.card.revision;
    await setupClient.close();
    await first.stop();
    clients.splice(0, 1);
    services.splice(0, 1);

    // 第二階段：用假引擎提出兩個補丁（都針對同一個 baseRevision）。
    const proposals = ["first-proposal", "kept-pending"].map((summary) => ({
      kind: "tool",
      toolName: "propose_card_patch",
      input: { cardId, baseRevision, patch: PATCH, summary },
    }));
    const service = await spawnService({ folder: first.folder, scripts: [proposals] });
    services.push(service);
    const client = await connectAndHello(service);
    clients.push(client);
    const session = await request<{ session: { id: string } }>(client, "session.create", {
      clientRequestId: "session-patch-list",
    });
    const sessionId = session.session.id;
    await request(client, "session.subscribe", { sessionId });
    await request(client, "session.send_message", {
      sessionId,
      text: "請提議修改",
      delivery: "queue",
      clientMessageId: "message-patch-list",
    });
    for (let index = 0; index < 2; index += 1) {
      await client.waitFor(
        () => client.frames.filter((frame) => frame.type === "approval.requested").length > index,
        10000,
      );
      const approval = client.frames.filter((frame) => frame.type === "approval.requested")[
        index
      ]!;
      const approvalId = (approval.payload as { approvalId: string }).approvalId;
      await request(client, "approval.decide", { approvalId, optionId: "approve" });
    }
    await client.waitFor(
      () => client.frames.filter((frame) => frame.type === "stream.tool_result").length >= 2,
      15000,
    );

    // App 載入順序：先補丁、再版本，連續打兩輪。
    const firstPatches = await request<{
      patches: Array<{ patchId: string; summary: string; sourceConversationId: string }>;
    }>(client, "card.patches.list", { cardId, status: "pending" });
    const firstVersions = await request<{ versions: Array<{ versionId: string; kind: string }> }>(
      client,
      "card.versions.list",
      { cardId },
    );
    expect(firstPatches.patches).toHaveLength(2);
    expect(firstVersions.versions).toHaveLength(1);
    expect(firstVersions.versions[0]!.kind).toBe("create");
    const secondPatches = await request<{ patches: unknown[] }>(
      client,
      "card.patches.list",
      { cardId, status: "pending" },
    );
    const secondVersions = await request<{ versions: unknown[] }>(
      client,
      "card.versions.list",
      { cardId },
    );
    expect(secondPatches.patches).toHaveLength(2);
    expect(secondVersions.versions).toHaveLength(1);

    // 接受第一個補丁：版本變兩版，補丁只剩一筆。
    const bySummary = (summary: string) => {
      const entry = firstPatches.patches.find((item) => item.summary === summary);
      if (!entry) throw new Error(`missing patch ${summary}`);
      return entry.patchId;
    };
    const accepted = await request<{ card: { body: string; revision: string } }>(
      client,
      "card.patch.accept",
      { patchId: bySummary("first-proposal"), clientRequestId: "accept-patch-list" },
    );
    expect(accepted.card.body).toBe("one\nchanged\n");
    const afterAccept = await request<{ patches: unknown[] }>(client, "card.patches.list", {
      cardId,
      status: "pending",
    });
    const afterAcceptVersions = await request<{
      versions: Array<{ kind: string }>;
    }>(client, "card.versions.list", { cardId });
    expect(afterAccept.patches).toHaveLength(1);
    expect(afterAcceptVersions.versions).toHaveLength(2);
    expect(afterAcceptVersions.versions.map((item) => item.kind)).toEqual(["create", "patch"]);

    // 拒絕第二個補丁：待決清空，拒絕清單有一筆。
    await request(client, "card.patch.reject", {
      patchId: bySummary("kept-pending"),
      clientRequestId: "reject-patch-list",
    });
    const pendingAfterReject = await request<{ patches: unknown[] }>(
      client,
      "card.patches.list",
      { cardId, status: "pending" },
    );
    const rejected = await request<{ patches: Array<{ summary: string }> }>(
      client,
      "card.patches.list",
      { cardId, status: "rejected" },
    );
    expect(pendingAfterReject.patches).toHaveLength(0);
    expect(rejected.patches.map((item) => item.summary)).toEqual(["kept-pending"]);

    // 還原第一版（create）：內文回原文，版本變三版。
    const restoreSource = firstVersions.versions[0]!.versionId;
    const restored = await request<{
      card: { body: string };
      version: { kind: string };
    }>(client, "card.version.restore", {
      cardId,
      versionId: restoreSource,
      baseRevision: accepted.card.revision,
      clientRequestId: "restore-patch-list",
    });
    expect(restored.card.body).toBe("one\ntwo\n");
    expect(restored.version.kind).toBe("restore");
    const finalVersions = await request<{ versions: Array<{ kind: string }> }>(
      client,
      "card.versions.list",
      { cardId },
    );
    expect(finalVersions.versions.map((item) => item.kind)).toEqual([
      "create",
      "patch",
      "restore",
    ]);
  }, 40000);
});
