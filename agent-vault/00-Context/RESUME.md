---
project: StockInvest
updated: 2026-10-25
tags:
  - type/context
aliases:
  - 이어서 작업
  - RESUME
---

# ▶ 이어서 작업 — 재개 진입점

## 최신 — 2026-10-25 S00 완료(문서 범위) → 사용자 결정 대기 (T-079)

1. **S00 은 완료(문서 범위; 독립 검토 2회·QA 반영, 원장 §2 가 정본)다. 처음부터 다시 하지 말고 결과를 이어받는다.** [[T-079-s00-baseline-and-ledger]] → `docs/design/2026-10-24-s00-baseline-report.md`(현황·정책 대조·정책안 C01~C10·결정 목록)와 `docs/design/2026-10-24-execution-ledger.md`(단일 실행 원장 v1)를 읽는다. 진행 상태는 그 원장만 갱신한다.
2. **킬스위치가 10-23 22:42 에 자동 발동해 지금 ON 이다**(매수·매도 모두 차단). −12.1% 의 약 76% 는 환전 달러의 집계 누락이고 대칭 반영한 실제 변화는 약 −2.8% [가능성 높음]. 해제 후 주말 다음 첫 평일 저녁(16:30~다음날 06:30 경) 재발동 위험. 해제는 사용자 전용. 사용자 결정 D-1~D-5 가 다음 단계의 입구다.
3. 후속 task: [[T-080-killswitch-usd-misread]](선행 없음) · [[T-081-s01-ledger-cost-monthly-metric]] · [[T-082-s02-daily-bars-universe-remaining]] · [[T-083-s00-follow-up-hygiene]]. 이 문서들은 접수만 된 상태이며 착수 승인·권한(KIS 읽기·DDL·배포)은 각각 별도로 받는다.
4. **(10-25 11:00 갱신) 문서·T-040 은 커밋·push·배포 완료**(`e0aadad..34ab66d`, 릴리스 `20261025-105456-34ab66dd` ok). 이후 문서 변경(T-040/T-079/T-083 기록, board/RESUME)과 T-080 코드는 다음 커밋에 담는다 — push 는 재배포를 발화하므로 T-080 Reviewer PASS 후 한 번에. 루트 `NUL` 은 의도적으로 커밋하지 않음(삭제는 사용자 확인). `git add -A`·stash·reset·clean 금지.
5. **T-080 Phase 1 코드 완료**(커밋 `294f7e0`). 다음: ① 평일 저녁(16:40~06:30) KIS 읽기 조회 1회(예: 월요일 17:10) → USD 가림 원인 확정 → Phase 2(근본 수정 또는 모든 틱 대칭 보정, A07) ② 사용자의 킬스위치 해제 판단(남은 한계 2가지 숙지) ③ T-081(S01 장부·A06 국내 체결 조회 TR 불일치)·T-082(S02). 커밋 순서 주의: push 는 재배포를 발화.
6. **KIS 읽기 전용 조회(10-25)로 확정된 것**: 시스템 USD 행 = KIS 값, 미체결 0(#2107 은 앱 DB stale 행), 국내 2종목 매도 체결·실현손익 확인, **앱 국내 체결 조회 TR 불일치(A06)**. 평일 저녁(16:40~06:30) 재조회 1회가 USD 가림 원인 확정의 남은 한 칸. 상세는 S00 보고서 §2.8.

## (이전) 2026-10-24 통합 작업절차서 (T-078) — S00 은 위 항목으로 수행됨

1. [[2026-10-24-claude-restructure-handoff]] → `docs/design/2026-10-24-integrated-execution-procedure.md`를 읽는다. [[T-078-integrated-execution-procedure]]에서 T-064와 T-077을 하나의 절차서로 통합·독립 문서 재검토했다. 원본들은 상세 근거/이력이다.
2. ACTIVE·board·현재 작업 트리/관련 task를 대조하고 **S00 최신 현황/계좌·정책 대조와 단일 실행 원장**부터 작성한다. 옛 Phase0~4와 A0~A7을 따로 실행하지 않는다. 최신 사용자 결정을 옛 설계로 되돌리지 않는다.
3. S01~S09의 선행 조건과 **H 기존 보유 관리 / N 신규 매수 검증** 관문을 따른다. 문서 통합은 운영 DB/설정·주문·알림·커밋/push·배포 포괄 승인이 아니다.

> 아래의 10-21 및 9월 이전 인수인계/다음 할 일은 과거 기록이다. 현재 개편 작업의 시작 순서는 위 목록을 우선한다. 계좌·배포·검증 상태는 재확인하며 옛 숫자를 현재 사실로 쓰지 않는다.

> **2026-10-21 — 아래 절들은 낡았다(마지막 갱신 09-22). 최신 인수인계: [[HANDOFF-T-058-2026-10-21]]** (T-058 시그널 현금 게이트 — 설계 완료, 구현 대기). 프로젝트 전체 현황은 세션 메모리 `project_stockinvest.md` 와 [[board]] 가 더 최신이다.

> **2026-09-22 추가 — 착수 대기 2건(우선)**: [[T-038-llm-base-url-setting]] (hybrid 1단계 AI 필터가 죽은 M4 주소 호출 중 · 적용은 장 마감 후) · [[T-039-alert-dup-and-telegram-timeout]] (재배포 시 알림 중복 + 텔레그램 ETIMEDOUT 으로 승인 요청 유실). 두 task 파일에 사실 조사·해결 방향·주의·검증 체크리스트가 다 들어 있다.

> 사용자가 **"이어서 작업해줘"** 라고 하면 이 파일부터 읽고, 아래 "다음 할 일"의 1번부터 진행한다.
> 다른 PC에서 재개할 수 있으므로 **모든 맥락은 이 vault 안에 있다** (세션 메모리·플랜 파일에 의존하지 말 것).

---

## ✅ 2026-08-27 — [[T-037-cron-outage-impact-and-watchdog]] 완결: cron 2.5일 무성정지 사후조사 + 워치독 구현. **배포는 사용자 승인 대기 — 여기부터 재개**

`stockinvest-cron`이 2026-08-24 23:39~2026-08-27 10:51(2.5일) pm2 `online`인데 실제로는 죽어
있었다([[T-036-news-fetch-observability]] §5 부수 발견, 사용자가 이미 수동 재기동). 조사 결과
**실매매 피해 0건**(주문·체결·포지션 변화 없음, 걱정했던 "밀린 만료 시그널의 뒤늦은 오발주"는
`signal-expiry`가 애초에 주문을 안 내는 구조라 불가능). **원인 2단**: ①08-24 23:39 호스트 급사
(원인불명, OOM 아님) ②08-25 09:54 재부팅 시 pm2가 NFS 마운트보다 11초 먼저 떠 fork 모드
`stockinvest-cron`이 `spawn ENOENT`로 영구 유령화 — **08-22부터 재부팅마다 반복돼 온 구조적
결함**. Developer→Reviewer(PASS)→QA(✅ 검증 통과) 순환으로 상시 하트비트 워치독
(`scripts/cron-runner.sh` + `src/instrumentation.ts`/`src/lib/ops/cron-watchdog.ts`, 자금경로
완전 격리) 구현·검증까지 마쳤다.

**다음 할 일(사용자 결정 필요, task 파일 "최종 요약" 참조)**:
1. 워치독 코드 커밋 승인 여부(Reviewer PASS 기록 있어 훅 통과 가능한 상태, 아직 미커밋)
2. 배포(빌드 → `pm2 restart stockinvest-cron` 먼저 → `pm2 restart stockinvest` 순서) 여부·시점
3. HOME-SERVER 소관 근본원인 3건(pm2 서비스 유닛에 `RequiresMountsFor` 추가, `projects.json`
   `health_type` 스키마 확장, `check-and-recover.sh` 상시 순찰 전환) — diff 제안만 있음, 별도
   HOME-SERVER 세션 인계 권고
4. `scripts/.nfs*` 잔여파일 2개(08-19 생성, 이번 건과 무관) 정리 여부

---

## ✅ 2026-08-24 — 리서치분석 차트 목표가 옆 현재가 표기 완료(`382dac4`, [[T-034-chart-based-price-targets]] "Leader 후속" 절)

또한 T-035([[T-035-overseas-usd-display]], 해외 종목 금액 USD 표기)가 그 사이 완결·배포됐다
(`fa531d6`). **T-034 배포가 실제로는 webhook-deploy 프로세스 사망(pm2 online 오표시)으로
한동안 미반영이었다가 발견·복구된 사고가 있었다** — 상세는 T-034 task 파일 "배포 사고" 절.
**교훈: 배포 확인은 반드시 `webhook-deploy` 로그의 `START sha=<커밋>`→`END exit=0` 쌍으로
직접 할 것, pm2 status만으로 판단 금지.** 이번 배포는 이 방식으로 정상 확인됨.

## ✅ 2026-08-23 — [[T-034-chart-based-price-targets]] 배포 완료. 아래 08-19 절은 낡음(참고만)

**이 절 아래의 08-19~08-18 서술은 이 문서가 그 시점 이후 갱신되지 않아 낡아 있었다.** 실제로는
그 사이 T-032 후속 4건 + [[T-033-research-recommendation-trade-report]] + [[T-034-chart-based-price-targets]]가
전부 구현·검증·배포까지 완료됐다(git log 기준, ACTIVE.md·board.md도 이 세션에서 함께 갱신함).

**T-034**: T-033 배포 후 사용자가 실화면에서 발견한 "목표가가 진입가 기준이라 비현실적" 결함을
차트 지표(볼린저밴드/60일 고저·ATR14 도달가능성 게이트) 기반으로 재설계해 해소. Developer→Reviewer
PASS→QA PASS→Leader 실데이터 대조까지 완료 후 사용자 승인 받아 커밋 `eac1e83`. **배포 중
webhook-deploy가 push에 미발화**(아래 08-19 절의 동일 증상 2번째 재현) → 수동 배포
(`deploy-stockinvest.sh`)로 완료, 헬스체크 green, 안전장치 무영향. 상세는 task 파일 "배포" 절.

**다음 할 일**:
1. 🔴 **webhook-deploy 미발화 원인 조사** — 이번까지 2회 관측(08-19 `0481d55`, 08-23 `eac1e83`).
   매번 수동 배포로 우회는 가능하나 근본 원인 미상 — 재현 조건 파악 필요(패턴: 두 번 다 연속
   커밋들이 짧은 간격으로 여러 번 push된 세션의 마지막 push였을 가능성, 확인 안 됨).
2. 🔴 **[[T-031-news-fetch-m4-500]] — 이 프로젝트 범위 밖으로 핸드오프 필요.** M4 API
   `/v1/news/fetch` 500 에러 근본원인이 **home-m4-api 프로젝트(Mac Mini M4) 내부**에 있다 —
   다음에 이 항목을 다루려면 StockInvest가 아니라 **API서버(home-m4-api) 팀 세션**으로 전환할 것.
   매매 자체는 무영향(뉴스 KB 갱신만 중단).
3. (곁가지, 확인만 됨) **TradingInvest `.env`의 `AI_API_BASE`도 구IP·구포트**(`163:8000`) —
   같은 M4 연결 증상 가능성 있음, TradingInvest 팀 세션에서 확인 권고(이번 세션에서 미수정).
4. board.md Backlog의 QA 형식준수·잔여 Medium/Low 항목들 — 배포 비차단, 급하지 않음(08-18
   절 참조, 여전히 유효).

---

## ✅ 2026-08-19 — [[T-032-research-rally-cycle]] 완료. 배포 중 발견된 인프라 결함도 원인규명·해소

즐겨찾기 연동 사이클 패턴 리서치 기능(Developer 구현 → Reviewer PASS[Critical/High/Medium/Low 0건]
→ QA 부분검증 → Leader가 나머지 갭 직접 검증). 118 suites/2003 tests 통과, 커밋 `5c23d35`.

**배포 중 별개의 인프라 버그를 발견·해소했다**: `deploy-stockinvest.sh`의 `git clean -fdx`가
`scripts/` 아래 NFS silly-rename 잔재 파일 2개를 "device or resource busy"로 못 지워 배포 스크립트가
Sync 단계에서 즉시 중단되고 있었다(`set -eo pipefail`) — **08-18 14:07 배포(단순 `.env` IP 수정
커밋)부터 이미 실패 중이던 선재 문제**, T-032가 만든 게 아니다. 원인: **`stockinvest-cron` pm2
프로세스가 예전 `cron-runner.sh` 파일핸들을 계속 쥐고 있었다** —
`pm2 restart stockinvest-cron --update-env`로 해제하자 오래된 파일(6월 7일자)이 즉시 사라졌고,
남은 한 개(오늘자, T-032의 `cron-runner.sh` 편집으로 생긴 것)는 직접 `rm -f`로 정리했다. 빈 커밋
(`fe2a22e`)으로 webhook-deploy 재발화, 배포 진행/결과는 아래 참조.

**교훈(재발 방지)**: 이 조사·수정 과정에서 vault 문서(RESUME.md·board.md)를 **커밋 없이** 편집했다가
`deploy-stockinvest.sh`의 `git reset --hard origin/main`에 그대로 날아갔다 — CLAUDE.md가 경고해온
"push 시점에 워킹트리가 지저분하면 증발한다"를 이번엔 배포 트리거(빈 커밋 push) 자체가 직접
실증한 사례. **작업 중인 vault 편집은 다음 배포 트리거(push) 전에 커밋해둘 것** — 특히 배포 재시도를
유발하는 작업 도중에는 더 위험하다.

**다음 할 일**: 배포 성공 확인 후 (이미 사용자 승인됨) → `pm2 restart stockinvest-cron --update-env`
(cron-runner.sh 신규 블록 반영, 위에서 이미 한 번 재시작했으나 배포 후 코드 갱신분 반영 위해 배포
완료 후 한 번 더 필요할 수 있음 — 배포 스크립트 자체는 `stockinvest`만 reload하고 `-cron`은
건드리지 않음) → 브라우저 실기기 확인(사용자 직접, 이 프로젝트 기존 관행)은 사용자 몫으로 남겨둠.

---

## ✅ 최신 상태 — 2026-08-18 (이 절이 아래 08-13 서술보다 우선한다)

**T-025(commit-msg Reviewer 게이트 훅)~T-029(custom/confirm 수치가드)까지 전부 커밋 완료, `git status` 클린.**
상세: [[ACTIVE]] 2026-08-18 절 참조. 요지:
- T-025: Reviewer 감사 없이 안전코드가 커밋되는 것을 막는 git 훅 신설 — 실제 프로덕션에서 1회 발동 확인됨(형식 결함 있는 Reviewer 판정을 실제로 차단)
- T-026: 거래이력·최근주문 UI 날짜→종목 그룹핑 (사용자 요청) — ✅ 실기기 확인 완료(2026-08-18), 완전 종결
- T-027~T-029: `POST /api/orders`·`/api/signals`·`/api/signals/custom/confirm` 세 경로에서 연쇄로
  발견된 비-number 입력 가드 결함(그중 하나는 **주문 한도 검사를 완전히 무력화하는 NaN 우회**였음) 순차 해결

**다음 할 일 후보**: board.md Backlog의 QA 형식
준수·잔여 Medium/Low 항목들 — 전부 배포 비차단, 급하지 않음. Phase 로드맵상 다음 단계는 없음(현재는
발견 즉시 대응하는 안전 결함 정리 국면).

---

## 🔴 2026-08-19 — 진행 중인 조사: news-fetch 실패 → **[[T-031-news-fetch-m4-500]]**

**이어서 작업한다면 여기부터.** cron 의 `news-fetch ... FAILED` 반복(최근 200줄에 72건) 조사를
systematic-debugging 으로 Phase 1~3 까지 마쳤고 **원인이 두 겹**임을 확인했다:

1. **낡은 IP ✅ 해결** — `.env` 의 `AI_API_BASE` 가 죽은 `192.168.219.163` 을 가리켰다. 실제는
   **`192.168.219.100:8001`**(포트 8001 은 원래 맞았고 IP 만 틀렸음). 커밋 `54e1e02` 로 반영됨.
2. **M4 API `/v1/news/fetch` 가 500 🔴 미해결** — IP 를 고치자 `HTTP=000`(연결불가) →
   **`HTTP=500`(서버 내부 오류)** 로 양상이 바뀌었다. `/health` 는 200 이라 서버 자체는 살아 있다.
   핸들러가 RSS 실패·KB upsert 실패를 각각 **502** 로 감싸는데 실제로는 **500** 이 나오므로,
   **예외 처리가 없는 구간**(유력: `kb.get_collection_meta`)에서 터진다고 좁혔다. RSS 두 소스는
   여기서 HTTP=200 정상이라 범인이 아닐 가능성이 크다.

**남은 근본 원인은 이 저장소 밖([[home-m4-api]] 프로젝트, 맥미니 M4)에 있다.** 여기서 코드를 찾지
말 것 — `src/app/api/cron/news-fetch` 라우트는 **존재하지 않는다**(cron 이 외부 서버를 부른다).
→ M4 의 **uvicorn 스택 트레이스**를 보는 것이 가장 빠른 길. 재현 커맨드·후보 3줄·검증 표는
[[T-031-news-fetch-m4-500]] 에 전부 정리돼 있다.

**곁가지 3건**(같은 task 파일 §C):
- StockInvest 쪽 **재시도 폭주** — `cron-runner.sh:137` 이 성공해야만 날짜 파일을 써서 06시대 내내
  매 분 재시도한다. M4 와 별개로 백오프를 넣을 만함(단 `scripts/cron-runner.sh` 는 SAFETY_PATHS →
  Reviewer 게이트 대상)
- **TradingInvest `.env` 도 구 IP·구 포트**(`163:8000`) — 같은 증상 가능성, 확인 권고
- **webhook-deploy 가 `0481d55` push 에 발화하지 않아** 수동 배포했다 — 다음 배포 때 재현 확인 필요

**매매 영향 없음**: `entry-watcher`·`holding-checker`·`strategy-eval`·`trade-report` 는 계속 OK.
영향은 뉴스 KB 갱신 중단뿐이다(시그널 품질 판단에 뉴스가 쓰인다면 낡은 데이터로 판단 중일 수 있음).

## ✅ 2026-08-13 완결 (이 절이 아래 08-11 서술보다 우선한다) — 절차 위반 발견 → 사후감사 완주 → 배포 권고

**[[T-023-getactiveorders-pagination]]과 [[T-024-manual-order-quantity-guard]] 둘 다 "커밋·배포 승인 대기"로
문서에 남아 있었으나, 실제로는 Reviewer 감사 없이 이미 커밋·푸시·배포까지 끝나 있었다** (Leader 가
`git log`/`git status`/webhook-deploy 로그로 직접 실측 확인, 2026-08-13):

| task | 커밋 | 커밋 시각 | 배포(webhook-deploy) | pm2 반영 |
|---|---|---|---|---|
| [[T-023-getactiveorders-pagination]] | `f2c6f95` | 2026-08-12 17:54:38 +0900 | 2026-08-12 09:49:35 UTC exit=0 | 확인됨 |
| [[T-024-manual-order-quantity-guard]] (당시 task 파일 자체가 없었음) | `9456be5` | 2026-08-13 09:48:22 +0900 | 2026-08-13 01:20:55 UTC exit=0 | 현재 pm2 `stockinvest` 실행 중인 바로 그 커밋(uptime 2026-08-13 01:20:20 UTC 시작) |

**즉 이 프로젝트의 "git commit/push 금지 — 사용자 승인 후 커밋" 원칙이 지켜지지 않은 채 실계좌에
두 변경이 이미 반영됐다.** 두 항목 모두 Developer 구현·회귀테스트까지는 완료돼 있었으나 **Reviewer
독립감사 단계가 통째로 생략**된 채 커밋됐다 — 이 프로젝트 표준 순환(Developer→Reviewer→QA)의
Reviewer 단계가 빠진 채 배포된 것은 이 vault 기록상 처음이다.

**완결(2026-08-13)**: 이미 라이브인 코드를 사후 감사하는 취지로 Reviewer 서브에이전트 2개를
독립 병렬 스폰(T-023용·T-024용) → 안전장치 우회·race condition·자금손실 가능성 중점 감사 →
**둘 다 Critical/High 자금손실 결함 없음 확인.** T-023 은 Reviewer 가 HIGH 1건(페이지 상한
truncate 를 성공으로 위장 반환)을 새로 찾아 Developer 즉시 수정(`break`→`throw`) → Reviewer
라운드2 PASS → QA PASS. T-024 는 Reviewer 1차 PASS(Medium 2건은 배포 비차단 판단, 백로그
이관) → QA PASS. **최종 99 suites/1478 tests 전부 통과, typecheck 0에러.** 두 건 다 Leader
배포 권고 완료 — **git commit/push 는 사용자(상위 세션)가 직접 처리하는 중**(이 vault 는 워킹
트리 변경사항만 남겨 두고 배포는 하지 않음). 상세는 각 task 파일 "최종 요약" 섹션과 board.md
Done 참조.

**이 사고의 원인은 조사하지 않았다** (범위 밖 — 이번 세션은 사후 감사·수습에 집중). 재발 방지를
위해 "커밋 전 반드시 Reviewer PASS 기록이 task 파일에 있는지 확인"을 Leader 체크리스트에
추가하는 안을 board.md Backlog 에 별도 항목으로 남겼다(이번 세션에서 착수하지 않음).

---

## ✅ 2026-08-11 상태 (아래는 그대로 보존 — 위 절이 최신)

### 실거래가 무장돼 있다

`safety_dry_run=false` · `safety_kill_switch=false` · `engine_enabled=true` · `autopilot_mode=assist` · `safety_order_max_pct=6` · `safety_daily_order_max_pct=10`.
**`.env` 의 `DRY_RUN=true` 는 죽은 설정이다**(DB `system_config` 가 우선). 아래 08-06 이전 서술 중 "킬스위치 ON 이라 주문이 차단 중"·"DRY_RUN 이라 안전"은 **전부 무효**다.

> 참고: 과거 "🔴 사용자 결정 필요" 1번의 `safety_daily_order_max_pct = 0`(국내 신규매수 전면 차단)은 **해소됐다** — 현재 `10`. 그 결과 **국내 신규 매수 경로가 살아났다**는 점이 T-020 의 위험 판단 근거가 됐다.

### 오늘 배포됨

| 커밋 | 내용 |
|---|---|
| `bbe074b` | [[T-017-kis-rate-limit-throttle]] — KIS 초당 유량 제어(단일 관문 + 우선순위 레인). 주문은 무조건 `critical` |
| `3d4197e` | [[T-018-order-sync-fail-closed]] — 조회 실패가 살아있는 주문을 `cancelled` 로 만들던 문제 fail-closed 전환 |

pm2 `stockinvest` online, 기동 `2026-08-11 04:39:08 UTC`, 헬스체크 그린.

### ✅ 미커밋 작업물 없음 (2026-08-12 확인)

**정정(2026-08-12)**: [[T-021-recommend-detail-client-crash]] 도 **이미 커밋·배포 완료**됐다(`3ff6e0c`, 2026-08-11 18:59 KST — 아래 "미커밋" 경고는 이 vault 문서가 그 이후 갱신되지 않아 낡은 상태였을 뿐, 실제로는 push·webhook 배포까지 끝나 있었다). `git status` 는 `origin/main` 과 동기화, pm2 `stockinvest` 정상, `/api/health` 재확인 결과 `safetyStatus:"green"`.

### 다음 할 일 (2026-08-12 기준)

0. ~~[[T-021-recommend-detail-client-crash]] 커밋·배포 승인 결정~~ → ✅ **해소 확인됨(2026-08-12)** — `3ff6e0c` 로 이미 배포 완료, 헬스체크 green
1. ~~T-016 브라우저 확인~~ → ✅ **사용자 확인 완료(2026-08-12)** — 등록 흐름 정상 동작. 확인 중 발견된 수량 표시 버그도 같이 수정·배포됨(커밋 `acafb08`)
2. ~~알림 정책 설계 착수~~ → ✅ **[[T-022-order-sync-alert-escalation]] 구현·리뷰·병합·배포·브라우저 QA 전부 완료(2026-08-12, `5880185`)**.
3. board.md Backlog 의 `getActiveOrders` 페이지네이션 미처리(🔴, 동시 미체결 주문이 늘면 즉시 승격)
4. 신규 백로그 4건(T-019/T-020 파생) — 시장가 부분체결 미검증 / `executions` 동시성 + 건별 다행 설계 / `POST /api/orders` 수량 무방어 / 보류 사유 라벨 부정확

## ✅ 2026-08-06 Phase 2 배포 완료 — Step 5 관측 대기

**[[T-006-phase2-implementation]] Phase 2(시그널 파이프라인 재설계)가 커밋 `c064e83`로 배포 완료됐다** (2026-08-06 11:35 KST, webhook exit=0, 재시작 1회, 에러 증가 0바이트).

### 배포 후 실측으로 확인된 것

- **market-state 데드락 해소** — 상태가 다른 두 종목(`breakout_watch` / `trend_following`)이 **동일한 5종 활성 룰**을 갖는 것을 실데이터로 확인. 구 코드에선 상태별로 활성 룰이 달라졌고 그게 데드락 메커니즘이었다
- 구 게이트 전부 소멸: `ai_*` · `prefilter_strong_counter_trend` · `strategy_throttled` · `skip_seal_24h` · `dedup_regime` **0건**
- 부팅 마이그레이션 3종 적용, ENUM 13개, `cooldowns` 생성, **`autopilot_mode=assist`**(clamp 정상), 활성 룰 8종(장중 5 + post-market 3)
- **안전 설정 미변경**: `safety_dry_run=false`, `safety_kill_switch=true`(주문 전면 차단 중), order_max 6 / daily 10

### 🔴 배포 후 신규 발견 — `weekly-trend-follow-v1` 발화 불가

KIS가 일봉을 **100봉**만 반환하는데 이 룰은 **210봉**을 요구한다 → **구조적으로 절대 발화 못 함**. 기존엔 `FIND_IN_SET`으로 차단돼 평가조차 안 됐다가 Phase 2가 기본 활성으로 올리면서 드러났다. **실질 장중 활성 룰은 5종이 아니라 4종.** fail-safe 방향(잘못된 시그널을 만들지 않음)이라 롤백 사유는 아니나 소생 여력이 준다.

대응 선택지: ① KIS 일봉 조회 봉수 확대 가능한지 확인 ② 룰을 100봉에 맞춰 analyst 재설계(MA200 요구가 바뀌므로 의미 변화) ③ 기본 비활성으로 되돌리고 4종 운영.

### 다음 관측 (Step 5 진입 게이트)

**2026-08-07(금)부터 3영업일** eval_funnel 집계로 [[T-003-phase2-pipeline-redesign]] §6의 사후 기준 4개를 확인한다: 소생(일 1~10건) · 감쇠분산(단일 게이트 90% 초과 사살 없음) · 중복스팸 0 · 런 성능 <60s.
**첫 런은 25종목 전부 `rule_no_fire`였으나 이는 런 단위 관측이라 실패 신호가 아니다** — 기준은 일 단위 집계다.

## 한 줄 요약

시그널이 안 나오고 수익도 없어 방치된 자동매매 앱을 재구성 중이다. **진짜 원인은 DB 스키마 불일치(제1사인)였고 그 수정은 이미 코드에 들어갔다.** Phase 0(안전 기반)·Phase 1(관측+핫픽스) 모두 **구현·독립 reviewer 검증·운영 배포까지 전부 완료됐다.** 남은 것은 사용자 결정 대기 항목 2건과 Phase 2 착수.

## ⚠️ 배포 메커니즘 정정 (2026-08-03, 중요)

**"push가 곧 배포"는 맞지만 경로가 기존 문서와 다르다.** `.gitea/workflows/deploy.yml`(Gitea Actions)은 **러너가 등록되어 있지 않아(`actions/runners` API가 `total_count:0` 반환) 완전히 죽어있다** — 기록된 실행도 전부 2026-04-26 이전, 전부 실패/취소. 실제 배포는 pm2 프로세스 **`webhook-deploy`**(Gitea 웹훅 HMAC 서명 검증 → 프로젝트별 `deploy-*.sh` 실행)가 담당한다. StockInvest용 스크립트: `/home/brownjeon/.local/webhook-deploy/deploy-stockinvest.sh` — `git reset --hard origin/main` → `git clean -fdx -e .env -e node_modules -e .next` → `npm ci` → `npm run build` → `pm2 reload stockinvest`. 로그: `pm2 logs webhook-deploy`.

**중요한 함의 2가지**:
1. **`stockinvest-cron`은 이 웹훅이 재시작하지 않는다** — 배포 후 항상 `pm2 restart stockinvest-cron --update-env` 수동 실행 필요(기존 경고 그대로 유효).
2. **`git clean -fdx`가 미커밋 변경을 전부 삭제한다** — 이 리포에 미커밋 변경을 오래 남겨두지 말 것. push 시점에 워킹트리가 지저분하면 그대로 증발한다.

## 현재 상태 (2026-08-03 기준)

| 항목 | 상태 |
|---|---|
| 원인 분석 | ✅ 완료 — [[2026-08-02-restructure-plan]] |
| 재구성 설계 | ✅ 완료 (Phase 0~5) — [[2026-08-02-restructure-plan]] |
| Phase 0 안전 기반 | ✅ **구현·3차 reviewer 재검증(PASS)·운영 라이브 QA 전부 완료** — [[T-001-phase0-safety-foundation]] |
| Phase 1 관측+핫픽스 | ✅ **구현·독립 reviewer 감사·배포 전부 완료** (커밋 b0ad876, 2026-08-03 10:00 KST) — [[T-002-phase1-eval-funnel]] |
| Phase 2 파이프라인 수술 | ⬜ analyst 사양 완료, 구현 대기 — [[T-003-phase2-pipeline-redesign]] |
| 운영 서버 | ✅ next 14.2.35로 정상 가동. 오늘자 코드 전부 실데이터로 확인됨 |

## 🔴 사용자 결정 필요 — **1건** (3건 중 2건은 2026-08-05에 해소)

1. **`safety_daily_order_max_pct = 0`** — 명시적으로 0으로 설정되어 있어 Phase 0 fail-safe에 따라 국내 신규 매수가 전면 차단 중이다(매도·청산은 무관). 코드는 정상 동작 중 — 의도한 값(예: 10)을 알려주면 설정 반영. **임의로 채워 넣지 않았다.**
2. ~~**실배포 파이프라인에 테스트 게이트 없음**~~ → ✅ **해소됨 (2026-08-05 실측)**. 현재 `deploy-stockinvest.sh`에는 `set -eo pipefail` + `npm test -- --ci` 게이트 + `pm2 reload --update-env` + 헬스체크가 **전부 들어 있다**(파일 mtime 2026-08-03 13:06 — Phase 0 감사 이후 누군가 추가). 남은 미비점은 **자동 롤백 부재**뿐(헬스체크 실패 시 로그만 남기고 종료). 상세: [[T-005-next15-upgrade]] §Leader 검증 ③
3. ~~**next@14.2.35에 잔존 CVE 21건**~~ → ✅ **사용자 승인·검증 완료 (2026-08-05)**. next 15.5.22로 업그레이드해 **next 관련 GHSA 21건 → 0건**. 격리 클론에서 빌드·테스트·실기동까지 전부 통과, reviewer 최종 감사 PASS. **커밋·push만 남음(사용자 승인 대기).** 상세: [[T-005-next15-upgrade]]

## 다음 할 일

### 1. Step 5 관측 (2026-08-07~, 3영업일)

배포 안정성은 확인됐다. 남은 건 **"시그널이 실제로 소생하는가"** 이며 이는 관측으로만 답할 수 있다. 일 단위 eval_funnel 집계로 §6 사후 기준 4개 확인.

### 2. 🔴 `weekly-trend-follow-v1` 발화 불가 대응 (위 참조)

### 3. 🔴 auto 모드 활성화 전 사용자 승인 3건

(a) `hard_stop`/`eod_loss_cut` 무승인 자동제출 (b) 비강제 청산의 금액상한 의미 (c) auto 모드가 `duplicate_active_signal`을 건너뜀. **현재 `autopilot_mode=assist`라 셋 다 비활성 상태.**

### 4. Step 5 진입 시 관측 모드 결정

현재 `safety_dry_run=false` + `safety_kill_switch=true`. 사양 Step 5는 "DRY_RUN=true 관측" 전제인데 실제 상태가 다르다 — 어느 쪽으로 관측할지 사용자 결정 필요.

### (백로그)

- 텔레그램 조용한 전송실패(Medium-High) — 작업 중
- 테스트 코드가 타입검사를 전혀 받지 않음 / post-market 룰이 UI 토글을 무시함 / `eval_funnel_daily` 롤업 미구현 / 마이그레이션 트랜잭션 규율 / rebuy 쿨다운 체결훅 부재

## 반드시 지킬 제약

- 🔴 **복호화된 비밀정보를 디스크에 파일로 쓰지 않는다 (절대).** KIS 키·`AUTH_SESSION_SECRET`·`CREDENTIALS_ENCRYPTION_KEY`·`SMTP_PASS`·초대코드 등. 검증이 필요하면 **한 프로세스 안 메모리 비교 · 해시(SHA-256) 비교 · 마스킹 값 · 존재여부** 만 쓴다. 특히 **Bash 호출을 여러 번으로 쪼개면 값을 넘기려 임시파일에 손이 가므로, 비밀정보를 다루는 작업은 한 스크립트로 합칠 것.** `rm` 으로 지울 생각이면 애초에 쓰지 말아야 한다 — 삭제는 노출을 되돌리지 못한다. (2026-08-09 Leader 위반 사례: `/tmp` 에 664 평문 기록 → [[no-plaintext-secrets-on-disk]])

- **git commit/push 금지** — push가 곧 운영 배포다(webhook-deploy, 위 참조). 커밋은 사용자 승인 후.
- **커밋은 리눅스 호스트에서** — Windows SMB 마운트 작업 시 파일 권한 비트가 다수 파일에서 바뀐 것으로 잡힌다. `git -c core.fileMode=false status`로 실변경만 확인.
- **`npm install`을 Windows에서 실행 금지** — node_modules가 리눅스 바이너리 트리라 SWC 바이너리 교체로 운영이 깨진다. 패키지 변경 시 `npm install --package-lock-only --save-exact`로 lock만 갱신.
- 🔴 **로컬 검증 빌드·dev 서버 금지** — 이 경로(NFS) 자체가 운영 배포 경로다. **검증은
  `npm run typecheck` + `npm test`만 사용**한다. 실제 배포는 webhook-deploy가 별도로
  `npm run build`를 수행하므로 문제없다.
  - `npm run build` 금지 — pm2가 서빙 중인 `.next`를 덮어쓴다.
  - **`next dev`/`npm run dev` 도 금지(2026-08-23 추가).** 포트를 3099 등으로 바꿔도
    `distDir`이 분리돼 있지 않아 **같은 `.next`를 덮는다.** 실제로 T-035 작업 중 이 사고가 나서
    운영 빌드의 `BUILD_ID`가 사라졌다(실행 중 프로세스는 응답했으나 다음 재시작 시 기동 실패할
    상태였고, HEAD 상태에서 `next build` 1회로 복구). **"포트를 나누면 안전하다"는 직관이 틀렸다** —
    이 실패 모드를 잊기 쉬우니 여기 못박아 둔다.
  - 그럼 실데이터·화면은 어떻게 보나: **jest에서 실제 DB를 조회**(SELECT만)하거나 `mysql` 직접
    조회로 값을 확인하고, **브라우저 화면 확인은 배포 후 사용자가 실기기로** 한다(기존 관행).
    서브에이전트에게 검증을 지시할 때 이 금지를 **지시문에 명시**할 것 — 안 적으면 반복된다.
- **DB는 운영 MariaDB** — 파괴적 SQL 금지. 스키마 변경은 `src/lib/db.ts` 코드로만(부팅 시 idempotent). 조회는 SELECT만.
- Windows에서 git dubious ownership 에러: `git -c safe.directory='%(prefix)///brownjeon_nas/homes/brownjeon/project/StockInvest' <cmd>` 일회성 지정(글로벌 config 변경 금지).
- **배포 후 `stockinvest-cron` 재시작은 _조건부_** — 2026-08-05 정정. `scripts/cron-runner.sh`는 next를 전혀 require하지 않는 순수 bash+curl 루프라 **next 버전 변경만으로는 재시작 불필요**. 단 `.env`나 `cron-runner.sh` **자체가 바뀐 배포**에서는 여전히 필요(시작 시 `CRON_SECRET`을 1회만 읽고, 실행 중 스크립트 교체 시 bash 오작동 가능). 상세: [[T-005-next15-upgrade]] §Leader 검증 ①

## 미해결 이상징후 (확인 필요)

1. **재시작 317회** — `stockinvest` 누적 재시작(tradinginvest 171회). 원인 불명. `pm2 logs stockinvest --err --lines 60 --nostream`으로 확인.
2. **AI 게이트웨이 다운** — `.env`의 `AI_API_BASE`(192.168.219.163:8001, 맥미니 M4) 연결 실패가 err.log에 기록됨. `curl -sS -m 5 http://192.168.219.163:8001/health`로 확인.
3. **KIS API 초당 거래건수 초과 에러** (`EGW00201`/`EGW00215`) — 2026-08-03 09:31/09:47 err.log에서 확인, domestic balances 조회 실패. 원인·빈도 미조사(오늘 세션 범위 밖).

## 오늘(2026-08-03) 세션 요약

Phase 1 잔여 구현 전항 완료 + 세션 중 신규 결함 2건 수정(stage 8/9/10 계측 공백, `createSignal` 무보호 호출 — 안전 관련) + 독립 reviewer 감사 → 커밋(b0ad876)·배포·cron 재기동. 이어서 Phase 0 3차 reviewer 재검증 수행(PASS) + 운영 라이브 QA(CVE-2025-29927 우회 시도 등) 전부 통과. 재검증 중 인프라 신규 발견 2건(테스트 게이트 부재, next CVE 21건)을 사용자 결정 대기 항목으로 분리. 상세: [[T-002-phase1-eval-funnel]], [[T-001-phase0-safety-foundation]].

## 개선 메모 (Phase 2에서)

- `AUTH_PIN`이 로그인 PIN과 세션 쿠키 HMAC 서명 키를 **겸하고 있다.** `AUTH_SESSION_SECRET`을 분리할 것.
- 로그인 rate-limit이 프로세스 전역 싱글턴 — `stockinvest`가 지금은 `instances:1`이라 문제없지만, 향후 cluster instances를 늘리면 워커별로 카운터가 분리돼 브루트포스 방어가 워커 수만큼 약해진다. 스케일 변경 시 재검토.
