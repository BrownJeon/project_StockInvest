/**
 * `signals.status` 상태 상수 — **순수 모듈 (import 0개)**.
 *
 * 이 파일 하나가 진실이다:
 *  - `src/lib/db.ts` 는 여기서 **DDL(ENUM 정의)을 생성**하고 부팅 시 실제 컬럼과 대조한다.
 *  - `signals/router.ts` · `signals/service.ts` · `strategy/engine.ts` 는 여기서 **상태 판정**을 가져온다.
 *
 * 배경 (T-002 H1 / T-003 §4-2): 코드가 쓰는 상태(`pending_approval`)가 ENUM 에 없었고,
 * MariaDB `sql_mode=STRICT_TRANS_TABLES` 에서 범위 밖 ENUM 값 INSERT 는 **하드 에러**라
 * 시그널이 무증상 전멸했다. 코드와 DB 가 서로 다른 목록을 들고 있던 것이 근본 원인이므로,
 * 목록을 하나로 합치고 부팅 시 대조(`assertSignalStatusEnum`)해 불일치면 기동을 막는다.
 *
 * ⚠️ 규칙 — **append-only**:
 *   1. 값을 **제거하거나 순서를 바꾸지 않는다.** ENUM 끝에 값을 추가하는 ALTER 는 메타데이터만
 *      바꾸는 인플레이스 연산이지만, 제거·재배열은 운영 테이블 리빌드 + 기존 row 손상 위험이다.
 *   2. 새 상태는 **배열 끝에 append** 한다.
 *   3. 구 상태는 읽기 호환만 유지하고(`normalizeSignalStatus`) 새로 쓰지 않는다.
 */

/**
 * `signals.status` ENUM 의 값 목록 — **DB ENUM 순서와 1:1로 같아야 한다.**
 *
 * 앞 10개는 2026-08-06 운영 DB 실측 순서 그대로다(재배열 금지).
 * 뒤 3개가 Phase 2([[T-003-phase2-pipeline-redesign]] §4-2)에서 append 된 신규 상태다.
 */
export const SIGNAL_STATUSES = [
  // ── 레거시 (운영 ENUM 실측 순서 — 절대 재배열·제거 금지) ────────────────
  'pending',                 // 구 assist 대기. → 신규 코드는 awaiting_approval 로 쓴다
  'approved',
  'rejected',
  'auto_submitted',
  'expired',
  'superseded',
  'ai_skipped',              // 구 스킵 감사. → 신규 코드는 skipped 로 일반화
  'approved_pending_entry',
  'executing',
  'pending_approval',        // 구 하이브리드 대기. → 신규 코드는 awaiting_approval
  // ── Phase 2 신규 (T-003 §4-2) — 끝에 append ────────────────────────────
  'detected',                // manual 모드: 관측 기록만. 주문 경로 없음, TTL 후 expired
  'awaiting_approval',       // assist 모드: 사람 승인 대기 (구 pending / pending_approval 통합)
  'skipped',                 // 게이트 감사 기록 (구 ai_skipped 일반화)
] as const;

export type SignalStatus = (typeof SIGNAL_STATUSES)[number];

/** 신규 코드가 더 이상 **쓰지 않는** 상태 (읽기 호환만 유지). */
export const LEGACY_SIGNAL_STATUSES = ['pending', 'pending_approval', 'ai_skipped'] as const;

/**
 * "사람의 승인을 기다리는" 상태 전부 — 구 값 포함.
 * 승인/거부 가능 여부 판정과 만료 대상 조회에 쓴다.
 */
export const AWAITING_APPROVAL_STATUSES = [
  'awaiting_approval',
  'pending_approval',   // 구 하이브리드
  'pending',            // 구 기본
] as const satisfies readonly SignalStatus[];

/**
 * TTL 이 지나면 `expired` 로 넘겨야 하는 상태.
 * `detected`(manual 관측 기록)도 TTL 후 만료된다 — T-003 §4-1.
 */
export const EXPIRABLE_STATUSES = [
  ...AWAITING_APPROVAL_STATUSES,
  'detected',
] as const satisfies readonly SignalStatus[];

/**
 * "아직 살아 있는" 시그널 — 중복 생성 차단·쿨다운 조회의 기준 집합.
 *
 * ⚠️ T-002 H3: 여기에 실존하지 않는 값(`executed`·`accepted`)을 넣었던 탓에 exit 쿨다운이
 *    사실상 무효였다(중복 청산 위험). 이 배열은 `SIGNAL_STATUSES` 의 부분집합임이
 *    타입으로 강제된다.
 */
export const ACTIVE_SIGNAL_STATUSES = [
  ...AWAITING_APPROVAL_STATUSES,
  'detected',
  'approved',
  'approved_pending_entry',
  'auto_submitted',
  'executing',
] as const satisfies readonly SignalStatus[];

/** 스킵 감사 기록 상태 (구·신). 통계 조회는 두 값을 모두 봐야 한다. */
export const SKIP_AUDIT_STATUSES = ['ai_skipped', 'skipped'] as const satisfies readonly SignalStatus[];

/** 구 상태 → 신규 상태 매핑 (읽기 호환). 신규 상태는 그대로 통과. */
const LEGACY_ALIAS: Partial<Record<SignalStatus, SignalStatus>> = {
  pending: 'awaiting_approval',
  pending_approval: 'awaiting_approval',
  ai_skipped: 'skipped',
};

/**
 * 저장된 상태를 신규 상태 어휘로 정규화한다 (표시·분기용).
 * DB 에 다시 쓰지는 않는다 — 대량 UPDATE 를 피하려는 게 §4-2 3항의 취지다.
 */
export function normalizeSignalStatus(status: string): SignalStatus | null {
  if (!isSignalStatus(status)) return null;
  return LEGACY_ALIAS[status] ?? status;
}

