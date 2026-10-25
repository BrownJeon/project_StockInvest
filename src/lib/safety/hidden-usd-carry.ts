/**
 * (T-080) **가려진 USD 이월 보정** — 순수 모듈 (db·notify·fetch import 0개).
 *
 * 24h 드로다운 킬스위치가 **발동 후보**일 때만 쓰인다(`kill-switch.ts` ③-c). 보류를 결정할 수 있는 근거는
 * 이 파일의 `suppress` 하나뿐이며, 그 밖의 모든 경우(이월 불가·모호 구간·임계 초과·입력 이상)는 호출처가
 * **기존대로 발동**하도록 `suppress=false` 를 돌려준다.
 *
 * ## 왜 필요한가 — 2026-10-23 자동 발동
 *
 * 스냅샷의 USD 예수금 행이 평일 저녁~새벽(약 16:40~06:30)에 `qty=0` 으로 읽힌다. KIS 를 낮에 다시 물으면
 * 같은 값이 그대로 있으므로 USD 가 실제로 없어진 것이 아니라 **그 시간대에만 가려진다**. 그래서 두 가지
 * 거짓 손실이 생긴다:
 *   (i)  기준선·현재가 모두 가려진 상태에서 KRW→USD 환전이 일어나면 환전분이 총액에서 사라져 보인다.
 *   (ii) 현재만 가려진 시간대이고 24시간 전은 보이던 시간대이면 USD 비중만큼 손실로 보인다.
 * 전환 규칙 E(`applyUsdSymmetricRemoval`)는 **한쪽에만 USD 행이 있을 때만** 작동하므로 양쪽 모두 USD 행이
 * 있고 값이 0 인 이 경우를 잡지 못한다.
 *
 * ## 규칙 (설계 v1)
 *  1. "가려짐" = 그 스냅샷에 USD 행이 있고 수량 합이 0(가치 합도 0)이며, 그 스냅샷 시각 기준 **직전 20시간 이내**
 *     (경계 포함, 자기 시각 제외)에 USD 수량이 양수인 스냅샷이 있다. USD 행이 **없는** 경우는 규칙 E 의 영역이라
 *     여기서 다루지 않는다.
 *  2. 이월값 = 가장 최근 양수 수량 × (가려진 스냅샷 자신의 USD 행 가격, 없으면 그 양수 행의 가격).
 *     총액과 positions 를 **함께** 보정해 같은 집합을 유지한다.
 *  3. 가려진 쪽이 **하나라도 이월 불가**면 전체를 보정하지 않는다 — 한쪽만 보정하면 비대칭 보정이 되어
 *     보류 쪽으로 치우친다(10-23 사건에서 현재만 보정하면 약 −0.7% 로 보이지만 대칭 보정은 약 −2.8%).
 *  4. 보정 손실률이 **임계 × 0.5 보다 엄격히 얕을 때만** `suppress=true`. 경계값·모호 구간은 발동.
 *  5. (Reviewer M-1) **구매 증거 가드** — 이월 근거 행 S 와 가려진 행 H 의 비현금(KRW·USD 제외) 보유를 비교해
 *     H 에 S 에 없는 종목이 있거나 H 수량이 S 보다 큰 종목이 있으면(허용오차 1e-9, 국내·해외 구분 없음) 그 쪽은
 *     이월 불가(`hidden_purchase_evidence`). 가려진 동안 USD 로 주식을 샀다면 USD 는 진짜 0 이고 산 주식이 이미
 *     총액에 있으므로, 이월하면 이중 계상돼 진짜 손실을 가린다. 수량 감소(매도)는 막지 않는다 — 매도 대금은 USD 를
 *     늘릴 뿐이라 낡은 이월값은 현재를 **덜** 보정한다(발동 쪽). 수량을 읽을 수 없으면 증거로 본다.
 *     (Codex high) 비교는 양 끝만이 아니라 S.ts < R.ts <= H.ts 인 **모든 중간 행 R** 과 H 자신에 대해 한다 — 가려진
 *     구간에 사서 H 전에 되판 왕복 거래도 중간 행에 보이면 잡는다. 중간 행 positions 를 읽을 수 없으면
 *     `hidden_purchase_evidence_unreadable`(검증 불가 → 이월 불가).
 *     KRW 증가는 증거로 쓰지 않는다 — 입금과 환전을 스냅샷으로 구별할 수 없어 10-23 사건(입금 + 환전)이 깨진다.
 *  6. (Reviewer M-2) **환율 범위** — H 자신의 USD 가격이 S 의 USD 가격 대비 [0.8, 1.25] 배(양 끝 포함) 밖이면
 *     이월 불가(`hidden_no_price_out_of_band`). H 에 가격이 없으면 S 가격을 쓴다(검사 불필요). H 에 가격이 있는데
 *     S 에 가격이 없으면 범위를 확인할 수 없으므로 이월 불가로 본다.
 *
 * ## 알려진 한계 (수용 — 정확한 범위)
 * 구매 증거 가드(S 와 H 사이 모든 중간 행 + H 를 S 와 비교)가 못 잡는 것 — 가려진 구간(마지막 양수 관측 뒤 최대 20시간)
 * 안에서 USD 가 사라졌는데 **어느 스냅샷에도 비현금 매수 정황이 남지 않은** 경우:
 *   (a) USD→KRW 환전, (b) USD 출금, (c) **연속된 두 시간당 스냅샷 사이에서 시작·종료된 왕복 거래**(사서 되팔기, 실현 손실
 *       포함 — 시간당 단독 기록자 가정이라 그 사이 보유는 관측되지 않는다).
 * 이때 이월값 c(기준 총액 대비 비율, 최대 S 시점 USD 비중 ≈ 현 계좌 11%)는 실재하지 않는 가치라, 진짜 손실률이
 * 약 −(5 + c)% 보다 얕으면(현 계좌에서 최악 약 −16%) 보류될 수 있다. 환전이면 KRW 가 늘어 총액에 이미 있으므로 이중
 * 계상, 출금·왕복 손실이면 없는 돈을 더한다. 완충은 보류마다 나가는 critical 알림(수동 켜기 안내)뿐이다.
 * 시각을 읽을 수 없는 직전 행은 시간 순서를 정할 수 없어 근거·중간 행 어느 쪽에도 쓰지 않는다(SQL 이 `ts < ?` 로
 * 조회하므로 운영에서는 생기지 않는다). 반대 방향(기준선 가려짐·현재 보임에서 원시가 부풀어 진짜 손실이 가려지는 M-3)은 이 단계가 발동
 * 후보에서만 돌기 때문에 다루지 않는다 — Phase 2 몫.
 */
