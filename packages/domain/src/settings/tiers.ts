/**
 * 設定分級的領域規則。
 *
 * 分級是純政策：誰能做什麼，由這裡決定；值存在哪裡、紀錄寫到哪裡由 host
 * 處理。代理看不到 `human-only` 設定，連鍵名都不能從拒絕訊息猜出來。
 */

/** 代理可以做的三種分級；缺值或陌生值一律當 `human-only`。 */
export type SettingTier = "free" | "approval" | "human-only";

/** 動作的發起者。系統動作視同人工核准的信任層級。 */
export type SettingActorKind = "human" | "agent" | "system";

/** 對設定要做的事。 */
export type SettingAction = "read" | "list" | "change" | "propose" | "decide";

/** 政策允許時要產生的效果。 */
export type SettingEffect = "apply" | "propose" | "deny" | "hide";

export interface SettingDecision {
  readonly allowed: boolean;
  readonly effect: SettingEffect;
}

/** 陌生值、漏標與字串大小写都收斂到安全預設。 */
export function normalizeSettingTier(value: unknown): SettingTier {
  return value === "free" || value === "approval" ? value : "human-only";
}

function isAgent(actor: SettingActorKind): boolean {
  return actor === "agent";
}

/**
 * 代理只能讀取與提議非 `human-only` 的設定；`free` 由代理直接改，
 * `approval` 先提議。人工與系統可以讀寫所有設定，`decide` 的 pending
 * 狀態由 host 另外檢查，政策層只負責角色。
 */
export function decideSettingAction(
  tier: unknown,
  actor: SettingActorKind,
  action: SettingAction,
): SettingDecision {
  const normalized = normalizeSettingTier(tier);
  if (!isAgent(actor)) {
    return { allowed: true, effect: action === "propose" ? "propose" : "apply" };
  }
  if (normalized === "human-only") {
    return { allowed: false, effect: action === "read" || action === "list" ? "hide" : "deny" };
  }
  if (action === "read" || action === "list") {
    return { allowed: true, effect: "apply" };
  }
  if (normalized === "approval") {
    return { allowed: action === "propose" || action === "change", effect: "propose" };
  }
  return { allowed: action === "change" || action === "propose", effect: "apply" };
}

/** 代理是否能看到這一項；`list` 過濾與 `read` 拒絕共用同一個判斷。 */
export function isSettingVisible(tier: unknown, actor: SettingActorKind): boolean {
  return decideSettingAction(tier, actor, "list").allowed;
}
