/**
 * T-108 A-2 — 운영 단계 파생 (가이드 §2.2 표).
 * dryRun·kill·validatedEnabled 각 {값 2종, null} 의 전 조합(27) → 기대 단계. `halt` 가 `observe` 보다 앞.
 */
import { liveTradingFromDryRun } from '@/lib/safety/live-trading';
import { deriveOpsStage, metricSetFor } from '../stage';
import type { OpsStage } from '../types';

function expected(dryRun: boolean | null, kill: boolean | null, ve: number | null): OpsStage {
  if (dryRun === null || kill === null || ve === null) return 'unknown';
  if (kill) return 'halt';
  if (dryRun) return 'observe';
  if (ve === 0) return 'mixed';
  return 'live';
}

describe('deriveOpsStage — 전 조합', () => {
  const dryRuns = [true, false, null] as const;
  const kills = [true, false, null] as const;
  const ves = [0, 1, null] as const;
  for (const d of dryRuns) for (const k of kills) for (const v of ves) {
    const want = expected(d, k, v);
    it(`dryRun=${d} kill=${k} validatedEnabled=${v} → ${want}`, () => {
      const liveTrading = d === null ? null : liveTradingFromDryRun(d);
      expect(deriveOpsStage({ liveTrading, killSwitch: k, validatedEnabled: v })).toBe(want);
    });
  }
});

describe('deriveOpsStage — 우선순위·경계', () => {
  it('모든거래차단 ON 은 실거래여부 ON·검증 통과 ≥1 이어도 halt', () => {
    expect(deriveOpsStage({ liveTrading: true, killSwitch: true, validatedEnabled: 5 })).toBe('halt');
  });
  it('실거래여부 OFF 는 검증 통과 0 이어도 observe (mixed 아님)', () => {
    expect(deriveOpsStage({ liveTrading: false, killSwitch: false, validatedEnabled: 0 })).toBe('observe');
  });
  it('db_unreachable·strategies_error 는 값이 있어도 unknown', () => {
    const ok = { liveTrading: true, killSwitch: false, validatedEnabled: 2 };
    expect(deriveOpsStage(ok, ['db_unreachable'])).toBe('unknown');
    expect(deriveOpsStage(ok, ['strategies_error'])).toBe('unknown');
  });
  it('청산 스위치 읽기 실패만으로는 단계가 바뀌지 않는다', () => {
    expect(deriveOpsStage({ liveTrading: false, killSwitch: false, validatedEnabled: 0 }, ['exit_switch_db_error'])).toBe('observe');
  });
  it('validatedEnabled 가 음수·소수·NaN 이면 unknown', () => {
    for (const v of [-1, 0.5, NaN]) {
      expect(deriveOpsStage({ liveTrading: true, killSwitch: false, validatedEnabled: v })).toBe('unknown');
    }
  });
  it('불리언이 아닌 값(문자열 등)은 unknown — 추측하지 않는다', () => {
    expect(deriveOpsStage({ liveTrading: 'true' as any, killSwitch: false, validatedEnabled: 1 })).toBe('unknown');
    expect(deriveOpsStage({ liveTrading: true, killSwitch: 'false' as any, validatedEnabled: 1 })).toBe('unknown');
  });
});

describe('metricSetFor', () => {
  it('observe·halt·unknown → 관찰 세트, mixed·live → 실거래 세트', () => {
    expect(metricSetFor('observe')).toBe('observe');
    expect(metricSetFor('halt')).toBe('observe');
    expect(metricSetFor('unknown')).toBe('observe');
    expect(metricSetFor('mixed')).toBe('live');
    expect(metricSetFor('live')).toBe('live');
  });
});
