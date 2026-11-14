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
#  - stop-alert        : 1분 — 손절가 도달 텔레그램 알림 (T-068, 알림만, curl 상한 STOP_ALERT_CURL_MAX_TIME).
#                        기본은 **메인 루프가 아니라 알림 티커 자식이 분 경계마다 호출한다**(T-147 — 아래 alert-ticker 블록).
#                        장중 긴 틱(실측 틱 주기 max 412초 · 틱 길이 max 352초, 3,119틱)에 이 알림이 함께 굶지 않게 떼어낸 것이고,
#                        주문·시그널 잡은 메인 루프 그대로다. 티커를 띄울 수 없거나 티커가 죽으면 메인 루프가 매 틱 직접 부른다
#                        (fail-open — `# >>> stop-alert-fallback` 블록). 호출자는 플래그 `ALERT_TICKER_ACTIVE` 로 **항상 하나**다.
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
#  - daily-bars-kr     : 매일 18:10~18:54 KST 첫 틱 — 국내 일봉 저녁 증분 수집 (T-170, 같은 라우트에 ?market=KR = 국내 보유·시그널
#                        종목만, 그날 15:40 확정 봉). 하루 1회(성공·실패 무관 날짜파일), 재시도 없음, curl 상한 DAILY_BARS_CURL_MAX_TIME.
#                        해외 peek 가 같은 틱에 돌면 다음 틱으로 미루고, 18:55 이후에는 부르지 않는다(로그 한 줄). T-104 가 흡수한다(J8).

set -u
PROJECT_DIR="${PROJECT_DIR:-/home/brownjeon/NFS/homes/brownjeon/project/StockInvest}"
BASE_URL="${BASE_URL:-http://localhost:3003}"
CRON_SECRET=$(grep '^CRON_SECRET=' "$PROJECT_DIR/.env" | cut -d= -f2-)

if [ -z "$CRON_SECRET" ]; then
  echo "[cron-runner] CRON_SECRET not set in .env — exiting"
  exit 1
fi

# >>> call-body-tmp (T-135) — call() 의 응답 본문 임시 파일. scripts/test-cron-runner-job-run-log.sh J12(동작)·J13(정적)이 시험한다
# 왜: 예전 call() 은 응답 본문을 /tmp/cron-runner-<pid>.out 에 umask 기본값(보통 022 → 644, 다른 사용자가 읽을 수 있음)으로 썼다. 그 파일은 호출 동안
#   (수 초~수십 초) 남고, 금액을 싣는 라우트(portfolio-snapshot·trade-report)의 **마스킹 전** 원문이 들어간다(T-127 은 스풀만 마스킹·0600 으로 했다).
#   응답이 200 이 아니면 그 원문 앞 200바이트가 러너 로그(pm2 로그)에도 그대로 찍혔다.
# 무엇:
#   - 본문 파일은 전용 디렉터리 CALL_TMP_DIR(로컬 디스크 ~/.node-local/stockinvest/call-tmp, 0700)에 mktemp 로 만든다 — **생성 시점부터 0600**,
#     이름은 cron-runner-<러너 pid>.<무작위 6자>(예측 불가 — 같은 이름을 미리 만들어 두는 공격이 안 된다). 만들 때만 umask 077 — call_tmp_open
#     안에서만 바꾸고 curl 앞에서 되돌린다(러너 전체 umask·잡 curl 이 보는 umask 는 그대로, 서브셸로 감싸지 않는다 — T-127 과 같은 방식).
#   - mktemp 가 실패하면(디렉터리를 못 만듦·디스크 가득) 예전 이름 /tmp/cron-runner-<pid>.out 을 umask 077 아래 미리 만들어(0600) 쓴다. 그것도 못 만들면
#     curl 이 예전처럼 그 이름에 쓴다 — **본문 파일 실패가 잡 호출·응답 코드를 바꾸지 않는 것**이 우선이다(예전과 같은 결과).
#   - 경로는 CALL_BODY_FILE 에 둔다 — call() 의 curl·로그 줄·rm 과 jrl_hook(스풀 본문)이 같은 변수를 읽는다. 정상 반환 뒤 잔존 0(call() 의 마지막
#     rm — call() 의 반환값은 예전처럼 그 rm 이다).
#   - 비-200 로그 줄 body= 는 jrl_mask_money(job-run-log-spool 블록)로 금액 키 값 0·detail "" 로 바꾼 **뒤** 앞 200바이트(모든 라벨). 마스킹 입력은
#     앞 2048바이트로 자른다(sed 가 한 줄짜리 큰 본문을 통째로 메모리에 올리지 않게 — 스풀 후크와 같은 크기). 마스킹이 실패하면 body= 가 빈다(원문 없음).
# 잔존이 쌓이지 않게(러너가 호출 도중 죽는 경우 — pm2 재시작·배포 컷오버·HOME-SERVER 순찰의 restart) **시작할 때 정리**를 골랐다:
#   러너가 시작할 때(call_tmp_init) CALL_TMP_DIR 안의 cron-runner-<pid>.* 중 **그 pid 의 프로세스가 없는** 파일만 지운다. 그래서 남는 것은 "방금 죽은
#   러너 몫" 하나뿐이고 다음 시작에 사라진다(누적 없음). 살아 있는 pid 의 파일은 둔다 — 배포 때 옛 러너와 새 러너가 1~3초 겹치면 옛 러너가 아직 쓰는 중이다.
#   다른 방법을 고르지 않은 이유: trap 은 쓸 수 없다(bash 는 전경 curl 이 끝날 때까지 트랩을 미루고 pm2 는 kill_timeout(설정 없음 = 기본 1.6초) 뒤 SIGKILL 이다 — 게다가 트랩을 걸면
#   TERM 에 바로 죽던 러너의 동작이 바뀐다). pid 없는 고정 이름은 겹친 두 러너가 같은 파일을 덮어써 본문이 섞인다. 0700 디렉터리만으로는 쌓이는 것을
#   막지 못한다 → 0700 디렉터리(남이 못 읽음) + mktemp 0600(생성 시점부터) + 시작 시 정리(쌓이지 않음)를 같이 쓴다. /tmp 대신 전용 디렉터리인 이유:
#   정리 대상을 이 러너의 파일로만 좁히려고(/tmp/cron-runner-* 는 같은 사용자의 다른 러너 — 예 TradingInvest — 와 이름이 겹칠 수 있다).
# 하트비트: call() 마다 umask 읽기·mktemp(서브셸 2개, 수 ms) — job-run-log-spool 블록의 후크 몫(call() 당 5~15ms)과 같은 크기라 그 블록 290.2초
#   계산의 남은 여유(약 10초) 안이다. 시작 시 정리는 러너 시작에 한 번(파일 몇 개)이라 틱에 들지 않는다.
CALL_TMP_DIR="${CALL_TMP_DIR:-${HOME}/.node-local/stockinvest/call-tmp}"
CALL_BODY_FILE=""
# call_tmp_init — 러너 시작에 한 번: 디렉터리를 0700 으로 만들고(이미 있으면 0700 으로 맞추고) 죽은 러너가 남긴 본문 파일을 지운다. 반환은 항상 0, 출력 없음.
call_tmp_init() {
  local d="${CALL_TMP_DIR:-}" f p
  [ -n "$d" ] || return 0
  { mkdir -p "$d" && chmod 700 "$d"; } 2>/dev/null || return 0
  for f in "$d"/cron-runner-*; do
    [ -f "$f" ] || continue
    p="${f##*/cron-runner-}"; p="${p%%.*}"
    case "$p" in ''|*[!0-9]*) continue ;; esac   # 이 러너가 만든 이름이 아니면 건드리지 않는다
    [ "$p" = "$$" ] && continue
    kill -0 "$p" 2>/dev/null && continue          # 살아 있는 러너(배포 겹침)가 쓰는 중 — 둔다
    rm -f "$f" 2>/dev/null
  done
  return 0
}
# call_tmp_open — 이번 호출의 본문 파일을 0600 으로 만들고 경로를 CALL_BODY_FILE 에 둔다. 반환은 항상 0, 출력 없음.
#   umask 077 은 이 함수 안에서만 — 맨 끝 한 곳에서 되돌린다. 현재 umask 를 읽지 못하면 바꾸지 않는다(되돌릴 값이 없으면 077 이 러너 전체로 새므로).
#   ⚠ 알려진 한계(T-147 감사 R-6, 고치지 않고 남긴다): 정상 경로의 `mktemp` 이름에는 `$$`(부모 pid) + 6자 난수가 들어가 부모와
#     stop-alert 티커 자식이 동시에 호출해도 겹치지 않는다. 그런데 **mktemp 가 실패하는 열화 상태**에서는 폴백 경로가
#     `/tmp/cron-runner-$$.out` 하나뿐이고 `$$` 가 서브셸에서도 부모 pid 라, 부모와 티커가 **같은 파일을 공유**한다
#     (한쪽의 `rm` 이 다른 쪽 본문을 지울 수 있다). 영향은 **로그에 찍히는 응답 본문과 스풀 본문뿐**이고 HTTP 응답 코드·
#     호출 성공 판정·주문 경로는 바뀌지 않는다. 「열화의 열화」라 확률이 극히 낮아 고치지 않았다.
#     ⚠ 비용이 어디인지 정확히 적는다: 이 줄은 `# >>> call-body-tmp` 블록 **안**이라 `no_t135()` 가 통째로 지우므로
#     기준 ref 대조(daily-bars D6 · job-run-log J8)와 `call()` 본문 해시는 **움직이지 않는다**. 실제로 걸리는 것은
#     `scripts/test-cron-runner-job-run-log.sh` J13 이 이 경로 문자열을 **그대로 핀으로 박아 둔 것**이다(폴백 줄 1개 ·
#     주석 제외 실행 줄 1개). 고칠 때는 폴백 이름에 `${BASHPID:-$$}` 를 더해 부모·자식을 가르고 J13 의 그 두 핀을 같이 고친다.
call_tmp_open() {
  local um=""
  um=$(umask 2>/dev/null)
  case "$um" in [0-7][0-7][0-7]|[0-7][0-7][0-7][0-7]) umask 077 2>/dev/null || um="" ;; *) um="" ;; esac
  CALL_BODY_FILE=$(mktemp "${CALL_TMP_DIR:-/nonexistent}/cron-runner-$$.XXXXXX" 2>/dev/null) || CALL_BODY_FILE=""
  if [ -z "$CALL_BODY_FILE" ]; then
    CALL_BODY_FILE="/tmp/cron-runner-$$.out"
    { rm -f "$CALL_BODY_FILE" && : > "$CALL_BODY_FILE"; } 2>/dev/null || true
  fi
  [ -z "$um" ] || umask "$um" 2>/dev/null || true
  return 0
}
call_tmp_init
# <<< call-body-tmp

