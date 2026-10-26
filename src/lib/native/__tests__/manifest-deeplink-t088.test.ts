/**
 * T-088 — 네이티브 설정 대조: AndroidManifest 의 로그인 딥링크 intent-filter 가 서버(`app-flow.ts`)가 내는 주소와 정확히 같고,
 * 다른 딥링크를 주장하지 않으며, 버전이 1.0.0 보다 올라갔는지. (빌드된 APK 에서의 같은 검사는 scripts/build-apk.sh 가 한다.)
 *
 * T-091 M2 — 딥링크는 **정확히 둘**이 됐다: 로그인 콜백 1개 + https App Link 1개(스킴 https·호스트 = capacitor.config.ts server.url 의
 * 호스트·경로 정확히 `/`·`autoVerify="true"`). 그 밖의 스킴·호스트·pathPrefix/pathPattern 은 실패. 규칙을 `manifestProblems()` 한 함수로
 * 모아 실제 Manifest 에 적용하고, 범위를 넓히는 변이(접두어·다른 호스트·autoVerify 빠짐 등)를 넣은 사본에서 실패하는지도 확인한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { APP_DEEP_LINK_HOST, APP_DEEP_LINK_PATH, APP_DEEP_LINK_SCHEME } from '@/lib/auth/oauth/app-flow';
import { APP_LINK_PATH, APP_LINK_SCHEME } from '@/lib/native/appLink';

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const RAW_MANIFEST = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
const manifest = RAW_MANIFEST.replace(/<!--[\s\S]*?-->/g, ''); // 주석 제거
const gradle = fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle'), 'utf8');
const capConfig = fs.readFileSync(path.join(ROOT, 'capacitor.config.ts'), 'utf8');
const buildApk = fs.readFileSync(path.join(ROOT, 'scripts', 'build-apk.sh'), 'utf8');

/** capacitor.config.ts 의 server.url 과 그 호스트(앱이 띄우는 운영 웹). */
const SERVER_URL = /^\s*url:\s*'([^']+)'/m.exec(capConfig)?.[1] ?? '';
const SERVER_HOST = SERVER_URL ? new URL(SERVER_URL).host : '';

const LOGIN_DATA = `<data android:scheme="${APP_DEEP_LINK_SCHEME}" android:host="${APP_DEEP_LINK_HOST}" android:path="${APP_DEEP_LINK_PATH}" />`;
const APP_LINK_DATA = `<data android:scheme="${APP_LINK_SCHEME}" android:host="${SERVER_HOST}" android:path="${APP_LINK_PATH}" />`;

/** 딥링크 규칙 위반 목록(빈 배열 = 통과). 주석을 벗긴 Manifest 를 받는다. */
function manifestProblems(xml: string): string[] {
  const problems: string[] = [];
  const datas = xml.match(/<data\b[^>]*>/g) ?? [];
  if (datas.length !== 2) problems.push(`<data> 개수 ${datas.length}(기대 2)`);
  const filters = xml.match(/<intent-filter\b[\s\S]*?<\/intent-filter>/g) ?? [];
  if (filters.length !== 3) problems.push(`intent-filter 개수 ${filters.length}(기대 3: LAUNCHER·로그인·App Link)`);
  const withData = filters.filter((f) => f.includes('<data'));
  if (withData.length !== 2) problems.push(`<data> 를 가진 intent-filter ${withData.length}(기대 2)`);
  const viewFilter = (f: string) =>
    f.includes('android.intent.action.VIEW') && f.includes('android.intent.category.DEFAULT') &&
    f.includes('android.intent.category.BROWSABLE') && (f.match(/<action\b/g) ?? []).length === 1 &&
    (f.match(/<category\b/g) ?? []).length === 2;
  const banned = /pathPrefix|pathPattern|pathAdvancedPattern|pathSuffix|android:ssp|sspPrefix|sspPattern|android:port|mimeType/;

  const login = withData.filter((f) => f.includes(LOGIN_DATA));
  if (login.length !== 1) problems.push('로그인 콜백 intent-filter 가 정확히 하나가 아니다');
  const appLink = withData.filter((f) => f.includes(APP_LINK_DATA));
  if (appLink.length !== 1) problems.push('App Link intent-filter 가 정확히 하나가 아니다');
  for (const f of withData) {
    const ds = f.match(/<data\b[^>]*>/g) ?? [];
    if (ds.length !== 1) problems.push(`intent-filter 하나에 <data> ${ds.length}개(기대 1 — 여러 개면 스킴×호스트×경로가 교차 조합된다)`);
    if (banned.test(f)) problems.push('딥링크에 경로 패턴·포트·MIME 등 범위를 넓히는 속성이 있다');
    if (!viewFilter(f)) problems.push('딥링크 intent-filter 가 VIEW 1개 + DEFAULT·BROWSABLE 2개가 아니다');
    if (ds.length === 1 && ds[0] !== LOGIN_DATA && ds[0] !== APP_LINK_DATA) problems.push(`허용하지 않은 <data>: ${ds[0]}`);
  }
  if (login[0] && /autoVerify/.test(login[0])) problems.push('로그인 콜백(커스텀 스킴)에 autoVerify 가 있다');
  if (appLink[0] && !/^<intent-filter\s+android:autoVerify="true"\s*>/.test(appLink[0])) problems.push('App Link 에 autoVerify="true" 가 없다');
  if ((xml.match(/autoVerify/g) ?? []).length !== 1) problems.push('autoVerify 는 App Link intent-filter 에 정확히 한 번');
  const launcher = filters.filter((f) => !f.includes('<data'));
  if (launcher.length !== 1 || !launcher[0].includes('android.intent.action.MAIN') || !launcher[0].includes('android.intent.category.LAUNCHER')) {
    problems.push('LAUNCHER intent-filter 가 정확히 하나가 아니다');
  }
  return problems;
}

