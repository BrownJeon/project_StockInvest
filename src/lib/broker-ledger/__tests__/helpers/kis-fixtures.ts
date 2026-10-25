/**
 * T-087 — KIS 원장 응답 **합성** 픽스처. 필드 이름·값 형식(문자열 정수/소수, YYYYMMDD, HHMMSS)만 2026-10-25 S00 캡처를 따랐고
 * **값은 전부 지어낸 것**이다(주문번호 `0000012345` 류, 종목 `XMPL`·`900010` 류, 금액·수량 임의). 실제 계좌·종목·금액은 없다.
 * 민감 필드(`ctac_tlno`·`inqr_ip_addr`·`ordr_empno`·계좌 키)도 가짜 값으로 넣어 제거를 시험한다.
 */
type Row = Record<string, unknown>;

/** 국내 체결 TTTC0081R output1 행 */
export function domFillRow(o: Row = {}): Row {
  return {
    ord_dt: '20261103', ord_gno_brno: '00000', odno: '0000012345', orgn_odno: '', ord_dvsn_name: '지정가',
    sll_buy_dvsn_cd: '02', sll_buy_dvsn_cd_name: '매수', pdno: '900010', prdt_name: '합성종목',
    ord_qty: '5', ord_unpr: '10000', ord_tmd: '093015', tot_ccld_qty: '5', avg_prvs: '10000', cncl_yn: '',
    tot_ccld_amt: '50000', loan_dt: '', ordr_empno: 'E0000', ord_dvsn_cd: '00', cncl_cfrm_qty: '0', rmn_qty: '0',
    rjct_qty: '0', ccld_cndt_name: '없음', inqr_ip_addr: '10.0.0.1', cpbc_ordp_ord_rcit_dvsn_cd: '', cpbc_ordp_infm_mthd_dvsn_cd: '',
    infm_tmd: '', ctac_tlno: '01000000000', prdt_type_cd: '300', excg_dvsn_cd: '12', cpbc_ordp_mtrl_dvsn_cd: '0',
    ord_orgno: '00000', rsvn_ord_end_dt: '', excg_id_dvsn_cd: 'SOR', stpm_cndt_pric: '0', stpm_efct_occr_dtmd: '',
    ...o,
  };
}

/** 국내 체결 요약 output2 */
export function domFillSummary(rows: Row[], o: Row = {}): Row {
  const sum = (k: string) => String(rows.reduce((a, r) => a + Number(r[k]), 0));
  return { tot_ord_qty: sum('ord_qty'), tot_ccld_qty: sum('tot_ccld_qty'), tot_ccld_amt: sum('tot_ccld_amt'), prsm_tlex_smtl: '0', pchs_avg_pric: '0.0000', ...o };
}

/** 해외 체결 TTTS3035R output 행 */
export function ovsFillRow(o: Row = {}): Row {
  return {
    ord_dt: '20261102', ord_gno_brno: '00000', odno: '0000012345', orgn_odno: '', sll_buy_dvsn_cd: '02', sll_buy_dvsn_cd_name: '매수',
    rvse_cncl_dvsn: '00', rvse_cncl_dvsn_name: '', pdno: 'XMPL', prdt_name: 'EXAMPLE CORP',
    ft_ord_qty: '3', ft_ord_unpr3: '101.23450', ft_ccld_qty: '3', ft_ccld_unpr3: '101.23450', ft_ccld_amt3: '303.70350',
    nccs_qty: '0', prcs_stat_name: '완료', rjct_rson: '', rjct_rson_name: '', ord_tmd: '233015', tr_mket_name: '나스닥',
    tr_crcy_cd: 'USD', tr_natn: '840', ovrs_excg_cd: 'NASD', tr_natn_name: '미국', dmst_ord_dt: '20261103', thco_ord_tmd: '233015',
    loan_type_cd: '00', loan_dt: '', mdia_dvsn_name: '모바일', usa_amk_exts_rqst_yn: 'N', splt_buy_attr_name: '',
    ...o,
  };
}

/** 국내 기간손익 TTTC8708R output1 행(일별 합산) */
export function domPnlRow(o: Row = {}): Row {
  return {
    trad_dt: '20261104', buy_amt: '0', sll_amt: '1234000', rlzt_pfls: '-5600', fee: '185', loan_int: '0', tl_tax: '2221',
    pfls_rt: '-0.45', sll_qty1: '10', buy_qty1: '0', ...o,
  };
}

export function domPnlSummary(rows: Row[], o: Row = {}): Row {
  const sum = (k: string) => String(rows.reduce((a, r) => a + Number(r[k]), 0));
  return {
    sll_qty_smtl: sum('sll_qty1'), sll_tr_amt_smtl: sum('sll_amt'), sll_fee_smtl: '0', sll_tltx_smtl: sum('tl_tax'), sll_excc_amt_smtl: '0',
    buy_qty_smtl: sum('buy_qty1'), buy_tr_amt_smtl: sum('buy_amt'), buy_fee_smtl: '0', buy_tax_smtl: '0', buy_excc_amt_smtl: '0',
    tot_qty: '0', tot_tr_amt: '0', tot_fee: sum('fee'), tot_tltx: sum('tl_tax'), tot_excc_amt: '0', tot_rlzt_pfls: sum('rlzt_pfls'),
    loan_int: '0', ...o,
  };
}

