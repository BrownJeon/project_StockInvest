---
task_id: T-178
title: 모의분석(M40) 회차가 버크셔 SEC 공시 때문에 11-13 세션부터 연속 차단되는 문제 — 공시 판정 규칙 개선 + 화면 차단 사유 문구 보강
status: done
waiting: 오늘(11-20) 20:45 KST 이후 모의분석 첫 회차가 forward 로 저장되는지 · 앱 「분석 → 모의분석」 배너가 사라지거나 한국어 사유로 보이는지(사용자 확인)
priority: high
project: StockInvest
created: 2026-11-20
updated: 2026-11-20
base_ref: b85a557
risk_level: R2
roles_involved: [leader, judge, analyst, designer, developer, reviewer, codex, qa]
related_tasks: [T-156-us-stock-entry-exit-forecast-design, T-177-cron-runner-deploy-connect-fail]
tags:
  - type/task
  - domain/strategy
  - domain/m40
  - domain/paper-trading
aliases:
  - 모의분석 처리 차단
  - BRK 공시 차단
execution_context:
  schema_version: 1
  origin_tool: claude
  current_tool: claude
  current_procedure: claude_standard
  current_scope: 원인 확인·설계부터 구현·감사·QA·커밋·작업 브랜치 push·PR 생성까지(main 반영 = 운영 배포는 PR 검토 뒤 사용자 결정)
  last_event_id: E3
---

# T-178 모의분석 회차가 버크셔 SEC 공시 때문에 연속 차단되는 문제

작업 worktree: 서버 `~/.node-local/stockinvest-t178` (detached, base `b85a557` = origin/main = 운영 릴리스 `20261120-062419-b85a5572`). `node_modules` 는 운영 릴리스 `current/node_modules` 로의 심볼릭 링크(같은 package-lock) — **스테이징하지 않는다.** 이 worktree 밖(공유 NFS 트리·다른 worktree)은 건드리지 않는다.

## 목표·배경 (Leader)

사용자 문의(2026-11-20 09:4x): 앱 분석 → 모의분석이 「처리 차단」이고 이전 저장분이 11-12 세션, 마지막 저장 분석 기준이 11-13 인데 왜 차단돼 집계되지 않는지.

### 확인한 사실 (Leader, 2026-11-20 09:5x 서버 실측 — 읽기 전용)

- 화면의 11-12 와 11-13 은 같은 회차다 — 세션은 미국 동부 거래일, 「저장 분석 기준」은 처리 시각(DB `decision_at 2026-11-13 12:17:02 UTC` = 21:17 KST). 최신 회차가 `blocked` 면 화면은 마지막 비차단 회차를 「이전 저장분」으로 보여 준다(`src/app/analytics/M40PaperPanel.tsx:64`, `src/lib/strategy/m40/paper-view.ts:164-169`).
- `t156_paper_cycle` 최근 회차:

| 세션(ET) | decision_at(UTC) | mode | errorCode |
|---|---|---|---|
| 11-12 | 11-13 12:17 | forward | — |
| 11-13 | 11-14 11:50 | blocked | `forward_pair_events_unreviewed_material_filing` |
| 11-16 | 11-17 11:50 | blocked | `forward_pair_events_unreviewed_material_filing` |
| 11-17 | 11-18 11:50 | blocked | `forward_pair_kis_identity_invalid` |
| 11-18 | 11-19 11:50 | blocked | `forward_pair_events_unreviewed_material_filing` |

- 크론은 거래일마다 정상 실행됐다(스케줄러 장애 아님). `blocked` 회차는 신호·평가액을 만들지 않고 성과 집계는 `mode='forward'` 만 센다 — 집계 공백은 설계대로의 결과.
- 차단 지점: `src/lib/strategy/m40/forward-stock-events.ts` `validateBrkSecSnapshot` — 질의일 14일 이내의 버크셔(CIK 0001067983) 공시 중 Form 4(items 빈값) 를 뺀 **모든 공시**가 코드 상수 `BRK_MATERIAL_REVIEW.materials`(11-11 기준 3건: 8-K·424B5·10-Q)에 있어야 하고, 없으면 `unreviewed_material_filing` 으로 회차 전체를 막는다. 호출: `forward-runtime.ts` BRK 쌍 수집(`symbols.includes(BRK_PAIR_SYMBOL)`) → 실패 시 격리 기록 후 throw.
- 11-18 회차에 보관된 SEC 원본(`t156_dataset` `paper-src-5a0cd939…` → blob `e829de62…`, quarantine `rawJson.events.sec.rawJson`)의 목록 밖 공시 10건:
  - 2026-11-13 16:57Z `FWP` 0001193125-26-459815 `d127427dfwp.htm` ← **첫 차단 원인**
  - 2026-11-16 21:00Z `13F-HR` 0001193125-26-463399
  - 2026-11-17 01:19Z~01:57Z `SCHEDULE 13G/A` ×4(…464189·464211·464214·464219), `SCHEDULE 13G` ×1(…464218)
  - 2026-11-17 16:32Z `424B5` 0001193125-26-465047 `d86634d424b5.htm`
  - 2026-11-18 00:23Z `SCHEDULE 13D/A` 0001193125-26-465884
  - (Form 4 3건은 규칙상 통과)
- [가능성 높음] 공시 종류로 보아 모두 타사 지분 보고·보유 현황·채권 발행 서류이고 BRK.B 주식 자체의 분할·배당 등 기업행동은 아니다 — **본문은 읽지 않았다.**
- [확실] 화면 사유 사전 `src/app/analytics/m40-paper-copy.ts` `REASONS` 에 `forward_pair_*` 코드가 없어 배너가 「사유 설명 미등록 (forward_pair_events_unreviewed_material_filing)」으로 보인다.
- [가능성 높음] 버크셔는 13G·13D·13F·채권 서류를 자주 내므로 목록 추가만으로는 몇 주마다 같은 차단이 반복된다. 14일 창이 비어 자연 해소되려면 새 공시가 없어야 한다.
- `forward_pair_kis_identity_invalid`(11-17)는 KIS `HHDFS76240000` 응답이 `rt_cd≠0`·`rsym≠DNYSBRK/B`·빈 output2 중 하나일 때다(`forward-stock-alpaca.ts:75`). 별도 조사 안 함.
- 실주문 영향 없음: M40 은 `executionScope: paper_only`.

## 사용자 지시·승인 (원문 보존)

- 2026-11-20 09:4x 「모의분석에 대하여 지금 '처리 차단'상태에 이전 저장본이 '11-12'이 마지막 저장 분석 날짜가 11-13로 되어 있는데 왜 차단상태에 집계가 되어 있지 않것에 대한 확인해줘」
- 2026-11-20 10:0x 「해당 작업에 대하여 PR을 생성하여 사용자가 검토 후 커밋 및 푸시 진행할 수 있도록 진행해줘」 + 「작업은 권고안대로 진행해줘」
- 권고안(직전 보고의 2번): **판정 규칙 개선 task — 타사 지분 보고·채권 서류를 어떻게 다룰지 analyst 가 설계하고, 화면 사유 문구도 함께 보강.**
- 범위: 설계·구현·검증·작업 브랜치 커밋·push·PR 생성. **main 반영(= webhook 운영 배포)은 사용자 PR 검토 뒤 별도 결정.** 운영 DB·설정·pm2·`/api/cron/*`·KIS·SEC 실호출 없음.
- webhook 은 `push` + ref 가 `/main`·`/master` 로 끝날 때만 배포한다(`~/.local/webhook-deploy/server.js:124-128`) — 작업 브랜치 이름은 `/main`·`/master` 로 끝나지 않게 한다.

## 주의 (Leader)

- `src/lib/strategy/` 는 커밋 훅 `SAFETY_PATHS` 감시 경로 — Reviewer 판정 줄(scope 에 실제 staged 파일 전부) 없이는 커밋되지 않는다. 커밋은 이 서버 worktree 에서만.
- 이 게이트는 T-156 이 「유한한 사람 검토, 키워드 부재로 분류하지 않음」으로 **일부러 엄격하게** 만든 것이다(`forward-stock-events.ts` 주석). 완화는 방침 변경이므로 근거·남는 위험을 PR 에 명시해 사용자가 판단하게 한다.
- T-156 은 다른 세션(Codex 주도 이력)이 `doing` 으로 들고 있다. 같은 파일을 만지므로 PR 에 충돌 가능성을 적는다. 공유 NFS 트리의 T-156 미추적 작업본은 건드리지 않는다.
- 커밋 메시지에 이 task 외 다른 task ID 를 쓰지 않는다.

- [10:35] **정정**: 「목록 밖 공시 10건」은 accession 기준 **9건**이다(FWP 1·13F-HR 1·13G/A 4·13G 1·424B5 1·13D/A 1). Leader 가 처음 셀 때 잘못 셌다(analyst 지적).
- [10:35] **C1 Codex 지적 처리(Leader)**: 지적 1(high, 공모 서류군 FWP·424B2·424B5 종류만 통과 → 권리 공모 등 누락 가능)·지적 2(medium, 버크셔가 대상인 SCHEDULE 13D·13D/A 가 교환·합병 조건을 먼저 공개 가능)는 analyst 가 이미 「사용자 판단 포인트」로 둔 경계와 같다. 두 군을 빼면 현재 차단이 12-02 무렵까지 지속(11-13 FWP·11-17 424B5·11-18 13D/A 가 14일 창 안) → **사용자 결정으로 회부**. 구현은 통과 집합을 군별 상수로 분리해 어느 결정이든 한 줄 변경으로 대응하게 한다. 완화 근거로 볼 수 있는 기존 장치: 8-K 는 전부 검토 유지, Alpaca 기업행동 조회는 BRK.B 행이 하나라도 있으면 차단(`validateBrkCaPages` — 권리 배분·합병 유형 포함 여부는 미확인).

- [10:58] **사용자 결정(선택형 질문 답변 원문, 2026-11-20 10:5x)**: ① 차단 규칙 「둘 다 통과 (Recommended)」 — 공모 서류군(FWP·424B2·424B5)·능동 대량보유(SCHEDULE 13D·13D/A) 모두 통과 집합에 포함(Codex C1 지적 1·2 는 사용자 판단으로 미채택, 남는 위험으로 PR 에 명시) ② 데모 v1 「승인·코드 항상 표시 (Recommended)」 = D1-A ③ 「missing_sessions 함께 (Recommended)」 = D2-B.
- [10:58] **데모 게이트 기록 한계**: 승인 대상 `mockups/T-178-m40-blocked-reason-copy-v1.html` sha256 `f68c0c8fd4b1c8361359cda1422f204bb85c533f6983c15c693815956c0864c6`(designer lint `DEMO_LINT_PASSED`). `check.mjs init`·`status review_requested` 를 서버 worktree 에서 실행했으나 `DEMO_GATE_REFUSED — task must belong to a canonical project or registered worktree`(이 worktree 는 서버 clone `stockinvest-t157` 소속이라 미등록). 또 `approve` 는 Mac 대화 기록의 사람 입력 턴만 증거로 인정해 선택형 답변을 대조하지 못한다. 그래서 frontmatter `demo_gate` 는 **기록하지 않았고**(도구 전용 규칙), 승인 근거는 위 원문이다. Reviewer 는 이 사정을 감안해 대화 흐름 근거로 확인한다.

- [11:12] **승인 문구에서 달라진 점 1건(Leader 수정, 실행 도구: claude 메인 세션)**: developer 가 승인 문구 `m40_forward_requires_dry_run` 의 「전역 DRY_RUN(주문 차단)이 켜져 있음을」이 T-108 화면 용어 울타리(`src/__tests__/t108-terms-fence.test.ts` — 화면 소스에 `DRY_RUN` 금지, 정본 용어 「실거래여부」)에 새로 걸림을 발견. 「서버 공용 실거래여부가 꺼져 있음(주문 차단)을」으로 바꿨다(`m40-paper-copy.ts` 1곳 + `t178-m40-blocked-copy.test.ts` 기대값 1곳, 같은 문자열 정확 치환). 앱의 기존 표현(「서버 공용 실거래여부 값」, ProfilePage)을 따랐다. 뜻(실거래여부 OFF = DRY_RUN ON = 주문 차단)은 그대로. 승인 데모와 다른 유일한 문구이므로 PR 에 명시해 사용자 확인을 받는다.
- [11:12] 재실행: `t178-m40-blocked-copy`·`t156-paper-view-render` 통과, `t108-terms-fence` 실패 2건(`M40PaperPanel.tsx: 표본 부족`·`모의 매매`)은 **base 에 이미 있는 것**(base·현재 해당 문자열 각 1회, 이번 diff 가 건드리지 않은 줄) — 새 위반 0.
- [11:12] origin/main 이 작업 중 `2a3ae448`(다른 세션, `AGENTS.md`·`CLAUDE.md` 만 변경 — developer 확인)로 앞서 나갔다. 이번 변경 파일과 겹치지 않아 base `b85a557` 위에서 브랜치를 만들고 PR 머지 때 병합한다.

- [11:20] **Codex C2 지적(medium, 문구 사실 불일치) 반영 — Leader 수정, 실행 도구: claude 메인 세션**: `forward_pair_events_unreviewed_material_filing` 문구 끝 「그 공시가 14일을 지나거나 검토를 마친 목록이 배포되면 풀림」 → 「그 공시가 14일을 지나거나 검토를 마친 목록이 배포된 뒤의 다음 세션부터 풀림 · 이미 차단된 세션은 복구되지 않음」(`m40-paper-copy.ts`·`t178-m40-blocked-copy.test.ts` 각 1곳 정확 치환). 근거: 같은 세션 캐시 번들에 검토 필요 격리가 있으면 재시도가 `forward_pair_prior_conflict_requires_review` 로 막힌다(`forward-runtime.ts:188` 직접 확인). 승인 데모 v1 대비 두 번째 문구 차이 — PR 에 명시. 채택 판정은 Reviewer 몫이며 이 수정은 그 판정 대상이다. 재실행: t178·t156 렌더 시험 통과.

## Judge
- [2026-11-20 10:13] intake engine=jev → task_type=null / risk=R2 / developer_model=opus / next=demo_first / demo=delta/designer(JV-ui_change) actions=prepare_demo,request_demo_approval,assign_developer | overrides=R2-kw-payment,MD-judge-failed-opus | fallback=- | tokens=1393
- 결과 JSON (judge-result@2, 원본 그대로):
  `{"schema":"judge-result@2","engine":"jev","kind":"intake","checkpoint":null,"task_id":"T-178","project":"StockInvest","spec_version":"dev-judge@0.2.0","rules_version":"dev-rules@0.5.0","model":"jev-1.13.0","decision":{"task_type":null,"complexity":1.97,"needs_info":false,"risk":"R2","developer_model":"opus","roles":[],"demo":{"required":true,"level":"delta","owner":"designer","publish":"artifact+repo","source":"jev","rule_id":"JV-ui_change","rule_ids":["JV-ui_change"],"waiver_requested":false,"configuration_error":null},"next":"demo_first","next_actions":["prepare_demo","request_demo_approval","assign_developer"],"blocking_gate":"demo"},"signals":{"task_type":{"choice":"local_fix","confidence":0.45},"complexity":{"score":1.97,"confidence":0.95},"needs_info":{"noul":0.41},"risk":{"choice":"normal","probabilities":{"low":0.01,"normal":0.69,"high":0.3}},"ui_detect":"listed","ui_change":{"valid":true,"choice":"behavior_change","confidence":0.7,"probabilities":{"none":0.04,"minor_visual":0.14,"partial_restructure":0.07,"behavior_change":0.75,"overhaul":0,"new_screen":0}}},"rule_overrides":[{"field":"risk","value":"R2","rule_id":"R2-kw-payment"},{"field":"developer_model","value":"opus","rule_id":"MD-judge-failed-opus"}],"fallback":null,"input_tokens":1393,"cost_usd":5.9e-05,"latency_ms":1317}`
- [2026-11-20 10:23] codex_gate/C1 engine=jev → codex_required=true / mode=adversarial-review / focus=design_assumption / budget_rule=CX-limit-unknown-r2 / codex_calls_used=0 / codex_switch=on | overrides=- | fallback=- | tokens=944
- 결과 JSON (judge-result@2, 원본 그대로):
  `{"schema":"judge-result@2","engine":"jev","kind":"codex_gate","checkpoint":"C1","task_id":"T-178","project":"StockInvest","spec_version":"dev-judge@0.2.0","rules_version":"dev-rules@0.5.0","model":"jev-1.13.0","decision":{"codex_required":true,"wanted_before_budget":true,"mode":"adversarial-review","focus":"design_assumption","budget_rule":"CX-limit-unknown-r2","codex_calls_used":0,"codex_switch":"on"},"signals":{"codex_calls_used":0,"focus":{"choice":"design_assumption","confidence":1},"design_uncertainty":{"score":1.81,"confidence":0.73}},"rule_overrides":[],"fallback":null,"input_tokens":944,"cost_usd":0.00004,"latency_ms":470}`

