/**
 * signals.status 상태 상수 · 부팅 ENUM 검증 단위 테스트 (T-003 §4-2).
 *
 * 이 파일이 지키는 계약:
 *  1. **append-only** — 운영 DB 에 이미 있는 값의 순서·존재를 코드가 바꾸지 못한다
 *     (제거·재배열은 운영 테이블 리빌드를 유발한다).
 *  2. **fail-closed** — 코드가 쓰는 상태가 DB ENUM 에 없으면 부팅이 실패해야 한다
 *     (T-002 H1: STRICT 모드에서 무증상 전멸했던 사고의 구조적 재발 방지).
 *  3. 쿨다운·중복 조회에 쓰는 상태 목록에 **실존하지 않는 값이 섞이지 않는다**
 *     (T-002 H3: 'executed','accepted' 오타로 exit 쿨다운이 영구 무효 = 중복 청산 위험).
 */
import {
  ACTIVE_SIGNAL_STATUSES,
  AWAITING_APPROVAL_STATUSES,
  EXPIRABLE_STATUSES,
  SIGNAL_STATUSES,
  SchemaVerificationError,
  SignalStatusEnumMismatchError,
  assertSignalStatusEnum,
  isSchemaFatalError,
  buildSignalStatusEnumDDL,
  findMissingSignalStatuses,
  isAwaitingApproval,
  normalizeSignalStatus,
  parseEnumColumnType,
  sqlStatusList,
} from '../statuses';

/** 2026-08-06 운영 DB 실측 ENUM (T-006 착수 전 SELECT). 이 순서가 절대 기준이다. */
const LIVE_ENUM_2026_08_06 = [
  'pending', 'approved', 'rejected', 'auto_submitted', 'expired', 'superseded',
  'ai_skipped', 'approved_pending_entry', 'executing', 'pending_approval',
];

describe('SIGNAL_STATUSES — append-only 불변식', () => {
  test('운영 ENUM 값이 같은 순서로 배열 앞쪽에 그대로 남아 있다 (제거·재배열 금지)', () => {
    expect(SIGNAL_STATUSES.slice(0, LIVE_ENUM_2026_08_06.length)).toEqual(LIVE_ENUM_2026_08_06);
  });

  test('Phase 2 신규 상태가 뒤에 append 되어 있다', () => {
    expect(SIGNAL_STATUSES.slice(LIVE_ENUM_2026_08_06.length)).toEqual([
      'detected', 'awaiting_approval', 'skipped',
    ]);
  });

  test('중복 값이 없다', () => {
    expect(new Set(SIGNAL_STATUSES).size).toBe(SIGNAL_STATUSES.length);
  });

  test('파생 목록은 전부 SIGNAL_STATUSES 의 부분집합 (T-002 H3 재발 방지)', () => {
    const all = new Set<string>(SIGNAL_STATUSES);
    for (const list of [AWAITING_APPROVAL_STATUSES, EXPIRABLE_STATUSES, ACTIVE_SIGNAL_STATUSES]) {
      for (const s of list) expect(all.has(s)).toBe(true);
    }
  });

  test('ACTIVE_SIGNAL_STATUSES 에 실존하지 않는 executed/accepted 가 없다', () => {
    expect(ACTIVE_SIGNAL_STATUSES as readonly string[]).not.toContain('executed');
    expect(ACTIVE_SIGNAL_STATUSES as readonly string[]).not.toContain('accepted');
  });
});

describe('DDL 생성 · 파싱', () => {
  test('buildSignalStatusEnumDDL 은 코드 상수 순서를 그대로 ENUM 으로 만든다', () => {
    expect(buildSignalStatusEnumDDL(['a', 'b'])).toBe("ENUM('a','b')");
    expect(buildSignalStatusEnumDDL()).toBe(`ENUM(${SIGNAL_STATUSES.map(s => `'${s}'`).join(',')})`);
  });

  test('parseEnumColumnType 은 COLUMN_TYPE 문자열을 값 배열로 되돌린다', () => {
    expect(parseEnumColumnType("enum('pending','pending_approval')")).toEqual(['pending', 'pending_approval']);
    expect(parseEnumColumnType('varchar(32)')).toEqual([]);
  });

  test('생성한 DDL 을 다시 파싱하면 원래 목록이 나온다 (왕복 일치)', () => {
    expect(parseEnumColumnType(buildSignalStatusEnumDDL().toLowerCase())).toEqual([...SIGNAL_STATUSES]);
  });
});

