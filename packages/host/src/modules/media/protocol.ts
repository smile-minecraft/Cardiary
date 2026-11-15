import type { TextStandIn } from "@cardiary/domain";
import type { JsonValue } from "@cardiary/engine-adapter";
import type { ProtocolEventEmitter, ProtocolRequestContext } from "@cardiary/module-api";
import type { JSONObject, MediaImportResponsePayload, MediaTextStandIn } from "@cardiary/protocol";

import { ProtocolHandlerError } from "../contract.js";
import { MediaError } from "./errors.js";
import type { MediaService } from "./pipeline.js";

/**
 * `media.import` 的協定處理器。
 *
 * 大型內容只走 HTTP：客戶端先 `POST /v1/blobs`，再用回傳的 blobId 觸發
 * 匯入。匯入是同步的：主機等本機辨識與小模型描述結束才回應，所以沒有
 * 進度事件。同名（同一個 blobId）重送回同一張卡，`deduped` 標明這次
 * 是否接回既有卡片。
 */

export interface MediaProtocolOptions {
  readonly media: MediaService;
  readonly protocol: ProtocolEventEmitter;
}

export function registerMediaProtocol(options: MediaProtocolOptions): void {
  options.protocol.registerNamespace("media", async (request) => {
    switch (request.type) {
      case "media.import":
        return importMedia(options.media, request);
      default:
        throw new ProtocolHandlerError("not_found", `沒有這個多模態訊息：${request.type}`);
    }
  });
}

async function importMedia(
  media: MediaService,
  request: ProtocolRequestContext,
): Promise<JsonValue> {
  const payload = objectOf(request.payload);
  const blobId = requiredString(payload, "blobId");
  const title = optionalString(payload, "title");
  const tags = optionalStringArray(payload, "tags");
  const persona = optionalString(payload, "persona");
  const locale = optionalString(payload, "locale");
  const ocrLocales = optionalStringArray(payload, "ocrLocales");
  try {
    const result = await media.import({
      blobId,
      ...(title === undefined ? {} : { title }),
      ...(tags === undefined ? {} : { tags }),
      ...(persona === undefined ? {} : { persona }),
      ...(locale === undefined ? {} : { locale }),
      ...(ocrLocales === undefined ? {} : { ocrLocales }),
    });
    const response: MediaImportResponsePayload = {
      cardId: result.card.cardId,
      kind: result.kind,
      textStandIn: wireStandIn(result.standIn),
      deduped: result.deduped,
    };
    return response as unknown as JsonValue;
  } catch (error) {
    throw asProtocolError(error);
  }
}

function wireStandIn(standIn: TextStandIn): MediaTextStandIn {
  return {
    sources: {
      ocr: standIn.sources.ocr,
      description: standIn.sources.description,
      transcript: standIn.sources.transcript,
      summary: standIn.sources.summary,
    },
    missingParts: [...standIn.missing],
  };
}

/** 模組的錯誤碼照協定信封帶出去；未知例外一律 internal，細節不外洩。 */
function asProtocolError(error: unknown): ProtocolHandlerError {
  if (error instanceof MediaError) {
    return new ProtocolHandlerError(error.code, error.message, asDetails(error.details));
  }
  return new ProtocolHandlerError("internal", "多模態匯入失敗。");
}

function asDetails(details: Readonly<Record<string, unknown>> | undefined): JSONObject | undefined {
  return details === undefined ? undefined : (details as unknown as JSONObject);
}

function objectOf(payload: JsonValue): Record<string, JsonValue> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new ProtocolHandlerError("invalid_message", "payload 必須是物件。", {
      field: "payload",
    });
  }
  return payload as Record<string, JsonValue>;
}

function requiredString(payload: Record<string, JsonValue>, field: string): string {
  const value = payload[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ProtocolHandlerError("invalid_message", `缺少 ${field}。`, { field });
  }
  return value;
}

function optionalString(payload: Record<string, JsonValue>, field: string): string | undefined {
  const value = payload[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ProtocolHandlerError("invalid_message", `${field} 必須是字串。`, { field });
  }
  return value;
}

function optionalStringArray(
  payload: Record<string, JsonValue>,
  field: string,
): string[] | undefined {
  const value = payload[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new ProtocolHandlerError("invalid_message", `${field} 必須是字串陣列。`, { field });
  }
  return value as string[];
}
