/**
 * T-059 Part A — edgar-sync 본체: tables_missing·UA 없음이면 SEC 호출 0, 증분(sha·filed 워터마크), 종목 격리, 429/403 중단,
 * company_tickers 실패 시 기존 매핑 유지, 비영업 법인 건너뜀, 시간 예산, estimated 행에 날짜 없음.
 * DB 는 SQL 패턴으로 응답하는 대역(운영 DB 접속 없음), SEC 는 fetchImpl 대역(네트워크 없음).
 */
import subFixture from './fixtures/intc-submissions.sample.json';
import tickersFixture from './fixtures/company-tickers.sample.json';
import muFacts from './fixtures/mu-companyfacts.sample.json';
import { runEdgarSync, dateStr, decideFactsWatermark, factsContainAccession, FACTS_REFLECT_GRACE_DAYS, upsertFacts } from '../sync-job';
import { UpsertSim } from '../../__tests__/sql-upsert-sim';
import { SecClient, __resetSecBlockStateForTest } from '../sec-client';
import type { Queryable } from '../../us-data-db';

const INTC = 50863;
const ORCL = 1341439;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

type Row = Record<string, unknown>;

class FakeDb implements Queryable {
  tables = new Set(['symbol_cik_map', 'us_filings', 'us_financial_facts', 'us_earnings_events', 'us_fundamentals_snapshot']);
  positions: string[] = [];
  favorites: string[] = [];
  map = new Map<string, Row>();
  /** true 면 실제 mysql2 처럼 DATE 컬럼(facts_filed_watermark)을 KST 자정 `Date` 로 돌려준다(R-7). */
  datesAsObjects = false;
  log: Array<{ sql: string; params: unknown[] }> = [];
  nextId = 100;

  async query<T>(sql: string, params: unknown[] = []): Promise<[T, unknown]> {
    const s = sql.replace(/\s+/g, ' ').trim();
    this.log.push({ sql: s, params });
    const ret = (v: unknown) => [v as T, undefined] as [T, unknown];
    if (s.includes('information_schema.TABLES')) {
      return ret((params[0] as string[]).filter((n) => this.tables.has(n)).map((t) => ({ t })));
    }
    if (s.startsWith('SELECT symbol FROM position_state')) return ret(this.positions.map((symbol) => ({ symbol })));
    if (s.startsWith('SELECT symbol FROM stock_favorites')) return ret(this.favorites.map((symbol) => ({ symbol })));
    if (s.startsWith('INSERT INTO symbol_cik_map')) {
      const [symbol, cik, sec_ticker, entity_title] = params as [string, number, string, string];
      const prev = this.map.get(symbol);
      const reset = prev && prev.cik !== cik;
      this.map.set(symbol, {
        ...(prev ?? {}), ...(reset ? { submissions_sha256: null, facts_sha256: null, facts_filed_watermark: null } : {}),
        symbol, cik, sec_ticker, entity_title,
      });
      return ret({ affectedRows: 1 });
    }
    if (s.startsWith('SELECT symbol, cik, submissions_sha256')) {
      const want = new Set(params[0] as string[]);
      return ret([...this.map.values()].filter((r) => want.has(r.symbol as string)).map((r) => {
        const row: Row = { submissions_sha256: null, facts_sha256: null, facts_filed_watermark: null, last_attempt_at: null, ...r };
        const w = row.facts_filed_watermark;
        if (this.datesAsObjects && typeof w === 'string') row.facts_filed_watermark = new Date(`${w}T00:00:00+09:00`);
        return row;
      }));
    }
    const upd = /^UPDATE symbol_cik_map SET (.*) WHERE cik = \?$/.exec(s);
    if (upd) {
      const cik = params[params.length - 1];
      const vals = [...params];
      const sets: Record<string, unknown> = {};
      for (const part of upd[1].split(',').map((x) => x.trim())) {
        const [col, rhs] = part.split('=').map((x) => x.trim());
        sets[col] = rhs === '?' ? vals.shift() : rhs === 'NULL' ? null : `@${rhs}`;
      }
      for (const r of this.map.values()) if (r.cik === cik) Object.assign(r, sets);
      return ret({ affectedRows: 1 });
    }
    if (s.startsWith('INSERT INTO us_earnings_events')) return ret({ insertId: this.nextId++, affectedRows: 1 });
    return ret({ affectedRows: 1 });
  }

