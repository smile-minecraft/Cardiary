/**
 * 網頁客戶端的靜態檔案服務。
 *
 * 只服務 `webRoot` 底下的檔案；路徑走正式解析後必須還在 `webRoot` 裡，
 * 否則回 404（不回 403，不透露哪裡有什麼）。`index.html` 在根目錄，SPA
 * 用 hash 路由，不需要 fallback。
 *
 * 回應一律帶嚴格 CSP：只允許同源的指令碼與樣式、`connect-src` 帶
 * `ws:`/`wss:` 讓頁面連同站 WebSocket、`frame-ancestors 'none'` 擋嵌入。
 * 靜態資產不需要 Token——頁面先載入，配對通道在 WebSocket 上完成。
 */

import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "font-src 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join("; ");

export interface StaticHandler {
  /** 回 true 代表這個請求由靜態服務處理完了。 */
  (request: IncomingMessage, response: ServerResponse): boolean;
}

/**
 * 建立靜態檔案服務；`webRoot` 不存在時每個請求都回 404。
 *
 * 只處理 GET 與 HEAD；其他方法回 false 讓上層決定。
 */
export function createStaticHandler(webRoot: string): StaticHandler {
  const root = resolve(webRoot);
  const indexFile = join(root, "index.html");

  return (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") return false;
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(url.pathname);
    const candidate = pathname === "/" ? indexFile : resolve(root, `.${pathname}`);
    if (candidate !== root && !candidate.startsWith(root + sep)) {
      sendPlain(response, 404, "not_found");
      return true;
    }

    void (async () => {
      const info = await stat(candidate).catch(() => null);
      const target =
        info && info.isDirectory()
          ? join(candidate, "index.html")
          : info && info.isFile()
            ? candidate
            : null;
      if (target === null) {
        sendPlain(response, 404, "not_found");
        return;
      }
      const targetInfo = target === candidate ? info : await stat(target).catch(() => null);
      if (!targetInfo?.isFile()) {
        sendPlain(response, 404, "not_found");
        return;
      }
      const isHtml = target.endsWith(".html");
      const headers: Record<string, string> = {
        "content-type": MIME[extname(target).toLowerCase()] ?? "application/octet-stream",
        "content-length": String(targetInfo.size),
        "content-security-policy": CSP,
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "cache-control":
          isHtml || target.endsWith(".map") ? "no-cache" : "public, max-age=31536000, immutable",
      };
      response.writeHead(200, headers);
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      createReadStream(target).pipe(response);
    })().catch(() => {
      if (!response.headersSent) sendPlain(response, 404, "not_found");
      else response.destroy();
    });
    return true;
  };
}

function sendPlain(response: ServerResponse, status: number, message: string): void {
  const body = JSON.stringify({ v: 1, kind: "error", code: message, retryable: false });
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "content-security-policy": CSP,
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}
