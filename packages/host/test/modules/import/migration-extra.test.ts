import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { afterEach, expect, it } from "vitest";
import {
  fakeImportModel,
  makeImportFixture,
  makeTree,
  snapshotDirectory,
  type ImportFixture,
} from "./helpers.js";

const fixtures: ImportFixture[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close();
});
const range = {
  includeConversations: true,
  rangeStart: "2026-01-01T00:00:00Z",
  rangeEnd: "2026-12-31T23:59:59Z",
};
const exportData = [
  {
    uuid: "chat-1",
    name: "整理",
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T01:00:00Z",
    chat_messages: [
      { sender: "human", text: "整理書櫃" },
      { sender: "assistant", text: "", content: [{ type: "text", text: "週末整理" }] },
    ],
  },
];

it("OpenClaw 匯入工作區與對話，重複匯入不寫入，機密未開啟且來源不變", async () => {
  const root = await mkdtemp(join(tmpdir(), "cardiary-openclaw-"));
  const transcript = [
    { type: "session", id: "one", timestamp: "2026-05-01T00:00:00Z" },
    {
      type: "message",
      timestamp: "2026-05-01T00:01:00Z",
      message: { role: "user", content: [{ type: "text", text: "整理書櫃" }] },
    },
    {
      type: "message",
      timestamp: "2026-05-01T00:02:00Z",
      message: { role: "assistant", content: [{ type: "text", text: "週末整理" }] },
    },
  ]
    .map((row) => JSON.stringify(row))
    .join("\n");
  await makeTree(root, {
    "workspace/SOUL.md": "# 語氣\n直接",
    "workspace/USER.md": "# 使用者\n喜歡閱讀",
    "workspace/AGENTS.md": "# 規則\n先詢問",
    "workspace/MEMORY.md": "# 記憶\n喜歡茶",
    "workspace/memory/2026-05-01.md": "# 日記\n買了書",
    "workspace/.env": "fake",
    "workspace/credentials-extra.md": "fake",
    "workspace/skills/example/SKILL.md": "---\nname: example\ndescription: test\n---\n# Example",
    "workspace/skills/example/assets/example.txt": "attachment",
    "agents/main/sessions/credentials-private.jsonl": "fake",
    "agents/main/sessions/one.jsonl": transcript,
    "agents/main/sessions/bad.jsonl": "{bad",
    "agents/main/agent/auth-profiles.json": "fake",
  });
  const before = await snapshotDirectory(root);
  const f = await makeImportFixture({ models: fakeImportModel() });
  fixtures.push(f);
  const preview = await f.service.preview({ sourceKind: "openclaw", sourcePath: root, ...range });
  expect(preview.items.map((item) => item.category).sort()).toEqual([
    "memory",
    "memory",
    "persona",
    "rule",
    "user",
  ]);
  expect(preview.conversations).toHaveLength(1);
  expect(preview.skills).toHaveLength(1);
  expect(preview.skills[0]?.attachmentsNotCopied).toBe(1);
  expect(preview.conversationEstimate).toMatchObject({ candidates: 1, messages: 2 });
  expect(preview.skipped).toEqual(
    expect.arrayContaining([expect.objectContaining({ reason: "unsupported-format" })]),
  );
  const keys = [
    ...preview.items.map((item) => item.key),
    ...preview.skills.map((item) => item.key),
    ...preview.conversations.map((item) => item.key),
  ];
  const first = await f.service.write({ jobId: preview.jobId, itemKeys: keys });
  expect(first.cardsCreated).toBe(6);
  expect(first.skillsCopied).toBe(1);
  const cards = await Promise.all(
    first.results
      .filter((item) => item.cardId !== undefined)
      .map((item) => f.library.get(item.cardId ?? "")),
  );
  expect(cards.map((card) => card?.frontmatter.kind).sort()).toEqual([
    "memory",
    "memory",
    "memory",
    "note",
    "persona",
    "summary",
  ]);
  expect(cards.every((card) => card?.frontmatter.importedFrom?.tool === "openclaw")).toBe(true);
  const again = await f.service.preview({ sourceKind: "openclaw", sourcePath: root, ...range });
  const second = await f.service.write({
    jobId: again.jobId,
    itemKeys: [
      ...again.items.map((item) => item.key),
      ...again.skills.map((item) => item.key),
      ...again.conversations.map((item) => item.key),
    ],
  });
  expect(second.cardsCreated).toBe(0);
  expect(second.skillsCopied).toBe(0);
  expect(await snapshotDirectory(root)).toEqual(before);
  for (const name of [
    ".env",
    "credentials-extra.md",
    "credentials-private.jsonl",
    "auth-profiles.json",
  ])
    expect(f.fs.opened(name)).toBe(false);
});

