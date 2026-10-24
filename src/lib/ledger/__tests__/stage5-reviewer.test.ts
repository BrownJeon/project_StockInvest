/**
 * T-074 Stage 5 — Reviewer 조건 반영 시험: M1(같은 clientEntryId 내용 비교) · L1(쉼표 자리) · L4(매매 단계 근거 문장) · L8(원장 표만 '준비 중')
 * + Reviewer 항목 6-ii 의 생존 변이 11개(MU02·MU08·MS06·MM10·MM13·MM08·MX06·MX05·MU06·MX10·MH05 — MX10·MH05 는 라우트 시험)를 잡는 시험.
 * 합성값만(데모 흐름 — 기준 2026-09-01 07:10, 환율 1,250).
 */
jest.mock('@/lib/db', () => ({ getPool: () => { throw new Error('이 시험은 DB 를 쓰지 않는다'); } }));

import { computeSummary, roundFx, toFx4, usdToKrw } from '../compute';
import { parseAmount, parseCash } from '../validate';
import { buildSteps, parseSeries, parseSnapshotRow } from '../snapshots';
import { matchEntries, tradeNoteText, type MatchEntry } from '../match';
import { isNoTable, type StoredEntry } from '../store';
import { parseId, sameEntryContent, toEntryView } from '../service';
import { parseKstWall } from '../kst';
import type { BaselineView, LedgerEntryView } from '../types';
import { HOLD, snapRow, type SnapSpec } from './helpers/fixtures';

const at = (s: string) => parseKstWall(s)!;

function demoRows() {
  const r = (id: number, ts: string, s: SnapSpec) => snapRow(id, ts, { holdings: HOLD, ...s });
  return [
    r(100, '2026-09-01 07:10', { krw: 1_200_000, usd: 1500, fx: 1240 }),
    r(101, '2026-09-03 09:40', { krw: 1_200_000, usd: 1500, fx: 1250 }),
    r(102, '2026-09-03 10:40', { krw: 2_200_000, usd: 1500, fx: 1250 }),
    r(103, '2026-09-05 12:40', { krw: 2_200_000, usd: 1500, fx: 1256.2 }),
    r(104, '2026-09-05 13:40', { krw: 940_000, usd: 2500, fx: 1256.2 }),
    r(105, '2026-09-10 14:40', { krw: 640_000, usd: 2500, fx: 1250 }),
    r(110, '2026-09-15 09:40', { krw: 640_000, usd: 2500, fx: 1250 }),
  ];
}
let nextId = 1;
function me(p: Partial<MatchEntry> & Pick<MatchEntry, 'kind' | 'currency' | 'amount'> & { at: string }): MatchEntry {
  const { at: when, ...rest } = p;
  return { id: nextId++, occurredAtMs: at(when), counterCurrency: null, counterAmount: null, anchorStatus: 'pending', anchorSnapshotId: null, voided: false, ...rest };
}
beforeEach(() => { nextId = 1; });
function run(entries: MatchEntry[], rows = demoRows(), scanFrom = '2026-09-01 07:10') {
  const series = parseSeries(rows);
  return matchEntries(entries, series, buildSteps(series), { scanFromMs: at(scanFrom) });
}

describe('L1 — 쉼표는 천 단위 자리일 때만 (Reviewer 재현 입력 그대로)', () => {
  test.each([
    ['118,60', 'USD'], ['1,5', 'USD'], ['1,00,0', 'KRW'], ['12,34.56', 'USD'], [' , ', 'KRW'], ['1,0000', 'KRW'], [',100', 'KRW'], ['100,', 'KRW'],
  ] as const)('🔴 %s (%s) → format 오류("숫자만 넣어 주세요."), 오해석하지 않는다', (raw, c) => {
    expect(parseAmount(raw, c)).toEqual({ error: { code: 'format', message: '숫자만 넣어 주세요.' } });
  });
  test('바른 천 단위 쉼표는 그대로 허용 · 부호는 쉼표보다 먼저 거부 · 기준 현금(parseCash)도 같은 규칙', () => {
    expect(parseAmount('1,000,000', 'KRW')).toEqual({ value: 1_000_000 });
    expect(parseAmount('1,250.40', 'USD')).toEqual({ value: 1250.4 });
    expect(parseAmount(' 2,000 ', 'KRW')).toEqual({ value: 2000 });
    expect(parseAmount('-1,000', 'KRW')).toMatchObject({ error: { code: 'sign' } });
    expect(parseCash('118,60', 'USD')).toMatchObject({ error: { code: 'format' } });
    expect(parseCash('1,200,000', 'KRW')).toEqual({ value: 1_200_000 });
  });
});

