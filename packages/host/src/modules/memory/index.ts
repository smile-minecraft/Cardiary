/**
 * 每日蒸餾模組的進入點。
 *
 * 接好蒸餾服務、通知服務、復原處理器、核心記憶上下文區段與排程；對外提供
 * `HOST_SERVICE_NAMES.notifications`（給其他模組建立通知）與 `memory` 服務。
 * 啟動時續跑中斷的 run；每日 04:00 的觸發由排程定義提供。
 *
 * 注意：目前模組主机的 `registerContextSection`／`registerSchedule` 是 no-op，
 * 核心組第 3 層的實際渲染與排程觸發需要主机端接線（見測試與回報的已知限制）。
 */

import type { HostModule, ModuleActivationContext } from "@cardiary/module-api";
import { clampCoreTokenBudget, CORE_TOKEN_BUDGET_DEFAULT } from "@cardiary/domain";
import { NotificationStore } from "@cardiary/storage";
import type { CardService } from "@cardiary/domain";

import { HOST_SERVICE_NAMES, type CardEnvironment } from "../contract.js";
import type { CardIndex } from "@cardiary/domain";
import { manifest } from "./manifest.js";
import { MemoryCardWriter } from "./card-writer.js";
import { createCoreMemorySection } from "./context-section.js";
import { HostNotificationService } from "./notifications.js";
import { registerMemoryProtocol } from "./protocol.js";
import { DistillationService } from "./service.js";
import {
  CardLifecycleStore,
  CoreMemoryStore,
  DistillationStore,
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
  const notificationService = new HostNotificationService(notifications, context.services.protocol);

  // 提供給其他模組（蒸餾自己用同一個）。
  context.services.host.provide(HOST_SERVICE_NAMES.notifications, notificationService);

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

  // 核心記憶第 3 層區段（注册依赖主机端贡献渲染）。
  const section = createCoreMemorySection({ core, cards, tokenBudget });
  context.registerContextSection(section);

  // 排程：每日蒸餾（registerSchedule 依賴主机端排程 runner 接線）。
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
      await runDailyMaintenance(cabinet);
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
async function runDailyMaintenance(cabinet: CardEnvironment): Promise<void> {
  // 狀態庫的完整 VACUUM 與 checkpoint；引擎庫由主机在 PersistentStorage 持有，
  // 这里只對可取得的狀態庫執行，另一條由主机每日維護補足。
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
