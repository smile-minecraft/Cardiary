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

閒置 RSS（真實子行程、真實模型）：

```sh
node /path/to/measure-embedder-rss.mjs
```

`LocalEmbedder` 以 `dist/modules/retrieval/embedding-worker.js` 啟動子行程，`HF_HOME` 指向一個臨時目錄，其中 `models/onnx-community/Qwen3-Embedding-0.6B-ONNX` 是 symlink 到 `~/Library/Caches/cardiary-embedding-spike/hf/onnx-community/Qwen3-Embedding-0.6B-ONNX`（M2 spike 留下的 585 MB q8 ONNX 權重，沒有為了這次量測重新下載）。指令送出一句話嵌入，之後不用子行程，每 20 秒查一次 `ps` 的 RSS，直到子行程自行結束。這是對設計第 7 章第 6 項「閒置後 RSS 回到 150 MB 以下」的實測——設計靠的是閒置 10 分鐘後 `LocalEmbedder` 把子行程 SIGTERM 掉。

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

這次用真實子行程跑到子行程自己退出（沒有把 spike 的數字搬過來；下面每個數字都是這次實跑的輸出）：

- 模型：`onnx-community/Qwen3-Embedding-0.6B-ONNX` 的 `model_quantized.onnx`（585 MB q8），`HF_HOME` 指向臨時目錄，`models/onnx-community` 是 symlink 到 `~/Library/Caches/cardiary-embedding-spike/hf/onnx-community/Qwen3-Embedding-0.6B-ONNX`（spike 留下的權重，這次沒有重新下載）
- 機器：Apple M4、32 GB、macOS 27.2、Node v26.13.1
- 過程與數字：
  - 子行程啟動到第一句「手寫字練習的實際量測句子」嵌入完成共約 **1009 秒**（含模型載入；CPU 與其他重度程序共用，這個數字只記錄這次不複製，當時系統上還有其他重節點程序）
  - 第一句完成、1 秒內：`rss_mb=1484`；20 秒後升到 1995，之後穩定在 **1993–1995 MB**，一直到閒置約 220 秒
  - 閒置約 220 秒後開始緩慢下降：1832 → 1803 → 1442 → 1065 → 903 → 815 → 722 MB；最後停在 **721–722 MB**（約 t=+1549s 起）
  - t=+1609s（嵌入完成後 600 秒）：`LocalEmbedder` 閒置超時、對子行程（含 process group）送 SIGTERM，子行程退出，`ps` 查不到該 PID，RSS = 0
- 解釋：
  - 在 10 分鐘閒置等待期間，記憶體**沒有**降到 150 MB 以下；最後階段停在 ~721 MB
  - 設計第 7 章第 6 項「閒置後 RSS 回到 150 MB 以下（子行程退出即成立）」只在子行程退出那一刻成立（退出後 RSS = 0）；閒置期間記憶體仍然是數百 MB 到 1.9 GB
  - 閒置期間緩慢下降是 ONNX 執行期在回收，不是 Cardiary 主動卸載；要讓閒置期間 RSS 真的小於 150 MB，需要子行程內主動釋放 ONNX session／權重或延後載入，這牽涉到下一次查詢的重新載入成本與多少常駐記憶體是可接受的，這次沒有動
- 目標「閒置後 RSS < 150 MB」：
  - 若把「閒置後」解讀為「退出後」：成立（RSS = 0）
  - 若解讀為「閒置等待期間」：不成立，實測 ~721–1995 MB
  - 後續工作：在 `LocalEmbedder` 閒置期間主動釋放 ONNX session，或在子行程內實作記憶體上限；兩者都要先決定「閒置後第一次查詢的延遲可以接受到多少」

## 2 GB 容量上限的現況

`CardVectorStore.estimateBytes()` 現在只算 `vec_cards` 列（向量位元組 + 文字欄位 + 每列 30 位元組的標頭）；`evictToFit(2GB)` 也只用這個值判斷要淘汰多少。以下不算進去：

- `cache/models` 下的模型權重（spike 留下的 q8 權重約 585 MB；同一台機器的 spike 快取目錄約 1.1 GB）
- `vec_cards_usage`、`vec_cards_evicted` 兩張附屬表
- 卡片縮圖、原始附件、`cache/index.sqlite` 本身與它的側車檔

換模型時 `CardVectorStore.selectModel()` 會把 `vec_cards`、`vec_cards_usage`、`vec_cards_evicted` 全部刪掉並寫入 meta，但**不會**清掉 `cache/models` 下上一個模型的權重檔；`LocalEmbedder` 也不會主動刪舊模型目錄。所以「整個 cache 目錄不會超過 2 GB」在現況下不成立，只有「向量列 ≤ 2 GB」成立。

這些缺口這次沒有修：

1. 容量上限要不要把 `cache/models`、縮圖、附屬表算進去，牽涉到「模型要不要常駐」、「淘汰順序」與「刪掉權重後重新下載的成本」，需要決定後才改
2. 換模型時清掉舊權重：在 `selectModel` 或啟用處路徑上刪 `cache/models` 舊目錄會動到使用者資料目錄，需要先確認刪除語義與可還原性
3. 縮圖與附件原本就不在 `vec_cards` 的容量模型裡，也不該由向量快取決定誰活誰死

建議的後續工作：把容量統計改成整個 `cache/` 目錄（`walk` 後加總，或用 `statSync` 逐項）並明確定義附屬表與模型的配額；換模型流程改為「新模型下載完成後再淘汰舊權重」並保留回滾；縮圖/附件各自用自己的配額上限，與向量快取脫鉤。

## 其餘這次沒做的事

- Swift 測試（`pnpm test:swift`）沒跑
- `verify_run` 伺服器證據：worktree 在專案目錄外時可能被 SmileWork 拒絕；這次以 `pnpm check` 的完整輸出與 commit 雜湊為準（見 commit 列表）
- 閒置 RSS 已實跑到子行程退出（見上節）；閒置等待期間的 RSS 沒有小於 150 MB
