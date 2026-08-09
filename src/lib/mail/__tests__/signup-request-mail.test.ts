/**
 * 관리자 수신 메일 본문 (T-010, 2026-08-09) — 목업 b1ab92b1 §3.
 *
 * 회귀 방어 포인트:
 *  1. 본문 조립 함수가 **수신자 필드를 만들면 안 된다** (수신자는 env 에서만 나온다)
 *  2. 초대코드는 관리자 메일에만 — **폴백(텔레그램/슬랙) 본문에는 절대 넣지 않는다**
 *  3. 요청자 이름이 제목(헤더)에 들어가므로 CRLF 가 살아남으면 안 된다
 *  4. 요청자 이메일이 **검증되지 않았다**는 경고가 빠지면 관리자가 신원으로 오인한다
 */
import {
  buildSignupRequestFallbackText,
  buildSignupRequestMail,
  SUBJECT_NAME_MAX,
} from '../signup-request-mail';

const AT = new Date('2026-08-09T08:42:00Z');

const BASE = {
  name: '홍길동',
  email: 'hong@example.com',
  message: '형이 얘기한 그 주식앱 써보고 싶어요',
  inviteCode: 'dBDb1qQORc03',
  requestedAt: AT,
};

describe('buildSignupRequestMail — 수신자를 만들지 않는다', () => {
  test('반환값에 to/cc/bcc 가 없다 (수신자는 sendAdminMail 이 env 에서 읽는다)', () => {
    const mail = buildSignupRequestMail(BASE);
    expect(Object.keys(mail).sort()).toEqual(['html', 'subject', 'text']);
    expect(mail).not.toHaveProperty('to');
    expect(mail).not.toHaveProperty('cc');
    expect(mail).not.toHaveProperty('bcc');
  });

  test('요청자 주소가 본문에는 있지만 제목에는 없다 — 헤더 표면 최소화', () => {
    const mail = buildSignupRequestMail(BASE);
    expect(mail.text).toContain('hong@example.com');
    expect(mail.html).toContain('hong@example.com');
    expect(mail.subject).not.toContain('hong@example.com');
  });
});

describe('제목 — 헤더 안전성', () => {
  test('목업 형식을 따른다', () => {
    expect(buildSignupRequestMail(BASE).subject).toBe('[주식자동매매] 가입 요청 — 홍길동');
  });

  test('이름에 CRLF 를 넣어도 제목에 개행이 남지 않는다 (헤더 인젝션)', () => {
    const mail = buildSignupRequestMail({
      ...BASE,
      name: '홍길동\r\nBcc: attacker@evil.com',
    });
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.subject).not.toMatch(/^Bcc:/m);
  });

  test('이름이 제어문자뿐이면 대체 문구가 들어간다 (빈 제목 방지)', () => {
    expect(buildSignupRequestMail({ ...BASE, name: '\r\n\t' }).subject)
      .toBe('[주식자동매매] 가입 요청 — 이름 없음');
  });

  test('아주 긴 이름은 제목에서 잘린다 (본문에는 온전히 남는다)', () => {
    const long = '가'.repeat(200);
    const mail = buildSignupRequestMail({ ...BASE, name: long });
    expect(mail.subject.length).toBeLessThanOrEqual('[주식자동매매] 가입 요청 — '.length + SUBJECT_NAME_MAX);
    expect(mail.text).toContain(long);
  });
});