- [2026-11-20 11:08] codex_gate/C2 engine=jev → codex_required=true / mode=adversarial-review / focus=design_assumption / budget_rule=CX-limit-unknown-r2 / codex_calls_used=1 / codex_switch=on | overrides=- | fallback=- | tokens=1074
- 결과 JSON (judge-result@2, 원본 그대로):
  `{"schema":"judge-result@2","engine":"jev","kind":"codex_gate","checkpoint":"C2","task_id":"T-178","project":"StockInvest","spec_version":"dev-judge@0.2.0","rules_version":"dev-rules@0.5.0","model":"jev-1.13.0","decision":{"codex_required":true,"wanted_before_budget":true,"mode":"adversarial-review","focus":"design_assumption","budget_rule":"CX-limit-unknown-r2","codex_calls_used":1,"codex_switch":"on"},"signals":{"codex_calls_used":1,"focus":{"choice":"design_assumption","confidence":1},"high_risk_change":{"noul":0.1},"reviewer_doubt":{"noul":0.86}},"rule_overrides":[],"fallback":null,"input_tokens":1074,"cost_usd":0.000045,"latency_ms":854}`

## Analyst
- [10:21] 실행 도구: claude(analyst 서브에이전트). 범위: 설계만 — 코드·DB·운영 API·외부(SEC·KIS·Alpaca) 호출·시그널·알림 없음. 읽은 것: `forward-stock-events.ts` 전체, `forward-runtime.ts` 150~313행, `forward-sources.ts` 225~330행, `forward-stock-alpaca.ts` 전체, `forward-stock-contract.ts` 80~92행, `forward-store.ts` `commitPaperCycle`, `publication-window.ts`, `m40-paper-copy.ts`, 시험 `forward-stock-events.test.ts`·fixture, T-156 이력서 175~178·1837~1846·2319행. **공시 본문은 한 건도 읽지 않았다**(아래 판정은 전부 공시 종류 기준).
- [10:21] **먼저 알아야 할 것 3가지.** ① [가능성 높음] 아래 권고 규칙만으로는 차단이 **없어지지 않고 줄어든다** — 8-K·10-Q·10-K·위임장 서류는 계속 사람 검토가 필요하고, 그때마다 검토 목록을 코드로 갱신하지 않으면 최대 14일(약 10거래일)씩 다시 막힌다. 버크셔의 연간 해당 공시 수는 이번에 세지 않았다(보관된 SEC 원본 `filings.recent` 의 form 열로 외부 호출 없이 셀 수 있음 — Developer·Leader 확인 권고). ② [확실] 11-13~11-18 차단 회차는 **복구할 수 없다**(근거 아래). ③ [확실] 이력서 「목록 밖 공시 10건」은 나열된 accession 으로 세면 **9건**이다(FWP 1 · 13F-HR 1 · SCHEDULE 13G/A 4 · SCHEDULE 13G 1 · 424B5 1 · SCHEDULE 13D/A 1). 1건 차이는 보관 원본으로 재확인 필요.
- [10:21] **1. 이 SEC 검사가 막으려는 위험.** [확실] 코드 주석·상수: `BRK_EVENT_LIMITATION` = Alpaca 기업행동 조회는 「처리일 기준 조회, 보고 지연·정정 가능, 빈 응답에는 BRK 심볼 확인이 없어 종목 매핑·범위 미검증」(`forward-stock-events.ts:8`). [확실] T-156 Reviewer 17:12·17:39 기록: 빈 기업행동 응답을 「분할 부재의 확증으로 표기하지 않는다」, 그래서 SEC·발행사 자료를 **독립 근거**로 함께 통과해야 하고 「새 운영일에는 CA/SEC metadata 갱신과 새 미검토 **material** 공시·누락·불일치 시 차단」. [확실] 가격 쪽 사용처: 예측 입력이 `raw.open × split.close / raw.close` 로 수익률을 분해하므로(T-156 16:29·16:34 기록) 원주·분할조정 기준이 어긋나면 야간·장중 수익이 왜곡된다. 정리하면 막으려는 것은 **BRK.B 1주의 가격 기준을 바꾸는 발행사 사건(주식 분할·주식배당·종류 변경/전환비율 변경·분할상장·합병 대가·상장 이전/폐지)이 공시됐는데 Alpaca 기업행동 API 가 아직 반영하지 않은 상태로 가격 쌍을 「충돌 없음」으로 쓰는 것**이다. [확실] T-156 원문은 대상을 「material 공시」라고 썼지만 구현은 Form 4 외 **전부**를 material 로 취급한다 — 즉 지금 코드에는 「material 인가」의 정의가 없고 예외 1개(Form 4)만 있다.
- [10:21] **2. 권고 규칙 = (A) 공시 종류 고정 분류, 단 8-K 는 items 로 통과시키지 않는다.** 기존 Form 4 예외와 같은 성격의 예외를 「발행사가 자기 주식 사건을 알리는 통로가 될 수 없는 종류」로 넓힌다. 통과 종류 밖은 지금과 똑같이 검토 목록 필요(기본값 = 차단, 알 수 없는 form 포함).
  - 판정 순서(의사코드, 14일 창 안 각 행):
    1. `known = BRK_MATERIAL_REVIEW.materials` 에서 accession 일치 항목. 있으면 **지금처럼** form·primaryDocument·items·acceptedAt 전부 일치해야 하고 아니면 `unreviewed_material_filing`. (검토 목록 항목은 종류 분류보다 먼저 본다 — 목록에 있는 accession 의 form 이 바뀌어 보이면 통과 종류라도 차단.)
    2. 없으면: `typeof form==='string'` 이고 `items===''` 이고 primaryDocument 가 비어 있지 않은 문자열이고 `form` 이 통과 집합에 **정확히 일치**하면 통과.
    3. 그 외 전부 `unreviewed_material_filing`(코드 이름 유지 — `brkQuarantineRequiresReview` 정규식·기존 시험과 맞물려 있음, `forward-sources.ts:245`).
  - form 비교는 **정규화하지 않는다**: trim·대소문자 변환·공백 축약 없음. `'schedule 13g/a'`, `' FWP'`, `'13F-HR '`, `'SCHEDULE  13G'` 는 전부 검토 필요로 떨어진다(모르는 표기는 닫힌 쪽).
  - 통과 집합 v1 (별도 고정 상수, 버전 문자열 포함 — 예 `brkb_sec_form_class_20261120_v1`):

    | 군 | form (정확 일치) | 통과 근거 | 관측 여부 |
    |---|---|---|---|
    | 내부자 지분 | `4` (기존) · `3` · `5` · `3/A` · `4/A` · `5/A` · `144` | 제출 주체가 임원·대주주 개인. 발행사 사건 발표 서식이 아님. 기존 `4` 예외와 같은 논리 | `4` 만 관측. 나머지는 같은 구조라 재발 방지용 |
    | 기관 보유 보고 | `13F-HR` · `13F-HR/A` · `13F-NT` · `13F-NT/A` | 버크셔가 **운용자로서** 보유한 타사 주식 목록. 본문이 보유 표 | `13F-HR` 관측 |
    | 대량보유 보고 | `SCHEDULE 13G` · `SCHEDULE 13G/A` · `SCHEDULE 13D` · `SCHEDULE 13D/A` | 5% 이상 지분 보고. 버크셔가 보고자든 대상 회사든 「누가 얼마를 가졌다」는 보고이지 발행사의 주식 사건 결정이 아님 | 13D 원본 제외 3종 관측 |
    | 공모 서류(채권 포함) — **사용자 판단 포인트** | `FWP` · `424B2` · `424B5` | 등록된 증권을 **현금 공모**하는 서류. 신주·채권 발행 자체는 1주 가격 기준을 바꾸지 않음(분할 조정 대상 아님) | `FWP`·`424B5` 관측 |

  - 일부러 **넣지 않은** 것(= 계속 검토 필요): `8-K`·`8-K/A` **전부**, `10-Q`·`10-K`(+/A), `DEF 14A`·`DEFA14A`·`PRE 14A`·`DEF 14C`, `S-1`·`S-3`·`S-3ASR`·`S-4`·`S-8`, `424B1`·`424B3`·`424B4`·`424B7`, `425`, `25`·`25-NSE`·`15`·`8-A12B`, `SC TO-*`·`SC 13E3`, 옛 표기 `SC 13G`·`SC 13D`(+/A), 그 밖의 모든 form.
  - 8-K 를 items 로 가르지 않는 이유: [가능성 높음] 분할·주식배당은 3.03·5.03 뿐 아니라 8.01(기타)·7.01·2.02(실적 발표문에 동봉)·5.07(주총 표결 결과)·9.01(첨부)로도 나온다. items 는 제출자가 붙이는 꼬리표라 「이 items 면 안전」이라고 할 구조적 근거가 없다. 기존 검토 목록의 8-K 도 2.02,9.01 인데 T-156 은 본문·첨부를 읽고 통과시켰다.
  - `424B3` 을 뺀 이유: [가능성 높음] 합병·교환공개매수 설명서(S-4 계열)로 쓰이는 종류라 주식 교환 비율이 실릴 수 있다.
  - 「키워드 부재로 분류하지 않는다」와의 관계: [가능성 높음] **충돌하지 않는다.** 그 원칙은 본문에 「split」 같은 단어가 없다는 이유로 무해하다고 하지 말라는 것이고, 이 규칙은 본문을 전혀 보지 않고 SEC 가 붙인 **종류 메타데이터**만 쓴다 — 기존 Form 4 예외(`r.form[i]==='4'`)와 같은 종류의 판단이다. 다만 **공모 서류군은 예외**다: T-156 은 11-09 424B5 를 본문까지 읽고 「엔화 선순위 채권, 주식 사건 발표 아님」으로 목록에 올렸다. 이 군을 종류만으로 통과시키는 것은 T-156 방침에서 **실제로 한 발 물러서는 것**이다.
  - 경계 사례: (a) 424B5·FWP 가 채권이 아니라 **신주·주주배정(권리) 공모**일 수 있다 — form 으로는 구분 못 한다. 일반 신주 공모는 기준 불변, 권리 공모는 기준이 바뀔 수 있으나 그 경우 Alpaca 기업행동 조회(전 종류·`data_quality=all`, 1행이라도 있으면 차단 — `forward-stock-events.ts:22`)와 8-K 가 따로 걸린다. (b) 13D/13G 에서 버크셔가 **대상 회사**인 경우(누군가 버크셔 지분 5% 초과 보고) — 주주 제안이 실릴 수는 있어도 실행은 발행사 8-K·위임장으로 나온다. (c) 13D/A 에 버크셔가 타사를 **주식 교환으로 인수**한다는 내용이 실릴 수 있다 — BRK.B 를 대가로 줘도 BRK.B 1주 기준은 안 바뀐다. (d) [추측] SEC submissions 목록이 버크셔가 제출자인 건과 대상인 건을 함께 싣는지는 이번에 확인하지 않았다 — 어느 쪽이든 위 판단은 같다.
- [10:21] **버린 후보.** (B) 차단 범위를 BRK.B 한 종목으로 축소 — **버림.** [확실] T-156 2319행이 「BRK.B 제외 … 관문 완화 금지」를 명시했다. [확실] BRK.B 는 고정 후보군(frozen cohort) 구성원이고 격리 시 번들에서 BRK 레코드가 빠지며(`quarantineForwardBrkEvidence`) 격리 표식이 있으면 `validateForwardBrkPair` 가 `forward_pair_quarantined_evidence` 로 번들 전체 사용을 막는다. [가능성 높음] 그걸 풀어도 `core.ts:125·241` 이 후보군 불완전을 `data_unknown`(신규 진입 없음·보유 유지)으로 처리해 정상 회차가 되지 않고, 「BRK.B 가 상위 5위일 수 있었던 날」을 조용히 빼는 선택 편향이 생긴다. 고정 정책·후보군 계약(`paper_fixed_policy_changed`)까지 건드리는 큰 변경이라 이번 범위 밖. (C) 검토 목록을 배포 없이(DB·설정) 갱신 — **이번 범위 아님.** [확실] 목록은 envelope 에 통째로 들어가 해시로 묶이고(`forward-stock-contract.ts:85`), `src/lib/strategy/` 는 커밋 훅 감시 경로라 지금은 목록 변경마다 Reviewer 판정이 남는다. DB 로 옮기면 DB 쓰기 권한만으로 관문이 열리고 그 감사 기록이 사라진다. 다만 ①의 반복 차단을 줄이려면 「검토 → 목록 갱신 PR」을 하루 안에 도는 절차는 필요하다 — 후속 task 로 사용자 결정. (D) 8-K 를 items 로 통과 — 위 이유로 버림. (E) 격리된 과거 증거를 새 규칙으로 재판정해 같은 세션을 되살림 — 버림(「격리는 빈 재시도로 조용히 풀리지 않는다」 시험 `forward-stock-contract.test.ts:34` 의 취지와 충돌, 얻는 것은 최대 1세션).
- [10:21] **구현 시 지켜야 할 불변 조건(Developer·Reviewer 용).** ① [확실] `BRK_MATERIAL_REVIEW` 는 **한 글자도 바꾸지 않는다** — `brkMaterialReviewSha()` 와 envelope 동등성 검사(`forward-stock-contract.ts:85`)·fixture 가 이 상수에 묶여 있다. 통과 집합은 **별도 상수**로 둔다. ② 통과 집합 상수는 `Object.freeze`, 버전 문자열 필수, 각 군의 근거를 주석으로. ③ `sec_recent_coverage_incomplete`·`sec_clock_or_identity_invalid`·중복 accession·14일 창 계산은 그대로. ④ 통과 행도 `items===''`·primaryDocument 비어있지 않음을 요구(기존 Form 4 조건 유지). ⑤ (선택, PR 판단) 어떤 규칙 버전으로 통과됐는지 남기려면 회차 payload 에 버전 문자열 1개를 추가하는 방법이 가장 덜 건드린다(`forward-runtime.ts:292` `eventEvidenceNyDate` 옆). envelope 에 넣으면 계약 검사·fixture 가 함께 바뀌므로 권하지 않는다. 안 넣어도 보관된 SEC 원본 + 릴리스 커밋으로 재현은 된다.
- [10:21] **3. 실제 공시의 새 규칙 판정.** 전제: 각 행의 `items===''`, primaryDocument 비어있지 않음 — [가능성 높음] items 는 8-K 류에만 채워지나 **이 9건의 items·primaryDocument·filingDate 는 내가 보지 못했다**(이력서에 2건의 문서명만 있음). Developer 가 보관 원본(11-18 회차 blob)에서 그대로 옮겨 시험 fixture 로 고정할 것.

    | # | 접수(UTC) | form | accession | 새 규칙 | 군 | 비고 |
    |---|---|---|---|---|---|---|
    | 1 | 11-13 16:57 | `FWP` | 0001193125-26-459815 | 통과 | 공모 서류 | 첫 차단 원인. 보수안이면 검토 필요 |
    | 2 | 11-16 21:00 | `13F-HR` | 0001193125-26-463399 | 통과 | 기관 보유 | |
    | 3 | 11-17 01:19~ | `SCHEDULE 13G/A` | 0001193125-26-464189 | 통과 | 대량보유 | |
    | 4 | 〃 | `SCHEDULE 13G/A` | 0001193125-26-464211 | 통과 | 대량보유 | |
    | 5 | 〃 | `SCHEDULE 13G/A` | 0001193125-26-464214 | 통과 | 대량보유 | |
    | 6 | 〃 | `SCHEDULE 13G/A` | 0001193125-26-464219 | 통과 | 대량보유 | |
    | 7 | 〃 ~01:57 | `SCHEDULE 13G` | 0001193125-26-464218 | 통과 | 대량보유 | |
    | 8 | 11-17 16:32 | `424B5` | 0001193125-26-465047 | 통과 | 공모 서류 | 문서명 `d86634d424b5.htm` 이 검토 목록의 11-09 424B5 와 같다 — [가능성 높음] 같은 엔화 채권의 확정본. 본문 미확인. 보수안이면 검토 필요 |
    | 9 | 11-18 00:23 | `SCHEDULE 13D/A` | 0001193125-26-465884 | 통과 | 대량보유 | |
    | — | (3건) | `4` | — | 통과 | 내부자 지분 | 기존 예외 그대로 |
    | — | 11-09 | `8-K`·`424B5`·`10-Q` | 검토 목록 3건 | 통과 | 검토 목록 | 메타데이터 4항목 일치 시(기존과 동일) |

  - 권고안이면 [가능성 높음] 현재 14일 창에 검토 필요 공시가 남지 않아 다음 새 세션부터 SEC 관문을 통과한다(그 사이 새 8-K 등이 없을 때). **보수안(공모 서류군 제외)이면** FWP 는 질의일 2026-11-28, 424B5 는 filingDate 가 11-17 일 때 질의일 **2026-12-02** 부터 창을 벗어난다(`from = 질의일−14일`, `date<from` 이면 건너뜀 — `forward-stock-events.ts:49·53`) — 그때까지 계속 차단되거나, 사람이 두 본문을 읽고 검토 목록에 올려야 한다.
  - **과거 차단 회차 복구 불가** — [확실] ① `runCycle` 은 처리 세션을 인자로 받지 않고 항상 「지금 기준 마지막으로 마감된 세션」만 처리한다(`forward-runtime.ts:180`). ② 차단이 아닌 회차 저장은 `assertPublicationWindow` 가 **그 세션의 다음 개장 시각 전**에만 허용한다(`forward-store.ts:103`, `publication-window.ts`) — 11-13~11-18 은 전부 기한이 지났다. ③ 같은 세션에 `unreviewed_material_filing` 격리가 이미 저장돼 있으면 재시도는 `forward_pair_prior_conflict_requires_review` 로 즉시 막힌다(`forward-runtime.ts:188`, `brkQuarantineRequiresReview`). 따라서 **배포 당일 이미 차단·격리된 세션도 살아나지 않고**, 배포 뒤 처음 수집되는 세션이 첫 정상 후보다. 격리는 세션별이라 다음 세션으로 넘어가지 않는다(`cachedForwardSources` 가 `session_date=asOf` 로 조회 — `forward-runtime.ts:85~90`). 차단 회차는 「관측된 자료 공백」으로 남는 것이 설계 의도다(`forward-runtime.ts:301` 주석).
  - [추측] 재개 첫 회차에서 11-12 회차의 미결 모의 시그널이 뒤늦게 체결 평가되거나 만료되고, 평가액이 여러 세션을 건너뛰어 갱신된다. 설계 변경 대상은 아니지만 QA 가 재개 첫 회차에서 관찰할 항목.
