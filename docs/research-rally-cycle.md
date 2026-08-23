# 리서치: 급등·급락 사이클 패턴 분석 (T-032) + 매수/매도 추천 (T-033) + 차트 기반 목표가 (T-034)

`src/lib/research/` 는 **실매매와 완전히 분리된 관측 도구**다. 여기서 나온 어떤 값도
`createSignal()` · `submitOrder()` · `src/lib/strategy/` 로 흘러가지 않는다.
소비자는 두 곳뿐이다 — 분석 탭의 "리서치" 서브탭(`ResearchTab.tsx`)과 정기 텔레그램 거래 리포트.

이 경계는 사용자가 T-033 에서 **명시적으로 선택**한 것이다. 추천을 자동매매에 연결하려면
그 결정부터 다시 논의해야 한다.

---

## 1. 무엇을 계산하는가

| 단계 | 파일 | 산출물 |
|---|---|---|
| 사이클 탐지 | `pattern/rally-cycle.ts` | trough → 랠리 peak → 재하락 이벤트, `avgRallyPct`, `avgDaysToRally` |
| 선행지표 피처 | `pattern/precursor-features.ts` | 시점 t의 RSI14·ATR%·볼린저 %B·누적낙폭·거래량비 (**인과적**) |
| 규칙별 적중률 | `pattern/precursor-analysis.ts` | 규칙별 `triggerCount` / `hitCount` / `precision` / `lift` |
| 기준일 활성 규칙 | `pattern/precursor-analysis.ts` `getActiveRuleIds()` | 마지막 캔들에서 참이 된 규칙 id 목록 |
| 차트 목표가 | `pattern/price-targets.ts` | `PriceTargets` — 매수 희망가(지지)·매도 목표가(저항)·도달 가능성 |
| 추천 | `pattern/recommendation.ts` | `BuyRecommendation` / `SellAssessment` |

### look-ahead bias 방지

- 피처는 `candles[0..t]` 에만 의존한다 (`precursor-features.ts` 의 불변식, 전용 회귀 테스트 있음).
- `getActiveRuleIds()` 는 **피처 행 1개**만 받는다 — 미래 데이터를 넣을 자리 자체가 없다.
- `precision` 은 과거 구간의 사후 집계다. **예측 확률이 아니다.**

---

## 2. 임계치 — 전부 1차 휴리스틱이다

아래 숫자는 **실증검증(워크포워드·유의성 검정)을 거치지 않았다.** 표본이 작아 과적합 위험이
크다고 판단해 검정 대신 보수적 문턱을 걸었다. 근거는 "왜 이 방향으로 보수적인가"이지
"이 값이 최적이다"가 아니다.

