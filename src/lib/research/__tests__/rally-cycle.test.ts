/**
 * 사이클 탐지 알고리즘 검증 — T-032.
 * 전 구간 결정적(고정 배열) — 난수 없음.
 */
import { detectRallyEvents } from '../pattern/rally-cycle';
import type { DailyCandle, RallyCycleConfig } from '../types';

const CFG: Partial<RallyCycleConfig> = {
  lookbackDays: 5,
  rallyWindowDays: 3,
  rallyThresholdPct: 15,
  postRallyDeclineWindowDays: 3,
  postRallyDeclinePct: 10,
};

/** 종가만 주면 high=low=open=close 인 캔들 시계열을 만든다(테스트 단순화). */
function mk(closes: number[]): DailyCandle[] {
  return closes.map((c, i) => ({
    date: new Date(Date.UTC(2022, 0, 1) + i * 86400000).toISOString().slice(0, 10),
    open: c, high: c, low: c, close: c, volume: 1000,
  }));
}

describe('detectRallyEvents — 기본 탐지', () => {
  test('하락 → 급등 → 재하락 1사이클을 정확히 잡는다', () => {
    const candles = mk([100, 95, 90, 85, 80, 100, 98, 95, 88, 90, 92, 95]);
    const r = detectRallyEvents(candles, CFG);

    expect(r.events).toHaveLength(1);
    const e = r.events[0];
    expect(e.troughIndex).toBe(4);
    expect(e.troughClose).toBe(80);
    expect(e.peakIndex).toBe(5);
    expect(e.peakPrice).toBe(100);
    expect(e.rallyPct).toBeCloseTo(25, 8);
    expect(e.daysToRally).toBe(1);
    expect(e.confirmedCycle).toBe(true);
    expect(e.declinePct).toBeCloseTo(12, 8);   // (100-88)/100
    expect(e.daysToDecline).toBe(3);
    expect(e.declineDate).toBe(candles[8].date);

    expect(r.troughIndices).toEqual([4]);
    expect(r.pendingTroughCount).toBe(0);
    expect(r.avgRallyPct).toBeCloseTo(25, 8);
    expect(r.avgDaysToRally).toBeCloseTo(1, 8);
  });

  test('임계치 미달 상승은 이벤트가 아니다', () => {
    const r = detectRallyEvents(mk([100, 95, 90, 85, 80, 81, 82, 83]), CFG);
    expect(r.events).toHaveLength(0);
    expect(r.pendingTroughCount).toBe(0); // forward window가 온전히 관측됨 → 보류 아님
  });
});

describe('detectRallyEvents — 엣지 케이스', () => {
  test('평탄 trough 는 최초 인덱스만 채택한다(결정적)', () => {
    // index 2·3 종가가 동률 100 — trough 는 2 하나여야 한다
    const candles = mk([120, 110, 100, 100, 130, 131, 132]);
    const r = detectRallyEvents(candles, { ...CFG, lookbackDays: 3, rallyWindowDays: 2 });
    expect(r.troughIndices).toEqual([2]);
    expect(r.events[0].peakIndex).toBe(4);
    expect(r.events[0].rallyPct).toBeCloseTo(30, 8);
  });

  test('이벤트 발견 후 peak 다음으로 점프해 중복 카운트하지 않는다', () => {
    const candles = mk([100, 95, 90, 85, 80, 100, 98, 95, 88, 90, 92, 95]);
    const r = detectRallyEvents(candles, CFG);
    // trough(4) 이후 인덱스 5~8도 국소 저점처럼 보이지만 이벤트는 1건뿐
    expect(r.events).toHaveLength(1);
  });

  test('forward window 가 시계열 끝에 걸리고 랠리도 없으면 "랠리 없음"이 아니라 보류', () => {
    const r = detectRallyEvents(mk([100, 95, 90, 85, 80, 81, 82]), CFG);
    expect(r.events).toHaveLength(0);
    expect(r.pendingTroughCount).toBe(1);
  });

  test('재하락 관측 구간이 없으면 confirmedCycle = null (false 로 단정하지 않는다)', () => {
    const r = detectRallyEvents(mk([100, 95, 90, 85, 80, 100]), CFG);
    expect(r.events).toHaveLength(1);
    expect(r.events[0].confirmedCycle).toBeNull();
    expect(r.events[0].declinePct).toBeNull();
  });

  test('재하락 구간을 다 봤는데 얕으면 confirmedCycle = false', () => {
    const r = detectRallyEvents(mk([100, 95, 90, 85, 80, 100, 99, 98, 97]), CFG);
    expect(r.events).toHaveLength(1);
    expect(r.events[0].confirmedCycle).toBe(false);
    expect(r.events[0].declinePct).toBeCloseTo(3, 8);
  });

  test('재하락 구간이 잘렸고 아직 조건 미달이면 confirmedCycle = null', () => {
    // peak=5, declineWindow=3 인데 데이터가 index 7 까지만 있다
    const r = detectRallyEvents(mk([100, 95, 90, 85, 80, 100, 99, 98]), CFG);
    expect(r.events[0].confirmedCycle).toBeNull();
    expect(r.events[0].declinePct).toBeCloseTo(2, 8);
  });

  test('빈 배열·짧은 이력은 예외 없이 빈 결과', () => {
    expect(detectRallyEvents([], CFG).events).toEqual([]);
    expect(detectRallyEvents(mk([100, 90]), CFG).events).toEqual([]);
    expect(detectRallyEvents(mk([100, 90]), CFG).avgRallyPct).toBeNull();
  });

  test('잘못된 설정은 즉시 던진다', () => {
    expect(() => detectRallyEvents(mk([1, 2, 3]), { lookbackDays: 0 })).toThrow(RangeError);
    expect(() => detectRallyEvents(mk([1, 2, 3]), { rallyWindowDays: 0 })).toThrow(RangeError);
  });
});

describe('detectRallyEvents — 시계열 절단 불변식', () => {
  test('완전히 관측된 이벤트는 뒤 데이터를 잘라내도 동일하다', () => {
    const closes = [
      100, 96, 92, 88, 84, 80, 105, 103, 90, 92,
      95, 93, 91, 88, 84, 80, 78, 76, 74, 72,
      70, 95, 92, 80, 82, 84, 86, 88, 90, 92,
    ];
    const full = mk(closes);
    const cut = 26;
    const truncated = full.slice(0, cut + 1);

    const rFull = detectRallyEvents(full, CFG);
    const rTrunc = detectRallyEvents(truncated, CFG);

    // 관측이 완결된(= peak + declineWindow 가 절단점 안에 들어오는) 이벤트만 비교
    const observable = (peakIndex: number) => peakIndex + CFG.postRallyDeclineWindowDays! <= cut;
    const fullObservable = rFull.events.filter((e) => observable(e.peakIndex));
    const truncObservable = rTrunc.events.filter((e) => observable(e.peakIndex));

    expect(fullObservable.length).toBeGreaterThan(0);
    expect(truncObservable).toEqual(fullObservable);
  });
});
