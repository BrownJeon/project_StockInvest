---
task-id: T-006
project: StockInvest
created: 2026-08-06
status: done
tags:
  - type/task
  - domain/strategy
  - domain/safety
aliases:
  - Phase 2 구현
  - 파이프라인 재설계 구현
related_tasks:
  - "[[T-003-phase2-pipeline-redesign]]"
  - "[[T-002-phase1-eval-funnel]]"
  - "[[T-001-phase0-safety-foundation]]"
---

# T-006 · Phase 2 구현 — 시그널 파이프라인 재설계

## 목표

[[T-003-phase2-pipeline-redesign]] analyst 사양의 **§5 마이그레이션·롤아웃 계획 Step 0~4를 구현**한다. 사양 자체는 확정 완료 — 이 task는 순수 구현·검증이다.

**Step 5(DRY_RUN 관측 → 실거래 해제)는 이번 범위 밖.** 사용자 승인 후 별도 진행.

## 사용자 승인

2026-08-06 사용자가 Phase 2 즉시 착수를 명시 선택(대안 "설계만 검토"/"보류" 제시했으나 즉시 착수 선택). 관측 3영업일 게이트 충족(아래 실측).

## 🔍 착수 전 운영 DB 실측 (Leader, 2026-08-06 09:53 KST, SELECT only)

### Step 0 — **이미 완료됨. 재작업 금지.**

`signals.status` ENUM 실측:
```
enum('pending','approved','rejected','auto_submitted','expired','superseded',
     'ai_skipped','approved_pending_entry','executing','pending_approval')
```
`pending_approval` **존재함** — [[T-002-phase1-eval-funnel]] H1에서 이미 반영됐다. **Step 0 스킵.**

### 관측 3영업일 게이트 — ✅ 충족

| KST 일자 | eval_funnel rows | runs |
|---|---|---|
| 2026-08-03 (배포일, 부분) | 7,101 | 89 |
| 2026-08-04 | 11,122 | 144 |
| 2026-08-05 | 11,116 | 144 |
| 2026-08-06 (진행 중) | 4,982 | 65 |

### 🔴 관측 결과 — analyst 진단이 실측으로 재확인됨

`gate='final'` stage 분포 (08-04 이후):

| stage | reason | n | 비중 |
|---|---|---|---|
| 4 | `rule_no_fire` | **10,720** | **~95%** |
| 5 | `sell_not_held` | 329 | |
| 1 | `ticker_error` | 167 | |
| 3 | `candles_fetch_failed` | 39 | |
| 7 | `prefilter_strong_counter_trend` | 31 | |
| 6 | `order_limit_unconfigured` | 6 | |
| 10 | `ai_rejected` | 4 | |

**stage 99(시그널 생성) 0건.** 14일 signals도 `ai_skipped` 3,134 + `expired` 6뿐 — **여전히 시그널 0건.**

→ **깔때기가 stage 4(룰 발화)에서 95% 사망한다.** analyst가 지목한 market-state 데드락이 최상류 병목임이 실측으로 확정됐다. Phase 2의 D1(market-state 게이트 → 라벨 강등)이 정확히 이 지점을 겨냥한다. `prefilter_strong_counter_trend`가 31건에 그친 것도 **상류에서 이미 다 죽어 도달 자체를 못 하기 때문**이다.

### 기타 실측 (구현에 직접 영향)

| 항목 | 실측값 | 함의 |
|---|---|---|
| `cooldowns` 테이블 | **없음** | Step 1에서 생성 |
| `eval_funnel_daily` | **없음** | [[T-002-phase1-eval-funnel]] §2 보존정책의 롤업 테이블이 **구현된 적 없다.** eval_funnel이 일 ~8k행씩 무제한 증가 중(4일 34k행). 별도 backlog |
| `safety_daily_order_max_pct` | **10** | 🟢 **사용자가 이미 설정함 — 대기 결정 1건 해소** (0 → 10) |
| `safety_order_max_pct` | 6 | |
| `safety_dry_run` | **false** | ⚠️ 사양 Step 5 전제(DRY_RUN=true 관측)와 불일치 — 아래 참조 |
| `safety_kill_switch` | **true** | ⚠️ 현재 주문은 Kill Switch로 차단 중 |
| `strategy_analyst_enabled` / `hybrid_mode_enabled` | true / true | §4-1 매핑 → `engine_enabled=true`, `autopilot_mode=assist` |
| `analyst_style` | "aggressive" | D3에서 style 하드코딩 제거 대상 |
| `style_default_rsiBuyThreshold` | **없음** | override 부재 확인 → Step 4에서 38 설정 |
| strategies `backtest_interval_h` | 대부분 **0.0833**(5분), 일부 24 | 아래 Leader 결정 ② |
| `price-breakout-v1` | `enabled=0` | H4 이미 적용됨 — 건드리지 말 것 |
| MariaDB | 10.11.11, `STRICT_TRANS_TABLES` | ENUM 사고 재발 조건 그대로 존재 |

> ⚠️ **`safety_dry_run=false` + `safety_kill_switch=true`** 조합에 주의. 사양 Step 5는 "DRY_RUN=true로 3영업일 관측"을 전제하는데 현재는 DRY_RUN이 꺼져 있고 Kill Switch로 막혀 있다. **이번 task에서는 둘 다 건드리지 않는다**(사용자 지시). Step 5 진입 시 사용자에게 어느 쪽으로 관측할지 확인해야 한다.

## 🧭 Leader 결정 2건 (사양이 leader에게 남긴 항목)

### 결정 ① `ENGINE_ENABLED=false`일 때 exit-engine은 **계속 작동시킨다** (사양 권고 채택)

