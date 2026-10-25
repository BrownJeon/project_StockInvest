/**
 * T-087 (T-081 WP-D1a) — 브로커 원장 조회 어댑터 6종(국내·해외 × 체결·기간손익·잔고) 시험. **KIS 실호출 없음**(kisFetch·인증·자격증명 모킹).
 *
 * 고정하는 것(설계 §3.5·§3.6):
 *  1. 요청 형태 — TR ID(실전/모의)·경로·전 종목/전 거래소·전체(체결+미체결)·KST 날짜·`bulk`·타임아웃 20초·코드 상수 label
 *  2. 연속조회 — tr_cont M/F 면 응답 ctx 키를 다음 요청에 넣고 `tr_cont:N` 헤더, D/E/빈 헤더면 끝. 행·요약은 페이지 순서대로 모은다
 *  3. fail-closed — 첫 페이지 실패 = failed(행 0) / 이후 실패 = truncated(받은 행 유지) / 페이지 상한·호출 상한·시간 예산·연속 키 없음·정체·
 *     모르는 tr_cont·연속조회 미지원 TR 의 M → truncated / 레이트리밋 → 추가 재시도 없이 멈춤 / 85일 밖 국내 체결 → KIS 를 부르지 않음(skipped)
 *  4. 계좌 원문이 결과·오류 문자열에 나오지 않는다 / 지문 키가 없으면 KIS 를 부르지 않는다
 * 픽스처 값은 전부 합성이다.
 */
const kisFetchMock = jest.fn();
const rateLimited = new WeakSet<Response>();
const attempts = new WeakMap<Response, number>();

jest.mock('@/lib/exchanges/kis-http', () => {
  const actual = jest.requireActual('@/lib/exchanges/kis-http');
  return {
    ...actual,
    kisFetch: (...a: unknown[]) => kisFetchMock(...a),
    isKisRateLimited: (r: Response) => rateLimited.has(r),
    kisAttempts: (r: Response) => attempts.get(r) ?? 1,
  };
});
jest.mock('@/lib/exchanges/kis-auth', () => ({
  getKisToken:        jest.fn(async () => 'test-token'),
  invalidateKisToken: jest.fn(async () => 'test-token'),
  kisBaseUrl:         () => 'https://kis.example',
}));
const credMock = jest.fn(async (k: string): Promise<string> => (k === 'KIS_ACCOUNT_NO' ? '99887766' : k === 'KIS_ACCOUNT_PRODUCT' ? '01' : 'x'));
jest.mock('@/lib/credentials', () => ({ getCredential: (k: string) => credMock(k) }));

import * as dom from '@/lib/exchanges/kis-domestic';
import * as ovs from '@/lib/exchanges/kis-overseas';
import * as domLedger from '@/lib/exchanges/kis-domestic-ledger';
import * as ovsLedger from '@/lib/exchanges/kis-overseas-ledger';
import { invalidateKisToken } from '@/lib/exchanges/kis-auth';
import { LEDGER_MAX_PAGES, LEDGER_MAX_CALLS, type LedgerQueryOptions } from '@/lib/exchanges/kis-ledger-query';
import { domFillRow, domFillSummary, ovsFillRow, domPnlRow, domPnlSummary, ovsPnlRow, ovsPnlSummary, domPosRow, domPosSummary, ovsPosRow, ovsPosSummary3 } from '@/lib/broker-ledger/__tests__/helpers/kis-fixtures';

const FP = '0123456789abcdef';
/** KST 2026-11-05 10:00 */
const NOW = Date.parse('2026-11-05T10:00:00+09:00');
const opts = (o: Partial<LedgerQueryOptions> = {}): LedgerQueryOptions => ({ fingerprint: () => FP, now: () => NOW, ...o });

function page(body: unknown, trCont: string | null = 'D', status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: trCont === null ? {} : { tr_cont: trCont } });
}
function call(n = 0): { url: URL; headers: Record<string, string>; opts: { priority?: string; timeoutMs?: number; label?: string } } {
  const [u, init, o] = kisFetchMock.mock.calls[n] as [string, { headers: Record<string, string> }, { priority?: string; timeoutMs?: number; label?: string }];
  return { url: new URL(u), headers: init.headers, opts: o };
}

const ORIG_MOCK = process.env.KIS_MOCK;
beforeEach(() => {
  kisFetchMock.mockReset();
  credMock.mockClear();
  (invalidateKisToken as jest.Mock).mockClear();
  process.env.KIS_MOCK = 'false';
});
afterAll(() => {
  if (ORIG_MOCK === undefined) delete process.env.KIS_MOCK; else process.env.KIS_MOCK = ORIG_MOCK;
});

