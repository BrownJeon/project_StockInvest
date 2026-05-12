import { computeVolumeProfile, volumeProfilePositionLabel } from '../volume-profile';
import type { Candle } from '@/lib/exchanges/types';

function candle(open: number, high: number, low: number, close: number, volume: number, ts = 0): Candle {
  return { ts, open, high, low, close, volume };
}

describe('computeVolumeProfile', () => {
  test('캔들 부족 → null', () => {
    expect(computeVolumeProfile([])).toBeNull();
    expect(computeVolumeProfile([candle(100, 110, 90, 105, 10)])).toBeNull();
  });

  test('균등 거래량 — POC 가 중간에', () => {
    // 100~200 범위에 균일하게 거래된 캔들
    const candles = Array.from({ length: 10 }, (_, i) =>
      candle(100 + i * 10, 110 + i * 10, 100 + i * 10, 105 + i * 10, 100),
    );
    const vp = computeVolumeProfile(candles, 20);
    expect(vp).not.toBeNull();
    expect(vp!.poc).toBeGreaterThanOrEqual(100);
    expect(vp!.poc).toBeLessThanOrEqual(210);
  });

  test('특정 가격에 거래량 집중 → POC 그 근처', () => {
    // 150~160 구간에 압도적 거래량
    const candles = [
      candle(100, 200, 100, 150, 5),   // 전체 범위, 소량
      candle(150, 162, 148, 155, 1000), // 150~162 집중
      candle(148, 161, 147, 153, 1000),
      candle(149, 163, 148, 156, 1000),
      candle(100, 200, 100, 150, 5),
    ];
    const vp = computeVolumeProfile(candles, 50);
    expect(vp).not.toBeNull();
    // POC는 150 근처여야 함
    expect(vp!.poc).toBeGreaterThan(140);
    expect(vp!.poc).toBeLessThan(170);
  });

  test('VAH > POC > VAL 순서 보장', () => {
    const candles = Array.from({ length: 20 }, (_, i) =>
      candle(1000 + i * 5, 1010 + i * 5, 995 + i * 5, 1005 + i * 5, Math.random() * 100 + 10),
    );
    const vp = computeVolumeProfile(candles, 50);
    expect(vp).not.toBeNull();
    expect(vp!.vah).toBeGreaterThanOrEqual(vp!.poc);
    expect(vp!.poc).toBeGreaterThanOrEqual(vp!.val);
  });

  test('도지 캔들(high=low) — 처리 안전', () => {
    const candles = [
      candle(100, 150, 50, 100, 50),
      candle(100, 100, 100, 100, 200),  // 도지
      candle(100, 150, 50, 100, 50),
      candle(100, 100, 100, 100, 200),
      candle(100, 150, 50, 100, 50),
    ];
    expect(() => computeVolumeProfile(candles)).not.toThrow();
  });
});

describe('volumeProfilePositionLabel', () => {
  const vp = { poc: 1000, vah: 1050, val: 950 };

  test('VAH 위', () => {
    expect(volumeProfilePositionLabel(1100, vp)).toContain('VAH 위');
  });
  test('VAH 근처', () => {
    expect(volumeProfilePositionLabel(1048, vp)).toContain('VAH 근처');
  });
  test('POC 근처', () => {
    expect(volumeProfilePositionLabel(1003, vp)).toContain('POC 근처');
  });
  test('VAL 아래', () => {
    expect(volumeProfilePositionLabel(900, vp)).toContain('VAL 아래');
  });
  test('VAL 근처', () => {
    expect(volumeProfilePositionLabel(953, vp)).toContain('VAL 근처');
  });
});
