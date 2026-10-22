/**
 * T-069 보유 점검 리포트 v0a — 순수 계산부 (DB·파일·네트워크 없음).
 *
 * 입력은 `holdings-report.mjs` 가 읽기 전용 세션으로 SELECT 한 행 그대로다. 같은 입력이면 같은 결과를 낸다
 * (생성 시각은 호출자가 넘긴다 — 이 모듈은 `Date.now()` 를 부르지 않는다).
 *
 * 금액 기준
 *  - `portfolio_snapshots.positions[].price` 는 **원화 환산 단가**다(해외 = USD 시세 × 그 틱 환율).
 *    USD 현금 행의 `price` 가 그 틱의 환율이다(T-056 이후, 2026-10-21 05:18 KST~).
 *  - `position_state.entry_price` 는 KIS 잔고 평균단가다. 국내는 원화, 해외는 **USD 평균단가 × 갱신 시점 환율**
 *    (`kis-overseas.getBalances`). 매수 시점 환율은 어디에도 남아 있지 않다.
 *    → 해외 USD 평균단가 = entry_price ÷ (position_state.updated_at 에 가장 가까운 스냅샷의 USD 행 환율).
 *
 * 손절 공식은 `src/lib/risk/compute.ts`(T-066, 배포·감사 완료)와 **같은 공식을 다시 구현**한 것이다
 * (import 하지 않는다 — 대조용 독립 계산). 바꾸면 compute.ts 와 다시 대조할 것.
 *
 * 이 모듈의 어떤 결과도 주문·매도·알림을 만들지 않는다(표시·판단 입력 전용).
 */

// ─── 상수 (출처를 함께 적는다) ──────────────────────────────────────────────

/** 심볼당 최대 비중 % — `src/lib/risk/defaults.ts` READ_ONLY_POLICY.symbolMaxPct (제안값). 시험이 원본과 대조한다 */
export const SYMBOL_MAX_PCT = 15;
/** 심볼당 최대 비중 % — `docs/trading-strategy.md` §5 문서 정책 */
export const DOC_SYMBOL_MAX_PCT = 30;
/** 섹터 집중 상한 % — T-064 §7.2 제안 */
export const SECTOR_MAX_PCT = 40;
/** 손절폭 입력 상한 — `src/lib/risk/defaults.ts` LIMITS.stopPct.max */
export const STOP_PCT_MAX = 20;
/** 정책 미저장 시 제안값 — `src/lib/risk/defaults.ts` DEFAULT_EDITABLE */
export const DEFAULT_POLICY = Object.freeze({ stopPct: 3, heatCapPct: 2, stopBasis: 'avg' });

/**
 * 섹터 수기 분류 (DB 에 업종 정보가 없다 — `stock_meta` 는 이름만). T-064 §0 의 "반도체·메모리 연동" 묶음을 따른다.
 * 없는 종목은 '미분류' 로 표시하고 추정하지 않는다.
 */
export const SECTOR_MAP = Object.freeze({
  'NAS:MU': '반도체·메모리',
  'NAS:SMH': '반도체·메모리',
  '000660': '반도체·메모리',
  '005930': '반도체·메모리',
  'NYS:ORCL': '소프트웨어·클라우드',
});

/** 탐지 규칙 임계값 — 리포트 '규칙' 절에 그대로 인쇄한다 */
export const RULES = Object.freeze({
  /** R1: 연속 두 스냅샷의 총액 비가 이 밖이면 레벨 급변 시작 (하락 30% / 상승 약 43%) */
  levelShiftLow: 0.7,
  levelShiftHigh: 1 / 0.7,
  /** R2: USD 예수금 0 ↔ X 왕복에서 같은 X 로 볼 허용 오차(USD) */
  usdFlipTolUsd: 0.05,
  /** R2: 왕복으로 판정하는 최소 전환 횟수 */
  usdFlipMinFlips: 2,
  /** R3: 자금 이동 후보로 올리는 최소 크기 — 직전 총액의 1% 와 10만원 중 큰 값 */
  flowMinPct: 1,
  flowMinKrw: 100_000,
  /** R3: 수량 변화가 현금 변화로 상쇄됐다고 보는 허용치 — 수량 변화 금액의 이 비율 이내 (수수료·반올림) */
  tradeOffsetTolPct: 2,
  /** R1b: 보유 구성이 바뀌었다가 이 행 수 이내에 '직전과 똑같은 구성(종목·수량)'으로 돌아오면 일시 구성 이상 */
  transientMaxRows: 6,
  /** USD 평균단가 복원: 복원에 쓴 스냅샷과 position_state.updated_at 의 시차가 이 분을 넘으면 경고 */
  fxGapWarnMin: 60,
  /** USD 평균단가 복원: 센트 정수에서 이만큼(센트 단위) 넘게 벗어나면 경고 */
  centTol: 0.005,
});

const OVERSEAS = /^[A-Z]{3}:[A-Z][A-Z0-9.]*$/;

// ─── 기본 유틸 ─────────────────────────────────────────────────────────────

export const num = (v) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const pos = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
export const floor2 = (n) => Math.floor(n * 100 + 1e-9) / 100;
export const marketOf = (symbol) => (OVERSEAS.test(symbol) ? 'overseas' : 'domestic');

/** DB 의 DATETIME 문자열('YYYY-MM-DD HH:MM:SS', KST) 또는 Date → 비교 가능한 ms (KST 벽시계를 UTC 로 취급) */
export function tsMs(v) {
  if (v instanceof Date) return v.getTime();
  const s = String(v ?? '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
}
/** 표시용 'YYYY-MM-DD HH:MM' */
export function tsLabel(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 16).replace('T', ' ');
  return String(v ?? '').slice(0, 16);
}

