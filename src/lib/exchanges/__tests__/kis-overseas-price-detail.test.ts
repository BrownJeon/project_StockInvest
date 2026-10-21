/**
 * T-059 Part A — 해외주식 현재가상세(HHDFS76200200) 어댑터.
 *
 * 🔴 픽스처는 **실응답이 아니다.** KIS 공식 저장소 `chk_price_detail.py` COLUMN_MAPPING 의 필드명으로 만든 합성 본문이다
 * (값은 임의). 실응답 확인은 사용자 승인된 1회 읽기 전용 호출이 필요하다(PER 회계 기준·tomv 단위·손실 기업 표기 미확인).
 * KIS 호출은 하지 않는다 — kisFetch 를 대역으로 바꾼다.
 */
import { kisFetch } from '../kis-http';
import { invalidateKisToken } from '../kis-auth';
import { parsePriceDetail, getPriceDetail, PriceDetailUnavailableError } from '../kis-overseas';

jest.mock('../kis-auth', () => ({
  getKisToken: jest.fn(async () => 'tok'),
  invalidateKisToken: jest.fn(async () => undefined),
  kisBaseUrl: jest.fn(() => 'https://mock-base'),
}));
jest.mock('@/lib/credentials', () => ({ getCredential: jest.fn(async () => '') }));
jest.mock('../kis-http', () => ({
  kisFetch: jest.fn(),
  isKisRateLimited: jest.fn(() => false),
  kisBodyText: jest.fn(() => null),
}));
jest.mock('../fx', () => ({ getUsdKrwRate: jest.fn(async () => 1400) }));

const SYNTH = () => ({
  rt_cd: '0', msg_cd: 'MCA00000', msg1: '정상처리 되었습니다.',
  output: {
    rsym: 'DNASINTC', last: '36.1200', base: '35.8000', curr: 'USD', zdiv: '4',
    perx: '-12.34', pbrx: '1.5600', epsx: '-2.9300', bpsx: '23.1000',
    tomv: '157000000000', shar: '4361000000', mcap: '4361000',
    h52p: '42.5000', h52d: '20260801', l52p: '18.1000', l52d: '20251105',
    e_icod: '반도체', etyp_nm: '', t_rate: '1400.00',
  },
});

function res(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return { ok: init.ok ?? true, status: init.status ?? 200, headers: { get: () => null }, json: async () => body, text: async () => '' };
}

describe('parsePriceDetail — 필드 매핑 (chk_price_detail.py COLUMN_MAPPING)', () => {
  test('perx/pbrx/epsx/bpsx/tomv/shar/h52p/l52p → 원값 그대로, mcap(자본금)은 시가총액으로 쓰지 않는다', () => {
    const d = parsePriceDetail(SYNTH(), 'NAS:INTC');
    expect(d).toMatchObject({
      symbol: 'NAS:INTC', lastPrice: 36.12, per: -12.34, pbr: 1.56, eps: -2.93, bps: 23.1,
      marketCap: 157000000000, shares: 4361000000, high52: 42.5, low52: 18.1,
      high52Date: '2026-08-01', low52Date: '2025-11-05', currency: 'USD', sector: '반도체', etpType: null,
    });
    expect(d.marketCap).not.toBe(4361000);
    expect(d.raw.mcap).toBe('4361000');   // 원문은 감사용으로 보관
  });

  test('빈 문자열·키 없음은 null(모름) — 0 으로 바꾸지 않는다', () => {
    const b = SYNTH();
    b.output.perx = '';
    delete (b.output as Record<string, unknown>).pbrx;
    const d = parsePriceDetail(b, 'NAS:INTC');
    expect(d.per).toBeNull();
    expect(d.pbr).toBeNull();
    expect(d.eps).toBe(-2.93);
  });

  test('🔴 (R-2) PER·PBR 이 정확히 0("0.00"·"0"·"-0.00")이면 null — 0 을 측정값으로 저장하지 않는다, 원문은 raw 에 남는다', () => {
    for (const z of ['0.00', '0', '-0.00', '0.0000']) {
      const b = SYNTH();
      b.output.perx = z;
      b.output.pbrx = z;
      const d = parsePriceDetail(b, 'NAS:INTC');
      expect(d.per).toBeNull();
      expect(d.pbr).toBeNull();
      expect(d.raw.perx).toBe(z);
    }
  });

  test('(R-2) 음수 PER 은 그대로(손실 기업 표기 — 계산 결과라 위조 아님), EPS·BPS 의 0 은 실제 값일 수 있어 그대로', () => {
    const b = SYNTH();
    Object.assign(b.output, { perx: '-0.01', pbrx: '-3.2', epsx: '0.00', bpsx: '0' });
    const d = parsePriceDetail(b, 'NAS:INTC');
    expect(d).toMatchObject({ per: -0.01, pbr: -3.2, eps: 0, bps: 0 });
  });

  test('ETF 처럼 PER 등이 비어도 52주 고저가 있으면 행을 만든다', () => {
    const b = SYNTH();
    Object.assign(b.output, { perx: '', pbrx: '', epsx: '', bpsx: '', tomv: '', shar: '', etyp_nm: 'ETF' });
    const d = parsePriceDetail(b, 'NAS:SMH');
    expect(d).toMatchObject({ per: null, high52: 42.5, etpType: 'ETF' });
  });

  test.each([
    ['본문 없음', null],
    ['rt_cd≠0', { ...SYNTH(), rt_cd: '1', msg_cd: 'EGW00201' }],
    ['output 없음', { rt_cd: '0' }],
    ['output 배열 2개', { rt_cd: '0', output: [SYNTH().output, SYNTH().output] }],
    ['현재가 0', { rt_cd: '0', output: { ...SYNTH().output, last: '0' } }],
    ['현재가 빈 값', { rt_cd: '0', output: { ...SYNTH().output, last: '' } }],
    ['지표 숫자 형식 이상(형식 다름)', { rt_cd: '0', output: { ...SYNTH().output, perx: 'N/A' } }],
    ['지표 8개 전부 빈 값(빈 응답)', { rt_cd: '0', output: { last: '10', perx: '', pbrx: '', epsx: '', bpsx: '', tomv: '', shar: '', h52p: '', l52p: '' } }],
  ])('🔴 %s → 던진다(행을 쓰지 않음)', (_n, body) => {
    expect(() => parsePriceDetail(body, 'NAS:INTC')).toThrow(PriceDetailUnavailableError);
  });

  test('🔴 (C-3) 8자리여도 실제 달력 날짜가 아니면 null — 20261340·20260230·20250229·19000000', () => {
    for (const bad of ['20261340', '20260230', '20250229', '19000000', '20260100', '21010101', '18991231']) {
      const b = SYNTH();
      b.output.h52d = bad;
      expect(parsePriceDetail(b, 'NAS:INTC').high52Date).toBeNull();
    }
    const ok = SYNTH();
    ok.output.h52d = '20240229';   // 윤년
    expect(parsePriceDetail(ok, 'NAS:INTC').high52Date).toBe('2024-02-29');
  });

  test('날짜가 8자리가 아니거나 00000000 이면 null', () => {
    const b = SYNTH();
    b.output.h52d = '00000000';
    b.output.l52d = '2025-11-05';
    const d = parsePriceDetail(b, 'NAS:INTC');
    expect(d.high52Date).toBeNull();
    expect(d.low52Date).toBeNull();
  });
});

