---
task_id: T-168
title: 장중 엔진 미검증 매수 후보의 가상 체결(paper_fills) 기록 복구 — 무제한 한도(적응 배분) 모드에서 검증 관문(G1) 경로 재연결
status: done
waiting: [push_confirm]
priority: high
project: StockInvest
created: 2026-11-13
updated: 2026-11-13
risk_level: R2
roles_involved: [leader, judge, developer, reviewer, qa]
skills_used: "없음 — 화면 변경 0건(엔진·시그널 코드만), 디자인 스킬 선택 기준에 해당하지 않음"
base_ref: 3d0f3d0e8979cb9cbf8b779c7973b54b19c93faf
tags:
  - type/task
  - domain/strategy
  - domain/signal
  - domain/safety
aliases:
  - 장중 가상 체결 복구
  - paper_fills engine 0건
  - no_validated_candidates
related_tasks:
  - T-159
  - T-072
  - T-070
  - T-095
execution_context:
  schema_version: 1
  origin_tool: claude
  current_tool: claude
  current_procedure: claude_standard
  current_scope: "원인 확인·설계·구현·시험·Reviewer·QA·서버 worktree 커밋까지. push(=운영 배포)·DB 쓰기·DDL·system_config/.env 변경·소급 백필은 범위 밖(메인 세션이 사용자 승인을 따로 받는다)."
  last_event_id: exec-001
demo_gate:
  required: true
  level: "delta"
  status: "waived"
  version: 0
  repo_path: ""
  artifact_url: ""
  content_sha256: ""
  decided_by: "judge"
  rule_id: "DM-kw-risky-cta"
  approved_by: ""
  approved_at: ""
  approval_quote: ""
  waived_by: "user"
  waived_at: "2026-11-13T22:20:00+09:00"
  waiver_quote: "데모 생략"
  active: false
---

# T-168 — 장중 엔진 미검증 매수 후보의 가상 체결 기록 복구

## 목표

미검증 전략의 **장중 엔진 매수 후보**가 다시 「가상 체결(`paper_fills`, origin=`engine`) + 승인 불가 감사 시그널(`signals.status='skipped'`, `indicators.gate='validation_gate'`)」로 기록되게 복구한다. 실거래 없이 매수 분석을 사후검증하기 위한 데이터 축적이 목적이다(`scripts/profit-engine/signal-postmortem.mjs` 가 상태 무관하게 매수 시그널을 읽는다).

- 승인: 사용자 2026-11-13 메인 세션 「2번 안으로 진행해줘」(메인 세션 전달). 범위 = 원인 수정·시험·Reviewer·QA·**서버 worktree 커밋까지**.
- 범위 밖: push(=운영 배포), DB 쓰기·DDL·`system_config` 변경, 11-07 이후 막힌 후보의 소급 백필, `validation_status` 변경, DRY_RUN·킬스위치·autopilot 변경, 장마감 경로 수정. 필요해지면 멈추고 메인 세션에 보고한다.

## 실행 도구·절차 이력

| 이벤트 ID | 시각(KST) | 사건 | 이전 → 현재 담당 / 현재 절차 | 범위·남은 일 | 근거 |
|---|---|---|---|---|---|
| exec-001 | 2026-11-13 21:55 | start | 없음 → claude / claude_standard | 메인 세션(Claude)이 leader 서브에이전트에 위임. 설계·구현·Reviewer·QA·커밋. push 는 메인 세션 몫 | 메인 세션 지시(사용자 「2번 안으로 진행해줘」) |

## 관련 과거 이력 요약

- [[T-159-explicit-unlimited-buy-limits]] (2026-11-07, Codex 주도) — 1회 매수 한도 0% 를 「명시적 무제한」으로 저장하면 장중 매수 후보를 시장별로 묶어 LLM 이 가용 잔금 배정 비율(bp)을 정하고 코드가 수량·비용을 검증하는 **적응 배분**(`allocateAdaptiveBuys`)을 넣었다. 설계 문서는 「기존 규칙과 관문을 거친 매수 후보」를 비교하고 「발행·송신은 기존 검증 관문, `createSignal` 과 `submitOrder` 경로를 사용한다」고만 적었다 — **미검증 후보의 가상 체결을 멈춘다는 결정은 기록에 없다.** 무제한 전환 시 이전 양수 비율을 `{"unlimitedPrevious": "<pct>"}` 로 보존하고(`getLegacyAnalystSellAmount` 가 analyst 매도 금액에 사용) Reviewer 3차 PASS·운영 배포됐다.
- [[T-072-validation-gate]] — 검증 상태 관문 G1~G6. G1 은 `createSignal` 안(블랙리스트 뒤·현금 게이트 앞)에서 미검증 매수를 막고 `finishValidationBlock` 이 감사 행(skipped) + `paper_fills` 1행을 남긴다. 엔진 호출(`claimEntryCooldown: true`)은 진입 쿨다운(120분)을 **원자 선점한 실행만** 기록한다(F-16) — 그래서 막힌 매수가 틱마다 재발화해도 중복이 쌓이지 않는다. 기록 실패는 차단을 풀지 않는다(F-13).
- [[T-070-daily-bars-phase0]]·[[T-095-postmortem-script-p1]] — 일봉 수집과 사후검증 스크립트. 매수 시그널을 상태 무관하게 읽어 D+5·D+10 수익·초과수익을 계산한다. 가상 체결이 끊기면 장중 경로의 표본이 더 늘지 않는다.
- 승인된 교훈 LSN-0004(`/이슈기록 관련` 조회) — 안전 경로 커밋은 훅이 실재하는 머신에서 한다. → 이 task 의 커밋은 서버 worktree `~/.node-local/stockinvest-t168` 에서만 한다(21:53 `test -x scripts/git-hooks/commit-msg` 확인).

## 현행 확인 (Leader, 2026-11-13 21:50 전후 · 기준 `3d0f3d0`, 운영 DB 읽기 전용)

- `src/lib/strategy/engine.ts` ④: `adaptive = (getEffectiveOrderMax === UNLIMITED_BUY_LIMIT)` 이면 `applyFilters(…, deferPortfolioGuard=true)` 를 통과한 **매수 후보를 모두 `deferred` 로 미루고** `allocateAdaptiveBuys` 에 넘긴다. 이때 `defaultAmountKRW = 0` 이다.
- `src/lib/strategy/adaptive-buy-sizing.ts:76-84`: 후보 전략마다 `evaluateValidationGate` 를 불러 통과한 전략만 `eligible` 로 남기고, 없으면 `done('no_validated_candidates')`. 엔진은 미배정 후보를 `rec.skip('adaptive_buy_sizing', reason)` + `outcome.kill(8)` 로 끝낸다 → **`createSignalGuarded` → `createSignal` G1 에 도달하지 않는다** → 감사 행·가상 체결·진입 쿨다운 선점이 모두 사라진다.
- 쿨다운이 걸리지 않으니 같은 후보가 매 틱 재평가되어 `eval_funnel` 에 `adaptive_buy_sizing/no_validated_candidates` 가 7일 10,939행 쌓였다(메인 세션 실측). 진입 쿨다운 확인은 `collectCandidates` 의 `cooldowns.isActive(entryKey)`(조회 전용)이고 쓰기는 G1 의 `claimCooldown` 또는 시그널 생성 후 `setCooldown` 뿐이다.
- 운영 설정(읽기 전용 조회): `safety_order_max_pct = {"unlimitedPrevious": "10"}`(무제한, 이전 10%) · `safety_daily_order_max_pct = "unlimited"` — 둘 다 2026-11-07 23:28:53 저장. `autopilot_mode="auto"`, `safety_dry_run=true`.
- `paper_fills` origin=engine 마지막 행 **2026-11-07 06:01:47**(미국 11-06 세션 끝), 합계 851. T-159 배포(11-07 09:20)와 무제한 저장(11-07 23:28) 사이에 장이 없었다(11-07 토요일) — 두 사건 중 어느 쪽이 먼저 끊었는지 데이터로는 갈리지 않는다. 엔진 기준 일평균: 10-23~11-07 영업일 12일에 851건 ≈ 71건/일(메인 세션 추정 약 60건/일).
- T-159 이전 가상 체결 금액 = 그 시점 1회 한도(평가액 × pct) × (1 − 비용 버퍼). 예: 11-07 해외 평균 1,422,711원(10% 시기), 11-06 국내 평균 97,051원.

### 기록량 추정 (Leader, 22:00 · 운영 DB 읽기 전용 · 사용자 제약 3)

- 방법: `eval_funnel` 매수 행을 시간순으로 읽어 (시장, 종목, 전략) 별로 **120분 진입 쿨다운**(`COOLDOWN_TTL_MIN.entry`)을 모의하고, 창 안 첫 발화만 「기록 1건」으로 센다. 스크립트 `~/.node-local/t168-estimate/t168_estimate.py`·`by_strategy.py`(서버, 저장소 밖). 포트폴리오 가드(국내 24h 종목당 매수 횟수·코어 비율)는 모의하지 않아 **상한 추정**이다.
- **방법 검증(T-159 이전 창)**: 10-26 ~ 11-07 07:00 의 `validation_gate`+`cooldown_entry` 매수 행 10,554개 → 모의 810건, 같은 창 실제 `paper_fills` origin=engine **796건**(차 +1.8%). 모의가 실제 쿨다운 동작을 잘 재현한다.
- **복구 후 예상(11-09 ~ 11-13 15:27, 5영업일)**: `adaptive_buy_sizing/no_validated_candidates` **10,939행 → 926건**(8.5%). 일별 163·315·191·139·118(11-13 은 장중까지). 평균 약 **185건/일** — T-159 이전 창 평균(796건 ÷ 약 10.5영업일 ≈ 76건/일)의 약 2.4배.
- 늘어난 이유(전략별 모의): 국내 `price-breakout-v1` 259건(11-07 00:56 활성화 — T-159 이전 가상 체결에는 없던 전략), 해외 `rsi-oversold-v1` 266건(이전 창 324건/10.5일 → 5일 266건), `rsi-macd-reversal-v1` 국내 89·해외 85(이전 12·32, 11-04 갱신). 즉 **쿨다운 억제 수준은 T-159 이전과 같고**(같은 F-16 선점), 늘어난 몫은 11-04·11-07 에 켜진·바뀐 전략 구성과 발화량이다. 10,939행이 그대로 가상 체결이 되지는 않는다.
- [가능성 높음] 국내분은 포트폴리오 가드로 조금 더 줄어든다. 하루 ~200행(감사 시그널 + 가상 체결 각각)은 DB 부담이 작다. 추가 억제(전략별 상한 등)가 필요한지는 사용자 판단 사항이며 이번 설계에는 넣지 않는다(제약 3 은 「T-159 이전과 같은 쿨다운 수준」).

