/**
 * 卡片版本歷史的儲存。
 *
 * 資料表 `card_versions` 在 state 區（正本），由 v6 遷移建立。所有寫入都在
 * 同一筆 `BEGIN IMMEDIATE` 交易內完成；新增版本時順便做保留合併，中途強制
 * 結束不會留下半套狀態。
 */

import type {
  AppendVersionInput,
  CardVersion,
  PatchText,
  RestoreResult,
  VersionRetention,
} from "@cardiary/domain";
import {
  DEFAULT_VERSION_RETENTION,
  planRetention,
  reconstructBody,
  sha256Hex,
  utcDayKey,
} from "@cardiary/domain";

import type { Database, Queryable } from "../db.js";
import { newUlid } from "../ids.js";
import { nowIso } from "../util.js";

interface VersionRow {
  readonly version_id: string;
  readonly card_id: string;
  readonly seq: number;
  readonly kind: string;
  readonly revision: string;
  readonly body_hash: string;
  readonly base_revision: string | null;
  readonly patch_format: string;
  readonly patch_text: string;
  readonly created_at: string;
  readonly merged_count: number;
  readonly merged_seq_range: string | null;
}

export interface CardVersionsStoreOptions {
  readonly retention?: VersionRetention;
  readonly now?: () => Date;
}

export interface AppendPatchInput {
  readonly cardId: string;
  readonly baseRevision: string;
  readonly body: string;
  readonly revision: string;
  readonly bodyHash: string;
  readonly patch: PatchText;
}

function toVersion(row: VersionRow): CardVersion {
  return {
    versionId: row.version_id,
    cardId: row.card_id,
    seq: row.seq,
    kind: row.kind as CardVersion["kind"],
    revision: row.revision,
    bodyHash: row.body_hash,
    baseRevision: row.base_revision,
    patchFormat: row.patch_format as CardVersion["patchFormat"],
    patchText: row.patch_text,
    createdAt: row.created_at,
    mergedCount: row.merged_count,
    mergedSeqRange: row.merged_seq_range,
  };
}

/** 卡片版本歷史的讀寫；同步 API，與 schedules store 同一種風格。 */
export class CardVersionsStore {
  readonly #db: Database;
  readonly #retention: VersionRetention;
  readonly #now: () => Date;

  constructor(db: Database, options: CardVersionsStoreOptions = {}) {
    this.#db = db;
    this.#retention = options.retention ?? DEFAULT_VERSION_RETENTION;
    this.#now = options.now ?? (() => new Date());
  }

