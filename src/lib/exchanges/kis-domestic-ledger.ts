/**
 * T-087 (T-081 WP-D1a) — 국내 브로커 원장 조회 3종(**읽기 전용 GET**). `kis-domestic.ts` 가 재노출한다.
 *
 *  - {@link getDailyOrderFills}  TTTC0081R(실전)/VTTC0081R(모의) inquire-daily-ccld — **전 종목·체결+미체결 전체**, 연속조회 추적
 *  - {@link getPeriodProfit}     TTTC8708R/VTTC8708R — 일별 합산 기간손익(종목 없음, `fee`=매수+매도 합·`tl_tax`=매도만)
 *  - {@link getPositionSnapshot} TTTC8434R/VTTC8434R inquire-balance — **조회일(오늘) 잔고**(기준일 파라미터 없음)
 *
 * 공통 규칙(연속조회·상한·실패 의미·민감정보)은 `kis-ledger-query.ts` 머리 주석. 기존 `getCompletedOrders`·`getBalances` 는
 * 바꾸지 않았다 — 이 함수들은 order-sync·킬스위치·스냅샷 경로에서 쓰지 않는다.
 *
 * 요청 형태 근거: 2026-10-25 S00 읽기 전용 캡처(필드 이름·`tr_cont` 신호만 사용, 값은 옮기지 않음).
 *  - 체결: 캡처의 TTTC0081R + `EXCG_ID_DVSN_CD=ALL` + `PDNO=''` 요청과 같다. 차이는 `CCLD_DVSN='00'`(전체) — 설계 §2.3 "체결 0 행도 저장"
 *    `[가능성 높음 — 캡처는 01·00 이 같은 행 수였고 취소가 없던 날이라 차이를 보지 못했다, 첫 라이브 확인 ⑤]`.
 *  - 기간손익: 캡처가 TTTC8708R 응답(일별 합산 필드)을 받은 **경로·파라미터 조합 그대로**다(`inquire-period-trade-profit`).
 *    `[미확인 — KIS 문서상 TTTC8708R 의 경로가 inquire-period-profit 일 가능성. 캡처로 동작이 확인된 조합을 바꾸지 않았다]`
 *  - 잔고: 기존 `getBalances` 와 같은 파라미터. 연속조회는 CTX_AREA_FK100/NK100 로 따라간다(보유가 한 페이지를 넘는 경우).
 */
import {
  runLedgerQuery, LEDGER_TIMEOUT_MS, skippedLedgerResult, ledgerTrId, ledgerIsMock, assertQueryRange, toKisDate, addDays, kstDateOf,
  type LedgerQueryOptions, type LedgerQueryResult, type LedgerQuerySpec, type LedgerContinuation,
} from './kis-ledger-query';
import { kisFetch } from './kis-http';

const CTX100: LedgerContinuation = {
  requestFk: 'CTX_AREA_FK100', requestNk: 'CTX_AREA_NK100',
  responseFk: 'ctx_area_fk100', responseNk: 'ctx_area_nk100',
};

/**
 * 국내 3개월 이내 TR(TTTC0081R) 로 조회할 수 있는 가장 이른 시작일 = 조회일(KST) − 85일.
 * DDL `chk_bfr_3m_tr`(`query_from >= DATE(started_at) - INTERVAL 85 DAY`)와 같은 경계다(설계 L-3: 달력 3개월 89~92일에 7일 여유).
 */
export const DOMESTIC_FILLS_TR_WINDOW_DAYS = 85;

export function domesticFillsEarliestFrom(nowMs: number): string {
  return addDays(kstDateOf(nowMs), -DOMESTIC_FILLS_TR_WINDOW_DAYS);
}

/**
 * 국내 주문체결 원장 조회(전 종목·전체). `from`/`to` 는 **실제로 보낼** KST 날짜 `YYYY-MM-DD`(양끝 포함).
 * `from` 이 85일 경계보다 이르면 KIS 를 부르지 않고 `skipped`(L-c — 수집기는 run 행을 쓰지 않고 그 창은 CTSC9215R 로 따로).
 * 날짜 형식 오류는 프로그램 오류라 던진다. 그 밖의 실패는 던지지 않고 결과로 돌려준다.
 */