import { CASH_CURRENCIES, parseSnapshotPositions, type CompositionPosition } from './snapshot-composition';

/** 직전 양수 값을 찾는 창 — 가려진 구간(약 14시간)을 덮고 남는 길이. */
export const HIDDEN_USD_CARRY_WINDOW_HOURS = 20;
/** 각 기준 시각마다 읽을 직전 스냅샷 수 상한 (hourly 단독 기록자 기준 20시간 ≈ 20행). */
export const HIDDEN_USD_CARRY_HISTORY_LIMIT = 48;
/** 보류 허용 마진 — 보정 손실률이 임계의 이 비율보다 얕아야 보류한다. */
export const HIDDEN_USD_SUPPRESS_MARGIN = 0.5;
/** 가려진 행 USD 가격 / 근거 행 USD 가격 허용 범위 (양 끝 포함). */
export const HIDDEN_USD_PRICE_BAND_MIN = 0.8;
export const HIDDEN_USD_PRICE_BAND_MAX = 1.25;
/** 수량 증가 판정 허용오차. */
const QTY_EPS = 1e-9;

const WINDOW_MS = () => HIDDEN_USD_CARRY_WINDOW_HOURS * 60 * 60 * 1000;

export interface CarryTarget {
  ts: unknown;
  total: number;
  positions: CompositionPosition[] | null;
}

export interface CarryPrior {
  ts: unknown;
  /** DB 원본 값 그대로 — 여기서 파싱한다. 읽을 수 없는 행은 근거에서 제외한다. */
  positions: unknown;
}

export type CarrySideName = 'baseline' | 'current';

export type CarrySideState =
  | 'absent'           // USD 행 없음 — 규칙 E 영역(이 단계 대상 아님)
  | 'visible'          // USD 수량 > 0 — 보정 불필요
  | 'hidden_carried'   // 가려짐 + 직전 20h 양수 값으로 이월
  | 'hidden_no_prior'  // 가려짐(qty 0) 이지만 직전 20h 안에 양수 값 없음 — 이월 불가
  | 'hidden_no_price'  // 가려짐 + 양수 수량은 있으나 쓸 수 있는 가격이 없음 — 이월 불가
  | 'hidden_no_price_out_of_band'  // 가려진 행 가격이 근거 행 가격 대비 [0.8, 1.25] 배 밖이거나 대조 불가 — 이월 불가 (M-2)
  | 'hidden_purchase_evidence'     // 근거 행 뒤 비현금 신규 종목·수량 증가 — USD 가 매수에 쓰였을 수 있음, 이월 불가 (M-1)
  | 'hidden_purchase_evidence_unreadable' // 근거 행과 가려진 행 사이의 중간 행을 읽을 수 없음 — 매수 정황 검증 불가, 이월 불가 (Codex high)
  | 'unknown';         // 시각·positions·수량을 읽을 수 없음 — 판정 불가

