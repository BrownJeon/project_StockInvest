---
task_id: T-118
title: 해외 peek 슬롯 확대 + 피드별 겹침 검사 + peek 재시도 단축 (T-116 후속, T-114 독립 검토 HIGH H1 대응)
status: doing
priority: high
project: StockInvest
created: 2026-10-28
updated: 2026-10-28
base_ref: 0761fec
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa, codex, deployer]
related_tasks: [T-116-news-first-seen-capture, T-114-corporate-intelligence-second-design, T-104-cron-jobs-market-grouping, T-117-daily-bars-cron-registration, T-119-holdings-premarket-check]
tags:
  - type/task
  - domain/data
  - domain/cron
aliases:
  - peek확대
waiting: []
---

# T-118 해외 peek 확대 (T-116 후속)

## 목표·배경 (Leader)

**한 문장**: T-116 이 배포한 해외 뉴스 peek(저장 없는 조회)를 하루 5슬롯(02·10·14·18·22시)에서 **하루 19슬롯**으로 늘리고, 피드별로 "직전 캡처와 이번 캡처의 발행시각이 이어지는가"를 검사해 상태에 남기며, peek 의 재시도·시간 상한을 줄여 M4 장애 때 러너 틱이 길어지지 않게 한다.

**왜**: T-114 독립 검토(Reviewer, 2026-10-28 23:0x) HIGH H1 — 설계서 자신의 규칙("간격 ≤ 가장 짧은 피드 창의 절반")을 배포된 4시간 간격이 어긴다. 실측: 한 번의 peek 가 돌려주는 기사의 발행 시간 폭이 MarketWatch(dowjones) 약 2.7~3.4시간(10건)·Yahoo 약 1.0~1.6시간(19~20건)이고 CNBC·Bloomberg 은 15~18시간(22:00 KST `ci_raw_item` 첫 캡처 80건 + Reviewer 23:01 직접 조회 일치). 4시간 간격에서는 두 피드 기사가 슬롯 사이에 밀려나 **최초 관측 증거가 영구히 사라진다**(되살릴 수 없음 — 설계서 §2.1). 호출당 약 2초·KB 쓰기 없음이라 슬롯을 늘리는 비용은 작다.

**하지 않는 것**: ingest(KB 적재) 횟수 변경(06:00 하루 1회 유지 — 4주 관찰 기준선), 국내 peek 변경(10:01·13시 유지 — 국내 피드 창 약 6.6시간), DDL(상태는 `system_config` JSON), 알림 추가(겹침 공백은 상태에 기록만, 알림 없음), `ci_raw_item` 스키마 변경, M4 변경.

## 사용자 지시·승인 (원문 보존 — 4D Diligence)

- 2026-10-28 22:5x~23:2x(사용자 원문): "1. T-114의 수집 주기를 기준으로 작업해주고 그에 따른 T-104 의 변화되는 부분에 대하여 현행화하여 잘못 적용되거나 충돌되는 일이 없도록 해줘 2. 결정사항에 대해서는 권고안대로 B로 진행해줘 작업 전에 기존의 겹쳐있는 작업들의 내역을 확인해서 통합해서 결정해야하는 사항있으면 미리 알려줘. 결정해버리고 쭉 진행하도록 해야해"
- 2026-10-28 23시대(사용자 원문, 정확한 시각 미기록): "모두 권고안으로 작업 진행해줘. 이후 작업은 사용자 승인여부 묻지 않고 작업 진행하고 완료 후 결과 정리해서 리포팅해줘."
- 위 "모두 권고안"의 대상은 Leader 가 제시한 결정 Q1~Q7(23시대 보고). 이 task 는 **Q1**: "해외 peek 를 T-118 로 확대하고 피드별 겹침 검사를 추가 — 예: 매시, 단 06·07·08·15·16시 제외(하루 19슬롯). peek 의 재시도는 1회·20초로 단축."
- **허용하는 것**: 러너 peek 블록의 슬롯 목록 확대·peek 호출의 시간 상한, `news-fetch` 라우트의 peek 처리(재시도·시간 상한·응답), `src/lib/corp-intel/` 의 겹침 검사·상태 필드 확장, 시험, 배포(배포 창 안, 킬스위치 ON·최근 3시간 주문 0건 확인), 배포 후 관측.
- **허용하지 않는 것**: ingest 요청 본문·건수·시각 변경, 새 DDL, 알림 추가, 다른 크론 시각 변경.

