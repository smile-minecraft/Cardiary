/**
 * 內建排程宣告的物化與同步。
 *
 * 模組用 `registerSchedule` 宣告排程，排程本身仍由 `schedules` 表持有：
 * 使用者改過的時間與啟停是這裡的正本，重啟後不能被宣告覆蓋回去。所以
 * 同步只補上宣告有、排程表沒有的部分，並用 `builtin_declaration` 保存
 * 上一次的宣告正本，才分得出哪些欄位是使用者動過的。
 *
 * 宣告消失時只停用（`builtin_orphaned = 1`），不刪列：`schedule_runs` 的
 * 外鍵會跟著列一起刪，執行歷程不能因為模組被停用就消失。
 */

import {
  computeFirstRun,
  parseScheduleKind,
  parseScheduleSpec,
  parseScheduleTask,
  specToJson,
  taskToJson,
  type ScheduleSpec,
} from "@cardiary/domain";

import type { Database, Queryable } from "../db.js";
import { nowIso } from "../util.js";

/** 模組宣告的觸發方式；cron 目前只物化每日一次的運算式。 */
export type BuiltinScheduleTrigger =
  | { readonly kind: "cron"; readonly expression: string; readonly timezone?: string }
  | { readonly kind: "interval"; readonly everyMs: number }
  | { readonly kind: "heartbeat"; readonly everyMs: number; readonly idleOnly?: boolean };

/** 內建排程執行時交給排程器的工作種類；省略時視為每日蒸餾。 */
export type BuiltinScheduleTask =
  { readonly type: "distillation" } | { readonly type: "agent"; readonly prompt: string };

/** 一個模組提供的內建排程宣告。 */
export interface BuiltinScheduleDeclaration {
  readonly scheduleId: string;
  readonly title: string;
  readonly trigger: BuiltinScheduleTrigger;
  readonly defaultEnabled: boolean;
  readonly requiresApproval?: boolean;
  readonly task?: BuiltinScheduleTask;
}

export interface BuiltinSyncIgnored {
  readonly scheduleId: string;
  readonly reason: string;
}

/** 一次同步做了哪些事；測試與日誌都靠它說明結果。 */
export interface BuiltinSyncResult {
  readonly created: readonly string[];
  readonly updated: readonly string[];
  readonly disabled: readonly string[];
  readonly reenabled: readonly string[];
  readonly ignored: readonly BuiltinSyncIgnored[];
}

export interface BuiltinSyncOptions {
  readonly now?: () => Date;
  /** 宣告無法物化時的通知；不丟例外，啟動不能因為一份壞宣告而失敗。 */
  readonly warn?: (message: string, fields?: { readonly scheduleId?: string }) => void;
}

interface NormalizedDeclaration {
  readonly scheduleId: string;
  readonly title: string;
  readonly trigger: BuiltinScheduleTrigger;
  readonly defaultEnabled: boolean;
  readonly requiresApproval: boolean;
  readonly task: BuiltinScheduleTask;
  readonly spec: ScheduleSpec;
  readonly specJson: string;
  readonly taskJson: string;
  /** 寫進 `builtin_declaration` 的正本；欄位順序固定才能直接比字串。 */
  readonly canonical: string;
}

interface BuiltinRow {
  readonly schedule_id: string;
  readonly persona: string;
  readonly name: string;
  readonly kind: string;
  readonly spec_json: string;
  readonly task_json: string;
  readonly enabled: number;
  readonly created_by: string;
  readonly next_run_at: string;
  readonly run_count: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly builtin_declaration: string | null;
  readonly builtin_orphaned: number;
}

const CRON_DAILY = /^(\d{1,2}) (\d{1,2}) \* \* \*$/;

function pad2(value: string): string {
  return value.padStart(2, "0");
}

function canonicalDeclaration(declaration: {
  readonly scheduleId: string;
  readonly title: string;
  readonly trigger: BuiltinScheduleTrigger;
  readonly defaultEnabled: boolean;
  readonly requiresApproval: boolean;
  readonly task: BuiltinScheduleTask;
}): string {
  return JSON.stringify({
    scheduleId: declaration.scheduleId,
    title: declaration.title,
    trigger: declaration.trigger,
    defaultEnabled: declaration.defaultEnabled,
    requiresApproval: declaration.requiresApproval,
    task: declaration.task,
  });
}

