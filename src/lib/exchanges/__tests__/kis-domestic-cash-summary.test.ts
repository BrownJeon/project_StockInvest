/**
 * T-056 Q3 — 국내 KRW 예수금 행도 USD 와 같은 규칙: **요약이 없거나 값이 이상하면 행을 만들지 않는다**(0원 행 금지).
 * 예전 코드는 `Number(summary.dnca_tot_amt ?? 0)` 이라 필드가 빠진 응답이 "확정 0원 행"이 됐다.
 */
import { parseDomesticCashSummary } from '../kis-domestic';

describe('parseDomesticCashSummary', () => {
  test('정상(실측 모양) → free = D+2 정산금액, locked = 결제 대기분', () => {
    expect(parseDomesticCashSummary([{ dnca_tot_amt: '100000', prvs_rcdl_excc_amt: '80138' }]))
      .toEqual({ currency: 'KRW', free: 80_138, locked: 19_862 });
  });

  test('잔액 0 은 확인된 0 행이다', () => {
    expect(parseDomesticCashSummary([{ dnca_tot_amt: '0', prvs_rcdl_excc_amt: '0' }]))
      .toEqual({ currency: 'KRW', free: 0, locked: 0 });
  });

  test('prvs_rcdl_excc_amt 가 없으면(null·undefined) 예수금총금액을 쓴다 — 기존 `??` 동작', () => {
    expect(parseDomesticCashSummary([{ dnca_tot_amt: '5000' }])).toEqual({ currency: 'KRW', free: 5000, locked: 0 });
    expect(parseDomesticCashSummary([{ dnca_tot_amt: '5000', prvs_rcdl_excc_amt: null }])).toMatchObject({ free: 5000 });
  });

  test('D+2 가 음수(미수)면 예전처럼 0 으로 잘라 쓴다 — 판정 불가로 보지 않는다(보류 데드락 방지)', () => {
    expect(parseDomesticCashSummary([{ dnca_tot_amt: '1000', prvs_rcdl_excc_amt: '-500' }]))
      .toEqual({ currency: 'KRW', free: 0, locked: 1500 });
  });

  test('output2 가 배열이 아니라 객체여도 읽는다', () => {
    expect(parseDomesticCashSummary({ dnca_tot_amt: '7' })).toMatchObject({ free: 7 });
  });

  test.each([
    ['output2 없음', undefined],
    ['빈 배열', []],
    ['요약 행 null', [null]],
    ['dnca_tot_amt 없음 (예전: 0원 행)', [{ prvs_rcdl_excc_amt: '80138' }]],
    ['dnca_tot_amt 빈 문자열', [{ dnca_tot_amt: '' }]],
    ['dnca_tot_amt 비숫자', [{ dnca_tot_amt: 'abc' }]],
    ['prvs_rcdl_excc_amt 비숫자', [{ dnca_tot_amt: '100', prvs_rcdl_excc_amt: 'x' }]],
    ['prvs_rcdl_excc_amt 빈 문자열', [{ dnca_tot_amt: '100', prvs_rcdl_excc_amt: '' }]],
  ])('🔴 %s → null (KRW 행을 지어내지 않는다)', (_n, v) => {
    expect(parseDomesticCashSummary(v)).toBeNull();
  });
});
