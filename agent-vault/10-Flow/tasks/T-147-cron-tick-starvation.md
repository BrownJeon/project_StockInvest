---
task_id: T-147
title: cron 틱 묶임 — 장중 분당 잡(손절 알림) 굶음 해소
status: done
waiting: 없음 — 11-04 국내 장중 실측으로 검증 완료(아래 「실전 검증」). 텔레그램 중복만 미검증(그날 발송 0건)
priority: high
project: StockInvest
created: 2026-11-03
updated: 2026-11-03
base_ref: origin/main 1dfd57d (릴리스 20261103-093323-1dfd57d6) · 로컬 main 1db9103(문서, 미push)
risk_level: R2
roles_involved: [leader, developer, reviewer, qa]
related_tasks:
  - T-146-manual-list-cap-removal
  - T-112-run-judgment-record-foundation
tags:
  - type/task
  - domain/safety
  - domain/ops
aliases:
  - cron 틱 묶임
  - 손절 알림 공백
  - T-147
---

## 발단

T-146 배포(2026-11-03 09:33) 확인 중, cron 러너가 `strategy-eval` 호출 하나에 145초 묶여 그 사이
분당 잡(`entry-watcher`·`holding-checker`·`stop-alert`)이 전부 멈추는 것을 봤다. 사용자에게 보고한 뒤
"지금 고쳐" 지시를 받았다(2026-11-03). **T-146 의 변경(해외 125종목)과는 무관하다** — 아래 실측에서
장중 `strategy-eval` 은 국내 시장만 평가한다(`runAll` 은 `opts.force` 없이는 `getCurrentMarket()` 한
시장만 돈다 — `src/lib/strategy/engine.ts:1603`).

## 실측 (2026-11-03, 전부 이번 세션에서 직접 측정)

### ① 틱 주기 — 운영 cron 로그 107틱 (09:24:21 ~ 12:12:24)

| 항목 | 값 |
|---|---|
| 틱 주기 median | **61초** (p25 60 · p75 62) |
| 틱 주기 mean | **95.1초** |
| 틱 주기 max | **328초** |
| 시간당 틱 수 | 38 (기대 60) |
| `stop-alert` → 다음 라벨 최장 간격 | **297초** |

→ 대부분의 틱은 61초로 건강하다. 손실은 **소수의 긴 틱**이 전부 먹는다(10083초 중 긴 틱이 약 3500초).

### ② 긴 틱의 정체 — `strategy-eval` 24회 전부 측정 (`stop-alert` 줄 → `strategy-eval` 줄 시각 차)

```
09:25 115s · 09:32  92s · 09:33 145s · 09:41 120s · 09:48  54s · 09:54 297s
10:00  83s · 10:06 145s · 10:14 213s · 10:22  53s · 10:28 252s · 10:38 247s
10:47 131s · 10:54 151s · 11:02 220s · 11:10 252s · 11:20 137s · 11:27 202s
11:35 116s · 11:43 252s · 11:52 180s · 12:00 155s · 12:08 136s · 09:33   0s
```

n=24 · 합 **3748초** = 측정 구간 전체 시간의 **37%** · 100초 초과 **19회**.
즉 "드물게 느린 잡"이 아니라 **장중 매회 53~297초**다.

`job_run_log` 교차 확인(시간 롤업의 `counts_json.maxMs` — 그 슬롯에서 가장 긴 1회):

| 날짜 | 슬롯 수 | 최장 1회 | 120초 초과 슬롯 | 240초 초과 슬롯 |
|---|---|---|---|---|
| 10-30 | 3 | 270.1초 | 2 | 1 |
| 10-31 | 24 | 128.7초 | 1 | 0 |
| 11-01 | 25 | **0.017초** | 0 | 0 |
| 11-02 | 26 | 307.9초 | 7 | 5 |
| 11-03 | 15 | **347.8초** | 4 | 3 |

11-01 이 0.017초인 것은 일요일(장 안 열림 → `all_markets_closed` 즉시 반환)이다. **국내 장중에만 생긴다.**

### ③ 왜 긴가

`runMarket('domestic')` 이 KIS 를 직렬로 호출한다 — `UNIVERSE_TOP_N = 150` 종목, 운영 레이트 5 req/s.
`refreshUniverse` 는 TTL 15분(`src/lib/strategy/universe.ts:16`)이라 **매 회가 아니다** → 150초의
대부분은 평가 본체(종목별 시세·일봉·지표)다. 라우트에도 `runAll` 에도 마감(deadline)이 없다.

### ④ 순찰(워치독)은 **이미 4번 발동했다 — 오늘 장중 포함** (2026-11-03 19:5x 정정)

> 🔴 이 절의 최초 서술("아직 한 번도 발동하지 않았다 / 재시작 0회 / 위험은 확률이다")은 **틀렸다.**
> 독립감사가 잡아내고 내가 재확인했다. 내 최초 grep 이 복구 로그의 실제 문구를 집지 못한 탐색 실패였다.
> 사용자 보고에도 "0회"로 나갔으므로 정정해 전달한다. 아래가 실측이다.

- 설정: `HOME-SERVER_CONFIG/.../projects.json` → `stockinvest-cron`, `health_type: heartbeat_file`,
  `heartbeat_path: ~/.node-local/stockinvest/cron-heartbeat`, `max_age_seconds: 300`,
  crontab `*/5 * * * * check-and-recover.sh --periodic`.
- 하트비트는 **틱 시작에만** 쓴다(변경 전 `scripts/cron-runner.sh:446-448`). 그래서 긴 틱이 도는 동안
  최신 기록은 그 틱의 시작 시각이고, 나이가 틱 주기만큼(실측 max 412초) 올라간다.
- **`~/.local/log/autostart-recover.log` 실측 — `stockinvest-cron` 하트비트 무응답 복구 4건:**
  `2026-09-29 03:55:02` · `2026-10-08 15:55:56` · `2026-10-30 22:55:02` · **`2026-11-03 10:00:02`(오늘, 국내 장중)**.
  네 건 모두 사유가 `1회 무응답(하트비트 …, 300s 이내) — 복구 시도` → `pm2 restart 시도` →
  `ALERT: … 복구 시도 후에도 실패`(즉시 재점검에서도 하트비트가 아직 갱신 전이라 ALERT 까지 갔다).
- **오늘 건의 인과가 로그로 이어진다**(독립감사 추적, 내가 재확인): `cron-out.log` 에서 09:54:34 에 틱이
  시작되고 `strategy-eval` 이 **297초** 걸려 09:59:32 에 끝났다 → 10:00:02 시점의 하트비트 나이 약 **329초**
  → 순찰이 임계 300 을 넘겨 `pm2 restart`. 장중에 cron 이 재시작됐고 그때 돌던 평가는 중단됐다.
- 따라서 **D3(틱 끝 하트비트 추가 쓰기)는 가설적 예방이 아니라 오늘 실제로 난 사고를 막는 변경이다** —
  D3 가 있었으면 09:59:32 에 갱신돼 10:00:02 의 나이가 30초였고 재시작은 일어나지 않았다.
- 다만 **남은 위험도 실재한다**: 순찰은 `--periodic` 에서 **첫 실패에 즉시** 재시작하므로, 틱 **길이**가
  300초를 넘는 틱(실측 max 352초 · 3,358틱 중 3~4틱)에서는 D3 뒤에도 같은 재시작이 가능하다.
  닫는 길은 임계 상향(HOME-SERVER 설정 — 사용자 결정) 또는 근본 원인 단축(직렬 루프 동시성)이다.

## 🔴 왜 "curl 상한(cap)" 이 답이 아닌가 — 설계 결정의 핵

다른 무거운 잡은 모두 `CALL_MAX_TIME` 상한이 있고(`PMO_CURL_MAX_TIME` 120 · `KIS_FUND_CURL_MAX_TIME`
110 · `DAILY_BARS_CURL_MAX_TIME` 120 …), `strategy-eval` 만 없다. 그래서 첫 진단에서 "상한 한 줄 추가"
를 떠올렸으나 **그 길은 안전장치 회귀다**:

1. curl 을 끊어도 **서버 쪽 `runAll` 은 끝까지 돈다.** 러너만 먼저 돌아온다.
2. 그러면 다음 틱의 `entry-watcher`(실주문 집행)가 **아직 도는 `runAll`(청산 엔진 포함)과 겹친다.**
3. **주문 경로에 직렬화 락이 없다.** `src/lib/safety/order-sync.ts:1226-1227` 이 `SELECT … FOR UPDATE`
   와 `GET_LOCK()` 을 **명시적으로 기각**해 뒀다. 일일 누적 한도(`DAILY_ORDER_MAX_KRW`)는
   check-then-act 라 동시에 통과하는 두 경로가 한도를 함께 넘을 수 있다.
4. 즉 **지금의 "무제한 동기 호출"이 주문 한도 정합성을 떠받치는 직렬화 장치**다. 상한이든 백그라운드든
  
  > 🔴 **이 문장은 틀렸다 — 아래 「정정」 bullet 참조.** 주문 겹침은 **T-081 WP-B**(`src/lib/safety/order-limits.ts:220-253`)가 `pending` 선예약 + 타 주문 pending 합산으로 **DB 에서 이미 막는다.** `order-sync.ts:1226-1227` 이 기각한 `FOR UPDATE`·`GET_LOCK()` 은 **브로커 체결 정산** 건이다(러너 `:477` 이 정확하다). 「유일한 직렬화 장치」는 성립하지 않는다.
   그걸 깨면 cron 끼리의 주문 경로 동시성을 새로 만든다.
5. 부수 피해로 `job_run_log` 관측이 망가진다 — 장중 모든 `strategy-eval` 이 HTTP 000(끊김)으로 기록된다
   (T-112 가 만든 판정·롤업이 전부 failed 로 물든다).

> 같은 이유로 `strategy-eval` 을 `&` 로 백그라운드에 넘기는 것도 **이번 범위에서 제외**한다.

## 채택 설계 — 알림 전용 잡만 60초 전용 루프로 분리

`stop-alert` 는 **알림만** 한다(주문·매도·시그널 없음 — 러너 주석 `cron-runner.sh:27` 과 라우트 확인).
그래서 주문 경로와 겹쳐도 한도 정합성 문제가 없다. 이것만 틱에서 떼어낸다.

1. 러너 시작 시 자식 프로세스 하나(알림 티커)를 띄워 `stop-alert` 를 **분 경계에 맞춰 60초마다** 호출한다.
   `flock -n` 으로 자신·배포 겹침(러너 두 개가 1~3초 겹치는 창)만 막는다. `STOP_ALERT_CURL_MAX_TIME=20`
   은 그대로 쓴다.
2. **메인 루프의 `stop-alert` 호출은 뺀다.** 호출자는 하나여야 한다 — 라우트의 재발송 가드가
   **프로세스 메모리 Map 의 check-then-act**(`src/app/api/cron/stop-alert/route.ts:62-71`,
   `RESEND_GUARD_MS` 10분)라 두 경로가 겹치면 같은 알림이 두 번 갈 수 있다.
3. **하트비트를 긴 호출 뒤에도 한 번 더 쓴다**(추가). 328초 틱에서도 정지 창이 없어져 순찰 오재시작
   가능성이 사라진다. 틱 시작 기록은 그대로 둔다(T-037 의 "직전 틱까지는 살아 있었다" 의미 유지).
4. `holding-checker` 는 **이번에 건드리지 않는다.** 체감 피해가 손절 알림 쪽이고 변경 범위를 좁힌다.

### 이 설계가 고치지 못하는 것 (정직하게)

- **`entry-watcher`(실주문 집행)는 여전히 평균 95초·최장 328초 간격이다.** 주문 경로라 같은 방법으로
  뺄 수 없다(위 ③ 참조). 진입 타이밍 지연은 남는다.
- 근본 원인(국내 평가 150초)은 그대로다. 그것을 줄이는 작업(시세·일봉 캐시, 평가 대상 축소, 라우트 마감)
  은 analyst·designer 판단이 필요한 별건이다.

### block 테스트 불변식 처리

`src/app/api/cron/{broker-fills,kis-fundamentals-snapshot}/__tests__/cron-runner-block.test.ts` 의
`기존 줄 변경 0 — HEAD 대비 추가만` 단정은 HEAD 의 모든 줄이 현재 파일의 **부분 수열**일 것을 요구한다.
메인 루프에서 `stop-alert` 호출 줄을 빼면 이 단정이 깨진다.

그 단정은 두 작업이 "내 블록이 남의 줄을 건드리지 않았다"를 지키려 둔 **개발 중 가드**이고, 이후 작업이
러너를 의도적으로 바꾸는 것을 금지하는 규칙이 아니다(금지 규칙은 `SAFETY_PATHS` 커밋 훅 + Reviewer
독립감사다). → 이번에 **그 테스트 케이스만 삭제하고 이유를 주석으로 남긴다**(나머지 단정 — 블록 존재·
상수·호출 줄 개수·블록 순서·`bash -n` — 은 유지). 타당성은 Reviewer 가 판정한다.

## Developer

