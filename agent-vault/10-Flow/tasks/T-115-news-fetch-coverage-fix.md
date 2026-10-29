---
task_id: T-115
title: 뉴스 수집 보정(단계 0b) — 국내 뉴스를 장 마감 직후(15:30)에 한 번 더, 시장별 건수 20→100
status: done
priority: high
project: StockInvest
created: 2026-10-28
updated: 2026-10-28
base_ref: 5d4fdd1
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa, codex, deployer]
related_tasks: [T-103-news-fetch-market-split, T-104-cron-jobs-market-grouping, T-105-news-rag-zero-hits, T-106-news-zero-streak-alert, T-114-corporate-intelligence-second-design]
external_tasks: ["home-m4-api task-008 (다중 피드)", "home-m4-api task-009 (기사 메타·peek, 병행)"]
tags:
  - type/task
  - domain/rag
  - domain/data-collection
aliases:
  - 뉴스수집보정
waiting: []
---

# T-115 뉴스 수집 보정 (단계 0b)

## 목표·배경 (Leader)

**한 문장**: 오늘 SK하이닉스 기사처럼 **장중에 나온 기사가 그날 16:00 분석 시점의 KB 에 들어 있게** 수집 시각과 건수를 고친다.

**상황 → 근거** (정본: [[T-105-news-rag-zero-hits]] 17:xx 기록·[2차 설계서 §7 단계 0](../../../docs/design/2026-10-28-corporate-intelligence-second-design.md)):
- 국내 뉴스는 06:00 한 번, 20건만 수집했다. 연합뉴스 경제 피드는 약 120건·약 6.6시간 창이라 20건은 가장 최근 약 50분이고, 06:00 수집은 장중 기사를 원천적으로 못 담는다.
- 저장해 둔 피드로 재현하면 15:30 에 최신 100건을 받을 때 11:04 하이닉스 기사는 59번째, 10:19 기사는 87번째로 창 안에 든다(87번째는 여유가 적다 → 낮 시간 캡처는 단계 1b 의 몫).
- 해외 4개 피드는 합계 80건(창 5.6~33시간)이라 limit 20 이면 피드당 5건뿐이다.
- M4 임베딩은 평균 0.07초(24회 실측)라 100건 순차 약 7초 — 앱 요청 제한 60초 안에 여유가 있다.

## 사용자 지시·승인 (원문 보존 — 4D Diligence)

- 2026-10-28 18:1x: "D2에 대해서 푸시진행해주고 **나머지는 권고안대로 진행해줘**." — 이 task 는 그 "나머지" 중 D1(2차 설계서 §10: 뉴스 수집 시각·건수 보정을 기업정보 통합과 분리해 먼저 진행, 권고 "예. 국내 15:30·건수 100")이다.
- **이 지시가 허용하는 것**: 권고안대로 구현·검증. 권고안에 `push`/배포 시각이 명시되지는 않았으나 StockInvest 는 사용자 선승인 관례(메모리 2026-08-13)가 있고 사용자가 같은 지시에서 D2 push 를 명시했다 → **배포는 배포 창(15:40~22:20 KST)·킬스위치 ON·최근 3시간 주문 0건을 확인한 뒤 진행**하되, 확인 중 이상이 있으면 멈추고 보고한다.
- **허용하지 않는 것**: 주문·안전장치·시그널 경로 변경, DDL, 설정 DB 쓰기, 분석 로직 변경.

## 설계 (Leader — Developer 구현 사양)

1. `src/app/api/cron/news-fetch/route.ts`: `NEWS_FETCH_LIMIT = 20` → **시장별 상수** `{ domestic: 100, overseas: 100 }` (M4 요청 상한 100). 요청 본문 `limit` 이 시장별 값을 쓴다. 나머지(`MAX_ATTEMPTS 3`·`REQUEST_TIMEOUT_MS 60초`·재시도 간격)는 **그대로**.
2. `scripts/cron-runner.sh`: 새 블록 `news-fetch-domestic-pm`(주석 구획 표지 `>>> / <<<` 를 기존 `news-fetch-split` 처럼 둔다):
   - 조건: `HH = 15` **그리고** 분 ≥ 30 **그리고** 오늘 아직 안 돌았음(`news-fetch-domestic-pm-last-date` 날짜파일, 호출했으면 성공·실패 무관 기록 — 기존 규칙과 같음).
   - 16:00 이후에는 호출하지 않는다(16:00 post-market-domestic 틱과 겹치지 않게). 러너가 15:30~15:59 내내 꺼져 있었으면 그날은 건너뛰고 로그 한 줄.
   - 호출: `/api/cron/news-fetch?market=domestic`, 잡 이름 `news-fetch-domestic-pm`.
   - **기존 06시 블록(해외→국내 yield_tick)·다른 모든 잡의 호출은 변경 전과 완전히 같아야 한다**(변경 전 러너와의 호출 목록 비교 시험이 이미 있다 — 새 잡만 차이로 허용).
   - 하트비트: 최악 186초(3×60+대기) + 매 분 잡 약 30초 + `sleep 60` = 약 276초 < 300초(순찰 재시작 기준). 같은 틱에 다른 무거운 블록이 없는지 확인한다(15시대에는 없음 — 06·07·08·16·17시 블록뿐).
   - 러너 헤더 주석의 잡 목록(상단 주석)에 새 잡을 적는다.
3. 시험: ① `src/app/api/cron/news-fetch/__tests__/route.test.ts` — 시장별 limit 이 요청 본문에 실림(국내 100·해외 100), 기존 시험 전부 통과 ② `scripts/test-cron-runner-news-split.sh` — 새 시나리오(15:29 에는 안 돎 · 15:30 에 하루 1회 · 502 실패여도 하루 1회 · 16:00 이후 늦게 시작하면 안 돎 · 다음 날 다시 1회 · 하트비트 < 300초), 기존 시나리오 A~E 는 "뉴스 외 호출이 변경 전과 같음"을 **새 잡을 제외하고** 유지 ③ T-106 시험(`src/lib/rag/__tests__/news-health*.test.ts` 등)이 그대로 통과.
4. **영향 확인 (T-106)**: 같은 KST 날짜의 두 번째 국내 수집은 "하루로 센다"(streak 늘리지 않음, 앞선 실행이 0 이고 지금 > 0 이면 초기화) — `news-health.ts` 규칙대로 동작함을 시험 또는 코드 읽기로 확인해 Developer 기록에 적는다. **코드 변경은 하지 않는다.**
5. 하지 않는 것: 낮 시간 `peek` 캡처(T-116 몫), `ci_*` 테이블, M4 변경, 점수 임계·질의 변경(T-105 후보 E), 크론 스케줄 설정 DB 화(T-104 몫 — 이 task 의 하드코딩 블록은 T-104 가 흡수한다).

