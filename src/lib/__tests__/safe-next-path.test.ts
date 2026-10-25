/**
 * T-089 — 로그인 후 이동 경로(`next`) 오픈 리다이렉트 차단.
 *
 * 결함: 옛 검사(`startsWith('/') && !startsWith('//')`)가 `/<TAB>/evil.com` 을 통과시켰고, URL 해석기가
 * 탭·줄바꿈을 지워 `//evil.com`(프로토콜 상대 URL)이 되어 로그인 후 외부 사이트로 이동했다.
 *
 * 구성:
 *  ① 통과해야 하는 값은 **원본 문자열 그대로** 돌아온다(정규화 금지)
 *  ② 거부 벡터 전부 null
 *  ③ 불변식 — 통과한 모든 값은 `new URL(값, base).origin === base` (표 + 코드 포인트 전수 탐색)
 *  ④ 순수성 — 소스에 import·process.env·@/ 참조가 없다(서버·화면 양쪽에서 가져다 쓰는 파일)
 *  ⑤ `sanitizeNextPath`(서버)는 같은 판정에 위임하고 거부 시 `/`
 *  ⑥ 미들웨어가 만드는 `/login?next=` 값은 정상이면 그대로 통과·위험하면 거부
 */
import { readFileSync } from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { MAX_NEXT_PATH_LENGTH, sanitizeInternalPath } from '@/lib/safe-next-path';
import { sanitizeNextPath } from '@/lib/auth/oauth/config';
import { middleware } from '@/middleware';

const BASES = ['https://stock.example.com', 'http://localhost:3003', 'https://stock.xn--lh0b87pnudm10a4vd.com'];

/** 통과해야 하는 값 — 원본 그대로 돌아와야 한다. */
const ACCEPT: string[] = [
  '/',
  '/orders',
  '/profile',
  '/a/b?x=1&y=2#h',
  '/search?q=%EC%82%BC%EC%84%B1',
  '/a?u=//x', // 쿼리 안의 `//` 는 경로가 아니다
  '/a?u=https://evil.com', // 쿼리 값일 뿐
  '/%09/evil.com', // 인코딩된 탭 — 해석기가 지우지 않는다(같은 출처 경로 문자)
  '/%2F%2Fevil.com',
  '/%5Cevil.com',
  '/a%20b',
  '/한글/경로?키=값', // 인코딩 전 한글도 같은 출처 경로
  '/..//evil.com', // 점 세그먼트 제거 후에도 호스트는 그대로
  '/.//evil.com',
  '/a b', // 공백은 경로 문자(%20)다
  '/ /x',
  '/#frag',
  '/?',
  '/a/b/',
  '/@evil.com', // 경로 첫 세그먼트의 `@` — userinfo 가 아니다(첫 글자 뒤라 호스트가 될 수 없다)
  '/:evil.com',
];

/** 거부해야 하는 값 — 전부 null. */
const REJECT: Array<[label: string, value: unknown]> = [
  ['프로토콜 상대 //', '//evil.com'],
  ['슬래시 3개', '///evil.com'],
  ['역슬래시(둘째 글자)', '/\\evil.com'],
  ['역슬래시 2개', '/\\\\evil.com'],
  ['탭을 낀 경로(핵심 결함)', '/\t/evil.com'],
  ['LF 를 낀 경로', '/\n/evil.com'],
  ['CR 를 낀 경로', '/\r/evil.com'],
  ['탭 2개', '/\t\t/evil.com'],
  ['LF+탭', '/\n\t/evil.com'],
  ['CRLF', '/\r\n/evil.com'],
  ['NUL', '/\u0000/evil.com'],
  ['U+001F', '/\u001f/x'],
  ['DEL', '/\u007f/x'],
  ['뒤쪽 탭', '/a\t'],
  ['중간 LF', '/a\nb'],
  ['쿼리 안 탭', '/a?x=\t//evil.com'],
  ['경로 중간 역슬래시', '/a\\b'],
  ['U+2028', '/ /x'],
  ['U+2029', '/ /x'],
  ['절대 URL(https)', 'https://evil.com'],
  ['절대 URL(http)', 'http://evil.com'],
  ['javascript:', 'javascript:alert(1)'],
  ['data:', 'data:text/html,<script>1</script>'],
  ['스킴 없는 호스트', 'evil.com'],
  ['상대 경로', 'orders'],
  ['앞쪽 공백 뒤 //', ' //evil.com'],
  ['앞쪽 탭 뒤 //', '\t//evil.com'],
  ['앞쪽 탭 뒤 /', '\t/orders'],
  ['빈 문자열', ''],
  ['null', null],
  ['undefined', undefined],
  ['숫자', 123],
  ['객체', {}],
  ['배열', ['/orders']],
  ['불리언', true],
  ['길이 2049', `/${'a'.repeat(MAX_NEXT_PATH_LENGTH)}`],
  ['길이 5000', `/${'a'.repeat(4999)}`],
];

