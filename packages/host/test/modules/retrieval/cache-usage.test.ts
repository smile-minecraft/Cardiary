import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { measureCache } from "../../../src/modules/retrieval/cache-usage.js";

let folder: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "cardiary-cache-usage-"));
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe("cache 用量", () => {
  it("把模型、縮圖與索引側車檔分開計算，總量包含全部", () => {
    mkdirSync(join(folder, "models", "onnx-community"), { recursive: true });
    mkdirSync(join(folder, "thumbs"), { recursive: true });
    mkdirSync(join(folder, "tmp"), { recursive: true });
    writeFileSync(join(folder, "models", "onnx-community", "model.onnx"), Buffer.alloc(4096));
    writeFileSync(join(folder, "thumbs", "card.jpg"), Buffer.alloc(512));
    writeFileSync(join(folder, "index.sqlite"), Buffer.alloc(1024));
    writeFileSync(join(folder, "index.sqlite-wal"), Buffer.alloc(256));
    writeFileSync(join(folder, "tmp", "download.part"), Buffer.alloc(64));

    expect(measureCache(folder)).toEqual({
      totalBytes: 4096 + 512 + 1024 + 256 + 64,
      modelBytes: 4096,
      thumbBytes: 512,
      indexBytes: 1024 + 256 + 64,
    });
  });

  it("不存在的 cache 目錄回報 0", () => {
    expect(measureCache(join(folder, "missing"))).toEqual({
      totalBytes: 0,
      modelBytes: 0,
      thumbBytes: 0,
      indexBytes: 0,
    });
  });
});