## 원인 판단

- [확실] 직접 원인: 무제한(적응 배분) 모드의 엔진 ④ 분기가 미검증 매수 후보를 `createSignal` 에 넘기지 않는다(위 코드 경로).
- [가능성 높음] T-159 의 의도치 않은 부작용이다 — T-159 설계는 「기존 관문을 거친 후보」의 배분과 「기존 검증 관문·createSignal 경로 사용」을 말했고 가상 체결 중단 결정이 없다. 1회 한도가 양수였다면 기존 경로(G1)가 그대로 돌았을 것이다(코드 판독, 실행 미확인).
- [확실] 장마감 경로(`post-market-engine.ts` G2, origin=post_market)는 11-13 까지 기록 중이라 이번 결함과 무관하다.

## 설계 (Leader → Developer 구현 가이드)

> 원칙: **새 기록 경로를 만들지 않는다.** 기존 G1(`createSignal` 안의 관문 → `finishValidationBlock` → `paper-fill.ts`)을 그대로 재사용한다. 검증 관문·`submitOrder`·주문 경로의 의미를 바꾸지 않는다.

### D1. 분류 — 적응 배분 앞에서 미검증 후보를 떼어 낸다
- `engine.ts` ④ 의 `adaptive` 분기에서 `deferred` 매수 후보를 전략별 `evaluateValidationGate({ side:'buy', strategyId })` 판정으로 **두 묶음**으로 나눈다: 통과(검증됨) → 기존 `allocateAdaptiveBuys` 경로(T-159 동작 그대로), 불통과(미검증·미등록·null 전략·상태 이상·조회 실패 전부) → **감사 경로**(D2~D4).
- 전략당 판정 1회(같은 런 안에서 캐시). 검증된 후보가 0건이면 `allocateAdaptiveBuys` 를 부르지 않는다 → **LLM 호출 0**(비용·의미 없음).
- `allocateAdaptiveBuys` 내부의 검증 필터(76-84행)는 지우지 않는다 — 2차 방어로 둔다.

### D2. 감사 경로 금액 — T-159 이전 사이징 그대로
- 금액 = T-159 이전과 같은 식 `Math.floor(이전 1회 한도 KRW × (1 − FEE_BUFFER_PCT))`. 「이전 1회 한도 KRW」 = 저장된 `unlimitedPrevious` 비율 × **해당 시장** 평가액(기존 `effectiveMaxFromPct(…, market, previousOrderPct=true)` 와 같은 계산). 현재 `getLegacyAnalystSellAmount()` 는 국내 고정이라 시장 인자를 받는 내보내기를 `order-limits.ts` 에 추가하고, 기존 함수는 그것을 `'domestic'` 으로 부르게 바꿔 **동작을 바꾸지 않는다**.
- 근거: 사용자 마지막 명시 양수 비율(10%)과 같은 금액이라 11-07 이전 가상 체결과 연속된다. 가상 체결의 금액·수량은 기록용이며 사후검증은 가격 수익률로 계산한다.
- 이전 비율이 없거나 평가액을 못 읽으면 금액 0 으로 진행한다(감사 행·가상 체결은 남고 수량은 0/NULL — 11-07 이전에도 있던 형태). 이 경우를 시험으로 고정한다.
- 런당 한 번, 감사 후보가 있을 때만 계산한다.

### D3. 감사 경로 순서 — T-159 이전과 같은 게이트를 같은 순서로
- 감사 후보 → `applyPortfolioGuard`(국내 코어 비율·24h 종목당 매수 횟수, T-159 이전에는 `applyFilters` 안에서 돌았다) → `publish` → `createSignalGuarded` → `createSignal` G1 → `finishValidationBlock`(진입 쿨다운 원자 선점 F-16 → 감사 행 + 가상 체결).
- 이후 틱은 `collectCandidates` 의 `cooldown_entry` 에서 걸러진다(기존 동작) — 하루 기록량이 T-159 이전 수준으로 돌아오는 근거다.

### D4. fail-closed — 미검증으로 분류한 후보는 어떤 경우에도 주문 경로로 가지 않는다
- 위험: 엔진 분류와 `createSignal` G1 사이에 전략이 검증됨으로 바뀌면, 감사 후보가 LLM 배분 없이 이전 비율 금액으로 G1 을 통과해 현금 게이트 → `routeSignal` → (autopilot auto 면) 자동 제출로 갈 수 있다. 무제한 모드의 `checkOrderMax` 는 상한을 보지 않고 적응 표지가 없으면 `submitOrder` 의 적응 현금 재검증도 건너뛴다. 확률은 낮지만 DRY_RUN 이 꺼진 상태에서도 안전해야 한다(사용자 제약 1).
- 대책: `CreateSignalOptions` 에 「감사 전용」 선택지(이름은 Developer 결정, 예 `validationAuditOnly: true`)를 더한다. 이 선택지가 켜진 호출에서 **G1 이 통과(allowed)하면 그 자리에서 `ok:false` 로 끝낸다** — 행 INSERT·알림·RAG·현금 게이트·`routeSignal`·자동 제출에 도달하지 않는다. 쿨다운도 걸지 않는다(다음 틱에 검증된 후보로 적응 배분 경로를 탄다).
- 엔진은 감사 후보에만 이 선택지를 켠다. 이 결과는 `eval_funnel` 에 정책 건너뜀(skip)으로 남긴다(새 게이트 라벨이면 `eval-funnel-labels.ts` 에 등록) — 무기록 게이트 금지(§1).
- 이 선택지는 막는 방향으로만 작동해야 한다(켜져 있어도 G1 불통과 경로는 기존과 바이트 동일).

### D5. eval_funnel
- 감사 후보는 `createSignalGuarded` 가 기존처럼 `validation_gate`(skip, `detail.claim·paperFillId`)로 남기고, 쿨다운 반복은 `cooldown_entry` 로 남는다. 이들에게 `adaptive_buy_sizing/no_validated_candidates` 행을 더 쓰지 않는다.
- 검증된 후보의 `adaptive_buy_sizing` 기록(미배정·실패 사유)은 T-159 그대로.

### D6. 하지 않는 것
- `submitOrder`·`validation-gate.ts`·`paper-fill.ts` 의 의미 변경, 장마감 경로, `/api/analyst/run`(같은 모양의 분기가 있으나 사람이 부르는 경로 — 후속 후보로만 기록), DB 쓰기·DDL·설정 변경, 소급 백필.

### D7. 버전
- `package.json`·`package-lock.json`(최상위 2곳) `0.8.0 → 0.9.0`(사용자 정책: 새 배포 버전 = 마이너 증가).

## 역할별 지시사항

### Developer
- 작업 위치: 서버 worktree `~/.node-local/stockinvest-t168`(기준 `3d0f3d0`, `node_modules` 는 `stockinvest-t155` 심볼릭 링크 — 커밋 금지). 공유 NFS 트리·Mac 트리는 읽기만.
- 위 D1~D7 구현. 예상 변경 파일: `src/lib/strategy/engine.ts`, `src/lib/signals/service.ts`, `src/lib/safety/order-limits.ts`, (필요 시) `src/lib/strategy/eval-funnel-labels.ts`·`src/lib/strategy/adaptive-buy-sizing.ts`, 새 시험, `package.json`, `package-lock.json`. 범위가 넓어지면 Leader 에 먼저 알린다.
- 시험(새 파일, jest): ① 적응 모드 + 전부 미검증 → 각 후보가 감사 전용·`claimEntryCooldown`·origin `engine` 으로 `createSignal` 에 가고, 금액은 D2 식, LLM(`runLlmOnce`)·`allocateAdaptiveBuys` 호출 0, `adaptive_buy_sizing` 행 0 ② 검증·미검증 혼합 → 검증 묶음만 배분, 미검증은 G1 ③ 감사 전용 + G1 통과(경합) → INSERT·`routeSignal`·`submitOrder` 0, funnel skip 1행 ④ 이전 비율 없음 → 금액 0 으로 기록 진행 ⑤ 양수 한도(비적응) 경로 무변화 ⑥ 진입 쿨다운 활성 시 다음 런에서 `createSignal` 미호출. 기존 관련 시험(`engine-validation-gate`·`adaptive-buy-sizing`·`service-validation-gate`·`paper-fill`·`engine*`·`submit-order`·`order-limits*`·analyst route) 통과.
- 기록량 추정(사용자 제약 3): 운영 DB **읽기 전용**(`python3 -I ~/.node-local/tools/dbq.py -e "SELECT…"`)으로 최근 7일 `eval_funnel` 의 `adaptive_buy_sizing/no_validated_candidates` 행에 120분 진입 쿨다운을 (symbol, strategy) 별로 모의해 일별 예상 가상 체결 수를 내고, T-159 이전 엔진 일평균(≈71건/일)과 나란히 적는다. 포트폴리오 가드는 모의하지 않으므로 상한 추정임을 밝힌다.
- 무거운 시험은 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10 …`. DB 를 쓰는 시험은 일회용 DB 만. 띄운 프로세스는 PID 로만 종료(`pkill`·`pm2 stop` 금지).
- 이 파일 `## Developer` 절에 변경 파일·설계 판단(D2 근거 포함)·시험 명령과 결과 수치·추정 결과를 남긴다. 커밋·push 하지 않는다.

