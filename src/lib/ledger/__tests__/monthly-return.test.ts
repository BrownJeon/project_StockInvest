/**
 * T-081 WP-F — 월 수익률(수정 Dietz, KST 달력월) 순수 함수 시험. 모든 값은 합성값이다(실제 계좌 값 아님).
 *
 * 기본 측정 창(10월): 시작 스냅샷 2026-09-30 23:00 KST, 끝 스냅샷 2026-10-31 23:00 KST → T = 31일 = 744h.
 *   w = 0.50 ↔ 시작 + 372h = 2026-10-16 11:00
 *   w = 0.75 ↔ 시작 + 186h = 2026-10-08 17:00
 *   w = 0.25 ↔ 시작 + 558h = 2026-10-24 05:00
 *
 * 2차(Reviewer 16:20) 때 기존 시험에 한 최소 수정과 이유:
 *  - 흐름 도우미 dep/wd 의 기본 반영 상태를 'unmatched' → 'matched'(반영 시각 = 기록 시각)로 — M-1 로 unmatched 가 '부분'이 되었고,
 *    기존 시험은 반영 상태가 아니라 식·경계를 보던 것이라 시각 의미가 같은 matched 로 둔다.
 *  - oct() 와 직접 호출에 openLedgerCandidates: [] 추가 — H-2 로 필수가 됨(미제공 = 불명).
 *  - 이월을 쓴 시험의 기대 상태 'ok' → 'partial' — H-1(b) 로 이월을 쓴 달은 항상 부분.
 */
import {
  computeMonthlyReturn, END_MAX_AGE_MS, kstMonthRange, LARGE_FLOW_DENOM_MIN_RATIO, LARGE_FLOW_SINGLE_MAX_RATIO,
  START_FRESH_MS, START_MAX_AGE_MS,
  type HiddenUsdAssessor, type MonthlyFlowInput, type MonthlyReturnInput, type MonthlySnapshotInput,
} from '../monthly-return';
// 원장 모듈은 safety 를 import 하지 못한다(T-074 정적 불변식) — 시험이 호출자 역할로 실제 T-080 함수를 주입한다.
// 아래 대입은 시험 파일을 포함한 tsc 로만 타입 검사된다 — tsconfig 가 시험을 제외하고 jest(swc)는 타입을 지우므로 **CI 가 강제하지 않는다**
// (Reviewer L-1). 그래서 런타임으로도 실제 반환값의 필드 모양을 점검한다('주입 평가기 반환 모양' 시험).
import { assessHiddenUsdCarry } from '@/lib/safety/hidden-usd-carry';
const ASSESS: HiddenUsdAssessor = assessHiddenUsdCarry;
const DEPS = { assessHiddenUsd: ASSESS };

/** 'YYYY-MM-DD HH:mm' (KST 벽시계) → 순간 Date */
function kst(s: string): Date {
  const [d, t] = s.split(' ');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, da, h, mi) - 9 * 3600_000);
}

interface SnapOpt {
  /** 달러 예수금($). null = USD 행 없음. 기본 1000 */
  usd?: number | null;
  fx?: number;
  /** true 면 USD 행 qty 0·value 0 (가려짐) — 총액은 그대로 받은 값 */
  hidden?: boolean;
  holdings?: Record<string, number>;
  positionsRaw?: unknown;
}

/** 스냅샷 1행. 총액 = 받은 total. KRW 행은 나머지로 채운다(판정에는 USD 행·보유 수량만 쓰인다). */
function snap(ts: string, total: number, o: SnapOpt = {}): MonthlySnapshotInput {
  const usd = o.usd === undefined ? 1000 : o.usd;
  const fx = o.fx ?? 1400;
  const positions: Record<string, unknown>[] = [];
  const holdVal = Object.values(o.holdings ?? {}).reduce((a, q) => a + q * 1000, 0);
  const usdVal = usd == null || o.hidden ? 0 : usd * fx;
  positions.push({ currency: 'KRW', qty: total - usdVal - holdVal, price: 1, value_krw: total - usdVal - holdVal, locked: 0 });
  if (usd != null) positions.push({ currency: 'USD', qty: o.hidden ? 0 : usd, price: fx, value_krw: usdVal, locked: 0 });
  for (const [code, q] of Object.entries(o.holdings ?? {})) positions.push({ currency: code, qty: q, price: 1000, value_krw: q * 1000 });
  return { ts: kst(ts), totalKrw: total, positions: o.positionsRaw !== undefined ? o.positionsRaw : positions };
}

const dep = (t: string, krw: number | null, extra: Partial<MonthlyFlowInput> = {}): MonthlyFlowInput => ({
  kind: 'deposit', currency: 'KRW', occurredAt: kst(t), amountKrwEquiv: krw, anchorStatus: 'matched', reflectedAt: kst(t), ...extra,
});
const wd = (t: string, krw: number | null, extra: Partial<MonthlyFlowInput> = {}): MonthlyFlowInput => ({
  kind: 'withdrawal', currency: 'KRW', occurredAt: kst(t), amountKrwEquiv: krw, anchorStatus: 'matched', reflectedAt: kst(t), ...extra,
});
const exch = (t: string, krw: number | null): MonthlyFlowInput => ({
  kind: 'exchange', currency: 'KRW', occurredAt: kst(t), amountKrwEquiv: krw, anchorStatus: 'unmatched',
});

const BASE = kst('2026-01-01 00:00');
const S0 = '2026-09-30 23:00';
const S1 = '2026-10-31 23:00';
const NOW = kst('2026-11-05 12:00');

function oct(snapshots: MonthlySnapshotInput[], flows: MonthlyFlowInput[] = [], extra: Partial<MonthlyReturnInput> = {}) {
  return computeMonthlyReturn({ month: '2026-10', now: NOW, snapshots, flows, baselineAt: BASE, openLedgerCandidates: [], ...extra }, DEPS);
}
const has = (reasons: string[], code: string) => reasons.some((r) => r.startsWith(code + ':'));

describe('kstMonthRange', () => {
  it('KST 1일 00:00 ~ 다음 달 1일 00:00 (UTC 로는 전날 15:00)', () => {
    const r = kstMonthRange('2026-10')!;
    expect(new Date(r.startMs).toISOString()).toBe('2026-09-30T15:00:00.000Z');
    expect(new Date(r.endMs).toISOString()).toBe('2026-10-31T15:00:00.000Z');
  });
  it('윤년 2월 29일·평년 2월 28일·연말', () => {
    const leap = kstMonthRange('2028-02')!;
    expect((leap.endMs - leap.startMs) / 86400_000).toBe(29);
    const nonLeap = kstMonthRange('2027-02')!;
    expect((nonLeap.endMs - nonLeap.startMs) / 86400_000).toBe(28);
    const dec = kstMonthRange('2026-12')!;
    expect(dec.endMs).toBe(kst('2027-01-01 00:00').getTime());
    expect(kstMonthRange('2027-01')!.startMs).toBe(dec.endMs);
  });
  it.each(['2026-13', '2026-00', '2026-1', '202610', '', 'abcd-ef'])('형식 오류 %p → null', (m) => {
    expect(kstMonthRange(m)).toBeNull();
  });
});