// ─── 스냅샷 해석 ───────────────────────────────────────────────────────────

/**
 * portfolio_snapshots 1행 → 구조화.
 * @returns {{id:number, ts:string, total:number, krw:{free:number,locked:number}|null,
 *   usd:{qty:number, fx:number, valueKrw:number, src:string|null}|null,
 *   holdings: Record<string,{qty:number, priceKrw:number|null, valueKrw:number|null, market:string}>}}
 */
export function parseSnapshot(row) {
  let raw = row.positions;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = []; }
  }
  const list = Array.isArray(raw) ? raw : [];
  let krw = null;
  let usd = null;
  const holdings = {};
  for (const p of list) {
    if (!p || typeof p.currency !== 'string' || p.currency === '') continue;
    const cur = p.currency;
    if (cur === 'KRW') {
      krw = { free: num(p.qty) ?? num(p.value_krw) ?? 0, locked: num(p.locked) ?? 0 };
      continue;
    }
    if (cur === 'USD') {
      const qty = num(p.qty) ?? 0;
      const fx = num(p.price);
      usd = { qty, fx: pos(fx) ? fx : null, valueKrw: num(p.value_krw) ?? 0, src: typeof p.src === 'string' ? p.src : null };
      continue;
    }
    const qty = num(p.qty);
    if (qty === null || qty <= 0) continue;
    const price = num(p.price);
    holdings[cur] = {
      qty,
      priceKrw: pos(price) ? price : null,
      valueKrw: num(p.value_krw),
      market: marketOf(cur),
    };
  }
  return { id: Number(row.id), ts: row.ts, source: row.source ?? null, total: num(row.total_krw) ?? 0, krw, usd, holdings };
}

/** 보유 구성 키 — 종목·수량 (단가 무관) */
export function holdingsKey(s) {
  return Object.keys(s.holdings).sort().map((k) => `${k}:${s.holdings[k].qty}`).join('|');
}

// ─── 기준일 원가 스냅샷 ────────────────────────────────────────────────────

/** 시각 t 에 가장 가까운, USD 행(환율)이 있는 스냅샷 */
export function nearestFx(series, t) {
  const target = tsMs(t);
  let best = null;
  for (const s of series) {
    if (!s.usd || !pos(s.usd.fx)) continue;
    const d = Math.abs(tsMs(s.ts) - target);
    if (best === null || d < best.gapMs) best = { fx: s.usd.fx, ts: s.ts, gapMs: d, id: s.id };
  }
  return best;
}

/**
 * 보유별 원가·현재가를 통화별로 분리한다.
 * @param latest parseSnapshot 결과 (기준 스냅샷)
 * @param series parseSnapshot 결과 배열 (환율 시점 대조용)
 * @param states position_state 행 배열
 * @param names {symbol: name}
 * @param fxRow fx_rates 행 (USD 행이 전혀 없을 때만 대체 환율로 쓴다)
 */
