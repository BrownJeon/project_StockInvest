---
task-id: T-003
project: StockInvest
created: 2026-08-02
status: done
tags:
  - type/task
  - domain/strategy
aliases:
  - Phase 2 시그널 파이프라인 재설계
---

# T-003 · Phase 2 — 시그널 생성 복구: 파이프라인 재설계 사양

## 배경

재구성 플랜 Phase 2. **재구성의 핵심 수술**이다. [[T-002-phase1-eval-funnel]]에서 analyst가 게이트 50개를 전수 분류했고, 그중 시그널을 죽이는 구조가 코드 수준에서 확정되었다.

확정된 사망 원인 (재확인 불필요, 이 사양의 전제):
1. `ANALYST_ENABLED` 이중 의미 — engine.ts:843(엔진 마스터) vs router.ts:92(라우팅 정책). 공식 가이드가 지시한 설정이 곧 시그널 0
2. **market-state 데드락** — classifyMarketState(market-state.ts:38)가 RSI<35를 `divergence_signal`로 선점 → `rsi-oversold-v1`이 활성화되는 `oversold_bounce`는 RSI∈[35,38) 창에서만 성립하는데, 룰 발화 조건은 RSI<35 → **활성 창과 발화 창의 교집합이 공집합**
3. 실질 활성 룰 2개 — seed enabled=0 + `getAnalystStyle()='aggressive'` 하드코딩(style.ts:170) × FIND_IN_SET + db.ts:374-377의 부팅 시 강제 재동기화로 UI 토글 무효
4. `claude` CLI 직접 spawn(ai-filter.ts:422)이 매수 경로의 하드 게이트
5. `next_backtest_at`이 평가 주기를 6시간 throttle (백테스트 스케줄 컬럼의 겸직)
6. `pending_approval`이 signals.status ENUM에 없음(db.ts:465-469 vs service.ts:175)
7. 존재하지 않는 status('executed','accepted') 조회 → 쿨다운·거래이력·regime 학습 루프 영구 무효
8. `ai_input_no_summary`(engine.ts:982) 무기록 블랙홀 — 배치 성공 시 후보가 기록 없이 증발
9. 3중 시간축 불일치 — 게이트(raw 30m) / 룰(adaptive 1h 승격) / AI 프롬프트(30m 표기)
10. JSON_EXTRACT 따옴표 이슈 의심 → exit 쿨다운 무력화 시 **중복 청산 위험**(안전 이슈)

## 사용자 확정 결정 (이 사양의 제약)

- 해외주식 **보류** — 국내(domestic) 경로만 설계. 해외 코드는 보존하되 비활성
- **장중 AI 완전 제거** — 장중은 결정론적 룰만. AI는 post-market 시나리오 카드 생성(밤 배치)에만
- RAG 되먹임 유지 / 투자일지 유지 / AI 채팅·LoRA export 제거

## 목표 아키텍처 (플랜의 D1~D4)

- **D1**: 게이트 9개 → 4개. market-state는 게이트에서 **라벨로 강등**. 모든 차단은 eval_funnel 기록
- **D2**: `ENGINE_ENABLED`(엔진 on/off) + `AUTOPILOT_MODE` ∈ {manual, assist(기본), auto}로 분리. signals.status ENUM 정비
- **D3**: `strategies.enabled` 단일 기준. applicable_styles/FIND_IN_SET/style 하드코딩/부팅 재동기화 제거. UI 토글이 곧 진실
- **D4**: 장중 AI 제거. 모든 LLM 호출은 provider.ts 경유

## analyst 산출물 (이 task)

> 작성: analyst(Fable) 2026-08-02. 운영 DB 실측(SELECT만) + 네이버 공개 시세 실측 기반. 게이트 ID는 [[T-002-phase1-eval-funnel]] §1 분류표 체계를 그대로 사용.

### 0. 실측 결과 — 사망 원인 최종 판정 (사전 진단 갱신)

운영 DB(MariaDB **10.11.11**, `sql_mode=STRICT_TRANS_TABLES`)와 최근 14일 signals를 실측한 결과, **사전 진단 일부가 뒤집혔다**. Phase 2 설계는 아래 판정을 전제로 한다.

