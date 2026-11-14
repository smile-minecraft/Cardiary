import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { byteSearch, directorySize, diffSnapshots, snapshotTree, waitFor } from "../src/testing.js";
import { createTempRoot } from "./helpers/temp.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("驗收夾具", () => {
  it("快照差集找出資料夾以外新增的檔案", () => {
    const temp = createTempRoot("snapshot");
    cleanups.push(temp.cleanup);
    const before = snapshotTree(temp.home);
    writeFileSync(path.join(temp.home, "new.txt"), "x");
    const after = snapshotTree(temp.home);
    expect(diffSnapshots(before, after).added).toEqual(["new.txt"]);
  });

  it("byte search 掃到二進位檔與側車檔，目錄大小含所有檔案", () => {
    const temp = createTempRoot("bytes");
    cleanups.push(temp.cleanup);
    const nested = path.join(temp.folder, "state");
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(nested, "db.sqlite"), Buffer.from("prefix MARKER_123 suffix"));
    writeFileSync(path.join(nested, "db.sqlite-wal"), Buffer.from("MARKER_123"));
    const hits = byteSearch(temp.folder, ["MARKER_123", "ABSENT"]);
    expect(hits.map((hit) => hit.file).sort()).toEqual(["state/db.sqlite", "state/db.sqlite-wal"]);
    expect(directorySize(temp.folder)).toBeGreaterThan(0);
  });

  it("waitFor 等到條件成立", async () => {
    let ready = false;
    setTimeout(() => {
      ready = true;
    }, 20);
    expect(await waitFor(() => ready, { timeoutMs: 500 })).toBe(true);
  });
});