describe('getPriceDetail — GET·tr_id·파라미터·오류', () => {
  const kf = kisFetch as jest.Mock;
  beforeEach(() => { kf.mockReset(); (invalidateKisToken as jest.Mock).mockClear(); });

  test('GET /quotations/price-detail, tr_id HHDFS76200200, EXCD·SYMB 만(계좌 정보 없음), label 고정', async () => {
    kf.mockResolvedValueOnce(res(SYNTH()));
    const d = await getPriceDetail('NYS:ORCL');
    expect(d.per).toBe(-12.34);
    const [url, init, opts] = kf.mock.calls[0] as [string, RequestInit, { label: string; timeoutMs: number }];
    const u = new URL(url);
    expect(u.pathname).toBe('/uapi/overseas-price/v1/quotations/price-detail');
    expect(Object.fromEntries(u.searchParams)).toEqual({ AUTH: '', EXCD: 'NYS', SYMB: 'ORCL' });
    expect((init.headers as Record<string, string>).tr_id).toBe('HHDFS76200200');
    expect(init.method ?? 'GET').toBe('GET');
    expect(opts).toMatchObject({ label: 'overseas priceDetail', timeoutMs: 5000 });
  });

  test('HTTP 실패는 던진다(0 반환 없음)', async () => {
    kf.mockResolvedValueOnce(res({}, { ok: false, status: 500 }));
    await expect(getPriceDetail('NAS:INTC')).rejects.toBeInstanceOf(PriceDetailUnavailableError);
  });

  test('토큰 만료(EGW00123)는 1회 재발급 후 재시도', async () => {
    const { kisBodyText } = jest.requireMock('../kis-http') as { kisBodyText: jest.Mock };
    kisBodyText.mockReturnValueOnce('{"msg_cd":"EGW00123"}');
    kf.mockResolvedValueOnce(res({}, { ok: false, status: 500 })).mockResolvedValueOnce(res(SYNTH()));
    await expect(getPriceDetail('NAS:INTC')).resolves.toMatchObject({ lastPrice: 36.12 });
    expect(invalidateKisToken).toHaveBeenCalledTimes(1);
    expect(kf).toHaveBeenCalledTimes(2);
  });

  test('국내 심볼은 거부(해외 형식 아님)', async () => {
    await expect(getPriceDetail('005930')).rejects.toThrow();
    expect(kf).not.toHaveBeenCalled();
  });
});
