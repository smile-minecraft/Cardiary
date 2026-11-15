import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CardService } from "@cardiary/domain";
import type { EngineLogger } from "@cardiary/engine-adapter";
import {
  MemoryApprovalLedger,
  MemoryDeletionIntents,
  MemoryEventLog,
  MemoryRequestDedupe,
  MemoryRuntimeState,
  MemoryTurnIndex,
} from "../../src/index.js";
import { ContextAssembler } from "../../src/context/assembler.js";
import { ContextCompactor } from "../../src/context/compactor.js";
import { ContextServiceImpl } from "../../src/context/service.js";
import { ContextStore } from "../../src/context/store.js";
import { Gateway } from "../../src/gateway/server.js";
import type { ModuleHostBridge } from "../../src/modules/contract.js";
import type { StorageBundle } from "../../src/storage/interfaces.js";
import { TestClient } from "../helpers.js";
import {
  createContextFixture,
  createConversation,
  send,
  StubModels,
  type ContextFixture,
} from "./support.js";

let fixture: ContextFixture;

beforeEach(async () => {
  fixture = await createContextFixture();
});

afterEach(() => {
  fixture.close();
});

const silentLogger: EngineLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

interface Built {
  readonly store: ContextStore;
  readonly assembler: ContextAssembler;
  readonly service: ContextServiceImpl;
  readonly models: StubModels;
}

function buildService(cards: CardService = fixture.cards): Built {
  const store = new ContextStore(fixture.db);
  const models = new StubModels();
  const assembler = new ContextAssembler({
    store,
    cards,
    budget: () => ({ contextWindow: 100_000, reserveTokens: 0, compactionThreshold: 0.75 }),
    now: () => new Date("2026-11-15T04:00:00.000Z"),
    timeZone: "Asia/Taipei",
  });
  const compactor = new ContextCompactor({
    store,
    assembler,
    engine: fixture.engine,
    cards,
    models,
    now: () => new Date("2026-11-15T04:00:00.000Z"),
    keepRecentTokens: () => 0,
  });
  const service = new ContextServiceImpl({
    store,
    assembler,
    compactor,
    engine: fixture.engine,
    models,
    protocol: { emit: () => {} },
    now: () => new Date("2026-11-15T04:00:00.000Z"),
    settingNumber: (_key, fallback) => fallback,
    contextWindow: () => 100_000,
  });
  return { store, assembler, service, models };
}

/** 假的模組主機：只提供上下文服務，其他能力用不到。 */
function modulesWithContext(service: ContextServiceImpl): ModuleHostBridge {
  const services = new Map<string, unknown>([["context", service]]);
  return {
    listModules: () => [],
    activeToolBundles: () => [],
    setModuleEnabled: async () => {
      throw new Error("測試不啟用模組");
    },
    hasExactHandler: () => false,
    hasPrefixHandler: () => false,
    dispatchProtocol: async () => {
      throw new Error("測試不分派協定");
    },
    dispatchHttp: async () => null,
    hostServices: {
      get<T>(name: string): T | undefined {
        return services.get(name) as T | undefined;
      },
    },
  } as unknown as ModuleHostBridge;
}

function storageBundle(): StorageBundle {
  return {
    events: new MemoryEventLog(),
    runtime: new MemoryRuntimeState(),
    dedupe: new MemoryRequestDedupe(),
    approvals: new MemoryApprovalLedger(),
    turnIndex: new MemoryTurnIndex(),
    deletions: new MemoryDeletionIntents(),
    folder: {
      path: fixture.root,
      folderId: "folder_context_service",
      displayName: "上下文服務",
      writable: true,
    },
  };
}