describe('정상 — 수정 Dietz 손계산과 일치', () => {
  it('입출금 없는 달: E_end/E_start − 1', () => {
    // 10,500,000 / 10,000,000 − 1 = 5%
    const r = oct([snap(S0, 10_000_000), snap(S1, 10_500_000)]);
    expect(r.status).toBe('ok');
    expect(r.returnPct).toBeCloseTo(5, 10);
    expect(r.gainKrw).toBe(500_000);
    expect(r.netFlowKrw).toBe(0);
    expect(r.denominatorKrw).toBe(10_000_000);
    expect(r.periodEnd).toBe('month_end');
    expect(r.startSnapshotAt).toEqual(kst(S0));
    expect(r.endSnapshotAt).toEqual(kst(S1));
    expect(r.usdHiddenAdjusted).toBe(false);
  });

  it('월 중 입금 1건(w=0.5): 분모에 절반만 가중', () => {
    // gain = 11,200,000 − 10,000,000 − 1,000,000 = 200,000
    // den  = 10,000,000 + 0.5 × 1,000,000 = 10,500,000 → R = 1.9047619047…%
    const r = oct([snap(S0, 10_000_000), snap(S1, 11_200_000)], [dep('2026-10-16 11:00', 1_000_000)]);
    expect(r.status).toBe('ok');
    expect(r.gainKrw).toBe(200_000);
    expect(r.denominatorKrw).toBe(10_500_000);
    expect(r.returnPct).toBeCloseTo((200_000 / 10_500_000) * 100, 10);
    expect(r.flowCount).toBe(1);
  });

  it('월 초 출금(w=0.75)', () => {
    // gain = 8,300,000 − 10,000,000 − (−2,000,000) = 300,000
    // den  = 10,000,000 + 0.75 × (−2,000,000) = 8,500,000 → R = 3.5294117647…%
    const r = oct([snap(S0, 10_000_000), snap(S1, 8_300_000)], [wd('2026-10-08 17:00', 2_000_000)]);
    expect(r.status).toBe('ok');
    expect(r.netFlowKrw).toBe(-2_000_000);
    expect(r.gainKrw).toBe(300_000);
    expect(r.denominatorKrw).toBe(8_500_000);
    expect(r.returnPct).toBeCloseTo(3.5294117647058822, 10);
  });

  it('입금+출금+손실 혼재', () => {
    // 입금 5,000,000 @ w=0.25(10-24 05:00), 출금 1,000,000 @ w=0.5(10-16 11:00)
    // ΣF = 4,000,000, gain = 22,000,000 − 20,000,000 − 4,000,000 = −2,000,000
    // den = 20,000,000 + 0.25×5,000,000 − 0.5×1,000,000 = 20,750,000 → R = −9.6385542168…%
    const r = oct(
      [snap(S0, 20_000_000), snap(S1, 22_000_000)],
      [dep('2026-10-24 05:00', 5_000_000), wd('2026-10-16 11:00', 1_000_000)],
    );
    expect(r.status).toBe('ok');
    expect(r.gainKrw).toBe(-2_000_000);
    expect(r.denominatorKrw).toBe(20_750_000);
    expect(r.returnPct).toBeCloseTo(-9.638554216867469, 10);
  });

  it('USD 입금은 원화 환산액으로 센다(통화 무관, 방향은 kind)', () => {
    // $500 × 1,400 = 700,000 @ w=0.75 → gain = 10,800,000 − 10,000,000 − 700,000 = 100,000, den = 10,525,000
    const r = oct([snap(S0, 10_000_000), snap(S1, 10_800_000)], [dep('2026-10-08 17:00', 700_000, { currency: 'USD' })]);
    expect(r.returnPct).toBeCloseTo((100_000 / 10_525_000) * 100, 10);
  });

  it('환전만 있는 달: 순입금 0, 스프레드 비용은 수익률에 남는다', () => {
    // 10,000,000 → 9,990,000 (환전 스프레드 10,000원) → −0.1%. 환전 금액(1,400,000)은 F 가 아니다.
    const r = oct([snap(S0, 10_000_000), snap(S1, 9_990_000)], [exch('2026-10-16 11:00', 1_400_000), exch('2026-10-08 17:00', null)]);
    expect(r.status).toBe('ok');
    expect(r.netFlowKrw).toBe(0);
    expect(r.denominatorKrw).toBe(10_000_000);
    expect(r.returnPct).toBeCloseTo(-0.1, 10);
    expect(has(r.reasons, 'exchange_ignored')).toBe(true);
  });

  it('측정 창은 스냅샷 기준: 전월 말 스냅샷(23:00) 뒤·자정 전 입금은 이번 달 흐름 (가짜 수익 방지)', () => {
    // 09-30 23:30 입금 1,000,000 은 E_end 에 들어 있다. 달력 기준으로 빼면 +10% 가짜 수익.
    // w = (744 − 0.5)/744 ≈ 0.99933 → gain 0 → R = 0
    const r = oct([snap(S0, 10_000_000), snap(S1, 11_000_000)], [dep('2026-09-30 23:30', 1_000_000)]);
    expect(r.status).toBe('ok');
    expect(r.gainKrw).toBe(0);
    expect(r.returnPct).toBe(0);
  });

  it('반영된(matched) 기록은 반영 스냅샷 시각으로 가중한다', () => {
    // 기록 10-08 17:00, 반영 10-24 05:00 → w = 0.25 (기록 시각이면 0.75)
    // gain = 11,200,000 − 10,000,000 − 1,000,000 = 200,000, den = 10,250,000
    const r = oct(
      [snap(S0, 10_000_000), snap(S1, 11_200_000)],
      [dep('2026-10-08 17:00', 1_000_000, { anchorStatus: 'matched', reflectedAt: kst('2026-10-24 05:00') })],
    );
    expect(r.denominatorKrw).toBe(10_250_000);
    expect(r.returnPct).toBeCloseTo((200_000 / 10_250_000) * 100, 10);
  });

  it('반영 대기(pending) 기록이 창 안이면 기록대로 넣고 부분', () => {
    const r = oct([snap(S0, 10_000_000), snap(S1, 11_200_000)], [dep('2026-10-16 11:00', 1_000_000, { anchorStatus: 'pending' })]);
    expect(r.status).toBe('partial');
    expect(r.returnPct).toBeCloseTo((200_000 / 10_500_000) * 100, 10);
    expect(has(r.reasons, 'flow_pending')).toBe(true);
  });
});