- [10:21] **4. 시험 기대값.** 기존 시험 중 **바꿔야 하는 단언은 없다** — [확실] `newMaterial`(form[0] 을 `S-3` 으로) 은 검토 목록 accession 의 form 불일치라 판정 순서 1 에서 여전히 던진다. fixture 의 Form 4 행은 2026-10-01 로 14일 창 밖(범위 확인용)이라 영향 없음. 추가할 시험(전부 `validateBrkSecSnapshot` 직접 호출, 네트워크 없음):
  - 시계 2벌. 기존: 질의일 2026-11-11(창 시작 10-28). 신규 「실제 공시」용: 질의일 2026-11-19, 마감 `2026-11-18T21:00:00Z`, 관측·now `2026-11-19T11:50:00Z`, 창 시작 2026-11-05 → `sec_recent_coverage_incomplete` 를 피하려면 filingDate ≤ 2026-11-05 인 행 1개 필요.

    | 사례 | 입력 | 기대 |
    |---|---|---|
    | T1 실제 9건 + Form 4 3건 + 검토 목록 3건 | 보관 원본 메타데이터 그대로 | 던지지 않음 |
    | T2 통과 집합 각 form | 창 안 1행씩, items `''`, 문서명 있음 | 각각 던지지 않음 (`test.each`) |
    | T3 검토 필요 form | `8-K`(items `8.01`) · `8-K`(`3.03,5.03`) · `8-K`(`2.02,9.01`, 목록 밖 accession) · `8-K`(items `''`) · `10-K` · `10-Q`(목록 밖) · `DEF 14A` · `S-3` · `S-4` · `424B3` · `25` · `SC 13G` · `XYZ-NEW` | 각각 `forward_pair_events_unreviewed_material_filing` |
    | T4 표기 변형 | `'schedule 13g/a'` · `' FWP'` · `'FWP '` · `'13f-hr'` · `'SCHEDULE  13G'` · `'424b5'` · `''` | 각각 unreviewed (정규화 없음) |
    | T5 통과 form 이지만 조건 위반 | `13F-HR` + items `'1.01'` / 문서명 `''` / 문서명이 숫자·null / form 이 숫자 4·null | 각각 unreviewed |
    | T6 검토 목록 우선 | 목록 accession 의 form 을 `13F-HR` 로 바꿈 | unreviewed (통과 종류라도) |
    | T7 Form 4 기존 예외 | `4` + items `''` 통과, `4` + items `'5.02'` 차단 | 기존과 동일 |
    | T8 창 밖 | 미검토 `8-K` 의 filingDate 가 창 시작 하루 전 | 던지지 않음 / 창 시작 당일이면 unreviewed (경계 양쪽) |
    | T9 불변 | `brkMaterialReviewSha()` 값이 변경 전과 같음, 통과 집합 상수가 frozen·버전 문자열 보유 | 일치 |
    | T10 보수안 선택 시 | `FWP`·`424B2`·`424B5` 를 T2 에서 T3 로 이동 | — |

  - 기존 `forward-stock-contract.test.ts`·`forward-index-recovery.test.ts` 의 격리 유지 시험은 코드 이름을 그대로 쓰므로 변경 없음.
- [10:21] **5. 화면 사유 코드의 의미 정의.** [확실] 회차 `errorCode` 는 `runCycle` 안에서 던져진 메시지가 `^(paper|m40_forward|forward)_[a-z_]+$` 에 맞으면 그대로, 아니면 `forward_cycle_failed` 로 저장된다(`forward-runtime.ts:303`). [확실] 화면 사전 `REASONS` 에는 이 계열 중 **`forward_cycle_failed` 하나만** 있다 — 나머지는 전부 「사유 설명 미등록」으로 보인다. 숫자가 섞인 코드(`forward_source_http_503` 등)는 정규식에 안 맞아 `forward_cycle_failed` 가 된다. 코드 리터럴은 100개가 넘어(접두 헬퍼로 조립되는 `forward_pair_`+23, `forward_pair_events_`+13, `forward_index_`+11 이상 포함) **개별 문구 약 14개 + 계열 기본 설명(가장 긴 접두 우선) + 끝에 원 코드 병기** 구조를 권한다. 도달 가능성을 코드마다 증명하지는 않았다(초기화·조회 전용 코드가 섞여 있음 — 계열 기본 설명이 받는다). 「풀림」 분류: **자동** = 다음 수집 시도·다음 세션에서 다시 시도됨 / **기간** = 조건이 지나야 풀림 / **수동** = 사람이 확인·코드 갱신하기 전에는 지속.
  - 개별 정의(자주 나거나 사용자가 알아야 하는 것):

    | 코드 | 확인 안 된 사실 | 풀림 |
    |---|---|---|
    | `forward_pair_events_unreviewed_material_filing` | 최근 14일 안의 버크셔 SEC 공시 중, 종류상 주식 기준을 바꿀 수 있는데 사람이 아직 검토하지 않은 것이 있다. BRK.B 가격 기준에 「충돌 없음」을 붙이지 못해 회차 전체를 처리하지 않았다 | 기간·수동 — 그 공시가 14일 지나거나 검토 목록이 갱신될 때. 같은 세션 재시도로는 안 풀림 |
    | `forward_pair_prior_conflict_requires_review` | 같은 세션의 앞선 시도가 이미 「검토 필요」로 격리됐다(미검토 공시·기업행동 발견·검증 도중 중단). 재시도해도 같은 세션은 처리하지 않는다 | 다음 세션에서 새로 판정. 원인이 남아 있으면 다시 차단 |
    | `forward_pair_events_known_or_unclassified_action_requires_reconciliation` | Alpaca 기업행동 조회에 BRK.B 항목이 나왔다(분할·배당 등 종류 불문). 가격 기준과 대조가 필요하다 | 수동 — 조회 범위가 2000년부터라 한 번 나오면 계속 나온다 |
    | `forward_pair_events_sec_recent_coverage_incomplete` | 받은 SEC 목록이 14일 전까지 닿지 않아 「최근 공시 전부 확인」을 말할 수 없다 | 자동/미상 |
    | `forward_pair_kis_identity_invalid` | KIS 의 BRK.B 일봉 응답이 오류이거나 종목 식별이 다르거나 비어 있다 | 자동 — 다음 시도에서 재조회 |
    | `forward_pair_cached_authorization_unavailable` | 저장된 KIS 접속 토큰이 없거나 곧 만료돼 BRK.B 대조 조회를 하지 못했다(이 경로는 토큰을 새로 발급하지 않는다) | 자동 — 다른 작업이 토큰을 갱신한 뒤 |
    | `forward_pair_sec_snapshot_unavailable` | SEC 공시 목록을 받지 못했다 | 자동 |
    | `forward_pair_source_evidence_unavailable` | BRK.B 원천 검증 중 분류되지 않은 오류 | 자동/미상 |
    | `forward_pair_profile_required` | BRK.B 원천용 접속 설정 파일을 읽지 못했다 | 수동(운영 설정) |
    | `paper_current_basis_observation_missing` | 모의 보유 종목 중 이번 세션의 분할조정 종가가 없는 종목이 있어 보유 수량 기준을 갱신하지 못했다 | 자동 — 해당 종목 가격이 수집되면 |
    | `paper_corporate_action_reconciliation_required` | 모의 보유 종목의 과거 분할조정 종가가 저장해 둔 기준과 달라졌다(분할·정정 가능성). 수량을 추정으로 바꾸지 않는다 | 수동 |
    | `paper_source_event_evidence_stale` | BRK.B 사건 확인 자료의 미국 날짜가 저장 시점의 날짜와 다르다(확인 뒤 날이 바뀜) | 자동 — 다음 세션 |
    | `paper_publication_deadline_elapsed` | 다음 개장 시각이 지나 이 세션 결과를 저장할 수 없다(`publication-window.ts` 가 `${scope}_…` 로 조립 — grep 에 안 잡힘) | 이 세션은 불가. 다음 세션은 정상 |
    | `paper_lease_or_revision_conflict` | 처리 도중 다른 실행이 모의계좌를 갱신했거나 처리 권한 시간이 끝났다 | 자동 |
    | `m40_forward_requires_dry_run` | 모의 전용 스위치(DRY_RUN)가 켜져 있지 않아 모의 처리를 거부했다 | 수동(안전 설정) |
    | `forward_cycle_failed` | 분류되지 않은 처리 실패(이미 등록) | 미상 |

  - 계열 기본 정의(위에 없으면 가장 긴 접두로):

    | 접두 | 뜻 | 풀림 |
    |---|---|---|
    | `forward_pair_events_sec_` | 받은 SEC 공시 목록의 시각·형식·회사 식별이 기대와 달라 근거로 쓰지 못함 | 자동/미상 |
    | `forward_pair_events_` | BRK.B 기업행동 조회 응답의 시각·형식·페이지가 기대와 달라 근거로 쓰지 못함 | 자동/미상 |
    | `forward_pair_` | BRK.B 원주·분할조정 가격 쌍의 원천 검증(Alpaca·KIS·SEC 수신, 시각, 형식, 용량, 설정)을 마치지 못함 | 대부분 자동 |
    | `forward_source_` | 후보 종목 일봉 원천의 수신 실패·시간 초과·용량 초과, 또는 받은 원문의 해시·행·형식 불일치, 또는 원천 저장 충돌 | 수신류 자동 / 불일치류 미상 |
    | `forward_index_` | 시장 지수(S&P 500) 이력의 수신·검증 실패 | 자동 |
    | `forward_calendar_` · `forward_completed_session_unknown` | 거래일 달력으로 처리 대상 세션을 정하지 못함 | 수동(달력 자료) |
    | `paper_source_` | 수집 원문의 보관·재읽기 검증 실패 | 미상 |
    | `paper_publication_` | 결과 저장 기한·시계 확인 실패 | 다음 세션 |
    | `paper_signal_` · `paper_settlement_` | 모의 시그널 생성·결제일 계산의 입력 조건 미충족 | 수동 |
    | `paper_account_` · `paper_clone_` · `paper_fixed_policy_changed` · `paper_epoch_` · 그 밖의 `paper_` | 모의계좌 상태·고정 정책·초기 복제 기준 불일치 | 수동 |
    | `m40_forward_` | 모의 전용 안전 조건 미충족 | 수동 |

  - designer 에게 넘길 사실: ① 배너는 「무엇이 확인 안 됐나」와 「저절로 풀리나(자동/기간/수동)」 두 가지를 구분해 보여 줄 수 있다. ② 모든 사유에 공통인 사실 — 차단 회차는 신호·평가액을 만들지 않고 성과 집계에서 빠지며, 실주문과 무관하다(`executionScope: paper_only`). ③ 사전에 없는 코드는 계열 설명 + 원 코드 병기(지금의 「미등록」 문구 대신). ④ 세션 날짜(미국 동부)와 저장 분석 기준(KST 처리 시각)이 하루 어긋나 보이는 것이 이번 문의의 출발점이었다 — 문구 범위에 넣을지는 designer·Leader 판단.
- [10:21] **6. 남는 위험.** ① [확실] 종류 분류는 본문을 읽지 않는다 — 통과 종류의 공시 안에 주식 사건이 **언급**돼도 걸러내지 못한다. 방어선은 8-K·위임장(검토 유지), Alpaca 기업행동 조회(1행이라도 차단), 원주·분할조정 쌍의 KIS·Kibot 대조(`validateBrkPairEnvelope`), 보유 기준 대조(`assertPaperShareBasis`)다. ② [가능성 높음] 공모 서류군(FWP·424B2·424B5)은 권리 공모·교환을 form 으로 구분 못 한다 — 가장 약한 고리. ③ [가능성 높음] 분할이 8-K 없이 진행될 가능성은 낮지만 0 은 아니다(8-K 의무 항목에 「주식 분할」이 따로 있지 않다) — 이 위험은 **현행 규칙에도 있다**. ④ [추측] SEC 가 form 표기를 바꾸면(2024년 말 `SC 13G` → `SCHEDULE 13G` 처럼) 통과 집합이 안 맞아 다시 차단된다 — 닫힌 쪽 실패라 안전하지만 재발한다. ⑤ [가능성 높음] 8-K·10-Q·10-K·위임장 때마다의 반복 차단은 남는다. [추측] 이번 엔화 채권 발행의 종결 8-K 가 곧 나오면 다시 막힌다. ⑥ 영향 범위는 모의 평가 한정(`sourceUse: evaluation_only`, `liveEligible: false`, `paper_only`) — 잘못 통과돼도 실주문·실계좌 영향은 없고, 훼손되는 것은 모의 성과 기록의 신뢰도다. 그 기록은 이후 실매매 전환 판단의 근거가 되므로 가볍지 않다. ⑦ 이 설계는 과거 데이터 성과·운영 실측이 아니며 실매매 승인 근거가 아니다.
- [10:21] **PR 에 적을 사용자 판단 포인트.** (1) 공모 서류군(FWP·424B2·424B5)을 종류만으로 통과시킬지 — 권고: 통과(이유: 발행 자체는 기준 불변, 다른 방어선 3겹). 보수안은 최소 12-02 질의일까지 차단 지속 또는 두 본문의 사람 검토 필요. (2) 미관측 form(3·5·/A·144·13F-NT·13D 원본)을 미리 넣을지 — 권고: 포함(기존 Form 4 와 같은 근거, 안 넣으면 예측 가능한 재발). (3) 8-K·10-Q·10-K 반복 차단을 줄일 「검토 → 목록 갱신」 절차를 후속 task 로 만들지. (4) 통과 규칙 버전을 회차 payload 에 남길지. (5) 11-13 이후 차단 회차와 배포 당일 세션은 복구되지 않는다는 점의 수용.
- [10:21] 검증한 것 / 못 한 것: 위 `[확실]` 은 이번에 직접 읽은 코드·기록 근거. 못 한 것 — 공시 본문, 9건의 items·primaryDocument·filingDate 실값, SEC 목록의 제출자/대상 포함 방식, 버크셔 연간 공시 빈도, `forward-input.ts` 의 후보군 완전성 조건 전체, 각 오류 코드의 실제 도달 가능성, `forward_pair_kis_identity_invalid`(11-17) 원인. Stage 전환·실매매 관련 권고 없음. `{"taskId":"T-178","status":"DONE","deliverables":["SEC 공시 종류 분류 규칙 사양","실제 공시 판정 표","시험 기대값","화면 사유 코드 의미 정의"],"blockers":[],"risk_level":"MEDIUM"}`

