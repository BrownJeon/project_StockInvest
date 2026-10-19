/**
 * sell-proposal-policy — 매도 제안(T-055) **미리보기 스위치 + 임계값** 판독기.
 *
 * `exit-switch.ts`(T-015) 패턴을 복제하되 **더 엄격하다**:
 *
 * | 항목 | exit-switch | 이 모듈 |
 * |---|---|---|
 * | 켜짐 판정 | `parseBoolFlag` — `1`·`"on"`·`"yes"` 도 true | **JSON 디코드 결과가 불리언 `true` 일 때만** |
 * | 키 부재·DB 오류 | 비활성 | 비활성 |
 * | 임계값 | — | 하나라도 누락·숫자 아님·범위 밖이면 **전체 비활성** (코드 기본값으로 메우지 않는다) |
 *
 * ## 왜 더 엄격한가
 *
 * 1단계(미리보기)는 주문 경로가 없어 잘못 켜져도 돈이 나가지 않는다. 그래도 이 판독기는 2단계에서
 * **승인 시 실주문이 되는 제안 시그널**의 스위치·임계값 판독기로 그대로 쓰인다. 그때 `1` 이나
 * 문자열 `"true"` 같은 애매한 값이 켜짐으로 읽히거나, 임계값이 빠졌는데 코드 기본값으로 조용히
 * 메워지면 "사용자가 정하지 않은 조건으로 매도 제안이 나간다". 처음부터 명시적 값만 인정한다.
 *
 * - system_config value 는 JSON 문자열로 저장된다(설정 API 가 `JSON.stringify` 사용).
 *   켜짐 = 원문 `true`(→ 불리언 true). 원문 `"true"`(JSON 문자열)·`1`·`on` 은 **꺼짐**.
 * - 임계값은 JSON 숫자만 인정한다(원문 `6`). `"6"`(JSON 문자열)은 무효.
 * - **절대 throw 하지 않는다. 캐시하지 않는다**(스위치를 끄면 다음 틱에 바로 반영).
 * - 부팅 시드(`db.ts`)는 이 모듈의 `SELL_PROPOSAL_CONFIG_SEED` 를 그대로 쓴다(단일 소스).
 */
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { shouldReportUnparsable } from '@/lib/safety/flags';
import { validateSellProposalPolicy, type SellProposalPolicy } from './sell-proposal';

/** 1단계 미리보기 스위치 — 정확히 불리언 `true` 일 때만 켜진다. 기본(시드) false. */
export const SELL_PROPOSAL_PREVIEW_ENABLED_KEY = 'sell_proposal_preview_enabled';
/** 진입가 대비 손실 임계값(%) — 사용자 확정 6 (T-055 Q1) */
export const SELL_PROPOSAL_STOP_PCT_KEY = 'sell_proposal_stop_pct';
/** 거절·만료 뒤 재제안 추가 하락폭(%) — 사용자 확정 5 (Q3). 1단계는 판정기 입력만 받는다 */
export const SELL_PROPOSAL_RESTEP_PCT_KEY = 'sell_proposal_restep_pct';
/** 활성 제안 철회 히스테리시스(%p) — 설계 권고 1 */
export const SELL_PROPOSAL_REBOUND_EXIT_PCT_KEY = 'sell_proposal_rebound_exit_pct';

/** 정책 필드 ↔ system_config 키 */
const POLICY_KEYS: Record<keyof SellProposalPolicy, string> = {
  stopPct: SELL_PROPOSAL_STOP_PCT_KEY,
  restepPct: SELL_PROPOSAL_RESTEP_PCT_KEY,
  reboundExitPct: SELL_PROPOSAL_REBOUND_EXIT_PCT_KEY,
};

/**
 * 부팅 시드 — `INSERT IGNORE` 로만 쓴다(운영자가 정한 값을 부팅이 되돌리지 않는다).
 * 값은 system_config 규약대로 JSON 문자열.
 *
 * 설계 §3.3 의 나머지 키(`sell_proposal_approve_drift_pct`·`_concentration_pct`·`_daily_max`)는
 * 읽는 코드가 2·3단계에 생기므로 지금 시드하지 않는다 — 아무도 읽지 않는 설정 키는 "이 값이
 * 무언가를 제어한다"는 오해만 만든다(`settings/watch-symbols` 전례).
 */
export const SELL_PROPOSAL_CONFIG_SEED: ReadonlyArray<readonly [string, string]> = [
  [SELL_PROPOSAL_PREVIEW_ENABLED_KEY, 'false'],
  [SELL_PROPOSAL_STOP_PCT_KEY, '6'],
  [SELL_PROPOSAL_RESTEP_PCT_KEY, '5'],
  [SELL_PROPOSAL_REBOUND_EXIT_PCT_KEY, '1'],
];

