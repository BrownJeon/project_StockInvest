/**
 * T-072 (D5) — **검증 상태 관문.** 검증되지 않은 전략의 **신규 매수**를 막는다. 매도(보호 청산)는 절대 막지 않는다.
 *
 * ## 판정 (설계 F-2·L-5·Stage 0 D 절)
 * 1. **첫 줄이 `side` 판정이다.** side 를 정규화(`String(side).trim().toLowerCase()`)해 **정확히 `'sell'` 일 때만** 매도로 보고
 *    **어떤 I/O 도 하지 않고** 허용한다. 조회 실패가 매도 실패로 번질 길을 만들지 않기 위해서다(`order-limits.ts` 의 "매도는 던지지
 *    않음" 불변식과 같은 이유). `'SELL'`·`' sell '` 같은 대소문자·공백 변형 매도도 매도로 보호한다.
 *    🔴 그 밖의 **모든 값**(`'buy'`·`'BUY'`·`'Buy'`·`'buy '`·`'purchase'`·빈 문자열·null·undefined·비문자열)은 **매수로 보고 판정**한다
 *    (fail-closed, WP-2c R-1). 예전에는 정확히 `'buy'` 만 매수로 봤는데, MariaDB ENUM 이 대소문자·뒤 공백을 무시해 `'BUY'` 를 `buy` 로
 *    저장하므로 대문자 입력이 앞단 관문(G1·G3)을 건너뛰고 매수 행이 생겼다(뒤의 G5·G6 가 막아 자금 위험은 없었지만 방어가 한 겹 비었다).
 *    매도를 "정확히 식별해 통과"시키고 나머지는 판정하는 쪽이 모르는 값에 안전하다.
 * 2. 매수면 `SELECT validation_status FROM strategies WHERE id = ? LIMIT 1` 을 **매번** 읽는다(캐시 없음 — 강등 시 캐시 TTL 만큼
 *    fail-open 창이 생긴다. `router.ts` "자금이 오가는 스위치는 캐시하지 않는다" 선례).
 * 3. 허용 = `backtested` | `paper_validated` **뿐**. 나머지는 전부 차단(fail-closed):
 *
 * | 상황 | reason |
 * |---|---|
 * | 전략 ID 가 null·undefined·빈 문자열·문자열 아님 | `null_strategy` |
 * | `strategies` 에 행 없음 | `unregistered` |
 * | 값이 `unvalidated` | `unvalidated` |
 * | 값이 허용 집합·`unvalidated` 밖(NULL·대소문자 다름 등) | `invalid_status` |
 * | 조회 예외(마이그레이션 전 `ER_BAD_FIELD_ERROR`·DB 장애·`getPool` 실패 포함) | `lookup_error` |
 *
 * ## T-058 현금 게이트(`signal-cash-gate.ts`)와 **반대 규칙**이다 — 복제하지 말 것
 * 그쪽은 "모르면 막지 않는다 · 스위치 읽기 오류 = 꺼짐 · 30초 캐시"다. 이 관문은 모르면 막고, **끄는 스위치가 없고**, 캐시가 없다.
 *
 * 이 함수는 던지지 않는다. 상태 승급·강등은 코드가 하지 않는다(사용자 승인 SQL 로만 — 설계 F-10).
 *
 * ## 호출 지점 (T-072 G1~G6)
 * G1 `createSignal` · G2 post-market 카드 INSERT · G3 `custom/confirm` · G4 `approveSignal`/`approveSignalHybrid` ·
 * G5 `entry-watcher` · G6 `submitOrder`(최후 방어선). **모든 지점이 side 판정을 이 함수에 맡긴다**(WP-2c — 호출부의 `=== 'buy'`
 * 지역 분기를 없앴다: 지역 분기는 `'BUY'` 같은 변형을 매수가 아닌 것으로 걸러 이 함수까지 오지 못하게 했다). 매도 I/O 0 은 이 함수의
 * 첫 줄이 보장한다(시험이 모든 지점에서 strategies 조회 0 을 단언). G2 는 카드가 늘 매수라 `'buy'` 로 부른다.
 */
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

/** 실주문 매수를 허용하는 검증 상태 — D5 "backtested 이상" */
export const VALIDATED_STATUSES = ['backtested', 'paper_validated'] as const;
export type ValidatedStatus = (typeof VALIDATED_STATUSES)[number];
export type ValidationStatus = 'unvalidated' | ValidatedStatus;

