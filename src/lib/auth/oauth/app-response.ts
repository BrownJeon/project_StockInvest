/**
 * T-088 — 앱 로그인 흐름의 서버 응답 헬퍼(시작·콜백 라우트 공용). 웹 흐름은 이 모듈을 부르지 않는다.
 */
import { NextResponse } from 'next/server';
import { OAUTH_STATE_COOKIE } from '@/lib/auth/oauth/state';
import { buildAppCallbackDeepLink, type AppLoginError } from '@/lib/auth/oauth/app-flow';

/**
 * 커스텀 스킴(`stockinvest://`) 302. `NextResponse.redirect()` 는 인자를 `new URL()` 로 다시 파싱·검증하는데 http(s) 가 아닌 스킴에 대한
 * 동작이 Next 버전에 묶인 계약이라 쓰지 않는다(TheKaiwa `deepLinkRedirect` 와 같은 이유). Location 은 `buildAppCallbackDeepLink` 가
 * 고정 접두어 + 형식 검증된 값으로만 만든 문자열이다.
 *  - `Cache-Control: no-store` — 1회용 코드가 든 응답이 어떤 캐시에도 남지 않게
 *  - `Referrer-Policy: no-referrer` — 다음 요청의 Referer 로 이 주소가 새지 않게
 *  - state nonce 쿠키는 항상 지운다(웹 콜백의 `res.cookies.delete` 와 같은 동작)
 */
export function appDeepLinkRedirect(p: { code: string } | { error: AppLoginError }): NextResponse {
  const res = new NextResponse(null, {
    status: 302,
    headers: {
      Location: buildAppCallbackDeepLink(p),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
  res.cookies.delete(OAUTH_STATE_COOKIE);
  return res;
}