describe('AndroidManifest — 딥링크(T-088 로그인 콜백 + T-091 App Link)', () => {
  test('서버 호스트가 퓨니코드·소문자이고 build-apk.sh 기대값과 같다(안드로이드 호스트 비교는 대소문자 구분)', () => {
    expect(SERVER_HOST).toBe('stock.xn--lh0b87pnudm10a4vd.com');
    expect(SERVER_HOST).toBe(SERVER_HOST.toLowerCase());
    expect(buildApk).toContain(`EXPECTED_SERVER_URL="${SERVER_URL}"`);
  });

  test('실제 Manifest 는 규칙을 전부 만족한다', () => {
    expect(manifestProblems(manifest)).toEqual([]);
  });

  test('<data> 는 정확히 둘: 로그인 콜백 + https 루트(정확한 문자열)', () => {
    expect(manifest.match(/<data\b[^>]*>/g) ?? []).toEqual([LOGIN_DATA, APP_LINK_DATA]);
  });

  test('App Link 스킴·경로 상수(웹 처리 모듈 appLink.ts)가 https·`/` 다', () => {
    expect(APP_LINK_SCHEME).toBe('https');
    expect(APP_LINK_PATH).toBe('/');
  });

  test('딥링크는 MainActivity(singleTask)가 받는다 — 다른 exported 컴포넌트·권한 추가 없음', () => {
    expect(manifest.match(/<activity\b/g)).toHaveLength(1);
    expect(manifest).toMatch(/android:launchMode="singleTask"/);
    expect(manifest.match(/android:exported="true"/g)).toHaveLength(1);
    expect(manifest.match(/<uses-permission\b[^>]*>/g)).toEqual(['<uses-permission android:name="android.permission.INTERNET" />']);
  });
});

