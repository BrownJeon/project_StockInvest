/**
 * 「실거래여부」 방향 변환 — **이 파일 하나에서만** 뒤집는다 (T-108 §3.5).
 *
 * 화면 이름 「실거래여부」 ON = 실거래 가능(실제 주문 송신) ⇔ 내부 `safety_dry_run = false`.
 * 내부 키는 이름과 방향이 반대(`dry_run` = 실거래 차단)라, 화면·서버 곳곳에서 `!dryRun` 으로 뒤집으면
 * 언젠가 한 곳이 방향을 틀린다. 그래서 방향 변환을 두 함수로 모으고, 회귀 시험
 * (`ops-read-only-fence.test.ts`)이 `src/app`·`src/components` 의 `!dryRun`·`!safety.dryRun` 패턴 0건을 강제한다.
 *
 * - **import 0개 순수 모듈** — 서버(`/api/ops/safety-state`)·클라이언트(설정 토글·배너·시나리오 상세)가 같이 쓴다.
 * - **fail-closed**: `dryRun === false` 일 때만 실거래로 본다. 값이 이상하면(`undefined`·문자열 등) 실거래 아님.
 *   역변환도 `liveTrading === true` 일 때만 `dryRun=false`(실거래)를 만든다.
 * - SAFETY_PATHS 안에 두는 것은 의도다 — 방향을 바꾸는 수정은 Reviewer 판정 줄(scope) 없이 커밋되지 않는다.
 */

/** 화면 「실거래여부」 ON(실거래 가능) ⇔ 내부 dryRun=false. `false` 리터럴만 실거래로 본다. */
export function liveTradingFromDryRun(dryRun: boolean): boolean {
  return dryRun === false;
}

/** 화면 토글 값(실거래여부) → 내부 dryRun. `true` 리터럴만 실거래(dryRun=false)로 바꾼다. */
export function dryRunFromLiveTrading(liveTrading: boolean): boolean {
  return liveTrading !== true;
}

/** 화면 표시 이름 (용어 정정표 — 계약 §12). */
export const LIVE_TRADING_LABEL = '실거래여부';

/** 안전 상태 띠·설정 화면 칩 문구. */
export function liveTradingText(live: boolean): 'ON · 실거래 가능' | 'OFF · 실거래 차단' {
  return live === true ? 'ON · 실거래 가능' : 'OFF · 실거래 차단';
}
