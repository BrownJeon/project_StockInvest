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

import { createSignalGuarded, resolveEngineInterval } from '../engine';
import { STRATEGY_REGISTRY } from '../rules';
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

    // T-020 R2 — 반환 계약에 `recordedGate`/`recordedVerdict` 가 추가됐다(아래 describe 참조).
    // 정확 일치(`toEqual`) 대신 부분 일치로 두되, 새 필드도 함께 단언해 커버리지를 넓힌다.
    expect(res).toMatchObject({
      ok: true, signalId: 7, recordedGate: 'signal_created', recordedVerdict: 'pass',
    });
    expect(rec.peek()[0]).toMatchObject({ gate: 'signal_created', verdict: 'pass' });
    expect(markSignal).toHaveBeenCalledWith('005930', 7);
  });
});

/**
 * T-020 라운드 2 (reviewer HIGH-1) — **호출부가 "이미 기록됐다"를 알 수 있어야 한다.**
 *
 * `createSignalGuarded` 는 모든 결과를 자기가 `eval_funnel` 에 기록한다. 그런데 그 사실이
 * 반환값에 없어서, exit-engine 호출부는 `!ok` 이기만 하면 `exit_create_failed`(verdict=`error`)를
 * 한 번 더 썼다 — 정책 스킵까지 "청산 시그널 생성 실패"로 리포트에 올라갔다.
 * 여기서는 **반환 계약**만 고정한다. 실제 청산 경로에서의 효과는
 * `engine-exit-create-outcome.test.ts` 가 `runAll` 로 검증한다.
 */
describe('createSignalGuarded — 기록한 판정을 호출부에 알린다 (T-020 R2)', () => {
  afterEach(() => { jest.resetAllMocks(); });

  const cases = [
    ['quantity_below_min',      'quantity_below_min',      'skip'],
    ['duplicate_active_signal', 'duplicate_active_signal', 'skip'],
    ['symbol_blacklisted',      'symbol_blacklisted',      'skip'],
  ] as const;

  it.each(cases)('errorCode=%s → recordedGate=%s / recordedVerdict=%s', async (code, gate, verdict) => {
    mockedCreateSignal.mockResolvedValue({
      ok: false, signalId: 1, autoSubmitted: false, error: String(code), errorCode: code,
    });
    const rec = recorder();

    const res = await createSignalGuarded(candidate(), rec);

    expect(res).toMatchObject({ ok: false, errorCode: code, recordedGate: gate, recordedVerdict: verdict });
    // 기록은 정확히 1행 — 호출부가 이 값을 보고 추가 기록을 하지 않기 때문에 성립한다
    expect(rec.peek()).toHaveLength(1);
    expect(rec.peek()[0]).toMatchObject({ gate, verdict });
  });

  it('🔴 errorCode 없는 일반 실패는 verdict=error 로 알려 호출부가 자기 트랙에 남길 수 있게 한다', async () => {
    mockedCreateSignal.mockResolvedValue({
      ok: false, signalId: 0, autoSubmitted: false, error: '한도 초과',
    });
    const rec = recorder();

    const res = await createSignalGuarded(candidate(), rec);

    expect(res).toMatchObject({ recordedGate: 'signal_create_failed', recordedVerdict: 'error' });
    expect(res.errorCode).toBeUndefined();
  });

  it('🔴 예외 경로도 verdict=error 다 (진짜 실패가 조용해지지 않는다)', async () => {
    mockedCreateSignal.mockRejectedValue(new Error('ER_LOCK_DEADLOCK'));
    const rec = recorder();

    const res = await createSignalGuarded(candidate(), rec);

    expect(res).toMatchObject({ ok: false, recordedGate: 'signal_create_failed', recordedVerdict: 'error' });
  });
});

/**
 * Phase 2 D1 — 시간축 단일화 (T-003 §2, §6-4 검증 기준).
 *
 * 3중 축 불일치(게이트 30m / 룰 adaptive 1h / AI 프롬프트 30m)가 rsi-oversold 의 유일한
 * 발화 경로였고, 레짐에 따라 룰의 의미가 바뀌어 백테스트가 불가능했다.
 */
describe('resolveEngineInterval — 장중 1h 단일축', () => {
  it('1d 룰만 1d 를 유지한다', () => {
    expect(resolveEngineInterval('1d')).toBe('1d');
  });

  it('30m·1h·15m 등 장중 표기는 전부 1h 로 정규화된다 (adaptive-interval 폐기)', () => {
    for (const declared of ['30m', '1h', '15m', '5m']) {
      expect(resolveEngineInterval(declared)).toBe('1h');
    }
  });

  it('STRATEGY_REGISTRY 의 선언 interval 도 1h 또는 1d 뿐이다 (백테스트 축 일치)', () => {
    const declared = new Set(Object.values(STRATEGY_REGISTRY).map(m => m.interval));
    expect([...declared].sort()).toEqual(['1d', '1h']);
  });

  it('엔진 실행 축은 선언값과 무관하게 1h/1d 로 강제된다', () => {
    for (const meta of Object.values(STRATEGY_REGISTRY)) {
      expect(['1h', '1d']).toContain(resolveEngineInterval(meta.interval));
    }
  });
});

/**
 * Phase 2 D1 — market-state 는 게이트가 아니라 라벨이다.
 * 게이팅 API(STATE_RULES·getRulesForState·ALWAYS_ACTIVE_RULES)가 살아 있으면
 * 누군가 다시 배선할 수 있으므로, 모듈에서 사라졌다는 사실 자체를 테스트로 고정한다.
 */
describe('market-state 라벨 강등 (D1)', () => {
  it('룰 게이팅 API 가 모듈에서 제거됐다', () => {
    const mod = require('../market-state') as Record<string, unknown>;
    expect(mod.getRulesForState).toBeUndefined();
    expect(mod.ALWAYS_ACTIVE_RULES).toBeUndefined();
    expect(mod.STATE_RULES).toBeUndefined();
  });

  it('분류기는 남아 있고 라벨을 반환한다', () => {
    const { classifyMarketState, MARKET_STATE_LABEL_KO } = require('../market-state');
    expect(typeof classifyMarketState).toBe('function');
    expect(MARKET_STATE_LABEL_KO.oversold_bounce).toBeTruthy();
  });

  it('데드락 재현 — RSI 34 는 divergence_signal 로 분류되지만 이제 아무 룰도 막지 않는다', () => {
    const { classifyMarketState } = require('../market-state');
    const s = { rsi14: 34, ema20: 100, ema60: 100, currentPrice: 100, volumeRatio: 1, priceChange5: 0,
                bbUpper: 110, bbLower: 90, high24h: 105, low24h: 95, val: null, vah: null } as never;
    // 구 구조에서는 이 분류 때문에 rsi-oversold-v1(활성 조건: oversold_bounce)이 배제됐다.
    expect(classifyMarketState(s)).toBe('divergence_signal');
  });
});
