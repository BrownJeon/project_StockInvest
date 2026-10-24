/**
 * T-074 snapshots.ts·match.ts·candidates.ts — 합성 스냅샷 계열로 지연 매칭·허용치·창·소비·환전·USD 왕복(X)·후보 탐지를 고정한다.
 * 데모 시나리오(기준 2026-09-01 07:10, 환율 1,250)를 스냅샷 행으로 옮긴 합성값이다(실제 계좌 값 아님).
 */
import { buildSteps, detectUsdFlips, isExchangeLike, parseSeries, parseSnapshotRow, sameHoldings } from '../snapshots';
import { consumeKey, matchEntries, type MatchEntry } from '../match';
import { candidateKey, detectCandidates } from '../candidates';
import { parseKstWall, DAY_MS } from '../kst';
import { HOLD, snapRow, type SnapSpec } from './helpers/fixtures';

const at = (s: string) => parseKstWall(s)!;
const H = HOLD;

/** 데모 흐름을 스냅샷으로 옮긴 합성 계열 */
function demoRows() {
  const r = (id: number, ts: string, s: SnapSpec) => snapRow(id, ts, { holdings: H, ...s });
  return [
    r(100, '2026-09-01 07:10', { krw: 1_200_000, usd: 1500, fx: 1240 }),          // 기준
    r(101, '2026-09-03 09:40', { krw: 1_200_000, usd: 1500, fx: 1250 }),
    r(102, '2026-09-03 10:40', { krw: 2_200_000, usd: 1500, fx: 1250 }),          // 원화 입금 +1,000,000
    r(103, '2026-09-05 12:40', { krw: 2_200_000, usd: 1500, fx: 1256.2 }),
    r(104, '2026-09-05 13:40', { krw: 940_000, usd: 2500, fx: 1256.2 }),          // 환전 −1,260,000 / +$1,000
    r(105, '2026-09-10 14:40', { krw: 640_000, usd: 2500, fx: 1250 }),            // 원화 출금 −300,000
    r(106, '2026-09-12 21:00', { krw: 640_000, usd: 2500, fx: 1250 }),
    r(107, '2026-09-12 22:00', { krw: 640_000, usd: 2700, fx: 1250 }),            // 달러 입금 +$200
    r(108, '2026-09-14 21:10', { krw: 640_000, usd: 2700, fx: 1250 }),
    r(109, '2026-09-14 22:20', { krw: 1_340_000, usd: 2700, fx: 1250 }),          // 기록 안 된 원화 +700,000 (후보)
    r(110, '2026-09-15 09:40', { krw: 1_340_000, usd: 2700, fx: 1250 }),          // 최신
  ];
}

let nextId = 1;
function me(p: Partial<MatchEntry> & Pick<MatchEntry, 'kind' | 'currency' | 'amount'> & { at: string }): MatchEntry {
  const { at: when, ...rest } = p;
  return {
    id: nextId++, occurredAtMs: at(when), counterCurrency: null, counterAmount: null, anchorStatus: 'pending', anchorSnapshotId: null, voided: false,
    ...rest,
  };
}
beforeEach(() => { nextId = 1; });

function run(entries: MatchEntry[], rows = demoRows(), opts: { rematchAll?: boolean; scanFromMs?: number } = {}) {
  const series = parseSeries(rows);
  const steps = buildSteps(series);
  return { series, steps, ...matchEntries(entries, series, steps, { scanFromMs: opts.scanFromMs ?? at('2026-09-01 07:10'), rematchAll: opts.rematchAll }) };
}

