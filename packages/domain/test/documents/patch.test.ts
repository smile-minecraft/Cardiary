import { describe, expect, it } from "vitest";

import type { CardFrontmatter, PatchText } from "../../src/cards/index.js";
import { computeRevision } from "../../src/cards/index.js";
import {
  acceptPatch,
  DocumentRevisionMismatchError,
  rejectPatch,
} from "../../src/documents/index.js";

function frontmatter(): CardFrontmatter {
  return {
    id: "01J00000000000000000000000",
    kind: "note",
    title: "測試卡",
    created: "2026-01-01T00:00:00.000Z",
    sources: [],
    tags: [],
    persona: "default",
    extra: {},
  };
}

const BODY = ["line one", "line two", "line three"].join("\n");

const PATCH: PatchText = {
  format: "unified",
  text: ["@@ -2,1 +2,1 @@", "-line two", "+line TWO"].join("\n"),
};

describe("文件補丁", () => {
  it("接受補丁：revision 相符時套用並算出新 revision", () => {
    const fm = frontmatter();
    const before = computeRevision(fm, BODY);
    const result = acceptPatch({ frontmatter: fm, body: BODY, baseRevision: before, patch: PATCH });

    expect(result.body).toBe(["line one", "line TWO", "line three"].join("\n"));
    expect(result.revision).not.toBe(before);
    expect(result.revision).toBe(computeRevision(fm, result.body));
    expect(result.bodyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("拒絕補丁：內容原樣回傳，不留下版本", () => {
    expect(rejectPatch({ body: BODY }).body).toBe(BODY);
  });

  it("revision 不符時拒絕，附新舊 revision，不部分套用", () => {
    const current = computeRevision(frontmatter(), BODY);
    expect(() =>
      acceptPatch({
        frontmatter: frontmatter(),
        body: BODY,
        baseRevision: "stale-revision",
        patch: PATCH,
      }),
    ).toThrow(DocumentRevisionMismatchError);
    try {
      acceptPatch({
        frontmatter: frontmatter(),
        body: BODY,
        baseRevision: "stale-revision",
        patch: PATCH,
      });
    } catch (caught) {
      const mismatch = caught as DocumentRevisionMismatchError;
      expect(mismatch.code).toBe("revision_mismatch");
      expect(mismatch.expected).toBe("stale-revision");
      expect(mismatch.actual).toBe(current);
    }
  });
});
