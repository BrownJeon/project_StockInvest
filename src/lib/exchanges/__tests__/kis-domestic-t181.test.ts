/**
 * T-181 — 국내 어댑터의 두 가지 변경을 고정한다.
 *
 * ① `getTicker` 가 시세 응답의 `hts_avls`(시가총액, 억원)·`rprs_mrkt_kor_name`(대표 시장명)을 `marketCapKrw`·`indexTag` 로 옮긴다.
 *    값이 비정상이면 키를 싣지 않고, 기존 필드 계산은 그대로다.
 * ⑤ 시총 순위 조회의 요청 쿼리가 KIS 공식 예제·2026-11-20 운영 실측에서 성공한 형태(키 9개·소문자)와 **정확히** 같고,
 *    예전 거부 원인이던 `FID_BLNG_CLS_CODE`·`Q` 시장 구분·대문자 키가 없다.
 *
 * 배경: 운영 로그 11-20 — 코스피 `OPSQ2001 ERROR INPUT FIELD NOT FOUND [FID_INPUT_PRICE_1]`,
 * 코스닥 `OPSQ2001 ERROR INVALID FID_COND_MRKT_DIV_CODE`. 순위 조회 성공 기록 0건.
 */
jest.mock('../kis-auth', () => ({
  getKisToken:        jest.fn(async () => 'tok'),
  invalidateKisToken: jest.fn(async () => {}),
  kisBaseUrl:         jest.fn(() => 'https://mock-base'),
}));

jest.mock('@/lib/credentials', () => ({
  getCredential: jest.fn(async (key: string) => (key === 'KIS_ACCOUNT_NO' ? '12345678' : 'x')),
}));

jest.mock('../kis-http', () => ({
  kisFetch:         jest.fn(),
  isKisRateLimited: jest.fn(() => false),
  kisBodyText:      jest.fn(() => null),
}));

import { kisFetch } from '../kis-http';
import {
  getTicker, fetchMarketCapRanking, buildMarketCapQuery, parseMarketCapKrw, parseIndexTag,
  __resetMarketCapDiagForTest,
} from '../kis-domestic';

