# 檢索效能與記憶體量測

2026-11-18。本文件是 M2 檢索收尾時留下的實測紀錄，`docs/design/m2-retrieval.md` 沒有改動。量測方法可以照著重跑；數字只適用於下表的機器。

## 怎麼重跑

延遲（產品路徑，含 FTS、向量比對、RRF 合併；查詢嵌入與卡片向量都是決定性的假資料，沒有真的下載模型，也沒有真的跑大型模型）：

```sh
CARDIARY_RETRIEVAL_BENCH=1 npx vitest run packages/contract-tests/retrieval/performance.test.ts
```

- 10,000 張卡，title/body 為手寫字練習的假文字
- 向量維度 1024，`bench-model@1`
- 暖身 3 次 + 正式 50 次，每次查詢 `RetrievalService.search({ query: "手寫字" }, "search")`
- 斷言 `p95 < 250 ms`；斷言不通過測試就不會綠

閒置 RSS（真實子行程、真實模型；腳本在 repo 裡，量測的是產品路徑）：

```sh
pnpm build
node packages/host/scripts/measure-embedder-rss.mjs --cache /tmp/cardiary-rss
```

`packages/host/scripts/measure-embedder-rss.mjs` 用 `host/dist` 的 `LocalEmbedder` 與 `SpawnRegistry`，子行程就是 `dist/modules/retrieval/embedding-worker.js`；依序嵌入 8 句中文卡片文字，每 250 ms 用 `ps -axo pid=,rss=,command=` 量子行程 RSS，記錄峰值與嵌入完成後的 RSS，然後等閒置退出（產品的閒置計時器是 10 分鐘；`--idle-wait-ms` 預設 660 秒），最後再印一行 JSON：`embedMs`、`peakRssMb`、`afterEmbedRssMb`、`afterUnloadRssMb`、`unloadedAfterMs`、`parentRssMb`。`--texts N` 可改卡片句數，`--keep` 保留暫存 cache，`--cache <dir>` 指定 cache（省略時自建暫存目錄並在結束後刪掉）。

第一次執行會下載模型（約 625 MB，`HF_HOME` 指向 `<cache>/models`）。要沿用 M2 spike 留下的權重，可以先讓 `<cache>/models` 指到 spike 的 `hf/`（沒有為了這次量測重新下載）：

```sh
mkdir -p /tmp/cardiary-rss
ln -s "$HOME/Library/Caches/cardiary-embedding-spike/hf" /tmp/cardiary-rss/models
node packages/host/scripts/measure-embedder-rss.mjs --cache /tmp/cardiary-rss --keep
```


## 量測環境

- macOS 27.2（Build 26B123）、Apple M4（arm64）、32 GB 記憶體
- Node v26.13.1（repo 要求 >= 22.19.0）
- pnpm 9.0.0、Vitest 5.1.0
- 2026-11-18，worktree `Cardiary-wt/m2-retrieval`，分支 `work/m2-retrieval`

## 產品路徑延遲（10k 卡、50 次）

修正前（2026-11-18 早上，重寫檢索前量的同一支 benchmark、同一台機器）：

```
{"cards":10000,"dimension":1024,"runs":50,"seedMs":未記錄,"coldMs":212.0,"p50Ms":71.1,"p95Ms":77.1,"maxMs":84.1,"rssMb":265,"status":"building"}
```

該次筆數是在 benchmark 補 selectModel 之前量的，首次查詢還會整批重建，數字僅供對照，不是這次實作的結果。

修正後（同一天、同一台機器、同一支 benchmark）：

```
{"cards":10000,"dimension":1024,"runs":50,"seedMs":8632,"coldMs":129.4,"p50Ms":49.7,"p95Ms":55.8,"maxMs":59.2,"rssMb":240,"status":"ready"}
```

- 目標：10,000 張卡 p95 < 250 ms（`docs/design/m2-retrieval.md` 第 19 行、第 136 行）→ 實測 p95 55.8 ms，符合
- p50 49.7 ms、最大 59.2 ms；冷啟動（含常駐索引建立）129.4 ms
- `rssMb: 240` 是跑這個測試的 Node 程序的 RSS，不是嵌入子行程
- 查詢嵌入與卡片向量都是決定性的假資料，FTS、向量比對、RRF 合併走真實路徑、真實 SQLite；向量內容是假的，延遲量的是資料結構與索引路徑，不是模型本身
- 這台 Apple M4 上修正前後數字差距小，原因是 10k 卡在這台機器上本來就低於 250 ms；真正痛的是舊實作每次查詢全量複製向量＋逐列 DB 查詢（審查者在 10k、真實 SQLite、假嵌入上量得 p50 283.4 ms、p95 343.8 ms，應有其它負載或不同量測方式）。這次重寫的價值主要是把每次查詢的 O(N) 複製與 per-row DB 往返拿掉，並讓缺索引的卡可以增量補上

## 嵌入子行程閒置後 RSS

設計目標：閒置後回到 150 MB 以下；設計上靠閒置 10 分鐘後 `LocalEmbedder` 把子行程 SIGTERM 掉，不是讓模型常駐在記憶體裡。

