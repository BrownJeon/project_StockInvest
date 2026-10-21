/**
 * T-059 Part A — SEC 클라이언트: UA 필수·직렬·간격(≤4 req/s)·429/403 즉시 중단+전역 쿨다운·5xx 1회 재시도·404·호스트 제한.
 * 네트워크는 부르지 않는다 — fetchImpl·sleep·now 를 대역으로 넣는다.
 */
import {
  SecClient, SecBlockedError, SecHttpError, readSecUserAgent, __resetSecBlockStateForTest, secCooldownRemainingMs,
  SEC_MIN_INTERVAL_MS, SEC_BLOCK_COOLDOWN_BASE_MS, SEC_BLOCK_COOLDOWN_MAX_MS, cikPadded,
} from '../sec-client';

const UA = 'TestCo test@example.invalid';

function resp(status: number, body = '{"ok":1}', headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : body, { status, headers });
}

function harness(plan: Array<number | Error | [number, string, Record<string, string>?]>) {
  let t = 1_000_000;
  const calls: Array<{ url: string; at: number; ua: string | null }> = [];
  const sleeps: number[] = [];
  const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
    const ua = (init?.headers as Record<string, string> | undefined)?.['User-Agent'] ?? null;
    calls.push({ url, at: t, ua });
    const step = plan.shift();
    if (step instanceof Error) throw step;
    if (Array.isArray(step)) return resp(step[0], step[1], step[2]);
    return resp(step ?? 200);
  });
  const client = new SecClient({
    userAgent: UA,
    fetchImpl,
    sleep: async (ms) => { sleeps.push(ms); t += ms; },
    now: () => t,
  });
  return { client, fetchImpl, calls, sleeps, advance: (ms: number) => { t += ms; } };
}

beforeEach(() => __resetSecBlockStateForTest());

describe('🔴 User-Agent', () => {
  test('비었거나 공백·이메일 없음이면 null — 호출부는 SEC 를 부르지 않는다', () => {
    expect(readSecUserAgent({})).toBeNull();
    expect(readSecUserAgent({ SEC_USER_AGENT: '' })).toBeNull();
    expect(readSecUserAgent({ SEC_USER_AGENT: '   ' })).toBeNull();
    expect(readSecUserAgent({ SEC_USER_AGENT: 'StockInvest-Research' })).toBeNull();
    expect(readSecUserAgent({ SEC_USER_AGENT: `"${UA}"` })).toBe(UA);
  });
  test('UA 없이 클라이언트를 만들 수 없다', () => {
    expect(() => new SecClient({ userAgent: '' })).toThrow();
    expect(() => new SecClient({ userAgent: 'no-email' })).toThrow();
  });
  test('모든 요청에 UA 헤더가 실린다', async () => {
    const h = harness([200, 200]);
    await h.client.getJson('https://data.sec.gov/submissions/CIK0000050863.json');
    await h.client.getJson('https://www.sec.gov/files/company_tickers.json');
    expect(h.calls.map((c) => c.ua)).toEqual([UA, UA]);
  });
});

describe('직렬·속도 제한', () => {
  test('동시에 불러도 한 줄로 서고, 요청 시작 간격은 250ms 이상(≤4 req/s)', async () => {
    const h = harness([200, 200, 200, 200, 200]);
    await Promise.all([1, 2, 3, 4, 5].map((i) => h.client.getJson(`https://data.sec.gov/x${i}.json`)));
    expect(h.calls).toHaveLength(5);
    for (let i = 1; i < h.calls.length; i++) {
      expect(h.calls[i].at - h.calls[i - 1].at).toBeGreaterThanOrEqual(SEC_MIN_INTERVAL_MS);
    }
    expect(h.calls.map((c) => c.url)).toEqual([1, 2, 3, 4, 5].map((i) => `https://data.sec.gov/x${i}.json`));
  });
  test('minIntervalMs 를 더 짧게 줘도 250ms 아래로 내려가지 않는다', async () => {
    let t = 0;
    const at: number[] = [];
    const c = new SecClient({
      userAgent: UA, minIntervalMs: 10,
      fetchImpl: async () => { at.push(t); return resp(200); },
      sleep: async (ms) => { t += ms; }, now: () => t,
    });
    await c.getJson('https://data.sec.gov/a.json');
    await c.getJson('https://data.sec.gov/b.json');
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(250);
  });
  test('허용 호스트 밖 URL 은 요청하지 않는다', async () => {
    const h = harness([200]);
    await expect(h.client.getJson('https://evil.example/x.json')).rejects.toThrow(/허용되지 않은 URL/);
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });
});

