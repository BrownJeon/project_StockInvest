---
task_id: T-035
title: 해외 종목의 종목별 금액을 USD로 표기 (리서치분석 + 텔레그램 리포트)
status: doing
roles_involved: [leader, developer, reviewer, qa]
related_tasks: [T-032, T-033, T-034]
tags:
  - type/task
  - domain/research
  - domain/reports
created: 2026-08-23
updated: 2026-08-23
---

## 배경 (사용자 요청)

T-034 배포 후 사용자가 리서치분석 화면을 보고 요청:

> "리서치분석도 마찬가지이지만 **해외 주식에 대한 금액 표기는 원화가 아닌 달러로** 표기해줘."

현재 상태 — **목표가는 이미 원통화(해외 USD)로 나오는데 진입가·현재가만 KRW**라 한 줄 안에서
통화가 섞여 보인다:

```
매도  $427.08 · 볼린저 상단(20,2) · 내 진입가 ₩669,858 대비 -11.5%
보유  진입가 ₩669,858 · 현재가 ₩553,109 (-17.8%) · 16일째
```

## 적용 범위 (사용자 확정)

**리서치분석 화면 + 텔레그램 거래 리포트의 "종목별 금액"만.**

- ✅ 대상: 리서치분석 진입가·현재가, 리포트 보유종목 투자금·진입가 등 **종목 단위 금액**
- ❌ 제외: **포트폴리오 전체 금액**(총자산·기간 손익 합계 등) — 국내·해외가 섞여 있어 원화 유지가
  맞다. 사용자도 이 전제에 동의했다.
- 참고: 즐겨찾기(`FavoritesPage`)는 **이미 USD로 표시 중**이라 대상 아님.

## 🔴 핵심 난점 — 진입가는 DB에 KRW로만 있다

`position_state.entry_price`·`portfolio_snapshots.positions[].price` 는 **항상 KRW**다.
`kis-overseas.ts` 가 KIS 의 USD 원가(`pchs_avg_pric`)를 **KRW 로 환산해서** 저장하기 때문에
원본 USD 진입가는 어디에도 남아 있지 않다. 따라서 USD 표시는 **역산**해야 한다.

### 확보 가능한 재료 (조사 완료)

- `Ticker.priceUsd`(`src/lib/exchanges/types.ts:52`) — **해외 종목의 환산 전 USD 현재가**.
  `kis-overseas.ts:127` 이 `Number(o.last)` 로 채운다. 같은 응답의 `price`(KRW)와 **동일 시점**
  쌍이라 여기서 그 시점 환율을 정확히 얻을 수 있다.
- `fetchCurrentPricesKRW()`(`src/lib/reports/trade-report.ts:757`)는 현재 `Map<string, number>`(KRW)만
  반환한다 — USD 를 함께 돌려주도록 확장이 필요하다.

### 권장 방식 (Developer 최종 판단)

**같은 시점 KRW/USD 쌍에서 환율을 얻어 역산**한다:

```
진입가_USD = 진입가_KRW × (현재가_USD / 현재가_KRW)
                            └─ 같은 Ticker 응답에서 온 동일 시점 쌍
```

⚠ 근사임을 인지할 것: 이건 **현재 환율로 환산한 값**이지 매수 시점 환율이 아니다. 진입 후 환율이
크게 움직였다면 실제 매수 당시 USD 단가와 다르다. **화면·리포트 문구나 주석에 이 성격을 드러내고,
"매수 당시 체결가"라고 단정하지 말 것.**

대안(참고): `asOfPrice`(분석기준일 종가 USD) / `nowPriceKRW` 비율을 쓰는 방법도 있으나 두 값의
**시점이 달라** 오차가 더 크다. `priceUsd` 를 쓰는 쪽이 낫다.

🔴 **절대 금지**: `fx.ts` 의 현재 환율로 임의 환산하거나, KRW 값과 USD 값을 **직접 더하거나 비교**
하는 코드. T-034 가 "환산 코드가 없으면 통화를 섞을 경로 자체가 없다"는 구조적 차단을 택했으므로,
이번에 환산을 도입하는 이상 **어디서 환산이 일어나는지 한 곳으로 모으고** 그 함수에 근거·한계를
주석으로 남긴다.

## 표시 규칙

