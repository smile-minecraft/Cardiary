import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
    expect(store.status("conversation").categories).toEqual([]);
    store.setCategory("read-only-files", true, ["/allowed"]);
    expect(new AgentPermissions(state).status("conversation").categories).toEqual([
      { category: "read-only-files", paths: ["/allowed"] },
    ]);
  });

  it("損毀的檔案回預設值並記診斷", () => {
    const { state, diagnostics } = setup();
    writeFileSync(join(state, "agent-permissions.json"), "{broken");
    const store = new AgentPermissions(state, { diagnostic: (text) => diagnostics.push(text) });
    expect(store.status("conversation").categories).toEqual([]);
    expect(diagnostics.length).toBe(1);
    store.setCategory("read-only-files", true, ["/allowed"]);
    expect(() =>
      JSON.parse(readFileSync(join(state, "agent-permissions.json"), "utf8")),
    ).not.toThrow();
  });

  it("全部允許沒有期限，重新載入後仍在，撤銷後才消失", () => {
    const { store, state } = setup();
    store.grantAllowAll({ tools: ["read_file"], paths: ["/allowed"] });
    expect(store.status("conversation").allowAll).toEqual({
      tools: ["read_file"],
      paths: ["/allowed"],
      domains: [],
    });
    const restarted = new AgentPermissions(state);
    expect(restarted.allowAll()?.paths).toEqual(["/allowed"]);
    restarted.revokeAllowAll();
    expect(new AgentPermissions(state).allowAll()).toBeNull();
  });

  it("舊版帶 expiresAt 的限時授權在載入時撤銷，其他設定保留", () => {
    const { state, diagnostics } = setup();
    writeFileSync(
      join(state, "agent-permissions.json"),
      JSON.stringify({
        version: 1,
        categories: [{ category: "create-card", paths: [] }],
        allowedDomains: ["example.com"],
        allowAll: { tools: ["write_file"], paths: ["/allowed"], domains: [], expiresAt: 1 },
        counts: {},
      }),
    );
    const store = new AgentPermissions(state, { diagnostic: (text) => diagnostics.push(text) });
    expect(store.allowAll()).toBeNull();
    expect(store.status("conversation").categories).toEqual([
      { category: "create-card", paths: [] },
    ]);
    expect(store.allowedDomains()).toEqual(["example.com"]);
    expect(diagnostics.length).toBe(1);
    // 撤銷寫回正本：再次載入不會又跑一次，也不會讓限時授權變成無期限。
    const reloaded = JSON.parse(readFileSync(join(state, "agent-permissions.json"), "utf8"));
    expect(reloaded.allowAll).toBeNull();
  });

  it("全部允許含不認得的欄位視為損毀，退回全部關閉", () => {
    const { state, diagnostics } = setup();
    writeFileSync(
      join(state, "agent-permissions.json"),
      JSON.stringify({
        version: 1,
        categories: [{ category: "create-card", paths: [] }],
        allowedDomains: [],
        allowAll: { tools: ["write_file"], paths: ["/allowed"], domains: [], scope: "all" },
        counts: {},
      }),
    );
    const store = new AgentPermissions(state, { diagnostic: (text) => diagnostics.push(text) });
    expect(store.allowAll()).toBeNull();
    expect(store.status("conversation").categories).toEqual([]);
    expect(diagnostics.length).toBe(1);
  });

  it("工具不可為空", () => {
    const { store } = setup();
    expect(() => store.grantAllowAll({ tools: [], paths: ["/allowed"] })).toThrow();
    expect(store.allowAll()).toBeNull();
  });

  it("每場對話的次數分別保存，達 20 次後不能再預留", () => {
    const { store, state } = setup();
    for (let i = 0; i < 20; i += 1) expect(store.reserve("a")).toBe(true);
    expect(store.reserve("a")).toBe(false);
    expect(new AgentPermissions(state).status("a").remaining).toBe(0);
    expect(store.status("b").remaining).toBe(20);
  });
});

describe("授權路徑存成真實路徑", () => {
  it("經過符號連結的資料夾與還不存在的子路徑，都換成真實路徑", () => {
    const base = realpathSync.native(mkdtempSync(join(tmpdir(), "cardiary-perm-real-")));
    try {
      const real = join(base, "real");
      mkdirSync(real);
      const link = join(base, "link");
      symlinkSync(real, link);
      const state = join(base, "state");
      mkdirSync(state);
      const permissions = new AgentPermissions(state);
      permissions.grantAllowAll({ tools: ["write_file"], paths: [link, join(link, "later")] });
      expect(permissions.allowAll()?.paths).toEqual([real, join(real, "later")]);
      permissions.setCategory("read-only-files", true, [link]);
      expect(permissions.allowsCategory("read-only-files", join(real, "notes.md"))).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
