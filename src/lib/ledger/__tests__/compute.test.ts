/**
 * T-074 compute.ts — 승인 데모(`mockups/T-074-cash-flow-ledger-v1.html`) 합성 시나리오와 **정확히 같은 수치**를 내는지 고정한다.
 * 데모 수치: 기준 총자산 20,000,000원 · 입출금 뺀 손익 +830,000원 · 수익률(근사) +3.99% · 후보(원화 +700,000원) 기록 뒤 +130,000원.
 * 모든 값은 합성값이다(실제 계좌 값 아님).
 */
import {
  baselineUnconfirmed, baseTotal, computeSummary, draftEntryView, exchangeCostKrw, exchangeRate, krwEquivOf,
  predictAnchor, roundFx, sameAmount, simulateSummary, toCents, toFx4, usdToKrw,
} from '../compute';
import type { BaselineView, CandidateView, LedgerEntryView } from '../types';
import { parseKstWall } from '../kst';

const BASE: BaselineView = {
  version: 3, updatedAt: '2026-09-01 08:05:00', at: '2026-09-01 07:10:00', snapshotId: 1001,
  totalKrw: 20_000_000, krwCash: 1_200_000, usdCash: 1500, fx: 1240,
  confirmed: { krwCash: 1_200_000, usdCash: 1500, at: '2026-09-01 08:05:00', note: null },
  baselineTotalKrw: 20_000_000, unconfirmed: false, history: [],
};
const SNAP = { ts: '2026-09-15 09:40:00', totalKrw: 21_780_000, fx: 1250 };

function entry(p: Partial<LedgerEntryView> & Pick<LedgerEntryView, 'id' | 'kind' | 'occurredAt' | 'currency' | 'amount'>): LedgerEntryView {
  return {
    clientEntryId: `cid-${p.id}-xxxx`, counterCurrency: null, counterAmount: null, memo: null, source: 'user',
    createdAt: '2026-09-15 09:52:00', createdByUserId: 1,
    anchor: { status: 'pending', snapshotId: null, snapshotTs: null, detail: null, suggest: null },
    fxRateUsed: null, fxSource: null, krwEquiv: null, supersedes: null, supersededBy: null, void: null, beforeBaseline: false,
    ...p,
  };
}
const matched = (ts: string) => ({ status: 'matched' as const, snapshotId: 1, snapshotTs: ts, detail: 'x', suggest: null });

/** 데모 SEED 7건 그대로 */
function seed(): LedgerEntryView[] {
  return [
    entry({ id: 1, kind: 'deposit', occurredAt: '2026-09-03 10:00', currency: 'KRW', amount: 1_000_000, anchor: matched('2026-09-03 10:40:00') }),
    entry({ id: 2, kind: 'deposit', occurredAt: '2026-09-03 10:01', currency: 'KRW', amount: 1_000_000, void: { type: 'cancel', reason: '중복 입력', at: '2026-09-03 10:12:00', byUserId: 1, by: null } }),
    entry({ id: 3, kind: 'exchange', occurredAt: '2026-09-05 13:00', currency: 'KRW', amount: 1_260_000, counterCurrency: 'USD', counterAmount: 1000, anchor: matched('2026-09-05 13:40:00'), fxRateUsed: 1256.2 }),
    entry({ id: 4, kind: 'withdrawal', occurredAt: '2026-09-10 14:00', currency: 'KRW', amount: 3_000_000, anchor: { status: 'unmatched', snapshotId: null, snapshotTs: null, detail: '맞는 현금 변화 없음', suggest: null }, void: { type: 'super', reason: '자릿수 잘못 입력', at: '2026-09-10 15:02:00', byUserId: 1, by: 5 } }),
    entry({ id: 5, kind: 'withdrawal', occurredAt: '2026-09-10 14:00', currency: 'KRW', amount: 300_000, anchor: matched('2026-09-10 14:40:00'), supersedes: 4 }),
    entry({ id: 6, kind: 'deposit', occurredAt: '2026-09-12 21:30', currency: 'USD', amount: 200, anchor: matched('2026-09-12 22:00:00'), fxRateUsed: 1250, krwEquiv: 250_000 }),
    entry({ id: 7, kind: 'deposit', occurredAt: '2026-09-15 09:50', currency: 'KRW', amount: 500_000 }),
  ];
}