- 국내: `₩669,858` (변경 없음)
- 해외: `$481.23` — 기존 `formatTargetPrice(price, currency)`(`price-targets.ts`)를 재사용해
  목표가와 **같은 포맷터**를 쓴다(두 값의 표기가 어긋나지 않게).
- 통화를 판별할 수 없거나 USD 역산이 불가능하면(현재가 조회 실패 등) **KRW 로 폴백**하고
  그 사실이 드러나게 한다 — 숫자를 지어내거나 통화 기호만 바꾸는 일은 절대 금지.

## 유지할 안전 경계 (T-033·T-034에서 확립, 협상 불가)

- 이번 작업은 **표시 전용**이다. 매수/매도 판정 로직·목표가 계산에 손대지 않는다.
- `createSignal()`·`submitOrder()`·`src/lib/strategy/` 연결 0건 유지.
- `position_state` 는 SELECT 만.
- "확률" 단어 미사용, 면책 문구 유지.
- `src/app/api/cron/trade-report/route.ts` **무변경 유지가 목표**(SAFETY_PATHS — 건드리면
  Reviewer PASS 필요). 로직은 `trade-report.ts`(게이트 밖)에서 해결할 것.

## 검증

- `npm run typecheck` + `npm test` (기준선 **122 suites / 2151 tests**, `npm run build` 금지)
- 신규 테스트: USD 역산 함수(정상·현재가 결측·0/음수 방어·국내 종목은 역산 안 함),
  포맷 분기(해외 `$`, 국내 `₩`, 폴백)
- 🔴 회귀: **KRW 와 USD 를 더하거나 비교하는 코드가 없음**을 테스트로 고정
- 실데이터: `NAS:SNPS`(보유·추적 중, 진입가 KRW 669,858)에서 진입가가 `$` 로 나오고 값이
  타당한 범위인지 확인. 국내 보유(`005930`·`000660`)는 계속 `₩` 인지도 확인
- 배포 전 `pm2 restart stockinvest-cron --update-env`

## Leader 기록

- [2026-08-23] 사용자 요청 접수 → 범위(리서치분석 + 리포트 종목별 금액, 포트폴리오 합계 제외)를
  사용자에게 확인받음 → `Ticker.priceUsd` 로 USD 확보가 가능함을 코드로 확인 후 설계.
  Developer 배정. **git commit/push 는 사용자 승인 후.**

## Developer

- [13:40] 사양·T-034 `## Developer` §"통화 = 환산하지 않고 원통화 유지" 정독 → **왜 환산을 막았는지**
  (환산 코드가 없으면 통화를 섞을 경로 자체가 없다는 구조적 차단) 확인 후 착수.

### 구현 — 환산 지점을 딱 하나로 모았다

**신규 `src/lib/display-amount.ts`** — 🔴 KRW→USD 산술이 일어나는 **유일한 파일**.

```
usdPerKrwFromQuote({krw, usd})  → usd / krw            ← 환율 계산은 이 함수 하나뿐
toDisplayAmount(amountKRW, currency, quote) → DisplayAmount { value, currency, basis, sourceKRW }
```

- `SymbolQuote {krw, usd}` = **같은 KIS 응답에서 나온 동일 시점 쌍**(`price` = `last × fx`,
  `priceUsd` = `last`). 이 쌍의 비만이 "그 가격에 실제 적용된 환율"이므로 `fx.ts` 의 현재 환율을
  쓰지 않았다(시세와 환율의 시점이 어긋나면 원화·달러 표기가 서로 모순된다).
- `basis` 3종으로 **성격이 값에 붙어 다닌다**: `krw_native`(국내, 환산 없음) /
  `usd_converted`(현재 환율 환산 — 🔴 매수 당시 체결가 아님) / `krw_fallback`(역산 불가 → 원화).
- `sourceKRW` 로 환산 전 원화를 함께 들고 다녀 화면이 "지어낸 숫자가 아님"을 보일 수 있게 했다.

**시세 조회 확장** — `fetchCurrentQuotes()`(신규, `trade-report.ts`)가 KRW/USD 쌍을 돌려주고,
기존 `fetchCurrentPricesKRW()` 는 그 위의 **얇은 래퍼**로 남겨 시그니처·기존 소비자를 보존했다.
`resolveMarket()` 헬퍼를 뽑아 **시세 라우팅과 통화 판별(`currencyForMarket`)이 같은 답**을 쓰게 했다.