describe('재노출 — kis-domestic / kis-overseas 에서 같은 함수가 보인다(기존 export 는 그대로)', () => {
  test('국내 3종·해외 3종', () => {
    expect(dom.getDailyOrderFills).toBe(domLedger.getDailyOrderFills);
    expect(dom.getPeriodProfit).toBe(domLedger.getPeriodProfit);
    expect(dom.getPositionSnapshot).toBe(domLedger.getPositionSnapshot);
    expect(ovs.getDailyOrderFills).toBe(ovsLedger.getDailyOrderFills);
    expect(ovs.getPeriodProfit).toBe(ovsLedger.getPeriodProfit);
    expect(ovs.getPositionSnapshot).toBe(ovsLedger.getPositionSnapshot);
    // 기존 함수가 사라지거나 바뀌지 않았다(형태만 — 동작은 기존 시험 파일들이 고정)
    for (const f of ['getCompletedOrders', 'getBalances', 'getActiveOrders', 'createOrder', 'cancelOrder', 'getTicker']) {
      expect(typeof (dom as Record<string, unknown>)[f]).toBe('function');
      expect(typeof (ovs as Record<string, unknown>)[f]).toBe('function');
    }
    expect(typeof ovs.getUsdCash).toBe('function');
  });
});

describe('국내 체결 getDailyOrderFills — 요청 형태', () => {
  test('실전: TTTC0081R · 전 종목 · 전체(00) · ALL · KST 날짜 · bulk · 20초 · label', async () => {
    const rows = [domFillRow()];
    kisFetchMock.mockResolvedValue(page({ rt_cd: '0', output1: rows, output2: domFillSummary(rows) }, 'E'));
    const r = await dom.getDailyOrderFills({ from: '2026-10-29', to: '2026-11-05' }, opts());
    const c = call();
    expect(c.url.pathname).toBe('/uapi/domestic-stock/v1/trading/inquire-daily-ccld');
    expect(c.headers.tr_id).toBe('TTTC0081R');
    expect(c.headers.tr_cont).toBeUndefined();   // 첫 페이지는 연속조회 헤더 없음
    const q = c.url.searchParams;
    expect(Object.fromEntries(q)).toEqual({
      CANO: '99887766', ACNT_PRDT_CD: '01', INQR_STRT_DT: '20261029', INQR_END_DT: '20261105',
      SLL_BUY_DVSN_CD: '00', INQR_DVSN: '00', PDNO: '', CCLD_DVSN: '00', ORD_GNO_BRNO: '', ODNO: '', INQR_DVSN_3: '00', INQR_DVSN_1: '',
      CTX_AREA_FK100: '', CTX_AREA_NK100: '', EXCG_ID_DVSN_CD: 'ALL',
    });
    expect(c.opts).toEqual({ priority: 'bulk', timeoutMs: 20_000, label: 'domestic ledgerDailyFills' });
    expect(r).toMatchObject({
      market: 'domestic', kind: 'fills', trId: 'TTTC0081R', queryFrom: '2026-10-29', queryTo: '2026-11-05',
      outcome: 'ended', error: null, pages: 1, kisCalls: 1, lastTrCont: 'E', rateLimited: false, accountFingerprint: FP,
    });
    expect(r.rows).toEqual(rows);
    expect(r.summaries).toEqual([domFillSummary(rows)]);
    expect(JSON.stringify(r)).not.toContain('99887766');   // 계좌 원문은 결과에 없다
  });

  test('모의: VTTC0081R + KRX', async () => {
    process.env.KIS_MOCK = 'true';
    kisFetchMock.mockResolvedValue(page({ rt_cd: '0', output1: [], output2: domFillSummary([]) }, 'E'));
    const r = await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts());
    expect(call().headers.tr_id).toBe('VTTC0081R');
    expect(call().url.searchParams.get('EXCG_ID_DVSN_CD')).toBe('KRX');
    expect(r.trId).toBe('VTTC0081R');
  });

  test('날짜 형식 오류·역순 창은 던지고 KIS 를 부르지 않는다', async () => {
    await expect(dom.getDailyOrderFills({ from: '20261101', to: '2026-11-05' }, opts())).rejects.toThrow(RangeError);
    await expect(dom.getDailyOrderFills({ from: '2026-11-06', to: '2026-11-05' }, opts())).rejects.toThrow(RangeError);
    await expect(dom.getDailyOrderFills({ from: '2026-02-30', to: '2026-11-05' }, opts())).rejects.toThrow(RangeError);
    expect(kisFetchMock).not.toHaveBeenCalled();
  });

  test('85일 경계(L-c): 조회일−85일은 부르고, −86일은 KIS 를 부르지 않고 skipped(행·호출 0)', async () => {
    kisFetchMock.mockResolvedValue(page({ rt_cd: '0', output1: [], output2: domFillSummary([]) }, 'E'));
    const ok = await dom.getDailyOrderFills({ from: '2026-08-12', to: '2026-08-31' }, opts());   // 11-05 − 85일 = 08-12
    expect(ok.outcome).toBe('ended');
    expect(kisFetchMock).toHaveBeenCalledTimes(1);
    const credCalls = credMock.mock.calls.length;
    const sk = await dom.getDailyOrderFills({ from: '2026-08-11', to: '2026-08-31' }, opts());
    expect(sk).toMatchObject({ outcome: 'skipped', error: 'outside_tr_window', kisCalls: 0, pages: 0, rows: [] });
    expect(kisFetchMock).toHaveBeenCalledTimes(1);
    expect(credMock.mock.calls.length).toBe(credCalls);   // skipped 는 자격증명도 읽지 않는다
  });
});

