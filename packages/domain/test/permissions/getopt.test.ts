import { describe, expect, it } from "vitest";

import { parseOptions, parsePrimaryOptions } from "../../src/permissions/index.js";
import type { OptionRule, OptionTable } from "../../src/permissions/index.js";

const flag: OptionRule = { arity: "none" };
const value: OptionRule = { arity: "required" };
const write: OptionRule = { arity: "required", effect: "write" };
const optional: OptionRule = { arity: "optional" };

const sortLike: OptionTable = {
  short: { n: flag, r: flag, f: flag, u: flag, o: write, k: value, t: value },
  long: {
    output: write,
    "compress-program": { arity: "required", effect: "exec" },
    reverse: flag,
    read: flag,
    unique: flag,
    key: value,
  },
};

describe("短選項群組", () => {
  it.each([
    ["-u", [["-u", null]], []],
    [
      "-ur",
      [
        ["-u", null],
        ["-r", null],
      ],
      [],
    ],
    ["-o/path", [["-o", "/path"]], []],
    [
      "-no/path",
      [
        ["-n", null],
        ["-o", "/path"],
      ],
      [],
    ],
    [
      "-rfno/path",
      [
        ["-r", null],
        ["-f", null],
        ["-n", null],
        ["-o", "/path"],
      ],
      [],
    ],
    ["-o", [["-o", "out.txt"]], []],
  ])("%s", (token, expectedOptions, expectedPositionals) => {
    const args = token === "-o" ? [token, "out.txt"] : [token];
    const parsed = parseOptions(args, sortLike);
    expect(parsed.problem).toBeNull();
    expect(parsed.options.map((option) => [option.name, option.value])).toEqual(expectedOptions);
    expect(parsed.positionals).toEqual(expectedPositionals);
  });

  it("群組後面還有位置參數", () => {
    const parsed = parseOptions(["-rfno/tmp/out", "notes.md"], sortLike);
    expect(parsed.problem).toBeNull();
    expect(parsed.options.at(-1)).toMatchObject({ name: "-o", value: "/tmp/out" });
    expect(parsed.positionals).toEqual(["notes.md"]);
  });

  it("帶值選項後面的 token 是值，不是位置參數", () => {
    const parsed = parseOptions(["-o", "/tmp/out", "notes.md"], sortLike);
    expect(parsed.positionals).toEqual(["notes.md"]);
    expect(parsed.options.map((option) => option.value)).toEqual(["/tmp/out"]);
  });

  it("值看起來像選項也照吃不誤（getopt 的行為）", () => {
    const parsed = parseOptions(["-o", "-r", "notes.md"], sortLike);
    expect(parsed.options.map((option) => option.value)).toEqual(["-r"]);
    expect(parsed.positionals).toEqual(["notes.md"]);
  });

  it("未知短選項是問題，不會被當成無害旗標跳過", () => {
    const parsed = parseOptions(["-z", "notes.md"], sortLike);
    expect(parsed.problem).toContain("-z");
  });

  it("缺少值也是問題", () => {
    expect(parseOptions(["-o"], sortLike).problem).toContain("缺少值");
  });

  it("數字是行數簡寫，不是未知選項", () => {
    const parsed = parseOptions(["-5", "notes.md"], sortLike);
    expect(parsed.problem).toBeNull();
    expect(parsed.positionals).toEqual(["notes.md"]);
    expect(parseOptions(["-n5", "notes.md"], sortLike).problem).toBeNull();
  });
});

