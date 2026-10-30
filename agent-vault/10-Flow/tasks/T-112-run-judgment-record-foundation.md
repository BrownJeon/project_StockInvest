---
task_id: T-112
title: 실행·판단 기록 기반 — `job_run_log`(실행·상태 기록)와 기준 판단(baseline) 기록 — 구현·배포 완료(기록 스위치 꺼짐)
status: deployed
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

## 구현 규칙 (Leader 채택 17:00 — DDL 시험 결과 §10.6 F1~F10 + Reviewer 질문 R1~R4)
DDL 일회용 MariaDB 10.11 시험은 **90/90 통과**(두 sql_mode)이고 DDL 블록은 고칠 곳이 없었다. 아래는 구현이 지킬 규칙이다.
| # | 결정 |
|---|---|
| F1 | ODKU 식은 **b′**: 비교에 `IFNULL(ended_at,'1000-01-01 00:00:00')`, `ended_at` 대입은 **맨 마지막**. `chk_jrl_ended` CHECK(대안 a)는 넣지 않는다 |
| F2 | 무변화 재전송은 `insertId=0`·`affectedRows=1` — `affectedRows` 로 새 행을 판정하지 않는다. `run_id` 가 필요하면 첫 대입을 `run_id = LAST_INSERT_ID(run_id)` 로 |
| F3 | 문자열은 **코드포인트 단위**로 자른다(`Array.from(s).slice(0,N).join('')`). 근거 500자, `symbol` 32·`pattern` 32·`exclusion_code` 40·`llm_provider` 24·`llm_model` 64·`engine_release` 48·`error_code` 64·`degraded_reason` 128 등 **모든 열**을 넣기 전에 길이 검사·자르기 |
| F4 | 인덱스 열 순서 **바꾸지 않는다**(1년 뒤 느려지면 가산 ALTER) |
| F5 | 한 실행 안 같은 종목 대소문자·공백 변형은 **넣기 전 정규화·중복 제거** |
| F6 | CHECK 위반 판별은 `errno === 4025` (mysql2 `code` 문자열 아님) |
| F7 | DDL 그대로. JSON 크기 상한 표기는 "2048자·4096자·1024자"(글자 수)로 읽는다 |
| F8 | DDL 적용 직전 확인에 `SELECT @@GLOBAL.sql_mode` 1회 추가 — **운영 조회라 사용자 승인 게이트에 포함** |
| F9 | 정식 마이그레이션 첫 줄에 `SET SESSION lock_wait_timeout = 5` 를 둔다(T-088 선례) |
| F10 | 앱 풀은 `dateStrings` 를 쓰지 않아 해당 없음 — 문자열로 읽게 되면 `DATE_FORMAT` |
| R1 | **스풀 방식 B + 틱 경과 150초 미만일 때만 일괄 전송** 채택(구현 후 Reviewer 가 시간 여유 재확인) |
| R2 | 분석 쪽 기록은 **결과를 정한 뒤 기다리지 않는 기록**(자체 시간 상한·예외 삼킴). 분석·카드·LLM 결과는 기록 때문에 바뀌지 않는다 |
| R3 | 기록기 위치 = **`src/lib/strategy/records/`** (훅 `^src/lib/strategy/` 접두어가 자동으로 덮는다 — `SAFETY_PATHS` 수정 없음) |
| R4 | `missing` 행 합성 잡은 **v1 에 넣지 않는다**(새 잡 → 하트비트 부담). 상태 어휘·`reconciler` 값은 DDL 에 남기되 쓰지 않고, 슬롯 누락 판정은 T-104 단계 1 에서 |
| 스위치 | `job_run_log_enabled`·`judgment_record_enabled` — **키 없음 = 꺼짐**(fail-closed). 테이블 없음(ER_NO_SUCH_TABLE)도 조용히 건너뜀. 배포 시점에는 둘 다 꺼짐, 켜기는 DDL 적용 사용자 승인 뒤 Leader |
| 범위 밖 | 청산 판단 기록(T-126), `missing` 합성(T-104), 홈 가동률 계산(T-108), 새 잡 추가 |

## 보호할 것
- 코드·DDL 적용·운영 DB·알림·배포 변경 없음. `src/app/api/cron/**`·`scripts/cron-runner.sh`·`src/lib/strategy/post-market-*` 는 훅 `SAFETY_PATHS` — 구현 단계에서 Reviewer 판정 줄 필수.
- 기록 실패가 수집·분석·주문을 막지 않는다(T-106 `news-health.ts` 의 "절대 던지지 않는다" 원칙과 같다).
- 공동 인계서 §10 관찰 기준선 대장: 기록 추가는 판단 불변(기록 전용) — 구현 때 배포 시각만 남긴다.

## 판단 기록 (judge)
- [2026-10-30 11:48] intake engine=rules → task_type=null · risk=R2 · developer_model=opus · next=demo_first · demo=delta/designer(DM-kw-risky-cta) · actions=prepare_demo,request_demo_approval,assign_developer | overrides=R2-kw-payment,MD-judge-failed-opus,DM-kw-risky-cta | fallback=budget_window_closed | tokens=0
- [2026-10-30 11:50] [재실행 — Leader 요청, 입력 요약 정정] intake engine=rules → task_type=null · risk=R1 · developer_model=opus · next=assign · demo=none/- · actions=assign_developer | overrides=MD-judge-failed-opus | fallback=budget_window_closed | tokens=0
- [11:50] Leader: 첫 intake 의 demo=delta/R2 는 입력 요약 속 "주문"·"추가"(비-UI 문맥)에 걸린 키워드 오탐이다 — 이 task 는 사용자 화면을 만들지 않는다. 입력 요약을 사실 그대로 다시 써 재실행(Leader 요청, 두 줄 모두 보존; `waive` 아님) → demo=none·risk=R1·next=assign. `check.mjs init` 으로 `demo_gate` = not_required 기록. **risk 는 R2 로 유지**(재실행 입력에서 빠진 "DDL 적용은 사용자 건별 승인"·크론 러너/장마감 분석 모듈 수정이 구현 단계에 있고, `src/app/api/cron/**`·`scripts/cron-runner.sh`·`src/lib/strategy/post-market-*` 는 훅 SAFETY_PATHS). developer_model opus 는 복잡도 판정이 아니라 예산 구간 만료 대체 규칙(`MD-judge-failed-opus`).
- [2026-10-30 16:36] codex_gate/C1 engine=rules → codex_required=false · wanted_before_budget=false · mode=- · focus=- · budget_rule=CX-limit-unknown-r2 · codex_calls_used=0 · codex_switch=on · input_risk=R2(Leader 지정) · remaining_limit_pct=null(stale) | overrides=- | fallback=budget_window_closed | tokens=0
- [2026-10-30 19:47] codex_gate/C2 engine=rules → codex_required=true · mode=review · focus=none · budget=CX-limit-unknown-r2 · codex_switch=on | overrides=CX-r2-post-review | fallback=budget_window_closed | tokens=0
- [20:16] Leader: C2 입력 risk=R2(Leader 지정). Jev 예산 창이 10-25 에 닫혀 규칙 엔진으로 판정(tokens=0). Codex 호출 차수 1/4 — 실행 19:50(`status=done`, 63초, base=f218430 `--base` 인자로 지정: task `base_ref` 가 오래돼 무관한 커밋이 섞이는 것을 막음).

