/**
 * requestJson — 클라이언트 fetch 실패 판정 (2026-08-06, T-007).
 *
 * 여러 변경 핸들러가 네트워크 예외만 잡고 HTTP 4xx/5xx 를 성공으로 취급해
 * 실패한 동작을 성공으로 표시했다. 판정을 이 한 곳으로 모으고 여기서 전수 검증한다.
 */
import { requestJson } from '@/lib/http';

function mockFetch(impl: jest.Mock): void {
  (global as unknown as { fetch: unknown }).fetch = impl;
}
const jsonRes = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

afterEach(() => jest.clearAllMocks());

describe('성공', () => {
  test('2xx + ok:true 면 data 를 돌려준다', async () => {
    mockFetch(jest.fn().mockResolvedValue(jsonRes(200, { ok: true, cancelled: 3, failed: 0 })));
    const r = await requestJson<{ cancelled: number }>('/x', { method: 'POST' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.cancelled).toBe(3);
  });

  test('본문에 ok 필드가 없어도 2xx 면 성공', async () => {
    mockFetch(jest.fn().mockResolvedValue(jsonRes(200, { cancelled: 1 })));
    await expect(requestJson('/x')).resolves.toMatchObject({ ok: true });
  });

  test('비JSON 본문이어도 2xx 면 성공 (data 는 빈 객체)', async () => {
    mockFetch(jest.fn().mockResolvedValue({
      ok: true, status: 204, json: async () => { throw new Error('no body'); },
    }));
    const r = await requestJson('/x');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({});
  });

  test('init 을 fetch 에 그대로 전달한다', async () => {
    const f = jest.fn().mockResolvedValue(jsonRes(200, { ok: true }));
    mockFetch(f);
    await requestJson('/x', { method: 'POST', cache: 'no-store' });
    expect(f).toHaveBeenCalledWith('/x', { method: 'POST', cache: 'no-store' });
  });
});

describe('거부(rejected) — 서버에 닿았고 거절당함', () => {
  test('4xx + error 사유를 그대로 싣는다', async () => {
    mockFetch(jest.fn().mockResolvedValue(jsonRes(400, { ok: false, error: 'backtestIntervalM must be 1–10080' })));
    const r = await requestJson('/x');
    expect(r).toEqual({ ok: false, failure: { kind: 'rejected', message: 'backtestIntervalM must be 1–10080' } });
  });

  test('5xx + 사유 없음 → 상태코드로 대체', async () => {
    mockFetch(jest.fn().mockResolvedValue(jsonRes(500, {})));
    const r = await requestJson('/x');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.kind).toBe('rejected');
      expect(r.failure.message).toContain('HTTP 500');
    }
  });

  test('500 + 비JSON(에러 페이지 HTML)도 거부로 잡는다 — 성공으로 새지 않는다', async () => {
    mockFetch(jest.fn().mockResolvedValue({
      ok: false, status: 500, json: async () => { throw new Error('unexpected token <'); },
    }));
    const r = await requestJson('/x');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.kind).toBe('rejected');
  });

  test('200 인데 본문이 ok:false 인 경우도 거부 (코드베이스 관례)', async () => {
    mockFetch(jest.fn().mockResolvedValue(jsonRes(200, { ok: false, error: 'id required' })));
    const r = await requestJson('/x');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.message).toBe('id required');
  });

  test('2xx + ok:false + error 없음 도 거부 — error 유무로 판정하지 않는다', async () => {
    // 이미 존재하는 형태: /api/cron/trade-report 는 200 + {ok:false, skipped:'channel_invalid'}
    mockFetch(jest.fn().mockResolvedValue(
      jsonRes(200, { ok: false, skipped: 'channel_invalid', channel: 'sms' }),
    ));
    const r = await requestJson('/api/cron/trade-report');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.kind).toBe('rejected');
      expect(r.failure.message).toContain('ok:false');
    }
  });

  test('4xx + ok:false + error 없음도 거부 (상태코드 안내)', async () => {
    mockFetch(jest.fn().mockResolvedValue(jsonRes(400, { ok: false })));
    const r = await requestJson('/x');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.message).toContain('HTTP 400');
  });

  test('ok:true 면 error 키가 있어도 성공 — 판정 기준은 ok 다', async () => {
    mockFetch(jest.fn().mockResolvedValue(jsonRes(200, { ok: true, error: null })));
    await expect(requestJson('/x')).resolves.toMatchObject({ ok: true });
  });
});

describe('네트워크 — 서버에 닿지 못함', () => {
  test('fetch 예외는 kind=network 로 구분된다', async () => {
    mockFetch(jest.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const r = await requestJson('/x');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.kind).toBe('network');
      expect(r.failure.message).toContain('네트워크');
    }
  });

  test('어떤 경우에도 던지지 않는다 — Promise.all 이 끊기면 안 된다', async () => {
    mockFetch(jest.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(Promise.all([requestJson('/a'), requestJson('/b')])).resolves.toHaveLength(2);
  });
});
