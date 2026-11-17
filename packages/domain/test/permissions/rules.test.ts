import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  detectCaseSensitivity,
  evaluatePermission,
  isHumanSettingsPath,
  isWithinTmpRoot,
} from "../../src/permissions/index.js";
import type { EvaluateContext } from "../../src/permissions/index.js";
import {
  expectVerdict,
  makeFixture,
  makeHardLink,
  makeSymlink,
  request,
  type Fixture,
} from "./support.js";

const fixture: Fixture = makeFixture();
const roots = { project: fixture.project, folder: fixture.folder };
const context: EvaluateContext = {
  homeDir: fixture.home,
  appBundlePath: fixture.appBundle,
};

beforeAll(() => {
  makeSymlink(join(fixture.outside, "secret"), join(fixture.project, "link-file"));
  makeSymlink(fixture.outside, join(fixture.project, "link-out"));
  makeHardLink(join(fixture.project, "hard-source.md"), join(fixture.project, "notes-hard.md"));
});

afterAll(() => fixture.cleanup());

function evaluate(
  action: Parameters<typeof request>[0],
  evaluateContext: EvaluateContext = context,
) {
  return evaluatePermission(request(action, roots), evaluateContext);
}

describe("自動放行", () => {
  it.each([
    ["fs.read 工作目錄", { kind: "fs.read", path: join(fixture.project, "notes.md") }],
    ["fs.read 資料夾的卡片", { kind: "fs.read", path: join(fixture.folder, "cards", "a.md") }],
    ["fs.list 工作目錄", { kind: "fs.list", path: join(fixture.project, "sub") }],
    ["fs.list 資料夾的卡片", { kind: "fs.list", path: join(fixture.folder, "cards") }],
  ] as const)("%s", (_label, action) => {
    expectVerdict(evaluate(action), { kind: "allow", rule: "fs.read-workspace" });
  });

  it("tmp 的寫入與刪除用 fs.tmp-write", () => {
    expectVerdict(
      evaluate({ kind: "fs.write", path: join(fixture.folder, "tmp", "x"), mode: "create" }),
      { kind: "allow", rule: "fs.tmp-write" },
    );
    expectVerdict(
      evaluate({ kind: "fs.delete", path: join(fixture.folder, "tmp", "x"), recursive: false }),
      { kind: "allow", rule: "fs.tmp-write" },
    );
  });

  it("state/folder.json 只讀放行，其他 state 檔案詢問", () => {
    expectVerdict(
      evaluate({ kind: "fs.read", path: join(fixture.folder, "state", "folder.json") }),
      {
        kind: "allow",
        rule: "plan.read",
      },
    );
    expectVerdict(
      evaluate({ kind: "fs.read", path: join(fixture.folder, "state", "cardiary.sqlite") }),
      { kind: "ask-human", risk: "medium" },
    );
    expectVerdict(evaluate({ kind: "fs.list", path: join(fixture.folder, "state") }), {
      kind: "ask-human",
      risk: "medium",
    });
  });

  it("卡片的搜尋、建立、刷新與翻牌放行", () => {
    expectVerdict(evaluate({ kind: "cards.read", query: "卡片" }), {
      kind: "allow",
      rule: "cards.read",
    });
    expectVerdict(evaluate({ kind: "cards.create", cardKind: "note" }), {
      kind: "allow",
      rule: "cards.create",
    });
    expectVerdict(evaluate({ kind: "cards.refresh", cardId: "c1" }), {
      kind: "allow",
      rule: "cards.refresh",
    });
    expectVerdict(evaluate({ kind: "cards.flip", cardId: "c1" }), {
      kind: "allow",
      rule: "cards.flip",
    });
  });
});

