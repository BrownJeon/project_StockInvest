/**
 * exit-switch — **자동 청산 엔진 마스터 스위치** (T-015).
 *
 * `runExitEngine` 이 만드는 네 종류의 청산 시그널
 * (`hard_stop` · `eod_loss_cut` · `trailing_stop` · `target_profit`)을
 * **한 개의 `system_config` 키로 통째로 끈다.**
 *
 * ## 무엇을 끄고 무엇을 끄지 않는가
 *
 * | 대상                                   | OFF 일 때 |
 * |----------------------------------------|-----------|
 * | 청산 시그널 **생성** (`createSignal`)   | ❌ 하지 않음 |
 * | 청산 **주문 자동 제출** (`submitOrder`) | ❌ 하지 않음 (생성이 없으므로 도달 불가) |
 * | `position_state` 진입가·**고점(peak) 추적** | ✅ **계속 갱신한다** |
 * | `reconcilePositionState` (미보유 row 정리) | ✅ 계속 실행 |
 * | **매수** 파이프라인 (룰 발화·승인 대기 큐)  | ✅ 완전 무관 — 이 모듈은 매수 경로를 전혀 보지 않는다 |
 * | 룰 전략이 만드는 일반 매도 시그널        | ✅ 그대로 (승인 경로를 탄다 — 자동 청산이 아니다) |
 *
 * 고점 추적을 살려 두는 이유: 나중에 다시 켰을 때 트레일링 기준선이 "재진입 시점 가격"으로
 * 리셋되면 트레일링 스탑이 **틀린 기준**으로 계산된다. 스위치는 *행동*을 멈추는 것이지
 * *관측*을 멈추는 것이 아니다.
 *
 * ## 기본 방향 — 판독 실패·키 부재는 **비활성(fail-closed)**
 *
 * 형제 플래그 `exit_hard_stop_enabled` 는 DB 실패 시 **활성**으로 떨어진다. 그 키는
 * "보호 장치를 켜 두는 쪽이 안전"하기 때문이다. 이 마스터 스위치는 방향이 **반대**다:
 *
 *  - 이 스위치의 존재 이유는 "시스템이 사람 동의 없이 자동 매도하는 것을 멈춘다" 이다.
 *  - DB 블립 한 번에 기본값이 *활성* 으로 떨어지면, 그 틱에 −13%~−46% 포지션들에
 *    **시장가 매도가 실제로 나간다.** 돈이 나가는 것은 되돌릴 수 없다.
 *  - 반대 방향의 실패(잘못 꺼져 있음)는 포지션을 그대로 들고 있는 것이고, 로그·UI·알림으로
 *    즉시 드러나며 값 하나로 복구된다.
 *  - 프로젝트에 이미 같은 원칙이 있다 — `autopilot_mode='auto'`(무인 주문 송신)는 **명시적
 *    직접 기입으로만** 도달 가능하다(`signals/router.ts`). 자동 매도도 동일하게
 *    **명시적 opt-in** 으로만 켜진다.
 *
 * 따라서 **정확히 `true` 로 읽혔을 때만 활성**이다. 키 부재·빈 값·해석 불가·DB 오류는 전부 비활성.
 */

import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { parseBoolFlag, shouldReportUnparsable } from '@/lib/safety/flags';

/** 마스터 스위치 키 — 정확히 `true` 일 때만 자동 청산이 동작한다. */
export const EXIT_ENGINE_ENABLED_KEY = 'exit_engine_enabled';

/** 하위 스위치 — 마스터가 ON 일 때 `hard_stop` 만 따로 끄는 기존 키. */
export const EXIT_HARD_STOP_ENABLED_KEY = 'exit_hard_stop_enabled';

/** 마스터 스위치 값을 어디서/어떻게 읽었는가. 진단·UI 표기용. */
export type ExitSwitchSource =
  /** 키가 있고 true/false 로 정상 해석됨 */
  | 'config'
  /** 키 자체가 없음(또는 빈 값) — 비활성으로 처리 */
  | 'absent'
  /** 값은 있으나 불리언으로 해석 불가 — 비활성으로 처리 */
  | 'unparsable'
  /** DB 조회 실패 — 비활성으로 처리 */
  | 'db_error';

export interface ExitEngineSwitch {
  /** 자동 청산 시그널 생성·자동 제출 전체 on/off. `true` 일 때만 기존 동작. */
  enabled: boolean;
  /** 하위 스위치. `enabled=false` 면 의미 없음(어차피 전부 차단). */
  hardStopEnabled: boolean;
  source: ExitSwitchSource;
  /** 해석 불가였을 때의 원본 값 (진단용). 그 외엔 null. */
  raw: string | null;
  /** DB 오류 메시지 (있으면). */
  error: string | null;
}

