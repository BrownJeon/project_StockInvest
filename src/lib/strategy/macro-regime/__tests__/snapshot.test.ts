/**
 * T-165 — 캐시·갱신 정책 (Leader G4-4 · G7-3 · Analyst §8).
 * 수집기는 전부 주입한다(BLS 실호출 0). 시각은 `now` 인자로 넘긴다(가짜 타이머 없이 결정적).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchBlsCpi, type BlsFetchResult } from '../bls-cpi';
import {
  __macroRegimeInFlightForTest,
  __macroRegimeStateForTest,
  __resetMacroRegimeForTest,
  __setMacroRegimeClassifierForTest,
  __setMacroRegimeFetcherForTest,
  getMacroRegimeRecord,
  kickMacroRegimeRefresh,
  latestNumericMonth,
  MAX_ATTEMPTS_PER_UTC_DAY,
  RETRY_MIN_INTERVAL_MS,
  STUCK_FLIGHT_MS,
  SUCCESS_TTL_MS,
} from '../snapshot';
import type { CpiIndexByMonth } from '../types';

const CPI: CpiIndexByMonth = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'cpi-cuur0000sa0-2017-2026.json'), 'utf8')).index;
const OK: BlsFetchResult = { fetchStatus: 'ok', observations: CPI, httpStatus: 200 };
const H = 3600_000;
const at = (iso: string) => new Date(iso);
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
/** 진행 중 수집이 끝날 때까지 */
async function settle(): Promise<void> {
  const p = __macroRegimeInFlightForTest();
  if (p) await p;
  await new Promise<void>((r) => setImmediate(r));
}

const realFetch = globalThis.fetch;
const globalFetch = jest.fn(async () => { throw new Error('전역 fetch 가 호출되면 안 된다'); });
const savedDisabled = process.env.MACRO_REGIME_BLS_DISABLED;
beforeEach(() => {
  __resetMacroRegimeForTest();
  globalFetch.mockClear();
  (globalThis as { fetch: unknown }).fetch = globalFetch;
  delete process.env.MACRO_REGIME_BLS_DISABLED;
});
afterEach(() => {
  __resetMacroRegimeForTest();
  expect(globalFetch).not.toHaveBeenCalled();
});
afterAll(() => {
  (globalThis as { fetch: unknown }).fetch = realFetch;
  if (savedDisabled === undefined) delete process.env.MACRO_REGIME_BLS_DISABLED;
  else process.env.MACRO_REGIME_BLS_DISABLED = savedDisabled;
});

const T0 = at('2026-11-11T14:00:00Z'); // 다음 발표 2026-12-10 13:30Z 까지 발표 없음

it('설계값: TTL 24h · 재시도 간격 2h · 하루 6회', () => {
  expect(SUCCESS_TTL_MS).toBe(24 * H);
  expect(RETRY_MIN_INTERVAL_MS).toBe(2 * H);
  expect(MAX_ATTEMPTS_PER_UTC_DAY).toBe(6);
  expect(STUCK_FLIGHT_MS).toBe(10 * 60_000);
});

describe('미로딩 → 정상', () => {
  it('수집 전에는 unknown(cpi_not_loaded) · not_attempted', () => {
    const rec = getMacroRegimeRecord(T0);
    expect(rec.label).toBe('unknown');
    expect(rec.reasonCodes).toEqual(['cpi_not_loaded']);
    expect(rec.cpi.fetchStatus).toBe('not_attempted');
  });
  it('kick 은 기다리지 않는다 — 돌아온 직후엔 아직 미로딩, 수집이 끝나면 정상 라벨(H14)', async () => {
    let resolve!: (r: BlsFetchResult) => void;
    const f = jest.fn(() => new Promise<BlsFetchResult>((r) => { resolve = r; }));
    __setMacroRegimeFetcherForTest(f);
    expect(kickMacroRegimeRefresh(T0)).toBeUndefined();
    expect(f).toHaveBeenCalledTimes(1);
    expect(getMacroRegimeRecord(T0).reasonCodes).toEqual(['cpi_not_loaded']);
    resolve(OK);
    await settle();
    const rec = getMacroRegimeRecord(T0);
    expect(rec.label).toBe('normal_tightening');
    expect(rec.reasonCodes).toEqual([]);
    expect(rec.cpi).toMatchObject({ referenceMonth: '2026-09', yoyPct: 3.7, fetchStatus: 'ok', fetchedAtUtc: '2026-11-11T14:00:00Z', cacheAgeSec: 0 });
  });
});