describe('L8 — 원장 표가 없을 때만 not_migrated', () => {
  const err1146 = (msg: string) => Object.assign(new Error(msg), { code: 'ER_NO_SUCH_TABLE', errno: 1146 });
  test('🔴 cash_flow_ledger 1146 → true · 다른 표 1146 → false(장애로 500) · sqlMessage 도 본다', () => {
    expect(isNoTable(err1146("Table 't074.cash_flow_ledger' doesn't exist"))).toBe(true);
    expect(isNoTable(err1146("Table 't074.portfolio_snapshots' doesn't exist"))).toBe(false);
    expect(isNoTable(err1146("Table 't074.system_config' doesn't exist"))).toBe(false);
    expect(isNoTable(err1146("Table 't074.accounts' doesn't exist"))).toBe(false);
    expect(isNoTable({ errno: 1146, sqlMessage: "Table 'x.cash_flow_ledger' doesn't exist" })).toBe(true);
    expect(isNoTable(Object.assign(new Error('cash_flow_ledger connect ETIMEDOUT'), { code: 'ETIMEDOUT' }))).toBe(false);
  });
});

describe('L4 — 보유가 바뀐 단계에서 맞으면 근거 문장에 한 줄 (상태·계산은 그대로)', () => {
  test('🔴 매매가 같은 단계에 있으면 "…정확히 입금 때문이라고 확인하지는 못했습니다." · 보유 같으면 문장 없음', () => {
    const r = (id: number, ts: string, s: SnapSpec) => snapRow(id, ts, { usd: 1500, fx: 1250, ...s });
    const rows = [
      r(200, '2026-09-03 09:40', { krw: 1_200_000, holdings: HOLD }),
      r(201, '2026-09-03 10:40', { krw: 2_200_000, holdings: { ...HOLD, AAA001: [90, 60_000] } }),   // 보유 수량 변화 + 원화 +1,000,000
      r(202, '2026-09-04 10:40', { krw: 1_700_000, holdings: { ...HOLD, AAA001: [90, 60_000] } }),   // 보유 그대로 원화 −500,000
    ];
    const dep = me({ kind: 'deposit', currency: 'KRW', amount: 1_000_000, at: '2026-09-03 10:00' });
    const wd = me({ kind: 'withdrawal', currency: 'KRW', amount: 500_000, at: '2026-09-04 10:00' });
    const out = run([dep, wd], rows, '2026-09-03 09:40');
    expect(out.results.get(dep.id)).toMatchObject({ status: 'matched', snapshotId: 201 });
    expect(out.results.get(dep.id)!.detail).toBe(`원화 현금 +1,000,000원 확인 (허용 ±1,000원) ${tradeNoteText('deposit')}`);
    expect(tradeNoteText('deposit')).toBe('같은 단계에 매매가 있어 정확히 입금 때문이라고 확인하지는 못했습니다.');
    expect(tradeNoteText('withdrawal')).toBe('같은 단계에 매매가 있어 정확히 출금 때문이라고 확인하지는 못했습니다.');
    expect(out.results.get(wd.id)!.detail).toBe('원화 현금 −500,000원 확인 (허용 ±1,000원)');
    expect(out.results.get(wd.id)!.krwEquiv).toBe(500_000);
  });
});

