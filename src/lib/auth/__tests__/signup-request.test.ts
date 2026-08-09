/**
 * 가입 요청 입력 검증 · 클라이언트 IP 키 · 게이트 격리 (T-010, 2026-08-09).
 *
 * 회귀 방어 포인트:
 *  1. XFF 의 **첫** 항목을 쓰면 공격자가 마음대로 채워 IP 제한이 무력해진다 → 마지막 항목
 *  2. 가입 요청 게이트가 login-gate 와 저장소를 공유하면, 공개 폼으로 키를 밀어 넣어
 *     로그인 실패 카운터를 축출할 수 있다 → 저장소 분리 확인
 *  3. Map 무한 성장 (임의 이메일·IP 폭주) → MAX_KEYS 상한 확인
 */
import {
  clientIpKey,
  currentInviteCode,
  MESSAGE_MAX,
  NAME_MAX,
  parseSignupRequest,
  UNKNOWN_IP_KEY,
} from '../signup-request';
import {
  resetSignupRequestGates,
  retryAfterMinutes,
  signupRequestEmailGate,
  signupRequestIpGate,
  SIGNUP_REQUEST_BASE_LOCK_MS,
  SIGNUP_REQUEST_EMAIL_FREE,
  SIGNUP_REQUEST_IP_FREE,
  SIGNUP_REQUEST_MAX_KEYS,
} from '../signup-request-gate';
import {
  loginGateSize,
  registerLoginFailure,
  resetAllLoginGates,
  loginGateSnapshot,
} from '../login-gate';

const OK_BODY = { email: 'Hong@Example.com ', name: ' 홍길동 ', message: '  써보고 싶어요  ' };

