#!/bin/bash
# 一次完成 Cardiary 的發行流程：release 建置、Developer ID 簽章（含安全時間戳）、
# 公證、staple、Gatekeeper 驗證，最後產出可上傳的 zip 與 dmg。
#
# 用法：
#   DEVELOPER_ID_APPLICATION="Developer ID Application: 你的名字 (TEAMID)" \
#   APPLE_ID="you@example.com" \
#   TEAM_ID="TEAMID" \
#   APP_PASSWORD="xxxx-xxxx-xxxx-xxxx" \
#   ./Scripts/release.sh
#
# 四個變數缺任何一個都會直接失敗；這支腳本不會用 ad-hoc 簽章代替發行簽章。
# 產物在 apps/macos/dist/：Cardiary.app、Cardiary-<版本>-<build>.zip 與 .dmg。
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$APP_DIR/dist"
APP_BUNDLE="$DIST_DIR/Cardiary.app"

MISSING=""
if [[ -z "${DEVELOPER_ID_APPLICATION:-}" ]]; then MISSING="$MISSING DEVELOPER_ID_APPLICATION"; fi
if [[ -z "${APPLE_ID:-}" ]]; then MISSING="$MISSING APPLE_ID"; fi
if [[ -z "${TEAM_ID:-}" ]]; then MISSING="$MISSING TEAM_ID"; fi
if [[ -z "${APP_PASSWORD:-}" ]]; then MISSING="$MISSING APP_PASSWORD"; fi
if [[ -n "$MISSING" ]]; then
  cat >&2 <<EOF
缺少發行所需的環境變數：$MISSING

發行需要這四個值：

  DEVELOPER_ID_APPLICATION  Developer ID Application 憑證名稱
                            例如 "Developer ID Application: Your Name (TEAMID)"
  APPLE_ID                  Apple 開發者帳號的 Apple ID（電子郵件）
  TEAM_ID                   開發者團隊 ID（10 個字元）
  APP_PASSWORD              Apple ID 的 App 專用密碼（在 appleid.apple.com 產生）

沒有憑證就不會產生可發行的版本；這支腳本不會用 ad-hoc 簽章代替。
用 security find-identity -v -p codesigning 可以確認憑證是否已安裝。
EOF
  exit 2
fi

if ! /usr/bin/security find-identity -v -p codesigning 2>/dev/null \
  | /usr/bin/grep -Fq -- "$DEVELOPER_ID_APPLICATION"; then
  echo "找不到可用的簽章身分：$DEVELOPER_ID_APPLICATION" >&2
  echo "目前安裝的 codesigning 身分：" >&2
  /usr/bin/security find-identity -v -p codesigning >&2 || true
  echo "請把 Developer ID Application 憑證與私鑰安裝到登入鑰匙圈。" >&2
  exit 2
fi

# 發行版一定要內嵌真正的主機服務，不能沿用開發用的單一腳本。
if [[ -n "${CARDIARY_SERVICE_SCRIPT:-}" ]]; then
  echo "偵測到 CARDIARY_SERVICE_SCRIPT=$CARDIARY_SERVICE_SCRIPT" >&2
  echo "發行版必須內嵌 packages/host 的完整服務，請先 unset CARDIARY_SERVICE_SCRIPT 再執行。" >&2
  exit 2
fi

NOTARY_AUTH=(--apple-id "$APPLE_ID" --team-id "$TEAM_ID" --password "$APP_PASSWORD")
NOTARY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cardi-notary-XXXX")"
trap 'rm -rf "$NOTARY_DIR"' EXIT

