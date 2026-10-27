/**
 * T-102 — 해외 USD 예수금: **미결제 매수(매수증거금 `frcr_buy_mgn_amt`)** 가 있는 CTRP6504R 응답.
 *
 * 2026-10-27 실측(1건)에서 매수 체결 후 결제 전 응답의 관계가 바뀌었다:
 *   - output2[USD].frcr_evlu_amt2 = (예수금 − 매수증거금) × 환율   (예전 가정: 예수금 × 환율)
 *   - output3.frcr_evlu_tota      = 예수금 × 환율                 → tota = Σ frcr_evlu_amt2 + 매수증거금 × 환율
 *   - output3.buy_mgn_amt         = 매수증거금 × 환율
 *   - output3.tot_asst_amt        = evlu_amt_smtl_amt + tot_dncl_amt + Σ frcr_evlu_amt2   (KIS 도 순예수금 기준)
 * → 평가용 `usd` 는 **순예수금**(예수금 − 매수증거금). 그 밖 경로는 여전히 던진다(모르면 0 이 아니다).
 *
 * 🔴 픽스처는 전부 **합성 값**이다(task 문서의 합성 예시 — 환율 1300, 예수금 $1,000·매수증거금 $900). 실계좌 값 금지.
 * 각 실패 픽스처는 가능한 한 "그 검사 하나만 남아 있어야 던지는" 모양으로 만든다(변이 증명용 — T-056 라운드 2 관례).
 */
import { kisFetch } from '../kis-http';
import {
  parseUsdCashFromPresentBalance, getUsdCash, UsdCashUnavailableError,
  USD_CASH_RECONCILE_TOLERANCE_KRW, USD_CASH_TOT_ASST_TOLERANCE_KRW, USD_KRW_RATE_MIN, USD_KRW_RATE_MAX,
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
jest.mock('../fx', () => ({ getUsdKrwRate: jest.fn(async () => 1300) }));

type Row = Record<string, unknown>;
type Body = { rt_cd?: unknown; msg_cd?: unknown; msg1?: unknown; output1?: unknown; output2?: unknown; output3?: unknown };

const o2 = (b: Body) => (b.output2 as Row[]);
const usdRow = (b: Body) => o2(b)[0];
const o3 = (b: Body) => (b.output3 as Row);

/**
 * 합성 응답 생성기 — KIS 가 원 단위로 반올림한 합계를 낸다고 보고 Math.round 로 맞춘다.
 *   dncl = 외화예수금(USD), margin = 매수증거금(USD), rate = 최초고시환율
 *   krwDeposit = 원화 예수금(tot_dncl_amt), holdings = 보유 평가(evlu_amt_smtl_amt)
 */
function synth(p: { dncl: number; margin: number; rate?: number; krwDeposit?: number; holdings?: number } ): Body {
  const rate = p.rate ?? 1300;
  const krwDeposit = p.krwDeposit ?? 50_000;
  const holdings = p.holdings ?? 10_000_000;
  const net = p.dncl - p.margin;
  const evlu = Math.round(net * rate);
  const tota = Math.round(p.dncl * rate);
  const buyMgn = Math.round(p.margin * rate);
  return {
    rt_cd: '0', msg_cd: 'KIOK0530', msg1: '조회되었습니다',
    output1: [],
    output2: [{
      crcy_cd: 'USD',
      frcr_dncl_amt_2: p.dncl.toFixed(6),
      frst_bltn_exrt: rate.toFixed(8),
      frcr_buy_mgn_amt: p.margin.toFixed(8),
      frcr_buy_amt_smtl: p.margin.toFixed(6),
      frcr_sll_amt_smtl: '0.000000',
      frcr_drwg_psbl_amt_1: net.toFixed(6),
      frcr_evlu_amt2: evlu.toFixed(6),
      nxdy_frcr_drwg_psbl_amt: net.toFixed(6),
    }],
    output3: {
      frcr_evlu_tota: String(tota),
      buy_mgn_amt: String(buyMgn),
      ustl_buy_amt_smtl: String(buyMgn),
      ustl_sll_amt_smtl: '0',
      tot_dncl_amt: String(krwDeposit),
      evlu_amt_smtl_amt: String(holdings),
      tot_asst_amt: String(holdings + krwDeposit + evlu),
      frcr_use_psbl_amt: net.toFixed(6),
    },
  };
}

/** task 문서의 합성 예시 그대로 (환율 1300, 예수금 $1,000.00·매수증거금 $900.00) */
const unsettledExample = (): Body => synth({ dncl: 1000, margin: 900 });
/** 같은 계좌의 결제 전 모양이 아닌 평상시(매수증거금 0) */
const settledExample = (): Body => synth({ dncl: 1000, margin: 0 });

function res(body: unknown) {
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => '' };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.KIS_MOCK = 'false';
});

