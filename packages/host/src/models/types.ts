import type { ModelSelection } from "@cardiary/engine-adapter";
import type {
  ModelProviderInfo,
  ModelRef,
  ModelRole,
  ModelRoleSelection,
  ResolvedModelRole,
} from "@cardiary/protocol";

/**
 * 模型設定的領域型別。
 *
 * 對外的形狀與協定 `system.models.*` 相同；主機內部的解析結果另外帶
 * 「這個角色實際要用哪個引擎模型」。金鑰不在這些型別裡，只有 `credentialRef`
 * 這個帳號名。
 */

export const MODEL_ROLES: readonly ModelRole[] = ["main", "small", "writing", "system-one"];

export interface RoleResolution {
  readonly role: ModelRole;
  readonly source: ResolvedModelRole["source"];
  /** 解析後實際使用的模型；`null` 代表這個角色不啟用（System One 的「無」）。 */
  readonly selection: ModelSelection | null;
  /** 實際使用的供應商與模型識別碼；給設定頁顯示。 */
  readonly ref: ModelRef | null;
}

export interface ResolvedRoles {
  readonly main: RoleResolution;
  readonly small: RoleResolution;
  readonly writing: RoleResolution;
  readonly "system-one": RoleResolution;
  readonly list: readonly RoleResolution[];
}

/** 主機內部的完整模型設定；`state` 是協定形狀，`enhanced` 是解析後的選擇。 */
export interface ModelsSnapshot {
  readonly providers: readonly ModelProviderInfo[];
  readonly roles: ReadonlyMap<ModelRole, ModelRoleSelection>;
  readonly resolved: ResolvedRoles;
  readonly engineRoles: Readonly<Record<ModelRole, ModelSelection>>;
}

/** 角色選擇的預設值；沒寫進設定時是「未設定」，走退回規則。 */
export function unsetRole(role: ModelRole): ModelRoleSelection {
  return { role, mode: "unset" };
}

/** 讀寫設定時用的鍵。 */
export const MODEL_SETTING_KEYS = {
  providers: "models.providers",
  roles: "models.roles",
  summaryMaxOutputTokens: "models.summary.maxOutputTokens",
} as const;

/** 摘要的輸出上限下限；低於這個值主機仍用 4,096。 */
export const SUMMARY_MAX_OUTPUT_TOKENS = 4_096;
