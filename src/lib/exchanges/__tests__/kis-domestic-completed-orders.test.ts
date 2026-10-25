/**
 * T-081 WP-A (A06) — 국내 일별 주문체결 조회 TR 보정.
 *
 * 2026-10-25 라이브 읽기 비교: 같은 조건(계정·기간·종목·체결만)에서 구 `TTTC8001R` 호출은
 * HTTP 200 + rt_cd=0 + "조회할 내용이 없습니다"(빈 목록), 현행 `TTTC0081R` + `EXCG_ID_DVSN_CD=ALL`
 * 호출은 체결 2건이었다. TR ID 와 파라미터가 함께 달라 원인 분리는 못 했다. 빈 목록은 "체결 0건"으로
 * 정상 취급되므로 구 호출로 되돌아가면 order-sync 가 체결된 주문을 취소/미체결로 오판할 수 있다(침묵 오답).
 *
 * 같은 이유로 연속조회 신호(tr_cont=M/F)는 던진다 — order-sync 의 부재 추론은 완전한 목록이 전제다.
 *
 * 이 파일이 고정하는 것:
 *  1. 실전/모의 요청 형태 — TR ID·거래소 구분·종목·체결만·KST 날짜
 *  2. 응답 매핑 — 반환 형식 `{orderId, side, price, qty, ts}` 불변
 *  3. 실패 처리 — rt_cd≠0·HTTP 비정상 throw, 토큰 만료 1회 재시도, rt_cd=0 빈 목록 → [],
 *     tr_cont=M/F(다음 페이지 있음) → throw (fail-closed, 연속조회 미구현)
 *  4. 레거시 TR 문자열이 실행 코드로 되살아나지 않는다(정적 봉인)
 *
 * 금액·종목·주문번호는 전부 가짜 값이다. KIS 실호출 없음(kisFetch·인증 모킹).
 */
import * as fs from 'fs';
import * as path from 'path';

const kisFetchMock = jest.fn();

jest.mock('@/lib/exchanges/kis-http', () => {
  const actual = jest.requireActual('@/lib/exchanges/kis-http');
  return { ...actual, kisFetch: (...a: unknown[]) => kisFetchMock(...a) };
});
jest.mock('@/lib/exchanges/kis-auth', () => ({
  getKisToken:        jest.fn(async () => 'test-token'),
  invalidateKisToken: jest.fn(async () => 'test-token'),
  kisBaseUrl:         () => 'https://kis.example',
}));
jest.mock('@/lib/credentials', () => ({
  getCredential: jest.fn(async (k: string) =>
    k === 'KIS_ACCOUNT_NO' ? '12345678' : k === 'KIS_ACCOUNT_PRODUCT' ? '01' : 'x'),
}));

import * as dom from '@/lib/exchanges/kis-domestic';
import { invalidateKisToken } from '@/lib/exchanges/kis-auth';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** KST 2026-10-19 00:30 (UTC 10-18 15:30) — UTC 날짜로 찍으면 20261018 이 된다 */
const FROM = Date.UTC(2026, 9, 18, 15, 30, 0);
/** KST 2026-10-25 23:59 (UTC 10-25 14:59) */
const TO   = Date.UTC(2026, 9, 25, 14, 59, 0);

const ORIG_MOCK = process.env.KIS_MOCK;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  process.env.KIS_MOCK = 'false';
});
afterEach(() => { jest.restoreAllMocks(); });
afterAll(() => {
  if (ORIG_MOCK === undefined) delete process.env.KIS_MOCK; else process.env.KIS_MOCK = ORIG_MOCK;
});

/** n 번째 kisFetch 호출의 URL·헤더·라벨 */
function call(n = 0): { url: URL; headers: Record<string, string>; label: string } {
  const [u, init, opts] = kisFetchMock.mock.calls[n] as [string, { headers: Record<string, string> }, { label: string }];
  return { url: new URL(u), headers: init.headers, label: opts?.label };
}

