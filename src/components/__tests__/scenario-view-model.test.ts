/**
 * T-021 회귀 방지 — `signals.indicators.ai.scenario` 결측 필드로 인한 추천 상세 크래시.
 *
 * 재현된 결함 (QA 실측):
 *   `/recommend/17211` 클릭 → `Application error: a client-side exception has occurred`
 *   원인: `ScenarioDetail.tsx:418` 의 `sc.risk_factors.length` 에서
 *   `TypeError: Cannot read properties of undefined (reading 'length')`
 *   post-market 엔진이 만든 시나리오 JSON 에는 risk_factors·why_now·context·ev 가 없다.
 *
 * 검증 방식: RTL·jsdom 미설치 + `npm install` 금지 환경이라 컴포넌트를 렌더할 수 없다.
 * 그래서 "무엇을 보여줄지" 판정을 순수 함수(`scenario-view-model`)로 추출해 직접 검증한다.
 * (동일 선례: `src/components/__tests__/safety-bar-outcome.test.ts`)
 */
import {
  aiEvalItems, hasAiEval, riskFactors, entryZoneDisplay,
  cardSummary, buildConfirmScenario, finiteOrNull,
  type StoredScenario,
} from '@/components/scenario-view-model';

/** signal 17211 의 실제 DB JSON (2026-08-11, symbol 012330, post-market) — 원문 그대로. */
const SIGNAL_17211 = JSON.parse(
  '{"grade":"B","entry":{"trigger":"price_zone","price_zone":"494000~497000"},' +
  '"exit":{"target_pct":3.5,"stop_pct":1.8,"holding_days":"2일","holding_deadline":"2026-08-14"}}',
) as StoredScenario;

/** 전 필드가 채워진 "정상" 시나리오 (scenario-builder 경로 산출물과 동형) */
const FULL: StoredScenario = {
  grade: 'A',
  entry: { trigger: '눌림목 지지 확인 후 진입', price_zone: '66800~67200', condition: '거래량 동반' },
  exit: {
    target_pct: 1.4, target_pct_hi: 2.0,
    stop_pct: -1.0, stop_pct_hi: -1.5,
    trailing_activate_pct: 1.12,
    holding_days: '1~2일', holding_deadline: '2026-08-13',
  },
  risk_factors: ['시장 변동성 확대', '거래량 급감'],
  why_now: 'RSI 반등 + 이평 지지',
  context: 'P(win)=68% · R/R=1.4:1.0',
  ev: 0.38,
};

