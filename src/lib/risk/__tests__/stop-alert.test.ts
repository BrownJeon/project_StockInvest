/**
 * T-068 WP-C — 손절가 도달 알림 판정(순수 모듈) 표 시험. 합성값만 쓴다(AAA·BBB·NAS:ZZZ 등).
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  STOP_ALERT_FOOTER, STOP_ALERT_RULES, emptyStopAlertState, formatStopAlert, kstDay,
  parseStopAlertState, planStopAlerts, settleStopAlerts,
  type PlannedStopAlert, type StopAlertHoldingInput, type StopAlertOutcome, type StopAlertPolicy, type StopAlertState,
} from '../stop-alert';

const T0 = new Date('2026-10-22T01:00:00Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const POLICY: StopAlertPolicy = { version: 1, stopPct: 3, heatCapPct: 2, stopBasis: 'avg' };

/** 평균단가 10,000 → 예상 손절가 9,700, 재무장선 9,748.5 */
const H = (symbol: string, priceKrw: number | null, extra: Partial<StopAlertHoldingInput> = {}): StopAlertHoldingInput => ({
  symbol, market: 'domestic', qty: 10, avgKrw: 10_000, peakKrw: 11_000, priceKrw, ...extra,
});

function tick(prev: StopAlertState | null, holdings: StopAlertHoldingInput[], now: Date,
  outcome: StopAlertOutcome = 'sent', policy: StopAlertPolicy = POLICY) {
  const plan = planStopAlerts({ now, policy, holdings, prev });
  return { plan, state: settleStopAlerts(plan.state, plan.alerts.map(alert => ({ alert, outcome })), now) };
}

function aboveState(...symbols: string[]): StopAlertState {
  const s = emptyStopAlertState(T0);
  s.policyVersion = 1;
  for (const sym of symbols) s.symbols[`domestic|${sym}`] = { state: 'above', since: T0.toISOString(), lastAlertAt: null, rearm: 0, pv: 1 };
  return s;
}

describe('규칙 1 — 교차', () => {
  test('위였다가 현재가 ≤ 예상 손절가 → 종목별 1건, 발송 확인 후에만 below', () => {
    const { plan, state } = tick(aboveState('AAA'), [H('AAA', 9_700)], at(1));
    expect(plan.alerts).toHaveLength(1);
    expect(plan.alerts[0]).toMatchObject({ kind: 'cross', id: 'cross:domestic|AAA', keys: ['domestic|AAA'] });
    expect(plan.state.symbols['domestic|AAA'].state).toBe('above');
    expect(state.symbols['domestic|AAA']).toMatchObject({ state: 'below', lastAlertAt: at(1).toISOString(), rearm: 0, pv: 1 });
    expect(state.sentToday).toBe(1);
  });

  test('손절가 바로 위(9,701) → 알림 없음', () => {
    expect(tick(aboveState('AAA'), [H('AAA', 9_701)], at(1)).plan.alerts).toEqual([]);
  });

  test('이미 below 인 종목이 계속 아래 → 다시 알리지 않음', () => {
    const s1 = tick(aboveState('AAA'), [H('AAA', 9_600)], at(1)).state;
    expect(tick(s1, [H('AAA', 9_500)], at(2)).plan.alerts).toEqual([]);
  });

  test('예상 손절가 정의는 T-066 compute 와 같다 — 고점 기준이면 max(고점, 현재가) × (1−손절폭)', () => {
    const { plan } = tick(aboveState('AAA'), [H('AAA', 10_600)], at(1), 'sent', { ...POLICY, stopBasis: 'peak' });
    expect(plan.alerts).toHaveLength(1);
    expect(plan.alerts[0].items[0].stopKrw).toBeCloseTo(10_670, 6);
  });
});

