#!/usr/bin/env bash
# 주식캐기(StockInvest) 안드로이드 APK 빌드 — T-084 M1 (docs/mobile-app-procedure.md §3·§7 M1).
# TheKaiwa scripts/build-apk.sh 를 바탕으로 온디바이스 STT(sherpa AAR·플러그인)를 뺀 판이다.
#
#   bash scripts/build-apk.sh              # release APK(전용 키 서명·debuggable=false) → 검사 → 경로·sha256 출력
#   bash scripts/build-apk.sh --publish    # + APP_RELEASE_DIR/stockinvest-<versionName>.apk 로 복사 + app_release INSERT SQL 출력(deployer 전용)
#
# ── 어디서 도는가 ────────────────────────────────────────────────────────────
# NFS 는 noexec 라 npm·Capacitor CLI·gradle 은 로컬 디스크에서만 돈다. 운영·개발 미러의 node_modules 를 건드리지 않도록
# **APK 전용 작업 디렉터리**(기본 ~/.node-local/stockinvest-apk)를 따로 쓴다 — 여기에는 Capacitor 패키지만 설치한다.
# 편집 대상은 언제나 저장소 쪽(android/·capacitor.config.ts·public/app-shell)이고 이 스크립트가 매번 작업 디렉터리로 동기화한다.
#
# ── 지키는 것 ────────────────────────────────────────────────────────────────
# - gradle·cap·npm 출력은 **로그 파일로만**(파이프로 자르면 SIGPIPE 로 빌드가 죽는다 — TheMeal·TheKaiwa 실측). 판정은 종료 코드.
# - JDK 21(@capacitor/android 7 요구) · ANDROID_HOME=~/.node-local/android-sdk · build-tools 35.0.0.
# - 서명은 StockInvest 전용 키스토어만(절차서 D-5). 값은 ~/.android/stockinvest-signing.env(권한 600, 저장소 밖)를
#   **gradle 하위 셸에서만** 읽어 환경변수로 넘긴다 — 이 스크립트는 그 값을 출력·로그에 남기지 않는다(set -x 금지).
#   디버그 키 폴백 없음(android/app/build.gradle 이 값이 없으면 빌드를 실패시킨다).
# - 배포본은 release 만: `aapt2` 로 debuggable 이 없음을, `apksigner` 로 서명을 확인하고 **서명 인증서 SHA-256 이 기대 지문과
#   다르면 실패**한다(키가 바뀐 APK 는 기존 설치본 위에 덮어써지지 않고, M2 App Links 지문과도 어긋난다).
# - 권한은 INTERNET(+ androidx 가 스스로 선언하는 앱 전용 DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION)만 허용한다.
# - APK 안에 .env·키스토어·서명 설정·비밀 문자열이 없는지 검사한다.
# - APK·키스토어는 저장소 밖(작업 디렉터리·APP_RELEASE_DIR·~/.android)에만 둔다.
# - app_release 행은 이 스크립트가 넣지 않는다 — --publish 가 INSERT SQL 을 **출력만** 하고, deployer 가 사용자 승인 후 실행한다.
set -euo pipefail
set +x

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${STOCKINVEST_APK_WORK:-$HOME/.node-local/stockinvest-apk}"
export JAVA_HOME="${JAVA_HOME_21:-/usr/lib/jvm/java-21-openjdk-amd64}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/.node-local/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$PATH"
BUILD_TOOLS="$ANDROID_HOME/build-tools/35.0.0"
SIGNING_ENV="${STOCKINVEST_SIGNING_ENV:-$HOME/.android/stockinvest-signing.env}"