describe('불명 / 부분 — 가짜 0 금지', () => {
  it('스냅샷 없음', () => {
    const r = oct([]);
    expect(r.status).toBe('unknown');
    expect(r.returnPct).toBeNull();
    expect(has(r.reasons, 'no_start_snapshot')).toBe(true);
  });
  it('월 시작 이전 구간에 데이터가 아예 없음(달 안 스냅샷만)', () => {
    const r = oct([snap('2026-10-01 01:00', 10_000_000), snap(S1, 10_500_000)]);
    expect(r.status).toBe('unknown');
    expect(has(r.reasons, 'no_start_snapshot')).toBe(true);
  });
  it('시작 오래됨: 36h 초과 → 불명, 3h~36h → 부분, 정확히 36h → 부분', () => {
    expect(oct([snap('2026-09-29 10:00', 10_000_000), snap(S1, 10_500_000)]).status).toBe('unknown'); // 38h
    const aged = oct([snap('2026-09-30 12:00', 10_000_000), snap(S1, 10_500_000)]); // 12h
    expect(aged.status).toBe('partial');
    expect(aged.returnPct).toBeCloseTo(5, 10);
    expect(has(aged.reasons, 'start_aged')).toBe(true);
    expect(oct([snap('2026-09-29 12:00', 10_000_000), snap(S1, 10_500_000)]).status).toBe('partial'); // 36h
    expect(oct([snap('2026-09-30 21:00', 10_000_000), snap(S1, 10_500_000)]).status).toBe('ok'); // 3h
    expect(START_MAX_AGE_MS).toBe(36 * 3600_000);
    expect(START_FRESH_MS).toBe(3 * 3600_000);
  });
  it('끝 오래됨: 3h 초과 → 불명, 정확히 3h → 정상', () => {
    const stale = oct([snap(S0, 10_000_000), snap('2026-10-31 20:59', 10_500_000)]);
    expect(stale.status).toBe('unknown');
    expect(has(stale.reasons, 'end_stale')).toBe(true);
    expect(stale.startEquityKrw).toBe(10_000_000); // 알 수 있는 값은 채운다
    expect(oct([snap(S0, 10_000_000), snap('2026-10-31 21:00', 10_500_000)]).status).toBe('ok');
    expect(END_MAX_AGE_MS).toBe(3 * 3600_000);
  });
  it('분모 0 → 불명', () => {
    // den = 1,000,000 − 0.5 × 2,000,000 = 0
    const r = oct([snap(S0, 1_000_000), snap(S1, 0)], [wd('2026-10-16 11:00', 2_000_000)]);
    expect(r.status).toBe('unknown');
    expect(r.returnPct).toBeNull();
    expect(r.denominatorKrw).toBe(0);
    expect(has(r.reasons, 'denominator_nonpositive')).toBe(true);
  });
  it('분모 음수 → 불명', () => {
    // den = 1,000,000 − 0.5 × 3,000,000 = −500,000 (그대로 나누면 부호가 뒤집힌 가짜 값)
    const r = oct([snap(S0, 1_000_000), snap(S1, 100_000)], [wd('2026-10-16 11:00', 3_000_000)]);
    expect(r.status).toBe('unknown');
    expect(r.denominatorKrw).toBe(-500_000);
    expect(has(r.reasons, 'denominator_nonpositive')).toBe(true);
  });
  it('시작 총자산 0 → 불명', () => {
    const r = oct([snap(S0, 0), snap(S1, 1_000_000)]);
    expect(r.status).toBe('unknown');
  });
  it.each([
    ['null', null], ['NaN', NaN], ['0', 0], ['음수', -1000], ['Infinity', Infinity],
  ])('흐름 금액 %s → 불명', (_n, v) => {
    const r = oct([snap(S0, 10_000_000), snap(S1, 10_500_000)], [dep('2026-10-16 11:00', v as number | null)]);
    expect(r.status).toBe('unknown');
    expect(has(r.reasons, 'flow_amount_invalid')).toBe(true);
  });
  it('흐름 시각·종류를 읽을 수 없음 → 불명', () => {
    const bad = { ...dep('2026-10-16 11:00', 1000), occurredAt: new Date(NaN) };
    expect(oct([snap(S0, 10_000_000), snap(S1, 10_500_000)], [bad]).status).toBe('unknown');
    const kind = { ...dep('2026-10-16 11:00', 1000), kind: 'withdraw' as unknown as 'deposit' };
    expect(oct([snap(S0, 10_000_000), snap(S1, 10_500_000)], [kind]).status).toBe('unknown');
  });
  it('원장 기준 없음 → 흐름 0건이어도 불명', () => {
    for (const b of [null, undefined]) {
      const r = oct([snap(S0, 10_000_000), snap(S1, 10_500_000)], [], { baselineAt: b });
      expect(r.status).toBe('unknown');
      expect(r.returnPct).toBeNull();
      expect(has(r.reasons, 'baseline_missing')).toBe(true);
    }
    expect(oct([snap(S0, 10_000_000), snap(S1, 10_500_000)], [], { baselineAt: new Date(NaN) }).status).toBe('unknown');
  });
  it('원장 기준이 측정 창 안 → 불명, 시작 스냅샷과 같은 시각 → 정상', () => {
    expect(oct([snap(S0, 10_000_000), snap(S1, 10_500_000)], [], { baselineAt: kst('2026-10-05 09:00') }).status).toBe('unknown');
    expect(oct([snap(S0, 10_000_000), snap(S1, 10_500_000)], [], { baselineAt: kst(S0) }).status).toBe('ok');
  });
  it('기준 이전 흐름 혼입(기록은 기준 이전, 반영은 창 안) → 불명', () => {
    const f = dep('2026-09-30 21:00', 1_000_000, { anchorStatus: 'matched', reflectedAt: kst('2026-10-01 01:00') });
    const r = oct([snap(S0, 10_000_000), snap(S1, 11_500_000)], [f], { baselineAt: kst('2026-09-30 22:00') });
    expect(r.status).toBe('unknown');
    expect(has(r.reasons, 'flow_before_baseline')).toBe(true);
  });
  it('positions 판독 불가 → 불명', () => {
    const r = oct([snap(S0, 10_000_000), snap(S1, 10_500_000, { positionsRaw: '{not json' })]);
    expect(r.status).toBe('unknown');
    expect(has(r.reasons, 'positions_unreadable')).toBe(true);
  });
  it('형식이 틀린 달·now → 불명, 시작 전의 달 → 불명', () => {
    expect(computeMonthlyReturn({ month: '2026-13', now: NOW, snapshots: [], flows: [], baselineAt: BASE, openLedgerCandidates: [] }).status).toBe('unknown');
    expect(computeMonthlyReturn({ month: '2026-10', now: new Date(NaN), snapshots: [], flows: [], baselineAt: BASE, openLedgerCandidates: [] }).status).toBe('unknown');
    const fut = computeMonthlyReturn({ month: '2026-12', now: NOW, snapshots: [snap(S0, 1), snap(S1, 1)], flows: [], baselineAt: BASE, openLedgerCandidates: [] });
    expect(fut.status).toBe('unknown');
    expect(has(fut.reasons, 'month_not_started')).toBe(true);
  });
  it('시각·총액을 읽을 수 없는 스냅샷 행은 건너뛰고 기록', () => {
    const r = oct([snap(S0, 10_000_000), { ts: kst('2026-10-31 23:30'), totalKrw: NaN, positions: [] }, snap(S1, 10_500_000)]);
    expect(r.status).toBe('ok');
    expect(r.endSnapshotAt).toEqual(kst(S1));
    expect(has(r.reasons, 'snapshot_rows_ignored')).toBe(true);
  });
});

