import { describe, expect, it } from "vitest";
import { afterEach } from "vitest";

import { McpServerApprovalStore } from "../../src/index.js";
import { createMcpServerRecord, type McpServerInput } from "@cardiary/domain";
import { createTempRoot, openTestStorage, type TempRoot } from "../helpers/temp.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

function temp(label = "approval-store"): TempRoot {
  const root = createTempRoot(label);
  cleanups.push(root.cleanup);
  return root;
}

function freshDb() {
  const tempRoot = temp();
  const storage = openTestStorage(tempRoot);
  cleanups.push(() => storage.close());
  return storage.state;
}

const INPUT: McpServerInput = {
  name: "本機",
  transport: "stdio",
  command: "node",
  allowedHosts: [],
};

function server(overrides: { serverId?: string } = {}, input: McpServerInput = INPUT) {
  return createMcpServerRecord(input, {
    serverId: overrides.serverId ?? "srv-1",
    now: new Date("2026-11-16T00:00:00.000Z"),
    enabled: true,
  });
}

describe("MCP 核准綁定存取", () => {
  it("沒有綁定紀錄就不算核准過", () => {
    const db = freshDb();
    const store = new McpServerApprovalStore(db);
    expect(store.isApproved(server())).toBe(false);
    expect(store.approvalOf("srv-1")).toBeUndefined();
  });

  it("核准後讀得到，撤銷後就看不到綁定", () => {
    const db = freshDb();
    const store = new McpServerApprovalStore(db, {
      now: () => new Date("2026-11-16T01:02:03.000Z"),
    });
    const record = server();
    store.approve(record);
    expect(store.isApproved(record)).toBe(true);
    expect(store.approvalOf("srv-1")).toEqual({
      serverId: "srv-1",
      configDigest: expect.any(String),
      configJson: expect.any(String),
      approvedAt: "2026-11-16T01:02:03.000Z",
      persistentWrite: false,
    });
    store.revoke("srv-1");
    expect(store.isApproved(record)).toBe(false);
  });

  it("內容改動後綁定失效，時間戳改動不影響判定", () => {
    const db = freshDb();
    const store = new McpServerApprovalStore(db);
    const record = server();
    store.approve(record);
    expect(store.isApproved({ ...record, updatedAt: new Date().toISOString() })).toBe(true);
    expect(store.isApproved({ ...record, command: "bun" })).toBe(false);
    expect(store.isApproved({ ...record, enabled: false })).toBe(false);
    expect(store.isApproved({ ...record, args: ["other.js"] })).toBe(false);
  });

  it("重新核准會覆蓋同一個 server_id 的舊紀錄", () => {
    const db = freshDb();
    const store = new McpServerApprovalStore(db, {
      now: () => new Date("2026-11-16T02:00:00.000Z"),
    });
    store.approve(server());
    const updated = server({ serverId: "srv-1" });
    store.approve({ ...updated, name: "改名", updatedAt: "2026-11-16T02:00:00.000Z" });
    expect(store.list()).toHaveLength(1);
    expect(
      store.isApproved({ ...updated, name: "改名", updatedAt: "2026-11-16T02:00:00.000Z" }),
    ).toBe(true);
    expect(store.isApproved(updated)).toBe(false);
  });

  it("list 依 server_id 排序，只回已核准的紀錄", () => {
    const db = freshDb();
    const store = new McpServerApprovalStore(db);
    store.approve(server({ serverId: "srv-b" }));
    store.approve(server({ serverId: "srv-a" }));
    store.revoke("srv-a");
    store.approve(server({ serverId: "srv-a" }));
    store.approve(server({ serverId: "srv-c" }));
    expect(store.list().map((entry) => entry.serverId)).toEqual(["srv-a", "srv-b", "srv-c"]);
  });
});