**소비 지점 2곳(표시 조립부)만 환산 함수를 부른다**
- `recommendation-view.ts` → `HoldingContext.display {entryPrice, nowPrice}`
- `trade-report.ts` → `HoldingStatus.display {invested}`
판정(`evaluateSellSignal`)·손익률(`gainPct`)·고점대비(`profitPct`)·최근추이(`periodChangePct`)·
포트폴리오 합계는 **전부 KRW 원본 그대로**이고 환산값과 접점이 0이다. 목표가 계산은 무변경.

### 화면·리포트 문구 (한계를 드러낸 방법)

- 진입가·현재가·투자금 모두 목표가와 **같은 포맷터** `formatTargetPrice(price, currency)` 사용.
- 리서치분석 — 보유 블록 아래에 조건부 문구 `fxNote` 추가:
  > 달러 금액은 현재 시세 기준 환율로 환산한 값입니다 — 진입가 ₩669,858(원화 기록)의 환산본이며
  > **매수 당시 체결가가 아닙니다.**
  `basis === 'usd_converted'` 일 때만 뜬다. 원화 원본을 그 문구 안에 같이 노출한다.
- 텔레그램 — `투자금 $11,130.19 (원화 ₩15,406,743 · 현재 환율 환산)`.
- 역산 불가 시 — 화면 `$…` 대신 `₩669,858(달러 환산 불가)`, 리포트
  `투자금 ₩10,717,728 (달러 환산 불가 — 원화 표시)`. **숫자를 지어내거나 기호만 바꾸지 않는다.**

### 직접 결정한 사항 (사양이 위임했거나 사양과 어긋난 부분)

1. **리포트의 "진입가"는 환산 대상이 아니었다.** 사양은 "리포트 보유종목 투자금·진입가"라 했으나
   실제 리포트가 **금액으로** 찍는 건 `투자금` 한 줄뿐이고, 진입가는 `진입가 대비 -17.8%` 라는
   **비율**로만 나온다(비율은 KRW끼리라 통화 무관). 새 금액 줄을 만드는 건 표시 설계 변경이라
   하지 않았다 — 필요하면 Leader 판단. `HoldingDisplay` 주석에 이 사실을 적어 뒀다.
2. **매도 손익(`sellPnl`) 종목별 금액은 KRW 유지.** 이미 청산된 포지션이라 **역산에 쓸 동일 시점
   시세 쌍이 없고**, 실현 손익은 실제로 계좌에 찍힌 원화다. 오늘 환율로 바꾸면 근거 없는 값이 된다.
3. **`PriceFetcher` → `QuoteFetcher` 로 타입 교체**(KRW 단일값 → 쌍). 주입 지점 라우트 2개
   (`/api/research/tracked`, `.../[symbol]/run`)를 함께 수정. 둘 다 SAFETY_PATHS 밖이다.
4. **`fmtMarketPrice`(`src/lib/format.ts`)를 쓰지 않았다.** 이건 **하드코딩 기본 환율 1380**
   (호출부가 별도 조회한 `fxRate` 주입)로 나누는 **기존의 다른 환산 경로**로, 대시보드·시나리오·
   즐겨찾기가 쓴다. 사양이 금지한 "별도 환율" 방식이라 통합하지 않고 분리 유지했다 —
   ⚠ **Reviewer 확인 요청**: 워크스페이스에 환산 경로가 2개(신규 시세쌍 방식 / 기존 fxRate 방식)
   공존한다. 통합은 범위 밖이라 판단했으나 이견 있으면 지시 바람.

### 🔴 통화 혼용 회귀를 테스트로 고정한 방법 (3중)

1. **차원 일관성**(`display-amount.test.ts`) — 환율을 k배로 바꾸면 ① KRW 표시값은 **불변**,
   ② USD 표시값은 **정확히 k배**. 상수 KRW 항이 한 톨이라도 섞이면 비례가 깨져 실패한다.
   `recommendation-view.test.ts` 에도 같은 성질을 판정·`gainPct`·목표가에 대해 걸었다.
2. **경계 봉인**(`currency-mixing-fence.test.ts`, 신규) — `usdPerKrwFromQuote` / `toDisplayAmount(` /
   `priceUsd` 를 언급하는 **파일 목록 자체를 고정**한다. 환산·USD 원가에 손대는 파일이 하나라도
   늘면 즉시 실패 → 새 지점은 반드시 리뷰를 거친다. (즐겨찾기 3종은 T-035 이전부터의 별개 경로라
   목록에 명시적으로 남겼다.)
