import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectCaseSensitivity } from "../../src/index.js";
import type { PermissionAction, PermissionRequest, PermissionVerdict } from "../../src/index.js";

export interface Fixture {
  /** realpath 之後的暫存根；macOS 的 `/var` 會變成 `/private/var`。 */
  readonly root: string;
  /** Cardiary 資料夾。 */
  readonly folder: string;
  /** 工作目錄（專案）。 */
  readonly project: string;
  /** 兩個根之外的目錄。 */
  readonly outside: string;
  /** 假的家目錄；`deny.self-modify` 與 `~` 的測試用。 */
  readonly home: string;
  /** 假的 App bundle 路徑。 */
  readonly appBundle: string;
  cleanup(): void;
}

export function makeFixture(): Fixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cardiary-perm-")));
  const folder = join(root, "Cardiary");
  const project = join(root, "project");
  const outside = join(root, "outside");
  const home = join(root, "home");
  const appBundle = join(root, "Applications", "Cardiary.app");
  for (const directory of [
    folder,
    join(folder, "cards"),
    join(folder, "assets"),
    join(folder, "state"),
    join(folder, "tmp"),
    join(folder, "cache"),
    project,
    join(project, "sub"),
    outside,
    home,
    appBundle,
  ]) {
    mkdirSync(directory, { recursive: true });
  }
  writeFileSync(join(folder, "state", "folder.json"), "{}");
  writeFileSync(join(folder, "state", "cardiary.sqlite"), "db");
  writeFileSync(join(project, "notes.md"), "notes");
  writeFileSync(join(project, "hard-source.md"), "hard");
  writeFileSync(join(outside, "secret"), "secret");
  return {
    root,
    folder,
    project,
    outside,
    home,
    appBundle,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** 建立符號連結；回傳連結路徑。 */
export function makeSymlink(target: string, linkPath: string): string {
  symlinkSync(target, linkPath);
  return linkPath;
}

/** 建立硬連結；回傳新路徑。 */
export function makeHardLink(existing: string, linkPath: string): string {
  linkSync(existing, linkPath);
  return linkPath;
}

export function request(
  action: PermissionAction,
  roots: { readonly project: string; readonly folder: string },
  call: Partial<PermissionRequest["call"]> = {},
): PermissionRequest {
  return {
    action,
    workingDir: roots.project,
    folderRoot: roots.folder,
    call: {
      sessionId: "s1",
      turnId: "t1",
      scope: "main",
      subagentDepth: 0,
      ...call,
    },
  };
}

/** 表格測試的期望值。 */
export type Expected =
  | { readonly kind: "allow"; readonly rule: string }
  | { readonly kind: "deny"; readonly rule: string }
  | { readonly kind: "ask-human"; readonly risk: "low" | "medium" | "high" };

export function expectVerdict(verdict: PermissionVerdict, expected: Expected): void {
  if (verdict.kind !== expected.kind) {
    throw new Error(`預期 ${expected.kind}，得到 ${verdict.kind}：${JSON.stringify(verdict)}`);
  }
  if (verdict.kind === "allow") {
    if (verdict.rule !== (expected as { rule: string }).rule) {
      throw new Error(`預期規則 ${(expected as { rule: string }).rule}，得到 ${verdict.rule}`);
    }
    return;
  }
  if (verdict.kind === "deny") {
    if (verdict.rule !== (expected as { rule: string }).rule) {
      throw new Error(`預期規則 ${(expected as { rule: string }).rule}，得到 ${verdict.rule}`);
    }
    return;
  }
  const risk = (expected as { risk: string }).risk;
  if (verdict.risk !== risk) {
    throw new Error(`預期風險 ${risk}，得到 ${verdict.risk}（${verdict.rule}）`);
  }
}

/**
 * 找出與 `target` 同一個卷、探測結果是 `unknown` 的掛載點。
 *
 * 用來重現「先探測掛載點、再寫 TMP/」的快取污染：掛載點本身翻不出掛載點之後
 * 的元件，敏感度只能是 unknown。找不到就回 null，呼叫端跳過該測試。
 */
export function mountPointOnSameVolume(target: string): string | null {
  const targetDev = statSync(target).dev;
  // 由「最可能先被探測到、而且一定是 unknown」的根開始：根目錄沒有掛載點
  // 之後的元件可翻，探測結果只能是 unknown。
  const candidates = [
    "/",
    "/System/Volumes/Data",
    "/Volumes",
    "/private/var",
    "/tmp",
    "/dev",
    "/sys",
    "/proc",
  ];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).dev !== targetDev) {
        continue;
      }
      if (detectCaseSensitivity(candidate) === "unknown") {
        return candidate;
      }
    } catch {
      continue;
    }
  }
  return null;
}