  q(prefix: string) { return this.log.filter((l) => l.sql.startsWith(prefix)); }
}

type Plan = Record<string, Array<number | [number, unknown] | Error>>;

function makeClient(plan: Plan) {
  let t = 0;
  const fetchImpl = jest.fn(async (url: string) => {
    const key = Object.keys(plan).find((k) => url.includes(k));
    const step = key ? plan[key].shift() : 404;
    if (step instanceof Error) throw step;
    if (Array.isArray(step)) return new Response(typeof step[1] === 'string' ? step[1] : JSON.stringify(step[1]), { status: step[0] });
    return new Response('{}', { status: step ?? 404 });
  });
  const client = new SecClient({ userAgent: 'TestCo test@example.invalid', fetchImpl, sleep: async (ms) => { t += ms; }, now: () => t });
  return { client, fetchImpl };
}

/** MU 발췌를 INTC 용으로 — `withAccns` 의 accession 을 단 사실(dei 주식수)을 덧붙여 "그 보고서가 반영된 companyfacts" 를 흉내 낸다. */
const factsFor = (withAccns: string[]) => {
  const j = { ...clone(muFacts), cik: INTC } as { cik: number; facts: { dei: { EntityCommonStockSharesOutstanding: { units: { shares: unknown[] } } } } };
  for (const a of withAccns) {
    j.facts.dei.EntityCommonStockSharesOutstanding.units.shares.push({ end: '2026-07-18', val: 4361000000, accn: a, fy: 2026, fp: 'Q2', form: '10-Q', filed: '2026-07-24' });
  }
  return j;
};
const TRIG_0724 = '0000050863-26-000157';   // 픽스처의 최신 10-Q (2026-07-24 접수)
const intcFacts = () => factsFor([TRIG_0724]);
const NOW = () => new Date('2026-10-21T22:00:00Z');   // KST 10-22 07:00, 미국 동부 10-21

const ORIG_ENV = process.env.OVERSEAS_UNIVERSE_SYMBOLS;
beforeEach(() => {
  __resetSecBlockStateForTest();
  process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:INTC,NAS:SMH';
});
afterAll(() => { process.env.OVERSEAS_UNIVERSE_SYMBOLS = ORIG_ENV; });

describe('🔴 SEC 를 부르지 않는 경우', () => {
  test('신규 테이블이 없으면 skipped:tables_missing — SEC 호출 0·쓰기 0', async () => {
    const db = new FakeDb();
    db.tables = new Set(['symbol_cik_map']);
    const { client, fetchImpl } = makeClient({});
    const r = await runEdgarSync({ db, client, now: NOW, log: () => undefined });
    expect(r).toEqual({ ok: true, skipped: 'tables_missing', missing: ['us_filings', 'us_financial_facts', 'us_earnings_events'] });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(db.log.filter((l) => /^(INSERT|UPDATE)/.test(l.sql))).toHaveLength(0);
  });

  test('SEC_USER_AGENT 가 없으면 skipped:sec_user_agent_missing — 전역 fetch 호출 0', async () => {
    const db = new FakeDb();
    const spy = jest.spyOn(global, 'fetch' as never).mockImplementation((() => { throw new Error('no network'); }) as never);
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const env of [{}, { SEC_USER_AGENT: '' }, { SEC_USER_AGENT: 'NoEmail' }]) {
      const r = await runEdgarSync({ db, env: env as NodeJS.ProcessEnv, now: NOW, log: () => undefined });
      expect(r).toEqual({ ok: false, skipped: 'sec_user_agent_missing' });
    }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    err.mockRestore();
  });
});

