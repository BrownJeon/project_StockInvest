/**
 * T-088 — 네이티브 설정 대조: AndroidManifest 의 로그인 딥링크 intent-filter 가 서버(`app-flow.ts`)가 내는 주소와 정확히 같고,
 * 다른 딥링크를 주장하지 않으며, 버전이 1.0.0 보다 올라갔는지. (빌드된 APK 에서의 같은 검사는 scripts/build-apk.sh 가 한다.)
 */
import fs from 'node:fs';
import path from 'node:path';
import { APP_DEEP_LINK_HOST, APP_DEEP_LINK_PATH, APP_DEEP_LINK_SCHEME } from '@/lib/auth/oauth/app-flow';

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const manifest = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, ''); // 주석 제거
const gradle = fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle'), 'utf8');

describe('AndroidManifest — 로그인 딥링크', () => {
  test('<data> 는 정확히 하나: stockinvest://auth/callback (scheme·host·path)', () => {
    const datas = manifest.match(/<data\b[^>]*>/g) ?? [];
    expect(datas).toHaveLength(1);
    expect(datas[0]).toBe(`<data android:scheme="${APP_DEEP_LINK_SCHEME}" android:host="${APP_DEEP_LINK_HOST}" android:path="${APP_DEEP_LINK_PATH}" />`);
  });

  test('그 intent-filter 는 VIEW·DEFAULT·BROWSABLE 이고 autoVerify·경로 패턴이 없다', () => {
    const filters = manifest.match(/<intent-filter\b[\s\S]*?<\/intent-filter>/g) ?? [];
    expect(filters).toHaveLength(2);
    const dl = filters.find((f) => f.includes('<data'))!;
    expect(dl).toContain('android.intent.action.VIEW');
    expect(dl).toContain('android.intent.category.DEFAULT');
    expect(dl).toContain('android.intent.category.BROWSABLE');
    expect(dl).not.toMatch(/autoVerify|pathPrefix|pathPattern|pathAdvancedPattern|pathSuffix|mimeType/);
    expect(dl.match(/<action\b/g)).toHaveLength(1);
    const launcher = filters.find((f) => !f.includes('<data'))!;
    expect(launcher).toContain('android.intent.action.MAIN');
    expect(launcher).toContain('android.intent.category.LAUNCHER');
  });

  test('딥링크는 MainActivity(singleTask)가 받는다 — 다른 exported 컴포넌트·권한 추가 없음', () => {
    expect(manifest.match(/<activity\b/g)).toHaveLength(1);
    expect(manifest).toMatch(/android:launchMode="singleTask"/);
    expect(manifest.match(/android:exported="true"/g)).toHaveLength(1);
    expect(manifest.match(/<uses-permission\b[^>]*>/g)).toEqual(['<uses-permission android:name="android.permission.INTERNET" />']);
  });
});

describe('버전 — 네이티브 변경이므로 1.0.0(1) 보다 크다', () => {
  test('stockVersionCode ≥ 2, versionName 은 x.y.z 이고 1.0.0 이 아니다', () => {
    const code = Number(/def stockVersionCode = (\d+)/.exec(gradle)?.[1]);
    const name = /def stockVersionName = "([^"]+)"/.exec(gradle)?.[1];
    expect(code).toBeGreaterThanOrEqual(2);
    expect(name).toMatch(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/);
    expect(name).not.toBe('1.0.0');
  });
});