export type ValidationGateReason = 'null_strategy' | 'unregistered' | 'unvalidated' | 'invalid_status' | 'lookup_error';

export type ValidationGateVerdict =
  /** 매도다(정규화 후 정확히 'sell') — 판정 대상 아님. I/O 0 */
  | { allowed: true; kind: 'not_applicable' }
  | { allowed: true; kind: 'validated'; strategyId: string; status: ValidatedStatus }
  | {
    allowed: false;
    kind: 'blocked';
    reason: ValidationGateReason;
    /** 판정에 쓴 전략 ID (null_strategy 면 null) */
    strategyId: string | null;
    /** 읽은 원값(문자열화). 행 없음·조회 실패면 null */
    status: string | null;
    /** lookup_error 의 원인(오류 코드·메시지 일부) */
    detail?: string;
  };

export interface ValidationGateInput {
  /** 런타임에 무엇이 와도 된다 — 정규화해서 정확히 `'sell'` 이면 허용(I/O 0), 그 밖의 모든 값은 매수로 판정한다 */
  side: unknown;
  strategyId: unknown;
}

export function isValidatedStatus(v: unknown): v is ValidatedStatus {
  return typeof v === 'string' && (VALIDATED_STATUSES as readonly string[]).includes(v);
}

/**
 * 매도(보호 청산)인가 — 앞뒤 공백 제거·소문자로 정규화해 **정확히 `'sell'`** 일 때만 true. 그 밖의 모든 값은 false(= 매수로 판정).
 * 던지지 않는다(문자열화가 던지는 값도 매수로 본다 — fail-closed).
 */
export function isSellSide(side: unknown): boolean {
  try {
    return String(side).trim().toLowerCase() === 'sell';
  } catch {
    return false;
  }
}

/**
 * 🔴 T-072 WP-2d — **주문 방향 정규화.** 문자열이면 앞뒤 공백 제거·소문자로 바꿔 정확히 `'buy'`·`'sell'` 일 때 그 값, 아니면 null.
 *
 * 왜: 어댑터(`kis-domestic`·`kis-overseas` createOrder)는 `req.side === 'buy'` 일 때만 매수 TR 을 고른다. `'BUY'`·`'buy '` 가 원문 그대로
 * 내려가면 **매도 TR** 로 나가고, 그 앞의 호가 추격 방향·T-058 현금 게이트·`dry-run` 한도 면제(`!== 'sell'`)도 원문 기준으로 어긋난다.
 * 그래서 입구(`POST /api/signals`·`POST /api/orders`·`custom/confirm`·`createSignal`)와 최후 방어선(`submitOrder` 맨 앞)이 이 함수로 바꿔
 * **하류에는 정확한 값만** 넘긴다. null 이면 호출부가 거절한다(400·`invalid_input`·`invalid_side`). 비문자열은 null. 던지지 않는다.
 * (관문 판정용 `isSellSide` 와 다르다 — 그쪽은 "매도만 통과·나머지는 매수로 판정"이고, 이쪽은 "정확한 두 값 외에는 주문 불가"다.)
 */
export function normalizeOrderSide(side: unknown): 'buy' | 'sell' | null {
  if (typeof side !== 'string') return null;
  const s = side.trim().toLowerCase();
  return s === 'buy' || s === 'sell' ? s : null;
}

/** 입구 400 응답 문구(한국어). 하류에는 정규화된 값만 넘긴다 */
export const INVALID_SIDE_USER_MESSAGE = '주문 방향은 buy 또는 sell 이어야 합니다 (대소문자·앞뒤 공백은 허용)';

