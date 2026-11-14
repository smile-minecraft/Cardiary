# Cardiary macOS 殼

macOS App 的殼：首次啟動選資料夾、啟動並監管內嵌的 Node 主機服務、關閉視窗後留在選單列，
以私有控制面與服務通訊，並用客戶端協定（`apple/CardiaryKit`）連上服務。

客戶端 Token 由殼簽發：殼每次啟動服務時產生一把，經 `init.clientToken` 走 stdin 交給服務，
服務在 `ready.clientToken` 回同一把。Token 只在殼與服務的記憶體裡，不進 argv、環境變數、
日誌或磁碟；服務換行程就換一把，殼收到新的就重連。

設計依據：

- `docs/design/shell-control.md`：殼↔服務的私有控制面（stdin／stdout NDJSON）
- `docs/design/storage.md` 第 5、6 章：資料夾八態、殼的狀態目錄
- `docs/design/protocol.md`：客戶端協定，`CardiaryKit` 的實作對象
- `docs/spikes/macos-shell.md`：技術驗證結論

## 建置與測試

```sh
cd apps/macos
swift build
swift test                 # 控制面、監管、資料夾、狀態目錄、在地化、真服務 E2E
./Scripts/fetch-node.sh    # 下載 Node 22.19.0 到 ~/Library/Caches/CardiaryNode
./Scripts/pack-service.sh  # 把 packages/host 打包成 build/service（build-app.sh 會呼叫）
./Scripts/build-app.sh     # 組裝 dist/Cardiary.app 並以 Hardened Runtime 簽章
./Scripts/verify-signing.sh # 驗證 allow-jit 的對照（有 → 0、沒有 → 133）
```

`swift test` 會啟動真的子行程：控制面測試用 `CardiaryServiceDouble`（測試替身），
`RealServiceEndToEndTests` 與 `BundledServiceTests` 則啟動真正的 `packages/host`
（前者直接跑 `dist/main.js`，後者先 `pack-service.sh` 打包再跑），都是真的 pipe 與 NDJSON。

`build-app.sh` 預設把**真正的主機服務**放進 `Contents/Resources/Service/`（`dist/` 加
production 依賴，用 `pnpm deploy` 打包）；`CARDIARY_SERVICE_SCRIPT=...` 可以換成單一
腳本，開發用的 `scripts/dev-service.mjs` 就是走這條路。

## 目錄

| 路徑                            | 內容                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------- |
| `Sources/CardiaryShellCore`     | 可測試的核心：Token、frame 編解碼、控制通道、服務監管、資料夾、狀態目錄、在地化   |
| `Sources/CardiaryShell`         | AppKit 殼：選單列、視窗、鑰匙圈、磁碟插拔、開機自啟                               |
| `Sources/CardiaryServiceDouble` | 測試用服務替身（不進 App bundle）                                                 |
| `Tests/CardiaryShellCoreTests`  | 單元與端到端測試                                                                  |
| `Resources`                     | `Info.plist`、殼與 Node 的 entitlements                                           |
| `Scripts`                       | 下載 Node、組裝 `.app`、簽章驗證                                                  |
| `Scripts/pack-service.sh`       | 打包 `packages/host`（dist 加 production 依賴）給 App bundle                      |
| `scripts/dev-service.mjs`       | 開發用的服務替身；`build-app.sh` 預設不用它，只給測試與 `CARDIARY_SERVICE_SCRIPT` |

## 控制面（殼端）

- 殼用 `Process` 啟動 `Contents/Helpers/Node/node --disable-warning=ExperimentalWarning <服務進入點>`（正式 bundle 是 `Contents/Resources/Service/dist/main.js`；空的資料夾會多帶 `--initialize-folder`），
  子行程的 stdin／stdout 是匿名 pipe。沒有 socketpair、沒有額外 fd、沒有 Unix socket。
- `init` 是 stdin 第一行，帶 `token`（殼→服務）與 `brokerToken`（服務→殼）。Token 每次啟動
  重新產生，只經過這一行；不進 argv、環境變數、日誌或磁碟。
- `ready` 是 stdout 第一行；`hello` 驗證 `brokerToken` 與 pid 後，殼回 `hello-ack`。
- 每個 frame 都帶 Token；方向錯了就關閉通道。`response` 的 `replyTo` 對不上在途請求也關閉。
- 路由白名單是精確字串：`control.health`／`pause`／`resume`／`shutdown`；
  `broker.folder.get`／`broker.keychain.get`／`broker.shell-state.get`；
  `notify.fatal`／`notify.maintenance`。沒有列舉型路由。
- 生命週期請求共用一個槽位；在途時不送 `control.health`，也不把等待算成失敗。
  服務送 `notify.maintenance`（刪除／VACUUM）時同樣暫停健康檢查。
- 正常關閉：先送 `control.shutdown`、收到回應才關 stdin；逾時才 SIGTERM／SIGKILL。

## 殼的狀態目錄

`~/Library/Application Support/com.cardiary/`，只放三類內容：

- `folder-authorization.json`：安全範圍書籤、顯示路徑、`volumeUUID`、`folderId`
- `shell-YYYYMMDD.log` 與 `os_log`：生命週期、路徑、錯誤碼、版本
- `runtime/`：可重建的執行期檔案（目前沒有）

上限 50 MB，殼啟動時清理：先刪最舊的日誌，再刪 `runtime/`。`folder-authorization.json` 永遠不刪。
`broker.shell-state.get` 只回 `{ usedBytes, limitBytes }`。

## 資料夾

