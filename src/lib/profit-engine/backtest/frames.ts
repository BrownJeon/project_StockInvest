/**
 * T-096 일봉 행 → Frame 변환과 날짜 도구. 순수 함수(입출력 없음).
 *
 * 값 규칙(§A-2 데이터 품질): adj_stale·adj_orphan 행은 excluded(빈틈), corp_action_suspect 는 corpSuspect 표시(포함),
 * zero_volume(또는 거래량 0)·가격 결측 봉은 진입·청산 불가일(isTradable=false).
 */
import type { Bar, Frame, Market } from './types';

export const FLAG_CORP = 'corp_action_suspect';
export const FLAG_ZERO_VOLUME = 'zero_volume';
export const FLAG_ADJ_STALE = 'adj_stale';
export const FLAG_ADJ_ORPHAN = 'adj_orphan';
/** P1(postmortem-core `BAR_GAP_DAYS`)과 같은 값 — 연속한 두 봉의 달력 간격이 이보다 크면 결측 구간으로 본다. */
export const BAR_GAP_DAYS = 9;

export interface BarRow {
  market: string;
  symbol: string;
  d: string;
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
  volume: unknown;
  turnover?: unknown;
  flags: unknown;
}

const toNum = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

export function hasFlag(flags: string | null, f: string): boolean {
  if (!flags) return false;
  return flags.split(',').map((x) => x.trim()).includes(f);
}

/**
 * DB 행(시장·종목·날짜 오름차순일 필요 없음)을 종목별 Frame 으로 묶는다.
 * @param exclude 유니버스에서 뺄 종목(벤치마크 ETF 등) · until 이 날짜 뒤 봉은 버린다(as-of 고정).
 */
export function buildFrames(rows: BarRow[], opts: { exclude?: ReadonlySet<string>; until?: string } = {}): Frame[] {
  const by = new Map<string, { market: Market; symbol: string; bars: Bar[] }>();
  for (const r of rows) {
    const market = String(r.market);
    if (market !== 'US' && market !== 'KR') throw new Error(`알 수 없는 시장: ${market}`);
    const symbol = String(r.symbol);
    if (opts.exclude && opts.exclude.has(symbol)) continue;
    const date = String(r.d);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`날짜 형식 오류: ${date}`);
    if (opts.until && date > opts.until) continue;
    const key = `${market}|${symbol}`;
    if (!by.has(key)) by.set(key, { market, symbol, bars: [] });
    const turnover = r.turnover === undefined ? null : toNum(r.turnover);
    by.get(key)!.bars.push({
      date, open: toNum(r.open), high: toNum(r.high), low: toNum(r.low), close: toNum(r.close),
      volume: toNum(r.volume), turnover: turnover === null || Number.isNaN(turnover) ? null : turnover,
      flags: typeof r.flags === 'string' && r.flags ? r.flags : null,
    });
  }
  const frames: Frame[] = [];
  for (const { market, symbol, bars } of by.values()) {
    bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (let i = 1; i < bars.length; i++) if (bars[i].date === bars[i - 1].date) throw new Error(`중복 날짜: ${symbol} ${bars[i].date}`);
    frames.push({
      market, symbol, bars,
      excluded: bars.map((b) => hasFlag(b.flags, FLAG_ADJ_STALE) || hasFlag(b.flags, FLAG_ADJ_ORPHAN)),
      corpSuspect: bars.map((b) => hasFlag(b.flags, FLAG_CORP)),
    });
  }
  frames.sort((a, b) => (a.market + a.symbol < b.market + b.symbol ? -1 : 1));
  return frames;
}

/** 진입·청산이 가능한 봉인가: 제외 아님 · 거래량 > 0 · zero_volume 표시 없음 · 시가·종가·고가·저가 양수. */
export function isTradable(f: Frame, i: number): boolean {
  const b = f.bars[i];
  if (!b || f.excluded[i]) return false;
  if (!(b.volume > 0) || hasFlag(b.flags, FLAG_ZERO_VOLUME)) return false;
  return b.open > 0 && b.close > 0 && b.high > 0 && b.low > 0;
}

export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** 'YYYY-MM-DD' 가 속한 주의 월요일(P1 weekKey 와 같은 정의). */
export function weekKey(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** [a, b] 구간(포함)에 결측 구간(간격 > BAR_GAP_DAYS) 또는 제외 봉이 있는가. */
export function windowBroken(f: Frame, a: number, b: number): boolean {
  for (let i = a; i <= b; i++) {
    if (f.excluded[i]) return true;
    if (i > a && dayDiff(f.bars[i - 1].date, f.bars[i].date) > BAR_GAP_DAYS) return true;
  }
  return false;
}

/** 시장 달력 = Frame 들의 날짜 합집합(오름차순). */
export function calendarOf(frames: Frame[]): string[] {
  const s = new Set<string>();
  for (const f of frames) for (const b of f.bars) s.add(b.date);
  return [...s].sort();
}

/** 날짜 → 봉 위치(없으면 -1). */
export function indexOfDate(f: Frame, date: string): number {
  let lo = 0, hi = f.bars.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const d = f.bars[mid].date;
    if (d === date) return mid;
    if (d < date) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}

export function inRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}
