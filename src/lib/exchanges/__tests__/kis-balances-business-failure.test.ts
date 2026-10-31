/**
 * T-132 — KIS 가 **HTTP 200 으로 업무 실패**를 돌려줄 때 잔고 조회가 그것을 성공으로 통과시키지 않는다.
 *
 * ## 실측 배경 (2026-10-31, KIS 측 장애)
 *
 * 09:23~ KIS 가 두 모양을 산발적으로 돌려줬다 — `EGW00300 Gateway 라우팅 오류`(HTTP 500)와
 * `OPSQ1002 SESSION FULL`(**HTTP 200** + `rt_cd:"9"`). 뒤쪽은 `res.ok` 가 true 라 어댑터의 실패
 * 처리를 통째로 비껴갔다:
 *  - 국내: `output2`(예수금) 없는 응답 → "예수금 행 없는 정상 잔고"
 *  - 해외: `data.output1 ?? []` → **"보유 종목 없음"** (정상 상태와 구분 불가, 총액이 조용히 축소)
 *
 * 평시 이 경로의 HTTP200 업무실패는 0건이다(10-27·29 42건/일, 10-30 40건 전부
 * `domestic.market-cap-ranking`). 따라서 실패로 바꾸는 것이 평상 동작을 바꾸지 않는다.
 */
import fs from 'fs';
import path from 'path';
import * as ts from 'typescript';

jest.mock('../kis-auth', () => ({
  getKisToken:        jest.fn(async () => 'tok'),
  invalidateKisToken: jest.fn(async () => {}),
  kisBaseUrl:         jest.fn(() => 'https://mock-base'),
}));

jest.mock('@/lib/credentials', () => ({
  getCredential: jest.fn(async (key: string) => {
    if (key === 'KIS_ACCOUNT_NO')      return '12345678';
    if (key === 'KIS_ACCOUNT_PRODUCT') return '01';
    return '';
  }),
}));

jest.mock('../kis-http', () => ({
  kisFetch:          jest.fn(),
  isKisRateLimited:  jest.fn(() => false),
  kisBodyText:       jest.fn(() => ''),
  // (T-133 Reviewer Info) 어댑터가 모듈 수준에서 import 하므로 공장에도 있어야 한다.
  // 이 파일의 시험은 토큰 분기에 닿지 않지만, 빠뜨리면 닿는 순간 "not a function" 으로 깨진다.
  isKisTokenError:   jest.fn(() => false),
}));

jest.mock('../fx', () => ({ getUsdKrwRate: jest.fn(async () => 1400) }));

import { kisFetch } from '../kis-http';
import { getBalances as domGetBalances } from '../kis-domestic';
import { getBalances as ovsGetBalances } from '../kis-overseas';

/** HTTP 200 인데 업무 실패 — KIS 장애 때 실제로 온 모양 */
const SESSION_FULL = { rt_cd: '9', msg_cd: 'OPSQ1002', msg1: 'SESSION FULL' };

