/**
 * T-056 (Codex C1-4) — 전달이 **확인된 뒤에만** 억제하는 경보.
 * 공용 `sendAlertThrottled` 는 전송 결과와 무관하게 창을 먼저 닫아, 모든 채널이 실패한 첫 critical 을 2시간 삼켰다.
 */
import {
  sendAlertUntilDelivered, resetConfirmedAlerts, __setConfirmedAlertDispatchForTest, IN_FLIGHT_STALE_MS,
} from '@/lib/safety/confirmed-alert';

const H2 = 2 * 60 * 60 * 1000;
const flush = () => new Promise<void>(r => setImmediate(r));
const delivered = { delivered: ['telegram'] };
const undelivered = { delivered: [] };

let dispatch: jest.Mock;
beforeEach(() => {
  resetConfirmedAlerts();
  dispatch = jest.fn();
  __setConfirmedAlertDispatchForTest(dispatch);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { __setConfirmedAlertDispatchForTest(); jest.restoreAllMocks(); });

test('전달 성공 → 2시간 억제', async () => {
  dispatch.mockResolvedValue(delivered);
  const t0 = Date.now();
  expect(sendAlertUntilDelivered('k', 'critical', 't', 'b', H2, t0)).toBe('sent');
  await flush();
  expect(sendAlertUntilDelivered('k', 'critical', 't', 'b', H2, t0 + 60 * 60_000)).toBe('suppressed');
  expect(dispatch).toHaveBeenCalledTimes(1);
});

test('🔴 첫 전달이 모든 채널에서 실패 → 억제하지 않고 다음 틱에 다시 보낸다', async () => {
  dispatch.mockResolvedValueOnce(undelivered).mockResolvedValueOnce(delivered);
  const t0 = Date.now();
  sendAlertUntilDelivered('k', 'critical', 't', 'b', H2, t0);
  await flush();
  expect(sendAlertUntilDelivered('k', 'critical', 't', 'b', H2, t0 + 60 * 60_000)).toBe('sent');
  expect(dispatch).toHaveBeenCalledTimes(2);
});

test('전송 함수가 거부(예외)해도 억제하지 않는다', async () => {
  dispatch.mockRejectedValueOnce(new Error('net')).mockResolvedValueOnce(delivered);
  sendAlertUntilDelivered('k', 'critical', 't', 'b', H2);
  await flush();
  expect(sendAlertUntilDelivered('k', 'critical', 't', 'b', H2)).toBe('sent');
});

test('전송 함수가 동기적으로 던져도 호출부로 새지 않는다', () => {
  dispatch.mockImplementation(() => { throw new Error('sync'); });
  expect(() => sendAlertUntilDelivered('k', 'critical', 't', 'b', H2)).not.toThrow();
});

test('같은 키의 전송이 진행 중이면 겹쳐 보내지 않는다 (같은 틱 중복 없음)', async () => {
  let resolve!: (v: unknown) => void;
  dispatch.mockReturnValue(new Promise(r => { resolve = r; }));
  expect(sendAlertUntilDelivered('k', 'critical', 't', 'b', H2)).toBe('sent');
  expect(sendAlertUntilDelivered('k', 'critical', 't', 'b', H2)).toBe('in_flight');
  resolve(delivered);
  await flush();
  expect(dispatch).toHaveBeenCalledTimes(1);
});

test('진행 중 표시가 오래되면(응답 없이 걸림) 다시 보낸다 — 걸린 전송 하나가 경보를 영구히 막지 않는다', () => {
  dispatch.mockReturnValue(new Promise(() => {}));
  const t0 = Date.now();
  sendAlertUntilDelivered('k', 'critical', 't', 'b', H2, t0);
  expect(sendAlertUntilDelivered('k', 'critical', 't', 'b', H2, t0 + IN_FLIGHT_STALE_MS + 1)).toBe('sent');
  expect(dispatch).toHaveBeenCalledTimes(2);
});

test('호출부는 전송을 기다리지 않는다 (동기 반환)', () => {
  dispatch.mockReturnValue(new Promise(() => {}));
  const r = sendAlertUntilDelivered('k', 'critical', 't', 'b', H2);
  expect(typeof r).toBe('string');
});

test('키가 다르면 서로 억제하지 않는다 (USD·KRW 보류 경보 분리)', async () => {
  dispatch.mockResolvedValue(delivered);
  sendAlertUntilDelivered('snapshot:usd_cash_unavailable', 'critical', 't', 'b', H2);
  await flush();
  expect(sendAlertUntilDelivered('snapshot:krw_cash_unavailable', 'critical', 't', 'b', H2)).toBe('sent');
});
