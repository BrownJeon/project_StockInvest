/**
 * T-165 — BLS 수집기 (Leader G4-3 · G2 시험 환경 실호출 차단).
 * 모든 시험은 `fetchImpl` 을 주입한다. 주입하지 않는 시험은 "실호출이 막히는가" 를 보는 것뿐이고,
 * 전역 fetch 는 jest.fn 으로 바꿔 둔다 — 이 파일에서 api.bls.gov 로 나가는 요청은 0건이다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BLS_ALLOWED_HOST,
  BLS_CPI_URL,
  BLS_MAX_RESPONSE_BYTES,
  BLS_TIMEOUT_MS,
  fetchBlsCpi,
  isAllowedBlsUrl,
  isTestEnvironment,
  parseBlsCpiResponse,
  type FetchLike,
} from '../bls-cpi';

/** BLS v1 실제 응답 원문(2026-11-11 Analyst 호출 1, 공공자료) */
const RAW = readFileSync(join(__dirname, 'fixtures', 'bls-v1-get-CUUR0000SA0.json'), 'utf8');
const RAW_JSON = JSON.parse(RAW);

const realFetch = globalThis.fetch;
const globalFetch = jest.fn(async () => { throw new Error('전역 fetch 가 호출되면 안 된다'); });
beforeEach(() => {
  globalFetch.mockClear();
  (globalThis as { fetch: unknown }).fetch = globalFetch;
});
afterAll(() => { (globalThis as { fetch: unknown }).fetch = realFetch; });
afterEach(() => { expect(globalFetch).not.toHaveBeenCalled(); });

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, ...init });
}
function respond(r: Response | (() => Response)): jest.Mock<Promise<Response>, [string, RequestInit]> {
  return jest.fn(async (_url: string, _init: RequestInit) => (typeof r === 'function' ? r() : r));
}
function withData(data: unknown[], extra: Record<string, unknown> = {}) {
  return { status: 'REQUEST_SUCCEEDED', responseTime: 1, message: [], Results: { series: [{ seriesID: 'CUUR0000SA0', data }] }, ...extra };
}

describe('상수·allowlist', () => {
  it('URL·타임아웃·상한이 설계값이다', () => {
    expect(BLS_CPI_URL).toBe('https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0');
    expect(BLS_ALLOWED_HOST).toBe('api.bls.gov');
    expect(BLS_TIMEOUT_MS).toBe(5000);
    expect(BLS_MAX_RESPONSE_BYTES).toBe(65536);
  });
  it.each([
    [BLS_CPI_URL, true],
    ['http://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0', false],
    ['https://api.bls.gov.evil.example/x', false],
    ['https://evil.example/api.bls.gov', false],
    ['https://api.bls.gov:8443/x', false],
    ['https://user:pw@api.bls.gov/x', false],
    ['not a url', false],
  ])('isAllowedBlsUrl(%s) = %s', (u, ok) => {
    expect(isAllowedBlsUrl(u)).toBe(ok);
  });
});

