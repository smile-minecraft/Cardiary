# Cardiary

以卡片為記憶單位、以 Mac 為主機的原生個人代理 App。名稱取自 Card + Diary。

目前在 M0（地基）階段：主機服務、引擎轉接層、儲存套件、協定與 macOS 殼都已接起來，
但還沒有可用的產品介面。

- 規格：[docs/spec.md](docs/spec.md)
- 開發守則與目錄說明：[AGENTS.md](AGENTS.md)
- 第 13 章驗收的自動化範圍與手動步驟：[docs/acceptance/chapter-13.md](docs/acceptance/chapter-13.md)

## 開發

需要 Node 22.19.0 以上與 pnpm 9。

```sh
pnpm install
pnpm check          # lint、格式、建置、TypeScript 測試（含契約測試）
```

`pnpm check` 會先建置 `packages/host/dist`，契約測試再以子行程啟動它。

### 主機服務的兩種組裝

```sh
# 產品組裝：@cardiary/storage 的持久化儲存 + Pi Durable 轉接層
TMPDIR=<folder>/tmp node packages/host/dist/main.js --folder <folder>

# 測試組裝：記憶體儲存 + 假引擎（契約測試用）
node packages/host/dist/main.js --folder <folder> --engine fake --demo
```

- `--folder` 必須是絕對路徑，`TMPDIR`／`TMP`／`TEMP` 要指向 `<folder>/tmp`；服務啟動時會清空暫存區。
- `--initialize-folder`：資料夾還是空的時建立 `state/folder.json` 與三個資料庫。正式使用由殼負責。
- `--demo`：註冊示範工具（`demo.echo`、`demo.sleep`、`demo.card`、`demo.exec`）。
- `--script <file>`：每個回合依序取用的腳本；Pi 組裝會把腳本轉成固定的模型回應。
- 沒有 `--folder` 時走控制模式：stdin 第一行 `init`，stdout 第一行 `ready`，之後同一對 pipe 走 NDJSON。

## macOS 殼

```sh
cd apple/CardiaryKit
swift test

cd apps/macos
swift build
swift test
./Scripts/fetch-node.sh
./Scripts/build-app.sh
```

`swift test` 會啟動真的子行程 `CardiaryServiceDouble`，跑真的 pipe 與 NDJSON。

## 授權

MIT
