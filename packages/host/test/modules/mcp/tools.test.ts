/**
 * MCP 工具結果的 UI 介面透傳：具有 `ui://` 介面資源時，主機要把 HTML 與
 * CSP 網域放進 `metadata`（gateway 會轉成 `stream.ui renderer=mcp.app`）；
 * 讀取失敗或格式不符時工具照樣成功，只留診斷，不洩漏內容。
 */
import type { ToolBundleDraft, ToolOutcome } from "@cardiary/engine-adapter";
import type { McpServerRecord } from "@cardiary/domain";
import type { JsonValue } from "@cardiary/engine-adapter";
import { describe, expect, it } from "vitest";

import type {
  McpCallResult,
  McpClient,
  McpToolDescriptor,
} from "../../../src/modules/mcp/client.js";
import { buildBundleDraft, type McpServerRuntime } from "../../../src/modules/mcp/tools.js";

const SERVER_ID = "uitest";
const CALL_NAME = `mcp.${SERVER_ID}.call`;
const MIME = "text/html;profile=mcp-app";

function record(): McpServerRecord {
  return {
    serverId: SERVER_ID,
    name: "UiTest",
    transport: "stdio",
    command: "node",
    allowedHosts: [],
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

interface SetupOptions {
  readonly descriptors?: readonly McpToolDescriptor[];
  readonly callResult: McpCallResult;
  readonly resourceResult?: unknown;
  readonly readError?: Error;
}

function setup(options: SetupOptions): {
  readonly bundle: ToolBundleDraft;
  readonly readCalls: string[];
} {
  const descriptors = options.descriptors ?? [];
  const readCalls: string[] = [];
  const client: McpClient = {
    async listTools() {
      return [...descriptors];
    },
    async callTool() {
      return options.callResult;
    },
    async readResource(uri: string) {
      readCalls.push(uri);
      if (options.readError !== undefined) throw options.readError;
      return options.resourceResult;
    },
    async close() {},
  };
  const runtime: McpServerRuntime = {
    record: record(),
    client,
    refresh: () => undefined,
    cache: null,
    state: "ready",
    tools: [...descriptors],
  };
  return { bundle: buildBundleDraft(runtime), readCalls };
}

async function invoke(bundle: ToolBundleDraft, tool = "show"): Promise<ToolOutcome> {
  const call = bundle.tools.find((candidate) => candidate.name === CALL_NAME);
  if (call === undefined) throw new Error(`找不到工具 ${CALL_NAME}`);
  return call.execute({ tool, arguments: {} } as JsonValue, {} as never);
}

function textResult(text = "工具輸出"): McpCallResult {
  return { content: [{ type: "text", text }], isError: false, text };
}

function resourceResult(overrides: Partial<Record<string, unknown>> = {}): McpCallResult {
  const resource = {
    uri: "ui://app/view.html",
    mimeType: MIME,
    text: "<h1>hello</h1>",
    _meta: {
      ui: {
        csp: {
          connectDomains: ["https://api.example.com", "https://cdn.example.com"],
          resourceDomains: ["https://api.example.com"],
          frameDomains: ["https://frame.example.com"],
          baseUriDomains: ["ftp://blocked.example.com", "https://base.example.com:8443"],
        },
      },
    },
    ...overrides,
  };
  return {
    content: [
      { type: "text", text: "工具輸出" },
      { type: "resource", resource },
    ],
    isError: false,
    text: "工具輸出",
  };
}

function readResult(overrides: Partial<Record<string, unknown>> = {}): unknown {
  return {
    contents: [
      {
        uri: "ui://app/view.html",
        mimeType: MIME,
        text: "<h1>hello</h1>",
        _meta: { ui: { csp: { connectDomains: ["https://api.example.com"] } } },
        ...overrides,
      },
    ],
  };
}

function diagnosticOf(outcome: ToolOutcome): Array<Record<string, unknown>> {
  return (outcome.diagnostics ?? []) as Array<Record<string, unknown>>;
}

function metadataOf(outcome: ToolOutcome): Record<string, unknown> | undefined {
  return outcome.metadata as Record<string, unknown> | undefined;
}

describe("MCP 工具結果的 UI 介面透傳", () => {
  it("描述帶 _meta.ui.resourceUri 時讀取資源，metadata 送 html 與 CSP 網域", async () => {
    const { bundle, readCalls } = setup({
      descriptors: [{ name: "show", meta: { ui: { resourceUri: "ui://app/view.html" } } }],
      callResult: textResult(),
      resourceResult: readResult(),
    });

    const outcome = await invoke(bundle);
    expect(outcome.ok).toBe(true);
    expect(outcome.content).toEqual([{ type: "text", text: "工具輸出" }]);
    expect(readCalls).toEqual(["ui://app/view.html"]);
    expect(metadataOf(outcome)).toEqual({
      renderer: "mcp.app",
      data: { html: "<h1>hello</h1>", allowedHosts: ["api.example.com"] },
    });
    expect(outcome.diagnostics).toBeUndefined();
  });

  it("接受舊的扁平 _meta[ui/resourceUri] 寫法", async () => {
    const { bundle, readCalls } = setup({
      descriptors: [{ name: "show", meta: { "ui/resourceUri": "ui://app/legacy.html" } }],
      callResult: textResult(),
      resourceResult: readResult({ uri: "ui://app/legacy.html" }),
    });

    const outcome = await invoke(bundle);
    expect(outcome.ok).toBe(true);
    expect(readCalls).toEqual(["ui://app/legacy.html"]);
    expect(metadataOf(outcome)?.data).toMatchObject({ html: "<h1>hello</h1>" });
  });

  it("工具結果直接帶 resource text 時不讀資源，allowedHosts 只含 CSP 網域並去重", async () => {
    const { bundle, readCalls } = setup({
      callResult: resourceResult(),
    });

    const outcome = await invoke(bundle);
    expect(outcome.ok).toBe(true);
    expect(readCalls).toEqual([]);
    const data = metadataOf(outcome)?.data as Record<string, unknown> | undefined;
    expect(data?.html).toBe("<h1>hello</h1>");
    expect(new Set(data?.allowedHosts as string[])).toEqual(
      new Set(["api.example.com", "cdn.example.com", "frame.example.com", "base.example.com"]),
    );
    expect((data?.allowedHosts as string[]).filter((h) => h === "api.example.com")).toHaveLength(1);
  });

  it("resource 的 base64 blob 解成 UTF-8 HTML", async () => {
    const html = "<h1>世界</h1>";
    const { bundle } = setup({
      callResult: resourceResult({
        text: undefined,
        blob: Buffer.from(html, "utf8").toString("base64"),
      }),
    });

    const outcome = await invoke(bundle);
    expect(metadataOf(outcome)?.data).toMatchObject({ html });
  });

  it("沒有 CSP 時 allowedHosts 是空陣列", async () => {
    const { bundle } = setup({
      callResult: resourceResult({ _meta: undefined }),
    });

    const outcome = await invoke(bundle);
    expect(metadataOf(outcome)?.data).toMatchObject({ html: "<h1>hello</h1>", allowedHosts: [] });
  });

  it("readResource 失敗時 ok 仍 true，留診斷、沒有 metadata，也不洩漏錯誤內容", async () => {
    const { bundle } = setup({
      descriptors: [{ name: "show", meta: { ui: { resourceUri: "ui://app/view.html" } } }],
      callResult: textResult(),
      readError: new Error("super-secret-token-abc123"),
    });

    const outcome = await invoke(bundle);
    expect(outcome.ok).toBe(true);
    expect(outcome.content).toEqual([{ type: "text", text: "工具輸出" }]);
    expect(metadataOf(outcome)).toBeUndefined();
    const diagnostics = diagnosticOf(outcome);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("tool-unavailable");
    expect(String(diagnostics[0]?.message)).toContain("MCP App 介面資源無法讀取：");
    expect(JSON.stringify(outcome)).not.toContain("super-secret-token-abc123");
  });

  it("描述指向 UI 但讀回來沒有 resource 內容時，ok 仍 true 且有診斷", async () => {
    const { bundle } = setup({
      descriptors: [{ name: "show", meta: { ui: { resourceUri: "ui://app/view.html" } } }],
      callResult: textResult(),
      resourceResult: { contents: [] },
    });

    const outcome = await invoke(bundle);
    expect(outcome.ok).toBe(true);
    expect(metadataOf(outcome)).toBeUndefined();
    expect(diagnosticOf(outcome)[0]?.code).toBe("tool-unavailable");
  });

  it("uri 不是 ui:// 時不送 UI，診斷為 tool-unavailable", async () => {
    const { bundle } = setup({
      callResult: resourceResult({ uri: "https://app.example.com/view.html" }),
    });

    const outcome = await invoke(bundle);
    expect(outcome.ok).toBe(true);
    expect(metadataOf(outcome)).toBeUndefined();
    expect(diagnosticOf(outcome)[0]?.code).toBe("tool-unavailable");
  });

  it("mime 不符時不送 UI，診斷為 tool-unavailable", async () => {
    const { bundle } = setup({
      descriptors: [{ name: "show", meta: { ui: { resourceUri: "ui://app/view.html" } } }],
      callResult: textResult(),
      resourceResult: readResult({ mimeType: "text/html" }),
    });

    const outcome = await invoke(bundle);
    expect(outcome.ok).toBe(true);
    expect(metadataOf(outcome)).toBeUndefined();
    expect(diagnosticOf(outcome)[0]?.code).toBe("tool-unavailable");
  });

  it("HTML 超過 1 MiB 時不送 UI，診斷為 output-truncated", async () => {
    const huge = "a".repeat(1024 * 1024 + 1);
    const { bundle } = setup({ callResult: resourceResult({ text: huge }) });

    const outcome = await invoke(bundle);
    expect(outcome.ok).toBe(true);
    expect(metadataOf(outcome)).toBeUndefined();
    const diagnostics = diagnosticOf(outcome);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("output-truncated");
    expect(diagnostics[0]?.message).toBe("MCP App HTML 超過大小上限");
  });

  it("剛好 1 MiB 的 HTML 仍可送出", async () => {
    const exact = "a".repeat(1024 * 1024);
    const { bundle } = setup({ callResult: resourceResult({ text: exact }) });

    const outcome = await invoke(bundle);
    expect(outcome.ok).toBe(true);
    expect(metadataOf(outcome)?.data).toMatchObject({ html: exact });
    expect(outcome.diagnostics).toBeUndefined();
  });

  it("沒有任何 UI 資源時回原本文字，不加 metadata 或診斷", async () => {
    const { bundle } = setup({ callResult: textResult("單純文字") });

    const outcome = await invoke(bundle);
    expect(outcome).toEqual({ ok: true, content: [{ type: "text", text: "單純文字" }] });
  });

  it("工具回報 isError 時維持原本的失敗結果", async () => {
    const result: McpCallResult = { content: [], isError: true, text: "工具壞了" };
    const { bundle } = setup({ callResult: result });

    const outcome = await invoke(bundle);
    expect(outcome).toEqual({ ok: false, message: "工具壞了" });
  });
});
