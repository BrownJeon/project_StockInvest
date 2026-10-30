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
#                        해외 매시(T-118 — 06·07·08·15·16시 제외, 하루 19회) KST 각 시각의 첫 틱에 하루 1회(슬롯마다 날짜파일, 성공·실패
#                        무관 기록, curl 상한 40초). 스위치 ci_capture_enabled 가 꺼져 있으면 라우트가 M4 를 부르지 않고 바로 끝난다.
#                        같은 틱에 두 슬롯이 겹치면(10·13시) 뒤(국내) 슬롯은 다음 틱으로 미룬다. T-104 단계 1 에서 잡 정의로 흡수한다(J8).
#  - daily-bars        : 매일 07:40~07:54 KST 첫 틱 — 일봉 정기 증분 수집 (T-117, POST /api/cron/daily-bars 본문 없음 = 라우트 기본 대상,
#                        KIS 읽기 전용 GET → daily_bars upsert 뿐·주문·시그널·알림 없음). 하루 1회(성공·실패 무관 날짜파일), 재시도 없음,
#                        curl 상한 DAILY_BARS_CURL_MAX_TIME. research-cycle-overseas·edgar-sync·broker-fills 가 같은 틱에 돌면 다음 틱으로
#                        미루고, 07:55 이후에는 부르지 않는다(그날 건너뜀 — 로그 한 줄). 새 잡은 T-104 가 나중에 잡 정의로 흡수한다(J8).
#  - holdings-premarket: 미국 동부(ET) 08시 평일 첫 틱 하루 1회 — 보유 미국 종목 SEC 새 공시 확인, 새 공시가 있을 때만 알림 (T-119, 주문·분석 무관)
#  - (T-112) 실행·상태 기록 후크: call() 이 끝날 때마다 로컬 스풀에 한 줄, 틱 경과 150초 미만인 틱 끝에서 POST /api/cron/job-run-log 로 일괄 전송
#                        (기록 전용 — 잡 호출·시각·날짜파일·하트비트 불변, 아래 job-run-log-spool 블록)

set -u
PROJECT_DIR="${PROJECT_DIR:-/home/brownjeon/NFS/homes/brownjeon/project/StockInvest}"
BASE_URL="${BASE_URL:-http://localhost:3003}"
CRON_SECRET=$(grep '^CRON_SECRET=' "$PROJECT_DIR/.env" | cut -d= -f2-)

if [ -z "$CRON_SECRET" ]; then
  echo "[cron-runner] CRON_SECRET not set in .env — exiting"
  exit 1
fi

