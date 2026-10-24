/**
 * T-074 WP-B — 기록 폼 초안 모델: 검증(서버와 같은 함수)·기준 이전 차단·요청 본문(clientEntryId 유지)·반영 예측·손익 전→후 미리보기.
 * 데모 수치: 손익 +830,000원 → 후보(원화 +700,000원) 기록 뒤 +130,000원. 합성값만.
 */
import {
  correctDraft, makeClientEntryId, newDraft, occurredAtOf, predictFor, previewEntry, switchDir, toRequest, validateDraft, whyText,
  type EntryDraft,
} from '@/components/ledger/entry-draft';
import { parseKstWall } from '@/lib/ledger/kst';
import { isClientEntryId } from '@/lib/ledger/validate';
import { CAND, feedOf, seed } from './fixtures';

const NOW = parseKstWall('2026-09-15 09:55')!;
const feed = feedOf();
const draft = (over: Partial<EntryDraft> = {}) => newDraft('new', NOW, over, 'cid-test-0001');

describe('새 초안 (데모 newDraft)', () => {
  test('기본값 = 지금(KST) · 입금 · 원화 · 빈 금액 · 저장 키 1회 생성', () => {
    const d = newDraft('new', NOW);
    expect(d).toMatchObject({ mode: 'new', kind: 'deposit', date: '2026-09-15', time: '09:55', ccy: 'KRW', amt: '', dir: 'ku', memo: '' });
    expect(isClientEntryId(d.cid)).toBe(true);
    expect(newDraft('new', NOW).cid).not.toBe(d.cid);
  });
  test('makeClientEntryId — crypto 없을 때도 형식 맞음(32자 16진)', () => {
    const save = (globalThis as { crypto?: unknown }).crypto;
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      const id = makeClientEntryId(() => 0.5);
      expect(id).toMatch(/^[0-9a-f]{32}$/);
      expect(isClientEntryId(id)).toBe(true);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: save, configurable: true });
    }
  });
});

describe('검증 — 서버와 같은 validateEntryInput', () => {
  test('🔴 기준 시각 이전 날짜는 차단(blocked) — 고칠 곳 1, 이유 문장', () => {
    const v = validateDraft(draft({ date: '2026-08-30', time: '15:00', amt: '2000000' }), { nowWallMs: NOW, feed });
    expect(v.blocked).toBe(true);
    expect(v.count).toBe(1);
    expect(v.value).toBeNull();
    expect(whyText(v, 'deposit')).toBe('기준 시각 이전 날짜는 기록할 수 없습니다.');
  });
  test('기준 시각과 같은 분도 차단(경계 = 기준 시각 이하)', () => {
    expect(validateDraft(draft({ date: '2026-09-01', time: '07:10', amt: '1' }), { nowWallMs: NOW, feed }).blocked).toBe(true);
    expect(validateDraft(draft({ date: '2026-09-01', time: '07:11', amt: '1' }), { nowWallMs: NOW, feed }).blocked).toBe(false);
  });
  test('미래 시각 · 부호 · 빈 금액 → 고칠 곳 목록(데모 문구)', () => {
    const v = validateDraft(draft({ date: '2026-09-15', time: '10:30', amt: '' }), { nowWallMs: NOW, feed });
    expect(v.errors.occurredAt?.message).toBe('아직 오지 않은 시각입니다. 지금(09-15 09:55) 이전으로 넣어 주세요.');
    expect(whyText(v, 'deposit')).toBe('채우거나 고칠 곳 2곳 — 날짜·시각 · 금액');
    expect(validateDraft(draft({ amt: '-100' }), { nowWallMs: NOW, feed }).errors.amount?.message)
      .toBe('부호는 넣지 않습니다. 나간 돈이면 위에서 종류를 ‘출금’으로 고르세요.');
  });
  test('큰 금액(현재 총자산 50% 이상) 경고 — 자릿수 실수(200만 → 2천만 출금)', () => {
    const v = validateDraft(draft({ kind: 'withdrawal', amt: '20000000' }), { nowWallMs: NOW, feed });
    expect(v.count).toBe(0);
    expect(v.warnings.map((w) => w.code)).toContain('big_amount');
  });
  test('환전: 낸/받은 칸 이름 · 적용 환율·비용(추정) 유도', () => {
    const v = validateDraft(draft({ kind: 'exchange', dir: 'ku', from: '1300000', to: '1032.50', time: '09:25' }), { nowWallMs: NOW, feed });
    expect(v.count).toBe(0);
    expect(v.derived.rate).toBeCloseTo(1259.08, 2);
    expect(v.derived.costKrw).toBe(1_300_000 - 1_290_625);
    const e = validateDraft(draft({ kind: 'exchange', from: '', to: 'x' }), { nowWallMs: NOW, feed });
    expect(whyText(e, 'exchange')).toBe('채우거나 고칠 곳 2곳 — 낸 금액 · 받은 금액');
  });
});

