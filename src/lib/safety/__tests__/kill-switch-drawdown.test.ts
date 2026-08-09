/**
 * T-012 — 24h drawdown Kill Switch 가 **믿을 수 없는 숫자로 판단하지 않는다.**
 *
 * 이 검사는 두 개의 스냅샷 값을 비교한다. 둘 중 하나라도 실제로 그 시각의 관측이 아니면
 * 결과는 무의미하고, 무의미한 결과는 **양방향으로 위험**하다:
 *
 *  - 기준선이 잘못 최근 값이면 → 24시간 -15% 폭락 중에도 손실률이 ~0% 로 계산돼
 *    킬스위치가 **가장 필요한 순간에 침묵**한다.
 *  - 현재값이 낡았으면 → 정지 직전 값끼리 비교해 역시 폭락을 놓친다.
 *
 * 그래서 "애매하면 계산하지 않고 건너뛴다. 단 조용히 건너뛰지는 않는다"가 이 파일의 계약이다.
 */
const sendAlert = jest.fn();
const sendAlertThrottled = jest.fn();
const checkSnapshotFreshness = jest.fn();

jest.mock('@/lib/notify', () => ({ sendAlert: (...a: unknown[]) => sendAlert(...a) }));
jest.mock('@/lib/notify/throttle', () => ({
  sendAlertThrottled: (...a: unknown[]) => sendAlertThrottled(...a),
  resetAlertThrottle: () => {},
}));
jest.mock('@/lib/safety/volatility-guard', () => ({
  checkSnapshotFreshness: (...a: unknown[]) => checkSnapshotFreshness(...a),
}));

const query = jest.fn();
jest.mock('@/lib/db', () => ({ getPool: () => ({ query: (...a: unknown[]) => query(...a) }) }));

import { checkAndTriggerDrawdownKillSwitch } from '@/lib/safety/kill-switch';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** 기본 상태 — 킬스위치 비활성, 스냅샷 신선, 24h 기준선 존재. */
function mockState(opts: {
  killSwitch?: boolean;
  freshAgeMs?: number | null;
  session?: 'open' | 'closed' | 'unknown';
  /** 24h±60분 창 조회 결과. null = 창이 비어 있음 */
  baseline?: number | null;
  current?: number | null;
} = {}) {
  const {
    killSwitch = false,
    freshAgeMs = 5 * MIN,
    session = 'open',
    baseline = 10_000_000,
    current = 10_000_000,
  } = opts;

  checkSnapshotFreshness.mockResolvedValue(
    freshAgeMs == null
      ? { latestTs: null, ageMs: null, level: 'unknown', session, effectiveAgeMs: null }
      : {
          latestTs: new Date(Date.now() - freshAgeMs),
          ageMs: freshAgeMs,
          level: 'ok',
          session,
          effectiveAgeMs: freshAgeMs,
        },
  );

  query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    // 킬스위치 조회는 키가 **파라미터**에 있다 (SQL 문자열이 아니라)
    if (/SELECT value FROM system_config/.test(sql) && params[0] === 'safety_kill_switch') {
      return [[{ value: JSON.stringify(killSwitch) }]];
    }
    if (/INSERT INTO system_config/.test(sql)) return [{ affectedRows: 1 }];
    if (/ORDER BY ABS\(TIMESTAMPDIFF/.test(sql)) {
      return [baseline == null ? [] : [{ total_krw: baseline, ts: new Date(Date.now() - 24 * HOUR) }]];
    }
    if (/ORDER BY ts DESC/.test(sql)) {
      return [current == null ? [] : [{ total_krw: current }]];
    }
    return [[]];
  });
}

