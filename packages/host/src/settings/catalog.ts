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

export const HUMAN_ONLY_SETTING_KEYS = [
  "permissions.mode",
  "permissions.hardRules",
  "permissions.allowlist",
  "boards.agentMode",
  "boards.operationPermissions",
  "folder.location",
  "secrets.keys",
  "network.allowedHosts",
] as const;

const HUMAN_ONLY_TITLES: Record<(typeof HUMAN_ONLY_SETTING_KEYS)[number], string> = {
  "permissions.mode": "權限模式",
  "permissions.hardRules": "硬規則",
  "permissions.allowlist": "白名單",
  "boards.agentMode": "白板與代理模式",
  "boards.operationPermissions": "白板操作權",
  "folder.location": "資料夾位置",
  "secrets.keys": "API 金鑰",
  "network.allowedHosts": "網域 allowlist",
};

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  ...HUMAN_ONLY_SETTING_KEYS.map((key) => ({
    key,
    level: "human-only" as const,
    title: HUMAN_ONLY_TITLES[key],
    description: "僅限人類；代理讀不到，也不能修改或提議。",
    defaultValue: null,
  })),
  {
    key: "retrieval.allowModelDownload",
    level: "human-only",
    title: "允許下載本機嵌入模型",
    description:
      "允許下載本機嵌入模型（約 600 MB，存在資料夾的 cache/）。未同意前不啟用向量檢索：檢索狀態為「向量檢索未啟用：尚未同意下載模型」。",
    defaultValue: false,
  },
  {
    key: "context.compactionThreshold",
    level: "free",
    title: "壓縮門檻",
    description: "上下文佔用達到可用預算的這個比例時壓縮；預設 0.75。",
    defaultValue: 0.75,
  },
  {
    key: "context.reserveTokens",
    level: "free",
    title: "保留給輸出的 token",
    description: "可用預算要扣掉的輸出保留量；預設 8192。",
    defaultValue: 8_192,
  },
  {
    key: "dealing.budgetTokens",
    level: "free",
    title: "發牌 token 預算",
    description: "開局發牌最多裝入第 4 層的 token 數；預設 1500。",
    defaultValue: 1_500,
  },
  {
    key: "freshness.halfLifeDays",
    level: "free",
    title: "新鮮度半衰期（天）",
    description: "卡片沒有載入時，每過這麼多天新鮮度剩一半。",
    defaultValue: 30,
  },
  {
    key: "conversation.archiveCountdownDays",
    level: "free",
    title: "封存倒數（天）",
    description: "封存後幾天刪除對話；預設 7。",
    defaultValue: 7,
  },
  {
    key: "distillation.time",
    level: "free",
    title: "每日蒸餾時間",
    description: "每日蒸餾觸發的當地時間（HH:MM）；預設 04:00。",
    defaultValue: "04:00",
  },
  {
    key: "core.tokenBudget",
    level: "free",
    title: "核心記憶 token 預算",
    description: "核心記憶組約可佔用的 token 上限；預設 800。",
    defaultValue: 800,
  },
  {
    key: "notifications.systemCenter",
    level: "free",
    title: "系統通知中心",
    description: "收到新通知時在 macOS 通知中心顯示。",
    defaultValue: true,
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