describe('정상 응답', () => {
  /**
   * 실측 응답 원문은 data 36행 = 월 34개(2024-01~2026-10) + **M13 연평균 2행**(2024·2025).
   * (Analyst §1 의 "36개월·M13 없음" 은 행 수를 월 수로 읽은 것 — 실제로 M13 이 들어 있어 제외 규칙이 실제로 필요하다.)
   */
  it('실제 응답 원문 → 월 34개(M13 연평균 2행 제외), 2025-10 결측(null), 최신 2026-10', async () => {
    const rows = RAW_JSON.Results.series[0].data as Array<{ year: string; period: string }>;
    expect(rows).toHaveLength(36);
    expect(rows.filter((x) => x.period === 'M13').map((x) => x.year).sort()).toEqual(['2024', '2025']);
    const f = respond(() => jsonResponse(RAW));
    const r = await fetchBlsCpi({ fetchImpl: f });
    expect(r.fetchStatus).toBe('ok');
    expect(r.httpStatus).toBe(200);
    expect(r.bytes).toBe(Buffer.byteLength(RAW));
    expect(Object.keys(r.observations!)).toHaveLength(34);
    expect(Object.keys(r.observations!).sort()[0]).toBe('2024-01');
    expect(r.observations!['2025-10']).toBeNull();
    expect(r.observations!['2026-10']).toBe(337.511);
    expect(r.observations!['2024-01']).toBe(308.417);
  });
  it('요청: GET · 정확한 URL · redirect "error" · no-store · signal', async () => {
    const f = respond(() => jsonResponse(RAW));
    await fetchBlsCpi({ fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(BLS_CPI_URL);
    expect(init).toMatchObject({ method: 'GET', redirect: 'error', cache: 'no-store' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.body).toBeUndefined();
  });
  it('"-" 는 null, M13(연평균) 행은 건너뛴다', () => {
    // C2-1 이후 YoY 쌍(2025-09·2024-09)이 1개 이상 있어야 ok — 그래서 2024-09 행을 함께 둔다
    const r = parseBlsCpiResponse(withData([
      { year: '2025', period: 'M13', value: '322.0' },
      { year: '2025', period: 'M10', value: '-' },
      { year: '2025', period: 'M09', value: '324.800' },
      { year: '2024', period: 'M09', value: '315.301' },
    ]));
    expect(r).toEqual({ ok: true, observations: { '2025-10': null, '2025-09': 324.8, '2024-09': 315.301 } });
  });
});

describe('실패 — 전부 fetchStatus 코드로 끝나고 던지지 않는다', () => {
  it('타임아웃 — fetch 가 signal 을 무시하고 영영 응답하지 않아도 마감에 끝난다', async () => {
    const f: FetchLike = () => new Promise<Response>(() => {});
    const t0 = Date.now();
    const r = await fetchBlsCpi({ fetchImpl: f, timeoutMs: 40 });
    expect(r.fetchStatus).toBe('timeout');
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  it('타임아웃 — 헤더 뒤 본문이 끝나지 않을 때도', async () => {
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('{"status":')); } });
    const r = await fetchBlsCpi({ fetchImpl: respond(() => new Response(stream)), timeoutMs: 40 });
    expect(r.fetchStatus).toBe('timeout');
  });
  it('타임아웃 — 협조적인 fetch 는 signal abort 를 받는다', async () => {
    let gotAbort = false;
    const f: FetchLike = (_u, init) => new Promise<Response>((_, reject) => {
      init.signal!.addEventListener('abort', () => { gotAbort = true; reject(new DOMException('aborted', 'AbortError')); });
    });
    const r = await fetchBlsCpi({ fetchImpl: f, timeoutMs: 20 });
    expect(r.fetchStatus).toBe('timeout');
    expect(gotAbort).toBe(true);
  });
  it('HTTP 500 → http_error', async () => {
    const r = await fetchBlsCpi({ fetchImpl: respond(() => new Response('oops', { status: 500 })) });
    expect(r).toMatchObject({ fetchStatus: 'http_error', httpStatus: 500 });
  });
  it('3xx 응답이 그대로 와도 → http_error', async () => {
    const r = await fetchBlsCpi({ fetchImpl: respond(() => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } })) });
    expect(r).toMatchObject({ fetchStatus: 'http_error', httpStatus: 302 });
  });
  it('리다이렉트 — redirect:"error" 라 fetch 가 거절한다 → network_error', async () => {
    const f = jest.fn<Promise<Response>, [string, RequestInit]>(async (_u, init) => {
      if (init.redirect === 'error') throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
      return jsonResponse(RAW);
    });
    const r = await fetchBlsCpi({ fetchImpl: f });
    expect(r.fetchStatus).toBe('network_error');
  });
  it('status REQUEST_NOT_PROCESSED → request_failed_status', async () => {
    const body = { status: 'REQUEST_NOT_PROCESSED', message: ['daily threshold'], Results: {} };
    const r = await fetchBlsCpi({ fetchImpl: respond(() => jsonResponse(body)) });
    expect(r.fetchStatus).toBe('request_failed_status');
  });
  it('JSON 깨짐 → bad_json', async () => {
    const r = await fetchBlsCpi({ fetchImpl: respond(() => jsonResponse('{"status":"REQUEST_SUCC')) });
    expect(r.fetchStatus).toBe('bad_json');
  });
  it('seriesID 불일치 → bad_schema', async () => {
    const body = { ...RAW_JSON, Results: { series: [{ ...RAW_JSON.Results.series[0], seriesID: 'CUSR0000SA0' }] } };
    const r = await fetchBlsCpi({ fetchImpl: respond(() => jsonResponse(body)) });
    expect(r.fetchStatus).toBe('bad_schema');
  });
  it('64KB 초과 — Content-Length 없이 스트림으로 와도 초과 즉시 읽기를 멈춘다 → too_large', async () => {
    let pulled = 0;
    const chunk = new Uint8Array(16 * 1024).fill(32);
    const stream = new ReadableStream<Uint8Array>({
      pull(c) { pulled++; if (pulled > 100) c.close(); else c.enqueue(chunk); },
    });
    const r = await fetchBlsCpi({ fetchImpl: respond(() => new Response(stream)) });
    expect(r.fetchStatus).toBe('too_large');
    expect(r.bytes).toBeGreaterThan(BLS_MAX_RESPONSE_BYTES);
    expect(pulled).toBeLessThan(10); // 100개(1.6MB)를 다 읽지 않았다
  });
  it('Content-Length 가 상한을 넘으면 본문을 읽지 않고 too_large', async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { pulled++; c.enqueue(new Uint8Array(10)); c.close(); } });
    const res = new Response(stream, { headers: { 'content-length': String(BLS_MAX_RESPONSE_BYTES + 1) } });
    const r = await fetchBlsCpi({ fetchImpl: respond(res) });
    expect(r.fetchStatus).toBe('too_large');
    expect(pulled).toBeLessThanOrEqual(1); // 스트림 시작 시 1회 pull 은 런타임 몫 — 우리 루프는 읽지 않았다
  });
  it('fetch 가 동기로 던져도 → network_error (throw 0)', async () => {
    const f: FetchLike = () => { throw new Error('sync boom'); };
    await expect(fetchBlsCpi({ fetchImpl: f })).resolves.toMatchObject({ fetchStatus: 'network_error' });
  });
  it('fetch 가 이상한 값을 돌려줘도 → http_error (throw 0)', async () => {
    const f = (async () => null) as unknown as FetchLike;
    await expect(fetchBlsCpi({ fetchImpl: f })).resolves.toMatchObject({ fetchStatus: 'http_error' });
  });
});