describe('데모 합성 시나리오 — 수치 정확히 일치', () => {
  test('입출금 뺀 손익 +830,000원 · 수익률(근사) +3.99% · 순입금 950,000원', () => {
    const s = computeSummary({ baseline: BASE, snapshot: SNAP, entries: seed() })!;
    expect(s.b0).toBe(20_000_000);
    expect(s.v).toBe(21_780_000);
    expect(s.inflow).toBe(1_250_000);
    expect(s.outflow).toBe(300_000);
    expect(s.net).toBe(950_000);
    expect(s.P).toBe(830_000);
    expect(s.R!.toFixed(2)).toBe('3.99');
    // Modified Dietz 분모를 독립 계산으로 대조: T = 14일 150분 = 20,310분
    const T = 20_310;
    const den = 20_000_000 + 1_000_000 * (17_220 / T) - 300_000 * (6_900 / T) + 250_000 * (3_580 / T);
    expect(s.R).toBeCloseTo((830_000 / den) * 100, 10);
    expect(s.pending).toEqual({ count: 1, krw: 500_000 });
    expect(s.unmatched).toBe(0);
    expect(s.live).toBe(5);
    expect(s.voids).toBe(2);
    expect(s.pre).toBe(0);
    expect(s.days).toBe(14);
    expect(s.unconfirmed).toBe(false);
    expect(s.fxMissing).toBe(0);
    expect(s.last).toMatchObject({ id: 7, occurredAt: '2026-09-15 09:50', status: 'pending' });
  });

  test('후보(09-14 22:20 원화 +700,000원) 를 입금으로 기록하면 손익 +130,000원 (데모 확인 단계 미리보기)', () => {
    const cand: CandidateView = {
      key: '1340-KRW', snapshotId: 1340, ts: '2026-09-14 22:20:00', prevSnapshotId: 1339, prevTs: '2026-09-14 21:10:00',
      currency: 'KRW', delta: 700_000, direction: 'deposit', state: 'open', reason: null, dismissedAt: null, dismissedByUserId: null,
    };
    const t = parseKstWall('2026-09-14 22:20')!;
    const pr = predictAnchor({ kind: 'deposit', currency: 'KRW', amount: 700_000, occurredAtMs: t }, { snapshotTs: SNAP.ts, candidate: cand });
    expect(pr).toEqual({ status: 'matched', anchorTs: '2026-09-14 22:20:00' });
    const draft = draftEntryView({ kind: 'deposit', currency: 'KRW', amount: 700_000, occurredAtMs: t }, pr, { id: 999, snapshotFx: 1250, nowMs: t });
    const after = simulateSummary({ baseline: BASE, snapshot: SNAP, entries: seed() }, (es) => { es.push(draft); });
    expect(after!.P).toBe(130_000);
    expect(after!.net).toBe(1_650_000);
    // 원본은 그대로
    expect(computeSummary({ baseline: BASE, snapshot: SNAP, entries: seed() })!.P).toBe(830_000);
  });

  test('데모 "불일치" 변형 — #6 이 불일치(환율 미고정)면 최신 환율 1,250 으로 환산해 같은 손익, 불일치 1건', () => {
    const es = seed();
    es[5] = { ...es[5], anchor: { status: 'unmatched', snapshotId: null, snapshotTs: null, detail: 'x', suggest: null }, fxRateUsed: null, krwEquiv: null };
    const s = computeSummary({ baseline: BASE, snapshot: SNAP, entries: es })!;
    expect(s.P).toBe(830_000);
    expect(s.unmatched).toBe(1);
  });

  test('데모 "빈 상태" — 기록 없음, 현재 20,420,000원 → +420,000원 · 2.10%', () => {
    const s = computeSummary({ baseline: BASE, snapshot: { ...SNAP, totalKrw: 20_420_000 }, entries: [] })!;
    expect(s.P).toBe(420_000);
    expect(s.R!.toFixed(2)).toBe('2.10');
    expect(s.last).toBeNull();
  });

  test('취소 미리보기(데모 cancelSheet): #5 출금 취소 → 순입금 1,250,000 · 손익 +530,000원', () => {
    const s = simulateSummary({ baseline: BASE, snapshot: SNAP, entries: seed() }, (es) => {
      const e = es.find((x) => x.id === 5)!;
      e.void = { type: 'cancel', reason: 'x', at: null, byUserId: null, by: null };
    })!;
    expect(s.net).toBe(1_250_000);
    expect(s.P).toBe(530_000);
  });
});

