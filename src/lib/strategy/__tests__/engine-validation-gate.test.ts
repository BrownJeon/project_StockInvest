/**
 * T-072 — 엔진 호출자 `createSignalGuarded` × 검증 상태 관문.
 *
 *  - 🔴 엔진은 createSignal 에 `{ origin:'engine', claimEntryCooldown:true }` 를 넘긴다 — 막힌 매수도 진입 쿨다운을 선점해(F-16)
 *    틱마다 재발화해 감사 행·가상 체결이 중복으로 쌓이지 않는다. (선점·기록 자체는 service-validation-gate.test.ts 가 실 로직으로 본다)
 *  - validation_gate → funnel gate `validation_gate` · verdict skip · reason = 관문 사유 · stage 11 kill · 경고 0 · recordedVerdict skip
 *  - validation_lookup_error → verdict error(정기 리포트 "이상"에 올라간다) + 경고
 *  - 라벨: append-only, stage 11, 한글 라벨, gate VARCHAR(48)
 */
jest.mock('@/lib/db', () => ({ getPool: jest.fn(() => ({ query: jest.fn(async () => [[]]) })) }));
jest.mock('@/lib/exchanges/kis', () => ({ kis: {}, getBalancesDetailed: jest.fn() }));
const createSignal = jest.fn();
jest.mock('@/lib/signals/service', () => ({ createSignal: (...a: unknown[]) => createSignal(...a) }));

import { createSignalGuarded } from '../engine';
import { EvalFunnelRecorder } from '../eval-funnel';
import { FUNNEL_GATES, GATE_LABEL_KO, GATE_STAGE, gateLabelKo } from '../eval-funnel-labels';

const input = { strategyId: 'rsi-oversold-v1', symbol: 'NAS:MU', side: 'buy' as const, orderType: 'limit' as const, price: 280_000, amountKRW: 1_000_000 };
const outcomeSpy = () => ({ kill: jest.fn(), markSignal: jest.fn(), advance: jest.fn(), setRaw: jest.fn(), map: new Map() });

let warn: jest.SpyInstance;
beforeEach(() => { jest.clearAllMocks(); warn = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => warn.mockRestore());

test('🔴 createSignal 에 엔진 맥락(origin engine · 진입 쿨다운 선점)을 넘긴다', async () => {
  createSignal.mockResolvedValue({ ok: true, signalId: 1, autoSubmitted: false });
  await createSignalGuarded(input, new EvalFunnelRecorder('overseas', new Date(), true), outcomeSpy() as never);
  expect(createSignal).toHaveBeenCalledTimes(1);
  expect(createSignal.mock.calls[0][0]).toBe(input);
  expect(createSignal.mock.calls[0][2]).toEqual({ origin: 'engine', claimEntryCooldown: true });
});

test('🔴 validation_gate → funnel skip(validation_gate) 1행 · reason=관문 사유 · detail(감사 행·가상 체결 id) · 경고 0 · kill(11)', async () => {
  createSignal.mockResolvedValue({
    ok: false, signalId: 0, autoSubmitted: false, errorCode: 'validation_gate', error: 'validation_gate: x',
    validation: { reason: 'unvalidated', strategyId: 'rsi-oversold-v1', status: 'unvalidated', auditSignalId: 19400, paperFillId: 7, recorded: true, claim: 'inserted' },
  });
  const rec = new EvalFunnelRecorder('overseas', new Date(), true);
  const outcome = outcomeSpy();
  const r = await createSignalGuarded(input, rec, outcome as never);
  expect(r).toEqual({ ok: false, error: 'validation_gate: x', errorCode: 'validation_gate', recordedGate: 'validation_gate', recordedVerdict: 'skip' });
  const rows = rec.peek();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ gate: 'validation_gate', verdict: 'skip', reason: 'unvalidated', symbol: 'NAS:MU', side: 'buy', strategyId: 'rsi-oversold-v1' });
  expect(rows[0].detail).toEqual({ strategyId: 'rsi-oversold-v1', status: 'unvalidated', signalId: 19400, paperFillId: 7, recorded: true, claim: 'inserted' });
  expect(outcome.kill).toHaveBeenCalledWith('NAS:MU', 11, 'validation_gate');
  expect(outcome.markSignal).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
});

test('선점에 진 경우(기록 생략)도 같은 게이트 skip 으로 남는다', async () => {
  createSignal.mockResolvedValue({
    ok: false, signalId: 0, autoSubmitted: false, errorCode: 'validation_gate', error: 'validation_gate: x',
    validation: { reason: 'unregistered', strategyId: 'x', status: null, auditSignalId: null, paperFillId: null, recorded: false, claim: 'active' },
  });
  const rec = new EvalFunnelRecorder('domestic', new Date(), true);
  await createSignalGuarded({ ...input, symbol: '005930' }, rec, outcomeSpy() as never);
  expect(rec.peek()[0]).toMatchObject({ gate: 'validation_gate', verdict: 'skip', reason: 'unregistered' });
});

test('🔴 validation_lookup_error → verdict error + 경고 (막는 것은 같고 인프라 이상으로 집계)', async () => {
  createSignal.mockResolvedValue({
    ok: false, signalId: 0, autoSubmitted: false, errorCode: 'validation_lookup_error', error: 'validation_lookup_error: x',
    validation: { reason: 'lookup_error', strategyId: 'rsi-oversold-v1', status: null, auditSignalId: 1, paperFillId: null, recorded: true, claim: 'inserted' },
  });
  const rec = new EvalFunnelRecorder('domestic', new Date(), true);
  const outcome = outcomeSpy();
  const r = await createSignalGuarded({ ...input, symbol: '005930' }, rec, outcome as never);
  expect(r.recordedVerdict).toBe('error');
  expect(rec.peek()[0]).toMatchObject({ gate: 'validation_lookup_error', verdict: 'error', reason: 'lookup_error' });
  expect(outcome.kill).toHaveBeenCalledWith('005930', 11, 'validation_lookup_error');
  expect(warn).toHaveBeenCalledTimes(1);
});

test('대조: 기존 매핑 불변 — insufficient_cash skip · 코드 없음 signal_create_failed error', async () => {
  createSignal.mockResolvedValue({ ok: false, signalId: 0, autoSubmitted: false, errorCode: 'insufficient_cash', error: 'c' });
  const rec = new EvalFunnelRecorder('domestic', new Date(), true);
  await createSignalGuarded(input, rec, outcomeSpy() as never);
  createSignal.mockResolvedValue({ ok: false, signalId: 0, autoSubmitted: false, error: 'boom' });
  await createSignalGuarded(input, rec, outcomeSpy() as never);
  expect(rec.peek().map((x) => [x.gate, x.verdict, x.reason])).toEqual([
    ['insufficient_cash', 'skip', 'insufficient_cash'],
    ['signal_create_failed', 'error', 'boom'],
  ]);
});

test('게이트 라벨 — 목록 끝에 append, stage 11, 한글 라벨, VARCHAR(48) 이내', () => {
  expect(FUNNEL_GATES.slice(-2)).toEqual(['validation_gate', 'validation_lookup_error']);
  expect(GATE_STAGE.validation_gate).toBe(11);
  expect(GATE_STAGE.validation_lookup_error).toBe(11);
  expect(gateLabelKo('validation_gate')).toBe(GATE_LABEL_KO.validation_gate);
  expect(GATE_LABEL_KO.validation_gate).toContain('검증 전 전략');
  expect(GATE_LABEL_KO.validation_lookup_error).toContain('조회 실패');
  for (const g of ['validation_gate', 'validation_lookup_error']) expect(g.length).toBeLessThanOrEqual(48);
});
