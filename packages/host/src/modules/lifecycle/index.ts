import type { AssetStore, CardService } from "@cardiary/domain";
import type { HostModule, ModuleActivationContext } from "@cardiary/module-api";
import { RequestDedupeStore } from "@cardiary/storage";

import { HOST_SERVICE_NAMES, type CardEnvironment } from "../contract.js";
import { SessionLifecycleService } from "../../sessions/service.js";
import { manifest } from "./manifest.js";
import { registerLifecycleProtocol } from "./protocol.js";

/**
 * 對話生命週期模組。
 *
 * 主機已經把卡片、儲存與模型接好；這裡只建立服務、註冊 `session.*`
 * 生命週期訊息，並用一個低頻計時器處理到期的封存。啟動時先重算一次
 * 新鮮度，讓服務沒開期間的衰減在打開後反映出來。
 */

export const hostModule: HostModule = {
  manifest,
  activate,
  deactivate,
};

const running = new Set<{ stop(): void }>();

async function activate(context: ModuleActivationContext): Promise<void> {
  const cabinet = context.services.host.require<CardEnvironment>(HOST_SERVICE_NAMES.cardStorage);
  const cards = context.services.host.require<CardService>(HOST_SERVICE_NAMES.cards);
  const assets = context.services.host.require<AssetStore>(HOST_SERVICE_NAMES.assets);
  const service = new SessionLifecycleService({
    layout: cabinet.layout,
    state: cabinet.state,
    cache: () => cabinet.cache(),
    settings: cabinet.settings,
    engine: context.services.host.require(HOST_SERVICE_NAMES.engine),
    cards,
    assets,
    models: context.services.models,
    protocol: context.services.protocol,
    logger: context.services.logger,
    now: () => context.services.clock.now(),
  });

  service.recomputeFreshness();
  registerLifecycleProtocol({
    service,
    protocol: context.services.protocol,
    dedupe: new RequestDedupeStore(cabinet.state, { now: () => context.services.clock.now() }),
    now: () => context.services.clock.now(),
  });
  context.services.host.provide(HOST_SERVICE_NAMES.sessions, service);

  const timer = setInterval(() => {
    void service.processDueArchives().catch((error: unknown) => {
      context.services.logger.warn("處理封存倒數失敗", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }, 30_000);
  timer.unref?.();

  const handle = {
    stop(): void {
      clearInterval(timer);
    },
  };
  running.add(handle);
}

/** 停用：停止計時器；註冊的協定與服務由主機撤銷。 */
export function deactivate(): void {
  for (const handle of running) {
    handle.stop();
  }
  running.clear();
}
