/**
 * 卡片文件版本的領域型別。
 *
 * 版本記錄的是「做出這份內文的補丁」，不是整份快照；只有錨點（建立、
 * 每日檢查點、還原）存完整內文。資料落在 state 區，由 storage 的
 * CardVersionsStore 讀寫；這裡只放跨層共用的形狀。
 */

import type { CardFrontmatter, PatchText } from "../cards/index.js";

/** 版本的角色。 */
export type CardVersionKind = "create" | "patch" | "checkpoint" | "restore" | "merge";

/**
 * 一個卡片版本。
 *
 * `revision` 與卡片的 `revision` 是同一個字彙（frontmatter＋內文正規化內容的
 * SHA-256），`bodyHash` 只驗證內文本身，重放時不需要 frontmatter。
 */
export interface CardVersion {
  readonly versionId: string;
  readonly cardId: string;
  readonly seq: number;
  readonly kind: CardVersionKind;
  readonly revision: string;
  readonly bodyHash: string;
  readonly baseRevision: string | null;
  readonly patchFormat: PatchText["format"];
  readonly patchText: string;
  readonly createdAt: string;
  readonly mergedCount: number;
  readonly mergedSeqRange: string | null;
}

/** 保留策略；`maxRecent` 為 0 表示不限。 */
export interface VersionRetention {
  readonly maxRecent: number;
  readonly keepDailyCheckpoint: boolean;
}

export const DEFAULT_VERSION_RETENTION: VersionRetention = {
  maxRecent: 50,
  keepDailyCheckpoint: true,
};

/** 新增一個版本的輸入；補丁文字與身份由呼叫端備妥。 */
export interface AppendVersionInput {
  readonly cardId: string;
  readonly kind: CardVersionKind;
  readonly revision: string;
  readonly bodyHash: string;
  readonly baseRevision: string | null;
  readonly patchFormat: PatchText["format"];
  readonly patchText: string;
}

/** 建立新版本的輸入：建立卡時的第一個錨點。 */
export interface CreateVersionInput {
  readonly cardId: string;
  readonly body: string;
  readonly revision: string;
}

/** 接受補丁的輸入。 */
export interface AcceptPatchInput {
  readonly frontmatter: CardFrontmatter;
  readonly body: string;
  /** 補丁提出時的 revision；必須等於目前重算出的 revision。 */
  readonly baseRevision: string;
  readonly patch: PatchText;
}

/** 接受補丁的結果，交給呼叫端寫回卡片檔並新增版本。 */
export interface AcceptPatchResult {
  readonly body: string;
  readonly revision: string;
  readonly bodyHash: string;
}

/** 還原的結果。 */
export interface RestoreResult {
  readonly version: CardVersion;
  readonly body: string;
}
