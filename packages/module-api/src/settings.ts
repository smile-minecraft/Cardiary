import type { ActorRef, IsoInstant, JsonValue, Unsubscribe } from "@cardiary/engine-adapter";

/**
 * 設定分級。
 *
 * - `free`：代理可以直接改，留下變更紀錄。
 * - `approval`：代理提議後由人核准。
 * - `human-only`：代理讀不到也改不了。
 */
export type SettingLevel = "free" | "approval" | "human-only";

/** 設定值的型別。 */
export type SettingValue = JsonValue;

/** 設定項的輸入種類；設定頁據此產生表單。 */
export type SettingValueKind =
  "string" | "number" | "integer" | "boolean" | "enum" | "string-list" | "path";

/** 設定項的宣告；寫在模組描述檔裡。 */
export interface SettingDeclaration {
  readonly key: string;
  readonly title: string;
  readonly description?: string;
  readonly kind: SettingValueKind;
  /**
   * 分級；省略時一律視為 `human-only`。
   *
   * 「未標明即僅限人類」是安全預設，模組主機載入描述檔時補上，
   * 不要為了好用而改成 `free`。
   */
  readonly level?: SettingLevel;
  readonly defaultValue?: SettingValue;
  /** `enum` 的選項。 */
  readonly choices?: readonly string[];
  readonly min?: number;
  readonly max?: number;
}

/** 設定值變更。 */
export interface SettingChange {
  readonly key: string;
  readonly previousValue: SettingValue | undefined;
  readonly nextValue: SettingValue;
  readonly level: SettingLevel;
  readonly changedBy: ActorRef;
  readonly changedAt: IsoInstant;
}

/** 模組讀取自己設定值與分級的介面；只能讀到自己模組的設定。 */
export interface ModuleSettingsReader {
  get(key: string): SettingValue | undefined;
  getLevel(key: string): SettingLevel;
  onChange(listener: (change: SettingChange) => void): Unsubscribe;
}
