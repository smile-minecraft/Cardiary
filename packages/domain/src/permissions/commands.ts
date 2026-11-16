import path from "node:path";

import { COMMAND_CAPABILITIES } from "./capabilities.js";
import type { CommandCapability, PositionalSemantics } from "./capabilities.js";
import { matchCredentialArgument } from "./credentials.js";
import { evaluateReadPath, evaluateWritePath } from "./fs-rules.js";
import type { FsRuleContext } from "./fs-rules.js";
import { optionEffect, parseOptions, parsePrimaryOptions } from "./getopt.js";
import type { OptionRule } from "./getopt.js";
import {
  detectCaseSensitivity,
  isExistingDirectory,
  isWithin,
  originZoneOf,
  resolvePath,
} from "./paths.js";
import type { PathRoots } from "./paths.js";
import { PERMISSION_RULES } from "./rules.js";
import type { PermissionVerdict, ResolvedPath } from "./types.js";
import { allow, askHuman, deny, maxRisk, type Risk } from "./verdict.js";

/** 一段簡單指令。 */
export interface ParsedSegment {
  /** 去掉環境變數指派後的 token；第一個是命令。 */
  readonly tokens: readonly string[];
  /** 前面的 `FOO=bar` 指派。 */
  readonly assignments: readonly string[];
  /** 命令的 basename；絕對路徑取最後一段。 */
  readonly command: string | null;
  readonly args: readonly string[];
}

export interface ParsedRedirect {
  readonly operator: string;
  readonly target: string;
}

export interface ParsedCommandLine {
  readonly segments: readonly ParsedSegment[];
  /** 控制字元：`;`、`&&`、`||`、`|`、`&`、換行。 */
  readonly operators: readonly string[];
  readonly redirects: readonly ParsedRedirect[];
  /** `$(...)` 與反引號的內層字串。 */
  readonly substitutions: readonly string[];
  readonly parseError: string | null;
}

/** 只有這幾個重導向會寫檔案；`<`、`<<` 是讀取。 */
const WRITE_REDIRECT_OPERATORS = new Set([">", ">>", "2>", "2>>", "&>", "&>>"]);

const SUBSTITUTION_PLACEHOLDER = "\u0000";

/**
 * 解析指令：shlex 規則切成簡單指令，遇到控制字元就切段並記錄種類。
 *
 * 解析失敗（引號不閉合、跳脫在結尾、重導向沒有目標）時回 `parseError`；
 * 呼叫端一律當成詢問，不是放行。這裡不做變數展開：`$HOME` 留原樣，
 * 憑證樣式仍可比對到 `.ssh`、`id_rsa` 這類 segment。
 */