describe("永遠禁止", () => {
  it.each([
    ["讀 .env", { kind: "fs.read", path: join(fixture.project, ".env") }, "deny.credentials"],
    ["讀 ~/.ssh", { kind: "fs.read", path: "~/.ssh/id_ed25519" }, "deny.credentials"],
    [
      "讀 .aws/credentials",
      { kind: "fs.read", path: `${fixture.home}/.aws/credentials` },
      "deny.credentials",
    ],
    [
      "寫 /etc/hosts",
      { kind: "fs.write", path: "/etc/hosts", mode: "replace" },
      "deny.system-write",
    ],
    [
      "寫 /usr/local/bin/x",
      { kind: "fs.write", path: "/usr/local/bin/x", mode: "create" },
      "deny.system-write",
    ],
    [
      "刪 /Library 的東西",
      { kind: "fs.delete", path: "/Library/Preferences/x.plist", recursive: false },
      "deny.system-write",
    ],
    [
      "寫狀態資料庫",
      { kind: "fs.write", path: join(fixture.folder, "state", "cardiary.sqlite"), mode: "replace" },
      "deny.human-settings",
    ],
    [
      "寫 MCP 伺服器設定",
      {
        kind: "fs.write",
        path: join(fixture.folder, "state", "mcp-servers.json"),
        mode: "replace",
      },
      "deny.human-settings",
    ],
    [
      "刪 MCP 伺服器設定",
      {
        kind: "fs.delete",
        path: join(fixture.folder, "state", "mcp-servers.json"),
        recursive: false,
      },
      "deny.human-settings",
    ],
    [
      "寫外部代理權杖",
      {
        kind: "fs.write",
        path: join(fixture.folder, "state", "external-agent-credentials.json"),
        mode: "replace",
      },
      "deny.human-settings",
    ],
    [
      "刪外部代理權杖",
      {
        kind: "fs.delete",
        path: join(fixture.folder, "state", "external-agent-credentials.json"),
        recursive: false,
      },
      "deny.human-settings",
    ],
    [
      "寫 App bundle",
      {
        kind: "fs.write",
        path: join(fixture.appBundle, "Contents", "MacOS", "Cardiary"),
        mode: "replace",
      },
      "deny.self-modify",
    ],
    [
      "寫服務資料",
      {
        kind: "fs.write",
        path: join(fixture.home, "Library", "Application Support", "com.cardiary", "x"),
        mode: "create",
      },
      "deny.self-modify",
    ],
    [
      "刪正本區根",
      { kind: "fs.delete", path: join(fixture.folder, "cards"), recursive: true },
      "deny.zone-bulk-delete",
    ],
    [
      "遞迴刪正本區子路徑",
      { kind: "fs.delete", path: join(fixture.folder, "cards", "a.md"), recursive: true },
      "deny.zone-bulk-delete",
    ],
    [
      "刪資料夾根",
      { kind: "fs.delete", path: fixture.folder, recursive: true },
      "deny.zone-bulk-delete",
    ],
    [
      "寫符號連結",
      { kind: "fs.write", path: join(fixture.project, "link-file"), mode: "replace" },
      "deny.symlink-write",
    ],
    [
      "經符號連結目錄寫到根之外",
      { kind: "fs.write", path: join(fixture.project, "link-out", "new.txt"), mode: "create" },
      "deny.symlink-write",
    ],
    [
      "資料夾根的 rm -rf cards",
      { kind: "shell.exec", command: "rm -rf cards", cwd: fixture.folder },
      "deny.zone-bulk-delete",
    ],
    [
      "改 human-only 設定",
      { kind: "settings.change", key: "permissions.mode", level: "human-only" },
      "deny.human-settings",
    ],
    [
      "security 指令",
      { kind: "shell.exec", command: "security find-generic-password -w", cwd: fixture.project },
      "deny.keychain-cli",
    ],
    [
      "sudo",
      { kind: "shell.exec", command: "sudo rm -rf /", cwd: fixture.project },
      "deny.escalation",
    ],
    [
      "chmod setuid",
      { kind: "shell.exec", command: "chmod u+s ./tool", cwd: fixture.project },
      "deny.escalation",
    ],
    [
      "osascript 提權",
      {
        kind: "shell.exec",
        command: `osascript -e 'do shell script "x" with administrator privileges'`,
        cwd: fixture.project,
      },
      "deny.escalation",
    ],
    [
      "diskutil 抹除",
      { kind: "shell.exec", command: "diskutil eraseDisk JHFS+ X disk2", cwd: fixture.project },
      "deny.disk-destroy",
    ],
    [
      "dd 寫裝置",
      { kind: "shell.exec", command: "dd if=/dev/zero of=/dev/disk2", cwd: fixture.project },
      "deny.disk-destroy",
    ],
  ] as const)("%s → %s", (_label, action, rule) => {
    expectVerdict(evaluate(action), { kind: "deny", rule });
  });

  it("硬連結的寫入要人工確認", () => {
    expectVerdict(
      evaluate({ kind: "fs.write", path: join(fixture.project, "notes-hard.md"), mode: "replace" }),
      { kind: "ask-human", risk: "high" },
    );
    const verdict = evaluate({
      kind: "fs.delete",
      path: join(fixture.project, "notes-hard.md"),
      recursive: false,
    });
    expect(verdict.kind === "ask-human" && verdict.rule).toBe("fs.write-hardlink");
  });

  it("禁止項的原因會說明是哪一條規則", () => {
    const verdict = evaluate({ kind: "fs.read", path: join(fixture.project, ".env") });
    expect(verdict.kind).toBe("deny");
    if (verdict.kind === "deny") {
      expect(verdict.reason).toContain(".env");
    }
  });
});

