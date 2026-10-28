---
task_id: T-117
title: 일봉 정기 증분 수집 크론 등록(R13) — 수동 호출만 하던 daily-bars 를 러너에 하루 1회 등록
status: doing
priority: high
project: StockInvest
created: 2026-10-28
updated: 2026-10-28
base_ref: faf8bc3
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa, codex, deployer]
related_tasks: [T-070-daily-bars-phase0, T-082-s02-daily-bars-universe-remaining, T-099-daily-bars-adjustment-false-positive, T-104-cron-jobs-market-grouping, T-114-corporate-intelligence-second-design]
tags:
  - type/task
  - domain/data
  - domain/cron
aliases:
  - 일봉정기수집
  - R13
waiting: []
---

# T-117 일봉 정기 증분 수집 크론 등록 (T-082 R13)

## 목표·배경 (Leader)

**한 문장**: 지금은 사람이 `curl` 로만 부르는 `POST /api/cron/daily-bars`(T-070, 증권사 읽기 GET → `daily_bars` upsert 만, 주문·시그널 없음)를 `scripts/cron-runner.sh` 에 **하루 1회 등록**해, 일봉 저장소가 사람 손 없이 매일 최신으로 유지되게 한다.

**왜 지금**: ① T-114 설계의 단계 3(판단 병행 비교)과 T-095 `signal-postmortem` 의 사후 결과(D+1·3·5·10)가 `daily_bars` 최신화에 의존한다(설계서 J9). ② T-082 가 10-27 에 "소비자 없음"을 이유로 R13 을 보류했는데, 사용자가 10-28 에 승인했다. ③ 10-27 실측(T-082 Leader 기록): 증분 1회 = 호출 약 96·소요 약 1.5분·`adj_stale` 0 — T-099 수정(`b5f5070`)으로 증분이 의도대로 동작함이 확인돼 있다.

**하지 않는 것**: 수집 본체(`src/lib/profit-engine/daily-bars-*`)·라우트(`src/app/api/cron/daily-bars/route.ts`)의 동작 변경, 대상 종목 정책 변경, 새 DDL, 새 외부 원천(Yahoo 교차검증 R15 등), T-104 스케줄 DB 화(이 task 의 러너 블록은 나중에 T-104 가 흡수한다), 주문·시그널·전략 코드.

## 사용자 지시·승인 (원문 보존 — 4D Diligence)

- 2026-10-28 22:5x(사용자 원문, 번호 목록 중 4번): "일봉 정기 수집(R13)의 경우 승인하니 크론 등록 후 처리진행되도록 해줘"
- **이 지시가 허용하는 것**: ① `cron-runner.sh` 에 `daily-bars` 호출 블록 추가·시험·배포 ② 그 블록이 부르는 **기존 수집 경로의 KIS 읽기 조회**(`POST /api/cron/daily-bars` 기본 대상 — 보유 → 최근 90일 시그널 종목, 오프아워 안, 증분 1일 1회) ③ 배포 후 첫 실행 관측.
- **허용하지 않는 것(별도 승인)**: 대상 종목 확대·유료 데이터·새 KIS TR(엔드포인트) 추가·하루 2회 이상 호출·`maxCalls` 상향·다른 크론 시각 변경·주문 경로.
- **지키는 선행 조건**: 킬스위치 ON·최근 3시간 주문 0건 확인 후 push / 배포는 배포 창(05:10~08:30 또는 15:40~22:20 KST) 안 / R2 라 Reviewer → Judge C2 → **Codex 필수** → QA 를 모두 통과한 뒤에만 커밋.

## 설계 (Leader — Developer 구현 사양)

