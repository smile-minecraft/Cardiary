import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  cardFileNames,
  makeImportFixture,
  makeTree,
  snapshotDirectory,
  type ImportFixture,
} from "./helpers.js";
import { ImportCardWriter } from "../../../src/modules/import/card-writer.js";

const fixtures: ImportFixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close();
});

async function fixture(): Promise<ImportFixture> {
  const created = await makeImportFixture();
  fixtures.push(created);
  return created;
}

async function source(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cardiary-dedupe-"));
  return makeTree(root, files);
}

describe("重複匯入", () => {
  it("同一個來源匯入兩次，第二次建立的卡片數為零", async () => {
    const f = await fixture();
    const root = await source({
      "memory.md": "- 我住在台北\n- 喜歡手沖咖啡\n",
      "persona.md": "講話直接。\n",
    });
    const categories = { "memory.md": "memory", "persona.md": "persona" } as const;
    const first = await f.service.preview({ sourceKind: "generic", sourcePath: root, categories });
    const firstReport = await f.service.write({
      jobId: first.jobId,
      itemKeys: first.items.map((item) => item.key),
    });
    expect(firstReport.cardsCreated).toBe(3);
    const afterFirst = await cardFileNames(f.folder);

    const second = await f.service.preview({ sourceKind: "generic", sourcePath: root, categories });
    expect(second.duplicates).toBe(3);
    expect(second.newCards).toBe(0);
    expect(second.items.every((item) => item.duplicateCardId !== undefined)).toBe(true);

    const secondReport = await f.service.write({
      jobId: second.jobId,
      itemKeys: second.items.map((item) => item.key),
    });
    expect(secondReport.cardsCreated).toBe(0);
    expect(secondReport.duplicates).toBe(3);
    expect(await cardFileNames(f.folder)).toEqual(afterFirst);
  });

  it("狀態庫的匯入紀錄消失後，仍然靠卡片上的 importedFrom 去重", async () => {
    const f = await fixture();
    const root = await source({ "memory.md": "- 只有一條記憶\n" });
    const first = await f.service.preview({
      sourceKind: "generic",
      sourcePath: root,
      categories: { "memory.md": "memory" },
    });
    await f.service.write({ jobId: first.jobId, itemKeys: first.items.map((item) => item.key) });
    // 模擬 state/ 重建：匯入歷史不見了，卡片檔還在。
    f.storage.state.run("DELETE FROM import_items");
    f.storage.state.run("DELETE FROM import_jobs");

    const second = await f.service.preview({
      sourceKind: "generic",
      sourcePath: root,
      categories: { "memory.md": "memory" },
    });
    expect(second.items[0]?.duplicateCardId).toBeDefined();
    const report = await f.service.write({
      jobId: second.jobId,
      itemKeys: second.items.map((item) => item.key),
    });
    expect(report.cardsCreated).toBe(0);
    expect(await cardFileNames(f.folder)).toHaveLength(1);
  });

  it("刪卡之後同一來源重匯，不再把已刪的卡當成重複", async () => {
    const f = await fixture();
    const root = await source({
      "a.md": "- 第一條記憶\n",
      "b.md": "- 第二條記憶\n",
    });
    const categories = { "a.md": "memory", "b.md": "memory" } as const;
    const first = await f.service.preview({ sourceKind: "generic", sourcePath: root, categories });
    const hashOf = (key: string): string => {
      const found = first.items.find((item) => item.key === key);
      if (found === undefined) throw new Error(`預覽沒有 ${key}`);
      return found.contentHash;
    };
    const report = await f.service.write({
      jobId: first.jobId,
      itemKeys: first.items.map((item) => item.key),
    });
    expect(report.cardsCreated).toBe(2);
    const cardIdOf = new Map(report.results.map((result) => [result.key, result.cardId]));
    const cardA = cardIdOf.get("file:a.md");
    const cardB = cardIdOf.get("file:b.md");
    if (cardA === undefined || cardB === undefined) throw new Error("寫入沒有回報卡片識別碼");

    await f.library.delete(cardA);

    // 同一個行程裡的寫入端快取也不能把已刪的卡當成還在。
    const second = await f.service.preview({ sourceKind: "generic", sourcePath: root, categories });
    const secondA = second.items.find((item) => item.key === "file:a.md");
    const secondB = second.items.find((item) => item.key === "file:b.md");
    expect(secondA?.duplicateCardId).toBeUndefined();
    expect(secondB?.duplicateCardId).toBe(cardB);

    if (secondA === undefined || secondB === undefined) throw new Error("重匯的預覽漏了項目");
    // 換一個新的寫入端（快取是空的），結論也一樣。
    const fresh = new ImportCardWriter({ cardsDirectory: join(f.folder, "cards") });
    expect(fresh.existingForHash(hashOf("file:a.md"))).toBeUndefined();
    expect(fresh.existingForHash(hashOf("file:b.md"))).toBe(cardB);

    if (secondA === undefined || secondB === undefined) throw new Error("重匯的預覽漏了項目");
    const rewritten = await f.service.write({
      jobId: second.jobId,
      itemKeys: [secondA.key, secondB.key],
    });
    expect(rewritten.cardsCreated).toBe(1);
    expect(rewritten.duplicates).toBe(1);
  });

  it("使用者明確要求重新匯入時會再建一張卡", async () => {
    const f = await fixture();
    const root = await source({ "memory.md": "- 只有一條記憶\n" });
    const categories = { "memory.md": "memory" } as const;
    const first = await f.service.preview({ sourceKind: "generic", sourcePath: root, categories });
    await f.service.write({ jobId: first.jobId, itemKeys: first.items.map((item) => item.key) });

    const second = await f.service.preview({ sourceKind: "generic", sourcePath: root, categories });
    const report = await f.service.write({
      jobId: second.jobId,
      itemKeys: second.items.map((item) => item.key),
      reimport: true,
    });
    expect(report.cardsCreated).toBe(1);
    expect(await cardFileNames(f.folder)).toHaveLength(2);
  });
});