describe("接上對話的時機", () => {
  it("attach 後第一輪就看得到分層前綴，不必手動 configure", async () => {
    fixture.cards.add({ kind: "bedrock", title: "基岩", body: "不變的規則。" });
    fixture.cards.add({ kind: "persona", title: "人格", body: "直接、簡短。" });
    const memory = fixture.cards.add({ kind: "memory", title: "記憶", body: "使用者喜歡茶。" });
    const note = fixture.cards.add({ kind: "note", title: "筆記", body: "今天討論排程。" });
    const { assembler, service } = buildService();
    const session = await createConversation(fixture.engine);
    await assembler.addCard(session, memory.cardId);
    await assembler.addCard(session, note.cardId);

    await service.attach(session);
    await send(fixture.engine, session, "開始吧");

    const snapshot = fixture.engine.readPromptLog(session).at(-1);
    const systemContext = snapshot?.systemContext ?? "";
    const positions = ["基岩", "人格", "記憶", "筆記"].map((title) => systemContext.indexOf(title));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((left, right) => left - right)).toEqual(positions);
    expect(snapshot?.messages.map((message) => message.text).join("")).toContain("開始吧");
  });

  it("session.create 在回覆前接上上下文，第一則訊息就有分層前綴", async () => {
    fixture.cards.add({ kind: "bedrock", title: "基岩", body: "不變的規則。" });
    fixture.cards.add({ kind: "persona", title: "人格", body: "直接、簡短。" });
    const { service } = buildService();

    const gateway = new Gateway({
      engine: fixture.engine,
      storage: storageBundle(),
      epoch: "epoch-context-service",
      clientToken: "A".repeat(43),
      logger: silentLogger,
      status: () => ({
        folderState: "ready",
        displayName: "上下文服務",
        writable: true,
        serviceState: "running",
        version: "0.1.0",
        uptimeSeconds: 0,
        activeTasks: 0,
      }),
      modules: modulesWithContext(service),
    });
    const port = await gateway.listen(0);
    const client = await TestClient.connect(`ws://127.0.0.1:${port}/v1/ws`);
    try {
      const hello = await client.hello("A".repeat(43));
      await client.waitForReply(hello);

      const createId = client.request("session.create", { clientRequestId: "ctx-seam-1" });
      const created = await client.waitForReply(createId);
      const sessionId = (created.payload as { session: { id: string } }).session.id;

      const subscribe = client.request("session.subscribe", { sessionId });
      await client.waitForReply(subscribe);
      const messageId = client.request("session.send_message", {
        sessionId,
        text: "第一則訊息",
        delivery: "queue",
      });
      await client.waitForReply(messageId);
      await client.waitForEvent("stream.message_completed");

      const snapshot = fixture.engine.readPromptLog(sessionId as never).at(-1);
      const systemContext = snapshot?.systemContext ?? "";
      expect(systemContext).toContain("基岩");
      expect(systemContext).toContain("人格");
      expect(systemContext.indexOf("基岩")).toBeLessThan(systemContext.indexOf("人格"));
    } finally {
      await client.close().catch(() => undefined);
      await gateway.close().catch(() => undefined);
    }
  });

  it("attach 遇到中斷的壓縮會先補完，再把含摘要的前綴推給引擎", async () => {
    const session = await createConversation(fixture.engine);
    await send(fixture.engine, session, "訊息 1");
    await send(fixture.engine, session, "訊息 2");
    await send(fixture.engine, session, "訊息 3");
    const { store, service } = buildService();
    store.ensure(session, {
      contextWindow: 100_000,
      budgetTokens: 100_000,
      compactionThreshold: 0.75,
      reserveTokens: 0,
    });
    store.setCompactionInProgress(session, true);

    await service.attach(session);

    expect(store.interrupted()).toEqual([]);
    const view = await service.view(session);
    expect(view.entries.some((entry) => entry.layer === "short-term-memory")).toBe(true);

    await send(fixture.engine, session, "繼續");
    const snapshot = fixture.engine.readPromptLog(session).at(-1);
    expect(snapshot?.systemContext).toContain("前面在處理卡片與測試");
  });
});
