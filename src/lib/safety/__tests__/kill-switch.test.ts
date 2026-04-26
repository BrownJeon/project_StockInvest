import { isKillSwitchActive } from '../kill-switch';

// Mock DB so tests run without a real database — env fallback path
jest.mock('@/lib/db', () => ({
  getPool: () => ({
    query: () => Promise.reject(new Error('no db in test')),
  }),
}));

describe('isKillSwitchActive (env fallback, no DB)', () => {
  const orig = process.env.KILL_SWITCH;
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

  test('알 수 없는 값은 false (안전 기본값)', async () => {
    process.env.KILL_SWITCH = 'maybe';
    expect(await isKillSwitchActive()).toBe(false);
  });
});
