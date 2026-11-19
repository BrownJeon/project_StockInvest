/**
 * T-176 WP-3 — 시총 순위 조회가 `[]` 로 끝날 때 **이유를 한 줄** 남기고(억제 포함), 반환값은 그대로다.
 *
 * 배경: 운영 로그(10-25~11-18)상 이 API 는 매 호출 HTTP 200 + `rt_cd≠0` 이었고 성공 0회였다. 응답 메시지를
 * 기록하지 않아 원인을 몰랐다. 이 시험은 ① 남기는 값(시장·HTTP·rt_cd·msg_cd·msg1) ② 반복 억제 ③ 비밀·본문 미포함
 * ④ 반환값 불변(`[]`)·정상 응답 무로그를 고정한다.
 */
jest.mock('../kis-auth', () => ({
  getKisToken:        jest.fn(async () => 'TOKEN-SECRET-abc123'),
  invalidateKisToken: jest.fn(async () => {}),
  kisBaseUrl:         jest.fn(() => 'https://mock-base'),
}));

jest.mock('@/lib/credentials', () => ({
  getCredential: jest.fn(async (key: string) => {
    if (key === 'KIS_APP_KEY')    return 'APPKEY-SECRET-xyz789';
    if (key === 'KIS_APP_SECRET') return 'APPSECRET-SECRET-qwe456';
    return '';
  }),
}));

jest.mock('../kis-http', () => ({
  kisFetch:         jest.fn(),
  isKisRateLimited: jest.fn(() => false),
  kisBodyText:      jest.fn(() => null),
}));

import { kisFetch } from '../kis-http';
import { fetchMarketCapRanking, __resetMarketCapDiagForTest } from '../kis-domestic';

const SECRETS = ['TOKEN-SECRET-abc123', 'APPKEY-SECRET-xyz789', 'APPSECRET-SECRET-qwe456', 'Bearer'];

function res(status: number, body: unknown) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => JSON.parse(text),
    text: async () => text,
  };
}

/** 운영에서 본 모양(HTTP 200 + rt_cd≠0) — 문구는 시험용 예시다 */
const BIZ_FAIL = { rt_cd: '1', msg_cd: 'OPSQ0002', msg1: '입력 필드값이 잘못되었습니다', output: [] };

let warn: jest.SpyInstance;
let now = 1_800_000_000_000;

