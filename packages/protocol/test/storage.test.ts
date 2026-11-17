/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

const schema = JSON.parse(
  readFileSync(`${packageRoot}/schema/protocol.schema.json`, "utf8"),
) as any;

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(schema);

const validateServer = ajv.compile({
  $ref: `${schema.$id}#/$defs/ServerFrame`,
});

function usageResponse(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    v: 1,
    kind: "response",
    replyTo: "req_storage_usage",
    type: "storage.usage",
    payload,
  };
}

const BASE_USAGE = [{ category: "cache", bytes: 128, cleanableBytes: 128 }];

describe("storage.usage 的 outsideWrites 選用欄位", () => {
  it("舊訊息沒有 outsideWrites 仍通過，required 只有 usage", () => {
    expect(validateServer(usageResponse({ usage: BASE_USAGE }))).toBe(true);
    expect(schema.$defs.StorageUsageResponsePayload.required).toEqual(["usage"]);
  });

  it("measured / absent / unavailable 三態都通過，bytes 為非負整數且可選", () => {
    const payload = {
      usage: BASE_USAGE,
      outsideWrites: [
        { path: "/home/u/.claude/projects", tool: "claude-code", status: "measured", bytes: 4096 },
        { path: "/home/u/.claude/backups", tool: "claude-code", status: "absent", bytes: 0 },
        { path: "/home/u/.claude/plugins", tool: "claude-code", status: "unavailable" },
      ],
    };
    expect(validateServer(usageResponse(payload))).toBe(true);
    expect(schema.$defs.StorageOutsideWriteEntry.required).toEqual(["path", "tool", "status"]);
    expect(schema.$defs.StorageOutsideWriteEntry.properties.bytes.minimum).toBe(0);
  });

  it("bytes 只是選用：unavailable 不帶 bytes 通過，自訂工具字串也通過", () => {
    expect(
      validateServer(
        usageResponse({
          usage: BASE_USAGE,
          outsideWrites: [
            { path: "/home/u/.claude/plugins", tool: "claude-code", status: "unavailable" },
            { path: "/home/u/.cache/other", tool: "opencode", status: "measured", bytes: 7 },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("錯型別、負數、未知狀態與未知欄位都被拒絕", () => {
    const invalid = [
      // tool 必須是字串。
      { path: "/home/u/.claude/plugins", tool: 1, status: "measured", bytes: 1 },
      // bytes 必須是整數。
      { path: "/home/u/.claude/plugins", tool: "claude-code", status: "measured", bytes: "1" },
      // bytes 不得為負。
      { path: "/home/u/.claude/plugins", tool: "claude-code", status: "measured", bytes: -1 },
      // status 必須是三態之一。
      { path: "/home/u/.claude/plugins", tool: "claude-code", status: "unknown" },
      // additionalProperties: false，未知欄位被拒。
      {
        path: "/home/u/.claude/plugins",
        tool: "claude-code",
        status: "measured",
        bytes: 1,
        extra: true,
      },
    ];
    for (const entry of invalid) {
      expect(
        validateServer(usageResponse({ usage: BASE_USAGE, outsideWrites: [entry] })),
        JSON.stringify(entry),
      ).toBe(false);
    }
  });
});
