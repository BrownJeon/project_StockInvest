/**
 * T-143 W-1 — 자동 산출 주기 설정·다음 예정 시각 (Analyst WP-A 설계 교차 확인 2026-11-01).
 *
 * 🔴 지키는 것: **매월 1일 02시 KST 를 쓰지 않는다.** 그 시각은 평일이면 미국 정규장(KST 23:30~06:00) 한가운데이고
 * KIS 유량이 가장 빡빡해, 산출이 길어지면 종목마다 다른 시각의 가격으로 순위를 매기게 된다.
 * 기본값은 **그 달 첫째 일요일 01:10~05:50 KST** 이고 `enabled` 는 꺼짐이다(새 기능 = 꺼짐).
 *
 * `nextAutoRefreshAt` 은 보류 해제 시각(`held_until`)도 만든다 — `enabled` 가 꺼져 있어도 날짜는 예정표대로 나와야
 * 보류가 영구히 숨겨지지 않는다(「공시가 갱신되면 그때 다시 올라옵니다」가 거짓이 되지 않게).
 */
jest.mock('@/lib/db', () => ({ getPool: jest.fn(() => { throw new Error('pool not available in test'); }) }));

import {
  AUTO_REFRESH_DEFAULT, nextAutoRefreshAt, nthWeekdayOfMonth, parseHhmm, readAutoRefreshConfig, type Queryable,
} from '../store';

const kst = (s: string) => Date.parse(`${s.replace(' ', 'T')}+09:00`);

/** `system_config` 한 줄을 돌려주는 대역. `value=undefined` 면 키가 없는 상태. */
function db(value?: unknown): Queryable {
  return {
    async query<T>(sql: string): Promise<[T, unknown]> {
      if (sql.includes('system_config')) {
        return [(value === undefined ? [] : [{ value }]) as unknown as T, undefined];
      }
      return [[] as unknown as T, undefined];
    },
  };
}

describe('기본값 (W-1)', () => {
  it('🔴 매월 1일 02시가 아니다 — 첫째 일요일 01:10~05:50, 산출은 기본 꺼짐', () => {
    expect(AUTO_REFRESH_DEFAULT).toEqual({
      enabled: false, topN: 50, weekday: 0, nth: 1, windowStart: '01:10', windowEnd: '05:50', excludeDr: true,
    });
    // 옛 모양의 키는 남아 있지 않다
    expect(AUTO_REFRESH_DEFAULT).not.toHaveProperty('monthDay');
    expect(AUTO_REFRESH_DEFAULT).not.toHaveProperty('hourKst');
  });
  it('창이 미국 정규장(KST 23:30~06:00) 안이지만 **일요일**이라 휴장이다 — 평일 장중을 피한 근거', () => {
    // 창 자체는 00~06시 사이다. 평일이면 장중이므로 요일 조건(일요일)이 그 위험을 없앤다
    expect(AUTO_REFRESH_DEFAULT.weekday).toBe(0);
    expect(AUTO_REFRESH_DEFAULT.windowStart < AUTO_REFRESH_DEFAULT.windowEnd).toBe(true);
  });
});

describe('readAutoRefreshConfig — 던지지 않는다', () => {
  it('키가 없으면 기본값', async () => {
    expect(await readAutoRefreshConfig(db())).toEqual(AUTO_REFRESH_DEFAULT);
  });
  it('조회가 실패해도 기본값(안전장치가 아니라 표시·예정 계산용이다)', async () => {
    const boom: Queryable = { async query<T>(): Promise<[T, unknown]> { throw new Error('db down'); } };
    expect(await readAutoRefreshConfig(boom)).toEqual(AUTO_REFRESH_DEFAULT);
  });
  it('비-JSON 값(손으로 넣은 것)도 기본값으로 떨어진다', async () => {
    expect(await readAutoRefreshConfig(db('on'))).toEqual(AUTO_REFRESH_DEFAULT);
  });
  it('JSON 을 읽어 반영한다', async () => {
    const cfg = await readAutoRefreshConfig(db(JSON.stringify({
      enabled: true, topN: 30, weekday: 6, nth: 2, windowStart: '02:00', windowEnd: '04:30', excludeDr: false,
    })));
    expect(cfg).toEqual({ enabled: true, topN: 30, weekday: 6, nth: 2, windowStart: '02:00', windowEnd: '04:30', excludeDr: false });
  });
  it('🔴 enabled 는 **정확히 true** 일 때만 켜짐 — 키 없음·"true" 문자열·1 은 꺼짐', async () => {
    for (const v of [undefined, 'true', 1, 'on', null]) {
      const cfg = await readAutoRefreshConfig(db(JSON.stringify({ enabled: v })));
      expect(cfg.enabled).toBe(false);
    }
    expect((await readAutoRefreshConfig(db(JSON.stringify({ enabled: true })))).enabled).toBe(true);
  });
  it('범위 밖·형식 오류는 기본값으로 — 설정 실수로 예정 시각이 엉뚱해지지 않게', async () => {
    const cfg = await readAutoRefreshConfig(db(JSON.stringify({
      topN: 0, weekday: 9, nth: 0, windowStart: '25:00', windowEnd: 'x',
    })));
    expect(cfg.topN).toBe(50);
    expect(cfg.weekday).toBe(0);
    expect(cfg.nth).toBe(1);
    expect(cfg.windowStart).toBe('01:10');
    expect(cfg.windowEnd).toBe('05:50');
  });
  it('excludeDr 은 **명시적 false** 일 때만 끈다(기본 제외)', async () => {
    expect((await readAutoRefreshConfig(db(JSON.stringify({})))).excludeDr).toBe(true);
    expect((await readAutoRefreshConfig(db(JSON.stringify({ excludeDr: false })))).excludeDr).toBe(false);
    expect((await readAutoRefreshConfig(db(JSON.stringify({ excludeDr: 'no' })))).excludeDr).toBe(true);
  });
  it('parseHhmm — 24시 형식만', () => {
    for (const ok of ['00:00', '01:10', '23:59']) expect(parseHhmm(ok, '09:00')).toBe(ok);
    for (const bad of ['24:00', '1:10', '01:60', '0110', '', null, 7]) expect(parseHhmm(bad, '09:00')).toBe('09:00');
  });
});

