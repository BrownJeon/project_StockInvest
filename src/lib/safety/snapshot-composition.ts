/**
 * 스냅샷 구성 비교 — **순수 모듈 (db·notify·fetch import 0개)** (T-041).
 *
 * 두 개의 판정이 한 파일에 있다. 둘은 **목적이 달라서 일부러 다르게** 만들었다:
 *
 *  1. `evaluateVanish`  — 스냅샷 **저장 전** 직전 행과 비교해 거부할지 정한다 (`volatility-guard.ts`
 *     `checkHoldingVanished`). 오염된 값을 *기록하지 않는* 쪽이라 보수적이어도 된다. 이 함수는 T-041 이전
 *     `checkHoldingVanished` 본문과 **동작이 같게** 옮긴 것이다(비유한 총액 → 거부 포함).
 *
 *  2. `assessDrawdownComposition` — 24h 드로다운 킬스위치가 임계를 넘었을 때, 그 손실이 **시장 손실인지
 *     관측 불능인지** 가른다 (`kill-switch.ts`). 진짜 손실을 가리면 안전장치가 무력화되므로 훨씬 엄격하다.
 *
 * ## 왜 필요한가 — 2026-10-03 오발동
 *
 * 보유 NAS:SNPS·NAS:SMH(총액의 72%)가 평가에서 사라지고 대금은 총액에 잡히지 않았다
 * (해외 잔고는 `locked` 가 항상 0 이고 USD 는 "주문가능외화"만 담는다 — 미결제 매도대금이 어디에도 없다).
 * 저장 가드는 01:53·03:04 에 `holding_vanished` 로 두 번 거부했지만, 직전 스냅샷이 3시간을 넘기는
 * 순간 "릴리스 밸브"가 검사를 끄고 그 행을 저장했다. 킬스위치는 그 행을 현재값으로 읽어 2초 뒤
 * "24h 손실 -72.3%" 로 **자동 발동**했다. 시장 손실이 아니라 관측 불능이었다.
 *
 * ## 그리고 1차 설계가 틀렸던 이유 (Reviewer C-1, 같은 날)
 *
 * 1차 구현은 "총액 감소 ≥ 소실액의 70%"로 증발을 판정했다. 그런데 총액은 **남은 보유가 실제로 빠져도**
 * 줄어든다. 종목 A(12%)를 정상 매도해 현금으로 옮기고 B 가 -13.6% 빠진 진짜 -12% 손실을, 총액 감소가
 * 소실액을 넘는다는 이유로 "증발"로 오인해 발동을 보류했다(새 fail-open). 소실 여부는 **총액이 아니라
 * 구성 항목의 흐름**(소실 가치가 현금 증가·신규 보유로 설명되는가)으로 가려야 한다.
 */

/** 현금 항목 — 출금은 정상적으로 총액을 줄이므로 "소실 종목" 판정에서 제외한다. */
export const CASH_CURRENCIES: ReadonlySet<string> = new Set(['KRW', 'USD']);

/** 사라진 보유가 기준 총액의 이 비율 미만이면 판정하지 않는다 (소액 종목 노이즈 회피). */
export const VANISH_MIN_SHARE = 0.10;

/** (저장 가드 전용) 사라진 금액의 이 비율 이상이 총액에서 그대로 증발했으면 매도가 아니라 조회 실패다. */
export const VANISH_DROP_RATIO = 0.7;

