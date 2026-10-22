/**
 * T-072 F-10 — 승급 경로 봉쇄. `PATCH /api/strategies/[id]` 는 `validation_status`(및 승급 감사 컬럼)를 **받지 않는다.**
 * 승급·강등은 증거 확인 후 사용자 승인 SQL 로만 한다(코드가 임의로 바꾸지 않는다). 코드 변경 없이 현재 동작을 시험으로 고정한다.
 */
jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));

import { getPool } from '@/lib/db';
import { PATCH } from '../route';

let query: jest.Mock;
beforeEach(() => {
  jest.clearAllMocks();
  query = jest.fn(async () => [{ affectedRows: 1 }]);
  (getPool as jest.Mock).mockReturnValue({ query });
});

const call = (body: unknown) => PATCH(
  new Request('http://x/api/strategies/rsi-oversold-v1', { method: 'PATCH', body: JSON.stringify(body) }) as never,
  { params: Promise.resolve({ id: 'rsi-oversold-v1' }) },
);

describe('🔴 validation_status 는 이 API 로 바꿀 수 없다', () => {
  test.each([
    [{ validation_status: 'backtested' }],
    [{ validation_status: 'paper_validated' }],
    [{ validation_status: 'backtested', validation_changed_at: '2026-10-23 00:00:00', validation_evidence: 'x' }],
    [{ validationStatus: 'backtested' }],
  ])('%p 만 보내면 400 · UPDATE 0', async (body) => {
    const res = await call(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'no valid fields' });
    expect(query).not.toHaveBeenCalled();
  });

  test('허용 필드와 섞어 보내도 UPDATE 에 validation_* 가 들어가지 않는다', async () => {
    const res = await call({ enabled: true, validation_status: 'backtested', validation_evidence: 'x' });
    expect(res.status).toBe(200);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, vals] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toBe('UPDATE strategies SET enabled=? WHERE id=?');
    expect(sql).not.toMatch(/validation/i);
    expect(vals).toEqual([1, 'rsi-oversold-v1']);
  });
});