describe('T-102 합성 예시가 task 문서의 숫자와 같다 (픽스처 자체 검증)', () => {
  test('frcr_evlu_amt2=130,000 · frcr_evlu_tota=1,300,000 · buy_mgn_amt=1,170,000 · tot_asst_amt=10,180,000', () => {
    const b = unsettledExample();
    expect(usdRow(b).frcr_evlu_amt2).toBe('130000.000000');
    expect(o3(b).frcr_evlu_tota).toBe('1300000');
    expect(o3(b).buy_mgn_amt).toBe('1170000');
    expect(o3(b).tot_dncl_amt).toBe('50000');
    expect(o3(b).evlu_amt_smtl_amt).toBe('10000000');
    expect(o3(b).tot_asst_amt).toBe('10180000');
  });
});

describe('T-102 정상 — 미결제 매수 상태는 순예수금, 매수증거금 0 이면 T-056 과 같은 반환', () => {
  test('🔴 미결제 매수 정상(합성 예시) → usd = 순예수금 100 (총예수금 1000 아님), 총예수금·증거금은 선택 필드로', () => {
    expect(parseUsdCashFromPresentBalance(unsettledExample())).toEqual({
      usd: 100, ustlSllAmtSmtl: 0, grossDepositUsd: 1000, unsettledBuyUsd: 900,
    });
  });

  test('🔴 회귀: 매수증거금 0 → 예전과 **같은 모양**(선택 필드 없음) usd = 예수금', () => {
    const out = parseUsdCashFromPresentBalance(settledExample());
    expect(out).toEqual({ usd: 1000, ustlSllAmtSmtl: 0 });
    expect(Object.keys(out).sort()).toEqual(['usd', 'ustlSllAmtSmtl']);
  });

  test('회귀: frcr_buy_mgn_amt 키가 없는 과거 응답 모양 → 0 으로 보고 예전과 같은 반환', () => {
    const b = settledExample();
    delete usdRow(b).frcr_buy_mgn_amt;
    expect(parseUsdCashFromPresentBalance(b)).toEqual({ usd: 1000, ustlSllAmtSmtl: 0 });
  });

  test('회귀: frcr_buy_mgn_amt 빈 문자열·공백 → 0 으로 본다', () => {
    for (const v of ['', '   ']) {
      const b = settledExample();
      usdRow(b).frcr_buy_mgn_amt = v;
      expect(parseUsdCashFromPresentBalance(b)).toEqual({ usd: 1000, ustlSllAmtSmtl: 0 });
    }
  });

  test('회귀: 매수증거금 0 이고 output3.buy_mgn_amt 키도 없음/빈 값 → 예전과 같은 반환', () => {
    for (const v of [undefined, '']) {
      const b = settledExample();
      if (v === undefined) delete o3(b).buy_mgn_amt; else o3(b).buy_mgn_amt = v;
      expect(parseUsdCashFromPresentBalance(b)).toEqual({ usd: 1000, ustlSllAmtSmtl: 0 });
    }
  });

  test('회귀: 매수증거금 0 경로는 tot_asst_amt 독립 검산을 요구하지 않는다(예전 분기 1 과 같은 검사 집합)', () => {
    const b = settledExample();
    delete o3(b).tot_asst_amt;
    expect(parseUsdCashFromPresentBalance(b)).toEqual({ usd: 1000, ustlSllAmtSmtl: 0 });
  });

  test('결제 연속성: 결제 전(예수금 1000·증거금 900)과 결제 후(예수금 100·증거금 0)의 usd 가 같다 — 총자산이 결제 시점에 튀지 않는다', () => {
    const before = parseUsdCashFromPresentBalance(unsettledExample()).usd;
    const after = parseUsdCashFromPresentBalance(synth({ dncl: 100, margin: 0 })).usd;
    expect(before).toBe(100);
    expect(after).toBe(100);
  });

  test('매수증거금 = 예수금(달러 전부 매수) → known 0 (확인된 0)', () => {
    expect(parseUsdCashFromPresentBalance(synth({ dncl: 1000, margin: 1000 }))).toEqual({
      usd: 0, ustlSllAmtSmtl: 0, grossDepositUsd: 1000, unsettledBuyUsd: 1000,
    });
  });

  test.each([
    [777.77, 333.33, 1371.25],
    [2500.01, 0.01, 1388.4],
    [12.34, 12.33, 1299.99],
    [100000, 99999.99, 1450.5],
  ])('부동소수 잡음 없이 usd = 예수금 − 증거금 (소수 6자리): 예수금 %p · 증거금 %p · 환율 %p', (dncl, margin, rate) => {
    const out = parseUsdCashFromPresentBalance(synth({ dncl, margin, rate }));
    expect(out.usd).toBe(Math.round((dncl - margin) * 1e6) / 1e6);
    expect(out.grossDepositUsd).toBe(dncl);
    expect(out.unsettledBuyUsd).toBe(margin);
  });

  test('미결제 매도 원값은 여전히 따로 기록만(평가 미반영)', () => {
    const b = unsettledExample();
    o3(b).ustl_sll_amt_smtl = '1234567';
    expect(parseUsdCashFromPresentBalance(b)).toEqual({
      usd: 100, ustlSllAmtSmtl: 1_234_567, grossDepositUsd: 1000, unsettledBuyUsd: 900,
    });
  });

  test('output2 가 배열이 아니라 객체 하나여도 같은 판정', () => {
    const b = unsettledExample();
    b.output2 = usdRow(b);
    expect(parseUsdCashFromPresentBalance(b).usd).toBe(100);
  });

  test('🔴 (Reviewer F1) 소수 7자리 입력에서도 usd ≤ grossDepositUsd — round6 올림이 예수금을 넘지 않는다', () => {
    const b = synth({ dncl: 0.4999996, margin: 0.0000001 });
    usdRow(b).frcr_dncl_amt_2 = '0.49999960';      // synth 의 toFixed(6) 대신 7자리 원문
    usdRow(b).frcr_buy_mgn_amt = '0.00000010';
    const out = parseUsdCashFromPresentBalance(b);
    expect(out.grossDepositUsd).toBe(0.4999996);
    expect(out.unsettledBuyUsd).toBe(0.0000001);
    expect(out.usd).toBeLessThanOrEqual(out.grossDepositUsd as number);
    expect(out.usd).toBeGreaterThanOrEqual(0);
  });
});

