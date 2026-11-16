import type { CardService } from "@cardiary/domain";
import type { JsonValue } from "@cardiary/engine-adapter";
import type { HostModule, ModuleActivationContext } from "@cardiary/module-api";

import type { HostEngine } from "../../engine/types.js";
import {
  ContextAssembler,
  DEFAULT_COMPACTION_THRESHOLD,
  DEFAULT_RESERVE_TOKENS,
} from "../../context/assembler.js";
import { ContextCompactor } from "../../context/compactor.js";
import { ContextServiceImpl, type ContextCompactedPayload } from "../../context/service.js";
import { ContextStore } from "../../context/store.js";
import { HOST_SERVICE_NAMES, type CardEnvironment } from "../contract.js";
import { CONTRIBUTIONS_SERVICE_NAME, type ModuleContributions } from "../registry.js";
import { manifest } from "./manifest.js";
import { registerContextProtocol } from "./protocol.js";

/**
 * 上下文模組的進入點。
 *
 * 主機已經把卡片、儲存、模型與引擎接好；這裡只建立狀態存取、組裝器、
 * 壓縮器與服務，註冊 `context.*` 並提供 `context` 服務。停用時關閉
 * 事件訂閱，資料全部保留。
 */
export const hostModule: HostModule = {
  manifest,
  activate,
  deactivate,
};

const running = new Set<ContextServiceImpl>();

async function activate(context: ModuleActivationContext): Promise<void> {
  const cabinet = context.services.host.require<CardEnvironment>(HOST_SERVICE_NAMES.cardStorage);
  const cards = context.services.host.require<CardService>(HOST_SERVICE_NAMES.cards);
  const engine = context.services.host.require<HostEngine>(HOST_SERVICE_NAMES.engine);
  const now = (): Date => context.services.clock.now();
  const warn = (message: string, fields?: { readonly [key: string]: string | number }): void =>
    context.services.logger.warn(message, fields);

  const store = new ContextStore(cabinet.state, { now });
  let service: ContextServiceImpl | null = null;
  // 模組貢獻（核心記憶第 3 層）：每次組裝時重新取得，記憶模組晚於此啟用也看得到。
  const contributions = context.services.host.get<ModuleContributions>(CONTRIBUTIONS_SERVICE_NAME);
  const assembler = new ContextAssembler({
    store,
    cards,
    now,
    sections: () => contributions?.sections() ?? [],
    budget: () =>
      service?.budget() ?? {
        contextWindow: 131_072,
        reserveTokens: DEFAULT_RESERVE_TOKENS,
        compactionThreshold: DEFAULT_COMPACTION_THRESHOLD,
      },
  });
  const compactor = new ContextCompactor({
    store,
    assembler,
    engine,
    cards,
    models: context.services.models,
    now,
    keepRecentTokens: () => settingNumber(cabinet, "context.keepRecentTokens", 8_000),
    warn,
    emit: (intent) => {
      if (intent.kind === "context-changed") {
        context.services.protocol.emit({
          kind: "context-changed",
          conversationId: intent.conversationId,
          context: intent.context as JsonValue,
        });
        return;
      }
      context.services.protocol.emit({
        kind: "context-compacted",
        conversationId: intent.conversationId,
        payload: intent.payload as JsonValue,
      });
    },
  });
  service = new ContextServiceImpl({
    store,
    assembler,
    compactor,
    engine,
    models: context.services.models,
    protocol: context.services.protocol,
    now,
    settingNumber: (key, fallback) => settingNumber(cabinet, key, fallback),
    warn,
  });
  const ready = service;

  registerContextProtocol({ service: ready, protocol: context.services.protocol });
  context.services.host.provide(HOST_SERVICE_NAMES.context, ready);
  running.add(ready);

  // 先補完中斷的壓縮，再接上那些對話：attach 會推固定前綴，順序錯了
  // 客戶端可能看到半套前綴。
  const recovery = compactor.recoverInterrupted().catch((error: unknown) => {
    warn("補做中斷的壓縮失敗", {
      message: error instanceof Error ? error.message : String(error),
    });
  });
  void recovery.then(() => {
    void attachKnownConversations(engine, ready, warn);
  });
}

/** 讀設定裡的數字；沒有值或格式不對時用預設。 */
function settingNumber(cabinet: CardEnvironment, key: string, fallback: number): number {
  const raw = cabinet.settings.get(key)?.value;
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** 啟動時接上既有對話；新對話由閘道在建立後呼叫 `attach`。 */
async function attachKnownConversations(
  engine: HostEngine,
  service: ContextServiceImpl,
  warn: (message: string, fields?: { readonly [key: string]: string | number }) => void,
): Promise<void> {
  if (typeof engine.listConversations !== "function") return;
  try {
    for (const conversation of await engine.listConversations()) {
      if (conversation.purpose !== "conversation") continue;
      await service.attach(conversation.id);
    }
  } catch (error) {
    warn("接上既有對話的上下文失敗", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** 停用：關閉事件訂閱；協定與服務的註冊由主機撤銷。 */
export function deactivate(): void {
  for (const service of running) {
    service.close();
  }
  running.clear();
}

export type { ContextCompactedPayload };
