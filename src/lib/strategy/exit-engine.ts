/**
 * exit-engine — 보유 포지션 통합 청산 시그널 생성기.
 *
 * 책임 (TradingInvest의 Dead Zone 결함을 SI에 미리 차단):
 *  - 하드 손절       : price ≤ avgEntry × (1 − hardStopPct/100) → market sell  (exit_kind=hard_stop)
 *  - 하드 익절       : price ≥ avgEntry × (1 + targetProfitPct/100) → market sell (exit_kind=target_profit)
 *  - 트레일링 스탑   : 평가익 ≥ trailingActivatePct% 활성 + 고점 대비 trailingDrawdownPct% 풀백 → market sell (exit_kind=trailing_stop)
 *  - EOD 손실 청산   : KST 15:20~15:29 + 손실 ≥ eodLossCutPct% → market sell (exit_kind=eod_loss_cut)
 *
 * 모든 시그널은 strategyId='exit-engine-v1' 로 발화. createSignal → submitOrder 정상 경로.
 * AI 필터는 우회 — 청산은 긴급도가 높고 룰 명확. (entry는 AI 필터 유지)
 *
 * 시간 기준:
 *  - 국내(domestic): KST 15:20~15:29 EOD 손절 적용. KIS 동시호가는 15:20 시작.
 *  - 해외(overseas): EOD 손절 미적용 (NYSE 마감 전 자동 청산은 별도 정책 필요 시 추후).
 *
 * trailing peak 갱신은 호출자(engine.ts)가 upsertPositionState로 매 틱 처리.
 * 본 파일은 "현재 시점 청산 여부 판정"만 담당하므로 순수 함수에 가깝다 (DB io 없음).
 */

import type { SignalInput } from '@/lib/signals/router';
import type { Ticker } from '@/lib/exchanges/types';
import type { Market } from '@/lib/exchanges/kis-symbols';
import type { StyleConfig } from './style';
import type { PositionState, ScenarioExitParams } from './position-state';

export type ExitKind = 'hard_stop' | 'target_profit' | 'trailing_stop' | 'eod_loss_cut';

export const EXIT_STRATEGY_ID = 'exit-engine-v1';

interface ExitEvalInput {
  symbol: string;
  market: Market;
  ticker: Ticker;
  state: PositionState;
  style: StyleConfig;
  /** 평가 시각 — 테스트 주입용. 기본값 new Date() */
  now?: Date;
}

/**
 * 보유 포지션 1건에 대해 청산 시그널 생성. 발화 조건 미충족 시 null.
 *
 * 우선순위 (가장 강한 신호부터 — 첫 매칭만 발화하여 중복 청산 시그널 방지):
 *   1. EOD 손실 청산 (시간 + 손실 임계 이중 충족)
 *   2. 하드 손절 — 시나리오 있으면 stopHi, 없으면 style.hardStopPct
 *   3. 시나리오 손절 (stopLo) — 시나리오 진입 포지션 전용
 *   4. 시나리오 익절 하드 캡 (targetHi) — 갭 상승 대비
 *   5. 목표 익절 — 시나리오 있으면 targetLo, 없으면 style.targetProfitPct
 *   6. 트레일링 스탑
 *
 * 사용자 시나리오 포지션: state.scenarioExit가 있으면 그 값을 우선 적용.
 */