describe('요청 본문 (POST entries · correct)', () => {
  test('🔴 clientEntryId 는 폼을 열 때 만든 값 그대로 — 다시 시도(같은 초안)에도 같다', () => {
    const d = draft({ amt: '700,000' });
    const a = toRequest(d, 3);
    const b = toRequest(d, 4);   // 409 뒤 새 기준 버전으로 다시
    expect(a.clientEntryId).toBe('cid-test-0001');
    expect(b.clientEntryId).toBe(a.clientEntryId);
    expect(b.baseVersion).toBe(4);
    expect(a).toMatchObject({ kind: 'deposit', occurredAt: '2026-09-15 09:55', currency: 'KRW', amount: '700,000', counterCurrency: null, counterAmount: null, memo: null, fromCandidateKey: null });
  });
  test('환전 방향 ku/uk → currency(낸)·counterCurrency(받은) · 메모 trim · 후보 키는 후보에서 연 폼만', () => {
    const ku = toRequest(draft({ kind: 'exchange', dir: 'ku', from: '1300000', to: '1032.5', memo: '  환전  ' }), 3);
    expect(ku).toMatchObject({ currency: 'KRW', amount: '1300000', counterCurrency: 'USD', counterAmount: '1032.5', memo: '환전' });
    const uk = toRequest(draft({ kind: 'exchange', dir: 'uk', from: '100', to: '125000' }), 3);
    expect(uk).toMatchObject({ currency: 'USD', amount: '100', counterCurrency: 'KRW', counterAmount: '125000' });
    expect(toRequest(newDraft('cand', NOW, { candKey: '1340-KRW' }), 3).fromCandidateKey).toBe('1340-KRW');
    expect(toRequest(draft({ candKey: '1340-KRW' }), 3).fromCandidateKey).toBeNull();
    expect((toRequest(newDraft('correct', NOW, { target: 5 }), 3) as { reason?: string }).reason).toBe('정정');
  });
  test('방향을 바꾸면 두 금액 칸을 서로 바꾼다(데모)', () => {
    const d = switchDir(draft({ kind: 'exchange', dir: 'ku', from: '1300000', to: '1032.5' }), 'uk');
    expect([d.dir, d.from, d.to]).toEqual(['uk', '1032.5', '1300000']);
    expect(occurredAtOf({ date: '', time: '09:00' })).toBe('');
  });
});

describe('반영 예측·손익 전→후 (데모 predict · entryConfirm)', () => {
  test('🔴 후보와 맞으면 바로 반영 — 손익 +830,000원 → +130,000원 · 순입금 950,000 → 1,650,000', () => {
    const d = newDraft('cand', NOW, { amt: '700000', date: '2026-09-14', time: '22:20', candKey: CAND.key });
    const v = validateDraft(d, { nowWallMs: NOW, feed });
    const pv = previewEntry(d, v, feed, NOW);
    expect(pv.predicted).toEqual({ status: 'matched', anchorTs: '2026-09-14 22:20:00' });
    expect(pv.before!.P).toBe(830_000);
    expect(pv.after!.P).toBe(130_000);
    expect([pv.before!.net, pv.after!.net]).toEqual([950_000, 1_650_000]);
  });
  test('최신 스냅샷 뒤 → 반영 대기(손익 거의 그대로), 앞인데 후보와 안 맞으면 불일치 예측', () => {
    const late = draft({ amt: '100000', time: '09:50' });
    expect(predictFor(validateDraft(late, { nowWallMs: NOW, feed }), feed).status).toBe('pending');
    const early = draft({ amt: '123456', date: '2026-09-10', time: '09:00' });
    expect(predictFor(validateDraft(early, { nowWallMs: NOW, feed }), feed).status).toBe('unmatched');
    const pv = previewEntry(late, validateDraft(late, { nowWallMs: NOW, feed }), feed, NOW);
    expect(pv.after!.P).toBe(pv.before!.P);
  });
  test('정정 미리보기: 원래 기록(#5 출금 300,000)을 빼고 새 기록(출금 30,000)을 넣는다', () => {
    const d = correctDraft(seed().find((e) => e.id === 5)!, NOW, false);
    expect(d).toMatchObject({ mode: 'correct', target: 5, kind: 'withdrawal', ccy: 'KRW', amt: '300000', date: '2026-09-10', time: '14:00', memo: '카드값' });
    const d2 = { ...d, amt: '30000' };
    const pv = previewEntry(d2, validateDraft(d2, { nowWallMs: NOW, feed }), feed, NOW);
    expect(pv.before!.P).toBe(830_000);
    expect(pv.after!.P).toBe(830_000 - 270_000);
  });
  test('환전으로 정정(제안 값) — 원화 감소·달러 증가 → 원화→달러, 낸 = |원화 변화|·받은 = |달러 변화|', () => {
    const e = { ...seed().find((x) => x.id === 6)!, anchor: { status: 'unmatched' as const, snapshotId: null, snapshotTs: null, detail: 'x', suggest: { kind: 'exchange' as const, snapshotId: 1, snapshotTs: '2026-09-12 22:00:00', krwDelta: -250_600, usdDelta: 200 } } };
    expect(correctDraft(e, NOW, true)).toMatchObject({ mode: 'correct', target: 6, kind: 'exchange', dir: 'ku', from: '250600', to: '200' });
    const ex = correctDraft(seed().find((x) => x.id === 3)!, NOW, false);
    expect(ex).toMatchObject({ kind: 'exchange', dir: 'ku', from: '1260000', to: '1000' });
  });
});
