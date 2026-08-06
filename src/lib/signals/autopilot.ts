/**
 * 자동조종 모드 상수·판정 — **순수 모듈 (import 0개)**.
 *
 * `signals/router.ts`(런타임)와 `db.ts`(부팅 시드)가 같은 규칙을 보게 하려고 분리했다.
 * (router 는 db 를 import 하므로 db 가 router 를 import 하면 순환이 된다)
 */

/**
 * 자동조종 모드 (T-003 §4-2 / D2).
 *
 *  - `manual` : 룰 발화를 관측 기록(`detected`)만 남긴다. 주문 경로 없음, TTL 후 expired
 *  - `assist` : `awaiting_approval` → 사람이 승인하면 주문 (기본값)
 *  - `auto`   : SIGNAL_AUTO_SUBMIT_MAX_KRW 이하만 즉시 자동 제출, 초과분은 assist 로 격하
 */
export type AutopilotMode = 'manual' | 'assist' | 'auto';

export const AUTOPILOT_MODES: readonly AutopilotMode[] = ['manual', 'assist', 'auto'];

/** 사양 §4-1 기본값. 판독 실패·미설정 시에도 "사람이 본다"가 가장 안전하다. */
export const DEFAULT_AUTOPILOT_MODE: AutopilotMode = 'assist';

/** 자율성 서열 — 클수록 사람의 개입이 적다. */
const AUTONOMY_RANK: Record<AutopilotMode, number> = { manual: 0, assist: 1, auto: 2 };

/**
 * **추론으로 도달할 수 있는 최대 자율성.**
 *
 * ⚠️ 이 상수가 이 파일의 존재 이유다. `auto` 는 사람이 자동 주문 송신에 동의했다는 뜻인데,
 *    그 동의는 **`autopilot_mode` 를 직접 쓰는 명시적 행위**로만 성립한다.
 *    자율성을 언급조차 하지 않는 구 스위치(`hybrid_mode_enabled` 토글 등)에서
 *    "추론"으로 `auto` 에 도달하는 경로가 있으면, 사용자는 자기가 무엇에 동의했는지 모른 채
 *    무인 주문 송신을 켜게 된다.
 *
 * 📌 **`auto` 에 실제로 도달하는 유일한 경로**: `system_config.autopilot_mode` 에 `"auto"` 를
 *    직접 기입하는 것(수동 DB/API 조작). 이 앱에는 그 값을 쓰는 UI 도, 코드 경로도 없다.
 *    (`AUTOPILOT_MODE` env 는 아래 `getEngineSwitches` 주석 참고 — 부팅 시드 이후로는
 *     사실상 도달하지 않는다.)
 */
export const MAX_INFERRED_AUTOPILOT_MODE: AutopilotMode = 'assist';

export function parseAutopilotMode(raw: unknown): AutopilotMode | null {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : null;
  return v != null && (AUTOPILOT_MODES as readonly string[]).includes(v) ? (v as AutopilotMode) : null;
}

/**
 * 구 2×2 스위치 → 신규 모드 (T-003 §4-1 마이그레이션 표) — **사양 그대로의 순수 함수**.
 *
 * ⚠️ 이 표는 *마이그레이션* 의미다: "과거 이 설정 조합에서 시스템이 실제로 어떻게 동작했는가".
 *    `analyst=T, hybrid=F` 는 실제로 auto_submit 이었으므로 `auto` 로 매핑하는 게 옳다.
 *    **그러나 이 함수를 런타임 재파생에 그대로 쓰면 안 된다** — 아래 `inferAutopilotModeFromLegacy`
 *    를 쓸 것. 마이그레이션 의미 ≠ 런타임 의미.
 */
export function legacySwitchesToMode(analystEnabled: boolean, hybridEnabled: boolean): AutopilotMode {
  if (hybridEnabled) return 'assist';        // 진입감시 = assist 의 '지정 진입가 승인' 옵션
  return analystEnabled ? 'auto' : 'assist'; // analyst=T → 자동 제출 / analyst=F → 사람 승인
}

/** 추론 결과를 허용 상한으로 잘라낸다. 이미 상한 이하면 그대로 통과. */
export function clampInferredMode(mode: AutopilotMode): AutopilotMode {
  return AUTONOMY_RANK[mode] > AUTONOMY_RANK[MAX_INFERRED_AUTOPILOT_MODE]
    ? MAX_INFERRED_AUTOPILOT_MODE
    : mode;
}

/**
 * 구 키에서 모드를 **추론**한다 (부팅 시드·런타임 동기화 공용).
 *
 * `legacySwitchesToMode` 와 달리 **절대 `auto` 를 반환하지 않는다.**
 * `auto` 로 가려면 `autopilot_mode` 에 직접 `"auto"` 를 기입해야 한다.
 */
export function inferAutopilotModeFromLegacy(analystEnabled: boolean, hybridEnabled: boolean): AutopilotMode {
  return clampInferredMode(legacySwitchesToMode(analystEnabled, hybridEnabled));
}
