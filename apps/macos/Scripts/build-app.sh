#!/bin/bash
# 組出可執行的 .app：殼執行檔 + 內嵌 Node + 服務腳本，並以 Hardened Runtime 簽章。
#
# 用法：
#   ./Scripts/build-app.sh
#   CODESIGN_IDENTITY="Developer ID Application: …" ./Scripts/build-app.sh
#   CARDIARY_SERVICE_SCRIPT=/path/to/service.mjs ./Scripts/build-app.sh
#   CONFIGURATION=debug ./Scripts/build-app.sh
#
# App Sandbox 一律關閉：官網直下載、不上 App Store。隔離由 Hardened Runtime、
# Developer ID 簽章、公證與權限規則承擔。
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIGURATION="${CONFIGURATION:-release}"
IDENTITY="${CODESIGN_IDENTITY:--}"
BUNDLE_NAME="Cardiary"
EXECUTABLE_NAME="CardiaryShell"
DIST_DIR="$APP_DIR/dist"
APP_BUNDLE="$DIST_DIR/$BUNDLE_NAME.app"
MINIMUM_NODE="22.19.0"

if [[ -z "${CARDIARY_NODE:-}" ]]; then
  CARDIARY_NODE="$("$APP_DIR/Scripts/fetch-node.sh")"
fi
NODE_SOURCE="$CARDIARY_NODE"
if [[ ! -x "$NODE_SOURCE" ]]; then
  echo "找不到 Node 執行檔：$NODE_SOURCE" >&2
  exit 1
fi

# 預設內嵌真正的主機服務（packages/host 的 dist 與 production 依賴）；
# 開發或測試可以用 CARDIARY_SERVICE_SCRIPT 換成單一腳本。
SERVICE_DIR="$APP_DIR/build/service"
if [[ -n "${CARDIARY_SERVICE_SCRIPT:-}" ]]; then
  SERVICE_SCRIPT="$CARDIARY_SERVICE_SCRIPT"
  if [[ ! -f "$SERVICE_SCRIPT" ]]; then
    echo "找不到服務腳本：$SERVICE_SCRIPT" >&2
    exit 1
  fi
else
  SERVICE_SCRIPT="$SERVICE_DIR/dist/main.js"
fi

NODE_VERSION="$("$NODE_SOURCE" --version)"
if ! "$NODE_SOURCE" -e '
  const current = process.versions.node.split(".").map(Number);
  const minimum = process.argv[1].split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (current[i] > minimum[i]) process.exit(0);
    if (current[i] < minimum[i]) process.exit(1);
  }
  process.exit(0);
' "$MINIMUM_NODE"; then
  echo "內嵌的 Node 版本 $NODE_VERSION 低於規格要求的 $MINIMUM_NODE" >&2
  exit 1
fi

echo "建置殼（${CONFIGURATION}）…"
swift build --package-path "$APP_DIR" -c "$CONFIGURATION"
BIN_DIR="$(swift build --package-path "$APP_DIR" -c "$CONFIGURATION" --show-bin-path)"

echo "組裝 App bundle…"
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS" \
  "$APP_BUNDLE/Contents/Helpers/Node" \
  "$APP_BUNDLE/Contents/Resources/Service"
cp "$BIN_DIR/$EXECUTABLE_NAME" "$APP_BUNDLE/Contents/MacOS/$EXECUTABLE_NAME"
cp "$NODE_SOURCE" "$APP_BUNDLE/Contents/Helpers/Node/node"
cp "$APP_DIR/Resources/Info.plist" "$APP_BUNDLE/Contents/Info.plist"
printf 'APPL????' >"$APP_BUNDLE/Contents/PkgInfo"

if [[ -n "${CARDIARY_SERVICE_SCRIPT:-}" ]]; then
  cp "$SERVICE_SCRIPT" "$APP_BUNDLE/Contents/Resources/Service/service.mjs"
else
  echo "打包主機服務到 bundle…"
  "$APP_DIR/Scripts/pack-service.sh" "$SERVICE_DIR" >/dev/null
  rm -rf "$APP_BUNDLE/Contents/Resources/Service"
  mkdir -p "$APP_BUNDLE/Contents/Resources/Service"
  cp -R "$SERVICE_DIR/dist" "$SERVICE_DIR/node_modules" "$SERVICE_DIR/package.json" \
    "$APP_BUNDLE/Contents/Resources/Service/"
fi


sign() {
  local target="$1"
  local entitlements="$2"
  # --timestamp=none：本機驗證不連網路；對外發行要加 --timestamp 後再公證。
  /usr/bin/codesign --force --timestamp=none --options runtime \
    --entitlements "$entitlements" --sign "$IDENTITY" "$target"
}

echo "簽章（身分：${IDENTITY}）…"
# 內嵌的執行檔先簽，外層 bundle 才封得起來。
sign "$APP_BUNDLE/Contents/Helpers/Node/node" "$APP_DIR/Resources/node.entitlements"
sign "$APP_BUNDLE" "$APP_DIR/Resources/cardiary-shell.entitlements"

echo "驗證簽章…"
/usr/bin/codesign --verify --strict --verbose=2 "$APP_BUNDLE" 2>&1 | sed 's/^/  /'
echo "殼的 entitlements（應為空）："
/usr/bin/codesign -d --entitlements - "$APP_BUNDLE" 2>&1 | sed 's/^/  /'
echo "內嵌 Node 的 entitlements（應只有 allow-jit）："
/usr/bin/codesign -d --entitlements - "$APP_BUNDLE/Contents/Helpers/Node/node" 2>&1 | sed 's/^/  /'

cat <<SUMMARY

完成：$APP_BUNDLE
  殼執行檔      Contents/MacOS/$EXECUTABLE_NAME
  內嵌 Node     Contents/Helpers/Node/node（${NODE_VERSION}，需求 >= ${MINIMUM_NODE}）
  服務腳本      $SERVICE_SCRIPT
  沙盒          關閉
  簽章身分      $IDENTITY

手動啟動：open "$APP_BUNDLE"
TCC 手動驗收步驟見 apps/macos/README.md。
SUMMARY