describe('규칙 2 — 최초 요약', () => {
  test('상태 없는 종목이 이미 아래 → 시장별 1건 요약, 종목별 알림 없음', () => {
    const { plan, state } = tick(null, [H('AAA', 9_000), H('BBB', 9_500), H('CCC', 12_000)], T0);
    expect(plan.alerts).toHaveLength(1);
    expect(plan.alerts[0]).toMatchObject({ kind: 'summary', market: 'domestic', id: 'summary:domestic' });
    expect(plan.alerts[0].keys.sort()).toEqual(['domestic|AAA', 'domestic|BBB']);
    expect(state.symbols['domestic|AAA'].state).toBe('below');
    expect(state.symbols['domestic|BBB'].state).toBe('below');
    expect(state.symbols['domestic|CCC'].state).toBe('above');
    expect(state.sentToday).toBe(1);
  });

  test('국내·미국이 함께 아래 → 시장마다 1건씩', () => {
    const { plan } = tick(null, [H('AAA', 9_000), H('NAS:ZZZ', 9_000, { market: 'overseas', fx: 1_250 })], T0);
    expect(plan.alerts.map(a => a.id).sort()).toEqual(['summary:domestic', 'summary:overseas']);
  });

  test('모두 위 → 알림 없이 above 로 기록', () => {
    const { plan, state } = tick(null, [H('AAA', 10_500)], T0);
    expect(plan.alerts).toEqual([]);
    expect(state.symbols['domestic|AAA'].state).toBe('above');
  });

  test('요약 뒤 새로 산 종목이 이미 아래 → 그 종목만 요약 1건', () => {
    const s1 = tick(null, [H('AAA', 9_000)], T0).state;
    const { plan } = tick(s1, [H('AAA', 9_000), H('BBB', 9_000)], at(1));
    expect(plan.alerts).toHaveLength(1);
    expect(plan.alerts[0]).toMatchObject({ kind: 'summary', keys: ['domestic|BBB'] });
  });
});

describe('규칙 3 — 재무장·쿨다운·일일 상한', () => {
  const rearmLine = 9_700 * (1 + STOP_ALERT_RULES.rearmPct / 100);

  test('손절가 +0.5% 이상 2회 연속 → above (회복 알림 없음, 발송 시각 유지)', () => {
    const s = tick(aboveState('AAA'), [H('AAA', 9_600)], at(1)).state;
    let r = tick(s, [H('AAA', rearmLine)], at(2));
    expect(r.plan.alerts).toEqual([]);
    expect(r.state.symbols['domestic|AAA']).toMatchObject({ state: 'below', rearm: 1 });
    r = tick(r.state, [H('AAA', rearmLine + 10)], at(3));
    expect(r.plan.alerts).toEqual([]);
    expect(r.state.symbols['domestic|AAA']).toMatchObject({ state: 'above', rearm: 0, lastAlertAt: at(1).toISOString() });
  });

  test('재무장선 아래로 다시 내려오면 연속 계수 0', () => {
    let s = tick(aboveState('AAA'), [H('AAA', 9_600)], at(1)).state;
    s = tick(s, [H('AAA', rearmLine)], at(2)).state;
    s = tick(s, [H('AAA', rearmLine - 1)], at(3)).state;
    expect(s.symbols['domestic|AAA']).toMatchObject({ state: 'below', rearm: 0 });
  });

  test('쿨다운 60분 — 안에 다시 교차하면 미루고, 60분 뒤에도 아래면 그때 1건', () => {
    let s = tick(aboveState('AAA'), [H('AAA', 9_600)], at(0)).state;
    s = tick(s, [H('AAA', 9_800)], at(1)).state;
    s = tick(s, [H('AAA', 9_800)], at(2)).state;
    expect(s.symbols['domestic|AAA'].state).toBe('above');
    let r = tick(s, [H('AAA', 9_600)], at(30));
    expect(r.plan.alerts).toEqual([]);
    expect(r.plan.logs.join('\n')).toMatch(/쿨다운/);
    expect(r.state.symbols['domestic|AAA'].state).toBe('above');
    r = tick(r.state, [H('AAA', 9_600)], at(59));
    expect(r.plan.alerts).toEqual([]);
    r = tick(r.state, [H('AAA', 9_600)], at(60));
    expect(r.plan.alerts).toHaveLength(1);
  });

  test('일일 20건 상한 — 초과분은 below 로 기록·로그만, KST 날짜가 바뀌면 0 부터', () => {
    const syms = Array.from({ length: 22 }, (_, i) => `S${String(i).padStart(2, '0')}`);
    const r = tick(aboveState(...syms), syms.map(s => H(s, 9_000)), at(1));
    expect(r.plan.alerts).toHaveLength(20);
    expect(r.state.sentToday).toBe(20);
    const capped = syms.filter(s => !r.plan.alerts.some(a => a.keys[0] === `domestic|${s}`));
    expect(capped).toHaveLength(2);
    for (const c of capped) expect(r.state.symbols[`domestic|${c}`]).toMatchObject({ state: 'below', lastAlertAt: null });
    expect(r.plan.logs.filter(l => /일일 상한/.test(l))).toHaveLength(2);
    const next = new Date('2026-10-22T15:00:00Z');
    expect(kstDay(next)).toBe('2026-10-23');
    const p = planStopAlerts({ now: next, policy: POLICY, holdings: [], prev: r.state });
    expect(p.state).toMatchObject({ sentToday: 0, day: '2026-10-23' });
  });

  test('상한에 이미 닿았으면 최초 요약도 보내지 않고 below 로 기록', () => {
    const prev = emptyStopAlertState(T0);
    prev.sentToday = STOP_ALERT_RULES.dailyMax;
    const r = tick(prev, [H('AAA', 9_000)], at(1));
    expect(r.plan.alerts).toEqual([]);
    expect(r.state.symbols['domestic|AAA'].state).toBe('below');
  });
});

