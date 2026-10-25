/**
 * T-087 (T-081 WP-D1a) — 해외 브로커 원장 조회 3종(**읽기 전용 GET**). `kis-overseas.ts` 가 재노출한다.
 *
 *  - {@link getDailyOrderFills}  TTTS3035R(실전)/VTTS3035R(모의) inquire-ccnl — **전 거래소(`%`)·전 종목·체결+미체결 전체**, 요약 블록 없음
 *  - {@link getPeriodProfit}     TTTS3039R/VTTS3039R inquire-period-profit — 종목·일별 매도 실현손익(원가·매도 제비용·환율 포함)
 *  - {@link getPositionSnapshot} CTRP6504R/VTRP6504R inquire-present-balance — 조회일 잔고(비연속 TR — `tr_cont` 헤더가 빈 값)
 *
 * 공통 규칙은 `kis-ledger-query.ts` 머리 주석. 기존 `getCompletedOrders`·`getBalances`·`getUsdCash` 는 바꾸지 않았다.
 *
 * 요청 형태 근거: 2026-10-25 S00 읽기 전용 캡처(필드 이름·`tr_cont` 신호만). 해외 체결은 캡처와 같고 `CCLD_NCCS_DVSN='00'`(전체)만 다르다
 * (설계 §2.3, 첫 라이브 확인 ⑤). 기간손익·잔고는 캡처 파라미터 그대로.
 *
 * 🔴 미확인 가정(설계 §3.8 — 추측으로 채우지 않고 fail-closed):
 *  - 해외 체결 조회의 **기간 한도**(③) — 한도를 모르므로 이 함수는 범위를 자르지 않는다. KIS 가 거절하면 rt_cd≠0 → failed.
 *  - 조회 날짜 기준(현지/KST, ④) — 호출자가 창 ±1일 여유를 둔 조회 범위를 넘긴다(`queryRangeForWindow`). runs.date_basis 는 unknown.
 *  - TTTS3039R 연속조회의 **응답** 키 이름(⑦) — 캡처가 ctx 필드를 저장하지 않았다. 요청 이름(CTX_AREA_FK200/NK200)은 캡처 요청과 같고,
 *    응답에서 `ctx_area_fk200`/`ctx_area_nk200`(또는 대문자)를 찾는다. **없으면 다음 페이지를 지어내지 않고 truncated(`continuation_key_missing`)**.
 *  - 해외 잔고(CTRP6504R)는 연속조회 파라미터가 없다 — `tr_cont` 가 M/F 로 오면 truncated(`continuation_unsupported`).
 */
import {
  runLedgerQuery, LEDGER_TIMEOUT_MS, ledgerTrId, assertQueryRange, toKisDate, kstDateOf,
  type LedgerQueryOptions, type LedgerQueryResult, type LedgerContinuation,
} from './kis-ledger-query';
import { kisFetch } from './kis-http';

const CTX200: LedgerContinuation = {
  requestFk: 'CTX_AREA_FK200', requestNk: 'CTX_AREA_NK200',
  responseFk: 'ctx_area_fk200', responseNk: 'ctx_area_nk200',
};

/** 해외 주문체결 원장 조회(전 거래소·전 종목·전체). `from`/`to` 는 보낼 KST 날짜(창 ±1일 여유는 호출자가 넣는다). */
export async function getDailyOrderFills(
  q: { from: string; to: string }, opts: LedgerQueryOptions,
): Promise<LedgerQueryResult> {
  assertQueryRange(q.from, q.to);
  return runLedgerQuery({
    market: 'overseas', kind: 'fills',
    trId: ledgerTrId('TTTS3035R', 'VTTS3035R'),
    path: '/uapi/overseas-stock/v1/trading/inquire-ccnl',
    fetchPage: (url, headers) => kisFetch(url, { headers }, { priority: 'bulk', timeoutMs: LEDGER_TIMEOUT_MS, label: 'overseas ledgerDailyFills' }),
    params: {
      OVRS_EXCG_CD:   '%',    // 전 거래소
      PDNO:           '',     // 전 종목
      ORD_STRT_DT:    toKisDate(q.from),
      ORD_END_DT:     toKisDate(q.to),
      SLL_BUY_DVSN:   '00',   // 전체
      CCLD_NCCS_DVSN: '00',   // 전체(체결 + 미체결)
      SORT_SQN:       'DS',
      CTX_AREA_FK200: '',
      CTX_AREA_NK200: '',
    },
    rowsKey: 'output',
    continuation: CTX200,
    queryFrom: q.from, queryTo: q.to,
  }, opts);
}

/** 해외 기간손익(종목·일별 매도) 조회. `from`/`to` 는 보낼 KST 날짜. 첫 페이지부터 `tr_cont=M` 일 수 있다(캡처) — 연속조회 필수. */
export async function getPeriodProfit(
  q: { from: string; to: string }, opts: LedgerQueryOptions,
): Promise<LedgerQueryResult> {
  assertQueryRange(q.from, q.to);
  return runLedgerQuery({
    market: 'overseas', kind: 'realized_pnl',
    trId: ledgerTrId('TTTS3039R', 'VTTS3039R'),
    path: '/uapi/overseas-stock/v1/trading/inquire-period-profit',
    fetchPage: (url, headers) => kisFetch(url, { headers }, { priority: 'bulk', timeoutMs: LEDGER_TIMEOUT_MS, label: 'overseas ledgerPeriodProfit' }),
    params: {
      OVRS_EXCG_CD:      '',
      NATN_CD:           '',
      CRCY_CD:           '',
      PDNO:              '',
      INQR_STRT_DT:      toKisDate(q.from),
      INQR_END_DT:       toKisDate(q.to),
      WCRC_FRCR_DVSN_CD: '01',
      CTX_AREA_FK200:    '',
      CTX_AREA_NK200:    '',
    },
    rowsKey: 'output1', summaryKey: 'output2',
    continuation: CTX200,
    queryFrom: q.from, queryTo: q.to,
  }, opts);
}

/** 해외 잔고 스냅샷(조회일 = 오늘 KST, 미국 전체). 합계 대조용 요약은 output3(설계 §3.4 — `evlu_amt_smtl`). */
export async function getPositionSnapshot(opts: LedgerQueryOptions): Promise<LedgerQueryResult> {
  const today = kstDateOf((opts.now ?? Date.now)());
  return runLedgerQuery({
    market: 'overseas', kind: 'position_snapshot',
    trId: ledgerTrId('CTRP6504R', 'VTRP6504R'),
    path: '/uapi/overseas-stock/v1/trading/inquire-present-balance',
    fetchPage: (url, headers) => kisFetch(url, { headers }, { priority: 'bulk', timeoutMs: LEDGER_TIMEOUT_MS, label: 'overseas ledgerPositions' }),
    params: {
      WCRC_FRCR_DVSN_CD: '02',   // 외화
      NATN_CD:           '840',  // 미국
      TR_MKET_CD:        '00',   // 전체
      INQR_DVSN_CD:      '00',   // 전체
    },
    rowsKey: 'output1', summaryKey: 'output3',
    queryFrom: today, queryTo: today,
  }, opts);
}