describe('① 통과해야 하는 값은 원본 그대로', () => {
  test.each(ACCEPT.map((v) => [JSON.stringify(v), v]))('%s', (_label, v) => {
    expect(sanitizeInternalPath(v)).toBe(v);
  });

  test('길이 2048 은 통과 · 2049 는 거부 (경계)', () => {
    const at = `/${'a'.repeat(MAX_NEXT_PATH_LENGTH - 1)}`;
    expect(at.length).toBe(MAX_NEXT_PATH_LENGTH);
    expect(sanitizeInternalPath(at)).toBe(at);
    expect(sanitizeInternalPath(`${at}a`)).toBeNull();
  });
});

describe('② 거부 벡터는 전부 null', () => {
  test.each(REJECT.map(([label, v]) => [label, v] as [string, unknown]))('%s', (_label, v) => {
    expect(sanitizeInternalPath(v)).toBeNull();
  });
});

describe('③ 불변식 — 통과한 값은 항상 같은 출처', () => {
  test.each(BASES)('표의 통과 값 전부: new URL(값, %s).origin === base', (base) => {
    for (const v of ACCEPT) {
      expect({ v, origin: new URL(v, base).origin }).toEqual({ v, origin: new URL(base).origin });
    }
  });

  test('거부 표에 "해석하면 실제로 외부로 나가는" 값이 들어 있고(시험이 결함을 대표), 전부 null', () => {
    // 거부 표에서 "해석하면 외부로 나가는" 값이 최소 1개는 있어야 이 시험이 결함을 대표한다.
    const base = 'https://stock.example.com';
    const external = REJECT
      .map(([, v]) => v)
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .filter((v) => {
        try { return new URL(v, base).origin !== base; } catch { return true; }
      });
    expect(external).toEqual(expect.arrayContaining(['/\t/evil.com', '/\n/evil.com', '/\r/evil.com', '//evil.com']));
    for (const [, v] of REJECT) expect(sanitizeInternalPath(v)).toBeNull();
  });

  test('코드 포인트 전수 탐색 — 통과한 값은 어떤 문자 위치에서도 출처를 바꾸지 못한다', () => {
    const base = 'https://stock.example.com';
    const baseOrigin = new URL(base).origin;
    const chars: string[] = [];
    for (let c = 0; c <= 0x3000; c += 1) {
      if (c >= 0xd800 && c <= 0xdfff) continue; // 서로게이트는 짝이 필요 — 아래 astral 로 따로
      chars.push(String.fromCharCode(c));
    }
    chars.push('\u{1F600}', '\u{10FFFF}', '﻿', '‮', '​', '／' /* 전각 슬래시 */, '＼' /* 전각 역슬래시 */);

    let accepted = 0;
    for (const ch of chars) {
      const templates = [`/${ch}/evil.com`, `/${ch}${ch}evil.com`, `/${ch}`, `/a${ch}/evil.com`, `/a/${ch}/evil.com`, `/a?q=${ch}//evil.com`, `/${ch}\\evil.com`];
      for (const v of templates) {
        const r = sanitizeInternalPath(v);
        if (r === null) continue;
        accepted += 1;
        expect(r).toBe(v); // 통과하면 원본 그대로
        const o = new URL(r, base).origin;
        if (o !== baseOrigin) throw new Error(`출처가 바뀜: ${JSON.stringify(v)} → ${o}`);
      }
    }
    expect(accepted).toBeGreaterThan(1000); // 탐색이 "전부 거부" 로 공회전하지 않았음을 확인
  });

  test('제어문자(U+0000–U+001F·U+007F)는 어느 위치에 있어도 거부', () => {
    const codes = [...Array.from({ length: 0x20 }, (_, i) => i), 0x7f];
    for (const c of codes) {
      const ch = String.fromCharCode(c);
      for (const v of [`/${ch}`, `/${ch}/x`, `/a${ch}`, `/a${ch}b`, `/a?q=1${ch}`, `/a#${ch}`]) {
        expect({ v, r: sanitizeInternalPath(v) }).toEqual({ v, r: null });
      }
    }
  });
});