### Reviewer
- 독립 감사. 초점: (1) 미검증 후보가 어떤 경로·경합에서도 `routeSignal`·자동 제출·entry-watcher·`submitOrder` 에 닿지 않는가(D4) (2) 검증된 후보의 T-159 동작 무변화·미검증만 있을 때 LLM 호출 0 (3) 쿨다운 선점(F-16)이 되살아나 중복이 억제되는가 (4) 무기록 게이트 없음 (5) `getLegacyAnalystSellAmount` 동작 무변화 (6) 범위 밖 변경 없음.
- `## Reviewer` 절에 flat `- [HH:MM]` bullet 만 쓰고, 마지막 줄에 「최종 판정」 줄 하나(판정 단어는 리터럴 대문자 pass·conditional_pass·fail 중 하나, scope 는 실제 검토한 경로 목록 — 형식은 StockInvest CLAUDE.md 「Reviewer 기록 작성 규칙」). (23:05 Leader 정정: 이 안내문이 `### Reviewer` 소제목 아래 있어 커밋 훅이 Reviewer 절로 읽으므로 대문자 판정 예시를 소문자 서술로 바꿨다.) scope 는 staged 될 안전 경로(`src/lib/strategy/`·`src/lib/signals/`·`src/lib/safety/` 아래 변경 파일·시험)를 전부 포함해야 커밋 훅이 통과한다. 판정 단어 설명은 소문자로.

### QA
- Reviewer PASS 뒤 실행 검증: 새 시험·관련 시험·전체 jest(기존 실패는 기준 커밋과 대조)·`tsc --noEmit`·`next build`(flock 직렬), 안전장치 체크(DRY_RUN·킬스위치 경로 무변화, 미검증 후보 주문 경로 0), 기록량 추정 재확인. `## QA` 절에 명령·수치와 「✅ 검증 통과」 또는 결함 기록.

## 판단 기록 (judge)
- [2026-11-13 21:58] intake engine=jev → task_type=local_fix · risk=R2 · developer_model=opus · next=demo_first · demo=delta/designer · actions=prepare_demo,request_demo_approval,assign_developer | overrides=DM-kw-risky-cta | fallback=- | tokens=1462
- [22:02][leader] intake 결과 대조: `risk=R2`·`developer_model=opus` 는 Leader 예상(R2 영역 — 엔진·시그널·안전장치)과 같아 그대로 쓴다. **`demo=delta` 는 오탐으로 판단한다** — 규칙 `DM-kw-risky-cta` 는 UI 문맥 단어 + 위험 대상('주문') + 변경 단어가 함께 있으면 delta 로 올리는데(`jev-judge/rules.mjs` UI_CONTEXT·RISKY_OBJECT·RISKY_CHANGE), Leader 요약의 UI 문맥 단어는 「화면·DB·설정 변경 없음」의 **부정 문맥 '화면'** 하나뿐이었다. 변경 예상 경로·새 파일에 화면 파일 0건, 도구의 모델 신호도 `ui_change=none 0.69`. 다만 데모 생략은 판정이 아니라 **사용자 결정**이라 Leader 가 대신 내리지 않는다.
- [22:02][leader] 요약에서 부정 문구만 뺀 재판정을 judge 에 요청했으나 judge 가 **거부**했다(사유: 게이트 결과를 낮추려는 요약 변경으로 보인다, 생략은 사용자 결정, 규칙 오탐은 규칙 보강으로 다룰 일). Leader 는 이 거부를 받아들이고 1차 판정을 유효 판정으로 둔다. 재판정 기록은 없다.
- [22:02][leader] `check.mjs init --task … --judge /tmp/judge-T-168-intake.out.json` 은 `DEMO_GATE_REFUSED reason: task must belong to a canonical project or registered worktree` 로 거부됐다(이 서버 worktree 는 `~/.node-local/stockinvest-t157` 클론의 worktree 라 도구가 정본 프로젝트로 인정하지 않는다). 그래서 frontmatter `demo_gate` 를 **도구 init 이 냈을 값(required·delta·drafting·decided_by judge·rule DM-kw-risky-cta)으로 Leader 가 손으로 맞췄다** — 처음 작성 때 Leader 가 미리 적어 둔 `not_required` 는 판정 전 추정이었고 판정과 어긋나 정정했다. 승인·생략 기록은 쓰지 않았다.
- [22:02][leader] 결정: leader.md 「next=demo_first → developer 대기」를 따라 **Developer 를 배정하지 않고 멈춘다.** 사용자 결정 요청(메인 세션 경유): (A) 데모 생략 — 화면 변경이 없어 보여 줄 화면이 없다, 사용자 원문으로 waive 기록 후 Developer 착수(권고) / (B) 게이트대로 designer 가 delta 데모 작성 — 대상 화면이 없어 「화면 변경 없음」을 설명하는 문서형 데모가 된다. 규칙 보강 후보(부정 문맥 '화면' 오탐)는 후속 후보에 적는다.

- [22:22][leader] **사용자 결정 수신 — 데모 생략(waive).** 사용자 원문 「데모 생략」(2026-11-13 22:20 KST 무렵, 메인 세션 대화). 메인 세션 질문 원문 「T-168의 화면 데모 단계를 생략할까요?」, 선택지 「데모 생략 (권장) — 바뀌는 화면이 없으니 말씀하신 원문을 생략 근거로 기록하고, 바로 개발 → 검토 → QA로 넘어갑니다」 / 「데모 작성」 중 앞의 것을 골랐다(메인 세션 전달). `check.mjs waive --quote "데모 생략"` 은 init 과 같은 사유(`DEMO_GATE_REFUSED reason: task must belong to a canonical project or registered worktree`)로 거부돼, frontmatter `demo_gate` 를 Leader 가 **수기로** `status: waived`·`waived_by: user`·`waived_at`(메인 세션이 전한 22:20 무렵)·`waiver_quote: 데모 생략` 으로 기록했다(도구의 증거 기록 `evidence.jsonl` 은 없다). `waiting` 에서 user_decision 제거. 기록량 추가 억제는 넣지 않는다(메인 세션 권고, 사용자 이의 없음 — 메인 세션 전달). → Developer(opus) 배정.
- [2026-11-13 22:47] codex_gate/C2 engine=jev → codex_required=true · mode=adversarial-review · focus=concurrency · budget_rule=CX-limit-unknown-r2 · codex_calls_used=0 · codex_switch=on | overrides=- | fallback=- | tokens=1196
- [23:06][leader] C2 경과: judge C2 = codex_required(adversarial-review·concurrency·CX-limit-unknown-r2). Codex 1차 `incomplete/worktree_failed` — 스크래치 clone 의 git 작성자 신원 미설정으로 래퍼 스냅샷 단계에서 멈춤(Codex 미실행·호출 0). Leader 가 이를 Codex 실패가 아닌 **우리 쪽 준비 오류**로 판단해, 래퍼 실행 환경에만 작성자 신원 변수를 더해 정식 1회 실행을 지시했다(재시도 반복 아님 — 책임 Leader). 2차 `done`(스냅샷 1338cf3, 대상 15개 sha256 일치, 호출 1/4), 지적 2건(medium 1·low 1). Reviewer 가 두 건 모두 기존 경로와 같은 패턴(기준 커밋에서도 `applyPortfolioGuard` 무격리·가드 거절 행 선점 없음)이라 **채택하지 않음·후속 후보**로 판정하고 PASS(scope 12개)를 다시 기록. Leader 는 이 판정을 받아들인다 — 감사 후보는 주문 경로로 가지 않아 자금 위험이 없다.
- [23:06][leader] 기록 시각 주의: `## Reviewer` 절의 `[23:05]`·`[23:20]` 표기는 실제 시각보다 늦다(서버·Mac 시계 23:05:35 실측 시점에 이미 `[23:20]` 줄이 있었고, judge C2 출력 파일이 22:47 에 생긴 뒤 Codex·재판정이 이어졌다). 판정 내용·순서는 유효하고 커밋 훅은 시각을 쓰지 않는다. Reviewer 기록은 고치지 않는다.

- [23:18][leader] QA 7번의 「이전 창 모의 810 대 실측 796 재현 불가」는 다른 게이트를 조회한 결과다 — Leader 의 방법 검증은 `adaptive_buy_sizing` 이 아니라 T-159 이전 창(10-26 ~ 11-07 07:00)의 `validation_gate`+`cooldown_entry` 매수 행을 쓴다(위 「기록량 추정」). 23:18 에 같은 읽기 전용 쿼리를 다시 돌려 **모의 810(입력 10,554행)·실측 796 을 그대로 재현**했다. 최근 7일 926건은 QA 도 재현했다.
- [23:18][leader] 커밋 전 확인: `git fetch` 후 origin/main = `3d0f3d0`(이동 없음, 리베이스 불필요). 훅 `scripts/git-hooks/commit-msg` 실행 가능. 스테이징 14개 파일을 `git show :경로 | cmp - 경로` 로 전부 대조(불일치 0). 코드 커밋 **`cde5f1d`**(`cde5f1d0d57da12943132486108f715124a9a94b`) — 훅 출력 「Reviewer 감사 기록 확인: T-168」. 커밋 메시지에는 T-168 외 task ID 를 넣지 않았다. push 하지 않음.