describe('규칙 4 — 정책 version 변경', () => {
  test('바뀐 첫 평가는 알림 없이 새 손절가 기준으로 상태만 맞추고, 다음 평가부터 정상', () => {
    const v2: StopAlertPolicy = { ...POLICY, version: 2, stopPct: 1 }; // 손절가 9,900
    const r = tick(aboveState('AAA', 'BBB'), [H('AAA', 9_850), H('BBB', 9_950), H('CCC', 9_000)], at(1), 'sent', v2);
    expect(r.plan.alerts).toEqual([]);
    expect(r.state.symbols['domestic|AAA']).toMatchObject({ state: 'below', pv: 2 });
    expect(r.state.symbols['domestic|BBB']).toMatchObject({ state: 'above', pv: 2 });
    expect(r.state.symbols['domestic|CCC']).toMatchObject({ state: 'below', pv: 2 });
    expect(r.state.policyVersion).toBe(2);
    const r2 = tick(r.state, [H('AAA', 9_850), H('BBB', 9_890), H('CCC', 9_000)], at(2), 'sent', v2);
    expect(r2.plan.alerts.map(a => a.id)).toEqual(['cross:domestic|BBB']);
  });

  test('닫힌 시장 종목은 처음 평가될 때 조용히 맞춘다(종목별 pv)', () => {
    const prev = aboveState('AAA');
    prev.symbols['overseas|NAS:ZZZ'] = { state: 'above', since: T0.toISOString(), lastAlertAt: null, rearm: 0, pv: 1 };
    const v2: StopAlertPolicy = { ...POLICY, version: 2 };
    const s1 = tick(prev, [H('AAA', 10_500), H('NAS:ZZZ', null, { market: 'overseas' })], at(1), 'sent', v2).state;
    expect(s1.symbols['overseas|NAS:ZZZ'].pv).toBe(1);
    const r = tick(s1, [H('AAA', 10_500), H('NAS:ZZZ', 9_000, { market: 'overseas' })], at(600), 'sent', v2);
    expect(r.plan.alerts).toEqual([]);
    expect(r.state.symbols['overseas|NAS:ZZZ']).toMatchObject({ state: 'below', pv: 2 });
  });

  test('처음 실행(이전 상태 없음)은 정책 변경이 아니다 — 최초 요약', () => {
    expect(tick(null, [H('AAA', 9_000)], T0, 'sent', { ...POLICY, version: 7 }).plan.alerts.map(a => a.kind)).toEqual(['summary']);
  });
});

describe('규칙 5 — 평가 불가는 상태 불변', () => {
  test('현재가 없음(장 마감·시세 실패) → 알림 없음, 상태 그대로', () => {
    const prev = aboveState('AAA');
    const r = tick(prev, [H('AAA', null)], at(1));
    expect(r.plan.alerts).toEqual([]);
    expect(r.state.symbols['domestic|AAA']).toEqual(prev.symbols['domestic|AAA']);
  });

  test('평균단가 없음 → 평가 불가 로그, 상태 없음 유지', () => {
    const r = tick(null, [H('AAA', 9_000, { avgKrw: null })], T0);
    expect(r.plan.alerts).toEqual([]);
    expect(r.state.symbols['domestic|AAA']).toBeUndefined();
    expect(r.plan.logs.join('\n')).toMatch(/평가 불가/);
  });

  test('보유에서 빠진 종목은 지우고 닫힌 시장 보유는 유지', () => {
    const r = tick(aboveState('AAA', 'BBB'), [H('AAA', null)], at(1));
    expect(Object.keys(r.state.symbols)).toEqual(['domestic|AAA']);
  });
});

