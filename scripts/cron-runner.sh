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
#  - news-fetch        : 매일 06:00 KST — M4 KB news.kr_market + news.us_market RSS 갱신
#                        (T-036에서 bash 직접 curl → /api/cron/news-fetch 라우트로 이관.
#                         재시도·타임아웃·실패 알림은 전부 라우트 안에 있다)
#  - post-market-domestic: 매일 16:00 KST — 국내장 마감 후 익일 시나리오 분석
#  - post-market-overseas: 매일 08:00 KST — 해외장 마감 후 다음 미국장 시나리오 분석 (T-062: 200 이 아니면 08시 안에서 최대 3회)
#  - research-cycle-domestic: 매일 16:00 KST — 국내 리서치 추적 종목 사이클 패턴 재계산 (T-032, 주문 없음)
#  - research-cycle-overseas: 매일 07:00 KST — 해외 리서치 추적 종목 사이클 패턴 재계산 (T-032, 주문 없음)
#  - export-llm-trainset: 매일 03:00 KST — signals+followup → LoRA 학습 JSONL 생성·전송
#  - edgar-sync        : 매일 07:00 KST — SEC EDGAR 공시·XBRL 재무 읽기 전용 수집 (T-059, 주문·시그널 없음)
#  - kis-fundamentals-snapshot: 매일 08:00 KST — KIS 해외 현재가상세(PER·PBR 등) 원값 스냅샷 (T-059, 읽기 전용 GET)

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
NEWS_FETCH_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/news-fetch-last-date"
POST_MARKET_DOMESTIC_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/post-market-domestic-last-date"
POST_MARKET_OVERSEAS_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/post-market-overseas-last-date"
POST_MARKET_OVERSEAS_ATTEMPT_FILE="${HOME}/.node-local/stockinvest/post-market-overseas-attempts"   # (T-062 S-2b) 그날 시도 횟수
RS_UPDATE_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/rs-update-last-date"
RESEARCH_DOMESTIC_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/research-cycle-domestic-last-date"
RESEARCH_OVERSEAS_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/research-cycle-overseas-last-date"
EDGAR_SYNC_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/edgar-sync-last-date"
KIS_FUNDAMENTALS_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/kis-fundamentals-snapshot-last-date"
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
  # 매일 16:00 KST: 국내 리서치 사이클 재계산 (T-032) — 15:30 마감 후 30분 데이터 반영 대기.
  # post-market-domestic(16:00)과 **독립된 블록**이다 — 같은 시각이지만 합치지 않는다.
  LAST_RESEARCH_DOM=$(cat "$RESEARCH_DOMESTIC_LAST_RUN_FILE" 2>/dev/null || echo "")
  if [ "$HH" = "16" ] && [ "$LAST_RESEARCH_DOM" != "$TODAY" ]; then
    call "/api/cron/research-cycle-domestic" "research-cycle-domestic"
    echo "$TODAY" > "$RESEARCH_DOMESTIC_LAST_RUN_FILE"
  fi
  # 매일 06:00 KST: M4 KB 뉴스 fetch (하루 1회만) — news.kr_market + news.us_market 갱신.
  # (T-036) bash 직접 curl → 라우트 호출로 이관. 재시도·타임아웃·실패 알림은 라우트 안에 있다.
  LAST_NEWS=$(cat "$NEWS_FETCH_LAST_RUN_FILE" 2>/dev/null || echo "")
  if [ "$HH" = "06" ] && [ "$LAST_NEWS" != "$TODAY" ]; then
    call /api/cron/news-fetch "news-fetch"
    echo "$TODAY" > "$NEWS_FETCH_LAST_RUN_FILE"   # 성공·실패 무관 기록 (날짜파일 선언부 주석 참고)
  fi
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
