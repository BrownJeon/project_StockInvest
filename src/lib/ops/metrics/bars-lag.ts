/**
 * T-173 일봉 「밀린 종목 수」 — 수집 대상 종목마다 마지막 확정 봉이 기대 거래일보다 몇 거래일 밀렸나(분석 › 데이터 상태 · 홈 A4).
 *
 * 왜(2026-11-09~14 미탐): 감시가 시장별 마지막 봉 날짜 하나만 봐서, 국내 보유종목 하나가 매일 들어오는 동안 나머지 국내 42종목이
 * 11-06 에서 멈춘 것을 「정상」으로 보였다. 이제 대상 종목을 하나씩 본다.
 *
 * 대상 = 수집기의 기본 대상과 **같은 규칙**(전 시장 기본 실행 기준 — 07:40):
 *   보유(position_state, 심볼순) → 해외 분석 목록(`readOverseasUniverse` — 수집기와 같은 함수) → 최근 90일 시그널(발화 수 순, 새로 더한 것 ≤300).
 *   중복은 처음 나온 곳만 센다. 시장은 심볼 모양(국내 6자리 숫자 · 해외 `EXC:TICKER`)으로 가르고, 둘 다 아니면 뺀다.
 *   ops 계층은 수집 모듈을 import 할 수 없어(격리 시험) 같은 SQL 을 여기 둔다 — 두 구현이 같은 종목 집합·같은 SQL 문장을 내는지는
 *   수집 모듈 쪽 대등성 시험(`daily-bars-target-parity.test.ts`)이 고정한다. 한쪽만 바꾸면 그 시험이 깨진다.
 *   한계: 국내 저녁 실행(시장 필터 KR)은 시그널 300 상한을 국내만으로 센다 — 시그널 종목이 300을 넘을 때만 두 집합이 갈린다(11-15 실측 122).
 *
 * 울타리(A-3): SELECT 만 보낸다(`OpsReader` — 쿼리당 2.5초 상한·동시 실행 관문). 해외 분석 목록 판독기에는 이 읽기 래퍼를
 * `Queryable` 모양으로 넘긴다(그 판독기가 보내는 문장도 같은 SELECT 검사를 거친다). 일봉 표 이름은 `daily-bars-read.ts` 에만.
 */
import { readOverseasUniverse, type Queryable } from '@/lib/strategy/universe-overseas-static';
import { addDaysYmd } from '@/lib/strategy/us-session';
import { readSymbolLastBars } from './daily-bars-read';
import type { OpsReader } from './read-only';
import { isTradingDay } from './sessions';
import type { BarsLag, ByMarket, Market } from './types';

export const BARS_TARGET_HOLDINGS_SQL = 'SELECT symbol FROM position_state ORDER BY symbol';
export const BARS_TARGET_SIGNAL_LOOKBACK_DAYS = 90;
export const BARS_TARGET_SIGNAL_MAX = 300;
export const BARS_TARGET_SIGNALS_SQL =
  `SELECT symbol, COUNT(*) AS n FROM signals
        WHERE created_at >= NOW() - INTERVAL ${BARS_TARGET_SIGNAL_LOOKBACK_DAYS} DAY
        GROUP BY symbol ORDER BY n DESC, symbol LIMIT ${BARS_TARGET_SIGNAL_MAX + 50}`;

/** 「밀림」으로 세는 최소 거래일 수. 1(하루 늦음)은 예산 순환 설계상 평일 정상 범위다. */
export const BARS_BEHIND_DAYS = 2;
/** 시장별 밀림+미수집이 이 수 이상이면 그 시장 일봉 원천을 「오래됨」으로 둔다. 1~2종목(영구 미수집 1개 등)은 숫자만 보인다. */
export const BARS_BEHIND_ALERT = 3;
export const BARS_SAMPLE_MAX = 5;
/** 거래일을 세며 하루씩 걷는 상한(달력일). 이보다 오래 멈춘 종목도 밀림 판정에는 충분하다. */
export const BARS_LAG_SCAN_DAYS = 400;

const OVERSEAS_SYMBOL = /^[A-Z]{3}:[A-Z][A-Z0-9.]*$/;
const DOMESTIC_SYMBOL = /^\d{6}$/;

/** 심볼 모양 → 시장(수집기의 시장 판별과 같은 모양 — 대등성 시험). 모르는 모양은 null(대상에서 뺀다). */
export function targetMarketOf(symbol: string): Market | null {
  if (OVERSEAS_SYMBOL.test(symbol)) return 'overseas';
  if (DOMESTIC_SYMBOL.test(symbol)) return 'domestic';
  return null;
}

/** 대상 목록을 만드는 원천 중 읽지 못한 것(수집기의 대상 오류 이름과 같다). */
export type BarsTargetError = 'position_state' | 'universe_list' | 'signals';

export interface BarsTargets { symbols: ByMarket<string[]>; errors: BarsTargetError[] }

/** ops 읽기 래퍼 → 해외 분석 목록 판독기가 받는 최소 쿼리 모양. */
function asQueryable(r: OpsReader): Queryable {
  return {
    async query<T = unknown>(sql: string, params?: unknown[]): Promise<[T, unknown]> {
      return [(await r.rows(sql, params ?? [])) as unknown as T, null];
    },
  };
}

/** 수집 대상(기본 실행) — 원천마다 따로 읽고, 실패한 원천은 errors 에 남기고 나머지로 계속한다(수집기와 같다). */
export async function readBarsTargets(r: OpsReader): Promise<BarsTargets> {
  return r.memo('bars_targets', () => readBarsTargetsOnce(r));
}

