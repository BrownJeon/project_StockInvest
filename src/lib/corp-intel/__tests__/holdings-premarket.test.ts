/**
 * T-119 corp-intel/holdings-premarket — 순수 함수(보유 해석·24시간 창·알림 문구·상태 계산)와 DB 기록(가짜 풀).
 * 라우트 흐름(SEC·알림·스위치)은 `src/app/api/cron/holdings-premarket/__tests__/route.test.ts` 가 본다.
 */
import { escapeAlertText } from '@/lib/notify/escape';

const mockQuery = jest.fn();
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: (...a: unknown[]) => mockQuery(...a) }) }));

import {
  HP_MAX_ALERTS, HP_PARSER_VERSION, HP_STATUS_KEY, HP_SWITCH_KEY, etKstLabels, filingUrl, formatPremarketAlert,
  formatPremarketFailureAlert, formatPremarketSummary, isSnapshotStale, itemsHas202, nextHpStatus, parseHpStatus,
  premarketRowValues, readPremarketSwitch, recordPremarketFilings, safeAlertText, selectPremarketCandidates,
  shouldSendFailureAlert, usHoldingsFromPositions, writeHpStatus, type PremarketCandidate, type PremarketFilingInput,
} from '../holdings-premarket';
import { CI_RAW_ITEM_UPSERT_SQL } from '../raw-capture';

