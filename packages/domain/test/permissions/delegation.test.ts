import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  delegationCandidate,
  reviewProbability,
  type DelegationInput,
} from "../../src/permissions/delegation.js";
import type { PermissionAction } from "../../src/permissions/types.js";

const roots = { workingDir: "/work", folderRoot: "/folder" };

function candidate(action: PermissionAction, input: Partial<DelegationInput> = {}) {
  return delegationCandidate({ action, roots, ...input });
}

describe("System One 自動審核", () => {
  it.each([
    [0.9, "allow"],
    [1, "allow"],
    [0.899, "ask-human"],
    [0.7, "ask-human"],
    [0.699, "ask-human"],
    [-1, "ask-human"],
    [1.01, "ask-human"],
    [Number.NaN, "ask-human"],
    [undefined, "ask-human"],
  ] as const)("機率 %s 的判定為 %s", (probability, expected) => {
    expect(reviewProbability(probability).kind).toBe(expected);
  });

  it("中間區間必須提供人工審核的理由", () => {
    expect(reviewProbability(0.7)).toMatchObject({ kind: "ask-human", reason: expect.any(String) });
  });
});

describe("可委派動作的封閉清單", () => {
  it("讀取與列出檔案歸在 read-only-files，並帶解析後路徑", () => {
    const read = candidate({ kind: "fs.read", path: "notes/today.md" });
    expect(read?.category).toBe("read-only-files");
    expect(read?.path?.startsWith("/work/")).toBe(true);
    expect(candidate({ kind: "fs.list", path: "." })?.category).toBe("read-only-files");
  });

  it("憑證路徑不進委派", () => {
    expect(candidate({ kind: "fs.read", path: ".ssh/id_ed25519" })).toBeNull();
    expect(candidate({ kind: "fs.list", path: ".aws" })).toBeNull();
    expect(candidate({ kind: "fs.read", path: ".env" })).toBeNull();
  });

  it("單純的唯讀 git 查詢歸在 git-readonly，cwd 是授權範圍", () => {
    const result = candidate({ kind: "shell.exec", command: "git status --short", cwd: "." });
    expect(result?.category).toBe("git-readonly");
    expect(result?.path).toBe("/work");
  });

  it.each([
    "git status && rm -rf notes",
    "git log > out.txt",
    "git status; curl https://example.com",
    "git push",
    "git commit -m x",
    "git checkout main",
    "ls -la",
  ])("不委派這條 shell 指令：%s", (command) => {
    expect(candidate({ kind: "shell.exec", command, cwd: "." })).toBeNull();
  });

  it("建立卡片歸在 create-card，沒有路徑條件", () => {
    expect(candidate({ kind: "cards.create", cardKind: "note" })).toEqual({
      category: "create-card",
    });
  });

  it.each<PermissionAction>([
    { kind: "fs.write", path: "a.md", mode: "replace" },
    { kind: "fs.delete", path: "a.md", recursive: false },
    { kind: "cards.patch", cardId: "c1" },
    { kind: "cards.delete", cardId: "c1" },
    { kind: "network.outbound", host: "example.com", port: 443, scheme: "https" },
    { kind: "mcp.call", serverId: "s1", toolName: "t1" },
    { kind: "external-agent.dispatch", agent: "a", command: "run" },
    { kind: "settings.change", key: "permissions", level: "human-only" },
  ])("永遠不委派 $kind", (action) => {
    expect(candidate(action)).toBeNull();
  });

  it("真的目錄可以解析；不存在的相對路徑仍以工作目錄為基準", () => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), "cardiary-delegation-")));
    mkdirSync(join(directory, "notes"));
    writeFileSync(join(directory, "notes", "today.md"), "# 今天");
    const inside = delegationCandidate({
      action: { kind: "fs.read", path: "notes/today.md" },
      roots: { workingDir: directory, folderRoot: directory },
    });
    expect(inside?.path).toBe(join(directory, "notes", "today.md"));
  });
});
