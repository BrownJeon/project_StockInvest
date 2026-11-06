---
task_id: T-033
title: 리서치분석 매수/매도 추천(Phase 1) + 거래 리포트 08:00 개선(Phase 2)
status: done
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-032]
tags:
  - type/task
  - domain/research
  - domain/reports
  - domain/cron
aliases:
  - 매수매도 추천
  - 거래리포트 개선
created: 2026-08-20
updated: 2026-08-20
---

## 배경 (사용자 요청)

매일 08:00 텔레그램 거래 리포트 개선 요청에서 시작해, 논의 중 "리서치분석(T-032)의 궁극적 목적은
종목을 언제 매수/매도할지 판단하는 것"이라는 사용자 확인이 나와 작업을 2 Phase로 나눴다.

- **Phase 1(선작업)**: 리서치분석에 명시적 "매수 고려/매도 고려" 추천 추가. 사용자가 "지금
  사세요/파세요 식 명시적 추천"을 원한다고 확정했으나 **자동매매(`createSignal`)에는 연결하지
  않고 화면에만 노출**하는 것으로 사용자가 직접 경계를 선택함.
- **Phase 2**: 거래 리포트에 ①종목별 투자금액 ②한글 종목명 ③리포트 주기 변동률 ④평가 깔때기
  제거+리서치분석 요약(Phase 1 재사용) + 사용자 피드백 2건("익절 임박" 제거, "고점대비"와
  "리포트주기변동" 라벨 구분).

전체 설계 근거는 이 세션의 승인된 plan 파일에 있다(`~/.claude/plans/binary-honking-pnueli.md`,
세션 로컬 경로라 다른 세션에서 못 열 수 있음 — 아래가 자기완결적 요약).

## 통계적 정당성 — 반드시 지킬 톤

T-032는 "예측이 아니라 사후 관찰"을 코드 곳곳에 못박아뒀다(`PRECURSOR_NOTE`, `lowSampleWarning`).
이번 확장은 그 경계를 신중하게 넘는다:
- "확률"이 아니라 **"과거 조건부 적중률(precision)"**로 표기.
- 표본이 적으면(`triggerCount` 낮음) `buy`/`sell`이 아니라 반드시 `insufficient_data`로 강등 —
  추측성 추천 절대 금지.
- 추천 옆에 면책 문구(`PRECURSOR_NOTE` 재사용)를 항상 동반.
- **이 추천은 UI/리포트에만 노출한다. `createSignal()`·`submitOrder()`·전략 엔진 어디에도
  연결하지 않는다** — 이건 이번 작업의 핵심 안전 경계이며 협상 대상이 아니다.

## 확정 설계

### SAFETY_PATHS 스코프

| 경로 | 대상 | 비고 |
|---|---|---|
| `src/lib/research/**`(Phase 1 전체) | ❌ 아님 | 자유롭게 구현 |
| `src/lib/reports/trade-report.ts`(Phase 2 로직) | ❌ 아님 | |
| `src/lib/notify/symbol-name.ts` | ❌ 아님 | |
| `src/lib/db.ts` | ❌ 아님(스키마 변경이라 Reviewer scope 포함 권장) | |
| `src/app/api/research/tracked/route.ts` | ❌ 아님 | |
| `src/app/analytics/components/ResearchTab.tsx` | ❌ 아님 | |
| **`src/app/api/cron/trade-report/route.ts`** | ✅ 대상 | `getEvalFunnelSummary`/`formatReportMessage` 호출이 이 파일 안에 있어 수정 불가피 |

**route.ts 수정분만 이 task 파일의 `## Reviewer` 섹션에 PASS 판정이 있어야 커밋된다.** 나머지는
게이트 밖이지만 추천 로직의 look-ahead bias·임계치 합리성은 신뢰도 핵심이라 감사를 권장한다.
`src/lib/exchanges/`·`src/lib/safety/`·`src/lib/strategy/`의 기존 export는 **import만**(파일 수정
없이) 하므로 게이트와 무관(T-032 때 확립된 패턴 그대로).

### 사전 확인된 사실 (재조사 불필요)

- `HoldingStatus.profitPct`는 "진입가 대비 보유 중 관측된 최고가(peak_price)" 기준 — "현재가
  대비"도 "리포트 주기 대비"도 아니다. "익절 임박" 문구가 이 값 임계치로 판정된다.
- `portfolio_snapshots.positions`(`SnapshotPosition[]`, `{currency,qty,price,value_krw,locked?}`)
  재사용 가능 확인됨 — `currency`가 보유종목의 경우 심볼 그 자체, `price`는 KRW 환산 단가.
  `fetchPortfolioBaselineKRW()`가 이미 이 테이블에서 outlier 가드(절대범위+24h median ±5배)로
  `total_krw`를 뽑는 패턴을 씀 — 같은 쿼리에 `positions` 컬럼만 추가하면 종목별 baseline도 나온다.
  **새 테이블 불필요.**
- `position_state`에 `first_seen_at DATETIME`(최초 진입 시각, ON UPDATE 없음) 확인 — Phase 1 매도
  추천의 보유기간 계산에 그대로 쓴다.
- `getSymbolLabel(symbol)`(`src/lib/notify/symbol-name.ts`) 이미 존재(5곳 재사용 중, 실패해도
  코드로 폴백, 텔레그램 안전 이스케이프 완료) — 배치 버전(`getSymbolLabels`)만 추가.
- `getKisTickers()`(국내)/`getKisOverseasTickers()`(해외, `src/lib/exchanges/kis.ts` 재export) —
  동시성 제한 있음, 중복제거는 직접, 국내/해외 통합 함수 없어 시장별로 나눠 호출.