describe('스냅샷 해석', () => {
  test('KRW free·locked, USD 센트·환율, 보유 수량 — 문자열 positions·문자열 ts', () => {
    const s = parseSnapshotRow(snapRow(7, '2026-09-03 10:40:05', { krw: 1_000, locked: 20, usd: 118.6, fx: 1324.63, holdings: { AAA001: [3, 100] } }))!;
    expect(s).toMatchObject({ id: 7, ts: '2026-09-03 10:40:05', krw: { free: 1000, locked: 20 }, usd: { cents: 11_860, fx: 1324.63 }, holdings: { AAA001: 3 } });
    expect(s.totalKrw).toBe(Math.round(1000 + 118.6 * 1324.63 + 300));
  });
  test('Date ts(mysql2 timezone +09:00 이 만든 순간) → +9h 벽시계', () => {
    const s = parseSnapshotRow({ id: 1, ts: new Date('2026-09-03T01:40:05.000Z'), total_krw: '5', positions: [] })!;
    expect(s.ts).toBe('2026-09-03 10:40:05');
  });
  test('id·ts·총액이 없으면 해석하지 않는다 · 깨진 positions JSON 은 빈 보유', () => {
    expect(parseSnapshotRow({ id: null, ts: '2026-09-03 10:40:00', total_krw: 1, positions: '[]' })).toBeNull();
    expect(parseSnapshotRow({ id: 1, ts: 'x', total_krw: 1, positions: '[]' })).toBeNull();
    expect(parseSnapshotRow({ id: 1, ts: '2026-09-03 10:40:00', total_krw: 1, positions: '{bad' })!.holdings).toEqual({});
  });
  test('단계: 원화 변화 = free+locked, 달러 = 센트, 보유 같음', () => {
    const steps = buildSteps(parseSeries([
      snapRow(1, '2026-09-03 09:40', { krw: 1000, locked: 500, usd: 10, holdings: H }),
      snapRow(2, '2026-09-03 10:40', { krw: 1200, locked: 400, usd: 10.5, holdings: H }),
      snapRow(3, '2026-09-03 11:40', { krw: 1200, holdings: { ...H, AAA001: [101, 60_000] } }),
    ]));
    expect(steps[0]).toMatchObject({ dKrw: 100, dUsdCents: 50, holdingsSame: true });
    expect(steps[1]).toMatchObject({ dKrw: -400, dUsdCents: null, holdingsSame: false });
    expect(sameHoldings(steps[0].prev, steps[0].cur)).toBe(true);
  });
  test('환전처럼 보임: 반대 방향 + 내재 환율 ±3%', () => {
    expect(isExchangeLike(-1_260_000, 100_000, 1256.2)).toBe(true);
    expect(isExchangeLike(-1_260_000, 100_000, 1200)).toBe(false);    // 1,260 vs 1,200 = 5%
    expect(isExchangeLike(1_260_000, 100_000, 1256.2)).toBe(false);   // 같은 방향
    expect(isExchangeLike(-1_260_000, null, 1256.2)).toBe(false);
    expect(isExchangeLike(-500, 100_000, 1256.2)).toBe(false);        // 원화 변화가 허용치 미만
  });
});

