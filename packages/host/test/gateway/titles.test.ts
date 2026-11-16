import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateDatabase } from "@cardiary/storage";
import type { ConversationSummary } from "@cardiary/engine-adapter";
import { expect, it } from "vitest";

import { StoredConversationTitles } from "../../src/gateway/titles.js";

it("顯示標題寫入狀態庫，重開後保留第一則", () => {
  const directory = mkdtempSync(join(tmpdir(), "cardiary-titles-"));
  const options = {
    filePath: join(directory, "state.sqlite"),
    appVersion: "test",
    backupDirectory: directory,
  };
  const summary = {
    id: "s1",
    title: "新對話",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as ConversationSummary;
  let db = openStateDatabase(options).db;
  let titles = new StoredConversationTitles(() => db);
  titles.setFirst(summary, "旅行計畫");
  titles.setFirst(summary, "後續訊息");
  db.close();
  db = openStateDatabase(options).db;
  titles = new StoredConversationTitles(() => db);
  expect(titles.get("s1")).toBe("旅行計畫");
  db.close();
});