- 殼用 `NSOpenPanel` 取得資料夾、建立 `.withSecurityScope` 書籤。關閉 App Sandbox 時，
  書籤主要用於記住位置與插拔偵測，權限仍由 TCC 與檔案權限決定。
- 資料夾不在、書籤解析失敗、磁碟沒接：殼顯示「資料不可用」，**不啟動服務、不建立空資料夾**。
- `NSWorkspace.willUnmountNotification`：先把資料夾標成不可用，再送 `control.pause`。
  `didMountNotification`：書籤與 `volumeUUID` 相符才 `control.resume`。
- 非 APFS 只警告，不阻擋。

## 人工驗收：TCC 的隱私提示歸屬

這一項**沒有**自動化，需要在實機按一次。步驟：

1. 建置並啟動：`./Scripts/build-app.sh && open dist/Cardiary.app`。預設 bundle 帶的是
   `scripts/dev-service.mjs`（控制面替身，`ready.clientPort` 為 0，代表沒有客戶端協定）；
   這樣選資料夾後服務就能交握，TCC 提示才會出現。
2. 系統設定 → 隱私權與安全性 → 完全磁碟存取：確認 Cardiary 不在允許清單（或先移除）。
3. 從選單列選「選擇資料夾…」，選 `~/Desktop` 下的一個資料夾。
4. 預期的系統提示：標題顯示 **Cardiary**（不是 node／CardiaryServiceDouble）。按「允許」。
5. 結束 App 再啟動：不應再詢問同一個資料夾。
6. 觀察歸屬：

   ```sh
   /usr/bin/log show --last 2m --predicate 'process == "tccd"' --info | grep -i cardiary
   ```

   預期 `responsible` 是 `com.cardiary`（App），`accessing` 是內嵌的 `node`。

在這一條真的按過之前，不能宣稱 TCC 已驗證。目前的自動證據只有「由殼啟動的 node
子行程，其權限請求的責任行程是 App」這個機制（spike 已驗證）。

## 已知缺口（移交給後續工作）

1. **client Token 已接上。** 殼簽發一把，經 `init.clientToken` 交給服務，服務在
   `ready.clientToken` 回同一把（省略時服務自己產生並回報；與控制／代理 Token 重複會
   直接拒絕）。殼存進記憶體並建立 `CardiaryKit` 連線；細節見 `docs/design/shell-control.md`。
2. **儲存空間面板的「殼狀態」分類在服務端。** 殼只提供 `broker.shell-state.get`
   的 `{ usedBytes, limitBytes }`；面板屬於儲存與閘道工作。
3. **內嵌服務的體積。** `packages/host` 的 production 依賴含 Pi Durable 與它帶進來的
   AWS SDK，打包後約 130 MB（App 總計約 240 MB）。M0 先照實內嵌；之後要 trim（例如
   把用不到的供應商 SDK 拿掉）再談發行。
4. **GUI 內的對話沒有人工驗證。** 殼的核心層已用真服務跑完含審批的對話，但 App 內的
   選單操作、TCC 提示與 `tccd` 歸屬仍列手動（`docs/acceptance/chapter-13.md`）。
5. **公證未執行。** 本機用 ad-hoc 簽章；發行要 Developer ID + `--timestamp` +
   `notarytool` + `stapler`。
6. **工具子行程的 `inherit` 拒絕與 fd 清單屬於服務端。** 殼這邊驗的是「不傳額外 fd」
   與「控制通道只有 stdin／stdout」；spawn wrapper 的硬規則由主機服務工作實作。

## 測試涵蓋的驗收項目

| 驗收                                             | 測試                                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| 控制 Token 只經 stdin、不在 argv／環境變數／日誌 | `ControlPlaneIntegrationTests.testTokensTravelOnlyOnStdin`、`ShellLogTests`   |
| TMPDIR／TMP／TEMP 指到 `<folder>/tmp`            | `testServiceEnvironmentPointsTempAtFolder`、`ServiceLaunchPlanTests`          |
| 錯／缺 Token 一律關閉、沒有 payload              | `testWrongHelloTokenClosesChannel`、`testWrongHelloPidClosesChannel`          |
| `replyTo` 對不上就丟棄並關閉                     | `testMismatchedReplyToClosesChannel`                                          |
| 每行上限、超過就關閉                             | `testOversizeFrameClosesChannel`、`ControlWireTests`                          |
| 沒有 listener、沒有 socket 路徑                  | `testControlPlaneHasNoListenerAndNoSocketPath`                                |
| 金鑰只回單一項目、不含長度／指紋                 | `testBrokerKeychainGetReturnsSingleItemWithoutMetadata`、`BrokerServiceTests` |
| 生命週期序列化、慢速 pause 不被 health 殺掉      | `testSecondLifecycleRequestIsBusy`、`testSlowPauseIsNotKilledByHealthChecks`  |
| maintenance 期間暫停 health                      | `testMaintenanceSuspendsHealthChecks`                                         |
| 強制結束後自動重啟、資料夾不在就不重啟           | `testRestartsAfterForcedKill`、`testExitWithUnavailableFolderDoesNotRestart`  |
| 關閉後沒有殘留行程、cleanShutdown 來自服務       | `testShutdownLeavesNoProcess`、`testShutdownWhilePausedReportsCleanShutdown`  |
| 殼狀態上限 50 MB、授權紀錄不刪                   | `ShellStateDirectoryTests`                                                    |
| 介面字串繁中＋英文                               | `L10nTests`                                                                   |
| 資料夾八態與協定三態對照                         | `FolderTests.testAllEightStatesMapToProtocolStates`                           |
