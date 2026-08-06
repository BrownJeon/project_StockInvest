/**
 * Phase 2 D3 기본 활성/비활성 룰 집합 — **순수 상수 모듈** (T-003 §3).
 *
 * 이 목록은 `db.ts` 의 **일회성 마이그레이션**(`migration_phase2_default_active_rules`)이
 * 딱 한 번 적용한다. 이후 `strategies.enabled` 의 주인은 영구히 UI 다 —
 * 부팅 재동기화는 D3 가 제거한 안티패턴이므로 코드가 다시 덮어쓰지 않는다.
 *
 * 선별 기준: 서로 다른 시장 국면 커버 + 룰 자체 조건 완결성 + 반자동 승인 리듬 적합성.
 * 예상 발화량 일 3~9건 후보(70종목, 정상 레짐) — 목표 구간 일 3~10건과 정합.
 */

/** 기본 활성 5종 — 국면 커버리지가 서로 겹치지 않는 최소 집합 */
export const DEFAULT_ACTIVE_RULES = [
  'rsi-oversold-v1',          // 1h · 과매도 반등   (RSI<38 + MA20 + 반등확인)
  'pullback-trend-v1',        // 1h · 상승추세 눌림 (EMA20>EMA60 내장)
  'bb-squeeze-expansion-v1',  // 1h · 횡보→변동성 확장 (squeeze 판정 자체가 상태 판별 내장)
  'weekly-trend-follow-v1',   // 1d · 장기 추세     (FIND_IN_SET 제거로 비로소 활성화됨)
  'rsi-overbought-exit-v1',   // 1h · 보유 청산
] as const;

/**
 * 기본 비활성 — 중복이거나 반자동 승인 리듬에 부적합한 룰.
 *
 * ⚠️ `price-breakout-v1` 은 **의도적으로 이 목록에 없다.** 이미 enabled=0 이고
 *    T-002 H4 의 `migration_disable_price_breakout_v1` 이 소유한 행이다. 두 마이그레이션이
 *    같은 행을 다투지 않도록 건드리지 않는다.
 * ⚠️ post-market 전용 3종(eod-high-close·inside-bar·oversold-bounce-daily)도 없다.
 *    장중 엔진이 아니라 post-market-engine 이 쓰는 행이라 그대로 둔다.
 */
export const DEFAULT_INACTIVE_RULES = [
  'volume-spike-breakout-v1',    // 추격형 — 승인 지연에 취약
  'rsi-macd-reversal-v1',        // rsi-oversold 와 중복 · 노이즈 3~5배(룰 주석 자인)
  'rsi-divergence-v1',           // 과매도 국면 중복 (저빈도)
  'triple-confirmation-v1',      // 과매도 국면 중복
  'ma-cross-v1',                 // 활성 룰과 중복
  'bb-breakout-v1',              // bb-squeeze 판과 중복
  'dividend-quality-buyback-v1', // 3~6개월 보유 전제 — 스윙 1~10일 정책과 불일치
] as const;

/** 이 마이그레이션이 **절대 건드리면 안 되는** 전략 ID (다른 소유자가 있는 행). */
export const MIGRATION_UNTOUCHED_RULES = [
  'price-breakout-v1',        // T-002 H4 소유
  'eod-high-close-v1',        // post-market-engine 전용
  'inside-bar-v1',            // post-market-engine 전용
  'oversold-bounce-daily-v1', // post-market-engine 전용
] as const;