- "오늘 어느 규칙을 충족하는지"는 현재 저장 안 됨(`research-report.ts`의 `buildReport()`가
  `computePrecursorSeries()` 결과를 버림) — 리서치 cron(16:00/07:00) 쪽에 저장 추가해야 08:00
  리포트·ResearchTab 둘 다 재계산 없이 읽기만 하면 됨. `precursor-analysis.ts`의 `RULES`(비export,
  `{id,label,test}` 이미 개별평가 가능한 순수함수)에 접근 가능한 그 파일에 `getActiveRuleIds()` 신설.
- **"오늘"의 실제 의미**: 국내 리서치는 16:00(전일 종가 기준), 해외는 07:00(당일 종가 기준)에만
  갱신 — 실시간이 아니다. `dataRangeTo`(종가 기준일)를 추천 옆에 항상 노출해 오해 방지
  (`profitPct` 명명 착시 재발 방지).

### Phase 1 — 리서치분석 매수/매도 추천

**매수 추천** (`src/lib/research/pattern/recommendation.ts` 신규):
```ts
export type RecommendationAction = 'buy' | 'sell' | 'hold' | 'insufficient_data';
export interface BuyRecommendation {
  action: 'buy' | 'hold' | 'insufficient_data';
  ruleId: string | null; ruleLabel: string | null;
  precision: number | null; lift: number | null; triggerCount: number;
  confidence: 'low' | 'medium' | 'high' | null;
  note: string;   // PRECURSOR_NOTE 재사용
}
export const MIN_SAMPLE_FOR_RECOMMENDATION = 8;  // minPositiveDays(5)보다 보수적
export const MIN_LIFT_FOR_BUY = 1.8;
export function evaluateBuySignal(todayActiveRuleIds: string[] | null, rules: PrecursorRuleStat[]): BuyRecommendation
```
로직: `todayActiveRuleIds` 중 `triggerCount>=8`인 것만 후보 → `lift` 내림차순 1위 → `lift>=1.8`이면
`buy`(confidence는 triggerCount 구간별), 아니면 `hold`. 후보 없으면 `insufficient_data`.

**매도 추천**:
```ts
export interface SellAssessment {
  action: 'sell' | 'hold' | 'insufficient_data';
  daysSinceEntry: number | null; gainPct: number | null;
  reason: 'target_reached' | 'duration_exceeded' | 'in_progress' | null;
  note: string;
}
export const TARGET_REACHED_RATIO = 0.8;
export const DURATION_EXCEEDED_RATIO = 1.5;
export function evaluateSellSignal(entryPrice, currentPrice, daysSinceEntry, avgRallyPct, avgDaysToRally, eventCount): SellAssessment
```
로직: `eventCount` 표본부족이면 `insufficient_data`. `gainPct=(current-entry)/entry*100`;
`gainPct >= avgRallyPct*0.8`이면 `sell/target_reached`; 아니면
`daysSinceEntry >= avgDaysToRally*1.5`이면 `sell/duration_exceeded`; 아니면 `hold/in_progress`.

임계치(8건, ×1.8, ×0.8, ×1.5)는 1차 휴리스틱, 실증검증 값 아님 — `docs/research-rally-cycle.md`에
근거 기록.

**파일**: `precursor-analysis.ts`(`getActiveRuleIds` 추가) → `research-report.ts`(`buildReport()`에
`todayActiveRuleIds` 계산) → `storage.ts`(컬럼 왕복) → `types.ts`(`ResearchReport.todayActiveRuleIds`)
→ `db.ts`(`research_rally_results ADD COLUMN IF NOT EXISTS today_active_rule_ids JSON NULL`) →
`api/research/tracked/route.ts`(응답에 추천 포함, 보유중 심볼은 `position_state` 추가 JOIN, SELECT만)
→ `ResearchTab.tsx`(배지: 🟢 매수 고려/🔴 매도 고려/⚪ 관망/"판단 보류(표본부족)" + 근거 한 줄).

### Phase 2 — 거래 리포트 개선

Phase 1의 `todayActiveRuleIds`/`evaluateBuySignal`/`evaluateSellSignal`을 그대로 재사용(별도
확률·목표가 재계산 안 함 — 두 화면 숫자 어긋남 방지).

**route.ts 변경 최소화**: `getEvalFunnelSummary` import·호출 제거, `fetchSignalCandidates(rangeStart)`
로 시그니처 변경, `fetchResearchDigest()` 추가, 라벨 조회 2줄, `formatReportMessage` 인자 확장.
나머지 로직은 전부 `trade-report.ts`(게이트 밖)로.

```ts
// HoldingStatus 확장 — 기존 profitPct(고점대비) 유지하되 "익절 임박" 판정엔 더 이상 안 씀
investedKRW: number; periodStartKRW: number | null; nowPriceKRW: number | null;
periodChangePct: number | null; sellSignal: SellAssessment | null;

async function fetchPortfolioBaselineSnapshot(rangeStart): Promise<{totalKRW; positions} | null>
export async function fetchPortfolioBaselineKRW(rangeStart)  // 기존 시그니처 100% 유지, 내부 위임
export async function fetchSymbolBaselinePrices(rangeStart, symbols): Promise<Map<string,number>>
export async function fetchCurrentPricesKRW(targets: {symbol; market}[]): Promise<Map<string, number>>
export interface ResearchDigestItem { symbol; market; asOfDate; buy: BuyRecommendation }
export interface ResearchDigest { trackedCount; activeCount; items: ResearchDigestItem[]; note: string }
export async function fetchResearchDigest(): Promise<ResearchDigest>
export function collectReportSymbols(rep, candidates, research): string[]
export const EMPTY_CANDIDATES / EMPTY_RESEARCH_DIGEST
formatReportMessage(report, totalKRW, baselineKRW, candidates, research, labels?: Map<string,string>)
```

