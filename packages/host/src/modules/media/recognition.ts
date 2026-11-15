import type { JSONObject } from "@cardiary/protocol";

/** 服務→殼的代理請求；逾時由呼叫端指定。 */
export interface BrokerRequester {
  requestBroker(
    route: string,
    payload: JSONObject,
    options?: { readonly timeoutMs?: number },
  ): Promise<JSONObject>;
}

/** 本機辨識的結果；`available:false` 是正常的退化，不是錯誤。 */
export type RecognitionResult =
  | {
      readonly available: true;
      readonly text: string;
      readonly locale?: string;
      readonly segments?: readonly RecognitionSegment[];
      readonly truncated?: boolean;
    }
  | { readonly available: false; readonly reason: string };

export interface RecognitionSegment {
  readonly text: string;
  readonly startMs?: number;
  readonly durationMs?: number;
}

export const OCR_TIMEOUT_MS = 65_000;
export const TRANSCRIBE_TIMEOUT_MS = 305_000;

/**
 * 殼端 OCR 與語音轉文字的客戶端。
 *
 * 沒有殼（獨立執行）時沒有 broker 服務，所有呼叫都回 `available:false`；
 * 呼叫端據此退回小模型描述或留空並標明，不讓匯入失敗。
 */
export class RecognitionClient {
  readonly #broker: () => BrokerRequester | undefined;

  constructor(broker: () => BrokerRequester | undefined) {
    this.#broker = broker;
  }

  async ocr(path: string, locales?: readonly string[]): Promise<RecognitionResult> {
    return this.#call(
      "broker.recognition.ocr",
      {
        path,
        ...(locales === undefined || locales.length === 0 ? {} : { locales: [...locales] }),
      },
      OCR_TIMEOUT_MS,
    );
  }

  async transcribe(path: string, locale?: string): Promise<RecognitionResult> {
    return this.#call(
      "broker.recognition.transcribe",
      { path, ...(locale === undefined ? {} : { locale }) },
      TRANSCRIBE_TIMEOUT_MS,
    );
  }

  async #call(route: string, payload: JSONObject, timeoutMs: number): Promise<RecognitionResult> {
    const broker = this.#broker();
    if (broker === undefined) {
      return { available: false, reason: "no_shell" };
    }
    let response: JSONObject;
    try {
      response = await broker.requestBroker(route, payload, { timeoutMs });
    } catch (error) {
      return {
        available: false,
        reason: error instanceof Error ? error.message : "broker_unavailable",
      };
    }
    if (response.available !== true) {
      return {
        available: false,
        reason:
          typeof response.reason === "string" && response.reason.length > 0
            ? response.reason
            : "unavailable",
      };
    }
    if (typeof response.text !== "string") {
      return { available: false, reason: "invalid_response" };
    }
    return {
      available: true,
      text: response.text,
      ...(typeof response.locale === "string" ? { locale: response.locale } : {}),
      ...(Array.isArray(response.segments) ? { segments: segmentsOf(response.segments) } : {}),
      ...(response.truncated === true ? { truncated: true } : {}),
    };
  }
}

function segmentsOf(value: readonly unknown[]): RecognitionSegment[] {
  const segments: RecognitionSegment[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.text !== "string") continue;
    segments.push({
      text: record.text,
      ...(typeof record.startMs === "number" ? { startMs: record.startMs } : {}),
      ...(typeof record.durationMs === "number" ? { durationMs: record.durationMs } : {}),
    });
  }
  return segments;
}