## Developer
- [12:07] **문서 단계 완료(Developer, 읽기 전용)** → [docs/design/2026-10-30-t112-record-ddl-draft.md](../../../docs/design/2026-10-30-t112-record-ddl-draft.md) (566줄). 제안 테이블 3개 `job_run_log`(§9.5 확정안 + 변경 4건 D-a~D-d)·`judgment_run`·`judgment_candidate`(모두 `CREATE TABLE IF NOT EXISTS`·외래키 없음·부팅 DDL 미포함). 기준 판단 기록을 2테이블로 나눈 이유: 1개면 후보 0건 실행이 안 남는다. 기존 `eval_funnel` 은 30일 삭제·판단 필드 없음으로 재사용 안 함.
- [12:07] 불편한 사실(Developer 보고): ① §9.5 대로 `call()` 안에서 POST 하면 08시 틱(최악 290초, 한도 300초)을 넘길 수 있다 [가능성 높음] → 스풀 파일 + 가벼운 틱 일괄 전송 권고 ② §9.5 키·어휘 충돌 3건 → 변경 4건 ③ 기준 판단 기록은 "비차단 호출 1곳"이 아니라 해외 약 12곳·국내 약 8곳 거르기 지점 표시 + 국내 D0·카드 id·실제 모델 미보유 → 모두 훅 감시 경로(`src/lib/strategy/`) 수정 ④ **DDL 문법 미검증**(일회용 MariaDB 없음; 다른 세션의 임시 mysqld 포트 33177 은 남의 자원이라 쓰지 않음) ⑤ `export-llm-trainset` 은 `call()` 을 거치지 않아 후크로 안 잡힘.
- [12:07] Leader 확인: 저장소 변경은 위 문서 1개뿐(Developer 보고), DDL 적용·`scripts/migrations/` 추가·코드·운영 DB 조회 0.
- [17:41] **B 파트 구현 완료(Developer-2 — 판단 기록 추적·기록기·시험)** — 신규 `src/lib/strategy/records/judgment-trace.ts`(메모리 추적, I/O 0·예외 삼킴)·`judgment-recorder.ts`(스위치 `judgment_record_enabled` 키 없음=꺼짐, 헤더 INSERT → 후보 multi-row 1문장, F3 코드포인트 자르기·F5 정규화·중복 제거·errno 판별, 4초 상한, 기다리지 않는 진입점 `recordJudgmentDetached`, 커밋 뒤 `getPool()`). 엔진 2파일은 추적 표시만(국내 +29/−1, 해외 +47/−1 — 본문을 내부 함수로 옮기고 바깥 `try/finally` 에서 기록 시작, 판단 흐름·카드·LLM 호출 불변). 기존 엔진 시험 4파일은 기록기 목 1줄씩만 추가(기대값 불변, 222건 통과).
- [17:41] 구현 해석(Leader·Reviewer 확인 요청): ① 헤더는 세션이 정해진 분석 실행에만 — 국내 주말·해외 스위치/시장 꺼짐·장중·새 세션 없음·진행 중·휴장 표 모름은 `valid_from` 이 없어 헤더 없음(job_run_log 몫), 세션 뒤 503(환율·실적·일봉)·후보 0건은 헤더만 ② 국내 D0 = 조회한 일봉 마지막 봉 날짜 중 가장 늦은 날(봉 0개면 NULL — 실행 날짜로 채우지 않음) ③ 국내는 같은 종목 결정이 여럿 올 수 있어 첫 결정을 남기되 뒤 결정이 카드를 새로 만들면(created·blocked) 그것으로 ④ 국내 응답 해석 실패는 엔진이 빈 목록으로 삼키지만 기록은 `llm_error`(엔진과 같은 해석 규칙을 추적에 복제) ⑤ `llm_model` 설정 기준: claude=CLI 기본 `sonnet`(원본 대조 시험), home-m4-api=`homeM4ApiModel`, hybrid=`stage1Model` ⑥ 헤더·후보 2문장은 트랜잭션이 아님 — 후보 INSERT 실패 시 헤더만 남고 결과 `partial`.
- [17:41] 검증: tsc 0 · jest 7 스위트 330 통과(엔진 4 + 신규 trace·recorder·engine-wiring) · 일회용 MariaDB 10.11(strict, 컨테이너 `t112-impl-b`·127.0.0.1:33114, Developer-1 마이그레이션 파일 2회 적용) 6/6, 컨테이너 제거 확인 · 변이 20/20 검출(샌드박스 사본, 원본 sha256 복원 확인 후 샌드박스 삭제). 운영 DB·`.env`·KIS·LLM·pm2·스위치 접근 0, 커밋·push 없음.
- [17:41] 발견(Developer-1 영역 — 고치지 않음): `src/lib/corp-intel/__tests__/isolation.test.ts` 2건 실패 — `records/record-switch.ts` 주석의 corp-intel 언급, `records/job-slots.ts`(+시험)의 holdings-premarket 문자열이 그 시험의 허용 목록 밖으로 잡힌다.
- [18:38] **A 파트 구현 완료(Developer-1 — 공용 헬퍼·마이그레이션 SQL·`job_run_log` 기록기·라우트·러너 후크/스풀·시험)** — 신규 `src/lib/strategy/records/safe-text.ts`(코드포인트 자르기·짝 없는 서로게이트 U+FFFD·`normalizeSymbol`·`dedupeBy`·errno 4025/1146·`withDeadline`/`withDeadlineSafe`)·`record-switch.ts`(`readRecordSwitch` 키 없음=꺼짐·2초·30초 캐시 + `readRecordSwitchState` 출처 구분)·`job-slots.ts`(J8 현행 하드코딩 표 52잡)·`job-run-log.ts`(스풀 줄 v1 해석·§2.3 분류기·b′ ODKU·롤업 가산 ODKU·클램프·2.5초 상한, 던지지 않음)·`src/app/api/cron/job-run-log/route.ts`(x-cron-secret·1MiB/500줄 413·실패 503)·`scripts/migrations/T-112-run-judgment-record.sql`(미적용)·`scripts/test-cron-runner-job-run-log.sh`. `scripts/cron-runner.sh` +110/−0(블록 `job-run-log-spool` + `# T-112 jrl` 표지 4줄).
- [18:38] 문서와 다르게 한 곳(Reviewer 확인 요청): ① b′ 에 `degraded_reason` 도 같은 조건으로 넣음(§10.6.1 식에는 없음 — 재시도 성공 뒤 실패 사유가 남지 않게) ② curl 종료코드 미기록(`HTTP=000` 만 — `call()` 의 `|| code="000"` 줄을 고쳐야 얻을 수 있어 삭제 줄 0 원칙으로 포기) ③ 스위치를 **읽지 못하면**(DB 오류·시간 초과) 503 으로 답해 러너가 스풀을 남김 — 키 없음·false 만 200 skipped(비움) ④ 마이그레이션 = 머리 주석(문서 블록 첫머리 “초안·이 문서 단계” 주석을 다시 씀) + `SET SESSION lock_wait_timeout = 5` + 문서 CREATE 3개·열 주석·되돌리기 주석 **한 글자도 같음**(문서 DDL 재추출 sha256 `b3eb31eb…f9c3` 일치 = 문서 불변, CREATE~DROP 본문 sha256 양쪽 `23fe09de…1975`, 주석·빈 줄 뺀 문장 sha256 양쪽 `ede6fbee…7864`) ⑤ 앱 쓰기는 `pool.query`(이 앱 관례) — 세션에 NO_BACKSLASH_ESCAPES 가 있으면 클라이언트 이스케이프가 깨지므로 F8 의 운영 `@@GLOBAL.sql_mode` 확인에 NBE 없음도 함께 볼 것.
- [18:38] 기존 러너 시험 6개 정교화(T-117·T-119 선례, **기대값 불변**): 가짜 curl 이 `/api/cron/job-run-log`(틱 끝 전송, call() 밖)를 호출·--max-time 목록·시계에 넣지 않고 200 으로 답하게 3줄(6개 모두) + 정적 비교에서 새 러너의 T-112 블록·표지 줄을 빼는 `no_jrl`(news-peek·daily-bars·news-split·holdings-premarket, 각 +10/−3). 근거: 후크가 켜져도 다른 호출이 같다는 것은 새 시험 J1 이 하루 1440틱 “후크 켜짐 = 기준 러너(f218430) = 후크 꺼짐”(호출 5099건·stdout·하트비트·날짜파일 37개 동일)로 따로 증명한다.
- [18:38] 검증: tsc 0 · jest 7스위트 153 통과(내 6 + broker-fills `cron-runner-block`의 “HEAD 대비 추가만”) · 러너 시험 7종 512 통과(job-run-log 80·news-peek 81·daily-bars 81·news-split 119·holdings-premarket 53·pmo-retry 76·stop-alert 22) · 일회용 MariaDB 10.11.19(`t112-impl-a`, 127.0.0.1:33113, strict·utf8mb3 서버) 27/27 — 2회 적용 멱등·b′ 6단계 1,1,2,2,2,3·NULL 회복·NULL 위 NULL 가짜 시각 없음·롤업 가산·UNIQUE 공존·클램프(129자 1406)·errno 4025/1146·끝에서 끝, 두 sql_mode. 컨테이너 `docker rm -fv` 제거 확인 · 변이: TS 11/11 검출(원본 sha256 복원 확인) · 러너 사본 7개 중 6 검출, **`|| true`(호출 자리) 제거는 검출 불가 — 동치 변이**(`set -e` 없음·후크는 항상 0 반환·call() 반환은 마지막 rm) · 실측: 후크 1회 2.6ms(본문 없음)~3.7ms(본문 2KB), 08시 최악 틱 290초 → 약 290.04초.
- [18:38] 🔴 막힘(Leader 결정 필요 — 내 소유 밖 파일): `src/lib/corp-intel/__tests__/isolation.test.ts` 의 「(T-119) holdings-premarket 상수·키를 쓰는 src 파일」 1건 실패 — `job-slots.ts`(잡 라벨 `holdings-premarket` 1곳)·`job-slots.test.ts`·`job-run-log-disposable-mariadb.test.ts` 가 걸린다(import 없음, 러너 라벨 문자열뿐). 권고: 그 시험 허용 목록에 `lib/strategy/records/job-slots.ts` 와 `lib/strategy/records/__tests__/` 를 더하거나 정규식을 키(`holdings_premarket_`)·모듈 경로로 좁힌다. 라벨 문자열을 쪼개 시험을 피하는 것은 하지 않았다. Developer-2 가 지적한 `record-switch.ts` 주석의 corp-intel 언급은 고쳤다(그 시험 다른 항목 통과).
- [18:38] 운영 접근 0: 운영 DB·`.env`·`@/lib/db` 풀·KIS·M4·SEC·LLM·pm2·스위치 변경 없음, 커밋·push 없음, DDL 미적용.

