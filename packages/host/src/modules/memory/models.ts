/**
 * 把主机的 `ModelInvoker` 轉成領域層蒸餾要的兩個模型介面：
 * `MemoryDistiller`（提煉 JSON）與 `MemoryJudge`（重複／矛盾的是非題）。
 *
 * 提煉用 `small` 角色；是非判定也用 `small`。輸出解析器只信任模型回傳的
 * 文字，驗證交給領域層的 `validateDistillationOutput`，這裡不自行放寬格式。
 */

import type {
  DistillationSourceCard,
  ExtractedMemoryItem,
  MemoryDistiller,
  MemoryJudge,
} from "@cardiary/domain";
import type { ModelInvoker } from "@cardiary/module-api";

/** 從模型文字裡取出第一個 JSON 物件／陣列；找不到就原樣回傳讓驗證失敗。 */
export function extractJson(text: string): unknown {
  const firstObject = text.indexOf("{");
  const firstArray = text.indexOf("[");
  let start = -1;
  if (firstObject >= 0 && firstArray >= 0) {
    start = Math.min(firstObject, firstArray);
  } else if (firstObject >= 0) {
    start = firstObject;
  } else if (firstArray >= 0) {
    start = firstArray;
  }
  if (start < 0) return text;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  const end = text.lastIndexOf(close);
  const candidate = end > start ? text.slice(start, end + 1) : text.slice(start);
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return text;
  }
}

function distillPrompt(cards: readonly DistillationSourceCard[]): string {
  const lines = cards.map((card, index) => {
    const source = [card.title, card.summary ?? "", card.body].filter((part) => part.length > 0);
    return `### 卡片 ${index + 1}（id=${card.cardId}）\n${source.join("\n")}`;
  });
  return [
    "你是記憶蒸餾助理。從下面的卡片提取值得長期保留的事實、偏好與決定。",
    "只回傳 JSON：{ \"items\": [ { \"type\": \"fact\"|\"preference\"|\"decision\", \"text\": \"...\" } ] }。",
    "規則：一行一條；text 自含（脫離原卡也能讀懂）；沒有值得保留的內容時回 { \"items\": [] }。",
    "不要加任何說明文字或 markdown 包裹。",
    "",
    ...lines,
  ].join("\n");
}

function yesNoPrompt(question: string): string {
  return `${question}\n只回答「是」或「否」，不要加任何說明。`;
}

function isYes(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized.startsWith("是") || /\byes\b/.test(normalized);
}

export interface ModelAdapters {
  readonly distiller: MemoryDistiller;
  readonly judge: MemoryJudge;
}

/** 用主机模型服務建立提煉器與判定器。 */
export function createModelAdapters(models: ModelInvoker): ModelAdapters {
  const invoke = (purpose: string, prompt: string): Promise<string> =>
    models
      .invoke({ role: "small", purpose, prompt, maxOutputTokens: 2048 })
      .then((result) => result.text);

  return {
    distiller: {
      async distill(cards: readonly DistillationSourceCard[]): Promise<unknown> {
        const text = await invoke("記憶蒸餾提煉", distillPrompt(cards));
        return extractJson(text);
      },
    },
    judge: {
      async sameAs(candidate: string, item: string): Promise<boolean> {
        const text = await invoke(
          "記憶蒸餾重複判定",
          yesNoPrompt(
            `這兩條陳述是同一回事嗎？\n既有記憶：${candidate}\n新記憶：${item}`,
          ),
        );
        return isYes(text);
      },
      async contradicts(candidate: string, item: string): Promise<boolean> {
        const text = await invoke(
          "記憶蒸餾矛盾判定",
          yesNoPrompt(
            `這兩條陳述矛盾嗎？\n既有記憶：${candidate}\n新記憶：${item}`,
          ),
        );
        return isYes(text);
      },
    },
  };
}

/** 提煉可以用注入的函式直接回傳結構（測試或腳本化模型用）。 */
export function scriptedDistiller(
  fn: (cards: readonly DistillationSourceCard[]) => unknown,
): MemoryDistiller {
  return { distill: async (cards) => fn(cards) };
}

/** 判定可以用注入的函式直接回傳（測試用）。 */
export function scriptedJudge(
  fn: (candidate: string, item: string, question: "same" | "contradicts") => boolean,
): MemoryJudge {
  return {
    sameAs: async (candidate, item) => fn(candidate, item, "same"),
    contradicts: async (candidate, item) => fn(candidate, item, "contradicts"),
  };
}

/** 給產生記憶卡標題的小模型呼叫；回傳字串或 null。 */
export async function titleAndSummaryFromModel(
  models: ModelInvoker,
  item: ExtractedMemoryItem,
): Promise<{ title?: string; summary?: string }> {
  try {
    const text = await models.invoke({
      role: "small",
      purpose: "記憶蒸餾標題",
      prompt: [
        `為這條長期記憶產生一個標題（≤40字）與一句話摘要。`,
        `只回傳 JSON：{ "title": "...", "summary": "..." }。`,
        `記憶：${item.text}`,
      ].join("\n"),
      maxOutputTokens: 512,
    });
    const parsed = extractJson(text) as { title?: unknown; summary?: unknown } | null;
    if (parsed === null || typeof parsed !== "object") return {};
    return {
      ...(typeof parsed.title === "string" ? { title: parsed.title } : {}),
      ...(typeof parsed.summary === "string" ? { summary: parsed.summary } : {}),
    };
  } catch {
    // 標題失敗不讓整張卡失敗；領域層會用正文前段衍生標題。
    return {};
  }
}