export function buildBaseline(latest, series, states, names = {}, fxRow = null, rules = RULES) {
  const stMap = new Map();
  for (const r of states) stMap.set(`${r.symbol}|${r.market}`, r);
  const snapFx = latest.usd && pos(latest.usd.fx) ? latest.usd.fx : null;
  const fallbackFx = fxRow && pos(num(fxRow.rate)) ? num(fxRow.rate) : null;
  const rows = [];
  const notes = [];
  let usedFallbackFx = false;
  // 종목 집합 불일치 (L-4) — position_state 에만 있거나 스냅샷에만 있는 종목
  for (const r of states) {
    if (!(r.symbol in latest.holdings)) notes.push(`${r.symbol}: position_state 에는 있으나 기준 스냅샷 보유 목록에 없음(청산 후 미정리 또는 스냅샷 누락)`);
  }
  for (const [symbol, h] of Object.entries(latest.holdings)) {
    const st = stMap.get(`${symbol}|${h.market}`) ?? null;
    const avgKrw = st && pos(num(st.entry_price)) ? num(st.entry_price) : null;
    const peakKrw = st && pos(num(st.peak_price)) ? num(st.peak_price) : null;
    const stQty = st ? num(st.qty) : null;
    const row = {
      symbol,
      name: names[symbol] ?? null,
      market: h.market,
      currency: h.market === 'overseas' ? 'USD' : 'KRW',
      qty: h.qty,
      stateQty: stQty,
      qtyMismatch: stQty !== null && Math.abs(stQty - h.qty) > 1e-9,
      avgKrw,
      peakKrw,
      priceKrw: h.priceKrw,
      valueKrw: h.priceKrw !== null ? h.priceKrw * h.qty : null,
      firstSeenAt: st ? st.first_seen_at : null,
      stateUpdatedAt: st ? st.updated_at : null,
      holdingDeadline: st ? st.holding_deadline ?? null : null,
      // 해외 전용
      fxNow: null, fxAtAvg: null, fxAtAvgTs: null, fxAtAvgGapMin: null, fxAtAvgSource: null,
      avgUsd: null, priceUsd: null, costUsd: null, valueUsd: null,
      avgUsdCentsOk: null, priceFallbackSuspect: false,
    };
    // 시세 폴백 의심 (L-4) — 스냅샷 크론은 시세 실패 시 현재가 = 평단(원화)으로 기록한다
    if (avgKrw !== null && h.priceKrw !== null && Math.abs(h.priceKrw - avgKrw) < 1e-6) {
      row.priceFallbackSuspect = true;
      notes.push(`${symbol}: 기준 스냅샷 현재가가 평균단가와 정확히 같음 — 시세 조회 실패 폴백 의심(평가손익 0% 가 실제가 아닐 수 있음)`);
    }
    if (h.market === 'overseas') {
      const fxNow = snapFx ?? fallbackFx;
      row.fxNow = fxNow;
      if (!snapFx && fallbackFx) {
        usedFallbackFx = true;
        notes.push(`${symbol}: 기준 스냅샷에 USD 행(환율)이 없어 현재 USD 가격을 fx_rates **현재** 환율로 환산함 — 과거 기준(--as-of) 실행이면 그 시점 환율과 다름`);
      }
      if (fxNow && h.priceKrw !== null) row.priceUsd = h.priceKrw / fxNow;
      if (avgKrw !== null && st) {
        const near = nearestFx(series, st.updated_at);
        if (near) {
          row.fxAtAvg = near.fx;
          row.fxAtAvgTs = near.ts;
          row.fxAtAvgGapMin = Math.round(near.gapMs / 60000);
          row.fxAtAvgSource = 'snapshot_usd_row';
        } else if (fallbackFx) {
          row.fxAtAvg = fallbackFx;
          row.fxAtAvgTs = fxRow.fetched_at;
          row.fxAtAvgGapMin = Math.round(Math.abs(tsMs(fxRow.fetched_at) - tsMs(st.updated_at)) / 60000);
          row.fxAtAvgSource = 'fx_rates_current';
          usedFallbackFx = true;
          notes.push(`${symbol}: USD 행이 있는 스냅샷이 스캔 범위에 없어 USD 평균단가를 fx_rates **현재** 환율로 복원함 — 평균단가 갱신 시점 환율과 다를 수 있음`);
        }
        if (row.fxAtAvg) {
          row.avgUsd = avgKrw / row.fxAtAvg;
          // 무결성 (L-1): KIS 평단(USD)은 센트 단위로 보인다 → 복원값이 센트로 떨어지지 않으면 환율이 어긋났을 수 있다
          const cents = row.avgUsd * 100;
          row.avgUsdCentsOk = Math.abs(cents - Math.round(cents)) <= rules.centTol;
          if (!row.avgUsdCentsOk) notes.push(`${symbol}: 복원한 USD 평균단가(${row.avgUsd.toFixed(4)})가 센트 단위로 떨어지지 않음 — 복원 환율이 entry_price 에 곱해진 환율과 다를 수 있음`);
          if (row.fxAtAvgGapMin !== null && row.fxAtAvgGapMin > rules.fxGapWarnMin) {
            notes.push(`${symbol}: USD 평균단가 복원에 쓴 환율 시각과 평균단가 갱신 시각의 시차 ${row.fxAtAvgGapMin}분 > ${rules.fxGapWarnMin}분 — USD 평균단가 오차 가능`);
          }
        }
      }
      if (row.avgUsd !== null) row.costUsd = row.avgUsd * h.qty;
      if (row.priceUsd !== null) row.valueUsd = row.priceUsd * h.qty;
    }
    if (avgKrw === null) notes.push(`${symbol}: position_state 평균단가 없음 — 원가 계산 불가`);
    if (row.qtyMismatch) notes.push(`${symbol}: 스냅샷 수량(${h.qty})과 position_state 수량(${stQty})이 다름`);
    rows.push(row);
  }
  for (const symbol of Object.keys(latest.holdings)) {
    if (!stMap.has(`${symbol}|${latest.holdings[symbol].market}`)) notes.push(`${symbol}: 기준 스냅샷에는 있으나 position_state 에 행이 없음`);
  }
  rows.sort((a, b) => (b.valueKrw ?? 0) - (a.valueKrw ?? 0));
  return { rows, notes, snapFx, fallbackFx, usedFallbackFx };
}

// ─── 평가손익 ──────────────────────────────────────────────────────────────

/**
 * 종목별 평가손익.
 *  - krw*: compute.ts 와 같은 원화 기준 ((현재가 − 평균단가) × 수량). 해외는 두 값의 환율 시점이 다를 수 있다(T-066 L-1).
 *  - usd*: 해외 종목의 USD 가격 기준 (환율 영향 없음).
 *  - fxTimingPp: 원화 기준 % − USD 기준 % — 평균단가와 현재가의 환율 시점 차이로 생긴 왜곡(%p).
 *  - 매수 시점 환율이 없어 진짜 환차손익은 계산하지 않는다.
 */
export function computePnl(baseline) {
  const rows = baseline.rows.map((r) => {
    const krwUnreal = r.avgKrw !== null && r.priceKrw !== null ? (r.priceKrw - r.avgKrw) * r.qty : null;
    const krwPct = r.avgKrw !== null && r.priceKrw !== null ? ((r.priceKrw - r.avgKrw) / r.avgKrw) * 100 : null;
    const usdUnreal = r.avgUsd !== null && r.priceUsd !== null ? (r.priceUsd - r.avgUsd) * r.qty : null;
    const usdPct = r.avgUsd !== null && r.priceUsd !== null ? ((r.priceUsd - r.avgUsd) / r.avgUsd) * 100 : null;
    return {
      symbol: r.symbol,
      market: r.market,
      costKrw: r.avgKrw !== null ? r.avgKrw * r.qty : null,
      krwUnreal,
      krwPct,
      usdUnreal,
      usdPct,
      usdUnrealKrwAtNow: usdUnreal !== null && r.fxNow ? usdUnreal * r.fxNow : null,
      fxTimingPp: krwPct !== null && usdPct !== null ? krwPct - usdPct : null,
    };
  });
  const sum = (k) => rows.reduce((a, r) => a + (r[k] ?? 0), 0);
  const cost = sum('costKrw');
  const krwUnreal = sum('krwUnreal');
  return {
    rows,
    totalCostKrw: cost,
    totalKrwUnreal: krwUnreal,
    totalKrwPct: cost > 0 ? (krwUnreal / cost) * 100 : null,
    losers: rows.filter((r) => (r.krwPct ?? 0) < 0).length,
  };
}

