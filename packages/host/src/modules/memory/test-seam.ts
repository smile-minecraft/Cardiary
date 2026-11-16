/**
 * 蒸餾契約測試的接縫；正式產品不會用到。
 *
 * 只有 `CARDIARY_TEST_FAULTS=1` 時生效，和主机其餘故障注入旗標同一道閘。
 * 目的是讓契約測試能對真的主機行程注入固定的小模型回應，並把指定的種子卡
 * 設成新鮮度歸零，不必連真模型或等 30 天衰減。兩者都用環境變數傳入（父行程
 * 的 `process.env` 會被 `spawnService` 帶進子行程）。
 *
 * 正本仍是卡片檔與狀態庫；這個接縫只改狀態庫的新鮮度欄位，不碰卡片內容。
 */

import type { ModelInvoker } from "@cardiary/module-api";
import type { Database } from "@cardiary/storage";

/** `purpose` → 固定回傳文字；值也可以是陣列，依呼叫順序取用，用完重複最後一個。 */
type ScriptMap = Readonly<Record<string, string | readonly string[]>>;

function env(): string | undefined {
  // 正式入口要求 CARDIARY_TEST_FAULTS=1 才接受故障旗標；接縫比照辦理。
  return process.env.CARDIARY_TEST_FAULTS === "1"
    ? process.env.CARDIARY_TEST_DISTILL_MODEL
    : undefined;
}

function defaults(purpose: string): string {
  if (purpose.includes("矛盾") || purpose.includes("重複")) return "否";
  return "";
}

/**
 * 從環境變數建立腳本化模型；沒有設定時回 `null`，記憶模組改用主机模型服務。
 */
export function scriptedDistillationModels(): ModelInvoker | null {
  const raw = env();
  if (raw === undefined || raw.trim() === "") return null;
  let script: ScriptMap;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    script = parsed as ScriptMap;
  } catch {
    return null;
  }
  const cursors = new Map<string, number>();
  return {
    async invoke(request) {
      const value = script[request.purpose];
      if (value === undefined) return { text: defaults(request.purpose) };
      if (typeof value === "string") return { text: value };
      if (value.length === 0) return { text: defaults(request.purpose) };
      const index = cursors.get(request.purpose) ?? 0;
      cursors.set(request.purpose, index + 1);
      return { text: value[Math.min(index, value.length - 1)] ?? "" };
    },
  };
}

/**
 * 把環境變數列出的卡設成新鮮度 0，讓蒸餾挑得到。
 *
 * 記憶模組在卡片模組之後啟用，此时卡片已掃進 `card_state`；只更新數值欄位，
 * 卡片檔一個字都不動。回傳實際歸零的張數。
 */
export function zeroFreshnessForTest(db: Database, now: () => Date): number {
  if (process.env.CARDIARY_TEST_FAULTS !== "1") return 0;
  const raw = process.env.CARDIARY_TEST_DISTILL_ZERO;
  if (raw === undefined || raw.trim() === "") return 0;
  const cardIds = raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (cardIds.length === 0) return 0;
  // 卡檔被掃進索引時不會建立 card_state（正本在卡片檔，狀態列是載入時才補）。
  // 接縫直接 upsert 一列歸零狀態，蒸餾才挑得到；卡片檔一個字都不動。
  const at = now().toISOString();
  for (const cardId of cardIds) {
    db.run(
      `INSERT INTO card_state (card_id, persona, freshness, freshness_at, lifecycle, updated_at)
       VALUES (?, 'default', 0, ?, 'live', ?)
       ON CONFLICT (card_id) DO UPDATE SET freshness = 0, updated_at = excluded.updated_at`,
      cardId,
      at,
      at,
    );
  }
  return cardIds.length;
}
