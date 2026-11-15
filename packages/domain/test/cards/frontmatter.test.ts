import { describe, expect, it } from "vitest";

import {
  computeRevision,
  parseCardText,
  serializeCardFile,
  type CardFileResult,
  type CardFrontmatter,
} from "../../src/cards/index.js";

const ID = "01JCX8Q3W7Z9K5V2N4M6P8R0T1";
const OTHER = "01JCW2Q3W7Z9K5V2N4M6P8R0T1";
const THIRD = "01JBQ4Q3W7Z9K5V2N4M6P8R0T1";

function mustParse(text: string, expectedCardId?: string): Extract<CardFileResult, { ok: true }> {
  const result = parseCardText(text, expectedCardId === undefined ? {} : { expectedCardId });
  if (!result.ok) {
    throw new Error(`預期解析成功，實際得到 broken：${result.reason}`);
  }
  return result;
}

function minimalCard(overrides: Partial<Record<string, string>> = {}): string {
  const fields: Record<string, string> = {
    id: ID,
    kind: "note",
    title: "會議筆記",
    created: "2026-11-14T02:00:00.000Z",
    ...overrides,
  };
  const body = Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  return `---\n${body}\n---\n內文\n`;
}

describe("frontmatter 解析", () => {
  it("解析一張完整的卡片", () => {
    const text = `---
id: ${ID}
kind: note
title: 會議筆記
summary: 一兩句話
created: 2026-11-14T02:00:00.000Z
updated: 2026-11-14T02:30:00.000Z
sources: [${OTHER}]
supersedes: ${THIRD}
tags: [專案A, 待辦]
asset: assets/${"a".repeat(64)}.png
persona: default
importedFrom:
  tool: alma
  path: /Users/…/db#t/42
  hash: deadbeef
---
# 標題
內文 [[${OTHER}]]
`;
    const parsed = mustParse(text);
    expect(parsed.frontmatter.id).toBe(ID);
    expect(parsed.frontmatter.kind).toBe("note");
    expect(parsed.frontmatter.title).toBe("會議筆記");
    expect(parsed.frontmatter.summary).toBe("一兩句話");
    expect(parsed.frontmatter.sources).toEqual([OTHER]);
    expect(parsed.frontmatter.supersedes).toBe(THIRD);
    expect(parsed.frontmatter.tags).toEqual(["專案A", "待辦"]);
    expect(parsed.frontmatter.asset).toBe(`assets/${"a".repeat(64)}.png`);
    expect(parsed.frontmatter.importedFrom).toEqual({
      tool: "alma",
      path: "/Users/…/db#t/42",
      hash: "deadbeef",
    });
    expect(parsed.body).toBe("# 標題\n內文 [[" + OTHER + "]]\n");
  });

  it("id 與檔名不符時標記 broken", () => {
    const result = parseCardText(minimalCard(), { expectedCardId: OTHER });
    expect(result).toEqual({ ok: false, reason: "id 與檔名不符" });
  });

  it("未知 kind 標記 broken，不猜測", () => {
    const result = parseCardText(minimalCard({ kind: "mystery" }));
    expect(result.ok).toBe(false);
  });

  it("kind 的 memory/summary/persona/bedrock 都合法", () => {
    for (const kind of ["memory", "summary", "persona", "bedrock", "image", "audio"] as const) {
      expect(parseCardText(minimalCard({ kind })).ok).toBe(true);
    }
  });

  it("缺 title 標記 broken；title 是空值標記 broken", () => {
    const missing = parseCardText(
      `---\nid: ${ID}\nkind: note\ncreated: 2026-11-14T02:00:00.000Z\n---\n內文\n`,
    );
    expect(missing.ok).toBe(false);
    const empty = parseCardText(minimalCard({ title: '""' }));
    expect(empty.ok).toBe(false);
  });

  it("created 只寫日期時視為當日 00:00:00Z", () => {
    const parsed = mustParse(minimalCard({ created: "2026-11-14" }));
    expect(parsed.frontmatter.created).toBe("2026-11-14T00:00:00.000Z");
  });

  it("created 不是 RFC 3339 時標記 broken", () => {
    expect(parseCardText(minimalCard({ created: "今天" })).ok).toBe(false);
    expect(parseCardText(minimalCard({ created: "2026-13-40" })).ok).toBe(false);
  });

  it("標籤去重並保留原順序", () => {
    const parsed = mustParse(minimalCard({ tags: "[b, a, b, a, c]" }));
    expect(parsed.frontmatter.tags).toEqual(["b", "a", "c"]);
  });

  it("tags 可以用區塊陣列寫法", () => {
    const text = `---\nid: ${ID}\nkind: note\ntitle: t\ncreated: 2026-11-14\ntags:\n  - 甲\n  - 乙\n---\n內文\n`;
    const parsed = mustParse(text);
    expect(parsed.frontmatter.tags).toEqual(["甲", "乙"]);
  });

  it("persona 是空值時視為 default", () => {
    const parsed = mustParse(minimalCard({ persona: '""' }));
    expect(parsed.frontmatter.persona).toBe("default");
  });

  it("未知欄位原樣保留，且寫回時維持原本順序", () => {
    const text = `---\nid: ${ID}\nkind: note\nx-custom: 保留值\ntitle: 會議筆記\ncreated: 2026-11-14T02:00:00.000Z\nz-last:\n  nested:\n    deep: yes\n    list:\n      - 1\n      - 2\n---\n內文\n`;
    const parsed = mustParse(text);
    expect(parsed.presentKeys).toEqual(["id", "kind", "x-custom", "title", "created", "z-last"]);
    const serialized = serializeCardFile({
      frontmatter: parsed.frontmatter,
      presentKeys: parsed.presentKeys,
      body: parsed.body,
    });
    const reparsed = mustParse(serialized);
    expect(reparsed.frontmatter.extra["x-custom"]).toBe(" 保留值");
    expect(reparsed.frontmatter.extra["z-last"]).toBe(
      "\n  nested:\n    deep: yes\n    list:\n      - 1\n      - 2",
    );
    // 未知欄位的原始文字在序列化前後完全相同
    expect(serialized).toContain("x-custom: 保留值\n");
    expect(serialized).toContain("z-last:\n  nested:\n    deep: yes\n");
  });

  it("內文保留原樣（包含連結與換行）", () => {
    const text = minimalCard() + "第一行\n\n第二行 [[目標]]\n";
    const parsed = mustParse(text);
    expect(parsed.body).toBe("內文\n第一行\n\n第二行 [[目標]]\n");
  });

  it("CRLF 檔案可以解析，內文保留原樣", () => {
    const text = minimalCard().replaceAll("\n", "\r\n");
    const parsed = mustParse(text);
    expect(parsed.lineEnding).toBe("\r\n");
    expect(parsed.body).toContain("\r\n");
  });

  it("重複的鍵標記 broken", () => {
    const text = minimalCard().replace("kind: note\n", "kind: note\nkind: image\n");
    expect(parseCardText(text).ok).toBe(false);
  });

  it("引號內含冒號的值可以解析", () => {
    const parsed = mustParse(minimalCard({ title: '"會議：重點"' }));
    expect(parsed.frontmatter.title).toBe("會議：重點");
  });
});