/** 把宣告的觸發方式轉成排程表支援的規格；不支援時回傳原因。 */
function materializeTrigger(
  trigger: BuiltinScheduleTrigger,
): { readonly spec: ScheduleSpec; readonly specJson: string } | { readonly reason: string } {
  if (trigger.kind === "cron") {
    if (trigger.timezone !== undefined && trigger.timezone !== "local") {
      return {
        reason: `cron 只支援本機時區（timezone: "local"），收到「${trigger.timezone}」；未建立排程。`,
      };
    }
    const match = CRON_DAILY.exec(trigger.expression.trim());
    if (match === null) {
      return {
        reason: `cron 運算式「${trigger.expression}」不支援，只支援每日一次的「mm HH * * *」；未建立排程。`,
      };
    }
    const minutes = Number(match[1]);
    const hours = Number(match[2]);
    if (minutes > 59 || hours > 23) {
      return { reason: `cron 運算式「${trigger.expression}」的分或時超出範圍；未建立排程。` };
    }
    const raw = { time: `${pad2(match[2] ?? "")}:${pad2(match[1] ?? "")}` };
    try {
      const spec = parseScheduleSpec("daily", raw);
      return { spec, specJson: specToJson(spec) };
    } catch (error) {
      return {
        reason: `cron 運算式「${trigger.expression}」無法轉成每日排程：${messageOf(error)}`,
      };
    }
  }
  const raw =
    trigger.kind === "interval"
      ? { everyMs: trigger.everyMs }
      : { everyMs: trigger.everyMs, idleOnly: trigger.idleOnly ?? false };
  try {
    const spec = parseScheduleSpec(trigger.kind, raw);
    return { spec, specJson: specToJson(spec) };
  } catch (error) {
    return { reason: `排程觸發方式無法物化：${messageOf(error)}` };
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalize(
  declaration: BuiltinScheduleDeclaration,
): NormalizedDeclaration | { readonly reason: string } {
  const materialized = materializeTrigger(declaration.trigger);
  if ("reason" in materialized) {
    return materialized;
  }
  const task = declaration.task ?? { type: "distillation" };
  try {
    parseScheduleTask(task);
  } catch (error) {
    return { reason: `排程任務無法物化：${messageOf(error)}` };
  }
  const requiresApproval = declaration.requiresApproval === true;
  return {
    scheduleId: declaration.scheduleId,
    title: declaration.title,
    trigger: declaration.trigger,
    defaultEnabled: declaration.defaultEnabled,
    requiresApproval,
    task,
    spec: materialized.spec,
    specJson: materialized.specJson,
    taskJson: taskToJson(task),
    canonical: canonicalDeclaration({
      scheduleId: declaration.scheduleId,
      title: declaration.title,
      trigger: declaration.trigger,
      defaultEnabled: declaration.defaultEnabled,
      requiresApproval,
      task,
    }),
  };
}

/** 讀回舊正本；壞掉時回傳 null，呼叫端改成以宣告為準。 */
function parseStored(canonical: string): NormalizedDeclaration | null {
  try {
    const parsed = JSON.parse(canonical) as BuiltinScheduleDeclaration & {
      readonly requiresApproval?: boolean;
    };
    const normalized = normalize(parsed);
    return "reason" in normalized ? null : normalized;
  } catch {
    return null;
  }
}

/**
 * 把一組模組宣告同步到排程表。
 *
 * 以 `scheduleId` 對齊；已存在的內建列只有在宣告變更時才逐欄更新，
 * 使用者改過的欄位保留。呼叫端負責提供 `now`，讓測試能用受控時鐘。
 */
export function syncBuiltinDeclarations(
  db: Database,
  declarations: readonly BuiltinScheduleDeclaration[],
  options: BuiltinSyncOptions = {},
): BuiltinSyncResult {
  const now = nowIso(options.now ?? (() => new Date()));
  const warn = options.warn ?? (() => undefined);

  const prepared: NormalizedDeclaration[] = [];
  const ignored: BuiltinSyncIgnored[] = [];
  const seen = new Set<string>();
  for (const declaration of declarations) {
    if (seen.has(declaration.scheduleId)) {
      warn(`排程 ${declaration.scheduleId} 被多個模組宣告，採用先出現的一份。`, {
        scheduleId: declaration.scheduleId,
      });
      ignored.push({
        scheduleId: declaration.scheduleId,
        reason: "重複的排程識別碼，採用先出現的宣告。",
      });
      continue;
    }
    seen.add(declaration.scheduleId);
    const normalized = normalize(declaration);
    if ("reason" in normalized) {
      warn(`排程 ${declaration.scheduleId} 沒有建立：${normalized.reason}`, {
        scheduleId: declaration.scheduleId,
      });
      ignored.push({ scheduleId: declaration.scheduleId, reason: normalized.reason });
      continue;
    }
    prepared.push(normalized);
  }

  const created: string[] = [];
  const updated: string[] = [];
  const disabled: string[] = [];
  const reenabled: string[] = [];

  db.transaction((tx) => {
    const rows = tx.all<BuiltinRow>(
      "SELECT * FROM schedules WHERE builtin_declaration IS NOT NULL",
    );
    const builtinById = new Map(rows.map((row) => [row.schedule_id, row]));

    for (const declaration of prepared) {
      const row = builtinById.get(declaration.scheduleId) ?? lookupRow(tx, declaration.scheduleId);
      if (row === undefined) {
        insertBuiltin(tx, declaration, now);
        created.push(declaration.scheduleId);
        continue;
      }
      if (row.builtin_declaration === null) {
        // 同識別碼的人工列：認養它，但不動使用者選的時間、任務與啟停。
        tx.run(
          `UPDATE schedules
              SET builtin_declaration = ?, builtin_orphaned = 0, updated_at = ?
            WHERE schedule_id = ?`,
          declaration.canonical,
          now,
          declaration.scheduleId,
        );
        updated.push(declaration.scheduleId);
        continue;
      }
      if (row.builtin_declaration === declaration.canonical) {
        if (row.builtin_orphaned === 1) {
          reenable(tx, row, declaration, now);
          reenabled.push(declaration.scheduleId);
        }
        continue;
      }
      applyDeclaration(tx, row, declaration, now);
      updated.push(declaration.scheduleId);
    }

    for (const row of rows) {
      if (seen.has(row.schedule_id) || row.enabled === 0) {
        continue;
      }
      tx.run(
        `UPDATE schedules
            SET enabled = 0, builtin_orphaned = 1, updated_at = ?
          WHERE schedule_id = ?`,
        now,
        row.schedule_id,
      );
      disabled.push(row.schedule_id);
    }
  });

  return { created, updated, disabled, reenabled, ignored };
}

function lookupRow(tx: Queryable, scheduleId: string): BuiltinRow | undefined {
  return tx.get<BuiltinRow>("SELECT * FROM schedules WHERE schedule_id = ?", scheduleId);
}

function insertBuiltin(tx: Queryable, declaration: NormalizedDeclaration, now: string): void {
  const enabled = declaration.defaultEnabled && !declaration.requiresApproval;
  tx.run(
    `INSERT INTO schedules (
       schedule_id, persona, name, kind, spec_json, task_json, enabled, created_by,
       next_run_at, run_count, created_at, updated_at, builtin_declaration, builtin_orphaned
     ) VALUES (?, 'default', ?, ?, ?, ?, ?, 'agent', ?, 0, ?, ?, ?, 0)`,
    declaration.scheduleId,
    declaration.title,
    declaration.spec.kind,
    declaration.specJson,
    declaration.taskJson,
    enabled ? 1 : 0,
    computeFirstRun(declaration.spec, now),
    now,
    now,
    declaration.canonical,
  );
}

/**
 * 宣告回來了：把列重新啟用並重算下次執行時間。
 *
 * 規格以列上的內容為準，因為使用者可能改過時間；但那一列如果壞到解析
 * 不了（例如手動改過資料庫），就退回宣告的正本並一併修好它。啟動不能
 * 因為一份損壞的資料而失敗。
 */
function reenable(
  tx: Queryable,
  row: BuiltinRow,
  declaration: NormalizedDeclaration,
  now: string,
): void {
  const stored = storedSpec(row, declaration);
  tx.run(
    `UPDATE schedules
        SET kind = ?, spec_json = ?, enabled = 1, builtin_orphaned = 0,
            next_run_at = ?, updated_at = ?
      WHERE schedule_id = ?`,
    stored.kind,
    stored.specJson,
    computeFirstRun(stored.spec, now),
    now,
    row.schedule_id,
  );
}

interface StoredSpec {
  readonly kind: ScheduleSpec["kind"];
  readonly spec: ScheduleSpec;
  readonly specJson: string;
}

/** 讀回列上的規格；解析失敗時退回宣告正本。 */
function storedSpec(row: BuiltinRow, declaration: NormalizedDeclaration): StoredSpec {
  try {
    const kind = parseScheduleKind(row.kind);
    return {
      kind,
      spec: parseScheduleSpec(kind, JSON.parse(row.spec_json)),
      specJson: row.spec_json,
    };
  } catch {
    return {
      kind: declaration.spec.kind,
      spec: declaration.spec,
      specJson: declaration.specJson,
    };
  }
}

function applyDeclaration(
  tx: Queryable,
  row: BuiltinRow,
  declaration: NormalizedDeclaration,
  now: string,
): void {
  const previous = row.builtin_declaration === null ? null : parseStored(row.builtin_declaration);
  const nameOverridden = previous !== null && row.name !== previous.title;
  const specOverridden = previous !== null && row.spec_json !== previous.specJson;
  const taskOverridden = previous !== null && row.task_json !== previous.taskJson;

  const name = nameOverridden ? row.name : declaration.title;
  const specJson = specOverridden ? row.spec_json : declaration.specJson;
  const kind = specOverridden ? row.kind : declaration.spec.kind;
  const taskJson = taskOverridden ? row.task_json : declaration.taskJson;

  let nextRunAt = row.next_run_at;
  if (!specOverridden) {
    // 沒有被使用者改過，就照新宣告重算下一次執行；今天已經過的時段不補跑，
    // 和「先同步、再執行」的規則一致（見 host 的內建排程組裝測試）。
    nextRunAt = computeFirstRun(declaration.spec, now);
  }
  const enabled = row.builtin_orphaned === 1 ? 1 : row.enabled;

  tx.run(
    `UPDATE schedules
        SET name = ?, kind = ?, spec_json = ?, task_json = ?, enabled = ?,
            next_run_at = ?, builtin_declaration = ?, builtin_orphaned = 0, updated_at = ?
      WHERE schedule_id = ?`,
    name,
    kind,
    specJson,
    taskJson,
    enabled,
    nextRunAt,
    declaration.canonical,
    now,
    row.schedule_id,
  );
}
