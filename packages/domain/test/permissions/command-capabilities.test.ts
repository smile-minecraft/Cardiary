import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { evaluateShellCommand, type ShellContext } from "../../src/permissions/index.js";
import { makeFixture, type Fixture } from "./support.js";

const fixture: Fixture = makeFixture();
const context: ShellContext = {
  workingDir: fixture.project,
  folderRoot: fixture.folder,
  homeDir: fixture.home,
  appBundlePath: fixture.appBundle,
};
const folderContext: ShellContext = { ...context, workingDir: fixture.folder };

afterAll(() => fixture.cleanup());

const stateDb = join(fixture.folder, "state", "cardiary.sqlite");
const cardFile = join(fixture.folder, "cards", "card.md");
const outsideFile = join(fixture.outside, "victim.txt");

describe("sort 的等價寫法都認得是同一個寫入選項", () => {
  it.each([
    ["-o<path>", `sort -o${outsideFile} notes.md`],
    ["-o <path>", `sort -o ${outsideFile} notes.md`],
    ["群組 -no<path>", `sort -no${outsideFile} notes.md`],
    ["群組 -ro<path>", `sort -ro${outsideFile} notes.md`],
    ["群組 -rfno<path>", `sort -rfno${outsideFile} notes.md`],
    ["--output=<path>", `sort --output=${outsideFile} notes.md`],
    ["--output <path>", `sort --output ${outsideFile} notes.md`],
    ["縮寫 --out=<path>", `sort --out=${outsideFile} notes.md`],
    ["縮寫 --ou=<path>", `sort --ou=${outsideFile} notes.md`],
    ["縮寫 --o=<path>", `sort --o=${outsideFile} notes.md`],
    ["--temporary-directory", `sort -T${fixture.outside} notes.md`],
  ])("%s 一律詢問（high）", (_label, command) => {
    const verdict = evaluateShellCommand(command, context);
    expect(verdict.kind).toBe("ask-human");
    if (verdict.kind === "ask-human") {
      expect(verdict.risk).toBe("high");
    }
  });

  it.each([
    ["狀態庫", `sort -no${stateDb} notes.md`, "deny.human-settings"],
    ["狀態庫（--ou=）", `sort --ou=${stateDb} -r notes.md`, "deny.human-settings"],
    [
      "folder.json",
      `sort -rfno${join(fixture.folder, "state", "folder.json")} notes.md`,
      "deny.human-settings",
    ],
    ["系統目錄（群組）", "sort -no/usr/local/bin/x notes.md", "deny.system-write"],
    ["系統目錄（縮寫）", "sort --o=/etc/hosts notes.md", "deny.system-write"],
    [
      "App bundle",
      `sort -no${join(fixture.appBundle, "Contents", "x")} notes.md`,
      "deny.self-modify",
    ],
  ])("寫入 %s 一律拒絕", (_label, command, rule) => {
    const verdict = evaluateShellCommand(command, context);
    expect(verdict.kind === "deny" && verdict.rule).toBe(rule);
  });

  it.each([
    ["sort notes.md"],
    ["sort -u notes.md"],
    ["sort -rn notes.md"],
    ["sort -k1,1 notes.md"],
    ["sort --reverse notes.md"],
  ])("沒有寫入選項的 sort 仍然放行：%s", (command) => {
    expect(evaluateShellCommand(command, context).kind).toBe("allow");
  });

  it("deny 優先於執行型旗標的詢問", () => {
    const verdict = evaluateShellCommand(
      `sort --compress-program='sh y.sh' -o${stateDb} notes.md`,
      context,
    );
    expect(verdict.kind === "deny" && verdict.rule).toBe("deny.human-settings");
    expect(evaluateShellCommand("sort --compress-program='sh y.sh' notes.md", context).kind).toBe(
      "ask-human",
    );
  });

  it("缺少值的 -o 不會被當成唯讀", () => {
    expect(evaluateShellCommand("sort -o", context).kind).toBe("ask-human");
  });
});

describe("uniq 的第二個位置參數是輸出檔", () => {
  it("uniq input output 詢問（high）", () => {
    const verdict = evaluateShellCommand(`uniq notes.md ${cardFile}`, context);
    expect(verdict.kind).toBe("ask-human");
    if (verdict.kind === "ask-human") {
      expect(verdict.risk).toBe("high");
    }
  });

  it("uniq 只有輸入時仍然是唯讀查詢", () => {
    expect(evaluateShellCommand("uniq notes.md", context).kind).toBe("allow");
    expect(evaluateShellCommand("uniq -c notes.md", context).kind).toBe("allow");
    expect(evaluateShellCommand("uniq --all-repeated notes.md", context).kind).toBe("allow");
    expect(evaluateShellCommand("uniq --all-repeated=separate notes.md", context).kind).toBe(
      "allow",
    );
  });

  it("uniq 的輸出指向狀態庫時拒絕", () => {
    const verdict = evaluateShellCommand(`uniq notes.md ${stateDb}`, context);
    expect(verdict.kind === "deny" && verdict.rule).toBe("deny.human-settings");
  });

  it("uniq 的輸出指向正本區時仍然只是詢問（卡片正本可由使用者核准）", () => {
    const verdict = evaluateShellCommand(`uniq notes.md ${cardFile}`, context);
    expect(verdict.kind).toBe("ask-human");
  });
});

