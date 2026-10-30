/**
 * T-108 A-5 — 세션일·휴장·DST (가이드 §4.0 「세션일」·§6 A-5).
 */
jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));

import {
  currentSessionDay, HolidaysUnknownError, isSessionOpenAt, kstIso, lastCompletedSession, lastDailySlotMs, loadClosedDays,
  loadClosedDaysStrict, nextDailySlotMs, nextSessionOpen, overseasOpenInfo, recentTradingDays, toMs,
} from '../sessions';
import { fakeReader, kst } from './fake-reader';

const NONE = new Set<string>();

describe('해외 세션일 — ET 날짜(KST 자정으로 자르지 않는다)', () => {
  it('2026-10-30 은 금요일, 10-31(토) 08:00 KST 의 마지막 완료 세션 = ET 10-30', () => {
    expect(new Date('2026-10-30T00:00:00Z').getUTCDay()).toBe(5);
    expect(lastCompletedSession('overseas', kst('2026-10-31 08:00'), NONE)).toBe('2026-10-30');
  });
  it('10-31 08:00 KST 의 「오늘」 해외 창 = ET 10-30 00:00~24:00 (EDT → KST 13:00~다음 날 13:00)', () => {
    const d = currentSessionDay('overseas', kst('2026-10-31 08:00'));
    expect(d.ref).toEqual({ market: 'overseas', sessionDate: '2026-10-30', tz: 'ET' });
    expect(kstIso(d.startMs)).toBe('2026-10-30T13:00:00+09:00');
    expect(kstIso(d.endMs)).toBe('2026-10-31T13:00:00+09:00');
  });
  it('DST 종료(11-01) 날의 ET 하루는 25시간', () => {
    const d = currentSessionDay('overseas', kst('2026-11-01 20:00'));
    expect(d.ref.sessionDate).toBe('2026-11-01');
    expect((d.endMs - d.startMs) / 3600_000).toBe(25);
  });
  it('DST 종료 뒤 11-02(월) 개장 = 23:30 KST, 그 전 금요일 개장 = 22:30 KST', () => {
    expect(nextSessionOpen('overseas', kst('2026-10-31 08:00'), NONE)).toEqual({ sessionDate: '2026-11-02', openMs: kst('2026-11-02 23:30') });
    const info = overseasOpenInfo(kst('2026-10-30 10:00'), NONE);
    expect(info.next).toEqual({ sessionDate: '2026-10-30', openMs: kst('2026-10-30 22:30') });
    expect(info.change).toEqual({ sessionDate: '2026-11-02', openKst: '2026-11-02T23:30:00+09:00' });
  });
  it('장중 판정 — 10-30 23:00 KST 열림, 10-31 05:30 KST 닫힘(EDT 마감 05:00)', () => {
    expect(isSessionOpenAt('overseas', kst('2026-10-30 23:00'), NONE)).toBe(true);
    expect(isSessionOpenAt('overseas', kst('2026-10-31 05:30'), NONE)).toBe(false);
  });
  it('휴장(반일장 포함)은 닫힘', () => {
    expect(isSessionOpenAt('overseas', kst('2026-10-30 23:00'), new Set(['2026-10-30']))).toBe(false);
    expect(lastCompletedSession('overseas', kst('2026-10-31 08:00'), new Set(['2026-10-30']))).toBe('2026-10-29');
  });
});

describe('국내 세션일 — KST 날짜', () => {
  it('KST 자정 경계', () => {
    expect(currentSessionDay('domestic', kst('2026-10-31 00:30')).ref.sessionDate).toBe('2026-10-31');
    expect(currentSessionDay('domestic', kst('2026-10-30 23:59')).ref.sessionDate).toBe('2026-10-30');
  });
  it('장중 09:00~15:30 · 주말 닫힘 · 휴장 닫힘', () => {
    expect(isSessionOpenAt('domestic', kst('2026-10-30 09:00'), NONE)).toBe(true);
    expect(isSessionOpenAt('domestic', kst('2026-10-30 15:30'), NONE)).toBe(false);
    expect(isSessionOpenAt('domestic', kst('2026-10-31 10:00'), NONE)).toBe(false);
    expect(isSessionOpenAt('domestic', kst('2026-10-30 10:00'), new Set(['2026-10-30']))).toBe(false);
  });
  it('최근 거래일 20개는 주말·휴장을 건너뛴다', () => {
    const days = recentTradingDays('domestic', '2026-10-30', 20, new Set(['2026-10-09']));
    expect(days).toHaveLength(20);
    expect(days[0]).toBe('2026-10-30');
    expect(days).not.toContain('2026-10-09');
    expect(days).not.toContain('2026-10-25');
  });
});

describe('휴장표 엄격 로더 — 모르면 holidays_unknown', () => {
  it('요청 연도 중 0행인 연도가 있으면 던진다', async () => {
    const r = fakeReader(kst('2026-10-30 10:00'), [['market_holidays', [{ d: '2026-11-26' }]]]);
    await expect(loadClosedDaysStrict(r, 'overseas', [2026, 2027])).rejects.toBeInstanceOf(HolidaysUnknownError);
    await expect(loadClosedDaysStrict(r, 'overseas', [2026, 2027])).rejects.toMatchObject({ code: 'holidays_unknown' });
  });
  it('형식 이상 행도 모름', async () => {
    const r = fakeReader(0, [['market_holidays', [{ d: '11/26' }]]]);
    await expect(loadClosedDaysStrict(r, 'overseas', [2026])).rejects.toBeInstanceOf(HolidaysUnknownError);
  });
  it('loadClosedDays — 실패한 시장만 null', async () => {
    const r = fakeReader(kst('2026-10-30 10:00'), [
      ['market_holidays', (p: unknown[]) => (p[0] === 'domestic' ? [{ d: '2026-10-09' }] : new Error('db down'))],
    ]);
    const c = await loadClosedDays(r);
    expect(c.domestic).toEqual(new Set(['2026-10-09']));
    expect(c.overseas).toBeNull();
  });
});

describe('일 1회 슬롯', () => {
  it('lastDailySlotMs — 유예가 지난 가장 최근 슬롯', () => {
    expect(lastDailySlotMs('16:00', kst('2026-10-30 17:00'), 95)).toBe(kst('2026-10-29 16:00'));
    expect(lastDailySlotMs('16:00', kst('2026-10-30 17:40'), 95)).toBe(kst('2026-10-30 16:00'));
  });
  it('nextDailySlotMs — 조건을 만족하는 다음 슬롯', () => {
    const weekday = (s: number) => { const d = new Date(s + 9 * 3600_000).getUTCDay(); return d >= 1 && d <= 5; };
    expect(nextDailySlotMs('16:00', kst('2026-10-30 17:00'), weekday)).toBe(kst('2026-11-02 16:00'));
  });
  it('toMs — 문자열은 KST 벽시계', () => {
    expect(toMs('2026-10-30 16:00:00')).toBe(kst('2026-10-30 16:00'));
    expect(toMs(null)).toBeNull();
  });
});
