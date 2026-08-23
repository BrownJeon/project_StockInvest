/**
 * 종목별 금액을 **표시할 통화로 바꾸는 유일한 지점** — T-035.
 *
 * ## 🔴 왜 이 파일이 하나뿐이어야 하는가
 *
 * T-034 는 "환산 코드가 없으면 KRW·USD 를 섞을 경로 자체가 존재하지 않는다"는 **구조적 차단**을
 * 택했다(`price-targets.ts` 헤더 참조). 목표가는 지금도 그 원칙 그대로 원통화로만 흐른다.
 *
 * T-035 에서 사용자가 "해외 종목의 금액은 달러로 보여달라"고 요청하면서 **진입가·현재가·투자금에
 * 한해** 환산을 도입했다. 환산이 생긴 이상 그 안전망이 약해지므로, 대신 다음 규율을 둔다:
 *
 *  1. KRW → USD 산술은 **이 파일 안에서만** 일어난다. 다른 파일은 `toDisplayAmount()` 의
 *     결과(값 + 통화)를 받아 **표시만** 한다.
 *  2. 환산 결과는 절대 판정·집계에 쓰지 않는다. 손익률(`gainPct`)·고점대비(`profitPct`)·
 *     포트폴리오 합계는 전부 KRW 끼리 계산하며 이 모듈과 접점이 0이다.
 *  3. 환산에 실패하면 **KRW 로 폴백**하고 그 사실을 `basis` 로 드러낸다. 숫자를 지어내거나
 *     통화 기호만 바꾸지 않는다.
 *
 * ## 🔴 환율을 어디서 얻는가 — `fx.ts` 의 현재 환율을 쓰지 않는 이유
 *
 * KIS 해외 시세 응답 하나가 **같은 시점의 KRW 가격과 USD 원가를 쌍으로** 준다
 * (`kis-overseas.getTicker()` → `price` = `Number(o.last) * fx`, `priceUsd` = `Number(o.last)`).
 * 이 쌍의 비(`usd / krw`)가 곧 그 시세에 실제로 적용된 환율이므로, 별도로 조회한 환율보다
 * **정확히 그 가격에 대응**한다. 별도 환율을 곱하면 시세와 환율의 시점이 어긋나 원화 표기와
 * 달러 표기가 서로 모순되는 값이 나온다.
 *
 * ## 🔴 이 환산이 무엇이 아닌지 (사용자에게 반드시 드러낼 것)
 *
 * 진입가 USD 는 **DB 에 없다.** `position_state.entry_price` 는 KIS 가 매수 당시 환율을 곱해
 * 저장한 KRW 뿐이고, 그 시점 환율은 어디에도 남아 있지 않다. 따라서 여기서 만드는 달러 진입가는
 * **"현재 환율로 환산한 값"이지 "매수 당시 체결가"가 아니다.** 진입 후 환율이 움직였다면 실제
 * 체결 단가와 다르다. 소비자(화면·리포트)는 이 성격을 문구로 함께 노출해야 한다.
 */
import type { TargetCurrency } from '@/lib/research/types';

/**
 * 같은 시세 응답에서 나온 **동일 시점** 가격 쌍.
 *
 * - `krw` : KIS 가 환율을 곱해 돌려준 원화 환산 단가 (국내·해외 공통, 항상 존재)
 * - `usd` : 해외 종목의 **환산 전 USD 원가**(`Ticker.priceUsd`). 국내 종목이거나 응답에
 *           없으면 `null` — 그때는 달러 표기를 만들 수 없다는 뜻이며, 추정하지 않는다.
 */
export interface SymbolQuote {
  krw: number;
  usd: number | null;
}

/**
 * 표시 금액이 어떻게 만들어졌는지.
 *
 * - `krw_native`    : 국내 종목 — 원화가 원래 통화다. 환산이 일어나지 않았다.
 * - `usd_converted` : 해외 종목 — 같은 시점 시세 쌍의 환율로 원화 금액을 환산했다.
 *                     🔴 매수 당시 체결가가 아니다.
 * - `krw_fallback`  : 해외 종목인데 USD 시세를 못 얻어 원화로 되돌렸다. 화면이 이 사실을 밝힌다.
 */
export type DisplayBasis = 'krw_native' | 'usd_converted' | 'krw_fallback';

export interface DisplayAmount {
  /** 표시할 금액. 입력이 유효하지 않으면 null */
  value: number | null;
  /** 실제 표시 통화. 폴백했으면 'KRW' 다 — 요청 통화가 아니라 **실제 통화**를 담는다 */
  currency: TargetCurrency;
  basis: DisplayBasis;
  /**
   * 환산 전 원화 원본. 환산했을 때 "지어낸 숫자가 아니다"를 화면이 함께 보여줄 수 있게 남긴다.
   * 판정·집계에 쓰지 말 것 — 표시 전용이다.
   */
  sourceKRW: number | null;
}

function isPositiveFinite(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v) && v > 0;
}

/**
 * 시세 쌍에서 뽑은 USD/KRW 비율. 🔴 **환율 계산은 이 함수 하나뿐이다.**
 * 두 값 중 하나라도 없거나 0 이하면 `null` — 그때는 환산하지 않는다.
 */
export function usdPerKrwFromQuote(quote: SymbolQuote | null | undefined): number | null {
  if (!quote) return null;
  if (!isPositiveFinite(quote.krw) || !isPositiveFinite(quote.usd)) return null;
  return quote.usd / quote.krw;
}

/**
 * 원화 금액 하나를 표시 통화로 변환한다.
 *
 * @param amountKRW 원화 금액 (`position_state.entry_price`, 투자금, KRW 환산 현재가 …)
 * @param currency  표시하려는 통화. `currencyForMarket(market)` 로 만든다 — 임의 지정 금지
 * @param quote     같은 심볼의 **동일 시점** 시세 쌍. 없으면 환산 불가 → KRW 폴백
 *
 * 🔴 여기서 나온 `value` 를 다른 통화의 값과 더하거나 비교하지 말 것.
 *    비교가 필요하면 `targetVsEntryPct()` 처럼 **같은 통화끼리의 비**를 곱해서 구한다.
 */
export function toDisplayAmount(
  amountKRW: number | null | undefined,
  currency: TargetCurrency,
  quote: SymbolQuote | null | undefined,
): DisplayAmount {
  const krw = amountKRW != null && Number.isFinite(amountKRW) ? amountKRW : null;

  // 국내 종목 — 원화가 원통화다. 환산 경로에 들어가지 않는다.
  if (currency !== 'USD') {
    return { value: krw, currency: 'KRW', basis: 'krw_native', sourceKRW: krw };
  }

  const rate = usdPerKrwFromQuote(quote);
  if (krw == null || rate == null) {
    // 역산 불가 — 통화 기호만 바꾸지 않고 원화 그대로 내보낸다(사실이 드러나게 basis 로 표시).
    return { value: krw, currency: 'KRW', basis: 'krw_fallback', sourceKRW: krw };
  }
  return { value: krw * rate, currency: 'USD', basis: 'usd_converted', sourceKRW: krw };
}

/** 해외 종목인데 달러로 못 바꿔 원화로 되돌아간 경우 — 화면이 그 사실을 밝혀야 한다. */
export function isFxFallback(d: DisplayAmount | null | undefined): boolean {
  return d?.basis === 'krw_fallback';
}

/** 현재 환율 환산본이라 "매수 당시 체결가"가 아님을 밝혀야 하는 경우. */
export function isFxConverted(d: DisplayAmount | null | undefined): boolean {
  return d?.basis === 'usd_converted';
}
