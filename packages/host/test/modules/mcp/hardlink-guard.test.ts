/**
 * stdio 沙盒的硬連結別名防線。
 *
 * SBPL 在操作時只看路徑：沙盒建立前就存在的硬連結，從 tmp 底下的別名寫入時
 * OS 看到的是可寫的路徑，會放過對受保護 inode 的覆寫。這裡用真的
 * `linkSync` 建別名，驗證启动前的 inode 掃描能 fail-closed 擋下。
 */
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createMcpStdioSandbox, ProtectedAliasError } from "../../../src/modules/mcp/sandbox.js";
import { findProtectedAliases, ProtectedAliasScanError } from "../../../src/permissions/sandbox.js";

let root = "";

afterEach(() => {
  if (root !== "") {
    rmSync(root, { recursive: true, force: true });
    root = "";
  }
});

function makeFolder(): {
  folderRoot: string;
  stateFile: string;
  workingDir: string;
  tmpRoot: string;
} {
  root = mkdtempSync(join(tmpdir(), "cardiary-hardlink-"));
  const folderRoot = join(root, "Cardiary");
  const stateRoot = join(folderRoot, "state");
  const tmpRoot = join(folderRoot, "tmp");
  const workingDir = join(tmpRoot, "mcp", "test-server");
  mkdirSync(stateRoot, { recursive: true });
  mkdirSync(workingDir, { recursive: true });
  const stateFile = join(stateRoot, "mcp-servers.json");
  writeFileSync(stateFile, "{}");
  return { folderRoot, stateFile, workingDir, tmpRoot };
}

describe("stdio 沙盒的硬連結別名防線", () => {
  it("沒有別名時掃描為空，正常檔案不擋啟動", () => {
    const { folderRoot, workingDir } = makeFolder();
    writeFileSync(join(workingDir, "normal.json"), "{}");
    expect(findProtectedAliases({ workingDir, folderRoot })).toEqual([]);
    expect(() => createMcpStdioSandbox({ folderRoot, serverId: "test-server" })).not.toThrow();
  });

  it("workingDir 內指向 state 正本的 hardlink 被擋下", () => {
    const { folderRoot, stateFile, workingDir } = makeFolder();
    const alias = join(workingDir, "alias.json");
    linkSync(stateFile, alias);

    expect(findProtectedAliases({ workingDir, folderRoot }).map((entry) => entry.path)).toContain(
      alias,
    );
    const launch = () => createMcpStdioSandbox({ folderRoot, serverId: "test-server" });
    expect(launch).toThrow(ProtectedAliasError);
    expect(launch).toThrow(/硬連結/);
  });

  it("tmp 底下但不在 workingDir 的 hardlink 也被擋下", () => {
    const { folderRoot, stateFile, workingDir, tmpRoot } = makeFolder();
    const elsewhere = join(tmpRoot, "elsewhere");
    mkdirSync(elsewhere, { recursive: true });
    const alias = join(elsewhere, "alias.json");
    linkSync(stateFile, alias);

    expect(findProtectedAliases({ workingDir, folderRoot }).map((entry) => entry.path)).toContain(
      alias,
    );
  });

  it("巢狀目錄裡的 hardlink 也掃得到", () => {
    const { folderRoot, stateFile, workingDir } = makeFolder();
    const nested = join(workingDir, "a", "b", "c");
    mkdirSync(nested, { recursive: true });
    const alias = join(nested, "deep.json");
    linkSync(stateFile, alias);

    expect(findProtectedAliases({ workingDir, folderRoot }).map((entry) => entry.path)).toContain(
      alias,
    );
  });

  it("指向非 state 檔案的 hardlink 不算別名", () => {
    const { folderRoot, workingDir } = makeFolder();
    const source = join(workingDir, "source.json");
    writeFileSync(source, "{}");
    linkSync(source, join(workingDir, "source-alias.json"));

    expect(findProtectedAliases({ workingDir, folderRoot })).toEqual([]);
    expect(() => createMcpStdioSandbox({ folderRoot, serverId: "test-server" })).not.toThrow();
  });

  it("指向 state 正本的符號連結不算硬連結別名", () => {
    const { folderRoot, stateFile, workingDir } = makeFolder();
    symlinkSync(stateFile, join(workingDir, "symlink.json"));

    expect(findProtectedAliases({ workingDir, folderRoot })).toEqual([]);
  });
});

describe.skipIf(process.getuid?.() === 0)("掃描失敗時 fail-closed", () => {
  it("目錄讀不出來時丟 ProtectedAliasScanError", () => {
    const { folderRoot, workingDir } = makeFolder();
    const blocked = join(workingDir, "blocked");
    mkdirSync(blocked);
    writeFileSync(join(blocked, "x"), "x");
    chmodSync(blocked, 0o000);
    try {
      expect(() => findProtectedAliases({ workingDir, folderRoot })).toThrow(
        ProtectedAliasScanError,
      );
    } finally {
      chmodSync(blocked, 0o755);
    }
  });
});