## 관찰 기준선 영향 (공동 인계서 §10 대장)

국내 분석의 RAG 뉴스 입력이 0건에서 양수로 바뀔 수 있다(점수 임계 0.5 가 여전히 막으면 변화 없음 — T-105 후보 E 미결). 후보 선정은 일봉 패턴이라 불변, AI BUY/SKIP 은 달라질 수 있다. 배포 시각을 대장에 한 줄 추가한다.

## 보호 경로·절차

- 훅 감시 경로: `src/app/api/cron/news-fetch/route.ts`·`scripts/cron-runner.sh` → 커밋 전 `## Reviewer` 마지막 `최종 판정: PASS (scope: …)` 줄이 스테이징한 보호 파일을 모두 덮어야 한다. 커밋 메시지에는 이 task ID(T-115)만 인용.
- R2 → Codex 필수 후보(C2 judge 결과를 따른다).
- 작업 위치: 격리 worktree `~/.node-local/stockinvest-t115`(node_modules 는 시험용 심볼릭 링크 — 커밋되지 않음).

## 판단 기록 (judge)

- [2026-10-28 18:2x] intake engine=rules → risk=R2 / developer_model=opus / next=assign | overrides=R2-kw-payment,MD-judge-failed-opus | fallback=budget_window_closed | tokens=0 | demo=none/-
- [18:2x] Leader: 판정과 별개로도 R2 취급이 맞다(judge.md "프로젝트 맞춤" — `src/app/api/cron/**`·`scripts/cron-runner.sh` 는 무인 실행 경로). override 없음.
- [2026-10-28 19:0x] codex_gate/C2 engine=rules → codex_required=true / mode=review / focus=none / budget=CX-limit-unknown-r2 / codex_switch=on | overrides=CX-r2-post-review | fallback=budget_window_closed | tokens=0 | 한도값 null(stale)이라 R2 만 개입 가능 — 이 task 는 R2 → codex 호출(호출 1/4)
- [19:2x] **Leader 처리 결정 (4D Diligence — 누가 무엇을 결정했나)**: ① Reviewer LOW 3건(하트비트 여유가 '매 분 잡 30초' 가정에 의존 / M4 종일 장애 시 수집 실패 알림 하루 최대 2회 / 건너뜀 로그 23시 범위 시험 공백)은 **코드 변경 없이 수용**. 하트비트는 첫 실제 실행(10-29 15:30)의 소요를 로그로 확인한다. ② Codex 지적 1건(medium, `cron-runner.sh:360` 날짜파일을 호출 뒤에 써서 호출 도중 러너가 죽으면 같은 날 재호출) — **판정자는 Reviewer**였고 Reviewer 가 직접 재현(15:30 호출 직후 강제 종료 → 90초 뒤 재기동 시 15:31 에 정확히 1회 더 호출, 이후 없음)과 코드 확인으로 **'범위 밖'(수용)** 판정: 하루 1회 잡 12개가 전부 같은 패턴이고(호출 전 기록은 post-market-overseas 의 재시도 횟수 파일뿐), 호출 전 기록으로 바꾸면 반대 방향 실패(호출 도중 죽은 날 수집이 영영 재시도 안 됨 = T-115 목적 붕괴)가 생기며, 중복 피해는 멱등 호출 +1회(M4 포인트 ID=본문 해시, T-106 같은 날 규칙)다. **Leader 는 Reviewer 판정을 수용**하고 코드를 바꾸지 않는다. 후속 후보: 날짜파일 기록 시점 정책을 러너 전체에서 보려면 T-104 가 이 하드코딩 블록을 흡수할 때 다룬다. ③ QA 통과(결함 0). QA 가 NOT_VERIFIED 로 둔 것: 실 M4 에서 limit=100 응답 시간(Leader 가 임베딩 속도를 읽기 전용으로 실측: 24회 평균 0.07초 → 약 7초), 실 cron 기동·pm2 재시작·실제 15:30 수집(배포 후 확인).
- [19:2x] 보호 경로 커밋 준비: 메인 트리 대상 4개 파일을 격리 worktree 와 sha256 일치 확인 후 반영(모드 변경 없음). `## Reviewer` 마지막 `최종 판정` 줄 scope = route.ts·route.test.ts·cron-runner.sh·test-cron-runner-news-split.sh(스테이징 보호 파일 전부 덮음). 사용자 승인 근거: 2026-10-28 "…나머지는 권고안대로 진행해줘"(D1). 배포는 배포 창·킬스위치 ON·최근 3시간 주문 0건 확인 뒤.

## Developer