describe('지연 매칭 — 데모 흐름', () => {
  test('원화 입금 → 반영됨(앵커 #102, 원화 환산 = 금액, 근거 문장)', () => {
    const e = me({ kind: 'deposit', currency: 'KRW', amount: 1_000_000, at: '2026-09-03 10:00' });
    const r = run([e]).results.get(e.id)!;
    expect(r).toEqual({
      status: 'matched', snapshotId: 102, snapshotTs: '2026-09-03 10:40:00', detail: '원화 현금 +1,000,000원 확인 (허용 ±1,000원)',
      fxRateUsed: null, fxSource: null, krwEquiv: 1_000_000, suggest: null,
    });
  });
  test('원화 출금 → 반영됨(#105, −300,000)', () => {
    const e = me({ kind: 'withdrawal', currency: 'KRW', amount: 300_000, at: '2026-09-10 14:00' });
    expect(run([e]).results.get(e.id)).toMatchObject({ status: 'matched', snapshotId: 105, detail: '원화 현금 −300,000원 확인 (허용 ±1,000원)', krwEquiv: 300_000 });
  });
  test('달러 입금 → 반영 스냅샷 환율로 원화 환산($200 × 1,250 = 250,000)', () => {
    const e = me({ kind: 'deposit', currency: 'USD', amount: 200, at: '2026-09-12 21:30' });
    expect(run([e]).results.get(e.id)).toMatchObject({
      status: 'matched', snapshotId: 107, fxRateUsed: 1250, fxSource: 'snapshot', krwEquiv: 250_000, detail: '달러 현금 +$200.00 확인 (허용 ±$1)',
    });
  });
  test('달러 입금 환산은 **그 반영 스냅샷의** 환율 — $118.60 × 1,324.63 = 157,101원(1,250 이 아니라)', () => {
    const rows = [
      snapRow(1, '2026-10-05 06:00', { krw: 1_000_000, usd: 1000, fx: 1300, holdings: H }),
      snapRow(2, '2026-10-05 07:10', { krw: 1_000_000, usd: 1118.6, fx: 1324.63, holdings: H }),
    ];
    const e = me({ kind: 'deposit', currency: 'USD', amount: 118.6, at: '2026-10-05 06:30' });
    expect(run([e], rows, { scanFromMs: at('2026-10-05 00:00') }).results.get(e.id)).toMatchObject({ status: 'matched', fxRateUsed: 1324.63, krwEquiv: 157_101 });
  });
  test('환전(같은 단계 양쪽) → 반영됨, 앵커 환율 1,256.2, 원화 환산 없음', () => {
    const e = me({ kind: 'exchange', currency: 'KRW', amount: 1_260_000, counterCurrency: 'USD', counterAmount: 1000, at: '2026-09-05 13:00' });
    const out = run([e]);
    expect(out.results.get(e.id)).toEqual({
      status: 'matched', snapshotId: 104, snapshotTs: '2026-09-05 13:40:00', detail: '같은 스냅샷에서 원화 −1,260,000원 · 달러 +$1,000.00 확인',
      fxRateUsed: 1256.2, fxSource: 'snapshot', krwEquiv: null, suggest: null,
    });
    expect(out.consumed.has(consumeKey(104, 'KRW')) && out.consumed.has(consumeKey(104, 'USD'))).toBe(true);
  });
  test('환전이 연속 두 단계에 나뉘면 뒤 단계가 앵커', () => {
    const rows = [
      snapRow(1, '2026-09-05 12:40', { krw: 2_200_000, usd: 1500, fx: 1250, holdings: H }),
      snapRow(2, '2026-09-05 13:40', { krw: 950_000, usd: 1500, fx: 1250, holdings: H }),    // 원화만 먼저 빠짐
      snapRow(3, '2026-09-05 14:40', { krw: 950_000, usd: 2500, fx: 1251, holdings: H }),    // 달러는 다음 틱
    ];
    const e = me({ kind: 'exchange', currency: 'KRW', amount: 1_250_000, counterCurrency: 'USD', counterAmount: 1000, at: '2026-09-05 13:00' });
    expect(run([e], rows, { scanFromMs: at('2026-09-05 00:00') }).results.get(e.id)).toMatchObject({
      status: 'matched', snapshotId: 3, fxRateUsed: 1251, detail: '연속 두 스냅샷(09-05 13:40·09-05 14:40)에서 원화 −1,250,000원 · 달러 +$1,000.00 확인',
    });
  });
  test('최신 스냅샷보다 뒤에 적은 기록 → 반영 대기(pending)', () => {
    const e = me({ kind: 'deposit', currency: 'KRW', amount: 500_000, at: '2026-09-15 09:50' });
    expect(run([e]).results.get(e.id)).toMatchObject({ status: 'pending', snapshotId: null, detail: null, krwEquiv: null });
  });
  test('맞는 변화가 없으면 불일치(기록대로 계산에 포함) — 금액 자릿수 실수', () => {
    const e = me({ kind: 'withdrawal', currency: 'KRW', amount: 3_000_000, at: '2026-09-10 14:00' });
    expect(run([e]).results.get(e.id)).toMatchObject({ status: 'unmatched', detail: '이 시각 뒤 스냅샷에서 맞는 현금 변화를 찾지 못했습니다.', krwEquiv: 3_000_000 });
  });
  test('방향이 반대면 맞추지 않는다(입금을 출금으로)', () => {
    const e = me({ kind: 'withdrawal', currency: 'KRW', amount: 1_000_000, at: '2026-09-03 10:00' });
    expect(run([e]).results.get(e.id)!.status).toBe('unmatched');
  });
  test('시각을 실제보다 늦게 적으면(반영 스냅샷 뒤) 찾지 못한다', () => {
    const e = me({ kind: 'deposit', currency: 'KRW', amount: 1_000_000, at: '2026-09-03 10:41' });
    expect(run([e]).results.get(e.id)!.status).toBe('unmatched');
  });
  test('불일치 달러 기록은 기록 시각 뒤 첫 스냅샷 환율로 환산을 고정', () => {
    const e = me({ kind: 'deposit', currency: 'USD', amount: 999, at: '2026-09-05 12:00' });
    expect(run([e]).results.get(e.id)).toMatchObject({ status: 'unmatched', fxRateUsed: 1256.2, fxSource: 'snapshot', krwEquiv: 1_254_944 });
  });
});

