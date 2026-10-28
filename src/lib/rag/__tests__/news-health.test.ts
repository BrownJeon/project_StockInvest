/**
 * T-106 뉴스 0건 연속 감시 — `recordNewsOutcome` / `recordRetrievalNewsOutcome` 단위 시험.
 *
 * 실제 DB·알림 없음: `getPool()` 은 system_config 한 테이블만 흉내 내는 메모리 목, `sendAlertThrottled` 는 목.
 * (스로틀 창 실제 동작은 news-health-throttle.test.ts)
 */
import { getPool } from '@/lib/db';
import { sendAlertThrottled } from '@/lib/notify/throttle';
import {
  NEWS_ZERO_ALERT_STREAK,
  NEWS_ZERO_ALERT_TTL_MS,
  NEWS_ZERO_MAX_GAP_DAYS,
  NEWS_HEALTH_TIMEOUT_MS,
  calendarDaysBetween,
  isNewsRetrievalReliable,
  kstDateOf,
  newsZeroStreakKey,
  nextNewsZeroState,
  parseNewsZeroState,
  recordNewsOutcome,
  recordRetrievalNewsOutcome,
  resolveNewsZeroAlertStreak,
} from '../news-health';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));
jest.mock('@/lib/notify/throttle', () => ({ sendAlertThrottled: jest.fn(() => true) }));

const mGetPool = getPool as jest.Mock;
const mAlert = sendAlertThrottled as jest.Mock;

let store: Map<string, unknown>;
let query: jest.Mock;