## Reviewer
- [19:45] **Reviewer(독립 감사) 착수** — 범위: 이 worktree(HEAD f218430 위 미커밋 변경) 전체 diff. 읽은 것: 러너 후크/스풀 블록·`call()`·틱 시작/끝(`scripts/cron-runner.sh`), `src/lib/strategy/records/**` 소스 6개(전수), 라우트(전수), 엔진 2개 diff(추적 호출 위치 전수)와 엔진 시험 4개 diff, 마이그레이션 SQL(전수), 기존 러너 시험 6개 diff, 격리 시험 diff. records 시험 11개와 라우트 시험은 줄 단위 전수가 아니라 이름·핵심 구간을 읽고 실행·변이로 감도를 확인했다. 화면 변경 없음(demo_gate 해당 없음 — `src/app` 의 화면 파일 변경 0). Codex(C2) 검토는 이 판정 시점에 task 이력서에 없음 → 도착하면 채택/오탐/범위 밖을 이어서 기록한다.
- [19:45] **직접 실행한 확인(전부 읽기·일회용 환경, 운영 접근 0)** — ① Leader 로그: 전체 tsc 종료코드 0 · 전체 jest 315 스위트 통과(8,760 통과/178 건너뜀) ② 새 러너 시험 `test-cron-runner-job-run-log.sh` **80/80** ③ 기존 러너 시험 6개를 내가 다시 돌림(`flock` 직렬) — pmo-retry 76/76 · stop-alert 22/22 · news-peek 81/81 · daily-bars 81/81 · news-split 119/119 · holdings-premarket 53/53 (새 시험 80 과 합쳐 512 = Developer 보고와 일치) ④ 내 일회용 MariaDB 10.11(`t112-rev-a`, 127.0.0.1 전용, 끝나면 `docker rm -fv`)에서 `job-run-log-disposable-mariadb` **27/27** · `judgment-disposable-mariadb` **6/6**(운영 DB 10.11.11 과 같은 계열) ⑤ 마이그레이션의 CREATE 3개를 설계 문서 DDL 블록과 주석 제거·공백 정규화 후 직접 대조 → 3개 모두 일치 ⑥ 러너가 기준(f218430)에서 지운 줄 0(diff 로 직접 셈), `bash -n` 통과 ⑦ 후크 1회 비용 실측 약 6.4ms(2KB 본문) → 08시 최악 틱 약 290.1초(한도 300초, 여유 약 9.9초)
- [19:45] **우선순위 1 — 본 기능을 해치는가: 해치지 않는다고 본다 [확실]** 근거: (a) 러너 후크는 로컬 파일 덧붙이기뿐(네트워크 없음), 호출 자리 `|| true`, `code`·`CALL_LAST_CODE`·본문 파일·`call()` 반환값(마지막 rm)을 바꾸지 않는다. 변이로 직접 확인: 후크가 `CALL_LAST_CODE=200` 을 쓰게 하면 새 러너 시험 J7 이 5건 실패(해외 분석 재시도 3회가 1회로 줄어든다), 전송 상한 150초를 9999 로 바꾸면 J3 이 5건 실패(최악 틱 간격 290→293초). (b) `|| true` 제거 변이가 검출 불가인 것은 **동치 변이**다 — 러너에 `set -e`·`trap ERR` 가 없고(grep 확인) `jrl_hook` 은 모든 경로에서 0 을 돌려준다. 오늘은 무해하고, 나중에 `set -e` 가 들어오면 그때부터 의미가 생기는 방어선이다(그 경우 `jrl_t0=$(…)` 줄과 `JRL_TICK_T0=$(…)` 줄은 보호가 없다는 점만 기억). (c) 하트비트: 전송 틱 최대 150+3+60≈213초, 무거운 틱은 전송 없이 접기만(수 ms) → 08시 최악 약 290.1초 < 300초. R1(Reviewer 시간 여유 재확인) 충족. (d) 엔진: 추가된 `await` 는 자기 분석 본문(`return await runPostMarketDomestic`·`return await runPostMarketOverseasTraced`)뿐이고 기록기 호출은 `finally` 안 비동기 시작만(기다리지 않음). 추적 메서드는 전부 `guard` 로 예외를 삼키며, 변이로 `guard` 가 다시 던지게 하면 단위·엔진 시험 4건이 실패한다. 영향 0 시험은 반환값·카드 INSERT 인자·LLM/RAG 인자·관문 호출·로그를 `기록기 없음` 기준과 비교하고 기록기 스위치 키 없음/테이블 없음/INSERT 멈춤/스위치 읽기 멈춤/카드 id 조회 실패/후보 INSERT 실패/진입점 예외 8가지를 돌린다.
- [19:45] **우선순위 2 — 매매·안전장치 영향: 없다 [확실]** 기록 모듈이 쓰는 테이블은 `job_run_log`·`judgment_run`·`judgment_candidate` 3개뿐이고(INSERT 문 전수 확인) `system_config` 는 읽기만 한다. `submitOrder`·시그널 생성·주문·거래소·safety 모듈을 import 하지 않는다(import 전수 확인). 키 없음=꺼짐·테이블 없음=조용히 건너뜀은 내가 일회용 DB 에서 직접 확인(F1·F4·A·B). 엔진 diff 는 추적 호출 추가만이고 판단 분기(`confidence < 60` 등)의 원래 문장은 그대로다. 마이그레이션은 앱 부팅 DDL 에 없고 `deploy.yml` 에 migrate 가 없어 배포로 적용되지 않는다. **단, "배포만으로 영향 0" 은 데이터 기준에서만 맞다** — 러너 후크는 앱 스위치와 무관하게 켜져서 호출마다 스풀에 쓰고 틱 끝마다 POST 1회(≤3초, 경과 150초 미만 틱만)를 한다. 끄려면 러너를 `JRL_SPOOL_FILE=` 로 재시작하거나 코드를 되돌려야 한다(스위치 off 는 DB 쓰기만 멈춘다). 배포·롤백 기록에 이 사실을 적을 것.
- [19:45] **우선순위 3·4 — SQL·라우트: 결함 없음, Minor 3건** 직접 확인: ODKU b′(IFNULL 비교·`ended_at` 대입 마지막·`degraded_reason` 추가)는 내 일회용 DB 에서 attempt 1,1,2,2,2,3 · 늦은 줄 무시 · NULL 위 NULL 가짜 시각 없음이 맞고, 변이 3개(`attempt` 가드 제거·maxMs GREATEST→LEAST·ended_at GREATEST→LEAST)는 각각 8·4·2건 실패로 잡힌다. 코드포인트 자르기(UTF-16 slice 변이 4건 실패)·심볼 정규화(대문자 제거 변이 5건)·errno 판별(code 문자열 변이 2건·1146 항상 false 변이 3건)·스위치(키 없음=켜짐 변이 4건·읽기 오류=켜짐 변이 5건·아무 문자열이나 켜짐 변이 11건)도 시험이 잡는다. 라우트: `checkCronAuth`(미설정이어도 거부)·미들웨어 `/api/cron/` 시크릿·본문 1MiB/500줄 413·스위치 읽기 실패 503(스풀 보존) vs 키 없음/false 200 skipped, 공개 경로 목록 변경 없음(middleware.ts diff 0). 응답에는 건수·분류어뿐이고 원문 오류는 로그에만.
- [19:45] **Minor-1 [확실] 롤업 ODKU 의 failed 분기 시험이 비어 있다** `job-run-log.ts:522` 의 `>=` 를 `>` 로 바꾼 사본에서 단위+일회용 DB 73건이 전부 통과했다. C2 의 "모두 실패 → failed" 는 첫 INSERT(JS 계산)에서 나오고, 이미 있는 정시 행에 failed 배치를 더해 failed 가 되는 ODKU 경로는 아무 시험도 밟지 않는다. 영향: 롤업 행 status 표시 오류를 못 잡는다(롤업은 가동률 분모에서 제외라 지표 영향 낮음). 권고: C2 에 "failed 2건 → failed 배치 1건 더 → status failed" 한 케이스 추가(약 5줄). (status 와 counts 대입 순서를 바꾼 변이는 결과가 수학적으로 같아 검출 불가가 맞다 — Developer 주석 "어느 순서든 같은 결과"가 정확하다.)
- [19:45] **Minor-2 [확실] 롤업 `runs` 가 두 배가 되는 트리거가 문서보다 흔하다** 문서는 "커밋 뒤 응답이 curl 3초 안에 못 감"만 말한다. 그런데 서버 쪽 처리 상한 2.5초(`job-run-log.ts:627`)가 지나면 라우트는 503(timeout)으로 답하고 `work()` 는 계속 돌아 나중에 커밋된다 → 러너가 같은 줄을 다시 보내 롤업 runs·failed 가 두 배. NAS DB 가 느린 구간에 몰릴 것이다. 실행 행(runner_hook)은 ODKU 로 무해. 권고: 한계 문구에 이 트리거를 더하고, T-108 계약에 "롤업 runs 는 정확한 횟수가 아니라 근사"를 명시(E2 가 이미 롤업을 분모에서 뺐으므로 지표 영향 없음).
- [19:45] **Minor-3 [확실, 조건부] `NO_BACKSLASH_ESCAPES` 이면 `ai_reasoning` 으로 SQL 이 주입된다** `pool.query`(클라이언트 이스케이프) 값 바인딩은 세션 sql_mode 에 NO_BACKSLASH_ESCAPES 가 있으면 깨진다. 일회용 MariaDB 에서 재현: 같은 payload(`\'), (7, CHAR(65,66)) -- `)가 기본 모드에서는 문자열로 저장되고 NBE 세션에서는 행 `(7,'AB')` 가 따로 생기며 뒤 행이 사라진다. `job_run_log` 쪽은 바인딩 값이 전부 정규식·고정 표·숫자라 안전(자유 텍스트 없음). 위험한 곳은 `judgment_candidate.ai_reasoning`(LLM 자유 텍스트, 뉴스 같은 외부 데이터에 영향받음). 이 패턴은 앱 전체에 이미 있어 T-112 가 새로 만든 종류는 아니지만 **새 LLM 텍스트 출구**가 생긴다. 운영 `@@GLOBAL.sql_mode` 는 **미확인**(F8 이 이미 조회를 계획 — 거기에 "NO_BACKSLASH_ESCAPES 없음"을 통과 조건으로 못박을 것). 권고: 스위치 `judgment_record_enabled` 를 켜기 전 확인, NBE 가 있으면 켜지 말거나 후보 INSERT 를 `execute`(준비문)로 바꾼다.
- [19:45] **Info(결함 아님, 기록용)** ① 스풀 파일: 응답 본문 앞 2KB(base64)가 umask 권한(664)으로 로컬 디스크에 잠시 남는다(권한은 러너의 umask 를 따르며 이 계정 기본은 664 — 같은 계정 단일 사용자 서버라 영향 낮음). 크기 상한은 `.sending` 에만 있고 `.sending` 에 못 쓰는 고장(권한·읽기전용)에서는 새 줄 쪽이 무한히 자란다 → 선택 개선: 스풀 생성 때 `umask 077`. ② 개발 서버가 같은 DB 를 보므로 개발에서 장마감 분석을 수동 실행하고 스위치가 켜져 있으면 baseline 행이 섞인다 — `engine_release` 가 NULL(릴리스 디렉터리 밖)이라 구분 가능하니 T-108 집계는 `engine_release IS NOT NULL` 로 거를 것. ③ 헤더·후보가 트랜잭션이 아니라 후보만 실패하면 헤더만 남는다(결과 partial) → 소비 쪽은 `candidate_count` 와 후보 행 수가 다르면 불완전 기록으로 취급. ④ 국내 응답 해석 규칙 복제(`domesticLlmResponseReadable`)는 엔진 `parseAiResponse` 가 바뀌면 어긋날 수 있다(동적 대조 시험이 있어 현재는 일치). ⑤ DB 의존 시험(ODKU·errno·CHECK)은 env 가 있을 때만 돌고 기본 jest 에서는 건너뛴다 → QA/배포 전에 일회용 DB env 로 반드시 실행(내가 위에서 27/27·6/6 확인).
- [19:45] **Developer 의 확인 요청 답** A-①(b′ 에 `degraded_reason` 추가) 타당·수용 / A-②(curl 종료코드 미기록) 수용 / A-③(스위치를 읽지 못하면 503) 코드·시험으로 확인, 수용 / A-④(마이그레이션=문서 DDL 그대로) 내가 독립 대조해 일치 확인 / A-⑤ = Minor-3. B-①~⑥(헤더는 세션 확정 실행만, 국내 D0=마지막 봉 날짜 최댓값, 중복 결정 규칙, 해석 실패 복제, 설정 기준 모델, 비트랜잭션)은 모두 수용(④·⑥ 은 위 Info).
- [19:45] **격리 가드 완화(`isolation.test.ts`) — 타당하다 [확실]** 정규식 `HP_LABEL_FILES` 는 `^…$` 로 정확히 3개 파일만 허용하고, 추가 확인 1줄이 그 3파일에 `holdings_premarket_`·`corp-intel` 이 들어오면 실패시킨다. 내 변이 4개 전부 실패로 잡힌다: 이름표 파일에 설정 키 추가 / 허용 밖 새 파일에 이름 문자열 / 이름표 파일에 corp-intel 언급(이때 별개 시험 1건도 같이 실패) / 허용 파일과 비슷한 이름(`job-slots2.ts`). 더 나은 대안은 찾지 못했다(데이터를 `.json` 으로 빼면 검사 대상 확장자 밖이라 가드를 피하는 것이 되므로 오히려 나쁘다).
- [19:45] **기존 러너 시험 6개 수정 = 기대값 불변 [확실]** diff 전수 확인: 가짜 curl 이 `/api/cron/job-run-log` 에 200 을 돌려주는 3줄(6개 모두, 호출·max-time 목록과 시계에 넣기 전에 반환) + 정적 비교에서 새 후크 블록·표지 줄을 빼는 `no_jrl`(news-peek·daily-bars·news-split·holdings-premarket). 비교 기준 쪽은 그대로다. `HOME` 은 모두 임시 디렉터리라 시험이 실제 스풀을 더럽히지 않는다. 표지 줄로 위장한 변경이 정적 비교를 빠져나갈 수 있다는 우려는 새 시험 J8(기준 러너의 모든 줄이 순서대로 남음·표지 줄 4개의 위치·call() 에서 표지 2줄을 빼면 기준과 같음)이 막는다.
- [19:45] **확인하지 못한 것(통과로 표현하지 않는다)** 운영 `@@GLOBAL.sql_mode`·운영에서 실제 Next 서버 curl(`/api/cron/job-run-log` 실호출)·`next build`·실제 pm2 러너 환경변수(`JRL_SPOOL_FILE` 미설정 가정)·운영 NAS 부하에서의 후크 시간·Codex C2 결과. 이 판정은 DDL 적용·스위치 켜기·push/배포를 승인하지 않는다(각각 사용자 건별 게이트).
- [19:45] **QA 인계(high_risk_areas)** `scripts/cron-runner.sh`(call() 후크 59·72행, 스풀 블록 163-261행, 틱 시작 322행, 틱 끝 flush 648행) · `src/lib/strategy/records/job-run-log.ts`(ODKU 504-528, recordSpoolBatch 595-633) · `src/lib/strategy/records/judgment-recorder.ts`(write 293-355, 진입점 381-392) · `src/lib/strategy/post-market-engine.ts`(감싸기 453-470)·`post-market-overseas.ts`(감싸기 450-458) · `src/app/api/cron/job-run-log/route.ts` · 일회용 DB env 시험 2종 직접 실행 · 켜기 전 순서 DDL → 배포 → `job_run_log_enabled` 먼저 → 관찰 → `judgment_record_enabled`.
- [19:45] **집계 — Critical 0 · Major 0 · Minor 3 (+ Info 5)**. 커밋을 막는 조건은 없다. 아래는 막지 않는 후속(담당: Leader 가 건별 배정): ⓐ Minor-1 시험 한 케이스 추가(Developer, 커밋 전 권장) ⓑ Minor-3 — DDL 적용 직전 F8 조회에서 `NO_BACKSLASH_ESCAPES` 없음을 통과 조건으로 하고, 있으면 `judgment_record_enabled` 를 켜지 않는다(Leader, 사용자 승인 게이트에 포함) ⓒ Minor-2·Info ①~③ 은 배포 기록·T-108 계약 문구에 반영(Leader). 이 판정은 코드 감사의 결과이며 DDL 적용·스위치 켜기·push/배포·실매매 권한을 승인하지 않는다.
- [19:57] **Codex C2 지적(1건, medium) 판정 = 부분 채택. 심각도는 Low(Minor-4)로 낮추고, 이번 배포를 막지 않는다 — 후속 task 로 분리 가능.** 불편한 사실 먼저: 지적의 사실 부분은 맞다 [확실]. 후크가 켜지면 스풀에 portfolio-snapshot(`totalKRW`·`cash.KRW`·`cash.USD`, 매시 1회)과 trade-report(`headerPnlKRW`·`lifoPnlKRW`, 보고서를 보낸 호출에서만 전체 본문)의 본문이 base64(비식별화 아님)로 들어가고, 운영 러너의 umask 가 0022 라 스풀은 644 로 생긴다(하트비트 파일이 -rw-r--r-- 인 것과 같다). 내 앞 판정의 Info ① 은 "본문 2KB"만 적고 금액을 싣는 라벨 2개를 짚지 못했다 — 구체화는 Codex 가 옳다. 다만 "새 노출"로서는 작다(아래).
- [19:57] **근거(직접 확인, 운영 호출 0 — 라우트 소스와 서버 파일 상태만 읽음).** ① 사실: 러너 `call` 24곳을 응답 리터럴까지 전수 확인했다 — 금액·잔액·손익을 싣는 라벨은 portfolio-snapshot 과 trade-report 둘뿐 [확실]. entry-watcher·holding-checker·stop-alert 는 200 이면 본문 생략·non-200 은 `{ok:false,error}`, research-cycle 은 건수+`failures[].symbol`(유니버스 종목), broker-fills 는 `publicJob` 의 건수·분류어, 나머지는 건수·분류어. strategy-eval `results[]` 는 끝까지 읽지 않았다 [추측: 후보 종목 수준이고 잔액은 아님]. ② 이미 있던 노출 [확실]: `call()` 은 매 호출의 응답 **전체**를 `/tmp/cron-runner-$$.out` 에 쓴다. 운영 러너(pid 3568250)의 umask 는 0022 이고 같은 umask 에서 curl `-o` 파일이 644 로 생기는 것을 재현했다. `/tmp` 는 1777 이라 다른 로컬 사용자(m1·oracle·guest-odinue)가 호출 중에 읽을 수 있고, 러너가 호출 도중 죽으면 마지막 본문이 남는다. pm2 로그에는 non-200 본문 앞 200바이트만 찍히며 이 두 라벨의 non-200 본문은 오류 문구뿐이다. 같은 금액은 DB `portfolio_snapshots`·텔레그램·화면에도 이미 있다. 스풀이 새로 만드는 것은 파일 1개와 지속 시간(정상 약 60초, 라우트 장애 때는 장애 기간만큼 — 상한 2MiB)뿐이다. ③ 권한 [확실]: `~/.node-local/stockinvest/` 는 775 지만 상위 `/home/brownjeon` 이 750(소유자·그룹 brownjeon, 그룹 구성원은 brownjeon 뿐)이라 다른 로그인 사용자 3명은 경로에 들어갈 수 없다 — 파일이 644 여도 읽을 수 없다. 읽을 수 있는 쪽은 brownjeon 계정(이미 `.env` 의 DB·KIS 키를 가짐)과 root 이며 같은 값을 DB 에서 이미 읽을 수 있다. 전송은 `localhost:3003` 루프백이다. ④ 서버 쪽 DB [확실]: `job-run-log.ts` 에 본문 원문을 저장하는 곳이 없다 — `counts_json` 은 허용 키(`fetched/new/processed/evaluated…`)의 숫자만(두 라벨은 해당 키가 없어 NULL), `error_code`·`degraded_reason` 은 `codeWord` 정규식을 통과한 분류어만이고, 금액 키 이름 참조는 0건(grep). 금액이 DB 로 가는 경로는 없다.
- [19:57] **배포 전 수정 vs 후속.** 후속으로 가능하다. "후속" 쪽의 구체적 위험 = 후크가 켜지는 순간부터(스위치와 무관) brownjeon 계정과 root 만 읽을 수 있는 스풀에 매시 총자산·현금이, 정상이면 약 60초, 앱·라우트 장애가 길면 그 기간(하루 약 24줄씩)만큼 평문 base64 로 남는다. 읽는 쪽 권한은 넓어지지 않는다. 계정이 `~/.node-local` 을 통째로 백업한다면 사본이 생길 수 있는데 그 여부는 미확인이다 [추측]. 자금 손실·본 기능·타 사용자 노출 경로가 없으므로 배포를 막을 근거가 아니다.
- [19:57] **최소 수정안(후속 task).** (가) 두 라벨을 본문 생략 목록(`b64_skip`)에 더하는 방식은 권하지 않는다 — portfolio-snapshot 은 200 본문의 `skipped`(현금 보류·`balances_incomplete`·`markets_closed`)로 상태를 가르는 비롤업 잡(실행마다 1줄)이라 본문을 빼면 그 상태가 전부 `ok` 로 기록돼 T-108 이 원하는 정보를 잃는다(`classifyRun` 의 `typeof b.skipped === 'string'` 분기). trade-report 는 롤업(실패만 센다)이라 잃는 것이 200+`ok:false`(channel_invalid) 정도로 작다. 어느 쪽이든 `job-slots.ts` 의 `bodyOmittedOnOk` 와 러너 case 목록을 함께 바꿔야 하고(`job-slots.test` 의 "본문 생략 목록 = 표" 가 강제), 새 러너 시험 J1·J5 의 "본문 칸이 빈 매 분 잡 3개" 기대값도 바뀐다. **권고안 = 금액 값 마스킹**: `jrl_hook` 에서 이 두 라벨만 base64 전에 `sed -E 's/"(totalKRW|KRW|USD|headerPnlKRW|lifoPnlKRW)":-?[0-9.]+/"\1":0/g'` 로 값을 0 으로 바꾼다(두 본문 모두 2KB 안). `ok`·`skipped`·`partial` 신호가 그대로라 `classifyRun`·슬롯 표·`job-slots.test` 변경이 0 이다. (나) 0600: 후크·flush 안에서만 — `jrl_hook` 시작에 `local um; um=$(umask); umask 077` 하고 끝에 복원, `jrl_flush` 는 `return 0` 이 여러 곳이라 본문을 `_jrl_flush_body` 로 두고 얇은 래퍼가 umask 저장→본문 호출→복원한다(블록이 새 코드라 이름 변경은 "기준 러너 줄 삭제 0" 에 걸리지 않는다). 서브셸 `( umask 077; jrl_flush )` 는 쓰지 않는다 — `JRL_FAILING`(전송 실패 로그를 한 번만 내는 상태)이 서브셸에서 사라져 매 분 실패 로그가 찍힌다. 디렉터리를 0700 으로 바꾸는 것도 하지 않는다 — 하트비트·날짜파일과 같은 디렉터리라 T-037 워치독·순찰의 읽기에 영향을 줄 수 있고, 상위 750 이 이미 막는다. umask 를 러너 전체에 거는 것은 하트비트·날짜파일 권한을 바꾸므로 금지.
- [19:57] **재시험 범위·시간(수정할 경우).** 새 러너 시험 `test-cron-runner-job-run-log.sh`(약 11분; J5 에 "금액 값 0 마스킹·`ok`/`skipped` 키 보존", 새 케이스 "umask 022 에서 스풀·`.sending`·`.batch` 모두 600" 추가) + `job-slots.test`(수 초, 마스킹 방식이면 변경 0) + 기존 러너 시험 6종(오늘 직렬 실측 합계 약 40분; 수정이 블록 안이라 정적 비교는 그대로지만 동작 회귀 확인) + Reviewer 재순환 + QA. 합계 1시간 반 이상이라 오늘 20:50 창에 들어가지 않는다. 집계 갱신: Critical 0 · Major 0 · Minor 4(Minor-4 = 이 지적, Low) · Info 5. 이 처리는 앞 판정을 바꾸지 않는다 — 후속 task 번호·담당은 Leader 가 배정하고, 배포 기록에 "후크 활성 순간부터 스풀에 매시 총자산·현금 본문(644, 상위 디렉터리 750)이 생긴다"를 적을 것.
- [19:57] **최종 판정: PASS (scope: src/lib/strategy/records/, src/app/api/cron/job-run-log/, src/lib/strategy/post-market-engine.ts, src/lib/strategy/post-market-overseas.ts, src/lib/strategy/__tests__/post-market-domestic-golden.test.ts, src/lib/strategy/__tests__/post-market-engine.test.ts, src/lib/strategy/__tests__/post-market-overseas.test.ts, src/lib/strategy/__tests__/post-market-validation-gate.test.ts, scripts/cron-runner.sh, scripts/migrations/T-112-run-judgment-record.sql, src/lib/corp-intel/__tests__/isolation.test.ts)**

