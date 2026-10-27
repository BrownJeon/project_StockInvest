/**
 * T-084 — Capacitor 브리지 경계: 웹(전역 없음)에서는 아무 일도 안 함, 앱에서만 동작, 예외는 삼킨다.
 * jest 는 node 환경이라 `window` 를 직접 꽂았다 뺀다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { APP_INFO_TIMEOUT_MS, getAppVersion, getBridge, isNativeApp, openExternal } from '../bridge';

type G = { window?: unknown };
const g = globalThis as unknown as G;

function setWindow(capacitor: unknown, href = 'https://stock.example.com/dashboard') {
  g.window = { Capacitor: capacitor, location: { href } };
}
afterEach(() => {
  delete g.window;
});

describe('웹·SSR — 아무 일도 하지 않는다', () => {
  test('window 없음(SSR)', async () => {
    expect(getBridge()).toBeNull();
    expect(isNativeApp()).toBe(false);
    expect(await getAppVersion()).toBeNull();
    expect(await openExternal('https://x.example/a')).toBe(false);
  });
  test('window 는 있으나 Capacitor 없음(일반 브라우저)', async () => {
    g.window = { location: { href: 'https://stock.example.com/' } };
    expect(isNativeApp()).toBe(false);
    expect(await getAppVersion()).toBeNull();
    expect(await openExternal('/app/download/latest.apk')).toBe(false);
  });
  test('Capacitor 는 있으나 isNativePlatform=false(웹 빌드의 Capacitor)면 플러그인을 부르지 않는다', async () => {
    const getInfo = jest.fn(async () => ({ version: '1.0.0', build: '1' }));
    const open = jest.fn(async () => {});
    setWindow({ isNativePlatform: () => false, Plugins: { App: { getInfo }, Browser: { open } } });
    expect(isNativeApp()).toBe(false);
    expect(await getAppVersion()).toBeNull();
    expect(await openExternal('https://x.example/')).toBe(false);
    expect(getInfo).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
  test('Capacitor 가 객체가 아니면 무시', () => {
    setWindow('fake');
    expect(getBridge()).toBeNull();
    expect(isNativeApp()).toBe(false);
  });
});

describe('앱 — 동작', () => {
  test('isNativeApp', () => {
    setWindow({ isNativePlatform: () => true });
    expect(isNativeApp()).toBe(true);
  });
  test('getAppVersion — {version, build(정수)}', async () => {
    setWindow({ isNativePlatform: () => true, Plugins: { App: { getInfo: async () => ({ version: '1.2.3', build: '7' }) } } });
    expect(await getAppVersion()).toEqual({ version: '1.2.3', build: 7 });
  });
  test('getAppVersion — build 가 숫자로 와도', async () => {
    setWindow({ isNativePlatform: () => true, Plugins: { App: { getInfo: async () => ({ version: '1.0.0', build: 12 }) } } });
    expect(await getAppVersion()).toEqual({ version: '1.0.0', build: 12 });
  });
  test('getAppVersion — build 상한 2100000000 은 받는다(안드로이드 versionCode 최댓값 = 서버 MAX_VERSION_CODE)', async () => {
    setWindow({ isNativePlatform: () => true, Plugins: { App: { getInfo: async () => ({ version: '1.0.0', build: '2100000000' }) } } });
    expect(await getAppVersion()).toEqual({ version: '1.0.0', build: 2_100_000_000 });
  });
  test.each([
    [{ version: '1.0.0', build: '0' }],
    [{ version: '1.0.0', build: '2100000001' }], // 상한+1
    [{ version: '1.0.0', build: 'abc' }],
    [{ version: '1.0.0', build: '' }],
    [{ version: 'v1', build: '3' }],
    [{ version: '1.1', build: '3' }], // R1: versionName 은 정확히 x.y.z
    [{ version: '1.0.0.0', build: '3' }],
    [{ build: '3' }],
    [null],
  ])('getAppVersion — 형식이 다르면 null %j', async (info) => {
    setWindow({ isNativePlatform: () => true, Plugins: { App: { getInfo: async () => info } } });
    expect(await getAppVersion()).toBeNull();
  });
  test('App 플러그인 없음 → null', async () => {
    setWindow({ isNativePlatform: () => true, Plugins: {} });
    expect(await getAppVersion()).toBeNull();
  });
  test('openExternal — 상대 경로를 현재 출처로 풀어 Browser.open', async () => {
    const open = jest.fn(async () => {});
    setWindow({ isNativePlatform: () => true, Plugins: { Browser: { open } } });
    expect(await openExternal('/app/download/latest.apk')).toBe(true);
    expect(open).toHaveBeenCalledWith({ url: 'https://stock.example.com/app/download/latest.apk' });
  });
  test.each(['http://insecure.example/a', 'javascript:alert(1)', 'intent://x#Intent;end', 'https://user:pw@x.example/', 'file:///etc/passwd'])(
    'openExternal — https 아님·자격증명 포함은 열지 않음 %j',
    async (url) => {
      const open = jest.fn(async () => {});
      setWindow({ isNativePlatform: () => true, Plugins: { Browser: { open } } });
      expect(await openExternal(url)).toBe(false);
      expect(open).not.toHaveBeenCalled();
    },
  );
  test('Browser 플러그인 없음 → false', async () => {
    setWindow({ isNativePlatform: () => true, Plugins: {} });
    expect(await openExternal('https://x.example/')).toBe(false);
  });
});

describe('예외를 삼킨다', () => {
  test('isNativePlatform 이 던짐', async () => {
    setWindow({ isNativePlatform: () => { throw new Error('boom'); } });
    expect(isNativeApp()).toBe(false);
    expect(await getAppVersion()).toBeNull();
  });
  test('getInfo 거부', async () => {
    setWindow({ isNativePlatform: () => true, Plugins: { App: { getInfo: async () => { throw new Error('x'); } } } });
    expect(await getAppVersion()).toBeNull();
  });
  test('Browser.open 거부', async () => {
    setWindow({ isNativePlatform: () => true, Plugins: { Browser: { open: async () => { throw new Error('x'); } } } });
    expect(await openExternal('https://x.example/')).toBe(false);
  });
});

describe('T-094 WP-3 — getAppVersion 응답 제한 시간(초과 = 버전 모름 null)', () => {
  /** 바깥에서 풀 수 있는 Promise — 응답 시각을 시험이 정한다. */
  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }
  /** 마이크로태스크를 몇 번 흘려 보낸다(가짜 타이머는 Promise 를 건드리지 않는다). */
  async function flush() {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  }
  function track<T>(p: Promise<T>) {
    const box: { settled: boolean; value?: T } = { settled: false };
    void p.then((v) => { box.settled = true; box.value = v; });
    return box;
  }

  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('제한 시간 값 — 정상 응답(수 ms)보다 넉넉하고 사용자가 빈 자리를 오래 보지 않는 범위(1~10초)', () => {
    expect(APP_INFO_TIMEOUT_MS).toBeGreaterThanOrEqual(1_000);
    expect(APP_INFO_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });

  test('① 응답 없음 → 제한 시간 직전까지는 대기, 제한 시간에 null', async () => {
    const getInfo = jest.fn(() => new Promise<never>(() => {})); // 끝내 응답하지 않음
    setWindow({ isNativePlatform: () => true, Plugins: { App: { getInfo } } });
    const box = track(getAppVersion());
    expect(getInfo).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(APP_INFO_TIMEOUT_MS - 1);
    await flush();
    expect(box.settled).toBe(false);
    jest.advanceTimersByTime(1);
    await flush();
    expect(box.settled).toBe(true);
    expect(box.value).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('② 제한 시간 안의 정상 응답은 그대로 {version, build} + 타이머 정리', async () => {
    const d = deferred<{ version: string; build: string }>();
    setWindow({ isNativePlatform: () => true, Plugins: { App: { getInfo: () => d.promise } } });
    const p = getAppVersion();
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(APP_INFO_TIMEOUT_MS - 1); // 마감 1ms 전 응답
    d.resolve({ version: '1.1.0', build: '3' });
    expect(await p).toEqual({ version: '1.1.0', build: 3 });
    expect(jest.getTimerCount()).toBe(0); // ⑤ 늦은 발화 없음
  });

  test('③ 거부 → null + 타이머 정리', async () => {
    const d = deferred<never>();
    setWindow({ isNativePlatform: () => true, Plugins: { App: { getInfo: () => d.promise } } });
    const p = getAppVersion();
    expect(jest.getTimerCount()).toBe(1);
    d.reject(new Error('plugin failed'));
    expect(await p).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('③-2 getInfo 가 동기 예외 → null, 타이머를 만들지 않는다', async () => {
    setWindow({ isNativePlatform: () => true, Plugins: { App: { getInfo: () => { throw new Error('sync boom'); } } } });
    expect(await getAppVersion()).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('④ 제한 시간 뒤 늦게 온 응답은 무시한다(이미 null) — 늦은 거부도 처리되지 않은 거부로 남지 않는다', async () => {
    const late = deferred<{ version: string; build: string }>();
    const lateReject = deferred<never>();
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      setWindow({ isNativePlatform: () => true, Plugins: { App: { getInfo: () => late.promise } } });
      const p1 = getAppVersion();
      jest.advanceTimersByTime(APP_INFO_TIMEOUT_MS);
      expect(await p1).toBeNull();
      late.resolve({ version: '1.1.0', build: '3' });
      await flush();
      expect(await p1).toBeNull(); // 이미 정해진 값은 바뀌지 않는다

      setWindow({ isNativePlatform: () => true, Plugins: { App: { getInfo: () => lateReject.promise } } });
      const p2 = getAppVersion();
      jest.advanceTimersByTime(APP_INFO_TIMEOUT_MS);
      expect(await p2).toBeNull();
      lateReject.reject(new Error('late'));
      await flush();
      jest.useRealTimers(); // setImmediate 를 실제로 돌려 unhandledRejection 판정(마이크로태스크 뒤)까지 기다린다
      await new Promise((r) => setImmediate(r));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  test('⑤ 형식이 다른 정상 응답(null)도 null + 타이머 정리', async () => {
    setWindow({ isNativePlatform: () => true, Plugins: { App: { getInfo: async () => null } } });
    expect(await getAppVersion()).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('⑥ 앱이 아님·SSR·플러그인 없음 → 타이머를 만들지 않고 즉시 null', async () => {
    const getInfo = jest.fn(() => new Promise<never>(() => {}));
    setWindow({ isNativePlatform: () => false, Plugins: { App: { getInfo } } });
    const web = track(getAppVersion());
    expect(jest.getTimerCount()).toBe(0);
    await flush();
    expect(web.settled).toBe(true);
    expect(web.value).toBeNull();
    expect(getInfo).not.toHaveBeenCalled();

    delete g.window; // SSR
    expect(await getAppVersion()).toBeNull();
    expect(jest.getTimerCount()).toBe(0);

    setWindow({ isNativePlatform: () => true, Plugins: {} }); // App 플러그인 없음
    expect(await getAppVersion()).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });
});

test('정적 — @capacitor/* 를 import 하지 않는다(같은 번들이 웹에도 나간다)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'bridge.ts'), 'utf8');
  expect(src).not.toMatch(/from\s+['"]@capacitor\//);
  expect(src).not.toMatch(/require\(\s*['"]@capacitor\//);
  expect(src).not.toMatch(/import\(\s*['"]@capacitor\//);
});