export function parseCommandLine(command: string): ParsedCommandLine {
  const segments: ParsedSegment[] = [];
  const operators: string[] = [];
  const redirects: ParsedRedirect[] = [];
  const substitutions: string[] = [];
  let parseError: string | null = null;

  let tokens: string[] = [];
  let current = "";
  let hasCurrent = false;
  let currentQuoted = false;
  let pendingRedirect: string | null = null;
  let index = 0;

  const resetToken = (): void => {
    current = "";
    hasCurrent = false;
    currentQuoted = false;
  };
  const append = (text: string, quoted = false): void => {
    current += text;
    hasCurrent = true;
    currentQuoted = currentQuoted || quoted;
  };
  const flushToken = (): void => {
    if (!hasCurrent) {
      return;
    }
    if (pendingRedirect !== null) {
      redirects.push({ operator: pendingRedirect, target: current });
      pendingRedirect = null;
    } else {
      tokens.push(current);
    }
    resetToken();
  };
  const flushSegment = (): void => {
    flushToken();
    if (pendingRedirect !== null) {
      parseError = "重導向缺少目標";
      pendingRedirect = null;
    }
    if (tokens.length > 0) {
      segments.push(toSegment(tokens));
      tokens = [];
    }
  };
  const pushOperator = (operator: string): void => {
    flushSegment();
    operators.push(operator);
  };
  const pushRedirect = (operator: string): void => {
    flushToken();
    if (pendingRedirect !== null) {
      parseError = "重導向缺少目標";
    }
    pendingRedirect = operator;
  };

  while (index < command.length) {
    const character = command[index] ?? "";
    const next = command[index + 1] ?? "";

    if (character === "\\") {
      if (index + 1 >= command.length) {
        parseError = "跳脫字元在結尾";
        break;
      }
      append(next, true);
      index += 2;
      continue;
    }
    if (character === "'") {
      const end = command.indexOf("'", index + 1);
      if (end < 0) {
        parseError = "單引號沒有閉合";
        break;
      }
      append(command.slice(index + 1, end), true);
      index = end + 1;
      continue;
    }
    if (character === '"') {
      let cursor = index + 1;
      let closed = false;
      while (cursor < command.length) {
        const inner = command[cursor] ?? "";
        if (inner === "\\") {
          const escaped = command[cursor + 1] ?? "";
          if (escaped === "") {
            break;
          }
          append(/["\\$`]/.test(escaped) ? escaped : `\\${escaped}`, true);
          cursor += 2;
          continue;
        }
        if (inner === '"') {
          closed = true;
          cursor += 1;
          break;
        }
        if (inner === "`") {
          const end = command.indexOf("`", cursor + 1);
          if (end < 0) {
            break;
          }
          substitutions.push(command.slice(cursor + 1, end));
          append(SUBSTITUTION_PLACEHOLDER, true);
          cursor = end + 1;
          continue;
        }
        if (inner === "$" && command[cursor + 1] === "(") {
          const found = captureSubstitution(command, cursor);
          if (found === null) {
            break;
          }
          substitutions.push(found.inner);
          append(SUBSTITUTION_PLACEHOLDER, true);
          cursor = found.end;
          continue;
        }
        append(inner, true);
        cursor += 1;
      }
      if (!closed) {
        parseError = "雙引號沒有閉合";
        break;
      }
      index = cursor;
      continue;
    }
    if (character === "`") {
      const end = command.indexOf("`", index + 1);
      if (end < 0) {
        parseError = "反引號沒有閉合";
        break;
      }
      substitutions.push(command.slice(index + 1, end));
      append(SUBSTITUTION_PLACEHOLDER);
      index = end + 1;
      continue;
    }
    if (character === "$" && next === "(") {
      const found = captureSubstitution(command, index);
      if (found === null) {
        parseError = "子殼層沒有閉合";
        break;
      }
      substitutions.push(found.inner);
      append(SUBSTITUTION_PLACEHOLDER);
      index = found.end;
      continue;
    }
    if (character === "$" && next === "{") {
      const end = command.indexOf("}", index + 2);
      if (end < 0) {
        parseError = "變數沒有閉合";
        break;
      }
      append(command.slice(index, end + 1));
      index = end + 1;
      continue;
    }
    if (character === "#" && !hasCurrent) {
      const end = command.indexOf("\n", index);
      index = end < 0 ? command.length : end;
      continue;
    }
    if (character === " " || character === "\t" || character === "\r") {
      flushToken();
      index += 1;
      continue;
    }
    if (character === "\n") {
      pushOperator("\n");
      index += 1;
      continue;
    }
    if (character === ";") {
      pushOperator(";");
      index += 1;
      continue;
    }
    if (character === "&") {
      if (next === "&") {
        pushOperator("&&");
        index += 2;
        continue;
      }
      if (next === ">") {
        const doubled = command[index + 2] === ">";
        pushRedirect(doubled ? "&>>" : "&>");
        index += doubled ? 3 : 2;
        continue;
      }
      pushOperator("&");
      index += 1;
      continue;
    }
    if (character === "|") {
      if (next === "|") {
        pushOperator("||");
        index += 2;
      } else {
        pushOperator("|");
        index += 1;
      }
      continue;
    }
    if (character === ">" || character === "<") {
      // `2>`：前面的數字是 fd，不是 token。
      if (hasCurrent && !currentQuoted && /^\d+$/.test(current)) {
        resetToken();
      }
      if (character === ">") {
        if (next === ">") {
          pushRedirect(">>");
          index += 2;
        } else if (next === "&") {
          // `2>&1`：fd 複製，不是寫檔。
          const fd = command[index + 2] ?? "";
          flushToken();
          redirects.push({ operator: ">", target: `&${fd}` });
          index += 3;
        } else {
          pushRedirect(">");
          index += 1;
        }
      } else if (next === "<") {
        pushRedirect("<<");
        index += 2;
      } else {
        pushRedirect("<");
        index += 1;
      }
      continue;
    }
    append(character);
    index += 1;
  }

  if (parseError === null) {
    flushToken();
    if (pendingRedirect !== null) {
      parseError = "重導向缺少目標";
    }
    if (tokens.length > 0) {
      segments.push(toSegment(tokens));
    }
  }

  return { segments, operators, redirects, substitutions, parseError };
}

function captureSubstitution(
  command: string,
  start: number,
): { readonly inner: string; readonly end: number } | null {
  let depth = 0;
  let cursor = start + 1; // 指向 `(`
  while (cursor < command.length) {
    const character = command[cursor] ?? "";
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        return { inner: command.slice(start + 2, cursor), end: cursor + 1 };
      }
    }
    cursor += 1;
  }
  return null;
}

function toSegment(tokens: readonly string[]): ParsedSegment {
  let start = 0;
  const assignments: string[] = [];
  while (start < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[start] ?? "")) {
    assignments.push(tokens[start] ?? "");
    start += 1;
  }
  const rest = tokens.slice(start);
  const first = rest[0];
  const command =
    first === undefined ? null : first.includes("/") ? (first.split("/").pop() ?? first) : first;
  return { tokens: rest, assignments, command, args: rest.slice(1) };
}

/** 指令分類的輸入。 */
export interface ShellContext extends PathRoots, FsRuleContext {}

/**
 * 唯讀指令的選項與位置參數語意都放在 `capabilities.ts`；這裡只留指令專屬的
 * 分類（提權、磁碟、子殼層）與 git 的子命令文法。
 */
const SHELL_COMMANDS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

const ESCALATION_COMMANDS = new Set([
  "sudo",
  "su",
  "doas",
  "pkexec",
  "systemsetup",
  "nvram",
  "csrutil",
]);
const DISK_COMMANDS = new Set(["newfs", "fdisk", "gpt", "shred"]);
/**
 * git 的短選項可以黏著值（`-ccore.fsmonitor=…`），`--config-env` 從環境變數讀
 * 設定，`--pager` 經由 shell 執行分頁程式；這幾個都不是唯讀查詢。
 */