## QA
- [19:52] **QA 재현 조건**: 서버 격리 worktree `/home/brownjeon/.node-local/stockinvest-t112` (HEAD f218430 + 미커밋 변경). 무거운 시험은 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10` 직렬, 로그 `~/.node-local/t112-logs/qa-*.log`. 운영 DB·`.env`·pm2·KIS·M4·LLM·스위치 접근 없음. 커밋·push·DDL 적용·worktree 소스 수정 없음. [확실]
- [19:55] **러너 시험 `scripts/test-cron-runner-job-run-log.sh` — 실행 80건, 80 통과, 실패 0, 종료 0** [확실] (`qa-runner-job-run-log.log`)
- [20:12] **records jest (Leader 지정 7개 경로) — 실행: 14 스위트 통과, 1 스위트 건너뜀(일회용 DB env 없음). 테스트 487 통과, 실패 0, 건너뜀 29, 종료 0** [확실] (`qa-jest-records.log`). 건너뛴 DB 시험은 아래 두 줄로 따로 돌렸다.
- [19:58] **일회용 MariaDB 10.11.19, strict — 33/33 통과, 건너뜀 0** [확실]: `job-run-log-disposable-mariadb` 27건 + `judgment-disposable-mariadb` 6건. sql_mode 는 Leader 가 적은 운영 값 `STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION` 을 썼다(헤더 명령의 IGNORE_SPACE 는 뺐다 — 헤더 문서와 다르다). (`qa-db-strict.log`)
- [20:12] **비strict 대조 (서버 `sql_mode=NO_ENGINE_SUBSTITUTION`) — 29/33 통과, 4건 실패** [확실]: A0 두 건(strict 포함을 단언), 판단 기록 "sql_mode 가 strict 다" 한 건, D2(129자 1406 거부) 한 건. 전부 strict 를 가정한 단언이라 시험이 모드 변화를 잡는다는 것만 확인했다. 코드 결함으로 세지 않는다. (`qa-db-nonstrict.log`)
- [19:52] **마이그레이션 `scripts/migrations/T-112-run-judgment-record.sql` 을 빈 DB 에 2회 적용** [확실]: 두 번 모두 종료 0, stderr 0줄. 테이블 3개(`job_run_log`·`judgment_run`·`judgment_candidate`), 정렬 `utf8mb4_general_ci`. `information_schema` CHECK 13개 = 이름 붙은 `chk_*` 10개 + JSON 열의 자동 json_valid 3개(`counts_json`·`rag_context_ids`·`data_status`).
- [20:01] **라우트 종단 (`next dev` 127.0.0.1:3977, 일회용 DB 만, `DRY_RUN=true`·`KILL_SWITCH=true`·`CRON_WATCHDOG_ENABLED=false`)** [확실]:
  - ① 시크릿 없음 → 401, 틀린 시크릿 → 401
  - ② 스위치 키 없음 → 200 `skipped_disabled`, 행 0
  - ③ 스위치 켬 + 테이블 없음 → 200 `skipped_no_table`
  - ④ 스위치 켬 + 테이블 있음 → 200 `ok`, runRows 1, 행 1
  - ⑤ 본문 1MiB 초과 → 413 `payload_too_large`, 501줄 → 413 `too_many_lines`
  - ⑥ 무인증 차단: 시크릿 없는 요청이 `x-cron-secret required` 401 로 막혔다. 미들웨어 응답 문구와 같다 [가능성 높음]. 미들웨어만 떼어 본 시험은 아니다.
  - 미확인: 503 경로(스위치 읽기 오류·2.5초 초과), 정확히 500줄 허용 경계, 운영 Next 서버 실호출. 종료 후 개발 서버 중지, `.next` 삭제, 일회용 컨테이너 `docker rm -fv`, 비밀 파일 디렉터리 삭제.
- [19:55~20:12] **기존 러너 시험 6개 — QA 재실행 안 함 (Leader 지시). Reviewer 실행 로그 인용** [확실, 로그 파일 시각 기준]:
  - pmo-retry 76/76 (`reviewer-old-pmo-retry.log`, 18:59)
  - stop-alert 22/22 (`reviewer-old-stop-alert.log`, 18:59)
  - daily-bars 81/81 (`reviewer-old-daily-bars.log`, 19:22)
  - news-split 119/119 (`reviewer-old-news-split.log`, 19:28)
  - holdings-premarket 53/53 (`reviewer-old-holdings-premarket.log`, 19:43)
  - **news-peek: 중단됨.** QA 실행은 P2(이틀 2880틱) 진행 중 20:12 에 Leader 가 중단했고 결과 줄이 없다. 중단 전 결과는 통과로 세지 않는다. Reviewer 인용은 81/81 (`reviewer-old-news-peek.log`, 19:17).
  - 인용 근거: 6개 시험 파일 mtime 17:30~17:31, `scripts/cron-runner.sh` mtime 17:27. 모두 Reviewer 실행보다 앞이라 그 뒤 바뀌지 않았다. 6개 파일 diff 는 가짜 curl 3줄(`/api/cron/job-run-log` 에 200) + 정적 비교의 `no_jrl` 필터 + 해시 비교에서 표지 줄 제외뿐이고, 기대값 문구는 그대로다 [확실].
- [20:14] **실매매 안전장치 체크 — 이 변경은 주문 경로를 건드리지 않는다**: production 파일 기준으로 `records/` 는 주문·거래소 주문 함수(`submitOrder`·`dry-run`·`order-limits`·`createOrder`)를 import 하지 않는다(grep). 엔진 diff 의 새 import 는 `records/judgment-trace`·`records/judgment-recorder` 둘뿐이다. 유일한 매치는 시험 파일 `judgment-engine-wiring.test.ts` 의 시장 데이터 mock(`kis.getCandles`, `validation-gate`)이다. DRY_RUN 회로·Kill Switch·주문 한도·심볼 화이트리스트·주문 감사 로그는 이 변경으로 바뀌는 경로가 없어 **실행하지 않았다(주문 회로는 미실행으로 표시)**.
- [20:04] **보안**: 라우트 응답은 건수·분류어만, 원문 오류는 로그에만 간다. 시크릿 값·DB 비밀은 출력하거나 기록하지 않았다. 스풀 디렉터리 `~/.node-local/stockinvest` 권한은 775 다 [확실]. 스풀 파일 권한과 본문 민감도(금액이 base64 로 들어감)는 **미확인**(Reviewer·Codex 후속 항목과 같다).
- **미확인·남은 위험 (판정과 별개로 배포 전 확인)**:
  - 운영 `@@GLOBAL.sql_mode` 미확인(F8). NO_BACKSLASH_ESCAPES 가 있으면 판단 기록 스위치를 켜지 않는다. 판단 기록 DB 시험은 NBE 세션을 돌리지 않았다(Reviewer Minor-3 미확인).
  - Reviewer Minor-1(failed 롤업 행에 배치를 더할 때 status) — 대응 시험 케이스 없음(grep 확인: C2 는 첫 INSERT 만). 미반영 상태.
  - Reviewer Minor-2(503 재시도로 롤업 runs 두 배) — T-108 계약 문구 반영은 Leader 담당.
  - 운영 Next 서버·`next build`·운영 NAS 부하에서의 후크 시간은 미확인.
- **배포 후 확인 체크리스트 (deployer 용, 읽기 전용)**:
  1. 헬스 확인: `/api/health` 정상 (URL 은 배포 절차서 기준)
  2. `pm2 list`: `stockinvest`·`stockinvest-cron` 각각 정확히 1개
  3. cron 로그: 하트비트 이상 없음, 틱 끝 `[cron/job-run-log]` 오류 없음
  4. 스풀 `~/.node-local/stockinvest/job-run-spool`: 틱 한 번 뒤 비워짐(응답 200 이면 지움). 스위치가 꺼진 동안 응답은 `skipped_*`
  5. 스풀 파일 권한 `stat -c '%a %n'` 기록 (본문 금액 포함 가능)
  6. 무인증 `POST /api/cron/job-run-log` → 401
  7. DDL 적용 전: 테이블 없음 → 앱 오류 없음, 새 행 0
  8. 읽기 전용 스위치 확인: `python3 -I ~/.node-local/tools/dbq.py -e "SELECT \`key\`,value FROM system_config WHERE \`key\` IN ('job_run_log_enabled','judgment_record_enabled')"` → 키 없음이어야 한다
  9. DDL 적용 시 (사용자 건별 승인): 적용 전 `SELECT @@GLOBAL.sql_mode` 에 NO_BACKSLASH_ESCAPES 가 없어야 통과. 적용 후 `job_run_log` 0행 (스위치 꺼짐)
  10. 되돌리기: 러너 후크 끄기 = `JRL_SPOOL_FILE=` 로 재시작 또는 코드 되돌림. 스위치 off 는 DB 쓰기만 멈춘다(Reviewer 기록)
  - QA 는 배포하지 않았다. deployer 는 DDL 을 실행하지 않는다. 마이그레이션은 별도 승인 대상이다.
- [20:14] **QA 판정: PASS** — 조건: 판단 기록 스위치를 켜기 전 운영 sql_mode 확인(NO_BACKSLASH_ESCAPES 없음). 미확인 항목은 위 목록. 실행한 항목은 전부 통과했고 새 결함은 0건이다. news-peek 은 중단되어 Reviewer 인용으로 대체했다.

## 배포 기록

| 항목 | 값 |
|---|---|
| DDL 적용 | 2026-10-30 20:17 KST, 사용자 승인 원문 "결정사항에서 DDL 적용 승인하며 푸시시점은 바로 진행해줘". `scripts/migrations/T-112-run-judgment-record.sql`(커밋본 sha256 `1b317282273f916c…`, 비주석 파괴적 문장 0)을 `DBQ_ALLOW_WRITE=1` 로 1회 적용. 사전 확인(F8): 대상 테이블 3개 없음 · `@@GLOBAL.sql_mode`=`STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION`(`NO_BACKSLASH_ESCAPES` 없음) · MariaDB 10.11.11 |
| DDL 결과 | `job_run_log`·`judgment_run`·`judgment_candidate` 생성(InnoDB, utf8mb4_general_ci), 행 0·0·0, CHECK 13(`chk_*` 이름 붙은 10 + JSON 유효성 3), 기록 스위치 키 2개 없음(=꺼짐). SHOW CREATE TABLE 전문: 서버 `~/.node-local/t112-logs/ddl/show-create-*.txt` (설계 §2.1·§3.2 DDL 과 열·키·CHECK 일치) |
| push | 2026-10-30 20:17 KST `git push origin main` (`9d087a4..df4b4a2`, 22 커밋 — 코드 변경은 `df4b4a2` 하나, 나머지 21 은 문서·vault·데모) |
| 배포 | webhook → release.sh blue/green, 20:17:45~20:18:57 KST, `RELEASE_RESULT {"status":"ok","release":"20261030-201752-df4b4a2d","sha":"df4b4a2d…","migrated":false}`(DDL 은 배포와 별개로 위에서 적용). 이전 릴리스 `20261030-051343-9d087a4d` |
| 같은 배포에 실린 다른 작업 | 문서·데모뿐 — T-108(데모 v1~v3·지표 계약), T-112 설계 문서, T-117·T-120·T-124·T-125·T-126·T-127 기록, vault 갱신. 런타임 코드 영향 없음 |
| 사후 확인(AI, 읽기 전용) | pm2 `stockinvest` 1개·`stockinvest-cron` **정확히 1개**, 둘 다 새 릴리스 경로·online·restarts 0 / `/api/health` ok·db true·safetyStatus green·`dryRun` true·`killSwitch` false / 안전 설정 4개 불변(`safety_dry_run`=true 09:08:14·`safety_kill_switch`=false 09:08:18·`exit_engine_enabled`=true 09:08:29·`exit_hard_stop_enabled`=false 07-02) · 기록 스위치 키 없음 / 크론 틱 매분 정상(entry-watcher·holding-checker·stop-alert OK, strategy-eval·trade-report OK 20:23), 하트비트 갱신, `job-run-log 전송 실패` 로그 0 / 20:23:20 스풀 `.sending` 파일이 생겼다가 비워짐(후크 활성·전송 200 응답 확인 — 앱이 스위치 꺼짐으로 `skipped_disabled` 응답) / `job_run_log`·`judgment_run` 행 0 |
| 못 한 확인 | 스위치 ON 상태의 실제 기록(아직 꺼짐), 오늘 밤 21:00 holdings-premarket·22:30 미국장 틱과 내일 08:00 해외 분석에서 후크·판단 기록 코드가 본 기능에 영향을 주지 않는지(지켜볼 항목), 운영 라우트 직접 curl(비밀 헤더 필요 — 하지 않음) |
| 롤백 | 1순위 기록 스위치를 끄는 것(키 없음=꺼짐, 지금 상태). 러너 후크까지 끄려면 `JRL_SPOOL_FILE=` 로 러너 재시작 또는 `git revert df4b4a2` 후 push. DDL 은 되돌아가지 않는다(빈 테이블 3개 — 삭제는 `DROP TABLE` 줄 주석, 쌓인 기록과 함께 삭제되므로 사용자 승인 사항) |

> 알림: 러너 후크는 앱 스위치와 무관하게 활성이다 — 배포 순간부터 서버 로컬 스풀(`~/.node-local/stockinvest/job-run-spool`, 644, 상위 디렉터리 750)에 호출 한 줄(응답 앞 2KB base64)이 쌓였다가 틱 끝(경과 150초 미만)에 전송·비워진다. `portfolio-snapshot`(매시)·`trade-report` 응답은 금액 본문을 싣는다 — Reviewer·Codex 판정 Low, 후속 [[T-127-job-run-spool-hardening]].

## 진행 기록
- [2026-10-30 11:45] 접수(Leader). 번호 T-112 는 `ls` 로 비어 있음을 재확인했고 공동 인계서 §11 에 선점 줄을 남겼다. 문서 단계만 — DDL 초안(Developer)·T-108 지표 계약 초안(Analyst) 병렬 시작.
- [12:07] 문서 단계 산출물 2종 도착(DDL 초안·지표 계약 초안) → Leader G-J1 대조 완료(위 「호환 확인 기록」). 사용자 결정 U1~U5 대기. U6 읽기 전용 SELECT 승인 대기(T-108 몫, 미실행).
- [12:22] **사용자 확정**(원문 "권고안 일괄 확정", 질문: 권고안 일괄 확정 + U6 18건 실행): U1~U5 권고안, G-J1 Leader 제안 채택(`engine_release` 1열 가산 포함). DDL 초안을 v1.1 로 갱신했고 계약 §10 에 U6 결과를 붙였다. 문서 결정만 — DDL 문법 미검증·미적용, 구현 단계(Judge C1 → 일회용 DB 시험 → Developer → Reviewer → QA → DDL 적용 승인)는 시작하지 않음.
- [13:44] 열린 범위 질문(Leader): 감사 기간 증거에 **청산 엔진 판단**이 들어가는데(사용자 설명 10-30) 현재 기록은 `eval_funnel` stage 21~29(30일 롤링)와 pm2 로그뿐이다. 이 task 의 기록 대상(`job_run_log`·장마감 분석 판단)에는 포함돼 있지 않다 — 영구 보존이 필요한지, 필요하면 이 task 범위로 넣을지 별도 task 로 둘지는 지표 계약 D1 재확인과 함께 사용자 결정(DDL 초안 v1.1 은 바꾸지 않음).
- [14:45] 청산 판단 영구 보존(지표 계약 D11): Analyst 권고 **(c) 별도 task** — T-112 는 Judge 접수(R2) 전이라 범위 확장이 일정을 밀고 청산 기록은 쓰기 지점·주기가 다르다. 사용자 확정 대기. T-112 DDL v1.1 은 바꾸지 않음.
- [16:16] D11 확정: 청산 판단 영구 보존은 T-112 범위에 넣지 않고 [[T-126-exit-judgment-persistence]](후보)로 분리(사용자 "권고안 확정"). T-112 DDL v1.1 변경 없음.
- [16:37] **구현 단계 착수**(사용자 "다음 작업 진행해줘" — 10-28 결정 ② "기록 먼저"에 따라 다음 작업을 T-112 구현으로 해석). Judge C1 → `codex_required=false`(규칙 엔진 대체 모드에서 C1 은 Jev 의 `design_uncertainty` 답이 있어야 true 이고 R2 강제는 C2 에만 있다 — 판정자 지적). **Leader 결정: C1 Codex 생략**, 설계 위험은 C2 Codex(R2 필수)와 Reviewer 질문 R1~R4 로 받는다. 진행: ① DDL v1.1 일회용 MariaDB 문법·제약 시험(Developer, 컨테이너 `t112-mariadb` 127.0.0.1:33112, 운영 DB 접근 0) ② 구현 분할안(시험 결과 확정 뒤): **A** = 마이그레이션 SQL·기록 라우트·러너 후크/스풀·시험 / **B** = 장마감 분석 2모듈 기록 호출·시험. 기록기 코드는 `src/lib/strategy/records/` 아래에 둔다 — 훅 `SAFETY_PATHS` 의 `^src/lib/strategy/` 접두어가 자동으로 덮어 Reviewer R3(기록기 위치) 가 해결된다. DDL 적용·push·스위치 ON 은 사용자 승인 게이트.
- [17:00] **DDL 일회용 시험 완료**(Developer; 90/90, 두 sql_mode, 컨테이너 제거 확인, 운영 접근 0) → DDL 초안 §10. DDL 블록 수정 없음, 구현 규칙 F1~F10·R1~R4 를 위 「구현 규칙」으로 채택. 다음: 격리 worktree `~/.node-local/stockinvest-t112` 에서 Developer 2명 병렬 구현(파일 소유 분리) → Reviewer → Judge C2/Codex → QA.
- [18:55] **Leader 결정 — 격리 시험 허용 목록(Developer-1 막힘 해소)**: `src/lib/corp-intel/__tests__/isolation.test.ts` 의 「(T-119) holdings-premarket 상수·키를 쓰는 src 파일」 시험이 잡 이름표 문자열 \"holdings-premarket\" 을 쓰는 파일 3개(`records/job-slots.ts`·`__tests__/job-slots.test.ts`·`__tests__/job-run-log-disposable-mariadb.test.ts`)를 막았다. 이 문자열은 크론 러너가 부르는 이름이고 corp-intel 상수·키·모듈이 아니다. 해결 = **정확한 3개 파일만 허용 목록에 추가**(정규식 `HP_LABEL_FILES`, 디렉터리 통째 허용·검사 정규식 좁히기 모두 아님) + 이름표 파일에 `holdings_premarket_`·`corp-intel` 이 들어오면 실패하는 확인 1줄 추가. 이름 문자열을 쪼개 시험을 피하는 방법은 쓰지 않았다(Developer-1 도 거부). 변이 확인: 허용 밖 신규 파일에 같은 문자열을 두면 이 시험이 실패한다. 시험 37/37 통과. 이 파일은 훅 감시 경로(`^src/lib/corp-intel/`)이므로 **Reviewer scope 에 포함**한다.

- [20:16] **Reviewer 판정(Codex 지적)**: 부분 채택·Low(Minor-4)·**이번 배포를 막지 않음** — 금액을 싣는 라벨 2개(`portfolio-snapshot`·`trade-report`)가 스풀에 본문 앞 2KB 로 남는 것은 사실이나, 같은 본문이 이미 `/tmp/cron-runner-$$.out`(644)에 더 넓게 있고 스풀은 파일 1개·지속 시간(정상 ~60초, 라우트 장애 때 상한 2MiB)만 더하며, `/home/brownjeon` 750 이라 읽는 쪽이 넓어지지 않고, 서버가 본문을 DB 에 저장하는 경로가 없다. 후속 [[T-127-job-run-spool-hardening]](금액 값 마스킹·스풀 0600·롤업 failed 전이 시험·문서) 로 분리. 배포 기록에 "후크 활성 순간부터 스풀에 매시 총자산·현금 본문(644, 상위 디렉터리 750)이 생긴다"를 적는다. Reviewer Minor-1·2 도 T-127 로 이관.
- [20:16] **QA PASS**(상세 `## QA`): 러너 시험 80/80 · records jest 14스위트 487 · strict 일회용 MariaDB 10.11.19 33/33 · 마이그레이션 2회 적용 오류 0(테이블 3·이름 붙은 CHECK 10) · 라우트 종단 curl(401·200 skipped_disabled·200 skipped_no_table·200 ok·413×2). 비strict 4 실패는 「sql_mode 가 strict 다」·「129자 1406 거부」등 strict 의존 단언이 모드 변화를 감지한 것(결함 아님). **QA 가 직접 재실행하지 않은 것**: 기존 러너 시험 5종(pmo-retry·stop-alert·daily-bars·news-split·holdings-premarket)은 Reviewer 19:44 실행 로그 인용(러너·시험 파일은 그 뒤 불변), news-peek 은 QA 실행 중 20:12 Leader 가 중단(락을 쥐고 jest·DB 시험을 막아 시간 한도 초과 우려)해 Reviewer 19:17 81/81 인용. 중단 때 시험이 남긴 고아 프로세스(`runner-before.sh`)는 PID 로 정리.
- [20:16] **운영 sql_mode 확인(Leader, 19:13 읽기 전용 조회)**: `STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION` — `NO_BACKSLASH_ESCAPES` 없음(Reviewer Minor-3 조건 미해당). MariaDB 10.11.11, 새 테이블 3개·스위치 키 2개 모두 아직 없음. 
- [20:17] **사용자 승인(원문 "결정사항에서 DDL 적용 승인하며 푸시시점은 바로 진행해줘")**: DDL 적용 승인 + push 는 검증 순환(Reviewer→Judge C2→Codex→QA) 통과 즉시. **스위치 켜기는 이 승인 범위 밖**(키 없음=꺼짐 유지, 별도 승인).