export function evaluateExit(input: ExitEvalInput): (SignalInput & { strategyId: string; exitKind: ExitKind }) | null {
  const { symbol, market, ticker, state, style, now = new Date() } = input;
  const price = ticker.price;
  const entry = state.entryPrice;
  const peak  = state.peakPrice;
  const qty   = state.qty;
  const sc: ScenarioExitParams | null = state.scenarioExit ?? null;

  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(entry) || entry <= 0) return null;

  // ─── 단위(unit) sanity check ─────────────────────────────────────
  // price와 entry는 동일 통화·단위여야 한다. 과거 회귀 사례:
  //  2026-05-13 사고 — overseas 잔고 avgPrice가 USD raw 였고 ticker.price는 KRW 환산이라
  //  pnlPct ≈ +106,677% 로 계산되어 target_profit 11건 오발화. Kill Switch가 우연히 차단.
  // 정상 보유 종목의 price/entry 비율은 통상 [0.5, 2.0]. 안전 마진을 두고 [0.3, 3.0]
  // 초과 시 단위 불일치로 간주하고 시그널을 즉시 거부한다 (오발화 < 미발화가 안전).
  const ratio = price / entry;
  if (ratio < 0.3 || ratio > 3.0) {
    console.warn(
      `[exit-engine:unit-mismatch] ${symbol} (${market}) price/entry ratio=${ratio.toFixed(4)} ` +
      `out of [0.3, 3.0] — likely USD/KRW unit mismatch. price=${price} entry=${entry}. ` +
      `Skipping exit signal to prevent false target_profit/hard_stop fire.`,
    );
    return null;
  }

  const pnlPct = (price - entry) / entry * 100;

  // ─── 1) EOD 손실 청산 (국내장만) ─────────────────────────────────
  // KST 15:20~15:29 + 손실 ≥ eodLossCutPct → market sell.
  if (market === 'domestic' && isEodWindowKST(now) && pnlPct <= -style.eodLossCutPct) {
    return buildSellSignal({
      symbol, ticker, qty, exitKind: 'eod_loss_cut', entry, price, pnlPct, peak,
      reasonHead: '[EOD 손절]',
      detail: `KST 15:20~15:29 동시호가, 손실 ${pnlPct.toFixed(2)}% ≤ -${style.eodLossCutPct}% → 시장가 청산`,
    });
  }

  // ─── 2) 하드 손절 ────────────────────────────────────────────────
  // 시나리오 있으면 stopHi(갭 하락 캡), 없으면 style.hardStopPct
  const hardStopThreshold = sc ? sc.stopHi : style.hardStopPct;
  if (pnlPct <= -hardStopThreshold) {
    return buildSellSignal({
      symbol, ticker, qty, exitKind: 'hard_stop', entry, price, pnlPct, peak,
      reasonHead: '[하드 손절]',
      detail: `손실 ${pnlPct.toFixed(2)}% ≤ -${hardStopThreshold}% → 시장가 청산 (자금 보호)`,
    });
  }

  // ─── 3) 시나리오 손절 (stopLo) — 시나리오 포지션 전용 ────────────
  if (sc && pnlPct <= -sc.stopLo) {
    return buildSellSignal({
      symbol, ticker, qty, exitKind: 'hard_stop', entry, price, pnlPct, peak,
      reasonHead: '[시나리오 손절]',
      detail: `손실 ${pnlPct.toFixed(2)}% ≤ -${sc.stopLo}% (시나리오 손절 범위 진입) → 시장가 청산`,
    });
  }

  // ─── 4) 시나리오 익절 하드 캡 (targetHi) — 갭 상승 시 ────────────
  if (sc && pnlPct >= sc.targetHi) {
    return buildSellSignal({
      symbol, ticker, qty, exitKind: 'target_profit', entry, price, pnlPct, peak,
      reasonHead: '[시나리오 익절 캡]',
      detail: `평가익 ${pnlPct.toFixed(2)}% ≥ +${sc.targetHi}% (하드 캡) → 시장가 익절`,
    });
  }

  // ─── 5) 목표 익절 ────────────────────────────────────────────────
  // 시나리오 있으면 targetLo, 없으면 style.targetProfitPct
  const targetThreshold = sc ? sc.targetLo : style.targetProfitPct;
  if (pnlPct >= targetThreshold) {
    return buildSellSignal({
      symbol, ticker, qty, exitKind: 'target_profit', entry, price, pnlPct, peak,
      reasonHead: '[목표 익절]',
      detail: `평가익 ${pnlPct.toFixed(2)}% ≥ +${targetThreshold}% → 시장가 익절`,
    });
  }

  // ─── 6) 트레일링 스탑 ─────────────────────────────────────────────
  // 활성: 보유 후 peak가 entry 대비 trailingActivatePct% 이상 상승했어야 함
  // 풀백: 현재가가 peak 대비 trailingDrawdownPct% 이상 하락
  const peakGainPct = (peak - entry) / entry * 100;
  if (peakGainPct >= style.trailingActivatePct) {
    const drawdownPct = (peak - price) / peak * 100;
    if (drawdownPct >= style.trailingDrawdownPct) {
      return buildSellSignal({
        symbol, ticker, qty, exitKind: 'trailing_stop', entry, price, pnlPct, peak,
        reasonHead: '[트레일링 스탑]',
        detail: `peak ${peak.toFixed(0)} (활성 +${peakGainPct.toFixed(2)}%), 풀백 -${drawdownPct.toFixed(2)}% ≥ ${style.trailingDrawdownPct}% → 시장가 청산 (실현 +${pnlPct.toFixed(2)}%)`,
      });
    }
  }

  return null;
}

/**
 * KST 기준 15:20~15:29 (closing auction) 여부.
 * exitWindowMinStart=20, exitWindowMinEnd=30 (15:30 이후는 폐장이라 시그널 무의미).
 */
export function isEodWindowKST(now: Date = new Date()): boolean {
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const day = kst.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = kst.getHours() * 60 + kst.getMinutes();
  return minutes >= 15 * 60 + 20 && minutes < 15 * 60 + 30;
}

/**
 * KST 기준 lateSessionBuyBlockMin 분 이내 폐장 여부 (기본 30분 → 15:00 이후).
 * 15:30 폐장 기준으로 차단 시작 시각 = (15*60 + 30) - lateSessionBuyBlockMin
 */
export function isLateSessionBuyBlockKST(now: Date, blockMin: number): boolean {
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const day = kst.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = kst.getHours() * 60 + kst.getMinutes();
  const blockStart = 15 * 60 + 30 - blockMin;
  return minutes >= blockStart && minutes < 15 * 60 + 30;
}

interface BuildSellArgs {
  symbol: string;
  ticker: Ticker;
  qty: number | null;
  exitKind: ExitKind;
  entry: number;
  price: number;
  pnlPct: number;
  peak: number;
  reasonHead: string;
  detail: string;
}

function buildSellSignal(a: BuildSellArgs): SignalInput & { strategyId: string; exitKind: ExitKind } {
  const heldQty = a.qty ?? 0;
  const heldValue = Math.round(heldQty * a.price);
  return {
    strategyId: EXIT_STRATEGY_ID,
    symbol: a.symbol,
    side: 'sell',
    orderType: 'market',
    price: a.price,
    quantity: heldQty > 0 ? heldQty : undefined,
    amountKRW: heldValue,
    reasoning: `${a.reasonHead} ${a.detail}`,
    indicators: {
      exit_kind: a.exitKind,
      entry_price: a.entry,
      current_price: a.price,
      peak_price: a.peak,
      pnl_pct: Number(a.pnlPct.toFixed(4)),
    },
    exitKind: a.exitKind,
  };
}
