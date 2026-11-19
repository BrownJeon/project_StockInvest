---
task_id: T-177
title: 배포 때 크론 잡이 「연결 실패·응답 없음」으로 기록되는 문제 — 러너가 웹 기동을 기다리고 연결 거부만 재시도
status: review
waiting: PR 소스검토 후 사용자의 main 반영(=운영 배포) 승인
priority: high
project: StockInvest
created: 2026-11-19
updated: 2026-11-19
base_ref: d17f689
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, codex, qa]
related_tasks: [T-175-outbound-connect-timeout-and-alert-retry, T-176-universe-refresh-failure-isolation, T-160-home-anomaly-diagnostics, T-147-cron-tick-starvation, T-112-run-judgment-record-foundation]
tags:
  - type/task
  - domain/cron
  - domain/deploy
  - domain/ops
aliases:
  - 배포 중 크론 연결 실패
  - 데이터 이상 실행 실패 11건
execution_context:
  schema_version: 1
  origin_tool: claude
  current_tool: claude
  current_procedure: claude_standard
  current_scope: 원인 확인·설계부터 구현·감사·QA·서버 worktree 커밋·작업 브랜치 push·PR 생성까지. main 반영(=운영 배포)은 PR 검토 후 사용자 승인
  last_event_id: E2
---

# T-177 배포 때 크론 잡이 「연결 실패·응답 없음」으로 기록되는 문제

작업 worktree: 서버 `~/.node-local/stockinvest-t177` (detached, base `d17f689` = origin/main = 운영 릴리스 `20261119-093417-d17f6896`). `node_modules` 는 t175 worktree 로의 심볼릭 링크 — **스테이징하지 않는다.**

## 목표·배경 (Leader)

2026-11-19 앱 홈 「데이터 이상·실행 실패 내역 11건」, 사유 대부분 「연결 실패」·「응답 없음」(사용자 발견).

### 확인한 사실 (Leader, 2026-11-19 10:0x 서버 실측 — 읽기 전용)

- 11건 = `job_run_log` `recorder=runner_hook status=failed` 11행, **두 시각에 몰려 있다.**
  - 08:39:14 — `holding-checker`·`strategy-eval`·`signal-followup`·`signal-expiry`·`trade-report` 5건, 전부 `HTTP=000/curl=7`(연결 거부), 시작=종료 같은 초.
  - 09:33:58~09:34:51 — `strategy-eval` 2건 `curl=52`(빈 응답 — 처리 중 끊김, 첫 건은 50초 처리 중), `signal-followup`·`signal-expiry`·`portfolio-snapshot`·`trade-report` 4건 `curl=7`.
- 두 시각은 운영 배포 시각과 일치한다 — webhook `START 2026-11-18 23:38:40 UTC`(T-175, = 08:38:40 KST)·`START 2026-11-19 00:34:14 UTC`(T-176, = 09:34:14 KST).
- 지난 2주 `curl=7`/`curl=52` 실패도 배포 시각에 몰린다(11-15 10건 ↔ 그날 배포 6회, 11-14·11-12 등) [가능성 높음 — 날짜별 대조, 행별 대조는 안 함].
- 배포 경로(`~/.local/webhook-deploy/deploy-stockinvest.sh` → HOME-SERVER_CONFIG `release.sh`):
  1. `current` 전환 → `pm2 startOrReload` 로 `stockinvest`(웹, fork·1개라 reload = 재시작)·`stockinvest-cron`(러너) 차례로 재시작
  2. `ensure_current_cwd` 가 **매번** 「옛 경로를 잡고 있다 → delete 후 재등록(수 초 중단)」으로 웹·러너를 **한 번 더** 재시작(11-15·11-18·11-19 배포 로그 전부 확인).
  → 배포 1회에 웹이 두 번 내려갔다 올라오고, 러너도 두 번 새로 뜬다.
- 러너(`scripts/cron-runner.sh`)는 시작하자마자 `i=0` 첫 틱에서 `i % 5|15|30|60 == 0` 인 잡(strategy-eval·signal-followup·signal-expiry·portfolio-snapshot·trade-report)을 **한꺼번에** 부른다. 웹(Next)이 아직 포트를 열기 전이면 전부 `curl=7` 로 즉시 실패한다. 기동 대기·재시도가 없다.
- `curl=52` 는 웹 재시작이 **처리 중이던 요청**을 끊은 것이다(09:33:58 시작한 strategy-eval 은 50초 처리 중 끊김). 이 요청은 서버에서 일부 실행됐을 수 있다.
- 실패 뒤 다음 주기에서 같은 잡이 정상 실행됐다(같은 날 rollup·이후 OK 로그) — 데이터 손실은 해당 회차 1회분이다.
- webhook 은 `push` 이벤트 + ref 가 `/main`·`/master` 로 끝날 때만 배포한다(`server.js:118-128`) — 작업 브랜치 push 는 배포를 일으키지 않는다.

## 사용자 지시·승인 (원문 보존)

- 2026-11-19 10:0x 「지금 앱에서 '데이터 이상·실행 실패 내역11건'로 나오는데 사유가 대부분 연결실패나 응답없음으로 나와. 원인확인해서 수정작업 진행해줘. 이건 푸시전에 pr생성해서 소스검토 진행하자」
- 범위: 원인 확인·수정·검증·작업 브랜치 push·PR 생성. **main 반영(= 운영 배포)은 PR 검토 뒤 별도 승인.**

## 설계 (Leader — Developer 구현 사양)

화면 변경 없음. DDL 없음. 버전: 웹 `package.json`·`package-lock.json` 0.16.0 → **0.17.0**(마이너). 앱(APK) 무관.

### WP-1 러너 기동 시 웹 준비 대기 (`scripts/cron-runner.sh`)
- 메인 루프(`while true`) 진입 **전**, 그리고 stop-alert 티커를 띄우기 **전**에 웹이 요청을 받는지 확인한다: `$BASE_URL/api/health` 에 `curl --max-time` 짧게 GET → **HTTP 코드가 000 이 아니면(어떤 응답이든) 준비됨**. 아니면 짧은 간격으로 반복, **상한 시간**(Developer 가 근거와 함께 정함 — 권장 90초 안쪽. HOME-SERVER 순찰·T-037 워치독 300초 하트비트 기준을 넘기지 않는다. 대기 중에도 하트비트를 갱신할지 판단해 적는다).
- 상한을 넘기면 **기다리지 않고 기존처럼 진행**한다(러너가 영원히 멈추면 안 된다 — 손절 알림·진입 감시가 서 있게 된다). 결과는 한 줄 로그(준비됨·걸린 초 / 상한 초과).
- health 라우트는 DB ping 등을 하므로 응답 코드(200/503)를 판정에 쓰지 않는다 — 「포트가 열려 응답했다」만 본다.