beforeEach(() => {
  jest.clearAllMocks();
  __resetMarketCapDiagForTest();
  now = 1_800_000_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const lines = () => warn.mock.calls.map((c) => c.map(String).join(' '));

describe('rt_cd≠0 (HTTP 200 업무 실패)', () => {
  test('반환값은 [] 그대로, 시장별로 rt_cd·msg_cd·msg1 한 줄씩', async () => {
    (kisFetch as jest.Mock).mockImplementation(async () => res(200, BIZ_FAIL));
    await expect(fetchMarketCapRanking(200)).resolves.toEqual([]);
    const l = lines();
    expect(l).toHaveLength(2);
    expect(l.find((x) => x.includes('market=J(코스피)'))).toContain(
      'why=rt_cd http=200 rt_cd=1 msg_cd=OPSQ0002 msg1=입력 필드값이 잘못되었습니다',
    );
    expect(l.find((x) => x.includes('market=Q(코스닥)'))).toContain('rt_cd=1 msg_cd=OPSQ0002');
  });

  test('같은 조합은 1시간 안에 다시 찍지 않고, 창이 지나면 생략 건수를 붙여 1줄', async () => {
    (kisFetch as jest.Mock).mockImplementation(async () => res(200, BIZ_FAIL));
    await fetchMarketCapRanking(200);
    await fetchMarketCapRanking(200);
    await fetchMarketCapRanking(200);
    expect(lines()).toHaveLength(2);           // 첫 회 J·Q 만

    now += 60 * 60 * 1000 + 1;
    await fetchMarketCapRanking(200);
    const l = lines();
    expect(l).toHaveLength(4);
    expect(l[2]).toContain('(이전 2건 생략)');
    expect(l[3]).toContain('(이전 2건 생략)');
  });

  test('msg_cd 가 다르면 다른 조합이라 억제하지 않는다', async () => {
    (kisFetch as jest.Mock).mockImplementation(async () => res(200, BIZ_FAIL));
    await fetchMarketCapRanking(200);
    (kisFetch as jest.Mock).mockImplementation(async () => res(200, { ...BIZ_FAIL, msg_cd: 'EGW00123' }));
    await fetchMarketCapRanking(200);
    expect(lines()).toHaveLength(4);
  });

  test('비밀(토큰·앱키·시크릿)·헤더·본문의 다른 필드는 남기지 않는다, 제어문자 제거·길이 제한', async () => {
    (kisFetch as jest.Mock).mockImplementation(async () => res(200, {
      rt_cd: '7', msg_cd: 'X\nY', msg1: `줄바꿈\r\n주입 ${'가'.repeat(300)}`, output: [], extra_field: 'BODY-ONLY-VALUE',
    }));
    await fetchMarketCapRanking(200);
    const l = lines();
    expect(l).toHaveLength(2);
    for (const x of l) {
      for (const s of SECRETS) expect(x).not.toContain(s);
      expect(x).not.toContain('BODY-ONLY-VALUE');
      expect(x).not.toContain('https://');
      expect(x).not.toMatch(/[\r\n]/);
      expect(x).toContain('msg_cd=X Y');
      expect(x.length).toBeLessThan(260);
    }
  });
});

describe('HTTP 오류(!res.ok)', () => {
  test('본문에서 rt_cd·msg_cd·msg1 만 꺼내 남기고 [] 를 돌려준다', async () => {
    (kisFetch as jest.Mock).mockImplementation(async () => res(500, {
      rt_cd: '1', msg_cd: 'EGW00201', msg1: '초당 거래건수를 초과하였습니다.', secret_echo: 'BODY-ONLY-VALUE',
    }));
    await expect(fetchMarketCapRanking(200)).resolves.toEqual([]);
    const l = lines();
    expect(l).toHaveLength(2);
    expect(l[0]).toContain('why=http http=500 rt_cd=1 msg_cd=EGW00201 msg1=초당 거래건수를 초과하였습니다.');
    for (const x of l) expect(x).not.toContain('BODY-ONLY-VALUE');
  });

  test('본문이 JSON 이 아니면 필드는 - 로 남긴다(본문 원문을 찍지 않는다)', async () => {
    (kisFetch as jest.Mock).mockImplementation(async () => res(502, '<html>Bad Gateway BODY-ONLY-VALUE</html>'));
    await expect(fetchMarketCapRanking(200)).resolves.toEqual([]);
    const l = lines();
    expect(l[0]).toContain('why=http http=502 rt_cd=- msg_cd=- msg1=-');
    for (const x of l) expect(x).not.toContain('BODY-ONLY-VALUE');
  });
});

describe('정상 응답 — 동작 불변', () => {
  test('rt_cd=0 이면 로그 없이 파싱한다', async () => {
    (kisFetch as jest.Mock).mockImplementation(async (url: string) => res(200, {
      rt_cd: '0', msg_cd: 'MCA00000', msg1: '정상처리 되었습니다.',
      output: url.includes('FID_COND_MRKT_DIV_CODE=J')
        ? [{ mksc_shrn_iscd: '005930', hts_kor_isnm: '삼성전자', stck_avls: '4000000', acml_tr_pbmn: '900', acml_vol: '10' }]
        : [{ mksc_shrn_iscd: '247540', hts_kor_isnm: '에코프로비엠', stck_avls: '200000', acml_tr_pbmn: '100', acml_vol: '5' }],
    }));
    await expect(fetchMarketCapRanking(200)).resolves.toEqual([
      { symbol: '005930', name: '삼성전자', marketCap: 4_000_000 * 1e8, quoteVolume: 900, volume: 10 },
      { symbol: '247540', name: '에코프로비엠', marketCap: 200_000 * 1e8, quoteVolume: 100, volume: 5 },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  test('rt_cd=0 인데 output 이 배열이 아니면 [] + why=output 한 줄', async () => {
    (kisFetch as jest.Mock).mockImplementation(async () => res(200, { rt_cd: '0', msg_cd: 'MCA00000', msg1: '정상', output: null }));
    await expect(fetchMarketCapRanking(200)).resolves.toEqual([]);
    expect(lines()[0]).toContain('why=output http=200 rt_cd=0 msg_cd=MCA00000');
  });

  test('네트워크 예외는 종전처럼 던진다(잡는 곳은 universe 갱신 — WP-1)', async () => {
    (kisFetch as jest.Mock).mockRejectedValue(new TypeError('fetch failed'));
    await expect(fetchMarketCapRanking(200)).rejects.toThrow('fetch failed');
    expect(warn).not.toHaveBeenCalled();
  });
});