describe("來源唯讀", () => {
  it("匯入前後，來源目錄的檔案清單、大小與修改時間完全相同", async () => {
    const f = await fixture();
    const root = await source({
      "memory.md": "- 我住在台北\n",
      "persona.md": "講話直接。\n",
      "notes/rule.md": "先確認日期。\n",
      "archive/old.txt": "舊資料\n",
    });
    const before = await snapshotDirectory(root);
    const preview = await f.service.preview({
      sourceKind: "generic",
      sourcePath: root,
      categories: { "memory.md": "memory", "persona.md": "persona", "notes/rule.md": "rule" },
    });
    await f.service.write({
      jobId: preview.jobId,
      itemKeys: preview.items.map((item) => item.key),
    });
    const after = await snapshotDirectory(root);
    expect(after).toEqual(before);
  });

  it("範例來源裡的假金鑰與登入檔沒有被讀取，內容也不出現在卡片或日誌", async () => {
    const f = await fixture();
    const envSecret = "placeholder-env-value";
    const authSecret = "placeholder-auth-value";
    const credentialSecret = "placeholder-credential-value";
    const yamlSecret = "placeholder-yaml-value";
    const root = await source({
      "persona.md": "講話直接。\n",
      ".env": `OPENAI_API_KEY=${envSecret}`,
      "auth.json": JSON.stringify({ token: authSecret }),
      "credentials.json": JSON.stringify({ secret: credentialSecret }),
      "secrets.yml": `token: ${yamlSecret}`,
    });
    const preview = await f.service.preview({
      sourceKind: "generic",
      sourcePath: root,
      defaultCategory: "rule",
    });
    const report = await f.service.write({
      jobId: preview.jobId,
      itemKeys: preview.items.map((item) => item.key),
    });

    for (const name of [".env", "auth.json", "credentials.json", "secrets.yml"]) {
      expect(f.fs.opened(name)).toBe(false);
    }
    const cards = await Promise.all(
      (await cardFileNames(f.folder)).map((name) =>
        readFile(join(f.folder, "cards", name), "utf8"),
      ),
    );
    const everything = JSON.stringify({ preview, report, cards, logs: f.logs });
    for (const secret of [envSecret, authSecret, credentialSecret, yamlSecret]) {
      expect(everything).not.toContain(secret);
    }
  });
});
