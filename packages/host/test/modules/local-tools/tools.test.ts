import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { makeLocalToolsHarness, type LocalToolsHarness } from "./support.js";

let harness: LocalToolsHarness | null = null;

afterEach(async () => {
  await harness?.cleanup();
  harness = null;
});

async function setup() {
  harness = await makeLocalToolsHarness();
  return harness;
}

describe("read_file", () => {
  it("讀取工作目錄的檔案", async () => {
    const h = await setup();
    writeFileSync(join(h.fixture.project, "notes.md"), "hello");
    const outcome = await h.run("read_file", { path: "notes.md" });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.content[0]).toEqual({ type: "text", text: "hello" });
    }
  });

  it("檔案不存在時回失敗", async () => {
    const h = await setup();
    const outcome = await h.run("read_file", { path: "missing.md" });
    expect(outcome.ok).toBe(false);
  });

  it("超過單次讀取上限時回失敗，不整份載入", async () => {
    const h = await setup();
    writeFileSync(join(h.fixture.project, "big.md"), "x".repeat(5000));
    const outcome = await h.run("read_file", { path: "big.md" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).toContain("上限");
    }
  });

  it("工作目錄與閘道不一致時拒絕執行", async () => {
    const h = await setup();
    const tool = h.tools.find((candidate) => candidate.name === "read_file");
    expect(tool).toBeDefined();
    const outcome = await tool!.execute(
      { path: "notes.md" },
      {
        conversationId: "c1",
        turnId: "t1",
        callId: "c1",
        toolName: "read_file",
        signal: new AbortController().signal,
        tempDir: `${h.fixture.folder}/tmp`,
        workingDir: h.fixture.outside,
        spawn: () => {
          throw new Error("不應該啟動子行程");
        },
        requestApproval: async () => {
          throw new Error("不應該要求審批");
        },
      },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.diagnostics?.[0]?.code).toBe("permission-denied");
    }
  });
});

describe("write_file", () => {
  it("建立、覆寫與附加", async () => {
    const h = await setup();
    const path = join(h.fixture.project, "out.txt");
    expect((await h.run("write_file", { path: "out.txt", content: "a" })).ok).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("a");
    expect((await h.run("write_file", { path: "out.txt", content: "b" })).ok).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("b");
    expect((await h.run("write_file", { path: "out.txt", content: "c", mode: "append" })).ok).toBe(
      true,
    );
    expect(readFileSync(path, "utf8")).toBe("bc");
  });

  it("create 模式遇到既有檔案時失敗，不會覆寫", async () => {
    const h = await setup();
    writeFileSync(join(h.fixture.project, "exists.txt"), "keep");
    const outcome = await h.run("write_file", {
      path: "exists.txt",
      content: "new",
      mode: "create",
    });
    expect(outcome.ok).toBe(false);
    expect(readFileSync(join(h.fixture.project, "exists.txt"), "utf8")).toBe("keep");
  });

  it("目標是符號連結時拒絕，原本的目標不變", async () => {
    const h = await setup();
    const target = join(h.fixture.outside, "secret.txt");
    writeFileSync(target, "original");
    symlinkSync(target, join(h.fixture.project, "link.txt"));
    const outcome = await h.run("write_file", { path: "link.txt", content: "changed" });
    expect(outcome.ok).toBe(false);
    expect(readFileSync(target, "utf8")).toBe("original");
  });

  it("父目錄不存在時失敗，不自動建立資料夾", async () => {
    const h = await setup();
    const outcome = await h.run("write_file", { path: "no/such/dir/file.txt", content: "x" });
    expect(outcome.ok).toBe(false);
    expect(existsSync(join(h.fixture.project, "no"))).toBe(false);
  });
});

