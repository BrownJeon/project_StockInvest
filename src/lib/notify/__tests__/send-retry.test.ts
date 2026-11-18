/**
 * T-175 WP-2 — `sendWithRetry` 단위 시험(결과가 필요한 알림 1건의 같은 실행 안 재시도).
 *
 * sleep 은 기록만 하는 가짜, 대기 상한(timeoutMs)·미확정 대기는 실제 타이머를 짧게(수십 ms) 쓴다.
 *  - 첫 시도 성공 → 1회(중복 없음) · 일부 채널만 전달돼도 성공(재시도 없음)
 *  - 실패 → 간격 뒤 재시도 성공 · 전부 실패(3회) · 던짐도 재시도 · 채널 없음/미설정은 재시도 없음
 *  - 🔴 대기 상한에 걸린 시도는 겹쳐 보내지 않는다: 늦게 전달되면 성공(1회), 늦게 실패하면 그때 재시도, 끝내 미확정이면 unresolved
 *  - 시간 예산(canStart) — 첫 시도 전·재시도 전 판단, 넘기는 간격 값
 */
import type { AlertDispatch } from '@/lib/notify';
import { sendWithRetry, type SendRetryOptions } from '../send-retry';

const OK: AlertDispatch = { channel: 'telegram', delivered: ['telegram'], failed: [], unconfigured: [] };
const FAIL: AlertDispatch = { channel: 'telegram', delivered: [], failed: [{ channel: 'telegram', error: 'fetch failed (ETIMEDOUT)' }], unconfigured: [] };
const NONE: AlertDispatch = { channel: 'none', delivered: [], failed: [], unconfigured: [] };
const UNCONF: AlertDispatch = { channel: 'telegram', delivered: [], failed: [], unconfigured: ['telegram'] };
const PARTIAL: AlertDispatch = { channel: 'both', delivered: ['slack'], failed: [{ channel: 'telegram', error: 'x' }], unconfigured: [] };

const later = <T>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));

function opts(over: Partial<SendRetryOptions> = {}) {
  const sleeps: number[] = [];
  const asked: number[] = [];
  const o: SendRetryOptions = {
    timeoutMs: 1_000,
    gapsMs: [2_000, 5_000],
    canStart: (g) => { asked.push(g); return true; },
    sleep: async (ms) => { sleeps.push(ms); },
    ...over,
  };
  return { o, sleeps, asked };
}

