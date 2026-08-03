---
project: StockInvest
created: 2026-08-02
tags:
  - type/decision
  - domain/strategy
aliases:
  - 재구성 플랜
  - restructure-plan
---

# 결정 · StockInvest 재구성 (2026-08-02)

> 사용자 요청: "시나리오를 통한 주식매매 자동화로 수익을 얻으려 만들었는데 수익도 못 내고 시그널도 제대로 생성되지 않아 사용을 안 하고 있다. 원인을 분석하고 다시 사용할 수 있는 형태로 재구성해달라."
> 재개 진입점: [[RESUME]]

## 1. 근본 원인 진단

### 한 문장

> 안전을 위해 쌓은 직렬 게이트들이 곱셈으로 시그널 처리량을 0으로 만들었고, 그것을 볼 관측도 고칠 근거가 될 성과 측정도 없어, 사용자는 매일 아무 일도 일어나지 않는 앱을 결국 닫았다.

### 제1사인 — 시그널은 만들어지다가 DB에서 죽었다 (운영 DB 실측 확정)

운영 config `hybrid_mode_enabled=true` + MariaDB **STRICT_TRANS_TABLES** + `signals.status` ENUM에 **`pending_approval` 부재** → INSERT가 하드 에러. 게다가 `runExitEngine`·`applyBatchDecisions`의 createSignal 호출이 예외로 보호되지 않아 **그 예외가 runMarket 전체를 중단**시켰다. AI를 통과한 매수 후보도, 손절·익절 청산 시그널도 전부 같은 지점에서 사망.

근거: signals에 pending/pending_approval row **0건**, 7/19 이후 비-skip 시그널 **0건/일**.

### 최근 14일 실측 깔때기 (국내장)

```
룰 발화 후보 4,525건
  → prefilter -2,962   (strong_counter_trend 단일 게이트가 3,028건 학살)
  → portfolio_guard -1,199
  → ai_rejected -264 / ai_failed -100
  → AI 통과분은 ENUM 사고로 INSERT 사망
  → 시그널 0건
```

### 확정된 구조적 결함

| # | 결함 | 근거 |
|---|---|---|
| 1 | `ANALYST_ENABLED` 이중 의미 | engine.ts(엔진 마스터 스위치) vs router.ts(라우팅 정책). CLAUDE.md의 실거래 해제 가이드 1단계가 지시한 설정이 곧 시그널 0 |
| 2 | market-state × rsi-oversold **데드락** | classifyMarketState가 RSI<35를 `divergence_signal`로 선점(그 상태 활성 룰은 enabled=0) → `oversold_bounce`는 RSI∈[35,38)에서만 성립하는데 룰 발화 조건은 RSI<35. **활성 창 ∩ 발화 창 = ∅**. 실제 발화 341건/14d는 전부 adaptive-interval 1h 승격 심볼(23/90)의 시간축 불일치 탈출구 경유 |
| 3 | 장중 AI가 하드 게이트 | ai-filter.ts가 LLM_PROVIDER 무시하고 `claude` CLI 직접 spawn. 실패 사유 상위 "claude exit 143"(89건)·"exit 1"(22건) → 비보유 종목 전량 ai_failed |
| 4 | 노이즈 지배 | `price-breakout-v1`이 후보의 **73%**(3,304/14d). 코인 24h 고저 로직이 주식 당일 고저로 오작동 |
| 5 | 무기록 블랙홀 | `ai_input_no_summary`(engine.ts) — 배치 성공 시 summary 없는 후보가 기록도 시그널도 없이 증발 |
| 6 | 3중 시간축 불일치 | 게이트(raw 30m) / 룰(adaptive 1h 승격) / AI 프롬프트(30m 표기) |
| 7 | 존재하지 않는 status 조회 | `'executed','accepted'`는 signals에 없는 값(orders 소속) → 재매수 쿨다운·exit 쿨다운·regime 학습 루프 영구 무효. **exit 쿨다운 무력화는 중복 청산 위험** |

### 실측으로 **기각**된 사전 가설

- ~~MariaDB JSON_EXTRACT 따옴표 불일치~~ → `eq_plain=3134 = eq_unquoted=3134`(n=13,811). 문법 정상
- ~~next_backtest_at 6시간 throttle~~ → 운영값 `backtest_interval_h=0.0833`(5분). 사용자가 이미 풀어놨음. 단 겸직 구조 문제는 유지
- ~~실질 활성 룰 2개~~ → 운영 DB는 15/16 enabled. FIND_IN_SET·미등록 필터 후 intraday 실평가 9종
- ~~배포 파이프라인 red~~ → pm2 실측 결과 정상 가동 중이었음