describe('본문 — 초대코드와 경고', () => {
  test('초대코드가 text·html 양쪽에 들어간다 (관리자가 .env 를 열지 않아도 되게)', () => {
    const mail = buildSignupRequestMail(BASE);
    expect(mail.text).toContain('dBDb1qQORc03');
    expect(mail.html).toContain('dBDb1qQORc03');
  });

  test('"요청자에게 자동으로 가지 않는다" 경고가 있다', () => {
    const mail = buildSignupRequestMail(BASE);
    expect(mail.text).toContain('자동으로 요청자에게 가지 않습니다');
    expect(mail.html).toContain('자동으로 요청자에게 가지 않습니다');
  });

  test('요청자 주소가 **확인되지 않았다**는 경고가 있다', () => {
    const mail = buildSignupRequestMail(BASE);
    expect(mail.text).toContain('확인되지 않았습니다');
    expect(mail.html).toContain('확인되지 않았습니다');
  });

  test('SIGNUP_INVITE_CODE 미설정이면 코드 대신 "가입 개방" 경고를 싣는다', () => {
    const mail = buildSignupRequestMail({ ...BASE, inviteCode: null });
    expect(mail.text).toContain('SIGNUP_INVITE_CODE 가 설정돼 있지 않습니다');
    expect(mail.html).toContain('SIGNUP_INVITE_CODE 가 설정돼 있지 않습니다');
    expect(mail.html).not.toContain('현재 초대코드');
  });

  test('하실 말씀이 비면 (없음) 으로 표기한다', () => {
    const mail = buildSignupRequestMail({ ...BASE, message: '   ' });
    expect(mail.text).toContain('(없음)');
    expect(mail.html).toContain('(없음)');
  });

  test('요청 시각이 KST 로 표기된다', () => {
    expect(buildSignupRequestMail(BASE).text).toContain('KST');
  });
});

describe('HTML 이스케이프 — 요청자 입력', () => {
  test('이름·하실 말씀의 마크업이 이스케이프된다', () => {
    const mail = buildSignupRequestMail({
      ...BASE,
      name: '<img src=x onerror=alert(1)>',
      message: '</td></tr></table><script>bad()</script>',
    });
    expect(mail.html).not.toContain('<img src=x');
    expect(mail.html).not.toContain('<script>bad()');
    expect(mail.html).toContain('&lt;img src=x');
    expect(mail.html).toContain('&lt;script&gt;bad()');
  });

  test('이메일의 꺾쇠도 이스케이프된다', () => {
    const mail = buildSignupRequestMail({ ...BASE, email: 'a<b>@c.com' });
    expect(mail.html).toContain('a&lt;b&gt;@c.com');
  });
});

describe('buildSignupRequestFallbackText — 🔒 코드를 담지 않는다', () => {
  const input = { name: BASE.name, email: BASE.email, message: BASE.message, requestedAt: AT };

  test('초대코드가 들어 있지 않다 (텔레그램·슬랙은 제3자 경유 채널)', () => {
    const text = buildSignupRequestFallbackText(input);
    expect(text).not.toContain('dBDb1qQORc03');
  });

  test('타입상 inviteCode 를 넘길 자리가 없다 — 실수로 담길 경로가 없다', () => {
    // `Omit<SignupRequestMailInput,'inviteCode'>` 라 컴파일 타임에도 막힌다.
    // 런타임에서도 여분 필드는 본문에 반영되지 않는다.
    const text = buildSignupRequestFallbackText({
      ...input,
      ...({ inviteCode: 'LEAKED-CODE' } as Record<string, never>),
    });
    expect(text).not.toContain('LEAKED-CODE');
  });

  test('관리자가 회신할 수 있게 요청자 정보는 온전히 담는다', () => {
    const text = buildSignupRequestFallbackText(input);
    expect(text).toContain('홍길동');
    expect(text).toContain('hong@example.com');
    expect(text).toContain('검증되지 않은 주소');
    expect(text).toContain('메일 발송에 실패');
  });

  test('관리자가 코드를 어디서 봐야 하는지 알려준다', () => {
    expect(buildSignupRequestFallbackText(input)).toContain('SIGNUP_INVITE_CODE');
  });
});

/**
 * reviewer MEDIUM (2026-08-09) — 폴백 본문은 `dispatchAlert` 로 텔레그램(HTML)과
 * 슬랙(mrkdwn) **양쪽에 그대로** 삽입된다. 요청자 입력이 이스케이프 없이 들어가면
 * 관리자 알림 안에 요청자가 고른 문구의 클릭 가능한 링크가 렌더된다(피싱).
 */