describe("frontmatter 版面：順序、換行與註解", () => {
  /** 解析後原樣寫回，再比對結果。 */
  function roundTrip(text: string): string {
    const parsed = mustParse(text);
    return serializeCardFile({
      frontmatter: parsed.frontmatter,
      presentKeys: parsed.presentKeys,
      body: parsed.body,
      lineEnding: parsed.lineEnding,
      layout: parsed.layout,
    });
  }

  it("未知欄位留在原本的位置，不會被搬到已知欄位後面", () => {
    const text = `---\nid: ${ID}\nkind: note\nx-first: 一\ntitle: 會議筆記\nx-middle:\n  nested: yes\ncreated: 2026-11-14T02:00:00.000Z\n---\n內文\n`;
    const serialized = roundTrip(text);
    const keys = serialized
      .split("\n")
      .filter((line) => /^[A-Za-z0-9_.-]+:/.test(line))
      .map((line) => line.slice(0, line.indexOf(":")));
    expect(keys).toEqual(["id", "kind", "x-first", "title", "x-middle", "created"]);
    expect(serialized).toContain("x-middle:\n  nested: yes\n");
  });

  it("CRLF 的檔案連巢狀區塊都用 CRLF 寫回", () => {
    const text = `---\r\nid: ${ID}\r\nkind: note\r\ntitle: 會議筆記\r\ncreated: 2026-11-14T02:00:00.000Z\r\nx-block:\r\n  nested:\r\n    deep: yes\r\n---\r\n內文\r\n`;
    const parsed = mustParse(text);
    expect(parsed.lineEnding).toBe("\r\n");
    const serialized = serializeCardFile({
      frontmatter: parsed.frontmatter,
      presentKeys: parsed.presentKeys,
      body: parsed.body,
      lineEnding: parsed.lineEnding,
      layout: parsed.layout,
    });
    expect(serialized).not.toContain("\n\n");
    expect(serialized.replaceAll("\r\n", "")).not.toContain("\n");
    expect(serialized).toContain("  nested:\r\n    deep: yes\r\n");
    expect(mustParse(serialized).frontmatter.extra["x-block"]).toBe("\n  nested:\n    deep: yes");
  });

  it("created 與 updated 寫回時不加引號", () => {
    const text = `---\nid: ${ID}\nkind: note\ntitle: 會議筆記\ncreated: 2026-11-14T02:00:00.000Z\nupdated: 2026-11-14T02:30:00.000Z\n---\n內文\n`;
    const serialized = roundTrip(text);
    expect(serialized).toContain("created: 2026-11-14T02:00:00.000Z\n");
    expect(serialized).toContain("updated: 2026-11-14T02:30:00.000Z\n");
    expect(serialized).not.toContain('created: "');
    expect(serialized).not.toContain('updated: "');
  });

  it("YAML 註解不讓卡片變成 broken，寫回時留在原位", () => {
    const text = `---\n# 這張卡是會議記錄\nid: ${ID}\nkind: note # note | image | audio\ntitle: 會議筆記 # 標題\ncreated: 2026-11-14T02:00:00.000Z\n---\n內文\n`;
    const parsed = mustParse(text);
    expect(parsed.frontmatter.kind).toBe("note");
    expect(parsed.frontmatter.title).toBe("會議筆記");
    const serialized = serializeCardFile({
      frontmatter: parsed.frontmatter,
      presentKeys: parsed.presentKeys,
      body: parsed.body,
      layout: parsed.layout,
    });
    expect(serialized).toContain("# 這張卡是會議記錄\nid:");
    expect(serialized).toContain("kind: note # note | image | audio\n");
    // 標題會加引號（已知欄位用標準形式重寫），同行註解仍然接在後面。
    expect(serialized).toMatch(/^title: .+ # 標題$/m);
    // 寫回之後仍然解析得動，值不變。
    expect(mustParse(serialized).frontmatter).toEqual(parsed.frontmatter);
  });

  it("值裡的 # 不是註解", () => {
    const text = `---\nid: ${ID}\nkind: note\ntitle: C# 入門\ncreated: 2026-11-14T02:00:00.000Z\nimportedFrom:\n  tool: alma\n  path: /Users/x/chat_threads.db#threads/42\n  hash: deadbeef\n---\n內文\n`;
    const parsed = mustParse(text);
    expect(parsed.frontmatter.title).toBe("C# 入門");
    expect(parsed.frontmatter.importedFrom?.path).toBe("/Users/x/chat_threads.db#threads/42");
  });

  it("設計文件第 2.2 節的範例可以解析，而且註解不會被當成值", () => {
    const text = `---
id: ${ID}
kind: note # note | image | audio | memory | summary | persona | bedrock
title: 會議筆記
summary: 一兩句話的摘要，供檢索與發牌使用
created: 2026-11-14T02:00:00.000Z
updated: 2026-11-14T02:30:00.000Z
sources: [${OTHER}]   # 血緣
tags: [專案A, 待辦]
asset: assets/${"a".repeat(64)}.png   # 原檔
persona: default
---
內文
`;
    const parsed = mustParse(text);
    expect(parsed.frontmatter.kind).toBe("note");
    expect(parsed.frontmatter.sources).toEqual([OTHER]);
    expect(parsed.frontmatter.tags).toEqual(["專案A", "待辦"]);
    expect(parsed.frontmatter.asset).toBe(`assets/${"a".repeat(64)}.png`);
    const again = mustParse(roundTrip(text));
    expect(again.frontmatter).toEqual(parsed.frontmatter);
  });
});

describe("frontmatter 序列化與 revision", () => {
  it("序列化後重新解析，內容一致且未知欄位仍在", () => {
    const original = `---\nid: ${ID}\nkind: note\ntitle: 會議筆記\ncreated: 2026-11-14T02:00:00.000Z\nepsilon: 未知\n---\n內文\n`;
    const parsed = mustParse(original);
    const serialized = serializeCardFile({
      frontmatter: parsed.frontmatter,
      presentKeys: parsed.presentKeys,
      body: parsed.body,
    });
    const roundTrip = mustParse(serialized);
    expect(roundTrip.frontmatter).toEqual(parsed.frontmatter);
    expect(roundTrip.body).toBe(parsed.body);
  });

  it("改寫時不會無中生出欄位（persona 不存在時仍然不存在）", () => {
    const original = `---\nid: ${ID}\nkind: note\ntitle: 會議筆記\ncreated: 2026-11-14T02:00:00.000Z\n---\n內文\n`;
    const parsed = mustParse(original);
    const serialized = serializeCardFile({
      frontmatter: parsed.frontmatter,
      presentKeys: parsed.presentKeys,
      body: parsed.body,
    });
    expect(serialized).not.toContain("persona:");
    expect(serialized).not.toContain("tags:");
  });

  it("revision 對同一份內容穩定，且與格式細節無關（鍵順序不影響）", () => {
    const a = mustParse(minimalCard({ tags: "[x, y]" }));
    const b = mustParse(minimalCard({ tags: "[x, y]" }));
    expect(computeRevision(a.frontmatter, a.body)).toBe(computeRevision(b.frontmatter, b.body));
  });

  it("內文改變 revision 就改變", () => {
    const a = mustParse(minimalCard());
    const revision = computeRevision(a.frontmatter, a.body);
    const changed = computeRevision(a.frontmatter, `${a.body}\n多一行\n`);
    expect(changed).not.toBe(revision);
  });

  it("未知欄位的內容改變 revision 會改變", () => {
    const a = mustParse(minimalCard({ "x-note": "第一版" }));
    const b = mustParse(minimalCard({ "x-note": "第二版" }));
    expect(computeRevision(a.frontmatter, a.body)).not.toBe(computeRevision(b.frontmatter, b.body));
  });

  it("未知欄位的縮排不同不影響 revision（正規化後比較）", () => {
    const text = (indent: string) =>
      `---\nid: ${ID}\nkind: note\ntitle: 會議筆記\ncreated: 2026-11-14T02:00:00.000Z\nx:\n${indent}a: 1\n---\n內文\n`;
    const a = mustParse(text("  "));
    const b = mustParse(text("    "));
    expect(computeRevision(a.frontmatter, a.body)).toBe(computeRevision(b.frontmatter, b.body));
  });

  it("frontmatter 鍵順序不影響 revision", () => {
    const a = mustParse(`---\nid: ${ID}\nkind: note\ntitle: t\ncreated: 2026-11-14\n---\n內文\n`);
    const b = mustParse(`---\ntitle: t\ncreated: 2026-11-14\nkind: note\nid: ${ID}\n---\n內文\n`);
    expect(computeRevision(a.frontmatter, a.body)).toBe(computeRevision(b.frontmatter, b.body));
  });
});

describe("revision 對預期值", () => {
  it("同一份輸入的 revision 可重算", () => {
    const parsed = mustParse(minimalCard());
    const frontmatter: CardFrontmatter = parsed.frontmatter;
    expect(computeRevision(frontmatter, parsed.body)).toMatch(/^[0-9a-f]{64}$/);
  });
});