### 수익 부재의 구조

`executions` 테이블에 INSERT하는 코드가 **한 줄도 없다** → 체결가·수수료·슬리피지·실현손익 실측 원천 불가. "백테스트 미검증 전략 실매매 금지" 원칙은 옳으나 백테스트 루프가 운용된 적 없어 **논리적으로 영구 0단계**. 즉 수익을 못 낸 게 아니라 **수익 가능 여부를 판정할 능력 자체가 없었다.**

### 안전장치는 방향이 거꾸로였다

주문 한도가 DB 키 미설정·잔고 조회 실패 시 **Infinity**(fail-open) / Kill Switch drawdown 자동 발동은 호출처 없는 dead code / 71 라우트 중 61개 무인증(`PATCH /api/settings/safety`로 DRY_RUN 원격 해제 가능) / 변동폭 가드 OFF + 크립토 심볼 배율 잔재. **제품은 fail-closed, 안전은 fail-open** — 정확히 반대.

## 2. 재구성 전략: 최소 동작 루프 우선 (strangler)

전면 재작성 기각(검증된 자산 ~70% 폐기), 개별 패치 기각(곱셈 게이팅 구조 잔존).

**보존**: KIS 어댑터 3종, `submitOrder()` 단일 관문(우회 0건 실증), signal-followup, 알림 8곳, UI 셸, post-market 시나리오 카드 UX
**재구축**: 파손된 시그널 파이프라인만 단순·관측 가능하게

매 Phase가 **사용자가 눈으로 확인할 결과물**을 낸다 — 재사용 동기 복원이 최우선이므로.

## 3. 사용자 확정 결정 (2026-08-02)

1. **해외주식 보류** — kis-overseas/FX 코드 보존·비활성. 국내 루프 완성 후 재개
2. **장중 AI 제거** — 장중은 결정론적 룰만. AI는 post-market 시나리오 카드 생성(밤 배치)에만
3. **부가기능**: RAG 되먹임 유지 + 투자일지 유지 / **AI 채팅(`/ai`)·LoRA export 제거**
4. **크리덴셜**: DB 평문 유지 + PIN 인증으로 접근 봉쇄

## 4. 핵심 설계 결정

- **D1** 게이트 50 → 26 (유지 24 / 통합 5→2 / 삭제 12 / 라벨 강등 2), 4단계 재편. market-state는 게이트에서 **라벨로 강등**. 모든 차단은 `eval_funnel` 기록
- **D2** `ENGINE_ENABLED`(엔진 on/off) + `AUTOPILOT_MODE` ∈ {manual, **assist**(기본), auto} 분리. signals.status ENUM 정비 + **부팅 시 INFORMATION_SCHEMA 대조, 불일치 시 기동 실패**(재발 방지)
- **D3** `strategies.enabled` 단일 기준. applicable_styles/FIND_IN_SET/style 하드코딩/부팅 재동기화 제거 — **UI 토글이 곧 진실**
- **D4** 장중 AI 제거. 모든 LLM 호출은 provider.ts 경유
- **D5** `strategies.validation_status` ∈ {unvalidated, backtested, paper_validated}. **DRY_RUN=false 실주문은 backtested 이상만 허용** — 원칙을 문장이 아니라 코드로
- **D6** DRY_RUN 체결도 `executions(simulated=1)` INSERT → 페이퍼 손익 실측
- **D7** 안전장치 fail-safe 전환 (미설정=거부, Kill Switch 배선)
- **D8** 인증 최소선 (middleware + PIN 세션)

### fail 방향 원칙

**fail-closed** = "통과시키면 돈이 나가는 검증"(개장·엔진 스위치·한도·블랙리스트·create 검증)
**fail-open** = "차단하면 기회를 잃는 필터"(macro·prefilter·쿨다운 — 관측 기록 남기고 통과)

macro 게이트를 fail-closed로 두면 외부 API 장애가 매수를 전면 차단한다 — 제품 사망 패턴의 재발이다.

## 5. 룰 파라미터 재도출 (실측)

**KOSPI 대형주 15종목 RSI(14) 일봉 2년, n=7,290**
평균 51.7 / p5=34.3 / p10=37.6
**P(<30)=1.8% · P(<33)=3.6% · P(<35)=5.8% · P(<38)=10.9% · P(<40)=15.6% · P(<45)=30.7%**

- **rsiBuyThreshold 35 → 38** 권고 (빈도 1.9×). 35는 대형주 기준 연 ~14거래일의 희귀 이벤트 + 데드락 → 실질 0. 40은 과매도가 아닌 구간까지 포함되어 기각
- **시간축 1h 단일 통일, adaptive-interval 폐기** — 레짐마다 룰 의미가 바뀌면 백테스트가 불가능하다

