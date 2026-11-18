#!/usr/bin/env node
/**
 * 量測嵌入子行程的常駐記憶體：多張卡依序嵌入、記錄峰值，再等閒置卸載。
 *
 * 走產品路徑：host/dist 的 LocalEmbedder 與 SpawnRegistry，子行程就是
 * dist/modules/retrieval/embedding-worker.js。先在本 repo 根目錄執行
 * `pnpm build`，再跑這支腳本。
 *
 *   node packages/host/scripts/measure-embedder-rss.mjs --cache /tmp/cardiary-rss
 *
 * 第一次執行會下載模型（約 625 MB）。要沿用既有的模型快取，可以先讓
 * `<cache>/models` 指向已下載的 HF_HOME：
 *
 *   mkdir -p /tmp/cardiary-rss
 *   ln -s "$HOME/Library/Caches/cardiary-embedding-spike/hf" /tmp/cardiary-rss/models
 *   node packages/host/scripts/measure-embedder-rss.mjs --cache /tmp/cardiary-rss
 */
import { execFile } from "node:child_process";
import console from "node:console";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { setTimeout as sleepTimer } from "node:timers";
import { URL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const here = new URL("..", import.meta.url);
const embedderModule = new URL("./dist/modules/retrieval/embedder.js", here);
const spawnModule = new URL("./dist/spawn/wrapper.js", here);

if (!existsSync(embedderModule)) {
  console.error("找不到 packages/host/dist；請先在 repo 根目錄執行 pnpm build。");
  process.exit(1);
}

const { LocalEmbedder } = await import(embedderModule.href);
const { SpawnRegistry } = await import(spawnModule.href);

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (value === undefined) {
    console.error(`--${name} 需要一個值`);
    process.exit(1);
  }
  return value;
}

const CACHE = resolve(option("cache", mkdtempSync(join(tmpdir(), "cardiary-rss-"))));
const TEXT_COUNT = Number(option("texts", "8"));
const IDLE_WAIT_MS = Number(option("idle-wait-ms", String(11 * 60 * 1000)));
const SAMPLE_MS = Number(option("sample-ms", "250"));
const KEEP = process.argv.includes("--keep");

const CARDS = [
  "手寫字練習：今天練了永字八法，橫豎撇捺要放慢速度。",
  "會議記錄：下週三討論 Cardiary 的檢索品質，先準備十個查詢。",
  "閱讀筆記：原子習慣提到把提示放在看得見的地方，習慣才容易維持。",
  "旅行計畫：十一月去台南，想吃牛肉湯和虱目魚粥。",
  "烹飪筆記：滷肉要先煸出油脂，冰糖最後放才不會焦。",
  "投資筆記：定期定額的好處是不用猜進場時間，但要留現金。",
  "健身紀錄：深蹲 5 組 8 下，重量加到 60 公斤，膝蓋沒有不舒服。",
  "讀書心得：人類大歷史把農業革命稱為最大的騙局，論點值得想想。",
  "工作回顧：這個 sprint 完成了向量索引，下個 sprint 處理縮圖。",
  "園藝筆記：薄荷長得太快，要換大一點的盆子，順便修剪。",
  "音樂練習：吉他和弦轉換 C 到 G 還是會卡，每天練十分鐘。",
  "料理實驗：用氣炸鍋烤地瓜，200 度 25 分鐘，中間翻面。",
];

function sleep(ms) {
  return new Promise((resolveSleep) => sleepTimer(resolveSleep, ms));
}

/** 子行程的 RSS（bytes），以命令列同時比對 worker 與 cache 路徑。 */
async function childRss() {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,rss=,command="], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const pids = [];
  let bytes = 0;
  for (const line of stdout.split("\n")) {
    if (!line.includes("embedding-worker.js")) continue;
    if (!line.includes(CACHE)) continue;
    const parts = line.trim().split(/\s+/);
    const pid = Number(parts[0]);
    const rssKb = Number(parts[1]);
    if (!Number.isFinite(pid) || !Number.isFinite(rssKb)) continue;
    pids.push(pid);
    bytes += rssKb * 1024;
  }
  return { pids, bytes };
}

function mb(bytes) {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

mkdirSync(CACHE, { recursive: true });
console.log(`cache: ${CACHE}`);
console.log(`texts: ${TEXT_COUNT}，閒置等待上限：${Math.round(IDLE_WAIT_MS / 1000)} 秒`);

const spawns = new SpawnRegistry();
const embedder = new LocalEmbedder(spawns, CACHE);
let peak = 0;
let sampling = true;
const samples = [];
const sampler = (async () => {
  while (sampling) {
    try {
      const current = await childRss();
      peak = Math.max(peak, current.bytes);
      if (current.pids.length > 0) samples.push(current.bytes);
    } catch {
      // ps 失敗不影響量測。
    }
    await sleep(SAMPLE_MS);
  }
})();

const startedAt = Date.now();
let afterEmbed = 0;
try {
  for (let index = 0; index < TEXT_COUNT; index += 1) {
    const text = CARDS[index % CARDS.length];
    const textStartedAt = Date.now();
    await embedder.embed(text);
    const current = await childRss();
    afterEmbed = current.bytes;
    console.log(
      `嵌入 ${index + 1}/${TEXT_COUNT}：${Date.now() - textStartedAt} ms，RSS ${mb(current.bytes)} MB`,
    );
  }
  console.log(`嵌入完成：${Date.now() - startedAt} ms，峰值 ${mb(peak)} MB`);
  const embedMs = Date.now() - startedAt;

  const unloadStartedAt = Date.now();
  let unloadedAt = 0;
  let last = afterEmbed;
  while (Date.now() - unloadStartedAt < IDLE_WAIT_MS) {
    await sleep(1000);
    const current = await childRss();
    if (current.pids.length === 0) {
      unloadedAt = Date.now();
      last = 0;
      break;
    }
    last = current.bytes;
    if (Math.round((Date.now() - unloadStartedAt) / 1000) % 30 === 0) {
      console.log(
        `閒置 ${Math.round((Date.now() - unloadStartedAt) / 1000)} 秒：RSS ${mb(last)} MB`,
      );
    }
  }

  sampling = false;
  await sampler;
  const afterUnload = await childRss();
  const result = {
    cache: CACHE,
    texts: TEXT_COUNT,
    embedMs,
    peakRssMb: mb(peak),
    afterEmbedRssMb: mb(afterEmbed),
    afterUnloadRssMb: mb(afterUnload.bytes),
    unloadedAfterMs: unloadedAt === 0 ? null : unloadedAt - unloadStartedAt,
    idleWaitMs: IDLE_WAIT_MS,
    parentRssMb: mb(process.memoryUsage().rss),
  };
  console.log(JSON.stringify(result));
} finally {
  sampling = false;
  embedder.stop();
  await sampler;
  if (!KEEP && process.argv.indexOf("--cache") === -1) {
    rmSync(CACHE, { recursive: true, force: true });
  }
}