describe('호출 빈도 상한', () => {
  it('성공 뒤 24시간 안에는 다시 부르지 않고, 24시간이 지나면 부른다', async () => {
    const f = jest.fn(async () => OK);
    __setMacroRegimeFetcherForTest(f);
    kickMacroRegimeRefresh(T0); await settle();
    for (const ms of [5 * 60_000, 2 * H, 12 * H, 24 * H - 1]) { kickMacroRegimeRefresh(plus(T0, ms)); await settle(); }
    expect(f).toHaveBeenCalledTimes(1);
    kickMacroRegimeRefresh(plus(T0, 24 * H)); await settle();
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('실패 뒤 2시간 안에는 재시도하지 않는다', async () => {
    const f = jest.fn(async (): Promise<BlsFetchResult> => ({ fetchStatus: 'http_error', httpStatus: 503 }));
    __setMacroRegimeFetcherForTest(f);
    kickMacroRegimeRefresh(T0); await settle();
    kickMacroRegimeRefresh(plus(T0, 5 * 60_000)); await settle();
    kickMacroRegimeRefresh(plus(T0, 2 * H - 1)); await settle();
    expect(f).toHaveBeenCalledTimes(1);
    kickMacroRegimeRefresh(plus(T0, 2 * H)); await settle();
    expect(f).toHaveBeenCalledTimes(2);
    expect(getMacroRegimeRecord(plus(T0, 2 * H)).cpi.fetchStatus).toBe('http_error');
  });
  it('UTC 하루 6회 상한 — 7번째는 막히고 다음 UTC 날에 다시 허용된다', async () => {
    const f = jest.fn(async (): Promise<BlsFetchResult> => ({ fetchStatus: 'timeout' }));
    __setMacroRegimeFetcherForTest(f);
    const day = at('2026-11-11T00:00:00Z');
    for (let i = 0; i < 12; i++) { kickMacroRegimeRefresh(plus(day, i * 2 * H)); await settle(); } // 00:00 ~ 22:00
    expect(f).toHaveBeenCalledTimes(6);
    expect(__macroRegimeStateForTest().attemptsToday).toBe(6);
    kickMacroRegimeRefresh(at('2026-11-12T00:00:00Z')); await settle();
    expect(f).toHaveBeenCalledTimes(7);
    expect(__macroRegimeStateForTest()).toMatchObject({ attemptDay: '2026-11-12', attemptsToday: 1 });
  });
  it('동시에 두 번 kick 해도 수집은 1회(단일 비행)', async () => {
    let resolve!: (r: BlsFetchResult) => void;
    const f = jest.fn(() => new Promise<BlsFetchResult>((r) => { resolve = r; }));
    __setMacroRegimeFetcherForTest(f);
    kickMacroRegimeRefresh(T0);
    kickMacroRegimeRefresh(T0);
    kickMacroRegimeRefresh(plus(T0, 9 * 60_000)); // 진행 중(10분 안)이면 새로 시작하지 않는다
    expect(f).toHaveBeenCalledTimes(1);
    resolve(OK);
    await settle();
    expect(__macroRegimeStateForTest().inFlight).toBe(false);
  });
  it('끝나지 않는 수집은 10분 뒤 버리고(간격 2h 충족 시) 새로 시도한다', async () => {
    const f = jest.fn(() => new Promise<BlsFetchResult>(() => {}));
    __setMacroRegimeFetcherForTest(f);
    kickMacroRegimeRefresh(T0);
    kickMacroRegimeRefresh(plus(T0, 9 * 60_000));
    expect(f).toHaveBeenCalledTimes(1);
    kickMacroRegimeRefresh(plus(T0, 2 * H));
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('실패 시 캐시 보존·낡음', () => {
  it('성공 뒤 실패해도 이전 값을 덮어쓰지 않는다', async () => {
    const f = jest.fn(async () => OK);
    __setMacroRegimeFetcherForTest(f);
    kickMacroRegimeRefresh(T0); await settle();
    f.mockImplementation(async () => ({ fetchStatus: 'bad_schema' }) as BlsFetchResult);
    const t1 = plus(T0, 25 * H);
    kickMacroRegimeRefresh(t1); await settle();
    expect(f).toHaveBeenCalledTimes(2);
    const rec = getMacroRegimeRecord(t1);
    expect(rec.label).toBe('normal_tightening');
    expect(rec.cpi).toMatchObject({ referenceMonth: '2026-09', fetchStatus: 'bad_schema', fetchedAtUtc: '2026-11-11T14:00:00Z', cacheAgeSec: 25 * 3600 });
  });
  it('7일 넘게 성공이 없으면 cpi_cache_stale (값은 남긴다)', async () => {
    __setMacroRegimeFetcherForTest(async () => OK);
    kickMacroRegimeRefresh(T0); await settle();
    __setMacroRegimeFetcherForTest(async () => ({ fetchStatus: 'timeout' }));
    expect(getMacroRegimeRecord(plus(T0, 7 * 24 * H)).reasonCodes).toEqual([]);
    const rec = getMacroRegimeRecord(plus(T0, 7 * 24 * H + 1000));
    expect(rec.label).toBe('unknown');
    expect(rec.reasonCodes).toEqual(['cpi_cache_stale']);
    expect(rec.cpi.referenceMonth).toBe('2026-09');
  });
  it('실패만 있었으면(성공 이력 없음) 계속 cpi_not_loaded 이고 fetchStatus 는 마지막 실패', async () => {
    __setMacroRegimeFetcherForTest(async () => ({ fetchStatus: 'too_large' }));
    kickMacroRegimeRefresh(T0); await settle();
    const rec = getMacroRegimeRecord(T0);
    expect(rec.reasonCodes).toEqual(['cpi_not_loaded']);
    expect(rec.cpi.fetchStatus).toBe('too_large');
  });
});

describe('C2-1 — 짧아진·후퇴한 응답이 정상 캐시를 덮어쓰지 않는다', () => {
  /** 기준월 ≤ upTo 인 달만 남긴 지수(쌍은 남아 있어 파서는 통과하는 '후퇴 응답') */
  const upTo = (ym: string) => Object.fromEntries(Object.entries(CPI).filter(([k]) => k <= ym)) as CpiIndexByMonth;
  const t1 = plus(T0, 25 * H); // TTL 경과 → 다시 받는다

  it('latestNumericMonth — 값이 숫자인 가장 늦은 달', () => {
    expect(latestNumericMonth(CPI)).toBe('2026-10');
    expect(latestNumericMonth({ '2026-11': null, '2026-10': 1 })).toBe('2026-10');
    expect(latestNumericMonth(null)).toBeNull();
  });
  it('(c) 정상 캐시 뒤 한 달짜리 응답(파서가 bad_schema)이 와도 캐시·수집 시각·라벨이 그대로', async () => {
    __setMacroRegimeFetcherForTest(async () => OK);
    kickMacroRegimeRefresh(T0); await settle();
    const oneMonth = { status: 'REQUEST_SUCCEEDED', Results: { series: [{ seriesID: 'CUUR0000SA0', data: [{ year: '2026', period: 'M10', value: '337.5' }] }] } };
    const f = jest.fn(() => fetchBlsCpi({ fetchImpl: async () => new Response(JSON.stringify(oneMonth)) }));
    __setMacroRegimeFetcherForTest(f);
    kickMacroRegimeRefresh(t1); await settle();
    expect(f).toHaveBeenCalledTimes(1);
    const rec = getMacroRegimeRecord(t1);
    expect(rec.label).toBe('normal_tightening');
    expect(rec.cpi).toMatchObject({ referenceMonth: '2026-09', fetchStatus: 'bad_schema', fetchedAtUtc: '2026-11-11T14:00:00Z' });
    expect(__macroRegimeStateForTest().index).toBe(CPI);
  });
  it('(c) 후퇴 응답(쌍은 있으나 최신 월이 기존보다 이른 ok)은 교체하지 않고 bad_schema 로 기록, 2시간 뒤 재시도', async () => {
    __setMacroRegimeFetcherForTest(async () => OK);
    kickMacroRegimeRefresh(T0); await settle();
    const f = jest.fn(async (): Promise<BlsFetchResult> => ({ fetchStatus: 'ok', observations: upTo('2026-08') }));
    __setMacroRegimeFetcherForTest(f);
    kickMacroRegimeRefresh(t1); await settle();
    const st = __macroRegimeStateForTest();
    expect(st.index).toBe(CPI);
    expect(st.fetchedAt).toBe(T0.getTime());
    expect(st.lastStatus).toBe('bad_schema');
    expect(getMacroRegimeRecord(t1).cpi).toMatchObject({ referenceMonth: '2026-09', fetchStatus: 'bad_schema' });
    kickMacroRegimeRefresh(plus(t1, 2 * H - 1)); await settle();
    expect(f).toHaveBeenCalledTimes(1);
    kickMacroRegimeRefresh(plus(t1, 2 * H)); await settle();
    expect(f).toHaveBeenCalledTimes(2); // 캐시가 여전히 TTL 지남 → 간격 뒤 다시 시도
  });
  it('최신 월이 같거나 늦으면 정상 교체한다 (평시 갱신)', async () => {
    __setMacroRegimeFetcherForTest(async () => OK);
    kickMacroRegimeRefresh(T0); await settle();
    const same = { ...CPI };
    __setMacroRegimeFetcherForTest(async () => ({ fetchStatus: 'ok', observations: same }));
    kickMacroRegimeRefresh(t1); await settle();
    expect(__macroRegimeStateForTest()).toMatchObject({ index: same, fetchedAt: t1.getTime(), lastStatus: 'ok' });
  });
  it('캐시가 없으면 비교 대상이 없으므로 쌍이 있는 ok 응답은 받아들인다', async () => {
    __setMacroRegimeFetcherForTest(async () => ({ fetchStatus: 'ok', observations: upTo('2026-08') }));
    kickMacroRegimeRefresh(T0); await settle();
    expect(__macroRegimeStateForTest().lastStatus).toBe('ok');
    expect(getMacroRegimeRecord(T0).cpi.referenceMonth).toBe('2026-08');
  });
});

describe('발표 인지 갱신 (G7-3) — TTL 과 무관하게 발표 시각을 넘으면 다시 받는다', () => {
  const dayBefore1555Et = at('2026-12-09T20:55:00Z'); // 2026-12-09 15:55 EST
  const release = at('2026-12-10T13:30:00Z');          // 2026-11 치 08:30 EST

  it('발표 전날 15:55 ET 성공 → 다음 날 08:29 ET 는 그대로, 08:30 ET 이후 첫 kick 에서 갱신 시작', async () => {
    const f = jest.fn(async () => OK);
    __setMacroRegimeFetcherForTest(f);
    kickMacroRegimeRefresh(dayBefore1555Et); await settle();
    kickMacroRegimeRefresh(plus(release, -60_000)); await settle();
    expect(f).toHaveBeenCalledTimes(1); // 16.5h — TTL 안, 발표 전
    kickMacroRegimeRefresh(release); await settle();
    expect(f).toHaveBeenCalledTimes(2); // 발표가 지나감 → 갱신
  });
  it('발표 뒤 받은 응답에 그 달이 아직 없으면 2시간 뒤 다시 확인하고, 들어오면 멈춘다', async () => {
    const withNov = { ...CPI, '2026-11': 340.1 };
    const f = jest.fn(async () => OK); // 2026-11 없음
    __setMacroRegimeFetcherForTest(f);
    kickMacroRegimeRefresh(plus(release, 60_000)); await settle(); // 발표 1분 뒤 첫 수집(아직 반영 전 응답)
    expect(f).toHaveBeenCalledTimes(1);
    kickMacroRegimeRefresh(plus(release, 60_000 + 2 * H - 1)); await settle();
    expect(f).toHaveBeenCalledTimes(1);
    expect(getMacroRegimeRecord(plus(release, 2 * H)).cpi).toMatchObject({ referenceMonth: '2026-09', expectedReferenceMonth: '2026-11', lagsSchedule: true });
    f.mockImplementation(async () => ({ ...OK, observations: withNov }));
    kickMacroRegimeRefresh(plus(release, 60_000 + 2 * H)); await settle();
    expect(f).toHaveBeenCalledTimes(2);
    const rec = getMacroRegimeRecord(plus(release, 3 * H));
    expect(rec.cpi).toMatchObject({ referenceMonth: '2026-11', expectedReferenceMonth: '2026-11', lagsSchedule: false });
    kickMacroRegimeRefresh(plus(release, 60_000 + 4 * H)); await settle();
    expect(f).toHaveBeenCalledTimes(2); // 반영됐으니 TTL 까지 다시 부르지 않는다
  });
});

describe('🔴 무예외 — kick·get 은 어떤 경우에도 던지지 않는다', () => {
  it.each([
    ['수집기가 동기로 던짐', () => { throw new Error('sync'); }],
    ['수집기가 reject', () => Promise.reject(new Error('async'))],
    ['수집기가 문자열로 reject', () => Promise.reject('str')],
    ['수집기가 이상한 값을 resolve', () => Promise.resolve(undefined as unknown as BlsFetchResult)],
  ])('%s → kick 무예외, 상태 internal_error, 기록은 unknown', async (_d, f) => {
    __setMacroRegimeFetcherForTest(f as () => Promise<BlsFetchResult>);
    expect(() => kickMacroRegimeRefresh(T0)).not.toThrow();
    await settle();
    const rec = getMacroRegimeRecord(T0);
    expect(rec.cpi.fetchStatus).toBe('internal_error');
    expect(rec.reasonCodes).toEqual(['cpi_not_loaded']);
  });
  /**
   * 처리 안 된 거절 0건 — jest 는 시험 도중 처리 안 된 거절이 생기면 **그 시험을 실패시킨다**
   * (2026-11-12 Developer 확인: 시험 안의 `Promise.reject(new Error('control'))` 1건으로 시험이 'control' 로 실패,
   * 반면 시험 코드의 `process.on('unhandledRejection')` 리스너는 jest 의 process 대역이라 0건을 봤다 — 그래서 리스너로
   * 세지 않고 jest 의 실패 판정에 맡긴다). 아래는 거절 경로 3종을 돌리고 이벤트 루프를 몇 바퀴 돌려 그 판정 창 안에 둔다.
   */
  it('처리 안 된 거절(unhandledRejection) 0건 — 거절 경로 3종이 모두 흡수되고 비행 상태가 정리된다', async () => {
    for (const f of [
      () => Promise.reject(new Error('a')),
      () => { throw new Error('b'); },
      async () => { throw new Error('c'); },
    ]) {
      __resetMacroRegimeForTest();
      __setMacroRegimeFetcherForTest(f as () => Promise<BlsFetchResult>);
      kickMacroRegimeRefresh(T0);
      const flight = __macroRegimeInFlightForTest();
      expect(flight).not.toBeNull();
      await expect(flight).resolves.toBeUndefined(); // 비행 promise 자체는 절대 reject 되지 않는다
      await new Promise<void>((r) => setTimeout(r, 10));
      expect(__macroRegimeStateForTest()).toMatchObject({ inFlight: false, lastStatus: 'internal_error' });
    }
  });
  it('분류기가 던져도 getMacroRegimeRecord 는 unknown(internal_error) 을 돌려준다', () => {
    __setMacroRegimeClassifierForTest(() => { throw new Error('classify boom'); });
    let rec: ReturnType<typeof getMacroRegimeRecord> | undefined;
    expect(() => { rec = getMacroRegimeRecord(T0); }).not.toThrow();
    expect(rec!).toMatchObject({ label: 'unknown', isType5: false, reasonCodes: ['internal_error'], asOfUtc: '2026-11-11T14:00:00Z' });
  });
  it('잘못된 시각을 줘도 던지지 않는다', () => {
    expect(() => kickMacroRegimeRefresh(new Date('nope'))).not.toThrow();
    expect(getMacroRegimeRecord(new Date('nope')).reasonCodes).toEqual(['internal_error']);
  });
});

describe('운영 끄기 손잡이 · 시험 환경 차단', () => {
  it('MACRO_REGIME_BLS_DISABLED=true 면 수집하지 않고 cpi_not_loaded · fetchStatus disabled', async () => {
    const f = jest.fn(async () => OK);
    __setMacroRegimeFetcherForTest(f);
    process.env.MACRO_REGIME_BLS_DISABLED = 'true';
    kickMacroRegimeRefresh(T0); await settle();
    expect(f).not.toHaveBeenCalled();
    const rec = getMacroRegimeRecord(T0);
    expect(rec.reasonCodes).toEqual(['cpi_not_loaded']);
    expect(rec.cpi.fetchStatus).toBe('disabled');
  });
  it('기본(미설정·그 밖의 값)은 수집한다', async () => {
    const f = jest.fn(async () => OK);
    __setMacroRegimeFetcherForTest(f);
    process.env.MACRO_REGIME_BLS_DISABLED = 'false';
    kickMacroRegimeRefresh(T0); await settle();
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('🔴 수집기를 주입하지 않은 기본 경로는 시험 환경에서 네트워크로 나가지 않는다', async () => {
    kickMacroRegimeRefresh(T0); await settle();
    expect(globalFetch).not.toHaveBeenCalled();
    expect(getMacroRegimeRecord(T0).cpi.fetchStatus).toBe('disabled_in_test');
  });
  it('리셋 뒤 늦게 끝난 이전 수집은 새 상태를 바꾸지 않는다', async () => {
    let resolve!: (r: BlsFetchResult) => void;
    __setMacroRegimeFetcherForTest(() => new Promise<BlsFetchResult>((r) => { resolve = r; }));
    kickMacroRegimeRefresh(T0);
    __resetMacroRegimeForTest();
    resolve(OK);
    await new Promise<void>((r) => setImmediate(r));
    expect(getMacroRegimeRecord(T0).reasonCodes).toEqual(['cpi_not_loaded']);
  });
});