這次用 repo 裡的 `packages/host/scripts/measure-embedder-rss.mjs` 實跑到子行程自己退出（沒有把 spike 的數字搬過來；下面每個數字都是這次實跑的輸出）。腳本走產品路徑（`host/dist` 的 `LocalEmbedder`、閒置計時器與 `SpawnRegistry`），父程序等子行程退出後印一行 JSON。

- 模型：`onnx-community/Qwen3-Embedding-0.6B-ONNX`（q8），`HF_HOME` 指向 `<cache>/models`；`models` 是 symlink 到 `~/Library/Caches/cardiary-embedding-spike/hf`（spike 留下的權重，這次沒有重新下載），`--cache /tmp/cardiary-rss-m2`
- 機器：Apple M4、32 GB、macOS 27.2、Node v26.13.1
- 指令：

```sh
pnpm build
node packages/host/scripts/measure-embedder-rss.mjs --cache /tmp/cardiary-rss-m2 --texts 8 --keep
```

- 實跑（2026-11-18，日誌在 `/tmp/cardiary-rss-run2.log`）：
  - 8 句嵌入 **1644 ms** 完成，模型載入約 2 秒（沿用 spike 權重）
  - 嵌入完成：峰值 **2366.5 MB**；嵌入後直接量測 **2369.9 MB**（高於 250 ms 取樣的峰值）
  - 閒置逐步下降（每 30 秒一行）：60s 2366.5 → 90s 1813.6 → 150–240s 約 1770 → 270s 1137.2 → **330s 起 499.7，之後一直到 600s 約 499.5**
  - 閒置滿 10 分鐘後 `LocalEmbedder` 送出 SIGTERM，子行程退出，`unloadedAfterMs = 600731`（約 10 分鐘閒置計時器如預期），之後 `ps` 量到 RSS = 0，父程序 RSS 172 MB
  - 最終一行 JSON：`{"cache":"/tmp/cardiary-rss-m2","texts":8,"embedMs":1644,"peakRssMb":2366.5,"afterEmbedRssMb":2369.9,"afterUnloadRssMb":0,"unloadedAfterMs":600731,"idleWaitMs":660000,"parentRssMb":172}`
- 同一天同一支腳本先前也實跑過一輪（日誌在 `/tmp/cardiary-rss-run.log`，那輪腳本的 `embedMs` 不小心記成含閒置等待的總時間，已修正；嵌入本身約 **1409 ms**）：峰值 **2696.1 MB**，閒置逐步下降，510–570 秒起停在 **64.2 MB**，同樣閒置滿 10 分鐘後 SIGTERM 退出（`unloadedAfterMs = 600189`，`afterUnloadRssMb = 0`）
- 解釋：
  - 設計第 7 章第 6 項「閒置後 RSS 回到 150 MB 以下（子行程退出即成立）」在兩輪實跑中都成立：子行程在閒置計時器到期後被 `LocalEmbedder` SIGTERM，退出後 RSS = 0
  - 閒置「等待期間」的 RSS 兩輪差異很大：一輪停在約 500 MB（330 秒到退出），一輪降到 64 MB；兩者都是 ONNX 執行期自己回收，不是 Cardiary 主動卸載。閒置期間是否小於 150 MB 不保證；要穩定低於 150 MB 需要子行程內主動釋放 ONNX session／權重或延後載入，牽涉到重新載入成本與可接受的常駐記憶體，這次沒有動
  - 閒置計時器這次修的是一個真的 bug：先前的 `embed()` 只 `clearTimeout(this.#idle)`，沒有把 `#idle` 設回 `undefined`，第二次嵌入後 `#idle` 永遠不是 `undefined`，閒置計時器就不會再排定；現在 `packages/host/test/modules/retrieval/embedder.test.ts` 以連續兩次嵌入後快轉 10 分鐘斷言 SIGTERM 與 `exited` 解析為 `{ code: null, signal: "SIGTERM" }`，這次實跑也實際觀察到子行程退出
- 目標「閒置後 RSS < 150 MB」：
  - 若把「閒置後」解讀為「退出後」：成立（RSS = 0，兩輪皆然）
  - 若解讀為「閒置等待期間」：不一定（兩輪分別約 500 MB 與 64 MB）
  - 後續工作：在 `LocalEmbedder` 閒置期間主動釋放 ONNX session，或在子行程內實作記憶體上限；兩者都要先決定「閒置後第一次查詢的延遲可以接受到多少」

## 2 GB 容量上限

已實作。上限 2 GB（`VECTOR_CACHE_MAX_BYTES`）以**整個 `cache/`** 的實際檔案大小為準，不再是只算 `vec_cards`。`packages/host/src/modules/retrieval/cache-usage.ts` 的 `measureCache()` 遞迴量測 `cache/` 下的一般檔案，跳過符號連結與讀不到的目錄：