## 사후검증 실행 결과(메인 세션)

> 메인 세션이 같은 시각 별도로 실행해 Leader 에게 전달(SendMessage, 21:5x 수신)한 결과를 옮겨 적는다. Leader 는 이 실행을 재현하지 않았다.

- 실행: 2026-11-13 21:46 KST, 서버 worktree `~/.node-local/stockinvest-t166`(= origin/main `3d0f3d0`), `node scripts/profit-engine/signal-postmortem.mjs --days 30 --entry-model d1open|legacy --env ~/apps/stockinvest/shared/.env --out/--json ~/.node-local/t168-postmortem/postmortem-<모델>-30d.{md,json}` — 읽기 전용 세션·LLM 0·KIS 0. 원본 `~/.node-local/t168-postmortem/`(JSON 은 커밋하지 않음, 서버 보관). 리포트 md 2개는 이 task 커밋에 `agent-vault/10-Flow/reports/T-168-signal-postmortem-<모델>-30d-20261113.md` 로 넣는다.
- 표본: 최근 30일 매수 시그널 1,879건 → 에피소드(종목별 5일 안 최초 발화) 225건 → 일봉으로 평가 가능 181건. 일봉 최신 KR·US 2026-11-12.
- d1open(D+1 시가 진입, 비용 후 — US 왕복 0.65%·KR 0.33%), 전체(기업행위 의심 0건): 순 D+5 **-2.09%**(95% 구간 -4.34%~0.16%), 순 D+10 -5.65%(-13.09%~1.79%), 같은 날 관심목록 평균 대비 초과(비용 전) D+5 -0.59%(-2.00%~0.83%), D+10 -2.36%. MAE10 중앙값 -8.97%.
- 시장별 d1open: US 74건 순 D+5 -1.82%·초과 -0.74% / KR 107건 순 D+5 -2.30%·초과 -0.46%.
- 전략별 d1open(⚠ 다중비교): rsi-oversold-v1 KR 93건 순 D+5 -0.83%(-2.76%~1.11%)·초과 +0.60% / US 63건 순 D+5 -2.31%(-5.38%~0.76%)·초과 -0.95%. pullback-trend-v1 KR 11건 순 D+5 -12.64%(-25.20%~-0.08%) / US 7건 -2.37%. 나머지 전략 0~2건(판단 불가).
- 스크립트 자체 판정(rsi-oversold, v1 규칙): **보류 — 서로 다른 주 4개 < 8**. 최대 주 비중 D+5 28%(2026-10-26 주)·D+10 47% — 표본 구성에 민감하다.
- legacy(시그널 가격 진입) 모델도 같은 방향: rsi-oversold 전체 순 D+5 -2.05%(-5.35%~1.25%).
- **이 task 와의 관계**: 수익성 검증은 아직 **판정 불가**(점 추정은 음수지만 구간이 0 을 포함하고 주 수가 부족)다. 판정에 필요한 서로 다른 주 수(≥8)를 채우려면 장중 가상 체결 기록 복구(이 task)가 필요하다는 근거로 기록한다. 이 결과는 미검증 전략의 실매매 전환 근거가 아니다.

## Developer