- [18:43] 구현 완료(격리 worktree `~/.node-local/stockinvest-t115`, base 5d4fdd1, 미커밋). 변경 4파일(`git diff --numstat`): `src/app/api/cron/news-fetch/route.ts` +14/−2 · `src/app/api/cron/news-fetch/__tests__/route.test.ts` +71/−3 · `scripts/cron-runner.sh` +34/−0(추가만) · `scripts/test-cron-runner-news-split.sh` +131/−6. node_modules 심볼릭 링크는 그대로(미추적).
- [18:43] 사양 1(route.ts): `NEWS_FETCH_LIMIT = 20` 삭제 → `const NEWS_FETCH_LIMITS: Readonly<Record<Market, number>> = { domestic: 100, overseas: 100 }`, 요청 본문 `limit: NEWS_FETCH_LIMITS[market]`. MAX_ATTEMPTS 3·REQUEST_TIMEOUT_MS 60초·RETRY_BACKOFF_MS 3초 불변. **export 하지 않았다** — Next App Router 는 route.ts 의 HTTP 메서드·설정(dynamic 등) 외 export 를 빌드 타입 검사에서 거부하므로(사양은 "export 해도 좋다"였으나 빌드 위험이 있어 택하지 않음), 시험은 요청 본문으로 값을 본다. 헤더 주석에 "건수·국내 두 번째 수집 (T-115)" 절 추가.
- [18:43] 사양 2(cron-runner.sh): `# <<< news-fetch-split` 바로 뒤에 `# >>> news-fetch-domestic-pm (T-115)` ~ `# <<< news-fetch-domestic-pm` 블록. 조건 `[ "$HH" = "15" ] && [ "$NFP_MM" -ge 30 ] && [ "$LAST_NEWS_DOM_PM" != "$TODAY" ]` → `call "/api/cron/news-fetch?market=domestic" "news-fetch-domestic-pm"` → 날짜파일 `news-fetch-domestic-pm-last-date` 기록(성공·실패 무관). 분은 broker-fills 와 같은 방식(`date '+%M'`, 읽을 수 없으면 00 → 이 틱 안 돎). 16~23시 첫 틱에 그날 날짜파일이 오늘이 아니면 `news-fetch-domestic-pm skipped …` 로그 한 줄(프로세스 변수 `NFP_SKIP_LOGGED` 로 하루 1줄, 날짜파일은 쓰지 않음 — 호출하지 않았으므로). 선언 `NEWS_FETCH_DOMESTIC_PM_LAST_RUN_FILE` 1줄, 상단 잡 목록 주석 3줄, 06시 블록 주석에 "(T-115) 건수는 시장별 100" 1줄 — 전부 **추가만**(기존 줄 수정 0, broker-fills 시험의 "HEAD 대비 추가만" 조건 유지). 06시 블록과 다른 모든 잡의 실행 줄은 그대로.
- [18:43] 사양 3 시험: ① route.test.ts — 기존 기대값 limit 20 두 곳을 100 으로 바꾸고 이유 주석(T-115), 새 describe "T-115 시장별 limit" 5건(국내 100·해외 100·미지정 두 시장 각자 값·재시도 3회 모두 100·정적: 옛 상수 없음/값/재시도·상한·대기 불변/라우트 export 는 POST·dynamic 뿐). ② test-cron-runner-news-split.sh — A~E 는 bf8450d 대비 "뉴스 외 호출 = 변경 전" 그대로 증명. 새 잡 때문에 바뀐 기대값 3곳에 이유 주석: D 하루 뉴스 목록에 "15:30 국내" 추가 · E strip 에서 새 블록도 제거 · E 호출 줄 개수는 06시 블록 안 2개 + 파일 전체 3개로 분리. 새 시나리오 F(T-103 러너 = `T115_BASE_REF` 기본 5d4fdd1 과 비교): F1 15:28~15:35 × 이틀 200/502 — 15:29 안 돎·15:30 하루 1회·502 여도 1회·다음 날 1회·06시 날짜파일 불변·새 잡을 뺀 모든 호출(뉴스 포함) = T-103 러너 / F2 16:00·16:30 늦은 시작 — 호출 0·건너뜀 로그 하루 1줄·날짜파일 안 씀 / F3 15:59 시작 1회 / F4 이미 돈 날 재기동 15:45~16:04 호출 0·로그 0, 날짜파일 어제면 15:45 1회 / F5 느린 M4(186초) 하트비트 최대 246초 < 300 / F6 하루 전체 1440틱 = T-103 러너 + 15:30 1건 / F7 정적(새 블록·선언·주석 밖 실행 줄 = T-103 러너, 조건 줄·표지·선언·헤더 목록). `run_loop` 에 선택 인자 SEED(날짜파일 미리 쓰기) 추가 — 기존 호출부 영향 없음.
- [18:43] 실행 결과(전부 worktree 에서 실제 실행): `npx jest src/app/api/cron/news-fetch src/lib/rag` → 10 스위트 234 통과(news-fetch 49 포함). `npx jest src/app/api/cron/broker-fills/__tests__/cron-runner-block.test.ts` → 10 통과. `npx jest src/lib/profit-engine/__tests__/isolation.test.ts`(러너 읽는 시험) 통과. `bash scripts/test-cron-runner-news-split.sh` → 통과 119 · 실패 0(약 5분). `bash scripts/test-cron-runner-pmo-retry.sh` → 통과 76 · 실패 0. `bash scripts/test-cron-runner-stop-alert.sh` → 통과 22 · 실패 0. `bash -n scripts/cron-runner.sh` ok. `npx tsc --noEmit -p .` exit 0(incremental, route.ts 포함 확인).
- [18:43] 변이 확인(시험이 실제로 잡는지, 임시 사본으로): route 국내 limit 100→20 → jest 5건 실패 / 러너 `-ge 30`→`-ge 29` → news-split 6건 실패 / 날짜파일 기록 삭제 → 15건 실패 / `NFP_SKIP_LOGGED` 기록 삭제 → 1건 실패 / 조건에 16시 허용 → 4건 실패. 원본은 복원 확인(diff 동일).
- [18:43] 사양 4(T-106 상호작용, 코드 변경 없음): `news-health.ts` `nextNewsZeroState` 의 `prev.lastDate === today` 분기 — 같은 KST 날짜 재실행은 streak 를 늘리지 않고, 앞선 관측 0·지금 > 0 이면 0 으로 초기화, 앞선 > 0·지금 0 이면 그대로, `lastCount` 는 최대값. 06:01 과 15:30 KST 는 `kstDateOf`(+9h)로 같은 날짜. 기존 시험 `news-health.test.ts` "같은 KST 날짜 재실행" 4건이 이 규칙을 덮고(06:00→07:00 등) 그대로 통과. 추가로 06:01/15:30 시각을 넣은 임시 시험 3건(streak 2→06:01 0 이면 3→15:30 40건이면 0→다음 날 06:01 0 이면 1 등)을 돌려 통과 확인 후 삭제(커밋 대상 아님). 알림: 임계 도달은 새 날 첫 관측(06:01)에서 생기고, 같은 날 15:30 0 은 streak 유지라 다시 판정되지만 20시간 스로틀이 막는다 — 하루 알림 횟수 불변 [가능성 높음, 코드 읽기]. 06:01 이 건너뛰어진 날엔 15:30 에 알림이 날 수 있다(그다음 날도 하루 1회 유지).
- [18:43] 남은 위험·가장자리: ① 러너가 15:59 에 시작하고 M4 가 느리면(186초) 호출이 16:02 에 끝나 그날 16시 잡(post-market-domestic·research-cycle-domestic)이 16:03 으로 밀린다 — 같은 틱에 겹치지는 않음(F5 시험이 고정). ② 배포 당일 15:40~15:59 에 러너가 재기동되면 첫 틱에 곧바로 국내 두 번째 수집을 부른다(날짜파일 없음 → 정상 동작). 16시 이후 배포면 그날은 "skipped" 로그 한 줄. ③ 주말·휴장일에도 매일 돈다(06시 뉴스와 같음, 사양에 요일 조건 없음). ④ 15:30 수집이 그날 국내 분석 RAG 에 실제로 들어가는지는 점수 임계 0.5(T-105 후보 E)에 달려 있어 이번 시험 범위 밖. ⑤ 운영 DB·M4·KIS·크론 라우트 호출 0, `.env` 미열람. 20-Log 한 줄은 Leader 지시(이 절만 append)에 따라 남기지 않았다.