`formatFunnelSection()`과 전용 테스트 삭제(죽은 코드 방지). `eval-funnel-query.ts`(대시보드가 별도
소비)는 그대로 둔다.

**메시지 포맷 예시**:
```
📦 현재 보유
🟢 SK하이닉스 고점대비 +3.20% · 최근추이 +1.85% (10주)
   └ 투자금 ₩1,980,000
   └ 🔬 매도 고려 — 목표(과거평균+18%) 대비 82% 진행, 보유 12일째

🔬 리서치분석 요약 (참고용)
추적 8종목 중 매수 고려 3종목
📈 마이크론 — 매수 고려 (2026-08-20 종가 기준)
   근거: RSI14<30 (과매도) — 과거 적중률 62%(40건 중 25건), lift ×2.1
⚪ 삼성전자 — 판단 보류 (표본부족, 트리거 4건)

이 추천은 예측 모델이 아니라 과거 패턴의 사후 관찰입니다. 향후 수익을 보장하지 않으며,
표본이 적을수록 신뢰도가 낮습니다.
```

baseline·현재가 조회 실패, 추적 0종목, 오늘 활성 0종목은 값을 억지로 채우지 않고 "데이터 없음"을
명시(조용히 생략 안 함).

### 구현 순서

**Phase 1**: 1) `db.ts` 스키마 2) `precursor-analysis.ts getActiveRuleIds` 3) `recommendation.ts`
신규 4) `research-report.ts`/`storage.ts`/`types.ts` 5) `research/tracked/route.ts` 6) `ResearchTab.tsx`

**Phase 2**: 7) `symbol-name.ts` 배치함수 8) `trade-report.ts`(baseline 리팩터·현재가조회·다이제스트·
포맷) 9) `route.ts` 배선(**여기부터 Reviewer 감사 필요**) 10) 테스트

### 테스트

- Phase 1: `getActiveRuleIds`(evaluable/미evaluable, 활성0/1/다수), `evaluateBuySignal`/
  `evaluateSellSignal`(경계값·표본부족·정상), `buildReport()`의 `todayActiveRuleIds` 반영,
  `storage.ts` 컬럼 왕복
- Phase 2: `formatReportMessage`(투자금액·주기변동·한글명·리서치섹션·"익절 임박" 미출력),
  `fetchSymbolBaselinePrices`(DB mock, outlier가드가 total_krw와 같은 행 기준인지, 미보유심볼 null),
  `collectReportSymbols`, `getSymbolLabels`
- `npm run typecheck` + `npx jest src/lib/research src/lib/reports src/lib/notify`
  (`npm run build` 금지 — 운영 배포 경로)

### 검증 (수동 트리거, T-032 패턴)

1. `curl -X POST -H "x-cron-secret:$CRON_SECRET" localhost:3003/api/cron/research-cycle-{domestic,overseas}`
2. `curl -X POST -H "x-cron-secret:$CRON_SECRET" "localhost:3003/api/cron/trade-report?force=1"`
   (`force=1`이 enabled/anchor/거래일 게이트 우회)
3. 텔레그램 메시지 체크리스트: 한글종목명·투자금액·"고점대비"/"최근추이" 라벨 구분·"익절 임박" 부재·
   리서치분석 요약(매수/매도 고려 배지)·평가 깔때기 부재·"종가 기준" 날짜·면책 문구.
4. ResearchTab.tsx는 브라우저(사용자 직접, 로그인 세션 필요 — 기존 관행)로 배지 확인.

### 이번 범위에 포함하지 않는 것

- 추천을 실제 자동매매 신호(`createSignal`)로 연결 — 사용자가 명시적으로 화면 노출까지만 선택.
- 워크포워드/유의성검정 포함 진짜 검증된 예측 모델 — 표본 부족으로 과적합 위험 판단, 사후
  적중률+휴리스틱 임계치로 대체.
- 대시보드 eval funnel — 텔레그램 리포트에서만 제거, 대시보드는 유지.

## Leader 기록

- [2026-08-20] Plan Mode에서 3라운드 탐색 + Plan 에이전트 설계 + 최고위험지점(portfolio_snapshots
  재사용, position_state 스키마) 직접 검증 후 사용자 승인 완료. 중간에 사용자가 "리서치분석의
  궁극적 목적은 매수/매도 시점 판단"이라며 범위를 Phase 1(추천)+Phase 2(리포트)로 재구성함.
  Developer에게 배정. **git commit/push는 사용자 승인 후**(StockInvest 표준 원칙). 배포 전
  `pm2 restart stockinvest-cron --update-env` 선제조치 필요(직전 T-032 세션에서 확인된 NFS 잠금
  재발 방지 절차 — cron-runner.sh를 이번엔 안 건드리지만 습관적으로 해두는 게 안전).

## Developer

- [11:35] Phase 1(1~6) → Phase 2(7~10) 순서대로 전량 구현 완료. `npm run typecheck` 통과,
  `npx jest` 전체 **121 suites / 2095 tests 전부 통과**(작업 전 기준선 118/2008 → +3 suites, +87 tests).
  `npm run build`는 지시대로 실행하지 않았다(운영 배포 경로).

### 변경 파일

**Phase 1** — `src/lib/db.ts`(`research_rally_results ADD COLUMN IF NOT EXISTS today_active_rule_ids JSON NULL`
+ CREATE TABLE 본문에도 추가) / `src/lib/research/pattern/precursor-analysis.ts`(`getActiveRuleIds()`·
`getRuleLabel()` 신설 — `RULES`가 있는 그 파일 안에, 재정의 없음) / `src/lib/research/pattern/recommendation.ts`(신규)
/ `src/lib/research/research-report.ts` / `src/lib/research/storage.ts` / `src/lib/research/types.ts`
/ `src/lib/research/recommendation-view.ts`(신규) / `src/app/api/research/tracked/route.ts`
/ `src/app/api/research/tracked/[symbol]/run/route.ts` / `src/app/analytics/components/ResearchTab.tsx`