describe('계산 규칙 — 핵심 부호·제외', () => {
  const base = { baseline: BASE, snapshot: SNAP };
  test('입금은 +, 출금은 − (부호)', () => {
    const d = computeSummary({ ...base, entries: [entry({ id: 1, kind: 'deposit', occurredAt: '2026-09-03 10:00', currency: 'KRW', amount: 1_000_000, anchor: matched('2026-09-03 10:40:00') })] })!;
    const w = computeSummary({ ...base, entries: [entry({ id: 1, kind: 'withdrawal', occurredAt: '2026-09-03 10:00', currency: 'KRW', amount: 1_000_000, anchor: matched('2026-09-03 10:40:00') })] })!;
    expect(d.P).toBe(21_780_000 - 20_000_000 - 1_000_000);
    expect(w.P).toBe(21_780_000 - 20_000_000 + 1_000_000);
  });
  test('환전은 순입금 0 (반영됨이어도)', () => {
    const s = computeSummary({ ...base, entries: [seed()[2]] })!;
    expect(s.net).toBe(0);
    expect(s.P).toBe(1_780_000);
    expect(s.live).toBe(1);
  });
  test('반영 대기는 순입금에서 빠지고 pending 에만', () => {
    const s = computeSummary({ ...base, entries: [seed()[6]] })!;
    expect(s.net).toBe(0);
    expect(s.pending).toEqual({ count: 1, krw: 500_000 });
  });
  test('불일치는 기록대로 순입금에 포함(경고만)', () => {
    const s = computeSummary({ ...base, entries: [entry({ id: 1, kind: 'deposit', occurredAt: '2026-09-03 10:00', currency: 'KRW', amount: 1_000_000, anchor: { status: 'unmatched', snapshotId: null, snapshotTs: null, detail: 'x', suggest: null } })] })!;
    expect(s.net).toBe(1_000_000);
    expect(s.unmatched).toBe(1);
  });
  test('기준 시각 이전·같은 시각 기록은 계산 제외(pre)', () => {
    const s = computeSummary({ ...base, entries: [
      entry({ id: 1, kind: 'deposit', occurredAt: '2026-08-31 10:00', currency: 'KRW', amount: 1_000_000, anchor: matched('2026-08-31 10:40:00') }),
      entry({ id: 2, kind: 'deposit', occurredAt: '2026-09-01 07:10', currency: 'KRW', amount: 2_000_000, anchor: matched('2026-09-01 07:40:00') }),
    ] })!;
    expect(s.pre).toBe(2);
    expect(s.net).toBe(0);
    expect(s.P).toBe(1_780_000);
  });
  test('기준·스냅샷이 없으면 null', () => {
    expect(computeSummary({ baseline: null, snapshot: SNAP, entries: [] })).toBeNull();
    expect(computeSummary({ baseline: BASE, snapshot: null, entries: [] })).toBeNull();
  });
  test('분모 ≤ 0 이면 수익률 null(계산 불가), 손익은 그대로', () => {
    const s = computeSummary({ baseline: { ...BASE, totalKrw: 0, confirmed: { ...BASE.confirmed, krwCash: null, usdCash: null } }, snapshot: { ...SNAP, totalKrw: 100 }, entries: [] })!;
    expect(s.R).toBeNull();
    expect(s.P).toBe(100);
  });
  test('환율이 없는 USD 기록은 빼고 fxMissing 으로 센다', () => {
    const s = computeSummary({ baseline: BASE, snapshot: { ...SNAP, fx: null }, entries: [entry({ id: 1, kind: 'deposit', occurredAt: '2026-09-03 10:00', currency: 'USD', amount: 100, anchor: { status: 'unmatched', snapshotId: null, snapshotTs: null, detail: 'x', suggest: null } })] })!;
    expect(s.fxMissing).toBe(1);
    expect(s.net).toBe(0);
  });
  test('가중치 시각 = 반영 스냅샷 시각(반영됨) — 기록 시각이 아니라', () => {
    const a = computeSummary({ ...base, entries: [entry({ id: 1, kind: 'deposit', occurredAt: '2026-09-03 10:00', currency: 'KRW', amount: 1_000_000, anchor: matched('2026-09-10 10:00:00') })] })!;
    const b = computeSummary({ ...base, entries: [entry({ id: 1, kind: 'deposit', occurredAt: '2026-09-03 10:00', currency: 'KRW', amount: 1_000_000, anchor: matched('2026-09-03 10:00:00') })] })!;
    expect(a.P).toBe(b.P);
    expect(a.R).toBeGreaterThan(b.R!);   // 늦게 들어온 돈은 덜 투자돼 있었다 → 분모가 작다
  });
});