describe("其他唯讀指令的寫入選項", () => {
  it.each([
    ["less -o<path>", `less -o${outsideFile} notes.md`],
    ["less -o <path>", `less -o ${outsideFile} notes.md`],
    ["less -O<path>", `less -O${outsideFile} notes.md`],
    ["tree -o<path>", `tree -o${outsideFile} .`],
    ["find -fprint", `find . -fprint ${outsideFile}`],
    ["find -fprintf", `find . -fprintf ${outsideFile} '%p\\n'`],
    ["find -fls", `find . -fls ${outsideFile}`],
  ])("%s 詢問（high）", (_label, command) => {
    const verdict = evaluateShellCommand(command, context);
    expect(verdict.kind).toBe("ask-human");
    if (verdict.kind === "ask-human") {
      expect(verdict.risk).toBe("high");
    }
  });

  it("less -o 指向系統目錄時拒絕", () => {
    const verdict = evaluateShellCommand("less -o/etc/hosts notes.md", context);
    expect(verdict.kind === "deny" && verdict.rule).toBe("deny.system-write");
  });
});

describe("find 的全域選項與起點", () => {
  const globalOptions = ["-H", "-L", "-P", "-E", "-X", "-d", "-x", "-s"] as const;

  it("全域選項的每一種組合都與 find cards -delete 判定相同", () => {
    const combinations: string[][] = [[]];
    for (const option of globalOptions) {
      for (const existing of [...combinations]) {
        combinations.push([...existing, option]);
      }
    }
    expect(combinations).toHaveLength(256);
    for (const combination of combinations) {
      const command = ["find", ...combination, "cards", "-delete"].join(" ");
      const verdict = evaluateShellCommand(command, folderContext);
      expect({
        command,
        kind: verdict.kind,
        rule: verdict.kind === "deny" ? verdict.rule : "",
      }).toEqual({
        command,
        kind: "deny",
        rule: "deny.zone-bulk-delete",
      });
    }
  });

  it("有 -delete 卻沒有起點一律拒絕（每一種全域選項組合）", () => {
    for (const option of [null, ...globalOptions]) {
      const command = ["find", option, "-delete"].filter((part) => part !== null).join(" ");
      const verdict = evaluateShellCommand(command, folderContext);
      expect({ command, kind: verdict.kind }).toEqual({ command, kind: "deny" });
    }
  });

  it.each([
    ["find -f cards -delete", "deny"],
    ["find -P -f cards -delete", "deny"],
    ["find -f /usr/local/bin -delete", "deny"],
    ["find -f notes.md -delete", "ask-human"],
    ["find notes.md -delete", "ask-human"],
    ["find . -delete", "deny"],
    ["find .. -delete", "ask-human"],
    ["find . -name '*.md' -delete", "deny"],
    ["find . -type f -delete", "deny"],
  ])("%s → %s", (command, expected) => {
    expect(evaluateShellCommand(command, folderContext).kind).toBe(expected);
  });

  it("deny 優先於 -exec 的詢問", () => {
    const verdict = evaluateShellCommand("find cards -delete -exec rm {} \\;", folderContext);
    expect(verdict.kind === "deny" && verdict.rule).toBe("deny.zone-bulk-delete");
  });

  it("find 只讀時照路徑規則判定", () => {
    expect(evaluateShellCommand("find . -name '*.md'", folderContext).kind).toBe("allow");
    expect(evaluateShellCommand("find -P cards", folderContext).kind).toBe("allow");
    expect(evaluateShellCommand("find /etc -name hosts", context).kind).toBe("ask-human");
    expect(evaluateShellCommand("find cards -name '*.pem'", folderContext).kind).toBe("deny");
  });

  it.each([["find -- . -delete"], ["find -- cards -delete"], ["find -P -- cards -delete"]])(
    "%s 仍然拒絕整批刪除（-- 不結束運算式）",
    (command) => {
      const verdict = evaluateShellCommand(command, folderContext);
      expect(verdict.kind === "deny" && verdict.rule).toBe("deny.zone-bulk-delete");
    },
  );

  it("-- 之後的執行型主詞至少要詢問", () => {
    const verdict = evaluateShellCommand("find -- . -exec sh -c 'echo hi' \\;", folderContext);
    expect(verdict.kind).toBe("ask-human");
    if (verdict.kind === "ask-human") {
      expect(verdict.risk).toBe("high");
    }
  });

  it("-- 之後的 -exec 子殼層寫入保護目標仍然拒絕", () => {
    const command = "find -- . -exec sh -c 'cp payload.sqlite state/cardiary.sqlite' \\;";
    const verdict = evaluateShellCommand(command, folderContext);
    expect(verdict.kind).toBe("deny");
  });
});