describe('USD 가려짐 (T-080 이월 재사용)', () => {
  // 참값: 시작 10,000,000 / 끝 10,500,000, USD $1000 × 1,400 = 1,400,000 → 참 수익률 5%
  const visibleEnd = () => oct([snap(S0, 10_000_000), snap(S1, 10_500_000)]);

  it('끝만 가려짐 + 20h 안 양수 행 → 이월, 가려짐 없는 같은 날 값과 일치', () => {
    const r = oct([snap(S0, 10_000_000), snap('2026-10-31 15:00', 10_480_000), snap(S1, 9_100_000, { hidden: true })]);
    expect(r.status).toBe('partial');
    expect(has(r.reasons, 'usd_hidden_carried_unverifiable_exchange')).toBe(true);
    expect(r.usdHiddenAdjusted).toBe(true);
    expect(r.endEquityKrw).toBe(10_500_000);
    expect(r.returnPct).toBeCloseTo(visibleEnd().returnPct as number, 10);
    expect(has(r.reasons, 'usd_hidden_carried')).toBe(true);
  });
  it('시작만 가려짐 → 이월', () => {
    const r = oct([snap('2026-09-30 16:00', 9_990_000), snap(S0, 8_600_000, { hidden: true }), snap(S1, 10_500_000)]);
    expect(r.status).toBe('partial');
    expect(r.usdHiddenAdjusted).toBe(true);
    expect(r.startEquityKrw).toBe(10_000_000);
    expect(r.returnPct).toBeCloseTo(5, 10);
  });
  it('둘 다 가려짐 → 둘 다 이월', () => {
    const r = oct([
      snap('2026-09-30 16:00', 9_990_000), snap(S0, 8_600_000, { hidden: true }),
      snap('2026-10-31 15:00', 10_480_000), snap(S1, 9_100_000, { hidden: true }),
    ]);
    expect(r.status).toBe('partial');
    expect(r.startEquityKrw).toBe(10_000_000);
    expect(r.endEquityKrw).toBe(10_500_000);
    expect(r.returnPct).toBeCloseTo(5, 10);
  });
  it('이월 근거가 20h 초과(21h 전) → 불명 (보정 없이 −9% 가짜 손실을 내지 않는다)', () => {
    const r = oct([snap(S0, 10_000_000), snap('2026-10-31 02:00', 10_480_000), snap('2026-10-31 18:00', 9_100_000, { hidden: true }), snap(S1, 9_100_000, { hidden: true })]);
    expect(r.status).toBe('unknown');
    expect(r.returnPct).toBeNull();
    expect(r.usdHiddenAdjusted).toBe(false);
    expect(r.reasons.some((x) => x.startsWith('usd_hidden_not_carried') && x.includes('hidden_no_prior'))).toBe(true);
  });
  it('이월 근거가 정확히 20h 전 → 이월(경계 포함)', () => {
    const r = oct([snap(S0, 10_000_000), snap('2026-10-31 03:00', 10_480_000), snap(S1, 9_100_000, { hidden: true })]);
    expect(r.status).toBe('partial');
    expect(r.endEquityKrw).toBe(10_500_000);
  });
  it('가려진 동안 매수 정황(신규 종목) → 이월 불가 → 불명', () => {
    const r = oct([snap(S0, 10_000_000), snap('2026-10-31 15:00', 10_480_000), snap(S1, 9_100_000, { hidden: true, holdings: { 'NAS:AAPL': 1 } })]);
    expect(r.status).toBe('unknown');
    expect(r.reasons.some((x) => x.includes('hidden_purchase_evidence'))).toBe(true);
  });
  it('가려진 행 환율이 근거 행 대비 범위 밖 → 불명', () => {
    const r = oct([snap(S0, 10_000_000), snap('2026-10-31 15:00', 10_480_000), snap(S1, 9_100_000, { hidden: true, fx: 2000 })]);
    expect(r.status).toBe('unknown');
    expect(r.reasons.some((x) => x.includes('hidden_no_price_out_of_band'))).toBe(true);
  });
  it('USD 행이 한쪽에만 있음(T-056 이전 → 이후) → 불명', () => {
    const r = oct([snap(S0, 8_600_000, { usd: null }), snap(S1, 10_500_000)]);
    expect(r.status).toBe('unknown');
    expect(has(r.reasons, 'usd_row_asymmetric')).toBe(true);
  });
  it('USD 행이 양쪽 다 없음 → 부분(정의는 같음)', () => {
    const r = oct([snap(S0, 10_000_000, { usd: null }), snap(S1, 10_500_000, { usd: null })]);
    expect(r.status).toBe('partial');
    expect(r.returnPct).toBeCloseTo(5, 10);
    expect(has(r.reasons, 'usd_absent_both')).toBe(true);
  });
  it('평가기 주입 없음: 가려진 끝점은 불명(fail-closed), 가려짐 없으면 같은 값', () => {
    const hidden = [snap(S0, 10_000_000), snap('2026-10-31 15:00', 10_480_000), snap(S1, 9_100_000, { hidden: true })];
    const r = computeMonthlyReturn({ month: '2026-10', now: NOW, snapshots: hidden, flows: [], baselineAt: BASE, openLedgerCandidates: [] });
    expect(r.status).toBe('unknown');
    expect(r.returnPct).toBeNull();
    expect(has(r.reasons, 'usd_hidden_assessor_missing')).toBe(true);
    const vis = [snap(S0, 10_000_000), snap(S1, 10_500_000)];
    const plain = computeMonthlyReturn({ month: '2026-10', now: NOW, snapshots: vis, flows: [], baselineAt: BASE, openLedgerCandidates: [] });
    expect(plain).toEqual(oct(vis));
    const asym = computeMonthlyReturn({ month: '2026-10', now: NOW, snapshots: [snap(S0, 8_600_000, { usd: null }), snap(S1, 10_500_000)], flows: [], baselineAt: BASE, openLedgerCandidates: [] });
    expect(has(asym.reasons, 'usd_row_asymmetric')).toBe(true);
    const both = computeMonthlyReturn({ month: '2026-10', now: NOW, snapshots: [snap(S0, 10_000_000, { usd: null }), snap(S1, 10_500_000, { usd: null })], flows: [], baselineAt: BASE, openLedgerCandidates: [] });
    expect(both.status).toBe('partial');
    const bad = computeMonthlyReturn({ month: '2026-10', now: NOW, snapshots: [snap(S0, 10_000_000), snap(S1, 10_500_000, { positionsRaw: [{ currency: 'USD', qty: -1, price: 1400, value_krw: 0 }] })], flows: [], baselineAt: BASE, openLedgerCandidates: [] });
    expect(has(bad.reasons, 'usd_unreadable')).toBe(true);
  });
  it('평가기가 던지면 불명', () => {
    const boom: HiddenUsdAssessor = () => { throw new Error('boom'); };
    const r = computeMonthlyReturn({ month: '2026-10', now: NOW, snapshots: [snap(S0, 10_000_000), snap(S1, 10_500_000)], flows: [], baselineAt: BASE, openLedgerCandidates: [] }, { assessHiddenUsd: boom });
    expect(r.status).toBe('unknown');
    expect(has(r.reasons, 'usd_assessor_failed')).toBe(true);
  });
  it('다른 사유로 불명이어도 이월값은 끝점 총액에 반영해 보여 준다', () => {
    const r = oct([snap('2026-09-30 16:00', 9_990_000), snap(S0, 8_600_000, { hidden: true }), snap('2026-10-31 20:00', 10_500_000)]);
    expect(r.status).toBe('unknown'); // end_stale
    expect(r.startEquityKrw).toBe(10_000_000);
    expect(r.usdHiddenAdjusted).toBe(true);
  });
  it('USD 행 수량 판독 불가 → 불명', () => {
    const r = oct([snap(S0, 10_000_000), snap(S1, 10_500_000, { positionsRaw: [{ currency: 'USD', qty: 'x', price: 1400, value_krw: 0 }] })]);
    expect(r.status).toBe('unknown');
    expect(has(r.reasons, 'usd_unreadable')).toBe(true);
  });
});