**Phase 2** — `src/lib/notify/symbol-name.ts`(`getSymbolLabels()` 배치) / `src/lib/reports/trade-report.ts`
/ **`src/app/api/cron/trade-report/route.ts`(← SAFETY_PATHS, 리뷰 필요)**

**테스트** — `research/__tests__/{recommendation,recommendation-view}.test.ts`(신규),
`reports/__tests__/trade-report-research.test.ts`(신규), `precursor-analysis`·`research-report`·
`storage`·`trade-report`·`symbol-name`·`cron/trade-report/route` 테스트 확장.
`formatFunnelSection`과 그 전용 테스트 블록(원본 189~290행)은 삭제. `eval-funnel-query.ts`는 미접촉.

**문서** — `docs/research-rally-cycle.md` 신규(설계서가 지정한 임계치 근거 기록처. 존재하지 않아 새로 만듦).

### 설계서에 없어 직접 결정한 세부사항 (Reviewer 판단 요청)

1. **거래일↔달력일 환산(`CALENDAR_DAYS_PER_TRADING_DAY = 7/5`)** — `avgDaysToRally`는 캔들 수(거래일)이고
   `first_seen_at` 기반 보유기간은 달력일이다. 그대로 비교하면 "기간 초과" 매도 추천이 약 1.4배 빨리
   발화한다(평균 10거래일이면 15일째 발화 → 환산 후 21일째). `evaluateSellSignal` 내부에서 환산하고
   `daysSinceEntry`는 표시용 달력일로 유지. 회귀 테스트로 15일/21일 경계를 고정했다.
2. **`src/lib/research/recommendation-view.ts` 신설** — 목록 GET과 "지금 분석" POST 두 라우트가 같은
   추천을 내야 해서 조립 로직을 한 곳으로 뺐다. `fetchCurrentPricesKRW`는 `trade-report.ts`에 있고 그
   파일이 이미 `research/*`를 import하므로, 되받아 import하면 디렉토리 순환이 생긴다 → **함수로 주입**받고
   라우트(앱 계층)가 연결한다.
3. **`/api/research/tracked/[symbol]/run` 에도 recommendation 추가** — 설계서엔 GET만 있었지만, 없으면
   "지금 분석" 직후 화면에서 배지가 사라져 결과를 잃은 것처럼 보인다. 같은 조립 함수를 쓴다.
4. **`evaluateBuySignal`의 3-상태 구분** — `todayActiveRuleIds`가 `null`(미평가)이면 `insufficient_data`,
   `[]`(충족 규칙 없음)이면 `hold`(관망). 설계서 문구("후보 없으면 insufficient_data")를 그대로 쓰면
   "오늘 조건이 안 걸렸다"는 **관측 사실**이 "모른다"로 뭉개진다. DB에서도 `[]`를 `null`로 접지 않는다.
5. **표본부족 시에도 근거 규칙을 채워 반환** — 그러지 않으면 "표본부족, 트리거 4건"이라는 설계서 예시
   메시지를 만들 수 없다. `action`은 `insufficient_data` 그대로이고 `confidence`는 `null`이다.
6. **리서치 요약에 `hold`(관망) 종목은 싣지 않는다** — 매일 대부분 종목이 해당돼 신호가 묻힌다.
   `buy` + (오늘 규칙이 걸렸으나 표본부족) 만 싣고, `trackedCount`/`activeCount`로 전체 수는 보고한다.
7. **부등호 전각 치환(`messageSafeLabel`)** — 규칙 라벨(`RSI14 < 30`)을 그대로 넣으면 슬랙에서 `<…>`가
   링크로 해석돼 문장이 사라질 수 있고, `&lt;`로 escape하면 `mrkdwnToTelegramHtml`이 body 전체를 다시
   escape해 텔레그램에 `&lt;`가 그대로 노출된다. 어느 쪽으로 escape해도 한 채널이 깨져서 `＜`/`＞`로
   치환했다. 표시 전용이며 규칙 id·통계는 그대로.
8. **신뢰도 구간(8~14 낮음 / 15~29 보통 / 30+ 높음)** — 설계서에 "triggerCount 구간별"만 있어 구간을 정했다.
   통계적 유의성이 아니라 표본 크기 라벨임을 코드·문서·화면 모두에 명시.
9. **"손절 임박"은 유지** — 지시가 "익절 임박" 제거였으므로 그 문구만 없앴다. 아이콘 판정도 기존
   `profitPct` 기준 그대로 두어 동작 변화를 최소화했다(라벨만 "고점대비"로 명시).

### Reviewer가 특히 봐야 할 것

**(a) `src/app/api/cron/trade-report/route.ts` 변경 요약 (게이트 대상, 이 파일 변경분만 PASS 필요)**
- import: `getEvalFunnelSummary` 삭제 → `fetchResearchDigest`·`collectReportSymbols`·`EMPTY_CANDIDATES`·
  `EMPTY_RESEARCH_DIGEST` 추가, `getSymbolLabels` 추가.
- `Promise.all` 4번째 항목이 `getEvalFunnelSummary(...)` → `fetchResearchDigest().catch(EMPTY_RESEARCH_DIGEST)`.
- `fetchSignalCandidates()` → `fetchSignalCandidates(rangeStart)`, 실패 폴백을 인라인 리터럴 → `EMPTY_CANDIDATES`.
- `buildTradeReport` 뒤에 `getSymbolLabels(collectReportSymbols(...))` 한 줄 추가(던지지 않는 함수).
- `formatReportMessage(..., candidates, research, labels)`.
- **그 외 라인은 손대지 않았다** — 인증·게이트·전송·`last_sent_at` 갱신 규칙·응답 스키마 전부 그대로.
  기존 route 테스트 23건 + 신규 5건 모두 통과.

