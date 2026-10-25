/**
 * T-084 — Capacitor 브리지 경계: 웹(전역 없음)에서는 아무 일도 안 함, 앱에서만 동작, 예외는 삼킨다.
 * jest 는 node 환경이라 `window` 를 직접 꽂았다 뺀다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getAppVersion, getBridge, isNativeApp, openExternal } from '../bridge';

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

test('정적 — @capacitor/* 를 import 하지 않는다(같은 번들이 웹에도 나간다)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'bridge.ts'), 'utf8');
  expect(src).not.toMatch(/from\s+['"]@capacitor\//);
  expect(src).not.toMatch(/require\(\s*['"]@capacitor\//);
  expect(src).not.toMatch(/import\(\s*['"]@capacitor\//);
});
