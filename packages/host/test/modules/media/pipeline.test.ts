import { existsSync, readFileSync, readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { CardLibrary } from "../../../src/modules/cards/library.js";
import { CardStateStore } from "../../../src/modules/cards/state.js";
import { CardFileStore, CardIndexStore, LocalAssetStore, Storage } from "@cardiary/storage";

import { fakeBroker, fakeModels, makeMediaFixture, type MediaFixture } from "./helpers.js";

const fixtures: MediaFixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.close();
});

async function fixture(
  options: Parameters<typeof makeMediaFixture>[0] = {},
): Promise<MediaFixture> {
  const created = await makeMediaFixture(options);
  fixtures.push(created);
  return created;
}

async function pngBytes(width = 64, height = 48): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({
      create: { width, height, channels: 3, background: { r: 30, g: 80, b: 160 } },
    })
      .png()
      .toBuffer(),
  );
}

async function* chunks(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}

describe("多模態匯入", () => {
  it("圖片上傳後產生卡片：原檔在 assets 以雜湊命名，內文有描述與 OCR，搜尋找得到", async () => {
    const f = await fixture({
      recognition: fakeBroker({
        ocr: { available: true, text: "預算 120 萬\n排程延到三月", locale: "zh-Hant" },
      }),
      models: fakeModels("白板上寫著預算與排程。"),
    });
    const bytes = await pngBytes();
    const blob = await f.store.put({ bytes: chunks(bytes), mediaType: "image/png" });
    expect(blob.blobId).toMatch(/^[0-9a-f]{64}$/);
    const imported = await f.media.import({ blobId: blob.blobId, title: "會議白板" });
    expect(imported.card.frontmatter.kind).toBe("image");
    expect(imported.card.frontmatter.asset).toBe(`assets/${blob.blobId}.png`);
    expect(imported.standIn.sources).toEqual({
      ocr: "local",
      description: "small-model",
      transcript: "none",
      summary: "none",
    });
    expect(imported.card.body).toContain("## 描述");
    expect(imported.card.body).toContain("白板上寫著預算與排程。");
    expect(imported.card.body).toContain("## OCR 文字");
    expect(imported.card.body).toContain("預算 120 萬");
    expect(existsSync(join(f.folder, "assets", `${blob.blobId}.png`))).toBe(true);
    const cardPath = join(f.folder, "cards", `${imported.card.cardId}.md`);
    expect(readFileSync(cardPath, "utf8")).toContain(`asset: assets/${blob.blobId}.png`);
    const hits = await f.library.search({ query: "預算 120" });
    expect(hits.items[0]?.card.cardId).toBe(imported.card.cardId);
  });

  it("音訊上傳後產生卡片：內文有摘要與逐字稿，全文搜尋找得到", async () => {
    const f = await fixture({
      recognition: fakeBroker({
        transcribe: { available: true, text: "我們下週去看房子。", locale: "zh-TW" },
      }),
      models: fakeModels(),
    });
    const bytes = new TextEncoder().encode("fake audio bytes");
    const blob = await f.store.put({ bytes: chunks(bytes), mediaType: "audio/mp4" });
    const imported = await f.media.import({ blobId: blob.blobId });
    expect(imported.card.frontmatter.kind).toBe("audio");
    expect(imported.card.frontmatter.asset).toBe(`assets/${blob.blobId}.m4a`);
    expect(imported.card.body).toContain("## 摘要");
    expect(imported.card.body).toContain("討論搬家與租約。");
    expect(imported.card.body).toContain("## 逐字稿");
    expect(imported.card.body).toContain("下週去看房子");
    const hits = await f.library.search({ query: "看房子" });
    expect(hits.items[0]?.card.cardId).toBe(imported.card.cardId);
  });

  it("同一個內容重複上傳與重複匯入不產生第二份原檔，也不建第二張卡", async () => {
    const f = await fixture({
      recognition: fakeBroker({ ocr: { available: true, text: "同樣的圖" } }),
      models: fakeModels(),
    });
    const bytes = await pngBytes();
    const first = await f.store.put({ bytes: chunks(bytes), mediaType: "image/png" });
    const second = await f.store.put({ bytes: chunks(bytes), mediaType: "image/png" });
    expect(second.blobId).toBe(first.blobId);
    const once = await f.media.import({ blobId: first.blobId, title: "同一張" });
    const twice = await f.media.import({ blobId: first.blobId, title: "同一張" });
    expect(once.deduped).toBe(false);
    expect(twice.deduped).toBe(true);
    expect(twice.card.cardId).toBe(once.card.cardId);
    expect(readdirSync(join(f.folder, "assets"))).toEqual([`${first.blobId}.png`]);
    expect(
      readdirSync(join(f.folder, "cards")).filter((name) => name.endsWith(".md")),
    ).toHaveLength(1);
  });

  it("同一個 blobId 的並行匯入共用一次辨識，只建一張卡", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const broker = {
      async requestBroker() {
        calls += 1;
        await gate;
        return { available: true, text: "同樣的圖" };
      },
    };
    const f = await fixture({ recognition: broker, models: fakeModels() });
    const bytes = await pngBytes();
    const blob = await f.store.put({ bytes: chunks(bytes), mediaType: "image/png" });
    const first = f.media.import({ blobId: blob.blobId });
    const second = f.media.import({ blobId: blob.blobId });
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a.card.cardId).toBe(b.card.cardId);
    expect(b.deduped).toBe(a.deduped);
    expect(calls).toBe(1);
  });

  it("沒有殼（獨立執行）時匯入仍完成，卡片標明缺少的部分", async () => {
    const f = await fixture({ recognition: null, models: null });
    const bytes = await pngBytes();
    const blob = await f.store.put({ bytes: chunks(bytes), mediaType: "image/png" });
    const imported = await f.media.import({ blobId: blob.blobId });
    expect(imported.card.frontmatter.kind).toBe("image");
    expect(imported.standIn.sources.ocr).toBe("none");
    expect(imported.standIn.sources.description).toBe("none");
    expect(imported.card.body).toContain("## 缺少的部分");
    expect(imported.card.body).toContain("no_shell");
    expect(imported.standIn.missing.length).toBeGreaterThan(0);

    // 重送回同一張卡時，缺少的部分要從卡片內文讀回來，不能變成空的。
    const again = await f.media.import({ blobId: blob.blobId });
    expect(again.deduped).toBe(true);
    expect(again.standIn.missing).toEqual(imported.standIn.missing);
  });

  it("殼路由回 available:false 時一樣完成，卡片寫出原因", async () => {
    const f = await fixture({
      recognition: fakeBroker({
        ocr: { available: false, reason: "not_authorized" },
      }),
      models: fakeModels(),
    });
    const bytes = await pngBytes();
    const blob = await f.store.put({ bytes: chunks(bytes), mediaType: "image/png" });
    const imported = await f.media.import({ blobId: blob.blobId });
    expect(imported.card.body).toContain("not_authorized");
    expect(imported.standIn.sources.description).toBe("none");
  });

  it("上傳中的檔案先登記到檔案登記簿，結束後登記列消失", async () => {
    const f = await fixture({ recognition: null, models: null });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const bytes = await pngBytes();
    async function* slow(): AsyncGenerator<Uint8Array> {
      yield bytes.subarray(0, 10);
      await gate;
      yield bytes.subarray(10);
    }
    const pending = f.store.put({ bytes: slow(), mediaType: "image/png" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const during = f.storage.registry.list().filter((row) => row.relPath.startsWith("tmp/media/"));
    expect(during).toHaveLength(1);
    expect(readdirSync(join(f.folder, "tmp", "media"))).toHaveLength(1);
    release();
    await pending;
    expect(
      f.storage.registry.list().filter((row) => row.relPath.startsWith("tmp/media/")),
    ).toHaveLength(0);
    expect(readdirSync(join(f.folder, "tmp", "media"))).toHaveLength(0);
  });

  it("中斷後啟動清理：暫存檔被清掉，沒有卡片引用的原檔由啟動掃描回收", async () => {
    const f = await fixture({ recognition: null, models: null });
    const bytes = await pngBytes();
    const blob = await f.store.put({ bytes: chunks(bytes), mediaType: "image/png" });
    // 模擬上傳到一半被殺：留一個暫存檔與登記列。
    const scratch = join(f.folder, "tmp", "media", "unfinished.upload");
    await writeFile(scratch, bytes);
    f.storage.registry.register({
      relPath: "tmp/media/unfinished.upload",
      ownerKind: "module",
      ownerId: "media-upload",
    });
    f.close();

    const storage = Storage.open({ path: f.folder });
    const now = (): Date => new Date();
    const index = new CardIndexStore({ db: storage.cache, now });
    const library = new CardLibrary({
      files: new CardFileStore({ layout: storage.layout, now }),
      index: () => index,
      assets: () => new LocalAssetStore({ layout: storage.layout, index, now }),
      state: new CardStateStore({ db: () => storage.state, now }),
      now,
    });
    await library.initialize();
    try {
      expect(existsSync(scratch)).toBe(false);
      expect(
        storage.registry.list().filter((row) => row.relPath.startsWith("tmp/media/")),
      ).toHaveLength(0);
      expect(readdirSync(join(f.folder, "assets"))).toHaveLength(0);
      expect(
        readdirSync(join(f.folder, "cards")).filter((name) => name.endsWith(".md")),
      ).toHaveLength(0);
      expect(blob.blobId).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      storage.close();
    }
  });
});