3. **소스 스캔**(같은 파일) — 캔들 통화 값(`asOfPrice`/`sellTarget`/`buyZone`/`atr14`/`expectedMove`)과
   `*KRW` 식별자가 **한 줄에서 산술·비교 연산자로 만나는지** 검사. 휴리스틱 백스톱이며,
   아래 4가지를 실제로 심어 **전부 검출됨을 확인**했다:
   `asOfPrice - entryPriceKRW` / `entryPriceKRW < (sellTarget.price ?? 0)` /
   `(nowPriceKRW ?? 0) + (atr14 ?? 0)` / `(buyZone.price ?? 0) >= (entryPriceKRW ?? 0)`.

### 안전 경계 — 유지 확인

- 판정·목표가 계산 **무변경**. `createSignal()`·`submitOrder()`·`src/lib/strategy/` 연결 0건.
- `position_state` **SELECT 만**. "확률" 미사용, 면책 문구 유지.
- **`src/app/api/cron/trade-report/route.ts` 무변경** — 로직 전부 `trade-report.ts`(게이트 밖)에서
  해결. `src/lib/exchanges/`·`safety/`·`strategy/` 는 **import 도 추가하지 않았다**(무변경).
- 변경 파일 중 SAFETY_PATHS 해당 **0건**.

### 검증

| 항목 | 결과 |
|---|---|
| `npm run typecheck` | ✅ 무오류 |
| `npm test` | ✅ **124 suites / 2188 tests 전부 통과** (기준선 122/2151 → +2 suites / +37 tests) |
| `npm run build` | 실행 금지 준수 — 단, 아래 사고 복구를 위해 **HEAD 상태로만** 1회 실행 |

**실데이터**(운영 DB + 실 KIS 시세, 2026-08-23 14:0x, 환율 1,384.23):

| 심볼 | 진입가(DB, KRW) | 표시 | basis | 현재가 |
|---|---|---|---|---|
| `NAS:SNPS` | 669,858 | **$483.92** | usd_converted | $397.87 |
| `NAS:SMH` | 786,243 | **$568.00** | usd_converted | $560.42 |
| `NYS:ORCL` | 239,707 | **$173.17** | usd_converted | $146.47 |
| `005930` | 331,500 | **₩331,500** | krw_native | ₩281,500 |
| `000660` | 2,641,000 | **₩2,641,000** | krw_native | ₩1,730,000 |

화면이 받는 실제 문자열:
```
매도  $427.08 · 볼린저 상단(20,2) · 내 진입가 $483.92 대비 -11.7%
보유  진입가 $483.92 · 현재가 $397.87 (-17.8%) · 18일째
```
(이전: `내 진입가 ₩669,858` / `진입가 ₩669,858 · 현재가 ₩553,109` — 한 줄 통화 혼재 해소)

리포트 보유 섹션: 해외 3종 `투자금 $1,136.00 / $1,039.02 / $11,130.19 (원화 … · 현재 환율 환산)`,
국내 2종 `투자금 ₩2,983,500 / ₩2,641,000`. **해외는 전부 `$`, 국내는 전부 `₩`** 확인.

### 🔴 사고 보고 — dev 인스턴스 기동으로 운영 `.next` 를 덮어썼다 (복구 완료)

- **원인**: 실데이터 UI 확인용으로 `next dev -p 3099` 를 **저장소 루트에서** 기동했다.
  pm2 `stockinvest` 는 같은 디렉토리의 `next start` 라 **`.next/` 를 공유**한다 —
  dev 산출물이 운영 빌드를 덮어써 `BUILD_ID` 가 사라졌다. 포트를 3099 로 나눠도 **빌드 디렉토리는
  분리되지 않는다**(`distDir` 미설정). 사양의 "포트 3099" 지시만 보고 이 공유를 놓쳤다.
- **영향**: 실행 중이던 프로세스는 계속 응답했으나(3003 health 200 내내 유지), **다음 재시작 시
  `next start` 가 프로덕션 빌드를 찾지 못해 실패**할 상태였다.