describe('T-102 허용치 경계 — 행·합계·교차 ±1원, 독립 검산 ±2원', () => {
  test('허용치 상수', () => {
    expect(USD_CASH_RECONCILE_TOLERANCE_KRW).toBe(1);
    expect(USD_CASH_TOT_ASST_TOLERANCE_KRW).toBe(2);
  });

  /** 독립 검산은 Σ frcr_evlu_amt2 에 기대므로, 행 값을 바꾸면 tot_asst 도 같이 맞춰 그 검사만 고립시킨다 */
  const shiftRowEvlu = (d: number): Body => {
    const b = unsettledExample();
    usdRow(b).frcr_evlu_amt2 = String(130_000 + d);
    o3(b).frcr_evlu_tota = String(1_300_000 + d);          // 합계는 Σ + margin×환율 그대로 유지
    o3(b).tot_asst_amt = String(10_180_000 + d);           // 독립 검산도 유지
    return b;
  };
  test.each([[1], [-1]])('행: frcr_evlu_amt2 가 순예수금×환율에서 %p원 → 통과', (d) => {
    expect(parseUsdCashFromPresentBalance(shiftRowEvlu(d)).usd).toBe(100);
  });
  test.each([[2], [-2], [1.5]])('🔴 행: frcr_evlu_amt2 가 %p원 어긋남 → 던진다', (d) => {
    expect(() => parseUsdCashFromPresentBalance(shiftRowEvlu(d))).toThrow(/USD 행 정합 불일치/);
  });

  const shiftTota = (d: number): Body => { const b = unsettledExample(); o3(b).frcr_evlu_tota = String(1_300_000 + d); return b; };
  test.each([[1], [-1]])('합계: frcr_evlu_tota 가 %p원 → 통과', (d) => {
    expect(parseUsdCashFromPresentBalance(shiftTota(d)).usd).toBe(100);
  });
  test.each([[2], [-2], [1.5]])('🔴 합계: frcr_evlu_tota 가 %p원 어긋남 → 던진다', (d) => {
    expect(() => parseUsdCashFromPresentBalance(shiftTota(d))).toThrow(/frcr_evlu_tota=.* ≠ Σ output2\.frcr_evlu_amt2/);
  });

  const shiftBuyMgn = (d: number): Body => { const b = unsettledExample(); o3(b).buy_mgn_amt = String(1_170_000 + d); return b; };
  test.each([[1], [-1]])('교차: buy_mgn_amt 가 %p원 → 통과', (d) => {
    expect(parseUsdCashFromPresentBalance(shiftBuyMgn(d)).usd).toBe(100);
  });
  test.each([[2], [-2], [1.5]])('🔴 교차: buy_mgn_amt 가 %p원 어긋남 → 던진다', (d) => {
    expect(() => parseUsdCashFromPresentBalance(shiftBuyMgn(d))).toThrow(/output3\.buy_mgn_amt=.* ≠ 매수증거금×환율/);
  });

  const shiftTotAsst = (d: number): Body => { const b = unsettledExample(); o3(b).tot_asst_amt = String(10_180_000 + d); return b; };
  test.each([[1], [-1], [2], [-2]])('독립 검산: tot_asst_amt 가 %p원 → 통과 (세 항 반올림 허용)', (d) => {
    expect(parseUsdCashFromPresentBalance(shiftTotAsst(d)).usd).toBe(100);
  });
  test.each([[3], [-3], [2.5], [1_170_000]])('🔴 독립 검산: tot_asst_amt 가 %p원 어긋남 → 던진다', (d) => {
    expect(() => parseUsdCashFromPresentBalance(shiftTotAsst(d))).toThrow(/독립 검산 불일치/);
  });
});