describe('부팅 ENUM 검증 (fail-closed)', () => {
  const fullColType = buildSignalStatusEnumDDL().toLowerCase();

  test('DB 가 코드 목록을 전부 포함하면 통과', () => {
    expect(findMissingSignalStatuses(fullColType)).toEqual([]);
    expect(() => assertSignalStatusEnum(fullColType)).not.toThrow();
  });

  test('DB 에만 있는 값이 더 있는 것은 정상 (확장만 하고 축소하지 않으므로)', () => {
    const superset = "enum(" + [...SIGNAL_STATUSES, 'legacy_only'].map(s => `'${s}'`).join(',') + ")";
    expect(() => assertSignalStatusEnum(superset)).not.toThrow();
  });

  test('코드 상태가 DB 에 없으면 throw — 기동을 막는다', () => {
    const missingOne = buildSignalStatusEnumDDL(
      SIGNAL_STATUSES.filter(s => s !== 'awaiting_approval'),
    ).toLowerCase();
    expect(findMissingSignalStatuses(missingOne)).toEqual(['awaiting_approval']);
    expect(() => assertSignalStatusEnum(missingOne)).toThrow(SignalStatusEnumMismatchError);
    expect(() => assertSignalStatusEnum(missingOne)).toThrow(/awaiting_approval/);
  });

  test('T-002 H1 재현 — pending_approval 이 빠진 ENUM 은 기동 실패', () => {
    const preH1 = "enum('pending','approved','rejected','auto_submitted','expired','superseded')";
    expect(() => assertSignalStatusEnum(preH1)).toThrow(SignalStatusEnumMismatchError);
    expect(findMissingSignalStatuses(preH1)).toContain('pending_approval');
  });

  // reviewer #2 (2026-08-06 Leader override): "검증 불가"를 "통과"로 취급하면
  // 검증기 자신의 실패 모드가 조용해져 원래 사고(무증상 전멸)를 그대로 재현한다.
  // 예: INFORMATION_SCHEMA 권한만 막히고 일반 쿼리는 되는 상황 → 가드가 장식품이 된다.
  test('COLUMN_TYPE 을 못 읽었으면 통과가 아니라 기동 실패다', () => {
    expect(() => assertSignalStatusEnum('')).toThrow(SchemaVerificationError);
    expect(() => assertSignalStatusEnum('varchar(32)')).toThrow(SchemaVerificationError);
    expect(() => assertSignalStatusEnum('')).toThrow(/검증을 수행할 수 없습니다/);
  });

  test('스키마 치명 오류는 두 종류 모두 fail-closed 마커를 갖는다', () => {
    const errors: unknown[] = [];
    try { assertSignalStatusEnum(''); } catch (e) { errors.push(e); }
    try { assertSignalStatusEnum("enum('pending')"); } catch (e) { errors.push(e); }
    expect(errors).toHaveLength(2);
    expect(errors.map(isSchemaFatalError)).toEqual([true, true]);
    // 일반 오류는 기동을 막지 않는다
    expect(isSchemaFatalError(new Error('transient'))).toBe(false);
  });

  test('하위 함수 findMissingSignalStatuses 는 판정만 하고 정책을 갖지 않는다', () => {
    // 정책(=기동 차단)은 assertSignalStatusEnum 한 곳에만 둔다.
    expect(findMissingSignalStatuses('')).toEqual([]);
  });
});

describe('상태 판정 헬퍼', () => {
  test('sqlStatusList 는 SQL IN 절 리터럴을 만든다', () => {
    expect(sqlStatusList(['pending', 'expired'])).toBe("'pending','expired'");
  });

  test('sqlStatusList 는 목록에 없는 값을 거부한다 (오타 조회 차단)', () => {
    expect(() => sqlStatusList(['executed' as never])).toThrow(/unknown signal status/);
  });

  test('isAwaitingApproval — 구 pending/pending_approval 도 승인 대기로 본다', () => {
    expect(isAwaitingApproval('awaiting_approval')).toBe(true);
    expect(isAwaitingApproval('pending')).toBe(true);
    expect(isAwaitingApproval('pending_approval')).toBe(true);
    expect(isAwaitingApproval('detected')).toBe(false);
    expect(isAwaitingApproval('approved')).toBe(false);
  });

  test('normalizeSignalStatus — 구 값을 신규 어휘로 정규화', () => {
    expect(normalizeSignalStatus('pending')).toBe('awaiting_approval');
    expect(normalizeSignalStatus('pending_approval')).toBe('awaiting_approval');
    expect(normalizeSignalStatus('ai_skipped')).toBe('skipped');
    expect(normalizeSignalStatus('approved')).toBe('approved');
    expect(normalizeSignalStatus('nonsense')).toBeNull();
  });
});
