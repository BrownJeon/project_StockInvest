---
task-id: T-002
project: StockInvest
created: 2026-08-02
status: done
tags:
  - type/task
  - domain/observability
aliases:
  - Phase 1 평가 깔때기 관측
---

# T-002 · Phase 1 — 관측: "왜 시그널이 없는가"를 화면에

## 배경

재구성 플랜 Phase 1. 시그널 미생성의 원인을 아무도 몰랐던 이유는 **게이트별 차단을 기록·표시하는 관측이 없었기 때문**이다. 이 단계에서는 **엔진 로직을 일절 수정하지 않고 계측만 삽입**한다 — Phase 2 수술 전에 실측 근거를 확보하는 것이 목적. [[T-001-phase0-safety-foundation]] 완료 후 착수.

핵심 소스: `src/lib/strategy/engine.ts`(runMarket/collectCandidates/applyFilters의 모든 skip 지점), `src/lib/strategy/ai-filter.ts`(skip 카테고리), `src/lib/reports/trade-report.ts`(아침 리포트), 대시보드(`src/components/dashboard/Dashboard.tsx`).

## 작업 범위

### 관측 (원래 범위)

1. **`eval_funnel` 테이블 신설** (db.ts): analyst 확정 스키마(§2~3) 따를 것 — pass 전건 기록 금지, "run 1행 + collect 1행/심볼 + skip 전건 + final 1행/심볼" 정책. 볼륨 추정 반영.
2. **engine.ts 계측**: analyst 게이트 분류표(§1)의 gate ID 체계를 **그대로** 사용해 모든 skip/pass 지점에 기록 삽입. 특히 관측열 ❌(무기록) 지점 전부. 런 스코프 배열 누적 → 종료 시 multi-row INSERT(게이트마다 즉시 INSERT 금지), 기록 실패는 삼켜 엔진에 영향 없게.
3. **대시보드 "오늘의 평가 깔때기" 카드**: analyst §4의 카드 순서(결론 헤더 → 이상 배너 → 병목 1줄 → 6단계 미니 바 → 최다 차단 top3). 모바일 412px 완결.
4. **trade-report에 깔때기 요약 포함** (아침 텔레그램/슬랙) — analyst §4 문단 포맷.
5. ~~JSON_EXTRACT 실측 판정~~ → **완료·기각**. analyst 실측: `eq_plain=3134 = eq_unquoted=3134`(n=13,811) — 문법 정상. 단 exit 쿨다운의 `'executed','accepted'`는 실존하지 않는 status라 아래 H3에서 교정.

### 핫픽스 (범위 확대 — Leader 결정 2026-08-02)

[[T-003-phase2-pipeline-redesign]] analyst 실측에서 **제1사인**이 확정됐다: 운영 config `hybrid_mode_enabled=true` + MariaDB STRICT 모드 + `signals.status` ENUM에 `pending_approval` 부재 → INSERT가 하드 에러 → **AI 통과 후보와 exit 청산 시그널이 전부 사망하고, 미보호 createSignal 호출 때문에 그 예외가 runMarket 전체를 중단**시킨다. 7/19 이후 시그널 0건/일의 직접 원인.

Phase 2 본수술까지 기다릴 이유가 없다. 관측과 함께 아래를 적용해 **시그널을 소생시키고, 동시에 왜 나오는지도 보이게** 한다.

- **H1. `signals.status` ENUM에 `pending_approval` 추가** (db.ts). **합집합 확장만** — 기존 값 제거·재정의 금지(인플레이스 ALTER). 기존 row 이관 불필요(해당 status row 0건 실측).
- **H2. createSignal 호출부 예외 격리**: `runExitEngine`·`applyBatchDecisions`의 createSignal 호출을 try/catch로 감싸 **한 건의 실패가 런 전체를 죽이지 않게** 한다. 실패는 `signal_create_failed` gate로 verdict=error 기록 후 다음 후보 계속.
- **H3. exit 쿨다운 쿼리 교정**: `signals.status IN ('executed','accepted')` — signals에 존재하지 않는 값이라 쿨다운이 영구 무효였다. 실제 상태값으로 교정(중복 청산 방지 = 안전 이슈).
- **H4. `price-breakout-v1` 기본 비활성**: 최근 14일 후보의 **73%**(3,304건)를 이 룰 하나가 생성했고, 코인 24h 고저 로직이 주식 당일 고저로 오작동한 결과다. Phase 2에서 재설계 전까지 seed `enabled=0`. **기존 운영 DB 값을 코드가 강제로 덮어쓰지 말고**(db.ts:374-377 재동기화 문제와 같은 함정), 별도 일회성 마이그레이션으로 처리하거나 Leader에게 확인.

## 수용 기준 (갱신)

1. strategy-eval 1회 실행 시 평가된 모든 (종목×전략)의 최종 verdict가 eval_funnel에서 추적 가능
2. 대시보드 카드와 아침 리포트에 깔때기 요약 표시
3. 게이트 사유 기록이 코드 상 skip 지점과 1:1 대응 (qa 검증)
4. **H1~H3 적용 후 DRY_RUN 상태에서 시그널이 실제로 생성된다** (0건 탈출 — 이것이 이 Phase의 진짜 성공 지표)
5. exit 룰 발화 시 시그널 생성 성공 + 런 계속 (현행은 런 전체 사망)

## 게이트 분류표 (analyst)

