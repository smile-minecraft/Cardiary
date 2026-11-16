#!/bin/bash
# 驗證一個已簽章、已公證的 Cardiary.app 是否可以發行。
#
# 用法：
#   ./Scripts/verify-release.sh [App 路徑]
#   EXPECTED_TEAM_ID=TEAMID ./Scripts/verify-release.sh dist/Cardiary.app
#
# 檢查簽章、安全時間戳、Hardened Runtime、公證票券、Gatekeeper、殼與內嵌 Node
# 的 entitlements，以及 sharp／onnxruntime 能不能載入。任何一項失敗都會列出
# 原因並以非零結束。
#
# ad-hoc 簽章的 App 一定會失敗，這是刻意設計：ad-hoc 版本不能對外發行。
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="${1:-$APP_DIR/dist/Cardiary.app}"
EXPECTED_TEAM_ID="${EXPECTED_TEAM_ID:-}"

FAILURES=0
fail() {
  printf '  失敗：%s\n' "$*" >&2
  FAILURES=$((FAILURES + 1))
}
pass() {
  printf '  通過：%s\n' "$*"
}

if [[ ! -d "$APP" ]]; then
  printf '找不到 App bundle：%s\n' "$APP" >&2
  exit 1
fi
APP="$(cd "$APP" && pwd)"

echo "== 簽章 =="
SIGN_INFO="$(/usr/bin/codesign -dvvv "$APP" 2>&1 || true)"
SIGN_FLAGS_HEX="$(printf '%s\n' "$SIGN_INFO" \
  | /usr/bin/sed -n '/^CodeDirectory/ s/.*flags=0x\([0-9a-fA-F]*\).*/\1/p' \
  | /usr/bin/head -1 || true)"

if /usr/bin/codesign --verify --strict --verbose=2 "$APP" >/dev/null 2>&1; then
  pass "codesign --verify --strict"
else
  fail "codesign --verify --strict 不通過"
  /usr/bin/codesign --verify --strict --verbose=4 "$APP" 2>&1 | /usr/bin/sed 's/^/    /' >&2 || true
fi

if printf '%s\n' "$SIGN_INFO" | /usr/bin/grep -q '^Signature=adhoc'; then
  fail "這是 ad-hoc 簽章，不是 Developer ID 簽章；不能用來發行（請設定 DEVELOPER_ID_APPLICATION 後用 release.sh 重新建置）"
else
  AUTHORITY="$(printf '%s\n' "$SIGN_INFO" \
    | /usr/bin/grep '^Authority=Developer ID Application:' \
    | /usr/bin/head -1 | /usr/bin/cut -d= -f2- || true)"
  if [[ -n "$AUTHORITY" ]]; then
    pass "Developer ID Application 簽章：$AUTHORITY"
  else
    fail "找不到 Developer ID Application 簽章 Authority"
  fi
fi

if printf '%s\n' "$SIGN_INFO" | /usr/bin/grep -q '^Timestamp='; then
  pass "簽章帶安全時間戳"
else
  fail "簽章沒有安全時間戳（codesign --timestamp）"
fi

if [[ -n "$SIGN_FLAGS_HEX" ]] && (( (0x$SIGN_FLAGS_HEX & 0x10000) != 0 )); then
  pass "啟用 Hardened Runtime"
else
  fail "沒有啟用 Hardened Runtime（codesign --options runtime）"
fi

TEAM_LINE="$(printf '%s\n' "$SIGN_INFO" \
  | /usr/bin/grep '^TeamIdentifier=' | /usr/bin/head -1 | /usr/bin/cut -d= -f2- || true)"
if [[ -z "$TEAM_LINE" || "$TEAM_LINE" == "not set" ]]; then
  fail "簽章沒有 Team ID"
else
  pass "Team ID：$TEAM_LINE"
  if [[ -n "$EXPECTED_TEAM_ID" && "$TEAM_LINE" != "$EXPECTED_TEAM_ID" ]]; then
    fail "Team ID 是 ${TEAM_LINE}，預期 $EXPECTED_TEAM_ID"
  fi
fi

echo "== 公證與 Gatekeeper =="
if /usr/bin/xcrun stapler validate "$APP" >/dev/null 2>&1; then
  pass "公證票券已 staple"
else
  fail "沒有 staple 有效的公證票券（stapler validate 不通過）"
fi

SPCTL_EXIT=0
SPCTL_OUT="$(/usr/sbin/spctl --assess --type execute --verbose=4 "$APP" 2>&1)" || SPCTL_EXIT=$?
if [[ "$SPCTL_EXIT" -eq 0 ]] \
  && printf '%s\n' "$SPCTL_OUT" | /usr/bin/grep -q 'source=Notarized Developer ID'; then
  pass "Gatekeeper 放行（Notarized Developer ID）"
else
  fail "Gatekeeper 未放行（spctl 退出碼 ${SPCTL_EXIT}）：$(printf '%s' "$SPCTL_OUT" | /usr/bin/tr '\n' ' ')"
