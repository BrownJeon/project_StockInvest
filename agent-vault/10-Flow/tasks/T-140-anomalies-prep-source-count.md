---
task_id: T-140
title: 운영 지표 「확인한 원천 수」가 준비 중(prep) 원천을 읽은 것으로 세는 문제 — 홈이 읽지 못한 원천을 「정상」으로 단정하는 경로 정정 (T-128 A3 후속)
status: done
priority: low
project: StockInvest
created: 2026-10-31
updated: 2026-10-31
base_ref: 287b637 (로컬 main)
risk_level: R1
roles_involved: [leader, judge, developer, reviewer, qa]
related_tasks: [T-128-t108-followups, T-131-t126-t130-followup-candidates, T-130-t108-visual-followups]
tags:
  - type/task
  - domain/ui
  - domain/metrics
aliases:
  - prep원천수정정
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

사용자 지시(2026-10-31 「다섯 건 전부 검토진행… 결과에 따라서 후속 작업 진행」)로 한 소급 Codex 검토에서 T-128 에 **medium 1건**: A3 가 `broker_ledger` 표 없음(errno 1146)을 `prep`(준비 중)으로 분류한 뒤, `prep` 이 이상 건수에서는 빠지는데 **확인한 원천 수(`sourcesChecked`)에는 들어가** 홈이 「0건 ✓ 이상 없음 · 원천 7개 정상」이라고 단정한다([[T-128-t108-followups]] 판단 기록).

독립 Reviewer 판정(같은 절): **채택(결함 성립), 실제 심각도 low(운영 현재 도달 불가)**. 재현 [확실]:

| 입력 | 변경 전(`ec6723c`) | 변경 후(A3, `fe6f095`) |
|---|---|---|
| 6개 정상 + 표 없음 | `total 1`·`sourcesChecked 6`, 홈 「1건 · 브로커 원장 조회 실패」 | `zero`·`total 0`·`sourcesChecked 7`, 홈 「0건 ✓ 이상 없음 · 원천 7개 정상」 |
| **다른 6개 전부 오류 + 표 없음** | `error: all_sources_failed` | `available`·`total 6`·`sourcesChecked 1`, 홈 「원천 1개 중 이상 6」 ← Codex 가 말하지 않은 더 나쁜 조합 |

- 운영 현재: `broker_%` 5개·`daily_bars` 표가 모두 있어 코드상 `prep` 이 되는 원천(`broker_ledger` 하나)에 **지금은 도달하지 않는다**. 표 없는 새 환경·임시 DB·10-25 DDL 이전 시점으로의 DB 복구에서 도달한다. 표시 전용(호출처 `home.ts`·`analysis.ts`, 주문·판정·저장 경로 없음).
- 의도 대조: 「prep 은 이상이 아니라 준비 중」은 **구현 가이드** `docs/design/2026-10-30-t108-implementation-guide.md` §4.0(502행) — 지표 계약 초안에는 `prep` 이 없고 §1.1 은 오히려 `unknown` 에 「표 없음 1146 포함」이라 두 문서가 어긋난다. 어느 쪽도 `prep` 이 `sourcesChecked` 에 들어가는지 정하지 않는다. 가이드 §4.7 「하나도 못 읽으면 error」는 확인 수를 **읽은 수**로 읽히게 하고, 홈 문구는 「원천 k개 **정상**」이라 단정한다. 즉 **구현 결함이면서 계약 구멍**.

## 관련 과거 이력 요약 (Leader)
- 승인된 교훈: 없음. [[T-128-t108-followups]] `## Reviewer` Low-4 와 [[T-131-t126-t130-followup-candidates]] 13번(「일봉 표 없음도 prep 으로 — `sourcesChecked` 의미와 함께 한 번에 정할 것」)이 이 순서를 이미 요구했다 — **13번을 먼저 하지 않는다.**

## 범위 (이번에 한다)
1. `src/lib/ops/metrics/anomalies.ts` 의 확인한 원천 수 계산(약 178행)에서 `prep` 을 읽은 수에서 뺀다: `s.state !== 'error' && s.state !== 'prep'` (Reviewer 가 복사본에서 이 한 줄만 바꿔 `exit-and-sources`·홈 렌더 시험 250개를 돌렸고 실패는 1개였다). 같은 파일의 다른 분기(약 158행 등)가 `prep` 을 읽은 수로 세지 않는지도 확인.
2. 시험: `src/lib/ops/metrics/__tests__/exit-and-sources.test.ts:168-171`(prep 한 줄만 넣고 `zero` 를 기대하는 인위적 단언)을 「6정상 + prep → total 0·sourcesChecked 6」과 「6오류 + prep → `all_sources_failed`」로 교체. 위 표 4행을 회귀 시험으로 고정(변경 전 코드에서 실패하는지 확인).
3. 문서: 구현 가이드 §4.0·§4.7 A4 행에 「prep 은 A4 건수와 확인 원천 수에서 모두 제외」, 지표 계약 초안 §1.1 상태 표에 `prep`(·`off_hours` 가 코드에 있으면) 행을 추가하고 `unknown` 의 「1146 포함」을 가이드와 맞춘다. 문서 수정은 의미 명확화에 한정(결정 변경 아님) — 어느 절을 어떻게 고쳤는지 Developer 절에 표로.

## 불변 조건
- 호출처(`home.ts`·`analysis.ts`)와 홈·분석 렌더 시험의 기존 4조합(`home-render-t108.test.ts`)은 그대로 통과. 이상 건수 계산·분류·`prep` 의 이상 제외는 불변. 운영 현재(표 있음) 출력은 변경 전과 **바이트 동일**.

## 하지 않는 것 (범위 밖 — 「범위 밖 발견」에만)
- **화면 문구 변경**(홈 A4 보조 줄 「원천 6개 정상 · 1개 준비 중」 또는 승인 칩 「부분 — 원천 6개만 확인」 재사용, 확인 필요의 「지금 확인할 것 없음 … 데이터 이상 0」이 전체 안심으로 읽히는 문제, prep 일 때 `checkCoverage.anomalies` 를 false 로) — T-128 범위표가 [[T-130-t108-visual-followups]] 로 분리해 둔 영역이라 designer/Leader 문구 확인 뒤 별도 처리. 이 수정이 숫자만 바꾸므로 홈에는 「원천 6개 정상」으로 나올 뿐 구조·위계는 불변.
- T-131 13번(`daily_bars` 표 없음을 prep 으로) — 이 task 이후.
- `brokerErrRow` 이름의 `Err`(nit) 정리는 하지 않아도 된다.

## 판단 기록 (judge)
- [2026-10-31 23:17] intake engine=jev → task_type=local_fix / risk=R1 / developer_model=sonnet / next=ask_user / demo=none/- / actions=clarify_requirements,assign_developer / blocking_gate=requirements | overrides=- | fallback=- | tokens=1297
- [2026-10-31 23:19] intake engine=jev → task_type=local_fix / risk=R1 / developer_model=sonnet / next=assign / demo=none/- / actions=assign_developer / blocking_gate=- | overrides=- | fallback=- | tokens=1380
- [2026-10-31 23:2x] **Leader 채택.** 첫 접수(`next=ask_user`)는 요약이 추상적이어서 나온 needs_info 결과(확률 0.64)였고 task 이력서의 범위·재현 표는 이미 완전하다 — 구체 문장으로 재접수해 `needs_info=false`·`next=assign`·`R1`·`developer_model=sonnet`·`demo=none`·규칙 덮어쓰기 없음을 얻었다. 판정 그대로 채택(`override` 없음). `check.mjs init` → `not_required`. 서버 worktree `~/.node-local/stockinvest-t140` @ `a064722`.

