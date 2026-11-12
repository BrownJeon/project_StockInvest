/**
 * T-165 거시 레짐 라벨(C0) — 엔진에 노출하는 것은 이 세 함수뿐이다.
 *
 * 🔴 기록 전용: `getMacroRegimeRecord()` 의 반환값은 `eval_funnel` 최종 run 행 `detail.macroRegime` 과
 * (T-167) 장기 보관 표 기록기 `recordMacroRegimeLabel()` 의 인자에만 넣는다. 매매 판단·게이트·사이징·AI 프롬프트에
 * 쓰지 않는다(의존 경계 시험이 고정).
 */
export { kickMacroRegimeRefresh, getMacroRegimeRecord } from './snapshot';
export { recordMacroRegimeLabel } from './label-log';