# 서명 인증서 SHA-256 기대 지문(공개 정보 — APK 를 받은 누구나 볼 수 있다). 키를 바꾸면 여기와 M2 assetlinks 를 함께 바꾼다.
EXPECTED_CERT_SHA256="6F:A5:AD:6F:65:43:F2:2E:5F:42:21:AA:10:14:0E:77:A4:BD:41:78:05:04:A4:DE:10:49:45:50:61:51:0F:08"
EXPECTED_APP_ID="com.miraclepenguin.stockinvest"
EXPECTED_SERVER_URL="https://stock.xn--lh0b87pnudm10a4vd.com"
# versionName 형식 — 정확히 x.y.z(각 1~4자리). 정본은 src/lib/app-release/version.ts 의 VERSION_NAME_PATTERN 이고
# DB CHECK chk_app_release_name 과 이 줄은 그 문자열 복제다(version-paths.test.ts 가 세 곳이 같은지 감시한다).
VERSION_NAME_RE='^[0-9]{1,4}[.][0-9]{1,4}[.][0-9]{1,4}$'

PUBLISH=0
for arg in "$@"; do
  case "$arg" in
    --publish) PUBLISH=1 ;;
    *) echo "[build-apk] 알 수 없는 인자: $arg" >&2; exit 2 ;;
  esac
done

LOG_DIR="$WORK/logs"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$WORK/.cache" "$LOG_DIR" "$WORK/out"
log() { echo "[build-apk] $*"; }
fail() { log "$*"; exit 1; }

[ -x "$JAVA_HOME/bin/java" ] || fail "JDK 21 이 없다: $JAVA_HOME"
[ -x "$BUILD_TOOLS/aapt2" ] && [ -x "$BUILD_TOOLS/apksigner" ] || fail "build-tools 35.0.0 이 없다: $BUILD_TOOLS"

# ── 0. 서명 설정 파일 점검(내용은 읽어 출력하지 않는다) ─────────────────────────
[ -f "$SIGNING_ENV" ] || fail "서명 설정 파일이 없다: $SIGNING_ENV (디버그 키로 대신 서명하지 않는다)"
SIGNING_MODE="$(stat -c %a "$SIGNING_ENV")"
case "$SIGNING_MODE" in
  600|400) ;;
  *) fail "서명 설정 파일 권한이 $SIGNING_MODE 이다 — 600 으로 줄인 뒤 다시 실행(chmod 600 $SIGNING_ENV)" ;;
esac
for key in STOCKINVEST_KEYSTORE STOCKINVEST_KEYSTORE_PASSWORD STOCKINVEST_KEY_ALIAS; do
  grep -q "^\(export \)\?${key}=." "$SIGNING_ENV" || fail "서명 설정 파일에 ${key} 가 없다"
done

# ── 1. 저장소 → 작업 디렉터리 동기화 ──────────────────────────────────────────
# android/: 산출물(build·.gradle)·기계별 값(local.properties)·cap sync 생성물은 지우지도 덮지도 않는다(--exclude 는 보호도 겸한다).
# 키스토어는 저장소에 없어야 하지만, 실수로 생겨도 작업 디렉터리로 옮기지 않는다.
rsync -a --delete \
  --exclude 'build/' --exclude '.gradle/' --exclude 'local.properties' --exclude '.idea/' \
  --exclude 'capacitor-cordova-android-plugins/' \
  --exclude 'app/src/main/assets/' \
  --exclude 'app/src/main/res/xml/config.xml' \
  --exclude '*.keystore' --exclude '*.jks' --exclude '*signing.env' \
  "$PROJECT_ROOT/android/" "$WORK/android/"
mkdir -p "$WORK/public"
rsync -a --delete "$PROJECT_ROOT/public/app-shell/" "$WORK/public/app-shell/"
cp "$PROJECT_ROOT/capacitor.config.ts" "$WORK/capacitor.config.ts"

