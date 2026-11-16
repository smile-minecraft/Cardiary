/**
 * 每日蒸餾模組的進入點。
 *
 * 接好蒸餾服務、通知服務、復原處理器、核心記憶上下文區段與排程；對外提供
 * `memory` 服務。通知一律使用排程模組提供的 `HOST_SERVICE_NAMES.notifications`，
 * 自己不寫通知表。啟動時續跑中斷的 run；每日 04:00 的觸發由排程定義提供，
 * 排程器由主機的模組註冊表收集。
 */

import type {
  HostModule,
  ModuleActivationContext,
  NotificationService,
  ProtocolRequestContext,
} from "@cardiary/module-api";
import type { JsonValue } from "@cardiary/engine-adapter";
import { clampCoreTokenBudget, CORE_TOKEN_BUDGET_DEFAULT } from "@cardiary/domain";
import { NotificationStore } from "@cardiary/storage";
import type { CardService } from "@cardiary/domain";

import { HOST_SERVICE_NAMES, type CardEnvironment } from "../contract.js";
import type { CardIndex } from "@cardiary/domain";
import { manifest } from "./manifest.js";
import { MemoryCardWriter } from "./card-writer.js";
import { createCoreMemorySection } from "./context-section.js";
import { registerMemoryProtocol } from "./protocol.js";
import { scriptedDistiller, scriptedJudge } from "./models.js";
import { DistillationService } from "./service.js";
import {
  CardLifecycleStore,
  CoreMemoryStore,
  DistillationStore,
  type StorageMaintenance,
} from "@cardiary/storage";
import type { UndoOptions } from "./undo.js";

export const hostModule: HostModule = {
  manifest,
  activate,
};

function activate(context: ModuleActivationContext): void {
  const cabinet = context.services.host.require<CardEnvironment>(HOST_SERVICE_NAMES.cardStorage);
  const cards = context.services.host.require<CardService>(HOST_SERVICE_NAMES.cards);
  const cardIndex = context.services.host.get<CardIndex>(HOST_SERVICE_NAMES.cardIndex);
  const now = (): Date => context.services.clock.now();

  const runs = new DistillationStore(cabinet.state, { now });
  const core = new CoreMemoryStore(cabinet.state, { now });
  const lifecycle = new CardLifecycleStore(cabinet.state, { now });
  const writer = new MemoryCardWriter({ cardsDirectory: context.services.paths.cards, now });
  const notifications = new NotificationStore(cabinet.state, { now });
  // 主機接好的完整維護（掃描、淘汰、日誌輪替、兩個資料庫的 VACUUM）；
  // 記憶體組裝沒有這個服務，退回只回收狀態庫。
  const maintenance = context.services.host.get<StorageMaintenance>("storage.maintenance");
  // 通知一律走排程模組提供的受控服務（持久化、未讀計數、事件、保留都由它負責）。
  // 模組依目錄順序載入，memory 可能早於 scheduler；所以每次通知當下才解析，
  // 不能在启用時抓一次就快取，否則永遠拿到降級的空白實作。
  const notificationService: NotificationService = {
    create(input) {
      const live = context.services.host.get<NotificationService>(HOST_SERVICE_NAMES.notifications);
      if (live !== undefined) return live.create(input);
      return Promise.resolve({ notificationId: `ntf_local_${now().getTime()}` });
    },
  };

  const rescanCards = async (): Promise<void> => {
    await cardIndex?.rescan();
  };
  const tokenBudget = (): number => {
    const raw = context.services.settings.get("core.tokenBudget");
    return clampCoreTokenBudget(typeof raw === "number" ? raw : CORE_TOKEN_BUDGET_DEFAULT);
  };

  const service = new DistillationService({
    cards,
    models: context.services.models,
    runs,
    core,
    lifecycle,
    writer,
    rescanCards,
    notifications: notificationService,
    logger: context.services.logger,
    now,
    tokenBudget,
  });

  // `module.memory.undo` 處理器。
  const undo: UndoOptions = {
    cards,
    runs,
    core,
    lifecycle,
    notifications: {
      get: (id) => {
        const record = notifications.get(id);
        return record === null ? null : { payloadJson: record.payloadJson };
      },
    },
    now,
  };
  registerMemoryProtocol({ undo, protocol: context.services.protocol });
  // 整合驗收接縫：只在測試環境（CARDIARY_TEST_FAULTS=1）註冊，讓黑箱契約測試
  // 能把卡片的新鮮度歸零、用腳本化模型跑一次當日蒸餾。正式組裝看不到這個命名空間。
  if (process.env.CARDIARY_TEST_FAULTS === "1") {
    registerMemoryTestProtocol({
      protocol: context.services.protocol,
      state: cabinet.state,
      service,
      now,
    });
  }

  // 核心記憶第 3 層區段：由上下文組裝器在每次組裝時呼叫。
  const section = createCoreMemorySection({ core, cards, tokenBudget });
  context.registerContextSection(section);

  // 排程：每日蒸餾；declaration 由主機的模組註冊表收集並同步給排程器。
  const time = readTime(context.services.settings.get("distillation.time"));
  context.registerSchedule({
    scheduleId: "memory.distillation.daily",
    title: "每日蒸餾",
    description: "每日蒸餾歸零卡片為長久記憶並維護核心記憶組。",
    trigger: { kind: "cron", expression: cronFor(time), timezone: "local" },
    defaultEnabled: true,
    requiresApproval: false,
    run: async () => {
      const day = now().toISOString().slice(0, 10);
      await service.runForDay("default", day);
      runDailyMaintenance(cabinet, maintenance);
    },
  });

  // 啟動時續跑中斷的 run（錯過多次也只補每次中斷的 run）。
  void service.resumeInterrupted().catch((error: unknown) => {
    context.services.logger.warn("啟動續跑蒸餾失敗", {
      message: error instanceof Error ? error.message : String(error),
    });
  });

  context.services.host.provide("memory", service);
}

