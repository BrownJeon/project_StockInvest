/**
 * engine.ts createSignalGuarded 단위 테스트 (T-002 H2 예외 격리).
 *
 * 배경: signals.status ENUM에 pending_approval이 없던 시절, createSignal의 INSERT가
 * STRICT 모드 하드 에러를 던졌고 미보호 호출부라 그 예외가 runMarket 전체를 중단시켰다.
 * "한 후보의 실패가 런 전체를 죽이지 않는다"가 이 핫픽스의 핵심 계약이므로 반드시 테스트로 고정한다.
 */

jest.mock('@/lib/db', () => ({
  getPool: jest.fn(() => ({ query: jest.fn() })),
}));

jest.mock('@/lib/signals/service', () => ({
  createSignal: jest.fn(),
}));

import { createSignalGuarded } from '../engine';
import { createSignal } from '@/lib/signals/service';
import { EvalFunnelRecorder } from '../eval-funnel';
import type { SignalInput } from '@/lib/signals/router';

const mockedCreateSignal = createSignal as jest.MockedFunction<typeof createSignal>;

function candidate(overrides: Partial<SignalInput & { strategyId: string }> = {}) {
  return {
    symbol: '005930',
    side: 'buy',
    orderType: 'market',
    amountKRW: 100_000,
    strategyId: 'rsi-oversold-v1',
    ...overrides,
  } as SignalInput & { strategyId: string };
}

function recorder(): EvalFunnelRecorder {
  return new EvalFunnelRecorder('domestic', new Date(), true);
}

describe('createSignalGuarded (T-002 H2)', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('createSignal이 예외를 던져도 throw하지 않고 {ok:false}를 반환한다', async () => {
    mockedCreateSignal.mockRejectedValue(new Error('ER_TRUNCATED_WRONG_VALUE_FOR_FIELD'));
    const rec = recorder();

    await expect(createSignalGuarded(candidate(), rec)).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining('ER_TRUNCATED') }),
    );
  });

  it('예외 발생 시 eval_funnel에 signal_create_failed(verdict=error)로 기록한다', async () => {
    mockedCreateSignal.mockRejectedValue(new Error('boom'));
    const rec = recorder();

    await createSignalGuarded(candidate({ symbol: '000660' }), rec);

    const events = rec.peek();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      gate: 'signal_create_failed',
      verdict: 'error',
      symbol: '000660',
      reason: 'exception',
    });
  });

  it('예외 발생 시 outcome tracker가 stage 11로 kill 처리된다', async () => {
    mockedCreateSignal.mockRejectedValue(new Error('boom'));
    const rec = recorder();
    const kill = jest.fn();

    await createSignalGuarded(candidate({ symbol: '000660' }), rec, { kill } as any);

    expect(kill).toHaveBeenCalledWith('000660', 11, 'signal_create_failed');
  });

  it('연속으로 실패해도 다음 후보 호출까지 도달한다 (런이 계속된다)', async () => {
    mockedCreateSignal.mockRejectedValue(new Error('fail'));
    const rec = recorder();

    const r1 = await createSignalGuarded(candidate({ symbol: 'AAA' }), rec);
    const r2 = await createSignalGuarded(candidate({ symbol: 'BBB' }), rec);

    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    expect(rec.peek()).toHaveLength(2);
  });

  it('res.ok=false + errorCode=duplicate_active_signal → duplicate_active_signal 게이트로 skip 기록 (throw 아님)', async () => {
    mockedCreateSignal.mockResolvedValue({
      ok: false, signalId: 42, autoSubmitted: false,
      error: 'duplicate_active_signal', errorCode: 'duplicate_active_signal',
    });
    const rec = recorder();

    const res = await createSignalGuarded(candidate(), rec);

    expect(res.ok).toBe(false);
    expect(rec.peek()[0]).toMatchObject({ gate: 'duplicate_active_signal', verdict: 'skip' });
  });

  it('res.ok=false + errorCode 없음(일반 실패) → signal_create_failed 게이트로 error 기록', async () => {
    mockedCreateSignal.mockResolvedValue({
      ok: false, signalId: 0, autoSubmitted: false, error: '한도 초과',
    });
    const rec = recorder();

    await createSignalGuarded(candidate(), rec);

    expect(rec.peek()[0]).toMatchObject({ gate: 'signal_create_failed', verdict: 'error' });
  });

  it('res.ok=true → signal_created 게이트로 pass 기록 + outcome.markSignal 호출', async () => {
    mockedCreateSignal.mockResolvedValue({ ok: true, signalId: 7, autoSubmitted: false });
    const rec = recorder();
    const markSignal = jest.fn();

    const res = await createSignalGuarded(candidate(), rec, { markSignal } as any);

    expect(res).toEqual({ ok: true, signalId: 7 });
    expect(rec.peek()[0]).toMatchObject({ gate: 'signal_created', verdict: 'pass' });
    expect(markSignal).toHaveBeenCalledWith('005930', 7);
  });
});