describe("find 的未知主詞不會讓刪除旗標逃過判定", () => {
  it.each([["-newermt 2020-01-01"], ["-nouser"], ["-nogroup"]])(
    "有效的 macOS 主詞 %s 搭配 -delete 仍然拒絕",
    (primary) => {
      const verdict = evaluateShellCommand(`find cards ${primary} -delete`, folderContext);
      expect(verdict.kind === "deny" && verdict.rule).toBe("deny.zone-bulk-delete");
    },
  );

  it("仍然不認得的主詞搭配 -delete 也不放行", () => {
    const verdict = evaluateShellCommand("find cards -made-up-primary -delete", folderContext);
    expect(verdict.kind).toBe("deny");
  });

  it("未知主詞但沒有刪除旗標時，起點是正本區根仍然拒絕", () => {
    // 起點 `cards` 沒有斜線，但解析後是正本區的根；未知主詞不知道會不會刪除，
    // 不能退回詢問讓白名單放行。
    const verdict = evaluateShellCommand("find cards -made-up-primary", folderContext);
    expect(verdict.kind === "deny" && verdict.rule).toBe("deny.zone-bulk-delete");
  });

  it("未知主詞搭配 -exec 時，起點是正本區根仍然拒絕", () => {
    const verdict = evaluateShellCommand(
      "find cards -made-up-primary -exec rm {} \\;",
      folderContext,
    );
    expect(verdict.kind === "deny" && verdict.rule).toBe("deny.zone-bulk-delete");
  });
});

describe("刪除指令沒有目標時不放行", () => {
  it.each([["rm"], ["rm -rf"], ["rmdir"], ["unlink"], ["find -delete"]])(
    "%s → 不是 allow",
    (command) => {
      expect(evaluateShellCommand(command, folderContext).kind).not.toBe("allow");
    },
  );

  it.each([["rm -r notes.md"], ["rm -rf notes.md"], ["rmdir notes.md"], ["unlink notes.md"]])(
    "%s 是刪除目標，不會被當成選項跳過",
    (command) => {
      const verdict = evaluateShellCommand(command, context);
      expect(verdict.kind).toBe("ask-human");
      if (verdict.kind === "ask-human") {
        expect(verdict.risk).toBe("medium");
      }
    },
  );

  it("rm 的 -- 之後才是目標", () => {
    const verdict = evaluateShellCommand("rm -rf -- notes.md", context);
    expect(verdict.kind).toBe("ask-human");
  });
});

describe("能力表以外的形狀一律詢問", () => {
  it.each([
    ["不在表上的指令", "awk '{print}' notes.md"],
    ["不在表上的指令（會寫檔）", "cp notes.md copied.md"],
    ["xargs", "xargs rm"],
    ["未知短選項", "sort -Z notes.md"],
    ["未知長選項", "sort --outputfoo notes.md"],
    ["不明確的長選項前綴", "grep --co notes.md"],
    ["不接受的長選項值", "sort --reverse=yes notes.md"],
    ["缺少值的長選項", "sort --output"],
  ])("%s → ask-human high", (_label, command) => {
    const verdict = evaluateShellCommand(command, context);
    expect(verdict.kind).toBe("ask-human");
    if (verdict.kind === "ask-human") {
      expect(verdict.risk).toBe("high");
    }
  });

  it("常見的無害旗標仍然放行", () => {
    for (const command of [
      "ls -la",
      "ls -1",
      "cat -n notes.md",
      "head -5 notes.md",
      "head -n 5 notes.md",
      "tail -n 5 notes.md",
      "grep -rn notes .",
      "grep -e pattern -e other notes.md",
      "wc -l notes.md",
      "rg -n pattern .",
      "rg --files-with-matches pattern .",
      "diff -u a.md b.md",
      "jq -r .x notes.md",
      "du -sh .",
      "df -h",
    ]) {
      expect({ command, kind: evaluateShellCommand(command, context).kind }).toEqual({
        command,
        kind: "allow",
      });
    }
  });
});

/**
 * 真實 `/bin/sh -c` 的等價性：同一個字串在暫存資料夾真的會寫檔時，權限判定
 * 不能放行。這裡只用 POSIX 的 `sort`／`uniq`；fixture 全部在暫存目錄裡。
 */