# (T-112) 아래 `# T-112 jrl` 표지 두 줄은 실행·상태 기록 후크다(job-run-log-spool 블록). 시작 시각을 재고, 로그 줄을 쓴 뒤·임시 본문 파일을 지우기
#   전에 스풀에 한 줄을 남긴다. code·CALL_LAST_CODE·본문 파일·반환값(마지막 rm)은 바꾸지 않는다. 후크 함수가 없어도(블록만 잘라 시험) 무해하다.
call() {
  local path="$1"
  local label="$2"
  local body="${3:-{}}"
  local code
  local jrl_t0; jrl_t0=$(jrl_now_ms 2>/dev/null)   # T-112 jrl
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
  jrl_hook "$label" "$path" "$code" "${jrl_t0:-}" 2>/dev/null || true   # T-112 jrl
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
# (T-112) 기록 후크(call() 마다 로컬 스풀 한 줄, 약 5~15ms)를 더해도 이 틱 최악 ≈ 290.2초 < 300초 — 스풀 일괄 전송은 틱 경과 150초 미만인
#   틱에서만이라 이 틱에서는 돌지 않는다(job-run-log-spool 블록 주석의 계산).
STOP_ALERT_CURL_MAX_TIME=20
# (T-087 D1a) 브로커 체결 원장 수집(broker-fills) 호출 한 번의 curl 전체 시간 상한(초). 라우트 자체 예산 75초보다 길고, 하트비트 최악은
# 90 + 매 분 잡 약 30 + sleep 60 = 180초 < 300초(순찰 재시작 기준). 07시 틱(research·edgar)과는 아래 yield 규칙으로 같은 틱에 겹치지 않는다.
BROKER_FILLS_CURL_MAX_TIME=90
# (T-117) 일봉 정기 증분 수집(daily-bars) 호출 한 번의 curl 전체 시간 상한(초). 라우트 예산은 KIS 호출 시작 기준 100초(DEFAULT_MAX_MS)이고
# 그 앞(테이블·대상 조회)과 마지막 호출(줄 서기·통신 10초)·upsert 가 더 걸릴 수 있어 여유를 둔 값이다. 하트비트 최악(07:40 틱):
# 120 + stop-alert 20 + 매 분 잡 약 30 + sleep 60 = 약 230초 < 300초(순찰 재시작 기준). 07시 무거운 틱(research·edgar·broker-fills)과는
# 아래 daily-bars 블록의 yield 규칙으로 같은 틱에 겹치지 않는다. 상한에 걸리면 curl 이 000 으로 끝나고(그날 날짜파일은 기록 — 재시도 없음)
# 서버 쪽 실행은 끝까지 갈 수 있다(라우트 single-flight 가 겹침을 막고, 저장은 가산 upsert 라 다음 날 증분이 이어받는다).
DAILY_BARS_CURL_MAX_TIME=120
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

# >>> job-run-log-spool (T-112) — 크론 잡 실행·상태 기록(job_run_log). scripts/test-cron-runner-job-run-log.sh 가 러너 전체를 가짜 시각·가짜 curl 로 돌려 시험한다
# 무엇: call() 이 끝날 때마다(jrl_hook) 서버 로컬 스풀 파일에 한 줄을 덧붙이고, 틱 끝(jrl_flush — sleep 60 앞)에서 **틱 경과가 150초 미만일 때만**
#   최대 200줄을 묶어 POST /api/cron/job-run-log 로 보낸다(DDL 초안 §5.1 방식 B · T-112 구현 규칙 R1). 판정(ok·failed·skipped …)·예정 슬롯·시간 롤업은
#   앱(src/lib/strategy/records/job-run-log.ts·job-slots.ts)이 한다 — 러너는 라벨·경로·HTTP 코드·시각·본문 앞 2KB 만 적는다.
# 🔴 관찰 전용 — 기록이 실패하거나 느려도 잡 호출·순서·시각·날짜파일·CALL_LAST_CODE(해외 분석 재시도)·로그 줄·하트비트가 바뀌지 않는다:
#   - 후크는 로컬 파일 덧붙이기뿐(네트워크 없음). 명령은 전부 2>/dev/null, 부르는 자리는 `|| true`. set -u 라 인자·변수는 ${VAR:-} 로 읽는다.
#   - 후크는 code·CALL_LAST_CODE·임시 본문 파일을 바꾸지 않는다(본문은 읽기만 — 지우는 것은 call() 의 원래 rm 줄).
#   - 전송 curl 은 call() 을 거치지 않는다(재귀 기록 없음 — 이 전송 자체는 기록되지 않는다).
# 스풀: ${HOME}/.node-local/stockinvest/job-run-spool (로컬 디스크 — NFS 아님, 하트비트와 같은 디렉터리). JRL_SPOOL_FILE="" 로 띄우면 후크·전송이 모두 꺼진다.
#   줄 형식 v1(탭 구분 7칸): v1 · 라벨 · 경로 · HTTP 코드(000 = 연결 끊김·curl 상한) · 시작 epoch ms · 종료 epoch ms · 본문 앞 2KB 의 base64(한 줄 —
#   따옴표·줄바꿈·탭이 줄을 깨지 않는다). 매 분 잡 3개(entry-watcher·holding-checker·stop-alert)는 200 이면 본문을 싣지 않는다(앱의 표와 같아야
#   한다 — job-slots.test.ts 가 아래 case 줄을 읽어 대조). curl 종료코드는 call() 의 기존 줄을 바꾸지 않고는 얻을 수 없어 싣지 않는다(삭제 줄 0 원칙).
# 전송: 응답이 200 이면 보낸 줄을 지운다(기록 스위치 job_run_log_enabled 가 꺼졌거나 테이블이 없어도 앱이 200 skipped 로 답한다 → 비운다).
#   그 밖(앱 다운 000·503·401)이면 남겨 다음 가벼운 틱에 다시 보낸다 — 앱은 같은 줄을 멱등으로 받는다(시간 롤업 runs 만 드물게 과대 집계, 초안 §5.2).
#   실패가 시작될 때 로그 한 줄, 회복될 때 한 줄(매 분 반복하지 않는다).
# 상한: 보낼 파일이 2MiB 를 넘으면 오래된 줄부터 버려 1MiB 로 줄이고 로그 한 줄 — 앱이 오래 죽어 있어도 디스크가 차지 않는다.
# 하트비트 최악(T-037 워치독·HOME-SERVER 순찰 300초 — 하트비트는 틱 시작에만 쓰므로 최악 = 틱 길이 + sleep 60):
#   - 전송하는 틱: 틱 경과 < 150초 + 전송 curl 상한 3초 + 로컬 처리(수 ms) + sleep 60 ≈ 213초 < 300초.
#   - 전송하지 않는 틱(경과 ≥ 150초 — 08시·06시 ingest·07:40 daily-bars 같은 무거운 틱): 기존 최악 290초(08시: 해외 분석 120 + KIS 스냅샷 60 +
#     매 분 잡 30 + stop-alert 20 + sleep 60) + 후크(call() 마다 date 2번·head·base64·printf — 약 5~15ms × 그 틱의 call() 약 10번 ≈ 0.1~0.2초)
#     + 스풀 접기·상한 검사(수 ms) ≈ 290.2초 < 300초. 후크는 남은 10초 여유를 넘기지 않는다.
#   - export-llm-trainset(03시)은 call() 을 거치지 않아 기록되지 않는다(bash 스크립트를 직접 돌린다 — 초안 §0-6).
# 겹침: 배포 때 러너 두 개가 1~3초 겹칠 수 있다(설계서 §11 LOW). 한 줄(< 4KB) 덧붙이기는 섞이지 않고, 그 몇 초 동안 접기·전송이 겹치면 줄이 한 번 더
#   가거나(멱등) 드물게 한 줄 빠질 수 있다 — 기록 전용이라 허용.
JRL_SPOOL_FILE="${JRL_SPOOL_FILE-${HOME}/.node-local/stockinvest/job-run-spool}"
JRL_SPOOL_MAX_BYTES=2097152
JRL_SPOOL_KEEP_BYTES=1048576
JRL_FLUSH_MAX_ELAPSED_SEC=150
JRL_FLUSH_CURL_MAX_TIME=3
JRL_FLUSH_MAX_LINES=200
JRL_BODY_MAX_BYTES=2048
JRL_FAILING=""
jrl_now_ms() {
  local s; s=$(date +%s%3N 2>/dev/null)
  case "$s" in ''|*[!0-9]*) s="$(date +%s 2>/dev/null)000" ;; esac
  printf '%s' "$s"
}
# jrl_hook LABEL PATH CODE T0_MS — call() 끝(임시 본문 파일을 지우기 전)에서 스풀에 한 줄. 실패는 전부 삼킨다. 반환은 항상 0.
jrl_hook() {
  local label="${1:-}" path="${2:-}" hc="${3:-}" t0="${4:-}" t1="" b64="" b64_skip=0 f="${JRL_SPOOL_FILE:-}"
  [ -n "$f" ] || return 0
  t1=$(jrl_now_ms)
  case "$hc" in [0-9][0-9][0-9]) ;; *) hc=000 ;; esac
  case "$t0" in ''|*[!0-9]*) t0="$t1" ;; esac
  case "$label" in
    entry-watcher|holding-checker|stop-alert) [ "$hc" = "200" ] && b64_skip=1 ;;
  esac
  if [ "$b64_skip" = "0" ]; then
    b64=$(head -c "$JRL_BODY_MAX_BYTES" "/tmp/cron-runner-$$.out" 2>/dev/null | base64 -w0 2>/dev/null) || b64=""
  fi
  { printf 'v1\t%s\t%s\t%s\t%s\t%s\t%s\n' "$label" "$path" "$hc" "$t0" "$t1" "$b64" >> "$f"; } 2>/dev/null || true
  return 0
}
# jrl_flush TICK_T0 — 틱 끝(sleep 60 앞). ① 새 줄을 보낼 파일(.sending)로 접는다 ② 크기 상한 ③ 틱 경과 < 150초면 최대 200줄 전송. 반환은 항상 0.
jrl_flush() {
  local f="${JRL_SPOOL_FILE:-}" t0="${1:-}" s="" now="" el=0 sz=0 n=0 before=0 after=0 code=""
  [ -n "$f" ] || return 0
  s="$f.sending"
  # ① 접기 — 후크와 같은 프로세스라 서로 겹치지 않는다. 앞 틱에서 접다 멈춘 .fold 가 있으면 그것부터(덮어쓰지 않는다).
  if [ ! -f "$f.fold" ] && [ -s "$f" ]; then mv -f "$f" "$f.fold" 2>/dev/null || true; fi
  if [ -f "$f.fold" ]; then { cat "$f.fold" >> "$s"; } 2>/dev/null && rm -f "$f.fold" 2>/dev/null; fi
  [ -s "$s" ] || { rm -f "$s" 2>/dev/null; return 0; }
  # ② 크기 상한 — 로컬 처리라 틱 경과와 무관하게 매 틱 본다
  sz=$(wc -c < "$s" 2>/dev/null); case "$sz" in ''|*[!0-9]*) sz=0 ;; esac
  if [ "$sz" -gt "$JRL_SPOOL_MAX_BYTES" ]; then
    before=$(wc -l < "$s" 2>/dev/null); case "$before" in ''|*[!0-9]*) before=0 ;; esac
    if { tail -c "$JRL_SPOOL_KEEP_BYTES" "$s" | tail -n +2 > "$s.cap"; } 2>/dev/null && mv -f "$s.cap" "$s" 2>/dev/null; then
      after=$(wc -l < "$s" 2>/dev/null); case "$after" in ''|*[!0-9]*) after=0 ;; esac
      echo "[$(date '+%F %T')] job-run-log 스풀 상한(${JRL_SPOOL_MAX_BYTES}B) 초과 — 오래된 $((before - after))줄 버림(기록 전용, 잡 동작 무관)"
    else
      rm -f "$s.cap" 2>/dev/null
    fi
  fi
  # ③ 전송 — 틱 경과 150초 미만일 때만(위 하트비트 계산). 시각을 읽을 수 없으면 보내지 않는다.
  case "$t0" in ''|*[!0-9]*) return 0 ;; esac
  now=$(date +%s 2>/dev/null); case "$now" in ''|*[!0-9]*) return 0 ;; esac
  el=$((now - t0))
  [ "$el" -lt "$JRL_FLUSH_MAX_ELAPSED_SEC" ] || return 0
  { head -n "$JRL_FLUSH_MAX_LINES" "$s" > "$s.batch"; } 2>/dev/null || { rm -f "$s.batch" 2>/dev/null; return 0; }
  n=$(wc -l < "$s.batch" 2>/dev/null); case "$n" in ''|*[!0-9]*) n=0 ;; esac
  [ "$n" -gt 0 ] || { rm -f "$s.batch" 2>/dev/null; return 0; }
  code=$(curl -s --max-time "$JRL_FLUSH_CURL_MAX_TIME" -o /dev/null -w "%{http_code}" -X POST \
    -H "x-cron-secret: ${CRON_SECRET:-}" -H 'Content-Type: text/plain' \
    --data-binary @"$s.batch" "${BASE_URL:-}/api/cron/job-run-log" 2>/dev/null) || code="000"
  if [ "$code" = "200" ]; then
    if { tail -n +$((n + 1)) "$s" > "$s.rest"; } 2>/dev/null && mv -f "$s.rest" "$s" 2>/dev/null; then
      [ -s "$s" ] || rm -f "$s" 2>/dev/null
    else
      rm -f "$s.rest" 2>/dev/null
    fi
    if [ -n "$JRL_FAILING" ]; then echo "[$(date '+%F %T')] job-run-log 전송 회복"; JRL_FAILING=""; fi
  elif [ -z "$JRL_FAILING" ]; then
    JRL_FAILING="$code"
    echo "[$(date '+%F %T')] job-run-log 전송 실패 HTTP=$code — 스풀에 남겨 다음 가벼운 틱에 다시 보냄(기록 전용, 잡 동작 무관)"
  fi
  rm -f "$s.batch" 2>/dev/null
  return 0
}
# <<< job-run-log-spool

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
DAILY_BARS_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/daily-bars-last-date"   # (T-117)
HOLDINGS_PREMARKET_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/holdings-premarket-last-date"   # (T-119) KST 가 아니라 ET 날짜를 쓴다
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
  JRL_TICK_T0=$(date +%s 2>/dev/null)   # T-112 jrl

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
  # >>> daily-bars-daily (T-117) — scripts/test-cron-runner-daily-bars.sh 가 러너 전체를 가짜 시각·가짜 curl 로 돌려 시험한다
  # 매일 07:40~07:54 KST 첫 틱: 일봉 정기 증분 수집. POST /api/cron/daily-bars 를 **본문 없이**(call() 기본 '{}') 부른다 = 라우트 기본 대상
  #   (보유 → 최근 90일 시그널 종목 ≤300, years 3, maxCalls 150). KIS 읽기 GET → daily_bars upsert 뿐 — 주문·시그널·알림 없음.
  #   증분 판정·up_to_date 건너뛰기·single-flight·예산(호출 150·100초)·오프아워 판정(KST 05:10~08:30, 매시 분 3~55 밖, 07:55~08:10 거부)은
  #   라우트가 한다(src/app/api/cron/daily-bars/route.ts, src/lib/profit-engine/daily-bars-time.ts).
  # 왜 07:40~07:54: ① 미국 일봉 확정(ET 16:30) = KST 05:30(서머타임) / 06:30(2026-11-01 서머타임 종료 후) 보다 늦다 ② 라우트 오프아워 창 안이고
  #   정각 앞뒤·07:55~08:10 을 피한다 ③ 07:00 틱(research-cycle-overseas·edgar-sync)·07:20 이후 첫 틱(broker-fills) 뒤다 ④ 08:00 해외 분석
  #   (post-market-overseas, 실패 시 08:10·08:20)·kis-fundamentals-snapshot 과 겹치지 않는다. 국내 봉은 전날 15:40 확정분을 같은 호출이 받는다.
  # 한 번만 부른다(재시도 없음). 날짜파일은 호출했으면 성공·실패 무관 기록(T-036) — 하루 1회. 409(오프아워 밖·이미 실행 중)·503(유량·인증 중단)·
  #   000(curl 상한) 도 따로 처리하지 않고 call() 의 로그 한 줄로 끝난다. 못 한 날은 다음 날 증분이 이어받는다(daily_bars 는 가산 upsert,
  #   증분은 저장된 마지막 일자부터).
  # 🔴 같은 틱에 무거운 잡이 돌았으면 미룬다(yield_tick, 날짜파일 안 씀): research-cycle-overseas·edgar-sync·broker-fills 블록이 호출 **전**에
  #   읽어 둔 LAST_RESEARCH_OVS·LAST_EDGAR·LAST_BROKER_FILLS 중 하나라도 오늘이 아니면 그 잡이 이 틱에 돌았다(또는 broker-fills 가 미뤘다 —
  #   그때는 research·edgar 가 이 틱에 돌았다)는 뜻이다. 07시 40분 이후에는 세 블록 모두 "오늘이 아니면 이 틱에 반드시 돈다(또는 미룬다)"라
  #   변수만으로 정확하다. 날짜파일을 다시 읽으면 세 블록이 이미 오늘로 써 두어 미루기가 발동하지 않는다(broker-fills yield_tick 과 같은 이유).
  # 하트비트: 이 틱 최악 = curl 상한 DAILY_BARS_CURL_MAX_TIME 120 + stop-alert 20 + 매 분 잡 약 30 + sleep 60 = 약 230초 < 300초(순찰 재시작 기준).
  # ⚠ 러너 가장자리(허용): 07:40~07:54 에 러너가 꺼져 있었거나, 재기동 직후 미루기(research·edgar → broker-fills → daily-bars, 틱 3개)가
  #   07:55 를 넘기면 그날은 건너뛴다 — 08:10 이후로 미루지 않는다(08시 해외 분석 재시도와 겹치고 라우트가 08:10~08:27 만 허용한다).
  #   호출하지 않았으므로 날짜파일은 쓰지 않고, 07:55~23:59 의 첫 틱에 로그 한 줄만 남긴다(러너 프로세스 변수 DBARS_SKIP_LOGGED 로 중복 방지 —
  #   러너가 재기동되면 그날 한 줄 더 남을 수 있다. 로그일 뿐). 다음 날 증분이 이어받는다.
  # 이 블록은 호출 줄·조건을 새로 더하기만 한다 — 다른 잡의 호출·시각·순서는 그대로다. T-104 단계 1(잡 정의·스케줄 DB 화)이 시작되면
  #   이 하드코딩 블록을 잡 정의로 흡수한다(공동 인계서 J8).
  DBARS_MM=$(date '+%M')
  case "$DBARS_MM" in [0-5][0-9]) ;; *) DBARS_MM=00 ;; esac   # 읽을 수 없으면 이 틱은 돌지 않는다
  LAST_DAILY_BARS=$(cat "$DAILY_BARS_LAST_RUN_FILE" 2>/dev/null || echo "")
  if [ "$HH" = "07" ] && [ "$DBARS_MM" -ge 40 ] && [ "$DBARS_MM" -le 54 ] && [ "$LAST_DAILY_BARS" != "$TODAY" ]; then
    if [ "$LAST_RESEARCH_OVS" != "$TODAY" ] || [ "$LAST_EDGAR" != "$TODAY" ] || [ "$LAST_BROKER_FILLS" != "$TODAY" ]; then
      echo "[$(date '+%F %T')] daily-bars yield_tick — research-cycle-overseas/edgar-sync/broker-fills 가 이 틱에 돌아 다음 틱으로 미룸"
    else
      CALL_MAX_TIME="$DAILY_BARS_CURL_MAX_TIME"   # 이 호출에만 시간 상한
      call "/api/cron/daily-bars" "daily-bars"
      CALL_MAX_TIME=""
      echo "$TODAY" > "$DAILY_BARS_LAST_RUN_FILE"   # 성공·실패 무관 기록
    fi
  fi
  DBARS_LATE=no
  case "$HH" in
    07) [ "$DBARS_MM" -ge 55 ] && DBARS_LATE=yes ;;
    08|09|1[0-9]|2[0-3]) DBARS_LATE=yes ;;
  esac
  if [ "$DBARS_LATE" = "yes" ] && [ "$LAST_DAILY_BARS" != "$TODAY" ] && [ "${DBARS_SKIP_LOGGED:-}" != "$TODAY" ]; then
    echo "[$(date '+%F %T')] daily-bars skipped — 07:40~07:54 에 부르지 못해 오늘 일봉 증분은 건너뜀(07:55 이후 호출 안 함, 다음 날 증분이 이어받음)"
    DBARS_SKIP_LOGGED="$TODAY"
  fi
  # <<< daily-bars-daily
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
  # >>> news-fetch-peek (T-116 · T-118 확대) — scripts/test-cron-runner-news-peek.sh 가 러너 전체를 가짜 시각으로 돌려 시험한다
  # 뉴스 최초 관측 증거 캡처용 peek. M4 KB 는 같은 기사를 다시 적재하면 시각을 덮어쓰므로 "우리가 처음 본 시각"은 앱의 ci_raw_item 에만
  #   남는다(src/lib/corp-intel/raw-capture.ts). 06시·15:30 ingest 만으로는 피드 창보다 간격이 길어 그 사이 기사를 놓친다 → 피드만 읽는
  #   peek 를 더 부른다(M4 mode:'peek' — 임베딩·upsert 없음, 응답의 items 만 캡처).
  # 🔴 T-104 단계 1 에서 잡 정의로 흡수한다(J8) — 그때 아래 시각 규칙·하루 1회·양보·curl 상한을 그대로 옮긴다.
  # 시각표(KST, 서머타임과 무관하게 고정): 캡처 간격 < 가장 짧은 피드 창이어야 항목을 놓치지 않는다.
  #   (T-118 — T-114 독립 검토 HIGH H1) T-116 의 해외 4시간 간격(02·10·14·18·22시)은 이 규칙을 어겼다. 실측 한 번의 peek 가 돌려주는 기사의
  #   발행 시간 폭: MarketWatch(dowjones) 약 2.7~3.4시간(10건)·Yahoo 약 1.0~1.6시간(19~20건)·CNBC·Bloomberg 약 15~18시간(2026-10-28 22:00 KST
  #   ci_raw_item 첫 캡처 80건 + Reviewer 23:01 직접 조회). 4시간이면 두 피드 기사가 슬롯 사이에 밀려나 최초 관측 증거가 영구히 사라진다.
  #   → 해외는 **매시**, 단 06·07·08·15·16시는 뺀다(06 ingest · 07 research·edgar·broker-fills · 08 해외 분석·KIS 스냅샷 · 15 국내 15:30 수집 ·
  #   16 국내 분석 — 러너의 무거운 잡이 도는 틱이라 peek 를 얹지 않는다). 해외 하루 19회(00~05·09~14·17~23시) — 06→09·14→17 은 3시간이다.
  #   국내 10·13시 (+ ingest 06시·15:30) 는 T-116 그대로(국내 피드 창 약 6.6시간). 하루 호출: 해외 19 · 국내 2. 호출당 약 2초·KB 쓰기 없음.
  #   스위치(ci_capture_enabled)가 꺼져 있으면 라우트가 M4 를 부르지 않고 바로 200 으로 끝난다(DB 1회).
  # 슬롯마다 독립된 하루 1회 잡이다 — 날짜파일 news-peek-<시장>-<HH>-last-date(시장·시각마다 따로 — 해외 19 + 국내 2 = 21개, T-116 의 7개와
  #   같은 이름 규칙이라 배포 당일 이미 돈 슬롯은 다시 돌지 않는다), 호출했으면 성공·실패 무관 기록(T-036). 그 시각(HH)의 첫 틱에 돈다 —
  #   그 시간 내내 러너가 꺼져 있었으면 그 슬롯은 건너뛴다(로그 없음, 다음 슬롯이 1~3시간 안에 온다).
  # 🔴 같은 틱에 peek 를 두 번 부르지 않는다: 10·13시는 해외·국내 두 슬롯이 겹친다 → 해외가 돌면 국내는 다음 틱으로 미룬다(yield_tick,
  #   날짜파일 안 씀 — 06시 블록과 같은 방식). 10:59·13:59 에 처음 돌면 국내 그 슬롯은 그날 건너뛴다.
  # 🔴 (T-118) peek 호출에만 curl 상한 PEEK_CURL_MAX_TIME(40초). 라우트 쪽 peek 는 M4 1회·20초(재시도 없음)라 라우트 최악 = 스위치 4 + M4 20 +
  #   캡처 4(겹침 검사·저장·상태 기록이 마감 하나를 공유) = 28초 < 40초. 하트비트 최악(peek 틱): 40 + 매 분 잡 약 30 + sleep 60 = 약 130초 <
  #   300초(순찰 재시작 기준). 17시(sync-stock-meta 실측 1초 안팎)·03시(export-llm-trainset 실측 1~5초) 틱과 겹쳐도 그 잡이 170초 미만이면
  #   300초 안이다(scripts/test-cron-runner-news-peek.sh 가 두 잡을 각 60초로 늘려 확인). ingest(06시·15:30)의 재시도·60초 상한은 그대로다.
  #   (참고: 06시·15:30 ingest 틱은 캡처 4초(T-118 겹침 검사 포함 — 저장과 나란히)가 T-106 기록 4초와 병렬이라 라우트에 최대 4초가 더해진다 —
  #   186 + 4 + 30 + 60 = 약 280초, T-116 과 같다.)
  # 실패 알림: peek 실패는 news-fetch:* 알림을 내지 않는다(같은 장애는 06시 ingest 가 알린다) — 라우트가 캡처 상태
  #   system_config.ci_capture_status:<시장> 의 consecutiveFailures 만 올린다(T-118: 피드별 겹침 결과 feeds 도 같은 키에 기록, 알림 없음).
  #   T-106 뉴스 0건 감시에는 peek 를 넘기지 않는다.
  # 이 블록은 peek 호출만 한다 — 다른 잡의 호출·시각·순서는 그대로다.
  PEEK_RAN_LABEL=""
  PEEK_CURL_MAX_TIME=40
  PEEK_SLOTS="overseas:$HH"
  case "$HH" in
    06|07|08|15|16) PEEK_SLOTS="" ;;              # 무거운 잡 틱 — 해외 peek 없음(위 근거)
    [0-2][0-9]) ;;
    *) PEEK_SLOTS="" ;;                           # 시각을 읽을 수 없으면 이 틱은 돌지 않는다
  esac
  case "$HH" in
    10|13) PEEK_SLOTS="$PEEK_SLOTS domestic:$HH" ;;   # 국내 슬롯 — 해외 뒤(양보로 다음 틱)
  esac
  for PEEK_SLOT in $PEEK_SLOTS; do
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
    CALL_MAX_TIME="$PEEK_CURL_MAX_TIME"   # 이 호출에만 시간 상한
    call "/api/cron/news-fetch?market=${PEEK_MKT}&mode=peek" "$PEEK_LABEL"
    CALL_MAX_TIME=""
    echo "$TODAY" > "$PEEK_FILE"   # 성공·실패 무관 기록
    PEEK_RAN_LABEL="$PEEK_LABEL"
  done
  # <<< news-fetch-peek
  # >>> holdings-premarket (T-119) — scripts/test-cron-runner-holdings-premarket.sh 가 러너 전체를 가짜 시각으로 돌려 시험한다
  # 보유 미국 종목 개장 전 공시 확인 — 새 공시가 있을 때만 텔레그램 정보 알림(주문·시그널·분석 입력 없음, us_filings 안 씀).
  # T-104 단계 1 에서 잡 정의로 흡수, ET 기준 시각(America/New_York 08:00) 표현이 필요 — 이 잡만 KST 고정 시각이 아니다.
  # 시각: 미국 동부 08시(ET)의 첫 틱, 월~금. 서머타임(EDT) 중 KST 21시 / 표준시(EST) 중 KST 22시 — 러너가 `TZ=America/New_York date`
  #   로 시·요일·날짜를 읽으므로 전환일(11월 첫 일요일·3월 둘째 일요일)은 tzdata 가 처리한다. %Z 가 EDT/EST 가 아니면(tzdata 없음 → glibc 가
  #   조용히 UTC 로 계산) 부르지 않는다. 미국 휴장 평일에도 부른다(공시는 휴장일에도 접수된다 — 라우트 SEC 요청 하루 약 3~5건).
  # 날짜파일은 ET 날짜(YYYY-MM-DD)를 쓴다, 호출했으면 성공·실패 무관 기록(T-036) — 하루 1회. 08시(ET) 내내 러너가 꺼져 있었으면 그날은 건너뛴다.
  # 🔴 같은 틱에 peek 가 돌았으면(PEEK_RAN_LABEL — 해외 21시(EDT)·22시(EST) peek 슬롯이 이 시각과 겹친다) 다음 틱으로 미룬다(yield_tick, 날짜파일 안 씀).
  # 하트비트 최악: 이 호출 curl 상한 HP_CURL_MAX_TIME 90초(라우트 자체 예산 약 60초) + 매 분 잡 약 30초 + sleep 60 = 약 180초 < 300초.
  #   21·22시(KST)에는 다른 하루 1회 블록이 없다(peek 는 위 규칙으로 다른 틱).
  # 스위치 holdings_premarket_enabled 가 없거나 true 가 아니면 라우트가 SEC 를 부르지 않고 바로 끝난다.
  HP_CURL_MAX_TIME=90
  HP_ET=$(TZ=America/New_York date '+%F %H %u %Z')
  read -r HP_ET_DATE HP_ET_HH HP_ET_DOW HP_ET_ZONE <<< "$HP_ET"
  LAST_HP=$(cat "$HOLDINGS_PREMARKET_LAST_RUN_FILE" 2>/dev/null || echo "")
  case "${HP_ET_ZONE:-}" in EDT|EST) HP_TZ_OK=1 ;; *) HP_TZ_OK=0 ;; esac
  case "${HP_ET_DOW:-}" in [1-5]) HP_WEEKDAY=1 ;; *) HP_WEEKDAY=0 ;; esac
  if [ "$HP_TZ_OK" = "1" ] && [ "$HP_WEEKDAY" = "1" ] && [ "${HP_ET_HH:-}" = "08" ] && [ "$LAST_HP" != "$HP_ET_DATE" ]; then
    if [ -n "$PEEK_RAN_LABEL" ]; then
      echo "[$(date '+%F %T')] holdings-premarket yield_tick — $PEEK_RAN_LABEL 가 이 틱에 돌아 다음 틱으로 미룸"
    else
      CALL_MAX_TIME="$HP_CURL_MAX_TIME"   # 이 호출에만 시간 상한
      call "/api/cron/holdings-premarket" "holdings-premarket"
      CALL_MAX_TIME=""
      echo "$HP_ET_DATE" > "$HOLDINGS_PREMARKET_LAST_RUN_FILE"   # 성공·실패 무관 기록(ET 날짜)
    fi
  fi
  # <<< holdings-premarket
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
  jrl_flush "${JRL_TICK_T0:-}" 2>/dev/null || true   # T-112 jrl
  i=$(( (i + 1) % 1440 ))   # 24h 사이클
  sleep 60
done
