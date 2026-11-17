import { describe, expect, it } from "vitest";
import {
  classifyAcpLine,
  isAgentCacheStale,
  normalizeAcpLine,
  normalizeAgentLine,
  normalizeFakeLine,
  normalizeStreamJsonLine,
} from "../../src/external-agents/index.js";

describe("fake line normalization", () => {
  it("把進度與完成訊息解析成正規化事件", () => {
    expect(normalizeFakeLine('{"type":"progress","completed":1,"total":3,"label":"讀檔"}')).toEqual(
      [{ kind: "progress", completed: 1, total: 3, label: "讀檔" }],
    );
    expect(normalizeFakeLine('{"type":"completed","message":"做完了"}')).toEqual([
      { kind: "completed", message: "做完了" },
    ]);
    expect(normalizeFakeLine('{"type":"failed","message":"找不到指令"}')).toEqual([
      { kind: "failed", message: "找不到指令" },
    ]);
    expect(normalizeFakeLine("not-json")).toEqual([]);
  });

  it("權限請求帶上工具名稱、輸入與供應商 request id", () => {
    const events = normalizeFakeLine(
      '{"type":"permission","tool":"Bash","requestId":"r9","input":{"command":"ls"},"description":"列出檔案"}',
    );
    expect(events).toEqual([
      {
        kind: "permission",
        toolName: "Bash",
        input: { command: "ls" },
        description: "列出檔案",
        requestKey: "fake:r9",
        replyToken: "r9",
      },
    ]);
  });
});

describe("opencode acp normalization", () => {
  it("分類 request / notification / response", () => {
    expect(classifyAcpLine('{"jsonrpc":"2.0","method":"session/new","id":1}').kind).toBe("request");
    expect(classifyAcpLine('{"jsonrpc":"2.0","method":"session/update","params":{}}').kind).toBe(
      "notification",
    );
    expect(classifyAcpLine('{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1}}').kind).toBe(
      "response",
    );
    expect(classifyAcpLine("bun warning: hello").kind).toBe("ignored");
  });

  it("把 session/request_permission 轉成待核准事件，並記下伺服器實際的 optionId", () => {
    const events = normalizeAcpLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 41,
        method: "session/request_permission",
        params: {
          toolCall: {
            toolName: "shell",
            title: "git status",
            rawInput: { command: "git status" },
          },
          options: [
            { optionId: "once", kind: "allow_once", name: "Allow once" },
            { optionId: "always", kind: "allow_always", name: "Always allow" },
            { optionId: "reject", kind: "reject_once", name: "Reject" },
          ],
        },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "permission",
      toolName: "shell",
      replyToken: 41,
      requestKey: "opencode:41",
      allowOptionId: "once",
      denyOptionId: "reject",
    });
  });

  it("request id 的型別原樣保留：數字 0 與字串 '0' 的 replyToken 型別不同，去重鍵仍相同", () => {
    const numeric = normalizeAcpLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        method: "session/request_permission",
        params: { toolCall: { toolName: "shell" }, options: [] },
      }),
    );
    const textual = normalizeAcpLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "0",
        method: "session/request_permission",
        params: { toolCall: { toolName: "shell" }, options: [] },
      }),
    );
    // replyToken 保留原本的 id 型別，回覆代理時才不會因型別不符被當成未知請求。
    expect(numeric[0]).toMatchObject({ replyToken: 0, requestKey: "opencode:0" });
    expect(typeof (numeric[0] as { replyToken: number | string }).replyToken).toBe("number");
    expect(textual[0]).toMatchObject({ replyToken: "0", requestKey: "opencode:0" });
    expect(typeof (textual[0] as { replyToken: number | string }).replyToken).toBe("string");
    // 去重鍵仍是字串，數字 0 與字串 "0" 共用同一個 requestKey。
    expect((numeric[0] as { requestKey: string }).requestKey).toBe(
      (textual[0] as { requestKey: string }).requestKey,
    );
  });

  it("plan 更新換算成進度", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "plan",
          entries: [
            { content: "讀規格", status: "completed" },
            { content: "實作", status: "in_progress" },
            { content: "測試", status: "pending" },
          ],
        },
      },
    });
    expect(normalizeAcpLine(line)).toEqual([
      { kind: "progress", completed: 1, total: 3, label: "實作" },
    ]);
  });

  it("agent_message_chunk 只送出輸出文字", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "完成一半" },
        },
      },
    });
    expect(normalizeAcpLine(line)).toEqual([{ kind: "output", text: "完成一半" }]);
  });
});

describe("claude stream-json normalization", () => {
  it("control_request can_use_tool 轉成待核准事件", () => {
    const line = JSON.stringify({
      type: "control_request",
      request_id: "req_17",
      request: {
        subtype: "can_use_tool",
        tool_name: "Edit",
        tool_use_id: "toolu_abc",
        input: { file_path: "src/a.ts", old_string: "x", new_string: "y" },
        description: "replace x with y",
      },
    });
    expect(normalizeStreamJsonLine(line)).toEqual([
      {
        kind: "permission",
        toolName: "Edit",
        input: { file_path: "src/a.ts", old_string: "x", new_string: "y" },
        description: "replace x with y",
        requestKey: "claude:toolu_abc",
        replyToken: "req_17",
      },
    ]);
  });

  it("result success / 失敗對應 completed / failed", () => {
    expect(
      normalizeStreamJsonLine(
        JSON.stringify({ type: "result", subtype: "success", result: "做完" }),
      ),
    ).toEqual([{ kind: "completed", message: "完成：做完" }]);
    expect(
      normalizeStreamJsonLine(
        JSON.stringify({ type: "result", subtype: "error_max_turns", result: "卡住" }),
      )[0],
    ).toMatchObject({ kind: "failed" });
  });

  it("is_error 為 true 時即使 subtype 是 success 也算 failed，保留原始錯誤訊息", () => {
    const events = normalizeStreamJsonLine(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: true,
        result: "Not logged in · Please run /login",
      }),
    );
    expect(events[0]).toMatchObject({ kind: "failed" });
    const message = (events[0] as { message: string }).message;
    expect(message).toContain("Not logged in · Please run /login");
    expect(message).not.toContain("完成");
  });

  it("is_error 為 true 但 result 為空時仍算 failed", () => {
    const events = normalizeStreamJsonLine(
      JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "" }),
    );
    expect(events[0]).toMatchObject({ kind: "failed" });
  });

  it("is_error 為 false 的 success 正常算 completed", () => {
    expect(
      normalizeStreamJsonLine(
        JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "做完" }),
      ),
    ).toEqual([{ kind: "completed", message: "完成：做完" }]);
  });
});

describe("normalizeAgentLine dispatch", () => {
  it("依種類分派，未知種類不回傳事件", () => {
    expect(normalizeAgentLine("fake", '{"type":"output","text":"hi"}')).toEqual([
      { kind: "output", text: "hi" },
    ]);
  });
});

describe("isAgentCacheStale", () => {
  it("超過 30 天才算過期", () => {
    const now = Date.parse("2026-02-01T00:00:00.000Z");
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(isAgentCacheStale(now - thirtyDays - 1, now)).toBe(true);
    expect(isAgentCacheStale(now - thirtyDays + 1000, now)).toBe(false);
    expect(isAgentCacheStale(Number.NaN, now)).toBe(false);
  });
});
