'use client';

/**
 * T-091 — 옛 앱 로그인 화면 맨 위 "앱 업데이트가 필요합니다" 띠 (승인 데모 v1 **대안 B** `mockups/T-091-app-version-gate-v1.html` `login(…,'gateB')`).
 *
 * 그리기 전용이다 — 언제 그릴지는 `OAuthButtons` 가 정해(`onAppGate`) 로그인 화면이 이 띠를 **AuthShell 카드 위**(문서 흐름 맨 위, 전역 업데이트 띠 자리)에 둔다.
 * 그리는 경우: 앱이고 설치 build 가 Google 로그인 최소 build(`APP_FEATURE_MIN_BUILD.googleLogin`)보다 낮고 서버에 Google 설정이 있을 때뿐.
 * 웹·새 앱·버전 모름·버전 읽는 중·Google 설정 없음에서는 그리지 않는다. 같은 화면의 Google 버튼은 비활성 + `aria-describedby` 로 이 띠를 가리킨다.
 *
 * 모양은 기존 필수 업데이트 띠(`AppUpdateBanner` forced — `.aub.forced`, `BannerStyles`)를 그대로 쓴다(수치·`safe-top` 처리 같음).
 * 로그인 전이라 서버 최신 버전 정보(`GET /api/app/version` — 로그인 필요)는 없다 — 설치 버전 이름만 보이고, [업데이트] 는 공개 경로 `latest.apk` 를 연다.
 * 이메일 로그인은 막지 않는다(업데이트를 강제하지 않는다). ⚠ 앱/웹 판별은 표시 전용이다.
 */
import { BannerStyles } from '@/components/app/AppStyles';
import { openDownload } from '@/components/app/AppUpdateBanner';
import { DOWNLOAD_PATH_PREFIX } from '@/components/app/app-update-logic';

/** Google 버튼의 `aria-describedby` 가 가리키는 띠 id(데모 `alt-band`). */
export const APP_UPDATE_BAND_ID = 'app-update-required-band';

/**
 * [업데이트] 가 여는 주소 — 같은 출처 공개 `/app/download/latest.apk`(최신 배포본). 업데이트 띠 [받기] 와 같은 경로 규칙.
 * (`app-release/paths` 의 `LATEST_DOWNLOAD_NAME` 은 `node:path` 를 쓰는 서버 모듈이라 여기서 import 하지 않는다 — 같은 값인지는 시험이 고정한다.)
 */
export const APP_LATEST_DOWNLOAD_PATH = `${DOWNLOAD_PATH_PREFIX}latest.apk`;

/** 문구(합니다체) — 데모 B. 시험이 글자까지 고정한다. 제목은 기존 필수 업데이트 띠 제목과 같은 글자. */
export const APP_UPDATE_REQUIRED_COPY = {
  title: '앱 업데이트가 필요합니다',
  body: (version: string) => `이 버전(v${version})에서는 Google 로그인을 쓸 수 없습니다.`,
  action: '업데이트',
} as const;

/** [업데이트] — 업데이트 띠와 같은 `openDownload`(Chrome 창 → 열지 못하면 같은 화면 이동 폴백). */
export function openLatestDownload(): Promise<void> {
  return openDownload(APP_LATEST_DOWNLOAD_PATH);
}

export function AppUpdateRequiredBand({ version, onUpdate = () => { void openLatestDownload(); } }: { version: string; onUpdate?: () => void }) {
  return (
    <div className="aub forced" id={APP_UPDATE_BAND_ID} role="status">
      <BannerStyles />
      <span className="bar" aria-hidden="true" />
      <div className="txt">
        <span className="t"><span aria-hidden="true">⚠ </span>{APP_UPDATE_REQUIRED_COPY.title}</span>
        <span className="ss">{APP_UPDATE_REQUIRED_COPY.body(version)}</span>
      </div>
      <button type="button" className="get" onClick={onUpdate}>{APP_UPDATE_REQUIRED_COPY.action}</button>
    </div>
  );
}