# package.json: 루트의 @capacitor/* 와 TypeScript(capacitor.config.ts 로드용)만 같은 버전으로 옮긴다(루트는 정확 버전 고정).
node - "$PROJECT_ROOT/package.json" "$WORK/package.json" <<'NODE'
const fs = require('fs')
const [src, dst] = process.argv.slice(2)
const root = JSON.parse(fs.readFileSync(src, 'utf8'))
const pick = (deps = {}, keep) => Object.fromEntries(Object.entries(deps).filter(([k]) => keep(k)))
const cap = (k) => k.startsWith('@capacitor/')
const pkg = {
  name: 'stockinvest-apk-workspace',
  private: true,
  description: 'scripts/build-apk.sh 가 만든다 — 직접 고치지 않는다',
  dependencies: pick(root.dependencies, cap),
  devDependencies: { ...pick(root.devDependencies, cap), typescript: (root.devDependencies || {}).typescript || '5.5.3' },
}
const next = JSON.stringify(pkg, null, 2) + '\n'
if (!fs.existsSync(dst) || fs.readFileSync(dst, 'utf8') !== next) fs.writeFileSync(dst, next)
NODE
for dep in '"@capacitor/android"' '"@capacitor/cli"' '"@capacitor/core"'; do
  grep -q "$dep" "$WORK/package.json" || fail "루트 package.json 에 $dep 의존이 없다"
done

cd "$WORK"
PKG_HASH="$(sha256sum package.json | cut -d' ' -f1)"
if [ ! -d node_modules/@capacitor/cli ] || [ ! -d node_modules/@capacitor/android ] || [ "$(cat .pkg-hash 2>/dev/null || true)" != "$PKG_HASH" ]; then
  log "npm install → $LOG_DIR/npm-$STAMP.log"
  set +e
  npm install --no-audit --no-fund > "$LOG_DIR/npm-$STAMP.log" 2>&1
  RC=$?
  set -e
  [ "$RC" -eq 0 ] || fail "npm install 실패 rc=$RC — 로그: $LOG_DIR/npm-$STAMP.log"
  echo "$PKG_HASH" > .pkg-hash
fi

# ── 2. cap sync ─────────────────────────────────────────────────────────────
if [ ! -f android/local.properties ]; then
  echo "sdk.dir=$ANDROID_HOME" > android/local.properties
fi
log "npx cap sync android → $LOG_DIR/cap-sync-$STAMP.log"
set +e
npx cap sync android > "$LOG_DIR/cap-sync-$STAMP.log" 2>&1
RC=$?
set -e
[ "$RC" -eq 0 ] || fail "cap sync 실패 rc=$RC — 로그: $LOG_DIR/cap-sync-$STAMP.log"
CAP_JSON="android/app/src/main/assets/capacitor.config.json"
node - "$CAP_JSON" "$EXPECTED_APP_ID" "$EXPECTED_SERVER_URL" <<'NODE' || fail "capacitor.config.json 이 기대와 다르다($CAP_JSON)"
const fs = require('fs')
const [file, appId, url] = process.argv.slice(2)
const c = JSON.parse(fs.readFileSync(file, 'utf8'))
const s = c.server || {}, a = c.android || {}
const bad = []
if (c.appId !== appId) bad.push('appId')
if (s.url !== url) bad.push('server.url')
if (s.androidScheme !== 'https') bad.push('server.androidScheme')
if (s.cleartext !== false) bad.push('server.cleartext')
if (s.allowNavigation !== undefined) bad.push('server.allowNavigation(있으면 안 됨)')
if (a.webContentsDebuggingEnabled !== false) bad.push('android.webContentsDebuggingEnabled')
if (a.allowMixedContent !== false) bad.push('android.allowMixedContent')
if (bad.length) { console.error('[build-apk] 어긋난 항목: ' + bad.join(', ')); process.exit(1) }
NODE

# ── 3. gradle ────────────────────────────────────────────────────────────────
# 서명 값은 이 하위 셸 안에서만 환경변수로 존재한다(부모 셸·cap·npm 에는 없다). 출력은 로그 파일로만 — gradle 은 env 를 찍지 않는다.
cd "$WORK/android"
log "gradlew :app:assembleRelease → $LOG_DIR/gradle-$STAMP.log (JAVA_HOME=$JAVA_HOME)"
set +e
(
  set +x
  set -a
  # shellcheck disable=SC1090
  . "$SIGNING_ENV"
  set +a
  exec ./gradlew :app:assembleRelease --no-daemon
) > "$LOG_DIR/gradle-$STAMP.log" 2>&1
RC=$?
set -e
[ "$RC" -eq 0 ] || fail "gradle 실패 rc=$RC — 로그: $LOG_DIR/gradle-$STAMP.log"