describe('T-102 던짐 — 미결제 매수 관련 모르는 상태는 0 도 총예수금도 아니다', () => {
  test('🔴 매수증거금 > 예수금(순예수금 음수, 다른 항등식은 전부 그 값에 맞춤) → 던진다', () => {
    // 예수금 1000 · 증거금 1100 → net −100: evlu −130,000, tota 1,300,000 = −130,000 + 1,430,000, buy_mgn 1,430,000
    expect(() => parseUsdCashFromPresentBalance(synth({ dncl: 1000, margin: 1100 }))).toThrow(/순예수금 음수/);
  });

  test('🔴 매수증거금이 예수금보다 1센트만 커도 → 던진다 (0 으로 자르지 않는다)', () => {
    expect(() => parseUsdCashFromPresentBalance(synth({ dncl: 1000, margin: 1000.01 }))).toThrow(/순예수금 음수/);
  });

  test('🔴 매수증거금 음수(나머지 항등식은 그 값에 맞춤) → 던진다', () => {
    // margin −100 → net 1100: evlu 1,430,000, tota 1,300,000 = 1,430,000 + (−130,000), buy_mgn −130,000
    expect(() => parseUsdCashFromPresentBalance(synth({ dncl: 1000, margin: -100 }))).toThrow(/frcr_buy_mgn_amt 음수/);
  });

  test.each([['abc'], ['NaN'], ['1e3'], ['Infinity'], ['9OO.00']])('🔴 매수증거금 비숫자 %p → 던진다', (v) => {
    const b = unsettledExample();
    usdRow(b).frcr_buy_mgn_amt = v;
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(/frcr_buy_mgn_amt 가 숫자가 아님/);
  });

  test.each([[Infinity], [-Infinity], [NaN]])('🔴 매수증거금 비유한 숫자 %p → 던진다', (v) => {
    const b = unsettledExample();
    usdRow(b).frcr_buy_mgn_amt = v;
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(UsdCashUnavailableError);
  });

  test('🔴 매수증거금이 있는데 output3.buy_mgn_amt 키가 없음 → 던진다 (교차 검사만 막는 모양)', () => {
    const b = unsettledExample();
    delete o3(b).buy_mgn_amt;
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(/output3\.buy_mgn_amt 가 숫자가 아님/);
  });

  test.each([[''], ['abc'], [null]])('🔴 매수증거금이 있는데 output3.buy_mgn_amt=%p → 던진다', (v) => {
    const b = unsettledExample();
    o3(b).buy_mgn_amt = v;
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(/output3\.buy_mgn_amt 가 숫자가 아님/);
  });

  test('🔴 매수증거금이 있는데 output3.buy_mgn_amt 가 0 → 던진다', () => {
    const b = unsettledExample();
    o3(b).buy_mgn_amt = '0';
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(/output3\.buy_mgn_amt=0 ≠ 매수증거금×환율/);
  });

  test('🔴 USD 행 매수증거금 0 인데 output3.buy_mgn_amt ≠ 0 (나머지는 평상시 그대로) → 던진다', () => {
    const b = settledExample();
    o3(b).buy_mgn_amt = '1170000';
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(/매수증거금이 0 인데 output3\.buy_mgn_amt=1170000/);
  });

  test('[경계] 매수증거금 0 · buy_mgn_amt ±1원 → 통과, 2원 → 던진다', () => {
    for (const v of ['1', '-1']) {
      const b = settledExample(); o3(b).buy_mgn_amt = v;
      expect(parseUsdCashFromPresentBalance(b).usd).toBe(1000);
    }
    const b = settledExample(); o3(b).buy_mgn_amt = '2';
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(/매수증거금이 0 인데/);
  });

  test('🔴 매수증거금 0 · output3.buy_mgn_amt 비숫자 → 던진다', () => {
    const b = settledExample();
    o3(b).buy_mgn_amt = 'abc';
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(/output3\.buy_mgn_amt 가 숫자가 아님/);
  });

  test('🔴 매수증거금 > 0 인데 frcr_evlu_amt2 가 예전 가정(예수금×환율) — 합계·교차·독립 검산은 그 값에 맞춤 → 행 검사가 던진다', () => {
    const b = unsettledExample();
    usdRow(b).frcr_evlu_amt2 = '1300000.000000';        // 예수금 1000 × 1300 (순예수금 기준 아님)
    o3(b).frcr_evlu_tota = String(1_300_000 + 1_170_000); // Σ + margin×환율 에 맞춤
    o3(b).tot_asst_amt = String(10_000_000 + 50_000 + 1_300_000);
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(/USD 행 정합 불일치: frcr_evlu_amt2=1300000 ≠ 100×1300/);
  });

  test('🔴 매수증거금 > 0 인데 frcr_evlu_amt2 만 예전 가정이고 합계는 예수금 전체(=Σ) → 던진다', () => {
    const b = unsettledExample();
    usdRow(b).frcr_evlu_amt2 = '1300000.000000';
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(UsdCashUnavailableError);
  });

  test('🔴 매수증거금 > 0 인데 합계가 매수증거금 항 없이 Σ 와만 같다(frcr_evlu_tota = 130,000) → 던진다', () => {
    const b = unsettledExample();
    o3(b).frcr_evlu_tota = '130000';
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(/frcr_evlu_tota=130000 ≠ Σ output2\.frcr_evlu_amt2=130000 \+ 매수증거금×환율/);
  });

  test('🔴 독립 검산: tot_asst_amt 가 총예수금 기준(KIS 가 순예수금을 안 쓰는 상태) → 던진다', () => {
    const b = unsettledExample();
    o3(b).tot_asst_amt = String(10_000_000 + 50_000 + 1_300_000);
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(/독립 검산 불일치/);
  });

  test.each([['tot_asst_amt'], ['evlu_amt_smtl_amt'], ['tot_dncl_amt']])('🔴 매수증거금 > 0 인데 output3.%s 없음 → 던진다', (k) => {
    const b = unsettledExample();
    delete o3(b)[k];
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(new RegExp(`output3\\.${k} 가 숫자가 아님`));
  });

  test.each([['tot_asst_amt'], ['evlu_amt_smtl_amt'], ['tot_dncl_amt']])('🔴 매수증거금 > 0 인데 output3.%s 비숫자 → 던진다', (k) => {
    const b = unsettledExample();
    o3(b)[k] = 'abc';
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(UsdCashUnavailableError);
  });

  test('🔴 미결제 매수 모양에서 USD 행 2개 → 던진다', () => {
    const b = unsettledExample();
    b.output2 = [usdRow(b), { ...usdRow(b) }];
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(/USD 행이 2개/);
  });

  test.each([['0.00000000'], ['-1300.00000000']])('🔴 미결제 매수 모양에서 환율 %p → 던진다', (rate) => {
    const b = unsettledExample();
    usdRow(b).frst_bltn_exrt = rate;
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(/환율\(frst_bltn_exrt\)이 양수가 아님/);
  });

  test('🔴 환율 0 + 모든 원화 항등식이 0 으로 맞는 미결제 매수 응답 → 던진다 (증거금 항이 0 으로 사라지는 모양)', () => {
    const b = synth({ dncl: 1000, margin: 900, rate: 0 });
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(/양수가 아님/);
  });

  test.each([['NaN'], ['Infinity'], [''], ['1e3']])('🔴 미결제 매수 모양에서 예수금 %p → 던진다', (v) => {
    const b = unsettledExample();
    usdRow(b).frcr_dncl_amt_2 = v;
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(UsdCashUnavailableError);
  });

  test('🔴 미결제 매수 모양에서 예수금 비유한 숫자(Infinity) → 던진다', () => {
    const b = unsettledExample();
    usdRow(b).frcr_dncl_amt_2 = Infinity;
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(UsdCashUnavailableError);
  });

  test('🔴 미결제 매수 모양에서 frcr_evlu_amt2 비숫자 → 던진다', () => {
    const b = unsettledExample();
    usdRow(b).frcr_evlu_amt2 = '';
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(UsdCashUnavailableError);
  });

  test('🔴 미결제 매수 모양에서 rt_cd≠0 → 던진다', () => {
    const b = unsettledExample();
    b.rt_cd = '1';
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(/rt_cd=1/);
  });

  test('🔴 USD 행 없음 + output3 에 매수증거금만 있음 → 던진다 (분기 2 는 바뀌지 않았다)', () => {
    const b = unsettledExample();
    b.output2 = [];
    o3(b).frcr_evlu_tota = '0';
    o3(b).tot_asst_amt = String(10_000_000 + 50_000);
    // 분기 2 의 항등식(tota≈0·잔차 0)은 통과하지만 output3.buy_mgn_amt 는 분기 2 가 보지 않는다 — 결과는 known 0.
    // 이 모양은 실측이 없다. 현재 설계(분기 2 불변)의 동작을 기록해 두고, 바뀌면 시험이 알려 주게 한다.
    expect(parseUsdCashFromPresentBalance(b)).toEqual({ usd: 0, ustlSllAmtSmtl: 0 });
  });
});

