/**
 * T-019 — **손익 장부가 주문 수량을 체결 수량으로 착각하지 않는다.**
 *
 * ## 고정하려는 결함
 *
 * `fetchOrderRows` 는 `COALESCE(e.quantity, o.quantity)` 로 수량을 집는데 `executions` 가
 * 역사상 0행이라 **항상** 주문 수량으로 떨어졌다. 즉 손익 계산기는 "filled 인 주문은 전량
 * 체결됐다"를 무조건 참으로 가정했다. 부분체결이 `filled` 로 기록되던 결함(order-sync)과
 * 맞물리면 매도 수익이 부풀고 **LIFO 재고 스택이 어긋난 채 이후 모든 매도의 원가를 오염**
 * 시킨다 — 1회성 오차가 아니라 누적 오차다.
 *
 * order-sync 가 실제 체결 수량을 `executions` 에 남기게 되면서 `COALESCE` 가 참값을 집게
 * 됐다. 이 파일은 (1) 쿼리가 실제로 그 참값과 **금액까지** 함께 집는지, (2) 그 결과가
 * 재고·손익을 어떻게 바로잡는지를 고정한다.
 */
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { computeLifoPnl, fetchOrderRows, buildTradeReport, type OrderRow } from '../trade-report';

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }));

const T0 = new Date('2026-08-11T00:00:00Z').getTime();
const HOUR = 3600_000;

/** DB 가 돌려줄 결과셋을 고정하고, 실제로 나간 SQL 을 잡아 둔다. */
function setupPool(rows: RowDataPacket[]): { sql: string } {
  const captured = { sql: '' };
  const query = jest.fn(async (sqlArg: unknown) => {
    captured.sql = String(sqlArg);
    return [rows];
  });
  (getPool as jest.Mock).mockReturnValue({ query });
  return captured;
}

// ── ① 쿼리 계약 ──────────────────────────────────────────────────────────────

describe('fetchOrderRows — 체결 기록이 있으면 그것이 진실이다', () => {
  test('수량은 executions 를 우선하고, 금액은 체결 비율만큼 축소한다', async () => {
    const cap = setupPool([]);
    await fetchOrderRows({ rangeStart: new Date(T0), rangeEnd: new Date(T0 + HOUR) });

    // 수량 — 체결 기록 우선
    expect(cap.sql).toMatch(/COALESCE\(e\.quantity,\s*o\.quantity\)/);
    // 🔴 금액 — 체결 기록이 있으면 체결 비율로 축소한다.
    //    수량만 참값으로 바꾸고 금액을 주문 금액 그대로 두면 한 행 안에서 서로 모순된다
    //    (수량 3주 / 금액 10주치) — headerPnl 과 price 폴백이 그 금액을 쓴다.
    expect(cap.sql).toMatch(/e\.quantity\s*\/\s*o\.quantity/);
    expect(cap.sql).toMatch(/WHEN e\.quantity IS NOT NULL AND o\.quantity IS NOT NULL AND o\.quantity > 0/);
    // 통화 중립 — 해외 주문의 USD 단가로 KRW 금액을 재계산하지 않는다
    expect(cap.sql).not.toMatch(/e\.price\s*\*\s*e\.quantity/);
    // 수수료는 여전히 합산 (중복 합산 위험은 order-sync 가 주문당 1행만 쓰는 것으로 막는다)
    expect(cap.sql).toMatch(/SUM\(e\.fee\)/);
    // 체결 시각이 있으면 그것이 LIFO 정렬축이 된다
    expect(cap.sql).toMatch(/COALESCE\(MAX\(e\.executed_at\), o\.updated_at, o\.created_at\)/);
  });

  test('DB 가 돌려준 값을 OrderRow 로 그대로 옮긴다', async () => {
    setupPool([{
      symbol: '005930', side: 'sell', price: '70100.00000000', quantity: '3.000000000000000000',
      amount_krw: '210300.00', fee: '0.00000000', ts: '2026-08-11T06:10:00.000Z',
    } as unknown as RowDataPacket]);

    const rows = await fetchOrderRows({ rangeStart: new Date(T0), rangeEnd: new Date(T0 + HOUR) });
    expect(rows).toEqual([{
      symbol: '005930', side: 'sell', price: 70_100, quantity: 3,
      amount_krw: 210_300, fee: 0, ts: Date.parse('2026-08-11T06:10:00.000Z'),
    }]);
  });
});

// ── ② 장부 정확성 — 부분체결이 재고와 손익에 미치는 영향 ─────────────────────

