import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createAuditLog, MAX_AUDIT_BYTES } from "../../src/permissions/audit.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function folder(): string {
  const root = mkdtempSync(path.join(tmpdir(), "cardiary-audit-"));
  roots.push(root);
  mkdirSync(path.join(root, "state"));
  return root;
}

const entry = {
  at: "2026-11-16T00:00:00.000Z",
  kind: "policy-denied" as const,
  tool: "project_card_to_board",
  argsHash: "a".repeat(64),
  reason: "respect-user-content",
  conversationId: "conversation-1",
};

describe("代理稽核紀錄", () => {
  it("逐行追加並只保存稽核欄位", () => {
    const root = folder();
    const log = createAuditLog(root);
    const withArguments = { ...entry, args: { title: "不該記錄的內容" } };
    log.appendAudit(withArguments);
    log.appendAudit({ ...entry, reason: "out-of-scope" });
    const text = readFileSync(path.join(root, "state", "agent-audit.jsonl"), "utf8");
    expect(text).not.toContain("不該記錄的內容");
    expect(
      text
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    ).toEqual([entry, { ...entry, reason: "out-of-scope" }]);
  });

  it("超過 5 MB 前輪替舊檔，並將新紀錄寫進新檔", () => {
    const root = folder();
    const file = path.join(root, "state", "agent-audit.jsonl");
    writeFileSync(file, "x".repeat(MAX_AUDIT_BYTES));
    createAuditLog(root).appendAudit(entry);
    expect(readFileSync(`${file}.1`).length).toBe(MAX_AUDIT_BYTES);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(entry);
  });

  it("拒絕寫入指向其他檔案的符號連結", () => {
    const root = folder();
    const target = path.join(root, "target");
    writeFileSync(target, "unchanged");
    symlinkSync(target, path.join(root, "state", "agent-audit.jsonl"));
    expect(() => createAuditLog(root).appendAudit(entry)).toThrow();
    expect(readFileSync(target, "utf8")).toBe("unchanged");
  });
});