  /** 建立卡片時的第一個錨點。 */
  create(cardId: string, body: string, revision: string, bodyHash: string): CardVersion {
    return this.#db.transaction((tx) => {
      const existing = this.#list(tx, cardId);
      if (existing.length > 0) {
        throw new Error(`卡片 ${cardId} 已有版本歷史`);
      }
      return this.#insert(tx, {
        cardId,
        kind: "create",
        revision,
        bodyHash,
        baseRevision: null,
        patchFormat: "replace",
        patchText: body,
      });
    });
  }

  /**
   * 新增一筆補丁版本。
   *
   * 如果今天是新的一天，改寫成每日檢查點（`replace` 錨點）；其餘情況存
   * caller 提出的 unified diff。
   */
  appendPatch(input: AppendPatchInput): CardVersion {
    return this.#db.transaction((tx) => {
      const versions = this.#list(tx, input.cardId);
      const last = versions.at(-1);
      const isNewDay =
        last === undefined ||
        (this.#retention.keepDailyCheckpoint &&
          utcDayKey(last.createdAt) !== utcDayKey(nowIso(this.#now)));
      return this.#append(tx, {
        cardId: input.cardId,
        kind: isNewDay ? "checkpoint" : "patch",
        revision: input.revision,
        bodyHash: input.bodyHash,
        baseRevision: input.baseRevision,
        patchFormat: isNewDay ? "replace" : input.patch.format,
        patchText: isNewDay ? input.body : input.patch.text,
      });
    });
  }

  /** 以目前的正本建立可獨立重放的檢查點。 */
  checkpoint(cardId: string, body: string, revision: string): CardVersion {
    return this.#db.transaction((tx) => {
      const last = this.#list(tx, cardId).at(-1);
      return this.#append(tx, {
        cardId,
        kind: "checkpoint",
        revision,
        bodyHash: sha256Hex(body),
        baseRevision: last?.revision ?? null,
        patchFormat: "replace",
        patchText: body,
      });
    });
  }

  /** 還原：重放目標版內文，再寫一筆 `restore` 錨點。 */
  restore(
    cardId: string,
    targetVersionId: string,
    currentRevision: string | null = null,
    restoredRevision?: string,
  ): RestoreResult {
    return this.#db.transaction((tx) => {
      const versions = this.#list(tx, cardId);
      const target = versions.find((version) => version.versionId === targetVersionId);
      if (target === undefined) {
        throw new Error(`找不到版本 ${targetVersionId}（卡片 ${cardId}）`);
      }
      const body = reconstructBody(cardId, versions, targetVersionId);
      const version = this.#append(tx, {
        cardId,
        kind: "restore",
        revision: restoredRevision ?? target.revision,
        bodyHash: target.bodyHash,
        baseRevision: currentRevision,
        patchFormat: "replace",
        patchText: body,
      });
      return { version, body };
    });
  }

  list(cardId: string): readonly CardVersion[] {
    return this.#list(this.#db, cardId);
  }

  #list(db: Queryable, cardId: string): readonly CardVersion[] {
    return db
      .all<VersionRow>("SELECT * FROM card_versions WHERE card_id = ? ORDER BY seq ASC", cardId)
      .map(toVersion);
  }

  get(cardId: string, versionId: string): CardVersion | null {
    const row = this.#db.get<VersionRow>(
      "SELECT * FROM card_versions WHERE card_id = ? AND version_id = ?",
      cardId,
      versionId,
    );
    return row === undefined ? null : toVersion(row);
  }

  latest(cardId: string): CardVersion | null {
    const row = this.#db.get<VersionRow>(
      "SELECT * FROM card_versions WHERE card_id = ? ORDER BY seq DESC LIMIT 1",
      cardId,
    );
    return row === undefined ? null : toVersion(row);
  }

  /** 刪卡時呼叫；回傳刪掉的版本數。 */
  deleteCard(cardId: string): number {
    return this.#db.transaction((tx) => {
      return tx.run("DELETE FROM card_versions WHERE card_id = ?", cardId).changes;
    });
  }

  count(cardId: string): number {
    return (
      this.#db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM card_versions WHERE card_id = ?",
        cardId,
      )?.n ?? 0
    );
  }

  #append(tx: Queryable, input: AppendVersionInput): CardVersion {
    const version = this.#insert(tx, input);
    this.#prune(tx, input.cardId);
    return version;
  }

  #insert(tx: Queryable, input: AppendVersionInput): CardVersion {
    const row = tx.get<{ next: number }>(
      "SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM card_versions WHERE card_id = ?",
      input.cardId,
    );
    const seq = row?.next ?? 1;
    const createdAt = nowIso(this.#now);
    const versionId = `ver_${newUlid(Date.parse(createdAt) || Date.now())}`;
    tx.run(
      `INSERT INTO card_versions
        (version_id, card_id, seq, kind, revision, body_hash, base_revision,
         patch_format, patch_text, created_at, merged_count, merged_seq_range)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)`,
      versionId,
      input.cardId,
      seq,
      input.kind,
      input.revision,
      input.bodyHash,
      input.baseRevision,
      input.patchFormat,
      input.patchText,
      createdAt,
    );
    const stored = tx.get<VersionRow>(
      "SELECT * FROM card_versions WHERE version_id = ?",
      versionId,
    );
    if (stored === undefined) {
      throw new Error(`寫入版本 ${versionId} 後讀不回來`);
    }
    return toVersion(stored);
  }

  #prune(tx: Queryable, cardId: string): void {
    const versions = this.#list(tx, cardId);
    const plan = planRetention(versions, this.#retention);
    if (plan.merges.size === 0 && plan.keep.size === versions.length) return;

    // 先把每個有合併的後繼版改成完整內文錨點。必須在刪版本之前算，
    // 因為重放會用到即將被合併掉的補丁；改成 replace 後才不會依賴它們。
    for (const versionId of plan.merges.keys()) {
      const successor = versions.find((version) => version.versionId === versionId);
      if (successor === undefined || successor.patchFormat === "replace") continue;
      const body = reconstructBody(cardId, versions, versionId);
      tx.run(
        `UPDATE card_versions
            SET kind = 'merge', patch_format = 'replace', patch_text = ?, body_hash = ?
          WHERE version_id = ?`,
        body,
        sha256Hex(body),
        versionId,
      );
    }

    for (const version of versions) {
      if (plan.keep.has(version.versionId)) continue;
      tx.run("DELETE FROM card_versions WHERE version_id = ?", version.versionId);
    }
    for (const [versionId, record] of plan.merges) {
      tx.run(
        `UPDATE card_versions
            SET merged_count = merged_count + ?,
                merged_seq_range = CASE
                  WHEN merged_seq_range IS NULL THEN ?
                  ELSE merged_seq_range || ',' || ?
                END
          WHERE version_id = ?`,
        record.count,
        record.range,
        record.range,
        versionId,
      );
    }
  }
}
