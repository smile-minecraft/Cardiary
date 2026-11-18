/**
 * 停用 → 重啟 → 重新啟用之後，模組原本的資料還在（規格第 4 章；工作 work-714d0eb7
 * 「逐一停用每個第一方模組後…重新啟用後資料仍在」）。
 *
 * `restart.test.ts` 已涵蓋 cards、boards、settings、mcp、memory、scheduler、context。
 * 這裡補 import、media、lifecycle、emotion、storage：停用後入口消失，重啟後維持停用，
 * 重新啟用後讀得到停用前留下的資料。
 *
 * 不在這裡的模組：
 * - external-agents：只能在 macOS 用 sandbox-exec 跑，重啟後的紀錄由
 *   `external-agents/external-agents.test.ts` 的重啟案例涵蓋。
 * - local-tools、dealing、retrieval：沒有自己的正本資料；停用與恢復由
 *   `special.test.ts` 與 `toggle.test.ts` 驗。
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { connectAndHello, spawnService, type ServiceOptions } from "../test/support.js";
import {
  createSession,
  expectProbe,
  mapModules,
  request,
  requestFrame,
  sendMessage,
  setEnabled,
  startHarness,
  stopHarness,
  type Harness,
} from "./support.js";

const harnesses: Harness[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await stopHarness(harness);
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

type Scripts = ServiceOptions["scripts"];

/** 對話要跨重啟保存的案例用 Pi 組裝；假引擎的對話只在行程記憶體裡。 */
const engines = new WeakMap<Harness, "pi" | undefined>();

async function start(scripts?: Scripts): Promise<Harness> {
  const harness = await startHarness(scripts === undefined ? {} : { scripts });
  harnesses.push(harness);
  return harness;
}

async function startPi(scripts: NonNullable<Scripts>): Promise<Harness> {
  const service = await spawnService({ engine: "pi", scripts });
  const client = await connectAndHello(service);
  const harness: Harness = { folder: service.folder, service, client };
  harnesses.push(harness);
  engines.set(harness, "pi");
  return harness;
}

/** 同一個資料夾重啟；需要回合時重新帶上腳本（`restartHarness` 不帶）。 */
async function restart(harness: Harness, scripts?: Scripts): Promise<Harness> {
  const engine = engines.get(harness);
  await harness.client.close().catch(() => undefined);
  await harness.service.stop().catch(() => undefined);
  harnesses.splice(harnesses.indexOf(harness), 1);
  const service = await spawnService({
    folder: harness.folder,
    ...(engine === undefined ? {} : { engine }),
    ...(scripts === undefined ? {} : { scripts }),
  });
  const client = await connectAndHello(service);
  const next: Harness = { folder: harness.folder, service, client };
  harnesses.push(next);
  engines.set(next, engine);
  return next;
}

/**
 * 停用、重啟、確認入口仍關著，再重新啟用；回傳重啟後的 harness。
 * `probe` 是停用期間應該回 `disabledCode` 的請求。
 */
async function cycle(
  harness: Harness,
  moduleId: string,
  probe: { type: string; payload: Record<string, unknown>; disabledCode: string } | null,
  scripts?: Scripts,
): Promise<Harness> {
  const disabled = await setEnabled(harness.client, moduleId, false);
  expect(disabled, `${moduleId} 停用`).toMatchObject({ enabled: false, state: "inactive" });

  const next = await restart(harness, scripts);
  const modules = await mapModules(next.client);
  expect(modules.get(moduleId), `${moduleId} 重啟後維持停用`).toMatchObject({
    enabled: false,
    state: "inactive",
  });
  const locked = [...modules.values()].filter((info) => info.enabled && info.state === "failed");
  expect(
    locked.map((info) => info.moduleId),
    "不應有 enabled 卻 failed 的模組",
  ).toEqual([]);
  if (probe !== null) {
    expectProbe(
      await requestFrame(next.client, probe.type, probe.payload),
      { kind: "error", code: probe.disabledCode },
      `${moduleId} 停用時的 ${probe.type}`,
    );
  }

  const enabled = await setEnabled(next.client, moduleId, true);
  expect(enabled, `${moduleId} 重新啟用`).toMatchObject({ enabled: true, state: "active" });
  expect(enabled.failure ?? null).toBeNull();
  return next;
}

/** `module.*` 的請求與回應都包在 `data` 裡。 */
async function moduleRequest<T>(
  harness: Harness,
  type: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const reply = await request(harness.client, type, { data: payload });
  return (reply.payload as { data: T }).data;
}