| 상수 | 값 | 위치 | 왜 이 값인가 |
|---|---|---|---|
| `MIN_SAMPLE_FOR_RECOMMENDATION` | 8 | `recommendation.ts` | `PrecursorAnalysisConfig.minPositiveDays`(5)는 "경고를 띄울지"의 문턱이다. 추천은 그보다 높은 문턱이어야 하므로 한 단계 올렸다. 8건 미만이면 `precision` 한 건의 이동이 12%p 이상 움직인다 |
| `MIN_LIFT_FOR_BUY` | ×1.8 | `recommendation.ts` | lift 1.0 = 무작위. 1.5 는 표본 8~15건에서 흔히 나오는 잡음 범위라 한 단계 위인 1.8 로 잡았다 |
| 신뢰도 구간 | 8~14 낮음 / 15~29 보통 / 30+ 높음 | `recommendation.ts` | 표본 크기 라벨일 뿐 통계적 유의성이 아니다 |
| `TARGET_HORIZON_DAYS` | 14 **달력일** | `price-targets.ts` | 사용자 지시(2026-08-21) "기한은 14일". 화면 문구·매도 기간 판정이 **이 숫자 하나만** 쓴다 |
| `BOLLINGER_PERIOD`/`K` | 20 / 2 | `price-targets.ts` | 관례값. 20일 = 약 한 달 거래일 |
| `SWING_LOW_LOOKBACK` | 20거래일 | `price-targets.ts` | 최근 한 달 저점 — 기한(14일)과 비슷한 시간축의 지지 |
| `SWING_HIGH_LOOKBACK` | 60거래일 | `price-targets.ts` | 저항은 더 긴 기억이 필요하다(직전 분기 고점) |
| `TREND_MA_PERIOD` | 60 | `price-targets.ts` | 중기 추세선. 지지·저항 양쪽 후보로 쓴다 |
| `ATR_PERIOD` | 14 | `price-targets.ts` | 관례값. 기대 변동폭 = ATR14 × √(기한 거래일) |
| `MIN_CANDLES_FOR_TARGETS` | 61 | `price-targets.ts` | MA60·60거래일 고점을 만들 수 있는 최소치. 부분값을 내보내지 않는다 |
| `SELL_PROXIMITY_ATR_MULTIPLE` | ×1 | `recommendation.ts` | 저항선까지 남은 거리가 **하루 평균 변동폭(ATR14) 이내**면 사실상 닿은 것으로 본다. 새 자유 파라미터를 만들지 않으려고 이미 계산해 둔 ATR14 에 묶었다 — 임의의 % 임계치보다 종목별 변동성에 자동으로 적응한다 |

### T-034 에서 폐기된 상수 (되살리지 말 것)

`TARGET_REACHED_RATIO`(0.8) · `DURATION_EXCEEDED_RATIO`(×1.5) · `CALENDAR_DAYS_PER_TRADING_DAY`(7/5) ·
`MAX_TIMEFRAME_DAYS_FOR_BUY`(5) · `estimateTargetPrice()` · `estimateTimeframeDays()` · `targetProgressPct()`.

모두 **`목표가 = 기준가 × (1 + 과거평균상승폭)`** 을 떠받치던 장치다. 매도 목표가의 기준가가
사용자 **진입가**였기 때문에, 물린 종목일수록 목표가가 현실과 멀어졌다 —
실측(`NAS:SNPS`, 2026-08-21): 진입가 ₩675,724 × 1.22 = ₩824,383 이 화면에 찍혔고, 이는
현재가(약 ₩553,109) 대비 **+49%** 였다. 사용자는 이를 "2주 안에 49% 오른다는 예측"으로 읽었다.
또한 표시 기한(21일)과 실제 판정 기한(31.5일 = 15 × 1.4 × 1.5)이 어긋나 있었다.
지금은 목표가가 캔들에서만 나오고 기한은 숫자 하나(14)만 존재한다.

**추가 폐기(2026-08-21, 사용자 결정): `duration_exceeded` 매도 판정.**
"보유일수 ≥ 기한(14일)이면 매도 고려"라는 규칙을 초안에 넣었다가 제거했다. 두 가지 이유가 겹친다.

1. **원칙 충돌.** 그 판정의 입력은 `position_state.first_seen_at`(진입일) = **사용자 포지션 정보**다.
   이번 작업의 대전제가 사용자 지시 *"분석은 사용자 포지션과 완전히 독립적이어야 한다"* 였으므로
   진입가를 뺀 자리에 진입일을 남겨두는 것은 같은 원칙을 절반만 지키는 셈이었다.
2. **증상.** 실제로 **2주 넘게 보유한 종목 전부에서 상시 발화**했다(실측: `NAS:SNPS` 16일째).
   장기 보유 종목은 정의상 항상 기한을 넘기므로 신호가 아니라 상수에 가까웠다.

지금 매도 판정의 입력은 `PriceTargets` 하나뿐이다. `daysSinceEntry`·`gainPct` 는 반환값에 남아 있으나
**표시 전용**이며, 화면·리포트에서도 판단 줄과 분리된 "참고 정보" 줄로만 렌더된다.

### 재검토 조건

