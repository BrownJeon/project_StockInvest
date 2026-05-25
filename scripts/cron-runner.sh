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
#  - export-llm-trainset: 매일 03:00 KST — signals+followup → LoRA 학습 JSONL 생성·전송

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
  code=$(curl -s -o /tmp/cron-runner-$$.out -w "%{http_code}" -X POST \
    -H "x-cron-secret: $CRON_SECRET" -H 'Content-Type: application/json' \
    "$BASE_URL$path" -d "$body" 2>/dev/null) || code="000"
  local ts; ts=$(date '+%F %T')
  if [ "$code" = "200" ]; then
    echo "[$ts] $label OK"
  else
    echo "[$ts] $label HTTP=$code body=$(head -c 200 /tmp/cron-runner-$$.out 2>/dev/null)"
  fi
  rm -f /tmp/cron-runner-$$.out
}

# 시작 시 한 번 실행 (선택)
echo "[cron-runner] started, base=$BASE_URL"

META_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/sync-stock-meta-last-date"
TRAINSET_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/export-llm-trainset-last-date"
NEWS_FETCH_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/news-fetch-last-date"
mkdir -p "$(dirname "$META_LAST_RUN_FILE")"

# M4 뉴스 fetch 설정 (.env에서 로드)
AI_API_BASE_ENV=$(grep '^AI_API_BASE=' "$PROJECT_DIR/.env" | cut -d= -f2-)
M4_ADMIN_TOKEN_ENV=$(grep '^M4_ADMIN_TOKEN=' "$PROJECT_DIR/.env" | cut -d= -f2-)
M4_BASE="${AI_API_BASE:-${AI_API_BASE_ENV:-}}"
M4_ADMIN="${M4_ADMIN_TOKEN:-${M4_ADMIN_TOKEN_ENV:-}}"

# 분 단위 카운터 (동기 호출이라 60초 슬립으로 간략)
i=0
while true; do
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
  # 매일 17:00 KST: sync-stock-meta (하루 1회만)
  HH=$(date '+%H')
  TODAY=$(date '+%Y-%m-%d')
  LAST_META=$(cat "$META_LAST_RUN_FILE" 2>/dev/null || echo "")
  if [ "$HH" = "17" ] && [ "$LAST_META" != "$TODAY" ]; then
    call /api/cron/sync-stock-meta "sync-stock-meta"
    echo "$TODAY" > "$META_LAST_RUN_FILE"
  fi
  # 매일 06:00 KST: M4 KB 뉴스 fetch (하루 1회만) — news.kr_market + news.us_market 갱신
  LAST_NEWS=$(cat "$NEWS_FETCH_LAST_RUN_FILE" 2>/dev/null || echo "")
  if [ "$HH" = "06" ] && [ "$LAST_NEWS" != "$TODAY" ] && [ -n "$M4_BASE" ] && [ -n "$M4_ADMIN" ]; then
    ts=$(date '+%F %T')
    echo "[$ts] news-fetch start"
    OK=1
    for market in domestic overseas; do
      code=$(curl -sS --connect-timeout 10 --max-time 60 \
        -o /tmp/news-fetch-$market-$$.json -w "%{http_code}" \
        -X POST "$M4_BASE/v1/news/fetch" \
        -H "X-Admin-Token: $M4_ADMIN" -H "Content-Type: application/json" \
        -d "{\"market\":\"$market\",\"limit\":20}" 2>/dev/null)
      if [ "$code" = "200" ]; then
        upserted=$(python3 -c "import json; d=json.load(open('/tmp/news-fetch-$market-$$.json')); print(d.get('upserted',0))" 2>/dev/null || echo "?")
        echo "[$ts] news-fetch $market OK upserted=$upserted"
      else
        echo "[$ts] news-fetch $market FAILED HTTP=$code $(cat /tmp/news-fetch-$market-$$.json 2>/dev/null | head -c 100)"
        OK=0
      fi
      rm -f "/tmp/news-fetch-$market-$$.json"
    done
    [ "$OK" = "1" ] && echo "$TODAY" > "$NEWS_FETCH_LAST_RUN_FILE"
  fi
  # 매일 03:00 KST: LoRA 학습 데이터셋 export (하루 1회만)
  LAST_TRAINSET=$(cat "$TRAINSET_LAST_RUN_FILE" 2>/dev/null || echo "")
  if [ "$HH" = "03" ] && [ "$LAST_TRAINSET" != "$TODAY" ]; then
    ts=$(date '+%F %T')
    echo "[$ts] export-llm-trainset start"
    if "$PROJECT_DIR/scripts/export-llm-trainset.sh" >> "${HOME}/.node-local/stockinvest/logs/export-trainset.log" 2>&1; then
      ts=$(date '+%F %T')
      echo "[$ts] export-llm-trainset OK"
      echo "$TODAY" > "$TRAINSET_LAST_RUN_FILE"
    else
      ts=$(date '+%F %T')
      echo "[$ts] export-llm-trainset FAILED — see logs/export-trainset.log"
    fi
  fi
  i=$(( (i + 1) % 1440 ))   # 24h 사이클
  sleep 60
done
