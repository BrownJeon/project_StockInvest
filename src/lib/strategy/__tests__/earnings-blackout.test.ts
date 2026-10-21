/**
 * T-062 요구 7 — 실적 블랙아웃(Q6 (b) 5 미국 거래일). confirmed·manual 만 막고, estimated 는 기록만(Q-2), 조회 실패는 unknown(Q-1 (a)).
 */
import { EARNINGS_BLACKOUT_DAYS, judgeBlackout, loadEarningsEvents, type EarningsEventRow } from '../earnings-blackout';
import { findMissingTables } from '@/lib/data/us-data-db';

jest.mock('@/lib/data/us-data-db', () => ({ findMissingTables: jest.fn() }));
const mMissing = findMissingTables as jest.Mock;

const D0 = '2026-10-20';
const S = ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26', '2026-10-27'];   // S1..S5
const AT = '2026-10-21T08:00:00+09:00';
const ev = (over: Partial<EarningsEventRow>): EarningsEventRow => ({
  symbol: 'NAS:CMCSA', status: 'confirmed', eventDateEt: null, windowStartEt: null, windowEndEt: null, eventTimeClass: 'unknown', ...over,
});
const judge = (events: EarningsEventRow[], d0 = D0, sessions = S) => judgeBlackout(events, d0, sessions, AT);

describe('judgeBlackout — 경계', () => {
  test('블랙아웃 길이는 5 거래일', () => expect(EARNINGS_BLACKOUT_DAYS).toBe(5));

  test('🔴 정확히 5거래일째(S5) confirmed → 차단', () => {
    expect(judge([ev({ eventDateEt: '2026-10-27', eventTimeClass: 'AMC' })]).blocked).toBe(true);
  });
  test('🔴 6거래일째(S6) confirmed → 통과, 다음 확정일로 기록', () => {
    const v = judge([ev({ eventDateEt: '2026-10-28', eventTimeClass: 'BMO' })]);
    expect(v).toEqual({ blocked: false, summary: { status: 'none', nextConfirmed: '2026-10-28', blackout_days: 5, observedAt: AT } });
  });
  test('S1 manual → 차단', () => {
    expect(judge([ev({ status: 'manual', eventDateEt: '2026-10-21', eventTimeClass: 'BMO' })]).blocked).toBe(true);
  });
  test.each([
    ['AMC', true], ['unknown', true], ['BMO', false],
  ] as const)('D0 당일 %s → 차단 %s (BMO 는 이미 D0 종가에 반영)', (cls, blocked) => {
    const v = judge([ev({ eventDateEt: D0, eventTimeClass: cls })]);
    expect(v.blocked).toBe(blocked);
    if (!blocked) expect(v.summary.nextConfirmed).toBeNull();
  });
  test('D0 와 S5 사이의 주말 날짜(10-24 토) → 차단(넓게 막는다)', () => {
    expect(judge([ev({ eventDateEt: '2026-10-24' })]).blocked).toBe(true);
  });
  test('D0 이전 확정일(이미 지남) → 영향 없음', () => {
    expect(judge([ev({ eventDateEt: '2026-10-19', eventTimeClass: 'AMC' })])).toEqual({
      blocked: false, summary: { status: 'none', nextConfirmed: null, blackout_days: 5, observedAt: AT },
    });
  });
  test('휴장 낀 구간: D0 11-25, S = 11-30..12-04 → 반일장 11-27 일정은 차단, S6 12-07 은 통과', () => {
    const d0 = '2026-11-25';
    const s = ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'];
    expect(judge([ev({ eventDateEt: '2026-11-27' })], d0, s).blocked).toBe(true);
    expect(judge([ev({ eventDateEt: '2026-12-04' })], d0, s).blocked).toBe(true);
    expect(judge([ev({ eventDateEt: '2026-12-07' })], d0, s).blocked).toBe(false);
  });
  test('다음 거래일 수가 5가 아니면 던진다(호출 오류)', () => {
    expect(() => judge([], D0, S.slice(0, 4))).toThrow();
  });
});

describe('judgeBlackout — estimated 는 기록만 (Q-2)', () => {
  test('🔴 추정 창이 [D0, S5] 와 겹쳐도 막지 않고 G5 형식으로 기록', () => {
    const v = judge([ev({ status: 'estimated', windowStartEt: '2026-10-24', windowEndEt: '2026-10-31' })]);
    expect(v).toEqual({
      blocked: false,
      summary: { status: 'estimated_window', window: { from: '2026-10-24', to: '2026-10-31' }, nextConfirmed: null, blackout_days: 5, observedAt: AT },
    });
  });
  test('추정 창이 S5 뒤에서 시작 → none', () => {
    expect(judge([ev({ status: 'estimated', windowStartEt: '2026-10-28', windowEndEt: '2026-11-04' })]).summary.status).toBe('none');
  });
  test('추정 창이 D0 전에 끝남 → none', () => {
    expect(judge([ev({ status: 'estimated', windowStartEt: '2026-10-10', windowEndEt: '2026-10-19' })]).summary.status).toBe('none');
  });
  test('겹치는 창이 여럿이면 가장 먼저 시작하는 것', () => {
    const v = judge([
      ev({ status: 'estimated', windowStartEt: '2026-10-25', windowEndEt: '2026-11-01' }),
      ev({ status: 'estimated', windowStartEt: '2026-10-19', windowEndEt: '2026-10-22' }),
    ]);
    expect(v.summary.window).toEqual({ from: '2026-10-19', to: '2026-10-22' });
  });
  test('확정 차단이 추정 기록보다 우선', () => {
    const v = judge([
      ev({ status: 'estimated', windowStartEt: '2026-10-21', windowEndEt: '2026-10-28' }),
      ev({ status: 'confirmed', eventDateEt: '2026-10-22' }),
    ]);
    expect(v.blocked).toBe(true);
    expect(v.summary.status).toBe('confirmed_blackout');
  });
  test('이벤트 없음 → none', () => {
    expect(judge([])).toEqual({ blocked: false, summary: { status: 'none', nextConfirmed: null, blackout_days: 5, observedAt: AT } });
  });
});

