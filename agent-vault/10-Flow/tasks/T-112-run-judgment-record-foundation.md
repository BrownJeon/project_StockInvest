---
task_id: T-112
title: 실행·판단 기록 기반 — `job_run_log`(실행·상태 기록)와 기준 판단(baseline) 기록 — 문서 단계: DDL 초안·J1 호환 확인
status: planned
priority: high
project: StockInvest
created: 2026-10-30
updated: 2026-10-30
base_ref: origin/main 9d087a4
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa]
related_tasks: [T-108-automation-menu-home-overhaul, T-104-cron-jobs-market-grouping, T-114-corporate-intelligence-second-design, T-116-news-first-seen-capture, T-109-research-context-for-analysis]
tags:
  - type/task
  - domain/data
  - domain/cron
  - domain/analysis
aliases:
  - 기록기반
  - job_run_log
waiting: [구현 단계 착수 지시(DP1 ~11-05 순서 결정), 일회용 MariaDB DDL 시험, DDL 적용 사용자 승인(건별), 국내 D0 정의(Analyst), T-104 1단계 순서]
demo_gate:
  required: false
  level: "none"
  status: "not_required"
  version: 0
  repo_path: ""
  artifact_url: ""
  content_sha256: ""
  decided_by: "judge"
  rule_id: ""
  approved_by: ""
  approved_at: ""
  approval_quote: ""
  waived_by: ""
  waived_at: ""
  waiver_quote: ""
  active: false
---

# T-112 실행·판단 기록 기반 (문서 단계)

## 목표·배경 (Leader)
**한 문장**: 지금은 남지 않는 두 가지를 DB 에 남기는 기반의 **설계 초안(DDL 문서)**을 만든다 — ① 크론 잡의 실행·상태(`job_run_log`) ② 장마감 분석의 후보와 AI 판단(기준 판단 baseline).

**왜**: 날짜 파일은 성공을 뜻하지 않고(10-26 edgar-sync 사례), 장마감 분석은 후보 목록과 AI 의 BUY/SKIP 을 저장하지 않으며 카드(`signals`)만 남는다([2차 설계서](../../../docs/design/2026-10-28-corporate-intelligence-second-design.md) §9.5·「기준 판단 기록이 없다」). 11-23 킬스위치 판단에 쓰기로 한 증거(후보 사후 성과 · 정상 가동률 · 후보·제외 사유 추이)와 홈 "가동률"이 이 기록 없이는 소급되지 않는다. 4주 관찰 시계가 이미 돌고 있어 기록 시작이 늦을수록 증거 기간이 줄어든다.

## 사용자 지시·승인 (원문 보존)
- 2026-10-28 17:09 결정 ②: **기록 먼저 분리** — 새 기록 기반을 UI 개편보다 먼저(별도 task, DDL 은 그때 승인). 공동 인계서 J1(`job_run_log` 한 테이블)·J4(`judgment_role ∈ {baseline, shadow}`) 채택.
- 2026-10-30 "문서 단계 시작" — 질문은 "문서 단계(지표 계약·기록 DDL 초안)를 지금 시작할까요?". **허용**: 설계 문서·DDL **초안**(문서 안 코드블록) 작성, 코드 읽기, 일회용 서버 밖 시험 설계. **불허**: DDL 적용·`scripts/migrations/` 에 SQL 파일 추가·운영 DB 쓰기·코드 변경·배포·push·운영 DB 조회(U6 병합 승인 절차 전까지 SELECT 도 실행 안 함).
- 통합 계획 §5: "지금 해도 되는 것(문서·데모만) — T-112(기록) DDL 초안과 G-J1 호환 확인". DDL 적용은 **사용자 건별 직렬 승인**(T-112 → 단계 1a 첫 DDL 순).

