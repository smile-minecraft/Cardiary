/**
 * 版本歷史的純邏輯：重放還原與保留策略。
 *
 * 不碰資料庫，只吃一個卡片的版本陣列（照 seq 升序）。storage 的
 * CardVersionsStore 在交易內讀出陣列、呼叫這裡、再照結果寫回。
 */

import { applyPatch } from "../cards/index.js";
import { sha256Hex } from "../cards/index.js";
import type { CardVersion, VersionRetention } from "./types.js";

/** 版本資料損毀：重放結果與記錄的內文雜湊不符。 */
export class CorruptVersionHistoryError extends Error {
  readonly code = "corrupt_version_history" as const;

  constructor(
    readonly cardId: string,
    readonly versionId: string,
  ) {
    super(`版本 ${versionId}（卡片 ${cardId}）重放後的內文雜湊不符`);
    this.name = "CorruptVersionHistoryError";
  }
}

/**
 * 重放到指定版本，回傳該版的內文。
 *
 * 找 seq ≤ 目標的最大錨點（`patchFormat='replace'`），從它的完整內文開始，
 * 依序套其後的 unified diff；最後用 `bodyHash` 驗證，避免回傳錯的內文。
 */
export function reconstructBody(
  cardId: string,
  versions: readonly CardVersion[],
  targetVersionId: string,
): string {
  const ordered = [...versions].sort((left, right) => left.seq - right.seq);
  const targetIndex = ordered.findIndex((version) => version.versionId === targetVersionId);
  if (targetIndex < 0) {
    throw new Error(`找不到版本 ${targetVersionId}（卡片 ${cardId}）`);
  }
  let anchorIndex = targetIndex;
  while (anchorIndex >= 0 && ordered[anchorIndex]?.patchFormat !== "replace") {
    anchorIndex -= 1;
  }
  if (anchorIndex < 0) {
    throw new CorruptVersionHistoryError(cardId, targetVersionId);
  }
  const anchor = ordered[anchorIndex];
  if (anchor === undefined) {
    throw new CorruptVersionHistoryError(cardId, targetVersionId);
  }
  let body = anchor.patchText;
  for (let index = anchorIndex + 1; index <= targetIndex; index += 1) {
    const version = ordered[index];
    if (version === undefined) {
      throw new CorruptVersionHistoryError(cardId, targetVersionId);
    }
    body = applyPatch(body, { format: version.patchFormat, text: version.patchText });
  }
  const target = ordered[targetIndex];
  if (target === undefined || sha256Hex(body) !== target.bodyHash) {
    throw new CorruptVersionHistoryError(cardId, targetVersionId);
  }
  return body;
}

/** 一段被合併掉的連續版本的追溯資訊。 */
export interface MergeRecord {
  readonly count: number;
  readonly range: string;
}

export interface RetentionPlan {
  /** 要保留的 versionId。 */
  readonly keep: ReadonlySet<string>;
  /** 要從哪個保留版本上記下被合併的範圍。 */
  readonly merges: ReadonlyMap<string, MergeRecord>;
}

/**
 * 算出保留與合併計畫。
 *
 * 一定留 seq 1 與所有 `replace` 錨點（建立、每日檢查點、還原、合併）——
 * 它們是重放的起點，刪掉就會讓後面的補丁無法還原；再留最近 `maxRecent` 版。
 * `maxRecent` 為 0 表示不限，全部保留。其餘刪除。每段被刪的連續版本，把數量
 * 與 seq 範圍記在後面第一個保留版本上。
 *
 * `keepDailyCheckpoint` 只控制 appendPatch 要不要「產生」每日檢查點，
 * 不影響既存錨點的保留；所以這裡不看它。
 */
export function planRetention(
  versions: readonly CardVersion[],
  retention: VersionRetention,
): RetentionPlan {
  const ordered = [...versions].sort((left, right) => left.seq - right.seq);
  if (ordered.length === 0) {
    return { keep: new Set(), merges: new Map() };
  }

  if (retention.maxRecent === 0) {
    return { keep: new Set(ordered.map((version) => version.versionId)), merges: new Map() };
  }

  const keep = new Set<string>();
  for (const version of ordered) {
    if (version.seq === 1 || version.kind === "create") {
      keep.add(version.versionId);
      continue;
    }
    if (version.patchFormat === "replace") {
      keep.add(version.versionId);
    }
  }
  if (retention.maxRecent > 0) {
    for (const version of ordered.slice(-retention.maxRecent)) {
      keep.add(version.versionId);
    }
  }

  const merges = new Map<string, MergeRecord>();
  let run: CardVersion[] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    const successor = ordered.find(
      (version) => keep.has(version.versionId) && version.seq > (run.at(-1)?.seq ?? 0),
    );
    if (successor !== undefined) {
      const previous = merges.get(successor.versionId);
      const range = `${run[0]?.seq ?? 0}-${run.at(-1)?.seq ?? 0}`;
      merges.set(successor.versionId, {
        count: (previous?.count ?? 0) + run.length,
        range: previous === undefined ? range : `${previous.range},${range}`,
      });
    }
    run = [];
  };
  for (const version of ordered) {
    if (keep.has(version.versionId)) {
      flush();
    } else {
      run.push(version);
    }
  }
  flush();
  return { keep, merges };
}

/** UTC 日期鍵（YYYY-MM-DD），用來判定是否需要新的每日檢查點。 */
export function utcDayKey(iso: string): string {
  return iso.slice(0, 10);
}
