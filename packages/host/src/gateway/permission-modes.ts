/**
 * 權限模式的協定處理：System One 審核類別、可委派網域與全部允許。
 *
 * 規格第 11 章「M5 權限模式裁決」：這些模式只由人開啟。閘道只讓本機 Mac
 * 客戶端（client Token）呼叫 `system.permissions.*`；遠端裝置與代理在閘道
 * 外層就被擋下，這裡只負責驗證輸入、呼叫 `AgentPermissions`、回傳完整狀態。
 * 範圍的規則（工具不可為空、路徑必須是絕對路徑）由 `AgentPermissions`
 * 執行，這裡再加一條：全部允許一定要限定路徑或網域。全部允許沒有期限，
 * 開啟後重啟保留，直到人撤銷或緊急全部暫停。
 */

import type { JSONObject } from "@cardiary/protocol";
import { DELEGABLE_CATEGORIES, type DelegatedCategory } from "@cardiary/domain";

import { protocolError } from "../errors.js";
import type { AgentPermissions } from "../permissions/agent-permissions.js";

export const PERMISSION_MODE_TYPES = [
  "system.permissions.get",
  "system.permissions.set_category",
  "system.permissions.set_domains",
  "system.permissions.grant_allow_all",
  "system.permissions.revoke_allow_all",
] as const;

export type PermissionModeType = (typeof PERMISSION_MODE_TYPES)[number];

export function isPermissionModeType(type: string): type is PermissionModeType {
  return (PERMISSION_MODE_TYPES as readonly string[]).includes(type);
}

/** 輸入不合法：閘道轉成 `invalid_message`。 */
export class PermissionModeInputError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
  }
}

export function permissionModesState(permissions: AgentPermissions): JSONObject {
  const status = permissions.status("");
  return {
    categories: status.categories.map((entry) => ({
      category: entry.category,
      paths: [...entry.paths],
    })),
    availableCategories: [...DELEGABLE_CATEGORIES],
    allowedDomains: [...status.allowedDomains],
    ...(status.allowAll === null
      ? {}
      : {
          allowAll: {
            tools: [...status.allowAll.tools],
            paths: [...status.allowAll.paths],
            domains: [...status.allowAll.domains],
          },
        }),
  };
}

/**
 * 套用一則權限模式請求。`get` 不改任何東西；其他型別改完回傳新狀態，
 * 呼叫端負責廣播 `system.permissions.changed`。
 */
export function applyPermissionModeRequest(
  permissions: AgentPermissions,
  type: PermissionModeType,
  payload: JSONObject,
): { readonly state: JSONObject; readonly changed: boolean } {
  switch (type) {
    case "system.permissions.get":
      return { state: permissionModesState(permissions), changed: false };
    case "system.permissions.set_category": {
      const category = payload.category;
      if (
        typeof category !== "string" ||
        !(DELEGABLE_CATEGORIES as readonly string[]).includes(category)
      ) {
        throw new PermissionModeInputError("不支援的委派類別。", "category");
      }
      if (typeof payload.enabled !== "boolean") {
        throw new PermissionModeInputError("enabled 必須是布林值。", "enabled");
      }
      const paths = stringList(payload.paths, "paths");
      wrap("paths", () =>
        permissions.setCategory(category as DelegatedCategory, payload.enabled as boolean, paths),
      );
      break;
    }
    case "system.permissions.set_domains": {
      const domains = stringList(payload.domains, "domains");
      wrap("domains", () => permissions.setAllowedDomains(domains));
      break;
    }
    case "system.permissions.grant_allow_all": {
      const tools = stringList(payload.tools, "tools");
      const paths = stringList(payload.paths, "paths");
      const domains = payload.domains === undefined ? [] : stringList(payload.domains, "domains");
      if (paths.length === 0 && domains.length === 0) {
        throw new PermissionModeInputError("全部允許必須限定路徑或網域。", "paths");
      }
      wrap("tools", () => permissions.grantAllowAll({ tools, paths, domains }));
      break;
    }
    case "system.permissions.revoke_allow_all":
      permissions.revokeAllowAll();
      break;
  }
  return { state: permissionModesState(permissions), changed: true };
}

function stringList(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    throw new PermissionModeInputError(`${field} 必須是非空字串的陣列。`, field);
  }
  return value as string[];
}

/** `AgentPermissions` 對不合法範圍丟一般錯誤；轉成可回報的輸入錯誤。 */
function wrap(field: string, action: () => void): void {
  try {
    action();
  } catch (error) {
    throw new PermissionModeInputError(
      error instanceof Error ? error.message : String(error),
      field,
    );
  }
}

export function permissionModeError(error: PermissionModeInputError) {
  return protocolError("invalid_message", error.message, { details: { field: error.field } });
}