- [21:05] **스위치 켬 + 관찰 시작**(사용자 승인 원문 "T-108 데모 v3 승인하며 job_run_log_enabled를 켜고 관찰하는 작업도 진행해줘"): `system_config.job_run_log_enabled`=`true`(21:05:27, 다른 안전 설정 4개 시각까지 불변, `judgment_record_enabled` 키 없음 유지). 서버 스위치 읽기 캐시 30초 — 첫 행은 21:05:30. **8분 관찰(21:08)**: `job_run_log` 5개 롤업 행(entry-watcher·holding-checker·stop-alert runs 4, strategy-eval·trade-report runs 1 — 틱 수와 일치) 모두 `ok`·failed 0·`maxMs` 12~15ms, 비정상(status≠ok·error_code·degraded_reason) 0행, `job-run-log 전송 실패` 로그 0, 스풀 비어 있음, pm2-err 에 기록 관련 오류 0. 21:00 holdings-premarket 틱은 켜기 전이라 기록 없음(정상).
- [21:08] **관찰 예약(AI, 세션 한정 크론 4회, 각 1회성)**: 10-30 22:12(시간 잡·news-peek·portfolio-snapshot 슬롯) · 23:42(미국장 개장 후 롤업 runs·청산 틱) · 10-31 08:13(08:00 해외 분석 최악 틱의 하트비트 간격·post-market-overseas 행) · 11-02 16:13(국내 첫 평일 전체 사이클, `judgment_record_enabled` 켜도 되는지 AI 의견). 각 점검은 읽기 전용, 이상 없으면 이 절에 한 줄 추가, 본 기능 영향이 확실할 때만 `job_run_log_enabled`=false(설계된 1순위 롤백)로 되돌리고 보고. 세션이 끝나면 예약도 사라진다(사용자에게 알림).