## Reviewer

- [18:56] 감사 범위: 격리 worktree `~/.node-local/stockinvest-t115`(base 5d4fdd1, 미커밋) 변경 4파일 — `src/app/api/cron/news-fetch/route.ts`·`__tests__/route.test.ts`·`scripts/cron-runner.sh`·`scripts/test-cron-runner-news-split.sh`. 운영 DB·KIS·M4·cron 라우트 호출 0, `.env` 미열람, 코드 수정 0(시험 실행과 임시 변이 사본만 사용). 주문·safety·exchanges·시그널 경로는 diff 에 없음 [확실, `git diff --name-only` 4건].
- [18:56] 러너 새 블록 `news-fetch-domestic-pm` 코드 추적 [확실]: 조건 `HH=15 && NFP_MM>=30 && 날짜파일!=오늘`. 15:29 안 돎·15:30 호출·15:59 호출·16:00 비호출. 호출 뒤 날짜파일을 성공·실패 무관 기록. `NFP_MM` 은 읽지 못하면 `00` 으로 떨어져 그 틱은 돌지 않음(fail-closed), `08`/`09` 도 `[ -ge ]` 에서 8진수 오류 없이 처리됨을 실행으로 확인. 16~23시에는 호출 없이 날짜파일이 오늘이 아니고 `NFP_SKIP_LOGGED` 가 오늘이 아닐 때만 로그 한 줄(프로세스 변수라 러너 재기동 시 한 줄 더 가능 — 로그일 뿐, 날짜파일은 안 씀). 새 변수명(NFP_*·LAST_NEWS_DOM_PM·NEWS_FETCH_DOMESTIC_PM_*)은 기존 러너와 충돌 없음, 공유 전역 `CALL_LAST_CODE` 는 8시 블록이 호출 전에 다시 초기화해 영향 없음.
- [18:56] 기존 동작 불변 [확실]: `git diff --numstat` 러너 +34/−0(삭제 0줄, 06시 블록엔 주석 1줄만 추가). 러너 전체 HH 조건을 grep 해 15시대에 다른 하루 1회 블록이 없음을 확인(03·06·07·08·16·17시와 17:30 정확 일치뿐). `bash scripts/test-cron-runner-news-split.sh` 직접 실행: 통과 119·실패 0. 시험 로직을 읽어 D(하루 1440틱, 뉴스 외 호출=bf8450d 러너)·E(블록 밖 실행 줄 동일, call() 해시 동일)·F6/F7(새 잡을 뺀 모든 호출=5d4fdd1 러너, 블록 밖 실행 줄 한 글자 동일)이 실제 비교 단언임을 확인. 기존 단언 변경은 정당한 3곳뿐(D 하루 뉴스 목록에 15:30 추가, E strip 에 새 블록 포함, 호출 줄 개수를 06시 블록 2개+파일 전체 3개로 분리)이고 약화 아님.
- [18:56] 변이 확인(내가 임시 사본으로 독립 실행): `-ge 30`→`-ge 31` 은 6건 실패로 잡힘, 새 날짜파일 대신 06시 국내 날짜파일에 기록하도록 바꾸면 17건 실패로 잡힘. 단 16~23시 건너뜀 로그 범위에서 23을 빼는 변이는 잡히지 않음(통과 119) — 로그 한 줄에만 영향이라 LOW(시험 공백, 동작 영향 없음).
- [18:56] 하트비트 예산: 시계열상 하트비트는 틱 시작에 기록되므로 최악 나이 = 매 분 잡 + 라우트 + sleep 60. 라우트 상한은 3×60초+2×3초=186초(재시도·시도당 60초·대기 3초 불변을 diff 로 확인)이고 감시 기록은 4초 상한이라 이론 최악 약 276초 < 300초(순찰·인앱 워치독 기본 300초, `cron-watchdog.ts` 확인) [가능성 높음]. 시험 F5 의 '최대 246초'는 가짜 curl 이라 매 분 잡 약 30초가 0초인 측정값(186+60)이라 타당하되 실제 최악은 +30초 가정이며, 마진 약 24초는 06시 국내 뉴스(06:00→06:04 틱)와 같은 가정을 공유하므로 새 종류의 위험은 아님. M4 가 정상이면 1회 약 10초 안쪽.
- [18:56] 라우트 [확실]: `NEWS_FETCH_LIMITS[market]` 이 요청 본문 `limit` 에 시장별로 실림(국내 100·해외 100, 두 시장 미지정 호출도 시장마다 자기 값). M4 `NewsFetchRequest.limit` 은 `ge=1, le=100`(home-m4-api `app/routes/market_context.py` 직접 확인)이라 상한 이내. MAX_ATTEMPTS 3·REQUEST_TIMEOUT_MS 60_000·RETRY_BACKOFF_MS 3_000 은 diff 에 변경 없음. 상수를 export 하지 않은 이유(Next App Router 라우트 파일의 허용 export 제한)는 타당하고, 정적 시험이 export 목록을 POST·dynamic 으로 고정함.
- [18:56] T-106 상호작용 [확실, `news-health.ts` `nextNewsZeroState` 코드 읽기+jest]: 같은 KST 날짜(06:01 과 15:30)의 두 번째 국내 수집은 `prev.lastDate === today` 분기라 streak 를 늘리지 않음. 앞선 관측 0·지금 양수면 0 으로 초기화(오히려 06시 수집 실패가 오후에 복구되면 거짓 연속을 지움), 앞선 양수·지금 0(오후 수집 실패)이면 streak 유지·`lastCount` 최대값. 알림은 스로틀 20시간이라 06:01 에 이미 울렸다면 15:30 은 막히고(9.5시간), 06:01 이 없던 날은 15:30 에 울린 뒤 이후에도 하루 1회 유지. 단 앱 재시작으로 인메모리 스로틀이 비면 같은 날 재알림이 가능한데 이미 존재하던 성질임. 수집 실패 알림(`news-fetch:domestic:failed`, 기본 스로틀 30분)은 M4 가 하루 종일 죽어 있으면 하루 최대 2회(06:01·15:30)로 늘어남 — 정보성(LOW).
- [18:56] 시험 가치: route.test.ts 새 5건은 `bodies` 를 `toEqual` 로 실제 비교(국내·해외 각 100, 미지정 시 시장별, 재시도 3회 모두 100, 정적 상수 값·export 목록)하며 빈 단언 없음. 기존 기대값 20→100 변경 3줄은 사양(시장별 100)에 맞는 정당한 변경이고 약화 아님. 내가 실행: `npx jest src/app/api/cron/news-fetch src/lib/rag/__tests__/news-health src/app/api/cron/broker-fills/__tests__/cron-runner-block.test.ts` 4스위트 187건 통과, `us-data-routes`·`isolation`(러너를 읽는 시험) 63건 통과, `npx tsc --noEmit -p .` 오류 출력 0, `test-cron-runner-stop-alert.sh` 22·`test-cron-runner-pmo-retry.sh` 76 통과(실패 0).
- [18:56] 배포 관점 [확실/가능성 높음]: 변경은 ecosystem.config.js·배포 스크립트를 건드리지 않아 cron 앱 중복 기동 요소 없음(`pm2 list | grep stockinvest-cron` 1행 확인은 배포 절차의 몫). 날짜파일은 릴리스 밖 `$HOME/.node-local/stockinvest/` 라 배포로 사라지지 않음. 배포가 15:40~15:59 에 러너를 재기동하면 첫 틱에 즉시 1회 호출(정상), 16시 이후면 그날 건너뜀 로그 한 줄이고 첫 실제 실행은 다음 날 15:30. 호출이 진행 중일 때(15:30~15:33) 러너가 교체되면 날짜파일이 호출 뒤에 기록되므로 새 러너가 한 번 더 부를 수 있으나 M4 upsert 가 같은 기사를 덮어쓰는 구조라 무해 [가능성 높음]. 주말·휴일에도 매일 도는 것은 06시 수집과 같고, 최악 186초 동안 1분 잡이 늦춰지는 것도 장 마감 후 구간이라 영향이 작음. 시험 스크립트가 git 참조(5d4fdd1·bf8450d)에 의존하는 것은 개발용이며 환경변수로 덮어쓸 수 있음.
- [18:56] 보호 경로: 훅 SAFETY_PATHS 로 `^src/app/api/cron/`(route.ts·route.test.ts 둘 다)와 `^scripts/cron-runner\.sh$` 가 걸린다. `scripts/test-cron-runner-news-split.sh` 는 목록에 없지만 내가 읽고 실행해 scope 에 포함한다. scope 항목은 '/' 로 끝나지 않으면 파일 하나만 매치되므로 파일 경로 4개를 그대로 적는다.
- [18:56] 이슈 요약: critical 0·high 0·medium 0·low 3(하트비트 마진 가정 공유, 실패 알림 하루 최대 2회, 건너뜀 로그 시간대 시험 공백). QA 집중: 러너 `scripts/cron-runner.sh` 343~371행 새 블록(조건 360행)·157행 선언, `route.ts` 83·153행, 첫 실제 실행(10-29 15:30)의 cron-out.log `news-fetch-domestic-pm OK`·라우트 로그 `upserted=…`·`attempt=`·소요 시간·`news-fetch-domestic-pm-last-date` 파일·`pm2 list` 의 stockinvest-cron 1행.
- [18:56] **최종 판정: PASS (scope: src/app/api/cron/news-fetch/route.ts, src/app/api/cron/news-fetch/__tests__/route.test.ts, scripts/cron-runner.sh, scripts/test-cron-runner-news-split.sh)**
- [19:03] Codex 지적 1(medium, cron-runner.sh:360): **범위 밖** — 사실 서술은 맞다(내가 직접 재현, 아래 4번). 그러나 날짜파일을 호출 뒤에 쓰는 것은 러너의 하루 1회 잡 12개 전부의 기존 설계이고 사양 설계 2항이 "호출했으면 성공·실패 무관 기록 — 기존 규칙과 같음"을 명시했으므로 이번 변경이 새로 만든 결함이 아니다. 피해는 멱등 호출 +1회로 한정돼 심각도는 low 로 재평가한다. 수정 요구 없음 — 위 판정 줄(scope 4개 파일)은 그대로 유효하다. 근거 4줄 아래.
- [19:03] (1) 같은 패턴 [확실, 러너 전수 grep]: `call` 뒤에 `echo "$TODAY" > 날짜파일` 하는 블록이 sync-stock-meta(233행)·rs-update(240)·kis-fundamentals(261)·post-market-domestic(267)·research-cycle-overseas(274)·edgar-sync(283)·broker-fills(302)·research-cycle-domestic(311)·news-fetch-overseas(332)·news-fetch-domestic(339)·새 블록(362)·export-llm-trainset(390)이고, 호출 전에 쓰는 것은 post-market-overseas 의 reserve 하나뿐이다. T-036 주석(143~152행)이 바꾼 것은 '성공해야만 기록'(실패 지속 시 매 분 재호출 폭주, 누적 약 18,600건)을 '성공·실패 무관 기록'으로 한 것이지 기록 시점(전/후)이 아니다. 호출 전 기록으로 바꾸면 반대 방향 실패가 생긴다: 호출이 서버에 닿기 전·도중에 러너가 죽은 날은 오후 수집이 그날 영영 재시도되지 않아 16:00 분석에 장중 기사가 없고(T-115 의 목적이 그날 조용히 무너짐), 로그에도 호출 기록만 남는다. 중복 호출의 비용(2번)이 그보다 작다.
- [19:03] (2) 중복 호출 피해: ① M4 멱등 [확실]: `home-m4-api/app/kb.py::make_point_id` = sha256(text)[:32]→UUID 이고 `market_context._merge_round_robin` 결과 항목에 `id` 키가 없어 point id = 본문 해시, `upsert_items` 가 같은 id 를 덮어쓴다(payload 의 ingested_at 만 갱신되며 StockInvest `src` 에서 ingested_at 을 읽는 코드는 0건) — 기사 행이 두 배가 되지 않는다. ② T-106: 같은 KST 날짜 분기라 세 번째 호출도 streak 불변(위 T-106 줄). ③ 실패 알림: 같은 Next 프로세스면 `sendAlertThrottled` 기본 30분이 막는다. 러너 교체 원인이 배포라 Next 도 새로 떠 인메모리 스로틀이 비었고 그때 M4 도 실제로 죽어 있는 경우에만 critical 중복 1건이 가능하다(정보성). ④ 하트비트: 한 틱에 두 번 부르는 경로 없음 [확실] — 블록은 루프 한 바퀴에 `if` 하나(361행)이고 날짜파일을 틱 시작에 읽으며, 시험 F 에 '한 틱에 뉴스 호출 최대 1회' 단언이 있다. 재기동 뒤 첫 틱의 최악도 같은 약 276초(15:30~15:59 에 다른 하루 1회 블록 없음).
- [19:03] (3) reserve 와 비교: `pmo_reserve`(62~137행)는 '하루 최대 3회·간격 10분' 시도 횟수 파일이다. 비-200 이면 재시도하는 비싼 AI 분석 호출이 호출 도중 죽는 반복(크래시 루프)에서도 상한을 지키려는 것이 목적(65~69행 주석)이라, 재시도가 없고 호출이 싸고 멱등인 이 블록과 목적이 다르다. 호출 전 예약으로 바꾸는 최소 수정은 361·362행 순서 교체(1줄 이동)지만 위 반대 방향 실패를 들이고, 기록 실패 시 호출하지 않는 분기와 '호출 도중 러너 종료' 시험 시나리오를 새로 만들어야 하며, 러너(보호 경로) 수정이라 Developer → Reviewer(새 판정 줄) → Codex → QA 전체 재순환이 필요하다. 드문 +1 멱등 호출을 막는 이득에 비해 비용이 크다.
- [19:03] (4) 열리는 조건과 재현: 스크래치패드(`.../scratchpad/rev-midcall2`)에서 가짜 date·curl 로 15:30 호출 직후 러너를 강제 종료 → 날짜파일 없음·호출 1건. 90초 뒤 재기동 → 15:31 에 정확히 1회 더 호출하고 날짜파일 기록, 이후 틱은 호출 없음(총 2건, 상한 +1이며 반복 아님) [확실]. 실제로 호출 도중(보통 약 7~15초, M4 장애 시 최대 약 190초) 러너가 죽는 경우: ① 그 시간 안의 pm2 재시작·배포(웹훅 릴리스가 stockinvest-cron 을 교체; T-115 배포 계획 창 15:40~22:20 은 창 밖이고 `docs/deploy-order.md` 328행이 장중 임의 배포를 금지) ② OOM(cron 앱 128M 상한, bash+curl 이라 비현실적) ③ 하트비트 순찰 재시작 — 이 블록만으로는 불가(최악 약 276초 < 300초), Next 서버 자체가 멈춘 경우에만 생기며 그 경우는 모든 블록 공통이고 06시 블록 창(60분)이 이 블록 창(30분)보다 넓다 ④ 호스트·NFS 장애. 15:30~15:33 에 배포·재시작하지 않으면 사실상 발생하지 않는다 [가능성 높음, 확률의 정량은 추측].
- [19:03] 후속(선택, 이번 task 범위 밖): 날짜파일 기록 시점 정책을 러너 전체에서 다시 보고 싶다면 이 하드코딩 블록을 흡수하는 T-104(크론 그룹화)에서 다루도록 Leader 판단. 이번 task 는 코드 수정 없이 진행 가능하다.