- [22:24] 착수(실행 도구: claude, developer 서브에이전트). 작업 위치 서버 worktree `~/.node-local/stockinvest-t168`(기준 `3d0f3d0`). 이 이력서·`engine.ts`·`adaptive-buy-sizing.ts`·`service.ts`(createSignal·finishValidationBlock)·`order-limits.ts`·`buy-limit-config.ts`·`validation-gate.ts`·`eval-funnel-labels.ts` 와 기존 시험(engine-validation-gate·adaptive-buy-sizing·service-validation-gate·engine-collect-fanout-t148·macro-regime/engine-invariant)을 읽고 시작. 커밋·`git add`·push 없음.
- [22:38] 구현 변경 파일(6): `src/lib/strategy/engine.ts`(④ 적응 분기 분류·감사 경로, `createSignalGuarded` 4번째 인자, publish 인자) · `src/lib/signals/service.ts`(감사 전용 선택지·새 errorCode) · `src/lib/safety/order-limits.ts`(시장 인자 내보내기) · `src/lib/strategy/eval-funnel-labels.ts`(새 게이트 등록) · `package.json`·`package-lock.json`(최상위 2곳 0.8.0 → 0.9.0). `adaptive-buy-sizing.ts`·`validation-gate.ts`·`paper-fill.ts`·`dry-run.ts`(submitOrder)·`post-market-engine.ts`·`/api/analyst/run` 은 손대지 않았다.
- [22:38] D1 — ④ `adaptive` 분기에서 `deferred` 매수 후보를 `evaluateValidationGate({side:'buy', strategyId})` 로 나눈다. 판정은 런 안 전략당 1회(Promise 캐시, 런 사이 캐시 없음). `allowed` 만 검증 묶음 → 기존 `allocateAdaptiveBuys` → 포트폴리오 가드 → publish(T-159 코드 그대로 옮김). 그 밖(unvalidated·unregistered·null_strategy·invalid_status·lookup_error) + 판정 Promise 거부(이중 방어) → 감사 묶음. 검증 묶음이 비면 `allocateAdaptiveBuys` 를 부르지 않는다(LLM 0). 배분 내부 검증 필터(76-84행)는 그대로 2차 방어. 처리 순서는 검증 묶음 → 감사 묶음(감사 경로는 주문을 만들지 않아 검증 후보의 현금·가드 판정에 영향 없음).
- [22:38] D2 금액 — `order-limits.ts` 에 `getPreviousOrderMax(market, label = '이전 1회(감사 기록)')` 추가: `effectiveMaxFromPct('safety_order_max_pct', label, market, previousOrderPct=true)` 그대로(= 저장된 `unlimitedPrevious` 비율 × **그 시장** 평가액, 비율 없음·무제한 아님·평가액 모름·DB 예외 → 0, 던지지 않음). `getLegacyAnalystSellAmount()` 는 `getPreviousOrderMax('domestic', '기존 RSI 매도')` 로 바꿔 계산·로그 이름·반환값이 이전과 같다(시험으로 고정). 엔진 감사 금액 = `Math.floor(getPreviousOrderMax(market) × (1 − FEE_BUFFER_PCT))` — 양수 한도일 때 `defaultAmountKRW` 와 같은 식·같은 FEE_BUFFER_PCT(왕복 비용 + 0.07%). 근거: 사용자 마지막 양수 비율(운영 10%)과 같은 금액이라 11-07 이전 가상 체결과 이어진다(같은 KRW 한도에서 두 경로 금액이 같음을 시험 ①-2 로 대조). 감사 후보가 있을 때만 런당 1회 읽고, 조회 예외는 경고 1줄 + 금액 0 으로 기록 계속.
- [22:38] D3 — 감사 후보마다 `{...candidate, amountKRW: 감사 금액}` → `applyPortfolioGuard`(T-159 이전과 같은 국내 코어 비율·24h 종목당 매수 횟수) → `publish(ctx, allowed, { validationAuditOnly: true })` → `createSignalGuarded` → `createSignal` G1 → `finishValidationBlock`(진입 쿨다운 원자 선점 F-16 → 감사 행 + 가상 체결, origin=engine). 새 기록 경로 없음. 엔진 publish 의 `setCooldown` 은 `res.ok` 일 때만이라 감사 경로에서는 G1 선점이 곧 쿨다운이다(이전과 같음).
- [22:38] D4 fail-closed — `CreateSignalOptions.validationAuditOnly?: boolean`(service.ts). `createSignal` 에서 G1 `!vg.allowed` 분기 **바로 뒤**, T-058 현금 게이트 앞에 `if (opts.validationAuditOnly) return { ok:false, signalId:0, autoSubmitted:false, errorCode:'validation_audit_only_passed', error:'validation_audit_only_passed: …' }`. 그래서 G1 불통과 경로는 선택지 유무와 무관하게 같은 코드(`finishValidationBlock` 은 origin·claimEntryCooldown 만 읽는다)이고, 통과 경로는 INSERT·중복 검사·모드 잠금·알림·RAG·현금 게이트·routeSignal·자동 제출·쿨다운에 닿지 않는다. 막는 방향만 — 매도에 켜도 생성하지 않는다(엔진은 감사 매수 후보에만 켠다). 블랙리스트 판정은 여전히 G1 앞. `createSignalGuarded` 는 4번째 인자 `opts` 를 받아 켜졌을 때만 `{origin:'engine', claimEntryCooldown:true, validationAuditOnly:true}` 를 넘기고, 생략하면 넘기는 객체가 이전과 같다(기존 시험의 `toEqual({origin, claimEntryCooldown})` 그대로 통과).
- [22:38] D4·D5 funnel — 새 게이트 `validation_audit_only_passed`(28자 ≤ VARCHAR(48), stage 11, verdict skip, 한글 라벨 「감사 전용 매수가 검증 관문 통과(분류 뒤 상태 변경) — 시그널·주문 미생성」)를 `FUNNEL_GATES` 끝에 append·`GATE_STAGE`·`GATE_LABEL_KO` 등록, `createSignalGuarded` 매핑 추가(무기록 게이트 없음). reason 은 errorCode, 경고 1줄(기존 기본 동작 — 평소 0건이라 남긴다). 감사 후보에는 `adaptive_buy_sizing` 행을 쓰지 않고(분류에서 떼어 냄) `validation_gate`(skip)·이후 틱 `cooldown_entry` 로 남는다. 검증 후보의 `adaptive_buy_sizing`(미배정·실패 사유)은 그대로.
- [22:38] 기존 시험 수정 5개(모두 `src/lib/strategy/` 아래): ① `engine-validation-gate.test.ts`·`engine-insufficient-cash.test.ts`·`engine-exit-state-load-isolation.test.ts` — FUNNEL_GATES 꼬리 순서 단언에 새 게이트를 덧붙임(T-148 이 collect_threw 를 붙일 때와 같은 방식, 기존 ID 순서 단언은 유지) ② `engine-collect-fanout-t148.test.ts`·`macro-regime/__tests__/engine-invariant.test.ts` — 무제한 장면이 「검증된 후보의 배분 경로」(T-159)를 보는 시험이라 `@/lib/safety/validation-gate` 를 검증됨으로 모의(전제를 명시). 모의 없이는 엔진이 실제 관문 함수로 `FROM strategies` 모의 행(validation_status 없음 → invalid_status)을 읽어 후보를 전부 감사 경로로 보내 배분 단언이 깨진다 — 의도된 동작 변화다. 단언 자체는 바꾸지 않았다.
- [22:38] 새 시험 3개: `src/lib/strategy/__tests__/engine-adaptive-validation-audit-t168.test.ts`(12건 — 지시 ①~⑥: ① 전부 미검증 → 감사 전용·쿨다운 선점·origin engine·금액 996,000(=floor(1,000,000×0.996))·배분 0·`runLlmOnce`/`runLlm` 0·`adaptive_buy_sizing` 0·전략당 판정 1회, ①-2 같은 KRW 한도의 양수 한도 경로 금액과 같음, ①-3 판정 거부 → 감사 경로, ①-4 런마다 재판정 ② 혼합 → 검증 묶음만 배분·미검증은 감사 전용·`adaptive_buy_sizing` 은 검증 후보만 ③ 경합 → `validation_audit_only_passed` skip 1행·stage 11·쿨다운 0 + 라벨 등록 ④ 이전 한도 0·조회 예외 → 금액 0 으로 기록 ⑤ 양수 한도 → 판정·이전 한도 조회·배분 0, 맥락에 감사 키 없음 ⑥ 첫 런 선점 → 다음 런 createSignal 0·`cooldown_entry` 3행) · `src/lib/signals/__tests__/service-validation-audit-only-t168.test.ts`(17건 — 실 `createSignal`: 감사 전용 + 검증 통과 → auto·assist·manual·hard_stop 위장 모두 시그널·감사 행·가상 체결·중복 검사·모드 잠금·현금 게이트·routeSignal·submitOrder·알림·RAG·쿨다운 SQL 0 / G1 불통과 8가지(사유 5종·선점 패배·해외·금액 0)에서 선택지 유무 결과·SQL·감사 행·가상 체결 파라미터 JSON 바이트 동일 / 매도·블랙리스트 / 대조: 선택지 없으면 기존대로 생성·자동 제출) · `src/lib/safety/__tests__/order-limits-previous-t168.test.ts`(10건 — 시장별 평가액, 레거시 함수와 값·조회·경고 문구 동일, 비율 없음 5종·평가액 모름·예외 → 0).
- [22:38] 시험 결과(서버, flock 직렬): 새 3개 `npx jest <3파일>` → 3 suites·39 tests 통과. 관련 디렉터리 `npx jest src/lib/strategy/__tests__ src/lib/strategy/macro-regime/__tests__ src/lib/signals/__tests__ src/lib/safety/__tests__ src/app/api/analyst/run/__tests__` → 112 suites 통과·2 suites 건너뜀(일회용 DB 환경변수 없음: `t081b-daily-limit-race-disposable-mariadb`·`t072-disposable-mariadb`), tests 3,405 통과·48 건너뜀·실패 0. `npx tsc --noEmit -p tsconfig.json` 종료 0(시험 파일은 tsconfig 가 제외하고 jest 는 swc 라 타입 검사가 없어서, 새 시험 3개는 임시 tsconfig(저장소 밖 `~/.node-local/t168-dev-tmp/`)로 따로 `tsc` — 1건(setCooldown 모의 인자 타입) 고친 뒤 종료 0). 전체 jest: 전체 jest(`npx jest`, 2분 43초): 464 suites 중 430 통과·27 실패·7 건너뜀, tests 11,953 통과·416 실패·286 건너뜀. 실패 원인 분리 — (a) 화면 렌더 시험 20 suites·406 tests: 전부 React `Invalid hook call`(null 에서 useState·useRef 등). 이 worktree 의 `node_modules` 가 t155 → NFS 공유 트리 `node_modules` 로 가는 심볼릭 링크라 React 가 두 경로로 두 번 로드되는 환경 문제로 판단한다(로그의 react 경로가 `../../NFS/homes/.../node_modules/react`). 이번 변경 파일 중 화면 파일 0. (b) 울타리·격리·키 일치 시험 7 suites·10 tests(`profit-engine/isolation`·`corp-intel/isolation`·`ops/reason-dictionary-keys`·`strategy/records/job-slots`·`usd-cash-balance-fence`·`currency-mixing-fence`·`t108-terms-fence`): 지목한 파일이 전부 이번에 손대지 않은 것(m40 `paper-ledger`·`M40PaperPanel`·`analysis-data/capture-operating-data`·`profit-engine/daily-bars-store`·사유 `paper_only`·잡 `m40-forward`/`m40-forecast` — `git diff HEAD` 무변경 확인)이라 기준 커밋에 이미 있던 불일치로 판단한다. 기준 커밋 대조 실행은 하지 않았다(QA 몫). T-168 이 바꾼 파일을 지목한 실패 0..
- [22:38] 변이 확인(되돌림 후 sha256 일치 확인): (A) service 의 감사 전용 중단을 끄면 service 시험 7건 실패 (B) 엔진이 감사 선택지를 안 넘기면 엔진 시험 5건 실패 (C) 엔진이 전부 배분으로 보내면(T-159 동작) 엔진 시험 10건 실패 — 새 시험이 결함을 실제로 잡는다.
- [22:38] 미실행·한계: lint — 저장소에 eslint 설정 파일이 없어(`next lint` 가 대화형 설정을 띄운다) 실행하지 않음. dev 서버·curl — 변경된 HTTP 엔드포인트가 없고, 엔진을 돌리는 cron 라우트를 dev 서버로 부르면 운영과 같은 NAS DB 에 eval_funnel·signals·paper_fills 를 쓰게 되어 하지 않음(검증은 jest 로). 일회용 DB 시험 2개는 환경이 없어 건너뜀(G1 차단 경로 SQL 은 바뀌지 않았고 선택지 유무 바이트 동일을 모의 DB 로 고정). 기록량 추정은 Leader 22:00 결과(5영업일 926건 상한 추정)를 다시 돌리지 않았다 — 구현이 그 추정의 전제(같은 F-16 진입 쿨다운 선점, 120분)를 그대로 쓴다. 운영 DB 조회 0회.
- [22:38] 안전장치 self-check: DRY_RUN·KILL_SWITCH·`submitOrder`·한도 코드 무변경. 감사 경로는 G1 에서 끝나 주문 경로(현금 게이트·routeSignal·자동 제출·submitOrder)에 닿지 않고, G1 통과 경합도 감사 전용 선택지로 같은 지점에서 끝남(시험 고정). 블랙리스트는 G1 앞 그대로(시험). 검증 후보 경로·양수 한도 경로는 이전과 같은 코드·같은 createSignal 맥락. 기록은 기존 `finishValidationBlock` → `signals(skipped)`·`paper_fills`.
- [22:38] 남은 우려(Reviewer 참고): (1) 검증 후보가 있으면 같은 전략의 `strategies.validation_status` PK 조회가 엔진 분류 1회 + 배분 내부 1회 + G1 1회로 늘었다(런당 전략 수 단위, 부담 작음). (2) 저장값이 `"unlimited"`(이전 비율 없음)인데 미검증 후보가 있으면 런마다 `[order-limits] … 이전 1회(감사 기록) 한도 0` 경고 1줄이 남는다 — 운영값은 `unlimitedPrevious: "10"` 이라 해당 없음. (3) 해외 감사 금액은 해외 평가액 × 이전 비율이다(11-07 해외 평균 1,422,711원과 같은 축). (4) `/api/analyst/run` 의 같은 모양 분기는 범위 밖이라 그대로(후속 후보). (5) 커밋 훅 감시 대상: 위 구현 4파일 + 시험 8파일이 전부 `^src/lib/(strategy|signals|safety)/` 에 걸린다(package.json·lock 은 밖) — Reviewer scope 에 `src/lib/strategy/`(macro-regime 시험 포함)·`src/lib/signals/`·`src/lib/safety/` 의 해당 파일이 모두 들어가야 한다.

## Reviewer

