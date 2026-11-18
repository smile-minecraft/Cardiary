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
      permissions.grantAllowAll(
        { tools: ["write_file"], paths: [link, join(link, "later")] },
        0,
        15,
      );
      expect(permissions.allowAllFor(0)?.paths).toEqual([real, join(real, "later")]);
      permissions.setCategory("read-only-files", true, [link]);
      expect(permissions.allowsCategory("read-only-files", join(real, "notes.md"))).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
