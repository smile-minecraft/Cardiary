import type { JsonValue } from "@cardiary/engine-adapter";
import type { JSONObject } from "@cardiary/protocol";
import type { ProtocolEventEmitter, ProtocolRequestContext } from "@cardiary/module-api";

import { ProtocolHandlerError } from "../contract.js";
import { ImportError } from "./errors.js";
import type { ImportService, PreviewInput } from "./service.js";
import {
  IMPORT_CATEGORIES,
  IMPORT_SOURCE_KINDS,
  type ImportCategory,
  type ImportSourceKind,
} from "./types.js";
import { wireListing, wirePreview, wireReport } from "./wire.js";

/**
 * `module.import.*` 的協定處理器。
 *
 * 請求與回應都照 `ModuleRequestPayload`／`ModuleResponsePayload` 包成
 * `{ data }`（`protocol.md` 第 6 節）；處理器只看 `data` 裡的欄位。
 * 預覽與寫入都用同一筆工作的識別碼串起來，沒有另外建立核心命名空間。
 */
export function registerImportProtocol(options: {
  readonly service: ImportService;
  readonly protocol: ProtocolEventEmitter;
}): void {
  options.protocol.registerNamespace("module.import", async (request) => {
    const data = await dispatch(options.service, request);
    return { data } as unknown as JsonValue;
  });
}

async function dispatch(
  service: ImportService,
  request: ProtocolRequestContext,
): Promise<JsonValue> {
  const payload = objectOf(requestPayload(request.payload));
  try {
    switch (request.type) {
      case "module.import.sources":
        return { sources: await service.sources() } as unknown as JsonValue;
      case "module.import.list": {
        const listing = await service.list({ path: requiredString(payload, "path") });
        return wireListing(listing);
      }
      case "module.import.preview":
        return wirePreview(await service.preview(previewInput(payload)));
      case "module.import.write": {
        const core = optionalStringArray(payload, "coreMemoryItemKeys");
        const reimport = optionalBoolean(payload, "reimport");
        const report = await service.write({
          jobId: requiredString(payload, "jobId"),
          itemKeys: requiredStringArray(payload, "itemKeys"),
          ...(core === undefined ? {} : { coreMemoryItemKeys: core }),
          ...(reimport === undefined ? {} : { reimport }),
        });
        return wireReport(report);
      }
      default:
        throw new ProtocolHandlerError("not_found", `沒有這個匯入訊息：${request.type}`);
    }
  } catch (error) {
    throw asProtocolError(error);
  }
}

function previewInput(payload: Record<string, JsonValue>): PreviewInput {
  const sourcePath = optionalString(payload, "sourcePath");
  const includeConversations = optionalBoolean(payload, "includeConversations");
  const rangeStart = optionalString(payload, "rangeStart");
  const rangeEnd = optionalString(payload, "rangeEnd");
  const defaultCategory = optionalDefaultCategory(payload);
  const categories = optionalCategories(payload);
  const providedPersona = optionalPersona(payload);
  return {
    sourceKind: sourceKindOf(payload),
    ...(sourcePath === undefined ? {} : { sourcePath }),
    ...(categories === undefined ? {} : { categories }),
    ...(defaultCategory === undefined ? {} : { defaultCategory }),
    ...(includeConversations === undefined ? {} : { includeConversations }),
    ...(rangeStart === undefined ? {} : { rangeStart }),
    ...(rangeEnd === undefined ? {} : { rangeEnd }),
    ...(providedPersona === undefined ? {} : { providedPersona }),
  };
}

function asProtocolError(error: unknown): ProtocolHandlerError {
  if (error instanceof ProtocolHandlerError) return error;
  if (error instanceof ImportError) {
    return new ProtocolHandlerError(
      error.code,
      error.message,
      error.details === undefined ? undefined : (error.details as unknown as JSONObject),
    );
  }
  return new ProtocolHandlerError("internal", "匯入失敗。");
}

