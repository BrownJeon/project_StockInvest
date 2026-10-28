#!/usr/bin/env bash
# StockInvest cron 스케줄러 (PM2로 fork 모드 등록).
# CRON_SECRET은 .env에서 읽어 헤더에 부착.
#
# 호출 주기:
#  - strategy-eval     : 5분 — 전략 평가·시그널 발화 (장중에만 의미 있는 결과; 장외 시 'all_markets_closed')
#  - signal-followup   : 15분 — 발화한 시그널 후속 추적 (price_1h_after 채우기)
#  - signal-expiry     : 30분 — TTL 초과 시그널 만료 처리
#  - portfolio-snapshot: 60분 — 포트폴리오 스냅샷 + 변동폭 가드
#  - trade-report      : 5분 — 거래 리포트 anchor·interval 검증 후 Slack/Telegram 발송 (라우트 내부 자체 판단)
#  - sync-stock-meta   : 매일 17:00 KST — KIS KOSPI/KOSDAQ 마스터 → stock_meta 현행화
#  - news-fetch-overseas: 매일 06시 첫 틱 — M4 KB news.us_market RSS 갱신 (/api/cron/news-fetch?market=overseas, T-103)
#  - news-fetch-domestic: 매일 06시, 해외가 돈 **다음 틱** — M4 KB news.kr_market RSS 갱신 (?market=domestic, T-103)
#                        (T-036에서 bash 직접 curl → /api/cron/news-fetch 라우트로 이관.
#                         재시도·타임아웃·실패 알림은 전부 라우트 안에 있다. T-103에서 시장별 독립 잡으로 분리 —
#                         날짜파일·실패 알림 키가 시장마다 따로다. 해외가 06:5x 에 처음 돌면 국내는 그날 건너뛴다(06시 블록 주석))
#  - news-fetch-domestic-pm: 매일 15:30~15:59 KST 첫 틱 — 국내 뉴스 **두 번째** 수집 (?market=domestic, T-115). 장중 기사를 16:00 국내
#                        post-market 전에 KB 에 넣는다. 06시 국내와 독립된 하루 1회 잡(날짜파일 news-fetch-domestic-pm-last-date,
#                        성공·실패 무관 기록). 16:00 이후에는 부르지 않는다(15:30~15:59 내내 러너가 꺼져 있었으면 그날은 건너뛰고 로그 한 줄)
#  - post-market-domestic: 매일 16:00 KST — 국내장 마감 후 익일 시나리오 분석
#  - post-market-overseas: 매일 08:00 KST — 해외장 마감 후 다음 미국장 시나리오 분석 (T-062: 200 이 아니면 08시 안에서 최대 3회)
#  - research-cycle-domestic: 매일 16:00 KST — 국내 리서치 추적 종목 사이클 패턴 재계산 (T-032, 주문 없음)
#  - research-cycle-overseas: 매일 07:00 KST — 해외 리서치 추적 종목 사이클 패턴 재계산 (T-032, 주문 없음)
#  - export-llm-trainset: 매일 03:00 KST — signals+followup → LoRA 학습 JSONL 생성·전송
#  - edgar-sync        : 매일 07:00 KST — SEC EDGAR 공시·XBRL 재무 읽기 전용 수집 (T-059, 주문·시그널 없음)
#  - kis-fundamentals-snapshot: 매일 08:00 KST — KIS 해외 현재가상세(PER·PBR 등) 원값 스냅샷 (T-059, 읽기 전용 GET)
#  - stop-alert        : 1분 — 손절가 도달 텔레그램 알림 (T-068, 알림만, curl 상한 STOP_ALERT_CURL_MAX_TIME)
#  - broker-fills      : 매일 07:20 KST 이후 첫 틱 — 브로커 체결 원장 "앞으로 수집" (T-087, KIS 읽기 전용 GET·주문 없음, 스위치 기본 꺼짐,
#                        curl 상한 BROKER_FILLS_CURL_MAX_TIME, research-cycle-overseas·edgar-sync 가 같은 틱에 돌면 다음 틱으로 미룸)
#  - news-peek-<시장>-<HH>: 뉴스 최초 관측 캡처용 peek (T-116, ?market=…&mode=peek — M4 는 피드만 읽고 임베딩·적재 안 함). 국내 10·13시,
#                        해외 02·10·14·18·22시 KST 각 시각의 첫 틱에 하루 1회(슬롯마다 날짜파일, 성공·실패 무관 기록). 스위치
#                        ci_capture_enabled 가 꺼져 있으면 라우트가 M4 를 부르지 않고 바로 끝난다. 같은 틱에 두 슬롯이 겹치면(10시)
#                        뒤 슬롯은 다음 틱으로 미룬다. 새 잡은 T-104 가 나중에 잡 정의로 흡수한다(J8).

set -u
PROJECT_DIR="${PROJECT_DIR:-/home/brownjeon/NFS/homes/brownjeon/project/StockInvest}"
BASE_URL="${BASE_URL:-http://localhost:3003}"
CRON_SECRET=$(grep '^CRON_SECRET=' "$PROJECT_DIR/.env" | cut -d= -f2-)

if [ -z "$CRON_SECRET" ]; then
  echo "[cron-runner] CRON_SECRET not set in .env — exiting"
  exit 1
fi

