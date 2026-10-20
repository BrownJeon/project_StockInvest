/**
 * 해외 시장이 켜져 있는가 — **판정식은 여기 하나뿐이다** (T-056).
 *
 * `KIS_OVERSEAS_ENABLED` 미설정 = 켜짐, `'true'`(대소문자 무시)만 켜짐, `'1'`·`'yes'`·`'false'` 등은 꺼짐.
 * 예전에는 같은 식이 잔고(`kis.ts`)·미체결(`kis.ts`)·설정 화면(`settings/safety`) 세 곳에 복제돼 있었다.
 * 스냅샷 저장 가드가 "이 틱에 USD 행이 있어야 하는가"를 이 값으로 판단하므로, 판정이 갈라지면 한쪽은 USD 를
 * 요구하고 다른 쪽은 조회하지 않는 데드락이 생길 수 있다.
 *
 * 의존성 없는 모듈로 둔 이유: 설정 화면 라우트가 판정식 하나 때문에 KIS 어댑터 전체를 끌어오지 않게.
 */
export function isOverseasEnabled(): boolean {
  return String(process.env.KIS_OVERSEAS_ENABLED ?? 'true').toLowerCase() === 'true';
}