describe('parseSignupRequest — 사용자 확정 Q1 (이메일·이름 필수, 하실 말씀 선택)', () => {
  test('정상 입력 — 이메일은 정규화, 이름·말씀은 trim', () => {
    const r = parseSignupRequest(OK_BODY);
    expect(r).toEqual({ ok: true, value: { email: 'hong@example.com', name: '홍길동', message: '써보고 싶어요' } });
  });

  test('하실 말씀은 없어도 된다', () => {
    const r = parseSignupRequest({ email: 'a@b.com', name: '홍' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.message).toBe('');
  });

  test('이메일 누락·공백은 거부', () => {
    expect(parseSignupRequest({ name: '홍' }).ok).toBe(false);
    expect(parseSignupRequest({ email: '   ', name: '홍' }).ok).toBe(false);
  });

  test('이메일 형식이 틀리면 거부 (로그인·가입과 같은 판정)', () => {
    for (const email of ['nodomain', 'a@b', 'a@@b.com', 'a b@c.com']) {
      expect(parseSignupRequest({ email, name: '홍' }).ok).toBe(false);
    }
  });

  test('이름 누락·공백은 거부', () => {
    expect(parseSignupRequest({ email: 'a@b.com' }).ok).toBe(false);
    expect(parseSignupRequest({ email: 'a@b.com', name: '   ' }).ok).toBe(false);
  });

  test('이름 상한 초과는 **자르지 않고 거부**한다 (잘린 이름은 관리자를 오도한다)', () => {
    const r = parseSignupRequest({ email: 'a@b.com', name: '가'.repeat(NAME_MAX + 1) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(String(NAME_MAX));
  });

  test('이름 상한 경계값은 통과', () => {
    expect(parseSignupRequest({ email: 'a@b.com', name: '가'.repeat(NAME_MAX) }).ok).toBe(true);
  });

  test('하실 말씀 상한 초과는 거부', () => {
    const r = parseSignupRequest({ email: 'a@b.com', name: '홍', message: 'x'.repeat(MESSAGE_MAX + 1) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(String(MESSAGE_MAX));
  });

  test('문자열이 아닌 값·비객체 본문은 조용히 무시하고 거부한다', () => {
    expect(parseSignupRequest(null).ok).toBe(false);
    expect(parseSignupRequest('string').ok).toBe(false);
    expect(parseSignupRequest({ email: 42, name: {} }).ok).toBe(false);
    expect(parseSignupRequest({ email: 'a@b.com', name: '홍', message: { toString: () => 'x' } }).ok).toBe(true);
  });

  test('CRLF 가 섞인 이름도 파싱 단계에서는 통과한다 — 헤더 방어는 메일 조립이 담당', () => {
    // 여기서 거부하면 정상 사용자가 붙여넣기 개행 하나로 요청을 못 하게 된다.
    // 방어는 "헤더에 넣을 때 제거"(sanitizeHeaderText)로 한다.
    const r = parseSignupRequest({ email: 'a@b.com', name: '홍길동\r\nBcc: x@y.com' });
    expect(r.ok).toBe(true);
  });
});

describe('clientIpKey — nginx 헤더 신뢰 규칙', () => {
  const h = (init: Record<string, string>) => new Headers(init);

  test('x-real-ip 를 최우선으로 쓴다 (nginx 가 치환하므로 위조 불가)', () => {
    expect(clientIpKey(h({ 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' }))).toBe('1.2.3.4');
  });

  test('x-forwarded-for 는 **마지막** 항목을 쓴다 (앞부분은 클라이언트가 채운 값)', () => {
    expect(clientIpKey(h({ 'x-forwarded-for': '9.9.9.9, 5.5.5.5, 1.2.3.4' }))).toBe('1.2.3.4');
  });

  test('공격자가 XFF 앞에 값을 넣어도 키가 달라지지 않는다', () => {
    const real = clientIpKey(h({ 'x-forwarded-for': '1.2.3.4' }));
    const spoofed = clientIpKey(h({ 'x-forwarded-for': 'evil-1, evil-2, 1.2.3.4' }));
    expect(spoofed).toBe(real);
  });

  test('헤더가 없으면 공용 unknown 버킷 (개별 버킷을 주면 무제한이 된다)', () => {
    expect(clientIpKey(h({}))).toBe(UNKNOWN_IP_KEY);
    expect(clientIpKey(h({ 'x-forwarded-for': '  ,  ' }))).toBe(UNKNOWN_IP_KEY);
    expect(clientIpKey(h({ 'x-real-ip': '   ' }))).toBe(UNKNOWN_IP_KEY);
  });
});

describe('currentInviteCode', () => {
  const saved = process.env.SIGNUP_INVITE_CODE;
  afterEach(() => {
    if (saved === undefined) delete process.env.SIGNUP_INVITE_CODE;
    else process.env.SIGNUP_INVITE_CODE = saved;
  });

  test('설정돼 있으면 trim 한 값', () => {
    process.env.SIGNUP_INVITE_CODE = '  CODE123  ';
    expect(currentInviteCode()).toBe('CODE123');
  });

  test('미설정·빈 값이면 null (메일이 "가입 개방" 경고를 대신 싣는다)', () => {
    delete process.env.SIGNUP_INVITE_CODE;
    expect(currentInviteCode()).toBeNull();
    process.env.SIGNUP_INVITE_CODE = '   ';
    expect(currentInviteCode()).toBeNull();
  });
});

describe('게이트 정책', () => {
  beforeEach(() => { resetSignupRequestGates(); resetAllLoginGates(); });

  test('IP 축: 무료 횟수까지는 통과, 그 다음부터 잠금', () => {
    const ip = '1.2.3.4';
    for (let i = 0; i < SIGNUP_REQUEST_IP_FREE; i++) {
      expect(signupRequestIpGate.check(ip).allowed).toBe(true);
      signupRequestIpGate.register(ip);
    }
    signupRequestIpGate.register(ip);   // 초과 1회
    const c = signupRequestIpGate.check(ip);
    expect(c.allowed).toBe(false);
    if (!c.allowed) expect(retryAfterMinutes(c.retryAfterSec)).toBe(SIGNUP_REQUEST_BASE_LOCK_MS / 60_000);
  });

  test('이메일 축은 IP 축보다 빡빡하다 (한 주소로 반복 요청 차단)', () => {
    expect(SIGNUP_REQUEST_EMAIL_FREE).toBeLessThan(SIGNUP_REQUEST_IP_FREE);
    const email = 'spam@example.com';
    for (let i = 0; i <= SIGNUP_REQUEST_EMAIL_FREE; i++) signupRequestEmailGate.register(email);
    expect(signupRequestEmailGate.check(email).allowed).toBe(false);
  });

  test('이메일 키는 대소문자·공백에 무관 (정규화 우회 차단)', () => {
    for (let i = 0; i <= SIGNUP_REQUEST_EMAIL_FREE; i++) signupRequestEmailGate.register('a@b.com');
    expect(signupRequestEmailGate.check('  A@B.CoM  ').allowed).toBe(false);
  });

  test('잠금은 지수적으로 늘어나고 상한을 넘지 않는다', () => {
    const g = signupRequestIpGate;
    expect(g.lockDurationMs(SIGNUP_REQUEST_IP_FREE)).toBe(0);
    expect(g.lockDurationMs(SIGNUP_REQUEST_IP_FREE + 1)).toBe(SIGNUP_REQUEST_BASE_LOCK_MS);
    expect(g.lockDurationMs(SIGNUP_REQUEST_IP_FREE + 2)).toBe(SIGNUP_REQUEST_BASE_LOCK_MS * 2);
    expect(g.lockDurationMs(9999)).toBe(g.options.maxLockMs);
  });

  test('IP 축과 이메일 축은 서로 다른 저장소다', () => {
    signupRequestIpGate.register('shared-key');
    expect(signupRequestEmailGate.snapshot('shared-key').fails).toBe(0);
  });
});

describe('🔒 login-gate 오염 방지 — 공개 폼이 로그인 백오프를 지우지 못한다', () => {
  beforeEach(() => { resetSignupRequestGates(); resetAllLoginGates(); });

  test('가입 요청 게이트에 키를 넣어도 login-gate 크기가 변하지 않는다', () => {
    registerLoginFailure('victim@example.com');
    const before = loginGateSize();
    for (let i = 0; i < 500; i++) {
      signupRequestEmailGate.register(`flood-${i}@example.com`);
      signupRequestIpGate.register(`10.0.0.${i % 256}`);
    }
    expect(loginGateSize()).toBe(before);
  });

  test('폭주 후에도 피해자 계정의 누적 실패 횟수가 그대로다 (축출되지 않는다)', () => {
    for (let i = 0; i < 4; i++) registerLoginFailure('victim@example.com');
    for (let i = 0; i < SIGNUP_REQUEST_MAX_KEYS * 2; i++) {
      signupRequestEmailGate.register(`flood-${i}@example.com`);
    }
    expect(loginGateSnapshot('victim@example.com').fails).toBe(4);
  });

  test('가입 요청 게이트 자체는 MAX_KEYS 상한을 지킨다 (메모리 무한 성장 방지)', () => {
    for (let i = 0; i < SIGNUP_REQUEST_MAX_KEYS + 500; i++) {
      signupRequestEmailGate.register(`flood-${i}@example.com`);
    }
    expect(signupRequestEmailGate.size()).toBeLessThanOrEqual(SIGNUP_REQUEST_MAX_KEYS);
  });
});