## 이 단계의 산출물
1. `docs/design/2026-10-30-t112-record-ddl-draft.md` — Developer. `job_run_log`(2차 설계서 §9.5 확정안 기준) + 기준 판단 기록 테이블(설계서 §7 단계 3 필수 필드 대조) DDL 초안, G-J1 호환 표(T-104 판정 · T-108 가동률 · T-114 §9.5/§7 단계 3), 기록 지점(러너 `call()` 사후 후크 · `post-market-*`)과 실패 시 영향 0 원칙, 증가량·인덱스·보존, 적용·시험 절차(일회용 MariaDB), 열린 질문.
2. T-108 지표 계약 초안(`docs/design/2026-10-30-t108-metrics-contract-draft.md`, Analyst)이 이 기록의 필드를 소비한다 — 두 문서는 서로 읽고 이견은 아래 「호환 확인 기록」에 적는다.

## 호환 확인 기록 (G-J1) — Leader 대조 12:07 (DDL 초안 §4.3·§4.4 ↔ 지표 계약 초안 §6)
두 초안(`docs/design/2026-10-30-t112-record-ddl-draft.md` · `docs/design/2026-10-30-t108-metrics-contract-draft.md`)을 Leader 가 대조했다. **아래 "Leader 제안"은 사용자 결정 U1~U5 와 함께 확인받는다 — 확정 전에는 DDL 초안(v1)을 고치지 않는다.**

| # | 항목 | DDL 초안 | 지표 계약 | Leader 제안 |
|---|---|---|---|---|
| 1 | `counts_json` / `detail_json` 이름 | `counts_json`(§9.5 정본) | `counts_json` | **일치.** 분석 run 키는 계약 키 `{evaluated, candidates, llm_input, created, blocked, duplicate, skipped}` 채택(JSON 이라 DDL 영향 0). 공동 인계서·지시문의 옛 이름 `detail_json` 정리만 남음 |
| 2 | 해외 503 `data_unknown` 상태 (E16) | `failed` + `error_code=HTTP=503:data_unknown` | `degraded` | **`failed` 유지 + `error_code` 로 구분.** 분석 판단이 그 회차에 안 나왔고, D6 권고(가동률 분자 = `ok` 만)에서는 어느 쪽이든 분자 밖이다. A4 는 `error_code` 로 "데이터 이상"(data_unknown)과 "분석 실패"(그 외)를 가르면 된다. `skipped`(정상 건너뜀: `overseas_disabled`·`no_new_session`·`us_session_open`)는 계약 그대로 |
| 3 | "정상 회차"에 재시도 성공(`attempt>1`) 포함? (E9) | 미정 | D6 `ok` 만 | **최종 `ok` 는 정상**(재시도 횟수는 `attempt` 로 별도 표시) |
| 4 | 규칙 후보 단위 `rule_hits` (E17) | 미포함(종목당 남긴 패턴 1개) | 3개 패턴 적중 전부 | **미포함, 종목 단위로 센다.** A2 "분석 후보 종목"은 종목 단위이고 `candidate_count` 와 같은 정의(엔진 `candidatesFound`). 패턴 단위가 필요해지면 가산 열 |
| 5 | 판단 기록 `run_id`(→`job_run_log`) | 미포함, `market`+`started_at` 구간으로 연결 | 요구 | **미포함(v1).** 하루 시장당 1~3회라 시간 구간으로 충분하다. 정확한 연결이 필요해지면 러너가 실행 토큰 헤더를 보내는 1열 가산 |
| 6 | `ref_price_native`·`currency`·`fx_usdkrw`·`fx_at` (E18) | 미포함 | 요구 | **미포함.** T-095 사후 성과 `d1open`·`d0close` 는 `daily_bars` 현지 통화 원값만 쓴다. D7 권고가 `d1open`(환율 무관)이라 불필요 — **D7 이 `d0close`+환율 모델로 바뀌면 재검토** |
| 7 | `engine_version`(git sha) | 미포함 | 요구(§10 기준선 대장 대조) | **채택 권고: `engine_release VARCHAR(48) NULL`**(`judgment_run`, 1열 가산). 값은 릴리스 디렉터리 이름(`20261030-051343-9d087a4d` — `process.cwd()` 가 `/home/brownjeon/apps/stockinvest/releases/<이름>` 임을 pm2 `pm_cwd` 로 확인) |
| 8 | `news_count` | 없음(`rag_context_ids.news` 길이로 계산) | 요구 | **계산으로 충분.** 열 추가 없음 |
| 9 | `session_date_kst/et`·`d0_trade_date` ↔ `session_d0` | `session_d0`(현지 거래일) | 3개 이름 | **같은 뜻 — `session_d0` 로 통일.** 국내 D0 는 엔진이 보유하지 않아 구현 시 "마지막 봉 날짜"로 정의(Analyst 질문 ⑤ 미해결) |
| 10 | 60분 미만 잡 롤업 (U2) | 롤업 권고 | 매분 롤업은 홈 지표 대상 아님(E2 분모 제외) | **일치 — 롤업(약 230행/일) 권고** |
| 11 | 보존 | 처음엔 삭제 없음 | 90일 이상 | **일치** |
| 12 | `stage` 8개 / `decision` / `reject_reason` | `sent_to_llm`·`ai_decision`·`exclusion_code`·`signal_id` 4열 | stage 열 | **4열에서 결정적으로 계산.** 별도 열을 두면 값이 어긋날 수 있어 두지 않는다 |
| 13 | T-104 실행 판정이 이 테이블을 읽는가 (E8) | 읽으면 안 됨 | — | **합의.** T-104 는 DB·앱이 죽어도 러너가 같게 동작해야 하므로 실행 판정은 러너 로컬 상태, 이 테이블은 **표시·감사용 사본**. 화면 문구는 "기록 기준" 명시. T-104 task 에 한 줄 남김 |