/** 해외 기간손익 TTTS3039R output1 행(종목·일별 매도) */
export function ovsPnlRow(o: Row = {}): Row {
  return {
    trad_day: '20261110', ovrs_pdno: 'XMPL', ovrs_item_name: 'EXAMPLE CORP', slcl_qty: '3', pchs_avg_pric: '101.2345',
    frcr_pchs_amt1: '303.70350', avg_sll_unpr: '99.00000000', frcr_sll_amt_smtl1: '297.000000', stck_sll_tlex: '0.7425',
    ovrs_rlzt_pfls_amt: '-7.44600', pftrt: '-2.4517', exrt: '1400.0000000000', ovrs_excg_cd: 'NASD', frst_bltn_exrt: '1401.5000000000',
    ...o,
  };
}

/** 소수 자리를 지키는 문자열 합(시험용 — 합성 값만). */
function decSum(rows: Row[], k: string, places: number): string {
  const f = 10 ** places;
  return (rows.reduce((a, r) => a + Math.round(Number(r[k]) * f), 0) / f).toFixed(places);
}

export function ovsPnlSummary(rows: Row[], o: Row = {}): Row {
  return {
    stck_sll_amt_smtl: decSum(rows, 'frcr_sll_amt_smtl1', 6), stck_buy_amt_smtl: decSum(rows, 'frcr_pchs_amt1', 5), smtl_fee1: '0.0000',
    excc_dfrm_amt: '0.0000', ovrs_rlzt_pfls_tot_amt: decSum(rows, 'ovrs_rlzt_pfls_amt', 5), tot_pftrt: '0.0000', bass_dt: '', exrt: '1400.0000',
    ...o,
  };
}

/** 국내 잔고 TTTC8434R output1 행 */
export function domPosRow(o: Row = {}): Row {
  return {
    pdno: '900010', prdt_name: '합성종목', trad_dvsn_name: '현금', bfdy_buy_qty: '0', bfdy_sll_qty: '0', thdt_buyqty: '0', thdt_sll_qty: '0',
    hldg_qty: '7', ord_psbl_qty: '7', pchs_avg_pric: '10000.0000', pchs_amt: '70000', prpr: '10500', evlu_amt: '73500',
    evlu_pfls_amt: '3500', evlu_pfls_rt: '5.00', evlu_erng_rt: '0.00000000', loan_dt: '', loan_amt: '0', stln_slng_chgs: '0', expd_dt: '',
    fltt_rt: '0.00000000', bfdy_cprs_icdc: '0', item_mgna_rt_name: '', grta_rt_name: '', sbst_pric: '0', stck_loan_unpr: '0.0000',
    ...o,
  };
}

export function domPosSummary(rows: Row[], o: Row = {}): Row[] {
  const sum = (k: string) => String(rows.reduce((a, r) => a + Number(r[k]), 0));
  return [{ dnca_tot_amt: '0', pchs_amt_smtl_amt: sum('pchs_amt'), evlu_amt_smtl_amt: sum('evlu_amt'), evlu_pfls_smtl_amt: '0', ...o }];
}

/** 해외 잔고 CTRP6504R output1 행 */
export function ovsPosRow(o: Row = {}): Row {
  return {
    prdt_name: 'EXAMPLE CORP', cblc_qty13: '3.00000000', thdt_buy_ccld_qty1: '0.00000000', thdt_sll_ccld_qty1: '0.00000000',
    ccld_qty_smtl1: '3.00000000', ord_psbl_qty1: '3.00000000', frcr_pchs_amt: '303.70350', frcr_evlu_amt2: '310.500000',
    evlu_pfls_amt2: '6.796500', evlu_pfls_rt1: '2.24', pdno: 'XMPL', bass_exrt: '1400.00000000', buy_crcy_cd: 'USD',
    ovrs_now_pric1: '103.50000000', avg_unpr3: '101.2345', tr_mket_name: '나스닥', natn_kor_name: '미국', pchs_rmnd_wcrc_amt: '0',
    thdt_buy_ccld_frcr_amt: '0.000000', thdt_sll_ccld_frcr_amt: '0.000000', unit_amt: '1', std_pdno: 'US0000000000', prdt_type_cd: '512',
    scts_dvsn_name: '', loan_rmnd: '0', loan_dt: '', loan_expd_dt: '', ovrs_excg_cd: 'NASD', item_lnkg_excg_cd: 'NAS', prdt_dvsn: '01',
    ...o,
  };
}

export function ovsPosSummary3(evluAmtSmtl: string, o: Row = {}): Row {
  return { pchs_amt_smtl: '0', evlu_amt_smtl: evluAmtSmtl, evlu_pfls_amt_smtl: '0', dncl_amt: '0', frcr_evlu_tota: '0', tot_asst_amt: '0', ...o };
}
