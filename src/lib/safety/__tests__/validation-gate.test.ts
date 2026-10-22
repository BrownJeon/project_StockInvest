/**
 * T-072 (D5) — 검증 상태 관문 판정 모듈 단위 시험.
 *
 * 지킬 것 (설계 F-2·L-5·Stage 0 D 절):
 *  1. 첫 줄이 side 판정 — 정규화(trim·소문자) 후 정확히 `'sell'` 이면 **I/O 0**(getPool 도 부르지 않는다)으로 허용,
 *     그 밖의 모든 값('BUY'·'buy '·'purchase'·''·null…)은 **매수로 판정**(WP-2c R-1 — 예전엔 'buy' 아님 = 허용이었다)
 *  2. 허용 집합은 정확히 backtested·paper_validated
 *  3. fail-closed 행렬 — null/''/비문자열 → null_strategy, 행 없음 → unregistered, unvalidated, 이상값 → invalid_status,
 *     조회 예외(ER_BAD_FIELD_ERROR·getPool 실패 포함) → lookup_error. 전부 차단, 던지지 않는다
 *  4. 캐시 없음 — 호출마다 PK 조회 1회, 강등이 다음 호출에 바로 반영된다
 *  5. 끄는 스위치 없음 — system_config 를 읽지 않는다
 */
import fs from 'node:fs';
import path from 'node:path';
import { getPool } from '@/lib/db';
import {
  VALIDATED_STATUSES,
  describeValidationBlock,
  evaluateValidationGate,
  isSellSide,
  isValidatedStatus,
} from '../validation-gate';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));

let calls: Array<{ sql: string; params: unknown[] }>;
function poolReturning(impl: (sql: string, params: unknown[]) => unknown) {
  calls = [];
  const query = jest.fn(async (sql: unknown, params: unknown[] = []) => {
    calls.push({ sql: String(sql), params });
    return impl(String(sql), params);
  });
  (getPool as jest.Mock).mockReturnValue({ query });
  return query;
}
const statusRow = (v: unknown) => () => [[{ validation_status: v }]];

beforeEach(() => { jest.clearAllMocks(); calls = []; });

describe('1. 🔴 매도(정규화 후 정확히 sell)만 I/O 0 으로 허용 — 그 밖의 모든 값은 매수로 판정 (WP-2c R-1)', () => {
  test.each([['sell'], ['SELL'], ['Sell'], [' sell '], ['sell\t'], ['\nSELL ']])('side=%p → not_applicable, getPool 미호출 (매도 보호)', async (side) => {
    // 조회가 일어나면 던지게 해 둔다 — 실행되면 차단·예외 쪽으로 번진다는 뜻이므로 반드시 0 이어야 한다
    (getPool as jest.Mock).mockImplementation(() => { throw new Error('must not touch db'); });
    for (const strategyId of [null, '', 'exit-engine-v1', 'unknown-v9']) {
      await expect(evaluateValidationGate({ side, strategyId })).resolves.toEqual({ allowed: true, kind: 'not_applicable' });
    }
    expect(getPool).not.toHaveBeenCalled();
    expect(isSellSide(side)).toBe(true);
  });

  // 예전엔 정확히 'buy' 만 매수로 봐서 'BUY'·'buy ' 가 관문을 건너뛰었다. MariaDB ENUM 은 그 값들을 buy 로 저장한다(Reviewer 직접 확인).
  const NOT_SELL: unknown[] = ['buy', 'BUY', 'Buy', 'buy ', ' BUY', 'purchase', 'sel', 'sells', '', '   ', undefined, null, 0, 1, {}, ['buy']];
  test.each(NOT_SELL.map((v) => [v]))('side=%p → 매수로 판정: 미검증 전략이면 차단(PK 조회 1회)', async (side) => {
    const q = poolReturning(statusRow('unvalidated'));
    await expect(evaluateValidationGate({ side, strategyId: 'rsi-oversold-v1' }))
      .resolves.toEqual({ allowed: false, kind: 'blocked', reason: 'unvalidated', strategyId: 'rsi-oversold-v1', status: 'unvalidated' });
    expect(q).toHaveBeenCalledTimes(1);
    expect(isSellSide(side)).toBe(false);
  });

  test.each(NOT_SELL.map((v) => [v]))('side=%p + 귀속 없음 → null_strategy 차단(조회 없이)', async (side) => {
    const q = poolReturning(statusRow('backtested'));
    await expect(evaluateValidationGate({ side, strategyId: null })).resolves.toMatchObject({ allowed: false, reason: 'null_strategy' });
    expect(q).not.toHaveBeenCalled();
  });

  test("'BUY' 도 검증된 전략이면 허용 — 판정은 매수 규칙 그대로(과차단 아님)", async () => {
    poolReturning(statusRow('backtested'));
    await expect(evaluateValidationGate({ side: 'BUY', strategyId: 'ok-v1' })).resolves.toMatchObject({ allowed: true, kind: 'validated' });
  });

  test('문자열화가 던지는 값 → 매수로 판정(fail-closed), 던지지 않는다', async () => {
    const evil = { toString() { throw new Error('boom'); } };
    expect(isSellSide(evil)).toBe(false);
    poolReturning(statusRow('backtested'));
    await expect(evaluateValidationGate({ side: evil, strategyId: null })).resolves.toMatchObject({ allowed: false, reason: 'null_strategy' });
  });
});