// ─── 집중도 ────────────────────────────────────────────────────────────────

/**
 * @param usdCashOverride  USD 예수금 값을 다른 가정으로 넣을 때(R2 왕복 대안) — 원화 환산 금액
 */
export function computeConcentration(latest, baseline, usdCashOverride = null) {
  const krwCash = latest.krw ? latest.krw.free : 0;
  const usdCash = usdCashOverride !== null ? usdCashOverride : latest.usd ? latest.usd.valueKrw : 0;
  const stocks = baseline.rows.map((r) => ({ symbol: r.symbol, market: r.market, value: r.valueKrw ?? 0 }));
  const stockValue = stocks.reduce((a, s) => a + s.value, 0);
  const total = stockValue + krwCash + usdCash;
  const pct = (v) => (total > 0 ? (v / total) * 100 : null);
  const bySymbol = stocks
    .map((s) => ({ ...s, pct: pct(s.value), overSymbolMax: (pct(s.value) ?? 0) > SYMBOL_MAX_PCT, overDocMax: (pct(s.value) ?? 0) > DOC_SYMBOL_MAX_PCT }))
    .sort((a, b) => b.value - a.value);
  const sectors = {};
  for (const s of stocks) {
    const k = SECTOR_MAP[s.symbol] ?? '미분류';
    sectors[k] = sectors[k] ?? { sector: k, value: 0, symbols: [] };
    sectors[k].value += s.value;
    sectors[k].symbols.push(s.symbol);
  }
  const bySector = Object.values(sectors)
    .map((x) => ({ ...x, pct: pct(x.value), overSectorMax: (pct(x.value) ?? 0) > SECTOR_MAX_PCT }))
    .sort((a, b) => b.value - a.value);
  const usStocks = stocks.filter((s) => s.market === 'overseas').reduce((a, s) => a + s.value, 0);
  const krStocks = stockValue - usStocks;
  return {
    total,
    snapshotTotal: latest.total,
    stockValue,
    bySymbol,
    bySector,
    byCurrency: [
      { currency: 'USD', value: usStocks + usdCash, pct: pct(usStocks + usdCash), stocks: usStocks, cash: usdCash },
      { currency: 'KRW', value: krStocks + krwCash, pct: pct(krStocks + krwCash), stocks: krStocks, cash: krwCash },
    ],
    overseasStockPct: stockValue > 0 ? (usStocks / stockValue) * 100 : null,
    cash: { krw: krwCash, usd: usdCash, pct: pct(krwCash + usdCash), krwLocked: latest.krw ? latest.krw.locked : 0 },
  };
}

// ─── 손절선 거리 (compute.ts 와 같은 공식) ─────────────────────────────────

export function parsePolicy(row) {
  if (!row) return { status: 'absent', policy: { ...DEFAULT_POLICY }, version: null, updatedAt: null };
  let v = row.value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return { status: 'invalid', policy: { ...DEFAULT_POLICY }, version: null, updatedAt: null }; }
  }
  const stopPct = num(v?.stopPct);
  const heatCapPct = num(v?.heatCapPct);
  const basis = v?.stopBasis;
  if (stopPct === null || heatCapPct === null || (basis !== 'avg' && basis !== 'peak')) {
    return { status: 'invalid', policy: { ...DEFAULT_POLICY }, version: null, updatedAt: null };
  }
  return { status: 'ok', policy: { stopPct, heatCapPct, stopBasis: basis }, version: num(v.version), updatedAt: v.updatedAt ?? null };
}

function refOf(avg, peak, price, basis) {
  if (basis === 'avg') return pos(avg) ? avg : null;
  if (!pos(peak)) return null;
  return pos(price) ? Math.max(peak, price) : peak;
}

function heatAt(holdings, stopPct, basis) {
  let s = 0;
  for (const h of holdings) {
    if (!pos(h.avgKrw)) continue;
    const ref = refOf(h.avgKrw, h.peakKrw, h.priceKrw, basis);
    if (ref === null) continue;
    s += Math.max(0, h.avgKrw - ref * (1 - stopPct / 100)) * h.qty;
  }
  return s;
}

/**
 * 손절선 거리·손절 합. compute.ts `computeRisk` 와 같은 공식(원화 기준) + 해외 USD 기준 거리.
 * @param totalKrw 분모 총자산 (compute.ts 는 최신 스냅샷 total_krw 를 쓴다)
 */
