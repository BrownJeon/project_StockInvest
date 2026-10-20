/**
 * T-056 — 해외 USD 예수금 어댑터 (CTRP6504R).
 *
 * 핵심 계약: **실패를 0 으로 바꾸는 지점이 어디에도 없다.** 0 은 "USD 행 없음 + output3 항등식이 0 을 확인"할 때만 나온다.
 * 예전 경로(TTTS3012R 에 없는 필드 → 0, TTTS3007R `APBN0746` 실패 → 0, 호출부 `.catch(() => 0)`)는 스냅샷 4,667행에
 * USD 행을 한 번도 남기지 못했다.
 *
 * 픽스처: 2026-10-20 08:24 KST 실측 응답의 익명화 사본(`fixtures/ctrp6504r-closed-20261020.json`).
 */
import fixture from './fixtures/ctrp6504r-closed-20261020.json';
import { kisFetch } from '../kis-http';
import { invalidateKisToken } from '../kis-auth';
import {
  parseUsdCashFromPresentBalance, getUsdCash, getBalances, UsdCashUnavailableError,
  USD_CASH_RECONCILE_TOLERANCE_KRW,
} from '../kis-overseas';

jest.mock('../kis-auth', () => ({
  getKisToken: jest.fn(async () => 'tok'),
  invalidateKisToken: jest.fn(async () => undefined),
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
  kisBodyText: jest.fn(() => null),
}));
jest.mock('../fx', () => ({ getUsdKrwRate: jest.fn(async () => 1332.1) }));

type Body = Record<string, unknown>;
const clone = (): Body => JSON.parse(JSON.stringify(fixture)) as Body;
const o2 = (b: Body) => (b.output2 as Record<string, string>[]);
const o3 = (b: Body) => (b.output3 as Record<string, string>);

/** 잔액 0 인 날의 모양 — KIS 가 0 통화 행을 생략하고 output3 이 0 을 확인한다고 가정(설계 Q9 2번 분기, 미관측). */
function zeroBalanceOmitted(): Body {
  const b = clone();
  b.output2 = [];
  o3(b).frcr_evlu_tota = '0';
  o3(b).tot_asst_amt = String(Number(o3(b).evlu_amt_smtl_amt) + Number(o3(b).tot_dncl_amt));
  return b;
}

function res(body: unknown, init: { ok?: boolean; status?: number; text?: string } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: { get: () => null },
    json: async () => body,
    text: async () => init.text ?? '',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.KIS_MOCK = 'false';
});

