/**
 * 開局發牌的主機整合測試。
 *
 * 用真的狀態庫、假引擎、假的 System One 判斷器與 `ContextAssembler`，
 * 驗證：第 4 層寫入與排序、前綴推送、只在第一則訊息發生、檢索失敗的退路、
 * 以及閘道第一則訊息的接線。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { join } from "node:path";

import type {
  CardPage,
  CardSearchHit,
  SystemOneInvoker,
  SystemOneJudgeRequest,
} from "@cardiary/domain";
import type { EngineLogger } from "@cardiary/engine-adapter";
import { openStateDatabase } from "@cardiary/storage";
import {
  MemoryApprovalLedger,
  MemoryDeletionIntents,
  MemoryEventLog,
  MemoryRequestDedupe,
  MemoryRuntimeState,
  MemoryTurnIndex,
} from "../../src/index.js";
import { ContextAssembler } from "../../src/context/assembler.js";
import { ContextServiceImpl } from "../../src/context/service.js";
import { ContextStore } from "../../src/context/store.js";
import { Gateway } from "../../src/gateway/server.js";
import type { ModuleHostBridge } from "../../src/modules/contract.js";
import { HOST_SERVICE_NAMES } from "../../src/modules/contract.js";
import {
  DealingService,
  type DealingContext,
  type DealingRetrieval,
} from "../../src/modules/dealing/service.js";
import type { StorageBundle } from "../../src/storage/interfaces.js";
import { TestClient } from "../helpers.js";
import { createContextFixture, type ContextFixture } from "../context/support.js";

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

function hit(cardId: string): CardSearchHit {
  return {
    card: {
      cardId,
      kind: "note",
      title: cardId,
      tags: [],
      persona: "default",
      createdAt: "2026-01-01T00:00:00.000Z",
      lifecycle: "live",
    },
    score: 1,
    snippet: cardId,
  };
}

function retrieval(hits: readonly CardSearchHit[], fail = false): DealingRetrieval {
  return {
    async search(): Promise<CardPage<CardSearchHit>> {
      if (fail) throw new Error("索引壞掉");
      return { items: [...hits] };
    },
  };
}

function judgeInvoker(
  probabilities: Readonly<Record<string, number>>,
  seen: SystemOneJudgeRequest[] = [],
): SystemOneInvoker {
  return {
    async judge(request) {
      seen.push(request);
      return {
        answers: Object.entries(probabilities).map(([key, probability]) => ({
          kind: "yes-no" as const,
          key,
          probability,
        })),
        missing: [],
      };
    },
  };
}

interface Built {
  readonly contextService: ContextServiceImpl;
  readonly dealing: DealingService;
  readonly store: ContextStore;
  readonly events: { readonly value: unknown[] };
}

function buildDealing(
  input: {
    readonly judge?: SystemOneInvoker | null;
    readonly retrievalService?: DealingRetrieval;
    readonly budget?: number;
  } = {},
): Built {
  const store = new ContextStore(fixture.db);
  const assembler = new ContextAssembler({
    store,
    cards: fixture.cards,
    budget: () => ({ contextWindow: 100_000, reserveTokens: 0, compactionThreshold: 0.75 }),
    now: () => new Date("2026-11-15T04:00:00.000Z"),
    timeZone: "Asia/Taipei",
  });
  const events: { readonly value: unknown[] } = { value: [] };
  const contextService = new ContextServiceImpl({
    store,
    assembler,
    engine: fixture.engine,
    models: {
      async invoke() {
        throw new Error("測試不呼叫模型");
      },
    },
    protocol: {
      emit(event) {
        events.value.push(event);
      },
    },
    contextWindow: () => 100_000,
  });
  const dealingContext: DealingContext = contextService;
  const dealing = new DealingService({
    cards: fixture.cards,
    context: dealingContext,
    retrieval: input.retrievalService ?? retrieval([hit("card_0001")]),
    models: undefined,
    invoker: {
      async invoke() {
        throw new Error("測試直接注入 judge");
      },
    },
    settings: {
      get(key) {
        return key === "dealing.budgetTokens" ? (input.budget ?? 1500) : undefined;
      },
    },
    warn: () => {},
    info: () => {},
    ...(input.judge === undefined
      ? {}
      : input.judge === null
        ? { judge: null }
        : {
            judge: {
              profile: { threshold: 0.6, candidateLimit: 20, timeoutMs: 5_000 },
              invoker: input.judge,
            },
          }),
  });
  return { contextService, dealing, store, events };
}

describe("開局發牌服務", () => {
  it("第一則訊息把過門檻的卡寫進第 4 層，帶機率與來源，並推前綴", async () => {
    fixture.cards.add({ kind: "memory", title: "相關卡", body: "與請求直接相關。" });
    fixture.cards.add({ kind: "memory", title: "不相關卡", body: "只是主題相近。" });
    const seen: SystemOneJudgeRequest[] = [];
    const { contextService, dealing } = buildDealing({
      retrievalService: retrieval([hit("card_0001"), hit("card_0002")]),
      judge: judgeInvoker({ card_0001: 0.9, card_0002: 0.3 }, seen),
    });
    const session = "session-deal-1";
    await contextService.attach(session);

    const outcome = await dealing.dealIfNeeded({
      sessionId: session,
      requestText: "第一部分：訊息",
      turnIndex: 0,
    });

    expect(outcome?.source).toBe("system-one");
    expect(outcome?.cards.map((card) => card.cardId)).toEqual(["card_0001"]);
    const view = await contextService.view(session);
    const opening = view.entries.filter((entry) => entry.layer === "opening-memory");
    expect(opening).toHaveLength(1);
    expect(opening[0]?.dealProbability).toBe(0.9);
    expect(opening[0]?.dealSource).toBe("system-one");
    // 送給 System One 的只有標題與摘要，沒有內文。
    expect(JSON.stringify(seen[0]?.state)).not.toContain("與請求直接相關");
  });

  it("重開狀態庫後仍讀得到發牌機率與來源，不靠行程內狀態", async () => {
    fixture.cards.add({ kind: "memory", title: "相關卡", body: "與請求直接相關。" });
    const { contextService, dealing } = buildDealing({
      retrievalService: retrieval([hit("card_0001")]),
      judge: judgeInvoker({ card_0001: 0.9 }),
    });
    const session = "session-deal-restart";
    await contextService.attach(session);
    await dealing.dealIfNeeded({
      sessionId: session,
      requestText: "第一部分：訊息",
      turnIndex: 0,
    });
    const before = (await contextService.view(session)).entries.filter(
      (entry) => entry.layer === "opening-memory",
    );
    expect(before[0]?.dealProbability).toBe(0.9);
    expect(before[0]?.dealSource).toBe("system-one");

    // 模擬行程重啟：關掉原本的連線，重新開一個全新的 ContextStore。
    fixture.db.close();
    const reopened = openStateDatabase({
      filePath: join(fixture.root, "state", "cardiary.sqlite"),
      appVersion: "0.1.0",
      backupDirectory: join(fixture.root, "tmp"),
    });
    try {
      const after = new ContextStore(reopened.db)
        .entries(session)
        .filter((entry) => entry.layer === "opening-memory");
      expect(after).toHaveLength(1);
      expect(after[0]?.dealProbability).toBe(0.9);
      expect(after[0]?.dealSource).toBe("system-one");
    } finally {
      reopened.db.close();
    }
  });

  it("第二則訊息不再發牌，第 4 層位元組不變；沒有 System One 時依檢索名次退路", async () => {
    fixture.cards.add({ kind: "memory", title: "退路卡", body: "由檢索排名發出。" });
    const { contextService, dealing } = buildDealing({ judge: null });
    const session = "session-deal-2";
    await contextService.attach(session);

    const first = await dealing.dealIfNeeded({
      sessionId: session,
      requestText: "第一部分",
      turnIndex: 0,
    });
    expect(first?.source).toBe("retrieval");
    const before = JSON.stringify(
      (await contextService.view(session)).entries.filter((e) => e.layer === "opening-memory"),
    );
    const openingBefore = JSON.parse(before) as { readonly dealProbability?: number }[];
    expect(openingBefore[0]?.dealProbability).toBeUndefined();

    const second = await dealing.dealIfNeeded({
      sessionId: session,
      requestText: "第二部分",
      turnIndex: 1,
    });
    expect(second).toBeNull();
    const after = JSON.stringify(
      (await contextService.view(session)).entries.filter((e) => e.layer === "opening-memory"),
    );
    expect(after).toBe(before);
  });

  it("檢索失敗回 0 候選、不發卡，只寫開局標記；對話照常", async () => {
    const { contextService, dealing } = buildDealing({
      judge: null,
      retrievalService: retrieval([], true),
    });
    const session = "session-deal-3";
    await contextService.attach(session);

    const outcome = await dealing.dealIfNeeded({
      sessionId: session,
      requestText: "第一部分",
      turnIndex: 0,
    });
    expect(outcome?.cards).toHaveLength(0);
    const opening = (await contextService.view(session)).entries.filter(
      (entry) => entry.layer === "opening-memory",
    );
    // 0 張時寫一個沒有 cardId 的標記，避免下一則又走一遍檢索。
    expect(opening).toHaveLength(1);
    expect(opening[0]?.cardId).toBeUndefined();
    const again = await dealing.dealIfNeeded({
      sessionId: session,
      requestText: "第一部分",
      turnIndex: 0,
    });
    expect(again).toBeNull();
  });

  it("預算低於下限時夾到 500；重複發牌結果與順序完全相同", async () => {
    fixture.cards.add({ kind: "memory", title: "卡一", body: "內容一" });
    fixture.cards.add({ kind: "memory", title: "卡二", body: "內容二" });
    const { dealing } = buildDealing({
      retrievalService: retrieval([hit("card_0001"), hit("card_0002")]),
      judge: judgeInvoker({ card_0001: 0.9, card_0002: 0.8 }),
      budget: 5,
    });
    const session = "session-deal-4";
    const outcome = await dealing.dealIfNeeded({
      sessionId: session,
      requestText: "第一部分",
      turnIndex: 0,
    });
    expect(outcome?.budgetTokens).toBe(500);
    expect(outcome?.cards.length).toBeGreaterThan(0);
    const contextWithCards = buildDealing({
      retrievalService: retrieval([hit("card_0001"), hit("card_0002")]),
      judge: judgeInvoker({ card_0001: 0.9, card_0002: 0.8 }),
    });
    const session2 = "session-deal-4b";
    await contextWithCards.contextService.attach(session2);
    const first = await contextWithCards.dealing.dealIfNeeded({
      sessionId: session2,
      requestText: "第一部分",
      turnIndex: 0,
    });
    const view = await contextWithCards.contextService.view(session2);
    const dealtIds = view.entries
      .filter((entry) => entry.layer === "opening-memory")
      .map((entry) => entry.cardId);
    expect(dealtIds).toEqual(first?.cards.map((card) => card.cardId));
  });
});

describe("閘道接線", () => {
  function modulesWithDealing(
    context: ContextServiceImpl,
    dealing: DealingService,
  ): ModuleHostBridge {
    const services = new Map<string, unknown>([
      ["context", context],
      [HOST_SERVICE_NAMES.dealing, dealing],
    ]);
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
      folder: { path: fixture.root, folderId: "folder_dealing", displayName: "發牌" },
    } as StorageBundle;
  }

  it("第一則 send_message 觸發發牌，第二則不重複；對話正常完成", async () => {
    fixture.cards.add({ kind: "memory", title: "相關卡", body: "內容" });
    const { contextService, dealing } = buildDealing({ judge: null });
    const gateway = new Gateway({
      engine: fixture.engine,
      storage: storageBundle(),
      epoch: "epoch-dealing",
      clientToken: "B".repeat(43),
      logger: silentLogger,
      status: () => ({
        folderState: "ready",
        displayName: "發牌",
        writable: true,
        serviceState: "running",
        version: "0.1.0",
        uptimeSeconds: 0,
        activeTasks: 0,
      }),
      modules: modulesWithDealing(contextService, dealing),
    });
    const port = await gateway.listen(0);
    const client = await TestClient.connect(`ws://127.0.0.1:${port}/v1/ws`);
    try {
      await client.waitForReply(await client.hello("B".repeat(43)));
      const created = await client.waitForReply(
        client.request("session.create", { clientRequestId: "deal-seam-1" }),
      );
      const sessionId = (created.payload as { session: { id: string } }).session.id;
      await client.waitForReply(client.request("session.subscribe", { sessionId }));

      const first = await client.waitForReply(
        client.request("session.send_message", {
          sessionId,
          text: "第一則",
          delivery: "queue",
        }),
      );
      expect((first.payload as { disposition: string }).disposition).toBe("started");
      await client.waitForEvent("stream.message_completed");
      const opening = (await contextService.view(sessionId)).entries.filter(
        (entry) => entry.layer === "opening-memory",
      );
      expect(opening).toHaveLength(1);
      expect(opening[0]?.cardId).toBe("card_0001");

      const second = await client.waitForReply(
        client.request("session.send_message", {
          sessionId,
          text: "第二則",
          delivery: "queue",
        }),
      );
      expect((second.payload as { disposition: string }).disposition).toBe("started");
      await client.waitForEvent("stream.message_completed");
      const after = (await contextService.view(sessionId)).entries.filter(
        (entry) => entry.layer === "opening-memory",
      );
      expect(after).toHaveLength(1);
    } finally {
      await client.close().catch(() => undefined);
      await gateway.close().catch(() => undefined);
    }
  });
});