function ok200(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('국내 잔고 — HTTP 200 업무실패', () => {
  test('🔴 rt_cd≠0 이면 던진다 (예전: 예수금 행 없는 잔고를 정상 반환)', async () => {
    (kisFetch as jest.Mock).mockResolvedValue(ok200(SESSION_FULL));
    await expect(domGetBalances()).rejects.toThrow(/200 업무실패 rt_cd=9 msg_cd=OPSQ1002 msg=SESSION FULL/);
  });

  test('rt_cd=0 이면 종전대로 파싱한다 (회귀)', async () => {
    (kisFetch as jest.Mock).mockResolvedValue(ok200({
      rt_cd: '0',
      output1: [{ pdno: '005930', hldg_qty: '30', pchs_avg_pric: '69300' }],
      output2: [{ dnca_tot_amt: '100000', prvs_rcdl_excc_amt: '80138' }],
    }));
    await expect(domGetBalances()).resolves.toEqual([
      { currency: 'KRW', free: 80_138, locked: 19_862 },
      { currency: '005930', free: 30, locked: 0, avgPrice: 69_300 },
    ]);
  });

  test('rt_cd 자체가 없는 응답은 종전 동작(파싱 진행) — 모양이 다른 TR 을 깨지 않는다', async () => {
    (kisFetch as jest.Mock).mockResolvedValue(ok200({ output1: [], output2: [{ dnca_tot_amt: '7' }] }));
    await expect(domGetBalances()).resolves.toEqual([{ currency: 'KRW', free: 7, locked: 0 }]);
  });
});

describe('해외 보유 — HTTP 200 업무실패', () => {
  test('🔴 rt_cd≠0 이면 던진다 (예전: 빈 보유 목록 = 보유 없음으로 보였다)', async () => {
    (kisFetch as jest.Mock).mockResolvedValue(ok200(SESSION_FULL));
    await expect(ovsGetBalances()).rejects.toThrow(/overseas getBalances\(NAS\): 200 업무실패 rt_cd=9/);
  });

  test('rt_cd=0 + 보유 없음은 그대로 빈 배열이다 (정상 상태와 구분)', async () => {
    (kisFetch as jest.Mock).mockResolvedValue(ok200({ rt_cd: '0', output1: [] }));
    await expect(ovsGetBalances()).resolves.toEqual([]);
  });
});

describe('🔴 transientRetries 는 멱등한 읽기 전용 조회에만 켠다 (주문 중복 방지 울타리)', () => {
  /**
   * 재시도를 허용한 라벨. 늘릴 때는 "같은 요청을 두 번 보내도 안전한가"를 먼저 답해야 한다.
   * (T-133) 시세 2곳 추가 — 둘 다 GET 조회라 `kisFetch` 런타임 가드를 통과한다.
   */
  const ALLOWED = [
    "label: 'domestic getBalances'", "label: 'overseas getBalances'", "label: 'overseas usdCash'",
    "label: 'domestic getTicker'",   "label: 'overseas getTicker'",
  ];

  /**
   * `kis-http.ts`(옵션을 정의한 관문)와 시험 파일을 뺀 **교환 계층 전체**를 본다 — 두 파일만 보던
   * 예전 판은 다른 어댑터에 옵션이 생기면 못 봤다(T-132 Reviewer M-1).
   *
   * 이 시험은 "호출 지점의 생김새"만 본다. 옵션 객체를 변수로 넘기면 비껴가므로, 진짜 울타리는
   * `kisFetch` 안의 런타임 검사(GET 아닌 method 면 throw)다 — 그쪽 시험은 `kis-http.test.ts`.
   */
  const dir = path.join(__dirname, '..');

  /**
   * 🔴 호출 지점은 **TypeScript 파서로** 센다 (T-133 QA #1).
   *
   * 줄 문자열로 주석을 가려내던 판은 두 번 뚫렸다 — 블록을 같은 줄에서 닫고 코드를 붙인 모양
   * (T-133 Reviewer M-1)과 첫 글자가 `*` 인 **코드** 줄(T-133 QA #1, 예: 한 줄 제너레이터 메서드).
   * 규칙을 또 손보는 대신, 주석을 애초에 "모르는" 층으로 내려간다 — 파서는 주석을 trivia 로
   * 버리므로 주석으로 위장하는 것이 **구조적으로 불가능**하고, 문자열 리터럴 안의 언급도 세지 않는다.
   * (줄 단위 치환을 쓰지 않은 이유이기도 하다: 문자열 속 `//`·`/*` 가 호출 지점을 지운다.)
   */
  type Hit = { f: string; n: number; obj: string };
  function hitsIn(file: string, src: string): Hit[] {
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
    const out: Hit[] = [];
    const visit = (node: ts.Node): void => {
      /**
       * 속성 **대입**만 세면 같은 옵션을 다른 문법으로 적어 비껴갈 수 있다 — 따옴표 키·계산 키·
       * `o.transientRetries = 2`·`o['transientRetries'] = 2`·getter (T-133 Reviewer M-3 이 7가지로 실증).
       * 그래서 `transientRetries` 라는 **식별자·문자열 토큰 전부**를 센다. 줄 기반 판(라운드 3)이
       * 우연히 갖고 있던 커버리지를 파서로 옮기면서 잃었던 것을 되찾는다.
       */
      if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && node.text === 'transientRetries') {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        // 라벨 대조 범위 — 가장 가까운 객체 리터럴, 없으면 감싸는 문장.
        let scope: ts.Node = node;
        while (scope.parent && !ts.isObjectLiteralExpression(scope) && !ts.isStatement(scope)) scope = scope.parent;
        out.push({ f: file, n: line + 1, obj: scope.getText(sf) });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
  }

  const lines = fs.readdirSync(dir)
    .filter(f => f.endsWith('.ts') && f !== 'kis-http.ts')
    .flatMap(f => hitsIn(f, fs.readFileSync(path.join(dir, f), 'utf8')));

  test('켜 둔 호출 지점은 허용 라벨 5곳뿐이다 (주문·취소·원장 경로에는 없다)', () => {
    expect(lines.map(x => `${x.f}:${x.n}`)).toHaveLength(ALLOWED.length);
    for (const x of lines) {
      // 실패했을 때 어느 파일·줄이 범인인지 보이게 위치를 단언문에 싣는다.
      expect({ at: `${x.f}:${x.n}`, allowed: ALLOWED.some(a => x.obj.includes(a)) })
        .toEqual({ at: `${x.f}:${x.n}`, allowed: true });
    }
  });

  test('허용 라벨 5개가 각각 정확히 한 번씩 쓰였다', () => {
    for (const a of ALLOWED) {
      expect(lines.filter(x => x.obj.includes(a))).toHaveLength(1);
    }
  });

  /**
   * 🔴 울타리 **자신**의 회귀 시험. 집계가 느슨해지면 울타리가 조용히 죽으므로, 주석과 코드를
   * 가르는 경계를 합성 소스로 직접 고정한다. 아래 두 줄(M-1·QA #1)이 예전 판을 각각 뚫은 모양이다.
   */
  test('파서 집계는 주석·문자열을 세지 않고, 위장한 코드는 놓치지 않는다', () => {
    const cases: Array<[string, string, number]> = [
      ['JSDoc 블록',            '/**\n * transientRetries 는 GET 에만 켠다\n */\nexport const a = 1;', 0],
      ['한 줄 주석',            '// kisFetch(u, {}, { transientRetries: 2 })\nexport const a = 1;',        0],
      ['문자열 속 언급',        'export const s = "transientRetries: 2";',                                 0],
      ['블록 닫고 코드(M-1)',   '/* x */ kisFetch(u, { method: "POST" }, { transientRetries: 2 });',       1],
      // 🔴 QA #1 의 실제 모양 — 속성이 놓인 **줄의 첫 글자가 `*`** 여야 예전 판을 재현한다.
      //    한 줄로 적으면 줄이 `class` 로 시작해 변이를 못 잡는다(라운드 5 변이 Q1 에서 실제로 놓쳤다).
      ['별표로 시작(QA #1)',
       'class A {\n  *g() { return kisFetch(u, { method: "POST" }, { transientRetries: 2 }); }\n}',      1],
      ['별표 이어붙인 곱셈 줄',
       'const n = 1\n  * f({ transientRetries: 2 });',                                                    1],
      ['줄 끝 주석',            'kisFetch(u, {}, { transientRetries: 2 }); // 메모',                       1],
      ['변수로 분리',           'const o = { transientRetries: 2 };',                                      1],
      ['여러 줄 옵션 객체',     'kisFetch(u, {}, {\n  label: "x",\n  transientRetries: 2,\n});',          1],
      ['따옴표 키',             'kisFetch(u, {}, { "transientRetries": 2 });',                             1],
      ['계산 키(문자열)',       'kisFetch(u, {}, { ["transientRetries"]: 2 });',                           1],
      ['계산 키(템플릿)',       'kisFetch(u, {}, { [`transientRetries`]: 2 });',                           1],
      ['대입문',                'const o: any = {};\no.transientRetries = 2;',                              1],
      ['요소 대입',             'const o: any = {};\no["transientRetries"] = 2;',                           1],
      ['getter',                'kisFetch(u, {}, { get transientRetries() { return 2; } });',              1],
      ['shorthand',             'kisFetch(u, {}, { transientRetries });',                                  1],
      ['화살표 콜백 안',        'const f = () => kisFetch(u, {}, { transientRetries: 2 });',               1],
    ];
    for (const [name, src, expected] of cases) {
      expect({ name, n: hitsIn('synthetic.ts', src).length }).toEqual({ name, n: expected });
    }
  });
});