describe('parseUsdCashFromPresentBalance — 판정 규칙 3분기 (±1원)', () => {
  test('🔴 실측 픽스처 그대로 → known 368.51 USD (분기 1: USD 행 + 정합 두 개)', () => {
    expect(parseUsdCashFromPresentBalance(fixture)).toEqual({ usd: 368.51, ustlSllAmtSmtl: 0 });
  });

  test('실측 픽스처는 ±1원 허용치 안에서만 통과한다 (368.51 × 1332.10 = 490,892.17 vs 490,892)', () => {
    expect(USD_CASH_RECONCILE_TOLERANCE_KRW).toBe(1);
    const diff = Math.abs(490_892 - 368.51 * 1332.1);
    expect(diff).toBeGreaterThan(0);          // 정확 일치를 요구하면 실측이 깨진다
    expect(diff).toBeLessThanOrEqual(1);
  });

  test('USD 잔액 0 인 행(정합 0=0×환율) → known 0', () => {
    const b = clone();
    o2(b)[0].frcr_dncl_amt_2 = '0.000000';
    o2(b)[0].frcr_evlu_amt2 = '0.000000';
    o3(b).frcr_evlu_tota = '0';
    expect(parseUsdCashFromPresentBalance(b).usd).toBe(0);
  });

  test('분기 2: USD 행 없음 + output3 항등식이 0 → known 0 (데드락 없음)', () => {
    expect(parseUsdCashFromPresentBalance(zeroBalanceOmitted())).toEqual({ usd: 0, ustlSllAmtSmtl: 0 });
  });

  test('분기 2: output2 가 아예 없어도(null) 항등식이 0 이면 known 0', () => {
    const b = zeroBalanceOmitted();
    delete b.output2;
    expect(parseUsdCashFromPresentBalance(b).usd).toBe(0);
  });

  test('output2 가 배열이 아니라 객체 한 개로 와도 같은 행으로 읽는다', () => {
    const b = clone();
    b.output2 = o2(b)[0];
    expect(parseUsdCashFromPresentBalance(b).usd).toBe(368.51);
  });

  test('ustl_sll_amt_smtl > 0 이면 원값을 따로 돌려준다(총액 미반영 — 호출부가 기록만)', () => {
    const b = clone();
    o3(b).ustl_sll_amt_smtl = '1234567';
    expect(parseUsdCashFromPresentBalance(b)).toEqual({ usd: 368.51, ustlSllAmtSmtl: 1_234_567 });
  });

  // ── 분기 3: 그 밖 전부 → 던진다 (0 을 돌려주지 않는다) ──
  const throwsCases: [string, () => unknown][] = [
    ['rt_cd≠0 (APBN0746 같은 오류 응답)', () => ({ rt_cd: '7', msg_cd: 'APBN0746', msg1: '상품이 없습니다' })],
    ['rt_cd 없음', () => { const b = clone(); delete b.rt_cd; return b; }],
    ['본문이 객체가 아님', () => 'garbage'],
    ['output3 없음', () => { const b = clone(); delete b.output3; return b; }],
    ['USD 행 2개', () => { const b = clone(); b.output2 = [o2(b)[0], { ...o2(b)[0] }]; return b; }],
    ['frcr_dncl_amt_2 빈 문자열', () => { const b = clone(); o2(b)[0].frcr_dncl_amt_2 = ''; return b; }],
    ['frcr_dncl_amt_2 NaN 문자열', () => { const b = clone(); o2(b)[0].frcr_dncl_amt_2 = 'NaN'; return b; }],
    ['frcr_dncl_amt_2 Infinity', () => { const b = clone(); (o2(b)[0] as Record<string, unknown>).frcr_dncl_amt_2 = Infinity; return b; }],
    ['frcr_dncl_amt_2 음수', () => {
      const b = clone(); o2(b)[0].frcr_dncl_amt_2 = '-1.0'; o2(b)[0].frcr_evlu_amt2 = '-1332.1'; o3(b).frcr_evlu_tota = '-1332.1'; return b;
    }],
    ['frcr_dncl_amt_2 지수 표기(1e3)', () => { const b = clone(); o2(b)[0].frcr_dncl_amt_2 = '1e3'; return b; }],
    ['USD 행 정합 불일치 (+2원)', () => { const b = clone(); o2(b)[0].frcr_evlu_amt2 = '490894.000000'; o3(b).frcr_evlu_tota = '490894'; return b; }],
    ['USD 행 정합 불일치 (1.5원 — 허용치 초과)', () => { const b = clone(); o2(b)[0].frcr_evlu_amt2 = '490893.671'; o3(b).frcr_evlu_tota = '490893.671'; return b; }],
    ['환율 없음', () => { const b = clone(); delete o2(b)[0].frst_bltn_exrt; return b; }],
    ['output3.frcr_evlu_tota ≠ Σ output2 (잘린 응답)', () => { const b = clone(); o3(b).frcr_evlu_tota = '0'; return b; }],
    ['output3.frcr_evlu_tota 비숫자', () => { const b = clone(); o3(b).frcr_evlu_tota = ''; return b; }],
    ['USD 행 없음 + frcr_evlu_tota ≠ 0 (USD 행만 빠진 잘린 응답)', () => { const b = clone(); b.output2 = []; return b; }],
    ['USD 행 없음 + frcr_evlu_tota 0 이지만 tot_asst 항등식 불일치', () => {
      const b = zeroBalanceOmitted(); o3(b).tot_asst_amt = String(Number(o3(b).tot_asst_amt) + 490_892); return b;
    }],
    ['USD 행 없음 + tot_asst_amt 없음', () => { const b = zeroBalanceOmitted(); delete o3(b).tot_asst_amt; return b; }],
    ['USD 행 없음 + 다른 통화 행만 있음(값 있음)', () => {
      const b = zeroBalanceOmitted(); b.output2 = [{ ...o2(clone())[0], crcy_cd: 'JPY' }]; return b;
    }],
    ['output2 형식 이상(문자열)', () => { const b = clone(); b.output2 = 'x'; return b; }],
  ];
  test.each(throwsCases)('🔴 %s → UsdCashUnavailableError (0 아님)', (_name, make) => {
    expect(() => parseUsdCashFromPresentBalance(make())).toThrow(UsdCashUnavailableError);
  });
});