describe('정상 수집·증분', () => {
  test('첫 실행: 매핑·공시·추정 창·재무 적재, ETF 는 unmapped', async () => {
    const db = new FakeDb();
    const { client, fetchImpl } = makeClient({
      company_tickers: [[200, clone(tickersFixture)]],
      'submissions/CIK0000050863': [[200, clone(subFixture)]],
      'companyfacts/CIK0000050863': [[200, intcFacts()]],
    });
    const r = await runEdgarSync({ db, client, now: NOW, log: () => undefined });
    expect(r).toMatchObject({ ok: true, targets: 2, mapped: 1, unmapped: ['NAS:SMH'], ciks: 1, ciksDone: 1, partial: false, requests: 3 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(r.filingsUpserted).toBeGreaterThan(10);
    expect(r.factsUpserted).toBeGreaterThan(10);
    expect(r.estimates).toEqual([{ symbol: 'NAS:INTC', window: ['2026-10-15', '2026-10-29'] }]);

    // 🔴 estimated 행: event_date_et 는 SQL 리터럴 NULL, 창 두 값만 바인딩
    const ev = db.q('INSERT INTO us_earnings_events')[0];
    expect(ev.sql).toMatch(/VALUES \(\?, \?, \?, NULL, \?, \?, 'unknown', 'estimated'/);
    expect(ev.params.slice(0, 5)).toEqual(['NAS:INTC', INTC, 'after-2026-07-23', '2026-10-15', '2026-10-29']);
    expect(db.q('UPDATE us_earnings_events SET superseded_by')).toHaveLength(1);

    // accepted_at 은 UTC → KST 벽시계 문자열(toISOString 그대로가 아님)
    const fil = db.q('INSERT INTO us_filings')[0];
    const rows = fil.params[0] as unknown[][];
    const r155 = rows.find((x) => x[0] === '0000050863-26-000155')!;
    expect(r155[6]).toBe('2026-07-24 05:09:00');

    const m = db.map.get('NAS:INTC')!;
    expect(m.submissions_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(m.facts_filed_watermark).toBe('2026-07-24');   // 픽스처의 최신 10-Q 접수일
  });

  test('두 번째 실행: 본문이 같으면 공시·추정 쓰기 생략, 새 정기보고서가 없으면 companyfacts 를 받지 않는다', async () => {
    const db = new FakeDb();
    const plan: Plan = {
      company_tickers: [[200, clone(tickersFixture)], [200, clone(tickersFixture)]],
      'submissions/CIK0000050863': [[200, clone(subFixture)], [200, clone(subFixture)]],
      'companyfacts/CIK0000050863': [[200, intcFacts()]],
    };
    const { client, fetchImpl } = makeClient(plan);
    await runEdgarSync({ db, client, now: NOW, log: () => undefined });
    db.log = [];
    const r = await runEdgarSync({ db, client, now: NOW, log: () => undefined });
    expect(r).toMatchObject({ ok: true, ciksDone: 1, ciksUnchanged: 1, filingsUpserted: 0, factsUpserted: 0, factsFetched: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(5);        // 3 + (tickers + submissions)
    expect(db.q('INSERT INTO us_filings')).toHaveLength(0);
    expect(db.q('INSERT INTO us_financial_facts')).toHaveLength(0);
    expect(db.q('INSERT INTO us_earnings_events')).toHaveLength(0);
  });

  test('🔴 (R-7) 실제 mysql2 처럼 워터마크가 Date(KST 자정)로 와도 같은 날짜로 읽혀 companyfacts 를 다시 받지 않는다', async () => {
    const db = new FakeDb();
    db.datesAsObjects = true;
    const { client, fetchImpl } = makeClient({
      company_tickers: [[200, clone(tickersFixture)], [200, clone(tickersFixture)]],
      'submissions/CIK0000050863': [[200, clone(subFixture)], [200, clone(subFixture)]],
      'companyfacts/CIK0000050863': [[200, intcFacts()], [200, intcFacts()]],
    });
    await runEdgarSync({ db, client, now: NOW, log: () => undefined });
    const r = await runEdgarSync({ db, client, now: NOW, log: () => undefined });
    expect(r.factsFetched).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  test('🔴 (R-7) dateStr — KST 자정 Date 는 그 KST 날짜(UTC 로 하루 밀리지 않음), 문자열·잘못된 값', () => {
    const kstMidnight = new Date('2026-07-24T00:00:00+09:00');
    expect(kstMidnight.toISOString().slice(0, 10)).toBe('2026-07-23');   // 순진한 UTC 변환이면 하루 앞선다
    expect(dateStr(kstMidnight)).toBe('2026-07-24');
    expect(dateStr(new Date('2026-01-01T00:00:00+09:00'))).toBe('2026-01-01');   // 연도 경계
    expect(dateStr(new Date('2026-07-24T23:59:59+09:00'))).toBe('2026-07-24');
    expect(dateStr('2026-07-24')).toBe('2026-07-24');
    expect(dateStr(new Date('invalid'))).toBeNull();
    expect(dateStr('n/a')).toBeNull();
    expect(dateStr(null)).toBeNull();
  });

  test('워터마크 이후 새 10-Q 가 생기면 companyfacts 를 다시 받는다', async () => {
    const db = new FakeDb();
    const sub2 = clone(subFixture) as { filings: { recent: Record<string, unknown[]> } };
    const rec = sub2.filings.recent;
    rec.accessionNumber.push('0000050863-26-000200'); rec.filingDate.push('2026-10-30'); rec.reportDate.push('2026-09-27');
    rec.acceptanceDateTime.push('2026-10-30T20:30:00.000Z'); rec.form.push('10-Q'); rec.items.push(''); rec.primaryDocument.push('intc-20260927.htm');
    for (const k of Object.keys(rec)) if (!['accessionNumber', 'filingDate', 'reportDate', 'acceptanceDateTime', 'form', 'items', 'primaryDocument'].includes(k)) rec[k].push('');
    const { client, fetchImpl } = makeClient({
      company_tickers: [[200, clone(tickersFixture)], [200, clone(tickersFixture)]],
      'submissions/CIK0000050863': [[200, clone(subFixture)], [200, sub2]],
      'companyfacts/CIK0000050863': [[200, intcFacts()], [200, factsFor([TRIG_0724, '0000050863-26-000200'])]],
    });
    await runEdgarSync({ db, client, now: NOW, log: () => undefined });
    const r = await runEdgarSync({ db, client, now: NOW, log: () => undefined });
    expect(r.factsFetched).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(db.map.get('NAS:INTC')!.facts_filed_watermark).toBe('2026-10-30');   // 새 10-Q accession 이 facts 에 있음 → 전진
  });
});

describe('🔴 격리·중단', () => {
  beforeEach(() => { process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:INTC,NYS:ORCL'; });

  test('한 CIK 의 파싱 실패는 그 CIK 만 실패, 다른 CIK 는 정상, 기존 행 삭제 없음', async () => {
    const db = new FakeDb();
    const { client } = makeClient({
      company_tickers: [[200, clone(tickersFixture)]],
      'submissions/CIK0001341439': [[200, { cik: ORCL, filings: {} }]],          // recent 없음 → 형식 이상
      'submissions/CIK0000050863': [[200, clone(subFixture)]],
      'companyfacts/CIK0000050863': [[200, intcFacts()]],
    });
    const r = await runEdgarSync({ db, client, now: NOW, log: () => undefined });
    expect(r.ok).toBe(true);
    expect(r.ciksDone).toBe(1);
    expect(r.ciksFailed).toEqual([{ cik: ORCL, error: expect.stringContaining('filings.recent 없음') }]);
    expect(db.map.get('NYS:ORCL')!.last_error).toEqual(expect.stringContaining('EdgarParseError'));
    expect(db.map.get('NYS:ORCL')!.submissions_sha256 ?? null).toBeNull();     // 실패한 CIK 는 증분 표식을 남기지 않음 → 다음 날 재시도
    expect(db.log.some((l) => /^DELETE/.test(l.sql))).toBe(false);
  });

  test('companyfacts 형식 이상이면 워터마크를 올리지 않는다(다음 날 재시도)', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:INTC';
    const db = new FakeDb();
    const { client } = makeClient({
      company_tickers: [[200, clone(tickersFixture)]],
      'submissions/CIK0000050863': [[200, clone(subFixture)]],
      'companyfacts/CIK0000050863': [[200, { cik: 1, facts: {} }]],
    });
    const r = await runEdgarSync({ db, client, now: NOW, log: () => undefined });
    expect(r.ciksFailed).toHaveLength(1);
    expect(db.map.get('NAS:INTC')!.facts_filed_watermark ?? null).toBeNull();
  });

  test.each([429, 403])('submissions %i 이면 job 전체 중단 — 남은 CIK 호출 0', async (code) => {
    const db = new FakeDb();
    const { client, fetchImpl } = makeClient({
      company_tickers: [[200, clone(tickersFixture)]],
      'submissions/CIK00': [code],
    });
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await runEdgarSync({ db, client, now: NOW, log: () => undefined });
    err.mockRestore();
    expect(r).toMatchObject({ ok: false, aborted: 'sec_blocked' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);      // tickers + 첫 submissions 1건에서 멈춤
    expect(r.ciksDone).toBe(0);
  });

  test('company_tickers 실패(5xx 2회)면 기존 매핑으로 계속한다', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:INTC';
    const db = new FakeDb();
    db.map.set('NAS:INTC', { symbol: 'NAS:INTC', cik: INTC, sec_ticker: 'INTC' });
    const { client } = makeClient({
      company_tickers: [500, 500],
      'submissions/CIK0000050863': [[200, clone(subFixture)]],
      'companyfacts/CIK0000050863': [[200, intcFacts()]],
    });
    const r = await runEdgarSync({ db, client, now: NOW, log: () => undefined });
    expect(r).toMatchObject({ ok: true, tickersSource: 'existing_map', ciksDone: 1, unmapped: [] });
    expect(db.q('INSERT INTO symbol_cik_map')).toHaveLength(0);
  });

  test('entityType 이 operating 이 아니면 companyfacts·추정 없이 건너뛴다', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:INTC';
    const db = new FakeDb();
    const trust = { ...clone(subFixture), entityType: 'other' };
    const { client, fetchImpl } = makeClient({
      company_tickers: [[200, clone(tickersFixture)]],
      'submissions/CIK0000050863': [[200, trust]],
    });
    const r = await runEdgarSync({ db, client, now: NOW, log: () => undefined });
    expect(r.nonOperating).toEqual([INTC]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(db.q('INSERT INTO us_earnings_events')).toHaveLength(0);
  });

  test('시간 예산을 넘기면 남은 CIK 를 남기고 partial', async () => {
    const db = new FakeDb();
    let t = 0;
    const now = () => new Date(Date.parse('2026-10-21T22:00:00Z') + t);
    const { client } = makeClient({
      company_tickers: [[200, clone(tickersFixture)]],
      'submissions/CIK0000050863': [[200, clone(subFixture)]],
      'companyfacts/CIK0000050863': [[200, intcFacts()]],
      'submissions/CIK0001341439': [[200, clone(subFixture)]],
    });
    const origQuery = db.query.bind(db);
    db.query = (async (sql: string, params?: unknown[]) => {
      if (sql.includes('INSERT INTO us_financial_facts')) t += 20_000;   // 첫 CIK 처리에 시간이 걸린 척
      return origQuery(sql, params);
    }) as typeof db.query;
    const r = await runEdgarSync({ db, client, now, budgetMs: 10_000, log: () => undefined });
    expect(r).toMatchObject({ partial: true, remaining: 1, ciksDone: 1 });
  });

  test('동시 실행은 already_running', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:INTC';
    const db = new FakeDb();
    const { client } = makeClient({
      company_tickers: [[200, clone(tickersFixture)]],
      'submissions/CIK0000050863': [[200, clone(subFixture)]],
      'companyfacts/CIK0000050863': [[200, intcFacts()]],
    });
    const [a, b] = await Promise.all([
      runEdgarSync({ db, client, now: NOW, log: () => undefined }),
      runEdgarSync({ db, client, now: NOW, log: () => undefined }),
    ]);
    expect([a.skipped, b.skipped]).toContain('already_running');
  });
});

describe('🔴 (C-1) companyfacts 워터마크 — 트리거 보고서가 facts 에 실제로 반영됐을 때만 전진', () => {
  const T = { accession: '0000050863-26-000200', filed: '2026-10-15' };
  const today = '2026-10-21';   // 접수 6일 뒤
  const json = (accns: string[]) => ({ facts: { dei: { X: { units: { shares: accns.map((accn) => ({ accn })) } } } } });

  test('① 트리거 + 받은 facts 에 accession 없음(SHA 동일 포함) → 유지', () => {
    expect(decideFactsWatermark({ trigger: T, fetched: { json: json(['0000050863-26-000157']) }, todayEt: today }))
      .toEqual({ advance: false, watermark: null });
  });
  test('② 트리거 + 404 → 유지', () => {
    expect(decideFactsWatermark({ trigger: T, fetched: null, todayEt: today })).toEqual({ advance: false, watermark: null });
  });
  test('③ 트리거 accession 이 facts 에 있음 → 트리거 접수일로 전진', () => {
    expect(decideFactsWatermark({ trigger: T, fetched: { json: json([T.accession]) }, todayEt: today }))
      .toEqual({ advance: true, watermark: '2026-10-15' });
  });
  test(`④ 접수 ${FACTS_REFLECT_GRACE_DAYS}일 경과 → 전진 + 경고(404·부재 모두), 9일째는 유지`, () => {
    expect(decideFactsWatermark({ trigger: T, fetched: null, todayEt: '2026-10-25' }))
      .toEqual({ advance: true, watermark: '2026-10-15', warn: 'companyfacts_404' });
    expect(decideFactsWatermark({ trigger: T, fetched: { json: json([]) }, todayEt: '2026-10-25' }))
      .toMatchObject({ advance: true, warn: expect.stringContaining('trigger_accession_absent') });
    expect(decideFactsWatermark({ trigger: T, fetched: null, todayEt: '2026-10-24' }).advance).toBe(false);
  });
  test('⑤ 트리거 없음 → 기존 동작(오늘로 전진)', () => {
    expect(decideFactsWatermark({ trigger: null, fetched: null, todayEt: today })).toEqual({ advance: true, watermark: today });
    expect(decideFactsWatermark({ trigger: null, fetched: { json: json([]) }, todayEt: today })).toEqual({ advance: true, watermark: today });
  });
  test('factsContainAccession 은 화이트리스트 밖 태그까지 본다', () => {
    expect(factsContainAccession({ facts: { 'us-gaap': { AnyTag: { units: { USD: [{ accn: 'A' }] } } } } }, 'A')).toBe(true);
    expect(factsContainAccession({ facts: {} }, 'A')).toBe(false);
    expect(factsContainAccession(null, 'A')).toBe(false);
  });

  // 통합: 최근 10-Q(06일 전 접수)가 submissions 에 보이는데 companyfacts 가 아직 반영 전
  const subWithRecent10Q = () => {
    const b = clone(subFixture) as { filings: { recent: Record<string, unknown[]> } };
    const r = b.filings.recent;
    r.accessionNumber.push(T.accession); r.filingDate.push(T.filed); r.reportDate.push('2026-09-27');
    r.acceptanceDateTime.push('2026-10-15T20:30:00.000Z'); r.form.push('10-Q'); r.items.push(''); r.primaryDocument.push('intc-20260927.htm');
    return b;
  };
  beforeEach(() => { process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:INTC'; });

  test('통합 ①: SHA 동일(반영 전 본문)이면 워터마크 유지 → 다음 실행이 companyfacts 를 다시 받고, 반영되면 전진', async () => {
    const db = new FakeDb();
    db.map.set('NAS:INTC', { symbol: 'NAS:INTC', cik: INTC, sec_ticker: 'INTC', facts_filed_watermark: '2026-07-24' });
    const sameOld = intcFacts();
    const { client, fetchImpl } = makeClient({
      company_tickers: [[200, clone(tickersFixture)], [200, clone(tickersFixture)], [200, clone(tickersFixture)]],
      'submissions/CIK0000050863': [[200, subWithRecent10Q()], [200, subWithRecent10Q()], [200, subWithRecent10Q()]],
      'companyfacts/CIK0000050863': [[200, sameOld], [200, sameOld], [200, factsFor([TRIG_0724, T.accession])]],
    });
    await runEdgarSync({ db, client, now: NOW, log: () => undefined });
    expect(db.map.get('NAS:INTC')!.facts_filed_watermark).toBe('2026-07-24');
    const r2 = await runEdgarSync({ db, client, now: NOW, log: () => undefined });
    expect(r2.factsFetched).toBe(1);                          // 재요청
    expect(db.map.get('NAS:INTC')!.facts_filed_watermark).toBe('2026-07-24');
    const r3 = await runEdgarSync({ db, client, now: NOW, log: () => undefined });
    expect(r3.factsFetched).toBe(1);
    expect(db.map.get('NAS:INTC')!.facts_filed_watermark).toBe('2026-10-15');
    expect(fetchImpl).toHaveBeenCalledTimes(9);
  });

  test('통합 ②: 트리거 + companyfacts 404 → 워터마크 유지(다음 날 재시도)', async () => {
    const db = new FakeDb();
    db.map.set('NAS:INTC', { symbol: 'NAS:INTC', cik: INTC, sec_ticker: 'INTC', facts_filed_watermark: '2026-07-24' });
    const { client } = makeClient({
      company_tickers: [[200, clone(tickersFixture)]],
      'submissions/CIK0000050863': [[200, subWithRecent10Q()]],
      'companyfacts/CIK0000050863': [404],
    });
    await runEdgarSync({ db, client, now: NOW, log: () => undefined });
    expect(db.map.get('NAS:INTC')!.facts_filed_watermark).toBe('2026-07-24');
  });

  test('통합 ④: 10일이 지나도 반영이 안 보이면 전진 + console.warn(종목·사유만)', async () => {
    const db = new FakeDb();
    db.map.set('NAS:INTC', { symbol: 'NAS:INTC', cik: INTC, sec_ticker: 'INTC', facts_filed_watermark: '2026-07-24' });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { client } = makeClient({
      company_tickers: [[200, clone(tickersFixture)]],
      'submissions/CIK0000050863': [[200, subWithRecent10Q()]],
      'companyfacts/CIK0000050863': [[200, intcFacts()]],
    });
    await runEdgarSync({ db, client, now: () => new Date('2026-10-26T15:00:00Z'), log: () => undefined });   // ET 10-26 = 11일
    expect(db.map.get('NAS:INTC')!.facts_filed_watermark).toBe('2026-10-15');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/cik=50863 symbols=NAS:INTC 사유=trigger_accession_absent/);
    warn.mockRestore();
  });
});

describe('🔴 (C-3) 한 CIK 의 DB 오류는 그 CIK 만 실패 — 다음 CIK 계속', () => {
  test('INTC 의 시도 시각 기록(UPDATE)이 실패해도 ORCL 은 처리된다', async () => {
    process.env.OVERSEAS_UNIVERSE_SYMBOLS = 'NAS:INTC,NYS:ORCL';
    const db = new FakeDb();
    const orig = db.query.bind(db);
    db.query = (async (sql: string, params: unknown[] = []) => {
      if (/SET last_attempt_at = NOW\(\) WHERE cik/.test(sql) && params[0] === INTC) {
        throw Object.assign(new Error('Lock wait timeout'), { code: 'ER_LOCK_WAIT_TIMEOUT' });
      }
      return orig(sql, params);
    }) as typeof db.query;
    const orclSub = { ...clone(subFixture), cik: ORCL };
    const { client } = makeClient({
      company_tickers: [[200, clone(tickersFixture)]],
      'submissions/CIK0001341439': [[200, orclSub]],
      'companyfacts/CIK0001341439': [404],
    });
    const r = await runEdgarSync({ db, client, now: NOW, log: () => undefined });
    expect(r.ciksFailed).toEqual([{ cik: INTC, error: expect.stringContaining('Lock wait timeout') }]);
    expect(r.ciksDone).toBe(1);
  });
});

describe('🔴 (C-4) us_financial_facts upsert — 추출과 같은 우선순위(늦은 filed, 같은 filed 면 큰 accn)', () => {
  const base = { cik: INTC, taxonomy: 'us-gaap', tag: 'NetIncomeLoss', unit: 'USD', frame: 'CY2026Q2', periodStart: '2026-03-29', periodEnd: '2026-06-27', fy: 2026, fp: 'Q2', form: '10-Q' };
  const run = async (first: { val: number; filed: string; accn: string }, second: { val: number; filed: string; accn: string }) => {
    const sim = new UpsertSim(['cik', 'taxonomy', 'tag', 'unit', 'frame']);
    const db: Queryable = { query: async (sql: string, params: unknown[] = []) => { sim.exec(sql, params); return [{} as never, undefined]; } };
    await upsertFacts(db, [{ ...base, ...first }]);
    await upsertFacts(db, [{ ...base, ...second }]);
    return sim.only();
  };
  test('같은 filed·작은 accn 는 큰 accn 값을 덮지 못한다', async () => {
    const r = await run({ val: 2, filed: '2026-07-24', accn: '0000050863-26-000160' }, { val: 1, filed: '2026-07-24', accn: '0000050863-26-000157' });
    expect(r).toMatchObject({ val: 2, accn: '0000050863-26-000160', filed: '2026-07-24' });
  });
  test('같은 filed·큰 accn 는 덮는다', async () => {
    const r = await run({ val: 1, filed: '2026-07-24', accn: '0000050863-26-000157' }, { val: 2, filed: '2026-07-24', accn: '0000050863-26-000160' });
    expect(r).toMatchObject({ val: 2, accn: '0000050863-26-000160' });
  });
  test('더 오래된 filed 는 (accn 이 커도) 못 덮는다', async () => {
    const r = await run({ val: 2, filed: '2026-08-01', accn: '0000050863-26-000100' }, { val: 1, filed: '2026-07-24', accn: '0000050863-26-000999' });
    expect(r).toMatchObject({ val: 2, filed: '2026-08-01', accn: '0000050863-26-000100' });
  });
  test('더 최신 filed 는 (accn 이 작아도) 덮는다 — 모든 대상 열이 함께 바뀐다', async () => {
    const r = await run({ val: 1, filed: '2026-07-24', accn: '0000050863-26-000999' }, { val: 2, filed: '2026-08-01', accn: '0000050863-26-000100', } as never);
    expect(r).toMatchObject({ val: 2, filed: '2026-08-01', accn: '0000050863-26-000100' });
  });
});
