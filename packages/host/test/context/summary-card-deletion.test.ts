import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AssetStore } from "@cardiary/domain";
import { createInMemoryApprovalLedger } from "@cardiary/engine-adapter";
import { FakeEngine } from "@cardiary/engine-fake";
import {
  CardFileStore,
  CardIndexStore,
  LocalAssetStore,
  Storage,
  type Database,
} from "@cardiary/storage";
import { afterEach, describe, expect, it } from "vitest";

import { ContextAssembler } from "../../src/context/assembler.js";
import { ContextCompactor } from "../../src/context/compactor.js";
import { ContextStore } from "../../src/context/store.js";
import { CardLibrary } from "../../src/modules/cards/library.js";
import { CardStateStore } from "../../src/modules/cards/state.js";
import { SessionLifecycleService } from "../../src/sessions/service.js";
import { StubModels, createConversation, send } from "./support.js";

/**
 * 摘要卡和對話一起刪：真的儲存層、真的卡片庫、真的生命週期服務。
 *
 * 摘要卡是對話的專屬卡片；刪除對話時它必須跟著消失，不能留在卡片庫裡。
 * 這條路徑只有在壓縮器把摘要卡記成對話載入之後才走得通。
 */

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

const now = (): Date => new Date("2026-11-15T04:00:00.000Z");

const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
};

async function makeFixture(): Promise<{
  storage: Storage;
  library: CardLibrary;
  assets: AssetStore;
  engine: FakeEngine;
  lifecycle: SessionLifecycleService;
}> {
  const root = await mkdtemp(join(tmpdir(), "cardiary-summary-deletion-"));
  const storage = Storage.open({ path: root, initialize: true });
  cleanups.push(() => storage.close());

  const files = new CardFileStore({ layout: storage.layout, now });
  let cachedDatabase: Database | null = null;
  let cachedIndex: CardIndexStore | null = null;
  const index = (): CardIndexStore => {
    const database = storage.cache;
    if (cachedIndex === null || cachedDatabase !== database) {
      cachedDatabase = database;
      cachedIndex = new CardIndexStore({ db: database, now });
    }
    return cachedIndex;
  };
  const localAssets = new LocalAssetStore({ layout: storage.layout, index: index(), now });
  const library = new CardLibrary({
    files,
    index,
    assets: () => localAssets,
    state: new CardStateStore({ db: () => storage.state, now }),
    now,
  });
  await library.initialize();
  const assets: AssetStore = {
    put: (input) => localAssets.put(input),
    read: async (blobId) => localAssets.read(blobId) ?? null,
    release: async (blobId) => localAssets.release(blobId) === "deleted",
  };

  const engine = new FakeEngine({
    environment: {
      stateDir: join(storage.layout.root, "state"),
      tempDir: join(storage.layout.root, "tmp"),
      defaultWorkingDir: storage.layout.root,
    },
    approvals: createInMemoryApprovalLedger(),
    permissionGate: {
      async evaluate() {
        return { kind: "allow" };
      },
    },
    credentials: {
      async resolve() {
        return { provider: "fake", kind: "none", secret: "" };
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  await engine.open();
  cleanups.push(() => engine.close());

  const lifecycle = new SessionLifecycleService({
    layout: storage.layout,
    state: storage.state,
    cache: () => storage.cache,
    settings: storage.settings,
    engine,
    cards: library,
    assets,
    models: new StubModels(),
    protocol: { emit: () => {} },
    logger,
    now,
  });
  return { storage, library, assets, engine, lifecycle };
}

describe("摘要卡的生命週期", () => {
  it("刪除對話會把摘要卡當成專屬卡片一起刪掉", async () => {
    const { storage, library, engine, lifecycle } = await makeFixture();
    const session = await createConversation(engine);
    await send(engine, session, "訊息 1");
    await send(engine, session, "訊息 2");
    await send(engine, session, "訊息 3");

    const store = new ContextStore(storage.state);
    const assembler = new ContextAssembler({
      store,
      cards: library,
      budget: () => ({ contextWindow: 100_000, reserveTokens: 0, compactionThreshold: 0.75 }),
      now,
    });
    const compactor = new ContextCompactor({
      store,
      assembler,
      engine,
      cards: library,
      models: new StubModels(),
      now,
      keepRecentTokens: () => 0,
    });
    const outcome = await compactor.compact(session, { trigger: "manual" });
    expect(outcome.compacted).toBe(true);
    const summaryCardId = outcome.summaryCardId ?? "";
    expect(await library.get(summaryCardId)).not.toBeNull();

    // 摘要卡記成對話的載入；刪除前的預估看得到它。
    const preview = await lifecycle.preview(session);
    expect(preview.exclusiveCards).toBe(1);

    const result = await lifecycle.delete(session);
    expect(result.deletedCards).toBe(1);
    expect(await library.get(summaryCardId)).toBeNull();
    expect(existsSync(join(storage.layout.subfolderPath("cards"), `${summaryCardId}.md`))).toBe(
      false,
    );
  });
});
