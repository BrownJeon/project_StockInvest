/**
 * Phase 2 D3 기본 활성 룰 집합 · 비용 모델 단위 테스트 (T-003 §3).
 *
 * 이 테스트가 막는 사고:
 *  1. 마이그레이션 ID 오타 → 엉뚱한 룰이 조용히 켜지거나 꺼진다. 운영 DB 를 직접 바꾸는
 *     일회성 UPDATE 라서 오타의 대가가 크고, 마커 때문에 **두 번째 기회가 없다.**
 *  2. 두 목록이 겹치면 같은 부팅에서 켰다 껐다 하는 비결정 동작이 된다.
 *  3. 다른 마이그레이션·실행기가 소유한 행(price-breakout / post-market 3종)을 건드리는 것.
 */
import {
  DEFAULT_ACTIVE_RULES,
  DEFAULT_INACTIVE_RULES,
  MIGRATION_UNTOUCHED_RULES,
} from '../rules/defaults';
import { STRATEGY_REGISTRY } from '../rules';
import { DEFAULT_STYLE_CONFIG, roundTripCostPct } from '../style';

describe('기본 활성 룰 집합 (D3)', () => {
  test('활성 5종 — 사양 §3 선별 그대로', () => {
    expect([...DEFAULT_ACTIVE_RULES]).toEqual([
      'rsi-oversold-v1',
      'pullback-trend-v1',
      'bb-squeeze-expansion-v1',
      'weekly-trend-follow-v1',
      'rsi-overbought-exit-v1',
    ]);
  });

  test('활성/비활성 목록이 겹치지 않는다', () => {
    const overlap = DEFAULT_ACTIVE_RULES.filter(id => (DEFAULT_INACTIVE_RULES as readonly string[]).includes(id));
    expect(overlap).toEqual([]);
  });

  test('두 목록 모두 코드 레지스트리에 실존하는 ID 만 담는다 (오타 차단)', () => {
    for (const id of [...DEFAULT_ACTIVE_RULES, ...DEFAULT_INACTIVE_RULES]) {
      expect(STRATEGY_REGISTRY[id]).toBeDefined();
    }
  });

  test('다른 소유자의 행은 어느 목록에도 없다', () => {
    for (const id of MIGRATION_UNTOUCHED_RULES) {
      expect(DEFAULT_ACTIVE_RULES as readonly string[]).not.toContain(id);
      expect(DEFAULT_INACTIVE_RULES as readonly string[]).not.toContain(id);
    }
  });

  test('price-breakout-v1 은 재활성화되지 않는다 (재설계 전까지 금지)', () => {
    expect(DEFAULT_ACTIVE_RULES as readonly string[]).not.toContain('price-breakout-v1');
  });

  test('장중 활성 룰은 1h, 장기 룰은 1d — 축이 섞이지 않는다', () => {
    const intervals = DEFAULT_ACTIVE_RULES.map(id => STRATEGY_REGISTRY[id].interval);
    expect(new Set(intervals)).toEqual(new Set(['1h', '1d']));
    expect(STRATEGY_REGISTRY['weekly-trend-follow-v1'].interval).toBe('1d');
  });

  test('국면 커버리지 — 청산 룰이 반드시 포함된다 (보유 보호)', () => {
    expect(DEFAULT_ACTIVE_RULES as readonly string[]).toContain('rsi-overbought-exit-v1');
  });
});

describe('비용 모델 (§3)', () => {
  test('명시 비용과 슬리피지가 분리돼 있다', () => {
    expect(DEFAULT_STYLE_CONFIG.feePct).toBeCloseTo(0.18, 5);
    expect(DEFAULT_STYLE_CONFIG.slippagePct).toBeCloseTo(0.15, 5);
  });

  test('실효 왕복 비용은 0.33% — 구 하드코딩 0.43% 보다 낮다 (2.4배 과대였음)', () => {
    const c = roundTripCostPct(DEFAULT_STYLE_CONFIG);
    expect(c).toBeCloseTo(0.33, 5);
    expect(c).toBeLessThan(0.43);
  });

  test('실효 왕복 비용이 실측 상단 구간(0.28~0.38%) 안에 있다', () => {
    const c = roundTripCostPct(DEFAULT_STYLE_CONFIG);
    expect(c).toBeGreaterThanOrEqual(0.28);
    expect(c).toBeLessThanOrEqual(0.38);
  });

  test('EV 하한 — targetProfitPct 는 p=50% 기준 손익분기 T 위에 있어야 한다', () => {
    // p×T − (1−p)×S − C > 0,  p=0.5, S=hardStopPct, C=왕복비용
    const S = DEFAULT_STYLE_CONFIG.hardStopPct;
    const C = roundTripCostPct(DEFAULT_STYLE_CONFIG);
    const breakevenT = (0.5 * S + C) / 0.5;      // = S + 2C
    expect(breakevenT).toBeCloseTo(1.5 + 0.66, 5);
    expect(DEFAULT_STYLE_CONFIG.targetProfitPct).toBeGreaterThan(breakevenT);
  });

  test('손익비는 1.5 이상을 유지한다', () => {
    expect(DEFAULT_STYLE_CONFIG.targetProfitPct / DEFAULT_STYLE_CONFIG.hardStopPct)
      .toBeGreaterThanOrEqual(1.5);
  });
});

describe('룰 파라미터 코드 default — DB override 로만 운영값 적용 (백테스트 미완료)', () => {
  test('코드 default 는 현행 값을 유지한다', () => {
    expect(DEFAULT_STYLE_CONFIG.rsiBuyThreshold).toBe(35);
    expect(DEFAULT_STYLE_CONFIG.pullbackRsiMin).toBe(42);
    expect(DEFAULT_STYLE_CONFIG.pullbackRsiMax).toBe(48);
    expect(DEFAULT_STYLE_CONFIG.bbSqueezeVolRatioMin).toBe(0.7);
  });

  test('눌림 창 default 는 공집합이 아니다', () => {
    expect(DEFAULT_STYLE_CONFIG.pullbackRsiMin).toBeLessThan(DEFAULT_STYLE_CONFIG.pullbackRsiMax);
  });
});