describe('연속조회(tr_cont M/F → 다음 페이지, D/E/빈 헤더 → 끝)', () => {
  test('M → F → D: ctx 키를 넘기고 tr_cont:N, 행·요약을 순서대로 모은다', async () => {
    const r1 = [domFillRow({ odno: '0000010001' })], r2 = [domFillRow({ odno: '0000010002' })], r3 = [domFillRow({ odno: '0000010003' })];
    const all = [...r1, ...r2, ...r3];
    kisFetchMock
      .mockResolvedValueOnce(page({ rt_cd: '0', output1: r1, output2: domFillSummary(all), ctx_area_fk100: 'FK1', ctx_area_nk100: 'NK1' }, 'M'))
      .mockResolvedValueOnce(page({ rt_cd: '0', output1: r2, output2: domFillSummary(all), ctx_area_fk100: 'FK2', ctx_area_nk100: 'NK2' }, 'F'))
      .mockResolvedValueOnce(page({ rt_cd: '0', output1: r3, output2: domFillSummary(all), ctx_area_fk100: '', ctx_area_nk100: '' }, 'D'));
    const r = await dom.getDailyOrderFills({ from: '2026-10-29', to: '2026-11-05' }, opts());
    expect(kisFetchMock).toHaveBeenCalledTimes(3);
    expect(call(1).headers.tr_cont).toBe('N');
    expect(call(1).url.searchParams.get('CTX_AREA_FK100')).toBe('FK1');
    expect(call(1).url.searchParams.get('CTX_AREA_NK100')).toBe('NK1');
    expect(call(2).url.searchParams.get('CTX_AREA_FK100')).toBe('FK2');
    expect(r).toMatchObject({ outcome: 'ended', pages: 3, kisCalls: 3, lastTrCont: 'D' });
    expect(r.rows.map((x) => x.odno)).toEqual(['0000010001', '0000010002', '0000010003']);
    expect(r.summaries).toHaveLength(3);
  });

  test.each([[null], [''], ['E']])('헤더 %p → ended (lastTrCont 는 빈 값이면 null)', async (h) => {
    kisFetchMock.mockResolvedValue(page({ rt_cd: '0', output1: [], output2: domFillSummary([]) }, h as string | null));
    const r = await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts());
    expect(r.outcome).toBe('ended');
    expect(r.lastTrCont).toBe(h === 'E' ? 'E' : null);
  });

  test('모르는 tr_cont(예: X) → truncated(unexpected_tr_cont) — 끝났다고 보지 않는다', async () => {
    kisFetchMock.mockResolvedValue(page({ rt_cd: '0', output1: [domFillRow()], output2: domFillSummary([domFillRow()]) }, 'X'));
    const r = await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts());
    expect(r).toMatchObject({ outcome: 'truncated', error: 'unexpected_tr_cont', pages: 1, lastTrCont: 'X' });
    expect(r.rows).toHaveLength(1);
  });

  test('M 인데 ctx 키가 없거나 비었다 → truncated(continuation_key_missing), 다음 페이지를 지어내지 않는다', async () => {
    kisFetchMock.mockResolvedValue(page({ rt_cd: '0', output1: [domFillRow()], output2: {}, ctx_area_fk100: '', ctx_area_nk100: '' }, 'M'));
    const r = await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts());
    expect(r).toMatchObject({ outcome: 'truncated', error: 'continuation_key_missing', pages: 1, kisCalls: 1, lastTrCont: 'M' });
    expect(kisFetchMock).toHaveBeenCalledTimes(1);
  });

  test('같은 ctx 가 되돌아오면(정체) → truncated(continuation_stalled)', async () => {
    kisFetchMock.mockImplementation(async () => page({ rt_cd: '0', output1: [domFillRow()], output2: {}, ctx_area_fk100: 'SAME', ctx_area_nk100: 'SAME' }, 'M'));
    const r = await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts());
    expect(r).toMatchObject({ outcome: 'truncated', error: 'continuation_stalled', pages: 2, kisCalls: 2 });
  });

  test('페이지 상한 — 기본 30(호출 상한을 넉넉히 주면), 지정 3', async () => {
    let n = 0;
    kisFetchMock.mockImplementation(async () => { n++; return page({ rt_cd: '0', output1: [], output2: {}, ctx_area_fk100: `F${n}`, ctx_area_nk100: `N${n}` }, 'M'); });
    const r30 = await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts({ maxCalls: 100 }));
    expect(LEDGER_MAX_PAGES).toBe(30);
    expect(r30).toMatchObject({ outcome: 'truncated', error: 'page_limit', pages: 30, kisCalls: 30, lastTrCont: 'M' });
    kisFetchMock.mockClear();
    const r3 = await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts({ maxPages: 3 }));
    expect(r3).toMatchObject({ outcome: 'truncated', error: 'page_limit', pages: 3, kisCalls: 3 });
  });

  test('호출 상한 — 기본 12(run 당), 넘으면 truncated(call_budget)', async () => {
    let n = 0;
    kisFetchMock.mockImplementation(async () => { n++; return page({ rt_cd: '0', output1: [], output2: {}, ctx_area_fk100: `F${n}`, ctx_area_nk100: `N${n}` }, 'M'); });
    const r = await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts());
    expect(LEDGER_MAX_CALLS).toBe(12);
    expect(r).toMatchObject({ outcome: 'truncated', error: 'call_budget', pages: 12, kisCalls: 12 });
    expect(kisFetchMock).toHaveBeenCalledTimes(12);
  });

  test('kisFetch 내부 재시도(시도 수 3)도 호출로 센다', async () => {
    const res = page({ rt_cd: '0', output1: [], output2: domFillSummary([]) }, 'E');
    attempts.set(res, 3);
    kisFetchMock.mockResolvedValue(res);
    const r = await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts());
    expect(r.kisCalls).toBe(3);
  });

  test('🔴 (T-087 Codex C2) 마지막 페이지가 kisFetch 내부 재시도로 상한을 넘기면 ended 가 아니라 truncated(call_cap_exceeded) — 받은 행은 유지', async () => {
    const rows = [domFillRow()];
    let n = 0;
    kisFetchMock.mockImplementation(async () => {
      n += 1;
      if (n === 1) return page({ rt_cd: '0', output1: [], output2: domFillSummary(rows), ctx_area_fk100: 'F1', ctx_area_nk100: 'N1' }, 'M');
      const last = page({ rt_cd: '0', output1: rows, output2: domFillSummary(rows) }, 'E');
      attempts.set(last, 3);   // 1 + 3 = 4 > 상한 3
      return last;
    });
    const r = await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts({ maxCalls: 3 }));
    expect(r).toMatchObject({ outcome: 'truncated', error: 'call_cap_exceeded', pages: 2, kisCalls: 4, lastTrCont: 'E' });
    expect(r.rows).toHaveLength(1);
    // 상한과 같으면(4 ≤ 4) 그대로 ended
    n = 0;
    const r2 = await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts({ maxCalls: 4 }));
    expect(r2).toMatchObject({ outcome: 'ended', kisCalls: 4 });
  });

  test('시간 예산 — 첫 페이지 전에 지났으면 failed(호출 0), 페이지 사이에 지나면 truncated(time_budget)', async () => {
    const f0 = await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts({ deadlineMs: NOW - 1 }));
    expect(f0).toMatchObject({ outcome: 'failed', error: 'time_budget', kisCalls: 0 });
    let t = NOW;
    kisFetchMock.mockImplementation(async () => { t += 60_000; return page({ rt_cd: '0', output1: [domFillRow()], output2: {}, ctx_area_fk100: `F${t}`, ctx_area_nk100: 'N' }, 'M'); });
    const f1 = await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts({ now: () => t, deadlineMs: NOW + 75_000 }));
    expect(f1).toMatchObject({ outcome: 'truncated', error: 'time_budget', pages: 2 });
    expect(f1.rows).toHaveLength(2);
  });
});