describe('규칙 6 — 발송 실패', () => {
  test('실패 → 상태 불변·다음 틱 재시도, 3회 연속 → 10분 대기, 대기 뒤 재시도', () => {
    expect(STOP_ALERT_RULES.retryMax).toBe(3);
    expect(STOP_ALERT_RULES.retryWaitMin).toBe(10);
    let s = aboveState('AAA');
    for (let i = 1; i <= 3; i++) {
      const r = tick(s, [H('AAA', 9_000)], at(i), 'failed');
      expect(r.plan.alerts).toHaveLength(1);
      expect(r.state.symbols['domestic|AAA'].state).toBe('above');
      expect(r.state.sentToday).toBe(0);
      s = r.state;
    }
    expect(s.retry['cross:domestic|AAA']).toEqual({ failures: 0, until: at(3 + 10).toISOString() });
    expect(tick(s, [H('AAA', 9_000)], at(4)).plan.alerts).toEqual([]);
    expect(tick(s, [H('AAA', 9_000)], at(12)).plan.alerts).toEqual([]);
    const r = tick(s, [H('AAA', 9_000)], at(13));
    expect(r.plan.alerts).toHaveLength(1);
    expect(r.state.symbols['domestic|AAA'].state).toBe('below');
    expect(r.state.retry['cross:domestic|AAA']).toBeUndefined();
  });

  test('최초 요약 실패 → 상태 없음으로 남아 다음 틱에 다시 요약', () => {
    const r1 = tick(null, [H('AAA', 9_000)], T0, 'failed');
    expect(r1.state.symbols['domestic|AAA']).toBeUndefined();
    expect(r1.state.retry['summary:domestic']).toEqual({ failures: 1, until: null });
    const r2 = tick(r1.state, [H('AAA', 9_000)], at(1));
    expect(r2.plan.alerts.map(a => a.kind)).toEqual(['summary']);
    expect(r2.state.symbols['domestic|AAA'].state).toBe('below');
  });

  test('시도하지 않은 알림(시간 예산 초과) → 아무것도 바뀌지 않음', () => {
    const r = tick(aboveState('AAA'), [H('AAA', 9_000)], at(1), 'not_attempted');
    expect(r.state.symbols['domestic|AAA'].state).toBe('above');
    expect(r.state.retry).toEqual({});
    expect(r.state.sentToday).toBe(0);
  });

  test('재시도 중 손절가 위로 회복 → 재시도 기록 정리', () => {
    let s = tick(aboveState('AAA'), [H('AAA', 9_000)], at(1), 'failed').state;
    s = tick(s, [H('AAA', 10_000)], at(2)).state;
    expect(s.retry['cross:domestic|AAA']).toBeUndefined();
  });
});

describe('상태 저장 형식', () => {
  test('직렬화 → 파싱 왕복', () => {
    const s = tick(null, [H('AAA', 9_000), H('BBB', 10_500)], T0).state;
    expect(parseStopAlertState(JSON.stringify(s))).toEqual(s);
  });

  test.each([
    ['JSON 아님', '{x'], ['배열', '[]'], ['null', 'null'],
    ['v 없음', '{"day":"2026-10-22","sentToday":0,"policyVersion":null}'],
    ['날짜 형식', '{"v":1,"day":"10/22","sentToday":0,"policyVersion":null}'],
    ['건수 음수', '{"v":1,"day":"2026-10-22","sentToday":-1,"policyVersion":null}'],
  ])('손상(%s) → null', (_n, raw) => {
    expect(parseStopAlertState(raw)).toBeNull();
  });

  test('종목 하나가 깨졌으면 그 종목만 버린다', () => {
    const s = parseStopAlertState({ v: 1, day: '2026-10-22', sentToday: 1, policyVersion: 1,
      symbols: { 'domestic|AAA': { state: 'below', since: T0.toISOString(), lastAlertAt: null, rearm: 0, pv: 1 },
                 'domestic|BBB': { state: 'weird', since: 'x', lastAlertAt: null, rearm: 0, pv: 1 } },
      retry: { 'cross:domestic|AAA': { failures: 'x', until: null } } })!;
    expect(Object.keys(s.symbols)).toEqual(['domestic|AAA']);
    expect(s.retry).toEqual({});
  });
});

