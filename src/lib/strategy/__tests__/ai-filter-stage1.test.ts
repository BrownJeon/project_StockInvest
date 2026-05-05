/**
 * Hybrid Stage 1 광역 스크리닝 회귀 테스트.
 *
 * 검증 범위:
 *  1. JSON 파싱 — pass/reject/escalate 분류 수치 검증
 *  2. 임계값 재검증 — 모델이 잘못 분류한 경우 보정
 *  3. 누락된 심볼 — escalate로 안전하게 채움
 *  4. JSON 파싱 실패 → throw (호출자가 legacy로 fallback)
 */

import { runStage1Screen } from '../ai-filter-stage1';
import type { BatchSymbolInput } from '../ai-filter';

// runLlmOnce mock — provider 추상화 우회
jest.mock('@/lib/llm/provider', () => ({
  runLlmOnce: jest.fn(),
}));

// db mock (stage1 → provider → readSystemConfig 경로 호출 안 됨, 안전을 위해 mock)
jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));

import { runLlmOnce } from '@/lib/llm/provider';

const mockedRunLlmOnce = runLlmOnce as jest.MockedFunction<typeof runLlmOnce>;

function fakeInput(symbol: string): BatchSymbolInput {
  return {
    symbol,
    candidates: [
      {
        symbol, side: 'buy', amountKRW: 10000, reasoning: 'test',
        strategyId: 'rsi', signalScore: 50, confidenceScore: 50,
      } as any,
    ],
    summary: {
      currentPrice: 100, priceChange5: 1, volumeRatio: 1.5,
      rsi14: 60, ema20: 99, ema60: 95,
      macd: 0.1, macdSignal: 0.05, macdHistogram: 0.05,
      bbUpper: 105, bbMiddle: 100, bbLower: 95, atr14: 2,
      high24h: 102, low24h: 98, recentCandles: [],
    },
    recentTrades: [],
  };
}

describe('runStage1Screen', () => {
  afterEach(() => jest.clearAllMocks());

  test('pass/reject/escalate 분류 + 임계값 재검증', async () => {
    mockedRunLlmOnce.mockResolvedValue(JSON.stringify({
      decisions: [
        // pass — 명확한 strong setup
        { symbol: 'A', verdict: 'pass', confidence: 0.85, ev_estimate_pct: 1.2, reasoning_short: 'strong' },
        // reject — 명확한 weak
        { symbol: 'B', verdict: 'reject', confidence: 0.3, ev_estimate_pct: -0.5, reasoning_short: 'weak' },
        // 모델은 pass라 했지만 conf 낮음 → escalate로 보정
        { symbol: 'C', verdict: 'pass', confidence: 0.55, ev_estimate_pct: 0.6, reasoning_short: 'mid' },
        // 모델은 escalate인데 reject 임계 → reject로 강등
        { symbol: 'D', verdict: 'escalate', confidence: 0.3, ev_estimate_pct: 0.1, reasoning_short: 'low conf' },
      ],
    }));

    const inputs = ['A', 'B', 'C', 'D'].map(fakeInput);
    const result = await runStage1Screen(inputs, 'domestic');

    expect(result.decisions).toHaveLength(4);
    expect(result.stats).toEqual({ pass: 1, reject: 2, escalate: 1 });

    const map = Object.fromEntries(result.decisions.map(d => [d.symbol, d.verdict]));
    expect(map.A).toBe('pass');
    expect(map.B).toBe('reject');
    expect(map.C).toBe('escalate');     // 임계 보정
    expect(map.D).toBe('reject');       // 임계 보정
  });

  test('누락된 심볼은 escalate로 안전하게 채움', async () => {
    mockedRunLlmOnce.mockResolvedValue(JSON.stringify({
      decisions: [
        { symbol: 'A', verdict: 'pass', confidence: 0.9, ev_estimate_pct: 1.5, reasoning_short: 'ok' },
        // 'B'는 응답에 없음
      ],
    }));

    const inputs = ['A', 'B'].map(fakeInput);
    const result = await runStage1Screen(inputs, 'domestic');
    expect(result.decisions).toHaveLength(2);
    const b = result.decisions.find(d => d.symbol === 'B');
    expect(b?.verdict).toBe('escalate');
    expect(b?.reasoning).toContain('missing');
  });

  test('JSON parse 실패 → throw', async () => {
    mockedRunLlmOnce.mockResolvedValue('not json');
    await expect(runStage1Screen([fakeInput('A')], 'domestic')).rejects.toThrow(/JSON 미발견/);
  });

  test('decisions 배열 미발견 → throw', async () => {
    mockedRunLlmOnce.mockResolvedValue(JSON.stringify({ foo: 'bar' }));
    await expect(runStage1Screen([fakeInput('A')], 'domestic')).rejects.toThrow(/decisions 배열 미발견/);
  });

  test('빈 입력은 즉시 빈 결과', async () => {
    const result = await runStage1Screen([], 'domestic');
    expect(result.decisions).toEqual([]);
    expect(result.stats).toEqual({ pass: 0, reject: 0, escalate: 0 });
    expect(mockedRunLlmOnce).not.toHaveBeenCalled();
  });

  test('해외 시장 — Phase AB 모델 통합으로 stage=1만 전달 (domain은 RAG 라우팅용으로 제거)', async () => {
    mockedRunLlmOnce.mockResolvedValue(JSON.stringify({
      decisions: [{ symbol: 'AAPL', verdict: 'pass', confidence: 0.9, ev_estimate_pct: 1, reasoning_short: 'ok' }],
    }));

    await runStage1Screen([fakeInput('AAPL')], 'overseas');
    const opts = mockedRunLlmOnce.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.stage).toBe(1);
    // domain은 더 이상 LLM caller로 전달되지 않음 (도메인 통합 모델)
    expect(opts.domain).toBeUndefined();
  });
});
