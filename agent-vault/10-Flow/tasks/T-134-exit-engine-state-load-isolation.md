---
task_id: T-134
title: 청산 엔진 — 보유 종목 상태 조회(loadPositionState) 실패 한 번이 그 시장 틱의 남은 종목 손절·익절 평가를 통째로 멈추는 문제 (종목 단위 격리)
status: in-progress
priority: high
project: StockInvest
created: 2026-10-31
updated: 2026-10-31
base_ref: c593300 (로컬 main — origin/main ad45efc 의 문서 1커밋 앞)
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa]
related_tasks: [T-131-t126-t130-followup-candidates, T-126-exit-judgment-persistence, T-128-t108-followups, T-133-ticker-business-failure-retry, T-135-recorder-pool-hold-and-runner-tmp]
tags:
  - type/task
  - domain/safety
  - domain/strategy
aliases:
  - 청산상태조회격리
waiting: []
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

## 발단

[[T-131-t126-t130-followup-candidates]] 3번 — 사용자 지시 「권고대로 착수」(2026-10-31, 후속 우선순위 1순위 묶음). T-126 Reviewer·Developer 가 변경 전 트리에서도 재현된다고 확인한 **기존 결함**이다.

`src/lib/strategy/engine.ts` 의 청산 평가 루프(`runExitEngine`)는 종목마다 이웃 호출을 격리한다.

| 호출 | 위치(HEAD c593300 기준 줄은 근사) | 실패 시 |
|---|---|---|
| `kis.getTicker` | ~863 | try/catch → `exit_ticker_error` 기록 → `continue` |
| `upsertPositionState` | ~879 | try/catch → `exit_state_upsert_failed` 기록 → `continue` |
| **`loadPositionState`** | **~888** | **try/catch 없음** — 예외가 루프 밖으로 나간다 |

`loadPositionState`(`src/lib/strategy/position-state.ts:73`)는 `getPool().query` 한 번이고 자체 catch 가 없다. 풀 대기 초과·연결 끊김·DB 일시 정지처럼 **한 번의 조회 실패**가 나면 예외가 `for` 루프를 끊어, 그 틱에서 **아직 평가하지 않은 보유 종목의 손절·익절 평가가 건너뛰어진다**(다음 틱 약 5분 뒤에 다시 시도). 같은 틱에 `exit_judgment` 수집기 flush(T-126)도 건너뛰어져 그 틱의 행이 남지 않는다. 상위에서 예외를 어떻게 받는지(라우트 500 → `job_run_log` failed 로 보이는지)는 **Developer 가 코드로 확인해 이력서에 적는다.**

[가능성 높음] 이웃 호출과 같은 형태로 종목 단위 격리가 맞다 — 실제 DB 조회 한 번 실패가 얼마나 자주 나는지는 운영 데이터로 확인하지 않았다(오늘 NAS DB `ECONNREFUSED` 사례가 22:56 에 1회 있었다는 기록이 T-112 관찰에 있다).

## 관련 과거 이력 요약 (Leader)

- 승인된 교훈(`issues related safety strategy cron`): **없음**.
- [[T-126-exit-judgment-persistence]]: 루프 안 결론 지점마다 `noteExitJudgment(exitJudg, decision, gate, ctx)` 가 있고(1:1 정적 시험 + 동적 20장면 + 변경 전 트리 대조 하네스 329건), 기록 스위치는 곧(15:41 예약) 켜진다. 새 격리 지점도 **같은 규칙으로** 결론을 기록해야 한다(`decision='error'`).
- [[T-128-t108-followups]]·T-130: 게이트 이름의 한국어 문구는 `src/lib/ops/reason-dictionary.ts` 한 출처이고, 키 일치 시험(`KNOWN_UNMAPPED` 등)이 있다 — 새 게이트 ID 를 만들면 문구·시험을 함께 맞춘다.
- Reviewer 가 쓴 변경 전/후 동치 하네스: 스크래치패드 `rev-t126/`(`rev-t126-equiv2.test.ts`·`mutate3.py`) — 참고용 (Mac 세션 스크래치패드라 서브에이전트가 읽을 수 있다).

## 범위 (이번에 한다)

1. `engine.ts` 의 `loadPositionState` 호출을 이웃과 같은 형태로 격리한다: `console.warn`(종목·메시지, 비밀·금액 없음) + `rec.error('exit_state_load_failed', { symbol, side: 'sell', detail: { error: String(e).slice(0, 300) } })` + `noteExitJudgment(exitJudg, 'error', 'exit_state_load_failed', { symbol, entry, ticker })` + `continue`.
2. 새 게이트 ID `exit_state_load_failed` 가 **나열된 모든 곳**을 맞춘다: 사유 사전(`reason-dictionary.ts` 한국어 문구), eval_funnel 게이트 타입/목록이 있으면 그곳, T-126 배선 시험의 게이트↔기록 호출 1:1 목록, 키 일치 시험. 어디에 나열돼 있는지 **grep 으로 전부 찾아 Developer 절에 표로 남긴다.**
3. 시험: (a) `loadPositionState` 가 throw(Error·문자열·undefined)해도 같은 틱의 나머지 종목이 평가되고 청산 시그널이 만들어진다 (b) 실패 종목은 `exit_state_load_failed` 가 `rec` 에 1회, `exit_judgment` 수집기에 `decision='error'`·`decision_code='exit_state_load_failed'` 1행 (c) 실패하지 않는 모든 기존 장면은 **변경 전과 바이트 단위로 같다**(반환값·`rec.*` 호출 순서·내용·`createSignal` 인자·쿨다운·`position_state` 쓰기·경보 — T-126 동치 하네스 방식) (d) 실패 시 쿨다운·`position_state` 쓰기·경보가 새로 생기지 않는다.

