import type { CardKind } from "@cardiary/domain";

/**
 * 匯入來源轉接器的共通中介格式（規格書第 16 章）。
 *
 * 不論來源種類，轉接器都只把資料歸成六類並填
 * `ImportItemDraft`／`ImportSkillDraft`／`ImportConversationCandidate`；
 * 寫成卡片、複製技能與摘要對話都在這一層之後，轉接器不知道卡片檔長什麼樣。
 *
 * 這裡的型別是主機內部格式；協定上的線路形狀由 `wire.ts` 轉一次。
 */

/** 內建的來源種類。 */
export const IMPORT_SOURCE_KINDS = [
  "generic",
  "hermes",
  "alma",
  "codex",
  "claude-code",
  "openclaw",
  "claude",
] as const;
export type ImportSourceKind = (typeof IMPORT_SOURCE_KINDS)[number];

/** 六類中介格式；對應 `import_items.category` 的檢查條件。 */
export const IMPORT_CATEGORIES = [
  "persona",
  "user",
  "memory",
  "rule",
  "skill",
  "conversation",
] as const;
export type ImportCategory = (typeof IMPORT_CATEGORIES)[number];

/** 介面的顯示順序：人格、使用者資料、記憶、操作規則、技能、對話。 */
export const IMPORT_CATEGORY_ORDER: readonly ImportCategory[] = IMPORT_CATEGORIES;

/**
 * 每一類的預設去處（規格書第 16 章的表）。
 *
 * 技能與對話不是一般卡片，沒有對應的 `CardKind`；呼叫端要先判斷類別，
 * 不要拿這張表去建立技能或對話卡。
 */
export const CATEGORY_CARD_KIND: Readonly<
  Record<Exclude<ImportCategory, "skill" | "conversation">, CardKind>
> = {
  persona: "persona",
  user: "memory",
  memory: "memory",
  rule: "note",
};

/**
 * 機密與登入檔的檔名（不分大小寫）；通用來源不開。
 *
 * 三道規則，缺一不可：
 *
 * 1. 隱藏檔前綴（檔名以 `.` 開頭，例如 `.env`）——直接不列出。
 * 2. 副檔名白名單（`.md`／`.markdown`／`.txt`／`.text`）——不在名單內的不列出。
 * 3. 這份檔名名單——名字像文件的機密檔（例如 `auth.md`）也不列出。
 *
 * 名單不是完整清單：它擋掉瀏覽器與 CLI 常見的登入檔；使用者自己的筆記
 * 可能也帶機密，所以自訂的檔案仍然要靠 1 和 2 或使用者的判斷。
 */
export const SECRET_FILE_NAMES: readonly string[] = [
  ".env",
  "auth.json",
  "auth.md",
  "credentials",
  "credentials.json",
  "config.json",
  "Cookies",
  "Local State",
  "Preferences",
  "TransportSecurity",
  "Trust Tokens",
  "Network Persistent State",
  "DIPS",
  "SharedStorage",
];

/** 一張將建立的卡片；`hash` 是去重用的內容雜湊。 */
export interface ImportItemDraft {
  /** 同一筆工作內穩定；寫入時用它找回這一項。 */
  readonly key: string;
  readonly category: ImportCategory;
  readonly title: string;
  /** 卡片內文；記憶與使用者資料是原文，不經蒸餾。 */
  readonly body: string;
  readonly summary?: string;
  readonly tags: readonly string[];
  /** 來源時間；沒有時用匯入時間，由寫入端決定。 */
  readonly createdAt?: string;
  /** 去重鍵：同一個內容重跑同一來源時相同。 */
  readonly contentHash: string;
  readonly source: ImportItemSource;
  /** 記憶的 `importance`；其他類別沒有。 */
  readonly importance?: number;
}