/**
 * 세 원천은 **동시에** 읽고(요청 예산 3.8초·쿼리 자리 4개를 홈의 다른 섹션과 나눠 쓴다 — 차례로 읽으면 사슬이 길어져 느린 날 「확인 못 함」이 된다),
 * 합치는 순서만 수집기와 같게(보유 → 분석 목록 → 시그널) 둔다. 중복 판정·시그널 300 상한이 이 순서에 달려 있다.
 */
async function readBarsTargetsOnce(r: OpsReader): Promise<BarsTargets> {
  const failed = () => null;
  const [holdings, universe, signals] = await Promise.all([
    r.rows<{ symbol: unknown }>(BARS_TARGET_HOLDINGS_SQL).catch(failed),
    // 판독기는 던지지 않는다고 약속하지만, 감시는 그 약속에 기대지 않는다(던지면 「목록 저하」로 센다)
    readOverseasUniverse(asQueryable(r)).catch(() => ({ symbols: [] as string[], degraded: true })),
    r.rows<{ symbol: unknown }>(BARS_TARGET_SIGNALS_SQL).catch(failed),
  ]);
  const errors: BarsTargetError[] = [];
  const symbols: ByMarket<string[]> = { domestic: [], overseas: [] };
  const seen = new Set<string>();
  const add = (symbol: string): boolean => {
    const market = targetMarketOf(symbol);
    if (!market || seen.has(symbol)) return false;
    seen.add(symbol);
    symbols[market].push(symbol);
    return true;
  };
  if (holdings) for (const row of holdings) add(String(row.symbol));
  else errors.push('position_state');
  for (const s of universe.symbols) add(s);
  if (universe.degraded) errors.push('universe_list');
  if (signals) {
    let n = 0;
    for (const row of signals) {
      if (n >= BARS_TARGET_SIGNAL_MAX) break;
      if (add(String(row.symbol))) n++;
    }
  } else {
    errors.push('signals');
  }
  return { symbols, errors };
}

/** 한 시장의 밀림 계산 입력. last=null 은 종목별 마지막 봉을 읽지 못함. */
export interface BarsLagInput { symbols: string[]; last: Map<string, string> | null; targetErrors: BarsTargetError[] }

/**
 * 시장 하나에 해당하는 대상 오류 — 해외 분석 목록(`universe_list`)은 해외 대상만 만든다(판독기가 해외 모양 심볼만 받는다).
 * 국내 줄을 그 오류로 「일부 저하」로 만들면 홈 A4 에 거짓 이상이 하나 더 뜬다(T-173 Reviewer R-1). 보유·시그널은 두 시장 모두.
 */
export function targetErrorsFor(market: Market, errors: readonly BarsTargetError[]): BarsTargetError[] {
  return market === 'domestic' ? errors.filter((e) => e !== 'universe_list') : [...errors];
}

/** 시장별 입력 — 대상 1회 + 시장별 마지막 봉 1회씩. 시장 하나의 봉 조회 실패는 그 시장만 last=null. 던지지 않는다. */
export async function readBarsLagInput(r: OpsReader): Promise<ByMarket<BarsLagInput>> {
  return r.memo('bars_lag_input', async () => {
    const t = await readBarsTargets(r);
    const one = async (m: Market): Promise<BarsLagInput> => {
      const targetErrors = targetErrorsFor(m, t.errors);
      try {
        return { symbols: t.symbols[m], last: await readSymbolLastBars(r, m, t.symbols[m]), targetErrors };
      } catch {
        return { symbols: t.symbols[m], last: null, targetErrors };
      }
    };
    const [domestic, overseas] = await Promise.all([one('domestic'), one('overseas')]);
    return { domestic, overseas };
  });
}

/** last 다음 날부터 expected 까지(포함)의 거래일 수 — 순수. last ≥ expected 면 0. */
export function tradingDaysAfter(market: Market, last: string, expected: string, closed: ReadonlySet<string>): number {
  let n = 0;
  let d = last;
  for (let i = 0; i < BARS_LAG_SCAN_DAYS && d < expected; i++) {
    d = addDaysYmd(d, 1);
    if (isTradingDay(market, d, closed)) n++;
  }
  return n;
}

/** 한 시장의 밀림 요약 — 순수. 같은 종목이 두 번 오면 한 번만 센다. */
export function barsLagOf(
  market: Market, symbols: readonly string[], last: ReadonlyMap<string, string>, expected: string, closed: ReadonlySet<string>,
): BarsLag {
  const uniq = [...new Set(symbols)];
  let late1 = 0;
  let behind = 0;
  let missing = 0;
  let oldest: string | null = null;
  const lagging: { symbol: string; d: string | null }[] = [];
  for (const symbol of uniq) {
    const d = last.get(symbol);
    if (d == null) {
      missing++;
      lagging.push({ symbol, d: null });
      continue;
    }
    const lag = tradingDaysAfter(market, d, expected, closed);
    if (lag >= BARS_BEHIND_DAYS) {
      behind++;
      lagging.push({ symbol, d });
      if (oldest == null || d < oldest) oldest = d;
    } else if (lag === 1) {
      late1++;
    }
  }
  // 미수집 먼저, 다음은 오래된 봉 순, 같으면 심볼순
  lagging.sort((a, b) => {
    if (a.d !== b.d) {
      if (a.d == null) return -1;
      if (b.d == null) return 1;
      return a.d < b.d ? -1 : 1;
    }
    return a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0;
  });
  return { expected, targets: uniq.length, late1, behind, missing, oldest, samples: lagging.slice(0, BARS_SAMPLE_MAX).map((x) => x.symbol) };
}

/** 경고 대상인가 — 밀림+미수집이 임계값 이상. */
export function barsLagAlert(lag: BarsLag): boolean {
  return lag.behind + lag.missing >= BARS_BEHIND_ALERT;
}
