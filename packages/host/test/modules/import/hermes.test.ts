import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  cardFileNames,
  fakeImportModel,
  makeImportFixture,
  makeTree,
  type ImportFixture,
} from "./helpers.js";

const fixtures: ImportFixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close();
});

const FAKE_TOKEN = "Bearer sk-hermes-fake-token-do-not-leak";
const FAKE_ENV_SECRET = "sk-hermes-env-secret-do-not-leak";
const FAKE_AUTH_SECRET = "hermes-auth-secret-do-not-leak";

async function hermesHome(files: Record<string, string | Uint8Array>): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "cardiary-hermes-"));
  await makeTree(join(home, ".hermes"), files);
  return home;
}

async function fixture(
  options: Parameters<typeof makeImportFixture>[0] = {},
): Promise<ImportFixture> {
  const created = await makeImportFixture(options);
  fixtures.push(created);
  return created;
}

describe("Hermes 來源", () => {
  it("讀取人格、記憶與技能；config.yaml 只取鍵名，機密檔完全沒開", async () => {
    const home = await hermesHome({
      "SOUL.md": "# 我的語氣\n\n講話直接，先說結論。\n",
      "memories/MEMORY.md": "- 我住在台北\n- 喜歡手沖咖啡\n",
      "memories/USER.md": "- 使用者的名字是小美\n",
      "skills/alpha/SKILL.md":
        "---\nname: alpha\ndescription: 測試技能\n---\n\n# Alpha\n\n做一件事。\n",
      "skills/alpha/assets/template.txt": "附件內容\n",
      "skills/beta/README.md": "沒有 SKILL.md\n",
      "config.yaml": [
        "mcp_servers:",
        "  github:",
        "    headers:",
        `      Authorization: ${FAKE_TOKEN}`,
        "  context7:",
        "    url: https://example.invalid",
        "",
      ].join("\n"),
      ".env": `GITHUB_TOKEN=${FAKE_ENV_SECRET}\n`,
      "auth.json": `{"token":"${FAKE_AUTH_SECRET}"}`,
      "credentials.json": `{"secret":"${FAKE_AUTH_SECRET}"}`,
      "node/bin/node": "binary",
    });
    const f = await fixture({ homeDir: home });

    const preview = await f.service.preview({ sourceKind: "hermes" });
    expect(preview.source.path).toBe(join(home, ".hermes"));

    const persona = preview.items.filter((item) => item.category === "persona");
    expect(persona).toHaveLength(1);
    expect(persona[0]?.body).toContain("講話直接");
    expect(preview.items.filter((item) => item.category === "memory")).toHaveLength(2);
    expect(preview.items.filter((item) => item.category === "user")).toHaveLength(1);
    expect(preview.skills.map((skill) => skill.name)).toEqual(["alpha"]);
    expect(preview.skills[0]?.attachmentsNotCopied).toBe(1);
    expect(preview.skipped).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "skills/beta" })]),
    );

    const configNote = preview.notes.find((note) => note.path === "config.yaml");
    expect(configNote?.detail).toContain("mcp_servers");
    expect(configNote?.detail).toContain("2 個 MCP 伺服器");
    expect(configNote?.detail).toContain("1 個憑證欄位");

    // 機密檔沒有被打開；值也沒有出現在任何回報裡。
    expect(f.fs.opened(".env")).toBe(false);
    expect(f.fs.opened("auth.json")).toBe(false);
    expect(f.fs.opened("credentials.json")).toBe(false);
    const serialized = JSON.stringify(preview);
    expect(serialized).not.toContain(FAKE_TOKEN);
    expect(serialized).not.toContain(FAKE_ENV_SECRET);
    expect(serialized).not.toContain(FAKE_AUTH_SECRET);
    expect(JSON.stringify(f.logs)).not.toContain(FAKE_TOKEN);

    // `config.yaml` 的頂層鍵是 `mcp_servers`；值沒有被讀進回報。
    expect(preview.notes.find((note) => note.path === "config.yaml")?.count).toBe(2);
  });

  it("寫入技能時只複製 SKILL.md，來源不變", async () => {
    const home = await hermesHome({
      "skills/alpha/SKILL.md": "---\nname: alpha\ndescription: 測試技能\n---\n\n# Alpha\n",
      "skills/alpha/assets/template.txt": "附件內容\n",
    });
    const f = await fixture({ homeDir: home });
    const preview = await f.service.preview({ sourceKind: "hermes" });
    const skill = preview.skills[0];
    expect(skill).toBeDefined();
    const report = await f.service.write({
      jobId: preview.jobId,
      itemKeys: [skill?.key ?? ""],
    });
    expect(report.skillsCopied).toBe(1);
    const target = join(f.folder, "skills", "alpha", "SKILL.md");
    expect(existsSync(target)).toBe(true);
    expect(await readFile(target, "utf8")).toContain("# Alpha");
    // 附件留在來源，沒有被複製。
    expect(existsSync(join(f.folder, "skills", "alpha", "assets"))).toBe(false);
    expect(
      await readFile(join(home, ".hermes", "skills", "alpha", "assets", "template.txt"), "utf8"),
    ).toBe("附件內容\n");
  });

  it("沒有安裝 Hermes 時回報缺少哪些檔案，不假裝成功", async () => {
    const home = await mkdtemp(join(tmpdir(), "cardiary-hermes-missing-"));
    const f = await fixture({ homeDir: home });
    const preview = await f.service.preview({ sourceKind: "hermes" });
    expect(preview.items).toEqual([]);
    expect(preview.warnings[0]).toContain("找不到 Hermes 資料夾");
    expect(preview.notes.map((note) => note.detail).join(" ")).toContain("沒有安裝");
    const sources = await f.service.sources();
    const hermes = sources.find((source) => source.kind === "hermes");
    expect(hermes?.available).toBe(false);
    expect(hermes?.unverified).toContain("state.db");
  });

  it("state.db 的對話：沒有時間範圍不能預覽，有範圍才列為未驗證候選", async () => {
    const home = await hermesHome({
      "skills/alpha/SKILL.md": "---\nname: alpha\ndescription: x\n---\n",
    });
    await makeStateDatabase(join(home, ".hermes", "state.db"));
    const f = await fixture({ homeDir: home, models: fakeImportModel() });

    await expect(
      f.service.preview({ sourceKind: "hermes", includeConversations: true }),
    ).rejects.toMatchObject({ code: "invalid_message", details: { reason: "range_required" } });

    const preview = await f.service.preview({
      sourceKind: "hermes",
      includeConversations: true,
      rangeStart: "2026-11-01T00:00:00.000Z",
      rangeEnd: "2026-11-30T23:59:59.000Z",
    });
    expect(preview.conversations).toHaveLength(1);
    expect(preview.conversations[0]?.unverified).toBe(true);
    expect(preview.conversationEstimate).toMatchObject({
      candidates: 1,
      messages: 2,
      modelSummaries: 1,
      existingSummaries: 0,
    });
    expect(preview.conversationEstimate?.estimatedModelInputTokens).toBeGreaterThan(0);
    // 逐字稿不進協定。
    expect(JSON.stringify(preview)).not.toContain("逐字稿內容");

    const report = await f.service.write({
      jobId: preview.jobId,
      itemKeys: preview.conversations.map((conversation) => conversation.key),
    });
    expect(report.cardsCreated).toBe(1);
    expect(report.conversationEstimate?.modelSummaries).toBe(1);
    const summary = await f.library.get(report.results[0]?.cardId ?? "");
    expect(summary?.frontmatter.kind).toBe("summary");
    expect(summary?.body).toContain("搬家");
  });

  it("對話預設不匯入，只列在跳過清單", async () => {
    const home = await hermesHome({
      "skills/alpha/SKILL.md": "---\nname: alpha\ndescription: x\n---\n",
    });
    await makeStateDatabase(join(home, ".hermes", "state.db"));
    const f = await fixture({ homeDir: home });
    const preview = await f.service.preview({ sourceKind: "hermes" });
    expect(preview.conversations).toEqual([]);
    expect(preview.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "state.db", reason: "conversations-not-selected" }),
      ]),
    );
    expect(await cardFileNames(f.folder)).toEqual([]);
  });
});

/** 合成一份第三方客戶端假設的 `state.db`；表與欄位照研究文件，內容是假的。 */
async function makeStateDatabase(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, title TEXT, model TEXT, message_count INTEGER,
        started_at TEXT, source TEXT, parent_session_id TEXT, ended_at TEXT,
        end_reason TEXT, last_activity_at TEXT
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT, content TEXT,
        timestamp TEXT, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT,
        active INTEGER, api_content TEXT
      );
    `);
    database.exec("INSERT INTO schema_version (version) VALUES (1)");
    database
      .prepare("INSERT INTO sessions (id, title, started_at) VALUES (?, ?, ?)")
      .run("session-1", "搬家的討論", "2026-11-10T09:00:00.000Z");
    const insert = database.prepare(
      "INSERT INTO messages (id, session_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)",
    );
    insert.run("m1", "session-1", "user", "逐字稿內容：我想在三月搬家", "2026-11-10T09:00:00.000Z");
    insert.run(
      "m2",
      "session-1",
      "assistant",
      "逐字稿內容：先確認租約",
      "2026-11-10T09:01:00.000Z",
    );
  } finally {
    database.close();
  }
}
