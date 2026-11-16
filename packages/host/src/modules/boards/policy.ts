/**
 * 代理白板模式：設定值、工具曝光與稽核理由。
 *
 * 設定本身屬「僅限人類」；這裡只讀值，不寫。`boards.agentMode` 沒有寫入
 * 紀錄時視為 `respect-user-content`，與 manifest 宣告的預設值一致。
 */

/** 設定值的兩個選項；`full` 之外的任何值都視為不動使用者內容。 */
export type BoardsAgentMode = "respect-user-content" | "full";

export const BOARDS_AGENT_MODE_KEY = "boards.agentMode";
export const BOARDS_AGENT_MODE_DEFAULT: BoardsAgentMode = "respect-user-content";

/** 投影既有卡片的工具組；只有 `full` 模式的新對話會釘選它。 */
export const BOARDS_PROJECT_BUNDLE_ID = "module.boards.project";
/** 建卡並投影到收件區的工具組；兩種模式都曝光。 */
export const BOARDS_BUNDLE_ID = "module.boards";

/**
 * 從設定儲存讀到的原始文字取出模式。
 *
 * 設定儲存保存的是 JSON 文字（字串會帶引號），`"full"` 才算 full；壞掉或沒設定
 * 一律當受限模式。
 */
export function parseAgentModeSetting(raw: string | undefined): BoardsAgentMode {
  if (raw === undefined) return BOARDS_AGENT_MODE_DEFAULT;
  try {
    return parseAgentMode(JSON.parse(raw) as unknown);
  } catch {
    return BOARDS_AGENT_MODE_DEFAULT;
  }
}

export function parseAgentMode(value: unknown): BoardsAgentMode {
  return value === "full" ? "full" : BOARDS_AGENT_MODE_DEFAULT;
}

/**
 * 建立新對話時釘選哪些工具組。
 *
 * 釘選只在建立對話時發生；既有對話維持當初的工具組，切換模式不會改變
 * 它們。執行期的防禦檢查另外看目前模式。
 */
export function pinToolBundles<T extends { readonly bundleId: string }>(
  pins: readonly T[],
  mode: BoardsAgentMode,
): readonly T[] {
  return mode === "full" ? pins : pins.filter((pin) => pin.bundleId !== BOARDS_PROJECT_BUNDLE_ID);
}