## Codex 검토

### [2026-10-28 18:59] C2 review focus=none — done
- judge 판정: C2 `judge-result@2` (`codex_required: true`, 규칙 CX-r2-post-review, 예산 CX-limit-unknown-r2, 판정 파일 `/tmp/claude-1000/-home-brownjeon-NFS-homes-brownjeon-project/b8b8f031-34f7-4edc-8621-4a61edd4f906/scratchpad/judge-T-115-c2.out.json`) / 호출 차수: 1/4
- 대상: repo=/home/brownjeon/.node-local/stockinvest-t115 base=5d4fdd1(HEAD_fallback — base_ref 와 HEAD 가 같고 미커밋 작업 트리이므로 빠진 커밋 없음) snapshot=a33ac88
- 지적 1건: [medium] scripts/cron-runner.sh:360 — 15:30~15:59 호출이 서버에 전달된 뒤 날짜파일을 기록하기 전(362행) 러너가 종료·재시작되면 같은 날 다시 호출될 수 있음 → 하루 1회 수용 기준 위반 가능, M4 수집·내부 재시도·실패 알림 중복 가능 (권고: 호출 전 원자적 예약 기록 + 기록 실패 시 호출 안 함, post-market-overseas reserve 방식 참고, 이를 시험할 것)
- 검토하지 못한 범위: node_modules 심볼릭 링크 제외(인계 지시) · 상태 변경 시험과 PM2 재시작 시험 미실행(읽기 전용 제약) · 시간 경계·분 파싱 실패·06시 블록·limit 변경은 별도 오류 미발견
- 원본: /home/brownjeon/NFS/homes/brownjeon/project/.claude/state/codex-review/runs/20261028T095922Z-T-115-C2/raw.txt