const GIT_FORBIDDEN_ARGS = new Set([
  "--output",
  "-o",
  "--ext-diff",
  "--textconv",
  "--no-index",
  "-c",
  "--exec-path",
  "--upload-pack",
  "--receive-pack",
  "--git-dir",
  "--work-tree",
  "--pager", // git：分頁程式，會經由 shell 執行
  "--config-env", // git：從環境變數讀設定
]);
const GIT_SUBCOMMANDS = new Set([
  "status",
  "diff",
  "log",
  "show",
  "rev-parse",
  "branch",
  "tag",
  "ls-files",
  "blame",
  "describe",
  "shortlog",
]);
const GIT_BRANCH_ARGS = new Set(["--list", "-a", "-r", "-v", "--show-current"]);
const GIT_TAG_ARGS = new Set(["--list", "-l"]);

/**
 * 判定一條 `shell.exec` 指令。
 *
 * 任何一段命中禁止 → `deny`；子殼層的內層字串先比對禁止樣式；出現串接、
 * 子殼層或真正的重導向 → 至少 `ask-human`（指令串接永遠不會自動放行）；
 * 所有段都是唯讀查詢 → `allow`。解析不出來 → `ask-human`。
 */
export function evaluateShellCommand(command: string, context: ShellContext): PermissionVerdict {
  if (command.trim().length === 0) {
    return askHuman(PERMISSION_RULES.askShell, "high");
  }
  const parsed = parseCommandLine(command);
  if (parsed.parseError !== null) {
    return askHuman(PERMISSION_RULES.askShell, "high");
  }

  // 子殼層：先做字串比對，內層命中禁止樣式仍然 deny，其餘詢問。
  for (const inner of [...parsed.substitutions, ...subshellPayloads(parsed.segments)]) {
    const nested = evaluateShellCommand(inner, context);
    if (nested.kind === "deny") {
      return deny(nested.rule, `子殼層：${nested.reason}`);
    }
  }

  let risk: Risk = "low";
  const allowRules: string[] = [];
  let hasEnvAssignment = false;
  // 相對路徑以「目前的 cwd」為基準；`cd`／`pushd`／`popd` 會改變它。
  let cwd = context.workingDir;
  const cwdStack: string[] = [];
  for (const segment of parsed.segments) {
    if (segment.assignments.length > 0) {
      hasEnvAssignment = true;
    }
    const transition = cdTransition(segment, cwd, context, cwdStack);
    if (transition !== null) {
      if (transition.kind === "deny") {
        return transition.verdict;
      }
      if (transition.cwd === null) {
        // 動態 cwd（變數、命令替換、glob）：後續的相對路徑無法判定，一律詢問。
        return askHuman(PERMISSION_RULES.askShell, "high");
      }
      cwd = transition.cwd;
      continue;
    }
    const verdict = evaluateSegment(segment, { ...context, workingDir: cwd });
    if (verdict.kind === "deny") {
      return verdict;
    }
    if (verdict.kind === "allow") {
      allowRules.push(verdict.rule);
    } else {
      risk = maxRisk(risk, verdict.risk);
    }
  }

  const redirectContext: ShellContext = { ...context, workingDir: cwd };
  for (const redirect of parsed.redirects) {
    if (redirect.target === "/dev/null" || redirect.target.startsWith("&")) {
      continue;
    }
    const resolved = resolvePath(redirect.target, redirectContext);
    if (!resolved.ok) {
      return deny(resolved.rule, resolved.reason);
    }
    const write = WRITE_REDIRECT_OPERATORS.has(redirect.operator);
    const verdict = write
      ? evaluateWritePath(resolved.path, redirectContext, "write")
      : evaluateReadPath(resolved.path, { ...redirectContext, list: false });
    if (verdict.kind === "deny") {
      return verdict;
    }
    if (verdict.kind === "ask-human") {
      risk = maxRisk(risk, verdict.risk);
    }
  }

  const hasControlFlow = parsed.operators.length > 0 || parsed.substitutions.length > 0;
  const hasRealRedirect = parsed.redirects.some(
    (redirect) => redirect.target !== "/dev/null" && !redirect.target.startsWith("&"),
  );
  if (hasControlFlow || hasRealRedirect || hasEnvAssignment) {
    // 環境變數指派不得自動放行：`GIT_CONFIG_KEY_0=core.fsmonitor` 這類指派
    // 可以讓一條看起來唯讀的指令執行任意程式。
    return askHuman(PERMISSION_RULES.askShell, "high");
  }
  if (allowRules.length === parsed.segments.length && parsed.segments.length > 0) {
    const rule = allowRules.every((candidate) => candidate === PERMISSION_RULES.vcsRead)
      ? PERMISSION_RULES.vcsRead
      : PERMISSION_RULES.shellReadWorkspace;
    return allow(rule);
  }
  // 走到這裡代表至少一段沒有放行，但風險等級仍以各段的判定為準；沒有
  // 任何一段給出等級時（例如空指令）才用 high。
  return askHuman(PERMISSION_RULES.askShell, risk === "low" ? "high" : risk);
}

/** `cd`／`pushd`／`popd` 的 cwd 轉移結果。 */
type CdTransition =
  | { readonly kind: "transition"; readonly cwd: string | null }
  | { readonly kind: "deny"; readonly verdict: PermissionVerdict };

/**
 * `cd`／`pushd`／`popd` 對 cwd 的影響；不是這三個指令時回傳 `null`。
 *
 * `cwd` 是 null 代表變成未知：來源是變數、命令替換、glob、`~` 或無法解析的
 * 參數形狀。後續的相對路徑不能拿舊的 cwd 猜，呼叫端一律詢問（high）。
 *
 * 目標不存在、不是目錄，或指令本身會失敗（參數太多、`popd` 堆疊空）時留在
 * 原目錄，與 `/bin/sh` 的行為一致；這樣 `cd nowhere; rm cards/a.md` 仍然以
 * 原目錄判定，不會因為失敗的 `cd` 而漏掉保護目標。
 */