describe('실패 처리 — 첫 페이지 = failed(행 0), 이후 = truncated(받은 행 유지)', () => {
  test('rt_cd≠0 첫 페이지 → failed, 오류에는 rt_cd·msg_cd 만(msg1·계좌 없음)', async () => {
    kisFetchMock.mockResolvedValue(page({ rt_cd: '1', msg_cd: 'OPSQ0001', msg1: '계좌 99887766 오류' }));
    const r = await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts());
    expect(r).toMatchObject({ outcome: 'failed', error: 'rt_cd_1_OPSQ0001', rows: [], pages: 0, kisCalls: 1 });
    expect(JSON.stringify(r)).not.toMatch(/99887766|계좌/);
  });

  test('rt_cd≠0 둘째 페이지 → truncated, 첫 페이지 행 유지', async () => {
    kisFetchMock
      .mockResolvedValueOnce(page({ rt_cd: '0', output1: [domFillRow()], output2: {}, ctx_area_fk100: 'F', ctx_area_nk100: 'N' }, 'M'))
      .mockResolvedValueOnce(page({ rt_cd: '7', msg_cd: 'X1' }));
    const r = await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts());
    expect(r).toMatchObject({ outcome: 'truncated', error: 'rt_cd_7_X1', pages: 1, kisCalls: 2, lastTrCont: 'M' });
    expect(r.rows).toHaveLength(1);
  });

  test('HTTP 500 첫 페이지 → failed(http_500), 둘째 페이지 → truncated', async () => {
    kisFetchMock.mockResolvedValueOnce(page({ rt_cd: '1', msg1: 'server error' }, null, 500));
    expect(await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts())).toMatchObject({ outcome: 'failed', error: 'http_500', rows: [] });
    kisFetchMock
      .mockResolvedValueOnce(page({ rt_cd: '0', output1: [domFillRow()], output2: {}, ctx_area_fk100: 'F', ctx_area_nk100: 'N' }, 'M'))
      .mockResolvedValueOnce(page({ rt_cd: '1' }, null, 502));
    const r = await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts());
    expect(r).toMatchObject({ outcome: 'truncated', error: 'http_502', pages: 1 });
  });

  test('토큰 만료(EGW00123) → 1회 재발급 후 같은 페이지 재시도, 두 번째 만료는 실패(무한 재시도 없음)', async () => {
    const expired = () => page({ rt_cd: '1', msg_cd: 'EGW00123', msg1: '기간이 만료된 token 입니다.' }, null, 500);
    kisFetchMock.mockResolvedValueOnce(expired()).mockResolvedValueOnce(page({ rt_cd: '0', output1: [], output2: domFillSummary([]) }, 'E'));
    const ok = await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts());
    expect(ok).toMatchObject({ outcome: 'ended', kisCalls: 2, pages: 1 });
    expect(invalidateKisToken).toHaveBeenCalledTimes(1);
    expect(call(1).headers.tr_id).toBe('TTTC0081R');
    kisFetchMock.mockReset();
    kisFetchMock.mockImplementation(async () => expired());
    const bad = await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts());
    expect(bad).toMatchObject({ outcome: 'failed', error: 'http_500', kisCalls: 2 });
    expect(kisFetchMock).toHaveBeenCalledTimes(2);
  });

  test('레이트리밋 소진 → failed(rate_limited), 추가 호출 없음', async () => {
    const res = page({ rt_cd: '1', msg_cd: 'EGW00201', msg1: '초당 거래건수를 초과하였습니다.' }, null, 500);
    rateLimited.add(res);
    kisFetchMock.mockResolvedValue(res);
    const r = await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts());
    expect(r).toMatchObject({ outcome: 'failed', error: 'rate_limited', rateLimited: true, kisCalls: 1 });
    expect(kisFetchMock).toHaveBeenCalledTimes(1);
  });

  test('스로틀 대기 실패는 호출로 세지 않고 failed(throttle_wait) / 네트워크 오류는 failed(network_error)', async () => {
    const thr = Object.assign(new Error('queue timeout'), { name: 'KisThrottleTimeoutError' });
    kisFetchMock.mockRejectedValueOnce(thr);
    expect(await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts())).toMatchObject({ outcome: 'failed', error: 'throttle_wait', kisCalls: 0 });
    kisFetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts())).toMatchObject({ outcome: 'failed', error: 'network_error', kisCalls: 1 });
    kisFetchMock.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    expect(await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts())).toMatchObject({ outcome: 'failed', error: 'timeout' });
  });

  test('행이 배열이 아니다·행이 객체가 아니다·본문이 JSON 이 아니다 → 실패(0건으로 읽지 않는다)', async () => {
    kisFetchMock.mockResolvedValueOnce(page({ rt_cd: '0', output1: { odno: '1' } }, 'E'));
    expect((await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts())).error).toBe('rows_format');
    kisFetchMock.mockResolvedValueOnce(page({ rt_cd: '0', output1: ['x'] }, 'E'));
    expect((await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts())).error).toBe('rows_format');
    kisFetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200 }));
    expect((await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts())).error).toBe('body_json');
  });

  test('rt_cd=0 + 목록 없음(null) / [] → ended 0행 — "없음"의 증거는 아니다(완전성 판정은 normalize)', async () => {
    kisFetchMock.mockResolvedValueOnce(page({ rt_cd: '0', output2: domFillSummary([]) }, 'E'));
    const a = await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts());
    expect(a).toMatchObject({ outcome: 'ended', rows: [], pages: 1 });
    kisFetchMock.mockResolvedValueOnce(page({ rt_cd: '0', output1: [], output2: domFillSummary([]) }, 'E'));
    expect((await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts())).rows).toEqual([]);
  });
});