export type SellProposalPreviewSource =
  /** 스위치가 불리언으로 읽혔다 (켜짐이면 정책도 유효) */
  | 'config'
  /** 스위치 키 없음 → 꺼짐 */
  | 'absent'
  /** 스위치 값이 불리언 true/false 가 아님(`"true"`·`1`·`on` 등) → 꺼짐 */
  | 'not_boolean'
  /** 스위치는 true 지만 임계값 누락·무효 → 꺼짐 */
  | 'policy_invalid'
  /** DB 조회 실패 → 꺼짐 */
  | 'db_error';

export interface SellProposalPreviewSwitch {
  /** 미리보기를 돌려도 되는가. `true` 이면 `policy` 는 반드시 non-null 이고 검증을 통과했다. */
  enabled: boolean;
  policy: SellProposalPolicy | null;
  source: SellProposalPreviewSource;
  /** 꺼짐 사유(사람이 읽는 문구). 켜짐이면 빈 배열 */
  problems: string[];
}

function decodeConfigValue(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return raw; }
}

function off(source: SellProposalPreviewSource, problems: string[]): SellProposalPreviewSwitch {
  return { enabled: false, policy: null, source, problems };
}

/** 같은 문제를 틱마다 반복 로그하지 않는다 (문구가 바뀌면 다시 남긴다). */
function reportOnce(problems: string[]): void {
  const text = problems.join('; ');
  if (shouldReportUnparsable('system_config.sell_proposal_*', text)) {
    console.error(`[sell-proposal-policy] 매도 제안 미리보기 비활성 — ${text}`);
  }
}

/**
 * 스위치 + 임계값을 **쿼리 1회**로 읽는다. 어떤 실패든 `enabled=false` 로 수렴한다.
 */
export async function readSellProposalPreviewPolicy(): Promise<SellProposalPreviewSwitch> {
  const keys = [SELL_PROPOSAL_PREVIEW_ENABLED_KEY, ...Object.values(POLICY_KEYS)];
  let rows: (RowDataPacket & { key: string; value: unknown })[] = [];
  try {
    [rows] = await getPool().query<(RowDataPacket & { key: string; value: unknown })[]>(
      'SELECT `key`, value FROM system_config WHERE `key` IN (?, ?, ?, ?)',
      keys,
    );
  } catch (e) {
    return off('db_error', [`system_config 조회 실패: ${e instanceof Error ? e.message : String(e)}`]);
  }

  const byKey = new Map<string, string>();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r == null || r.value == null) continue;
    byKey.set(String(r.key), String(r.value));
  }

  // ── 스위치 — 불리언 true 만 ────────────────────────────────────────────
  const rawSwitch = byKey.get(SELL_PROPOSAL_PREVIEW_ENABLED_KEY);
  if (rawSwitch === undefined || rawSwitch.trim() === '') {
    return off('absent', [`${SELL_PROPOSAL_PREVIEW_ENABLED_KEY} 키 없음`]);
  }
  const sw = decodeConfigValue(rawSwitch);
  if (sw === false) return off('config', [`${SELL_PROPOSAL_PREVIEW_ENABLED_KEY}=false`]);
  if (sw !== true) {
    const problems = [`${SELL_PROPOSAL_PREVIEW_ENABLED_KEY} 값 ${JSON.stringify(rawSwitch)} 는 불리언 true 가 아님 — 꺼짐으로 처리`];
    reportOnce(problems);
    return off('not_boolean', problems);
  }

  // ── 임계값 — 하나라도 문제면 전체 비활성 ─────────────────────────────────
  const problems: string[] = [];
  const draft: Partial<Record<keyof SellProposalPolicy, unknown>> = {};
  for (const [field, key] of Object.entries(POLICY_KEYS) as [keyof SellProposalPolicy, string][]) {
    const raw = byKey.get(key);
    if (raw === undefined || raw.trim() === '') { problems.push(`${key} 키 없음`); continue; }
    const v = decodeConfigValue(raw);
    if (typeof v !== 'number' || !Number.isFinite(v)) { problems.push(`${key} 값 ${JSON.stringify(raw)} 는 숫자가 아님`); continue; }
    draft[field] = v;
  }
  if (problems.length === 0) problems.push(...validateSellProposalPolicy(draft));
  if (problems.length > 0) {
    reportOnce(problems);
    return off('policy_invalid', problems);
  }

  return {
    enabled: true,
    policy: draft as SellProposalPolicy,
    source: 'config',
    problems: [],
  };
}