call() {
  local path="$1"
  local label="$2"
  local body="${3:-{}}"
  local code
  # (T-062 Codex C2 ②) CALL_MAX_TIME 이 비어 있지 않을 때만 --max-time 을 붙인다 — 지금은 해외 post-market 호출만 쓴다.
  # 비어 있으면 아래 curl 명령은 예전과 같다(다른 모든 잡 불변).
  code=$(curl -s ${CALL_MAX_TIME:+--max-time "$CALL_MAX_TIME"} -o /tmp/cron-runner-$$.out -w "%{http_code}" -X POST \
    -H "x-cron-secret: $CRON_SECRET" -H 'Content-Type: application/json' \
    "$BASE_URL$path" -d "$body" 2>/dev/null) || code="000"
  CALL_LAST_CODE="$code"   # (T-062) 응답 코드를 보는 잡(post-market-overseas)만 읽는다. 다른 잡의 동작은 그대로다.
  local ts; ts=$(date '+%F %T')
  if [ "$code" = "200" ]; then
    echo "[$ts] $label OK"
  else
    echo "[$ts] $label HTTP=$code body=$(head -c 200 /tmp/cron-runner-$$.out 2>/dev/null)"
  fi
  rm -f /tmp/cron-runner-$$.out
}

# >>> post-market-overseas-retry (T-062 S-2b) — scripts/test-cron-runner-pmo-retry.sh 가 이 블록만 잘라 시험한다
# 해외 post-market 은 **HTTP 200 일 때만** 날짜파일(성공 표시)을 쓴다. 200 이 아니면(AI 응답 해석 실패·카드 저장 실패·데이터 일시 모름 503·
# 서버 다운 등) 같은 날 최대 PMO_MAX_ATTEMPTS 회까지, 직전 시도 이후 PMO_MIN_INTERVAL_SEC 이상 지나야 다시 부른다.
# T-036(실패하면 매 분 재시도 → 하루 수천 건 폭주)의 재발을 막는 것이 이 상한·간격의 목적이다.
# 🔴 (T-062 Reviewer M-1) 시도는 호출 **전에** 먼저 센다(pmo_reserve). 호출 도중 러너가 죽어도(배포·재기동, HOME-SERVER 순찰이
#    하트비트 300초 무응답이면 `pm2 restart stockinvest-cron`) 그 시도는 이미 기록돼 있어, 새 러너가 곧바로 다시 부르지 않는다 —
#    하루 3회·간격 10분이 호출 도중 중단에도 절대 상한이다. 호출이 끝나면 마지막 시각을 종료 시각으로 늦추고(pmo_finish) 200 이면
#    날짜파일을 쓴다. 시도 기록을 쓸 수 없으면 부르지 않고 날짜파일로 그날을 끝낸다(셀 수 없으면 부르지 않는다).
#    스위치가 꺼져 있으면 라우트가 200 이므로 하루 1회 그대로다.
PMO_MAX_ATTEMPTS=3
PMO_MIN_INTERVAL_SEC=600
# (T-062 Codex C2 ②) 해외 post-market 호출 한 번의 curl 전체 시간 상한(초). 하트비트는 tick 시작에만 쓰이므로 하트비트 나이의 최악은
# "tick 길이 + sleep 60초"이고, HOME-SERVER 순찰은 300초를 넘으면 stockinvest-cron 을 재시작한다. 08시 첫 tick 에는 이 호출 뒤에
# kis-fundamentals-snapshot(약 35~60초)과 매 분 잡(entry-watcher·holding-checker, 5분마다 strategy-eval·trade-report, 시간마다
# portfolio-snapshot — 합쳐 약 30초로 봄)이 같이 돈다 → 120 + 60 + 30 + 60(sleep) = 270초 < 300초. 240 이면 240+60+30+60 = 390초로
# 순찰이 러너를 재시작한다. 상한에 걸리면 curl 이 000 → 실패로 세고(날짜파일 없음) 재시도 규칙을 따르며, 서버 쪽 실행은 계속될 수
# 있으나 서버의 single-flight 가 같은 세션 분석의 겹침을 막는다(재호출은 503 in_progress).
PMO_CURL_MAX_TIME=120
# (T-068 WP-C) 손절가 도달 알림(stop-alert) 호출 한 번의 curl 전체 시간 상한(초). 매 분 돈다. 라우트는 장이 닫혔으면 즉시 끝나고
# (KIS 0), 열렸을 때도 시세 10초·발송 15초 예산 안에서 스스로 멈춘다 — 이 상한은 그 예산이 깨져도 tick 이 막히지 않게 하는 마지막
# 방어선이다. 하트비트 최악(위 PMO 계산에 더함): 120 + 60 + 30 + 20 + 60(sleep) = 290초 < 300초(순찰 재시작 기준).
# 상한에 걸리면 curl 이 000 으로 끝나고 다음 분에 다시 부른다(서버 쪽 실행은 single-flight 라 겹치지 않는다).
STOP_ALERT_CURL_MAX_TIME=20
# (T-087 D1a) 브로커 체결 원장 수집(broker-fills) 호출 한 번의 curl 전체 시간 상한(초). 라우트 자체 예산 75초보다 길고, 하트비트 최악은
# 90 + 매 분 잡 약 30 + sleep 60 = 180초 < 300초(순찰 재시작 기준). 07시 틱(research·edgar)과는 아래 yield 규칙으로 같은 틱에 겹치지 않는다.
BROKER_FILLS_CURL_MAX_TIME=90
CALL_MAX_TIME=""
# 시도 기록 파일 한 줄: "<YYYY-MM-DD> <그날 시도 횟수> <마지막 시도 시각 epoch 초(시작에 기록, 끝나면 종료 시각으로 갱신)>"
# pmo_due TODAY NOW DONE_FILE ATTEMPT_FILE → 0(지금 부를 차례) / 1(부르지 않음)
pmo_due() {
  local today="$1" now="$2" done_file="$3" att_file="$4" d="" n="" last=""
  [ "$(cat "$done_file" 2>/dev/null || echo "")" = "$today" ] && return 1
  if [ -f "$att_file" ]; then read -r d n last < "$att_file" || true; fi
  [ "$d" != "$today" ] && return 0
  case "$n" in ''|*[!0-9]*) return 1 ;; esac      # 손상된 기록 → 셀 수 없으니 더 부르지 않는다
  case "$last" in ''|*[!0-9]*) return 1 ;; esac
  [ "$n" -ge "$PMO_MAX_ATTEMPTS" ] && return 1
  [ $((now - last)) -ge "$PMO_MIN_INTERVAL_SEC" ] || return 1
  return 0
}
_pmo_write() {   # ATTEMPT_FILE TODAY N EPOCH — tmp→mv 원자 쓰기, 실패면 1
  { printf '%s %s %s\n' "$2" "$3" "$4" > "${1}.tmp" && mv -f "${1}.tmp" "$1"; } 2>/dev/null
}
# pmo_reserve TODAY NOW DONE_FILE ATTEMPT_FILE — 호출 **전에** 시도 1회를 기록. 0 = 불러도 됨 / 1 = 부르지 말 것
# (Reviewer L-6) 직전 pmo_due 판정을 여기서 다시 확인한다 — 러너 두 개가 겹쳐 같은 기록을 본 경우 늦은 쪽이 거부된다.
pmo_reserve() {
  local today="$1" now="$2" done_file="$3" att_file="$4" d="" n="" last=""
  if [ -f "$att_file" ]; then read -r d n last < "$att_file" || true; fi
  if [ "$d" != "$today" ]; then
    n=0
  else
    case "$n" in ''|*[!0-9]*) return 1 ;; esac
    case "$last" in ''|*[!0-9]*) return 1 ;; esac
    [ "$n" -ge "$PMO_MAX_ATTEMPTS" ] && return 1
    [ $((now - last)) -ge "$PMO_MIN_INTERVAL_SEC" ] || return 1
  fi
  n=$((n + 1))
  if ! _pmo_write "$att_file" "$today" "$n" "$now"; then
    echo "$today" > "$done_file"   # 시도 횟수를 남길 수 없으면 부르지 않고 오늘은 끝낸다(폭주 방지가 재시도보다 우선)
    echo "[$(date '+%F %T')] post-market-overseas 시도 기록($att_file)을 쓸 수 없어 오늘은 호출하지 않음"
    return 1
  fi
  return 0
}
# pmo_finish TODAY NOW CODE DONE_FILE ATTEMPT_FILE — 호출이 끝난 뒤. 횟수는 바꾸지 않는다(이미 reserve 에서 셌다).
pmo_finish() {
  local today="$1" now="$2" code="$3" done_file="$4" att_file="$5" d="" n="" last=""
  if [ -f "$att_file" ]; then read -r d n last < "$att_file" || true; fi
  if [ "$d" = "$today" ]; then
    case "$n" in ''|*[!0-9]*) ;; *) _pmo_write "$att_file" "$today" "$n" "$now" || true ;; esac   # 간격은 종료 시각부터(실패해도 시작 시각 기준으로 남는다)
  fi
  if [ "$code" = "200" ]; then
    echo "$today" > "$done_file"
  elif [ -n "$n" ] && [ "$n" -ge "$PMO_MAX_ATTEMPTS" ] 2>/dev/null; then
    echo "[$(date '+%F %T')] post-market-overseas 오늘 ${n}회 모두 실패(HTTP=$code) — 내일 08시에 다시 시도"
  fi
}
# <<< post-market-overseas-retry