describe('계좌·지문 — 계좌 원문은 지문 함수에만, 키가 없으면 KIS 를 부르지 않는다', () => {
  test('지문 함수는 `${CANO}-${ACNT_PRDT_CD}` 를 받는다', async () => {
    kisFetchMock.mockResolvedValue(page({ rt_cd: '0', output1: [], output2: domFillSummary([]) }, 'E'));
    const fp = jest.fn(() => FP);
    await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts({ fingerprint: fp }));
    expect(fp).toHaveBeenCalledWith('99887766-01');
  });

  const FP_CASES: [string, () => string | null, string][] = [
    ['키 없음(null)', () => null, 'fingerprint_key_missing'],
    ['형식 이상', () => 'XYZ', 'fingerprint_invalid'],
    ['대문자 hex', () => '0123456789ABCDEF', 'fingerprint_invalid'],
    ['예외', (): string | null => { throw new Error('no key 99887766'); }, 'fingerprint_error'],
  ];
  test.each(FP_CASES)('%s → failed(%s), 호출 0', async (_n, fp, code) => {
    const r = await dom.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-05' }, opts({ fingerprint: fp }));
    expect(r).toMatchObject({ outcome: 'failed', error: code, kisCalls: 0, accountFingerprint: null });
    expect(kisFetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain('99887766');
  });

  test('계좌번호가 비어 있다 → failed(account_missing), 호출 0', async () => {
    credMock.mockImplementation(async (k: string) => (k === 'KIS_ACCOUNT_NO' ? '' : '01'));
    const r = await dom.getPositionSnapshot(opts());
    expect(r).toMatchObject({ outcome: 'failed', error: 'account_missing', kisCalls: 0 });
    expect(kisFetchMock).not.toHaveBeenCalled();
    credMock.mockImplementation(async (k: string) => (k === 'KIS_ACCOUNT_NO' ? '99887766' : k === 'KIS_ACCOUNT_PRODUCT' ? '01' : 'x'));
  });
});

