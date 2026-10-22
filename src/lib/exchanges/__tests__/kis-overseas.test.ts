import { kisFetch } from '../kis-http';
import { getActiveOrders, getCompletedOrders, MAX_COMPLETED_ORDERS_PAGES } from '../kis-overseas';

jest.mock('../kis-auth', () => ({
  getKisToken: jest.fn(async () => 'tok'),
  kisBaseUrl: jest.fn(() => 'https://mock-base'),
}));

jest.mock('@/lib/credentials', () => ({
  getCredential: jest.fn(async (key: string) => {
    if (key === 'KIS_ACCOUNT_NO') return '12345678';
    if (key === 'KIS_ACCOUNT_PRODUCT') return '01';
    return '';
  }),
}));

jest.mock('../kis-http', () => ({
  kisFetch: jest.fn(),
  isKisRateLimited: jest.fn(() => false),
  kisBodyText: jest.fn(() => ''),
}));

function fakeResponse(opts: {
  trCont?: string;
  rt_cd?: string;
  output?: unknown;
  ctx_area_fk200?: string;
  ctx_area_nk200?: string;
}) {
  const {
    trCont = '', rt_cd = '0', output = [], ctx_area_fk200 = '', ctx_area_nk200 = '',
  } = opts;
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name === 'tr_cont' ? trCont : null) },
    json: async () => ({ rt_cd, output, ctx_area_fk200, ctx_area_nk200 }),
    text: async () => '',
  };
}

describe('kis-overseas getActiveOrders — 연속조회(페이지네이션)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('단일 페이지면 한 번만 호출한다 — 기존 동작 회귀 없음', async () => {
    (kisFetch as jest.Mock).mockResolvedValueOnce(fakeResponse({
      trCont: 'D',
      output: [{ odno: 'O1', pdno: 'aapl', nccs_qty: '2', ovrs_excg_cd: 'NASD' }],
    }));

    const result = await getActiveOrders();

    expect(kisFetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ orderId: 'O1', symbol: 'NAS:AAPL' }]);
  });

  test('tr_cont=M 이면 FK200/NK200으로 다음 페이지를 요청해 결과를 합친다', async () => {
    (kisFetch as jest.Mock)
      .mockResolvedValueOnce(fakeResponse({
        trCont: 'M',
        output: [{ odno: 'O1', pdno: 'aapl', nccs_qty: '2', ovrs_excg_cd: 'NASD' }],
        ctx_area_fk200: 'FK2', ctx_area_nk200: 'NK2',
      }))
      .mockResolvedValueOnce(fakeResponse({
        trCont: 'D',
        output: [{ odno: 'O2', pdno: 'tsla', nccs_qty: '1', ovrs_excg_cd: 'NASD' }],
      }));

    const result = await getActiveOrders();

    expect(kisFetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual([
      { orderId: 'O1', symbol: 'NAS:AAPL' },
      { orderId: 'O2', symbol: 'NAS:TSLA' },
    ]);

    const secondCallUrl = (kisFetch as jest.Mock).mock.calls[1][0] as string;
    expect(secondCallUrl).toContain('CTX_AREA_FK200=FK2');
    expect(secondCallUrl).toContain('CTX_AREA_NK200=NK2');
    const secondCallHeaders = (kisFetch as jest.Mock).mock.calls[1][1].headers as Record<string, string>;
    expect(secondCallHeaders.tr_cont).toBe('N');
  });

  test('🔴 페이지 상한에 도달했는데 tr_cont 가 여전히 계속을 가리키면 던진다(잘린 목록을 성공으로 위장하지 않는다)', async () => {
    (kisFetch as jest.Mock).mockImplementation(async () => fakeResponse({
      trCont: 'M',
      output: [{ odno: 'X', pdno: 'aapl', nccs_qty: '1', ovrs_excg_cd: 'NASD' }],
      ctx_area_fk200: 'F', ctx_area_nk200: 'N',
    }));

    await expect(getActiveOrders()).rejects.toThrow(/페이지 상한\(20\)/);

    expect(kisFetch).toHaveBeenCalledTimes(20);
  });
});