1. **무엇을 부르나**: `call "/api/cron/daily-bars" "daily-bars"` 한 줄 — **본문 없이**(라우트 기본값: `symbols` 생략 → 보유 → 최근 90일 시그널 종목 ≤300, `years` 3, `maxCalls` 150). 본문을 새로 정하지 않는다(승인 범위가 기본 대상 증분이다). 라우트가 증분 판정·`up_to_date` 건너뛰기·단일 실행(single-flight)·예산(호출 `maxCalls`·100초)·오프아워 판정을 이미 한다.
2. **언제**: 매일 **07시대 40~54분 사이 첫 틱**(KST). 근거 — ① 미국 일봉은 ET 16:30 이후 확정 = KST 05:30(서머타임 중) / **06:30(2026-11-01 서머타임 종료 후)** — 07:40 은 양쪽에서 확정 이후 ② 라우트 오프아워 창 05:10~08:30, 매시 정각 앞뒤(분 3~55 밖)·07:55~08:10 은 라우트가 거부 ③ 07:00 틱(research-cycle-overseas·edgar-sync)과 07:20 이후 첫 틱(broker-fills) 뒤 ④ 08:00 해외 분석(post-market-overseas, 실패 시 08:10·08:20 재시도)과 겹치지 않음. 국내 봉은 전날 15:40 이후 확정이라 같은 호출이 함께 처리한다(하루 지연 허용). **다른 시각이 더 안전하다고 판단되면 근거를 적어 바꿔도 되지만 오프아워 창·정각 앞뒤·08:00 회피를 모두 만족해야 한다.**
3. **실패·건너뜀 처리**: 한 번만 호출한다(재시도 없음). 날짜파일은 호출했으면 성공·실패 무관하게 기록(T-036 규칙, 하루 1회). 라우트 응답 409(오프아워 밖·이미 실행 중)·503(유량·인증 중단)·200 은 **러너가 오류로 취급하지 않고 로그 한 줄**(HTTP 코드)만 남긴다 — 이 라우트는 알림을 보내지 않는다. 못 한 날은 다음 날 증분이 이어받는다(`daily_bars` 는 가산 upsert, 증분은 저장된 마지막 일자부터).
4. **틱·하트비트**: 라우트 최악 약 100초 + 같은 틱의 분 단위 잡 약 30초 + sleep 60 = 약 190초 < 300초 한도. 같은 틱에 **무거운 잡이 이미 돌았으면**(research-cycle-overseas·edgar-sync·broker-fills, 틱 시작에 읽어 둔 `LAST_*` 변수로 판단) broker-fills 와 같은 방식으로 `yield_tick`(날짜파일 안 씀)으로 다음 틱에 미룬다. 호출에는 curl 시간 상한을 붙인다(`CALL_MAX_TIME` 방식, 라우트 예산 100초 + 여유 → 약 120초).
5. **러너 가장자리**: 러너가 07:40~07:54 에 꺼져 있었으면 그날은 건너뛴다(로그로 남기고, 08:10 이후로 미루지 않는다 — 08:00 해외 분석 재시도와 겹치고 라우트가 08:10~08:27 사이만 허용). 이 가장자리를 주석과 시험에 명시한다.
6. **라벨**: 로그 라벨 `daily-bars`, 날짜파일 `~/.node-local/stockinvest/daily-bars-last-date`(다른 날짜파일과 같은 규칙으로 선언부에 추가). 블록은 `# >>> daily-bars-daily (T-117) … # <<<` 구분자로 감싸 시험이 잘라 쓸 수 있게 한다(broker-fills 선례).
7. **관측 가능성**: 가능하면 응답 본문의 요약(처리/호출/남은 수/중단 사유)을 한 줄 로그로 남기게 한다 — `call()` 이 지금 HTTP 코드만 남기면 `jq`(서버 1.6)로 안전하게 뽑는 한 줄을 이 블록에서만 더한다. 비밀(크론 비밀 헤더)은 로그에 절대 남기지 않는다.
8. **T-104 흡수**: 이 블록은 T-104 단계 1(잡 정의·스케줄 DB 화)이 시작되면 하드코딩 블록으로서 흡수된다(공동 인계서 J8). 블록 머리 주석에 그 사실을 적는다.
9. **시험**(필수): 새 러너 시험 `scripts/test-cron-runner-daily-bars.sh`(가짜 시각·가짜 curl 로 러너 전체를 돌리는 `test-cron-runner-news-peek.sh` 방식 — 거기서 잘라 쓸 부분을 먼저 읽을 것) — 07:40~07:54 에만 호출·그 밖의 시각 호출 0·하루 1회(날짜파일)·오류 응답(409/503/000)이어도 하루 1회·같은 틱에 research/edgar/broker-fills 가 돌았으면 yield·하트비트 간격 < 300초·**기존 모든 호출이 변경 전과 동일**(추가만). 기존 러너 시험 4개(news-split·news-peek·pmo-retry·stop-alert)와 `src/app/api/cron/broker-fills/__tests__/cron-runner-block.test.ts` 는 기대값을 약화하지 않고 통과해야 한다(새 호출이 기존 grep 에 섞이면 범위만 정교화하고 근거를 적는다).
10. **훅**: `scripts/cron-runner.sh` 는 `SAFETY_PATHS` 대상 — Reviewer 판정 줄의 scope 가 스테이징 파일을 덮어야 한다. 새 시험 스크립트는 `scripts/test-cron-runner-*` 로 훅 밖이지만 같은 Reviewer 가 본다.