describe('국내 기간손익 getPeriodProfit · 국내 잔고 getPositionSnapshot — 요청 형태', () => {
  test('기간손익: TTTC8708R · 캡처와 같은 경로·파라미터 · FK100 연속조회', async () => {
    const rows = [domPnlRow()];
    kisFetchMock
      .mockResolvedValueOnce(page({ rt_cd: '0', output1: rows, output2: domPnlSummary(rows), ctx_area_fk100: 'A', ctx_area_nk100: 'B' }, 'M'))
      .mockResolvedValueOnce(page({ rt_cd: '0', output1: [], output2: domPnlSummary(rows) }, 'D'));
    const r = await dom.getPeriodProfit({ from: '2026-10-29', to: '2026-11-05' }, opts());
    const c = call();
    expect(c.url.pathname).toBe('/uapi/domestic-stock/v1/trading/inquire-period-trade-profit');
    expect(c.headers.tr_id).toBe('TTTC8708R');
    expect(Object.fromEntries(c.url.searchParams)).toEqual({
      CANO: '99887766', ACNT_PRDT_CD: '01', SORT_DVSN: '00', INQR_STRT_DT: '20261029', INQR_END_DT: '20261105', CBLC_DVSN: '00', PDNO: '',
      CTX_AREA_FK100: '', CTX_AREA_NK100: '',
    });
    expect(c.opts).toEqual({ priority: 'bulk', timeoutMs: 20_000, label: 'domestic ledgerPeriodProfit' });
    expect(call(1).url.searchParams.get('CTX_AREA_FK100')).toBe('A');
    expect(r).toMatchObject({ market: 'domestic', kind: 'realized_pnl', trId: 'TTTC8708R', outcome: 'ended', pages: 2, lastTrCont: 'D' });
    process.env.KIS_MOCK = 'true';
    kisFetchMock.mockImplementation(async () => page({ rt_cd: '0', output1: [], output2: domPnlSummary([]) }, 'D'));
    expect((await dom.getPeriodProfit({ from: '2026-11-01', to: '2026-11-05' }, opts())).trId).toBe('VTTC8708R');
  });

  test('잔고: TTTC8434R · 기존 getBalances 와 같은 파라미터 · 조회일 = KST 오늘 · 보유 0 행도 원문 그대로', async () => {
    const rows = [domPosRow(), domPosRow({ pdno: '900020', hldg_qty: '0', evlu_amt: '0', pchs_amt: '0' })];
    kisFetchMock.mockImplementation(async () => page({ rt_cd: '0', output1: rows, output2: domPosSummary(rows) }, 'D'));
    const late = Date.parse('2026-11-05T23:59:00+09:00');   // UTC 로는 11-05 14:59 — 날짜가 KST 로 잡혀야 한다
    const r = await dom.getPositionSnapshot(opts({ now: () => late }));
    const c = call();
    expect(c.url.pathname).toBe('/uapi/domestic-stock/v1/trading/inquire-balance');
    expect(c.headers.tr_id).toBe('TTTC8434R');
    expect(Object.fromEntries(c.url.searchParams)).toEqual({
      CANO: '99887766', ACNT_PRDT_CD: '01', AFHR_FLPR_YN: 'N', OFL_YN: '', INQR_DVSN: '02', UNPR_DVSN: '01', FUND_STTL_ICLD_YN: 'N',
      FNCG_AMT_AUTO_RDPT_YN: 'N', PRCS_DVSN: '01', CTX_AREA_FK100: '', CTX_AREA_NK100: '',
    });
    expect(c.opts.label).toBe('domestic ledgerPositions');
    expect(r).toMatchObject({ kind: 'position_snapshot', queryFrom: '2026-11-05', queryTo: '2026-11-05', outcome: 'ended' });
    expect(r.rows).toHaveLength(2);
    const early = Date.parse('2026-11-06T00:01:00+09:00');   // UTC 11-05 15:01
    expect((await dom.getPositionSnapshot(opts({ now: () => early }))).queryFrom).toBe('2026-11-06');
  });
});