export function isSignalStatus(status: string): status is SignalStatus {
  return (SIGNAL_STATUSES as readonly string[]).includes(status);
}

/** 사람의 승인을 기다리는 상태인가 (구 값 포함). */
export function isAwaitingApproval(status: string): boolean {
  return (AWAITING_APPROVAL_STATUSES as readonly string[]).includes(status);
}

/**
 * SQL `IN (...)` 절에 그대로 넣을 수 있는 리터럴 목록을 만든다 — `'a','b','c'`.
 *
 * 입력이 **코드 상수(SignalStatus)뿐**이라 인젝션 표면이 없다. 방어적으로 상수 목록에
 * 없는 값은 throw 한다 (오타로 실존하지 않는 상태를 조회하던 T-002 H3 재발 방지).
 */
export function sqlStatusList(statuses: readonly SignalStatus[]): string {
  for (const s of statuses) {
    if (!isSignalStatus(s)) throw new Error(`unknown signal status: ${String(s)}`);
  }
  return statuses.map((s) => `'${s}'`).join(',');
}

/** `ENUM('a','b',...)` 형태의 컬럼 타입 정의를 코드 상수에서 생성한다. */
export function buildSignalStatusEnumDDL(statuses: readonly string[] = SIGNAL_STATUSES): string {
  return `ENUM(${statuses.map((s) => `'${s}'`).join(',')})`;
}

/** `enum('a','b',...)` (INFORMATION_SCHEMA.COLUMNS.COLUMN_TYPE) 를 값 배열로 파싱. */
export function parseEnumColumnType(columnType: string): string[] {
  const body = /^enum\((.*)\)$/i.exec(columnType.trim());
  if (!body) return [];
  const out: string[] = [];
  const re = /'((?:[^']|'')*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body[1])) !== null) out.push(m[1].replace(/''/g, "'"));
  return out;
}

/**
 * 코드 상수에는 있는데 DB ENUM 에는 없는 상태 목록.
 * (반대 방향 — DB 에만 있는 값 — 은 정상이다. 확장만 하고 축소하지 않기 때문.)
 */
export function findMissingSignalStatuses(
  columnType: string,
  statuses: readonly string[] = SIGNAL_STATUSES,
): string[] {
  const present = new Set(parseEnumColumnType(columnType));
  if (present.size === 0) return [];   // 파싱 불가 = 판정 불가. 오탐으로 기동을 막지 않는다
  return statuses.filter((s) => !present.has(s));
}

/**
 * 스키마 검증 자체를 **수행하지 못했다**는 오류.
 *
 * 검증기의 실패 모드가 조용하면 그것이 방지하려던 버그 클래스를 그대로 재현한다.
 * 예: `INFORMATION_SCHEMA` 권한 문제로 메타데이터 조회만 막히고 일반 쿼리는 되는 상황 —
 * 이때 검증기가 조용히 자기 자신을 건너뛰면 가드는 장식품이 된다.
 * 그래서 "검증 불가" 는 "검증 통과" 가 아니라 **치명 오류**로 다룬다.
 */
export class SchemaVerificationError extends Error {
  /** 부팅 치명 오류 마커 — db.ts 의 ensureSetup 이 이 플래그로 fail-closed 를 결정한다. */
  readonly isSchemaFatal = true as const;
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'SchemaVerificationError';
  }
}

/** 코드-DB ENUM 불일치 — 기동을 중단시키는 치명 오류. */
export class SignalStatusEnumMismatchError extends Error {
  readonly isSchemaFatal = true as const;
  readonly missing: string[];
  readonly columnType: string;
  constructor(missing: string[], columnType: string) {
    super(
      `signals.status ENUM 에 코드가 사용하는 상태가 없습니다: ${missing.join(', ')}. ` +
      `해당 상태의 INSERT 는 STRICT 모드에서 전부 실패하므로 기동을 중단합니다. (현재: ${columnType})`,
    );
    this.name = 'SignalStatusEnumMismatchError';
    this.missing = missing;
    this.columnType = columnType;
  }
}

/** 부팅 치명(fail-closed) 오류인지 판별 — db.ts 가 이 마커로 기동 차단을 결정한다. */
export function isSchemaFatalError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { isSchemaFatal?: unknown }).isSchemaFatal === true;
}

/**
 * 부팅 시 fail-closed 검증 (T-003 §4-2 "재발 방지").
 *
 *  - 코드 상태가 DB ENUM 에 하나라도 없으면 → `SignalStatusEnumMismatchError`
 *  - `columnType` 을 읽지 못했거나 파싱 불가면 → `SchemaVerificationError`
 *
 * **"검증 불가"를 "통과"로 취급하지 않는다.** 이 검증기는 스키마 불일치가 STRICT 모드에서
 * 무증상 전멸을 일으켰기 때문에 존재한다. 검증기 자신의 실패가 조용하면 같은 사고가 반복된다.
 */
export function assertSignalStatusEnum(
  columnType: string,
  statuses: readonly string[] = SIGNAL_STATUSES,
): void {
  if (parseEnumColumnType(columnType).length === 0) {
    throw new SchemaVerificationError(
      `signals.status 의 COLUMN_TYPE 을 읽거나 파싱하지 못해 ENUM 검증을 수행할 수 없습니다 ` +
      `(받은 값: ${JSON.stringify(columnType)}). 검증 불가는 통과가 아니므로 기동을 중단합니다. ` +
      `INFORMATION_SCHEMA 조회 권한과 DB 연결을 확인하라.`,
    );
  }
  const missing = findMissingSignalStatuses(columnType, statuses);
  if (missing.length > 0) throw new SignalStatusEnumMismatchError(missing, columnType);
}
