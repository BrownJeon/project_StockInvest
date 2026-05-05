/**
 * M4KbClient 단위 테스트 (Phase AB).
 *
 * fetch mock으로 격리. 실제 home-m4-api 호출 안 함.
 */
import { M4KbClient } from '../m4-kb';

describe('M4KbClient', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; jest.restoreAllMocks(); });

  test('upsert — POST body·X-API-Key·1회 max 200', async () => {
    let url = ''; let init: RequestInit | undefined;
    globalThis.fetch = jest.fn().mockImplementation(async (u: string, i?: RequestInit) => {
      url = u; init = i;
      return { ok: true, json: async () => ({ upserted: 1, ids: ['abc'] }) } as Response;
    });

    const client = new M4KbClient('http://m4api.local:8000', 'secret-key');
    const res = await client.upsert('signals.test', [{ text: 'hello', metadata: { symbol: 'A' } }]);

    expect(url).toBe('http://m4api.local:8000/v1/kb/signals.test/upsert');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['X-API-Key']).toBe('secret-key');
    const body = JSON.parse(String(init?.body));
    expect(body.items).toEqual([{ text: 'hello', metadata: { symbol: 'A' } }]);
    expect(res).toEqual({ upserted: 1, ids: ['abc'] });
  });

  test('upsert — items > 200 → throw', async () => {
    const client = new M4KbClient('http://m4api.local', 'k');
    const items = Array.from({ length: 201 }, (_, i) => ({ text: `t${i}` }));
    await expect(client.upsert('c', items)).rejects.toThrow(/exceeds/);
  });

  test('upsert — 빈 array는 즉시 반환', async () => {
    globalThis.fetch = jest.fn();
    const client = new M4KbClient('http://m4api.local', 'k');
    const res = await client.upsert('c', []);
    expect(res).toEqual({ upserted: 0, ids: [] });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('search — query body·hits 응답 파싱', async () => {
    let captured: Record<string, unknown> = {};
    globalThis.fetch = jest.fn().mockImplementation(async (_: string, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      return { ok: true, json: async () => ({ hits: [
        { id: '1', score: 0.9, text: 'past sig', metadata: { symbol: 'A' } },
      ] }) } as Response;
    });

    const client = new M4KbClient('http://m4api.local', 'k');
    const hits = await client.search('signals.test', 'rsi 매수', { topK: 3, filter: { symbol: 'A' } });
    expect(captured.query).toBe('rsi 매수');
    expect(captured.top_k).toBe(3);
    expect(captured.filter).toEqual({ symbol: 'A' });
    expect(hits).toHaveLength(1);
    expect(hits[0].score).toBe(0.9);
  });

  test('search — 빈 query 즉시 빈 배열', async () => {
    globalThis.fetch = jest.fn();
    const client = new M4KbClient('http://m4api.local', 'k');
    const r = await client.search('c', '   ');
    expect(r).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('search — HTTP 4xx → throw', async () => {
    globalThis.fetch = jest.fn().mockImplementation(async () =>
      ({ ok: false, status: 404, text: async () => 'not found' } as Response));
    const client = new M4KbClient('http://m4api.local', 'k');
    await expect(client.search('c', 'q')).rejects.toThrow(/HTTP 404/);
  });

  test('ensureCollection — 200 OK', async () => {
    let url = ''; let init: RequestInit | undefined;
    globalThis.fetch = jest.fn().mockImplementation(async (u: string, i?: RequestInit) => {
      url = u; init = i;
      return { ok: true, json: async () => ({ name: 'c', model: 'bge-m3', dim: 1024 }) } as Response;
    });
    const client = new M4KbClient('http://m4api.local', 'k', 'admin-tok');
    await client.ensureCollection('signals.test', 'bge-m3');
    expect(url).toContain('/v1/kb/collections');
    expect((init?.headers as Record<string, string>)['X-Admin-Token']).toBe('admin-tok');
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({ name: 'signals.test', model: 'bge-m3' });
  });

  test('ensureCollection — 409 conflict 멱등 처리', async () => {
    globalThis.fetch = jest.fn().mockImplementation(async () =>
      ({ ok: false, status: 409, text: async () => 'already exists' } as Response));
    const client = new M4KbClient('http://m4api.local', 'k', 'admin-tok');
    await expect(client.ensureCollection('signals.test')).resolves.toBeUndefined();
  });

  test('apiKey 미설정 → throw', async () => {
    const client = new M4KbClient('http://m4api.local', '');
    await expect(client.upsert('c', [{ text: 't' }])).rejects.toThrow(/AI_API_KEY/);
    await expect(client.search('c', 'q')).rejects.toThrow(/AI_API_KEY/);
  });
});