describe('getUsdCash — CTRP6504R 호출과 실패 전파', () => {
  test('요청: CTRP6504R + 설계 파라미터, 결과는 known USD', async () => {
    (kisFetch as jest.Mock).mockResolvedValueOnce(res(fixture));
    await expect(getUsdCash()).resolves.toEqual({ usd: 368.51, source: 'CTRP6504R', ustlSllAmtSmtl: 0 });
    const [url, init] = (kisFetch as jest.Mock).mock.calls[0];
    expect(String(url)).toContain('/uapi/overseas-stock/v1/trading/inquire-present-balance?');
    for (const kv of ['WCRC_FRCR_DVSN_CD=02', 'NATN_CD=840', 'TR_MKET_CD=00', 'INQR_DVSN_CD=00', 'CANO=12345678', 'ACNT_PRDT_CD=01']) {
      expect(String(url)).toContain(kv);
    }
    expect(init.headers.tr_id).toBe('CTRP6504R');
    expect(init.method).toBeUndefined();        // GET
  });

  test('모의 환경이면 VTRP6504R', async () => {
    process.env.KIS_MOCK = 'true';
    (kisFetch as jest.Mock).mockResolvedValueOnce(res(fixture));
    await getUsdCash();
    expect((kisFetch as jest.Mock).mock.calls[0][1].headers.tr_id).toBe('VTRP6504R');
  });

  test('🔴 HTTP 500 → 던진다 (예전: !res.ok → 0)', async () => {
    (kisFetch as jest.Mock).mockResolvedValueOnce(res({}, { ok: false, status: 500, text: '{"msg_cd":"EGW00201"}' }));
    await expect(getUsdCash()).rejects.toThrow(UsdCashUnavailableError);
  });

  test('🔴 rt_cd≠0 → 던진다 (예전: rt_cd!==0 → 0)', async () => {
    (kisFetch as jest.Mock).mockResolvedValueOnce(res({ rt_cd: '7', msg_cd: 'APBN0746', msg1: '상품이 없습니다' }));
    await expect(getUsdCash()).rejects.toThrow(/rt_cd=7/);
  });

  test('네트워크 예외는 그대로 던진다', async () => {
    (kisFetch as jest.Mock).mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(getUsdCash()).rejects.toThrow('ECONNRESET');
  });

  test('토큰 만료(EGW00123)는 1회 재발급 후 재시도한다', async () => {
    (kisFetch as jest.Mock)
      .mockResolvedValueOnce(res({}, { ok: false, status: 500, text: '{"msg_cd":"EGW00123"}' }))
      .mockResolvedValueOnce(res(fixture));
    await expect(getUsdCash()).resolves.toMatchObject({ usd: 368.51 });
    expect(invalidateKisToken).toHaveBeenCalledTimes(1);
    expect(kisFetch).toHaveBeenCalledTimes(2);
  });

  test('토큰 만료가 두 번이면 던진다(무한 재시도 없음)', async () => {
    (kisFetch as jest.Mock).mockResolvedValue(res({}, { ok: false, status: 500, text: 'EGW00123' }));
    await expect(getUsdCash()).rejects.toThrow(UsdCashUnavailableError);
    expect(kisFetch).toHaveBeenCalledTimes(2);
  });
});

describe('getBalances(해외) — 보유만 돌려주고 USD 행·TTTS3007R 폴백이 없다', () => {
  const ttts3012r = {
    rt_cd: '0', msg_cd: 'KIOK0510', msg1: '조회가 완료되었습니다',
    output1: [
      { ovrs_pdno: 'stk1', ovrs_cblc_qty: '11', pchs_avg_pric: '1067.49', ovrs_excg_cd: 'NASD' },
      { ovrs_pdno: 'stk3', ovrs_cblc_qty: '6', pchs_avg_pric: '173.17', ovrs_excg_cd: 'NYSE' },
    ],
    // 실측: TTTS3012R output2 에는 예수금 필드(frcr_dncl_amt1·frcr_dncl_amt·dnca_tot_amt)가 없다
    output2: { frcr_pchs_amt1: '15145.17', tot_evlu_pfls_amt: '12925.28' },
  };

  test('🔴 USD 행을 만들지 않고, 매수가능금액(TTTS3007R)을 부르지 않는다 — KIS 호출 1회', async () => {
    (kisFetch as jest.Mock).mockResolvedValueOnce(res(ttts3012r));
    const out = await getBalances();
    expect(out.map(b => b.currency)).toEqual(['NAS:STK1', 'NYS:STK3']);
    expect(out.some(b => b.currency === 'USD')).toBe(false);
    expect(kisFetch).toHaveBeenCalledTimes(1);
    const urls = (kisFetch as jest.Mock).mock.calls.map(c => String(c[0]));
    expect(urls.some(u => u.includes('inquire-psamount'))).toBe(false);
  });

  test('예전 필드가 output2 에 있어도(가상) USD 행이 생기지 않는다 — 예수금의 유일한 통로는 getUsdCash', async () => {
    (kisFetch as jest.Mock).mockResolvedValueOnce(res({ ...ttts3012r, output2: { frcr_dncl_amt1: '999.00' } }));
    const out = await getBalances();
    expect(out.some(b => b.currency === 'USD')).toBe(false);
  });
});