**Leader 결론**: 두 문서는 큰 충돌이 없다. 미해결로 남는 것은 ① 국내 D0 정의(Analyst 질문 ⑤) ② 위 7번 `engine_release` 1열 가산 ③ 사용자 결정 U1~U5 뿐이다. 구현은 Judge 접수(R2, Codex 필수) → 일회용 DB 시험 → Developer → Reviewer → QA → **DDL 적용 사용자 승인** 순서이며 이 단계에서는 시작하지 않는다.

## 보호할 것
- 코드·DDL 적용·운영 DB·알림·배포 변경 없음. `src/app/api/cron/**`·`scripts/cron-runner.sh`·`src/lib/strategy/post-market-*` 는 훅 `SAFETY_PATHS` — 구현 단계에서 Reviewer 판정 줄 필수.
- 기록 실패가 수집·분석·주문을 막지 않는다(T-106 `news-health.ts` 의 "절대 던지지 않는다" 원칙과 같다).
- 공동 인계서 §10 관찰 기준선 대장: 기록 추가는 판단 불변(기록 전용) — 구현 때 배포 시각만 남긴다.

## 판단 기록 (judge)
- [2026-10-30 11:48] intake engine=rules → task_type=null · risk=R2 · developer_model=opus · next=demo_first · demo=delta/designer(DM-kw-risky-cta) · actions=prepare_demo,request_demo_approval,assign_developer | overrides=R2-kw-payment,MD-judge-failed-opus,DM-kw-risky-cta | fallback=budget_window_closed | tokens=0
- [2026-10-30 11:50] [재실행 — Leader 요청, 입력 요약 정정] intake engine=rules → task_type=null · risk=R1 · developer_model=opus · next=assign · demo=none/- · actions=assign_developer | overrides=MD-judge-failed-opus | fallback=budget_window_closed | tokens=0
- [11:50] Leader: 첫 intake 의 demo=delta/R2 는 입력 요약 속 "주문"·"추가"(비-UI 문맥)에 걸린 키워드 오탐이다 — 이 task 는 사용자 화면을 만들지 않는다. 입력 요약을 사실 그대로 다시 써 재실행(Leader 요청, 두 줄 모두 보존; `waive` 아님) → demo=none·risk=R1·next=assign. `check.mjs init` 으로 `demo_gate` = not_required 기록. **risk 는 R2 로 유지**(재실행 입력에서 빠진 "DDL 적용은 사용자 건별 승인"·크론 러너/장마감 분석 모듈 수정이 구현 단계에 있고, `src/app/api/cron/**`·`scripts/cron-runner.sh`·`src/lib/strategy/post-market-*` 는 훅 SAFETY_PATHS). developer_model opus 는 복잡도 판정이 아니라 예산 구간 만료 대체 규칙(`MD-judge-failed-opus`).

