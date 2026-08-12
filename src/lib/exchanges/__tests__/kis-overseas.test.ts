import { kisFetch } from '../kis-http';
import { getActiveOrders } from '../kis-overseas';

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

  test('페이지 상한에서 경고 후 모은 결과만 반환한다', async () => {
    (kisFetch as jest.Mock).mockImplementation(async () => fakeResponse({
      trCont: 'M',
      output: [{ odno: 'X', pdno: 'aapl', nccs_qty: '1', ovrs_excg_cd: 'NASD' }],
      ctx_area_fk200: 'F', ctx_area_nk200: 'N',
    }));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await getActiveOrders();

    expect(kisFetch).toHaveBeenCalledTimes(20);
    expect(result).toHaveLength(20);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('페이지 상한'));
    warnSpy.mockRestore();
  });
});
