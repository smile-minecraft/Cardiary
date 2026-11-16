import { performance } from "node:perf_hooks";

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

interface LineEdit {
  readonly line: number;
  readonly text: string;
}

/** 一萬字文件契約測試：固定行號與行寬，讓每個補丁只碰幾行，其餘逐字可比。 */
const LONG_LINE_WIDTH = 50;
const LONG_LINE_COUNT = 200;
const longLine = (n: number): string =>
  `L${String(n).padStart(3, "0")} `.padEnd(LONG_LINE_WIDTH, "x");
const LONG_LINES = Array.from({ length: LONG_LINE_COUNT }, (_, i) => longLine(i + 1));
const LONG_BODY = `${LONG_LINES.join("\n")}\n`;
const editedLine = (tag: string, n: number): string =>
  `${tag}${String(n).padStart(3, "0")}`.padEnd(LONG_LINE_WIDTH, "y");

/** 每行一個 hunk，依行號遞增；只替換該行，不改動行數。 */
function buildLongPatch(changes: readonly LineEdit[]): string {
  const hunks = changes.map(({ line, text }) => {
    const original = LONG_LINES[line - 1]!;
    return `@@ -${line},1 +${line},1 @@\n-${original}\n+${text}\n`;
  });
  return `--- a\n+++ b\n${hunks.join("")}`;
}

