import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  detectCaseSensitivity,
  evaluateWritePath,
  isHumanSettingsPath,
  isSystemPath,
  isWithin,
  isWithinFolded,
  resolvePath,
} from "../../src/permissions/index.js";
import { makeFixture, makeHardLink, makeSymlink, type Fixture } from "./support.js";

const fixture: Fixture = makeFixture();
const roots = { workingDir: fixture.project, folderRoot: fixture.folder };
const fsContext = {
  folderRoot: fixture.folder,
  homeDir: fixture.home,
  appBundlePath: fixture.appBundle,
};
const volumeIsCaseInsensitive = detectCaseSensitivity(fixture.root) === "case-insensitive";

afterAll(() => fixture.cleanup());

function resolve(input: string) {
  const resolution = resolvePath(input, roots);
  if (!resolution.ok) {
    throw new Error(`預期解析成功，得到 ${resolution.rule}：${resolution.reason}`);
  }
  return resolution.path;
}

describe("路徑正規化", () => {
  it("相對路徑以工作目錄為基準", () => {
    const path = resolve("notes.md");
    expect(path.resolved).toBe(join(fixture.project, "notes.md"));
    expect(path.classification).toBe("workspace");
    expect(path.insideWorkingDir).toBe(true);
  });

  it("含 .. 但解析後仍在根之內", () => {
    const path = resolve("sub/../notes.md");
    expect(path.resolved).toBe(join(fixture.project, "notes.md"));
    expect(path.classification).toBe("workspace");
    expect(path.changed).toBe(false);
  });

  it("含 .. 且解析後離開根：依解析後的位置分類", () => {
    const path = resolve("../outside/secret");
    expect(path.resolved).toBe(join(fixture.outside, "secret"));
    expect(path.classification).toBe("external");
    expect(path.changed).toBe(false);
  });

  it("資料夾之內的路径分類成 folder", () => {
    const path = resolve(join(fixture.folder, "cards"));
    expect(path.classification).toBe("folder");
    expect(path.insideFolderRoot).toBe(true);
    expect(path.insideWorkingDir).toBe(false);
  });

  it("系統目錄分類成 system", () => {
    expect(resolve("/usr/local/bin").classification).toBe("system");
    expect(resolve("/etc/hosts").classification).toBe("system");
    // fixture.root 已經過 realpath（macOS 的 /var 會變成 /private/var），
    // 所以解析結果應與 fixture.root 相同，與暫存目錄所在平台無關。
    const temporary = resolve(fixture.root);
    expect(temporary.resolved).toBe(fixture.root);
    expect(temporary.classification).toBe("external");
    // 只有 tmpdir 真的落在 /var/folders 底下時，才驗證 /var → /private/var 的前綴。
    if (realpathSync(tmpdir()).startsWith("/private/var/folders/")) {
      expect(temporary.resolved.startsWith("/private/var/folders/")).toBe(true);
    }
  });

  it("目標不存在時，解析父目錄後接上檔名", () => {
    const path = resolve("sub/new.md");
    expect(path.resolved).toBe(join(fixture.project, "sub", "new.md"));
    expect(path.exists).toBe(false);
    expect(path.classification).toBe("workspace");
  });

  it("符號連結指向根之外：解析後的位置是 external，且記下 changed", () => {
    makeSymlink(fixture.outside, join(fixture.project, "link-out"));
    const path = resolve("link-out/secret");
    expect(path.resolved).toBe(join(fixture.outside, "secret"));
    expect(path.classification).toBe("external");
    expect(path.changed).toBe(true);
  });

  it("寫入的目標本身是符號連結時標成 isSymlink", () => {
    makeSymlink(join(fixture.outside, "secret"), join(fixture.project, "link-file"));
    const path = resolve("link-file");
    expect(path.isSymlink).toBe(true);
    // 讀取依解析後的位置分類。
    expect(path.resolved).toBe(join(fixture.outside, "secret"));
    expect(path.classification).toBe("external");
  });

  it("硬連結的 nlink 大於 1", () => {
    makeHardLink(join(fixture.project, "notes.md"), join(fixture.project, "notes-hard.md"));
    expect(resolve("notes.md").hardLinkCount).toBe(2);
  });

  it("`~` 不展開：留在工作目錄底下", () => {
    const path = resolve("~/.ssh/id_rsa");
    expect(path.resolved).toBe(join(fixture.project, "~", ".ssh", "id_rsa"));
    expect(path.classification).toBe("workspace");
  });

  it("大小寫不同的路徑不折疊：isWithin 仍以實際寫法比較", () => {
    // APFS 預設大小寫不敏感：realpath 保留輸入的寫法，字串比較不折疊。
    const path = resolve("NOTES.md");
    expect(path.resolved).toBe(join(fixture.project, "NOTES.md"));
    expect(isWithin("/Users/Example", "/Users/example/x")).toBe(false);
  });

  it("保護目標在大小寫不敏感的卷上以折疊比對", () => {
    expect(isWithinFolded("/Users/Example", "/users/example/x")).toBe(true);
    expect(isSystemPath("/System/Library/x", "case-sensitive")).toBe(true);
    expect(isSystemPath("/SYSTEM/Library/x", "case-sensitive")).toBe(false);
    expect(isSystemPath("/SYSTEM/Library/x", "case-insensitive")).toBe(true);
    // `/var/folders` 是暫存區例外，大小寫變體也不能算系統目錄。
    expect(isSystemPath("/VAR/FOLDERS/xy", "case-insensitive")).toBe(false);
  });

  it("狀態資料庫的大小寫變體是保護目標，狀態庫之外的同名檔不是", () => {
    expect(
      isHumanSettingsPath(
        join(fixture.folder, "STATE", "CARDIARY.SQLITE"),
        fixture.folder,
        "case-insensitive",
      ),
    ).toBe(true);
    expect(
      isHumanSettingsPath(
        join(fixture.folder, "state", "folder.json"),
        fixture.folder,
        "case-sensitive",
      ),
    ).toBe(true);
    expect(
      isHumanSettingsPath(
        join(fixture.project, "CARDIARY.SQLITE"),
        fixture.folder,
        "case-sensitive",
      ),
    ).toBe(false);
    expect(
      isHumanSettingsPath(
        join(fixture.folder, "cards", "a.md"),
        fixture.folder,
        "case-insensitive",
      ),
    ).toBe(false);
  });

  it("同一個 inode 的硬連結也是保護目標", () => {
    const alias = join(fixture.outside, "db-alias");
    makeHardLink(join(fixture.folder, "state", "cardiary.sqlite"), alias);
    expect(isHumanSettingsPath(alias, fixture.folder)).toBe(true);
  });

  it("TMP/ 依字串比較不自動折疊成 tmp/；折疊由敏感度決定", () => {
    // 大小寫敏感的卷上 `TMP/` 是另一個目錄，isWithin 不能折疊；
    // 折疊比對只給大小寫不敏感或未知的卷用。
    expect(isWithin("/f/tmp", "/f/TMP/x")).toBe(false);
    expect(isWithin("/f/tmp", "/f/tmp/x")).toBe(true);
    expect(isWithinFolded("/f/tmp", "/f/TMP/x")).toBe(true);
  });

  it.runIf(volumeIsCaseInsensitive)(
    "大小寫不敏感卷上，STATE/cardiary.sqlite 的寫入是 deny.human-settings",
    () => {
      const variant = resolve(join(fixture.folder, "STATE", "CARDIARY.SQLITE"));
      const verdict = evaluateWritePath(variant, fsContext, "write");
      expect(verdict.kind).toBe("deny");
      if (verdict.kind === "deny") {
        expect(verdict.rule).toBe("deny.human-settings");
      }
    },
  );

  it.runIf(volumeIsCaseInsensitive)(
    "大小寫不敏感的卷上，/SYSTEM 的寫入是 deny.system-write",
    () => {
      const variant = resolve("/SYSTEM/Library/Preferences/x.plist");
      const verdict = evaluateWritePath(variant, fsContext, "write");
      expect(verdict.kind).toBe("deny");
      if (verdict.kind === "deny") {
        expect(verdict.rule).toBe("deny.system-write");
      }
    },
  );

  it.each([
    ["空字串", ""],
    ["NUL", "a\0b"],
    ["Windows 磁碟代號", "C:\\Windows\\System32"],
    ["超過 4,096 bytes", `a/${"x".repeat(5000)}`],
  ])("拒絕不合法的路徑：%s", (_label, input) => {
    const resolution = resolvePath(input, roots);
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.rule).toBe("deny.invalid-path");
    }
  });

  it("符號連結迴圈回 deny.invalid-path", () => {
    makeSymlink(join(fixture.project, "loop-b"), join(fixture.project, "loop-a"));
    makeSymlink(join(fixture.project, "loop-a"), join(fixture.project, "loop-b"));
    const resolution = resolvePath("loop-a", roots);
    expect(resolution.ok).toBe(false);
  });
});
