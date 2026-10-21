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
#  - post-market-overseas: 매일 08:00 KST — 해외장 마감 후 익일 시나리오 분석
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
  LAST_POST_OVS=$(cat "$POST_MARKET_OVERSEAS_LAST_RUN_FILE" 2>/dev/null || echo "")
  if [ "$HH" = "08" ] && [ "$LAST_POST_OVS" != "$TODAY" ]; then
    call "/api/cron/post-market-analysis?market=overseas" "post-market-overseas"
    echo "$TODAY" > "$POST_MARKET_OVERSEAS_LAST_RUN_FILE"
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