> 작성: analyst(Fable) 2026-08-02. 대상 소스: engine.ts / ai-prefilter.ts / ai-filter.ts / market-state.ts / portfolio-stability.ts / ai-dedup.ts / signals/service.ts (+ exit-engine.ts, market-hours.ts, style.ts, rules/*). 라인 번호는 2026-08-02 main 기준.

### 0. 단계(stage) 번호 체계

| stage | 의미 | 단위 |
|---|---|---|
| 0 | 런 게이트 (시장·스위치·스로틀) | run |
| 1 | 심볼 열거·티커 | symbol |
| 2 | 시장상태 분류 → 룰 활성화 | symbol×strategy |
| 3 | 캔들 확보 | symbol×strategy |
| 4 | 룰 발화 | symbol×strategy |
| 5 | 포지션·이력 가드 | candidate |
| 6 | 거시 레짐 게이트 | candidate(buy) |
| 7 | 프리필터 + 장마감 매수차단 | candidate |
| 8 | 포트폴리오 안정성 가드 | candidate(buy) |
| 9 | dedup (레짐 버킷) | candidate |
| 10 | AI 관문 (stage1/batch/fallback/confidence) | symbol/candidate |
| 11 | createSignal 게이트 (블랙리스트·중복) | candidate |
| 99 | 시그널 생성됨 (터미널 성공) | — |
| 21~29 | exit-engine 병렬 트랙 (보유 종목 청산) | symbol |

### 1. 게이트 분류표

관측열: ✅=DB 기록 있음(signals.ai_skipped 등) / 🟡=콘솔 로그만 / ❌=**완전 침묵(무기록)** — Phase 1 계측 필수 대상.

| gate ID | 파일:라인 | stage | 차단 의미 | reason 값 | detail 필드 | 관측 |
|---|---|---|---|---|---|---|
| `market_closed` | engine.ts:839-842 (runAll:1073-1076) | 0 | 시장 폐장 — 런 전체 스킵 | `domestic_market_closed` `overseas_market_closed` `all_markets_closed` | — | 🟡 errors 플래그 |
| `analyst_disabled` | engine.ts:843-845 | 0 | 자동분석 스위치 off | — | — | 🟡 errors 플래그 |
| `strategy_unregistered` | engine.ts:867 | 0 | DB enabled인데 STRATEGY_REGISTRY에 없음 | — | `{strategyId}` | ❌ skippedStrategyIds에 스로틀과 뭉뚱그려짐 |
| `strategy_throttled` | engine.ts:868-871 | 0 | next_backtest_at 미도래 → 전략 미평가 | — | `{strategyId, nextBacktestAt, intervalH}` | ❌ 사유 구분 없음 — **가설 C 핵심** |
| `no_due_strategies` | engine.ts:875-877 | 0 | due 전략 0 → 런 조기 종료 | — | `{throttled:[...], unregistered:[...]}` | ❌ ran=0/errors=[]로만 — 정상 종료와 구분 불가 |
| `ticker_error` | engine.ts:147-153 (기록 943-949) | 1 | KIS 티커 조회 실패 → 심볼 탈락 | — | `{error}` | 🟡 warn + results.error |
| `market_state_preclassify_failed` | engine.ts:202-205 | 2 | 30m 캔들<20 → 분류 불가 → **fail-open(전 룰 실행)** | — | `{candleCount}` | ❌ fail-open 자체가 무기록 |
| `market_state_rule_inactive` | engine.ts:218 (market-state.ts:22-29,76-85) | 2 | 상태별 활성 룰 아님 → 룰 실행 안 함. neutral이면 30m 룰 전부 off (reason=`market_state_neutral`) | `market_state_mismatch` `market_state_neutral` | `{marketState, rsi14, activeRules:[...]}` | ❌ 상태 로그 1줄뿐, per-rule 무기록 — **가설 A 핵심** |
| `candles_fetch_failed` | engine.ts:166-174 | 3 | 캔들 API 실패(null) → 룰 스킵 | — | `{interval}` | ❌ |
| `insufficient_candles` | engine.ts:220-221 | 3 | candles.length < minCandles (1d 룰은 210봉 필요) | — | `{interval, got, need}` | ❌ |
| `rule_no_fire` | engine.ts:223 (meta.fn 0건) | 4 | 룰 조건 미충족 — **최대 볼륨 게이트** | — | collect 행 detail의 `rules.fired`/`rules.noFire`로 집계 | ❌ rawCandidates=0 흔적뿐 |
| `losing_position_buy_block` | engine.ts:229-239 | 5 | 보유 -0.5% 손실 중 추가매수(물타기) 차단 | — | `{lossPct, avgPrice, price}` | 🟡 |
| `sell_not_held` | engine.ts:246 | 5 | 미보유 매도 후보 조용히 제거 | — | `{strategyId}` | ❌ **task 명시 지목 지점** |
| `cooldown_rebuy` | engine.ts:247 (쿼리 177-184) | 5 | 최근 매도 후 재매수 쿨다운(기본 5분) | — | `{cooldownMin}` | ❌ |
| `skip_seal_24h` | engine.ts:249 (쿼리 189-199) | 5 | 24h 내 동일 (전략,방향) ai_rejected/low_confidence 이력 → 재발화 봉인. **JSON_EXTRACT 의존(가설 D)** | — | `{strategyId, side}` | ❌ |
| `sell_amount_below_min` | engine.ts:255 | 5 | 보유 평가액 < 후보 금액 → 매도 후보 제거 | — | `{heldValue, wanted}` | ❌ |
| `regime_gate_macro_bear` | engine.ts:917-933(판정), 965-968(적용) | 6 | KOSPI·SP500 동반 ≤-1.5% → buy 후보 일괄 제거 | — | `{kospiPct, sp500Pct, droppedBuys}` | 🟡 발동 알람 1회, per-candidate 무기록 |
| `regime_gate_macro_error` | engine.ts:934-936 | 6 | macro 조회 실패 → **fail-open(매수 허용)** | — | `{error}` | 🟡 (verdict='error'로 기록 권장) |
| `prefilter_bypassed_no_summary` | engine.ts:440 | 7 | summary null → 프리필터 통째 생략 **fail-open** | — | — | ❌ |
| `prefilter_liquidity_dead` | ai-prefilter.ts:44-47 | 7 | 거래량 소멸(상폐 패턴) | `liquidity_dead` | `{trailingZero, volumeRatio}` | ✅ signals(rule_prefilter) |
| `prefilter_atr_zero` | ai-prefilter.ts:50-52 | 7 | ATR≤0 변동성 계산 불가 | `atr_zero` | `{atr14}` | ✅ |
| `prefilter_rsi_extreme_counter` | ai-prefilter.ts:55-62 | 7 | RSI≥85 매수 / ≤15 매도 역행 | `rsi_extreme_counter` | `{rsi14, side}` | ✅ |
| `prefilter_strong_counter_trend` | ai-prefilter.ts:67-99 | 7 | EMA20<EMA60×0.95 하락추세 매수 (3중 예외조건 미충족) | `strong_counter_trend` | `{ema20, ema60}` | ✅ |
| `prefilter_blowoff_top` | ai-prefilter.ts:103-105 | 7 | 급등+과열 추격매수 | `blowoff_top` | `{priceChange5, rsi14}` | ✅ |
| `late_session_buy_block` | engine.ts:473-493 | 7 | KST 15:00~15:30 신규 매수 차단 (국내) | `late_session_buy_block` | `{minutesToClose}` | ✅ |
| `portfolio_max_positions` | portfolio-stability.ts:137-144 (engine 497-526) | 8 | 24h 종목당 실주문 buy 한도 초과 | `max_positions_exceeded` | `{recentBuys, max}` | ✅ signals(portfolio_guard) |
| `portfolio_core_ratio` | portfolio-stability.ts:148-158 | 8 | 매수 후 코어(KOSPI100) 비율 < 임계 | `core_ratio_below_min` | `{projectedRatio, min, tier}` | ✅ |
| `dedup_regime` | engine.ts:531-564, ai-dedup.ts:68-110 | 9 | 60분 내 동일 (심볼,전략,방향,레짐버킷) 재평가 생략. **JSON_EXTRACT 의존(가설 D)** | — | `{regimeBucket, prevConfidence}` | ✅ signals(dedup_reuse) |
| `dedup_lookup_error` | ai-dedup.ts:106-109 | 9 | dedup 조회 실패 → fail-open | — | `{error}` | 🟡 |
| `ai_input_no_summary` | engine.ts:982 | 10 | summary 없는 심볼은 배치 입력 제외 → **성공 경로에서 후보 영구 증발 (기록도 시그널도 없음)** | — | `{candidates:n}` | ❌ **★신규 발견 블랙홀** |
| `ai_stage1_reject` | ai-filter.ts:850-880, 924-977 | 10 | hybrid stage1(M4) 광역 거절 | — | `{stage1Confidence}` | ✅ ai_rejected로 기록되나 stage1 구분 불가 |
| `ai_batch_failed` | ai-filter.ts:1010-1014, engine.ts:1000-1001 | 10 | CLI 실패·타임아웃·파싱 실패 → fallback 진입 — **가설 B 핵심** | `cli_error` `timeout` `parse_failed` | `{error, batchSize}` | 🟡 콘솔만 (건별은 아래로) |
| `ai_failed_nonheld` | engine.ts:819-830 | 10 | 배치 실패 시 비보유 심볼 전량 ai_failed | — | `{fallbackReason}` | ✅ signals(ai_failed) |
| `ai_missing_in_batch` | ai-filter.ts:818-833 | 10 | 배치 응답에 심볼 누락 | — | — | ✅ signals(ai_failed) |
| `ai_rejected` | ai-filter.ts:1000-1002, 1045-1047 | 10 | AI가 EV·판단상 거절 (선택 안 된 잔여 후보 포함: engine 694-709) | — | `{confidence, ev}` | ✅ |
| `ai_low_confidence` | ai-filter.ts:993-999, 1039-1044 | 10 | confidence < minAiConfidence(기본 35) | — | `{confidence, min}` | ✅ |
| `symbol_blacklisted` | service.ts:143-146 | 11 | 블랙리스트/화이트리스트 위반 — **signals row 없이 return, 엔진은 무시** | — | `{detail}` | ❌ |
| `duplicate_active_signal` | service.ts:183-195 | 11 | 동일 심볼+방향 pending/pending_approval 활성 시그널 존재 | — | `{dupSignalId}` | ❌ (return error뿐) |
| `signal_create_failed` | engine.ts:687-692, 790-795 (res.ok false 무시) | 11 | createSignal 실패가 어디에도 기록 안 됨 | — | `{error}` | ❌ |
| `signal_created` | service.ts:173-299 | 99 | 터미널 성공 | `pending` `pending_approval` `auto_submitted` | `{signalId}` | ✅ signals.status |

**exit-engine 병렬 트랙** (보유 종목 전용, engine.ts:335-425 + exit-engine.ts):

| gate ID | 파일:라인 | stage | 차단 의미 | 관측 |
|---|---|---|---|---|
| `exit_avg_price_missing` | engine.ts:367-370 | 21 | KIS 잔고 avgPrice 결손 → 청산 판정 불가 | ❌ |
| `exit_ticker_error` / `exit_price_invalid` | engine.ts:372-379 | 22 | 티커 실패 / price≤0 | 🟡/❌ |
| `exit_state_upsert_failed` / `exit_state_missing` | engine.ts:382-390 | 23 | position_state 갱신 실패 / 조회 무 | 🟡/❌ |
| `exit_unit_mismatch` | exit-engine.ts:71-79 | 24 | price/entry 비율 [0.3,3.0] 이탈 (USD/KRW 단위 사고 방지) | 🟡 |
| `exit_no_fire` | engine.ts:392-393 | 24 | 청산 조건 미충족 (정상) | ❌ (pass 요약만 기록) |
| `exit_hard_stop_disabled` | engine.ts:396-399 | 25 | system_config로 hard_stop 비활성 | 🟡 |
| `exit_cooldown_5m` | engine.ts:403-414 | 25 | 동일 심볼+exit_kind 5분 쿨다운. **JSON_EXTRACT `$.exit_kind` 의존(가설 D — 무력화 시 중복 청산 위험)** | ❌ |
| `exit_create_failed` | engine.ts:420-422 | 29 | createSignal 실패 | 🟡 |

### 2. 기록 정책 및 볼륨 추정

**볼륨 추정 (최악)**: 국내장 09:00~15:30=390분 ÷ 5분 cron = **78 런/일/시장**. 평가 심볼 = universe top30+40+30 union + always-include + 보유 ≈ **60~90종목**. 전략 13종.
- (symbol×strategy) 전건 기록 시 78×70×13 ≈ **71,000행/일/시장** → 과도. 기각.
- **채택 정책 — "pass는 요약, skip은 심볼 단위 전건"**:
  - **run 행** 1건/런: gate=`run`, detail=`{symbols, dueStrategies:[...], throttled:[...], regimeGate, marketState 분포}`. 폐장·disabled·no_due도 run 행 1건 (verdict=skip).
  - **collect 행** 1건/심볼/런: gate=`collect`, verdict=pass/skip, detail=`{marketState, rsi14, rules:{active[],inactive[],insufficientCandles[],noFire[],fired[]}, guardDrops:{sell_not_held,cooldown_rebuy,skip_seal_24h,losing_position_buy_block,sell_amount_below_min}, rawCandidates}` — stage 2~5를 1행에 압축, 룰별 세부는 JSON.
  - **개별 skip 행**: stage 5~11 게이트에서 실제 죽은 후보만 건별 기록 (룰이 발화한 뒤에만 도달하므로 저빈도).
  - **final 행** 1건/심볼/런: gate=`final`, stage=죽은 단계(시그널 생성 시 99), reason=죽인 gate ID, detail=`{rawCandidates, signalIds[]}` — **깔때기 SQL의 축**.
- 적용 후: 런당 ≈ 1 + 70×2 + ~10 = **~150행** → 78런 × 2시장 ≈ **~23,000행/일 최악** (throttle로 due 없는 런은 1행 → 가설 C가 맞다면 실측 일 수천 행 이하). 행당 ~300B → 30일 ≈ 70만 행, 인덱스 포함 200~400MB. NAS MariaDB 수용 가능.
- **보존**: 30일 롤링. 새벽 cron에서 ① `eval_funnel_daily`(date, market, gate, stage, killed, reached) 롤업 upsert → ② `DELETE FROM eval_funnel WHERE ts < NOW() - INTERVAL 30 DAY LIMIT 5000` 반복 (파티션은 이 볼륨에서 과설계 — 배치 삭제 권장).
- **구현 지침(developer)**: 게이트마다 즉시 INSERT 금지 — 런 스코프 in-memory 배열에 누적 후 runMarket 종료 시 multi-row INSERT 1~2회. 기록 실패는 try/catch로 삼켜 엔진 무영향 (계측이 매매를 죽이면 안 됨).

### 3. eval_funnel 스키마 (확정)

```sql
CREATE TABLE IF NOT EXISTS eval_funnel (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  run_id VARCHAR(40) NOT NULL,          -- '{market}-{yyyyMMddHHmm}' — runMarket 진입 시 1회 생성
  ts DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  market ENUM('domestic','overseas') NOT NULL,
  symbol VARCHAR(32) NULL,              -- run 레벨 행은 NULL
  strategy_id VARCHAR(64) NULL,
  side ENUM('buy','sell') NULL,
  stage TINYINT UNSIGNED NOT NULL,      -- §0 번호 체계 (0~11, 21~29, 99)
  gate VARCHAR(48) NOT NULL,            -- §1 분류표의 안정 ID (영구 저장 — 리네임 금지)
  verdict ENUM('pass','skip','error') NOT NULL,  -- error = 게이트 판정 자체 실패(fail-open/closed)
  reason VARCHAR(64) NULL,
  detail JSON NULL,
  INDEX idx_ef_run (run_id),
  INDEX idx_ef_ts (ts),
  INDEX idx_ef_gate (gate, ts),
  INDEX idx_ef_market (market, ts, stage)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

원안(task §작업범위 1) 대비 변경: `side`·`stage` 컬럼 추가(깔때기 축·매수/매도 분리 필수), `(gate)` 인덱스를 `(gate, ts)` 복합으로 (기간 필터 동반 조회가 기본 패턴).

### 4. 깔때기 요약 지표 정의

**대시보드 카드 (모바일 412px, 위→아래 = 3초 이해 순서)**:
1. **헤더(결론)**: `오늘 시그널 N건 (매수 n · 매도 m) · 런 R회` — final 행 stage=99 카운트.
2. **이상 배너** (있을 때만, 빨강/노랑): `ai_batch_failed` 횟수, `analyst_disabled`, verdict='error' 게이트 (fail-open 발생).
3. **오늘의 병목 1줄**: 전 단계 대비 감쇠율 최대 게이트 — 예: `병목: 룰 미발화 63/72종목 (-88%)`.
4. **6단계 미니 깔때기 바** (가로 % 막대, 각 행 = 라벨·잔존수·전단계 대비 %):
   평가 종목(final 전체) → 룰 발화(stage≥5) → 가드 통과(stage≥7) → 프리필터 통과(stage≥9) → AI 통과(stage≥11) → 시그널(stage=99)
5. **최다 차단 top3**: `SELECT reason, COUNT(*) FROM eval_funnel WHERE gate='final' AND verdict='skip' AND ts>=CURDATE() GROUP BY reason ORDER BY 2 DESC LIMIT 3` — 한글 라벨 매핑(룰 미발화/재매수 쿨다운/AI 신뢰도 미달/…).

**아침 리포트(텔레그램) 한 문단 포맷 예시** (trade-report에 삽입):

```
📊 [SI] 어제 깔때기 — 국내장
런 78회(풀평가 2회) · 종목 72개 평가
룰 발화 9종목 14건 → 가드 6 → 프리필터 4 → AI 1 → ✅ 시그널 1건 (매수 1)
병목: 룰 미발화 63/72종목 (88%) · 2위 재매수 쿨다운 4건 · 3위 AI 신뢰도 미달 3건
⚠ 이상: AI 배치 실패 2회(비보유 5종목 미평가) · neutral 상태 41% (30m 룰 전체 비활성)
```

**게이트별 감쇠율 SQL** (MariaDB 10.2+; final 행 기반):

```sql
WITH died AS (
  SELECT stage, COUNT(*) AS n
  FROM eval_funnel
  WHERE gate='final' AND market='domestic' AND ts >= CURDATE()
  GROUP BY stage
),
funnel AS (
  SELECT stage, SUM(n) OVER (ORDER BY stage DESC) AS reached  -- stage k 이상 도달 = k까지 생존
  FROM died
)
SELECT stage, reached,
       ROUND(100 * reached / NULLIF(LAG(reached) OVER (ORDER BY stage), 0), 1) AS pass_pct_vs_prev
FROM funnel ORDER BY stage;
```

윈도우 함수 불가(MariaDB<10.2) 시 폴백: `SELECT f1.stage, COUNT(*) reached FROM (SELECT DISTINCT stage FROM eval_funnel WHERE gate='final' AND ts>=CURDATE()) f1 JOIN eval_funnel f2 ON f2.gate='final' AND f2.ts>=CURDATE() AND f2.stage>=f1.stage GROUP BY f1.stage` 후 앱에서 나눗셈.

### 5. 진단 가설 검증 계획 (Phase 1 실운전 1~2일 후, 전부 읽기 전용 SELECT)

**가설 A — market-state × rsi-oversold 배타** · *코드 수준 사전 판정: 구조적 데드락 확정적*.
classifyMarketState 1순위가 RSI<35를 `divergence_signal`로 선점(market-state.ts:38) → `rsi-oversold-v1`은 `oversold_bounce`(RSI∈[35,38)+EMA20≥EMA60, 또는 VAL 지지 시 RSI∈[35,68])에서만 실행되는데, 룰 발화 조건은 `RSI < rsiBuyThreshold(기본 35)` (rsi-oversold.ts:32, style.ts:53) → **활성 창과 발화 창의 교집합 공집합**. 유일한 탈출구: adaptive-interval이 30m 아닌 봉을 골라 룰 RSI≠분류 RSI가 되는 우연, 또는 DB override로 임계 상향.
```sql
-- (1) 운영 임계 override 확인 — 값이 38 초과면 데드락 아님
SELECT `key`, value FROM system_config
 WHERE `key` IN ('style_default_rsiBuyThreshold','style_aggressive_rsiBuyThreshold');
-- (2) 역사적 발화 0건 정황
SELECT COUNT(*) AS n FROM signals WHERE strategy_id = 'rsi-oversold-v1';
-- (3) Phase 1 이후 실측 — 활성됐는데 발화 0인지
SELECT SUM(JSON_CONTAINS(detail,'"rsi-oversold-v1"','$.rules.active'))  AS active_cnt,
       SUM(JSON_CONTAINS(detail,'"rsi-oversold-v1"','$.rules.fired'))   AS fired_cnt,
       SUM(JSON_CONTAINS(detail,'"rsi-oversold-v1"','$.rules.inactive')) AS inactive_cnt
FROM eval_funnel WHERE gate='collect' AND ts >= NOW() - INTERVAL 2 DAY;
-- (4) 시장상태 분포 (neutral 비율 포함)
SELECT JSON_UNQUOTE(JSON_EXTRACT(detail,'$.marketState')) st, COUNT(*) FROM eval_funnel
 WHERE gate='collect' AND ts >= NOW() - INTERVAL 2 DAY GROUP BY st;
```
판정: (1)≤35 AND (2)=0 AND (3) active_cnt>0·fired_cnt=0 → A 확정.

**가설 B — claude CLI 실패로 비보유 전량 ai_failed**
```sql
-- 현재 DB로 즉시 가능한 정황
SELECT JSON_UNQUOTE(JSON_EXTRACT(indicators,'$.ai.skipCategory')) cat, COUNT(*) n
FROM signals WHERE status='ai_skipped' AND created_at >= NOW() - INTERVAL 30 DAY
GROUP BY cat ORDER BY n DESC;
-- ai_failed 사유 문자열 패턴 (Execution error / timeout / aborted)
SELECT LEFT(reasoning,80) head, COUNT(*) FROM signals
WHERE status='ai_skipped' AND created_at >= NOW() - INTERVAL 30 DAY
  AND JSON_UNQUOTE(JSON_EXTRACT(indicators,'$.ai.skipCategory'))='ai_failed'
GROUP BY head ORDER BY 2 DESC LIMIT 10;
-- Phase 1 이후: 배치 성공률
SELECT verdict, reason, COUNT(*) FROM eval_funnel
 WHERE gate='ai_batch' AND ts >= NOW() - INTERVAL 2 DAY GROUP BY verdict, reason;
```
판정: ai_failed가 스킵 다수(>50%) + 사유가 CLI 오류 패턴 + ai_batch error 비율 높음 → B 확정.

**가설 C — next_backtest_at throttle로 일 1~2회만 평가**
```sql
SELECT id, enabled, backtest_interval_h, last_backtest_at, next_backtest_at
FROM strategies ORDER BY id;
-- Phase 1 이후: 런 대비 풀평가 비율
SELECT DATE(ts) d, COUNT(*) runs,
       SUM(CAST(JSON_EXTRACT(detail,'$.dueCount') AS UNSIGNED) > 0) runs_with_due
FROM eval_funnel WHERE gate='run' GROUP BY DATE(ts);
```
판정: backtest_interval_h ≥ 6이면 장중 6.5h 동안 전략당 평가 1회 수준 → C 확정. runs_with_due/runs 실측으로 최종 판정. (주의: engine.ts:1009-1015가 결과와 무관하게 next_backtest_at을 밀어버림 — 발화 실패해도 재평가 기회 없음.)

**가설 D — MariaDB JSON_EXTRACT 따옴표 불일치로 dedup·쿨다운 무매칭**
```sql
SELECT VERSION();
-- (1) 원시 반환값 눈으로 확인 (따옴표 포함 여부)
SELECT id, JSON_EXTRACT(indicators,'$.ai.skipCategory') raw_val,
       JSON_UNQUOTE(JSON_EXTRACT(indicators,'$.ai.skipCategory')) unq_val
FROM signals WHERE status='ai_skipped' ORDER BY id DESC LIMIT 5;
-- (2) 3중 매칭 비교 — 핵심 판정
SELECT
  SUM(JSON_EXTRACT(indicators,'$.ai.skipCategory') = 'ai_rejected')               eq_plain,
  SUM(JSON_EXTRACT(indicators,'$.ai.skipCategory') = '"ai_rejected"')             eq_quoted,
  SUM(JSON_UNQUOTE(JSON_EXTRACT(indicators,'$.ai.skipCategory')) = 'ai_rejected') eq_unquoted,
  COUNT(*) total
FROM signals WHERE status='ai_skipped' AND created_at >= NOW() - INTERVAL 30 DAY;
```
판정: eq_plain=0 AND eq_unquoted>0 → **D 확정** — 영향 쿼리 4곳 전부 무력: engine.ts:193(skip_seal_24h), engine.ts:408(**exit_cooldown_5m — 중복 청산 시그널 위험, 안전 이슈**), ai-dedup.ts:80-81(dedup), ai-dedup.ts:147(regime 성과). eq_plain=eq_unquoted>0 → D 기각.
주의: D가 참이면 dedup·seal 무력화로 시그널은 오히려 **늘어나는** 방향 — "시그널 없음"의 주범은 아니나 exit 쿨다운 무력화 때문에 Phase 2 수정 1순위.

### 6. 요약 — 시그널 소멸 예상 주범 순위 (Phase 1 실측으로 확정할 것)

1. **stage 4 `rule_no_fire` + stage 2 `market_state_rule_inactive`** — 가설 A의 구조적 데드락(rsi-oversold) + neutral 상태에서 30m 룰 전멸. 곱셈 깔때기의 최상류.
2. **stage 0 `strategy_throttled`** — 가설 C. 애초에 평가 기회 자체가 희소.
3. **stage 10 `ai_batch_failed`→`ai_failed_nonheld`** — 가설 B. 상류를 뚫은 소수 후보가 CLI 불안정으로 전멸.
4. stage 5 `skip_seal_24h` — 한 번 ai_rejected되면 24h 봉인 (D가 거짓일 때만 작동).
5. `ai_input_no_summary` — 무기록 증발 (빈도는 낮을 것이나 관측 필수).

## 제약

- T-001과 동일 (커밋/푸시 금지, build+test 통과, 운영 DB 파괴적 SQL 금지, 엔진 로직 무수정).

## 수용 기준

1. strategy-eval 1회 실행 시 평가된 모든 (종목×전략)의 최종 verdict가 eval_funnel에서 추적 가능.
2. 대시보드 카드와 아침 리포트에 깔때기 요약 표시.
3. 게이트 사유 기록이 코드 상 skip 지점과 1:1 대응 (qa 검증).
4. JSON_EXTRACT 이슈 실측 결론 기록.

## 진행 로그

- 2026-08-02 Leader: task 생성. analyst(Fable) 깔때기 지표 정의 착수.
- [19:45][analyst] 게이트 분류표(50개 게이트)·eval_funnel 스키마·기록 정책·깔때기 지표·가설 A~D 검증 SQL 작성 완료. 가설 A는 코드 수준 구조적 데드락으로 사전 판정, engine.ts:982 무기록 블랙홀(ai_input_no_summary) 신규 발견.
- 2026-08-03 (이어서 작업, developer+reviewer 겸임): 중단 인수인계 목록 전항 완료 + 감사 중 추가 결함 발견·수정. 상세는 "최종 요약" 참조.

## ⚠️ 중단 상태 인수인계 (2026-08-02, Leader 기록)

developer 작업이 **API 세션 한도로 중간에 종료**되었다. 마지막 작업 지점은 "collectCandidates local tracker semantics 수정"이었다. Leader가 워킹트리를 직접 검사해 확인한 실제 상태는 아래와 같다. **커밋되지 않았고 운영에는 영향 없다**(배포는 push 기반, `.next` 빌드 산출물은 04/22 그대로).

### 완료된 것 (검증: 코드 직접 확인)

- **H1 ENUM 확장 완료** — `src/lib/db.ts:13`(상태 상수), `:549-561`(ENUM DDL에 `pending_approval` 추가 + 사유 주석). **제1사인 수정분이 들어갔다.**
- **H2 예외 격리 완료** — `src/lib/strategy/engine.ts:159` try / `:183-184` catch. "런은 계속 진행" 로그 + `signal_create_failed` gate를 verdict=error로 기록. exit 트랙의 createSignal도 보호됨.
- **eval_funnel 테이블 DDL** — `src/lib/db.ts:984-990`.
- **관측 모듈 신설** — `src/lib/strategy/eval-funnel.ts`(196줄, `EvalFunnelRecorder`), `src/lib/strategy/eval-funnel-labels.ts`(268줄, gate 라벨).
- **engine.ts 계측 다수 삽입** (+350줄): `ticker_error`, `market_state_preclassify_failed`, `losing_position_buy_block`, `sell_not_held`, `cooldown_rebuy`, `skip_seal_24h`, `sell_amount_below_min`, `signal_created`, exit 트랙 전체(`exit_avg_price_missing`/`exit_ticker_error`/`exit_price_invalid`/`exit_state_upsert_failed`/`exit_state_missing`/`exit_unit_mismatch`) 등.
- `src/lib/strategy/exit-engine.ts` 9줄 변경 (H3 관련 추정 — **재확인 필요**).

### 미완료 (다음 세션에서 이어받을 것)

1. **collectCandidates 로컬 트래커 정합** — 중단 지점. 계측 카운터와 실제 후보 집합의 의미가 어긋날 수 있음.
2. **stage 2~5 collect 요약 행 / final 행 기록** — analyst 기록 정책(§3)의 "run 1행 + collect 1행/심볼 + skip 전건 + final 1행/심볼" 중 collect·final 부분 확인 필요.
3. **H3 검증** — exit 쿨다운 쿼리에서 실존하지 않는 status(`'executed','accepted'`) 제거가 실제로 반영됐는지 확인.
4. **H4 미착수** — `price-breakout-v1` 기본 비활성 (14일간 후보의 73% 생성). 운영 DB 사용자 설정을 코드가 덮어쓰지 않는 방식으로.
5. **대시보드 깔때기 카드** (관측 3) 미착수 — analyst §4 카드 순서, 모바일 412px.
6. **trade-report 깔때기 요약** (관측 4) 미착수.
7. **테스트 미작성** — 특히 "createSignal이 던져도 런이 계속된다"(H2) 검증 테스트가 **반드시** 필요.
8. **빌드·테스트 미검증** — `npm run build` / `npm test` 한 번도 돌리지 못한 상태. **이 상태로 커밋·배포 금지.**

### 다음 세션 착수 순서 (권고)

미완 7(H2 테스트) → 8(빌드·테스트 통과) 를 최우선으로. 그다음 1~3(계측 정합·H3), 4(H4), 5~6(UI·리포트). 빌드가 통과하는 지점을 먼저 확보해야 이후 작업이 안전하다.

## Leader 직접 수정분 (2026-08-02 밤) — 빌드 복구

developer 중단 후 Leader가 빌드를 통과시키기 위해 직접 수정했다. **`npm run build` 통과 확인, 사용자가 pm2 재기동까지 완료.** 단 `npm test`는 여전히 미실행.

중단 잔재는 대부분 **이름을 바꾸다 만 흔적**이었다 (타입 체크가 한 번도 돌지 않은 상태였으므로 남아 있었음):

| # | 증상 | 원인 | 조치 |
|---|---|---|---|
| 1 | `Property 'errorCode' does not exist on type 'CreateSignalResult'` | 엔진이 실패 사유를 기계 분류하려 `res.errorCode`를 읽는데 타입에 필드가 없었음 | `src/lib/signals/service.ts`에 `CreateSignalErrorCode` 타입 + `errorCode?` 필드 추가, 실패 지점 2곳(블랙리스트 `symbol_blacklisted` / 중복 `duplicate_active_signal`)에서 값 채움. 기존 `error`(사람용 가변 문자열)는 그대로 — 블랙리스트는 detail이 임의 문자열이라 문자열 비교로는 분류 불가했다 |
| 2 | `Cannot find name 'reach'` | 지역 헬퍼 `kill(stage, gate)`을 옛 이름 `reach`로 호출 (9곳) | `reach(` → `kill(` 전량 치환 (시그니처 동일) |
| 3 | (선제 수정) `outcomeGate` 타입 불일치 | `CollectedContext.outcomeGate: FunnelGate`인데 추적 변수는 통과 시 null | `FunnelGate \| null`로 완화 + 주석 |
| 4 | `Property 'mark' does not exist` | `outcome.kill`을 옛 이름 `outcome.mark`로 호출 (1곳) | `outcome.kill(`로 수정 |
| 5 | `Expected 4 arguments, but got 3` | **오타가 아니라 미구현** — 하위 함수(collectCandidates/runExitEngine/applyFilters)에 `rec` 파라미터를 추가했으나 **최상위 runMarket에서 recorder를 생성·전달·flush하는 배선이 없었음** | 아래 별도 항목 |

### 5번 — 최상위 배선 (Leader 신규 구현)

`runMarket`에 다음을 추가했다:

- 개장 가드 통과 직후 `const rec = new EvalFunnelRecorder(market)` + `const outcome = createOutcomeTracker()`
- 조기 반환 경로에 게이트 기록 + flush: `analyst_disabled`, `no_due_strategies`
  - **`market_closed`는 의도적으로 기록하지 않음** — 장 마감은 정상 상태이고 장외 5분마다 빈 run 행이 쌓이기만 한다
  - `strategy_unregistered`는 `skip`이 아니라 **`error`** 로 기록 — 코드-DB 불일치는 정상 걸러냄이 아니라 결함이다
  - `strategy_throttled`도 기록 (가설 C 검증용 detail 포함)
- 하위 호출부 3곳에 인자 전달: `runExitEngine(..., rec)`, `collectCandidates(..., rec)`, `applyFilters(..., rec, outcome)`
- collect 지역 추적 결과를 런 tracker로 승계: `ctx.outcomeGate`가 있으면 `outcome.kill(symbol, ctx.outcomeStage, ctx.outcomeGate)`, 없으면 `advance`, 그리고 `setRaw`
- 최종 반환 직전: **종목별 `final` 행**(stage·rawCandidates·signalIds) + **run 요약 행**(symbols/strategies/exitSignalsCreated/buyBlocked/signalsCreated/errors) 기록 후 `await rec.flush()`

`final` 행이 깔때기의 축이다 — 개별 게이트 skip 행만으로는 "이 종목이 최종적으로 어디서 죽었나"를 세는 데 복잡한 쿼리가 필요하지만, 종목당 1행으로 압축하면 단계별 감쇠율을 단일 쿼리로 뽑을 수 있다.

### 아직 남은 미완 (위 "미완료" 목록과 별개로 확인된 것)

- `advance()` 헬퍼가 collectCandidates 내부에서 **정의만 되고 호출되지 않는다** — 통과 stage 승격이 기록되지 않아 final 행의 stage가 실제보다 얕게 남을 수 있다. 계측 정합 작업 시 함께 처리할 것.

## 최종 요약

**2026-08-03 세션 — Phase 1 잔여 구현 전항 완료. 배포(커밋·푸시)만 남음.**

### 완료한 것

1. **`npm test` 최초 실행** — 39 suites/398건 전체 통과 확인 (H1/H2 회귀 없음).
2. **`final` 행 stage 버그 수정** — `rec.record({gate:'final', ...})` 호출부에 top-level `stage` 필드가 빠져 있어 모든 final 행의 stage가 무조건 0으로 기록되던 버그. 감쇠율 SQL·6단계 미니바가 이 버그 때문에 전부 무의미했음. 실제 DB에서 재현 확인 후 수정(`stage: o.stage` 추가).
3. **`market_state_rule_inactive` 계측 추가** — 룰이 시장상태상 비활성일 때 무기록이던 지점에 kill(2,...) 추가.
4. **`strategy_unregistered` 오탐 수정** — `eod-high-close-v1`/`inside-bar-v1`/`oversold-bounce-daily-v1`(post-market 전용 룰)이 intraday 엔진에서 매 5분마다 "결함(error)"으로 잘못 집계되던 것을 `POST_MARKET_ONLY_STRATEGY_IDS` 허용목록으로 skip 처리.
5. **H3 검증 완료** — exit 쿨다운 쿼리가 이미 실존 status 6종으로 정확히 교정되어 있음을 코드로 확인.
6. **H4 검증 완료** — `price-breakout-v1` 비활성화가 `runOnceMigration` 일회성 마이그레이션으로 이미 정확히 적용됨(2026-08-02 14:09 UTC 마커 확인, 운영 DB `enabled=0` 실측 일치).
7. **H2 예외격리 테스트 신규 작성** — `engine.test.ts` 7건 (`createSignalGuarded`가 예외를 삼키는지, 각 errorCode 분기가 올바른 게이트로 라우팅되는지, 성공 시 markSignal 호출되는지).
8. **[세션 중 신규 발견·수정] stage 8/9/10 계측 공백** — `applyFilters`가 late_session_buy_block(7)·portfolio_core_ratio/max_positions(8)·dedup_regime(9)에서 `outcome.kill()`을 한 번도 호출하지 않아, 이 단계에서 죽은 후보의 final 행이 얕은 stage(보통 6)를 그대로 물려받아 오분류되고 있었음. 3개 지점 모두 계측 추가.
9. **[세션 중 신규 발견·수정, 안전 관련] `applyBatchDecisions`/`fallbackPerSymbol`이 `createSignal`을 무보호 직호출** — exit-engine 경로만 `createSignalGuarded`를 쓰고 있었고, **실제 AI 승인 매수/매도 시그널 생성 경로(더 빈번한 경로)는 H2 보호가 전혀 적용되지 않은 상태**였다. 즉 `createSignal`이 예외를 던지면 여전히 런 전체가 죽는 원래 버그가 이 경로엔 살아있었음. 두 함수에 `rec`/`outcome` 파라미터를 관통시키고 `createSignalGuarded`로 교체. 죽어있던 `aiGateForSkipCategory()` 헬퍼도 이번에 연결.
10. **`ai_input_no_summary` 블랙홀 수정** — summary 없는 심볼이 배치 입력에서 조용히 증발(기록도 results.set()도 없이)하던 지점에 계측 추가.
11. **`ai_batch_failed` 이상 신호 추가** — 배치 자체가 실패했을 때(진짜 에러만, 빈 decisions는 제외) run-level 기록 추가.
12. **대시보드 "오늘의 평가 깔때기" 카드 신설** — `eval-funnel-query.ts`(집계 쿼리) + `/api/dashboard/eval-funnel` + `EvalFunnelCard.tsx`(모바일 412px, 헤더/이상배너/병목1줄/6단계바/최다차단top3, 접기/펼치기). Dashboard.tsx에 배선 완료.
13. **trade-report 깔때기 요약 추가** — `formatFunnelSection()` + `cron/trade-report` route에서 `getEvalFunnelSummary('domestic', rangeStart, rangeEnd)` 조회해 기존 메시지 하단에 첨부. 테스트 5건 추가.
14. **독립 reviewer 감사(서브에이전트) 1회 수행** — 9개 항목 전항 CONFIRMED. 감사 중 발견된 이슈 2건도 즉시 수정: (A) buy-blocked 필터링 시 실제 원인(order_limit_unconfigured)과 무관하게 collectCandidates의 stage 6 placeholder(regime_gate_macro_bear)를 그대로 물려받던 오분류 → 실제 필터링 지점에서 올바른 게이트로 직접 기록하도록 수정. (B) `collectCandidates` 내 죽은 코드(`advance()` 헬퍼 미사용) 제거.
15. **최종 검증**: `npm run typecheck` clean, `npm test` 40 suites/410건 전체 통과.

### 확인했지만 손대지 않은 것 (참고용 기록)

- **`oversold-bounce-daily-v1` strategy_id 드리프트** (reviewer 발견, pre-existing): `post-market-engine.ts`가 시그널 생성 시 `oversold-bounce-v1`을 쓰는데 `strategies.id`는 `oversold-bounce-daily-v1`이라 `signals ⋈ strategies` 조인 기반 통계가 이 전략만 영구 누락된다. Phase 1 범위 밖(오늘 변경과 무관한 기존 버그) — Phase 2 또는 별도 task로 넘길 것.
- `eval-funnel.ts`/`eval-funnel-query.ts` 자체에 대한 단위 테스트는 아직 없음(reviewer 지적) — 집계 산수가 정확한지는 오늘 운영 DB에 대한 수동 SQL 검증으로만 확인함.

### 다음 세션이 할 일

1. **배포 승인 필요** — 오늘 변경은 전부 워킹트리에만 있고 운영에는 반영되지 않았다(운영 프로세스는 여전히 stage=0 버그가 있는 이전 코드로 서빙 중). 사용자 승인 후 커밋·push → Gitea Actions 자동배포. **배포 후 `stockinvest-cron`도 별도 재시작 필요**(RESUME.md 기존 경고 — `pm2 reload stockinvest`만으로는 cron 프로세스가 갱신 안 됨).
2. 배포 후 [[RESUME]] 2번 항목(장중 실측)을 이번엔 실제로 수행 — `eval_funnel` final.stage가 이제 정확히 찍히는지, 대시보드 카드·아침 리포트가 실데이터로 정상 렌더되는지 확인.
3. [[T-001-phase0-safety-foundation]] — reviewer 최종 재검증 + QA는 여전히 미완(오늘 범위 아님).
4. [[T-003-phase2-pipeline-redesign]] — Phase 1 관측 데이터 3영업일 확보 후 착수.