# 시작 시 한 번 실행 (선택)
echo "[cron-runner] started, base=$BASE_URL"

# 하루 1회 잡의 "날짜파일" — 오늘 이미 시도했는지 기록한다.
#
# 🔴 (T-036) 날짜파일은 **성공·실패와 무관하게 기록한다.** 성공해야만 기록하던 두 잡
#    (news-fetch, export-llm-trainset)은 실패가 지속되면 해당 시각 한 시간 내내 매 분
#    재시도해서 낭비 호출이 폭주했다 — 실측 누적 약 18,600건
#    (news-fetch 12,060건 / export-llm-trainset 6,574건).
#    "일시 장애 자동복구" 의도는 이해되지만 **항구적 장애와 구분이 되지 않는다.**
#    일시 장애 흡수는 이제 라우트 내부의 제한적 재시도가 담당하고(news-fetch: 시장별 2회),
#    바깥에서는 하루 1회 시도로 끝낸다. 실패를 조용히 삼키지 않는 것은 재시도가 아니라
#    알림의 역할이다.
META_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/sync-stock-meta-last-date"
TRAINSET_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/export-llm-trainset-last-date"
NEWS_FETCH_OVERSEAS_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/news-fetch-overseas-last-date"   # (T-103) 옛 news-fetch-last-date 는 읽지 않는다
NEWS_FETCH_DOMESTIC_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/news-fetch-domestic-last-date"   # (T-103)
NEWS_FETCH_DOMESTIC_PM_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/news-fetch-domestic-pm-last-date"   # (T-115) 06시 국내 날짜파일과 별개
POST_MARKET_DOMESTIC_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/post-market-domestic-last-date"
POST_MARKET_OVERSEAS_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/post-market-overseas-last-date"
POST_MARKET_OVERSEAS_ATTEMPT_FILE="${HOME}/.node-local/stockinvest/post-market-overseas-attempts"   # (T-062 S-2b) 그날 시도 횟수
RS_UPDATE_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/rs-update-last-date"
RESEARCH_DOMESTIC_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/research-cycle-domestic-last-date"
RESEARCH_OVERSEAS_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/research-cycle-overseas-last-date"
EDGAR_SYNC_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/edgar-sync-last-date"
KIS_FUNDAMENTALS_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/kis-fundamentals-snapshot-last-date"
BROKER_FILLS_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/broker-fills-last-date"   # (T-087 D1a)
mkdir -p "$(dirname "$META_LAST_RUN_FILE")"

