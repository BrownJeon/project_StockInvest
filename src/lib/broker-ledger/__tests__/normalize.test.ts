/**
 * T-087 — `normalize.ts` 시험(합성 픽스처): 정규화(체결·기간손익·잔고) · 민감 필드 제거 · 자연키·응답 안 중복 · 수수료 추정 ·
 * 합계 대조(설계 §3.4 규칙·허용치) · run 완전성 판정(DDL chk_bfr_complete 와 같은 조건) · 창/조회 범위 · 85일 · tr_cont.
 */
import {
  normalizeFills, normalizeRealizedPnl, normalizePositionSnapshot, partitionDuplicates, checkSums, assessRunCompleteness,
  queryRangeForWindow, withinDomesticFillsTrWindow, trContDbValue, initialPositiveCheck, sourceTrMatches, overseasAppSymbol,
  estimateFee, kstDate, isIsoDate, addDaysIso, runErrorText, fillKey, SUM_RULES, OVERSEAS_FEE_RATE_PCT,
} from '../normalize';
import { parseDec } from '../decimal';
import { domesticFillsEarliestFrom } from '@/lib/exchanges/kis-domestic-ledger';
import { kstDateOf, addDays } from '@/lib/exchanges/kis-ledger-query';
import type { CompletenessInput, RawLedgerBatch } from '../types';
import {
  domFillRow, domFillSummary, ovsFillRow, domPnlRow, domPnlSummary, ovsPnlRow, ovsPnlSummary, domPosRow, domPosSummary, ovsPosRow, ovsPosSummary3,
} from './helpers/kis-fixtures';

const batch = (market: 'domestic' | 'overseas', kind: RawLedgerBatch['kind'], trId: string, rows: Record<string, unknown>[]): RawLedgerBatch => ({ market, kind, trId, rows });