/**
 * `system_config.value` 는 JSON 문자열로 저장된다(`'true'` / `'false'`).
 * 과거에 손으로 넣은 비-JSON 값(`on` 등)도 버리지 않고 원문 그대로 파서에 넘긴다.
 */
function decodeConfigValue(raw: string | null | undefined): unknown {
  if (raw == null) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

/**
 * 마스터 스위치 + 하위 hard_stop 스위치를 **쿼리 1회**로 읽는다.
 *
 * - **절대 throw 하지 않는다.** 어떤 실패든 비활성(fail-closed)으로 수렴한다.
 * - **캐시하지 않는다.** 자금이 오가는 스위치라, UI 에서 끈 값이 캐시 때문에 몇 분 더
 *   살아 있으면 그것 자체가 사고다(`getEngineSwitches()` 와 같은 원칙).
 */
export async function readExitEngineSwitch(): Promise<ExitEngineSwitch> {
  let rows: (RowDataPacket & { key: string; value: string })[] = [];
  try {
    const pool = getPool();
    [rows] = await pool.query<(RowDataPacket & { key: string; value: string })[]>(
      'SELECT `key`, value FROM system_config WHERE `key` IN (?, ?)',
      [EXIT_ENGINE_ENABLED_KEY, EXIT_HARD_STOP_ENABLED_KEY],
    );
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    // 🔴 DB 를 못 읽으면 자동 매도를 하지 않는다. "모르면 팔지 않는다."
    return { enabled: false, hardStopEnabled: true, source: 'db_error', raw: null, error };
  }

  const byKey = new Map<string, string>();
  for (const r of rows ?? []) byKey.set(String(r.key), String(r.value));

  // ── 마스터 ──────────────────────────────────────────────────────────────
  const masterFlag = parseBoolFlag(decodeConfigValue(byKey.get(EXIT_ENGINE_ENABLED_KEY)));
  let enabled = false;
  let source: ExitSwitchSource = 'absent';
  let raw: string | null = null;
  if (masterFlag.state === 'parsed') {
    enabled = masterFlag.value;
    source = 'config';
  } else if (masterFlag.state === 'unparsable') {
    enabled = false;
    source = 'unparsable';
    raw = masterFlag.raw;
    if (shouldReportUnparsable(`system_config.${EXIT_ENGINE_ENABLED_KEY}`, masterFlag.raw)) {
      console.error(
        `[exit-switch] ${EXIT_ENGINE_ENABLED_KEY} 값을 해석할 수 없음(${JSON.stringify(masterFlag.raw)}) — ` +
        '안전을 위해 **자동 청산 비활성**으로 처리합니다. true/false 로 바로잡으면 즉시 반영됩니다.',
      );
    }
  }

  // ── 하위 hard_stop — 기존 의미 보존(명시적 false 일 때만 OFF) ──────────────
  // 마스터를 다시 켰을 때 이전과 정확히 같은 동작으로 복귀해야 하므로 방향을 바꾸지 않는다.
  const hsFlag = parseBoolFlag(decodeConfigValue(byKey.get(EXIT_HARD_STOP_ENABLED_KEY)));
  const hardStopEnabled = hsFlag.state === 'parsed' ? hsFlag.value : true;

  return { enabled, hardStopEnabled, source, raw, error: null };
}

/** 사람이 읽는 한 줄 요약 — 부팅 로그·틱 로그·알림이 같은 문구를 쓰게 한다. */
export function describeExitEngineSwitch(s: ExitEngineSwitch): string {
  const reason =
    s.source === 'config'     ? `system_config.${EXIT_ENGINE_ENABLED_KEY}=${s.enabled}`
    : s.source === 'absent'     ? `system_config.${EXIT_ENGINE_ENABLED_KEY} 키 없음 → 비활성(기본값)`
    : s.source === 'unparsable' ? `system_config.${EXIT_ENGINE_ENABLED_KEY} 해석 불가(${JSON.stringify(s.raw)}) → 비활성`
    :                             `system_config 조회 실패(${s.error ?? 'unknown'}) → 비활성`;
  if (!s.enabled) {
    return '자동 청산 엔진 OFF — 하드손절·EOD손절·트레일링스탑·목표익절이 '
      + `자동 매도 주문을 내지 않습니다 (${reason})`;
  }
  return `자동 청산 엔진 ON — 하드손절${s.hardStopEnabled ? '' : '(개별 OFF)'}·EOD손절·트레일링스탑·목표익절 동작 중 (${reason})`;
}