it.each(["json", "zip"])("Claude %s 匯出只讀對話，指定範圍、估算與去重", async (extension) => {
  const root = await mkdtemp(join(tmpdir(), "cardiary-claude-export-"));
  const path = join(root, `export.${extension}`);
  const json = JSON.stringify(exportData);
  await writeFile(
    path,
    extension === "zip"
      ? makeZip({ "conversations.json": json, "credentials.json": "fake" })
      : json,
  );
  const before = await snapshotDirectory(root);
  const f = await makeImportFixture({ models: fakeImportModel() });
  fixtures.push(f);
  await expect(
    f.service.preview({ sourceKind: "claude", sourcePath: path, includeConversations: true }),
  ).rejects.toMatchObject({ code: "invalid_message" });
  const without = await f.service.preview({ sourceKind: "claude", sourcePath: path });
  expect(without.conversations).toHaveLength(0);
  expect(f.fs.reads).toHaveLength(0);
  const preview = await f.service.preview({ sourceKind: "claude", sourcePath: path, ...range });
  expect(preview.items).toEqual([]);
  expect(preview.skills).toEqual([]);
  expect(preview.conversations).toHaveLength(1);
  if (extension === "zip") {
    expect(f.fs.reads).toContain(`${path}#conversations.json`);
    expect(f.fs.reads).not.toContain(`${path}#credentials.json`);
  }
  expect(preview.conversationEstimate).toMatchObject({
    candidates: 1,
    messages: 2,
    modelSummaries: 1,
  });
  const written = await f.service.write({
    jobId: preview.jobId,
    itemKeys: preview.conversations.map((item) => item.key),
  });
  expect(written.cardsCreated).toBe(1);
  const again = await f.service.preview({ sourceKind: "claude", sourcePath: path, ...range });
  const repeated = await f.service.write({
    jobId: again.jobId,
    itemKeys: again.conversations.map((item) => item.key),
  });
  expect(repeated.cardsCreated).toBe(0);
  expect(await snapshotDirectory(root)).toEqual(before);
});

it("來源不存在時仍在清單中，且標為無法自動找到", async () => {
  const f = await makeImportFixture();
  fixtures.push(f);
  const sources = await f.service.sources();
  expect(sources.find((source) => source.kind === "openclaw")).toMatchObject({ available: false });
  expect(sources.find((source) => source.kind === "claude")).toMatchObject({ available: false });
});

it("拒絕損壞的 ZIP 項目，並排除範圍外的對話", async () => {
  const root = await mkdtemp(join(tmpdir(), "cardiary-claude-corrupt-"));
  const path = join(root, "corrupt.zip");
  const zip = makeZip({ "conversations.json": JSON.stringify(exportData) });
  const offset = 30 + Buffer.byteLength("conversations.json");
  zip[offset] = (zip[offset] ?? 0) ^ 1;
  await writeFile(path, zip);
  const f = await makeImportFixture();
  fixtures.push(f);
  const invalid = await f.service.preview({ sourceKind: "claude", sourcePath: path, ...range });
  expect(invalid.skipped).toEqual(
    expect.arrayContaining([expect.objectContaining({ reason: "unsupported-format" })]),
  );
  const jsonPath = join(root, "export.json");
  await writeFile(jsonPath, JSON.stringify(exportData));
  const outside = await f.service.preview({
    sourceKind: "claude",
    sourcePath: jsonPath,
    includeConversations: true,
    rangeStart: "2025-01-01T00:00:00Z",
    rangeEnd: "2025-12-31T23:59:59Z",
  });
  expect(outside.conversations).toEqual([]);
});

it("格式錯誤的 Claude 匯出檔會跳過並回報", async () => {
  const root = await mkdtemp(join(tmpdir(), "cardiary-claude-invalid-"));
  const path = join(root, "bad.zip");
  await writeFile(path, "invalid");
  const f = await makeImportFixture();
  fixtures.push(f);
  const preview = await f.service.preview({ sourceKind: "claude", sourcePath: path, ...range });
  expect(preview.conversations).toEqual([]);
  expect(preview.skipped).toEqual(
    expect.arrayContaining([expect.objectContaining({ reason: "unsupported-format" })]),
  );
});

function makeZip(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  const directories: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const filename = Buffer.from(name);
    const data = Buffer.from(text);
    const compressed = deflateRawSync(data);
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(8, 10);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE(offset, 42);
    parts.push(local, filename, compressed);
    directories.push(directory, filename);
    offset += local.length + filename.length + compressed.length;
  }
  const central = Buffer.concat(directories);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, central, end]);
}