describe("長選項", () => {
  it.each([
    ["--output=/tmp/out", "/tmp/out"],
    ["--out=/tmp/out", "/tmp/out"],
    ["--ou=/tmp/out", "/tmp/out"],
    ["--o=/tmp/out", "/tmp/out"],
  ])("%s 解析成 --output", (token, expected) => {
    const parsed = parseOptions([token, "notes.md"], sortLike);
    expect(parsed.problem).toBeNull();
    expect(parsed.options).toHaveLength(1);
    expect(parsed.options[0]).toMatchObject({ name: "--output", value: expected });
  });

  it("空白分隔的長選項值", () => {
    const parsed = parseOptions(["--output", "/tmp/out", "notes.md"], sortLike);
    expect(parsed.options[0]).toMatchObject({ name: "--output", value: "/tmp/out" });
    expect(parsed.positionals).toEqual(["notes.md"]);
  });

  it("完全比對優先於前綴", () => {
    const parsed = parseOptions(["--key", "1,1", "notes.md"], sortLike);
    expect(parsed.options[0]).toMatchObject({ name: "--key", value: "1,1" });
  });

  it("不明確的前綴是問題", () => {
    const parsed = parseOptions(["--re", "notes.md"], sortLike);
    expect(parsed.problem).toContain("不明確");
  });

  it("未知長選項是問題", () => {
    expect(parseOptions(["--outputfoo", "notes.md"], sortLike).problem).toContain("未知長選項");
  });

  it("不吃值的長選項帶值也是問題", () => {
    expect(parseOptions(["--reverse=yes", "notes.md"], sortLike).problem).toContain("不接受值");
  });

  it("缺少值的長選項是問題", () => {
    expect(parseOptions(["--output"], sortLike).problem).toContain("缺少值");
  });

  it("可選值的長選項不碰下一個 token", () => {
    const table: OptionTable = { short: {}, long: { color: optional } };
    const parsed = parseOptions(["--color", "notes.md"], table);
    expect(parsed.options[0]).toMatchObject({ name: "--color", value: null });
    expect(parsed.positionals).toEqual(["notes.md"]);
    expect(parseOptions(["--color=always", "notes.md"], table).options[0]?.value).toBe("always");
  });
});

describe("-- 與特殊 token", () => {
  it("-- 之後全部是位置參數", () => {
    const parsed = parseOptions(["-r", "--", "-o", "/etc/hosts"], sortLike);
    expect(parsed.problem).toBeNull();
    expect(parsed.options.map((option) => option.name)).toEqual(["-r"]);
    expect(parsed.positionals).toEqual(["-o", "/etc/hosts"]);
  });

  it("單獨的 - 是位置參數（stdin）", () => {
    const parsed = parseOptions(["-", "notes.md"], sortLike);
    expect(parsed.positionals).toEqual(["-", "notes.md"]);
  });

  it("`--=x` 沒有名稱，不能變成前綴比對", () => {
    const table: OptionTable = { short: {}, long: { output: write } };
    expect(parseOptions(["--=x"], table).problem).not.toBeNull();
  });
});

describe("整字主詞（find）", () => {
  const table: Record<string, OptionRule> = {
    P: flag,
    E: flag,
    delete: { arity: "none", effect: "delete" },
    name: { arity: "required", effect: "inert" },
    fprint: { arity: "required", effect: "write" },
    f: { arity: "required", effect: "read", positional: true },
  };

  it("-fprintf 不會被拆成 -f 加 printf", () => {
    const parsed = parsePrimaryOptions([".", "-fprintf", "/tmp/out", "%p\\n"], table);
    expect(parsed.problem).toContain("未知主詞");
  });

  it("-fprint 是寫入主詞，值不會變成位置參數", () => {
    const parsed = parsePrimaryOptions([".", "-fprint", "/tmp/out"], table);
    expect(parsed.problem).toBeNull();
    expect(parsed.options[0]).toMatchObject({ name: "-fprint", value: "/tmp/out" });
    expect(parsed.positionals).toEqual(["."]);
  });

  it("-f 的值標成位置參數", () => {
    const parsed = parsePrimaryOptions(["-P", "-f", "cards", "-delete"], table);
    expect(parsed.problem).toBeNull();
    // 位置參數由呼叫端從標了 positional 的選項值補進來（見 evaluateCapability）。
    expect(parsed.positionals).toEqual([]);
    const shortF = parsed.options.find((option) => option.name === "-f");
    expect(shortF).toMatchObject({ value: "cards", rule: { positional: true } });
  });

  it("未知主詞是問題", () => {
    expect(parsePrimaryOptions([".", "-unknown"], table).problem).toContain("未知主詞");
  });

  it("-- 只結束全域選項，不結束運算式", () => {
    const parsed = parsePrimaryOptions(["-P", "--", ".", "-delete"], table);
    expect(parsed.problem).toBeNull();
    expect(parsed.positionals).toEqual(["."]);
    expect(parsed.options.map((option) => option.name)).toEqual(["-P", "-delete"]);
  });
});