describe("list_directory", () => {
  it("排序、標記目錄與符號連結", async () => {
    const h = await setup();
    const directory = join(h.fixture.project, "small");
    mkdirSync(join(directory, "sub"), { recursive: true });
    writeFileSync(join(directory, "b.txt"), "");
    writeFileSync(join(directory, "a.txt"), "");
    symlinkSync(join(h.fixture.outside), join(directory, "link"));
    const outcome = await h.run("list_directory", { path: "small" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const text = outcome.content[0];
    const body = text?.type === "text" ? text.text : "";
    const lines = body.split("\n").slice(1);
    expect(lines).toEqual(["a.txt", "b.txt", "link@", "sub/"]);
  });

  it("超過項目上限時截斷並標記診斷", async () => {
    const h = await setup();
    const directory = join(h.fixture.project, "many");
    mkdirSync(directory, { recursive: true });
    for (let index = 0; index < 25; index += 1) {
      writeFileSync(join(directory, `f${index}.txt`), "");
    }
    const outcome = await h.run("list_directory", { path: "many" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const text = outcome.content[0];
    const body = text?.type === "text" ? text.text : "";
    expect(body).toContain("共 25 項，只顯示前 20 項");
    expect(outcome.diagnostics?.[0]?.code).toBe("output-truncated");
  });
});

// run_command 需要 macOS 的 sandbox-exec；其他平台產品不執行，測試也跳過。
describe.skipIf(process.platform !== "darwin")("run_command", () => {
  it("回傳 exit code 與輸出，TMPDIR 指到資料夾的 tmp", async () => {
    const h = await setup();
    const outcome = await h.run("run_command", {
      command: 'printf "%s" "$TMPDIR"; printf " done"',
    });
    expect(outcome).toBeTruthy();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const text = outcome.content[0];
    expect(text?.type === "text" ? text.text : "").toContain(`${h.fixture.folder}/tmp`);
  });

  it("非零結束碼回失敗，輸出仍看得到", async () => {
    const h = await setup();
    const outcome = await h.run("run_command", { command: "echo boom >&2; exit 3" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toContain("exit code: 3");
    expect(outcome.message).toContain("boom");
  });

  it("cwd 可以是工作目錄的子目錄", async () => {
    const h = await setup();
    mkdirSync(join(h.fixture.project, "sub"), { recursive: true });
    writeFileSync(join(h.fixture.project, "sub", "x.txt"), "x");
    const outcome = await h.run("run_command", { command: "ls", cwd: "sub" });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const text = outcome.content[0];
      expect(text?.type === "text" ? text.text : "").toContain("x.txt");
    }
  });

  it("取消時終止子行程並回 paused", async () => {
    const h = await setup();
    const controller = new AbortController();
    const started = Date.now();
    const pending = h.run("run_command", { command: "sleep 30" }, { signal: controller.signal });
    setTimeout(() => controller.abort(), 100).unref?.();
    const outcome = await pending;
    expect(Date.now() - started).toBeLessThan(5000);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.diagnostics?.some((diagnostic) => diagnostic.code === "paused")).toBe(true);
      expect(outcome.message).toContain("取消");
    }
  });

  it("輸出超過上限時只留頭尾、完整內容進暫存並登記，回合結束後清除", async () => {
    const h = await setup();
    const outcome = await h.run(
      "run_command",
      { command: "printf 'A%.0s' $(seq 1 2000); printf 'Z%.0s' $(seq 1 500)" },
      { turnId: "turn-big", callId: "call-big" },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const text = outcome.content[0];
    const body = text?.type === "text" ? text.text : "";
    expect(body).toContain("輸出被截斷");
    expect(body).toContain("tmp/local-tools/turn-big/call-big.log");
    expect(outcome.diagnostics?.some((diagnostic) => diagnostic.code === "output-truncated")).toBe(
      true,
    );
    const spill = join(h.fixture.folder, "tmp", "local-tools", "turn-big", "call-big.log");
    expect(existsSync(spill)).toBe(true);
    expect(readFileSync(spill, "utf8").length).toBeGreaterThan(2500);
    expect(h.fixture.storage.registry.get("tmp/local-tools/turn-big/call-big.log")).not.toBeNull();

    expect(h.tracker.cleanup("turn-big", h.fixture.storage.registry)).toBe(1);
    expect(existsSync(spill)).toBe(false);
    expect(h.fixture.storage.registry.get("tmp/local-tools/turn-big/call-big.log")).toBeNull();
    expect(
      h.fixture.storage.registry.list().filter((row) => row.relPath.startsWith("tmp/local-tools/")),
    ).toHaveLength(0);
    expect(
      h.fixture.storage.registry.list().filter((row) => row.ownerKind === "tool-call"),
    ).toHaveLength(0);
  });

  it("沒有輸出時也能成功", async () => {
    const h = await setup();
    const outcome = await h.run("run_command", { command: "true" });
    expect(outcome.ok).toBe(true);
  });
});