describe('기준 총자산 보정 (데모 baseTotal)', () => {
  test('확인 현금이 스냅샷과 같으면 스냅샷 총액 그대로', () => {
    expect(baseTotal(BASE)).toBe(20_000_000);
  });
  test('달러 확인값 차이 × 스냅샷 환율 + 원화 확인값 차이', () => {
    // 스냅샷 달러 $1,500 → 확인 $1,250.40 (−$249.60 × 1,240 = −309,504), 원화 1,200,000 → 1,180,000 (−20,000)
    expect(baseTotal({ ...BASE, confirmed: { krwCash: 1_180_000, usdCash: 1250.4, at: null, note: null } })).toBe(20_000_000 - 309_504 - 20_000);
  });
  test('확인값 null 은 스냅샷 값 사용(그 항 0) · 미확정 판정', () => {
    const b = { ...BASE, confirmed: { krwCash: null, usdCash: null, at: null, note: null } };
    expect(baseTotal(b)).toBe(20_000_000);
    expect(baselineUnconfirmed(b)).toBe(true);
    expect(baselineUnconfirmed({ ...b, confirmed: { ...b.confirmed, krwCash: 1 } })).toBe(true);
    expect(baselineUnconfirmed(BASE)).toBe(false);
  });
  test('스냅샷에 USD 행이 없으면 달러 확인을 요구하지 않는다', () => {
    expect(baselineUnconfirmed({ usdCash: null, confirmed: { krwCash: 5, usdCash: null, at: null, note: null } })).toBe(false);
  });
  test('반올림은 데모의 Math.round 와 같다(정수 산술, 반은 +∞ 쪽): ±$0.01 × 1,250 = ±12.5원 → 13 / −12', () => {
    expect(baseTotal({ totalKrw: 0, krwCash: 0, usdCash: 0, fx: 1250, confirmed: { krwCash: null, usdCash: 0.01, at: null, note: null } })).toBe(Math.round(12.5));
    expect(baseTotal({ totalKrw: 0, krwCash: 0, usdCash: 0.01, fx: 1250, confirmed: { krwCash: null, usdCash: 0, at: null, note: null } })).toBe(Math.round(-12.5));
    expect(Math.round(-12.5)).toBe(-12);
  });
});

describe('돈 산술 — 부동소수 오차 대비', () => {
  test('usdToKrw: 118.60 × 1,324.63 = 157,101.118 → 157,101 (부동소수 곱의 끝자리 흔들림 없음)', () => {
    expect(usdToKrw(118.6, 1324.63)).toBe(157_101);
    expect(usdToKrw(0.1 + 0.2, 1000)).toBe(300);
    expect(usdToKrw(1_000_000, 9999.9999)).toBe(9_999_999_900);
  });
  test('toCents·toFx4·roundFx', () => {
    expect(toCents(118.6)).toBe(11_860);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toFx4(1324.63)).toBe(13_246_300);
    expect(roundFx(1324.631249)).toBe(1324.6312);
  });
  test('sameAmount: 달러는 센트, 원화는 원 단위', () => {
    expect(sameAmount('USD', 0.1 + 0.2, 0.3)).toBe(true);
    expect(sameAmount('USD', 200, 200.01)).toBe(false);
    expect(sameAmount('KRW', 1_000_000, 1_000_000.4)).toBe(true);
  });
  test('krwEquivOf: KRW = 금액, USD = 저장값 → fxRateUsed → 최신 환율, 환전 = null', () => {
    expect(krwEquivOf({ kind: 'deposit', currency: 'KRW', amount: 5, krwEquiv: null, fxRateUsed: null }, 1250)).toBe(5);
    expect(krwEquivOf({ kind: 'deposit', currency: 'USD', amount: 200, krwEquiv: 249_000, fxRateUsed: 1250 }, 1300)).toBe(249_000);
    expect(krwEquivOf({ kind: 'deposit', currency: 'USD', amount: 200, krwEquiv: null, fxRateUsed: 1240 }, 1300)).toBe(248_000);
    expect(krwEquivOf({ kind: 'deposit', currency: 'USD', amount: 200, krwEquiv: null, fxRateUsed: null }, 1300)).toBe(260_000);
    expect(krwEquivOf({ kind: 'exchange', currency: 'KRW', amount: 1, krwEquiv: null, fxRateUsed: null }, 1300)).toBeNull();
  });
});

