import type {
  CredentialRef,
  JsonValue,
  ProviderCredential,
  ProviderCredentialSource,
} from "@cardiary/engine-adapter";
import type { HostModule, ModuleActivationContext } from "@cardiary/module-api";

import { BrokerCredentialSource, type BrokerClient } from "../../control/broker.js";
import { HOST_SERVICE_NAMES, type CardEnvironment } from "../contract.js";
import type { HostEngine } from "../../engine/types.js";
import { ModelRuntime } from "../../models/runtime.js";
import { SettingsGovernance } from "../../settings/governance.js";
import { SettingsService } from "../../settings/service.js";
import { TransactionalSettingsStore } from "../../settings/store.js";
import { manifest } from "./manifest.js";
import { registerSettingsProtocol } from "./protocol.js";

/**
 * 模型與設定模組。
 *
 * 設定存在 `cardStorage.settings`（`state/cardiary.sqlite`）；金鑰只從
 * `broker` 的讀取路由取得，模組不寫入、也不列舉憑證。模型設定在啟動時
 * 載入一次；沒有存過主力模型時不覆寫測試或腳本化模型已經設定的內容。
 */
export const hostModule: HostModule = {
  manifest,
  activate,
};

async function activate(context: ModuleActivationContext): Promise<void> {
  const cabinet = context.services.host.require<CardEnvironment>(HOST_SERVICE_NAMES.cardStorage);
  const engine = context.services.host.require<HostEngine>(HOST_SERVICE_NAMES.engine);
  const broker = context.services.host.get<BrokerClient>(HOST_SERVICE_NAMES.broker);
  const credentials: ProviderCredentialSource =
    broker === undefined ? new NoCredentialSource() : new BrokerCredentialSource(broker);
  const now = (): Date => context.services.clock.now();
  const settings = new SettingsService(
    new TransactionalSettingsStore(cabinet.state, cabinet.settings),
    {
      now,
      updatedBy: "system",
    },
  );
  const runtime = new ModelRuntime({
    engine,
    settings,
    credentials,
    warn: (message, fields) => context.services.logger.warn(message, fields),
  });
  await runtime.initialize();
  const governance = new SettingsGovernance({
    settings,
    layout: cabinet.layout,
    now,
  });

  context.services.host.provide(HOST_SERVICE_NAMES.models, runtime);
  context.services.host.provide(HOST_SERVICE_NAMES.settings, governance);
  runtime.onChange((state) => {
    context.services.protocol.emit({
      kind: "models-changed",
      payload: state as unknown as JsonValue,
    });
  });
  registerSettingsProtocol({
    runtime,
    settings,
    protocol: context.services.protocol,
    now,
    governance,
  });
}

/** 沒有殼的獨立執行：任何憑證都取不到，回合會以 credential_missing 結束。 */
class NoCredentialSource implements ProviderCredentialSource {
  async resolve(ref: CredentialRef): Promise<ProviderCredential> {
    throw Object.assign(new Error(`沒有可用的憑證來源：${ref}`), {
      code: "model-unavailable",
    });
  }
}