describe("TMP/ 的折疊判定", () => {
  const volumeIsCaseInsensitiveHere = detectCaseSensitivity(fixture.folder) === "case-insensitive";

  it("只有已知的敏感度才把 tmp/ 當成放行邊界", () => {
    // 掛載點探測回 unknown 時，`TMP/` 與 `tmp/` 不能假定是同一個目錄：
    // 未知一律走一般的詢問，不能自動放行。
    const tmp = join(fixture.folder, "tmp", "x.md");
    const upper = join(fixture.folder, "TMP", "x.md");
    expect(isWithinTmpRoot(fixture.folder, tmp, "case-sensitive")).toBe(true);
    expect(isWithinTmpRoot(fixture.folder, tmp, "case-insensitive")).toBe(true);
    expect(isWithinTmpRoot(fixture.folder, tmp, "unknown")).toBe(false);
    expect(isWithinTmpRoot(fixture.folder, upper, "case-sensitive")).toBe(false);
    expect(isWithinTmpRoot(fixture.folder, upper, "case-insensitive")).toBe(true);
    expect(isWithinTmpRoot(fixture.folder, upper, "unknown")).toBe(false);
    expect(isWithinTmpRoot(fixture.folder, join(fixture.project, "tmp", "x"), "unknown")).toBe(
      false,
    );
  });

  it.runIf(volumeIsCaseInsensitiveHere)("大小寫不敏感卷上 TMP/ 折疊成 tmp/，寫入放行", () => {
    expectVerdict(
      evaluate({ kind: "fs.write", path: join(fixture.folder, "TMP", "x.md"), mode: "create" }),
      { kind: "allow", rule: "fs.tmp-write" },
    );
  });

  it.runIf(!volumeIsCaseInsensitiveHere)(
    "大小寫敏感（或未知）卷上 TMP/ 不是 tmp/，照一般 folder 詢問",
    () => {
      expectVerdict(
        evaluate({ kind: "fs.write", path: join(fixture.folder, "TMP", "x.md"), mode: "create" }),
        { kind: "ask-human", risk: "medium" },
      );
    },
  );
});