**근거**:
- `ENGINE_ENABLED`는 **신규 진입 생성**의 스위치다. 보유 종목 청산(손절·트레일링)은 기회 포착이 아니라 **리스크 관리** 기능이다.
- 사용자가 엔진을 끄는 의도는 "새로 사지 마라"이지 "이미 산 것의 손절도 하지 마라"가 아니다. 후자로 해석하면 **보유 포지션이 무방비로 방치**되어 엔진을 켠 상태보다 오히려 위험하다.
- "전부 멈춤"은 이미 **KILL_SWITCH**가 담당한다. `ENGINE_ENABLED`가 그 의미를 중복하면 스위치 이중 의미 문제([[T-003-phase2-pipeline-redesign]] 사망원인 #1의 `ANALYST_ENABLED`)를 **다시 만드는 셈**이다. 이번 재설계의 취지에 정면으로 반한다.

**필수 동반 조치** (오해 방지):
- UI 라벨을 명시적으로: `엔진 중지 (신규 진입만 중단 — 보유 종목 청산 보호는 계속됩니다)`
- `ENGINE_ENABLED=false` 런에서도 **run 행을 eval_funnel에 기록**해 exit 트랙이 돌았음이 관측 가능해야 한다.

### 결정 ② `backtest_interval_h`는 **6h로 리셋하되, 일회성 마이그레이션으로만** 한다

**근거**:
- 0.0833h(5분)은 백테스트 주기로 무의미하다는 analyst 판단에 동의. Phase 2에서 `next_backtest_at`이 **평가 경로에서 완전히 분리**되므로 이 값은 백테스트 스케줄 의미만 남는다.
- 다만 **코드가 부팅 시 strategies 값을 강제로 덮어쓰는 방식은 절대 금지**한다 — 그것이 정확히 D3가 제거하려는 `db.ts:374-377` 부팅 재동기화 안티패턴이고, 사용자 UI 토글을 무효화했던 원인이다.
- 따라서 [[T-002-phase1-eval-funnel]] H4에서 `price-breakout-v1` 비활성화에 썼던 **`runOnceMigration` 일회성 마이그레이션 패턴**을 그대로 사용한다(마커로 1회만 실행 보장).

**적용 범위 (좁게)**:
- `backtest_interval_h = 0.0833333`인 행만 **6**으로. 24인 행(일봉 전략: eod-high-close·inside-bar·oversold-bounce-daily)은 정당한 값이므로 **건드리지 않는다.**
- `next_backtest_at`은 NULL로 초기화(다음 백테스트 스케줄러가 재계산).
- **`enabled` 컬럼은 절대 건드리지 않는다** — UI가 진실.

## 제약 (위반 시 운영 파손)

- **NFS 워킹트리에서 `npm run build` 금지** — 이 경로가 운영 배포 경로이고 pm2가 이 `.next`를 서빙 중이다. 검증은 `npm run typecheck` + `npm test`. 실빌드 검증이 필요하면 [[T-005-next15-upgrade]]에서 쓴 로컬 ext4 격리 클론(`~/.node-local/stockinvest-upgrade`) 방식 사용.
- **NFS에서 `npm install`/`npm ci` 금지.**
- **pm2 restart/reload 금지.**
- **git commit/push 금지** — 실거래 코어 로직이라 특히 신중히. 전체 검증 통과 후에도 사용자 승인 필수.
- **운영 DB는 SELECT만.** 스키마 변경은 **`src/lib/db.ts`의 부팅 시 idempotent DDL로만**. 수동 ALTER 실행 금지.
- **DB는 확장만, 축소 금지** — ENUM 값 제거·재배열 금지(합집합 확장만). 모든 롤백이 코드 revert만으로 끝나야 한다.
- **안전장치 우회·완화 금지** — `DRY_RUN`/`KILL_SWITCH`/주문한도/블랙리스트는 이번 재설계로 **동작이 달라지면 안 된다**(§6-6 안전 회귀 기준).
- **`safety_dry_run`·`safety_kill_switch` 값을 건드리지 말 것.**
- 시크릿 출력 금지.

## 구현 단계 (사양 §5)

| Step | 내용 | 상태 |
|---|---|---|
| 0 | `pending_approval` ENUM | ✅ **이미 완료 — 스킵** |
| 1 | DB 확장: status ENUM 합집합, `cooldowns` 생성, `engine_enabled`/`autopilot_mode` 시드 | ⬜ |
| 2 | 상태·스위치 코드(D2): router/service, createSignal try/catch, **부팅 시 ENUM 검증** | ⬜ |
| 3 | 게이트 체인 재편(D1+D4): engine.ts 4단계, market-state 라벨화, 장중 AI 제거, 통합 쿨다운, eval_funnel 연동 | ⬜ |
| 4 | 룰·seed(D3): 1h 통일, FIND_IN_SET·부팅 재동기화 제거, 기본 활성 5종, rsiBuyThreshold=38 등 DB override | ⬜ |
| 5 | DRY_RUN 관측 → 실거래 해제 | ⛔ **이번 범위 밖** |

## Developer 섹션

- [10:16] **Step 1·2 구현 완료** (Step 3·4는 이번 범위 밖). `npm run typecheck` 통과, `npm test` **41 suites / 444 tests 전부 통과** (베이스라인 40/413 → 신규 테스트 31건 추가). 빌드·install·pm2·commit·수동 DDL 전부 미실행.
- [10:16] **신규 파일** `src/lib/signals/statuses.ts` — signals.status 의 단일 진실. import 0개 순수 모듈이라 db.ts·서버·클라이언트가 전부 같은 목록을 본다. `SIGNAL_STATUSES` 에서 DDL 을 생성하고 부팅 시 INFORMATION_SCHEMA 와 대조한다(코드 목록과 DB 목록이 갈라질 수 없게 만든 것이 T-002 H1 의 구조적 해소).
- [10:16] **ENUM 합집합 확장** — 운영 실측 10개를 순서 그대로 앞에 두고 뒤에 `detected`·`awaiting_approval`·`skipped` 3개만 append (총 13). 제거·재배열 0건. `statuses.test.ts` 가 "운영 10개가 같은 순서로 앞에 남아있음"을 테스트로 고정한다. ALTER 는 **빠진 값이 있을 때만** 1회 실행(부팅마다 운영 테이블을 건드리지 않는다).
- [10:16] **부팅 fail-closed 검증** — 코드 상태가 ENUM 에 없으면 `SignalStatusEnumMismatchError` throw → `setupFatalError` 설정 → 이후 **모든 `getPool()` 이 throw**(주문·시그널·조회 전부 차단). `/api/health` 에 `schemaFatal` + `safetyReasons: schema_verification_failed` 노출. QA 재현 스위치: `SIGNAL_STATUS_ENUM_AUTO_ALTER=false` (자동 확장 ALTER 를 끄고 코드 상태를 추가하면 기동 실패 — 운영 ENUM 을 오염시키지 않는다).
- [10:16] **`cooldowns` 생성** — 사양 문안의 NULL 허용 대신 `strategy_id`/`side`/`exit_kind` 를 `NOT NULL DEFAULT ''` 로. MySQL/MariaDB UNIQUE 는 NULL 을 서로 다른 값으로 취급해서, NULL 로 두면 `scope='rebuy'`(키가 symbol 뿐)에서 UNIQUE 가 아예 안 걸려 행이 무한 증식하고 `ON DUPLICATE KEY UPDATE` 로 쿨다운을 **갱신·해제할 수 없다**. `exit_kind` 컬럼은 §4-3 DDL 문안엔 없지만 같은 절 키 정의표가 exit 키를 (symbol, exit_kind)로 규정 → 문안 누락으로 판단해 추가.
- [10:16] **config 시드** — `engine_enabled`/`autopilot_mode` 를 구 키에서 파생해 **INSERT IGNORE 만** 사용(기존 값 절대 미변경). 구 키 보존. 운영 실측 analyst=T·hybrid=T → `engine_enabled=true`, `autopilot_mode=assist`.
- [10:16] **⚠️ 발견·대응 — 무반응 스위치 위험**: 설정 UI(`/api/settings/safety`, `/api/settings/hybrid`)는 아직 **구 키만** 쓴다. 신규 키 시드 후 `getEngineSwitches()` 가 신규 키를 우선 읽으므로, 그대로 두면 **사용자가 UI 토글을 눌러도 파이프라인이 옛 값에 갇히는** 사고(db.ts:374 재동기화 스카와 동종)가 발생한다. → 두 PATCH 엔드포인트에 `syncEngineSwitchesFromLegacy()` write-through 추가. 덮어쓰기는 **사용자 행위 경로에서만**, 부팅 경로는 INSERT IGNORE 유지.
- [10:16] **`ENGINE_ENABLED=false` 동작** (Leader 결정 ① 반영): runMarket 이 신규 진입 평가만 건너뛰고 **exit-engine 은 그대로 실행**한다. `engine_disabled` 게이트 + `run` 행(verdict=skip, reason=engine_disabled)을 eval_funnel 에 남겨 exit 트랙이 돌았음이 관측된다. `fullEvalRuns` 통계를 부풀리지 않도록 verdict 는 pass 가 아니라 skip.
- [10:16] **createSignal 호출부 전수 보호** — 코드 전체 호출부 3곳(`engine.ts` 는 `createSignalGuarded` 경유, `api/signals` POST, `api/analyst/run`) 전부 try/catch. analyst/run 은 심볼 단위 catch 뿐이라 **같은 심볼의 후속 시그널이 통째로 유실**되던 것을 시그널 단위 catch 로 교정.
- [10:16] **exit 쿨다운 상태 목록**을 코드 상수(`ACTIVE_SIGNAL_STATUSES`)로 교체. assist 가 `awaiting_approval` 로 쓰기 시작하는 순간 구 하드코딩 목록으로는 쿨다운이 다시 무효가 되어 **중복 청산**이 났을 지점이다(T-002 H3 재발 직전이었음).
- [10:16] **읽기 호환 전수 반영** — signal-expiry cron / favorites / custom-confirm / recommend / Dashboard / FavoritesPage / FavoriteDetail / SignalFeed STATUS_META. 구 `pending`·`pending_approval` 과 신규 `awaiting_approval`·`detected` 를 함께 조회·표시한다.
- [10:16] **Leader 판단 요청 3건** (아래 "미해결·에스컬레이션" 참조): ① assist 에서 hard_stop 자동제출 = 실동작 변경, ② `dueStrategies=0` 일 때 exit-engine 미실행 구멍, ③ 승인 라우트가 아직 `hybrid_mode_enabled` 에 묶여 있음.

### Step 3 (게이트 체인 재편 D1+D4) — 2026-08-06

- [11:40] **Step 3 완료.** `npm run typecheck` 통과, `npm test` **43 suites / 480 tests 전부 통과** (Step 2 기준 41/444 → 신규 36건). 빌드·install·pm2·commit·수동 DDL 미실행, `src/lib/safety/*` 무변경.
- [11:40] **reviewer 지적 4건 반영**: ① ALTER 에 `ALGORITHM=INSTANT, LOCK=NONE` 고정(거부 시 `INPLACE, LOCK=NONE` 로만 재시도 + critical 알림, 알고리즘 미지정 형태로는 절대 재시도 안 함) ② `readSignalStatusColumnType` 조회 실패를 `SchemaVerificationError` throw 로 전환 — "검증 불가"를 "통과"로 취급하지 않는다 ③ `setupFatalError` 시 `sendAlert('critical')` + `/api/health` 가 `ok:false` + HTTP 503 ④ auto 모드 비보호 청산 금액상한 이슈는 동작 변경 없이 `router.ts` auto 분기에 T-006 마커 주석만 남김.
- [11:40] **게이트 체인 4단계 재편** — ① 실행자격(fail-closed) / ② 룰 발화 / ③ 억제(fail-open) / ④ 안전·집행. 삭제 7종(`strategy_throttled`·`no_due_strategies`·`skip_seal_24h`·`prefilter_strong_counter_trend`·`prefilter_bypassed_no_summary`·`ai_input_no_summary`·`market_state_preclassify_failed`), AI 게이트 7종 전부 삭제, 라벨 강등 2종(`market_state_rule_inactive` 소멸 / `portfolio_core_ratio` assist 에서 경고).
- [11:40] **exit-engine 무조건 실행** — 개장 확인 직후, 엔진 스위치·활성 전략 수·평가 주기 **이전**으로 이동. 이전 라운드에 보고한 `dueStrategies=0` 구멍이 구조적으로 소멸.
- [11:40] **market-state 라벨 강등** — `STATE_RULES`·`getRulesForState`·`ALWAYS_ACTIVE_RULES` 삭제. 라벨은 `candidate.indicators.market_state` + collect 행 detail 에 기록. `MARKET_STATE_LABEL_KO` 추가(승인 카드용).
- [11:40] **1h 단일축** — `resolveEngineInterval()` 로 장중 전부 1h 강제 + `STRATEGY_REGISTRY` 선언값도 1h 로 변경(백테스트 축 일치). `adaptive-interval` 은 엔진 경로에서 분리(모듈 보존). market-state 라벨·룰 지표·프리필터가 **같은 1h summary 객체** 사용.
- [11:40] **통합 쿨다운** — 신규 `src/lib/strategy/cooldowns.ts`. 런당 1쿼리로 전건 로드 → 메모리 판정. entry 2h(사람 거부 4h) / rebuy 30m / exit 15m. regime 버킷 키 제외. 조회 실패 fail-open + `cooldown_lookup_error` 기록. `ON DUPLICATE KEY UPDATE until=GREATEST(...)` 로 쿨다운이 짧아지지 않게 보장.
- [11:40] **`prefilter_blowoff_top` 교정** — `>30%`(국내 상한가 30% 라 도달 불능인 사문) → `priceChange5>10% && rsi14>80`. 실효 창은 RSI ∈ (80,85) — 85 이상은 `rsi_extreme_counter` 가 먼저 잡는다.
- [11:40] **`liquidity_dead` 시간축 등가 환산** — 축이 30m→1h 로 바뀌었으므로 임계를 2봉→1봉으로. 벽시계 기준 동일(1시간). 그대로 뒀으면 2시간 무거래를 요구해 상장폐지 탐지가 **둔감해질** 뻔했다.
- [11:40] **`regime_gate_macro_error` 기록 추가** — 기존엔 `console.warn` 만 하고 eval_funnel 무기록이었다. fail-open 유지 + error 기록.
- [11:40] **`next_backtest_at` 겸직 해소** — 평가 경로가 이 컬럼을 읽지도 쓰지도 않는다(런 종료 시 재기록도 삭제).

### Step 4 (룰·seed D3) — 2026-08-06

- [12:50] **Step 4 완료 = Phase 2 Step 0~4 전체 구현 완료.** `npm run typecheck` 통과, `npm test` **45 suites / 504 tests 전부 통과** (Step 3 기준 43/480 → 신규 24건).
- [12:50] **일회성 마이그레이션 3종 추가** (전부 `runOnceMigration` 마커 패턴 — 마커 존재 시 즉시 return, 재실행 없음):
  - `migration_phase2_default_active_rules` — 활성 5종 `WHERE id IN (...) AND enabled = 0`, 비활성 7종 `WHERE id IN (...) AND enabled = 1`
  - `migration_phase2_backtest_interval_reset` — `backtest_interval_h < 1` 행만 6 + `next_backtest_at=NULL` (FLOAT 등가 비교 회피, 24h 행 미변경, `enabled` 미변경)
  - `migration_phase2_backtest_cost_model` — `backtest_fee_pct` 0.05→0.09 / `backtest_slip_pct` 0.10→0.15, **구 기본값과 정확히 일치할 때만**
- [12:50] **부팅 재동기화 제거** — `UPDATE strategies SET applicable_styles = ?` (구 db.ts:374-377) 삭제. 이제 부팅 시 `strategies` 무조건 UPDATE 는 0건이다.
- [12:50] **FIND_IN_SET 제거** — 엔진 쿼리가 `WHERE enabled = 1` 뿐. `getAnalystStyle()` async 하드코딩 삭제 → 프롬프트 표기용 `ANALYST_STYLE_LABEL` 상수로 축소(chat 2곳만 사용, 실행 경로 무관).
- [12:50] **파라미터는 전부 DB override 시드** (코드 default 무변경): `rsiBuyThreshold=38`, `pullbackRsiMin/Max=40/50`, `bbSqueezeVolRatioMin=1.2`, `feePct=0.18`, `slippagePct=0.15`. 롤백 = 키 삭제.
- [12:50] **비용 모델 분리** — 하드코딩 0.43% → `feePct`(명시) + `slippagePct`(체결품질) 2개 파라미터. `roundTripCostPct()` 헬퍼 + EV 하한(T ≥ S+2C = 1.83%)을 테스트로 고정.
- [12:50] **사문 가드 제거** — `pullback-trend` 의 `rsiSellPriceMult > 1.0`. 나머지 4개 룰(triple-confirmation·rsi-macd-reversal·rsi-divergence·volume-spike-breakout)은 사양 범위 밖이라 유지 — 전부 기본 비활성이라 실효 영향 0.
- [12:50] **`FEE_BUFFER_PCT` 는 비용만 갈아끼우고 micro 여유분 0.07% 는 유지**했다. 비용 재도출(0.5%→0.33%)을 그대로 반영하면 시그널 산출~주문 송신 사이 가격 변동 흡수분이 0 이 돼 `order_limit` 거부가 늘어난다.
- [12:50] **신규 순수 모듈** `src/lib/strategy/rules/defaults.ts` — 활성/비활성/미변경 목록을 상수화해 테스트로 오타·중복·소유권 침범을 차단(일회성 UPDATE 라 두 번째 기회가 없다).

### Step 3 reviewer HIGH/MEDIUM 반영 — 2026-08-06

- [13:40] **HIGH — 구 "하이브리드" 토글이 무표시 auto 진입로였던 문제 해소.** `npm test` **46 suites / 523 tests** 통과 (직전 45/504).
- [13:40] **불변식 확립**: `auto` 는 **오직 `autopilot_mode` 직접 기입(또는 `AUTOPILOT_MODE` env)으로만 존재한다.** 부팅 시드·런타임 동기화·읽기 시 구 키 추론·env 구 조합 추론 = **전부 assist 상한**.
- [13:40] **신규 순수 모듈** `src/lib/signals/autopilot.ts` — `MAX_INFERRED_AUTOPILOT_MODE='assist'`, `clampInferredMode()`, `inferAutopilotModeFromLegacy()`. router↔db 순환을 피하려 분리(부팅·런타임이 같은 규칙을 본다). 사양 §4-1 표(`legacySwitchesToMode`)는 *마이그레이션 의미*로 그대로 보존 — 제약 대상은 표가 아니라 호출부.
- [13:40] **런타임 동기화는 `autopilot_mode` 를 아예 쓰지 않는다** (Leader 지시의 "clamp" 보다 한 단계 강하게). 구 토글 어느 쪽도 자율성을 말하지 않고, 하이브리드의 실제 의미(진입감시 vs 즉시 승인)는 `/api/signals/[id]/approve` 가 `hybrid_mode_enabled` 를 직접 읽어 이미 처리하므로 재파생 자체가 불필요했다(Step 2 의 과잉). 상향(무표시 auto)·하향(명시 auto 를 무관한 토글이 되돌림) 양방향 사고를 동시에 차단. `engine_enabled` 동기화는 그대로 유지.
- [13:40] **부팅 시드도 클램프**(선택지 4b). 부팅·런타임에 다른 매핑을 두면 같은 구 설정이 경로에 따라 다른 모드를 낳는 이중 의미가 재발한다. 운영값(hybrid=true→assist)은 영향 없고, 영향받는 조합(analyst=T,hybrid=F)도 auto→assist 안전 방향뿐.
- [13:40] **UI 레이블 교체** — 섹션 "하이브리드 매매 모드"→"승인 방식", 항목 "승인 후 진입 감시 (하이브리드)". OFF 설명을 "기존 즉시 승인 방식"→"승인하면 즉시 주문"으로 바꾸고, "어느 쪽이든 사람이 승인해야 주문이 나가며 무인 주문은 `autopilot_mode` 에서만 켤 수 있다"는 안내 추가.
- [13:40] **MEDIUM #2 — ALTER 재시도 실패 fail-closed 수렴.** `INPLACE, LOCK=NONE` 재시도가 throw 하면 `SchemaVerificationError` 로 감싸 `setupFatalError`·`notifyCritical`·`/api/health` 503 경로를 타게 했다(읽기 경로와 동일 원칙을 실행 경로로 확장).
- [13:40] **회귀 테스트** `src/lib/signals/__tests__/autopilot-clamp.test.ts` (18건) — 구 키 4조합 전수에 대해 동기화·읽기·env 경로가 auto 를 만들지 않음을 고정. 명시 기입 auto/manual 은 존중됨도 함께 고정.
- [13:40] **기존 테스트 5건이 실패 → 의도된 변경.** `ANALYST_ENABLED=true` 만으로 auto 를 기대하던 케이스들. 명시적 `AUTOPILOT_MODE=auto` 를 설정하도록 갱신(새 계약을 테스트가 문서화) + "구 스위치만으로는 자동 제출되지 않는다" 회귀 테스트 신규 추가.

### reviewer MEDIUM(UI 과대 안전 보장)·LOW(주석 정확도) 반영 — 2026-08-06

- [14:20] **MEDIUM — UI 카피의 거짓 안전 보장 제거.** 직전 문구 "어느 쪽이든 사람이 승인해야 주문이 나갑니다"는 **거짓**이었다. `routeSignal()` 은 `hard_stop`·`eod_loss_cut` 청산을 모드·이 토글과 무관하게 무조건 자동 제출한다(Leader 승인·사양 §4-1). UI 의 거짓 안전 보장은 모호한 문구보다 나쁘다.
  - 승인 보장을 **신규 진입(매수) 주문으로 한정**
  - **예외를 별도 경고 블록(주황 배경)으로 분리 노출** — 묻히지 않게
  - 검증된 좁은 주장(이 스위치로는 자동 진입이 켜지지 않는다)은 유지
  - 카피가 서술하는 동작은 `router.test.ts` 의 기존 3개 테스트(hard_stop/eod_loss_cut 모드 무관 자동 제출, target_profit·trailing 은 승인 경로)로 이미 고정돼 있어 문구와 코드가 함께 검증된다.
- [14:20] **LOW — `AUTOPILOT_MODE` env 설명 정정.** 부팅 시드가 `engine_enabled`·`autopilot_mode` 를 심으므로 `hasNew` 가 항상 참 → env 폴백은 **DB 조회 실패 시에만** 도달하는 사실상 사문. 이를 "명시적 동의 채널"로 서술하던 주석 3곳(`autopilot.ts` 2곳, `router.ts` env 폴백 + auto 분기)을 정정: **`auto` 의 실질 유일 경로는 `system_config.autopilot_mode` 직접 기입(수동 DB/API 조작)** 이며 이 앱에 그 값을 쓰는 UI·코드 경로는 없다. 동작 변경 없음(문서 정확도만).
- [14:20] 검증: typecheck 통과, `npm test` **46 suites / 523 tests** — 베이스라인과 동일(카피·주석만 변경, 테스트 수정 0건).

### 미해결 · Leader 판단 요청

1. **assist/manual 에서도 `hard_stop`·`eod_loss_cut` 은 모드 무관 자동 제출** — 사양 §4-1 그대로 구현했으나, 현행 운영(hybrid=true)에서는 이 청산들이 **사람 승인**을 거쳤다. 배포되면 사람 개입 없이 시장가 매도가 나간다(단 `submitOrder` 경유라 DRY_RUN·KILL_SWITCH·한도·블랙리스트는 그대로 적용, 현재 KILL_SWITCH=true 로 차단 중). 기존 탈출구는 `exit_hard_stop_enabled=false`. **실거래 해제 전 사용자 확인 필요.**
2. **`dueStrategies.length === 0` 조기 return 경로에서는 exit-engine 이 실행되지 않는다** (기존 코드 그대로). 엔진 OFF 면 청산이 돌고 엔진 ON + 전 전략 throttle 이면 안 도는 비대칭이 남는다. 운영 `backtest_interval_h=0.0833` 이라 실제로 발생 가능. 결정 ①의 논리("보유 무방비 방치 금지")가 그대로 적용되지만 게이트 체인 재편(Step 3)의 영역이라 **이번엔 건드리지 않았다.** Step 3 우선 항목으로 올린다.
3. **승인 라우트(`/api/signals/[id]/approve`)는 아직 `hybrid_mode_enabled` 로 분기**한다. assist 의 두 승인 방식(즉시 승인 → `approved`+주문 / 지정 진입가 승인 → `approved_pending_entry`)을 모드 하나로 가를지, 요청 파라미터로 가를지는 UI 결정이 필요해 보류. 현재 동작은 배포 전후 동일.
4. **`post-market-engine` 은 여전히 `status='pending'` 으로 INSERT** 한다(구 값). ENUM 에 있고 승인 판정도 호환되므로 무해하나, 신규 어휘 통일은 Step 3/4 로 미뤘다.
5. **`ai_skipped` 쓰기도 그대로 유지**했다. `skipped` 로 바꾸면 analytics·RAG 백필의 `status='ai_skipped'` 쿼리가 다수 깨진다 — Leader 승인으로 이관하지 않는다(기존 13,811행).

### Step 3 이후 미해결 · Leader 판단 요청 (추가)

6. **Step 4 전까지 심볼당 시그널 수의 유일한 상한은 `duplicate_active_signal` 이다.** market-state 게이팅이 사라졌는데 운영 DB 는 아직 15/16 전략이 enabled 라, 한 심볼에서 여러 룰이 동시에 발화할 수 있다. assist 모드에서는 `createSignal` 의 중복 활성 시그널 검사가 (symbol, side) 당 1건으로 자연히 묶어 준다(구 `MAX_PICKS_PER_SYMBOL=3` 을 구조적으로 대체). **다만 auto 모드의 `auto_submit` 경로는 이 중복 검사를 건너뛴다**(기존 동작) — Step 4 의 기본 활성 5종 정리 전에 auto 를 켜면 상한이 없다.
7. **rebuy 쿨다운을 "매도 체결"이 아니라 "매도 시그널 생성" 시점에 건다.** 체결 이벤트 훅이 아직 없다. 보수적 방향(차단 구간이 더 길다)이지만 사양 문안과는 다르다. 체결 동기화(`order-sync`)에 훅을 붙이는 것이 정공법.
8. **`src/lib/strategy/ai-dedup.ts` 가 완전히 미사용(dead code)이 됐다.** 삭제하지 않고 남겼다 — 되살릴 의도가 아니라, 삭제가 이번 라운드 검증 범위를 넓히기 때문이다. 다음 정리 라운드 대상.
9. **`ai-filter.ts` 는 여전히 순수 지표 계산기 `buildMarketSummary` 를 품고 있다.** engine 은 이 함수와 타입만 import 한다(AI 호출 경로 0). favorites/technical·chat/context-builder 도 같은 함수를 쓴다 — 순수 모듈로 분리하는 리팩터는 별도 backlog.
10. **`rule_no_fire`·`insufficient_candles` 는 개별 skip 행이 아니라 collect 행 detail + final 행 reason 으로 압축 기록된다**(T-002 §2 볼륨 정책 그대로). "무기록"은 아니지만 "게이트당 1행"도 아니다 — 깔때기 SQL 작성 시 유의.

### Step 4 이후 미해결 · Leader 판단 요청 (추가)

11. **기본 활성 마이그레이션은 운영자가 의도적으로 꺼둔 활성 5종을 다시 켠다.** `AND enabled = 0` 조건이라 이미 켜진 건 건드리지 않지만, 누군가 `rsi-oversold-v1` 을 일부러 꺼놨다면 Phase 2 배포 시 1회 되살아난다. 일회성 기본값 적용의 본질적 성질이고 Leader 지시대로다 — 배포 시점에만 발생하며 이후 UI 가 영구 소유.
12. **`rsiSellPriceMult > 1.0` 사문 가드가 4개 룰에 남아 있다** (triple-confirmation·rsi-macd-reversal·rsi-divergence·volume-spike-breakout). 사양 §3 이 pullback-trend 만 지목했고 나머지는 전부 기본 비활성이라 실효 영향이 없어 건드리지 않았다. 재활성화할 때 함께 제거해야 한다.
13. **`applicable_styles` 컬럼·`AnalystStyle` 타입은 남아 있다** (DB 축소 금지 원칙 + `/api/strategies`·`StrategyList.tsx` 가 표시용으로 읽음). 실행 경로는 더 이상 읽지 않는다.
14. **백테스터는 편도 단일 fee 만 받는다.** 사양 §3 은 비대칭(매수 0.014% / 매도 0.164%)이 더 정확하다고 지적하지만, 현 `backtest.ts` 시그니처가 `feePct` 하나뿐이라 왕복 0.18% 의 절반인 0.09%/편도로 근사했다. 비대칭 반영은 백테스터 구조 변경이 필요해 별도 backlog.
15. **`style_default_rsiSellPriceMult` 가 운영 DB 에 설정돼 있는지 미확인.** 설정돼 있고 값이 >1.0 이면 pullback-trend 는 지금까지 죽어 있었고 이번 가드 제거로 살아난다(의도한 방향 — 기본 활성 5종에 포함). 확인이 필요하면 배포 전 SELECT 1회 권장.

## Reviewer 섹션

- [10:30] **감사 범위**: Step 1·2 (db.ts DDL, statuses.ts, router.ts, service.ts, settings/{safety,hybrid}, health, 읽기호환 전수, 테스트). Step 3(게이트 체인)는 병행 작업 중이라 engine.ts·eval-funnel-*.ts 는 감사 제외(`git diff` 상 존재 확인만) — typecheck 로도 **에러 전부 engine.ts 에만 국한**됨을 독립 확인(다른 Step1/2 파일 0건).
- [10:30] **독립 재현**: `npm test` 41 suites/444 tests 전부 통과 확인(developer 보고와 100% 일치). `npm run typecheck` 는 engine.ts 만 에러 — Step3 진행 중 파일이라 예상된 상태.
- [10:30] **판정: PASS** (Critical 0 · High 0 · Medium 4 · Low/Info 3). 안전장치 우회 경로·자금손실 직결 결함 없음. 아래 근거.

### 1. ENUM 안전성 — 이상 없음
- `buildSignalStatusEnumDDL()` 이 `SIGNAL_STATUSES`(운영 실측 10개 순서 보존 + 3개 append)에서 결정론적으로 DDL 생성 → `statuses.test.ts` 가 순서·부분집합·중복을 테스트로 고정. ALTER 는 `findMissingSignalStatuses().length>0` 일 때만 실행(매 부팅마다 운영 테이블 안 건드림).
- 동시 부팅 ALTER: 현재 `ecosystem.config.js` 확인 결과 `stockinvest`·`stockinvest-cron` 모두 `instances:1`(cron은 별도 프로세스가 아니라 `cron-runner.sh`가 curl 로 같은 3003 포트를 때리는 방식) → **실질적으로 동시 다중 워커 ALTER 시나리오 자체가 없음**. 가상 시나리오로도 DDL 이 결정론적이라 두 번 실행돼도 최종 스키마가 같아 손상 위험 없음(MDL 락으로 직렬화, 낭비만 발생).
- (Low #5) 단, `ALGORITHM=INSTANT, LOCK=NONE` 을 명시하지 않아 MariaDB 가 암묵적으로 알고리즘을 고른다. append-only ENUM 변경은 통상 INSTANT 가 되지만, 명시하지 않으면 향후 버전·조건 차이로 조용히 COPY 로 폴백해 13,811행 테이블에 배타 락을 걸 가능성을 배제 못한다. 명시해서 안 되면 즉시 실패하게 만들 것을 권고.

### 2. 부팅 fail-closed 검증 — 핵심 경로는 견고, 관측성에 공백
- **주문 경로 재확인**: `submitOrder()`(`src/lib/safety/dry-run.ts:98`)의 **첫 실행문이 바로 `const pool = getPool()`** 이고 try/catch 밖에 있다 — `setupFatalError` 가 서 있으면 orders INSERT 는 물론 `realSubmit`(거래소 호출, 184행)에 도달하기 전에 무조건 throw. `isKillSwitchActive()`/`isDryRun()` 이 DB 오류 시 env 폴백으로 넘어가는 관대한 경로(`kill-switch.ts:44`, `dry-run.ts:52`)가 있지만, **schemaFatal 상태에서는 애초에 그 지점까지 도달하지 못하므로 무관**하다. → 주문에 대한 fail-closed 주장은 코드로 확인됨.
- (Medium #2) `readSignalStatusColumnType()`(db.ts) 이 INFORMATION_SCHEMA 조회 자체에 실패하면 `''` 를 반환하고, `findMissingSignalStatuses('')` 는 빈 배열을 반환해 **검증이 조용히 스킵**된다(주석상 의도적 — "DB 일시 장애로 기동을 막지 않는다"). 즉 "부팅 시 검증한다"는 1차 방어선이 그 자체로 fail-open 경로를 갖고 있다. `createSignal` 호출부 전수 try/catch(§7)가 2차 방어선으로 실제 INSERT 실패를 흡수하므로 크래시는 안 나지만, 검증이 스킵됐다는 사실 자체가 로그(`console.warn`) 외엔 아무 데도 남지 않는다.
- (Medium #1) **`setupFatalError` 발동 시 `sendAlert()` 가 전혀 없다.** 이 프로젝트는 kill_switch 차단(`markBlocked`)·플래그 파싱 실패(`reportUnparsableKillSwitch`) 등 덜 치명적인 이벤트에도 `sendAlert('critical'|'warning', ...)` 로 텔레그램/슬랙 푸시를 보내는 관례가 있는데, **이번에 새로 만든 가장 치명적인 실패 모드(전체 DB 접근 차단)만 푸시 알림이 없다.** `/api/health` 의 `ok` 필드는 schemaFatal 여부와 무관하게 **항상 `true`** 로 고정돼 있어(`health/route.ts:68`), HTTP 200/`ok` 만 보는 외부 모니터는 이 상태를 못 잡는다 — `safetyStatus`/`schemaFatal` 필드를 별도로 봐야 한다. 배포 전 `ensureSetup()` catch 블록(db.ts:86 부근)에 critical alert 추가를 권고.
- (Medium #3) `SIGNAL_STATUS_ENUM_AUTO_ALTER` — 기본값(미설정 시 `true`)은 안전하다(현재 `.env` 에도 없음 = 자동 확장 켜짐, 확인 완료). 다만 **현재 운영 ENUM 은 정확히 10개뿐이라, 이 값을 `false` 로 잘못 배포하면(예: QA용 `.env` 를 실수로 복사) 부팅 즉시 `assertSignalStatusEnum` 이 던지고 이 프로세스는 그대로 전체 wedge** 된다(위 Medium #1 과 겹쳐 알림도 없이). 위험 자체는 "의도적 오조작"이 전제라 CRITICAL 로 올리진 않지만, `.env.example`/배포 문서에 굵게 경고를 남길 것을 권고.
- (Low #6) `getPool()` 은 최초 호출 시 `ensureSetup()` 을 fire-and-forget 으로 걸고 pool 을 즉시 반환한다(db.ts, 이번 diff 이전부터 있던 패턴). 콜드부팅 직후 ALTER 완료 전에 들어온 요청이 신규 상태(`awaiting_approval` 등)로 INSERT 를 시도하면 STRICT 모드 에러가 날 수 있으나, §7 의 `createSignal` try/catch 가 이를 `signal_create_failed` 로 흡수한다 — 런 전체를 죽이진 않는다. 이 diff 가 만든 회귀는 아니고 기존 아키텍처 특성이라 정보 제공 차원.

### 3. `cooldowns` 스키마 — 추론·구현 모두 타당
- `NOT NULL DEFAULT ''` 센티넬 근거(MySQL/MariaDB UNIQUE 가 NULL 을 서로 다른 값으로 취급 → NULL 허용 시 `scope='rebuy'` 처럼 일부 키가 없는 행에서 UNIQUE 가 사실상 무력화) 확인함, 정확하다.
- `UNIQUE KEY uq_cooldown (scope, symbol, strategy_id, side, exit_kind)` 로 세 scope 전부 검증: entry=(symbol,strategy_id,side,'') / rebuy=(symbol,'','','') / exit=(symbol,'','',exit_kind) — 스펙 §4-3 키 정의표와 1:1 일치, 센티넬 조합이 서로 다른 의미의 행을 잘못 합치는 경우 없음.
- `exit_kind` 컬럼 추가는 T-003 §4-3 키 정의표(exit=(symbol,exit_kind))와 DDL 문안 간 불일치를 올바르게 짚은 것 — DDL 문안 쪽이 누락이었다는 developer 판단에 동의.
- 단, Step1/2 범위에서는 `cooldowns` 테이블을 실제로 읽고 쓰는 코드가 아직 없음(grep 확인 — 사용처는 전부 engine.ts, Step3). Step3 리뷰 때 삽입/조회 쿼리가 이 UNIQUE 제약과 정합되는지(예: INSERT ... ON DUPLICATE KEY UPDATE 가 5개 키 컬럼 전부를 채우는지) 재확인 필요.

### 4. 시드 비파괴성 — INSERT IGNORE 확인, precedence 도 안전 방향으로 수렴
- db.ts 신규 시드 블록은 `INSERT IGNORE` 만 사용(코드 재확인 완료) — 부팅 경로에서 기존 값 덮어쓰기 없음.
- `syncEngineSwitchesFromLegacy()` 는 `/api/settings/hybrid` PATCH 에서 무조건 호출(hybrid PATCH 는 매번 `hybrid_mode_enabled` 를 바꾸므로), `/api/settings/safety` PATCH 는 `'analystEnabled' in body` 일 때만 호출 — 관련 없는 필드만 바뀌는 저장 요청에서 불필요한 재계산을 안 하도록 정확히 스코프됨.
- **converse 확인**: `getEngineSwitches()` 의 `hasNew = cfg.has('engine_enabled') || cfg.has('autopilot_mode')` 가 OR 조건이라 신규 키 중 하나만 있어도 신규 키 우선 분기를 타지만, 개별 키가 없으면 그 필드만 구 키로 폴백(`engineEnabled = cfg.has('engine_enabled') ? … : legacy`, `autopilotMode` 도 동일 패턴)해서 **부분 시드 상태에서도 자가치유**한다. UI(구 키 PATCH)→sync(신규 키 갱신)→getEngineSwitches(신규 키 우선 판독) 체인이 끊기지 않는 한 UI 와 파이프라인 불일치는 재현 못 함. 단, sync API 를 거치지 않고 DB 를 직접 조작(수동 SQL)하면 신규 키가 stale 해질 수 있음 — 이는 설계상 의도된 범위 밖(운영 DB 직접 조작은애초에 감사 대상 아님)이라 결함으로 잡지 않음.

### 5. `routeSignal()` — 전이표 대부분 일치, auto 모드 exit 처리에 스펙 해석 이견
- manual/assist/auto 기본 분기, hard_stop·eod_loss_cut 모드 무관 강제 auto_submit(§4-1 손실 확대 방지) 전부 코드·테스트 일치 확인.
- **cap 미집행 주장 검증**: `.env` 에 `SIGNAL_AUTO_SUBMIT_MAX_KRW` 존재 확인(값은 비공개) — "설정은 있었지만 라우팅에 전혀 반영 안 됐었다"는 developer 주장과 부합. 이번 구현이 처음으로 실제 적용.
- (Medium #4) §4-1 표의 auto 행 exit-engine 열 "전부 auto 제출" 을 문자 그대로 읽으면 **금액 상한과 무관하게** exit 은 전부 자동 제출돼야 하는데, 현재 `routeSignal()` 은 `hard_stop`/`eod_loss_cut` 이 아닌 청산(`target_profit`,`trailing_stop`)을 일반 신호와 동일하게 auto 모드의 `amount≤cap` 분기에 태운다 → 금액이 크면 assist 로 격하(`awaiting_approval`)돼 사람 승인을 기다리게 된다. "손절류만 강제, 익절/트레일링은 승인 경로"라는 assist 행의 설계 철학과 일관되게 읽으면 정당화되지만, 스펙 문구만 보면 반대로 해석 가능 — **auto 모드가 실제로 켜지기 전에** leader/analyst 확인 필요. 현재 운영 모드는 assist 라 지금 당장 영향 없음.

### 6. 하위호환 읽기 — grep 전수 재검증, 누락 없음
- `status === 'pending'` / `'pending_approval'` 리터럴 비교를 프로젝트 전역 grep 으로 재검사 — 시그널 status 관련 잔존 리터럴은 주석·문자열(로그 메시지)뿐, 실제 분기 로직은 전부 `isAwaitingApproval()`/`AWAITING_APPROVAL_STATUSES`/`normalizeSignalStatus()` 경유로 교체됨(favorites, dashboard, signal-expiry cron, recommend, SignalFeed 확인).
- `STATUS_META: Record<SignalStatus, …>`(SignalFeed.tsx) 가 타입 레벨에서 13개 상태 전부를 강제 — 신규 상태 추가 시 컴파일 에러로 걸림. 좋은 구조적 안전장치.

### 7. `createSignal` 호출부 — developer 주장 독립 재확인, 추가 미가드 지점 없음
- `grep "createSignal("` / `grep "INSERT INTO signals"` 재실행 결과 5개 파일: `service.ts`(정의 자체), `engine.ts`(createSignalGuarded — T-002 H2 부터 기존에 있던 가드, 이번 범위 아님), `api/signals/route.ts`, `api/analyst/run/route.ts` — 이 셋 모두 이번에 신규/보강된 try/catch 확인.
- 직접 `INSERT INTO signals` 를 쓰는 나머지 2곳(`custom/confirm/route.ts`, `post-market-engine.ts`)은 `createSignal()` 을 호출하지 않는 별개 경로 — 전자는 단발 요청(이미 상위 try/catch 로 500 반환), 후자는 반복문 내부에서 **개별 try/catch** 로 이미 격리돼 있음(디코전당 실패해도 나머지 심볼 계속 처리). 둘 다 원래 버그 재현 조건(런 전체를 죽이는 미가드 루프)에 해당 안 함.

### 8. 안전 레이어 — 변경 없음 확인
- `git diff --stat` 상 `src/lib/safety/*` 전부 미변경. `hard_stop`/`eod_loss_cut` 강제 auto_submit 도 `service.ts` 의 기존 `submitOrder(orderReq, kis.createOrder, {assetClass:'stock', source:'auto'})` 호출 경로를 그대로 타서(§2 에서 재확인한 guard 순서 포함) DRY_RUN/KILL_SWITCH/한도/블랙리스트 전부 유지됨.

### 종합
- **PASS** — Step1·2 는 스펙 §4-1·§4-2·§4-3 을 충실히 구현했고, 자금손실 직결 결함·안전장치 우회 경로 없음. 위 Medium 4건은 안전장치 "우회"가 아니라 **관측성 공백(알림)**·**검증 자체의 fail-open 서브케이스**·**오조작 시 전체 wedge 가능성**·**스펙 해석 이견**이다. #1(알림 추가)·#3(.env 경고 문구)은 이번 배포 전 반영 권고, #4(auto 모드 exit cap 해석)는 auto 모드 실제 활성화 전까지 결론 미룰 수 있음.
- Step3(engine.ts 게이트 체인)는 미감사 — 완료되면 특히 `cooldowns` 실제 삽입/조회 쿼리와 `ACTIVE_SIGNAL_STATUSES`/`FUNNEL_GATES` 신규 게이트(`engine_disabled`,`cooldown_entry`,`cooldown_exit`,`cooldown_lookup_error`) 사용처를 재검토 필요.

### Step 4 (룰·seed D3) — Reviewer 감사 (2026-08-06)

- [13:15] **감사 범위**: db.ts 신규 `runOnceMigration` 3종 + 부팅 재동기화 삭제, `rules/defaults.ts`(신규), `style.ts`, `rules/pullback-trend.ts`, `rules/bb-squeeze-expansion.ts`, `ai-prefilter.ts`(D3 관련 부분), `/api/backtest`·`/api/config/backtest`, 신규 테스트(`rule-defaults`·`style-overrides`·`ai-prefilter`). Step3(engine.ts 게이트 체인·cooldowns 실사용)는 병행 감사 중인 다른 reviewer 영역이라 제외 — 단 `FEE_BUFFER_PCT`(engine.ts:982-983)는 leader 지시로 교차 확인.
- [13:15] **판정: PASS** (Critical 0 · High 0 · Medium 0 · Low 2). 마이그레이션 3종 모두 운영 실측과 일치, 부팅 무조건 UPDATE 0건 확인, 안전장치 우회 없음.
- [13:15] **독립 재현**: `npm run typecheck` 클린. `npm test` — 최초 1회 실행 시 `router.test.ts` 1건·`service.test.ts` 4건 실패(모두 `AUTOPILOT_MODE` 레거시 추론이 'auto'로 승격되길 기대하는 stale assertion)를 관측했으나, 이는 **동시 작업 중이던 Step3 reviewer의 HIGH 지적("추론 경로에서 auto 로 조용히 승격되면 안 된다")을 developer 가 실시간으로 반영하는 과정 중의 과도기 스냅샷**이었다. 직후 재실행에서 **46 suites / 523 tests 전부 통과**로 안정화 확인(ledger 상 developer 최신 보고 45/504 대비 +1 suite/+19 tests — 해당 수정과 회귀 테스트가 추가된 결과로 판단). 최종 상태 기준 결함 아님 — 참고용으로만 기록.

**1) 마이그레이션 3종 — 운영 DB 실측 대조**
- `migration_phase2_default_active_rules`: `DEFAULT_ACTIVE_RULES` 5종/`DEFAULT_INACTIVE_RULES` 7종이 §3 선별표와 정확히 일치(`rule-defaults.test.ts` 오타·중복·소유권 침범 테스트로 고정). `price-breakout-v1`과 post-market 3종(`MIGRATION_UNTOUCHED_RULES`)은 양쪽 목록 어디에도 없음을 코드+테스트로 확인. `STRATEGY_REGISTRY`(13종) = 활성5 + 비활성7 + price-breakout1, 완전 분할 확인.
  - 운영 SELECT 재확인(leader preflight와 별개로 독립 실행): `backtest_fee_pct='0.05'`, `backtest_slip_pct='0.10'`(구 기본값 그대로, 아직 교정 전) — `migration_phase2_backtest_cost_model`의 `value IN ('0.05','0.0500')` 가드가 정확히 매치해 정상 발동함을 확인. `style_default_rsiSellPriceMult` 미설정도 재확인(동일 SELECT).
  - "활성 5종 UPDATE"는 leader preflight대로 production 기준 0-row 영향(이미 전부 enabled=1). "비활성 7종 UPDATE"는 실제로 6행에 영향(`ma-cross-v1`·`bb-breakout-v1`·`rsi-macd-reversal-v1`·`rsi-divergence-v1`·`triple-confirmation-v1`·`dividend-quality-buyback-v1` — 현재 enabled=1 상태였음. `volume-spike-breakout-v1`은 이미 0). 이 6행 비활성화가 이번 배포의 실질적 룰 축소 효과.
  - post-market 3종(`eod-high-close-v1`·`inside-bar-v1`·`oversold-bounce-daily-v1`) 관련 정정: `post-market-engine.ts`를 직접 확인한 결과 이 엔진은 `eodHighClose`/`insideBar`/`oversoldBounceDaily` 함수를 **하드 임포트로 직접 호출**하며 `strategies.enabled`를 조회하지 않는다(캐치 목록에도 `SELECT ... FROM strategies` 없음). 즉 이 3행의 `enabled` 값은 현재 post-market 실행에 아무 영향이 없다 — leader preflight의 "건드리면 야간 시나리오 카드가 죽는다"는 전제와 달리, 건드려도(이론상) post-market 자체는 안 죽는다. 다만 developer가 실제로 건드리지 않았으므로 결과적 안전성엔 영향 없음 — 향후 이 컬럼이 표시용 그 이상의 의미를 갖는다고 오인하지 않도록 참고만 남긴다.
- `migration_phase2_backtest_interval_reset`: `backtest_interval_h < 1` 예측대로 24 행(post-market 3종) 불가촉, 0.0833... 행만 매치. `enabled` 미참조 확인.
- `migration_phase2_backtest_cost_model`: 위 SELECT로 매치 확인 완료(운영값이 정확히 구 기본값 '0.05'/'0.10'이라 애매성 없이 발동). 이론적 엣지케이스(운영자가 우연히 같은 값으로 재설정한 경우 구분 불가)는 기존 `legacyMigrations`·`migration_disable_price_breakout_v1`와 동일한 값-일치 가드 패턴이라 이 프로젝트의 기존 관례를 벗어나지 않음 — Low.
- **트랜잭션/부분 실패**: `runOnceMigration`은 명시적 트랜잭션(BEGIN/COMMIT) 없이 pool에 개별 autocommit 쿼리를 순차 실행한다. 마커는 `fn()` 이 **resolve 한 뒤에만** INSERT 되고, 실패 시 catch 가 삼켜 다음 부팅에 `fn()` 전체가 재실행된다(재시도 자체는 확인됨 — SELECT 마커 부재 시 무조건 재실행). 부분 실패(첫 UPDATE 커밋, 두 번째 throw) 시나리오를 3개 마이그레이션 모두에 대해 추적: 세 마이그레이션의 모든 UPDATE 문이 **상태 기반 WHERE 가드**(`AND enabled=0/1`, `backtest_interval_h < 1`, `value IN (...)`)를 갖고 있어, 재실행 시 이미 전이된 행은 조건에 안 걸려 재적용되지 않고 아직 전이 안 된 행만 처리된다 — **멱등**. 명시적 트랜잭션 없이도 이번 3종은 안전하다. 다만 이 안전성은 "각 UPDATE의 WHERE가 최종상태를 조건으로 건다"는 개별 작성 규율에 의존하는 구조적 불변식이라, 향후 이 패턴에 상태-비의존 UPDATE(예: 무조건 INSERT나 카운터 증가)가 섞이면 조용히 깨질 수 있다 — 트랜잭션 부재 자체보다 "다음 사람이 이 불변식을 모르고 어길 가능성"이 Low 리스크.
- 동시성: `ecosystem.config.js` 재확인 — `stockinvest`·`stockinvest-cron` 모두 `instances:1`. 동시 다중 부팅 ALTER/마이그레이션 경합 시나리오 자체가 현재 배포 토폴로지에 없음.

**2) 부팅 재동기화 제거 — 완료 확인**
- `grep "UPDATE strategies\|UPDATE system_config" db.ts` 전수 재확인: 무조건(WHERE 없는) UPDATE **0건**. 남은 UPDATE는 전부 상태-가드(legacyMigrations의 구 설명 일치 가드 1건 — Step4 무관 기존 코드, `runOnceMigration` 마커 가드 4건, cost-model 값-일치 가드 2건)뿐. `applicable_styles` 강제 재동기화(구 db.ts:374-377)는 완전히 삭제됨.

**3) FIND_IN_SET / style 하드코딩 제거 — 실행 경로 확인**
- 프로젝트 전역 grep: `FIND_IN_SET` SQL 리터럴 0건. `getAnalystStyle()` 함수 자체가 삭제되고 `ANALYST_STYLE_LABEL` 상수로 교체 — 사용처는 chat draft/messages 라우트 2곳뿐이며 프롬프트 문구 삽입 용도로만 쓰임(주문·시그널 경로 미개입). `engine.ts`의 활성 전략 조회는 `WHERE enabled = 1` 단일 조건(923-933행) — FIND_IN_SET 완전 소멸.

**4) 파라미터 override 플러밍 — 정상 동작 확인**
- `pullback-trend.ts`/`bb-squeeze-expansion.ts` 모두 `style.pullbackRsiMin/Max`·`style.bbSqueezeVolRatioMin`을 룰 본문에서 직접 사용(코드 상수 하드코딩 제거 확인). `style-overrides.test.ts`가 override 적용·범위 밖 무시·DB 실패 폴백·창 역전(min≥max) 가드를 전부 커버. 창 역전 가드는 min/max 중 한쪽만 override 돼도(비대칭 케이스) 감지됨을 코드 레벨로 재확인(둘 다 override 여부와 무관하게 최종 `base.pullbackRsiMin >= base.pullbackRsiMax`로 판정).
- `rsiSellPriceMult > 1.0` 사문 가드는 `pullback-trend.ts`에서만 제거됨(§3 지시 범위 그대로) — `pullback-trend.test.ts` 신규 케이스가 "가드 제거 후 aggressive/neutral 스타일 결과 동일"을 회귀 테스트로 고정.

**5) 비용 모델 — `MICRO_VARIATION_BUFFER_PCT` 편차 산술 검증**
- 구 `FEE_BUFFER_PCT = 0.005`(0.5%) = "왕복 0.43% + micro 0.07%"(주석 확인). 신규: `roundTripCostPct(style)/100 + 0.0007` = `(0.18+0.15)/100 + 0.0007` = `0.0033 + 0.0007 = 0.0040`(0.4%). developer 서술("비용 0.33% + micro 0.07% 유지")과 코드가 정확히 일치 — 산술 오류 없음.
- 방법론 일관성: 구 코드도 "왕복" 수치(0.43%)를 그대로 buffer 로 썼지 편도로 나누지 않았다(주석에 "단방향 0.215%"라 병기했음에도 실제 상수는 왕복값 사용). 신규 코드도 동일하게 `roundTripCostPct`(왕복)를 그대로 쓴다 — **기존 관례와 동일한 방법론 유지**, 이번 diff 가 새로 도입한 편차가 아니다. 왕복값을 단일 주문 buffer 에 쓰는 것은 편도보다 보수적(더 큰 여유 확보)이라 leader가 제시한 "과소 buffer가 과대 buffer보다 위험"이라는 기준에서 안전한 방향.
- 결론: micro 여유분 유지 결정은 근거(comment)와 실제 조치가 일치하고, 산술도 정확하다. 0.5%→0.4%로 buffer가 20% 축소됐지만 축소분 전액이 "비용 재도출로 실측상 과대했던 부분"(0.43%→0.33%, -0.10%p)에서만 나왔고 micro 여유분(0.07%)은 그대로다 — order_limit 거부율에 대한 완충 목적은 정량적으로 보존됨.

**6) Step 3+4 결합 배포 관점**
- Step3(engine.ts)와 Step4(db.ts·rules·style)는 물리적으로 같은 파일트리·같은 미커밋 diff 안에 있어, 이 워킹트리를 그대로 배포(pm2 재기동)하면 두 Step이 **구조적으로 분리 불가능하게 함께 적용**된다 — 별도 feature flag나 부분 배포 경로가 없음을 확인. Leader의 "Step3·4는 항상 함께 배포" 정책이 코드 구조상 자연히 강제됨.
- Step4 자체가 combined 배포를 막는 요인은 발견되지 않았다. auto 모드 관련 미해결 항목(§4-1 해석, hard_stop 무승인 자동제출)은 Step2/3 영역이며 이미 leader 판정·에스컬레이션 완료된 사안이라 중복 기록하지 않음.

**Low 이슈 2건 (모두 비차단)**
- (Low) `src/lib/strategy/__tests__/ai-prefilter.test.ts`가 `prefilterCandidate()`를 여전히 4번째 인자(`'neutral'`/`'aggressive'` 등 style 문자열)와 함께 호출한다 — 현재 시그니처는 3개 파라미터뿐(D3에서 `analystStyle` 제거). tsconfig가 테스트 파일을 typecheck에서 제외하고 jest가 `@swc/jest`(타입체크 없는 트랜스파일러)를 쓰는 조합이라 두 검증 게이트 모두 이 불일치를 못 잡는다. 런타임은 초과 인자를 무시하므로 실행 결과엔 영향 없으나, 새로 작성된 테스트가 실제 함수 계약을 오도한다 — 다음 정리 라운드에서 4번째 인자 제거 권고.
- (Low) 마이그레이션 3종 모두 명시적 DB 트랜잭션 없이 상태-가드 WHERE 절의 멱등성에만 의존한다(위 §1 상세). 현재는 안전하지만 구조적으로 강제되지 않는 불변식.

**추가: db.ts 내 Step4 마이그레이션 3종 ↔ 신규 클램프된 `engine_enabled`/`autopilot_mode` 시드 상호작용 확인 (leader 요청, 2026-08-06)**
- 실행 순서: 내 마이그레이션 3종(510~630행) → `engine_enabled`/`autopilot_mode` 시드 블록(632~674행) → `signals` 테이블 DDL(677행). 같은 `p`(non-transactional pool)로 순차 실행되지만 **건드리는 키 집합이 완전히 분리**돼 있다: 내 쪽은 `strategies.enabled`/`backtest_interval_h`/`next_backtest_at`·`system_config.backtest_fee_pct`/`backtest_slip_pct`, 저쪽은 `system_config.engine_enabled`/`autopilot_mode`(읽기는 `strategy_analyst_enabled`/`hybrid_mode_enabled`) — 컬럼·키 이름 충돌 없음.
- 멱등성 메커니즘도 서로 다르다(`runOnceMigration` 마커 vs 순수 `INSERT IGNORE`)지만 상호 참조가 없어 간섭 안 함 — 저쪽 블록은 `system_config.key` PRIMARY KEY 자체가 dedup 을 보장하는 신규 키라 마커가 애초에 불필요.
- `runOnceMigration`은 내부에서 자체 try/catch 로 실패를 삼키고 rethrow 하지 않으므로(§1 확인), 내 `migration_phase2_backtest_cost_model`이 실패해도 다음 문장인 `engine_enabled`/`autopilot_mode` 시드 블록 실행이 막히지 않는다 — 캐스케이드 실패 없음.
- 결론: **간섭 없음.** 오히려 두 변경(내 룰 축소 5+3=8종 활성화 vs 저쪽 auto 추론 클램프)은 leader Step3 판정 ③이 지목한 "auto + 미축소 룰셋 = 무제한 동시발화" 리스크를 서로 다른 축에서 완화하는 상호보완 관계 — 어느 한쪽만 배포돼도 (Step3+4는 항상 함께 배포되므로 가정일 뿐이지만) 나머지가 방어선으로 남는 구조.

## 진행 로그

- 2026-08-06 [09:53] Leader: task 생성. 운영 DB 실측으로 **Step 0 이미 완료 확인(스킵)**, 관측 3영업일 게이트 충족 확인, `rule_no_fire` 95% 지배 실측으로 analyst 진단 재확인. Leader 결정 2건 확정. `safety_daily_order_max_pct=10` 설정 확인(대기 결정 해소), `eval_funnel_daily` 미구현 발견.

## Leader 판정 — developer Step 1·2 발견 6건 (2026-08-06 10:30)

### ① `hard_stop`/`eod_loss_cut` 승인 없이 auto 제출 — **유지. 단 Step 5의 하드 게이트로 승격**

developer가 최고 위험으로 올린 항목. 사양 §4-1이 명령하는 동작이고 구현도 그대로 됐다. **유지 판정**하되 근거를 보강한다:

- **관측 근거**: 2026-08-05 실측에서 **exit 매도 시그널 2건이 승인 없이 `expired`** 됐다([[T-004-phase1-visual-verification]] 백로그 항목). 즉 사람 승인 경로에 태운 결과 **손절이 이미 사실상 무력화**돼 있었다. 방어적 청산을 auto 제출로 돌리는 것은 가설이 아니라 **실측된 실패를 고치는 것**이다.
- 현재 `safety_kill_switch=true`라 **어차피 아무 주문도 나가지 않는다** — 구현 단계에서 실자금 노출은 0.
- → **Step 5(실거래 해제) 진입 전 사용자 명시 승인 없이는 이 동작을 라이브로 켜지 않는다.** 이번 task 완료 보고에 반드시 포함.

### ② 무반응 스위치 write-through — **승인**

설정 UI가 구 키만 쓰는데 파이프라인은 신규 키를 우선 읽는 상태였다면, 사용자가 토글을 눌러도 무시되는 `db.ts:374` 스카의 재현이었다. 발견·수정 모두 타당.

### ③ `dueStrategies.length===0` 조기 반환이 exit-engine보다 앞섬 — **Step 3에서 수정 지시**

developer가 임의 수정하지 않고 보고한 판단이 옳다(실자금 경로). 이 결함은 **Leader 결정 ①의 취지를 정면으로 무력화**한다 — 엔진이 켜져 있어도 전 전략이 throttle되면 보유 종목이 무방비가 된다. Step 3에서 `strategy_throttled` 제거로 경로가 구조적으로 소멸하지만, **그것에만 의존하지 말고 "시장이 열려 있으면 exit-engine은 진입 전략 due 수와 무관하게 무조건 실행"을 명시 보장**하도록 지시함.

### ④ 승인 라우트가 아직 `hybrid_mode_enabled` 기준 — **현행 유지**

동작이 before/after 바이트 동일이라는 점이 중요. assist의 두 승인 방식(즉시 승인 / 지정 진입가 승인) UI 결정이 나온 뒤 수렴시킨다.

### ⑤ `post-market-engine`의 `'pending'`, skip 감사의 `'ai_skipped'` 미이관 — **동의, 이관 금지**

`ai_skipped` 13,811건이 분석·RAG 쿼리의 필터 값이다. 대량 UPDATE는 사양 §4-2-3도 명시적으로 회피 대상으로 규정했다.

### ⑥ `process.exit(1)` 회피 — **승인, 의도적 설계로 기록**

라이브 pm2 인스턴스에서 `process.exit(1)`은 **crash-restart 루프**를 만든다(이 앱은 이미 누적 재시작 319회 + `autorestart:true`). 하드 실패 프로세스보다 나쁘다. `getPool()` throw + `/api/health` red는 **의미 있는 수준에서 fail-closed**다 — 주문도 시그널 쓰기도 불가능. reviewer에게 "주문 경로가 정말 전부 막히는지" 독립 추적을 지시함.

### 📌 부수 발견 — `SIGNAL_AUTO_SUBMIT_MAX_KRW`가 설정만 있고 **코드에 강제되지 않았음**

`.env`와 테스트 픽스처에는 있었으나 **실제 코드가 이 상한을 검사하지 않았다.** auto 모드에서 금액 무관 자동 제출이 가능했다는 뜻 — 잠재 안전 공백이었다. Step 2에서 초과분이 승인 경로로 격하되도록 강제됨. **안전 회귀 검토(§6-6)에 반드시 포함할 것.**

## Leader 판정 — reviewer Step 1·2 감사 Medium 4건 (2026-08-06)

reviewer **PASS** (critical 0 / high 0 / medium 4 / low·info 3). safety-bypass·자금손실 직결 결함 0건. 테스트 41 suites/444 독립 재현, typecheck 에러는 Step 3 진행 중인 `engine.ts`에만 국한(Step 1·2 파일 0건).

| # | 내용 | 판정 |
|---|---|---|
| 1 | ALTER에 `ALGORITHM=INSTANT, LOCK=NONE` 미고정 → 13,811행 테이블에서 조용히 COPY 폴백 가능 | **지금 수정** |
| 2 | `readSignalStatusColumnType()`가 INFORMATION_SCHEMA 읽기 실패를 빈 문자열로 삼켜 **검증 자체를 조용히 스킵** | **지금 수정 (Leader가 우선순위 상향)** |
| 3 | `setupFatalError` 시 `sendAlert()` 미호출 + `/api/health`의 `ok`가 `schemaFatal`과 무관하게 항상 true | **지금 수정** |
| 4 | `auto` 모드에서 비강제 청산(target_profit/trailing)이 진입과 같은 금액상한·격하 로직을 탐 — 사양 §4-1 "auto는 전부 auto 제출"과 배치 가능 | **보류 — auto 모드 활성화 전 결정** |

### #2를 "낮은 우선순위"에서 상향한 근거

이 부팅 검증 메커니즘은 **"STRICT 모드에서 스키마 불일치가 무증상 전멸을 일으킨 사고"를 두 번 다시 없게 하려고** 만든 것이다. 그런데 **그 가드 자신의 실패 모드가 침묵**이면, 정확히 그것이 막으려던 버그 클래스를 재생산한다.

"DB가 깨졌으면 어차피 다른 데서 터진다"는 반론은 부분적으로만 맞다 — `INFORMATION_SCHEMA` 권한 문제라면 **일반 쿼리는 정상인데 메타데이터 읽기만 막힐 수 있고**, 그 경우 가드는 장식품이 된다. 수정은 2줄(빈 문자열 반환 → throw)이고 호출부가 이미 fatal setup error를 처리한다. #1의 "fail loud" 권고와 **같은 성격**이라 함께 묶는 것이 자연스럽다.

### #4 보류 근거

현재 라이브 모드가 `assist`라 **블라스트 반경 0**. 동작을 바꾸지 않고 해당 분기에 T-006을 가리키는 주석만 남기게 했다. **`AUTOPILOT_MODE=auto`를 실제로 켜기 전 필수 결정 항목**으로 등록.

> ⚠️ 이번 task의 **auto 모드 활성화 전 필수 결정 2건**: (a) `hard_stop`/`eod_loss_cut` 무승인 auto 제출(위 §Leader 판정 ①), (b) 비강제 청산의 금액상한 의미(#4). 둘 다 실자금 자율성 증가라 사용자 명시 승인 없이 켜지 않는다.

## Leader 판정 — developer Step 3 판단 4건 (2026-08-06)

### ① ALTER 편차(INSTANT 실패 시 `INPLACE, LOCK=NONE` 재시도) — **developer 안 채택. Leader 지시 정정.**

내가 "INSTANT를 못 하면 fail loud"라고 지시한 것이 부정확했다. reviewer가 지목한 **불변식은 "13,811행 라이브 테이블을 조용히 COPY/락 걸지 않는다"** 이지 "INSTANT여야 한다"가 아니다. `INPLACE, LOCK=NONE`은 online DDL이라 그 불변식을 완전히 만족한다. 반면 하드 실패는 **서버 알고리즘 지원 여부 하나로 자충수 아웃티지**를 만든다. 폴백 시 critical 알림이 뜨므로 은폐도 아니다.

(참고: ENUM 값 10→13 추가는 255개 바이트 경계에서 한참 아래라 MariaDB 10.11에서 INSTANT가 성립할 가능성이 높다 — 폴백은 defense in depth.)

### ② `liquidity_dead` 재도출 (`trailingZero >= 2` → `>= 1`) — **승인. 이번 라운드 최고의 판단.**

§6-6은 "동일 동작 유지"를 요구하는데, 축이 30m→1h로 바뀐 상태에서 **파라미터를 그대로 두면 무대응 판정 기준이 1시간 → 2시간으로 늘어난다.** 즉 **상장폐지 감지가 조용히 둔감해진다** — 사양이 "완화 금지"로 못 박은 유일한 게이트다.

**파라미터 동일성과 동작 동일성이 갈라지는 지점**이고, §6-6이 실제로 보호하려는 것은 후자다. 1봉(실질 1시간 동치) 유지. **단 안전 게이트 파라미터 변경이므로 QA가 명시적으로 검증**해야 한다.

### ③ auto 모드가 `duplicate_active_signal`을 우회 — **Step 3·4 동시 배포로 대응**

market-state 게이트가 사라진 상태에서 운영 DB는 아직 15/16 전략이 enabled다. 이 구간에 auto 모드를 켜면 심볼당 다중 시그널이 **중복 체크 없이 auto 제출**될 수 있다.

→ **Step 3과 Step 4는 하나의 단위로 함께 배포한다. 어느 쪽도 단독 배포하지 않는다.** 현재 `safety_kill_switch=true` + 라이브 모드 `assist`라 오늘의 블라스트 반경은 0. reviewer에게 **"코드 레벨 인터락이 있는가, 아니면 운영 관행에 의존하는가"** 를 명시 확인하도록 지시함.

### ④ rebuy 쿨다운이 매도 **체결**이 아니라 매도 **시그널** 시점 발동 — **승인, 후속 과제로 기록**

체결 훅이 아직 없어서 생긴 편차이고, **더 빨리·더 길게 막는 보수적 방향**이라 안전 실패 모드다. 정식 수정은 `order-sync`에 체결 훅 추가 — 별도 backlog.

### 📌 QA 인계 사항 — funnel row 모델

`rule_no_fire`·`insufficient_candles`는 게이트별 개별 행이 아니라 **`collect` 행 detail + `final` 행 reason으로 압축** 기록된다([[T-002-phase1-eval-funnel]] §2 볼륨 정책 — 개별 행이면 일 ~70k행). **§6-2 감쇠 검증 SQL을 쓸 때 이 행 모델을 전제로 해야 한다.**

## Reviewer 섹션 — Step 3 (게이트 체인 재편 D1+D4) 감사 (2026-08-06)

- [10:53] **감사 범위**: `engine.ts`, 신규 `cooldowns.ts`, `eval-funnel-labels.ts`, `market-state.ts`, `ai-prefilter.ts`, `db.ts`(ALTER/health/alert 부분), `health/route.ts`, `router.ts`/`service.ts`(Q1 추적), 관련 테스트. Step 4(rules/seed) 병행 작업 중 churn은 제외 — 스냅샷은 `git -c core.fileMode=false diff`로 여러 차례 재확인, 마지막 스냅샷은 typecheck 0 에러 확인 직후 시점.
- [10:53] **독립 재현**: `npm run typecheck` 0 에러. `npm test` **45 suites / 504 tests 전부 통과** (Step 4까지 포함된 최신 트리 — Step 3 시점 43/480에서 Step 4가 24건 추가한 것과 정합). 빌드/install/pm2/commit/수동 DDL 미실행, 운영 DB는 조회 없이 코드 감사만 수행.
- [10:53] **판정: PASS** (Critical 0 · High 1 · Medium 2 · Low 1). Step 3 자체의 코드 품질·게이트 방향·안전 로직은 모두 견고하다. High 1건은 Step 3가 만든 결함이 아니라 **Step 3(market-state 게이트 제거)가 기존에 존재하던 취약점(auto 모드의 무방비 노출면)을 실질적으로 확대시켰고, 그 활성화 경로가 리더·개발자가 상정한 것보다 훨씬 얕다**는 발견이다.

### Q1 — auto 모드는 코드로 막혀 있는가, 운영 관행에 의존하는가

**답: 운영 관행도 아니고, 순수 코드 인터락도 아니다. 세 번째 범주 — "이미 라이브로 떠 있는 무관한 UI 토글 하나가 실수로라도 켜면 켜지는" 상태다. 이것이 "아무도 스위치를 안 건드렸다"보다 훨씬 얕은 방어선이다.**

추적한 모든 경로:

1. `autopilot_mode` 를 바꿀 수 있는 코드 경로는 3곳뿐이다 — (a) `db.ts` 부팅 시드(`INSERT IGNORE`, 기존 값 있으면 무해), (b) 환경변수 `AUTOPILOT_MODE`(배포자만 접근), (c) `syncEngineSwitchesFromLegacy()`(`src/lib/signals/router.ts:163`). **UI 에 `autopilot_mode` 를 직접 쓰는 전용 엔드포인트는 없다** — developer 로그(§미해결 6번)와 Leader가 상정한 위협모델("`AUTOPILOT_MODE=auto` 를 실제로 켜기 전")은 전부 (b)를 전제로 한 것으로 보인다.
2. 그런데 (c) `syncEngineSwitchesFromLegacy()` 는 **`PATCH /api/settings/hybrid` 가 호출될 때마다 무조건 실행**된다(`src/app/api/settings/hybrid/route.ts:43`, 조건 없음). 그리고 `/api/settings/hybrid` 는 **Phase 2 이전부터 운영 중인, Settings 화면에 지금 이 순간도 노출돼 있는 "하이브리드 모드" 토글**이다(`src/app/settings/SettingsPage.tsx:252-278`). 라벨: "하이브리드 모드 — OFF: 기존 즉시 승인 방식". 이 문구 어디에도 auto 모드·자동매매·중복검사 스킵을 암시하는 내용이 없다.
3. `syncEngineSwitchesFromLegacy()` 는 `strategy_analyst_enabled`/`hybrid_mode_enabled` 를 **DB에서 다시 읽어** `legacySwitchesToMode(analystOn, hybridOn)` 로 `autopilot_mode` 를 **재계산 후 덮어쓴다**(`ON DUPLICATE KEY UPDATE`). 그 함수는:
   ```
   if (hybridEnabled) return 'assist';
   return analystEnabled ? 'auto' : 'assist';
   ```
   이 매핑은 §4-1 마이그레이션 표 그대로이고 `router.test.ts` 에 `legacySwitchesToMode(true, false) === 'auto'` 로 테스트까지 돼 있다 — **구현이 스펙을 정확히 따른 결과이지 버그가 아니다.**
4. T-006 실측(09:53 KST)의 **현재 운영값은 `strategy_analyst_enabled=true`, `hybrid_mode_enabled=true`**. 즉 지금 당장은 `assist` 다. 하지만 **누군가 Settings 화면에서 "하이브리드 모드" 토글을 그냥 OFF 로 한 번 누르면** — 새 기능인지도 모르고, "이전 방식으로 되돌리는" 정도로 인식하고 누를 가능성이 충분히 있다 — `hybrid_mode_enabled=false` 로 저장되고, 그 즉시 `syncEngineSwitchesFromLegacy()` 가 `legacySwitchesToMode(true, false)='auto'` 를 계산해 **`autopilot_mode='auto'` 를 system_config 에 기록한다.** 사용자는 "하이브리드 모드를 껐을 뿐"이라고 생각하지만 실제로는 **전체 파이프라인을 auto 모드로 전환**시킨 것이다.
5. auto 모드 전환의 실질 효과 (지금 이 순간의 코드 기준): market-state 게이팅이 Step 3 로 사라졌고 운영 DB 는 아직 15/16 전략 `enabled=1`(Step 4 가 5종으로 줄이지만 그래도 다중)이므로 한 심볼에 여러 룰이 동시 발화할 수 있고, `service.ts:188` 의 `duplicate_active_signal` 체크가 `decision.route !== 'auto_submit'` 조건이라 **auto 경로에서는 아예 스킵**된다. `createSignal()` 은 auto 로 라우팅된 candidate 마다 **동기적으로 `submitOrder()` 를 즉시 호출**한다(`service.ts:287`) — 승인 대기 없음, 배치 지연 없음.
6. 지금 이 순간 실제 주문이 거래소로 나가지 않는 유일한 이유는 **`safety_kill_switch=true`** 다. 이건 이번 재설계가 만든 인터락이 아니라 범용 안전 스위치이고, 운영자가 Step 5(실거래 단계적 해제)를 시작하려고 끄는 바로 그 스위치다. **kill switch 해제와 "하이브리드 모드" 토글 오조작이 겹치는 순간, 코드 레벨에서 이를 막는 장치가 전혀 없다.**

**결론**: `AUTOPILOT_MODE=auto` 자체는 스펙대로 정확히 구현됐고 격리도 잘 돼 있다(→auto 라우팅 로직 자체는 결함 없음). 문제는 **그 모드로 진입하는 문이 "의도적으로 auto 를 선택하는 행위"가 아니라 "무관해 보이는 기존 토글을 끄는 부수효과"로 열려 있다**는 것이다. 이는 Leader/Developer 가 상정한 위협모델("누군가 AUTOPILOT_MODE=auto 를 명시적으로 켠다")보다 훨씬 얕고 우발적인 경로다.

### 🔴 HIGH — 결함 #1: `하이브리드 모드` 토글이 의도치 않게 `autopilot_mode=auto` 를 트리거할 수 있음

- **위치**: `src/app/api/settings/hybrid/route.ts:39-45` (무조건 `syncEngineSwitchesFromLegacy()` 호출) × `src/lib/signals/router.ts:96-99`(`legacySwitchesToMode`) × 현재 운영값 `strategy_analyst_enabled=true`.
- **위험**: 사람 승인 없는 대량 주문 자동 제출 가능 상태로 전환. `duplicate_active_signal` 체크 우회(기존 결함, 발동 조건이 이 경로로 훨씬 쉬워짐)와 결합해 한 종목에 여러 룰이 동시 자동 매수 시그널을 내고 즉시 제출될 수 있음.
- **왜 지금 심각한가**: 정확히 이 T-006 세션(사용자가 Settings 를 열어볼 가능성이 있는 활성 작업 세션) 동안, 그리고 KILL_SWITCH 해제가 Step 5 로 예정돼 있는 시점에 이 잠재 경로가 존재한다.
- **권고 (구현하지 않음, 설계만 제시)**:
  1. 최소 변경: `syncEngineSwitchesFromLegacy()` 가 계산한 `autopilotMode` 가 `'auto'` 이면 **DB에 쓰지 않고 `'assist'` 로 클램프**하거나, 최소한 `console.warn`+`sendAlert('warning', ...)` 로 "레거시 토글 조작이 auto 모드를 유발했다"를 기록한다. `auto` 로의 전환은 오직 명시적인 `autopilot_mode` PATCH(존재하지 않음, 향후 UI 결정 사항)로만 허용.
  2. 구조적 변경: `legacySwitchesToMode` 의 "analyst=T, hybrid=F → auto" 매핑은 **최초 1회 마이그레이션에만** 쓰고, `syncEngineSwitchesFromLegacy()`(런타임 write-through)에서는 절대 `'auto'` 를 반환하지 않도록 별도 함수로 분리한다 — 런타임 레거시 동기화는 "auto 로 승격시키지 않는다"를 불변식으로 두는 편이 안전하다(레거시 토글은 원래 auto 개념을 몰랐던 UI다).
  3. 어느 방향이든, **Step 4까지 배포한 뒤에도 auto 모드는 별도의 명시적 사용자 승인 없이는 도달 불가능해야 한다**(Leader 가 이미 §Leader 판정에서 "auto 모드 활성화 전 필수 결정 2건"으로 못박은 것과 같은 원칙을 이 경로에도 적용해야 함).

### Q2 — ALTER INSTANT→INPLACE 재시도 편차는 MariaDB 10.11.11에서 안전한가

**답: 재시도 알고리즘 선택 자체(INSTANT 실패 시 INPLACE+LOCK=NONE 로만 재시도)는 안전하다 — Leader 의 정정된 불변식("COPY/락 금지")을 완전히 만족한다. 다만 그 주변의 예외 처리에 사각지대가 하나 있다.**

- **알고리즘 선택은 타당**: ENUM 값 10→13 추가는 바이트 폭 변화 없음(1바이트 저장 범위, 255개 한참 아래) → append-only ENUM 확장은 InnoDB Online DDL 매트릭스에서 오랫동안(MySQL 5.6 시절부터, INSTANT 개념 도입 이전부터) "in-place, no rebuild, permits concurrent DML" 로 분류돼 온 연산이다. MariaDB 10.11 은 이 분류를 그대로 상속한다. `ALGORITHM=INSTANT` 가 거부되더라도 `ALGORITHM=INPLACE, LOCK=NONE` 은 테이블을 리빌드하지 않고 짧은 메타데이터 락만 취하며 그 사이 SELECT/INSERT/UPDATE/DELETE 를 막지 않는다 — "13,811행 라이브 테이블을 조용히 COPY/락 걸지 않는다"는 불변식을 두 알고리즘 모두 만족. 코드 어디에도 알고리즘 미지정(COPY 허용) 형태의 ALTER 경로가 없음을 재확인했다(`grep`으로 `ALTER TABLE signals MODIFY COLUMN status` 두 호출부 모두 명시적 ALGORITHM 확인).
- **🟡 MEDIUM — 결함 #2: INPLACE 재시도 자체가 실패하면 fail-closed 알림 메커니즘을 우회한다.**
  - **위치**: `src/lib/db.ts:774` — `await p.query(\`${ddl}, ALGORITHM=INPLACE, LOCK=NONE\`);` 이 자체 try/catch 없이 실행된다.
  - **문제**: INSTANT 도 실패하고(catch 진입) 그다음 INPLACE 재시도(774행)마저 실패하면(예: 잠금 대기 타임아웃, 권한 문제, 실제 비호환) — 이 raw 예외는 `SchemaVerificationError`/`SignalStatusEnumMismatchError` 로 감싸이지 않은 채 그대로 위로 던져진다. `ensureSetup()` 의 catch(`db.ts` 상단)는 `isSchemaFatalError(e)` 로 판별하는데, raw mysql2 예외는 이 마커가 없으므로 **`setupFatalError` 가 설정되지 않고, `notifyCritical` 도 호출되지 않는다.** `getPool()` 은 계속 정상적으로 pool 을 내준다. `/api/health` 의 `schemaFatal` 은 계속 `false`(green) 로 남는다.
  - **결과**: ENUM 은 여전히 신규 상태값이 빠진 채고, 새 상태로의 INSERT 는 STRICT 모드에서 개별적으로 실패하지만(Step 1/2 의 `createSignal` try/catch 덕에 런 전체는 죽지 않는다) — 이번 Step 3 라운드가 정확히 만들려던 "검증기 자신의 실패는 조용하면 안 된다"(db.ts 주석 732-735줄, reviewer #2 원칙)는 원칙이 **"조회 실패" 케이스에는 적용됐지만 "ALTER 실행 자체의 실패" 케이스에는 적용되지 않은 사각지대**다.
  - **권고 (구현하지 않음)**: 774행의 INPLACE 재시도도 자체 try/catch 로 감싸 실패 시 `SchemaVerificationError` 로 재던지기 — "조회 실패"와 동일한 fail-closed+alert 경로로 수렴시킨다.
  - **발생 가능성**: 낮음(이 특정 ENUM append 는 매우 흔히 지원되는 연산) — 그래서 Critical 이 아니라 Medium. 하지만 발생 시 정확히 T-002 H1 사고와 같은 무증상 열화 패턴(단, 전멸이 아니라 개별 실패로 완화된 버전)이 재현되고, 이번 라운드가 명시적으로 막으려던 것이 바로 이 "조용함"이다.

### 3. 게이트 매핑 충실도 (§1 대조) — 삭제 7종·AI 7종·라벨 강등 2종 전부 확인, fail 방향 표

| 게이트 | 스펙 방향 | 구현 | 확인 |
|---|---|---|---|
| `market_closed` | fail-closed | 조기 return, 우회 불가 | ✅ 불변 |
| `engine_disabled`(구 `analyst_disabled`) | fail-closed | 신규 진입만 차단, run='skip' 기록 | ✅ |
| `strategy_unregistered` | fail-closed(error) | 유지 | ✅ 불변 |
| `strategy_throttled`/`no_due_strategies` | — | 삭제, `no_active_strategies` run 행으로 대체 | ✅ 삭제 확인 |
| `ticker_error`/`candles_fetch_failed`/`insufficient_candles` | 심볼·룰 단위 fail-open(런은 계속) | 유지, `candles_fetch_failed` 에 `rec.error` 신규 추가(이전엔 collect 요약에만 있었음) | ✅ 관측성 개선 |
| `market_state_preclassify_failed`/`market_state_rule_inactive` | 삭제/라벨 강등 | `classifyMarketState` 는 라벨만, 게이팅 없음(`STATE_RULES` 삭제 확인) | ✅ |
| `rule_no_fire` | fail-open 성격(정상 skip) | 유지 | ✅ 불변 |
| `losing_position_buy_block`/`sell_not_held`/`sell_amount_below_min` | fail-open(억제) | 로직 불변(LOSS_BLOCK_PCT=-0.5 그대로), `sqlStatusList` 경유로 상태 목록만 갱신 | ✅ |
| `cooldown_rebuy`→`cooldown_rebuy`+신규 `cooldown_entry` | fail-open, 조회실패 시 통과 | `cooldowns.ts` 로 통합, `loadError` 시 `isActive()` 항상 false | ✅ |
| `skip_seal_24h` | 삭제 | 삭제, entry 쿨다운(사람 거부 4h)으로 대체 | ✅ |
| `regime_gate_macro_bear` | fail-closed(매수 차단) | 유지 | ✅ 불변 |
| `regime_gate_macro_error` | fail-open + 기록 | 이전엔 `console.warn` 만, 이번에 `rec.error` 추가 | ✅ 개선(무기록 → 기록) |
| `prefilter_strong_counter_trend` | 삭제(룰로 흡수) | 삭제 확인(`ai-prefilter.ts`) | ✅ |
| `prefilter_bypassed_no_summary` | 삭제(분기 자체 소멸) | 삭제, summary 는 항상 1h 축에서 산출 | ✅ |
| `prefilter_liquidity_dead`/`atr_zero`/`rsi_extreme_counter` | fail-closed(완화 금지) | `liquidity_dead` 임계 2→1봉(시간축 등가, §6-6 별도 검증 아래), 나머지 불변 | ✅ |
| `prefilter_blowoff_top` | 유지(임계 수정) | `>30%`→`>10%&&rsi>80` | ✅ 사문 교정 확인 |
| `late_session_buy_block` | fail-closed | 로직 불변 | ✅ |
| `portfolio_max_positions`/`portfolio_guard_other` | fail-closed, 모드 무관 하드 | 불변 | ✅ |
| `portfolio_core_ratio` | assist 라벨/auto 하드 | `autopilotMode !== 'auto'` 분기로 정확히 구현, 반전 불가(값이 런 시작 시 1회 고정) | ✅ |
| `dedup_regime`/`dedup_lookup_error` | 통합(신규 기록 없음, 과거 조회용 보존) | `FUNNEL_GATES` 에 남아있고 신규 기록 경로 없음 확인 | ✅ |
| `ai_input_no_summary`/AI 7종 전부 | 삭제 | `engine.ts` 에서 `aiSelectSignal`/`aiSelectSignalBatch`/`ai-filter-stage1`/`ai-dedup` import 전부 제거 확인(아래 항목 6) | ✅ |
| `symbol_blacklisted` | fail-closed | `createSignal()` 최상단, 모드 무관 항상 체크 | ✅ |
| `duplicate_active_signal` | fail-closed(단, auto 경로 제외 — 기존 결함) | `route !== 'auto_submit'` 조건은 **Step 3 diff 대상이 아님**(pre-existing) — 위 Q1/결함#1 참고 | ⚠️ 스펙 §1 표는 이 예외를 명시하지 않음(spec 자체의 공백) |
| `signal_create_failed` | fail-closed(error 기록 + 런 계속) | try/catch 전수 확인(Step1/2 범위, 재확인) | ✅ |

**결론**: 표에 있는 24개 게이트 중 방향이 뒤집힌 것은 0건. 관측성이 개선된 곳(regime_gate_macro_error, candles_fetch_failed) 2건, 스펙이 다루지 않는 사각지대(duplicate_active_signal의 auto 예외) 1건.

### 4. §6-6 안전 회귀 — 항목별 확인

- `KILL_SWITCH`/`ORDER_MAX`/`DAILY_ORDER_MAX`/블랙리스트: `src/lib/safety/*` 전부 `git diff` 상 미변경 재확인. `submitOrder()` 경유 불변.
- `liquidity_dead` (`trailingZero >= 2` → `>= 1`, 축 30m→1h): **산수 확인함.** 구: 30m 캔들 2봉 무거래 = 60분. 신: 1h 캔들 1봉 무거래 = 60분. 벽시계 등가, 완화 아님(오히려 그대로 뒀으면 120분으로 둔감해졌을 것) — developer·Leader 판단에 동의. `ai-prefilter.ts:16-19,44-51` 주석·상수(`LIQUIDITY_DEAD_MIN_ZERO_BARS=1`)로 명시.
- `atr_zero`/`rsi_extreme_counter`: 코드 라인 단위로 이전과 동일(`rsi14>=85`/`<=15`) 확인.
- `late_session_buy_block_kst`: 로직·임계 불변 확인(diff 상 이 블록은 자료구조 리팩터만, 조건문 자체 미변경).
- `losing_position_buy_block`: `LOSS_BLOCK_PCT=-0.5` 불변, 위치·조건 동일.
- `portfolio_max_positions`: 모드 무관 하드 유지 확인(§3 표 참고).
- `regime_gate_macro_bear`: buy 후보 사전 제거 로직(`buyBlocked = regimeGateBlocked || !orderLimitConfigured`) 불변.
- **`rsi_extreme_counter` 값 확인**: 실효 겹침 구간 RSI∈(80,85) 계산 검증함 — `blowoff_top` 이 rsi>80 에서 걸리고 `rsi_extreme_counter` 가 rsi>=85 에서 먼저 잡으므로 developer 주장과 정확히 일치.

### 5. `cooldowns.ts` — 설계·구현 정합성

- **fail-open on lookup failure**: `loadActiveCooldowns()` 는 자체 try/catch 로 절대 throw 하지 않고 `CooldownSet(new Map(), errMsg)` 를 반환, `isActive()` 는 `loadError` 가 있으면 무조건 `false` — 코드·테스트(`cooldowns.test.ts` "조회 실패 스냅샷은 전부 fail-open") 모두 확인.
- **GREATEST 가드**: SQL 텍스트에 `GREATEST(VALUES(\`until\`), \`until\`)` 확인, 테스트도 SQL 패턴 매칭으로 고정(실 DB 검증은 아니지만 유닛 테스트 범위에선 합리적).
- **NOT NULL DEFAULT '' 센티넬**: `normalizeKey()` 가 scope 별로 미사용 키를 `''` 로 정규화 → UNIQUE(scope,symbol,strategy_id,side,exit_kind) 가 의도대로 동작. Step1/2 리뷰가 지적했던 "실제 사용처 미확인" 우려가 이번에 `engine.ts`(`collectCandidates`/`runMarket`/`runExitEngine`)와 `service.ts`(`rejectSignal`) 양쪽에서 실사용 확인됨.
- **타임존**: pool `timezone:'+09:00'`(변경 없음) — `until` 비교는 DB 측 `WHERE until > NOW()`(서버 시각)과 JS 측 `until.getTime() > now.getTime()`(epoch ms, mysql2 가 +09:00 기준으로 정확히 파싱) 이중 검증이라 표현 방식이 달라도 실제 순간은 일치. 결함 없음.
- **레이스**: 런당 1쿼리 스냅샷 설계상, **같은 런 내에서 나중에 set된 쿨다운이 그 런의 앞선 collect 단계 판정에 반영되지 않는 좁은 staleness 가 있다**(예: 같은 런에서 동일 심볼에 대해 다른 전략의 매도가 먼저 처리되며 rebuy 쿨다운을 걸어도, 그 심볼의 매수 후보는 이미 이전 collect 단계에서 이 쿨다운 없이 수집이 끝난 상태). 다만 이건 **rebuy 쿨다운(거래세 낭비 방지 — §4-3 상 fail-open/비안전계층)에 한정된 좁은 케이스**이고, entry 쿨다운은 같은 런에서 동일 (symbol,strategy,side) 가 두 번 발화할 구조가 아니라 실질 영향이 없다. Low 로 기록.
- **크로스런 동시성**: `ecosystem.config.js` 가 `instances:1` 이라 실질적으로 동시 `runMarket()` 은 없다(Step1/2 리뷰가 이미 확인한 전제, Step3 도 동일 아키텍처 위에서 동작). 신규 위험 없음.

### 6. 장중 AI 경로 완전 제거 — 독립 재검증

- `grep -rn "aiSelectSignal(\|aiSelectSignalBatch("` 결과 호출부는 `ai-filter.ts` 자체 정의와 테스트뿐 — `engine.ts` 는 `buildMarketSummary`/`MarketSummary` 타입만 import. `ai-filter-stage1.ts`/`ai-dedup.ts` 는 어디서도 import 되지 않음(둘 다 dead code, developer 로그 §8과 일치).
- post-market: `post-market-analysis/route.ts` 는 이번 diff 파일 목록에 없음(`git diff --stat` 재확인) — 미변경 확인.

### 7. `portfolio_core_ratio` 모드 분기 — 반전 불가 확인

`applyFilters()` 에 `autopilotMode` 가 `runMarket()` 시작 시 1회 읽힌 `switches.autopilotMode` 로 파라미터 전달(런 중간 재조회 없음) → `gate==='portfolio_core_ratio' && autopilotMode !== 'auto'` 분기가 런 도중 값이 바뀌어 반전될 수 있는 경로 없음. `max_positions`/`portfolio_guard_other` 는 이 조건 밖이라 모드 무관 항상 하드.

### 8. exit-engine 무조건 실행 — 위치 확인

`runMarket()` 순서: `isDomesticOpen/isOverseasOpen` 체크(fail-closed, 조기 return) → `getEngineSwitches()`/`loadActiveCooldowns()` → **`runExitEngine()` 호출** → 그다음에야 `switches.engineEnabled` 체크. `engineEnabled`/`activeStrategies.length===0` 두 조기 return 모두 exit-engine **뒤**에 위치 — Leader 판정 ③에서 지시한 "시장 열려있으면 전략 due 수와 무관하게 무조건 실행" 요건을 구조적으로 만족. `getHeldAmounts()` 자체 try/catch(빈 Map 반환, throw 없음)라 이 경로가 예외로 죽어 뒤 로직을 막을 가능성도 없음.

### 종합

- **PASS**(Critical 0), 배포 차단 사유 없음. 다만 **결함#1(HIGH)** 은 Step 1~4 를 하나의 단위로 묶어 배포하기 전에 Leader·사용자 판단이 필요하다 — Step 3/4 자체의 게이트 로직 결함이 아니라, **이미 라이브 중인 기존 UI(하이브리드 모드 토글)가 이번 재설계로 새로 생긴 위험 상태(auto 모드, market-state 게이트 소멸)로 가는 문을 열어준다**는 상호작용 문제다. Leader 가 명시적으로 "auto 모드는 사용자 명시 승인 없이 켜지 않는다"는 원칙을 이미 2건에 대해 세워뒀는데(hard_stop 무승인 제출, 비강제청산 캡 해석), **이 경로는 그 원칙을 사용자도 모르게 우회할 수 있는 세 번째 문**이다.
- 결함#2(MEDIUM)는 Step 3 가 새로 만든 fail-closed 메커니즘의 사각지대이며, 발생 가능성은 낮지만 발생 시 정확히 이번 라운드가 막으려던 "조용한 열화" 패턴을 재현한다.
- 나머지(게이트 매핑, §6-6 안전 회귀, cooldowns, AI 경로 제거, portfolio_core_ratio 분기, exit-engine 순서)는 전부 스펙·developer 주장과 독립적으로 일치 확인됨. High 3건 이상이 아니므로(HIGH 1건) 판정 기준상 CONDITIONAL_PASS 이지만, 결함#1 은 **Step 3 코드 자체의 결함이 아니라 배포 시점의 운영 위험**이라 Step 4 QA 진행을 막을 필요는 없다고 판단한다 — 단 **Step 5(실거래 해제) 전, 그리고 가능하면 이번 배포 전에 결함#1 을 반드시 leader 판단으로 올릴 것**을 명시 권고한다.

## Leader 프리플라이트 실측 — Step 4 마이그레이션 영향 (2026-08-06, SELECT only)

developer가 올린 flag #1(운영자가 끈 룰 재활성화 one-way door)과 #4(`rsiSellPriceMult` 미확인)를 **운영 DB 실측으로 직접 해소**했다.

### A. 운영 strategies 실제 상태 (16종)

`enabled=0`은 **`price-breakout-v1`·`volume-spike-breakout-v1` 단 2종**, 나머지 14종은 `enabled=1`.

### B. 🟢 flag #1 — **발생 불가 확정**

기본 활성 5종(`rsi-oversold-v1`·`pullback-trend-v1`·`bb-squeeze-expansion-v1`·`weekly-trend-follow-v1`·`rsi-overbought-exit-v1`)이 **이미 전부 `enabled=1`**이다.

→ 마이그레이션의 `UPDATE ... SET enabled=1 WHERE id IN (5종) AND enabled=0`은 **이번 배포에서 no-op**. "운영자가 의도적으로 끈 룰이 되살아난다"는 시나리오는 **현 운영 상태에서 성립하지 않는다.**

(일반론으로서의 one-way door 성질은 유효하므로 규약으로 남긴다: **향후 이 마이그레이션 마커를 재사용·리셋하지 말 것.**)

### C. 실제로 바뀌는 것 = 비활성화 7종 중 6종

`bb-breakout-v1` · `dividend-quality-buyback-v1` · `ma-cross-v1` · `rsi-divergence-v1` · `rsi-macd-reversal-v1` · `triple-confirmation-v1`
(`volume-spike-breakout-v1`은 이미 `enabled=0`이라 no-op)

**post-market 3종(`eod-high-close-v1`·`inside-bar-v1`·`oversold-bounce-daily-v1`)은 양쪽 목록 어디에도 없어 `enabled=1` 유지** — 야간 시나리오 카드 생성이 이들에 의존하므로 반드시 살아 있어야 한다. 실측으로 확인됨.

**배포 후 예상 상태**: 장중 활성 5종 + post-market 활성 3종(장중 엔진은 `post_market_only`로 skip) + 비활성 8종 = 16종.

### D. 🟢 flag #4 — **해소**

`system_config`의 `style_default_*` 키는 `minAiConfidence=45` · `trailingActivatePct=3.5` · `trailingDrawdownPct=1.2` **3개뿐**. **`style_default_rsiSellPriceMult` override 없음** → 코드 기본값 적용. `pullback-trend-v1`이 dead guard로 죽어 있었을 가능성은 배제되고, guard 제거는 순수 정리 작업이다.

## Leader 판정 — developer Step 4 판단 6건

| # | 내용 | 판정 |
|---|---|---|
| 1 | 기본 활성 5종 재활성화 one-way door | **실측으로 발생 불가 확정**(위 B). 규약만 남김 |
| 2 | dead `rsiSellPriceMult>1.0` guard가 다른 4개 룰에 잔존 | **수용** — 전부 기본 비활성이라 영향 0. **재활성화 시 정리 필수** 조건부 backlog |
| 3 | 백테스터가 편도 수수료 1개만 수용 → 매수/매도 비대칭 근사 | **수용** — 시그니처 변경이라 backlog. 근사 방향이 보수적인지 reviewer 확인 |
| 4 | `style_default_rsiSellPriceMult` 미확인 | **Leader가 실측 해소**(위 D) |
| 5 | `FEE_BUFFER_PCT`에 `MICRO_VARIATION_BUFFER_PCT=0.0007` 유지 | **승인** — 아래 근거 |
| 6 | `applicable_styles` 컬럼·`AnalystStyle` 타입 잔존 | **수용** — DB 확장전용 원칙 준수. 실행 경로에서 미참조면 표시용으로 남는 것이 옳다 |

### #5 승인 근거 — "비용 정확도 개선"이 "주문 실패 회귀"로 둔갑할 뻔한 건

기존 `FEE_BUFFER` 0.5%는 순수 비용이 아니라 **비용(0.43%) + 시그널 산출~주문 제출 사이 가격 변동 흡수용 헤드룸(~0.07%)** 의 합이었다. 이걸 새 실측 비용 0.33%로 **통째로 치환하면 헤드룸이 0이 되어** 가격이 조금만 움직여도 `order_limit` 거부가 급증한다.

즉 **"0.43%는 2.4× 과대"라는 analyst의 지적은 비용 항목에 대해서는 옳지만, 버퍼 전체에 그대로 적용하면 안 된다.** developer가 이 2차 효과를 잡아 명시 상수로 분리한 것은 정확한 판단이다. reviewer에게 버퍼 산술 검증을 별도 지시함.

## 🔴 Leader 판정 — reviewer Step 3 감사 HIGH 1건 (2026-08-06, Leader 코드 직접 확인)

reviewer Step 3 **PASS** (Critical 0 / High 1 / Medium 2 / Low 1). 게이트 24개 fail 방향 뒤집힘 0건, §6-6 안전회귀 전항 확인, `liquidity_dead` 2→1봉 산수 재검증 완료, 장중 AI 경로 소멸 독립 재확인, exit-engine 무조건 실행 확인(Leader 판정 ③ 충족). 45 suites/504 tests 독립 재현.

### HIGH #1 — "하이브리드 모드" 토글이 **표시 없는 auto 모드 진입 문**

**Leader가 코드를 직접 읽어 확인함**:

```
router.ts:98-101   legacySwitchesToMode(analystOn, hybridOn)
                     if (hybridEnabled) return 'assist';
                     return analystEnabled ? 'auto' : 'assist';
router.ts:167+     syncEngineSwitchesFromLegacy() → autopilot_mode 를 **쓴다**
hybrid/route.ts    PATCH 가 이 함수를 **무조건** 호출
운영값             strategy_analyst_enabled = true
```

→ 사용자가 기존 "하이브리드 모드" 스위치를 **OFF로 한 번 누르면** `hybridOn=false, analystOn=true` → **`'auto'`** 가 `autopilot_mode`에 기록되고, 파이프라인 전체가 auto로 전환된다. auto 경로는 `duplicate_active_signal`을 스킵하고 `createSignal()`이 candidate마다 `submitOrder()`를 동기 호출한다.

**UI 라벨은 "OFF — 기존 즉시 승인 방식"뿐이고 자율 매매에 대한 언급이 전혀 없다.** 지금 실주문이 안 나가는 유일한 이유는 `safety_kill_switch=true`이며, **그것이 정확히 Step 5에서 해제하려는 스위치**다.

### 근본 원인 규명 — **마이그레이션 의미론을 런타임 의미론으로 배선한 것**

사양 §4-1의 매핑표는 **일회성 마이그레이션** 표다 — 과거 레거시 설정에서 신규 키의 **초기값**을 유도하는 것이고, 역사적으로 `analyst=T, hybrid=F`는 실제로 "자동 제출"을 의미했다. **developer 구현은 표에 충실했다. 결함은 그 마이그레이션 매핑이 "사용자가 토글할 때마다 재유도하는 런타임 경로"에 배선된 것이다.**

이것이 이 결함의 정확한 성격이고, 수정 방향도 여기서 나온다.

### 지시한 수정

1. **런타임 sync는 절대 `auto`를 산출하지 않는다** — `PATCH /api/settings/{hybrid,safety}` 경로에서 유도 모드를 **`assist` 이하로 클램프**. 자율 매매를 언급조차 하지 않는 레거시 토글은 auto에 대한 **동의로 성립할 수 없다.**
2. **`auto`는 명시 전용** — `autopilot_mode` 자체에 대한 의도적 쓰기(env 또는 전용 config)로만 설정 가능. 레거시 키에서 런타임 추론 금지.
3. `engine_enabled` 동기화는 유지(무반응 토글 버그를 고친 부분이라 옳다).
4. 부팅 시 유도는 충실 매핑 유지 가능(역사적 동작 보존, 현 운영은 `hybrid=true → assist`). 분리가 지저분하면 거기도 클램프 허용 — developer 선택 후 근거 명시.
5. **UI 라벨 수정** — 주문 제출 자율성을 바꾸는 컨트롤은 그렇다고 말해야 한다.
6. **회귀 테스트** — 런타임 경로가 어떤 레거시 조합에서도 `auto`를 만들 수 없음을 검증. `legacySwitchesToMode` 순수함수 단위 테스트는 유지(함수는 사양에 충실한 채, 호출부를 제약하는 것이 옳다).

### MEDIUM #2 — ALTER 실행 실패가 fail-closed 경로를 우회

`db.ts:774`의 `INPLACE, LOCK=NONE` 재시도가 자체 실패(락 타임아웃 등)하면 예외에 `isSchemaFatal` 마커가 없어 `setupFatalError`/`notifyCritical`/`/api/health` red를 **전부 우회**한다. 이번 라운드가 **읽기 검증 실패**에는 적용한 "검증기 자신의 실패는 조용하면 안 된다" 원칙이 **실행 실패**에는 확장되지 않은 사각지대. 동일 fail-closed 경로로 수렴시키도록 지시.

### Q2 답 — ALTER 알고리즘 선택 자체는 안전 (Leader 정정이 옳았음)

ENUM 10→13 append는 바이트폭 불변이라 INSTANT가 거부돼도 `INPLACE, LOCK=NONE`이 논리 리빌드 없이 성립(InnoDB Online DDL, MariaDB 10.11 포함). 불변식("COPY/락 금지", "INSTANT 필수 아님") 완전 충족.

### 🔴 auto 모드 활성화 전 필수 결정 — **3건으로 증가**

| # | 내용 |
|---|---|
| a | `hard_stop`/`eod_loss_cut` 무승인 auto 제출 |
| b | 비강제 청산(target_profit/trailing)의 금액상한 의미 |
| c | **[신규] auto 모드에서 `duplicate_active_signal` 스킵** — 사양 §1 표가 이 예외를 아예 다루지 않는 사각지대(reviewer 지적). 심볼당 다중 시그널이 중복체크 없이 자동 제출될 수 있다 |

셋 다 **실자금 자율성 증가**라 사용자 명시 승인 없이 켜지 않는다.

## Leader 판정 — HIGH·MEDIUM#2 수정 (2026-08-06)

### 편차 승인 — **내 지시보다 나은 해법이다**

내 지시는 "런타임 sync가 `assist` 이하로 **클램프한 값을 쓴다**"였다. developer는 **런타임 sync가 `autopilot_mode`를 아예 쓰지 않도록** 바꿨다. **이 편차를 채택한다.**

근거(developer 제시 + Leader 동의):
- 레거시 토글 둘 다 자율성에 대해 **어느 방향으로도** 아무 말을 하지 않는다. `hybrid_mode_enabled`의 진짜 의미(진입감시 vs 즉시승인 — **둘 다 assist의 하위 변형**)는 이미 `/api/signals/[id]/approve`가 직접 읽고 있다. 즉 모드를 재유도할 **필요 자체가 없었고**, Step 2의 과잉 구현이었다.
- 클램프였다면 **대칭적 하방 위험**이 남는다: 운영자가 명시적으로 켠 `auto`가 무관한 토글 한 번에 조용히 `assist`로 되돌아간다. 방향은 안전하지만 **"무관한 스위치가 자율성을 몰래 바꾼다"는 결함 클래스는 동일**하다. 쓰기를 없애면 상방·하방이 한 번에 닫힌다.

### 부팅 시점도 클램프(옵션 4b) — 채택

매핑이 두 벌이면 **같은 레거시 설정이 어느 경로를 탔느냐에 따라 다른 모드**가 나온다 — Phase 2가 제거하려는 **이중 의미 문제의 재발**이다. 하나의 검증 가능한 불변식으로 수렴시키는 것이 옳다. 운영 영향 없음(`hybrid=true → assist`), 유일하게 바뀌는 조합(`analyst=T, hybrid=F`)은 `auto → assist`로 **사람 승인 단계를 추가하는 방향**이라 fail-safe.

### 확립된 불변식

> **`auto`는 `autopilot_mode`(config) 또는 `AUTOPILOT_MODE`(env)에 대한 의도적 쓰기로만 존재한다.**
> 부팅 시드 · 런타임 동기화 · 레거시 fallback 읽기 · env 레거시 조합 — **추론 경로 전부 `assist`로 clamp.**

### 🔍 가장 주의 깊게 볼 것 — 기존 테스트 5개 수정

developer가 **코드가 아니라 테스트를 고쳤다**(`createSignal` auto_submitted, chase 3종, router unknown-`AUTOPILOT_MODE` fallback). 방향은 옳다 — 그 테스트들은 "레거시 env ⇒ auto"를 **정답으로 인코딩**하고 있었고, **그것들이 통과하고 있었다는 사실 자체가 이 위험을 안 보이게 가리고 있었다.**

다만 "테스트가 깨져서 테스트를 고쳤다"는 **회귀를 은폐하는 전형적 경로**이기도 하다. reviewer에게 **5건 각각이 (a) 교정된 계약의 문서화인지 (b) 동작 상실의 은폐인지 개별 판정**하도록 별도 감사 지시함. 특히 "그 테스트가 유일한 커버리지였던 코드 경로가 지금 미검증 상태로 남았는가"를 확인 대상으로 명시.

### MEDIUM #2 — 수렴 확인 지시

ALTER 재시도 실패가 `SchemaVerificationError`(`isSchemaFatal`)로 승격되어 `setupFatalError` → `getPool()` throw → `notifyCritical` → `/api/health` `ok:false`+503 경로로 수렴. reviewer가 **ALTER의 어떤 예외 경로도 마커 없이 빠져나가지 않는지** 확인.

### UI 라벨 — 진실성 검증 대상

새 문구가 "이 스위치로는 무승인 자동 주문이 **절대** 켜지지 않는다"고 **단언**한다. **UI의 거짓 안전 보증은 모호한 라벨보다 나쁘다** — reviewer에게 이 단언이 코드와 일치하는지 검증하도록 지시함.

## Leader 판정 — reviewer Step 4 감사 (2026-08-06)

**PASS** — Critical 0 / High 0 / Medium 0 / Low 2. safety-bypass·자금손실 인접 결함 0건. `typecheck` clean, `npm test` 46 suites/523 독립 재현.

### ⚠️ Leader 프리플라이트 서술 정정 (reviewer 지적, 수용)

내가 위 §프리플라이트 C에서 **"post-market 3종은 야간 시나리오 카드 생성이 이들에 의존하므로 반드시 살아 있어야 한다"** 고 썼는데, **이 근거는 틀렸다.**

reviewer 실측: **`post-market-engine.ts`는 `strategies.enabled`를 조회하지 않는다** — 3개 룰 함수를 **직접 하드 import** 한다. 즉 그 3행의 `enabled` 컬럼은 현재 **순수 표시용이지 기능적 의존성이 아니다.**

→ **결론(건드리지 말 것)은 그대로 유효**하지만 이유가 다르다: 기능이 깨져서가 아니라 **UI 표시와 실제 동작이 어긋나면 안 되기 때문**이다. Step 4가 어느 쪽 근거로든 이 3행을 건드리지 않은 것은 옳다.

(부수 함의: post-market 룰은 UI에서 꺼도 계속 실행된다 — **UI 토글이 진실이어야 한다는 D3 원칙의 사각지대**. 별도 backlog.)

### 실제 배포 효과 확정

- "활성 5종" UPDATE: **0행** (no-op, 이미 전부 enabled)
- "비활성 7종" UPDATE: **6행 실제 변경** (`ma-cross-v1`·`bb-breakout-v1`·`rsi-macd-reversal-v1`·`rsi-divergence-v1`·`triple-confirmation-v1`·`dividend-quality-buyback-v1`). `volume-spike-breakout-v1`은 이미 0이라 no-op
- 이것이 **이번 배포의 실질 룰 축소 효과**다.

### `MICRO_VARIATION_BUFFER_PCT` 산술 검증 — 정확

`0.33/100 + 0.0007 = 0.0040` (0.40%). 구값 0.005(0.43% 비용 + 0.07% 헤드룸) 대비 **감소분 0.10%p는 전부 비용 정정(0.43→0.33)에서 나오고 변동 헤드룸 0.07%는 그대로 보존**됐다. `order_limit` 거부 방지 목적이 정량적으로 유지됨을 확인.

### Low 2건

1. **`ai-prefilter.test.ts`의 stale 4번째 인자** — 현 3-파라미터 시그니처와 불일치. 런타임 무해(여분 인자 무시)이나 **두 검증 게이트 모두에서 안 보인다**: `tsconfig.json`이 테스트 파일을 typecheck에서 제외하고, jest는 `@swc/jest`(비-타입체크 트랜스파일러)를 쓴다.
   → 📌 **프로젝트 차원의 발견**: **테스트 코드는 타입 검사를 전혀 받지 않는다.** 테스트가 실제 시그니처와 어긋나도 두 게이트 다 통과한다. 별도 backlog.
2. **마이그레이션 트랜잭션 규율** — 3종 모두 명시 트랜잭션 없이 autocommit. 현재는 **모든 UPDATE가 상태 가드(`AND enabled=0/1`, `< 1`, `value IN (...)`)를 달고 있어 재시도 멱등**이라 안전하다. 단 이는 **구조적 강제가 아니라 규율**이라, 향후 비멱등 statement가 추가되면 조용히 깨진다. 조건부 backlog.

### 배포 단위 — 구조적으로 강제됨

Step 3(`engine.ts`)과 Step 4(`db.ts`/rules/`style.ts`)가 **같은 미커밋 워킹트리에 있고 이들을 가르는 feature flag가 없다** → 재시작 1회로 둘 다 적용된다. 내 "함께 배포" 정책은 **프로세스 규칙이 아니라 구조적 사실**로 확인됨.

## Leader 판정 — autopilot 수정 감사 + QA 범위 분할 (2026-08-06)

### autopilot 수정 감사 **PASS** (critical 0 / high 0 / medium 1 / low 1)

→ **감사 4종 전부 통과**: Step 1·2 · Step 3 · Step 4 · autopilot 수정.

**테스트 5건 개별 판정 = 전부 "정당한 계약 수정, 은폐된 회귀 아님".** 특히 `router.test.ts`의 "알 수 없는 `AUTOPILOT_MODE` 값" 케이스는 reviewer가 독립 재유도한 결과 **원래 취약점과 같은 부류(env fallback)의 별도 인스턴스**였음이 확인됐다 — 수정이 DB-sync 표면에만 좁게 적용된 게 아니라는 증거. `auto` 도달 경로 전수 grep으로 **오늘 기준 수동 DB 쓰기 외 도달 불가** 확인.

### Medium — UI 문구 과장 주장 (지금 수정 지시)

새 문구 `"어느 쪽이든 사람이 승인해야 주문이 나갑니다"`가 **거짓**이다. `routeSignal()`은 `hard_stop`/`eod_loss_cut` 청산을 **모드·토글 무관 무조건 자동제출**한다(Step 5 승인대기 (a)번 항목). reviewer가 검증한 **좁은 주장**("이 스위치 단독으로 `auto`가 될 수 없다")은 사실이나, 그 위에 얹은 **넓은 문구**가 과장.

→ 내가 라벨 승인 시 경고했던 **"UI의 거짓 안전 보증은 모호한 라벨보다 나쁘다"** 가 그대로 현실화됐다. 사람 승인 보증을 **신규 진입 주문으로 스코프 축소** + **보호 청산 예외를 명시적·가시적으로 기술**하도록 수정 지시. 이번 배포에 같이 나가는 화면이라 Step 5로 미루지 않는다.

### Low — `AUTOPILOT_MODE` env 경로가 사실상 죽은 코드

배포 후 config row가 항상 먼저 존재해 env가 도달 불가. 방향은 안전(auto가 더 어려워짐)이라 무결성 문제 아님 — **문서 정확성** 문제로 주석 정정 지시.

---

## 🔬 QA 범위 분할 — §6 기준 8개 중 4개는 **배포 전 검증 물리적 불가**

Leader 판단: T-003 §6의 정량 기준을 **그대로 QA에 던지면 안 된다.** 절반이 **실제 운영 데이터를 필요로 하는 사후 기준**이라, 배포 전에 검증하라고 지시하면 QA가 막히거나 근거 없이 통과 선언하게 된다.

### A. 배포 전 검증 가능 (QA 이번 라운드 범위)

| §6 | 항목 | 검증 방법 |
|---|---|---|
| 3(일부) | **부팅 ENUM 검증 fail-closed** | 고의로 코드 상태 하나 추가 → 기동 실패·health red 실측 |
| 4(일부) | 시간축 단일성 | 코드·테스트 수준 (`interval` 강제 1h/1d) |
| 6 | **안전 회귀 배터리 (최우선)** | KILL_SWITCH · 블랙리스트 · ORDER_MAX/일일한도 · `liquidity_dead` · `late_session` · `losing_position_buy_block` · `portfolio_max_positions` · `regime_gate_macro_bear` |
| 8 | exit 보호 (생성 성공 + 런 계속) | 통합 테스트 |
| 신규 | **auto-clamp 회귀** | 모든 레거시 조합 × sync/config/env 경로가 `auto`를 못 만드는지 |
| 신규 | **`liquidity_dead` 동작 등가** | 1봉@1h ≡ 2봉@30m 벽시계 등가, 감지 둔감화 없음 |
| — | 전체 스위트 그린 | 46 suites / 523 tests |

### B. 배포 후에만 검증 가능 (**Step 5 진입 게이트**, 이번 배포 가부와 무관)

| §6 | 항목 | 왜 사후인가 |
|---|---|---|
| 1 | **소생** — 3영업일 연속 룰 발화 ≥10/일 + 시그널 1~10/일 | 새 파이프라인의 실제 런이 3영업일 필요 |
| 2 | 감쇠 분산 — 단일 게이트 90% 초과 사살 없음, `strong_counter_trend`·AI 게이트 ID 미출현 | 신규 `eval_funnel` 데이터 필요 |
| 5 | 중복·스팸 — 2h 내 동일 (symbol,strategy,side) 2건 이상 0 | 실제 시그널 생성 필요 |
| 7 | 런 성능 <60s, KIS 호출 수 감소 | 실운전 계측 필요 |

> **이 분할의 의미**: 이번 QA PASS는 **"배포해도 안전한가"** 에 대한 답이지 **"시그널이 실제로 소생했는가"** 에 대한 답이 아니다. 후자는 배포 후 3영업일 관측으로만 확인되며, 그것이 **Step 5(실거래 해제) 진입 조건**이다. 사용자 보고 시 이 구분을 명확히 할 것.

---

## QA 검증 완료 (2026-08-06 14:47 KST)

### ✅ 검증 통과

**A. 전체 테스트 스위트**
- `npm run typecheck` — 통과 (0 errors)
- `npm test` — **46 suites / 523 tests 전부 통과** (baseline 일치)
- 실행 로그: 모든 테스트 통과, 경고/에러 0건 (console output 정상 범위)

**B. 안전장치 회귀 배터리 (9개 항목)**
모든 회귀 테스트 그린, 코드 경로 검증:
1. ✅ **KILL_SWITCH=true** → `submitOrder` 즉시 블로크 (step 3, line 123-126, `src/lib/safety/dry-run.ts`)
2. ✅ **Symbol blacklist** → `checkSymbolBlacklist` (step 4, line 129-133)
3. ✅ **ORDER_MAX** → `checkOrderMax` fail-closed, sell 제외 (line 146-152)
4. ✅ **Daily limit** → `checkDailyMax` fail-closed, sell 제외 (line 156-162)
5. ✅ **liquidity_dead** → `LIQUIDITY_DEAD_MIN_ZERO_BARS=1` (1h×1bar ≡ 30m×2bars 벽시계 등가), 상장폐지 탐지 둔감화 없음 (test 검증)
6. ✅ **late_session_buy_block** → `isLateSessionBuyBlockKST()` eval_funnel_labels.ts stage 7에 기록
7. ✅ **losing_position_buy_block** → engine.ts guard drop 카운트, eval_funnel stage 5
8. ✅ **portfolio_max_positions** → portfolio-stability.ts, eval_funnel stage 8
9. ✅ **regime_gate_macro_bear** → macro indicator gate (stage 6 = `regime_gate_macro_bear`)

**C. 부팅 ENUM fail-closed (unit level)**
- ✅ `assertSignalStatusEnum()` 검증 로직 (src/lib/signals/__tests__/statuses.test.ts):
  - DB ENUM 값 누락 시 → `SignalStatusEnumMismatchError` throw
  - COLUMN_TYPE 읽기 실패 시 → `SchemaVerificationError` throw (검증 불가 ≠ 통과)
  - 둘 다 `isSchemaFatalError()` 마킹
- ✅ `setupFatalError` 설정 → 모든 `getPool()` throw (T-003 §4-2 원칙)
- ✅ `/api/health` 응답 (src/app/api/health/route.ts line 58-94):
  - `ok: false` (line 70)
  - HTTP 503 (line 94)
  - `schemaFatal: true` (line 72)
  - `safetyReasons: ['schema_verification_failed']` (line 60)
- **검증 방법**: 실제 기동 대신 unit test로 확인 (운영 DB 무적절), 기존 테스트가 이미 모든 경로 고정

**D. auto-clamp 회귀 (legacy 4조합 × 3경로)**
모든 경로에서 legacy 조합이 auto를 만들지 않음 확인 (src/lib/signals/__tests__/autopilot-clamp.test.ts):
- ✅ `legacySwitchesToMode(true, false)` 사양은 auto 반환하지만, **사용 금지**
- ✅ `inferAutopilotModeFromLegacy()` — 모든 4조합이 assist로 클램프
- ✅ `clampInferredMode(mode)` — auto만 assist로 강등, 나머지 보존
- ✅ **런타임 동기화** (`syncEngineSwitchesFromLegacy()`) — `autopilot_mode` 기록 안 함 (18행)
- ✅ **읽기 경로** (`getEngineSwitches()`) — 구 키 추론도 상한 (line 115-116, 원래 값이 auto일 때는 보존)
- ✅ **env 폴백** — 구 조합 추론은 상한, 명시 지정만 존중
- ✅ **회귀 재현** — `analyst=true, hybrid=false` → assist (auto 아님), 테스트 라인 92-97

**E. liquidity_dead 동작 등가**
- ✅ 시간축 변경 전후 동일 벽시계 기간 검증:
  - 구: 30m 캔들 × 2봉 무거래 = 1시간
  - 신: 1h 캔들 × 1봉 무거래 = 1시간
  - 임계: `LIQUIDITY_DEAD_MIN_ZERO_BARS=1` (이전 2에서 감소하지 않음, 등가 환산)
  - 테스트 검증 (ai-prefilter.test.ts): 1h 축 1봉 감지 확인 (주석: "벽시계 기준 동일")

**F. exit 보호 (언제나 실행)**
- ✅ exit-engine 실행 순서 (engine.ts line 894):
  - 시장 개장 확인 직후, **모든 게이트 전**에 `runExitEngine()` 호출
  - `engine_disabled` 스위치 (line 899) **아래**에 위치
  - `dueStrategies.length === 0` 체크 전에 (구 구멍 해소)
  - exit 신호 발화 시 `createSignal` → `submitOrder` 정상 경로 (안전장치 통과)
  - `engine_disabled=true` 상태에서도 verdict='skip', exitSignalsCreated 기록 (line 913)

**G. 시간축 단일성 (1h 강제, 1d 유지, 30m 제거)**
- ✅ `INTRADAY_INTERVAL = '1h'` (engine.ts line 146)
- ✅ `resolveEngineInterval(declared: string)` (line 149-151):
  - `declared === '1d'` → 1d 유지
  - 그 외 → 1h 강제 (기존 30m/adaptive 모두 1h로 정규화)
- ✅ market-state 라벨·룰 지표·승인 카드가 **같은 1h summary 객체** 사용 (line 144)
- ✅ 코드 전수 검색: 30m 문자열 엔진 경로에서 0개 (comment만, 동작 아님)

**H. UI 카피 진실성 (settings screen)**
✅ 세 안전 주장 모두 `routeSignal()` 코드로 검증 (src/lib/signals/router.ts):

1. **"신규 진입(매수) 주문은 사람이 승인해야 나갑니다"**
   - 검증: routeSignal line 287-309 switch 문
   - `manual` mode (line 288-289) → `detected` status (사람만 진행)
   - `assist` mode (line 305-307) → `awaiting_approval` status (승인 필수)
   - `auto` mode (line 290-304) → limit 초과분 `awaiting_approval`으로 격하
   - ✅ 진입이 아닌 청산(force-exit)은 라인 283-285 **이전에** 처리되므로 신규에만 해당

2. **"하드 손절과 장마감 손실 차단 매도는 이 설정·자동조종 모드와 무관하게 자동 제출"**
   - 검증: routeSignal line 282-285 (`FORCED_AUTO_EXIT_KINDS`)
   - `hard_stop`, `eod_loss_cut` → 어떤 모드이든 line 284 즉시 `auto_submitted` + `forcedExit: true`
   - ✅ 모드 switch (line 287)에 도달하지 않음

3. **"목표 익절·트레일링 스탑 매도는 일반 승인 경로를 따릅니다"**
   - 검증: routeSignal 라인 295-297 주석 (target_profit/trailing_stop은 unprotected exit)
   - line 283 FORCED_AUTO_EXIT_KINDS 체크에서 제외 (hard_stop/eod_loss_cut만 포함)
   - 따라서 line 287-309 일반 autopilotMode 라우팅 타입
   - assist 모드 → awaiting_approval 경로 (일반 승인)
   - ✅ 테스트 근거: router.test.ts (3개 기존 테스트가 hard_stop/eod_loss_cut 모드무관 자동제출, target_profit/trailing은 승인 경로 검증)

---

### 최종 보고

**검증 항목**: A~H (8개 체크리스트) 전부 통과  
**심각 결함**: 0건  
**테스트 결과**: 46 suites, 523 tests all green  
**코드 변경**: 0 (검증 전용 읽기, 테스트 실행)  
**배포 전 범위 완료**: ✅  
**배포 후 범위 (Step 5 게이트)**: 미검증 (실운전 데이터 필요, 예정대로)

**결론**: 이번 Phase 2 구현(Steps 0~4)은 **배포 안전 기준을 만족한다.** 실매매 안전장치 회귀, ENUM fail-closed, auto 클램프, 시간축 단일성이 모두 확인됐으며, UI 카피도 실제 동작과 일치한다. Step 5(DRY_RUN 관측→실거래)는 배포 후 3영업일 운영 데이터로만 판정 가능하므로 분리한다.

## QA 검증 결과 + Leader 독립 재확인 (2026-08-06)

QA 판정 **✅ 검증 통과** (A~H 8개 항목 전부). 다만 QA 보고서가 **"실제 트리거"보다 코드 리딩에 기울어 있었고 인용 1건(`ai-prefilter.ts:1`)이 명백히 부정확**해, Leader가 **최고위험 항목을 직접 재확인**했다.

### Leader 직접 실측 (전건 확인)

| 항목 | 실측 결과 |
|---|---|
| `npm run typecheck` | **exit 0** |
| `npm test` | **46 suites / 523 tests 전부 통과** |
| `LIQUIDITY_DEAD_MIN_ZERO_BARS` | **= 1**, 근거 주석 명시("장중 축이 1h로 통일됐으므로 1봉 = 실시간 1시간, 구 30m×2봉과 등가") — 명명 상수 + 문서화 확인 |
| KILL_SWITCH | `dry-run.ts:123` — `isKillSwitchActive()` → `markBlocked(orderId,'kill_switch')` → 하드 return. **블랙리스트 검사보다 앞** |
| auto-clamp | `MAX_INFERRED_AUTOPILOT_MODE='assist'` + `clampInferredMode()` 랭크 비교. `inferAutopilotModeFromLegacy` 주석에 "**절대 `auto`를 반환하지 않는다**" 명시 |
| exit-engine 무조건 실행 | `engine.ts:894` `runExitEngine(...)` → **`engine.ts:899` `if (!switches.engineEnabled)`**. **청산이 엔진 스위치보다 먼저** — Leader 결정 ① 구조적으로 충족 |
| 워킹트리 | 47 파일 미커밋, `HEAD=359cb7b`, origin과 동기. **커밋·배포 없음** |

→ QA 결론은 **유효**하다. 인용 품질은 부실했으나 실체는 전부 사실로 확인됐다.

---

## 최종 요약

**Phase 2(시그널 파이프라인 재설계) 구현·검증 완료. 배포는 사용자 승인 대기.**

### 왜 했나

시그널이 **0건**이었다. 착수 시 운영 DB 실측에서 원인이 숫자로 확인됐다 — 깔때기 종료 행의 **약 95%(10,720건)가 `rule_no_fire`**, 즉 후보가 룰 발화 단계에서 전멸하고 있었다. analyst가 지목한 **market-state 데드락**(룰이 활성화되는 RSI 구간과 룰이 발화하는 RSI 구간의 교집합이 공집합)이 최상류 병목임이 실측으로 확정됐다.

### 무엇을 했나

- **market-state를 게이트에서 라벨로 강등** — 데드락의 직접 해소. 이것이 이번 수술의 핵심.
- **장중 AI 완전 제거** (게이트 7종 + 관련 코드 ~283줄). `claude` CLI 실패가 매수 경로를 죽이던 구조 소멸. post-market AI는 그대로.
- **게이트 체인 4단계 재편** — 게이트별 fail 방향(차단이 안전한 것 vs 통과가 안전한 것)을 명시 계약으로 고정.
- **쿨다운 3종을 단일 테이블로 통합**, 상태 테이블 의존 제거.
- **장중 시간축 1h 단일화** (라벨·룰·프리필터가 같은 summary를 공유).
- **활성 룰을 14종 → 8종으로 축소**(장중 5 + post-market 3), 파라미터 실측 재도출(RSI 35→38 등), 왕복비용 0.43%→0.33% 정정.
- **스위치 이중 의미 해소** — `ENGINE_ENABLED`(엔진) / `AUTOPILOT_MODE`(자율성) 분리.
- **부팅 시 ENUM 검증 fail-closed** — 이번 사태의 제1사인(코드-DB 상태 불일치가 무증상 전멸을 일으킴)의 **구조적 재발 차단**.

### 도중에 발견해 고친 것 (원래 계획에 없던 것들)

1. 🔴 **"하이브리드 모드" 토글이 표시 없는 auto 모드 진입 문이었다.** 스위치 한 번으로 전체 파이프라인이 무승인 자동매매로 전환됐다. 실주문을 막고 있던 유일한 것이 `KILL_SWITCH=true`였고, **그게 정확히 Step 5에서 해제하려던 스위치**다. 원인은 "일회성 마이그레이션 매핑을 런타임 경로에 배선"한 것. 이제 `auto`는 명시적 쓰기로만 가능.
2. **`SIGNAL_AUTO_SUBMIT_MAX_KRW`가 설정만 있고 코드에 강제되지 않았다** — auto 모드에서 금액 무관 자동제출이 가능했던 잠재 공백. 강제됨.
3. **UI가 거짓 안전 보증을 하고 있었다** — "어느 쪽이든 사람이 승인해야 주문이 나갑니다"는 보호 청산 자동제출과 모순. 보장 범위를 신규 진입으로 좁히고 예외를 별도 블록으로 명시.
4. **`liquidity_dead` 둔감화 위기** — 축이 30m→1h로 바뀌면서 파라미터를 그대로 두면 상장폐지 감지 기준이 1시간→2시간으로 늘어날 뻔했다. 벽시계 등가로 재도출.
5. 부팅 시 사용자 UI 설정을 덮어쓰던 재동기화 제거 — UI 토글이 비로소 진실이 됨.

### 검증

**독립 감사 4회**(Step 1·2 / Step 3 / Step 4 / autopilot 수정) **전부 PASS**, QA 8개 항목 통과, Leader가 최고위험 항목 직접 재확인. 테스트 **40 suites/413 → 46 suites/523**. 게이트 24개 fail 방향 **뒤집힘 0건**.

### ⚠️ 이번 검증이 답하지 않는 것

**"배포해도 안전한가" = 예. "시그널이 실제로 소생했는가" = 아직 모른다.**

소생·감쇠분산·중복스팸·런성능은 **새 파이프라인의 실제 운전 데이터가 있어야만** 확인된다(3영업일). 그것이 **Step 5(실거래 해제) 진입 조건**이지 이번 배포의 조건이 아니다.

### 🔴 사용자 결정 대기

1. **배포 승인** — 47파일 미커밋. `agent-vault/` 문서 포함 필수(`git clean -fdx`가 미추적 파일을 지운다).
2. **auto 모드 활성화 전 승인 3건** — (a) `hard_stop`/`eod_loss_cut` 무승인 자동제출 (b) 비강제 청산의 금액상한 의미 (c) auto 모드가 `duplicate_active_signal`을 건너뛰는 문제. 셋 다 실자금 자율성 증가 항목이라 명시 승인 없이 켜지 않는다.
3. **현재 `safety_kill_switch=true`** — 이 상태에서는 어떤 주문도 나가지 않는다. Step 5 진입 시 `DRY_RUN`/`KILL_SWITCH` 중 어느 쪽으로 관측할지 결정 필요.

## ✅ 배포 완료 + 실기동 검증 (2026-08-06 11:34~11:40 KST)

사용자가 장중 즉시 배포를 명시 선택(리스크 고지 후). `safety_kill_switch=true`라 실주문 노출 0.

| 항목 | 결과 |
|---|---|
| 커밋 | `c064e83` — 소스·설정 45 + agent-vault 5 = **50파일** |
| push | `359cb7b..c064e83` (11:34:55) |
| webhook-deploy | `started 11:35 → finished exit=0` |
| pm2 재시작 | 319 → **320회 1회만**. 재시작 루프 없음 |
| health | reload 순간 1회 `000` 후 **200 안정** |
| **에러 로그 증가** | **0바이트** |

### 부팅 시 DB 마이그레이션 — 전건 적용 확인

```
11:35:30 [db] one-time migration applied: Phase 2 D3 기본 활성 룰 5종 적용
11:35:31 [db] one-time migration applied: backtest_interval_h 5분→6h 리셋
11:35:33 [db] one-time migration applied: 백테스트 비용 모델 교정
```

| 대상 | 실측 결과 |
|---|---|
| `signals.status` ENUM | **13개** — 기존 10개 순서 보존 + `detected`·`awaiting_approval`·`skipped` 추가 ✅ |
| `cooldowns` 테이블 | 생성됨 ✅ |
| 마이그레이션 마커 | 3종 전부 기록 ✅ |
| **`autopilot_mode`** | **`"assist"`** ✅ — 레거시(analyst=T, hybrid=T)에서 clamp 정상 동작 |
| `engine_enabled` | `true` ✅ |
| strategies | **활성 8종**(장중 5 + post-market 3) / 비활성 8종 ✅ 설계와 정확히 일치 |
| `backtest_interval_h` | 장중 5종 **6**, post-market 3종 **24 보존** ✅ |
| 비용 모델 | `backtest_fee_pct=0.09`, `backtest_slip_pct=0.15` ✅ |
| **안전 설정** | `safety_dry_run=false`, `safety_kill_switch=true`, order_max 6, daily 10 — **전부 미변경** ✅ |

### 🟢 핵심 수술 효과 — market-state 데드락 해소, 실데이터로 확인

배포 후 첫 런(11:39:03) `collect` 행 실측:

```json
symbol 196170: {"marketState":"breakout_watch","interval":"1h","rsi14":63.2,
                "rules":{"active":["bb-squeeze-expansion-v1","pullback-trend-v1",
                                   "rsi-overbought-exit-v1","rsi-oversold-v1",
                                   "weekly-trend-follow-v1"], ...}}
symbol 005930: {"marketState":"trend_following","interval":"1h","rsi14":43.1,
                "rules":{"active":[...동일한 5종...], ...}}
```

**결정적 증거**: 두 종목의 `marketState`가 **서로 다른데(`breakout_watch` vs `trend_following`) `rules.active`가 동일한 5종**이다. 구 코드에서는 상태별로 활성 룰 집합이 달라졌고(neutral이면 30m 룰 전멸), 그것이 데드락의 메커니즘이었다. **이제 market-state는 라벨로만 기록되고 룰 활성화에 관여하지 않는다 — 데드락은 구조적으로 소멸했다.** ✅

- `interval: "1h"` 단일축 확인 ✅
- **구 게이트 전부 소멸 확인**: `ai_*` · `prefilter_strong_counter_trend` · `strategy_throttled` · `skip_seal_24h` · `dedup_regime` **전부 0건** ✅
- run 행: `symbols:25, strategies:5, skippedStrategyIds:[post-market 3종], errors:0` ✅
- market_state 라벨 분포: `trend_following` 11 · `breakout_watch` 9 · `null` 5(분류 불가 = 라벨 null, fail-open 설계대로)

### 🔴 신규 발견 — `weekly-trend-follow-v1`은 **현재 절대 발화할 수 없다**

첫 런 실측에서 드러남:

```
insufficientCandles: [{"id":"weekly-trend-follow-v1","interval":"1d","got":100,"need":210}]
candles_fetch_failed: 8건 — 전부 interval "1d"
```

**KIS가 일봉을 100봉만 반환하는데 이 룰은 210봉을 요구한다.** 즉 기본 활성 5종 중 하나가 **구조적으로 발화 불가**다 — market-state 데드락과 **같은 클래스의 결함**(조건이 영원히 충족되지 않는 룰).

**왜 지금 드러났나**: 이 룰은 이전엔 `FIND_IN_SET`(applicable_styles=`neutral,stable` vs 하드코딩된 style=`aggressive`)으로 **차단돼 있어 평가조차 되지 않았다.** Phase 2가 FIND_IN_SET을 제거하고 기본 활성으로 올리면서 **비로소 평가 경로에 올라왔고, 그 즉시 불가능함이 관측됐다.** 관측 계층이 제 역할을 한 사례.

**영향**: 실질 장중 활성 룰은 **5종이 아니라 4종**(bb-squeeze-expansion · pullback-trend · rsi-overbought-exit · rsi-oversold). analyst가 이 룰에 기대한 "주 2~5건"은 **0건**이 된다.

**심각도**: 배포 차단 사유 아님 — 발화하지 않을 뿐 잘못된 시그널을 만들지 않는다(fail-safe 방향). 다만 **§6-1 소생 기준(일 1~10건) 달성 여력이 그만큼 줄어든다.**

**대응 선택지** (사용자/analyst 판단 필요):
1. KIS 일봉 조회 봉수를 210+ 로 늘릴 수 있는지 확인(API 파라미터/페이징)
2. 룰의 `need`를 실제 확보 가능한 봉수(100)에 맞춰 재설계 — MA200 요구를 MA60 등으로 완화하면 룰의 의미가 바뀌므로 analyst 재설계 필요
3. 기본 비활성으로 되돌리고 장중 활성 4종으로 운영

### 첫 런 깔때기 결과 (해석 주의)

25종목 전부 `stage 4 rule_no_fire`, 시그널 0건. **이것을 실패로 읽으면 안 된다** — §6-1 기준은 **일 단위 집계(3영업일)** 이지 런 단위가 아니다. 실측 RSI(63.2 / 43.1)는 `rsiBuyThreshold=38` 미만이 아니므로 **정직한 미발화**다. 구 코드에서는 RSI 43.1이 `oversold_bounce` 활성창에 들어가고도 룰 발화창(RSI<35)과 교집합이 없어 영원히 못 쐈다 — **지금은 같은 값이 단순히 "38 미만 아님"으로 정직하게 판정된다.** 메커니즘이 달라졌다.

## 🟢 Step 5 관측 Day 1 실측 — 2026-08-07 (금), 첫 전체 거래일

Phase 2 배포(2026-08-06 11:35) 후 **첫 온전한 장중 하루**. §6 사후 기준 중 관측 가능한 것 실측.

| §6 기준 | 목표 | 실측 | 판정 |
|---|---|---|---|
| 1. 소생 — 룰 발화 후보 | 일 **≥10건** | **106건** | ✅ |
| 1. 소생 — 시그널 생성 | 일 **1~10건** | **9건** | ✅ |
| 2. 구 게이트 미출현 | `ai_*`·`strong_counter_trend` 등 0 | **0건** | ✅ |
| — | 런 수 | 131런 / 7,330행 | — |

### 🎉 시그널이 실제로 소생했다

**7/19 이후 0건이던 시그널이 하루 9건 생성됐다.** Phase 2의 목적이 실측으로 달성됨.

생성 내역:

| 전략 | 방향 | 상태 | 건수 |
|---|---|---|---|
| `pullback-trend-v1` | buy | expired | 5 |
| `rsi-oversold-v1` | buy | expired | 4 |
| `rsi-oversold-v1` | buy | ai_skipped(post-market) | 3 |
| `exit-engine-v1` | sell | **auto_submitted** | 2 |

**기본 활성 5종 중 실제로 발화한 것은 `pullback-trend-v1`·`rsi-oversold-v1` 2종**(+exit). `rsi-oversold-v1`이 발화했다는 것 자체가 **market-state 데드락 해소의 직접 증거** — 구 코드에서 이 룰은 활성창∩발화창=∅ 로 영원히 못 쐈다.

병목은 여전히 `rule_no_fire`(2,770)이나 이는 정상(대부분의 종목×틱은 발화하지 않는 것이 정상). `cooldown_entry` 61건으로 **통합 쿨다운이 실제로 중복을 막고 있음** 확인(cooldowns 테이블: entry 5 · exit 2).

### 🔴 사용자 확인 필요 1 — 보유 종목 대규모 평가손실

EOD 손절이 발화한 2건의 사유:

```
005930  [EOD 손절] KST 15:20~15:29 동시호가, 손실 -30.17% ≤ -1.5% → 시장가 청산
000660  [EOD 손절] KST 15:20~15:29 동시호가, 손실 -46.19% ≤ -1.5% → 시장가 청산
```

**-30%·-46%는 매우 큰 손실이다.** 두 가지 가능성이 있고 어느 쪽인지 사용자 확인이 필요하다:
1. 실제로 큰 평가손실 상태인 보유 종목이다 → 즉시 판단 필요
2. KIS 잔고의 `avgPrice`가 잘못 들어와 손실률이 과대 계산됐다 → 데이터 결함

`exit_unit_mismatch` 가드(price/entry 비율 [0.3,3.0])를 통과했으므로 단위 사고는 아니다.

### 🟢 사용자 확인 필요 2 — 안전장치가 실제로 작동함을 실측 확인

위 EOD 손절 2건이 `auto_submitted`로 주문 생성까지 갔으나 **둘 다 KILL_SWITCH가 차단했다**:

```
order 3217  005930 sell  status=blocked  blocked_by=kill_switch
order 3216  000660 sell  status=blocked  blocked_by=kill_switch
```

**오늘 실제로 체결된 주문 0건.** `safety_kill_switch=true`가 설계대로 최종 방어선 역할을 했다.

동시에 이것은 **내가 Step 5 승인 대기 항목 (a)로 올린 "`hard_stop`/`eod_loss_cut` 무승인 auto 제출"이 실제로 발동하는 경로임을 실증**한다 — KILL_SWITCH를 해제하는 순간 이 2건은 승인 없이 시장가로 나갔을 것이다. 승인 판단 시 이 사실을 반영할 것.

### ⚠️ 관측 3 — 매수 시그널 9건이 전부 승인 없이 만료

`pullback-trend`·`rsi-oversold`의 매수 시그널 9건이 모두 `expired`. assist 모드는 사람 승인이 전제인데 **아무도 승인하지 않았다.** 시그널은 소생했으나 **승인 루프가 돌지 않으면 매매로 이어지지 않는다** — 텔레그램 알림 도달([[T-007-telegram-silent-failure]])이 여기 직결된다.

### 관측 4 — `candles_fetch_failed` 643건

131런 대비 런당 ~5건. 대부분 1d 축(= `weekly-trend-follow-v1`의 210봉 요구 관련, 이미 기록된 이슈). 실해는 없으나 KIS 호출 낭비.

### 남은 관측

- **3영업일 완료 시점: 2026-08-11(화)** — 08-07(금) 완료, 주말 제외, 08-10(월)·08-11(화) 필요
- §6-5(중복·스팸), §6-7(런 성능)은 3일치 누적 후 판정