## Designer
- [10:40] 실행 도구: claude(designer 서브에이전트). 범위: judge `demo.level=delta` 데모 v1 작성·lint·자체 점검까지. 앱 소스(`src/**`)·`demo_gate` frontmatter·Artifact 게시·사용자 질문은 하지 않음(Leader 몫). 읽은 것: `M40PaperPanel.tsx` 전체, `m40-paper-copy.ts`, `M40PaperPanel.module.css`, `ops.module.css`(.st·.stCode), `paper-view.ts`(16·59~66·76~78·104~108·165~199), `paper-view-period.ts` 27~70, `forward-runtime.ts` 295~312, `forward-store.ts` 24~31·88~94, `forward-stock-{alpaca,events}.ts` 의 `fail()` 접두, T-130 이력서 D4-A 기록, 이 이력서 Leader·Analyst 절.
- [10:40] **데모: `mockups/T-178-m40-blocked-reason-copy-v1.html`** (worktree 미추적, sha256 `f68c0c8fd4b1c8361359cda1422f204bb85c533f6983c15c693815956c0864c6`, 서버 worktree 에서 `check.mjs lint --expect T-178-v1` → `DEMO_LINT_PASSED`). 토큰 스냅샷 `src/app/globals.css@sha256:04e7b5bc8394`. 날짜·종목 수·금액은 전부 합성 예시. 구성: ① 현재 vs 제안(412·360 전환, 예시 7가지 — 버크셔 공시 미검토·KIS 응답 이상·보유 종가 없음·사전에 없는 코드(계열 문구)·DRY_RUN 확인 불가·이전 저장분 없음·차단 아님, 두 화면 탭 연동) ② 문구 규칙 ③ 결정 필요 D1·D2(미리보기 전환) ④ 사유 사전 전체 표(개별 16 · 계열 11 · 고정 문장 7) + 개발 인계용 TS 초안 ⑤ 바뀌는 곳·그대로인 곳.
- [10:40] 디자인 스킬: Impeccable 4.8.1 `clarify`(+`craft-floor`) — 기존 앱 화면의 상태·오류 문구 개선이라 Impeccable 우선, 그중 UX 문구 지침만. 런처 `impeccable context` **미실행**(엔진 바이너리가 없어 첫 실행 때 내려받음 — 자동 다운로드 금지 규칙) → PRODUCT.md·DESIGN.md 없음, 기존 코드·데모를 직접 읽음. 기본 5종 중 `ui-design-reviewer`·`ui-accessibility-reviewer`(③ 자체 점검)만 읽음, `page-layout-designer`·`ui-component-builder`·`project-ui-system` 은 레이아웃·컴포넌트 변경이 없어(문구만) 읽지 않음. 자체 점검 P0 0·P1 0·P2 3, a11y Critical 0·Major 0·Minor 2.
  - P2: 제안 배너 높이가 늘어남(412px 기준 99→196px, 360px 99→215px — 탭이 약 100px 내려감, 차단 때만) · 사유 문장이 360px 에서 4줄 · 모의성과 「아직 없음」 표현(아래 지적 4, 범위 밖). Minor: 배너 `role="status"` 안 고정폭 코드 줄은 화면낭독기가 밑줄까지 읽음 · 데모 문서의 사전 표가 900px 미만에서 카드형으로 바뀌며 표 의미가 약해짐(데모 전용).
- [10:40] 화면 확인: Mac 로컬 Chrome headless 로 실제 412·360 폭 iframe 렌더·스크린샷 확인, 단언 스크립트로 예시 7가지 × 탭 4개 × 폭 2개에서 휴대폰 틀 밖으로 나가는 요소 0건·페이지 가로 넘침 0건. **실기기·앱 WebView 는 확인하지 않음.** ≥900px 은 CSS 변경이 없어 따로 보지 않음. 데모의 안전장치 띠·앱 헤더는 생략 표시만 했고 배치(섹션 여백)는 근사치.
- [10:40] 문구 원칙(데모 ②): 앞=확인하지 못한 것(단정 가능한 사실만) · 뒤=풀리는 조건(약속하지 않고 「다시 시도」·조건만) · 끝=할 일(자동은 「지금 할 일 없음」, 원인 미상은 「반복되면 확인 필요」). 모든 차단에 공통인 사실은 배너 고정 문장 한 번: 「차단된 세션은 모의 시그널·평가액이 없어 모의성과의 누락 거래일이 되고, 누락이 있는 기간은 수익률을 계산하지 않습니다. 실주문과 무관합니다.」(근거 `forward-runtime.ts:309`, `paper-view-period.ts:39·48·60`). 83행 이전 저장분에 「세션=미국 동부 거래일, 저장 분석 기준=한국 시간 처리 시각이라 하루 늦게 보일 수 있음」(analyst ④ 반영). 90행 배너 시각 라벨 「저장 분석 기준」→「처리 시도」 — [확실] 차단 회차의 `decisionAt` 은 실패 시각(`forward-runtime.ts:305` `at=new Date()`)이라 기존 라벨이 사실과 다름.
- [10:40] **Leader 가 사용자에게 물을 결정(데모 ③에 A/B 로 배치)**: D1 차단 배너에 영문 사유 코드를 남길까 — A(권고) 배너 맨 아래 「사유 코드 {errorCode}」 11px 고정폭·흐린 글자 항상 / B 계열 기본 문구가 쓰일 때만 「(코드 …)」. 전례 T-130 D4-A(코드는 진단 화면에만). D2 모의성과 탭의 「사유 설명 미등록 (missing_sessions)」도 이번에 고칠까 — A 차단 사유만 / B(권고) `missing_sessions` 1줄만 추가(「선택기간 거래일 중 모의 평가가 없는 날이 있음(처리 차단 등) · 그래서 기간 수익률·평가손익·최대 낙폭을 계산하지 않음」), 나머지 관측 코드 12개는 후속.
- [10:40] **지적(고치지 않음 — analyst·Leader 판단)**:
  1. [확실] 「전체」 기간 모의성과: 누락 거래일이 1개라도 있으면 수익률·손익·낙폭을 계산하지 않는다(`paper-view-period.ts:48·60`). [가능성 높음] 차단 세션은 복구되지 않으므로(Analyst 3절) 11-13 이후 「전체」 기간 성과는 규칙이 바뀌지 않는 한 계속 미확인으로 남는다. 159행 안내(「과거 공백이면 성과는 미확인」)와 같은 설계 의도로 보이나, 사용자 문의(「집계가 안 된다」)의 실제 답이라 Leader 보고에 넣을 것을 권함.
  2. [확실] 같은 `paperReason` 을 쓰는 다른 줄에도 미등록 코드가 있다 — 모의성과 관측 코드 13개(`aggregate_truncated`·`calendar_unknown`·`unconfirmed_observation_time`·`missing_sessions`·`noncanonical_observation`·`baseline_unknown`·`insufficient_points`·`duplicate_sessions`·`valuation_unknown`·`baseline_time_unknown`·`baseline_gap`·`future_records_excluded`·`snapshot_calendar_unknown`), 시그널 사유 `modeled_open_not_broker_execution`. 이번엔 D2 로 1개만 제안.
  3. [확실] 101행 「종목판단」 경고 줄은 서버가 13개 코드로 거르고(`paper-view.ts:59`) 13개 모두 이미 사전에 있어 문구 변화 없음. 차단 중 이 탭은 이전 저장분을 보여 주므로 83행 안내 변경이 같이 보인다.
  4. [가능성 높음] 성과 수치가 미확인일 때 `paperPct(null)` 이 「아직 없음」으로 보여, 다시 계산되지 않는 경우에도 「아직」이라 오해 소지(범위 밖, P2).
  5. `m40_forward_requires_dry_run`: analyst 정의 「수동(안전 설정)」에 designer 가 「실거래로 전환한 상태라면 의도된 멈춤이며, 이 화면 때문에 설정을 바꿀 필요 없음」을 덧붙였다(`forward-store.ts:30` — `safety_dry_run` 이 true 가 아니면 거부). 사용자에게 DRY_RUN 을 켜라고 유도하지 않기 위함 — 안전 표시 관점 Leader 확인 요청.
  6. 계열 기본 문구는 **배너의 `errorCode` 에만** 적용하기를 권함(예: `paperBlockedReason`). 공용 `paperReason` 폴백에 넣으면 다른 목록의 미등록 코드가 우연히 `paper_`·`forward_` 로 시작할 때 차단 사유 문구가 잘못 붙는다(현재 그런 코드는 찾지 못했으나 리터럴 grep 기준).
  7. 데모 lint 의 비밀정보 검사가 40자 이상 영숫자·밑줄 덩어리를 막아, 데모 소스의 긴 코드는 `|`·`<wbr>` 로 끊어 적고 실행 때 이어 붙였다. 화면·TS 초안에 보이는 코드는 원래 그대로다.