export function computeStops(baseline, totalKrw, policy) {
  const { stopPct, heatCapPct, stopBasis } = policy;
  const rows = baseline.rows.map((h) => {
    const ref = refOf(h.avgKrw, h.peakKrw, h.priceKrw, stopBasis);
    const out = { symbol: h.symbol, market: h.market, refKrw: ref, stopKrw: null, below: false, near: false, distPct: null, underPct: null, pnlAtStopKrw: null, pnlAtStopPct: null, stopUsd: null, distPctUsd: null, underPctUsd: null, belowUsd: null };
    if (!pos(h.avgKrw) || ref === null) return out;
    const stop = ref * (1 - stopPct / 100);
    out.stopKrw = stop;
    out.pnlAtStopKrw = (stop - h.avgKrw) * h.qty;
    out.pnlAtStopPct = ((stop - h.avgKrw) / h.avgKrw) * 100;
    if (pos(h.priceKrw)) {
      out.below = h.priceKrw <= stop;
      out.near = !out.below && ((h.priceKrw - stop) / h.priceKrw) * 100 < 1;
      out.distPct = out.below ? null : ((h.priceKrw - stop) / h.priceKrw) * 100;
      out.underPct = out.below ? ((stop - h.priceKrw) / stop) * 100 : null;
    }
    // 해외: USD 기준(평균단가 기준일 때만 — 고점은 원화로만 기록돼 USD 고점을 모른다)
    if (h.market === 'overseas' && stopBasis === 'avg' && pos(h.avgUsd) && pos(h.priceUsd)) {
      out.stopUsd = h.avgUsd * (1 - stopPct / 100);
      out.belowUsd = h.priceUsd <= out.stopUsd;
      // 원화 열과 같은 정의: 위면 (현재가−손절가)÷현재가, 아래면 (손절가−현재가)÷손절가
      out.distPctUsd = out.belowUsd ? null : ((h.priceUsd - out.stopUsd) / h.priceUsd) * 100;
      out.underPctUsd = out.belowUsd ? ((out.stopUsd - h.priceUsd) / out.stopUsd) * 100 : null;
    }
    return out;
  });
  const heatRows = rows.filter((r) => r.pnlAtStopKrw !== null);
  const heatKrw = heatRows.reduce((a, r) => a + Math.max(0, -r.pnlAtStopKrw), 0);
  const costKrw = baseline.rows.filter((h) => heatRows.some((r) => r.symbol === h.symbol)).reduce((a, h) => a + h.avgKrw * h.qty, 0);
  const total = pos(totalKrw) ? totalKrw : 0;
  const capKrw = (total * heatCapPct) / 100;
  let maxStopPct = null;
  if (total > 0 && heatRows.length > 0) {
    if (stopBasis === 'avg') {
      maxStopPct = costKrw > 0 ? Math.min(floor2((heatCapPct * total) / costKrw), STOP_PCT_MAX) : null;
    } else {
      const H = baseline.rows;
      if (heatAt(H, STOP_PCT_MAX, 'peak') <= capKrw) maxStopPct = STOP_PCT_MAX;
      else {
        let lo = 0, hi = STOP_PCT_MAX;
        for (let i = 0; i < 40; i++) {
          const mid = (lo + hi) / 2;
          if (heatAt(H, mid, 'peak') <= capKrw) lo = mid; else hi = mid;
        }
        maxStopPct = floor2(lo);
      }
    }
  }
  const below = rows.filter((r) => r.below);
  return {
    policy,
    rows,
    totalKrw: total,
    costKrw,
    heatKrw,
    heatPct: total > 0 ? (heatKrw / total) * 100 : null,
    capKrw,
    usagePct: capKrw > 0 ? (heatKrw / capKrw) * 100 : null,
    over: total > 0 && heatKrw > capKrw,
    belowCount: below.length,
    belowSymbols: below.map((r) => r.symbol),
    maxStopPct,
  };
}

// ─── 스냅샷 신뢰도: R1 레벨 급변 ───────────────────────────────────────────

/**
 * R1 — 연속 두 스냅샷의 총액 비가 [levelShiftLow, levelShiftHigh] 밖이면 그 행부터 '레벨 급변 구간'을 연다.
 * 기준선 = 급변 직전 행의 총액. 이후 행의 총액 ÷ 기준선이 다시 범위 안으로 돌아오는 첫 행 직전까지가 구간이다.
 * 끝까지 돌아오지 않으면 open=true (입출금 같은 실제 레벨 변화일 수 있어 사용자 확인 대상).
 * 구간 행은 **손익·낙폭 계산 제외 후보**다(삭제하지 않는다).
 */
export function detectLevelShifts(series, rules = RULES) {
  const segs = [];
  let i = 1;
  while (i < series.length) {
    const prev = series[i - 1];
    const cur = series[i];
    const r = prev.total > 0 ? cur.total / prev.total : null;
    if (r !== null && (r < rules.levelShiftLow || r > rules.levelShiftHigh)) {
      const baseline = prev.total;
      let j = i;
      while (j < series.length) {
        const q = series[j].total / baseline;
        if (q >= rules.levelShiftLow && q <= rules.levelShiftHigh) break;
        j++;
      }
      const rows = series.slice(i, j);
      const vanished = Object.keys(prev.holdings).filter((s) => !(s in cur.holdings));
      const appeared = j < series.length ? Object.keys(series[j].holdings).filter((s) => !(s in series[j - 1].holdings)) : [];
      const cashBefore = (prev.krw ? prev.krw.free + prev.krw.locked : 0) + (prev.usd ? prev.usd.valueKrw : 0);
      const cashAfter = (cur.krw ? cur.krw.free + cur.krw.locked : 0) + (cur.usd ? cur.usd.valueKrw : 0);
      const vanishedValue = vanished.reduce((a, s) => a + (prev.holdings[s].valueKrw ?? 0), 0);
      const usdRowMissing = !prev.usd && !cur.usd;
      let cause = '원인 미상(전 종목 유지 — 단가·단위 이상 의심)';
      if (vanished.length > 0 && cashAfter - cashBefore < vanishedValue * 0.5) {
        cause = usdRowMissing && vanished.some((s) => marketOf(s) === 'overseas')
          ? '해외 보유 소실·현금 미반영 — USD 예수금이 스냅샷에 없던 시기(T-056 이전)의 해외 매도 대금 미기록으로 추정'
          : '보유 소실·현금 미반영';
      }
      segs.push({
        startId: cur.id,
        startTs: cur.ts,
        endId: rows[rows.length - 1].id,
        endTs: rows[rows.length - 1].ts,
        rows: rows.length,
        open: j >= series.length,
        recoverId: j < series.length ? series[j].id : null,
        recoverTs: j < series.length ? series[j].ts : null,
        baselineTotal: baseline,
        minRatio: Math.min(...rows.map((x) => x.total / baseline)),
        maxRatio: Math.max(...rows.map((x) => x.total / baseline)),
        vanished,
        appeared,
        vanishedPctOfBaseline: baseline > 0 ? (vanishedValue / baseline) * 100 : null,
        cause,
        ids: rows.map((x) => x.id),
      });
      // 회복 행(j)은 구간을 닫는 단계이지 새 급변이 아니다 → 그다음 행부터 다시 본다
      i = j + 1;
      continue;
    }
    i++;
  }
  return segs;
}