다음 중 하나라도 해당하면 이 표를 다시 계산해야 한다.

1. 추적 종목이 30개를 넘어 규칙별 표본이 충분해졌을 때 → 워크포워드 검증으로 대체 검토
2. "매수 고려"가 매일 절반 이상의 종목에서 뜰 때 → `MIN_LIFT_FOR_BUY` 상향
3. "매도 고려"가 대부분의 보유 종목에서 상시로 뜰 때 → `SELL_PROXIMITY_ATR_MULTIPLE` 하향
   (기간 초과 판정은 이미 폐기됐다 — 위 참조)
4. `RULES` 집합을 바꿨을 때 → 저장된 `today_active_rule_ids` 의 id 가 통계와 매칭되지 않으면
   `evaluateBuySignal` 이 `insufficient_data` 로 떨어진다(조용히 틀린 값을 내지는 않는다)

---

## 3. 과신 방지 규율 (코드로 강제)

1. **"확률"이라는 단어를 쓰지 않는다.** 화면·리포트 모두 "과거 적중률"로 표기한다.
2. **표본부족은 추천으로 승격되지 않는다.** `insufficient_data` 로 강등되고,
   "왜 부족한지"(트리거 건수)를 함께 보여준다.
3. **면책 문구가 값에 붙어 다닌다.** `BuyRecommendation.note` / `SellAssessment.note` 가
   `PRECURSOR_NOTE` 를 들고 다니므로 소비자가 문구를 빠뜨릴 수 없다.
4. **기준일을 항상 함께 노출한다.** 국내 리서치는 16:00 cron(전일 종가), 해외는 07:00 cron
   (당일 종가)에만 갱신된다 — **실시간이 아니다.** `dataRangeTo` 를 추천 옆에 표시한다.
5. **🔴 분석은 사용자 포지션과 독립이다 (T-034).** 목표가는 `price-targets.ts` 가 **캔들만** 보고
   만든다. 진입가·수량·손익은 인자에 없다. 진입가보다 싸게 팔지 비싸게 살지는 사용자가 정할
   일이고 분석이 개입하지 않는다(사용자 지시).
   매도 판정도 마찬가지로 **차트 하나로만** 한다 — 진입가뿐 아니라 **진입일도 쓰지 않는다**
   (기간 초과 판정 폐기, §2 참조). `evaluateSellSignal(targets, position?)` 의 시그니처가
   *첫 인자 = 판정 입력(차트) / 둘째 인자 = 표시 입력(포지션)* 이라는 경계를 드러낸다.
   `daysSinceEntry`·`gainPct` 는 **표시 전용**이며 판정에 쓰지 않는다.
   회귀 테스트(`recommendation.test.ts`, `recommendation-view.test.ts`)가
   "진입가를 바꿔도, 보유기간을 999일로 줘도 매도 목표가·판정이 변하지 않는다"를 고정한다.
6. **🔴 도달 근거가 없으면 숫자를 만들지 않는다.** `|목표가 - 기준일 종가| > ATR14 × √(기한 거래일)`
   이면 목표가를 **표시하지 않고** "14일 내 도달 근거 없음"으로 대체한다. 매수 추천도 그 경우
   `buy` 로 올리지 않는다. 사용자가 제기한 "변동성이 커서 타이밍을 잡을 수 없다"에 대한 해법은
   기한 길이 조정이 아니라 이 게이트다.
7. **🔴 통화를 섞지 않는다.** `DailyCandle` 은 Yahoo 원본이라 국내 KRW / 해외 USD 인데
   `position_state.entry_price` 와 `fetchCurrentPricesKRW()` 는 항상 KRW 다. 목표가는 **환산하지
   않고** 원통화로 계산·저장·표시하며(`PriceTargets.currency`), 화면·리포트가 `$412.50` / `₩70,000`
   처럼 기호를 붙인다. 자세한 근거는 아래 §6.

---

## 4. 저장 스키마