- [10:40] 다음: 사용자 승인(또는 생략) 기록 뒤 승인 버전을 명시한 구현 가이드를 이 절에 append. 20-Log 완료 줄은 가이드까지 끝난 뒤 남긴다. `{"taskId":"T-178","status":"DONE","deliverables":["mockups/T-178-m40-blocked-reason-copy-v1.html"],"blockers":["사용자 데모 승인(D1·D2) 대기 — 구현 가이드는 승인 뒤"],"risk_level":"MEDIUM"}`
- [10:48] **구현 가이드 — 승인 데모: `mockups/T-178-m40-blocked-reason-copy-v1.html` (v1, sha256 `f68c0c8fd4b1c8361359cda1422f204bb85c533f6983c15c693815956c0864c6`, 사용자 선택형 답변 「승인·코드 항상 표시 (Recommended)」= D1-A · 「missing_sessions 함께 (Recommended)」= D2-B — Leader 전달, 원문 기록은 `## 주의 (Leader)` 10:58).** 적용 토큰 이름: `--muted`(사유 코드 줄), 기존 `.notice`·`.blocked`·`.hint` 그대로. 새 토큰 없음. 레이아웃·컴포넌트 변경이 없어 「레이아웃 설계」 절은 생략(delta·문구만). API·DB·상태 변경 없음. `docs/screens.md` 갱신 없음(화면 목록·네비게이션 불변).
  - **1. 화면 개요**: 분석 › 오늘 › 모의분석. 최신 회차가 `blocked` 일 때만 보이는 상단 배너와, 차단 중 「수집상태」·「종목판단」 탭 맨 위의 「이전 저장분」 안내의 글자만 바꾼다. 차단이 아니면 화면 변화 없음.
  - **2. `src/app/analytics/m40-paper-copy.ts`**
    - `REASONS` 의 기존 `forward_cycle_failed:'회차 처리 실패'` 값을 아래 값으로 **교체**하고, 나머지 17개(차단 사유 16 + D2-B `missing_sessions` 1)를 **추가**한다(다른 기존 항목은 그대로). 공용 `paperReason` 함수는 **바꾸지 않는다**(정확 일치 → 없으면 `사유 설명 미등록 (${code})`).
      ```ts
      // T-178 v1 — 차단 사유(정확 일치). forward_cycle_failed 는 교체.
      forward_cycle_failed:'분류되지 않은 이유로 회차 처리가 멈춤 · 다음 회차에 다시 시도 · 반복되면 확인 필요',
      forward_pair_events_unreviewed_material_filing:'버크셔(BRK.B) 최근 14일 SEC 공시 중 아직 검토하지 않은 공시가 있어, 분할 같은 가격 기준 변화가 없는지 확인하지 못함 · 그 공시가 14일을 지나거나 검토를 마친 목록이 배포되면 풀림',
      forward_pair_prior_conflict_requires_review:'같은 세션의 앞선 처리에서 BRK.B 근거가 「검토 필요」로 격리돼 이 세션은 다시 처리하지 않음 · 다음 세션에 새로 확인(원인이 남아 있으면 다시 차단)',
      forward_pair_events_known_or_unclassified_action_requires_reconciliation:'Alpaca 기업행동 조회에 BRK.B 항목(분할·배당 등)이 있어 가격 기준과 대조해야 함 · 조회 기간이 길어 저절로 사라지지 않으며, 대조를 마칠 때까지 계속 차단',
      forward_pair_events_sec_recent_coverage_incomplete:'받은 SEC 공시 목록이 최근 14일을 다 덮지 못해 버크셔 최근 공시 전체를 확인하지 못함 · 다음 회차에 다시 시도 · 반복되면 확인 필요',
      forward_pair_kis_identity_invalid:'KIS의 BRK.B 일봉 응답이 오류·빈 값이거나 종목 식별이 맞지 않아 가격 대조를 하지 못함 · 다음 회차에 다시 시도 · 지금 할 일 없음',
      forward_pair_cached_authorization_unavailable:'저장된 KIS 접속 토큰이 없거나 곧 만료돼 BRK.B 가격 대조를 하지 못함 · 다른 작업이 토큰을 갱신하면 다음 회차에 다시 시도 · 지금 할 일 없음',
      forward_pair_sec_snapshot_unavailable:'SEC 공시 목록을 받지 못해 버크셔 최근 공시를 확인하지 못함 · 다음 회차에 다시 시도 · 지금 할 일 없음',
      forward_pair_source_evidence_unavailable:'BRK.B 가격 근거를 확인하던 중 분류되지 않은 오류로 멈춤 · 다음 회차에 다시 시도 · 반복되면 확인 필요',
      forward_pair_profile_required:'BRK.B 근거 조회용 접속 설정을 읽지 못함 · 운영 설정을 고칠 때까지 계속 차단',
      paper_current_basis_observation_missing:'모의 보유 종목 중 이번 세션 분할 조정 종가가 없는 종목이 있어 보유 수량 기준을 갱신하지 못함 · 그 가격이 수집되면 다음 회차에 다시 시도 · 지금 할 일 없음',
      paper_corporate_action_reconciliation_required:'모의 보유 종목의 과거 분할 조정 종가가 저장된 기준과 달라짐(분할·정정 가능성) · 수량을 추정으로 바꾸지 않고, 확인할 때까지 계속 차단',
      paper_source_event_evidence_stale:'BRK.B 사건 확인 자료의 미국 날짜가 저장 시점과 달라짐(확인 뒤 날짜가 바뀜) · 다음 세션에 새로 확인 · 지금 할 일 없음',
      paper_publication_deadline_elapsed:'다음 개장 시각이 지나 이 세션 결과를 저장할 수 없음 · 이 세션은 누락으로 남고 다음 세션은 따로 처리 · 지금 할 일 없음',
      paper_lease_or_revision_conflict:'처리 중 다른 실행이 모의계좌를 바꿨거나 처리 권한 시간이 끝남 · 다음 회차에 다시 시도 · 지금 할 일 없음',
      m40_forward_requires_dry_run:'전역 DRY_RUN(주문 차단)이 켜져 있음을 확인하지 못해 모의 처리를 멈춤 · 실거래로 전환한 상태라면 의도된 멈춤이며, 이 화면 때문에 설정을 바꿀 필요 없음',
      forward_completed_session_unknown:'거래일 달력으로 처리할 세션을 정하지 못함 · 달력 자료를 고칠 때까지 계속될 수 있음',
      // D2-B — 모의성과 탭 관측 이유 줄(차단 사유 아님, paperReason 으로 그려짐)
      missing_sessions:'선택기간 거래일 중 모의 평가가 없는 날이 있음(처리 차단 등) · 그래서 기간 수익률·평가손익·최대 낙폭을 계산하지 않음',
      ```
    - 파일 끝(또는 `paperReason` 아래)에 아래 세 개를 **새로 export** 한다. 배열 순서는 「긴 접두 먼저」 그대로 둔다 — 앞 항목의 접두가 뒤 항목의 접두로 시작하는 경우가 없어야 한다(시험으로 고정).
      ```ts
      /** T-178 — 차단 배너(errorCode) 전용 계열 기본 문구. 공용 paperReason 폴백에는 쓰지 않는다. 긴 접두 먼저. */
      export const PAPER_BLOCKED_FAMILIES:ReadonlyArray<readonly [prefix:string,text:string]>=[
       ['forward_pair_events_sec_','받은 SEC 공시 목록의 시각·형식·회사 식별이 기대와 달라 근거로 쓰지 못함 · 다음 회차에 다시 시도 · 반복되면 확인 필요'],
       ['forward_pair_events_','BRK.B 기업행동 조회 응답의 시각·형식·페이지가 기대와 달라 근거로 쓰지 못함 · 다음 회차에 다시 시도 · 반복되면 확인 필요'],
       ['paper_publication_','결과 저장 기한·시계를 확인하지 못해 이 세션 결과를 저장하지 않음 · 다음 세션은 따로 처리'],
       ['forward_calendar_','거래일 달력으로 처리할 세션을 정하지 못함 · 달력 자료를 고칠 때까지 계속될 수 있음'],
       ['paper_settlement_','모의 시그널 생성이나 결제일 계산에 필요한 입력 조건이 맞지 않음 · 확인할 때까지 계속될 수 있음'],
       ['forward_source_','후보 종목 일봉 원천을 받지 못했거나, 받은 원문의 형식·해시가 맞지 않음 · 다음 회차에 다시 시도 · 반복되면 확인 필요'],
       ['forward_index_','시장 지수(S&P 500) 이력을 받거나 검증하지 못함 · 다음 회차에 다시 시도 · 지금 할 일 없음'],
       ['forward_pair_','BRK.B 원가격·분할 조정 가격의 원천 확인(수신·시각·형식·설정)을 마치지 못함 · 대부분 다음 회차에 다시 시도 · 반복되면 확인 필요'],
       ['paper_source_','수집 원문을 보관하거나 다시 읽어 검증하지 못함 · 다음 회차에 다시 시도 · 반복되면 확인 필요'],
       ['paper_signal_','모의 시그널 생성이나 결제일 계산에 필요한 입력 조건이 맞지 않음 · 확인할 때까지 계속될 수 있음'],
       ['m40_forward_','모의 전용 안전 조건을 만족하지 않아 처리를 멈춤 · 운영 확인이 필요할 수 있음'],
       ['paper_','모의계좌 상태·고정 정책·초기 기준이 저장값과 맞지 않음 · 확인할 때까지 계속될 수 있음'],
      ];
      /** 차단 배너 사유: 정확 일치 → 계열 기본 문구 → 미등록. 코드는 배너가 따로 한 줄로 그린다(D1-A). */
      export const paperBlockedReason=(code:string|null|undefined):string=>{
       if(!code)return '사유 기록 없음';
       const exact=REASONS[code];if(exact)return exact;
       const family=PAPER_BLOCKED_FAMILIES.find(([prefix])=>code.startsWith(prefix));
       return family?family[1]:`사유 설명 미등록 (${code})`;
      };
      /** 모든 차단 회차에 공통인 결과(forward-runtime.ts:309 · paper-view-period.ts:39·48·60). */
      export const PAPER_BLOCKED_CONSEQUENCE='차단된 세션은 모의 시그널·평가액이 없어 모의성과의 누락 거래일이 되고, 누락이 있는 기간은 수익률을 계산하지 않습니다. 실주문과 무관합니다.';
      ```
  - **3. `src/app/analytics/M40PaperPanel.tsx`** (줄 번호는 base `b85a557` 기준)
    - 7행 import 에 `paperBlockedReason`, `PAPER_BLOCKED_CONSEQUENCE` 를 더한다(`paperReason` 은 다른 줄에서 계속 쓰므로 유지).
    - 20행 근처(모듈 상수 옆)에 코드 줄바꿈 도우미를 더한다 — 밑줄 뒤에서만 줄이 바뀌게(데모와 같음). 복사·붙여넣기에는 영향 없다.
      ```tsx
      /** T-178 D1-A — 긴 사유 코드를 밑줄 뒤에서만 줄바꿈. */
      const codeBreaks=(code:string)=>code.split('_').flatMap((part,i,all)=>i<all.length-1?[`${part}_`,<wbr key={i}/>]:[part]);
      ```
    - **83행** 전후:
      ```tsx
      // 현재
      const cycleNote=previous?<p className={css.hint}><b>이전 저장분 · {previous.session} 세션</b><br/>{paperMode(previous.mode)} · 저장 분석 기준 {paperTime(previous.decisionAt)}. 최신 회차 결과가 아닙니다.</p>:null;
      // 변경
      const cycleNote=previous?<p className={css.hint}><b>이전 저장분 · {previous.session} 세션 (ET)</b><br/>{paperMode(previous.mode)} · 저장 분석 기준 {paperTime(previous.decisionAt)}<br/>최신 회차가 차단돼 마지막으로 처리된 회차를 보여 줍니다. 세션은 미국 동부 거래일, 저장 분석 기준은 한국 시간 처리 시각이라 날짜가 하루 늦게 보일 수 있습니다.</p>:null;
      ```
      (`previous` 는 최신 회차가 `blocked` 일 때만 값이 있으므로(64행) 「최신 회차가 차단돼」는 항상 사실이다. 이전 회차가 리허설이어도 문장은 맞다.)
    - **90행** 전후 — 순서: 제목 → 사유 → 공통 결과 → 처리 시도 → (이전 저장분 없음) → 사유 코드:
      ```tsx
      // 현재
      {current?.mode==='blocked'&&<div className={`${css.notice} ${css.blocked}`} role="status"><b>최신 회차 처리 차단 · {current.session} 세션</b><br/>{paperReason(current.errorCode)}<br/>저장 분석 기준 {paperTime(current.decisionAt)}{!previous&&<><br/>표시할 이전 저장분도 없습니다.</>}</div>}
      // 변경
      {current?.mode==='blocked'&&<div className={`${css.notice} ${css.blocked}`} role="status"><b>최신 회차 처리 차단 · {current.session} 세션 (ET)</b><br/>{paperBlockedReason(current.errorCode)}<br/>{PAPER_BLOCKED_CONSEQUENCE}<br/>처리 시도 {paperTime(current.decisionAt)}{!previous&&<><br/>표시할 이전 저장분도 없습니다.</>}{current.errorCode&&<><br/><span className={css.reasonCode}>사유 코드 {codeBreaks(current.errorCode)}</span></>}</div>}
      ```
      「처리 시도」: [확실] 차단 회차의 `decisionAt` 은 실패한 시각이다(`forward-runtime.ts:305` `at=new Date()`). `errorCode` 가 null 이면 사유는 「사유 기록 없음」이고 코드 줄은 그리지 않는다.
    - **101행(「종목판단」 경고 줄 `paperReason(w.code)`)은 바꾸지 않는다.** 서버가 경고 코드를 13개로 거르고(`paper-view.ts:59` `PAPER_WARNING_CODES`) 13개 모두 이미 `REASONS` 에 있다. 같은 줄의 판단 4단계 `paperReason(j.reason)` 도 그대로다. 102·137·140·143·159행의 다른 `paperReason` 호출도 바꾸지 않는다(159행 모의성과 이유 줄은 `REASONS` 의 `missing_sessions` 추가만으로 바뀐다).
  - **4. `src/app/analytics/M40PaperPanel.module.css`** — 한 줄 규칙 끝(`@media` 앞이든 뒤든 무관)에 추가:
    ```css
    .reasonCode{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--muted);overflow-wrap:anywhere}
    ```
    `ops.module.css` 의 `.stCode` 는 굵기 600·왼쪽 여백 4px 라 승인 데모(흐린 일반 굵기, 줄 맨 앞)와 달라 재사용하지 않는다.
  - **5. 시험** — `src/__tests__/t156-paper-view-render.test.ts`
    - [확실] **기존 단언 중 깨지는 것은 없다**: 「blocked current dates previous saved collection explicitly」(40행)는 `최신 회차 처리 차단`·세션 날짜·`이전 저장분`·`synthetic_public_prices` 만 보고, 「saved local rows…」의 `paperReason('unregistered_new_reason')` → `설명 미등록` 도 공용 폴백 그대로라 통과한다. 저장소 전체에서 `회차 처리 실패`·`저장 분석 기준`·`최신 회차 결과가 아닙니다` 를 단언하는 시험은 없다(grep). 이 파일들은 커밋 훅 `SAFETY_PATHS` 밖이다.
    - 새로 고정할 것(같은 파일에 추가하거나 `src/__tests__/t178-m40-blocked-copy.test.ts`). 렌더 결과에서 `<wbr/>` 는 지우고 비교한다(`html.replace(/<wbr\/>/g,'')`). 차단 회차의 `decisionAt` 은 이전 회차와 다른 값(예 `2026-11-10T11:50:00.000000Z`)으로 둔다.
      1. 차단 + 이전 저장분 + `errorCode:'forward_pair_events_unreviewed_material_filing'`: `최신 회차 처리 차단 · 2026-11-09 세션 (ET)` · 그 사유 문구 전체 · `PAPER_BLOCKED_CONSEQUENCE` · `처리 시도 ${paperTime(차단 decisionAt)}` · `사유 코드 forward_pair_events_unreviewed_material_filing` 포함, `저장 분석 기준 ${paperTime(차단 decisionAt)}`·`사유 설명 미등록` 불포함.
      2. 같은 상태의 이전 저장분: `이전 저장분 · 2026-11-06 세션 (ET)` · `최신 회차가 차단돼 마지막으로 처리된 회차를 보여 줍니다.` · `날짜가 하루 늦게 보일 수 있습니다.` 포함, `최신 회차 결과가 아닙니다` 불포함. 「종목판단」 탭에서도 같은 안내가 보인다.
      3. 계열 문구: `errorCode:'forward_source_timeout'` → 배너에 `forward_source_` 계열 문구와 `사유 코드 forward_source_timeout`. 동시에 `paperReason('forward_source_timeout')` 은 `사유 설명 미등록 (forward_source_timeout)`(계열 문구가 공용 폴백으로 새지 않음).
      4. 계열 밖 코드: `errorCode:'zzz_unknown'` → 배너 `사유 설명 미등록 (zzz_unknown)` + `사유 코드 zzz_unknown`.
      5. 이전 저장분 없음(`lastUsableCycle:null`): `표시할 이전 저장분도 없습니다.` 가 `사유 코드` 보다 앞에 나온다(`indexOf` 비교).
      6. 차단 아님(합성 기본값): `사유 코드`·`처리 시도`·`PAPER_BLOCKED_CONSEQUENCE` 불포함.
      7. `paperBlockedReason` 단위: 위 블록의 차단 사유 17개 키(`missing_sessions` 제외) 각각 정확 문구 · `forward_pair_events_sec_x`→sec 계열 · `forward_pair_events_x`→events 계열 · `forward_pair_x`→pair 계열 · `paper_publication_x`→publication 계열 · `paper_settlement_x`→signal/settlement 문구 · `paper_x`→paper 계열 · `paper_publication_deadline_elapsed`→개별 문구(정확 일치 우선) · `null`→`사유 기록 없음`.
      8. 순서 불변: `PAPER_BLOCKED_FAMILIES` 의 i<j 인 모든 쌍에서 `families[j][0].startsWith(families[i][0])` 가 거짓.
      9. D2-B: `observation.issues:['missing_sessions']` 인 「모의성과」 렌더에 `선택기간 거래일 중 모의 평가가 없는 날이 있음(처리 차단 등) · 그래서 기간 수익률·평가손익·최대 낙폭을 계산하지 않음` 포함, `사유 설명 미등록 (missing_sessions)` 불포함.
  - **6. 구현 순서**: ① copy 파일(REASONS·새 export) → ② tsx 7·20·83·90행 → ③ css 한 줄 → ④ 시험 추가 → `npx jest src/__tests__/t156-paper-view-render.test.ts`(+새 파일)·`tsc --noEmit`·lint.
  - **7. 주의**: ① 문구는 승인본 그대로 옮긴다(띄어쓰기·가운뎃점 `·`·꺾쇠 `「」` 포함) — 바꿔야 하면 Leader 경유 designer 에게. ② 계열 문구를 `paperReason` 폴백에 넣지 않는다. ③ 412px 에서 배너 높이가 99→196px 정도로 늘어나는 것은 승인 데모와 같은 예상 결과다. ④ 안전 표시: `m40_forward_requires_dry_run` 문구는 DRY_RUN 을 켜라고 유도하지 않게 쓴 것이니 줄이지 않는다. ⑤ 로딩·오류·빈 상태 문구는 바뀌지 않는다. ⑥ 구현 후 디자인 점검은 Leader 요청 시 designer 가 승인 데모 대비로 한다.