describe('loadEarningsEvents — 조회 실패는 unknown (Q-1 (a): 호출부가 해외 실행 전체를 건너뜀)', () => {
  beforeEach(() => { mMissing.mockReset(); mMissing.mockResolvedValue([]); });

  test('테이블 없음 → unknown/table_missing, 본 조회 안 함', async () => {
    mMissing.mockResolvedValue(['us_earnings_events']);
    const db = { query: jest.fn() };
    expect(await loadEarningsEvents(db as never, ['NAS:CMCSA'], D0)).toEqual({ kind: 'unknown', reason: 'table_missing' });
    expect(db.query).not.toHaveBeenCalled();
  });
  test('테이블 확인 자체가 실패 → unknown/read_failed', async () => {
    mMissing.mockRejectedValue(new Error('x'));
    expect(await loadEarningsEvents({ query: jest.fn() } as never, ['NAS:CMCSA'], D0)).toEqual({ kind: 'unknown', reason: 'read_failed' });
  });
  test('본 조회 오류 → unknown/read_failed', async () => {
    const db = { query: jest.fn().mockRejectedValue(new Error('ECONNRESET')) };
    expect(await loadEarningsEvents(db as never, ['NAS:CMCSA'], D0)).toEqual({ kind: 'unknown', reason: 'read_failed' });
  });
  test.each([
    ['enum 밖 status', { symbol: 'NAS:A', status: 'rumor', event_time_class: 'BMO', event_date_et: '2026-10-22' }],
    ['enum 밖 시간 구분', { symbol: 'NAS:A', status: 'confirmed', event_time_class: 'X', event_date_et: '2026-10-22' }],
    ['날짜 없는 확정 일정', { symbol: 'NAS:A', status: 'confirmed', event_time_class: 'BMO', event_date_et: null }],
  ])('해석할 수 없는 행(%s) → 조용히 버리지 않고 unknown', async (_n, row) => {
    const db = { query: jest.fn().mockResolvedValue([[row], undefined]) };
    expect((await loadEarningsEvents(db as never, ['NAS:A'], D0)).kind).toBe('unknown');
  });
  test('정상 → 종목별 묶음, SQL 은 활성 행만·날짜는 DATE_FORMAT 문자열', async () => {
    const db = {
      query: jest.fn().mockResolvedValue([[
        { symbol: 'NAS:CMCSA', status: 'confirmed', event_time_class: 'AMC', event_date_et: '2026-10-29', window_start_et: null, window_end_et: null },
        { symbol: 'NAS:CMCSA', status: 'estimated', event_time_class: 'unknown', event_date_et: null, window_start_et: '2026-10-24', window_end_et: '2026-10-31' },
        { symbol: 'NYS:BAC', status: 'manual', event_time_class: 'BMO', event_date_et: '2027-01-14', window_start_et: null, window_end_et: null },
      ], undefined]),
    };
    const r = await loadEarningsEvents(db as never, ['NAS:CMCSA', 'NYS:BAC'], D0);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.bySymbol.get('NAS:CMCSA')).toHaveLength(2);
    expect(r.bySymbol.get('NYS:BAC')).toEqual([{ symbol: 'NYS:BAC', status: 'manual', eventDateEt: '2027-01-14', windowStartEt: null, windowEndEt: null, eventTimeClass: 'BMO' }]);
    const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('superseded_by IS NULL');                       // 대체된(superseded) 행은 읽지 않는다
    expect(sql).toContain("DATE_FORMAT(event_date_et, '%Y-%m-%d')");
    expect(sql).toContain("status IN ('confirmed', 'manual') AND event_date_et >= ?");
    expect(sql).toContain("status = 'estimated' AND window_end_et >= ?");
    expect(params).toEqual([['NAS:CMCSA', 'NYS:BAC'], D0, D0]);
    expect(mMissing).toHaveBeenCalledWith(db, ['us_earnings_events']);
  });
  test('후보 0개 → 본 조회 없이 ok', async () => {
    const db = { query: jest.fn() };
    expect(await loadEarningsEvents(db as never, [], D0)).toEqual({ kind: 'ok', bySymbol: new Map() });
    expect(db.query).not.toHaveBeenCalled();
  });
});
