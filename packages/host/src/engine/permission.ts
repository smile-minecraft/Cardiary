import type { ToolPermissionGate, ToolPermissionVerdict } from "@cardiary/engine-adapter";

/** 審批的預設逾時：5 分鐘。 */
export const DEFAULT_APPROVAL_TIMEOUT_MS = 300_000;

/**
 * M0 的權限掛點：所有工具都回 `ask-human`。
 *
 * 硬規則與「全部允許」在 M1 實作；掛點與呼叫順序不變，之後只換這個實作。
 */
export const m0PermissionGate: ToolPermissionGate = {
  evaluate(request): Promise<ToolPermissionVerdict> {
    return Promise.resolve({
      kind: "ask-human",
      action: {
        kind: "tool-execution",
        summary: `執行工具 ${request.toolName}`,
        toolName: request.toolName,
        toolInput: request.input,
      },
      risk: "unknown",
      timeoutMs: DEFAULT_APPROVAL_TIMEOUT_MS,
    });
  },
};