describe('🔴 환전을 입금으로 적으면 맞추지 않고 환전 정정 제안 (Analyst Q3 #2)', () => {
  test('같은 단계에서 원화가 비슷한 가치만큼 줄었으면 unmatched + suggest', () => {
    const rows = [
      snapRow(1, '2026-09-12 21:00', { krw: 900_000, usd: 2500, fx: 1250, holdings: H }),
      snapRow(2, '2026-09-12 22:00', { krw: 649_400, usd: 2700, fx: 1250, holdings: H }),    // 원화 −250,600 · 달러 +$200
    ];
    const e = me({ kind: 'deposit', currency: 'USD', amount: 200, at: '2026-09-12 21:30' });
    const r = run([e], rows, { scanFromMs: at('2026-09-12 00:00') }).results.get(e.id)!;
    expect(r.status).toBe('unmatched');
    expect(r.suggest).toEqual({ kind: 'exchange', snapshotId: 2, snapshotTs: '2026-09-12 22:00:00', krwDelta: -250_600, usdDelta: 200 });
    expect(r.detail).toBe('이 시각 뒤 스냅샷에서 입금으로 볼 달러 +$200.00 변화를 찾지 못했습니다. 같은 스냅샷(09-12 22:00)에서 원화가 250,600원 줄었습니다 — 환전이었다면 환전으로 정정하세요.');
  });
});

describe('허용치·창 경계 (rules: max(1,000원|$1, 금액×0.1%), 36시간)', () => {
  const rowsFor = (dK: number, dU = 0, tsCur = '2026-09-03 10:40') => [
    snapRow(1, '2026-09-03 09:40', { krw: 1_000_000, usd: 100, fx: 1250, holdings: H }),
    snapRow(2, tsCur, { krw: 1_000_000 + dK, usd: 100 + dU, fx: 1250, holdings: H }),
  ];
  const opt = { scanFromMs: at('2026-09-03 00:00') };
  test.each([
    [501_000, true], [499_000, true], [501_001, false], [498_999, false],
  ])('원화 50만 입금 vs 변화 %p → 맞음 %p (허용 ±1,000원)', (dK, ok) => {
    const e = me({ kind: 'deposit', currency: 'KRW', amount: 500_000, at: '2026-09-03 10:00' });
    expect(run([e], rowsFor(dK), opt).results.get(e.id)!.status).toBe(ok ? 'matched' : 'unmatched');
  });
  test.each([
    [5_005_000, true], [5_005_001, false],
  ])('원화 500만 입금 vs 변화 %p → 맞음 %p (허용 0.1% = 5,000원)', (dK, ok) => {
    const e = me({ kind: 'deposit', currency: 'KRW', amount: 5_000_000, at: '2026-09-03 10:00' });
    expect(run([e], rowsFor(dK), opt).results.get(e.id)!.status).toBe(ok ? 'matched' : 'unmatched');
  });
  test.each([
    [101, true], [99, true], [101.01, false], [98.99, false],
  ])('달러 $100 입금 vs 변화 $%p → 맞음 %p (허용 ±$1)', (dU, ok) => {
    const e = me({ kind: 'deposit', currency: 'USD', amount: 100, at: '2026-09-03 10:00' });
    expect(run([e], rowsFor(0, dU), opt).results.get(e.id)!.status).toBe(ok ? 'matched' : 'unmatched');
  });
  test('달러 부동소수: $0.10+$0.20 변화를 $0.30 입금과 정확히 비교(센트)', () => {
    const rows = [snapRow(1, '2026-09-03 09:40', { usd: 0.1, krw: 0, holdings: H }), snapRow(2, '2026-09-03 10:40', { usd: 0.1 + 0.3, krw: 0, holdings: H })];
    const e = me({ kind: 'deposit', currency: 'USD', amount: 0.3, at: '2026-09-03 10:00' });
    expect(run([e], rows, opt).results.get(e.id)!.status).toBe('matched');
  });
  test('창: 기록 시각 + 36시간 정각 스냅샷은 맞고, 1분 넘으면 불일치', () => {
    const e1 = me({ kind: 'deposit', currency: 'KRW', amount: 500_000, at: '2026-09-03 10:00' });
    expect(run([e1], rowsFor(500_000, 0, '2026-09-04 22:00'), opt).results.get(e1.id)!.status).toBe('matched');
    const e2 = me({ kind: 'deposit', currency: 'KRW', amount: 500_000, at: '2026-09-03 10:00' });
    expect(run([e2], rowsFor(500_000, 0, '2026-09-04 22:01'), opt).results.get(e2.id)!.status).toBe('unmatched');
  });
});