describe('체결 정규화 — 국내 TTTC0081R', () => {
  test('열 매핑(DDL 열 이름) · KST 주문일·시각 · KRW amount_krw_est · 수수료 추정 없음 · 민감 필드 제거', () => {
    const { items, issues } = normalizeFills(batch('domestic', 'fills', 'TTTC0081R', [domFillRow()]));
    expect(issues).toEqual([]);
    const [it] = items;
    expect(it.row).toEqual(expect.objectContaining({
      broker: 'kis', market: 'domestic', order_date: '2026-11-03', local_order_date: null, broker_order_no: '0000012345', orig_order_no: null,
      order_time: '09:30:15', symbol: '900010', broker_symbol: '900010', exchange_code: 'SOR', side: 'buy', currency: 'KRW',
      order_qty: '5.00000000', filled_qty: '5.00000000', remaining_qty: '0.00000000', cancelled_qty: '0.00000000', rejected_qty: '0.00000000',
      avg_fill_price: '10000.00000000', fill_amount: '50000.0000', order_type_code: '00', revise_cancel_code: null,
      broker_status_name: '없음', reject_reason: null, fractional_hint: null, settle_state: 'closed', amount_krw_est: '50000.00', source_tr: 'TTTC0081R',
    }));
    expect(it.row.raw_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(it.row.raw_json).not.toMatch(/ctac_tlno|inqr_ip_addr|ordr_empno/);
    expect(it.feeEstimate).toBeNull();   // 국내 수수료는 D2 가 기간손익 fee 를 배분한다
    expect(it.cancelOrReviseSignal).toBe(false);
    expect(it.key).toBe('domestic|2026-11-03|0000012345');
  });

  test('settle_state — 잔량 >0 open / 0 closed / 비었거나 판독 불가 unknown(가짜 0 금지)', () => {
    const s = (rmn: unknown) => normalizeFills(batch('domestic', 'fills', 'TTTC0081R', [domFillRow({ rmn_qty: rmn })])).items[0]?.row.settle_state;
    expect(s('2')).toBe('open');
    expect(s('0')).toBe('closed');
    expect(s('')).toBe('unknown');
    expect(s(undefined)).toBe('unknown');
    expect(normalizeFills(batch('domestic', 'fills', 'TTTC0081R', [domFillRow({ rmn_qty: 'x' })])).issues).toEqual([{ index: 0, reason: 'not_decimal', field: 'rmn_qty' }]);
  });

  test('취소·정정 신호 — cncl_cfrm_qty>0 또는 cncl_yn=Y', () => {
    const sig = (o: Record<string, unknown>) => normalizeFills(batch('domestic', 'fills', 'TTTC0081R', [domFillRow(o)])).items[0].cancelOrReviseSignal;
    expect(sig({ cncl_cfrm_qty: '2' })).toBe(true);
    expect(sig({ cncl_yn: 'Y' })).toBe(true);
    expect(sig({ cncl_yn: 'N' })).toBe(false);
    expect(sig({})).toBe(false);
  });

  test('체결 0 행(미체결·취소)은 저장한다 — 단가·대금이 비어 오면 0, 체결이 있는데 비면 issue(ord_unpr 로 지어내지 않음)', () => {
    const zero = normalizeFills(batch('domestic', 'fills', 'TTTC0081R', [domFillRow({ tot_ccld_qty: '0', avg_prvs: '', tot_ccld_amt: '', rmn_qty: '5' })]));
    expect(zero.issues).toEqual([]);
    expect(zero.items[0].row).toMatchObject({ filled_qty: '0.00000000', avg_fill_price: '0.00000000', fill_amount: '0.0000', settle_state: 'open' });
    const bad = normalizeFills(batch('domestic', 'fills', 'TTTC0081R', [domFillRow({ avg_prvs: '' })]));
    expect(bad.items).toEqual([]);
    expect(bad.issues).toEqual([{ index: 0, reason: 'missing', field: 'avg_prvs' }]);
  });

  test.each([
    ['국내', 'domestic', 'TTTC0081R', domFillRow({ tot_ccld_amt: '' }), 'tot_ccld_amt'],
    ['국내(키 없음)', 'domestic', 'TTTC0081R', domFillRow({ tot_ccld_amt: undefined }), 'tot_ccld_amt'],
    ['해외', 'overseas', 'TTTS3035R', ovsFillRow({ ft_ccld_amt3: '' }), 'ft_ccld_amt3'],
    ['해외(키 없음)', 'overseas', 'TTTS3035R', ovsFillRow({ ft_ccld_amt3: undefined }), 'ft_ccld_amt3'],
  ] as [string, 'domestic' | 'overseas', string, Record<string, unknown>, string][])(
    '%s: 체결이 있는데 체결대금이 비면 0 으로 채우지 않고 issue (Reviewer R2)', (_n, market, tr, row, field) => {
      const r = normalizeFills(batch(market, 'fills', tr, [row]));
      expect(r.items).toEqual([]);
      expect(r.issues).toEqual([{ index: 0, reason: 'missing', field }]);
    });

  test('필수 값 이상 → issue(값은 담지 않는다), 다른 행은 정상 처리', () => {
    const rows = [
      domFillRow({ odno: '' }),                         // 0: 주문번호 없음
      domFillRow({ odno: '0000-1' }),                   // 1: 주문번호 형식
      domFillRow({ ord_dt: '20261340' }),               // 2: 날짜
      domFillRow({ ord_tmd: '246000' }),                // 3: 시각
      domFillRow({ sll_buy_dvsn_cd: '03' }),            // 4: 방향
      domFillRow({ tot_ccld_qty: '-1' }),               // 5: 음수
      domFillRow({ pdno: 'ab' }),                       // 6: 종목코드
      domFillRow({ tot_ccld_amt: '1e5' }),              // 7: 숫자 형식
      domFillRow({ odno: '0000099999' }),               // 8: 정상
      domFillRow({ ord_dt: '19991231' }),               // 9: DDL 날짜 범위 밖
    ];
    const { items, issues } = normalizeFills(batch('domestic', 'fills', 'TTTC0081R', rows));
    expect(items.map((i) => i.row.broker_order_no)).toEqual(['0000099999']);
    expect(issues).toEqual([
      { index: 0, reason: 'missing', field: 'odno' },
      { index: 1, reason: 'bad_order_no', field: 'odno' },
      { index: 2, reason: 'bad_date', field: 'ord_dt' },
      { index: 3, reason: 'bad_time', field: 'ord_tmd' },
      { index: 4, reason: 'unknown_side', field: 'sll_buy_dvsn_cd' },
      { index: 5, reason: 'negative', field: 'tot_ccld_qty' },
      { index: 6, reason: 'bad_symbol', field: 'pdno' },
      { index: 7, reason: 'not_decimal', field: 'tot_ccld_amt' },
      { index: 9, reason: 'bad_date', field: 'ord_dt' },
    ]);
    expect(JSON.stringify(issues)).not.toMatch(/0000-1|20261340|246000|1e5/);   // 값은 issue 에 없다
  });

  test('국내 종목코드: 숫자 6자리 + 영숫자 단축코드 허용, 소문자·5자리 거부', () => {
    const ok = (p: string) => normalizeFills(batch('domestic', 'fills', 'TTTC0081R', [domFillRow({ pdno: p })])).issues.length === 0;
    expect(ok('900010')).toBe(true);
    expect(ok('0099A0')).toBe(true);
    expect(ok('0099a0')).toBe(false);
    expect(ok('90001')).toBe(false);
  });

  test('코드 열이 DDL 길이를 넘으면 issue, 표시 문자열은 잘라 넣는다', () => {
    expect(normalizeFills(batch('domestic', 'fills', 'TTTC0081R', [domFillRow({ ord_dvsn_cd: '123456789' })])).issues)
      .toEqual([{ index: 0, reason: 'too_long', field: 'ord_dvsn_cd' }]);
    const long = normalizeFills(batch('domestic', 'fills', 'TTTC0081R', [domFillRow({ ccld_cndt_name: '가'.repeat(60) })]));
    expect(long.items[0].row.broker_status_name).toBe('가'.repeat(40));
  });
});

describe('체결 정규화 — 해외 TTTS3035R', () => {
  test('KST 주문일 = dmst_ord_dt, 현지 = ord_dt · NASD→NAS: · USD · 추정 수수료 0.25% · amount_krw_est null(환산은 D2)', () => {
    const { items, issues } = normalizeFills(batch('overseas', 'fills', 'TTTS3035R', [ovsFillRow()]));
    expect(issues).toEqual([]);
    const [it] = items;
    expect(it.row).toEqual(expect.objectContaining({
      market: 'overseas', order_date: '2026-11-03', local_order_date: '2026-11-02', broker_order_no: '0000012345', order_time: '23:30:15',
      symbol: 'NAS:XMPL', broker_symbol: 'XMPL', exchange_code: 'NASD', side: 'buy', currency: 'USD',
      order_qty: '3.00000000', filled_qty: '3.00000000', remaining_qty: '0.00000000', cancelled_qty: null, rejected_qty: null,
      avg_fill_price: '101.23450000', fill_amount: '303.7035', revise_cancel_code: '00', broker_status_name: '완료',
      fractional_hint: null, settle_state: 'closed', amount_krw_est: null, source_tr: 'TTTS3035R',
    }));
    expect(it.feeEstimate).toEqual({ fee_kind: 'estimated', fee_native: '0.759259', fee_rate_pct: OVERSEAS_FEE_RATE_PCT });
    expect(OVERSEAS_FEE_RATE_PCT).toBe('0.25000');
    expect(it.cancelOrReviseSignal).toBe(false);
  });

  test('거래소 코드 매핑 — NASD/NYSE/AMEX(4자) + NAS/NYS/AMS(3자), 모르는 코드는 추측하지 않고 issue', () => {
    expect(overseasAppSymbol('NYSE', 'brk.b')).toBe('NYS:BRK.B');
    expect(overseasAppSymbol('AMEX', 'XMPL')).toBe('AMS:XMPL');
    expect(overseasAppSymbol('NAS', 'XMPL')).toBe('NAS:XMPL');
    expect(overseasAppSymbol('TKSE', 'XMPL')).toBeNull();
    expect(overseasAppSymbol('NASD', 'X/Y')).toBeNull();
    const r = normalizeFills(batch('overseas', 'fills', 'TTTS3035R', [ovsFillRow({ ovrs_excg_cd: 'HKEX' })]));
    expect(r.items).toEqual([]);
    expect(r.issues).toEqual([{ index: 0, reason: 'unknown_exchange', field: 'ovrs_excg_cd' }]);
  });

  test('통화는 대소문자 그대로 — usd·JPY 는 issue(DDL utf8mb4_bin 과 같은 규칙)', () => {
    for (const c of ['usd', 'JPY', '']) {
      const r = normalizeFills(batch('overseas', 'fills', 'TTTS3035R', [ovsFillRow({ tr_crcy_cd: c })]));
      expect(r.items).toEqual([]);
      expect(r.issues[0].field).toBe('tr_crcy_cd');
    }
  });

  test('취소·정정 신호 — rvse_cncl_dvsn 01/02 만(00·모르는 코드는 신호 없음 = 낡은 응답 쪽, fail-closed)', () => {
    const sig = (c: string) => normalizeFills(batch('overseas', 'fills', 'TTTS3035R', [ovsFillRow({ rvse_cncl_dvsn: c })])).items[0].cancelOrReviseSignal;
    expect(sig('01')).toBe(true);
    expect(sig('02')).toBe(true);
    expect(sig('00')).toBe(false);
    expect(sig('09')).toBe(false);
  });

  test('미니스탁 — 소수 수량 허용, splt_buy_attr_name 원문 보존, 거부 사유 이름 우선', () => {
    const r = normalizeFills(batch('overseas', 'fills', 'TTTS3035R', [ovsFillRow({
      ft_ord_qty: '0.25', ft_ccld_qty: '0.12500000', nccs_qty: '0.125', splt_buy_attr_name: '소수점', rjct_rson: '01', rjct_rson_name: '잔고부족',
    })]));
    expect(r.issues).toEqual([]);
    expect(r.items[0].row).toMatchObject({ filled_qty: '0.12500000', remaining_qty: '0.12500000', settle_state: 'open', fractional_hint: '소수점', reject_reason: '잔고부족' });
  });
});

describe('기간손익 정규화', () => {
  test('국내 일별 합산 — grain day · symbol "" · fee(매수+매도)·tl_tax(매도) · 음수 손익 허용', () => {
    const { items, issues } = normalizeRealizedPnl(batch('domestic', 'realized_pnl', 'TTTC8708R', [domPnlRow()]));
    expect(issues).toEqual([]);
    expect(items[0].row).toEqual(expect.objectContaining({
      market: 'domestic', trade_date: '2026-11-04', grain: 'day', symbol: '', broker_symbol: '', exchange_code: null, currency: 'KRW',
      sell_qty: '10.00000000', buy_qty: '0.00000000', sell_amount_native: '1234000.0000', buy_amount_native: '0.0000',
      avg_sell_price: null, avg_buy_price: null, realized_pnl_native: '-5600.0000', fee_native: '185.000000', tax_native: '2221.000000',
      loan_interest_native: '0.000000', pnl_rate_pct: '-0.4500', fx_usdkrw: null, fx_first_notice: null, source_tr: 'TTTC8708R',
    }));
    expect(items[0].key).toBe('domestic|2026-11-04|day|');
  });

  test('해외 종목·일별 — NAS: 심볼 · USD · 원가·매도 제비용·환율(12,4 반올림) · 환율 0 은 저장 안 함', () => {
    const { items, issues } = normalizeRealizedPnl(batch('overseas', 'realized_pnl', 'TTTS3039R', [ovsPnlRow(), ovsPnlRow({ ovrs_pdno: 'XMPB', exrt: '0' })]));
    expect(issues).toEqual([]);
    expect(items[0].row).toEqual(expect.objectContaining({
      market: 'overseas', trade_date: '2026-11-10', grain: 'day_symbol', symbol: 'NAS:XMPL', broker_symbol: 'XMPL', exchange_code: 'NASD',
      currency: 'USD', sell_qty: '3.00000000', buy_qty: null, sell_amount_native: '297.0000', buy_amount_native: '303.7035',
      avg_sell_price: '99.00000000', avg_buy_price: '101.23450000', realized_pnl_native: '-7.4460', fee_native: '0.742500',
      tax_native: null, loan_interest_native: null, pnl_rate_pct: '-2.4517', fx_usdkrw: '1400.0000', fx_first_notice: '1401.5000',
    }));
    expect(items[1].row.fx_usdkrw).toBeNull();
  });

  test('손익 값이 없으면 issue(0 으로 읽지 않는다)', () => {
    expect(normalizeRealizedPnl(batch('domestic', 'realized_pnl', 'TTTC8708R', [domPnlRow({ rlzt_pfls: '' })])).issues)
      .toEqual([{ index: 0, reason: 'missing', field: 'rlzt_pfls' }]);
  });
});

describe('잔고 스냅샷 정규화', () => {
  test('국내 — 보유 0 행도 남긴다 · as_of = 조회일 · cost_includes_fee unknown', () => {
    const rows = [domPosRow(), domPosRow({ pdno: '900020', hldg_qty: '0', pchs_avg_pric: '0.0000', pchs_amt: '0', thdt_sll_qty: '3' })];
    const { items, issues } = normalizePositionSnapshot(batch('domestic', 'position_snapshot', 'TTTC8434R', rows), '2026-11-05');
    expect(issues).toEqual([]);
    expect(items.map((i) => [i.row.symbol, i.row.qty])).toEqual([['900010', '7.00000000'], ['900020', '0.00000000']]);
    expect(items[0].row).toMatchObject({ as_of: '2026-11-05', currency: 'KRW', avg_price_native: '10000.00000000', purchase_amount_native: '70000.0000', cost_includes_fee: 'unknown', source_tr: 'TTTC8434R' });
    expect(JSON.parse(items[1].row.raw_json).thdt_sll_qty).toBe('3');   // L-7 절단식 입력 보존
  });

  test('해외 — NAS: 심볼 · buy_crcy_cd · 소수 수량 · 통화 이상은 issue', () => {
    const ok = normalizePositionSnapshot(batch('overseas', 'position_snapshot', 'CTRP6504R', [ovsPosRow()]), '2026-11-05');
    expect(ok.items[0].row).toMatchObject({ symbol: 'NAS:XMPL', broker_symbol: 'XMPL', exchange_code: 'NASD', currency: 'USD', qty: '3.00000000', avg_price_native: '101.23450000', purchase_amount_native: '303.7035' });
    const bad = normalizePositionSnapshot(batch('overseas', 'position_snapshot', 'CTRP6504R', [ovsPosRow({ buy_crcy_cd: 'usd' })]), '2026-11-05');
    expect(bad.issues).toEqual([{ index: 0, reason: 'unsupported_currency', field: 'buy_crcy_cd' }]);
    expect(() => normalizePositionSnapshot(batch('overseas', 'position_snapshot', 'CTRP6504R', []), '2026-11-31')).toThrow(RangeError);
  });

  test('kind 가 다른 배치를 넣으면 던진다(프로그램 오류)', () => {
    expect(() => normalizeFills(batch('domestic', 'realized_pnl', 'TTTC8708R', []))).toThrow(TypeError);
    expect(() => normalizeRealizedPnl(batch('domestic', 'fills', 'TTTC0081R', []))).toThrow(TypeError);
  });
});

describe('자연키·응답 안 중복(설계 §3.2 ①)', () => {
  test('3행 중 2행이 같은 키 → writable 1, duplicateKeys 1 (겹친 키의 행은 전부 쓰지 않는다)', () => {
    const { items } = normalizeFills(batch('domestic', 'fills', 'TTTC0081R', [
      domFillRow({ odno: '0000011111' }), domFillRow({ odno: '0000011111', tot_ccld_qty: '4', tot_ccld_amt: '40000' }), domFillRow({ odno: '0000022222' }),
    ]));
    const p = partitionDuplicates(items);
    expect(p.writable.map((i) => i.row.broker_order_no)).toEqual(['0000022222']);
    expect(p.duplicateKeys).toBe(1);
    expect(p.duplicateKeyList).toEqual(['domestic|2026-11-03|0000011111']);
  });

  test('대소문자만 다른 주문번호는 같은 키(DB 콜레이션 general_ci 와 같게)', () => {
    expect(fillKey({ market: 'overseas', order_date: '2026-11-03', broker_order_no: 'ab12' }))
      .toBe(fillKey({ market: 'overseas', order_date: '2026-11-03', broker_order_no: 'AB12' }));
  });

  test('같은 주문번호라도 주문일이 다르면 다른 키(번호 유일성은 영업일 단위 가정 — §3.1)', () => {
    const { items } = normalizeFills(batch('domestic', 'fills', 'TTTC0081R', [domFillRow(), domFillRow({ ord_dt: '20261104' })]));
    expect(partitionDuplicates(items).duplicateKeys).toBe(0);
  });

  test('해외 기간손익 같은 (날·종목) 두 행 → 중복(덮어쓰지 않는다)', () => {
    const { items } = normalizeRealizedPnl(batch('overseas', 'realized_pnl', 'TTTS3039R', [ovsPnlRow(), ovsPnlRow({ slcl_qty: '1' })]));
    expect(partitionDuplicates(items)).toMatchObject({ writable: [], duplicateKeys: 1 });
  });
});

describe('합계 대조(설계 §3.4)', () => {
  const S = (market: 'domestic' | 'overseas', kind: RawLedgerBatch['kind'], trId: string, rows: Record<string, unknown>[], summaries: unknown[]) =>
    checkSums({ market, kind, trId, rows, summaries });

  test('국내 체결: Σtot_ccld_qty·Σtot_ccld_amt = output2 → match / 하나라도 다르면 mismatch', () => {
    const rows = [domFillRow(), domFillRow({ odno: '0000012346', tot_ccld_qty: '0', tot_ccld_amt: '0' })];
    expect(S('domestic', 'fills', 'TTTC0081R', rows, [domFillSummary(rows)])).toEqual({ result: 'match', reasons: [] });
    expect(S('domestic', 'fills', 'TTTC0081R', rows, [domFillSummary(rows, { tot_ccld_amt: '50001' })]))
      .toEqual({ result: 'mismatch', reasons: ['sum_mismatch:tot_ccld_amt'] });
  });

  test('빈 응답(행 0·요약 0)은 match — 합계 대조는 내부 일관성만 본다(M-B: 부재 증거 아님, positive_check 는 D2)', () => {
    expect(S('domestic', 'fills', 'TTTC0081R', [], [domFillSummary([])]).result).toBe('match');
  });

  test('국내 기간손익: Σrlzt_pfls·Σfee·Σtl_tax 정확 일치', () => {
    const rows = [domPnlRow(), domPnlRow({ trad_dt: '20261105', rlzt_pfls: '1200', fee: '20', tl_tax: '0' })];
    expect(S('domestic', 'realized_pnl', 'TTTC8708R', rows, [domPnlSummary(rows)]).result).toBe('match');
    expect(S('domestic', 'realized_pnl', 'TTTC8708R', rows, [domPnlSummary(rows, { tot_tltx: '0' })]).reasons).toEqual(['sum_mismatch:tl_tax']);
  });

  test('해외 기간손익: 전 페이지 합 = 요약 / 첫 페이지만이면 mismatch(M 페이지 판별력)', () => {
    const p1 = [ovsPnlRow()], p2 = [ovsPnlRow({ ovrs_pdno: 'XMPB', ovrs_rlzt_pfls_amt: '12.34567', frcr_sll_amt_smtl1: '500.123456' })];
    const total = ovsPnlSummary([...p1, ...p2]);
    expect(S('overseas', 'realized_pnl', 'TTTS3039R', [...p1, ...p2], [total, total]).result).toBe('match');
    expect(S('overseas', 'realized_pnl', 'TTTS3039R', p1, [total]).result).toBe('mismatch');
  });

  test('"정확" = 소수 2자리 반올림 뒤 — 0.004 차이는 일치, 0.006 은 불일치', () => {
    const rows = [ovsPnlRow({ ovrs_rlzt_pfls_amt: '1.00000', frcr_sll_amt_smtl1: '10.000000' })];
    expect(S('overseas', 'realized_pnl', 'TTTS3039R', rows, [{ ovrs_rlzt_pfls_tot_amt: '1.004', stck_sll_amt_smtl: '10.00' }]).result).toBe('match');
    expect(S('overseas', 'realized_pnl', 'TTTS3039R', rows, [{ ovrs_rlzt_pfls_tot_amt: '1.006', stck_sll_amt_smtl: '10.00' }]).result).toBe('mismatch');
  });

  test('국내 잔고: Σevlu_amt = output2[0].evlu_amt_smtl_amt(정확)', () => {
    const rows = [domPosRow(), domPosRow({ pdno: '900020', evlu_amt: '0' })];
    expect(S('domestic', 'position_snapshot', 'TTTC8434R', rows, [domPosSummary(rows)]).result).toBe('match');
    expect(S('domestic', 'position_snapshot', 'TTTC8434R', rows, [domPosSummary(rows, { evlu_amt_smtl_amt: '73501' })]).result).toBe('mismatch');
  });

  test('해외 잔고: Σfrcr_evlu_amt2 vs output3.evlu_amt_smtl 상대 1e-3 (4e-5 차는 match, 2e-3 은 mismatch)', () => {
    const rows = [ovsPosRow({ frcr_evlu_amt2: '1000.000000' }), ovsPosRow({ pdno: 'XMPB', frcr_evlu_amt2: '1500.000000' })];   // Σ 2500
    expect(S('overseas', 'position_snapshot', 'CTRP6504R', rows, [ovsPosSummary3('2500')]).result).toBe('match');
    expect(S('overseas', 'position_snapshot', 'CTRP6504R', rows, [ovsPosSummary3('2500.1')]).result).toBe('match');   // 4e-5
    expect(S('overseas', 'position_snapshot', 'CTRP6504R', rows, [ovsPosSummary3('2505')]).result).toBe('mismatch'); // 2e-3
    expect(S('overseas', 'position_snapshot', 'CTRP6504R', [], [ovsPosSummary3('0')]).result).toBe('match');
    // frcr_evlu_tota(달러 예수금 줄)는 대조 대상이 아니다
    expect(S('overseas', 'position_snapshot', 'CTRP6504R', rows, [ovsPosSummary3('2500', { frcr_evlu_tota: '999999' })]).result).toBe('match');
  });

  test('해외 체결은 unavailable(요약 블록 없음) — 다른 조합은 규칙이 없으면 mismatch(no_sum_rule)', () => {
    expect(S('overseas', 'fills', 'TTTS3035R', [ovsFillRow()], [])).toEqual({ result: 'unavailable', reasons: [] });
    expect(S('domestic', 'fills', 'CTSC9215R', [], [{}])).toEqual({ result: 'mismatch', reasons: ['no_sum_rule'] });
    expect(S('domestic', 'fills', 'TTTS3035R', [], [])).toEqual({ result: 'mismatch', reasons: ['no_sum_rule'] });
  });

  test('요약 없음·여러 행·페이지마다 다름·값 이상·행 값 이상 → mismatch(사유 코드만)', () => {
    const rows = [domFillRow()];
    expect(S('domestic', 'fills', 'TTTC0081R', rows, []).reasons).toEqual(['summary_missing']);
    expect(S('domestic', 'fills', 'TTTC0081R', rows, [[domFillSummary(rows), domFillSummary(rows)]]).reasons).toEqual(['summary_multiple_rows']);
    expect(S('domestic', 'fills', 'TTTC0081R', rows, [domFillSummary(rows), domFillSummary(rows, { tot_ccld_qty: '9' })]).reasons).toEqual(['summary_inconsistent_across_pages']);
    expect(S('domestic', 'fills', 'TTTC0081R', rows, [domFillSummary(rows, { tot_ccld_amt: '' })]).reasons).toEqual(['summary_value_invalid:tot_ccld_amt']);
    expect(S('domestic', 'fills', 'TTTC0081R', [domFillRow({ tot_ccld_qty: '' })], [domFillSummary(rows)]).reasons).toEqual(['row_value_invalid:tot_ccld_qty']);
    expect(S('domestic', 'fills', 'TTTC0081R', rows, ['x']).reasons).toEqual(['summary_format']);
    expect(S('domestic', 'fills', 'TTTC0081R', rows, [[], null, [domFillSummary(rows)]]).result).toBe('match');   // 빈 블록은 건너뛴다
  });

  test('규칙표가 6개 조합을 덮는다', () => {
    expect(SUM_RULES.map((r) => `${r.market}/${r.kind}/${r.mode}`)).toEqual([
      'domestic/fills/exact', 'domestic/realized_pnl/exact', 'overseas/realized_pnl/exact',
      'domestic/position_snapshot/exact', 'overseas/position_snapshot/relative', 'overseas/fills/unavailable',
    ]);
  });
});

describe('run 완전성 판정 — DDL chk_bfr_complete 와 같은 조건(앱이 더 느슨하지 않다)', () => {
  const base: CompletenessInput = {
    market: 'domestic', kind: 'fills', sourceTr: 'TTTC0081R', fetchOutcome: 'ended', lastTrCont: 'E', sumCheck: 'match',
    duplicateKeys: 0, pages: 1, kisCalls: 1, normalizeIssues: 0,
  };
  const A = (o: Partial<CompletenessInput>) => assessRunCompleteness({ ...base, ...o });

  test('정상 → complete', () => expect(A({})).toEqual({ status: 'complete', reasons: [] }));
  test('fetch failed → failed', () => expect(A({ fetchOutcome: 'failed' }).status).toBe('failed'));

  test.each([
    [{ fetchOutcome: 'truncated' }, 'fetch_truncated'],
    [{ pages: 0 }, 'no_pages'],
    [{ kisCalls: 0 }, 'no_kis_calls'],
    [{ lastTrCont: null }, 'tr_cont_missing'],
    [{ lastTrCont: '' }, 'tr_cont_missing'],
    [{ lastTrCont: 'M' }, 'tr_cont_not_terminal'],
    [{ lastTrCont: 'F' }, 'tr_cont_not_terminal'],
    [{ lastTrCont: 'd' }, 'tr_cont_not_terminal'],
    [{ sumCheck: 'mismatch' }, 'sum_check_mismatch'],
    [{ sumCheck: 'pending' }, 'sum_check_pending'],
    [{ sumCheck: 'unavailable' }, 'sum_check_unavailable_not_allowed'],
    [{ duplicateKeys: 1 }, 'duplicate_keys'],
    [{ normalizeIssues: 2 }, 'normalize_failed'],
    [{ writeFailures: 1 }, 'write_failed'],
    [{ sourceTr: 'TTTS3035R' }, 'source_tr_mismatch'],
    [{ kind: 'realized_pnl' }, 'source_tr_mismatch'],
  ] as [Partial<CompletenessInput>, string][])('%p → incomplete(%s)', (o, reason) => {
    const r = A(o);
    expect(r.status).toBe('incomplete');
    expect(r.reasons).toContain(reason);
  });

  test('해외 체결 TTTS3035R 만 unavailable 허용', () => {
    expect(A({ market: 'overseas', kind: 'fills', sourceTr: 'TTTS3035R', sumCheck: 'unavailable', lastTrCont: 'D' }).status).toBe('complete');
    expect(A({ market: 'overseas', kind: 'realized_pnl', sourceTr: 'TTTS3039R', sumCheck: 'unavailable', lastTrCont: 'D' }).status).toBe('incomplete');
  });

  test('잔고 스냅샷(N-1): 빈 헤더 또는 D/E 허용, M/F·소문자 거부, 합계 대조는 그대로 요구', () => {
    const snap = { market: 'overseas', kind: 'position_snapshot', sourceTr: 'CTRP6504R' } as const;
    expect(A({ ...snap, lastTrCont: null }).status).toBe('complete');
    expect(A({ ...snap, lastTrCont: 'D' }).status).toBe('complete');
    expect(A({ ...snap, lastTrCont: 'M' }).status).toBe('incomplete');
    expect(A({ ...snap, lastTrCont: 'e' }).status).toBe('incomplete');
    expect(A({ ...snap, lastTrCont: null, sumCheck: 'mismatch' }).status).toBe('incomplete');
    expect(A({ market: 'domestic', kind: 'position_snapshot', sourceTr: 'TTTC8434R', lastTrCont: null }).status).toBe('complete');
  });

  test('모의 TR(V…)도 짝으로 인정, 짝 판정은 DDL LIKE 와 같다', () => {
    expect(sourceTrMatches('domestic', 'fills', 'VTTC0081R')).toBe(true);
    expect(sourceTrMatches('domestic', 'fills', 'CTSC9215R')).toBe(true);
    expect(sourceTrMatches('overseas', 'position_snapshot', 'VTRP6504R')).toBe(true);
    expect(sourceTrMatches('domestic', 'position_snapshot', 'CTRP6504R')).toBe(false);
    expect(sourceTrMatches('overseas', 'fills', 'TTTC0081R')).toBe(false);
    expect(sourceTrMatches('domestic', 'realized_pnl', 'TTTC8434R')).toBe(false);
  });
});

describe('창·조회 범위·85일·tr_cont·초기값', () => {
  test('해외 체결·기간손익은 창 ±1일, 국내 그대로, 스냅샷은 하루 창만', () => {
    expect(queryRangeForWindow('overseas', 'fills', '2026-11-01', '2026-11-07')).toEqual({ queryFrom: '2026-10-31', queryTo: '2026-11-08' });
    expect(queryRangeForWindow('overseas', 'realized_pnl', '2026-11-01', '2026-11-01')).toEqual({ queryFrom: '2026-10-31', queryTo: '2026-11-02' });
    expect(queryRangeForWindow('domestic', 'fills', '2026-11-01', '2026-11-07')).toEqual({ queryFrom: '2026-11-01', queryTo: '2026-11-07' });
    expect(queryRangeForWindow('overseas', 'position_snapshot', '2026-11-05', '2026-11-05')).toEqual({ queryFrom: '2026-11-05', queryTo: '2026-11-05' });
    expect(() => queryRangeForWindow('domestic', 'position_snapshot', '2026-11-04', '2026-11-05')).toThrow(RangeError);
    expect(() => queryRangeForWindow('domestic', 'fills', '2026-11-08', '2026-11-07')).toThrow(RangeError);
    expect(queryRangeForWindow('overseas', 'fills', '2026-12-31', '2026-12-31')).toEqual({ queryFrom: '2026-12-30', queryTo: '2027-01-01' });
  });

  test('85일 판정 — DDL 경계와 같고 어댑터의 경계와도 같다', () => {
    expect(withinDomesticFillsTrWindow('2026-08-12', '2026-11-05')).toBe(true);
    expect(withinDomesticFillsTrWindow('2026-08-11', '2026-11-05')).toBe(false);
    const now = Date.parse('2026-11-05T10:00:00+09:00');
    expect(domesticFillsEarliestFrom(now)).toBe('2026-08-12');
    for (const ms of [Date.parse('2026-03-01T00:00:00+09:00'), Date.parse('2026-12-31T23:59:59+09:00'), Date.parse('2028-02-29T12:00:00+09:00')]) {
      expect(kstDate(ms)).toBe(kstDateOf(ms));
      expect(withinDomesticFillsTrWindow(domesticFillsEarliestFrom(ms), kstDate(ms))).toBe(true);
      expect(withinDomesticFillsTrWindow(addDaysIso(domesticFillsEarliestFrom(ms), -1), kstDate(ms))).toBe(false);
      expect(addDaysIso(kstDate(ms), -85)).toBe(addDays(kstDateOf(ms), -85));
    }
  });

  test('KST 날짜 — UTC 자정 근처', () => {
    expect(kstDate(Date.parse('2026-11-05T14:59:59Z'))).toBe('2026-11-05');
    expect(kstDate(Date.parse('2026-11-05T15:00:00Z'))).toBe('2026-11-06');
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('1999-12-31')).toBe(false);
  });

  test('trContDbValue — 빈 헤더 NULL, 한 글자 그대로, 그 밖 NULL(완전성은 원문으로 판정)', () => {
    expect(trContDbValue('')).toBeNull();
    expect(trContDbValue(null)).toBeNull();
    expect(trContDbValue(' D ')).toBe('D');
    expect(trContDbValue('XY')).toBeNull();
    // 'XY' 를 NULL 로 바꿔 넣어도 스냅샷 complete 가 되지 않는다(판정은 원문)
    expect(assessRunCompleteness({
      market: 'overseas', kind: 'position_snapshot', sourceTr: 'CTRP6504R', fetchOutcome: 'ended', lastTrCont: 'XY', sumCheck: 'match',
      duplicateKeys: 0, pages: 1, kisCalls: 1, normalizeIssues: 0,
    }).status).toBe('incomplete');
  });

  test('positive_check 초기값 — 스냅샷 n/a, 그 밖 pending(confirmed 는 D2 만)', () => {
    expect(initialPositiveCheck('position_snapshot')).toBe('n/a');
    expect(initialPositiveCheck('fills')).toBe('pending');
    expect(initialPositiveCheck('realized_pnl')).toBe('pending');
  });

  test('수수료 추정은 해외 USD 만', () => {
    expect(estimateFee('domestic', 'KRW', parseDec('50000')!)).toBeNull();
    expect(estimateFee('overseas', 'KRW', parseDec('50000')!)).toBeNull();
    expect(estimateFee('overseas', 'USD', 0n)).toEqual({ fee_kind: 'estimated', fee_native: '0.000000', fee_rate_pct: '0.25000' });
  });

  test('runErrorText — 사유 코드 이어 붙이고 500자 자름', () => {
    expect(runErrorText(['a', null, '', 'b'])).toBe('a; b');
    expect(runErrorText([])).toBeNull();
    expect(Array.from(runErrorText(['가'.repeat(600)])!).length).toBe(500);
  });
});