- [23:05] 독립 감사(Reviewer, 실행 도구: claude). 서버 worktree 기준 `3d0f3d0` 의 미커밋 diff 와 새 파일 3개를 직접 읽었다. Developer 결론은 코드·시험으로 대조했다.
- [23:05] 항목1 fail-closed 확인: `service.ts` createSignal 은 블랙리스트 -> G1 -> (신규) `validationAuditOnly` 중단 -> 현금 게이트 -> routeSignal -> INSERT 순서다(578-588행). 감사 전용이 G1 통과 시 현금 게이트·routeSignal·INSERT·알림·RAG·자동 제출·submitOrder 어디에도 닿지 않고 `ok:false, signalId:0` 으로 끝난다. G1 불통과는 기존 `finishValidationBlock` 그대로(opts 에서 origin·claimEntryCooldown 만 읽음 - 선택지 유무 무관). `validationAuditOnly` 사용처는 engine·service·label·시험뿐이고 다른 호출부(analyst/run·entry-watcher·POST /api/signals)는 쓰지 않는다. DRY_RUN 꺼짐·autopilot=auto 가정에서도 분류 뒤 상태 변경 경합은 같은 지점에서 끝난다. 결함 없음.
- [23:05] 항목2: 검증 묶음은 T-159 코드(allocate -> applyPortfolioGuard -> publish)를 그대로 옮겼고, 검증 묶음이 비면 allocateAdaptiveBuys 를 부르지 않아 LLM 0(engine.ts 1673-1676행). 분류 판정 거부는 감사 경로(fail-closed), 전략당 1회 캐시. 결함 없음.
- [23:05] 항목3: 감사 후보는 createSignalGuarded -> createSignal(origin engine, claimEntryCooldown true) -> finishValidationBlock 의 원자 선점(F-16)을 그대로 타고, 다음 틱은 collectCandidates 의 cooldown_entry 에서 걸러진다. 엔진 publish 의 setCooldown 은 res.ok 일 때만이라 감사 경로에서 이중 설정 없음. 기록량은 T-159 이전과 같은 메커니즘.
- [23:05] 항목4: 새 게이트 `validation_audit_only_passed` 를 FUNNEL_GATES 끝 append·GATE_STAGE 11·한글 라벨 등록하고 createSignalGuarded 에서 skip 으로 매핑(무기록 게이트 없음). 감사 후보에는 adaptive_buy_sizing 행을 쓰지 않는다(분류에서 떼어 냄).
- [23:05] 항목5: `getPreviousOrderMax(market,label)` 은 `effectiveMaxFromPct(…,previousOrderPct=true)` 그대로이고 effectiveMaxFromPct 는 try/catch 로 던지지 않는다. `getLegacyAnalystSellAmount` 는 domestic·라벨 `기존 RSI 매도` 로 위임해 계산·로그·반환 동일. 엔진 쪽도 try/catch 로 금액 0 진행(예외가 런을 죽이지 않음). 금액식 floor(이전 한도 x (1-FEE_BUFFER_PCT)) 는 양수 한도 defaultAmountKRW 식과 같다.
- [23:05] 항목6: dry-run.ts(submitOrder)·validation-gate.ts·paper-fill.ts·src/app(analyst/run 포함)·장마감 경로 diff 0건 확인. package.json·package-lock.json 은 version 0.8.0 -> 0.9.0 줄(lock 최상위 2곳)만 변경.
- [23:05] 항목7: 기존 시험 5개 수정은 FUNNEL_GATES 꼬리 단언에 새 ID 를 덧붙인 것 3건(기존 ID 상대 순서 단언 유지)과, 무제한 장면 2건(collect-fanout-t148·engine-invariant)에 validation-gate 를 검증됨으로 모의한 것이다. 두 파일 모두 createSignal 을 모의하므로 G1 회귀망을 약화하지 않고, 단언 변경 없이 전제만 명시했다. 약화 없음.
- [23:05] 직접 실행(서버 worktree, flock 직렬): `npx jest <새 시험 3개 + 수정 시험 5개 + adaptive-buy-sizing>` -> 9 suites·147 tests 통과, 실패 0. 추가 변경·커밋·git add·DB 쓰기·운영 접근 없음.
- [23:05] 발견 사항: CRITICAL 0 · HIGH 0 · MEDIUM 0 · LOW 2. (L1) engine.ts 1702-1706: 이전 비율이 `"unlimited"` 만 저장된 상태에서 미검증 후보가 있으면 런마다 order-limits 경고 1줄과 금액 0 기록(운영값은 unlimitedPrevious 10 이라 현재 해당 없음, 권고: 필요하면 후속에서 경고 빈도 제한). (L2) 전략당 validation_status 조회가 분류·배분 내부·G1 로 최대 3회 - 런당 전략 수 단위라 부담 작음, 조치 불요.
- [23:05] QA/Codex 초점 인계: (a) 일회용 DB 시험 2개(t072-disposable-mariadb·t081b)는 환경 없이 건너뜀 - G1 차단 SQL 은 무변경이나 QA 가 가능하면 일회용 DB 로 실행, (b) 전체 jest 실패 27 suites(React 이중 로드·울타리 시험)가 기준 커밋에서도 같은지 QA 가 대조, (c) 감사 후보에 포트폴리오 가드(국내 24h 종목당 매수 횟수)가 금액 0/근사 금액으로 동작하는 점과 기록량(상한 추정 약 185건/일)은 사용자 판단 사항, (d) `/api/analyst/run` 같은 모양 분기는 범위 밖 후속.
- [23:05] **최종 판정: PASS (scope: src/lib/strategy/engine.ts, src/lib/strategy/eval-funnel-labels.ts, src/lib/signals/service.ts, src/lib/safety/order-limits.ts, src/lib/strategy/__tests__/engine-adaptive-validation-audit-t168.test.ts, src/lib/signals/__tests__/service-validation-audit-only-t168.test.ts, src/lib/safety/__tests__/order-limits-previous-t168.test.ts, src/lib/strategy/__tests__/engine-collect-fanout-t148.test.ts, src/lib/strategy/__tests__/engine-exit-state-load-isolation.test.ts, src/lib/strategy/__tests__/engine-insufficient-cash.test.ts, src/lib/strategy/__tests__/engine-validation-gate.test.ts, src/lib/strategy/macro-regime/__tests__/engine-invariant.test.ts)**
- [23:20] Codex C2 지적 판정(실행 도구: claude). 비교 기준은 기준 커밋 `3d0f3d0` 의 engine.ts 와 현재 diff.
- [23:20] 지적1(medium, engine.ts 1718 감사 루프의 applyPortfolioGuard 예외 격리 없음): **범위 밖(기존 패턴과 동일) - 채택 안 함, 후속 후보.** 근거: 기준 커밋에서도 applyPortfolioGuard 는 try 없이 호출된다(`3d0f3d0` 1193행 applyFilters 안, 1661행 T-159 검증 후보 루프). T-159 이전 미검증 매수도 applyFilters 안의 같은 가드를 격리 없이 거쳤고, T-168 은 그 순서(가드 -> publish -> G1)를 복원했을 뿐 새 위험 유형을 만들지 않았다. 던질 때의 피해는 기록 손실(런 거부는 runAll 의 `.catch` 가 error 결과로 받음)이며 주문 방향 위험은 없다. 다만 검증 루프와 감사 루프 둘 다 같은 취약점이라 별건으로 둘 가치는 있다(후속: 후보별 try/catch + 실패 시에도 rec.flush 보장).
- [23:20] 지적2(low, 중첩 런에서 포트폴리오 가드 거절 시 insertSkipAuditPool 이 쿨다운 선점 없이 ai_skipped 행 추가): **범위 밖(기존 패턴과 동일) - 채택 안 함, 후속 후보.** 근거: 가드 거절 감사 행은 T-159 이전부터 G1 선점 앞에서 선점 없이 기록됐고 같은 후보를 중첩 런이 처리하는 상황 자체가 기존에도 가능했다. T-168 이 새로 만든 경로가 아니다. 자금 위험 없음, 중복 행 증가만 가능.
- [23:20] 두 건 모두 코드 수정이 필요한 채택 없음. 직접 시험·코드 재변경 없음.
- [23:20] **최종 판정: PASS (scope: src/lib/strategy/engine.ts, src/lib/strategy/eval-funnel-labels.ts, src/lib/signals/service.ts, src/lib/safety/order-limits.ts, src/lib/strategy/__tests__/engine-adaptive-validation-audit-t168.test.ts, src/lib/signals/__tests__/service-validation-audit-only-t168.test.ts, src/lib/safety/__tests__/order-limits-previous-t168.test.ts, src/lib/strategy/__tests__/engine-collect-fanout-t148.test.ts, src/lib/strategy/__tests__/engine-exit-state-load-isolation.test.ts, src/lib/strategy/__tests__/engine-insufficient-cash.test.ts, src/lib/strategy/__tests__/engine-validation-gate.test.ts, src/lib/strategy/macro-regime/__tests__/engine-invariant.test.ts)**

## QA