describe('환전 환율·비용(추정) — 데모 exRate·exCost', () => {
  const e3 = seed()[2];
  test('원화→달러 1,260,000원 → $1,000 : 환율 1,260 · 비용 1,260,000 − 1,000×1,256.2 = 3,800원', () => {
    expect(exchangeRate(e3)).toBe(1260);
    expect(exchangeCostKrw(e3, 1256.2)).toBe(3_800);
  });
  test('달러→원화 $1,000 → 1,245,000원 : 비용 1,000×1,250 − 1,245,000 = 5,000원', () => {
    const e = { kind: 'exchange' as const, currency: 'USD' as const, amount: 1000, counterAmount: 1_245_000 };
    expect(exchangeRate(e)).toBe(1245);
    expect(exchangeCostKrw(e, 1250)).toBe(5_000);
  });
  test('환전이 아니거나 환율 없음 → null', () => {
    expect(exchangeRate(seed()[0])).toBeNull();
    expect(exchangeCostKrw(e3, null)).toBeNull();
  });
});

describe('predictAnchor — 데모 predict 와 같은 경계', () => {
  const cand: CandidateView = {
    key: '1340-KRW', snapshotId: 1340, ts: '2026-09-14 22:20:00', prevSnapshotId: 1339, prevTs: '2026-09-14 21:10:00',
    currency: 'KRW', delta: 700_000, direction: 'deposit', state: 'open', reason: null, dismissedAt: null, dismissedByUserId: null,
  };
  const at = (s: string) => parseKstWall(s)!;
  test('후보와 시각·금액(허용 ±1,000원)이 맞으면 matched, 1,001원 차이는 아님', () => {
    expect(predictAnchor({ kind: 'deposit', currency: 'KRW', amount: 701_000, occurredAtMs: at('2026-09-14 21:11') }, { snapshotTs: SNAP.ts, candidate: cand }).status).toBe('matched');
    expect(predictAnchor({ kind: 'deposit', currency: 'KRW', amount: 701_001, occurredAtMs: at('2026-09-14 21:11') }, { snapshotTs: SNAP.ts, candidate: cand }).status).toBe('unmatched');
  });
  test('시각이 직전 스냅샷과 같거나 이르면 아님(t > prev), 후보 시각과 같으면 맞음(t ≤ ts)', () => {
    expect(predictAnchor({ kind: 'deposit', currency: 'KRW', amount: 700_000, occurredAtMs: at('2026-09-14 21:10') }, { snapshotTs: SNAP.ts, candidate: cand }).status).toBe('unmatched');
    expect(predictAnchor({ kind: 'deposit', currency: 'KRW', amount: 700_000, occurredAtMs: at('2026-09-14 22:20') }, { snapshotTs: SNAP.ts, candidate: cand }).status).toBe('matched');
  });
  test('방향이 반대(출금)·통화가 다르면·후보가 닫혀 있으면 아님', () => {
    const t = at('2026-09-14 22:00');
    expect(predictAnchor({ kind: 'withdrawal', currency: 'KRW', amount: 700_000, occurredAtMs: t }, { snapshotTs: SNAP.ts, candidate: cand }).status).toBe('unmatched');
    expect(predictAnchor({ kind: 'deposit', currency: 'USD', amount: 700_000, occurredAtMs: t }, { snapshotTs: SNAP.ts, candidate: cand }).status).toBe('unmatched');
    expect(predictAnchor({ kind: 'deposit', currency: 'KRW', amount: 700_000, occurredAtMs: t }, { snapshotTs: SNAP.ts, candidate: { ...cand, state: 'dismissed' } }).status).toBe('unmatched');
  });
  test('최신 스냅샷보다 뒤면 pending, 환전은 후보와 무관', () => {
    expect(predictAnchor({ kind: 'deposit', currency: 'KRW', amount: 1, occurredAtMs: at('2026-09-15 09:50') }, { snapshotTs: SNAP.ts })).toEqual({ status: 'pending', anchorTs: null });
    expect(predictAnchor({ kind: 'exchange', currency: 'KRW', amount: 700_000, occurredAtMs: at('2026-09-14 22:00') }, { snapshotTs: SNAP.ts, candidate: cand }).status).toBe('unmatched');
  });
});
