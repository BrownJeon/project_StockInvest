/**
 * KIS **토큰 계열 오류 코드**의 단일 출처 (T-136).
 *
 * 의존성이 **하나도 없는 잎 모듈**이다. 그래야 두 쪽이 같은 판정을 쓸 수 있다:
 *  - `kis-http`(게이트웨이) — 토큰 오류는 일시 실패로 **재시도하지 않는다**(죽은 토큰으로 두 번 더
 *    때린 뒤에야 재발급에 닿기 때문). `isTransientKisFailure` 가 이 판정으로 먼저 걸러낸다.
 *  - `kis-token-retry`(어댑터 공용 헬퍼) — 토큰 오류일 때 **재발급 후 1회 재시도**를 한다.
 *
 * 🔴 **`kis-http` 에 두면 안 된다.** `kis-auth` 가 `kis-http` 의 `kisFetch` 를 import 하므로
 * (`kis-auth.ts:3`), 재발급(`kis-auth`)과 판정(`kis-http`)을 함께 쓰는 헬퍼가 `kis-http` 를 가리키면
 * 순환이 된다. 의존성 없는 잎으로 빼면 그 문제가 사라지고, **`kis-http` 를 모킹한 시험이 이 판정까지
 * 함께 잃는 일**도 없어진다(T-133 감사 Info 가 지적한 취약점 — 실제로 시험 2개가 그렇게 깨졌다).
 *
 * 코드 뜻:
 *  - `EGW00121` 유효하지 않은 token · `EGW00123` 기간이 만료된 token — 둘 다 **재발급이 답**이다.
 *  - `EGW00133`(앱키당 1분 1회 발급 제한)은 **넣지 않는다.** 그건 재발급 자체의 속도 제한이라
 *    여기서 또 재발급을 부르면 악화된다. `kis-auth.issueAndStore` 가 따로 다룬다.
 */

/** 토큰 재발급으로 풀리는 오류. 호출부가 이 정규식을 **복제하지 않는다**(복제가 드리프트를 만들었다). */
const TOKEN_ERROR_PATTERN = /EGW00121|EGW00123|만료된 token/;

/** 응답 본문이 토큰 계열 오류인가. */
export function isKisTokenError(body: string): boolean {
  return TOKEN_ERROR_PATTERN.test(body);
}