# ── 4. 검사 ──────────────────────────────────────────────────────────────────
APK="$WORK/android/app/build/outputs/apk/release/app-release.apk"
[ -f "$APK" ] || fail "빌드는 성공했는데 APK 가 없다: $APK"
BADGING="$("$BUILD_TOOLS/aapt2" dump badging "$APK")"
MANIFEST_TREE="$("$BUILD_TOOLS/aapt2" dump xmltree --file AndroidManifest.xml "$APK")"
[ -n "$MANIFEST_TREE" ] || fail "aapt2 xmltree 출력이 비었다 — debuggable 검사 불가"
# debuggable 이중 검사. 출력을 변수로 먼저 받고(파이프+pipefail+grep -q 의 SIGPIPE 위험 제거) 아래 함수로 판정한다.
#  ① badging 의 'application-debuggable' 줄  ② manifest xmltree 의 android:debuggable 값
#     aapt2 35 는 `android:debuggable(0x0101000f)=true`, 옛 형식은 `=(type 0x12)0xffffffff` — 둘 다 잡는다(false·0x0 은 통과).
# 함수 본문은 T-084 R1 양성 시험(디버그 매니페스트로 만든 APK)이 이 파일에서 그대로 떼어 실행한다 — 이름·형태를 바꾸면 시험도 고친다.
apk_debuggable_reason() {
  local badging="$1" tree="$2"
  if grep -q 'application-debuggable' <<<"$badging"; then
    echo "badging: application-debuggable"
    return 0
  fi
  if grep -q -E 'android:debuggable(\([^)]*\))?=(true|\(type 0x12\)0x0*[1-9a-fA-F])' <<<"$tree"; then
    echo "manifest: android:debuggable=true"
    return 0
  fi
  return 1
}
if DEBUGGABLE_REASON="$(apk_debuggable_reason "$BADGING" "$MANIFEST_TREE")"; then
  fail "debuggable APK($DEBUGGABLE_REASON) — 배포 금지"
fi
PKG_NAME="$(sed -n "s/^package: name='\([^']*\)'.*/\1/p" <<<"$BADGING")"
[ "$PKG_NAME" = "$EXPECTED_APP_ID" ] || fail "패키지 이름이 $PKG_NAME 이다(기대 $EXPECTED_APP_ID)"
VERSION_CODE="$(sed -n "s/^package: .*versionCode='\([0-9]*\)'.*/\1/p" <<<"$BADGING")"
VERSION_NAME="$(sed -n "s/^package: .*versionName='\([^']*\)'.*/\1/p" <<<"$BADGING")"
NATIVE="$(sed -n "s/^native-code: //p" <<<"$BADGING")"
# versionName 은 다운로드 파일 이름·SQL 에 들어간다 — app_release CHECK 와 같은 형식만 받는다.
[[ "$VERSION_CODE" =~ ^[1-9][0-9]{0,8}$ ]] || fail "versionCode 형식 이상: '$VERSION_CODE'"
[[ "$VERSION_NAME" =~ $VERSION_NAME_RE ]] || fail "versionName 형식 이상: '$VERSION_NAME' (정확히 x.y.z, 예: 1.0.0)"

# 권한: INTERNET + androidx core 가 스스로 선언하는 앱 전용(signature) 권한만.
PERMS="$(sed -n "s/^uses-permission: name='\([^']*\)'.*/\1/p" <<<"$BADGING" | sort -u)"
UNEXPECTED_PERMS="$(grep -v -x -e 'android.permission.INTERNET' -e "${EXPECTED_APP_ID}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION" <<<"$PERMS" || true)"
[ -z "$UNEXPECTED_PERMS" ] || fail "허용하지 않은 권한: $(tr '\n' ' ' <<<"$UNEXPECTED_PERMS")"
grep -q -x 'android.permission.INTERNET' <<<"$PERMS" || fail "INTERNET 권한이 없다"