### WP-2 연결 거부(curl 7)만 재시도 (`call()`)
- `curl` 종료 코드가 **7(연결 거부 — 요청이 서버에 전달되지 않음)** 일 때만, 웹 준비를 짧게 기다린 뒤 **1회** 다시 보낸다.
- **52(빈 응답)·28(시간 초과)·56(수신 실패) 등은 재시도하지 않는다** — 서버에서 이미 실행됐을 수 있다. 특히 `entry-watcher`(자동 주문)·`stop-alert`(알림 횟수 규칙) 이중 실행 위험. 이 경계를 주석과 시험으로 고정한다.
- 대기 시간은 **틱당 총량 상한**을 둔다(웹이 정말 죽어 있을 때 매 call 마다 기다려 틱이 순찰 한도 300초를 넘지 않게 — 최악 계산을 주석에 적는다). 한 틱에서 한 번 「준비 안 됨」으로 상한을 다 쓰면 그 틱의 나머지 call 은 즉시 기존처럼 실패 처리.
- 기록: `job_run_log` 후크(`jrl_hook`)·로그 줄·`CALL_LAST_CODE` 는 **최종 결과 기준** 1회만 남긴다(재시도 성공 = OK). 재시도가 있었다는 사실은 로그 한 줄로 남긴다. `post-market-overseas` 재시도 로직(`pmo_*`)·`CALL_MAX_TIME` 시맨틱이 바뀌지 않게 한다.
- stop-alert 티커 자식 프로세스(`alert_ticker_once`)도 `call()` 을 쓰는지 확인하고, 쓴다면 같은 규칙이 적용될 때 티커 주기·락에 문제가 없는지 적는다.

### 범위 밖 (하지 않는다 — 보고만)
- **`release.sh` 의 이중 재시작**(`startOrReload` 뒤 `ensure_current_cwd` 가 매번 delete+재등록): HOME-SERVER_CONFIG 공용 배포 스크립트라 전 프로젝트 영향 — 사용자 결정 후 별 작업.
- `curl=52`(처리 중 요청이 재시작에 끊김) 근본 해소 — 웹 graceful shutdown·배포 순서(러너 먼저 멈춤) 등. 원인만 기록.
- 홈 「데이터 이상」 화면 문구·집계 변경 — 화면 변경이라 데모 게이트 대상. 이번에는 하지 않는다.
- 이미 기록된 오늘 11건은 그대로 남는다(과거 기록 수정 안 함).