function objectOf(payload: JsonValue): Record<string, JsonValue> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new ProtocolHandlerError("invalid_message", "payload 必須是物件。", { field: "payload" });
  }
  return payload as Record<string, JsonValue>;
}

/**
 * 取出 `ModuleRequestPayload` 的 `data`。
 *
 * `module.*` 的請求與回應都是 `{ data: … }`（`protocol.md` 第 6 節）；模組處理器
 * 只拿到 `data` 裡的欄位，不需要自己知道 envelope。
 */
function requestPayload(payload: JsonValue): JsonValue {
  const envelope = objectOf(payload);
  const data = envelope["data"];
  if (data === undefined) {
    throw new ProtocolHandlerError("invalid_message", "模組請求缺少 data 物件。", {
      field: "payload",
    });
  }
  return data;
}

function requiredString(payload: Record<string, JsonValue>, field: string): string {
  const value = payload[field];
  if (typeof value !== "string" || value.trim() === "") {
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

function optionalBoolean(payload: Record<string, JsonValue>, field: string): boolean | undefined {
  const value = payload[field];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new ProtocolHandlerError("invalid_message", `${field} 必須是布林值。`, { field });
  }
  return value;
}

function requiredStringArray(payload: Record<string, JsonValue>, field: string): string[] {
  const value = payload[field];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new ProtocolHandlerError("invalid_message", `${field} 必須是字串陣列。`, { field });
  }
  return value as string[];
}

function optionalStringArray(
  payload: Record<string, JsonValue>,
  field: string,
): string[] | undefined {
  if (payload[field] === undefined) return undefined;
  return requiredStringArray(payload, field);
}

function sourceKindOf(payload: Record<string, JsonValue>): ImportSourceKind {
  const value = requiredString(payload, "sourceKind");
  const kind = IMPORT_SOURCE_KINDS.find((entry) => entry === value);
  if (kind === undefined) {
    throw new ProtocolHandlerError("invalid_message", "不支援的匯入來源。", {
      field: "sourceKind",
    });
  }
  return kind;
}

function optionalCategories(
  payload: Record<string, JsonValue>,
): Record<string, ImportCategory> | undefined {
  const value = payload["categories"];
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProtocolHandlerError("invalid_message", "categories 必須是物件。", {
      field: "categories",
    });
  }
  const categories: Record<string, ImportCategory> = {};
  for (const [path, category] of Object.entries(value as Record<string, JsonValue>)) {
    if (
      typeof category !== "string" ||
      !(IMPORT_CATEGORIES as readonly string[]).includes(category)
    ) {
      throw new ProtocolHandlerError("invalid_message", "categories 有未知的類別。", {
        field: "categories",
      });
    }
    categories[path] = category as ImportCategory;
  }
  return categories;
}

function optionalDefaultCategory(
  payload: Record<string, JsonValue>,
): ImportCategory | "ignore" | undefined {
  const value = payload["defaultCategory"];
  if (value === undefined) return undefined;
  if (value === "ignore") return "ignore";
  if (typeof value !== "string" || !(IMPORT_CATEGORIES as readonly string[]).includes(value)) {
    throw new ProtocolHandlerError("invalid_message", "defaultCategory 不是合法的類別。", {
      field: "defaultCategory",
    });
  }
  return value as ImportCategory;
}

function optionalPersona(
  payload: Record<string, JsonValue>,
): { title: string; body: string } | undefined {
  const value = payload["providedPersona"];
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProtocolHandlerError("invalid_message", "providedPersona 必須是物件。", {
      field: "providedPersona",
    });
  }
  const record = value as Record<string, JsonValue>;
  const title = typeof record["title"] === "string" ? record["title"] : "人格";
  const body = record["body"];
  if (typeof body !== "string" || body.trim() === "") {
    throw new ProtocolHandlerError("invalid_message", "providedPersona.body 不能是空的。", {
      field: "providedPersona",
    });
  }
  return { title, body };
}
