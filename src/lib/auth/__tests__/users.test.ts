/**
 * 회원 도메인 순수 함수 테스트 (DB 미접속 — T-008 §테스트 전략 단계 1).
 * 운영 DB 는 SELECT only 원칙이라 CRUD 는 QA 의 dev 서버 실행 검증으로 넘긴다.
 */
import {
  DEFAULT_USER_SETTINGS,
  SETTING_KEY_BY_FIELD,
  USER_SETTING_KEYS,
  defaultSettingRows,
  isDuplicateEmailError,
  isValidEmail,
  maskEmail,
  normalizeEmail,
  parseUserSettings,
  validatePct,
} from '../users';

describe('normalizeEmail / isValidEmail', () => {
  test('lowercase + trim', () => {
    expect(normalizeEmail('  User@Example.COM ')).toBe('user@example.com');
    expect(normalizeEmail(undefined)).toBe('');
    expect(normalizeEmail(42)).toBe('');
  });

  test('형식 검사', () => {
    for (const good of ['a@b.co', 'user.name+tag@example.com', '한글@example.com']) {
      expect(isValidEmail(good)).toBe(true);
    }
    for (const bad of ['', 'noatsign', 'a@b', 'a@@b.com', 'a b@c.com', `${'a'.repeat(250)}@example.com`]) {
      expect(isValidEmail(bad)).toBe(false);
    }
  });
});

describe('maskEmail — 알림·로그에 실주소를 남기지 않는다', () => {
  test('로컬파트를 가린다', () => {
    expect(maskEmail('brownjeon@example.com')).toBe('br*******@example.com');
    expect(maskEmail('ab@x.com')).toBe('ab*@x.com');
    expect(maskEmail('a@x.com')).toBe('a*@x.com');
    expect(maskEmail('')).toBe('***');
    expect(maskEmail('@x.com')).toBe('***');
  });
});

describe('user_settings 기본값 시드', () => {
  test('4개 키를 모두 시드한다 (미시드 상태 금지)', () => {
    const rows = defaultSettingRows();
    expect(rows.map(([k]) => k).sort()).toEqual([...USER_SETTING_KEYS].sort());
  });

  test('dry_run 은 true 로 시작한다 (실주문 차단이 기본)', () => {
    const rows = new Map(defaultSettingRows());
    expect(rows.get('dry_run')).toBe('true');
    expect(rows.get('kill_switch')).toBe('false');
    expect(rows.get('order_max_pct')).toBe('5');
    expect(rows.get('daily_order_max_pct')).toBe('10');
    expect(DEFAULT_USER_SETTINGS).toEqual({ dryRun: true, killSwitch: false, orderMaxPct: 5, dailyOrderMaxPct: 10 });
  });

  test('필드↔키 매핑이 일대일', () => {
    expect(Object.values(SETTING_KEY_BY_FIELD).sort()).toEqual([...USER_SETTING_KEYS].sort());
  });
});

describe('parseUserSettings', () => {
  test('정상 행을 그대로 읽는다', () => {
    const { settings, missingKeys } = parseUserSettings([
      { key: 'dry_run', value: 'false' },
      { key: 'kill_switch', value: 'true' },
      { key: 'order_max_pct', value: '3.5' },
      { key: 'daily_order_max_pct', value: '7' },
    ]);
    expect(missingKeys).toEqual([]);
    expect(settings).toEqual({ dryRun: false, killSwitch: true, orderMaxPct: 3.5, dailyOrderMaxPct: 7 });
  });

  test('결손 키는 fail-safe 기본값 + missingKeys 보고', () => {
    const { settings, missingKeys } = parseUserSettings([]);
    expect(missingKeys.sort()).toEqual([...USER_SETTING_KEYS].sort());
    // 안전한 방향: 모의 매매 켜짐 / 한도 0(= 거부)
    expect(settings.dryRun).toBe(true);
    expect(settings.orderMaxPct).toBe(0);
    expect(settings.dailyOrderMaxPct).toBe(0);
  });

  test('타입이 어긋난 값은 결손으로 취급 (문자열 "true" 를 불리언으로 오독하지 않는다)', () => {
    const { settings, missingKeys } = parseUserSettings([
      { key: 'dry_run', value: '"false"' },     // 문자열
      { key: 'kill_switch', value: 'not-json' }, // 파싱 불가
      { key: 'order_max_pct', value: '"5"' },    // 숫자 문자열 → 허용(Number 변환)
      { key: 'daily_order_max_pct', value: 'null' },
    ]);
    expect(missingKeys).toContain('dry_run');
    expect(missingKeys).toContain('kill_switch');
    expect(missingKeys).toContain('daily_order_max_pct');
    expect(settings.dryRun).toBe(true);          // fail-safe
    expect(settings.orderMaxPct).toBe(5);
  });

  test('알 수 없는 키는 무시', () => {
    const { missingKeys } = parseUserSettings([
      ...defaultSettingRows().map(([key, value]) => ({ key, value })),
      { key: 'unknown_key', value: '"x"' },
    ]);
    expect(missingKeys).toEqual([]);
  });
});

describe('validatePct', () => {
  test('0~100 만 허용', () => {
    expect(validatePct(0)).toEqual({ ok: true, value: 0 });
    expect(validatePct(100)).toEqual({ ok: true, value: 100 });
    expect(validatePct('5.5')).toEqual({ ok: true, value: 5.5 });
    expect(validatePct(-1).ok).toBe(false);
    expect(validatePct(101).ok).toBe(false);
    expect(validatePct('abc').ok).toBe(false);
    expect(validatePct(undefined).ok).toBe(false);
    expect(validatePct(Infinity).ok).toBe(false);
  });
});

describe('isDuplicateEmailError', () => {
  test('ER_DUP_ENTRY 만 중복으로 본다', () => {
    expect(isDuplicateEmailError({ code: 'ER_DUP_ENTRY' })).toBe(true);
    expect(isDuplicateEmailError({ code: 'ER_NO_SUCH_TABLE' })).toBe(false);
    expect(isDuplicateEmailError(new Error('boom'))).toBe(false);
    expect(isDuplicateEmailError(null)).toBe(false);
  });
});