/**
 * Leader 결정(T-102 2차) — 5번째 검사: margin > 0 이면 `output3.ustl_buy_amt_smtl`(미결제매수금액 — 체결분만)이 반드시 있고
 * `≈ output3.buy_mgn_amt` (±1원). 매수증거금에 **미체결 주문 예약금**이 섞이면 ustl 쪽이 작아진다 → 던진다.
 * margin = 0 경로는 이 값을 요구하지 않는다(예전과 같은 검사 집합).
 */
describe('T-102 체결분 대조 — ustl_buy_amt_smtl ≈ buy_mgn_amt (margin > 0 일 때만)', () => {
  test('합성 예시는 ustl_buy_amt_smtl = buy_mgn_amt (픽스처 확인) → 통과', () => {
    const b = unsettledExample();
    expect(o3(b).ustl_buy_amt_smtl).toBe(o3(b).buy_mgn_amt);
    expect(parseUsdCashFromPresentBalance(b).usd).toBe(100);
  });

  const shiftUstl = (d: number): Body => { const b = unsettledExample(); o3(b).ustl_buy_amt_smtl = String(1_170_000 + d); return b; };
  test.each([[1], [-1]])('경계: ustl_buy_amt_smtl 가 %p원 → 통과', (d) => {
    expect(parseUsdCashFromPresentBalance(shiftUstl(d)).usd).toBe(100);
  });
  test.each([[2], [-2], [1.5]])('🔴 경계: ustl_buy_amt_smtl 가 %p원 어긋남 → 던진다', (d) => {
    expect(() => parseUsdCashFromPresentBalance(shiftUstl(d))).toThrow(/output3\.ustl_buy_amt_smtl=.* ≠ output3\.buy_mgn_amt=1170000/);
  });

  test('🔴 미체결 주문 예약금이 섞인 모양(증거금 $900 중 체결분 $500 — 나머지 항등식은 전부 맞음) → 던진다', () => {
    const b = unsettledExample();
    o3(b).ustl_buy_amt_smtl = String(500 * 1300);
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(/ustl_buy_amt_smtl=650000 ≠ output3\.buy_mgn_amt=1170000/);
  });

  test('🔴 ustl_buy_amt_smtl 키 없음 → 던진다', () => {
    const b = unsettledExample();
    delete o3(b).ustl_buy_amt_smtl;
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(/output3\.ustl_buy_amt_smtl 가 숫자가 아님/);
  });

  test.each([[''], ['  '], ['abc'], ['NaN'], ['1e3'], [null], [Infinity]])('🔴 ustl_buy_amt_smtl=%p → 던진다', (v) => {
    const b = unsettledExample();
    o3(b).ustl_buy_amt_smtl = v;
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(/output3\.ustl_buy_amt_smtl 가 숫자가 아님/);
  });

  test('🔴 증거금이 아주 작아 buy_mgn_amt≈1원일 때도 ustl 키가 없으면 던진다 (없음을 0 으로 읽으면 ±1원 안이라 통과해 버리는 모양)', () => {
    const b = synth({ dncl: 1000, margin: 0.0005 });   // buy_mgn = round(0.65) = 1
    expect(o3(b).buy_mgn_amt).toBe('1');
    expect(parseUsdCashFromPresentBalance(b).usd).toBe(999.9995);   // 키가 있으면 통과(대조군)
    delete o3(b).ustl_buy_amt_smtl;
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(/ustl_buy_amt_smtl 가 숫자가 아님/);
  });

  test('회귀: margin 0 이면 ustl_buy_amt_smtl 을 요구하지 않는다 — 키 없음·비숫자·0 아닌 값 모두 예전처럼 통과', () => {
    for (const v of [undefined, 'abc', '1170000']) {
      const b = settledExample();
      if (v === undefined) delete o3(b).ustl_buy_amt_smtl; else o3(b).ustl_buy_amt_smtl = v;
      expect(parseUsdCashFromPresentBalance(b)).toEqual({ usd: 1000, ustlSllAmtSmtl: 0 });
    }
  });
});

