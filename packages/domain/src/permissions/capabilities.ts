import type { OptionRule, OptionTable } from "./getopt.js";

/**
 * 命令能力表。
 *
 * 每一個可以自動放行的指令在這裡宣告三件事：位置參數的語意（哪些位置是輸入、
 * 哪個位置是輸出）、哪些選項會寫檔或執行程式、選項的寫法（getopt 群組或整字
 * 主詞）。通用解析器照這張表解析，寫入目標只走一次 `evaluateWritePath`；因此
 * `-o/path`、`-no/path`、`--out=/path` 這類等價寫法不需要逐個補規則。
 *
 * 表上沒有的指令一律詢問（`ask.shell`），不會預設放行。表上沒宣告的選項形狀
 * 也一樣：不認得就代表不知道它吃不吃值、會不會寫檔，一律詢問。
 *
 * 加一個新指令或新選項時，只需要在這裡加一行，並補一個測試。
 */

/** 位置參數的語意。 */
export type PositionalSemantics =
  | "inputs" // 全部是讀取目標（預設）。
  | "none" // 不接受位置參數。
  | "input-output" // 第 1 個讀、第 2 個寫（`uniq`）。
  | "delete-targets" // 全部是刪除目標（`rm`）。
  | "inputs-last-output" // 最後一個是輸出，其餘是輸入（`cp`、`ln`、`install`）；最後一個是既有目錄時，每個來源實際寫入 `<目錄>/<檔名>`。
  | "delete-last-output" // 來源刪除、最後一個是輸出（`mv`）；最後一個是既有目錄時同樣接 `<目錄>/<檔名>`。
  | "outputs"; // 全部是輸出（`tee`、`touch`、`mkdir`）。

/** 選項的寫法。 */
export type OptionStyle = "getopt" | "primary";

export interface CommandCapability {
  /** 位置參數怎麼解讀。 */
  readonly positionals: PositionalSemantics;
  /** `getopt`（大部分指令）或 `primary`（`find` 的運算式主詞）。 */
  readonly style: OptionStyle;
  readonly options: OptionTable;
  /** 遞迴刪除的短選項字母（`rm` 的 `r`／`R`）。 */
  readonly recursiveFlags?: readonly string[];
  /** 刪除一律視為遞迴（`find -delete`）。 */
  readonly deleteAlwaysRecursive?: boolean;
}

/** 短選項：字母清單。 */
interface ShortSpec {
  /** 無值旗標。 */
  readonly flags?: string;
  /** 帶值，值是讀取路徑。 */
  readonly read?: string;
  /** 帶值，值不影響判定（數字、樣式、分隔符）。 */
  readonly inert?: string;
  /** 帶值，值是寫入目標。 */
  readonly write?: string;
  /** 帶值，值是要執行的程式。 */
  readonly exec?: string;
  /** 不是唯讀，但原因不是執行或寫入（例如改系統時鐘）。 */
  readonly opaque?: string;
  /** 無值，但會刪除。 */
  readonly deletes?: string;
  /** 帶值，值是接收所有位置參數的目錄（GNU `-t`）。 */
  readonly targetDir?: string;
}

/** 長選項與整字主詞：名稱清單。 */
interface NamedSpec {
  readonly flags?: readonly string[];
  readonly read?: readonly string[];
  readonly inert?: readonly string[];
  readonly write?: readonly string[];
  readonly exec?: readonly string[];
  readonly opaque?: readonly string[];
  readonly deletes?: readonly string[];
  /** 值可有可無（`--color[=WHEN]`）。 */
  readonly optional?: readonly string[];
  /** 值是位置參數的一部分（`find -f <path>` 的起點）。 */
  readonly paths?: readonly string[];
  /** 帶值，值是接收所有位置參數的目錄（GNU `--target-directory`）。 */
  readonly targetDir?: readonly string[];
}

interface CapabilitySpec {
  readonly positionals?: PositionalSemantics;
  readonly style?: OptionStyle;
  readonly short?: ShortSpec;
  readonly long?: NamedSpec;
  readonly primary?: NamedSpec;
  readonly recursiveFlags?: string;
  readonly deleteAlwaysRecursive?: boolean;
}

function addRules(
  rules: Record<string, OptionRule>,
  names: readonly string[] | undefined,
  rule: OptionRule,
): void {
  for (const name of names ?? []) {
    rules[name] = rule;
  }
}

