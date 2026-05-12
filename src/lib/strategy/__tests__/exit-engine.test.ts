/**
 * exit-engine 단위 테스트:
 *  - hard_stop, target_profit, trailing_stop, eod_loss_cut 4개 시나리오
 *  - isLateSessionBuyBlockKST 시간대 판정
 *  - isEodWindowKST 시간대 판정
 *  - 우선순위 (EOD > hard_stop > target > trailing)
 *  - 무발화 케이스 (Dead Zone 영역에서 출구 보장)
 */

import { evaluateExit, isEodWindowKST, isLateSessionBuyBlockKST } from '../exit-engine';
import type { StyleConfig } from '../style';
import { DEFAULT_STYLE_CONFIG } from '../style';
import type { Ticker } from '@/lib/exchanges/types';
import type { PositionState } from '../position-state';

const STYLE: StyleConfig = {
  ...DEFAULT_STYLE_CONFIG,
  hardStopPct: 1.5,
  targetProfitPct: 1.5,
  trailingActivatePct: 3.5,
  trailingDrawdownPct: 1.2,
  eodLossCutPct: 1.5,
};

function ticker(price: number): Ticker {
  return { symbol: '005930', price, timestamp: 0 };
}

function state(entry: number, peak = entry): PositionState {
  return {
    symbol: '005930', market: 'domestic',
    entryPrice: entry, peakPrice: peak, qty: 10,
    firstSeenAt: new Date(), updatedAt: new Date(),
  };
}

// 평일 정오(EOD 윈도우 외) — 시간 의존 분기에서 EOD 발화를 막기 위해 사용.
const NOON_KST = (() => {
  // 2026-05-11 (월요일) 12:00 KST = 03:00 UTC
  return new Date('2026-05-11T03:00:00Z');
})();

// EOD 윈도우 내 (15:25 KST = 06:25 UTC)
const EOD_KST = new Date('2026-05-11T06:25:00Z');

// 토요일 — EOD/late 차단 미적용 검증용
const SAT_NOON = new Date('2026-05-09T03:00:00Z');

