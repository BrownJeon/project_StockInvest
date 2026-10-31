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
  /** 재시도를 허용한 라벨. 늘릴 때는 "같은 요청을 두 번 보내도 안전한가"를 먼저 답해야 한다. */
  const ALLOWED = ["label: 'domestic getBalances'", "label: 'overseas getBalances'", "label: 'overseas usdCash'"];

  /**
   * `kis-http.ts`(옵션을 정의한 관문)와 시험 파일을 뺀 **교환 계층 전체**를 본다 — 두 파일만 보던
   * 예전 판은 다른 어댑터에 옵션이 생기면 못 봤다(T-132 Reviewer M-1).
   *
   * 이 시험은 "호출 지점의 생김새"만 본다. 옵션 객체를 변수로 넘기면 비껴가므로, 진짜 울타리는
   * `kisFetch` 안의 런타임 검사(GET 아닌 method 면 throw)다 — 그쪽 시험은 `kis-http.test.ts`.
   */
  const dir = path.join(__dirname, '..');
  const lines = fs.readdirSync(dir)
    .filter(f => f.endsWith('.ts') && f !== 'kis-http.ts')
    .flatMap(f => fs.readFileSync(path.join(dir, f), 'utf8')
      .split('\n')
      .map((l, i) => ({ f, n: i + 1, l: l.trim() }))
      .filter(x => x.l.includes('transientRetries')));

  test('켜 둔 호출 지점은 허용 라벨 3곳뿐이다 (주문·취소·원장·시세 경로에는 없다)', () => {
    expect(lines.map(x => `${x.f}:${x.n}`)).toHaveLength(ALLOWED.length);
    for (const x of lines) {
      // 실패했을 때 어느 파일·줄이 범인인지 보이게 위치를 단언문에 싣는다.
      expect({ at: `${x.f}:${x.n}`, allowed: ALLOWED.some(a => x.l.includes(a)) })
        .toEqual({ at: `${x.f}:${x.n}`, allowed: true });
    }
  });

  test('허용 라벨 3개가 각각 정확히 한 번씩 쓰였다', () => {
    for (const a of ALLOWED) {
      expect(lines.filter(x => x.l.includes(a))).toHaveLength(1);
    }
  });
});