describe('nthWeekdayOfMonth', () => {
  it('2026-12 의 첫째 일요일은 6일', () => {
    expect(nthWeekdayOfMonth(2026, 11, 0, 1)).toBe(6);
  });
  it('2027-01 의 첫째 일요일은 3일', () => {
    expect(nthWeekdayOfMonth(2027, 0, 0, 1)).toBe(3);
  });
  it('1일이 그 요일이면 1일이다(2026-11-01 은 일요일)', () => {
    expect(nthWeekdayOfMonth(2026, 10, 0, 1)).toBe(1);
  });
  it('그 달에 없는 차수는 null (2026-11 의 다섯째 일요일 = 29일, 여섯째는 없다)', () => {
    expect(nthWeekdayOfMonth(2026, 10, 0, 5)).toBe(29);
    expect(nthWeekdayOfMonth(2026, 11, 0, 5)).toBeNull();   // 2026-12 의 일요일은 6·13·20·27 넷뿐
  });
});

describe('nextAutoRefreshAt', () => {
  const cfg = { ...AUTO_REFRESH_DEFAULT };

  it('🔴 그 달 첫째 일요일 01:10 KST 를 돌려준다', () => {
    expect(nextAutoRefreshAt(kst('2026-11-20 10:00:00'), cfg)).toBe('2026-12-06T01:10:00+09:00');
  });
  it('이미 지났으면 다음 달로 넘어간다(같은 시각도 지난 것으로 본다)', () => {
    expect(nextAutoRefreshAt(kst('2026-12-06 01:10:00'), cfg)).toBe('2027-01-03T01:10:00+09:00');
    expect(nextAutoRefreshAt(kst('2026-12-06 01:09:59'), cfg)).toBe('2026-12-06T01:10:00+09:00');
  });
  it('연말을 넘어간다', () => {
    expect(nextAutoRefreshAt(kst('2026-12-28 00:00:00'), cfg)).toBe('2027-01-03T01:10:00+09:00');
  });
  it('그 달에 차수가 없으면 다음 달에서 찾는다(다섯째 일요일)', () => {
    const c5 = { ...cfg, nth: 5 };
    // 2026-12 에는 다섯째 일요일이 없다 → 2027-01-31
    expect(nextAutoRefreshAt(kst('2026-12-01 00:00:00'), c5)).toBe('2027-01-31T01:10:00+09:00');
  });
  it('요일·창 설정을 따른다', () => {
    expect(nextAutoRefreshAt(kst('2026-11-20 10:00:00'), { ...cfg, weekday: 6, nth: 2, windowStart: '03:30' }))
      .toBe('2026-12-12T03:30:00+09:00');
  });
  it('🔴 enabled 가 꺼져 있어도 날짜를 돌려준다 — 보류가 영구히 숨겨지지 않게', () => {
    expect(nextAutoRefreshAt(kst('2026-11-20 10:00:00'), { ...cfg, enabled: false }))
      .toBe('2026-12-06T01:10:00+09:00');
  });
  it('돌려주는 값은 늘 기준 시각보다 뒤다(12개월 연속 확인)', () => {
    let t = kst('2026-01-01 00:00:00');
    for (let i = 0; i < 12; i += 1) {
      const next = nextAutoRefreshAt(t, cfg);
      const ms = Date.parse(next);
      expect(ms).toBeGreaterThan(t);
      expect(next.slice(11, 16)).toBe('01:10');
      // 그 날짜가 실제로 일요일인가 — KST 벽시계 기준
      expect(new Date(Date.parse(`${next.slice(0, 10)}T00:00:00Z`)).getUTCDay()).toBe(0);
      t = ms;
    }
  });
});