# (T-112) 아래 `# T-112 jrl` 표지 두 줄은 실행·상태 기록 후크다(job-run-log-spool 블록). 시작 시각을 재고, 로그 줄을 쓴 뒤·임시 본문 파일을 지우기
#   전에 스풀에 한 줄을 남긴다. code·CALL_LAST_CODE·본문 파일·반환값(마지막 rm)은 바꾸지 않는다. 후크 함수가 없어도(블록만 잘라 시험) 무해하다.
# (T-135) 본문 파일은 call-body-tmp 블록이 만든다 — `# T-135` 표지 줄 1개(call_tmp_open)와 경로를 CALL_BODY_FILE 로 바꾼 세 줄(curl -o·로그 body=·rm),
#   비-200 로그 body= 는 금액 마스킹 뒤 앞 200바이트. 그 밖의 줄(curl 인자·--max-time·CALL_LAST_CODE·로그 형식·후크 자리·반환값)은 그대로다.
call() {
  local path="$1"
  local label="$2"
  local body="${3:-{}}"
  local code curl_exit=0
  local jrl_t0; jrl_t0=$(jrl_now_ms 2>/dev/null)   # T-112 jrl
  call_tmp_open   # T-135
  # (T-062 Codex C2 ②) CALL_MAX_TIME 이 비어 있지 않을 때만 --max-time 을 붙인다 — 지금은 해외 post-market 호출만 쓴다.
  # 비어 있으면 아래 curl 명령은 예전과 같다(다른 모든 잡 불변).
  code=$(curl -s ${CALL_MAX_TIME:+--max-time "$CALL_MAX_TIME"} -o "$CALL_BODY_FILE" -w "%{http_code}" -X POST \
    -H "x-cron-secret: $CRON_SECRET" -H 'Content-Type: application/json' \
    "$BASE_URL$path" -d "$body" 2>/dev/null) || { curl_exit=$?; code="000"; }
  CALL_LAST_CODE="$code"   # (T-062) 응답 코드를 보는 잡(post-market-overseas)만 읽는다. 다른 잡의 동작은 그대로다.
  local ts; ts=$(date '+%F %T')
  if [ "$code" = "200" ]; then
    echo "[$ts] $label OK"
  elif [ "$label" = "m40-forward" ] && [ "$path" = "/api/cron/m40-forward" ] && [ "$code" = "202" ]; then
    echo "[$ts] $label ACCEPTED completed=false"
  else
    echo "[$ts] $label HTTP=$code body=$(head -c 2048 "$CALL_BODY_FILE" 2>/dev/null | jrl_mask_money 2>/dev/null | head -c 200)"
  fi
  jrl_hook "$label" "$path" "$code" "${jrl_t0:-}" "$curl_exit" 2>/dev/null || true   # T-112 jrl
  rm -f "$CALL_BODY_FILE"
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
# (T-062 Codex C2 ②) 해외 post-market 호출 한 번의 curl 전체 시간 상한(초). 아래 계산은 **하트비트가 tick 시작에만 쓰인다는 가정**에서
# 한 것이다 — 기본 모드에서는 틱 끝에도 한 번 더 쓰므로(아래 `# >>> heartbeat-refresh` 블록) 실제 나이는 이보다 작다.
# 즉 아래 수치는 보수적 과대 추정이고, 그래서 결론(상한 120 은 안전, 240 은 아니다)은 그대로 유효하다. 하트비트 나이의 최악은
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
# (T-143 WP-A) 해외 분석 대상 월간 산출 호출 한 번의 curl 시간 상한(초). 라우트 자체 예산이 100초라 네트워크 여유를 더해 120 이다.
UNIVERSE_CURL_MAX_TIME=120
# (T-145 ⑨) KIS 해외 현재가상세 스냅샷 호출 한 번의 curl 전체 시간 상한(초). **전에는 상한이 없었다** —
# 라우트에 마감도 없어 대상 종목 수에 비례해 한 호출이 길어졌고(2026-10-29 운영 실측 156초), 자동 목록을 켜
# 대상이 +30~50 늘면 그 틱이 300초(순찰 재시작 기준)를 넘는다. 라우트 자체 마감은 90초(`SNAPSHOT_DEFAULT_BUDGET_MS`)이고
# 그 앞의 대상·오늘 수집분 조회와 마지막 종목의 왕복이 더 걸릴 수 있어 여유를 둔 값이다.
# 하트비트 최악(08:30~08:55 창의 한 틱): 110 + stop-alert 20 + 매 분 잡 약 30 + sleep 60 = 약 220초 < 300초.
# 상한에 걸리면 curl 이 000 으로 끝나지만 서버 쪽 upsert 는 끝난 종목까지 남고, 창의 다음 틱이 **DB 로 이어받는다**.
KIS_FUND_CURL_MAX_TIME=110
# (T-145 ⑨) 이 틱이 이미 이만큼(초) 지났으면 스냅샷은 이번 틱을 건너뛰고 창의 다음 틱에 넘긴다.
# 왜: post-market-overseas 는 하루 3회까지 10분 간격으로 재시도하므로(pmo_due) 러너가 08:2x 에 재기동되면 그 재시도가
# 창(08:30~08:55) 안으로 들어올 수 있다. 그러면 pmo 120 + 스냅샷 110 + 매 분 잡 50 + sleep 60 = 340초로 순찰 한도를 넘는다.
# 창이 26틱이라 한 틱 미루는 비용은 없다(`broker-fills`·`daily-bars` 가 07시 틱에 쓰는 yield 규칙과 같은 뜻이다).
KIS_FUND_TICK_YIELD_SEC=60
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
#   (T-127 ⑤) 실패 줄에는 응답의 사유 분류어를 `reason=<낱말>` 로 덧붙인다 — 응답 본문에서 "reason"(없으면 "error") 값만, 영소문자·숫자·밑줄
#   48자 이하일 때만 뽑는다(허용 문자만 남으니 개행·제어문자·ANSI 로 로그 줄을 꾸밀 수 없다). 본문 원문은 적지 않는다 — 라우트 503 본문은
#   키 순서상 reason 이 약 100자 뒤에 있어 "앞 N자"로는 사유가 안 보인다. HTTP=000(응답 없음)이면 예전 줄 그대로.
# (T-127 ①) 금액 값 마스킹: 금액·잔액·손익을 싣는 라벨 두 개(portfolio-snapshot — totalKRW·cash.KRW·cash.USD, 보류 사유 detail 에 USD 예수금,
#   drawdown.detail 에 원화 금액·소실 종목 코드 / trade-report — headerPnlKRW·lifoPnlKRW)는 base64 전에 jrl_mask_money 로 금액 키 값을 0, detail 문자열을
#   "" 로 바꾼다. ok·skipped·partial·reason·status·error 같은 분류 신호와 JSON 구조는 그대로라 앱의 분류(classifyRun)·슬롯 표는 바뀌지 않는다
#   (본문을 통째로 빼면 portfolio-snapshot 의 skipped 신호가 사라져 상태가 전부 ok 가 된다 — 그래서 생략이 아니라 마스킹). 마스킹이 실패하면
#   본문 칸을 비운다(원문을 싣지 않는다). 같은 원문은 call() 의 임시 본문 파일에 잠깐 있다(그 파일은 이 블록 밖 — 바꾸지 않는다).
#   (T-135) 그 파일은 이제 0700 디렉터리 안에 mktemp 0600 으로 생기고(call-body-tmp 블록), 후크는 경로를 CALL_BODY_FILE 로 읽는다(예전 고정 경로 대신).
# (T-127 ②) 스풀 파일 0600: jrl_hook·jrl_flush 안에서만 umask 를 077 로 두고 끝에서 원래 값으로 되돌린다 — 스풀·.fold·.sending·.cap·.batch·.rest·.resp
#   가 600 으로 생긴다. 러너 전체 umask·디렉터리 권한은 바꾸지 않는다(하트비트·날짜파일은 예전 권한 그대로 — T-037 워치독·순찰이 읽는다).
#   서브셸로 감싸지 않는다(JRL_FAILING 상태가 서브셸에서 사라져 실패 로그가 매 분 찍힌다). 현재 umask 를 읽지 못하면 바꾸지 않는다(되돌릴 값이
#   없으면 077 이 러너 전체로 새므로). 배포 전에 이미 있던 644 파일은 다음 접기·전송 성공 때 새 파일로 바뀌며 600 이 된다.
#   추가 비용: 후크·전송마다 umask 읽기(서브셸 1개), 두 라벨만 sed 1번 — 수 ms 라 아래 하트비트 계산의 후크 몫(call() 당 5~15ms) 안이다.
# 상한: 보낼 파일이 2MiB 를 넘으면 오래된 줄부터 버려 1MiB 로 줄이고 로그 한 줄 — 앱이 오래 죽어 있어도 디스크가 차지 않는다.
# 하트비트 최악(T-037 워치독·HOME-SERVER 순찰 300초 — 틱 시작 기록만 세어 최악 = 틱 길이 + sleep 60. 기본 모드는 틱 끝에도
#   한 번 더 쓰므로 실제 나이는 이보다 작다 — 아래 `# >>> heartbeat-refresh` 블록. 따라서 이 계산은 보수적 과대 추정이다):
#   - 전송하는 틱: 틱 경과 < 150초 + 전송 curl 상한 3초 + 로컬 처리(수 ms) + sleep 60 ≈ 213초 < 300초.
#   - 전송하지 않는 틱(경과 ≥ 150초 — 08시·06시 ingest·07:40 daily-bars 같은 무거운 틱): 기존 최악 290초(08시: 해외 분석 120 + KIS 스냅샷 60 +
#     매 분 잡 30 + stop-alert 20 + sleep 60) + 후크(call() 마다 date 2번·head·base64·printf — 약 5~15ms × 그 틱의 call() 약 10번 ≈ 0.1~0.2초)
#     + 스풀 접기·상한 검사(수 ms) ≈ 290.2초 < 300초. 후크는 남은 10초 여유를 넘기지 않는다.
#   - export-llm-trainset(03시)은 call() 을 거치지 않아 기록되지 않는다(bash 스크립트를 직접 돌린다 — 초안 §0-6).
# 겹침: 배포 때 러너 두 개가 1~3초 겹칠 수 있다(설계서 §11 LOW). 한 줄(< 4KB) 덧붙이기는 섞이지 않고, 그 몇 초 동안 접기·전송이 겹치면 줄이 한 번 더
#   가거나(멱등) 드물게 한 줄 빠질 수 있다 — 기록 전용이라 허용.
#   (T-147) 겹침 출처가 하나 늘었다: **알림 티커 자식**(아래 alert-ticker 블록)이 분 경계마다 call() 을 돌려 이 스풀에 한 줄을 덧붙인다.
#   `>>` 는 O_APPEND 라 4KB 미만 한 줄은 섞이지 않지만, 부모의 jrl_flush 가 접는(`mv`) 순간과 겹치면 그 한 줄이 빠질 수 있다 — 위와 같은 이유로 허용.
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
# (T-127 ①) 표준입력(응답 본문 앞 2KB) → 금액 키 값 0 · detail 문자열 "" (표준출력). 바이트 단위(LC_ALL=C — 2KB 에서 잘린 UTF-8 반쪽도 그대로 통과).
#   1식: "totalKRW|KRW|USD|headerPnlKRW|lifoPnlKRW" 키 뒤의 숫자(음수·소수·지수, 2KB 에서 잘린 숫자 포함)를 0 으로(`\10` = 1번 묶음 + 글자 0).
#   2식: "detail" 키의 닫힌 문자열 값을 "" 로(이스케이프된 \" 는 문자열 안으로 본다). 3식: 2KB 에서 잘려 닫히지 않은 detail 문자열을 끝까지 지운다.
#   키 이름은 따옴표째 맞춰 찾는다 — 문자열 값 안의 같은 글자(\"KRW\" 처럼 이스케이프된 것)는 건드리지 않는다. 다른 키·값·순서·공백은 그대로다.
jrl_mask_money() {
  LC_ALL=C sed -E \
    -e 's/("(totalKRW|KRW|USD|headerPnlKRW|lifoPnlKRW)"[[:space:]]*:[[:space:]]*)-?[0-9][0-9.eE+-]*/\10/g' \
    -e 's/("detail"[[:space:]]*:[[:space:]]*")([^"\\]|\\.)*"/\1"/g' \
    -e 's/("detail"[[:space:]]*:[[:space:]]*")([^"\\]|\\.)*\\?$/\1/'
}
# jrl_hook LABEL PATH CODE T0_MS CURL_EXIT — call() 끝에서 스풀에 한 줄. 실패는 전부 삼킨다.
#   (T-127 ②) 스풀 0600 — 함수 안에서만 umask 077, 반환(맨 끝 하나)직전에 되돌린다. 앞의 이른 return 은 umask 를 바꾸기 전이다.
jrl_hook() {
  local label="${1:-}" path="${2:-}" hc="${3:-}" t0="${4:-}" t1="" b64="" b64_skip=0 f="${JRL_SPOOL_FILE:-}"
  local curl_exit="${5:-0}"
  local um=""
  [ -n "$f" ] || return 0
  um=$(umask 2>/dev/null)
  case "$um" in [0-7][0-7][0-7]|[0-7][0-7][0-7][0-7]) umask 077 2>/dev/null || um="" ;; *) um="" ;; esac
  t1=$(jrl_now_ms)
  case "$hc" in [0-9][0-9][0-9]) ;; *) hc=000 ;; esac
  case "$t0" in ''|*[!0-9]*) t0="$t1" ;; esac
  case "$label" in
    entry-watcher|holding-checker|stop-alert) [ "$hc" = "200" ] && b64_skip=1 ;;
  esac
  if [ "$b64_skip" = "1" ]; then
    # 성공 응답의 본문 대신 고정 마커만 남긴다. 제한에 걸린 본문과 파싱 실패는 근거 없음으로 처리한다.
    b64=$(head -c "$((JRL_BODY_MAX_BYTES + 1))" "${CALL_BODY_FILE:-}" 2>/dev/null | timeout -k 0.1s 0.25s node -e '
      try {
        const raw = require("node:fs").readFileSync(0);
        if (raw.length > Number(process.argv[1])) process.exit(0);
        const b = JSON.parse(raw);
        if (b?.ok === true && !b.skipped && !b.partial && !b.aborted && !b.error
            && (b.status == null || ["ok", "complete", "success"].includes(b.status))
            && (b.errors == null || (Array.isArray(b.errors) && b.errors.length === 0))
            && [b.failed, b.deferred, b.tickerFailed, b.fxRejected].every(n =>
              n == null || n === 0 || n === false || (Array.isArray(n) && n.length === 0))) {
          process.stdout.write(Buffer.from("{\"ok\":true}").toString("base64"));
        }
      } catch {}
    ' "$JRL_BODY_MAX_BYTES" 2>/dev/null) || b64=""
  fi
  # (T-127 ①) 금액을 싣는 두 라벨은 여기서 마스킹한 본문을 싣고, 아래 일반 경로(원문 base64)는 건너뛴다(b64_skip=1 = "아래 줄을 돌리지 않음").
  #   마스킹이 실패하면 원문이 아니라 빈 본문이 된다(파이프의 마지막 base64 가 빈 입력을 받는다).
  if [ "$hc" = "000" ] && [[ "$curl_exit" =~ ^[1-9][0-9]{0,2}$ ]]; then
    # v1 스풀 그대로. 응답이 끊긴 경우 본문 대신 curl의 종료 코드만 보낸다.
    b64=$(printf '{"curl_exit":%s}' "$curl_exit" | base64 -w0 2>/dev/null) || b64=""
    b64_skip=1
  else
    case "$label" in
      portfolio-snapshot|trade-report)
        b64=$(head -c "$JRL_BODY_MAX_BYTES" "${CALL_BODY_FILE:-}" 2>/dev/null | jrl_mask_money 2>/dev/null | base64 -w0 2>/dev/null) || b64=""
        b64_skip=1 ;;
    esac
  fi
  if [ "$b64_skip" = "0" ]; then
    b64=$(head -c "$JRL_BODY_MAX_BYTES" "${CALL_BODY_FILE:-}" 2>/dev/null | base64 -w0 2>/dev/null) || b64=""
  fi
  { printf 'v1\t%s\t%s\t%s\t%s\t%s\t%s\n' "$label" "$path" "$hc" "$t0" "$t1" "$b64" >> "$f"; } 2>/dev/null || true
  [ -z "$um" ] || umask "$um" 2>/dev/null || true
  return 0
}
# jrl_flush TICK_T0 — 틱 끝(sleep 60 앞). ① 새 줄을 보낼 파일(.sending)로 접는다 ② 크기 상한 ③ 틱 경과 < 150초면 최대 200줄 전송. 반환은 항상 0.
#   (T-127 ②) 본문(_jrl_flush_body)은 return 이 여러 곳이라 이 얇은 겉함수가 umask 를 077 로 두고, 본문이 어디서 끝나든 한 곳에서 되돌린다.
#   같은 셸에서 부르므로 본문이 바꾼 JRL_FAILING 은 그대로 남는다.
jrl_flush() {
  local um=""
  um=$(umask 2>/dev/null)
  case "$um" in [0-7][0-7][0-7]|[0-7][0-7][0-7][0-7]) umask 077 2>/dev/null || um="" ;; *) um="" ;; esac
  _jrl_flush_body "$@"
  [ -z "$um" ] || umask "$um" 2>/dev/null || true
  return 0
}
_jrl_flush_body() {
  local f="${JRL_SPOOL_FILE:-}" t0="${1:-}" s="" now="" el=0 sz=0 n=0 before=0 after=0 code=""
  local resp="" re='"(reason|error)":"([a-z][a-z0-9_]{0,47})"'
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
  code=$(curl -s --max-time "$JRL_FLUSH_CURL_MAX_TIME" -o "$s.resp" -w "%{http_code}" -X POST \
    -H "x-cron-secret: ${CRON_SECRET:-}" -H 'Content-Type: text/plain' \
    --data-binary @"$s.batch" "${BASE_URL:-}/api/cron/job-run-log" 2>/dev/null) || code="000"
  # (T-127 ⑤) 200·000 이 아니면 응답에서 사유 분류어 하나만 뽑는다(허용 문자만 — 위 블록 머리 주석). 응답 파일은 바로 지운다.
  if [ "$code" != "200" ] && [ "$code" != "000" ]; then
    resp=$(head -c 512 "$s.resp" 2>/dev/null) || resp=""
    if [[ "$resp" =~ $re ]]; then resp="${BASH_REMATCH[1]}=${BASH_REMATCH[2]}"; else resp=""; fi
  fi
  rm -f "$s.resp" 2>/dev/null
  if [ "$code" = "200" ]; then
    if { tail -n +$((n + 1)) "$s" > "$s.rest"; } 2>/dev/null && mv -f "$s.rest" "$s" 2>/dev/null; then
      [ -s "$s" ] || rm -f "$s" 2>/dev/null
    else
      rm -f "$s.rest" 2>/dev/null
    fi
    if [ -n "$JRL_FAILING" ]; then echo "[$(date '+%F %T')] job-run-log 전송 회복"; JRL_FAILING=""; fi
  elif [ -z "$JRL_FAILING" ]; then
    JRL_FAILING="$code"
    echo "[$(date '+%F %T')] job-run-log 전송 실패 HTTP=$code${resp:+ $resp} — 스풀에 남겨 다음 가벼운 틱에 다시 보냄(기록 전용, 잡 동작 무관)"
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
M40_FORWARD_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/m40-forward-last-date"  # T-156 isolated paper evaluation
# >>> m40-state-write
# Atomic reservation: failed disk writes cannot erase the last bounded attempt.
m40_state_write() {
  local destination="$1" value="$2" temporary=""
  [ ! -e "$destination" ] || [ -w "$destination" ] || return 1
  temporary=$(mktemp "${destination}.tmp.XXXXXX" 2>/dev/null) || return 1
  if printf '%s\n' "$value" > "$temporary" && mv -f -- "$temporary" "$destination" 2>/dev/null; then return 0; fi
  rm -f -- "$temporary" 2>/dev/null || true
  return 1
}
# <<< m40-state-write
RS_UPDATE_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/rs-update-last-date"
RESEARCH_DOMESTIC_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/research-cycle-domestic-last-date"
RESEARCH_OVERSEAS_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/research-cycle-overseas-last-date"
EDGAR_SYNC_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/edgar-sync-last-date"
KIS_FUNDAMENTALS_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/kis-fundamentals-snapshot-last-date"
BROKER_FILLS_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/broker-fills-last-date"   # (T-087 D1a)
DAILY_BARS_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/daily-bars-last-date"   # (T-117)
DAILY_BARS_KR_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/daily-bars-kr-last-date"   # (T-170) 국내 저녁 실행
HOLDINGS_PREMARKET_LAST_RUN_FILE="${HOME}/.node-local/stockinvest/holdings-premarket-last-date"   # (T-119) KST 가 아니라 ET 날짜를 쓴다
mkdir -p "$(dirname "$META_LAST_RUN_FILE")"

# (T-036) M4 뉴스 fetch용 AI_API_BASE/M4_ADMIN_TOKEN 플럼빙은 여기서 제거했다 —
# 이제 /api/cron/news-fetch 라우트가 process.env로 직접 읽는다. `.env`의 값 자체는
# 다른 코드(src/lib/rag/m4-kb.ts 등)도 쓰므로 그대로 둔다.

# >>> alert-ticker (T-147) — 손절 알림(stop-alert) 전용 60초 티커(자식 프로세스 1개). scripts/test-cron-runner-alert-ticker.sh 가 이 블록을 잘라 시험한다
# 왜: 아래 메인 루프는 **동기 호출의 직렬 사슬**이라, 장중 `strategy-eval` 한 번이 끝날 때까지 분당 잡이
#   전부 멈춘다 — 2026-11-03 운영 cron 로그 **3,119틱** 실측: 틱 **주기** mean 66.3초 · max 412초 · 300초 초과 12틱 /
#   틱 **길이** mean 6.4초 · max 352초 · 300초 초과 4틱. 같은 날 장중 `strategy-eval` 은 매회 53~297초(24회 합 3748초 = 그 구간의 37%)이고
#   `stop-alert` 사이 최장 간격이 297초였다. 그 사슬에서 **알림만 하는 잡 하나**를 떼어낸다.
#   ⏱ 위 `strategy-eval` 소요 수치는 **2026-11-03 T-148 평가 동시성 적용 전** 측정값이다 — 그 변경이 배포되면 값이 달라지므로
#     이 블록의 설계 근거(「긴 잡 하나가 분당 알림을 굶긴다」)로만 읽고, 현재 소요는 그때그때 `job_run_log` 로 확인한다.
#   ⚠ **왜 긴지는 여기서 추론하지 않는다 — 측정한 문서를 가리킨다.** 출처는 `agent-vault/10-Flow/tasks/T-148-strategy-eval-serial-fanout.md` §②
#     (장중 국내 평가 버스트 **50회 전수**, 2026-11-03 09:00~15:30 KST, 원천 `shared/logs/api-usage-2026-11-0{2,3}.jsonl`). 그 실측:
#       · 벽시계 median **136초**(mean 137 · min 53 · max 257) · in-flight 84% 이상이 20/51 회차
#       · 회차당 호출 수 — 그 문서 §② 표는 median **279**(min 267 · max 294)이고, **그 task 의 감사자 재집계는 263~265** 다
#         (두 값이 그 문서 안에 같이 있다. 아래 계산은 더 보수적인 쪽까지 포함해 범위로 적는다)
#       · **느린 버스트의 평균은 약 670ms/호출**(그 문서의 문장. 느린 **호출만** 골라 낸 평균이 아니라, 느린 버스트
#         **전체**의 호출당 평균이다)
#       · **이미 레이트 바운드(in-flight<30%)인 회차는 7회**, 그때 벽시계 median **55초**
#       · 결론(그 문서의 문장): **「루프는 레이트 바운드가 아니라 지연 바운드다」**
#     즉 유량 상한이 정하는 것은 **바닥**(호출수 ÷ 5/s ≈ 53~56초)이고, 관측 median 136초 중 그것으로 설명되는 몫은
#     **최대 39~41%** 다. 나머지는 동시성 없는 직렬 사슬에 **호출별 지연이 누적**된 것이다(위 670ms/호출·in-flight 비율이 그 근거다).
#   🔴 **그러므로 `system_config.kis_rate_limit_per_sec`(기본 5)를 올리는 것은 이 문제의 해법이 아니다.** 그 값을 올려도
#     내려가는 것은 바닥뿐이고 관측 median 을 만드는 지연은 그대로다. 더구나 `src/lib/exchanges/kis-throttle.ts:156` 이
#     **「초기값 5 req/s 는 검증되지 않은 추정치다. KIS 가 공표한 한도가 아니다」**라고 적어 두고, 그 값이 「순간 20~150건
#     동시 발사에서 나던 레이트 에러를 없애려고」 고른 안전측 값이라고 밝힌다 — 이 상한은 **주문 경로까지 같이 쓰는 유량**이라
#     근거 없이 올리면 실매매에 영향이 간다. 근본 해결은 아래 ⓓ(평가 루프 동시성 — T-148).
#     이 블록의 설계 근거는 「긴 잡 하나가 분당 알림을 굶긴다」 하나이고, **종목 수도 유량 상한도 그 근거가 아니다.**
#     평가 규모는 **150이 아니라 수십 종목대**다. ⚠ 정확한 분포는 **여기에 적지 않는다** — 로그가 쌓일 때마다 바뀌어
#     주석이 쓰는 순간부터 낡는다. 필요하면 그때 세어 본다:
#       `grep -o 'ran=[0-9]*' ~/apps/stockinvest/shared/logs/pm2-out.log | sort | uniq -c | sort -rn`
#     (`[cron/strategy-eval] ran=` 는 그 회차에 평가한 종목 수이고 시장 구분이 없다.)
# 왜 stop-alert 만: 이 잡은 주문·매도·시그널을 하지 않는다(시세 읽기 + 텔레그램 발송뿐 — 위 머리 주석 27행·라우트).
#   🔴 주문 잡을 옮기지 않는 이유는 **주문 직렬화가 러너에 걸려 있기 때문이 아니다**(T-149 정정). 주문 경로의 동시 실행은 DB 가 막는다:
#   ① 시그널당 이중 주문 — `src/lib/signals/entry-claim.ts` 의 조건부 UPDATE 선점(T-043). `affectedRows=1` 인 쪽만 송신하고 진 쪽은 claim_lost.
#   ② 일일 누적 한도 — check-then-act 가 **아니다**. `src/lib/safety/dry-run.ts` 가 송신 전에 `orders` 행을 `pending` 으로 **먼저 INSERT** 하고,
#      `src/lib/safety/order-limits.ts` 의 오늘 합산이 **타 주문의 `pending` 을 포함**한다(자기 행만 제외 — T-081 WP-B). 즉 예약 후 검사다.
#   ⚠ `src/lib/safety/order-sync.ts:1226-1227` 이 기각한 `SELECT … FOR UPDATE`·`GET_LOCK()` 은 **브로커 체결 내역 정산**
#      (`recordSettledFill`) 경로의 판단이다 — 그 기각을 「주문 송신이 직렬화되지 않는다」로 읽지 말 것. 실제로 한 번 그렇게 읽혀
#      이 자리에 틀린 근거가 들어왔으므로 경고로 남긴다.
#   그러면 왜 옮기지 않는가 — **옮겨서 상한을 거는 설계의 비용** 둘이 남기 때문이다: ⓐ curl 을 끊어도 **서버 쪽 라우트 처리는
#      계속 돈다** — 상한은 러너의 대기만 끝낼 뿐이고, 「끊었으니 안 돌 것」이라는 틀린 기대를 만든다 ⓑ 끊긴 호출이
#      `job_run_log` 에 HTTP 000 으로 쌓여 **실제 실패와 「클라이언트가 먼저 끊었을 뿐 서버는 성공」을 구분할 수 없게 된다**
#      (T-112 기록이 판단 근거라 그 오염이 비용이다).
#      ⚠ ⓐⓑ 는 「옮기면 안 되는 금지 사유」가 아니라 **옮길 때 치러야 하는 값**이다. T-147 이 실제로 한 것은
#      **알림만 분리하는 범위로 정한 것**이고(그 task 기록에 있는 사실), 주문 잡을 옮길지는 열린 문제다.
#   그래서 `entry-watcher`·`holding-checker`·`strategy-eval` 은 이 티커로 옮기지 않는다(그 셋은 메인 루프 그대로 — T-147 설계).
# 호출자는 하나여야 한다 — 🔴 이유는 **이중 발송이 아니라 「호출 횟수로 세는 규칙」**이다(T-149 정정).
#   이중 발송 쪽은 이미 세 겹으로 막혀 있다: ① 같은 Node 프로세스 안의 겹침은 라우트가 거른다
#   (`src/app/api/cron/stop-alert/route.ts:304-307` 의 `runningSince` → `skipped: in_progress`. `stockinvest` 는 pm2 `instances: 1`)
#   ② 발송 상태는 DB(`system_config.risk_stop_alert_state`)에 있다 ③ 재발송 가드가 프로세스 메모리 Map 에 있다
#   (`route.ts:62-71`, RESEND_GUARD_MS 10분 — 이것만은 check-then-act 이지만 ①이 앞서 거른다).
#   깨지는 것은 `src/lib/risk/stop-alert.ts` 의 **횟수 기반 규칙**이다: `rearmConfirm: 2`(재무장 연속 2회 확인)·
#   `retryMax: 3`(발송 실패 연속 3회)는 「호출 1회 = 1표」로 세므로, 호출자가 둘이면 분당 2표가 들어가 확인·대기가 **절반으로 줄어든다**.
#   → 그래서 플래그 **하나**(`ALERT_TICKER_ACTIVE`)가 호출자를 정한다: 1 이면 티커만, 0 이면 메인 루프만
#   (아래 `# >>> stop-alert-fallback` 블록). 두 값이 동시에 참일 수 없으니 호출자는 항상 정확히 하나다.
# 🔴 fail-open(T-147 Leader 보정 ①): `flock` 이 없거나 락 파일을 못 만들면 **티커를 띄우지 않고 ACTIVE=0 으로 두어 메인 루프가
#   예전처럼 매 틱 직접 부른다.** 처음 구현은 그 경우 로그 한 줄만 남기고 아무도 부르지 않았다 — 안전장치의 fail-closed 가 아니라
#   **알림 소실**이다(T-147 이전에는 어떤 환경에서든 매 틱 돌았다). 최악의 경우는 "알림 없음"이 아니라 "T-147 이전 동작"이어야 한다.
# 🔴 부모의 감독(같은 보정 ①): 티커가 바쁜 루프 가드로 끝나거나 어떤 이유로든 죽으면, 감독이 없으면 **다음 재기동까지 손절 알림이
#   영구 정지**다. 메인 루프가 매 틱 `alert_ticker_alive` 로 확인하고 죽어 있으면 ACTIVE=0 으로 내려 그 틱부터 직접 부른다
#   (`kill -0` 이 성공하는 동안은 자식이 살아 있으니 두 호출자가 겹치지 않는다).
# ALERT_TICKER_DISABLE=1 (같은 보정 ②): **T-147 전체를 되돌린 레거시 모드** — 티커를 띄우지 않고(ACTIVE=0 → 메인 루프가 매 틱 호출)
#   아래 `# >>> heartbeat-refresh` 의 추가 쓰기도 건너뛴다. 기존 러너 시험 하네스 8개(`scripts/test-cron-runner-*.sh` 중 이 블록
#   전용 시험을 뺀 것들)가 **자기 기능의 회귀망**인데, 그 하네스들은 `sleep` 을 즉시 반환
#   ⚠ 이 주석에 **다른 잡의 라벨 이름을 적지 않는다** — 어떤 하네스는 「자기 블록을 지운 러너에 자기 잡 이름이 0건」을 단정하므로
#     설명하려고 이름만 적어도 그 시험이 깨진다(2026-11-03 실제로 한 번 깨뜨려 이 줄을 남긴다).
#   스텁으로 바꿔 가짜 시계를 밀기 때문에 티커 자식이 끼면 모든 일정이 1~3분 밀린다. 그 8개를 T-147 인식형으로 고치면 안전경로 시험
#   8개가 이 task 하나에 얽히므로, 대신 이 변수 한 줄로 **예전과 똑같이** 돌게 해 행동 단정을 수정 없이 통과시킨다.
#   ⚠ 시험 전용이다 — `.env.example`·`ecosystem.config.js`·운영 환경 어디에도 넣지 않는다(기동 로그에 모드를 눈에 띄게 남긴다).
# 겹침 방지: `flock -n` 전용 락 하나. 배포 컷오버 때 옛 러너와 새 러너가 1~3초 겹치는 창에서 **두 티커가 같은 분에 둘 다
#   호출하는 것**을 막는다 — 막으려는 것은 이중 발송이 아니라 위 「호출자는 하나여야 한다」의 **횟수 규칙**이 깨지는 것이다.
#   ⚠ flock 은 **상호배제이지 중복 제거가 아니다**: 한쪽 호출이 끝난 뒤 도착한 두 번째 티커는 락을 잡고 한 번 더 부른다(순차 2회).
#   락을 못 잡으면 **그 회차만 건너뛴다**(에러가 아니다 — 다음 분에 다시 시도). 락 파일은 하트비트·날짜파일과 같은 로컬 디스크
#   디렉터리에 둔다(~/.node-local/stockinvest — NFS 가 아니다. 위 `mkdir -p "$(dirname "$META_LAST_RUN_FILE")"` 가 이 디렉터리를 보장한다).
#   락은 inode 에 걸리므로 겹친 두 러너가 같은 경로를 쓰면 서로 보인다(`: >` 는 내용만 비우고 inode 를 바꾸지 않는다).
# 🔴 고아 방지: pm2 가 부모만 죽이고 자식이 남으면 **중지된 러너의 티커가 계속 손절 알림을 보낸다**(눈에 보이지 않는 좀비).
#   매 회차 깨어날 때 부모 pid 를 `kill -0` 으로 확인하고 없으면 자식이 스스로 끝낸다(부모가 자는 동안 죽으면 최대 60초 늦게 끝난다).
#   `trap` 은 쓰지 않는다 — bash 는 전경 curl 이 끝날 때까지 트랩을 미루고 pm2 는 kill_timeout(설정 없음 = 기본 1.6초) 뒤 SIGKILL 이다
#   (위 call-body-tmp 블록 69행과 같은 근거). 그래서 "부모 확인"은 신호가 아니라 **회차마다 묻는 방식**이다.
# CALL_MAX_TIME: 자식 안에서만 STOP_ALERT_CURL_MAX_TIME(20) 으로 세팅한다. `alert_ticker_loop &` 는 서브셸이므로 그 대입이
#   **부모의 CALL_MAX_TIME 에 영향을 주지 않는다**(메인 루프의 다른 잡에 상한이 새지 않는다 — 시험 ⑤). 그래서 호출 뒤 되돌리는 줄이 없다.
# 바쁜 루프 방지: 한 회차가 실제로 최소 ALERT_TICKER_MIN_CYCLE_SEC 초는 걸려야 호출한다. 판정은 bash 내장 `SECONDS`(실시간 — 외부
#   `date` 를 거치지 않는다)로 하고, 짧은 회차가 연속 ALERT_TICKER_MAX_FAST_CYCLES 번이면 로그 한 줄을 남기고 티커를 끝낸다.
#   `sleep` 이 즉시 돌아오는 환경(시험 하네스의 즉시 반환 스텁·sleep 파손)에서 알림 라우트를 초당 수십 번 때리는 것을 막는다. 운영에서는
#   한 회차가 약 60초라 이 가드가 발동하지 않는다. 티커가 끝나면 **부모의 감독이 그것을 보고 메인 루프가 호출을 이어받는다**(위 보정 ①).
# 기록: 자식의 call() 도 jrl_hook 을 거쳐 스풀에 한 줄을 덧붙인다(O_APPEND · 4KB 미만이라 줄이 섞이지 않는다). 부모의 jrl_flush 가
#   접는 순간과 겹치면 드물게 한 줄이 빠질 수 있다 — 기록 전용이라 허용(위 job-run-log-spool 블록 「겹침」 주석에 T-147 로 덧붙였다).
ALERT_TICKER_LOCK_FILE="${ALERT_TICKER_LOCK_FILE:-${HOME}/.node-local/stockinvest/stop-alert.lock}"
ALERT_TICKER_PARENT_PID=$$
ALERT_TICKER_MIN_CYCLE_SEC=5
ALERT_TICKER_MAX_FAST_CYCLES=3
ALERT_TICKER_LOCK_BUSY_RC=1    # `flock -n` 이 「이미 점유」로 끝낼 때의 종료 코드(위 alert_ticker_once 주석의 측정값)
ALERT_TICKER_MAX_LOCK_SKIPS=3  # 경합으로 연속 이만큼 건너뛰면 경고 한 줄(한 번만). 호출자는 늘리지 않는다
ALERT_TICKER_DISABLE="${ALERT_TICKER_DISABLE:-}"   # 1 = 레거시 모드(T-147 이전 동작). 시험 전용 — 운영에 넣지 않는다
ALERT_TICKER_ACTIVE=0   # 유일한 호출자 플래그. 1 = 티커가 부른다 / 0 = 메인 루프가 부른다. 기동 시 정하고, 감독이 1 → 0 으로만 내린다
ALERT_TICKER_PID=""
# alert_ticker_wait_sec — 다음 분 경계까지 남은 초(1~60). 시각을 읽을 수 없거나 계산이 범위를 벗어나면 60.
alert_ticker_wait_sec() {
  local now="" rem=60
  now=$(date +%s 2>/dev/null)
  case "$now" in ''|*[!0-9]*) printf '60'; return 0 ;; esac
  rem=$((60 - now % 60))
  [ "$rem" -ge 1 ] && [ "$rem" -le 60 ] || rem=60
  printf '%s' "$rem"
}
# alert_ticker_once — 이 회차 1회분. 락을 잡은 동안만 stop-alert 를 부른다. 반환: 0 = 불렀다 / 1 = **경합**으로 건너뜀 / 2 = **진짜 오류**.
#   락은 **회차마다 열고 닫는다** — fd 를 티커 수명 동안 열어 두면 한 번 잡은 락이 끝까지 유지돼, 겹친 옛 티커가 락을 쥔 채
#   새 티커를 영구히 굶긴다. 락 파일을 열 수 없으면(리다이렉션 실패) 그룹이 돌지 않아 `rc` 가 초기값(255)으로 남고 2 가 된다.
#   bash 가 그 이유를 로그에 적는 것을 `2>/dev/null` 로 덮지 않는다(알림이 조용히 멈추는 것보다 시끄러운 쪽이 낫다).
# 🔴 왜 경합과 오류를 가르나(T-147 Leader 보정): `flock -n` 실패의 원인이 둘이고 올바른 응답이 **서로 다르다**.
#   - **경합**(겹친 옛 러너의 티커가 락을 쥠): 그 티커가 **지금 알림을 보내고 있다** → 이 회차만 건너뛰는 게 맞다(알림은 멈추지 않았다).
#     호출자를 늘리면 횟수 기반 규칙(`rearmConfirm`·`retryMax`)이 분당 2표를 세어 확인·대기가 절반이 된다(위 「호출자는 하나여야 한다」).
#   - **진짜 오류**(락 파일을 열 수 없음·flock 자체 오류·flock 없음): 다른 티커가 없으니 알림이 **정말 멈춘다**. 그리고 이 경우
#     두 번째 호출자가 존재하지 않으므로 메인 루프로 넘겨도 **이중 발송 위험이 구조적으로 없다** → 티커를 끝내 감독이 넘기게 한다.
#   측정(2026-11-03 서버 `flock from util-linux 2.37.2`, `/tmp/t147-flockrc.sh`): 다른 프로세스 점유 = **1** · 공유락 점유 중 배타락 = 1 ·
#   fd 9 가 열려 있지 않음 = **65** · `flock` 없음(셸) = 127 · 디렉터리 fd = 0. 즉 **구조적 오류는 1 이 아니다**.
#   독립 재측정(2026-11-03 T-147 reviewer, 같은 util-linux 2.37.2): **자유 락은 쓰기 fd(`9>`) 0 · 읽기전용 fd(`9<`) 도 0** ·
#     경합은 쓰기·읽기 fd 모두 1 · fd 미개방 65 · 락 파일 열기 실패는 그룹이 돌지 않아 초기값 255. 즉 **1 은 경합에서만 나온다.**
#   전제: 이 코드는 락 fd 를 **항상 `9>`(쓰기)로** 연다(아래 `} 9>"$ALERT_TICKER_LOCK_FILE"`) — 측정도 그 조건에서 했다.
#     락을 지원하지 않는 파일시스템에서의 flock(2) 오류는 재현할 마운트가 없어 **측정하지 못했다**(위 ② 처럼 sysexits 코드로 끝날 것으로 본다).
#     다만 락 파일은 로컬 ext4(`df -T` 실측)라 그 경로 자체가 현재 구성에 없다.
alert_ticker_once() {
  local rc=255   # 리다이렉션(락 파일 열기)이 실패하면 아래 그룹이 돌지 않아 이 값이 남는다 → 진짜 오류
  { flock -n 9; rc=$?
    if [ "$rc" = "0" ]; then
      CALL_MAX_TIME="$STOP_ALERT_CURL_MAX_TIME"
      call /api/cron/stop-alert "stop-alert"
    fi
  } 9>"$ALERT_TICKER_LOCK_FILE"
  case "$rc" in
    0) return 0 ;;
    "$ALERT_TICKER_LOCK_BUSY_RC") return 1 ;;
    *) return 2 ;;
  esac
}
# alert_ticker_loop — 자식 본체. 분 경계까지 자고 → 부모 생존 확인 → 바쁜 루프 가드 → 1회 호출. 반환하면 자식이 끝난다.
alert_ticker_loop() {
  local w=60 fast=0 t0=0 lim=0 lockskip=0 rc=0 opp="" mypid=""
  while :; do
    t0=$SECONDS
    w=$(alert_ticker_wait_sec)
    sleep "$w" 2>/dev/null || true
    kill -0 "$ALERT_TICKER_PARENT_PID" 2>/dev/null || return 0
    # 🔴 위 한 줄은 **부모 pid 재사용**에 속는다(감독 쪽 ③과 대칭 — T-147 감사 R-1 이 양방향으로 지적했다). 부모가 죽으면 이 자식은
    #   init(또는 subreaper)로 재부모화돼 **자기 ppid 가 바뀐다**. 그래서 `kill -0` 이 성공해도 ppid 를 한 번 더 본다 — 그러지 않으면
    #   고아 티커가 계속 돌면서 새 러너의 티커와 함께 호출자가 둘이 되고, 위 「호출자는 하나여야 한다」의 횟수 규칙이 깨진다.
    #   `BASHPID` 는 이 서브셸 **자신**의 pid 다(`$$` 는 최초 셸 pid 라 여기서 못 쓴다). 정상 경로에서는 pm2 TreeKill 이 부모·자식을
    #   같이 죽이므로 이 줄이 쓰이는 일은 드물다. 읽을 수 없거나 값이 비면 **건너뛴다**(판정 재료가 없을 때 티커를 끝내지 않는다).
    #   🔴 `BASHPID` 를 **먼저 변수에 담는다** — `$( )` 안에서 전개하면 명령치환이 만든 **그 서브셸의** pid 가 나오고, 그 ppid 는
    #     러너가 아니라 이 티커라 **살아 있는 정상 티커가 스스로 종료**한다(신규 시험 E3 가 실제로 이 결함을 잡았다).
    #     감독 쪽(③)이 `$$` 를 쓸 수 있는 것은 `$$` 가 서브셸에서도 최초 셸 pid 를 유지하기 때문이고, `BASHPID` 는 그렇지 않다.
    #   외부 명령을 쓰지 않는다(bash 내장 `read` + 파라미터 확장). 이 자리는 **깨어난 뒤 호출 직전**이라 fork 를 늘리지 않는 쪽이
    #     낫다. 다만 효과를 과장하지 않는다 — 관측된 것은 이것뿐이다: `sed` 를 쓰던 판이 alert-ticker 하네스 8회 중 1회에서
    #     첫 호출이 `:01` 로 밀렸고(같은 러너 비교군 HEAD 는 그 라운드 0/8 · 다른 라운드 0/8), fork 를 없앤 뒤 0/8 이 됐다.
    #     ⚠ **1/8 과 0/8 은 통계적으로 갈리지 않는다.** 두 라운드를 0/16 으로 합치는 것도 **하네스 sha 가 달라 같은 조건이 아니다.**
    #     T-149 감사 측정으로는 회차당 오버헤드가 HEAD 15~19ms · 지금 판 18~19ms 로 사실상 같고, `sed` 한 번이 바꾸는 확률은
    #     **감사자 추정** 0.1~0.2%p 다(sed 비용 1~2ms 가정 — 측정값이 아니라 추정이다). `:00` 단정 자체가 HEAD 에도
    #     한 자리 % 의 기저 실패율을 갖는 것으로 **보인다**(같은 감사 측정, 역시 단정 아님).
    #     즉 「fork 가 원인이었다」가 아니라 **공짜로 없앨 수 있는 변수를 없앤 것**이다.
    #   파싱: `${opp##*") "}` 는 **탐욕**이어야 한다 — comm 에 `") "` 가 들 수 있어 비탐욕(`#`)은 거기서 멈춰 틀린다(실측).
    #   `2>/dev/null` 을 입력 리다이렉션 **앞**에 둔다 — 뒤에 두면 없는 pid 일 때 리다이렉션 실패 메시지가 stderr 로 샌다(실측).
    mypid="${BASHPID:-0}"
    if [ -r "/proc/$mypid/stat" ]; then
      opp=""
      read -r opp 2>/dev/null < "/proc/$mypid/stat" || opp=""
      if [ -n "$opp" ]; then
        opp=${opp##*") "}
        opp=${opp#* }; opp=${opp%% *}
        [ -n "$opp" ] && [ "$opp" != "$ALERT_TICKER_PARENT_PID" ] && return 0
      fi
    fi
    # 가드 기준은 min(요청한 대기, ALERT_TICKER_MIN_CYCLE_SEC) — 분 경계 직전에 티커가 시작되면 첫 회차의 정상 대기가
    # 1~4초일 수 있고(그때 w 가 그 값이다), 고정 5초로 재면 그 정상 회차를 「바쁜 루프」로 오인해 1분을 거른다.
    lim="$ALERT_TICKER_MIN_CYCLE_SEC"
    [ "$w" -lt "$lim" ] && lim="$w"
    if [ $((SECONDS - t0)) -lt "$lim" ]; then
      fast=$((fast + 1))
      if [ "$fast" -ge "$ALERT_TICKER_MAX_FAST_CYCLES" ]; then
        echo "[$(date '+%F %T')] stop-alert 티커 종료 — 대기(sleep ${w}초)가 실제로 돌지 않는다(바쁜 루프 방지). 메인 루프·다른 잡은 영향 없음"
        return 0
      fi
      continue
    fi
    fast=0
    # 반환 해석(위 alert_ticker_once 주석): 0 불렀다 / 1 경합 — 겹친 티커가 보내는 중이니 이 회차만 건너뛴다 / 그 밖 진짜 오류 → 끝낸다.
    #   경고는 연속 ALERT_TICKER_MAX_LOCK_SKIPS 번째 **한 번만** 찍는다(카운터는 계속 올라가므로 다시 같아지지 않는다 — 매 분 로그를 더럽히지 않는다).
    alert_ticker_once; rc=$?
    case "$rc" in
      0) lockskip=0 ;;
      1) lockskip=$((lockskip + 1))
         if [ "$lockskip" = "$ALERT_TICKER_MAX_LOCK_SKIPS" ]; then
           echo "[$(date '+%F %T')] stop-alert 티커가 ${lockskip}회 연속 락을 잡지 못했다(경합 — 겹친 러너의 티커가 쥐고 있고 알림은 그쪽이 보낸다). 러너가 둘 돌고 있지 않은지 확인하라. 이 경고는 한 번만 찍는다"
         fi ;;
      *) echo "[$(date '+%F %T')] 🔴 stop-alert 티커 종료 — 락을 쓸 수 없다(flock rc=$rc, 경합 아님: 락 파일을 열 수 없거나 flock 자체 오류). 다음 틱에 메인 루프가 호출을 이어받는다"
         return 0 ;;
    esac
  done
}
# alert_ticker_alive — 티커 자식이 아직 돌고 있는가(메인 루프의 감독이 매 틱 부른다). 0 = 살아 있음.
#   셋을 본다. 하나라도 아니면 1(죽었다)이고 감독이 그 틱부터 호출을 메인 루프로 되돌린다.
#   ① `kill -0` — 그 pid 에 신호를 보낼 수 있는가.
#   ② `/proc/<pid>/stat` 의 상태 문자가 `Z` 가 아닌가 — ①만으로는 **좀비**(부모가 아직 reap 하지 않은 종료 상태)를 살아 있다고 본다.
#      실측(2026-11-03 서버 bash 5.1.16): 비대화형 bash 는 SIGCHLD 로 배경 자식을 곧 reap 해서 `kill -0` 이 바로 실패했다 —
#      이 검사는 전경 curl 때문에 reap 이 미뤄진 짧은 창을 덮는 보조 장치다.
#   ③ 🔴 그 stat 의 **ppid 가 이 러너(`$$`)인가** — ①②는 **pid 재사용**에 속는다. 티커가 죽은 뒤 커널이 같은 번호를 무관한
#      프로세스에 다시 배정하면 ①이 성공해 감독이 영원히 내려가지 않고, 그러면 **손절 알림이 조용히 멈춘다**(티커는 죽었고
#      fallback 은 ACTIVE=1 이라 건너뛴다 — 아무도 부르지 않는다). 티커는 `alert_ticker_loop &` 로 띄운 **직계 자식**이라
#      ppid 는 항상 `$$` 다(`$$` 는 서브셸에서도 최초 셸의 pid 그대로여서 이 비교가 성립한다).
#      실측(T-149, 이 서버 — 이 함수만 떼어 ③ 있는 판과 없는 판을 같은 입력으로 비교): 진짜 직계 자식 → 둘 다 0(살아 있음) ·
#      **살아 있지만 이 셸의 자식이 아닌 pid → ③ 없는 판 0(오판) / ③ 있는 판 1** · 빈 PID·없는 pid → 둘 다 1.
#      (T-147 감사자는 같은 오판을 pm2 데몬 pid 로 확인했다 — R-1.)
#   /proc 을 읽을 수 없으면 ②③을 건너뛰고 ① 결과를 그대로 믿는다. ⚠ 이 폴백은 **안전한 쪽이 아니다** — ①만 믿어 `alive` 로
#     판정하면 ACTIVE 가 1 로 남아, 티커가 실제로 죽었다면 **아무도 부르지 않는다**(알림이 멈춘다). 그럼에도 이렇게 둔 이유는
#     반대로 매 틱 `gone` 으로 판정하면 더 나쁘다 — 감독은 티커를 **죽이지 않는다**. 살아 있는 티커를 그대로 둔 채 ACTIVE 를 0 으로
#     내리므로 **호출자가 둘이 되고**(티커 + 메인 루프), 위 「호출자는 하나여야 한다」의 횟수 규칙이 깨진다.
#     즉 「판정 재료가 없을 때는 기존 상태를 유지한다」는 선택이고, 리눅스에서 자기 프로세스의 `/proc` 을 못 읽는 경우는 사실상 없다.
alert_ticker_alive() {
  local rest="" st="" pp=""
  [ -n "$ALERT_TICKER_PID" ] || return 1
  kill -0 "$ALERT_TICKER_PID" 2>/dev/null || return 1
  if [ -r "/proc/$ALERT_TICKER_PID/stat" ]; then
    # 내장 `read` 로 읽는다(외부 명령 없음 — 자식 쪽과 같은 이유). comm 에 공백·괄호가 들 수 있어 **탐욕** `##` 로
    # 마지막 `") "` 까지 버린다 → 남은 첫 필드 = 상태, 둘째 = ppid. 비탐욕(`#`)은 comm 안의 `") "` 에서 멈춰 틀린다(실측).
    # `2>/dev/null` 은 입력 리다이렉션 **앞**이다(뒤에 두면 없는 pid 일 때 실패 메시지가 stderr 로 샌다 — 실측).
    read -r rest 2>/dev/null < "/proc/$ALERT_TICKER_PID/stat" || rest=""
    if [ -n "$rest" ]; then
      rest=${rest##*") "}
      st=${rest%% *}
      pp=${rest#* }; pp=${pp%% *}
      [ "$st" = "Z" ] && return 1
      [ -n "$pp" ] && [ "$pp" != "$$" ] && return 1
    fi
  fi
  return 0
}
if [ "$ALERT_TICKER_DISABLE" = "1" ]; then
  echo "[cron-runner] 🔶 ALERT_TICKER_DISABLE=1 — 레거시 모드(T-147 이전 동작): 티커 없음 · 메인 루프가 매 틱 stop-alert 호출 · 하트비트 추가 쓰기 없음. 시험 전용 설정이다"
elif command -v flock > /dev/null 2>&1 && : > "$ALERT_TICKER_LOCK_FILE" 2>/dev/null; then
  alert_ticker_loop &
  ALERT_TICKER_PID=$!
  ALERT_TICKER_ACTIVE=1
  echo "[cron-runner] stop-alert 티커 시작 — pid $ALERT_TICKER_PID, 분 경계마다 1회(락 $ALERT_TICKER_LOCK_FILE)"
else
  echo "[cron-runner] 🔴 stop-alert 티커를 띄우지 못했다(flock 없음 또는 락 파일을 만들 수 없음: $ALERT_TICKER_LOCK_FILE) — 메인 루프가 매 틱 직접 부른다(T-147 이전 동작)"
fi
# <<< alert-ticker

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
  # (T-145 ⑨) 이 틱의 시작 시각 — 아래 kis-fundamentals-snapshot 블록이 「이 틱이 이미 길어졌나」를 본다.
  #   T-112 의 `JRL_TICK_T0` 를 쓰지 않는다: 그쪽은 **관찰 전용**이고 「기록이 실패·지연돼도 잡 호출·순서가 바뀌지
  #   않는다」가 규약이다(위 jrl 블록 주석). 그 변수로 호출 여부를 정하면 그 규약이 깨진다.
  KIS_FUND_TICK_T0=$(date +%s 2>/dev/null)

  # 매 1분: entry-watcher — 진입 구간 도달 시 자동 주문 실행
  call /api/cron/entry-watcher "entry-watcher"
  # 매 1분: holding-checker — 보유기간 초과 텔레그램 알림
  call /api/cron/holding-checker "holding-checker"
  # >>> alert-ticker-supervise (T-147) — 티커 자식이 살아 있는지 매 틱 확인하고, 죽었으면 호출을 메인 루프로 되돌린다
  # 왜: 티커가 바쁜 루프 가드로 끝나거나 어떤 이유로든 죽으면, 감독이 없으면 **다음 재기동까지 손절 알림이 영구 정지**다.
  #   ACTIVE 는 1 → 0 으로만 내려간다(되살리지 않는다 — 그래야 「호출자는 하나」가 유지되고, 죽은 원인을 사람이 보게 된다).
  #   로그는 전환 때 한 줄만 남긴다(ACTIVE 가 이미 0 이면 이 블록은 아무것도 하지 않는다 — 매 분 같은 줄을 찍지 않는다).
  if [ "$ALERT_TICKER_ACTIVE" = "1" ] && ! alert_ticker_alive; then
    ALERT_TICKER_ACTIVE=0
    echo "[$(date '+%F %T')] 🔴 stop-alert 티커(pid ${ALERT_TICKER_PID:-?})가 사라졌다 — 이 틱부터 메인 루프가 직접 부른다(T-147 이전 동작)"
  fi
  # <<< alert-ticker-supervise
  # >>> stop-alert-fallback (T-147) — 티커가 부르지 않을 때만 메인 루프가 부른다(호출자는 항상 정확히 하나)
  # 매 1분: stop-alert — 손절가 도달 텔레그램 알림 (T-068, 알림만 — 주문·매도·시그널 없음). 이 호출에만 시간 상한.
  #   기본(ACTIVE=1)에는 위 alert-ticker 블록의 자식이 분 경계마다 부르므로 여기서는 부르지 않는다. ACTIVE=0 인 경우는 셋뿐이다 —
  #   ① `flock` 없음·락 파일 못 만듦 ② `ALERT_TICKER_DISABLE=1`(레거시 모드) ③ 티커가 죽어 위 감독이 내렸을 때. 세 경우 모두
  #   **T-147 이전과 똑같이** 매 틱 이 자리에서 부른다(알림 소실 없음). 호출자를 하나로 묶는 이유는 이중 발송이 아니라
  #   `src/lib/risk/stop-alert.ts` 의 횟수 기반 규칙(`rearmConfirm: 2`·`retryMax: 3`)이므로, 플래그로 하나만 고른다(위 티커 블록 주석).
  if [ "$ALERT_TICKER_ACTIVE" != "1" ]; then
    CALL_MAX_TIME="$STOP_ALERT_CURL_MAX_TIME"
    call /api/cron/stop-alert "stop-alert"
    CALL_MAX_TIME=""
  fi
  # <<< stop-alert-fallback
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
  # >>> kis-fundamentals-snapshot (T-145 ⑨) — src/app/api/cron/kis-fundamentals-snapshot/__tests__/cron-runner-block.test.ts 가 이 블록을 잘라 시험한다
  # 매일 08:00 KST: KIS 해외 현재가상세 스냅샷 (T-059) — 미국장 마감 뒤·국내장(09:00) 개장 전이라 장중 KIS 호출과 겹치지 않는다.
  # 07시(EDGAR·research)와 다른 tick 으로 둬 한 tick 의 동기 대기 시간을 나눈다. 종목 수(약 55) × 직렬 GET, bulk 우선순위.
  # post-market-overseas(같은 08시)와 **독립된 블록**이다.
  #
  # 🔴 (T-145 ⑨) **위 세 줄은 이 작업 전의 설명이다.** 「기존 줄 변경 0 — HEAD 대비 추가만」 규약
  #   (`src/app/api/cron/broker-fills/__tests__/cron-runner-block.test.ts`)이 있어 지우지 않고 아래에 정정을 적는다.
  #   · **시각**: 08시 대의 **30~55분**(자기 틱)이다. 08:00 틱에는 post-market-overseas(curl 상한 120초)가 돌아, 두
  #     호출이 한 틱에 겹치면 하트비트 최악이 280+60=340초로 순찰 한도 300초를 넘는다(2026-10-29 실측 틱 282초).
  #     뒤로 미뤄도 안전한 근거: 10-23~10-31 로그 전부에서 **이미 post-market-overseas 가 먼저 돌았다** → 해외 장마감
  #     분석은 이미 전날 스냅샷을 읽고 있어 읽는 값이 바뀌지 않는다. KRX 09:00 개장 전이고 pmo 재시도 창 밖이다.
  #   · **횟수**: 하루 1회가 아니라 **창 안에서 매 틱**이다. 라우트가 1회 90초 마감으로 스스로 끊고 「오늘 행이 없는
  #     종목」만 돌기 때문에(멱등·이어받기) 남은 일이 없으면 **KIS 호출 0으로 즉시** 끝난다(가벼운 SELECT 몇 개).
  #   · **종목 수**: 약 55 가 아니라 대상 집합에 따라 변한다(보유 ∪ 즐겨찾기 ∪ 수동·자동 목록. 2026-10-31 실측 54).
  #     자동 목록을 켜면 +30~50 이다 — 틱 길이를 **종목 수와 무관하게** 묶는 것이 이 블록의 목적이다.
  #   · **날짜파일**(`$KIS_FUNDAMENTALS_LAST_RUN_FILE`)은 아래 쓰기로 계속 남지만 **판정에 쓰이지 않는다**
  #     (아래에서 `LAST_KIS_FUND` 를 덮어쓴다). 「오늘 한 번이라도 불렀다」는 흔적일 뿐이고, 이어받기의 상태는
  #     DB 의 오늘 행이다 — 러너는 이 잡의 진행 상태를 **갖지 않는다**(사양 9-2: 새 상태를 만들지 않는다).
  LAST_KIS_FUND=$(cat "$KIS_FUNDAMENTALS_LAST_RUN_FILE" 2>/dev/null || echo "")
  # (추가 — T-145 ⑨) 창 판정. 아래 **기존 if** 는 이 변수만 보므로 기존 줄을 고치지 않고 동작을 바꿀 수 있다.
  KIS_FUND_MM=$(date '+%M')
  case "$KIS_FUND_MM" in [0-5][0-9]) ;; *) KIS_FUND_MM="" ;; esac   # 분을 읽을 수 없으면 이 틱은 돌지 않는다
  if [ -n "$KIS_FUND_MM" ] && [ "$((10#$KIS_FUND_MM))" -ge 30 ] && [ "$((10#$KIS_FUND_MM))" -le 55 ]; then
    LAST_KIS_FUND=""         # 창 안 — 완료 여부와 무관하게 부른다(라우트가 멱등하고, 남은 일이 없으면 즉시 끝낸다)
  else
    LAST_KIS_FUND="$TODAY"   # 창 밖 — 아래 기존 if 가 거짓이 된다(날짜파일은 건드리지 않는다)
  fi
  # (추가 — T-145 ⑨) 이 틱이 이미 오래 걸렸으면 이번 틱은 건너뛴다(위 KIS_FUND_TICK_YIELD_SEC 근거).
  #   시각을 읽을 수 없으면 **미루지 않는다** — 판단 불가로 잡을 멈추지 않는다(종전 동작 유지).
  KIS_FUND_NOW=$(date '+%s' 2>/dev/null)
  KIS_FUND_T0="${KIS_FUND_TICK_T0:-}"
  case "${KIS_FUND_NOW:-}" in ''|*[!0-9]*) KIS_FUND_NOW="" ;; esac
  case "$KIS_FUND_T0" in ''|*[!0-9]*) KIS_FUND_T0="" ;; esac
  if [ -n "$KIS_FUND_NOW" ] && [ -n "$KIS_FUND_T0" ] \
     && [ "$((KIS_FUND_NOW - KIS_FUND_T0))" -ge "$KIS_FUND_TICK_YIELD_SEC" ]; then
    LAST_KIS_FUND="$TODAY"
  fi
  if [ "$HH" = "08" ] && [ "$LAST_KIS_FUND" != "$TODAY" ]; then
    CALL_MAX_TIME="$KIS_FUND_CURL_MAX_TIME"   # (추가 — T-145 ⑨) 이 호출에만 시간 상한
    call "/api/cron/kis-fundamentals-snapshot" "kis-fundamentals-snapshot"
    CALL_MAX_TIME=""                          # (추가 — T-145 ⑨)
    echo "$TODAY" > "$KIS_FUNDAMENTALS_LAST_RUN_FILE"
  fi
  # <<< kis-fundamentals-snapshot
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
  # >>> m40-forward-daily
  # Provider recommends collection after 06:30 ET. Four bounded attempts after
  # 06:45 ET, 30 minutes apart. The worker remains after()/202; never await its
  # seven-minute collection on this cron loop. DB lease/session uniqueness persist.
  read -r M40_ET_DAY M40_ET_HH M40_ET_MM M40_NOW_TS <<< "$(TZ=America/New_York date '+%F %H %M %s')"
  M40_ET_MINUTE=-1
  case "$M40_ET_HH:$M40_ET_MM" in [0-2][0-9]:[0-5][0-9]) M40_ET_MINUTE=$((10#$M40_ET_HH*60+10#$M40_ET_MM));; esac
  case "$M40_NOW_TS" in ''|*[!0-9]*) M40_NOW_TS=0;; esac
  M40_FORWARD_DAY=""; M40_FORWARD_ATTEMPTS=0; M40_FORWARD_LAST_TS=0; M40_FORWARD_STATE=pending
  read -r M40_FORWARD_DAY M40_FORWARD_ATTEMPTS M40_FORWARD_LAST_TS M40_FORWARD_STATE 2>/dev/null < "$M40_FORWARD_LAST_RUN_FILE" || true
  [ "$M40_FORWARD_DAY" = "$M40_ET_DAY" ] || { M40_FORWARD_ATTEMPTS=0; M40_FORWARD_LAST_TS=0; M40_FORWARD_STATE=pending; }
  case "$M40_FORWARD_ATTEMPTS" in 0|1|2|3|4) ;; *) M40_FORWARD_ATTEMPTS=4;; esac
  case "$M40_FORWARD_LAST_TS" in ''|*[!0-9]*) M40_FORWARD_LAST_TS=0;; esac
  if [ "$M40_ET_MINUTE" -ge 405 ] && [ "$M40_ET_MINUTE" -le 525 ] && [ "$M40_FORWARD_ATTEMPTS" -lt 4 ] && [ "$M40_FORWARD_STATE" != completed ] && [ "$M40_FORWARD_STATE" != closed ] &&
    { [ "$M40_FORWARD_ATTEMPTS" -eq 0 ] || { [ "$M40_NOW_TS" -gt 0 ] && [ "$((M40_NOW_TS-M40_FORWARD_LAST_TS))" -ge 1800 ]; }; }; then
    M40_FORWARD_ATTEMPTS=$((M40_FORWARD_ATTEMPTS+1))
    # Reserve before network: a restart cannot repeat an in-flight attempt.
    if m40_state_write "$M40_FORWARD_LAST_RUN_FILE" "$M40_ET_DAY $M40_FORWARD_ATTEMPTS $M40_NOW_TS reserved"; then
    M40_FORWARD_OBSERVED=$(curl -q -s --max-time 5 -X POST -H "x-cron-secret: $CRON_SECRET" \
      "$BASE_URL/api/cron/m40-forward?status=1" 2>/dev/null | node -e '
      try { const b=JSON.parse(require("node:fs").readFileSync(0,"utf8"));
        if(b.ok===true) {
          if(b.beforeNextOpen===false) process.stdout.write("closed");
          else if(b.status==="completed"&&b.completed===true&&b.sourceReady===true) process.stdout.write("completed");
          else if(b.status==="running") process.stdout.write("running");
        }
      } catch {}' 2>/dev/null) || M40_FORWARD_OBSERVED=""
    case "$M40_FORWARD_OBSERVED" in
      completed|running|closed) M40_FORWARD_STATE="$M40_FORWARD_OBSERVED" ;;
      *) CALL_MAX_TIME=10
         call "/api/cron/m40-forward" "m40-forward"
         CALL_MAX_TIME=""
         M40_FORWARD_STATE=failed
         [ "${CALL_LAST_CODE:-}" != 202 ] || M40_FORWARD_STATE=accepted ;;
    esac
    m40_state_write "$M40_FORWARD_LAST_RUN_FILE" "$M40_ET_DAY $M40_FORWARD_ATTEMPTS $M40_NOW_TS $M40_FORWARD_STATE" || true
    else
      echo "[m40-forward] reservation_failed; no request sent"
    fi
  fi
  # <<< m40-forward-daily
  # >>> m40-forecast-daily
  # Separate forecast retries after actual forward/source readiness. A failed or
  # blocked attempt never consumes the entire day. DB lease/day uniqueness remain.
  M40_FORECAST_FILE="${HOME}/.node-local/stockinvest/m40-forecast-last-date"
  M40_FORECAST_DAY=""; M40_FORECAST_ATTEMPTS=0; M40_FORECAST_TS=0; M40_FORECAST_STATE=pending
  read -r M40_FORECAST_DAY M40_FORECAST_ATTEMPTS M40_FORECAST_TS M40_FORECAST_STATE 2>/dev/null < "$M40_FORECAST_FILE" || true
  [ "$M40_FORECAST_DAY" = "$M40_ET_DAY" ] || { M40_FORECAST_ATTEMPTS=0; M40_FORECAST_TS=0; M40_FORECAST_STATE=pending; }
  case "$M40_FORECAST_ATTEMPTS" in 0|1|2|3|4) ;; *) M40_FORECAST_ATTEMPTS=4;; esac
  case "$M40_FORECAST_TS" in ''|*[!0-9]*) M40_FORECAST_TS=0;; esac
  if [ "$M40_ET_MINUTE" -ge 420 ] && [ "$M40_ET_MINUTE" -le 540 ] && [ "$M40_FORECAST_ATTEMPTS" -lt 4 ] && [ "$M40_FORECAST_STATE" != completed ] &&
    { [ "$M40_FORECAST_ATTEMPTS" -eq 0 ] || { [ "$M40_NOW_TS" -gt 0 ] && [ "$((M40_NOW_TS-M40_FORECAST_TS))" -ge 1800 ]; }; }; then
    M40_FORECAST_ATTEMPTS=$((M40_FORECAST_ATTEMPTS+1))
    if m40_state_write "$M40_FORECAST_FILE" "$M40_ET_DAY $M40_FORECAST_ATTEMPTS $M40_NOW_TS reserved"; then
    # Dedicated five-second read-only status probe, not a collection call. Do not
    # change call()'s response-file lifecycle or other cron jobs' transport.
    M40_READY=$(curl -q -s --max-time 5 -X POST -H "x-cron-secret: $CRON_SECRET" \
      "$BASE_URL/api/cron/m40-forward?status=1" 2>/dev/null | node -e '
      try { const b=JSON.parse(require("node:fs").readFileSync(0,"utf8"));
        if(b.ok===true&&b.status==="completed"&&b.completed===true&&b.sourceReady===true&&b.beforeNextOpen===true) process.stdout.write("ready");
      } catch {}' 2>/dev/null) || M40_READY=""
    M40_FORECAST_STATE=source_not_ready
    if [ "$M40_READY" = ready ]; then
      CALL_MAX_TIME=150
      call "/api/cron/m40-forecast" "m40-forecast"
      CALL_MAX_TIME=""
      M40_FORECAST_STATE=failed
      [ "${CALL_LAST_CODE:-}" != 202 ] || M40_FORECAST_STATE=running
      [ "${CALL_LAST_CODE:-}" != 200 ] || M40_FORECAST_STATE=completed
    fi
    m40_state_write "$M40_FORECAST_FILE" "$M40_ET_DAY $M40_FORECAST_ATTEMPTS $M40_NOW_TS $M40_FORECAST_STATE" || true
    else
      echo "[m40-forecast] reservation_failed; no request sent"
    fi
  fi
  # <<< m40-forecast-daily

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
  # >>> daily-bars-daily-kr (T-170) — scripts/test-cron-runner-daily-bars-kr.sh 가 러너 전체를 가짜 시각·가짜 curl 로 돌려 시험한다
  # 매일 18:10~18:54 KST 첫 틱: 국내 일봉 저녁 증분 수집. POST /api/cron/daily-bars?market=KR = 라우트 기본 대상을 국내로
  #   좁힌 것(국내 보유 → 국내 시그널 종목, 저장된 마지막 거래일이 오래된 순). KIS 읽기 GET → daily_bars upsert 뿐 — 주문·시그널·알림 없음.
  #   🔴 시장은 본문이 아니라 쿼리로 넘긴다 — call() 은 셋째 인자(본문)를 주면 끝에 `}` 를 하나 더 붙인다(`${3:-{}}` 확장, 지금까지 본문을
  #   넘긴 호출이 없어 드러나지 않았다). call() 은 모든 잡이 쓰므로 고치지 않고 news-fetch(?market=) 처럼 쿼리를 쓴다(본문은 기본값 {}).
  #   증분 판정·up_to_date 건너뛰기·single-flight·예산(호출 150·100초)·오프아워 판정은 라우트가 한다(07:40 블록과 같다).
  # 왜 따로 부르나: 07:40 전 시장 실행(T-117) 한 번의 예산보다 대상이 많아져(T-156 이후 169종목) 목록 뒤의 국내 43종목이 11-09 부터
  #   매일 닿지 못했다(T-170 조사 — 11-06 봉에서 멈춤). 국내(약 44호출·약 40초)를 저녁으로 떼면 아침 예산은 해외가 쓴다.
  # 왜 18:10~18:54: ① 국내 봉 확정 15:40·시간외 단일가 18:00 종료 뒤라 그날 봉을 그날 받는다 ② 라우트 오프아워 창(15:40~22:20, 분 3~55)
  #   안 ③ 16시 국내 분석·리서치, 17시 종목 메타, 21·22시 보유 공시 확인과 다른 시각 ④ 18시대의 다른 잡은 해외 peek(그 시의 첫 틱, 상한 40초)뿐.
  # 한 번만 부른다(재시도 없음). 날짜파일은 호출했으면 성공·실패 무관 기록(T-036) — 하루 1회. 409·503·000 도 call() 의 로그 한 줄로 끝난다.
  #   못 한 날은 다음 날 07:40 전 시장 실행이 이어받는다(대상이 낡은 순이라 못 받은 국내 종목이 앞으로 온다).
  # 🔴 같은 틱에 해외 peek 가 돌았으면 미룬다(yield_tick, 날짜파일 안 씀) — 바로 위 peek 블록이 이 틱에 호출했으면 PEEK_RAN_LABEL 이 차 있다.
  #   그래서 이 블록은 peek 블록 **뒤**에 둔다(07:40 블록처럼 호출 전에 읽어 둔 변수로 판단 — 날짜파일을 다시 읽지 않는다).
  # 하트비트: 이 틱 최악 = curl 상한 DAILY_BARS_CURL_MAX_TIME 120 + stop-alert 20 + 매 분 잡 약 30 + sleep 60 = 약 230초 < 300초
  #   (peek 와는 같은 틱에 겹치지 않는다 — 위 미루기).
  # ⚠ 러너 가장자리(허용): 18:10~18:54 에 러너가 꺼져 있었으면 그날 저녁은 건너뛴다. 호출하지 않았으므로 날짜파일은 쓰지 않고,
  #   18:55~23:59 의 첫 틱에 로그 한 줄만 남긴다(러너 변수 DBARS_KR_SKIP_LOGGED 로 중복 방지 — 재기동되면 한 줄 더 남을 수 있다).
  # 이 블록은 호출 줄·조건을 새로 더하기만 한다 — 다른 잡(07:40 daily-bars 포함)의 호출·시각·순서는 그대로다.
  #   T-104 단계 1(잡 정의·스케줄 DB 화)이 시작되면 이 하드코딩 블록도 잡 정의로 흡수한다(공동 인계서 J8).
  DBARS_KR_MM=$(date '+%M')
  case "$DBARS_KR_MM" in [0-5][0-9]) ;; *) DBARS_KR_MM=00 ;; esac   # 읽을 수 없으면 이 틱은 돌지 않는다
  LAST_DAILY_BARS_KR=$(cat "$DAILY_BARS_KR_LAST_RUN_FILE" 2>/dev/null || echo "")
  if [ "$HH" = "18" ] && [ "$DBARS_KR_MM" -ge 10 ] && [ "$DBARS_KR_MM" -le 54 ] && [ "$LAST_DAILY_BARS_KR" != "$TODAY" ]; then
    if [ -n "$PEEK_RAN_LABEL" ]; then
      echo "[$(date '+%F %T')] daily-bars-kr yield_tick — $PEEK_RAN_LABEL 가 이 틱에 돌아 다음 틱으로 미룸"
    else
      CALL_MAX_TIME="$DAILY_BARS_CURL_MAX_TIME"   # 이 호출에만 시간 상한
      call "/api/cron/daily-bars?market=KR" "daily-bars-kr"
      CALL_MAX_TIME=""
      echo "$TODAY" > "$DAILY_BARS_KR_LAST_RUN_FILE"   # 성공·실패 무관 기록
    fi
  fi
  DBARS_KR_LATE=no
  case "$HH" in
    18) [ "$DBARS_KR_MM" -ge 55 ] && DBARS_KR_LATE=yes ;;
    19|2[0-3]) DBARS_KR_LATE=yes ;;
  esac
  if [ "$DBARS_KR_LATE" = "yes" ] && [ "$LAST_DAILY_BARS_KR" != "$TODAY" ] && [ "${DBARS_KR_SKIP_LOGGED:-}" != "$TODAY" ]; then
    echo "[$(date '+%F %T')] daily-bars-kr skipped — 18:10~18:54 에 부르지 못해 오늘 국내 저녁 증분은 건너뜀(18:55 이후 호출 안 함, 다음 날 07:40 실행이 이어받음)"
    DBARS_KR_SKIP_LOGGED="$TODAY"
  fi
  # <<< daily-bars-daily-kr
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
  # >>> overseas-universe-refresh (T-143 WP-A) — scripts/test-cron-runner-overseas-universe.sh 가 이 블록을 가짜 시각으로 시험한다
  # 매월 **첫째 일요일 01:10~05:50 KST**, 창 안에서 **2분마다** 1회. 라우트가 100초 예산 안에서 한 단계만
  # (listing → scan 청크 → retry → finalize) 처리하고 커서를 DB 에 저장하므로 **한 번에 끝나지 않는다** —
  # 후보 약 2,000종목 × 실측 0.46~0.93초 = 15~43분이라 300초 하트비트에 들어갈 수가 없다.
  #
  # 왜 평일이 아니라 일요일인가: 평일 야간은 전부 **미국 정규장**(KST 23:30~06:00)이다. 그 시간에 30~75분 걸리는
  # 산출을 돌리면 01시 종목과 05시 종목을 **다른 시각의 가격**으로 비교하게 된다 — 시총 순위에서 받아들일 수 없다.
  # 일요일 KST = 토요일 ET 라 미국·국내 모두 닫혀 있고 모든 종목이 금요일 종가 하나다(서머타임과도 무관하다).
  #
  # 🔴 왜 「끝났으면 그만 부르기」를 응답 본문으로 판정하지 않는가: `call()` 이 응답 본문 파일을 함수 끝에서 지우고
  #   (`rm -f "$CALL_BODY_FILE"`), 그 구조는 scripts/test-cron-runner-job-run-log.sh J8·J13 이 **줄 단위로 고정**한다
  #   (call() 안 CALL_BODY_FILE 참조는 jrl_hook 두 줄뿐이어야 한다). 본문을 보려고 call() 을 고치면 그 시험을 깨야 하므로
  #   그렇게 하지 않는다. 대신 **호출 수를 창·간격으로 묶는다**: 창 280분 ÷ 2분 = 최대 140회.
  #   이달 일이 끝난 뒤의 호출은 라우트가 **외부 호출 0건**으로 끝낸다(run 이 complete/failed/expired 면 run 1줄만 읽고
  #   `final:true` 를 돌려준다). 140 회는 `job_run_log.attempt`(TINYINT UNSIGNED, 255) 안이고, 창 전체가 한 슬롯이라
  #   기록은 **run 1건 = 행 1건**이다(재시도 = 같은 슬롯 → ODKU attempt+1).
  #
  # 요일·회차·창은 **러너와 라우트 둘 다** 검사한다(러너는 비용 절약, 라우트는 안전). 러너는 `system_config` 를 읽지
  # 못하므로 아래 값은 **상수**다 — 설정(`overseas_universe_refresh`)을 바꾸면 이 블록도 함께 바꾼다.
  # 이 틱 최악 = curl 상한 120 + stop-alert 20 + 매 분 잡 약 30 + sleep 60 = 약 230초 < 300초(순찰 재시작 기준).
  # 호출 수: 창 280분 ÷ 2분 = 140 + 종료 점검 1 = **141**(여전히 `job_run_log.attempt` TINYINT 255 안이다).
  #
  # 🔴 창이 **끝난 직후 한 틱**(05:50)도 부른다 — T-145 ④-조각. 그 호출에서 라우트는 관문 3으로 「창 밖」을
  #   돌려주면서, 그 전에 이달 run 이 **미완**인지 보고 미완이면 텔레그램 warning 을 1회 보낸다.
  #   왜 필요한가: T-145 ⑥-4 로 **일시 오류가 그 달을 닫지 않게** 바꿨다 → 창이 끝날 때 `failed` 조차 남지 않는
  #   미완 경로가 생겼고, 러너가 창 안에서만 부르면 그 상태를 **아무도 보지 않는다.**
  #   비용: 월 1회, 외부 호출 0건(run 1줄 + 집계 1줄만 읽는다).
  #   ⚠ 설정(`overseas_universe_refresh.windowEnd`)의 창 끝을 바꾸면 **아래 05:50 도 함께 바꾼다**
  #     (러너는 `system_config` 를 읽지 못해 이 값이 상수다 — 이 블록의 다른 상수들과 같은 제약이다).
  UNIV_DOW=$(date '+%u')
  UNIV_DOM=$(date '+%d')
  UNIV_MM=$(date '+%M')
  case "$UNIV_MM" in [0-5][0-9]) ;; *) UNIV_MM="" ;; esac   # 분을 읽을 수 없으면 이 틱은 돌지 않는다
  UNIV_WINDOW=no
  if [ -n "$UNIV_MM" ] && [ $((10#$UNIV_MM % 2)) -eq 0 ]; then
    if [ "$HH" = "01" ] && [ "$UNIV_MM" -ge 10 ]; then UNIV_WINDOW=yes; fi
    case "$HH" in
      02|03|04) UNIV_WINDOW=yes ;;
      05) [ "$UNIV_MM" -lt 50 ] && UNIV_WINDOW=yes ;;
    esac
  fi
  # 🔴 T-145 ④-조각 — 창 끝 분(05:50)에 **한 틱만** 더 켠다. 위 줄들을 고치지 않고 **더하기만** 한다.
  #   (T-147) 이 주석이 근거로 들던 `cron-runner-block.test.ts` 의 「기존 줄 변경 0」 단정은 **삭제됐다** — T-147 이 메인 루프의
  #   `stop-alert` 호출을 의도적으로 조건부로 바꿨기 때문이다(그 파일 끝 주석에 이유가 있다). 「더하기만」은 이제 테스트가 강제하는
  #   규약이 아니라 **이 블록이 스스로 지키는 방식**이다(러너 변경의 검토는 `SAFETY_PATHS` 커밋 훅 + Reviewer 독립감사가 맡는다).
  #   `UNIV_MM` 은 분을 읽지 못했으면 빈 문자열이라 이 비교가 저절로 거짓이 된다.
  if [ "$HH" = "05" ] && [ "$UNIV_MM" = "50" ]; then UNIV_WINDOW=yes; fi
  if [ "$UNIV_DOW" = "7" ] && [ "$UNIV_DOM" -le 7 ] && [ "$UNIV_WINDOW" = "yes" ]; then
    CALL_MAX_TIME="$UNIVERSE_CURL_MAX_TIME"   # 이 호출에만 시간 상한
    call "/api/cron/overseas-universe-refresh" "overseas-universe-refresh"
    CALL_MAX_TIME=""
  fi
  # <<< overseas-universe-refresh
  # >>> heartbeat-refresh (T-147) — 무거운 블록들이 끝난 뒤 하트비트를 **한 번 더** 쓴다(틱 시작 기록은 그대로 둔다)
  # 하트비트는 틱 **시작**에만 썼다(위 T-037 블록). 감시자는 둘이고 임계가 같다 — HOME-SERVER 순찰(`stockinvest-cron`,
  #   health_type heartbeat_file, max_age_seconds 300, crontab */5 check-and-recover.sh --periodic)과 앱 워치독
  #   (`src/lib/ops/cron-watchdog.ts`, `CRON_HEARTBEAT_STALE_SEC` 기본 300 — "cron 정지" critical).
  #
  # 🔴 효과와 그 한계를 정확히 적는다 — 이 한 줄은 노출을 **좁히지만 닫지 못한다**:
  #   - 하트비트 나이의 최악은 **쓰기 사이의 최대 간격**이다. 변경 전에는 쓰기가 틱 시작 하나뿐이라 그 간격 = **틱 주기**
  #     (틱 길이 + sleep 60)였다. 갱신을 더하면 긴 틱 구간의 간격이 **틱 길이**로 줄고, sleep 구간은 60초로 묶인다.
  #   - 2026-11-03 운영 cron 로그 **3,119틱** 실측: 틱 주기 mean 66.3 · max **412**초 · 300초 초과 **12틱** /
  #     틱 길이 mean 6.4 · max **352**초 · 300초 초과 **4틱**. 즉 이 한 줄은 노출을 12틱 → 4틱으로 **좁히지만 닫지는 못한다**
  #     (352 > 300). ⚠ 최악이 「sleep 60 + 약 1초」로 줄어드는 것이 **아니다** — 긴 잡은 틱 **안**에서 돌고 갱신은 틱 **끝**에
  #     있어서, 긴 틱이 도는 동안의 최신 기록은 여전히 그 틱의 **시작** 기록이다. 틱 길이가 300 을 넘는 틱에서는 이 갱신이 늦게 온다.
  #   - 수치를 더할 때 주의: 「틱 주기」는 이미 sleep 60 을 **포함**한다. 거기에 또 60 을 더하면 중복 계산이다.
  #   - 왜 여기서 더 닫지 않는가: ⓐ `call()` 마다 쓰면 최악이 **단일 잡 길이**가 되는데 `strategy-eval` 한 번이 최장 약 298초로
  #     여유가 2초뿐이었다(2026-11-03 · T-148 전 측정 — 측정 잡음에 바로 뚫린다) ⓑ 임계(300) 상향은 HOME-SERVER 설정이라
  #     **사용자 결정**이다 ⓒ 배경 프로세스가 하트비트를 쓰면 메인 루프가 영구히 멈춰도 두 감시자가 **영원히 발동하지 않는다**
  #     (그래서 위 티커 자식은 하트비트를 쓰지 않는다)
  #     ⓓ 근본 해결은 `src/lib/strategy/engine.ts` 의 직렬 평가 루프에 동시성 제한을 두는 것 — **별건이고 T-148 이 맡았다.**
  #     ⓐ 의 「여유 2초」는 T-148 이 반영되면 넓어진다. 그때 `call()` 마다 쓰는 선택을 다시 볼 수 있다(지금 바꾸지는 않는다).
  # 틱 시작 기록을 지우지 않는 이유: T-037 의 "직전 틱까지는 살아 있었다"는 의미를 유지한다(느린 잡 하나를 사망으로 오인하지 않게).
  #   또한 틱 **중간**에 영구히 멈춘 경우의 탐지력은 변경 전과 같다(그때 최신 기록은 그 틱의 시작 기록이다).
  # 쓰기는 틱 시작과 같은 tmp→mv 원자 쓰기이고 실패는 `|| true` 로 삼킨다(하트비트 기록 실패가 루프를 멈추면 본말전도).
  # 레거시 모드(`ALERT_TICKER_DISABLE=1`)에서는 이 쓰기를 건너뛴다 — T-147 이전 동작을 그대로 재현해야 기존 하네스의
  #   하트비트 간격 정확 비교가 수정 없이 통과한다(위 alert-ticker 블록 ② 주석).
  if [ "$ALERT_TICKER_DISABLE" != "1" ]; then
    { printf '%s\n' "$(date +%s)" > "${CRON_HEARTBEAT_FILE}.tmp" \
        && mv -f "${CRON_HEARTBEAT_FILE}.tmp" "${CRON_HEARTBEAT_FILE}"; } 2>/dev/null || true
  fi
  # <<< heartbeat-refresh
  jrl_flush "${JRL_TICK_T0:-}" 2>/dev/null || true   # T-112 jrl
  i=$(( (i + 1) % 1440 ))   # 24h 사이클
  sleep 60
done