/** 던지지 않는다. */
export async function evaluateValidationGate(input: ValidationGateInput): Promise<ValidationGateVerdict> {
  // ① side — 매도면 여기서 끝(I/O 0). 이 줄 앞에 I/O 를 두지 않는다. 매도가 아니면 무엇이든 매수로 판정한다(fail-closed).
  if (isSellSide(input.side)) return { allowed: true, kind: 'not_applicable' };

  // ② 전략 귀속
  const sid = input.strategyId;
  if (typeof sid !== 'string' || sid.trim() === '') {
    return { allowed: false, kind: 'blocked', reason: 'null_strategy', strategyId: null, status: null };
  }

  // ③ 상태 조회 — 매번, PK 1행
  let raw: unknown;
  try {
    const [rows] = await getPool().query<(RowDataPacket & { validation_status: unknown })[]>(
      'SELECT validation_status FROM strategies WHERE id = ? LIMIT 1',
      [sid],
    );
    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row) return { allowed: false, kind: 'blocked', reason: 'unregistered', strategyId: sid, status: null };
    raw = row.validation_status;
  } catch (e) {
    return { allowed: false, kind: 'blocked', reason: 'lookup_error', strategyId: sid, status: null, detail: describeError(e) };
  }

  if (isValidatedStatus(raw)) return { allowed: true, kind: 'validated', strategyId: sid, status: raw };
  if (raw === 'unvalidated') return { allowed: false, kind: 'blocked', reason: 'unvalidated', strategyId: sid, status: 'unvalidated' };
  return { allowed: false, kind: 'blocked', reason: 'invalid_status', strategyId: sid, status: raw == null ? null : String(raw).slice(0, 64) };
}

/** 사람이 읽는 한 줄 — 로그·`orders` 차단 상세·`createSignal` error 에 쓴다. 금액·잔고는 싣지 않는다. */
export function describeValidationBlock(v: Extract<ValidationGateVerdict, { allowed: false }>): string {
  const sid = v.strategyId ?? '(전략 없음)';
  switch (v.reason) {
    case 'null_strategy': return '전략 귀속 없음 — 검증 전 신규 매수 차단';
    case 'unregistered': return `등록되지 않은 전략(${sid}) — 검증 전 신규 매수 차단`;
    case 'unvalidated': return `검증 안 된 전략(${sid}: unvalidated) — 신규 매수 차단`;
    case 'invalid_status': return `전략 검증 상태 이상(${sid}: ${v.status ?? 'NULL'}) — 신규 매수 차단`;
    case 'lookup_error': return `전략 검증 상태 조회 실패(${sid}${v.detail ? `: ${v.detail}` : ''}) — 신규 매수 차단`;
  }
}

/**
 * T-072 WP-2b — 관문 차단의 **기계 판독 코드**. 조회 실패(인프라 이상)만 따로 센다 — 막는 것은 같다.
 * `createSignal`·`approveSignal`·`approveSignalHybrid`·`custom/confirm`·`entry-watcher` 가 같은 규칙을 쓴다.
 */
export type ValidationGateErrorCode = 'validation_gate' | 'validation_lookup_error';

export function validationErrorCode(reason: ValidationGateReason): ValidationGateErrorCode {
  return reason === 'lookup_error' ? 'validation_lookup_error' : 'validation_gate';
}

export function isValidationGateErrorCode(v: unknown): v is ValidationGateErrorCode {
  return v === 'validation_gate' || v === 'validation_lookup_error';
}

/**
 * 사람에게 보이는 한국어 문구(웹 승인·텔레그램·custom/confirm). 코드는 괄호 안에 남겨 로그·화면을 대조할 수 있게 한다.
 * 미지의 코드 원문(`validation_gate: 등록되지 않은 전략(...)…`)을 그대로 보이지 않기 위해 한 곳에 둔다.
 */
export const VALIDATION_GATE_USER_MESSAGE: Readonly<Record<ValidationGateErrorCode, string>> = {
  validation_gate: '검증되지 않은 전략이라 매수할 수 없습니다 (validation_gate)',
  validation_lookup_error: '전략 검증 상태를 확인하지 못해 매수하지 않았습니다 — 잠시 뒤 다시 확인하세요 (validation_lookup_error)',
};

/** HTTP 상태 — 정책 거절은 403, 판정에 필요한 조회 실패(서버 쪽 일시 장애)는 503 */
export function validationGateHttpStatus(code: ValidationGateErrorCode): 403 | 503 {
  return code === 'validation_lookup_error' ? 503 : 403;
}

function describeError(e: unknown): string {
  if (e && typeof e === 'object') {
    const code = (e as { code?: unknown }).code;
    const msg = e instanceof Error ? e.message : String(e);
    return (typeof code === 'string' && code ? `${code} ${msg}` : msg).slice(0, 120);
  }
  return String(e).slice(0, 120);
}