export async function getDailyOrderFills(
  q: { from: string; to: string }, opts: LedgerQueryOptions,
): Promise<LedgerQueryResult> {
  assertQueryRange(q.from, q.to);
  const mock = ledgerIsMock();
  const spec: LedgerQuerySpec = {
    market: 'domestic', kind: 'fills',
    trId: ledgerTrId('TTTC0081R', 'VTTC0081R'),
    path: '/uapi/domestic-stock/v1/trading/inquire-daily-ccld',
    fetchPage: (url, headers) => kisFetch(url, { headers }, { priority: 'bulk', timeoutMs: LEDGER_TIMEOUT_MS, label: 'domestic ledgerDailyFills' }),
    params: {
      INQR_STRT_DT:    toKisDate(q.from),
      INQR_END_DT:     toKisDate(q.to),
      SLL_BUY_DVSN_CD: '00',   // 전체
      INQR_DVSN:       '00',   // 역순
      PDNO:            '',     // 전 종목
      CCLD_DVSN:       '00',   // 전체(체결 + 미체결 — 체결 0 행도 저장한다)
      ORD_GNO_BRNO:    '',
      ODNO:            '',
      INQR_DVSN_3:     '00',
      INQR_DVSN_1:     '',
      CTX_AREA_FK100:  '',
      CTX_AREA_NK100:  '',
      EXCG_ID_DVSN_CD: mock ? 'KRX' : 'ALL',   // 현행 TR 필수 — 모의는 KRX 만 지원(기존 getCompletedOrders 와 같음)
    },
    rowsKey: 'output1', rowsFallbackKey: 'output', summaryKey: 'output2',
    continuation: CTX100,
    queryFrom: q.from, queryTo: q.to,
  };
  const nowMs = (opts.now ?? Date.now)();
  if (q.from < domesticFillsEarliestFrom(nowMs)) return skippedLedgerResult(spec, 'outside_tr_window');
  return runLedgerQuery(spec, opts);
}

/** 국내 기간손익(일별 합산) 조회. `from`/`to` 는 보낼 KST 날짜. */
export async function getPeriodProfit(
  q: { from: string; to: string }, opts: LedgerQueryOptions,
): Promise<LedgerQueryResult> {
  assertQueryRange(q.from, q.to);
  return runLedgerQuery({
    market: 'domestic', kind: 'realized_pnl',
    trId: ledgerTrId('TTTC8708R', 'VTTC8708R'),
    path: '/uapi/domestic-stock/v1/trading/inquire-period-trade-profit',
    fetchPage: (url, headers) => kisFetch(url, { headers }, { priority: 'bulk', timeoutMs: LEDGER_TIMEOUT_MS, label: 'domestic ledgerPeriodProfit' }),
    params: {
      SORT_DVSN:      '00',
      INQR_STRT_DT:   toKisDate(q.from),
      INQR_END_DT:    toKisDate(q.to),
      CBLC_DVSN:      '00',
      PDNO:           '',
      CTX_AREA_FK100: '',
      CTX_AREA_NK100: '',
    },
    rowsKey: 'output1', summaryKey: 'output2',
    continuation: CTX100,
    queryFrom: q.from, queryTo: q.to,
  }, opts);
}

/** 국내 잔고 스냅샷(조회일 = 오늘 KST). 기존 `getBalances` 와 달리 **원문 행 전부**(보유 0 행 포함)와 요약을 돌려준다. */
export async function getPositionSnapshot(opts: LedgerQueryOptions): Promise<LedgerQueryResult> {
  const today = kstDateOf((opts.now ?? Date.now)());
  return runLedgerQuery({
    market: 'domestic', kind: 'position_snapshot',
    trId: ledgerTrId('TTTC8434R', 'VTTC8434R'),
    path: '/uapi/domestic-stock/v1/trading/inquire-balance',
    fetchPage: (url, headers) => kisFetch(url, { headers }, { priority: 'bulk', timeoutMs: LEDGER_TIMEOUT_MS, label: 'domestic ledgerPositions' }),
    params: {
      AFHR_FLPR_YN: 'N', OFL_YN: '', INQR_DVSN: '02', UNPR_DVSN: '01', FUND_STTL_ICLD_YN: 'N',
      FNCG_AMT_AUTO_RDPT_YN: 'N', PRCS_DVSN: '01', CTX_AREA_FK100: '', CTX_AREA_NK100: '',
    },
    rowsKey: 'output1', summaryKey: 'output2',
    continuation: CTX100,
    queryFrom: today, queryTo: today,
  }, opts);
}