## Developer
- [12:07] **문서 단계 완료(Developer, 읽기 전용)** → [docs/design/2026-10-30-t112-record-ddl-draft.md](../../../docs/design/2026-10-30-t112-record-ddl-draft.md) (566줄). 제안 테이블 3개 `job_run_log`(§9.5 확정안 + 변경 4건 D-a~D-d)·`judgment_run`·`judgment_candidate`(모두 `CREATE TABLE IF NOT EXISTS`·외래키 없음·부팅 DDL 미포함). 기준 판단 기록을 2테이블로 나눈 이유: 1개면 후보 0건 실행이 안 남는다. 기존 `eval_funnel` 은 30일 삭제·판단 필드 없음으로 재사용 안 함.
- [12:07] 불편한 사실(Developer 보고): ① §9.5 대로 `call()` 안에서 POST 하면 08시 틱(최악 290초, 한도 300초)을 넘길 수 있다 [가능성 높음] → 스풀 파일 + 가벼운 틱 일괄 전송 권고 ② §9.5 키·어휘 충돌 3건 → 변경 4건 ③ 기준 판단 기록은 "비차단 호출 1곳"이 아니라 해외 약 12곳·국내 약 8곳 거르기 지점 표시 + 국내 D0·카드 id·실제 모델 미보유 → 모두 훅 감시 경로(`src/lib/strategy/`) 수정 ④ **DDL 문법 미검증**(일회용 MariaDB 없음; 다른 세션의 임시 mysqld 포트 33177 은 남의 자원이라 쓰지 않음) ⑤ `export-llm-trainset` 은 `call()` 을 거치지 않아 후크로 안 잡힘.
- [12:07] Leader 확인: 저장소 변경은 위 문서 1개뿐(Developer 보고), DDL 적용·`scripts/migrations/` 추가·코드·운영 DB 조회 0.

## Reviewer

## QA

## 배포 기록

## 진행 기록
- [2026-10-30 11:45] 접수(Leader). 번호 T-112 는 `ls` 로 비어 있음을 재확인했고 공동 인계서 §11 에 선점 줄을 남겼다. 문서 단계만 — DDL 초안(Developer)·T-108 지표 계약 초안(Analyst) 병렬 시작.
- [12:07] 문서 단계 산출물 2종 도착(DDL 초안·지표 계약 초안) → Leader G-J1 대조 완료(위 「호환 확인 기록」). 사용자 결정 U1~U5 대기. U6 읽기 전용 SELECT 승인 대기(T-108 몫, 미실행).
- [12:22] **사용자 확정**(원문 "권고안 일괄 확정", 질문: 권고안 일괄 확정 + U6 18건 실행): U1~U5 권고안, G-J1 Leader 제안 채택(`engine_release` 1열 가산 포함). DDL 초안을 v1.1 로 갱신했고 계약 §10 에 U6 결과를 붙였다. 문서 결정만 — DDL 문법 미검증·미적용, 구현 단계(Judge C1 → 일회용 DB 시험 → Developer → Reviewer → QA → DDL 적용 승인)는 시작하지 않음.
- [13:44] 열린 범위 질문(Leader): 감사 기간 증거에 **청산 엔진 판단**이 들어가는데(사용자 설명 10-30) 현재 기록은 `eval_funnel` stage 21~29(30일 롤링)와 pm2 로그뿐이다. 이 task 의 기록 대상(`job_run_log`·장마감 분석 판단)에는 포함돼 있지 않다 — 영구 보존이 필요한지, 필요하면 이 task 범위로 넣을지 별도 task 로 둘지는 지표 계약 D1 재확인과 함께 사용자 결정(DDL 초안 v1.1 은 바꾸지 않음).
- [14:45] 청산 판단 영구 보존(지표 계약 D11): Analyst 권고 **(c) 별도 task** — T-112 는 Judge 접수(R2) 전이라 범위 확장이 일정을 밀고 청산 기록은 쓰기 지점·주기가 다르다. 사용자 확정 대기. T-112 DDL v1.1 은 바꾸지 않음.

## 최종 요약
(미작성)

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음 | - | - | judge: none | 10-30 11:50 |