/**
 * 라운드 2 (Reviewer R-2, 조건 C-3) — 판정 규칙의 각 층을 **직접** 고정한다.
 * 라운드 1 시험은 항등식 여러 개가 서로를 가려 줘서, 한 층을 지워도(변이 M08·M04·M44) 다른 층이 같은 입력을 막아 살아남았다.
 * 아래 입력은 "그 층 하나만 남아 있어야 던지는" 모양으로 만든다.
 */
describe('라운드 2 — 판정 규칙 각 층 직접 고정', () => {
  /** 숫자 문자열 필드만 골라 `''` 로 바꾼다(통화 코드·이름 같은 비숫자 필드는 그대로) */
  const blankNumeric = (o: Record<string, unknown>) => {
    for (const k of Object.keys(o)) if (typeof o[k] === 'string' && /^-?\d+(\.\d+)?$/.test((o[k] as string).trim())) o[k] = '';
  };

  test('🔴 [M08] 모든 수치 필드가 빈 문자열인 응답 → 던진다 (빈 문자열 ≠ 0 — 0 으로 읽으면 known 0 이 된다)', () => {
    const b = clone();
    o2(b).forEach(r => blankNumeric(r));
    blankNumeric(o3(b));
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(UsdCashUnavailableError);
  });

  test('🔴 [M08] USD 행 없음 모양에서 output3 수치가 전부 빈 문자열 → 던진다', () => {
    const b = zeroBalanceOmitted();
    blankNumeric(o3(b));
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(UsdCashUnavailableError);
  });

  /** USD 행 없음 + 다른 통화 행 하나(원화 평가 v) + 합계 frcr_evlu_tota=v(Σ 일치) + tot_asst 잔차 0 — `frcr_evlu_tota≈0` 층만 막는 모양 */
  const otherCurrencyOnly = (v: number): Body => {
    const b = zeroBalanceOmitted();
    b.output2 = [{ ...o2(clone())[0], crcy_cd: 'JPY', frcr_dncl_amt_2: '0', frcr_evlu_amt2: String(v) }];
    o3(b).frcr_evlu_tota = String(v);
    return b;
  };

  test('🔴 [M04] USD 행 없음 + 다른 통화 행에 값이 있고 합계도 그 값(잔차 0, 자기모순) → 던진다 (known 0 아님)', () => {
    expect(() => parseUsdCashFromPresentBalance(otherCurrencyOnly(490_892))).toThrow(/frcr_evlu_tota=490892 ≠ 0/);
  });

  test('[M04 경계] 같은 모양에서 합계가 ±1원(반올림 한 칸)이면 known 0, 2원이면 던진다', () => {
    expect(parseUsdCashFromPresentBalance(otherCurrencyOnly(1)).usd).toBe(0);
    expect(() => parseUsdCashFromPresentBalance(otherCurrencyOnly(2))).toThrow(UsdCashUnavailableError);
  });

  test('🔴 [M44] USD 행 2개(둘 다 0, 합계·항등식 모두 0) → 던진다 — 행 개수 검사만이 막는 모양', () => {
    const b = zeroBalanceOmitted();
    const zero = { ...o2(clone())[0], frcr_dncl_amt_2: '0.000000', frcr_evlu_amt2: '0.000000' };
    b.output2 = [zero, { ...zero }];
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(/USD 행이 2개/);
  });

  test('[M44] USD 행 3개도 던진다', () => {
    const b = zeroBalanceOmitted();
    const zero = { ...o2(clone())[0], frcr_dncl_amt_2: '0', frcr_evlu_amt2: '0' };
    b.output2 = [zero, { ...zero }, { ...zero }];
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(/USD 행이 3개/);
  });

  /** 분기 2 의 tot_asst 잔차를 r 로 만든다 (frcr_evlu_tota 는 0) */
  const residual = (r: number): Body => {
    const b = zeroBalanceOmitted();
    o3(b).tot_asst_amt = String(Number(o3(b).evlu_amt_smtl_amt) + Number(o3(b).tot_dncl_amt) + r);
    return b;
  };

  test('분기 2 정상: USD 행 없음 + output3 항등식 0 → known 0', () => {
    expect(parseUsdCashFromPresentBalance(residual(0))).toEqual({ usd: 0, ustlSllAmtSmtl: 0 });
  });

  test.each([[1], [-1]])('분기 2 경계: 잔차 %p원(|x|≤1) → known 0', (r) => {
    expect(parseUsdCashFromPresentBalance(residual(r)).usd).toBe(0);
  });

  test.each([[2], [-2], [490_892]])('분기 2 경계: 잔차 %p원 → 던진다', (r) => {
    expect(() => parseUsdCashFromPresentBalance(residual(r))).toThrow(UsdCashUnavailableError);
  });

  test('분기 2 경계: frcr_evlu_tota 가 -1원(행 없음, Σ=0 과도 1원 차) → known 0', () => {
    const b = zeroBalanceOmitted();
    o3(b).frcr_evlu_tota = '-1';
    expect(parseUsdCashFromPresentBalance(b).usd).toBe(0);
  });
});

