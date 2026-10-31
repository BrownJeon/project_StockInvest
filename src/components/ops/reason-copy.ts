/**
 * T-108 사유 코드 → 화면 말 — T-128 A2 부터 정본은 `src/lib/ops/reason-dictionary.ts`(서버 `activity.ts` 와 한 출처).
 * 이 파일은 기존 import 경로(`@/components/ops/reason-copy`)를 지키는 **다시 내보내기만** 한다 — 사전·함수·문구는 그 모듈에 있다.
 * (T-130: 사전에 새 이름을 넣으면 여기서도 **같은 이름으로** 다시 내보낸다 — 키 집합 일치 시험 `reason-dictionary-keys.test.ts`.)
 */
export {
  UNKNOWN_REASON,
  UNKNOWN_JOB,
  ORDER_REASON_KO,
  orderReasonText,
  ANALYSIS_REASON_KO,
  analysisReasonText,
  skipReasonCode,
  skipText,
  SAFETY_ERROR_KO,
  safetyErrorsText,
  FETCH_ERROR_KO,
  METRIC_ERROR_CHIP_KO,
  LOGIN_REQUIRED_CHIP,
  errorChipText,
  JOB_NAME_KO,
  jobNameText,
  EXCLUSION_KO,
  exclusionText,
  EXIT_KIND_LABEL,
  exitKindLabel,
  signalFate,
  skippedFate,
  blockedChipText,
} from '@/lib/ops/reason-dictionary';
export type { SignalFate } from '@/lib/ops/reason-dictionary';