`research_rally_results` — (symbol, run_date) UNIQUE, 하루 1행 upsert.

T-033 에서 추가된 컬럼:

```sql
today_active_rule_ids JSON NULL
```

- `NULL` = 평가하지 못함(캔들 부족·지표 워밍업 구간·구버전 행)
- `[]`   = 평가했고 **충족한 규칙이 없음** — 결측이 아니라 관측 결과다

이 둘을 구분하는 것이 중요하다. `NULL` 은 `insufficient_data`(판단 보류)로, `[]` 는
`hold`(관망)로 이어진다. 빈 배열을 `NULL` 로 접으면 "오늘 조건이 안 걸렸다"는 사실이
"모른다"로 바뀐다.

T-034 에서 추가된 컬럼:

```sql
price_targets JSON NULL   -- PriceTargets (currency 포함)
```

리서치 cron 이 캔들로 **한 번 계산해 저장**하고, 조회(ResearchTab·08:00 리포트)는 읽기만 한다.
조회 때마다 Yahoo 를 다시 받으면 느릴 뿐 아니라 두 화면이 서로 다른 시점의 캔들로 다른 목표가를
내게 된다(`today_active_rule_ids` 와 같은 이유). `NULL` = 캔들 부족(61봉 미만)·구버전 행이며,
그때는 매도 판단이 `insufficient_data` 로 떨어지고 매수 게이트는 걸리지 않는다
(결측과 "너무 멀다"를 구분한다).

**🔴 `price_targets` 안의 가격은 KRW 가 아닐 수 있다.** 통화는 반드시 같은 JSON 의 `currency`
필드를 보고 판단한다 — 값의 크기로 추측하지 말 것.

---

## 5. 실행 경로

| 시각(KST) | cron | 대상 |
|---|---|---|
| 16:00 | `/api/cron/research-cycle-domestic` | 국내 — 전일 종가까지 |
| 07:00 | `/api/cron/research-cycle-overseas` | 해외 — 당일(현지 전일) 종가까지 |
| 08:00 | `/api/cron/trade-report` | 리서치 요약을 리포트에 포함 |

수동 트리거:

```bash
curl -X POST -H "x-cron-secret:$CRON_SECRET" localhost:3003/api/cron/research-cycle-domestic
curl -X POST -H "x-cron-secret:$CRON_SECRET" "localhost:3003/api/cron/trade-report?force=1"
```

화면에서는 종목 카드의 "지금 분석" 버튼(`POST /api/research/tracked/[symbol]/run`)으로
장 마감을 기다리지 않고 즉시 재분석할 수 있다.

---

## 6. 차트 기반 목표가 (T-034)

### 후보와 선택 규칙

| 방향 | 후보 (기준일 종가 대비) | 선택 |
|---|---|---|
| 매수 희망가(지지) | 볼린저(20,2) 하단 / **직전** 20거래일 저점 / MA60 중 **아래**에 있는 것 | 기준가에 **가장 가까운 것** |
| 매도 목표가(저항) | 볼린저(20,2) 상단 / **직전** 60거래일 고점 / MA60 중 **위**에 있는 것 | 기준가에 **가장 가까운 것** |

가장 가까운 레벨을 고르는 이유: 기한(14일) 안에 **가장 먼저 닿을** 레벨이기 때문이다.

**스윙 고저는 기준봉을 제외해서 뽑는다.** 기준봉을 포함하면 그날의 `low` 는 정의상 종가 이하라
지지선이 항상 오늘 저가가 되어 현재가에 달라붙고 아무 정보도 주지 못한다(고점도 대칭). 제외하면
"오늘 신저가를 깨는 중이면 아래 지지 후보가 없다"는 사실이 그대로 드러난다 — 이건 결측이 아니라
관측 결과이며, 매도 쪽에서는 `sellTarget == null` 이 곧 **"저항선 도달"** 판정이 된다.

### 기한의 단위 — 왜 달력일 14일인가