## 진행 기록
- [2026-10-31 23:5x] 등록(Leader). 소급 Codex 검토(T-128) 지적 + 독립 Reviewer 판정(채택·low)에서 파생. 코드는 서버 worktree 별도 브랜치(`wip/T-140-…`)에만 둔다.
- [2026-11-01 00:0x] Leader — 문서 순환 정리. Reviewer 재확인 3회(`prep` 행 사실 확인 → `off_hours` 행 Low ⑦⑧ → Low ⑨ 「분석 skipped 는 건너뜀」이 홈 A2 타일에는 틀림)를 거쳤다. 판정은 계속 PASS(코드 불변: `anomalies.ts` a01c8ec · 시험 89afb27 · 가이드 c6257db). Low ⑨ 는 Reviewer 가 렌더로 확인한 사실(A1 「건너뜀 · 사유」 글자 / A2 「장외」 칩 / 분석 표 「건너뜀」 칩)과 Info(예 ① 「오늘 평가 기록이 없을 때」)를 **Leader 가 계약 초안 38행에 그대로 옮겨 적었다**(표현만, 새 주장 없음). 이 한 줄 수정은 Reviewer 재확인 뒤에 들어갔으므로 QA 가 38행을 Reviewer 의 사실 목록과 대조하고, 더 이상 문서 때문에 순환을 돌리지 않는다.

## Developer

- [23:30] **구현 완료 — 커밋 안 함.** 서버 worktree `~/.node-local/stockinvest-t140` (detached `a064722`)에 변경만 남겼다. 변경 파일 4개, 새 파일 없음:
  - `src/lib/ops/metrics/anomalies.ts` (+5/−1) — 구현. 182행 `const checked = sources.filter((s) => s.state !== 'error' && s.state !== 'prep').length;` 한 줄 + 위 4줄 결정 이유 주석. 이 밖의 코드 변경 없음.
  - `src/lib/ops/metrics/__tests__/exit-and-sources.test.ts` (+98/−5) — `:168-171` 의 인위적 단언(prep 한 줄만 넣고 `zero` 기대)을 지우고 같은 자리 바로 뒤에 `describe('A4 — 준비 중(prep) 원천은 확인한 원천 수에서 뺀다 (T-140)')` 14개 시험으로 교체(별도 파일을 만들지 않고 같은 파일에 둠 — 같은 `fake-reader`·`kst` 도우미를 쓰고 이 파일이 원천 신선도·A4 시험의 자리이기 때문). import 에 `DATA_SOURCE_IDS`·`FX_ROW_SQL`·`NEWS_STREAK_SQL`·`LAST_BAR_DATE_SQL`·타입 몇 개 추가.
  - `docs/design/2026-10-30-t108-implementation-guide.md` (+2/−1), `docs/design/2026-10-30-t108-metrics-contract-draft.md` (+3/−1) — 의미 명확화(아래 표).
- [23:30] **설계 결정과 이유**
  - 확인한 원천 수 = **읽은** 원천 수. `prep`(표가 아직 없음)은 읽은 것이 아니므로 `error` 와 함께 뺀다. 이상 건수·분류는 건드리지 않았다: `ANOMALY_STATES`(`stale·error·unknown·partial`)에 `prep` 이 원래 없어 이상 항목으로 세지 않는 동작 그대로다.
  - 같은 파일의 다른 분기 전수 확인 [확실]: `prep` 을 「읽은 수」로 세는 곳은 `checked` 한 곳뿐이다(`sources.length` 를 쓰는 곳 없음, `known`·`value` 조립은 `checked` 만 받음). 원천 행의 상태를 만드는 곳은 `ageRow`(unknown·stale·available)·`barsRow`·`newsRows`·`errRow`(error)·`brokerErrRow`(**prep — 현재 브로커 원장 하나뿐**)이고 `off_hours` 를 원천 행에 만드는 곳은 없다. `all_sources_failed` 판정은 `checked === 0` 이므로 이제 「오류 + prep 만」인 입력도 error 로 내려간다.
  - **동작이 바뀌는 입력 1종류(Reviewer 가 알아야 함)**: 원천 행이 `prep` 뿐인 입력이 `zero`(확인 1개) → `error: all_sources_failed` 로 바뀐다. 읽은 원천이 0개이므로 가이드 §4.7 「하나도 못 읽으면 error」와 일치하는 의도된 결과이고, 실제 7개 원천이 모두 prep 일 수는 없어(prep 이 되는 원천이 하나뿐) 운영에서는 도달하지 않는다. 지워진 인위적 단언이 정확히 이 입력이었다.
- [23:30] **변경 전 재현 → 변경 후** (변경 전 = `a064722` 의 `anomalies.ts` + 새 시험을 먼저 돌려 빨강 확인, 변경 후 = 1줄 수정 뒤 초록)

  | 입력 | 변경 전 | 변경 후 |
  |---|---|---|
  | (a) 6개 정상 + 표 없음(1146 → prep) — `readDataSources`(fakeReader) → `buildAnomalies` | `zero`·`total 0`·`sourcesChecked 7` (시험 실패: 기대 6 / 실제 7) | `zero`·`total 0`·`sourcesChecked 6` |
  | (b) 다른 6개 전부 오류 + 표 없음 | `available`·`total 6`·`sourcesChecked 1` (시험 실패: 기대 error / 실제 available) | `error`·`value null`·`reason all_sources_failed` |
  | (d) prep 만 | `zero`·확인 1개 | `error: all_sources_failed` |
  | (d) prep + 오류 5 + 정상 1 | `available`·`total 5`·`sourcesChecked 2` | `available`·`total 5`·`sourcesChecked 1` |
  | (d) prep + 오래됨·모름·일부 저하 + 정상 3 | `total 3`·`sourcesChecked 7` | `total 3`·`sourcesChecked 6`(이상 항목 3개 동일, prep 은 항목에 없음) |
  | (d) prep + 실행 기록 모름 | `partial`·`sourcesChecked 7` | `partial`·`sourcesChecked 6` |

  변경 전 코드에서 새 시험 14개 중 **7개 실패**(a·b·d 4종 + 아래 동치 e2e 의 임시 자리표시값)·7개 통과(동치 S1~S7 — 변경 전 출력을 그대로 기대하므로 통과해야 맞다).
