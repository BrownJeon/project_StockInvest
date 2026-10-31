/**
 * T-136 — 토큰 만료 처리의 **단일 출처** 헬퍼와, 사본이 다시 생기지 않게 하는 정적 울타리.
 *
 * ## 왜 이 시험이 있는가
 *
 * 토큰 분기가 어댑터 7곳에 손으로 복제돼 있었고, 두 가지가 동시에 틀어졌다.
 *  - 판정이 `EGW00123` only 라 `EGW00121` 은 **아무도 복구하지 않았다**(게이트웨이는 토큰 계열이라
 *    재시도를 건너뛰고, 호출부는 재발급도 안 했다 — T-133 QA #2).
 *  - 재발급을 **먼저** 해서, 다른 프로세스가 회전시켜 둔 멀쩡한 토큰을 지우고 `EGW00133`(앱키당 1분
 *    1회) 60초 대기에 들어갈 수 있었다. 그 대기는 같은 프로세스의 `createOrder` 까지 막는다
 *    (T-133 감사 M-2 실측).
 *
 * 그래서 고친 쪽은 **동작**(아래 describe 1)과 **재발을 막는 구조**(describe 2) 둘 다다.
 */
jest.mock('../kis-auth', () => ({
  getKisToken:        jest.fn(async () => tokenValue),
  invalidateKisToken: jest.fn(async () => { tokenValue = 'reissued'; }),
  kisBaseUrl:         jest.fn(() => 'https://mock-base'),
}));

import fs from 'fs';
import path from 'path';
import * as ts from 'typescript';
import { shouldRetryAfterTokenError, __resetTokenRetryForTest } from '../kis-token-retry';

/** 모킹한 `getKisToken()` 이 돌려줄 값. 시험이 "다른 프로세스가 회전시킨" 상황을 만들 때 바꾼다. */
let tokenValue = 'tok';

const EXPIRED_123 = '{"rt_cd":"1","msg_cd":"EGW00123","msg1":"기간이 만료된 token 입니다."}';
const INVALID_121 = '{"rt_cd":"1","msg_cd":"EGW00121","msg1":"유효하지 않은 token 입니다."}';
const GATEWAY     = '{"rt_cd":"1","msg_cd":"EGW00300","msg1":"Gateway 라우팅 오류가 발생했습니다."}';
const SESSION     = '{"rt_cd":"9","msg_cd":"OPSQ1002","msg1":"SESSION FULL"}';