function cdTransition(
  segment: ParsedSegment,
  cwd: string,
  context: ShellContext,
  stack: string[],
): CdTransition | null {
  const command = segment.command;
  if (command !== "cd" && command !== "pushd" && command !== "popd") {
    return null;
  }
  // `cd` 的參數照樣比對憑證樣式（`cd ~/.ssh`），與一般指令同一套規則。
  for (const token of segment.tokens) {
    const credential = matchCredentialArgument(token);
    if (credential !== null) {
      return {
        kind: "deny",
        verdict: deny(PERMISSION_RULES.credentials, `指令參數命中憑證樣式（${credential}）`),
      };
    }
  }
  if (command === "popd") {
    // `popd` 不接受參數；`+N`／`-N` 這類輪替形式不追蹤。
    if (segment.args.length > 0) {
      return { kind: "transition", cwd: null };
    }
    const previous = stack.pop();
    return { kind: "transition", cwd: previous ?? cwd };
  }

  let index = 0;
  while (segment.args[index] === "-L" || segment.args[index] === "-P") {
    // 只影響符號連結的顯示方式，不影響實際目標。
    index += 1;
  }
  if (segment.args[index] === "--") {
    index += 1;
  }
  const rest = segment.args.slice(index);
  if (command === "pushd" && rest.length === 0) {
    // 沒有參數：與堆疊頂交換；堆疊空時 pushd 失敗，留在原目錄。
    if (stack.length === 0) {
      return { kind: "transition", cwd };
    }
    const top = stack.pop() ?? cwd;
    stack.push(cwd);
    return { kind: "transition", cwd: top };
  }
  if (rest.length !== 1) {
    // `cd` 沒有參數是 $HOME、`cd -` 是 $OLDPWD、參數太多是錯誤：都不追蹤。
    return { kind: "transition", cwd: null };
  }
  const target = rest[0] ?? "";
  if (target.length === 0) {
    return { kind: "transition", cwd };
  }
  if (target === "-" || /[$`*?[\]{}~]/.test(target)) {
    // $OLDPWD、變數、命令替換、glob、`~`：實際結果要等 shell 展開，不能猜。
    return { kind: "transition", cwd: null };
  }
  const resolved = resolvePath(target, { ...context, workingDir: cwd });
  if (!resolved.ok) {
    return { kind: "transition", cwd: null };
  }
  if (!resolved.path.exists || !isExistingDirectory(resolved.path.resolved)) {
    // `cd` 失敗（目標不存在或不是目錄）：shell 留在原目錄。
    return { kind: "transition", cwd };
  }
  if (command === "pushd") {
    stack.push(cwd);
  }
  return { kind: "transition", cwd: resolved.path.resolved };
}

/** `sh -c '<字串>'`、`eval '<字串>'`、`xargs sh -c '<字串>'` 的內層字串。 */
function subshellPayloads(segments: readonly ParsedSegment[]): string[] {
  const payloads: string[] = [];
  for (const segment of segments) {
    const tokens = segment.tokens;
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index] ?? "";
      const base = token.includes("/") ? (token.split("/").pop() ?? token) : token;
      if (
        SHELL_COMMANDS.has(base) &&
        tokens[index + 1] === "-c" &&
        tokens[index + 2] !== undefined
      ) {
        payloads.push(tokens[index + 2] ?? "");
      }
      if (base === "eval" && tokens[index + 1] !== undefined) {
        payloads.push(tokens.slice(index + 1).join(" "));
      }
    }
  }
  return payloads;
}

function evaluateSegment(segment: ParsedSegment, context: ShellContext): PermissionVerdict {
  if (segment.command === null) {
    return askHuman(PERMISSION_RULES.askShell, "high");
  }
  const { command, args } = segment;

  // 憑證：任何參數或命令路徑命中就拒絕。
  for (const token of segment.tokens) {
    const credential = matchCredentialArgument(token);
    if (credential !== null) {
      return deny(PERMISSION_RULES.credentials, `指令參數命中憑證樣式（${credential}）`);
    }
  }

  if (command === "security") {
    return deny(PERMISSION_RULES.keychainCli, "不得呼叫 security 指令");
  }
  if (command === "launchctl" && args.includes("security")) {
    return deny(PERMISSION_RULES.keychainCli, "不得透過 launchctl 呼叫 security");
  }
  if (ESCALATION_COMMANDS.has(command)) {
    return deny(PERMISSION_RULES.escalation, `提權或系統設定指令（${command}）`);
  }
  if (command === "launchctl") {
    if (args.includes("bootout") && args.some((arg) => arg.includes("com.cardiary"))) {
      return deny(PERMISSION_RULES.selfModify, "不得停掉 Cardiary 的服務");
    }
    return askHuman(PERMISSION_RULES.askShell, "high");
  }
  if (command === "osascript") {
    const joined = args.join(" ").toLowerCase();
    if (joined.includes("do shell script") && joined.includes("with administrator privileges")) {
      return deny(PERMISSION_RULES.escalation, "osascript 要求管理員權限");
    }
    return askHuman(PERMISSION_RULES.askShell, "high");
  }
  if (command === "chmod") {
    if (args.some((arg) => /^[ugoa]*[+=]s$/.test(arg))) {
      return deny(PERMISSION_RULES.escalation, "chmod 設定 setuid／setgid");
    }
    return askHuman(PERMISSION_RULES.askShell, "high");
  }
  if (command === "chown") {
    if (args.some((arg) => arg === "root" || arg.startsWith("root:") || arg.startsWith("root."))) {
      return deny(PERMISSION_RULES.escalation, "chown 給 root");
    }
    return askHuman(PERMISSION_RULES.askShell, "high");
  }
  if (command === "dscl" || command === "dseditgroup") {
    if (args.some((arg) => ["-create", "-delete", "-append", "-merge", "-passwd"].includes(arg))) {
      return deny(PERMISSION_RULES.escalation, "目錄服務的寫入子命令");
    }
    return askHuman(PERMISSION_RULES.askShell, "high");
  }
  if (command === "spctl" && args.includes("--master-disable")) {
    return deny(PERMISSION_RULES.escalation, "關閉 Gatekeeper");
  }
  if (
    command === "diskutil" &&
    args.some((arg) => /^(erase|partitionDisk|zeroDisk|secureErase)/i.test(arg))
  ) {
    return deny(PERMISSION_RULES.diskDestroy, "抹除或分割磁碟");
  }
  if (command === "dd" && args.some((arg) => arg.startsWith("of=/dev/"))) {
    return deny(PERMISSION_RULES.diskDestroy, "dd 寫入裝置檔");
  }
  if (DISK_COMMANDS.has(command) || command.startsWith("mkfs") || command.startsWith("newfs")) {
    return deny(PERMISSION_RULES.diskDestroy, `磁碟工具（${command}）`);
  }
  if (command === "pkill" || command === "killall" || command === "kill") {
    if (args.some((arg) => arg.toLowerCase() === "cardiary")) {
      return deny(PERMISSION_RULES.selfModify, "不得停止 Cardiary 的行程");
    }
    return askHuman(PERMISSION_RULES.askShell, "high");
  }
  if (command === "git") {
    return evaluateGit(args, context);
  }
  const capability = COMMAND_CAPABILITIES[command];
  if (capability !== undefined) {
    return evaluateCapability(capability, args, context);
  }
  // 能力表上沒有的指令：不知道每個參數是讀取、寫入還是刪除，所以只掃描
  // 看起來像路徑的 token；落在保護目標就拒絕，其餘一律詢問。這一步讓
  // `rsync`、直譯器這類無法安全分類的指令也不能零審批碰保護目標。
  // 第一個 token 是命令本身（`/usr/bin/rsync` 這類絕對路徑很常見），不看。
  const protectedPath = protectedPathDenial(segment.tokens.slice(1), context);
  if (protectedPath !== null) {
    return protectedPath;
  }
  // 不預設它能做什麼、會寫哪裡。
  return askHuman(PERMISSION_RULES.askShell, "high");
}

/**
 * 照能力表判定一個指令。
 *
 * 順序：解析失敗 → 先看原始參數的刪除旗標與保護目標，其餘詢問；接著先算所有
 * 目標，讓 `deny` 一定優先於任何詢問（含執行型旗標的詢問），最後才把需要問的
 * 合併成一個 `ask-human`。寫入目標走 `evaluateWritePath`（保護路徑 deny、其餘
 * 詢問 high）；位置參數依能力表分成讀取、寫入或刪除目標。全部都是讀取目標且
 * 放行時才自動放行。
 */
function evaluateCapability(
  capability: CommandCapability,
  args: readonly string[],
  context: ShellContext,
): PermissionVerdict {
  const parsed =
    capability.style === "primary"
      ? parsePrimaryOptions(args, capability.options.long)
      : parseOptions(args, capability.options);
  if (parsed.problem !== null) {
    // 解析失敗：不認得的選項形狀，不知道它吃不吃值、會不會寫檔。
    // 主詞模式仍保留刪除旗標的偵測：find 的有效主詞我們可能還沒宣告
    // （例如 -newermt），漏掉 -delete 會讓刪除退回詢問、被白名單放行。
    if (
      capability.style === "primary" &&
      args.some((arg) => arg === "-delete" || arg === "-rmdir")
    ) {
      return deny(PERMISSION_RULES.zoneBulkDelete, `參數含刪除旗標但解析失敗（${parsed.problem}）`);
    }
    // 不認得選項形狀不代表保護目標的 deny 可以跳過：`sort --foo -o/etc/hosts`
    // 的第一個障礙是 --foo，但第二個仍然是寫系統目錄。
    const protectedPath = protectedPathDenial(args, context);
    if (protectedPath !== null) {
      return protectedPath;
    }
    return askHuman(PERMISSION_RULES.askShell, "high");
  }

  const semantics = capability.positionals;
  const writesPositionals =
    semantics === "inputs-last-output" ||
    semantics === "delete-last-output" ||
    semantics === "outputs";
  const deletes =
    semantics === "delete-targets" ||
    parsed.options.some((option) => optionEffect(option.rule) === "delete");
  const recursive =
    capability.deleteAlwaysRecursive === true ||
    parsed.options.some(
      (option) => capability.recursiveFlags?.includes(option.short ?? "") === true,
    );

  const pathArguments = [...parsed.positionals];
  for (const option of parsed.options) {
    if (option.rule.positional === true && option.value !== null) {
      pathArguments.push(option.value);
    }
  }

  // 目的地是目錄時，每個來源實際寫入 `<目錄>/<檔名>`，只檢查目錄本身不夠
  // （`cp cardiary.sqlite state/` 會寫到 `state/cardiary.sqlite`）。目的地有兩個
  // 來源：GNU coreutils 的 `-t`／`--target-directory`，或最後一個位置參數解析
  // 成既有目錄（`cp a b/`、`cp a b c dir` 的 shell 語意）。最後一個位置參數
  // 不是既有目錄時，照原本的 `inputs-last-output` 規則（`cp a b` 的 b 是輸出檔）。
  let risk: Risk = deletes ? "medium" : "low";
  let sawAsk = false;
  const spreadsIntoDirectory =
    semantics === "inputs-last-output" || semantics === "delete-last-output";
  const targetDirFlag = spreadsIntoDirectory
    ? parsed.options.find((option) => optionEffect(option.rule) === "targetdir")
    : undefined;
  let destDir: string | null = null;
  let destDirFromLast = false;
  if (targetDirFlag !== undefined) {
    const value = targetDirFlag.value;
    if (value === null || value.length === 0) {
      return askHuman(PERMISSION_RULES.askShell, "high");
    }
    const resolved = resolvePath(value, context);
    if (!resolved.ok) {
      return deny(resolved.rule, resolved.reason);
    }
    destDir = resolved.path.resolved;
    if (!isExistingDirectory(destDir)) {
      // 不是目錄：GNU cp／mv／install 會直接失敗；保守地把值本身當寫入目標。
      const verdict = evaluateWritePath(resolved.path, context, "write");
      if (verdict.kind === "deny") {
        return verdict;
      }
      sawAsk = true;
    }
  } else if (spreadsIntoDirectory && pathArguments.length >= 2) {
    const last = pathArguments[pathArguments.length - 1] ?? "";
    const resolved = resolvePath(last, context);
    if (resolved.ok && isExistingDirectory(resolved.path.resolved)) {
      destDir = resolved.path.resolved;
      destDirFromLast = true;
    }
  }
  // `-t` 的情況下所有位置參數都是來源；最後一個參數是目錄時，最後一個是目的地。
  const allPositionalsAreSources = destDir !== null && !destDirFromLast;

  if (semantics === "none" && pathArguments.length > 0) {
    sawAsk = true;
    risk = "high";
  }
  if (deletes && pathArguments.length === 0) {
    if (semantics === "delete-targets") {
      // `rm` 沒有目標：指令本身會失敗，但也不能因此放行。
      return askHuman(PERMISSION_RULES.askShell, "high");
    }
    // 有刪除旗標卻解析不出目標（`find -delete`、`find -name '*.md' -delete`）：
    // 不知道它會刪什麼，不能讓它逃過審批。
    return deny(PERMISSION_RULES.zoneBulkDelete, "刪除旗標沒有可解析的目標");
  }
  if (writesPositionals && pathArguments.length === 0) {
    // 寫入型指令沒有解析出任何目標（只有旗標）：不是唯讀查詢，不自動放行。
    return askHuman(PERMISSION_RULES.askShell, "high");
  }

  // 寫入型選項（`sort -o`、`find -fprint`…）：先讓 deny 有機會勝出。
  for (const option of parsed.options) {
    if (optionEffect(option.rule) !== "write") {
      continue;
    }
    const denial = denyWriteOption(option.value, context);
    if (denial !== null) {
      return denial;
    }
    risk = "high";
    sawAsk = true;
  }

  for (const [index, argument] of pathArguments.entries()) {
    const kind =
      !deletes && allPositionalsAreSources
        ? semantics === "delete-last-output"
          ? "delete"
          : "read"
        : targetKind(semantics, index, pathArguments.length, deletes);
    const resolved = resolvePath(argument, context);
    if (!resolved.ok) {
      if (kind !== "read") {
        return deny(resolved.rule, resolved.reason);
      }
      // 不是路徑的參數（樣式、數字）解析失敗不影響判定。
      continue;
    }
    const verdict =
      kind === "delete"
        ? evaluateWritePath(resolved.path, context, "delete", recursive)
        : kind === "write"
          ? evaluateWritePath(resolved.path, context, "write")
          : evaluateReadPath(resolved.path, { ...context, list: false });
    if (verdict.kind === "deny") {
      return verdict;
    }
    if (kind === "write") {
      // 指令寫檔不是唯讀查詢：一律詢問 high，不隨目標落在哪一區降級。
      sawAsk = true;
      risk = "high";
      continue;
    }
    if (verdict.kind === "ask-human") {
      sawAsk = true;
      risk = maxRisk(risk, verdict.risk);
      continue;
    }
    if (kind === "delete") {
      // 刪除不會因為落在 tmp/ 就自動放行。
      sawAsk = true;
      risk = maxRisk(risk, "medium");
    }
  }

  // 目的地是目錄：每個來源寫入 `<目錄>/<檔名>`，逐一個別判定。
  if (destDir !== null) {
    const sourceCount = destDirFromLast ? pathArguments.length - 1 : pathArguments.length;
    for (const source of pathArguments.slice(0, sourceCount)) {
      const base = path.basename(source);
      if (base.length === 0 || base === "." || base === "..") {
        continue;
      }
      const resolved = resolvePath(path.join(destDir, base), context);
      if (!resolved.ok) {
        return deny(resolved.rule, resolved.reason);
      }
      const verdict = evaluateWritePath(resolved.path, context, "write");
      if (verdict.kind === "deny") {
        return verdict;
      }
      sawAsk = true;
      risk = "high";
    }
  }

  // 執行型與語意不明的選項：一律詢問。放在目標之後，deny 才不會被這裡擋掉。
  if (parsed.options.some((option) => isNotReadOnly(option.rule))) {
    sawAsk = true;
    risk = "high";
  }

  if (sawAsk) {
    return askHuman(deletes ? PERMISSION_RULES.askFsDelete : PERMISSION_RULES.askShell, risk);
  }
  return allow(PERMISSION_RULES.shellReadWorkspace);
}

type TargetKind = "read" | "write" | "delete";

/**
 * 位置參數的語意 → 每個參數的判定種類。
 *
 * `delete-last-output`（`mv`）的來源是刪除目標：來源會消失，判定與 `rm` 相同。
 */
function targetKind(
  semantics: PositionalSemantics,
  index: number,
  count: number,
  deletes: boolean,
): TargetKind {
  if (deletes) {
    return "delete";
  }
  switch (semantics) {
    case "input-output":
      return index === 1 ? "write" : "read";
    case "inputs-last-output":
      return index === count - 1 ? "write" : "read";
    case "delete-last-output":
      return index === count - 1 ? "write" : "delete";
    case "outputs":
      return "write";
    default:
      return "read";
  }
}

/** 執行型與語意不明的選項都不是唯讀。 */
function isNotReadOnly(rule: OptionRule): boolean {
  const effect = optionEffect(rule);
  return effect === "exec" || effect === "opaque";
}

/**
 * 單一寫入型選項的目標（`sort -o`、`--output=`、`find -fprint`）。
 *
 * 目標走 `evaluateWritePath`：保護路徑回 deny，其餘回 null 讓呼叫端詢問
 * high——指令寫檔不是唯讀查詢，不因為落在 `tmp/` 就放行。
 */
function denyWriteOption(target: string | null, context: ShellContext): PermissionVerdict | null {
  if (target === null || target.length === 0) {
    return null;
  }
  const resolved = resolvePath(target, context);
  if (!resolved.ok) {
    return null;
  }
  const verdict = evaluateWritePath(resolved.path, context, "write");
  return verdict.kind === "deny" ? verdict : null;
}

/**
 * 能力表以外的指令（或解析失敗的參數）掃描保護目標。
 *
 * 未知指令不知道哪個參數是讀取、寫入還是刪除，所以只要 token 看起來像路徑、
 * 解析後落在保護目標就拒絕：憑證、狀態庫與 `folder.json`、系統目錄、App
 * bundle 走 `evaluateWritePath`（與檔案工具同一套判定）；正本區與資料夾根另外
 * 拒絕，因為未知指令可能正在刪除它，而刪除正本區不能退回詢問讓白名單放行。
 *
 * 沒有斜線的 token（`cards`、`state`）用 cwd 解析後比對；它們也可能是樣式、
 * 腳本或不存在的路徑，所以只有解析後存在的才當保護目標。其餘 token 不回傳
 * 結果，由呼叫端詢問。解析失敗同理：`sed` 的 `s/a/b/` 這類樣式解析失敗很常見，
 * 不能因此全面誤擋。
 */
function protectedPathDenial(
  tokens: readonly string[],
  context: ShellContext,
): PermissionVerdict | null {
  for (const token of tokens) {
    for (const candidate of pathCandidates(token)) {
      const resolved = resolvePath(candidate.path, context);
      if (!resolved.ok) {
        continue;
      }
      const write = evaluateWritePath(resolved.path, context, "write");
      if (write.kind === "deny") {
        return write;
      }
      if (candidate.bare && !resolved.path.exists) {
        // 沒有斜線的 token 可能是樣式、腳本或不存在的路徑；不存在就不是
        // 「碰得到」的保護目標，交給最後的詢問。
        continue;
      }
      if (isOriginZonePath(resolved.path, context.folderRoot)) {
        return deny(
          PERMISSION_RULES.zoneBulkDelete,
          `參數指向正本區或資料夾根（${candidate.path}）`,
        );
      }
    }
  }
  return null;
}

/**
 * 從一個 token 取出可能是路徑的子字串。
 *
 * - 含 `=` 時取等號後面的值（`--output=/etc/hosts`、`--file=state/cardiary.sqlite`）。
 * - 含 `/` 時取整串（`../outside/x`）；以 `-` 開頭時從第一個 `/` 切到結尾
 *   （`-o/etc/hosts`、`-nstate/cardiary.sqlite`）。
 * - 沒有 `/` 的一般 token（`cards`、`state`、`folder.json`）也當候選：用 cwd
 *   解析後才知道它是不是保護目標，不能只看寫法有沒有斜線。這種 token 可能是
 *   樣式或腳本（`sed` 的 `s#a#b#`），所以標成 `bare`，呼叫端只接受解析後
 *   存在的路徑。
 * - 以 `-` 開頭又沒有 `=` 或 `/` 的是選項，不當路徑。
 */
interface PathCandidate {
  readonly path: string;
  /** 沒有斜線也沒有 `=` 的單字：解析後不是既有路徑就不當保護目標。 */
  readonly bare: boolean;
}

function pathCandidates(token: string): readonly PathCandidate[] {
  if (token.length === 0 || token === "-" || token === "--") {
    return [];
  }
  const candidates = new Set<string>();
  const equals = token.indexOf("=");
  if (equals >= 0 && equals + 1 < token.length) {
    candidates.add(token.slice(equals + 1));
  }
  const slash = token.indexOf("/");
  if (slash >= 0) {
    candidates.add(token.startsWith("-") ? token.slice(slash) : token);
    return [...candidates].map((candidate) => ({ path: candidate, bare: false }));
  }
  // `.` 與 `..` 單獨出現時不算候選：它們會解析成目前目錄或上層，任何帶斜線的
  // 寫法（`./`、`../`）已經在上面的分支處理過；這裡再算一次只會讓
  // `find . -exec …` 這類唯讀起點被誤擋。
  if (!token.startsWith("-") && token !== "." && token !== "..") {
    candidates.add(token);
  }
  return [...candidates].map((candidate) => ({ path: candidate, bare: true }));
}

/** 路徑是 Cardiary 資料夾的根或落在正本區之內。 */
function isOriginZonePath(resolved: ResolvedPath, folderRoot: string): boolean {
  const sensitivity = detectCaseSensitivity(resolved.resolved);
  const same =
    sensitivity === "case-sensitive"
      ? resolved.resolved === folderRoot
      : resolved.resolved.toLowerCase() === folderRoot.toLowerCase();
  return same || originZoneOf(folderRoot, resolved.resolved) !== null;
}

/**
 * 是不是一條單純的唯讀 git 查詢。
 *
 * 委派判斷用的嚴格版本：只接受單一 `git` 段、沒有變數指派、沒有串接、
 * 子殼層或重導向，而且 git 子命令與參數都在唯讀白名單內。`ls`、`cat`
 * 這類檔案查詢不算 git，走 `read-only-files`。
 */
export function isReadonlyGitCommand(command: string, context: ShellContext): boolean {
  const parsed = parseCommandLine(command);
  if (
    parsed.parseError !== null ||
    parsed.operators.length > 0 ||
    parsed.redirects.length > 0 ||
    parsed.substitutions.length > 0 ||
    parsed.segments.length !== 1
  ) {
    return false;
  }
  const segment = parsed.segments[0];
  if (
    segment === undefined ||
    segment.command !== "git" ||
    segment.assignments.length > 0 ||
    segment.args.length === 0
  ) {
    return false;
  }
  return evaluateGit(segment.args, context).kind === "allow";
}

function evaluateGit(args: readonly string[], context: ShellContext): PermissionVerdict {
  let index = 0;
  while (index < args.length) {
    const arg = args[index] ?? "";
    if (isGitForbiddenArgument(arg)) {
      return askHuman(PERMISSION_RULES.askShell, "high");
    }
    if (arg === "--no-pager") {
      index += 1;
      continue;
    }
    if (arg === "-C") {
      const target = args[index + 1];
      if (target === undefined) {
        return askHuman(PERMISSION_RULES.askShell, "high");
      }
      const verdict = checkGitDirectory(target, context);
      if (verdict !== null) {
        return verdict;
      }
      index += 2;
      continue;
    }
    if (arg.startsWith("-C") && arg.length > 2) {
      const verdict = checkGitDirectory(arg.slice(2), context);
      if (verdict !== null) {
        return verdict;
      }
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      return askHuman(PERMISSION_RULES.askShell, "high");
    }
    break;
  }

  const subcommand = args[index];
  if (subcommand === undefined) {
    return askHuman(PERMISSION_RULES.askShell, "high");
  }
  const rest = args.slice(index + 1);
  if (rest.some((arg) => isGitForbiddenArgument(arg))) {
    return askHuman(PERMISSION_RULES.askShell, "high");
  }

  if (subcommand === "stash") {
    return rest.length === 1 && rest[0] === "list"
      ? allow(PERMISSION_RULES.vcsRead)
      : askHuman(PERMISSION_RULES.askShell, "high");
  }
  if (subcommand === "remote") {
    return rest.length === 1 && rest[0] === "-v"
      ? allow(PERMISSION_RULES.vcsRead)
      : askHuman(PERMISSION_RULES.askShell, "high");
  }
  if (!GIT_SUBCOMMANDS.has(subcommand)) {
    return askHuman(PERMISSION_RULES.askShell, "high");
  }
  if (subcommand === "branch") {
    return rest.every((arg) => GIT_BRANCH_ARGS.has(arg))
      ? allow(PERMISSION_RULES.vcsRead)
      : askHuman(PERMISSION_RULES.askShell, "high");
  }
  if (subcommand === "tag") {
    return rest.every((arg) => GIT_TAG_ARGS.has(arg))
      ? allow(PERMISSION_RULES.vcsRead)
      : askHuman(PERMISSION_RULES.askShell, "high");
  }
  return allow(PERMISSION_RULES.vcsRead);
}

/** `--output`、`--output=…`、`-o`、`-c` 一律視為禁止的旗標。 */
function isGitForbiddenArgument(argument: string): boolean {
  if (GIT_FORBIDDEN_ARGS.has(argument)) {
    return true;
  }
  // `-ccore.fsmonitor=…`：git 的短選項可以直接黏著值，前綴不能放過。
  if (argument.length > 2 && argument.startsWith("-c") && !argument.startsWith("--")) {
    return true;
  }
  const equals = argument.indexOf("=");
  if (equals > 0) {
    return GIT_FORBIDDEN_ARGS.has(argument.slice(0, equals));
  }
  return false;
}

function checkGitDirectory(target: string, context: ShellContext): PermissionVerdict | null {
  const resolved = resolvePath(target, context);
  if (!resolved.ok) {
    return deny(resolved.rule, resolved.reason);
  }
  if (!resolved.path.insideWorkingDir && !resolved.path.insideFolderRoot) {
    return askHuman(PERMISSION_RULES.askShell, "high");
  }
  return null;
}

/** cwd 是否在允許的根之內；`shell.vcs-read` 的額外條件。 */
export function isCommandWorkingDirAllowed(cwd: string, context: ShellContext): boolean {
  return isWithin(context.workingDir, cwd) || isWithin(context.folderRoot, cwd);
}