describe('🔴 429/403 — 재시도 없이 중단, 전역 쿨다운(지수 증가)', () => {
  test.each([429, 403])('%i: 1회 호출 후 SecBlockedError, 재시도 0', async (code) => {
    const h = harness([code, 200]);
    await expect(h.client.getJson('https://data.sec.gov/a.json')).rejects.toBeInstanceOf(SecBlockedError);
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('쿨다운 중에는 다른 인스턴스도 네트워크에 나가지 않는다', async () => {
    const h = harness([429]);
    await expect(h.client.getJson('https://data.sec.gov/a.json')).rejects.toBeInstanceOf(SecBlockedError);
    const h2 = harness([200]);
    // h2 의 now 는 h 와 같은 시작값(1_000_000)이라 쿨다운 안이다
    await expect(h2.client.getJson('https://data.sec.gov/b.json')).rejects.toMatchObject({ status: 'cooldown' });
    expect(h2.fetchImpl).not.toHaveBeenCalled();
  });

  test('연속 차단이면 쿨다운이 2배씩(상한 60분), 성공하면 초기화', async () => {
    const h = harness([429, 429, 429, 429, 429, 200, 429]);
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      const e = await h.client.getJson('https://data.sec.gov/a.json').catch((x) => x as SecBlockedError);
      seen.push((e as SecBlockedError).cooldownMs);
      h.advance(SEC_BLOCK_COOLDOWN_MAX_MS + 1);
    }
    expect(seen).toEqual([
      SEC_BLOCK_COOLDOWN_BASE_MS, SEC_BLOCK_COOLDOWN_BASE_MS * 2, SEC_BLOCK_COOLDOWN_BASE_MS * 4,
      SEC_BLOCK_COOLDOWN_MAX_MS, SEC_BLOCK_COOLDOWN_MAX_MS,
    ]);
    await h.client.getJson('https://data.sec.gov/a.json');
    const e = await h.client.getJson('https://data.sec.gov/a.json').catch((x) => x as SecBlockedError);
    expect((e as SecBlockedError).cooldownMs).toBe(SEC_BLOCK_COOLDOWN_BASE_MS);
  });

  test('Retry-After 가 더 길면 그것을 따른다(상한 60분)', async () => {
    const h = harness([[429, '', { 'retry-after': '1800' }]]);
    const e = await h.client.getJson('https://data.sec.gov/a.json').catch((x) => x as SecBlockedError);
    expect((e as SecBlockedError).cooldownMs).toBe(1_800_000);
    expect(secCooldownRemainingMs(1_000_000 + SEC_MIN_INTERVAL_MS)).toBeGreaterThan(0);
  });
});

describe('5xx·네트워크·404·본문', () => {
  test('5xx 는 1회만 재시도', async () => {
    const h = harness([503, 200]);
    await expect(h.client.getJson('https://data.sec.gov/a.json')).resolves.toMatchObject({ status: 200 });
    expect(h.fetchImpl).toHaveBeenCalledTimes(2);
    const h2 = harness([503, 502]);
    await expect(h2.client.getJson('https://data.sec.gov/a.json')).rejects.toMatchObject({ name: 'SecHttpError', status: 502 });
    expect(h2.fetchImpl).toHaveBeenCalledTimes(2);
  });
  test('네트워크 오류도 1회 재시도 후 SecHttpError(network)', async () => {
    const h = harness([new TypeError('fetch failed'), new TypeError('fetch failed')]);
    await expect(h.client.getJson('https://data.sec.gov/a.json')).rejects.toMatchObject({ status: 'network' });
    expect(h.fetchImpl).toHaveBeenCalledTimes(2);
  });
  test('404 는 오류가 아니라 status 404', async () => {
    const h = harness([404]);
    await expect(h.client.getJson('https://data.sec.gov/a.json')).resolves.toEqual({ status: 404 });
  });
  test('JSON 이 아닌 본문은 SecHttpError(parse)', async () => {
    const h = harness([[200, '<html>blocked</html>']]);
    await expect(h.client.getJson('https://data.sec.gov/a.json')).rejects.toBeInstanceOf(SecHttpError);
  });
  test('같은 본문이면 같은 sha256(증분 판단용)', async () => {
    const h = harness([[200, '{"a":1}'], [200, '{"a":1}'], [200, '{"a":2}']]);
    const a = await h.client.getJson('https://data.sec.gov/a.json');
    const b = await h.client.getJson('https://data.sec.gov/a.json');
    const c = await h.client.getJson('https://data.sec.gov/a.json');
    expect(a.status === 200 && b.status === 200 && a.sha256 === b.sha256).toBe(true);
    expect(a.status === 200 && c.status === 200 && a.sha256 !== c.sha256).toBe(true);
    expect(h.client.requestCount).toBe(3);
  });
  test('cikPadded', () => {
    expect(cikPadded(50863)).toBe('0000050863');
    expect(() => cikPadded(0)).toThrow();
  });
});
