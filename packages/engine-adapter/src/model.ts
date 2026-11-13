/**
 * 模型角色與選擇。
 *
 * 角色由主機服務解析成實際模型；轉接層只負責用指定的模型建立新對話。
 * 同一場對話不換主模型，因此介面沒有「修改對話模型」的方法。
 */
export type ModelRole = "main" | "small" | "writing" | "system-one";

/** 模型解碼參數；未指定的欄位由供應商預設值決定。 */
export interface ModelParameters {
  readonly temperature?: number;
  readonly topP?: number;
  readonly maxOutputTokens?: number;
  readonly reasoningEffort?: "low" | "medium" | "high";
}

/** 指定一個實際模型。 */
export interface ModelSelection {
  readonly provider: string;
  readonly model: string;
  readonly parameters?: ModelParameters;
}

/** 模型供應商回報的模型能力；設定頁與能力檢查使用。 */
export interface ModelDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly contextWindow: number;
  readonly maxOutputTokens?: number;
  readonly input: readonly ("text" | "image" | "audio")[];
}

/**
 * 鑰匙圈憑證的參照。
 *
 * 值是殼提供的参照，不是金鑰本身；轉接層透過 `ProviderCredentialSource`
 * 在需要時取得內容，不把金鑰寫入資料夾或日誌。
 */
export type CredentialRef = string;

/** 一個供應商的設定；包含可用模型與憑證參照。 */
export interface ModelProviderConfig {
  readonly provider: string;
  readonly label?: string;
  readonly baseUrl?: string;
  readonly credentialRef: CredentialRef;
  readonly models: readonly ModelDescriptor[];
}

/** 主機解析後的全域模型設定；切換角色只影響新對話。 */
export interface ModelSettings {
  readonly providers: readonly ModelProviderConfig[];
  readonly roles: Readonly<Record<ModelRole, ModelSelection>>;
}

/** 憑證的傳遞形狀。 */
export type ProviderCredentialKind = "api-key" | "bearer" | "none";

/**
 * 已解析的供應商憑證；只在記憶體中傳遞。
 *
 * 轉接層不得寫入日誌、資料庫或任何檔案；日誌只記供應商名稱與成功失敗。
 */
export interface ProviderCredential {
  readonly provider: string;
  readonly kind: ProviderCredentialKind;
  readonly secret: string;
}

/** 由殼提供的憑證來源；實作在 macOS 殼與主機服務的介面後面。 */
export interface ProviderCredentialSource {
  resolve(ref: CredentialRef): Promise<ProviderCredential>;
}