describe('2. 허용 집합 = backtested · paper_validated 뿐', () => {
  test('상수가 정확히 두 값', () => {
    expect([...VALIDATED_STATUSES]).toEqual(['backtested', 'paper_validated']);
    expect(isValidatedStatus('backtested')).toBe(true);
    expect(isValidatedStatus('paper_validated')).toBe(true);
    for (const v of ['unvalidated', 'BACKTESTED', '', null, undefined, 1, 'validated']) expect(isValidatedStatus(v)).toBe(false);
  });

  test.each(['backtested', 'paper_validated'])('%s → 허용 (PK 1회 조회)', async (st) => {
    const q = poolReturning(statusRow(st));
    await expect(evaluateValidationGate({ side: 'buy', strategyId: 'rsi-oversold-v1' }))
      .resolves.toEqual({ allowed: true, kind: 'validated', strategyId: 'rsi-oversold-v1', status: st });
    expect(q).toHaveBeenCalledTimes(1);
    expect(calls[0].sql).toBe('SELECT validation_status FROM strategies WHERE id = ? LIMIT 1');
    expect(calls[0].params).toEqual(['rsi-oversold-v1']);
  });
});

describe('3. 🔴 fail-closed 행렬 (매수)', () => {
  test.each([[null], [undefined], [''], ['   '], [123], [{}]])('전략 ID %p → null_strategy, 조회하지 않는다', async (sid) => {
    const q = poolReturning(statusRow('backtested'));
    const v = await evaluateValidationGate({ side: 'buy', strategyId: sid });
    expect(v).toEqual({ allowed: false, kind: 'blocked', reason: 'null_strategy', strategyId: null, status: null });
    expect(q).not.toHaveBeenCalled();
  });

  test('행 없음 → unregistered', async () => {
    poolReturning(() => [[]]);
    expect(await evaluateValidationGate({ side: 'buy', strategyId: 'oversold-bounce-v1' }))
      .toMatchObject({ allowed: false, reason: 'unregistered', strategyId: 'oversold-bounce-v1', status: null });
  });

  test('unvalidated → unvalidated', async () => {
    poolReturning(statusRow('unvalidated'));
    expect(await evaluateValidationGate({ side: 'buy', strategyId: 'rsi-oversold-v1' }))
      .toMatchObject({ allowed: false, reason: 'unvalidated', status: 'unvalidated' });
  });

  test.each([[null], [''], ['BACKTESTED'], ['validated'], [0], [1]])('이상값 %p → invalid_status', async (raw) => {
    poolReturning(statusRow(raw));
    const v = await evaluateValidationGate({ side: 'buy', strategyId: 's1' });
    expect(v).toMatchObject({ allowed: false, reason: 'invalid_status', strategyId: 's1' });
  });

  test('조회 예외(마이그레이션 전 ER_BAD_FIELD_ERROR) → lookup_error, 던지지 않는다', async () => {
    poolReturning(() => { throw Object.assign(new Error("Unknown column 'validation_status' in 'field list'"), { code: 'ER_BAD_FIELD_ERROR' }); });
    const v = await evaluateValidationGate({ side: 'buy', strategyId: 's1' });
    expect(v).toMatchObject({ allowed: false, reason: 'lookup_error', strategyId: 's1' });
    expect((v as { detail?: string }).detail).toContain('ER_BAD_FIELD_ERROR');
  });

  test('getPool 자체가 던져도(스키마 fail-closed 상태) lookup_error', async () => {
    (getPool as jest.Mock).mockImplementation(() => { throw new Error('setup fatal'); });
    expect(await evaluateValidationGate({ side: 'buy', strategyId: 's1' })).toMatchObject({ allowed: false, reason: 'lookup_error' });
  });

  test('rows 가 배열이 아니어도(드라이버 이상) 허용하지 않는다', async () => {
    poolReturning(() => [{ affectedRows: 0 }]);
    expect((await evaluateValidationGate({ side: 'buy', strategyId: 's1' })).allowed).toBe(false);
  });
});

describe('4. 캐시 없음 — 강등은 다음 호출에 바로 반영', () => {
  test('backtested → (사용자 SQL 강등) → unvalidated : 두 번째는 차단, 조회 2회', async () => {
    let st = 'backtested';
    const q = poolReturning(() => [[{ validation_status: st }]]);
    expect((await evaluateValidationGate({ side: 'buy', strategyId: 's1' })).allowed).toBe(true);
    st = 'unvalidated';
    expect((await evaluateValidationGate({ side: 'buy', strategyId: 's1' })).allowed).toBe(false);
    expect(q).toHaveBeenCalledTimes(2);
  });
});

describe('5. 끄는 스위치 없음 · 사람이 읽는 문구', () => {
  test('모듈이 system_config(스위치)·캐시 TTL 을 쓰지 않는다', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'validation-gate.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/system_config/);
    expect(src).not.toMatch(/TTL|cache|Date\.now/i);
  });

  test.each([
    ['null_strategy', null, null, '전략 귀속 없음'],
    ['unregistered', 'x-v1', null, '등록되지 않은 전략(x-v1)'],
    ['unvalidated', 'x-v1', 'unvalidated', '검증 안 된 전략(x-v1: unvalidated)'],
    ['invalid_status', 'x-v1', 'weird', '상태 이상(x-v1: weird)'],
    ['lookup_error', 'x-v1', null, '조회 실패(x-v1'],
  ] as const)('%s 문구', (reason, sid, status, expected) => {
    const s = describeValidationBlock({ allowed: false, kind: 'blocked', reason, strategyId: sid, status });
    expect(s).toContain(expected);
    expect(s).toContain('차단');
  });
});
