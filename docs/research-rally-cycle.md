# 리서치: 급등·급락 사이클 패턴 분석 (T-032) + 매수/매도 추천 (T-033)

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
| `TARGET_REACHED_RATIO` | 0.8 | `recommendation.ts` | 과거 평균 상승폭의 100% 를 기다리면 평균값 정의상 절반은 도달하지 못한다. 80% 지점에서 "고려" 신호를 낸다 |
| `DURATION_EXCEEDED_RATIO` | ×1.5 | `recommendation.ts` | 평균 소요기간의 1.5배를 넘으면 과거 패턴과 다르게 흘러가고 있다는 뜻으로 본다 |
| `CALENDAR_DAYS_PER_TRADING_DAY` | 7/5 | `recommendation.ts` | `avgDaysToRally` 는 **거래일**(캔들 수), 보유기간은 `position_state.first_seen_at` 기준 **달력일**이다. 환산하지 않으면 기간 초과 판정이 약 1.4배 빨리 발화한다 |
| 신뢰도 구간 | 8~14 낮음 / 15~29 보통 / 30+ 높음 | `recommendation.ts` | 표본 크기 라벨일 뿐 통계적 유의성이 아니다 |

### 재검토 조건

다음 중 하나라도 해당하면 이 표를 다시 계산해야 한다.

1. 추적 종목이 30개를 넘어 규칙별 표본이 충분해졌을 때 → 워크포워드 검증으로 대체 검토
2. "매수 고려"가 매일 절반 이상의 종목에서 뜰 때 → `MIN_LIFT_FOR_BUY` 상향
3. "매도 고려 — 기간 초과"가 목표 도달보다 압도적으로 많을 때 → `DURATION_EXCEEDED_RATIO` 재검토
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
5. **매도 판단의 알려진 근사**: 과거 통계는 저점(trough) 기준인데 우리 진입가는 저점이 아니다.
   그래서 "목표(과거평균 +N%) 대비 X% 진행"처럼 **비교 대상을 문장에 명시**한다.

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
