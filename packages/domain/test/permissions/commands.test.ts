import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  evaluateShellCommand,
  parseCommandLine,
  type ShellContext,
} from "../../src/permissions/index.js";
import { makeFixture, type Fixture } from "./support.js";

const fixture: Fixture = makeFixture();
const context: ShellContext = {
  workingDir: fixture.project,
  folderRoot: fixture.folder,
  homeDir: fixture.home,
  appBundlePath: fixture.appBundle,
};

afterAll(() => fixture.cleanup());

describe("指令解析", () => {
  it("切段並記錄控制字元", () => {
    const parsed = parseCommandLine("git status && git diff | head -5");
    expect(parsed.parseError).toBeNull();
    expect(parsed.segments.map((segment) => segment.command)).toEqual(["git", "git", "head"]);
    expect(parsed.operators).toEqual(["&&", "|"]);
  });

  it("跳過前面的環境變數指派", () => {
    const parsed = parseCommandLine("FOO=bar BAZ=1 git status");
    expect(parsed.segments[0]?.assignments).toEqual(["FOO=bar", "BAZ=1"]);
    expect(parsed.segments[0]?.command).toBe("git");
    expect(parsed.segments[0]?.args).toEqual(["status"]);
  });

  it("絕對路徑的命令取 basename", () => {
    expect(parseCommandLine("/bin/rm notes.md").segments[0]?.command).toBe("rm");
  });

  it("引號內的空白留在同一個 token", () => {
    const parsed = parseCommandLine(`grep 'two words' notes.md`);
    expect(parsed.segments[0]?.args).toEqual(["two words", "notes.md"]);
  });

  it("重導向單獨記錄，不成為參數", () => {
    const parsed = parseCommandLine("ls > out.txt 2>&1");
    expect(parsed.segments[0]?.args).toEqual([]);
    expect(parsed.redirects).toEqual([
      { operator: ">", target: "out.txt" },
      { operator: ">", target: "&1" },
    ]);
  });

  it("子殼層與反引號的內層字串", () => {
    const parsed = parseCommandLine("echo $(cat .env) `id`");
    expect(parsed.substitutions).toEqual(["cat .env", "id"]);
  });

  it.each([
    "echo 'unterminated",
    'echo "unterminated',
    "echo $(unbalanced",
    "echo `unterminated",
    "ls >",
    "echo trailing\\",
  ])("解析失敗：%s", (command) => {
    expect(parseCommandLine(command).parseError).not.toBeNull();
  });
});

describe("唯讀版本控制文法", () => {
  it.each([
    ["git status", "allow"],
    ["git -C sub log --oneline -5", "allow"],
    ["git diff --stat", "allow"],
    ["git show HEAD", "allow"],
    ["git rev-parse HEAD", "allow"],
    ["git branch --show-current", "allow"],
    ["git tag --list", "allow"],
    ["git stash list", "allow"],
    ["git remote -v", "allow"],
    ["git --no-pager log -3", "allow"],
  ])("%s → %s", (command, expected) => {
    const shellContext = command.startsWith("__folder__ ")
      ? { ...context, workingDir: fixture.folder }
      : context;
    const actual = command.startsWith("__folder__ ")
      ? command.slice("__folder__ ".length)
      : command;
    expect(evaluateShellCommand(actual, shellContext).kind).toBe(expected);
  });

  it.each([
    ["git push", "ask-human"],
    ["__folder__ git status; rm -rf cards", "deny"],
    ["git status && curl http://x", "ask-human"],
    ["git -c alias.x='!sh' x", "ask-human"],
    ["git show --ext-diff HEAD", "ask-human"],
    ["git diff --output=out.txt", "ask-human"],
    ["git --git-dir=/tmp/x status", "ask-human"],
    ["git branch new-branch", "ask-human"],
    ["git tag v1", "ask-human"],
    ["git stash push", "ask-human"],
    ["git remote add origin http://x", "ask-human"],
    ["git -C /etc log", "ask-human"],
    ["git status > /etc/hosts", "deny"],
  ])("%s → %s", (command, expected) => {
    const shellContext = command.startsWith("__folder__ ")
      ? { ...context, workingDir: fixture.folder }
      : context;
    const actual = command.startsWith("__folder__ ")
      ? command.slice("__folder__ ".length)
      : command;
    expect(evaluateShellCommand(actual, shellContext).kind).toBe(expected);
  });
});

