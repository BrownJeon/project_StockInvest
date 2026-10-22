/**
 * T-058 (S-2) — 엔진 호출자 `createSignalGuarded` 가 `insufficient_cash` 를 **정책 건너뜀**으로 다룬다.
 *
 *  - eval_funnel: gate `insufficient_cash` · verdict `skip` (error 아님 → "⚠ 이상" 집계·리포트에 안 올라간다)
 *  - 매 건 `console.warn` 을 내지 않는다(게이트가 1시간 1회로 이미 남긴다)
 *  - outcome 전이: stage 11 에서 `insufficient_cash` 로 kill (quantity_below_min 과 같은 전이)
 *  - 반환 `recordedVerdict: 'skip'` → exit 경로도 `exit_create_failed` 를 덧쓰지 않는다
 *  - 대조: 진짜 실패는 여전히 error + 경고
 */
jest.mock('@/lib/db', () => ({ getPool: jest.fn(() => ({ query: jest.fn(async () => [[]]) })) }));
jest.mock('@/lib/exchanges/kis', () => ({ kis: {}, getBalancesDetailed: jest.fn() }));
const createSignal = jest.fn();
jest.mock('@/lib/signals/service', () => ({ createSignal: (...a: unknown[]) => createSignal(...a) }));

import { createSignalGuarded } from '../engine';
import { EvalFunnelRecorder } from '../eval-funnel';
import { FUNNEL_GATES, GATE_LABEL_KO, GATE_STAGE, gateLabelKo } from '../eval-funnel-labels';

const input = { strategyId: 'rsi-oversold-v1', symbol: 'NAS:AAPL', side: 'buy' as const, orderType: 'limit' as const, price: 280_000, amountKRW: 1_000_000 };

function outcomeSpy() {
  return { kill: jest.fn(), markSignal: jest.fn(), advance: jest.fn(), setRaw: jest.fn(), map: new Map() };
}

let warn: jest.SpyInstance;
beforeEach(() => { jest.clearAllMocks(); warn = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => warn.mockRestore());

test('🔴 insufficient_cash → funnel skip(insufficient_cash) 1행, 경고 0, outcome kill(11, insufficient_cash), recordedVerdict skip', async () => {
  createSignal.mockResolvedValue({ ok: false, signalId: 0, autoSubmitted: false, errorCode: 'insufficient_cash', error: 'insufficient_cash: x' });
  const rec = new EvalFunnelRecorder('overseas', new Date(), true);
  const outcome = outcomeSpy();
  const r = await createSignalGuarded(input, rec, outcome as never);
  expect(r).toEqual({ ok: false, error: 'insufficient_cash: x', errorCode: 'insufficient_cash', recordedGate: 'insufficient_cash', recordedVerdict: 'skip' });
  const rows = rec.peek();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ gate: 'insufficient_cash', verdict: 'skip', reason: 'insufficient_cash', symbol: 'NAS:AAPL', side: 'buy' });
  expect(rows.some((x) => x.verdict === 'error')).toBe(false);
  expect(outcome.kill).toHaveBeenCalledWith('NAS:AAPL', 11, 'insufficient_cash');
  expect(outcome.markSignal).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
});

test('대조: 다른 실패(코드 없음)는 여전히 signal_create_failed / error + 경고', async () => {
  createSignal.mockResolvedValue({ ok: false, signalId: 0, autoSubmitted: false, error: 'boom' });
  const rec = new EvalFunnelRecorder('domestic', new Date(), true);
  const r = await createSignalGuarded({ ...input, symbol: '005930' }, rec, outcomeSpy() as never);
  expect(r.recordedVerdict).toBe('error');
  expect(rec.peek()[0]).toMatchObject({ gate: 'signal_create_failed', verdict: 'error' });
  expect(warn).toHaveBeenCalledTimes(1);
});

test('대조: quantity_below_min 은 기존대로 skip + 경고(이 task 로 바뀌지 않음)', async () => {
  createSignal.mockResolvedValue({ ok: false, signalId: 0, autoSubmitted: false, errorCode: 'quantity_below_min', error: 'q' });
  const rec = new EvalFunnelRecorder('domestic', new Date(), true);
  await createSignalGuarded({ ...input, symbol: '005930' }, rec, outcomeSpy() as never);
  expect(rec.peek()[0]).toMatchObject({ gate: 'quantity_below_min', verdict: 'skip' });
  expect(warn).toHaveBeenCalledTimes(1);
});

test('게이트 라벨 등록 — stage 11, 한글 라벨, 목록 끝에 append(기존 ID 순서 불변)', () => {
  // append-only — T-058 때 끝이었던 insufficient_cash 뒤에 T-072 의 두 게이트가 붙었다(기존 ID 의 상대 순서는 그대로).
  expect(FUNNEL_GATES.indexOf('sell_proposal_preview')).toBe(FUNNEL_GATES.indexOf('insufficient_cash') - 1);
  expect(FUNNEL_GATES.slice(FUNNEL_GATES.indexOf('insufficient_cash'))).toEqual(['insufficient_cash', 'validation_gate', 'validation_lookup_error']);
  expect(GATE_STAGE.insufficient_cash).toBe(11);
  expect(GATE_LABEL_KO.insufficient_cash).toBe('실시간 현금 부족 (매수 시그널 미생성)');
  expect(gateLabelKo('insufficient_cash')).toBe('실시간 현금 부족 (매수 시그널 미생성)');
  expect('insufficient_cash'.length).toBeLessThanOrEqual(48);          // eval_funnel.gate VARCHAR(48)
});
