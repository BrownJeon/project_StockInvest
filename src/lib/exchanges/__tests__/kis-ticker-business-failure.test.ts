/**
 * T-133 — 시세 조회(`getTicker`)가 **HTTP 200 업무실패**를 성공으로 통과시키지 않는다 (어댑터 계약).
 *
 * ## 실측 배경 (2026-10-31, KIS 측 장애)
 *
 * 09:23~ KIS 가 `EGW00300 Gateway 라우팅 오류`(HTTP 500)와 `OPSQ1002 SESSION FULL`(**HTTP 200** +
 * `rt_cd:"9"`)을 산발적으로 돌려줬다. 두 어댑터의 손으로 만든 재시도 루프는 `res.status` 만 봤으므로
 * 뒤쪽은 `res.ok === true` 라 루프를 비껴갔고, `data.output` 이 없어 **본문 JSON 을 통째로 실은**
 * `no output` 메시지로 한 번에 던졌다. 호출부 `portfolio-total` 이 그 종목을 총액에서 제외해 하루
 * **11건**(그중 SESSION FULL 10건)의 원인 모를 과소평가가 생겼다.
 *
 * 재시도 쪽 검증은 [[kis-ticker-transient-recovery.test.ts]] 가 실제 `kisFetch` 로 맡는다.
 */
jest.mock('../kis-auth', () => ({
  getKisToken:        jest.fn(async () => 'tok'),
  invalidateKisToken: jest.fn(async () => {}),
  kisBaseUrl:         jest.fn(() => 'https://mock-base'),
}));

jest.mock('@/lib/credentials', () => ({
  getCredential: jest.fn(async (key: string) => (key === 'KIS_ACCOUNT_NO' ? '12345678' : '01')),
}));

jest.mock('../kis-http', () => ({
  kisFetch:         jest.fn(),
  isKisRateLimited: jest.fn(() => false),
  kisBodyText:      jest.fn(() => ''),
}));

jest.mock('../fx', () => ({ getUsdKrwRate: jest.fn(async () => FX) }));

import { kisFetch } from '../kis-http';
import { getTicker as domGetTicker } from '../kis-domestic';
import { getTicker as ovsGetTicker } from '../kis-overseas';

/** 기존 T-056·T-132 시험과 같은 실측 환율. 정수 곱이 아니라 반올림 변이도 잡힌다. */
const FX = 1332.1;

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
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('국내 시세 — HTTP 200 업무실패', () => {
  test('🔴 rt_cd≠0 이면 rt_cd·msg_cd·msg 를 담아 던진다 (예전: 본문 JSON 덩어리)', async () => {
    (kisFetch as jest.Mock).mockResolvedValue(ok200(SESSION_FULL));
    await expect(domGetTicker('005930')).rejects.toThrow(
      /KIS getTicker 005930: 200 업무실패 rt_cd=9 msg_cd=OPSQ1002 msg=SESSION FULL/);
  });

  test('rt_cd=0 이면 종전대로 파싱한다 (회귀)', async () => {
    (kisFetch as jest.Mock).mockResolvedValue(ok200({
      rt_cd: '0',
      output: { stck_prpr: '70000', stck_oprc: '69000', stck_hgpr: '71000', stck_lwpr: '68000',
                acml_vol: '1234', acml_tr_pbmn: '86380000' },
    }));
    await expect(domGetTicker('005930')).resolves.toMatchObject({
      symbol: '005930', price: 70000, open24h: 69000, high24h: 71000, low24h: 68000,
      volume24h: 1234, quoteVolume24h: 86380000,
    });
  });

  test('rt_cd 자체가 없는 응답은 종전 동작(파싱 진행) — 모양이 다른 TR 을 깨지 않는다', async () => {
    (kisFetch as jest.Mock).mockResolvedValue(ok200({ output: { stck_prpr: '1000' } }));
    await expect(domGetTicker('005930')).resolves.toMatchObject({ price: 1000 });
  });

  test('rt_cd=0 인데 output 이 없으면 종전 `no output` 으로 던진다 (회귀)', async () => {
    (kisFetch as jest.Mock).mockResolvedValue(ok200({ rt_cd: '0' }));
    await expect(domGetTicker('005930')).rejects.toThrow(/KIS getTicker no output/);
  });

  /**
   * 🔴 (T-133 QA #3) KIS 는 `rt_cd` 를 문자열로 주는 것으로 보이지만(근거는 T-132 관찰뿐),
   * 숫자로 오더라도 **정상을 실패로 바꾸지 않는다.** 종전 코드는 `rt_cd` 를 아예 보지 않아
   * 숫자 0 을 통과시켰으므로, 엄격 비교를 쓰면 그 자리에서 회귀가 된다.
   */
  test('🔴 숫자형 rt_cd 0 은 정상으로 본다 — 9 는 그대로 실패다', async () => {
    (kisFetch as jest.Mock).mockResolvedValue(ok200({ rt_cd: 0, output: { stck_prpr: '500' } }));
    await expect(domGetTicker('005930')).resolves.toMatchObject({ price: 500 });
    (kisFetch as jest.Mock).mockResolvedValue(ok200({ rt_cd: 9, msg_cd: 'OPSQ1002', msg1: 'SESSION FULL' }));
    await expect(domGetTicker('005930')).rejects.toThrow(/200 업무실패 rt_cd=9/);
  });
});