# 서명: apksigner 검증 + 인증서 지문이 기대값과 같아야 한다.
set +e
CERTS="$("$BUILD_TOOLS/apksigner" verify --print-certs "$APK" 2>&1)"
RC=$?
set -e
[ "$RC" -eq 0 ] || fail "apksigner verify 실패 rc=$RC"
CERT_SHA="$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' <<<"$CERTS" | tr -d ':' | tr 'A-F' 'a-f')"
[ -n "$CERT_SHA" ] || fail "서명 확인 실패(인증서 지문 없음)"
SIGNER_COUNT="$(grep -c '^Signer #[0-9]* certificate SHA-256 digest:' <<<"$CERTS" || true)"
[ "$SIGNER_COUNT" = "1" ] || fail "서명자가 $SIGNER_COUNT 개다(1 이어야 한다)"
EXPECTED_CERT="$(tr -d ':' <<<"$EXPECTED_CERT_SHA256" | tr 'A-F' 'a-f')"
[ "$CERT_SHA" = "$EXPECTED_CERT" ] || fail "서명 인증서 지문 불일치: $CERT_SHA (기대 $EXPECTED_CERT) — 다른 키로 서명됐다. 배포 금지"
[[ "$CERT_SHA" =~ ^[0-9a-f]{64}$ ]] || fail "인증서 지문 형식 이상"

# 비밀 검사: APK 안에 .env·키스토어·서명 설정 파일이 없고, assets 는 연결 실패 화면 + Capacitor 생성 설정
# (+ AGP 가 넣는 ART baseline profile)뿐이어야 한다. 연결 실패 화면에 그림·CSS 파일이 생기면 여기 목록에 더한다.
ENTRIES="$(unzip -Z1 "$APK")"
if grep -i -E '(^|/)\.env|\.keystore$|\.jks$|signing\.env|\.p12$|\.pem$' <<<"$ENTRIES"; then
  fail "APK 안에 비밀 파일로 보이는 항목이 있다(위 목록)"
fi
UNEXPECTED_ASSETS="$(grep '^assets/' <<<"$ENTRIES" | grep -v -x -e 'assets/capacitor.config.json' -e 'assets/capacitor.plugins.json' -e 'assets/native-bridge.js' -e 'assets/public/cordova.js' -e 'assets/public/cordova_plugins.js' -e 'assets/dexopt/baseline.prof' -e 'assets/dexopt/baseline.profm' || true)"
# assets/public/ 의 나머지는 public/app-shell 에 실제로 있는 파일(연결 실패 화면)만 허용한다.
UNEXPECTED_ASSETS="$(while IFS= read -r entry; do
  [ -n "$entry" ] || continue
  rel="${entry#assets/public/}"
  if [ "$rel" != "$entry" ] && [ -f "$WORK/public/app-shell/$rel" ]; then continue; fi
  echo "$entry"
done <<<"$UNEXPECTED_ASSETS")"
grep -q -x 'assets/public/index.html' <<<"$ENTRIES" || fail "APK 에 연결 실패 화면(assets/public/index.html)이 없다"
[ -z "$UNEXPECTED_ASSETS" ] || fail "예상하지 않은 assets 항목: $(tr '\n' ' ' <<<"$UNEXPECTED_ASSETS")"
SCAN_DIR="$(mktemp -d "$WORK/.cache/scan-XXXXXX")"
trap 'rm -rf "$SCAN_DIR"' EXIT
unzip -q "$APK" -d "$SCAN_DIR"
if grep -r -a -l -E 'BEGIN (RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY|(DB_PASSWORD|KIS_APP_KEY|KIS_APP_SECRET|TELEGRAM_BOT_TOKEN|SESSION_SECRET|ANTHROPIC_API_KEY|STOCKINVEST_KEYSTORE_PASSWORD)[=:]' "$SCAN_DIR"; then
  fail "APK 안에 비밀 문자열 패턴이 있다(위 파일)"