/** 從原文算出只改指定行之後的預期內文，其餘行直接沿用原字串。 */
function expectedLongBody(changes: readonly LineEdit[]): string {
  const lines = [...LONG_LINES];
  for (const { line, text } of changes) lines[line - 1] = text;
  return `${lines.join("\n")}\n`;
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

  it("一萬字文件：接受、拒絕、過期補丁與還原都逐字保留未觸及的行", async () => {
    expect(LONG_BODY.length).toBeGreaterThanOrEqual(10_000);
    const setup = await spawnService();
    services.push(setup);
    const initialClient = await connectAndHello(setup);
    clients.push(initialClient);
    const created = await request<{ card: { cardId: string } }>(initialClient, "card.create", {
      kind: "note",
      title: "長文件",
      body: LONG_BODY,
      clientRequestId: "create-long-doc",
    });
    const cardId = created.card.cardId;
    const initial = await request<{ card: { body: string; revision: string } }>(
      initialClient,
      "card.get",
      { cardId },
    );
    expect(initial.card.body).toBe(LONG_BODY);
    const baseRevision = initial.card.revision;
    await initialClient.close();
    await setup.stop();

    const acceptedChanges: LineEdit[] = [
      { line: 3, text: editedLine("ACCEPT-A", 3) },
      { line: 137, text: editedLine("ACCEPT-B", 137) },
    ];
    const staleChanges: LineEdit[] = [{ line: 88, text: editedLine("STALE", 88) }];
    const rejectedChanges: LineEdit[] = [{ line: 199, text: editedLine("REJECT", 199) }];
    const proposals = [
      { summary: "accept", patch: buildLongPatch(acceptedChanges) },
      { summary: "stale", patch: buildLongPatch(staleChanges) },
      { summary: "rejected", patch: buildLongPatch(rejectedChanges) },
    ].map((entry) => ({
      kind: "tool",
      toolName: "propose_card_patch",
      input: { cardId, baseRevision, patch: entry.patch, summary: entry.summary },
    }));
    const service = await spawnService({ folder: setup.folder, scripts: [proposals] });
    services.push(service);
    const client = await connectAndHello(service);
    clients.push(client);
    const session = await request<{ session: { id: string } }>(client, "session.create", {
      clientRequestId: "session-long-doc",
    });
    await request(client, "session.subscribe", { sessionId: session.session.id });
    await request(client, "session.send_message", {
      sessionId: session.session.id,
      text: "請提議三處修改",
      delivery: "queue",
      clientMessageId: "message-long-doc",
    });
    for (let index = 0; index < proposals.length; index += 1) {
      await client.waitFor(
        () => client.frames.filter((frame) => frame.type === "approval.requested").length > index,
        10000,
      );
      const approval = client.frames.filter((frame) => frame.type === "approval.requested")[index]!;
      await request(client, "approval.decide", {
        approvalId: (approval.payload as { approvalId: string }).approvalId,
        optionId: "approve",
      });
    }
    await client.waitFor(
      () => client.frames.filter((frame) => frame.type === "stream.tool_result").length >= 3,
      15000,
    );

    const pending = await request<{
      patches: Array<{ patchId: string; summary: string; status: string }>;
    }>(client, "card.patches.list", { cardId, status: "pending" });
    expect(pending.patches).toHaveLength(3);
    const patchId = (summary: string): string => {
      const entry = pending.patches.find((item) => item.summary === summary);
      if (!entry) throw new Error(`missing ${summary}`);
      return entry.patchId;
    };

    // 提議本身不碰正本；接受前的版本歷史只有建立那一筆。
    expect(
      (await request<{ card: { body: string } }>(client, "card.get", { cardId })).card.body,
    ).toBe(LONG_BODY);
    const before = await request<{ versions: Array<{ versionId: string; kind: string }> }>(
      client,
      "card.versions.list",
      { cardId },
    );
    expect(before.versions).toHaveLength(1);
    expect(before.versions[0]!.kind).toBe("create");

    const acceptStart = performance.now();
    const accepted = await request<{ card: { body: string; revision: string } }>(
      client,
      "card.patch.accept",
      { patchId: patchId("accept"), clientRequestId: "accept-long-doc" },
    );
    const acceptMs = performance.now() - acceptStart;
    expect(acceptMs, `card.patch.accept 耗時 ${acceptMs.toFixed(1)}ms`).toBeLessThan(2000);
    expect(accepted.card.body).toBe(expectedLongBody(acceptedChanges));

    // 過期補丁（原 revision 已被接受動作改掉）要明確失敗。
    const stale = await client.waitForReply(
      client.request("card.patch.accept", {
        patchId: patchId("stale"),
        clientRequestId: "accept-long-stale",
      }),
    );
    expect(stale.kind).toBe("error");
    expect(JSON.stringify(stale)).toContain("revision_mismatch");

    // 拒絕的補丁不影響內文。
    await request(client, "card.patch.reject", {
      patchId: patchId("rejected"),
      clientRequestId: "reject-long-doc",
    });
    expect(
      (await request<{ card: { body: string } }>(client, "card.get", { cardId })).card.body,
    ).toBe(expectedLongBody(acceptedChanges));

    const afterAccept = await request<{ versions: Array<{ versionId: string; kind: string }> }>(
      client,
      "card.versions.list",
      { cardId },
    );
    expect(afterAccept.versions).toHaveLength(2);
    expect(afterAccept.versions[1]!.kind).toBe("patch");

    const restoreStart = performance.now();
    const restored = await request<{
      card: { body: string; revision: string };
      version: { kind: string; revision: string };
    }>(client, "card.version.restore", {
      cardId,
      versionId: before.versions[0]!.versionId,
      baseRevision: accepted.card.revision,
      clientRequestId: "restore-long-doc",
    });
    const restoreMs = performance.now() - restoreStart;
    expect(restoreMs, `card.version.restore 耗時 ${restoreMs.toFixed(1)}ms`).toBeLessThan(2000);
    expect(
      acceptMs + restoreMs,
      `accept ${acceptMs.toFixed(1)}ms + restore ${restoreMs.toFixed(1)}ms = ${(acceptMs + restoreMs).toFixed(1)}ms`,
    ).toBeLessThan(5000);
    expect(restored.card.body).toBe(LONG_BODY);
    expect(restored.version.kind).toBe("restore");

    const finalVersions = await request<{
      versions: Array<{ versionId: string; kind: string }>;
    }>(client, "card.versions.list", { cardId });
    expect(finalVersions.versions).toHaveLength(3);
    expect(finalVersions.versions.map((item) => item.kind)).toEqual(["create", "patch", "restore"]);
  }, 60000);
});
