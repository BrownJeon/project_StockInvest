/**
 * T-130 D7-A — 읽기 계층이 `signals.indicators.gate` 를 함께 주는지(차단 시그널 카드·오늘 분석 후보 줄이 「차단」/「건너뜀」을 가르는 근거).
 * 읽기 전용이다 — SQL 은 바꾸지 않는다(두 SQL 은 이미 `indicators` 열을 읽는다). 실제 DB 로 도는 확인은 `ops-disposable-mariadb.test.ts`(일회용 DB).
 */
jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));

import { BLOCKED_POST_MARKET_SQL, gateFromIndicators } from '../trade';
import { RUN_CANDIDATE_SIGNALS_SQL } from '../analysis';

describe('gateFromIndicators', () => {
  test('문자열 gate 만 돌려준다 — JSON 문자열·객체 둘 다', () => {
    expect(gateFromIndicators('{"ai":{"confidence":72},"gate":"validation_gate"}')).toBe('validation_gate');
    expect(gateFromIndicators({ gate: 'validation_gate' })).toBe('validation_gate');
    expect(gateFromIndicators({ gate: 'other_gate' })).toBe('other_gate');
  });
  test('없거나 문자열이 아니거나 비어 있으면 null — 「검증 관문」 으로 지어내지 않는다', () => {
    for (const raw of [null, undefined, '', 'not json', '{}', '{"gate":1}', '{"gate":null}', '{"gate":""}', { gate: 5 }, { gate: '' }, [], 7]) {
      expect([raw, gateFromIndicators(raw)]).toEqual([raw, null]);
    }
  });
});

describe('SQL 은 바뀌지 않는다 — 이미 indicators 를 읽는다 (읽기 전용 · 쓰기 문장 없음)', () => {
  test.each([['BLOCKED_POST_MARKET_SQL', BLOCKED_POST_MARKET_SQL], ['RUN_CANDIDATE_SIGNALS_SQL', RUN_CANDIDATE_SIGNALS_SQL]])('%s', (_name, sql) => {
    expect(sql).toMatch(/^\s*SELECT\b/);
    expect(sql).toMatch(/\bindicators\b/);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE)\b/i);
  });
});