/**
 * (킬스위치 전용, **정책 값 3%**) 거래 정황이 소실액의 이 비율 이하일 때만 "순수 소실"로 본다.
 *
 * 스냅샷만으로는 "관측 불능"과 "소실 종목을 낮은 가격에 청산한 실현 손실" 또는 "그 대금으로 산 보유의
 * 이후 하락"을 구별할 수 없다 (독립 감사 C-2). 그래서 현금 유입·신규 보유·기존 종목 추가 매수라는 *거래
 * 정황*이 소실액의 3% 를 넘으면 관측 불능으로 보지 않고 킬스위치를 발동한다 — 애매하면 안전 쪽.
 * 값을 올리면 보류가 늘고(오발동 감소·우회 증가), 내리면 발동이 늘어난다(우회 감소·오발동 증가).
 *
 * 근거(2026-10-11 무작위 거래 모델 10만 건, 하락 사건 45% 스트레스, 수량 반영): 허용치 10% → 3% 로 낮추면
 * 순수 미관측 보류는 4,154 → 4,144 건(-0.2%)으로 사실상 그대로이고 출금 없는 위반은 14 → 6건, 2% 는 더 얻는 것이
 * 없다. 3% 는 배당·이자 같은 현실적인 먼지 수준의 현금 변동(10-03 사고는 0원)을 충분히 허용한다.
 * 이 모델은 우리가 가정한 거래 혼합이라 *실제 빈도 추정이 아니다* — 정책 값이며 사용자가 바꿀 수 있다.
 */
export const PURE_DISAPPEARANCE_MAX_EVIDENCE_RATIO = 0.03;

/**
 * 판정에 필요한 최소 모양 — `SnapshotPosition` 의 부분집합이라 구조적으로 호환된다.
 * `qty`·`price` 는 선택: 있으면 기존 종목의 *추가 매수*를 수량 증가로 정확히 가려내고(가격 상승과 구분),
 * 없는 구형 행은 가치 증가를 추가 매수로 보수적으로 본다.
 */