function wireDb() {
  query = jest.fn(async (sql: string, params: unknown[]) => {
    if (sql.startsWith('SELECT value FROM system_config WHERE `key` = ?')) {
      const v = store.get(String(params[0]));
      return [v === undefined ? [] : [{ value: v }], undefined];
    }
    if (sql.startsWith('INSERT INTO system_config (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)')) {
      store.set(String(params[0]), params[1]);
      return [{ affectedRows: 1 }, undefined];
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });
  mGetPool.mockReturnValue({ query });
}

/** KST 06:00 of the given KST date (YYYY-MM-DD) — UTC 전날 21:00. */
const kst = (date: string, hhmm = '06:00') => new Date(`${date}T${hhmm}:00+09:00`);
const stored = (key: string) => JSON.parse(String(store.get(key)));
const FD = newsZeroStreakKey('fetch', 'domestic');

const ORIGINAL_ENV = process.env.NEWS_ZERO_ALERT_STREAK;

beforeEach(() => {
  jest.clearAllMocks();
  mAlert.mockReturnValue(true);
  store = new Map();
  wireDb();
  delete process.env.NEWS_ZERO_ALERT_STREAK;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  if (ORIGINAL_ENV === undefined) delete process.env.NEWS_ZERO_ALERT_STREAK;
  else process.env.NEWS_ZERO_ALERT_STREAK = ORIGINAL_ENV;
});

async function days(channel: 'fetch' | 'retrieval', market: 'domestic' | 'overseas', seq: Array<[string, number]>) {
  const out = [];
  for (const [d, count] of seq) out.push(await recordNewsOutcome({ channel, market, count, now: kst(d) }));
  return out;
}

describe('연속 증가·임계 알림·초기화', () => {
  test('첫 0 → streak 1, 알림 없음, 상태 키·JSON 형식', async () => {
    const r = await recordNewsOutcome({ channel: 'fetch', market: 'domestic', count: 0, now: kst('2026-10-26') });
    expect(r).toEqual({ streak: 1, alerted: false });
    expect(FD).toBe('news_zero_streak:fetch:domestic');
    expect(stored(FD)).toEqual({ streak: 1, lastDate: '2026-10-26', lastCount: 0, lastOkDate: null });
    expect(mAlert).not.toHaveBeenCalled();
    const insert = query.mock.calls.find((c) => String(c[0]).startsWith('INSERT'))!;
    expect(insert[0]).toBe('INSERT INTO system_config (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)');
    expect(typeof insert[1][1]).toBe('string');
  });

  test('🔴 서로 다른 3일 연속 0 → 3일째 warning 알림(키 news-zero:fetch:domestic, 20시간 창)', async () => {
    const r = await days('fetch', 'domestic', [['2026-10-25', 5], ['2026-10-26', 0], ['2026-10-27', 0], ['2026-10-28', 0]]);
    expect(r.map((x) => x.streak)).toEqual([0, 1, 2, 3]);
    expect(r.map((x) => x.alerted)).toEqual([false, false, false, true]);
    expect(mAlert).toHaveBeenCalledTimes(1);
    const [key, level, title, body, ttl] = mAlert.mock.calls[0];
    expect(key).toBe('news-zero:fetch:domestic');
    expect(level).toBe('warning');
    expect(ttl).toBe(NEWS_ZERO_ALERT_TTL_MS);
    expect(NEWS_ZERO_ALERT_TTL_MS).toBe(20 * 3600 * 1000);
    expect(title).toContain('3일');
    expect(title).toContain('국내');
    expect(body).toContain('수집 단계(/api/cron/news-fetch)');
    expect(body).toContain('국내(domestic)');
    expect(body).toContain('연속 0건: 3일');
    expect(body).toContain('마지막 정상일: 2026-10-25');
    expect(body).toContain('원천 피드 정지');
    expect(body).toContain('날짜 형식');
    expect(body).toContain('M4 장애');
    expect(body).toContain('agent-vault/10-Flow/tasks/T-105-news-rag-zero-hits.md');
  });

  test('정상 관측이 한 번도 없으면 마지막 정상일 "기록 없음"', async () => {
    await days('retrieval', 'overseas', [['2026-10-26', 0], ['2026-10-27', 0], ['2026-10-28', 0]]);
    const [key, , title, body] = mAlert.mock.calls[0];
    expect(key).toBe('news-zero:retrieval:overseas');
    expect(title).toContain('해외');
    expect(body).toContain('분석 검색 단계');
    expect(body).toContain('기록 없음');
  });

  test('임계 이후에도 0 이 이어지면 매일 알림 호출(4일째·5일째)', async () => {
    const r = await days('fetch', 'overseas', [['2026-10-24', 0], ['2026-10-25', 0], ['2026-10-26', 0], ['2026-10-27', 0], ['2026-10-28', 0]]);
    expect(r.map((x) => x.streak)).toEqual([1, 2, 3, 4, 5]);
    expect(mAlert).toHaveBeenCalledTimes(3);
    expect(mAlert.mock.calls[2][3]).toContain('연속 0건: 5일');
  });

  test('🔴 한 번이라도 0 이 아니면 초기화 — 0,0,>0,0 → 1,2,0,1 (알림 없음)', async () => {
    const r = await days('fetch', 'domestic', [['2026-10-25', 0], ['2026-10-26', 0], ['2026-10-27', 3], ['2026-10-28', 0]]);
    expect(r.map((x) => x.streak)).toEqual([1, 2, 0, 1]);
    expect(mAlert).not.toHaveBeenCalled();
    expect(stored(FD)).toEqual({ streak: 1, lastDate: '2026-10-28', lastCount: 0, lastOkDate: '2026-10-27' });
  });

  test('관측 없는 날(주말·휴장)은 건너뛴다 — 금·월·화 0 이면 3', async () => {
    const r = await days('retrieval', 'domestic', [['2026-10-23', 0], ['2026-10-26', 0], ['2026-10-27', 0]]);
    expect(r.map((x) => x.streak)).toEqual([1, 2, 3]);
    expect(r[2].alerted).toBe(true);
  });

  test('반환 alerted 는 스로틀 결과를 그대로 — 창이 닫혀 있으면 false', async () => {
    mAlert.mockReturnValue(false);
    const r = await days('fetch', 'domestic', [['2026-10-26', 0], ['2026-10-27', 0], ['2026-10-28', 0]]);
    expect(r[2]).toEqual({ streak: 3, alerted: false });
    expect(mAlert).toHaveBeenCalledTimes(1);
  });
});

describe('같은 KST 날짜 재실행', () => {
  test('🔴 같은 날 0 을 세 번 → 하루로 센다(streak 1, 알림 없음)', async () => {
    for (const t of ['06:00', '06:05', '23:59']) {
      await recordNewsOutcome({ channel: 'fetch', market: 'domestic', count: 0, now: kst('2026-10-28', t) });
    }
    expect(stored(FD).streak).toBe(1);
    expect(mAlert).not.toHaveBeenCalled();
  });

  test('🔴 같은 날 앞선 실행 0 → 지금 >0 이면 초기화, 그 뒤 같은 날 0 은 건드리지 않는다', async () => {
    await days('fetch', 'domestic', [['2026-10-26', 0], ['2026-10-27', 0]]);
    const a = await recordNewsOutcome({ channel: 'fetch', market: 'domestic', count: 0, now: kst('2026-10-28', '06:00') });
    expect(a.streak).toBe(3);
    const b = await recordNewsOutcome({ channel: 'fetch', market: 'domestic', count: 4, now: kst('2026-10-28', '07:00') });
    expect(b).toEqual({ streak: 0, alerted: false });
    const c = await recordNewsOutcome({ channel: 'fetch', market: 'domestic', count: 0, now: kst('2026-10-28', '08:00') });
    expect(c).toEqual({ streak: 0, alerted: false });
    expect(stored(FD)).toEqual({ streak: 0, lastDate: '2026-10-28', lastCount: 4, lastOkDate: '2026-10-28' });
    // 다음 날 0 은 1 부터
    const d = await recordNewsOutcome({ channel: 'fetch', market: 'domestic', count: 0, now: kst('2026-10-29') });
    expect(d.streak).toBe(1);
  });

  test('같은 날 앞선 실행 >0 → 지금 0 이면 streak 그대로(0)', async () => {
    await days('fetch', 'domestic', [['2026-10-26', 0], ['2026-10-27', 0]]);
    await recordNewsOutcome({ channel: 'fetch', market: 'domestic', count: 2, now: kst('2026-10-28', '06:00') });
    const r = await recordNewsOutcome({ channel: 'fetch', market: 'domestic', count: 0, now: kst('2026-10-28', '06:30') });
    expect(r.streak).toBe(0);
  });

  test('임계에 도달한 날의 같은 날 재실행 0 → streak 늘지 않음(3 유지)', async () => {
    await days('fetch', 'domestic', [['2026-10-26', 0], ['2026-10-27', 0], ['2026-10-28', 0]]);
    const r = await recordNewsOutcome({ channel: 'fetch', market: 'domestic', count: 0, now: kst('2026-10-28', '09:00') });
    expect(r.streak).toBe(3);
  });
});

describe('KST 날짜 경계', () => {
  test.each([
    ['23:59:59 KST 와 다음 00:00:00 KST 는 다른 날', '2026-10-27T14:59:59Z', '2026-10-27T15:00:00Z', 2],
    ['UTC 로 같은 날이어도 KST 로 다른 날(23:00 → 01:00 KST)', '2026-10-27T14:00:00Z', '2026-10-27T16:00:00Z', 2],
    ['UTC 로 다른 날이어도 KST 로 같은 날(00:30 → 23:30 KST)', '2026-10-27T15:30:00Z', '2026-10-28T14:30:00Z', 1],
  ])('%s', async (_n, a, b, expected) => {
    await recordNewsOutcome({ channel: 'fetch', market: 'domestic', count: 0, now: new Date(a) });
    const r = await recordNewsOutcome({ channel: 'fetch', market: 'domestic', count: 0, now: new Date(b) });
    expect(r.streak).toBe(expected);
  });

  test('kstDateOf — 서버 TZ 와 무관한 +9h', () => {
    expect(kstDateOf(new Date('2026-10-27T14:59:59Z'))).toBe('2026-10-27');
    expect(kstDateOf(new Date('2026-10-27T15:00:00Z'))).toBe('2026-10-28');
  });
});

describe('임계 — 상수·환경변수', () => {
  test('기본 3', () => {
    expect(NEWS_ZERO_ALERT_STREAK).toBe(3);
    expect(resolveNewsZeroAlertStreak(undefined)).toBe(3);
  });
  test.each([
    ['2', 2], ['3', 3], ['4', 4], [' 4 ', 4], ['10', 10],
    ['1', 2], ['0', 2], ['-5', 2], ['2.7', 2], ['3.9', 3],
    ['abc', 3], ['', 3], ['   ', 3], ['NaN', 3], ['Infinity', 3], ['3일', 3],
  ])('NEWS_ZERO_ALERT_STREAK=%j → %d', (raw, expected) => {
    expect(resolveNewsZeroAlertStreak(raw)).toBe(expected);
  });

  test.each([
    ['2', [false, true, true]],
    ['3', [false, false, true]],
    ['4', [false, false, false, true]],
  ])('🔴 환경변수 %s — 정확히 그 일수째에 처음 알림', async (raw, expected) => {
    process.env.NEWS_ZERO_ALERT_STREAK = raw;
    const dates = ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28'].slice(0, expected.length);
    const r = await days('fetch', 'domestic', dates.map((d) => [d, 0] as [string, number]));
    expect(r.map((x) => x.alerted)).toEqual(expected);
  });

  test('비정상 환경변수(abc)는 기본 3 으로 — 2일째 알림 없음, 3일째 알림', async () => {
    process.env.NEWS_ZERO_ALERT_STREAK = 'abc';
    const r = await days('fetch', 'domestic', [['2026-10-26', 0], ['2026-10-27', 0], ['2026-10-28', 0]]);
    expect(r.map((x) => x.alerted)).toEqual([false, false, true]);
  });

  test('환경변수 1 은 최솟값 2 로 — 1일째 알림 없음', async () => {
    process.env.NEWS_ZERO_ALERT_STREAK = '1';
    const r = await days('fetch', 'domestic', [['2026-10-27', 0], ['2026-10-28', 0]]);
    expect(r.map((x) => x.alerted)).toEqual([false, true]);
  });
});

describe('키 독립', () => {
  test('🔴 시장별 키 독립 — 국내 0 3일이 해외 상태를 건드리지 않는다', async () => {
    await days('fetch', 'domestic', [['2026-10-26', 0], ['2026-10-27', 0]]);
    const ov = await recordNewsOutcome({ channel: 'fetch', market: 'overseas', count: 0, now: kst('2026-10-28') });
    const dm = await recordNewsOutcome({ channel: 'fetch', market: 'domestic', count: 0, now: kst('2026-10-28') });
    expect(ov).toEqual({ streak: 1, alerted: false });
    expect(dm).toEqual({ streak: 3, alerted: true });
    expect(mAlert).toHaveBeenCalledTimes(1);
    expect(mAlert.mock.calls[0][0]).toBe('news-zero:fetch:domestic');
  });

  test('🔴 채널별 키 독립 — 수집 0 이 검색 상태를 건드리지 않는다(반대도)', async () => {
    await days('fetch', 'domestic', [['2026-10-26', 0], ['2026-10-27', 0], ['2026-10-28', 0]]);
    const rt = await recordNewsOutcome({ channel: 'retrieval', market: 'domestic', count: 5, now: kst('2026-10-28') });
    expect(rt.streak).toBe(0);
    expect(stored(FD).streak).toBe(3);
    expect(stored(newsZeroStreakKey('retrieval', 'domestic')).streak).toBe(0);
    expect([...store.keys()].sort()).toEqual(['news_zero_streak:fetch:domestic', 'news_zero_streak:retrieval:domestic']);
  });
});

describe('저장 값 손상·DB 오류 — 절대 던지지 않는다', () => {
  test.each([
    ['JSON 아님', '{not json'],
    ['배열', '[1,2]'],
    ['streak 음수', JSON.stringify({ streak: -1, lastDate: '2026-10-27', lastCount: 0 })],
    ['streak 문자열', JSON.stringify({ streak: '3', lastDate: '2026-10-27', lastCount: 0 })],
    ['날짜 형식 틀림', JSON.stringify({ streak: 2, lastDate: '10/27', lastCount: 0 })],
    ['lastCount 없음', JSON.stringify({ streak: 2, lastDate: '2026-10-27' })],
    ['null', 'null'],
  ])('🔴 손상(%s) → 경고 후 이전 기록 0 으로 보고 새로 센다(덮어쓰기)', async (_n, raw) => {
    store.set(FD, raw);
    const r = await recordNewsOutcome({ channel: 'fetch', market: 'domestic', count: 0, now: kst('2026-10-28') });
    expect(r).toEqual({ streak: 1, alerted: false });
    expect(stored(FD)).toEqual({ streak: 1, lastDate: '2026-10-28', lastCount: 0, lastOkDate: null });
    expect(console.warn).toHaveBeenCalled();
    expect(mAlert).not.toHaveBeenCalled();
  });

  test('mysql2 JSON 컬럼이 객체로 돌려줘도 읽는다(옛 값 lastOkDate 없음 → null)', async () => {
    store.set(FD, { streak: 2, lastDate: '2026-10-27', lastCount: 0 });
    const r = await recordNewsOutcome({ channel: 'fetch', market: 'domestic', count: 0, now: kst('2026-10-28') });
    expect(r).toEqual({ streak: 3, alerted: true });
    expect(mAlert.mock.calls[0][3]).toContain('기록 없음');
  });

  test('🔴 DB 읽기 오류 → {0,false}, 저장·알림 없음, 던지지 않음', async () => {
    query.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(recordNewsOutcome({ channel: 'fetch', market: 'domestic', count: 0, now: kst('2026-10-28') }))
      .resolves.toEqual({ streak: 0, alerted: false });
    expect(query).toHaveBeenCalledTimes(1);
    expect(mAlert).not.toHaveBeenCalled();
  });

  test('🔴 DB 쓰기 오류 → {0,false}, 알림 없음(임계 상황이어도)', async () => {
    store.set(FD, JSON.stringify({ streak: 2, lastDate: '2026-10-27', lastCount: 0, lastOkDate: null }));
    query.mockImplementationOnce(async () => [[{ value: store.get(FD) }], undefined]);
    query.mockRejectedValueOnce(new Error('ER_LOCK_WAIT_TIMEOUT'));
    await expect(recordNewsOutcome({ channel: 'fetch', market: 'domestic', count: 0, now: kst('2026-10-28') }))
      .resolves.toEqual({ streak: 0, alerted: false });
    expect(mAlert).not.toHaveBeenCalled();
  });

  test('getPool() 자체가 던져도(스키마 fail-closed) {0,false}', async () => {
    mGetPool.mockImplementation(() => { throw new Error('schema mismatch'); });
    await expect(recordNewsOutcome({ channel: 'fetch', market: 'domestic', count: 0 })).resolves.toEqual({ streak: 0, alerted: false });
  });

  test('알림 함수가 던져도 {0,false} 로 흡수', async () => {
    mAlert.mockImplementation(() => { throw new Error('slack down'); });
    await days('fetch', 'domestic', [['2026-10-26', 0], ['2026-10-27', 0]]);
    await expect(recordNewsOutcome({ channel: 'fetch', market: 'domestic', count: 0, now: kst('2026-10-28') }))
      .resolves.toEqual({ streak: 0, alerted: false });
  });

  test.each([
    ['NaN', NaN], ['음수', -1], ['Infinity', Infinity], ['문자열', '3' as unknown as number],
  ])('건수가 %s 이면 기록하지 않음(DB 호출 0)', async (_n, count) => {
    await expect(recordNewsOutcome({ channel: 'fetch', market: 'domestic', count })).resolves.toEqual({ streak: 0, alerted: false });
    expect(query).not.toHaveBeenCalled();
  });

  test('알 수 없는 채널·시장은 기록하지 않음(프로토타입 키 포함)', async () => {
    await expect(recordNewsOutcome({ channel: 'toString' as 'fetch', market: 'domestic', count: 0 })).resolves.toEqual({ streak: 0, alerted: false });
    await expect(recordNewsOutcome({ channel: 'fetch', market: 'crypto' as 'domestic', count: 0 })).resolves.toEqual({ streak: 0, alerted: false });
    expect(query).not.toHaveBeenCalled();
  });

  test('소수 건수는 내림(0.5 → 0 으로 센다)', async () => {
    const r = await recordNewsOutcome({ channel: 'fetch', market: 'domestic', count: 0.5, now: kst('2026-10-28') });
    expect(r.streak).toBe(1);
  });
});

describe('검색 채널 호출부 도우미 recordRetrievalNewsOutcome', () => {
  test('🔴 그 시장 뉴스 라벨 오류 실행은 retrieval 을 건드리지 않고 retrieval_error 에만 0 을 기록', async () => {
    const r = await recordRetrievalNewsOutcome('domestic', { errors: ['news.kr_market: circuit open'], recentNews: [] }, kst('2026-10-28'));
    expect(r).toEqual({ reliable: false, retrieval: null, retrievalError: { streak: 1, alerted: false } });
    expect(store.has(newsZeroStreakKey('retrieval', 'domestic'))).toBe(false);
    expect(stored(newsZeroStreakKey('retrieval_error', 'domestic'))).toEqual({ streak: 1, lastDate: '2026-10-28', lastCount: 0, lastOkDate: null });
  });

  test('오류 없음·뉴스 0 → retrieval:<market> 에 0 기록 + retrieval_error 정상(1)', async () => {
    const r = await recordRetrievalNewsOutcome('overseas', { errors: [], recentNews: [] }, kst('2026-10-28'));
    expect(r).toEqual({ reliable: true, retrieval: { streak: 1, alerted: false }, retrievalError: { streak: 0, alerted: false } });
    expect(stored(newsZeroStreakKey('retrieval', 'overseas'))).toMatchObject({ streak: 1, lastCount: 0 });
    expect(stored(newsZeroStreakKey('retrieval_error', 'overseas'))).toMatchObject({ streak: 0, lastCount: 1 });
  });

  test('오류 없음·뉴스 3건 → 3 으로 기록', async () => {
    await recordRetrievalNewsOutcome('domestic', { errors: [], recentNews: [{}, {}, {}] }, kst('2026-10-28'));
    expect(stored(newsZeroStreakKey('retrieval', 'domestic'))).toMatchObject({ streak: 0, lastCount: 3 });
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['errors 없음(부분 객체)', { recentNews: [] }],
    ['recentNews 없음', { errors: [] }],
    ['totalChars 만', { totalChars: 0 } as unknown as { errors?: unknown }],
  ])('형식이 다르면(%s) 아무것도 기록하지 않는다', async (_n, ctx) => {
    await expect(recordRetrievalNewsOutcome('domestic', ctx)).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  test('오류 실행은 뉴스 0건 연속을 끊지도 늘리지도 않는다 — 0, (오류), 0, 0 → 1, -, 2, 3', async () => {
    const seq: Array<[string, { errors: string[]; recentNews: unknown[] }]> = [
      ['2026-10-23', { errors: [], recentNews: [] }],
      ['2026-10-26', { errors: ['boom'], recentNews: [] }],
      ['2026-10-27', { errors: [], recentNews: [] }],
      ['2026-10-28', { errors: [], recentNews: [] }],
    ];
    const out = [];
    for (const [d, ctx] of seq) out.push(await recordRetrievalNewsOutcome('domestic', ctx, kst(d)));
    expect(out.map((x) => x?.retrieval?.streak ?? null)).toEqual([1, null, 2, 3]);
    expect(out[3]?.retrieval?.alerted).toBe(true);
    expect(out.map((x) => x?.retrievalError.streak)).toEqual([0, 1, 0, 0]);
  });
});

describe('순수 함수', () => {
  test('nextNewsZeroState — 이전 없음 >0', () => {
    expect(nextNewsZeroState(null, 4, '2026-10-28')).toEqual({ streak: 0, lastDate: '2026-10-28', lastCount: 4, lastOkDate: '2026-10-28' });
  });
  test('parseNewsZeroState — 정상 문자열', () => {
    expect(parseNewsZeroState('{"streak":2,"lastDate":"2026-10-27","lastCount":0,"lastOkDate":"2026-10-20"}'))
      .toEqual({ streak: 2, lastDate: '2026-10-27', lastCount: 0, lastOkDate: '2026-10-20' });
  });
});

describe('수정 1 — 뉴스 검색 신뢰 판정 isNewsRetrievalReliable', () => {
  test.each([
    ['빈 배열', 'domestic', [], true],
    ['🔴 그 시장 뉴스 라벨 오류(국내)', 'domestic', ['news.kr_market: HTTP 500'], false],
    ['🔴 그 시장 뉴스 라벨 오류(해외)', 'overseas', ['news.us_market: timeout after 4500ms'], false],
    ['🔴 매크로만 → 센다', 'domestic', ['news.macro: HTTP 503'], true],
    ['🔴 시그널만 → 센다', 'overseas', ['signals.stockinvest: collection not found'], true],
    ['시그널(코인 라벨)만 → 센다', 'domestic', ['signals.tradinginvest: boom'], true],
    ['시그널+매크로 → 센다', 'domestic', ['signals.stockinvest: x', 'news.macro: y'], true],
    ['🔴 뉴스+매크로 혼합 → 안 센다', 'domestic', ['news.macro: y', 'news.kr_market: z'], false],
    ['🔴 시장 교차(해외인데 국내 뉴스 라벨 오류만) → 센다', 'overseas', ['news.kr_market: boom'], true],
    ['시장 교차(국내인데 해외 뉴스 라벨 오류만) → 센다', 'domestic', ['news.us_market: boom'], true],
    ['🔴 전역 — 서킷 차단(getKbClient 실제 문구, m4-kb.ts)', 'domestic', ['KB circuit breaker open — M4 unreachable'], false],
    ['🔴 전역 — 전체 타임아웃', 'overseas', ['RAG retrieval timeout 5000ms'], false],
    ['🔴 전역 — 라벨 없는 클라이언트 오류', 'domestic', ['AI_API_KEY not configured'], false],
    ['전역 + 매크로', 'domestic', ['news.macro: y', 'KB circuit breaker open — M4 unreachable'], false],
    ['라벨 비슷하지만 콜론·공백 없음 → 전역 취급', 'domestic', ['news.macro failed'], false],
    ['모르는 컬렉션 라벨 → 전역 취급(안전한 쪽)', 'domestic', ['signals.custom: boom'], false],
    ['🔴 문자열이 아닌 원소 → 안 센다', 'domestic', [new Error('x')], false],
    ['null 원소 → 안 센다', 'overseas', [null], false],
  ] as Array<[string, 'domestic' | 'overseas', unknown[], boolean]>)('%s', (_n, market, errors, expected) => {
    expect(isNewsRetrievalReliable(market, errors)).toBe(expected);
  });

  test('🔴 recordRetrievalNewsOutcome — 매크로·시그널 오류만 있으면 센다(감시가 꺼지지 않는다)', async () => {
    const r1 = await recordRetrievalNewsOutcome('domestic', { errors: ['news.macro: HTTP 503'], recentNews: [] }, kst('2026-10-27'));
    const r2 = await recordRetrievalNewsOutcome('domestic', { errors: ['signals.stockinvest: boom'], recentNews: [] }, kst('2026-10-28'));
    expect(r1?.retrieval).toEqual({ streak: 1, alerted: false });
    expect(r2?.retrieval).toEqual({ streak: 2, alerted: false });
    expect(r2?.reliable).toBe(true);
  });

  test('🔴 recordRetrievalNewsOutcome — 그 시장 뉴스 라벨·전역 오류는 retrieval 에 세지 않는다(retrieval_error 로만)', async () => {
    const a = await recordRetrievalNewsOutcome('overseas', { errors: ['news.us_market: 500'], recentNews: [] }, kst('2026-10-27'));
    const b = await recordRetrievalNewsOutcome('overseas', { errors: ['RAG retrieval timeout 5000ms'], recentNews: [] }, kst('2026-10-28'));
    expect(a?.reliable).toBe(false);
    expect(b?.retrievalError.streak).toBe(2);
    expect(store.has(newsZeroStreakKey('retrieval', 'overseas'))).toBe(false);
  });
});

describe('수정 2 — 관측 공백 상한 NEWS_ZERO_MAX_GAP_DAYS', () => {
  const prev = (streak: number, lastDate: string, lastCount = 0, lastOkDate: string | null = '2026-09-20') =>
    ({ streak, lastDate, lastCount, lastOkDate });

  test('상수 7', () => expect(NEWS_ZERO_MAX_GAP_DAYS).toBe(7));

  test.each([
    ['월 경계', '2026-09-30', '2026-10-01', 1],
    ['연 경계', '2026-12-31', '2027-01-01', 1],
    ['윤년 2월 28→29', '2028-02-28', '2028-02-29', 1],
    ['윤년 2월 29→3월 1', '2028-02-29', '2028-03-01', 1],
    ['평년 2월 28→3월 1', '2027-02-28', '2027-03-01', 1],
    ['연 경계 7일', '2026-12-28', '2027-01-04', 7],
    ['역행', '2026-10-28', '2026-10-27', -1],
    ['문자열 비교로는 틀리는 경우(자리수 같아도 산술)', '2026-09-29', '2026-10-07', 8],
  ])('calendarDaysBetween %s', (_n, a, b, expected) => {
    expect(calendarDaysBetween(a, b)).toBe(expected);
  });

  test('calendarDaysBetween — 실재하지 않는 날짜는 null', () => {
    expect(calendarDaysBetween('2027-02-29', '2027-03-01')).toBeNull();
    expect(calendarDaysBetween('2026-10-01', '2026-13-01')).toBeNull();
  });

  test('🔴 7일 간격은 이어 센다(0 → streak+1)', () => {
    expect(nextNewsZeroState(prev(2, '2026-10-21'), 0, '2026-10-28').streak).toBe(3);
  });

  test('🔴 8일 간격은 새로 시작(0 → 1, lastOkDate 보존)', () => {
    expect(nextNewsZeroState(prev(2, '2026-10-20'), 0, '2026-10-28'))
      .toEqual({ streak: 1, lastDate: '2026-10-28', lastCount: 0, lastOkDate: '2026-09-20' });
  });

  test('8일 간격 + 오늘 >0 → 0, lastOkDate 오늘', () => {
    expect(nextNewsZeroState(prev(5, '2026-10-20'), 3, '2026-10-28'))
      .toEqual({ streak: 0, lastDate: '2026-10-28', lastCount: 3, lastOkDate: '2026-10-28' });
  });

  test('🔴 지휘자 예시 — 10-01 streak 2 로 멈춘 뒤 10-28 첫 관측 0 → streak 1, 알림 없음', async () => {
    store.set(FD, JSON.stringify(prev(2, '2026-10-01')));
    const r = await recordNewsOutcome({ channel: 'fetch', market: 'domestic', count: 0, now: kst('2026-10-28') });
    expect(r).toEqual({ streak: 1, alerted: false });
    expect(mAlert).not.toHaveBeenCalled();
    expect(stored(FD).lastOkDate).toBe('2026-09-20');
  });

  test('연 경계 7일 간격은 이어 센다(12-28 → 01-04)', () => {
    expect(nextNewsZeroState(prev(2, '2026-12-28'), 0, '2027-01-04').streak).toBe(3);
  });

  test('윤년 2월 — 2028-02-22 → 2028-02-29(7일) 이어 세고, 2028-02-21 → 2028-02-29(8일) 새로 시작', () => {
    expect(nextNewsZeroState(prev(2, '2028-02-22'), 0, '2028-02-29').streak).toBe(3);
    expect(nextNewsZeroState(prev(2, '2028-02-21'), 0, '2028-02-29').streak).toBe(1);
    expect(nextNewsZeroState(prev(2, '2028-02-23'), 0, '2028-03-01').streak).toBe(3);
  });

  test('🔴 날짜 역행(시계 이상) → 이전 연속 유지·증가 없이 새로 시작(0 → 1), 경고, 알림 없음', async () => {
    store.set(FD, JSON.stringify(prev(5, '2026-10-28')));
    const r = await recordNewsOutcome({ channel: 'fetch', market: 'domestic', count: 0, now: kst('2026-10-27') });
    expect(r).toEqual({ streak: 1, alerted: false });
    expect(stored(FD)).toEqual({ streak: 1, lastDate: '2026-10-27', lastCount: 0, lastOkDate: '2026-09-20' });
    expect(mAlert).not.toHaveBeenCalled();
    expect((console.warn as jest.Mock).mock.calls.some((c) => String(c[0]).includes('날짜 역행'))).toBe(true);
  });

  test('날짜 역행 + >0 → 0', () => {
    expect(nextNewsZeroState(prev(5, '2026-10-28'), 2, '2026-10-20').streak).toBe(0);
  });

  test('역행 뒤 시계가 바로잡혀도 가짜 연속이 생기지 않는다 — 10-28(5) → 10-27(역행, 1) → 10-29(2일 뒤, 2)', async () => {
    store.set(FD, JSON.stringify(prev(5, '2026-10-28')));
    await recordNewsOutcome({ channel: 'fetch', market: 'domestic', count: 0, now: kst('2026-10-27') });
    const r = await recordNewsOutcome({ channel: 'fetch', market: 'domestic', count: 0, now: kst('2026-10-29') });
    expect(r).toEqual({ streak: 2, alerted: false });
  });

  test('저장 값의 실재하지 않는 날짜(2026-02-30)는 손상으로 본다', async () => {
    store.set(FD, JSON.stringify({ streak: 2, lastDate: '2026-02-30', lastCount: 0 }));
    const r = await recordNewsOutcome({ channel: 'fetch', market: 'domestic', count: 0, now: kst('2026-10-28') });
    expect(r.streak).toBe(1);
  });
});

describe('M-1 — 기록 1건 대기 상한 NEWS_HEALTH_TIMEOUT_MS', () => {
  afterEach(() => { jest.useRealTimers(); });

  test('상수 4000', () => expect(NEWS_HEALTH_TIMEOUT_MS).toBe(4000));

  test('🔴 DB 가 영원히 끝나지 않으면 4초 뒤 {0,false} 로 돌아온다(그 전에는 대기)', async () => {
    jest.useFakeTimers();
    query.mockImplementation(() => new Promise(() => {}));
    let settled: unknown = 'pending';
    const p = recordNewsOutcome({ channel: 'fetch', market: 'domestic', count: 0, now: kst('2026-10-28') }).then((v) => { settled = v; return v; });
    await jest.advanceTimersByTimeAsync(NEWS_HEALTH_TIMEOUT_MS - 1);
    expect(settled).toBe('pending');
    await jest.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toEqual({ streak: 0, alerted: false });
    expect(mAlert).not.toHaveBeenCalled();
    expect((console.warn as jest.Mock).mock.calls.some((c) => String(c[0]).includes('4000ms'))).toBe(true);
  });

  test('🔴 recordRetrievalNewsOutcome 도 두 기록이 병렬이라 전체 4초 안에 돌아온다', async () => {
    jest.useFakeTimers();
    query.mockImplementation(() => new Promise(() => {}));
    const p = recordRetrievalNewsOutcome('domestic', { errors: [], recentNews: [] }, kst('2026-10-28'));
    await jest.advanceTimersByTimeAsync(NEWS_HEALTH_TIMEOUT_MS);
    await expect(p).resolves.toEqual({ reliable: true, retrieval: { streak: 0, alerted: false }, retrievalError: { streak: 0, alerted: false } });
  });

  test('🔴 정상 완료하면 상한 타이머를 해제한다(남은 타이머 0)', async () => {
    jest.useFakeTimers();
    const r = await recordNewsOutcome({ channel: 'fetch', market: 'domestic', count: 0, now: kst('2026-10-28') });
    expect(r).toEqual({ streak: 1, alerted: false });
    expect(jest.getTimerCount()).toBe(0);
  });

  test('지연이 상한 안(3초)이면 정상 결과', async () => {
    jest.useFakeTimers();
    const inner = query.getMockImplementation()!;
    query.mockImplementation((sql: string, params: unknown[]) =>
      new Promise((resolve, reject) => setTimeout(() => { inner(sql, params).then(resolve, reject); }, 1500)));
    const p = recordNewsOutcome({ channel: 'fetch', market: 'domestic', count: 0, now: kst('2026-10-28') });
    await jest.advanceTimersByTimeAsync(3000);   // 읽기 1.5초 + 쓰기 1.5초
    await expect(p).resolves.toEqual({ streak: 1, alerted: false });
    expect(jest.getTimerCount()).toBe(0);
  });

  test('🔴 상한 뒤 늦게 실패하는 본문(로그까지 던지는 최악)도 처리되지 않은 거부를 만들지 않는다', async () => {
    jest.useFakeTimers();
    const unhandled: unknown[] = [];
    const onUnhandled = (r: unknown) => { unhandled.push(r); };
    process.on('unhandledRejection', onUnhandled);
    try {
      let rejectLate!: (e: Error) => void;
      query.mockImplementation(() => new Promise((_res, rej) => { rejectLate = rej; }));
      const p = recordNewsOutcome({ channel: 'fetch', market: 'domestic', count: 0, now: kst('2026-10-28') });
      await jest.advanceTimersByTimeAsync(NEWS_HEALTH_TIMEOUT_MS);
      await expect(p).resolves.toEqual({ streak: 0, alerted: false });
      (console.warn as jest.Mock).mockImplementation(() => { throw new Error('log down'); });
      rejectLate(new Error('late db error'));
      jest.useRealTimers();
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('M-2 — 검색 오류 채널 retrieval_error', () => {
  const RE = newsZeroStreakKey('retrieval_error', 'domestic');
  const R = newsZeroStreakKey('retrieval', 'domestic');
  const bad = { errors: ['news.kr_market: KB search HTTP 401: invalid key'], recentNews: [] };
  const ok = (n: number) => ({ errors: [], recentNews: Array.from({ length: n }, () => ({})) });

  test('키 이름', () => {
    expect(RE).toBe('news_zero_streak:retrieval_error:domestic');
    expect(newsZeroStreakKey('retrieval_error', 'overseas').length).toBeLessThanOrEqual(64);
  });

  test('🔴 불신뢰 실행 → retrieval_error 만 증가, retrieval 불변', async () => {
    store.set(R, JSON.stringify({ streak: 1, lastDate: '2026-10-26', lastCount: 0, lastOkDate: null }));
    await recordRetrievalNewsOutcome('domestic', bad, kst('2026-10-27'));
    await recordRetrievalNewsOutcome('domestic', bad, kst('2026-10-28'));
    expect(stored(RE).streak).toBe(2);
    expect(stored(R)).toEqual({ streak: 1, lastDate: '2026-10-26', lastCount: 0, lastOkDate: null });
  });

  test('🔴 신뢰 실행 → retrieval 기록 + retrieval_error 초기화', async () => {
    store.set(RE, JSON.stringify({ streak: 2, lastDate: '2026-10-27', lastCount: 0, lastOkDate: '2026-10-20' }));
    const r = await recordRetrievalNewsOutcome('domestic', ok(4), kst('2026-10-28'));
    expect(r?.retrievalError).toEqual({ streak: 0, alerted: false });
    expect(stored(RE)).toEqual({ streak: 0, lastDate: '2026-10-28', lastCount: 1, lastOkDate: '2026-10-28' });
    expect(stored(R)).toMatchObject({ streak: 0, lastCount: 4 });
  });

  test('🔴 3일 연속 불신뢰 → news-zero:retrieval_error:domestic warning 알림, 제목·본문', async () => {
    await recordRetrievalNewsOutcome('domestic', ok(2), kst('2026-10-23'));
    const out = [];
    for (const d of ['2026-10-26', '2026-10-27', '2026-10-28']) out.push(await recordRetrievalNewsOutcome('domestic', bad, kst(d)));
    expect(out.map((x) => x?.retrievalError.alerted)).toEqual([false, false, true]);
    expect(mAlert).toHaveBeenCalledTimes(1);
    const [key, level, title, body, ttl] = mAlert.mock.calls[0];
    expect(key).toBe('news-zero:retrieval_error:domestic');
    expect(level).toBe('warning');
    expect(ttl).toBe(NEWS_ZERO_ALERT_TTL_MS);
    expect(title).toBe('뉴스 검색 오류 3일 연속 — 국내 분석 검색');
    expect(body).toContain('분석 검색 오류');
    expect(body).toContain('국내(domestic)');
    expect(body).toContain('연속 검색 오류: 3일');
    expect(body).toContain('마지막 정상일: 2026-10-23');
    for (const cause of ['M4 장애·연결', 'API 키 재발급(401)', '컬렉션 삭제·이름 변경', '5초 제한 초과']) expect(body).toContain(cause);
    expect(body).toContain('agent-vault/10-Flow/tasks/T-105-news-rag-zero-hits.md');
    expect(body).not.toContain('연속 0건');
  });

  test('🔴 같은 날 불신뢰 → 신뢰 전환 시 초기화', async () => {
    store.set(RE, JSON.stringify({ streak: 2, lastDate: '2026-10-27', lastCount: 0, lastOkDate: null }));
    const a = await recordRetrievalNewsOutcome('domestic', bad, kst('2026-10-28', '16:00'));
    expect(a?.retrievalError.streak).toBe(3);
    const b = await recordRetrievalNewsOutcome('domestic', ok(1), kst('2026-10-28', '16:30'));
    expect(b?.retrievalError.streak).toBe(0);
  });

  test('불신뢰는 아니고 뉴스 0건인 날 → retrieval 만 증가, retrieval_error 는 0', async () => {
    for (const d of ['2026-10-26', '2026-10-27']) await recordRetrievalNewsOutcome('domestic', ok(0), kst(d));
    expect(stored(R).streak).toBe(2);
    expect(stored(RE).streak).toBe(0);
  });

  test('시장 키 독립 — 국내 불신뢰가 해외 retrieval_error 를 건드리지 않는다', async () => {
    await recordRetrievalNewsOutcome('domestic', bad, kst('2026-10-28'));
    expect(store.has(newsZeroStreakKey('retrieval_error', 'overseas'))).toBe(false);
    await recordRetrievalNewsOutcome('overseas', bad, kst('2026-10-28'));   // 해외인데 국내 뉴스 라벨 → 해외는 신뢰
    expect(stored(newsZeroStreakKey('retrieval_error', 'overseas')).streak).toBe(0);
    expect(stored(RE).streak).toBe(1);
  });

  test('채널 키 독립 — fetch·retrieval 상태와 섞이지 않는다', async () => {
    await days('fetch', 'domestic', [['2026-10-27', 0], ['2026-10-28', 0]]);
    await recordRetrievalNewsOutcome('domestic', bad, kst('2026-10-28'));
    expect(stored(FD).streak).toBe(2);
    expect(stored(RE).streak).toBe(1);
    expect([...store.keys()].sort()).toEqual(['news_zero_streak:fetch:domestic', 'news_zero_streak:retrieval_error:domestic']);
  });

  test('🔴 DB 오류는 삼킨다 — 두 채널 모두 {0,false}, 던지지 않음', async () => {
    query.mockRejectedValue(new Error('ECONNRESET'));
    await expect(recordRetrievalNewsOutcome('domestic', ok(0), kst('2026-10-28')))
      .resolves.toEqual({ reliable: true, retrieval: { streak: 0, alerted: false }, retrievalError: { streak: 0, alerted: false } });
    await expect(recordRetrievalNewsOutcome('domestic', bad, kst('2026-10-28')))
      .resolves.toEqual({ reliable: false, retrieval: null, retrievalError: { streak: 0, alerted: false } });
  });

  test('recordNewsOutcome 이 retrieval_error 채널을 직접 받아도 동작', async () => {
    const r = await recordNewsOutcome({ channel: 'retrieval_error', market: 'overseas', count: 0, now: kst('2026-10-28') });
    expect(r).toEqual({ streak: 1, alerted: false });
  });

  test('LOW L-3 — retrieval(뉴스 0건) 알림 본문에 점수 임계 원인 안내', async () => {
    for (const d of ['2026-10-26', '2026-10-27', '2026-10-28']) await recordRetrievalNewsOutcome('domestic', ok(0), kst(d));
    const call = mAlert.mock.calls.find((c) => c[0] === 'news-zero:retrieval:domestic')!;
    expect(call[2]).toBe('뉴스 0건 3일 연속 — 국내 분석 검색');
    expect(call[3]).toContain('검색 유사도 점수 임계(0.5) 미달로 전부 제외됐거나(로그 `droppedByScore`)');
    expect(call[3]).toContain('원천 피드 정지');
  });

  test('fetch 알림 본문에는 점수 임계 안내가 없다', async () => {
    await days('fetch', 'domestic', [['2026-10-26', 0], ['2026-10-27', 0], ['2026-10-28', 0]]);
    expect(mAlert.mock.calls[0][3]).not.toContain('droppedByScore');
  });
});