describe('M1 — 같은 clientEntryId 재전송의 내용 비교(sameEntryContent)', () => {
  const stored: StoredEntry = {
    id: 9, clientEntryId: 'cid-m1-0001', kind: 'exchange', occurredAtMs: at('2026-09-05 13:00'), currency: 'KRW', amount: 1_260_000,
    counterCurrency: 'USD', counterAmount: 1000, fxRateUsed: null, fxSource: null, krwEquiv: null, anchorSnapshotId: null, anchorSnapshotTsMs: null,
    anchorStatus: 'pending', anchorDetail: null, memo: '환전', source: 'user', supersedesId: null, createdAtMs: 0, createdByUserId: 1,
    deletedAtMs: null, deletedByUserId: null, deleteReason: null,
  };
  const same = { kind: 'exchange', currency: 'KRW', amount: '1,260,000', counterCurrency: 'USD', counterAmount: '1000.00', occurredAt: '2026-09-05 13:00', memo: '  환전 ' };
  test('같은 내용(쉼표·소수 0·메모 앞뒤 공백 차이는 같은 값) → true', () => {
    expect(sameEntryContent(stored, same, null)).toBe(true);
  });
  test.each([
    ['종류', { kind: 'deposit' }], ['통화', { currency: 'USD' }], ['금액', { amount: '1260001' }], ['발생 시각', { occurredAt: '2026-09-05 13:01' }],
    ['받은 통화', { counterCurrency: 'KRW' }], ['받은 금액', { counterAmount: '999.99' }], ['메모', { memo: '다른 메모' }], ['메모 비움', { memo: '' }],
    ['금액 형식 오류', { amount: '1,26,0000' }],
  ])('🔴 %s 가 다르면 false', (_n, over) => {
    expect(sameEntryContent(stored, { ...same, ...over }, null)).toBe(false);
  });
  test('🔴 정정 대상(supersedes)이 다르면 false — 같은 키로 다른 기록을 정정 (Reviewer MX10)', () => {
    const cor = { ...stored, supersedesId: 4 };
    expect(sameEntryContent(cor, same, 4)).toBe(true);
    expect(sameEntryContent(cor, same, 5)).toBe(false);
    expect(sameEntryContent(cor, same, null)).toBe(false);
    expect(sameEntryContent(stored, same, 4)).toBe(false);
  });
});