## Codex 검토
### [2026-10-30 19:50] C2 review focus=none — done
- judge 판정: 판단 기록 2026-10-30 19:47 줄 / 호출 차수: 1/4
- 대상: repo=/home/brownjeon/.node-local/stockinvest-t112 base=f218430(arg, Leader 지정 · base_ref 9d087a4 미사용) snapshot=446703e
- 지적 1건: [medium] scripts/cron-runner.sh:210 — 성공 응답에 현금 잔액·총액·손익이 든 잡(portfolio-snapshot·trade-report)의 응답 앞 2048바이트가 job-run-spool 에 base64 로 기록되고, 전송 실패 시 최대 2MiB 까지 남는다 → 사용자 금융 정보가 평문 스풀과 내부 전송 본문에 불필요하게 복제되어 노출 표면과 보존 시간이 커짐 (권고: 잡별 허용 필드만 스풀에 넣도록 응답을 축약하고 금액·잔액·손익·종목 상세는 수집하지 않는다. 최소한 두 잡 본문은 원문 저장 대상에서 제외하고 스풀 디렉터리·파일을 0700/0600 으로 생성한다)
- Reviewer 판정: 부분 채택·Low·배포 비차단 → [[T-127-job-run-spool-hardening]] (위 진행 기록 20:16)
- 검토하지 못한 범위: Jest·TypeScript 검사·MariaDB 시험·셸 러너 시험 재실행 안 함(읽기 전용 지시)
- 원본: /home/brownjeon/NFS/homes/brownjeon/project/.claude/state/codex-review/runs/20261030T105053Z-T-112-C2/raw.txt

