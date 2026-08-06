/**
 * StyleConfig DB override 단위 테스트 (T-003 §3, Phase 2 Step 4).
 *
 * 계약: 백테스트 미검증 파라미터는 **코드 default 를 바꾸지 않고 DB override 로만** 적용한다.
 * 롤백 = `style_default_*` 키 삭제 → 코드 default 로 즉시 복귀.
 */
import { getPool } from '@/lib/db';
import {
  DEFAULT_STYLE_CONFIG,
  getStyleConfig,
  invalidateStyleOverrideCache,
} from '../style';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));

function mockOverrides(map: Record<string, number | string>) {
  const rows = Object.entries(map).map(([key, value]) => ({ key, value: JSON.stringify(value) }));
  (getPool as jest.Mock).mockReturnValue({ query: jest.fn(async () => [rows]) });
}

beforeEach(() => {
  jest.clearAllMocks();
  invalidateStyleOverrideCache();
});

describe('운영 override 시드값 적용', () => {
  test('rsiBuyThreshold 35 → 38 (P(RSI<38)=10.9% vs 5.8%)', async () => {
    mockOverrides({ style_default_rsiBuyThreshold: 38 });
    expect((await getStyleConfig()).rsiBuyThreshold).toBe(38);
  });

  test('pullback 눌림 창 42~48 → 40~50', async () => {
    mockOverrides({ style_default_pullbackRsiMin: 40, style_default_pullbackRsiMax: 50 });
    const s = await getStyleConfig();
    expect(s.pullbackRsiMin).toBe(40);
    expect(s.pullbackRsiMax).toBe(50);
  });

  test('bb-squeeze 거래량비 0.7 → 1.2 (AI 부재 보상 — 가짜 돌파 필터 강화)', async () => {
    mockOverrides({ style_default_bbSqueezeVolRatioMin: 1.2 });
    expect((await getStyleConfig()).bbSqueezeVolRatioMin).toBe(1.2);
  });

  test('비용 파라미터도 override 가능', async () => {
    mockOverrides({ style_default_feePct: 0.2, style_default_slippagePct: 0.25 });
    const s = await getStyleConfig();
    expect(s.feePct).toBe(0.2);
    expect(s.slippagePct).toBe(0.25);
  });
});

describe('override 안전장치', () => {
  test('DB 조회 실패 시 코드 default 로 폴백한다', async () => {
    (getPool as jest.Mock).mockReturnValue({ query: jest.fn(async () => { throw new Error('db down'); }) });
    const s = await getStyleConfig();
    expect(s.rsiBuyThreshold).toBe(DEFAULT_STYLE_CONFIG.rsiBuyThreshold);
    expect(s.pullbackRsiMin).toBe(DEFAULT_STYLE_CONFIG.pullbackRsiMin);
  });

  test('범위 밖 값은 무시된다 — 비용 0 은 무료 거래 가정이라 허용 불가', async () => {
    mockOverrides({ style_default_feePct: 0, style_default_slippagePct: -1 });
    const s = await getStyleConfig();
    expect(s.feePct).toBe(DEFAULT_STYLE_CONFIG.feePct);
    expect(s.slippagePct).toBe(DEFAULT_STYLE_CONFIG.slippagePct);
  });

  test('눌림 창이 뒤집히면(min ≥ max) 둘 다 코드 default 로 되돌린다', async () => {
    // 창이 공집합이면 룰이 조용히 영구 미발화가 된다 — market-state 데드락과 같은 사고 유형.
    mockOverrides({ style_default_pullbackRsiMin: 55, style_default_pullbackRsiMax: 45 });
    const s = await getStyleConfig();
    expect(s.pullbackRsiMin).toBe(DEFAULT_STYLE_CONFIG.pullbackRsiMin);
    expect(s.pullbackRsiMax).toBe(DEFAULT_STYLE_CONFIG.pullbackRsiMax);
    expect(s.pullbackRsiMin).toBeLessThan(s.pullbackRsiMax);
  });

  test('override 가 전혀 없으면 전 필드가 코드 default', async () => {
    mockOverrides({});
    expect(await getStyleConfig()).toEqual(DEFAULT_STYLE_CONFIG);
  });
});
