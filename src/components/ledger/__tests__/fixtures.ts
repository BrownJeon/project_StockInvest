/**
 * T-074 WP-B 시험용 합성 화면 데이터 — 승인 데모 v1 의 합성값 그대로(기준 2026-09-01 07:10 · 기준 총자산 20,000,000원 · 환율 1,250 등).
 * **실제 계좌 값이 아니다.** 요약(`summary`)은 서버와 같은 `computeSummary` 로 만든다(서버가 내는 값과 같은 함수).
 */
import type {
  BaselineOption, BaselineView, CandidateView, LedgerEntryView, LedgerFeed, SnapshotView,
} from '@/lib/ledger/types';
import { computeSummary } from '@/lib/ledger/compute';
import { RULE } from '@/lib/ledger/rules';
import type { LedgerFeedState } from '@/components/ledger/useLedgerFeed';

export const BASE: BaselineView = {
  version: 3, updatedAt: '2026-09-01 08:05:00', at: '2026-09-01 07:10:00', snapshotId: 1001,
  totalKrw: 20_000_000, krwCash: 1_200_000, usdCash: 1500, fx: 1240,
  confirmed: { krwCash: 1_200_000, usdCash: 1500, at: '2026-09-01 08:05:00', note: null },
  baselineTotalKrw: 20_000_000, unconfirmed: false, history: [],
};

export const BASE_UNCONFIRMED: BaselineView = {
  ...BASE, confirmed: { krwCash: null, usdCash: null, at: null, note: null }, unconfirmed: true,
};

export const SNAP: SnapshotView = {
  id: 1342, ts: '2026-09-15 09:40:00', totalKrw: 21_780_000, krwCash: 2_410_000, usdCash: 2700, fx: 1250,
  stale: false, ageMin: 15, usdGapHint: null,
};

export function entry(p: Partial<LedgerEntryView> & Pick<LedgerEntryView, 'id' | 'kind' | 'occurredAt' | 'currency' | 'amount'>): LedgerEntryView {
  return {
    clientEntryId: `cid-${p.id}-xxxx`, counterCurrency: null, counterAmount: null, memo: null, source: 'user',
    createdAt: '2026-09-15 09:52:00', createdByUserId: 1,
    anchor: { status: 'pending', snapshotId: null, snapshotTs: null, detail: null, suggest: null },
    fxRateUsed: null, fxSource: null, krwEquiv: null, supersedes: null, supersededBy: null, void: null, beforeBaseline: false,
    ...p,
  };
}

const matched = (ts: string, detail: string) => ({ status: 'matched' as const, snapshotId: 1, snapshotTs: ts, detail, suggest: null });

/** 데모 SEED 7건 */
export function seed(): LedgerEntryView[] {
  return [
    entry({ id: 1, kind: 'deposit', occurredAt: '2026-09-03 10:00', createdAt: '2026-09-03 10:05:00', currency: 'KRW', amount: 1_000_000, memo: '월급 일부', anchor: matched('2026-09-03 10:40:00', '원화 현금 +1,000,000원 확인 (허용 ±1,000원)') }),
    entry({ id: 2, kind: 'deposit', occurredAt: '2026-09-03 10:01', createdAt: '2026-09-03 10:06:00', currency: 'KRW', amount: 1_000_000, void: { type: 'cancel', reason: '중복 입력', at: '2026-09-03 10:12:00', byUserId: 1, by: null } }),
    entry({ id: 3, kind: 'exchange', occurredAt: '2026-09-05 13:00', createdAt: '2026-09-05 13:10:00', currency: 'KRW', amount: 1_260_000, counterCurrency: 'USD', counterAmount: 1000, anchor: matched('2026-09-05 13:40:00', '같은 스냅샷에서 원화 −1,260,000원 · 달러 +$1,000.00 확인'), fxRateUsed: 1256.2 }),
    entry({ id: 4, kind: 'withdrawal', occurredAt: '2026-09-10 14:00', createdAt: '2026-09-10 14:20:00', currency: 'KRW', amount: 3_000_000, memo: '카드값', anchor: { status: 'unmatched', snapshotId: null, snapshotTs: null, detail: '맞는 현금 변화 없음', suggest: null }, supersededBy: 5, void: { type: 'super', reason: '자릿수 잘못 입력', at: '2026-09-10 15:02:00', byUserId: 1, by: 5 } }),
    entry({ id: 5, kind: 'withdrawal', occurredAt: '2026-09-10 14:00', createdAt: '2026-09-10 15:02:00', currency: 'KRW', amount: 300_000, memo: '카드값', anchor: matched('2026-09-10 14:40:00', '원화 현금 −300,000원 확인 (허용 ±1,000원)'), supersedes: 4 }),
    entry({ id: 6, kind: 'deposit', occurredAt: '2026-09-12 21:30', createdAt: '2026-09-12 21:45:00', currency: 'USD', amount: 200, memo: '해외 계좌에서', anchor: matched('2026-09-12 22:00:00', '달러 현금 +$200.00 확인 (허용 ±$1)'), fxRateUsed: 1250, fxSource: 'snapshot', krwEquiv: 250_000 }),
    entry({ id: 7, kind: 'deposit', occurredAt: '2026-09-15 09:50', createdAt: '2026-09-15 09:52:00', currency: 'KRW', amount: 500_000 }),
  ];
}

export const CAND: CandidateView = {
  key: '1340-KRW', snapshotId: 1340, ts: '2026-09-14 22:20:00', prevSnapshotId: 1339, prevTs: '2026-09-14 21:10:00',
  currency: 'KRW', delta: 700_000, direction: 'deposit', state: 'open', reason: null, dismissedAt: null, dismissedByUserId: null,
};

export const OPTIONS: BaselineOption[] = [
  { id: 1338, ts: '2026-09-15 07:10:00', totalKrw: 21_760_000, krwCash: 2_410_000, usdCash: 2700, fx: 1249.5, tags: ['today_morning'] },
  { id: 1342, ts: '2026-09-15 09:40:00', totalKrw: 21_780_000, krwCash: 2_410_000, usdCash: 2700, fx: 1250, tags: ['latest'] },
  { id: 1316, ts: '2026-09-14 07:12:00', totalKrw: 21_050_000, krwCash: 1_710_000, usdCash: 2700, fx: 1246, tags: ['yesterday_morning'] },
];

export function feedOf(o: {
  baseline?: BaselineView | null; snapshot?: SnapshotView | null; entries?: LedgerEntryView[]; candidates?: CandidateView[];
} = {}): LedgerFeed {
  const baseline = o.baseline === undefined ? BASE : o.baseline;
  const snapshot = o.snapshot === undefined ? SNAP : o.snapshot;
  const entries = o.entries ?? seed();
  return {
    baseline, snapshot, entries,
    summary: computeSummary({ baseline, snapshot, entries }),
    candidates: o.candidates ?? [CAND],
    baselineOptions: OPTIONS, rules: RULE, now: '2026-09-15 09:55:00', persisted: true, scanTruncated: false,
  };
}

export function stateOf(data: LedgerFeed | null, load: LedgerFeedState['load'] = 'ready', loadError: string | null = null, loadCode: string | null = null): LedgerFeedState {
  return { data, load, loadError, loadCode, reload: jest.fn(), refresh: jest.fn(), replace: jest.fn() };
}

/** 마크업의 id 값들 */
export function idsOf(html: string): string[] {
  return [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
}

/** 중복 id */
export function dupIds(html: string): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of idsOf(html)) { if (seen.has(id)) dup.add(id); seen.add(id); }
  return [...dup];
}

/** 태그를 지운 글자(공백 정리) */
export function textOf(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
}
