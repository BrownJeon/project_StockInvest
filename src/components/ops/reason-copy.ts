/**
 * T-108 사유 코드 → 화면 말 — T-128 A2 부터 정본은 `src/lib/ops/reason-dictionary.ts`(서버 `activity.ts` 와 한 출처).
 * 이 파일은 기존 import 경로(`@/components/ops/reason-copy`)를 지키는 **다시 내보내기만** 한다 — 사전·함수·문구는 그 모듈에 있다.
 */
export {
  ORDER_REASON_KO,
  orderReasonText,
  ANALYSIS_REASON_KO,
  analysisReasonText,
  skipReasonCode,
  skipText,
  SAFETY_ERROR_KO,
  safetyErrorsText,
} from '@/lib/ops/reason-dictionary';