## 설계 (Leader — Developer 구현 사양)

1. **해외 슬롯**: KST 시(時) `00 01 02 03 04 05 09 10 11 12 13 14 17 18 19 20 21 22 23` (19개). 제외한 시 06(ingest)·07(research·edgar·broker-fills·daily-bars)·08(해외 분석)·15(국내 15:30 수집)·16(국내 분석)은 **러너의 무거운 잡이 도는 틱**이라 peek 를 얹지 않는다. 각 슬롯은 시(時)의 첫 틱, 슬롯마다 날짜파일 하루 1회(기존 T-116 규칙 그대로: 성공·실패 무관 기록, 같은 틱에 앞선 peek 가 돌았으면 다음 틱으로 미룸 — `PEEK_RAN_LABEL` 방식 유지). 국내 슬롯(10·13)은 그대로이며 해외 슬롯과 시가 겹치는 10·13시는 기존 양보 규칙으로 해외 먼저·국내는 다음 틱.
2. **peek 시간 상한**: 라우트의 peek 처리는 M4 호출을 **1회·20초**로 한다(지금은 ingest 와 같은 3회×60초 재시도라 최악 약 186초). 실패하면 `status: failed` 로 상태만 남기고 끝낸다(다음 슬롯이 1시간 뒤). 러너는 peek 호출에 `CALL_MAX_TIME`(약 40초)을 붙인다. ingest(06:00·15:30)의 재시도·60초 상한은 **바꾸지 않는다**. 목표: M4 장애 때 peek 틱 최악 약 40초 + 분 단위 잡 약 30초 + sleep 60 = 130초대(하트비트 300초 대비 여유).
3. **피드별 겹침 검사**: 캡처마다 응답 `items` 를 `feed_host` 별로 묶어 ① 이번 응답의 `oldest_published_at` ② 이 캡처 **전** `ci_raw_item` 의 같은 `feed_host` 최신 `published_at`(`MAX`) 을 비교한다. 이번 응답의 가장 오래된 기사가 직전 최신보다 **늦으면**(= 사이에 못 본 기사가 있을 수 있음) 그 피드를 `gap` 으로 표시. 첫 캡처(직전 값 없음)는 `bootstrap` 으로 표시하고 gap 으로 세지 않는다(첫 peek 80건은 전부 first_seen 22:00:44 인데 발행은 최대 18시간 전 — 지연 통계에서 구분). 비교용 `MAX` 조회는 소량 1회(피드 4개 이하)이며 캡처 4초 공유 마감 안에서 실행한다(마감을 넘기면 검사만 건너뛰고 `feeds` 에 `skipped` 표시 — 저장·기존 동작은 영향 없음).
4. **상태 모양**: `system_config.ci_capture_status:<market>` JSON 에 `feeds` 객체를 추가한다 — `{ "<feed_host>": { "oldestPub": "...", "newestPub": "...", "items": N, "gap": true|false|"bootstrap"|"skipped", "consecutiveGaps": N } }`. 기존 필드(`lastAt, mode, status, fetched, inserted, duplicates, rejected, consecutiveFailures`)는 유지(하위 호환). 상태 쓰기 실패·마감 초과는 기존처럼 조용히 건너뛴다. **알림은 만들지 않는다.** 크기는 피드 4개 × 약 150바이트 수준.
5. **무동작·경계**: 스위치(`ci_capture_enabled`) 꺼짐·테이블 없음에서는 지금처럼 M4 호출 0·DB 쓰기 0. 겹침 검사의 쓰기 대상은 기존과 같은 `system_config` `ci_capture_status:*` 키뿐이고 읽기 대상은 `ci_raw_item` 이다. T-106 `news_zero_streak:*`·`recordNewsOutcome`·`news-fetch:*` 알림은 peek 가 만지지 않는다(기존 시험 유지).
6. **시험**: ① `scripts/test-cron-runner-news-peek.sh` 를 새 슬롯표(해외 19·국내 2)로 갱신 — 슬롯당 하루 1회, 502/타임아웃이어도 하루 1회, 06·07·08·15·16시 틱에 peek 없음, 10·13시 양보, 하트비트 간격 최대 < 300초(특히 17시 `sync-stock-meta` 틱·03시 `export-llm-trainset` 틱과 겹칠 때), 기존 모든 호출이 변경 전과 동일 ② 라우트 시험 — peek 가 M4 를 1회만 부르고 20초 상한, 겹침 검사(정상 이어짐·gap·bootstrap·skipped·직전 값 조회 실패), ingest 경로와 T-106 기록 불변 ③ corp-intel 시험 — 상태 `feeds` 필드 형태, 하위 호환 필드, 경계 시험(`isolation.test.ts`)이 새 읽기/쓰기를 허용 목록 안에서만 하는지. 기존 러너 시험 4개(news-split·pmo-retry·stop-alert + 위 peek)와 훅 시험은 기대값을 약화하지 않고 통과해야 한다.
7. **T-104 흡수 표시**: 러너 peek 블록 머리 주석에 "T-104 단계 1 에서 잡 정의로 흡수" 와 새 슬롯 근거(T-114 H1, 피드 창 실측)를 적는다.