- **복구**: `git stash push -u` 로 T-035 변경을 전부 치운 뒤 **HEAD(`1ec363a`, 현재 배포 커밋)
  상태에서만** `next build` 1회 실행 → `.next/BUILD_ID` 재생성 → `git stash pop`.
  즉 **새 코드는 한 줄도 빌드에 들어가지 않았다.** pm2 는 `restart`·`stop` 모두 하지 않았고
  `stockinvest`(pid 323029)·`stockinvest-cron`(pid 303711) 은 처음부터 끝까지 그대로다.
- **복구 검증**: `.next/BUILD_ID` 존재, 3003 `/api/health` 200 · `/login` 200,
  `git diff` 가 stash 전 백업 패치와 **바이트 단위 일치**, 신규 파일 4개 `cmp` 일치,
  typecheck 무오류 + `npm test` 124/2188 재통과.
- **재발 방지 제안(Leader 판단)**: 이 저장소에서 dev 서버를 띄우려면 `distDir` 을 분리해야 한다.
  예) `NEXT_DIST_DIR=.next-dev` 를 읽는 `next.config.js` + `npm run dev:safe`.
  포트 분리만으로는 안전하지 않다는 것을 문서(CLAUDE.md 검증 절차)에 명시할 것을 권한다.
- 임시 dev 인스턴스·임시 테스트 파일(`src/__tests__/t035-realdata.tmp.test.ts`)·스크래치 백업은
  모두 제거했다. `git status` 에 T-035 산출물 외 잔재 없음.

### Reviewer 가 특히 봐야 할 것

- **(a) 🔴 환산이 정말 한 곳인가** — `currency-mixing-fence.test.ts` 의 파일 목록이 그 주장이다.
  목록에 있는 즐겨찾기 3종(기존 경로)과 신규 경로가 섞이지 않았는지.
- **(b) 🔴 판정에 환산값이 새지 않았는가** — `display` 필드가 `evaluateSellSignal`·`gainPct`·
  `periodChangePct`·`profitPct`·포트폴리오 합계 어디에도 들어가지 않는지. 위 결정 §2(sellPnl KRW 유지) 포함.
- **(c) 근사의 고지가 충분한가** — `fxNote`(화면)·`(원화 … · 현재 환율 환산)`(리포트)가
  "매수 당시 체결가가 아님"을 사용자에게 실제로 전달하는지. 문구 톤은 Leader 취향 반영 가능.
- **(d) 폴백 경로** — 해외인데 `priceUsd` 결측/시세 실패 시 `krw_fallback` 이 화면·리포트에서
  각각 어떻게 보이는지(테스트로 고정돼 있음). 폴백을 조용히 숨기지 않는지.
- **(e) 위 사고 복구가 정말 무해했는지** — 빌드가 HEAD 에서만 이뤄졌음, pm2 무접촉.
- **(f) 결정 §4** — 환산 경로 2개 공존(신규 시세쌍 / 기존 `fmtMarketPrice` fxRate) 허용 여부.

### 변경 파일

| 파일 | 변경 |
|---|---|
| `src/lib/display-amount.ts` | **신규** — 유일한 환산 지점 |
| `src/lib/__tests__/display-amount.test.ts` | **신규** — 환산·폴백·차원 일관성 21건 |
| `src/lib/__tests__/currency-mixing-fence.test.ts` | **신규** — 통화 혼용 경계 봉인 4건 |
| `src/lib/reports/trade-report.ts` | `fetchCurrentQuotes` 신설 + `HoldingStatus.display` + 투자금 표기 |
| `src/lib/research/recommendation-view.ts` | `QuoteFetcher` + `HoldingContext.display` |
| `src/app/analytics/components/ResearchTab.tsx` | 진입가·현재가 통화 표기 + `fxNote` |
| `src/app/api/research/tracked/route.ts` | 주입 함수 교체 |
| `src/app/api/research/tracked/[symbol]/run/route.ts` | 주입 함수 교체 |
| `src/lib/reports/__tests__/trade-report.test.ts` | 픽스처 + 해외/국내/폴백 3건 |
| `src/lib/reports/__tests__/trade-report-research.test.ts` | `fetchCurrentQuotes` 계약 4건 |
| `src/lib/research/__tests__/recommendation-view.test.ts` | 쌍 헬퍼 + 해외/국내/폴백/회귀 5건 |

- [14:20] 구현·검증 완료. **git commit/push 는 하지 않았다**(사용자 승인 후). Reviewer 인계.

## Reviewer

