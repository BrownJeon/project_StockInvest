/**
 * T-088 — "로그인 딥링크가 도착했다"는 신호 하나를 `AppDeepLink`(수신·교환) 에서 `OAuthButtons`(대기 카드) 로 전하는 아주 작은 구독 모듈(화면 아님).
 *
 * 왜 따로 두나: 딥링크 수신(`onAuthDeepLink` — appLogin.ts)은 **한 곳에서만** 구독해야 한다. 중복 처리 방지(콜드 스타트 주소 지문·같은 코드 1회)가
 * 모듈 전역 기록이라 구독자가 둘이면 한쪽이 가로채 다른 쪽이 못 받는다. 그래서 수신·교환은 `AppDeepLink` 가 맡고, 대기 카드를 푸는 쪽(`OAuthButtons`)은
 * 이 신호만 받는다.
 *  - `code`  : 로그인 성공 딥링크 → 대기 카드가 사라지고 Google 버튼이 잠긴 채 마무리 중(덮개는 `AppDeepLink`).
 *  - `error` : 오류 딥링크 → 곧 `/login?oauth_error=…` 로 이동한다(페이지가 새로 그려지므로 대기 카드는 그대로 둔다).
 * 값(코드·verifier)은 싣지 않는다 — 종류만. ⚠ 화면 표시 전용 — 서버 권한 판단에 쓰지 않는다.
 */
export type AppLoginLinkKind = 'code' | 'error';
type Listener = (kind: AppLoginLinkKind) => void;

const listeners = new Set<Listener>();

/** 신호 구독. 돌려준 함수로 해제한다. */
export function subscribeAppLoginLink(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 신호 발행 — 구독자 하나가 던져도 나머지에게 전한다. */
export function notifyAppLoginLink(kind: AppLoginLinkKind): void {
  for (const l of Array.from(listeners)) {
    try {
      l(kind);
    } catch {
      // 한 구독자의 오류가 로그인 마무리를 막지 않는다
    }
  }
}

/** 시험용 — 구독 전부 해제. */
export function __resetAppLoginSignalForTest(): void {
  listeners.clear();
}
