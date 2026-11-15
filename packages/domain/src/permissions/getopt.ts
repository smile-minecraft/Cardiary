/**
 * 通用參數解析：只處理語法，不知道任何指令的語意。
 *
 * 語意（值是讀取路徑、寫入目標還是要執行的程式）由命令能力表宣告；這裡負責
 * 把 token 切成「位置參數」與「選項」，並在遇到不認得的形式時舉手。呼叫端看到
 * `problem` 不是 null 就只能詢問，不得放行。
 *
 * 認得的形狀：
 *
 * - 短選項群組：`-abc`。群組裡遇到帶值的字母時，剩下的字元就是它的值
 *   （`-o/path`、`-no/path`）；沒有剩下的字元才取下一個 token（`-o /path`）。
 * - 長選項：`--output`、`--output=/path`、`--output /path`。名稱可以是已宣告
 *   長選項的無歧義前綴（`--out=`、`--ou=`、`--o=`），完全比對優先。
 * - `--` 之後全部是位置參數；單獨的 `-` 也是位置參數。主詞模式的 `--`
 *   不適用這一條，見 `parsePrimaryOptions`。
 * - 選項可以出現在位置參數前後，與 getopt 的預設排列一致。
 */

/** 選項吃不吃值。 */
export type OptionArity = "none" | "required" | "optional";

/**
 * 選項的語意：
 *
 * - `inert`：不影響判定（純旗標、數字、樣式）。
 * - `read`：值是讀取路徑。
 * - `write`：值是寫入目標。
 * - `exec`：會執行外部程式。
 * - `delete`：把位置參數當成刪除目標（`find -delete`）。
 * - `opaque`：不是唯讀（改系統狀態、語意不明），一律詢問。
 * - `targetdir`：值是接收所有位置參數的目錄（GNU coreutils 的 `cp -t`／`mv -t`／
 *   `install -t`／`--target-directory`）；每個位置參數實際寫入 `<目錄>/<檔名>`，
 *   呼叫端照「目錄目的地」處理，不當成單一寫入目標。
 */
export type OptionEffect = "inert" | "read" | "write" | "exec" | "delete" | "opaque" | "targetdir";

export interface OptionRule {
  /** 預設 `none`。 */
  readonly arity?: OptionArity;
  /** 預設：`none` 是 `inert`，其餘是 `read`。 */
  readonly effect?: OptionEffect;
  /** 值是位置參數的一部分（`find -f <path>` 的起點）。 */
  readonly positional?: boolean;
}

export interface OptionTable {
  /** 短選項：字母 → 規則。 */
  readonly short: Readonly<Record<string, OptionRule>>;
  /** 長選項：名稱（不含 `--`）→ 規則。 */
  readonly long: Readonly<Record<string, OptionRule>>;
}

export interface ParsedOption {
  /** 診斷用的名稱，例如 `-o`、`--output`、`-fprintf`。 */
  readonly name: string;
  /** 短選項的字母；長選項或整字主詞是 null。 */
  readonly short: string | null;
  readonly rule: OptionRule;
  /** 帶值選項的值；旗標與沒給值的 optional 是 null。 */
  readonly value: string | null;
}

export interface ParsedOptions {
  readonly positionals: readonly string[];
  readonly options: readonly ParsedOption[];
  /** 無法辨識的形式；不是 null 時呼叫端一律詢問。 */
  readonly problem: string | null;
}

/** 規則實際的語意。 */
export function optionEffect(rule: OptionRule): OptionEffect {
  if (rule.effect !== undefined) {
    return rule.effect;
  }
  return (rule.arity ?? "none") === "none" ? "inert" : "read";
}

/**
 * 解析 getopt 形式的參數。
 *
 * `table` 只宣告這個指令認得的選項；沒宣告的形狀一律記成 `problem`，因為
 * 「不認得」代表不知道它吃不吃值、會不會寫檔，不能當成無害的旗標跳過。
 */
export function parseOptions(args: readonly string[], table: OptionTable): ParsedOptions {
  const positionals: string[] = [];
  const options: ParsedOption[] = [];
  let problem: string | null = null;
  let index = 0;
  let ended = false;

  while (index < args.length && problem === null) {
    const token = args[index] ?? "";
    if (ended || token === "-" || token === "" || !token.startsWith("-")) {
      positionals.push(token);
      index += 1;
      continue;
    }
    if (token === "--") {
      ended = true;
      index += 1;
      continue;
    }
    if (token.startsWith("--")) {
      const long = parseLong(token, args, index, table.long);
      if (!long.ok) {
        problem = long.reason;
        break;
      }
      options.push(long.option);
      index = long.next;
      continue;
    }
    const group = parseShortGroup(token, args, index, table.short);
    if (!group.ok) {
      problem = group.reason;
      break;
    }
    options.push(...group.options);
    index = group.next;
  }

  return { positionals, options, problem };
}

/**
 * 解析「整字主詞」形式的參數（`find`）。
 *
 * `find` 的引數是運算式，不是 getopt：`-name`、`-fprint`、`-delete` 都是完整的
 * 主詞，`-f` 也只是其中一個主詞，不能把 `-fprintf` 拆成 `-f` 加 `printf`。
 * 所以這個模式不做群組與縮寫，整個 `-word` 當成名稱比對。
 *
 * `--` 不結束運算式：`find -- . -delete` 的 `--` 只結束全域選項，`-delete`
 * 仍然是刪除主詞（實測 `/usr/bin/find -- . -delete` 會刪）。這裡直接忽略
 * `--`；後面以 `-` 開頭的字照主詞判定。
 */