## QA

- [19:04] 판정: ✅ 검증 통과(결함 0건, Critical 0건). 대상 격리 worktree `~/.node-local/stockinvest-t115`(base 5d4fdd1, 미커밋). 실행 근거는 아래 항목.
- [19:04] 변경 범위: `git diff --numstat` = cron-runner.sh +34/-0, route.ts +14/-2, route.test.ts +71/-3, test-cron-runner-news-split.sh +131/-6. 안전 경로(`src/lib/safety`·`src/app/api/orders`·`src/lib/exchanges`·`ecosystem.config.js`·`deploy.yml`·`.github`) diff 0건. 러너 삭제 0줄. 시험 스크립트의 삭제 6줄은 기존 기대값 갱신(D 시나리오 등)이며 러너 동작 줄은 아님.
- [19:04] 실행 — jest `src/app/api/cron/news-fetch src/lib/rag`: 8 suites / 234 tests PASS. jest `cron-runner-block`·`us-data-routes`·`isolation`: 3 suites / 73 tests PASS(jest 종료 뒤 open-handle 경고 1건, 실패 아님).
- [19:04] 실행 — `bash -n scripts/cron-runner.sh`: OK. `npx tsc --noEmit -p .`: exit 0, 오류 0.
- [19:04] 실행 — `test-cron-runner-news-split.sh`: exit 0, PASS=119 FAIL=0. `test-cron-runner-pmo-retry.sh`: exit 0, PASS=76 FAIL=0. `test-cron-runner-stop-alert.sh`: exit 0, PASS=22 FAIL=0.
- [19:04] 시나리오 F(가짜 시계) 확인: 15:29 비호출 PASS(f-new-ok) · 15:30 하루 1회 PASS(F6 "새 잡 = 하루 15:30 1회") · 502 실패여도 같은 날 재호출 없음 PASS(fail(502) 로그 2줄) · 16:00 이후 시작 비호출 PASS(F2) · 하트비트 최대 246초 < 300초 PASS(F5·C).
- [19:04] 안전장치 체크(diff 근거, 주문 경로 무변경 → 해당 없음 = PASS): DRY_RUN PASS · KILL_SWITCH PASS · 주문 한도 PASS(`NEWS_FETCH_LIMITS` 는 M4 뉴스 요청 건수이며 주문 금액과 무관) · 심볼 화이트리스트 PASS(해당 없음) · 감사 로그 PASS(주문·trade_logs 경로 무변경).
- [19:04] 보안 점검: diff 추가줄에서 키·토큰·비밀번호·SQL 패턴 검색 0건. 새 SQL 없음. `.env` 값 출력 없음. PASS.
- [19:04] NOT_VERIFIED(미실행): 실 M4 에서 `limit=100` 응답 시간(추정 약 7초, 실측 없음) · cron 실제 기동·pm2 재기동 · 실 15:30 수집 · 15:30 호출 직후 날짜파일 기록 전 종료 경로(아래 Codex medium 지적, 시험 없음).
- [19:04] 잔여 위험(Codex C2 medium, 미수정): 15:30 호출 후 날짜파일 기록 전(cron-runner.sh 362행 부근) 러너가 죽으면 다음 기동 때 같은 날 재호출될 수 있다. 뉴스 중복 수집만 생기고 주문 경로와 무관하다. 수정 여부는 Leader 판단.
- [19:04] Deployer 인계 `post_deploy_checks`: (a) 배포 후 `pm2 list` 에서 `stockinvest-cron` 정확히 1개, 두 앱 재시작 횟수 불변 (b) `GET /api/health` 200 (c) cron 로그에 기동 직후 예외 없음 (d) 배포 시각이 16시 이후면 오늘 15:30 수집은 이미 지나 `news-fetch-domestic-pm skipped` 로그 한 줄이 정상, 첫 실제 실행은 내일 10-29 15:30 (e) 내일 15:30 이후 확인: `cron-out.log` 의 `news-fetch-domestic-pm OK`, 라우트 로그 `upserted=… fresh=… attempt=`, `$HOME/.node-local/stockinvest/news-fetch-domestic-pm-last-date`.
- [19:04] 산출물 정리: 임시 로그 4개(`/tmp/qa-artifacts/StockInvest/T-115/` 하위) 삭제 예정 — 아래 보고에 개수 기재.