/** 資料從哪個工具、哪個檔案來；寫進卡片的 `importedFrom`。 */
export interface ImportItemSource {
  readonly tool: string;
  /** 來源位置；Alma 資料庫用檔名與錨點，例如 `chat_threads.db#memories/42`。 */
  readonly path: string;
}

/** 一個技能；M1 只複製 `SKILL.md`，附屬檔案留在來源。 */
export interface ImportSkillDraft {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  /** 卡片庫 `skills/` 底下的目錄名稱；衝突時寫入端會加後綴。 */
  readonly slug: string;
  readonly skillMarkdown: string;
  readonly contentHash: string;
  readonly source: ImportItemSource;
  /** 這個技能目錄裡沒有被複製的附屬檔案數量。 */
  readonly attachmentsNotCopied: number;
}

/**
 * 一段可以匯入的對話。
 *
 * `existingSummary` 有值時直接用來源工具的摘要（Alma 的
 * `thread_briefs.conclusions`），不呼叫模型；沒有值才由小模型摘要。
 */
export interface ImportConversationCandidate {
  readonly key: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly messageCount: number;
  readonly characterCount: number;
  readonly existingSummary?: string;
  /** 去重鍵：沿用 `conversationContentHash`。 */
  readonly contentHash: string;
  /**
   * 需要模型摘要時的逐字稿；只在主機記憶體裡，不進協定、不落地。
   * 有 `existingSummary` 時不會用到。
   */
  readonly transcript?: string;
  readonly source: ImportItemSource;
  /** 來源結構沒有在真實安裝上驗證過時標 true，介面要顯示「未驗證」。 */
  readonly unverified?: boolean;
}

/** 跳過的檔案或項目；`reason` 是給人看的代碼，介面負責翻譯。 */
export interface ImportSkipped {
  readonly path: string;
  readonly reason: ImportSkipReason;
  readonly detail?: string;
  /** 同一個原因合併計算時用；單一檔案省略。 */
  readonly count?: number;
}

export type ImportSkipReason =
  | "unsupported-format"
  | "unsupported-compression"
  | "decompress-failed"
  | "too-large"
  | "not-readable"
  | "category-not-assigned"
  | "empty-content"
  | "secret-file"
  | "symlink-outside-source"
  | "archived-memory"
  | "crystals-not-imported"
  | "skills-table-empty"
  | "conversations-not-selected"
  | "no-brief"
  | "unverified-schema"
  | "missing-at-write"
  | "read-failed";

/** 來源的一項觀察；不是卡片，也不含機密值。 */
export interface ImportSourceNote {
  readonly path: string;
  readonly detail: string;
  readonly count?: number;
}

/** 一次掃描的結果；預覽與寫入都從這裡開始。 */
export interface ImportScanResult {
  readonly tool: string;
  /** 來源版本；拿不到時省略。 */
  readonly version?: string;
  readonly items: readonly ImportItemDraft[];
  readonly skills: readonly ImportSkillDraft[];
  readonly conversations: readonly ImportConversationCandidate[];
  readonly skipped: readonly ImportSkipped[];
  readonly notes: readonly ImportSourceNote[];
  readonly warnings: readonly string[];
}

/** 掃描參數。 */
export interface ImportScanOptions {
  /** 來源根目錄；Alma 也接受資料庫或匯出檔的路徑。 */
  readonly path: string;
  /** 通用來源的逐檔類別；`file:` 開頭的項目鍵對應相對路徑。 */
  readonly categories?: Readonly<Record<string, ImportCategory>>;
  /** 沒有指定類別的檔案要當成什麼；`ignore` 代表列在跳過清單。 */
  readonly defaultCategory?: ImportCategory | "ignore";
  /** 是否讀取對話；預設 false（規格書第 16 章：對話預設不匯入）。 */
  readonly includeConversations?: boolean;
  /** 對話的時間範圍；`includeConversations` 為 true 時必填。 */
  readonly range?: ImportDateRange;
  /** 使用者貼上的人格文字（Alma 沒有人格來源時使用）。 */
  readonly providedPersona?: ProvidedPersona;
}