// ─── 스냅샷 신뢰도: R1b 일시 구성 이상 ─────────────────────────────────────

/**
 * R1b — 보유 구성(종목·수량)이 바뀐 뒤 transientMaxRows 행 이내에 **직전과 똑같은 구성**으로 돌아오면,
 * 그 사이 행들을 '일시 구성 이상'(한쪽 시장 잔고 조회 실패·다른 응답 혼입 추정)으로 표시한다.
 * 실제로 같은 수량을 팔았다가 되산 경우도 걸릴 수 있어 '제외 후보'로만 둔다.
 */
export function detectTransientComposition(series, rules = RULES) {
  const runs = [];
  let i = 1;
  while (i < series.length) {
    const baseKey = holdingsKey(series[i - 1]);
    if (holdingsKey(series[i]) === baseKey) { i++; continue; }
    let j = -1;
    for (let k = i + 1; k < series.length && k <= i + rules.transientMaxRows; k++) {
      if (holdingsKey(series[k]) === baseKey) { j = k; break; }
    }
    if (j < 0) { i++; continue; }
    const rows = series.slice(i, j);
    const prev = series[i - 1];
    const changed = new Set();
    for (const r of rows) {
      for (const s of new Set([...Object.keys(prev.holdings), ...Object.keys(r.holdings)])) {
        if ((prev.holdings[s]?.qty ?? 0) !== (r.holdings[s]?.qty ?? 0)) changed.add(s);
      }
    }
    runs.push({
      startId: rows[0].id, startTs: rows[0].ts, endId: rows[rows.length - 1].id, endTs: rows[rows.length - 1].ts,
      rows: rows.length, sources: [...new Set(rows.map((r) => r.source ?? '-'))],
      changedSymbols: [...changed].sort(),
      maxDevPct: prev.total > 0 ? Math.max(...rows.map((r) => Math.abs(r.total / prev.total - 1) * 100)) : null,
      ids: rows.map((r) => r.id),
    });
    i = j + 1;
  }
  return runs;
}

// ─── 스냅샷 신뢰도: R2 USD 예수금 왕복 ─────────────────────────────────────

const sameStockQty = (a, b) => {
  const ka = Object.keys(a.holdings);
  const kb = Object.keys(b.holdings);
  if (ka.length !== kb.length) return false;
  return ka.every((s) => s in b.holdings && Math.abs(a.holdings[s].qty - b.holdings[s].qty) < 1e-9);
};

/**
 * R2 — USD 예수금 행이 있는 스냅샷에서 수량이 0 ↔ X(같은 값, 허용 오차 usdFlipTolUsd) 로 오가는데
 * 그 사이 보유 수량 변화가 없으면 '왕복'. 전환이 usdFlipMinFlips 회 이상이면 첫 전환 직전 행부터 마지막 행까지를
 * 'USD 예수금 불확실 구간'으로 표시한다(어느 쪽이 실제 잔액인지 데이터로는 모름).
 * 이 구간의 변화율·낙폭은 'USD 예수금 제외 총액'으로 계산하기를 제안한다(제외 후보 — 데이터는 지우지 않음).
 */
export function detectUsdFlips(series, rules = RULES) {
  const usdRows = series.filter((s) => s.usd);
  const flips = [];
  for (let i = 1; i < usdRows.length; i++) {
    const a = usdRows[i - 1];
    const b = usdRows[i];
    const qa = a.usd.qty;
    const qb = b.usd.qty;
    const zeroA = Math.abs(qa) < 1e-9;
    const zeroB = Math.abs(qb) < 1e-9;
    if (zeroA === zeroB) continue;
    const x = zeroA ? qb : qa;
    flips.push({ fromId: a.id, toId: b.id, fromTs: a.ts, toTs: b.ts, direction: zeroA ? '0→X' : 'X→0', x, stockQtyUnchanged: sameStockQty(a, b) });
  }
  // 같은 X 로 묶는다
  const groups = [];
  for (const f of flips) {
    let g = groups.find((g) => Math.abs(g.x - f.x) <= rules.usdFlipTolUsd);
    if (!g) { g = { x: f.x, flips: [] }; groups.push(g); }
    g.flips.push(f);
  }
  const patterns = groups
    .filter((g) => g.flips.filter((f) => f.stockQtyUnchanged).length >= rules.usdFlipMinFlips)
    .map((g) => {
      const firstFrom = g.flips[0].fromId;
      const startIdx = usdRows.findIndex((s) => s.id === firstFrom);
      const rows = usdRows.slice(startIdx);
      const nonzeroHours = new Set();
      const zeroHours = new Set();
      for (const s of rows) {
        const h = String(s.ts).slice(11, 13);
        if (Math.abs(s.usd.qty) < 1e-9) zeroHours.add(h); else nonzeroHours.add(h);
      }
      const fxs = rows.map((s) => s.usd.fx).filter(pos);
      const fx = fxs.length ? fxs[fxs.length - 1] : null;
      const last = rows[rows.length - 1];
      return {
        xUsd: g.x,
        xKrw: fx ? g.x * fx : null,
        flips: g.flips.length,
        flipsWithoutTrade: g.flips.filter((f) => f.stockQtyUnchanged).length,
        startId: rows[0].id,
        startTs: rows[0].ts,
        endId: last.id,
        endTs: last.ts,
        rows: rows.length,
        zeroRows: rows.filter((s) => Math.abs(s.usd.qty) < 1e-9).length,
        nonzeroHoursKst: [...nonzeroHours].sort(),
        zeroHoursKst: [...zeroHours].sort(),
        latestIsZero: Math.abs(last.usd.qty) < 1e-9,
        flipList: g.flips,
        ids: rows.map((s) => s.id),
      };
    });
  return { usdRowCount: usdRows.length, firstUsdRowTs: usdRows[0]?.ts ?? null, flips, patterns };
}