/**
 * T-071 WP-1 (설계 v2-3 / reviewer R-04) — 체결조회도 다음 페이지를 **따라간다.**
 *
 * 예전에는 첫 페이지만 읽어, 대상 주문이 2페이지에 있으면 order-sync 가 "체결목록에 없다"로 보고
 * 실제로 체결된 주문을 취소로 오판할 수 있었다. "다음 페이지 신호면 바로 실패"가 아니라 따라가고,
 * 상한을 넘을 때만 실패한다(잘린 목록을 성공으로 위장하지 않는다).
 */
describe('kis-overseas getCompletedOrders — 연속조회(페이지네이션) T-071', () => {
  beforeEach(() => jest.clearAllMocks());
  const ccnl = (odno: string, qty: string) => ({
    odno, sll_buy_dvsn_cd: '01', ft_ccld_qty: qty, ft_ccld_unpr3: '201.5',
    dmst_ord_dt: '20261022', ord_tmd: '233000',
  });
  const call = () => getCompletedOrders('NAS:AAPL', Date.now() - 60_000, Date.now(), 100);

  test('단일 페이지(tr_cont 없음) → 1회 호출, 첫 요청에는 연속조회 헤더를 붙이지 않는다(기존 동작)', async () => {
    (kisFetch as jest.Mock).mockResolvedValueOnce(fakeResponse({ output: [ccnl('A1', '3')] }));

    const r = await call();
    expect(kisFetch).toHaveBeenCalledTimes(1);
    expect(r).toEqual([expect.objectContaining({ orderId: 'A1', qty: 3, price: 201.5, side: 'sell' })]);
    const h = (kisFetch as jest.Mock).mock.calls[0][1].headers as Record<string, string>;
    expect(h).not.toHaveProperty('tr_cont');
  });

  test('tr_cont=M → FK200/NK200 으로 2페이지를 요청해 병합한다 (2페이지에만 있는 주문도 찾는다)', async () => {
    (kisFetch as jest.Mock)
      .mockResolvedValueOnce(fakeResponse({
        trCont: 'M', output: [ccnl('A1', '3')], ctx_area_fk200: 'FKX', ctx_area_nk200: 'NKX',
      }))
      .mockResolvedValueOnce(fakeResponse({ trCont: 'D', output: [ccnl('B2', '5')] }));

    const r = await call();
    expect(kisFetch).toHaveBeenCalledTimes(2);
    expect(r.map(o => o.orderId)).toEqual(['A1', 'B2']);
    const url2 = (kisFetch as jest.Mock).mock.calls[1][0] as string;
    expect(url2).toContain('CTX_AREA_FK200=FKX');
    expect(url2).toContain('CTX_AREA_NK200=NKX');
    expect(((kisFetch as jest.Mock).mock.calls[1][1].headers as Record<string, string>).tr_cont).toBe('N');
  });

  test('V-03 — 연속조회 상한 값은 10 으로 고정한다(상수 변경이 시험을 통과하지 못하게)', () => {
    expect(MAX_COMPLETED_ORDERS_PAGES).toBe(10);
  });

  test('🔴 상한(MAX_COMPLETED_ORDERS_PAGES)에 도달했는데 계속이면 던진다', async () => {
    (kisFetch as jest.Mock).mockImplementation(async () => fakeResponse({
      trCont: 'M', output: [ccnl('X', '1')], ctx_area_fk200: 'F', ctx_area_nk200: 'N',
    }));

    await expect(call()).rejects.toThrow(new RegExp(`페이지 상한\\(${MAX_COMPLETED_ORDERS_PAGES}\\)`));
    expect(kisFetch).toHaveBeenCalledTimes(MAX_COMPLETED_ORDERS_PAGES);
  });

  test('🔴 2페이지 요청이 실패하면 1페이지 결과로 판정하지 않고 전체 실패', async () => {
    (kisFetch as jest.Mock)
      .mockResolvedValueOnce(fakeResponse({
        trCont: 'M', output: [ccnl('A1', '3')], ctx_area_fk200: 'F', ctx_area_nk200: 'N',
      }))
      .mockResolvedValueOnce(fakeResponse({ rt_cd: '1' }));

    await expect(call()).rejects.toThrow(/rt_cd=1/);
  });
});