function namedRules(spec: NamedSpec | undefined): Record<string, OptionRule> {
  const rules: Record<string, OptionRule> = {};
  const flag: OptionRule = { arity: "none" };
  addRules(rules, spec?.flags, flag);
  addRules(rules, spec?.read, { arity: "required", effect: "read" });
  addRules(rules, spec?.inert, { arity: "required", effect: "inert" });
  addRules(rules, spec?.write, { arity: "required", effect: "write" });
  addRules(rules, spec?.exec, { arity: "required", effect: "exec" });
  addRules(rules, spec?.opaque, { arity: "required", effect: "opaque" });
  addRules(rules, spec?.deletes, { arity: "none", effect: "delete" });
  addRules(rules, spec?.optional, { arity: "optional", effect: "inert" });
  addRules(rules, spec?.paths, { arity: "required", effect: "read", positional: true });
  addRules(rules, spec?.targetDir, { arity: "required", effect: "targetdir" });
  return rules;
}

function shortRules(spec: ShortSpec | undefined): Record<string, OptionRule> {
  const rules: Record<string, OptionRule> = {};
  addRules(rules, spec?.flags === undefined ? [] : [...spec.flags], { arity: "none" });
  addRules(rules, spec?.read === undefined ? [] : [...spec.read], {
    arity: "required",
    effect: "read",
  });
  addRules(rules, spec?.inert === undefined ? [] : [...spec.inert], {
    arity: "required",
    effect: "inert",
  });
  addRules(rules, spec?.write === undefined ? [] : [...spec.write], {
    arity: "required",
    effect: "write",
  });
  addRules(rules, spec?.exec === undefined ? [] : [...spec.exec], {
    arity: "required",
    effect: "exec",
  });
  addRules(rules, spec?.opaque === undefined ? [] : [...spec.opaque], {
    arity: "required",
    effect: "opaque",
  });
  addRules(rules, spec?.deletes === undefined ? [] : [...spec.deletes], {
    arity: "none",
    effect: "delete",
  });
  addRules(rules, spec?.targetDir === undefined ? [] : [...spec.targetDir], {
    arity: "required",
    effect: "targetdir",
  });
  return rules;
}

function capability(spec: CapabilitySpec): CommandCapability {
  const named = spec.style === "primary" ? spec.primary : spec.long;
  const built: CommandCapability = {
    positionals: spec.positionals ?? "inputs",
    style: spec.style ?? "getopt",
    options: {
      short: spec.style === "primary" ? {} : shortRules(spec.short),
      long: namedRules(named),
    },
  };
  return {
    ...built,
    ...(spec.recursiveFlags === undefined ? {} : { recursiveFlags: [...spec.recursiveFlags] }),
    ...(spec.deleteAlwaysRecursive === undefined
      ? {}
      : { deleteAlwaysRecursive: spec.deleteAlwaysRecursive }),
  };
}

/** grep／egrep／fgrep 共用同一組選項。 */
const grep = capability({
  short: { flags: "EFGHILPRSUVabchilnoqrsuvwxyzZ", inert: "ABCmdDe", read: "f" },
  long: {
    flags: [
      "extended-regexp",
      "fixed-strings",
      "basic-regexp",
      "perl-regexp",
      "decompress",
      "with-filename",
      "no-filename",
      "filename",
      "ignore-case",
      "no-ignore-case",
      "recursive",
      "dereference-recursive",
      "files-with-matches",
      "files-without-match",
      "count",
      "line-number",
      "line-buffered",
      "byte-offset",
      "only-matching",
      "quiet",
      "silent",
      "no-messages",
      "invert-match",
      "word-regexp",
      "line-regexp",
      "null",
      "null-data",
      "text",
      "unix-byte-offsets",
      "initial-tab",
      "help",
      "version",
    ],
    optional: ["color", "colour"],
    inert: [
      "after-context",
      "before-context",
      "context",
      "directories",
      "devices",
      "max-count",
      "label",
      "binary-files",
      "exclude",
      "exclude-dir",
      "include",
      "include-dir",
      "group-separator",
    ],
    read: ["file", "exclude-from"],
  },
});