describe('경계 — KST 달력월', () => {
  it('월 말 23:59 흐름은 이번 달, 익월 00:00 끝 스냅샷과 같은 시각 흐름도 이번 달(그 스냅샷에 반영), 00:01 은 다음 달', () => {
    const snaps = [snap(S0, 10_000_000), snap('2026-11-01 00:00', 11_000_000), snap('2026-11-30 23:00', 11_500_000)];
    const flows = [dep('2026-10-31 23:59', 600_000), dep('2026-11-01 00:00', 400_000), dep('2026-11-01 00:01', 300_000)];
    const o = oct(snaps, flows, { now: kst('2026-12-02 00:00') });
    expect(o.endSnapshotAt).toEqual(kst('2026-11-01 00:00'));
    expect(o.netFlowKrw).toBe(1_000_000);
    expect(o.flowCount).toBe(2);
    const n = computeMonthlyReturn({ month: '2026-11', now: kst('2026-12-02 00:00'), snapshots: snaps, flows, baselineAt: BASE, openLedgerCandidates: [] }, DEPS);
    expect(n.startSnapshotAt).toEqual(kst('2026-11-01 00:00'));
    expect(n.netFlowKrw).toBe(300_000);
    expect(n.flowCount).toBe(1);
  });
  it('월 말 마지막 스냅샷(23:00) 뒤·자정 전 흐름은 다음 창(가짜 손실 방지)', () => {
    // 23:30 입금은 끝 스냅샷(23:00)에 없다. F 로 빼면 −10% 가짜 손실.
    const r = oct([snap(S0, 10_000_000), snap(S1, 10_000_000)], [dep('2026-10-31 23:30', 1_000_000)]);
    expect(r.status).toBe('ok');
    expect(r.netFlowKrw).toBe(0);
    expect(r.returnPct).toBe(0);
    expect(has(r.reasons, 'flow_outside_window')).toBe(true);
  });
  it('KST 자정 직전·직후 흐름 (시작 스냅샷이 정확히 00:00)', () => {
    const snaps = [snap('2026-10-01 00:00', 10_000_000), snap(S1, 10_600_000)];
    const r = oct(snaps, [dep('2026-09-30 23:59', 500_000), dep('2026-10-01 00:01', 500_000)]);
    // 23:59 는 시작 스냅샷(00:00) 이전 → 9월 창. 00:01 만 10월 흐름.
    expect(r.netFlowKrw).toBe(500_000);
    expect(r.gainKrw).toBe(100_000);
  });
  it('끝점 선택은 KST 경계 — UTC 경계(익월 09:00 KST)라면 05:00 스냅샷이 끝점이 된다', () => {
    const r = oct([snap(S0, 10_000_000), snap('2026-10-31 23:00', 10_500_000), snap('2026-11-01 05:00', 20_000_000)]);
    expect(r.endSnapshotAt).toEqual(kst('2026-10-31 23:00'));
    expect(r.returnPct).toBeCloseTo(5, 10);
    expect(r.periodEndAt).toEqual(kst('2026-11-01 00:00'));
    expect(r.periodStartAt).toEqual(kst('2026-10-01 00:00'));
  });
  it('시작점 선택도 KST 경계 — 09-30 20:00 KST 스냅샷이 아니라 23:00', () => {
    const r = oct([snap('2026-09-30 20:00', 5_000_000), snap(S0, 10_000_000), snap(S1, 10_500_000)]);
    expect(r.startSnapshotAt).toEqual(kst(S0));
    expect(r.returnPct).toBeCloseTo(5, 10);
  });
  it('윤년 2월(29일)', () => {
    const snaps = [snap('2028-01-31 23:00', 10_000_000), snap('2028-02-29 23:00', 10_200_000), snap('2028-03-01 00:30', 99_000_000)];
    const r = computeMonthlyReturn({ month: '2028-02', now: kst('2028-03-10 00:00'), snapshots: snaps, flows: [], baselineAt: BASE, openLedgerCandidates: [] }, DEPS);
    expect(r.status).toBe('ok');
    expect(r.periodEndAt).toEqual(kst('2028-03-01 00:00'));
    expect(r.endSnapshotAt).toEqual(kst('2028-02-29 23:00'));
    expect(r.returnPct).toBeCloseTo(2, 10);
  });
  it('평년 2월(28일)', () => {
    const snaps = [snap('2027-01-31 23:00', 10_000_000), snap('2027-02-28 23:00', 9_800_000), snap('2027-03-01 00:30', 99_000_000)];
    const r = computeMonthlyReturn({ month: '2027-02', now: kst('2027-03-10 00:00'), snapshots: snaps, flows: [], baselineAt: BASE, openLedgerCandidates: [] }, DEPS);
    expect(r.periodEndAt).toEqual(kst('2027-03-01 00:00'));
    expect(r.endSnapshotAt).toEqual(kst('2027-02-28 23:00'));
    expect(r.returnPct).toBeCloseTo(-2, 10);
  });
  it('연말: 12월 끝 스냅샷 = 1월 시작 스냅샷 (달끼리 이어짐)', () => {
    const snaps = [snap('2026-11-30 23:00', 10_000_000), snap('2026-12-31 23:00', 11_000_000), snap('2027-01-31 23:00', 12_100_000)];
    const now = kst('2027-02-05 00:00');
    const d = computeMonthlyReturn({ month: '2026-12', now, snapshots: snaps, flows: [], baselineAt: BASE, openLedgerCandidates: [] }, DEPS);
    const j = computeMonthlyReturn({ month: '2027-01', now, snapshots: snaps, flows: [], baselineAt: BASE, openLedgerCandidates: [] }, DEPS);
    expect(d.endSnapshotAt).toEqual(kst('2026-12-31 23:00'));
    expect(j.startSnapshotAt).toEqual(d.endSnapshotAt);
    expect(d.returnPct).toBeCloseTo(10, 10);
    expect(j.returnPct).toBeCloseTo(10, 10);
  });
  it('진행 중인 달(now 주입): 기간 끝 = now, now 뒤 스냅샷 무시', () => {
    const now = kst('2026-10-25 15:00');
    const r = oct([snap(S0, 10_000_000), snap('2026-10-25 14:00', 10_300_000), snap('2026-10-25 16:00', 50_000_000)], [], { now });
    expect(r.status).toBe('ok');
    expect(r.periodEnd).toBe('now');
    expect(r.periodEndAt).toEqual(now);
    expect(r.endSnapshotAt).toEqual(kst('2026-10-25 14:00'));
    expect(r.returnPct).toBeCloseTo(3, 10);
    expect(has(r.reasons, 'in_progress')).toBe(true);
  });
  it('진행 중 가중치는 now 까지의 창으로 계산', () => {
    // 창 09-30 23:00 ~ 10-16 11:00 (372h), 입금 10-08 17:00 (시작 +186h) → w = 0.5
    const now = kst('2026-10-16 11:30');
    const r = oct([snap(S0, 10_000_000), snap('2026-10-16 11:00', 11_200_000)], [dep('2026-10-08 17:00', 1_000_000)], { now });
    expect(r.denominatorKrw).toBe(10_500_000);
  });
  it('월 시작 직후라 달 안 스냅샷이 없음 → 불명(empty_window)', () => {
    const r = oct([snap(S0, 10_000_000)], [], { now: kst('2026-10-01 01:00') });
    expect(r.status).toBe('unknown');
    expect(has(r.reasons, 'empty_window')).toBe(true);
  });
});