describe('sendWithRetry — 성공·실패·재시도', () => {
  test('🔴 첫 시도 성공 → 1회만 보낸다(중복 없음), 기다리지 않는다', async () => {
    const send = jest.fn(async () => OK);
    const { o, sleeps } = opts();
    await expect(sendWithRetry(send, o)).resolves.toEqual({ delivered: true, attempts: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  test('🔴 한 채널이라도 전달되면 성공 — 이미 전달된 채널에 다시 보내지 않는다', async () => {
    const send = jest.fn(async () => PARTIAL);
    await expect(sendWithRetry(send, opts().o)).resolves.toEqual({ delivered: true, attempts: 1 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('첫 시도 실패 → 2초 뒤 재시도 성공', async () => {
    const send = jest.fn().mockResolvedValueOnce(FAIL).mockResolvedValueOnce(OK);
    const { o, sleeps } = opts();
    await expect(sendWithRetry(send, o)).resolves.toEqual({ delivered: true, attempts: 2 });
    expect(sleeps).toEqual([2_000]);
  });

  test('🔴 전부 실패 → 3회(간격 2·5초) 후 failed, 마지막 오류를 돌려준다', async () => {
    const send = jest.fn(async () => FAIL);
    const { o, sleeps } = opts();
    await expect(sendWithRetry(send, o)).resolves.toEqual({
      delivered: false, attempts: 3, reason: 'failed', lastError: 'telegram:fetch failed (ETIMEDOUT)',
    });
    expect(send).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([2_000, 5_000]);
  });

  test('발송 함수가 던지면(비동기·동기 모두) 실패로 보고 재시도한다', async () => {
    const asyncThrow = jest.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce(OK);
    await expect(sendWithRetry(asyncThrow, opts().o)).resolves.toEqual({ delivered: true, attempts: 2 });

    const syncThrow = jest.fn((): Promise<AlertDispatch> => { throw new Error('sync boom'); });
    const r = await sendWithRetry(syncThrow, opts().o);
    expect(r).toEqual({ delivered: false, attempts: 3, reason: 'failed', lastError: 'sync boom' });
  });

  test.each([['channel=none', NONE], ['자격증명 미설정', UNCONF]])('%s → 재시도하지 않는다(unconfigured)', async (_n, d) => {
    const send = jest.fn(async () => d);
    const { o, sleeps } = opts();
    await expect(sendWithRetry(send, o)).resolves.toEqual({ delivered: false, attempts: 1, reason: 'unconfigured' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });
});

describe('🔴 sendWithRetry — 대기 상한에 걸린 시도는 겹쳐 보내지 않는다', () => {
  test('상한 뒤 늦게 전달 → 성공, 다시 보내지 않는다', async () => {
    const send = jest.fn(() => later(40, OK));
    const { o, sleeps } = opts({ timeoutMs: 10, gapsMs: [500, 500] });
    await expect(sendWithRetry(send, o)).resolves.toEqual({ delivered: true, attempts: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  test('상한 뒤 늦게 실패 → 그때 바로 재시도(간격은 이미 기다렸다)', async () => {
    const send = jest.fn().mockImplementationOnce(() => later(30, FAIL)).mockResolvedValueOnce(OK);
    const { o, sleeps, asked } = opts({ timeoutMs: 10, gapsMs: [500, 500] });
    await expect(sendWithRetry(send, o)).resolves.toEqual({ delivered: true, attempts: 2 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([]);
    expect(asked).toEqual([0, 500, 0]);   // 첫 시도 · 미확정 결과를 기다려도 되는가 · 바로 재시도
  });

  test('다음 간격 동안에도 결과가 없으면 unresolved — 1회만 보냈다', async () => {
    const send = jest.fn(() => new Promise<AlertDispatch>(() => { /* 끝나지 않음 */ }));
    const { o } = opts({ timeoutMs: 10, gapsMs: [30, 30] });
    await expect(sendWithRetry(send, o)).resolves.toEqual({ delivered: false, attempts: 1, reason: 'unresolved' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('남은 간격이 없거나 예산이 없으면 기다리지 않고 unresolved', async () => {
    const hang = () => new Promise<AlertDispatch>(() => { /* 끝나지 않음 */ });
    const a = jest.fn(hang);
    await expect(sendWithRetry(a, opts({ timeoutMs: 10, gapsMs: [] }).o)).resolves.toMatchObject({ reason: 'unresolved', attempts: 1 });
    const b = jest.fn(hang);
    await expect(sendWithRetry(b, opts({ timeoutMs: 10, canStart: (g) => g === 0 }).o)).resolves.toMatchObject({ reason: 'unresolved', attempts: 1 });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe('sendWithRetry — 시간 예산', () => {
  test('🔴 첫 시도 전에 예산이 없으면 보내지 않는다(budget, 0회)', async () => {
    const send = jest.fn(async () => OK);
    const { o, asked } = opts({ canStart: (g) => { asked.push(g); return false; } });
    await expect(sendWithRetry(send, o)).resolves.toEqual({ delivered: false, attempts: 0, reason: 'budget' });
    expect(send).not.toHaveBeenCalled();
    expect(asked).toEqual([0]);
  });

  test('재시도 간격을 넣으면 예산을 넘는 경우 — 더 보내지 않고 budget + 마지막 오류', async () => {
    const send = jest.fn(async () => FAIL);
    const asked: number[] = [];
    const { o, sleeps } = opts({ canStart: (g) => { asked.push(g); return g < 5_000; } });
    await expect(sendWithRetry(send, o)).resolves.toEqual({
      delivered: false, attempts: 2, reason: 'budget', lastError: 'telegram:fetch failed (ETIMEDOUT)',
    });
    expect(asked).toEqual([0, 2_000, 5_000]);
    expect(sleeps).toEqual([2_000]);
  });
});
