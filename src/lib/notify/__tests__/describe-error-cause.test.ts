/**
 * T-175 WP-3 — `describeErrorCause`: 예외의 원인 사슬에서 코드·주소만 한 줄로(로그 전용).
 *
 * 2026-11-18 12:11 장중 전략 평가가 `{"ok":false,"error":"fetch failed"}` 로 끝났는데 어느 호스트인지 기록이 없었다.
 * undici 의 실제 정보는 `cause`(Happy Eyeballs 실패면 AggregateError + 주소별 errors[])에 있다.
 */
import { describeErrorCause } from '../result';

function sysErr(code: string, address: string, port: number, syscall = 'connect') {
  return Object.assign(new Error(`${syscall} ${code} ${address}:${port}`), { code, errno: -1, syscall, address, port });
}
/** undici fetch 가 Happy Eyeballs(IPv4 시간 초과 → IPv6 경로 없음)로 실패했을 때와 같은 모양 */
function happyEyeballsFailure() {
  const agg = Object.assign(
    new AggregateError([sysErr('ETIMEDOUT', '149.154.166.110', 443), sysErr('ENETUNREACH', '2001:67c:4e8:f004::9', 443)], ''),
    { code: 'ETIMEDOUT' },
  );
  return new TypeError('fetch failed', { cause: agg });
}

describe('describeErrorCause — 원인 코드·주소', () => {
  test('🔴 AggregateError(Happy Eyeballs) → 주소별 코드까지 한 줄', () => {
    expect(describeErrorCause(happyEyeballsFailure())).toBe(
      'cause=ETIMEDOUT cause.errors=[ETIMEDOUT connect 149.154.166.110:443, ENETUNREACH connect 2001:67c:4e8:f004::9:443]',
    );
  });

  test('cause 가 단일 시스템 오류(ENOTFOUND 호스트)', () => {
    const e = new TypeError('fetch failed', {
      cause: Object.assign(new Error('getaddrinfo ENOTFOUND api.example.com'), { code: 'ENOTFOUND', syscall: 'getaddrinfo', hostname: 'api.example.com' }),
    });
    expect(describeErrorCause(e)).toBe('cause=ENOTFOUND getaddrinfo api.example.com');
  });

  test('실제 undici fetch 실패(닫힌 로컬 포트)도 코드·주소가 나온다', async () => {
    // 잠깐 열었다 닫은 임시 포트 — 연결 거부(ECONNREFUSED)를 만든다(외부 접속 없음). 1번 같은 포트는 fetch 가 「bad port」로 막는다.
    const net = await import('node:net');
    const port = await new Promise<number>((resolve) => {
      const srv = net.createServer().listen(0, '127.0.0.1', () => {
        const p = (srv.address() as { port: number }).port;
        srv.close(() => resolve(p));
      });
    });
    let caught: unknown;
    try { await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(5_000) }); } catch (e) { caught = e; }
    expect((caught as { message?: unknown })?.message).toBe('fetch failed');   // 시험 환경의 Error 와 realm 이 달라 instanceof 대신 message
    const d = describeErrorCause(caught);
    expect(d).toMatch(/ECONNREFUSED/);
    expect(d).toContain(`127.0.0.1:${port}`);
  });

  test('코드 없는 cause 는 name: message 로', () => {
    const e = new Error('outer', { cause: new RangeError('inner detail') });
    expect(describeErrorCause(e)).toBe('cause=RangeError: inner detail');
  });

  test('최상위 오류 자체의 code(예: DB 오류)', () => {
    expect(describeErrorCause(Object.assign(new Error('x'), { code: 'ER_LOCK_WAIT_TIMEOUT' }))).toBe('code=ER_LOCK_WAIT_TIMEOUT');
  });

  test('cause·code 가 없는 일반 Error → 빈 문자열(추가로 찍을 것 없음)', () => {
    expect(describeErrorCause(new Error('plain'))).toBe('');
  });

  test.each([
    ['문자열', 'boom', 'thrown=string'],
    ['숫자', 42, 'thrown=number'],
    ['null', null, 'thrown=null'],
    ['undefined', undefined, 'thrown=undefined'],
  ])('Error 가 아닌 값(%s)이 던져지면 종류만', (_n, v, want) => {
    expect(describeErrorCause(v)).toBe(want);
  });

  test('Error 가 아닌 객체라도 code·cause 는 읽는다', () => {
    expect(describeErrorCause({ code: 'EPIPE', cause: { code: 'ECONNRESET' } })).toBe('code=EPIPE cause=ECONNRESET');
  });
});

describe('🔴 describeErrorCause — 비밀값·형식 안전', () => {
  test('텔레그램 봇 토큰 패턴 · 호출부가 넘긴 비밀 문자열을 가린다', () => {
    const e = new Error('x', { cause: new Error('request to https://api.telegram.org/bot123456:AAH-secret_tok/sendMessage failed, key=KIS-APPKEY-0123456789') });
    const d = describeErrorCause(e, 'KIS-APPKEY-0123456789');
    expect(d).not.toContain('AAH-secret_tok');
    expect(d).not.toContain('KIS-APPKEY-0123456789');
    expect(d).toContain('bot***');
    expect(d).toContain('key=***');
  });

  test('URL 쿼리스트링은 통째로 가린다', () => {
    const e = new Error('x', { cause: new Error('GET https://openapi.example.com/quote?appkey=SECRET1&appsecret=SECRET2 failed') });
    const d = describeErrorCause(e);
    expect(d).not.toMatch(/SECRET1|SECRET2|appsecret/);
    expect(d).toContain('https://openapi.example.com/quote?***');
  });

  test('제어문자(줄바꿈)를 지워 로그 한 줄을 지킨다', () => {
    const e = new Error('x', { cause: new Error('line1\nFAKE LOG LINE\r\nline3') });
    expect(describeErrorCause(e)).not.toMatch(/[\r\n]/);
  });

  test('순환 cause 에서 멈춘다 · 깊이 4 까지만 · errors 는 6개 + 나머지 개수', () => {
    const loop = new Error('loop') as Error & { cause?: unknown };
    loop.cause = loop;
    expect(describeErrorCause(loop)).toBe('');

    let chain: unknown = { code: 'E6' };
    for (let i = 5; i >= 1; i--) chain = { code: `E${i}`, cause: chain };
    expect(describeErrorCause({ cause: chain })).toBe('cause=E1 cause2=E2 cause3=E3 cause4=E4');

    const many = new AggregateError(Array.from({ length: 8 }, (_, i) => ({ code: `X${i}` })), '');
    expect(describeErrorCause(new Error('x', { cause: many }))).toBe(
      'cause=AggregateError cause.errors=[X0, X1, X2, X3, X4, X5, … +2]',
    );
  });
});