describe('2차 — Reviewer 16:20 재현 입력 고정', () => {
  // ── H-1 이월 구간 안 환전·USD 흐름 ──
  // 참값 +5%. 16:00 가시 $1000 → 20:00 KRW 1,400,000 → USD 환전 → 23:00 가려짐. 이월(마지막 관측 $1000)은 환전분을 놓친다.
  const hiddenBoth = (endTotal: number, startTotal = 8_600_000) => [
    snap('2026-09-30 16:00', 10_000_000), snap(S0, startTotal, { hidden: true }),
    snap('2026-10-31 16:00', 10_500_000), snap(S1, endTotal, { hidden: true }),
  ];
  it('H-1 F3b: 끝점 가려짐 + 이월 구간 안 환전(금액 없음) → 불명 (전에는 ok −9%)', () => {
    const r = oct(hiddenBoth(9_100_000 - 1_400_000), [exch('2026-10-31 20:00', null)]);
    expect(r.status).toBe('unknown');
    expect(r.returnPct).toBeNull();
    expect(has(r.reasons, 'usd_hidden_flow_in_gap')).toBe(true);
  });
  it('H-1 F3c: 시작점 가려짐 + 측정 창 밖(시작 스냅샷 이전) 이월 구간 환전 → 불명 (전에는 ok +22.09%)', () => {
    const r = oct(hiddenBoth(9_100_000, 7_200_000), [exch('2026-09-30 20:00', null)]);
    expect(r.status).toBe('unknown');
    expect(has(r.reasons, 'usd_hidden_flow_in_gap')).toBe(true);
  });
  it('H-1 F10: 이월 구간 안 USD 출금 기록 → 불명 (전에는 ok +19.01%)', () => {
    const snaps = [snap(S0, 10_000_000), snap('2026-10-31 15:00', 10_480_000), snap(S1, 9_100_000, { hidden: true })];
    const r = oct(snaps, [wd('2026-10-31 20:00', 1_400_000, { currency: 'USD' })]);
    expect(r.status).toBe('unknown');
    expect(has(r.reasons, 'usd_hidden_flow_in_gap')).toBe(true);
  });
  it('H-1: 반영 시각만 이월 구간 안이어도 막는다 / 구간 밖 환전·구간 안 KRW 입금은 막지 않는다(부분)', () => {
    const snaps = [snap(S0, 10_000_000), snap('2026-10-31 15:00', 10_480_000), snap(S1, 9_100_000 + 300_000, { hidden: true })];
    const refl = { ...exch('2026-10-31 14:00', null), anchorStatus: 'matched' as const, reflectedAt: kst('2026-10-31 23:00') };
    expect(has(oct(snaps, [refl]).reasons, 'usd_hidden_flow_in_gap')).toBe(true);
    // 경계: 마지막 양수 관측 시각(15:00) 자체는 구간 밖
    const atSeen = oct(snaps, [exch('2026-10-31 15:00', null)]);
    expect(has(atSeen.reasons, 'usd_hidden_flow_in_gap')).toBe(false);
    const ok = oct(snaps, [exch('2026-10-15 10:00', null), dep('2026-10-31 20:00', 300_000)]);
    expect(ok.status).toBe('partial');
    // gain = 10,800,000 − 10,000,000 − 300,000 = 500,000, w = 3/744 → den = 10,000,000 + 300,000 × 3/744
    expect(ok.returnPct).toBeCloseTo((500_000 / (10_000_000 + 300_000 * (3 / 744))) * 100, 10);
    expect(has(ok.reasons, 'usd_hidden_carried_unverifiable_exchange')).toBe(true);
  });
  it('H-1: 평가기가 이월했지만 lastSeenMs 를 주지 않으면 검사 불가 → 불명', () => {
    const fake: HiddenUsdAssessor = (inp) => {
      const r = assessHiddenUsdCarry(inp);
      return { baseline: r.baseline, current: { ...r.current, lastSeenMs: null } };
    };
    const snaps = [snap(S0, 10_000_000), snap('2026-10-31 15:00', 10_480_000), snap(S1, 9_100_000, { hidden: true })];
    const r = computeMonthlyReturn({ month: '2026-10', now: NOW, snapshots: snaps, flows: [], baselineAt: BASE, openLedgerCandidates: [] }, { assessHiddenUsd: fake });
    expect(r.status).toBe('unknown');
    expect(has(r.reasons, 'usd_hidden_flow_in_gap')).toBe(true);
  });

  // ── H-2 원장 완전성 ──
  it('H-2 F1: 흐름 0건 10,000,000 → 15,000,000 — 후보 미제공이면 불명 (전에는 ok +50%)', () => {
    const r = oct([snap(S0, 10_000_000), snap(S1, 15_000_000)], [], { openLedgerCandidates: undefined });
    expect(r.status).toBe('unknown');
    expect(r.returnPct).toBeNull();
    expect(has(r.reasons, 'ledger_completeness_unknown')).toBe(true);
  });
  it('H-2: 창 안 open 후보 → 불명, dismissed·창 밖·시작 스냅샷 시각 후보는 세지 않음, 끝 스냅샷 시각은 창 안', () => {
    const snaps = [snap(S0, 10_000_000), snap(S1, 15_000_000)];
    const c = (ts: string, state: 'open' | 'dismissed' = 'open') => ({ ts, state });
    const open = oct(snaps, [], { openLedgerCandidates: [c('2026-10-15 10:00:00')] });
    expect(open.status).toBe('unknown');
    expect(has(open.reasons, 'ledger_open_candidates')).toBe(true);
    expect(oct(snaps, [], { openLedgerCandidates: [c('2026-10-15 10:00:00', 'dismissed')] }).status).toBe('ok');
    expect(oct(snaps, [], { openLedgerCandidates: [c('2026-11-02 10:00:00'), c('2026-09-30 23:00:00')] }).status).toBe('ok');
    expect(oct(snaps, [], { openLedgerCandidates: [c('2026-10-31 23:00:00')] }).status).toBe('unknown');
    expect(oct(snaps, [], { openLedgerCandidates: [c('엉터리')] }).status).toBe('unknown');
    expect(oct(snaps, [], { openLedgerCandidates: null as unknown as [] }).status).toBe('unknown');
  });

  // ── M-1 unmatched ──
  it('M-1 F2: unmatched 흐름 → 부분 (전에는 ok −9.52%, 경고 없음)', () => {
    // gain = 10,000,000 − 10,000,000 − 1,000,000 = −1,000,000, den = 10,500,000
    const r = oct([snap(S0, 10_000_000), snap(S1, 10_000_000)], [dep('2026-10-16 11:00', 1_000_000, { anchorStatus: 'unmatched', reflectedAt: null })]);
    expect(r.status).toBe('partial');
    expect(r.returnPct).toBeCloseTo((-1_000_000 / 10_500_000) * 100, 10);
    expect(has(r.reasons, 'flow_unmatched')).toBe(true);
    const none = oct([snap(S0, 10_000_000), snap(S1, 10_000_000)], [dep('2026-10-16 11:00', 1_000_000, { anchorStatus: undefined })]);
    expect(none.status).toBe('partial');
    expect(has(none.reasons, 'flow_unmatched')).toBe(true);
  });

  // ── M-2 큰 흐름 ──
  it('M-2 F5: 큰 입금 뒤 손실 −106.67% → 불명', () => {
    // 2027-02: T = 672h, 입금 5,000,000 @ 02-25 11:00 = 끝 − 84h → w = 0.125
    // gain = 4,000,000 − 5,000,000 − 5,000,000 = −6,000,000, den = 5,625,000 → −106.67%
    const snaps = [snap('2027-01-31 23:00', 5_000_000), snap('2027-02-28 23:00', 4_000_000)];
    const r = computeMonthlyReturn({
      month: '2027-02', now: kst('2027-03-05 12:00'), snapshots: snaps, flows: [dep('2027-02-25 11:00', 5_000_000)], baselineAt: BASE, openLedgerCandidates: [],
    }, DEPS);
    expect(r.status).toBe('unknown');
    expect(r.denominatorKrw).toBe(5_625_000);
    expect(has(r.reasons, 'return_below_minus_100')).toBe(true);
  });
  it('M-2: 단일 흐름 > 시작 50% → 부분, 정확히 50% → 정상', () => {
    // 입금 6,000,000 @ w=0.5: gain = 16,500,000 − 10,000,000 − 6,000,000 = 500,000, den = 13,000,000
    const big = oct([snap(S0, 10_000_000), snap(S1, 16_500_000)], [dep('2026-10-16 11:00', 6_000_000)]);
    expect(big.status).toBe('partial');
    expect(big.returnPct).toBeCloseTo((500_000 / 13_000_000) * 100, 10);
    expect(has(big.reasons, 'large_flow')).toBe(true);
    expect(oct([snap(S0, 10_000_000), snap(S1, 15_500_000)], [dep('2026-10-16 11:00', 5_000_000)]).status).toBe('ok');
  });
  it('M-2: 분모 < 시작 50% (단일 흐름은 50% 이하) → 부분', () => {
    // 출금 3,000,000 × 2 @ 10-01 23:00 (w = 720/744): den = 10,000,000 − 6,000,000 × 720/744 ≈ 4,193,548
    const r = oct([snap(S0, 10_000_000), snap(S1, 4_100_000)], [wd('2026-10-01 23:00', 3_000_000), wd('2026-10-01 23:00', 3_000_000)]);
    expect(r.status).toBe('partial');
    expect(r.denominatorKrw).toBeCloseTo(10_000_000 - 6_000_000 * (720 / 744), 4);
    expect(has(r.reasons, 'large_flow')).toBe(true);
    expect(LARGE_FLOW_DENOM_MIN_RATIO).toBe(0.5);
    expect(LARGE_FLOW_SINGLE_MAX_RATIO).toBe(0.5);
  });

  // ── M-3 미결제 매도 ──
  it('M-3: 끝점 USD 행 ustl_sll_amt_smtl > 0 → 부분, 입력 필드가 있으면 그 값을 쓴다', () => {
    const withUstl = (v: unknown, extra: Partial<MonthlySnapshotInput> = {}): MonthlySnapshotInput => {
      const base = snap(S1, 7_000_000);
      const pos = (base.positions as Record<string, unknown>[]).map((p) => (p.currency === 'KRW' ? p : { ...p, ustl_sll_amt_smtl: v }));
      return { ...base, positions: pos, ...extra };
    };
    const r = oct([snap(S0, 10_000_000), withUstl(3000)]);
    expect(r.status).toBe('partial');
    expect(r.returnPct).toBeCloseTo(-30, 10);
    expect(has(r.reasons, 'usd_unsettled_sale')).toBe(true);
    expect(oct([snap(S0, 10_000_000), withUstl('abc')]).status).toBe('partial');
    expect(oct([snap(S0, 10_000_000), withUstl(0)]).status).toBe('ok');
    expect(oct([snap(S0, 10_000_000), withUstl(3000, { unsettledSaleUsd: 0 })]).status).toBe('ok');
    expect(oct([snap(S0, 10_000_000), { ...snap(S1, 7_000_000), unsettledSaleUsd: 500 }]).status).toBe('partial');
    expect(oct([{ ...snap(S0, 10_000_000), unsettledSaleUsd: 1 }, snap(S1, 10_500_000)]).status).toBe('partial');
  });

  // ── M-4 같은 시각 스냅샷 ──
  it('M-4 F4: 끝점과 같은 ms 에 총액이 다른 행 → 입력 순서와 무관하게 불명 (전에는 −20% / +5%)', () => {
    const a = oct([snap(S0, 10_000_000), snap(S1, 10_500_000), snap(S1, 8_000_000)]);
    const b = oct([snap(S0, 10_000_000), snap(S1, 8_000_000), snap(S1, 10_500_000)]);
    expect(a.status).toBe('unknown');
    expect(b.status).toBe('unknown');
    expect(has(a.reasons, 'snapshot_ts_conflict')).toBe(true);
    expect(oct([snap(S0, 10_000_000), snap(S0, 9_000_000), snap(S1, 10_500_000)]).status).toBe('unknown');
  });
  it('M-4: 총액이 같아도 positions 가 다르면 불명, 완전히 같으면 하나로 본다', () => {
    const diff = oct([snap(S0, 10_000_000), snap(S1, 10_500_000), snap(S1, 10_500_000, { usd: 500 })]);
    expect(diff.status).toBe('unknown');
    const dup = oct([snap(S0, 10_000_000), snap(S1, 10_500_000), snap(S1, 10_500_000)]);
    expect(dup).toEqual(oct([snap(S0, 10_000_000), snap(S1, 10_500_000)]));
    expect(dup.status).toBe('ok');
    // 미결제 매도 입력만 다른 동시각 행도 충돌(순서에 따라 부분/정상이 갈리지 않게)
    const u = oct([snap(S0, 10_000_000), { ...snap(S1, 10_500_000), unsettledSaleUsd: 500 }, snap(S1, 10_500_000)]);
    expect(u.status).toBe('unknown');
  });

  // ── L ──
  it('L-2: periodEndNote — 지난 달은 kst_month_end_midsession, 진행 중이면 in_progress_now, 시작 전 달은 null', () => {
    expect(oct([snap(S0, 10_000_000), snap(S1, 10_500_000)]).periodEndNote).toBe('kst_month_end_midsession');
    expect(oct([snap(S0, 10_000_000), snap('2026-10-25 14:00', 10_300_000)], [], { now: kst('2026-10-25 15:00') }).periodEndNote).toBe('in_progress_now');
    expect(oct([], [], { now: kst('2026-09-01 00:00') }).periodEndNote).toBeNull();
  });
  it('L-1: 주입 평가기 반환 모양 — 실제 assessHiddenUsdCarry 의 쪽별 결과에 HiddenUsdSideLike 필드가 모두 있다(런타임 점검)', () => {
    const snaps = [snap(S0, 10_000_000), snap('2026-10-31 15:00', 10_480_000), snap(S1, 9_100_000, { hidden: true })];
    const out = assessHiddenUsdCarry({
      baseline: { ts: snaps[0].ts, total: 10_000_000, positions: snaps[0].positions as never },
      current: { ts: snaps[2].ts, total: 9_100_000, positions: snaps[2].positions as never },
      priors: snaps.map((x) => ({ ts: x.ts, positions: x.positions })), thresholdPct: 10,
    });
    for (const side of [out.baseline, out.current]) {
      expect(typeof side.state).toBe('string');
      for (const k of ['carriedQty', 'carriedPrice', 'carriedKRW', 'adjustedTotal'] as const) expect(typeof side[k]).toBe('number');
      expect(side.lastSeenMs === null || typeof side.lastSeenMs === 'number').toBe(true);
    }
    expect(out.current.state).toBe('hidden_carried');
    expect(out.current.lastSeenMs).toBe(kst('2026-10-31 15:00').getTime());
  });
  it('독립 손계산(Reviewer H1, 2027-02): 입금 w=1/4 + 출금 w=3/4 → −3.2323%', () => {
    const r = computeMonthlyReturn({
      month: '2027-02', now: kst('2027-03-05 12:00'), baselineAt: BASE, openLedgerCandidates: [],
      snapshots: [snap('2027-01-31 23:00', 12_000_000), snap('2027-02-28 23:00', 14_100_000)],
      flows: [dep('2027-02-21 23:00', 3_000_000), wd('2027-02-07 23:00', 500_000)],
    }, DEPS);
    expect(r.status).toBe('ok');
    expect(r.gainKrw).toBe(-400_000);
    expect(r.denominatorKrw).toBeCloseTo(12_375_000, 6);
    expect(r.returnPct).toBeCloseTo((-400_000 / 12_375_000) * 100, 10);
  });
});

