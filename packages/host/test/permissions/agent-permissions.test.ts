import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AgentPermissions } from "../../src/permissions/agent-permissions.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup() {
  const root = mkdtempSync(join(tmpdir(), "cardiary-permissions-"));
  roots.push(root);
  const state = join(root, "state");
  mkdirSync(state);
  const diagnostics: string[] = [];
  const store = new AgentPermissions(state, { diagnostic: (text) => diagnostics.push(text) });
  return { store, state, diagnostics };
}

describe("委派設定", () => {
  it("預設全部關閉，設定儲存後可重新讀取", () => {
    const { store, state } = setup();
    expect(store.status("conversation", 0).categories).toEqual([]);
    store.setCategory("read-only-files", true, ["/allowed"]);
    expect(new AgentPermissions(state).status("conversation", 0).categories).toEqual([
      { category: "read-only-files", paths: ["/allowed"] },
    ]);
  });

  it("損毀的檔案回預設值並記診斷", () => {
    const { state, diagnostics } = setup();
    writeFileSync(join(state, "agent-permissions.json"), "{broken");
    const store = new AgentPermissions(state, { diagnostic: (text) => diagnostics.push(text) });
    expect(store.status("conversation", 0).categories).toEqual([]);
    expect(diagnostics.length).toBe(1);
    store.setCategory("read-only-files", true, ["/allowed"]);
    expect(() =>
      JSON.parse(readFileSync(join(state, "agent-permissions.json"), "utf8")),
    ).not.toThrow();
  });

  it("全部允許預設 15 分鐘，到期失效，上限 60 分鐘", () => {
    const { store } = setup();
    store.grantAllowAll({ tools: ["read_file"], paths: ["/allowed"] }, 0);
    expect(store.status("conversation", 899_999).allowAll?.expiresAt).toBe(900_000);
    expect(store.status("conversation", 900_000).allowAll).toBeNull();
    expect(() =>
      store.grantAllowAll({ tools: ["read_file"], paths: ["/allowed"] }, 0, 61),
    ).toThrow();
  });

  it("每場對話的次數分別保存，達 20 次後不能再預留", () => {
    const { store, state } = setup();
    for (let i = 0; i < 20; i += 1) expect(store.reserve("a")).toBe(true);
    expect(store.reserve("a")).toBe(false);
    expect(new AgentPermissions(state).status("a", 0).remaining).toBe(0);
    expect(store.status("b", 0).remaining).toBe(20);
  });
});