## 배포 기록

| 시각(KST) | 릴리스 | 커밋 | 포함 작업 | 결과 | 비고 |
|---|---|---|---|---|---|
| 2026-10-28 19:07 (webhook, Leader push `0825250..a16bc0c`) | `20261028-190713-a16bc0cb` | `a16bc0c` | T-115(코드: 국내 15:30 추가 수집·시장별 100건), T-104·T-105·T-106·T-108·T-112·T-114·T-116(문서 전용) | `RELEASE_RESULT status=ok`, `migrated=false`, `previous=20261028-132733-08252507` | Deployer 는 배포를 실행하지 않고 webhook 배포 로그 판정·재확인만 함(이중 배포 없음). health 200, pm2 `stockinvest`·`stockinvest-cron` 각 1개 online, restarts 0. 오늘 15:30 수집은 지나서 `news-fetch-domestic-pm skipped` 1줄(정상). 첫 실제 수집은 10-29 15:30 |
- [2026-10-29 06:27] **첫 실제 06시 수집 검증(읽기 전용, 예약 점검)** — 정상. ① 앱 로그: 해외 06:00:24 start → 06:00:28 `OK upserted=78 attempt=1 fresh=77`(소요 약 4초, 이전 20 → 78) · 국내 06:01:31 start → 06:01:34 `OK upserted=100 attempt=1 fresh=100`(소요 약 3초, 이전 20 → **100**, 상한 도달) · 재시도·timeout·502 없음 ② M4 KB 새 메타: `news.kr_market` 최근 항목 20건 전부(ingested_at 06:01:31 KST) `source_url`·`guid`·`feed_host` 3/3, `news.us_market` 06:00 수집분 3/3 · **10-28 13:28 이전 수집분은 0/3**(task-009 18:46 배포 전 항목, 기대와 일치) ③ T-106: `news_zero_streak:fetch:domestic`(lastCount 100)·`fetch:overseas`(lastCount 77) 키 생성·streak 0, `news-health`/`alerted=` 경고 줄 없음. 부수 확인: T-116 ingest 캡처가 같은 수집에서 `ci_raw_item` 175행 신규(국내 100·해외 75, 중복 3), `ci_capture_status` 양쪽 ok. **확인하지 못한 것**: 오늘 15:30 국내 추가 수집(`news-fetch-domestic-pm`)의 첫 실제 실행(15:47 예약 점검)·16:00 분석에서 `news>0` 인지(16:12 예약 점검) — 분석 입력에 실제로 반영되는지는 그때 본다. 참고: 10-28 23:49~10-29 04:43 서버 정지는 이 06시 수집과 무관.
- [2026-10-29 15:48] **국내 15:30 추가 수집(`news-fetch-domestic-pm`) 첫 실제 실행 검증(읽기 전용, 예약 점검)** — 정상. ① cron-out.log 에 15:30:50 `news-fetch-domestic-pm OK` 1줄(skipped 없음), 앱 로그 15:30:45 start → 15:30:48 `domestic OK upserted=100 attempt=1 fresh=100` → 15:30:50 `done ok=true`(호출 약 3초, 틱 합계 약 5초, 재시도·timeout 없음) ② 날짜파일 `news-fetch-domestic-pm-last-date`=2026-10-29, 06시 국내 `news-fetch-domestic-last-date`=2026-10-29(서로 독립) ③ 하트비트: 15:30 틱 → 다음 틱 65초(15:30:45 → 15:31:50)로 250초 한참 아래, 검사 시점 하트비트 나이 3초, 워치독 재시작 흔적 없음. (참고 — T-115 와 무관한 기존 현상: 15:26:27 → 15:29:45 에 entry-watcher 줄 간격이 198초 벌어졌고 그 구간에 strategy-eval·signal-followup·trade-report 가 돌았다. 250초 미만이라 이상 아님 [가능성 높음].) **배포 영향**: 15:42:39 다른 세션의 T-121 push 가 배포되어(릴리스 `20261029-154239-99104fbe`, ok) `stockinvest`·`stockinvest-cron` 이 15:43 에 재기동됐다 — 15:30 수집은 그 이전이라 영향 없고 날짜파일이 오늘이라 재실행 없음. 재기동 직후 `[cron-runner] started` 줄이 15:43:05·15:43:06 두 번 찍혔으나 13:49:58·13:50:00 배포 때와 같은 패턴이고, 현재 러너 프로세스는 1개(etimes 284초)·이후 틱은 매분 1회라 중복 기동은 아니다. **확인하지 못한 것**: 16:00 국내 분석의 `[rag-retrieval] (domestic) … news=` 값과 분석 정상 완료 여부(16:05 이후 재확인 필요, 16:12 예약 점검 대상) — T-105 쪽에 기록.