## 배포·관측 계획 (Leader)

- T-119 와 **한 묶음**으로 배포(같은 `cron-runner.sh` 를 건드리므로 Reviewer·Codex·QA 를 묶음 후보 상태에서 한 번 더 확인): 10-29 15:40~20:00 KST 창, 킬스위치 ON·최근 3시간 주문 0건 확인. 늦으면 10-30 05:10~06:50.
- 관측(읽기 전용): 다음 정시 슬롯 몇 개의 cron 로그(`news-peek-overseas-NN OK`)·`ci_raw_item` 신규 행·`ci_capture_status:overseas.feeds` 의 gap 표시(Yahoo·MarketWatch 가 1시간 간격에서 이어지는지)·`entry-watcher` 매분 정상. 공동 인계서 §10 대장에는 "판단 불변(기록 전용)"으로 배포 시각만 남긴다.
- 롤백: 러너 슬롯 목록을 이전 5개로 되돌리는 `git revert`(데이터 보존) 또는 스위치 `ci_capture_enabled` false.

## 판단 기록 (judge)

- [2026-10-28 23:3x] intake engine=rules → risk=R1 / developer_model=opus(`MD-judge-failed-opus`) / next=assign / demo=none | overrides=MD-judge-failed-opus | fallback=budget_window_closed | tokens=0 (판정 출력: scratchpad `judge-T-118-intake.out.json`)
- [23:3x] **Leader override: R1 → R2.** 근거: 변경 경로가 `scripts/cron-runner.sh`·`src/app/api/cron/news-fetch/`·`src/lib/corp-intel/`(모두 커밋 훅 `SAFETY_PATHS` 대상, 무인 실행). 판정 엔진의 R1 은 키워드 기반이라 실제 경로 위험을 못 봤다. R2 이므로 Reviewer → Judge C2 → **Codex 필수** → QA. developer 모델 opus 유지. 화면 없음(demo=none).

## Developer

