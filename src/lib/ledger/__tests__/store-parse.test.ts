/**
 * T-074 store.ts 의 DB 없는 부분 — 행 해석(DECIMAL 문자열·DATETIME)·저장 JSON 검증·바인딩 형식·오류 구분.
 * 돈 값이 형식 오류일 때 0 으로 삼키지 않고 던지는지(LedgerDataError)를 고정한다. 합성값만 쓴다.
 */
jest.mock('@/lib/db', () => ({ getPool: () => { throw new Error('DB 를 부르면 안 된다'); } }));

import {
  amountText, dupKeyOf, isDupKey, isNoTable, LedgerDataError, nowWallString, parseBaselineDoc, parseLedgerRow, parseMarksDoc,
} from '../store';

const row = (over: Record<string, unknown> = {}) => ({
  id: 5, client_entry_id: 'cid-0001-xxxx', kind: 'deposit', occurred_at: new Date('2026-09-03T01:00:00.000Z'), currency: 'USD',
  amount: '118.60', counter_currency: null, counter_amount: null, fx_rate_used: '1324.6300', fx_source: 'snapshot', krw_equiv: '157101.00',
  anchor_snapshot_id: 102, anchor_snapshot_ts: '2026-09-03 10:40:00', anchor_status: 'matched', anchor_detail: 'x', memo: null, source: 'user',
  supersedes_id: null, created_at: '2026-09-15 09:55:00', created_by_user_id: 7, deleted_at: null, deleted_by_user_id: null, delete_reason: null,
  ...over,
});

describe('parseLedgerRow', () => {
  test('mysql2 모양(DECIMAL 문자열 · DATETIME Date/문자열) → 숫자 · KST 벽시계 ms', () => {
    const e = parseLedgerRow(row());
    expect(e).toMatchObject({ id: 5, kind: 'deposit', currency: 'USD', amount: 118.6, fxRateUsed: 1324.63, krwEquiv: 157_101, anchorSnapshotId: 102, anchorStatus: 'matched', createdByUserId: 7, deletedAtMs: null });
    expect(e.occurredAtMs).toBe(Date.UTC(2026, 8, 3, 10, 0));   // Date(01:00Z) + 9h
    expect(e.anchorSnapshotTsMs).toBe(Date.UTC(2026, 8, 3, 10, 40));
  });
  test.each([
    ['amount', 'abc'], ['amount', '1e5'], ['amount', ''], ['amount', null], ['krw_equiv', '12,000'], ['fx_rate_used', 'NaN'],
    ['occurred_at', 'not-a-date'], ['kind', 'dividend'], ['currency', 'EUR'], ['anchor_status', 'done'], ['id', 'x'],
  ])('🔴 %s = %p → 0 으로 삼키지 않고 LedgerDataError', (k, v) => {
    expect(() => parseLedgerRow(row({ [k]: v }))).toThrow(LedgerDataError);
  });
  test('숫자로 온 DECIMAL(decimalNumbers 설정) 도 받는다', () => {
    expect(parseLedgerRow(row({ amount: 118.6, krw_equiv: 157101 })).amount).toBe(118.6);
  });
});

describe('parseBaselineDoc · parseMarksDoc', () => {
  const doc = {
    version: 2, updatedAt: '2026-09-15 09:55:00', baselineAt: '2026-09-01 07:10:00', snapshotId: 100,
    snapshot: { totalKrw: 16_060_000, krwCash: 1_200_000, usdCash: 1500, fx: 1240 },
    confirmed: { krwCash: null, usdCash: 1500, at: '2026-09-15 09:55:00', note: null }, baselineTotalKrw: 16_060_000, history: [],
  };
  test('정상 문서(문자열 JSON 도)', () => {
    expect(parseBaselineDoc(JSON.stringify(doc))).toMatchObject({ status: 'ok', doc: { version: 2, snapshotId: 100, confirmed: { krwCash: null, usdCash: 1500 } } });
  });
  test.each([
    ['JSON 아님', '{bad'],
    ['version 없음', { ...doc, version: 0 }],
    ['snapshotId 없음', { ...doc, snapshotId: null }],
    ['baselineAt 형식', { ...doc, baselineAt: 'yesterday' }],
    ['총액 문자열', { ...doc, snapshot: { ...doc.snapshot, totalKrw: '16060000' } }],
    ['확인값 문자열', { ...doc, confirmed: { ...doc.confirmed, usdCash: '1500' } }],
    ['기준 총자산 없음', { ...doc, baselineTotalKrw: null }],
  ])('손상: %s → invalid(덮어쓰지 않게)', (_n, v) => {
    expect(parseBaselineDoc(v).status).toBe('invalid');
  });
  test('표시 문서: 형식이 이상한 표시는 버리고 나머지는 읽는다', () => {
    const r = parseMarksDoc({ version: 3, marks: { '109-KRW': { state: 'dismissed', reason: 'a', at: 'x', byUserId: 7 }, '110-KRW': { state: 'other' } }, log: [] });
    expect(r).toMatchObject({ status: 'ok', doc: { version: 3, marks: { '109-KRW': { reason: 'a', byUserId: 7 } } } });
    expect(Object.keys((r as { doc: { marks: object } }).doc.marks)).toEqual(['109-KRW']);
    expect(parseMarksDoc({ version: 0 }).status).toBe('invalid');
  });
});

describe('바인딩 형식 · 오류 구분 · 시각', () => {
  test('amountText: 원 = 정수 문자열, 달러 = 소수 2자리(부동소수 흔들림 없음)', () => {
    expect(amountText('KRW', 2_000_000)).toBe('2000000');
    expect(amountText('USD', 118.6)).toBe('118.60');
    expect(amountText('USD', 0.1 + 0.2)).toBe('0.30');
  });
  test('중복 키 구분 · 테이블 없음', () => {
    const dup = (k: string) => Object.assign(new Error(`Duplicate entry 'x' for key '${k}'`), { code: 'ER_DUP_ENTRY', errno: 1062 });
    expect([dupKeyOf(dup('uq_cfl_client_entry')), dupKeyOf(dup('uq_cfl_live_dup')), dupKeyOf(dup('uq_cfl_supersedes')), dupKeyOf(dup('PRIMARY'))]).toEqual(['client', 'live', 'supersedes', 'other']);
    expect(dupKeyOf(new Error('x'))).toBeNull();
    expect(isDupKey({ errno: 1062 })).toBe(true);
    // Reviewer L8: 원장 표(cash_flow_ledger) 이름이 메시지에 있을 때만
    const t = (m: string, o: object) => Object.assign(new Error(m), o);
    expect([
      isNoTable(t("Table 'x.cash_flow_ledger' doesn't exist", { code: 'ER_NO_SUCH_TABLE' })), isNoTable(t("Table 'x.cash_flow_ledger' doesn't exist", { errno: 1146 })),
      isNoTable({ code: 'ER_NO_SUCH_TABLE' }), isNoTable(t("Table 'x.system_config' doesn't exist", { errno: 1146 })), isNoTable(new Error('x')),
    ]).toEqual([true, true, false, false, false]);
  });
  test('nowWallString: 순간 → KST 벽시계(서버 TZ 무관)', () => {
    expect(nowWallString(new Date('2026-09-15T00:55:07.900Z'))).toBe('2026-09-15 09:55:07');
  });
});
