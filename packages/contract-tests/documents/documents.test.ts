import { afterEach, describe, expect, it } from "vitest";
import {
  connectAndHello,
  spawnService,
  type ProtocolClient,
  type SpawnedService,
} from "../test/support.js";

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

describe("文件補丁", () => {
  it("代理的提議不更動正本，接受、拒絕、過期及還原都保留版本", async () => {
    const setup = await spawnService();
    services.push(setup);
    const initialClient = await connectAndHello(setup);
    clients.push(initialClient);
    const created = await request<{ card: { cardId: string } }>(initialClient, "card.create", {
      kind: "note",
      title: "文件",
      body: "one\ntwo\n",
      clientRequestId: "create-doc",
    });
    const cardId = created.card.cardId;
    const initial = await request<{ card: { body: string; revision: string } }>(
      initialClient,
      "card.get",
      { cardId },
    );
    await initialClient.close();
    await setup.stop();
    const patch = "--- a\n+++ b\n@@ -1,2 +1,2 @@\n one\n-two\n+changed\n";
    const proposals = ["first", "stale", "rejected"].map((summary) => ({
      kind: "tool",
      toolName: "propose_card_patch",
      input: { cardId, baseRevision: initial.card.revision, patch, summary },
    }));
    const service = await spawnService({ folder: setup.folder, scripts: [proposals] });
    services.push(service);
    const client = await connectAndHello(service);
    clients.push(client);
    const session = await request<{ session: { id: string } }>(client, "session.create", {
      clientRequestId: "session-doc",
    });
    const sessionId = session.session.id;
    await request(client, "session.subscribe", { sessionId });
    await request(client, "session.send_message", {
      sessionId,
      text: "請提議修改",
      delivery: "queue",
      clientMessageId: "message-doc",
    });
    for (let index = 0; index < 3; index += 1) {
      await client.waitFor(
        () => client.frames.filter((frame) => frame.type === "approval.requested").length > index,
        10000,
      );
      const approval = client.frames.filter((frame) => frame.type === "approval.requested")[index]!;
      const approvalId = (approval.payload as { approvalId: string }).approvalId;
      await request(client, "approval.decide", { approvalId, optionId: "approve" });
    }
    await client.waitFor(
      () => client.frames.filter((frame) => frame.type === "stream.tool_result").length >= 3,
      15000,
    );
    const results = client.frames.filter((frame) => frame.type === "stream.tool_result");
    expect(results.map((frame) => (frame.payload as { status: string }).status)).toEqual([
      "ok",
      "ok",
      "ok",
    ]);
    const pending = await request<{
      patches: Array<{
        patchId: string;
        summary: string;
        status: string;
        sourceConversationId: string;
      }>;
    }>(client, "card.patches.list", { cardId, status: "pending" });
    expect(pending.patches).toHaveLength(3);
    expect(pending.patches.every((item) => item.sourceConversationId === sessionId)).toBe(true);
    const bySummary = (summary: string) => {
      const entry = pending.patches.find((item) => item.summary === summary);
      if (!entry) throw new Error(`missing ${summary}`);
      return entry.patchId;
    };
    expect(
      (await request<{ card: { body: string } }>(client, "card.get", { cardId })).card.body,
    ).toBe("one\ntwo\n");
    const before = await request<{ versions: Array<{ versionId: string }> }>(
      client,
      "card.versions.list",
      { cardId },
    );
    expect(before.versions).toHaveLength(1);
    const accepted = await request<{ card: { body: string; revision: string } }>(
      client,
      "card.patch.accept",
      { patchId: bySummary("first"), clientRequestId: "accept-doc" },
    );
    expect(accepted.card.body).toBe("one\nchanged\n");
    const stale = await client.waitForReply(
      client.request("card.patch.accept", {
        patchId: bySummary("stale"),
        clientRequestId: "accept-stale",
      }),
    );
    expect(stale.kind).toBe("error");
    expect(JSON.stringify(stale)).toContain("revision_mismatch");
    await request(client, "card.patch.reject", {
      patchId: bySummary("rejected"),
      clientRequestId: "reject-doc",
    });
    expect(
      (await request<{ card: { body: string } }>(client, "card.get", { cardId })).card.body,
    ).toBe("one\nchanged\n");
    const after = await request<{ versions: Array<{ versionId: string }> }>(
      client,
      "card.versions.list",
      { cardId },
    );
    expect(after.versions).toHaveLength(2);
    expect(
      (
        await request<{ body: string }>(client, "card.version.get", {
          cardId,
          versionId: before.versions[0]!.versionId,
        })
      ).body,
    ).toBe("one\ntwo\n");
    const staleRestore = await client.waitForReply(
      client.request("card.version.restore", {
        cardId,
        versionId: before.versions[0]!.versionId,
        baseRevision: initial.card.revision,
        clientRequestId: "restore-stale",
      }),
    );
    expect(staleRestore.kind).toBe("error");
    expect(JSON.stringify(staleRestore)).toContain("revision_mismatch");
    const restored = await request<{
      card: { body: string; revision: string };
      version: { kind: string; revision: string };
    }>(client, "card.version.restore", {
      cardId,
      versionId: before.versions[0]!.versionId,
      baseRevision: accepted.card.revision,
      clientRequestId: "restore-doc",
    });
    expect(restored.card.body).toBe("one\ntwo\n");
    expect(restored.version.kind).toBe("restore");
    expect(restored.version.revision).toBe(restored.card.revision);
    expect(
      (await request<{ versions: unknown[] }>(client, "card.versions.list", { cardId })).versions,
    ).toHaveLength(3);
  }, 40000);
});