describe('🔴 한 변화는 한 기록만 잡는다(이중 기록 → 불일치)', () => {
  test('같은 입금을 두 번 적으면 먼저 시각의 기록만 반영됨', () => {
    const a = me({ kind: 'deposit', currency: 'KRW', amount: 1_000_000, at: '2026-09-03 10:00' });
    const b = me({ kind: 'deposit', currency: 'KRW', amount: 1_000_000, at: '2026-09-03 10:05' });
    const out = run([b, a]);
    expect(out.results.get(a.id)!.status).toBe('matched');
    expect(out.results.get(b.id)!.status).toBe('unmatched');
  });
  test('이미 반영된 기록이 먼저 자기 변화를 차지한다(새 기록이 더 이른 시각이어도)', () => {
    const old = me({ kind: 'deposit', currency: 'KRW', amount: 1_000_000, at: '2026-09-03 10:05', anchorStatus: 'matched', anchorSnapshotId: 102 });
    const neu = me({ kind: 'deposit', currency: 'KRW', amount: 1_000_000, at: '2026-09-03 10:00' });
    const out = run([old, neu]);
    expect(out.results.has(old.id)).toBe(false);          // 반영됨은 다시 맞추지 않는다
    expect(out.results.get(neu.id)!.status).toBe('unmatched');
  });
  test('두 반영됨 기록이 같은 변화를 잡고 있으면(동시 저장 경합) 늦은 쪽을 다시 맞춘다', () => {
    const a = me({ kind: 'deposit', currency: 'KRW', amount: 1_000_000, at: '2026-09-03 10:00', anchorStatus: 'matched', anchorSnapshotId: 102 });
    const b = me({ kind: 'deposit', currency: 'KRW', amount: 1_000_000, at: '2026-09-03 10:05', anchorStatus: 'matched', anchorSnapshotId: 102 });
    const out = run([a, b]);
    expect(out.results.has(a.id)).toBe(false);
    expect(out.results.get(b.id)!.status).toBe('unmatched');
  });
  test('취소된 기록은 변화를 차지하지 않는다 → 남은 기록이 반영됨', () => {
    const a = me({ kind: 'deposit', currency: 'KRW', amount: 1_000_000, at: '2026-09-03 10:00', anchorStatus: 'matched', anchorSnapshotId: 102, voided: true });
    const b = me({ kind: 'deposit', currency: 'KRW', amount: 1_000_000, at: '2026-09-03 10:05', anchorStatus: 'unmatched' });
    expect(run([a, b]).results.get(b.id)!.status).toBe('matched');
  });
  test('rematchAll 은 반영됨까지 다시 맞춘다 · 스캔 시작 전 기록은 저장 상태 유지', () => {
    const a = me({ kind: 'deposit', currency: 'KRW', amount: 1_000_000, at: '2026-09-03 10:00', anchorStatus: 'matched', anchorSnapshotId: 102 });
    expect(run([a], demoRows(), { rematchAll: true }).results.get(a.id)!.status).toBe('matched');
    const out = run([a], demoRows(), { scanFromMs: at('2026-09-04 00:00'), rematchAll: true });
    expect(out.results.has(a.id)).toBe(false);
    expect(out.consumed.has(consumeKey(102, 'KRW'))).toBe(true);
  });
});