fi
# 키스토어 비밀번호 자체가 APK 에 박히지 않았는지 — 값은 하위 셸 안에서만 쓰고 결과(0/1)만 받는다.
set +e
(
  set +x
  set -a
  # shellcheck disable=SC1090
  . "$SIGNING_ENV"
  set +a
  [ -n "${STOCKINVEST_KEYSTORE_PASSWORD:-}" ] || exit 2
  grep -r -a -q -F -- "$STOCKINVEST_KEYSTORE_PASSWORD" "$SCAN_DIR" && exit 1
  exit 0
) > /dev/null 2>&1
RC=$?
set -e
[ "$RC" -eq 0 ] || fail "APK 안에 서명 비밀번호와 같은 문자열이 있거나 검사하지 못했다(rc=$RC)"

APK_SHA="$(sha256sum "$APK" | cut -d' ' -f1)"
APK_BYTES="$(stat -c %s "$APK")"
OUT="$WORK/out/stockinvest-${VERSION_NAME}-${VERSION_CODE}.apk"
cp "$APK" "$OUT"

log "APK        : $OUT"
log "package    : $PKG_NAME  versionCode: $VERSION_CODE  versionName: $VERSION_NAME  abi: ${NATIVE:-(네이티브 코드 없음)}"
log "permissions: $(tr '\n' ' ' <<<"$PERMS")"
log "size       : $APK_BYTES bytes"
log "sha256     : $APK_SHA"
log "signer     : SHA-256 $CERT_SHA (기대 지문과 일치)"
log "debuggable : no"
log "secrets    : 없음(파일 이름·assets 목록·문자열 패턴·서명 비밀번호 검사 통과)"

# ── 5. 배포본(선택, deployer 전용) ────────────────────────────────────────────
if [ "$PUBLISH" -eq 1 ]; then
  REL_DIR="${APP_RELEASE_DIR:-/home/brownjeon/apps/stockinvest/shared/app-releases}"
  mkdir -p "$REL_DIR"
  REL_REAL="$(cd "$REL_DIR" && pwd -P)"
  ROOT_REAL="$(cd "$PROJECT_ROOT" && pwd -P)"
  case "$REL_REAL/" in
    "$ROOT_REAL"/*) fail "APP_RELEASE_DIR 이 저장소 안이다($REL_REAL) — APK 는 저장소 밖에 둔다" ;;
  esac
  APK_FILE="stockinvest-${VERSION_NAME}.apk"
  DEST="$REL_REAL/$APK_FILE"
  if [ -f "$DEST" ] && [ "$(sha256sum "$DEST" | cut -d' ' -f1)" != "$APK_SHA" ]; then
    fail "이미 다른 내용의 $DEST 가 있다 — 같은 versionName 을 덮어쓰지 않는다(versionCode·versionName 을 올릴 것)"
  fi
  cp "$APK" "$DEST.tmp" && mv "$DEST.tmp" "$DEST"
  GOT="$(sha256sum "$DEST" | cut -d' ' -f1)"
  [ "$GOT" = "$APK_SHA" ] || fail "복사본 sha256 불일치: $GOT"
  log "publish    : $DEST"
  log "app_release 행은 넣지 않았다 — 사용자 승인 후 deployer 가 아래 SQL 을 실행한다(notes 는 바꿔 써도 된다, min_supported 는 필수 업데이트 기준):"
  cat <<SQL
INSERT INTO app_release (version_code, version_name, apk_file, sha256, size_bytes, min_supported, notes, cert_sha256)
VALUES (${VERSION_CODE}, '${VERSION_NAME}', '${APK_FILE}', '${APK_SHA}', ${APK_BYTES}, 0, '주식캐기 ${VERSION_NAME}', '${CERT_SHA}');
SQL
fi
