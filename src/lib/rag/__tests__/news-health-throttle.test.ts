/**
 * T-106 — 실제 `sendAlertThrottled`(프로세스 메모리 창)와 함께: 임계 이후 "하루 1회" 계속 울리고 같은 날 재실행은 막힌다.
 * 실제 발송 함수(`@/lib/notify` 의 sendAlert)만 목으로 막는다. DB 는 메모리 목.
 */
import { getPool } from '@/lib/db';
import { sendAlert } from '@/lib/notify';
import { resetAlertThrottle } from '@/lib/notify/throttle';
import { recordNewsOutcome } from '../news-health';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/notify', () => ({ sendAlert: jest.fn() }));

const mSend = sendAlert as jest.Mock;
let store: Map<string, unknown>;

beforeEach(() => {
  jest.clearAllMocks();
  resetAlertThrottle();
  store = new Map();
  (getPool as jest.Mock).mockReturnValue({
    query: jest.fn(async (sql: string, params: unknown[]) => {
      if (sql.startsWith('SELECT')) {
        const v = store.get(String(params[0]));
        return [v === undefined ? [] : [{ value: v }], undefined];
      }
      store.set(String(params[0]), params[1]);
      return [{ affectedRows: 1 }, undefined];
    }),
  });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'clearImmediate', 'queueMicrotask'] });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function at(iso: string, count = 0, market: 'domestic' | 'overseas' = 'domestic') {
  const now = new Date(iso);
  jest.setSystemTime(now);
  return recordNewsOutcome({ channel: 'fetch', market, count, now });
}

test('🔴 임계 3일째 1회 발송 → 같은 날 재실행 막힘 → 다음 날(약간 이른 시각) 다시 발송 → 정상화 후 0 이 다시 3일 이어질 때까지 조용', async () => {
  await at('2026-10-26T06:00:00+09:00');
  await at('2026-10-27T06:00:00+09:00');
  expect(mSend).not.toHaveBeenCalled();

  expect(await at('2026-10-28T06:10:00+09:00')).toEqual({ streak: 3, alerted: true });
  expect(mSend).toHaveBeenCalledTimes(1);
  expect(mSend.mock.calls[0][0]).toBe('warning');

  expect(await at('2026-10-28T09:00:00+09:00')).toEqual({ streak: 3, alerted: false });   // 같은 날 재실행
  expect(mSend).toHaveBeenCalledTimes(1);

  expect(await at('2026-10-29T05:55:00+09:00')).toEqual({ streak: 4, alerted: true });    // 23시간 45분 뒤
  expect(mSend).toHaveBeenCalledTimes(2);

  expect(await at('2026-10-30T06:00:00+09:00', 8)).toEqual({ streak: 0, alerted: false }); // 정상화
  await at('2026-10-31T06:00:00+09:00');
  await at('2026-11-01T06:00:00+09:00');
  expect(mSend).toHaveBeenCalledTimes(2);
});

test('시장별 스로틀 키가 달라 같은 시각 두 시장 모두 발송', async () => {
  for (const d of ['2026-10-26', '2026-10-27', '2026-10-28']) {
    await at(`${d}T06:00:00+09:00`, 0, 'domestic');
    await at(`${d}T06:00:30+09:00`, 0, 'overseas');
  }
  expect(mSend).toHaveBeenCalledTimes(2);
  expect(String(mSend.mock.calls[0][1])).toContain('국내');
  expect(String(mSend.mock.calls[1][1])).toContain('해외');
});
