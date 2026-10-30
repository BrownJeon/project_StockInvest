import { isKillSwitchActive } from '../kill-switch';
import { resetUnparsableReports } from '../flags';

// Mock DB so tests run without a real database — env fallback path
jest.mock('@/lib/db', () => ({
  getPool: () => ({
    query: () => Promise.reject(new Error('no db in test')),
  }),
}));

const sendAlert = jest.fn();
jest.mock('@/lib/notify', () => ({ sendAlert: (...a: unknown[]) => sendAlert(...a) }));

describe('isKillSwitchActive (env fallback, no DB)', () => {
  const orig = process.env.KILL_SWITCH;
  beforeEach(() => {
    resetUnparsableReports();
    jest.clearAllMocks();
  });
  afterEach(() => {
    process.env.KILL_SWITCH = orig;
  });

  test('undefined이면 false', async () => {
    delete process.env.KILL_SWITCH;
    expect(await isKillSwitchActive()).toBe(false);
  });

  test('"false"면 false', async () => {
    process.env.KILL_SWITCH = 'false';
    expect(await isKillSwitchActive()).toBe(false);
  });

  test('"true"면 true', async () => {
    process.env.KILL_SWITCH = 'true';
    expect(await isKillSwitchActive()).toBe(true);
  });

  test('대소문자 무관', async () => {
    process.env.KILL_SWITCH = 'TRUE';
    expect(await isKillSwitchActive()).toBe(true);
  });

  // Phase 0 회귀 방어: 이전 구현은 `val === 'true'` 만 인정해서
  // KILL_SWITCH=1 로 켜려는 의도가 조용히 무시됐다 (fail-open).
  test('"1" / "on" / "yes" 도 활성으로 인식', async () => {
    for (const v of ['1', 'on', 'ON', 'yes']) {
      process.env.KILL_SWITCH = v;
      expect(await isKillSwitchActive()).toBe(true);
    }
  });

  test('"0" / "off" / "no" 는 비활성', async () => {
    for (const v of ['0', 'off', 'no']) {
      process.env.KILL_SWITCH = v;
      expect(await isKillSwitchActive()).toBe(false);
    }
  });

  test('빈 문자열은 미설정 취급 → false (평상시 운영)', async () => {
    process.env.KILL_SWITCH = '';
    expect(await isKillSwitchActive()).toBe(false);
    process.env.KILL_SWITCH = '   ';
    expect(await isKillSwitchActive()).toBe(false);
    expect(sendAlert).not.toHaveBeenCalled();
  });

  // 2026-08-02 교정: 미설정(false)과 해석 불가(true)를 구분한다.
  // 값을 넣었다는 것은 켜거나 끄려는 의도가 있었다는 뜻이고,
  // 그 의도가 "긴급 정지"였을 때 무시되는 것이 최악의 시나리오다.
  test('해석 불가한 값은 true (안전 방향) + critical 알림', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.KILL_SWITCH = 'maybe';
    expect(await isKillSwitchActive()).toBe(true);
    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(sendAlert.mock.calls[0][0]).toBe('critical');
    expect(String(sendAlert.mock.calls[0][1])).toMatch(/해석 불가/);
    // T-128 A5(T-129 Reviewer minor-4) — 운영 로그(console) 문구는 용어 정정 대상이 아니다: 경보 본문과 달리 글자 그대로 고정
    expect(err).toHaveBeenCalledWith('[safety] 환경변수 KILL_SWITCH 값을 해석할 수 없음("maybe") — 안전을 위해 KILL_SWITCH 활성으로 처리합니다. 값을 true/false 로 바로잡으면 즉시 해제됩니다.');
    err.mockRestore();
  });

  test('오타(flase)도 활성 — 조용히 비활성이 되지 않는다', async () => {
    process.env.KILL_SWITCH = 'flase';
    expect(await isKillSwitchActive()).toBe(true);
  });

  test('같은 해석 불가 값 반복 호출 시 알림은 1회만 (스팸 방지)', async () => {
    process.env.KILL_SWITCH = 'maybe';
    await isKillSwitchActive();
    await isKillSwitchActive();
    await isKillSwitchActive();
    expect(sendAlert).toHaveBeenCalledTimes(1);
  });

  test('해석 불가 값이 바뀌면 다시 알린다', async () => {
    process.env.KILL_SWITCH = 'maybe';
    await isKillSwitchActive();
    process.env.KILL_SWITCH = 'ㅇㅇ';
    await isKillSwitchActive();
    expect(sendAlert).toHaveBeenCalledTimes(2);
  });
});
