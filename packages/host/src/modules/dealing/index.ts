/**
 * 開局發牌模組的進入點。
 *
 * 掃描 `modules/` 時載入；依相依順序在 cards、context、retrieval 之後啟動。
 * 閘道在 `session.send_message` 送出前取這個服務發牌；模組停用時閘道
 * 取不到服務，對話照常開始，只是沒有開局卡。
 */

import type { CardService } from "@cardiary/domain";
import type { HostModule, ModuleActivationContext } from "@cardiary/module-api";

import { HOST_SERVICE_NAMES } from "../contract.js";
import type { RetrievalService } from "../retrieval/service.js";
import { manifest } from "./manifest.js";
import { DealingService, type DealingContext } from "./service.js";
import type { SystemOneModels } from "./system-one.js";

export const hostModule: HostModule = {
  manifest,
  activate,
  deactivate,
};

const running = new Set<DealingService>();

async function activate(context: ModuleActivationContext): Promise<void> {
  const cards = context.services.host.require<CardService>(HOST_SERVICE_NAMES.cards);
  const dealingContext = context.services.host.require<DealingContext>(HOST_SERVICE_NAMES.context);
  const retrieval = context.services.host.get<RetrievalService>("retrieval");
  const models = context.services.host.get<SystemOneModels>(HOST_SERVICE_NAMES.models);
  const service = new DealingService({
    cards,
    context: dealingContext,
    retrieval,
    models,
    invoker: context.services.models,
    settings: context.services.settings,
    warn: (message, fields) => context.services.logger.warn(message, fields),
    info: (message, fields) => context.services.logger.info(message, fields),
  });
  context.services.host.provide(HOST_SERVICE_NAMES.dealing, service);
  running.add(service);
}

/** 停用：沒有背景資源；註冊由主機撤銷。 */
export function deactivate(): void {
  running.clear();
}
