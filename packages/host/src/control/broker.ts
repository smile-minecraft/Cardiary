import type {
  ProviderCredential,
  ProviderCredentialSource,
  CredentialRef,
} from "@cardiary/engine-adapter";

import type { ControlChannel } from "./channel.js";

export interface FolderInfo {
  readonly path: string;
  readonly displayName: string;
  readonly available: boolean;
  readonly writable: boolean;
  readonly volumeUUID?: string;
  readonly reason?: string;
}

export interface KeychainResult {
  readonly found: boolean;
  readonly value?: string;
}

/** 憑證取不到時回報的錯誤；呼叫端只依賴 `code`。 */
export class CredentialUnavailable extends Error {
  readonly code = "model-unavailable";

  constructor(message: string) {
    super(message);
    this.name = "CredentialUnavailable";
  }
}

/**
 * 系統能力代理客戶端：服務 → 殼。
 *
 * 只有三個精確路由，沒有列舉、沒有前綴比對；金鑰只留在記憶體。
 */
export class BrokerClient {
  readonly #channel: ControlChannel;

  constructor(channel: ControlChannel) {
    this.#channel = channel;
  }

  async folder(): Promise<FolderInfo> {
    const payload = await this.#channel.requestBroker("broker.folder.get", {});
    return {
      path: String(payload.path ?? ""),
      displayName: String(payload.displayName ?? ""),
      available: Boolean(payload.available),
      writable: Boolean(payload.writable),
      ...(typeof payload.volumeUUID === "string" ? { volumeUUID: payload.volumeUUID } : {}),
      ...(typeof payload.reason === "string" ? { reason: payload.reason } : {}),
    };
  }

  async keychain(account: string): Promise<KeychainResult> {
    const payload = await this.#channel.requestBroker("broker.keychain.get", { account });
    if (payload.found === true && typeof payload.value === "string") {
      return { found: true, value: payload.value };
    }
    return { found: false };
  }

  async shellState(): Promise<{ readonly usedBytes: number; readonly limitBytes: number }> {
    const payload = await this.#channel.requestBroker("broker.shell-state.get", {});
    return {
      usedBytes: Number(payload.usedBytes ?? 0),
      limitBytes: Number(payload.limitBytes ?? 0),
    };
  }
}

/** 轉接層的憑證來源；透過私有通道向殼取單一帳號。 */
export class BrokerCredentialSource implements ProviderCredentialSource {
  readonly #broker: BrokerClient;

  constructor(broker: BrokerClient) {
    this.#broker = broker;
  }

  async resolve(ref: CredentialRef): Promise<ProviderCredential> {
    const result = await this.#broker.keychain(ref);
    if (!result.found || result.value === undefined) {
      throw new CredentialUnavailable(`鑰匙圈找不到憑證：${ref}`);
    }
    const parts = ref.split("/");
    return {
      provider: parts.length >= 3 ? (parts[1] ?? "unknown") : "unknown",
      kind: "api-key",
      secret: result.value,
    };
  }
}