describe('해외 — 체결·기간손익·잔고', () => {
  test('체결: TTTS3035R · 전 거래소(%) · 전 종목 · 전체(00) · output · 요약 없음 · FK200 연속조회', async () => {
    const r1 = [ovsFillRow({ odno: '0000020001' })], r2 = [ovsFillRow({ odno: '0000020002', ovrs_excg_cd: 'NYSE' })];
    kisFetchMock
      .mockResolvedValueOnce(page({ rt_cd: '0', output: r1, ctx_area_fk200: 'FK', ctx_area_nk200: 'NK' }, 'M'))
      .mockResolvedValueOnce(page({ rt_cd: '0', output: r2 }, 'D'));
    const r = await ovs.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-06' }, opts());
    const c = call();
    expect(c.url.pathname).toBe('/uapi/overseas-stock/v1/trading/inquire-ccnl');
    expect(c.headers.tr_id).toBe('TTTS3035R');
    expect(Object.fromEntries(c.url.searchParams)).toEqual({
      CANO: '99887766', ACNT_PRDT_CD: '01', OVRS_EXCG_CD: '%', PDNO: '', ORD_STRT_DT: '20261101', ORD_END_DT: '20261106',
      SLL_BUY_DVSN: '00', CCLD_NCCS_DVSN: '00', SORT_SQN: 'DS', CTX_AREA_FK200: '', CTX_AREA_NK200: '',
    });
    expect(c.opts).toEqual({ priority: 'bulk', timeoutMs: 20_000, label: 'overseas ledgerDailyFills' });
    expect(call(1).headers.tr_cont).toBe('N');
    expect(call(1).url.searchParams.get('CTX_AREA_FK200')).toBe('FK');
    expect(call(1).url.searchParams.get('CTX_AREA_NK200')).toBe('NK');
    expect(r).toMatchObject({ market: 'overseas', kind: 'fills', trId: 'TTTS3035R', outcome: 'ended', pages: 2, summaries: [] });
    expect(r.rows.map((x) => x.odno)).toEqual(['0000020001', '0000020002']);
    process.env.KIS_MOCK = 'true';
    kisFetchMock.mockResolvedValue(page({ rt_cd: '0', output: [] }, 'D'));
    expect((await ovs.getDailyOrderFills({ from: '2026-11-01', to: '2026-11-06' }, opts())).trId).toBe('VTTS3035R');
  });

  test('해외 체결에는 85일 판정이 없다(기간 한도 미확인 — 자르지 않고 KIS 거절은 rt_cd 로)', async () => {
    kisFetchMock.mockResolvedValue(page({ rt_cd: '0', output: [] }, 'D'));
    const r = await ovs.getDailyOrderFills({ from: '2026-04-01', to: '2026-04-30' }, opts());
    expect(r.outcome).toBe('ended');
  });

  test('기간손익: TTTS3039R · 캡처 파라미터 · 첫 페이지 M + ctx_area_fk200 → 따라간다', async () => {
    const p1 = [ovsPnlRow()], p2 = [ovsPnlRow({ ovrs_pdno: 'XMPB', trad_day: '20261111' })];
    kisFetchMock
      .mockResolvedValueOnce(page({ rt_cd: '0', output1: p1, output2: ovsPnlSummary([...p1, ...p2]), ctx_area_fk200: 'P1', ctx_area_nk200: 'Q1' }, 'M'))
      .mockResolvedValueOnce(page({ rt_cd: '0', output1: p2, output2: ovsPnlSummary([...p1, ...p2]) }, 'D'));
    const r = await ovs.getPeriodProfit({ from: '2026-11-01', to: '2026-11-11' }, opts());
    const c = call();
    expect(c.url.pathname).toBe('/uapi/overseas-stock/v1/trading/inquire-period-profit');
    expect(c.headers.tr_id).toBe('TTTS3039R');
    expect(Object.fromEntries(c.url.searchParams)).toEqual({
      CANO: '99887766', ACNT_PRDT_CD: '01', OVRS_EXCG_CD: '', NATN_CD: '', CRCY_CD: '', PDNO: '', INQR_STRT_DT: '20261101',
      INQR_END_DT: '20261111', WCRC_FRCR_DVSN_CD: '01', CTX_AREA_FK200: '', CTX_AREA_NK200: '',
    });
    expect(c.opts.label).toBe('overseas ledgerPeriodProfit');
    expect(call(1).url.searchParams.get('CTX_AREA_FK200')).toBe('P1');
    expect(r).toMatchObject({ kind: 'realized_pnl', outcome: 'ended', pages: 2, lastTrCont: 'D' });
    expect(r.rows).toHaveLength(2);
  });

  test('기간손익 연속 키(응답 이름 미확인 ⑦): 대문자 CTX_AREA_FK200 도 받는다 / 키가 없으면 truncated(continuation_key_missing)', async () => {
    kisFetchMock
      .mockResolvedValueOnce(page({ rt_cd: '0', output1: [ovsPnlRow()], output2: {}, CTX_AREA_FK200: 'U1', CTX_AREA_NK200: 'U2' }, 'M'))
      .mockResolvedValueOnce(page({ rt_cd: '0', output1: [], output2: {} }, 'D'));
    const a = await ovs.getPeriodProfit({ from: '2026-11-01', to: '2026-11-11' }, opts());
    expect(call(1).url.searchParams.get('CTX_AREA_FK200')).toBe('U1');
    expect(a.outcome).toBe('ended');
    kisFetchMock.mockReset();
    kisFetchMock.mockResolvedValue(page({ rt_cd: '0', output1: [ovsPnlRow()], output2: {} }, 'M'));
    const b = await ovs.getPeriodProfit({ from: '2026-11-01', to: '2026-11-11' }, opts());
    expect(b).toMatchObject({ outcome: 'truncated', error: 'continuation_key_missing', pages: 1, kisCalls: 1 });
    expect(kisFetchMock).toHaveBeenCalledTimes(1);
  });

  test('잔고: CTRP6504R · getUsdCash 와 같은 파라미터 · 빈 tr_cont 헤더 → ended(lastTrCont null) · 요약은 output3', async () => {
    const rows = [ovsPosRow()];
    const o3 = ovsPosSummary3('311');
    kisFetchMock.mockImplementation(async () => page({ rt_cd: '0', output1: rows, output2: [{ crcy_cd: 'USD' }], output3: o3 }, ''));
    const r = await ovs.getPositionSnapshot(opts());
    const c = call();
    expect(c.url.pathname).toBe('/uapi/overseas-stock/v1/trading/inquire-present-balance');
    expect(c.headers.tr_id).toBe('CTRP6504R');
    expect(Object.fromEntries(c.url.searchParams)).toEqual({
      CANO: '99887766', ACNT_PRDT_CD: '01', WCRC_FRCR_DVSN_CD: '02', NATN_CD: '840', TR_MKET_CD: '00', INQR_DVSN_CD: '00',
    });
    expect(c.opts.label).toBe('overseas ledgerPositions');
    expect(r).toMatchObject({ kind: 'position_snapshot', trId: 'CTRP6504R', outcome: 'ended', lastTrCont: null, summaries: [o3], queryFrom: '2026-11-05' });
    process.env.KIS_MOCK = 'true';
    expect((await ovs.getPositionSnapshot(opts())).trId).toBe('VTRP6504R');
  });

  test('잔고가 M 을 주면 연속조회를 지원하지 않는 TR 이라 truncated(continuation_unsupported)', async () => {
    kisFetchMock.mockResolvedValue(page({ rt_cd: '0', output1: [ovsPosRow()], output3: ovsPosSummary3('311') }, 'M'));
    const r = await ovs.getPositionSnapshot(opts());
    expect(r).toMatchObject({ outcome: 'truncated', error: 'continuation_unsupported', pages: 1, kisCalls: 1 });
  });
});