/**
 * T-102 Codex C2 high — USD 행 환율 타당 범위(100~10000 KRW/USD). 원 단위 허용치는 달러로 1/환율이라, 환율이 극단적이면
 * ±1·±2원 정합 검사가 사실상 무력화된다. 분기 1 공통(margin 0·>0). 0·음수는 기존 "양수가 아님" 메시지 그대로.
 * 즉 분기 1 의 환율은 **유한한 양수(T-056 라운드 4) 이고 100 ≤ 환율 ≤ 10000 (`USD_KRW_RATE_MIN/MAX`)** 이어야 한다.
 * (T-056 라운드 4 의 "크기 하한은 두지 않는다" 결정은 이 규칙으로 뒤집혔다 — 기존 시험 (e) 참고.)
 */
describe('T-102 환율 타당 범위 — 100 ≤ frst_bltn_exrt ≤ 10000', () => {
  test('상수', () => {
    expect(USD_KRW_RATE_MIN).toBe(100);
    expect(USD_KRW_RATE_MAX).toBe(10_000);
  });

  test.each([[100], [10_000]])('경계 통과: 환율 %p (margin 0 · margin > 0 모두)', (rate) => {
    expect(parseUsdCashFromPresentBalance(synth({ dncl: 1000, margin: 0, rate }))).toEqual({ usd: 1000, ustlSllAmtSmtl: 0 });
    expect(parseUsdCashFromPresentBalance(synth({ dncl: 1000, margin: 900, rate })).usd).toBe(100);
  });

  test.each([[99.99], [10_000.01], [1], [0.0001], [1_000_000]])('🔴 범위 밖: 환율 %p → 던진다 (margin 0 · margin > 0 모두)', (rate) => {
    expect(() => parseUsdCashFromPresentBalance(synth({ dncl: 1000, margin: 0, rate }))).toThrow(/환율\(frst_bltn_exrt\)이 타당 범위\(100~10000\) 밖/);
    expect(() => parseUsdCashFromPresentBalance(synth({ dncl: 1000, margin: 900, rate }))).toThrow(/환율\(frst_bltn_exrt\)이 타당 범위\(100~10000\) 밖/);
  });

  test('🔴 Codex 재현: 환율 0.000001 · 예수금 1 · 증거금 0.5 · 원화 항목 전부 0(모든 원 단위 검사가 맞는 손상 응답) → 던진다 (known 0.5 아님)', () => {
    const b = synth({ dncl: 1, margin: 0.5, rate: 0.000001 });
    expect(usdRow(b).frcr_evlu_amt2).toBe('0.000000');
    expect(o3(b).frcr_evlu_tota).toBe('0');
    expect(o3(b).buy_mgn_amt).toBe('0');
    expect(o3(b).ustl_buy_amt_smtl).toBe('0');
    expect(o3(b).tot_asst_amt).toBe(String(10_000_000 + 50_000));
    expect(() => parseUsdCashFromPresentBalance(b)).toThrow(/타당 범위\(100~10000\) 밖 \(0\.000001\)/);
  });

  test.each([['0.00000000'], ['-1300.00000000']])('0·음수 환율 %p 은 기존 메시지("양수가 아님")로 던진다 (margin 0 · margin > 0 모두)', (rate) => {
    for (const margin of [0, 900]) {
      const b = synth({ dncl: 1000, margin });
      usdRow(b).frst_bltn_exrt = rate;
      expect(() => parseUsdCashFromPresentBalance(b)).toThrow(/환율\(frst_bltn_exrt\)이 양수가 아님/);
    }
  });
});