describe("環境變數指派不得零審批執行", () => {
  const marker = `${join(fixture.project, "tmp")}/y.sh`;

  it.each([
    // 實際重現字串：git 的 fsmonitor 設定可以指定任意程式。
    [
      `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.fsmonitor GIT_CONFIG_VALUE_0='sh ${marker}' git status`,
    ],
    ["GIT_CONFIG_PARAMETERS='core.fsmonitor=sh y.sh' git status"],
    ["GIT_CONFIG_KEY_0=core.fsmonitor git status"],
    ["GIT_DIR=/tmp/other git status"],
    ["GIT_SSH_COMMAND='sh y.sh' git log"],
    ["DYLD_INSERT_LIBRARIES=/tmp/x.dylib cat notes.md"],
    ["DYLD_LIBRARY_PATH=/tmp cat notes.md"],
    ["LD_PRELOAD=/tmp/x.so cat notes.md"],
    ["BASH_ENV=/tmp/x.sh cat notes.md"],
    ["ENV=/tmp/x.sh cat notes.md"],
    ["SHELLOPTS=xtrace cat notes.md"],
    ["PROMPT_COMMAND='sh y.sh' cat notes.md"],
    ["PAGER='sh y.sh' git log"],
    ["EDITOR='sh y.sh' git status"],
    ["LESSOPEN='|sh y.sh %s' less notes.md"],
    ["PERL5OPT=-Mlib cat notes.md"],
    ["ZDOTDIR=/tmp cat notes.md"],
    // 一般變數也一樣：FOO=bar 形式不得自動放行。
    ["LC_ALL=C sort notes.md"],
    ["FOO=bar git status"],
  ])("%s → ask-human high", (command) => {
    const verdict = evaluateShellCommand(command, context);
    expect(verdict.kind).toBe("ask-human");
    if (verdict.kind === "ask-human") {
      expect(verdict.risk).toBe("high");
    }
  });

  it("環境變數指派仍不會蓋掉禁止項：FOO=bar sudo rm -rf /", () => {
    expect(evaluateShellCommand("FOO=bar sudo rm -rf /", context).kind).toBe("deny");
  });
});

describe("執行型選項不得當成唯讀", () => {
  it.each([
    ["rg --pre 'sh y.sh' pattern ."],
    ["rg --pre='sh y.sh' pattern ."],
    ["rg --hostname-bin='sh y.sh' pattern ."],
    ["sort --compress-program='sh y.sh' notes.md"],
    ["sort --compress-program 'sh y.sh' notes.md"],
    ["ag --pager='sh y.sh' pattern ."],
    ["git -c core.fsmonitor='sh y.sh' status"],
    ["git -ccore.fsmonitor='sh y.sh' status"],
    ["git log -ccore.fsmonitor='sh y.sh'"],
    ["git --config-env=core.fsmonitor=GIT_FSMONITOR status"],
    ["git --pager='sh y.sh' log"],
    ["find . -exec rm {} \\;"],
    ["find . -execdir rm {} \\;"],
    ["find . -ok rm {} \\;"],
    ["find . -fprint /tmp/out.txt"],
    ["find . -fprintf /tmp/out.txt '%p\\n'"],
    ["xargs rm"],
    ["xargs -0 sh -c 'echo hi'"],
  ])("%s → 至少 ask-human", (command) => {
    const verdict = evaluateShellCommand(command, context);
    expect(verdict.kind === "allow").toBe(false);
    if (verdict.kind === "ask-human") {
      expect(verdict.risk).toBe("high");
    }
  });

  it("xargs 的內層指令命中禁止樣式時仍然 deny", () => {
    expect(
      evaluateShellCommand("xargs sh -c 'rm -rf cards'", {
        ...context,
        workingDir: fixture.folder,
      }).kind,
    ).toBe("deny");
  });
});