export interface CarrySide {
  state: CarrySideState;
  carriedQty: number;
  carriedPrice: number;
  carriedKRW: number;
  /** 이월에 쓴 양수 스냅샷 시각 (ms) */
  lastSeenMs: number | null;
  /** `hidden_purchase_evidence` 일 때 근거가 된 종목 (신규 + 수량 증가 + 수량 판독 불가) */
  purchaseEvidence: string[];
  adjustedTotal: number;
  adjustedPositions: CompositionPosition[] | null;
}

export interface HiddenUsdCarryAssessment {
  /** 가려진 쪽이 있고 그 쪽이 전부 이월됐다 (보정 수치가 유효) */
  carried: boolean;
  /** 이월한 쪽 */
  carriedSides: CarrySideName[];
  /** USD 행이 qty 0 으로 가려진 쪽 (이월 여부와 무관) */
  hiddenSides: CarrySideName[];
  baseline: CarrySide;
  current: CarrySide;
  rawDrawdownPct: number | null;
  adjustedBaselineTotal: number | null;
  adjustedCurrentTotal: number | null;
  /** 보정 손실률 (%, 음수 = 손실). 이월하지 않았거나 계산 불가면 null */
  adjustedDrawdownPct: number | null;
  /** 보류 허용 — 보류의 **유일한** 근거 */
  suppress: boolean;
  reason: string;
}

/**
 * 스냅샷 positions 의 USD 행 판별. `kill-switch.ts` 의 `isUsdRow`(규칙 E)와 같은 식이지만 일부러 따로 둔다 —
 * 이 모듈은 순수(db·notify import 0개)여야 하는데 `kill-switch.ts` 는 db·notify 를 import 하므로 거꾸로 가져올 수 없고,
 * 감사가 끝난 규칙 E 코드를 이 task 에서 옮기지 않기 위해서다. 둘 다 `usd-cash-balance-fence.test.ts` 허용 목록에 있다.
 */
const isUsd = (p: unknown): p is CompositionPosition =>
  !!p && typeof p === 'object' && (p as { currency?: unknown }).currency === 'USD';