### 시험·검증 요구
- 기존 `scripts/test-cron-runner-*.sh` 방식(블록 잘라 시험, curl 스텁)으로 새 시험 파일: 준비 대기(즉시 준비·몇 번 뒤 준비·상한 초과 후 진행), call 재시도(7 → 재시도 성공 / 7 → 재시도도 7 / 52·28 은 재시도 없음 / 틱 예산 소진 뒤 즉시 실패 / 후크 1회·최종 코드).
- 기존 `scripts/test-cron-runner-*.sh` 전부 통과(특히 call-body·job-run-log·alert-ticker·pmo-retry·stop-alert).
- `bash -n`·shellcheck(있으면)·전체 jest(무거운 시험은 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10 …`, Node `~/.node-local/v24.22.2/bin`)·`tsc`. 기존 실패 묶음과 새 실패를 이름으로 구분.
- 운영 DB 쓰기·`/api/cron/*` 호출·KIS 실호출·pm2 조작 금지. 운영 3003 포트에 시험 요청을 보내지 않는다(시험은 스텁·임시 포트).

## Developer

- [12:13] 실행 도구: claude(developer 서브에이전트). 작업 위치 서버 worktree `~/.node-local/stockinvest-t177`(base d17f689). 커밋·push·pm2·DB·`/api/cron/*`·KIS 호출 없음. Mac NFS 트리 미변경.
- [12:13] 변경 파일: `scripts/cron-runner.sh`(+133줄, 삭제 0 — 기존 줄 변경 없이 추가만), 새 시험 `scripts/test-cron-runner-connect-retry.sh`(337줄), 기존 시험 10개 갱신(call-body·daily-bars·daily-bars-kr·holdings-premarket·job-run-log·news-peek·news-split·overseas-universe·pmo-retry·stop-alert), `package.json`·`package-lock.json` 0.16.0 → 0.17.0.
- [12:13] 구조: ① 최상위 블록 `# >>> connect-retry (T-177)` ~ `# <<< connect-retry`(alert-ticker 블록 바로 앞) — 상수·`web_ready_probe`·`web_ready_wait`·`call_connect_retry_due` + 시작 대기 1회(WP-1, 티커 기동·메인 루프 전). ② call() 에 `# T-177` 표지 줄 5개 — curl 줄을 `while :; do … done` 로 감싸고 첫 시도 뒤 판정 함수가 0 을 줄 때만 한 번 더 돈다. curl 줄·CALL_LAST_CODE·로그·jrl_hook·rm 은 한 글자도 안 바뀜(들여쓰기 포함). ③ 메인 루프 틱 시작에 예산 채움 줄 1개. 재시도 판단을 별도 함수로 뺀 것은 call() 본문 변경을 최소화하려는 지시를 따른 것.
- [12:13] 재시도 경계: 판정 함수 첫 줄이 `[ "$ce" = "7" ] || return 1` — 7(연결 거부, 요청이 서버에 닿지 않음)만. 52·28·56 등은 재시도 없음(진입 감시 이중 주문·손절 알림 횟수 규칙 보호). 재시도는 call() 1번에 최대 1번. 기록은 최종 결과로 1회(CALL_LAST_CODE·로그 줄·jrl_hook — 재시도 성공 = OK, 후크 curl_exit 0), 재시도 사실은 판정 함수가 로그 한 줄. jrl_t0 은 첫 시도 시각. pmo_* 는 call() 바깥이라 call() 1번 = 시도 1회 그대로, CALL_MAX_TIME 은 두 시도 모두 같은 curl 줄로 붙는다.
- [12:13] 설계 판단 1(사양과 다른 점 — Leader 확인 필요): 준비 판정을 「HTTP 코드 ≠ 000」 **또는** 「연결 수립(curl num_connects ≥ 1)」으로 했다. 근거: health 라우트가 부팅 설정(ensureSetup) 끝까지 응답을 미룬다 — 2026-11-19 08:39 운영 pm2-out.log 실측 health_setup_wait 10,177·17,182ms, 웹 자체는 「Ready in 194~255ms」이고 같은 시각 실제 잡 호출은 08:39:15 OK. 코드만 보면 포트가 열린 뒤 10~17초를 「준비 안 됨」으로 읽어 15초 예산을 헛쓴다. 서버 curl 7.81.0 실측: 거부 = 종료 7 · 「000 0」, 연결 뒤 무응답 = 종료 28 · 「000 1」. 사양의 의도(「포트가 열려 응답했다」만 본다, 응답 코드 무시)는 유지했다고 판단하지만 문구와 다르므로 확인 바람.
- [12:13] 설계 판단 2(상한 값): 시작 대기 WEB_READY_STARTUP_MAX_SEC=60(웹은 1초 안에 포트를 연다는 위 실측 + 여유, 권장 90 안쪽), probe curl 상한 2초(남은 시간보다 크면 줄임), 메인 루프 틱 예산 CALL_RETRY_TICK_BUDGET_SEC=15(틱 시작마다 채움, 「준비 안 됨」이면 0 으로 → 그 틱 남은 거부는 즉시 실패, 예산 0 일 때는 판정 함수 로그도 안 남김 — call() 의 HTTP=000 로그는 그대로). 대기 함수는 정수 초 기준 상한에서 끝나고(상한에 닿으면 sleep 안 함), 시계가 멈추거나 sleep 이 즉시 돌아와도 반복 횟수 상한(MAX+1)으로 끝난다.
- [12:13] 최악 시간 계산(러너 주석에 기록): 메인 루프 틱에 더해지는 시간 ≤ 15 + 1 = 16초(거부는 즉시, 재시도 호출 길이는 원래 그 호출 시간). 기존 보수식(틱 길이 + sleep 60) 중 지금 코드 최대인 15:30 국내 뉴스 276 → 292초 < 300. 08:00 틱은 해외 분석 120 + 매 분 잡 30 + (티커가 죽었을 때) 손절 알림 20 + sleep 60 = 230 → 246초. job-run-log-spool 주석의 290.2초는 KIS 스냅샷·손절 알림이 08:00 틱에 같이 도는 옛 전제(T-145·T-147 로 더는 성립 안 함)라고 주석에 적었다. 기본 모드는 틱 끝에도 하트비트를 써서 실제 나이는 이보다 60초 작다.
- [12:13] 하트비트 판단: 대기 중에는 쓰지 않는다(쓰는 곳 2곳 고정 — alert-ticker 시험 ⑨, T-037 의미 유지). 시작 대기는 첫 하트비트를 최대 61초 늦춘다 → 옛 러너가 sleep 중 죽었으면 ≤ 약 121초, 긴 틱 도중 죽었으면 「그 틱 경과 + 61초」라 드물게 300초를 넘을 수 있음(잔여 위험 — 넘어도 순찰은 대기 중인 러너 재시작, 앱 워치독은 같은 배포의 웹 재기동 bootGrace 600초 안).
- [12:13] 알림 티커 자식: alert_ticker_once → call() 이므로 같은 규칙을 탄다. 자식은 별도 프로세스라 부모 예산을 공유 못 해 `BASHPID ≠ $$` 일 때 호출(= 회차)마다 15초 예산을 쓰고 부모 예산은 안 건드림. 회차 최악 = 0 + 16 + 재시도 curl 상한 20 = 약 36초 < 60(다음 분 경계 안). 대기 중 락을 쥐지만 겹친 러너의 티커만 막고(경합 = 그 회차 건너뜀, 설계대로) 호출자는 하나, 첫 시도가 서버에 안 닿아 횟수 규칙 표도 1번.
- [12:13] 기존 시험 갱신 방식: call()·러너 전체를 기준 ref 와 비교하는 시험 8개에 T-172 와 같은 방식의 도우미 추가 — 정확한 줄 6개(T177_C1~C5·M1)와 블록 표지로 `no_t177`(러너 전체)·`no_t177_call`(call())·`t177_targets`(각 줄 파일 전체 1개·call() 줄은 call() 안·블록 표지 1쌍) 단언을 더했다. 각 단언이 잡는 것: call() sha 비교는 여전히 「표지 줄 외 call() 한 글자도 불변」, 블록 밖 실행 줄 비교·K6 전체 diff 는 「블록·표지 줄 외 러너 불변」, t177_targets 는 「빼는 줄이 엉뚱한 곳에 생겨 비교 범위가 무검사로 넓어지는 것」. 러너 전체를 돌리는 하네스 9개(위 8개 중 7 + pmo-retry·stop-alert)의 curl 스텁은 `/api/health` 를 T-112 job-run-log 전송과 같은 방식으로 호출 목록에 넣지 않고 「준비됨(200 1)」으로 답한다. job-run-log 의 stdout 비교 2곳(nokfout·J12)은 시작 로그 한 줄을 **정확 일치**(「0초 대기(http://stub/api/health)」)로만 뺀다 — 다른 문구·대기 초가 찍히면 비교가 깨진다. 기대값 자체는 하나도 바꾸지 않았다(범위만 정교화).
- [12:13] 새 시험 connect-retry: S(정적 15) · W(시작 대기 11: 즉시·3번 뒤·상한 60초 초과·연결만 맺음 28/000 1·503·연결 못 맺은 28·probe 상한 축소·시계 정지·시각 오류·잘못된 상한) · R(재시도 22: 7→성공·7→7·52/28/56 재시도 없음·첫 성공 불변·7→503·예산 소진 뒤 즉시 실패·예산 차감 4초→11·틱 채움·CALL_MAX_TIME 120 두 시도 동일·티커 자식 서브셸·자식 회차 최악 15초·판정 함수 없을 때 예전 그대로) · E(러너 전체 19: 시작 대기 → 티커 기동 로그 → 첫 잡 순서·상한 초과 뒤 진행·첫 틱 거부 재시도 → 스풀 최종 코드 200 한 줄·웹이 계속 죽으면 틱당 대기 ≤ 16초). 변이 시험 4개(조건 7 → ≠0 · 실패 시 예산 0 제거 · curl_exit 초기화 제거 · 상한 도달 sleep 생략 제거) 모두 fail 로 잡힘.
- [12:13] 시험 결과: `bash -n` 통과 · shellcheck 서버에 없음(미실행) · `tsc --noEmit` rc 0 · cron-runner 시험 14개 전부 fail 0 — connect-retry 67 · alert-ticker 106(SKIP 0, 실시간 E 포함) · call-body 21 · daily-bars 85 · daily-bars-kr 73 · holdings-premarket 56 · job-run-log 214 · news-peek 84 · news-split 122 · overseas-universe 32 · pmo-retry 76 · stop-alert 23 · m40-forward·m40-forecast pass. (job-run-log 첫 실행은 J12 stdout 비교 1건 실패 → 그 비교에 정확 일치 필터 추가 후 214/0. holdings-premarket·news-peek 은 14개 병렬 + jest 부하에서 1500초 timeout → 단독 재실행 통과.)
- [12:13] jest 전체: 같은 서버에서 기준 d17f689 임시 worktree 와 변경본을 각각 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10` 으로 실행 — 둘 다 480 suites · 13001 tests · 실패 418(실패 suite 28), 실패 이름 집합 비교 **새 실패 0 · 사라진 실패 0**. 러너를 읽는 jest 7개 중 job-slots E11(m40-forward·m40-forecast 라벨이 슬롯 표에 없음)·profit-engine isolation 3건은 기준에서도 같은 실패(이번 변경 무관). Node 는 지시된 `~/.node-local/v24.22.2/bin` 이 서버에 없어 `/usr/bin/node` v24.22.2 로 실행. 임시 base worktree 는 제거함.
- [12:13] `scripts/test-git-hooks.sh` 526 통과 / 0 실패. SAFETY_PATHS 에 `^scripts/cron-runner\.sh$`·`^scripts/test-cron-runner-` 가 있어 새 시험 파일도 감시 대상 — 커밋 때 Reviewer 판정 scope 에 둘 다 필요.
- [12:13] 범위 밖 발견(보고만): ① release.sh 이중 재시작은 그대로(HOME-SERVER 공용) ② curl=52(처리 중 요청이 재시작에 끊김)는 재시도하지 않으므로 이번 수정으로 사라지지 않는다 — 09:34:48 strategy-eval 같은 건은 계속 「응답 없음」으로 남을 수 있음 ③ job-slots E11 기존 실패(m40 라벨 슬롯 표 누락) ④ 시험 중 강제 종료한 첫 일괄 실행이 /tmp/tmp.* 하네스 임시 디렉터리를 남겼을 수 있음(다른 세션 것과 구분이 어려워 지우지 않음).

### Leader 결정 (2026-11-19, Developer 보고 수신 후)
- 설계 편차 승인: 준비 판정을 「HTTP 코드≠000」에서 「HTTP 코드≠000 **또는** TCP 연결 성립(curl `%{num_connects}`≥1)」으로 넓힌다. 근거: 운영 08:39 로그에서 웹은 194~255ms 에 Ready 였고 실제 job 호출도 08:39:15 에 OK 였는데 `/api/health` 응답은 부팅 초기화 때문에 10,177·17,182ms 걸렸다. 코드만 보면 그 10~17초를 「미준비」로 오판해 재시도 예산(15초)을 다 쓴다. 판정 대상(연결 거부=exit 7)과 재시도 대상(exit 7 만)은 그대로다.
- 상한: 시작 대기 60초(사양의 「90초 이하」 안), 틱당 15초 예산 — 승인.

## Reviewer

- [12:37] 실행 도구: claude(reviewer 서브에이전트). 서버 worktree `~/.node-local/stockinvest-t177`(base d17f689)에서 읽기·시험 실행만 했다. 코드 수정·커밋·push·pm2·DB·운영 `/api/cron/*`·KIS 호출 없음. 변이 시험은 `mktemp -d` 임시 복사본에서만 했다(worktree 불변).
- [12:37] 범위 확인: `git status` — 수정 `scripts/cron-runner.sh`·기존 시험 10개·`package.json`·`package-lock.json`·vault 로그, 신규 `scripts/test-cron-runner-connect-retry.sh`·T-177 task 문서·`node_modules`(심볼릭 링크). 그 밖 파일 변경 없음. 러너 diff는 추가만(+133줄, 삭제 0).
- [12:37] 직접 실행: `bash -n scripts/cron-runner.sh` 통과. `test-cron-runner-connect-retry.sh` PASS=67 FAIL=0 · `call-body` 21/0 · `pmo-retry` 76/0 · `job-run-log` 214/0 · `stop-alert` 23/0(모두 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10`). 나머지 5개 기존 시험(daily-bars·daily-bars-kr·holdings-premarket·news-peek·news-split·overseas-universe)은 내가 다시 돌리지 않았고 Developer 보고만 있다(미확인). 변경 형태는 위 5개와 같은 도우미 추가라 같은 방식으로 읽었다.
- [12:37] 변이 시험(임시 복사본): ① 판정 첫 관문 `= "7"` → `!= "0"` — 새 시험이 FAIL(S 정적 관문 단언·R3 52 재시도 등 다수)로 잡음. ② `call()` 의 `# T-177` 판정 줄(C3)을 `true &&` 로 바꾼 변이 — S 표지 줄 단언·기준 call() 대조에서 FAIL로 잡음(표지 줄 자체를 바꿨으므로 동작 시험이 아닌 정적 단언이 먼저 잡은 것). ③ `curl_exit=0` 초기화 제거 변이는 내 sed 가 맞지 않아 적용되지 않았고(결과 67/0은 무변이 상태) 직접 확인하지 못했다 — Developer 보고(변이 4개 모두 fail)는 독립 확인 못 함. 다만 R1 이 후크 `200 0`을 단언하므로 이 변이도 잡힐 구조로 읽었다.
- [12:37] 1. 재시도 정확성: call() 의 `while :; do curl… ; [ retried = 0 ] && call_connect_retry_due "$label" "$curl_exit" || break; retried=1; curl_exit=0; done` 구조를 줄 단위로 읽었다. (a) `curl_exit` 는 재시도 직전에 0으로 비워지고 `code` 는 curl 줄이 매번 새로 대입한다. (b) 판정 함수 첫 줄이 `[ "$ce" = "7" ] || return 1` 이라 52·28·56 등은 여기서 끝난다. (c) `retried` 가 1이 되면 `A && B || break` 의 A가 거짓이라 반드시 break → 최대 1회 재시도. (d) 로그 줄·`CALL_LAST_CODE`·`jrl_hook`·`rm` 은 루프 밖(done 뒤)에 있어 최종 결과로 1회만 기록된다(이중 기록 없음). (e) 본문 파일은 curl `-o` 가 시도마다 같은 경로를 쓰고, exit 7 이면 curl 이 파일을 쓰지 않으므로 잔여 내용이 최종 결과를 오염하지 않는다. (f) 러너는 `set -u` 만 쓰고 `set -e` 가 없다. `BASHPID`·`CALL_RETRY_BUDGET_LEFT` 는 기본값 전개(`${…:-}`)를 써서 `-u` 에서 안전하다. 판정 함수가 없을 때(`unset -f`)도 `2>/dev/null || break` 로 예전 동작(R8). 문제 없음.
- [12:37] 2. 멱등성·이중 실행: curl 7 은 TCP 연결이 맺어지지 않은 경우뿐이라 요청이 서버에 닿지 않는다. 재시도 가능 조건이 정확히 `ce = 7` 하나임을 정적으로 확인했고(시험 S 가 52·28·56 문자열이 판정 함수에 없음도 단언), 동작 시험 R3 가 52·28·56 에서 POST 1번·probe 0번을 단언한다. 따라서 진입 감시(entry-watcher) 자동 주문·손절 알림(stop-alert)·주문 동기화에서 이중 실행은 만들어지지 않는다. 일부 응답을 받은 후 끊긴 요청(52)은 이번 수정으로도 안 고쳐진다는 점은 Developer 가 범위 밖으로 이미 밝혔다. 해외 장마감 분석(pmo_*)의 하루 3회 상한은 call() 바깥에서 call() 1번 = 1회로 세므로 불변이고, 7 재시도는 서버에 안 닿은 요청이라 서버가 받는 횟수는 늘지 않는다. `CALL_MAX_TIME` 은 같은 curl 줄이라 두 시도에 똑같이 붙는다(R6).
- [12:37] 3. 틱 예산: 메인 루프는 `CALL_RETRY_BUDGET_LEFT` 를 틱 시작에서 15초로 채우고(메인 루프 첫 call 앞, 시험 S 단언), 실제 대기만큼만 깎으며 「준비 안 됨」이면 0 으로 만든다(R4·R5). 알림 티커 자식은 `BASHPID ≠ $$` 로 판별해 부모 예산을 건드리지 않고 호출(회차)마다 15초를 쓴다(R7). 러너에서 `call` 이 `$(…)`·파이프·괄호 서브셸 안에서 불리는 곳이 메인 루프에는 없음을 grep 으로 확인했다(티커 자식만 서브셸). 회차 최악 약 0+16+20=36초 < 60초 계산에 동의한다. 알림 티커 자식이 락을 쥐고 최대 16초 기다리는 것은 겹친 러너의 티커만 건너뛰게 하며 설계 의도와 같다.
- [12:37] 4. 하트비트·순찰(300초): 틱에 더해지는 시간은 대기 ≤ 15+1초이고 재시도 호출 자체의 길이는 「원래 그 호출이 걸렸을 시간」이라 기존 보수식에 이미 들어 있다(웹이 열려 한 번 「준비됨」이 되면 같은 틱의 다른 호출은 첫 시도에서 성공하므로 재시도 비용이 누적되지 않는다). 15:30 국내 뉴스 틱 276 → 292초 < 300초 산식에 동의한다. 다만 292초는 여유 8초뿐이라 이 틱 길이의 다른 증가(뉴스 잡 추가 등)가 생기면 바로 넘는다 — 아래 LOW-1 과 함께 기록. 시작 대기(최대 약 61초)는 하트비트를 쓰지 않으므로 「옛 러너의 마지막 기록 나이 + 61초」가 순찰 눈에 보인다. 정상 배포(옛 러너가 sleep 중 교체)는 ≤ 약 121초라 안전하고, 옛 러너가 긴 틱 도중 죽은 드문 경우만 300초를 넘을 수 있다. 순찰 스크립트(HOME-SERVER)는 이 서버에서 찾지 못해 재시작 쿨다운·주기는 확인하지 못했다(미확인). 수용 가능하다고 판단하나 아래 LOW-1 권고를 남긴다.
- [12:37] 5. 준비 판정(probe): `GET $BASE_URL/api/health` 에 `-s -o /dev/null --max-time <≤2> -w "%{http_code} %{num_connects}"` 만 쓴다 — `x-cron-secret`·`CRON_SECRET`·POST 가 블록 안에 없음을 시험 S 가 단언하고 내가 블록 본문에서도 확인했다. health 는 무인증 GET 이라 비밀이 나가지 않는다. 출력 파싱은 `http_code` 가 `[1-9][0-9][0-9]` 이거나 `num_connects` 가 숫자이면서 ≥1 일 때만 준비로 본다. 실측(Developer, curl 7.81.0): 거부 = 종료 7 · `000 0`, 연결 뒤 무응답 = 종료 28 · `000 1` — 내가 서버에서 다시 재현하지는 않았다. 숫자가 아니거나 비어 있으면(curl 없음 등) 「준비 안 됨」으로 떨어진다(fail-closed, 재시도 없음). 행(hang) 방지: probe 의 `--max-time` 은 남은 시간보다 크지 않게 줄이고, 상한 초과 뒤에는 sleep 없이 끝나며, 반복 횟수도 `MAX+1` 로 묶여 시계 정지·sleep 즉시 반환·date 오류에서도 끝난다(W3·W6·W7 통과). 「연결만 맺어지면 준비」 편차(Leader 승인)는 재시도 대상(exit 7)을 넓히지 않고 「기다림을 일찍 끝내는」 조건만 바꾸므로 안전성 영향 없음.
- [12:37] 6. 시험 변경 검토: 10개 기존 시험에 추가된 `no_t177`/`no_t177_call`/`t177_targets` 는 (i) 정확 일치(`grep -vxF`) 줄 6개와 (ii) `# >>> connect-retry (T-177)` ~ `# <<< connect-retry` 블록만 뺀다. 블록 표지가 하나라도 사라져 awk 가 파일 끝까지 지우면 기준 ref 대조 diff 가 달라져 실패하고, `t177_targets` 가 표지 줄 1개씩·call() 안 위치·블록 표지 1쌍을 단언한다(변이 ②에서 실제로 작동 확인). 뺀 줄을 바꾸거나 블록 안에서 기존 코드를 건드리면 기준 대조 diff 가 잡는다 — 다만 **블록 안의 내용은 기존 시험에서는 가려지고** 동작 검증은 새 시험이 한다(설계 의도와 같음). 하네스 curl 스텁의 `/api/health` → `200 1` 응답과 job-run-log 의 `no_t177_log`(시작 로그 한 줄 정확 일치만 제외)는 범위가 좁다. 약화로 볼 만한 넓은 패턴은 발견하지 못했다. 기대값 자체는 바꾸지 않았다.
- [12:37] 7. 범위: 러너 diff 는 추가만. 기존 시험 10개 변경은 위 도우미·스텁 추가에 한정된 것으로 읽었다. `package.json`·`package-lock.json` 은 0.16.0 → 0.17.0(CLAUDE.md 버전 규칙의 마이너 증가). 
- [12:37] LOW-1 (`scripts/cron-runner.sh` 시작 대기 블록 ~611행): 시작 대기 중 하트비트를 쓰지 않아 최악 약 61초 순찰 나이가 더해진다. 시나리오: 옛 러너가 긴 틱(≈240초) 도중 죽은 직후 배포 → 새 러너가 대기 → 순찰이 300초를 넘어 대기 중인 새 러너를 재시작 → 같은 상황 반복 가능(웹이 60초 넘게 안 열릴 때만, 순찰 주기·쿨다운 미확인). 권고(선택): 시작 대기 호출 직전에 하트비트를 정확히 1회 쓰면 이 합산이 사라진다(대기 중 반복 쓰기는 T-037 의미를 흐리므로 반대, 1회는 「러너가 지금 떠 있다」는 사실). 이 경우 시험 S 의 「하트비트 쓰기 2곳」 단언을 3곳으로 갱신해야 한다. 지금 상태로도 통과로 본다.
- [12:37] LOW-2 (15:30 틱 여유): 292초 대 300초로 여유 8초 — 현재 코드에서는 충족하나, 이후 그 틱에 잡이 더해지면 바로 깨진다. 권고: 러너 주석의 계산 근거를 유지하고 해당 틱의 잡을 늘리는 변경이 있을 때 재계산하도록 task 문서에 한 줄 남긴다(코드 변경 불필요).
- [12:37] LOW-3 (staging 주의): `node_modules` 가 `.gitignore` 에 걸리지 않는 untracked 심볼릭 링크(`../stockinvest-t175/node_modules` 를 가리킴)다. 커밋 때 `git add -A`·`git add .` 를 쓰면 링크가 들어간다. 권고: 파일을 명시해 add 하거나 커밋 전에 링크를 제거한다. (코드 결함이 아니라 절차 주의.)
- [12:37] 요약: critical 0 · high 0 · medium 0 · low 3. QA 집중 지점(high_risk_areas): `scripts/cron-runner.sh` call() 의 `# T-177` 루프(137~146행)·`call_connect_retry_due`(589행~)·`web_ready_wait`(558행~)·시작 대기(611행~)·메인 루프 예산 채움 줄(~891행), `scripts/test-cron-runner-connect-retry.sh`. QA 는 (1) 52 에서 재시도 0 (2) 배포 재시작 시나리오의 첫 틱 연결 거부가 재시도로 OK 처리 (3) 하트비트 간격이 시작 대기 후에도 이전 수준인지를 보면 된다. 실 배포 후 확인은 Deployer/Leader 영역.
- [12:37] 1차 감사 판정: pass (scope 동일) — 아래 Codex C2 판정 후 마지막 줄에 판정을 다시 발급한다.

- [12:51] Codex C2 지적 판정(low, `web_ready_wait` 의 `date +%s` 정수 초 차감, 601행 부근): 채택 안 함 — 위험이 낮다고 보고 수용(a). 코드·시험은 읽기만 했고 이번 판정에서 시험을 다시 돌리지 않았다(미실행). 지적 자체는 사실로 확인: 대기마다 `now - t0` 정수 차이를 예산에서 깎아 한 번의 대기가 실제보다 최대 1초 미만 적게 계산된다(실제 s는 [charged-1, charged+1) 범위).
- [12:51] 최악치 계산: 대기 1회의 과소 계산은 1초 미만이므로 틱당 초과분은 (재시도 대기가 성공으로 끝난 횟수 N) 초 미만이다. 기존 상한 약 16초 + (N-1)초가 된다. 상한 16초는 「한 번 안 열림 → 한 번 대기」 가정이며 N 이 1이면 이 오차의 영향이 이미 계산에 들어 있다. N 이 2 이상이려면 같은 틱 안에서 웹이 「내려감 → 1초 안에 올라옴」을 호출 수만큼 반복해야 한다(대기가 성공하면 그 뒤 호출은 첫 시도에서 연결되므로). 배포 한 번의 이중 재시작(release.sh, 러너 주석 범위 밖 항목)이 만드는 창은 2개 정도라 N 은 현실적으로 2~3, 초과분 2~3초다. 15:30 국내 뉴스 틱은 276 + 16 = 292초에 3초를 더해도 약 295초로 300초 미만이다(여유 8초). 이론상 상한은 그 틱의 호출 수(분당 잡 약 30개, 08:00 틱은 해외 분석 120 포함)지만 호출 수만큼 창이 열렸다 닫혀야 해서 정상 운영에서 성립하지 않는다. 예산이 모자라 더 오래 기다리게 되는 방향이 아니라 「조금 더 오래 허용」하는 방향이며, 재시도는 호출당 1회·curl 7 한정이라 이중 주문 위험 증가는 없다.
- [12:51] 수용 근거 요약: ① 초과분 N 초 미만에 N 은 창 개수로 제한 ② 8초 여유 안에서 실질 영향 없음 ③ 순찰 300초 초과 시 결과는 러너 재시작일 뿐 주문 중복·안전장치 우회와 무관 ④ 수정은 러너 본체와 10개 시험의 정적 대조(기준 ref 대조 diff)를 건드려 재순환 비용이 이득보다 큼. 선택 개선(비차단): `web_ready_wait` 가 이미 있는 `jrl_now_ms`(밀리초) 또는 `date +%s%3N` 으로 WEB_READY_WAITED 를 올림(ceil) 초로 계산하면 과소 계산이 사라지고(과대 계산 쪽으로만 치우침) 시험은 「1초 미만 성공 대기 반복이 예산을 15초 이내로 유지」를 추가하면 된다. 다음 번 러너를 건드릴 때 같이 처리하면 충분하다.
- [12:51] 같은 지적에 대한 LOW-2(15:30 틱 여유 8초) 연장: 이 틱에 잡이 늘거나 N 이 커지는 변경이 있으면 292초 계산을 다시 해야 한다.
- [12:51] (이전 판정 줄 — scope 표기 오류로 대체됨: pass, scope: scripts/cron-runner.sh, scripts/test-cron-runner-)
- [14:58] scope 정정(재검토): 커밋 훅은 `/` 로 끝나는 항목만 디렉토리로, 나머지는 정확한 파일로 해석한다. 12:51 판정 줄의 `scripts/test-cron-runner-` 는 어느 파일과도 맞지 않아 staged 시험 파일 11개가 범위 밖이 됐다. 내가 11개 파일의 staged diff(`git diff --cached`, 기준 d17f689)를 직접 다시 읽고 `bash -n` 을 전부 통과시켰다(전 시험 15개 구문 오류 0). 앞선 point 5 의 주장을 베끼지 않고 아래를 파일마다 확인했다. ① call-body·daily-bars-kr·daily-bars·holdings-premarket·job-run-log·news-peek·news-split·overseas-universe: 변경은 (a) T177_C1~C5·M1 상수와 `no_t177_call`·`no_t177`·`t177_targets` 도우미 추가(정확 줄 `grep -vxF` + 표지 블록 awk 만 제거), (b) 기존 비교 호출에 `no_t177`/`no_t177_call` 을 파이프로 덧붙임, (c) 「이 줄들이 파일 전체 각 1개·call() 줄은 call() 안·표지 1쌍」을 못 박는 `t177_targets` 단언 추가(기대값 `1 1 1 1 1 1 | 1 1 1 1 1 | 1 1`), (d) curl 스텁에 `/api/health` 를 200 으로 즉답하는 한 줄 추가뿐이다. 기존 기대값·단언·기준 ref sha256 대조는 한 글자도 완화되지 않았고 비교 범위는 T-177 표지 줄에서만 좁아졌다. ② job-run-log 는 추가로 `no_t177_log`(로그 한 줄 `[cron-runner] 웹 응답 확인 — 0초 대기(http://stub/api/health)` 정확 일치 제거)를 `nokfout` 와 J12 새 러너 쪽에만 걸었다(기준 쪽은 그대로) — 다른 문구·대기 초는 지워지지 않아 비교가 깨져 드러난다. ③ pmo-retry·stop-alert: 스텁에 health 즉답 3줄만 추가, 단언 변경 0. ④ connect-retry(신규 337줄): 가짜 curl(PATH 스텁·셸 함수)·가짜 date/sleep, `BASE_URL=http://stub`, 임시 HOME·PROJECT_DIR, `CRON_SECRET=synthetic-secret`(합성값)만 쓰고 실제 운영 포트·.env·외부 주소 호출이 없다(파일 머리 주석과 grep 으로 확인). 재시도는 curl=7 에서만 1회, 그 외 종료 코드·성공 경로는 재시도하지 않음을 R1~R3 가 본다. 결함 없음. 전 시험 재실행은 하지 않았다(QA 14개 0 실패 보고를 근거로 둔다).
- [14:58] **최종 판정: PASS (scope: scripts/cron-runner.sh, scripts/test-cron-runner-call-body.sh, scripts/test-cron-runner-connect-retry.sh, scripts/test-cron-runner-daily-bars-kr.sh, scripts/test-cron-runner-daily-bars.sh, scripts/test-cron-runner-holdings-premarket.sh, scripts/test-cron-runner-job-run-log.sh, scripts/test-cron-runner-news-peek.sh, scripts/test-cron-runner-news-split.sh, scripts/test-cron-runner-overseas-universe.sh, scripts/test-cron-runner-pmo-retry.sh, scripts/test-cron-runner-stop-alert.sh)**

## Judge

- [2026-11-19 10:59] intake engine=jev → task_type=local_fix / risk=R2 / developer_model=opus / next=assign (roles: developer, reviewer, qa) / demo=none/- / complexity=1.11 | overrides=R2-kw-migration,MD-r2-opus | fallback=- | tokens=1327
- [2026-11-19 10:59] codex_gate/C1 engine=jev → codex_required=false / mode=- / focus=concurrency / budget_rule=CX-limit-unknown-r2 / codex_switch=on | overrides=- | fallback=- | tokens=855
- [2026-11-19 12:40] codex_gate/C2 engine=jev → codex_required=true / mode=adversarial-review / focus=concurrency / budget_rule=CX-limit-unknown-r2 / codex_switch=on | overrides=- | fallback=- | tokens=1143
- [2026-11-19 12:40] C2 후속: Codex 실행 필요 판정. 서버 Codex CLI 는 model_not_found(0.157.1)로 실패가 알려져 있어 이번 판정에서 Codex 는 실행하지 않았다. Leader 가 처리한다.

## QA
- [13:40] 실행 도구: claude(qa 서브에이전트). 서버 worktree `~/.node-local/stockinvest-t177`(base d17f689)에서 실행. 커밋·push·pm2·DB·`/api/cron/*`·KIS 호출·`.env` 수정 없음. 운영 3003 포트 요청 없음(시험은 스텁·임시 포트).
- [13:40] 재현 조건: 서버 우분투, node v24.22.2(`/usr/bin/node`). cron-runner 시험 14개는 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10 bash scripts/test-cron-runner-<이름>.sh`로 실행(두 묶음을 병렬로 던졌고 flock 으로 직렬화됨). 로그: 서버 `/tmp/qa-t177-125313/`, `/tmp/qa-t177-second/`.
- [13:40] 구문: `bash -n scripts/cron-runner.sh` 종료 0.
- [13:40] cron-runner 시험 14개 실행 결과(모두 종료 0, 실패 0):
  - alert-ticker 106 통과 / 0 실패 / 0 건너뜀
  - call-body 21 / 0
  - connect-retry (신규) 67 / 0
  - daily-bars 85 / 0
  - daily-bars-kr 73 / 0
  - holdings-premarket 56 / 0
  - job-run-log 214 / 0
  - news-peek 84 / 0
  - news-split 122 / 0
  - overseas-universe 32 / 0
  - pmo-retry 76 / 0
  - stop-alert 23 / 0
  - m40-forecast · m40-forward: 요약 줄이 없고 출력 줄이 모두 통과 표시, 실패 줄 없음(종료 0)
- [13:40] `scripts/test-git-hooks.sh`: 526 통과 / 0 실패, 로그 끝 「전체 검증 통과」(종료 코드는 별도로 기록하지 않음 — 로그 기준).
- [13:45] `npx tsc --noEmit`: 종료 0, 출력 없음. 첫 시도는 잘못된 npx 경로로 실행되지 않았고 `/usr/bin/npx --no-install` 로 다시 돌려 확인. 로그 `/tmp/qa-t177-second/tsc.log`.
- [13:45] 시나리오 점검(시험 출력과 러너 코드 줄 근거):
  - (a) 52·28·56 재시도 없음 — pass. 판정 첫 관문 `scripts/cron-runner.sh:591` `[ "$ce" = "7" ] || return 1`. 시험 connect-retry R3: curl 52·28·56 각각 POST 1번, 웹 확인 0번, 재시도 로그 0줄, 후크 1줄.
  - (b) 배포 재시작 시나리오 — pass. 시험 connect-retry R1: 첫 시도 7 → 웹 확인 → 재시도 200 성공(POST 2번), 후크 1줄(200, curl_exit 0), CALL_LAST_CODE=200, 실패 줄 없음. 러너 전체 시험 E3: holding-checker POST 2번, job_run_log 스풀에 최종 코드 200 한 줄, 다른 잡은 1번씩.
  - (c) 웹이 끝내 준비 안 됨 — pass. W3: 상한 60초에서 1 반환. R4: 첫 호출이 예산 15초를 쓰고 재시도 안 함, 같은 틱의 다음 호출은 기다리지 않고 즉시 실패(POST 1번씩). E2: 시작 대기는 60초에서 멈추고 첫 틱은 진행. E5: 틱당 대기 ≤ 16초.
  - (d) `/api/health` 확인에 시크릿·POST 없음 — pass. 시험 S 정적 단언, 그리고 `scripts/cron-runner.sh:547` 를 직접 읽음: `curl -s -o /dev/null --max-time "$mt" -w %{http_code} %{num_connects} "$BASE_URL/api/health"` (x-cron-secret 없음, -X POST 없음).
  - (e) 하트비트 쓰기 지점 불변 — pass. diff 에 삭제 줄 0(133줄 추가만). 하트비트 쓰기는 `scripts/cron-runner.sh:884` 와 `:1468` 두 곳뿐이고 둘 다 변경 전과 같다. 시험 S 가 「하트비트 쓰기 2곳」을 단언.
  - (f) pmo 재시도 횟수·CALL_MAX_TIME 동작 불변 — pass. `scripts/test-cron-runner-pmo-retry.sh` 76 / 0. `scripts/cron-runner.sh:210` `CALL_MAX_TIME=""` 그대로, `--max-time 120` 은 해외 post-market 호출에만 붙는다(pmo 시험 확인). diff 는 추가만이라 `PMO_MAX_ATTEMPTS`·`PMO_MIN_INTERVAL_SEC` 줄은 건드리지 않음.
- [13:50] 안전 경계(diff 직접 읽기): 변경 파일은 `scripts/cron-runner.sh`(추가만), 기존 cron-runner 시험 10개, 신규 시험 1개, `package.json`·`package-lock.json`(0.16.0 → 0.17.0), vault 로그·task 문서. `src/`·주문·안전장치(`src/lib/safety/`)·DB 스키마·`.env` 경로 변경 없음. 러너가 호출하는 `/api/cron/*` 경로 문자열도 바뀌지 않음.
- [13:50] git status: 수정 14개(위 파일 + `agent-vault/20-Log/2026-11-19.md`), 신규 2개(`scripts/test-cron-runner-connect-retry.sh`, T-177 task 문서). 추가로 `node_modules` 가 미추적 심볼릭 링크(`-> /home/brownjeon/.node-local/stockinvest-t175/node_modules`)이며 `git check-ignore` 로 무시되지 않음 — **커밋 때 스테이징 금지**(`git add -A`·`git add .` 를 쓰면 들어간다. 파일을 이름으로 지정할 것).
- [13:50] 시험 중 임시 task 파일 `T-984` ~ `T-998`(hooktest 이름)이 worktree 의 vault 에 생겼다가 `test-git-hooks.sh` 자체 정리로 사라짐. 현재 worktree 에는 없음 확인.
- [13:50] 결함: QA 단계 신규 결함 0건(Critical 0 · High 0 · Medium 0 · Low 0). Reviewer 의 LOW-1·LOW-2·LOW-3 및 Codex C2 의 low 1건은 Reviewer 가 수용·기록한 항목이며 QA 가 재현하지 않았다. LOW-2(15:30 틱 292초 대 300초, 여유 8초)는 그대로 남으니 이 틱에 잡을 늘리는 변경이 오면 재계산할 것.
- [13:50] 미검증(NOT_VERIFIED): 실제 pm2·웹 재시작 연쇄를 서버에서 재현하지 않았다(시험은 스텁·가짜 시계) — 운영 반영 뒤 배포 시각 로그로 실측 확인이 필요. shellcheck 는 서버에 없어 실행하지 않음. 운영 `/api/cron/*` 호출·KIS 실호출 없음.
- [13:50] 산출물 정리: 스크린샷·브라우저 산출물 없음(화면 변경 없음). 시험 로그는 서버 `/tmp/qa-t177-125313/`·`/tmp/qa-t177-second/` 에 남김 — 증거 보존용이며 프로젝트 안에는 두지 않음.
- [13:50] qa 판정: pass (범위: 위 시험·시나리오 a~f·안전 경계 확인 결과). 운영 배포 전 PR 검토와 main 반영 승인은 사용자 몫.

## Codex 검토
### [2026-11-19 12:44] C2 adversarial-review focus=concurrency — 실패(codex_exit_1: 모델 미지원 model_not_found)
- judge 판정: codex_gate/C2 (`codex_required=true` / `mode=adversarial-review` / `focus=concurrency` / `budget_rule=CX-limit-unknown-r2`, 판정 기록 2026-11-19 12:40) / 호출 차수: 1/4 (실행 시도 1회 계상)
- 대상: repo=scoped snapshot `/home/brownjeon/.node-local/t177-codex-scope.XhIoNR`(repo_source=arg, 허용 파일 13개만 포함한 축소 저장소 — 작업 트리 전체 아님) base=8d4c0f2(arg, d17f689 해당 파일 버전 기준) snapshot=fc88ef4
- 원인: 서버 `~/.codex/config.toml` 의 `model = "gpt-6.1-sol"` 을 Codex CLI 0.157.1(ChatGPT 계정)이 거부(`model_not_found`, HTTP 400). 검토 내용은 실행되지 않았다. 스냅샷 파일 수정 감지 없음.
- 지적: 없음(실행 안 됨 — 지적 0건은 「문제 없음」이 아니다)
- 검토하지 못한 범위: 전부(C2 Codex 검토 미수행). Reviewer PASS(critical 0·high 0·medium 0·low 3)·시험 결과만 근거로 남는다.
- 재실행: 자동 재시도하지 않음. 모델 설정 정정 뒤 사용자 결정으로 재실행(호출 차수 2/4부터).
- 원본: `/home/brownjeon/NFS/homes/brownjeon/project/.claude/state/codex-review/runs/20261119T034424Z-T-177-C2/raw.txt` (stderr.txt 동일 디렉터리)
- 2차 시도 [2026-11-19 12:45] (CLI 0.167.0 을 이 실행에만 `CODEX_BIN` 으로 지정 — 설정·래퍼·공용 파일 무변경): status=done, exit 0, 소요 271초, 호출 차수 2/4. 대상 동일(축소 스냅샷 `t177-codex-scope.XhIoNR`, base=8d4c0f2 arg, snapshot=c7bdea8, 파일 수정 감지 없음). 원본: `/home/brownjeon/NFS/homes/brownjeon/project/.claude/state/codex-review/runs/20261119T034522Z-T-177-C2/raw.txt`
- 지적 1건:
  - [low] `scripts/cron-runner.sh:601` — 웹 재시작이 겹쳐 같은 틱의 여러 호출에서 curl 7 뒤 준비 대기가 성공하는 경우. 대기마다 `date +%s` 정수 차이를 차감해 소수 초 오차가 누적된다(가상 시계 검증: 14.8초 대기 → 14초, 이후 0.8초 대기 두 번은 각 0초 계산, 누적 16.4초를 기다려도 예산 1초 남음). 영향: 틱당 15초 예산과 주석의 16초 상한을 넘을 수 있어 후속 잡 지연·하트비트 최악 계산 전제 깨짐. 권고: 밀리초 단위 누적 차감 또는 소수 초 잔여 보존, 같은 틱 1초 미만 성공 대기 반복 시험 추가.
- 검토 못 한 범위: 축소 스냅샷에 없는 배포 스크립트·워치독의 실제 재시작 유예·주기·쿨다운, 스냅샷 밖 stop-alert·주문 라우트의 서버 측 동시 실행 방어, 기존 시험 전체 실행과 실제 PM2·다중 러너 통합 재현.
- 요약: 격리 스텁 검증에서 curl 7 만 최대 1회 재시도, 52·28·56 은 재시도 없음, 최종 후크·CALL_LAST_CODE 1회 기록 확인. 새 중복 호출 경로는 확인 못 함. flock 은 비차단이고 경합한 티커는 그 회차를 건너뜀. 파일 변경·운영 호출 없음.
- 판정 줄 없음 (Codex 결과는 검토 기록일 뿐, 승인이 아님 — 채택·기각은 Reviewer 담당)



## 배포 기록

- 2026-11-19 미배포 — 작업 브랜치 `t177-cron-connect-retry`(커밋 `7feda13`) push, PR https://git.xn--lh0b87pnudm10a4vd.com/brownjeon/project_StockInvest/pulls/1 생성(base `main` = `d17f689`). main 머지 = webhook blue/green 운영 배포라 **사용자 소스검토·승인 뒤에만** 머지한다.

## 실행 도구·절차 이력

| event | 시각 | 종류 | 도구 / 절차 | 범위 | 근거 |
|---|---|---|---|---|---|
| E1 | 2026-11-19 10:1x | start | claude / claude_standard | 원인 확인·설계부터 구현·감사·QA·커밋·브랜치 push·PR 생성까지(main 반영 제외) | 사용자 「원인확인해서 수정작업 진행해줘 … 푸시전에 pr생성해서 소스검토」 |
| E2 | 2026-11-19 | handoff-wait | claude / claude_standard | 커밋·작업 브랜치 push·PR 생성 완료, main 반영은 사용자 대기 | 같은 지시(「푸시전에 pr생성해서 소스검토」) |

## 최종 요약

### [T-177] 배포 때 크론 잡이 「연결 실패·응답 없음」으로 기록되던 문제
- **상태**: 구현·Reviewer pass(낮음 3 + Codex 낮음 1 수용)·Codex C2 실행(0.167.0)·QA pass. 작업 브랜치 `t177-cron-connect-retry` push·PR 생성. **main 반영(=운영 배포) 전 사용자 소스검토·승인 대기.**
- **원인**: 11-19 홈 「데이터 이상·실행 실패 11건」은 같은 날 오전 배포 2회(release.sh 가 web·cron 을 배포마다 2번씩 재시작) 직후에 몰렸다. 새로 뜬 크론 러너가 웹 포트가 열리기 전에 첫 틱 호출을 쏴서 curl 7(연결 거부 → 「연결 실패」), 재시작에 끊긴 진행 중 요청이 curl 52(「응답 없음」).
- **무엇이 바뀌었나**: `scripts/cron-runner.sh` — ① 시작 시 웹 응답 확인 대기(최대 60초, `/api/health` 무인증 GET, 응답 코드나 TCP 연결이면 준비) ② `call()` 이 curl 7 일 때만 웹 준비를 확인한 뒤 1회 재시도(틱당 대기 예산 15초, 손절 알림 티커는 호출마다 15초). 52·28·56 은 재시도하지 않는다(요청이 서버에 닿았을 수 있어 이중 실행 위험). 기록(로그·job_run_log·CALL_LAST_CODE)은 최종 결과로 1회. 버전 0.16.0 → 0.17.0.
- **검증**: 러너 시험 14개 전부 실패 0(새 시험 67건 포함) · 훅 시험 526/0 · tsc 0 · 전체 jest 변경 전과 실패 이름 동일(새 실패 0) · 변이 시험으로 새 시험이 잘못된 재시도를 잡음 확인.
- **못 한 것**: 실제 pm2 재시작에서의 동작(배포 후 cron 로그로 확인) · shellcheck(서버 미설치).
- **남는 것(범위 밖)**: curl 52(재시작에 끊긴 요청)는 여전히 「응답 없음」으로 남을 수 있다 · release.sh 의 앱별 이중 재시작(전 프로젝트 공용) · 15:30 틱 여유 약 5~8초(잡 추가 시 재계산) · 예산을 초 단위로 세는 오차(밀리초 전환은 다음에 러너를 건드릴 때 선택 개선).
