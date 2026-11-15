import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  cardFileNames,
  makeImportFixture,
  makeTree,
  readCardFile,
  type ImportFixture,
} from "./helpers.js";

const fixtures: ImportFixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close();
});

async function fixture(): Promise<ImportFixture> {
  const created = await makeImportFixture();
  fixtures.push(created);
  return created;
}

async function sourceFolder(files: Record<string, string | Uint8Array>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cardiary-source-"));
  return makeTree(root, files);
}

describe("通用資料夾來源", () => {
  it("逐檔指定類別後轉成中介格式，預覽看得到每一張將建立的卡", async () => {
    const f = await fixture();
    const source = await sourceFolder({
      "persona.md": "# 我的語氣\n\n講話直接，先說結論。\n",
      "notes/rule.md": "回答前先確認日期。\n",
      "memories.md": "- 我住在台北\n- 喜歡手沖咖啡\n- 三月要搬家\n",
      "attachments/photo.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      "unassigned.md": "沒有指定類別。\n",
    });

    const preview = await f.service.preview({
      sourceKind: "generic",
      sourcePath: source,
      categories: {
        "persona.md": "persona",
        "notes/rule.md": "rule",
        "memories.md": "memory",
      },
    });

    expect(preview.source.tool).toBe("generic");
    expect(preview.items.map((item) => item.category).sort()).toEqual([
      "memory",
      "memory",
      "memory",
      "persona",
      "rule",
    ]);
    const memories = preview.items.filter((item) => item.category === "memory");
    expect(memories.map((item) => item.body)).toEqual(["我住在台北", "喜歡手沖咖啡", "三月要搬家"]);
    expect(preview.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "attachments/photo.png", reason: "unsupported-format" }),
        expect.objectContaining({ path: "unassigned.md", reason: "category-not-assigned" }),
      ]),
    );
    expect(preview.newCards).toBe(5);
    // 預覽不建立任何卡片檔。
    expect(await cardFileNames(f.folder)).toEqual([]);
  });

  it("勾選後寫成卡片：類別對應卡片種類、frontmatter 記錄 importedFrom", async () => {
    const f = await fixture();
    const source = await sourceFolder({
      "persona.md": "# 我的語氣\n\n講話直接，先說結論。\n",
      "rule.md": "回答前先確認日期。\n",
      "memory.md": "- 我住在台北\n- 喜歡手沖咖啡\n",
    });
    const preview = await f.service.preview({
      sourceKind: "generic",
      sourcePath: source,
      categories: { "persona.md": "persona", "rule.md": "rule", "memory.md": "memory" },
    });
    const selected = preview.items.map((item) => item.key);
    const report = await f.service.write({ jobId: preview.jobId, itemKeys: selected });

    expect(report.status).toBe("completed");
    expect(report.cardsCreated).toBe(4);
    expect(report.failed).toBe(0);

    const persona = preview.items.find((item) => item.category === "persona");
    const rule = preview.items.find((item) => item.category === "rule");
    const personaCard = await f.library.get(
      report.results.find((r) => r.key === persona?.key)?.cardId ?? "",
    );
    expect(personaCard?.frontmatter.kind).toBe("persona");
    expect(personaCard?.frontmatter.importedFrom?.tool).toBe("generic");
    expect(personaCard?.frontmatter.importedFrom?.path).toContain("persona.md");

    const ruleCard = await f.library.get(
      report.results.find((r) => r.key === rule?.key)?.cardId ?? "",
    );
    expect(ruleCard?.frontmatter.kind).toBe("note");

    const memoryCards = await f.library.list({ kinds: ["memory"] });
    expect(memoryCards.items).toHaveLength(2);
    const file = await readCardFile(
      f.folder,
      report.results.find((result) => result.category === "memory")?.cardId ?? "",
    );
    expect(file).toContain("importedFrom:");
    expect(file).toContain("tool: generic");
  });

  it("格式不符的檔案跳過並列在結果，其餘照常匯入", async () => {
    const f = await fixture();
    const source = await sourceFolder({
      "ok.md": "可以讀的內容。\n",
      "broken.md": Buffer.from([0x00, 0x01, 0x02, 0x00]),
      "empty.md": "\n\n",
      "image.jpg": new Uint8Array([0xff, 0xd8, 0xff]),
    });
    const preview = await f.service.preview({
      sourceKind: "generic",
      sourcePath: source,
      defaultCategory: "rule",
    });
    expect(preview.items.map((item) => item.title)).toEqual(["可以讀的內容。"]);
    expect(preview.skipped.map((skip) => skip.path).sort()).toEqual([
      "broken.md",
      "empty.md",
      "image.jpg",
    ]);

    const report = await f.service.write({
      jobId: preview.jobId,
      itemKeys: preview.items.map((item) => item.key),
    });
    expect(report.cardsCreated).toBe(1);
    expect(report.skipped.map((skip) => skip.path)).toContain("image.jpg");
  });

  it("使用者貼上的人格文字變成可勾選的人格卡", async () => {
    const f = await fixture();
    const source = await sourceFolder({ "note.md": "一則筆記。\n" });
    const preview = await f.service.preview({
      sourceKind: "generic",
      sourcePath: source,
      categories: { "note.md": "rule" },
      providedPersona: { title: "我的語氣", body: "先說結論，再補理由。" },
    });
    const persona = preview.items.find((item) => item.key === "provided:persona");
    expect(persona?.category).toBe("persona");
    expect(persona?.body).toBe("先說結論，再補理由。");
  });

  it("檔名含 # 的檔案可以預覽、勾選、寫入", async () => {
    const f = await fixture();
    const source = await sourceFolder({
      "note#1.md": "- 第一條記憶\n- 第二條記憶\n",
      "會議#2026.md": "講話要直接。\n",
    });
    const preview = await f.service.preview({
      sourceKind: "generic",
      sourcePath: source,
      categories: { "note#1.md": "memory", "會議#2026.md": "persona" },
    });
    const memoryKeys = preview.items
      .filter((item) => item.category === "memory")
      .map((item) => item.key);
    expect(memoryKeys).toEqual(["file:note%231.md#1", "file:note%231.md#2"]);

    const report = await f.service.write({
      jobId: preview.jobId,
      itemKeys: preview.items.map((item) => item.key),
    });
    expect(report.cardsCreated).toBe(3);
    expect(report.failed).toBe(0);
    expect(report.results.every((result) => result.status === "written")).toBe(true);
  });

  it("機密檔名（例如 auth.md）：列不出來也讀不到，內容不出現在卡片或日誌", async () => {
    const f = await fixture();
    const secret = "placeholder-auth-value";
    const source = await sourceFolder({
      "auth.md": `OPENAI_API_KEY=${secret}\n`,
      "notes.md": "可以匯入。\n",
    });

    const listing = await f.service.list({ path: source });
    expect(listing.files.map((entry) => entry.relativePath)).toEqual(["notes.md"]);

    const preview = await f.service.preview({
      sourceKind: "generic",
      sourcePath: source,
      defaultCategory: "rule",
    });
    expect(preview.items.map((item) => item.title)).toEqual(["可以匯入。"]);
    expect(f.fs.opened("auth.md")).toBe(false);

    const report = await f.service.write({
      jobId: preview.jobId,
      itemKeys: preview.items.map((item) => item.key),
    });
    const everything = JSON.stringify({ preview, report, logs: f.logs });
    expect(everything).not.toContain(secret);
  });

  it("通用來源的技能：預覽、勾選、寫入後會複製到 skills/", async () => {
    const f = await fixture();
    const source = await sourceFolder({
      "tools/greet/SKILL.md":
        "---\nname: greet\ndescription: 打招呼時先確認名字。\n---\n\n# greet\n\n先問名字再回答。\n",
    });
    const preview = await f.service.preview({
      sourceKind: "generic",
      sourcePath: source,
      categories: { "tools/greet/SKILL.md": "skill" },
    });
    expect(preview.skills).toHaveLength(1);
    const skill = preview.skills[0];
    expect(skill?.key).toBe("skill:tools/greet/SKILL.md");
    if (skill === undefined) throw new Error("預覽沒有產出技能草稿");

    const report = await f.service.write({
      jobId: preview.jobId,
      itemKeys: [skill.key],
    });
    expect(report.skillsCopied).toBe(1);
    expect(report.results[0]?.status).toBe("written");
    const written = await readFile(join(f.folder, "skills", "greet", "SKILL.md"), "utf8");
    expect(written).toContain("name: greet");
  });

  it("不是六類的類別在掃描前就被拒絕", async () => {
    const f = await fixture();
    const source = await sourceFolder({ "note.md": "一則筆記。\n" });
    await expect(
      f.service.preview({
        sourceKind: "generic",
        sourcePath: source,
        categories: { "note.md": "note" as never },
      }),
    ).rejects.toMatchObject({ code: "invalid_message" });
  });
});