describe('🔒 폴백 본문 — 요청자 입력이 링크로 렌더되지 않는다', () => {
  const TG_LINK = '<a href="https://phish.example">지금 확인</a>';
  const SLACK_LINK = '<https://phish.example|지금 확인>';

  const build = (over: Partial<{ name: string; email: string; message: string }>) =>
    buildSignupRequestFallbackText({
      name: BASE.name, email: BASE.email, message: BASE.message, requestedAt: AT, ...over,
    });

  test.each([
    ['name', 'name'],
    ['message', 'message'],
  ])('%s 필드의 텔레그램 HTML 링크가 살아남지 않는다', (_l, field) => {
    const text = build({ [field]: TG_LINK });
    expect(text).not.toContain('<a href');
    expect(text).not.toContain('</a>');
    expect(text).toContain('&lt;a href');
  });

  test.each([
    ['name', 'name'],
    ['message', 'message'],
  ])('%s 필드의 슬랙 mrkdwn 링크가 살아남지 않는다', (_l, field) => {
    const text = build({ [field]: SLACK_LINK });
    expect(text).not.toContain('<https://');
    expect(text).toContain('&lt;https://');
  });

  test('이메일 필드로도 주입할 수 없다 (isValidEmail 은 로컬파트의 <> 를 허용한다)', () => {
    const text = build({ email: '<a>x@evil.com' });
    expect(text).not.toContain('<a>');
    expect(text).toContain('&lt;a&gt;');
  });

  /**
   * 실제로 `isValidEmail` 을 통과하는 페이로드다 (2026-08-09 검증).
   *
   * 슬랙 mrkdwn 링크 `<url|텍스트>` 는 **공백이 필요 없다.** `isValidEmail` 이 막는 것은
   * 공백뿐이고 `<`·`>`·`|`·`:`·`/` 는 전부 통과시키므로, 도메인부에 통째로 들어간다:
   *   `ab@<https://evil.com|ClickHere>` → isValidEmail **true**
   * 텔레그램의 `<a href="…">` 는 공백 때문에 불가능하지만 슬랙은 그 제약이 없다 —
   * "공백이 막히니 클릭형 링크는 불가능"이라는 추론이 슬랙에서는 성립하지 않는다.
   */
  test('슬랙 링크 문법이 이메일 도메인부로 들어와도 무력화된다 (공백 불필요 페이로드)', () => {
    const text = build({ email: 'ab@<https://evil.com|ClickHere>' });
    expect(text).not.toContain('<https://');
    expect(text).not.toMatch(/[<>]/);
    expect(text).toContain('&lt;https://evil.com|ClickHere&gt;');
  });

  test('슬랙 채널 멘션이 이메일로 들어와도 무력화된다 (@channel 대량 핑 방지)', () => {
    const text = build({ email: 'ab@<!channel>x.com' });
    expect(text).not.toContain('<!channel>');
    expect(text).toContain('&lt;!channel&gt;');
  });

  test('세 필드 어디에도 raw < 또는 > 가 남지 않는다', () => {
    const text = build({ name: TG_LINK, email: '<x>@e.com', message: SLACK_LINK });
    expect(text).not.toMatch(/[<>]/);
  });

  test('& 도 엔티티가 된다 (텔레그램 HTML 파싱 실패 → 알림 유실 방지)', () => {
    expect(build({ name: 'A & B' })).toContain('A &amp; B');
  });

  test('공격 시도 원문은 텍스트로 읽을 수 있게 남는다 (관리자가 인지해야 한다)', () => {
    expect(build({ message: TG_LINK })).toContain('지금 확인');
  });

  test('정적 문구에 & < > 와 마크다운 서식이 없다 — 두 채널 모두에서 깨지지 않는다', () => {
    const text = build({ name: '홍', email: 'a@b.com', message: '안녕' });
    expect(text).not.toMatch(/[<>]/);
    expect(text).not.toContain('**');
  });
});
