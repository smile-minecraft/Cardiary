import { describe, expect, it } from "vitest";

import { canonicalJson, computeApprovalKey } from "../src/index.js";

/**
 * storage 第 3.6 節的格式：
 * `SHA-256("cardiary.approval.v1" 0x1F scope 0x1F conversationId 0x1F turnId
 * 0x1F toolName 0x1F canonicalJson(payload))`。
 *
 * 期望值是另外用字串接線算出來的固定向量，不是呼叫同一個函式：
 * 這一條會擋住欄位順序、分隔符或正規化規則被改動。
 */
describe("approval_key 格式", () => {
  it("符合 storage 3.6 的固定向量", () => {
    const key = computeApprovalKey({
      scope: "tool",
      conversationId: "conv-1",
      turnId: "turn_10",
      toolName: "deploy",
      payload: { target: "prod", options: { b: 2, a: 1 } },
    });
    expect(key).toBe("3a045792d5f45894ebef05127a127f949495d6d0eacaa3c2bfbca23f61071fe0");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("巢狀陣列、null、Unicode 與跳脫字元也固定", () => {
    const key = computeApprovalKey({
      scope: "tool",
      conversationId: "c2",
      turnId: "turn_7",
      toolName: "hold",
      payload: { z: 'x"y', a: [1, true, null, "中文"] },
    });
    expect(key).toBe("0c73c760ea112aed42c2ab2e86ac7c0df23a1fb4975c37a344f386c8274be944");
  });

  it("鍵的順序不影響 approval_key", () => {
    const left = computeApprovalKey({
      scope: "tool",
      conversationId: "conv-1",
      turnId: "turn_10",
      toolName: "deploy",
      payload: { target: "prod", options: { b: 2, a: 1 } },
    });
    const right = computeApprovalKey({
      scope: "tool",
      conversationId: "conv-1",
      turnId: "turn_10",
      toolName: "deploy",
      payload: { options: { a: 1, b: 2 }, target: "prod" },
    });
    expect(left).toBe(right);
  });

  it("對話、回合、工具名稱或輸入任一不同就得到不同鍵", () => {
    const base = {
      scope: "tool" as const,
      conversationId: "conv-1",
      turnId: "turn_10",
      toolName: "deploy",
      payload: { target: "prod" } as const,
    };
    const keys = new Set([
      computeApprovalKey(base),
      computeApprovalKey({ ...base, conversationId: "conv-2" }),
      computeApprovalKey({ ...base, turnId: "turn_11" }),
      computeApprovalKey({ ...base, toolName: "hold" }),
      computeApprovalKey({ ...base, payload: { target: "staging" } }),
    ]);
    expect(keys.size).toBe(5);
  });
});

describe("canonicalJson", () => {
  it("排序鍵、不加空白、保留陣列順序", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
  });

  it("整數不加小數點，浮點數用最短表示", () => {
    expect(canonicalJson(1)).toBe("1");
    expect(canonicalJson(1.5)).toBe("1.5");
    expect(canonicalJson(-0)).toBe("0");
    expect(canonicalJson(1e21)).toBe("1e+21");
  });

  it("拒絕非有限數值", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(/非有限/);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(/非有限/);
    expect(() =>
      computeApprovalKey({
        scope: "tool",
        conversationId: "c",
        turnId: "turn_1",
        toolName: "t",
        payload: { value: Number.NaN },
      }),
    ).toThrow(/非有限/);
  });
});