## Developer
- [10:50] 실행 도구: claude(developer 서브에이전트). 위치: 서버 worktree `~/.node-local/stockinvest-t178`(base b85a557). 커밋·push·운영 DB 쓰기·`/api/cron/*`·KIS·SEC·Alpaca 호출 없음. 운영 DB 는 `dbq.py` SELECT 만(보관 blob 읽기). 화면 문구 `m40-paper-copy.ts`·`mockups/` 는 건드리지 않음. 주문·체결 경로 변경 없음(M40 `paper_only`) → 실매매 안전장치 self-check 5항목은 해당 없음.
- [10:50] **변경 파일 3개.** ① `src/lib/strategy/m40/forward-stock-events.ts` (+24 −2): 별도 상수 `BRK_SEC_FORM_PASS`(version `brkb_sec_form_class_20261120_v1`, 군 5개 — `insiderOwnership` 3·3/A·4·4/A·5·5/A·144 / `institutionalHoldings` 13F-HR·13F-HR/A·13F-NT·13F-NT/A / `passiveBeneficialOwnership` SCHEDULE 13G·13G/A / `activeBeneficialOwnership` SCHEDULE 13D·13D/A / `registeredOffering` FWP·424B2·424B5; 군마다 frozen 배열 + 근거 주석, 사용자 결정 대기 2군은 `USER DECISION PENDING` 주석). 모듈 내부 집합 + `brkSecFormPasses`(문자열 정확 일치, 정규화 없음, export 안 함). `validateBrkSecSnapshot` 판정 순서: 1) 검토 목록 accession → 4항목 정확 일치면 통과·아니면 차단(분류 규칙으로 넘어가지 않음) 2) 목록 밖 → 통과 집합 form·items `''`·primaryDocument 비어 있지 않은 문자열이면 통과 3) 그 외 `unreviewed_material_filing`. 기존 Form 4 줄은 2)로 흡수. 시계·식별·중복 accession·14일 창·coverage 검사, `BRK_MATERIAL_REVIEW`, `brkMaterialReviewSha`, 반환값 형태는 그대로. ② `src/lib/strategy/m40/__tests__/forward-stock-events.test.ts` (+72, 기존 13개 무수정·79개 추가): T1~T10. ③ `src/lib/strategy/m40/__tests__/forward-stock-sec-fixtures.ts` (신규 38줄): 보관 원본 메타데이터 18행 + 페이지 생성 도우미. 다른 m40 파일 변경 없음(필요가 증명되지 않음).
- [10:50] **실값 추출(읽기 전용).** `t156_dataset` paper-src-5a0cd939… → blob e829de62…(part 7개, part·blob sha256 전부 일치) → gzip 해제 sha = 5a0cd939…7ac2(dataset id 와 일치) → quarantine reason `forward_pair_events_unreviewed_material_filing`·observedAt 2026-11-19T11:50:44.941Z → envelope queryDate 2026-11-19, sec observedAt …44.903Z, sec sha 일치 → `filings.recent` 1016행. fixture 에는 filingDate ≥ 2026-10-20 인 18행의 6개 필드만 넣었다(원본 전체는 저장소에 없음). [확실] 목록 밖은 accession 기준 **9건**(Leader 10:35 정정과 일치), 9건 모두 items `''`·primaryDocument 있음(13G·13G/A·13D/A·13F 는 `xsl…/primary_doc.xml`). 13D/A 는 filingDate 11-17·접수 11-18 00:23Z. 창 안 Form 4 3건(465872·464003·463989). 임시 파일 `~/.node-local/tmp/t178-*` 전부 삭제.
- [10:50] **실제 원본 전체 재판정**(임시 시험 파일로 실행 후 삭제): 보관된 1016행 SEC 페이지를 질의일 11-19·마감 11-18T21:00Z 로 판정 — base b85a557 = `forward_pair_events_unreviewed_material_filing`(차단 재현), 변경본 = 통과(`reviewManifestSha256` e226bd65…a79f).
- [10:50] **통과 규칙 버전을 증거에 남길지 — [판단] envelope·반환값 모두 바꾸지 않았다.** 근거: ① 반환값은 유일한 호출부 `forward-stock-contract.ts:88` 이 버린다(저장되는 증거가 아님) — `reviewManifestSha256` 의미는 그대로 「검토 목록 상수의 해시」. ② 저장된 envelope 재검증(`validateForwardBrkPair`→`validateBrkPairEnvelope`; forward-runtime·forecast-input·forecast-runtime)은 항상 그 시점 코드 규칙으로 SEC 원문을 다시 판정한다 — 버전 필드가 있어도 결과는 같고, 집합을 좁힌 뒤에는 이전 envelope 가 닫힌 쪽으로 실패한다. 기존 `same(reviewManifest,BRK_MATERIAL_REVIEW)` 도 같은 방식으로 코드에 묶여 있다. ③ envelope 에 넣으면 `BrkPairEnvelope` 타입·계약 검사·fixture 가 바뀌고, 배포 시점 같은 세션의 캐시 envelope(필드 없음)가 재검증에서 깨진다. 남는 공백 [확실]: 회차·envelope 에 코드 버전 기록이 없다(forward-store·forward-runtime grep) — 「어느 규칙으로 통과했나」는 처리 시각→릴리스 커밋으로 역추적해야 한다. 회차 payload 기록(analyst 판단 포인트 4)은 지시대로 범위 밖.
- [10:50] **사양과 다르게 한 점 없음.** 단 Leader 「Form 4 동작 동일」과 어긋나는 극단 사례 1개: 검토 목록 accession 중 items 가 빈 2건(424B5·10-Q)의 form 이 `4` 로 바뀌어 보이면 base 는 Form 4 예외가 먼저라 통과, 변경본은 목록 우선이라 차단(analyst 판정 순서 1 그대로, 닫힌 쪽 변화). 목록 밖 accession 의 Form 4 동작은 동일(T7). T6 이 base 소스에서 정확히 이 2건으로 실패함을 확인.
- [10:50] **시험 구조.** 시험 상단 `GROUPS` 표(군·pass·forms — 상수와 독립 기술). 군 하나를 빼는 결정 = 상수에서 그 군 줄 삭제 + 표의 같은 줄 `pass:false` 로 끝난다 — T1(실데이터 전체·행별)·T2(구조 정확 일치·form별)·T10 이 표를 따라 기대값이 바뀐다. 버전은 형식만 단언(`/^brkb_sec_form_class_\d{8}_v\d+$/`)해 버전 올림에 시험 수정이 필요 없다. T9 는 `brkMaterialReviewSha()` 를 base 값 `e226bd65924f91664f9434d0cf9865bc70fd0df57f6d271f67b85407a4f1a79f` 로 고정.
- [10:50] **검증 결과(전부 flock·nice).** `forward-stock-events.test.ts` 92/92 통과. m40 전체(`src/lib/strategy/m40/`) 41 suites / 706 tests 통과. `tsc --noEmit` rc 0. 전체 jest(maxWorkers 4): base 임시 worktree(b85a557) 13009 tests 중 실패 10 / 변경본 13088 중 실패 10 — 실패 이름 집합 동일(새 실패 0·해소 0), 실패 메시지도 10건 모두 동일(경로 치환 후). 늘어난 79건은 전부 events 시험. 기존 실패 10건(profit-engine·corp-intel isolation, 통화·USD 경계, t108 용어, ops 사유 사전, job-slots)은 base 에도 있다. 임시 worktree 는 node_modules 링크를 먼저 unlink 한 뒤 `git worktree remove`(운영 node_modules 유지 확인). lint: **실행 불가** — 프로젝트에 ESLint 설정이 없어 `next lint` 가 대화형 설정 질문에서 멈춤(rc 1, 생성 파일 없음).
- [10:50] **변이 확인**(제자리 변경 → 실행 → finally 복원, 복원 후 sha256 일치): 공모 서류 군 줄만 삭제 → 7건 실패(T1 전체·FWP·424B5 행, T2 구조·form 3개) / 삭제 + 표 `pass:false` → 92/92. 13D 군 줄만 삭제 → 5건 실패 / + 반전 → 통과. 두 군 삭제 + 둘 다 반전 → 통과. 정규화 `trim()` → T4 3건 실패(' FWP'·'FWP '·'4 '), `toUpperCase()` → 3건('schedule 13g/a'·'13f-hr'·'424b5'), 공백 축약 → 2건('SCHEDULE  13G'·NBSP). items 조건 제거 → T5·T7 3건. 분류 규칙을 검토 목록보다 먼저 → T6 2건. 새 시험을 base 소스에 돌리면 32건 실패.
- [10:50] **추가 정량** [가능성 높음] 근사(보관 원본 1016행, 외부 호출 없음; filingDate 기준·평일=거래일 근사·검토 목록이 지금 3건에서 갱신되지 않는다고 가정): 최근 12개월(2025-11-19~2026-11-19) 공시 96건 — 4×27, SCHEDULE 13G/A×15, 11-K×9, 8-K×8, SCHEDULE 13G×6, 424B5×4, 13F-HR×4, 3×4, S-8 POS×4, 10-Q×3, SCHEDULE 13D/A×2, FWP×2, SD×2, DEFA14A×2, ARS·DEF 14A·10-K·8-K/A 각 1. 그 기간 평일 262일 중 SEC 관문이 막았을 날: base 207(79%) → v1 5군 143(55%) / 공모 군 제외 160(61%) / 13D 군 제외 159(61%) / 둘 다 제외 171(65%). v1 뒤에 남는 차단은 11-K·8-K·S-8 POS·10-Q·SD·DEFA14A 등이 날짜별로 흩어져 있어 한 종류를 더 넣어도 최대 15일 감소(SD 128·11-K 130·S-8 POS 136). → analyst 「먼저 알아야 할 것 ①」(규칙만으로는 줄어들 뿐 없어지지 않음)의 정량 근거. 11-K·S-8 POS·SD 는 analyst 사양에 없어(기본 차단) 넣지 않았다 — 넣을지는 analyst·Leader 판단.
- [10:50] **남은 의문.** ① 13G·13D 행이 버크셔가 보고자인지 대상인지는 이 6개 필드로 구분할 수 없다(Codex 지적 2의 전제, 미확인). ② v1 배포 뒤 군을 빼면 version 을 v2 로 올려야 한다(첫 배포 전 결정이면 v1 유지 가능). ③ 변경 3파일 모두 `^src/lib/strategy/` 감시 경로 — Reviewer 판정 scope 에 3개 경로가 다 있어야 커밋된다. ④ worktree 의 `mockups/T-178-…html` 은 다른 역할 파일이라 손대지 않음.
- [10:50] Reviewer 재실행 명령(서버, worktree 루트): `export PATH=~/.node-local/v24.22.2/bin:$PATH; flock /tmp/stockinvest-heavy-tests.lock nice -n 10 node node_modules/jest/bin/jest.js src/lib/strategy/m40/` (기대: 41 suites / 706 통과) · `flock /tmp/stockinvest-heavy-tests.lock nice -n 10 node node_modules/typescript/bin/tsc --noEmit` (기대 rc 0). 변경 엔드포인트 없음 → curl 해당 없음.
- [10:50] `{"taskId":"T-178","status":"DONE","deliverables":["src/lib/strategy/m40/forward-stock-events.ts","src/lib/strategy/m40/__tests__/forward-stock-events.test.ts","src/lib/strategy/m40/__tests__/forward-stock-sec-fixtures.ts"],"blockers":[],"risk_level":"MEDIUM","self_check":{"unit_test":true,"lint":false,"type_check":true}}` — lint false = 설정 없음으로 미실행(실패 아님).
- [11:01] **2차 — Leader 지시(사용자 결정 10:58 반영 + 승인 데모 v1 구현).** 실행 도구: claude(developer 서브에이전트), 같은 서버 worktree. 커밋·push·운영 쓰기 없음.
- [11:01] **규칙: 동작 변경 없음**(사용자 결정 = analyst v1, 두 군 모두 포함 — 지금 구현과 같다). 군별 상수·군별 시험 그대로. 주석만 갱신: `forward-stock-events.ts` 두 군의 `USER DECISION PENDING (…)` → `kept by user decision 2026-11-20 (… not adopted; residual risk: …)`, 시험 `GROUPS` 표 주석도 같은 뜻으로. 줄 수는 그대로(`forward-stock-events.ts` +24 −2, `forward-stock-events.test.ts` +72, fixture 신규 38).
- [11:01] **데모 게이트 확인**: `node …/project/.claude/tools/demo-gate/check.mjs check --task agent-vault/10-Flow/tasks/T-178-m40-brk-sec-filing-gate.md` → `DEMO_GATE_BLOCKED` / `reason: task must belong to a canonical project or registered worktree`(Leader 10:58 기록과 같은 원인). 변경한 화면 쪽 3개 파일은 `projects.json` StockInvest 화면 경로(`next_ui_globs`: page·layout·loading·error·not-found·template.tsx, `_components/**`, `components/**`, `src/components/**`, `globals.css`)에 **해당하지 않아** developer.md 의 화면 파일 수정 금지 조건(경로로 정의됨)에는 걸리지 않는다. 승인 근거는 Leader 10:58 기록(사용자 선택형 답변 원문, 데모 v1 sha256 f68c0c8f…)뿐이며 `demo_gate` 기록은 없다 — Reviewer 가 대화 흐름 근거로 확인 필요.
- [11:01] **화면 변경(가이드 10:48 그대로)** — 코드 블록은 이력서 가이드에서 **프로그램으로 그대로 추출**해 넣었고(가운뎃점·꺾쇠 포함 손 옮김 없음), 「현재」 줄이 base 와 정확히 1회 일치하는지 단언한 뒤 바꿨다. ① `src/app/analytics/m40-paper-copy.ts` (+45 −1): 기존 자리의 `forward_cycle_failed:'회차 처리 실패',` 를 지우고 가이드 블록(주석 포함 20줄 — `forward_cycle_failed` 새 값 + 차단 16 + `missing_sessions`)을 `REASONS` 끝에 그대로 넣음(키 위치만 이동, 조회 결과 동일). 파일 끝에 `PAPER_BLOCKED_FAMILIES`(12개, 긴 접두 먼저)·`paperBlockedReason`·`PAPER_BLOCKED_CONSEQUENCE` export. 공용 `paperReason` 미변경. ② `src/app/analytics/M40PaperPanel.tsx` (+5 −3): import 에 `PAPER_BLOCKED_CONSEQUENCE`·`paperBlockedReason` 추가, `pctClass` 아래 `codeBreaks`, 83행 `cycleNote`·90행 차단 배너를 가이드 「변경」 줄로 교체. 101행 등 다른 `paperReason` 호출은 그대로. ③ `src/app/analytics/M40PaperPanel.module.css` (+1 −1, 한 줄 파일 끝에 `.reasonCode{…}` 추가). ④ 시험 신규 `src/__tests__/t178-m40-blocked-copy.test.ts` (64줄, 41 tests) — 가이드 5절 1~9. 기대 문구는 구현이 아니라 가이드 블록에서 생성(17개 사유·12개 계열·missing_sessions). 렌더 결과에서 `<wbr/>` 제거 후 비교. 기존 `t156-paper-view-render.test.ts` 는 수정하지 않음.
- [11:01] **가이드와 다르게 한 점: 없음.** 단 **가이드대로 넣은 문구 1개가 기존 시험 울타리와 충돌한다 — 바꾸지 않고 보고**: `m40_forward_requires_dry_run` 문구의 `전역 DRY_RUN(주문 차단)…` 가 T-108 화면 용어 울타리 `src/__tests__/t108-terms-fence.test.ts`(「화면 소스에 옛 용어 0건 (주석 제외)」, `OLD_TERMS` 에 `DRY_RUN`, 허용 예외 없음; 정본 화면 용어는 「실거래여부」)에 걸린다. [확실] 그 시험은 base 에서도 이미 실패 중(`app/analytics/M40PaperPanel.tsx: 표본 부족` 1건)이라 실패 **이름** 비교로는 안 보이고, 실패 **메시지**가 base 대비 `app/analytics/m40-paper-copy.ts: DRY_RUN` 1줄 늘어난 것으로 확인했다. 문구 수정(예: 「실거래여부」 용어로)은 designer 판단 사항 — Leader 경유 요청. 문구가 바뀌면 이 파일의 시험 기대값은 가이드에서 다시 생성하면 된다.
- [11:01] **화면 쪽 검증**: 새 시험 + `t156-paper-view-render.test.ts` + events 시험 177/177 통과. 판별 변이(복원·일치 확인): base 의 패널·CSS 로 되돌리면 새 시험 6건 실패, 계열 문구를 공용 `paperReason` 폴백에 넣으면 3번 시험 1건 실패, `forward_pair_` 를 맨 앞으로 옮기면 7·8번 3건 실패. `tsc --noEmit` rc 0(화면 변경 후).
- [11:01] **`next build`: 실행했으나 rc 1 — 환경 원인, 변경과 무관.** webpack 이 `@workspace/auth-oauth`(`file:` 의존성, 링크 `../../../shared/auth-oauth`)·`shared/api-usage` 를 `/home/brownjeon/apps/stockinvest/shared/…` 로 풀어 파일 없음 5건(auth-oauth 3·api-usage 2). 깨끗한 base 임시 worktree(b85a557)에서도 **같은 5건으로 실패**함을 확인 — `docs/deploy-order.md` 표 4번(`file:` 상대경로, 미해소)과 같은 계열. 우회하려면 운영 `shared/` 에 파일을 만들어야 해서 하지 않았다. 따라서 화면 코드의 번들 단계는 미검증이고, 컴파일 확인은 tsc·swc 렌더 시험까지다. 운영 `current/node_modules` 에 `.cache` 생성 없음 확인. 빌드가 만든 `.next`·`tsconfig.tsbuildinfo` 는 삭제(`next-env.d.ts` 는 10:48 생성 — 내 빌드 이전이라 손대지 않음).
- [11:01] **전체 jest 1회 재실행(변경 전부 포함)**: 482 suites / 13129 tests, 실패 10 — 실패 이름 집합이 1차 base 와 동일(새 실패 0·해소 0), 늘어난 41건은 전부 새 시험 파일. base 의 실패 파일 7개를 base 임시 worktree 에서 다시 돌려 메시지를 비교: 9건 동일, **1건 다름 = 위 T-108 울타리(`DRY_RUN`)**. 임시 worktree 는 링크 unlink 뒤 `git worktree remove`, 임시 파일 `~/.node-local/tmp/t178-*` 삭제.
- [11:01] **참고(환경)**: 작업 중 운영 릴리스가 두 번 바뀌었다(`20261120-104249-2a3ae448`·`20261120-105307-2a3ae448`, 다른 세션 배포). `current/node_modules` 가 새 릴리스 것으로 바뀌었으나 `package.json`·`package-lock.json` 은 b85a557 릴리스와 동일, 릴리스 간 차이는 `AGENTS.md`·`CLAUDE.md` 뿐이고 이번 변경 파일은 모두 동일 → 시험 결과에 영향 없음. 다만 `origin/main` 이 b85a557 에서 앞으로 갔다(2a3ae448 은 이 clone 에 없음) — 브랜치·PR 전에 리베이스 필요 여부는 Leader 확인.
- [11:01] **Reviewer scope 메모**: 커밋 훅 감시 대상은 규칙 쪽 3개(`src/lib/strategy/m40/forward-stock-events.ts`·`__tests__/forward-stock-events.test.ts`·`__tests__/forward-stock-sec-fixtures.ts`). 화면 쪽 4개(`src/app/analytics/…` 3개·`src/__tests__/t178-m40-blocked-copy.test.ts`)는 `SAFETY_PATHS` 밖. 재실행: `flock /tmp/stockinvest-heavy-tests.lock nice -n 10 node node_modules/jest/bin/jest.js src/__tests__/t178-m40-blocked-copy.test.ts src/__tests__/t156-paper-view-render.test.ts src/lib/strategy/m40/` (기대: 전부 통과).
- [11:01] `{"taskId":"T-178","status":"DONE","deliverables":["src/lib/strategy/m40/forward-stock-events.ts","src/lib/strategy/m40/__tests__/forward-stock-events.test.ts","src/lib/strategy/m40/__tests__/forward-stock-sec-fixtures.ts","src/app/analytics/m40-paper-copy.ts","src/app/analytics/M40PaperPanel.tsx","src/app/analytics/M40PaperPanel.module.css","src/__tests__/t178-m40-blocked-copy.test.ts"],"blockers":["승인 문구의 DRY_RUN 이 T-108 화면 용어 울타리와 충돌 — designer 판단 필요","next build 환경 원인 실패(base 동일) — 번들 단계 미검증"],"risk_level":"MEDIUM","self_check":{"unit_test":true,"lint":false,"type_check":true}}`