## 배포·관측 계획 (Leader)

- **배포 시점**: 개발·감사 완료 뒤 **10-29 05:10~06:50 KST** 사이에 push(첫 실행이 같은 날 07:40 이후가 되게). 킬스위치 ON·최근 3시간 주문 0건 확인. 이 push 에 밀린 문서 커밋이 있으면 함께 나간다.
- **배포 후 확인(Deployer)**: `RELEASE_RESULT` ok·`migrated=false`, pm2 두 앱 online·`stockinvest-cron` 정확히 1개, `/api/health` 200, cron 로그 기동 예외 0.
- **첫 실행 관측(Leader, 10-29 07:40 이후, 읽기 전용)**: ① cron 로그 `daily-bars` 줄과 HTTP 200 ② `daily_bars` 최신 `trade_date`(미국 2026-10-28 확정 봉, 국내 10-28)와 `fetched_at` ③ 응답 요약의 `calls`(약 95 이하)·`remaining`·`aborted`(없어야 함)·`adjChange.mismatches`(`adj_stale` 0 유지) ④ `entry-watcher` 가 그 틱 전후 매분 정상(지연 없음) ⑤ 오프아워 거부(409)면 사유 기록 후 보고.
- **롤백**: 러너 블록 `git revert`(데이터는 가산 upsert 라 보존). 실행 중 문제면 날짜파일을 오늘 날짜로 써 그날 호출을 막는다(사용자 승인 사항 아님, 사실만 보고).

## 판단 기록 (judge)

- [2026-10-28 23:0x] intake engine=rules → risk=R2(`R2-kw-payment` — 키워드 과적합이나 러너 변경이라 R2 가 맞다) / developer_model=opus / next=assign | overrides=R2-kw-payment,MD-judge-failed-opus | fallback=budget_window_closed | tokens=0 | demo=none (판정 출력: scratchpad `judge-T-117-intake.out.json`)
- [23:0x] Leader: 판정과 별개로 R2 취급이 맞다(무인 실행 경로 `scripts/cron-runner.sh`·증권사 읽기 호출). override 없음. Codex 는 C2 에서 필수(R2).

## Developer