describe('국내 getCompletedOrders — 요청 형태 (현행 TR)', () => {
  test('실전: TTTC0081R + EXCG_ID_DVSN_CD=ALL + 종목·체결만·KST 날짜', async () => {
    kisFetchMock.mockResolvedValue(json({ rt_cd: '0', output1: [] }));
    await dom.getCompletedOrders('005930', FROM, TO, 100);

    expect(kisFetchMock).toHaveBeenCalledTimes(1);
    const { url, headers, label } = call();
    expect(url.pathname).toBe('/uapi/domestic-stock/v1/trading/inquire-daily-ccld');
    expect(headers.tr_id).toBe('TTTC0081R');
    const q = url.searchParams;
    expect(q.get('EXCG_ID_DVSN_CD')).toBe('ALL');
    expect(q.get('PDNO')).toBe('005930');
    expect(q.get('CCLD_DVSN')).toBe('01');
    expect(q.get('INQR_STRT_DT')).toBe('20261019');
    expect(q.get('INQR_END_DT')).toBe('20261025');
    // 기존 파라미터는 그대로
    expect(q.get('CANO')).toBe('12345678');
    expect(q.get('ACNT_PRDT_CD')).toBe('01');
    expect(q.get('SLL_BUY_DVSN_CD')).toBe('00');
    expect(q.get('INQR_DVSN')).toBe('00');
    expect(q.get('INQR_DVSN_3')).toBe('00');
    // T-040 가드 시험이 라벨 집합을 고정한다 — 라벨 불변
    expect(label).toBe('domestic getCompletedOrders');
  });

  test('모의: VTTC0081R + EXCG_ID_DVSN_CD=KRX (모의는 KRX 만 지원)', async () => {
    process.env.KIS_MOCK = 'true';
    kisFetchMock.mockResolvedValue(json({ rt_cd: '0', output1: [] }));
    await dom.getCompletedOrders('000660', FROM, TO, 100);

    const { url, headers } = call();
    expect(headers.tr_id).toBe('VTTC0081R');
    expect(url.searchParams.get('EXCG_ID_DVSN_CD')).toBe('KRX');
    expect(url.searchParams.get('PDNO')).toBe('000660');
  });
});

describe('국내 getCompletedOrders — 응답 매핑 (반환 형식 불변)', () => {
  test('체결 행만 {orderId, side, price(avg_prvs), qty, ts} 로 매핑, 미체결·odno 빈 행 제외', async () => {
    kisFetchMock.mockResolvedValue(json({
      rt_cd: '0', msg1: '조회가 완료되었습니다',
      output1: [
        // 매도 체결
        { odno: '0000011111', pdno: '005930', sll_buy_dvsn_cd: '01', tot_ccld_qty: '3',
          avg_prvs: '12345', ord_unpr: '12000', ord_dt: '20261023', ord_tmd: '093015', cncl_yn: 'N' },
        // 미체결(체결수량 0) — 제외
        { odno: '0000022222', pdno: '005930', sll_buy_dvsn_cd: '02', tot_ccld_qty: '0',
          avg_prvs: '0', ord_unpr: '11000', ord_dt: '20261023', ord_tmd: '100000', cncl_yn: 'N' },
        // 매수 체결 — avg_prvs 없으면 ord_unpr
        { odno: '0000033333', pdno: '005930', sll_buy_dvsn_cd: '02', tot_ccld_qty: '2',
          ord_unpr: '11500', ord_dt: '20261024', ord_tmd: '141500', cncl_yn: 'N' },
        // odno 빈 행 — 제외
        { odno: '', pdno: '005930', sll_buy_dvsn_cd: '01', tot_ccld_qty: '1',
          avg_prvs: '12000', ord_dt: '20261024', ord_tmd: '150000' },
      ],
      output2: { tot_ord_qty: '6', tot_ccld_qty: '6' },
    }));

    const r = await dom.getCompletedOrders('005930', FROM, TO, 100);
    expect(r).toEqual([
      { orderId: '0000011111', side: 'sell', price: 12345, qty: 3,
        ts: Date.parse('2026-10-23T09:30:15+09:00') },
      { orderId: '0000033333', side: 'buy',  price: 11500, qty: 2,
        ts: Date.parse('2026-10-24T14:15:00+09:00') },
    ]);
  });
});

