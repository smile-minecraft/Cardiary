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
} from "@cardiary/module-api";
import { clampCoreTokenBudget, CORE_TOKEN_BUDGET_DEFAULT } from "@cardiary/domain";
import { NotificationStore } from "@cardiary/storage";
import type { CardService } from "@cardiary/domain";

import { HOST_SERVICE_NAMES, type CardEnvironment } from "../contract.js";
import type { CardIndex } from "@cardiary/domain";
import { manifest } from "./manifest.js";
import { MemoryCardWriter } from "./card-writer.js";
import { createCoreMemorySection } from "./context-section.js";
import { registerMemoryProtocol } from "./protocol.js";
import { DistillationService } from "./service.js";
import { scriptedDistillationModels, zeroFreshnessForTest } from "./test-seam.js";
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
  // 記憶模組比排程模組早啟用，所以這裡延後到呼叫當下才查找；排程模組不在時
  // 降級成不落地，蒸餾本身照常執行。
  const notificationService: NotificationService = {
    async create(input) {
      const real = context.services.host.get<NotificationService>(HOST_SERVICE_NAMES.notifications);
      if (real !== undefined) return real.create(input);
      return { notificationId: `ntf_local_${now().getTime()}` };
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
    models: scriptedDistillationModels() ?? context.services.models,
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

  // 契約測試接縫：把種子卡的新鮮度歸零（正式產品沒有這個環境變數）。
  // 卡片模組先啟用，卡已掃進 card_state；這裡只改狀態庫數值，不碰卡檔。
  zeroFreshnessForTest(cabinet.state, now);

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

  context.services.host.provide(HOST_SERVICE_NAMES.memory, service);
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

function cronFor(time: string): string {
  const [hour, minute] = time.split(":");
  return `${minute ?? "00"} ${hour ?? "04"} * * *`;
}