- [23:21] 구현 완료(격리 worktree `~/.node-local/stockinvest-t117`, base faf8bc3, 미커밋). 변경: `scripts/cron-runner.sh` +56/−0(머리 잡 목록 주석 4줄 · `DAILY_BARS_CURL_MAX_TIME=120`+근거 주석 · 날짜파일 `DAILY_BARS_LAST_RUN_FILE=~/.node-local/stockinvest/daily-bars-last-date` · broker-fills 블록 바로 뒤 `# >>> daily-bars-daily (T-117) … # <<<` 블록), 신규 `scripts/test-cron-runner-daily-bars.sh`(263줄), 기존 시험 2개 범위 정교화(`test-cron-runner-news-split.sh` +13/−8, `test-cron-runner-news-peek.sh` +6/−3).
- [23:21] 블록 동작: 07시·분 40~54·날짜파일≠오늘 → research·edgar·broker-fills 의 틱 시작 변수(LAST_RESEARCH_OVS·LAST_EDGAR·LAST_BROKER_FILLS) 중 하나라도 ≠오늘이면 yield_tick(날짜파일 안 씀), 아니면 `CALL_MAX_TIME=120` → `call "/api/cron/daily-bars" "daily-bars"`(본문 인자 없음 = call() 기본 `{}` → 라우트 기본 대상) → 상한 비움 → 날짜파일 무조건 기록. 07:55~23:59 첫 틱에 그날 못 불렀으면 `daily-bars skipped` 로그 1줄(프로세스 변수로 중복 방지, 날짜파일 안 씀). 재시도·응답 코드 분기 없음.
- [23:21] 시험(실제 실행): 새 시험 PASS=81 FAIL=0 · news-split 119/0 · news-peek 46/0 · pmo-retry 76/0 · stop-alert 22/0 · broker-fills 블록 jest 10/10 · `npx jest src/app/api/cron` 19 suites 337/337 · `npx tsc --noEmit -p .` exit 0 · `bash -n` ok · `bash scripts/test-git-hooks.sh` 410 통과/0 실패(stage 비어 있음 확인 후, 이후에도 비어 있음).
- [23:21] 하트비트 근거(시험 D5): 07:40 틱 최악(daily-bars 상한 120 + stop-alert 상한 20 + sleep 60) = 간격 200초 · 느린 재기동(research 100·edgar 100·broker 90·daily-bars 000/120) 최대 260초 = 같은 조건 변경 전 러너와 같음(07:00 틱 기존 값, daily-bars 는 다른 틱) · 000 이틀 시나리오 최대 180초. 모두 < 300.
- [23:21] 변이 시험(스크래치 사본, 원본 sha256 3e6469…fdd60 전후 동일): 시각 조건 삭제·상한(≤54) 삭제·HH 07→08·날짜파일 미기록·yield 삭제·broker-fills yield 누락·날짜파일 재읽기(N-2 함정)·200일 때만 날짜파일·상한 미해제·skip 로그 중복 방지 삭제 — 10개 전부 시험 실패로 잡힘(상한 미해제만 행동(D1 --max-time 목록)+정적, 나머지는 행동 시험이 잡음).
- [23:21] 기존 시험 정교화 근거: HEAD 판 news-split·news-peek 를 새 러너로 돌리면 정확히 9개 단언만 실패(변경 전 러너와의 "나머지 호출 동일"·--max-time 목록·정적 실행 줄 비교 — 새 잡이 섞이기 때문). daily-bars 호출·블록·`DAILY_BARS_*` 선언만 비교에서 빼고(단언 수 동일), "daily-bars 를 뺀 모든 호출 = faf8bc3 러너"는 새 시험 D1·D2·D6 가 증명한다. 뉴스 쪽 기대값은 그대로.
- [23:21] 사양과 다른 점/질문: ① 설계 7(응답 요약 jq 한 줄)은 **구현하지 않음** — call() 이 응답 본문 임시파일을 지우고 200 은 "OK"만 남겨, 블록 안에서만 요약을 남기려면 call() 수정(두 시험이 call() 본문 sha 를 변경 전과 대조) 또는 비밀 헤더를 다루는 별도 curl 이 필요하다. 설계 1(call 한 줄)을 지키는 쪽을 택했다. 대신 수집기가 앱 로그(pm2 `stockinvest`)에 `[daily-bars] done ok= targets= processed= calls=N/150 written= remaining= [aborted=] failed=` 한 줄을 이미 남기고, 비200 은 call() 이 본문 200자를 cron 로그에 남긴다. adjChange.mismatches 는 그 로그에 없어 첫 관측 ③은 DB(`adj_stale`)로 확인 필요. 요약이 cron 로그에 꼭 필요하면 Leader 결정 — 선택지: call() 에 선택적 `CALL_BODY_FILE`(비면 동작 불변) 추가 + 두 시험의 call() 대조 정교화. ② 상한 상수는 broker-fills 선례대로 `post-market-overseas-retry` 표지 구간 안(BROKER_FILLS_CURL_MAX_TIME 바로 아래)에 뒀다 — pmo 시험이 그 구간을 eval 하지만 영향 없음(76/0). ③ 07:55 이후 skip 로그 범위를 07:55~23:59 로 정했다(T-115 선례는 16~23시) — 07:40 전 배포가 아니면 배포 당일 한 줄 남는다(정상 정보).
- [23:21] 남은 위험: ① 라우트 이론상 최악(대상 조회 + 예산 100초 + 마지막 호출 줄서기 최대 30초·통신 10초 + upsert)이 120초를 넘을 수 있다 — 그때 cron 은 000(그날 끝), 서버 수집은 계속돼 저장됨(single-flight). ② 러너가 07:40~07:54 에 꺼져 있었거나 07:52 이후 재기동(미루기 틱 3개)이면 그날 건너뜀(시험 D3·D4 고정). ③ 서머타임 종료(11-01) 뒤 미국 확정 06:30 KST 도 07:40 보다 이르다 — 러너는 KST 고정이라 영향 없음(라우트 시각 판정은 미검증, 범위 밖). ④ 매일(주말 포함) 호출 — up_to_date 면 KIS 호출 0 예상[가능성 높음, 실측 아님]. ⑤ 이 서버 ko_KR.UTF-8 에서 grep 이 한글 뒤 `.*` 를 못 맞춘 사례를 시험 작성 중 실측 — 새 시험은 고정 문자열로 회피(러너 동작과 무관).
- [23:21] Reviewer scope 후보: `scripts/cron-runner.sh`(SAFETY_PATHS 대상), `scripts/test-cron-runner-daily-bars.sh`, `scripts/test-cron-runner-news-split.sh`, `scripts/test-cron-runner-news-peek.sh`. 재현: worktree 에서 `bash scripts/test-cron-runner-daily-bars.sh`(약 3.5분), 변이 사본 생성은 `T117_RUNNER=<사본> bash scripts/test-cron-runner-daily-bars.sh`.
- [05:10] Reviewer H-1 수정: `src/lib/profit-engine/__tests__/isolation.test.ts` +46/−3. T-070 의 "cron-runner 에 등록하지 않는다"(`not.toMatch(/daily-bars|daily_bars/)`)를 삭제·완화하지 않고, 사용자 승인(R13) 아래 **등록 방식을 고정하는 긍정 단언 4개**(describe `(T-117) cron-runner 등록 방식 고정`)로 바꿨다: ① 블록 표지 각 1개·순서 ② 블록 밖 실행 줄(주석·줄 끝 주석 제외)의 daily-bars 참조 = 선언 2줄(`DAILY_BARS_CURL_MAX_TIME=120`, 날짜파일)뿐 ③ 파일 전체 실행 호출 줄 = 정확히 `call "/api/cron/daily-bars" "daily-bars"` 1개, 블록에 symbols·years·maxCalls 없음 ④ `CALL_MAX_TIME` 은 호출 바로 앞 설정·바로 뒤 해제, 블록 안 2줄뿐. 머리 주석 4번도 "T-117 로 사용자 승인 하에 등록됨 — 아래 단언이 등록 방식을 고정한다"로 정정(원래 규칙 문구 보존). 이전 보고에서 jest 를 `src/app/api/cron` 으로만 돌려 이 가드를 놓쳤다.
- [05:10] 시험(flock+nice, maxWorkers=3): `npx jest src/lib/profit-engine` 14 suites 547/547 · `npx tsc --noEmit -p .` exit 0. 변이(스크래치 사본 3벌, 같은 jest·`-t T-117`): 원본 사본 4/4 통과 · 호출에 `'{"symbols":["X"]}'` 인자 → ③ 실패 · 호출 줄 하나 더 → ③④ 실패. 러너·러너 시험 5개 sha256 전후 동일(cron-runner.sh 3e6469…fdd60). Reviewer scope 후보에 `src/lib/profit-engine/__tests__/isolation.test.ts` 추가.

