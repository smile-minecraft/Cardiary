import type { HostModule, ModuleActivationContext } from "@cardiary/module-api";
import type { CardService } from "@cardiary/domain";
import { NotificationStore, ScheduleStore } from "@cardiary/storage";
import type { NotificationService } from "@cardiary/module-api";

import { HOST_SERVICE_NAMES, type CardEnvironment, type DistillationTrigger } from "../contract.js";
import type { HostEngine } from "../../engine/types.js";
import { manifest } from "./manifest.js";
import { SchedulerService } from "./service.js";
import { registerNotificationProtocol, registerSchedulerAdminProtocol } from "./protocol.js";
import { scheduleProposeTool } from "./tools.js";
import { wireNotification } from "./wire.js";

/**
 * 排程與通知模組的進入點。
 *
 * 啟動時立刻補跑一次過期的排程，之後每 30 秒 tick（另有到點喚醒）；緊急
 * 暫停時不搶新排程。通知流唯讀：沒有 `notification.reply`，討論請把通知
 * 轉成卡片（`notification.create_card`）再加入對話。
 */
export const hostModule: HostModule = {
  manifest,
  activate,
  deactivate,
};

let service: SchedulerService | null = null;
let engineStatusUnsubscribe: (() => void) | undefined;

async function activate(context: ModuleActivationContext): Promise<void> {
  const cabinet = context.services.host.require<CardEnvironment>(HOST_SERVICE_NAMES.cardStorage);
  const logger = context.services.logger;
  const now = (): Date => context.services.clock.now();
  const db = cabinet.state;
  const schedules = new ScheduleStore(db, { now });
  const notifications = new NotificationStore(db, { now });
  const engine = context.services.host.get<HostEngine>(HOST_SERVICE_NAMES.engine);
  const cards = context.services.host.get<CardService>(HOST_SERVICE_NAMES.cards);
  // 記憶模組先於排程模組啟用；蒸餾服務這時已經在服務註冊表裡。沒有記憶模組時
  // 留 undefined，蒸餾任務到點會記 error 並發通知，不會靜默略過。
  const distillation = context.services.host.get<DistillationTrigger>(HOST_SERVICE_NAMES.memory);

  const emitChanged = (record: Parameters<typeof wireNotification>[0]): void => {
    context.services.protocol.emit({
      kind: "notification-changed",
      notification: wireNotification(record),
    });
  };

  const scheduler = new SchedulerService({
    schedules,
    notifications,
    runBackgroundTask: context.services.backgroundTasks,
    // 引擎不在或不是 running（含緊急暫停）時一律不搶新工作；fail closed。
    isEngineRunning: () => engine?.getStatus().state === "running",
    emitChanged,
    logger,
    now,
    ...(distillation === undefined ? {} : { distillation }),
  });
  service = scheduler;

  const protocolDeps = {
    notifications,
    schedules,
    cards,
    db,
    now,
    poke: () => scheduler.poke(),
  };
  registerNotificationProtocol(protocolDeps, context.services.protocol);
  registerSchedulerAdminProtocol(protocolDeps, context.services.protocol);

  const notificationService: NotificationService = {
    async create(input) {
      // 受控介面：蒸餾只丟資料進來，驗證、持久化、`notification.changed`、
      // 未讀計數與 90 天保留全部由主機處理。
      const record = notifications.create({
        kind: input.kind,
        title: input.title,
        body: input.body,
        ...(input.payload === undefined ? {} : { payload: input.payload }),
        ...(input.sourceScheduleId === undefined
          ? {}
          : { sourceScheduleId: input.sourceScheduleId }),
        ...(input.sourceConversationId === undefined
          ? {}
          : { sourceConversationId: input.sourceConversationId }),
      });
      emitChanged(record);
      return { notificationId: record.notificationId };
    },
  };
  context.services.host.provide(HOST_SERVICE_NAMES.notifications, notificationService);

  context.registerToolBundle({
    bundleId: "scheduler",
    label: "排程",
    tools: [scheduleProposeTool({ schedules, now })],
  });

  scheduler.start();
  // 模組啟用時引擎還停在 starting，`start()` 裡的立即 tick 會被 isEngineRunning
  // 擋下，錯過的排程要等下一個 30 秒 tick。引擎轉成 running 的當下再補跑一次，
  // 服務關閉期間錯過的排程才能及時處理；暫停恢復後重新 running 時也適用。
  engineStatusUnsubscribe = engine?.onStatusChange((status) => {
    if (status.state === "running") {
      scheduler.poke();
    }
  });
}

function deactivate(): void {
  const current = service;
  service = null;
  current?.stop();
  engineStatusUnsubscribe?.();
  engineStatusUnsubscribe = undefined;
}
