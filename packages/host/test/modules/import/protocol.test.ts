import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ProtocolEventEmitter, ProtocolRequestHandler } from "@cardiary/module-api";
import type { JsonValue } from "@cardiary/engine-adapter";

import { registerImportProtocol } from "../../../src/modules/import/protocol.js";
import { makeImportFixture, makeTree, type ImportFixture } from "./helpers.js";

const fixtures: ImportFixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close();
});

async function fixture(): Promise<{
  f: ImportFixture;
  handler: ProtocolRequestHandler;
  events: unknown[];
}> {
  const f = await makeImportFixture();
  fixtures.push(f);
  let registered: ProtocolRequestHandler | undefined;
  const events: unknown[] = [];
  const protocol: ProtocolEventEmitter = {
    emit: (intent) => events.push(intent),
    registerNamespace: (_key, handler) => {
      registered = handler;
      return { dispose: () => {} };
    },
    registerHttpRoute: () => {
      throw new Error("匯入模組沒有 HTTP 路由");
    },
  };
  registerImportProtocol({ service: f.service, protocol });
  if (registered === undefined) throw new Error("處理器沒有註冊");
  return { f, handler: registered, events };
}

function request(type: string, payload: Record<string, JsonValue>) {
  return { type, payload: { data: payload }, clientId: "test" };
}

/** 處理器丟錯時拿回錯誤；測試要看錯誤碼與 details。 */
async function errorOf(
  handler: ProtocolRequestHandler,
  type: string,
  payload: Record<string, JsonValue>,
): Promise<{ code: string; details?: unknown }> {
  try {
    await handler(request(type, payload));
  } catch (error) {
    return error as { code: string; details?: unknown };
  }
  throw new Error("預期會丟錯，但成功了");
}

async function source(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cardiary-protocol-"));
  return makeTree(root, files);
}

describe("module.import 協定", () => {
  it("回應包成 ModuleResponsePayload 的 data 欄位", async () => {
    const { handler } = await fixture();
    const response = (await handler(request("module.import.sources", {}))) as Record<
      string,
      unknown
    >;
    expect(Object.keys(response)).toEqual(["data"]);
    const data = response["data"] as { sources: { kind: string }[] };
    expect(data.sources.map((sourceEntry) => sourceEntry.kind)).toEqual([
      "generic",
      "hermes",
      "alma",
    ]);
  });

  it("請求缺少 data 物件時回 invalid_message", async () => {
    const { handler } = await fixture();
    try {
      await handler({ type: "module.import.sources", payload: {}, clientId: "test" });
      throw new Error("預期會丟錯，但成功了");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("invalid_message");
    }
  });

  it("預覽與寫入走同一筆工作；寫入時每一項都有進度事件", async () => {
    const root = await source({ "memory.md": "- 我住在台北\n- 喜歡手沖咖啡\n" });
    const { f, handler } = await fixture();

    const previewResponse = (await handler(
      request("module.import.preview", {
        sourceKind: "generic",
        sourcePath: root,
        categories: { "memory.md": "memory" },
      }),
    )) as { data: { jobId: string; items: { key: string }[] } };
    expect(previewResponse.data.items).toHaveLength(2);

    const writeResponse = (await handler(
      request("module.import.write", {
        jobId: previewResponse.data.jobId,
        itemKeys: previewResponse.data.items.map((item) => item.key),
      }),
    )) as { data: { cardsCreated: number; results: { status: string }[] } };
    expect(writeResponse.data.cardsCreated).toBe(2);

    // 進度由模組啟用時接到 `module.import.progress` 事件；測試直接看服務的呼叫。
    expect(f.progress).toEqual([
      expect.objectContaining({ done: 1, total: 2, status: "written" }),
      expect.objectContaining({ done: 2, total: 2, status: "written" }),
    ]);
  });

  it("選了對話卻沒有時間範圍時回 invalid_message，details 說明原因", async () => {
    const { handler } = await fixture();
    const error = await errorOf(handler, "module.import.preview", {
      sourceKind: "hermes",
      includeConversations: true,
    });
    expect(error).toMatchObject({ code: "invalid_message", details: { reason: "range_required" } });
  });

  it("壞的 payload 與未知訊息回對應的錯誤碼", async () => {
    const { handler } = await fixture();
    expect(
      (await errorOf(handler, "module.import.preview", { sourceKind: "not-a-source" })).code,
    ).toBe("invalid_message");
    expect((await errorOf(handler, "module.import.nope", {})).code).toBe("not_found");
    expect(
      (
        await errorOf(handler, "module.import.write", {
          jobId: "missing",
          itemKeys: ["file:x.md"],
        })
      ).code,
    ).toBe("not_found");
  });

  it("同一筆預覽只能寫入一次", async () => {
    const root = await source({ "memory.md": "- 只有一條記憶\n" });
    const { handler } = await fixture();
    const preview = (await handler(
      request("module.import.preview", {
        sourceKind: "generic",
        sourcePath: root,
        categories: { "memory.md": "memory" },
      }),
    )) as { data: { jobId: string; items: { key: string }[] } };
    const payload = {
      jobId: preview.data.jobId,
      itemKeys: preview.data.items.map((item) => item.key),
    };
    await handler(request("module.import.write", payload));
    const second = await errorOf(handler, "module.import.write", payload);
    expect(second.code).toBe("conflict");
    expect(second.details).toMatchObject({ reason: "job_not_writable" });
  });

  it("列出來源資料夾的檔案，讓介面逐檔指定類別", async () => {
    const root = await source({ "notes/a.md": "內容\n", "image.png": "x", ".env": "secret" });
    const { handler, f } = await fixture();
    const response = (await handler(request("module.import.list", { path: root }))) as {
      data: { files: { relativePath: string; supported: boolean }[] };
    };
    expect(response.data.files.map((file) => file.relativePath)).toEqual([
      "image.png",
      "notes/a.md",
    ]);
    expect(response.data.files.find((file) => file.relativePath === "notes/a.md")?.supported).toBe(
      true,
    );
    expect(f.fs.opened(".env")).toBe(false);
  });
});