`TARGET_HORIZON_DAYS = 14` 는 **달력일**이다. 근거:

1. 사용자가 말한 "기한은 14일"의 자연스러운 해석이 달력일이고, 보유기간
   (`position_state.first_seen_at` 기준 달력일)과 **환산 없이 바로 비교**된다.
2. 거래일로 잡으면 화면에 "14거래일"과 "약 20일"이 동시에 필요해져, T-033 에서 문제였던
   *표시 숫자 ≠ 판정 숫자* 가 그대로 재현된다.
3. 거래일 환산은 **`expectedMove` 한 곳**에만 존재한다 — 캔들이 거래일 단위라 √ 스케일링은
   거래일이어야 맞기 때문이다. `toTradingDays(14) = 10` 이며 그 값은 반환값의
   `horizonTradingDays` 로 드러나 있다(숨은 상수가 아니다).

### 도달 가능성 게이트

```
reachable  ⟺  |목표가 - 기준일 종가|  ≤  ATR14 × √horizonTradingDays
```

- `false` → 목표가 숫자를 **표시하지 않고** "14일 내 도달 근거 없음"으로 대체.
- ATR 을 못 구하면 `false` 가 아니라 `null`(판단 불가)이며, 이때도 숫자는 감춘다.
  ATR 0 을 그대로 쓰면 "±0 안에서만 도달 가능"이라는 가짜 정밀도가 생기므로 `null` 로 둔다.
- 매수 추천은 기한 내 닿을 지지선이 없으면 `buy` 로 올리지 않는다
  (`downgradeReason`: `no_support_level` / `buy_zone_unreachable`).

### 통화 — 환산하지 않는 이유

`DailyCandle` 은 Yahoo 원본이라 국내 KRW / 해외(NASDAQ·NYSE·AMEX) USD 다.
반면 `position_state.entry_price` 와 `fetchCurrentPricesKRW()` 는 **항상 KRW** 다.

환산하지 않기로 한 근거:

1. 환산하려면 "분석 기준일의 환율"이 필요한데 그 시점 환율을 저장하지 않는다. 실시간 환율을
   쓰면 종가 기준 차트 레벨에 오늘 환율이 섞여 근거가 흐려진다.
2. 볼린저 하단·60일 고점은 사용자가 **원통화 차트에서 보는 그 선**이다. 환산하면 대조가 안 된다.
3. 환산 코드가 없으면 KRW·USD 를 섞을 경로 자체가 존재하지 않는다(구조적 차단).

대신 `PriceTargets.currency` 가 값에 붙어 다니고, 화면·리포트가 같은 `formatTargetPrice()` 로
`$412.50` / `₩70,000` 처럼 기호를 찍는다. 손익률(`gainPct`)만 KRW 끼리 계산하며 목표가와 접점이 없다.

### 매도 판정

위에서부터 순서대로 평가한다. **입력은 `PriceTargets` 하나뿐이다.**

| 조건 | action / reason | 뜻 |
|---|---|---|
| `priceTargets` 없음 | `insufficient_data` | 캔들 부족·구버전 행 |
| `sellTarget == null` | `sell` / `target_reached` | 현재가 위 저항 후보가 하나도 없음 = 저항선 돌파 |
| `sellReachable !== true` | `insufficient_data` | 기한 내 도달 근거 없음·ATR 산출 불가 → 숫자도 판정도 만들지 않는다 |
| 잔여 거리 ≤ ATR14 × 1 | `sell` / `target_reached` | 저항선 근접 |
| 그 외 | `hold` / `in_progress` | 아직 저항선 아래 |

두 가지가 핵심이다.

1. **도달 여부를 캔들 종가(`asOfPrice`)로만 판정한다** — KRW 현재가와 원통화 목표가를 비교하는
   경로를 아예 만들지 않기 위해서다.
2. **보유기간·진입가는 어느 분기에도 등장하지 않는다** — 기간 초과 판정은 폐기됐다(§2).
