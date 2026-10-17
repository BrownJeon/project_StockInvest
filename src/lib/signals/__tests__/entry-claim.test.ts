/**
 * T-043 — entry-claim: 주문 전 선점·복귀·주문 번호 기록의 SQL 형태와 반환값.
 * 조건(WHERE)이 곧 안전장치다: 선점은 `approved_pending_entry` + 만료 전일 때만, 복귀는 `executing` + 주문 번호 없음일 때만.
 */
import { claimEntrySignal, recordEntryOrder, releaseEntryClaim } from '../entry-claim';

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const runner = (affectedRows: number | 'throw') => ({
  query: jest.fn(async () => {
    if (affectedRows === 'throw') throw new Error('db gone');
    return [{ affectedRows }];
  }),
});

describe('claimEntrySignal', () => {
  test('🔴 SQL: approved_pending_entry 이고 만료 전일 때만 executing 으로 — 한 문장', async () => {
    const q = runner(1);
    await claimEntrySignal(q, 5);
    const [sql, params] = q.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(norm(sql)).toBe("UPDATE signals SET status='executing', updated_at=NOW() WHERE id=? AND status='approved_pending_entry' AND (expires_at IS NULL OR expires_at > NOW())");
    expect(params).toEqual([5]);
  });

  test.each([[1, true], [0, false], [2, false]])('affectedRows %s → %s (정확히 1일 때만 선점 성공)', async (n, expected) => {
    expect(await claimEntrySignal(runner(n as number), 5)).toBe(expected);
  });

  test('🔴 DB 오류는 삼키지 않고 던진다 — 호출자가 주문하지 않아야 한다', async () => {
    await expect(claimEntrySignal(runner('throw'), 5)).rejects.toThrow('db gone');
  });

  test('결과 형태가 이상하면(헤더 없음) 선점 실패로 본다', async () => {
    expect(await claimEntrySignal({ query: jest.fn(async () => [[]]) }, 5)).toBe(false);
    expect(await claimEntrySignal({ query: jest.fn(async () => undefined) }, 5)).toBe(false);
  });
});

describe('releaseEntryClaim', () => {
  test('🔴 SQL: executing 이고 주문 번호가 없는 행만 되돌린다', async () => {
    const q = runner(1);
    expect(await releaseEntryClaim(q, 5)).toBe(true);
    const [sql, params] = q.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(norm(sql)).toBe("UPDATE signals SET status='approved_pending_entry', updated_at=NOW() WHERE id=? AND status='executing' AND consumed_order_id IS NULL");
    expect(params).toEqual([5]);
  });
  test('대상이 없으면 false', async () => { expect(await releaseEntryClaim(runner(0), 5)).toBe(false); });
  test('DB 오류는 던진다(호출자가 경보)', async () => { await expect(releaseEntryClaim(runner('throw'), 5)).rejects.toThrow('db gone'); });
});

describe('recordEntryOrder', () => {
  test('SQL: 주문 번호만 연결하고 executing 인 행에만 적용 — 상태는 바꾸지 않는다', async () => {
    const q = runner(1);
    expect(await recordEntryOrder(q, 5, 77)).toBe(true);
    const [sql, params] = q.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(norm(sql)).toBe("UPDATE signals SET consumed_order_id=?, updated_at=NOW() WHERE id=? AND status='executing'");
    expect(norm(sql)).not.toMatch(/SET status/);
    expect(params).toEqual([77, 5]);
  });
  test('주문 번호가 없으면 null 을 연결한다', async () => {
    const q = runner(1);
    await recordEntryOrder(q, 5, null);
    expect((q.query.mock.calls[0] as unknown as [string, unknown[]])[1]).toEqual([null, 5]);
  });
  test('대상이 없으면 false, DB 오류는 던진다', async () => {
    expect(await recordEntryOrder(runner(0), 5, 1)).toBe(false);
    await expect(recordEntryOrder(runner('throw'), 5, 1)).rejects.toThrow('db gone');
  });
});