describe('Manifest 가드 변이 — 범위를 넓히거나 검증을 빼면 실패한다', () => {
  const mutate = (from: string, to: string) => {
    expect(manifest).toContain(from);
    return manifest.replace(from, to);
  };
  const hostPath = `android:host="${SERVER_HOST}" android:path="/"`;
  const loginFilterHead = '<intent-filter>\n                <action android:name="android.intent.action.VIEW" />';

  test.each<[string, () => string]>([
    ['path → pathPrefix="/"', () => mutate(hostPath, `android:host="${SERVER_HOST}" android:pathPrefix="/"`)],
    ['path → pathPattern=".*"', () => mutate(hostPath, `android:host="${SERVER_HOST}" android:pathPattern=".*"`)],
    ['path 없음(호스트 전체)', () => mutate(hostPath, `android:host="${SERVER_HOST}"`)],
    ['path="/order"', () => mutate(hostPath, `android:host="${SERVER_HOST}" android:path="/order"`)],
    ['다른 호스트', () => mutate(hostPath, 'android:host="evil.example.com" android:path="/"')],
    ['대문자 호스트', () => mutate(hostPath, `android:host="${SERVER_HOST.toUpperCase()}" android:path="/"`)],
    ['와일드카드 호스트', () => mutate(hostPath, 'android:host="*.xn--lh0b87pnudm10a4vd.com" android:path="/"')],
    ['스킴 http', () => mutate('android:scheme="https"', 'android:scheme="http"')],
    ['autoVerify 빠짐', () => mutate('<intent-filter android:autoVerify="true">', '<intent-filter>')],
    ['autoVerify="false"', () => mutate('android:autoVerify="true"', 'android:autoVerify="false"')],
    ['로그인 콜백에도 autoVerify', () => mutate(loginFilterHead, loginFilterHead.replace('<intent-filter>', '<intent-filter android:autoVerify="true">'))],
    ['App Link 에 <data> 하나 더(http 스킴)', () => mutate(APP_LINK_DATA, `${APP_LINK_DATA}\n<data android:scheme="http" />`)],
    ['BROWSABLE 빠짐(App Link)', () => manifest.replace(/(<intent-filter android:autoVerify="true">[\s\S]*?)<category android:name="android.intent.category.BROWSABLE" \/>/, '$1')],
    ['로그인 콜백 경로 → pathPrefix', () => mutate('android:path="/callback"', 'android:pathPrefix="/callback"')],
    ['세 번째 딥링크 intent-filter 추가', () => manifest.replace('</activity>', '<intent-filter><action android:name="android.intent.action.VIEW" /><category android:name="android.intent.category.DEFAULT" /><category android:name="android.intent.category.BROWSABLE" /><data android:scheme="stockinvest" android:host="x" android:path="/y" /></intent-filter>\n</activity>')],
  ])('%s → 실패', (_name, make) => {
    const xml = make();
    expect(xml).not.toBe(manifest);
    expect(manifestProblems(xml).length).toBeGreaterThan(0);
  });
});

describe('버전 — 네이티브 변경(T-091 App Link)이므로 1.0.1(2) 보다 크다', () => {
  test('stockVersionCode ≥ 3, versionName 은 x.y.z 이고 1.0.0·1.0.1 이 아니다', () => {
    const code = Number(/def stockVersionCode = (\d+)/.exec(gradle)?.[1]);
    const name = /def stockVersionName = "([^"]+)"/.exec(gradle)?.[1];
    expect(code).toBeGreaterThanOrEqual(3);
    expect(name).toMatch(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/);
    expect(['1.0.0', '1.0.1']).not.toContain(name);
  });
});

/**
 * T-091 M2 — `scripts/build-apk.sh` 의 빌드된 APK 딥링크 검사(node 본문, `<<'MANIFEST_CHECK'` 표식 사이)를 그대로 떼어
 * aapt2 xmltree 모양의 합성 나무로 실행한다. 정상 나무는 통과, 범위를 넓히거나 검증을 빼는 변이는 종료 코드 1.
 */
