/**
 * T-096 포트폴리오 시뮬레이션(2차 관문, §A-2·§B-6). 이벤트 기반·일별 평가. 순수 함수.
 *
 * 하루 처리 순서(시장 달력의 날짜 d):
 *   1) 진입: 전날 종가에 결정된 주문 중 실행일이 d 인 것 — 우선순위(score 오름차순, 동률 종목코드) 순서로
 *      거래 불가·갭·유동성 필터 → 정수 주식 = floor(min(슬롯 금액, 현금) / (시가×(1+왕복/2))).
 *      슬롯 금액으로 1주도 못 사면 priceAboveSlot(P4 입력), 현금이 모자라 1주도 못 사면 cash 로 센다. 현금은 음수가 되지 않는다.
 *   2) 청산: 보유 종목의 d 봉이 거래 가능하면 손절(진입 당일 포함, 손절 먼저) → 아니면 계획 청산일(D0+hold) 이후 첫 거래 가능 봉 종가.
 *      매도 비용 = (왕복 또는 손절 비용) − 매수 때 낸 왕복/2.
 *   3) 평가: 현금 + Σ 보유 수량 × 그날까지 마지막 종가 (보유 중 평가손 포함 → MDD 가 이것을 반영).
 *   4) 신호: D0 = d 인 신호 — 먼저 재발화 차단(v1.1 ⑧ 확정): 종목별 마지막 **에피소드 시작** D0 위치와의 거리가 cooldownBars 이하면
 *      cooldown 으로 빼고(시작 위치 갱신 없음 — episodes.toEpisodes 와 같은 규칙, 그래서 1차·2차 관문의 표본 정의가 같다),
 *      아니면 그 신호가 새 에피소드 시작(위치 갱신). 그다음 이미 보유·주문 중인 종목 제외, 빈 슬롯만큼 우선순위로 채택,
 *      남는 신호는 noSlot. 슬롯 금액 = 그날 평가액 × slotPct. 실행일 = 그 종목의 다음 봉 날짜.
 *   정수 주식: integerShares=true(registry)면 floor, false 면 분수 수량.
 */
import { roundTrip, stopCost } from './costs';
import { adtv, gapSkip } from './fill';
import { calendarOf, indexOfDate, isTradable } from './frames';
import type { Frame, PortfolioConfig, Series, Signal, Trade } from './types';

export interface SimSkipped { priceAboveSlot: number; noSlot: number; liquidity: number; gap: number; cash: number; noForwardBars: number; cooldown: number }
export interface OpenPosition { symbol: string; d0: string; entryDate: string; entryPrice: number; shares: number }
export interface SimResult { equity: Series; trades: Trade[]; open: OpenPosition[]; skipped: SimSkipped; entries: number }

interface Pos { symbol: string; f: Frame; d0: string; entryIdx: number; exitIdx: number; shares: number; entryPrice: number; stopPrice: number | null; paid: number }
interface Pending { symbol: string; f: Frame; d0: string; d0Index: number; execDate: string; slotAmount: number; score: number }

const byPriority = (a: { score: number; symbol: string }, b: { score: number; symbol: string }) =>
  a.score - b.score || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0);

export function validateConfig(cfg: PortfolioConfig): void {
  if (!(cfg.capital > 0)) throw new RangeError('capital must be > 0');
  if (!Number.isInteger(cfg.slots) || cfg.slots < 1) throw new RangeError('slots must be a positive integer');
  if (!(cfg.slotPct > 0 && cfg.slotPct <= 1)) throw new RangeError('slotPct must be in (0,1]');
  if (!Number.isInteger(cfg.hold) || cfg.hold < 1) throw new RangeError('hold must be a positive integer');
  if (cfg.stopPct !== null && !(cfg.stopPct > 0 && cfg.stopPct < 1)) throw new RangeError('stopPct must be in (0,1)');
  if (cfg.startDate > cfg.endDate) throw new RangeError('startDate after endDate');
  if (!Number.isInteger(cfg.cooldownBars) || cfg.cooldownBars < 0) throw new RangeError('cooldownBars must be a non-negative integer');
  if (typeof cfg.integerShares !== 'boolean') throw new RangeError('integerShares must be boolean');
}

