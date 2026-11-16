import { describe, expect, it } from "vitest";

import {
  MCP_SERVER_CONFIG_DIGEST_VERSION,
  mcpServerConfigDigest,
  mcpServerConfigSnapshot,
  type McpServerRecord,
} from "../../src/index.js";

const NOW = "2026-11-16T00:00:00.000Z";

function record(overrides: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    serverId: "srv-1",
    name: "本機",
    transport: "stdio",
    command: "node",
    args: ["server.js"],
    allowedHosts: [],
    enabled: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("MCP 設定核准綁定", () => {
  it("快照只含固定欄位，host 順序不影響結果", () => {
    expect(JSON.parse(mcpServerConfigSnapshot(record()))).toEqual({
      v: MCP_SERVER_CONFIG_DIGEST_VERSION,
      serverId: "srv-1",
      name: "本機",
      transport: "stdio",
      command: "node",
      args: ["server.js"],
      url: null,
      allowedHosts: [],
      enabled: true,
    });
    const a = mcpServerConfigDigest(
      record({
        transport: "http",
        url: "https://a.example",
        allowedHosts: ["a.example", "b.example"],
      }),
    );
    const b = mcpServerConfigDigest(
      record({
        transport: "http",
        url: "https://a.example",
        allowedHosts: ["b.example", "a.example"],
      }),
    );
    expect(a).toBe(b);
  });

  it("任何會影響行為的欄位變化都會產生不同雜湊", () => {
    const base = mcpServerConfigDigest(record());
    for (const change of [
      { serverId: "srv-2" },
      { name: "別名" },
      { command: "bun" },
      { args: ["other.js"] },
      { enabled: false },
      { createdAt: "2025-01-01T00:00:00.000Z" } as Partial<McpServerRecord>,
    ]) {
      // 時間戳刻意不入雜湊；其餘欄位都要讓雜湊改變。
      if ("createdAt" in change) {
        expect(mcpServerConfigDigest(record(change))).toBe(base);
      } else {
        expect(mcpServerConfigDigest(record(change))).not.toBe(base);
      }
    }
  });
});