## 최종 요약

### [T-115] 국내 뉴스를 장 마감 직후(15:30)에 한 번 더 수집 + 수집 건수 20→100

- **상태**: 완료·운영 반영됨(2026-10-28 19:07 KST). **첫 실제 동작은 내일 10-29**(06:00 건수 100 수집, 15:30 추가 수집).
- **무엇이 바뀌었나**: ① 국내 뉴스 수집이 기존 06:00에 더해 **매일 15:30~15:59 사이 한 번 더** 돈다 — 16:00 국내 분석 전에 그날 장중 기사(예: 오늘 11:04 SK하이닉스 배당 기사)가 지식베이스에 들어가게 하려는 것이다. 16:00 이후에는 부르지 않는다. ② 뉴스 수집 요청 건수가 시장별 20건에서 100건으로 올랐다(국내 피드는 하루 약 120건·약 6.6시간 분량이라 20건은 가장 최근 약 50분뿐이었다). 06시 수집과 다른 모든 잡의 호출은 변경 전과 같다. 주문·안전장치·시그널 코드는 바꾸지 않았다.
- **배포**: 커밋 `a16bc0c`, 2026-10-28 19:07 KST, push → webhook blue/green, `RELEASE_RESULT ok`(릴리스 `20261028-190713-a16bc0cb`, 마이그레이션 없음). 사용자 승인: "D2에 대해서 푸시진행해주고 나머지는 권고안대로 진행해줘"(D1). 같은 배포에 실린 다른 작업: 문서 전용 커밋 — T-104·T-105·T-106·T-108·T-114·T-116(설계서·사양·기록), 다른 세션 커밋 없음.
- **실매매 영향**: 없음. 주문·청산·승인 경로 미변경. 배포 후 실측: 킬스위치 ON·`dryRun=false` 유지, 최근 3시간 주문 0건, `stockinvest-cron` 정확히 1개·재시작 0회, `/api/health` db true·safetyStatus green.
- **AI 가 검증한 것**: Reviewer PASS(낮음 3건 수용) · Codex 지적 1건(날짜 파일을 호출 뒤에 써서 호출 도중 러너가 죽으면 같은 날 한 번 더 호출됨) → **Reviewer 가 '범위 밖(수용)'으로 판정**: 하루 1회 잡 12개가 모두 같은 패턴이고, 호출 전 기록으로 바꾸면 호출 도중 죽은 날의 수집이 영영 재시도되지 않아 이 작업의 목적이 무너지며, 중복 호출은 멱등(+1회) · QA 통과(러너 시험 119·pmo 76·stop-alert 22, jest 234·73, tsc 0) · Reviewer 가 구현을 일부러 어긴 변이로 시험이 잡는지 확인 · 임베딩 속도 실측(평균 0.07초 → 100건 약 7초, 앱 요청 제한 60초 안). **못 한 것**: 실제 M4 에서 100건 수집의 응답 시간(내일 06:00 로그로 확인), 실제 15:30 실행·pm2 재시작 중 동작.
- **👉 사용자가 확인할 것**: 없음(화면 변화 없음). AI 가 내일 확인한다 — **10-29(수) 06:00 이후**: cron 로그의 `news-fetch-overseas OK`·`news-fetch-domestic OK` 와 라우트 로그 `upserted=… fresh=…`(100 근처, 소요 시간 < 60초) / **15:30 이후**: `news-fetch-domestic-pm OK` 와 `$HOME/.node-local/stockinvest/news-fetch-domestic-pm-last-date` 값 = 오늘 날짜, 소요 시간(하트비트 여유가 약 24초뿐이라 이 값을 본다).
- **👉 사용자가 결정할 것**: 없음.
- **남은 일**: ① 내일 위 관찰 ② **효과는 보장되지 않는다** — 15:30 기사가 들어와도 국내 분석의 뉴스 검색은 점수 임계 0.5(T-105 후보 E)가 여전히 막을 수 있어, `news=0` 이 계속될 수 있다. 수집 보정은 "기사가 KB 에 있게 한 것"이지 "분석이 쓰게 한 것"이 아니다. ③ T-116(뉴스 최초 관측 증거 캡처)이 이어서 진행 중이다.
- **이슈·위험**: 하트비트 여유 약 24초(최악 276초 < 300초)는 '매 분 잡 약 30초' 가정에 의존한다(낮음). M4 가 하루 종일 장애면 국내 수집 실패 알림이 하루 최대 2회 나온다(낮음). 배포를 15:30~15:33 사이에 하면 러너 교체로 한 번 더 호출될 수 있다(멱등, 이번엔 해당 없음). 별도 발견: `docs/deploy-order.md` §1 선결 조건 표가 09-19 기준 '미해소' 6항목을 그대로 두고 있어 낡았다(실측은 정상) — 문서 갱신은 별도 판단.
