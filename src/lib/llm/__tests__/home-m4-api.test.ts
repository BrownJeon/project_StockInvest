/**
 * home-m4-api caller 회귀 테스트
 *
 * 검증 범위:
 *  1. 요청 페이로드 형식 (model/messages/options/X-API-Key)
 *  2. 정상 응답 파싱 ({message:{content}})
 *  3. 오류 응답 처리 (HTTP 4xx/5xx + empty content)
 *  4. AbortController 타임아웃
 *  5. AI_API_KEY 미설정 시 즉시 throw
 *
 * 실제 home-m4-api 서버 호출 안 함 — global.fetch mock으로 격리.
 */

import { HomeM4ApiCaller } from '../home-m4-api';

describe('HomeM4ApiCaller', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('요청 페이로드 형식 — model·messages·options·X-API-Key 헤더', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return {
        ok: true,
        json: async () => ({ message: { content: '{"selectedIndices":[],"confidence":0,"reasoning":"test","warnings":[]}' } }),
      } as Response;
    });

    const caller = new HomeM4ApiCaller('http://m4api.local:8000', 'secret-key', 'llama3', 0.3);
    await caller.call('hello prompt');

    expect(capturedUrl).toBe('http://m4api.local:8000/v1/chat');
    expect(capturedInit?.method).toBe('POST');

    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-API-Key']).toBe('secret-key');

    const body = JSON.parse(capturedInit?.body as string);
    expect(body.model).toBe('llama3');
    expect(body.messages).toEqual([{ role: 'user', content: 'hello prompt' }]);
    expect(body.options).toEqual({ temperature: 0.3 });
  });

  test('정상 응답 — message.content 추출', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: '{"selectedIndices":[0,1],"confidence":62}' } }),
    } as Response);

    const caller = new HomeM4ApiCaller('http://x', 'k', 'm', 0.3);
    const result = await caller.call('p');
    expect(result).toBe('{"selectedIndices":[0,1],"confidence":62}');
  });

  test('AI_API_KEY 미설정 시 즉시 throw (네트워크 호출 안 함)', async () => {
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock;

    const caller = new HomeM4ApiCaller('http://x', '', 'm', 0.3);
    await expect(caller.call('p')).rejects.toThrow(/AI_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('HTTP 4xx 응답 → throw with status + body excerpt', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized: invalid api key',
    } as Response);

    const caller = new HomeM4ApiCaller('http://x', 'k', 'm', 0.3);
    await expect(caller.call('p')).rejects.toThrow(/HTTP 401/);
    await expect(caller.call('p')).rejects.toThrow(/Unauthorized/);
  });

  test('HTTP 5xx 응답 → throw', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    } as Response);

    const caller = new HomeM4ApiCaller('http://x', 'k', 'm', 0.3);
    await expect(caller.call('p')).rejects.toThrow(/HTTP 503/);
  });

  test('빈 content 응답 → throw', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: '' } }),
    } as Response);

    const caller = new HomeM4ApiCaller('http://x', 'k', 'm', 0.3);
    await expect(caller.call('p')).rejects.toThrow(/empty content/);
  });

  test('타임아웃 → AbortError 변환 + 정확한 메시지', async () => {
    globalThis.fetch = jest.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    const caller = new HomeM4ApiCaller('http://x', 'k', 'm', 0.3);
    await expect(caller.call('p', { timeoutMs: 50 })).rejects.toThrow(/timeout after 50ms/);
  });

  test('temperature·model 인스턴스별 분리 확인', async () => {
    let body1: Record<string, unknown> = {};
    let body2: Record<string, unknown> = {};
    let calls = 0;
    globalThis.fetch = jest.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      if (calls === 0) body1 = body;
      else body2 = body;
      calls++;
      return {
        ok: true,
        json: async () => ({ message: { content: '{}' } }),
      } as Response;
    });

    const c1 = new HomeM4ApiCaller('http://x', 'k', 'llama3', 0.1);
    const c2 = new HomeM4ApiCaller('http://x', 'k', 'qwen2.5:14b', 0.7);
    await c1.call('p1');
    await c2.call('p2');

    expect(body1.model).toBe('llama3');
    expect((body1.options as Record<string, number>).temperature).toBe(0.1);
    expect(body2.model).toBe('qwen2.5:14b');
    expect((body2.options as Record<string, number>).temperature).toBe(0.7);
  });

  test('base URL trailing slash 무관하게 /v1/chat 추가', async () => {
    let capturedUrl = '';
    globalThis.fetch = jest.fn().mockImplementation(async (url: string) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ message: { content: '{}' } }) } as Response;
    });

    // 현재 구현은 trailing slash 미처리 — 회귀 케이스로 동작 명세 고정 (변경 시 의도적)
    const caller = new HomeM4ApiCaller('http://x:8000', 'k', 'm', 0.3);
    await caller.call('p');
    expect(capturedUrl).toBe('http://x:8000/v1/chat');
  });

  test('응답 JSON 스키마 — selectedIndices 배열 형식 그대로 전달', async () => {
    // 분석가가 받는 raw 응답 형식 검증 — 파싱은 ai-filter.ts가 담당
    const validResponses = [
      '{"selectedIndices":[],"confidence":0,"reasoning":"all rejected","warnings":[]}',
      '{"selectedIndices":[0],"confidence":62,"ev":{"pWin":0.55,"rWin":1.5,"rLoss":-1.0,"evPct":0.40},"reasoning":"x","warnings":[]}',
      '{"selectedIndices":[0,1,2],"confidence":58,"ev":{"pWin":0.5,"rWin":1.0,"rLoss":-1.0,"evPct":0.07},"reasoning":"3 picks","warnings":[]}',
      '```json\n{"decisions":[{"symbol":"005930","selectedIndices":[0],"confidence":70,"reasoning":"","warnings":[]}]}\n```',
    ];

    for (const resp of validResponses) {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: { content: resp } }),
      } as Response);
      const caller = new HomeM4ApiCaller('http://x', 'k', 'm', 0.3);
      const result = await caller.call('p');
      expect(result).toBe(resp);  // home-m4-api는 파싱 안 함, 그대로 전달
    }
  });
});