function ok200(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** 2026-11-20 실측 005930 시세에서 이번 변경과 관련된 필드만 남긴 모양(가격 등은 시험용 값) */
function priceOutput(extra: Record<string, unknown>) {
  return {
    rt_cd: '0', msg_cd: 'MCA00000', msg1: '정상처리 되었습니다.',
    output: {
      stck_prpr: '70000', stck_oprc: '69000', stck_hgpr: '71000', stck_lwpr: '68000',
      acml_vol: '1000', acml_tr_pbmn: '70000000',
      ...extra,
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetMarketCapDiagForTest();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('① getTicker — 시가총액·대표 시장명 매핑', () => {
  test('실측 모양: hts_avls 10575918(억원) → 1,057,591,800,000,000원, rprs_mrkt_kor_name KOSPI200 → indexTag', async () => {
    (kisFetch as jest.Mock).mockResolvedValue(ok200(priceOutput({ hts_avls: '10575918', rprs_mrkt_kor_name: 'KOSPI200' })));
    const t = await getTicker('005930');
    expect(t.marketCapKrw).toBe(1_057_591_800_000_000);
    expect(t.indexTag).toBe('KOSPI200');
    // 기존 필드 계산은 그대로
    expect(t).toMatchObject({
      symbol: '005930', price: 70000, open24h: 69000, high24h: 71000, low24h: 68000,
      volume24h: 1000, quoteVolume24h: 70000000,
    });
  });

  test('대표 시장명은 앞뒤 공백만 지우고 원문 그대로 옮긴다(등급 해석은 universe 몫)', async () => {
    (kisFetch as jest.Mock).mockResolvedValue(ok200(priceOutput({ hts_avls: '4906', rprs_mrkt_kor_name: '  KSQ150 ' })));
    const t = await getTicker('112040');
    expect(t.indexTag).toBe('KSQ150');
    expect(t.marketCapKrw).toBe(490_600_000_000);
  });

  test.each([
    ['빈 문자열', ''],
    ['공백', '   '],
    ['0', '0'],
    ['음수', '-1'],
    ['문자', 'abc'],
    ['무한', 'Infinity'],
    ['null', null],
  ])('hts_avls 가 %s 이면 marketCapKrw 키가 없다 — 다른 필드는 그대로', async (_n, raw) => {
    (kisFetch as jest.Mock).mockResolvedValue(ok200(priceOutput({ hts_avls: raw, rprs_mrkt_kor_name: 'KOSPI' })));
    const t = await getTicker('005930');
    expect('marketCapKrw' in t).toBe(false);
    expect(t.indexTag).toBe('KOSPI');
    expect(t.price).toBe(70000);
    expect(t.quoteVolume24h).toBe(70000000);
  });

  test('두 필드가 아예 없으면 두 키 모두 없다(예전 반환 모양 그대로)', async () => {
    (kisFetch as jest.Mock).mockResolvedValue(ok200(priceOutput({})));
    const t = await getTicker('005930');
    expect(Object.keys(t).sort()).toEqual(
      ['high24h', 'low24h', 'open24h', 'price', 'quoteVolume24h', 'symbol', 'timestamp', 'volume24h'],
    );
  });

  test.each([
    ['빈 문자열', ''],
    ['공백', '  \t '],
    ['숫자', 5],
    ['null', null],
  ])('rprs_mrkt_kor_name 이 %s 이면 indexTag 키가 없다', async (_n, raw) => {
    (kisFetch as jest.Mock).mockResolvedValue(ok200(priceOutput({ hts_avls: '100', rprs_mrkt_kor_name: raw })));
    const t = await getTicker('005930');
    expect('indexTag' in t).toBe(false);
    expect(t.marketCapKrw).toBe(100 * 1e8);
  });

  test('파서 단위: 숫자형도 받는다, 객체·불리언은 undefined', () => {
    expect(parseMarketCapKrw(35090)).toBe(35090 * 1e8);
    expect(parseMarketCapKrw({})).toBeUndefined();
    expect(parseMarketCapKrw(true)).toBeUndefined();
    expect(parseMarketCapKrw(undefined)).toBeUndefined();
    expect(parseIndexTag({ toString: () => 'KOSPI200' })).toBeUndefined();
    expect(parseIndexTag(undefined)).toBeUndefined();
  });
});

describe('⑤ 시총 순위 요청 쿼리', () => {
  const EXPECTED = (iscd: string) =>
    `fid_input_price_2=&fid_cond_mrkt_div_code=J&fid_cond_scr_div_code=20174&fid_div_cls_code=0`
    + `&fid_input_iscd=${iscd}&fid_trgt_cls_code=0&fid_trgt_exls_cls_code=0&fid_input_price_1=&fid_vol_cnt=`;

  test('buildMarketCapQuery — 키 9개·값·순서가 정확히 같다', () => {
    expect(buildMarketCapQuery('0001').toString()).toBe(EXPECTED('0001'));
    expect(buildMarketCapQuery('1001').toString()).toBe(EXPECTED('1001'));
    expect([...buildMarketCapQuery('0001').keys()]).toHaveLength(9);
  });

  test('🔴 실제로 나가는 두 요청: 코스피 0001·코스닥 1001, 둘 다 J, FID_BLNG_CLS_CODE 없음, 대문자 키 없음', async () => {
    (kisFetch as jest.Mock).mockResolvedValue(ok200({ rt_cd: '0', msg_cd: 'MCA00000', msg1: '정상', output: [] }));
    await fetchMarketCapRanking(200);
    const calls = (kisFetch as jest.Mock).mock.calls;
    expect(calls).toHaveLength(2);
    const urls = calls.map((c) => new URL(String(c[0])));
    for (const u of urls) {
      expect(u.origin + u.pathname).toBe('https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/ranking/market-cap');
      expect(u.search.toLowerCase()).not.toContain('blng');
      expect(u.search).not.toMatch(/[A-Z]{3,}_/);                  // FID_… 같은 대문자 키가 없다
      expect(u.searchParams.get('fid_cond_mrkt_div_code')).toBe('J');
    }
    expect(urls.map((u) => u.search.slice(1)).sort()).toEqual([EXPECTED('0001'), EXPECTED('1001')]);
    // tr_id 는 그대로
    for (const c of calls) expect((c[1] as { headers: Record<string, string> }).headers.tr_id).toBe('FHPST01740000');
  });

  // 우선주 필터(`isExcluded` 의 `symbol[4] === '5'`)는 이번에 손대지 않았고 여기서 고정하지 않는다 — 6자리 코드의 끝자리(색인 5)가
  // 아니라 색인 4 를 봐서 005935(삼성전자우)를 거르지 못한다(T-181 Developer 가 발견, 운영 호출부가 없어 후속 후보로 남김).
  test('합친 결과는 시총 내림차순, 거래량 0 은 거른다(종전 필터 유지)', async () => {
    (kisFetch as jest.Mock).mockImplementation(async (url: string) => ok200({
      rt_cd: '0', msg_cd: 'MCA00000', msg1: '정상',
      output: url.includes('fid_input_iscd=0001')
        ? [
          { mksc_shrn_iscd: '000660', hts_kor_isnm: 'SK하이닉스', stck_avls: '900000', acml_vol: '10' },
          { mksc_shrn_iscd: '005930', hts_kor_isnm: '삼성전자', stck_avls: '10575918', acml_vol: '10' },
        ]
        : [
          { mksc_shrn_iscd: '196170', hts_kor_isnm: '알테오젠', stck_avls: '120921', acml_vol: '3' },
          { mksc_shrn_iscd: '999990', hts_kor_isnm: '거래없음', stck_avls: '500000', acml_vol: '0' },
        ],
    }));
    const rows = await fetchMarketCapRanking(10);
    expect(rows.map((r) => r.symbol)).toEqual(['005930', '000660', '196170']);
    for (const r of rows) expect(Number.isFinite(r.marketCap)).toBe(true);
  });
});