describe('C2-1 — 사용 가능한 YoY 쌍(M 과 M−12 모두 양수)이 1개 이상이어야 ok', () => {
  it.each([
    ['(a) 한 달 응답', [{ year: '2026', period: 'M10', value: '337.5' }]],
    ['(a) "-" 한 달 응답', [{ year: '2026', period: 'M10', value: '-' }]],
    ['여러 달이어도 12개월 전 짝이 하나도 없다', Array.from({ length: 10 }, (_, i) => ({ year: '2026', period: `M${String(i + 1).padStart(2, '0')}`, value: String(330 + i) }))],
    ['짝의 한쪽이 "-" 다', [{ year: '2026', period: 'M10', value: '337.5' }, { year: '2025', period: 'M10', value: '-' }]],
    ['M13 끼리는 짝이 아니다', [{ year: '2026', period: 'M01', value: '330' }, { year: '2025', period: 'M13', value: '320' }]],
  ])('%s → bad_schema', (_d, data) => {
    expect(parseBlsCpiResponse(withData(data))).toEqual({ ok: false, status: 'bad_schema' });
  });
  it('짝 1개면 ok (하한 = 쌍 1개)', () => {
    expect(parseBlsCpiResponse(withData([
      { year: '2026', period: 'M09', value: '336.94' },
      { year: '2025', period: 'M09', value: '324.8' },
    ]))).toEqual({ ok: true, observations: { '2026-09': 336.94, '2025-09': 324.8 } });
  });
  it('(b) 실제 34개월 응답(2025-10 "-" 포함)은 그대로 ok', () => {
    const r = parseBlsCpiResponse(RAW_JSON);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.observations['2025-10']).toBeNull();
      expect(Object.keys(r.observations)).toHaveLength(34);
    }
  });
  it('(a) 수집 경로에서도 한 달 응답은 bad_schema 로 끝난다', async () => {
    const r = await fetchBlsCpi({ fetchImpl: respond(() => jsonResponse(withData([{ year: '2026', period: 'M10', value: '337.5' }]))) });
    expect(r.fetchStatus).toBe('bad_schema');
    expect(r.observations).toBeUndefined();
  });
});