describe('③-b 층별 독립 방어 — URL 해석기가 달라도(구형 WebView 가정) 한 층만으로 막힌다', () => {
  /** 해석기가 출처를 어떻게 읽는지 바꿔 끼운다. 동기 구간에서만 쓰고 반드시 원복한다. */
  function withParser(originOf: (input: string) => string, fn: () => void): void {
    const Real = globalThis.URL;
    class FakeURL extends Real {
      constructor(input: string | URL, base?: string | URL) {
        super(input, base);
        Object.defineProperty(this, 'origin', { value: originOf(String(input)) });
      }
    }
    Object.defineProperty(globalThis, 'URL', { value: FakeURL, configurable: true, writable: true });
    try { fn(); } finally {
      Object.defineProperty(globalThis, 'URL', { value: Real, configurable: true, writable: true });
    }
  }

  test('5번(출처 확인) — 해석기가 정상 경로를 다른 출처로 읽으면 거부한다', () => {
    withParser(() => 'http://other.invalid', () => {
      expect(sanitizeInternalPath('/orders')).toBeNull();
      expect(sanitizeInternalPath('/')).toBeNull();
    });
    expect(sanitizeInternalPath('/orders')).toBe('/orders'); // 원복 확인
  });

  test('5번(출처 확인) — 해석기가 예외를 던지면 거부한다', () => {
    withParser(() => { throw new Error('parser broke'); }, () => {
      expect(sanitizeInternalPath('/orders')).toBeNull();
    });
  });

  test('2·3번 — 해석기가 `//`·`/\\` 를 같은 출처로 오해해도 둘째 글자 검사만으로 거부한다', () => {
    withParser(() => 'http://x.invalid', () => {
      expect(sanitizeInternalPath('//evil.com')).toBeNull();
      expect(sanitizeInternalPath('///evil.com')).toBeNull();
      expect(sanitizeInternalPath('/\\evil.com')).toBeNull();
    });
  });

  test('4번 — 해석기가 탭·줄바꿈을 지우지 않아도(출처가 같다고 답해도) 제어문자 검사만으로 거부한다', () => {
    withParser(() => 'http://x.invalid', () => {
      for (const v of ['/\t/evil.com', '/\n/evil.com', '/\r/evil.com', '/\u0000/x', '/\u007f/x', '/a\\b', '/ /x']) {
        expect({ v, r: sanitizeInternalPath(v) }).toEqual({ v, r: null });
      }
    });
  });
});

