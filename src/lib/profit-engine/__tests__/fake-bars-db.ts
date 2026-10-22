/**
 * 시험 전용 — `daily_bars` 를 흉내 내는 가짜 DB 와 합성 시장 데이터 (T-070).
 *
 *  - upsert 는 **코드의 실제 SQL 문자열**을 T-059 의 `UpsertSim` 으로 해석한다(조건을 시험에 다시 적지 않는다).
 *  - 그 밖의 SQL 은 코드가 보내는 정확한 모양만 인식하고, 모르는 SQL 은 던진다(새 쿼리가 몰래 생기면 시험이 깨진다).
 *  - 합성 종목·합성 가격만 쓴다. 실제 DB·KIS 호출 없음.
 */
import { UpsertSim } from '@/lib/data/__tests__/sql-upsert-sim';
import { MARK_STALE_SQL, RELABEL_ORPHAN_SQL } from '../daily-bars-store';
import type { RawBar } from '../daily-bars-quality';
import type { FetchDailyPage, PageRequest } from '../daily-bars-kis';
import { addDays } from '../daily-bars-time';

const norm = (s: unknown) => String(s).replace(/\s+/g, ' ').trim();

export type Row = Record<string, unknown>;

export class FakeBarsDb {
  sim = new UpsertSim(['market', 'symbol', 'trade_date']);
  tables = new Set(['daily_bars']);
  positions: string[] = [];
  signalCounts: Array<{ symbol: string; n: number }> = [];
  queries: Array<{ sql: string; params: unknown[] }> = [];
  failPositions = false;

  rows(market?: string, symbol?: string): Row[] {
    return [...this.sim.rows.values()]
      .filter((r) => (market === undefined || r.market === market) && (symbol === undefined || r.symbol === symbol))
      .sort((a, b) => (String(a.trade_date) < String(b.trade_date) ? -1 : 1));
  }

  /** 시험이 직접 행을 심는다(저장된 과거 상태 재현). */
  seed(row: Row): void {
    this.sim.rows.set(`${row.market}|${row.symbol}|${row.trade_date}`, { ...row });
  }

  query = async (sqlArg: unknown, paramsArg: unknown[] = []): Promise<[unknown, unknown]> => {
    const sql = norm(sqlArg);
    const params = paramsArg ?? [];
    this.queries.push({ sql, params });
    if (/^SELECT TABLE_NAME AS t FROM information_schema\.TABLES/.test(sql)) {
      const names = params[0] as string[];
      return [names.filter((n) => this.tables.has(n)).map((t) => ({ t })), []];
    }
    if (/^INSERT INTO daily_bars /.test(sql)) {
      this.sim.exec(String(sqlArg), params);
      return [{ affectedRows: (params[0] as unknown[]).length }, []];
    }
    if (sql === norm(MARK_STALE_SQL)) {
      for (const r of this.rows(String(params[0]), String(params[1]))) r.flags = 'adj_stale';
      return [{ affectedRows: 1 }, []];
    }
    if (sql === norm(RELABEL_ORPHAN_SQL)) {
      for (const r of this.rows(String(params[0]), String(params[1]))) {
        if (String(r.flags ?? '').split(',').includes('adj_stale')) r.flags = 'adj_orphan';
      }
      return [{ affectedRows: 1 }, []];
    }
    if (/^SELECT currency, adj_mode, COUNT\(\*\) AS n,/.test(sql)) {
      const groups = new Map<string, Row[]>();
      for (const r of this.rows(String(params[0]), String(params[1]))) {
        const k = `${r.currency}|${r.adj_mode}`;
        groups.set(k, [...(groups.get(k) ?? []), r]);
      }
      const isStale = (r: Row) => String(r.flags ?? '').split(',').includes('adj_stale');
      return [[...groups.entries()].map(([k, rs]) => {
        const fresh = rs.filter((r) => !isStale(r));
        return {
          currency: k.split('|')[0], adj_mode: k.split('|')[1], n: rs.length,
          min_d: rs[0].trade_date, max_d: rs[rs.length - 1].trade_date,
          stale_n: rs.filter(isStale).length,
          min_fresh_d: fresh.length ? fresh[0].trade_date : null,
        };
      }), []];
    }
    if (/^SELECT DATE_FORMAT\(trade_date, '%Y-%m-%d'\) AS d, close, is_final, flags FROM daily_bars WHERE market = \? AND symbol = \? AND trade_date >= \? ORDER BY trade_date$/.test(sql)) {
      const from = String(params[2]);
      return [this.rows(String(params[0]), String(params[1]))
        .filter((r) => String(r.trade_date) >= from)
        .map((r) => ({ d: r.trade_date, close: r.close, is_final: r.is_final, flags: r.flags })), []];
    }
    if (sql === 'SELECT symbol FROM position_state ORDER BY symbol') {
      if (this.failPositions) throw new Error('position_state unavailable');
      return [this.positions.map((symbol) => ({ symbol })), []];
    }
    if (/^SELECT symbol, COUNT\(\*\) AS n FROM signals WHERE created_at >= NOW\(\) - INTERVAL 90 DAY GROUP BY symbol ORDER BY n DESC, symbol LIMIT \d+$/.test(sql)) {
      return [[...this.signalCounts].sort((a, b) => b.n - a.n || (a.symbol < b.symbol ? -1 : 1)), []];
    }
    throw new Error(`FakeBarsDb: 예상하지 않은 SQL — ${sql.slice(0, 120)}`);
  };