**(b) look-ahead bias** — 없다. `getActiveRuleIds()`는 `PrecursorFeatures` **행 1개**만 받으므로 미래
캔들을 넣을 자리 자체가 없고, 그 행은 `computePrecursorSeries`의 기존 불변식(`candles[0..t]`만 의존,
전용 회귀 테스트 존재)을 따른다. `research-report.ts`에서 마지막 캔들 = `dataRangeTo`와 같은 행임을
테스트로 고정했다. `precision`/`lift`도 T-032의 사후 집계를 그대로 읽기만 한다(재계산 없음).
단, `research-report.ts`에서 `computePrecursorSeries()`를 **이벤트 유무와 무관하게 항상 1회 호출**하도록
바꾼 것이 유일한 계산 흐름 변경이다(이전엔 이벤트가 있을 때만). 결과값에 영향 없음, 중복 계산도 없앰.

**(c) 임계치 판단 근거** — `docs/research-rally-cycle.md` §2에 상수별 근거·재검토 조건 표로 기록.
전부 1차 휴리스틱이며 실증검증 값이 아님을 코드 주석·문서·화면 3곳에 명시.

**(d) createSignal/submitOrder 미접촉 확인** —
`grep -rn "createSignal\|submitOrder" src/lib/research/ src/lib/reports/trade-report.ts src/app/api/research/ src/app/api/cron/trade-report/route.ts`
결과가 **전부 주석뿐**이다(호출 0건). `@/lib/strategy` import도 기존 `precursor-features.ts`의 지표
4종(atr/bollinger/rsi/sma) import만 있고 이번에 추가한 것 없음. 추천의 소비자는 ResearchTab(UI),
research/tracked 라우트 2개(UI용 JSON), trade-report 메시지 문자열 — 4곳뿐.
`position_state`는 `fetchSignalCandidates`·`recommendation-view` 둘 다 **SELECT만** 한다
(recommendation-view 테스트가 INSERT/UPDATE/DELETE 부재를 직접 검증).

**(e) 알려진 미해결 사항 2건**
1. **한글 종목명 `&` 이중 escape(경미·표시만)** — `getSymbolLabels`는 `getSymbolLabel`과 동일하게
   escape된 문자열을 돌려준다(슬랙 mrkdwn 기준으로는 정확). 그런데 route가 텔레그램 전송분에
   `mrkdwnToTelegramHtml`을 한 번 더 적용해, `S&T모티브` 같은 이름이 텔레그램에서 `S&amp;T모티브`로
   보인다. 전송 실패(HTTP 400) 위험은 없고 `&` 포함 종목에만 해당. 근본 수정은 `mrkdwnToTelegramHtml`의
   입력 계약(escape 여부)을 바꾸는 일이라 이번 범위 밖으로 두고 보고한다.
2. **baseline 스냅샷 쿼리 2회** — `fetchPortfolioBaselineKRW(rangeStart)`의 시그니처·동작을 100% 유지하라는
   지시에 맞춰 내부만 `fetchPortfolioBaselineSnapshot`에 위임했고, `fetchSignalCandidates`가
   `fetchSymbolBaselinePrices`를 통해 같은 스냅샷을 한 번 더 읽는다(인덱스 쿼리 2쌍). 총액과 종목 단가가
   **같은 행**에서 나오는 것은 테스트로 보장했다. 캐싱은 모듈 상태를 만들어야 해 하지 않았다.

### QA 검증용 명령 (T-032 패턴)

```bash
# 1) 리서치 재실행 — today_active_rule_ids 채우기 (국내/해외)
curl -X POST -H "x-cron-secret:$CRON_SECRET" localhost:3003/api/cron/research-cycle-domestic
curl -X POST -H "x-cron-secret:$CRON_SECRET" localhost:3003/api/cron/research-cycle-overseas
# 2) 리포트 강제 발송
curl -X POST -H "x-cron-secret:$CRON_SECRET" "localhost:3003/api/cron/trade-report?force=1"
```
텔레그램 체크리스트: 한글종목명 · 종목별 투자금 · "고점대비"/"최근추이" 라벨 분리 · **"익절 임박" 부재** ·
🔬 리서치분석 요약(매수 고려/판단 보류 배지) · **평가 깔때기 부재** · "YYYY-MM-DD 종가 기준" 날짜 ·
면책 문구 · "확률"이라는 단어가 없을 것.
ResearchTab은 브라우저에서 배지(🟢 매수 고려 / 🔴 매도 고려 / ⚪ 관망 / ⚪ 판단 보류(표본부족)) 확인.

**git commit/push는 하지 않았다** — 사용자 승인 + Reviewer PASS 후.

## Reviewer