beforeEach(() => {
  mockQuery.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

// 2026-10-28(수) ET 08:00 EDT = 12:00Z = KST 21:00
const NOW = new Date('2026-10-28T12:00:00Z');
const f = (o: Partial<PremarketFilingInput> = {}): PremarketFilingInput => ({
  symbols: ['NAS:AAPL'], cik: 320193, accession: '0000320193-26-000101', form: '8-K', items: '2.02,9.01', filed: '2026-10-28',
  acceptedAtUtc: '2026-10-28T11:12:00.000Z', primaryDocUrl: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000101/a8k.htm',
  ...o,
});

describe('스위치', () => {
  test.each([
    [[], false, 'missing'],
    [[{ value: 'true' }], true, 'value'],
    [[{ value: true }], true, 'value'],
    [[{ value: 'false' }], false, 'value'],
    [[{ value: '"true"' }], false, 'value'],
    [[{ value: '1' }], false, 'value'],
    [[{ value: 'not json' }], false, 'value'],
  ])('%j → %p', async (rows, enabled, source) => {
    mockQuery.mockResolvedValueOnce([rows]);
    await expect(readPremarketSwitch()).resolves.toEqual({ enabled, source });
    expect(mockQuery.mock.calls[0][1]).toEqual([HP_SWITCH_KEY]);
  });
  test('읽기 오류 = 꺼짐', async () => {
    mockQuery.mockRejectedValueOnce(new Error('down'));
    await expect(readPremarketSwitch()).resolves.toEqual({ enabled: false, source: 'read_error' });
  });
});

describe('보유 목록 해석(스냅샷 positions)', () => {
  const positions = [
    { currency: 'KRW', qty: 1000, price: 1, value_krw: 1000 },
    { currency: 'USD', qty: 50, price: 1400, value_krw: 70000 },
    { currency: '005930', qty: 3, price: 70000, value_krw: 210000 },
    { currency: 'NAS:AAPL', qty: 2, price: 300000, value_krw: 600000 },
    { currency: 'NYS:BRK.B', qty: 1, price: 600000, value_krw: 600000 },
    { currency: 'AMS:SPY', qty: 1, price: 800000, value_krw: 800000 },
    { currency: 'NAS:ZERO', qty: 0, price: 1, value_krw: 0 },
    { currency: 'HKS:00700', qty: 1, price: 1, value_krw: 1 },
    { currency: 'nas:lower', qty: 1 },
    { currency: 'NAS:AAPL', qty: 2 },
    null, 'x',
  ];
  test('미국 3거래소 심볼만·수량>0·중복 제거·정렬 — 현금·국내·형식 밖 제외', () => {
    expect(usHoldingsFromPositions(positions)).toEqual(['AMS:SPY', 'NAS:AAPL', 'NYS:BRK.B']);
    expect(usHoldingsFromPositions(JSON.stringify(positions))).toEqual(['AMS:SPY', 'NAS:AAPL', 'NYS:BRK.B']);
  });
  test.each([[null], ['{'], [{}], [42], [[]]])('손상·빈 값 %p → []', (raw) => {
    expect(usHoldingsFromPositions(raw)).toEqual([]);
  });
  test('스냅샷 3시간 초과·시각 없음 = 오래됨', () => {
    expect(isSnapshotStale(new Date(NOW.getTime() - 3 * 3600_000), NOW)).toBe(false);
    expect(isSnapshotStale(new Date(NOW.getTime() - 3 * 3600_000 - 1), NOW)).toBe(true);
    expect(isSnapshotStale(null, NOW)).toBe(true);
    expect(isSnapshotStale(new Date('x'), NOW)).toBe(true);
  });
});

describe('🔴 24시간 창 후보 선별', () => {
  test('창 경계 — 정확히 24시간 전은 제외, 그 1초 뒤는 포함, 10분 넘는 미래는 제외', () => {
    const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
    const r = selectPremarketCandidates([
      f({ accession: '0000320193-26-000001', acceptedAtUtc: at(-24 * 3600_000) }),
      f({ accession: '0000320193-26-000002', acceptedAtUtc: at(-24 * 3600_000 + 1000) }),
      f({ accession: '0000320193-26-000003', acceptedAtUtc: at(10 * 60_000) }),
      f({ accession: '0000320193-26-000004', acceptedAtUtc: at(10 * 60_000 + 1000) }),
      f({ accession: '0000320193-26-000005', acceptedAtUtc: at(-30 * 86400_000) }),
    ], NOW);
    expect(r.candidates.map((c) => c.accession)).toEqual(['0000320193-26-000002', '0000320193-26-000003']);
    expect(r.outOfWindow).toBe(3);
  });
  test('접수 시각 없음·형식 다름 → 후보 아님(noAcceptance), 접수번호·양식·CIK·심볼 이상 → invalid, 같은 접수번호는 1회', () => {
    const r = selectPremarketCandidates([
      f({ acceptedAtUtc: null }),
      f({ accession: '0000320193-26-000102', acceptedAtUtc: '2026-10-28 11:12:00' }),
      f({ accession: 'bad' }),
      f({ accession: '0000320193-26-000103', form: '<b>x</b>' }),
      f({ accession: '0000320193-26-000104', cik: 0 }),
      f({ accession: '0000320193-26-000105', symbols: [] }),
      f(), f(),
    ], NOW);
    expect(r.noAcceptance).toBe(2);
    expect(r.invalid).toBe(4);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].isEarningsRelease).toBe(true);
  });
  test('실적 발표 표시 = 원본 8-K + items 2.02 (12.02·8-K/A 아님)', () => {
    expect(itemsHas202('2.02,9.01')).toBe(true);
    expect(itemsHas202('12.02')).toBe(false);
    const r = selectPremarketCandidates([
      f({ accession: '0000320193-26-000201', form: '8-K/A' }),
      f({ accession: '0000320193-26-000202', items: '7.01' }),
      f({ accession: '0000320193-26-000203', form: '10-Q', items: '' }),
    ], NOW);
    expect(r.candidates.map((c) => c.isEarningsRelease)).toEqual([false, false, false]);
  });
  test('링크 — 주 문서가 SEC Archives 꼴이면 그대로, 아니면 접수 폴더', () => {
    expect(filingUrl(f())).toBe('https://www.sec.gov/Archives/edgar/data/320193/000032019326000101/a8k.htm');
    expect(filingUrl(f({ primaryDocUrl: null }))).toBe('https://www.sec.gov/Archives/edgar/data/320193/000032019326000101/');
    expect(filingUrl(f({ primaryDocUrl: 'https://evil.example/x' }))).toBe('https://www.sec.gov/Archives/edgar/data/320193/000032019326000101/');
  });
});

const cand = (o: Partial<PremarketFilingInput> = {}): PremarketCandidate => selectPremarketCandidates([f(o)], NOW).candidates[0];