/** 기준선 조회에 실제로 쓰인 SQL */
const baselineSql = (): string =>
  String(query.mock.calls.find(c => /ORDER BY ABS\(TIMESTAMPDIFF/.test(String(c[0])))?.[0] ?? '');

const insertedKillSwitch = () =>
  query.mock.calls.filter(c => /INSERT INTO system_config/.test(String(c[0])));

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.KILL_SWITCH;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('정상 경로 — 회귀 방어', () => {
  test('손실이 임계 미만이면 발동하지 않는다', async () => {
    mockState({ baseline: 10_000_000, current: 9_500_000 });   // -5%
    const r = await checkAndTriggerDrawdownKillSwitch(10);
    expect(r).toEqual({ status: 'evaluated', drawdownPct: -5, triggered: false });
    expect(insertedKillSwitch()).toHaveLength(0);
  });

  test('🔴 24h -15% 면 발동하고 critical 알림을 보낸다', async () => {
    mockState({ baseline: 10_000_000, current: 8_500_000 });
    const r = await checkAndTriggerDrawdownKillSwitch(10);
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
    expect(insertedKillSwitch()).toHaveLength(1);
    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(sendAlert.mock.calls[0][0]).toBe('critical');
  });

  test('이미 활성이면 재발동하지 않는다', async () => {
    mockState({ killSwitch: true });
    const r = await checkAndTriggerDrawdownKillSwitch();
    expect(r).toEqual({ status: 'skipped', reason: 'already_active' });
    expect(checkSnapshotFreshness).not.toHaveBeenCalled();
  });
});

describe('🔴 낡은 현재값으로 drawdown 을 계산하지 않는다', () => {
  test('현재 스냅샷이 3시간 넘게 낡으면 계산을 건너뛴다', async () => {
    mockState({ freshAgeMs: 4 * HOUR, baseline: 10_000_000, current: 10_000_000 });
    const r = await checkAndTriggerDrawdownKillSwitch();
    expect(r).toMatchObject({ status: 'skipped', reason: 'snapshot_stale' });
    // 기준선 조회까지 가지 않는다 — 믿을 수 없는 값이면 비교 자체를 하지 않는다
    expect(baselineSql()).toBe('');
    expect(insertedKillSwitch()).toHaveLength(0);
  });

  test('🔴 건너뛰기가 조용하지 않다 — 알림이 나가고 "발동하지 않는다"고 명시한다', async () => {
    mockState({ freshAgeMs: 4 * HOUR });
    await checkAndTriggerDrawdownKillSwitch();
    expect(sendAlertThrottled).toHaveBeenCalledTimes(1);
    const [key, level, title, body] = sendAlertThrottled.mock.calls[0];
    expect(String(key)).toContain('stale');
    expect(level).toBe('critical');            // 장중이면 critical
    expect(String(title)).toContain('생략');
    expect(String(body)).toContain('동작하지 않습니다');
  });

  test('폐장 중이면 같은 상황도 warning 으로 낮춘다 (경보 피로 방지)', async () => {
    mockState({ freshAgeMs: 4 * HOUR, session: 'closed' });
    await checkAndTriggerDrawdownKillSwitch();
    expect(sendAlertThrottled.mock.calls[0][1]).toBe('warning');
  });

  test('3시간 이내면 정상 계산한다 (임계를 과하게 좁히지 않았다)', async () => {
    mockState({ freshAgeMs: 2 * HOUR, baseline: 10_000_000, current: 8_000_000 });
    const r = await checkAndTriggerDrawdownKillSwitch(10);
    expect(r).toMatchObject({ status: 'evaluated', triggered: true });
  });

  test('스냅샷이 한 건도 없으면 건너뛴다', async () => {
    mockState({ freshAgeMs: null });
    const r = await checkAndTriggerDrawdownKillSwitch();
    expect(r).toEqual({ status: 'skipped', reason: 'snapshot_missing' });
  });

  test('신선도 판단은 세션 인식 level 이 아니라 원시 나이로 한다', async () => {
    // 폐장 중이라 level='ok' 로 보고돼도, 원시 나이가 3시간을 넘으면 믿지 않는다.
    checkSnapshotFreshness.mockResolvedValue({
      latestTs: new Date(Date.now() - 10 * HOUR),
      ageMs: 10 * HOUR,
      level: 'ok',                 // ← 폐장 중이라 경보 레벨은 ok
      session: 'closed',
      effectiveAgeMs: 10 * HOUR,
    });
    query.mockImplementation(async (sql: string) => {
      if (/SELECT value FROM system_config/.test(sql)) return [[{ value: 'false' }]];
      return [[]];
    });
    const r = await checkAndTriggerDrawdownKillSwitch();
    expect(r).toMatchObject({ status: 'skipped', reason: 'snapshot_stale' });
  });
});

describe('🔴 최근 스냅샷이 "24시간 전"을 사칭하지 못한다', () => {
  test('기준선 SQL 에 30~90분 전 창(OR 절)이 없다', async () => {
    mockState();
    await checkAndTriggerDrawdownKillSwitch();
    const sql = baselineSql();
    expect(sql).not.toMatch(/\bOR\b/);
    expect(sql).not.toContain('90 MINUTE');
    expect(sql).not.toContain('30 MINUTE');
  });

  test('기준선 조회는 24h±60분(1380~1500분) 창만 본다', async () => {
    mockState();
    await checkAndTriggerDrawdownKillSwitch();
    const call = query.mock.calls.find(c => /ORDER BY ABS\(TIMESTAMPDIFF/.test(String(c[0])))!;
    expect(call[1]).toEqual([1500, 1380]);
  });

  test('🔴 24h 창이 비면 근처 값으로 대체하지 않고 건너뛴다', async () => {
    mockState({ baseline: null, current: 5_000_000 });
    const r = await checkAndTriggerDrawdownKillSwitch();
    expect(r).toMatchObject({ status: 'skipped', reason: 'baseline_missing' });
    expect(insertedKillSwitch()).toHaveLength(0);
  });

  test('🔴 기준선 없음도 조용하지 않다 — 알림에 "발동하지 않는다"가 들어간다', async () => {
    mockState({ baseline: null });
    await checkAndTriggerDrawdownKillSwitch();
    expect(sendAlertThrottled).toHaveBeenCalledTimes(1);
    const [key, level, , body] = sendAlertThrottled.mock.calls[0];
    expect(String(key)).toContain('baseline');
    expect(level).toBe('warning');
    expect(String(body)).toContain('동작하지 않습니다');
  });

  test('기준 자본이 0 이하면 계산하지 않는다 (0 나눗셈·무한대 방지)', async () => {
    mockState({ baseline: 0 });
    const r = await checkAndTriggerDrawdownKillSwitch();
    expect(r).toEqual({ status: 'skipped', reason: 'baseline_invalid' });
  });

  test('현재값 행이 없으면 계산하지 않는다', async () => {
    mockState({ current: null });
    const r = await checkAndTriggerDrawdownKillSwitch();
    expect(r).toEqual({ status: 'skipped', reason: 'snapshot_missing' });
  });
});

describe('예외는 삼키되 결과로 드러낸다', () => {
  test('DB 예외 시 발동하지 않고 error 로 보고한다', async () => {
    checkSnapshotFreshness.mockResolvedValue({
      latestTs: new Date(), ageMs: 0, level: 'ok', session: 'open', effectiveAgeMs: 0,
    });
    query.mockImplementation(async (sql: string) => {
      if (/SELECT value FROM system_config/.test(sql)) return [[{ value: 'false' }]];
      throw new Error('db down');
    });
    const r = await checkAndTriggerDrawdownKillSwitch();
    expect(r).toMatchObject({ status: 'skipped', reason: 'error' });
    expect(insertedKillSwitch()).toHaveLength(0);
  });
});
