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

## Reviewer

## QA

## Codex 검토

## 배포 기록

## 최종 요약