export function parsePrimaryOptions(
  args: readonly string[],
  table: Readonly<Record<string, OptionRule>>,
): ParsedOptions {
  const positionals: string[] = [];
  const options: ParsedOption[] = [];
  let problem: string | null = null;
  let index = 0;

  while (index < args.length && problem === null) {
    const token = args[index] ?? "";
    if (token === "-" || token === "" || !token.startsWith("-")) {
      positionals.push(token);
      index += 1;
      continue;
    }
    if (token === "--") {
      index += 1;
      continue;
    }
    const name = token.slice(1);
    const rule = table[name];
    if (rule === undefined) {
      problem = `未知主詞 -${name}`;
      break;
    }
    if ((rule.arity ?? "none") === "none") {
      options.push({ name: `-${name}`, short: null, rule, value: null });
      index += 1;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined) {
      problem = `-${name} 缺少值`;
      break;
    }
    options.push({ name: `-${name}`, short: null, rule, value });
    index += 2;
  }

  return { positionals, options, problem };
}

type ParseResult =
  | {
      readonly ok: true;
      readonly option: ParsedOption;
      readonly next: number;
    }
  | { readonly ok: false; readonly reason: string };

function parseLong(
  token: string,
  args: readonly string[],
  index: number,
  table: Readonly<Record<string, OptionRule>>,
): ParseResult {
  const body = token.slice(2);
  const equals = body.indexOf("=");
  const name = equals >= 0 ? body.slice(0, equals) : body;
  const inline = equals >= 0 ? body.slice(equals + 1) : null;
  const resolved = resolveLong(name, table);
  if (!resolved.ok) {
    return resolved;
  }
  const { rule, canonical } = resolved;
  const arity = rule.arity ?? "none";
  const display = `--${canonical}`;

  if (arity === "none") {
    if (inline !== null) {
      return { ok: false, reason: `${display} 不接受值` };
    }
    return { ok: true, option: { name: display, short: null, rule, value: null }, next: index + 1 };
  }
  if (arity === "optional") {
    // `--color` 與 `--color=always` 都是合法寫法；沒給值時不碰下一個 token，
    // 否則會把真正的輸入檔吃掉。
    return {
      ok: true,
      option: { name: display, short: null, rule, value: inline },
      next: index + 1,
    };
  }
  if (inline !== null) {
    return {
      ok: true,
      option: { name: display, short: null, rule, value: inline },
      next: index + 1,
    };
  }
  const value = args[index + 1];
  if (value === undefined) {
    return { ok: false, reason: `${display} 缺少值` };
  }
  return { ok: true, option: { name: display, short: null, rule, value }, next: index + 2 };
}

type ShortResult =
  | {
      readonly ok: true;
      readonly options: readonly ParsedOption[];
      readonly next: number;
    }
  | { readonly ok: false; readonly reason: string };

function parseShortGroup(
  token: string,
  args: readonly string[],
  index: number,
  table: Readonly<Record<string, OptionRule>>,
): ShortResult {
  const options: ParsedOption[] = [];
  let cursor = 1;
  const next = index + 1;

  while (cursor < token.length) {
    const letter = token[cursor] ?? "";
    const rule = table[letter];
    if (rule === undefined) {
      if (/^[0-9]$/.test(letter)) {
        // `head -5`、`tail -20` 這類行數簡寫不是 getopt 選項字母；沒有任何
        // 指令用數字選項寫檔或執行程式，一律當成無害旗標。
        options.push({ name: `-${letter}`, short: letter, rule: { arity: "none" }, value: null });
        cursor += 1;
        continue;
      }
      return { ok: false, reason: `未知短選項 -${letter}` };
    }
    const arity = rule.arity ?? "none";
    if (arity === "none") {
      options.push({ name: `-${letter}`, short: letter, rule, value: null });
      cursor += 1;
      continue;
    }
    // 短選項沒有 optional 形式；宣告成 optional 一律當成 required（保守方向）。
    const attached = token.slice(cursor + 1);
    if (attached.length > 0) {
      options.push({ name: `-${letter}`, short: letter, rule, value: attached });
      return { ok: true, options, next };
    }
    const value = args[next];
    if (value === undefined) {
      return { ok: false, reason: `-${letter} 缺少值` };
    }
    options.push({ name: `-${letter}`, short: letter, rule, value });
    return { ok: true, options, next: next + 1 };
  }

  return { ok: true, options, next };
}

type LongResolution =
  | {
      readonly ok: true;
      readonly rule: OptionRule;
      readonly canonical: string;
    }
  | { readonly ok: false; readonly reason: string };

function resolveLong(name: string, table: Readonly<Record<string, OptionRule>>): LongResolution {
  if (name.length === 0) {
    return { ok: false, reason: "長選項缺少名稱" };
  }
  const exact = table[name];
  if (exact !== undefined) {
    return { ok: true, rule: exact, canonical: name };
  }
  const candidates = Object.keys(table).filter((key) => key.startsWith(name));
  const only = candidates.length === 1 ? candidates[0] : undefined;
  if (only !== undefined) {
    const rule = table[only];
    if (rule !== undefined) {
      return { ok: true, rule, canonical: only };
    }
  }
  if (candidates.length === 0) {
    return { ok: false, reason: `未知長選項 --${name}` };
  }
  return { ok: false, reason: `長選項 --${name} 不明確（${candidates.join("、")}）` };
}