notarize() {
  local target="$1"
  local label="$2"
  local slug="$3"
  local result="$DIST_DIR/notary-${slug}.json"
  local errors="$DIST_DIR/notary-${slug}.err"
  local submit_status=0
  local submission_id status log

  echo "== 公證：$label =="
  set +e
  /usr/bin/xcrun notarytool submit "${NOTARY_AUTH[@]}" --wait --output-format json \
    "$target" >"$result" 2>"$errors"
  submit_status=$?
  set -e

  submission_id="$(/usr/bin/plutil -extract id raw -o - "$result" 2>/dev/null || true)"
  status="$(/usr/bin/plutil -extract status raw -o - "$result" 2>/dev/null || true)"

  if [[ "$submit_status" -ne 0 || "$status" != "Accepted" ]]; then
    echo "公證未通過（notarytool 退出碼 ${submit_status}，狀態 ${status:-未知}）" >&2
    if [[ -s "$errors" ]]; then
      /usr/bin/sed 's/^/  /' "$errors" >&2
    fi
    if [[ -n "$submission_id" ]]; then
      log="$DIST_DIR/notary-${submission_id}-log.json"
      if /usr/bin/xcrun notarytool log "${NOTARY_AUTH[@]}" "$submission_id" "$log" >/dev/null 2>&1; then
        echo "公證紀錄：$log" >&2
        echo "Apple 指出的問題（前 80 行）：" >&2
        /usr/bin/plutil -p "$log" 2>/dev/null | /usr/bin/head -80 >&2 || true
      else
        echo "無法取得公證紀錄；可手動執行：" >&2
        echo "  xcrun notarytool log $submission_id --apple-id \"\$APPLE_ID\" --team-id \"\$TEAM_ID\" --password \"\$APP_PASSWORD\"" >&2
      fi
    else
      echo "沒有取得 submission id；請檢查 Apple ID、Team ID 與 App 專用密碼是否正確。" >&2
    fi
    exit 1
  fi

  echo "  公證通過：${status}（submission ${submission_id}）"
}

echo "== 建置發行版 =="
CONFIGURATION=release \
CODESIGN_IDENTITY="$DEVELOPER_ID_APPLICATION" \
CODESIGN_TIMESTAMP=1 \
  "$APP_DIR/Scripts/build-app.sh"

INFO_PLIST="$APP_BUNDLE/Contents/Info.plist"
SHORT_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$INFO_PLIST")"
BUILD_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$INFO_PLIST")"
if [[ -z "$SHORT_VERSION" || -z "$BUILD_VERSION" ]]; then
  echo "讀不到版本號：$INFO_PLIST" >&2
  exit 1
fi
ARTIFACT_BASE="Cardiary-${SHORT_VERSION}-${BUILD_VERSION}"

NOTARY_ZIP="$NOTARY_DIR/Cardiary.zip"
echo "== 準備公證用的 zip =="
/usr/bin/ditto -c -k --keepParent "$APP_BUNDLE" "$NOTARY_ZIP"
notarize "$NOTARY_ZIP" "Cardiary.app" "app"

echo "== staple App =="
/usr/bin/xcrun stapler staple "$APP_BUNDLE"
/usr/bin/xcrun stapler validate "$APP_BUNDLE"

echo "== Gatekeeper 驗證 App =="
/usr/sbin/spctl --assess --type execute --verbose=4 "$APP_BUNDLE" 2>&1 | /usr/bin/sed 's/^/  /'

echo "== 完整發行驗證 =="
"$APP_DIR/Scripts/verify-release.sh" "$APP_BUNDLE"

ZIP_PATH="$DIST_DIR/${ARTIFACT_BASE}.zip"
DMG_PATH="$DIST_DIR/${ARTIFACT_BASE}.dmg"
DMG_STAGE="$NOTARY_DIR/dmg"
rm -f "$ZIP_PATH" "$DMG_PATH"

echo "== 建立散布用 zip =="
/usr/bin/ditto -c -k --keepParent "$APP_BUNDLE" "$ZIP_PATH"

echo "== 建立、簽章並公證 dmg =="
mkdir -p "$DMG_STAGE"
/usr/bin/ditto "$APP_BUNDLE" "$DMG_STAGE/Cardiary.app"
ln -s /Applications "$DMG_STAGE/Applications"
/usr/bin/hdiutil create -volname "Cardiary ${SHORT_VERSION}" -srcfolder "$DMG_STAGE" \
  -format UDZO -ov -quiet "$DMG_PATH"
/usr/bin/codesign --force --timestamp --sign "$DEVELOPER_ID_APPLICATION" "$DMG_PATH"
notarize "$DMG_PATH" "Cardiary dmg" "dmg"
/usr/bin/xcrun stapler staple "$DMG_PATH"
/usr/bin/xcrun stapler validate "$DMG_PATH"
/usr/sbin/spctl --assess --type open --context context:primary-signature --verbose=4 "$DMG_PATH" 2>&1 \
  | /usr/bin/sed 's/^/  /'

cat <<SUMMARY

完成：Cardiary ${SHORT_VERSION}（build ${BUILD_VERSION}）

  App  $APP_BUNDLE
  ZIP  $ZIP_PATH
  DMG  $DMG_PATH

  把 ZIP 與 DMG 上傳到 GitHub Release；使用者從瀏覽器下載後應該可以直接開啟。
SUMMARY