export interface ImportDateRange {
  /** RFC 3339；含當下。 */
  readonly start: string;
  readonly end: string;
}

export interface ProvidedPersona {
  readonly title: string;
  readonly body: string;
}

/**
 * 來源轉接器。
 *
 * `scan` 只能讀；不得寫入、改名或刪除來源的任何檔案。實作拿到的是注入的
 * 檔案系統與資料庫開啟函式，測試用記錄版驗證「哪些檔案真的被開過」。
 */
export interface ImportSourceAdapter {
  readonly kind: ImportSourceKind;
  scan(options: ImportScanOptions): Promise<ImportScanResult>;
}

/** 對話匯入的預估用量；開始前給使用者看。 */
export interface ImportConversationEstimate {
  readonly candidates: number;
  readonly messages: number;
  readonly characters: number;
  /** 來源工具已經有摘要、不需要模型的段數。 */
  readonly existingSummaries: number;
  /** 需要小模型摘要的段數。 */
  readonly modelSummaries: number;
  /** 依 `ceil(字元數 / 4)` 估算的輸入 token；只是量級，不是帳單。 */
  readonly estimatedModelInputTokens: number;
  readonly estimatedModelCalls: number;
  readonly rangeStart: string;
  readonly rangeEnd: string;
}

/** 預覽的一項；`duplicateCardId` 有值代表這次不會建立新卡。 */
export interface ImportPreviewItem extends ImportItemDraft {
  readonly duplicateCardId?: string;
}

export interface ImportPreviewSkill extends ImportSkillDraft {
  /** 已經有同名且內容相同的技能時，指到那個目錄。 */
  readonly existingSkillPath?: string;
}

/** `module.import.preview` 的回應內容。 */
export interface ImportPreview {
  readonly jobId: string;
  readonly source: {
    readonly kind: ImportSourceKind;
    readonly path: string;
    readonly tool: string;
    readonly version?: string;
  };
  readonly items: readonly ImportPreviewItem[];
  readonly skills: readonly ImportPreviewSkill[];
  readonly conversations: readonly ImportConversationCandidate[];
  readonly skipped: readonly ImportSkipped[];
  readonly notes: readonly ImportSourceNote[];
  readonly warnings: readonly string[];
  readonly conversationEstimate?: ImportConversationEstimate;
  /** 這次會建立幾張新卡；重複與技能不算。 */
  readonly newCards: number;
  readonly duplicates: number;
}

/** 寫入的一項結果。 */
export interface ImportWrittenItem {
  readonly key: string;
  readonly category: ImportCategory;
  readonly status: "written" | "skipped" | "failed";
  readonly cardId?: string;
  readonly skillPath?: string;
  readonly reason?: string;
  readonly duplicateCardId?: string;
}

/** `module.import.write` 的回應內容；也是 `import_jobs.report_json` 的內容。 */
export interface ImportWriteReport {
  readonly jobId: string;
  readonly status: "completed" | "failed";
  readonly cardsCreated: number;
  readonly skillsCopied: number;
  readonly duplicates: number;
  readonly failed: number;
  readonly skipped: readonly ImportSkipped[];
  readonly results: readonly ImportWrittenItem[];
  /** 使用者勾選為核心記憶候選的卡片；M2 才載入，M1 只記錄。 */
  readonly coreMemoryCandidates: readonly string[];
  readonly conversationEstimate?: ImportConversationEstimate;
  readonly warnings: readonly string[];
}

/** 來源偵測結果；`module.import.sources` 用。 */
export interface ImportSourceAvailability {
  readonly kind: ImportSourceKind;
  readonly name: string;
  readonly available: boolean;
  readonly path: string;
  readonly detail: string;
  /** 這個來源的哪些部分沒有在真實安裝上驗證過。 */
  readonly unverified?: string;
}