describe('해외 시세 — HTTP 200 업무실패', () => {
  test('🔴 rt_cd≠0 이면 rt_cd·msg_cd 를 담아 던진다', async () => {
    (kisFetch as jest.Mock).mockResolvedValue(ok200(SESSION_FULL));
    await expect(ovsGetTicker('NAS:AAPL')).rejects.toThrow(
      /KIS overseas getTicker NAS:AAPL: 200 업무실패 rt_cd=9 msg_cd=OPSQ1002/);
  });

  test('rt_cd=0 이면 종전대로 KRW 환산해 파싱한다 (회귀)', async () => {
    (kisFetch as jest.Mock).mockResolvedValue(ok200({
      rt_cd: '0',
      output: { last: '123.45', open: '120.5', high: '125.5', low: '119.5', tvol: '1000', tamt: '123450' },
    }));
    const t = await ovsGetTicker('NAS:AAPL');
    expect(t.priceUsd).toBeCloseTo(123.45, 6);
    expect(t.price).toBeCloseTo(123.45 * FX, 6);
    expect(t.open24h).toBeCloseTo(120.5 * FX, 6);
    expect(t.volume24h).toBe(1000);
  });

  test('rt_cd=0 인데 output 이 없으면 종전 `no output` 으로 던진다 (회귀)', async () => {
    (kisFetch as jest.Mock).mockResolvedValue(ok200({ rt_cd: '0' }));
    await expect(ovsGetTicker('NAS:AAPL')).rejects.toThrow(/KIS overseas getTicker no output/);
  });

  /** (T-133 Reviewer L-4·M10) `rt_cd != null` 가드를 지우는 변이를 잡는다 — 해외에는 이 회귀가 없었다. */
  test('rt_cd 자체가 없는 응답은 종전 동작(파싱 진행) — 모양이 다른 TR 을 깨지 않는다', async () => {
    (kisFetch as jest.Mock).mockResolvedValue(ok200({ output: { last: '10' } }));
    const t = await ovsGetTicker('NAS:AAPL');
    expect(t.priceUsd).toBe(10);
  });

  /** 🔴 (T-133 QA #3) 국내와 같은 정규화 — 숫자 0 은 정상, 숫자 9 는 실패. */
  test('🔴 숫자형 rt_cd 0 은 정상으로 본다 — 9 는 그대로 실패다', async () => {
    (kisFetch as jest.Mock).mockResolvedValue(ok200({ rt_cd: 0, output: { last: '7' } }));
    await expect(ovsGetTicker('NAS:AAPL')).resolves.toMatchObject({ priceUsd: 7 });
    (kisFetch as jest.Mock).mockResolvedValue(ok200({ rt_cd: 9, msg_cd: 'OPSQ1002' }));
    await expect(ovsGetTicker('NAS:AAPL')).rejects.toThrow(/200 업무실패 rt_cd=9/);
  });
});

/**
 * 🔴 게이트웨이에 넘기는 **예산·타임아웃 계약**을 고정한다 (T-133 Reviewer L-4·M9).
 *
 * 변이 시험에서 해외 `timeoutMs` 를 지워도 살아남았다 — 타임아웃은 "스로틀 대기가 타임아웃을
 * 잡아먹지 않게" 하려고 T-017 이 일부러 게이트웨이로 옮긴 값이라, 조용히 사라지면 안 된다.
 */
describe('kisFetch 에 넘기는 옵션 계약', () => {
  function optsOf(call: number) {
    return (kisFetch as jest.Mock).mock.calls[call][2] as Record<string, unknown>;
  }

  test('국내 시세: label·transientRetries 2 (timeoutMs 는 쓰지 않는다 — 종전과 같다)', async () => {
    (kisFetch as jest.Mock).mockResolvedValue(ok200({ rt_cd: '0', output: { stck_prpr: '1' } }));
    await domGetTicker('005930');
    expect(optsOf(0)).toMatchObject({ label: 'domestic getTicker', transientRetries: 2 });
    expect(optsOf(0).timeoutMs).toBeUndefined();
  });

  test('해외 시세: timeoutMs 5000 · label · transientRetries 2', async () => {
    (kisFetch as jest.Mock).mockResolvedValue(ok200({ rt_cd: '0', output: { last: '1' } }));
    await ovsGetTicker('NAS:AAPL');
    expect(optsOf(0)).toMatchObject({
      timeoutMs: 5_000, label: 'overseas getTicker', transientRetries: 2,
    });
  });
});
