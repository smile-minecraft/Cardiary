import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileSkillCopier, type SkillCopier } from "../../../src/modules/import/skills.js";
import type { ImportSkillDraft } from "../../../src/modules/import/types.js";

const scratch: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  for (const dir of scratch.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function scratchDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cardiary-skills-"));
  scratch.push(dir);
  return dir;
}

function draft(slug: string): ImportSkillDraft {
  return {
    key: `skill:${slug}/SKILL.md`,
    name: slug,
    description: "測試技能",
    slug,
    skillMarkdown: `---\nname: ${slug}\ndescription: 測試技能。\n---\n\n# ${slug}\n`,
    contentHash: "deadbeefcafe1234",
    source: { tool: "generic", path: `/source/${slug}/SKILL.md` },
    attachmentsNotCopied: 0,
  };
}

describe("技能複製的符號連結", () => {
  it("slug 被符號連結佔用時，改用帶雜湊的後綴，連結指向的目錄不被寫", async () => {
    const root = await scratchDir();
    const external = await scratchDir();
    const skills = join(root, "skills");
    await mkdir(skills);
    await symlink(external, join(skills, "evil"));

    const copier = new FileSkillCopier({ skillsDirectory: skills });
    const result = await copier.copy(draft("evil"));

    expect(result.status).toBe("copied");
    expect(result.directory).toBe("evil-deadbeef");
    // 連結指向的外部目錄沒有被寫入。
    const externalEntries = await readFileOrDirError(external);
    expect(externalEntries).toEqual([]);
    const inside = await readFile(join(skills, result.directory, "SKILL.md"), "utf8");
    expect(inside).toContain("name: evil");
    expect(lstatSync(join(skills, "evil")).isSymbolicLink()).toBe(true);
  });

  it("slug 和後綴都是符號連結時，拒絕寫入，兩個外部目錄都不被寫", async () => {
    const root = await scratchDir();
    const externalA = await scratchDir();
    const externalB = await scratchDir();
    const skills = join(root, "skills");
    await mkdir(skills);
    await symlink(externalA, join(skills, "evil"));
    await symlink(externalB, join(skills, "evil-deadbeef"));

    const copier = new FileSkillCopier({ skillsDirectory: skills });
    await expect(copier.copy(draft("evil"))).rejects.toThrow(/佔用/u);

    expect(await readFileOrDirError(externalA)).toEqual([]);
    expect(await readFileOrDirError(externalB)).toEqual([]);
  });

  it("existing 不跟隨 SKILL.md 的符號連結", async () => {
    const root = await scratchDir();
    const external = await scratchDir();
    const skills = join(root, "skills");
    const target = join(skills, "evil");
    await mkdir(target, { recursive: true });
    const skill = draft("evil");
    const externalFile = join(external, "outside.md");
    await writeFile(externalFile, skill.skillMarkdown, "utf8");
    await symlink(externalFile, join(target, "SKILL.md"));

    const copier: SkillCopier = new FileSkillCopier({ skillsDirectory: skills });
    expect(await copier.existing(skill)).toBeUndefined();
  });
});

async function readFileOrDirError(dir: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  return readdir(dir);
}