/**
 * 命令能力表。
 *
 * 說明：
 * - `write`／`exec`／`opaque`／`deletes` 是安全相關的宣告，改動前先想清楚。
 * - 只有「值一定是路徑」的選項才放進 `read`；樣式、數字、分隔符放 `inert`，
 *   否則 `grep -e /etc/passwd` 這種樣式會被當成系統路徑而多問一次。
 * - `find` 用 `style: "primary"`：它的引數是運算式，`-fprintf` 不能被拆成
 *   `-f` 加 `printf`。
 */
export const COMMAND_CAPABILITIES: Readonly<Record<string, CommandCapability>> = {
  // 檔案查詢與文字處理。
  cat: capability({
    short: { flags: "AbbeEnstTuv" },
    long: {
      flags: [
        "number",
        "number-nonblank",
        "show-all",
        "show-ends",
        "show-tabs",
        "squeeze-blank",
        "show-nonprinting",
        "help",
        "version",
      ],
    },
  }),
  head: capability({
    short: { flags: "qvz", inert: "cn" },
    long: {
      flags: ["quiet", "silent", "verbose", "zero-terminated", "help", "version"],
      inert: ["bytes", "lines"],
    },
  }),
  tail: capability({
    short: { flags: "fFqrvz", inert: "cns" },
    long: {
      flags: ["retry", "verbose", "quiet", "silent", "zero-terminated", "help", "version"],
      inert: ["bytes", "lines", "sleep-interval", "max-unchanged-stats", "pid"],
      optional: ["follow"],
    },
  }),
  less: capability({
    short: {
      flags: "aAbBcCeEfFgGhHiIjJlLmMnNqQrRsSuUvVwWX468",
      inert: "bhjDpPxyz",
      read: "kt",
      write: "oOT",
    },
    long: {
      flags: [
        "clear-screen",
        "quit-at-eof",
        "quit-if-one-screen",
        "chop-long-lines",
        "ignore-case",
        "status-column",
        "long-prompt",
        "plain",
        "raw-control-chars",
        "squeeze-blank-lines",
        "no-init",
        "no-underline",
        "use-backslash",
        "wheel-lines",
        "help",
        "version",
      ],
      inert: [
        "buffers",
        "tabs",
        "window",
        "max-buffers",
        "max-load",
        "prompt",
        "search-skip-screen",
      ],
    },
  }),
  more: capability({
    short: { flags: "cdfLlpsu", inert: "n" },
    long: { flags: ["help", "version"], inert: ["lines", "number"] },
  }),
  wc: capability({
    short: { flags: "clmwL" },
    long: {
      flags: ["bytes", "chars", "lines", "words", "max-line-length", "total", "help", "version"],
      read: ["files0-from"],
    },
  }),
  file: capability({
    short: { flags: "bdefhiIklLnpqrsSvz0", inert: "eFP", read: "fm", opaque: "C" },
    long: {
      flags: [
        "brief",
        "uncompress",
        "compressed",
        "debug",
        "dereference",
        "no-dereference",
        "mime",
        "mime-type",
        "mime-encoding",
        "keep-going",
        "list",
        "no-pad",
        "print0",
        "no-buffer",
        "unbuffer",
        "raw",
        "extension",
        "apple",
        "help",
        "version",
      ],
      inert: ["separator"],
      read: ["files-from", "magic-file"],
    },
  }),
  stat: capability({
    short: { flags: "LlNnqrstx", inert: "cf" },
    long: {
      flags: ["dereference", "file-system", "follow", "terse", "help", "version"],
      inert: ["format", "printf"],
    },
  }),
  ls: capability({
    short: { flags: "1aAbBcCDFGgHhikLlMmnopqRrSsTtUuWwxX@", inert: "ITw" },
    long: {
      flags: [
        "all",
        "almost-all",
        "escape",
        "directory",
        "classify",
        "file-type",
        "full-time",
        "group-directories-first",
        "human-readable",
        "si",
        "inode",
        "numeric-uid-gid",
        "recursive",
        "reverse",
        "size",
        "one-per-line",
        "no-owner",
        "no-group",
        "show-control-chars",
        "literal",
        "help",
        "version",
      ],
      optional: ["color", "colour", "hyperlink"],
      inert: [
        "block-size",
        "format",
        "hide",
        "ignore",
        "time",
        "time-style",
        "sort",
        "width",
        "tabsize",
        "quoting-style",
        "indicator-style",
        "hide-pattern",
      ],
    },
  }),
  tree: capability({
    short: { flags: "aAbCdeEfFghilnopqQrRsStuUvxX", inert: "ILPST", write: "o" },
    long: {
      flags: [
        "noreport",
        "prune",
        "du",
        "inodes",
        "device",
        "gitignore",
        "fromfile",
        "help",
        "version",
      ],
      inert: ["filelimit", "timefmt", "charset", "sort"],
    },
  }),
  grep,
  egrep: grep,
  fgrep: grep,
  rg: capability({
    short: { flags: "0FHIUNSVabchilnopqsuvwxz", inert: "ABCdEegjMmrtT", read: "f" },
    long: {
      flags: [
        "text",
        "byte-offset",
        "count",
        "count-matches",
        "files-with-matches",
        "files-without-match",
        "line-number",
        "no-line-number",
        "only-matching",
        "quiet",
        "no-messages",
        "invert-match",
        "word-regexp",
        "line-regexp",
        "fixed-strings",
        "smart-case",
        "case-sensitive",
        "ignore-case",
        "multiline",
        "multiline-dotall",
        "search-zip",
        "pretty",
        "hidden",
        "glob-case-insensitive",
        "no-ignore",
        "no-ignore-vcs",
        "no-ignore-parent",
        "no-ignore-global",
        "no-ignore-dot",
        "no-ignore-exclude",
        "no-require-git",
        "follow",
        "one-file-system",
        "binary",
        "stats",
        "files",
        "json",
        "vimgrep",
        "heading",
        "no-heading",
        "with-filename",
        "no-filename",
        "debug",
        "trace",
        "pcre2",
        "no-pcre2",
        "crlf",
        "null",
        "null-data",
        "trim",
        "no-unicode",
        "unicode",
        "stop-on-nonmatch",
        "passthru",
        "block-buffered",
        "line-buffered",
        "no-mmap",
        "mmap",
        "unrestricted",
        "help",
        "version",
      ],
      inert: [
        "after-context",
        "before-context",
        "context",
        "encoding",
        "max-depth",
        "glob",
        "iglob",
        "threads",
        "max-columns",
        "max-count",
        "max-filesize",
        "replace",
        "type",
        "type-not",
        "type-add",
        "type-clear",
        "sort",
        "sortr",
        "color",
        "colors",
        "path-separator",
        "field-match-separator",
        "field-context-separator",
        "context-separator",
        "pre-glob",
        "engine",
        "dfa-size-limit",
        "regex-size-limit",
      ],
      read: ["file", "ignore-file"],
      exec: ["pre", "hostname-bin"],
    },
  }),
  ag: capability({
    short: { flags: "0aAcCdfFhHilLmnoQqrRsStTuUvVwWz", inert: "ABCGgm", read: "p" },
    long: {
      flags: [
        "follow",
        "nocolor",
        "nogroup",
        "numbers",
        "column",
        "filename",
        "hidden",
        "ignore",
        "smart-case",
        "stats",
        "silent",
        "all-types",
        "search-binary",
        "unrestricted",
        "help",
        "version",
      ],
      inert: ["depth", "max-count", "after", "before", "context"],
      exec: ["pager"],
    },
  }),
  jq: capability({
    short: { flags: "acehjnrRsSaCM", read: "fL" },
    long: {
      flags: [
        "compact-output",
        "exit-status",
        "join-output",
        "null-input",
        "raw-output",
        "raw-input",
        "slurp",
        "sort-keys",
        "ascii-output",
        "color-output",
        "monochrome-output",
        "tab",
        "stream",
        "stream-errors",
        "seq",
        "unbuffered",
        "run-tests",
        "args",
        "jsonargs",
        "raw-output0",
        "help",
        "version",
      ],
      inert: ["indent", "binary"],
      // --arg／--argjson／--rawfile／--slurpfile 都吃兩個值：第一個是名稱，
      // 第二個才是檔案。解析器只吃掉第一個，第二個留在位置參數裡照讀取路徑
      // 檢查，方向安全。
      read: ["from-file", "library-path", "arg", "argjson", "rawfile", "slurpfile", "argfile"],
    },
  }),
  cmp: capability({
    short: { flags: "bls", inert: "in" },
    long: {
      flags: ["print-bytes", "print-chars", "verbose", "silent", "quiet", "help", "version"],
      inert: ["ignore-initial", "bytes"],
    },
  }),
  diff: capability({
    short: { flags: "abBcdeEfFhiIlmNnPpqrsSuvwy", inert: "CDFLSTUWx", read: "X" },
    long: {
      flags: [
        "brief",
        "recursive",
        "new-file",
        "text",
        "ignore-case",
        "ignore-all-space",
        "ignore-space-change",
        "ignore-blank-lines",
        "minimal",
        "no-ignore-file-name-case",
        "ignore-file-name-case",
        "speed-large-files",
        "expand-tabs",
        "initial-tab",
        "suppress-common-lines",
        "left-column",
        "right-column",
        "normal",
        "side-by-side",
        "help",
        "version",
      ],
      inert: [
        "label",
        "exclude",
        "ignore-matching-lines",
        "line-format",
        "old-line-format",
        "new-line-format",
        "unified",
        "context",
        "width",
        "horizon-lines",
        "tabsize",
      ],
      read: ["from-file", "to-file", "exclude-from"],
    },
  }),
  nl: capability({
    short: { flags: "p", inert: "bdfhilnsvw" },
    long: {
      flags: ["no-renumber", "no-traditional", "help", "version"],
      inert: [
        "body-numbering",
        "section-delimiter",
        "footer-numbering",
        "header-numbering",
        "line-increment",
        "join-blank-lines",
        "number-format",
        "number-separator",
        "starting-line-number",
        "number-width",
      ],
    },
  }),
  cut: capability({
    short: { flags: "nsz", inert: "bcdf" },
    long: {
      flags: ["only-delimited", "complement", "zero-terminated", "help", "version"],
      inert: ["bytes", "characters", "delimiter", "fields", "output-delimiter"],
    },
  }),
  tr: capability({
    short: { flags: "cCdst" },
    long: {
      flags: ["complement", "delete", "squeeze-repeats", "truncate-set1", "help", "version"],
    },
  }),
  column: capability({
    short: { flags: "etxnsHTRl", inert: "csoW" },
    long: {
      flags: ["table", "fillrows", "keep-empty-lines"],
      inert: ["separator", "table-columns"],
    },
  }),

  // 摘要與路徑工具。
  md5: capability({
    short: { flags: "prqtx", inert: "s" },
    long: { flags: ["quiet", "reverse", "help", "version"] },
  }),
  md5sum: capability({
    short: { flags: "bctw" },
    long: {
      flags: [
        "binary",
        "check",
        "text",
        "warn",
        "strict",
        "quiet",
        "status",
        "zero",
        "ignore-missing",
        "help",
        "version",
      ],
      inert: ["tag"],
    },
  }),
  sha256sum: capability({
    short: { flags: "bctw" },
    long: {
      flags: [
        "binary",
        "check",
        "text",
        "warn",
        "strict",
        "quiet",
        "status",
        "zero",
        "ignore-missing",
        "help",
        "version",
      ],
      inert: ["tag"],
    },
  }),
  shasum: capability({
    short: { flags: "bpt0", inert: "a" },
    long: { flags: ["binary", "text", "zero", "help", "version"], inert: ["algorithm", "tag"] },
  }),
  realpath: capability({
    short: { flags: "eEmPqsL" },
    long: {
      flags: [
        "canonicalize-existing",
        "canonicalize-missing",
        "physical",
        "logical",
        "quiet",
        "strip",
        "no-symlinks",
        "help",
        "version",
      ],
      inert: ["relative-base", "relative-to"],
    },
  }),
  basename: capability({
    short: { flags: "a" },
    long: { flags: ["multiple", "zero", "help", "version"], inert: ["suffix"] },
  }),
  dirname: capability({ short: { flags: "z" }, long: { flags: ["zero", "help", "version"] } }),
  pwd: capability({
    positionals: "none",
    short: { flags: "LP" },
    long: { flags: ["logical", "physical", "help", "version"] },
  }),
  echo: capability({ short: { flags: "nEe" }, long: { flags: ["help", "version"] } }),
  printf: capability({ long: { flags: ["help", "version"] } }),
  which: capability({
    short: { flags: "as" },
    long: {
      flags: [
        "all",
        "skip-dot",
        "skip-tilde",
        "show-dot",
        "show-tilde",
        "tty-only",
        "read-alias",
        "skip-alias",
        "read-functions",
        "skip-functions",
        "help",
        "version",
      ],
    },
  }),
  type: capability({ short: { flags: "afPpt" } }),
  true: capability({ positionals: "none", long: { flags: ["help", "version"] } }),
  false: capability({ positionals: "none", long: { flags: ["help", "version"] } }),
  whoami: capability({ positionals: "none", long: { flags: ["help", "version"] } }),
  id: capability({
    short: { flags: "Ggnru" },
    long: { flags: ["group", "groups", "name", "real", "user", "zero", "help", "version"] },
  }),
  uname: capability({
    positionals: "none",
    short: { flags: "amnprsv" },
    long: {
      flags: ["all", "machine", "nodename", "processor", "release", "sysname", "version", "help"],
    },
  }),
  du: capability({
    short: { flags: "HhklmsxabcgLP", inert: "d" },
    long: {
      flags: [
        "human-readable",
        "summarize",
        "one-file-system",
        "total",
        "apparent-size",
        "all",
        "count-links",
        "si",
        "inodes",
        "help",
        "version",
      ],
      inert: ["max-depth", "block-size", "exclude", "threshold"],
      optional: ["time"],
      read: ["files0-from"],
    },
  }),
  df: capability({
    short: { flags: "hHiklmPgTabc", inert: "t" },
    long: {
      flags: [
        "human-readable",
        "inodes",
        "local",
        "portability",
        "print-type",
        "all",
        "sync",
        "si",
        "total",
        "help",
        "version",
      ],
      inert: ["block-size", "output", "type", "exclude-type"],
    },
  }),
  date: capability({
    short: { flags: "jnRu", inert: "v", read: "rf", opaque: "s" },
    long: {
      flags: ["utc", "universal", "rfc-2822"],
      inert: ["date", "iso-8601"],
      read: ["file", "reference"],
      opaque: ["set"],
    },
  }),

  // 排序與去重：寫入目標由能力表宣告，形式交給通用解析器。
  sort: capability({
    short: { flags: "bcCdfghiMmnRrsuVz", inert: "kSt", write: "oT" },
    long: {
      flags: [
        "ignore-leading-blanks",
        "dictionary-order",
        "ignore-case",
        "ignore-nonprinting",
        "general-numeric-sort",
        "human-numeric-sort",
        "month-sort",
        "numeric-sort",
        "random-sort",
        "reverse",
        "stable",
        "unique",
        "version-sort",
        "zero-terminated",
        "merge",
        "check",
        "debug",
        "help",
        "version",
      ],
      inert: [
        "key",
        "field-separator",
        "buffer-size",
        "batch-size",
        "parallel",
        "sort",
        "random-source",
      ],
      write: ["output", "temporary-directory"],
      exec: ["compress-program"],
      read: ["files0-from"],
    },
  }),
  uniq: capability({
    // 第二個位置參數是輸出檔；`uniq input` 才是唯讀。
    positionals: "input-output",
    short: { flags: "cdDiuz", inert: "fsw" },
    long: {
      flags: ["count", "repeated", "unique", "ignore-case", "zero-terminated", "help", "version"],
      optional: ["all-repeated", "group"],
      inert: ["skip-fields", "skip-chars", "check-chars"],
    },
  }),

  // 刪除。
  rm: capability({
    positionals: "delete-targets",
    recursiveFlags: "rR",
    short: { flags: "fdIPRrvWx" },
    long: {
      flags: [
        "force",
        "interactive",
        "no-preserve-root",
        "preserve-root",
        "one-file-system",
        "recursive",
        "dir",
        "verbose",
        "help",
        "version",
      ],
    },
  }),
  rmdir: capability({
    positionals: "delete-targets",
    short: { flags: "pv" },
    long: { flags: ["parents", "verbose", "ignore-fail-on-non-empty", "help", "version"] },
  }),
  unlink: capability({
    positionals: "delete-targets",
    long: { flags: ["help", "version"] },
  }),

  // 寫入指令：位置參數的語意決定哪一個是寫入目標。全部寫入目標都走
  // `evaluateWritePath`（保護目標 deny、其餘詢問 high）；這些指令沒有
  // 「全部是讀取目標」的形狀，所以不會自動放行。
  cp: capability({
    positionals: "inputs-last-output",
    // GNU coreutils 的 -t／--target-directory（BSD 沒有）：目的地由選項帶入。
    short: { flags: "acfHinpPRrLuvX", inert: "S", targetDir: "t" },
    long: {
      flags: [
        "archive",
        "force",
        "interactive",
        "no-clobber",
        "preserve",
        "recursive",
        "verbose",
        "dereference",
        "no-dereference",
        "parents",
        "link",
        "help",
        "version",
      ],
      inert: ["suffix"],
      targetDir: ["target-directory"],
    },
  }),
  mv: capability({
    positionals: "delete-last-output",
    // GNU coreutils 的 -t／--target-directory（BSD 沒有）：目的地由選項帶入。
    short: { flags: "finvh", inert: "S", targetDir: "t" },
    long: {
      flags: ["force", "interactive", "no-clobber", "verbose", "help", "version"],
      inert: ["suffix"],
      targetDir: ["target-directory"],
    },
  }),
  ln: capability({
    positionals: "inputs-last-output",
    short: { flags: "FbfhinsvLPT", inert: "S" },
    long: {
      flags: [
        "force",
        "interactive",
        "backup",
        "no-dereference",
        "symbolic",
        "verbose",
        "logical",
        "physical",
        "help",
        "version",
      ],
      inert: ["suffix"],
    },
  }),
  tee: capability({
    positionals: "outputs",
    short: { flags: "aip" },
    long: { flags: ["append", "ignore-interrupts", "help", "version"], optional: ["output-error"] },
  }),
  touch: capability({
    positionals: "outputs",
    short: { flags: "achmf", inert: "Adrt" },
    long: {
      flags: ["no-create", "no-dereference", "help", "version"],
      inert: ["date", "reference", "time"],
    },
  }),
  mkdir: capability({
    positionals: "outputs",
    short: { flags: "pv", inert: "m" },
    long: { flags: ["parents", "verbose", "help", "version"], inert: ["mode"] },
  }),
  install: capability({
    positionals: "inputs-last-output",
    // GNU coreutils 的 -t／--target-directory（BSD 沒有）：目的地由選項帶入。
    short: { flags: "bCcDdpPsvV", inert: "BfgmoS", targetDir: "t" },
    long: {
      flags: [
        "compare",
        "directory",
        "preserve-timestamps",
        "strip",
        "verbose",
        "debug",
        "help",
        "version",
      ],
      inert: ["group", "mode", "owner", "suffix", "strip-program"],
      targetDir: ["target-directory"],
    },
  }),

  // find：運算式主詞，整字比對。
  find: capability({
    style: "primary",
    deleteAlwaysRecursive: true,
    primary: {
      flags: [
        "H",
        "L",
        "P",
        "E",
        "X",
        "d",
        "x",
        "s",
        "a",
        "and",
        "o",
        "or",
        "not",
        "print",
        "print0",
        "prune",
        "empty",
        "depth",
        "ls",
        "true",
        "false",
        "quit",
        "follow",
        "nowarn",
        "xdev",
        "mount",
        "readable",
        "writable",
        "executable",
        "acl",
        "xattr",
        "nouser",
        "nogroup",
        "noleaf",
      ],
      read: [
        "newer",
        "anewer",
        "cnewer",
        "samefile",
        "Bnewer",
        // -newerXY：X 是被檢查的檔案時間，Y 是參考的時間；Y 是 t 時
        // 參數是日期（見下方 inert 的 *t 形式）。
        "neweraa",
        "neweraB",
        "newerac",
        "neweram",
        "newerBa",
        "newerBB",
        "newerBc",
        "newerBm",
        "newerca",
        "newercB",
        "newercc",
        "newercm",
        "newerma",
        "newermB",
        "newermc",
        "newermm",
      ],
      inert: [
        "name",
        "iname",
        "path",
        "ipath",
        "wholename",
        "iwholename",
        "regex",
        "iregex",
        "type",
        "xtype",
        "size",
        "mtime",
        "atime",
        "ctime",
        "mmin",
        "amin",
        "cmin",
        "Bmin",
        "Btime",
        "user",
        "group",
        "perm",
        "flags",
        "uid",
        "gid",
        "links",
        "inum",
        "fstype",
        "maxdepth",
        "mindepth",
        "used",
        // Y=t 的 -newerXY：參數是日期字串，不是路徑。
        "newerat",
        "newerBt",
        "newerct",
        "newermt",
        // GNU find 的 -printf：輸出格式，不是路徑。
        "printf",
      ],
      write: ["fprint", "fprintf", "fls", "fprint0"],
      exec: ["exec", "execdir", "ok", "okdir"],
      deletes: ["delete", "rmdir"],
      paths: ["f"],
    },
  }),
};