/** 숫자 또는 숫자 문자열만 유한값으로 읽는다. 그 밖은 null. */
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Date·문자열·숫자 시각을 ms 로. 읽을 수 없으면 null. */
export function toMs(ts: unknown): number | null {
  if (ts instanceof Date) { const t = ts.getTime(); return Number.isFinite(t) ? t : null; }
  if (typeof ts === 'string' || typeof ts === 'number') {
    const t = new Date(ts).getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

interface UsdReading { kind: 'absent' | 'hidden' | 'visible' | 'unknown'; qty: number; price: number | null }

/** 한 스냅샷의 USD 행 상태. 수량·가치를 하나라도 못 읽으면 unknown. */
function readUsd(positions: readonly unknown[]): UsdReading {
  const rows = positions.filter(isUsd);
  if (rows.length === 0) return { kind: 'absent', qty: 0, price: null };
  let qty = 0;
  let value = 0;
  let price: number | null = null;
  for (const r of rows) {
    const q = num(r.qty);
    const v = num(r.value_krw);
    if (q == null || v == null || q < 0) return { kind: 'unknown', qty: 0, price: null };
    qty += q;
    value += v;
    const pr = num(r.price);
    if (price == null && pr != null && pr > 0) price = pr;
  }
  if (qty > 0) return { kind: 'visible', qty, price };
  if (qty === 0 && value === 0) return { kind: 'hidden', qty: 0, price };
  return { kind: 'unknown', qty: 0, price: null };
}

/** 대상 스냅샷에 qty 0 으로 가려진 USD 행이 있는가 — 호출처가 직전 스냅샷 조회 여부를 정하는 데 쓴다. */
export function hasHiddenUsdRow(positions: readonly CompositionPosition[] | null): boolean {
  if (!positions) return false;
  return readUsd(positions).kind === 'hidden';
}

/**
 * 비현금(KRW·USD 제외) 보유의 종목별 수량 합. 한 행이라도 수량을 읽을 수 없으면 그 종목은 null.
 */
function nonCashQty(positions: readonly unknown[]): Map<string, number | null> {
  const m = new Map<string, number | null>();
  for (const p of positions) {
    if (!p || typeof p !== 'object') continue;
    const code = (p as { currency?: unknown }).currency;
    if (typeof code !== 'string' || CASH_CURRENCIES.has(code)) continue;
    const q = num((p as { qty?: unknown }).qty);
    const prev = m.get(code);
    if (q == null || q < 0) { m.set(code, null); continue; }
    m.set(code, prev === undefined ? q : prev === null ? null : prev + q);
  }
  return m;
}

/**
 * (M-1) 한 행 R 의 비현금 보유를 근거 행 S 와 비교한 매수 정황 종목 — 신규 종목, 수량 증가, 수량 판독 불가.
 * R 쪽 수량이 0 인 종목은 보유가 아니므로 보지 않는다. 수량 감소(매도)는 정황이 아니다.
 * 호출처는 S 와 H 사이의 **모든 중간 행과 H 자신**에 대해 이 비교를 반복한다(왕복 거래 — Codex high).
 */
function purchaseEvidence(row: readonly unknown[], source: readonly unknown[]): string[] {
  const h = nonCashQty(row);
  const s = nonCashQty(source);
  const out: string[] = [];
  for (const [code, hq] of h) {
    if (hq === 0) continue;
    const sq = s.get(code);
    if (hq == null || sq === null) { out.push(code); continue; }     // 판독 불가 → 증거로 본다(보수)
    if (sq === undefined || hq > sq + QTY_EPS) out.push(code);       // 신규 종목 또는 수량 증가
  }
  return out.sort();
}

function assessSide(target: CarryTarget, priors: readonly CarryPrior[]): CarrySide {
  const base: CarrySide = {
    state: 'unknown', carriedQty: 0, carriedPrice: 0, carriedKRW: 0, lastSeenMs: null, purchaseEvidence: [],
    adjustedTotal: target.total, adjustedPositions: target.positions,
  };
  if (!target.positions || !Number.isFinite(target.total)) return base;
  const own = readUsd(target.positions);
  if (own.kind === 'absent') return { ...base, state: 'absent' };
  if (own.kind === 'visible') return { ...base, state: 'visible' };
  if (own.kind === 'unknown') return base;

  // 가려짐 — 직전 20시간(경계 포함) 안에서 가장 최근 양수 USD 스냅샷(근거 행 S)을 찾는다
  const tMs = toMs(target.ts);
  if (tMs == null) return base;
  const lower = tMs - WINDOW_MS();
  let best: { ms: number; qty: number; price: number | null; positions: unknown[] } | null = null;
  for (const pr of priors) {
    const ms = toMs(pr?.ts);
    if (ms == null || !(ms < tMs) || ms < lower) continue;
    const ps = parseSnapshotPositions(pr.positions);
    if (!ps) continue;                              // 읽을 수 없는 행은 근거가 아니다
    const u = readUsd(ps);
    if (u.kind !== 'visible') continue;
    if (!best || ms > best.ms) best = { ms, qty: u.qty, price: u.price, positions: ps };
  }
  if (!best) return { ...base, state: 'hidden_no_prior' };

  // (M-1 + Codex high) S 뒤 비현금 매수 정황이 있으면 USD 가 매수에 쓰였을 수 있다 → 이월 불가.
  // 양 끝(S·H)만 비교하면 가려진 구간에 사서 H 전에 되판 왕복 거래(실현 손실 포함)가 보이지 않으므로,
  // S.ts < R.ts <= H.ts 인 모든 중간 행 R 과 H 자신을 S 와 비교한다. 중간 행을 읽을 수 없으면 검증 불가 → 이월 불가.
  // (S 를 *고르는* 단계에서 깨진 행을 후보에서만 빼는 동작은 그대로다.)
  const sMs = best.ms;
  const evidenceSet = new Set<string>(purchaseEvidence(target.positions, best.positions));
  let unreadable = 0;
  for (const pr of priors) {
    const ms = toMs(pr?.ts);
    if (ms == null || !(ms > sMs) || !(ms <= tMs)) continue;   // S.ts < R.ts <= H.ts (같은 시각의 다른 행도 보수적으로 본다)
    const ps = parseSnapshotPositions(pr.positions);
    if (!ps) { unreadable += 1; continue; }
    for (const code of purchaseEvidence(ps, best.positions)) evidenceSet.add(code);
  }
  if (unreadable > 0) {
    return { ...base, state: 'hidden_purchase_evidence_unreadable', lastSeenMs: best.ms, purchaseEvidence: [...evidenceSet].sort() };
  }
  if (evidenceSet.size > 0) {
    return { ...base, state: 'hidden_purchase_evidence', lastSeenMs: best.ms, purchaseEvidence: [...evidenceSet].sort() };
  }

  // (M-2) 가격: H 자신의 가격이 있으면 S 가격 대비 [0.8, 1.25] 배 안이어야 한다. 없으면 S 가격.
  let price: number | null;
  if (own.price != null) {
    if (best.price == null) return { ...base, state: 'hidden_no_price_out_of_band', lastSeenMs: best.ms };
    const ratio = own.price / best.price;
    if (!(ratio >= HIDDEN_USD_PRICE_BAND_MIN && ratio <= HIDDEN_USD_PRICE_BAND_MAX)) {
      return { ...base, state: 'hidden_no_price_out_of_band', lastSeenMs: best.ms };
    }
    price = own.price;
  } else {
    price = best.price;
  }
  if (price == null || !(price > 0)) return { ...base, state: 'hidden_no_price', lastSeenMs: best.ms };

  const carriedKRW = best.qty * price;
  if (!Number.isFinite(carriedKRW) || !(carriedKRW > 0)) return { ...base, state: 'hidden_no_price', lastSeenMs: best.ms };
  const adjustedPositions: CompositionPosition[] = [
    ...target.positions.filter(p => !isUsd(p)),
    { currency: 'USD', qty: best.qty, price, value_krw: carriedKRW },
  ];
  return {
    state: 'hidden_carried', carriedQty: best.qty, carriedPrice: price, carriedKRW, lastSeenMs: best.ms, purchaseEvidence: [],
    adjustedTotal: target.total + carriedKRW, adjustedPositions,
  };
}

const SIDE_LABEL: Record<CarrySideName, string> = { baseline: '기준선', current: '현재' };

const BLOCKED_STATES: ReadonlySet<CarrySideState> = new Set<CarrySideState>([
  'hidden_no_prior', 'hidden_no_price', 'hidden_no_price_out_of_band', 'hidden_purchase_evidence',
  'hidden_purchase_evidence_unreadable',
]);

function blockedText(s: CarrySide): string {
  switch (s.state) {
    case 'hidden_no_prior': return `hidden_no_prior: 직전 ${HIDDEN_USD_CARRY_WINDOW_HOURS}시간 안에 양수 USD 없음`;
    case 'hidden_no_price': return 'hidden_no_price: 환율 없음';
    case 'hidden_no_price_out_of_band':
      return `hidden_no_price_out_of_band: 환율이 직전 양수 행 대비 ${HIDDEN_USD_PRICE_BAND_MIN}~${HIDDEN_USD_PRICE_BAND_MAX}배 밖이거나 대조 불가`;
    case 'hidden_purchase_evidence_unreadable':
      return 'hidden_purchase_evidence_unreadable: 마지막 양수 관측 뒤 중간 스냅샷을 읽을 수 없어 매수 정황 검증 불가';
    case 'hidden_purchase_evidence':
      return `hidden_purchase_evidence: 마지막 양수 관측 뒤 신규·수량 증가 보유 [${s.purchaseEvidence.join(', ')}]`;
    default: return s.state;
  }
}

/**
 * 발동 후보의 손실이 가려진 USD 탓인지 평가한다. 입력 이상은 `suppress=false`.
 *
 * 내부 try/catch 는 두지 않는다(Reviewer M3b: 도달 불가였다). 혹시 예외가 나면 호출처 ③-c 의 try/catch 가
 * "점검 실패 → 보정 없이 기존 경로(발동 쪽)"로 처리하므로 의미가 같다.
 *
 * @param priors 기준선·현재 각각의 직전 스냅샷(합쳐서 넘겨도 된다). 창(20h)·자기 시각 제외는 여기서 다시 거른다.
 */
export function assessHiddenUsdCarry(input: {
  baseline: CarryTarget;
  current: CarryTarget;
  priors: readonly CarryPrior[];
  thresholdPct: number;
}): HiddenUsdCarryAssessment {
  const { baseline, current, thresholdPct } = input;
  const priors = Array.isArray(input.priors) ? input.priors : [];
  const rawDrawdownPct = baseline.total > 0 && Number.isFinite(current.total)
    ? ((current.total - baseline.total) / baseline.total) * 100
    : null;
  const empty = (side: CarryTarget): CarrySide => ({
    state: 'unknown', carriedQty: 0, carriedPrice: 0, carriedKRW: 0, lastSeenMs: null, purchaseEvidence: [],
    adjustedTotal: side.total, adjustedPositions: side.positions,
  });
  const no = (reason: string, b: CarrySide = empty(baseline), c: CarrySide = empty(current), hidden: CarrySideName[] = []): HiddenUsdCarryAssessment => ({
    carried: false, carriedSides: [], hiddenSides: hidden, baseline: b, current: c, rawDrawdownPct,
    adjustedBaselineTotal: null, adjustedCurrentTotal: null, adjustedDrawdownPct: null, suppress: false, reason,
  });

  if (!(baseline.total > 0) || !Number.isFinite(current.total)) return no('총액을 읽을 수 없음');
  if (!baseline.positions || !current.positions) return no('positions 를 읽을 수 없는 쪽이 있음 — 가려짐 판정 불가');

  const b = assessSide(baseline, priors);
  const c = assessSide(current, priors);
  const sides: [CarrySideName, CarrySide][] = [['baseline', b], ['current', c]];
  const hidden = sides.filter(([, s]) => s.state.startsWith('hidden')).map(([n]) => n);

  if (hidden.length === 0) return no('가려진 USD 행 없음', b, c);
  if (sides.some(([, s]) => s.state === 'absent')) return no('한쪽에 USD 행이 없음 — 전환 규칙 E 영역', b, c, hidden);
  if (sides.some(([, s]) => s.state === 'unknown')) return no('USD 행·시각을 읽을 수 없는 쪽이 있음 — 판정 불가', b, c, hidden);
  const blocked = sides.filter(([, s]) => BLOCKED_STATES.has(s.state));
  if (blocked.length > 0) {
    const why = blocked.map(([n, s]) => `${SIDE_LABEL[n]}: ${blockedText(s)}`).join(', ');
    return no(`USD 가려짐이나 이월 불가(${why}) — 보정하지 않음`, b, c, hidden);
  }

  const carriedSides = sides.filter(([, s]) => s.state === 'hidden_carried').map(([n]) => n);
  const adjB = b.adjustedTotal;
  const adjC = c.adjustedTotal;
  const adjustedDrawdownPct = adjB > 0 && Number.isFinite(adjC) ? ((adjC - adjB) / adjB) * 100 : null;
  if (adjustedDrawdownPct == null || !Number.isFinite(adjustedDrawdownPct)) {
    return no('보정 손실률 계산 불가', b, c, hidden);
  }
  const limit = -thresholdPct * HIDDEN_USD_SUPPRESS_MARGIN;
  const suppress = Number.isFinite(thresholdPct) && thresholdPct > 0 && adjustedDrawdownPct > limit;
  return {
    carried: true, carriedSides, hiddenSides: hidden, baseline: b, current: c, rawDrawdownPct,
    adjustedBaselineTotal: adjB, adjustedCurrentTotal: adjC, adjustedDrawdownPct, suppress,
    reason: suppress
      ? `보정 손실률이 임계의 절반(${limit.toFixed(1)}%)보다 얕음 — 보류 가능`
      : `보정 손실률이 ${limit.toFixed(1)}% 이하(모호 구간 또는 임계 초과) — 발동`,
  };
}


/** 알림·사유 문구용 KST 시각. 던지지 않는다. */
export function formatKst(ms: number | null): string {
  if (ms == null) return 'n/a';
  try {
    return `${new Date(ms).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' })} KST`;
  } catch {
    try { return new Date(ms).toISOString(); } catch { return 'n/a'; }
  }
}

/** 이월한 쪽 설명 한 줄 — 예: "기준선(마지막으로 보인 시각 …)·현재(…)". 던지지 않는다. */
export function describeHiddenSides(a: HiddenUsdCarryAssessment): string {
  try {
    const parts: string[] = [];
    for (const n of a.hiddenSides) {
      const s = n === 'baseline' ? a.baseline : a.current;
      parts.push(`${SIDE_LABEL[n]}(마지막으로 보인 시각 ${formatKst(s.lastSeenMs)})`);
    }
    return parts.length > 0 ? parts.join('·') : 'n/a';
  } catch {
    return 'n/a';
  }
}
