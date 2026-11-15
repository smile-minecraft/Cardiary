import type { ToolPermissionGate, ToolPermissionVerdict } from "@cardiary/engine-adapter";

import { DEFAULT_APPROVAL_TIMEOUT_MS } from "../permissions/gate.js";

export { DEFAULT_APPROVAL_TIMEOUT_MS };

/**
 * M0 的權限掛點：所有工具都回 `ask-human`。
 *
 * 保留給示範工具與沒有硬規則閘道的組裝；產品組裝改用
 * `createToolPermissionGate`（`packages/host/src/permissions/gate.ts`）。
 * 掛點與呼叫順序不變。
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
