/**
 * T-108 운용 화면 공용 스타일 접근점 — `ops.module.css` 클래스 객체(`ops`)와 클래스 합치기(`cx`).
 *
 * 공용 컴포넌트로 충분하지 않은 곳(거래 카드 `.card`·`.pill`, 분석 `.kv`, 승인 결과 `.res`·`.gate`, 버튼 `.btn` 등)은
 * `ops['card']` 처럼 이 객체에서 클래스를 꺼내 쓴다. 전역 `.num`·`.up`·`.down` 은 문자열 그대로 같이 붙인다.
 * 시험(jest)에서는 `jest.config.js` 의 CSS Module 스텁이 클래스 이름을 그대로 돌려준다(`ops.tile === tile`).
 */
import ops from '../ops.module.css';

export { ops };

/** 거짓 값을 빼고 공백으로 잇는다. */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ');
}