## Reviewer

- [05:05] 감사 범위·방법: worktree `~/.node-local/stockinvest-t117`(base faf8bc3, 미커밋)의 변경 4파일 전체 diff 정독 + 직접 실행. 실행 결과 대부분은 10-28 23:2x~23:5x 에 이 감사 세션에서 직접 돌린 것이고, 세션 중단 뒤 10-29 04:53 에 파일 동일성을 sha256 으로 재확인했다(러너 `3e646908…fdd60`·신규 시험 `afb9506a…`·news-peek `5fe7a0ef…`·news-split `005b41a1…` 모두 불변, `git status` 변경 4건 그대로). 04:5x 의 서버 과부하 지침 때문에 무거운 시험 재실행은 큐에서 취소했고(동일 바이트라 결과 유효), 가벼운 재확인(bash -n·isolation jest·diff 삽입/삭제)만 다시 했다. 운영 DB·운영 `/api/cron/*`·KIS·SEC·M4 호출 0, pm2 조작 0, 커밋 0, worktree 원본 수정 0.
- [05:05] 의도 검증: 변경은 "기존 라우트를 러너에 등록" 하나로 보인다. `src/` 변경 0(`git diff --numstat` 은 러너 +56/−0, 시험 2개, 신규 시험 1개뿐). 호출은 `call "/api/cron/daily-bars" "daily-bars"` 한 줄 — 본문 인자 없음 → `call()` 기본 `{}` → 라우트 `parseDailyBarsBody` 가 기본 대상(보유→최근 90일 시그널, years 3, maxCalls 150)으로 해석. 재시도·두 번째 호출·본문 인자·`maxCalls` 변경 없음(변이 시험 재시도·본문 추가가 잡힘). 사용자 승인 범위(기본 대상 증분 1일 1회) 안이다. 응답 코드 분기가 없으니 409/503/000 도 로그 한 줄로 끝난다(설계 3과 일치).
- [05:05] 러너 안전 ①~⑦ 판단: ① 조건 `HH=07 && 분 40~54 && 날짜파일≠오늘`, 호출했으면 성공·실패 무관 기록 — 시험 D1(07:40 1회, 밖 호출 0)·D2(409/503/000 × 이틀 각 1회) 통과. ② yield 는 `LAST_RESEARCH_OVS`·`LAST_EDGAR`·`LAST_BROKER_FILLS` 세 변수(각 블록이 호출 전에 읽은 값, daily-bars 블록은 broker-fills 블록 바로 뒤)로 판단 — N-2 함정(날짜파일 재읽기)을 피했고, 재읽기로 바꾼 변이는 시험 12개가 실패해 잡혔다. ③ `CALL_MAX_TIME` 은 호출 바로 앞에서 켜고 바로 뒤에서 비운다 — 다른 호출의 `--max-time` 목록은 변경 전과 동일(D1 대조). ④ 하트비트: 상수 120 + stop-alert 20 + 매 분 잡 "약 30" + sleep 60 = 약 230초 < 300초(앱 워치독 `CRON_HEARTBEAT_STALE_SEC` 기본 300 확인 `cron-watchdog.ts:90`). 단 시험 D5 는 스텁이 즉시 응답해 "약 30초"를 실측하지 않는다 — T-062·T-087 에서 이어받은 가정이며 여유는 70초다[가능성 높음]. 느린 재기동 최대 260초는 변경 전 러너에서도 같다(D5 대조). ⑤ 라우트 `checkOffHoursWindow` 를 컴파일해 직접 평가: KST 07:40·07:54 ok, 07:55 는 `avoid_0800_job` 거부 — 블록 시각과 모순 없음. ⑥ 서머타임 종료(11-01) 전후: 10-29 07:40 은 US 마지막 확정 일자 10-28, 11-03 07:40 은 11-02(둘 다 확정 봉)로 계산돼 07:40 은 양쪽에서 확정 이후다. ⑦ 07:40~07:54 에 꺼져 있던 날은 건너뜀 + 로그 1줄, 날짜파일 미기록(D3·D4) — 설계 5와 일치. 코드상 결함은 찾지 못했다.
- [05:05] 기존 동작 불변: 직접 `diff <(git show HEAD:scripts/cron-runner.sh) scripts/cron-runner.sh` — 삭제 줄 0, 삽입 hunk 4개(33a34,37 / 90a95,100 / 170a181 / 309a321,365), 파일 모드 100755 유지, `call()` 본문 불변, 실행 `call ` 줄 21→22(daily-bars 하나). `git diff --check` 깨끗, `bash -n` ok. 기존 시험 정교화: HEAD 판 news-split·news-peek 를 새 러너로 직접 돌리면 news-split 6개(D 뉴스 외 호출·`--max-time` 목록·뉴스 밖 실행 줄, F6 2개, F7)와 news-peek 3개(P1·P2·P6) = 정확히 9개가 실패한다 — 전부 "변경 전 러너와 같은가" 비교 계열이고 새 호출이 섞여 생긴 실패다. 정교화본은 daily-bars 호출·블록·`DAILY_BARS_*` 선언만 비교에서 빼며 단언 수는 그대로(119·46), 뉴스 기대값은 그대로라 약화로 보지 않는다.
- [05:05] 시험 품질: 새 시험은 진짜 러너 전체를 가짜 date·sleep·curl 스텁으로 1440틱까지 돌린다(변경 전 러너 faf8bc3 와 같은 하네스 비교 포함). 직접 실행 `bash scripts/test-cron-runner-daily-bars.sh` 통과 81·실패 0(Developer 보고와 일치). 갱신된 news-split 119/0·news-peek 46/0·pmo-retry 76/0·stop-alert 22/0. 변이 5개를 스크래치 사본에서 직접 재현해 전부 잡힘: 날짜파일 재읽기 12실패, 실패 시 재호출(재시도) 17실패, 호출에 본문 추가 4실패, yield 틱에 날짜파일 기록 8실패, 시각 상한 54→59 5실패. 원본 sha256 전후 동일. `npx tsc --noEmit -p .` exit 0. 전체 jest 직접 실행: 8425 통과·1 실패 — 실패 1건이 아래 H-1 이다(Developer 의 jest 보고는 `src/app/api/cron` 범위뿐이라 이 실패가 보이지 않았다).
- [05:05] 지적 H-1 (HIGH, 시험·가드 정합): `src/lib/profit-engine/__tests__/isolation.test.ts:227-230` 의 "cron-runner 에 등록하지 않는다" 가 `expect(runner).not.toMatch(/daily-bars|daily_bars/)` 이라 새 러너에서 반드시 빨갛게 된다(직접 실행: `Tests: 1 failed, 54 passed`, 229행). 이 파일은 T-070 경계 시험이자 커밋 훅 `SAFETY_PATHS` 대상(`^src/lib/profit-engine/__tests__/isolation\.test\.ts$`)이다. 지금 상태로 커밋하면 main 에 빨간 경계 시험이 남고, "시험 전부 통과" 라는 Reviewer·QA 판단 근거가 깨진다. 단순 삭제·완화는 권하지 않는다 — 이 가드는 "러너가 수집기를 부르는 방식"을 지키는 유일한 자동 장치라서, 부정 단언을 긍정 단언으로 바꿔야 한다: 러너의 daily-bars 참조는 `daily-bars-daily` 블록 안에만 있고, 실행 호출 줄은 정확히 1개 `call "/api/cron/daily-bars" "daily-bars"`(본문 인자·symbols·years·maxCalls 없음), 호출 앞뒤에서만 `CALL_MAX_TIME` 설정·해제. 머리 주석 4번(7행)도 함께 고친다. 권고: Developer 가 isolation.test.ts 만 이렇게 수정 → Reviewer 재검증(변경 4파일 + isolation.test.ts) → 최종 scope 에 isolation.test.ts 포함.
- [05:05] 지적 M-1 (MEDIUM, 관측 가능성): 설계 7 미구현은 사양 이탈이지만 Leader 결정(call() 불변 우선)은 합당하다고 본다 — 이 라우트는 주문·시그널을 만들지 않는 데이터 계층이고, 수집기가 앱 pm2 로그에 `[daily-bars] done ok= targets= processed= calls=N/150 written= remaining= [aborted=] failed=` 한 줄을 이미 남기며 비200 은 `call()` 이 본문 200자를 cron 로그에 남긴다. 비밀: 블록에는 `CRON_SECRET`·`x-cron-secret`·curl 직접 호출이 없고(D6 정적 단언), `call()` 은 응답 본문만 로그에 남긴다 — 새 노출 경로 없음. 다만 **조용히 지나가는 실패 경로가 있다**: 라우트는 `aborted='consecutive_failures'` 를 HTTP 200 으로 돌려주고(`route.ts` status 식) `skipped:'tables_missing'` 도 200 이라, cron 로그에는 `daily-bars OK` 만 남고 알림은 없다. 앱 로그의 `ok=false … aborted=consecutive_failures` 나 DB 최신 `trade_date` 를 보지 않으면 며칠 낡은 일봉이 이어질 수 있다. 치명적이지는 않다(주문 경로 아님, 증분이 다음 날 이어받음). 권고: 첫 실행(10-29 07:40) 관측에 앱 로그 `done` 줄의 `ok=`·`aborted=` 확인을 넣고, 이후 며칠은 시장별 최신 `trade_date` ≥ 직전 확정 거래일인지 읽기 전용으로 점검하며, 신선도 알림은 T-104 후속 항목으로 남긴다.
- [05:05] 지적 L-1 (LOW, 주석 낡음): 라우트 `src/app/api/cron/daily-bars/route.ts:5` 와 `daily-bars-collector.ts:2` 의 "cron-runner 에 등록하지 않는다(정기 증분은 Phase 1)" 가 이제 사실이 아니다. 주석만의 후속(route.ts 는 `^src/app/api/cron/` 감시 대상이라 별도 scope 필요). L-2 (LOW): 날짜파일은 호출 뒤에 기록(프로젝트 규칙 T-036)하므로 호출 도중(최대 120초) 러너가 재시작되면 같은 날 두 번째 호출이 한 번 더 나갈 수 있다 — 라우트 single-flight·`maxCalls` 150·`up_to_date` 건너뛰기로 한정돼 있고 broker-fills·edgar 와 같은 선례이며, 배포 창(05:10~06:50)이 07:40 보다 앞이라 첫 실행에는 해당 없다. 단 허용 배포 창이 08:30 까지라 07:35~07:57 에 cron 재시작 배포를 하면 그날 일봉이 한 번 날아가거나 두 번 나갈 수 있으니 이 시간대 배포는 피한다. L-3 (LOW): 새 시험은 `git show faf8bc3` 에 의존한다(다른 러너 시험과 같은 방식, 해당 커밋이 없는 얕은 clone 에서는 시험 시작 시 명시 오류로 종료).
- [05:05] 미검증·남은 위험: ① "매 분 잡 약 30초"와 라우트 최악 120초 초과 여부는 실측하지 않았다(초과 시 curl 000, 서버 실행은 계속·저장은 가산 upsert). ② 라우트가 장시간 돌 때 entry-watcher 등과 KIS 한도를 나누는 영향은 보지 않았다 — 07:40 은 국내·미국 정규장 밖이고 라우트가 bulk 레인·오프아워 창을 스스로 지킨다는 코드 주석 수준의 확인뿐이다. ③ 휴일(미국 휴장일)에는 호출 1회가 헛돌 뿐이다(라우트 주석). ④ 운영 서버 실제 실행·로그·DB 는 보지 않았다(금지). ⑤ Codex 검토는 판정 기준에 따라 이 판정과 별도다.
- [05:06] **최종 판정: FAIL (scope: scripts/cron-runner.sh, scripts/test-cron-runner-daily-bars.sh, scripts/test-cron-runner-news-split.sh, scripts/test-cron-runner-news-peek.sh)** — 러너·시험 본체의 결함은 찾지 못했다. FAIL 로 기록하는 이유는 H-1 한 건뿐이다: 기준표상 high 1건은 조건부 구간이지만, 조건이 "다른 안전 경로 파일(isolation.test.ts) 수정"이라 조건부 통과 줄이 훅을 통과시키면 빨간 경계 시험이 커밋될 수 있어 막는다. H-1 수정 후 재검증은 diff 가 한 시험 파일이라 짧다(이 scope 에 isolation.test.ts 추가).

## QA

## Codex 검토

## 배포 기록

## 최종 요약
