import { describe, expect, it } from "vitest";

import { protocolDiagnostic, protocolErrorFromEngine } from "../src/errors.js";

describe("錯誤碼對照", () => {
  it("EngineErrorCode 轉成協定碼，原始碼只放在 details", () => {
    expect(protocolErrorFromEngine("conversation-not-found", "x").code).toBe("not_found");
    expect(protocolErrorFromEngine("conversation-busy", "x").code).toBe("busy");
    expect(protocolErrorFromEngine("engine-paused", "x").code).toBe("unavailable");
    expect(protocolErrorFromEngine("engine-paused", "x").details).toEqual({
      reason: "engine_paused",
      engineCode: "engine-paused",
    });
    expect(protocolErrorFromEngine("storage-unavailable", "x").details).toEqual({
      reason: "storage",
    });
    expect(protocolErrorFromEngine("approval-expired", "x").code).toBe("conflict");
    expect(protocolErrorFromEngine("tool-not-registered", "x").code).toBe("unsupported");
    expect(protocolErrorFromEngine("invalid-cursor", "x").code).toBe("invalid_message");
    expect(protocolErrorFromEngine("internal", "x").code).toBe("internal");
    expect(protocolErrorFromEngine("internal", "x").retryable).toBe(true);
  });

  it("ToolDiagnosticCode 轉成協定診斷碼", () => {
    expect(protocolDiagnostic({ code: "paused" })).toEqual({ code: "interrupted" });
    expect(protocolDiagnostic({ code: "timed-out" })).toEqual({ code: "timeout" });
    expect(protocolDiagnostic({ code: "output-truncated" })).toEqual({ code: "truncated" });
    expect(protocolDiagnostic({ code: "permission-denied" })).toEqual({ code: "denied" });
    expect(protocolDiagnostic({ code: "approval-denied" })).toEqual({ code: "denied" });
    expect(protocolDiagnostic({ code: "approval-expired" })).toEqual({ code: "approval_expired" });
    expect(protocolDiagnostic({ code: "tool-unavailable" })).toEqual({
      code: "tool_unavailable",
    });
  });
});