describe('국내 getCompletedOrders — 실패 처리 (기존 동작 불변)', () => {
  test('rt_cd≠0 → throw', async () => {
    kisFetchMock.mockResolvedValue(json({ rt_cd: '1', msg_cd: 'OPSQ0001', msg1: '오류' }));
    await expect(dom.getCompletedOrders('005930', FROM, TO, 100)).rejects.toThrow(/rt_cd=1/);
  });

  test('HTTP 비정상 → throw', async () => {
    kisFetchMock.mockResolvedValue(json({ rt_cd: '1', msg1: 'server error' }, 500));
    await expect(dom.getCompletedOrders('005930', FROM, TO, 100)).rejects.toThrow(/500/);
  });

  test('토큰 만료(EGW00123) → 1회 재발급 후 같은 TR 로 재시도', async () => {
    kisFetchMock
      .mockResolvedValueOnce(json({ rt_cd: '1', msg_cd: 'EGW00123', msg1: '기간이 만료된 token 입니다.' }, 500))
      .mockResolvedValueOnce(json({ rt_cd: '0', output1: [
        { odno: '0000044444', sll_buy_dvsn_cd: '01', tot_ccld_qty: '1', avg_prvs: '10000',
          ord_dt: '20261023', ord_tmd: '090000' },
      ] }));
    const r = await dom.getCompletedOrders('005930', FROM, TO, 100);
    expect(invalidateKisToken).toHaveBeenCalledTimes(1);
    expect(kisFetchMock).toHaveBeenCalledTimes(2);
    expect(call(1).headers.tr_id).toBe('TTTC0081R');
    expect(r.map(o => o.orderId)).toEqual(['0000044444']);
  });

  test('토큰 만료가 두 번이면 두 번째는 throw (무한 재시도 없음)', async () => {
    kisFetchMock.mockImplementation(async () =>
      json({ rt_cd: '1', msg_cd: 'EGW00123', msg1: '기간이 만료된 token 입니다.' }, 500));
    await expect(dom.getCompletedOrders('005930', FROM, TO, 100)).rejects.toThrow(/500/);
    expect(kisFetchMock).toHaveBeenCalledTimes(2);
  });

  test('rt_cd=0 + output1 [] → [] (진짜 0건)', async () => {
    kisFetchMock.mockResolvedValue(json({ rt_cd: '0', msg1: '조회할 내용이 없습니다', output1: [] }));
    await expect(dom.getCompletedOrders('005930', FROM, TO, 100)).resolves.toEqual([]);
  });

  const pageResp = (trCont: string | null, body: unknown = { rt_cd: '0', output1: [
    { odno: '0000055555', sll_buy_dvsn_cd: '02', tot_ccld_qty: '1', avg_prvs: '9000',
      ord_dt: '20261023', ord_tmd: '090000' },
  ] }) => new Response(JSON.stringify(body),
    { status: 200, headers: trCont === null ? {} : { tr_cont: trCont } });

  test.each(['M', 'F'])('연속조회 신호 tr_cont=%s → throw (첫 페이지만으로 부재 판정 불가), 추가 요청 없음', async (tc) => {
    kisFetchMock.mockResolvedValue(pageResp(tc));
    const p = dom.getCompletedOrders('005930', FROM, TO, 100);
    await expect(p).rejects.toThrow(new RegExp(`005930.*tr_cont=${tc}.*20261019~20261025`));
    expect(kisFetchMock).toHaveBeenCalledTimes(1);
  });

  test.each([['D'], ['E'], [null]])('tr_cont=%s(마지막 페이지/없음/헤더 없음) → 정상 반환', async (tc) => {
    kisFetchMock.mockResolvedValue(pageResp(tc as string | null));
    const r = await dom.getCompletedOrders('005930', FROM, TO, 100);
    expect(r.map(o => o.orderId)).toEqual(['0000055555']);
    expect(kisFetchMock).toHaveBeenCalledTimes(1);
  });

  test('rt_cd≠0 이면 tr_cont=M 이어도 rt_cd 오류가 먼저 (검사 순서 고정)', async () => {
    kisFetchMock.mockResolvedValue(pageResp('M', { rt_cd: '1', msg_cd: 'OPSQ0001', msg1: '오류' }));
    const err = await dom.getCompletedOrders('005930', FROM, TO, 100).catch((e: Error) => e);
    expect(String(err)).toMatch(/rt_cd=1/);
    expect(String(err)).not.toMatch(/tr_cont/);
  });

  test('tr_cont=M + 빈 목록(output1 []) 도 throw — "체결 0건"으로 읽지 않는다', async () => {
    kisFetchMock.mockResolvedValue(pageResp('M', { rt_cd: '0', output1: [] }));
    await expect(dom.getCompletedOrders('005930', FROM, TO, 100)).rejects.toThrow(/tr_cont=M/);
  });

  test('tr_cont=M + output1 누락 도 throw — rows==null 조기 반환보다 먼저 검사', async () => {
    kisFetchMock.mockResolvedValue(pageResp('M', { rt_cd: '0' }));
    await expect(dom.getCompletedOrders('005930', FROM, TO, 100)).rejects.toThrow(/tr_cont=M/);
  });
});

describe('레거시 TR 회귀 봉인 (정적)', () => {
  test('kis-domestic.ts 실행 코드에 TTTC8001R/VTTC8001R 이 없다(주석 제외), 현행 TR 은 있다', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'kis-domestic.ts'), 'utf-8');
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')          // 블록 주석
      .replace(/(^|\s)\/\/.*$/gm, '$1');          // 줄 주석 (https:// 같은 문자열은 앞이 ':' 라 보존)
    expect(code).not.toMatch(/[TV]TTC8001R/);
    expect(code).toMatch(/'TTTC0081R'/);
    expect(code).toMatch(/'VTTC0081R'/);
  });
});