// ─────────────────────────────────────────────────────────────────────────────
describe('T-021 크래시 재현 케이스 — signal 17211 (risk_factors·ev 결측)', () => {
  test('🔴 크래시 지점: risk_factors 결측이어도 length 접근이 throw 하지 않는다', () => {
    expect(() => riskFactors(SIGNAL_17211).length).not.toThrow();
    expect(riskFactors(SIGNAL_17211)).toEqual([]);
  });

  test('렌더 판정 전체가 throw 하지 않는다', () => {
    expect(() => {
      const items = aiEvalItems(SIGNAL_17211);
      hasAiEval(items);
      riskFactors(SIGNAL_17211);
      entryZoneDisplay(SIGNAL_17211);
      cardSummary(SIGNAL_17211);
      buildConfirmScenario(SIGNAL_17211);
    }).not.toThrow();
  });

  test('ev 결측 → EV 박스 미표시. 화면에 "NaN" 이 노출되지 않는다', () => {
    const items = aiEvalItems(SIGNAL_17211);
    expect(items.evPct).toBeNull();
    expect(JSON.stringify(items)).not.toContain('NaN');
  });

  test('존재하는 필드는 그대로 표시된다 (grade·target·stop·진입구간)', () => {
    const items = aiEvalItems(SIGNAL_17211);
    expect(items.grade).toBe('B');
    expect(items.targetPct).toBe(3.5);
    expect(items.stopPct).toBe(1.8);
    expect(hasAiEval(items)).toBe(true);           // AI 평가 섹션은 표시된다
    expect(entryZoneDisplay(SIGNAL_17211)).toBe('494000~497000');
  });

  test('목록 카드(ScenarioCard)에서도 안전하게 정규화된다', () => {
    const s = cardSummary(SIGNAL_17211);
    expect(s.riskFactors).toEqual([]);
    expect(s.targetPct).toBe(3.5);
    expect(s.holdingDays).toBe('2일');
    expect(s.targetPctHi).toBeNull();              // 결측 → null (0 으로 지어내지 않는다)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('회귀 방지 — 전 필드 존재하는 정상 시나리오는 표시가 그대로다', () => {
  test('AI 평가 4개 항목이 모두 표시된다', () => {
    const items = aiEvalItems(FULL);
    expect(items).toEqual({ grade: 'A', evPct: '38', targetPct: 1.4, stopPct: -1.0 });
    expect(hasAiEval(items)).toBe(true);
  });

  test('EV 0.38 → "38"% (기존 표시 공식 유지)', () => {
    expect(aiEvalItems(FULL).evPct).toBe('38');
  });

  test('리스크 요인·진입 구간이 그대로 노출된다', () => {
    expect(riskFactors(FULL)).toEqual(['시장 변동성 확대', '거래량 급감']);
    expect(entryZoneDisplay(FULL)).toBe('66800~67200');
  });

  test('목록 카드 요약이 원래 값을 모두 보존한다', () => {
    expect(cardSummary(FULL)).toEqual({
      grade: 'A',
      targetPct: 1.4, targetPctHi: 2.0,
      stopPct: -1.0, stopPctHi: -1.5,
      trigger: '눌림목 지지 확인 후 진입',
      holdingDays: '1~2일',
      riskFactors: ['시장 변동성 확대', '거래량 급감'],
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('극단 케이스 — entry/exit 객체 자체가 없어도 죽지 않는다', () => {
  const cases: Array<[string, StoredScenario | null | undefined]> = [
    ['grade 만 있는 시나리오', { grade: 'C' }],
    ['빈 객체', {}],
    ['exit 없음', { grade: 'B', entry: { price_zone: '100~200' } }],
    ['entry 없음', { grade: 'B', exit: { target_pct: 2 } }],
    ['null', null],
    ['undefined', undefined],
  ];

  test.each(cases)('%s → 렌더 판정 전체가 throw 하지 않는다', (_label, sc) => {
    expect(() => {
      hasAiEval(aiEvalItems(sc));
      riskFactors(sc).length;
      entryZoneDisplay(sc);
      cardSummary(sc);
      buildConfirmScenario(sc);
    }).not.toThrow();
  });

  test('표시할 항목이 하나도 없으면 AI 평가 섹션 자체를 렌더하지 않는다 (빈 껍데기 방지)', () => {
    expect(hasAiEval(aiEvalItems({}))).toBe(false);
    expect(hasAiEval(aiEvalItems(null))).toBe(false);
    expect(hasAiEval(aiEvalItems({ why_now: '사유만 있음' }))).toBe(false);
  });

  test('grade 하나만 있어도 섹션은 표시된다', () => {
    expect(hasAiEval(aiEvalItems({ grade: 'C' }))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('거짓 수치 차단 — 결측·비유한 값을 화면에 올리지 않는다', () => {
  test.each([
    ['undefined', undefined],
    ['null', null],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['문자열', '0.5' as unknown as number],
  ])('ev=%s → EV 박스 미표시', (_label, ev) => {
    expect(aiEvalItems({ ev: ev as number }).evPct).toBeNull();
  });

  test('ev=0 은 유효한 값이므로 "0%" 로 표시된다 (결측과 구분)', () => {
    expect(aiEvalItems({ ev: 0 }).evPct).toBe('0');
  });

  test('target/stop 이 NaN 이면 배지 미표시', () => {
    const items = aiEvalItems({ exit: { target_pct: NaN, stop_pct: NaN } });
    expect(items.targetPct).toBeNull();
    expect(items.stopPct).toBeNull();
    expect(hasAiEval(items)).toBe(false);
  });

  test('finiteOrNull 은 유한 숫자만 통과시킨다', () => {
    expect(finiteOrNull(3.5)).toBe(3.5);
    expect(finiteOrNull(0)).toBe(0);
    expect(finiteOrNull(NaN)).toBeNull();
    expect(finiteOrNull(undefined)).toBeNull();
  });

  test('risk_factors 가 배열이 아니거나 빈 문자열을 담아도 안전하다', () => {
    expect(riskFactors({ risk_factors: 'not an array' as unknown as string[] })).toEqual([]);
    expect(riskFactors({ risk_factors: ['', '  ', '실제 리스크'] })).toEqual(['실제 리스크']);
    expect(riskFactors({ risk_factors: [null, 1, '유효'] as unknown as string[] })).toEqual(['유효']);
  });

  test("진입 구간 placeholder '0~0' 은 표시하지 않는다", () => {
    expect(entryZoneDisplay({ entry: { price_zone: '0~0' } })).toBeNull();
    expect(entryZoneDisplay({ entry: { price_zone: '' } })).toBeNull();
    expect(entryZoneDisplay({ entry: {} })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('승인 POST 페이로드 — /api/signals/custom/confirm 구조 요구사항', () => {
  test('부분 결측 시나리오의 실제 필드를 모두 보존한다', () => {
    const p = buildConfirmScenario(SIGNAL_17211);
    expect(p.grade).toBe('B');
    expect(p.exit).toEqual(SIGNAL_17211.exit);
    expect(p.entry).toEqual({ trigger: 'price_zone', price_zone: '494000~497000' });
  });

  test('시나리오가 아예 없어도 서버 400 게이트를 통과할 구조를 만든다', () => {
    const p = buildConfirmScenario(undefined) as { entry: { price_zone: string } };
    expect(p).toBeTruthy();                       // scenario 자체가 truthy 여야 함
    expect(p.entry.price_zone).toBe('0~0');       // cp<=0 일 때 400 방지
  });

  test('🔴 없는 평가치를 지어내지 않는다 — EV 0·등급 C 를 DB 에 저장하지 않는다', () => {
    const p = buildConfirmScenario(undefined);
    expect(p).not.toHaveProperty('ev');
    expect(p).not.toHaveProperty('grade');
    expect(p).not.toHaveProperty('risk_factors');
  });

  test('결측 시나리오에도 없는 ev/risk_factors 를 새로 만들어 넣지 않는다', () => {
    const p = buildConfirmScenario(SIGNAL_17211);
    expect(p).not.toHaveProperty('ev');
    expect(p).not.toHaveProperty('risk_factors');
  });

  test('원본 시나리오 객체를 변형하지 않는다 (부작용 없음)', () => {
    const before = JSON.stringify(SIGNAL_17211);
    buildConfirmScenario(SIGNAL_17211);
    expect(JSON.stringify(SIGNAL_17211)).toBe(before);
  });
});