describe('🔴 부분체결 주문은 실제 체결 수량으로 계산된다', () => {
  const rangeStart = new Date(T0);

  /**
   * 시나리오 (T-019 반례):
   *   10:00  10주 매수 @100
   *   14:00  10주 매도 지정가 접수 → **3주만 체결** @110, 잔량 7주는 장마감 자동취소
   *   다음날 7주 매도 @90
   *
   * 실제 손익 = 3×(110−100) + 7×(90−100) = +30 − 70 = **−40**
   */
  const buy10 = (): OrderRow =>
    ({ symbol: '005930', side: 'buy', price: 100, quantity: 10, amount_krw: 1000, fee: 0, ts: T0 + HOUR });

  test('체결 수량(3주)으로 계산하면 재고가 정확히 남고 이후 매도 원가도 맞는다', () => {
    const rows: OrderRow[] = [
      buy10(),
      // executions 가 참값을 들고 있으므로 수량 3주 · 금액도 3주치
      { symbol: '005930', side: 'sell', price: 110, quantity: 3, amount_krw: 330, fee: 0, ts: T0 + 2 * HOUR },
      { symbol: '005930', side: 'sell', price: 90,  quantity: 7, amount_krw: 630, fee: 0, ts: T0 + 26 * HOUR },
    ];
    const { totalKRW } = computeLifoPnl(rows, rangeStart);
    expect(totalKRW).toBeCloseTo(-40, 6);
  });

  test('🔴 회귀 — 주문 수량(10주)으로 계산하면 손익이 부풀고 재고가 고갈된다', () => {
    const corrupted: OrderRow[] = [
      buy10(),
      // 결함 상태: 부분체결인데 주문 수량 10주 · 주문 금액 1100 으로 기록됨
      { symbol: '005930', side: 'sell', price: 110, quantity: 10, amount_krw: 1100, fee: 0, ts: T0 + 2 * HOUR },
      { symbol: '005930', side: 'sell', price: 90,  quantity: 7,  amount_krw: 630,  fee: 0, ts: T0 + 26 * HOUR },
    ];
    const { totalKRW } = computeLifoPnl(corrupted, rangeStart);
    // 첫 매도가 +100 으로 잡히고, 재고가 비어 두 번째 매도의 **원가가 0** 이 된다 → +630
    expect(totalKRW).toBeCloseTo(100 + 630, 6);
    // 참값(−40)과 770 이나 벌어진다 — 이 격차가 T-019 가 없애려는 손해다
    expect(totalKRW).not.toBeCloseTo(-40, 6);
  });

  /**
   * 🔴 reviewer LOW-1 — **과거(executions 0행)와 신규(executions 기록됨)가 한 결과셋에 섞인다.**
   *
   * 이 변경의 실전 위험 1순위가 정확히 이 혼재다. 운영 DB 는 `executions` 가 0행이므로
   * 배포 직후 리포트는 반드시 "과거 행 다수 + 새 행 소수" 형태가 된다. `CASE` 는 행 단위로
   * 독립 평가되지만, 그 사실을 **한 번에 도는 테스트**로 못 박아 둔다 —
   * 두 종류가 같은 LIFO 스택을 공유하기 때문에 한쪽이 틀어지면 다른 쪽 원가까지 오염된다.
   */
  test('🔴 과거 행(executions 없음)과 신규 행(executions 기록됨)이 섞여도 장부가 맞는다', async () => {
    const captured = setupPool([
      // ── 과거 주문: executions 없음 → DB 가 CASE 의 ELSE 로 o.quantity·o.amount_krw 를 준다
      {
        symbol: '005930', side: 'buy', price: '100.00000000', quantity: '10.000000000000000000',
        amount_krw: '1000.00', fee: '0.00000000', ts: '2026-08-11T01:00:00.000Z',
      },
      // ── 신규 주문: 부분체결 종결 → e.quantity=3, amount_krw 도 3/10 로 축소돼서 온다
      {
        symbol: '005930', side: 'sell', price: '110.00000000', quantity: '3.000000000000000000',
        amount_krw: '330.00', fee: '0.00000000', ts: '2026-08-11T02:00:00.000Z',
      },
      // ── 다시 과거 형태 주문(전량 체결이라 executions 없음)
      {
        symbol: '005930', side: 'sell', price: '90.00000000', quantity: '7.000000000000000000',
        amount_krw: '630.00', fee: '0.00000000', ts: '2026-08-12T02:00:00.000Z',
      },
    ] as unknown as RowDataPacket[]);

    const rows = await fetchOrderRows({
      rangeStart: new Date(T0), rangeEnd: new Date(T0 + 48 * HOUR),
    });
    // 같은 쿼리 한 번으로 두 종류가 함께 온다
    expect(captured.sql).toMatch(/e\.quantity\s*\/\s*o\.quantity/);
    expect(rows.map(r => r.quantity)).toEqual([10, 3, 7]);

    const rep = await buildTradeReport({
      rangeStart: new Date(T0), rangeEnd: new Date(T0 + 48 * HOUR),
      totalKRW: 10_000, baselineKRW: 10_000, rows,
    });
    // 3×(110−100) + 7×(90−100) = +30 − 70 = −40. 재고가 정확히 소진되고 잔량이 남지 않는다.
    expect(rep.lifoPnlKRW).toBeCloseTo(-40, 6);
    expect(rep.buysAmountKRW).toBeCloseTo(1000, 6);
    expect(rep.sellsAmountKRW).toBeCloseTo(960, 6);      // 330(축소분) + 630(과거 그대로)
    expect(rep.headerPnlKRW).toBeCloseTo(-40, 6);
  });

  test('거래 요약 금액도 실제 집행액으로 집계된다', async () => {
    const rows: OrderRow[] = [
      buy10(),
      { symbol: '005930', side: 'sell', price: 110, quantity: 3, amount_krw: 330, fee: 0, ts: T0 + 2 * HOUR },
    ];
    const rep = await buildTradeReport({
      rangeStart, rangeEnd: new Date(T0 + 8 * HOUR), totalKRW: 10_000, baselineKRW: 10_000, rows,
    });
    expect(rep.sellsAmountKRW).toBeCloseTo(330, 6);     // 1100 이 아니다
    expect(rep.headerPnlKRW).toBeCloseTo(330 - 1000, 6);
    expect(rep.lifoPnlKRW).toBeCloseTo(30, 6);          // 3 × (110 − 100)
  });
});