function authMocks() {
  return jest.requireMock('../kis-auth') as { getKisToken: jest.Mock; invalidateKisToken: jest.Mock };
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetTokenRetryForTest();
  tokenValue = 'tok';
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('shouldRetryAfterTokenError — 동작', () => {
  test('🔴 다른 프로세스가 회전시켜 뒀으면 재발급하지 않고 재시도하라고 한다', async () => {
    const { invalidateKisToken } = authMocks();
    tokenValue = 'rotated';                                     // DB 에는 이미 새 토큰
    await expect(shouldRetryAfterTokenError(EXPIRED_123, 'Bearer tok', 'x')).resolves.toBe(true);
    expect(invalidateKisToken).not.toHaveBeenCalled();          // ← M-2 회귀 가드
  });

  test('🔴 DB 토큰이 방금 쓴 것과 같을 때만 재발급한다', async () => {
    const { invalidateKisToken } = authMocks();
    await expect(shouldRetryAfterTokenError(EXPIRED_123, 'Bearer tok', 'x')).resolves.toBe(true);
    expect(invalidateKisToken).toHaveBeenCalledTimes(1);
  });

  test('🔴 EGW00121 도 토큰 오류로 본다 (예전 사본은 EGW00123 만 봤다)', async () => {
    const { invalidateKisToken } = authMocks();
    await expect(shouldRetryAfterTokenError(INVALID_121, 'Bearer tok', 'x')).resolves.toBe(true);
    expect(invalidateKisToken).toHaveBeenCalledTimes(1);
  });

  test('한글 문구만 있는 본문도 토큰 오류로 본다', async () => {
    await expect(shouldRetryAfterTokenError('기간이 만료된 token', 'Bearer tok', 'x')).resolves.toBe(true);
  });

  test.each([
    ['게이트웨이 5xx', GATEWAY],
    ['SESSION FULL',   SESSION],
    ['빈 본문',        ''],
    ['관계없는 업무실패', '{"rt_cd":"7","msg_cd":"APBN0746","msg1":"상품이 없습니다."}'],
  ])('🔴 토큰 오류가 아니면 false 이고 **DB 를 읽지 않는다** — %s', async (_name, body) => {
    const { getKisToken, invalidateKisToken } = authMocks();
    await expect(shouldRetryAfterTokenError(body, 'Bearer tok', 'x')).resolves.toBe(false);
    expect(getKisToken).not.toHaveBeenCalled();        // 흔한 실패마다 SELECT 를 더하지 않는다
    expect(invalidateKisToken).not.toHaveBeenCalled();
  });

  test('usedAuth 가 undefined 면 DB 값과 다르므로 재발급하지 않는다 (헤더를 못 읽은 경우)', async () => {
    const { invalidateKisToken } = authMocks();
    await expect(shouldRetryAfterTokenError(EXPIRED_123, undefined, 'x')).resolves.toBe(true);
    expect(invalidateKisToken).not.toHaveBeenCalled();
  });

  test('🔴 getKisToken 이 던지면 그대로 전파한다 (fail-closed) — 재발급하지 않는다', async () => {
    const { getKisToken, invalidateKisToken } = authMocks();
    getKisToken.mockRejectedValueOnce(new Error('KIS_APP_KEY / KIS_APP_SECRET not set'));
    await expect(shouldRetryAfterTokenError(EXPIRED_123, 'Bearer tok', 'x')).rejects.toThrow(/KIS_APP_KEY/);
    expect(invalidateKisToken).not.toHaveBeenCalled();
  });

  test('로그에는 label 만 싣고 토큰 값을 싣지 않는다', async () => {
    // 토큰 값은 영어 단어 'token' 과 겹치지 않는 문자열로 둔다 — 'tok' 로 두면 로그의 "token expired"
    // 때문에 단언이 늘 실패한다(처음 그렇게 적어 시험이 먼저 틀렸다).
    const warn = jest.spyOn(console, 'warn');
    tokenValue = 'ZZSECRETVALUE';
    await shouldRetryAfterTokenError(EXPIRED_123, 'Bearer ZZSECRETVALUE', 'kis-domestic getBalances');
    const line = warn.mock.calls.map(c => String(c[0])).join(' | ');
    expect(line).toContain('kis-domestic getBalances');
    expect(line).not.toContain('ZZSECRETVALUE');
  });

  test('회전 경로의 로그에도 토큰 값이 없다', async () => {
    const warn = jest.spyOn(console, 'warn');
    tokenValue = 'ZZROTATEDVALUE';
    await shouldRetryAfterTokenError(EXPIRED_123, 'Bearer ZZOLDVALUE', 'kis-overseas usdCash');
    const line = warn.mock.calls.map(c => String(c[0])).join(' | ');
    expect(line).toContain('kis-overseas usdCash');
    expect(line).not.toMatch(/ZZROTATEDVALUE|ZZOLDVALUE/);
  });
});

/**
 * 🔴 **사본이 다시 생기지 않게** 하는 정적 울타리.
 *
 * 파서로 본다 — 주석·문자열 위장이 구조적으로 불가능하고, 문자열 리터럴과 **정규식 리터럴**을 함께
 * 본다(예전 `kis-ledger-query.ts` 의 사본은 `const TOKEN_EXPIRED_RE = /EGW00123|…/` 였다).
 * 접근은 T-133 의 멱등성 울타리와 같다(`kis-balances-business-failure.test.ts`).
 */
describe('🔴 토큰 코드 비교는 단일 출처에만 있다 (사본 재발 방지)', () => {
  /**
   * 판정의 **정의**가 있는 곳. 여기 말고는 코드가 토큰 코드 문자열을 직접 들고 있으면 안 된다.
   * (T-136) 의존성 없는 잎 모듈이다 — `kis-http` 에 두면 `kis-auth → kis-http` 때문에 헬퍼가
   * 순환이 되고, `kis-http` 를 모킹한 시험이 판정까지 잃는다.
   */
  const SINGLE_SOURCE = 'kis-token-codes.ts';
  const CODES = ['EGW00123', 'EGW00121', '만료된 token'];

  const dir = path.join(__dirname, '..');
  type Hit = { f: string; n: number; text: string };

  function hitsIn(file: string, src: string): Hit[] {
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
    const out: Hit[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteralLike(node) || ts.isRegularExpressionLiteral(node)) {
        const raw = node.getText(sf);
        if (CODES.some(c => raw.includes(c))) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          out.push({ f: file, n: line + 1, text: raw.slice(0, 80) });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
  }

  const hits = fs.readdirSync(dir)
    .filter(f => f.endsWith('.ts') && f !== SINGLE_SOURCE)
    .flatMap(f => hitsIn(f, fs.readFileSync(path.join(dir, f), 'utf8')));

  test('교환 계층에 손으로 쓴 토큰 코드 비교가 없다 (단일 출처 잎 모듈만 예외)', () => {
    expect(hits.map(h => `${h.f}:${h.n} ${h.text}`)).toEqual([]);
  });

  test('단일 출처에는 세 코드가 모두 들어 있다 (울타리가 빈 통과하지 않는다)', () => {
    const src = fs.readFileSync(path.join(dir, SINGLE_SOURCE), 'utf8');
    const found = hitsIn(SINGLE_SOURCE, src);
    expect(found.length).toBeGreaterThan(0);
    for (const c of CODES) expect(found.some(h => h.text.includes(c))).toBe(true);
  });

  /** 울타리 자신의 회귀 시험 — 느슨해지면 조용히 죽는다(T-133 에서 세 번 뚫린 교훈). */
  test('파서 집계는 주석을 세지 않고, 문자열·정규식 사본은 잡는다', () => {
    const cases: Array<[string, string, number]> = [
      ['주석 언급',       '// EGW00123 은 토큰 만료다\nexport const a = 1;',                 0],
      ['JSDoc 언급',      '/**\n * EGW00121 설명\n */\nexport const a = 1;',                 0],
      ['문자열 사본',     "export const x = body.includes('EGW00123');",                     1],
      ['정규식 사본',     'export const RE = /EGW00123|만료된 token/;',                       1],
      ['템플릿 사본',     'export const t = `EGW00121`;',                                     1],
      ['한글 문구 사본',  "export const y = body.includes('만료된 token');",                  1],
      ['무관한 코드',     "export const z = body.includes('EGW00300');",                     0],
    ];
    for (const [name, src, expected] of cases) {
      expect({ name, n: hitsIn('synthetic.ts', src).length }).toEqual({ name, n: expected });
    }
  });
});

/**
 * 🔴 §동시성 — 같은 죽은 토큰에는 **판단 하나**만 돈다 (T-136 감사 M-1).
 *
 * 토큰이 죽으면 진행 중이던 조회 여러 건이 **동시에** 같은 응답을 받는다. 각자 재읽기를 하면, 먼저
 * 도착한 호출이 DB 행을 지운 뒤라 나머지는 "행 없음" 을 만나 **제각각 발급**하고, 그 중복 발급이 KIS 의
 * 1분 1회 제한에 걸려 60초 대기를 만든다 — 이 task 가 없애려던 바로 그 증상이다. 감사자 모델에서는
 * 4건 동시·간격 8ms 에서 104/120 회가 대기에 걸렸다.
 */
describe('🔴 같은 죽은 토큰이면 판단을 공유한다 (중복 발급 방지)', () => {
  test('동시 4건 → DB 재읽기 1회·재발급 1회, 전부 true', async () => {
    const { getKisToken, invalidateKisToken } = authMocks();
    const results = await Promise.all(
      [1, 2, 3, 4].map(() => shouldRetryAfterTokenError(EXPIRED_123, 'Bearer tok', 'x')),
    );
    expect(results).toEqual([true, true, true, true]);
    expect(getKisToken).toHaveBeenCalledTimes(1);
    expect(invalidateKisToken).toHaveBeenCalledTimes(1);
  });

  test('토큰이 다르면 공유하지 않는다 (서로 다른 사망은 서로 다른 판단)', async () => {
    const { getKisToken } = authMocks();
    await Promise.all([
      shouldRetryAfterTokenError(EXPIRED_123, 'Bearer aaa', 'x'),
      shouldRetryAfterTokenError(EXPIRED_123, 'Bearer bbb', 'x'),
    ]);
    expect(getKisToken).toHaveBeenCalledTimes(2);
  });

  test('판단이 끝나면 키를 지운다 — 다음 사망은 새로 판단한다', async () => {
    const { getKisToken } = authMocks();
    await shouldRetryAfterTokenError(EXPIRED_123, 'Bearer tok', 'x');
    await shouldRetryAfterTokenError(EXPIRED_123, 'Bearer tok', 'x');
    expect(getKisToken).toHaveBeenCalledTimes(2);
  });

  test('🔴 판단이 던지면 공유한 호출 전부가 던지고, 키는 남지 않는다', async () => {
    const { getKisToken } = authMocks();
    getKisToken.mockRejectedValueOnce(new Error('boom'));
    const settled = await Promise.allSettled(
      [1, 2].map(() => shouldRetryAfterTokenError(EXPIRED_123, 'Bearer tok', 'x')),
    );
    expect(settled.map(r => r.status)).toEqual(['rejected', 'rejected']);
    // 키가 남아 있으면 아래 호출이 그 실패한 판단을 돌려받는다.
    await expect(shouldRetryAfterTokenError(EXPIRED_123, 'Bearer tok', 'x')).resolves.toBe(true);
  });

  test('토큰 오류가 아니면 판단을 만들지도 않는다', async () => {
    const { getKisToken } = authMocks();
    await Promise.all([1, 2, 3].map(() => shouldRetryAfterTokenError(GATEWAY, 'Bearer tok', 'x')));
    expect(getKisToken).not.toHaveBeenCalled();
  });
});

/**
 * 🔴 **재발급 호출 자체를 울타리로 막는다** (T-136 감사 L-2).
 *
 * 코드 문자열 울타리는 원리상 뚫린다 — 감사자가 `/EGW0012[13]/`(문자 클래스)·소문자 비교·문자열
 * 이어붙이기·표현식 템플릿으로, 그리고 **코드 문자열 없이 `res.status === 401` 에서
 * `invalidateKisToken()` 을 직접 부르는 분기**로 통과시켰다. 마지막 모양이 특히 중요하다: 판정을
 * 어떻게 쓰든 **위험한 동작은 재발급 한 가지**다. 그래서 그 식별자를 두 파일 밖에서 금지한다.
 *
 * 금지하는 이유는 재발급이 비싸서가 아니라, **재발급을 먼저 하면** 다른 프로세스가 회전시킨 멀쩡한
 * 토큰을 지우고 `EGW00133` 60초 대기에 들어가 같은 프로세스의 `createOrder` 까지 막기 때문이다.
 */
describe('🔴 invalidateKisToken 은 두 파일에서만 부른다', () => {
  /** 정의한 곳과, 재읽기 우선 순서를 지키는 유일한 호출자. */
  const ALLOWED = ['src/lib/exchanges/kis-auth.ts', 'src/lib/exchanges/kis-token-retry.ts'];
  const SRC = path.join(__dirname, '..', '..', '..');   // src/

  /**
   * (T-136 라운드 2) 스캔을 **`src/` 전체 재귀**로 넓혔다 — 감사자가 하위 디렉터리·`.tsx`·교환 계층
   * 밖을 우회로 지적했고, 그중 "교환 계층 밖" 은 현실적이다 — 일봉 수집 모듈과 `app/api/` 여러 곳이
   * 이미 `getKisToken`·`kisFetch` 를 직접 쓴다. 시험 파일은 뺀다(모의 공장이 그 이름을 쓰는 것이 정상).
   *
   * ⚠ 이 주석에 profit-engine 모듈 **파일명을 적지 않는다** — T-119 격리 시험이 매매 경로에서 그
   *   이름을 찾으면 실패한다(이 파일도 그 검사 대상이다. 처음 적어서 실제로 1건 실패했다).
   */
  function walk(dir: string, rel = ''): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) return e.name === '__tests__' || e.name === 'node_modules' ? [] : walk(path.join(dir, e.name), r);
      return /\.tsx?$/.test(e.name) ? [r] : [];
    });
  }

  const refs = walk(SRC)
    .filter(rel => !ALLOWED.includes(`src/${rel}`))
    .flatMap(rel => {
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
      if (!src.includes('invalidateKisToken')) return [];
      const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true);
      const out: Array<{ f: string; n: number }> = [];
      const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && node.text === 'invalidateKisToken') {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          out.push({ f: `src/${rel}`, n: line + 1 });
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
      return out;
    });

  test('src 전체에서 재발급을 직접 부르는 곳은 허용 2파일뿐이다 (import 도 없다)', () => {
    expect(refs.map(r => `${r.f}:${r.n}`)).toEqual([]);
  });

  test('허용 파일에는 실제로 있다 (울타리가 빈 통과하지 않는다)', () => {
    for (const f of ALLOWED) {
      expect(fs.readFileSync(path.join(SRC, f.replace(/^src\//, '')), 'utf8')).toContain('invalidateKisToken');
    }
  });
});

/**
 * 🔴 **가드가 헬퍼보다 먼저**인지 8곳 전부에서 본다 (T-136 감사 H-1·L-3).
 *
 * H-1 은 원장 사이트만 가드를 헬퍼 **뒤에** 둬서, 재발급 뒤 또 토큰 오류가 나면 재발급이 2회 불린
 * 결함이었다. 감사자가 순서 뒤집기 변이를 8곳에 넣어 보니 **5곳은 시험이 못 잡았다** — 그 5곳이 지금
 * 맞게 쓰여 있는 것은 결함이 아니지만, **미래 편집을 막는 그물에 구멍**이다. 그래서 구조로 고정한다.
 */
describe('🔴 헬퍼 호출은 가드 뒤에 온다 (재발급 2회 방지)', () => {
  const GUARD = /^(attempt === 0|!tokenRetried)$/;
  const dir = path.join(__dirname, '..');

  function isGuarded(call: ts.Node, sf: ts.SourceFile): boolean {
    let n: ts.Node = call;
    while (n.parent) {
      const p: ts.Node = n.parent;
      // `GUARD && (await) shouldRetry…` — 가드가 왼쪽, 호출이 오른쪽
      if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
          && p.right === n && GUARD.test(p.left.getText(sf).trim())) return true;
      // `if (GUARD) { … shouldRetry… }`
      if (ts.isIfStatement(p) && p.thenStatement === n && GUARD.test(p.expression.getText(sf).trim())) return true;
      n = p;
    }
    return false;
  }

  const sites = fs.readdirSync(dir)
    .filter(f => f.endsWith('.ts') && f !== 'kis-token-retry.ts')
    .flatMap(f => {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true);
      const out: Array<{ at: string; guarded: boolean }> = [];
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && node.expression.getText(sf) === 'shouldRetryAfterTokenError') {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          out.push({ at: `${f}:${line + 1}`, guarded: isGuarded(node, sf) });
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
      return out;
    });

  test('8곳 전부 `attempt === 0` 또는 `!tokenRetried` 가드 뒤에 있다', () => {
    expect(sites).toHaveLength(8);
    for (const s of sites) expect(s).toEqual({ at: s.at, guarded: true });
  });
});