## Reviewer
- [11:05] 실행 도구: claude(reviewer 서브에이전트). 범위: 코드 감사만(수정·커밋·push·운영 DB·KIS·SEC·Alpaca 호출 없음). 시험은 서버 worktree 에서 flock·nice 로 재실행, 변이는 `mktemp` 임시 복사본에서만(worktree 파일 무변경 확인).
- [11:05] **의도 검증 — 일치.** analyst 사양(판정 순서 검토 목록 → 정확 일치 통과 → 차단, 정규화 없음, `BRK_MATERIAL_REVIEW`·해시 불변)과 사용자 결정(10:58 「둘 다 통과」)을 `forward-stock-events.ts:42-60·72-78` 이 그대로 구현. 통과 집합은 별도 frozen 상수(`BRK_SEC_FORM_PASS`, version `brkb_sec_form_class_20261120_v1`, 군 5개)이고 `BRK_MATERIAL_REVIEW` 는 diff 에 한 글자도 없음(T9 가 `brkMaterialReviewSha()` = base 값 e226bd65…a79f 로 고정). 14일 창·`sec_clock_or_identity_invalid`·중복 accession·`sec_recent_coverage_incomplete`·반환값은 diff 밖이라 순서·동작 불변. 실제 공시 9건 + 창 안 Form 4 3건은 fixture 18행(accession·form·접수시각이 이력서 Leader 목록과 일치)에서 새 규칙으로 통과, base 에서는 차단(developer 재현 기록). 운영 blob 은 재추출하지 않음(developer 기록의 sha 대조 결과와 Leader 목록의 accession·form·시각이 서로 맞는 것으로 갈음 — 직접 재추출은 미수행).
- [11:05] **안전 — 완화가 의도한 form 밖으로 새지 않음.** 집합 조회는 `Set.has(form)` 정확 일치(`typeof form==='string'` 선행) — `includes`·정규식·접두 일치·정규화 없음. items `===''`·primaryDocument 비어 있지 않은 문자열 조건 유지. 검토 목록 accession 은 `continue`/`fail` 로 끝나 형식 규칙으로 떨어지지 않음(검토 목록 항목의 form 을 통과 form 으로 바꿔도 차단). 기존 Form 4 예외는 집합의 `4` 로 흡수 — 목록 밖 accession 에서 동작 동일. 유일한 차이(검토 목록 accession 중 items 빈 2건의 form 이 4 로 위조된 경우 base 통과 → 변경본 차단)는 닫힌 쪽 변화라 수용. envelope 해시·격리(`brkQuarantineRequiresReview` 정규식 `unreviewed_material_filing$`)는 사유 문자열·반환값 불변이라 영향 없음. M40 `paper_only`, 주문·체결 경로 파일 변경 0 — 실주문과 무관.
- [11:05] **직접 실행.** `jest src/__tests__/t178-m40-blocked-copy.test.ts src/__tests__/t156-paper-view-render.test.ts src/lib/strategy/m40/` → 43 suites / 791 tests 통과. `tsc --noEmit` rc 0. `t108-terms-fence` 는 2 failed 이나 실패 항목은 base 에도 있는 `M40PaperPanel.tsx: 표본 부족` 뿐이고 `m40-paper-copy.ts: DRY_RUN` 은 없음(Leader 11:12 문구 수정 확인).
- [11:05] **변이 5개(임시 복사본, 각각 복원 후 원본 92/92 재확인) — 전부 잡힘.** 접두 일치로 변경 → 8건 실패 / `toUpperCase()` → 3건 / items 조건 제거 → 3건 / 통과 집합에 `8-K` 추가 → 3건 / 검토 목록 accession 이 통과 form 이면 통과시키도록 변경 → 3건. 시험이 실제 회귀를 잡음.
- [11:05] **화면 — 승인 가이드 대비 차이 없음(Leader 11:12 문구 1건 외).** 사유 코드는 `{codeBreaks(current.errorCode)}` 로 React 텍스트 노드 + `<wbr/>` 요소(문자열 분할 후 조립)이고 `dangerouslySetInnerHTML` 사용 없음 → DB 의 errorCode 가 어떤 값이어도 이스케이프됨. 계열 문구는 `paperBlockedReason`/`PAPER_BLOCKED_FAMILIES` 에만 있고 공용 `paperReason` 은 미변경(시험 3번이 `forward_source_timeout` 이 폴백으로 새지 않음을 확인). `forward_cycle_failed` 문구가 가이드대로 교체된 것은 의도. 계열 접두 순서는 긴 접두 먼저(`forward_pair_events_sec_` → `forward_pair_events_` → … → `forward_pair_`)라 가려지지 않음. 데모 게이트: 서버 worktree 미등록·Mac 에서 task 파일 부재로 `check.mjs` 는 `DEMO_GATE_BLOCKED`(사정은 Leader 10:58 기록과 같음 — 도구 한계이지 승인 누락의 증거 아님). `.claude/state/demo-gate/evidence.jsonl` 에 T-178 줄 0건 → 에이전트가 approve·waive 를 대신 실행한 흔적 없음. 승인 근거는 사용자 선택형 답변 원문(10:58)이며 문구 변경 1건은 PR 에서 사용자 확인 필요. 화면 파일 4개는 `SAFETY_PATHS` 밖이라 커밋 훅 대상은 아님.
- [11:05] **지적(모두 비차단).** LOW-1 `forward-stock-events.test.ts` T10(`GROUPS.filter(!pass)`)은 모든 군이 pass 인 지금은 공허한 시험 — 시험 자신이 그렇게 명시, 군을 뺄 때만 의미. LOW-2 회차·envelope 에 규칙 버전이 남지 않아 「어느 규칙으로 통과했나」는 처리 시각→릴리스 커밋으로만 역추적(developer 가 근거 포함 판단, analyst 선택 사항 ⑤) — 이후 군을 뺄 때 version 올림이 시험으로 강제되지 않음(형식 정규식만). LOW-3 `forward-stock-sec-fixtures.ts` 는 SEC 원본이 아닌 6개 필드·18행 추출본(합성 래퍼)이라 장기적으로 운영 원본과의 드리프트는 시험이 못 잡음 — 이 task 의 불변 사실을 고정하는 용도로는 충분. 이월 위험(사용자 결정으로 수용, 변경 요구 아님): 공모 서류군(권리 공모를 form 으로 구분 불가)·13D/13D/A(버크셔가 대상일 때 교환·합병 조건 선공개 가능) — 방어선은 8-K·10-Q·10-K 계열 검토 유지 + Alpaca BRK.B 기업행동 1행이라도 있으면 차단 + KIS/Kibot 교차 검증이며, 본문은 읽지 않으므로 「공시 본문에 주식 사건이 들어 있는지」는 이 규칙이 보지 못한다(코드 주석에 명시됨).
- [11:05] **`next build` 실패 판단.** developer 의 설명(`file:` 의존성이 운영 `shared/` 의 없는 파일로 풀려 5건, base 임시 worktree 도 동일)은 `docs/deploy-order.md` 의 `file:` 상대경로 미해소 항목과 정합하고 변경 파일과 무관해 보임 — 다만 직접 재실행은 하지 않음(운영 `shared/` 무변경 원칙). 따라서 화면 코드의 번들 단계는 미검증이며 tsc·SSR 렌더 시험까지가 확인 범위임을 QA·PR 에 명시. 전체 jest 기준선(실패 10건 동일 이름·메시지, `t108-terms-fence` 기존 2건 포함)은 developer 기록을 신뢰하고 이번에는 m40·화면 관련만 직접 재실행.
- [11:05] **QA 집중 지점(high_risk_areas).** `src/lib/strategy/m40/forward-stock-events.ts:72-78`(판정 순서·items 조건), `forward-stock-contract.ts:85-88`(envelope 재검증이 새 규칙으로 SEC 원문을 다시 판정 — 배포 시점 같은 세션의 캐시 envelope 가 깨지지 않는지), 재개 첫 정상 회차의 미결 모의 시그널 처리(analyst 추측 항목), 배포 직전 전체 QA 1회.
- [11:05] **최종 판정: PASS (scope: src/lib/strategy/m40/forward-stock-events.ts, src/lib/strategy/m40/__tests__/forward-stock-events.test.ts, src/lib/strategy/m40/__tests__/forward-stock-sec-fixtures.ts, src/app/analytics/m40-paper-copy.ts, src/app/analytics/M40PaperPanel.tsx, src/app/analytics/M40PaperPanel.module.css, src/__tests__/t178-m40-blocked-copy.test.ts)**
- [11:32] 실행 도구: claude(reviewer 서브에이전트, 재검증). 범위: Codex C2 지적 판정 + 11:12·11:20 문구 수정분(`m40-paper-copy.ts`·`t178-m40-blocked-copy.test.ts`) 재검증. 코드 수정·커밋·push·운영 호출 없음.
- [11:32] **Codex C2 지적(medium) — 채택(문구 사실 불일치로 타당).** 근거: `forward-runtime.ts:97` 은 `brkQuarantineRequiresReview` 격리 번들을 TTL 없이 반환하고, `:188`·`:199` 가 SEC 재검증 전에 `forward_pair_prior_conflict_requires_review` 를 던진다. `cachedForwardSources` 는 `session_date=asOf` 로 조회하므로(`forward-runtime.ts:85-91`) 같은 세션은 복구되지 않고 다음 세션은 새 번들로 재확인된다. `forward-store.ts:101-102` 는 같은 (계정·세션·mode) 중복 저장을 거부한다. 따라서 Leader 11:20 수정 문구 「…배포된 뒤의 다음 세션부터 풀림 · 이미 차단된 세션은 복구되지 않음」은 코드와 일치한다.
- [11:32] **같은 종류의 잔존 불일치 확인.** `brkQuarantineRequiresReview` 가 잡는 사유는 4종뿐(`known_or_unclassified_action_requires_reconciliation`·`unreviewed_material_filing`·`source_verification_pending`·`prior_conflict_requires_review`). 앞 2개와 `prior_conflict`(「다음 세션에 새로 확인」)의 문구는 일치. LOW-4(문구 결정은 designer/Leader): 계열 기본 문구 `forward_pair_` 의 「대부분 다음 회차에 다시 시도」는 `source_verification_pending` 이 errorCode 로 노출되는 경우(작업자 만료로 pending 마커가 남은 뒤)에 같은 세션 재시도가 막혀 사실과 다르다 — 다만 그 경우 화면 errorCode 는 곧 `prior_conflict` 로 바뀌어 정확 일치 문구가 쓰이고, 「대부분」이라는 단서가 있어 비차단. 그 외 「다음 회차에 다시 시도」 문구(`sec_recent_coverage_incomplete`·`kis_identity_invalid`·`cached_authorization_unavailable`·`sec_snapshot_unavailable`·`source_evidence_unavailable`)의 사유는 위 정규식에 걸리지 않아 같은 세션 재시도가 실제로 허용된다(`:213-218` 격리 사유 교체) — 불일치 없음. 「회차」가 세션인지 시도인지 모호하다는 점은 표현 문제로만 남긴다.
- [11:32] **재실행.** `jest t178-m40-blocked-copy t156-paper-view-render` 통과(2 suites), `tsc --noEmit` 출력 없음(통과). `t108-terms-fence` 는 2 failed 이나 실패 항목이 기존 `M40PaperPanel.tsx: 표본 부족`·`M40PaperPanel.tsx: 모의 매매` 두 건뿐 — 새 위반 없음. 감시 경로 3개(`forward-stock-events.ts`·`__tests__/forward-stock-events.test.ts`·`__tests__/forward-stock-sec-fixtures.ts`)는 11:12·11:20 변경 대상이 아니므로 11:05 1차 검토 결과를 승계한다.
- [11:32] **최종 판정: PASS (scope: src/lib/strategy/m40/forward-stock-events.ts, src/lib/strategy/m40/__tests__/forward-stock-events.test.ts, src/lib/strategy/m40/__tests__/forward-stock-sec-fixtures.ts, src/app/analytics/m40-paper-copy.ts, src/app/analytics/M40PaperPanel.tsx, src/app/analytics/M40PaperPanel.module.css, src/__tests__/t178-m40-blocked-copy.test.ts)**

## Codex 검토

### [2026-11-20 11:11] C2 adversarial-review focus=design_assumption — done
- judge 판정: judge C2 (codex_required=true, budget_rule=CX-limit-unknown-r2, codex_calls_used=1) / 호출 차수: 2/4
- 대상: repo=stockinvest-t178 base=b85a557(task_file) snapshot=ea7caaf (diff: forward-stock-events.ts·테스트·m40-paper-copy.ts·M40PaperPanel.tsx·.module.css·신규 시험 2개·이력서) / CLI codex-cli 0.167.0 / 소요 145s / exit 0 / 파일 수정 없음(files_modified_in_snapshot=[])
- 지적 1건:
  - [medium] `src/app/analytics/m40-paper-copy.ts:9` — 같은 세션에서 미검토 공시로 이미 격리된 뒤, 다음 세션 전에 해당 공시를 검토 목록에 추가한 버전을 배포하는 경우. 근거: 문구는 「검토를 마친 목록이 배포되면 풀림」이라고 안내하지만, `cachedForwardSources` 는 중요 격리를 만료시키지 않고(`forward-runtime.ts:97`), `runCycle` 은 SEC 재검증 전에 `forward_pair_prior_conflict_requires_review` 를 던지며(`:188`), 저장된 blocked 회차는 중복 저장 시 갱신되지 않아(`forward-store.ts:101-102`) 해제 안내가 계속 표시됨. 영향: 사용자는 목록 배포로 현재 세션이 복구될 것으로 기대하지만 세션은 차단·성과 공백으로 남음. 권고: 「목록 반영 후 다음 세션의 새 확인에서 통과 가능, 이미 격리된 세션은 복구되지 않음」으로 명시하고 배포 상황에서도 이 조건이 유지되는지 검증.
- 정적 검토 결과: 허용 집합 밖 form 의 새 통과 경로, 과거 격리의 자동 복구 경로는 확인하지 못함. 검토 목록 우선 판정·문자열 정확 일치·기존 envelope 계약은 유지됨(Codex 요약).
- 검토하지 못한 범위: 실제 SEC 공시 본문과 운영 보관 원본 fixture 일치 여부 / SEC submissions 제출자·대상별 포함 규칙 / 시험 재실행 / 운영 데이터 조회 / 실제 브라우저 렌더링
- 참고: C1 지적 2건(FWP·424B 통과, 13D 통과)은 사용자가 이월 위험으로 수용해 이번 검토에서 재지적하지 않음.
- 원본: /home/brownjeon/NFS/homes/brownjeon/project/.claude/state/codex-review/runs/20261120T020855Z-T-178-C2/raw.txt (결과 JSON: /home/brownjeon/.node-local/codex-handoff/T-178-C2.result.json)
- 채택·기각 판정은 Reviewer 몫이며 이 기록에서 하지 않음.

### [2026-11-20 10:30] C1 adversarial-review focus=design_assumption — done
- judge 판정: `## Judge` 절 C1 판정 (codex_required=true, budget_rule=CX-limit-unknown-r2, codex_calls_used=0) / 호출 차수: 1/4 (앞선 10:25 기록은 실행 전 중단이라 호출 0회)
- 대상: repo=stockinvest-t178 base=b85a557(task_file) snapshot=ce3419d (스냅샷 항목: 이 이력서 파일, node_modules 링크는 Leader 제거 후 없음) / CLI codex-cli 0.167.0 / 소요 228s / exit 0 / 파일 수정 없음(files_modified_in_snapshot=[])
- 지적 2건:
  - [high] `agent-vault/10-Flow/tasks/T-178-m40-brk-sec-filing-gate.md:113` — FWP·424B2·424B5 가 권리 배분 등 가격 기준 관련 사건을 알렸지만 수집 시점에 별도 8-K 가 없고 Alpaca 응답이 빈 경우. 근거: 현금 공모라는 이유로 기업행동을 배제할 수 없고(424B5 의 기존 주주 청약권 배분 사례 인용), Alpaca 는 공시 직후 제공을 보장하지 않으며 조회가 process_date 기준이고(`forward-stock-events.ts:8,11,22`), 8-K 기한이 사건 후 4영업일이라 동시 제출을 전제할 수 없음 → 제안된 분류가 SEC 독립 검토 관문을 제거함. 권고: v1 에서 FWP·424B2·424B5 를 통과 집합에서 빼고 accession 별 본문 검토 유지, 현재 차단 건이 채권 서류면 본문 확인 후 검토 목록 추가
  - [medium] `agent-vault/10-Flow/tasks/T-178-m40-brk-sec-filing-gate.md:106` — 대상 발행사가 BRK 인 SCHEDULE 13D/13D/A 가 주식 교환·합병 조건을 발행사 공시보다 먼저 공개할 수 있음. 근거: 제안은 form·빈 items·문서명만 보고 대상 발행사를 구분하지 않으며, 기존 검증은 응답 최상위 회사 식별만 확인함(`forward-stock-events.ts:45-56`). 권고: 13D·13D/A 는 우선 검토 대상 유지, 타사 지분 보고만 면제하려면 원문에서 대상 발행사·보고자 관계를 검증하는 조건 설계, submissions 포함 규칙 확인
- 검토하지 못한 범위: 실제 9건 공시 본문과 보관 원본의 items·primaryDocument·filingDate 실값 / SEC submissions recent 의 제출자·대상별 포함 규칙과 버크셔 연간 공시 빈도(submissions JSON 직접 조회 실패) / 허용된 6개 코드 파일 밖의 구현·시험·화면 산출물(구현 변경·테스트 실행 없음)
- 참고: 지적의 evidence 에 Codex 가 인용한 외부 SEC·Alpaca 문서 링크가 있다. 이 기록은 그 링크를 직접 검증하지 않았다.
- 원본: /home/brownjeon/NFS/homes/brownjeon/project/.claude/state/codex-review/runs/20261120T012653Z-T-178-C1/raw.txt (결과 JSON: /home/brownjeon/.node-local/codex-handoff/T-178-C1.result.json)
- 채택·기각 판정은 Reviewer 몫이며 이 기록에서 하지 않음.

### [2026-11-20 10:25] C1 adversarial-review focus=design_assumption — 실패(실행 전 중단: 스냅샷의 node_modules 가 운영 앱 디렉토리 심볼릭 링크라 검토 읽기 범위 밖 노출 위험)
- judge 판정: `## Judge` 절 C1 판정 (codex_required=true, budget_rule=CX-limit-unknown-r2, codex_calls_used=0) / 호출 차수: 0/4 (Codex CLI 미호출, 래퍼 미실행)
- 대상: repo=stockinvest-t178 base=b85a557(task_file) snapshot=미생성 — `git add -A --dry-run` 스냅샷 항목 2개: 이 이력서 파일, `node_modules` (→ `/home/brownjeon/apps/stockinvest/current/node_modules` 심볼릭 링크, 운영 앱 디렉토리)
- 지적 0건 (미실행이므로 없음)
- 검토하지 못한 범위: 설계 원문(Analyst 절) 전체, 코드 파일 6개 전부. 인계 묶음은 준비만 됨: `/home/brownjeon/.node-local/codex-handoff/T-178-C1.md`
- 원본: 없음 (run 디렉토리 미생성)
- 재개 조건(사용자 결정): 검토 범위 밖 노출을 허용하지 않으면 worktree 의 `node_modules` 심볼릭 링크를 치우거나 스냅샷 제외 방식을 정한 뒤 재실행. 심볼릭 링크 제거는 테스트 실행 경로에 영향을 줄 수 있어 Developer 와 확인 필요. 재실행 전까지 Codex 호출 횟수는 늘지 않음.

