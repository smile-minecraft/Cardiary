import { createReadStream } from "node:fs";

import type {
  ModuleHttpRequest,
  ModuleHttpResponse,
  ProtocolEventEmitter,
} from "@cardiary/module-api";
import type { JSONObject } from "@cardiary/protocol";

import { PROTOCOL_VERSION } from "../../version.js";
import { MediaError } from "./errors.js";
import type { MediaStore } from "./store.js";

interface BlobRoutesOptions {
  readonly store: MediaStore;
  readonly protocol: ProtocolEventEmitter;
}

/**
 * `/v1/blobs` 的 HTTP 路由。
 *
 * 只傳大型內容，不做狀態變更：上傳只寫原檔，下載回原檔或縮圖。認證由
 * 閘道在進入路由前完成，這裡不重複處理 Token。
 */
export function registerMediaHttpRoutes(options: BlobRoutesOptions): void {
  const { store, protocol } = options;
  protocol.registerHttpRoute({
    method: "POST",
    path: "/v1/blobs",
    handle: (request) => upload(request, store),
  });
  protocol.registerHttpRoute({
    method: "GET",
    path: "/v1/blobs/",
    handle: (request) => download(request, store),
  });
  protocol.registerHttpRoute({
    method: "HEAD",
    path: "/v1/blobs/",
    handle: (request) => download(request, store),
  });
}

async function upload(request: ModuleHttpRequest, store: MediaStore): Promise<ModuleHttpResponse> {
  const mediaType = request.headers["content-type"];
  if (mediaType === undefined || mediaType.trim().length === 0) {
    return failure(400, "invalid_message", "上傳必須帶 Content-Type。", {
      field: "content-type",
    });
  }
  const declaredLength = parseContentLength(request.headers["content-length"]);
  if (declaredLength === "invalid") {
    return failure(400, "invalid_message", "Content-Length 不是合法的整數。", {
      field: "content-length",
    });
  }
  try {
    const info = await store.put({
      bytes: request.body,
      mediaType,
      ...(declaredLength === undefined ? {} : { declaredLength }),
    });
    return json(201, info);
  } catch (error) {
    return errorResponse(error);
  }
}

async function download(
  request: ModuleHttpRequest,
  store: MediaStore,
): Promise<ModuleHttpResponse> {
  const blobId = blobIdOf(request.url.pathname);
  if (blobId === undefined) {
    return failure(404, "not_found", "找不到這個端點。");
  }
  const variant = request.url.searchParams.get("variant");
  if (variant !== null && variant !== "thumb") {
    return failure(400, "invalid_message", "不支援的 variant。", {
      field: "variant",
    });
  }
  const head = request.method === "HEAD";
  if (variant === "thumb") {
    return thumbnail(store, blobId, head, request.headers["if-none-match"]);
  }
  const info = store.info(blobId);
  if (info === undefined) {
    return failure(404, "not_found", "找不到原檔。", { blobId });
  }
  const etag = `"${info.blobId}"`;
  if (matchesEtag(request.headers["if-none-match"], etag)) {
    return {
      status: 304,
      headers: { etag, "cache-control": "private, max-age=86400, immutable" },
    };
  }
  const range = parseRange(request.headers["range"], info.sizeBytes);
  if (range === "invalid") {
    return {
      ...failure(416, "invalid_message", "Range 不合法。"),
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-range": `bytes */${info.sizeBytes}`,
      },
    };
  }
  const start = range === undefined ? 0 : range.start;
  const end = range === undefined ? info.sizeBytes - 1 : range.end;
  const headers: Record<string, string> = {
    "content-type": info.mediaType,
    "content-length": String(end - start + 1),
    etag,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=86400, immutable",
    ...(range === undefined ? {} : { "content-range": `bytes ${start}-${end}/${info.sizeBytes}` }),
  };
  if (head) {
    return { status: range === undefined ? 200 : 206, headers };
  }
  return {
    status: range === undefined ? 200 : 206,
    headers,
    body: createReadStream(info.path, { start, end }),
  };
}

async function thumbnail(
  store: MediaStore,
  blobId: string,
  head: boolean,
  ifNoneMatch: string | undefined,
): Promise<ModuleHttpResponse> {
  const info = store.info(blobId);
  if (info === undefined) {
    return failure(404, "not_found", "找不到原檔。", { blobId });
  }
  const etag = `"${info.blobId}-thumb"`;
  if (matchesEtag(ifNoneMatch, etag)) {
    return { status: 304, headers: { etag } };
  }
  try {
    const thumbnail = await store.thumbnail(blobId);
    const headers = {
      "content-type": "image/jpeg",
      "content-length": String(thumbnail.bytes.byteLength),
      etag,
      "cache-control": "private, max-age=86400, immutable",
    };
    if (head) return { status: 200, headers };
    return { status: 200, headers, body: thumbnail.bytes };
  } catch (error) {
    return errorResponse(error);
  }
}

function blobIdOf(pathname: string): string | undefined {
  const match = /^\/v1\/blobs\/([^/]+)$/.exec(pathname);
  if (match === null) return undefined;
  const id = (match[1] as string).toLowerCase();
  return /^[0-9a-f]{64}$/.test(id) ? id : undefined;
}

function parseContentLength(value: string | undefined): number | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) return "invalid";
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : "invalid";
}

type RangeResult = { readonly start: number; readonly end: number } | undefined | "invalid";

function parseRange(value: string | undefined, size: number): RangeResult {
  if (value === undefined || value.length === 0) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (match === null) return "invalid";
  const rawStart = match[1] as string;
  const rawEnd = match[2] as string;
  if (rawStart === "" && rawEnd === "") return "invalid";
  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "invalid";
    const start = Math.max(0, size - suffix);
    return { start, end: size - 1 };
  }
  const start = Number(rawStart);
  const end = rawEnd === "" ? size - 1 : Number(rawEnd);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return "invalid";
  if (start < 0 || start >= size || end < start) return "invalid";
  return { start, end: Math.min(end, size - 1) };
}

function matchesEtag(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  return header
    .split(",")
    .map((entry) => entry.trim())
    .some((entry) => entry === etag || entry === "*");
}

function json(status: number, body: unknown): ModuleHttpResponse {
  const data = JSON.stringify(body);
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-length": String(Buffer.byteLength(data)),
      "cache-control": "no-store",
    },
    body: new TextEncoder().encode(data),
  };
}

function failure(
  status: number,
  code: string,
  message: string,
  details?: JSONObject,
): ModuleHttpResponse {
  return json(status, {
    v: PROTOCOL_VERSION,
    kind: "error",
    code,
    message,
    retryable: false,
    ...(details === undefined ? {} : { details }),
  });
}

function errorResponse(error: unknown): ModuleHttpResponse {
  if (error instanceof MediaError) {
    return failure(
      statusOf(error),
      error.code,
      error.message,
      error.details === undefined ? undefined : (error.details as JSONObject),
    );
  }
  return failure(500, "internal", "多模態操作失敗。");
}

function statusOf(error: MediaError): number {
  switch (error.code) {
    case "payload_too_large":
      return 413;
    case "invalid_message":
      return 400;
    case "not_found":
      return 404;
    case "unsupported":
      return 415;
    case "unavailable":
      return 503;
    case "internal":
      return 500;
    default:
      return 400;
  }
}