describe('④ 순수성 — 서버·화면 양쪽에서 가져다 쓰는 파일', () => {
  const SRC = readFileSync(path.resolve(__dirname, '../safe-next-path.ts'), 'utf8');
  // 주석은 설명이므로 제외하고 코드만 본다. (문자열 속 `http://` 는 `//` 앞에 `:` 가 있어 지워지지 않는다.)
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;{}])\/\/.*$/gm, '$1');

  test('import·require·export-from 이 없다', () => {
    expect(CODE).not.toMatch(/\bimport\b/);
    expect(CODE).not.toMatch(/\brequire\s*\(/);
    expect(CODE).not.toMatch(/\bexport\s+(\*|\{[^}]*\})\s+from\b/);
  });

  test('process.env 를 읽지 않는다', () => {
    expect(CODE).not.toMatch(/\bprocess\b/);
  });

  test('`@/` 별칭 경로 참조가 없다', () => {
    expect(CODE).not.toMatch(/['"`]@\//);
    expect(CODE).not.toContain('@/');
  });

  test('브라우저·Node 전용 전역(window·document·Buffer)을 쓰지 않는다', () => {
    expect(CODE).not.toMatch(/\b(window|document|Buffer|globalThis)\b/);
  });

  test('시험이 비어 있지 않다(소스를 실제로 읽었다)', () => {
    expect(CODE).toContain('sanitizeInternalPath');
    expect(CODE.length).toBeGreaterThan(200);
  });
});

describe('⑤ sanitizeNextPath(서버) — 같은 판정에 위임, 거부 시 `/`', () => {
  test('통과 값은 원본 그대로', () => {
    for (const v of ACCEPT) expect(sanitizeNextPath(v)).toBe(v);
  });

  test('거부 값은 전부 `/`', () => {
    for (const [, v] of REJECT) expect(sanitizeNextPath(v)).toBe('/');
  });

  test('★ 탭·줄바꿈 우회 — 옛 검사가 통과시키던 값이 이제 `/`', () => {
    expect(sanitizeNextPath('/\t/evil.com')).toBe('/');
    expect(sanitizeNextPath('/\n/evil.com')).toBe('/');
    expect(sanitizeNextPath('/\r/evil.com')).toBe('/');
  });

  test('모든 입력에서 sanitizeInternalPath(x) ?? "/" 와 같다 (위임이 한 곳)', () => {
    for (const v of [...ACCEPT, ...REJECT.map(([, x]) => x)]) {
      expect(sanitizeNextPath(v)).toBe(sanitizeInternalPath(v) ?? '/');
    }
  });
});

describe('⑥ 미들웨어가 만드는 /login?next= 값', () => {
  const ORIGINAL = process.env.AUTH_SESSION_SECRET;
  beforeEach(() => { process.env.AUTH_SESSION_SECRET = 't089-mw-test-secret-0123456789'; });
  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.AUTH_SESSION_SECRET;
    else process.env.AUTH_SESSION_SECRET = ORIGINAL;
  });

  /** 로그인 안 된 요청이 보호 페이지로 오면 미들웨어가 붙이는 next 값을 뽑는다. */
  async function nextFromMiddleware(rawPathAndQuery: string): Promise<{ next: string | null; expected: string }> {
    const req = new NextRequest(`https://stock.example.com${rawPathAndQuery}`);
    const res = await middleware(req);
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get('location') ?? '', 'https://stock.example.com');
    expect(loc.pathname).toBe('/login');
    return { next: loc.searchParams.get('next'), expected: `${req.nextUrl.pathname}${req.nextUrl.search}` };
  }

  test.each([
    '/orders',
    '/orders?tab=a&b=2',
    '/analytics?from=2026-01-01#x',
    '/search?q=삼성 전자', // 공백·한글은 URL 해석기가 %20·퍼센트 인코딩으로 바꾼다
    '/a%20b',
    '/한글/경로',
    '/p?u=//x',
    '/%09/evil.com',
  ])('정상 보호 경로 %s → next 는 그대로 통과', async (p) => {
    const { next, expected } = await nextFromMiddleware(p);
    expect(next).toBe(expected);
    expect(sanitizeInternalPath(next)).toBe(expected);
  });

  test('★ 요청 경로 자체가 `//evil.com` 이면 미들웨어가 그대로 next 에 싣고, 로그인 화면 검사가 거부한다', async () => {
    const { next } = await nextFromMiddleware('//evil.com/path');
    expect(next).toBe('//evil.com/path');
    expect(sanitizeInternalPath(next)).toBeNull();
    expect(sanitizeNextPath(next)).toBe('/');
  });
});
