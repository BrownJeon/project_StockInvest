---
task_id: T-072
title: 검증 상태 관문(D5) — 검증 안 된 전략의 신규 매수 실주문 차단 + 합격 기준 사전 등록
status: in-progress
priority: high
roles_involved: [leader, analyst, developer, reviewer, qa, deployer, judge, codex]
related_tasks: [T-064, T-067, T-070, T-073]
tags:
  - type/task
  - domain/safety
  - domain/strategy
aliases:
  - D5
  - 검증관문
created: 2026-10-23
updated: 2026-10-23
base_ref: 1163fe2d9a74e42d516d3f4340220498e9cdcfa9
risk_level: R2
developer_model: opus
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

# T-072 — 검증 상태 관문 (D5)

> **수익 경로 연결(제1원칙)**: "백테스트 미검증 전략의 실매매 운용 금지"는 수익 주장의 전제다(프로젝트 CLAUDE.md 금기). 08-02 재구성 결정 D5 는 이를 문장이 아니라 코드로 막기로 했는데 **구현돼 있지 않다.** 이 task 는 그 모순을 없앤다. 이후 모든 개선(T-073 의 방향 표시 포함)이 믿을 수 있는 숫자를 내려면 이 관문이 먼저다.

## 접수 배경 (2026-10-23 00:2x, 사용자 대화)
- 10-22 밤 미국장에서 승인 대기 시그널이 생성됐으나 사야 할 근거가 없었다. 원인: 08-02 결정 D4 로 장중 AI 판단이 제거돼 **룰(`rsi-oversold-v1`: RSI14(1h)<38 ∧ 가격<MA20(1h) ∧ 양봉 또는 저점 상승)만으로 시그널이 생성**되고, MA20 아래 낙폭 하한도 없다.
- D5(`strategies.validation_status` ∈ unvalidated/backtested/paper_validated, `DRY_RUN=false` 실주문은 backtested 이상만) — `src` 에서 `validation_status` 검색 0건, 주문 공통 관문에 검증 상태 확인 없음 [확실, 이 세션 grep]. 독립 감사 [[T-067-profitability-audit]] F04 도 같은 결론. 운영 `safety_dry_run=false`(인수인계 10-22 22:50 실측) → 미검증 룰 시그널을 승인하면 실주문이 나간다.
- 기존 백테스트 요약(`strategies.last_backtest_result`: Sharpe 1.24·승률 61.3%, 2026-08-06)은 **근거로 쓰지 않는다.** 감사 F04: 보유 중 급락을 MDD 에 반영 못 함(100→10→110 가격에서 MDD 0%)·API 국내 10종목 한정·마지막 봉 강제청산·상세 `backtests` 테이블 0행.
- 사용자 지시(10-23): 제안한 작업(이 task + T-070 적용 + 합격 기준 사전 등록)을 한 뒤 대시보드 개선 [[T-073-dashboard-direction]] 을 진행.

## 범위(안 — 사용자 결정 반영 후 확정)
1. `strategies.validation_status` ENUM('unvalidated','backtested','paper_validated') DEFAULT 'unvalidated'. **마이그레이션은 사용자 승인 사항**(개발·운영이 같은 DB, 롤백은 코드만).
2. 주문 공통 관문 앞단에서 `side='buy'` 이고 해당 전략이 `unvalidated` 면 거절하고 사유를 `eval_funnel`/`trade_logs` 에 남긴다. **보호 청산(매도·손절)은 절대 막지 않는다**(시험으로 증명).
3. 상태 승급은 코드가 임의로 하지 않는다: 사전 등록 합격 기준 통과 + 증거 링크(T-070 사후검증·T-064 새 검증 엔진 결과)가 있을 때만. 초기값은 전 전략 `unvalidated`.
4. 합격 기준 사전 등록: analyst 초안 → 사용자 확정. [[T-064-profit-engine-design]] §14 D4(합격 기준 숫자)와 **같은 항목이므로 중복 결정 금지** — D4 를 확정하는 자리에서 함께 정한다.

## 사용자 결정 (확정 2026-10-23 00:1x — 근거 원문)
- **D-1 = 전부 차단** (원문 "D-1: 전부 차단"). Leader 권고는 (a)였고(룰 시그널만 차단·카드/직접 확정은 경고 후 허용, 10-19 결정 "카드는 건별 승인이면 미검증이어도 허용"과 일치), 사용자가 (b)를 택했다. **위험은 한 번 고지함**: 이미 승인 흐름에 있는 카드·직접 확정 시나리오까지 막혀, 새 검증 엔진(T-064)이 승급 증거를 낼 때까지 **앱을 통한 신규 매수는 전부 불가**. 같은 반론을 반복하지 않는다.
- **D-2 = 가상 체결로 기록해 검증 데이터로 사용** (원문 "D-2: 가상 체결로 기록해서 검증데이터로 사용할 수 있도록 해줘").
- **D-3 = 승인** (원문 "D-3: 승인") — 마이그레이션 적용과 배포 창(오프아워) 승인. 배포 창은 인수인계 기준 KST 05:10~08:30(07:55~08:10 제외) 또는 15:40~22:00. 미국장(KST 22:30~05:00, 11-01 서머타임 종료 후 23:30~06:00) 중 배포 금지.

## Leader 설계 방침 (Stage 0 이 코드 근거로 확인·반박한다 — 틀리면 바꾼다)
- **L-1 "전부 차단"의 해석**: 전략·시그널·카드·시나리오 경유의 **모든 신규 매수**(룰 시그널 승인/자동 제출, entry-watcher, 텔레그램 승인, post-market 카드, 사용자 직접 확정 시나리오). 앱 안에 *전략 귀속이 없는 사용자 직접 주문* 경로가 있으면 Stage 0 이 목록화하고, **이번 gate 의 기본은 막지 않고 사용자에게 보고**(사용자 본인의 재량 주문이라 '전략 운용'이 아님 — 사용자가 막으라고 하면 추가).
- **L-2 보호 청산은 절대 막지 않는다**: `side='sell'` 은 상태와 무관. 손절·청산 엔진·매도 제안 실행 경로가 gate 때문에 못 나가는 일이 없음을 시험으로 증명.
- **L-3 가상 체결 저장소는 `executions` 가 아니라 별도 테이블**(`paper_fills` 가칭): 실측 `executions` 는 `order_id NOT NULL`(→`orders` 실주문 행 필요)·0행이고 order-sync·장부(T-071)·손익·한도가 읽는다. 가짜 `orders` 행을 만들면 실계좌 장부·일일 한도·킬스위치 낙폭 계산이 오염된다. D6 의 문구(`executions(simulated=1)`)와 다르다 — **Stage 0 이 `executions`/`orders`/`trade_logs` 를 읽는 모든 코드를 열거해 이 판단을 확정·반박**한다.
- **L-4 이중 관문**: ① `createSignal` 앞단(T-058 현금 게이트와 같은 자리) — 막힌 매수는 승인 가능한 시그널·승인 요청 알림을 만들지 않고 가상 체결만 기록(승인 불가 알림 소음 방지). ② `submitOrder` 방어선 — 모든 송신 경로가 우회할 수 없게(`CLAUDE.md` 실매매 원칙 1).
- **L-5 fail-closed**: 전략 상태 조회 실패·`strategies` 에 없는 전략 ID(실측: `exit-engine-v1` 2,800건·`oversold-bounce-v1` post-market 36건·`rsi_momentum_v1` 7건·전략 없음 9건)는 `unvalidated` 로 취급해 **매수만** 차단. 매도 영향 없음.
- **L-6 가상 체결 최소판**: 진입만 기록(의도 주문의 시장·종목·지정가·수량·금액·수수료 추정·`fill_model` 라벨·원 시그널 ID). 청산·손익 평가는 T-070 사후검증/T-064 엔진이 일봉으로 계산하고, 가상 매도 시뮬레이션은 **이번 범위 밖**(필요하면 후속). 수수료는 해외 편도 0.25%(확정), 국내는 코드의 기존 비용 상수를 따른다. 낙관적 체결 가정이므로 `fill_model` 로 구분해 분석 때 보정한다.
- **L-7 배포 순서**: ① 마이그레이션(컬럼 추가 `DEFAULT 'unvalidated'` + 테이블 신설 — 구 코드에 무해, 멱등, `--apply`/`--rollback`) → ② 코드 배포(push, 오프아워) → ③ 배포 후 확인. 마이그레이션 실행은 공유 DB 변경이라 자동 권한 분류기가 거부할 수 있다(T-048 선례) — 거부되면 사용자가 직접 실행. 롤백은 코드 revert, 컬럼·테이블은 존치.
- **L-8 `signals.status` ENUM 은 건드리지 않는다**(부팅 시 INFORMATION_SCHEMA 대조·불일치 시 기동 실패, D2). 새 상태가 필요하면 Stage 0 이 근거와 함께 제안.

## 작업 패키지
| WP | 내용 | 담당 | 상태 |
|---|---|---|---|
| WP-0 | Stage 0 — 주문 송신·`executions` 읽기 경로 전수, 삽입 지점, 미등록 전략 ID, 마이그레이션 설계 (읽기 전용, 코드 0줄) | developer(opus) | 완료 00:33 |
| WP-1 | 설계 확정 → judge C1 → (필요 시) Codex | leader | 완료 00:4x (F-1~F-16, Codex C1 1/4) |
| WP-2 | 구현 + 시험(격리 사본에서 검증 — 작업 트리에 타 세션 변경 68경로) | developer | 대기 |
| WP-3 | Reviewer → judge C2 → Codex → Reviewer 판정 줄 → QA | reviewer·qa | 대기 |
| WP-4 | 마이그레이션 → 배포(오프아워) → 확인 | deployer | 대기 |
| 별도 | 합격 기준 사전 등록 = T-064 D4 와 같은 항목 — analyst 초안, 사용자 확정(이 task 의 차단 로직과 독립) | analyst | 대기 |

> 공유 작업 트리 주의: 10-23 00:1x 기준 `git status` 68경로(타 세션 `api-usage` 계열·`package.json`·`llm`·`notify` 등). T-072 후보 경로(`src/lib/safety`·`src/lib/signals`·`src/lib/db.ts`·`src/app/api/strategies`·`scripts/migrations`)는 겹치지 않음을 확인했다. **커밋은 명시 경로만**, 검증은 `git archive HEAD` 격리 사본에서.

> ⚠ **켜는 순간의 결과를 먼저 알려야 한다**: 지금 모든 전략이 `unvalidated` 이고 기존 백테스트 엔진은 신뢰 불가(F04)라서 승급 경로가 아직 없다. D-1(a) 로 켜면 **새 검증 엔진(T-064)이 나올 때까지 룰 시그널 기반 신규 매수는 실주문이 0건**이 된다. 이게 의도한 결과이며, D-2 를 같이 하지 않으면 그 기간 검증 데이터도 쌓이지 않는다.

## 단계
- 접수: judge intake 완료 — 규칙 엔진(외부 전송 없음), risk R2(`R2-kw-migration`), developer opus, 데모 불필요(화면 변경 없음 — 전략 화면에 상태 표시를 넣기로 하면 재접수). 결과 파일은 이 task 의 `## 판단 기록 (judge)` 에 요약.
- Stage 0 (읽기 전용, Developer): 주문 송신 호출 경로 전수(`submitOrder` 호출부, entry-watcher, 텔레그램 승인, auto-submit, 청산 엔진, sell-proposal 실행)와 **우회 불가인 삽입 지점**, 보호 청산 경로 식별.
- C1 judge → (필요 시) Codex 설계 검토 → Developer → Reviewer → judge C2 → Codex → Reviewer 판정 → QA → 사용자 확인 → Deployer(마이그레이션 승인 후 오프아워).
- 안전 경로(SAFETY_PATHS)라서 커밋 훅이 `## Reviewer` 마지막 판정 줄(scope 포함)을 요구한다. 스스로 PASS 를 적지 않는다.

## 설계 확정 (Leader, Stage 0 반영 — 2026-10-23 00:5x) ※ 앞의 L-1·L-4 는 이 절이 대체한다
Stage 0(WP-0) 결과를 검토했고 핵심 사실 3건(submitOrder 호출부 4곳·어댑터 직접 호출 0·post-market 카드가 `pending` 직접 INSERT)을 코드에서 독립 재확인했다.
- **F-1 범위 = 앱이 내보내는 모든 신규 매수.** 사용자 원문 "전부 차단"을 따라 `POST /api/orders` 직접 주문도 막는다(화면 호출 없음·curl 전용, `source='manual'` 이력 0건 — 막아도 실사용 손실 없음, 열어 두면 우회 구멍). **L-1 의 'discretionary 예외'는 철회.** `submitOrder` 의 귀속(attribution) 미지정 = 전략 귀속 NULL 로 취급 → 차단. 모든 호출부가 귀속을 명시하는지 정적 시험으로 고정.
- **F-2 관문 6곳 G1~G6 채택**(Stage 0 C 표): createSignal·카드 INSERT·custom/confirm·승인(웹/텔레그램)·entry-watcher·submitOrder. 모든 지점에서 **`side` 판정이 첫 줄**, 매도는 `strategies` 조회를 아예 하지 않는다(조회 실패가 매도 실패로 번지지 않게).
- **F-3 post-market 카드(G2)**: 승인 불가 상태(`skipped`)로 기록 + 가상 체결(`zone_touch_pending`). **사용자 고지: 대시보드 '내일' 탭·추천 탭에서 신규 카드가 사라진다**(새 검증 엔진 전까지). 카드 생성 배치는 계속 돈다 — 카드의 진입 구간·목표·손절이 가상 체결 검증 데이터이기 때문. 화면에 '검증 전' 표시를 넣는 것은 T-073(데모 게이트) 몫.
- **F-4 DRY_RUN 과 무관하게 적용**(판정 단순화, `isDryRun` 오판에 기대지 않음). D5 원문(실주문만)보다 넓다.
- **F-5 수수료 기록**: 해외 편도 0.25%(확정). 국내 진입 편도는 실제 위탁수수료 약 0.014%(`style.ts:55` 주석)를 `fee_rate_pct` 에 라벨과 함께 기록하고, 매도 제세금·수수료는 평가 단계(T-064/T-070)가 적용한다(행마다 율을 남겨 나중에 바꿀 수 있음). 낙관 편향 방지를 위해 평가 때 보수 값을 쓸 수 있다.
- **F-6 전략 ID 불일치**(`oversold-bounce-v1`(카드) ↔ `oversold-bounce-daily-v1`(strategies))는 이 task 에서 맞추지 않는다 — 미등록은 fail-closed 유지. **승급 전에 정리해야 하는 후속 항목**(승급해도 카드는 계속 막히는 함정).
- **F-7 막힌 시그널의 기록**: `skipped` + `indicators.gate='validation_gate'`(기존 9개 소비자·학습셋 불변). `price`·`price_at_skip` 을 채운다(T-070 사후검증이 `price` 를 읽음). 사후 가격 백필은 없음(검증은 `paper_fills`+일봉). **막힌 경우에도 진입 쿨다운을 건다**(안 걸면 룰이 매 틱 재발화해 2시간에 최대 약 20배 중복 — 10-22 `003550` 5회 실측).
- **F-8 잔여 행**: G4(승인 시도)·G5(감시)는 선점·주문 전에 막고, 잔여 `approved_pending_entry` 는 조건부 UPDATE→`superseded` + `trade_logs`(`signal_validation_gate`)로 종결. 00:29 기준 대기·감시 행 0건 — **배포 직전 재확인**.
- **F-9 기록 체계**: eval_funnel 게이트 `validation_gate`(stage 11, skip)·`validation_lookup_error`(stage 11, error) append(`GATE_STAGE`·`GATE_LABEL_KO` 동시), `orders.blocked_by='validation_gate'`(`OrderResult.blockedBy` 유니온에 추가), trade_logs 이벤트명 ≤ 32자. `POST /api/signals`·`analyst/run` 은 `validation_gate` 를 skipped 로 분류, 텔레그램 `mapFailure` 에 한국어 문구.
- **F-10 승급 경로 봉쇄**: `PATCH /api/strategies/[id]` 는 `validation_status` 를 받지 않는다(코드+시험: 이 필드만 보내면 400·값 불변). 승급은 증거 확인 후 **사용자 승인 SQL 로만**. 커밋 훅 `SAFETY_PATHS` 에 `^src/app/api/strategies/` 추가는 훅 변경이라 **사용자 결정(미결)** — 결정 전까지는 코드 방어만.
- **F-11 DDL/배포**: `scripts/migrations/T-072-validation-gate.sql` (setupDB 에 넣지 않음 — 배포=DDL 방지, 멱등, 롤백 SQL 은 주석). **마이그레이션 → 코드 배포 순서**(안전이 아니라 가상 체결 데이터 완전성 때문). 코드 revert 롤백은 **신규 매수를 다시 연다**(운영 `safety_dry_run=false`) — 롤백 시 킬스위치/DRY_RUN 판단 동반. DDL 실행은 자동 권한 분류기가 거부하면 사용자가 직접(T-048 선례).
- **F-12 G6 발동 = 우회 버그의 신호**: `markBlocked` 의 스로틀 없는 경고 알림을 그대로 둔다(G1~G5 가 있으면 평소 0건이어야 함).
- **F-13 `paper_fills`** 스키마·`fill_model`·중복 방지(`UNIQUE(signal_id)`+`INSERT IGNORE`)·통화(현지 통화 단가+환율, 환율은 `fx_rates` 1시간 이내만)는 Stage 0 E 절 제안 채택. 가상 체결 INSERT 실패는 **삼키고 차단 유지**(던지지 않음).

## Codex C1 지적 판정 (Leader, 2026-10-23 00:4x — 코드로 사실 확인 후, 호출 차수 1/4)
| # | Codex 지적 | 판정 | 조치 |
|---|---|---|---|
| 1 high | 마이그레이션 후 blue/green 컷오버 중 관문 없는 구버전 프로세스가 공존해 미검증 매수가 나갈 수 있음 | **채택(성격 변경: 코드가 아니라 배포 절차)** | F-14 |
| 2 high | 검증 조회(G6)와 `realSubmit` 사이에 await 가 많아 그 사이 강등되면 미검증 매수가 나감 | **부분 채택** — `dry-run.ts:150-215` 에 한도·변동성·DRY_RUN 조회가 실제로 5개 이상 끼어 있음(확인). 재조회는 채택, 세대 번호·공유 잠금 프로토콜은 **기각** | F-15 |
| 3 medium | 두 엔진 실행이 같은 후보를 동시에 평가하면 서로 다른 `signal_id` 로 감사 행·가상 체결이 중복(`UNIQUE(signal_id)` 로는 못 막음) | **채택** — `setCooldown`(`cooldowns.ts:146-166`)은 사후 UPSERT 라 선점 여부를 알려주지 않음(확인). `cooldowns` 에 `UNIQUE uq_cooldown(scope,symbol,strategy_id,side,exit_kind)` 존재(실측) | F-16 |

- **F-14 배포 절차(Deployer 필수 단계)**: ① 창은 **국내·미국 모두 폐장이고 시간외 거래도 없는 시간대만** — KST 05:10~08:30(07:55~08:10 제외) 우선, 대안 18:10~22:00. ② 마이그레이션 직후·배포 직전에 `pending/pending_approval/awaiting_approval/detected/approved_pending_entry/executing` 0행과 진행 중 주문(accepted/partial) 0건을 재확인. ③ 배포 후 **구 프로세스 공존 구간이 끝났는지**(pm2 상태·`current` 링크가 새 릴리스·구 릴리스 프로세스 없음) 확인한 뒤에만 '완료'를 선언. ④ 킬스위치/DRY_RUN 임시 전환은 **채택하지 않음** — 공유 DB 설정 쓰기이고 보호 청산까지 막으며 알림 부작용이 있고, 폐장 시간대 배포로 노출 자체가 없다. ⚠ 이 판단은 "폐장 시간대에는 주문이 거래소로 나가지 않는다"는 가정에 기댔는데 **WP-2a Developer 가 코드로 확인한 결과 `submitOrder`·국내/해외 어댑터 `createOrder`·`approveSignal`·`POST /api/orders` 어디에도 장 시간 확인이 없다**(장 시간 판정은 `engine.ts:1181`·`entry-watcher/route.ts:195` 뿐). 따라서 가정을 **'트리거가 없다'로 고쳐 쓴다**: 매수를 일으키는 자동 트리거(엔진·entry-watcher)는 장 시간에만 돌고, 사람 승인 경로는 기존 대기 행이 있어야만 동작하며, 그 행은 배포 직전 0건임을 확인한다. 즉 폐장 시간대 배포의 안전은 '거래소가 거절해 준다'가 아니라 '매수를 일으킬 입력이 없다'에 기댄다(사용자에게 고지).
- **F-15 송신 직전 재검증**: G6 를 **킬스위치·블랙리스트·한도·변동성 검사 뒤, `isDryRun()` 분기 앞**으로 옮기고(F-4: DRY_RUN 무관), 실주문 경로에서 `realSubmit` 호출 **직전에 같은 판정을 한 번 더**(PK 조회 1회, fail-closed). 세대 번호·공유 잠금은 기각한다: 승급·강등은 사용자 승인 SQL 로만 일어나고(코드가 바꾸지 않음), 이미 송신 중인 주문은 어떤 설계로도 회수할 수 없다 — 노출 창을 DB 왕복 1회로 줄이는 것으로 충분. 운영 규칙: 강등 SQL 은 폐장 시간대에 실행.
- **F-16 쿨다운 원자적 선점(G1 엔진 경로)**: `claimCooldown(key, ttl)` 신규(`src/lib/strategy/cooldowns.ts`) — ① `INSERT IGNORE`(affectedRows 1 = 선점), ② 아니면 `UPDATE … WHERE (키) AND until <= NOW()`(affectedRows 1 = 선점). ⚠ **`ON DUPLICATE KEY UPDATE` 는 쓰지 않는다**: mysql2 기본 `FOUND_ROWS` 에서는 '변경 없음'과 '삽입'이 둘 다 1 이라 선점 여부를 구분할 수 없다 — Developer 가 일회용 MariaDB 로 실증. **선점한 쪽만** skipped 감사 행·`paper_fills` 를 만든다. 선점 실패는 기록만 생략(차단은 유지), DB 오류도 던지지 않고 기록만 생략(과대계상보다 과소계상이 안전). G2 카드는 T-045 `NOT EXISTS`·T-048 유니크 인덱스가 중복을 막으므로 INSERT 에 성공한 카드 행 id 로 `paper_fills` 를 만든다.
- 파일 목록 추가: `src/lib/strategy/cooldowns.ts`(+시험).

## Codex C2 판정 반영 · 배포 체크리스트 · 후속 조건 (Leader, 2026-10-23 04:1x)
- **Codex C2(차수 2/4) 판정은 Reviewer**: 지적 1(G6·직접 주문 차단이 감사 행·가상 체결을 안 만든다, Codex high) = **오탐(데이터 계약 밖)**, 지적 2(감사 행/카드와 `paper_fills` 비원자성) = **부분 채택·비블로킹**. 최종 판정은 pass 가 유지된다(독립 감사의 마지막 판정 줄). 사용자 보고에는 "**D-2 가상 체결 대상은 시그널이 있는 G1·G2 뿐, 직접 주문·G3~G6 차단은 흔적(`orders`·`trade_logs`)만**"을 명시한다. `docs/db-schema.md` 에 같은 문장·고아 정의·`LEFT JOIN` 소비 규칙·탐지 쿼리를 반영했다.

