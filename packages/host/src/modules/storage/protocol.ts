import type { ProtocolRequestContext, ProtocolEventEmitter } from "@cardiary/module-api";
import type { JSONObject, JSONValue } from "@cardiary/protocol";
import { StorageError, type StorageCleanup } from "@cardiary/storage";

import { ProtocolHandlerError } from "../contract.js";

export interface StorageProtocolOptions {
  readonly cleanup: StorageCleanup;
  readonly protocol: ProtocolEventEmitter;
  /** 殼狀態用量由殼的私有控制面取得；沒有殼時省略，面板仍收到 0。 */
  readonly shellState?: () => Promise<{
    readonly usedBytes: number;
    readonly limitBytes: number;
  }>;
}

/** `storage.*`：用量、清理預覽與執行。 */
export function registerStorageProtocol(options: StorageProtocolOptions): void {
  options.protocol.registerNamespace("storage", async (request) => {
    switch (request.type) {
      case "storage.usage":
        return { usage: await usage(options) } as unknown as JSONValue;
      case "storage.cleanup.preview":
        return preview(request, options.cleanup) as unknown as JSONValue;
      case "storage.cleanup.apply":
        return apply(request, options.cleanup) as unknown as JSONValue;
      default:
        throw new ProtocolHandlerError("not_found", `主機不支援 ${request.type}。`);
    }
  });
}

/**
 * 資料夾用量加上殼狀態。
 *
 * 殼狀態只由殼經 `broker.shell-state.get` 回報，主機不自己量；沒有殼或殼沒有
 * 回應時回 0，面板仍然拿得到完整的類別清單。殼狀態只有殼能清，可清理量固定 0。
 */
async function usage(options: StorageProtocolOptions): Promise<JSONValue> {
  const usage = options.cleanup.usage();
  let shellState = 0;
  if (options.shellState !== undefined) {
    try {
      shellState = (await options.shellState()).usedBytes;
    } catch {
      shellState = 0;
    }
  }
  return [
    ...usage,
    { category: "shellState", bytes: shellState, cleanableBytes: 0 },
  ] as unknown as JSONValue;
}

function preview(request: ProtocolRequestContext, cleanup: StorageCleanup): JSONValue {
  try {
    return cleanup.preview(categoriesOf(request.payload)) as unknown as JSONValue;
  } catch (error) {
    throw asProtocolError(error);
  }
}

function apply(request: ProtocolRequestContext, cleanup: StorageCleanup): JSONValue {
  try {
    return cleanup.apply(categoriesOf(request.payload)) as unknown as JSONValue;
  } catch (error) {
    throw asProtocolError(error);
  }
}

function categoriesOf(payload: unknown): string[] {
  const object = requireObject(payload);
  const categories = object.categories;
  if (!Array.isArray(categories)) {
    throw new ProtocolHandlerError("invalid_message", "categories 必須是非空陣列。", {
      field: "categories",
    });
  }
  return categories as string[];
}

function requireObject(value: unknown): JSONObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProtocolHandlerError("invalid_message", "payload 必須是物件。", {
      field: "payload",
    });
  }
  return value as JSONObject;
}

function asProtocolError(error: unknown): unknown {
  if (error instanceof StorageError) {
    return new ProtocolHandlerError(
      error.code === "invalid-input" ? "invalid_message" : "internal",
      error.message,
    );
  }
  return error;
}