describe("一般指令", () => {
  it.each([
    ["cat notes.md", "allow"],
    ["ls cards", "allow"],
    ["grep -r notes .", "allow"],
    ["echo hi", "allow"],
    ["cat /etc/hosts", "ask-human"],
    ["cat ../outside/secret", "ask-human"],
    ["rm notes.md", "ask-human"],
    ["__folder__ rm -rf cards", "deny"],
    ["__folder__ find cards -name '*.md' -delete", "deny"],
    ["__folder__ find . -delete", "deny"],
    ["__folder__ find cards -type f -delete", "deny"],
    ["__folder__ find -P cards -delete", "deny"],
    ["__folder__ find -H cards -delete", "deny"],
    ["__folder__ find -L cards -delete", "deny"],
    ["__folder__ find -E cards -delete", "deny"],
    ["__folder__ find -X cards -delete", "deny"],
    ["__folder__ find -d cards -delete", "deny"],
    ["__folder__ find -x cards -delete", "deny"],
    ["__folder__ find -s cards -delete", "deny"],
    ["__folder__ find -P -E -s cards -delete", "deny"],
    ["__folder__ find -f cards -delete", "deny"],
    ["__folder__ find -f /usr/local/bin -delete", "deny"],
    ["__folder__ find -delete", "deny"],
    ["__folder__ find -name '*.md' -delete", "deny"],
    ["find -P notes.md -delete", "ask-human"],
    ["find notes.md -delete", "ask-human"],
    ["find . -exec rm {} \\;", "ask-human"],
    ["ls > /etc/hosts", "deny"],
    ["ls > out.txt", "ask-human"],
    ["ls > /dev/null", "allow"],
    ["cat .env", "deny"],
    ["security find-generic-password -w", "deny"],
    ["sudo rm -rf /", "deny"],
    ["chmod u+s ./tool", "deny"],
    ["osascript -e 'do shell script \"x\" with administrator privileges'", "deny"],
    ["diskutil eraseDisk JHFS+ X disk2", "deny"],
    ["dd if=/dev/zero of=/dev/disk2", "deny"],
    ["bash -c 'cat .env'", "deny"],
    ["bash -c 'echo hi'", "ask-human"],
    ["__folder__ sh -c 'rm -rf cards'", "deny"],
    ["osascript -e 'display dialog \"hi\"'", "ask-human"],
    ["npm install", "ask-human"],
    ["sort -o out.txt notes.md", "ask-human"],
    ["sort -o notes.md", "ask-human"],
    ["sort -o/private/tmp/cardiary-sort-out notes.md", "ask-human"],
    ["sort --output=/private/tmp/cardiary-sort-out notes.md", "ask-human"],
    ["sort --output /private/tmp/cardiary-sort-out notes.md", "ask-human"],
    ["sort --output=/etc/hosts notes.md", "deny"],
    ["sort -o/etc/hosts notes.md", "deny"],
    ["sort -o/usr/local/bin/x notes.md", "deny"],
    ["sort -o/System/x notes.md", "deny"],
    ["git status\nrm notes.md", "ask-human"],
    ["echo 'unterminated", "ask-human"],
    ["", "ask-human"],
  ])("%s → %s", (command, expected) => {
    if (command.startsWith("__folder__ ")) {
      expect(
        evaluateShellCommand(command.slice("__folder__ ".length), {
          ...context,
          workingDir: fixture.folder,
        }).kind,
      ).toBe(expected);
      return;
    }
    expect(evaluateShellCommand(command, context).kind).toBe(expected);
  });

  it("sort -o 的黏著值不會被當成一般旗標跳過", () => {
    const victim = join(fixture.outside, "victim.txt");
    const verdict = evaluateShellCommand(`sort -o${victim} notes.md`, context);
    expect(verdict.kind).toBe("ask-human");
  });

  it("sort -o 的目標是狀態庫時 deny.human-settings", () => {
    const target = join(fixture.folder, "state", "cardiary.sqlite");
    const verdict = evaluateShellCommand(`sort -o${target} notes.md`, context);
    expect(verdict.kind === "deny" && verdict.rule).toBe("deny.human-settings");
  });

  it("sort --output= 的目標是狀態庫時 deny.human-settings", () => {
    const target = join(fixture.folder, "state", "cardiary.sqlite-wal");
    const verdict = evaluateShellCommand(`sort --output=${target} notes.md`, context);
    expect(verdict.kind === "deny" && verdict.rule).toBe("deny.human-settings");
  });

  it("sort -o /path（空白分隔）的目標命中保護路徑時 deny", () => {
    const target = join(fixture.folder, "state", "folder.json");
    const verdict = evaluateShellCommand(`sort -o ${target} notes.md`, context);
    expect(verdict.kind === "deny" && verdict.rule).toBe("deny.human-settings");
  });

  it("子殼層的內層命中禁止樣式時回報內層原因", () => {
    const verdict = evaluateShellCommand("bash -c 'cat .env'", context);
    expect(verdict.kind).toBe("deny");
    if (verdict.kind === "deny") {
      expect(verdict.reason).toContain("子殼層");
    }
  });

  it("rm 的風險等級：工作目錄是中、外部是高", () => {
    const inside = evaluateShellCommand("rm notes.md", context);
    expect(inside.kind === "ask-human" && inside.risk).toBe("medium");
    const outside = evaluateShellCommand("rm ../outside/secret", context);
    expect(outside.kind === "ask-human" && outside.risk).toBe("high");
  });

  it("唯讀查詢在資料夾之內也放行", () => {
    expect(evaluateShellCommand(`ls ${join(fixture.folder, "cards")}`, context).kind).toBe("allow");
  });
});