- [15:05] Developer 보고를 신뢰하지 않고 실제 코드·테스트·명령 실행으로 전부 재현했다. 아래는 그 결과다.
- [15:06] **(1) 환산 지점이 정말 하나인가 — 확인.** `grep -rn 'usd\s*/\s*krw|krw\s*/\s*usd|\*\s*fx\b|fxRate'` 등으로 전체 `src/`를 훑어 KRW↔USD 산술이 `src/lib/display-amount.ts` 밖에 있는지 봤다. 있는 건 전부 무관한 기존 경로(`kis-overseas.ts`의 `* fx`는 KIS 응답을 KRW로 만드는 원래 로직, `fmtMarketPrice`/`useFxRate`는 별개의 기존 대시보드 경로 — 아래 (7)(c) 참조)뿐이었다. `usdPerKrwFromQuote`·`toDisplayAmount(` 호출부도 직접 grep해 `currency-mixing-fence.test.ts`가 주장하는 파일 목록과 바이트 단위로 일치함을 확인했다(환율 함수는 `display-amount.ts` 1곳, 조립 호출부는 그 파일 자신 + `trade-report.ts` + `recommendation-view.ts` 2곳).
- [15:07] **봉인 테스트가 공허하지 않다 — 확인.** `currency-mixing-fence.test.ts`는 단순 파일목록 스냅샷이 아니라 소스 트리를 직접 walk해서 `usdPerKrwFromQuote`/`toDisplayAmount(`/`priceUsd` 각각을 포함하는 실제 파일 목록을 지금 계산해 하드코딩된 목록과 비교한다 — 새 지점이 생기면 실제로 실패하는 구조다(스냅샷이 아니라 라이브 스캔).
- [15:08] **소스 스캔 정규식이 실제로 위반을 잡는지 — 별도 스크립트로 독립 재현했다.** task 파일이 언급한 4개 위반(`asOfPrice - entryPriceKRW`, `entryPriceKRW < (sellTarget.price ?? 0)`, `(nowPriceKRW ?? 0) + (atr14 ?? 0)`, `(buyZone.price ?? 0) >= (entryPriceKRW ?? 0)`)을 스크래치 파일에서 정규식만 뽑아 직접 테스트 — 4건 전부 `true`(검출됨). false positive 대조군(`targetVsEntryPct(sellTarget?.price, targets?.asOfPrice, sell?.gainPct)` — 비율 함수 호출, `gainPct` 계산식 — KRW끼리, 주석)은 전부 `false`(오탐 없음). 휴리스틱이지만 실효성 있다고 판단.
- [15:10] **판정 로직 무변경 — 확인.** `git diff --stat -- src/lib/research/pattern/price-targets.ts src/lib/research/pattern/recommendation.ts`가 완전히 비어 있다(0줄 변경). `evaluateSellSignal`/`evaluateBuySignal`은 두 소비 지점(`recommendation-view.ts` 149~183행, `trade-report.ts` 1008~1017행) 모두에서 KRW 원본(`entryPriceKRW`/`currentPriceKRW`/`p.entryKRW`/`nowPriceKRW`)만 받고, `display` 블록은 그 호출 **뒤에** 조립된다(주석 "판정이 끝난 뒤 표시값에만 적용한다"가 실제 코드 순서와 일치).
- [15:11] **`SellPnl`(매도 손익) — KRW 유지 확인.** `SellPnl` 인터페이스에 `display` 필드가 추가되지 않았고 `pnlKRW` 계산부도 무변경이다. Developer 결정 §2와 일치.
- [15:12] **리포트 "진입가"가 금액이 아니라는 결정 §1 — 확인.** `grep -n 진입가 trade-report.ts` → 유일한 실제 출력은 `진입가 대비 ${fmtSignedPct(s.gainPct, 1)}` (471행), 즉 비율뿐. 새 금액 줄이 추가되지 않았다. 타당한 판단.
- [15:14] **정직성 — 폴백·고지 문구 확인.** `toDisplayAmount()`는 역산 불가(USD 결측/0/음수/시세 실패) 시 `basis: 'krw_fallback'`으로 KRW 원본 그대로 반환(숫자 조작 없음, `display-amount.test.ts`가 항등 검증). `ResearchTab.tsx`의 `fxNote`는 `isFxConverted()`가 참일 때만(즉 `usd_converted`일 때만) 뜨고 "매수 당시 체결가가 아닙니다"를 원화 원본과 함께 노출한다. 리포트(`trade-report.ts`)의 `formatDisplayAmount()`도 동일 원칙 — `(원화 … · 현재 환율 환산)` / `(달러 환산 불가 — 원화 표시)`. 테스트(`trade-report.test.ts` 신규 3건, `recommendation-view.test.ts` 신규 4건)가 이 문구·폴백 경로를 모두 고정.
- [15:15] **차원 일관성(회귀) — 실효성 재확인.** `display-amount.test.ts`의 "환율 k배 → USD 값 정확히 k배, KRW 값 불변" 테스트와 `recommendation-view.test.ts`의 "환율이 2배가 되어도 `sell.action`/`sell.reason`/`sell.gainPct`/`sellTarget.price`/`entryPriceKRW`는 완전히 동일, 표시 USD 값만 정확히 2배" 테스트를 읽었다 — 상수 KRW 항이 섞이면 반드시 비례가 깨져 실패하는 구조라 이름값을 한다.
- [15:16] **`fetchCurrentPricesKRW` 하위호환 — 확인.** 새 `fetchCurrentQuotes()` 위의 얇은 래퍼(`quotes.get(symbol).krw`만 추출)로 남아 있고 시그니처(`Promise<Map<string, number>>`)가 그대로다. `trade-report-research.test.ts`에 하위호환 전용 테스트 추가돼 있고 실행 통과.
- [15:18] **SAFETY_PATHS 대조 — 확인.** `awk '/^SAFETY_PATHS=\(/,/^\)/' scripts/git-hooks/commit-msg`로 뽑은 정규식 목록과 `git status --porcelain` 변경 파일 전부를 대조 — 매치 0건. `src/app/api/cron/trade-report/route.ts`는 `git status`에 아예 나타나지 않는다(무변경 확인). `src/lib/safety/`·`src/lib/exchanges/`·`src/lib/strategy/`도 변경 파일 목록에 없다.
- [15:19] **안전 경계 — 확인.** `createSignal`/`submitOrder`/`src/lib/strategy/` grep 결과는 전부 "연결돼 있지 않다"고 설명하는 주석뿐(실제 import·호출 0건). `position_state`는 변경된 두 파일(`recommendation-view.ts`/`trade-report.ts`) 어디에도 INSERT/UPDATE/DELETE가 없다(SELECT만, 기존 테스트가 쿼리 개수까지 검증). "확률" 단어는 변경 파일에서 전부 "쓰지 않는다"는 설명문 안에서만 등장(실사용 0건). 면책 문구("위 보유 정보는 참고용이며…")는 그대로 유지, `fxNote`가 그 아래 추가로만 붙는다.
- [15:22] **(7)(c) 하드코딩 환율 1380 공존 — 위험도 평가.** `src/lib/format.ts`의 `fmtMarketPrice(price, market, fxRate = 1380)`는 이번 작업과 **무관한 기존 경로**다. 실제 호출부(`Dashboard.tsx`, `ScenarioBuilder.tsx`, `ScenarioDetail.tsx`, `recommend/page.tsx`)는 전부 `useFxRate()` 훅에서 받은 값을 명시적으로 넘기고, 그 훅은 `/api/fx`를 호출해 5분 캐시하며 실패 시에만 1380 기본값으로 떨어진다 — 즉 "하드코딩"이라기보다 "라이브 조회 + 폴백 상수"다. T-035의 `display-amount.ts`(같은 시세 응답의 KRW/USD 쌍에서 역산)와는 근본적으로 다른 정확도 특성을 가진 **별개의, T-035 이전부터 존재하던** 변환 경로이며, 대상 화면도 겹치지 않는다(대시보드/시나리오/추천 페이지 vs 리서치분석/리포트). 두 경로 공존 자체는 판정·주문에 영향이 없는 표시 전용 중복이라 **CRITICAL/HIGH 아님** — 다만 유지보수 관점에서 "동일 개념(KRW→USD 표시 변환)을 만드는 방법이 두 가지"라는 기술부채는 실재한다. **MEDIUM(비차단)으로 기록**: 통합은 이번 범위 밖이 맞다고 판단하지만, 다음에 이 경로들을 만질 일이 있으면 `display-amount.ts` 패턴(시세쌍 역산 + basis 노출)으로 흡수하는 것을 권고.
- [15:24] **검증 명령 직접 실행 — 결과 일치.** `npm run typecheck` → 오류 0건. `npm test` → **124 suites / 2188 tests 전부 통과**(Developer 보고와 정확히 일치, 조작 없음).
- [15:26] **사고 복구 완전성 — 확인.** `.next/BUILD_ID` 존재, `.gitignore`에 `.next/` 등록돼 있어 `git status`에 빌드 산출물 없음. `find`로 `t035-realdata.tmp.test.ts` 등 임시 파일 잔재 없음 확인. `git diff --stat`이 task 파일이 적은 변경 파일 목록·8개 diff 내용과 일치 — stash pop이 온전함. pm2 `jlist`로 `stockinvest`(pid 323029)·`stockinvest-cron`(pid 303711) 조회 — pid가 보고와 정확히 일치하고 이 리뷰 세션 동안 재시작되지 않았다(**pm2 restart/stop을 이 리뷰에서도 실행하지 않았다** — 읽기 전용 `pm2 jlist`만 사용). `curl localhost:3003/api/health`·`/login` 모두 200 — 운영 앱 정상 서비스 중.
- [15:27] **결함 없음.** Critical 0 / High 0 / Medium 1(§(7)(c) 환산 경로 2개 공존 — 비차단, 향후 통합 권고) / Low 0.
- [15:27] **최종 판정: PASS (scope: src/lib/display-amount.ts, src/lib/__tests__/display-amount.test.ts, src/lib/__tests__/currency-mixing-fence.test.ts, src/lib/research/recommendation-view.ts, src/lib/research/__tests__/recommendation-view.test.ts, src/lib/reports/trade-report.ts, src/lib/reports/__tests__/trade-report.test.ts, src/lib/reports/__tests__/trade-report-research.test.ts, src/app/analytics/components/ResearchTab.tsx, src/app/api/research/tracked/route.ts, src/app/api/research/tracked/[symbol]/run/route.ts)**

