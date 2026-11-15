import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createInMemoryApprovalLedger,
  type ProviderCredentialSource,
} from "@cardiary/engine-adapter";
import { FakeEngine } from "@cardiary/engine-fake";
import type { ModelInfo, ModelProviderInfo } from "@cardiary/protocol";

import { m0PermissionGate } from "../../src/engine/permission.js";
import { SilentLogger } from "../../src/logging.js";
import {
  SettingsService,
  type SettingsRecord,
  type SettingsStoreLike,
  type StoreSettingInput,
} from "../../src/settings/index.js";

/** 記憶體版的設定儲存；行為與 `SettingsStore` 相同的最小介面。 */
export class MemorySettingsStore implements SettingsStoreLike {
  readonly rows = new Map<string, SettingsRecord>();
  readonly changes: Array<{
    readonly key: string;
    readonly oldValue: string | null;
    readonly newValue: string;
  }> = [];
  /** 測試注入寫入失敗的鍵；`setMany` 遇到它時整批不生效。 */
  failOnKey: string | undefined;
  #now: () => Date;

  constructor(now: () => Date = () => new Date("2026-11-15T00:00:00.000Z")) {
    this.#now = now;
  }

  get(key: string): SettingsRecord | null {
    return this.rows.get(key) ?? null;
  }

  list(): SettingsRecord[] {
    return [...this.rows.values()].sort((left, right) => left.key.localeCompare(right.key));
  }

  set(input: StoreSettingInput): SettingsRecord {
    const previous = this.rows.get(input.key) ?? null;
    const record = this.#record(input);
    this.rows.set(input.key, record);
    this.changes.push({
      key: input.key,
      oldValue: previous?.value ?? null,
      newValue: input.value,
    });
    return record;
  }

  setMany(inputs: readonly StoreSettingInput[]): SettingsRecord[] {
    const staged = new Map(this.rows);
    const changes: Array<{ key: string; oldValue: string | null; newValue: string }> = [];
    const records: SettingsRecord[] = [];
    for (const input of inputs) {
      if (input.key === this.failOnKey) {
        throw new Error(`注入的設定寫入失敗：${input.key}`);
      }
      const previous = staged.get(input.key) ?? null;
      const record = this.#record(input);
      staged.set(input.key, record);
      changes.push({
        key: input.key,
        oldValue: previous?.value ?? null,
        newValue: input.value,
      });
      records.push(record);
    }
    this.rows.clear();
    for (const [key, record] of staged) {
      this.rows.set(key, record);
    }
    this.changes.push(...changes);
    return records;
  }

  #record(input: StoreSettingInput): SettingsRecord {
    return {
      key: input.key,
      value: input.value,
      level: input.level,
      updatedAt: this.#now().toISOString(),
      updatedBy: input.updatedBy,
    };
  }
}

export function settingsService(
  store: MemorySettingsStore = new MemorySettingsStore(),
): SettingsService {
  return new SettingsService(store, { now: () => new Date("2026-11-15T00:00:00.000Z") });
}

export function model(
  modelId: string,
  options: { readonly maxOutputTokens?: number; readonly contextWindow?: number } = {},
): ModelInfo {
  return {
    modelId,
    displayName: modelId,
    contextWindow: options.contextWindow ?? 32_768,
    ...(options.maxOutputTokens === undefined ? {} : { maxOutputTokens: options.maxOutputTokens }),
    input: ["text"],
  };
}

export function provider(
  overrides: Partial<ModelProviderInfo> & { readonly providerId: string },
): ModelProviderInfo {
  return {
    kind: "local",
    displayName: overrides.providerId,
    baseUrl: "http://127.0.0.1:1/v1",
    credentialRef: `cardiary/provider/${overrides.providerId}`,
    models: [model("local-model")],
    ...overrides,
  };
}

export function credentialsWith(
  secrets: Readonly<Record<string, string>>,
): ProviderCredentialSource {
  return {
    async resolve(ref) {
      const secret = secrets[ref];
      if (secret === undefined) {
        throw Object.assign(new Error(`缺少 ${ref}`), { code: "model-unavailable" });
      }
      const providerId = ref.split("/")[1] ?? "unknown";
      return { provider: providerId, kind: "api-key", secret };
    },
  };
}

export function credentialsMissing(): ProviderCredentialSource {
  return {
    async resolve(ref) {
      throw Object.assign(new Error(`缺少 ${ref}`), { code: "model-unavailable" });
    },
  };
}

/** 開一個假引擎；只給模型設定與角色解析的測試使用。 */
export async function openEngine(): Promise<FakeEngine> {
  const root = await mkdtemp(join(tmpdir(), "cardiary-model-test-"));
  const engine = new FakeEngine({
    environment: {
      stateDir: join(root, "state"),
      tempDir: join(root, "tmp"),
      defaultWorkingDir: root,
    },
    approvals: createInMemoryApprovalLedger(),
    permissionGate: m0PermissionGate,
    credentials: credentialsMissing(),
    logger: new SilentLogger(),
  });
  await engine.open();
  return engine;
}