export function simulate(frames: Frame[], signalsByDate: Map<string, Signal[]>, cfg: PortfolioConfig): SimResult {
  validateConfig(cfg);
  if (new Set(frames.map((f) => f.market)).size > 1) throw new Error('simulate: frames must belong to one market');
  const bySym = new Map(frames.map((f) => [f.symbol, f]));
  const cal = calendarOf(frames).filter((d) => d >= cfg.startDate && d <= cfg.endDate);
  const half = roundTrip(cfg.cost) / 2;
  let cash = cfg.capital;
  let positions: Pos[] = [];
  let pending: Pending[] = [];
  const lastClose = new Map<string, number>();
  const trades: Trade[] = [];
  const skipped: SimSkipped = { priceAboveSlot: 0, noSlot: 0, liquidity: 0, gap: 0, cash: 0, noForwardBars: 0, cooldown: 0 };
  const lastStart = new Map<string, number>();
  const qty = (x: number) => (cfg.integerShares ? Math.floor(x) : x);
  let entries = 0;
  const dates: string[] = [];
  const values: number[] = [];

  for (const d of cal) {
    // 1) 진입
    const todays = pending.filter((p) => p.execDate === d).sort(byPriority);
    pending = pending.filter((p) => p.execDate !== d);
    for (const p of todays) {
      const f = p.f, e = p.d0Index + 1, b = f.bars[e];
      if (!isTradable(f, e)) { skipped.liquidity++; continue; }
      if (gapSkip(f.bars[p.d0Index].close, b.open, cfg.gapUp, cfg.gapDown, cfg.gapBoundary)) { skipped.gap++; continue; }
      const a = adtv(f, p.d0Index, cfg.adtvWindow);
      if (a === null || p.slotAmount > a * cfg.adtvMaxShare) { skipped.liquidity++; continue; }
      if (positions.length >= cfg.slots) { skipped.noSlot++; continue; }
      const unit = b.open * (1 + half);
      if (cfg.integerShares && Math.floor(p.slotAmount / unit) < 1) { skipped.priceAboveSlot++; continue; }
      const shares = qty(Math.min(p.slotAmount, cash) / unit);
      if (cfg.integerShares ? shares < 1 : !(shares > 0)) { skipped.cash++; continue; }
      const paid = shares * unit;
      cash -= paid;
      entries++;
      positions.push({
        symbol: p.symbol, f, d0: p.d0, entryIdx: e, exitIdx: p.d0Index + cfg.hold, shares, entryPrice: b.open,
        stopPrice: cfg.stopPct === null ? null : b.open * (1 - cfg.stopPct), paid,
      });
    }
    // 2) 청산
    const still: Pos[] = [];
    for (const q of positions) {
      const k = indexOfDate(q.f, d);
      if (k < 0 || k < q.entryIdx || !isTradable(q.f, k)) { still.push(q); continue; }
      const b = q.f.bars[k];
      let px: number | null = null;
      let kind: 'time' | 'stop' = 'time';
      if (q.stopPrice !== null && b.low <= q.stopPrice) { px = b.open < q.stopPrice ? b.open : q.stopPrice; kind = 'stop'; }
      else if (k >= q.exitIdx) px = b.close;
      if (px === null) { still.push(q); continue; }
      const total = kind === 'stop' ? stopCost(cfg.cost) : roundTrip(cfg.cost);
      const proceeds = q.shares * px * (1 - (total - half));
      cash += proceeds;
      trades.push({
        symbol: q.symbol, d0: q.d0, entryDate: q.f.bars[q.entryIdx].date, entryPrice: q.entryPrice, shares: q.shares,
        exitDate: d, exitPrice: px, exitKind: kind, pnl: proceeds - q.paid, netRet: px / q.entryPrice - 1 - total,
      });
    }
    positions = still;
    // 3) 평가
    for (const f of frames) {
      const k = indexOfDate(f, d);
      if (k >= 0 && !f.excluded[k] && f.bars[k].close > 0) lastClose.set(f.symbol, f.bars[k].close);
    }
    let eq = cash;
    for (const q of positions) eq += q.shares * (lastClose.get(q.symbol) ?? q.entryPrice);
    if (cash < -1e-9) throw new Error('invariant: cash < 0');
    dates.push(d);
    values.push(eq);
    // 4) 신호(D0 = d) → 다음 봉 주문
    const held = new Set([...positions.map((q) => q.symbol), ...pending.map((p) => p.symbol)]);
    const valid = (signalsByDate.get(d) || []).filter((s) => s.d0 === d && bySym.has(s.symbol) && bySym.get(s.symbol)!.bars[s.d0Index]?.date === d).sort(byPriority);
    const seen = new Set<string>();
    const starts: Signal[] = [];
    for (const s of valid) {
      if (seen.has(s.symbol)) continue;
      seen.add(s.symbol);
      const last = lastStart.get(s.symbol);
      if (cfg.cooldownBars > 0 && last !== undefined && s.d0Index - last <= cfg.cooldownBars) { skipped.cooldown++; continue; }
      lastStart.set(s.symbol, s.d0Index);
      starts.push(s);
    }
    const uniq = starts.filter((s) => !held.has(s.symbol));
    const free = Math.max(0, cfg.slots - positions.length - pending.length);
    const take = uniq.slice(0, free);
    skipped.noSlot += uniq.length - take.length;
    for (const s of take) {
      const f = bySym.get(s.symbol)!;
      const e = s.d0Index + 1;
      if (e >= f.bars.length || f.bars[e].date > cfg.endDate) { skipped.noForwardBars++; continue; }
      pending.push({ symbol: s.symbol, f, d0: d, d0Index: s.d0Index, execDate: f.bars[e].date, slotAmount: eq * cfg.slotPct, score: s.score });
    }
  }
  const open: OpenPosition[] = positions.map((q) => ({ symbol: q.symbol, d0: q.d0, entryDate: q.f.bars[q.entryIdx].date, entryPrice: q.entryPrice, shares: q.shares }));
  return { equity: { dates, values }, trades, open, skipped, entries };
}