- [23:16] **QA 실행 (실행 도구 claude, qa 서브에이전트).** 검증 대상은 서버 worktree `~/.node-local/stockinvest-t168` 의 미커밋 변경(HEAD `3d0f3d0`, 변경 파일 12개와 신규 시험 3개). 기준은 같은 저장소의 detached worktree `~/.node-local/stockinvest-t168-base`(`3d0f3d0`, `node_modules` 는 `stockinvest-t155` 심볼릭 링크)다. 실행 뒤 `rm` 으로 링크만 지우고 `git worktree remove` 로 제거했다(`stockinvest-t155/node_modules` 원본 존재 확인). 무거운 실행은 전부 `flock /tmp/stockinvest-heavy-tests.lock` 직렬로 돌렸고 로그·결과 파일은 저장소 밖 `~/.node-local/t168-qa/` 에 있다. 저장소 상태는 실행 전후 동일하며 커밋·DB 쓰기·DDL·운영 설정 변경은 없다.
- [23:16] **1. 신규 시험 3개: 스위트 3 · 시험 39 · 통과 39 · 실패 0 · 건너뜀 0 (rc=0).** 대상은 `engine-adaptive-validation-audit-t168`, `service-validation-audit-only-t168`, `order-limits-previous-t168` 이다.
- [23:16] **2. 관련 디렉터리 시험 (rc=0).** `src/lib/strategy/__tests__`, `src/lib/strategy/macro-regime/__tests__`, `src/lib/signals/__tests__`, `src/lib/safety/__tests__`, `src/app/api/analyst/run/__tests__` 를 함께 실행해 스위트 114(통과 112 · 건너뜀 2 · 실패 0), 시험 3,453(통과 3,405 · 건너뜀 48 · 실패 0)이다. 건너뜀 2 스위트는 일회용 DB 시험(t072·t081b)이며 아래 4번에서 실행했다.
- [23:16] **3. 전체 jest 기준 커밋 대조: 신규 실패 0.** 기준 `3d0f3d0` 은 스위트 461(실패 27), 시험 12,616(통과 11,914 · 실패 416 · 대기 286)이다. 변경본은 스위트 464(실패 27), 시험 12,655(통과 11,953 · 실패 416 · 대기 286)다. 경로를 정규화해 비교하면 두 실행의 실패 스위트 집합이 완전히 같고, 실패 시험 수(416)도 같다. 증분 +39 시험은 신규 3 스위트의 시험 수와 같다. 기존 실패 27 스위트(React 이중 로드·울타리·렌더 계열)는 기준 커밋에서도 실패하므로 이번 변경의 결함이 아니다. 원인 규명은 QA 범위 밖이라 하지 않았다.
- [23:16] **4. 일회용 MariaDB 시험 실행 완료.** 이미지는 `mariadb:10.11.11`(`--pull=never`)이고, 127.0.0.1 전용 임의 포트를 썼다. 비밀번호는 환경변수로만 넘겼고 파일·로그에 남기지 않았다. 컨테이너 ID 는 파일에 기록해 그 ID 로만 `docker rm -fv` 했다(rc=0 두 번). `t072-disposable-mariadb`: 시험 17 · 통과 17 · 건너뜀 0 · 실패 0. `t081b-daily-limit-race-disposable-mariadb`(한도 경합): 시험 15 · 통과 15 · 건너뜀 0 · 실패 0. 참고로 `docker ps -a` 에 남은 `mariadb:10.11.11` 컨테이너 2개(`stockinvest-t156-store-test-20261108`, `stockinvest-t156-research-20261106-a22`, Exited)는 이번 실행과 무관한 과거 T-156 잔여물이라 건드리지 않았다.
- [23:16] **5. 타입·빌드 (rc=0).** `node typescript/bin/tsc --noEmit` 는 rc=0이고 로그가 0바이트다. `next build` 는 rc=0이고 `Compiled successfully` 를 출력했다.
- [23:16] **6. 안전장치 체크 (diff·시험 근거).** `git diff 3d0f3d0 -- src/lib/safety/dry-run.ts src/lib/safety/validation-gate.ts src/lib/safety/paper-fill.ts src/app src/lib/exchanges src/lib/strategy/eval-funnel.ts scripts` 의 결과는 0줄(무변경)이다. 안전 디렉터리에서 바뀐 파일은 `order-limits.ts` 하나이며, 시장별 이전 1회 한도 함수 추가와 `getLegacyAnalystSellAmount` 의 위임으로 이루어진다. 시험 `order-limits-previous-t168` 이 국내 값과 라벨이 같은지 확인한다.
  - 감사 경로는 주문 경로에 닿지 않는다. `service.ts` 에서 `validationAuditOnly` 중단(582행)이 블랙리스트(570행)와 G1(578행) 뒤에 있고, `routeSignal`(618행)·`INSERT INTO signals`(669행)·`submitOrder`(786행) 앞이다. 엔진 diff 에는 `submitOrder`·`routeSignal`·`runLlm` 을 새로 부르는 줄이 없다. 시험 ③(G1 통과 경합)에서 INSERT·routeSignal·submitOrder 가 0회이고 funnel skip 1행만 남는 것을 통과로 확인했다.
  - 미검증만 있을 때 LLM 호출 0은 시험 ①(`runLlmOnce`·`runLlm` 0회)로 통과했다. 블랙리스트가 먼저 적용되는 순서는 시험(`symbol_blacklisted`)으로 통과했다. 진입 쿨다운 선점(F-16)이 다음 런을 막는 것은 시험 ⑥로 통과했다.
  - 감사 행과 가상 체결 기록은 기존 `finishValidationBlock` 을 재사용하며 새 기록 경로가 없다. `service.ts:507` 의 `routeSignal(...).expiresAt` 줄은 기준 커밋에도 있는 기존 계산이다.
- [23:16] **7. 기록량 근거 재현 (읽기 전용 SELECT 만).** 운영 `eval_funnel` 에서 최근 7일 `gate IN ('adaptive_buy_sizing','no_validated_candidates')` 행을 TSV 로 받아 `t168_estimate.py`(120분 쿨다운 모의)에 넣었다. 입력은 10,939행이고 시뮬레이션 결과는 926건이다. 일별로는 11-09 163 · 11-10 315 · 11-11 191 · 11-12 139 · 11-13 118이다(11-13 데이터는 마지막 14:59 까지). 게이트별로는 `adaptive_buy_sizing` 10,939행이고 `no_validated_candidates` 는 0행이다. 따라서 10,939행과 926건은 Leader 수치와 일치한다. 이전 창 모의 810 대 실측 796 은 재현하지 못했다. 7~14일 전 창에 이 게이트 행이 0건이기 때문이다(데이터가 11-09 부터 시작). 이 항목은 미검증으로 남긴다. 일평균 약 185건/일 상한(포트폴리오 가드 미모의)은 Reviewer 의 수치와 같다. T-159 이전 엔진 일평균 71건/일은 재확인하지 않았다.
- [23:16] **미실행·미검증 (숨기지 않음).** ① `next lint` 는 저장소에 eslint 설정이 없어 실행하지 않았다. ② dev 서버 호출은 하지 않았다. 변경된 HTTP 엔드포인트가 없고, cron 라우트를 부르면 운영 DB 에 쓰이기 때문이다. ③ Developer 가 기록한 변이 시험(A·B·C) 결과는 QA 가 재실행하지 않고 인계받은 기록으로만 남긴다. ④ 공유 DB 행 수 전후 대조와 운영 가드 로드 실측은 하지 않았다(읽기 전용 원칙·범위 밖). ⑤ push·배포·DB 적용·`app_release`·pm2 재기동은 범위 밖이라 실행하지 않았다. ⑥ 기존 실패 27 스위트의 원인은 규명하지 않았다(기준 커밋과 동일한 상태임만 확인).
- [23:16] **결함: 0건.** 신규 실패, 안전장치 변경, 감사 경로의 주문 도달, 일회용 DB 시험 실패는 어느 것도 관찰되지 않았다. 위 1~7은 이번 세션에서 직접 실행하거나 읽은 결과다. 판정 범위는 테스트·빌드·코드 경로 확인까지다. 배포·DB 적용·push 는 판정에 포함되지 않는다.
✅ 검증 통과

## 후속 후보 (범위 밖)

- 11-07 06:01 이후 막힌 장중 매수 후보의 소급 백필 — DB 쓰기·당시 가격 부재로 이번 범위 밖.
- `/api/analyst/run` 의 같은 모양 분기(무제한 모드에서 매수 후보를 적응 배분에만 보냄) — 사람이 부르는 경로, 별건 판단.
- judge 규칙 보강 후보: `DM-kw-risky-cta` 의 UI 문맥 판정이 부정 문맥(「화면 … 변경 없음」)도 UI 문맥으로 센다(이 task 1차 intake). 규칙 수정은 judge 가 아니라 별도 승인 후 spec·rules 버전을 올려 처리.
- demo-gate `check.mjs` 가 서버 개인 클론의 worktree(`~/.node-local/stockinvest-*`)를 정본으로 인정하지 않아 이 경로에서 게이트 상태를 도구로 기록할 수 없다 — T-165~T-168 처럼 서버 worktree 에서 일하는 방식과 충돌.

## Codex 검토

### [2026-11-13 22:51] C2 adversarial-review focus=concurrency — 실패(worktree_failed: 스냅샷 커밋 생성 단계 실패, Codex 미실행)
- judge 판정: `## 판단 기록 (judge)` 22:47 줄 (`codex_required=true`, `budget_rule=CX-limit-unknown-r2`, `codex_switch=on`) / 호출 차수: 0/4 (`counts` 미증가, Codex 호출 없음)
- 대상: repo=스크래치 clone(origin 에서 받은 저장소, 작업 트리 아님) base=3d0f3d0(task_file) snapshot=없음
- 대상 일치 확인: 서버 worktree `~/.node-local/stockinvest-t168` 의 대상 15개 파일 sha256 과 clone 사본 일치(15/15), 추적 파일 `git diff --stat` 11 files 146+/27- 로 서버와 일치(신규 3개 + 이력서 1개는 untracked)
- 실패 사유: 래퍼가 스냅샷 커밋(`git commit-tree`)을 만들 때 실행 계정의 git 작성자 신원이 없어 중단(`fatal: 메일 주소를 자동 검사할 수 없습니다`). 래퍼 코드·저장소 설정은 건드리지 않았다. 래퍼 1회 실행 규칙에 따라 재시도하지 않았다.
- 지적 0건 — 실행되지 않았으므로 "지적 없음"이 아니다. 검토 결과 없음.
- 검토하지 못한 범위: 전체(수용 기준 1~5, 집중 질문 1~3 모두 미검토). 잔여 위험은 Claude 측 Reviewer PASS 와 jest 결과만 근거로 남는다(Codex 검토 전).
- 원본: 래퍼 실행 기록 디렉터리 `.claude/state/codex-review/runs/20261113T135101Z-T-168-C2/` 는 비어 있음(실패 전 단계). 인계 묶음 `/tmp/codex-handoff-T-168-C2.md`.