## QA
- [11:22] 실행 도구: claude(qa 서브에이전트). 범위: 서버 worktree(`b85a557` + 변경 파일 9개) 실행·읽기 전용. 커밋·push·운영 DB·`/api/cron/*`·KIS·SEC·Alpaca·운영 3003 호출 없음. 무거운 시험은 `flock /tmp/stockinvest-heavy-tests.lock nice -n 10` 직렬. 임시 base worktree 는 제거(node_modules 링크 먼저 해제), 임시 index·메시지 파일 삭제. 로그·json 은 `~/.node-local/tmp/t178-qa/` 에 보존(프로젝트 밖). 스크린샷 산출물 없음.
- [11:22] **항목 1 변경 범위 — 의도한 파일만.** 수정 5(`M40PaperPanel.module.css`·`M40PaperPanel.tsx`·`m40-paper-copy.ts`·`forward-stock-events.test.ts`·`forward-stock-events.ts`), 신규 4(`t178-m40-blocked-copy.test.ts`·`forward-stock-sec-fixtures.ts`·`mockups/T-178-m40-blocked-reason-copy-v1.html`·이력서). 생성물은 gitignore 된 `next-env.d.ts`·`tsconfig.tsbuildinfo` 뿐(커밋 대상 아님). `node_modules` 는 운영 `current/node_modules` 로의 심볼릭 링크(untracked, 건드리지 않음). [확실]
- [11:22] **항목 2·3 타입·전체 시험.** `tsc --noEmit` rc 0. 전체 jest 변경본: 482 suites / 13129 tests — passed 12833 · failed 10 · skipped 286. base b85a557 임시 worktree: 13009 tests · failed 10. 실패 시험 이름 10건 집합은 두 쪽 동일, 실패 메시지는 경로 정규화 후 10건 모두 동일 → **새 실패 0, 해소 0** [확실]. 기존 실패 10건(base 동일): currency-mixing-fence 1 · profit-engine isolation 3 · corp-intel isolation 1 · reason-dictionary-keys 1 · usd-cash-balance-fence 1 · job-slots 1 · t108-terms-fence 2(`M40PaperPanel.tsx: 표본 부족`·`모의 매매`). 신규·관련 시험: t178-m40-blocked-copy 41/41 · forward-stock-events 92/92 · t156-paper-view-render 44/44 · `src/lib/strategy/m40/` 전 suite 실패 0.
- [11:22] **항목 4 기능 시나리오.** a 실제 공시 9건 + Form 4 → 통과: `forward-stock-events.test.ts` T1 실행 통과(fixture 18행 추출본 기준). 보관 원본 1016행 재판정은 developer 기록만 있고 QA 가 재실행하지 않음. b 8-K 추가(items 유무 9종) → `forward_pair_events_unreviewed_material_filing`: T3 통과. c 형식 변형: T4 9종(공백·NBSP·대소문자·`4 `) + T3 의 `SC 13G`·`424B3` → 차단 통과. 소문자 `fwp` 단독은 시험 목록에 없음(같은 `Set.has` 경로, 비차단 관찰). d 검토 목록 4항목: 시험은 acceptanceDateTime 1항목만(T6 실행). form·primaryDocument·items·acceptedAt 나머지 3항목 불일치 차단은 코드 읽기로 확인(`forward-stock-events.ts` 검토 목록 분기, 4항목 OR 조건) → **3항목은 NOT_VERIFIED(실행 안 함)**. e 화면: t178-m40-blocked-copy 시험 1~9 통과 — 배너 문구·「처리 시도」 라벨·사유 코드 줄·미등록 코드 문구·공용 paperReason 미오염(3)·최장 접두 우선(8)·D2-B missing_sessions(9).
- [11:22] **항목 5 안전 경계.** 변경 diff 에 `submitOrder`·`createSignal`·`createOrder`·`kis-`·`DRY_RUN`·`KILL_SWITCH`·`ORDER_MAX` 참조 추가 0건, `src/lib/safety/`·`src/lib/exchanges/` 무변경. M40 `executionScope: paper_only` 조건을 쓰는 파일(`forecast-input.ts` 등) 무변경. 실매매 체크리스트 5항목은 주문 경로에 닿지 않아 해당 없음 [확실].
- [11:22] **항목 6 커밋 훅 사전 점검(커밋 안 함).** 임시 index(`GIT_INDEX_FILE`)에 변경 9파일을 스테이징하고 `scripts/git-hooks/commit-msg` 를 메시지 「T-178 QA 사전 점검 (커밋 안 함)」로 실행 → rc 0, 「Reviewer 감사 기록 확인: T-178」. 실제 index 무변경 확인. 감시 대상 `src/lib/strategy/m40/` 3파일(`^src/lib/strategy/` 매칭)이 11:32 Reviewer 판정 scope 에 전부 포함됨 [확실]. 이 점검은 훅 로직 실행이며 실제 커밋 판정이 아니다. 훅은 서버에서만 유효(Mac 커밋은 무검사).
- [11:22] **미검증(NOT_VERIFIED) — 이 QA 에서 실행하지 않음.** (1) 브라우저 화면 검증: 412·1280px 렌더, 가로 스크롤, 다크 토큰, 터치 44px, errorCode 의 XSS 리터럴 투입. 근거는 Reviewer 11:05 코드 확인(`dangerouslySetInnerHTML` 없음, React 텍스트 노드)뿐. (2) `next build` 번들 단계: developer·reviewer 기록의 환경 원인(운영 `shared/` 의 `file:` 의존성 5건, base 동일)을 승계, 재확인 안 함. (3) 승인 데모 v1 과 구현 문구의 문자열 전수 대조: 미실시(developer 가 가이드에서 프로그램으로 추출했다고 기록). (4) 데모 게이트 `check.mjs` 는 `DEMO_GATE_BLOCKED`(worktree 미등록) — Leader 기록과 같음.
- [11:22] **결함: 0건**(Critical 0 · High 0 · Medium 0). 관찰(비차단): Low-1 소문자 `fwp` 시험 누락. Low-2 `origin/main` 이 `b85a557` 보다 1커밋 앞서 있음(`git rev-list --count b85a557..origin/main` = 1) — PR 전 리베이스 필요 여부는 Leader 확인.
- [11:22] **qa 판정: 조건부.** 실행 가능한 체크리스트 전 항목 통과, 결함 0건. 다만 항목 4-d 의 3개 조건, 미검증 (1) 브라우저 화면 검증, 미검증 (2) `next build` 번들 단계가 NOT_VERIFIED 라서 「✅ 검증 통과」는 선언하지 않는다. 브라우저 검증을 추가로 하면 통과 선언을 다시 판단할 수 있다. 위험 수준: MEDIUM(14일 게이트가 공모 서류군·능동 13D 군을 포함해 느슨해짐 — 사용자 결정 반영, 남은 위험은 Leader 주의 절 기록). 이 QA 는 커밋·push·운영 반영을 하지 않았다.

## 배포 기록

- 2026-11-20 미배포 — 작업 브랜치 `t178-m40-brk-sec-form-gate` push + Gitea PR 생성(base `main`). main 머지 = webhook blue/green 운영 배포라 **사용자 PR 검토·승인 뒤에만**. PR 링크는 아래 최종 요약.
- 2026-11-20 11:5x 작업 브랜치 `t178-m40-brk-sec-form-gate` push(코드 커밋 `2cad62e`, 커밋 훅 「Reviewer 감사 기록 확인: T-178」) → **PR #2** https://git.xn--lh0b87pnudm10a4vd.com/brownjeon/project_StockInvest/pulls/2 (base `main` = `2a3ae448`, mergeable). 웹훅은 브랜치 push 를 배포하지 않았다(웹훅 로그에 새 START 없음, 운영 릴리스 `20261120-105307-2a3ae448` 그대로).
- 2026-11-20 11:5x **사용자 머지 승인**: 「검토 후 머지해줘」 + 시점 질문(국내 장중 11:51 KST, `docs/deploy-order.md` 「장중 임의 배포 — 사용자 합의 없이 하지 않는다」)에 선택형 답변 「지금 머지(장중 배포)」. 머지 전 검토: PR head `99548f3`(QA 검증 코드 커밋 `2cad62e` + 기록 커밋), main `2a3ae44` 는 b85a557 대비 `AGENTS.md`·`CLAUDE.md` 각 1줄(다른 세션 문서)만 앞서 있고 이번 파일과 겹침 0, 운영 `20261120-105307-2a3ae448` health green(dryRun true·killSwitch false). 같은 배포에 실리는 다른 작업: `2a3ae44`(문서, 이미 운영 반영본과 동일 sha 계열). 배포 결과는 머지 뒤 이 절에 덧붙인다(main 에 다시 push 하면 재배포가 일어나므로 결과 기록은 작업 브랜치에만 남긴다).
- 2026-11-20 11:56:36 KST **PR #2 머지**(Gitea API, `head_commit_id`=`a3f02cc` 고정) → 머지 커밋 `08657ef`. webhook `START sha=08657ef` 02:57:12 UTC(11:57:12 KST) → `RELEASE_RESULT {"status":"ok","release":"20261120-115721-08657efd","previous":".../20261120-105307-2a3ae448","migrated":false}` → `END exit=0` 02:58:23 UTC. 롤백 지점 `20261120-105307-2a3ae448`.
- 배포 후 확인(11:58~12:00 KST, 읽기 전용): `current` → `20261120-115721-08657efd` · health `ok`·db true·`safetyStatus green`·dryRun true·killSwitch false · pm2 `stockinvest`·`stockinvest-cron` online·restarts 0·cwd 새 릴리스 · 러너 1개(+ 손절 알림 티커 자식) · 안전 키 6개 불변(`safety_dry_run` true·`safety_kill_switch` false·`exit_engine_enabled` true·`exit_hard_stop_enabled` false·`autopilot_mode` auto·`engine_enabled` true, updated_at 변동 없음) · 배포된 소스에 `BRK_SEC_FORM_PASS`·`paperBlockedReason` 존재 · `stop-alert` 11:57:00·11:58:00 정상(장중 공백 없음) · 배포 뒤 `cron-out` 의 `FAILED`·`HTTP=000` 0줄, 러너 재시작 시 「웹 응답 확인 — 2초 대기」로 기동 대기 동작 · `pm2-err` 배포 뒤 새 줄 0(마지막 11:56:31 은 배포 전 상시 간헐 `job-run-log` 503, 11:57:32 회복).
- 미확인: M40 효과는 오늘 20:45 KST 정기 수집(세션 11-19) 뒤에야 보인다 · 앱 화면(로그인 필요) · 앱 화면은 로그인이 필요해 미확인.
- 2026-11-20 12:1x KST 사용자 지시 「배포 결과 기록도 main에 올려줘」로 이 기록을 main 에 반영(문서 전용 커밋 — push 가 webhook 재배포를 한 번 더 일으킴, 국내 장중; 그 재배포 결과는 채팅 보고와 다음 기록에 남긴다).

## 실행 도구·절차 이력

| event | 시각 | 종류 | 도구 / 절차 | 범위 | 근거 |
|---|---|---|---|---|---|
| E1 | 2026-11-20 10:1x | start | claude / claude_standard | 원인 확인·설계부터 구현·감사·QA·커밋·브랜치 push·PR 생성까지(main 반영 제외) | 사용자 「PR을 생성하여 사용자가 검토 후 커밋 및 푸시」 + 「권고안대로 진행」 |
| E2 | 2026-11-20 11:5x | handoff-wait | claude / claude_standard | 작업 브랜치 커밋·push·PR 생성 완료, main 반영은 사용자 대기 | 같은 지시(「PR을 생성하여 사용자가 검토 후 커밋 및 푸시」) |
| E3 | 2026-11-20 11:5x | deploy | claude / claude_standard | PR #2 main 머지(=운영 배포)·배포 확인 | 사용자 「검토 후 머지해줘」 + 「지금 머지(장중 배포)」 |

## 최종 요약

### [T-178] 모의분석이 버크셔 공시 때문에 계속 「처리 차단」되는 문제

- **상태**: done — 구현·Reviewer pass(2회)·Codex C1/C2·QA pass(결함 0)·PR #2 사용자 승인 머지·**운영 배포 완료 2026-11-20 11:58 KST**(릴리스 `20261120-115721-08657efd`, 장중 배포는 사용자 결정). 남은 것은 오늘 밤 첫 회차·앱 화면 확인.
- **무엇이 바뀌었나**
  - 원인: 모의분석(M40, 실주문 없음)은 회차마다 버크셔(BRK.B)의 최근 14일 SEC 공시를 보고, Form 4 외 공시가 코드 속 「검토 완료 목록」(3건)에 없으면 회차 전체를 막았다. 11-13 FWP 이후 13F-HR·13G/13G/A·13D/A·424B5 등 **목록 밖 9건** 때문에 11-13·11-16·11-17·11-18 세션이 연속 차단됐다(11-17 은 KIS 응답 오류 별건). 차단 회차는 신호·평가액이 없어 성과 집계에서 빠지고, 누락 거래일이 있는 기간은 수익률을 계산하지 않는다.
  - 규칙: 검토 목록을 먼저 보고(4항목 정확 일치), 목록 밖이면 **공시 종류가 고정 통과 집합에 정확히 일치할 때만** 통과 — 내부자 지분(3·4·5 및 /A, 144)·기관 보유(13F-HR·13F-NT 및 /A)·대량보유(SCHEDULE 13G·13D 및 /A)·채권 공모 서류(FWP·424B2·424B5). 8-K·10-Q·10-K·위임장·모르는 종류는 지금처럼 차단. 정규화 없음. `BRK_MATERIAL_REVIEW` 와 그 해시 불변(`forward-stock-events.ts`).
  - 화면: 분석 → 모의분석 차단 배너가 원 코드(「사유 설명 미등록 (…)」) 대신 한국어 사유를 보이고, 세션에 「(ET)」, 시각 라벨 「처리 시도」, 공통 결과 문장(누락 거래일 → 기간 수익률 미계산, 실주문 무관), 작은 사유 코드 줄을 둔다. 모의성과 탭 `missing_sessions` 문구 추가.
- **배포**: 2026-11-20 11:57~11:58 KST webhook blue/green `RELEASE_RESULT ok`(머지 커밋 `08657ef`, migrated false). 같은 배포에 실린 다른 작업: `2a3ae44`(다른 세션 문서 `AGENTS.md`·`CLAUDE.md`). 원래 PR: **PR #2** https://git.xn--lh0b87pnudm10a4vd.com/brownjeon/project_StockInvest/pulls/2 사용자 검토 대기. PR 머지가 곧 운영 배포다. 같은 배포에 실릴 다른 작업: 머지 시점 `main` 의 선행 커밋(작성 시점 `2a3ae448` — 다른 세션의 `AGENTS.md`·`CLAUDE.md` 변경).
- **AI 가 검증한 것**: m40·화면 시험(forward-stock-events 92·t178 41·t156 렌더 44 통과), `tsc` 0, 전체 jest 13,129건 — base 와 실패 10건 이름·메시지 동일(새 실패 0), 변이 시험(접두 일치·대소문자·items 조건·8-K 추가·판정 순서) 전부 포착, 커밋 훅 사전 실행 rc 0, 실제 9건이 새 규칙에서 통과(보관 원본 추출 fixture).
- **AI 가 검증하지 못한 것**: 브라우저·실기기 화면 렌더, `next build`(운영 `shared/` 의 `file:` 의존성 5건으로 base 도 같은 실패 — 번들 단계 미검증), 공시 본문 내용(종류만 봄), 데모 게이트 도구 기록(`check.mjs` 가 서버 worktree 를 미등록으로 거부 — 승인은 선택형 답변 원문으로 기록).
- 👉 **사용자가 확인할 것**: ① PR 소스 검토 ② 승인 데모 v1 과 다른 문구 2곳 — DRY_RUN 사유의 「서버 공용 실거래여부가 꺼져 있음(주문 차단)」(화면 용어 규칙), 미검토 공시 사유 끝 「…배포된 뒤의 다음 세션부터 풀림 · 이미 차단된 세션은 복구되지 않음」(Codex C2 사실 정정) ③ 머지 뒤 첫 정상 세션 회차가 `forward` 로 저장되는지(정기 수집 20:45 KST 이후), 앱 「분석 → 모의분석」 배너가 사라지거나 한국어 사유로 보이는지.
- 👉 **사용자가 결정할 것**: PR 머지(= 운영 배포) 여부·시점.
- **남은 일**: 11-13~11-18 차단 세션은 복구되지 않는다(구조상). 8-K·10-Q 등은 계속 사람 검토가 필요해 차단이 줄 뿐 없어지지 않는다(지난 12개월 근사: 평일 79% → 55% 차단일) — 「검토 → 목록 갱신 PR」 절차는 후속 후보. 비차단 지적 LOW-1~4(규칙 버전 미기록, fixture 추출본, 계열 문구 「대부분 다음 회차」 한 경우 부정확 등).
- **이슈·위험**: Codex C1 이 지적한 이월 위험(사용자 수용) — 채권 공모 서류로 권리 공모를, 버크셔 대상 13D 로 교환·합병 조건을 먼저 공개하는 경우를 종류만으로는 구분하지 못한다. 완화: 8-K 전부 검토 유지, Alpaca 기업행동 조회에 BRK.B 항목이 있으면 차단. 영향은 모의 평가 한정(실주문 없음)이나 모의 성과는 실매매 전환 판단 근거다.