/**
 * 🔴 호출부가 **이번 요청에 실제로 실린 토큰**을 넘기는지 구조로 고정한다.
 *
 * 헬퍼의 2번째 인자가 `headers.Authorization`(또는 그것을 담은 지역 변수)이 아니면, "DB 토큰과 같은가"
 * 비교가 엉뚱한 값과 이뤄져 재발급 판단이 틀어진다 — 상수나 다른 토큰을 넘기면 **항상 "회전됐다"** 로
 * 읽혀 정말 죽은 토큰을 영원히 재발급하지 않는다(조용한 무력화).
 */
describe('🔴 헬퍼 호출은 이번 요청의 Authorization 을 넘긴다', () => {
  const ALLOWED_SECOND_ARG = ['headers.Authorization', 'usedAuth'];
  const dir = path.join(__dirname, '..');

  const calls = fs.readdirSync(dir)
    .filter(f => f.endsWith('.ts') && f !== 'kis-token-retry.ts')
    .flatMap(f => {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true);
      const out: Array<{ f: string; n: number; arg: string }> = [];
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && node.expression.getText(sf) === 'shouldRetryAfterTokenError') {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          out.push({ f, n: line + 1, arg: node.arguments[1]?.getText(sf) ?? '(없음)' });
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
      return out;
    });

  test('호출 지점이 8곳이고 전부 허용된 2번째 인자를 쓴다', () => {
    expect(calls).toHaveLength(8);
    for (const c of calls) {
      expect({ at: `${c.f}:${c.n}`, ok: ALLOWED_SECOND_ARG.includes(c.arg) })
        .toEqual({ at: `${c.f}:${c.n}`, ok: true });
    }
  });

  test('어댑터 3파일에 모두 들어 있다 (한 파일만 고치고 끝내지 않았다)', () => {
    const files = new Set(calls.map(c => c.f));
    expect([...files].sort()).toEqual(['kis-domestic.ts', 'kis-ledger-query.ts', 'kis-overseas.ts']);
  });
});
