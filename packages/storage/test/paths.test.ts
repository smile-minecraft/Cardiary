import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createTempRoot } from "./helpers/temp.js";
import {
  FolderLayout,
  MAX_RELATIVE_PATH_BYTES,
  zoneForRelativePath,
  StorageError,
  readFileNoFollow,
  removeFileSafely,
  removeTreeSafely,
  validateRelativePath,
} from "../src/index.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

function fixture(): { root: string; layout: FolderLayout } {
  const temp = createTempRoot("paths");
  cleanups.push(temp.cleanup);
  for (const name of ["cards", "cache", "tmp", "logs", "state"]) {
    mkdirSync(path.join(temp.folder, name), { recursive: true });
  }
  return { root: temp.folder, layout: new FolderLayout(temp.folder) };
}

describe("相對路徑規則", () => {
  it("拒絕絕對路徑、~、反斜線、空字串、. 與 .. 段、Windows 磁碟代號、NUL", () => {
    const invalid = [
      "",
      "/etc/passwd",
      "~/secret",
      "a/../b",
      "./a",
      "a//b",
      ".",
      "..",
      "C:\\Windows",
      "a\\b",
      "a\0b",
      "cache/../../outside",
    ];
    for (const input of invalid) {
      expect(() => validateRelativePath(input), input).toThrowError(StorageError);
    }
  });

  it("原型名稱不能當成九個子資料夾之一", () => {
    expect(() => validateRelativePath("__proto__/x")).not.toThrow();
    const temp = createTempRoot("paths-proto");
    cleanups.push(temp.cleanup);
    const layout = new FolderLayout(temp.folder);
    for (const first of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(() => layout.absolute(`${first}/x`), first).toThrowError(/九個子資料夾/);
      expect(() => removeFileSafely(layout, layout.absolute(`cache/${first}`))).not.toThrow();
    }
    expect(zoneForRelativePath("__proto__/x")).toBeNull();
    expect(zoneForRelativePath("constructor")).toBeNull();
  });

  it("拒絕超過 1024 bytes 的路徑", () => {
    const long = `cache/${"a".repeat(MAX_RELATIVE_PATH_BYTES)}`;
    expect(() => validateRelativePath(long)).toThrowError(/1024/);
  });

  it("把分解形式的 Unicode 正規化成 NFC", () => {
    expect(validateRelativePath("cache/e\u0301.txt")).toBe("cache/\u00e9.txt");
  });
});

describe("根資料夾與刪除範圍", () => {
  it("拒絕空字串與檔案系統根目錄", () => {
    expect(() => new FolderLayout("")).toThrowError(/空字串/);
    expect(() => new FolderLayout("/")).toThrowError(/根目錄/);
  });

  it("正本區的路徑不可刪除", () => {
    const { layout } = fixture();
    writeFileSync(layout.absolute("cards/card.md"), "x");
    expect(() => removeFileSafely(layout, layout.absolute("cards/card.md"))).toThrowError(
      /允許刪除/,
    );
    expect(existsSync(layout.absolute("cards/card.md"))).toBe(true);
  });

  it("根資料夾以外與根資料夾本身都不會成為刪除目標", () => {
    const { layout } = fixture();
    expect(() => layout.assertDeletable("/etc/hosts")).toThrowError(StorageError);
    expect(() => layout.assertDeletable(layout.root)).toThrowError(/根資料夾/);
  });

  it("路徑穿越解析後仍在根內也不允許離開區域", () => {
    const { root, layout } = fixture();
    const outside = path.join(path.dirname(root), "outside.txt");
    writeFileSync(outside, "keep");
    cleanups.push(() => {
      try {
        rmSync(outside, { force: true });
      } catch {
        // 已不存在。
      }
    });
    const viaTraversal = path.join(root, "cache", "..", "..", "outside.txt");
    expect(() => removeFileSafely(layout, viaTraversal)).toThrowError(StorageError);
    expect(readFileSync(outside, "utf8")).toBe("keep");
  });
});

describe("符號連結與硬連結", () => {
  it("指向區外的符號連結只刪連結本身，目標不動", () => {
    const { root, layout } = fixture();
    const outside = path.join(path.dirname(root), "outside-link-target.txt");
    writeFileSync(outside, "target");
    cleanups.push(() => {
      try {
        rmSync(outside, { force: true });
      } catch {
        // 已不存在。
      }
    });
    const link = layout.absolute("cache/evil-link");
    symlinkSync(outside, link);
    const result = removeFileSafely(layout, link);
    expect(result.removed).toBe(true);
    expect(result.reason).toBe("symlink");
    expect(existsSync(link)).toBe(false);
    expect(readFileSync(outside, "utf8")).toBe("target");
  });

  it("硬連結不刪，避免刪到資料夾外的同一份資料", () => {
    const { root, layout } = fixture();
    const outside = path.join(path.dirname(root), "hardlink-target.txt");
    writeFileSync(outside, "same inode");
    cleanups.push(() => {
      try {
        rmSync(outside, { force: true });
      } catch {
        // 已不存在。
      }
    });
    const inside = layout.absolute("cache/hardlink");
    linkSync(outside, inside);
    const result = removeFileSafely(layout, inside);
    expect(result.removed).toBe(false);
    expect(result.reason).toBe("hard-link");
    expect(existsSync(inside)).toBe(true);
    expect(readFileSync(outside, "utf8")).toBe("same inode");
  });

  it("O_NOFOLLOW 讀檔時直接拒絕符號連結", () => {
    const { root, layout } = fixture();
    const outside = path.join(path.dirname(root), "nofollow-target.txt");
    writeFileSync(outside, "secret");
    cleanups.push(() => {
      try {
        rmSync(outside, { force: true });
      } catch {
        // 已不存在。
      }
    });
    const link = layout.absolute("cache/read-link");
    symlinkSync(outside, link);
    expect(() => readFileNoFollow(layout, link)).toThrow();
  });

  it("上層目錄是符號連結時，不刪除區外的檔案", () => {
    const { root, layout } = fixture();
    const outsideDir = path.join(path.dirname(root), "outside-parent");
    mkdirSync(outsideDir);
    writeFileSync(path.join(outsideDir, "victim.txt"), "keep");
    cleanups.push(() => {
      try {
        rmSync(outsideDir, { recursive: true, force: true });
      } catch {
        // 已不存在。
      }
    });
    symlinkSync(outsideDir, layout.absolute("cache/parent-link"));
    const insidePath = layout.absolute("cache/parent-link/victim.txt");
    expect(() => removeFileSafely(layout, insidePath)).toThrowError(/符號連結|符號/);
    expect(readFileSync(path.join(outsideDir, "victim.txt"), "utf8")).toBe("keep");
  });

  it("目錄符號連結整棵跳過，不跟隨", () => {
    const { root, layout } = fixture();
    const outsideDir = path.join(path.dirname(root), "outside-dir");
    mkdirSync(outsideDir);
    writeFileSync(path.join(outsideDir, "keep.txt"), "keep");
    cleanups.push(() => {
      try {
        rmSync(outsideDir, { recursive: true, force: true });
      } catch {
        // 已不存在。
      }
    });
    symlinkSync(outsideDir, layout.absolute("cache/dirlink"));
    const report = removeTreeSafely(layout, layout.absolute("cache"));
    expect(report.removedLinks).toBe(1);
    expect(existsSync(layout.absolute("cache/dirlink"))).toBe(false);
    expect(readFileSync(path.join(outsideDir, "keep.txt"), "utf8")).toBe("keep");
  });
});