/** USD 예수금 Y ↔ Y+X 왕복(Analyst A 표의 모양을 합성값으로 — X = $250, 하루 +$0.03) */
function flipRows() {
  const r = (id: number, ts: string, usd: number) => snapRow(id, ts, { krw: 1_000_000, usd, fx: 1250, holdings: H });
  return [
    r(1, '2026-09-20 05:30', 2500.00),
    r(2, '2026-09-20 06:40', 2750.00),   // X 복귀 +250.00
    r(3, '2026-09-20 16:30', 2500.00),   // X 빠짐 −250.00
    r(4, '2026-09-21 06:40', 2750.03),   // +250.03
    r(5, '2026-09-21 16:30', 2500.00),   // −250.03
    r(6, '2026-09-22 06:40', 2750.06),   // +250.06
    r(7, '2026-09-22 16:30', 2500.00),   // −250.06
    r(8, '2026-09-22 22:00', 2500.00),   // 최신(밤, X 빠진 상태)
  ];
}

describe('USD 왕복(X) — Y ↔ Y+X 일반화 (T-069 R2 는 0 ↔ X 만 봤다)', () => {
  test('Y=$2,500 위의 X 왕복을 같은 패턴으로 묶는다(하루 +$0.03 흡수) + 지금 빠져 있음 표지', () => {
    const steps = buildSteps(parseSeries(flipRows()));
    const f = detectUsdFlips(steps);
    expect([...f.flipStepIds].sort()).toEqual([2, 3, 4, 5, 6, 7]);
    expect(f.patterns).toHaveLength(1);
    expect(f.gapHint).toEqual({ usd: 250.06, krw: 312_575, sinceTs: '2026-09-22 16:30:00' });
  });
  test('X 가 돌아와 있으면 표지 없음', () => {
    const rows = flipRows().slice(0, 6);
    expect(detectUsdFlips(buildSteps(parseSeries(rows))).gapHint).toBeNull();
  });
  test('T-069 모양(0 ↔ X)도 잡는다', () => {
    const r = (id: number, ts: string, usd: number) => snapRow(id, ts, { krw: 1_000_000, usd, fx: 1250, holdings: H });
    const f = detectUsdFlips(buildSteps(parseSeries([r(1, '2026-09-20 05:30', 0), r(2, '2026-09-20 06:40', 368.51), r(3, '2026-09-20 16:30', 0)])));
    expect([...f.flipStepIds]).toEqual([2, 3]);
  });
  test('같은 크기라도 한 방향으로만 반복되면(+$300 두 번) 왕복이 아니다 — 후보로 남는다', () => {
    const r = (id: number, ts: string, usd: number) => snapRow(id, ts, { krw: 1_000_000, usd, fx: 1250, holdings: H });
    const steps = buildSteps(parseSeries([r(1, '2026-09-20 05:30', 2500), r(2, '2026-09-20 06:40', 2800), r(3, '2026-09-21 06:40', 3100)]));
    const f = detectUsdFlips(steps);
    expect(f.flipStepIds.size).toBe(0);
    expect(detectCandidates(steps, { baselineAtMs: at('2026-09-20 00:00'), consumed: new Set(), flipStepIds: f.flipStepIds, marks: {} }).map((c) => c.key)).toEqual(['3-USD', '2-USD']);
  });
  test('주말을 건너 X 가 사흘 치(+$0.09) 늘어도 같은 왕복으로 묶는다(하루당 흡수 허용치)', () => {
    const r = (id: number, ts: string, usd: number) => snapRow(id, ts, { krw: 1_000_000, usd, fx: 1250, holdings: H });
    const rows = [
      r(1, '2026-09-24 05:30', 2500.00), r(2, '2026-09-24 06:40', 2750.00), r(3, '2026-09-24 16:30', 2500.00),
      r(4, '2026-09-25 06:40', 2750.03), r(5, '2026-09-25 16:30', 2500.00),
      r(6, '2026-09-28 06:40', 2750.12),   // 금 → 월: +250.12 (직전 250.03 대비 +$0.09)
    ];
    const steps = buildSteps(parseSeries(rows));
    const f = detectUsdFlips(steps);
    expect(f.flipStepIds.has(6)).toBe(true);
    expect(detectCandidates(steps, { baselineAtMs: at('2026-09-24 00:00'), consumed: new Set(), flipStepIds: f.flipStepIds, marks: {} })).toEqual([]);
  });
  test('한 방향 한 번뿐인 달러 변화(실제 입금)는 왕복이 아니다', () => {
    const r = (id: number, ts: string, usd: number) => snapRow(id, ts, { krw: 1_000_000, usd, fx: 1250, holdings: H });
    expect(detectUsdFlips(buildSteps(parseSeries([r(1, '2026-09-20 05:30', 2500), r(2, '2026-09-20 06:40', 2800)]))).flipStepIds.size).toBe(0);
  });
  test('원화가 함께 움직인 단계(환전)는 왕복 후보가 아니다', () => {
    const f = detectUsdFlips(buildSteps(parseSeries([
      snapRow(1, '2026-09-20 05:30', { krw: 1_000_000, usd: 2500, holdings: H }),
      snapRow(2, '2026-09-20 06:40', { krw: 687_500, usd: 2750, holdings: H }),
      snapRow(3, '2026-09-20 16:30', { krw: 1_000_000, usd: 2500, holdings: H }),
    ])));
    expect(f.flipStepIds.size).toBe(0);
  });
  test('4일 넘게 지난 패턴은 지금 표지를 내지 않는다', () => {
    const rows = [...flipRows(), snapRow(9, '2026-09-27 22:00', { krw: 1_000_000, usd: 2500, fx: 1250, holdings: H })];
    expect(detectUsdFlips(buildSteps(parseSeries(rows))).gapHint).toBeNull();
  });
});

