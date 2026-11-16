import type { HostModule, ModuleActivationContext } from "@cardiary/module-api";
import { StorageCleanup } from "@cardiary/storage";

import { HOST_SERVICE_NAMES, type CardEnvironment } from "../contract.js";
import type { SpawnRegistry } from "../../spawn/wrapper.js";
import type { BrokerClient } from "../../control/broker.js";
import { manifest } from "./manifest.js";
import { registerStorageProtocol } from "./protocol.js";

/** 儲存空間模組；清理只碰 cache、tmp、可重建索引與 logs。 */
export const hostModule: HostModule = {
  manifest,
  activate,
};

async function activate(context: ModuleActivationContext): Promise<void> {
  const cabinet = context.services.host.require<CardEnvironment>(HOST_SERVICE_NAMES.cardStorage);
  const spawn = context.services.host.get<SpawnRegistry>(HOST_SERVICE_NAMES.spawn);
  const broker = context.services.host.get<BrokerClient>(HOST_SERVICE_NAMES.broker);
  const cleanup = new StorageCleanup({
    layout: cabinet.layout,
    cache: () => cabinet.cache(),
    now: () => context.services.clock.now(),
    activeToolCalls: () => spawn?.runningCount ?? 0,
  });
  registerStorageProtocol({
    cleanup,
    protocol: context.services.protocol,
    ...(broker === undefined ? {} : { shellState: () => broker.shellState() }),
  });
}
