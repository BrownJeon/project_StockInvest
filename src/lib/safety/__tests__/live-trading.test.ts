/**
 * T-108 A-1 — 「실거래여부」 방향 변환 (가이드 §3.5).
 * 화면 ON = 실거래 가능 ⇔ 내부 dryRun=false. 방향을 틀리면 OFF 로 보이는데 실제 주문이 나간다 → 6가지 고정.
 */
import {
  LIVE_TRADING_LABEL,
  dryRunFromLiveTrading,
  liveTradingFromDryRun,
  liveTradingText,
} from '../live-trading';

describe('live-trading — 방향 변환', () => {
  it('① dryRun → 실거래여부: true→false(차단), false→true(가능)', () => {
    expect(liveTradingFromDryRun(true)).toBe(false);
    expect(liveTradingFromDryRun(false)).toBe(true);
  });

  it('② 실거래여부 → dryRun: true→false, false→true', () => {
    expect(dryRunFromLiveTrading(true)).toBe(false);
    expect(dryRunFromLiveTrading(false)).toBe(true);
  });

  it('③ 왕복 2방향 항등', () => {
    for (const d of [true, false]) expect(dryRunFromLiveTrading(liveTradingFromDryRun(d))).toBe(d);
    for (const l of [true, false]) expect(liveTradingFromDryRun(dryRunFromLiveTrading(l))).toBe(l);
  });

  it('④ 이상한 입력은 실거래 아님 (fail-closed)', () => {
    const odd: unknown[] = [undefined, null, 'false', 'true', 0, 1, '', {}, NaN];
    for (const v of odd) {
      expect(liveTradingFromDryRun(v as any)).toBe(false);
      // 역변환: true 리터럴이 아니면 dryRun=true(차단) 쪽
      expect(dryRunFromLiveTrading(v as any)).toBe(true);
    }
  });

  it('⑤ 라벨 문자열', () => {
    expect(LIVE_TRADING_LABEL).toBe('실거래여부');
  });

  it('⑥ 칩 문구 — ON=실거래 가능, OFF=실거래 차단 (이상 입력은 OFF 쪽)', () => {
    expect(liveTradingText(true)).toBe('ON · 실거래 가능');
    expect(liveTradingText(false)).toBe('OFF · 실거래 차단');
    expect(liveTradingText('true' as any)).toBe('OFF · 실거래 차단');
  });
});
