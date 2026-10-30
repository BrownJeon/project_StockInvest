/**
 * T-108 운용 지표 — **일봉 테이블 읽기 전용 reader** (Leader 결정 2026-10-30: 격리 시험 허용 목록에 이 파일 1개만 정확 일치로 추가).
 *
 * 일봉 테이블 이름을 쓰는 ops 파일은 이것 하나다. 다른 ops 파일은 이 함수들을 부르기만 하고 테이블 이름을 쓰지 않는다
 * (연구 모듈 격리 시험의 정규식이 src 전체를 본다).
 *
 * 규칙:
 *  - 고정 SELECT 문장 상수 2개뿐. 읽는 열은 `market`·`symbol`·`trade_date`(+ 확정 봉 거르기용 `is_final` 조건)뿐 — 가격·거래량 열을 읽지 않는다.
 *  - 연구 모듈을 import 하지 않는다(시장 코드 'KR'·'US' 는 여기 상수로 둔다).
 *  - 날짜는 DATE_FORMAT 문자열로 받는다(풀 시간대로 하루 밀리는 일 방지). 해외 날짜는 거래소 현지(ET) 날짜다.
 *  - 실패는 그대로 던진다 — 호출 섹션이 「조회 실패」로 둔다(0·빈 값으로 위장하지 않는다).
 */
import type { OpsReader } from './read-only';
import type { ByMarket, Market } from './types';

/** 일봉 테이블의 시장 코드. */
export const BAR_MARKET: Readonly<Record<Market, 'KR' | 'US'>> = { domestic: 'KR', overseas: 'US' };

/** 시장별 마지막 확정 봉 날짜 — `idx_date(trade_date)` 를 최근 구간에서 역순으로 훑는다. */
export const LAST_BAR_DATE_SQL =
  `SELECT DATE_FORMAT(trade_date, '%Y-%m-%d') AS d FROM daily_bars
    WHERE trade_date >= ? AND market = ? AND is_final = 1
    ORDER BY trade_date DESC LIMIT 1`;

/** 종목별 확정 봉 날짜(D0 다음 날부터) — PK(market, symbol, trade_date) 범위. */
export const BAR_DATES_SQL =
  `SELECT symbol, DATE_FORMAT(trade_date, '%Y-%m-%d') AS d FROM daily_bars
    WHERE market = ? AND symbol IN (?) AND trade_date > ? AND is_final = 1`;

/** 마지막 봉을 찾을 범위 — 이보다 오래되면 「없음」(null)으로 본다. */
export const LAST_BAR_LOOKBACK_DAYS = 45;

function ymdMinusDays(ms: number, days: number): string {
  return new Date(ms - days * 86_400_000).toISOString().slice(0, 10);
}

/** 시장별 마지막 확정 봉 날짜. 범위 안에 없으면 null. */
export async function readLastBarDates(r: OpsReader): Promise<ByMarket<string | null>> {
  return r.memo('last_bar_dates', () => readLastBarDatesOnce(r));
}

async function readLastBarDatesOnce(r: OpsReader): Promise<ByMarket<string | null>> {
  const from = ymdMinusDays(r.nowMs, LAST_BAR_LOOKBACK_DAYS);
  const one = async (m: Market): Promise<string | null> => {
    const rows = await r.rows<{ d: unknown }>(LAST_BAR_DATE_SQL, [from, BAR_MARKET[m]]);
    const d = rows[0] ? String(rows[0].d ?? '') : '';
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  };
  const [domestic, overseas] = await Promise.all([one('domestic'), one('overseas')]);
  return { domestic, overseas };
}

/** 종목 → 확정 봉 날짜 목록(afterDate 초과). 종목이 없으면 조회하지 않는다. */
export async function readBarDates(r: OpsReader, market: Market, symbols: readonly string[], afterDate: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const uniq = [...new Set(symbols)];
  if (uniq.length === 0) return out;
  const rows = await r.rows<{ symbol: unknown; d: unknown }>(BAR_DATES_SQL, [BAR_MARKET[market], uniq, afterDate]);
  for (const row of rows) {
    const s = String(row.symbol);
    const d = String(row.d ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const list = out.get(s) ?? [];
    list.push(d);
    out.set(s, list);
  }
  return out;
}
