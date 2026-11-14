#!/bin/bash
# 下載官方 Node 執行檔到使用者快取目錄（不進版控），並用官方 SHA256 驗證。
#
# 用法：./Scripts/fetch-node.sh
# 環境變數：
#   CARDIARY_NODE_VERSION  版本，預設 22.19.0（規格鎖定的版號）
#   CARDIARY_NODE_CACHE    快取目錄，預設 ~/Library/Caches/CardiaryNode
set -euo pipefail

VERSION="${CARDIARY_NODE_VERSION:-22.19.0}"
CACHE="${CARDIARY_NODE_CACHE:-$HOME/Library/Caches/CardiaryNode}"
ARCHIVE="node-v${VERSION}-darwin-arm64.tar.gz"
BASE="https://nodejs.org/dist/v${VERSION}"
TARGET="$CACHE/node-v${VERSION}-darwin-arm64"

if [[ -x "$TARGET/bin/node" ]]; then
  echo "$TARGET/bin/node"
  exit 0
fi

mkdir -p "$CACHE"
TEMP="$(mktemp -d "${TMPDIR:-/tmp}/cardi-node-XXXX")"
trap 'rm -rf "$TEMP"' EXIT

echo "下載 Node ${VERSION}…" >&2
curl -fsSL -o "$TEMP/$ARCHIVE" "$BASE/$ARCHIVE"
curl -fsSL -o "$TEMP/SHASUMS256.txt" "$BASE/SHASUMS256.txt"

EXPECTED="$(grep " ${ARCHIVE}\$" "$TEMP/SHASUMS256.txt" | awk '{print $1}')"
if [[ -z "$EXPECTED" ]]; then
  echo "官方校驗檔找不到 $ARCHIVE" >&2
  exit 1
fi
ACTUAL="$(shasum -a 256 "$TEMP/$ARCHIVE" | awk '{print $1}')"
if [[ "$EXPECTED" != "$ACTUAL" ]]; then
  echo "SHA256 不符：預期 $EXPECTED，實際 $ACTUAL" >&2
  exit 1
fi

tar -xzf "$TEMP/$ARCHIVE" -C "$TEMP"
rm -rf "$TARGET"
mv "$TEMP/node-v${VERSION}-darwin-arm64" "$TARGET"
echo "已下載並驗證 Node $("$TARGET/bin/node" --version)：$TARGET/bin/node" >&2
echo "$TARGET/bin/node"