#### 배포 체크리스트 (Deployer — F-14 + 감사 조치 (a))
1. **창**: KST 05:10~07:50 (07:55~08:10 제외) 또는 18:10~22:00. 미국장 중·국내 정규장 중·국내 시간외 단일가(~18:00) 배포 금지.
2. **배포 직전(읽기 전용)**: `scratchpad/t072-predeploy.sql` 계열 점검 — 승인 대기·감시(`pending/pending_approval/awaiting_approval/detected/approved_pending_entry`) **0행**, 진행 중 주문(accepted/partial/submitted) 0건, 최근 30분 주문 0건. (5월의 오래된 매도 행 `executing` 3건·`orders.pending` 1건(#2107)은 기존 잔여로 제외.) 운영 설정 기록: `safety_dry_run=false`·`safety_kill_switch=false`·`autopilot_mode=assist`·`exit_engine_enabled=false`.
3. **마이그레이션 먼저**(D-3 승인): `scripts/migrations/T-072-validation-gate.sql` — 적용 후 `SELECT id, validation_status FROM strategies` 16행 전부 `unvalidated`, `SHOW CREATE TABLE paper_fills` 에 `uq_paper_fills_signal` 존재. 자동 권한 분류기가 거부하면 사용자가 직접 실행(T-048 선례).
4. **push(=배포)**: 명시 경로만 커밋(타 세션 변경 68경로 제외). `RELEASE_RESULT` `ok`, 해시 일치, pm2 `stockinvest`·`stockinvest-cron` online·재시작 0, **구 프로세스 공존 종료 확인 후에만 '완료' 선언**.
5. **배포 후(읽기 전용)**: ① **고아 탐지 쿼리 기대값 0**(쿼리 전문: `docs/db-schema.md`) ② strategies 16행 전부 `unvalidated` ③ `/api/health` 200·인증 없는 요청 401·cron 틱 재개 ④ 새 오류 로그 없음(`validation_lookup_error` 0) ⑤ **다음 장중 관측**(국내 09:00 이후·미국 22:30 이후): `eval_funnel` 에 `validation_gate` skip, `signals` 에 skipped 감사 행, `paper_fills` 증가(같은 종목·전략은 120분에 1행), **승인 요청 알림 0건**, 매도·손절 경로 영향 없음.
6. **롤백 주의**: 코드 revert 는 관문을 없애 **신규 매수를 다시 연다**(`safety_dry_run=false`). 롤백을 결정하면 킬스위치/DRY_RUN 판단을 함께 한다. 컬럼·테이블은 존치.

#### 후속·승급 전 선행 조건 (코드로 막지 못했거나 이 task 범위 밖 — 누락 방지용 정본)
1. **첫 승급 전(필수)**: ⓐ 전략 ID 불일치 정리 — 카드 `oversold-bounce-v1` ↔ strategies `oversold-bounce-daily-v1`(정리 전에는 승급해도 카드가 계속 막힌다) ⓑ `POST /api/signals` 의 `body.strategyId` 신뢰 경계 정하기(클라이언트가 검증된 전략 ID 를 주장할 수 있음) ⓒ 승급은 **사용자 승인 SQL 로만**, 폐장 시간대에, `validation_evidence`·`validation_changed_at` 을 채우고 강등도 같은 규칙.
2. **`paper_fills` 첫 소비 전(착수 조건: T-064/T-070 후속)**: 고아 재조정(멱등)과 탐지 0 확인, 소비 쿼리는 `signals` 기준 `LEFT JOIN` + `quantity > 0` 필터, `fill_model`·`gate_reason`·`origin` 층화.
3. **T-073(대시보드)에 포함**: 웹 승인 큐 `ApprovalQueue.tsx:136-137` 이 거절 응답을 읽지 않아 문구가 안 보임(잔여 대기 행 시나리오 한정), 카드가 사라진 '내일'·추천 탭의 '검증 전' 표시.
4. **사용자 결정 대기(훅 변경)**: `SAFETY_PATHS` 에 `^src/app/api/strategies/` 추가(권고: 추가).
5. **정보성**: 상태 무관 집계 4곳이 새 `skipped` 행을 센다(소비자 점검), G6 차단 상세에 DB 오류 문구가 실릴 수 있음, `telegram-approval.ts` 모듈 그래프 확대, MariaDB 10.11 실행 미검증(일회용 DB 는 11.8.8), 어댑터는 여전히 `=== 'buy'` 만 매수로 보며 방어는 `submitOrder` 입구 정규화에 있음.

## 관련 열린 사실
- T-070 은 10-22 22:57 에 이미 배포됨(릴리스 `20261022-225754-1163fe2d`). 남은 것은 `daily_bars` DDL 적용과 스모크(사용자 승인·05:10~08:30 창) — 이 task 와 독립이지만 승급 증거를 만들 데이터원이다.

## 판단 기록 (judge)
- 2026-10-23 intake(규칙 엔진 `dev-rules@0.5.0`): risk R2(`R2-kw-migration`), developer_model opus, demo none, next=assign.
- 2026-10-23 00:4x judge C1(`codex_gate`, R2, 요약 약 400자·코드 없음, 엔진 jev): `codex_required=true` · mode `adversarial-review` · focus `concurrency` · `budget_rule CX-limit-unknown-r2` · `codex_calls_used 0` · `codex_switch on`. 호출 차수 1/4 → 아래 `## Codex 검토` 에 기록, 판정은 위 "Codex C1 지적 판정".

## 데모 검토 (demo gate)

> 실행 판정 정본은 frontmatter `demo_gate` 이다. 이 표는 check.mjs 가 함께 기록하는 사람용 이력이다(docs/demo-review-gate.md).

| 버전 | 상태 | 저장소 파일 | Artifact | 사용자 결정 | 일시 |
|---|---|---|---|---|---|
| - | 해당없음 | - | - | judge: none | 10-23 00:05 |

## Developer

### Stage 0 — 읽기 전용 사실 조사 (2026-10-23 00:33, developer opus, 코드 0줄)

- [00:33] 근거 기준: HEAD `1163fe2`. 인용한 소스 파일은 전부 작업 트리 **미수정** 경로다(타 세션 68경로 — `llm`·`notify/telegram*`·`fx.ts`·`kis-http.ts` 등 — 는 근거로 쓰지 않음). DB 는 읽기 전용 세션(SELECT/SHOW)으로 00:19~00:29 KST 실측. jest 는 실행하지 않았다(금지). 아래 [확실] = 이번에 코드·DB 를 직접 읽어 확인, [가능성 높음]/[추측] = 추론.

#### 0. Leader 방침 L-1~L-8 대조 (결론 먼저)

| 방침 | 판정 | 요지 (근거는 아래 절) |
|---|---|---|
| L-1 | 보완 | 전략 귀속 없는 경로가 1개가 아니다. `POST /api/orders`(화면 호출 없음) 외에 **`/recommend/build` "내 시나리오 만들기" → custom/confirm**(화면 있음, 원 카드 없음)이 있다. 이것은 D-1 의 "직접 확정 시나리오"이면서 동시에 "전략 귀속 없는 사용자 주문"이라 둘 중 무엇인지 **사용자 확인 필요**(B·I) |
| L-2 | 성립 | 매도 경로 8종 식별. 관문은 `side==='buy'` 판정 **전에 어떤 I/O 도 하지 않아야** 매도에 새 실패 원인이 생기지 않는다(B) |
| L-3 | 확정 | `orders`/`executions` 를 읽는 코드 15곳 이상, 그중 일일 한도·종목 한도·배관 검증·체결 손익이 상태 필터만으로 합산한다 → 별도 테이블이 맞다(E) |
| L-4 | **틀린 부분 있음** | ① createSignal 을 **거치지 않는** 매수 생성 경로 2개(post-market 카드 직접 INSERT, custom/confirm 직접 INSERT `approved_pending_entry`) → ①만으로 "승인 가능한 시그널을 만들지 않는다"가 성립하지 않는다. ② `OrderRequest` 에 전략 ID 가 없다 → submitOrder 방어선은 `SubmitOptions` 확장이 필요. ③ entry-watcher 는 submitOrder 에서 막히면 선점을 되돌려 **매 분 재시도**한다 → 선점 전 검사가 필수(C) |
| L-5 | 성립 + 주의 | 미등록 ID 4종 확인(D). T-058 현금 게이트를 복제하면 **fail-open** 이 된다(그쪽은 "모르면 막지 않는다·스위치 읽기 오류=꺼짐·30초 캐시") — 같은 자리·같은 반환 모양, **반대 판정 규칙**(C·D) |
| L-6 | 보완 | ⑴ 카드(구간 진입)는 생성 시점에 체결 여부를 모른다 → `fill_model` 분리. ⑵ 룰은 시그널을 못 만들면 매 틱 재발화한다(실측) → 중복 방지 필요. ⑶ 해외는 USD 단가를 명시 저장해야 T-070 이 환율을 역산하지 않는다(E) |
| L-7 | 성립 + 보완 | 코드가 마이그레이션보다 먼저 나가도 **안전**하다(컬럼 없음 = 조회 오류 = fail-closed 로 매수 차단 — 의도한 결과와 같다). 다만 그동안 가상 체결이 유실된다. **롤백(코드 revert)은 매수를 다시 연다**(H) |
| L-8 | 성립 | 기존 `skipped`/`ai_skipped` 로 충분 — ENUM 변경 불필요(F) |

#### A. 신규 매수가 거래소로 나갈 수 있는 경로 전수 [확실]

`submitOrder` 호출부는 저장소 전체에서 **4곳**이다(`git grep` HEAD, 테스트 제외). 어댑터 `createOrder` 직접 호출은 **0건** — `createOrder` 는 `kis.ts:155-156`(시장 라우터)과 각 어댑터 정의(`kis-domestic.ts:292`, `kis-overseas.ts:573`)뿐이고, 주문 엔드포인트(`order-cash`·`trading/order`)·TR ID 도 어댑터 파일 안에만 있다(`kis-domestic.ts:295-339`, `kis-overseas.ts:576-638`).

| # | 송신 지점 | 트리거 | side 출처 | 전략 ID 출처 | `source` |
|---|---|---|---|---|---|
| S1 | `service.ts:507-510` createSignal 자동 제출 | `routeSignal` 이 auto 일 때 — 운영 `autopilot_mode="assist"`(실측)라 진입은 현재 도달 안 함. 단 `indicators.exit_kind ∈ {hard_stop, eod_loss_cut}` 는 **모드 무관 auto**(`router.ts:253`, `274-282`) | `input.side` | `input.strategyId`(시그널 행) — `OrderRequest` 에는 없음(`types.ts:6-19`) | `'auto'` |
| S2 | `service.ts:602-605` approveSignal | 웹 `/api/signals/[id]/approve`(`approve/route.ts:46`, 진입 구간 없는 시그널) · 텔레그램 버튼(`telegram-poller.ts:210`) | 행 `side` | 행 `strategy_id`(`service.ts:567`) | `'signal'` |
| S3 | `entry-watcher/route.ts:440-443` | `approved_pending_entry` 행: approveSignalHybrid(`service.ts:738`, 같은 행·전략 유지) 또는 custom/confirm 신규 행(`confirm/route.ts:197`) | 행 `side` | **SELECT 에 strategy_id 없음**(`:208-215`) → 추가 필요. custom/confirm 행은 NULL(`confirm/route.ts:188`) | `'auto'` |
| S4 | `orders/route.ts:77-81` POST /api/orders | 사람이 만든 JSON — 저장소 안 호출자 없음(`:32-34` 주석 + grep: 화면은 GET 만) | `body.side` | 없음 | `body.source ?? 'manual'` — **클라이언트가 고른다**(`:79`) |

시그널 생산자(매수 시그널이 생기는 곳):

| 생산자 | createSignal 경유? | 근거 |
|---|---|---|
| 장중 룰 엔진 진입 | 경유 | `engine.ts:1432` → `createSignalGuarded`(`:223-271`) → `service.ts:326` |
| POST /api/signals (strategyId 선택 입력) | 경유 | `signals/route.ts:16`, `:67` — 저장소 안 호출자 없음 |
| POST /api/analyst/run (`rsi_momentum_v1`) | 경유 | `analyst/run/route.ts:48`, `:58` — cron 미등록(cron-runner.sh 목록), 수동 전용 |
| post-market 카드(국내·해외) | **우회** — `insertScenarioCardIfAbsent` 직접 INSERT, `side='buy'`·`status='pending'` 고정 | `post-market-engine.ts:214-251`(`:226`), 국내 `:514`, 해외 `post-market-overseas.ts:395`(트랜잭션) |
| custom/confirm (카드 승인·내 시나리오) | **우회** — `approved_pending_entry` 로 직접 INSERT, `strategy_id=NULL`, `scenario_source='user'` | `confirm/route.ts:187-201`, `:279-284` |
| 엔진 스킵 감사 행 | 우회(승인 불가 상태) | `engine.ts:681-708` `'ai_skipped'` |

운영 이력(실측): `orders` 매수 165행 = blocked 83 + rejected 82, **전부 `source='auto'`**, `source='signal'`·`'manual'` 0건, 체결된 매수 0건. `executions` 0행. 00:29 기준 승인 대기·진입 감시(`pending/pending_approval/awaiting_approval/detected/approved_pending_entry`) **0행** — 배포 시점 잔여 행 위험은 현재 0이다(배포 직전 재확인 필요). `executing` 3행(5326·5327·5330)은 5월 26일 **매도**라 관문과 무관.

#### B. 보호 청산(매도) 경로 — 관문이 절대 막으면 안 되는 지점 [확실]

| 매도 경로 | 전략 ID | 지점 |
|---|---|---|
| exit-engine 손절·익절·트레일링(시장가) | `exit-engine-v1`(미등록) | `exit-engine.ts:29`, `:198-205` → `engine.ts:920` → createSignal → S1/S2. 운영 `exit_engine_enabled=false`(실측)라 현재 생성 0 |
| 룰 매도(rsi-overbought-exit 등) | 등록 ID | engine → createSignal → 승인 → S2 |
| analyst/run 매도 | `rsi_momentum_v1`(미등록) | createSignal |
| custom/confirm `direction='sell'` | NULL | → S3 (이력 5건) |
| POST /api/signals·/api/orders 매도 | 선택/없음 | createSignal / S4 |
| 매도 제안 2단계(T-055, 미구현) | `sell-proposal-v1`(미등록) | 현재 `sell-proposal.ts` 는 순수 함수, 주문·시그널 없음 |

- 관문이 걸리는 5지점(createSignal·approveSignal/Hybrid·entry-watcher·custom/confirm·submitOrder) 모두에서 **`side` 판정이 첫 줄**이어야 한다. 매도는 strategies 조회를 **아예 실행하지 않는다**(조회 실패가 매도 실패로 번질 길을 만들지 않기 위해 — submitOrder 의 한도 계산이 "던지지 않음" 불변식을 지키는 것과 같은 이유, `order-limits.ts:150-157`).
- 취소(`orders/[id]` DELETE·`safety/cancel-all`)는 `kis.cancelOrder` 직접이라 submitOrder·관문과 무관(`orders/[id]/route.ts:53`, `cancel-all/route.ts:37`).
- 기존 불변식 시험 `src/lib/safety/__tests__/submit-order-sell-invariant.test.ts` 가 확장 대상.

**전략 귀속 없는 사용자 직접 주문 경로** (L-1 질문):

| 경로 | 화면 호출 | 동작 | 이력 |
|---|---|---|---|
| `POST /api/orders` | 없음 — 주문 탭 `/order` 는 `/strategy` 로 redirect(`order/page.tsx:4`), 화면의 `/api/orders` 호출은 GET·DELETE 뿐 | submitOrder 직행 | `source='manual'` 0건 |
| `POST /api/signals` strategyId 생략 | 없음 | createSignal, `strategy_id` NULL | — |
| `/recommend/build` → custom/confirm, **sourceSignalId 없음** | 있음(`build/page.tsx:94` 주석 "사용자 직접 작성 경로") | `approved_pending_entry` 직행, NULL 전략 | `scenario_source='user'` 매수 4건(05-28~09-03) |
| ScenarioDetail 카드 승인 → custom/confirm, sourceSignalId 있음 | 있음(`ScenarioDetail.tsx:352`) | 원 카드 `approved` + 새 user 행 — **원 카드의 전략 ID 가 새 행에 복사되지 않는다**(`confirm/route.ts:188` 이 null 고정) | — |

두 custom/confirm 경로는 INSERT 뒤에는 구분할 수 없다(sourceSignalId 를 행에 남기지 않음). 따라서 "카드 경유는 막고 직접 작성은 허용" 같은 구분은 **확정 시점(route)에서만** 가능하다.

#### C. 삽입 지점 설계 — 우회 불가 여부

필요한 관문 지점(L-4 의 2곳으로는 부족):

| 지점 | 위치 | 역할 | 막힐 때 동작(제안) |
|---|---|---|---|
| G1 | `service.ts` createSignal — 블랙리스트(`:336-339`) **뒤**, T-058 현금 게이트(`:344`) **앞** | 룰·수동 시그널의 1차 관문 | 승인 불가 감사 행 + 가상 체결 + `errorCode:'validation_gate'` 반환. 승인 요청 알림(`:458-480`)·RAG(`:443-456`)·dup 검사·INSERT 전부 미도달 |
| G2 | `post-market-engine.ts` `insertScenarioCardIfAbsent`(국내·해외 공통 진입점) | 카드 | 승인 불가 상태로 카드 기록 + 가상 체결(카드형) — 또는 기존대로 카드 생성(사용자 결정 I-②) |
| G3 | `confirm/route.ts` — `direction==='buy'` 이면 GET_LOCK(`:223`) 전에 거절 | 카드 승인·내 시나리오 | 행 0, 원 카드 선점 0, 4xx + 한국어 문구 |
| G4 | `service.ts` approveSignal(선점 `:595` 전)·approveSignalHybrid(선점 `:738` 전) | 배포 전 생긴 잔여 대기 행 | 선점·orders 행 없이 `errorCode:'validation_gate'`, 행은 TTL 로 만료 |
| G5 | `entry-watcher/route.ts` — T-051 현금 점검(`:398`)·선점(`:421`) **앞** | 잔여 `approved_pending_entry` 행·2차 방어 | 선점·주문 없음. 행은 종결(제안: 조건부 UPDATE→`superseded` + trade_logs) 또는 만료까지 건너뜀(결정 I-⑦) |
| G6 | `dry-run.ts` submitOrder — orders INSERT(`:128-140`)·킬스위치(`:150-153`) 뒤, 한도 계산(`:163`) 앞, **buy 만** | 최후 방어선 | `markBlocked(orderId,'validation_gate')`(감사 원칙 3: orders·trade_logs 에 남음) |

- **G5 가 필수인 이유** [확실]: submitOrder 가 막으면 entry-watcher 는 확정 거부로 보고 선점을 되돌린다(`entry-watcher/route.ts:544-553`) → 다음 1분 틱에 다시 선점·주문 → 매 분 `orders` blocked 행 + **스로틀 없는** 경고 알림(`dry-run.ts:291-296` `sendAlert`). T-051 이 없앤 "카드당 하루 최대 약 390회" 반복과 같은 실패 모드다(`entry-cash-precheck.ts:6` 주석).
- **G6 의 전략 귀속**: `OrderRequest` 에 전략 ID 가 없다(`types.ts:6-19`). 제안 — `SubmitOptions`(`dry-run.ts:71-75`)에 `attribution?: { kind:'strategy'; strategyId: string|null; signalId: number|null } | { kind:'discretionary' }` 추가, **미지정 = strategy+null 로 취급(fail-closed)**. S1·S2·S3 는 strategy 귀속을 넘기고, S4(`/api/orders`)만 `discretionary` 를 명시한다. `source` 는 클라이언트가 고르는 값(`orders/route.ts:79`)이라 판정 근거로 쓰면 안 된다. 정적 시험으로 `discretionary` 사용처를 `src/app/api/orders/route.ts` 1곳에 고정(소스 파일을 읽어 호출부를 세는 정적 시험 — 같은 방식의 `api-usage-callsites.test.ts` 는 타 세션 미커밋 파일이라 근거로 쓰지 않음)하면 새 호출부가 실수로 관문을 우회하는 길이 막힌다.
- **G1~G6 후 남는 매수 경로**: `discretionary` 귀속(=`POST /api/orders`)뿐이다. 어댑터 직접 호출 0건이므로 [가능성 높음] 코드상 우회 불가. 남는 우회는 "새 호출부가 discretionary 를 붙이는 것"이고 위 정적 시험이 잡는다.
- **배포 시점 잔여 행**: 대기·감시 행은 00:29 기준 0행(A). 배포 사이에 생기면 G4(승인 시도)·G5(감시)·G6(송신)에서 막힌다.
- **T-058 과의 관계**: 자리(블랙리스트 뒤·INSERT 앞)·반환 모양(`ok:false`+errorCode, 알림 없음)은 같게 쓰되 판정 규칙은 정반대여야 한다. 현금 게이트는 "모르면 막지 않는다"(`signal-cash-gate.ts:15-18`), 스위치 키 없음=켜짐·**읽기 오류=꺼짐**(`:22`, `:130-133`), 30초 캐시(`:51`, `:118`). 검증 관문은 모르면 막고, 끄는 스위치를 두지 않거나(권고) 두더라도 읽기 오류=관문 켜짐, 캐시 없음 — 그래서 코드 복제가 아니라 같은 패턴의 별도 모듈이어야 한다.

#### D. 전략 상태 조회 [확실 — 스키마·데이터 실측]

- 조회: `SELECT validation_status FROM strategies WHERE id = ? LIMIT 1`(PK `id varchar(64)`, SHOW CREATE TABLE 실측). 실주문 허용 = `'backtested' | 'paper_validated'`(D5 "backtested 이상", 재구성 결정 문서 `:89`).
- fail-closed 표(매수만): 전략 ID null/빈 문자열 → `null_strategy` · 행 없음 → `unregistered` · 허용 집합 밖 값 → `invalid_status` · 조회 예외(마이그레이션 전 `ER_BAD_FIELD_ERROR` 포함) → `lookup_error` — 전부 차단.
- 캐시: **불필요·비권장**. 매수 시그널 발생량이 하루 15~134건(10-09~10-22 실측, 감사 행 포함)이라 PK 조회 비용은 무시할 수준이고, `router.ts:100` "자금이 오가는 스위치는 캐시하지 않는다" 선례가 있으며, 강등(backtested→unvalidated) 시 캐시 TTL 만큼 fail-open 창이 생긴다.
- `strategies` 16행(실측), `validation_status` 없음. post-market 의 `eod-high-close-v1`·`inside-bar-v1` 는 등록돼 있다.

미등록 ID (실측 건수 · 생산 코드 · 매수 fail-closed 영향):

| ID | side·건수 | 생산 코드 | 영향 |
|---|---|---|---|
| `exit-engine-v1` | 매도 2,800 | `exit-engine.ts:29`, `:202` | 없음(매도) |
| `oversold-bounce-v1` | 매수 36(카드 32 + dup 정리 4) | `post-market-engine.ts:515`·`post-market-overseas.ts:711` `${pattern}-v1`, pattern `'oversold-bounce'`(`rules/oversold-bounce-daily.ts:48`) | 차단. ⚠ strategies 에는 **`oversold-bounce-daily-v1`**(`engine.ts:91`) — ID 가 어긋나 나중에 그 행을 승급해도 카드는 계속 막힌다(지금은 전부 unvalidated 라 영향 0, 승급 전 정리 필요) |
| `rsi_momentum_v1` | 매수 4·매도 3(05-24) | `analyst/run/route.ts:48`(수동 전용) | 매수 차단, 매도 무영향 |
| NULL | 매수 4·매도 5, 전부 `scenario_source='user'` | `confirm/route.ts:188` | 매수 차단(D-1 과 일치), 매도 무영향 |

#### E. 실 장부 테이블을 읽는 코드 — 별도 테이블 vs `simulated` 컬럼 [확실]

| 테이블 | 읽는 곳 | `orders`/`executions` 에 가상 행을 넣으면 |
|---|---|---|
| orders | `order-limits.ts:236-243` 일일 한도 — 매수·`status NOT IN (rejected,failed,blocked,cancelled,pending)` 합산(**dry_run 포함**) | 일일 한도 잠식 |
| orders | `approval-context.ts:102-104` 같은 합산(승인 메시지) | 표시 오염 |
| orders | `portfolio-stability.ts:104-107` 24h 종목당 매수 횟수(filled/accepted/partial) | 종목 한도 오발동 |
| orders | `asset-profile.ts:60-62` filled/partial/dry_run 1건 = "배관 검증됨" | 가짜 검증 |
| orders·executions | `order-sync.ts:404-406`(동기화 대상)·`:1050-1052`·`:1271`·`:1293-1294`·`:1348`(executions INSERT, T-071 장부) | 장부 판정 대상 혼입 |
| orders·executions | `trade-report.ts:279-283`(filled ⋈ executions = 체결 손익), `:1059` | 손익 리포트 오염 |
| orders | `orders/route.ts:105-114` GET(주문 내역 화면 3곳), `orders/[id]/route.ts:13-18`·`:41-59`(상세·취소), `cancel-all/route.ts:28-29`(KIS 취소 대상) | 화면·취소 대상 혼입 |
| orders | `signals/route.ts:157`(withOrder), `scripts/profit-engine/holdings-report.mjs:103-106`, `postmortem-core.js:755-756` | 분석 오염 |
| executions | 스키마: `order_id NOT NULL` + FK `fk_exec_order → orders(id)`(실측) | 가상 체결 1행마다 **가짜 orders 행이 필수** |
| portfolio_snapshots | `kill-switch.ts`·`volatility-guard.ts`·`trade-report.ts`·`risk/policy-store.ts`·analytics — KIS 잔고에서만 생성(`cron/portfolio-snapshot`) | 가상 경로가 쓰지 않으면 무영향 |
| position_state | 엔진 upsert(실보유), **entry-watcher `setPositionScenarioExit`**(`entry-watcher/route.ts:507`, `ok || dryRun` 분기), stop-alert·holding-checker 가 읽음 | 가상 경로는 이 함수를 부르면 안 된다 |
| holdings / order_sync_stale_tracking | `balances/route.ts` / `order-sync-escalation.ts` 만 | 무관 |

결론: 별도 `paper_fills` 는 위 소비자 전부가 **구조적으로** 오염되지 않는다(기본값이 격리). `executions(simulated=1)` 방식(D6, 재구성 결정 문서 `:90` — 원래 DRY_RUN 체결 대상이라 D-2 와 대상도 다르다)은 15곳 이상 + 앞으로 생길 모든 소비자에 `simulated=0` 필터를 강제해야 하고(기본값이 오염), 가짜 orders 행·`orders.status` 처리까지 필요하다. L-3 확정.

제안 스키마 (`paper_fills`):

```sql
CREATE TABLE IF NOT EXISTS paper_fills (
  id                BIGINT        NOT NULL AUTO_INCREMENT,
  signal_id         BIGINT        NOT NULL,        -- 원 시그널(승인 불가 감사 행·카드 행) id — 멱등 키
  strategy_id       VARCHAR(64)   NULL,            -- 귀속 전략, NULL = 귀속 없음
  gate_reason       VARCHAR(32)   NOT NULL,        -- unvalidated|unregistered|null_strategy|invalid_status|lookup_error
  origin            VARCHAR(16)   NOT NULL,        -- engine|post_market|api_signals|analyst_run
  market            ENUM('domestic','overseas') NOT NULL,
  symbol            VARCHAR(32)   NOT NULL,
  side              ENUM('buy','sell') NOT NULL DEFAULT 'buy',   -- 이번 범위는 buy 만(L-6)
  order_type        ENUM('limit','market') NOT NULL,
  currency          CHAR(3)       NOT NULL,        -- 지정가 통화 KRW|USD
  limit_price       DECIMAL(36,8) NULL,            -- 현지 통화 지정가(해외 = 어댑터와 같은 USD 단가). 모르면 NULL
  limit_price_krw   DECIMAL(36,8) NULL,            -- 시그널 원값(원화·해외는 환산값, 호가 추격 반영)
  fx_usdkrw         DECIMAL(18,6) NULL,            -- 해외 환산 환율(fx_rates 1시간 이내만), 국내 NULL
  zone_lo           DECIMAL(36,8) NULL,            -- 구간 진입형(카드) — 현지 통화
  zone_hi           DECIMAL(36,8) NULL,
  quantity          DECIMAL(36,18) NULL,           -- sizeOrderQuantity 결과(정수 주)
  amount_krw        DECIMAL(18,2) NOT NULL,        -- 의도 금액(시그널 amount_krw, 재계산 안 함 — service.ts:250-253 와 같음)
  fee_rate_pct      DECIMAL(8,5)  NOT NULL,        -- 진입 편도 수수료율 %
  fee_est_krw       DECIMAL(18,2) NULL,
  fill_model        VARCHAR(32)   NOT NULL,        -- signal_limit_immediate | zone_touch_pending
  valid_from        DATETIME      NULL,            -- KST (카드)
  valid_until       DATETIME      NULL,            -- KST (시그널 expires_at)
  signal_created_at DATETIME      NOT NULL,        -- KST
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_paper_fills_signal (signal_id),
  KEY idx_pf_strategy (strategy_id, signal_created_at),
  KEY idx_pf_symbol (symbol, signal_created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- 멱등: `UNIQUE(signal_id)` + `INSERT IGNORE`(또는 ON DUPLICATE KEY no-op). FK 는 두지 않는 쪽을 권고 [가능성 높음] — signals 는 쓰기가 잦은 테이블이고, 감사 행은 유일한 삭제 경로(`signals/[id]/route.ts:57`, `approved_pending_entry` 만)에 걸리지 않는다.
- **통화**: 현지 통화 원값을 저장한다. 근거 — `daily_bars` 가 현지 통화(미국 USD) 원값만 저장하고(`T-070-daily-bars.sql:13-14`), T-070 사후검증은 시그널의 원화 가격에서 USD 를 **역산**해야 했다(스냅샷 환율 → 같은 날 중앙값 → 자기 비율 순의 약한 폴백, `postmortem-core.js:11`, `:296-310`). USD 단가는 `overseasLimitUnitUsd(krw, fx)`(`signal-cash-gate.ts:192-198`, 송신 본문 대조 시험 존재)로 어댑터와 똑같이 만들고, 환율은 `fx_rates` DB 행만 1시간 이내일 때 쓴다(외부 조회 없이 — 00:29 실측 `USD_KRW 1324.63 @ 00:27:31`, 해외 시세 조회가 5분마다 갱신). 모르면 USD NULL·환율 NULL 로 기록은 남긴다.
- **수수료**: 해외 편도 0.25%(확정). 국내는 코드에 진입 편도 상수가 없다 — `style.ts:115` `feePct 0.18`은 매도 제세금 0.15% 를 포함한 **왕복**값, `db.ts:603-607` `backtest_fee_pct 0.09` 가 "왕복 절반" 편도 관례, 실제 매수 위탁수수료 약 0.014% 는 주석(`style.ts:55`)에만 있다 → 어느 값을 쓸지 analyst 결정(I-④). 쓴 율을 `fee_rate_pct` 로 행마다 남긴다.
- **중복 방지** [확실 — 실측]: 10-22 15:04~15:29 `003550` 이 약 6분마다 `ai_skipped` 로 다시 기록됐다(id 19318·19324·19329·19333·19337). 엔진은 시그널 생성 **성공 시에만** 진입 쿨다운(120분, `cooldowns.ts:30`)을 건다(`engine.ts:1433-1440`). 관문으로 막힌 매수에도 같은 쿨다운을 걸어야 실 경로(생성 → 쿨다운)와 같은 빈도로 가상 체결이 쌓인다. 안 걸면 2시간에 최대 약 20배 중복이다 [추측: 조건 지속 시간에 따라 다름].
- **fill_model**: 룰 시그널 = `signal_limit_immediate`(승인 지연·30분 TTL 을 무시한 낙관 가정 — 30일 실측 매수 1,026건이 승인 없이 만료됐으므로 "전부 즉시 승인했다면"을 뜻한다). 카드 = `zone_touch_pending`(체결 여부는 T-070/T-064 가 valid_from~valid_until 의 일봉 고저와 구간으로 판정).

#### F. 막힌 시그널의 `signals` 기록 [확실]

- **승인 불가 확인**: `ai_skipped`·`skipped` 둘 다 어떤 주문 경로에도 들어가지 않는다 — approveSignal/Hybrid 는 `isAwaitingApproval`(`service.ts:554`, `:704`), custom/confirm 원 카드 선점은 대기 상태+`detected` 만(`confirm/route.ts:243`), entry-watcher 는 `approved_pending_entry` 만(`:208-215`) 본다. ENUM 변경 불필요(L-8).
- **`insertSkipAuditPool` 그대로 재사용은 불가**: 엔진 내부 함수(export 아님), `'ai_skipped'` 고정, `price` 를 비운다(`engine.ts:690-691` — 30일 실측 ai_skipped 매수 248건 전부 price NULL). T-070 사후검증은 매수 시그널을 **상태 무관**하게 읽고 `price` 를 쓴다(`postmortem-core.js:748-751`) → 새 감사 행은 `price`(+`price_at_skip`)를 반드시 채워야 한다. signals 쪽에 새 헬퍼를 두는 것이 맞다.
- **사후 가격 백필**: `cron/signal-followup` 15분 주기, `status='ai_skipped' AND price_at_skip IS NOT NULL` 만, 창당 50행(`signal-followup/route.ts:119-126`), 24h 라벨 시 KB(RAG) 재색인. `skipped` 는 대상이 아니다.
- 상태 선택지:

| | `ai_skipped` + `skipCategory:'validation_gate'` | `skipped` + `indicators.gate:'validation_gate'` |
|---|---|---|
| 1h/4h/24h 백필 | 자동 | 없음(평가는 일봉 기반이라 필수 아님) |
| 기존 소비자 영향 | 섞인다: signal-quality 분석(`analytics/signal-quality/route.ts:73-91`·`:171`), `/api/signals/missed`(`:55`), SkippedSignalLog 화면(`SkippedSignalLog.tsx:36`), 추천 배너 분모(`recommend/page.tsx:55-60`), trade-report 관심 종목(`:941`), RAG 백필(`admin/rag/backfill/route.ts:84`), 학습셋(`export-llm-trainset.sh:118`, `build_trainset_jsonl.py:141` — "스킵" 라벨로 학습) | 없음 — HEAD 에서 `skipped` 를 읽는 코드 0(`SKIP_AUDIT_STATUSES` 미사용, 쓰는 곳은 T-020 `service.ts:499` 뿐) |
| T-070 사후검증 | 포함 | 포함 |
| 새 카테고리 화면 처리 | `SignalDiagnosticsTab.tsx:54`·`:190` 이 미지 카테고리를 '기타'로 폴백 — 깨지지 않음 | 해당 없음 |

  권고 [가능성 높음]: **`skipped`**. 기존 9개 소비자의 의미를 바꾸지 않고, 검증 데이터의 정본은 `paper_fills`+일봉이기 때문이다. 화면에서 보이게 하거나 백필 라벨이 필요하면 `ai_skipped` 로 가되 학습셋 스크립트 2개에서 제외해야 한다(I-⑥).
- 카드(G2)를 막는 경우 같은 상태로 넣으면 T-045 `NOT EXISTS`(상태 무관)·T-048 유니크 인덱스가 그대로 중복을 막는다(`post-market-engine.ts:226-231`). 단 대시보드 카드 영역(`Dashboard.tsx:215`, `status=pending`)·추천 목록(`recommend/page.tsx:45`)에서 사라진다(I-②).

#### G. eval_funnel / trade_logs [확실]

- `FUNNEL_GATES` 끝(`insufficient_cash` 뒤, `eval-funnel-labels.ts:142`)에 `validation_gate` append — 리네임 금지·append 규칙(`:7-8`). `GATE_STAGE`·`GATE_LABEL_KO` 가 `Record<FunnelGate,…>` 라 셋을 함께 채우지 않으면 컴파일이 깨진다. stage **11**(createSignal 게이트, `insufficient_cash` 와 같은 성격), verdict `skip`. 조회 실패(`lookup_error`)는 막되 인프라 이상이므로 별도 게이트 `validation_lookup_error`(stage 11, verdict `error`)로 나누면 정기 리포트 "이상" 절에 올라간다 — 권고.
- 엔진 경로: `createSignalGuarded` 의 errorCode→gate 매핑(`engine.ts:240-249`)에 추가, `outcome.kill(symbol, 11, gate)`(`:257`) — `FUNNEL_STEPS` 의 "안전게이트 통과" minStage 11(`:331`)과 일관. reason(varchar 64) = 위 gate_reason, detail = `{strategyId, status, signalId, paperFillId}`.
- 엔진 밖 경로(approve·텔레그램·entry-watcher·confirm·post-market)는 기록기가 없다 → `trade_logs` 이벤트 `signal_validation_gate`(22자, varchar(32)·STRICT — 33자면 조용히 유실, `service.ts:116-123`) payload `{where, signalId, strategyId, symbol, side, reason}`. submitOrder(G6)는 기존 `markBlocked` 그대로 → `orders.blocked_by='validation_gate'`(16자, varchar(32)) + trade_logs `blocked`. `OrderResult.blockedBy` 유니온(`types.ts:24`)에 값 추가 필요.
- 호출부 응답 분류: `POST /api/signals` 는 `insufficient_cash` 만 200 skipped 로 특별 취급(`signals/route.ts:85`), analyst/run 은 그 외 `ok:false` 를 `created` 에 넣는다(`analyst/run/route.ts:65`, 기존 시험이 고정) → 둘 다 `validation_gate` 를 skipped 로 분류해야 한다. 텔레그램 `mapFailure`(`telegram-approval.ts:109-123`)는 미지 코드를 원문으로 보여 준다 → 한국어 문구 추가.

#### H. 마이그레이션 설계 [확실 — 관례·버전 실측]

- 관례: T-059·T-070 은 `scripts/migrations/*.sql` 로 두고 **setupDB 에 넣지 않았다** — "개발·운영이 같은 NAS MariaDB 라서 배포만으로 DDL 이 돌면 `--with-migrate` 사용자 승인 원칙이 무력화"(`T-070-daily-bars.sql:6-9`). T-048 은 드라이런 기본·`--apply`·`--rollback`·사전 점검(버전·권한·30초 넘는 트랜잭션·장외)·`SHOW CREATE TABLE` 백업·`lock_wait_timeout`·`ALGORITHM=INPLACE, LOCK=NONE` 를 갖춘 node 스크립트였다(타 세션 scratchpad `migrate-t048.js`, 저장소 밖). 자동 권한 분류기가 Leader 실행을 거부해 사용자가 직접 실행한 선례(T-048 `:108-110`).
- `db.ts` setupDB 는 부팅마다 `CREATE TABLE IF NOT EXISTS` + `ALTER … .catch(무시)` 를 돈다(`db.ts:278-310`). **T-072 DDL 은 여기에 넣지 않는다**(넣으면 배포 = DDL). 둘 다 필요하지 않다 — SQL 파일 하나(+선택적으로 T-048 형 실행기).
- 제안 SQL(`scripts/migrations/T-072-validation-gate.sql`):

```sql
SET SESSION lock_wait_timeout = 5;
ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS validation_status ENUM('unvalidated','backtested','paper_validated')
      NOT NULL DEFAULT 'unvalidated' AFTER enabled,
  ADD COLUMN IF NOT EXISTS validation_changed_at DATETIME NULL AFTER validation_status,   -- 선택: 승급 감사
  ADD COLUMN IF NOT EXISTS validation_evidence VARCHAR(255) NULL AFTER validation_changed_at; -- 선택: 증거 링크(T-064·T-070 결과)
-- + 위 E 절의 CREATE TABLE IF NOT EXISTS paper_fills (...)
-- 검증: SELECT id, validation_status FROM strategies;  → 16행 전부 'unvalidated'
-- 되돌리기(데이터 삭제 — 사용자 승인 사항): ALTER TABLE strategies DROP COLUMN IF EXISTS validation_evidence,
--   DROP COLUMN IF EXISTS validation_changed_at, DROP COLUMN IF EXISTS validation_status; DROP TABLE IF EXISTS paper_fills;
```

  운영 DB `10.11.11-MariaDB-log`, `sql_mode` 에 `STRICT_TRANS_TABLES`(실측) — `ADD COLUMN IF NOT EXISTS` 지원, strategies 16행이라 즉시 끝난다. 두 번 실행해도 안전(멱등).
- 호환(양방향 무해): 구 코드 + 새 컬럼 → 읽는 코드 없음(`/api/strategies` GET 은 필드를 명시 매핑 — `strategies/route.ts:23-38`, 시드는 열 목록 명시 `INSERT IGNORE` — `db.ts:501-505` 라 DEFAULT 로 채워짐). 새 코드 + 컬럼 없음 → 조회 오류 → fail-closed 차단(의도와 같음). 새 코드 + 테이블 없음 → 가상 체결 INSERT 실패 → **삼키고 차단 유지**해야 한다(시험 대상). 그래서 L-7 순서는 안전이 아니라 **데이터 완전성** 때문이다.
- 롤백: 코드 revert 는 관문 코드를 없애므로 **신규 매수를 다시 연다**(운영 `safety_dry_run=false`·`autopilot_mode=assist`·킬스위치 off 실측). 롤백 시 매수를 계속 막아야 하면 킬스위치/DRY_RUN 판단을 함께 해야 한다. 컬럼·테이블 존치는 무해.
- 승급 경로: `PATCH /api/strategies/[id]` 허용 필드는 enabled·backtest_interval_h·description·tags 뿐(`strategies/[id]/route.ts:11-17`) — `validation_status` 를 넣지 않는다(코드가 임의 승급 금지, 범위 3). 승급은 증거 확인 후 사용자 승인 SQL. ⚠ `src/app/api/strategies/`·`scripts/migrations/`·`src/lib/db.ts` 는 SAFETY_PATHS 밖이다 — 누가 PATCH 에 필드를 추가해도 커밋 훅이 감사를 요구하지 않는다 → `'^src/app/api/strategies/'` 추가를 권고(I-⑧).

#### I. 시험 계획 · 변이 · 위험 · 파일

반드시 증명할 시험:
1. **매도 무영향**: createSignal(전략 null·미등록·`exit-engine-v1`·조회가 던지는 경우)·approveSignal·entry-watcher·custom/confirm·submitOrder(attribution 없음) 매도가 기존대로 진행 — 그리고 **strategies 조회가 한 번도 실행되지 않음**을 단언. `submit-order-sell-invariant.test.ts` 확장.
2. **모든 매수 경로 차단**: G1(assist·auto 모드·`exit_kind:'hard_stop'` 위장 매수 — `router.ts:253-282` 강제 auto 를 G1 이 앞에서 막는지), G2(국내·해외 — 승인 가능 카드 0), G3(sourceSignalId 있음/없음 — INSERT 0·원 카드 선점 0), G4(웹·텔레그램 — 선점 0·orders 0), G5(선점 0·submitOrder 0·orders 0·`setPositionScenarioExit` 0), G6(직접 호출 — `realSubmit` 0회, `orders.status='blocked'`, `blocked_by='validation_gate'`).
3. **fail-closed 행렬**: null·''·미등록·`unvalidated`·이상값·조회 예외·`ER_BAD_FIELD_ERROR` → 차단 / `backtested`·`paper_validated` → 기존 경로(현금 게이트 등)로 진행.
4. **discretionary**: `POST /api/orders` 매수는 관문에 안 걸리고 킬스위치·한도는 그대로. 정적 시험: `discretionary` 사용처 = `src/app/api/orders/route.ts` 1곳.
5. **가상 체결 멱등·실패 격리**: 같은 signal_id 두 번 → 1행. 엔진 연속 2틱 같은 (종목·전략) → 감사 행 1·가상 체결 1(쿨다운). 가상 체결 INSERT 실패·테이블 없음 → 차단 유지, 던지지 않음, 런 계속.
6. **실 장부 불변**: 차단 경로에서 `orders`·`executions`·`position_state`·`portfolio_snapshots`·`holdings` 에 쓰는 SQL 0, `submitOrder`·승인 요청 알림·RAG upsert 0(목 pool 의 SQL 단언).
7. **해외 단가 대조**: 가상 체결 USD 단가 = 같은 원화·환율의 `overseasLimitUnitUsd`; 환율 1시간 초과 → USD NULL.
8. eval_funnel 매핑(gate·stage 11·verdict), trade_logs 이벤트 이름 ≤ 32자.
9. `PATCH /api/strategies/[id]` 에 `validation_status` 만 보내면 400·값 불변.
10. DDL: 일회용 MariaDB(T-048 선례 — 127.0.0.1 전용 컨테이너)에서 2회 적용 멱등·기존 행 unvalidated·UNIQUE 중복 거부·되돌리기.

변이 후보(각각 위 시험이 잡아야 함): side 가드 제거 · 허용 집합에 `unvalidated` 추가 · 조회 예외를 허용으로 · null ID 허용 · G5 호출 삭제 · G6 호출 삭제 · UNIQUE/IGNORE 제거 · 관문 차단 시 쿨다운 제거 · 감사 행 상태를 `awaiting_approval` 로 · `discretionary` 를 다른 호출부에 추가.

남는 위험·미확인:
- 미확인: jest 미실행(금지) — 위 시험 설계는 기존 시험 구조(`service-cash-gate.test.ts` 목 패턴)를 읽고 세운 것. 텔레그램 메시지 렌더링·SkippedSignalLog 화면 실제 표시는 보지 않았다. `kill-switch.ts` 는 grep 으로 portfolio_snapshots 읽기만 확인.
- 카드 경유 확정 시 원 전략 귀속이 사라지는 기존 결함(B) — 나중에 전략을 승급해도 카드 경유 사용자 확정 매수는 NULL 이라 계속 막힌다. 풀려면 confirm 이 원 카드의 strategy_id 를 복사해야 한다(동작 변경 — 별도 결정).
- G6 가 실제로 발동하면 `markBlocked` 의 경고 알림이 스로틀 없이 나간다(`dry-run.ts:291-296`) — G5 가 있으면 평소 0건이어야 하므로 "발동 = 우회 버그" 경보로 두는 것을 권고 [가능성 높음].
- D5 원문은 "DRY_RUN=false 실주문"만 대상으로 한다(재구성 결정 `:89`). D-1 "전부 차단"을 DRY_RUN 과 무관하게 적용할지 확인 필요(I-③). 권고: 무관하게 적용(판정이 단순하고 `isDryRun` 오판에 기대지 않음).

예상 파일과 SAFETY_PATHS(`awk '/^SAFETY_PATHS=\(/,/^\)/' scripts/git-hooks/commit-msg` 실측):

| 파일 | 변경 | SAFETY_PATHS |
|---|---|---|
| `src/lib/safety/validation-gate.ts` (조회·판정) | 신규 | 해당 (`^src/lib/safety/`) |
| `src/lib/signals/paper-fill.ts` (감사 행·가상 체결 기록) | 신규 | 해당 |
| `src/lib/safety/dry-run.ts` (G6·attribution) | 수정 | 해당 |
| `src/lib/exchanges/types.ts` (`blockedBy`) | 수정 | 해당 |
| `src/lib/signals/service.ts` (G1·G4·errorCode) | 수정 | 해당 |
| `src/lib/signals/telegram-approval.ts` (문구) | 수정 | 해당 |
| `src/lib/strategy/engine.ts` (매핑·쿨다운) · `eval-funnel-labels.ts` (append) | 수정 | 해당 |
| `src/lib/strategy/post-market-engine.ts` (G2, 해외는 같은 함수 경유) | 수정 | 해당 |
| `src/app/api/cron/entry-watcher/route.ts` (G5) | 수정 | 해당 |
| `src/app/api/signals/custom/confirm/route.ts` (G3) · `src/app/api/signals/route.ts` · `src/app/api/analyst/run/route.ts` · `src/app/api/orders/route.ts` | 수정 | 해당 |
| 각 `__tests__` (시험 파일도 SAFETY_PATHS 대상) | 신규·수정 | 해당 |
| `scripts/migrations/T-072-validation-gate.sql` | 신규 | **해당 없음** |
| `src/lib/db.ts` | 변경하지 않음 권고 | 해당 없음 |
| `src/app/api/strategies/[id]/route.ts` | 변경하지 않음(시험만) | 해당 없음 — 추가 권고 |

사용자·Leader 결정 후보:
- ① `/recommend/build` 직접 작성 시나리오(원 카드 없음, 전략 귀속 없음) 매수 — 막는가(D-1 "직접 확정 시나리오") / L-1 예외로 두는가. 막으면 앱 화면에서 신규 매수 수단이 **0**이 되고 남는 길은 curl 로 부르는 `POST /api/orders` 뿐이다.
- ② post-market 카드 — 승인 불가 기록(화면 카드 영역에서 사라짐, 가상 체결만) / 기존처럼 카드는 보이고 승인 시 거절. 전자 권고(승인 불가 시그널을 만들지 않는다는 L-4 취지, 사용자 선택에 따른 표본 편향 없음). 화면에 "검증 전" 표시를 넣으려면 designer·데모 재접수.
- ③ DRY_RUN=true 일 때도 관문 적용 여부.
- ④ 국내 진입 수수료율(0.09% 백테스트 관례 / 0.014% 실매수 위탁수수료).
- ⑤ `oversold-bounce-v1` ↔ `oversold-bounce-daily-v1` 정리 방식(strategies 행 추가 / 생성 ID 변경) — 승급 전까지.
- ⑥ 감사 행 상태 `skipped`(권고) / `ai_skipped`.
- ⑦ entry-watcher 잔여 행: 즉시 종결(`superseded`+trade_logs, 권고 — "내 결정" 탭에 안 섞임, `MyDecisionTab.tsx:147`) / 만료까지 건너뜀.
- ⑧ SAFETY_PATHS 에 `^src/app/api/strategies/`(·`^scripts/migrations/`) 추가.

### Stage 1 — WP-2a 구현 (2026-10-23 01:19, developer opus)

- [01:19] 범위: G1(createSignal)·G6(submitOrder + 송신 직전 재검증)·판정 모듈·가상 체결 기록·`claimCooldown`·funnel 게이트·마이그레이션 SQL·PATCH 시험. **WP-2b(G2~G5·응답 분류·텔레그램 문구·호출부 attribution 전달·정적 시험)는 손대지 않았다.** git 쓰기 0, 운영/공용 DB 쓰기 0, 배포·pm2·KIS·외부 호출 0. 화면 파일 0(데모 게이트 해당 없음).
- [01:19] 근거 기준 HEAD `1163fe2`. 수정한 파일은 전부 작업 트리에서 `git diff HEAD` 0 이던 경로다(시작 시 확인). 타 세션 `M` 경로(`ai-filter.ts`·`market-context-client.ts`·`llm/*`·`notify/*` 등)는 열지도 근거로 쓰지도 않았다.

#### 1. 변경 파일
| 파일 | 변경 | 요지 |
|---|---|---|
| `src/lib/safety/validation-gate.ts` | 신규 | `evaluateValidationGate({side, strategyId})` — 첫 줄 `side !== 'buy'` → I/O 0 허용(`:65`). 매수는 `SELECT validation_status FROM strategies WHERE id = ? LIMIT 1` 매번(캐시·스위치 없음). 허용 = backtested·paper_validated 뿐, 나머지 `null_strategy`/`unregistered`/`unvalidated`/`invalid_status`/`lookup_error` 차단. 던지지 않음(`getPool` 실패 포함) |
| `src/lib/safety/dry-run.ts` | 수정 | `OrderAttribution`·`SubmitOptions.attribution`(미지정 = `{strategy, null}` → 매수 차단, `:85`). G6 = 변동성 뒤·`isDryRun` 앞(`:220-229`), `realSubmit` 직전 재검증(`:239-245`). 차단 = `markBlocked(orderId,'validation_gate', 사유·signal·phase)` → orders `blocked`/`blocked_by='validation_gate'` + trade_logs `blocked` + 경고 알림(F-12, 스로틀 없음 그대로) |
| `src/lib/exchanges/types.ts` | 수정 | `OrderResult.blockedBy` 에 `'validation_gate'` |
| `src/lib/signals/paper-fill.ts` | 신규 | `insertValidationAuditSignal`(signals `skipped` + `indicators.gate='validation_gate'`, `price`·`price_at_skip` = 시그널 가격) · `insertPaperFill`(`INSERT IGNORE`, 해외 USD 단가 = `overseasLimitUnitUsd` import, 환율 = `fx_rates` 1시간 이내만 `judgeFxRow` import — 외부 조회 없음, 수수료율 해외 0.25·국내 0.014 행마다) · `recordValidationBlockedBuy`. 모든 DB 오류 삼킴. 실 장부 테이블 SQL 0. 순환 의존 없음(`paper-fill → signal-cash-gate`, 역방향 없음) |
| `src/lib/signals/service.ts` | 수정 | `createSignal(input, cfg?, opts?: CreateSignalOptions)` — G1 = 블랙리스트 뒤·T-058 앞(`:466`), 차단 시 `finishValidationBlock`(`:381`)으로 끝: 승인 가능 INSERT·알림·RAG·중복 검사·현금 게이트·routeSignal 미도달. `errorCode` 유니온에 `validation_gate`·`validation_lookup_error`, 결과에 `validation?: {reason, strategyId, status, auditSignalId, paperFillId, recorded, claim}` |
| `src/lib/strategy/cooldowns.ts` | 수정 | `claimCooldown(key, ttl, reason?)` — `INSERT IGNORE`(1 = inserted) → `UPDATE … AND until <= NOW()`(1 = reclaimed) → 아니면 active, 오류 = error(던지지 않음). ODKU 미사용. `setCooldown` 불변 |
| `src/lib/strategy/engine.ts` | 수정 | `createSignalGuarded` 가 `createSignal(input, undefined, {origin:'engine', claimEntryCooldown:true})`(`:237`). 매핑 `validation_gate`(skip)·`validation_lookup_error`(error), reason = 관문 사유, detail = `{strategyId,status,signalId(감사 행),paperFillId,recorded,claim}`. validation_gate 는 경고 생략(T-058 과 같은 이유), lookup_error 는 경고 |
| `src/lib/strategy/eval-funnel-labels.ts` | 수정 | `FUNNEL_GATES` 끝에 `validation_gate`·`validation_lookup_error` append, `GATE_STAGE` 11·`GATE_LABEL_KO` 동시 |
| `scripts/migrations/T-072-validation-gate.sql` | 신규 | `strategies` 3열(`ADD COLUMN IF NOT EXISTS`) + `paper_fills`(`CREATE TABLE IF NOT EXISTS`, `UNIQUE(signal_id)`), `lock_wait_timeout=5`, 롤백 주석. setupDB 미포함 |
| 시험 신규 6 | 신규 | `safety/__tests__/validation-gate.test.ts` · `safety/__tests__/submit-order-validation-gate.test.ts` · `signals/__tests__/paper-fill.test.ts` · `signals/__tests__/service-validation-gate.test.ts` · `signals/__tests__/t072-disposable-mariadb.test.ts`(env 게이트) · `strategy/__tests__/engine-validation-gate.test.ts` · `app/api/strategies/[id]/__tests__/route.test.ts`(코드 무변경, F-10 고정) |
| 시험 수정 7 | 수정 | `submit-order-sell-invariant`(확장: 매도에서 strategies 조회 0 단언 — 조회는 실행되면 `ER_BAD_FIELD_ERROR` 를 던지게 목) · `cooldowns`(claimCooldown) · `submit-order`·`service`·`service-cash-gate`·`order-sizing`(검증된 전략 fixture) · `engine-insufficient-cash`(append 순서 단언) |

#### 2. 설계 대비 차이와 사유 (임의 변경 아님 — 판단 근거)
1. **G1 차단 시 `signalId: 0`**(감사 행 id 는 `validation.auditSignalId`). 0 = "승인 가능한 시그널 없음"이라는 T-058 관례와 같게. `CreateSignalResult.validation`·`CreateSignalOptions` 는 새 선택 필드/인자(기존 호출 무영향).
2. **`fill_model` 에 `signal_market_immediate` 추가**(설계는 2값). 룰 매수는 전부 지정가(`rules/*.ts` grep)라 엔진에선 안 생기고, 시장가 매수는 API 경로뿐 — 지정가 라벨을 붙이면 거짓이 된다.
3. **`origin` 기본값 `unspecified`**: `POST /api/signals`·`analyst/run` 은 WP-2b 전까지 origin 을 넘기지 않는다.
4. **`paper_fills` 에 `COLLATE=utf8mb4_general_ci` 명시**: 운영 테이블 전부 general_ci(실측). MariaDB 11 기본 콜레이션이 달라 일회용 DB 와 운영을 맞추려고. 그 외 열은 Stage 0 E 절 그대로(주석만 갱신).
5. **side 가드는 판정 모듈 한 곳**(`validation-gate.ts:65`). dry-run·service 는 관문을 무조건 부르고 관문이 매도에 I/O 0 으로 답한다(동작은 "buy 만 판정"과 같다). 가드가 두 곳이면 하나를 지우는 변이가 등가 변이가 되어 시험으로 못 잡는다.
6. **쿨다운 선점은 createSignal 안**(엔진은 플래그만 넘김). 선점이 기록보다 먼저여야 하고, 막혔다는 사실은 createSignal 만 안다. 선점 = 진입 쿨다운 설정이라 엔진 루프(`engine.ts:1446-1455`, 성공 시에만 `setCooldown`)에 추가 호출은 넣지 않았다.
7. 감사 행 `expires_at` = 막히지 않았다면 받았을 값(`routeSignal(...).expiresAt`, 순수 함수). 감사 행 `price` = 시그널 원 가격(일반 INSERT 와 같음), 가상 체결 = 실제 주문과 같은 사이징(호가 추격·정수 수량, `buildOrderRequest`).
8. ⚠ **WP-2a 단독 상태의 과차단**: 호출부(`service.ts:507·602`·entry-watcher·`orders/route.ts`)가 아직 attribution 을 넘기지 않으므로 **submitOrder 를 거치는 모든 매수가 G6 에서 `null_strategy` 로 막힌다**(검증된 전략이어도). 지금은 전 전략 unvalidated 라 실효 차이 0, fail-closed 방향. 그래서 `order-sizing.test.ts` 의 승인 시험("1주 이상이면 정상 승인") 기대를 **F-1 기준으로 바꿨다**: 사이징 단언(4주가 submitOrder 까지 감)은 그대로 두고, 결과는 `order_not_accepted`·`validation_gate`·`approved` 기록 없음. WP-2b 에서 귀속 전달 후 "검증된 전략 + 귀속 → 승인 성공" 양성 시험을 되살려야 한다.
9. 기존 시험 4개(`service`·`service-cash-gate`·`order-sizing`·`submit-order`)에 **검증된 전략 fixture**(목 strategies 행 backtested + 입력/attribution 에 그 ID)를 넣었다. 넣지 않으면 G1/G6 에 먼저 막혀 실패하거나, 일부(예: `submit-order` 의 "KIS 명시적 거부", "매수 스킵 알림 없음")는 **엉뚱한 이유로 통과**(공허한 통과)한다. 기대값은 바꾸지 않았다.

#### 3. 호출 경로별 중복 기록 방지
| 경로 | 방식 | 결과 |
|---|---|---|
| 장중 엔진(`createSignalGuarded`) | 기록 **전** `claimCooldown({entry, symbol, strategy, buy}, 120, 'validation_gate')`. 이긴 호출만 감사 행·가상 체결. 진 호출(active)·DB 오류(error)는 기록만 생략, 차단 유지 | 연속 2틱·동시 3회 → 감사 행 1·가상 체결 1(시험). 선점이 곧 진입 쿨다운 → 다음 틱 스냅샷이 `cooldown_entry`(stage 5)로 거른다 → 실 경로(생성 → 120분)와 같은 빈도. 만료 후 reclaimed 로 다시 1건 |
| `POST /api/signals`·`analyst/run`(사람이 부름) | 선점 없음 — 호출마다 감사 행 1·가상 체결 1 | 같은 요청을 반복하면 반복 수만큼 쌓인다(수동 호출이라 의도로 본다). WP-2b 가 origin 을 붙인다 |
| 같은 감사 행 id 재기록 | `paper_fills UNIQUE(signal_id)` + `INSERT IGNORE` | 1행(단위·실 DB 시험) |
| G6(submitOrder) | 기록 없음 — `orders` blocked 행이 감사(감사 원칙 3) | — |

#### 4. 검증 수치 (격리 사본 `scratchpad/t072-iso-2a` = `git archive HEAD` + 내 파일만, node_modules 링크)
- 기준선(내 변경 전): tsc 0 오류 · jest 210 스위트 5,044/5,044 통과.
- 변경 후: **tsc 0 오류** · **jest 216 스위트 통과 + 1 건너뜀(DB 시험, env 없음) — 5,181 통과 / 14 건너뜀 / 5,195**. 일회용 DB env 를 주면 **217/217 스위트 · 5,195/5,195 통과**.
- eslint: 실행 못 함 — 저장소에 ESLint 설정이 없어 `next lint` 가 설정 마법사를 띄운다(격리 사본·작업 트리에 설정 파일 생성 안 됨 확인).
- 작업 트리 jest/tsc 는 돌리지 않았다(타 세션 변경으로 일부 로드 실패 — 지시대로 격리 사본만).

#### 5. DDL 일회용 DB 시험 (`mariadb:11` 로컬 이미지 = **11.8.8**, 운영 10.11.11 과 버전 다름 — `mariadb:10.11` 이미지 없음, 받지 않음)
- 컨테이너 `127.0.0.1:33072` 전용, 운영 sql_mode(`STRICT_TRANS_TABLES` 포함) 지정, 테이블 DDL 은 운영 `SHOW CREATE TABLE`(읽기 전용 러너 실측) 복사. **끝나고 `docker rm -f` 로 제거 확인.**
- CLI 로 운영과 같은 방식(`mariadb db < T-072-validation-gate.sql`): ① 1회·2회 적용 모두 exit 0, 컬럼 3개·인덱스 1개(중복 없음) ② 기존 2행 전부 `unvalidated` ③ 같은 `signal_id` 직접 INSERT → `ERROR 1062 Duplicate entry … 'uq_paper_fills_signal'`, `INSERT IGNORE` → ROW_COUNT 0·행 수 1 ④ 롤백(주석 2줄) 2회 exit 0 → 컬럼·테이블 제거, strategies 행 보존 → 재적용 exit 0.
- jest 실 DB 시험 14/14(`t072-disposable-mariadb.test.ts`): 마이그레이션 전 매수 = 실제 `ER_BAD_FIELD_ERROR` → lookup_error 차단·매도 조회 0 / 가상 체결 테이블 없음 → 던지지 않음 / 시드 `INSERT IGNORE`(열 명시) 호환 / STRICT 에서 ENUM 밖 값 거부(`WARN_DATA_TRUNCATED`) / 승급 SQL → 허용 → 강등 → 즉시 차단 / 해외 가상 체결 USD 211(=280,000/1324.63 반올림) / 감사 행 실제 스키마 / **claimCooldown inserted→active→reclaimed, 동시 10회 중 정확히 1회 선점(새 키·만료 키)** / **ODKU 실증: mysql2 기본(FOUND_ROWS) 에서 새 삽입 1 · 변경 없음 1(구분 불가) · 실제 연장 2, `-FOUND_ROWS` 연결에서는 변경 없음 0** / 롤백·재적용.
- 재현: 시험 파일 머리 주석의 `docker run …` + `T072_TEST_DB_PORT=33072 T072_TEST_DB_PASSWORD=t072test npx jest <파일>`.

#### 6. 변이 시험 — **17/17 포착 (자기 변이 세트 기준, Reviewer 독립 재현 필요)**
격리 사본에서 변이 1개씩 적용 → jest 전체(DB env 포함) → 원복(원복 후 원본과 바이트 동일 확인). 실행기 `scratchpad/t072-2a-mut/run.py`.
| # | 변이 | 결과 | 잡은 시험(실패 수) |
|---|---|---|---|
| M1 | side 가드 제거 | 포착 | sell-invariant·validation-gate·service-validation-gate·order-sizing·service·DB (36) |
| M2 | 허용 집합에 unvalidated | 포착 | validation-gate·submit-order-validation-gate·service-validation-gate·DB (25) |
| M3 | 조회 예외 → 허용 | 포착 | 위 + sell-invariant 대조 (10) |
| M4 | null ID 허용 | 포착 | (12) |
| M5a | G6(DRY_RUN 앞) 호출 삭제 | 포착 | submit-order-validation-gate·order-sizing (11) |
| M5b | 송신 직전 재검증 삭제 | 포착 | submit-order-validation-gate (3) |
| M5c | 귀속 미지정 기본값을 검증된 ID 로(fail-open) | 포착 | (2) |
| M6a | `INSERT IGNORE` → `INSERT` | 포착 | paper-fill·service-validation-gate·DB (25) |
| M6b | 마이그레이션 `UNIQUE(signal_id)` 제거 | 포착 | **DB 시험만** (2) — 평소 jest(env 없음)에서는 생존 |
| M7a | 차단 시 쿨다운 선점 제거(service) | 포착 | service-validation-gate (4) |
| M7b | 엔진이 선점 플래그를 안 넘김 | 포착 | engine-validation-gate (1) |
| M8 | 감사 행 상태 `awaiting_approval` | 포착 | paper-fill·service-validation-gate·DB (19) |
| X1 | G1 호출 삭제 | 포착 | (24) |
| X2 | claimCooldown 이 항상 선점(ODKU 의미) | 포착 | cooldowns·service-validation-gate·DB (6) |
| X3 | lookup_error 를 skip 으로 집계 | 포착 | engine-validation-gate (1) |
| X4 | 감사 행 price_at_skip 비움 | 포착 | (3) |
| X5 | 가상 체결 DB 오류를 던짐 | 포착 | (5) |
범위 밖(WP-2b)이라 돌리지 않은 변이: G5 호출 삭제 · discretionary 추가.

#### 7. 남은 위험 · 미확인
- 🔴 **F-14 전제 확인 결과 [확실, 이번 세션 grep]: `submitOrder`(dry-run.ts)·`kis-domestic`/`kis-overseas` createOrder·`approveSignal`·`POST /api/orders` 어디에도 장 시간 외 주문 차단이 없다.** 장 시간 판정은 엔진 `runMarket`(`engine.ts:1181`)과 entry-watcher(`entry-watcher/route.ts:195`)뿐이다. 즉 "폐장 시간대에는 주문이 거래소로 나가지 않는다"는 코드가 아니라 KIS 의 거부(`categorizeRejectReason` → `market_closed`)에 기대는 가정이다 — **Leader 가 사용자에게 알려야 할 항목**. (해외 정규장 외 주문이 KIS 에서 어떻게 처리되는지는 확인하지 않았다 [추측: 거부].)
- WP-2a 만 배포하면 귀속 미전달로 모든 매수가 G6 에서 막힌다(위 2-8). 안전 방향이지만 G6 발동마다 **스로틀 없는 경고 알림**이 나간다(F-12) — 현재 승인 대기·감시 행 0, `autopilot_mode=assist`(Stage 0 실측)라 평소 발동 경로는 사람이 승인할 때뿐. WP-2a 단독 배포는 권하지 않는다(G4 없이 승인하면 경고 + `order_not_accepted`).
- `INSERT IGNORE` 는 중복 외의 데이터 오류(길이 초과 등)도 경고로 낮춰 잘라 넣는다(cooldowns·paper_fills). 입력이 코드에서 정규화된 짧은 값이라 실영향은 낮다고 판단 [가능성 높음].
- 막힌 매수가 선점한 진입 쿨다운(120분)은 **승급 직후**에도 남아 그 (종목·전략)의 첫 실제 시그널을 최대 120분 늦출 수 있다(실 경로 빈도와 같게 하려는 설계의 부작용).
- 비엔진 경로는 호출마다 기록(쿨다운 없음) — 같은 `POST /api/signals` 반복 시 중복 표본.
- `cooldowns.ts` 는 HEAD 부터 NUL 바이트 4개(cacheKey 구분자)를 포함해 `git diff` 가 Bin 으로 보인다 — 검토 시 `git diff --text`.
- 일회용 DB 는 MariaDB 11.8.8(운영 10.11.11). `ADD COLUMN IF NOT EXISTS`·ENUM·INSERT IGNORE·FOUND_ROWS 의미는 10.x 와 같다고 알고 있으나 10.11 로 직접 돌리지는 않았다.
- 미실행: eslint(설정 없음), dev 서버·curl(엔드포인트 변경 없음), 운영 DB 조회(스키마 SHOW CREATE 만 읽기 전용), 20-Log 한 줄(Leader 지시의 허용 파일 밖이라 생략 — Leader 가 남길 것).
- 커밋 시 SAFETY_PATHS 대상: `src/lib/safety/**`·`src/lib/signals/**`·`src/lib/strategy/**`·`src/lib/exchanges/types.ts`(+각 `__tests__`). `scripts/migrations/`·`src/app/api/strategies/` 는 대상 밖(F-10 결정 대기).

### Stage 2 — WP-2b 구현 (2026-10-23 02:27, developer opus)

- [02:27] 범위: G2(post-market 카드)·G3(custom/confirm)·G4(승인 2경로)·G5(entry-watcher)·`submitOrder` 호출부 4곳 귀속 연결·정적 시험·응답 분류(`/api/signals`·`analyst/run`)·텔레그램/웹 승인 한국어 문구·WP-2a 후속 3건((a)(b)(c)). git 쓰기 0, 운영/공용 DB 쓰기·조회 0(이번엔 읽기 전용 러너도 쓰지 않음), 배포·pm2·KIS·외부 호출 0, 화면 파일 0. 일회용 DB 컨테이너(`mariadb:11` 로컬 이미지, `127.0.0.1:33072`)는 끝나고 `docker rm -f` 로 제거 확인.
- [02:27] 근거 기준 HEAD `1163fe2`. WP-2b 대상 파일은 시작 시 `git diff HEAD` 0(또는 WP-2a 변경분만)이었다. 타 세션 경로(`llm`·`notify`·`fx.ts`·`kis-http.ts`·`auth`·`ai-filter.ts`·`api-usage*`·`jest.config.js`, 그리고 작업 중 새로 생긴 `src/lib/exchanges/__tests__/kis-*usage*`)는 열지도 근거로 쓰지도 않았다.

#### 1. 변경 파일 (WP-2a 파일을 다시 고친 것 포함 — 전부 SAFETY_PATHS 안)
| 파일 | 구분 | 요지 |
|---|---|---|
| `src/lib/safety/validation-gate.ts` | WP-2a 재수정 | `ValidationGateErrorCode`·`validationErrorCode`·`isValidationGateErrorCode`·`VALIDATION_GATE_USER_MESSAGE`(한국어)·`validationGateHttpStatus`(403/503) 추가. 판정 로직 불변 |
| `src/lib/signals/paper-fill.ts` | WP-2a 재수정 | (b) `INSERT IGNORE` 제거 → 일반 INSERT + **1062 만** `{inserted:false, duplicate:true}`, 그 외 오류는 삼키고 로그(`error`). `validFrom/validUntil` 에 KST 문자열 허용. `withValidationGateIndicators`(표지 병합 공용화). `VALIDATION_GATE_TRADE_LOG_EVENT='signal_validation_gate'`(22자)·`recordValidationGateEvent`(G3·G4·G5 흔적, 던지지 않음) |
| `src/lib/signals/service.ts` | WP-2a 재수정 | 자동 제출·`approveSignal` 의 `submitOrder` 에 `attribution`. G4 `approvalValidationBlock`(첫 줄 `row.side !== 'buy'` → null) — `approveSignal` 은 사이징 스킵 뒤·**선점 전**, `approveSignalHybrid` 는 **전환(선점) 전**. 막히면 `{ok:false, errorCode}` + trade_logs, 행 상태 불변. hybrid 반환에 `errorCode` |
| `src/lib/strategy/post-market-engine.ts` | 신규 수정 | G2: `insertScenarioCardIfAbsent(pool,row,opts?)` 가 INSERT 전에 판정 → 막히면 같은 문장에 `status='skipped'` + indicators 표지. **새 행일 때만** 그 id 로 가상 체결(`zone_touch_pending`·`post_market`·구간·카드와 같은 KST 유효기간·entry-watcher 와 같은 사이징). 반환 `'created'|'duplicate'|'blocked'`. `deferPaperFills` 옵션·`flushCardPaperFills`. 국내 집계(`validationBlocked`, `signalsSkipped` 포함) |
| `src/lib/strategy/post-market-overseas.ts` | 신규 수정 | 트랜잭션 안에서는 가상 체결을 쌓기만 하고 **COMMIT 성공 뒤** 풀 연결로 기록(롤백이면 버림). 행에 USD 구간·추격 원화 지정가 전달. 집계 `validationBlocked` |
| `src/app/api/signals/custom/confirm/route.ts` | 신규 수정 | G3: 수치 가드 뒤·**GET_LOCK 전** `direction==='buy'` 만 판정(귀속 `attributedStrategyId`=null — INSERT 도 같은 상수). 403/503 + 한국어 `error` + `errorCode` + trade_logs |
| `src/app/api/cron/entry-watcher/route.ts` | 신규 수정 | SELECT 에 `strategy_id`. G5: 만료 처리 직후·**시세 조회·T-051·선점 전** 매수만 판정. 결정적 차단 → 조건부 `superseded` + trade_logs(종결 성공 시 1회), 조회 실패 → 이번 틱만 건너뜀. outcome `validation_blocked`·요약 로그. `submitOrder` 귀속 |
| `src/app/api/orders/route.ts` | 신규 수정 | `attribution: {strategy, null, null}` 명시(F-1) |
| `src/app/api/signals/route.ts` | 신규 수정 | `origin:'api_signals'` · `validation_gate`/`validation_lookup_error` → 200 skipped |
| `src/app/api/analyst/run/route.ts` | 신규 수정 | `origin:'analyst_run'` · 두 코드 → `skipped` |
| `src/app/api/signals/[id]/approve/route.ts` | 신규 수정 | 두 코드 → 403/503 + 한국어 `error`(기계 문자열은 `data`/`detail`) |
| `src/lib/signals/telegram-approval.ts` | 신규 수정 | `mapFailure` 에 두 코드 → 한국어 문구 |
| `src/lib/signals/telegram-poller.ts` | 신규 수정 | 하이브리드 승인 결과의 `errorCode` 전달 |
| 시험 신규 5 | 신규 | `safety/__tests__/submit-order-callsites.test.ts`(정적, TS 파서) · `strategy/__tests__/post-market-validation-gate.test.ts` · `app/api/signals/custom/confirm/__tests__/validation-gate.test.ts` · `app/api/cron/entry-watcher/__tests__/validation-gate.test.ts` · `signals/__tests__/approve-validation-gate.test.ts` |
| 시험 수정(WP-2a 파일) 5 | 재수정 | `paper-fill`(1062 목·데이터 오류·흔적·(c)) · `service-validation-gate`(1062 목·(c) G1 통합) · `service`(승인 행 4곳 전략 → 검증된 fixture) · `order-sizing`((a) 양성 복원 + 차단 별도 + 자동 제출 귀속) · `t072-disposable-mariadb`(C-1 갱신, C-3 STRICT·C-4 G2 카드·C-5 조건부 종결 신규) |
| 시험 수정(기존) 14 | 수정 | `post-market-domestic-golden`·`post-market-engine`·`post-market-overseas`(관문 목 '검증됨' + SQL 인덱스 3곳 + 해외 G2 절 신규) · `confirm/__tests__/route.test`(관문 목) · entry-watcher `fakeSignalsDb`(strategy_id·strategies·superseded·trade_logs·**SELECT 열 투영**)·`claim`·`cash-precheck`(순서 단언에 관문 추가 = 강화)·`sizing`(fixture) · `orders/__tests__/route`·`signals/__tests__/route-insufficient-cash`·`approve-route`·`analyst/run/__tests__/route`·`telegram-approval`·`telegram-poller-wiring`(신규 단언 추가) |

#### 2. 설계 대비 차이와 사유 (Reviewer 판단 필요)
1. **G2 해외 가상 체결은 트랜잭션 "안"이 아니라 COMMIT 뒤.** 지시는 "트랜잭션 안에서 실패가 카드·트랜잭션을 망치지 않게(삼키고 로그)". 안에서 쓰면 ① 롤백 시 고아 행(풀 연결로 쓰면) 또는 함께 롤백(같은 연결로 쓰면 — 이건 무해) ② 교착(1213)은 트랜잭션 전체를 서버가 되돌리는데 그걸 삼키면 이후 카드가 자동 커밋으로 흩어지고 결과는 "생성"으로 거짓 보고된다. 커밋 뒤 기록은 둘 다 구조적으로 없앤다. 대가: 커밋 성공 뒤 기록 실패 시 카드는 skipped 로 남고 가상 체결만 빠짐(로그).
2. **반환 타입 확장** `'created'|'duplicate'` → `+'blocked'`. 그대로 두면 막힌 카드가 `signalsCreated`·"✅" 로그로 세어져 대시보드에 0장인데 생성 N 으로 보인다. 두 호출부 모두 갱신, `validationBlocked` 는 1 이상일 때만 응답에 싣는다(국내 골든·응답 형태 불변).
3. **카드 INSERT 의 status 를 자리표시자로, 맨 뒤 열로** — 앞 열 파라미터 인덱스를 유지하려고. 기존 시험 3곳의 SQL 문자열·파라미터 수(11→12)·`slice(9→10)` 를 고치고 `status='pending'` 단언을 **추가**했다(의미 동일·강화).
4. **막힌 카드는 `price_at_skip` 을 채우지 않는다.** 카드 `price`(구간 중간값)가 이미 있고 T-070 은 `price` 를 읽는다. `price_at_skip` 은 ai_skipped 후속 백필 기준가라 카드에 맞지 않고, 넣으면 열이 늘어 국내 골든이 깨진다.
5. **G5 조회 실패(lookup_error)는 종결하지 않는다**(지시는 "차단이면 superseded"). 일시 장애로 검증된 전략의 승인 행을 영구 종결하지 않기 위해 이번 틱만 건너뛴다 — 선점·주문·알림·trade_logs 없음(매 분 경고 반복 없음, console.warn 만). 결정적 차단 4사유는 지시대로 종결.
6. **G5 위치는 "현금 점검·선점 직전"이 아니라 만료 처리 직후**(시세 조회보다도 앞). 막힌 행에 KIS 시세를 부르지 않고, 구간 미도달 행도 첫 틱에 종결된다. 장이 닫힌 시장의 잔여 매수 행도 다른 시장이 열린 틱에 종결된다.
7. **G3·G4 도 trade_logs 흔적**을 남긴다(지시는 G5 만 명시 — Stage 0 G "엔진 밖 경로는 trade_logs", 감사 원칙 3). G4 는 승인 클릭마다 1행.
8. **HTTP 상태**: G3·웹 승인은 정책 거절 403 · 조회 실패 503(기존 400 대신). `POST /api/signals` 는 지시대로 두 코드 모두 200 skipped(조회 실패도) — 경로마다 다르다.
9. **G3 은 T-029 수치 가드 뒤**에 둔다(잘못된 본문은 여전히 400 — 시험 고정). **G4(`approveSignal`)는 사이징 스킵 뒤**(지시 "선점 전") — 1주도 안 되는 매수는 여전히 `quantity_below_min` 으로 답한다(주문 0 은 같다).
10. **(b) `ON DUPLICATE KEY UPDATE` 를 쓰지 않았다.** WP-2a 실증(D-3)대로 mysql2 기본 FOUND_ROWS 에서 "새 삽입"과 "변경 없는 중복"이 둘 다 affectedRows 1 이라 `inserted` 를 판정할 수 없다. 일반 INSERT + 1062 catch 가 정확히 구분한다. 중복 시 기존 id 조회는 생략(소비자 없음, `duplicate:true` 로 표시) — 지시의 "후 id 조회"와 다르다.
11. **(c) 코드 변경 없음** — WP-2a 구현이 이미 0 을 0 으로 기록하고 있었다(`finiteNonNegative`, `sized.quantity` 그대로). G1 통합 시험과 `recordValidationBlockedBuy` 시험으로 고정(변이 C-1·C-2 포착).
12. **(a)** `order-sizing` 승인 시험을 "검증된 전략 → 승인 성공(4주·approved)"으로 되돌리고, 같은 행의 귀속 없음 → `validation_gate`·선점 0·orders 0 시험을 따로 뒀다. 자동 제출 매수가 G6 를 통과해 DRY_RUN 까지 가는 행동 시험도 추가(변이 A-1 이 처음엔 정적 시험으로만 잡혀서).
13. **기존 시험의 관문 목**: 골든·post-market-engine·overseas·confirm `route.test` 는 관문 **뒤** 기계를 보므로 판정만 '검증됨'으로 고정했다(골든 리터럴 무수정). 실제 관문은 신규 시험 4개가 본다. entry-watcher·service 시험은 fixture 를 검증된 전략으로 바꿨다(WP-2a 와 같은 방식). 기대값을 느슨하게 바꾼 곳은 없다 — 순서 단언 2곳은 관문 이벤트를 **추가**한 강화다.
14. `telegram-approval.ts` 가 한국어 문구 때문에 `validation-gate.ts` 를 import → `db.ts` 모듈을 간접적으로 끌어온다(호출은 없음, getPool 은 지연 생성). 파일 머리의 "DB 를 직접 import 하지 않는다"는 여전히 참이지만 모듈 그래프는 커졌다.
15. 정적 시험: F-1 로 'discretionary' 귀속이 철회됐으므로 "orders 의 strategyId 는 정확히 null"로 고정. 추가로 `submitOrder` 값/별칭 사용 0, 어댑터 `createOrder(` 직접 호출 0(`src/lib/exchanges/` 밖), **호출부 목록 고정**(entry-watcher 1·orders 1·service 2 — 새 호출부는 목록 수정으로 리뷰 강제).

#### 3. 검증 수치 (격리 사본 `scratchpad/t072-iso-2b` = `git archive HEAD` + T-072 파일만(WP-2a + WP-2b, 동기화 스크립트 `scratchpad/t072-2b-sync.sh` — 바이트 대조 bad=0), `node_modules` 링크, jest 설정은 HEAD 것)
- 기준선(WP-2a 상태, 이번 격리 사본): tsc 0 · jest 216 통과 + 1 건너뜀, 5,181 통과 / 14 건너뜀 / 5,195.
- 변경 후: **tsc 0 오류** · **jest 221 스위트 통과 + 1 건너뜀(DB 시험) — 5,290 통과 / 17 건너뜀 / 5,307**. 일회용 DB env 를 주면 **222/222 스위트 · 5,307/5,307 통과**.
- 일회용 DB 시험 17/17(MariaDB **11.8.8**, 운영 sql_mode): 기존 14 + C-3(STRICT 1406 → 잘라 넣지 않고 error, 대조로 IGNORE 는 16자로 잘라 넣음) · C-4(실제 signals 스키마에 미등록 카드 → `skipped`·표지·`valid_from` 동일, 가상 체결 1행, 재실행 → duplicate·가상 체결 그대로 1, 검증된 전략 → pending·가상 체결 0) · C-5(`superseded` 조건부 UPDATE: 대기 1행·executing 0행).
- eslint 미실행(저장소에 설정 없음 — WP-2a 와 같음). 작업 트리 jest/tsc 미실행(타 세션 변경 혼재).

#### 4. 변이 시험 — **41/41 포착 (자기 변이 세트 기준, Reviewer 독립 재현 필요)**
격리 사본에서 1개씩 적용 → jest 전체(DB env 포함) → 원복·sha256 대조. 실행기 `scratchpad/t072-2b-mut/run.py`(결과 `result.json`, 1차 `result-full-1.json`). **1차 40/41 — G5-7(SELECT 에서 strategy_id 제거)이 생존**: entry-watcher 가짜 DB 가 SELECT 열과 무관하게 행 전체를 돌려줬기 때문. `fakeSignalsDb` 가 SELECT 에 적힌 열만 돌려주게 고친 뒤 G5-7 포착(69 실패), 영향받는 11개(G5-1~7·A-1·A-2·A-3·A-6) 재실행 11/11.
| # | 변이 | 잡은 시험 |
|---|---|---|
| G2-1~6 | 관문 호출 삭제 · 막힌 카드를 pending 으로 · duplicate 에도 가상 체결 · 해외 가상 체결을 커밋 전 즉시 기록 · 롤백돼도 기록 · 카드 표지 생략 | post-market-validation-gate·post-market-overseas·DB(C-4) |
| G3-1~5 | 관문 삭제 · buy/sell 가드 제거(I/O 동등) · 관문을 GET_LOCK 뒤로 · trade_logs 생략 · 매도 경로에 조회 삽입 | confirm validation-gate(+route.test) |
| G4-1~5 | approveSignal/Hybrid 관문 삭제 · 가드 제거(I/O 동등) · 관문을 선점 뒤로 · 매도에 조회 삽입 | approve-validation-gate·order-sizing |
| G5-1~7 | 관문 삭제 · 선점 뒤로 이동 · 가드 제거(I/O 동등) · 종결 UPDATE 상태 조건 제거 · 종결 안 함 · 매도에 조회 삽입 · SELECT 에서 strategy_id 제거 | entry-watcher validation-gate·claim·cash-precheck·unknown-outcome |
| A-1~6 | 호출부 attribution 누락(4곳 각각) · orders/entry-watcher 에 검증된 ID 리터럴 박기(우회) | submit-order-callsites(+행동 시험: order-sizing·approve-validation-gate·entry-watcher·orders route) |
| R-1~7 | `/api/signals`·analyst/run 분류 제거 · origin 미전달(2) · mapFailure 문구 제거 · 하이브리드 errorCode 미전달 · 웹 승인 문구 제거 | 각 라우트·텔레그램 시험 |
| B-1~3 | 1062 처리 제거 · `INSERT IGNORE` 로 되돌림 · 모든 오류를 중복으로 | paper-fill·DB(C-1·C-3)·service-validation-gate |
| C-1~2 | G1 0주를 NULL 로 · 가상 체결 0 → NULL | service-validation-gate·paper-fill |
- 참고: WP-2a 변이 M6a(`INSERT IGNORE`→`INSERT`)는 이번 (b)로 원문이 사라져 재현 불가 — 그 역(B-2)으로 대체했다.

#### 5. 남은 위험 · 미확인
- 🔴 **배포 직후 결과(사용자 고지 대상)**: ① post-market 카드는 전부 `skipped`(대시보드 '내일'·추천 탭에서 사라짐 — F-3) ② `/recommend/build` 매수 시나리오 등록·카드 승인은 403 + "검증되지 않은 전략이라 매수할 수 없습니다" 토스트 ③ 잔여 `approved_pending_entry` 매수 행은 entry-watcher 첫 장중 틱에 `superseded` ④ 웹 승인 큐(`ApprovalQueue.tsx`)는 응답을 읽지 않아 거절 문구가 **화면에 안 보인다**(기존 400 도 같음 — 화면 수정은 범위 밖). 텔레그램은 한국어 문구.
- 나중에 전략을 승급해도 이미 `skipped` 로 들어간 카드는 되살아나지 않는다(다음 실행부터 pending). F-6(`oversold-bounce-v1` ID 불일치)·카드 경유 확정이 원 카드 전략을 잇지 않는 결함(G3 이 계속 막음)은 그대로.
- 미확인: 실제 텔레그램 메시지 렌더링(`approval-message.ts` 의 `failed` 표시)·화면 토스트·dev 서버·curl·KIS(모두 미실행). 일회용 DB 는 11.8.8(운영 10.11.11 아님). 작업 트리의 타 세션 변경(`jest.config.js`·`jest.setup-api-usage.js`·`api-usage*`)과 합친 상태로는 돌리지 않았다 — 합친 뒤 jest 를 다시 돌려야 한다.
- 정적 시험은 `src/` 비시험 파일 전부를 파싱한다 — 타 세션이 `submitOrder`·`createOrder` 를 새로 부르는 코드를 넣으면 이 시험이 실패한다(의도).
- 20-Log 한 줄은 지시의 허용 파일 밖이라 남기지 않았다(Leader 몫).

### Stage 3 — WP-2c (2026-10-23 03:13, developer opus) — 1차 감사 지적 R-1·R-2·R-4 + db-schema 문서

- [03:13] 범위: Reviewer 1차 감사 지적 중 R-1(fail-closed 입구)·R-2(정적 시험 별칭 맹점)·R-4(시험 타입 오류)와 `docs/db-schema.md`(R-5 주의 포함)만. git 쓰기 0, 운영/공용 DB 0, 배포·pm2·KIS·외부 호출 0, 화면 파일 0, 타 세션 파일 0. 일회용 DB 컨테이너(`127.0.0.1:33072`)는 끝나고 제거 확인.

#### 1. 변경 파일 (WP-2a/2b 파일 재수정 포함)
| 파일 | 구분 | 요지 |
|---|---|---|
| `src/lib/safety/validation-gate.ts` | WP-2a 재수정 | R-1: `isSellSide(side)` = `String(side).trim().toLowerCase() === 'sell'`(문자열화가 던지면 false). 첫 줄이 `if (isSellSide(side)) → not_applicable(I/O 0)` — **그 밖의 모든 값(`'BUY'`·`'buy '`·`'purchase'`·`''`·null·undefined·비문자열)은 매수로 판정**. 머리 주석 갱신 |
| `src/app/api/signals/custom/confirm/route.ts` | WP-2b 재수정 | G3 지역 분기 `if (direction === 'buy')` 제거 → 관문을 `side: direction` 으로 늘 부른다. 거절 흔적 side 는 판정대로 `'buy'` |
| `src/lib/signals/service.ts` | WP-2a/2b 재수정 | G4 `approvalValidationBlock` 의 `row.side !== 'buy'` 선행 분기 제거. G1 `finishValidationBlock` 의 가상 체결 사이징·만료를 `{...input, side:'buy'}` 로 계산(관문이 매수로 판정한 입력 — 원 side 로 계산하면 `'BUY'` 가 매도 쪽 추격(−)을 받았다) |
| `src/app/api/cron/entry-watcher/route.ts` | WP-2b 재수정 | G5 지역 분기 `if (row.side === 'buy')` 제거(블록 들여쓰기만 바뀜, 로직 동일). 흔적 side 는 `'buy'` |
| `src/lib/safety/__tests__/submit-order-callsites.test.ts` | WP-2b 재수정 | R-2 근본 원인: import specifier 를 **별칭 여부와 무관하게** 허용했고 호출은 이름이 정확히 `submitOrder` 인 것만 셌다 → `import { submitOrder as so }` + `so(...)` 가 목록·귀속 검사를 둘 다 빠져나갔다. 수정: 파일 단위 `scanSource` — 별칭 import·재수출(`export {submitOrder}`·`export * from '…dry-run'`)·구조분해·대입을 금지, 별칭 이름 호출도 호출부로 세어 귀속 검사, `createOrder` 는 거래소 모듈 밖에서 **`submitOrder` 두 번째 인자로만** 허용(`const f = kis.createOrder`·다른 함수 인자·import 금지). 검사기 자체 시험 13건 추가(R39 재현 포함) |
| `src/lib/strategy/__tests__/post-market-overseas.test.ts` | WP-2b 재수정 | R-4: `:820` `db = {…}` 에 `strategies`·`paperFills`·`paperThrows` |
| `docs/db-schema.md` | 신규 수정(추가만 +54) | `strategies.validation_status`(+`validation_changed_at`·`validation_evidence`)·`paper_fills` 전 열, `quantity` 의미(`0` = 1주 미만 → 실주문이었다면 `quantity_below_min`, `NULL` = 미확정), **분석 쿼리는 `quantity > 0` 필터 명시**·`fill_model`/`gate_reason`/`origin` 층화(R-5) |
| 시험 수정 6 | WP-2a/2b 재수정 | `safety/__tests__/validation-gate.test`(변형 매도 6종 허용·I/O 0, 비매도 16종 매수 판정, 'BUY'+검증 전략 허용, 문자열화 예외) · `submit-order-sell-invariant`(G6 변형 매도 3종 송신·조회 0, 변형 매수 3종 차단) · `service-validation-gate`(G1 변형 매수 8종 차단·감사 행·가상 체결 매수 추격, 변형 매도 3종 조회 0) · confirm `validation-gate`(G3 매도 4종 not_applicable·조회 0, `direction:'BUY'` 등 5종 403·행 0·연결·락 0) · `approve-validation-gate`(G4 매도 not_applicable·조회 0, 변형 매수 차단, `'SELL'` 보호) · entry-watcher `validation-gate`(G5 매도 not_applicable, 변형 매수 행 superseded, `'SELL'` 보호) |

#### 2. 설계 변경 (지시대로) 과 그 영향
- WP-2b 의 "G3·G4·G5 매도 경로는 관문 모듈을 **부르지 않는다**" 단언을 지시에 따라 "부르되 `not_applicable`·strategies 조회 0"으로 바꿨다. 매도 I/O 0 불변식은 이제 중앙 함수 첫 줄 하나가 보장하고, 모든 지점 시험이 조회 0 을 단언한다(변이 V-10: 중앙 함수 첫 줄 앞에 I/O → 47 실패).
- 지역 분기를 없애 G3·G4·G5 에서 매도 1건당 함수 호출 1회가 늘었다(I/O 없음).
- [가능성 높음] 남는 기존 결함(T-072 범위 밖, Reviewer R-1 말미와 같음): 어댑터는 `req.side === 'buy'` 일 때만 매수 TR 이다. 이제 `'BUY'` 는 관문에서 **매수로 판정**되므로 검증 안 된 전략이면 막히지만, **검증된 전략**의 `'BUY'` 는 관문을 통과한 뒤 어댑터가 매도 TR 로 보낸다(WP-2b 이전에도 같은 경로로 매도 TR 이 나갔다 — 악화는 아님). 입구(`POST /api/signals`·confirm)에서 side 를 `buy|sell` 로 검증/정규화하는 것은 별도 결정.
- `dry-run.ts` 의 한도 면제는 정확히 `'sell'` 만이라 `'SELL'` 매도에는 1회·일일 한도·변동성 가드가 걸린다(기존 동작, 이번에 바꾸지 않음 — 시험은 한도 안 금액으로 고정).

#### 3. 검증 수치 (새 격리 사본 `scratchpad/t072-iso-2c` = `git archive HEAD` + T-072 전체 변경(WP-2a·2b·2c)·`docs/db-schema.md`, 동기화 `scratchpad/t072-2c-sync.sh` 바이트 대조 bad=0, jest 설정은 HEAD 것)
- `tsc --noEmit -p .` **0 오류**.
- 시험 포함 타입 검사(R-4): `scratchpad/t072-iso-2c/tsconfig.t072-tests.json`(프로젝트 설정 상속, `files` = T-072 가 건드린 시험 36개, `types: jest,node`) **0 오류**. 같은 설정을 HEAD 사본(`scratchpad/t072-head-tc`, 그 시점에 있던 24개)에 돌려도 0 — 이 36개 범위의 기준선 오류는 없다. R-4 수정을 격리 사본에서만 되돌리면 `post-market-overseas.test.ts(820,7): error TS2739 … missing … strategies, paperFills, paperThrows` 1건이 나온다(확인 후 원복·cmp 동일).
- jest 전체: **221 스위트 통과 + 1 건너뜀 — 5,369 통과 / 17 건너뜀 / 5,386**. 일회용 DB env(MariaDB 11.8.8): **222/222 · 5,386/5,386**.

#### 4. 변이 시험 — **15/15 포착 (자기 변이 세트 기준, Reviewer 독립 재현 필요)** — 실행기 `scratchpad/t072-2b-mut/run2c.py`, 결과 `result-2c.json`
| # | 변이 | 실패 수 · 잡은 시험 |
|---|---|---|
| V-1 | side 정규화 제거(정확히 소문자 'sell' 만 매도) | 15 · gate 단위·sell-invariant·G3/G4/G5/G1 |
| V-2 | 중앙 함수 "buy 아님 → 허용" 복원 | 55 · 전 지점 |
| V-3 | 정규화 후 "buy 아님 → 허용"(알 수 없는 값 허용) | 27 · gate 단위·sell-invariant·G1 |
| V-4~V-7 | G1·G3·G4·G5 지역 `=== 'buy'` 분기 복원 | 8 · 9 · 9 · 6 — 각 지점 시험(G1 service-validation-gate, G3 confirm, G4 approve, G5 entry-watcher) |
| V-8 | G6 지역 분기(앞·송신 직전) | 3 · sell-invariant |
| V-9 | G1 가상 체결 사이징을 원 side 로 | 8 · service-validation-gate |
| V-10 | 중앙 함수 매도 판정 앞에 I/O | 47 · gate 단위 |
| V-11 | **Reviewer R39 재현**: `import { submitOrder as so }` + 귀속 없는 `so(...)` 호출부 | 3 · submit-order-callsites(별칭 금지·호출부 목록·귀속 누락) |
| V-12~V-14 | `const f = submitOrder` · `export { submitOrder as sendOrder } from …` · `const f = kis.createOrder` | 1 · 1 · 1 · submit-order-callsites |
| R-4 | 필드 3개 제거(시험 포함 tsc) | 1 오류 · `tsconfig.t072-tests.json` (jest·프로젝트 tsc 는 못 잡는다 — 그래서 별도 검사) |

#### 5. 남은 위험 · 미확인
- 위 2절의 어댑터 `'BUY'` → 매도 TR 기존 결함과 `'SELL'` 한도 적용은 그대로(범위 밖).
- 시험 포함 타입 검사는 저장소 기준 명령이 아니다(프로젝트 `tsconfig.json` 이 시험을 제외) — 상시로 쓰려면 별도 결정.
- Reviewer R-3(승인 UI 무반응)·R-6~R-12 는 이번 범위가 아니다(지시대로). R-11(telegram-approval 의 모듈 그래프)도 그대로.
- 미확인: MariaDB 10.11.11 실행, 타 세션 변경과 합친 상태의 jest, 실제 UI·텔레그램 렌더링(모두 미실행).
- 20-Log 한 줄은 허용 파일 밖이라 남기지 않았다(Leader 몫).

### Stage 4 — WP-2d (2026-10-23 03:38, developer opus) — 'BUY' 매도 TR 위험 차단 + 2차 감사 R2-1·R2-3

- [03:38] 범위: 2차 재검증 항목 6(검증된 전략 귀속의 `'BUY'`·`'Buy'`·`'buy '` 가 G6 를 통과해 원문 그대로 어댑터로 가 **매도 TR** 로 나가는 문제)을 코드로 막음 + R2-1(G6 두 판정 독립 증명) + R2-3(정적 시험 요소 접근). 어댑터(`kis-domestic.ts`·`kis-overseas.ts`)는 건드리지 않았다. git 쓰기 0, 운영/공용 DB 0, 배포·pm2·KIS·외부 0, 화면 0, 타 세션 파일 0. 일회용 DB 컨테이너는 끝나고 제거 확인.

#### 1. 변경 파일 (WP-2a/2b/2c 파일 재수정 포함)
| 파일 | 구분 | 요지 |
|---|---|---|
| `src/lib/safety/validation-gate.ts` | 재수정 | `normalizeOrderSide(side)`: **문자열만**, trim·소문자 후 정확히 `'buy'`/`'sell'` 이면 그 값, 아니면 null(비문자열 null). `INVALID_SIDE_USER_MESSAGE`(한국어). 관문 판정(`isSellSide`)은 그대로 |
| `src/lib/safety/dry-run.ts` | 재수정 | `submitOrderInner` **맨 앞**(orders INSERT·한도·관문 전): 정규화 → `req` 교체(이후 모든 단계·`realSubmit` 은 정확한 값만). null → `rejectInvalidSide`: orders 행 0·거래소 호출 0·`trade_logs` `blocked`(reason `invalid_side`, 원문은 여기만)·경고 알림·`{ok:false, blockedBy:'invalid_side'}`. 기존 동작(orders.side ENUM STRICT 1265 예외가 던져짐)을 명시적 차단으로 일관화. `'SELL'` 은 정규화돼 매도 한도 면제(`!== 'sell'`)도 받는다(R2-2 해소) |
| `src/lib/exchanges/types.ts` | 재수정 | `OrderResult.blockedBy` 에 `'invalid_side'` |
| `src/lib/signals/service.ts` | 재수정 | `createSignal` **맨 앞** 정규화 → 이후 사이징·호가 추격 방향·T-058 현금 게이트·G1·routeSignal·중복 검사·INSERT·자동 제출이 정규화된 값. null → `{ok:false, signalId:0, errorCode:'invalid_input'}`(INSERT·감사 행·가상 체결·알림·조회 0). `CreateSignalErrorCode` 에 `invalid_input`(엔진 집계는 기존 기본값 `signal_create_failed`/error 로 떨어진다 — 엔진 입력은 늘 정확한 값이라 평소 0). WP-2c 의 `asBuy` 복사는 불필요해져 제거 |
| `src/app/api/signals/route.ts` | 재수정 | 입구 정규화, buy/sell 아니면 **400 + 한국어**, `createSignal` 에 정규화된 side |
| `src/app/api/orders/route.ts` | 재수정 | 같은 방식(400 + 한국어), `submitOrder` 에 정규화된 side |
| `src/app/api/signals/custom/confirm/route.ts` | 재수정 | `direction` 정규화(required 검사 직후), 아니면 400 + 한국어. 이후 관문·분할 계산·락 이름·활성 중복 검사·INSERT·알림이 정규화된 값. `'BUY'` → `'buy'` → G3 403 은 그대로 |
| `src/lib/safety/__tests__/submit-order-validation-gate.test.ts` | 재수정 | 6절(정규화: 변형 매수 4종 → 어댑터·orders 에 정확히 `'buy'` · 변형 매도 3종 → `'sell'` + 1회 한도 초과 금액도 매도 면제로 송신·조회 0 · 알 수 없는 값 7종 → 거래소 0·orders 0·invalid_side·감사·경고) · 7절 R2-1(a: 변형 매수 + 미검증 + DRY_RUN=true → `pre_dry_run` 차단 · b: 변형 매수, 첫 판정 backtested → 송신 직전 unvalidated → realSubmit 0·`pre_send`) |
| `src/lib/safety/__tests__/submit-order-sell-invariant.test.ts` | 재수정 | WP-2c 의 "`'purchase'` 는 매수로 판정 → validation_gate" 를 "`'purchase'`·`''`·null → invalid_side·조회 0·송신 0"으로 분리(더 엄격) |
| `src/lib/safety/__tests__/submit-order-callsites.test.ts` | 재수정 | R2-3: 요소 접근 호출 `dr['submitOrder'](…)` 을 호출부로 세고(귀속 검사) 요소 접근 자체를 금지, `kis['createOrder']` 금지. 자체 시험 4건 추가 |
| `src/lib/signals/__tests__/service-validation-gate.test.ts` | 재수정 | 1b 에서 `'purchase'`·`''`·null·undefined 를 빼 1c 로: `invalid_input`·시그널·감사·가상 체결·조회·잔고 0 / 검증 전략 + `'BUY'` → 현금 게이트를 탄다(S→B)·INSERT side `'buy'` / 자동 제출 `'buy '` → submitOrder 에 `'buy'`·추격 +0.5%·4주 / `'SELL'` → `'sell'` |
| `src/app/api/signals/custom/confirm/__tests__/validation-gate.test.ts` | 재수정 | 변형 매도 → 관문·INSERT·중복 검사에 정확히 `'sell'` · `'purchase'` 를 403 목록에서 400 절로 · 400 6종(DB 0) · 빈 문자열은 기존 required 문구 |
| `src/app/api/signals/custom/confirm/__tests__/route.test.ts` | 재수정 | T-052 R-8 시험의 "side 저장값은 요청 그대로(`'BUY'`)" 기대를 **`'buy'`** 로(지시 3 — 정규화된 값을 하류로). symbol 저장값은 그대로 |
| `src/app/api/signals/__tests__/route-insufficient-cash.test.ts` · `src/app/api/orders/__tests__/route.test.ts` | 재수정 | 변형 5종 → 정확한 값 전달 / 비정상 → 400 + 한국어·하류 미호출 |

#### 2. 설계 판단
- `normalizeOrderSide` 는 **문자열만** 받는다(`['buy']` 같은 배열·객체는 null). 관문의 `isSellSide` 는 WP-2c 대로 `String(side)` 기준이라 `['sell']` 을 매도로 보지만, 이제 입구·`submitOrder` 가 먼저 null 로 끝내므로 그 값이 관문까지 오지 않는다.
- 알 수 없는 side 는 `submitOrder` 에서 **orders 행을 만들지 않는다**(ENUM 이 받지 않고, 가짜 값을 넣을 열도 없다). 감사는 `trade_logs`(order_id NULL). 반환에 `orderId` 가 없어 호출부 3곳(createSignal·approveSignal·entry-watcher)은 기존 "확정 거부" 분기로 간다 — 셋 다 정규화된/DB canonical 값이라 평소 도달하지 않는다.
- `createSignal` 의 거절 코드는 새 `invalid_input`. `POST /api/signals`·`analyst/run` 분류는 바뀌지 않는다(400 기본 / analyst 는 엔진 규칙 입력이라 도달 불가).
- R2-1: 정규화가 맨 앞에 있으면 "G6 한 판정만 변형 매수를 못 보는" 변이는 **등가**다(`req.side` 가 이미 정확한 값) — 대조 Z-1 생존이 그 증거. 그래서 W14·W15 를 "정규화 제거 + 한 판정만 정확히 buy 비교"로 재현했고(D-12·D-13), 7절 시험만 돌려도 각각 잡힌다.

#### 3. 검증 수치 (새 격리 사본 `scratchpad/t072-iso-2d` = `git archive HEAD` + T-072 전체 변경 + `docs/db-schema.md`, `scratchpad/t072-2d-sync.sh` 바이트 대조 bad=0)
- `tsc --noEmit -p .` **0 오류**.
- 시험 포함 타입 검사(`tsconfig.t072-tests.json`, T-072 시험 36개) **0 오류**.
- jest 전체 **221 스위트 통과 + 1 건너뜀 — 5,424 통과 / 17 건너뜀 / 5,441**. 일회용 DB env(MariaDB 11.8.8) **222/222 · 5,441/5,441**.

#### 4. 변이 — **15/15 포착 (자기 변이 세트 기준, 감사자 독립 재현 필요)** + 대조 1(등가, 생존 정상) — `scratchpad/t072-2b-mut/run2d.py`, `result-2d.json`
| # | 변이 | 실패 수 · 잡은 시험 |
|---|---|---|
| D-1 | submitOrder 정규화 제거 | 7 · submit-order-validation-gate |
| D-2 | 어댑터에 원문 side 전달 | 7 · 같음 |
| D-3 | 알 수 없는 side 허용 | 10 · sell-invariant·submit-order-validation-gate |
| D-4 | createSignal 정규화 제거(원문 side 로 사이징·현금 게이트) | 7 · service-validation-gate |
| D-5 | createSignal 알 수 없는 side 허용 | 6 · 같음 |
| D-6·D-7 | `/api/signals` 400 검증 제거 · 원문 전달 | 5 · 5 · route-insufficient-cash |
| D-8·D-9 | `/api/orders` 400 검증 제거 · 원문 전달 | 4 · 5 · orders route |
| D-10·D-11 | confirm 400 검증 제거 · 원문 direction 하류 전달 | 6 · 3 · confirm validation-gate·route |
| D-12 | **W14 재현**: 정규화 제거 + 첫 판정만 정확히 buy | 12 (7절만 돌려도 5 실패) |
| D-13 | **W15 재현**: 정규화 제거 + 송신 직전 판정만 정확히 buy | 10 (7절만 돌려도 3 실패) |
| D-14·D-15 | 요소 접근 호출부 `dr['submitOrder']` 추가 · `kis['createOrder']` 전달 | 3 · 1 · submit-order-callsites |
| Z-1 | 대조: 정규화 유지 + 첫 판정만 정확히 buy | 생존(등가 — 위 2절) |

#### 5. 남은 위험 · 미확인
- 어댑터 자체는 여전히 `req.side === 'buy'` 만 매수로 본다. 방어는 `submitOrder` 입구(모든 송신 경로가 지난다 — 정적 시험이 호출부·별칭·요소 접근을 고정)에 있다. `submitOrder` 를 우회해 어댑터를 부르는 코드는 정적 시험이 막는다.
- 시험 포함 타입 검사는 저장소 기준 명령이 아니다(Stage 3 와 같음). R-3·R-6~R-12 는 범위 밖 그대로.
- 미확인: MariaDB 10.11.11, 타 세션 변경과 합친 jest, 실제 KIS·UI·텔레그램(모두 미실행). 20-Log 는 Leader 몫.
- 기록 위생(Leader 참고): 커밋 훅의 섹션 판별(`/^##+[ \t]/` + 제목에 reviewer)은 `####` 소제목도 잡는다. Stage 1~3 의 `####` 소제목 4곳("…Reviewer 독립 재현 필요"·"…Reviewer 판단 필요")이 그래서 Reviewer 본문으로 읽힌다 — 그 안에 "최종 판정" 문구가 없어 판정 결과는 바뀌지 않지만(현재 유효 판정은 `## Reviewer` 의 마지막 줄), 다른 절 수정 금지라 고치지 않았다. 이번 절 제목에는 그 단어를 쓰지 않았다.

## Reviewer

- [02:58] 방법·범위(1차 감사, reviewer): 기준 HEAD `1163fe2`. 작업 트리 `git status` 120경로 중 T-072 52경로(신규 포함)를 `grep`(T-072·validation_gate·paper_fill 표지)와 task 표로 이중 대조해 확정 — task 표에 없는 변경 파일 0, 52개 기본명 전부 task 문서에 언급됨. 타 세션 파일(api-usage·kis-http·llm·notify·auth·fx·ai-filter·market-context·mail·rag·jest.config 등)은 열지도 근거로 쓰지도 않음. 격리 사본 `scratchpad/t072-iso-rev` = `git archive HEAD` + 위 52경로(작업 트리와 cmp 차이 0), 변이는 이 사본에서만 하고 매 변이 뒤 원복·바이트 대조 차이 0. 운영 DB 는 읽기 전용 러너로 SHOW CREATE TABLE·INFORMATION_SCHEMA 만 조회(쓰기 0), git 쓰기·배포·pm2·KIS·외부 호출 0.
- [02:58] 직접 재현한 수치: `tsc --noEmit` 0 오류(src 395파일). 단 `tsconfig.json` 이 `__tests__`·`*.test.ts` 를 제외하므로 시험 파일은 타입 검사 밖이고 jest 도 `@swc/jest` 라 타입을 안 본다(아래 R-4). jest 전체 221 suites 통과 + 1 skipped(DB 시험), 5,290 통과 / 17 skipped / 5,307. 일회용 MariaDB(로컬 `mariadb:11` = 11.8.8, `127.0.0.1:33172` 전용, 운영 sql_mode, 끝나고 `docker rm -f` 로 제거 확인) env 를 켠 전체는 222/222 suites, 5,307/5,307. Developer 보고 수치와 같다. 운영 버전 10.11.11 로는 돌리지 못했다(로컬 이미지 11.8.8 뿐, 새 이미지 받지 않음).
- [02:58] 변이 독립 재현: Developer 변이 표는 자기 변이 세트 기준이라 믿지 않고, 실행기 `t072-2b-mut/run.py` 앞부분(변이 정의·블록 이동 함수)을 읽어 변이 방식이 적절함을 확인한 뒤 내 변이 49개를 새로 만들어 격리 사본에 1개씩 적용하고 jest 전체(DB env 포함)를 돌렸다 — 47개 killed, 2개 survived(아래 R-1·R-2). 대조용 무변경(R40)은 기대대로 생존. 실행기 `scratchpad/t072-rev-mut/run.py`·`mutations.py`·`mutations2.py`. 포함 변이: 관문 첫 줄 side 가드 제거 · 허용 집합에 unvalidated 추가 · 조회 예외/이상값/미등록/null ID 를 허용으로 · G1·G3·G4(2)·G5·G2·G6(앞·송신 직전) 호출 삭제 · G6 송신 직전 재검증을 첫 판정 재사용으로 · G5 판정을 선점 뒤로 이동 · G5 lookup_error 도 종결 · 카드 skipped 를 pending 으로 · 카드 duplicate 에도 가상 체결 · 카드 INSERT 위치 파라미터 4쌍(market/status, reasoning/indicators, price/amount, expires/valid_from) 교환 · 엔진 쿨다운 선점 플래그 제거 · 선점 결과 무시/오류 시 기록 · 쿨다운 선점을 사후 UPSERT(ODKU)로 · 재선점의 만료 조건 제거 · paper_fills 일반 오류를 던짐/1062 분기 제거/모든 오류를 중복으로 · G5/자동 제출 귀속 null·제거 · `/api/orders` 귀속에 클라이언트 값 · strategies PATCH 가 validation_status 수용 · G1 이 매도를 매수로 판정/G1 매도에 조회 삽입 · 매도 경로(G3·G4)에 조회 삽입 · HTTP 403/503 교환 · trade_logs 이벤트명 33자 · 국내 수수료율 변조 · 관문 SQL 에서 id 조건 제거 · G5 종결 상태 변조 · 정적 시험 별칭 우회.
- [02:58] 항목 A 의도 검증: 충족. 신규 매수가 거래소로 가는 길은 `submitOrder` 호출부 4곳뿐이고(B), 4곳 모두 G6(최후 방어선, `dry-run.ts:224`·`:241`)을 지나며 귀속 미지정은 전략 없음으로 취급해 차단한다(`dry-run.ts:85`·`:323`). D-1(`POST /api/orders` 포함 전부 차단): `orders/route.ts:84` 가 귀속을 `{strategy, null, null}` 로 고정(본문·source 무관, `orders/__tests__/route.test.ts` 5건). D-2: G1(룰·API 시그널)과 G2(post-market 카드)에서 `skipped` 감사 행 + `paper_fills` 기록. D-3: 운영 DB 에 아직 적용 전임을 직접 확인(`paper_fills` 테이블 없음, `strategies` 에 validation 열 없음, 운영 10.11.11·STRICT_TRANS_TABLES). 마이그레이션·배포는 미실행 상태가 맞다.
- [02:58] 항목 B 우회 경로 전수: `grep` 으로 `src`·`scripts` 의 비시험 파일을 직접 재확인 — `submitOrder(` 호출은 정확히 4곳(`entry-watcher/route.ts:492`, `orders/route.ts:77`, `service.ts:642`·`:770`). 거래소 어댑터 `createOrder` 직접 호출 0, KIS 주문 엔드포인트·TR ID 는 `kis-domestic.ts:295-339`·`kis-overseas.ts:576-638` 안에만 있고 `isBuy = req.side === 'buy'` 로 TR 을 고른다(둘 다 직접 읽음). 취소(`order-rvsecncl`)는 `RVSE_CNCL_DVSN_CD '02'` 취소만. 귀속 값 출처: `service.ts:646` 입력의 strategyId, `:774` DB 행의 strategy_id, `entry-watcher:496` DB 행의 strategy_id, `orders/route.ts:84` null 고정 — 요청 본문·source 에서 오는 값 없음. `INSERT INTO signals` 경로는 createSignal(G1)·custom/confirm(G3)·post-market(G2) 3곳 + 승인 불가 감사 INSERT 2곳(`paper-fill.ts` skipped, `engine.ts:704` ai_skipped)이 전부이고 `approved_pending_entry` 로의 전이는 claimAwaitingSignal(G4 뒤)뿐. `scripts/cron-runner.sh` 의 주문 가능 호출은 strategy-eval·entry-watcher 뿐이고 `validation_status` 를 쓰는 코드는 없다(읽는 곳은 관문 1곳, `grep` 확인).
- [02:58] 항목 C fail-closed 행렬: `validation-gate.ts:70-94` 를 직접 읽음 — 매수에서 null·빈 문자열·공백·비문자열 → null_strategy, 행 없음 → unregistered, unvalidated → 차단, NULL·대소문자 다름·그 밖 값 → invalid_status, 조회 예외(`getPool` 던짐 포함)·ER_BAD_FIELD_ERROR → lookup_error, 허용은 backtested·paper_validated 뿐. 던지지 않음(try 는 조회만 감싸고 호출부는 항상 객체를 넘긴다). 끄는 스위치·캐시 없음(파일에 env·system_config·캐시 변수 0, 시험이 단언). 변이 R02-R06 killed, 일회용 DB 시험 B-1(실제 ER_BAD_FIELD_ERROR → 차단·매도는 조회 0) 직접 통과. 내가 만든 마이그레이션 전 상태가 아니라 코드를 마이그레이션보다 먼저 내보낸 경우도 같은 시험으로 buy 차단 확인.
- [02:58] 항목 D 매도 무영향: G1 `evaluateValidationGate` 첫 줄 `input.side !== 'buy'`(`:70`), G3 `direction === 'buy'`(`confirm/route.ts:126`), G4 `row.side !== 'buy'` 선행(`service.ts:695-`), G5 `row.side === 'buy'`(`entry-watcher:268`), G6 같은 첫 줄(`dry-run.ts:224`·`:241`). 매도 시험: sell-invariant 8조합(귀속 미지정·null·exit-engine-v1·미검증 × DRY_RUN true/false × 해외·국내)에서 strategies 조회 0 단언, G1 `hard_stop`/`eod_loss_cut` 강제 auto 매도·`custom/confirm` 매도·approve/hybrid 매도·entry-watcher 매도 모두 조회 0. 변이 R01·R12·R13·G3/G4 조회 삽입(G3-5·G4-5)·S08 killed. 매도 쪽 새 I/O 는 `evaluateValidationGate` 호출뿐이고 그것도 I/O 0 이다.
- [02:58] 항목 E 실 장부 불변: 차단 경로별 쓰기 SQL 을 코드에서 직접 열거. G1 = `cooldowns`(선점)·`signals`(skipped 감사 행)·`paper_fills` / G2 = `signals`(skipped 카드)·`paper_fills` / G3·G4 = `trade_logs` `signal_validation_gate`(order_id NULL)뿐 / G5 = `signals` 조건부 UPDATE(superseded)·`trade_logs` / G6 = 기존 차단 규약대로 `orders` 행(blocked, `blocked_by='validation_gate'`)과 `trade_logs`(submit_attempt·blocked) + 경고 알림 — 실주문이 아니라 감사 규약이며 `orders` blocked 는 일일 한도(`NOT IN rejected,failed,blocked,cancelled,pending`)·종목 한도(filled/accepted/partial)·배관 검증(filled/partial/dry_run)에서 제외돼 한도·검증을 오염하지 않는다. `executions`·`position_state`·`portfolio_snapshots`·`holdings` 쓰기 0(G1 시험이 LEDGER 정규식으로 모든 시험에서 단언, G1 은 읽기도 0). 가상 체결 INSERT 실패는 `insertPaperFill` 이 전부 삼켜 `error` 로 돌려주고(`paper-fill.ts:176-180`) 차단을 바꾸지 않음 — 변이 R32 killed.
- [02:58] 항목 F 동시성·멱등: `claimCooldown`(`cooldowns.ts:202-`)은 INSERT IGNORE(affectedRows 1) → 조건부 UPDATE(`until <= NOW()`, affectedRows 1) → 아니면 active, 오류는 error(던지지 않음). `ON DUPLICATE KEY UPDATE` 로 선점을 판단하는 코드 없음(시험이 SQL 에 ODKU 없음을 단언). 일회용 DB 시험 D-1·D-2·D-3 직접 통과(inserted→active→reclaimed, 동시 10회 중 정확히 1회, ODKU 는 삽입·무변경이 둘 다 1 이라 구분 불가). 변이 R30(사후 UPSERT)·R31(만료 조건 제거) killed. G5 조건부 UPDATE 와 다른 경로 겹침: 상태 조건 `AND status='approved_pending_entry'` 라 executing 으로 선점된 행은 덮지 않고(0행이면 종결·흔적 없이 `continue`), 두 새 프로세스가 동시에 G5 를 해도 한쪽만 종결한다 — 이중 처리 없음. 구 프로세스 공존은 코드가 아니라 배포 절차(F-14) 사항. `paper_fills` 중복: `UNIQUE(signal_id)` + 일반 INSERT + 1062 만 duplicate, 그 밖 오류는 잘라 넣지 않고 기록 실패(`paper-fill.ts:171`) — 변이 R33·R34 killed, 실 DB C-3(STRICT 1406)로 확인.
- [02:58] 항목 G 마이그레이션 SQL: 운영 `SHOW CREATE TABLE strategies` 를 그대로 만든 일회용 DB 에서 직접 2회 적용 — 두 번 다 exit 0, 기존 2행 모두 `unvalidated`, 컬럼 3개·`uq_paper_fills_signal` 1개(중복 없음), `UPDATE … 'BACKTESTED'` 는 `backtested` 로 정규화, 밖 값은 STRICT 에서 1265 거부. `COLLATE=utf8mb4_general_ci` 는 운영 테이블 전부와 같다(DB 기본은 unicode_ci — 명시가 맞다). `db.ts` setupDB 에 DDL 없음(`grep` 확인). 롤백 주석 2줄은 DB 시험 A-5 가 실행. 10.11 호환은 직접 못 돌렸다 — `ADD COLUMN IF NOT EXISTS`·`DROP COLUMN IF EXISTS`·ENUM·`DECIMAL(36,18)` 은 10.x 에서 지원되는 것으로 알고 있어 [가능성 높음], `AFTER enabled`(중간 위치)는 10.11 에서 INPLACE 재구성이라 16행에선 순간이며 메타데이터 락 5초 초과 시 오류로 끝나니 재시도하면 된다(R-12).
- [02:58] 항목 H Developer 가 보고한 설계 차이 6건 판정(Stage 2 의 15건 전부 훑음): ① 해외 가상 체결을 COMMIT 뒤에 기록 — 수용. 롤백 시 고아 행·교착(1213) 삼킴으로 인한 거짓 보고를 구조적으로 없앤다. 대가(커밋 뒤 기록 실패면 카드만 skipped 로 남고 가상 체결 유실, 프로세스가 둘 사이에 죽어도 같음)는 로그로 남고 안전과 무관. 시험으로 커밋 순서·롤백 시 0건 고정, 변이 R22·G2-4/5 killed. ② 반환 타입 `'blocked'` 추가 — 수용. 호출부 2곳(국내 `:635`·해외 `:751`)이 모두 처리하고 다른 호출자 없음(`grep`). ③ G5 lookup_error 는 종결하지 않고 이번 틱만 건너뜀 — 수용. 검증된 전략의 정상 행을 일시 장애로 영구 종결하지 않는 쪽이 옳고, 건너뛰는 동안 선점·주문·알림이 없어 fail-closed 가 유지된다(변이 R19·S04 killed). 영구 장애(컬럼 없음)면 행이 만료까지 남지만 막힌 채다. ④ G5 를 만료 처리 직후·시세 조회보다 앞에 둠 — 수용. 막힌 행에 KIS 시세를 부르지 않고 선점·주문·알림 0 이 시험으로 고정(변이 R17·R18 killed). ⑤ `paper_fills` 중복을 일반 INSERT + 1062 catch 로, 기존 id 조회 생략 — 수용. `INSERT IGNORE` 는 STRICT 데이터 오류까지 잘라 넣는 것을 실 DB 로 대조 확인했고 ODKU 는 FOUND_ROWS 에서 판정 불가. 조회 생략의 소비자는 현재 없음. ⑥ HTTP 403/503, 카드 `price_at_skip` 미기록 — 수용. T-070 은 `price` 를 읽고 `signal-followup` 은 `ai_skipped` 만 백필하므로 `skipped` 카드의 `price_at_skip` 은 소비자가 없다. 나머지 9건(#3 파라미터 위치, #9 G3·G4 위치, #13 관문 목, #14 모듈 그래프 등)도 수용하되 #14 는 R-11 로 남김. 수용 못 한 설계 차이는 없다.
- [02:58] 항목 I 특히 위험한 지점 — (1) 카드 INSERT 열 순서: SQL(`post-market-engine.ts:329-345`)을 열·SELECT 자리표시자·파라미터 배열 12개로 한 칸씩 직접 대조 — 열 13개(strategy_id, symbol, side, order_type, price, amount_krw, reasoning, indicators, expires_at, valid_from, market, scenario_source, status) ↔ SELECT `?,?,'buy','limit',?,?,?,?,?,?,?,'post-market',?`(자리표시자 10개) + NOT EXISTS 2개 = 12개 ↔ 배열 [strategyId, symbol, price, amountKrw, reasoning, indicatorsJson, expiresAt, validFrom, market, status, symbol, validFrom], 어긋남 없음. 어긋남을 잡는 시험은 있다 — 위치 교환 변이 4쌍(R23-R26)이 골든·post-market-engine·overseas·실 DB C-4 에서 9~14건씩 killed. (2) 기존 시험 4개의 관문 목: 골든·post-market-engine·overseas·confirm `route.test` 는 판정만 '검증됨'으로 고정하고(골든 GOLDEN 리터럴 diff 0, 목 7줄만 추가), 실제 관문은 신규 시험 4개가 실제 구현으로 본다 — 무의미화되지 않았다. 다만 골든이 보증하는 "국내 경로 바이트 동일"은 관문 판정 조회(검증된 전략당 `getPool` PK 1회)가 목에서 빠진 상태의 말이다(INFO). (3) `order-sizing` 승인 성공 시험 복원: 설계 기준이다 — 검증된 전략 행으로 4주·approved 를 그대로 단언하고 단언을 더 추가(주문 1건·정수 수량)했으며 귀속 없음 행의 validation_gate 시험을 따로 둠, 느슨해진 곳 없음. (4) 수량 0 가상 체결: 0 으로 남는다(`paper-fill.ts:150`, 마이그레이션 주석 "0 = 주문 불성립"). 지금 소비자가 없어 영향 0, 분석 때 거르는 장치는 없다 — R-5. (5) 정적 시험의 새 호출부 탐지: 직접 호출 추가는 호출부 고정 목록으로 잡히나(키 변이 R36·R37 killed) 별칭 import 는 놓친다 — R39 survived, R-2. (6) `engine-insufficient-cash.test.ts` 변경: 정당. append-only 의도(상대 순서 불변 + 끝에 2개 append)를 `indexOf(sell_proposal_preview) === indexOf(insufficient_cash) - 1` 과 꼬리 3개 정확 일치로 더 엄격히 고정했다. (7) `setCooldown` 불변: `git diff --text --numstat` 로 `cooldowns.ts` 는 추가 전용(삭제 0, `setCooldown` 블록 이후 70줄 추가)임을 확인. (8) ApprovalQueue 무반응: `ApprovalQueue.tsx:136-137` 은 응답을 읽지 않고 목록을 다시 불러올 뿐이라 거절돼도 행이 그대로 남고 문구가 안 보인다 — R-3.
- [02:58] 항목 K 문서·기록 정합: task 의 변경 파일 표는 실제 52경로와 일치(누락 0). 누락 기록: `docs/db-schema.md` 에 `paper_fills`·`strategies.validation_*` 없음, `agent-vault/10-Flow/board.md:265` 의 T-072 줄이 "WP-0 Stage 0 조사 중"으로 낡음, `20-Log/2026-10-23.md` 없음(Developer 가 허용 밖이라 남기지 않음 — Leader 몫). 코드 영향 없음 — R-10.
- [02:58] 지적 R-1 MINOR, 시험 공백 + 방어 심층: G1·G3 입구가 정확히 `=== 'buy'`(`validation-gate.ts:70`, `confirm/route.ts:126`)만 매수로 본다. `direction`(confirm 본문)·`side`(`POST /api/signals` 본문)는 런타임 검증이 없고, MariaDB ENUM 은 `'BUY'`·`'Buy'`·`'buy '` 를 `buy` 로 저장한다(일회용 DB 에서 세 값 모두 `side='buy'`·`side='buy'` 비교 참, 직접 확인). 결과: G3 에 `direction:'BUY'` 를 보내면 403 없이 NULL 귀속 `approved_pending_entry` 행이 만들어지고 다음 틱에 G5 가 superseded 로 종결한다(G5·G6 는 DB 의 canonical `buy` 로 판정). 자금 위험은 없다. 시험이 `side='BUY'` 를 "매수 아님"으로 못박아 둔 것(`validation-gate.test.ts:39`)은 어댑터 TR 선택(`req.side === 'buy'`)과 일치하는 의도이나 DB 행 생성 경로를 고려하지 않았다. 변이 S10(가드를 `!== 'sell'` 로 강화)이 시험을 통과 = 이 케이스 시험 없음. 권고: G1·G3 입구에서 side·direction 이 `buy|sell` 이 아니면 400 으로 거절(또는 소문자 정규화), 그 케이스 시험 추가. 이어지는 기존 결함(T-072 범위 밖, [가능성 높음]): `POST /api/signals` 에 `side:'BUY'` 를 주고 auto 모드면 `req.side` 가 대문자로 어댑터에 가 매도 TR 로 나갈 수 있다.
- [02:58] 지적 R-2 MINOR, 시험 사각지대: `submit-order-callsites.test.ts:85-93` 는 `import { submitOrder as so }` 의 로컬 별칭 호출을 못 센다(import specifier 를 허용 목록에 넣고 호출 이름만 'submitOrder' 로 센다). 변이 R39(service.ts 에 별칭으로 귀속 없는 신규 호출부 추가)가 전체 시험 통과(생존). 런타임은 귀속 미지정이 null 이라 G6 가 매수를 막으므로 즉시 위험은 아니나, 검증된 전략 ID 를 변수로 실어 보내는 신규 호출부는 못 잡는다. 같은 이유로 `const f = kis.createOrder; f(req)` 도 통과한다(어댑터 직접 호출 정적 검사가 호출식만 봄). 권고: ImportSpecifier 의 `propertyName`/별칭을 추적해 별칭 호출도 호출부로 세고, 별칭·구조분해로 `submitOrder`·`createOrder` 를 가져오는 것을 금지 단언에 추가.
- [02:58] 지적 R-3 MINOR, 운영 절차: 승인 UI 가 거절 응답을 안 읽는다(`ApprovalQueue.tsx:136-137`). 배포 시점에 남아 있는 `pending`·`awaiting_approval` 행(예: 전날 16:00 국내 post-market 이 만든 다음날 09:00~15:30 유효 카드, 평일 오전 배포라면 있을 수 있다 — 00:29 실측 0 은 그 시각 값일 뿐)은 승인 버튼을 눌러도 403 이고 화면은 그대로다. 텔레그램은 한국어 문구가 간다. 코드 결함은 아니고 F-14 ② 사전 확인("0행")이 그대로 배포 전제 조건이다. 권고: Deployer 가 0행이 아니면 만료까지 기다리거나 사용자에게 알린 뒤 사용자 승인 SQL 로 `superseded` 정리, 화면 거절 표시는 T-073(designer)로 연결.
- [02:58] 지적 R-4 MINOR, 시험 타입 오류 1건: `post-market-overseas.test.ts:820` 의 `db = {…}` 에 새 필수 필드(strategies·paperFills·paperThrows)가 빠졌다. jest(`@swc`)는 타입을 안 보고 프로젝트 tsc 는 시험을 제외해 숨는다. 이 시험은 관문 목('검증됨')이라 런타임 영향 0. 시험 포함 검사에서 저장소 기준선 시험 타입 오류가 이미 59건 있어(별개) 새로 생긴 1건만 T-072 몫. 권고: 필드 3개 추가.
- [02:58] 지적 R-5 MINOR, 분석 때 거를 것: `paper_fills.quantity = 0` 행(1주 가격 > 금액 — 실주문이었다면 `quantity_below_min` 으로 주문 불성립)이 그대로 쌓인다(`paper-fill.ts:150`, 수수료도 0). 소비자(T-070/T-064)가 아직 없어 영향 0이고 거르는 장치도 없다. 승률·기대값에서 제외할지는 분석 정의 사항이므로 권고: T-064/T-070 소비 쿼리에 `quantity > 0`(및 `fill_model`·`gate_reason` 별 층화)을 명시하거나 `executable` 파생 컬럼을 둔다.
- [02:58] 지적 R-6 INFO: Stage 0 F 의 "skipped 를 읽는 소비자 0"은 상태 지정 소비자 기준이고, 상태 무관 집계는 4곳이 새 `skipped` 감사 행을 센다 — `strategies/route.ts:16`(live_signal_count 7일), `analytics/strategies/route.ts:40`, `analytics/top-symbols/route.ts:33`(signal_count 만 늘고 skip_count 는 ai_skipped 만), `profit-engine/daily-bars-store.ts:178`(symbol 별 건수로 일봉 수집 대상 선정 — 의도에 부합). 안전 영향 없음, 화면 숫자가 늘어 보일 뿐.
- [02:58] 지적 R-7 INFO: G6 차단 상세에 DB 오류 문구 120자(`validation-gate.ts:137-144`)가 실려 `orders` 상세·trade_logs·경고 알림·`POST /api/orders` 400 본문에 나간다. 인증된 호출자 전용이며 비밀 값은 없으나 연결 오류면 내부 주소가 섞일 수 있다. 우선순위 낮음.
- [02:58] 지적 R-8 INFO, 첫 승급 때 결정할 신뢰 경계: `POST /api/signals` 는 `body.strategyId` 를 귀속으로 그대로 쓴다(`createSignal` 입력). 지금은 전 전략이 unvalidated 라 무해하나 첫 승급 이후엔 인증된 호출자가 승급된 전략 ID 를 붙여 수동 시그널을 만들 수 있다(룰이 발화하지 않았어도). 첫 승급 task 에서 이 입력의 허용 여부를 정할 것. 이어서 D-2 범위: 가상 체결은 G1·G2 에서만 만들어지고 G3(직접 작성 시나리오)·G4·G5·G6 에서 막힌 매수는 trade_logs 흔적만 있다 — F-3·F-13 과 일치하나 사용자 원문 "막힌 매수를 가상 체결로"의 해석 폭이므로 Leader 가 보고 때 명시 권고.
- [02:58] 지적 R-9 INFO: F-14 의 폐장 시간대 안전 근거는 "트리거가 없다"이고 `submitOrder` 본문에 장 시간 검사가 없음을 직접 읽어 확인했다(어댑터 두 파일은 장 시간 코드를 찾지 않았다). 구 프로세스 공존·마이그레이션 직후 사전 확인·pm2 상태 확인은 Deployer 필수 단계로 유지.
- [02:58] 지적 R-10 INFO: 문서·기록 정합은 항목 K 참조(db-schema.md 미갱신, board.md 낡음, 20-Log 없음).
- [02:58] 지적 R-11 INFO: `telegram-approval.ts` 가 한국어 문구 때문에 `validation-gate.ts`(→ `@/lib/db`)를 import 해 "DB 를 직접 import 하지 않는다"는 파일 머리말은 직접 import 기준으로만 참이고 모듈 그래프가 커졌다(호출은 없음, getPool 지연 생성). 문구 상수를 순수 모듈로 분리하면 해소.
- [02:58] 지적 R-12 INFO: 일회용 DB 가 11.8.8 이라 10.11.11 실측이 아니다(Developer·나 모두). 배포 직전 Deployer 가 운영 DB 에서 `ALTER` 전 `lock_wait_timeout`·MDL 대기를 감안해 오프아워 창에서 적용하고, 적용 직후 `SHOW CREATE TABLE`·`SELECT id, validation_status FROM strategies` 로 확인할 것.
- [02:58] 못 확인한 것: MariaDB 10.11 에서의 실행, 작업 트리에 타 세션 변경(jest.config.js·jest.setup-api-usage.js·api-usage·kis-http)을 합친 상태의 jest(격리 사본은 HEAD 설정), 실제 UI 토스트·텔레그램 메시지 렌더링, KIS 가 장 시간 외 주문을 어떻게 거절하는지, blue/green 컷오버 중 구 프로세스 공존, eslint(설정 없음), 시험 파일 전 줄 정독(제목·핵심 단언을 읽고 실행·변이로 검증).
- [02:59] 1차 결론(코드 CRITICAL 0, MAJOR 0): 안전 경로 설계 의도(D-1·D-2·F-1·F-2·F-4·F-15·F-16)가 코드와 시험으로 충족되고 변이 47/49 killed. 남은 지적은 전부 MINOR·INFO 이며 R-1·R-2·R-4 는 Developer 수정 후 재확인을 권고하나 판정을 막는 결함은 아니다. R-3 는 배포 전 조건(Deployer)이다. Codex 검토(C2) 지적은 이 뒤에 채택·오탐을 판정해 판정 줄을 갱신한다.
- [02:59] **최종 판정: PASS (scope: scripts/migrations/T-072-validation-gate.sql, src/lib/exchanges/types.ts, src/lib/safety/validation-gate.ts, src/lib/safety/dry-run.ts, src/lib/safety/__tests__/validation-gate.test.ts, src/lib/safety/__tests__/submit-order-validation-gate.test.ts, src/lib/safety/__tests__/submit-order-callsites.test.ts, src/lib/safety/__tests__/submit-order-sell-invariant.test.ts, src/lib/safety/__tests__/submit-order.test.ts, src/lib/signals/service.ts, src/lib/signals/paper-fill.ts, src/lib/signals/telegram-approval.ts, src/lib/signals/telegram-poller.ts, src/lib/signals/__tests__/service.test.ts, src/lib/signals/__tests__/service-cash-gate.test.ts, src/lib/signals/__tests__/service-validation-gate.test.ts, src/lib/signals/__tests__/order-sizing.test.ts, src/lib/signals/__tests__/paper-fill.test.ts, src/lib/signals/__tests__/approve-validation-gate.test.ts, src/lib/signals/__tests__/t072-disposable-mariadb.test.ts, src/lib/signals/__tests__/telegram-approval.test.ts, src/lib/signals/__tests__/telegram-poller-wiring.test.ts, src/lib/strategy/cooldowns.ts, src/lib/strategy/engine.ts, src/lib/strategy/eval-funnel-labels.ts, src/lib/strategy/post-market-engine.ts, src/lib/strategy/post-market-overseas.ts, src/lib/strategy/__tests__/cooldowns.test.ts, src/lib/strategy/__tests__/engine-insufficient-cash.test.ts, src/lib/strategy/__tests__/engine-validation-gate.test.ts, src/lib/strategy/__tests__/post-market-domestic-golden.test.ts, src/lib/strategy/__tests__/post-market-engine.test.ts, src/lib/strategy/__tests__/post-market-overseas.test.ts, src/lib/strategy/__tests__/post-market-validation-gate.test.ts, src/app/api/cron/entry-watcher/route.ts, src/app/api/cron/entry-watcher/__tests__/cash-precheck.test.ts, src/app/api/cron/entry-watcher/__tests__/claim.test.ts, src/app/api/cron/entry-watcher/__tests__/fakeSignalsDb.ts, src/app/api/cron/entry-watcher/__tests__/sizing.test.ts, src/app/api/cron/entry-watcher/__tests__/validation-gate.test.ts, src/app/api/orders/route.ts, src/app/api/orders/__tests__/route.test.ts, src/app/api/signals/route.ts, src/app/api/signals/[id]/approve/route.ts, src/app/api/signals/__tests__/approve-route.test.ts, src/app/api/signals/__tests__/route-insufficient-cash.test.ts, src/app/api/signals/custom/confirm/route.ts, src/app/api/signals/custom/confirm/__tests__/route.test.ts, src/app/api/signals/custom/confirm/__tests__/validation-gate.test.ts, src/app/api/analyst/run/route.ts, src/app/api/analyst/run/__tests__/route.test.ts, src/app/api/strategies/[id]/route.ts, src/app/api/strategies/[id]/__tests__/route.test.ts)**
- [03:27] 2차 감사(WP-2c, Stage 3 재검증) 방법: 1차 때 쓴 목록과 `git status` 를 다시 대조해 1차 이후 바뀐 T-072 파일을 `cmp` 로 찾았다 — 코드 4(`validation-gate.ts`·`custom/confirm/route.ts`·`service.ts`·`entry-watcher/route.ts`) + 시험 8(`submit-order-callsites`·`validation-gate`·`submit-order-sell-invariant`·`service-validation-gate`·`approve-validation-gate`·confirm `validation-gate`·entry-watcher `validation-gate`·`post-market-overseas`) + `docs/db-schema.md` 신규 = 13개, Developer 표와 일치하고 빠진 파일 없음(1차 이후 `dry-run.ts` 등 나머지 39개는 1차 사본과 바이트 동일). 그 밖의 `M` 경로(api-usage·kis-http·llm·notify·auth·fx·mail·rag·ai-filter 등)는 타 세션 것이라 열지도 근거로 쓰지도 않음. 새 격리 사본 `scratchpad/t072-iso-rev2` = `git archive HEAD` + T-072 53경로(작업 트리와 cmp 차이 0). 변이 뒤 원복·바이트 대조 0 차이, 일회용 DB 컨테이너(`127.0.0.1:33173`, 11.8.8) 제거 확인.
- [03:27] 항목 1 직접 재현 수치(Developer 와 전부 같다): `tsc --noEmit` 0 오류. 시험 포함 타입 검사는 Developer 의 `tsconfig.t072-tests.json`(프로젝트 설정 상속·`files`·`types: jest,node`·`incremental:false`) 방식을 읽고, 내 목록의 T-072 시험 33개로 직접 만든 동일 방식 설정에서 0 오류. 더 넓게 `src/**` 시험까지 전부 넣은 검사는 저장소 기준선 시험 타입 오류 59건이 그대로이고 T-072 파일 안에는 0건(1차의 `post-market-overseas.test.ts:820` 오류 해소 확인). jest 전체 221 suites 통과 + 1 skipped, 5,369 통과 / 17 skipped / 5,386. 일회용 DB env 를 켠 전체 222/222 suites, 5,386/5,386.
- [03:27] 항목 2 R-1 의미: `isSellSide`(`validation-gate.ts:72-80`)는 `String(side).trim().toLowerCase() === 'sell'` 이고 문자열화가 던지면 false(= 매수 판정). 격리 사본에서 25종 입력을 직접 돌려 확인 — `sell`·`SELL`·` sell `·`Sell\n`·`sell`+NBSP 는 매도(조회 0, `getPool` 미호출), `buy`·`BUY`·`buy `·`purchase`·빈 문자열·null·undefined·0·NaN·true·Symbol·BigInt·`toString` 이 던지는 객체·null-prototype 객체·`sell-buy`·`sells`·전각 `ｓｅｌｌ` 는 전부 매수로 판정(미검증 전략이면 차단, 조회 1회)이고 어느 입력도 던지지 않는다. 이상한 값 둘: 배열 `['sell']`·`toString()` 이 `'sell'` 을 돌려주는 객체는 매도로 통과하는데, 하류(ENUM 저장·어댑터 TR 선택)가 그 값을 항상 매도로 다루므로 매수로 새는 길은 없다(INFO). 6개 관문 지점이 이 중앙 함수만 쓰는지 `grep` 으로 직접 확인: `evaluateValidationGate(` 호출은 `service.ts:474`(G1)·`:703`(G4)·`custom/confirm/route.ts:128`(G3)·`entry-watcher/route.ts:270`(G5)·`post-market-engine.ts:319`(G2, 리터럴 `'buy'`)·`dry-run.ts:224`·`:241`(G6) 뿐이고, 이 호출들 주변에 남은 지역 `=== 'buy'`·`!== 'sell'` 분기는 없다. 관문과 무관한 `=== 'buy'`·`!== 'sell'` 는 남아 있다 — T-058 현금 게이트(`service.ts:482`, `signal-cash-gate.ts:218`), 호가 추격 방향(`service.ts:279`), entry-watcher 추격·현금 점검(`:404`·`:450`), 한도 면제(`dry-run.ts:192·202·211`) — 이것이 아래 항목 6 의 부수 영향이다. 보호 청산: 엔진 청산은 리터럴 `side: 'sell'`(`exit-engine.ts:204`)이라 `hard_stop`/`eod_loss_cut` 강제 auto 매도는 영향 없음. 변형 매도(`SELL`·` sell `·`Sell`)는 G1(생성, 조회 0)·G3(확정 200)·G4(승인 → 선점 → 주문)·G5(감시 → 주문)·G6(송신) 시험으로 고정돼 있고 변이 W01-W03 이 모두 killed. 변형 매수(`BUY`·`Buy`·`buy `·` BUY`·`purchase`)는 G1(차단·감사 행)·G3(403·행 0·연결/락 0)·G4(선점 0)·G5(superseded)·G6(차단)에서 매수로 판정돼 막힌다.
- [03:27] 항목 3 'not_applicable' 변경: 매도 I/O 0 불변식은 약해지지 않았다. 불변식 보증이 호출부의 지역 분기 두 겹(G3·G4·G5)에서 중앙 함수 첫 줄 한 곳으로 옮겨졌고, 매도 호출이 함수를 부르게 됐지만 그 호출은 `getPool` 을 부르지 않는다(25종 프로브에서 매도 변형 전부 lookups 0, 단위 시험이 `getPool` 미호출을 단언). 그 한 줄을 지키는 시험은 모든 지점에 있다 — G6 8조합+변형 3종(`strategyLookups` 0), G1 변형 매도 3종, G3 매도 4종, G4 매도·하이브리드, G5 매도·변형 `SELL` 이 `not_applicable` 반환값 자체와 조회 0 을 단언. 변이로 확인: 매도 판정 앞에 `getPool().query` 삽입(W08)은 105개 시험이 실패해 killed, `isSellSide` 예외를 매도로(W07)·부분 일치(W06)·정규화 제거(W01-W03)·`buy` 아님→허용 복원 2종(W04·W05)도 모두 killed. 대가는 한 점이다: 이제 이 함수 하나가 틀리면 6개 지점의 매도가 동시에 영향을 받는다(전에는 G3~G5 가 지역 분기로 피해 갔다) — 그래서 위 시험이 지점마다 중복으로 있는 것이 필요하고 실제로 있다.
- [03:27] 항목 4·5 내 변이(2차) 23개를 `run3.py`·`mutations3.py`·`mutations3b.py` 로 새로 적용 — 21개 killed, 2개 survived. killed: 정규화 제거 3종(전체·trim·소문자) · `buy` 아님→허용 복원(원 형태·정규화 후) · 부분 일치 · 예외를 매도로 · 매도 판정 앞 I/O · G1·G3·G4·G5 지역 `=== 'buy'` 분기 복원 각 1(8·9·9·6개 시험 실패) · G3 에서 `BUY` 가 403 이 아닌 경로 · G2 카드를 sell 로 판정 · 별칭 import+귀속 없는 호출부(R39 재현) · `const f = submitOrder` · `export { submitOrder as sendOrder } from` · `const g = kis.createOrder` · 요소 접근 `dr['submitOrder'](…)` · 구조분해 `const { submitOrder: so2 } = await import(…)` · G6 두 판정을 함께 `buy` 정확 일치로(W23). survived 2개는 W14·W15: G6 의 DRY_RUN 앞 판정만, 또는 송신 직전 판정만 `req.side === 'buy' ? 'buy' : 'sell'` 로 바꾸면 변형 매수가 통과해야 하는데 시험이 전부 통과한다 — 두 판정이 서로를 가려서(DRY_RUN=false 에서 하나가 풀리면 다른 하나가 막는다) 단독 변이가 등가가 되고, 둘을 함께 바꾸면(W23) 3개 시험이 실패한다. 남는 진짜 공백은 R2-1 로 적는다. 1차 때 살아남았던 변이: S10(G3 입구 대소문자)은 W10·W13 과 G3 변형 매수 403 시험(5종)으로 포착됨, R39(별칭 호출)는 W17 로 3개 시험이 포착(별칭 금지·호출부 목록·귀속 누락)함 — 둘 다 해소.
- [03:27] 항목 7 `docs/db-schema.md`(+54줄) 대조: `strategies` 3열(`validation_status` ENUM('unvalidated','backtested','paper_validated') NOT NULL DEFAULT 'unvalidated'·`validation_changed_at` DATETIME NULL·`validation_evidence` VARCHAR(255) NULL)과 `paper_fills` 22열 전부(타입·NULL·기본값·`UNIQUE uq_paper_fills_signal`·`idx_pf_strategy`·`idx_pf_symbol`·콜레이션 `utf8mb4_general_ci`)가 마이그레이션 SQL 과 한 줄씩 일치한다. 설명 문장도 코드와 맞다 — `quantity` 0 은 1주 가격 > 시그널 금액(`paper-fill.ts:150`, 실주문이었다면 `quantity_below_min`), NULL 은 시장가 등 미확정, 수량 0 이면 수수료 0(`:152-153`), 엔진 경로만 쿨다운 선점으로 빈도가 실 경로와 같고 `api_signals`·`analyst_run` 은 호출마다 1행, 코드가 먼저 나가면 컬럼 없음 → 조회 오류 → 매수 차단, 승급은 사용자 SQL 로만이고 `PATCH` 는 이 열을 받지 않음. R-5 의 `quantity > 0` 필터 주의가 명시돼 있다. 틀린 곳 없음(옛 설계 표가 실제와 다르다는 안내도 정확).
- [03:27] 지적 R2-1 MINOR, 시험 공백: G6 변형 side 시험이 `DRY_RUN=false` 만 본다. 변형 매수(`BUY`) + `DRY_RUN=true` 를 단독으로 통과시키는 변이(W14)와, 첫 판정 뒤 강등된 상태에서 변형 매수를 송신 직전에 놓치는 변이(W15)는 현재 시험으로 못 잡는다(둘 다 survived). 영향은 낮다 — G1~G5 가 앞에서 막고 변형 매수가 G6 에 오는 정상 경로가 없으며 DRY_RUN=true 는 실송신이 없다. 권고: `submit-order-validation-gate.test.ts` 의 DRY_RUN 행렬(`:114-134`)에 변형 side(`BUY`·`buy `)를 추가하고, 송신 직전 재검증 시험(`:172-190`)을 변형 side 로 한 번 더 돌린다.
- [03:27] 항목 6 Developer 가 남긴 위험 — 코드로 확인함 [확실, 직접 실행]: 검증된 전략(`backtested`) 귀속으로 `submitOrder` 에 `side: 'BUY'`·`'Buy'`·`'buy '` 를 주면 G6 를 통과하고 `realSubmit`(= `kis.createOrder`)이 원문 그대로 `'BUY'` 를 받는다(격리 사본 임시 프로브, 4개 입력 모두 `ok=true`). 어댑터는 `const isBuy = req.side === 'buy'`(`kis-domestic.ts:293`, `kis-overseas.ts:575`)라 매도 TR 을 고른다. 반면 `'purchase'`·빈 문자열은 `orders.side` ENUM 에 STRICT 로 1265 를 던져 송신 전에 끝난다(일회용 DB 로 직접 확인: `BUY` 는 `buy` 로 저장, `purchase`·`''` 는 거부) — 즉 실제로 새는 값은 `buy` 의 대소문자·뒤 공백 변형뿐이다. 도달 경로는 `side` 가 DB 를 거치지 않고 `OrderRequest` 로 직행하는 곳, 곧 `POST /api/signals` 의 자동 제출(`createSignal` → `buildOrderRequest(input)`: `autopilot_mode=auto` 또는 `exit_kind` 강제 auto)이다. 승인·진입 감시·확정은 DB 에서 읽은 canonical `buy` 라 해당 없고, `POST /api/orders` 는 귀속이 null 이라 계속 차단이다. 부수 영향: `'BUY'` 는 T-058 현금 게이트(`service.ts:482`)와 호가 추격 방향(`:279`)도 건너뛴다. 피해 형태는 "의도한 매수가 매도 TR 로 나감"(보유분 의도치 않은 청산, 미보유면 KIS 거절)이고 신규 매수 노출은 아니다. 의견: 첫 승급 전 선행 조건으로 두는 것만으로는 부족하다고 본다 — ① 지금 모든 전략이 unvalidated 라 도달 불가인 것은 맞지만 승급은 사용자 SQL 한 줄로 즉시 활성화되고 그 순간 검증 없이 잠복 결함이 켜진다. ② 이 task 가 만드는 불변식("G6 통과 = 관문이 판정한 그 주문이 나간다")이 변형 side 에서 깨진다(관문은 매수로 판정, 어댑터는 매도 TR). ③ 이 프로젝트의 D5 자체가 문서 규칙으로만 있다가 2.5개월 코드가 없던 전례가 있다. ④ 수정이 작다. 권고(별도 소작업, 이 task 안): `POST /api/signals`·`POST /api/orders`·`custom/confirm` 입구에서 side/direction 을 trim+소문자로 정규화하고 `buy`/`sell` 이 아니면 400, 그리고 방어선으로 `submitOrder` 가 `req.side` 를 같은 정규화로 확정해(변형 매도는 `sell` 로 정규화해 보호 청산을 유지) 어댑터·한도 면제·현금 게이트가 canonical 값을 보게 하고 알 수 없는 값은 송신 전 blocked. 보호 청산은 건드리지 않는다(엔진 청산은 리터럴 `sell`). 최소 대안은 "첫 승급 task 의 착수 조건으로 변형 side 시험 통과를 못박는 것"이며 허용 가능하나 비권장. 이 판정을 막는 사항은 아니다(도달 불가).
- [03:27] 지적 R2-2 INFO: `'SELL'` 변형 매도는 관문은 통과하나 `dry-run.ts:192·202·211` 의 한도 면제(`!== 'sell'`)를 못 받아 1회·일일 한도·변동성 가드가 걸린다(기존 동작, Developer 도 인지). 엔진 청산·승인·진입 감시는 canonical 값이라 영향 없고 raw 클라이언트 입력(`POST /api/signals`·`/api/orders`)에서만 해당 — R2-3 입구 정규화로 같이 해소된다.
- [03:27] 지적 R2-3 INFO, 정적 시험 잔여 사각: W21 은 killed 됐지만 요소 접근 호출(`dr['submitOrder'](…)`)을 호출부로 세어서가 아니라 두 번째 인자 `kis.createOrder` 참조 금지 규칙에 부수로 걸렸다. 호출부 판정이 식별자·속성 접근 이름만 보므로 요소 접근 + `kis.createOrder` 가 아닌 인자를 쓰는 호출은 통과할 수 있다 [가능성 높음, 코드 읽기 기준·미실행]. 위험은 낮고(귀속 없으면 G6 가 막음) R-2 의 본래 지적(별칭·재수출·`const f`)은 해소됐다.
- [03:27] 1차의 나머지 지적은 이번 범위가 아니었고 그대로다: R-3(승인 UI 가 거절 응답을 안 읽음, 배포 전 `pending`·`awaiting_approval` 0행 사전 확인은 Deployer 필수), R-5(`docs` 에 필터 주의가 들어가 문서 측은 해소, 소비 쿼리는 T-064/T-070 몫), R-6~R-12 INFO. 코드 CRITICAL 0, MAJOR 0 — R-1·R-2·R-4 해소 확인, 새 지적은 MINOR 1(R2-1)과 INFO 2(R2-2·R2-3), 그리고 항목 6 은 판정을 막지 않는 수정 권고. Codex 검토(C2) 지적은 이 뒤에 채택·오탐을 판정해 판정 줄을 갱신한다.
- [03:28] **최종 판정: PASS (scope: scripts/migrations/T-072-validation-gate.sql, docs/db-schema.md, src/lib/exchanges/types.ts, src/lib/safety/validation-gate.ts, src/lib/safety/dry-run.ts, src/lib/safety/__tests__/validation-gate.test.ts, src/lib/safety/__tests__/submit-order-validation-gate.test.ts, src/lib/safety/__tests__/submit-order-callsites.test.ts, src/lib/safety/__tests__/submit-order-sell-invariant.test.ts, src/lib/safety/__tests__/submit-order.test.ts, src/lib/signals/service.ts, src/lib/signals/paper-fill.ts, src/lib/signals/telegram-approval.ts, src/lib/signals/telegram-poller.ts, src/lib/signals/__tests__/service.test.ts, src/lib/signals/__tests__/service-cash-gate.test.ts, src/lib/signals/__tests__/service-validation-gate.test.ts, src/lib/signals/__tests__/order-sizing.test.ts, src/lib/signals/__tests__/paper-fill.test.ts, src/lib/signals/__tests__/approve-validation-gate.test.ts, src/lib/signals/__tests__/t072-disposable-mariadb.test.ts, src/lib/signals/__tests__/telegram-approval.test.ts, src/lib/signals/__tests__/telegram-poller-wiring.test.ts, src/lib/strategy/cooldowns.ts, src/lib/strategy/engine.ts, src/lib/strategy/eval-funnel-labels.ts, src/lib/strategy/post-market-engine.ts, src/lib/strategy/post-market-overseas.ts, src/lib/strategy/__tests__/cooldowns.test.ts, src/lib/strategy/__tests__/engine-insufficient-cash.test.ts, src/lib/strategy/__tests__/engine-validation-gate.test.ts, src/lib/strategy/__tests__/post-market-domestic-golden.test.ts, src/lib/strategy/__tests__/post-market-engine.test.ts, src/lib/strategy/__tests__/post-market-overseas.test.ts, src/lib/strategy/__tests__/post-market-validation-gate.test.ts, src/app/api/cron/entry-watcher/route.ts, src/app/api/cron/entry-watcher/__tests__/cash-precheck.test.ts, src/app/api/cron/entry-watcher/__tests__/claim.test.ts, src/app/api/cron/entry-watcher/__tests__/fakeSignalsDb.ts, src/app/api/cron/entry-watcher/__tests__/sizing.test.ts, src/app/api/cron/entry-watcher/__tests__/validation-gate.test.ts, src/app/api/orders/route.ts, src/app/api/orders/__tests__/route.test.ts, src/app/api/signals/route.ts, src/app/api/signals/[id]/approve/route.ts, src/app/api/signals/__tests__/approve-route.test.ts, src/app/api/signals/__tests__/route-insufficient-cash.test.ts, src/app/api/signals/custom/confirm/route.ts, src/app/api/signals/custom/confirm/__tests__/route.test.ts, src/app/api/signals/custom/confirm/__tests__/validation-gate.test.ts, src/app/api/analyst/run/route.ts, src/app/api/analyst/run/__tests__/route.test.ts, src/app/api/strategies/[id]/route.ts, src/app/api/strategies/[id]/__tests__/route.test.ts)**
- [03:55] 3차 감사(WP-2d, Stage 4 재검증) 방법: 2차 사본(`t072-iso-rev2`)과 작업 트리를 `cmp` 로 대조해 바뀐 T-072 파일을 찾았다 — 코드 7(`validation-gate.ts`·`dry-run.ts`·`exchanges/types.ts`·`service.ts`·`signals/route.ts`·`orders/route.ts`·`custom/confirm/route.ts`) + 시험 8(`submit-order-validation-gate`·`submit-order-sell-invariant`·`submit-order-callsites`·`service-validation-gate`·confirm `validation-gate`·confirm `route.test`·`route-insufficient-cash`·orders `route.test`) = 15개, Developer 표와 일치하고 빠진 파일 없음. 이번 라운드에 새로 생긴 T-072 파일은 없고 누적 53경로가 그대로다(`git status` 의 나머지 `M`·`??` 경로는 타 세션 것이라 열지도 근거로 쓰지도 않음). 새 격리 사본 `scratchpad/t072-iso-rev3` = `git archive HEAD` + 53경로(cmp 차이 0). 변이 뒤 원복·바이트 대조 0 차이, 일회용 DB 컨테이너(`127.0.0.1:33174`, 11.8.8) 제거 확인.
- [03:55] 항목 1 직접 재현 수치(Developer 와 전부 같다): `tsc --noEmit` 0 오류. 시험 포함 타입 검사(내 T-072 시험 33개 `files` 설정, `types: jest,node`) 0 오류. jest 전체 221 suites 통과 + 1 skipped, 5,424 통과 / 17 skipped / 5,441. 일회용 DB env 를 켠 전체 222/222 suites, 5,441/5,441.
- [03:55] 항목 2 정규화 의미: `submitOrderInner` 의 본문(`const pool` 이후 전부)은 2차 사본과 `diff` 한 결과 바뀐 줄이 없고 변경은 맨 앞 4줄과 `rejectInvalidSide` 추가뿐이다(`dry-run.ts:131-145`). 정확한 `'buy'`/`'sell'` 입력은 `req = rawReq` 로 **같은 객체**가 그대로 흐른다(`side === rawReq.side ? rawReq : {…}`) — `normalizeOrderSide` 는 순수 함수라 추가 I/O·분기 차이가 없고, 호출자 객체를 변조하지 않는다(변형 입력만 얕은 복사본으로 교체; `clientOrderId` 생성이 몇 줄 앞으로 옮겨진 것이 유일한 순서 차이이고 값·부작용 동일). `createSignal` 도 같은 패턴(`input = side === rawInput.side ? rawInput : {…}`), 입구 3곳은 정확한 값이면 같은 값을 넘긴다. 정규화 전/후 값이 어긋나는 호출부는 없다 — 3개 호출부는 `submitOrder` 뒤에 원본 `orderReq.side` 를 쓰지 않고(`grep` 0), 알림 문구·한도·T-051 현금 점검(`entry-watcher:450`)·추격 방향(`:404`)·`setPositionScenarioExit` 은 모두 DB 에서 읽은 canonical `row.side`(ENUM 은 항상 소문자 canonical)나 정규화된 `input.side`/`side` 를 쓴다. 정상 입력의 회귀 근거는 기존 시험 통과가 아니라 위 본문 `diff` 0 과 "같은 객체" 흐름이다. 알 수 없는 값은 이전에 orders ENUM STRICT 1265 예외가 던져지던 것을 명시적 `ok:false`(orders 0·거래소 0)로 바꾼 것이 유일한 동작 변경이다.
- [03:55] 항목 3 새 fail-open 여부: 없다. 정규화가 orders INSERT·한도·G6 두 판정·어댑터보다 앞이고, 정확히 buy/sell 이 아니면(비문자열·`['buy']`·`purchase`·빈 문자열·ZWSP 붙은 값 포함) 거기서 끝나 관문까지 오지 않는다(변이 X03 알 수 없는 값 허용 → 10개 실패, X21 알 수 없는 값을 sell 로 → 16개 실패). 관문 함수(`isSellSide`)는 그대로라 매도(`SELL`·` sell ` 변형은 정규화돼 `'sell'` 로 넘어가 한도 면제까지 받는다)는 strategies 조회 0이고 보호 청산 시험(G6 변형 매도 3종·1회 한도 초과 금액도 송신)이 유지된다 — 변이 X22(변형 매도를 거절) killed. `invalid_side` 종결은 던지지 않는다: `rejectInvalidSide`(`dry-run.ts:172-181`)는 `JSON.stringify` 를 try 로 감싸고, `auditLog` 는 자체 try/catch(`:378-388`)로 DB 오류를 삼키며, `sendAlert` 는 `void dispatchAlert(...).catch` 라 동기·무예외다(변이 X18 던짐 → 10개 실패). 반환에 `orderId` 가 없어 호출부 3곳은 기존 "확정 거부" 분기로 가지만 셋 다 canonical 값만 넘기므로 평소 도달하지 않는다. 참고로 `createSignal` 자동 제출 경로는 원래부터 `orderResult.ok` 를 보지 않고 `ok:true` 를 돌려준다(차단 결과도 같음, 기존 동작·이번 범위 밖).
- [03:55] 항목 4 기대값을 바꾼 기존 시험 2곳 판정: (a) T-052 R-8(`confirm/__tests__/route.test.ts:1065-1076`) side 저장 기대 `'BUY'`→`'buy'` — 정당(강화·변경 아님으로 본다). 그 시험의 목적은 "철자만 다른 같은 종목·방향이 같은 락 이름을 쓴다"이고 `names[0] === names[1]` 단언은 그대로이며, symbol 저장값은 요청 그대로라는 단언도 유지된다. 바뀐 것은 mock 파라미터의 side 뿐인데, 시험 주석이 "저장값 정규화는 별개 변경"이라고 미뤄 둔 바로 그 변경을 이 task 가 한 것이고, 실제 DB 에서는 ENUM 이 `'BUY'` 를 이미 `buy` 로 저장해 왔다(1차에서 직접 확인) — 저장된 값은 이전과 같다. 하류 영향 없음: `confirmLockName` 은 이미 trim+소문자 정규화 해시(`custom-confirm-guard.ts:113-117`), 중복 조회 `symbol = ? AND side = ?` 는 general_ci 라 `'BUY'`/`'buy'` 를 같게 비교해 왔다. 오히려 락 이름 외의 경로에서 원문이 섞이던 불일치가 사라진다. (b) WP-2c 의 `'purchase'` 를 매수 판정(차단)에서 `invalid_side`/`invalid_input`/400 으로 — 정당한 강화. 둘 다 orders·시그널·감사 행·거래소 0 으로 끝나 안전 결과는 같거나 더 이르다. 잃는 것은 하나뿐: 예전엔 G1 이 알 수 없는 값을 매수로 보고 `skipped` 감사 행·가상 체결을 남겼는데 이제는 남기지 않는다 — 잘못된 입력은 전략 신호가 아니므로 검증 데이터로 쓰지 않는 쪽이 맞다. 관문 함수 단위 시험은 `purchase`·빈 문자열 등을 여전히 매수로 판정하는 것을 고정하고 있어 G4/G5 같은 DB 경유 경로의 fail-closed 는 그대로다. 설계 F-1~F-16·사용자 결정(D-1 전부 차단, D-2 가상 체결)과 충돌하지 않는다.
- [03:55] 항목 5 내 변이(3차) 24개를 `run4.py`·`mutations4.py` 로 새로 적용 — 대조 1개(X13, 정규화 유지 + G6 한 판정만 정확 buy = 등가라 생존이 정상)를 뺀 23개 중 22개 killed, 1개 survived. killed: `submitOrder` 정규화 제거 · 어댑터에 원문 side 전달 · 알 수 없는 side 허용(송신 도달) · `createSignal` 정규화 제거 · `createSignal` 알 수 없는 값 허용 · API 3곳 400 검증 각각 제거(3) · `/api/signals`·`/api/orders` 가 원문 전달(2) · **W14·W15 재현 — 정규화 제거 + G6 한 판정만 정확 buy 가 이제 각각 22개·20개 시험 실패로 포착됨(X11·X12)** · 요소 접근 호출 `dr['submitOrder'](…)`(`kis.createOrder` 인자·임의 인자 2종 모두) · `kis['createOrder']` · `invalid_side` 에서 orders 행 생성 · 거기서 던짐 · 경고 제거 · `normalizeOrderSide` 비문자열 수용·소문자화 제거·알 수 없는 값을 sell·변형 매도 거절. survived: X23 — `submitOrder` 가 복사 대신 호출자 `req` 를 직접 고쳐도 시험이 통과한다. 호출부가 이후 원본 side 를 쓰지 않아 실제 영향은 없으나 "호출자 객체 불변" 을 고정하는 시험이 없다(R3-1). 1차·2차 survivor 처리: S10·R39(1차)는 2차에서 포착 확인됐고, W14·W15(2차)와 R2-3(요소 접근 잔여 사각)은 이번에 포착 확인.
- [03:55] 항목 6 커밋 훅 점검(읽기만, 훅 실행 없음): `scripts/git-hooks/commit-msg` 의 `reviewer_body()` 는 `/^##+[ \t]/` 로 헤딩을 잡고 제목에 reviewer 가 들어가면 그 구간을 Reviewer 본문으로 읽는다 — 소제목 `####` 도 잡는다는 Developer 주장이 맞다. 이 파일에서 그렇게 읽히는 헤딩은 정확히 5개: 448·507·530·578행의 Developer 소제목 4곳(Stage 1 §6·Stage 2 §2·§4·Stage 3 §4, 제목에 "Reviewer 독립 재현 필요/판단 필요")과 `## Reviewer`(654행)이다. Stage 4 소제목은 "감사자"라 해당 없음. 그 4곳 본문에는 판정 문구도 대문자 판정 단어도 없다(`awk`+`/usr/bin/grep` 으로 확인; 이 샌드박스의 `grep` 은 별칭 함수라 GNU grep 으로 따로 돌림). 판정 문구가 들어간 줄: Reviewer 본문 안은 내 판정 줄뿐이다 — 683행(1차)·695행(2차)에 이어 이번 마지막 줄이 3번째이고 훅은 마지막 줄 하나만 쓰므로 유효 판정은 이번 줄 하나다. 앞의 두 줄이 대문자 리터럴을 계속 갖고 있으니 "하나뿐"을 원하면 Leader 가 두 줄의 문구를 낮추면 된다(나는 덧붙이기만 한다). Reviewer 본문 밖에서 훅이 오인할 줄은 없지만 위치를 알린다: 652행(Developer Stage 4 "기록 위생" 불릿, 판정 문구가 산문으로 있음 — `####` 제목에 reviewer 단어가 없어 훅이 읽지 않음)과 89행(`## 단계` 절의 "스스로 (대문자 판정 단어) 를 적지 않는다" 문장, 대문자 판정 단어가 산문에 있음 — 역시 Reviewer 본문 밖이라 훅은 무시하나 소문자 관례와는 어긋남). 그 밖에 Reviewer 본문 바깥 대문자 판정 단어는 없다.
- [03:55] 항목 7 열린 지적 처리 상태: R-1(입구 대소문자) 해소 — 입구 3곳 정규화+400, `createSignal`·`submitOrder` 정규화, 관문은 매도만 통과 · R-2(정적 시험 별칭) 해소(WP-2c) · R-3(승인 UI 가 거절 응답을 안 읽음) 미해소 — 코드 범위 밖, 배포 전 `pending`·`awaiting_approval` 0행 사전 확인(Deployer)과 화면 표시(T-073) 몫 · R-4(시험 타입 오류) 해소(WP-2c, 이번에도 0 오류) · R-5(`quantity=0` 분석 필터) 문서 측 해소(`docs/db-schema.md`), 소비 쿼리는 T-064/T-070 몫 · R2-1(G6 한 판정 변이) 해소 — 정규화 선행으로 단독 변이는 등가가 됐고(X13) 정규화를 뺀 재현 X11·X12 가 각각 포착됨 · R2-2(`SELL` 한도 면제) 해소 — 정규화 후 `'sell'` 로 한도 면제를 받음 · R2-3(요소 접근 잔여 사각) 해소(X14·X15·X16 killed) · R-6~R-12 INFO 는 이번 범위 밖 그대로(R-8 의 `POST /api/signals` 가 `body.strategyId` 를 귀속으로 쓰는 신뢰 경계는 첫 승급 task 에서 결정, R-7 오류 문구 노출, R-11 모듈 그래프, R-12 10.11 미실행 포함). 항목 6(검증된 전략의 `BUY` → 매도 TR)은 해소 — 3번 입구가 정규화하고 `submitOrder` 가 마지막으로 보장해 어댑터는 정확한 `'buy'`/`'sell'` 만 받는다(변이 X01·X02 killed). 어댑터 자체는 여전히 `=== 'buy'` 만 보므로 방어는 `submitOrder` 입구에 있고, 우회는 정적 시험(호출부·별칭·요소 접근·`createOrder` 참조 고정)이 막는다.
- [03:55] 지적 R3-1 INFO, 시험 공백: `submitOrder`·`createSignal` 이 호출자 객체를 변조하지 않는다는 시험이 없다(변이 X23 survived). 현재 호출부는 이후 원본 side 를 쓰지 않아 영향 0이므로 막지 않는다. 권고: 변형 입력 시험에서 호출 전후 원본 객체의 `side` 가 그대로인지 한 줄 단언 추가.
- [03:55] 못 확인한 것: MariaDB 10.11 실행, 타 세션 변경과 합친 상태의 jest, 실제 UI·텔레그램 렌더링, KIS 실제 거절 동작, blue/green 구 프로세스 공존, eslint(설정 없음), 시험 파일 전 줄 정독(변경분 diff·핵심 단언을 읽고 실행·변이로 검증). 코드 CRITICAL 0, MAJOR 0, 새 지적은 INFO 1(R3-1) 뿐이다. judge C2 → Codex 검토가 이어지며 Codex 지적의 채택·오탐은 그때 판정해 판정 줄을 갱신한다.
- [03:56] **최종 판정: PASS (scope: scripts/migrations/T-072-validation-gate.sql, docs/db-schema.md, src/lib/exchanges/types.ts, src/lib/safety/validation-gate.ts, src/lib/safety/dry-run.ts, src/lib/safety/__tests__/validation-gate.test.ts, src/lib/safety/__tests__/submit-order-validation-gate.test.ts, src/lib/safety/__tests__/submit-order-callsites.test.ts, src/lib/safety/__tests__/submit-order-sell-invariant.test.ts, src/lib/safety/__tests__/submit-order.test.ts, src/lib/signals/service.ts, src/lib/signals/paper-fill.ts, src/lib/signals/telegram-approval.ts, src/lib/signals/telegram-poller.ts, src/lib/signals/__tests__/service.test.ts, src/lib/signals/__tests__/service-cash-gate.test.ts, src/lib/signals/__tests__/service-validation-gate.test.ts, src/lib/signals/__tests__/order-sizing.test.ts, src/lib/signals/__tests__/paper-fill.test.ts, src/lib/signals/__tests__/approve-validation-gate.test.ts, src/lib/signals/__tests__/t072-disposable-mariadb.test.ts, src/lib/signals/__tests__/telegram-approval.test.ts, src/lib/signals/__tests__/telegram-poller-wiring.test.ts, src/lib/strategy/cooldowns.ts, src/lib/strategy/engine.ts, src/lib/strategy/eval-funnel-labels.ts, src/lib/strategy/post-market-engine.ts, src/lib/strategy/post-market-overseas.ts, src/lib/strategy/__tests__/cooldowns.test.ts, src/lib/strategy/__tests__/engine-insufficient-cash.test.ts, src/lib/strategy/__tests__/engine-validation-gate.test.ts, src/lib/strategy/__tests__/post-market-domestic-golden.test.ts, src/lib/strategy/__tests__/post-market-engine.test.ts, src/lib/strategy/__tests__/post-market-overseas.test.ts, src/lib/strategy/__tests__/post-market-validation-gate.test.ts, src/app/api/cron/entry-watcher/route.ts, src/app/api/cron/entry-watcher/__tests__/cash-precheck.test.ts, src/app/api/cron/entry-watcher/__tests__/claim.test.ts, src/app/api/cron/entry-watcher/__tests__/fakeSignalsDb.ts, src/app/api/cron/entry-watcher/__tests__/sizing.test.ts, src/app/api/cron/entry-watcher/__tests__/validation-gate.test.ts, src/app/api/orders/route.ts, src/app/api/orders/__tests__/route.test.ts, src/app/api/signals/route.ts, src/app/api/signals/[id]/approve/route.ts, src/app/api/signals/__tests__/approve-route.test.ts, src/app/api/signals/__tests__/route-insufficient-cash.test.ts, src/app/api/signals/custom/confirm/route.ts, src/app/api/signals/custom/confirm/__tests__/route.test.ts, src/app/api/signals/custom/confirm/__tests__/validation-gate.test.ts, src/app/api/analyst/run/route.ts, src/app/api/analyst/run/__tests__/route.test.ts, src/app/api/strategies/[id]/route.ts, src/app/api/strategies/[id]/__tests__/route.test.ts)**
- [04:06] Codex C2(2/4, data_integrity) 지적 2건을 코드와 실DB 로 독립 판정했다. 작업 트리의 T-072 53경로는 3차 사본(`t072-iso-rev3`)과 `cmp` 차이 0(그 사이 바뀐 파일 없음). 사실 확인용 임시 프로브는 3차 사본 안에서만 돌렸고(일회용 MariaDB 11.8.8, `127.0.0.1:33175`, 운영 sql_mode, 끝나고 제거 확인) 프로젝트 트리·운영 DB 는 건드리지 않았다.
- [04:06] C2 지적 1(high, G6·직접 주문 차단은 `signals` 감사 행·`paper_fills` 를 안 만든다) 판정: 오탐(데이터 계약 밖) — 비블로킹, 코드 수정 불요, 문서 한 문장만 권고. ① 사실은 Codex 서술이 맞다 [확실, 코드]: G6 두 분기(`dry-run.ts:233-237` 앞, `:250-254` 송신 직전)는 `markBlocked` 만 부르고 — `orders` 를 blocked/`blocked_by='validation_gate'` 로 갱신, `trade_logs` submit_attempt·blocked, 스로틀 없는 경고 — `signals`·`paper_fills` 쓰기는 0이다. ② 그러나 계약에 포함되지 않는다. 사용자 원문 D-2 는 "가상 체결로 기록해서 검증데이터로 사용"이고 그 맥락은 task 상단 경고("D-2 를 같이 하지 않으면 그 기간 검증 데이터도 쌓이지 않는다" — 룰 시그널 기반 전략 검증 데이터)다. 설계는 가상 체결을 시그널이 있는 두 지점에만 둔다: Stage 0 G 표는 G1(감사 행+가상 체결)·G2(skipped 카드+가상 체결)만 기록하고 G3(4xx)·G4(errorCode)·G5(superseded)·G6(`markBlocked` — "감사 원칙 3: orders·trade_logs 에 남음")은 가상 체결 없음, F-7 은 막힌 **시그널**의 기록 규칙, F-13/L-6 의 `paper_fills.signal_id` 는 "원 시그널(감사 행·카드) id — 멱등 키"이며 NOT NULL 이고 `origin` 열거도 engine·post_market·api_signals·analyst_run 뿐(직접 주문 없음), F-1 은 `POST /api/orders` 를 "막아도 실사용 손실 없음, 열어 두면 우회 구멍"이라는 이유로 차단하지만 기록 대상으로 삼지 않았고, F-12 는 G6 발동을 "우회 버그 신호"(경보)로 규정했다. ③ 비용/위험(채택했다면): `dry-run.ts`(최후 방어선, KIS critical lane 안)에서 `signals` INSERT 와 `paper_fills` INSERT 를 부르게 되어 안전 경로의 쓰기 표면이 넓어지고 계층도 거꾸로 된다(`safety` 가 `signals/paper-fill` 을 import — 현재는 `signals` 가 `safety` 를 import 하는 방향이며 순환은 없다: paper-fill → signal-cash-gate → db·kis-symbols). best-effort 로 삼키므로 차단을 풀지는 않지만 송신 경로에 지연·오류 로그가 얹히고, "G6 발동 = 버그 경보"가 "정상 데이터원"과 섞인다. 또 G6 앞에 킬스위치·블랙리스트·1회·일일 한도·변동성이 있어 직접 주문이 그 앞에서 막히면 G6 에 오지도 못한다 — G6 기록을 넣어도 "차단된 모든 신규 매수"는 성립하지 않는다. ④ 검증 데이터 가치 낮음: 직접 주문은 `strategy_id` NULL·`gate_reason` null_strategy 라 검증할 규칙(가설)이 없고 전략별 집계에서 NULL 버킷 노이즈가 된다(`source='manual'` 이력 0건). 전략 귀속이 있는 매수가 G6 까지 오는 길은 승인·감시 경로의 강등 경쟁뿐인데 그 시그널은 `signals` 행이 이미 있어 T-070 이 상태 무관하게 읽는다. 필요해지면 `orders`(blocked_by='validation_gate')에 symbol·type·price·quantity·amount_krw·market·created_at 이 있어 재구성할 수 있다. 조치 문구(문서): `docs/db-schema.md` paper_fills 절에 "가상 체결 대상은 G1(룰·API 시그널)과 G2(post-market 카드)뿐이다. G3~G6(직접 주문·확정·승인·감시·송신)에서 막힌 매수는 `trade_logs` `signal_validation_gate` 또는 `orders.blocked_by='validation_gate'` 에만 남고 paper_fills 대상이 아니다."를 한 문장 추가하고, Leader 사용자 보고의 D-2 범위 설명(1차 R-8 권고)에 같은 내용을 넣는다.
- [04:06] C2 지적 2(medium, 감사 행/카드와 `paper_fills` 가 원자적이지 않아 일시 실패가 영구 반쪽 기록) 판정: 부분 채택 — 사실은 맞으나 비블로킹, 코드 수정 불요, 문서화 + 읽기 전용 고아 탐지 + 첫 소비 전 재조정으로 충분. ① 사실 재현 [확실, 코드+실DB 프로브]: `recordValidationBlockedBuy`(`paper-fill.ts:261-282`)는 감사 행 INSERT 뒤 별도 INSERT 로 체결을 쓰고 실패하면 감사 행을 둔 채 `paperFillId:null` 을 돌려준다. 엔진 경로는 `claimCooldown` 선점 뒤라 120분간 재기록이 없다. 카드 경로는 `insertScenarioCardIfAbsent` 가 `if (!(res.affectedRows > 0)) return 'duplicate'`(`post-market-engine.ts:356`)로 체결 시도보다 먼저 끝나 재실행해도 보충하지 못한다. 해외 배치는 COMMIT 뒤 `flushCardPaperFills`(`post-market-overseas.ts:393`)가 카드별로 순차 저장해 한 실행에서도 일부만 체결을 가질 수 있다. 프로브: `paper_fills` 없는 상태에서 카드 1건(결과 `blocked`)과 엔진형 감사 1건(`auditSignalId` 2, `paperFillId` null) 기록 → 마이그레이션 적용 → 같은 카드 재실행은 `duplicate`, `paper_fills` 는 0행으로 남고, 아래 탐지 쿼리가 카드 id 1(post_market)·감사 id 2(engine)를 정확히 반환했다. 실패 유형별: 테이블 미존재(마이그레이션이 코드보다 늦은 경우)는 결정적·일괄이고 유일한 현실 경로다. STRICT 데이터 오류는 결정적이나 입력이 코드 상수로 묶여(origin·gate_reason·fill_model 모두 열 길이 이내) 사실상 0이고 DB 시험 C-3 이 잘라 넣지 않음을 고정한다. 일시 DB 오류·교착은 새 `signal_id` 에 대한 연속된 단순 INSERT 두 개 사이라 경합 소지가 거의 없어 매우 드물다. ② 하류 영향: T-070 사후검증은 `signals` 를 상태 무관하게 `price` 로 읽으므로 고아 행도 평가 대상이고 `paper_fills` 는 수수료·체결모델·구간·수량 보강이다. 실패 방향은 과소계상(체결 속성이 없을 뿐 가짜 체결은 생기지 않음)이라 안전한 쪽이다. 진짜 위험은 두 가지다: 소비자가 `JOIN paper_fills`(내부 조인)로 모집단을 정의하면 표본이 조용히 줄어드는 것, 그리고 실패가 무작위가 아닐 때(DB 부하 시간대 등) 해외 배치의 부분 저장이 선택 편향을 만드는 것. ③ 코드 수정이 과하다는 근거: 상태 컬럼·outbox 는 DDL 변경(재승인 필요)과 안전 경로 코드 확대이고, 감사 행+체결을 한 트랜잭션으로 묶으면 "체결 실패 시 감사 행까지 잃거나"(완전성 포기) 카드 트랜잭션에 체결을 다시 결합하게 되는데(WP-2b 가 교착 시 거짓 보고를 피하려고 일부러 분리) 현재 빈도 대비 과대하다. 한편 감사 행이 재조정에 필요한 정보를 모두 갖고 있다 — `price`·`price_at_skip`·`quantity`·`amount_krw`·`order_type`·`symbol`·`strategy_id`·`market`·`expires_at`·`indicators.validation_gate{reason,origin}`, 카드는 `indicators.ai.scenario.entry.price_zone`·`valid_from` — 그래서 `UNIQUE(signal_id)` 가 멱등을 보장하는 사후 재조정이 가능하다(호가 추격 값은 당시 스타일 설정으로 다시 계산해야 하는 근사). ④ 마이그레이션 전에 코드가 먼저 나가는 경우: 그 구간의 감사 행·카드가 위 프로브와 같이 고아가 된다. 방지책은 F-11/F-14 의 순서(마이그레이션 → 코드, 사용자 승인·오프아워)이고, 어겼다면 탐지 쿼리로 목록화해 첫 소비 전에 재조정한다. 조치 문구: (a) Deployer 배포 후 확인에 읽기 전용 고아 탐지를 넣고 기대값은 0 — `SELECT s.id, s.symbol, s.scenario_source, JSON_UNQUOTE(JSON_EXTRACT(s.indicators,'$.validation_gate.origin')) AS origin FROM signals s LEFT JOIN paper_fills p ON p.signal_id = s.id WHERE s.status = 'skipped' AND JSON_UNQUOTE(JSON_EXTRACT(s.indicators,'$.gate')) = 'validation_gate' AND p.id IS NULL`; (b) `docs/db-schema.md` paper_fills 절에 "고아(감사 행·카드는 있고 체결이 없는 경우)의 정의·위 탐지 쿼리, 소비 쿼리는 `signals` 를 기준으로 `LEFT JOIN paper_fills` 해 모집단을 정의하고 고아 건수를 함께 보고, 첫 소비 전 멱등 재조정 필수"를 추가; (c) T-064/T-070 의 착수 조건에 "고아 재조정(멱등 backfill)과 탐지 0 확인"을 등록. 블로킹 아님 — (a)~(c)가 후속·문서로 등록되면 충분하다.
- [04:06] 종합: C2 두 지적은 모두 fail-closed 차단·실 장부에 영향이 없는 가상 체결 데이터 쪽이다. 지적 1 은 오탐(계약 밖), 지적 2 는 부분 채택(운영 절차·문서·후속 재조정). 코드 CRITICAL 0, MAJOR 0 유지, 수정이 필요한 채택 사항은 없다. 앞 줄들의 판정 문구는 모두 이 줄이 덮는다. Codex 호출 차수는 2/4 이다.
- [04:07] **최종 판정: PASS (scope: scripts/migrations/T-072-validation-gate.sql, docs/db-schema.md, src/lib/exchanges/types.ts, src/lib/safety/validation-gate.ts, src/lib/safety/dry-run.ts, src/lib/safety/__tests__/validation-gate.test.ts, src/lib/safety/__tests__/submit-order-validation-gate.test.ts, src/lib/safety/__tests__/submit-order-callsites.test.ts, src/lib/safety/__tests__/submit-order-sell-invariant.test.ts, src/lib/safety/__tests__/submit-order.test.ts, src/lib/signals/service.ts, src/lib/signals/paper-fill.ts, src/lib/signals/telegram-approval.ts, src/lib/signals/telegram-poller.ts, src/lib/signals/__tests__/service.test.ts, src/lib/signals/__tests__/service-cash-gate.test.ts, src/lib/signals/__tests__/service-validation-gate.test.ts, src/lib/signals/__tests__/order-sizing.test.ts, src/lib/signals/__tests__/paper-fill.test.ts, src/lib/signals/__tests__/approve-validation-gate.test.ts, src/lib/signals/__tests__/t072-disposable-mariadb.test.ts, src/lib/signals/__tests__/telegram-approval.test.ts, src/lib/signals/__tests__/telegram-poller-wiring.test.ts, src/lib/strategy/cooldowns.ts, src/lib/strategy/engine.ts, src/lib/strategy/eval-funnel-labels.ts, src/lib/strategy/post-market-engine.ts, src/lib/strategy/post-market-overseas.ts, src/lib/strategy/__tests__/cooldowns.test.ts, src/lib/strategy/__tests__/engine-insufficient-cash.test.ts, src/lib/strategy/__tests__/engine-validation-gate.test.ts, src/lib/strategy/__tests__/post-market-domestic-golden.test.ts, src/lib/strategy/__tests__/post-market-engine.test.ts, src/lib/strategy/__tests__/post-market-overseas.test.ts, src/lib/strategy/__tests__/post-market-validation-gate.test.ts, src/app/api/cron/entry-watcher/route.ts, src/app/api/cron/entry-watcher/__tests__/cash-precheck.test.ts, src/app/api/cron/entry-watcher/__tests__/claim.test.ts, src/app/api/cron/entry-watcher/__tests__/fakeSignalsDb.ts, src/app/api/cron/entry-watcher/__tests__/sizing.test.ts, src/app/api/cron/entry-watcher/__tests__/validation-gate.test.ts, src/app/api/orders/route.ts, src/app/api/orders/__tests__/route.test.ts, src/app/api/signals/route.ts, src/app/api/signals/[id]/approve/route.ts, src/app/api/signals/__tests__/approve-route.test.ts, src/app/api/signals/__tests__/route-insufficient-cash.test.ts, src/app/api/signals/custom/confirm/route.ts, src/app/api/signals/custom/confirm/__tests__/route.test.ts, src/app/api/signals/custom/confirm/__tests__/validation-gate.test.ts, src/app/api/analyst/run/route.ts, src/app/api/analyst/run/__tests__/route.test.ts, src/app/api/strategies/[id]/route.ts, src/app/api/strategies/[id]/__tests__/route.test.ts)**

## Codex 검토

### [2026-10-23 00:40] C1 adversarial-review focus=concurrency — done
- judge 판정: 판단 기록 절에는 해당 줄이 없다(현재 행은 접수 intake 뿐). Leader 전달 판정 인용: `kind=codex_gate checkpoint=C1 task=T-072 risk=R2` → codex_required true, mode adversarial-review, focus concurrency, budget_rule CX-limit-unknown-r2, codex_switch on / 호출 차수: 1/4
- 대상: repo=/home/brownjeon/NFS/homes/brownjeon/project/StockInvest base=1163fe2(task_file) snapshot=ccb4671
- 지적 3건:
  - [high] agent-vault/10-Flow/tasks/T-072-validation-gate.md:103 — 마이그레이션 후 blue/green 배포 중 관문 없는 구버전 프로세스와 신버전이 잠시 공존 — F-11 은 마이그레이션 후 코드 배포만 규정하고, 현 소스 submitOrder 에는 validation_status 검사가 없으며 구버전은 unvalidated 기본값을 읽지 않으므로 구버전 API·cron 이 만든 매수가 기존 submitOrder 로 실송신될 수 있음 (권고: DDL 전부터 신버전 활성화까지 KILL_SWITCH=true 또는 DRY_RUN=true 유지, 구버전 cron/API 의 완전 drain·종료 확인 후에만 해제하는 절차를 설계 필수 단계로 추가. 배포 직전 대기 행 조회만으로는 실행 중 요청을 막을 수 없음)
  - [high] agent-vault/10-Flow/tasks/T-072-validation-gate.md:201 — G6 가 backtested/paper_validated 를 조회한 뒤 한도·변동성·DRY_RUN 검사를 수행하는 동안 전략이 unvalidated 로 강등 — 현 submitOrder(src/lib/safety/dry-run.ts:162-212)에서 검증 SELECT 와 realSubmit 사이에 DB 조회·KIS 연동을 포함한 여러 await 가 있고 원자성 규약이 없음. 캐시 금지 방침은 과거 값 재사용만 막고 TOCTOU 를 제거하지 않음 — 미검증 전략의 매수가 거래소로 나갈 수 있음 (권고: 최소한 realSubmit 직전 상태 재조회·fail-closed. 엄격 직렬화가 필요하면 validation 세대 번호를 주문에 캡처해 송신 직전 비교하거나 명시적 잠금 프로토콜 마련. 수동 SQL 승급·강등도 같은 프로토콜을 따르게 할 것)
  - [medium] agent-vault/10-Flow/tasks/T-072-validation-gate.md:196 — blue/green 중 두 엔진이 같은 후보를 동시에 평가해 둘 다 런 시작 시점 쿨다운 스냅샷에서 비활성으로 판단한 뒤 G1 진입 — G1 이 중복 검사보다 앞에서 감사 signal 과 paper_fills 를 만들고, UNIQUE(signal_id) 는 실행마다 signal_id 가 다르면 중복을 막지 못함. 쿨다운은 스냅샷 판정(src/lib/strategy/cooldowns.ts:73-136)이고 setCooldown 은 사후 UPSERT(cooldowns.ts:146-166)라 후보 생성 권한을 선점하지 않음 — 동일 전략·종목·방향·발화에 복수 skipped signal·paper_fills 가 생겨 가상 체결 표본과 검증 통계가 중복 과대계상 (권고: 쿨다운 키 또는 발화 키를 조건부 INSERT 로 먼저 원자 선점하고 승자만 감사 signal·paper_fill 을 만들 것. 대안: paper_fills 에 전략·종목·방향·평가주기 또는 결정론적 event key 의 UNIQUE 제약을 추가하고, 감사 signal 생성·paper_fill 생성·쿨다운 선점을 한 트랜잭션으로 묶을 것)
- 검토하지 못한 범위: C1 은 구현 전 설계 단계라 validation-gate.ts·paper-fill.ts·마이그레이션·동시성 테스트 구현은 검토 대상이 아님. 운영 DB 상태와 실제 blue/green 프로세스 종료 순서는 읽기 전용 제한으로 검증하지 않음.
- 원본: /home/brownjeon/NFS/homes/brownjeon/project/.claude/state/codex-review/runs/20261022T154026Z-T-072-C1/raw.txt

### [2026-10-23 03:56] C2 adversarial-review focus=data_integrity — done
- judge 판정: `kind=codex_gate checkpoint=C2 task=T-072 risk=R2` (Leader 전달 판정: codex_required true, mode adversarial-review, focus data_integrity, budget_rule CX-limit-unknown-r2, codex_switch on) / 호출 차수: 2/4
- 대상: repo=/home/brownjeon/NFS/homes/brownjeon/project/StockInvest base=1163fe2(task_file) snapshot=79e7ff4 · files_modified_in_snapshot 없음
- 지적 2건:
  - [high] src/lib/safety/dry-run.ts:229 — 직접 주문 API 의 신규 매수가 strategyId=null 로 G6 에서 차단되거나, G1~G5 를 통과한 매수가 G6 에서 처음 차단될 때 — markBlocked() 는 orders 를 blocked 로 갱신하고 trade_logs 만 추가하며, signals skipped 감사 행·paper_fills 를 만들지 않음(/api/orders 는 signalId·strategyId 를 모두 null 로 전달) → 차단 자체는 유지되나 검증 데이터셋에서 해당 매수가 누락되어 "차단된 모든 신규 매수를 가상 체결로 평가" 계약이 깨지고 경로별 성과 분석이 편향됨 (권고: G6 차단 시 signalId 가 없으면 skipped 감사 시그널을 만들고 그 ID 로 paper_fills 를 기록하는 공통 best-effort 경로 호출; signalId 가 있으면 멱등 paper_fills 기록 또는 복구 큐)
  - [medium] src/lib/signals/paper-fill.ts:261 — skipped 감사 시그널 또는 post-market 카드 INSERT/COMMIT 은 성공하고 직후 paper_fills INSERT 가 일시 DB 오류·테이블 미존재·교착·STRICT 데이터 오류로 실패할 때 — recordValidationBlockedBuy() 는 signals INSERT 후 별도 INSERT 로 paper_fills 를 쓰며 실패 시 감사 행을 그대로 둠. 카드 경로도 카드 생성 후 별도 insertPaperFill() 을 호출하고, 해외 배치는 post-market-overseas.ts:391-394 에서 카드 트랜잭션 COMMIT 후 체결을 순차 저장함. 쿨다운 선점 후 엔진 경로는 재기록하지 않고, 카드 경로는 상태와 무관한 NOT EXISTS/유니크 중복 판정 때문에 재실행해도 duplicate 가 되어 누락을 보충하지 못함 → signals 에만 있는 영구 반쪽 기록이 생기고, 해외 배치는 한 실행 안에서도 일부 카드만 체결 행을 가짐 (권고: 카드/감사 행에 paper-fill 기록 상태를 두거나 같은 트랜잭션에 durable outbox 를 기록해 재처리; 최소한 signal_id 기준으로 paper_fills 가 없는 validation-gate 행을 재조정하는 멱등 복구 작업을 제공; 쿨다운·duplicate 경로에서도 누락된 체결은 보충)
- 검토하지 못한 범위: 운영 MariaDB 10.11.11 에서 T-072 마이그레이션을 실제 실행하는 호환성 검증; 장 시간 외 KIS 주문 거절 동작; 허용 파일 밖의 동시 변경.
- 요약(Codex): 실주문 차단의 fail-closed 동작은 유지되지만, 직접 주문·G6 최후 차단 경로는 skipped 감사 시그널과 paper_fills 를 만들지 않으며, 기록 경로에서 감사 행과 paper_fills 가 원자적이거나 재처리 가능하게 연결되지 않아 일시 실패가 영구 누락으로 남을 수 있음.
- 원본: /home/brownjeon/NFS/homes/brownjeon/project/.claude/state/codex-review/runs/20261022T185445Z-T-072-C2/raw.txt

## QA

- [04:29] 방법·범위(QA, 독립 실행): Developer·Reviewer 보고를 믿지 않고 전부 직접 실행했다. 기준 HEAD `1163fe2`. 격리 사본 `scratchpad/t072-iso-qa` = `git archive HEAD` + T-072 변경 53경로(신규 15·수정 38 — Reviewer 마지막 판정 scope 54항목 중 파일 변경이 없는 `src/app/api/strategies/[id]/route.ts` 만 제외)를 덮어씀, 원본과 `cmp` 차이 0. 타 세션 파일(`package.json`·`jest.config.js`·`llm/*`·`notify/*`·`fx.ts`·`kis-http.ts`·`kis-master.ts`·`auth/*`·`api-usage*`·`ai-filter.ts` 등)은 덮어 얹지 않았다. 운영 DB 는 읽기 전용 러너(SHOW/SELECT)로만 조회, 쓰기 0. DDL·시나리오는 로컬 `mariadb:11`(11.8.8) 일회용 컨테이너 `127.0.0.1:33272` 에서만 실행하고 끝나서 제거 확인(`docker ps -a` 에 t072 0건, 포트 닫힘). git 쓰기·배포·pm2·KIS·외부 호출 0, `.env` 내용 출력 0, 훅 스크립트 실행 0. 화면 파일 0이라 화면 검증(viewport·다크모드)은 해당 없음.
- [04:29] Q1 독립 재현 — 기대치와 일치: `tsc --noEmit` 오류 0(src 395파일). 시험 포함 타입 검사(내가 만든 `tsconfig.qa-tests.json`, T-072 시험 33개, `types: jest,node`) 오류 0. jest 전체 **221 스위트 통과 + 1 건너뜀(DB 시험) — 5,424 통과 / 17 건너뜀 / 5,441**. 일회용 DB 환경변수(`T072_TEST_DB_*` 2개 — 시험 머리말의 방법)를 켠 전체 **222/222 스위트 · 5,441/5,441**. 추가: `TZ=UTC`·`TZ=America/New_York` 에서도 5,424 통과(시험이 시간대에 기대지 않음). `next build`(Next 15.5.22, `NEXT_TELEMETRY_DISABLED=1`, 격리 사본) exit 0 — 라우트 export 위반·번들 오류 없음.
- [04:29] Q2 운영 DB 스키마 대조(운영 `10.11.11-MariaDB-log`, sql_mode 에 STRICT_TRANS_TABLES): 읽기 전용 `SHOW CREATE TABLE` 로 `signals`·`cooldowns`·`trade_logs`·`orders`·`strategies`·`fx_rates`(+`eval_funnel`)를 읽고 T-072 가 쓰는 모든 SQL 을 한 칸씩 대조 — **불일치 0**. ① `paper_fills` INSERT: 열 22개 ↔ 자리표시자 21개 + `'buy'` 리터럴 1개 ↔ 파라미터 21개, 위치 일치. ② 카드 INSERT(`post-market-engine.ts:329-345`): 열 13개(`status` 를 맨 뒤로 옮김) ↔ SELECT 자리표시자 10개 + `'buy'`·`'limit'`·`'post-market'` 리터럴 3개 ↔ NOT EXISTS 자리표시자 2개 포함 파라미터 12개 — 한 칸씩 일치. 같은 SQL 을 운영 DDL 로 만든 일회용 DB 에서 실제 실행해 열별 값 위치(strategy_id·price·amount_krw·indicators·expires_at·valid_from·market·scenario_source·status)까지 확인(E10). ③ 감사 행 INSERT(13열·12 파라미터) 일치, `signals.status` ENUM 에 `skipped`·`superseded`·`approved_pending_entry`·`awaiting_approval` 존재, `indicators` 는 `json_valid` CHECK 이고 표지 JSON 은 항상 유효. 감사 행은 `valid_from`·`scenario_source` 가 NULL 이라 `uq_signals_scenario_card` 와 충돌하지 않음. ④ `cooldowns`: `claimCooldown` 의 INSERT IGNORE·UPDATE 키 5개(scope·symbol·strategy_id·side·exit_kind)가 `UNIQUE uq_cooldown` 과 같고, `normalizeKey` 가 strategy_id·side·exit_kind 를 NOT NULL DEFAULT '' 에 맞게 `''` 로 채움, `reason varchar(64)` ≥ `validation_gate`. ⑤ `trade_logs.event varchar(32)`: T-072 코드가 쓰는 이벤트는 `signal_validation_gate`(22자)·`blocked`(7자) 둘뿐(trade_logs INSERT 지점 전수 grep). ⑥ `orders.blocked_by varchar(32)` ≥ `validation_gate`(15)·`invalid_side`(12, 이쪽은 orders 행을 만들지 않음), `orders.status` ENUM 에 `blocked`. ⑦ `eval_funnel.gate varchar(48)` ≥ `validation_lookup_error`(23), `reason varchar(64)`, `verdict` ENUM(pass·skip·error). ⑧ `fx_rates`: `pair='USD_KRW'` 행이 있고 나이 1분(`readFreshUsdKrw` 가 실제로 환율을 얻는다). ⑨ `strategies` 시드 `INSERT IGNORE`(db.ts:501)는 열 목록을 명시해 새 컬럼이 DEFAULT 로 채워지고, `PATCH /api/strategies/[id]` 는 enabled·backtest_interval_h·description·tags 만 받는다(validation_* 불가). ⑩ 운영 `signals` 에 기존 `skipped` 행 0 — 고아 탐지 쿼리의 기준선이 0이다. ⑪ INFO: `strategies`·`signals` 가 `utf8mb4_general_ci`(대소문자·후행 공백 무시)라 `WHERE id=?` 가 `OK-BT-V1` 도 같은 전략으로 매칭한다 — 같은 전략으로 해석될 뿐 권한이 커지지 않는다.
- [04:29] Q3 마이그레이션 적용기: Leader 의 `t072-apply-migration.cjs` 를 직접 읽었다 — `--` 이후 주석 제거 → `;` 분리. SQL 파일에서 주석을 지운 뒤 세미콜론이 정확히 3개이고 문자열 리터럴 안에 `--`·`;` 가 없음을 확인, 드라이런(운영 루트, `--apply` 없음)은 **3문장**(`SET SESSION lock_wait_timeout=5` · `ALTER TABLE strategies ADD COLUMN IF NOT EXISTS …`×3 · `CREATE TABLE IF NOT EXISTS paper_fills`)만 출력하고 연결하지 않는다. 롤백 줄은 주석이라 `--apply` 가 실행하지 않는다. 일회용 DB(운영 `SHOW CREATE TABLE strategies` 그대로 + 운영 id 16행)에서: ① `--apply` 1회 exit 0, 분포 `unvalidated` 16 ② 2회째도 exit 0(멱등), 컬럼 3개·`uq_paper_fills_signal` 1개 ③ 기존 16행 전부 `unvalidated`, 구 코드형 시드(`INSERT IGNORE` 열 목록 명시) 새 행도 `unvalidated` ④ `paper_fills` 같은 `signal_id` 두 번째 INSERT → `ERROR 1062 uq_paper_fills_signal` ⑤ SQL 파일 맨 아래 주석의 롤백 2줄을 추출해 실행 → 2회 모두 exit 0(멱등), 컬럼 3개·`paper_fills` 제거·strategies 행 보존, 재적용 ok. ENUM 밖 값 UPDATE 는 `1265 Data truncated`(DB 가 1차로 막음), `BACKTESTED` 대문자 UPDATE 는 `backtested` 로 저장(ENUM 대소문자 무시 — 코드는 읽은 값 그대로 비교하므로 안전 방향). 파일 헤더가 안내한 `mariadb … < 파일` 경로도 2회 exit 0, `paper_fills` 24열(PK·created_at 포함). 10.11 호환: 사용 문법은 `ADD COLUMN IF NOT EXISTS`·`DROP COLUMN IF EXISTS`·`CREATE TABLE IF NOT EXISTS`·ENUM·DECIMAL·`COLLATE=utf8mb4_general_ci` 뿐이고 11.x 전용 문법은 없다. 운영 코드가 이미 같은 구문을 쓴다 — `stock_favorites.research_enabled` 는 `db.ts:1255` 의 `ALTER … ADD COLUMN IF NOT EXISTS … NOT NULL DEFAULT 0` 으로만 생기는 열인데 운영에 존재한다(읽기 전용 SHOW COLUMNS). [가능성 높음] 10.11.11 에서 그대로 실행된다. **10.11 에서 직접 실행하지는 못했고, MariaDB 공식 문서는 외부 네트워크 금지라 열람하지 못했다.**
- [04:29] Q4 시나리오 실행 — 기존 시험이 이미 증명하는 항목과 내가 직접 만든 실 DB 시험. 기존: 매도 변형(`SELL`·` sell `·`Sell`) 무영향=`validation-gate.test`·`submit-order-sell-invariant.test`·`service-validation-gate.test`(1b·4절)·`approve-validation-gate.test`·confirm/entry-watcher `validation-gate.test`; 모든 매수 차단=`validation-gate.test`·`submit-order-validation-gate.test`(DRY_RUN true/false × 5사유)·`service-validation-gate.test`(1·1b·2절); 직접 주문 API=`orders/__tests__/route.test`(귀속 `{strategy,null,null}`·`source` 위장·본문 strategyId 무시); 가상 체결 멱등=`paper-fill.test`+일회용 DB C-1; 쿨다운 선점=`service-validation-gate.test`(6절)+일회용 DB D(동시 10회 중 1회); 승인 요청 알림 0·실 장부 쓰기 0=`service-validation-gate.test`·`paper-fill.test`·`post-market-validation-gate.test` 의 LEDGER 정규식. 위 시험은 모두 가짜 DB 이거나 함수 단위라, **실제 `submitOrder`·`createSignal`·`approveSignal`·라우트를 일회용 MariaDB(운영 DDL)에 연결한 독립 시험 65개를 새로 만들어 돌렸다(65/65, 격리 사본 `src/lib/__tests__/t072-qa-e2e.test.ts`, 프로젝트에는 없음)**: 거래소 어댑터·알림은 spy, 한도·킬스위치·변동성은 통과 목, `getPool` 은 SQL 로깅 프록시, 나머지(system_config·orders·trade_logs·signals·strategies·cooldowns·paper_fills)는 실물. E1 매수 32조합(DRY_RUN true/false × unvalidated·미등록·귀속 null·귀속 미지정 × `buy`·`BUY`·` Buy `·`buy\t`) 전부 `blocked/validation_gate`, 어댑터 호출 0, orders 행 `blocked`, `dry_run` 아님 / E2 매도 16조합(`sell`·`SELL`·` sell `·`Sell` × 4귀속) 전부 어댑터 1회에 정확히 `sell`·orders `accepted`·strategies 조회 SQL 0, `validation_status` 컬럼을 일시 제거한 상태에서도 매도 정상 / E3 `backtested` 승급 후 `' BUY '` 가 어댑터에 정확히 `buy` 로 나가고(양성 대조), 강등하면 다음 호출 즉시 차단(캐시 없음), 컬럼 없음=`lookup_error` 차단, `purchase`=orders 행 0 / E4 `POST /api/orders` 실제 라우트(매수 `BUY`+`source:signal` 위장+본문 strategyId·attribution 주입 → 400·`validation_gate`·어댑터 0, 매도 `SELL` → 200·어댑터 `sell`) / E5 `createSignal` 엔진 경로 동시 5회+연속 2회 → `signals` skipped 감사 행 정확히 1·`paper_fills` 1·`cooldowns` 1(entry/buy/120분)·알림 spy 0·orders 증가 0·실 장부 쓰기 SQL 0·4개 실 장부 테이블 행 0, 쿨다운 만료 후 `reclaimed` 로 1건 추가(총 2), 변형 side `BUY `·미등록·빈 문자열·공백 전략·undefined 전부 `validation_gate`, 매도 `SELL`+`hard_stop` 는 정상 생성(awaiting_approval) / E6 `approveSignal` 매수(unvalidated)=`validation_gate`·상태 불변·주문 0·trade_logs `signal_validation_gate` 정확히 +1 / E7 `custom/confirm` 매수 `buy`·`BUY`·` Buy ` → 403+한국어+`errorCode`, signals 행 0, trade_logs +1, `purchase`=400 / E8 `entry-watcher` 실제 라우트(개장 목) 잔여 `approved_pending_entry` 매수 3행(unvalidated·NULL·미등록) → `validation_blocked`·`superseded`·흔적 3·주문 0·알림 0, 매도 2행·검증된 전략 매수 1행은 관문 통과(`no_zone`, 상태 불변), 두 번째 틱에서 흔적이 늘지 않음 / E9 `approveSignalHybrid`·웹 승인 라우트(하이브리드·직접 경로) 미검증 매수 → 403+한국어·상태 불변, 같은 전략의 매도 행은 승인되어 어댑터에 `sell` 만 도달 / E10 post-market 카드(미등록 → `blocked`·`skipped`·`zone_touch_pending` 가상 체결·구간·KST 유효기간 일치, 같은 카드 재호출 → `duplicate`·가상 체결 그대로, 검증된 전략 → `created`·`pending`·가상 체결 0). 전 시나리오에서 `executions`·`position_state`·`portfolio_snapshots`·`holdings` 쓰기 SQL 0. 비공허 확인: 격리 사본에서 G6 두 판정(`if (!vg.allowed)`·`if (!vgSend.allowed)`)을 `if (false)` 로 바꾸자 이 시험 36개가 실패했고, 원복(`cmp` 동일) 후 65/65.
- [04:29] 안전장치 체크리스트(qa 역할 규정): DRY_RUN — G6 가 DRY_RUN 분기 앞이라 true/false 모두 `blocked`(E1)이고 매수 허용 전략의 DRY_RUN=true 는 `dry_run` 그대로(`submit-order-validation-gate` 5절) / Kill Switch·한도·블랙리스트 — G6 가 그 뒤에 있어 먼저 걸린다(`submit-order-validation-gate` 3절, 한도·변동성은 이번에 손대지 않음) / 감사 로그 — 차단은 `orders`(`blocked`·`blocked_by='validation_gate'`)+`trade_logs`(`blocked`·`signal_validation_gate`)에 남는다(E1·E6~E8) / 보안 — 아래 Q5(c) / SQL 인젝션 — T-072 의 모든 SQL 이 파라미터 바인딩(동적 SQL 조각은 상수 열 목록뿐).
- [04:29] Q5 변경 범위·위생: (a) `git status`(121경로) 중 `src/`·`scripts/`·`docs/` 79경로를 Reviewer 마지막 판정 scope(54항목)와 집합 대조 — scope 에 있는데 변경이 없는 것 1(`strategies/[id]/route.ts`, 시험으로 고정만 함), **T-072 변경인데 scope 밖인 파일 0**. 나머지 26경로는 전부 타 세션(T-040 api-usage·T-067 감사·모바일 문서 등)이고 T-072 표지(`T-072`·`validation_gate`·`paper_fill`·`validation_status`·`normalizeOrderSide`·`claimCooldown`) grep 결과 0건(`docs/reports/2026-10-22-profitability-audit.md` 만 감사 보고서가 이 관문을 언급). 마지막 판정 줄 이후 코드 변경 없음 — 3차 감사 사본(`t072-iso-rev3`)과 52개가 바이트 동일, `docs/db-schema.md` 1개만 04:04 에 갱신(C2 반영 문서, +67줄 단일 hunk, 전부 T-072). 기존 시험 21개 수정분의 삭제 줄을 전수 확인 — 전부 fixture 에 검증된 전략/귀속 추가·NOT EXISTS SQL 변경에 따른 기대 문자열 갱신·강화이고 단언을 느슨하게 바꾼 곳은 없다. (b) `git diff HEAD --quiet -- src/lib/db.ts src/lib/exchanges/kis-domestic.ts src/lib/exchanges/kis-overseas.ts` → **변경 없음**. `scripts/git-hooks/*`·`.claude/settings*` 도 무변경. 코드에서 `submitOrder(` 호출부는 정확히 4곳(`orders/route.ts:85`·`entry-watcher/route.ts:492`·`service.ts:664·792`), `createOrder` 는 모두 `submitOrder` 의 두 번째 인자(`kis.createOrder`)로만 전달, KIS 주문 TR(`order-cash`·`order-rvsecncl`)은 어댑터 두 파일 밖에 없다. (c) 시크릿: 변경 53파일+task 문서에서 키·토큰·비밀번호·사설 IP 패턴 grep — 추가된 것 없음(시험의 가짜 세션 비밀·가짜 chat id 는 HEAD 에 있던 줄이고, 일회용 DB 비밀번호 `t072test` 는 127.0.0.1 컨테이너 전용으로 시험 머리말에 문서화). 비-시험 코드의 `process.env` 참조는 `dry-run.ts:58`(기존 DRY_RUN) 뿐. (d) 커밋 훅 모사(훅 실행 없음, 계산만): `awk '/^SAFETY_PATHS=\(/,/^\)/' scripts/git-hooks/commit-msg` 의 패턴을 하나의 ERE 로 결합해 T-072 53파일에 적용 → **50개가 SAFETY_PATHS 에 걸리고 50개 전부 마지막 판정 scope(`/` 로 끝나면 접두, 아니면 정확히 그 파일)에 들어 있다**; 걸리지 않는 3개는 `docs/db-schema.md`·`scripts/migrations/T-072-validation-gate.sql`·`src/app/api/strategies/[id]/__tests__/route.test.ts`(F-10 결정 대기로 `^src/app/api/strategies/` 는 SAFETY_PATHS 에 없다). 타 세션의 `src/lib/exchanges/fx.ts`·`kis-http.ts`·`kis-master.ts`, `src/lib/auth/kis-verify.ts`·`oauth/providers.ts`, `src/lib/notify/telegram-api.ts`, `src/app/api/cron/news-fetch/route.ts`, `src/app/api/settings/credentials/test/route.ts` 등 타 세션 26경로 중 14개가 SAFETY_PATHS 에 걸리는데 scope 에 없다 → **하나라도 같이 stage 하면 훅이 막는다**. `## Reviewer` 의 마지막 판정 줄은 04:07 줄이고 그 뒤에 판정 줄은 없다(이 `## QA` 는 제목에 reviewer 가 없고 해당 문구를 쓰지 않았다). 훅이 Reviewer 본문으로 읽는 Developer 쪽 `####` 소제목 4곳은 판정 문구가 없어 영향 없음 재확인.
- [04:29] Q5(e) 커밋 포함 제안(명시 경로만, `git add -A`·`git add .` 금지): ① 코드·시험·SQL·문서 53경로 — 신규 15(`scripts/migrations/T-072-validation-gate.sql`, `src/lib/safety/validation-gate.ts`, `src/lib/signals/paper-fill.ts`, 시험 12개: `app/api/cron/entry-watcher/__tests__/validation-gate.test.ts`·`app/api/signals/custom/confirm/__tests__/validation-gate.test.ts`·`app/api/strategies/[id]/__tests__/route.test.ts`·`lib/safety/__tests__/{submit-order-callsites,submit-order-validation-gate,validation-gate}.test.ts`·`lib/signals/__tests__/{approve-validation-gate,paper-fill,service-validation-gate,t072-disposable-mariadb}.test.ts`·`lib/strategy/__tests__/{engine-validation-gate,post-market-validation-gate}.test.ts`) + 수정 38(`docs/db-schema.md` 포함). 목록 파일 `scratchpad/t072-qa-overlay.txt`(53줄) 그대로 stage 하면 된다. ② vault: `agent-vault/10-Flow/tasks/T-072-validation-gate.md`(신규)·`T-073-dashboard-direction.md`(신규, frontmatter 확인 — Leader 접수 건). ③ `agent-vault/00-Context/HANDOFF-2026-10-22.md` — 추가 2줄 전부 "10-23 00:2x 정정"(내 변경만) → 포함 가능. ④ `agent-vault/10-Flow/board.md` — **타 세션 변경이 섞여 있다**: 추가 12줄 중 T-072 항목 1줄·T-073 항목 1줄이 이번 작업이고, T-067 감사 알림 3줄·T-044·T-045·T-058 항목 3줄은 타 세션 몫이다. T-072 줄과 T-058 줄이 같은 hunk 에 붙어 있어 `git add -p` 로 나누려면 hunk 편집(`e`)이 필요하다 — 통째로 stage 하면 타 세션 줄까지 나간다. ⑤ **제외**: `ACTIVE.md`·`RESUME.md`(전부 타 세션: T-067 감사·T-058 인수인계), `T-042/T-046/T-049` task 문서·`20-Log/*`·`2026-08-02-restructure-plan.md`·`T-040-api-usage-log.md`·`T-067-profitability-audit.md`·`20-Log` 신규들, `CLAUDE.md`·`AGENTS.md`·`.claude/agents/*`·`.codex/**`·`.agents`/`.claude/skills` 삭제분·`.env.example`, `jest.config.js`·`jest.setup-api-usage.js`·`package.json`·`package-lock.json`, `docs/design/`·`docs/reports/`·`docs/mobile-app-procedure.md`, 위 타 세션 26경로(`src/`·`docs/`), 그리고 저장소 루트의 의미 없는 `NUL` 파일(10-22 17:34, 타 세션). `20-Log/2026-10-23.md` 는 아직 없다(Leader 가 한 줄 남길 것). 커밋 메시지에 `T-072` 필수, 끝에 시스템 지시의 공동 저자 줄.
- [04:29] Q6 문서 정합: `docs/db-schema.md` 의 `strategies` 3열(`validation_status` ENUM 3값 NOT NULL DEFAULT 'unvalidated'·`validation_changed_at` DATETIME NULL·`validation_evidence` VARCHAR(255) NULL)이 SQL 과 일치. `paper_fills` 표를 스크립트로 파싱해 SQL 의 `CREATE TABLE` 과 열 이름·타입·NULL·기본값을 열 단위로 대조 — 문서 24열(id·created_at 포함, 데이터 열은 22개)·SQL 24열, **누락·불일치 0**. 인덱스 3개·콜레이션 설명 일치. 고아 탐지 쿼리(문서에서 그대로 추출)를 일회용 DB 에서 실행: 정상 상태(감사 행 7·가상 체결 7) 0행 → 고아 감사 행을 주입하면 1행(원 시그널 id·symbol·origin 컬럼 표시) → 표지가 다른 skipped 행·indicators NULL 인 skipped 행은 잡지 않음 → 주입 행 삭제 확인. 문법·결과 기대값 0 확인.
- [04:29] Q7 배포 전 점검 기준선(읽기 전용, 04:19 KST, 운영 `10.11.11-MariaDB-log`): 승인 대기·감시(`pending/pending_approval/awaiting_approval/detected/approved_pending_entry`) 중 만료 전 행 **0**(참고: 최근 3일 `awaiting_approval` 1행은 이미 만료 — 승인해도 `signal_expired` 로 끝남) · `executing` 은 5/27 매도 3행(잔여, 제외 대상) · `orders` 진행 중은 `pending` 1건(#2107, 5/14 해외 매도 `auto`, 잔여) · 최근 30분 주문 **0** · 설정 `safety_dry_run=false`·`safety_kill_switch=false`·`autopilot_mode="assist"`·`exit_engine_enabled=false` · `strategies` 16행 · `SHOW COLUMNS FROM strategies LIKE 'validation_status'` **빈 결과**, `SHOW TABLES LIKE 'paper_fills'` **빈 결과**(마이그레이션 전 확인) · `signals` 기존 `skipped` 0행 · `cooldowns` entry 12행(최대 until 05:17) · `fx_rates` USD_KRW 1324.63(나이 1분). 지금 시각은 배포 창(05:10~07:50) 밖이다.
- [04:29] 발견 사항: **CRITICAL 0 · MAJOR 0.** MINOR 1: `src/lib/exchanges/types.ts:24-31` 에 JSDoc 블록 2개가 연달아 붙어 첫 블록(`validation_gate` 설명)은 TS 가 버리고 마지막 블록(`invalid_side`)만 `blockedBy` 에 붙는다 — 동작 영향 없음, 편집기 툴팁에서만 설명 하나가 사라진다(수정은 Developer 몫, 배포 차단 사유 아님). INFO: ⓐ 작업 트리 전체로는 지금 `tsc`(4 오류)·jest(다수 스위트)가 돌지 않는다 — 타 세션 T-040 이 `package.json` 에 넣은 `@workspace/api-usage`(`file:../shared/api-usage`)가 `node_modules` 에 설치돼 있지 않기 때문이며 T-072 와 무관하다. T-072 만 얹은 격리 사본(HEAD+53경로)은 위처럼 전부 통과하므로 **T-072 커밋은 단독으로 자급자족**한다 — 대신 작업 트리를 그대로 `git add -A` 로 올리면 안 되고, 타 세션 변경과 합친 상태의 시험은 불가능했다. ⓑ `CLAUDE.md` 는 Next.js 14 라고 적었지만 실제 빌드는 15.5.22 다(이 task 와 무관한 문서 드리프트).
- [04:29] 못 확인한 것: MariaDB **10.11 에서의 실제 실행**(로컬은 11.8.8, 이미지 새로 받기 금지) · 타 세션 변경과 합친 상태의 jest/tsc(위 INFO ⓐ로 불가) · 장중 실제 `entry-watcher`·엔진·텔레그램 렌더링·웹 승인 화면 토스트(`ApprovalQueue.tsx` 가 거절 응답을 읽지 않음 — T-073 몫)·KIS 실제 응답 · F-14 의 "폐장 시간대에는 거래소로 나가는 트리거가 없다" 가정의 실측(코드에 장 시간 차단은 없음을 재확인했을 뿐) · blue/green 구·신 프로세스 공존 구간 · eslint(저장소에 설정 없음) · 운영 DB 쓰기 경로(금지). 배포 후에만 볼 수 있는 항목은 task 의 '배포 체크리스트' 5번 그대로다.
- [04:29] 배포 전 Leader 가 알아야 할 것: (1) 위 Q5(e) 대로 명시 경로로만 커밋하고 board.md 는 hunk 를 나눈다. (2) 마이그레이션은 D-3 승인 범위이고 적용기는 드라이런 3문장으로 확인했다 — 권한 분류기가 거부하면 사용자가 `mysql … < scripts/migrations/T-072-validation-gate.sql` 로 직접(파일 헤더 안내, 위에서 CLI 경로 검증함). (3) 배포 직전 `t072-predeploy.sql` 을 다시 실행해 위 기준선(대기·감시 0, 진행 중 주문 0, 최근 30분 주문 0)을 재확인하고, 배포 후 고아 탐지 쿼리 기대값 0·`strategies` 16행 전부 `unvalidated`·`paper_fills` 존재를 확인. (4) 사용자 고지: 배포 직후 신규 매수는 앱 경로 전부 불가, post-market 카드는 전부 `skipped`(대시보드 '내일'·추천 탭에서 사라짐), 승인 큐 화면은 거절 문구를 못 보여 줌(텔레그램은 한국어 문구), D-2 가상 체결은 시그널이 있는 G1·G2 만 대상. (5) 롤백(코드 revert)은 관문을 없애 신규 매수를 다시 연다(`safety_dry_run=false`) — 롤백 판단 때 킬스위치/DRY_RUN 을 함께 정한다. (6) 열린 결정: `SAFETY_PATHS` 에 `^src/app/api/strategies/` 추가(권고: 추가), 첫 승급 전 전략 ID 불일치(`oversold-bounce-v1` ↔ `oversold-bounce-daily-v1`)·`POST /api/signals` 의 `body.strategyId` 신뢰 경계 정리.
- [04:29] **QA 판정: PASS (범위: Q1 tsc·시험 포함 tsc·jest 전체(DB 포함 222/222)·next build·시간대 2종 재현, Q2 운영 DB 읽기 전용 스키마 대조(SQL 전수), Q3 적용기 드라이런+일회용 DB 멱등·롤백·CLI 경로, Q4 실 DB 독립 시험 65/65+변이 대조, Q5 범위·scope·훅 모사·시크릿·vault 혼입 확인, Q6 문서·고아 탐지 쿼리, Q7 운영 읽기 전용 기준선 / 미실행: MariaDB 10.11 실행·타 세션 합친 상태 시험·장중 실운영 관측·화면 검증(화면 변경 없음))**