# (T-036) M4 뉴스 fetch용 AI_API_BASE/M4_ADMIN_TOKEN 플럼빙은 여기서 제거했다 —
# 이제 /api/cron/news-fetch 라우트가 process.env로 직접 읽는다. `.env`의 값 자체는
# 다른 코드(src/lib/rag/m4-kb.ts 등)도 쓰므로 그대로 둔다.

# 분 단위 카운터 (동기 호출이라 60초 슬립으로 간략)
i=0
while true; do
  # ── 하트비트 (T-037) ──────────────────────────────────────────────────────
  #
  # 매 tick 마다 현재 epoch 초를 기록한다. 이 파일이 갱신되지 않으면
  # `src/instrumentation.ts` 의 워치독이 **자동매매 전체 정지**로 판단해 critical 알림을 보낸다.
  #
  # 🔴 이 기록은 **개별 잡의 성공·실패와 무관하다.** 순수하게 "이 루프가 살아서 돌고 있다"는
  #    신호일 뿐이다. 잡 실패 알림(라우트 내부 소관)과 절대 혼동하지 말 것 — 여기에 잡 결과를
  #    조건으로 걸면, 잡 하나가 실패했을 때 "cron 전체가 죽었다"는 최상위 경보가 오발사된다.
  #
  # 왜 루프 맨 앞인가: `call` 이 응답을 기다리는 동안(현재 curl 에 타임아웃이 없다) 늦어지더라도
  # "직전 tick 까지는 살아 있었다"가 먼저 남는다. 뒤에 두면 느린 잡 하나가 사망으로 오인된다.
  #
  # 경로는 로컬 디스크(`~/.node-local/`)다 — NFS 가 아니다. 이번 사고(T-037 §B-3)가 NFS 마운트
  # 경합이었으므로, 살아있음 신호를 NFS 에 두면 감시자와 감시대상이 같이 죽는다.
  # 디렉토리는 위 `mkdir -p "$(dirname "$META_LAST_RUN_FILE")"` 가 이미 보장한다(같은 디렉토리).
  #
  # 쓰기는 tmp→mv 로 원자적이다. 부분 기록된 파일을 워치독이 읽어 오탐하는 창을 없앤다.
  # 실패해도 `|| true` 로 삼킨다 — 하트비트 기록 실패가 실매매 루프를 멈추면 본말전도다.
  : "${CRON_HEARTBEAT_FILE:=${HOME}/.node-local/stockinvest/cron-heartbeat}"
  { printf '%s\n' "$(date +%s)" > "${CRON_HEARTBEAT_FILE}.tmp" \
      && mv -f "${CRON_HEARTBEAT_FILE}.tmp" "${CRON_HEARTBEAT_FILE}"; } 2>/dev/null || true

  # 매 1분: entry-watcher — 진입 구간 도달 시 자동 주문 실행
  call /api/cron/entry-watcher "entry-watcher"
  # 매 1분: holding-checker — 보유기간 초과 텔레그램 알림
  call /api/cron/holding-checker "holding-checker"
  # 매 1분: stop-alert — 손절가 도달 텔레그램 알림 (T-068, 알림만 — 주문·매도·시그널 없음). 이 호출에만 시간 상한.
  CALL_MAX_TIME="$STOP_ALERT_CURL_MAX_TIME"
  call /api/cron/stop-alert "stop-alert"
  CALL_MAX_TIME=""
  # 매 5분: strategy-eval
  if [ $((i % 5)) -eq 0 ]; then
    call /api/cron/strategy-eval "strategy-eval"
  fi
  # 매 15분: signal-followup
  if [ $((i % 15)) -eq 0 ]; then
    call /api/cron/signal-followup "signal-followup"
  fi
  # 매 30분: signal-expiry
  if [ $((i % 30)) -eq 0 ]; then
    call /api/cron/signal-expiry "signal-expiry"
  fi
  # 매 60분: portfolio-snapshot
  if [ $((i % 60)) -eq 0 ]; then
    call /api/cron/portfolio-snapshot "portfolio-snapshot"
  fi
  # 매 5분: trade-report — 라우트 내부에서 anchor·interval 검증 후 발송 여부 자체 판단.
  # anchor 시각(예: 05:00,08:00) 기준 ±5분 정확도 (cron 호출 주기). 미해당 분은 즉시 skipped.
  if [ $((i % 5)) -eq 0 ]; then
    call /api/cron/trade-report "trade-report"
  fi
  # 매일 17:00 KST: sync-stock-meta + RS Rating 업데이트 (하루 1회씩)
  HH=$(date '+%H')
  TODAY=$(date '+%Y-%m-%d')
  LAST_META=$(cat "$META_LAST_RUN_FILE" 2>/dev/null || echo "")
  if [ "$HH" = "17" ] && [ "$LAST_META" != "$TODAY" ]; then
    call /api/cron/sync-stock-meta "sync-stock-meta"
    echo "$TODAY" > "$META_LAST_RUN_FILE"
  fi
  # 매일 17:30 KST: RS Rating 업데이트 (국내 장 마감 후)
  HH_MM=$(date '+%H:%M')
  LAST_RS=$(cat "$RS_UPDATE_LAST_RUN_FILE" 2>/dev/null || echo "")
  if [ "$HH_MM" = "17:30" ] && [ "$LAST_RS" != "$TODAY" ]; then
    call "/api/cron/rs-update?market=domestic" "rs-update-domestic"
    echo "$TODAY" > "$RS_UPDATE_LAST_RUN_FILE"
  fi
  # 매일 08:00 KST: 해외장 마감 후 익일 시나리오 분석 (미국 16:00 ET 마감 → KST 다음날 06:00, 데이터 반영 대기 후 08:00)
  # (T-062 S-2b) 날짜파일은 200 일 때만 쓴다 — 실패하면 08시 안에서 10분 이상 간격으로 하루 최대 3회(위 pmo_* 블록).
  # 시도는 호출 전에 센다(Reviewer M-1) — 호출 도중 러너가 죽어도 상한이 유지된다.
  # 다른 하루 1회 잡은 T-036 규칙(성공·실패 무관 기록)을 그대로 따른다.
  if [ "$HH" = "08" ] && pmo_due "$TODAY" "$(date +%s)" "$POST_MARKET_OVERSEAS_LAST_RUN_FILE" "$POST_MARKET_OVERSEAS_ATTEMPT_FILE"; then
    if pmo_reserve "$TODAY" "$(date +%s)" "$POST_MARKET_OVERSEAS_LAST_RUN_FILE" "$POST_MARKET_OVERSEAS_ATTEMPT_FILE"; then
      CALL_LAST_CODE="000"
      CALL_MAX_TIME="$PMO_CURL_MAX_TIME"   # 이 호출에만 시간 상한(위 PMO_CURL_MAX_TIME 근거)
      call "/api/cron/post-market-analysis?market=overseas" "post-market-overseas"
      CALL_MAX_TIME=""
      pmo_finish "$TODAY" "$(date +%s)" "$CALL_LAST_CODE" "$POST_MARKET_OVERSEAS_LAST_RUN_FILE" "$POST_MARKET_OVERSEAS_ATTEMPT_FILE"
    fi
  fi
  # 매일 08:00 KST: KIS 해외 현재가상세 스냅샷 (T-059) — 미국장 마감 뒤·국내장(09:00) 개장 전이라 장중 KIS 호출과 겹치지 않는다.
  # 07시(EDGAR·research)와 다른 tick 으로 둬 한 tick 의 동기 대기 시간을 나눈다. 종목 수(약 55) × 직렬 GET, bulk 우선순위.
  # post-market-overseas(같은 08시)와 **독립된 블록**이다.
  LAST_KIS_FUND=$(cat "$KIS_FUNDAMENTALS_LAST_RUN_FILE" 2>/dev/null || echo "")
  if [ "$HH" = "08" ] && [ "$LAST_KIS_FUND" != "$TODAY" ]; then
    call "/api/cron/kis-fundamentals-snapshot" "kis-fundamentals-snapshot"
    echo "$TODAY" > "$KIS_FUNDAMENTALS_LAST_RUN_FILE"
  fi
  # 매일 16:00 KST: 국내장 마감 후 익일 시나리오 분석 (15:30 마감 → 30분 데이터 반영 대기)
  LAST_POST_DOM=$(cat "$POST_MARKET_DOMESTIC_LAST_RUN_FILE" 2>/dev/null || echo "")
  if [ "$HH" = "16" ] && [ "$LAST_POST_DOM" != "$TODAY" ]; then
    call "/api/cron/post-market-analysis?market=domestic" "post-market-domestic"
    echo "$TODAY" > "$POST_MARKET_DOMESTIC_LAST_RUN_FILE"
  fi
  # 매일 07:00 KST: 해외 리서치 사이클 재계산 (T-032) — 미국 16:00 ET 마감 → KST 06:00, 반영 대기 후 07:00.
  # post-market-overseas(08:00)와 **독립된 블록**이다 — 실패·성공이 서로 영향을 주지 않아야 한다.
  LAST_RESEARCH_OVS=$(cat "$RESEARCH_OVERSEAS_LAST_RUN_FILE" 2>/dev/null || echo "")
  if [ "$HH" = "07" ] && [ "$LAST_RESEARCH_OVS" != "$TODAY" ]; then
    call "/api/cron/research-cycle-overseas" "research-cycle-overseas"
    echo "$TODAY" > "$RESEARCH_OVERSEAS_LAST_RUN_FILE"
  fi
  # 매일 07:00 KST: SEC EDGAR 수집 (T-059) — 미국장 마감(05:00 EDT / 06:00 EST KST) 뒤·국내장 개장 전.
  # research-cycle-overseas 와 같은 시(07)라 같은 tick 에 이어서 돈다. 이 call 은 동기라 tick 이 5분을 넘기면 하트비트
  # 워치독이 오경보하므로 라우트가 시간 예산(기본 100초)을 넘기면 스스로 끊고 다음 날 이어 간다. 날짜파일은 성공·실패 무관 기록(T-036).
  # 테이블 마이그레이션 전에는 라우트가 skipped:'tables_missing' 로 즉시 끝난다(SEC 호출 0).
  LAST_EDGAR=$(cat "$EDGAR_SYNC_LAST_RUN_FILE" 2>/dev/null || echo "")
  if [ "$HH" = "07" ] && [ "$LAST_EDGAR" != "$TODAY" ]; then
    call "/api/cron/edgar-sync" "edgar-sync"
    echo "$TODAY" > "$EDGAR_SYNC_LAST_RUN_FILE"
  fi
  # >>> broker-fills-daily (T-087 D1a) — src/app/api/cron/broker-fills/__tests__/cron-runner-block.test.ts 가 이 블록(과 위 07시 두 블록)을 잘라 시험한다
  # 매일 07:20 KST 이후 첫 틱: 브로커 체결 원장 "앞으로 수집"(KIS 읽기 전용 GET, 주문 없음). 스위치(broker_fills_cron_enabled, 기본 꺼짐)·
  # single-flight·run 당 호출 12·예산 75초는 라우트가 지킨다. `HH_MM="07:20"` 정확 일치는 틱이 분을 건너뛰면 그날을 놓쳐 쓰지 않는다(분 ≥ 20).
  # 날짜파일은 호출했으면 성공·실패 무관 기록(T-036) — 하루 1회.
  # (설계 §3.7 L-9·N-2) 러너가 07:20 이후 재기동되면 위 research-cycle-overseas·edgar-sync 가 **이 틱에** 돈다. 두 블록이 틱 시작에 읽어 둔
  # LAST_RESEARCH_OVS·LAST_EDGAR(호출 **전** 값)가 오늘이 아니면 "이 틱에 방금 돌았다"는 뜻이라 수집을 다음 틱으로 미룬다(yield_tick, 날짜파일 안 씀).
  # 날짜파일을 다시 읽으면 두 블록이 이미 오늘로 써 두어 미루기가 발동하지 않는다 — 그래서 변수로 판단한다.
  BF_MM=$(date '+%M')
  case "$BF_MM" in [0-5][0-9]) ;; *) BF_MM=00 ;; esac   # 읽을 수 없으면 이 틱은 돌지 않는다
  LAST_BROKER_FILLS=$(cat "$BROKER_FILLS_LAST_RUN_FILE" 2>/dev/null || echo "")
  if [ "$HH" = "07" ] && [ "$BF_MM" -ge 20 ] && [ "$LAST_BROKER_FILLS" != "$TODAY" ]; then
    if [ "$LAST_RESEARCH_OVS" != "$TODAY" ] || [ "$LAST_EDGAR" != "$TODAY" ]; then
      echo "[$(date '+%F %T')] broker-fills yield_tick — research-cycle-overseas/edgar-sync 가 이 틱에 돌아 다음 틱으로 미룸"
    else
      CALL_MAX_TIME="$BROKER_FILLS_CURL_MAX_TIME"   # 이 호출에만 시간 상한
      call "/api/cron/broker-fills" "broker-fills"
      CALL_MAX_TIME=""
      echo "$TODAY" > "$BROKER_FILLS_LAST_RUN_FILE"
    fi
  fi
  # <<< broker-fills-daily
  # 매일 16:00 KST: 국내 리서치 사이클 재계산 (T-032) — 15:30 마감 후 30분 데이터 반영 대기.
  # post-market-domestic(16:00)과 **독립된 블록**이다 — 같은 시각이지만 합치지 않는다.
  LAST_RESEARCH_DOM=$(cat "$RESEARCH_DOMESTIC_LAST_RUN_FILE" 2>/dev/null || echo "")
  if [ "$HH" = "16" ] && [ "$LAST_RESEARCH_DOM" != "$TODAY" ]; then
    call "/api/cron/research-cycle-domestic" "research-cycle-domestic"
    echo "$TODAY" > "$RESEARCH_DOMESTIC_LAST_RUN_FILE"
  fi
  # >>> news-fetch-split (T-103) — scripts/test-cron-runner-news-split.sh 가 러너 전체를 가짜 시각으로 돌려 시험한다
  # 매일 06시 KST: M4 KB 뉴스 fetch — 시장별 **독립된 두 잡**(각자 하루 1회). 해외(news.us_market, 08:00 해외 post-market 이 소비) 먼저,
  # 국내(news.kr_market, 16:00 국내 post-market 이 소비) 다음. 실행 시각(06시)·건수(20)·재시도(3회)·60초 상한은 분리 전과 같다.
  #   (T-115) 건수는 그 뒤 시장별 100 으로 바뀌었다(route.ts NEWS_FETCH_LIMITS). 이 블록의 호출·시각·순서는 그대로다.
  # (T-036) bash 직접 curl → 라우트 호출로 이관. 재시도·타임아웃·실패 알림은 라우트 안에 있다. 날짜파일은 시장마다 따로,
  #   호출했으면 성공·실패 무관 기록(날짜파일 선언부 주석 참고) — 하루 1회.
  # 🔴 같은 틱에 두 시장을 이어 부르지 않는다: 라우트는 시장당 최악 약 186초(3회×60초 + 대기 2×3초)라 순차 두 번이면 약 372초로
  #   하트비트 워치독 한도(300초)를 넘는다(분리 전에는 한 호출 안 병렬이라 약 186초). 그래서 해외가 **이 틱에** 돌았으면 국내는
  #   다음 틱으로 미룬다(yield_tick, 날짜파일 안 씀). 판단은 틱 시작에 읽어 둔 LAST_NEWS_OVS(호출 **전** 값)로 한다 — 날짜파일을 다시
  #   읽으면 해외 블록이 이미 오늘로 써 두어 미루기가 발동하지 않는다(broker-fills yield_tick 과 같은 이유). call() 병렬화는 하지 않는다
  #   (임시 파일명 $$ 충돌).
  # ⚠ 알려진 가장자리(허용): 해외가 06시 끝자락(06:59 틱, 또는 M4 가 느려 해외 호출이 07시를 넘겨 끝나는 06:5x 틱)에 처음 돌면
  #   다음 틱이 07시라 국내는 **그날 건너뛴다**(로그: news-fetch-domestic yield_tick 뒤 호출 없음). 러너가 06시 거의 내내 꺼져 있던 날에만
  #   생기며, 국내 뉴스는 16:00 에 소비되고 다음 날 06시에 정상 복구된다. 07시 틱(research·edgar·broker-fills)에는 합류시키지 않는다
  #   (그 틱의 동기 대기 시간 악화).
  LAST_NEWS_OVS=$(cat "$NEWS_FETCH_OVERSEAS_LAST_RUN_FILE" 2>/dev/null || echo "")
  LAST_NEWS_DOM=$(cat "$NEWS_FETCH_DOMESTIC_LAST_RUN_FILE" 2>/dev/null || echo "")
  if [ "$HH" = "06" ] && [ "$LAST_NEWS_OVS" != "$TODAY" ]; then
    call "/api/cron/news-fetch?market=overseas" "news-fetch-overseas"
    echo "$TODAY" > "$NEWS_FETCH_OVERSEAS_LAST_RUN_FILE"   # 성공·실패 무관 기록
  fi
  if [ "$HH" = "06" ] && [ "$LAST_NEWS_DOM" != "$TODAY" ]; then
    if [ "$LAST_NEWS_OVS" != "$TODAY" ]; then
      echo "[$(date '+%F %T')] news-fetch-domestic yield_tick — news-fetch-overseas 가 이 틱에 돌아 다음 틱으로 미룸"
    else
      call "/api/cron/news-fetch?market=domestic" "news-fetch-domestic"
      echo "$TODAY" > "$NEWS_FETCH_DOMESTIC_LAST_RUN_FILE"   # 성공·실패 무관 기록
    fi
  fi
  # <<< news-fetch-split
  # >>> news-fetch-domestic-pm (T-115) — scripts/test-cron-runner-news-split.sh 가 러너 전체를 가짜 시각으로 돌려 시험한다(시나리오 F)
  # 매일 15:30~15:59 KST 첫 틱: 국내 뉴스(news.kr_market) **두 번째** 수집. 06시 국내 수집은 장중 기사를 원천적으로 못 담아(연합 경제
  #   피드는 약 120건·약 6.6시간 창) 16:00 국내 post-market 분석의 KB 에 그날 장중 기사가 없었다 → 장 마감(15:30) 직후 한 번 더 받는다.
  # 06시 블록(news-fetch-split)과 **독립된 잡**이다 — 날짜파일이 따로라 서로의 실행 여부에 영향을 주지 않는다. 라우트·실패 알림 키
  #   (news-fetch:domestic:failed)·재시도(3회)·시도당 60초는 06시 국내와 같다.
  # 날짜파일은 호출했으면 성공·실패 무관 기록(T-036) — 하루 1회. `HH_MM="15:30"` 정확 일치는 틱이 분을 건너뛰면 그날을 놓쳐 쓰지 않는다
  #   (분 ≥ 30, broker-fills 와 같은 방식).
  # 🔴 16:00 이후에는 부르지 않는다 — 16:00 틱의 post-market-domestic·research-cycle-domestic 과 같은 틱에 겹치지 않게. 러너가 15:30~15:59
  #   내내 꺼져 있었으면 그날은 건너뛰고(국내 뉴스는 06시 것만) 16~23시 첫 틱에 로그 한 줄만 남긴다 — 호출하지 않았으므로 날짜파일은 쓰지
  #   않는다. 로그 중복은 러너 프로세스 안의 변수(NFP_SKIP_LOGGED)로 막는다(러너가 재기동되면 그날 한 줄 더 남을 수 있다 — 로그일 뿐).
  # 하트비트: 이 틱 최악 = 라우트 약 186초(3회×60 + 대기 2×3) + 매 분 잡 약 30초 + sleep 60 = 약 276초 < 300초(순찰 재시작 기준).
  #   15시대에는 다른 하루 1회 블록이 없다(03·06·07·08·16·17시뿐).
  # T-106 뉴스 0건 감시(라우트가 기록): 같은 KST 날짜의 두 번째 국내 수집은 하루로 센다(news-health.ts — streak 를 늘리지 않고, 06시가 0 이고
  #   지금 > 0 이면 초기화). 코드 변경 없음.
  NFP_MM=$(date '+%M')
  case "$NFP_MM" in [0-5][0-9]) ;; *) NFP_MM=00 ;; esac   # 읽을 수 없으면 이 틱은 돌지 않는다
  LAST_NEWS_DOM_PM=$(cat "$NEWS_FETCH_DOMESTIC_PM_LAST_RUN_FILE" 2>/dev/null || echo "")
  if [ "$HH" = "15" ] && [ "$NFP_MM" -ge 30 ] && [ "$LAST_NEWS_DOM_PM" != "$TODAY" ]; then
    call "/api/cron/news-fetch?market=domestic" "news-fetch-domestic-pm"
    echo "$TODAY" > "$NEWS_FETCH_DOMESTIC_PM_LAST_RUN_FILE"   # 성공·실패 무관 기록
  fi
  case "$HH" in
    16|17|18|19|20|21|22|23)
      if [ "$LAST_NEWS_DOM_PM" != "$TODAY" ] && [ "${NFP_SKIP_LOGGED:-}" != "$TODAY" ]; then
        echo "[$(date '+%F %T')] news-fetch-domestic-pm skipped — 15:30~15:59 에 러너가 돌지 않아 오늘 국내 두 번째 수집은 건너뜀(16:00 이후 호출 안 함)"
        NFP_SKIP_LOGGED="$TODAY"
      fi ;;
  esac
  # <<< news-fetch-domestic-pm
  # >>> news-fetch-peek (T-116) — scripts/test-cron-runner-news-peek.sh 가 러너 전체를 가짜 시각으로 돌려 시험한다
  # 뉴스 최초 관측 증거 캡처용 peek. M4 KB 는 같은 기사를 다시 적재하면 시각을 덮어쓰므로 "우리가 처음 본 시각"은 앱의 ci_raw_item 에만
  #   남는다(src/lib/corp-intel/raw-capture.ts). 06시·15:30 ingest 만으로는 피드 창보다 간격이 길어 그 사이 기사를 놓친다 → 낮 시간에
  #   피드만 읽는 peek 를 더 부른다(M4 mode:'peek' — 임베딩·upsert 없음, 응답의 items 만 캡처).
  # 시각표(KST, 서머타임과 무관하게 고정 — 간격 규칙만 지키면 된다): 캡처 간격 < 가장 짧은 피드 창(해외 MarketWatch 약 5.6시간, 국내 평일
  #   낮 약 6.6시간)이어야 항목을 놓치지 않는다.
  #     국내 10·13시 (+ 기존 ingest 06시·15:30) → 낮 최대 간격 06→10 = 4시간. 15:30→다음 날 06시(14.5시간) 밤 공백은 task T-116 설계 4 의
  #       시각표 그대로다 — 밤 기사량이 적어 피드 창이 길어진다는 가정이며 실측하지 않았다(캡처 상태로 나중에 확인할 거리)
  #     해외 02·10·14·18·22시 (+ 기존 ingest 06시) → 4시간 간격 고정(02→06→10→14→18→22→02)
  #   하루 호출: 국내 2 · 해외 5. 스위치(ci_capture_enabled)가 꺼져 있으면 라우트가 M4 를 부르지 않고 바로 200 으로 끝난다(DB 1회).
  # 슬롯마다 독립된 하루 1회 잡이다 — 날짜파일 news-peek-<시장>-<HH>-last-date(시장·시각마다 따로), 호출했으면 성공·실패 무관 기록(T-036).
  #   그 시각(HH)의 첫 틱에 돈다 — 그 시간 내내 러너가 꺼져 있었으면 그 슬롯은 건너뛴다(로그 없음, 다음 슬롯이 4시간 안에 온다).
  # 🔴 같은 틱에 peek 를 두 번 부르지 않는다: 10시는 해외·국내 두 슬롯이 겹친다 → 목록 앞쪽(해외)이 돌면 뒤(국내)는 다음 틱으로 미룬다
  #   (yield_tick, 날짜파일 안 씀 — 06시 블록과 같은 방식). 10:59 에 처음 돌면 국내 10시 슬롯은 그날 건너뛴다(다음 국내 슬롯 13시).
  # 다른 무거운 블록과 같은 틱이 되지 않는 시각만 골랐다: 하루 1회 블록은 03·06·07·08·15(30분~)·16·17시뿐이다(02·10·13·14·18·22시 없음).
  # 하트비트 최악(peek 틱): 라우트 = M4 호출 전 스위치 읽기 4초 + M4 최악 186초(3회×60 + 대기 2×3) + 캡처 4초(스위치·저장·상태 기록이
  #   마감 하나를 공유 — Leader 결정 Q8) = 194초, + 매 분 잡 약 30초 + sleep 60 = 약 284초 < 300초(순찰 재시작 기준).
  #   라우트 쪽 상한 근거는 route.ts·raw-capture.ts 주석.
  #   (참고: 06시·15:30 ingest 틱은 캡처 4초가 T-106 기록 4초와 병렬이라 라우트에 최대 4초가 더해진다 — 186 + 4 + 30 + 60 = 약 280초.)
  # 실패 알림: peek 실패는 news-fetch:* 알림을 내지 않는다(같은 장애는 06시 ingest 가 알린다) — 라우트가 캡처 상태
  #   system_config.ci_capture_status:<시장> 의 consecutiveFailures 만 올린다. T-106 뉴스 0건 감시에는 peek 를 넘기지 않는다.
  # 이 블록은 호출 줄·조건을 새로 더하기만 한다 — 다른 잡의 호출·시각·순서는 그대로다. 새 잡은 T-104 가 잡 정의로 흡수한다(J8).
  PEEK_RAN_LABEL=""
  for PEEK_SLOT in overseas:02 overseas:10 domestic:10 domestic:13 overseas:14 overseas:18 overseas:22; do
    PEEK_MKT="${PEEK_SLOT%%:*}"
    PEEK_HH="${PEEK_SLOT##*:}"
    [ "$HH" = "$PEEK_HH" ] || continue
    PEEK_LABEL="news-peek-${PEEK_MKT}-${PEEK_HH}"
    PEEK_FILE="${HOME}/.node-local/stockinvest/${PEEK_LABEL}-last-date"
    [ "$(cat "$PEEK_FILE" 2>/dev/null || echo "")" != "$TODAY" ] || continue
    if [ -n "$PEEK_RAN_LABEL" ]; then
      echo "[$(date '+%F %T')] $PEEK_LABEL yield_tick — $PEEK_RAN_LABEL 가 이 틱에 돌아 다음 틱으로 미룸"
      continue
    fi
    call "/api/cron/news-fetch?market=${PEEK_MKT}&mode=peek" "$PEEK_LABEL"
    echo "$TODAY" > "$PEEK_FILE"   # 성공·실패 무관 기록
    PEEK_RAN_LABEL="$PEEK_LABEL"
  done
  # <<< news-fetch-peek
  # 매일 03:00 KST: LoRA 학습 데이터셋 export (하루 1회만)
  LAST_TRAINSET=$(cat "$TRAINSET_LAST_RUN_FILE" 2>/dev/null || echo "")
  if [ "$HH" = "03" ] && [ "$LAST_TRAINSET" != "$TODAY" ]; then
    ts=$(date '+%F %T')
    echo "[$ts] export-llm-trainset start"
    # (T-036) 반드시 `bash` 경유로 실행한다 — 이 저장소의 편집 경로는 NFS `noexec` 마운트라
    # 파일 모드가 `-rwxrwxr-x`여도 +x 비트가 무효다(CLAUDE.md git 훅 절의 그 함정과 동일).
    # 직접 실행하던 이전 코드는 매번 "허가 거부"로 죽어 이 잡은 단 한 번도 성공한 적이 없다
    # (실측: OK 0건 / FAILED 6,574건, 날짜파일 자체가 생성된 적 없음).
    # cron-runner.sh 자신이 돌아가는 건 pm2가 `bash cron-runner.sh`로 띄우기 때문이다.
    if bash "$PROJECT_DIR/scripts/export-llm-trainset.sh" >> "${HOME}/.node-local/stockinvest/logs/export-trainset.log" 2>&1; then
      ts=$(date '+%F %T')
      echo "[$ts] export-llm-trainset OK"
    else
      ts=$(date '+%F %T')
      echo "[$ts] export-llm-trainset FAILED — see logs/export-trainset.log"
    fi
    # 성공·실패 무관하게 기록 (날짜파일 선언부 주석 참고) — 실패해도 하루 1회로 끝낸다.
    echo "$TODAY" > "$TRAINSET_LAST_RUN_FILE"
  fi
  i=$(( (i + 1) % 1440 ))   # 24h 사이클
  sleep 60
done