| # | 사전 진단 | 실측 판정 | 근거 |
|---|---|---|---|
| D-6 | `pending_approval` ENUM 부재 | **확정 — 제1사인** | 운영 config `hybrid_mode_enabled=true` + STRICT 모드 → `pending_approval` INSERT는 **하드 에러**. signals에 pending/pending_approval row **0건**, 7/19 이후 비-skip 시그널 0건/일. AI를 통과한 후보와 exit 청산 시그널 전부 INSERT 예외로 사망, **예외가 runMarket 전체를 중단**시킴(runExitEngine·applyBatchDecisions의 createSignal 미보호 호출) |
| 가설 D | JSON_EXTRACT 따옴표 불일치 | **기각** | `eq_plain=3134 = eq_unquoted=3134` (total 13811). dedup·24h봉인·exit쿨다운 쿼리는 문법상 정상 작동. 단 exit 쿨다운 status 목록의 `'executed','accepted'`는 실존하지 않는 상태(진단 #7)로 여전히 교정 대상 |
| 가설 C | next_backtest_at 6h 스로틀 | **운영값 기준 기각** | 운영 DB `backtest_interval_h=0.0833`(5분) — 사용자가 이미 풀어놨음. 구조적 겸직 문제(평가 주기를 백테스트 컬럼이 결정)는 유지 → §4-4에서 해소 |
| D-3 | 실질 활성 룰 2개 | **부분 기각** | 운영 DB는 15/16 enabled=1 (UI 토글됨). FIND_IN_SET('aggressive')로 ma-cross·weekly-trend-follow·dividend-quality·inside-bar 4종 제외, 미등록 3종 제외 → intraday 실평가 9종. 단 market-state 게이트로 심볼별 1~3종만 활성 |
| 가설 A | market-state × rsi-oversold 데드락 | **확정** | rsiBuyThreshold override 없음(=35). rsi-oversold 341건/14d 발화는 전부 adaptive-interval 1h 승격 심볼(23/90)의 **시간축 불일치 탈출구** 경유 — T-002 예측 그대로 |
| 가설 B | claude CLI 불안정 | **확정** | ai_failed 사유 상위: "claude exit 143"(89건), "claude exit 1"(22건) — D4(장중 AI 제거) 근거 실증 |
| 신규 | 노이즈 지배 룰 | **price-breakout-v1이 후보의 73%** | 3,304/14d — 코인 24h 고저 로직이 주식 당일 고저로 오작동. prefilter `strong_counter_trend`가 14d간 3,028건 학살(전체 prefilter 사살의 ~100%) |

**최근 14일 실측 깔때기 (국내장)**: 룰 발화 후보 4,525건 → rule_prefilter -2,962 (전부 strong_counter_trend·late_session) → portfolio_guard -1,199 → ai_rejected -264 → ai_failed -100 → AI 통과분은 ENUM 사고로 INSERT 사망 → **시그널 0건**.

### 1. 새 게이트 체인 — 4단계 재편 매핑표

**단계 정의와 fail 방향 원칙**: fail-closed는 "통과시키면 돈이 나가는 검증"(개장·엔진 스위치·한도·블랙리스트), fail-open은 "차단하면 기회를 잃는 필터"(macro·prefilter·쿨다운 — 관측 기록 남기고 통과). 모든 차단·error는 eval_funnel 기록(무기록 게이트 금지).

| 새 단계 | 내용 | 단위 | fail 방향 |
|---|---|---|---|
| ① 실행 자격 | 시장 개장 · ENGINE_ENABLED · 활성 전략 존재 | run | **fail-closed** (닫힌 시장·꺼진 엔진에서 시그널 생성은 무의미+위험) |
| ② 룰 발화 | 티커·캔들 확보 → 결정론 룰 조건 | symbol×rule | **fail-open 성격** (캔들 실패는 해당 룰만 skip+error 기록, 런은 계속) |
| ③ 억제 | 포지션 가드 · 통합 쿨다운 · 중복 활성 시그널 | candidate | **fail-open** (조회 실패 시 통과+error 기록 — 스팸은 2차 방어선이 막음) |
| ④ 안전·집행 | macro 게이트 · 프리필터(축소) · 장마감 차단 · 포트폴리오 가드 · 블랙리스트 · createSignal | candidate | **fail-closed** (블랙리스트·한도·create 검증), macro/프리필터는 fail-open |

**전수 매핑 (T-002 gate ID → 처리)**:

| 현행 gate ID (T-002) | 처리 | 새 단계 | 근거 / 삭제 시 위험과 대체 방어 |
|---|---|---|---|
| `market_closed` | 유지 | ① | 폐장 중 시세는 정지 상태 — 필수. fail-closed |
| `analyst_disabled` | **대체** | ① | `ENGINE_ENABLED` 단일 스위치로 교체(D2). 이중 의미(#1) 해소 — 라우팅 정책은 AUTOPILOT_MODE가 전담 |
| `strategy_unregistered` | 유지 | ① | verdict=error로 기록 (코드-DB 불일치는 결함이지 정상 skip 아님) |
| `strategy_throttled` | **삭제** | — | 위험: 과평가 → 대체: 평가는 매 tick 전 활성 전략, 반복 발화는 ③통합 쿨다운(봉 단위)이 차단. next_backtest_at은 백테스트 전용 복원(§4-4) |
| `no_due_strategies` | 삭제 | — | throttle 제거로 소멸. enabled 룰 0이면 run 행에 기록 |
| `ticker_error` | 유지 | ② | 심볼 단위 error 기록 |
| `market_state_preclassify_failed` | 삭제 | — | market-state가 게이트가 아니게 되므로 fail-open 분기 자체 소멸. 분류 실패 시 라벨=null 기록 |
| `market_state_rule_inactive` | **라벨 강등** | ②(라벨) | **D1 핵심**. 위험: 상태 게이트가 사실상 유일한 필터였던 룰의 노이즈 폭증 → 대체: 룰별 자체 조건 흡수·비활성(§2 룰별 판정). 라벨은 candidate.indicators + 승인 카드 + eval_funnel에 기록 |
| `candles_fetch_failed` | 유지 | ② | error 기록 |
| `insufficient_candles` | 유지 | ② | 정상 skip |
| `rule_no_fire` | 유지 | ② | 정상 — collect 요약 행으로 기록 (최대 볼륨 게이트) |
| `losing_position_buy_block` | 유지 | ③ | 물타기 차단 — 자금 보호 |
| `sell_not_held` | 유지 | ③ | 미보유 매도 방지. eval_funnel 기록 필수 (T-002 지적 무기록 지점) |
| `cooldown_rebuy` | **통합** | ③ | §4-3 통합 쿨다운 scope='rebuy'. TTL 5분→30분 상향 (매도 직후 재매수는 거래세 왕복 낭비) |
| `skip_seal_24h` | **삭제** | — | 존재 이유(AI 반복 거절 봉인)가 AI 제거로 소멸. 위험: 반복 발화 스팸 → 대체: ③ entry 쿨다운(봉 주기×2) + 사람 reject 시 4h 쿨다운 |
| `sell_amount_below_min` | 유지 | ③ | 수량 정합 |
| `regime_gate_macro_bear` | 유지 | ④ | KOSPI·SP500 동반 -1.5% 시 신규 매수 차단. 급락장 상한 안전장치 (rsi-oversold 완화의 반대급부로 더 중요해짐) |
| `regime_gate_macro_error` | 유지 | ④ | **fail-open 유지** + verdict=error 기록. macro는 억제 필터지 자금 안전장치가 아님 — fail-closed로 하면 외부 API 장애가 매수 전면 차단(제품 사망 재발 패턴) |
| `prefilter_bypassed_no_summary` | 삭제 | — | summary는 ②에서 룰 시간축(1h)으로 항상 산출 — fail-open 우회 분기 소멸 |
| `prefilter_liquidity_dead` | 유지 | ④ | **상장폐지 방지 — Operation Contract 최우선. 완화 금지** |
| `prefilter_atr_zero` | 유지 | ④ | 변동성 0 종목 진입 금지 |
| `prefilter_rsi_extreme_counter` | 유지 | ④ | RSI 85/15 극단 역행만 — 완화 불필요 |
| `prefilter_strong_counter_trend` | **삭제(룰로 흡수)** | — | 14d 3,028건 최다 학살자. 위험: 하락추세 낙하 중 매수 → 대체: (a) 추세 조건이 필요한 룰은 자체 보유(pullback-trend는 EMA20>EMA60 내장), (b) 역추세 룰(rsi-oversold)은 반등 확인 조건 내장 + regime_gate가 시장 전체 급락 차단, (c) losing_position_buy_block이 물타기 차단, (d) assist 모드 사람 승인이 최종 게이트. 전역 추세 게이트는 역추세 룰의 존재 이유와 정면 충돌하므로 전역이어선 안 됨 |
| `prefilter_blowoff_top` | 유지(임계 수정) | ④ | 현 조건 priceChange5>30%는 국내 상한가(30%) 때문에 도달 불능 — 사문. `priceChange5>10% && rsi14>80`으로 교정 |
| `late_session_buy_block` | 유지 | ④ | 15:00 이후 신규 매수 차단 — 갭다운 방어 |
| `portfolio_max_positions` | 유지 | ④ | 24h 종목당 매수 한도 — 물타기 상한 |
| `portfolio_core_ratio` | **assist에선 라벨 강등 / auto에선 유지** | ④ | 14d 학살자(portfolio_guard 1,199건의 일부). assist 모드는 사람이 보는 자리이므로 경고 라벨로 표시하고 통과, auto 모드에서만 하드 게이트. 위험: 코어 비율 붕괴 → 대체: 승인 카드에 '코어 비율 N%→M%' 경고 표기 |
| `dedup_regime` | **통합** | ③ | §4-3 entry 쿨다운으로. regime 버킷은 키에서 제외(버킷 경계 진동으로 쿨다운 우회되는 결함 제거) |
| `dedup_lookup_error` | 통합 | ③ | 쿨다운 조회 실패 = fail-open + error 기록 |
| `ai_input_no_summary` | **삭제** | — | AI 배치 입력 자체가 소멸 (무기록 블랙홀 #8 해소) |
| `ai_stage1_reject` / `ai_batch_failed` / `ai_failed_nonheld` / `ai_missing_in_batch` / `ai_rejected` / `ai_low_confidence` | **전부 삭제** | — | **D4: 장중 AI 완전 제거**. 위험: AI의 질적 거절(EV 판단) 소실 → 대체: (a) assist 모드 사람 승인이 질 게이트, (b) 승인 카드에 post-market 시나리오·market-state 라벨 표시, (c) 룰 조건 강화(§3), (d) auto 모드는 SIGNAL_AUTO_SUBMIT_MAX_KRW 소액 한도 내에서만 |
| `symbol_blacklisted` | 유지 | ④ | fail-closed + eval_funnel 기록 (현행은 무기록 return — 교정) |
| `duplicate_active_signal` | 유지 | ④ | 동일 심볼+방향 활성 시그널 존재 시 차단. eval_funnel 기록 추가 |
| `signal_create_failed` | 유지 | ④ | res.ok=false·예외를 **verdict=error로 기록 + 런 계속** (현행은 예외가 런 전체를 죽임 — try/catch 필수) |
| `signal_created` | 유지 | 터미널 | status는 §4-2 신규 ENUM |
| exit 트랙 (21~29) 전체 | 유지 | 병렬 | `exit_cooldown_5m`은 통합 쿨다운 scope='exit'로, status 목록에서 실존하지 않는 'executed','accepted' 제거(#7 교정). exit의 createSignal도 try/catch로 런 보호 |

게이트 수: 현행 50 → **유지 24 / 통합 5→2 / 삭제 12 / 라벨 강등 2** ≈ 실질 게이트 26 (run 3 · 심볼/룰 5 · 억제 5 · 안전 9 · exit 트랙 유지).

### 2. market-state 데드락 해소 설계

**분류 유지 가치: 있음 — 단 게이트가 아니라 라벨로.** 용도 4가지: (1) 승인 카드 "종목 국면" 표시(사람 판단 보조), (2) post-market AI 프롬프트 컨텍스트, (3) eval_funnel 라벨 → 국면별 룰 성과 사후 분석(레짐 학습 루프 유지), (4) 향후 포지션 사이징 힌트. `classifyMarketState()`는 룰과 **같은 1h summary**로 계산해 라벨만 부착한다.

**STATE_RULES 제거 시 룰별 판정** (활성 창 제거 → 아무 때나 실행돼도 되는가):

| 룰 | 판정 | 조치 |
|---|---|---|
| rsi-oversold-v1 | 자체 조건 완결 (RSI<T + MA20 + 반등확인) | 그대로 — 데드락(활성창 RSI∈[35,68] ∩ 발화창 RSI<35 = ∅) 자동 해소 |
| rsi-macd-reversal-v1 | 자체 조건 완결이나 rsi-oversold와 중복·노이즈 3~5배(주석 자인) | 기본 비활성 |
| rsi-divergence-v1 / triple-confirmation-v1 | 자체 조건 완결 (저빈도) | 기본 비활성 (중복 커버) |
| volume-spike-breakout-v1 | 자체 조건(거래량×3+신고가)이 volume_momentum 상태 정의보다 이미 강함 | 흡수 불필요. 추격형 — 승인 지연에 취약해 기본 비활성 |
| bb-squeeze-expansion-v1 | squeeze 판정 자체가 상태 판별 내장 | 그대로 + volRatio 0.7→1.2 강화 |
| bb-breakout-v1 | 자체 조건 완결 | 기본 비활성 (squeeze판과 중복) |
| **price-breakout-v1** | **자체 조건이 사실상 없음** (당일 고가 0.8% 근접이 전부) — 상태 게이트가 유일한 필터였음. 실측 14d 3,304건 노이즈 지배 + 매도측은 당일 저점에서 시장가 투매 | **기본 비활성 + 재설계 요건 명시**: "전일 고가 돌파 + 거래량 ≥1.5× + 5봉 누적 상승 < momentumChaseMaxPct"로 조건을 룰에 흡수하기 전엔 재활성 금지 |
| ma-cross-v1 / pullback-trend-v1 | 자체 추세 조건 내장 | pullback-trend만 기본 활성 |
| 1d 룰 (weekly-trend-follow 등) | 원래 상태 무관 | 그대로 |

**3중 시간축 통일: 장중 룰은 1h 단일축, adaptive-interval 폐기.**
- 근거: (a) 반자동 승인 모델(TTL 30분, 사람 응답 지연)과 30m 봉은 리듬 불일치 — 1h 봉이 승인 사이클과 정합. (b) adaptive-interval은 룰 시간축을 ATR 데이터에 종속시켜 게이트/라벨/백테스트 축 불일치를 재생산 — **실측: 현 고변동 레짐에서 90종목 중 67종목이 30m 유지, 23종목만 1h** (T-003 전제 "대부분 1h 승격"은 레짐 의존이었음 — 평시엔 1h, 급락장엔 30m으로 룰 의미가 계속 바뀜). 시간축이 흔들리는 룰은 백테스트 불가능 → 운용 불가. (c) rsi-oversold의 유일한 발화 경로가 이 불일치였다는 사실 자체가 축 불일치의 위험 증명. (d) 1h는 하루 6.5봉 — 후보 빈도·수수료 부담·노이즈 균형점.
- market-state 라벨·룰 지표·승인 카드 표기 전부 동일한 1h summary 객체에서 산출 (단일 소스). 1d 룰은 1d 유지.
- symbol_volatility·adaptive-interval 모듈은 보존하되 엔진 경로에서 분리 (universe 스코어링 입력으로만).

### 3. 룰 파라미터 재도출 (실측 기반)

**실측 1 — KOSPI 대형주 15종목 RSI(14) 분포** (네이버 공개 시세, 일봉 500봉 ≈ 2년, n=7,290):

| 지표 | 값 |
|---|---|
| 평균 / 중앙값 | 51.7 / 50.4 |
| p5 / p10 / p25 | 34.3 / 37.6 / 43.3 |
| P(RSI<30) | **1.8%** |
| P(RSI<33) | 3.6% |
| P(RSI<35) | **5.8%** (종목별 1.6~10.1%) |
| P(RSI<38) | **10.9%** |
| P(RSI<40) | 15.6% |
| P(RSI<42) | 21.1% |
| P(RSI<45) | 30.7% |

30m/1h 실측(최근 6거래일, n=1,050/420)은 P(30m RSI<35)=15.5%로 나왔으나 **2026-07 말 급락 레짐 표본**(삼성전자 주간 -20% 구간)이라 상향 편의 — 전 레짐 대표치로는 일봉 2y 분포를 앵커로 쓴다. RSI는 정규화 지표라 시간축 간 무조건부 분포 형상이 유사하며, 스트레스 구간에서 꼬리가 넓어진다(실측 일치).

**rsiBuyThreshold 재도출**: 35는 P=5.8% — 데드락이 없었어도 대형주에서 희귀 이벤트(개별 종목 연간 ~14 거래일 수준)이며, market-state 데드락과 겹쳐 실질 0이었다. **권고: 38** (P=10.9%, 35 대비 빈도 1.9×). 40(P=15.6%)은 "과매도"라 부르기 어려운 구간까지 진입해 질 저하 — 실측 편익 대비 기각. DB override(`style_default_rsiBuyThreshold=38`)로 적용, 코드 기본값은 유지(백테스트 미완료 파라미터는 DB로만 — 기존 가이드 준수).

**기본 활성 룰 선별 (5종)** — 선별 기준: 서로 다른 시장 국면 커버(과매도 반등 / 상승 추세 눌림 / 횡보→확장 / 장기 추세 / 보유 청산) + 자체 조건 완결성 + 반자동 승인 리듬 적합성:

| 룰 | 축 | 국면 | 파라미터 제안 | 예상 발화 (70종목, 정상 레짐) |
|---|---|---|---|---|
| rsi-oversold-v1 | 1h | 과매도 반등 | RSI<**38** + price≤MA20×1.005 + 반등확인(양봉 or 저점상승) — 유지 | 일 2~4건 (P(<38)≈11% × 반등확인 ~40% × 쿨다운) |
| pullback-trend-v1 | 1h | 상승 추세 눌림 | RSI 눌림 창 42~48 → **40~50 원복**(AI 게이트 소멸 대비 빈도 회복), EMA20>EMA60 유지, `rsiSellPriceMult>1.0` 사문 가드 제거 | 일 1~3건 |
| bb-squeeze-expansion-v1 | 1h | 횡보→변동성 확장 | volRatio 0.7→**1.2** (AI 부재 보상 — 가짜 돌파 필터 강화) | 일 0.5~2건 |
| weekly-trend-follow-v1 | 1d | 장기 추세 | 그대로 (MA60>MA200 + 종가>MA60 + RSI<60 + MA60 우상향). FIND_IN_SET 제거로 활성화됨 | 주 2~5건 |
| rsi-overbought-exit-v1 | 1h | 보유 청산 | sellT+3 유지, 거래량 가드 유지 | 보유 시 간헐 |

합계 **일 3~9건 후보** → 목표(일 3~10건) 부합. 기본 비활성: price-breakout(재설계 전 금지), volume-spike-breakout(추격형 — 승인 지연 취약), rsi-macd-reversal·rsi-divergence·triple-confirmation(과매도 국면 중복), ma-cross·bb-breakout(활성 룰과 중복), dividend-quality-buyback(3~6개월 보유 전제 — 스윙 1~10일 정책과 불일치, 보류).

**비용 현실화 (국내주식 왕복)**:

| 항목 | 값 | 비고 |
|---|---|---|
| 위탁수수료 (한투 온라인/BanKIS) | 0.0140527% ×2 = 0.0281% | 계좌 유형별 상이 — 실계좌 요율 확인 필요 |
| 매도 제세금 (2025~) | **0.15%** | KOSPI: 거래세 0%+농특세 0.15% / KOSDAQ: 거래세 0.15% |
| **명시 왕복 합계** | **≈ 0.178%** | |
| 스프레드·슬리피지 (대형주, 지정가) | 0.10~0.20% | 1틱 0.02~0.05% ×2 + 체결 추격 |
| **실효 왕복** | **0.28~0.38%** | |

판정: 현행 하드코딩 0.43%(단방향 0.215%)는 코인원(0.2%×2) 이식 잔재로 **명시 비용의 2.4× 과대**. 실효 상단 기준으로도 과대. 권고: `FEE_BUFFER` 명시비 0.18% + 슬리피지 파라미터 0.15% 분리(합 0.33%), 백테스트도 fee 0.09%/편도(비대칭: 매수 0.014%, 매도 0.164%로 나누면 더 정확) + slip 0.15%로 교정. 참고: system_config `backtest_fee_pct=0.05`는 현재 과소 — 함께 교정.

**엣지 하한**: EV>0 조건 `p×T − (1−p)×S − C > 0` (C=0.35%, hardStop S=1.5%): 목표익 T=2.5%면 **승률 p ≥ 46.3%** 필요, p=50% 가정 시 **T ≥ 1.85%**. 현행 targetProfitPct 2.5%·hardStop 1.5%는 손익비 1.67로 유지 타당 — 단 목표익을 1.5% 밑으로 낮추는 튜닝은 비용 구조상 금지선.

### 4. 상태·스위치 재설계

**4-1. ENGINE_ENABLED × AUTOPILOT_MODE 전이표**

| 모드 | 룰 발화 시 status | 주문 경로 | exit-engine 청산 |
|---|---|---|---|
| ENGINE_ENABLED=false | (런 자체 스킵 — run 행만 기록) | — | **작동 유지 권고** (보유 보호는 엔진 스위치와 무관) — leader 결정 필요 |
| manual | `detected` (관측 기록만, 주문 경로 없음, TTL 후 expired) | 사람이 주문 페이지에서 수동 | hard_stop·eod_loss_cut만 auto 제출 권고 |
| **assist (기본)** | `awaiting_approval` → 승인 시 `approved`+submitOrder / 거부 `rejected` / TTL `expired` | 텔레그램 승인 요청 → 사람 승인 | hard_stop·eod_loss_cut은 모드 무관 auto 제출(손실 확대 방지 — 포지션판 Kill Switch), target_profit·trailing은 승인 경로 |
| auto | amount≤SIGNAL_AUTO_SUBMIT_MAX_KRW → `auto_submitted`+즉시 submitOrder, 초과분은 assist 경로로 격하 | 자동 | 전부 auto 제출 |

마이그레이션 (구 2×2 → 신규): `analyst=F,hybrid=F`(pending)→**assist** / `analyst=T,hybrid=F`(auto_submit)→**auto** / `hybrid=T`(pending_approval 진입감시)→**assist**(entry-watcher의 진입감시는 assist의 '지정 진입가 승인' 옵션으로 흡수, `approved_pending_entry` 상태 유지). config 키: `engine_enabled`(구 strategy_analyst_enabled 값 이관), `autopilot_mode`. env 폴백 `ENGINE_ENABLED`/`AUTOPILOT_MODE`. 현 운영값(analyst=T, hybrid=T) → `engine_enabled=true, autopilot_mode=assist`.

**4-2. signals.status ENUM 최종안 + 호환 마이그레이션**

최종 상태 집합: `detected` · `awaiting_approval` · `approved` · `approved_pending_entry` · `auto_submitted` · `executing` · `rejected` · `expired` · `superseded` · `skipped`(구 ai_skipped 일반화 — ④게이트 감사 기록용).

안전 순서 (STRICT 모드에서 무중단):
1. **ALTER — 합집합 확장만**: 기존 ENUM 뒤에 신규 값 추가(`pending`,`pending_approval` 포함 구 값 전부 보존). ENUM 끝에 값 추가는 인플레이스(메타데이터만) — 값 제거·재배열은 테이블 리빌드+오류 위험이라 **하지 않는다**.
2. 코드 배포: 신규 상태로 읽고/쓰기, 구 상태는 읽기 호환(`pending`→awaiting_approval 취급).
3. 데이터 이관(선택): `UPDATE signals SET status='awaiting_approval' WHERE status IN ('pending','pending_approval')` (현재 해당 row 0건 실측 — 사실상 no-op), `ai_skipped`(13,811건)는 **이관하지 않고 구 값 그대로 조회 호환** (대량 UPDATE 회피).
4. 구 값 제거: 하지 않음 (이득 없음, 리스크만).

**재발 방지 (필수)**: 코드의 상태 상수 배열(SIGNAL_STATUSES)에서 DDL을 생성하고, **부팅 시 INFORMATION_SCHEMA.COLUMNS의 COLUMN_TYPE과 대조해 코드에 있는 상태가 ENUM에 없으면 기동 실패**(fail-closed). 이번 사고(코드-DB ENUM 불일치가 STRICT 모드에서 무증상 전멸)의 구조적 재발 차단. + createSignal 호출부 전부 try/catch로 런 보호(§1 signal_create_failed).

**4-3. 쿨다운 3중 → 단일 통합**

전용 테이블 `cooldowns(scope ENUM('entry','rebuy','exit'), symbol, strategy_id NULL, side NULL, until DATETIME, UNIQUE(scope,symbol,strategy_id,side))` — signals 상태 의존 쿼리가 사망 원인 중 하나였으므로 상태 테이블에서 분리:

| scope | 키 | TTL | 대체하는 현행 |
|---|---|---|---|
| entry | (symbol, strategy_id, side) | **봉 주기×2 = 2h** (시그널 생성 시), 사람 reject 시 **4h** | ai-dedup 60분 + 24h skip 봉인 |
| rebuy | (symbol) | **30분** (매도 체결 시 — 현행 5분은 거래세 왕복 낭비 방치) | cooldown_rebuy 5분 |
| exit | (symbol, exit_kind) | **15분** (활성 sell 시그널 존재 체크가 1차 방어, 쿨다운은 2차) | exit 5분 쿨다운 |

regime 버킷은 키에서 **제외** — 버킷 경계 진동(RSI 39.9↔40.1)으로 쿨다운이 우회되는 결함 제거. 결정론 파이프라인에는 단순 시간 키가 정합. 조회 실패 시 fail-open + error 기록. 만료 row는 daily cron에서 DELETE.

**4-4. next_backtest_at 겸직 해소**

- 평가 주기: **매 cron tick(5분) 전 활성 전략 평가가 맞다** — 룰이 결정론이고 entry 쿨다운이 봉 단위 중복을 막으므로 과평가 부작용 없음. 연산 절약용으로 "심볼×interval별 마지막 평가 봉 ts와 동일하면 룰 평가 생략"(새 봉 없으면 결과 불변) 최적화를 두되 이는 게이트가 아니라 캐시(기록 불요). 별도 throttle 컬럼 불요.
- `next_backtest_at`/`backtest_interval_h`는 **백테스트 스케줄 전용으로 복원** — 평가 경로에서 참조 금지. 운영 DB의 0.0833h 값은 백테스트 주기로는 무의미하므로 seed 기본(6h)으로 재설정 대상(leader 확인 후).

### 5. 마이그레이션·롤아웃 계획

| 순서 | 작업 | 롤백 |
|---|---|---|
| 0 (즉효 핫픽스, 선택) | `ALTER TABLE signals MODIFY status ENUM(...합집합에 'pending_approval' 추가)` 1줄 — **현행 코드 그대로도 시그널 생성 즉시 소생** (Phase 2 완성 전 관측 데이터 확보용). Phase 0/1과 충돌 없음 | ALTER 자체가 하위호환 — 롤백 불요 |
| 1 | DB 확장: status ENUM 합집합(§4-2), cooldowns CREATE, system_config `engine_enabled`/`autopilot_mode` 시드 (구 키 보존) | 확장만 — 구 코드 무영향 |
| 2 | 상태·스위치 코드 (D2): router/service — 신규 status·모드 판독, 구 키 fallback, createSignal try/catch, 부팅 ENUM 검증 | git revert — DB는 그대로 |
| 3 | 게이트 체인 코드 (D1+D4): engine.ts 4단계 재편, market-state 라벨화, AI 경로 제거, 통합 쿨다운, eval_funnel 연동(T-002 스키마) | git revert |
| 4 | 룰·seed 코드 (D3): 1h 통일, FIND_IN_SET/applicable_styles/부팅 재동기화 제거(seed는 INSERT IGNORE만 — UI 토글이 진실), 기본 활성 5종·비활성 목록 적용, 파라미터는 DB override로 | git revert + strategies.enabled는 UI로 복원 |
| 5 | DRY_RUN=true 3영업일 관측 → §6 기준 통과 시 T-001 단계적 해제 가이드 진입 | KILL_SWITCH·DRY_RUN 즉시 복귀 |

각 단계는 독립 배포·검증(빌드+테스트 통과, `/api/health`, cron 로그). **DB는 확장만 하고 축소하지 않으므로 모든 롤백은 코드 revert만으로 완결.**

Phase 1 관측 없이 확정 가능(이번 실측으로 판정 완료): 구조 수술 전부(단계 0~4) — 사망 원인이 코드+DB 수준에서 확정됐다. 실측을 기다려 조정할 것: rsiBuyThreshold 38↔40 미세조정, entry 쿨다운 TTL, core_ratio 완화 폭, 룰별 발화 빈도 — DRY_RUN 2주 eval_funnel 데이터로.

### 6. 검증 기준 (reviewer/qa — 정량)

1. **소생**: DRY_RUN+assist, 국내장 정상 개장일 3영업일 연속 — 룰 발화 후보(② 통과) 일 ≥ 10건 **and** 시그널(awaiting_approval) 일 **1~10건**. 0건인 날이 있으면 실패, 20건 초과 시 쿨다운·파라미터 재점검.
2. **감쇠 분산**: eval_funnel 기준 ② 통과 후보를 90% 이상 죽이는 단일 게이트가 없을 것 (T-002 §4 감쇠 SQL). `strong_counter_trend`·AI 계열 게이트 ID가 신규 기록에 나타나지 않을 것.
3. **생성 무결성**: `signal_create_failed` verdict=error 0건, createSignal 예외로 인한 runMarket 중단 0회 (cron 로그 500 없음). 부팅 ENUM 검증 활성 확인(고의로 코드 상태 하나 빼고 기동 → 기동 실패해야 PASS).
4. **시간축 단일성**: 생성 시그널 indicators의 interval 전부 '1h' 또는 '1d' (30m 잔재 0). market-state 라벨·룰 지표가 동일 summary 산출임을 코드 리뷰로 확인.
5. **중복·스팸**: 동일 (symbol,strategy,side) 시그널 2h 내 2건 이상 0건, 동일 (symbol,exit_kind) 15분 내 2건 0건 (SQL 검증).
6. **안전 회귀 (qa 필수)**: KILL_SWITCH=true → submitOrder 전면 차단 / 블랙리스트 심볼 시그널 0 / ORDER_MAX 초과 차단 / liquidity_dead(상폐 패턴) 매수 0 / late_session(15:00~15:30) 신규 매수 0 — 전부 현행과 동일해야.
7. **런 성능**: runMarket 1회 < 60s (AI 배치 제거로 단축), KIS API 호출 수/런 ≤ 현행 (1h 통일로 30m+1h 이중 fetch 소멸 — 감소해야 정상).
8. **exit 보호**: 보유 종목 존재 + exit 조건 발화 시나리오에서 시그널 생성 성공 and 런 계속 (현행은 런 전체 사망) — 통합 테스트 필수.

## 제약

- **코드 수정 금지** (analyst 단계). 설계 사양만 산출.
- DB는 운영 DB — **SELECT만** 허용.
- git commit/push 금지.

## 진행 로그

- 2026-08-02 Leader: task 생성. Phase 0 검증과 병렬로 analyst(Fable) 설계 착수.
- [20:47][analyst] Phase 2 사양 산출 완료 — 운영 DB 실측(SELECT만)으로 가설 D 기각·가설 C 운영값 기각, 제1사인은 `hybrid_mode_enabled=true × pending_approval ENUM 부재 × STRICT_TRANS_TABLES`로 확정. 게이트 50→4단계 전수 매핑, 1h 시간축 통일·adaptive-interval 폐기, rsiBuyThreshold 38(KOSPI 대형주 15종 2y RSI 실측 P(<38)=10.9%), 기본 활성 룰 5종 선별, 왕복 비용 0.178%(명시)/0.28~0.38%(실효)로 0.43% 하드코딩 과대 판정, ENUM 안전 마이그레이션·정량 검증 기준 8종 작성.

## 최종 요약

(작업 완료 후 Leader 작성)
