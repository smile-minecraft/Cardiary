import type { ProtocolRequestContext, ProtocolEventEmitter } from "@cardiary/module-api";
import type { JSONObject, JSONValue } from "@cardiary/protocol";
import { StorageError, type StorageCleanup } from "@cardiary/storage";

import { ProtocolHandlerError } from "../contract.js";

export interface StorageProtocolOptions {
  readonly cleanup: StorageCleanup;
  readonly protocol: ProtocolEventEmitter;
}

/** `storage.*`：用量、清理預覽與執行。 */
export function registerStorageProtocol(options: StorageProtocolOptions): void {
  options.protocol.registerNamespace("storage", async (request) => {
    switch (request.type) {
      case "storage.usage":
        return { usage: options.cleanup.protocolUsage() } as unknown as JSONValue;
      case "storage.cleanup.preview":
        return preview(request, options.cleanup) as unknown as JSONValue;
      case "storage.cleanup.apply":
        return apply(request, options.cleanup) as unknown as JSONValue;
      default:
        throw new ProtocolHandlerError("not_found", `主機不支援 ${request.type}。`);
    }
  });
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