describe('build-apk.sh 딥링크 검사(MANIFEST_CHECK) — 합성 aapt2 나무로 실행', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
  const m = /<<'MANIFEST_CHECK'\n([\s\S]*?)\nMANIFEST_CHECK\n/.exec(buildApk);
  const script = m?.[1] ?? '';
  const NS = 'http://schemas.android.com/apk/res/android:';
  const attr = (ind: number, name: string, id: string, v: string) => `${' '.repeat(ind)}A: ${NS}${name}(0x${id})=${v}`;
  const str = (ind: number, name: string, id: string, v: string) => attr(ind, name, id, `"${v}" (Raw: "${v}")`);
  interface F { autoVerify?: string; actions?: string[]; cats?: string[]; datas: Array<Record<string, string>> }
  const filter = (f: F) => [
    '              E: intent-filter (line=1)',
    ...(f.autoVerify !== undefined ? [attr(16, 'autoVerify', '010104ee', f.autoVerify)] : []),
    ...(f.actions ?? ['android.intent.action.VIEW']).flatMap((a) => ['                  E: action (line=2)', str(20, 'name', '01010003', a)]),
    ...(f.cats ?? ['android.intent.category.DEFAULT', 'android.intent.category.BROWSABLE']).flatMap((c) => ['                  E: category (line=3)', str(20, 'name', '01010003', c)]),
    ...f.datas.flatMap((d) => ['                  E: data (line=4)', ...Object.entries(d).map(([k, v]) => str(20, k, '01010027', v))]),
  ];
  const LOGIN: F = { datas: [{ scheme: 'stockinvest', host: 'auth', path: '/callback' }] };
  const APPL: F = { autoVerify: 'true', datas: [{ scheme: 'https', host: SERVER_HOST, path: '/' }] };
  const tree = (filters: F[], extra: string[] = []) => [
    'N: android=http://schemas.android.com/apk/res/android (line=2)',
    '  E: manifest (line=2)',
    '      E: application (line=10)',
    '          E: activity (line=30)',
    str(14, 'name', '01010003', 'com.miraclepenguin.stockinvest.MainActivity'),
    '              E: intent-filter (line=40)',
    '                  E: action (line=41)',
    str(20, 'name', '01010003', 'android.intent.action.MAIN'),
    '                  E: category (line=42)',
    str(20, 'name', '01010003', 'android.intent.category.LAUNCHER'),
    ...filters.flatMap(filter),
    '          E: receiver (line=90)',
    '              E: intent-filter (line=91)',
    '                  E: action (line=92)',
    str(20, 'name', '01010003', 'androidx.profileinstaller.action.INSTALL_PROFILE'),
    ...extra,
  ].join('\n');
  const run = (t: string) => spawnSync(process.execPath, ['-', t, SERVER_URL], { input: script, encoding: 'utf8' });

  test('본문을 찾았다', () => {
    expect(script).toContain('process.argv.slice(2)');
    expect(script.length).toBeGreaterThan(500);
  });

  test.each<[string, string]>([
    ['autoVerify 불리언 =true', 'true'],
    ['autoVerify 옛 형식 (type 0x12)0xffffffff', '(type 0x12)0xffffffff'],
  ])('정상 나무(로그인 + App Link, %s) → 통과', (_n, av) => {
    const r = run(tree([LOGIN, { ...APPL, autoVerify: av }]));
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`https://${SERVER_HOST}/`);
  });

  test.each<[string, () => string]>([
    ['로그인 콜백만(1.0.1 모양)', () => tree([LOGIN])],
    ['App Link 만', () => tree([APPL])],
    ['App Link pathPrefix', () => tree([LOGIN, { ...APPL, datas: [{ scheme: 'https', host: SERVER_HOST, pathPrefix: '/' }] }])],
    ['App Link pathPattern 추가', () => tree([LOGIN, { ...APPL, datas: [{ scheme: 'https', host: SERVER_HOST, path: '/', pathPattern: '.*' }] }])],
    ['App Link 경로 /order', () => tree([LOGIN, { ...APPL, datas: [{ scheme: 'https', host: SERVER_HOST, path: '/order' }] }])],
    ['App Link 다른 호스트', () => tree([LOGIN, { ...APPL, datas: [{ scheme: 'https', host: 'evil.example.com', path: '/' }] }])],
    ['App Link http', () => tree([LOGIN, { ...APPL, datas: [{ scheme: 'http', host: SERVER_HOST, path: '/' }] }])],
    ['App Link autoVerify 없음', () => tree([LOGIN, { datas: APPL.datas }])],
    ['App Link autoVerify=false', () => tree([LOGIN, { ...APPL, autoVerify: 'false' }])],
    ['로그인에도 autoVerify', () => tree([{ ...LOGIN, autoVerify: 'true' }, APPL])],
    ['한 필터에 <data> 둘(교차 조합)', () => tree([LOGIN, { ...APPL, datas: [...APPL.datas, { scheme: 'http', host: SERVER_HOST, path: '/' }] }])],
    ['세 번째 딥링크', () => tree([LOGIN, APPL, { datas: [{ scheme: 'stockinvest', host: 'x', path: '/y' }] }])],
    ['BROWSABLE 빠짐', () => tree([LOGIN, { ...APPL, cats: ['android.intent.category.DEFAULT'] }])],
    ['action 둘', () => tree([LOGIN, { ...APPL, actions: ['android.intent.action.VIEW', 'android.intent.action.SEND'] }])],
    ['App Link 포트', () => tree([LOGIN, { ...APPL, datas: [{ scheme: 'https', host: SERVER_HOST, path: '/', port: '8443' }] }])],
    ['로그인 콜백 경로 바뀜', () => tree([{ datas: [{ scheme: 'stockinvest', host: 'auth', path: '/callback2' }] }, APPL])],
    ['receiver 에 딥링크(activity 밖)', () => tree([LOGIN, APPL], ['              E: intent-filter (line=95)', '                  E: data (line=96)', str(20, 'scheme', '01010027', 'https')])],
  ])('%s → 실패', (_n, make) => {
    const r = run(make());
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('딥링크 검사 실패');
  });
});
