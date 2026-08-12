import { kisFetch } from '../kis-http';
import { getActiveOrders } from '../kis-domestic';

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
  ok?: boolean;
  trCont?: string;
  rt_cd?: string;
  output?: unknown;
  ctx_area_fk100?: string;
  ctx_area_nk100?: string;
}) {
  const {
    ok = true, trCont = '', rt_cd = '0', output = [], ctx_area_fk100 = '', ctx_area_nk100 = '',
  } = opts;
  return {
    ok,
    status: ok ? 200 : 500,
    headers: { get: (name: string) => (name === 'tr_cont' ? trCont : null) },
    json: async () => ({ rt_cd, output, ctx_area_fk100, ctx_area_nk100 }),
    text: async () => '',
  };
}

describe('kis-domestic getActiveOrders — 연속조회(페이지네이션)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('단일 페이지(tr_cont 없음)면 한 번만 호출하고 그대로 반환한다 — 기존 동작 회귀 없음', async () => {
    (kisFetch as jest.Mock).mockResolvedValueOnce(fakeResponse({
      trCont: 'D',
      output: [{ odno: 'O1', pdno: '005930', rmn_qty: '5' }],
    }));

    const result = await getActiveOrders();

    expect(kisFetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ orderId: 'O1', symbol: '005930' }]);
  });

  test('tr_cont=M 이면 두 번째 페이지를 이전 응답의 ctx_area 값으로 다시 요청하고 결과를 합친다', async () => {
    (kisFetch as jest.Mock)
      .mockResolvedValueOnce(fakeResponse({
        trCont: 'M',
        output: [{ odno: 'O1', pdno: '005930', rmn_qty: '5' }],
        ctx_area_fk100: 'FK_PAGE2',
        ctx_area_nk100: 'NK_PAGE2',
      }))
      .mockResolvedValueOnce(fakeResponse({
        trCont: 'D',
        output: [{ odno: 'O2', pdno: '000660', rmn_qty: '3' }],
      }));

    const result = await getActiveOrders();

    expect(kisFetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual([
      { orderId: 'O1', symbol: '005930' },
      { orderId: 'O2', symbol: '000660' },
    ]);

    // 두 번째 호출의 URL/헤더가 연속조회 프로토콜을 정확히 따르는지 확인
    const secondCallUrl = (kisFetch as jest.Mock).mock.calls[1][0] as string;
    expect(secondCallUrl).toContain('CTX_AREA_FK100=FK_PAGE2');
    expect(secondCallUrl).toContain('CTX_AREA_NK100=NK_PAGE2');
    const secondCallHeaders = (kisFetch as jest.Mock).mock.calls[1][1].headers as Record<string, string>;
    expect(secondCallHeaders.tr_cont).toBe('N');

    // 첫 번째 호출은 빈 값으로 시작해야 한다
    const firstCallHeaders = (kisFetch as jest.Mock).mock.calls[0][1].headers as Record<string, string>;
    expect(firstCallHeaders.tr_cont).toBe('');
  });

  test('tr_cont=F 도 계속으로 취급해 다음 페이지를 요청한다', async () => {
    (kisFetch as jest.Mock)
      .mockResolvedValueOnce(fakeResponse({ trCont: 'F', output: [{ odno: 'O1', pdno: '005930', rmn_qty: '1' }] }))
      .mockResolvedValueOnce(fakeResponse({ trCont: 'E', output: [] }));

    const result = await getActiveOrders();

    expect(kisFetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual([{ orderId: 'O1', symbol: '005930' }]);
  });

  test('페이지 상한에 도달하면 경고만 남기고 그때까지 모은 결과를 반환한다(무한루프 없음)', async () => {
    (kisFetch as jest.Mock).mockImplementation(async () =>
      fakeResponse({ trCont: 'M', output: [{ odno: 'X', pdno: '005930', rmn_qty: '1' }], ctx_area_fk100: 'F', ctx_area_nk100: 'N' }));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await getActiveOrders();

    expect(kisFetch).toHaveBeenCalledTimes(20); // MAX_ACTIVE_ORDERS_PAGES
    expect(result).toHaveLength(20);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('페이지 상한'));
    warnSpy.mockRestore();
  });

  test('rmn_qty<=0 인 행은 여전히 걸러진다(다중 페이지에서도)', async () => {
    (kisFetch as jest.Mock)
      .mockResolvedValueOnce(fakeResponse({
        trCont: 'M',
        output: [{ odno: 'O1', pdno: '005930', rmn_qty: '0' }],
        ctx_area_fk100: 'FK2', ctx_area_nk100: 'NK2',
      }))
      .mockResolvedValueOnce(fakeResponse({
        trCont: 'D',
        output: [{ odno: 'O2', pdno: '000660', rmn_qty: '2' }],
      }));

    const result = await getActiveOrders();
    expect(result).toEqual([{ orderId: 'O2', symbol: '000660' }]);
  });

  test('rt_cd 가 0 이 아니면 페이지 도중이라도 던진다(침묵하지 않는다)', async () => {
    (kisFetch as jest.Mock)
      .mockResolvedValueOnce(fakeResponse({
        trCont: 'M', output: [{ odno: 'O1', pdno: '005930', rmn_qty: '1' }],
        ctx_area_fk100: 'FK2', ctx_area_nk100: 'NK2',
      }))
      .mockResolvedValueOnce(fakeResponse({ rt_cd: '9', output: [] }));

    await expect(getActiveOrders()).rejects.toThrow(/rt_cd=9/);
  });
});