  /** 쓰기 SQL 이 건드린 테이블 목록(INSERT/UPDATE/DELETE/REPLACE 대상). */
  writtenTables(): string[] {
    const out = new Set<string>();
    for (const q of this.queries) {
      const m = /^(INSERT INTO|UPDATE|DELETE FROM|REPLACE INTO)\s+`?(\w+)/i.exec(q.sql);
      if (m) out.add(m[2]);
    }
    return [...out];
  }
}

/** 평일만 있는 합성 일봉(오름차순). close = base + i*step. */
export function makeBars(from: string, to: string, base = 100, step = 0.01): RawBar[] {
  const out: RawBar[] = [];
  let d = from;
  let i = 0;
  while (d <= to) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) {
      const close = Math.round((base + i * step) * 10000) / 10000;
      out.push({ tradeDate: d, open: close, high: close + 0.5, low: close - 0.5, close, volume: 1000 + i, turnover: null });
      i++;
    }
    d = addDays(d, 1);
  }
  return out;
}

export interface FakeMarket {
  fetchPage: FetchDailyPage;
  requests: PageRequest[];
  /** 종목별 현재 데이터(시험 도중 바꿔 조정 기준 변경을 재현) */
  data: Map<string, RawBar[]>;
}

/**
 * KIS 흉내: 해외는 endDate(포함) 이하 최신 100행을 최신→과거로, 국내는 [max(stopAt,end−139), end] 전체를 최신→과거로(coveredFrom 포함).
 * `ignoreCursor` 면 커서를 무시하고 늘 최신 페이지를 준다(무한 루프 방지 시험).
 */
export function fakeMarket(data: Record<string, RawBar[]>, opts: { pageSize?: number; ignoreCursor?: boolean; today?: string } = {}): FakeMarket {
  const map = new Map(Object.entries(data));
  const requests: PageRequest[] = [];
  const pageSize = opts.pageSize ?? 100;
  const fetchPage: FetchDailyPage = async (req) => {
    requests.push({ ...req });
    const all = map.get(req.symbol) ?? [];
    const end = opts.ignoreCursor ? null : req.endDate;
    if (req.market === 'US') {
      const rows = all.filter((b) => end === null || b.tradeDate <= end).slice(-pageSize).reverse();
      return { rows: rows.map((r) => ({ ...r })), rawCount: rows.length, dropped: 0, coveredFrom: null };
    }
    const e = end ?? opts.today ?? '2026-10-22';
    const floor = addDays(e, -139);
    const start = req.stopAt > floor ? req.stopAt : floor;
    const rows = all.filter((b) => b.tradeDate >= start && b.tradeDate <= e).reverse();
    return { rows: rows.map((r) => ({ ...r })), rawCount: rows.length, dropped: 0, coveredFrom: start };
  };
  return { fetchPage, requests, data: map };
}