export interface CompositionPosition {
  currency: string;
  value_krw: number;
  qty?: number;
  price?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. 저장 가드용 — T-041 이전 checkHoldingVanished 와 동작 동일
// ═══════════════════════════════════════════════════════════════════════════

export interface VanishEvaluation {
  /** 소실로 판정된 종목 코드 (`currency` 필드 — 이 코드베이스에서 종목 코드를 뜻한다) */
  vanished: string[];
  /** 소실 종목의 직전(기준) 평가금액 합 */
  missingKRW: number;
  /** missingKRW / 기준 총액 */
  share: number;
  /** 기준 총액 - 현재 총액 (양수 = 감소) */
  dropKRW: number;
  /** share·drop 조건까지 모두 충족 = "현금으로 옮겨 가지 않고 증발" */
  evaporated: boolean;
}

/**
 * 기준(prev) 대비 현재(now)의 보유 소실을 평가한다 — **저장 가드의 정의**.
 *
 * 소실 = 기준에 값이 있던 비현금 종목이 현재 없거나 **0원**(시세 조회 실패 sentinel 도 같은 줄에 잡는다).
 * 판정: missing 이 기준 총액의 10% 이상 **그리고** 총액 감소가 missing 의 70% 이상이면 `evaporated`.
 *
 * ⚠️ 비교를 `!(x < y)` 형태로 쓰는 이유: 이전 구현이 `if (x < y) return null` 이었다. `drop` 이 NaN 이면
 *    `NaN < y` 가 거짓이라 거부로 떨어진다. 리팩터 전후로 동작이 같도록 그 의미를 보존한다.
 *
 * ⚠️ 이 함수를 킬스위치 판정에 쓰지 말 것 — 총액 감소를 소실의 증거로 쓰기 때문에, 남은 보유의 실제 하락도
 *    "증발"로 읽는다 (C-1). 킬스위치는 `assessDrawdownComposition` 을 쓴다.
 */
export function evaluateVanish(
  prevTotalKRW: number,
  nowTotalKRW: number,
  prevPositions: readonly CompositionPosition[],
  nowPositions: readonly CompositionPosition[],
  options: { allowZero?: ReadonlySet<string> } = {},
): VanishEvaluation {
  const allowZero = options.allowZero ?? new Set<string>();
  const empty: VanishEvaluation = { vanished: [], missingKRW: 0, share: 0, dropKRW: 0, evaporated: false };
  if (!(prevTotalKRW > 0)) return empty;

  const nowValue = new Map<string, number>();
  for (const p of nowPositions) {
    if (!p || typeof p.currency !== 'string') continue;
    nowValue.set(p.currency, Number(p.value_krw) || 0);
  }

  const vanished: string[] = [];
  let missing = 0;
  for (const p of prevPositions) {
    if (!p || typeof p.currency !== 'string') continue;
    if (CASH_CURRENCIES.has(p.currency)) continue;
    if (allowZero.has(p.currency)) continue;
    const before = Number(p.value_krw) || 0;
    if (before <= 0) continue;
    if ((nowValue.get(p.currency) ?? 0) > 0) continue;
    vanished.push(p.currency);
    missing += before;
  }
  if (vanished.length === 0) return empty;

  const share = missing / prevTotalKRW;
  const dropKRW = prevTotalKRW - nowTotalKRW;
  const evaporated = !(share < VANISH_MIN_SHARE) && !(dropKRW < missing * VANISH_DROP_RATIO);
  return { vanished, missingKRW: missing, share, dropKRW, evaporated };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. 킬스위치용 — 소실 가치가 현금/신규 보유로 "설명되는가"
// ═══════════════════════════════════════════════════════════════════════════

export interface DrawdownCompositionAssessment {
  /** 기준선에 있었는데 현재 스냅샷에 **아예 없는** 비현금 종목 (0원으로 *기록된* 보유는 해당 없음) */
  vanished: string[];
  /** V — 소실 종목의 기준 평가금액 합 */
  vanishedKRW: number;
  /** 기준선에 없었는데 현재 새로 생긴 비현금 종목 */
  newHoldings: string[];
  /** N — 신규 종목의 현재 평가금액 합 */
  newKRW: number;
  /** 현금 항목(KRW·USD)의 증감 합 (현재 - 기준, 부호 있음). 소실이 *설명되는 몫* 계산에만 쓴다 */
  cashDeltaKRW: number;
  /**
   * 통화 행별 **양(+)의 증가**만 합한 현금 유입 (M-2). 순변화(`cashDeltaKRW`)와 달리 USD 증가와 KRW 감소가
   * 상쇄되지 않는다 — 소실 종목 대금이 USD 행으로 들어오고 같은 날 원화가 출금되면 순변화는 0이지만 매도 정황은 남는다.
   */
  cashInflowKRW: number;
  /** 양쪽 스냅샷에 모두 있는 비현금 종목의 *추가 매수* 평가금액 합 (수량 증가분 × 현재 단가) */
  commonBuyKRW: number;
  /**
   * 가치 0으로 *기록됐지만 수량이 있는* 보유 중 거래 정황이 되는 종목 (M-1·M-3) — 기준에 행이 전혀 없던 신규 종목이면
   * 그 사실 자체가, 기준에 있던 종목(0원 행 포함)이면 수량 증가(또는 증가 여부를 증명할 수 없음)가 정황이다. 금액을 매길 수 없어
   * `tradingEvidenceKRW` 에 못 넣으므로 별도 목록으로 두고 `pureDisappearance` 를 직접 꺾는다.
   */
  unpricedTradingCodes: string[];
  /** 거래 정황 = 현금 유입(통화별 양의 증가 합) + 신규 보유 + 추가 매수. 소실을 관측 불능으로 읽는 것을 *막는* 증거 */
  tradingEvidenceKRW: number;
  /** 거래 정황이 소실액의 3% 이하이고 가치 미기록 정황도 없음 = 보유만 사라지고 다른 항목은 거의 안 움직인 "순수 소실" */
  pureDisappearance: boolean;
  /** min(V, max(0, 현금 증가 + N)) — 소실 가치 중 현금/신규 보유로 **설명되는** 부분 */
  explainedKRW: number;
  /** U = V - explained — 어디에도 안 잡힌(미설명) 소실. 이것만 "관측 불능"의 증거다 */
  unexplainedKRW: number;
  /** U / 기준 총액 */
  unexplainedShare: number;
  /** 미설명 소실이 기준 총액의 10% 이상 = 보정 대상 */
  suspected: boolean;
  /** `suspected` 이면서 `pureDisappearance` — **보류가 허용되는 유일한 조건**(보정 손실이 임계 안일 때) */
  suppressible: boolean;
  /** 기준 총액 - U */
  adjustedBaselineKRW: number;
  /**
   * 미설명 소실을 걷어낸 **같은 조건 손실률** (%, 음수 = 손실) = (현재 - (기준 - U)) / (기준 - U).
   * `suspected` 가 아니면 의미 없다. 보정 기준이 0 이하이면 null — 호출처는 null 을 "검증 불가"로 보고
   * **발동 쪽**으로 처리해야 한다.
   */
  adjustedDrawdownPct: number | null;
}

/**
 * 킬스위치가 임계를 넘은 손실을 "시장 손실"로 믿어도 되는지 가른다.
 *
 * 핵심 아이디어: 종목이 사라졌다는 사실만으로는 아무것도 말하지 못한다(정상 매도도 종목을 사라지게 한다).
 * 정상 매도라면 **사라진 가치가 현금 증가나 신규 보유로 어딘가에 잡혀 있다.** 잡히지 않은 몫(U)만이
 * "총액에서 증발"한 것이고, 총 변화에서 그 몫만 걷어내면 나머지는 실제 시장 움직임이다.
 *
 *   - 정상 매도(대금이 현금/신규 보유로): U = 0 → 보정하지 않고 총액 그대로 판단 → 진짜 손실은 발동.
 *   - 10-03 사고(대금이 어디에도 안 잡힘): U = V → 보정 후 손실 ≈ 0% → 보류.
 *   - 미설명 소실 + 남은 보유의 실제 하락: 보정 후에도 임계 초과 → 발동.
 *   - **거래 정황이 보이면(현금 유입·신규 보유·기존 종목 추가 매수) 보류하지 않는다.** 미설명 몫 U 에는 관측 불능
 *     말고도 "소실 종목을 낮은 가격에 청산한 실현 손실"과 "그 대금으로 산 보유의 이후 하락"이 섞이는데, 스냅샷만으로는
 *     구별이 불가능하다 (독립 감사 C-2: 손절·리밸런스·갈아타기에서 -12% 실손실이 보류됐다). 그래서 보류는
 *     `suppressible` = 순수 소실 — 보유만 사라지고 다른 항목은 거의 안 움직인 경우(10-03 사고 형태) — 로 한정한다.
 *
 * 한계(알려진 것): 상장폐지·정리로 종목 **행 자체**가 사라진 실손실은 미설명 소실과 구별되지 않는다.
 * 0원으로 *기록된* 보유는 소실이 아니라 관측된 손실이므로 드로다운에 그대로 반영된다. 이 한계 때문에
 * 호출처는 보류 시 반드시 critical 알림으로 사람에게 알려야 한다.
 */
export function assessDrawdownComposition(
  baselineTotalKRW: number,
  currentTotalKRW: number,
  basePositions: readonly CompositionPosition[],
  curPositions: readonly CompositionPosition[],
): DrawdownCompositionAssessment {
  const none: DrawdownCompositionAssessment = {
    vanished: [], vanishedKRW: 0, newHoldings: [], newKRW: 0, cashDeltaKRW: 0, cashInflowKRW: 0,
    commonBuyKRW: 0, unpricedTradingCodes: [], tradingEvidenceKRW: 0, pureDisappearance: false,
    explainedKRW: 0, unexplainedKRW: 0, unexplainedShare: 0, suspected: false, suppressible: false,
    adjustedBaselineKRW: baselineTotalKRW, adjustedDrawdownPct: null,
  };
  if (!(baselineTotalKRW > 0) || !Number.isFinite(currentTotalKRW)) return none;

  const valid = (p: CompositionPosition | null | undefined): p is CompositionPosition =>
    !!p && typeof p.currency === 'string';
  const val = (p: CompositionPosition) => Number(p.value_krw) || 0;
  const finiteQty = (p: CompositionPosition): number | null => {
    const n = Number(p.qty);
    return p.qty != null && Number.isFinite(n) && n >= 0 ? n : null;
  };

  // 같은 코드가 여러 행으로 오면 *합산*한다 (현금·보유 모두 같은 규칙).
  //  · `pricedQty` = 값 > 0 인 행의 수량 합 — 가치 0 행이 섞여도 현재 단가(value / pricedQty)가 희석되지 않게 한다.
  interface Holding { value: number; qty: number | null; pricedQty: number }
  const baseHoldings = new Map<string, Holding>();   // 비현금, 값 > 0
  const baseRecorded = new Map<string, Holding>();   // 비현금, 기준에 *행이 있던* 모든 코드 (값 0 포함) — "신규" 판정용 (M-3)
  const curHoldings = new Map<string, Holding>();    // 비현금, 값 > 0 **또는 수량 > 0** (M-1: 가치 0 기록 보유 포함)
  const curPresent = new Set<string>();              // 값과 무관하게 현재 스냅샷에 항목이 있는 코드
  const baseCashBy = new Map<string, number>();      // 통화 행별 현금 (M-2)
  const curCashBy = new Map<string, number>();
  const addCash = (m: Map<string, number>, p: CompositionPosition) =>
    m.set(p.currency, (m.get(p.currency) ?? 0) + val(p));
  const add = (m: Map<string, Holding>, p: CompositionPosition) => {
    const prev = m.get(p.currency);
    const q = finiteQty(p);
    m.set(p.currency, {
      value: (prev?.value ?? 0) + val(p),
      // 수량은 모든 행에서 읽혔을 때만 유효 — 하나라도 못 읽으면 null(= 가치 증가로 보수 판정)
      qty: prev ? (prev.qty != null && q != null ? prev.qty + q : null) : q,
      pricedQty: (prev?.pricedQty ?? 0) + (val(p) > 0 && q != null ? q : 0),
    });
  };

  for (const p of basePositions) {
    if (!valid(p)) continue;
    if (CASH_CURRENCIES.has(p.currency)) { addCash(baseCashBy, p); continue; }
    add(baseRecorded, p);
    if (val(p) > 0) add(baseHoldings, p);
  }
  for (const p of curPositions) {
    if (!valid(p)) continue;
    curPresent.add(p.currency);
    if (CASH_CURRENCIES.has(p.currency)) addCash(curCashBy, p);
    else if (val(p) > 0 || (finiteQty(p) ?? 0) > 0) add(curHoldings, p);
  }
  const sumOf = (m: Map<string, number>) => { let s = 0; for (const v of m.values()) s += v; return s; };
  const baseCash = sumOf(baseCashBy);
  const curCash = sumOf(curCashBy);

  const vanished: string[] = [];
  let V = 0;
  for (const [code, h] of baseHoldings) {
    if (curPresent.has(code)) continue;     // 0원으로라도 *기록돼 있으면* 관측된 것 → 소실이 아니다
    vanished.push(code);
    V += h.value;
  }
  if (vanished.length === 0) return none;

  // 가치 0 으로 기록됐지만 수량이 있는 보유 — 금액은 못 매기지만 *거래가 있었다는 사실*이다 (M-1).
  const unpriced: string[] = [];

  const newHoldings: string[] = [];
  let N = 0;
  for (const [code, h] of curHoldings) {
    if (baseHoldings.has(code)) continue;
    if (h.value > 0) {                           // 신규, 또는 기준에 0원이던 종목의 가격 복귀 — 둘 다 금액이 있는 정황
      newHoldings.push(code);
      N += h.value;
      continue;
    }
    // 이하: 현재 가치 0·수량 > 0 인 행 (M-1)
    const rec = baseRecorded.get(code);
    if (!rec) {                                  // 기준에 행이 전혀 없던 신규 — 금액은 못 매기지만 매수 사실
      newHoldings.push(code);
      unpriced.push(code);
    } else if (rec.qty == null || h.qty == null || h.qty > rec.qty) {
      // 기준에도 0원으로 *기록돼* 있던 종목(허용 심볼의 영구 0원 행): 수량이 늘었을 때만 정황 (M-3).
      // 수량을 몰라 증가 여부를 증명할 수 없으면 정황으로 본다.
      unpriced.push(code);
    }
  }

  // 기존 종목의 추가 매수: 수량 증가분 × 현재 단가. 수량을 못 읽으면 가치 증가분(보수적: 가격 상승도 포함).
  // 현재 가치가 0 이면 단가를 현재 값에서 못 구하므로 기준 단가로 환산하고, 그것도 불가하면 가치 미기록 정황으로 둔다.
  let commonBuy = 0;
  for (const [code, cur] of curHoldings) {
    const base = baseHoldings.get(code);
    if (!base) continue;
    if (base.qty != null && cur.qty != null && cur.qty > 0) {
      const dq = Math.max(0, cur.qty - base.qty);
      if (dq === 0) continue;
      const curUnit = cur.pricedQty > 0 ? cur.value / cur.pricedQty : 0;
      const baseUnit = base.pricedQty > 0 ? base.value / base.pricedQty : 0;
      const unit = curUnit > 0 ? curUnit : baseUnit;
      if (unit > 0) commonBuy += dq * unit;
      else unpriced.push(code);
    } else if (cur.value > 0) {
      commonBuy += Math.max(0, cur.value - base.value);
    } else if (cur.qty != null && cur.qty > 0) {
      unpriced.push(code);                       // 수량은 있는데 증가 여부를 증명할 방법이 없다 → 정황으로 본다
    }
  }

  // 현금 유입은 통화 행별 양의 증가만 합한다 — 순변화는 USD 증가와 KRW 출금을 상쇄해 매도 정황을 지운다 (M-2).
  let cashInflow = 0;
  for (const c of new Set([...baseCashBy.keys(), ...curCashBy.keys()])) {
    cashInflow += Math.max(0, (curCashBy.get(c) ?? 0) - (baseCashBy.get(c) ?? 0));
  }

  const cashDelta = curCash - baseCash;
  const explained = Math.min(V, Math.max(0, cashDelta + N));
  const U = V - explained;
  const unexplainedShare = U / baselineTotalKRW;
  const suspected = unexplainedShare >= VANISH_MIN_SHARE;

  const tradingEvidence = cashInflow + N + commonBuy;
  const pureDisappearance = unpriced.length === 0
    && tradingEvidence <= PURE_DISAPPEARANCE_MAX_EVIDENCE_RATIO * V;

  const adjustedBaseline = baselineTotalKRW - U;
  const adjustedDrawdownPct = adjustedBaseline > 0
    ? ((currentTotalKRW - adjustedBaseline) / adjustedBaseline) * 100
    : null;

  return {
    vanished, vanishedKRW: V, newHoldings, newKRW: N, cashDeltaKRW: cashDelta, cashInflowKRW: cashInflow,
    commonBuyKRW: commonBuy, unpricedTradingCodes: unpriced, tradingEvidenceKRW: tradingEvidence, pureDisappearance,
    explainedKRW: explained, unexplainedKRW: U, unexplainedShare, suspected,
    suppressible: suspected && pureDisappearance,
    adjustedBaselineKRW: adjustedBaseline, adjustedDrawdownPct,
  };
}

/**
 * `portfolio_snapshots.positions` 컬럼 값을 배열로 읽는다. mysql2 는 JSON 컬럼을 문자열로 돌려줄 수도,
 * 이미 파싱된 값으로 돌려줄 수도 있다. 읽을 수 없으면 `null` — **호출처는 null 을 "구성 비교 불가"로
 * 다뤄 기존 동작(총액만 비교)으로 되돌아가야 한다.** 판정 불가를 "소실 없음"이나 "소실 있음"으로
 * 해석하지 않는다.
 */
export function parseSnapshotPositions(raw: unknown): CompositionPosition[] | null {
  try {
    const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? (parsed as CompositionPosition[]) : null;
  } catch {
    return null;
  }
}