- [12:41] 구현 완료. 바꾼 파일 4개 — `scripts/cron-runner.sh`(+103/-5) · `scripts/test-cron-runner-alert-ticker.sh`(신규 167줄) · 두 블록 시험(+12/-17 · +15/-16) · `src/app/api/cron/broker-fills/__tests__/cron-runner-block.test.ts` · `src/app/api/cron/kis-fundamentals-snapshot/__tests__/cron-runner-block.test.ts`. 앱 코드(`src/lib/**`·`src/app/api/cron/*/route.ts`)·다른 시험 스크립트는 건드리지 않았다. 커밋하지 않았다(Mac 세션이라 commit-msg 훅이 돌지 않는다 — 커밋은 서버에서).
- [12:41] D1 — 러너에 `# >>> alert-ticker (T-147)` ~ `# <<< alert-ticker` 블록을 넣었다(현재 429~506행). 자리는 날짜파일 선언·`mkdir -p "$(dirname "$META_LAST_RUN_FILE")"` 뒤, `i=0`/`while true` 앞 — 락 파일이 그 `mkdir` 이 보장하는 디렉터리(`~/.node-local/stockinvest/stop-alert.lock`)에 있으므로 순서가 의미 있다. 구성: `ALERT_TICKER_LOCK_FILE`·`ALERT_TICKER_PARENT_PID=$$`·`alert_ticker_wait_sec()`(분 경계까지 남은 초 1~60, 시각 못 읽으면 60)·`alert_ticker_once()`(`{ flock -n 9 || return 0; CALL_MAX_TIME=…; call /api/cron/stop-alert "stop-alert"; } 9>락`)·`alert_ticker_loop()`(대기 → 부모 `kill -0` → 가드 → 1회 호출)·기동 스탠자(`alert_ticker_loop &` + 시작 로그 1줄, 실패하면 경고 1줄).
- [12:41] D1 세부 — 락은 **회차마다 열고 닫는다**: fd 를 티커 수명 동안 열어 두면 한 번 잡은 락이 유지돼 겹친 옛 티커가 새 티커를 영구히 굶긴다. `trap` 은 쓰지 않았다(파일 69행 근거 그대로). pm2 설정 실측 — `stockinvest-cron` 은 `treekill: true`·fork 모드라 정상 종료 경로에서는 pm2 가 자식까지 죽인다. `kill -0` 부모 확인은 그게 실패하는 경우(부모만 `kill -9` 등)의 2선 방어다(부모가 자는 동안 죽으면 자식은 최대 60초 늦게 끝난다).
- [12:41] D1 — 설계에 없던 것 **1개 추가**했다: 바쁜 루프 가드(`ALERT_TICKER_MIN_CYCLE_SEC=5`·`ALERT_TICKER_MAX_FAST_CYCLES=3`, 판정은 bash 내장 `SECONDS` = 실시간). 이유 둘 — ① 무인 루프가 `sleep` 파손 시 알림 라우트를 초당 수십 번 때리는 것을 막는다(운영에서는 회차가 약 60초라 발동하지 않는다) ② 기존 시험 하네스 8개가 전부 `sleep` 을 **즉시 반환 스텁**으로 바꾸므로, 가드가 없으면 티커가 그 하네스 안에서 무한 루프가 된다(가드 덕에 추가 curl 0회·스텁 sleep 2~3회로 묶인다). 기준은 `min(요청한 대기, 5초)` 다 — 분 경계 직전에 티커가 시작되면 첫 회차 정상 대기가 1~4초일 수 있어 고정 5초로 재면 정상 회차를 오인해 1분을 거른다.
- [12:41] D2 — 메인 루프의 3줄(`CALL_MAX_TIME=…` / `call /api/cron/stop-alert` / `CALL_MAX_TIME=""`)과 그 주석 1줄을 지우고 왜 뺐는지 주석 5줄을 남겼다. 머리 주석 27행도 갱신(티커 자식이 호출). 실측 확인 — 러너 전체에서 `call /api/cron/stop-alert` 줄은 **1개**이고 그것이 티커 블록 안이며, 메인 루프(`while true` 이후)에는 0개다. `CALL_LAST_CODE`(해외 분석 재시도)는 영향 없다: 읽는 자리가 pmo 호출 **직후**이고(588~592행) 티커는 서브셸이라 부모 변수를 못 바꾼다.
- [12:41] D3 — `# >>> heartbeat-refresh (T-147)` 블록을 `jrl_flush` 바로 앞에 넣었다(틱 시작 기록은 그대로). **설계가 적은 효과와 실제 효과가 다르다 — 가이드의 계산이 틀렸다:** ① "328초 + sleep 60 = 388초"는 중복 계산이다. 실측 328초는 **틱 주기(= 틱 시작 → 다음 틱 시작)** 라 이미 sleep 60 을 포함하므로, 변경 전 하트비트 최악 나이는 388 이 아니라 **틱 주기 그 자체**다. ② "이 한 줄로 최악이 sleep 60 + 약 1초로 줄어든다"도 아니다. 긴 잡은 틱 **안**에서 돌고 갱신은 틱 **끝**에 있으므로, 긴 틱이 도는 동안의 최신 기록은 여전히 그 틱의 **시작** 기록이다 → 변경 후 최악 나이 = **가장 긴 틱의 길이**다(sleep 구간만 60초로 묶인다).
- [12:41] D3 실측(이번 세션에서 직접 — 운영 로그 `/home/brownjeon/apps/stockinvest/shared/logs/cron-out.log`, 2026-11-03 00:00~12:38 의 610틱, 틱 경계 = `entry-watcher` 줄): 틱 **주기** median 61 · mean 74.6 · max **412**초 · 300초 초과 **6틱** / 틱 **길이** median 0 · mean 14.3 · max **352**초 · 300초 초과 **1틱**. 즉 D3 는 순찰 임계(300초) 초과 노출을 **6틱 → 1틱**으로 줄이지만 **창을 닫지는 못한다**(352 > 300). 가장 긴 틱은 09:00:02(주기 412 / 길이 352)로 장 개장 + 시간 잡이 겹치는 틱이다. 남은 노출을 없애려면 ⓐ `call()` 마다(또는 긴 잡 앞) 하트비트를 쓰거나 — 그래도 단일 `strategy-eval` 최장 약 298초라 여유 2초뿐 — ⓑ 임계(`max_age_seconds`·`CRON_HEARTBEAT_STALE_SEC` 둘 다 300)를 올리거나 ⓒ 근본 원인(국내 평가 길이)을 줄여야 한다. ⓐ~ⓒ 는 이 task 범위 밖이라 **고치지 않았다** — Leader 판단 사항.
- [12:41] D3 — 티커 자식은 하트비트를 **쓰지 않는다**(의도적). 쓰게 하면 나이가 항상 60초 미만이 되어, 메인 루프가 영구히 멈춰도 순찰·앱 워치독(`src/lib/ops/cron-watchdog.ts` "cron 정지" critical)이 영원히 발동하지 않는다. 또한 진짜 멈춤의 탐지력은 이번 변경으로 **떨어지지 않는다**: 틱 중간에 멈추면 최신 기록은 그 틱의 시작 기록이라 변경 전과 같다.
- [12:41] D4 — `scripts/test-cron-runner-alert-ticker.sh` 신규(실행: `bash scripts/test-cron-runner-alert-ticker.sh`). 틀은 `test-cron-runner-pmo-retry.sh` A 절 선례(블록만 잘라 `source`)를 따랐다. 러너 전체를 돌리는 통합 하네스를 쓰지 않은 이유: 그 하네스들은 `sleep` 을 즉시 반환 스텁으로 바꿔 티커 자식의 대기가 사라지고 가짜 시계·틱 수가 뒤섞인다. 시험 항목 — 정적: 메인 루프 호출 0 · 전체 호출 1(티커 블록 안) · `CALL_MAX_TIME` 대입 1(블록 안, 메인 루프 0) · 상수 20 불변 · `flock -n` 1 · `kill -0` 1 · `trap` 0 · 기동 자식 1 · 기동 실패 로그 · 블록이 메인 루프 앞 · entry-watcher·holding-checker·strategy-eval 은 메인 루프에 남고 티커 블록엔 없음 · 하트비트 쓰기 2곳 · `bash -n`. 동작: 락 점유 시 호출 0·반환 0, 락 해제 후 1회(상한 20) · 부모 없으면 스스로 종료(호출 0) · 바쁜 루프 가드 종료(호출 0·로그 1줄) · 서브셸 호출 뒤 부모 `CALL_MAX_TIME` 빈 값 · 분 경계 계산 3케이스 · 정상 회차 1회 호출.
- [12:41] D4 — 시험을 쓰다 함정 2개를 실제로 밟았다(첫 실행 FAIL 3건): ① `flock <파일> -c 'sleep 5'` 를 PID 로 TERM 해도 **자식이 fd 를 물려받아 락이 남는다** → 해제를 확인하는 대기 루프(최대 12초)를 넣었다. ② 블록 표지 grep 을 `^#` 로 앵커하면 들여쓴 `  # >>> heartbeat-refresh` 를 놓친다. 프로세스 종료는 전부 **PID 로만** 했다(ISS-0002 — `pkill`·이름 패턴 금지).
- [12:41] D5 — 두 블록 시험에서 「기존 줄 변경 0 — HEAD 대비 추가만」 **케이스만** 지우고 그 자리에 삭제 이유 주석(지시한 3가지 근거)을 남겼다. 머리 주석의 항목 목록도 맞췄다. 다른 단정은 손대지 않았다. `execFileSync`·`REPO` 는 두 파일에서 여전히 쓰이므로 미사용 심볼이 생기지 않는다.
- [12:54] 실시간 스모크(가짜 curl·**실제** sleep·date·flock, 임시 HOME·임시 .env, 외부 호출 0, 종료는 PID 로만) — 서버에서 직접 돌린 결과: 러너 시작 로그에 `stop-alert 티커 시작 — pid 161491` 1줄 · 티커가 **12:50:00 · 12:51:00 · 12:52:00 에 각 1회**(`--max-time 20`) = 분 경계 정렬 작동 · 메인 루프 분당 잡은 러너 기동 시각대로 12:49:26·12:50:26·12:51:26·12:52:26(stop-alert **없음**) → 두 일정이 독립 · 프로세스 트리는 자식 1개(각자 `sleep 60`) · 부모만 `kill -9`(treekill 없이) 한 뒤 75초 동안 stop-alert 호출 **3 → 3**(늘지 않음)·티커 프로세스 소멸 = 고아 방지 확인. (pm2 실측 `treekill: true` 라 정상 경로에서는 pm2 가 트리를 죽인다 — 이 시험은 그게 실패한 경우를 흉내 낸 것이다.)
- [12:54] **확인하지 못한 것(정직하게)**: ① 긴 틱(수백 초)에서 하트비트 중간 갱신이 실제로 나이를 줄이는지는 **실시간으로 보지 못했다** — 구조(갱신 줄이 `jrl_flush` 앞)와 운영 로그 계산으로만 말한다. ② 운영에서 티커가 실제 `/api/cron/stop-alert` 를 부르는 모습(배포 뒤 1분·10분 관찰)은 아직 없다 — 개발에서 cron 라우트를 부르지 않았다. ③ 배포 컷오버 때 옛·새 티커가 겹치는 1~3초 창에서 `flock` 이 실제로 한쪽을 건너뛰는지는 **시험 하네스에서만** 봤다(실제 blue/green 컷오버 관찰 없음). ④ 텔레그램 중복 발송 여부(사용자가 알림을 두 번 받지 않는지)는 실환경 관찰이 필요하다. ⑤ `job_run_log` 에 stop-alert 행이 티커 호출로도 그대로 쌓이는지는 DB 로 확인하지 않았다(러너 후크 경로는 call() 공용이라 코드상 동일).
- [13:40] 돌린 명령과 결과(전부 서버 `ssh home_ubuntu`, 무거운 것은 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10` 로 직렬) —
  `bash -n scripts/cron-runner.sh` **통과** /
  신규 `bash scripts/test-cron-runner-alert-ticker.sh` → **PASS=40 FAIL=0 SKIP=0**(최종 코드로 연속 3회 같은 결과. 아래 묶음 실행 때의 39 는 ⑩ 단정을 더하기 전 값) /
  `npx jest src/app/api/cron/broker-fills src/app/api/cron/kis-fundamentals-snapshot src/app/api/cron/stop-alert` → **4 suites / 74 tests 전부 통과**(D5 로 단정을 뺀 블록 시험 2개 포함) /
  추가로 러너 원문을 읽는 jest 4개도 통과 — `job-slots.test.ts` 19/19(러너 라벨·주기 정합: stop-alert 가 티커로 옮겨가도 「조건 없는 매 분 잡」으로 그대로 인식된다) · `job-run-log.test.ts`·`profit-engine/isolation.test.ts`·`overseas-universe-refresh` 합계 195/195.
- [13:40] 🔴 **기존 러너 시험 8개는 전부 실패한다**(`/tmp/t147-runner-tests.log`): daily-bars 56/25 · holdings-premarket 47/6 · job-run-log 154/54 · news-peek 67/14 · news-split 86/33 · overseas-universe 23/6 · pmo-retry 69/7 · stop-alert 9/13 → **합계 PASS=511 FAIL=158**. 원인을 네 갈래로 분류했다(전부 구조적이고, 운영 동작 결함은 하나도 아니다):
  (A) **의도된 삭제** — 6개 스크립트가 「기준 ref 의 모든 줄이 순서대로 남아 있다(추가만)」·「다른 잡 호출 목록 = 기준 러너(sha256)」를 단정한다(daily-bars D6 · holdings H9 · job-run-log J8 · news-split F6 · overseas-universe U4 · pmo-retry 2건). **D5 가 고친 TS 블록 시험 2개와 똑같은 불변식이 shell 쪽에도 6개 더 있었다** — 지시 범위(TS 2개)가 부족했다. 참고로 holdings 의 실패 메시지 자체가 해법을 적어 뒀다: "다른 task 와 합친 뒤라면 T119_BASE_REF 를 지정".
  (B) **가짜 시계 궤적 변화** — 하네스의 `sleep` 스텁이 **클럭을 인자만큼 밀고 틱 카운터를 올린다**. 티커 자식도 같은 PATH 스텁을 쓰므로 그 대기가 가짜 시계에 반영돼 모든 일정이 1~3분 밀린다(pmo 08:00→08:01 · peek 10:30→10:33 · stop-alert 하네스 틱 20회→17회 · overseas U3 는 01:11 이 01:12 로 밀려 「짝수 분」이 돼 호출 1회). **운영에는 없는 현상**이다(티커는 시간을 건드리지 않는다. 실시간 스모크에서 메인 루프와 티커의 일정이 서로 독립이었다).
  (C) **하트비트 간격 단정** — 하네스는 「틱 끝에서 읽은 하트비트」로 간격을 재므로 D3 갱신이 들어가면 인덱스가 한 칸 밀려 긴 틱이 다른 간격에 붙는다(366·380초로 보임). **실제 최악 나이는 늘지 않았다** — 쓰기를 하나 더 하는 것은 「마지막 기록 시각」을 늦출 수만 있고, 운영 로그 실측도 412 → 352초로 줄었다.
  (D) **stop-alert 하네스 고유** — `scripts/test-cron-runner-stop-alert.sh` 의 B·C 절은 「메인 루프가 매 틱 stop-alert 를 부른다」를 단정하므로 **설계상 폐기 대상**이다(A 절의 상수·호출 줄 1개 단정만 유효하고, 그 둘은 새 시험이 이미 본다). 늘어짐·실패 격리 단정은 이제 구조로 보장된다(메인 루프가 그 잡을 아예 부르지 않는다).
- [13:40] 범위 밖이라 **고치지 않은 것** — 위 8개 스크립트. (A) 는 선례대로 「기준 쪽에서 그 3줄을 지우는 strip 함수 + 비교에서 stop-alert 제외」(T-145 ⑨ 의 `no_kf_old` 방식, 파일당 2~4줄) 로 풀리고, (B) 는 그 방법으로 **풀리지 않는다** — 티커가 하네스의 `sleep` 스텁을 쓰는 한 가짜 시계가 밀린다. (B) 까지 없애려면 러너에 티커 off 스위치(예 `ALERT_TICKER=off`)를 두고 8개 하네스가 그것을 켜 주는 방식이 현실적이다. 스위치를 **지금 넣지 않았다** — 쓰는 곳 없이 추가하면 죽은 코드가 되고, 8개 파일 편집이 이 task 범위 밖이기 때문이다. Leader 판단 사항.
- [13:40] 전체 출력이 필요한 3개(daily-bars·holdings-premarket·job-run-log)는 `tail -40` 때문에 실패 줄이 잘렸다 → 전체 출력 재실행을 큐에 넣어 뒀다(같은 flock 뒤에서 순차 실행): `/tmp/t147-rerun-full.log`(daily-bars + holdings-premarket) · `/tmp/t147-rerun-jrl.log`(job-run-log). Reviewer·QA 가 그 두 로그를 바로 쓸 수 있다.
- [14:05] **Leader 보정 ①~④ 반영.** ②(레거시 모드 env)에 반대하지 않았다 — 안전장치를 끄는 게 아니라 **현재 운영 동작으로 되돌리는** 스위치이고(DRY_RUN·KILL_SWITCH·한도·심볼 어느 것도 건드리지 않는다), 8개 하네스는 자기 잡의 회귀망이라 T-147 과 얽지 않는 편이 맞다. 다만 이름이 "티커 끄기"인데 **하트비트 추가 쓰기까지** 끄므로 뜻이 둘이다 → 러너 주석·기동 로그에 「T-147 전체를 되돌린 레거시 모드」로 못 박았다.
- [14:05] ① fail-open — 플래그 하나(`ALERT_TICKER_ACTIVE`, 초기값 0)가 호출자를 정한다. 1 = 티커, 0 = 메인 루프. 1 로 올리는 곳은 기동 1곳, 0 으로 내리는 곳은 감독 1곳뿐이라 **두 호출자가 동시에 참일 수 없다**(그 두 줄의 유일성을 새 시험이 정적으로 고정한다). ACTIVE=0 이 되는 경우는 셋 — `flock` 없음·락 파일 못 만듦 / `ALERT_TICKER_DISABLE=1` / 티커가 죽어 감독이 내림. 세 경우 모두 메인 루프의 `# >>> stop-alert-fallback` 블록이 **예전 3줄 그대로**(`CALL_MAX_TIME` → `call` → 되돌리기) 매 틱 부른다. 최초 구현의 "로그 한 줄 남기고 아무도 안 부름"은 지적대로 fail-closed 가 아니라 **알림 소실**이었다.
- [14:05] ① 감독 — 메인 루프 매 틱 `# >>> alert-ticker-supervise` 에서 `alert_ticker_alive` 로 확인하고, 죽었으면 ACTIVE=0 + 전환 로그 1줄(ACTIVE 가 이미 0 이면 아무것도 하지 않아 매 분 같은 줄을 찍지 않는다). ACTIVE 는 **1 → 0 으로만** 내려간다(되살리지 않는다 — 그래야 호출자 하나가 유지되고 사람이 원인을 본다). 감독 블록을 fallback 블록 **앞**에 뒀다(같은 틱에 전환이 반영된다 — 그 순서도 시험이 고정).
- [14:05] ① `kill -0` 의 좀비 함정을 실측으로 확인했다: 서버 bash 5.1.16 에서 비대화형 셸은 배경 자식을 SIGCHLD 로 곧 reap 해서 `kill -0` 이 **제대로 실패**했다(`/tmp/t147-zombie.sh` 실행 — kill -0 실패 · /proc 항목 없음 · `jobs -rp` 비었음). 다만 전경 curl 때문에 reap 이 미뤄지는 짧은 창이 이론상 있어 `alert_ticker_alive` 에 `/proc/<pid>/stat` 상태 문자 검사(`Z` → 죽음)를 보조로 넣었다. /proc 을 못 읽으면 `kill -0` 결과를 그대로 믿는다.
- [14:05] ② 레거시 모드 — `ALERT_TICKER_DISABLE=1` 이면 ⓐ 티커를 띄우지 않고(ACTIVE=0 → 메인 루프가 매 틱 호출) ⓑ `# >>> heartbeat-refresh` 의 추가 쓰기를 건너뛴다(틱 시작 기록은 그대로). 기동 로그에 `🔶 ALERT_TICKER_DISABLE=1 — 레거시 모드(T-147 이전 동작): …` 한 줄. 운영에는 **어디에도 넣지 않았다** — 실측 확인: `ALERT_TICKER` 참조는 `scripts/` 안(러너 + 하네스 9개)뿐이고 `.env.example`·`ecosystem.config.js` 는 각 0건.
- [14:05] ③ 하네스 — 러너 호출 env 10곳(8개 파일: pmo-retry 3곳, 나머지 1곳씩)에 `ALERT_TICKER_DISABLE=1` 과 이유 주석을 넣었다. 정적 비교가 있는 **5개**(daily-bars·holdings-premarket·job-run-log·news-peek·news-split)에는 `no_kf_old` 선례 그대로 헬퍼 2개를 넣고 비교 양쪽에 끼웠다 — `no_t147`(지금 러너에서 T-147 네 블록을 표식으로 지움) · `no_t147_old`(기준 ref 에서 옛 stop-alert 4줄을 범위로 + 머리 주석 1줄을 지움). `CALL_MAX_TIME=""` 는 러너에 여러 번 나오므로 grep 이 아니라 **범위 awk**(`# 매 1분: stop-alert` → 첫 `CALL_MAX_TIME=""`)로 지운다. overseas-universe·pmo-retry·stop-alert 에는 소스 대조가 없어 env 한 줄로 끝났다(실패가 전부 가짜 시계 궤적이었다). `T119_BASE_REF` 류로 기준을 옮기지 않았다 — 지시대로, 기준을 옮기면 「추가만」 불변식이 무의미해진다.
- [14:05] ③ 작업 중 실수 1건 — news-split 치환이 의도한 `strip_new` 외에 `strip115`(F7 비교)에도 걸려 그 함수가 `"$1"` 인자를 잃었다. 발견해서 `strip115` 도 같은 방식(`no_t147 < "$1" | …`)으로 **완성**하고 짝인 `strip103` 에 `no_t147_old` 를 넣었다 — F7 도 같은 대조이므로 결과적으로 필요한 수정이었다.
- [14:05] ③ `test-cron-runner-stop-alert.sh` 는 **지우지 않았다.** 머리 주석에 「이 시험이 보는 것은 레거시 모드의 동작이고, 그 모드는 죽은 코드가 아니라 fail-open 되돌림 경로의 회귀망이다 / 기본 모드는 alert-ticker 시험이 본다」를 적고, A 절의 「호출 줄 1개」만 새 구조(2개 = 티커 + fallback, 그중 fallback 1개)로 고쳤다. 결과 **PASS=23 FAIL=0**(보정 전 9/13) — 하트비트 간격 정확 비교(60·80·200초)까지 수정 없이 통과했다.
- [14:05] ③ 범위 밖 파일 1개를 추가로 고쳤다(보고) — `src/lib/strategy/records/__tests__/job-slots.test.ts` 의 「라벨 중복 없음」 단정. T-147 이 `stop-alert` 라벨의 호출 줄을 2개로 만들었다(배타적). `stop-alert` 하나만 중복을 허용하고 **나머지 라벨은 여전히 중복 0**으로 좁혀 고쳤다(같은 잡을 두 번 부르는 실수를 잡는 원래 목적 유지 + 배타성은 alert-ticker 시험이 증명). 지시의 "시험 외 앱 코드 금지" 범위 안이다(시험 파일).
- [14:05] ④ 주석 교정 — heartbeat-refresh 블록 주석에서 틀린 주장("최악이 sleep 60 + 약 1초", "328+60=388")을 지우고 ⓐ 실측(3,119틱: 주기 mean 66.3·max 412·>300s 12틱 / 길이 mean 6.4·max 352·>300s 4틱) ⓑ **좁아지지만 닫히지 않는다**(352 > 300) ⓒ 안 닫는 이유 네 가지(call() 마다 쓰기는 단일 `strategy-eval` 약 298초로 여유 2초 · 임계 상향은 HOME-SERVER 설정이라 사용자 결정 · 배경 하트비트 작성자는 워치독 영구 무력화 · 근본은 `src/lib/strategy/engine.ts:1455` 직렬 루프 동시성 제한으로 별건)를 적었다. alert-ticker 블록의 "max 328초"도 실측값으로 교체. T-145 ④-조각의 스테일 주석(삭제된 단정을 "규약"으로 인용)도 같이 고쳤다. 새 시험이 이 교정을 고정한다 — 틀린 문구가 없고(0건) 실측값 2개가 있다.
- [14:10] 🔴 **보정 뒤에도 남은 구멍 1개(고치지 않았다 — Leader 판단 요청).** 기동에는 성공했는데 `flock` 이 **런타임에 계속 실패**하는 경우(락 파일은 만들어졌지만 잠금이 동작하지 않는 파일시스템 등)에는 `alert_ticker_once` 가 매 회차 조용히 건너뛰고, 티커는 살아 있으니 감독도 ACTIVE 를 내리지 않는다 → **알림이 조용히 멈춘다**(①이 없앤 것과 같은 종류의 구멍이 더 좁은 경로에 남는다). 락 파일이 로컬 디스크(ext4)라 현실성은 낮지만 **관측이 0** 인 게 문제다. 두 가지 중 하나를 고르면 6줄로 닫힌다 — ⓐ 연속 실패 3회에 **경고 1줄만** 찍고 계속 시도(두 번째 호출자를 만들지 않는다 — 내 권고) ⓑ 연속 실패 3회에 티커를 끝내 감독이 메인 루프로 넘김(알림은 보장되지만, 옛 러너가 3분 이상 락을 쥔 병리적 상황에서는 두 호출자가 생길 수 있다). 지금 손대지 않은 이유: 하네스 9개가 **실행 중에 러너 원문을 읽는다** — 그 와중에 러너를 고치면 이번 수치가 신뢰할 수 없게 된다.
- [15:10] 보정 뒤 1차 전체 재실행(서버, 전부 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10`, 로그 `/tmp/t147-final.log`·suite 별 `/tmp/t147-out-*.log`): alert-ticker **72/0** · daily-bars **81/0**(전 56/25) · news-peek **81/0**(전 67/14) · news-split **119/0**(전 86/33) · overseas-universe **29/0**(전 23/6) · pmo-retry **76/0**(전 69/7) · stop-alert **23/0**(전 9/13). 남은 둘은 **내 주석·로그가 원인**이었다 — ① holdings-premarket 52/1: 내가 러너 ② 주석에 하네스 이름을 열거했는데 그 하네스가 「자기 블록을 지운 러너에 자기 잡 이름이 0건」을 단정한다(설명하려고 이름만 적어도 깨진다) → 주석에서 이름 열거를 빼고 **그 함정을 주석으로 남겼다** ② job-run-log 202/6: 실패 6개가 전부 같은 원인 — 레거시 모드 기동 로그 **한 줄**이 기준 러너에는 없어 `diff stdout` 이 그 줄만큼 달랐다 → 그 하네스에 `no_t147_log` 필터를 넣어 로그 줄 비교에서만 뺐다(그 줄 자체는 새 시험 E1 이 본다). 두 수정 뒤 세 suite 를 재실행했다.
- [15:10] jest(러너 원문을 읽는 것 + D5 대상 전부): `src/app/api/cron/{broker-fills,kis-fundamentals-snapshot,stop-alert,overseas-universe-refresh}` · `src/lib/strategy/records` · `src/lib/profit-engine/__tests__/isolation.test.ts` → **18 suites / 819 tests 통과, 실패 0**(DB 필요한 2 suite·90 tests 는 설계대로 skip). 그 과정에서 `src/lib/strategy/records/__tests__/job-slots.test.ts` 의 「라벨 중복 없음」 1건이 실제로 깨졌고(T-147 이 `stop-alert` 호출 줄을 2개로 만들었다) `stop-alert` 하나만 허용하도록 좁혀 고쳤다 — 위 [14:05] 기록.
- [16:35] **최종 수치 — FAIL=0.** 러너 시험 9개(서버, `flock … nice -n 10` 직렬): alert-ticker **72/0** · daily-bars **81/0** · holdings-premarket **53/0** · job-run-log **208/0** · news-peek **81/0** · news-split **119/0** · overseas-universe **29/0** · pmo-retry **76/0** · stop-alert **23/0** → **합계 PASS=742 FAIL=0**(보정 전 같은 9개는 550/158). jest: **18 suites / 819 tests 통과 · 실패 0**(DB 필요 2 suite·90 tests skip). `bash -n`: 러너 + 하네스 9개 전부 통과. 로그 — 1차 `/tmp/t147-final.log`, 재실행 `/tmp/t147-final3.log`, suite 별 `/tmp/t147-out-<이름>.log`.
- [16:35] 최종 변경 파일 13개 — `scripts/cron-runner.sh`(+175/−6) · `scripts/test-cron-runner-alert-ticker.sh`(신규 279줄) · 하네스 8개(daily-bars +13/−4 · holdings-premarket +12/−3 · job-run-log +15/−2 · news-peek +12/−3 · news-split +14/−5 · overseas-universe +4/−1 · pmo-retry +8/−3 · stop-alert +15/−2) · jest 3개(broker-fills 블록 +12/−17 · kis-fundamentals 블록 +15/−16 · job-slots +8/−1). 커밋하지 않았다 — Mac 세션은 `commit-msg` 훅이 돌지 않으므로 **서버에서** 커밋해야 하고, 13개 중 러너·하네스 9개·블록 시험 2개가 `SAFETY_PATHS` 대상이라 Reviewer 판정 줄의 scope 에 `scripts/cron-runner.sh`·`scripts/test-cron-runner-*`·`src/app/api/cron/`(+ `src/lib/strategy/records/` 는 감시 밖이지만 함께 검토)가 들어가야 한다.
- [16:35] 실시간 재확인(이번 보정 코드로): E1 레거시 모드 — 티커 미기동·메인 루프가 매 틱 호출 / E2 fail-open — 락 파일 못 만들면 경고 2줄 + 메인 루프가 매 틱 호출 / E3 기본 — 티커가 `:00` 에만 호출(전수)·메인 루프는 0회, 티커를 **PID 로** `kill -9` 하면 다음 틱에 전환 로그 1줄 + 메인 루프가 이어받고 호출 수가 늘어난다. 세 경로 모두 **알림이 끊기지 않는다**를 수치로 확인했다.
- [16:45] 🔴 **앞선 [15:10]·[16:35] 기록의 수치는 신뢰할 수 없다 — 내 실수를 정정한다.** 14:02 에 "죽었다"고 판단해 다시 띄운 전체 실행이 **실제로는 살아 있었다**(PID 1014701, 14:03 시작, 발견 시각 16:3x 까지 2시간 반 동안 5번째 suite 를 돌고 있었다). 두 프로세스가 같은 로그 파일(`/tmp/t147-final.log`)에 각자의 오프셋으로 썼고, suite 별 로그도 서로 덮어썼다 — 그래서 그 파일에는 **서로 다른 코드 상태·서로 다른 프로세스의 결과가 섞여** 있었다(형식이 다른 블록 두 종류와 잘린 `peek.sh` 조각이 증거다). 교훈: 백그라운드 작업을 "로그가 비었고 ps 에 없다"로 죽었다고 단정하면 안 된다 — **PID 를 받아 그 PID 로 확인**해야 한다. 조치: 그 프로세스와 자식을 **PID 로** 전부 정리(`/proc/<pid>/cmdline` 으로 내 것 확인 후 kill, `pkill` 미사용)하고 오염된 로그를 지웠다. 그 뒤 **단일 프로세스로 9개 전부 재실행**(`/tmp/t147-runfinal.sh`, suite 별 `/tmp/t147f-*.log`)하며 러너 sha256 을 시작·끝에 찍어 실행 중 코드 불변을 증명하게 했다.
- [16:45] ⑫ 남은 구멍(런타임 `flock` 실패)을 Leader 지시대로 닫았다 — **먼저 측정**했다(`/tmp/t147-flockrc.sh`, 서버 `flock from util-linux 2.37.2`): 다른 프로세스 점유 **rc=1** · 공유락 점유 중 배타락 **1** · fd 9 미개방 **65** · `flock` 없음 **127** · 디렉터리 fd **0**. 구조적 오류는 1 이 아니라 구분이 **된다** → 두 분기를 모두 넣었다. ⚠ 측정에서 **읽기전용 fd(`9<`)도 1** 이 나왔다(경합 아님) — 이 코드는 락 fd 를 **항상 `9>`** 로 열어 그 조건이 구조적으로 불가능하므로 1 을 경합으로 읽는다. 그 전제를 주석에 못 박았다(리다이렉션을 `9<` 로 바꾸면 판정이 깨진다). 락을 지원하지 않는 파일시스템의 flock(2) 오류는 재현할 마운트가 없어 **측정하지 못했다**.
- [16:45] ⑫ 구현 — `alert_ticker_once` 반환을 셋으로 갈랐다: 0 불렀다 / 1 경합(`ALERT_TICKER_LOCK_BUSY_RC=1`) / 2 진짜 오류(락 파일을 열 수 없어 그룹이 돌지 않으면 초기값 255 가 남아 2 가 된다). 루프는 ① 경합이면 그 회차만 건너뛰고 연속 `ALERT_TICKER_MAX_LOCK_SKIPS=3` 번째에 **경고 한 줄만**(카운터는 계속 올라가 다시 같아지지 않으므로 매 분 반복하지 않는다. 호출자를 늘리지 않는다 — 겹친 티커가 지금 알림을 보내는 중이다) ② 진짜 오류면 로그 한 줄 남기고 `return` → **기존 감독**이 다음 틱에 `ALERT_TICKER_ACTIVE=0` 으로 내려 메인 루프가 이어받는다(새 분기를 만들지 않았다). 그 경우 두 번째 호출자가 없으니 이중 발송 위험이 구조적으로 없다.
- [16:45] ⑫ 시험 — 새 시험에 정적 6건(상수 2개 · 반환 3분기 · 경고가 `=` 비교 · 경합 분기에 return 없음 · 주석의 측정값)과 동작 5건(경합 반환 1 · 경합 6회차에 호출 0·경고 **정확히 1줄**·티커 종료 없음 / 진짜 오류 반환 2 · 로그 1줄 뒤 종료 · 호출 0 · "경합 아님" 문구)을 넣었다. 결과 **PASS=86 FAIL=0**(⑫ 추가 전 72/0). 작성 중 내 시험 버그 1건(`grep -c` 가 0건에 exit 1 이라 `|| echo 0` 이 값을 두 줄로 만들었다)을 잡아 고쳤다.
- [18:05] **최종 수치 — FAIL=0 (단일 프로세스·코드 불변 증명).** `/tmp/t147-runfinal.sh` 로 하네스 9개를 **한 프로세스에서 순차** 실행하고 러너 sha256 을 시작·끝에 찍었다 — `START 16:44:15 runner_sha=78212d789f5f87eb` / `END 18:02:25 runner_sha=78212d789f5f87eb` (동일 = 실행 중 코드가 바뀌지 않았다. 앞선 오염 사고의 재발 방지 장치다). 결과: alert-ticker **86/0**(16:46) · daily-bars **81/0**(16:53) · holdings-premarket **53/0**(17:12) · job-run-log **208/0**(17:22) · news-peek **81/0**(17:44) · news-split **119/0**(17:50) · overseas-universe **29/0**(18:00) · pmo-retry **76/0**(18:02) · stop-alert **23/0**(18:02) → **합계 PASS=756 FAIL=0**. suite 별 로그 `/tmp/t147f-<이름>.log`, 요약 `/tmp/t147-runfinal.log`.
- [18:05] 같은 sha(78212d78)에서 jest **18 suites / 819 tests 통과 · 실패 0**(DB 필요 2 suite·90 tests skip), `bash -n` 러너 + 하네스 9개 전부 통과. 시험용 프로세스·Monitor tail 까지 **PID 로** 정리해 서버에 남은 것 0 건을 확인했다(`pkill` 미사용).
- [18:05] 최종 변경 13개 — `scripts/cron-runner.sh`(+208/−6) · `scripts/test-cron-runner-alert-ticker.sh`(신규 318줄) · 하네스 8개(+13/−4 · +12/−3 · +17/−4 · +12/−3 · +14/−5 · +4/−1 · +8/−3 · +15/−2) · jest 3개(+12/−17 · +15/−16 · +8/−1). 커밋하지 않았다 — 서버에서 커밋해야 하고(Mac 은 `commit-msg` 훅이 돌지 않는다), Reviewer 판정 줄 scope 에 `scripts/cron-runner.sh` · `scripts/test-cron-runner-*` · `src/app/api/cron/` 가 들어가야 한다(`src/lib/strategy/records/__tests__/job-slots.test.ts` 는 `SAFETY_PATHS` 밖이지만 같은 변경의 일부다).

## Reviewer

(독립감사 — reviewer 가 채운다)
- [19:38] 범위·방법 — 변경 13개의 diff 전체를 직접 읽었다(러너 +208/−6 포함. 다른 세션 변경분 `.codex/**`·`.claude/agents/claude.md`·T-112/T-137/T-145 vault 는 범위 밖). 서버에 스냅샷(`/tmp/rev-t147`, 러너 sha256 앞 16자 `78212d789f5f87eb`)을 떠 **단일 프로세스·`flock /tmp/stockinvest-heavy-tests.lock nice -n 10` 직렬**로 재실행했다. 시작 18:15:40 · 끝 19:33:25 모두 스냅샷 sha = 작업 트리 sha 동일, 실행 뒤 하네스 스크립트 10개도 작업 트리와 바이트 동일(중간 변경 없음). 구현자 보고 수치는 판정 근거로 쓰지 않았고 아래는 전부 내가 본 값이다. 로그 `/tmp/rev-t147/logs/*.log`·요약 `/tmp/rev-t147/summary.log`.
- [19:38] 내가 본 시험 수치(전부 재실행, 미재실행 0) — alert-ticker 통과 86 / 실패 0 · stop-alert 23/0 · job-run-log 208/0 · daily-bars 81/0 · news-split 119/0 · pmo-retry 76/0 · overseas-universe 29/0 · holdings-premarket 53/0 · news-peek 81/0 → **합계 통과 756 / 실패 0**(구현자 보고와 같은 값, 내 실행 기준). jest(`broker-fills`·`kis-fundamentals-snapshot`·`stop-alert`·`overseas-universe-refresh`·`strategy/records`·`profit-engine/isolation`) **18 suites / 819 tests 통과, 2 suites·90 tests skip(DB 필요)**. `bash -n` 러너 통과. 신규 시험 skip 0.
- [19:38] 추가 독립 실측(내가 만든 임시 하네스 `/tmp/rev-t147/exp/*` — 실제 러너 기본 모드, curl 만 스텁, 임시 HOME, 종료는 PID 로만) — ① 40초 걸리는 `strategy-eval` 틱: 기본 모드는 하트비트가 T0 와 T0+40초 **두 번** 쓰이고 `stop-alert` 는 그 틱 안(26초, 분 경계)에 티커가 호출했다 / 레거시 모드는 T0 한 번뿐 · ② 호출 주체 귀속(스텁이 조상 pid 체인을 기록): 티커 kill -9 전 stop-alert 는 전부 티커 자식 소속, 후에는 감독이 다음 틱에 전환 로그 1줄을 찍고 이후 메인 루프 소속만 틱당 1회(공백 최대 98초 = 사망 시점 → 다음 틱, 설계된 복구 지연) · ③ 러너 2개가 같은 락을 쓰는 겹침: 분당 호출 1회(0.4초 호출 동안 다른 티커가 락 경합으로 건너뜀) · ④ pm2 TreeKill 순서(자식 먼저·부모, SIGINT)를 실제 러너 트리(러너+티커+그 sleep)에 적용 → 1.7초(kill_timeout 1.6초) 안에 전부 종료.
- [19:38] 항목1 PID 재사용 — **메커니즘은 실재, 이 서버에서의 확률은 무시할 수준.** 내 실측: `alert_ticker_alive` 에 같은 사용자의 무관한 살아 있는 pid(pm2 데몬)를 넣으면 `alive` 로 판정한다(다른 사용자 pid 는 `kill -0` EPERM 이라 `gone`). 그 방향의 오판 = 손절 알림 조용한 정지다. 다만 `pid_max`=4,194,304·실측 pid 소비 약 6~10개/초 → 커널의 순환 할당이 한 바퀴 도는 데 약 5~7일이라, 죽은 pid 가 **죽은 직후 몇 분 안에** 다시 같은 번호로 배정되려면 러너 가동 시간이 정확히 한 바퀴 주기이고 새 주인이 장수하는 같은 사용자 프로세스여야 한다. 값싼 보강 있음: 티커는 부모의 자식이므로 `/proc/<pid>/stat` 4번째 필드(ppid)가 `$$` 인지 함께 보면 된다(내 실측: 진짜 자식은 `alive`, pm2 데몬 pid 는 `gone`; bash 내장 `jobs -rp` 도 같은 결과) — 3줄, 신규 상태 없음. 반대 방향(자식이 부모를 `kill -0` 으로 보는 고아 확인)도 같은 약점이나 pm2 TreeKill 이 자식을 같이 죽여 정상 경로에서는 쓰이지 않는다. 심각도 낮음(R-1).
- [19:38] 항목2 `rc=1 ⟹ 경합` — **전제는 코드에서 보장되고, 구현자가 적은 의존 조건은 틀렸다.** 내 실측(util-linux 2.37.2): 자유 락 + 쓰기 fd 0 · **자유 락 + 읽기전용 fd(`9<`) 0** · 경합(쓰기·읽기 fd 모두) 1 · fd 미개방 65 · 락 파일 열기 실패는 그룹이 안 돌아 초기값 255 → 코드의 `*)` 분기(진짜 오류). 구현자가 적은 "읽기전용 fd 도 1"은 **그 측정 스크립트의 오류**다 — `/tmp/t147-flockrc.sh` ①에서 `flock $L -c "sleep 4"` 홀더를 TERM 으로 끝냈지만 자식 sleep 이 fd 를 물려받아 락이 남아 있었고(구현자가 D4 에서 스스로 밟은 바로 그 함정), ③의 1 은 그 경합이었다. 따라서 "리다이렉션을 `9<` 로 바꾸면 판정이 깨진다"는 주석은 사실이 아니다(무해하지만 틀린 주석, R-2). 락 비지원 파일시스템의 flock(2) 오류는 util-linux 에서 EWOULDBLOCK 이 아닌 한 71(EX_OSERR) 등 1 이 아닌 코드라 오판이 **안전한 쪽**(티커 종료 → 감독 인수)으로 기울고, 락 파일은 로컬 ext4(`df -T` 실측)라 해당 경로 자체가 없다. 비지원 FS 실측은 하지 못했다(미확인).
- [19:38] 항목3 전이 구간 — **호출자가 동시에 둘이 되는 창을 찾지 못했다.** `ALERT_TICKER_ACTIVE` 를 1 로 올리는 곳은 기동 1곳(포크 직후), 0 으로 내리는 곳은 감독 1곳이고(정적 시험이 고정, 내가 `grep` 으로도 3곳만 확인) 감독이 내리는 조건은 `kill -0` 실패 또는 /proc 상태 Z, 즉 **티커가 이미 죽었을 때뿐**이라 자식이 `alert_ticker_once` 안에 있는 동안 플래그가 내려가는 순서는 불가능하다. 내려간 뒤 되살리지 않으므로 재진입도 없다. 티커가 kill -9 된 순간 그 curl(손자)이 20초까지 더 살 수 있으나 같은 틱 메인 루프 호출은 서버 `runningSince`(route.ts:304-307, 같은 Node 프로세스 안 겹침이면 `skipped: in_progress` 200)가 막는다. 배포 컷오버는 `release.sh` 가 `pm2 startOrReload --update-env` 로 fork 앱을 재시작(정지 → 기동)하고 옛 러너 트리는 TreeKill 로 같이 죽는다(위 ④) — 겹침이 생겨도 위 ③처럼 flock 이 분당 1회로 줄인다. **단 flock 은 상호배제이지 중복 제거가 아니다**: 호출이 끝난 뒤에 도착한 두 번째 티커는 락을 잡고 한 번 더 부른다(순차 2회). 이것이 이중 발송으로 이어지지 않는 이유는 아래 R-4.
- [19:38] 항목4 안전장치 우회·자원 — ① 티커가 닿는 라우트는 `alert_ticker_once` 에 하드코딩된 `/api/cron/stop-alert` 하나뿐이고(다른 경로를 넣을 변수 없음) 그 라우트는 주문·시그널·`position_state` 를 쓰지 않으며 쓰기는 `system_config.risk_stop_alert_state` 한 키다(route.ts 머리 주석과 코드 일치). KIS 는 시세 조회뿐이고 `critical`(주문) lane 과 분리돼 있다(kis-throttle.ts, `/api/portfolio`·`/api/ticker/all` 은 `bulk`). ② `CALL_MAX_TIME` 은 `alert_ticker_loop &` 가 서브셸이라 부모로 새지 않는다 — 시험 ⑤에 더해 기본 모드 실측 ①에서 메인 루프 다른 잡에 상한이 붙지 않음을 호출 기록으로 확인. ③ T-135 임시 파일: 이름이 `cron-runner-<부모 pid>.<mktemp 6자>` 라(서브셸의 `$$` 는 부모 pid) 부모·자식이 동시에 호출해도 충돌하지 않고, 자식 몫은 호출 끝의 `rm` 이 지우며 kill 로 남은 파일은 다음 러너 시작의 `call_tmp_init`(부모 pid 가 죽은 것만)이 정리한다 — 누적 없음. 예외: mktemp 가 실패하는 열화 상태에서는 `/tmp/cron-runner-$$.out` 폴백이 부모·티커에 **공유**돼 한쪽의 `rm` 이 다른 쪽 본문을 지울 수 있다(로그 본문·스풀 본문만 영향, 응답 코드 불변) — 극히 드문 열화의 열화, R-6. ④ T-112 스풀: 한 줄 덧붙이기는 O_APPEND 라 안 섞이고, 부모의 `mv … .fold` → `cat … >> .sending` → `rm .fold`(수 ms)와 티커의 덧붙이기(수 µs)가 겹칠 때만 한 줄이 빠진다. 분당 1줄 대비 창이 ms 라 확률 약 1e-4/틱이며 영향은 `job_run_log` 한 행이고(앱에 `missing` 합성이 v1 에 없어 경보로 번지지 않음, job-slots.ts 주석) 알림 발송과 무관 → **"기록 전용이라 허용" 판단은 타당하다.**
- [19:38] 항목5 시험 불변식 — **삭제는 타당하다(대체 불필요).** 삭제된 케이스는 `git show HEAD:scripts/cron-runner.sh` 와 비교하는 **개발 중 가드**라 T-147 이 커밋되는 순간 HEAD 가 T-147 러너가 되어 깨끗한 트리에서는 자명하게 참이 되고, 같은 불변식(기준 ref 의 모든 줄이 순서대로 남아 있다)이 고정된 옛 ref(faf8bc3·f91cd94·f218430·bf8450d·5d4fdd1·63f1044·0761fec)와 대조하는 shell 하네스 5개(D6·H9·J8·F6/F7·P7)에 **더 강한 형태로** 남아 있다. 내가 직접 확인한 것: `git diff` 상 러너에서 지워지거나 바뀐 기존 줄은 정확히 6개(`stop-alert` 머리 주석 1 + 실행 3 + T-145 ④-조각 주석 2)뿐이고, `no_t147_old` 는 위 7개 ref 전부에서 **정확히 5줄**(머리 주석 1 + 호출 4)만 지우며, `no_t147` 는 현재 러너에서 T-147 표지 안의 3구간(431-579·615-635·1041-1067, 합 197줄)만 지운다. 느슨해진 곳은 없다.
- [19:38] 항목6 레거시 모드 — 안전장치(DRY_RUN·KILL_SWITCH·한도·심볼)를 건드리지 않고 잘못 켜져도 결과가 "T-147 이전 동작"이라 **허용 가능**하다. 운영 유입 경로는 찾지 못했다: 저장소(스크립트·시험·task 외 0건, `ecosystem.config.js`·`.env.example` 0건), pm2 `jlist` 환경 키, `~/.pm2/dump.pm2`, 실행 중 운영 러너 `/proc/3098067/environ`, 배포 스크립트(`deploy-stockinvest.sh`·`release.sh`), HOME-SERVER_CONFIG, 셸 프로필 전부 0건; 러너는 `.env` 를 소싱하지 않고 `CRON_SECRET` 만 grep 한다. 시험 8개의 러너 호출 10곳은 전부 인라인 `ALERT_TICKER_DISABLE=1`(export 아님)이라 새어 나가지 않는다. 다만 **변질 위험은 구조에 있다**: ① 기존 8개 하네스가 지키는 것은 이제 기본 경로가 아니라 레거시(=fail-open 인수 경로)이므로 기본 모드 상호작용은 신규 시험 + 내 실측만이 본다 — 신규 시험 E 절은 하트비트 중간 갱신을 **동적으로 보지 않고**(정적만) ② "운영에 이 변수가 없다"를 지키는 기계적 가드가 없다(구현자의 수동 확인뿐). 배포 뒤 러너 로그에 `stop-alert 티커 시작` 이 있고 `레거시 모드`·`티커를 띄우지 못했다`·`사라졌다` 줄이 없는지 확인하면 유입이 즉시 드러난다(R-5).
- [19:38] 항목7 주석의 사실성 — 틀린 계산("sleep 60 + 약 1초"·"328+60=388")은 **본문 주장으로는 남아 있지 않다**(러너 `grep` 0건, 남은 두 줄은 명시적 철회). 하트비트 주석의 수치를 운영 로그(`cron-out.log`, 2026-11-03 18:19 기준 3,358틱)로 내가 다시 계산: 틱 주기 mean 66.6 · max **412** · 300초 초과 **12틱** / 틱 길이 mean 6.5 · max **352** · 300초 초과 3틱(회전된 이전 로그까지 합치면 4틱) — 주석의 12·412·352·"좁히지만 닫지 못한다" 결론과 일치(표본 창 차이로 길이>300 이 3~4). 감시자 설정도 확인: 순찰 `max_age_seconds` 300·`*/5` · 앱 워치독 `CRON_HEARTBEAT_STALE_SEC` 기본 300(cron-watchdog.ts:90) · 순찰은 `--periodic` 에서 `MAX_ATTEMPTS=1`·`RESTART_AFTER_ATTEMPT=1` 이라 **첫 실패에 바로 재시작**한다. 남은 흠은 사실 오류가 아니라 정리 문제(R-6): 자기 주석의 이력을 언급하는 문장(러너 1051·1053행 "처음 주석에 적었던…"), 그리고 이전 task 블록의 "하트비트는 틱 시작에만 쓰이므로 …"(151·271행 등)가 기본 모드에서는 더는 참이 아니다(보수적으로 과대 추정이라 위험 없음).
- [19:38] 🔴 사실 정정 요청(Leader — 사용자 보고에 옮겨 가지 않게) — ① 이 task `실측 ④` 의 "순찰은 아직 한 번도 발동하지 않았다 / 재시작 0회"는 **틀렸다**. `~/.local/log/autostart-recover.log` 에 `stockinvest-cron` 의 `pm2 restart 시도` + `ALERT: 하트비트 300s 이내 … 신호 없음` 이 **4건**(2026-09-29 03:55 · 10-08 15:55 · 10-30 22:55 · **2026-11-03 10:00:02**)이다. 오늘 건은 `cron-out.log` 로 원인이 보인다: 틱 09:54:34 시작 → `strategy-eval` 297초 → 09:59:32 틱 끝, 하트비트는 틱 시작에만 쓰여 10:00:02 에 나이 약 329초 > 300 → 재시작(러너는 `sleep 60` 중이었다). **D3 의 틱 끝 갱신이 있었다면 09:59:32 에 갱신돼 나이 30초 — 이 재시작은 일어나지 않았다.** 즉 D3 는 가설이 아니라 오늘 실제로 난 사고를 막는 변경이고, 남은 위험(길이>300 틱, 3~4건/3.5일, 그 틱에서 순찰이 걸릴 확률 (길이−300)/300 ≈ 최대 17%)도 실재한다. ② 구현자 노트 [18:05] 의 "`job-slots.test.ts` 는 SAFETY_PATHS 밖"도 **틀렸다** — `^src/lib/strategy/` 가 SAFETY_PATHS 에 있어 이 파일은 커밋 훅 대상이다(`awk '/^SAFETY_PATHS=\(/,/^\)/' scripts/git-hooks/commit-msg`). 그래서 아래 판정 scope 에 이 파일을 정확히 적었다(scope 는 `/` 로 끝나면 디렉토리, 아니면 파일 하나 — 훅 `files_out_of_scope`).
- [19:38] 발견 결함(전부 차단 아님) — critical 0 · high 0 · medium 0 · low 6. R-1 LOW `scripts/cron-runner.sh:559-571`(`alert_ticker_alive`)·`:527`(고아 확인): 생존 판정이 pid 번호만 본다 → ppid 대조 3줄 권고. R-2 LOW `:503-505`: "읽기전용 fd 도 1"·"`9<` 로 바꾸면 판정이 깨진다" 주석이 사실이 아님(위 항목2) → 문장 삭제. R-3 LOW(문서) task `실측 ④` 와 [18:05] 노트의 두 오류(위 정정 요청). R-4 LOW `:440-443`·`:628`·`:31`: "두 호출자 → 같은 알림 두 번"의 근거가 부정확하다 — 같은 Node 프로세스 안 겹침은 `runningSince`(route.ts:304-307)가 막고(`stockinvest` 는 `instances: 1`), 상태는 DB(`risk_stop_alert_state`)와 메모리 Map(10분)이 막는다. **단일 호출자가 필요한 진짜 이유는 호출 횟수에 의존하는 규칙**이다(`src/lib/risk/stop-alert.ts` `rearmConfirm: 2`=재무장 연속 2회 확인, `retryMax: 3`=발송 실패 3회 연속 → 호출자가 둘이면 분당 2회가 세어져 확인·대기가 절반으로 줄어든다). 설계 결론(플래그 하나로 한 명)은 그대로 옳고 주석만 고칠 것. R-5 LOW: 기본 모드 하트비트 갱신의 동적 시험 부재(내가 실측으로 대신 확인 — 위 ①) + `ALERT_TICKER_DISABLE` 운영 유입 가드·배포 후 로그 확인 부재. R-6 LOW: 이력 언급 주석(`:1051`,`:1053`)·낡은 보수적 하트비트 주석(`:151`,`:271` 등)·mktemp 실패 시 폴백 임시파일 공유.
- [19:38] 커밋 전 조치 권고 — 러너·시험 파일은 **고치지 말고 그대로 커밋**한다. R-1·R-2·R-6 은 러너를 바꾸므로 sha 가 달라져 하네스 9개(약 80분) 재실행과 이 감사의 전체 재순환이 필요한데, 위험 대비 이득이 작다 → 러너를 다시 건드리는 다음 task(예: `engine.ts` 평가 루프 동시성 별건)에 묶어 처리한다. R-3 은 코드 변경이 아니므로 Leader 최종 요약·사용자 보고에서 바로 정정한다. R-4 문구도 같은 후속에 묶는다.
- [19:38] QA 에게 넘기는 high_risk_areas — `scripts/cron-runner.sh:431-579`(티커 블록: 분 경계 정렬·flock 반환 셋·고아/바쁜 루프/좀비 가드) · `:615-635`(감독 + fallback, 호출자 하나) · `:1041-1067`(하트비트 갱신, 기본 모드에서만). 배포 후 관찰(내가 하지 못한 것): ① pm2 로그에 `stop-alert 티커 시작 — pid N` 1줄, `레거시 모드`·`티커를 띄우지 못했다`·`사라졌다` 0줄 ② `ps` 에 러너 1 + 티커 자식 1(`pm2 list | grep stockinvest-cron` 1행도) ③ 장중 `strategy-eval` 이 도는 동안에도 `stop-alert OK` 가 매 분 `:00` 근처로 찍히는지 ④ 긴 틱(100초 초과) 동안 `~/.node-local/stockinvest/cron-heartbeat` 가 틱 끝에 갱신되는지 ⑤ 텔레그램 손절 알림이 중복 오지 않는지(실환경 미관찰) ⑥ `pm2 restart stockinvest-cron` 뒤 고아 티커가 없는지 ⑦ `job_run_log` 에 `stop-alert` 행이 분당 1건 쌓이는지(DB 미확인).
- [19:38] 미확인·한계 — 운영 실배포 동작(텔레그램 중복·실제 컷오버)은 보지 못했다 · 락 비지원 파일시스템의 flock 오류 코드 실측 못 함(해당 경로 자체가 없음) · NTP 시각 점프 시 `SECONDS` 기반 바쁜 루프 가드는 코드로만 검토(연속 3회 필요라 단발 점프는 무해) · 화면 변경이 없어 데모 검토 게이트는 해당 없음 · Codex 검토 절이 task 에 없어 판정할 지적 없음 · 내 임시 프로세스는 전부 PID 로 정리했고 `pkill`·이름 패턴 종료는 쓰지 않았다(내가 띄운 대기용 ssh 루프 2개는 `done` 파일 생성으로 자연 종료).
- [19:40] **최종 판정: PASS (scope: scripts/cron-runner.sh, scripts/test-cron-runner-alert-ticker.sh, scripts/test-cron-runner-daily-bars.sh, scripts/test-cron-runner-holdings-premarket.sh, scripts/test-cron-runner-job-run-log.sh, scripts/test-cron-runner-news-peek.sh, scripts/test-cron-runner-news-split.sh, scripts/test-cron-runner-overseas-universe.sh, scripts/test-cron-runner-pmo-retry.sh, scripts/test-cron-runner-stop-alert.sh, src/app/api/cron/broker-fills/__tests__/cron-runner-block.test.ts, src/app/api/cron/kis-fundamentals-snapshot/__tests__/cron-runner-block.test.ts, src/lib/strategy/records/__tests__/job-slots.test.ts)**

## QA

(검증 — qa 가 채운다)
- [19:58] QA 판정: 검증 통과 (PASS, 조건부). 변경 13개 범위에서 결함 0건(Critical 0 · High 0 · Medium 0 · Low 0, 코드 기준). 조건 2개는 NOT_VERIFIED 로 남긴다: 안전장치 회로 4종의 런타임 재시험, 운영 배포 후 관찰. 문서 정정 1건(아래 ④)은 사용자 보고 전에 반영한다.
- [19:58] 범위·방법 — 서버(ssh home_ubuntu, 저장소 StockInvest)에서 실행. 러너 sha256 78212d789f5f87eb 와 티커 시험 6bc766dbb20710ca 가 Mac 사본과 일치함을 확인. 구현자·독립감사 수치는 근거로 쓰지 않았고, 아래 수치는 전부 이번 세션에서 얻은 값이다. 산출물: /tmp/qa-t147/ (drive.sh · curl-stub.sh · run/driver.log · run/s*/calls · run/s*/out · harness.log). 커밋·push·배포·운영 DB 쓰기·dev 서버 기동·/api/cron 실호출 없음. 종료는 전부 PID 로만(ISS-0002), pkill 미사용. 운영 cron(PID 3098067, releases/20261103-093323-1dfd57d6)은 건드리지 않았고 실행 중인 것을 확인했다.
- [19:58] ① 안전장치 회로 — 변경 13개 중 src/lib/safety · exchanges · signals · universe · broker-ledger · app/api/orders · safety · signals · middleware · db.ts · credentials · cron-auth 해당 0개. 추가된 diff 줄에 DRY_RUN · KILL_SWITCH · ORDER_MAX · DAILY_ORDER · ALLOWED_SYMBOLS · blocked-symbols · submitOrder · createOrder 참조 0줄. 따라서 DRY_RUN · Kill Switch · 주문 한도 · 심볼 · 감사 로그 회로는 이번 변경으로 달라지지 않았다(정적 확인).
- [19:58] ① NOT_VERIFIED (런타임) — 위 회로 4종을 실행으로 재시험하지 않았다. 변경 경로 밖이고, 재현에는 dev 서버 기동 또는 /api/orders 실호출이 필요한데 이 환경 규칙이 막는다. 배포 전 정규 스위트 또는 운영 가드 확인으로 따로 닫는다.
- [19:58] ① SAFETY_PATHS 범위 — 커밋 훅 목록(82 패턴)을 대조하면 변경 13개가 전부 감시 대상이고, Reviewer 판정 scope 13개와 정확히 일치한다(누락 0 · 초과 0). 임시 인덱스(GIT_INDEX_FILE)에 13개를 스테이징해 scripts/git-hooks/commit-msg 를 dry-run: "Reviewer 감사 기록 확인: T-147", rc=0. 실제 인덱스 스테이징 0건, 커밋 없음.
- [19:58] ① Mac 세션 재확인 — 이 머신의 core.hooksPath 는 우분투 경로(/home/brownjeon/.local/share/stockinvest-git-hooks/361294826755)라 Mac 에 없다. Mac 에서 커밋하면 훅이 무검사로 통과한다. 커밋은 서버에서 한다.
- [19:58] ② 신규 하네스 scripts/test-cron-runner-alert-ticker.sh — flock /tmp/stockinvest-heavy-tests.lock nice -n 10 경유, QA 가 직접 1회 실행: PASS=86 FAIL=0 SKIP=0.
- [19:58] ② 실시간 시나리오 6러너(실제 sleep·date·flock, curl 만 스텁, 외부 호출 0, 임시 HOME·.env). (1) 기본 모드 s1, 270초: 티커 stop-alert 4회, 전부 :00.0~:01.0 에 호출. 메인 루프 stop-alert 0회. (2) 레거시 s2(ALERT_TICKER_DISABLE=1): 티커 미기동, 메인 stop-alert 5회 = holding-checker 5틱(틱당 1회). (3) 락 파일 생성 불가 s3: "띄우지 못했다" 1줄, 메인 5회 = 5틱. (4) flock 이 PATH 에 없음 s6(/usr/bin·/bin 에서 flock 만 뺌): 같은 결과, 메인 5회 = 5틱. (5) 티커 kill -9 와 부모 kill -9 는 아래 두 줄.
- [19:58] ② 티커 kill -9 (s4, 티커 PID 464779, 부모 464750 과 명령줄 검증 후): 티커 호출 2회(19:46:00.3 · 19:47:00.3) → kill 19:47:00.53 → 전환 로그 정확히 1줄("사라졌다") → 메인 호출 3회(19:47:10.6 · 19:48:10.7 · 19:49:10.8, 다음 틱부터). 마지막 티커 호출과 첫 메인 호출 사이 공백 10.2초. 감독이 틱당 1회라 공백 상한은 틱 주기이고, 긴 틱이면 수 분까지 늘어난다(설계 특성, 결함 아님). 두 호출은 겹치지 않았다.
- [19:58] ② 부모 kill -9 (s5, 러너 PID 464765): 티커 호출 2회(부모가 살아 있을 때만) → 부모 kill 19:47:00.54 → 부모 사망 뒤 호출 0회 → 티커 자체 종료 19:48:00.6(60.1초, 분 경계 대기가 끝나 부모 확인에 실패하고 return) → 75초 뒤 잔존 PID 0.
- [19:58] ② 단일 호출자 불변식 — 6개 시나리오 모두에서 티커와 메인 루프가 같은 시각에 호출한 흔적 0건. s4 에서 같은 분(19:47)에 호출 2건이 찍혔으나 티커 호출(:00.3)이 끝난 10초 뒤의 메인 호출(:10.6)이라 순차다. 서버 응답이 이 간격보다 길면 두 호출이 서버에서 겹칠 수 있고, 그때는 라우트 쪽 가드에 의존한다. 이 스텁은 서버 지연을 재현하지 않으므로 이 부분은 QA 미검증이다.
- [19:58] ③ 티커가 닿는 라우트 — 티커 블록 안의 call 은 리터럴 /api/cron/stop-alert 1개뿐이고 경로 변수는 없다. 러너 전체의 stop-alert 호출은 2개(티커 1 · 폴백 1). 티커 자식이 다른 라우트를 칠 수 없다.
- [19:58] ③ CALL_MAX_TIME 누수 — 스텁 기록의 mt 값을 대조했다. stop-alert 은 6개 시나리오 전부 mt=20. 그 밖의 경로는 전부 mt=none(티커가 살아 있던 s1·s4·s5 구간의 entry-watcher·holding-checker·strategy-eval 포함). 예외 news-fetch(40) · job-run-log(3) 은 각 잡의 자체 상한이다. 누수 없음.
- [19:58] ③ 임시파일(T-135) — 6개 HOME 의 call-tmp 잔존 0개(정상 종료·kill 모두). 하트비트 쓰기는 메인 루프 2곳(틱 시작 602행 · 틱 끝 1064행)뿐이고 티커는 쓰지 않는다(정적 확인).
- [19:58] ④ 오늘 10:00:02 재시작 — 진행 중이던 호출 손실 없음, 평가는 중단되지 않았다. cron-out.log: 09:54:34 틱 시작 → strategy-eval OK 09:59:31 → signal-followup·trade-report OK 09:59:32 → 이후 구 프로세스 출력 0줄 → 10:00:02 재시작(sleep 60 중, 틱 끝 30초 뒤). 재시작이 없었다면 다음 틱은 10:00:32 였으므로 재시작은 틱을 27초 앞당겼다. stop-alert 공백 5분 31초(09:54:34→10:00:05)의 원인은 297초짜리 틱이지 재시작이 아니다.
- [19:58] ④ 정정 필요 — Reviewer 정정 요청 ①·task 실측 ④·Leader 지시문의 "그때 돌던 평가는 중단됐다"는 로그와 다르다(평가는 09:59:31 에 정상 완료). 정정 문구 제안: "장중 297초짜리 틱이 끝난 뒤 sleep 중에 재시작됐다, 진행 중 호출 없음". 사용자 보고에도 이 정정을 반영한다. 등급 Low(문서).
- [19:58] ④ DB 확인(읽기 전용, SELECT·SHOW COLUMNS 만) — 09:40~10:10 의 orders · trade_logs 행 0건. 10:00 슬롯 롤업 entry-watcher · holding-checker · stop-alert 는 status ok · failed 0. risk_stop_alert_state 의 updated_at = 2026-11-03 04:27:21(이후 변경 없음, sentToday 0). 09:00 슬롯 strategy-eval partial(failed 3) 중 HTTP 000 행 2건은 09:32:21·09:33:54 로 배포 컷오버 시각이다(평가 길이와 무관, 나머지 1건은 미확인). 그 5분 31초 동안 손절선 돌파가 있었는지는 확인하지 못했다(미확인).
- [19:58] ④ 재기동 4건 분류(rotated cron-out.log-20261101 이 09-19~11-01 04:14 를 덮고, DB job_run_log 는 10-30 21:05 부터): · 10-30 22:55:02 — 긴 틱 확정. 22:49:50 틱 → strategy-eval 270초(DB 롤업 maxMs 270069 와 일치) → 22:54:21 끝 → 재시작(sleep 중, 진행 중 손실 없음). 틱 끝 갱신(D3)이 있었다면 나이 41초라 재시작이 없었다. · 10-08 15:55:56 — 긴 평가가 아니다. 15:40:28 이후 출력 0줄 → 15:55:55 에 entry-watcher 가 첫 출력(뒤이어 나머지 잡이 연속 출력) → 재시작. 15:41:28 틱의 첫 호출 entry-watcher 가 약 14분 27초 무응답이었다고 추정한다 [가능성 높음 — 호출 시작 로그가 없어 출력 순서로 추론]. entry-watcher 호출에는 --max-time 이 없다(러너 612행, 전역 상한 188행은 빈 값). T-147 로는 막히지 않는다. · 09-29 03:55:02 — 원인 확인 불가: 03:49:11 이후 출력 0줄 5분 51초, 라벨 없음(03:30~03:56 구간에 stop-alert 행 없음).
- [19:58] ④ 결론 — 긴 틱 재시작은 2건(10-30 · 11-03, T-147 의 틱 끝 하트비트가 막는다). 무응답 호출 재시작은 2건(10-08 추정 · 09-29 미상, T-147 로는 막히지 않는다). "같은 원인이 반복 중"은 과장이고, 두 부류가 번갈아 재시작을 일으켰다. 주문 경로 entry-watcher 에 호출 상한이 없는 것은 T-147 이전부터의 위험이다. 단순 curl 상한은 서버 실행이 계속 돌아 다음 틱과 겹치는 문제가 있어 이 task 가 적은 이유로 다시 막힌다(별건, Leader 판단).
- [19:58] ④ 범위 밖 관찰 — 10-08 에 stockinvest-cron 의 5분 순찰 기록이 15:45·15:50 에 없었고 15:55:56 에 처음 무응답 판정이 찍혔다(원인 미확인). 10-30 22:55:43 에는 새 프로세스의 job-run-log 전송이 HTTP 503 으로 실패했고 스풀에 남겼다.
- [19:58] ⑤ 배포 전 점검 — git-refs-clean --check (저장소 경로 지정): "깨끗하다 (StockInvest, 실제 ref 22개)", rc=0. 커밋 훅 scope 는 ①에서 통과. 커밋·push 는 하지 않았다.
- [19:58] 발견 결함 요약 — 코드 결함 0건(Critical 0 · High 0 · Medium 0 · Low 0). 문서 정정 1건(④ 평가 중단 서술, Low). 기존 위험 1건(④ entry-watcher 무응답 — T-147 이전부터, 별건 필요). 정보성 2건(전환 분 순차 이중 호출, 전환 공백 상한 = 틱 주기).
- [19:58] 미확인·한계 — 운영에서 티커의 실제 stop-alert 응답과 텔레그램 중복 발송 여부는 관찰하지 못했다. 락 비지원 파일시스템의 flock 오류는 재현하지 못했다. 서버 지연 조건의 두 호출 겹침은 재현하지 못했다. 09:54~10:00 손절선 돌파 여부는 확인하지 못했다.
- [19:58] deployer 인계 시 post_deploy_checks 제안 — Reviewer 관찰 ①~⑦ 전부, 추가로 (a) 배포 로그에 "stop-alert 티커 시작 — pid" 1줄이 있고 "레거시 모드"·"띄우지 못했다"·"사라졌다" 줄이 0개인지 (b) 기동 후 ps 에 러너 1 + 티커 자식 1 (c) 긴 틱(100초 초과) 동안 틱 끝에 cron-heartbeat 가 갱신되는지 (d) 한 틱 안 출력 공백이 300초를 넘는 건수(entry-watcher 무응답 재발 여부). 커밋·배포는 사용자 승인 뒤.

## 배포 기록

| 시각 (KST) | 릴리스 | 커밋 | 포함 작업 | 결과 | 비고 |
|---|---|---|---|---|---|
| 2026-11-03 20:24:11 → 20:25:46 | 20261103-202418-17a4257f | 17a4257 | T-147 (본 작업) · 1db9103 (T-146 문서 전용 — 배포 기록·QA 판정·최종 요약, 코드 변경 없음) | ✅ ok (exit 0) | push = webhook blue/green · 마이그레이션 없음 · 직전 릴리스 20261103-093323-1dfd57d6 |

- **방식**: 사용자 명시 승인 후 `git push origin main` (origin/main 1dfd57d → 17a4257) → Gitea webhook → `deploy-stockinvest.sh` → `release.sh` blue/green. `scripts/deploy.sh --yes` 는 돌리지 않았다(이중 배포 방지). 같은 날 `--dry-run`(SSH 없음)·`--status`(읽기)만 실행.
- **판정**: `RELEASE_RESULT {"status":"ok","release":"20261103-202418-17a4257f","sha":"17a4257f2ee432e513cd7ad7c763c80d6e21ebf1","previous":"…/releases/20261103-093323-1dfd57d6","migrated":false}` · 로그 `END … exit=0`. 마이그레이션 없음(`--with-migrate` 미사용).
- **배포 전 확인**: `git-refs-clean.sh --check` rc=0(push 직전 재실행) · QA PASS(조건부, NOT_VERIFIED 2건 — 아래) · Reviewer PASS(scope 13개). 작업본 미커밋 9건(T-112·T-145 vault, `public/mockups` 삭제, `.codex*`·`.claude/agents/claude.md` 등)은 **배포에 들어가지 않았다**(release 는 origin/main 기준).
- **컷오버 중 짧은 중단**: release.sh 가 web·cron 을 `delete` 후 재등록(수 초). 그 사이 옛 cron 의 잡 기록 1건 전송 실패(HTTP=000 — 스풀에 남아 다음 틱에 재전송, 잡 동작 무관).
- **🔴 컷오버 1초 창 — 같은 분 stop-alert 2회 (보고 대상)**: 20:24:22 옛 러너 정상 틱 + 20:24:46 옛 러너 재기동 틱(메인 루프 `stop-alert` 포함). 20:24:46 기동 줄에는 티커 결정 줄이 없었고, 옛 릴리스(1dfd57d6)의 `cron-runner.sh` 에는 티커 코드가 0줄이므로 **옛 코드 러너**로 판단한다 [가능성 높음 — 옛 파일 grep 0건으로 확인]. 20:24:47 release.sh 의 delete 로 제거되고 새 러너가 티커를 띄웠다. 그 시각 웹도 재기동 중이었다(job-run-log HTTP=000). **20:24:46 호출의 실제 발송 여부는 미확인.** 동시 호출은 관찰되지 않았다(티커의 첫 호출은 20:25:00).
- **steady state (20:25:00 ~ 20:30:00, 6분 실측)**: `stop-alert` 매 분 :00 에 정확히 1회(6회). 20:24:47 이후 메인 루프 틱 줄에 `stop-alert` 0건. 러너 pid 491794 + 티커 자식 pid 491802(ppid 491794) 1쌍, 옛 러너 pid 3098067 소멸·고아 없음. `cron-heartbeat` 나이 52~53초(4 샘플). 20:24:47 이후 로그 33줄, **틱 간 최대 공백 52초**(300초 기준 미달). `cron-err.log` 비어 있음, `pm2-err.log` 20:24 이후 줄 없음, 🔴·🔶·FAIL·skip 줄 0건.
- **헬스·안전장치**: 127.0.0.1:3003 `/api/health` 200 · 공개 도메인 `/api/health` 200 · 본문 `ok:true, db:true, safetyStatus:"green", safety.dryRun:true, killSwitch:false, limitsConfigured:true, authConfigured:true, cronSecretConfigured:true`. 공개 `/` 307(로그인 리다이렉트). 배포 전 health 본문은 기록하지 않아 전후 직접 대조는 못 했다. KIS 실연동 상태는 health 본문에 없어 **미확인**.
- **pm2 재시작 횟수**: 재등록으로 두 앱 모두 ↺0 으로 리셋됐다. 배포 전 baseline 은 stockinvest ↺0 · stockinvest-cron ↺1. "재시작 증가 없음"은 재등록 이후 기준으로만 판정 가능. `stockinvest-cron` 은 1행(id 100).
- **미확인·남은 일**: ① 손절 알림 실제 수신·텔레그램 중복 발송 여부(20:24:46 포함) — 미관찰 ② QA NOT_VERIFIED 2건 중 「안전장치 회로 4종 런타임 재시험」 미수행, 「운영 배포 후 관찰」은 장외 6분뿐 — 장중 손절선 돌파 시 실발송 관찰 필요 ③ 긴 틱(100초 초과) 중 heartbeat 갱신 — 미관찰 ④ 메인 화면 렌더링 — 브라우저 미확인(공개 `/` 307 만 확인) ⑤ 장 개시(23:30 KST) 이후 틱 주기 60초대 유지 재확인.

## Leader

- [12:2x] **설계 성립 근거를 먼저 확인했다 — KIS lane 경합은 일어나지 않는다.** 티커로 떼어낸 `stop-alert` 는 `normal` lane 인데 평가 본체도 `normal` 이다(`withKisPriority` 선언이 `refreshUniverse`·`updateRsRatings` 둘뿐 — `src/lib/strategy/universe.ts:168`, `rs-rating.ts:77`). 같은 lane 이면 FIFO 라 티커가 150건 뒤에 줄 서서 굶을 위험을 의심했으나, 평가 루프가 **직렬**이라(`engine.ts:1455` `for (const symbol of symbols) { await collectCandidates(…) }`) `normal` 대기열 깊이가 1 을 넘지 않는다. 레이트 5/s 중 평가가 약 1/s 만 쓰므로 티커의 시세 요청은 바로 토큰을 받는다. 서버 응답성도 실측 — 장중 `/api/health` 25회 표본 median 0.00초·최장 2.05초(이벤트 루프가 막히지 않는다 = 평가가 I/O 대기라 동시 요청이 처리된다). **이 확인 없이는 채택 설계가 "티커는 60초마다 돌지만 그 시간 동안 시세를 못 받아 실패"로 끝날 수 있었다.**
- [12:2x] **근본 원인은 "직렬 루프"다 — 별건 후속.** 150초의 정체는 universe 갱신이 아니라(TTL 15분이라 매 회가 아니다) **종목 수만큼의 직렬 KIS 왕복**이다 — `collectCandidates`(`engine.ts:466`)가 종목당 `kis.getTicker` 1회 + `kis.getCandles` 1회 이상을 `await` 로 직렬 호출한다(약 150종목 × 2회 이상, 레이트 5/s). `engine.ts:1455` 의 루프에 동시성 제한이 전혀 없다(같은 저장소에 `mapWithLimit`·`DEFAULT_FANOUT_CONCURRENCY` 가 이미 있고 다른 경로가 쓴다). 동시성 4~8 이면 150초 → 20~40초로 줄고, 그러면 **`entry-watcher`(주문 집행) 간격도 평균 95초 → 60초대로 같이 회복된다** — 이번 티커 설계가 못 고치는 부분이 바로 그것이다. T-146 의 H-1(`post-market-overseas.ts:545` 무제한 팬아웃)과 **같은 계열의 반대쪽 결함**이다(저쪽은 제한 없는 동시성, 이쪽은 동시성 0).
  
  > 🔴 **수치가 틀렸다 — 아래 「정정 3」 참조.** 국내는 약 150종목이 아니라 **42~51종목(대개 43)** 이고(실측 `ran=43 skipped=3`), 회차당 median **279 호출**이다. 150 은 `UNIVERSE_TOP_N` 주석에서 측정 없이 추론한 값이다.
  
  > 🔴 **「20~40초」·「55초 밑으로는 못 간다」·「병목은 레이트 한도」는 틀렸다 — 아래 「정정 4」 참조.** T-148 실측은 **「루프는 레이트 바운드가 아니라 지연 바운드」**이고 유량 상한이 구속한 회차는 7회뿐이다. 56초는 **바닥**일 뿐 관측 median 136초를 설명하지 못한다. 🔴 이 문장을 믿고 `kis_rate_limit_per_sec` 를 올리면 실매매 유량 제한의 잘못된 조작이다.
- [12:2x] 순찰 실측: `~/.local/log/autostart-recover.log` 249,306줄에서 `stockinvest-cron` 재시작 **0회**(5분마다 "정상"). 하트비트 정지 창은 아직 5분 샘플이 비켜갔다 — 위험은 상주가 아니라 **확률**이다. 참조한 교훈 **LSN-0003**: 로컬에서 고쳐도 운영에 배포되지 않았으면 조치는 끝난 것이 아니다.
- [13:0x] **developer 의 반박 2건을 독립 재계산해 둘 다 수용했다.** 전체 cron 로그 3,119틱: 틱 **주기** mean 66.3·max 412·>300s 12틱 / 틱 **길이** mean 6.4·max 352·>300s 4틱. → 내 "328+60=388" 은 주기를 길이로 잘못 읽은 것이었다. **D3(하트비트 추가 쓰기)는 창을 12틱→4틱으로 좁히지만 닫지 못한다**(352 > 300). 닫는 길은 ⓐ `call()` 마다 쓰기(단일 `strategy-eval` 최장 약 298초라 여유 2초뿐) ⓑ 임계 상향(HOME-SERVER `max_age_seconds` + 앱 `CRON_HEARTBEAT_STALE_SEC` — **사용자 결정**) ⓒ 배경 하트비트 작성자(메인 루프가 멈춰도 계속 써서 워치독을 영구 무력화 — **기각**) ⓓ 근본 해결(위 직렬 루프 동시성 — 별건). **이번 범위에서는 닫지 않고 사실을 코드 주석·사용자 보고에 그대로 적는다.**
- [13:1x] **피해를 사용자 체감 단위로 환산했다 — 국내 장중(09:00~15:30) `stop-alert` 간격 824건**: mean 77.5초·max 411초. 정상(60~70초) 89.3% · 71~120초 1.8% · 121~180초 1.5% · **181~300초 5.8% · 300초 초과 1.6%** → **장중 약 9번에 1번(10.7%)이 늦고, 13번에 1번(7.4%)은 3분 이상 늦는다.** 보유 6종목에 손절가가 걸려 있으므로 최악 6.9분 공백은 빠른 하락에서 유의미하다. 야간·주말을 포함한 전체로는 94.6%가 정상이라 **평균만 보면 문제가 보이지 않는다** — 장중만 분리해야 드러난다.
- [13:2x] **설계 보정 1 — 최초 구현의 회귀를 fail-open 으로 바꾸게 했다.** 최초 구현은 `flock` 없음·락 파일 생성 실패 시 티커를 띄우지 않는데 메인 루프 호출도 이미 빠져서 **손절 알림이 아예 돌지 않았다**(T-147 이전에는 어떤 환경에서든 돌았다). 지시: 기동 시 한 번 정하는 단일 플래그 `ALERT_TICKER_ACTIVE` — 0 이면 메인 루프가 옛 3줄을 그대로 실행 → 어느 경로에서도 **호출자 정확히 하나**이고 최악이 "알림 없음"이 아니라 "T-147 이전 동작". 추가로 부모가 매 틱 `kill -0` 으로 티커를 감독해 자식이 죽으면 인수하게 했다(바쁜 루프 가드 발동 시 다음 재기동까지 영구 정지되는 구멍을 닫는다).
- [13:2x] **설계 보정 2 — 기존 하네스 8개를 T-147 인식형으로 고치지 않았다.** `ALERT_TICKER_DISABLE=1` 을 T-147 이전 동작(티커 없음 + 메인 루프 매 틱 호출 + 하트비트 추가 쓰기 생략)으로 만들어, 8개가 env 한 줄로 **행동 단정 수정 없이** 통과하게 했다. 8개를 전부 T-147 인식형으로 고치면 무관한 안전경로 시험 8개가 한 task 에 얽힌다(각 suite 는 자기 기능의 회귀망이고 T-147 과 무관하다). 이 스위치는 안전장치를 끄는 것이 아니라 **현재 운영 동작으로 되돌리는 것**이라 받아들일 수 있다고 판단했다 — 잘못 설정된 경우의 결과가 "오늘의 동작"이다. 기준 ref 비교(5개)만 `no_kf_old` 선례대로 스트리퍼 2개씩 넣게 했고, `T119_BASE_REF` 류로 **기준을 옮기는 편법은 금지**했다(기준을 옮기면 「추가만」 불변식이 무의미해진다).
- [13:3x] **설계 보정 3 — 남은 구멍을 Reviewer 전에 닫게 했다.** developer 가 보고한 「런타임 `flock` 실패 시 조용한 정지」에 대해, 그 권고(경고만)를 쪼갰다 — `flock` 실패 원인이 둘이고 올바른 응답이 다르다. **경합**이면 겹친 옛 티커가 지금 알림을 보내는 중이므로 건너뛰는 게 맞고, **경합 아닌 오류**면 다른 티커가 없어 알림이 정말 멈추는데 동시에 두 번째 호출자도 존재하지 않으므로 메인 루프로 넘겨도 이중 발송 위험이 구조적으로 없다. 종료 코드로 구분 가능한지 **먼저 측정하고, 구분이 안 되면 넘기지 말라**고 지시했다(추측으로 넣으면 경합을 오류로 오인해 호출자를 둘로 만든다). 측정 결과 구분됨(경합 1 · 구조적 오류 65 · 없음 127). 또한 이 시점에 닫은 이유는 독립감사 통과 뒤에 러너를 고치면 판정 scope 가 무효가 되어 **규약상 전체 재순환**이기 때문이다 — 하네스 재실행 1회가 더 싸다.
- [18:1x] **developer 의 수치 오염 자진 정정을 확인했고, 재측정분을 교차 검증했다.** 내가 직접 확인: 러너 sha256 앞 16자 `78212d789f5f87eb` = 최종 검증 실행의 START·END sha 와 동일 · 서버 잔존 시험 프로세스 0건 · `ALERT_TICKER_ACTIVE` 를 1 로 올리는 곳 1개(`:543`)·0 으로 내리는 곳 1개(`:589`)·선언 1개(`:479`) · `.env.example`·`ecosystem.config.js` 에 `ALERT_TICKER` 0건 · `job-slots.test.ts` 의 중복 허용이 `['stop-alert']` 정확히 하나·개수 정확히 2로 못 박힌 형태. 한 가지 의심은 해소됐다 — 자식이 루프 **전에** fork 되므로 틱 인덱스가 얼어 기록이 틀어질까 봤으나 `jrl_hook` 은 틱 인덱스가 아니라 호출별 타임스탬프를 받으므로 **해당 없다**. 수치 자체는 독립감사가 재실행해 자기 수치로 판정하게 했다.

### 최종 요약 (사용자용)

**[T-147] 장중 손절 알림이 늦게 돌던 문제 — 알림만 전용 루프로 분리**

- **상태**: 구현·독립감사(PASS)·QA(PASS) 완료, **미배포**(사용자 승인 대기).
- **무엇이 바뀌었나**: cron 러너의 분당 잡은 **동기 호출의 직렬 사슬**이라, 장중 `strategy-eval`(국내 150종목 직렬 평가, 실측 53~297초) 한 번이 끝날 때까지 손절 알림까지 전부 멈췄다. 알림만 하는 `stop-alert` 하나를 떼어내 **자식 프로세스 1개**가 분 경계마다 호출하게 했다. 플래그 `ALERT_TICKER_ACTIVE` 가 호출자를 **항상 정확히 하나**로 고르고(티커 / 메인 루프 fallback), 티커를 못 띄우거나 자식이 죽으면 메인 루프가 이어받는다(fail-open — 최악이 "알림 없음"이 아니라 T-147 이전 동작). 하트비트를 틱 끝에 한 번 더 써서 워치독 오재시작 창을 좁혔다.
  
  > 🔴 **수치가 틀렸다 — 아래 「정정 3」 참조.** 국내는 약 150종목이 아니라 **42~51종목(대개 43)** 이고(실측 `ran=43 skipped=3`), 회차당 median **279 호출**이다. 150 은 `UNIVERSE_TOP_N` 주석에서 측정 없이 추론한 값이다.
- **주문 경로는 건드리지 않았다**: `src/lib/safety/order-sync.ts:1226-1227` 이 `FOR UPDATE`·`GET_LOCK()` 을 명시적으로 기각해 뒀고 일일 누적 한도가 check-then-act 라, **지금의 무제한 동기 호출이 cron 끼리의 유일한 주문 직렬화 장치**다. 그래서 `entry-watcher`·`holding-checker`·`strategy-eval` 은 메인 루프에 그대로 뒀고, `strategy-eval` 에 curl 상한을 걸거나 백그라운드로 돌리는 길은 **안전장치 회귀라 기각**했다.
  
  > 🔴 **이 문장은 틀렸다 — 아래 「정정」 bullet 참조.** 주문 겹침은 **T-081 WP-B**(`src/lib/safety/order-limits.ts:220-253`)가 `pending` 선예약 + 타 주문 pending 합산으로 **DB 에서 이미 막는다.** `order-sync.ts:1226-1227` 이 기각한 `FOR UPDATE`·`GET_LOCK()` 은 **브로커 체결 정산** 건이다(러너 `:477` 이 정확하다). 「유일한 직렬화 장치」는 성립하지 않는다.
- **배포**: 미배포. 변경 13개(`scripts/cron-runner.sh` · `scripts/test-cron-runner-alert-ticker.sh` 신규 · 기존 하네스 8개 · jest 3개). 13개 전부 `SAFETY_PATHS` 대상이고 독립감사 판정 줄의 scope 가 정확히 그 13개를 덮는다(QA 가 임시 인덱스로 훅 dry-run → rc=0). **커밋은 서버에서** 한다(Mac 은 `core.hooksPath` 가 우분투 경로라 훅이 돌지 않는다). 같은 push 에 **문서 커밋 `1db9103`(T-146 배포 기록)이 조상으로 함께 나간다**.
- **AI 가 검증한 것**: 러너 시험 9개 **756/0** + jest **18 suites / 819 tests 실패 0**(독립감사가 자기 손으로 재실행, 실행 전후 러너 sha 동일 `78212d78`). 적대적 시나리오 6개 — 기본·레거시·락 파일 불가·`flock` 없음·티커 kill·부모 kill — 전부 **두 호출자 동시 호출 0건**이고 알림이 끊기지 않는다. 티커가 닿는 라우트는 `stop-alert` 하나, `CALL_MAX_TIME` 누수 0, 임시파일 잔존 0. 안전장치 회로(DRY_RUN·KILL_SWITCH·주문 한도·블랙리스트) 참조는 추가 diff 에 **0줄**.
- **AI 가 검증 못 한 것**: 운영에서 티커의 실제 호출과 **텔레그램 중복 발송 여부**(배포 후에만 확인 가능) · 배포 컷오버 1~3초 겹침의 실동작 · 긴 틱 끝 하트비트 갱신의 실시간 효과 · 안전장치 회로 4종의 런타임 재시험(변경 경로 밖) · 락 미지원 파일시스템의 `flock` 오류 코드 · 09:54~10:00 에 손절선 돌파가 실제로 있었는지.
- **👉 사용자가 확인할 것** (배포 후):
  1. `pm2 logs stockinvest-cron` 에 기동 로그 **`[cron-runner] stop-alert 티커 시작 — pid …`** 1줄이 있고 🔴/🔶 경고가 없는지 — 배포 직후.
  2. 국내 장중(다음 영업일 09:00~15:30) `strategy-eval` 이 긴 회차를 도는 동안에도 `stop-alert` 가 **매 분** 찍히는지. 정상 기준: 간격 60~70초.
  3. **손절 알림 텔레그램이 같은 내용으로 두 번 오지 않는지** — 오면 즉시 알려 주십시오(호출자 중복이라 되돌려야 한다).
  4. 순찰 오재시작이 더 없는지 — `~/.local/log/autostart-recover.log` 에 `stockinvest-cron` 복구 줄이 새로 생기지 않는지.
- **👉 사용자가 결정할 것**:
  1. **배포 시점** — push = 즉시 blue/green. 권고: 지금(국내 마감 후·미국 정규장 23:30 전).
  2. **워치독 임계 상향** — 틱 길이가 300초를 넘는 틱(3,358틱 중 3~4틱, 최장 352초)에서는 이번 수정 뒤에도 오재시작이 가능하다. HOME-SERVER `max_age_seconds` 300 과 앱 `CRON_HEARTBEAT_STALE_SEC` 를 올리면 닫히지만 탐지 민감도가 떨어진다. **다른 프로젝트 설정이라 사용자 결정 사항**이고, 근본 원인(아래 남은 일 1)을 고치면 상향 없이도 닫힌다.
- **남은 일**:
  1. **근본 원인 — `src/lib/strategy/engine.ts:1455` 직렬 루프.** `collectCandidates`(`engine.ts:466`)가 종목당 `kis.getTicker` + `kis.getCandles` 를 동시성 제한 없이 **직렬**로 돈다(약 150종목 × 2회 이상, 레이트 5/s). `mapWithLimit` 로 동시성 4~8 을 주면 150초 → 20~40초가 되고, 그러면 **`entry-watcher`(주문 집행) 간격도 평균 95초 → 60초대로 회복**되며 워치독 잔여 창도 닫힌다. T-146 의 H-1(무제한 팬아웃)과 같은 계열의 반대쪽 결함이다.
  
  > 🔴 **수치가 틀렸다 — 아래 「정정 3」 참조.** 국내는 약 150종목이 아니라 **42~51종목(대개 43)** 이고(실측 `ran=43 skipped=3`), 회차당 median **279 호출**이다. 150 은 `UNIVERSE_TOP_N` 주석에서 측정 없이 추론한 값이다.
  
  > 🔴 **「20~40초」·「55초 밑으로는 못 간다」·「병목은 레이트 한도」는 틀렸다 — 아래 「정정 4」 참조.** T-148 실측은 **「루프는 레이트 바운드가 아니라 지연 바운드」**이고 유량 상한이 구속한 회차는 7회뿐이다. 56초는 **바닥**일 뿐 관측 median 136초를 설명하지 못한다. 🔴 이 문장을 믿고 `kis_rate_limit_per_sec` 를 올리면 실매매 유량 제한의 잘못된 조작이다.
  2. **`entry-watcher` 에 curl 상한이 없다**(러너 612행). QA 가 재기동 4건을 분해하다 찾았다 — 10-08 15:55 재시작의 원인이 `entry-watcher` 약 14분 무응답(가능성 높음)이다. **주문을 집행하는 잡**이 무제한으로 매달릴 수 있다. T-147 이전부터의 위험이고 별건이다.
  3. 독립감사 LOW 6건 중 러너를 고쳐야 하는 둘 — 생존 판정이 pid 번호만 보는 것(ppid 대조 3줄로 보강 가능. pid 재사용은 한 바퀴 5~7일) · `:503-505` 의 "읽기전용 fd 도 1" 주석이 사실 아님. **이번에 고치지 않았다** — 러너 sha 가 바뀌면 하네스 9개 80분 재실행 + 독립감사 전체 재순환이고 위험 대비 이득이 작다(감사자 권고, Leader 동의). 러너를 다시 여는 다음 작업에 묶는다.
- **이슈·위험**:
  - 이번 수정이 **고치지 못하는 것**: `entry-watcher`(주문 집행)는 여전히 평균 95초·최장 412초 간격이다. 주문 경로라 같은 방법으로 뺄 수 없다(위 "주문 경로는 건드리지 않았다").
  - **기존 하네스 8개가 이제 기본 경로가 아니라 레거시 경로를 지킨다**(감사자 지적). 기본 경로는 신규 하네스가 본다. 그리고 `ALERT_TICKER_DISABLE` 이 운영에 없음을 보장하는 **기계적 가드가 없다**(현재는 실측으로만 0건 확인).
  - **내 실측 오류 2건을 정정했다**(이 문서 `실측 ④`): ⓐ "워치독 재시작 0회"는 틀렸다 — 4건이고 그중 하나는 오늘 10:00:02 장중이다 ⓑ "그때 돌던 평가가 중단됐다"도 틀렸다 — `strategy-eval` 은 09:59:31 에 정상 완료하고 재시작은 sleep 중에 일어나 **중단된 잡도, DB 피해도 없었다**(QA 확인: 09:40~10:10 `orders`·`trade_logs` 0행, 10:00 롤업 failed 0). ⓒ "같은 원인의 반복"도 과장이다 — 4건 중 2건만 틱 길이이고(이번 변경으로 막힌다), 1건은 `entry-watcher` 무응답, 1건은 원인 불명이다.
  - **실제 피해는 재시작이 아니라 알림 공백이다**: 국내 장중 `stop-alert` 간격 824건 중 **10.7% 가 늦고 7.4% 는 3분 이상 늦다**(최악 411초). 오늘 09:54:34 → 10:00:05 공백 5분 31초의 원인도 재시작이 아니라 297초짜리 틱이다. 이번 수정이 겨냥한 것이 바로 이것이다.

- **[20:40] 배포 완료 — 릴리스 `20261103-202418-17a4257f` `status: ok`.** 사용자 지시 「네, 지금 배포」(20:0x). 커밋 `17a4257`(15파일, 커밋 훅 `✅ Reviewer 감사 기록 확인: T-147` 통과) → `git push origin main` → Gitea webhook → `release.sh` blue/green, 20:24:18~20:25. `migrated: false`. 롤백 지점 `20261103-093323-1dfd57d6`. **같은 push 에 `1db9103`(T-146 배포 기록 문서)이 조상으로 함께 나갔다** — 코드 변경 0. `scripts/deploy.sh` 는 돌리지 않았다(이중 배포 방지). push 직전 `git-refs-clean.sh --check` rc=0.
- **[20:40] 배포 후 실측**: 기동 로그 `[cron-runner] stop-alert 티커 시작 — pid 491802, 분 경계마다 1회(락 …/stop-alert.lock)` **1줄**, 🔴·🔶 **0줄**. `stop-alert` 가 20:25:00 부터 **매 분 정확히 `:00` 에 1회**(20:25~20:34 전수 확인, 간격 60초) · **메인 루프 호출 0회** · 자식 프로세스 **1개**(옛 러너 소멸) · 하트비트 나이 52~53초 · 두 앱 online·새 릴리스·health `safetyStatus green`·`dryRun true`·`killSwitch false` · `cron-err.log` 비어 있음. 컷오버 중 잡 기록 1건 전송 실패는 스풀에 남아 재전송(설계대로).
- **[20:40] 🔴 deployer 가 보고한 「같은 분 `stop-alert` 2회」는 중복 발송이 아니다 — 내가 로그·DB 로 확인했다.** 20:24 분에 두 번 찍힌 것(20:24:22 · 20:24:46)은 **둘 다 옛 코드 러너의 메인 루프 호출**이다 — 20:24:46 줄은 pm2 reload 가 되살린 옛 릴리스 러너이고(그 러너에는 티커 코드가 0줄, 기동 로그에 티커 줄이 없다), 새 러너는 20:24:47 에 티커와 함께 떴다. 즉 **티커·메인 루프가 동시에 부른 것이 아니라, 배포 재시작 때 옛 러너가 두 번 돈 것**이고 T-147 이전에도 배포마다 일어났던 일이다. 게다가 **실제 발송은 0건**이다 — `system_config.risk_stop_alert_state` 가 `sentToday: 0` 이고 마지막 갱신이 04:27:21(배포 전)이라 **오늘 손절 알림이 한 건도 나가지 않았다**. 텔레그램 중복 발송은 일어날 수 없었다.
- **[20:40] 아직 확인 못 한 것(사용자 확인 대상)**: 장중 긴 틱이 실제로 돌 때 `stop-alert` 가 매 분 유지되는지 · 그때 텔레그램 중복이 없는지 · 긴 틱 끝 하트비트 갱신의 실효 · 23:30 미국 정규장 개장 후 틱 주기. 배포 후 관찰은 **장외 10분**뿐이다.

- **[21:0x] 🔴 이 task 가 반복해서 쓴 전제 하나가 틀렸다 — [[T-149-entry-watcher-unbounded-call]] 이 반증하고 내가 재확인했다.** 「일일 누적 한도가 check-then-act 라서 **러너의 무제한 동기 호출이 cron 끼리의 유일한 주문 직렬화 장치**다」는 **사실이 아니다.** `src/lib/safety/order-limits.ts:220-253` 을 직접 읽었다 — **T-081 WP-B** 가 송신 전에 `pending` 행을 INSERT 하고 **다른 주문의 `pending` 을 합산**해 동시 매수 경합을 DB 에서 막는다(그 주석이 "거의 동시에 들어온 두 매수가 서로의 `pending` 을 못 보고 둘 다 통과해 한도를 넘었다"를 과거 결함으로 적고 고쳤다고 명시한다). `src/lib/safety/order-sync.ts:1226-1227` 이 `FOR UPDATE`·`GET_LOCK()` 을 기각한 것은 사실이지만, 거기서 **"그러므로 주문 경로를 직렬화하는 것이 아무것도 없다"를 추론한 것이 내 오류**다 — 기각된 것은 그 두 메커니즘이고, 직렬화는 다른 방식으로 이미 되어 있다.
  - **T-147 의 안전성에는 영향이 없다**: 이번 변경은 알림 전용 잡 하나만 옮겼고 주문 경로에 동시성을 **추가하지 않았다**. 틀린 전제는 나를 더 보수적으로 만들었을 뿐이다.
  - **영향받는 것은 "`strategy-eval` 상한을 기각한 근거"다.** 상한을 걸면 안 되는 이유로 내가 든 것 중 "유일한 직렬화 장치" 부분은 빠져야 한다. 남는 이유는 ① curl 을 끊어도 서버의 `runAll` 은 계속 돈다 ② `job_run_log` 가 HTTP 000 으로 오염돼 실패와 "클라이언트만 끊김"을 구분할 수 없다 — 둘뿐이고, 상한의 타당성은 [[T-148-strategy-eval-serial-fanout]] 에서 다시 판단해야 한다.
  - 🔴 **이 틀린 문장이 배포된 코드 주석에 들어 있다** — `scripts/cron-runner.sh` 의 alert-ticker 블록 주석과 메인 루프 fallback 주석, 그리고 커밋 메시지 `17a4257`(push 됨, 되돌릴 수 없다). 주석만 고치려고 러너를 다시 열면 하네스 9개 재실행 + 독립감사 전체 재순환이므로, **러너를 이미 여는 T-148 에 묶어 고친다.**
- **[21:0x] 🔴 「10-08 15:55 워치독 재시작은 `entry-watcher` 약 14분 무응답」도 틀렸다.** QA 의 추정(「가능성 높음」)을 내가 그대로 사용자에게 전달했다. 실제로는 **호스트가 약 15분 동결**된 것이다 — 순찰 crontab 자체가 `15:40:01` 다음 **`15:45`·`15:50` 두 회차를 통째로 건너뛰고 `15:55:55`** 에 돌아왔다(5분 주기 작업 2회 소실). 순찰이 돌지 않던 동안에는 아무것도 감지할 수 없었고, 돌아왔을 때 하트비트가 당연히 낡아 있었던 것이다. T-149 가 TheKaiwa·VoiceVault 도 같은 창에서 멈췄고 `last` 에 재부팅이 없음을 확인했다.
  - 정정된 **워치독 재시작 4건 내역**: 긴 틱 **2건**(10-30 270초 · 11-03 297초 — T-147 이 막는다) + **호스트 동결 1건**(10-08) + **원인 불명 1건**(09-29). 즉 T-147 이 겨냥한 원인은 4건 중 2건이다.
  - `entry-watcher` 는 느린 잡이 아니다 — T-149 실측 **5,436 호출 최악 799ms**. 「주문 잡이 무제한으로 매달린다」는 내 서술은 관측 근거가 없었다.

- **[21:3x] 🔴 정정 3 — 「국내 약 150종목」도 틀렸다(내가 이 task 전체에서 반복한 숫자다).** [[T-148-strategy-eval-serial-fanout]] 이 실측으로 반증하고 내가 운영 로그로 재확인했다: `ran=43 skipped=3` 이 99회·`ran=51` 이 62회 등 **42~51종목(대개 43)** 이다. 150 은 `src/lib/strategy/universe.ts` 의 `UNIVERSE_TOP_N (=150)` 주석에서 **내가 측정 없이 추론한 값**이다.
  - **피해 수치와 결론은 영향받지 않는다** — `strategy-eval` 53~297초, 틱 주기 max 412초, 손절 알림 간격 824건 분포는 모두 로그에서 **직접 측정**한 것이고 종목 수에서 유도하지 않았다.
  - **고쳐지는 것은 원인 설명의 수치다.** 실제는 43종목 × 약 6.5회 = 회차당 median **279 호출**이고(내 "종목당 2회 이상"보다 종목당 호출이 훨씬 많다), 레이트 5 req/s 에 걸리므로 **바닥이 279/5 ≈ 56초**다. 즉 병목은 종목 수가 아니라 **레이트 한도**이고, 동시성을 올려도 55초 밑으로는 못 간다 — 내가 T-148 인계에 쓴 「20~40초」는 **불가능한 목표**였다(T-148 이 그 전제도 반증했다). 194초 → 55~60초는 가능하고, 그러면 틱 길이가 300초 밑으로 내려와 **이 task 가 남긴 워치독 잔여 창은 닫힌다.**
  
  > 🔴 **「20~40초」·「55초 밑으로는 못 간다」·「병목은 레이트 한도」는 틀렸다 — 아래 「정정 4」 참조.** T-148 실측은 **「루프는 레이트 바운드가 아니라 지연 바운드」**이고 유량 상한이 구속한 회차는 7회뿐이다. 56초는 **바닥**일 뿐 관측 median 136초를 설명하지 못한다. 🔴 이 문장을 믿고 `kis_rate_limit_per_sec` 를 올리면 실매매 유량 제한의 잘못된 조작이다.
  - 🔴 이 틀린 숫자도 **배포된 `scripts/cron-runner.sh` 주석과 커밋 메시지 `17a4257`**(push 됨)에 들어 있다. 앞서 기록한 「유일한 주문 직렬화 장치」 오류와 **같은 주석 블록**이다 — 러너 주석 정정 2건을 한 번에 처리해야 하고, T-148 은 `engine.ts` 만 건드리므로 **러너를 여는 작업(T-149 범위 결정 또는 별건)에 묶어야 한다.**

- **[03:5x] 🔴 정정 4 — 「병목은 레이트 한도」도 틀렸고, 이건 내가 [[T-149-entry-watcher-unbounded-call]] 에 **직접 보낸 문장**이다.** T-149 의 독립감사가 M-1 으로 잡았고(CONDITIONAL_PASS), T-149 가 재확인했고, 나도 확인했다. [[T-148-strategy-eval-serial-fanout]] 실측은 **「루프는 레이트 바운드가 아니라 지연 바운드다」** 이고, 유량 상한이 실제로 구속한 회차는 **7회(median 55초)** 뿐이며 해외는 이미 레이트 바운드다.
  - **내 산수가 이미 그것을 반박하고 있었다**: 회차당 median 279 호출 ÷ 5 req/s = **바닥 약 56초**인데 관측된 국내 median 은 **136초**다. 136 ≫ 56 이므로 레이트 한도로 설명되는 것은 최대 41% 이고, 나머지를 묶는 것은 **직렬 사슬의 호출별 지연**이다. 나는 **바닥(floor)을 병목(bottleneck)으로 바꿔 불렀다** — 같은 숫자를 보고 있었는데 결론을 틀렸다.
  - 🔴 **위험**: 이 문장을 믿고 `system_config.kis_rate_limit_per_sec` 를 올리면 **실매매 시스템의 유량 제한을 근거 없이 올리는 잘못된 조작**이 된다(KIS 쪽 차단 위험). T-149 가 그 점을 지적했다.
  - **전파 경로**: 내 추론 → 내가 T-149 에 보낸 지시 문장 → T-149 가 러너 주석에 기록 → 감사가 T-148 실측과 대조해 적발. 즉 **T-149 의 M-1 은 내가 만든 결함**이다. 내가 이미 기록·커밋한 곳에도 들어 있다 — 이 문서의 「정정 3」 bullet · `ACTIVE.md` · 커밋 `994ddc1` 메시지(미push).
  - **올바른 서술**: 「국내 평가가 긴 이유는 호출 수(회차당 median 279)와 레이트 한도의 곱이 아니라, **동시성 없는 직렬 사슬에서 호출별 지연이 누적**되기 때문이다. 레이트 한도는 바닥을 약 56초로 정하지만 관측 median 136초를 설명하지 못한다. 그래서 동시성 도입(T-148)이 효과가 있고, 유량 상한을 올리는 것은 해법이 아니다.」
- **[03:5x] 🔴 내 오류 7건의 공통 패턴 — 측정하지 않고 추론한 것은 거의 다 틀렸다.** 이 task 에서 내가 틀린 서술: ① 하트비트 수정으로 창이 닫힌다(주기를 길이로 읽음) ② 워치독 재시작 0회(grep 실패) ③ 재시작으로 평가가 중단됐다(로그 미확인) ④ 같은 원인의 반복(원인별 분해 안 함) ⑤ 러너의 동기 호출이 유일한 주문 직렬화 장치(기각된 두 메커니즘에서 전체를 추론) ⑥ 국내 약 150종목(`UNIVERSE_TOP_N` 주석에서 추론) ⑦ 병목은 레이트 한도(바닥을 병목으로 오칭). **로그·DB 로 직접 측정한 수치는 전부 맞았다**(틱 주기·소요 분포·알림 간격 824건·순찰 이력). 틀린 7건은 모두 **코드 주석·상수·산수에서 끌어온 추론을 측정값처럼 서술한 것**이다. ⑤⑥⑦ 을 내가 다른 세션 인계에 적었는데, **번진 것은 T-149 한 곳뿐이다**(러너 주석 → 감사 M-1). [[T-148-strategy-eval-serial-fanout]] 은 ⑥⑦ 을 **반증 대상으로만** 다뤘고 사실로 인용한 곳이 없다 — 그쪽은 처음부터 「바닥(floor)」이라고 쓰고 「루프는 레이트 바운드가 아니라 지연 바운드」라고 측정했다(그쪽 grep 확인, 2026-11-04 정정). 즉 **내 틀린 인계를 받은 두 세션 중 하나는 그대로 옮겼고 하나는 측정으로 걸러냈다** — 인계 문장의 위험은 받는 쪽이 그것을 측정과 대조하는지에 달려 있다. → `/이슈기록` 정식 등록 후보(같은 패턴 3회 이상 + 실매매 설정 오조작 위험). 사용자 확인 후 등록한다.

## 실전 검증 (2026-11-04 국내 장중, 내가 직접 측정)

**조건이 성립했다** — 이날 장중은 **T-147 만 배포된 구간**이다(T-148·T-149 는 15:30 마감 후 17:27 배포). 그리고 긴 틱이 실제로 있었다: `strategy-eval` n=58 · **mean 134초 · max 299초 · 100초 초과 42회**(앵커 `holding-checker`), 틱 주기 n=287 · **mean 87.7초 · max 360초 · 300초 초과 3틱**. 어제와 같은 묶임이 그대로 일어난 날이다.

**결과 — 손절 알림 간격 419건: mean 60.0초 · max 65초 · 60~70초 100.0%. 늦은 건 0건.**

| | 11-03 (T-147 전) | 11-04 (T-147 후) |
|---|---|---|
| 간격 표본 | 824건 | 419건 |
| mean | 77.5초 | **60.0초** |
| max | **411초** | **65초** |
| 정상(60~70초) | 89.3% | **100.0%** |
| 3분 이상 늦음 | 7.4% | **0%** |

**워치독 복구 0건** — 틱 주기가 300초를 넘은 틱이 3개 있었는데도 재시작이 없었다. 하트비트 추가 쓰기가 실제로 그 창을 막았다(11-03 10:00:02 은 297초 틱에서 재시작됐다).

**미검증 1건**: `system_config.risk_stop_alert_state` 가 `day 2026-11-04 · sentToday 0` 이다 — **그날 손절 알림 실제 발송은 0건**이라 텔레그램 중복 발송 여부는 여전히 경험적으로 확인되지 않았다. 검증된 것은 티커가 419회 정확히 호출했다는 것이고, 발송 경로는 보유 종목이 손절가에 닿는 날에만 확인된다.

- ⚠ **측정 방법 함정 1건(보고 전에 내가 잡았다)**: 처음에 `stop-alert` → `strategy-eval` 시각차로 평가 소요를 재서 「mean 28초 · max 55초」를 얻었다. **무효다** — 어제는 `stop-alert` 가 메인 루프에서 평가 바로 앞에 있어 그 차가 소요였지만, **T-147 이 그 호출을 티커로 옮겼으므로 더는 앵커가 아니다.** 내 변경이 내 측정 방법을 무효화한 것이고, 그 숫자를 그대로 보고하면 「T-148 없이도 평가가 빨라졌다」는 거짓 결론이 됐다. 앵커를 `holding-checker`(메인 루프 잔존)로 바꿔 다시 쟀다 — 위의 134초가 그 값이다.

## 잔존 대기 루프 20개 — 원인 분석과 정리 (2026-11-05, 사용자 지시 「정리하고 원인 확인해서 작업내역 보완해줘」)

발단: 사용자가 `until ... /tmp/t147-runner-tests.log ... 결과: ...` 대기 명령이 **출력 없이 멈춰 있다**고 알렸다. 조사하니 서버에 그런 대기 루프가 **20개** 살아 있었고 **전부 영원히 끝나지 않는 조건**을 보고 있었다. 15개가 이 task(T-147) 작업에서 나온 것이다.

### 원인 — 5가지로 갈린다 (전부 실측 확인)

1. **대상 파일이 삭제됐다 (9개)** — `/tmp/t147-final.log` 를 기다렸으나 그 파일은 developer 가 **오염 사고 때 지웠다**(두 프로세스가 같은 로그에 섞여 써서 1차 수치를 철회한 그 사고). `ls` 로 부재 확인. 삭제 사실이 대기자에게 전달될 길이 없었다.
2. **대상 파일이 폐기되고 경로가 바뀌었다 (6개)** — `/tmp/t147-runner-tests.log` 는 **11-03 13:39 에 멈춰** 있다(마지막 줄 `결과: PASS=9 FAIL=13` = 오염 판). 재실행은 `/tmp/t147f-*.log` 로 **경로를 바꿨으므로**, 대기 조건(`overseas-universe` 뒤의 `결과:`)은 영원히 생기지 않는다. 사용자가 본 「출력 없음」이 바로 이것이다.
3. **생산자가 센티넬 줄에 도달하지 못했다 (1개)** — `~/.node-local/rev-t145/logs/sh-done` 은 `~/.node-local/rev-t145/run-sh.sh` **10행**(`echo ALLDONE > $L/sh-done`)이 만든다. 그 앞의 8개 하네스와 `test-git-hooks.sh` 는 전부 로그를 남겼는데(각 `결과: FAIL=0`) `sh-done` 만 없다. 그리고 **로그 타임스탬프가 스크립트의 루프 순서와 맞지 않는다** — `stop-alert` 16:53 이 `holdings-premarket` 16:56·`news-peek` 17:12 보다 이르고, `githooks.out` 16:56 이 루프 마지막 `job-run-log` 17:00 보다 이르다. 게다가 스크립트에 없는 `sh-job-run-log-quick.out` 이 있다 → **같은 디렉터리에 여러 writer 가 썼다**(T-147 의 오염 사고와 같은 계열). 어느 실행이 10행을 소유했고 왜 거기 못 갔는지는 **로그만으로 특정할 수 없다 — 추정하지 않는다.** 대기자는 `ppid=1` 로 **고아**였다(띄운 셸이 먼저 죽었다).
4. **`pgrep -f` 자기참조 교착 (3개)** — `until ! pgrep -f "rev-t126b-in/run-db3.sh"` 는 **대기자 자신의 cmdline 이 그 문자열을 포함**하므로 `pgrep` 이 영원히 자기를 잡아 조건이 참이 되지 않는다. 실측으로 확인했다: `pgrep -af` 가 그 세 대기자와 **내 조사용 ssh 명령까지** 잡았고, 정작 `run-db3.sh` 는 실행 중이 아니었다. **ISS-0002(이름 패턴으로 프로세스를 다루지 말 것)가 왜 필요한지의 실례다** — 금지 이유가 오살(誤殺)만이 아니라 오탐(誤探)에도 있다.
5. **조건이 충족될 수 없었다 — `grep` BRE 에 `\xNN` 이스케이프가 없다 (1개)** — `/tmp/t149-tests/summary.log` 를 보던 대기자의 패턴은 `"=== .\{0,2\}\xeb\x81\x9d"` 였다(「끝」의 UTF-8 바이트를 쓰려 한 것). ssh 로 single quote 안에 넘겨 셸이 해석하지 않았고, **`grep` 의 BRE 에는 `\xNN` 이 없어 리터럴 문자열 `\xeb\x81\x9d` 로 전달됐다** → 절대 일치하지 않는다. 그 세션이 규명하고 내가 같은 파일로 직접 시험해 확인했다:

   | 시험 | 결과 |
   |---|---|
   | ① 대기자 패턴 그대로 | **0건 · rc=1** (영원히 거짓) |
   | ② 전달된 실제 바이트(`od -c`) | `= = =   . \ { 0 , 2 \ } \ x e b \ x 8 1 \ x 9 d` |
   | ③ 리터럴 `=== 끝` | 1건 · rc=0 |
   | ④ `$'=== .\{0,2\}\xeb\x81\x9d'`(셸이 해석) | 1건 · rc=0 |

   🔴 **내가 이 항목을 처음에 「조건이 이미 충족됐는데도 못 빠져나왔다 · 원인 불명」으로 적은 것이 틀렸다.** `ps` 출력의 `\xeb\x81\x9d` 를 머릿속에서 「끝」으로 디코딩하고 「패턴은 그 줄과 일치한다」고 단정했는데, **그 한 줄을 실제로 실행해 보지 않았다.** 이 task 에서 여덟 번째 같은 오류다(아래 「내 오류 7건의 공통 패턴」의 연장 — 측정하지 않고 추론한 것). 패턴을 **읽는 것과 실행하는 것은 다르다.**

   경위도 기록할 가치가 있다: 그 세션은 바로 앞 시도에서 `until pgrep -f "bash /tmp/t149-tests.sh"` 를 썼다가 **위 4번과 같은 자기참조**에 걸렸고, 그걸 피해 파일 내용 검사로 바꾸면서 한글이 ssh·셸을 거쳐 깨질까 봐 바이트 이스케이프로 「안전하게」 쓰려다 **더 나쁜 버그**를 만들었다. 실제로는 ③처럼 리터럴 한글이 그냥 동작한다.

### 조치

- 20개를 **PID 로만** 종료했다(`/proc/<pid>/cmdline` 으로 대상 패턴을 한 건씩 검증한 뒤 `kill`). `pkill`·`killall`·이름 패턴은 쓰지 않았다 — 위 4번이 그 위험의 실물이다.
- 고아가 된 `sleep` 17개는 각자 간격(최대 90초) 안에 **자연 소멸**을 확인했다.
- 오염 로그를 `/tmp/t147-runner-tests.log.CONTAMINATED-20261103-DO-NOT-USE` 로 개명하고, `/tmp/t147-LOGS-README.txt` 에 ❌ 쓰지 말 것 / ✅ 정본(`t147-runfinal.log`·`t147f-*.log`, 합계 PASS=756 FAIL=0) 을 적었다. **폐기 로그를 지우지 않고 남겨 둔 것이 이 혼선의 직접 원인**이었다.

### 눈에 보이지 않던 비용

CPU 는 거의 쓰지 않지만 ① 세션이 「시험이 아직 돌고 있다」고 믿게 만들고 ② 죽을 때 **낡은 알림을 대량으로** 발생시켰다(이번 정리 직후 developer 에이전트가 같은 종류 알림 255건을 받았다고 보고했다). 즉 **조용히 쌓이면서 판단을 오염시키는 종류의 잔재**다.

### 교훈

무한 `until` 대기는 ① 타임아웃 ② **생산자 생존 확인** ③ 센티넬 경로를 생산자와 공유 ④ **띄우기 전에 그 조건을 한 번 실행해 보기**(조건이 지금 참이면 즉시 끝나는지 — `grep -c` 를 먼저 돌린다. 5번이 바로 이걸 하지 않아 생겼고, 그 세션이 재발 방지로 제안한 것이다. 바이트 이스케이프가 필요하면 `grep -P '\xeb\x81\x9d'` 또는 `$'\xeb\x81\x9d'` 로 셸·grep 이 해석하게 한다) — 이 넷 중 하나도 없으면 영원히 돈다. 이번 20개는 전부 셋 다 없었다. 그리고 이것은 T-147 때 developer 가 겪은 「살아 있는 백그라운드 작업을 죽었다고 단정」의 **거울상**이다 — 여기서는 **죽은 생산자를 살아 있다고 가정**했다. 양쪽 다 「상대 프로세스의 상태를 확인하지 않고 가정한다」는 한 가지 결함이다. → `/이슈기록` 등록 후보(이 task 의 「내 오류 7건」과는 별개 항목).

### 2026-11-05 추가 검증 — 엄격 기준(분당 1건·빠진 분 0·중복 분 0)

T-149 가 제시한 더 엄격한 기준으로 다시 쟀다. **`:00` 초 적중률은 기준이 될 수 없다**(그쪽 실측 기저율 28%) — 분 단위 커버리지를 본다.

- **11-05 국내 장중(09:00~15:30) 대상 391분: 빠진 분 0 · 중복 분 0.** 이날은 T-147·T-148·T-149 가 모두 배포된 상태다.
- 같은 구간 `strategy-eval`(앵커 `holding-checker`): **median 55초 · p90 134초 · max 157초**(n=67). 11-04 은 median 128초 · p90 222초 · max 299초(n=58) → **median 57% 감소**. [[T-148-strategy-eval-serial-fanout]] 이 보고한 `median 117→54초`(원천: `api-usage-*.jsonl` 버스트 지문)와 사실상 같은 값이다 — 원천·필터가 달라 수치가 조금 다르지만 **모순이 아니다**(내가 처음 쓴 `mean 73초`를 그쪽 median 과 나란히 놓으면 모순처럼 보여 지표를 맞췄다).
- **워치독 복구 0건.** `strategy-eval` max 가 157초로 내려와 틱 길이가 임계 300초에 닿지 않는다 → 이 task 가 남긴 잔여 창이 **실질적으로 닫혔다**.
- **여전히 미검증**: 손절 알림 실제 발송이 11-05 도 0건이라 **텔레그램 중복 발송은 아직 경험적으로 확인되지 않았다.** 보유 종목이 손절가에 닿는 날에만 확인된다.

### 2026-11-05 22:52 — 분기 해소 병합 + 문서 push·배포

사용자 지시 「커밋 및 푸시 진행해줘」. **새로 커밋한 코드는 없다** — 다른 세션들의 미커밋 작업(T-113 마이그레이션·chat ownership·`src/lib/db.ts` 등 17개 수정 + untracked 30여 개)은 **검토 없이 운영에 나가므로 커밋하지 않았다.** 한 것은 분기 해소 병합과 이미 커밋돼 있던 문서의 push 다.

- **병합** `50ac5ad`(`--no-ff`): `origin/main` 단독 커밋 `a6b7605 fix(T-150)`(= 당시 운영 릴리스)를 로컬 위로 병합. `ahead 14, behind 1` → `ahead 16`. 교집합 파일 0개·충돌 0.
- **병합을 막던 충돌 6개를 손실 없이 치웠다** — 치우기 전에 전부 동일성을 확인했다: src 3개는 작업본 내용이 `origin/main` 과 **바이트 동일**이라 `git checkout --` 로 되돌린 뒤 병합이 같은 내용을 복원 · mockups 2개도 **바이트 동일**이라 삭제 후 병합이 복원. 🔴 `agent-vault/.../T-150-funnel-always-expanded.md` 는 **origin 판과 달랐다**(작업본 `4e84048a` / origin `5225b66a`) = **T-150 세션의 더 새로운 미저장 작업** → 백업 보존 후 옮겨 두고, 병합 뒤 **작업본에 복원**해 그 세션 작업이 `M` 로 살아 있게 했다. 「충돌 파일을 지우고 병합하라」는 git 의 표준 안내를 **내용 확인 없이 따랐으면 그 작업을 날렸다.**
- 안전망: 미커밋 전체 패치(993줄)·status 스냅샷·T-150 문서를 `~/.local/share/stockinvest-premerge-20261105/` 에 떠 뒀다. 병합 전후 status 대조에서 사라진 6항목은 전부 **커밋되어 추적 상태로 바뀐 것**이고 유실 0.
- **ISS-0013 재발** — push 직전 점검에서 `.git/refs/codex/turn-diffs/checkpoints/...` 아래 Synology 사이드카 **3개** 발견(`rc=1`). 문서 절차대로 격리(삭제 아님, `~/.local/share/git-eadir-quarantine/20261105-225152/`), 재점검 「깨끗」·실제 ref 24개 불변·`git fetch` 정상 확인 후 push. **Codex 가 ref 를 쓰면 재발한다**는 기존 관측과 일치한다(경로가 `refs/codex/`).
- **push → 배포**: `a6b7605..50ac5ad`(16커밋) → 릴리스 **`20261105-225235-50ac5ad1`**, push 후 약 50초에 반영. 롤백 지점 `20261104-180613-a6b7605f`. **운영 코드 변경은 `scripts/cron-runner.sh` 1줄(주석 중복 제거)뿐**이고 나머지는 문서와 이미 운영 중이던 T-150 병합분이다. 러너 sha `aeeb4b2d5979f3f6` → `2de6119bc05013b8`.
- **배포 후 확인**: 두 앱 online·재시작 0 · health `ok:true`·`safetyStatus green`·`dryRun true`·`killSwitch false` · 러너 `59012` + 티커 `59020`(**ppid 불변식 성립**) · 🔴·🔶 0줄.
- 🔴 **컷오버에서 티커가 두 번 떴는데 호출은 한 번뿐이다 — 세 번째 실사례다.** `22:53:04`(옛 러너 pid 58697)·`22:53:07`(새 러너 pid 59020) 두 줄이 찍혔고 `22:54:00` 의 `stop-alert` 는 **1건**이다. 11-04 17:27·18:06 에 이어 세 번째로, 배포 재기동에서 알림이 빠지거나 겹치지 않는다는 증거가 누적됐다(락이 막은 것인지 옛 러너가 먼저 죽은 것인지는 여전히 로그로 구분되지 않는다 — 입증이 아니라 관측이다).