fi

echo "== 內嵌程式 =="
NODE_BIN="$APP/Contents/Helpers/Node/node"
if [[ -x "$NODE_BIN" ]]; then
  if /usr/bin/codesign --verify --strict --verbose=2 "$NODE_BIN" >/dev/null 2>&1; then
    pass "內嵌 Node 的簽章有效"
  else
    fail "內嵌 Node 的簽章無效"
  fi
else
  fail "找不到內嵌 Node：$NODE_BIN"
fi

SERVICE_DIR="$APP/Contents/Resources/Service"
if [[ -d "$SERVICE_DIR" ]]; then
  NATIVE_COUNT=0
  NATIVE_BAD=0
  while IFS= read -r -d '' native; do
    NATIVE_COUNT=$((NATIVE_COUNT + 1))
    if ! /usr/bin/codesign --verify --strict "$native" >/dev/null 2>&1; then
      fail "內嵌原生模組簽章無效：${native#"$APP"/}"
      NATIVE_BAD=1
    fi
  done < <(/usr/bin/find "$SERVICE_DIR" -type f \
    \( -name '*.node' -o -name '*.dylib' -o -name '*.so' \) -print0)
  if [[ "$NATIVE_COUNT" -eq 0 ]]; then
    fail "服務目錄裡找不到原生模組（sharp／onnxruntime）"
  elif [[ "$NATIVE_BAD" -eq 0 ]]; then
    pass "內嵌原生模組簽章有效（$NATIVE_COUNT 個）"
  fi
else
  fail "找不到服務目錄：$SERVICE_DIR"
fi

echo "== Entitlements =="
# 輸出每一行 "鍵=值"；沒有 entitlements 時輸出空字串。
entitlement_entries() {
  local target="$1"
  local file
  file="$(mktemp "${TMPDIR:-/tmp}/cardi-entitlements-XXXX")"
  if /usr/bin/codesign -d --entitlements :- "$target" >"$file" 2>/dev/null; then
    /usr/bin/plutil -p "$file" 2>/dev/null \
      | /usr/bin/sed -n 's/^  "\([^"]*\)" => \(.*\)$/\1=\2/p'
  fi
  rm -f "$file"
}

# 出現的每一項都必須在允許清單內、值為 true；允許清單裡的每一項也必須出現。
check_entitlements() {
  local label="$1" target="$2" allowed="$3"
  local entries key value required listed="" bad=0

  entries="$(entitlement_entries "$target")"

  if [[ -n "$entries" ]]; then
    while IFS='=' read -r key value; do
      [[ -n "$key" ]] || continue
      case "$key" in
        com.apple.security.get-task-allow|com.apple.security.keychain-access-groups)
          fail "$label 有禁止的 entitlement：$key"
          bad=1
          continue
          ;;
      esac
      if [[ " $allowed " != *" $key "* ]]; then
        fail "$label 有未允許的 entitlement：$key"
        bad=1
        continue
      fi
      if [[ "$value" != "true" ]]; then
        fail "$label 的 $key 值是 ${value}，預期 true"
        bad=1
        continue
      fi
      listed="$listed$key "
    done <<<"$entries"
  fi

  for required in $allowed; do
    if ! printf '%s\n' "$entries" | /usr/bin/cut -d= -f1 | /usr/bin/grep -Fxq -- "$required"; then
      fail "$label 缺少必要 entitlement：$required"
      bad=1
    fi
  done

  if [[ "$bad" -eq 0 ]]; then
    if [[ -z "$allowed" ]]; then
      pass "$label 的 entitlements 是空清單"
    else
      pass "$label 的 entitlements：$listed"
    fi
  fi
}

check_entitlements "殼" "$APP" ""
check_entitlements "內嵌 Node" "$NODE_BIN" \
  "com.apple.security.cs.allow-jit com.apple.security.cs.disable-library-validation"

echo "== 原生模組載入 =="
if [[ -x "$NODE_BIN" && -f "$SERVICE_DIR/dist/main.js" ]]; then
  LOAD_EXIT=0
  LOAD_OUT="$(cd "$SERVICE_DIR" \
    && "$NODE_BIN" -e 'require("sharp"); require("onnxruntime-node"); process.stdout.write("loaded")' 2>&1)" \
    || LOAD_EXIT=$?
  if [[ "$LOAD_EXIT" -eq 0 ]]; then
    pass "sharp 與 onnxruntime-node 可載入"
  else
    fail "原生模組載入失敗（退出碼 ${LOAD_EXIT}）：$(printf '%s' "$LOAD_OUT" | /usr/bin/tr '\n' ' ')"
  fi
else
  fail "找不到內嵌 Node 或服務進入點，無法驗證原生模組"
fi

echo
if [[ "$FAILURES" -eq 0 ]]; then
  echo "結果：通過，這是可發行的版本。"
  exit 0
fi
printf '結果：%d 項不通過，這不是可發行的版本。\n' "$FAILURES" >&2
exit 1
