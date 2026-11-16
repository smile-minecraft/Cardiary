/**
 * System One 的解析：該用哪一種實作，還是不用。
 *
 * 目前只有小模型實作（`docs/design/m2-system-one-dealing.md` 第 3.2 節）：
 * - `system-one` 角色明確設為「無」（`selection === null`）→ 不用 System One，
 *   發牌改由檢索排名決定。
 * - 其餘（角色未設定或指到已宣告的模型）→ 以 `ModelInvoker` 方式呼叫解析出的
 *   模型，退回規則沿用模型設定的角色解析。
 * - 沒有模型服務或角色解析 → 回 `null`，發牌走檢索退路。
 *
 * Jev 尚未接上：金鑰只能由 macOS 客戶端寫入鑰匙圈，設定也沒有 Jev 的接入
 * 方式；接上之前一律走小模型。
 */

import { createModelInvoker, systemOneProfile, type SystemOneDealJudge } from "@cardiary/domain";
import type { ModelInvoker } from "@cardiary/module-api";

/** 模型服務（設定模組的 `ModelRuntime`）中 dealing 用得到的部分。 */
export interface SystemOneModels {
  /** 角色的解析結果；`selection === null` 代表這個角色不啟用。 */
  role?(role: "system-one"): { readonly selection: unknown | null } | undefined;
}

export type SystemOneSource =
  "configured" | "fallback-small" | "fallback-main" | "none" | "unavailable";

export interface SystemOneResolution {
  /** `null`＝不用 System One；發牌走檢索排名。 */
  readonly judge: SystemOneDealJudge | null;
  readonly source: SystemOneSource;
}

/** 解析這個程序此刻能不能用 System One；不丟錯。 */
export function resolveSystemOne(input: {
  readonly models: SystemOneModels | undefined;
  readonly invoker: ModelInvoker;
}): SystemOneResolution {
  const { models, invoker } = input;
  if (models === undefined || typeof models.role !== "function") {
    return { judge: null, source: "unavailable" };
  }
  const resolved = models.role("system-one");
  if (resolved === undefined) {
    return { judge: null, source: "unavailable" };
  }
  if (resolved.selection === null) {
    return { judge: null, source: "none" };
  }
  const profile = systemOneProfile("model");
  const judge: SystemOneDealJudge = {
    profile,
    invoker: createModelInvoker({
      timeoutMs: profile.timeoutMs,
      call: async ({ prompt, signal }) => {
        const result = await invoker.invoke(
          { role: "system-one", purpose: "system-one", prompt, maxOutputTokens: 32 },
          { signal },
        );
        return { text: result.text };
      },
    }),
  };
  const source = (resolved as { readonly source?: string }).source;
  if (source === "configured" || source === "fallback-small" || source === "fallback-main") {
    return { judge, source };
  }
  return { judge, source: "configured" };
}
