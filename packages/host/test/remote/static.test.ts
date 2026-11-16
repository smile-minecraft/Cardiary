import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";

import { createStaticHandler } from "../../src/remote/static.js";
import { createServer, type Server } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

interface Response {
  readonly status: number;
  readonly headers: NodeJS.Dict<string | string[] | undefined>;
  readonly body: string;
}

function fetchRaw(
  server: Server,
  path: string,
  options: { readonly method?: string; readonly headers?: Record<string, string> } = {},
): Promise<Response> {
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: options.method ?? "GET",
        headers: options.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("靜態檔案服務", () => {
  let root: string;
  let server: Server;

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function bootStatic(): Promise<Server> {
    root = await mkdtemp(join(tmpdir(), "cardiary-web-"));
    await mkdir(join(root, "assets"), { recursive: true });
    await writeFile(join(root, "index.html"), "<!doctype html><title>web</title>");
    await writeFile(join(root, "assets", "app.js"), "console.log(1)");
    const handler = createStaticHandler(root);
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (!handler(req, res)) {
        res.statusCode = 405;
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return server;
  }

  it("根路徑回 index.html，帶嚴格 CSP", async () => {
    const srv = await bootStatic();
    const res = await fetchRaw(srv, "/");
    expect(res.status).toBe(200);
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.body).toContain("<title>web</title>");
  });

  it("資產回正確的 content-type", async () => {
    const srv = await bootStatic();
    const res = await fetchRaw(srv, "/assets/app.js");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/javascript");
  });

  it("路徑穿越被拒（404）", async () => {
    const srv = await bootStatic();
    for (const path of ["/../package.json", "/%2e%2e/package.json", "/..%2fsecret"]) {
      const res = await fetchRaw(srv, path);
      expect(res.status).toBe(404);
    }
  });

  it("不存在的檔案回 404", async () => {
    const srv = await bootStatic();
    const res = await fetchRaw(srv, "/nope.js");
    expect(res.status).toBe(404);
  });

  it("POST 不由靜態服務處理", async () => {
    const srv = await bootStatic();
    const res = await fetchRaw(srv, "/", { method: "POST" });
    expect(res.status).toBe(405);
  });
});