- [23:30] **동치 증거(prep 없는 입력은 변경 전과 바이트 동일)** — 기대값은 손으로 쓰지 않고 **변경 전 코드(`a064722`)에서 `JSON.stringify(buildAnomalies(...))` 로 뽑은 문자열**을 시험에 박았다(일회용 캡처 시험을 돌려 얻고 삭제함). 시나리오 7개: 전부 정상·잡 실패 0 / 전부 정상·실행 기록 모름(`null`) / 오래됨 + 잡 degraded / 오류 2·모름 1·저하 1(streak 3) + 잡 failed / 7개 전부 오류 / 6개 오류 + 브로커 정상 / 뉴스 오래됨 + 브로커 모름 + 실행 기록 모름 — 전부 `toBe(변경 전 JSON)` 통과. 추가로 **실제 읽기 경로 7개 전부 정상**(브로커 원장 표 있음 — 운영 현재)을 `readDataSources` → `buildAnomalies` 로 통과시킨 출력도 변경 전 문자열과 같다(`{"state":"zero","value":{"total":0,"sourcesChecked":7,"items":[],"analysisFailureKnown":true},"asOf":"x"}`).
- [23:30] **시험 실행 결과** (모두 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10`, Node v24.22.2, worktree)
  - `exit-and-sources.test.ts` 단독: 1 suite · **49 passed / 0 failed** · 0.2s.
  - 범위 시험 `src/lib/ops src/components/home src/app/api/ops src/__tests__`: **29 suites passed, 1 skipped**(일회용 MariaDB 시험 — 아래), **1116 passed / 0 failed**, 6 skipped, 4.1s. 포함: `home-render-t108`(기존 4조합 무수정 통과)·`checks`·`funnel`·`ops-routes`·`ops-read-only-fence`·`t108-*`·`t130-*` 울타리·`reason-dictionary-*`·`metric-state` 등.
  - `tsc --noEmit`: 종료 0, 출력 0바이트.
  - 기존 시험 단언 약화 없음. 삭제한 것은 지시된 인위적 단언 1개(아래 새 시험 (d) 첫째·(a)가 의도를 계승: 「prep 은 이상 항목이 아니다」는 (a)의 `items: []`·(d)의 `items` 에 `broker_ledger` 없음 단언으로 유지).
- [23:30] **문서 수정 표**

  | 문서 | 절 | 고친 내용 |
  |---|---|---|
  | `2026-10-30-t108-implementation-guide.md` | §4.0 (503행, 「테이블 없음(errno 1146)」 불릿 바로 뒤) | 새 불릿 「`prep` 은 읽은 원천이 아니다 (T-140 명확화 — 결정 변경 아님)」: A4 는 prep 원천을 이상 건수와 확인한 원천 수에서 모두 제외, 이유 2가지(「원천 7개 정상」 단정·`all_sources_failed` 가려짐), 현재 prep 이 되는 원천은 브로커 원장 하나(T-128 A3) |
  | 같은 문서 | §4.7 A4 행 (627행) 「0 vs 모름 vs 실패」 칸 | 「하나도 못 읽으면 `error`」 뒤에 「`prep`(표 없음) 원천은 건수와 확인 원천 수(`sourcesChecked` = `error`·`prep` 이 아닌 원천 수) 모두에서 제외 — 읽은 원천이 아니다(T-140), 읽은 원천이 0개면 `error`」 추가 |
  | `2026-10-30-t108-metrics-contract-draft.md` | §1.1 상태 표 `unknown`(미수집) 행 (33행) | 「테이블 없음 1146 포함」 삭제 → 「테이블 없음(1146)은 여기가 아니라 `prep`(가이드 §4.0 — T-140 정정)」. 가이드 §4.0 과 어긋나 있던 부분을 가이드에 맞춤 |
  | 같은 문서 | §1.1 상태 표 `partial` 행 뒤 (37~38행) | `prep`(준비 중) 행 신설: 표 없음 1146·기록 스위치 꺼짐 `record_off`·미구현 `not_implemented`, 현재 A4 에서 prep 이 되는 원천은 브로커 원장뿐, 「이상 건수에도 확인한 원천 수에도 넣지 않는다」. `off_hours`(장외·휴장) 행 신설: 코드 `MetricState` 에 있고 지표 계약에 없던 상태, 「0」이나 「미수집」이 아니라 「해당 없음」 |

- [23:30] **범위 밖 발견** (고치지 않음)
  - 계약 초안 §1.1 상태 표에는 코드 `MetricState` 의 `zero`·`blocked` 행이 아직 없다(표는 「0 은 `available` 이면서 건수 0 일 때만」, 「검증 차단 (상태 아님 — 정책)」이라 적혀 있고 코드는 둘 다 별도 상태). 이번 task 가 요청한 `prep`·`off_hours` 만 추가했다.
  - 화면: 이제 6개 정상 + prep 이면 홈이 「0건 ✓ 이상 없음 · 원천 6개 정상」으로 나온다(7개가 아님 — 읽은 6개에 대해서는 정확). 다만 「준비 중 1개」가 있다는 사실은 여전히 화면에 없고, prep 일 때 `checkCoverage.anomalies` 가 false 로 내려가지 않는 문제도 그대로다 — task 「하지 않는 것」에 적힌 [[T-130-t108-visual-followups]] 영역.
  - 이 저장소에는 ESLint 설정이 없다: `next lint` 가 대화형 설정 질문에서 멈춘다(worktree 에 파일이 생기지 않음을 `git status` 로 확인). 린트는 실행하지 못했고 `tsc --noEmit` 로 대체했다.
- [23:30] **확인하지 못한 것**
  - 일회용 MariaDB 실증 시험(`ops-disposable-mariadb.test.ts`, `T108_OPS_DB_PORT` 있을 때만 실행)은 돌리지 않았다(서버에 다른 세션의 `t108-qa-db` 컨테이너가 떠 있어 건드리지 않음). 그 시험은 `sourcesChecked` 를 단언하지 않고, 그 DB 에는 `broker_fill_runs` 행이 있어 prep 경로가 아니므로 이번 변경의 영향이 없다고 판단했으나 실행으로 확인한 것은 아니다.
  - 실제 운영 DB 에서 `broker_fill_runs` 표가 없는 상태를 만들어 보지는 않았다(운영 DB 쓰기·DDL 금지). (a)(b) 는 fakeReader 의 errno 1146 응답으로 재현했다.
  - 화면 렌더(`home-render-t108` 4조합 통과)는 모두 합성 DTO 입력이라, 서버가 낸 `sourcesChecked 6` 이 화면에서 「원천 6개 정상」으로 나오는 것은 `OpsSection.tsx:135~138` 코드 읽기로만 확인했다.
- [23:4x] Reviewer Low 문서 지적 2건 반영 — `docs/design/2026-10-30-t108-metrics-contract-draft.md` §1.1 표 37~38행(이 파일만, 코드 무변경). ① `prep` 행: `not_implemented` 출처를 가이드 §4.0 → 가이드 **L-3**(795행)로 정정, 열거를 「예:」로 바꾸고 코드에서 확인된 값 `approx_until_t112`(청산 기록 공백 근사, `exit-lines.ts:307`)·`under_7_days`·`no_record`(가동률 `uptimeRow`, `analysis.ts:134,141`)를 추가(`grep -rn "prep" src/lib/ops` 로 reason 값 생성처 확인; `not_migrated`·`record_off` 는 기존). ② `off_hours` 행: 이름을 「장외·휴장·건너뜀」으로, 생성처 둘(`exit-lines.ts` 장외·휴장 run 0행 / `analysis-runs.ts:192~235` 분석 `skipped`)과 표시 구분 — 「장외」(`ExitLogicSection`·`VerifyPanel`·일반 칩 `home-ctx`·`panel-parts`) / 「건너뜀」(홈 분석 표 `AnalysisSection.tsx:40,48`·A1 줄 `OpsSection.tsx:64`). 분석 › 오늘 분석 탭의 표시는 확인하지 않아 적지 않았다.
- [23:5x] Reviewer Low ⑦⑧ 반영 — 계약 초안 §1.1 `off_hours` 행(38행) 한 줄만 다시 고침(`prep` 행·다른 줄·코드 불변), 구체성을 줄임. ⑦ A1 줄은 칩이 아니라 글자 「건너뜀 · 사유」(`OpsSection.tsx:64` → `skipText`, `reason-dictionary.ts:121~123` 에서 `건너뜀 · …` 를 만든다)로 적고, 「칩」은 홈 분석 표(`AnalysisSection.tsx:40,48`)에만 붙임. ⑧ 「`run` 0행」 한정을 빼고 「예:」로 풀었다 — 청산 엔진 평가가 장외·휴장(`exit-lines.ts:91,180`)·분석 `skipped`(`analysis-runs.ts`)·개장 전/비거래일의 X6 `gapMetric`(`exit-lines.ts:302,304`); X6 줄은 `off_hours` 여도 「—」 + 항상 「준비 중 — 완전판 T-112」 칩(`VerifyPanel.tsx:130~136` 직접 읽음)이라고 한 줄 덧붙임. 지난번에 넣었던 「그 밖의 일반 상태 칩은 `off_hours` 를 장외로 그린다」 문장은 빼서 주장 수를 줄였다. `git diff` 로 이 파일 변경이 표 3줄(`unknown` 정정·`prep`·`off_hours`)뿐임 확인.

## Reviewer

- [23:42] 독립 감사 범위·방법. 대상은 서버 worktree `~/.node-local/stockinvest-t140`(detached `a064722`, 미커밋 4파일)이다. 이 worktree 는 읽기만 했고 `diff -rq` 로 동일함을 확인한 임시 복사본(`~/.node-local/review-t140-tmp`, node_modules 심볼릭 링크)에서 변이·재현을 했다. 끝난 뒤 복사본과 원본 파일 보관 폴더를 지웠고 worktree 상태는 시작 때와 같다(수정 4파일, 새 파일 없음). `git diff --stat` = 4 files, +108/−8, `git diff --check` clean. 범위 밖 파일(`src/lib/exchanges/*`·`strategy/records/*`·`OpsSection.tsx`·`home.ts`·`analysis.ts`)은 diff 에 없다. 비밀·보유 정보·금액 문자열 검색 0건(시험의 `rate: 1380` 은 가짜 환율).
- [23:42] (1) 의도 충족 — 충족. 범위 1(`anomalies.ts:182` 한 줄 + 결정 이유 주석), 범위 2(`exit-and-sources.test.ts` 의 인위적 단언 교체 + 새 describe 14개), 범위 3(문서 2건)만 바뀌었고 「하지 않는 것」은 건드리지 않았다(화면 문구·`checkCoverage`·`daily_bars` prep·`brokerErrRow` 이름 모두 불변). 같은 파일의 다른 분기 전수 읽기: `anomalies.ts` 에서 prep 을 「읽은 수」로 세는 곳은 `checked` 한 곳이었다(`sources.length` 를 쓰는 곳 없음).
- [23:42] (2) 결함 재현·수정 확인 — 직접 재현함. 변경 전 `anomalies.ts`(`git show a064722`)로 되돌린 복사본에서 새 시험 파일을 돌리면 49개 중 **6개 실패·43개 통과**: 실패는 (a) 6정상+표 없음 · (b) 6오류+표 없음 · (d) prep 만 · (d) prep+오류5+정상1 · (d) prep+오래됨·모름·저하 · (d) 분석 실패 모름. 통과는 동치 S1~S7 과 e2e 1개(변경 전 출력을 기대하므로 맞다). Developer 보고의 「14개 중 7개 실패」와 1개 어긋나는데 보고가 말한 임시 자리표시값 때문이며 최종 파일 기준으로는 6개다(Info, 무해). 별도 시나리오(Developer 시험을 쓰지 않고 `readDataSources`→`buildAnomalies`, 서로 다른 fake reader)로 task 「발단」 표를 재현: 변경 전 6정상+표 없음 = `zero`·`total 0`·`sourcesChecked 7`, 6오류+표 없음 = `available`·`total 6`·`sourcesChecked 1`(항목 6개) — 표와 일치. 변경 후 = `zero`·`sourcesChecked 6` 과 `error`·`value null`·`all_sources_failed`. 같은 실행의 7개 모두 정상(`sourcesChecked 7`)과 브로커 원장이 1146 이 아닌 오류(`available`·`total 1`·`sourcesChecked 6`)는 변경 전후 동일.
- [23:42] (3) 다른 경로의 prep 취급 — 남은 곳 없음. `grep -rn "sourcesChecked|all_sources_failed|ANOMALY_STATES|buildAnomalies|readDataSources" src`: `sourcesChecked` 를 읽는 운영 코드는 `OpsSection.tsx:135~139,150`(숫자 표시만)뿐이고 그 값이 6 이 되면 「원천 6개 정상」이 된다(읽은 6개에 대해서는 사실). 분석 › 데이터 상태(`DataPanel.tsx` `sourceChip`)는 `sourcesChecked` 를 쓰지 않고 prep 을 「정상」이 아니라 `stateChip` 기본 분기의 「준비 중」 칩으로 그린다. `hasValue`(`home-ctx.tsx`)는 prep 을 값 있음으로 보지 않는다. `ANOMALY_STATES` 에 prep 이 없어 이상 항목으로도 세지 않는다. 「prep 만(또는 prep+전부 오류)이면 `all_sources_failed`」는 가이드 §4.7 「하나도 못 읽으면 error」와 문자 그대로 맞고, `all_sources_failed` 사전 문구(`reason-dictionary.ts:164` 「데이터 원천을 하나도 읽지 못함」)도 사실이다. 도달성: prep 이 되는 원천은 브로커 원장 하나뿐(`brokerErrRow` 만 prep 을 만든다)이라 「prep 만」은 불가능하고, 「6오류+prep」은 브로커 표가 없는 환경에서 나머지 6개가 동시에 실패해야 한다. 같은 DB 라 DB 장애면 브로커 조회도 1146 이 아닌 오류가 되어 error 이므로 prep 으로 가지 않는다 — 운영(표 있음)에서는 도달 불가라는 task 판단에 동의한다(운영 DB 의 표 존재 자체는 이 감사에서 직접 확인하지 않았다 — 접근하지 않음). 부수 확인: 「6오류+prep」은 변경 전에는 `available` 이라 `checks.ts:110~120` 이 데이터 이상 줄을 3개까지 냈지만, 이제는 `error`(value null)라 그 줄이 없고 `checkCoverage.anomalies` 가 false 가 된다 — 기존 「7개 전부 오류」(시험 S5)와 같은 취급이라 일관된다(Info).
- [23:42] (4) 불변 조건 — 충족. 동치 시험 기대 문자열 S1~S7·e2e 는 **변경 전 코드에서 그대로 통과**했다(위 (2)의 통과 8개) — 즉 문자열이 변경 전 출력과 같다. 추가로 두 모듈(변경 전·후 `buildAnomalies`)을 같은 프로세스에 올려 무작위 입력 100,000개(원천 1~7개, 9개 상태, 실행 실패 null·빈·1건, `analysisFailureKnown` 두 값, streak)를 비교: prep 이 없는 입력은 **차이 0건**(JSON 바이트 동일), prep 이 있는 입력(35,843개)의 차이는 전부 「`all_sources_failed` 로 전환」 또는 「같은 상태·같은 total·같은 items 에서 `sourcesChecked` 만 감소」뿐이고 예외 0건. 이상 건수(`total`)·항목 목록·분류 불변. `home.ts`·`analysis.ts`·`home-render-t108.test.ts` 는 diff 에 없고 기존 4조합이 그대로 통과한다.
- [23:42] (5) 시험 품질 — 변이에 민감함. 복사본의 `anomalies.ts` 에 변이를 하나씩 넣고 `exit-and-sources`+`home-render-t108`+`checks`(273개)를 돌렸다: M1 `!== 'prep'` 만 남김(오류를 읽은 것으로 셈) 실패 6 · M2 `!== 'error'` 만 남김(= 변경 전) 실패 6 · M3 `=== 'prep'` 만 셈 실패 14 · M4 `||` 로 바꿔 전부 셈 실패 10 · M5 `ANOMALY_STATES` 에 prep 추가 실패 4 · M6 unknown 도 제외 실패 3 · M7 stale 도 제외 실패 4 · M9 partial 도 제외 실패 2 · M8 `checked <= 1` 실패 4 · M10 `sourcesChecked: sources.length` 실패 6 — 10종 모두 죽는다. 기존 단언 약화 없음: diff 의 삭제 줄은 지시된 인위적 단언 `it` 1개(3줄)와 import 줄뿐이고, 그 단언의 의도(「prep 은 이상 항목이 아니다」)는 새 (a) `items: []` 와 (d) `not.toContain('broker_ledger')` 가 이어받으며 M5 가 이를 실제로 잡는다. 목/픽스처 현실성: (a)(b) 는 실제 읽기 경로(`readDataSources`)와 `classifyDbError`(errno 1146 → `OpsQueryError('not_migrated')` → `brokerErrRow` → prep)를 그대로 통과하고, 일봉 라우트 응답 모양(`[{ d }]`)·뉴스 streak 행 모양은 실제 SQL 과 같다. 시각은 고정 상수라 시한폭탄 없음.
- [23:42] (6) 문서 — 사실과 맞고 명확화에 한정. 가이드 §4.0 새 불릿·§4.7 A4 행은 코드와 일치(`sourcesChecked` = `error`·`prep` 이 아닌 원천 수, 읽은 원천 0개면 error, 현재 prep 이 되는 원천은 브로커 원장뿐 — 코드로 확인). 계약 초안 §1.1 은 `unknown` 의 「1146 포함」을 빼고 가이드와 맞췄으며 `prep`·`off_hours` 행을 추가했다. 두 문서는 서로 모순되지 않는다(가이드 502행 「표 없음→prep」· 계약 `unknown`/`prep` 행). Developer 의 「범위 밖 발견」(계약 초안 상태 표에 코드 `MetricState` 의 `zero`·`blocked` 행이 없음)은 사실이다 — 계약 §1.1 은 「0 은 available 이면서 건수 0」, `검증 차단 (상태 아님)` 으로 쓰고 코드 `types.ts:23` 은 둘 다 별도 상태다. 다른 문서(`docs/`·`mockups/`)에서 `sourcesChecked` 의미를 달리 말하는 곳은 없다.
- [23:42] (7) 시험 실행 재확인 — Node v24.22.2, 모두 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10`, worktree 와 `diff -rq` 동일한 복사본에서. `exit-and-sources` 단독 49개. 범위 `src/lib/ops src/components/home src/app/api/ops src/__tests__`: **29 suites passed·1 skipped(일회용 MariaDB), 1116 passed·6 skipped·실패 0** — Developer 보고와 일치. `tsc --noEmit` 종료 0·출력 없음. 단, 이 저장소의 `tsconfig.json` 은 `**/__tests__/**`·`*.test.ts` 를 제외하고 jest 는 `@swc/jest`(타입 검사 없음)라 Developer 의 「tsc 종료 0」은 시험 파일의 타입을 보증하지 않는다 — 그래서 시험 파일 하나만 포함하는 임시 tsconfig(`types: jest,node`)로 따로 검사했고 새 파일·변경 전 파일 모두 오류 0 이었다(Info).
- [23:42] (8) 새 파일·민감정보 — 새로 생긴 파일 없음(수정 4개뿐), 비밀·보유·금액 정보 없음. worktree 의 무시 대상 파일(`next-env.d.ts`·`tsconfig.tsbuildinfo`)은 Developer 실행으로 갱신된 것으로 추정되며 git 추적 밖이다.
- [23:42] 발견 목록(Critical 0 · High 0 · Medium 0 · Low 2 · Info 4) — 모두 비차단, 코드 수정 요청 없음. 번호 매김: ①②는 문서 정확도, ③~⑥은 정보.
  - ① [Low] `docs/design/2026-10-30-t108-metrics-contract-draft.md:37` `prep` 행: 「구현 가이드 §4.0」을 근거로 인용한 이유 3가지 중 `not_implemented` 는 가이드 §4.0 이 아니라 L-3(가이드 795행)·`types.ts:279`·`postmortem-sample.ts:101` 에서 온다(가이드에 `not_implemented` 문자열 0건). 또 코드에서 prep 인 `under_7_days`·`no_record`(`analysis.ts:134,141`)·`approx_until_t112`(`exit-lines.ts:307`)가 열거에 없어 열거가 전부처럼 읽힌다. 권고: 「예:」로 바꾸고 인용을 정확히(문서 전용, 결정 변경 없음).
  - ② [Low] 같은 문서 `off_hours` 행 숫자 표시 「— + "장외"」: 분석 A1 의 `skipped → off_hours`(가이드 624행)는 화면에서 「건너뜀」 칩으로 나온다(`AnalysisSection.tsx:40,48`). 「장외」는 청산 줄·일반 `MetricReason` 의 표시다. 권고: 「— + 장외(분석은 건너뜀)」처럼 둘을 쓰거나 「예」로 한정.
  - ③ [Info] 위 (7)의 tsc 가 시험 파일을 검사하지 않는다는 점 — 이 task 에서는 내가 따로 검사해 문제 없음. Leader 보고에서 tsc 를 시험 타입 증거로 쓰지 말 것.
  - ④ [Info] `types.ts:92` `anomalies.value.sourcesChecked` 에 의미 주석이 없다(의미는 `anomalies.ts:178~181`·가이드에만). 다음 손댈 때 한 줄 주석을 권고 — 이번 범위에는 요구하지 않음.
  - ⑤ [Info] 변경 후에도 남는 화면 문제(범위 밖 확인): 6정상+prep 이면 `checkCoverage.anomalies` 가 true 이고 홈이 「원천 6개 정상」으로만 말해 「준비 중 1개」는 보이지 않는다. T-130 영역으로 이미 분리돼 있다.
  - ⑥ [Info] Developer 보고 어긋남 1건(7 vs 6 실패)은 위 (2) 참조 — 무해.
- [23:42] 확인하지 못한 것: (a) 일회용 MariaDB 실증 시험(`ops-disposable-mariadb`, 환경변수 있을 때만 실행)은 돌리지 않았다 — 건수를 단언하지 않는 시험이라 이 변경과 무관하다고 보지만 실행으로 확인하지는 못했다. (b) 운영 DB 에 브로커 원장 표가 실제로 있는지(task 의 「운영 현재 도달 불가」 근거)는 직접 보지 않았다 — 운영 DB 에 접근하지 않았다. (c) 화면 렌더에서 `sourcesChecked 6`·`all_sources_failed` 가 실제로 어떻게 보이는지는 `OpsSection.tsx:135~139` 코드 읽기와 기존 합성 DTO 렌더 시험 4조합 통과까지만 확인했다(새 조합의 렌더 시험은 없다 — 이 task 의 범위가 숫자만 바꾸므로 요구하지 않음). (d) ESLint 는 이 저장소에 설정이 없어 돌리지 않았다(Developer 보고와 동일). (e) 이 감사는 코드·문서 감사이며 배포·운영 반영 승인이나 QA 대체가 아니다.
- [23:42] QA 에 넘기는 집중 점검 구역(high_risk_areas): `src/lib/ops/metrics/anomalies.ts:182`(`checked` 필터 — prep 제외 유일 지점), `src/lib/ops/metrics/anomalies.ts:158,169`(`ANOMALY_STATES` 에 prep 없음 유지), `src/lib/ops/metrics/__tests__/exit-and-sources.test.ts` 의 새 `describe`(a)(b)(d)와 동치 골든 S1~S7, `src/components/home/OpsSection.tsx:135~150`(`sourcesChecked` 표시), `src/lib/ops/metrics/checks.ts:110,136~140`(error 전환 시 줄·coverage). 코드 수정은 필요 없고 문서 ①②는 수정해도 되고 미뤄도 된다.
- [23:42] **최종 판정: PASS (scope: src/lib/ops/metrics/anomalies.ts, src/lib/ops/metrics/__tests__/exit-and-sources.test.ts, docs/design/2026-10-30-t108-implementation-guide.md, docs/design/2026-10-30-t108-metrics-contract-draft.md)**
- [23:46] 재감사 — Developer 가 Low ①② 를 반영했다고 알려 와서 설명을 믿지 않고 worktree 를 다시 읽었다(읽기만, 임시 복사본·시험 재실행 불필요 — 아래 1번으로 코드가 그대로임을 확인). 
- [23:46] (R1) 변경 범위 — 확인함. HEAD 는 그대로 `a064722`, `git status` 수정 4파일(새 파일 없음), `git diff --stat` 4 files +108/−8 로 앞선 감사와 같고 `git diff --check` clean. git blob 해시가 앞선 감사에서 본 값과 같다: `anomalies.ts` `a01c8ec`, `exit-and-sources.test.ts` `89afb27`, 구현 가이드 `c6257db`(수정 시각도 23:27~23:28 로 감사 시작 전). 달라진 것은 계약 초안 하나(`c8f9e99` → `2cd4fba`, 수정 23:44)뿐이고, 그 diff 는 §1.1 표의 3줄(`unknown` 정정 · `prep` · `off_hours`)만이다. `unknown` 줄은 앞선 감사 때와 문자 그대로 같다. 따라서 코드·시험·가이드에 대한 앞선 감사 결과(시험 1116개 통과·변이 10종·무작위 10만 비교)는 그대로 유효하다.
- [23:46] (R2) `prep` 행 사실 확인 — 맞다. 코드에서 모두 `state: 'prep'`: `approx_until_t112` = `exit-lines.ts:307`(`gapMetric`, X6 기록 공백), `under_7_days` = `analysis.ts:141`, `no_record` = `analysis.ts:134`(둘 다 가동률 `uptimeRow`), `not_implemented` = `postmortem-sample.ts:101`(`medianExcessPct`). L-3 은 구현 가이드 795행 「시간이 모자라면 건수 열만, 중앙값은 준비 중」이라 인용이 정확하다. 「예:」로 열거를 열어 두고 가이드 §4.0 근거는 1146·`record_off` 두 가지에만 붙였으므로 앞선 Low ① 은 해소됐다. 「`analysis-runs.ts` 의 `no_record` 는 `unknown`」도 맞다: `analysis-runs.ts:76~78` `noRowMetric` 은 `not_migrated`·`record_off` 만 `prepMetric` 으로, 나머지(`no_record`·`switch_unknown`)는 `unknownMetric` 으로 보낸다. 같은 글자 `no_record` 가 가동률에서는 prep, 분석 실행 기록에서는 unknown 이라 계약 행의 「가동률의 … 첫 기록 없음」이라는 한정은 필요하고 적혀 있다(Info: 한정이 빠지면 오독되기 쉬움 — 현 문구는 충분).
- [23:46] (R3) `off_hours` 행 사실 확인 — 두 곳은 맞고 두 곳에 부정확한 문장이 남았다. 맞는 것: `off_hours` 를 만드는 파일은 정말 둘이다(`exit-lines.ts` 91·180·302·304행, `analysis-runs.ts` 192·217·234·235행 — 나머지 `off_hours` 는 화면·타입의 소비 쪽). 「장외」표시: `ExitLogicSection.tsx:101`·`VerifyPanel.tsx:48`·`home-ctx.tsx:57`·`panel-parts.tsx:39` 확인. 「건너뜀」: `AnalysisSection.tsx:40,48` 가 칩(`StatusChip kind="off"`)으로 그리고 머리 칸(`headOf`)에 「10-30 · 건너뜀 · 주말」로 사유를 따로 둔다. 건너뜀 사유가 `reason` 에 담기는 것도 맞다(`analysis-runs.ts` `skipCode ?? 'skipped'`). 부정확한 것 둘은 아래 Low ⑦⑧.
- [23:46] (R4) 의미 명확화 한정·가이드 정합 — 충족. 가이드는 바뀌지 않았고(blob 동일) 새 행의 내용은 가이드와 충돌하지 않는다: 가이드 624행 A1 `skipped → off_hours`, 634·635행 X1·X3 `장외 → off_hours`, 555행 `off_hours = 장외`, 502~503행·§4.7 A4 의 prep 취급과 같은 말이다. 결정(어떤 상태를 이상으로 세는가 등)을 바꾸는 문장은 없다. 앞서 Info 로 적은 「계약 §1.1 에 `zero`·`blocked` 행이 아직 없음」은 이번에도 그대로 남아 있다(Developer 가 범위 밖 발견으로 적은 사항).
- [23:46] 새 발견(문서 전용 Low 2건, 비차단) — 앞선 ①~⑥ 번호에 이어 매김.
  - ⑦ [Low] `docs/design/2026-10-30-t108-metrics-contract-draft.md` `off_hours` 행 ②: 「홈 분석 표·A1 줄에서 "건너뜀" 칩(사유는 머리 칸에 따로)」 — 분석 표는 맞지만 A1 줄은 다르다. `OpsSection.tsx:64` 는 칩이 아니라 글자 `skipText(...)`(= 「건너뜀 · 주말」, `reason-dictionary.ts:121`)를 노드로 쓰고, A1 타일에는 머리 칸이 없어 사유가 같은 글자 안에 들어 있다. 권고: 「분석 표는 칩+머리 칸 사유, A1 줄은 글자 「건너뜀 · 사유」」로 나눠 적거나 A1 을 빼고 「분석 표」만 쓴다.
  - ⑧ [Low] 같은 행 ①: 「그 시장 오늘 세션 `run` 0행(`exit-lines.ts`)」 + 「①은 "장외"(홈 청산 로직·분석 › 검증)」 — `exit-lines.ts` 의 네 곳 중 91·180행(`lastEvalMetric`·`noRunMetric`)만 run 0행 기준이고, 302·304행(`gapMetric`, X6 기록 공백)은 run 수와 무관하게 국내 비거래일·개장 전이면 `off_hours` 를 준다. 또 X6 줄은 `VerifyPanel.tsx:130~136` 에서 값 자리 「—」 + 항상 「준비 중 — 완전판 T-112」 칩이라 「장외」 글자로 나오지 않는다. 권고: ① 에 「(X6 기록 공백은 비거래일·개장 전이며 화면은 「준비 중」 칩)」을 덧붙이거나, 「run 0행」 한정을 「예」로 풀어 쓴다.
  - Info: 계약 초안 prep 행 끝의 「현재 A4 에서 prep 은 브로커 원장뿐」 문장은 코드와 계속 일치한다(`brokerErrRow` 만 prep 생성).
- [23:46] 재감사 확인하지 못한 것: 이번에는 코드·시험·가이드가 바이트 단위로 같음을 해시로만 확인했고 시험을 다시 돌리지 않았다(앞선 실행 결과가 그대로 유효). 나머지 한계는 앞선 기록(일회용 MariaDB 시험·운영 DB 표 존재·새 조합의 렌더 확인 불가)과 같다.
- [23:46] **최종 판정: PASS (scope: src/lib/ops/metrics/anomalies.ts, src/lib/ops/metrics/__tests__/exit-and-sources.test.ts, docs/design/2026-10-30-t108-implementation-guide.md, docs/design/2026-10-30-t108-metrics-contract-draft.md)**
- [23:51] 3차 확인 — Developer 가 Low ⑦⑧ 을 반영해 계약 초안 §1.1 의 `off_hours` 행(38행)만 다시 고쳤다. 설명을 믿지 않고 worktree 와 코드를 다시 읽었고, 화면 주장 하나는 임시 복사본(`~/.node-local/review-t140-tmp2`, 확인 뒤 삭제)에서 홈 운용현황을 실제로 렌더해 확인했다.
- [23:51] (S1) 변경 범위 — 확인함. HEAD `a064722` 그대로, 수정 4파일(새 파일 없음), `git diff --stat` 4 files +108/−8, `git diff --check` clean. blob 해시: `anomalies.ts` `a01c8ec`, 시험 `89afb27`, 구현 가이드 `c6257db` 모두 앞선 감사와 같고(수정 시각 23:27~23:28), 달라진 것은 계약 초안 하나(`2cd4fba` → `0459c40`, 23:48)뿐이다. 그 diff 는 §1.1 의 3줄(`unknown`·`prep`·`off_hours`)이고 `unknown`·`prep` 두 줄은 2차 확인 때와 같다. 코드·시험·가이드 쪽 앞선 감사 결과(시험 1116개 통과·변이 10종·무작위 10만 비교)는 그대로 유효하다.
- [23:51] (S2) `off_hours` 행의 주장별 대조 —
  - ① 「홈 A1 줄은 「건너뜀 · 사유」 글자」: 맞다. `OpsSection.tsx:64` 가 `skipText(skipReasonCode(row))` 를 노드로 쓰고 `reason-dictionary.ts:121~123` 이 `건너뜀 · {사유}` 문자열을 만든다. 실제 렌더 결과도 `<span class="mk"><i>국내</i>건너뜀 · 주말</span>`(칩 아님). 「칩은 분석 표만」도 맞다: 「건너뜀」 칩 리터럴은 `AnalysisSection.tsx:40,48` 두 곳뿐이고 기존 시험(`home-render-t108` 수정 3)이 `class="st off">건너뜀` 과 머리 칸 사유를 고정한다.
  - ② 「예」 세 가지: 맞다. `exit-lines.ts:91`(`lastEvalMetric`)·`:180`(`noRunMetric`), `analysis-runs.ts:192,217,234,235`(`status === 'skipped'`), `exit-lines.ts:302`(국내 비거래일)·`:304`(개장 전) 모두 `off_hours` 를 만든다. `off_hours` 를 만드는 파일이 이 둘뿐이라는 것도 재확인(나머지는 소비 쪽).
  - ③ X6 줄: 맞다. `VerifyPanel.tsx:130~136` 은 값 자리를 `g.value != null && g.state !== 'error' ? … : '—'` 로 두고(`off_hours` 는 value null → 「—」) 칩은 무조건 「준비 중 — 완전판 T-112」다. X6 `gap` 을 읽는 화면은 이 한 곳뿐이다.
  - ④ 「청산 엔진 평가는 「장외」」: 맞다 — 홈 청산 로직 `ExitLogicSection.tsx` 의 `evalSub`(56~64행)·`marketJudgeReason`(101행)이 `<StatusChip kind="off">장외</StatusChip>`, 분석 › 검증 `VerifyPanel.tsx:48` 이 「장외」(`z` 줄은 `stateChip` → `panel-parts.tsx:39`).
  - ④ 「분석 `skipped` 는 「건너뜀」」: **전부 맞지는 않다 — 아래 Low ⑨.**
- [23:51] 새 발견(문서 전용, 비차단) — 앞선 ①~⑧ 번호에 이어 매김.
  - ⑨ [Low] `docs/design/2026-10-30-t108-metrics-contract-draft.md:38` 「분석 `skipped` 는 "건너뜀"(홈 분석 표는 칩, 홈 A1 줄은 …)」: 홈 운용현황 A2 타일 「분석 후보 종목」은 같은 `skipped` 분석을 「건너뜀」이 아니라 **「장외」 칩**으로 그린다. 근거 줄: `OpsSection.tsx:104` `node = <MetricReason m={sc.state === 'unknown' || sc.state === 'prep' ? sc : rc} />` — `skipped` 이면 `ruleCandidates`·`signalsCreated` 가 모두 `off_hours`(`analysis-runs.ts:192,217`)라 `MetricReason`(`home-ctx.tsx:57`)의 `off_hours` 분기로 간다. 렌더 확인(국내 `skipped`, weekend): A1 = 「국내 건너뜀 · 주말」, **A2 = `<span class="mk"><i>국내</i><span class="st off">장외</span></span>`**, 분석 표 = 「건너뜀」 칩. 2차 확인 때의 문구에는 「그 밖의 일반 상태 칩은 `off_hours` 를 「장외」로 그린다」가 있어 이 경우를 덮었는데 이번 수정에서 빠졌다. 권고: 그 한 문장을 되살리거나 「(홈 A2 「분석 후보 종목」처럼 일반 상태 칩을 쓰는 곳은 분석 `skipped` 도 「장외」)」를 덧붙인다. 이 시험(`home-render-t108`)에는 A2 의 `skipped` 렌더 단언이 없어 아무 시험도 이 차이를 막지 않는다.
  - ⑩ [Info] `off_hours` 행 예 ① 「청산 엔진 평가가 장외·휴장인 시장」: `exit-lines.ts:91` 은 장외·휴장이고 **오늘 평가(run)가 0행**일 때만 `off_hours` 를 준다(장 마감 뒤에 오늘 평가가 있으면 `available`·`sessionOpen=false`, 기존 시험 「장 마감 뒤 국내」). 행 머리 문장 「해당 기록이 없는 것이 정상인 때」가 이를 덮으므로 틀린 문장은 아니다 — 「(오늘 평가 기록이 없을 때)」를 붙이면 더 정확하다. 선택 사항.
  - ⑪ [Info] 이 task 범위 밖(제품 표시 불일치): 같은 건너뜀 분석이 A1 은 「건너뜀 · 사유」, A2 는 「장외」, 분석 표는 「건너뜀」 칩으로 나온다. 위 ⑨ 가 문서에 정확히 적히면 문서 문제는 풀린다. 화면 통일은 T-130 계열 후보(designer·Leader 판단)이며 T-140 에서 고치지 않는다.
- [23:51] 3차 확인하지 못한 것: 이전과 같다(일회용 MariaDB 시험·운영 DB 표 존재 불가). 이번에는 코드·시험·가이드를 해시로만 재확인했고 시험을 다시 돌리지 않았다. ⑨ 의 A2 렌더 확인은 합성 입력(분석 지표 6개를 모두 `off_hours` 로 둔 국내 한 시장)이며 실제 서버 응답의 `skipped` 행이 `signals.created > 0` 으로 `partial` 이 되는 경계(`analysis-runs.ts` 209~215행)는 보지 않았다.
- [23:51] **최종 판정: PASS (scope: src/lib/ops/metrics/anomalies.ts, src/lib/ops/metrics/__tests__/exit-and-sources.test.ts, docs/design/2026-10-30-t108-implementation-guide.md, docs/design/2026-10-30-t108-metrics-contract-draft.md)**

## QA

- [23:58] 실행 환경: 서버 worktree `/home/brownjeon/.node-local/stockinvest-t140` (detached `a064722` + 미커밋 4파일 — HEAD·파일 구성 변경 없음, `git diff --check` clean, untracked 0). 무거운 명령은 모두 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10`, Node v24.22.2. 락 대기 없이 즉시 획득.
- [23:55] 항목1-a `npx jest src/lib/ops/metrics/__tests__/exit-and-sources.test.ts` → Tests 49 passed / 0 failed (실행 0.2s). **PASS**
- [23:55] 항목1-b `npx jest src/lib/ops src/components/home src/app/api/ops src/__tests__` → Suites 29 passed · 1 skipped(ops-disposable-mariadb, 환경변수 없음) / Tests 1116 passed · 6 skipped · 0 failed (4.0s). **PASS**
- [23:55] 항목1-c `npx tsc --noEmit` → exit 0, 출력 0바이트 (2s). **PASS**. 단 base tsconfig 가 `__tests__`·`*.test.ts` 를 제외하므로 시험 파일 타입은 따로 확인했다 — 임시 tsconfig(base 를 extends, `incremental:false`, worktree 쓰기 없음)로 `exit-and-sources.test.ts` 단독 검사 exit 0, 출력 0바이트 (PASS).
- [23:55] 항목2 결함 재현(임시 복사본 `~/.node-local/qa-t140-tmp`, 끝나고 삭제): 복사본과 worktree 의 차이는 `anomalies.ts` 한 파일. 이것을 `a064722` 판으로 되돌리면 49개 중 **6 실패 · 43 통과** — 실패는 (a) 6정상+표없음, (b) 6오류+표없음, (d) prep 만, (d) prep+오류5+정상1, (d) prep+오래됨·모름·저하+정상3, (d) 분석 실패 모름. Developer 보고의 「7」과 1개 차이 — 실측은 6(Reviewer 기록과 같음). 수정 판은 49/49 통과. **PASS** — 새 시험은 변경 전 코드에서 잡히고 수정 후 코드에서 통과한다.
- [23:57] 항목3 불변: 변경 파일 정확히 4개(`git diff --name-only`). `home.ts`·`analysis.ts`·`home-render-t108.test.ts`·`src/lib/exchanges/*`·`src/lib/strategy/records/*` 변경 없음. `home-render-t108.test.ts` PASS(범위 실행). `anomalies` 를 참조하는 시험(ops-routes·checks·funnel·t108-trade-render·home-render-t108·exit-and-sources)은 모두 범위 실행 안에 있고 ops-disposable-mariadb 만 skip. **PASS**
- [23:57] 항목3 운영 현재 바이트 동일: 코드 근거 [확실] — `prep` 을 만드는 곳은 `anomalies.ts:64`(1146 → brokerErrRow) 하나뿐이고, 표가 있으면 prep 원천이 없어 새 조건 `s.state !== 'prep'` 이 항상 참 → 변경 전과 같은 값. 동치 시험 S1~S7 과 실제 읽기 경로 전부 정상 e2e 가 변경 전 출력 문자열과 일치(항목1-a 에서 통과). 운영 DB 와 직접 대조하지는 않았다 → 이 부분은 NOT_VERIFIED.
- [23:58] 항목4 문서 대조(워크트리 파일을 직접 읽음): (a) `src/components/home/OpsSection.tsx:64` 가 `skipText(...)` 를 글자 노드로 쓰고, 문구는 `src/lib/ops/reason-dictionary.ts:123` 의 「건너뜀 · {사유}」 — 칩 아님, **일치**. (b) `src/components/home/AnalysisSection.tsx:40,48` `<StatusChip kind="off">건너뜀</StatusChip>` — **일치**. (c) `src/components/home/OpsSection.tsx:104` 의 `MetricReason`(rc 가 off_hours 일 때) → `src/components/home/home-ctx.tsx:57` 「장외」 칩 — **일치**. (d) `src/app/analytics/VerifyPanel.tsx:134~135` 값 자리 「—」(value null) + 칩 항상 「준비 중 — 완전판 T-112」 — **일치**. (d) 파일은 `components/home` 이 아니라 `src/app/analytics/` 아래다.
- [23:58] 항목4 표 38행의 나머지 주장: 청산 「장외」는 `ExitLogicSection.tsx:61,63,101`·`VerifyPanel.tsx:48`·`panel-parts.tsx:39` 에서, `off_hours` 생성처는 `exit-lines.ts:91,302,304`·`analysis-runs.ts:192,217,234,235` 에서 확인 — **일치**. 가이드 §4.0 새 불릿·§4.7 A4 행은 `sourcesChecked` 정의(`anomalies.ts:182`)와 일치. Reviewer 의 ⑦⑧⑨⑩ 지적은 현재 38행에 모두 반영되어 있다.
- [23:58] 항목4 주의: 계약 초안의 현재 blob 해시는 `2695103`(`git hash-object`)이고, Reviewer 가 마지막 PASS(23:51)에 적은 `0459c40` 과 직접 비교되지 않는다(표기 방식이 다름). 진행 기록상 38행은 Reviewer 재확인 뒤에 고쳐졌으므로, Reviewer 가 현재 문구 전체를 직접 본 것은 아니다 — 이 QA 의 사실 대조가 현재 문구에 대한 확인이다. 구현 가이드 `c6257db` 는 Reviewer 판과 같다.
- [23:58] 항목5 비밀·보유·금액·종목: 추가된 줄 기준 — 비밀 단어(api key·secret·password·token·계좌·account) 0건, 32자 이상 토큰 0건, 8자리 이상 숫자·천 단위 금액 0건, 6자리 종목코드·`NAS:`/`NYS:` 0건. 대문자 3~5자 매치 7건은 전부 통화 코드(KRW·USD)·JSON·NOW. 새 untracked 파일 0건(무시 대상만 `next-env.d.ts`·`node_modules`·`tsconfig.tsbuildinfo` — tsc 실행으로 tsbuildinfo 가 갱신됐을 수 있고 추적 대상 아님). **PASS**
- [23:58] 실매매 안전장치 체크리스트: 해당 없음 — 변경은 표시용 지표 조립(`anomalies.ts`)·시험·문서이고 주문 송신·거래소 어댑터·Kill Switch·DRY_RUN 호출이 없다(anomalies.ts 에 해당 단어 0건, 시험 파일의 `dry_run`·`kill_switch` 는 주문 상태 문자열 픽스처). 변경 파일은 커밋 훅 `SAFETY_PATHS`(`scripts/git-hooks/commit-msg`) 대상이 아니다. 보안: 새 SQL 문자열 변경 없음(diff SQL 0건), 비밀 노출 없음 — 이상 없음.
- [23:58] 확인하지 못한 것(NOT_VERIFIED): ① `ops-disposable-mariadb.test.ts` 미실행(`T108_OPS_DB_PORT` 필요, 서버에 다른 세션 DB 가 떠 있어 건드리지 않음) — 코드상 `sourcesChecked` 를 단언하지 않아 영향은 없다고 보나 실행 확인은 아니다. ② 운영 DB 의 `broker_fill_runs` 표 존재 여부와 운영 출력 대조 안 함. ③ 화면의 새 조합 렌더 검증 없음(합성 DTO 시험 4조합만 통과, `OpsSection.tsx:135~139` 는 코드 읽기만). ④ 브라우저 화면 검증 미수행(화면 구조 변경 없음, demo none). ⑤ ESLint 설정이 없어 린트 미실행.
- [23:58] 남은 위험(비차단): ① 6정상+prep 이면 홈이 「원천 6개 정상」만 말하고 「준비 중 1개」는 보이지 않는다(T-130 범위, Reviewer ⑤ 동의). ② 동작 변경 1종 — prep 만(또는 prep+오류 전부) 입력이 zero 에서 error(all_sources_failed) 로 바뀐다. 운영 도달은 나머지 6개가 동시에 실패해야 해서 낮다(Reviewer·Developer 판단과 같음). ③ 커밋 전 상태(detached worktree, 미커밋).
- [23:58] 배포 인계: 보류. 판정은 PASS 지만 변경이 커밋·push 되지 않아 deployer 가 실행할 origin ref 가 없다. 커밋·push 뒤 인계할 때 `post_deploy_checks` 후보 = 홈 A4 행의 「원천 N개 정상」 숫자와 이상 건수가 배포 전과 같은지(운영 표 있음 기준 불변), `/api/health`, pm2 `stockinvest-cron` 1개.
- [23:58] **QA 최종: PASS**
- [00:49] 병합 상태(T-139+T-140, integ3 @ `44d6011f2b866e307cacc74d7c45d6bc652e00b4`, tree `5379d79a0028e398ac969ba21a3aff117d887547`) 전체 jest 362 스위트 통과(7 skipped) · 10445 통과 · 245 skipped · 실패 0 · `tsc --noEmit` exit 0 · `next build`(`.env` 없이) exit 0. T-140 개별 PASS 는 그대로 유효.

## Codex 검토

- [2026-10-31] 이 task 의 변경은 Codex 로 검토하지 않는다(소급 검토 5건으로 한도 사용 중이고 독립 Reviewer·QA 가 있다). judge `codex_gate` 판정을 따른다.

## 최종 요약

### [T-140] 운영 지표 「확인한 원천 수」가 준비 중 원천을 읽은 것으로 세던 문제 정정

- **상태**: ✅ 운영 반영 완료 (2026-11-01 09:41 KST) — 구현·Reviewer·QA 완료, 배포 직후 점검 이상 없음. 화면 숫자 확인은 사용자 몫(아래)
- **무엇이 바뀌었나**: 홈·분석의 데이터 상태 지표에서 「준비 중」(표 없음 등) 원천을 확인한 원천 수에서 뺀다. 원천 6개 정상 + 1개 준비 중이면 「원천 7개 정상」이 아니라 「6개 정상」, 나머지 6개가 전부 오류이고 1개가 준비 중이면 「이상 6건」이 아니라 조회 실패(all_sources_failed)로 나온다. **운영 현재(표 있음) 출력은 변경 전과 바이트 동일**이라 지금 화면 숫자는 달라지지 않는다. 설계 문서 두 곳에 상태 정의 한 줄씩 보강.
- **배포**: ✅ 2026-11-01 09:39 push(`d0d203c..81a1aab`) → 09:41:41 완료, 릴리스 `20261101-094008-81a1aabe`, `RELEASE_RESULT ok`, 마이그레이션 없음. 이 작업의 코드 커밋은 `967259f`(side branch `cbc85ee` 를 T-139 뒤에 cherry-pick). 같은 배포에 실린 것: T-139 `3d40f6a`, 문서 커밋 `81a1aab`. 롤백 대상 `20261101-093319-d0d203cf`.
- **AI 가 검증한 것**: 독립 Reviewer PASS(무작위 입력 10만 개 변경 전후 비교 — prep 없는 입력 차이 0, 변이 10종 전부 검출), QA PASS(`exit-and-sources` 49개, 범위 1116개, `tsc`), 수정 전 코드로 되돌리면 새 시험 6개 실패 확인. 병합 상태 검증은 T-139 블록과 같다.
  - 검증 못 한 것: 화면에서 새 조합 렌더 · 운영 DB 의 브로커 원장 표 존재 · 일회용 MariaDB 시험 1개(환경변수 필요, 영향 없다고 판단)·ESLint(설정 없음).
- **👉 사용자가 확인할 것**: 배포 후 홈 → 운용현황 A4 「데이터 이상」 행의 「원천 N개 정상」 숫자와 이상 건수가 배포 전과 같은지 → 같으면 정상(운영 표가 있으므로 불변이 기대값).
- **👉 사용자가 결정할 것**: 없음(배포 완료).
- **남은 일**: 6정상+준비 중 1일 때 홈에 「준비 중 1개」가 보이지 않는 점 · `checkCoverage.anomalies` 가 true 로 남는 점 · 계약 초안 §1.1 에 `zero`·`blocked` 행 없음 — T-130 계열(designer/Leader 문구 판단). 문서 Low(청산 평가 문구 일부)는 QA 대조로 마감.
- **이슈·위험**: prep 만(또는 prep+오류 전부) 입력이 zero → error 로 바뀌는 것이 유일한 동작 변경 — 운영 도달은 나머지 6개 원천이 동시에 실패해야 해서 낮다. 롤백: `git revert` 후 push.

## 배포 기록

- [2026-11-01 09:39] **배포 완료** — T-139 와 같은 push·같은 릴리스다(`d0d203c..81a1aab`, 릴리스 `20261101-094008-81a1aabe`, `RELEASE_RESULT ok`, 09:39:59~09:41:41 `exit=0`). 병합 상태 재검증(tree `8ec03ee8`: jest 10455 통과·실패 0, `tsc` 0, `next build` 0)과 배포 후 점검 결과는 [[T-139-record-switch-bounded-read]] 의 「배포 기록」에 한 번만 적었다.
- 이 작업 쪽 확인: 릴리스 소스 `src/lib/ops/metrics/anomalies.ts:182` 에 `s.state !== 'prep'` 반영됨, 빌드 통과, health green. **홈 → 운용현황 A4 「데이터 이상」 화면 숫자는 로그인이 필요해 AI 가 직접 보지 못했다(미확인)** — 운영 표가 있으므로 변경 전과 같은 숫자가 기대값이고, 시험(무작위 10만 입력 차이 0)으로만 확인했다.
- 배포 시각은 승인 시점 계획(05:10~08:30 창)과 달리 일요일 09:39(휴장일)였다 — T-139 기록 참고.

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음 | - | - | judge: none | 10-31 23:21 |