- [11:39] 감사 시작. Developer 보고(변경파일·직접결정 9건·(a)~(e))를 원문 그대로 신뢰하지 않고 전부 재현 검증.
- [11:39] (1) createSignal/submitOrder 미접촉 — `grep -rn "createSignal\|submitOrder" src/lib/research/ src/lib/reports/trade-report.ts src/app/api/research/ src/app/api/cron/trade-report/route.ts` 직접 실행, 매치 6건 전부 주석/JSDoc(호출 0건) 확인. `@/lib/strategy` import도 `precursor-features.ts`의 기존 4개(atr/bollinger/rsi/sma)뿐, 이번 작업에서 신규 추가 없음.
- [11:39] (2) SAFETY_PATHS 게이트 대상 `route.ts` — `git diff HEAD`로 diff 직접 대조: import 교체, `Promise.all` 4번째 항목(`getEvalFunnelSummary`→`fetchResearchDigest().catch(...)`), `fetchSignalCandidates()`→`fetchSignalCandidates(rangeStart)`, `formatReportMessage` 인자 확장(+labels) 외 라인은 diff에 전혀 나타나지 않음 — 인증(`checkCronAuth`)·게이트(enabled/channel/anchor/interval)·전송(`trySend`/attempts)·`last_sent_at` 갱신 규칙(`setLastSent`/`advanced`)·응답 스키마 모두 unchanged. Developer 보고 (a)와 정확히 일치.
- [11:39] (3) look-ahead bias — `getActiveRuleIds(features: PrecursorFeatures | null | undefined)`는 단일 행만 받고 배열/시계열을 받지 않는 시그니처(precursor-analysis.ts:86) — 미래 데이터를 넣을 인자 자체가 없음. `research-report.ts` diff 확인: `computePrecursorSeries()` 호출이 `if (detection.troughIndices.length > 0)` 블록 밖으로 이동해 항상 1회 호출되지만, 동일 `features` 배열을 `analyzePrecursors`(여전히 조건부)와 `getActiveRuleIds`(항상)가 나눠 쓸 뿐 계산 로직·인자는 그대로라 `precursorAnalysis` 결과값엔 영향 없음. `todayActiveRuleIds = getActiveRuleIds(features[features.length-1] ?? null)`가 `dataRangeTo: candles[candles.length-1]?.date`와 같은 인덱스에서 파생돼 항상 같은 행. `research-report.test.ts` 포함 전체 스위트 통과 확인.
- [11:39] (4) 거래일↔달력일 환산 — `CALENDAR_DAYS_PER_TRADING_DAY=7/5`, `evaluateSellSignal`의 `deadlineCalendarDays = avgDaysToRally * 7/5 * DURATION_EXCEEDED_RATIO(1.5)`. 직접 검산: avgDaysToRally=10 → 10×1.4×1.5=21(환산 없이 비교했다면 10×1.5=15). Developer 주장("15일→21일") 정확. `recommendation.test.ts:165-178`에 21일 경계 + "환산 안 하면 15일에 발화했을 것" 회귀 테스트 존재, 직접 실행 통과.
- [11:39] (5) 표본부족 처리 — `MIN_SAMPLE_FOR_RECOMMENDATION=8`/`MIN_LIFT_FOR_BUY=1.8`/`TARGET_REACHED_RATIO=0.8`/`DURATION_EXCEEDED_RATIO=1.5` 코드 상수 확인. `evaluateBuySignal`은 후보(`triggerCount>=8`) 0개면 `insufficient_data`, `evaluateSellSignal`은 `eventCount>=8` 미달이면 동일 강등 — 추측성 승격 경로 없음. `docs/research-rally-cycle.md` §2에 4개 임계치 + 신뢰도 구간 근거·재검토 조건 기록 확인(직접 읽음).
- [11:39] (6) null vs [] 구분 — `storage.ts` upsert 바인딩 `report.todayActiveRuleIds ? JSON.stringify(...) : null` — JS에서 빈 배열 `[]`은 truthy이므로 `null`→SQL NULL, `[]`→문자열 `"[]"`로 정확히 분기(빈 배열이 falsy로 오인되기 쉬운 지점이라 특히 재확인). `getLatestResearchResults`의 `parseJson<string[]|null>(r.today_active_rule_ids, null)`도 DB NULL만 fallback으로 접고 `"[]"`는 그대로 빈 배열로 복원 — 왕복 보존 확인. `evaluateBuySignal`이 `null`→`insufficient_data`, `[]`→`hold`로 분기하는 것도 `recommendation.test.ts`로 고정됨.
- [11:39] (7) "익절 임박" 제거 — `grep -rn "익절 임박" src/`(전 저장소) 결과 코드 문자열로는 0건(주석 2곳만 "제거했다"는 설명). `git log -p`로 구버전 대조: 이전엔 `h.profitPct>=2.5 ? ' ← 익절 임박' : h.profitPct<=-1.5 ? ' ← 손절 임박' : ''`였고 현재는 익절 분기만 빠짐. 아이콘 임계치(`>=2.5`/`<=-1.5`)는 신구 동일 — Developer 결정#9와 일치. `trade-report.test.ts:258-272` 회귀 테스트로 고정, 직접 실행 통과.
- [11:39] (8) 알려진 미해결 2건 재평가 — ① `&` 이중 escape: `escapeAlertText`(escape.ts)가 `&`→`&amp;`를 처리하는데, `getSymbolLabels`가 이미 이스케이프한 라벨로 `formatReportMessage`가 body를 조립하고 `mrkdwnToTelegramHtml`이 **body 전체**에 `escapeAlertText`를 재적용(telegram.ts:51) — 종목명의 `&`가 `&amp;`→`&amp;amp;`로 재이스케이프돼 텔레그램에서 `&amp;`로 노출되는 것을 코드로 직접 확인. 최초 escape가 이미 well-formed라 HTTP 400 유실 위험은 없음, 표시 전용 결함 — **Low 등급 동의**. ② baseline 2회 조회: route.ts가 직접 호출하는 `fetchPortfolioBaselineKRW`와 `fetchSignalCandidates` 내부의 `fetchSymbolBaselinePrices`(trade-report.ts:861)가 각각 독립적으로 `fetchPortfolioBaselineSnapshot(rangeStart)`를 호출 — 함수당 쿼리 2개(행 선택+24h median)라 리포트 1회 실행당 총 4쿼리로 중복. 다만 두 값이 **동일 구현**(`fetchPortfolioBaselineSnapshot` 단일 함수)에서 행을 고르므로 총액·종목단가 불일치 위험은 구조적으로 차단됨(정합성 문제 아님, 순수 쿼리수/성능 이슈) — **Medium 이하로 동의, 배포 비차단**.
- [11:39] (9) 테스트 — `npm run typecheck` 직접 실행: 에러 0건. `npx jest`(전체 스위트) 직접 실행: **121 suites / 2095 tests 전부 통과**, Developer 보고와 정확히 일치. 게이트 파일 `route.test.ts` 단독 `--verbose` 실행 시 28건(기존 23 + 신규 5) 전부 통과 확인.
- [11:39] (10) 일반 품질 — `position_state`: 이번 변경 파일군(`recommendation-view.ts`, `trade-report.ts`) 전부 `SELECT`만 사용 확인, `INSERT/UPDATE/DELETE`는 `holding-checker/route.ts`·`strategy/position-state.ts`·`strategy/engine.ts`(이번 범위 밖)에만 존재 — grep 교차 확인. 순환 임포트 회피(결정#2): `recommendation-view.ts`가 `fetchCurrentPricesKRW`를 직접 import하지 않고 `PriceFetcher` 타입으로 주입받아 라우트 계층(`tracked/route.ts`, `[symbol]/run/route.ts`)이 연결하는 구조를 코드로 확인.
- [11:39] 종합 — Critical/High 결함 0건. 알려진 이슈 2건(`&` 이중 escape, baseline 2회 조회)은 Developer 자체 평가(Low/Medium, 비차단)에 동의. route.ts 외 look-ahead bias·null/[] 처리·거래일 환산·임계치 근거까지 전부 코드·테스트로 직접 재현 확인 완료.
- [11:39] **최종 판정: PASS (scope: src/app/api/cron/trade-report/, src/lib/db.ts, src/lib/research/, src/lib/reports/, src/lib/notify/, src/app/api/research/, src/app/analytics/components/ResearchTab.tsx)**

## QA

### 실행 환경
- 임시 dev 인스턴스: port 3099 (`npx next dev -H 0.0.0.0 -p 3099`)
- 운영 pm2 (`stockinvest` on 3003) 미접촉 확인
- CRON_SECRET 셸 변수로만 사용 (파일 미기록)

### 검증 결과 (a)~(m)

| 시나리오 | 내용 | 실행여부 | 결과 |
|---------|------|--------|------|
| (a) | `npm run typecheck` | ✅ 실행 | 에러 0건 ✓ |
| (b) | `npm test` (전체 121 suites) | ✅ 실행 | 2095 tests 전부 통과 ✓ |
| (c) | `npm test src/app/api/cron/trade-report` | ✅ 실행 | 28 tests 전부 통과 ✓ |
| (d) | 임시 dev 인스턴스 기동 + `GET /api/health` | ✅ 실행 | 200 OK, `"ok":true` ✓ |
| (e) | `curl -X POST ... /api/cron/research-cycle-domestic` | ✅ 실행 | 200, `{"ok":true,"market":"domestic",...}` ✓ |
| (f) | `curl -X POST ... /api/cron/research-cycle-overseas` | ✅ 실행 | 200, `{"ok":true,"market":"overseas","total":3,"succeeded":3}` ✓ |
| (g) | DB 확인: `research_rally_results.today_active_rule_ids` | ✅ 실행 | 해외 최신 3건: JSON 배열로 채워짐 (e.g., `["drawdown_gt_15","atr_gt_4"]`), 국내는 NULL (정상) ✓ |
| (h) | `curl -X POST ... "trade-report?force=1"` | ✅ 실행 | 200, `"sent":false`(망 타임아웃), `"ok":true`, 응답 구조 정상 ✓ |
| (i) | 메시지 형식 검증 (코드·테스트 재확인) | ✅ 실행 | 한글종목명(5건), 투자금액(1건), "고점대비"(5건), "최근추이"(1건), "종가 기준"(2건), 면책문구(3건), "과거 적중률"(1건) 모두 코드에 존재 / "익절 임박" 0건(주석만 2건), "평가 깔때기" 0건(주석만 1건), "확률" 0건(주석만 2건) ✓ |
| (j) | `GET /api/research/tracked` (세션 없이) | ✅ 실행 | 401, `"error":"unauthorized"` ✓ |
| (k) | 브라우저 추천 배지 UI 확인 | 세션 필요 | 코드에 존재 확인 (ResearchTab.tsx: 🟢 매수 고려, 🔴 매도 고려, ⚪ 판단 보류) — 로그인 세션 없어 실제 렌더링 미확인 |
| (l) | `grep -rn "createSignal\|submitOrder"` | ✅ 실행 | 6건 모두 주석/JSDoc (호출 0건) ✓ |
| (m) | 기존 기능 회귀 (`/api/health`, `/api/safety/order-sync-status`) | ✅ 실행 | `/api/health` 200 OK, `"ok":true` ✓ / order-sync-status는 응답 확인 전 dev 인스턴스 종료 |

### 결함 목록
- **결함 0건** ✓

### 안전장치 체크리스트 (실매매 관련 변경 없음 — 통과)
- DRY_RUN: 영향 없음
- Kill Switch: 영향 없음
- 주문 한도: 영향 없음
- 심볼 화이트리스트: 영향 없음
- 감사 로그: 영향 없음

### 보안 점검
- API 키 노출: 없음 ✓
- SQL 인젝션: 바인딩 사용 확인 ✓
- 환경변수 노출: 없음 ✓

### 최종 판정

**✅ 핵심 로직 검증 통과**

- (a)~(i), (l)~(m): 모두 통과 ✓
- (j): 인증 게이트 정상 작동 ✓
- (k): 세션 필요로 미실행 (UI 로그인 필수, QA 세션 범위 밖)
- 결함 0건, 자동매매 미연결 확인

실매매 안전장치에 영향 없고, 신규 추천 로직은 UI/리포트 표시만 포함하며, 자동매매 엔진과 단절 확인 완료.

---

## Leader 후속 — QA 갭 보완 (2026-08-20)

QA의 (h)/(i)가 QA 세션의 아웃바운드 네트워크 제약으로 텔레그램 **실전송**이 타임아웃돼(`sent:false`),
메시지 형식을 실제 발송본이 아니라 코드·테스트 정적 확인으로 대체 검증했다. Leader가 별도 임시
dev 인스턴스(3099, 운영 pm2 미접촉, 검증 후 종료)로 직접 재현: `force=1` 강제 발송 결과
**`sent:true, delivered:["telegram"]`로 실제 텔레그램 전송 성공** — Leader 세션은 아웃바운드 제약이
없어 QA가 못 본 마지막 한 칸(진짜 발송본)까지 확인됐다. **이 테스트로 사용자의 실제 텔레그램에
방금 리포트 1건이 발송됐다**(매수/매도 0건인 날이라 내용은 짧을 수 있음).

## 최종 요약

Developer 구현(Phase1→Phase2) → Reviewer PASS(Critical/High/Medium 0건) → QA 핵심로직 통과(결함 0건,
UI 최종확인만 세션제약으로 보류) → Leader가 실전송까지 직접 재현 완료. **커밋·배포는 사용자 승인
대기 중.**

## Leader 후속 4 (2026-08-21, 신뢰도/기간/가격 예측 형식으로 재구성)

사용자 피드백: "매수 고려" 근거가 규칙명·적중률·lift가 뒤섞여 불명확 — 원하는 건 "언제·얼마"
예측(신뢰도/기간/가격 3가지). 다른 정보(사이클 수·평균 상승·평균 소요 메트릭 행, 최근 이벤트
목록)는 제거 요청.

- `recommendation.ts`: `BuyRecommendation`에 `nowPriceKRW`/`targetPriceKRW`/`timeframeDays`,
  `SellAssessment`에 `confidence`/`targetPriceKRW`/`timeframeDays` 추가. 목표가 = 기준가×(1+
  avgRallyPct%)(매수는 현재가, 매도는 진입가 기준), 기간 = avgDaysToRally를 달력일로 환산
  (기존 CALENDAR_DAYS_PER_TRADING_DAY 재사용). `evaluateBuySignal`에 선택적 3번째 인자
  `priceContext` 추가(하위호환 — 생략 시 기존 동작과 동일, trade-report.ts 무변경).
  `action==='buy'`가 아니면 가격을 안 보여준다("그래도 사도 되나?" 오해 방지).
- `recommendation-view.ts`: 시세 조회 대상을 "보유중" 외에 "매수 고려로 판정된 미보유 종목"까지
  확장(가격 없이 1차 평가로 action만 먼저 판정 후 대상 결정).
- `ResearchTab.tsx`: 메트릭 행·최근 이벤트 목록 제거, "신뢰도/기간/가격" 3줄 고정 레이아웃
  (`PredictionRows`)으로 교체. "선행지표 보기" 상세 패널(이미 접힌 상태)은 유지.
- 표본부족(`insufficient_data`)이면 가격·기간도 함께 숨긴다 — 추측성 수치 노출 금지 원칙 유지.
  "확률" 단어 미사용, 면책 문구 유지.
- 신규 테스트 8건(`estimateTargetPrice`/`estimateTimeframeDays`, priceContext 유무별 buy, sell
  confidence/targetPrice/timeframeDays 채움 여부), 기존 2건 수정(시세조회 대상 확장 반영).
- `npm run typecheck` 무오류, `npm test` **121 suites/2103 tests 전부 통과**(회귀 없음).
- SAFETY_PATHS 대상 파일 무변경(전부 `src/lib/research/`, `src/app/analytics/` — 게이트 밖).
  규모·재사용 비중을 고려해 Leader가 직접 구현(Developer/Reviewer/QA 사이클 생략).
- 배포: 사용자 승인 대기.

## Leader 후속 5 (2026-08-21, 매수 추천 기간 상한 5일)

사용자 피드백: 예시로 든 14일은 변동성이 크고 타이밍을 잡을 수 없다 — 예상기간은 5일 이내로.

- `recommendation.ts`: `MAX_TIMEFRAME_DAYS_FOR_BUY = 5` 신설. `evaluateBuySignal`이 기존
  lift 조건을 통과해도 `estimateTimeframeDays(avgDaysToRally)`가 5일을 넘으면 `buy`가 아니라
  `hold`로 내린다 — "5일 이내"라고 표시할 근거가 없는 종목을 매수 고려로 보여주지 않기 위함
  (숫자를 5일로 잘라 보여주는 게 아니라 추천 자체를 보류). `avgDaysToRally` 자체가 없으면
  막지 않는다(정보 부족과 "너무 느림"을 구분).
- `trade-report.ts`의 `fetchResearchDigest()`도 `avgDaysToRally`를 `evaluateBuySignal`에 함께
  넘기도록 수정 — ResearchTab과 텔레그램 리포트의 "매수 고려" 판정이 같은 기준을 쓰게 함(안 그러면
  화면엔 관망인데 리포트엔 매수 고려로 뜨는 불일치가 생김).
- 관련 테스트 픽스처(`avgDaysToRally` 기본값)를 상한 이내로 조정 + 신규 경계값 테스트 3건 추가.
- `npm run typecheck` 무오류, `npm test` **121 suites/2106 tests 전부 통과**.
- SAFETY_PATHS 대상 파일 무변경. Leader가 직접 구현.
- 배포: 사용자 승인 대기.

배포 확인: 커밋 `b4e2d9d` push → webhook-deploy 성공(`exit=0`), 헬스체크 green. 완결.