describe("真實 shell 的等價寫法", () => {
  const input = join(fixture.project, "equiv-input.txt");
  const forms = [
    (out: string) => `sort -o${out} equiv-input.txt`,
    (out: string) => `sort -o ${out} equiv-input.txt`,
    (out: string) => `sort -no${out} equiv-input.txt`,
    (out: string) => `sort -ro${out} equiv-input.txt`,
    (out: string) => `sort -rfno${out} equiv-input.txt`,
    (out: string) => `sort --output=${out} equiv-input.txt`,
    (out: string) => `sort --output ${out} equiv-input.txt`,
    (out: string) => `sort --out=${out} equiv-input.txt`,
    (out: string) => `sort --ou=${out} equiv-input.txt`,
    (out: string) => `sort --o=${out} equiv-input.txt`,
    (out: string) => `uniq equiv-input.txt ${out}`,
  ];

  it("真的會寫檔的每一種寫法都不會零審批", () => {
    writeFileSync(input, "b\na\nb\n");
    let wrote = 0;
    for (const [index, form] of forms.entries()) {
      const out = join(fixture.project, `equiv-out-${index}.txt`);
      writeFileSync(out, "ORIGINAL");
      const command = form(out);
      let ran = true;
      try {
        execFileSync("/bin/sh", ["-c", command], { cwd: fixture.project, stdio: "ignore" });
      } catch {
        ran = false;
      }
      const modified = ran && readFileSync(out, "utf8") !== "ORIGINAL";
      if (!modified) {
        continue;
      }
      wrote += 1;
      expect({ command, kind: evaluateShellCommand(command, context).kind }).not.toEqual({
        command,
        kind: "allow",
      });
    }
    // 任何一個平台都應該至少認得其中幾種；全部沒寫檔代表這個測試沒有測到東西。
    expect(wrote).toBeGreaterThanOrEqual(10);
  });

  it("沒有寫入選項的寫法真的不會寫檔，判定也放行", () => {
    const before = readFileSync(input, "utf8");
    for (const command of ["sort equiv-input.txt", "uniq equiv-input.txt"]) {
      execFileSync("/bin/sh", ["-c", command], { cwd: fixture.project, stdio: "ignore" });
      expect(evaluateShellCommand(command, context).kind).toBe("allow");
    }
    expect(readFileSync(input, "utf8")).toBe(before);
  });
});

/**
 * 能力表以外的指令：token 看起來像路徑時，落在保護目標就拒絕，其餘詢問。
 */
describe("能力表以外的指令碰到保護目標一律拒絕", () => {
  it.each([
    ["狀態庫", `rsync -a notes.md ${stateDb}`, "deny.human-settings"],
    ["狀態庫（--output=）", `curl --output=${stateDb} http://example.com`, "deny.human-settings"],
    ["系統目錄", "rsync -a notes.md /etc/hosts", "deny.system-write"],
    [
      "App bundle",
      `python3 notes.md ${join(fixture.appBundle, "Contents", "x")}`,
      "deny.self-modify",
    ],
    ["正本區", `sed -i '' s/a/b/ ${cardFile}`, "deny.zone-bulk-delete"],
    ["資料夾根", `rsync -a notes.md ${fixture.folder}`, "deny.zone-bulk-delete"],
  ])("%s → %s", (_label, command, rule) => {
    const verdict = evaluateShellCommand(command, context);
    expect(verdict.kind === "deny" && verdict.rule).toBe(rule);
  });

  it.each([
    ["rsync", "rsync -a notes.md copy.md"],
    ["curl", "curl -o copy.md https://example.com"],
    ["python3", "python3 -m http.server"],
    ["sed 只讀", "sed 's/a/b/' notes.md"],
  ])("%s 沒有碰到保護目標時仍然只是詢問（high）", (_label, command) => {
    const verdict = evaluateShellCommand(command, context);
    expect(verdict.kind).toBe("ask-human");
    if (verdict.kind === "ask-human") {
      expect(verdict.risk).toBe("high");
    }
  });

  it("以絕對路徑執行未分類的指令不是碰保護目標", () => {
    const verdict = evaluateShellCommand("/usr/bin/rsync -a notes.md copy.md", context);
    expect(verdict.kind).toBe("ask-human");
  });

  it("子殼層內的未分類指令同樣會掃描保護目標", () => {
    const verdict = evaluateShellCommand("bash -c 'rsync notes.md state/cardiary.sqlite'", {
      ...context,
      workingDir: fixture.folder,
    });
    expect(verdict.kind === "deny");
  });
});