describe("重新啟用後資料仍在", () => {
  it("import：停用前寫入的匯入紀錄還在，同一來源再匯入全部判成重複", async () => {
    let harness = await start();
    const source = await mkdtemp(join(tmpdir(), "cardiary-reenable-import-"));
    tempDirs.push(source);
    await writeFile(
      join(source, "memory.md"),
      "- 重新啟用後要記得的第一件事\n- 第二件事\n",
      "utf8",
    );
    const previewInput = {
      sourceKind: "generic",
      sourcePath: source,
      categories: { "memory.md": "memory" },
    };
    const first = await moduleRequest<{ jobId: string; items: { key: string }[] }>(
      harness,
      "module.import.preview",
      previewInput,
    );
    const report = await moduleRequest<{ cardsCreated: number }>(harness, "module.import.write", {
      jobId: first.jobId,
      itemKeys: first.items.map((item) => item.key),
    });
    expect(report.cardsCreated).toBe(2);

    harness = await cycle(harness, "import", {
      type: "module.import.sources",
      payload: { data: {} },
      disabledCode: "not_found",
    });

    const again = await moduleRequest<{ duplicates: number; newCards: number }>(
      harness,
      "module.import.preview",
      previewInput,
    );
    expect(again.duplicates).toBe(2);
    expect(again.newCards).toBe(0);
  }, 60_000);

  it("media：停用前上傳的原檔讀得回來，同一個 blob 再匯入得到同一張卡", async () => {
    let harness = await start();
    const bytes = Buffer.concat([
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
      Buffer.from(`reenable-${Date.now()}`),
    ]);
    const base = () => `http://127.0.0.1:${harness.service.ready.clientPort}`;
    const auth = () => ({ authorization: `Bearer ${harness.service.clientToken}` });
    const uploaded = await fetch(`${base()}/v1/blobs`, {
      method: "POST",
      headers: { ...auth(), "content-type": "image/png" },
      body: bytes,
    });
    expect(uploaded.status).toBe(201);
    const blob = (await uploaded.json()) as { blobId: string };
    const imported = await request(harness.client, "media.import", { blobId: blob.blobId });
    const cardId = (imported.payload as { cardId: string }).cardId;
    expect(cardId).toBeTruthy();

    harness = await cycle(harness, "media", {
      type: "media.import",
      payload: { blobId: blob.blobId },
      disabledCode: "unsupported",
    });

    const fetched = await fetch(`${base()}/v1/blobs/${blob.blobId}`, { headers: auth() });
    expect(fetched.status).toBe(200);
    expect(Buffer.from(await fetched.arrayBuffer()).equals(bytes)).toBe(true);
    const again = await request(harness.client, "media.import", { blobId: blob.blobId });
    expect((again.payload as { cardId: string }).cardId).toBe(cardId);
  }, 60_000);

  it("lifecycle：停用前封存的對話仍帶著同一個封存時間，重新啟用後可以取消封存", async () => {
    let harness = await startPi([[{ kind: "text", text: "好" }]]);
    const sessionId = await createSession(harness.client);
    const archived = await request(harness.client, "session.archive", {
      sessionId,
      purgeAfterDays: 30,
    });
    const archive = (archived.payload as { archive: { archivedAt: string; purgeAt: string } })
      .archive;

    harness = await cycle(
      harness,
      "lifecycle",
      { type: "session.deletion_preview", payload: { sessionId }, disabledCode: "unsupported" },
      [[{ kind: "text", text: "好" }]],
    );

    const listSessions = async () =>
      (
        (await request(harness.client, "session.list", {})).payload as {
          sessions: Array<{ id: string; archive?: typeof archive }>;
        }
      ).sessions;
    expect((await listSessions()).find((session) => session.id === sessionId)?.archive).toEqual(
      archive,
    );
    await request(harness.client, "session.unarchive", { sessionId });
    expect((await listSessions()).find((session) => session.id === sessionId)).not.toHaveProperty(
      "archive",
    );
  }, 60_000);

  it("emotion：停用前的情緒檔在重啟與重新啟用後不變，之後的訊息接著累積", async () => {
    const reply = [{ kind: "text", text: "收到。" }];
    let harness = await startPi([reply]);
    const sessionId = await createSession(harness.client);
    await sendMessage(harness.client, sessionId, "謝謝你，太好了");
    const emotionPath = join(harness.folder.path, "state", "emotion.json");
    const before = await readFile(emotionPath, "utf8");
    const first = JSON.parse(before) as { valence: number; updatedAt: string };
    expect(first.valence).toBeGreaterThan(0);

    // emotion 沒有自己的協定入口；停用狀態由 system.modules.get 確認。
    harness = await cycle(harness, "emotion", null, [reply]);
    expect(await readFile(emotionPath, "utf8"), "重新啟用不應重設情緒檔").toBe(before);

    await request(harness.client, "session.subscribe", { sessionId });
    await sendMessage(harness.client, sessionId, "謝謝你，太好了");
    const after = JSON.parse(await readFile(emotionPath, "utf8")) as { valence: number };
    expect(after.valence, "重新啟用後從停用前的值接著累積").toBeGreaterThan(first.valence);
  }, 60_000);

  it("storage：重新啟用後用量照常回報，分類與停用前相同", async () => {
    let harness = await start();
    const usage = async () =>
      (
        (await request(harness.client, "storage.usage", {})).payload as {
          usage: Array<{ category: string; bytes?: number }>;
        }
      ).usage;
    const categories = (await usage()).map((item) => item.category).sort();
    expect(categories.length).toBeGreaterThan(0);

    harness = await cycle(harness, "storage", {
      type: "storage.usage",
      payload: {},
      disabledCode: "unsupported",
    });
    // storage 只讀資料夾現況，沒有自己的正本資料；重新啟用後分類與停用前一樣。
    expect((await usage()).map((item) => item.category).sort()).toEqual(categories);
  }, 60_000);
});