- `cache/models/` → `modelBytes`（模型權重）
- `cache/thumbs/` → `thumbBytes`（卡片縮圖）
- 其餘（`index.sqlite` 主檔、`-wal`／`-shm`、`tmp/` 下載暫存）→ `indexBytes`
- `totalBytes` = 以上三者加總；`vectorsBytes` 是向量列的估算值（`CardVectorStore.estimateBytes()`，實際存在 `index.sqlite`）

`CardVectors` 在每次重建結束後、以及沒有重建進行時的 `refresh()` 都會套用上限：先扣掉「整個 cache 減去向量列」的非向量用量，剩下的給向量作 `evictToFit()` 的預算（LRU：`vec_cards_usage.last_used_at` 最舊的先淘汰）。也就是說**模型與縮圖會佔掉 2 GB 的額度**，向量被壓到多少就淘汰多少。

模型與縮圖仍然不由向量模組淘汰：模型刪掉會再下載 625 MB，縮圖歸媒體模組管，淘汰順序牽涉到跨模組的權衡。這次做到的事：

- 模型與縮圖計入 2 GB 的計算（不計入的話上限形同虛設）
- 狀態誠實回報：`RetrievalStatus.cache` 帶 `totalBytes`／`maxBytes`／`overLimit`／`modelsBytes`／`thumbsBytes`／`indexBytes`／`vectorsBytes`。非向量檔案本身就超過上限時，向量全部淘汰也救不了，`overLimit` 會是 `true`，而不是假裝有壓回 2 GB
- 切換索引模型時（`CardVectorStore.selectModel()` 回傳 `true`），`CardVectors` 會先停掉舊的嵌入子行程，再整個刪掉 `cache/models/`（舊模型的權重不再佔用量）；刪不掉只警告，不讓檢索失效
- 被淘汰的卡由全文搜尋找到時會重新排入重建（`noteFullTextHits`，依 revision 只排有標記 `vec_cards_evicted` 的卡），所以淘汰不等於永久消失

還沒做的事（超出這次範圍，一併記錄）：

1. **縮圖的淘汰邏輯**：設計要求先淘汰最久未用的縮圖再整區重建索引；縮圖由媒體模組負責，需要跨模組決定配額與淘汰順序，這次只量測並回報用量，沒有實作縮圖 LRU
2. **整區重建索引**：索引區本身超過上限時重建 `index.sqlite` 的流程沒有實作，目前只靠 `overLimit` 誠實回報
3. **狀態顯示**：`RetrievalStatus.cache` 已經回到呼叫端（儲存空間面板可以顯示），但 `apps/macos` 的面板還沒接上這個欄位

### 容量上限的測試

- `packages/contract-tests/retrieval/cache.test.ts`：「容量上限把模型檔計入，超出預算時淘汰向量」——寫入 64 KB 假權重後以 `maxCacheBytes = indexBytes + 1` 重建，斷言三筆向量全被淘汰、`evicted` 標記為 3、`status.cache.modelsBytes === 65536`、`overLimit === true`（模型沒計入的話這個測試會紅）；「切換索引模型會清掉舊模型權重」——`refresh()` 後 `cache/models/` 不存在，新模型向量重建完成、舊模型列為 0
- `packages/host/test/modules/retrieval/cache-usage.test.ts`：`measureCache()` 把模型、縮圖與索引側車檔分開計算


## acceptance #1：240 卡樣本的命中率這輪沒有重跑

`docs/design/m2-retrieval.md` 第 130 行的驗收條件要求 spike 240 張卡樣本、查詢前 20 名命中率 ≥ 1.00。這一輪沒有用真實模型重跑，原因：

- 這次改動的是容量記帳、重建期間的查詢逾時、閒置計時器與淘汰重排，模型本身、查詢前綴與 240 卡／40 查詢的資料都沒有動
- 重跑要在 spike 的 1.9 GB 模型快取上開一個真實 CPU 推論行程；這台機器同時間有其他重負載（閒置 RSS 實跑時系統 load average 約 4–7），實跑一次約需 10 分鐘以上而且容易被別的負載干擾——先前同一批刺探在重負載下連模型載入都花了 1009 秒
- 把「這次沒量」寫成數字等於假裝驗收過了

spike 當時留下的數字是 Qwen3-Embedding-0.6B 在這 240 張卡上的前 20 名命中率 1.00（`docs/spikes/embedding.md` 的召回表，40 個查詢），但**這一輪沒有重新驗證**。要補的話：`cd` 到主 checkout（`spikes/` 不進 repo），跑 `pnpm --filter @cardiary/spike-embedding recall`，結果寫回這份文件。

## 其餘這次沒做的事

- Swift 測試（`pnpm test:swift`）沒跑
- `verify_run` 伺服器證據：worktree 在專案目錄外時可能被 SmileWork 拒絕；這次以 `pnpm check` 的完整輸出與 commit 雜湊為準（見 commit 列表）
- 閒置 RSS 已實跑到子行程退出（見上節，兩輪）；閒置等待期間的 RSS 兩輪分別約 500 MB 與 64 MB，都不是 Cardiary 主動卸載，要穩定低於 150 MB 要在子行程內釋放 ONNX session
- 縮圖的 LRU 淘汰與整區重建索引沒有實作（見「2 GB 容量上限」節）

