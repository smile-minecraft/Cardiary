import type { JSONValue, SettingItem, SettingLevel } from "@cardiary/protocol";

/**
 * 設定的目錄與分級。
 *
 * 分級是「代理的權限」，不是客戶端的權限：M1 沒有代理的設定工具，所以
 * 目前只有人類經 `system.settings.set` 修改。未列在這裡的鍵一律視為
 * `human-only`（規格書第 11 章的安全預設）。
 */

export interface SettingDefinition {
  readonly key: string;
  readonly level: SettingLevel;
  readonly title: string;
  readonly description?: string;
  /** 沒有資料列時顯示的值；只有真的適合有預設值的鍵才填。 */
  readonly defaultValue?: unknown;
}

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  {
    key: "retrieval.allowModelDownload",
    level: "human-only",
    title: "允許下載本機嵌入模型",
    description:
      "允許下載本機嵌入模型（約 600 MB，存在資料夾的 cache/）。未同意前不啟用向量檢索：檢索狀態為「向量檢索未啟用：尚未同意下載模型」。",
    defaultValue: false,
  },
  {
    key: "models.summary.maxOutputTokens",
    level: "free",
    title: "摘要輸出上限",
    description: "摘要與蒸餾的輸出 token 上限；低於 4,096 時主機仍會用 4,096。",
    defaultValue: 4_096,
  },
  {
    key: "models.providers",
    level: "approval",
    title: "模型供應商",
    description: "供應商與模型清單；不包含金鑰。由模型設定寫入。",
    defaultValue: [],
  },
  {
    key: "models.roles",
    level: "approval",
    title: "模型角色",
    description: "主力、小模型、寫作與 System One 的模型選擇。由模型設定寫入。",
    defaultValue: [],
  },
];

const BY_KEY = new Map(SETTING_DEFINITIONS.map((entry) => [entry.key, entry]));

export function settingDefinition(key: string): SettingDefinition | undefined {
  return BY_KEY.get(key);
}

export function settingLevel(key: string, fallback: SettingLevel): SettingLevel {
  return BY_KEY.get(key)?.level ?? fallback;
}

export function defaultSettingItem(definition: SettingDefinition, updatedAt: string): SettingItem {
  return {
    key: definition.key,
    value: (definition.defaultValue ?? null) as JSONValue,
    level: definition.level,
    title: definition.title,
    ...(definition.description === undefined ? {} : { description: definition.description }),
    updatedAt,
  };
}