describe('불변식', () => {
  const snaps = () => [snap(S0, 20_000_000), snap('2026-10-31 15:00', 21_900_000), snap(S1, 22_000_000)];
  const flows = () => [dep('2026-10-24 05:00', 5_000_000), wd('2026-10-16 11:00', 1_000_000), exch('2026-10-20 10:00', 700_000)];

  function deepFreeze<T>(o: T): T {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
    }
    return o;
  }

  it('순수성: 같은 입력 → 같은 출력', () => {
    const a = oct(snaps(), flows());
    const b = oct(snaps(), flows());
    expect(a).toEqual(b);
    expect(a.returnPct).toBeCloseTo(-9.638554216867469, 10);
  });
  it('입력 변이 없음(깊은 freeze 후 호출, 전후 JSON 동일)', () => {
    const input = deepFreeze({ month: '2026-10', now: NOW, snapshots: snaps(), flows: flows(), baselineAt: BASE, openLedgerCandidates: [] });
    const before = JSON.stringify(input);
    expect(() => computeMonthlyReturn(input, DEPS)).not.toThrow();
    expect(JSON.stringify(input)).toBe(before);
  });
  it('흐름 순서 무관', () => {
    const f = flows();
    const base = oct(snaps(), f);
    for (const perm of [[2, 1, 0], [1, 0, 2], [0, 2, 1]]) {
      expect(oct(snaps(), perm.map((i) => f[i]))).toEqual(base);
    }
  });
  it('스냅샷 순서 무관', () => {
    expect(oct([...snaps()].reverse(), flows())).toEqual(oct(snaps(), flows()));
  });
  it('환전 흐름을 더하거나 빼도 수익률·분모·순입금이 같다', () => {
    const without = oct(snaps(), flows().filter((f) => f.kind !== 'exchange'));
    const withMore = oct(snaps(), [...flows(), exch('2026-10-02 10:00', 3_000_000), exch('2026-10-30 10:00', null)]);
    expect(withMore.returnPct).toBe(without.returnPct);
    expect(withMore.denominatorKrw).toBe(without.denominatorKrw);
    expect(withMore.netFlowKrw).toBe(without.netFlowKrw);
  });
  it('금액식 대사: gainKrw = E_end − E_start − 순입금, returnPct = gainKrw ÷ 분모', () => {
    const r = oct(snaps(), flows());
    expect(r.gainKrw).toBe((r.endEquityKrw as number) - (r.startEquityKrw as number) - (r.netFlowKrw as number));
    expect(r.returnPct).toBeCloseTo(((r.gainKrw as number) / (r.denominatorKrw as number)) * 100, 12);
  });
});