describe("大小寫不敏感卷的保護目標", () => {
  const volumeIsCaseInsensitive = detectCaseSensitivity(fixture.folder) === "case-insensitive";

  it.runIf(volumeIsCaseInsensitive)("大小寫變體的狀態資料庫仍然是 deny.human-settings", () => {
    expectVerdict(
      evaluate({
        kind: "fs.write",
        path: join(fixture.folder, "STATE", "CARDIARY.SQLITE"),
        mode: "replace",
      }),
      { kind: "deny", rule: "deny.human-settings" },
    );
    expectVerdict(
      evaluate({
        kind: "fs.delete",
        path: join(fixture.folder, "State", "Cardiary.Sqlite-Wal"),
        recursive: false,
      }),
      { kind: "deny", rule: "deny.human-settings" },
    );
    expectVerdict(
      evaluate({
        kind: "fs.write",
        path: join(fixture.folder, "STATE", "FOLDER.JSON"),
        mode: "replace",
      }),
      { kind: "deny", rule: "deny.human-settings" },
    );
    expectVerdict(
      evaluate({
        kind: "fs.write",
        path: join(fixture.folder, "State", "MCP-Servers.Json"),
        mode: "replace",
      }),
      { kind: "deny", rule: "deny.human-settings" },
    );
  });

  it.runIf(volumeIsCaseInsensitive)("大小寫變體的系統目錄仍然是 deny.system-write", () => {
    expectVerdict(evaluate({ kind: "fs.write", path: "/SYSTEM/Library/x", mode: "create" }), {
      kind: "deny",
      rule: "deny.system-write",
    });
    expectVerdict(evaluate({ kind: "fs.delete", path: "/USR/LOCAL/BIN/x", recursive: false }), {
      kind: "deny",
      rule: "deny.system-write",
    });
  });

  it.runIf(volumeIsCaseInsensitive)("大小寫變體的 App bundle 仍然是 deny.self-modify", () => {
    const bundle = fixture.appBundle.toUpperCase();
    expectVerdict(
      evaluate({
        kind: "fs.write",
        path: join(bundle, "Contents", "MacOS", "Cardiary"),
        mode: "replace",
      }),
      { kind: "deny", rule: "deny.self-modify" },
    );
  });

  it.runIf(volumeIsCaseInsensitive)("大小寫變體的正本區根仍然是 deny.zone-bulk-delete", () => {
    expectVerdict(
      evaluate({ kind: "fs.delete", path: join(fixture.folder, "CARDS"), recursive: true }),
      { kind: "deny", rule: "deny.zone-bulk-delete" },
    );
    expectVerdict(evaluate({ kind: "shell.exec", command: "rm -rf CARDS", cwd: fixture.folder }), {
      kind: "deny",
      rule: "deny.zone-bulk-delete",
    });
  });

  it("大小寫敏感的一般路徑不影響分類", () => {
    // 大小寫敏感時，`STATE` 是另一個目錄，不是狀態庫；不能當成保護目標。
    const action = {
      kind: "fs.write",
      path: join(fixture.folder, "STATE", "CARDIARY.SQLITE"),
      mode: "replace",
    } as const;
    if (volumeIsCaseInsensitive) {
      // 大小寫不敏感時是同一個檔案，一律拒絕。
      expectVerdict(evaluate(action), { kind: "deny", rule: "deny.human-settings" });
      return;
    }
    // 大小寫敏感時是資料夾之內的另一個目錄，照一般 folder 路徑詢問（medium）。
    expectVerdict(evaluate(action), { kind: "ask-human", risk: "medium" });
  });

  it("注入 caseSensitive 的保護目標判定（不依賴測試機的卷）", () => {
    // 大小寫敏感：`STATE` 不是狀態庫；用不存在的目錄比對，避免同一 inode 比對干擾。
    const otherDir = join(fixture.outside, "STATE", "CARDIARY.SQLITE");
    expect(isHumanSettingsPath(otherDir, fixture.folder, "case-sensitive")).toBe(false);
    // 大小寫敏感：資料夾之內另一個不存在的 STATE 目錄也不是保護目標。
    const missing = join(fixture.folder, "STATE", "NOPE.SQLITE");
    expect(isHumanSettingsPath(missing, fixture.folder, "case-sensitive")).toBe(false);
    // 大小寫不敏感：折疊比對命中狀態庫（純字串，存在與否不影響）。
    const folded = join(fixture.folder, "STATE", "CARDIARY.SQLITE");
    expect(isHumanSettingsPath(folded, fixture.folder, "case-insensitive")).toBe(true);
    expect(isHumanSettingsPath(folded, fixture.folder, "unknown")).toBe(true);
    // 精確的狀態庫路徑兩種卷上都是保護目標。
    const exact = join(fixture.folder, "state", "cardiary.sqlite");
    expect(isHumanSettingsPath(exact, fixture.folder, "case-sensitive")).toBe(true);
    expect(isHumanSettingsPath(exact, fixture.folder, "case-insensitive")).toBe(true);
    // MCP 伺服器設定也是保護目標：兩種卷、大小寫變體都命中。
    const mcp = join(fixture.folder, "state", "mcp-servers.json");
    expect(isHumanSettingsPath(mcp, fixture.folder, "case-sensitive")).toBe(true);
    expect(isHumanSettingsPath(mcp, fixture.folder, "case-insensitive")).toBe(true);
    expect(
      isHumanSettingsPath(
        join(fixture.folder, "STATE", "MCP-SERVERS.JSON"),
        fixture.folder,
        "case-insensitive",
      ),
    ).toBe(true);
    expect(
      isHumanSettingsPath(
        join(fixture.folder, "STATE", "MCP-SERVERS.JSON"),
        fixture.folder,
        "case-sensitive",
      ),
    ).toBe(false);
  });
});