// ─── 스냅샷 신뢰도: R3 자금 이동 분해 ──────────────────────────────────────

/**
 * 연속 두 스냅샷의 총액 변화를 나눈다(항등식: Δ총액 = 시세효과 + 환율효과(USD 현금) + 수량효과 + 현금흐름 + 잔차).
 *  - 시세효과: 양쪽에 있는 종목의 직전 수량 × 단가 변화 (해외 단가에는 환율 변화도 섞여 있다)
 *  - 수량효과: 수량 변화 × 현재 단가 + 신규 종목 평가액 − 사라진 종목의 직전 평가액
 *  - 현금흐름: 원화(예수금+결제대기) 변화 + USD 수량 변화 × 현재 환율 (양쪽에 USD 행이 있을 때만)
 *  - 외부 자금 이동 후보 = 수량효과 + 현금흐름. 앱 밖 매매라도 계좌 안에서 끝났으면 0 근처다.
 */
export function decomposeStep(prev, cur) {
  let priceEffect = 0;
  let qtyEffect = 0;
  const changes = [];
  for (const [s, c] of Object.entries(cur.holdings)) {
    const p = prev.holdings[s];
    const pc = c.priceKrw ?? 0;
    if (p) {
      const pp = p.priceKrw ?? 0;
      priceEffect += p.qty * (pc - pp);
      if (Math.abs(c.qty - p.qty) > 1e-9) {
        qtyEffect += (c.qty - p.qty) * pc;
        changes.push({ symbol: s, from: p.qty, to: c.qty, valueKrw: (c.qty - p.qty) * pc });
      }
    } else {
      qtyEffect += c.qty * pc;
      changes.push({ symbol: s, from: 0, to: c.qty, valueKrw: c.qty * pc });
    }
  }
  for (const [s, p] of Object.entries(prev.holdings)) {
    if (!(s in cur.holdings)) {
      const v = p.qty * (p.priceKrw ?? 0);
      qtyEffect -= v;
      changes.push({ symbol: s, from: p.qty, to: 0, valueKrw: -v });
    }
  }
  const krwKnown = !!(prev.krw && cur.krw);
  const krwFlow = krwKnown ? (cur.krw.free + cur.krw.locked) - (prev.krw.free + prev.krw.locked) : 0;
  const usdKnown = !!(prev.usd && cur.usd && pos(cur.usd.fx));
  const usdQtyDelta = usdKnown ? cur.usd.qty - prev.usd.qty : null;
  const usdFlow = usdKnown ? usdQtyDelta * cur.usd.fx : 0;
  const fxEffect = usdKnown && pos(prev.usd.fx) ? prev.usd.qty * (cur.usd.fx - prev.usd.fx) : 0;
  const usdRowChange = !!prev.usd !== !!cur.usd;
  // 총액에는 KRW 결제대기(locked)가 들어가지 않으므로 잔차 계산 땐 free 만 비교한다
  const krwFreeFlow = krwKnown ? cur.krw.free - prev.krw.free : 0;
  const dTotal = cur.total - prev.total;
  const usdValueDelta = (cur.usd ? cur.usd.valueKrw : 0) - (prev.usd ? prev.usd.valueKrw : 0);
  const residual = dTotal - priceEffect - qtyEffect - krwFreeFlow - usdValueDelta;
  return {
    prevId: prev.id, curId: cur.id, prevTs: prev.ts, curTs: cur.ts,
    prevTotal: prev.total, curTotal: cur.total, dTotal,
    priceEffect, fxEffect, qtyEffect, krwFlow, usdFlow, usdQtyDelta, krwKnown, usdKnown, usdRowChange,
    externalCandidate: qtyEffect + krwFlow + usdFlow,
    residual,
    changes,
  };
}