describe('🔴 기록 — us_filings 읽기만, ci_raw_item 새 행만 fresh', () => {
  function db(opts: { us?: string[]; ci?: string[]; affected?: number; usErr?: unknown; ciSelErr?: unknown; insErr?: unknown } = {}) {
    const sqls: string[] = [];
    mockQuery.mockImplementation(async (sql: string, params: unknown[]) => {
      sqls.push(sql);
      if (sql.startsWith('SELECT accession FROM us_filings')) {
        if (opts.usErr) throw opts.usErr;
        return [(params[0] as string[]).filter((k) => (opts.us ?? []).includes(k)).map((accession) => ({ accession }))];
      }
      if (sql.startsWith('SELECT source_key FROM ci_raw_item')) {
        if (opts.ciSelErr) throw opts.ciSelErr;
        return [(params[0] as string[]).filter((k) => (opts.ci ?? []).includes(k)).map((source_key) => ({ source_key }))];
      }
      if (sql === CI_RAW_ITEM_UPSERT_SQL) {
        if (opts.insErr) throw opts.insErr;
        const key = (params[0] as unknown[][])[0][1] as string;
        return [{ affectedRows: (opts.ci ?? []).includes(key) ? (opts.affected ?? 2) : 1 }];
      }
      throw new Error(`unexpected ${sql}`);
    });
    return sqls;
  }
  const A = cand({ accession: '0000320193-26-000301' });
  const B = cand({ accession: '0000320193-26-000302' });
  const C = cand({ accession: '0000320193-26-000303' });

  test('us_filings 에 있는 것·ci_raw_item 에 있던 것은 fresh 아님, 나머지만 fresh', async () => {
    const sqls = db({ us: [A.accession], ci: [B.accession] });
    const r = await recordPremarketFilings([A, B, C], NOW);
    expect(r).toMatchObject({ status: 'ok', inUsFilings: 1, alreadyCaptured: 1, insertFailed: 0 });
    expect(r.fresh.map((c) => c.accession)).toEqual([C.accession]);
    // 🔴 us_filings 는 SELECT 뿐
    expect(sqls.filter((s) => /us_filings/.test(s) && !/^SELECT/.test(s))).toEqual([]);
    expect(sqls.filter((s) => s === CI_RAW_ITEM_UPSERT_SQL)).toHaveLength(2);   // B(last_seen 갱신)·C
  });
  test('🔴 FOUND_ROWS — 미리 있던 키가 affectedRows 1 을 줘도(같은 초 재관측) fresh 아님', async () => {
    db({ ci: [B.accession], affected: 1 });
    const r = await recordPremarketFilings([B], NOW);
    expect(r.fresh).toEqual([]);
    expect(r.alreadyCaptured).toBe(1);
  });
  test('행 값 — sec_filing·source_key=접수번호·version 1·captured·published=접수 KST·first/last=지금 KST·parser_version', () => {
    const v = premarketRowValues(C, NOW);
    expect(v[0]).toBe('sec_filing');
    expect(v[1]).toBe(C.accession);
    expect(v[2]).toBe(1);
    expect(v[3]).toMatch(/^[0-9a-f]{64}$/);
    expect(v[4]).toBe('captured');
    expect(v[5]).toBe('2026-10-28 20:12:00');   // 11:12Z → KST
    expect(v[6]).toBe('2026-10-28 21:00:00');
    expect(v[7]).toBe('2026-10-28 21:00:00');
    expect(v[8]).toBe(C.url);
    expect(v[9]).toBeNull();
    expect(v[10]).toBeNull();
    expect(v[11]).toBe('8-K NAS:AAPL');
    expect(v[12]).toBe(HP_PARSER_VERSION);
    expect(HP_PARSER_VERSION.length).toBeLessThanOrEqual(24);
    expect(v).toHaveLength(13);
    // 🔴 UPSERT 의 갱신 목록에 first_seen_at 이 없다(T-116 SQL 재사용)
    expect(CI_RAW_ITEM_UPSERT_SQL.split('ON DUPLICATE KEY UPDATE')[1].trim()).toBe('last_seen_at = VALUES(last_seen_at)');
  });
  test.each([
    ['us_filings', { usErr: Object.assign(new Error('x'), { code: 'ER_NO_SUCH_TABLE' }) }],
    ['ci_raw_item', { ciSelErr: Object.assign(new Error('x'), { errno: 1146 }) }],
    ['ci_raw_item', { insErr: Object.assign(new Error('x'), { code: 'ER_NO_SUCH_TABLE' }) }],
  ])('테이블 없음(%s) → skipped_no_table, fresh 없음', async (t, o) => {
    db(o);
    const r = await recordPremarketFilings([A], NOW);
    expect(r.status).toBe('skipped_no_table');
    expect(r.missingTable).toBe(t);
    expect(r.fresh).toEqual([]);
  });
  test('DB 오류 → failed(던지지 않음)', async () => {
    db({ insErr: new Error('deadlock') });
    const r = await recordPremarketFilings([A], NOW);
    expect(r).toMatchObject({ status: 'failed', insertFailed: 1, fresh: [] });
    db({ usErr: new Error('down') });
    await expect(recordPremarketFilings([A], NOW)).resolves.toMatchObject({ status: 'failed' });
  });
  test('후보 0 → DB 를 건드리지 않음', async () => {
    db();
    await recordPremarketFilings([], NOW);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('🔴 알림 문구 — 이스케이프·제어문자·길이', () => {
  test('safeAlertText = notify escapeAlertText 와 같은 결과(제어·서식 문자가 없는 입력)', () => {
    for (const s of ['<b>x</b> & y', 'a<b', '&amp;', 'plain', '<a href="https://x">click</a>']) {
      expect(safeAlertText(s, 1000)).toBe(escapeAlertText(s));
    }
  });
  test('제어문자 → 공백, 서식 문자 삭제, 길이 제한(…), 문자열 아님 → 빈 값', () => {
    expect(safeAlertText('a\u0000b\u202Ec\u200Bd\n e')).toBe('a bcd e');
    expect(safeAlertText('x'.repeat(100), 10)).toBe(`${'x'.repeat(10)}…`);
    expect(safeAlertText(42)).toBe('');
  });
  test('개별 알림 실제 문구(EDT, 같은 날)', () => {
    const a = formatPremarketAlert(cand(), NOW);
    expect(a.title).toBe('보유 종목 개장 전 공시');
    expect(a.body).toBe('AAPL 8-K(실적 발표 Item 2.02) — 접수 ET 07:12 (KST 20:12). 분석에 아직 반영되지 않은 새 공시입니다. 알림만, 주문 없음.\n'
      + 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000101/a8k.htm');
  });
  test('외부 값에 <·& 가 섞여도 본문에 원시 꺾쇠가 없다', () => {
    const c = { ...cand(), form: '<i>8-K</i>&', symbols: ['NAS:A<B'], url: 'https://www.sec.gov/x?<script>' };
    const a = formatPremarketAlert(c, NOW);
    expect(a.body).not.toMatch(/[<>]/);
    expect(a.body).toContain('&lt;i&gt;8-K&lt;/i&gt;&amp;');
  });
  test('날짜가 다르면 날짜를 붙인다 — 어제 ET 19:30(EST 전환 뒤)', () => {
    const now = new Date('2026-11-02T13:00:00Z');   // 11-02 ET 08:00 EST = KST 22:00
    expect(etKstLabels(new Date('2026-11-02T00:30:00Z'), now)).toEqual({ et: '11-01 19:30', kst: '09:30' });
    expect(etKstLabels(new Date('2026-11-02T12:05:00Z'), now)).toEqual({ et: '07:05', kst: '21:05' });
  });
  test('요약 — 10건 넘으면 1건에 앞 10줄 + 외 N건', () => {
    const list = Array.from({ length: 12 }, (_, i) => cand({ accession: `0000320193-26-0004${String(i).padStart(2, '0')}` }));
    const s = formatPremarketSummary(list, NOW);
    expect(s.title).toBe('보유 종목 개장 전 공시 12건(요약)');
    expect(s.body.split('\n').filter((l) => l.startsWith('• '))).toHaveLength(HP_MAX_ALERTS);
    expect(s.body).toContain('… 외 2건');
    expect(s.body).not.toMatch(/[<>]/);
  });
  test('실패 알림 문구', () => {
    const a = formatPremarketFailureAlert({
      lastAt: 'x', status: 'blocked', holdings: 3, checked: 1, newFilings: 0, alerted: 0, consecutiveFailures: 2, detail: 'cik_failed=1:<x>',
    });
    expect(a.title).toBe('보유 종목 개장 전 공시 확인 실패');
    expect(a.body).toContain('2일 연속');
    expect(a.body).not.toMatch(/[<>]/);
  });
});

describe('상태 계산', () => {
  const base = { holdings: 3, checked: 3, newFilings: 0, alerted: 0 };
  test('연속 실패: failed·blocked +1 / ok·no_holdings 0 / 그 밖은 유지', () => {
    const p = { consecutiveFailures: 1 };
    expect(nextHpStatus(p, { ...base, status: 'failed' }, NOW).consecutiveFailures).toBe(2);
    expect(nextHpStatus(p, { ...base, status: 'blocked' }, NOW).consecutiveFailures).toBe(2);
    expect(nextHpStatus(p, { ...base, status: 'ok' }, NOW).consecutiveFailures).toBe(0);
    expect(nextHpStatus(p, { ...base, status: 'no_holdings' }, NOW).consecutiveFailures).toBe(0);
    for (const s of ['switch_off', 'stale_holdings', 'skipped_no_table', 'no_user_agent'] as const) {
      expect(nextHpStatus(p, { ...base, status: s }, NOW).consecutiveFailures).toBe(1);
    }
    expect(nextHpStatus(null, { ...base, status: 'failed' }, NOW)).toEqual({
      lastAt: '2026-10-28 21:00:00', status: 'failed', holdings: 3, checked: 3, newFilings: 0, alerted: 0, consecutiveFailures: 1,
    });
  });
  test('실패 알림은 연속 2회부터·ET 하루 1건', () => {
    const s = nextHpStatus({ consecutiveFailures: 1 }, { ...base, status: 'failed' }, NOW);
    expect(shouldSendFailureAlert(s, '2026-10-28')).toBe(true);
    expect(shouldSendFailureAlert({ ...s, failureAlertEtDate: '2026-10-28' }, '2026-10-28')).toBe(false);
    expect(shouldSendFailureAlert(nextHpStatus(null, { ...base, status: 'failed' }, NOW), '2026-10-28')).toBe(false);
    expect(shouldSendFailureAlert(nextHpStatus({ consecutiveFailures: 5 }, { ...base, status: 'stale_holdings' }, NOW), '2026-10-28')).toBe(false);
  });
  test('이전 값 해석 — 손상이면 null, 날짜 꼴만 유지', () => {
    expect(parseHpStatus('{')).toBeNull();
    expect(parseHpStatus(null)).toBeNull();
    expect(parseHpStatus({ consecutiveFailures: 3, failureAlertEtDate: '2026-10-27' })).toEqual({ consecutiveFailures: 3, failureAlertEtDate: '2026-10-27' });
    expect(parseHpStatus(JSON.stringify({ consecutiveFailures: -1, failureAlertEtDate: 'x' }))).toEqual({ consecutiveFailures: 0 });
  });
  test('쓰기 — system_config 의 holdings_premarket_status 한 키, 실패는 false(던지지 않음)', async () => {
    mockQuery.mockResolvedValueOnce([{}]);
    const v = nextHpStatus(null, { ...base, status: 'ok' }, NOW);
    await expect(writeHpStatus(v)).resolves.toBe(true);
    expect(mockQuery.mock.calls[0][0]).toBe('INSERT INTO system_config (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)');
    expect(mockQuery.mock.calls[0][1]).toEqual([HP_STATUS_KEY, JSON.stringify(v)]);
    mockQuery.mockRejectedValueOnce(new Error('x'));
    await expect(writeHpStatus(v)).resolves.toBe(false);
  });
});