describe("寫入指令的位置參數語意", () => {
  it.each([
    ["cp 到狀態庫", `cp payload.sqlite ${stateDb}`, "deny.human-settings"],
    ["cp 到系統目錄", "cp notes.md /etc/hosts", "deny.system-write"],
    ["cp -t 到狀態庫", `cp -t ${stateDb} payload.sqlite`, "deny.human-settings"],
    ["mv 從狀態庫", `mv ${stateDb} /tmp/cardiary-mv`, "deny.human-settings"],
    ["mv 到系統目錄", "mv notes.md /etc/hosts", "deny.system-write"],
    ["ln 的連結名是狀態庫", `ln -s notes.md ${stateDb}`, "deny.human-settings"],
    ["tee 到狀態庫", `tee ${stateDb}`, "deny.human-settings"],
    ["tee -a 到狀態庫", `tee -a ${stateDb}`, "deny.human-settings"],
    ["touch 狀態庫", `touch ${stateDb}`, "deny.human-settings"],
    ["mkdir 系統目錄", "mkdir /usr/local/bin/cardiary-x", "deny.system-write"],
    ["install 到狀態庫", `install payload.sqlite ${stateDb}`, "deny.human-settings"],
    ["install -t 到狀態庫", `install -t ${stateDb} payload.sqlite`, "deny.human-settings"],
    ["sed -i 到卡片正本", `sed -i '' s/a/b/ ${cardFile}`, "deny.zone-bulk-delete"],
  ])("%s 一律拒絕", (_label, command, rule) => {
    const verdict = evaluateShellCommand(command, context);
    expect(verdict.kind === "deny" && verdict.rule).toBe(rule);
  });

  it.each([
    ["cp", "cp notes.md copy.md"],
    ["cp -t", `cp -t ${fixture.project} notes.md`],
    ["mv", "mv notes.md copy.md"],
    ["ln", "ln notes.md copy.md"],
    ["ln -s", "ln -s notes.md copy.md"],
    ["tee -a", "tee -a notes.md"],
    ["touch", "touch notes.md"],
    ["mkdir", "mkdir build"],
    ["install", "install notes.md copy.md"],
    ["install -t", `install -t ${fixture.project} notes.md`],
  ])("%s 的一般寫入是詢問（high），不是放行", (_label, command) => {
    const verdict = evaluateShellCommand(command, context);
    expect(verdict.kind).toBe("ask-human");
    if (verdict.kind === "ask-human") {
      expect(verdict.risk).toBe("high");
    }
  });

  it("寫入指令只有旗標、沒有目標時不是放行", () => {
    for (const command of ["cp", "mv", "tee", "touch", "mkdir", "install"]) {
      expect({ command, kind: evaluateShellCommand(command, context).kind }).toEqual({
        command,
        kind: "ask-human",
      });
    }
  });
});

describe("未知選項不會掩蓋保護目標的 deny", () => {
  it.each([
    ["rm --foo /etc/hosts", "deny.system-write"],
    ["sort --foo -o/etc/hosts notes.md", "deny.system-write"],
    [`rm --foo ${stateDb}`, "deny.human-settings"],
  ])("%s → %s", (command, rule) => {
    const verdict = evaluateShellCommand(command, context);
    expect(verdict.kind === "deny" && verdict.rule).toBe(rule);
  });

  it("未知選項但只有一般路徑時仍然是詢問（high）", () => {
    const verdict = evaluateShellCommand("rm --foo notes.md", context);
    expect(verdict.kind).toBe("ask-human");
    if (verdict.kind === "ask-human") {
      expect(verdict.risk).toBe("high");
    }
  });
});

/**
 * 真實 `/bin/sh` 對照：暫存 Cardiary 資料夾裡真的會刪檔、寫檔時，判定不能
 * 放行。每個測試用自己的暫存資料夾，不碰 fixture 與使用者檔案。
 */
function scratchFolder(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cardiary-shell-real-")));
  mkdirSync(join(root, "cards"), { recursive: true });
  mkdirSync(join(root, "state"), { recursive: true });
  writeFileSync(join(root, "cards", "a.md"), "card");
  writeFileSync(join(root, "cards", "b.txt"), "b");
  writeFileSync(join(root, "state", "cardiary.sqlite"), "ORIGINAL");
  writeFileSync(join(root, "payload.sqlite"), "payload");
  return root;
}

function runShell(command: string, cwd: string, shell = "/bin/sh"): void {
  try {
    execFileSync(shell, ["-c", command], { cwd, stdio: "ignore" });
  } catch {
    // 指令失敗不影響判定；檔案有沒有變以檔案內容判斷。
  }
}

