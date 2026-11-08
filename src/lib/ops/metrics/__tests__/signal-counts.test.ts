/**
 * T-108 A-4 — 승인 대기 숫자(홈·거래 같은 집합) (가이드 §4.8).
 * SQL 에 'pending' 포함·'detected' 미포함·만료 절 포함, 시장별 GROUP BY. 숫자는 서버 COUNT.
 */
jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));

import { AWAITING_APPROVAL_STATUSES } from '@/lib/signals/statuses';
import {
  APPROVAL_COUNT_SQL, countApproval, countDetected, countWatch, DETECTED_COUNT_SQL, EARLIEST_EXPIRY_SQL, WATCH_COUNT_SQL,
} from '../signal-counts';
import { fakeReader, kst } from './fake-reader';

describe('승인 대기 SQL', () => {
  it("'pending'·'pending_approval'·'awaiting_approval' 포함, 'detected' 미포함", () => {
    for (const sql of [APPROVAL_COUNT_SQL, EARLIEST_EXPIRY_SQL]) {
      for (const st of AWAITING_APPROVAL_STATUSES) expect(sql).toContain(`'${st}'`);
      expect(sql).toContain("'pending'");
      expect(sql).not.toContain("'detected'");
    }
  });
  it('만료 절·시장별 GROUP BY', () => {
    expect(APPROVAL_COUNT_SQL).toMatch(/\(expires_at IS NULL OR expires_at >= \?\)/);
    expect(APPROVAL_COUNT_SQL).toMatch(/GROUP BY market/);
  });
  it('detected 는 따로 센다(만료 절 포함)', () => {
    expect(DETECTED_COUNT_SQL).toMatch(/status = 'detected'/);
    expect(DETECTED_COUNT_SQL).toMatch(/expires_at IS NULL OR expires_at >= \?/);
  });
  it('진입 감시 — executing 은 만료와 무관하게 센다', () => {
    expect(WATCH_COUNT_SQL).toMatch(/s\.status = 'executing' OR s\.expires_at IS NULL OR s\.expires_at >= \?/);
  });
});

describe('countApproval — 시장별 숫자·가장 빨리 만료', () => {
  const now = kst('2026-10-30 20:00');
  it('요청 기준 시각(KST 벽시계)을 바인딩하고 시장별로 합친다', async () => {
    const r = fakeReader(now, [
      ['GROUP BY market', [{ market: 'domestic', n: '2' }, { market: 'overseas', n: 1 }]],
      ['ORDER BY expires_at', [{ symbol: '005930', expires_at: new Date(kst('2026-10-31 09:30')) }]],
    ]);
    const c = await countApproval(r);
    expect(c.approval).toEqual({ domestic: 2, overseas: 1 });
    expect(c.earliestExpiry).toEqual({ symbol: '005930', at: '2026-10-31T09:30:00+09:00' });
    expect(r.calls[0].params).toEqual(['2026-10-30 20:00:00']);
  });
  it('행이 없으면 확인된 0(조회 성공)', async () => {
    const r = fakeReader(now, []);
    await expect(countApproval(r)).resolves.toEqual({ approval: { domestic: 0, overseas: 0 }, earliestExpiry: null });
  });
  it('조회 실패는 던진다(0 으로 바꾸지 않는다)', async () => {
    const r = fakeReader(now, [['FROM signals', new Error('down')]]);
    await expect(countApproval(r)).rejects.toMatchObject({ code: 'db_error' });
  });
  it('countDetected·countWatch', async () => {
    const r = fakeReader(now, [
      ["status = 'detected'", [{ n: 3 }]],
      ['approved_pending_entry', [{ market: 'overseas', watching: '1', next_session: '2', executing: '1' }]],
    ]);
    await expect(countDetected(r)).resolves.toBe(3);
    await expect(countWatch(r)).resolves.toEqual({
      domestic: { watching: 0, nextSession: 0, executing: 0 }, overseas: { watching: 1, nextSession: 2, executing: 1 },
    });
  });
});