### 기본 활성 5종 (서로 다른 국면 커버)

| 룰 | 축 | 국면 | 예상 발화 |
|---|---|---|---|
| rsi-oversold-v1 | 1h | 과매도 반등 (RSI<38) | 일 2~4건 |
| pullback-trend-v1 | 1h | 상승추세 눌림 (RSI 40~50) | 일 1~3건 |
| bb-squeeze-expansion-v1 | 1h | 횡보→확장 (volRatio 1.2) | 일 0.5~2건 |
| weekly-trend-follow-v1 | 1d | 장기 추세 | 주 2~5건 |
| rsi-overbought-exit-v1 | 1h | 보유 청산 | 간헐 |

합계 **일 3~9건** (목표 3~10건 부합)

### 비용 현실화

국내주식 왕복: 위탁수수료 0.0140527%×2 + 매도 제세금 0.15% = **명시 0.178%**, 슬리피지 포함 **실효 0.28~0.38%**.
현행 하드코딩 **0.43%는 명시비의 2.4× 과대**(코인원 0.2%×2 잔재), `backtest_fee_pct=0.05`는 반대로 과소 — 둘 다 교정 대상.

**엣지 하한**: C=0.35%, hardStop 1.5% 기준 — 목표익 2.5%면 **승률 ≥ 46.3%** 필요. 승률 50% 가정 시 목표익 ≥ 1.85%. **목표익 1.5% 미만 튜닝은 비용 구조상 금지선.**

## 6. Phase 로드맵

| Phase | 내용 | 사용자가 눈으로 확인할 것 |
|---|---|---|
| **0** 안전 기반 | 한도 fail-safe, PIN 인증, Kill Switch 배선, CI 테스트 게이트 | 미인증 401, health에 안전장치 green/red |
| **1** 관측 + 소생 핫픽스 | eval_funnel, 게이트 계측, H1 ENUM·H2 예외격리·H3 exit쿨다운·H4 노이즈룰 | **시그널이 다시 생성됨** + 아침 리포트에 깔때기 |
| **2** 파이프라인 수술 | D1~D4 일괄, 룰 파라미터 재도출, 회귀 테스트 | 매일 승인 대기 카드 3~9건 |
| **3** 페이퍼 손익 | executions(simulated), 룰별 승률·EV, 비용 config화 | "이번 주 페이퍼 손익 +X%" — 매일 열어볼 이유 1호 |
| **4** 백테스트 검증 루프 | 야간 cron, validation_status, 실주문 전제조건 | 룰별 "검증됨" 배지 |
| **5** DRY_RUN 해제 준비 | KIS 체결내역 폴링 → executions(real), 해제 체크리스트 | **최초의 실측 손익** |

## 7. Phase 2 정량 검증 기준

1. **소생**: DRY_RUN+assist, 3영업일 연속 — 통과 후보 일 ≥10건 **and** 시그널 일 **1~10건**
2. **감쇠 분산**: 후보를 90% 이상 죽이는 단일 게이트 없음. strong_counter_trend·AI 계열 gate가 신규 기록에 부재
3. **생성 무결성**: `signal_create_failed`=0, createSignal 예외로 인한 런 중단 0회. **고의로 상태 하나 빼고 기동하면 기동 실패해야 PASS**
4. **시간축**: 시그널 interval 전부 1h/1d (30m 잔재 0)
5. **스팸**: 동일 (symbol,strategy,side) 2h 내 2건 = 0
6. **안전 회귀**: KILL_SWITCH·블랙리스트·ORDER_MAX·liquidity_dead·late_session 차단이 현행과 동일
7. **성능**: runMarket <60s, KIS 호출 수 감소(30m+1h 이중 fetch 소멸)
8. **exit 보호**: exit 발화 시 시그널 생성 성공 + 런 계속

## 8. 삭제·보류 목록

**삭제**: `src/lib/analyst/rules.ts`(중복·dead) · 코인 잔재(btc3hChangePct, volatility-guard 크립토 배율, getEnvOrderMax) · dead status 쿼리 3곳 · 장중 AI 필터 경로 · AI 채팅(`src/lib/chat/`, `/ai`, `/api/chat`) · LoRA export · dead UI 컴포넌트(TABS 미등록) · stale 문서(기획서_V0.1.md, phases/*, trading-strategy.md 코인 전략)

**보류(코드 보존·비활성)**: kis-overseas/FX 경로, 해외 cron 호출

**유지**: RAG 되먹임(upsert + followup 라벨 + post-market 프롬프트 주입) · 투자일지 · post-market 시나리오 생성 · 알림 · trade-report