/** 蒸餾後的第 13 章每日維護：兩個資料庫的完整 VACUUM。 */
function runDailyMaintenance(
  cabinet: CardEnvironment,
  maintenance: StorageMaintenance | undefined,
): void {
  if (maintenance !== undefined) {
    maintenance.daily();
    return;
  }
  // 記憶體組裝沒有檔案登記簿與引擎庫；至少回收狀態庫，不留未合併的 WAL。
  const db = cabinet.state;
  db.checkpoint();
  db.vacuum();
  db.checkpoint();
}

function readTime(value: unknown): string {
  return typeof value === "string" && /^\d{2}:\d{2}$/.test(value) ? value : "04:00";
}

/** 整合驗收用的測試命名空間；正式環境不會註冊。 */
function registerMemoryTestProtocol(options: {
  readonly protocol: {
    registerNamespace(
      namespace: string,
      handler: (request: ProtocolRequestContext) => Promise<JsonValue>,
    ): unknown;
  };
  readonly state: { run(sql: string, ...params: readonly unknown[]): unknown };
  readonly service: DistillationService;
  readonly now: () => Date;
}): void {
  options.protocol.registerNamespace("module.memory.test", async (request) => {
    const raw = request.payload;
    const payload =
      raw !== null && typeof raw === "object" && "data" in raw
        ? (raw as { data: Record<string, unknown> }).data
        : {};
    if (request.type === "module.memory.test.zero-freshness") {
      options.state.run(
        "UPDATE card_state SET freshness = 0, freshness_at = ? WHERE lifecycle = 'live'",
        options.now().toISOString(),
      );
      return { data: { zeroed: true } } as JsonValue;
    }
    if (request.type === "module.memory.test.run-daily") {
      const text = typeof payload["itemText"] === "string" ? payload["itemText"] : "整合驗收記憶";
      const title = typeof payload["title"] === "string" ? payload["title"] : "整合驗收長期記憶";
      const day = options.now().toISOString().slice(0, 10);
      const run = await options.service.runForDay("default", day, {
        distiller: scriptedDistiller(() => ({
          items: [{ type: "fact", text }],
        })),
        judge: scriptedJudge(() => false),
        titler: async () => ({
          title,
          ...(typeof payload["summary"] === "string" ? { summary: payload["summary"] } : {}),
        }),
      });
      return {
        data: {
          run: run === null ? null : { runId: run.runId, status: run.status, stats: run.statsJson },
        },
      } as JsonValue;
    }
    return { data: { ok: false, reason: "not-found" } } as JsonValue;
  });
}

function cronFor(time: string): string {
  const [hour, minute] = time.split(":");
  return `${minute ?? "00"} ${hour ?? "04"} * * *`;
}