## 최종 요약

### [T-112] 실행·판단 기록 기반 — 크론 잡 실행과 장마감 분석 판단을 DB 에 남기는 기반 (기록 스위치는 꺼짐)

- **상태**: 🔁 관찰 중 — `job_run_log_enabled` 켬(2026-10-30 21:05:27), `judgment_record_enabled` 는 꺼짐
- **무엇이 바뀌었나**: 화면·매매 동작은 달라지지 않았다. DB 에 빈 테이블 3개(`job_run_log`·`judgment_run`·`judgment_candidate`)가 생겼고, 크론 러너가 호출 기록을 서버 로컬 스풀에 쌓았다가 틱 끝에 앱으로 보내며(앱은 스위치가 꺼져 있어 받고 건너뜀), 장마감 분석 엔진에 판단 기록 코드가 들어갔다(스위치가 꺼져 있어 쓰지 않음). T-108 홈·분석 지표(가동률·분석 판단 이력)가 이 테이블을 읽는다.
- **배포**: ✅ 운영 반영 — 커밋 `df4b4a2` · 2026-10-30 20:17 KST · push(webhook, blue/green) · 결과 ok · 릴리스 `20261030-201752-df4b4a2d`. DDL 은 사용자 승인("결정사항에서 DDL 적용 승인하며 푸시시점은 바로 진행해줘") 후 20:17 KST 에 별도 적용.
  - 같은 배포에 함께 실린 작업: 문서·데모뿐(T-108 데모 v1~v3·지표 계약, T-117·T-120·T-124·T-125·T-126·T-127 기록) — 런타임 영향 없음