describe('Reviewer 생존 변이 보강', () => {
  test('MU02 — 환율은 소수 4자리로 **반올림**(내림 아님): 1,250.11 처럼 부동소수 곱이 …9.999 가 되는 환율', () => {
    expect(1250.11 * 10_000).toBeLessThan(12_501_100);          // 부동소수 사실(시험 값 선택 근거)
    expect(toFx4(1250.11)).toBe(12_501_100);
    expect(roundFx(1250.11)).toBe(1250.11);
    expect(usdToKrw(1_000_000, 1250.11)).toBe(1_250_110_000);
  });
  test('MU08 — 반영 대기 금액은 부호가 있다(출금 = 음수, 입금 = 양수)', () => {
    const base: BaselineView = {
      version: 1, updatedAt: '2026-09-01 08:00:00', at: '2026-09-01 07:10:00', snapshotId: 100, totalKrw: 20_000_000, krwCash: 1_200_000,
      usdCash: null, fx: null, confirmed: { krwCash: 1_200_000, usdCash: null, at: null, note: null }, baselineTotalKrw: 20_000_000, unconfirmed: false, history: [],
    };
    const e = (id: number, kind: 'deposit' | 'withdrawal', amount: number, occurredAt = '2026-09-15 09:50'): LedgerEntryView => ({
      id, clientEntryId: `c-${id}-xxxxxx`, kind, occurredAt, currency: 'KRW', amount, counterCurrency: null, counterAmount: null, memo: null,
      source: 'user', createdAt: '2026-09-15 09:52:00', createdByUserId: 1,
      anchor: { status: 'pending', snapshotId: null, snapshotTs: null, detail: null, suggest: null },
      fxRateUsed: null, fxSource: null, krwEquiv: null, supersedes: null, supersededBy: null, void: null, beforeBaseline: false,
    });
    const snap = { ts: '2026-09-15 09:40:00', totalKrw: 20_000_000, fx: null };
    expect(computeSummary({ baseline: base, snapshot: snap, entries: [e(1, 'withdrawal', 300_000)] })!.pending).toEqual({ count: 1, krw: -300_000 });
    expect(computeSummary({ baseline: base, snapshot: snap, entries: [e(1, 'withdrawal', 300_000), e(2, 'deposit', 100_000)] })!.pending).toEqual({ count: 2, krw: -200_000 });
    // MU06 — 마지막 기록: 같은 발생 시각이면 id 가 큰 쪽(나중 기록)
    const tie = computeSummary({ baseline: base, snapshot: snap, entries: [e(5, 'deposit', 1, '2026-09-10 10:00'), e(4, 'deposit', 2, '2026-09-10 10:00')] })!;
    expect(tie.last?.id).toBe(5);
    const tie2 = computeSummary({ baseline: base, snapshot: snap, entries: [e(4, 'deposit', 2, '2026-09-10 10:00'), e(5, 'deposit', 1, '2026-09-10 10:00')] })!;
    expect(tie2.last?.id).toBe(5);
  });
  test('MS06 — 스냅샷 USD 행 환율이 0·음수면 환율 없음(null)으로 본다', () => {
    expect(parseSnapshotRow(snapRow(1, '2026-09-03 10:40', { krw: 1, usd: 100, fx: 0 }))!.usd).toEqual({ cents: 10_000, fx: null });
    expect(parseSnapshotRow(snapRow(1, '2026-09-03 10:40', { krw: 1, usd: 100, fx: -5 }))!.usd).toEqual({ cents: 10_000, fx: null });
    expect(parseSnapshotRow(snapRow(1, '2026-09-03 10:40', { krw: 1, usd: 100, fx: 1250 }))!.usd).toEqual({ cents: 10_000, fx: 1250 });
  });
  test('MM10 — 기록 시각과 **같은 시각**의 스냅샷도 "기록 뒤 첫 스냅샷"이다(반영 대기가 아니라 맞춰 본다)', () => {
    const e = me({ kind: 'deposit', currency: 'KRW', amount: 5_000_000, at: '2026-09-15 09:40' });   // 최신 스냅샷과 같은 분
    expect(run([e]).results.get(e.id)!.status).toBe('unmatched');
  });
  test('MM13 — 환전도 같은 시각 스냅샷에서 앵커를 잡는다', () => {
    const x = me({ kind: 'exchange', currency: 'KRW', amount: 1_260_000, counterCurrency: 'USD', counterAmount: 1000, at: '2026-09-05 13:40' });
    expect(run([x]).results.get(x.id)).toMatchObject({ status: 'matched', snapshotId: 104 });
  });
  test('MM08 — 기록 시각이 스캔 시작과 **같으면** 이번 스캔에서 맞춘다(시작 전만 저장 상태 유지)', () => {
    const e = me({ kind: 'deposit', currency: 'KRW', amount: 1_000_000, at: '2026-09-03 10:00' });
    const out = run([e], demoRows(), '2026-09-03 10:00');
    expect(out.results.get(e.id)).toMatchObject({ status: 'matched', snapshotId: 102 });
    const before = run([me({ kind: 'deposit', currency: 'KRW', amount: 1_000_000, at: '2026-09-03 10:00' })], demoRows(), '2026-09-03 10:01');
    expect(before.results.size).toBe(0);
  });
  test('MX06 — 기준 시각과 같은 분의 기록은 "기준 이전 · 계산 제외"', () => {
    const se: StoredEntry = {
      id: 1, clientEntryId: 'cid-x6-0001', kind: 'deposit', occurredAtMs: at('2026-09-01 07:10'), currency: 'KRW', amount: 1, counterCurrency: null, counterAmount: null,
      fxRateUsed: null, fxSource: null, krwEquiv: null, anchorSnapshotId: null, anchorSnapshotTsMs: null, anchorStatus: 'pending', anchorDetail: null, memo: null,
      source: 'user', supersedesId: null, createdAtMs: 0, createdByUserId: 1, deletedAtMs: null, deletedByUserId: null, deleteReason: null,
    };
    expect(toEntryView(se, undefined, new Map(), at('2026-09-01 07:10')).beforeBaseline).toBe(true);
    expect(toEntryView({ ...se, occurredAtMs: at('2026-09-01 07:11') }, undefined, new Map(), at('2026-09-01 07:10')).beforeBaseline).toBe(false);
  });
  test('MX05 — 경로 id 는 1 이상 정수만(0·선행 0 거부)', () => {
    expect([parseId('7'), parseId('0'), parseId('007'), parseId('-1'), parseId('1.5'), parseId('')]).toEqual([7, null, null, null, null, null]);
  });
});