describe('T-102 getUsdCash — 선택 필드 전달', () => {
  test('미결제 매수 응답 → known 순예수금 + 선택 필드', async () => {
    (kisFetch as jest.Mock).mockResolvedValueOnce(res(unsettledExample()));
    await expect(getUsdCash()).resolves.toEqual({
      usd: 100, source: 'CTRP6504R', ustlSllAmtSmtl: 0, grossDepositUsd: 1000, unsettledBuyUsd: 900,
    });
  });

  test('🔴 회귀: 매수증거금 0 응답 → 선택 필드 키 자체가 없다 (T-056 과 같은 모양)', async () => {
    (kisFetch as jest.Mock).mockResolvedValueOnce(res(settledExample()));
    const r = await getUsdCash();
    expect(r).toEqual({ usd: 1000, source: 'CTRP6504R', ustlSllAmtSmtl: 0 });
    expect(Object.keys(r).sort()).toEqual(['source', 'usd', 'ustlSllAmtSmtl']);
  });

  test('🔴 판정 실패 응답 → 던진다 (0 아님)', async () => {
    (kisFetch as jest.Mock).mockResolvedValueOnce(res(synth({ dncl: 1000, margin: 1100 })));
    await expect(getUsdCash()).rejects.toThrow(UsdCashUnavailableError);
  });
});
