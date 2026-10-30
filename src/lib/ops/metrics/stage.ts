/**
 * 운영 단계 파생 — 안전 상태 띠의 단계 배지 (T-108 가이드 §2.2 표가 정본).
 *
 * **순수 함수 (type import 만)** — 서버 `/api/ops/safety-state` 가 부르고, 시험(A-2)이 전 조합을 대조한다.
 *
 * 우선순위(위에서 첫 일치):
 *   1. `unknown` — 안전 값 중 하나라도 읽기 실패(null) 또는 DB 자체 불통(`db_unreachable`)
 *   2. `halt`    — 모든거래차단 ON. 실거래여부와 무관하게 모든 송신이 막힌다(`dry-run.ts` 의 킬스위치 판정이 DRY_RUN 분기보다 앞)
 *   3. `observe` — 실거래여부 OFF(= dryRun ON) → 주문은 기록만
 *   4. `mixed`   — 실거래여부 ON 인데 「검증 통과 ∧ 켜짐」 전략 0 → 신규 매수는 검증 관문이 막지만 청산 주문은 실제로 나간다
 *   5. `live`    — 나머지(실거래여부 ON ∧ 차단 OFF ∧ 검증 통과 켜진 전략 ≥1)
 *
 * `halt` 가 `observe` 보다 앞인 이유: 모든거래차단 ON 이면 실거래여부 값이 무엇이든 송신 0 이고,
 * 사용자가 읽어야 할 사실은 「모든 주문 차단」이다(가이드 §2.2 마지막 bullet).
 *
 * 청산 엔진 스위치 읽기 실패(`exit_switch_db_error`)는 단계를 바꾸지 않는다 — 그 칩만 `—` 로 보인다(§2.2).
 */
import type { OpsStage } from './types';

export interface StageInput {
  /** 화면 「실거래여부」 — `liveTradingFromDryRun(isDryRun())`. null = 읽기 실패 */
  liveTrading: boolean | null;
  /** 모든거래차단 — `isKillSwitchActive()`. null = 읽기 실패 */
  killSwitch: boolean | null;
  /** 검증 통과(`VALIDATED_STATUSES`) ∧ `enabled=1` 전략 수. null = 읽기 실패 */
  validatedEnabled: number | null;
}

/** 단계를 `unknown` 으로 만드는 오류 코드 (그 밖의 코드는 칩 단위로만 표시). */
export const STAGE_FATAL_ERRORS: readonly string[] = ['db_unreachable', 'strategies_error'];

export function deriveOpsStage(input: StageInput, errors: readonly string[] = []): OpsStage {
  if (errors.some((e) => STAGE_FATAL_ERRORS.includes(e))) return 'unknown';
  const { liveTrading, killSwitch, validatedEnabled } = input;
  if (typeof liveTrading !== 'boolean' || typeof killSwitch !== 'boolean') return 'unknown';
  if (typeof validatedEnabled !== 'number' || !Number.isInteger(validatedEnabled) || validatedEnabled < 0) return 'unknown';
  if (killSwitch === true) return 'halt';
  if (liveTrading !== true) return 'observe';
  if (validatedEnabled === 0) return 'mixed';
  return 'live';
}

/** 홈 지표 세트 선택 — 관찰 세트(A) 또는 실거래 세트(B) (가이드 §2.3). */
export function metricSetFor(stage: OpsStage): 'observe' | 'live' {
  return stage === 'mixed' || stage === 'live' ? 'live' : 'observe';
}
