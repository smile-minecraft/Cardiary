# Cardiary macOS 殼

macOS App 的殼：首次啟動選資料夾、啟動並監管內嵌的 Node 主機服務、關閉視窗後留在選單列，
以私有控制面與服務通訊，並用 `apple/CardiaryKit` 以協定連上服務。

設計依據：

- `docs/design/shell-control.md`：殼↔服務的私有控制面（stdin／stdout NDJSON）
- `docs/design/storage.md` 第 5、6 章：資料夾八態、殼的狀態目錄
- `docs/design/protocol.md`：客戶端協定，`CardiaryKit` 的實作對象
- `docs/spikes/macos-shell.md`：技術驗證結論

## 建置與測試

```sh
cd apps/macos
swift build
swift test                 # 61 個測試：控制面、監管、資料夾、狀態目錄、在地化
./Scripts/fetch-node.sh    # 下載 Node 22.19.0 到 ~/Library/Caches/CardiaryNode
./Scripts/build-app.sh     # 組裝 dist/Cardiary.app 並以 Hardened Runtime 簽章
./Scripts/verify-signing.sh # 驗證 allow-jit 的對照（有 → 0、沒有 → 133）
```

`swift test` 會啟動真的子行程 `CardiaryServiceDouble`（測試替身），跑真的 pipe 與
NDJSON，不是用假的傳輸層。

## 目錄

| 路徑                            | 內容                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `Sources/CardiaryShellCore`     | 可測試的核心：Token、frame 編解碼、控制通道、服務監管、資料夾、狀態目錄、在地化 |
| `Sources/CardiaryShell`         | AppKit 殼：選單列、視窗、鑰匙圈、磁碟插拔、開機自啟                             |
| `Sources/CardiaryServiceDouble` | 測試用服務替身（不進 App bundle）                                               |
| `Tests/CardiaryShellCoreTests`  | 單元與端到端測試                                                                |
| `Resources`                     | `Info.plist`、殼與 Node 的 entitlements                                         |
| `Scripts`                       | 下載 Node、組裝 `.app`、簽章驗證                                                |
| `scripts/dev-service.mjs`       | 開發用的服務替身；真正的服務由「協定閘道」工作產出                              |

## 控制面（殼端）

- 殼用 `Process` 啟動 `Contents/Helpers/Node/node --disable-warning=ExperimentalWarning service.mjs`，
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

1. 建置並啟動：`./Scripts/build-app.sh && open dist/Cardiary.app`。
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

1. **client Token 的交付方式沒有定義。** `docs/design/protocol.md` 說「本機 client Token
   由殼交給客戶端」，但 `init` 與 `ready` 都沒有這個欄位，控制面路由也沒有。殼端留了
   `ClientTokenStore` 介面：沒有 Token 就不建立 `CardiaryKit` 連線，選單列的待審批數量
   顯示「需要連上服務」。接上真正的閘道前，需要補一條設計（例如 `ready` 回傳，或新增
   一個 `broker.client-token.get`）。
2. **儲存空間面板的「殼狀態」分類在服務端。** 殼只提供 `broker.shell-state.get`
   的 `{ usedBytes, limitBytes }`；面板屬於儲存與閘道工作。
3. **`scripts/dev-service.mjs` 是開發替身。** 它只實作控制面，不是產品服務；發行版
   要換成「協定閘道」工作產出的 `service.mjs`。
4. **公證未執行。** 本機用 ad-hoc 簽章；發行要 Developer ID + `--timestamp` +
   `notarytool` + `stapler`。
5. **工具子行程的 `inherit` 拒絕與 fd 清單屬於服務端。** 殼這邊驗的是「不傳額外 fd」
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