describe('메시지', () => {
  const crossAlert = (): PlannedStopAlert => tick(aboveState('AAA'), [H('AAA', 9_500)], at(1)).plan.alerts[0];

  test('교차 — 제목·현재가·예상 손절가·평균단가·평가손익률·손절 시 손익·안내 문구', () => {
    const { title, body } = formatStopAlert(crossAlert(), { 'domestic|AAA': '에이에이' });
    expect(title).toBe('🔻 손절가 도달 — 에이에이');
    expect(body).toContain('현재가: 9,500원');
    expect(body).toContain('예상 손절가: 9,700원 (평균단가 기준 −3%)');
    expect(body).toContain('평균단가: 10,000원');
    expect(body).toContain('평가손익률: −5.00%');
    expect(body).toContain('손절 시 손익: −3,000원 (−3.00%, 10주)');
    expect(body.trim().endsWith(STOP_ALERT_FOOTER)).toBe(true);
    expect(STOP_ALERT_FOOTER).toBe('주문은 자동으로 나가지 않습니다. 직접 판단하세요.');
  });

  test('해외 — USD(원화) 표시, 라벨 없으면 심볼', () => {
    const prev = emptyStopAlertState(T0);
    prev.policyVersion = 1;
    prev.symbols['overseas|NAS:ZZZ'] = { state: 'above', since: T0.toISOString(), lastAlertAt: null, rearm: 0, pv: 1 };
    const a = tick(prev, [H('NAS:ZZZ', 125_000, { market: 'overseas', avgKrw: 137_500, peakKrw: 137_500, fx: 1_250 })], at(1)).plan.alerts[0];
    const { title, body } = formatStopAlert(a, {});
    expect(title).toBe('🔻 손절가 도달 — NAS:ZZZ');
    expect(body).toContain('현재가: $100.00 (125,000원)');
    expect(body).toContain('평균단가: $110.00 (137,500원)');
  });

  test('고점 기준이면 기준(고점)도 보여 준다', () => {
    const a = tick(aboveState('AAA'), [H('AAA', 10_600)], at(1), 'sent', { ...POLICY, stopBasis: 'peak' }).plan.alerts[0];
    const { body } = formatStopAlert(a, {});
    expect(body).toContain('(보유 중 고점 기준 −3%)');
    expect(body).toContain('보유 중 고점: 11,000원');
  });

  test('최초 요약 — 시장·종목 수·종목별 줄·안내 문구', () => {
    const a = tick(null, [H('AAA', 9_000), H('BBB', 9_500)], T0).plan.alerts[0];
    const { title, body } = formatStopAlert(a, { 'domestic|AAA': '에이' });
    expect(title).toBe('🔻 이미 손절가 아래 — 국내 2종목');
    expect(body).toContain('현재 2종목이 이미 예상 손절가 아래입니다');
    expect(body).toContain('• 에이: 현재가 9,000원 / 예상 손절가 9,700원 (손절가보다 7.22% 낮음)');
    expect(body).toContain('• BBB:');
    expect(body).toContain(STOP_ALERT_FOOTER);
  });

  test('텔레그램 HTML 특수문자(<, >, &)를 만들지 않는다', () => {
    const { title, body } = formatStopAlert(crossAlert(), {});
    expect(`${title}\n${body}`).not.toMatch(/[<>&]/);
  });
});

describe('순수성 — I/O·알림·거래소 import 없음', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../stop-alert.ts'), 'utf8');
  test.each([
    ['@/lib/db', /@\/lib\/db/], ['notify', /lib\/notify|sendAlert|dispatchAlert/], ['exchanges', /lib\/exchanges|getTicker/],
    ['safety·signals·orders·strategy', /lib\/(safety|signals|orders|strategy)/], ['fetch', /\bfetch\(/],
    ['Node 모듈', /from ['"](fs|path|child_process|node:)/], ['process', /\bprocess\./], ['Date.now', /Date\.now\(/],
  ])('%s 0건', (_n, re) => {
    expect(src).not.toMatch(re);
  });

  test('import 는 같은 폴더의 compute·defaults 뿐', () => {
    const froms = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]).sort();
    expect(froms).toEqual(['./compute', './defaults']);
  });
});