## QA — Leader 대행 (2026-08-23)

**별도 QA 서브에이전트를 소집하지 않고 Leader 가 검증을 수행했다.** 사유:

1. **dev 서버 금지로 QA 의 고유 가치가 사라졌다.** 이 작업 중 실제로 `next dev -p 3099` 가 운영
   `.next` 를 덮는 사고가 났고(§Developer 참조), 그 결과 [[RESUME]] 제약 절에 **dev 서버·build
   금지**를 못박았다. 기존 QA 라운드의 고유 기여는 "임시 인스턴스로 API·화면 확인"이었는데 그
   수단이 금지됐다. 남는 것(typecheck·test·grep·DB 조회)은 Reviewer 가 이미 **전부 독립 재현**했다.
2. 이 변경은 **표시 전용**이다 — 판정 로직 diff 0줄(Reviewer 확인), 실매매 경로 무접촉.
3. 브라우저 실화면 확인은 이 프로젝트 기존 관행대로 **배포 후 사용자가 실기기로** 한다.

### Leader 실데이터 검산 — 보유 5종목 전수

| 심볼 | 시장 | DB 진입가(KRW) | 표시 | 판정 |
|---|---|---|---|---|
| 000660 | domestic | 2,641,000 | ₩2,641,000 | KRW 유지 ✓ |
| 005930 | domestic | 331,500 | ₩331,500 | KRW 유지 ✓ |
| NAS:SMH | overseas | 786,242.64 | $568.00 | USD 환산 ✓ |
| NAS:SNPS | overseas | 669,858.38 | $483.92 | USD 환산 ✓ |
| NYS:ORCL | overseas | 239,707.11 | $173.17 | USD 환산 ✓ |

(환율 1,384.23 = 같은 KIS 응답의 KRW/USD 쌍에서 얻은 값. 국내 2종목은 환산 대상이 아니므로
그대로, 해외 3종목만 USD 로 바뀐다 — 사용자 요청 범위와 정확히 일치.)

### 남은 확인 (사용자 몫)

배포 후 실기기에서 리서치분석 카드의 진입가·현재가가 해외 종목에서 `$` 로 뜨는지 육안 확인.
텔레그램 리포트는 다음 정기 발송(08:00) 또는 `force=1` 수동 발송으로 확인 가능.

### 최종 판정

**검증 통과** — 실데이터 5종목 전수에서 통화 분기가 의도대로 동작. 결함 0건.