## 불변 조건 (바꾸지 않는다)

- 정상 경로(조회 성공)의 동작은 한 바이트도 달라지지 않는다. 호출 순서·`await` 개수·분기 순서 불변.
- 조회 실패 종목은 **평가하지 않는다**(진입가를 KIS 평단으로 대체하는 등 새 청산 경로를 만들지 않는다) — 보수적으로 건너뛰고 기록만 한다.
- `safety/`·`orders/`·`exchanges/` 는 건드리지 않는다. `src/lib/exchanges/*` 는 **다른 세션(T-133)이 작업 중**이므로 절대 건드리지 않는다.
- 기록 스위치·DDL·`system_config` 는 건드리지 않는다. 운영 DB 쓰기·pm2·push·배포 금지.

## 하지 않는 것 (범위 밖 — 발견하면 `## Developer` 의 「범위 밖 발견」에만 적는다)

- `reconcilePositionState`·`upsertPositionState` 등 다른 호출의 보호 점검, `loadPositionState` 자체의 재시도/타임아웃 추가, 풀 설정 변경.
- 루프 밖 호출(잔고 조회 등)의 격리, `engine.ts` 의 다른 구조 변경, 화면 문구 변경(사유 사전 한국어 문구 한 줄 추가만 허용).

## 판단 기록 (judge)

- [2026-10-31 15:19] intake engine=jev → task_type=local_fix · risk=R2 · developer_model=opus · next=demo_first · demo=delta/designer · actions=prepare_demo,request_demo_approval,assign_developer | overrides=MD-r2-opus,DM-kw-risky-cta | fallback=- | tokens=1341
- [2026-10-31 15:23] intake engine=jev → task_type=local_fix · risk=R1 · developer_model=sonnet · next=assign · demo=none/- · actions=assign_developer | overrides=- | fallback=- | tokens=1342
- [2026-10-31 15:30] **Leader 채택·override 기록.** ① 재접수 이유: 첫 요약의 부정문(「화면 없음」·「주문 로직 변경 없음」)이 `rules.mjs` 의 `DM-kw-risky-cta`(`UI_CONTEXT` 91행 + `RISKY_OBJECT` 96행 + `RISKY_CHANGE` 97행, 119행)에 걸린 오탐 — 규칙은 부정 표현을 구분하지 않는다 [확실: 정규식 직접 확인, `ui_change`=none 0.94]. 같은 사실을 부정문 없이 쓴 요약으로 재실행했다. ② **데모: none 채택**(`check.mjs init` → `not_required`) — 이 task 의 사용자 가시 변화는 사유 사전 한국어 문구 한 줄뿐이고 레이아웃·흐름 변경 없음. ③ **`override: risk R2 · developer opus 유지`** — 재접수의 R1/sonnet 은 요약 표현이 바뀌어 `MD-r2-opus` 가 빠진 결과이고(judge 보고: 판정이 입력 표현에 따라 달라짐), 이 task 는 청산 평가 루프(손절·익절, 자금 직결, 커밋 훅 `SAFETY_PATHS` 의 `src/lib/strategy/`)를 고친다. 리더 규칙 「R2 보강」에 따라 judge 결과와 무관하게 R2. 이 task 의 Developer 는 Opus 다.

## 진행 기록

- [2026-10-31 15:2x] 등록(Leader). 사용자 「권고대로 착수」. 같은 묶음의 [[T-135-recorder-pool-hold-and-runner-tmp]] 와 **파일이 겹치지 않아 병행**(T-134 = `engine.ts`·사유 사전·시험 / T-135 = `records/`·`cron-runner.sh`). `getTicker` 쪽(T-131 후보 ① = T-132 보고 결정 ①)은 다른 세션이 [[T-133-ticker-business-failure-retry]] 로 이미 진행 중이라 이 task 에 넣지 않는다.

## Developer

## Reviewer

## QA

## Codex 검토

- [2026-10-31] 호출 생략 예정 — 사용자 전역 `~/.codex/config.toml` 의 `model = "gpt-6.1-sol"` 이 계정에서 지원되지 않아 호출이 실패한다([[T-131-t126-t130-followup-candidates]] 19번, 확인에 7분). judge 가 `codex_required: true` 를 내면 `override: Codex 모델 설정 장애(실패 확인됨)` 로 기록하고 진행한다.

## 최종 요약

(미작성)

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음 | - | - | judge: none | 10-31 15:23 |