describe("一律詢問", () => {
  it.each([
    [
      "工作目錄的寫入",
      { kind: "fs.write", path: join(fixture.project, "new.md"), mode: "create" },
      "medium",
    ],
    [
      "資料夾的寫入（非 tmp）",
      { kind: "fs.write", path: join(fixture.folder, "cards", "a.md"), mode: "replace" },
      "medium",
    ],
    [
      "工作目錄的刪除",
      { kind: "fs.delete", path: join(fixture.project, "notes.md"), recursive: false },
      "medium",
    ],
    ["系統檔案的讀取", { kind: "fs.read", path: "/etc/hosts" }, "medium"],
    ["外部的讀取", { kind: "fs.read", path: join(fixture.outside, "secret") }, "low"],
    ["外部的寫入", { kind: "fs.write", path: join(fixture.outside, "x"), mode: "create" }, "high"],
    [
      "非唯讀查詢的指令",
      { kind: "shell.exec", command: "npm install", cwd: fixture.project },
      "high",
    ],
    [
      "工作目錄的 rm",
      { kind: "shell.exec", command: "rm notes.md", cwd: fixture.project },
      "medium",
    ],
    ["卡片編修", { kind: "cards.patch", cardId: "c1" }, "medium"],
    ["卡片刪除", { kind: "cards.delete", cardId: "c1" }, "medium"],
    ["網路", { kind: "network.outbound", host: "example.com", port: 443, scheme: "https" }, "high"],
    ["MCP", { kind: "mcp.call", serverId: "s", toolName: "t" }, "high"],
    ["外部代理", { kind: "external-agent.dispatch", agent: "a", command: "x" }, "high"],
    ["需審批的設定", { kind: "settings.change", key: "models.main", level: "approval" }, "medium"],
  ] as const)("%s → %s", (_label, action, risk) => {
    expectVerdict(evaluate(action), { kind: "ask-human", risk });
  });

  it("可自由調整的設定直接放行", () => {
    expectVerdict(evaluate({ kind: "settings.change", key: "appearance.theme", level: "free" }), {
      kind: "allow",
      rule: "settings.free",
    });
  });

  it("唯讀查詢在根之外的 cwd 仍然詢問", () => {
    expectVerdict(evaluate({ kind: "shell.exec", command: "git status", cwd: fixture.outside }), {
      kind: "ask-human",
      risk: "high",
    });
  });
});