describe('기록 안 된 입출금 후보 (보유 불변 · ≥5만원 / ≥$50)', () => {
  const opts = (over: Partial<Parameters<typeof detectCandidates>[1]> = {}) => ({
    baselineAtMs: at('2026-09-01 07:10'), consumed: new Set<string>(), flipStepIds: new Set<number>(), marks: {}, ...over,
  });
  test('데모: 09-14 22:20 원화 +700,000원 · 키 109-KRW · 입금 방향 — 앞의 기록된 변화들은 기록이 차지하면 빠진다', () => {
    const series = parseSeries(demoRows());
    const steps = buildSteps(series);
    const entries: MatchEntry[] = [
      me({ kind: 'deposit', currency: 'KRW', amount: 1_000_000, at: '2026-09-03 10:00' }),
      me({ kind: 'exchange', currency: 'KRW', amount: 1_260_000, counterCurrency: 'USD', counterAmount: 1000, at: '2026-09-05 13:00' }),
      me({ kind: 'withdrawal', currency: 'KRW', amount: 300_000, at: '2026-09-10 14:00' }),
      me({ kind: 'deposit', currency: 'USD', amount: 200, at: '2026-09-12 21:30' }),
    ];
    const m = matchEntries(entries, series, steps, { scanFromMs: at('2026-09-01 07:10') });
    const c = detectCandidates(steps, opts({ consumed: m.consumed }));
    expect(c).toEqual([{
      key: '109-KRW', snapshotId: 109, ts: '2026-09-14 22:20:00', prevSnapshotId: 108, prevTs: '2026-09-14 21:10:00',
      currency: 'KRW', delta: 700_000, direction: 'deposit', state: 'open', reason: null, dismissedAt: null, dismissedByUserId: null,
    }]);
    // 기록이 없으면 원화 입금·출금·달러 입금이 다 후보(환전 단계는 빠진다)
    expect(detectCandidates(steps, opts()).map((x) => x.key)).toEqual(['109-KRW', '107-USD', '105-KRW', '102-KRW']);
  });
  test.each([
    [49_999, 0, []], [50_000, 0, ['2-KRW']], [-50_000, 0, ['2-KRW']], [0, 49.99, []], [0, 50, ['2-USD']], [0, -50, ['2-USD']],
  ])('경계: 원화 %p · 달러 %p → %p', (dK, dU, keys) => {
    const steps = buildSteps(parseSeries([
      snapRow(1, '2026-09-03 09:40', { krw: 1_000_000, usd: 100, fx: 1250, holdings: H }),
      snapRow(2, '2026-09-03 10:40', { krw: 1_000_000 + (dK as number), usd: 100 + (dU as number), fx: 1250, holdings: H }),
    ]));
    expect(detectCandidates(steps, opts()).map((x) => x.key)).toEqual(keys);
  });
  test('보유 수량이 바뀐 단계(매매)·기준 이전 단계·소비된 변화·왕복 단계·환전 단계는 후보가 아니다', () => {
    const steps = buildSteps(parseSeries([
      snapRow(1, '2026-08-31 09:40', { krw: 1_000_000, usd: 100, holdings: H }),
      snapRow(2, '2026-09-01 08:00', { krw: 2_000_000, usd: 100, holdings: H }),                                  // prev 가 기준 이전
      snapRow(3, '2026-09-03 10:40', { krw: 1_000_000, usd: 100, holdings: { ...H, AAA001: [116, 60_000] } }),     // 매매
      snapRow(4, '2026-09-03 11:40', { krw: 1_500_000, usd: 100, holdings: { ...H, AAA001: [116, 60_000] } }),     // 소비됨
      snapRow(5, '2026-09-03 12:40', { krw: 1_500_000, usd: 400, holdings: { ...H, AAA001: [116, 60_000] } }),     // 왕복 표시
      snapRow(6, '2026-09-03 13:40', { krw: 1_125_000, usd: 700, fx: 1250, holdings: { ...H, AAA001: [116, 60_000] } }), // 환전
    ]));
    const c = detectCandidates(steps, opts({ consumed: new Set([consumeKey(4, 'KRW')]), flipStepIds: new Set([5]) }));
    expect(c).toEqual([]);
  });
  test('입출금 아님 표시 → dismissed(사유·시각) · 키는 재조회에도 같다', () => {
    const steps = buildSteps(parseSeries(demoRows()));
    const marks = { '109-KRW': { state: 'dismissed' as const, reason: '증권사 표시 차이(일시적)', at: '2026-09-15 09:58:00', byUserId: 1 } };
    const a = detectCandidates(steps, opts({ marks }));
    const b = detectCandidates(buildSteps(parseSeries(demoRows())), opts({ marks }));
    expect(a.find((x) => x.key === '109-KRW')).toMatchObject({ state: 'dismissed', reason: '증권사 표시 차이(일시적)', dismissedAt: '2026-09-15 09:58:00', dismissedByUserId: 1 });
    expect(a.map((x) => x.key)).toEqual(b.map((x) => x.key));
    expect(candidateKey(109, 'KRW')).toBe('109-KRW');
  });
  test('왕복(X) 계열은 매일 두 번 울리지 않는다', () => {
    const steps = buildSteps(parseSeries(flipRows()));
    const f = detectUsdFlips(steps);
    expect(detectCandidates(steps, opts({ baselineAtMs: at('2026-09-20 00:00'), flipStepIds: f.flipStepIds }))).toEqual([]);
    expect(detectCandidates(steps, opts({ baselineAtMs: at('2026-09-20 00:00') }))).toHaveLength(6);
  });
  test('여러 날 계열 길이 — 120일치 단계도 계산된다(성능 확인용, 2,880 행)', () => {
    const rows = Array.from({ length: 2880 }, (_, i) => snapRow(i + 1, new Date(Date.UTC(2026, 5, 1) + i * 3_600_000).toISOString().slice(0, 16).replace('T', ' '), { krw: 1_000_000, usd: 100, holdings: H }));
    const steps = buildSteps(parseSeries(rows));
    expect(steps).toHaveLength(2879);
    expect(detectCandidates(steps, opts({ baselineAtMs: 0 }))).toEqual([]);
    expect(DAY_MS).toBe(86_400_000);
  });
});