/** R3 — 자금 이동 의심 단계를 골라 분류한다. levelSegs·usdFlip 결과로 원인을 연결한다 */
export function detectFlows(series, levelSegs = [], usdFlip = { patterns: [] }, transient = [], rules = RULES) {
  const steps = [];
  for (let i = 1; i < series.length; i++) steps.push(decomposeStep(series[i - 1], series[i]));
  const flipIds = new Set();
  for (const p of usdFlip.patterns) for (const f of p.flipList) flipIds.add(`${f.fromId}>${f.toId}`);
  const transientIds = new Set(transient.flatMap((r) => r.ids));
  const events = [];
  let internalTrades = 0;
  let transientSteps = 0;
  for (const st of steps) {
    // R1b 구간에 들고 나는 단계는 자금 이동이 아니라 기록 이상으로 본다(R1b 목록에 따로 나온다)
    if (transientIds.has(st.prevId) || transientIds.has(st.curId)) { transientSteps++; continue; }
    const threshold = Math.max((Math.abs(st.prevTotal) * rules.flowMinPct) / 100, rules.flowMinKrw);
    const hasQty = st.changes.length > 0;
    const overseasChanged = st.changes.some((c) => marketOf(c.symbol) === 'overseas');
    const isFlip = flipIds.has(`${st.prevId}>${st.curId}`);
    const big = Math.abs(st.externalCandidate) >= threshold;
    const gross = st.changes.reduce((a, c) => a + Math.abs(c.valueKrw), 0);
    const offset = hasQty && Math.abs(st.externalCandidate) <= Math.max((gross * rules.tradeOffsetTolPct) / 100, rules.flowMinKrw);
    let type = null;
    if (isFlip && !hasQty) type = 'usd_flip';
    else if (hasQty && overseasChanged && !st.usdKnown && big) type = 'overseas_trade_usd_unrecorded';
    else if (hasQty && offset) { internalTrades++; continue; }
    else if (hasQty && big) type = 'unexplained_with_trade';
    else if (!hasQty && st.usdRowChange) type = null; // USD 행 시작/종료 — 기록 방식 변화(T-056 배포)
    else if (!hasQty && big && Math.abs(st.krwFlow) >= threshold * 0.5 && Math.abs(st.usdFlow) < threshold * 0.5) type = 'krw_cash_change';
    else if (!hasQty && big) type = 'usd_cash_change';
    if (!type) continue;
    const seg = levelSegs.find((s) => s.ids.includes(st.curId) || s.recoverId === st.curId);
    events.push({ ...st, type, threshold, levelSegStartId: seg ? seg.startId : null, candidatePct: st.prevTotal > 0 ? (st.externalCandidate / st.prevTotal) * 100 : null });
  }
  return { steps, events, internalTrades, transientSteps };
}

/** R1·R1b·R2·R3 를 한 번에 — 제외 후보 id 집합 포함 */
export function analyzeSnapshots(series, rules = RULES) {
  const transient = detectTransientComposition(series, rules);
  const levelSegs = detectLevelShifts(series, rules);
  const usdFlip = detectUsdFlips(series, rules);
  const flows = detectFlows(series, levelSegs, usdFlip, transient, rules);
  const excludedIds = new Set([...levelSegs.flatMap((s) => s.ids), ...transient.flatMap((r) => r.ids)]);
  return { transient, levelSegs, usdFlip, flows, excludedIds };
}

export const FLOW_TYPE_LABEL = Object.freeze({
  usd_flip: 'USD 예수금 0↔X 왕복(R2)',
  overseas_trade_usd_unrecorded: '해외 매매 — USD 예수금 미기록 시기(대금이 총액에서 빠지거나 들어옴)',
  unexplained_with_trade: '매매와 현금 변화가 맞지 않음(입출금·환전 동반 의심)',
  krw_cash_change: '원화 예수금 변화(매매 없음) — 원화 입출금 의심',
  usd_cash_change: 'USD 예수금 변화(매매 없음) — 환전·외화 입출금 의심',
});

// ─── 기간 요약·일별 지수 ───────────────────────────────────────────────────

/**
 * 기간 [fromTs, toTs] 의 총액 변화 = 시세효과 + 외부 자금 이동 후보 + 기타.
 * 기타 = 결제대기(locked) 변화·USD 현금 환율효과·USD 행 기록 시작/종료·반올림 (Δ총액 − 시세 − 외부 후보로 정의 — 항등).
 */
export function summarizeWindow(series, steps, fromTs, toTs) {
  const a = tsMs(fromTs), b = tsMs(toTs);
  const inWin = series.filter((s) => tsMs(s.ts) >= a && tsMs(s.ts) <= b);
  if (inWin.length < 2) return null;
  const ids = new Set(inWin.map((s) => s.id));
  let price = 0, ext = 0;
  for (const st of steps) {
    if (!ids.has(st.prevId) || !ids.has(st.curId)) continue;
    price += st.priceEffect;
    ext += st.externalCandidate;
  }
  const first = inWin[0], last = inWin[inWin.length - 1];
  const d = last.total - first.total;
  const pct = (v) => (first.total > 0 ? (v / first.total) * 100 : null);
  return {
    fromTs: first.ts, toTs: last.ts, rows: inWin.length,
    startTotal: first.total, endTotal: last.total, dTotal: d,
    changePct: pct(d),
    priceEffect: price, priceEffectPct: pct(price),
    externalCandidate: ext, externalCandidatePct: pct(ext),
    other: d - price - ext, otherPct: pct(d - price - ext),
  };
}

/** 날짜별 마지막 스냅샷 → 지수(첫날=100). 제외 후보·USD 불확실 표시 */
export function dailyIndex(series, excluded, usdFlip) {
  const usdUnc = new Set(usdFlip.patterns.flatMap((p) => p.ids));
  const byDay = new Map();
  for (const s of series) byDay.set(String(s.ts).slice(0, 10), s);
  const days = [...byDay.entries()];
  const firstClean = days.find(([, s]) => !excluded.has(s.id));
  const base = firstClean ? firstClean[1].total : null;
  const baseEx = firstClean ? firstClean[1].total - (firstClean[1].usd ? firstClean[1].usd.valueKrw : 0) : null;
  return days.map(([day, s]) => ({
    day,
    id: s.id,
    ts: s.ts,
    index: base ? (s.total / base) * 100 : null,
    indexExUsdCash: baseEx ? ((s.total - (s.usd ? s.usd.valueKrw : 0)) / baseEx) * 100 : null,
    excluded: excluded.has(s.id),
    usdUncertain: usdUnc.has(s.id),
    holdings: Object.keys(s.holdings).length,
  }));
}