describe('C2-2 — 본문 읽기가 실패하면 본문 스트림에 취소를 보낸다', () => {
  it('signal 을 무시하는 본문 스트림이 타임아웃 뒤 cancel 을 받는다', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new TextEncoder().encode('{"status":')); }, // 그 뒤로 영영 끝나지 않는다
      cancel() { cancelled = true; },
    });
    const r = await fetchBlsCpi({ fetchImpl: respond(() => new Response(stream)), timeoutMs: 30 });
    expect(r.fetchStatus).toBe('timeout');
    await new Promise<void>((done) => setImmediate(done));
    expect(cancelled).toBe(true);
  });
  it('본문 스트림이 오류로 끝나면 network_error — 이미 닫힌 스트림의 취소 거절도 흡수한다', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new TextEncoder().encode('{"status":')); },
      pull(c) { c.error(new Error('connection reset')); },
    });
    await expect(fetchBlsCpi({ fetchImpl: respond(() => new Response(stream)) })).resolves.toMatchObject({ fetchStatus: 'network_error' });
  });
});

describe('응답 검증 (parseBlsCpiResponse)', () => {
  it.each([
    ['비숫자 값', [{ year: '2025', period: 'M09', value: 'N/A' }]],
    ['음수/0 값', [{ year: '2025', period: 'M09', value: '0' }]],
    ['잘못된 period', [{ year: '2025', period: 'M14', value: '1.0' }]],
    ['분기 period', [{ year: '2025', period: 'Q01', value: '1.0' }]],
    ['잘못된 year', [{ year: '25', period: 'M01', value: '1.0' }]],
    ['숫자형 value', [{ year: '2025', period: 'M01', value: 1.0 }]],
    ['빈 data', []],
    ['M13 만', [{ year: '2025', period: 'M13', value: '1.0' }]],
    ['같은 달 상충', [{ year: '2025', period: 'M01', value: '1.0' }, { year: '2025', period: 'M01', value: '2.0' }]],
    ['원소가 객체가 아님', ['x']],
  ])('%s → bad_schema', (_d, data) => {
    expect(parseBlsCpiResponse(withData(data))).toEqual({ ok: false, status: 'bad_schema' });
  });
  it.each([
    ['null', null],
    ['배열', []],
    ['Results 없음', { status: 'REQUEST_SUCCEEDED' }],
    ['series 빈 배열', { status: 'REQUEST_SUCCEEDED', Results: { series: [] } }],
    ['data 가 배열 아님', { status: 'REQUEST_SUCCEEDED', Results: { series: [{ seriesID: 'CUUR0000SA0', data: {} }] } }],
  ])('구조 이상(%s) → bad_schema', (_d, json) => {
    expect(parseBlsCpiResponse(json)).toEqual({ ok: false, status: 'bad_schema' });
  });
});

describe('🔴 시험 환경 실호출 차단 (G2)', () => {
  it('jest 안에서는 시험 환경으로 판정된다', () => {
    expect(isTestEnvironment()).toBe(true);
    expect(isTestEnvironment({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isTestEnvironment({ NODE_ENV: 'production', JEST_WORKER_ID: '1' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isTestEnvironment({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe(true);
  });
  it('fetchImpl 을 주지 않으면 전역 fetch 를 부르지 않고 disabled_in_test 로 끝난다', async () => {
    await expect(fetchBlsCpi()).resolves.toEqual({ fetchStatus: 'disabled_in_test' });
    expect(globalFetch).not.toHaveBeenCalled();
  });
  it('운영 환경(NODE_ENV=production, JEST_WORKER_ID 없음)이면 기본 경로가 전역 fetch 로 BLS URL 을 부른다 — 차단 장치는 시험 환경에만 걸린다', async () => {
    const saved = { NODE_ENV: process.env.NODE_ENV, JEST_WORKER_ID: process.env.JEST_WORKER_ID };
    const prodFetch = jest.fn(async () => jsonResponse(RAW));
    (globalThis as { fetch: unknown }).fetch = prodFetch;
    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      delete process.env.JEST_WORKER_ID;
      const r = await fetchBlsCpi();
      expect(r.fetchStatus).toBe('ok');
      expect(prodFetch).toHaveBeenCalledTimes(1);
      expect((prodFetch.mock.calls[0] as unknown[])[0]).toBe(BLS_CPI_URL);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = saved.NODE_ENV;
      if (saved.JEST_WORKER_ID !== undefined) process.env.JEST_WORKER_ID = saved.JEST_WORKER_ID;
      (globalThis as { fetch: unknown }).fetch = globalFetch;
    }
  });
});