/**
 * 라운드 4 (Codex C2 high) — 분기 1 의 환율(`frst_bltn_exrt`)은 **유한한 양수**여야 한다.
 * 환율이 0 이면 `frcr_evlu_amt2 = usd × 0 = 0` 정합과 `frcr_evlu_tota = 0` 이 아무 예수금이나 통과시켜, 앱이 자체 환율로 환산한
 * 총자산이 과대 기록된다(손실 감지 은폐·해외 한도 부풀림). 이 구현이 막으려는 "형식은 맞는 잘못된 성공 응답"이다.
 */
describe('라운드 4 — 분기 1 환율은 양수여야 한다', () => {
  /** USD 행 하나의 예수금·환율·평가와 합계를 직접 정한다 (나머지 필드는 실측 픽스처 그대로) */
  const usdRow = (usd: string, rate: string | undefined, evlu: string, tota: string): Body => {
    const b = clone();
    o2(b)[0].frcr_dncl_amt_2 = usd;
    if (rate === undefined) delete o2(b)[0].frst_bltn_exrt; else o2(b)[0].frst_bltn_exrt = rate;
    o2(b)[0].frcr_evlu_amt2 = evlu;
    o3(b).frcr_evlu_tota = tota;
    return b;
  };

  test('🔴 (a) USD 양수 + 환율 0 + 평가 0 + 합계 0 (모든 정합이 0 으로 맞는 응답) → 던진다 (known 1,000,000 아님)', () => {
    expect(() => parseUsdCashFromPresentBalance(usdRow('1000000.000000', '0.00000000', '0.000000', '0'))).toThrow(/환율\(frst_bltn_exrt\)이 양수가 아님/);
  });

  test('🔴 (b) 환율 음수(정합·합계도 그 음수에 맞춤) → 던진다', () => {
    const evlu = String(368.51 * -1332.1);
    expect(() => parseUsdCashFromPresentBalance(usdRow('368.510000', '-1332.10000000', evlu, evlu))).toThrow(/양수가 아님/);
  });

  test.each([['NaN'], ['abc'], [''], ['  '], ['1e3'], [undefined]])('(c) 환율 %p → 던진다 (숫자 아님 — 라운드 1 부터 막혀 있음을 확인)', (rate) => {
    expect(() => parseUsdCashFromPresentBalance(usdRow('368.510000', rate as string | undefined, '490892.000000', '490892'))).toThrow(UsdCashUnavailableError);
  });

  test('(d) 정상 환율 1332.1 — 오늘 픽스처 그대로 known 368.51', () => {
    expect(parseUsdCashFromPresentBalance(fixture).usd).toBe(368.51);
  });

  test('(e) 의도: 환율에 크기 하한은 두지 않는다 — 0.0001 처럼 아주 작은 양수라도 정합·합계가 맞으면 known (환율 타당성 범위 검사는 범위 밖)', () => {
    const evlu = String(368.51 * 0.0001);
    expect(parseUsdCashFromPresentBalance(usdRow('368.510000', '0.0001', evlu, evlu)).usd).toBe(368.51);
  });

  test('(f) 확인: 환율 양수일 때 평가 음수(−5원, 예수금 0)는 정합 불일치로 이미 던진다 — 별도 검사 없음', () => {
    expect(() => parseUsdCashFromPresentBalance(usdRow('0', '1332.1', '-5', '-5'))).toThrow(/정합 불일치/);
  });
});