describe('exit-engine', () => {
  describe('isEodWindowKST', () => {
    it('15:20~15:29 평일 KST 구간이면 true', () => {
      expect(isEodWindowKST(EOD_KST)).toBe(true);
    });
    it('정오는 false', () => {
      expect(isEodWindowKST(NOON_KST)).toBe(false);
    });
    it('15:30 이후는 false', () => {
      // 15:30 KST = 06:30 UTC
      expect(isEodWindowKST(new Date('2026-05-11T06:30:00Z'))).toBe(false);
    });
    it('주말은 false', () => {
      // 토요일 15:25
      expect(isEodWindowKST(new Date('2026-05-09T06:25:00Z'))).toBe(false);
    });
  });

  describe('isLateSessionBuyBlockKST', () => {
    it('blockMin=30이면 15:00 이후 true', () => {
      // 15:05 KST = 06:05 UTC
      expect(isLateSessionBuyBlockKST(new Date('2026-05-11T06:05:00Z'), 30)).toBe(true);
    });
    it('blockMin=30이고 14:55면 false', () => {
      // 14:55 KST = 05:55 UTC
      expect(isLateSessionBuyBlockKST(new Date('2026-05-11T05:55:00Z'), 30)).toBe(false);
    });
    it('blockMin=0이면 항상 false', () => {
      expect(isLateSessionBuyBlockKST(new Date('2026-05-11T06:25:00Z'), 0)).toBe(false);
    });
    it('주말은 false', () => {
      expect(isLateSessionBuyBlockKST(SAT_NOON, 30)).toBe(false);
    });
  });

  describe('evaluateExit', () => {
    it('손실 -1.5% 이상 → hard_stop', () => {
      const sig = evaluateExit({
        symbol: '005930', market: 'domestic',
        ticker: ticker(98_500), state: state(100_000),
        style: STYLE, now: NOON_KST,
      });
      expect(sig).not.toBeNull();
      expect(sig!.exitKind).toBe('hard_stop');
      expect(sig!.side).toBe('sell');
      expect(sig!.orderType).toBe('market');
    });

    it('익절 +1.5% 이상 → target_profit', () => {
      const sig = evaluateExit({
        symbol: '005930', market: 'domestic',
        ticker: ticker(101_500), state: state(100_000),
        style: STYLE, now: NOON_KST,
      });
      expect(sig).not.toBeNull();
      expect(sig!.exitKind).toBe('target_profit');
    });

    it('peak +3.5% 활성 + 풀백 -1.2% → trailing_stop', () => {
      // entry=100000, peak=103500 (+3.5%), 현재가 102258 (peak 대비 -1.2%)
      // target_profit이 +1.5%로 먼저 발화되지 않게 targetProfitPct를 5%로 올린 컨텍스트.
      const styleHighTarget: StyleConfig = { ...STYLE, targetProfitPct: 5.0 };
      const sig = evaluateExit({
        symbol: '005930', market: 'domestic',
        ticker: ticker(102_258), state: state(100_000, 103_500),
        style: styleHighTarget, now: NOON_KST,
      });
      expect(sig).not.toBeNull();
      expect(sig!.exitKind).toBe('trailing_stop');
    });

    it('EOD 윈도우 + 손실 -1.5% → eod_loss_cut (hard_stop 우선순위 우선)', () => {
      const sig = evaluateExit({
        symbol: '005930', market: 'domestic',
        ticker: ticker(98_500), state: state(100_000),
        style: STYLE, now: EOD_KST,
      });
      expect(sig).not.toBeNull();
      expect(sig!.exitKind).toBe('eod_loss_cut');
    });

    it('해외 시장은 EOD 미적용 — 같은 손실이면 hard_stop으로 발화', () => {
      const sig = evaluateExit({
        symbol: 'AAPL', market: 'overseas',
        ticker: ticker(98_500),
        state: { ...state(100_000), market: 'overseas', symbol: 'AAPL' },
        style: STYLE, now: EOD_KST,
      });
      expect(sig).not.toBeNull();
      expect(sig!.exitKind).toBe('hard_stop');
    });

    it('손실 -1.0% (Dead Zone 영역) → trailing 활성 없으면 무발화 (TI Dead Zone과 달리 -1.5% 곧 발화)', () => {
      // -1.0%는 hardStopPct=1.5보다 작아 hard_stop 미발화
      // peak=entry이므로 trailing 미활성
      // → null이 정상 (다음 cron 틱에서 -1.5% 도달하면 발화)
      const sig = evaluateExit({
        symbol: '005930', market: 'domestic',
        ticker: ticker(99_000), state: state(100_000),
        style: STYLE, now: NOON_KST,
      });
      expect(sig).toBeNull();
    });

    it('peak +3.0% (활성 미달) + 풀백 → trailing 미발화', () => {
      const sig = evaluateExit({
        symbol: '005930', market: 'domestic',
        ticker: ticker(101_500), state: state(100_000, 103_000),
        style: STYLE, now: NOON_KST,
      });
      // 익절(+1.5%)가 먼저 발화 → target_profit
      expect(sig).not.toBeNull();
      expect(sig!.exitKind).toBe('target_profit');
    });

    it('잘못된 가격(0/음수)에는 null', () => {
      expect(evaluateExit({
        symbol: '005930', market: 'domestic',
        ticker: ticker(0), state: state(100_000),
        style: STYLE, now: NOON_KST,
      })).toBeNull();
      expect(evaluateExit({
        symbol: '005930', market: 'domestic',
        ticker: ticker(-1), state: state(100_000),
        style: STYLE, now: NOON_KST,
      })).toBeNull();
    });

    it('시그널 indicators에 exit_kind/entry/peak/pnl 보존', () => {
      const sig = evaluateExit({
        symbol: '005930', market: 'domestic',
        ticker: ticker(98_500), state: state(100_000),
        style: STYLE, now: NOON_KST,
      });
      expect(sig).not.toBeNull();
      const ind = sig!.indicators as Record<string, unknown>;
      expect(ind.exit_kind).toBe('hard_stop');
      expect(ind.entry_price).toBe(100_000);
      expect(ind.current_price).toBe(98_500);
      expect(ind.pnl_pct).toBeCloseTo(-1.5, 4);
    });

    it('EOD 손실 -2% 시 EOD 우선 (hard_stop 동시 충족이지만 EOD가 먼저 매칭)', () => {
      const sig = evaluateExit({
        symbol: '005930', market: 'domestic',
        ticker: ticker(98_000), state: state(100_000),
        style: STYLE, now: EOD_KST,
      });
      expect(sig).not.toBeNull();
      expect(sig!.exitKind).toBe('eod_loss_cut');
    });
  });
});