- [05:10] 구현 완료(worktree `~/.node-local/stockinvest-t118`, base 0761fec, 미커밋). 10-28 23:49 서버 정지로 세션이 끊겨 10-29 04:53 재개 — 중단 전 시험 결과는 쓰지 않고 전부 다시 돈다(아래 시험 기록). 변경: `scripts/cron-runner.sh`(+42/−24 — peek 블록·머리 주석, 상단 잡 목록 주석 3줄만) · `src/app/api/cron/news-fetch/route.ts`(+27/−9) · `src/lib/corp-intel/{raw-capture.ts +22/−7, status.ts +66/−5}` · 신규 `src/lib/corp-intel/feed-check.ts`(191) · 시험: `scripts/test-cron-runner-news-peek.sh`(+148/−77, 새 슬롯표로 다시 씀) · `test-cron-runner-news-split.sh`(+9/−3) · `test-cron-runner-pmo-retry.sh`(+7/−4) · `route-capture.test.ts`(+90/−2) · 신규 `route-feed-check.test.ts`(163) · `corp-intel/__tests__/{isolation +24/−1, raw-capture +12/−1}` · 신규 `feed-check.test.ts`(321).
- [05:10] 설계 1 슬롯: 해외 = 매시, 단 06·07·08·15·16시 제외(19개) / 국내 10·13. 21개 목록을 나열하지 않고 **규칙으로** 썼다(`PEEK_SLOTS="overseas:$HH"` → `case 06|07|08|15|16) PEEK_SLOTS=""` → `case 10|13) += domestic:$HH`). 사양 문구("매시, 단 …제외")와 같고, 제외 규칙 한 줄을 지우면 시험이 바로 잡는다(목록+별도 가드 이중이면 가드 삭제가 시험에 안 잡힘). 날짜파일은 T-116 과 같은 이름 규칙(`news-peek-<시장>-<HH>-last-date`, 21개) — 배포 당일 이미 돈 T-116 슬롯은 다시 돌지 않는다(시험 P5). 양보(`PEEK_RAN_LABEL`)는 틱마다 초기화라 연속 시(時)에서도 의도대로: 10:59 첫 실행이면 국내 10시는 그날 건너뛰고 11시 해외는 정상(시험 P6).
- [05:10] 설계 2: route peek 는 `PEEK_MAX_ATTEMPTS=1`·`PEEK_REQUEST_TIMEOUT_MS=20_000`(모드별 규칙 함수 `fetchPolicy`), ingest 상수 3·60_000·3_000 은 줄 그대로. 러너는 peek 호출에만 `CALL_MAX_TIME=40`(블록 안 `PEEK_CURL_MAX_TIME`, 블록 밖 선언 없음). 라우트 최악 = 스위치 4 + M4 20 + 캡처 4 = 28초 < 40.
- [05:10] 설계 3·4 겹침 검사(`feed-check.ts`): 응답 항목을 검증한 같은 행(`prepareCaptureRows`)을 feed_host 로 묶고, `SELECT feed_host, MAX(published_at) … FROM ci_raw_item WHERE source_kind='rss' AND published_at >= (7일 전) AND first_seen_at < (이번 캡처 시각) AND feed_host IN (…) GROUP BY feed_host` 1회. 판정: 이번 oldest > 직전 newest → `true` / ≤ → `false` / 직전 없음 → `bootstrap` / 조회 실패·1초 초과·값 해석 불가·이번 응답에 발행시각 없음 → `skipped`. 연속 gap: true +1 · false·bootstrap 0 · skipped 유지. 상태 JSON 은 기존 8필드 그대로 + `feeds`. 알림 없음, 쓰기 대상 불변(`ci_capture_status:*`).
- [05:10] 사양 이탈·판단(Reviewer 확인 요청): ① **조회를 INSERT 와 나란히** 돌린다 — 사양은 "이 캡처 전" 값이라 저장 전 실행을 전제했지만, `first_seen_at < 이번 캡처 시각` 이 이번 캡처의 새 행만 정확히 빼므로(기존 행은 ODKU 가 first_seen_at 을 안 바꿈) 순서와 무관하게 같은 값이다. 이득: 조회가 느려도 저장(증거)이 시간을 뺏기지 않는다(시험: 스위치 3.5초 + 조회 지연이어도 저장 ok). 대가: 상태 기록은 조회(최대 1초)를 기다리므로 DB 가 느릴 때 상태만 `partial` 이 될 수 있다. ② feed_host 인덱스가 없어 7일 발행시각 하한(`idx_published` 범위)을 뒀다 — 7일 넘게 행이 없던 피드는 gap 이 아니라 bootstrap 으로 보인다(DDL 금지라 인덱스는 안 더함). ③ 응답을 못 받은 시도(fetch_failed·no_items)는 직전 `feeds` 를 그대로 옮긴다(연속 gap 수 보존) — 검사를 한 시도에서 응답에 없는 피드는 빠진다. ④ 피드 상한 8(이름순). ⑤ ingest 도 같은 검사를 한다(사양 "캡처마다") — 06:00 ingest 가 쌓은 행이 다음 peek 의 직전 값이 되는 것이 맞다(그 행도 first_seen_at 이 남은 실제 관측 증거, ci_raw_item 에 시장 열이 없고 feed_host 가 시장마다 다름).
- [05:10] 기존 시험 하네스 수정(기대값 약화 없음): news-split — curl 스텁이 `--max-time` 을 지키게(실제 curl 과 같음, ingest 는 상한 없어 불변), "뉴스 호출에 --max-time 없음" 2곳을 ingest 로 좁힘(05:58 시작 시나리오에 05시 해외 peek 가 끼기 때문). pmo-retry — 09시 해외 peek 가 `market=overseas` 필터에 걸려 시도 시각 단언 3곳을 post-market 경로로 좁히고 `pmo_mt` 에서 peek 상한 줄을 뺌(T-116 이 RT 시나리오에 한 것과 같은 방식). 예상 실패 1건: `broker-fills/__tests__/cron-runner-block.test.ts` '기존 줄 변경 0 — HEAD 대비 추가만' — T-103 선례와 같이 커밋 전엔 반드시 실패, 빠진 HEAD 줄 24줄은 전부 상단 잡 목록 주석 3줄 + peek 블록(376~399행) 안이다(`git diff -U0` 대조). 시험은 고치지 않았다.
- [05:13] **재기동 대비 인수인계** ① 구현: 설계 1~7 전부 완료(위 05:10 기록), 미완 구현 없음. 소스는 worktree(로컬 디스크)에 일관된 상태 — 변이 시험 중단 흔적 없음(소스 5개·러너 sha256 대조 일치, `*.mutbak`·`*.muttmp` 없음). ② **재기동 뒤 실제 통과를 확인한 시험**(10-29 04:53 재개 이후, flock 규칙 공지 전이라 락 없이 실행): `bash -n scripts/cron-runner.sh` ok · `npx tsc --noEmit -p .` exit 0 · `npx jest src/lib/corp-intel src/app/api/cron/news-fetch src/lib/rag` 14 스위트 526/526 통과 · `npx jest src/app/api/cron` 347 중 346 통과 + 예상 실패 1(cron-runner-block '추가만', 위 기록) · `bash scripts/test-git-hooks.sh` 410 통과/0 실패(04:55~04:57). **러너 시험 4개(news-peek·news-split·pmo-retry·stop-alert)·러너 변이 4건·jest 변이 14건·전체 jest 1회는 이번 재개 뒤 아직 끝까지 돈 적 없다 — 미검증**(04:5x 병렬 실행은 flock 공지로 내가 중단 → 결과 무효, 06:30 예약 직렬 실행도 05:12 에 중단 → 시작 전). 10-28 밤(서버 정지 전) 결과는 참고만: news-peek 78/3(실패 3건은 시험 자체의 sed 로케일 버그 — 이미 `LC_ALL=C` 로 고침), news-split 119/0, pmo-retry 76/0(수정 후), stop-alert 22/0, jest 변이 14건 전부 잡힘·복원 sha256 일치. ③ **재기동 뒤 순서**(전부 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10` 직렬, 한 번에 하나): `bash ~/.node-local/t118-work/chain.sh` 하나로 묶어 둠(로컬 디스크 — /tmp 는 재기동 때 지워짐) = 러너 시험 4개 → 러너 변이 R1 제외 규칙 삭제·R2 날짜파일 미기록·R3 양보 제거·R4 peek curl 상한 제거(각각 news-peek 시험이 FAIL 이어야 정상) → jest 변이 14건(`mut/jest-mut.py`, `--maxWorkers=3`, 원본 sha256 복원 확인) → 러너·소스 sha256 재대조 → 전체 jest 1회(`--maxWorkers=3`, NODE_OPTIONS 2048) → tsc. 결과는 `~/.node-local/t118-work/chain-result.txt`. 러너 변이 사본(`mut/R*.sh`)은 현재 러너에서 만든 것이라 러너를 다시 고치면 다시 만들어야 한다(`mut/runner-sha.txt` 로 확인). 예상 소요 약 1시간 30분(news-peek 1회 약 11분 × 5). ④ 변이 진행: 이번 재개 뒤 완료 0건(위 ②). ⑤ 남은 질문·위험: 05:10 기록의 ①~⑤ 판단(조회·저장 병렬, 7일 하한, 직전 feeds 이월, 피드 상한 8, ingest 도 검사) + 사양대로라도 06→09·14→17 이 3시간 공백이라 Yahoo(창 1.0~1.6시간)는 매일 09·17시에 gap 이 찍힐 것으로 예상([가능성 높음]) — 07·08·15·16시를 뺀 결정의 직접 결과이며 바꾸지 않았다. P7 정적 비교는 기준 ref 0761fec 대비라 T-117·T-119 와 합친 뒤에는 `T118_BASE_REF` 를 두 변경이 든 ref 로 줘야 통과한다("peek 를 뺀 호출 = 기준" 비교는 블록만 바꿔 끼우는 방식이라 합친 뒤에도 그대로 쓸 수 있다). 상단 잡 목록 주석 31~33행을 바꿨으므로 T-117·T-119 가 같은 주석 근처를 고치면 병합 충돌이 날 수 있다.

## Reviewer

## QA

## Codex 검토

## 배포 기록

## 최종 요약
