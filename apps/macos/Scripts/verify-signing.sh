#!/bin/bash
# 驗證 Hardened Runtime 下內嵌 Node 的 entitlement 行為。
#
# 用法：./Scripts/verify-signing.sh [node 路徑]
#
# 檢查三件事，結果直接印出來：
#   1. 帶 com.apple.security.cs.allow-jit 簽章時，Node 可以執行 JS（退出碼 0）。
#   2. 不帶任何 entitlement 重簽後，Node 以 SIGTRAP 結束（退出碼 133）。
#   3. 殼的 entitlements 是空的、Node 的只有 allow-jit（若 dist/Cardiary.app 存在）。
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE="${1:-${CARDIARY_NODE:-}}"
if [[ -z "$NODE" ]]; then
  NODE="$("$APP_DIR/Scripts/fetch-node.sh")"
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/cardi-sign-XXXX")"
trap 'rm -rf "$WORK"' EXIT

cp "$NODE" "$WORK/node"
chmod +x "$WORK/node"

EMPTY_ENTITLEMENTS="$WORK/empty.entitlements"
cat >"$EMPTY_ENTITLEMENTS" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict/></plist>
PLIST

echo "== 原始 Node =="
"$WORK/node" --version

echo
echo "== 重簽：Hardened Runtime + allow-jit =="
/usr/bin/codesign --force --timestamp=none --options runtime \
  --entitlements "$APP_DIR/Resources/node.entitlements" --sign - "$WORK/node"
/usr/bin/codesign -d --entitlements - "$WORK/node" 2>&1 | sed 's/^/  /'
set +e
"$WORK/node" -e 'process.exit(0)'
JIT_EXIT=$?
set -e
echo "  執行結果：退出碼 ${JIT_EXIT}（預期 0）"

echo
echo "== 重簽：Hardened Runtime、不帶 entitlements =="
/usr/bin/codesign --force --timestamp=none --options runtime \
  --entitlements "$EMPTY_ENTITLEMENTS" --sign - "$WORK/node"
/usr/bin/codesign -d --entitlements - "$WORK/node" 2>&1 | sed 's/^/  /'
set +e
"$WORK/node" -e 'process.exit(0)'
NOJIT_EXIT=$?
set -e
echo "  執行結果：退出碼 ${NOJIT_EXIT}（預期 133，代表 SIGTRAP）"

echo
if [[ -d "$APP_DIR/dist/Cardiary.app" ]]; then
  echo "== App bundle 的 entitlements =="
  echo "殼："
  /usr/bin/codesign -d --entitlements - "$APP_DIR/dist/Cardiary.app" 2>&1 | sed 's/^/  /'
  echo "Node："
  /usr/bin/codesign -d --entitlements - "$APP_DIR/dist/Cardiary.app/Contents/Helpers/Node/node" 2>&1 | sed 's/^/  /'
fi

echo
if [[ "$JIT_EXIT" -eq 0 && "$NOJIT_EXIT" -eq 133 ]]; then
  echo "結果：符合設計（allow-jit 可執行；沒有它就以 SIGTRAP 結束）"
  exit 0
fi
echo "結果：與設計不符，請檢查上方輸出" >&2
exit 1