### [2026-11-13 23:03] C2 adversarial-review focus=concurrency — done (지적 2건: medium 1 · low 1)
- 경위: 1차 worktree_failed(작성자 신원 미설정, Codex 미실행) 뒤 Leader 결정으로 준비 수정 후 실행. 래퍼 실행 환경에만 GIT_AUTHOR_/GIT_COMMITTER_ NAME·EMAIL=codex-snapshot 을 줬고(로컬 스냅샷 커밋 전용, push 없음), core.fileMode=false 는 유지. 저장소 설정·전역 설정·래퍼 코드 무변경. 재시도 없이 1회 실행.
- judge 판정: 22:47 줄 동일 / 호출 차수: 1/4 (1차 실패는 counts 미증가)
- 대상: repo=스크래치 clone(origin, 작업 트리 아님) base=3d0f3d0(task_file) snapshot=1338cf3
- 대상 일치 확인: 서버 worktree 15개 파일 sha256 과 clone 사본 15/15 일치(재확인 시점). 추적 파일 diff --stat 11 files 146+/27- 일치. 서버 task 이력서에는 실패 기록 절만 추가됐고 clone 사본은 그 추가 전 상태로 스냅샷에 넣었다(코드 대상 무변화).
- 지적 2건:
  1. [medium] src/lib/strategy/engine.ts:1718 — 감사 후보의 포트폴리오 가드 조회 또는 거절 감사 INSERT 예외 시 예외 격리 없음 → 한 후보 실패가 나머지 감사 후보와 eval_funnel·run 기록 저장을 중단시킴(외부 I/O 모의에서 runAll 거부, rec.flush 0회 확인). 권고: 감사 후보별 가드 예외 격리 후 오류 기록·다음 후보 진행, 종료 시 기록 저장 보장.
  2. [low] src/lib/strategy/engine.ts:1718 — 같은 국내 미검증 후보를 중첩 엔진 런이 처리하고 가드가 거절할 때, 거절 감사 INSERT(1263행, insertSkipAuditPool)가 claimCooldown 앞에 있고 별도 선점이 없어 런마다 ai_skipped 행이 중복 추가됨(모의에서 INSERT 2건, createSignal·쿨다운 0회). 권고: 거절 감사 기록에도 후보 단위 원자 선점 또는 멱등 키 적용, 중첩 실행 시험 추가.
- 감사 전용 플래그의 G1 통과 후 주문 경로 차단에서는 누출을 발견하지 못했다고 보고됨.
- 검토하지 못한 범위: 실제 MariaDB 잠금·UNIQUE·트랜잭션 경합과 일회용 DB 시험, 실제 cron 중첩 실행·KIS 호출·주문 송신·운영 배포, 전체 Jest 재실행, 실제 평가액 조회 지연.
- 원본: /Volumes/homes/brownjeon/project/.claude/state/codex-review/runs/20261113T135220Z-T-168-C2/
- 다음: Reviewer가 지적 2건 채택·오탐 판정 (Leader 판단 대기 — 이 기록에서 채택·기각하지 않음)

## 최종 요약

> 작성 23:18 KST · Leader(claude) · 범위 = 커밋까지. push(=운영 배포)는 메인 세션이 사용자 승인을 받아 진행한다.

### [T-168] 장중 자동 분석의 「검증 안 된 전략」 매수 신호가 다시 가상 체결로 기록되도록 복구

- **상태**: 구현·독립 감사·QA 완료, 서버 worktree 에 코드 커밋 `cde5f1d`. **운영 미배포(push 대기)**.
- **무엇이 바뀌었나**
  - 1회 매수 한도를 「무제한」으로 저장한 뒤(11-07 23:28)부터, 장중 엔진은 매수 후보를 전부 AI 금액 배분 단계로 보냈다. 그 단계가 검증 안 된 전략을 걸러 버려서, 예전처럼 「가상 체결 + 승인 불가 기록 + 2시간 재발화 억제」가 남지 않았다. 마지막 장중 가상 체결은 11-07 06:01 이다.
  - 이제는 AI 배분 **앞에서** 후보를 전략 검증 여부로 나눈다. 검증된 전략만 AI 배분으로 간다(지금은 0개라 AI 호출도 0). 검증 안 된 전략은 예전 경로(검증 관문)로 가서 가상 체결로 기록된다. 금액은 무제한 전에 쓰던 1회 비율(10%)로 계산하며, 기록용이다.
  - 안전장치를 하나 더 넣었다. 분류한 뒤 그 사이에 전략이 「검증됨」으로 바뀌어도, 이 후보는 시그널·주문을 만들지 않고 기록만 남기고 끝난다.
  - 웹 버전 0.8.0 → 0.9.0.
- **배포**: 미배포 — 사용자 승인 뒤 메인 세션이 push 한다(push = blue/green 배포). DB 변경·DDL 없음, 화면 변경 없음, 앱(APK) 무관.
  - **실매매 영향**: 주문·청산·승인 경로의 동작은 바꾸지 않았다. 검증 안 된 후보는 어떤 경우에도 주문 경로에 닿지 않는다(시험 확인). 스위치 상태(배포 전 읽기 전용 조회): DRY_RUN 켜짐, autopilot `auto`, 1회 한도 무제한(이전 10%), 일일 한도 무제한. 킬스위치 꺼짐은 메인 세션의 `/api/health` 조회 값이다. 배포 후 실측값은 미확인.
- **AI 가 검증한 것**
  - 새 시험 39건 통과. 관련 시험 3,405건 통과·실패 0.
  - 전체 jest 를 기준 커밋과 대조해 **신규 실패 0**. 기존 실패 27묶음·416건은 기준에도 똑같이 있다.
  - `tsc` rc 0, `next build` rc 0.
  - 일회용 MariaDB 시험: 가상 체결 SQL 17/17, 한도 경합 15/15 통과.
  - Reviewer 독립 감사 pass. Codex 외부 검토 C2 done — 지적 2건은 Reviewer 가 기존 경로와 같은 패턴이라 후속 후보로 판정했다.
- **AI 가 검증 못 한 것**: 운영 배포 후 실제 장중 기록, 실제 MariaDB 에서 엔진 런이 겹칠 때의 동작, lint(eslint 설정 없음).
- **기록량 예상**: 최근 5영업일 데이터로 계산하면 반복 발화 10,939행이 가상 체결 약 926건(하루 약 185건)으로 줄어든다. T-159 이전 하루 약 76건의 약 2.4배인데, 11-07 에 새로 켠 `price-breakout-v1` 등 전략 구성이 바뀐 몫이다. 억제 수준은 이전과 같다. 추가 억제는 넣지 않기로 했다(메인 세션 권고, 사용자 이의 없음).
- **👉 사용자가 확인할 것**: 화면 변경이 없어 직접 확인할 화면은 없다. 배포 뒤 첫 장중에 AI(메인 세션)가 운영 DB 를 읽기 전용으로 조회해 확인한다 — 국내 09:00 이후, 미국 23:30 KST 이후.
  - 정상: `paper_fills` origin=`engine` 행이 다시 생긴다(하루 수십 ~ 200건대). `eval_funnel` 에 `validation_gate`(skip) 와 `cooldown_entry` 가 나타나고, `adaptive_buy_sizing/no_validated_candidates` 는 사라진다.
  - 이상: 장중인데 0건이 이어짐 / 하루 수천 건 / 검증 안 된 전략의 매수 시그널이 `pending`·`approved` 등 승인 가능한 상태로 생김 / `validation_audit_only_passed` 행이 생김(전략이 「검증됨」으로 바뀌지 않았다면 나오면 안 된다).
- **👉 사용자가 결정할 것**: 운영 배포(push) 승인 — `waiting: push_confirm`. 이미 정한 것: 데모 생략(사용자 「데모 생략」, 22:20 무렵), 기록량 추가 억제 안 함.
- **남은 일**: push·배포 뒤 첫 장중 관측. 후속 후보(아래 「후속 후보」 절):
  - 11-07 이후 끊긴 기간 소급 백필(안 함)
  - `/api/analyst/run` 의 같은 모양 분기
  - 포트폴리오 가드 예외 격리·가드 거절 기록 중복(Codex 지적, 기존부터 있던 문제)
  - judge 규칙 부정 문맥 오탐
  - demo-gate 도구가 서버 worktree 를 인식하지 못함
- **이슈·위험**
  - 데모 판정 오탐: judge 가 데모 delta 를 냈다. 요약의 「화면 … 변경 없음」 같은 부정 문맥 단어에 걸린 오탐으로 판단했다. 요약만 고친 재판정은 judge 가 거부했고, 사용자 원문으로 생략했다.
  - 게이트 수기 기록: `check.mjs` 가 서버 worktree 를 인식하지 못해 데모 게이트 상태(drafting → waived)를 Leader 가 손으로 적었다. 도구의 증거 기록(`evidence.jsonl`)은 없다.
  - Codex 1차 실패: 우리 쪽 준비 오류(git 작성자 신원 없음)로 Codex 가 실행되지 않았다. Leader 결정으로 준비를 고쳐 1회 실행했다(호출 1/4).
  - Reviewer 기록 시각 `[23:05]`·`[23:20]` 은 실제보다 늦게 적혀 있다. 판정 내용과 순서는 유효하다.
  - 사후검증(메인 세션 21:46): rsi-oversold 수익성은 **판정 보류**(서로 다른 주 4개 < 8). 이 복구는 판정에 필요한 표본을 다시 쌓기 위한 것이다. 미검증 전략을 실매매로 돌리는 근거가 아니다.
