#!/bin/bash
# 把主機服務打包成可以放進 App bundle 的目錄。
#
# 用法：
#   ./Scripts/pack-service.sh <目標目錄>
#
# 內容：packages/host 的 dist 與 production 依賴（含 Pi Durable、儲存套件）。
# App 執行時用 bundle 內的 Node 跑 <目標目錄>/dist/main.js。
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$APP_DIR/../.." && pwd)"
TARGET="${1:-$APP_DIR/build/service}"

if [[ -z "$TARGET" ]]; then
  echo "用法：$0 <目標目錄>" >&2
  exit 2
fi

echo "建置主機服務（${ROOT}）…"
(cd "$ROOT" && pnpm build)

echo "打包到 ${TARGET} …"
rm -rf "$TARGET"
mkdir -p "$(dirname "$TARGET")"
(cd "$ROOT" && pnpm --filter @cardiary/host deploy --prod "$TARGET" >/dev/null)

if [[ ! -f "$TARGET/dist/main.js" ]]; then
  echo "打包後找不到 $TARGET/dist/main.js" >&2
  exit 1
fi

# pnpm 會在 node_modules/.pnpm/node_modules 放指向工作區的連結；複製到 App
# bundle 之後那些連結會斷掉，codesign 也會因此失敗。移除所有指向套件外或
# 不存在的符號連結，再讓啟動測試證明服務仍可執行。
node - "$TARGET" <<'NODE'
const { existsSync, lstatSync, readdirSync, readlinkSync, realpathSync, rmSync } = require("node:fs");
const { join, resolve } = require("node:path");

const root = realpathSync(process.argv[2]);
const walk = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const target = resolve(directory, readlinkSync(full));
      if (!target.startsWith(root) || !existsSync(target)) {
        rmSync(full, { force: true });
      }
      continue;
    }
    if (entry.isDirectory()) walk(full);
  }
};
walk(root);
NODE

echo "完成：${TARGET}/dist/main.js"