- **AI 가 검증한 것**: Reviewer PASS(Critical 0·Major 0·Minor 3) · Judge C2 `codex_required=true` → Codex 1차 지적 1건(medium) → Reviewer 부분 채택·Low·배포 비차단 → T-127 · QA PASS(러너 시험 80/80, records jest 487, strict 일회용 MariaDB 10.11.19 33/33, 마이그레이션 2회 적용, 라우트 curl 401·200 skipped·200 ok·413) · 전체 jest 315 스위트·tsc 오류 0 · 배포 후 pm2·health·안전 설정 불변·스풀 전송·행 0 확인
  - 검증 못 한 것: 스위치 ON 상태의 실제 기록 · 오늘 밤 21:00·22:30 틱과 내일 08:00 해외 분석에서의 영향(지켜볼 것) · QA 가 기존 러너 시험 5종은 재실행 없이 Reviewer 로그를 인용했고 news-peek 은 QA 실행 중 시간 때문에 중단(Reviewer·Developer 실행분 인용) · 운영 라우트 직접 curl
- **👉 사용자가 확인할 것**: 없음 — 화면·알림 변화가 없다. (이상 징후는 AI 가 크론 로그·하트비트·`job_run_log` 행으로 확인한다.)
- **👉 사용자가 결정할 것**: Q1(해결됨) `job_run_log_enabled` 켜기 — 사용자 승인(원문 "T-108 데모 v3 승인하며 job_run_log_enabled를 켜고 관찰하는 작업도 진행해줘")으로 21:05:27 에 켰다. 남은 Q2 `judgment_record_enabled`(분석 판단 기록) — 11-02(월) 16:13 점검에서 AI 의견을 내고 사용자 승인 뒤 켠다(기록 모듈이 국내·해외 분석 엔진 안에서 도는 것이라 job_run_log 보다 한 단계 위험).
- **남은 일**: 스위치 켜기·하루 관찰 · [[T-127-job-run-spool-hardening]](금액 본문 마스킹·스풀 0600·롤업 시험 한 케이스 — 착수 결정 대기) · T-108 구현이 이 테이블의 `engine_release IS NOT NULL` 행만 집계하도록 계약 반영 · 롤업 `runs` 근사값 명시
- **이슈·위험**: 러너 후크는 스위치와 무관하게 이미 활성(스풀에 매시 총자산·현금 본문이 짧게 남음 — 644, 상위 디렉터리 750, 정상 시 약 60초, Low) / 롤백: 스위치 끄기(현재 상태) → 필요 시 `git revert df4b4a2` 후 push, DDL 은 되돌아가지 않음(빈 테이블)

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음 | - | - | judge: none | 10-30 11:50 |
