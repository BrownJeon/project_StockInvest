import type { Candle } from '@/lib/exchanges/types';

export interface VolumeProfileResult {
  poc: number;   // Point of Control — 가장 거래량 많은 가격 (핵심 지지/저항)
  vah: number;   // Value Area High  — 70% 거래량 구간 상단 (저항선)
  val: number;   // Value Area Low   — 70% 거래량 구간 하단 (지지선)
}

/**
 * 30h 기준 Volume Profile 계산 (30m 캔들 60개 권장).
 *
 * 원리:
 *  1. 전체 가격 범위를 N개 버킷으로 분할
 *  2. 각 캔들의 거래량을 high~low 구간에 비례 배분
 *  3. 가장 거래량 많은 버킷 → POC
 *  4. POC 중심으로 위아래 확장하며 70% 누적 → VAH/VAL
 *
 * 반환 null: 캔들 부족 또는 가격 변동 없음.
 */
export function computeVolumeProfile(
  candles: Candle[],
  buckets = 50,
): VolumeProfileResult | null {
  if (candles.length < 5) return null;

  const hi = Math.max(...candles.map(c => c.high));
  const lo = Math.min(...candles.map(c => c.low));
  if (hi <= lo || !Number.isFinite(hi) || !Number.isFinite(lo)) return null;

  const step = (hi - lo) / buckets;
  const vol = new Float64Array(buckets);

  for (const c of candles) {
    if (!Number.isFinite(c.volume) || c.volume <= 0) continue;
    const range = c.high - c.low;
    // 고저 같은 캔들(도지)은 해당 버킷에 전량 배분
    if (range <= 0) {
      const b = Math.min(Math.floor((c.close - lo) / step), buckets - 1);
      vol[b] += c.volume;
      continue;
    }
    for (let b = 0; b < buckets; b++) {
      const bLo = lo + b * step;
      const bHi = bLo + step;
      const overlap = Math.min(c.high, bHi) - Math.max(c.low, bLo);
      if (overlap > 0) vol[b] += c.volume * (overlap / range);
    }
  }

  // POC — 가장 거래량 많은 버킷
  let pocBucket = 0;
  for (let b = 1; b < buckets; b++) if (vol[b] > vol[pocBucket]) pocBucket = b;
  const poc = lo + (pocBucket + 0.5) * step;

  // Value Area — POC에서 위아래로 70% 거래량 누적
  const totalVol = vol.reduce((s, v) => s + v, 0);
  if (totalVol <= 0) return null;
  const target = totalVol * 0.70;
  let sum = vol[pocBucket];
  let loIdx = pocBucket, hiIdx = pocBucket;

  while (sum < target) {
    const addLo = loIdx > 0 ? vol[loIdx - 1] : 0;
    const addHi = hiIdx < buckets - 1 ? vol[hiIdx + 1] : 0;
    if (addLo === 0 && addHi === 0) break;
    if (addLo >= addHi && loIdx > 0)      { sum += addLo; loIdx--; }
    else if (hiIdx < buckets - 1)          { sum += addHi; hiIdx++; }
    else if (loIdx > 0)                    { sum += addLo; loIdx--; }
    else break;
  }

  return {
    poc,
    vah: lo + (hiIdx + 1) * step,
    val: lo + loIdx * step,
  };
}

/**
 * 현재가의 매물대 상대 위치 레이블.
 * AI 프롬프트·로그에 사용.
 */
export function volumeProfilePositionLabel(
  price: number,
  vp: VolumeProfileResult,
): string {
  const { poc, vah, val } = vp;
  const pocRange = poc * 0.005; // POC ±0.5%
  if (price > vah)               return 'VAH 위 (매물 저항 돌파 — 강한 상승 or 과열)';
  if (Math.abs(price - vah) < pocRange) return 'VAH 근처 (저항선 — 추격 매수 주의)';
  if (Math.abs(price - poc) < pocRange) return 'POC 근처 (핵심 매물대 — 방향 확인 필요)';
  if (price < val)               return 'VAL 아래 (저평가 구간 — 매수 유리)';
  if (Math.abs(price - val) < pocRange) return 'VAL 근처 (지지선 — 매수 고려)';
  if (price < poc)               return 'Value Area 하단 (매물 지지 구간)';
  return 'Value Area 상단 (매물 저항 증가)';
}