describe("真實 shell 的 find -- 與未知主詞", () => {
  it("find -- . -delete 真的會刪，判定不是 allow", () => {
    const root = scratchFolder();
    try {
      runShell("find -- . -delete", root);
      expect(existsSync(join(root, "cards", "a.md"))).toBe(false);
      const verdict = evaluateShellCommand("find -- . -delete", {
        ...context,
        workingDir: root,
        folderRoot: root,
      });
      expect(verdict.kind === "deny" && verdict.rule).toBe("deny.zone-bulk-delete");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("find -- cards -delete 真的會刪，判定拒絕", () => {
    const root = scratchFolder();
    try {
      runShell("find -- cards -delete", root);
      expect(existsSync(join(root, "cards", "a.md"))).toBe(false);
      const verdict = evaluateShellCommand("find -- cards -delete", {
        ...context,
        workingDir: root,
        folderRoot: root,
      });
      expect(verdict.kind === "deny" && verdict.rule).toBe("deny.zone-bulk-delete");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("find cards -newermt … -delete 真的會刪，判定拒絕", () => {
    const root = scratchFolder();
    try {
      runShell("find cards -newermt 2020-01-01 -delete", root);
      expect(existsSync(join(root, "cards", "a.md"))).toBe(false);
      const verdict = evaluateShellCommand("find cards -newermt 2020-01-01 -delete", {
        ...context,
        workingDir: root,
        folderRoot: root,
      });
      expect(verdict.kind === "deny" && verdict.rule).toBe("deny.zone-bulk-delete");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/**
 * 真實 `/bin/sh` 對照：寫入指令真的會覆寫保護目標時，判定不能放行。
 */
describe("真實 shell 的寫入指令對照", () => {
  it("cp 真的會覆寫狀態庫，判定拒絕", () => {
    const root = scratchFolder();
    try {
      runShell("cp payload.sqlite state/cardiary.sqlite", root);
      expect(readFileSync(join(root, "state", "cardiary.sqlite"), "utf8")).toBe("payload");
      const verdict = evaluateShellCommand("cp payload.sqlite state/cardiary.sqlite", {
        ...context,
        workingDir: root,
        folderRoot: root,
      });
      expect(verdict.kind === "deny" && verdict.rule).toBe("deny.human-settings");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("echo | tee 真的會覆寫狀態庫，判定拒絕", () => {
    const root = scratchFolder();
    try {
      runShell("echo changed | tee state/cardiary.sqlite >/dev/null", root);
      expect(readFileSync(join(root, "state", "cardiary.sqlite"), "utf8")).toBe("changed\n");
      const verdict = evaluateShellCommand("echo changed | tee state/cardiary.sqlite", {
        ...context,
        workingDir: root,
        folderRoot: root,
      });
      expect(verdict.kind === "deny" && verdict.rule).toBe("deny.human-settings");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("echo | tee 真的會覆寫 MCP 伺服器設定，判定拒絕", () => {
    const root = scratchFolder();
    try {
      runShell(`echo '{"version":1}' | tee state/mcp-servers.json >/dev/null`, root);
      expect(readFileSync(join(root, "state", "mcp-servers.json"), "utf8")).toBe('{"version":1}\n');
      for (const command of [
        "echo changed | tee state/mcp-servers.json",
        "echo changed > state/mcp-servers.json",
      ]) {
        const verdict = evaluateShellCommand(command, {
          ...context,
          workingDir: root,
          folderRoot: root,
        });
        expect(verdict.kind === "deny" && verdict.rule, command).toBe("deny.human-settings");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("sed -i 真的會改卡片正本，判定拒絕", () => {
    const root = scratchFolder();
    try {
      // `-i.bak` 是 BSD 與 GNU sed 都認得的原地改寫＋保留備份；`-i ''` 是 BSD
      // 專屬寫法，GNU sed 會把空字串當成 script，檔案不會被改（CI 的 check
      // job 是 Ubuntu）。備份檔在同一層，斷言完就刪掉。
      runShell("sed -i.bak s/card/CHANGED/ cards/a.md", root);
      expect(readFileSync(join(root, "cards", "a.md"), "utf8")).toBe("CHANGED");
      rmSync(join(root, "cards", "a.md.bak"), { force: true });
      const verdict = evaluateShellCommand("sed -i.bak s/card/CHANGED/ cards/a.md", {
        ...context,
        workingDir: root,
        folderRoot: root,
      });
      expect(verdict.kind === "deny" && verdict.rule).toBe("deny.zone-bulk-delete");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/**
 * 目的地是既有目錄時，`cp`／`mv`／`install` 會把每個來源放進
 * `<目錄>/<檔名>`；只看最後一個位置參數（目錄本身）會漏掉真正的寫入目標。
 */
describe("cp／mv／install 的目的地是既有目錄時，逐檔判定", () => {
  it.each([
    ["cp", "cp cardiary.sqlite state/"],
    ["mv", "mv cardiary.sqlite state/"],
    ["install", "install -m 644 cardiary.sqlite state/"],
  ])("%s 到既有目錄真的會覆寫狀態庫，判定拒絕", (_label, command) => {
    const root = scratchFolder();
    try {
      writeFileSync(join(root, "cardiary.sqlite"), "FORGED-DB");
      runShell(command, root);
      expect(readFileSync(join(root, "state", "cardiary.sqlite"), "utf8")).toBe("FORGED-DB");
      const verdict = evaluateShellCommand(command, {
        ...context,
        workingDir: root,
        folderRoot: root,
      });
      expect(verdict.kind === "deny" && verdict.rule).toBe("deny.human-settings");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["cp -t", "cp -t state cardiary.sqlite"],
    ["cp --target-directory=", "cp --target-directory=state cardiary.sqlite"],
    ["mv -t", "mv -t state cardiary.sqlite"],
    ["install -t", "install -t state cardiary.sqlite"],
    ["cp -t 直接指狀態庫檔", "cp -t state/cardiary.sqlite notes.md"],
    ["cp -t 直接指 MCP 伺服器設定", "cp -t state/mcp-servers.json notes.md"],
    ["mv 到 MCP 伺服器設定", "mv notes.md state/mcp-servers.json"],
  ])("%s 的目的地同樣逐檔判定", (_label, command) => {
    const root = scratchFolder();
    try {
      writeFileSync(join(root, "cardiary.sqlite"), "FORGED-DB");
      const verdict = evaluateShellCommand(command, {
        ...context,
        workingDir: root,
        folderRoot: root,
      });
      expect(verdict.kind === "deny" && verdict.rule).toBe("deny.human-settings");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("一般檔案複製到既有目錄只是詢問（high）", () => {
    const root = scratchFolder();
    try {
      const verdict = evaluateShellCommand("cp notes.md state/", {
        ...context,
        workingDir: root,
        folderRoot: root,
      });
      expect(verdict.kind).toBe("ask-human");
      if (verdict.kind === "ask-human") {
        expect(verdict.risk).toBe("high");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/**
 * 能力表以外的指令：token 沒有斜線也要用 cwd 解析後比對保護目標。
 */
describe("沒有斜線的 token 也會比對保護目標", () => {
  it("rsync --delete 到 cards 真的會刪卡片，判定拒絕", () => {
    const root = scratchFolder();
    try {
      mkdirSync(join(root, "project"), { recursive: true });
      writeFileSync(join(root, "project", "c.md"), "c");
      runShell("rsync -a --delete project/ cards", root);
      expect(existsSync(join(root, "cards", "a.md"))).toBe(false);
      const verdict = evaluateShellCommand("rsync -a --delete project/ cards", {
        ...context,
        workingDir: root,
        folderRoot: root,
      });
      expect(verdict.kind === "deny" && verdict.rule).toBe("deny.zone-bulk-delete");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("cp 的目的地寫成 state（沒有斜線）真的會覆寫狀態庫，判定拒絕", () => {
    const root = scratchFolder();
    try {
      writeFileSync(join(root, "cardiary.sqlite"), "FORGED-DB");
      runShell("cp cardiary.sqlite state", root);
      expect(readFileSync(join(root, "state", "cardiary.sqlite"), "utf8")).toBe("FORGED-DB");
      const verdict = evaluateShellCommand("cp cardiary.sqlite state", {
        ...context,
        workingDir: root,
        folderRoot: root,
      });
      expect(verdict.kind === "deny" && verdict.rule).toBe("deny.human-settings");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["未知指令碰正本區根", "foo state", "deny.zone-bulk-delete"],
    ["未知指令碰正本區根（有斜線）", "foo state/", "deny.zone-bulk-delete"],
    ["未知指令碰 cards", "foo cards", "deny.zone-bulk-delete"],
  ])("%s → %s", (_label, command, rule) => {
    const root = scratchFolder();
    try {
      const verdict = evaluateShellCommand(command, {
        ...context,
        workingDir: root,
        folderRoot: root,
      });
      expect(verdict.kind === "deny" && verdict.rule).toBe(rule);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("cwd 是 state 時，沒有斜線的 folder.json 也拒絕", () => {
    const root = scratchFolder();
    try {
      writeFileSync(join(root, "state", "folder.json"), "{}");
      const verdict = evaluateShellCommand("foo folder.json", {
        ...context,
        workingDir: join(root, "state"),
        folderRoot: root,
      });
      expect(verdict.kind === "deny" && verdict.rule).toBe("deny.human-settings");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("一般檔案名字不受影響", () => {
    const root = scratchFolder();
    try {
      writeFileSync(join(root, "notes.md"), "notes");
      const verdict = evaluateShellCommand("foo notes.md", {
        ...context,
        workingDir: root,
        folderRoot: root,
      });
      expect(verdict.kind).toBe("ask-human");
      if (verdict.kind === "ask-human") {
        expect(verdict.risk).toBe("high");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/**
 * `cd`／`pushd`／`popd` 會改變後續段落的 cwd；相對路徑要用新的 cwd 判定，
 * 動態來源（變數、命令替換、glob）一律詢問。
 */
describe("cd／pushd／popd 會更新判定用的 cwd", () => {
  it("cd state 之後的相對路徑真的會改狀態庫，判定拒絕", () => {
    const root = scratchFolder();
    try {
      runShell(
        "cd state; sed -i.bak 's#ORIGINAL#PWNED#' cardiary.sqlite; rm -f cardiary.sqlite.bak",
        root,
      );
      expect(readFileSync(join(root, "state", "cardiary.sqlite"), "utf8")).toBe("PWNED");
      const verdict = evaluateShellCommand(
        "cd state; sed -i.bak 's#ORIGINAL#PWNED#' cardiary.sqlite",
        { ...context, workingDir: root, folderRoot: root },
      );
      expect(verdict.kind === "deny" && verdict.rule).toBe("deny.human-settings");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("cd cards 之後的相對路徑真的會改卡片正本，判定拒絕", () => {
    const root = scratchFolder();
    try {
      runShell("cd cards; sed -i.bak 's#card#CHANGED#' a.md; rm -f a.md.bak", root);
      expect(readFileSync(join(root, "cards", "a.md"), "utf8")).toBe("CHANGED");
      const verdict = evaluateShellCommand("cd cards; sed -i.bak 's#card#CHANGED#' a.md", {
        ...context,
        workingDir: root,
        folderRoot: root,
      });
      expect(verdict.kind === "deny" && verdict.rule).toBe("deny.zone-bulk-delete");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("cd .. 之後的相對路徑用上一層判定", () => {
    // cwd 是 cards；cd .. 之後 state/cardiary.sqlite 是狀態庫。沒有追蹤時
    // 會解析成 cards/state/cardiary.sqlite（正本區），兩者的規則不同。
    const root = scratchFolder();
    try {
      const verdict = evaluateShellCommand(
        "cd ..; sed -i.bak 's#ORIGINAL#PWNED#' state/cardiary.sqlite",
        { ...context, workingDir: join(root, "cards"), folderRoot: root },
      );
      expect(verdict.kind === "deny" && verdict.rule).toBe("deny.human-settings");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("pushd／popd 同樣追蹤", () => {
    const root = scratchFolder();
    try {
      // dash（Ubuntu 的 /bin/sh）沒有 pushd；這裡明確用 bash 跑真實對照。
      runShell(
        "pushd state >/dev/null; sed -i.bak 's#ORIGINAL#PWNED#' cardiary.sqlite; popd >/dev/null",
        root,
        "/bin/bash",
      );
      expect(readFileSync(join(root, "state", "cardiary.sqlite"), "utf8")).toBe("PWNED");
      const verdict = evaluateShellCommand(
        "pushd state >/dev/null; sed -i.bak 's#ORIGINAL#PWNED#' cardiary.sqlite; popd >/dev/null",
        { ...context, workingDir: root, folderRoot: root },
      );
      expect(verdict.kind === "deny" && verdict.rule).toBe("deny.human-settings");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("cd 絕對路徑同樣追蹤", () => {
    const root = scratchFolder();
    try {
      const verdict = evaluateShellCommand(
        `cd ${join(root, "state")}; sed -i.bak 's#ORIGINAL#PWNED#' cardiary.sqlite`,
        { ...context, workingDir: root, folderRoot: root },
      );
      expect(verdict.kind === "deny" && verdict.rule).toBe("deny.human-settings");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("cd 之後的重導向目標也用新的 cwd 判定", () => {
    const root = scratchFolder();
    try {
      runShell("cd state; echo changed > cardiary.sqlite", root);
      expect(readFileSync(join(root, "state", "cardiary.sqlite"), "utf8")).toBe("changed\n");
      const verdict = evaluateShellCommand("cd state; echo changed > cardiary.sqlite", {
        ...context,
        workingDir: root,
        folderRoot: root,
      });
      expect(verdict.kind === "deny" && verdict.rule).toBe("deny.human-settings");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["變數", "cd $HOME; sed -i s/a/b/ cardiary.sqlite"],
    ["命令替換", "cd $(pwd); cat notes.md"],
    ["上一個目錄", "cd -; cat notes.md"],
    ["glob", "cd ca*; cat notes.md"],
    ["cd 沒有參數", "cd; cat notes.md"],
    ["pushd 沒有參數且堆疊空", "pushd; cat notes.md"],
    ["popd 帶輪替參數", "popd +1; cat notes.md"],
  ])("動態 cwd（%s）一律詢問（high）", (_label, command) => {
    const root = scratchFolder();
    try {
      const verdict = evaluateShellCommand(command, {
        ...context,
        workingDir: root,
        folderRoot: root,
      });
      expect(verdict.kind).toBe("ask-human");
      if (verdict.kind === "ask-human") {
        expect(verdict.risk).toBe("high");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("cd 目標不存在時留在原目錄，相對路徑仍用原目錄判定", () => {
    // cwd 是 state；cd nowhere 在 shell 會失敗，後續的 cardiary.sqlite 仍是
    // state 裡的狀態庫。得到詢問代表 cwd 被誤移到 nowhere。
    const root = scratchFolder();
    try {
      const verdict = evaluateShellCommand("cd nowhere; sed -i 's#a#b#' cardiary.sqlite", {
        ...context,
        workingDir: join(root, "state"),
        folderRoot: root,
      });
      expect(verdict.kind === "deny" && verdict.rule).toBe("deny.human-settings");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("cd 到檔案時留在原目錄", () => {
    const root = scratchFolder();
    try {
      const verdict = evaluateShellCommand("cd payload.sqlite; sed -i 's#a#b#' cardiary.sqlite", {
        ...context,
        workingDir: join(root, "state"),
        folderRoot: root,
      });
      expect(verdict.kind === "deny" && verdict.rule).toBe("deny.human-settings");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("&& 串接時，cd 後的拒絕仍然勝出", () => {
    const root = scratchFolder();
    try {
      const verdict = evaluateShellCommand(
        "cd state && sed -i.bak 's#ORIGINAL#PWNED#' cardiary.sqlite",
        { ...context, workingDir: root, folderRoot: root },
      );
      expect(verdict.kind === "deny" && verdict.rule).toBe("deny.human-settings");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("子殼層裡的 cd 也會追蹤", () => {
    const root = scratchFolder();
    try {
      const verdict = evaluateShellCommand(
        "bash -c 'cd state; sed -i.bak s#ORIGINAL#PWNED# cardiary.sqlite'",
        { ...context, workingDir: root, folderRoot: root },
      );
      expect(verdict.kind).toBe("deny");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("cd 的參數命中憑證樣式仍然拒絕", () => {
    const root = scratchFolder();
    try {
      const verdict = evaluateShellCommand("cd ~/.ssh", {
        ...context,
        workingDir: root,
        folderRoot: root,
      });
      expect(verdict.kind === "deny" && verdict.rule).toBe("deny.credentials");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
