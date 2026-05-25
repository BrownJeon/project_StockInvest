import {
  gradeFromEv,
  buildScenarioFromAiResult,
  parsePriceZone,
  calcSplitSlices,
} from '../scenario-builder';

describe('gradeFromEv', () => {
  it('A: ev >= 0.6', () => expect(gradeFromEv(0.6)).toBe('A'));
  it('B+: ev >= 0.4', () => expect(gradeFromEv(0.4)).toBe('B+'));
  it('B: ev >= 0.2', () => expect(gradeFromEv(0.2)).toBe('B'));
  it('C: ev < 0.2', () => expect(gradeFromEv(0.19)).toBe('C'));
  it('B+ at 0.59', () => expect(gradeFromEv(0.59)).toBe('B+'));
});

describe('parsePriceZone', () => {
  it('정상 파싱', () => expect(parsePriceZone('66800~67200')).toEqual([66800, 67200]));
  it('공백 포함', () => expect(parsePriceZone(' 100 ~ 200 ')).toEqual([100, 200]));
  it('구분자 없음 → null', () => expect(parsePriceZone('66800')).toBeNull());
  it('숫자 아님 → null', () => expect(parsePriceZone('abc~def')).toBeNull());
  it('0 포함 → null', () => expect(parsePriceZone('0~67200')).toBeNull());
});

describe('buildScenarioFromAiResult', () => {
  const baseAi = {
    ev: 0.45,
    pWin: 0.6,
    rWin: 1.5,
    rLoss: 1.0,
    reasoning: '기술적 반등 구간 진입 시점',
    warnings: ['시장 변동성 높음'],
  };

  it('EV 있으면 ScenarioCard 반환', () => {
    const card = buildScenarioFromAiResult(baseAi, 67000);
    expect(card).not.toBeNull();
    expect(card!.grade).toBe('B+');
    expect(card!.ev).toBeCloseTo(0.45, 2);
  });

  it('grade가 EV 기준에 맞음', () => {
    const card = buildScenarioFromAiResult({ ...baseAi, ev: 0.65 }, 50000);
    expect(card!.grade).toBe('A');
  });

  it('price_zone이 현재가 기준으로 생성됨', () => {
    const card = buildScenarioFromAiResult(baseAi, 67000);
    expect(card!.entry.price_zone).toMatch(/^\d+~\d+$/);
    const [lo, hi] = card!.entry.price_zone.split('~').map(Number);
    expect(lo).toBeLessThan(67000);
    expect(hi).toBeGreaterThan(67000);
  });

  it('evPct(% 단위)도 허용', () => {
    const card = buildScenarioFromAiResult({ evPct: 45, pWin: 0.6, rWin: 1.5, rLoss: 1.0 }, 67000);
    expect(card).not.toBeNull();
    expect(card!.ev).toBeCloseTo(0.45, 2);
  });

  it('EV 없으면 null 반환', () => {
    const card = buildScenarioFromAiResult({ pWin: 0.6 }, 67000);
    expect(card).toBeNull();
  });

  it('stop_pct는 음수', () => {
    const card = buildScenarioFromAiResult(baseAi, 67000);
    expect(card!.exit.stop_pct).toBeLessThan(0);
  });
});

describe('calcSplitSlices', () => {
  const currentPrice = 50000; // 호가단위 50원

  it('단일 공식: buy/sell 모두 index=1이 최저가 구간', () => {
    const buySlices  = calcSplitSlices('buy',  currentPrice, [-2, -0.5], 3);
    const sellSlices = calcSplitSlices('sell', currentPrice, [0.5, 2],   3);
    // index=1의 zoneLo가 index=2의 zoneLo보다 작아야 함 (낮은 가격 구간이 1차)
    expect(buySlices[0].zoneLo).toBeLessThan(buySlices[1].zoneLo);
    expect(sellSlices[0].zoneLo).toBeLessThan(sellSlices[1].zoneLo);
  });

  it('슬라이스 간 겹침 없음 (1 tick gap 적용)', () => {
    const slices = calcSplitSlices('buy', currentPrice, [-2, -0.5], 4);
    for (let i = 1; i < slices.length; i++) {
      // 현재 슬라이스의 zoneLo는 이전 슬라이스의 zoneHi보다 커야 함
      expect(slices[i].zoneLo).toBeGreaterThan(slices[i - 1].zoneHi);
    }
  });

  it('매도 수량 배분: 나머지를 마지막 슬라이스에 추가', () => {
    // 7주를 3분할: 2 / 2 / 3 (마지막에 나머지 1 추가)
    const slices = calcSplitSlices('sell', currentPrice, [0.5, 2], 3, undefined, 7);
    expect(slices[0].qty).toBe(2);
    expect(slices[1].qty).toBe(2);
    expect(slices[2].qty).toBe(3); // 마지막에 나머지 1 추가
  });

  it('매수 금액 배분: 나머지를 마지막 슬라이스에 추가', () => {
    // 100001원을 2분할: 50000 / 50001
    const slices = calcSplitSlices('buy', currentPrice, [-2, -0.5], 2, 100001);
    expect(slices[0].amountKRW).toBe(50000);
    expect(slices[1].amountKRW).toBe(50001);
  });

  it('splits=1 이면 슬라이스 1개 반환', () => {
    const slices = calcSplitSlices('buy', currentPrice, [-1, 0], 1, 100000);
    expect(slices).toHaveLength(1);
    expect(slices[0].index).toBe(1);
  });

  it('currentPrice <= 0 이면 빈 배열 반환', () => {
    expect(calcSplitSlices('buy', 0, [-1, 0], 2)).toHaveLength(0);
  });
});
