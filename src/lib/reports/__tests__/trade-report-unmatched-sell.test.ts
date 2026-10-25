/**
 * T-086 (D0) — **재고 없는 매도를 "대금 전액 이익"으로 세지 않는다.**
 *
 * ## 고정하려는 결함 (감사 F02)
 *
 * `computeLifoPnl` 은 LIFO 재고가 비어 `costBasis = 0` 인 매도를 만나면 `amount_krw` 로 폴백해
 * `pnl = 매도대금 − 0 − 수수료` — 즉 매도대금 전액을 이익으로 더했다. 앱 밖에서 산 종목을 앱으로
 * 팔면 매번 그렇게 되므로, 실현손익이 "잘 되고 있다"는 방향으로 부풀었다.
 *
 * ## 이 파일이 못 박는 계약 ("불명 우선")
 *  1. 원가를 아는 부분(재고와 매칭된 수량)만 손익에 넣는다. 매도대금·수수료는 매칭 비율만큼 배분.
 *  2. 매칭 못 한 수량은 이익도 손실도 아닌 "원가 미상"으로 `unmatched`·`unmatchedSellCount` 에 센다.
 *  3. 재고가 충분하면 예전 결과와 완전히 같다.
 *  4. 리포트 문자열은 부분합임을 숨기지 않는다.
 *  5. `lifoPnlKRW` 를 읽는 소비자는 새 필드도 함께 읽는다(정적 점검).
 *
 * 수치는 전부 합성 값이다.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import {
  computeLifoPnl,
  buildTradeReport,
  formatReportMessage,
  UNMATCHED_SELL_NOTE,
  type OrderRow,
} from '../trade-report';

const T0 = new Date('2026-05-07T00:00:00Z').getTime();
const HOUR = 3600_000;

function row(
  symbol: string, side: 'buy' | 'sell', price: number | null, qty: number, ts: number,
  opts: { fee?: number; amount?: number } = {},
): OrderRow {
  return {
    symbol, side, price, quantity: qty,
    amount_krw: opts.amount ?? (price ?? 0) * qty,
    fee: opts.fee ?? 0,
    ts,
  };
}

/** T-086 이전 식 그대로 — "재고 충분하면 완전히 동일" 을 대조하기 위한 기준 구현. */
function legacyLifoTotal(rows: OrderRow[], rangeStart: Date): number {
  const stacks = new Map<string, Array<{ price: number; qty: number }>>();
  let total = 0;
  for (const r of rows) {
    const stack = stacks.get(r.symbol) ?? [];
    if (r.side === 'buy') {
      const price = r.price ?? (r.quantity > 0 ? r.amount_krw / r.quantity : 0);
      if (Number.isFinite(price) && price > 0 && r.quantity > 0) stack.push({ price, qty: r.quantity });
      stacks.set(r.symbol, stack);
    } else {
      let toRemove = r.quantity;
      let costBasis = 0;
      while (toRemove > 1e-12 && stack.length > 0) {
        const top = stack[stack.length - 1];
        if (top.qty <= toRemove + 1e-12) { costBasis += top.price * top.qty; toRemove -= top.qty; stack.pop(); }
        else { costBasis += top.price * toRemove; top.qty -= toRemove; toRemove = 0; }
      }
      stacks.set(r.symbol, stack);
      if (r.ts >= rangeStart.getTime()) {
        const matchedQty = r.quantity - toRemove;
        const rev = matchedQty > 0 && r.price != null ? r.price * matchedQty : r.amount_krw;
        total += rev - costBasis - r.fee;
      }
    }
  }
  return total;
}

// ── 1. F02 회귀 ──────────────────────────────────────────────────────────────

describe('🔴 F02 회귀 — 재고 없는 매도는 손익에 0 기여', () => {
  const rangeStart = new Date(T0);

  test('재고 0 + 매도 → 손익 0, unmatched 에 수량 기록, 합계가 매도대금만큼 늘지 않는다', () => {
    const rows = [row('AAA', 'sell', 500, 4, T0 + HOUR, { fee: 3 })];
    const r = computeLifoPnl(rows, rangeStart);

    expect(r.totalKRW).toBe(0);
    expect(r.totalKRW).not.toBeCloseTo(500 * 4 - 3, 6);   // 예전 결과(대금 전액 이익)
    expect(legacyLifoTotal(rows, rangeStart)).toBeCloseTo(1997, 6); // 예전 식은 실제로 그렇게 셌다
    expect(r.perSymbol.has('AAA')).toBe(false);
    expect(r.unmatched.get('AAA')).toEqual({ quantity: 4, sellCount: 1 });
    expect(r.unmatchedSellCount).toBe(1);
    expect(r.matchedSellCount).toBe(0);
  });

  test('price 없는 재고 0 매도도 amount_krw 를 이익으로 세지 않는다', () => {
    const rows = [row('AAA', 'sell', null, 2, T0 + HOUR, { amount: 900, fee: 1 })];
    const r = computeLifoPnl(rows, rangeStart);
    expect(r.totalKRW).toBe(0);
    expect(r.unmatched.get('AAA')).toEqual({ quantity: 2, sellCount: 1 });
  });

  test('여러 종목·여러 건 — 원가 미상 건수와 수량이 종목별로 쌓인다', () => {
    const rows = [
      row('AAA', 'sell', 100, 1, T0 + 1 * HOUR),
      row('AAA', 'sell', 100, 2, T0 + 2 * HOUR),
      row('BBB', 'sell', 50, 5, T0 + 3 * HOUR),
    ];
    const r = computeLifoPnl(rows, rangeStart);
    expect(r.totalKRW).toBe(0);
    expect(r.unmatchedSellCount).toBe(3);
    expect(r.unmatched.get('AAA')).toEqual({ quantity: 3, sellCount: 2 });
    expect(r.unmatched.get('BBB')).toEqual({ quantity: 5, sellCount: 1 });
  });

  test('수량이 0 이하인 매도는 비율을 정할 수 없으므로 원가 미상으로 센다(대금을 이익으로 넣지 않는다)', () => {
    const rows = [
      row('AAA', 'buy', 100, 1, T0 + 1 * HOUR),
      row('AAA', 'sell', 100, 0, T0 + 2 * HOUR, { amount: 700 }),
    ];
    const r = computeLifoPnl(rows, rangeStart);
    expect(r.totalKRW).toBe(0);
    expect(r.unmatchedSellCount).toBe(1);
    expect(r.matchedSellCount).toBe(0);
  });
});

// ── 2. 재고 일부 ─────────────────────────────────────────────────────────────

describe('재고 일부 + 더 큰 매도 → 매칭분만 손익, 초과분은 원가 미상', () => {
  const rangeStart = new Date(T0);

  test('price 있음 — price × matched − cost − fee × 비율', () => {
    const rows = [
      row('AAA', 'buy', 100, 3, T0 + 1 * HOUR),
      row('AAA', 'sell', 120, 5, T0 + 2 * HOUR, { fee: 10 }),
    ];
    const r = computeLifoPnl(rows, rangeStart);
    // 매칭 3주: 120×3 − 100×3 − 10×(3/5) = 360 − 300 − 6 = 54
    expect(r.totalKRW).toBeCloseTo(54, 9);
    expect(r.perSymbol.get('AAA')).toBeCloseTo(54, 9);
    expect(r.unmatched.get('AAA')?.quantity).toBeCloseTo(2, 9);
    expect(r.unmatched.get('AAA')?.sellCount).toBe(1);
    expect(r.unmatchedSellCount).toBe(1);
    expect(r.matchedSellCount).toBe(1);   // 부분 매칭은 양쪽에 다 센다
  });

  test('price 없음 — 매칭분만 amount_krw × (matched/qty)', () => {
    const rows = [
      row('AAA', 'buy', 100, 1, T0 + 1 * HOUR),
      row('AAA', 'sell', null, 4, T0 + 2 * HOUR, { amount: 480, fee: 8 }),
    ];
    const r = computeLifoPnl(rows, rangeStart);
    // 480 × 1/4 − 100 − 8 × 1/4 = 120 − 100 − 2 = 18
    expect(r.totalKRW).toBeCloseTo(18, 9);
    expect(r.unmatched.get('AAA')?.quantity).toBeCloseTo(3, 9);
    // 예전 식은 대금 전액(480) vs 부분 원가(100) 로 과대 계상했다
    expect(legacyLifoTotal(rows, rangeStart)).toBeCloseTo(480 - 100 - 8, 9);
  });
});

// ── 3. 재고 충분 → 예전과 완전히 동일 ────────────────────────────────────────

describe('재고 충분 → 기존 결과와 완전히 동일', () => {
  const cases: Array<{ name: string; start: number; rows: OrderRow[] }> = [
    { name: '단순 차익', start: T0, rows: [row('A', 'buy', 100, 1, T0 + HOUR), row('A', 'sell', 110, 1, T0 + 2 * HOUR, { fee: 3 })] },
    { name: 'LIFO 다중', start: T0, rows: [
      row('A', 'buy', 100, 2, T0 + 1 * HOUR), row('A', 'buy', 200, 1, T0 + 2 * HOUR),
      row('A', 'sell', 150, 2, T0 + 3 * HOUR, { fee: 1 }), row('A', 'sell', 90, 1, T0 + 4 * HOUR),
    ] },
    { name: 'price 없는 매도 전량 매칭', start: T0, rows: [
      row('A', 'buy', 100, 2, T0 + 1 * HOUR), row('A', 'sell', null, 2, T0 + 2 * HOUR, { amount: 260, fee: 2 }),
    ] },
    { name: 'price 없는 매수 폴백', start: T0, rows: [
      row('A', 'buy', null, 4, T0 + 1 * HOUR, { amount: 400 }), row('A', 'sell', 130, 4, T0 + 2 * HOUR),
    ] },
    { name: '소수 수량 (부동소수 경계)', start: T0, rows: [
      row('A', 'buy', 100, 0.1, T0 + 1 * HOUR), row('A', 'buy', 100, 0.2, T0 + 2 * HOUR),
      row('A', 'sell', 120, 0.3, T0 + 3 * HOUR, { fee: 0.5 }),
    ] },
    { name: 'range 이전 재고', start: T0 + 5 * HOUR, rows: [
      row('A', 'buy', 100, 1, T0 + 1 * HOUR), row('A', 'sell', 120, 1, T0 + 6 * HOUR),
    ] },
  ];

  test.each(cases)('$name', ({ start, rows }) => {
    const r = computeLifoPnl(rows, new Date(start));
    expect(r.totalKRW).toBe(legacyLifoTotal(rows, new Date(start)));   // 근사가 아니라 같은 값
    expect(r.unmatchedSellCount).toBe(0);
    expect(r.unmatched.size).toBe(0);
  });
});

// ── 5. rangeStart 이전 매도 ─────────────────────────────────────────────────

describe('rangeStart 이전 매도는 손익·unmatched 어디에도 들어가지 않는다', () => {
  test('기간 밖 매도(재고 초과 포함)는 재고만 소진한다', () => {
    const rangeStart = new Date(T0 + 10 * HOUR);
    const rows = [
      row('AAA', 'buy', 100, 2, T0 + 1 * HOUR),
      row('AAA', 'sell', 110, 5, T0 + 2 * HOUR),   // 기간 밖 — 재고 2주 소진, 초과 3주는 무시
      row('BBB', 'sell', 50, 1, T0 + 3 * HOUR),    // 기간 밖 — 재고 없음, 무시
    ];
    const r = computeLifoPnl(rows, rangeStart);
    expect(r.totalKRW).toBe(0);
    expect(r.unmatchedSellCount).toBe(0);
    expect(r.matchedSellCount).toBe(0);
    expect(r.unmatched.size).toBe(0);
  });

  test('기간 밖 매도가 재고를 비우면 기간 내 매도는 원가 미상이 된다', () => {
    const rangeStart = new Date(T0 + 10 * HOUR);
    const rows = [
      row('AAA', 'buy', 100, 2, T0 + 1 * HOUR),
      row('AAA', 'sell', 110, 2, T0 + 2 * HOUR),   // 기간 밖
      row('AAA', 'sell', 120, 1, T0 + 11 * HOUR),  // 기간 내 — 재고 없음
    ];
    const r = computeLifoPnl(rows, rangeStart);
    expect(r.totalKRW).toBe(0);
    expect(r.unmatched.get('AAA')).toEqual({ quantity: 1, sellCount: 1 });
  });
});

// ── buildTradeReport 배선 ───────────────────────────────────────────────────

describe('buildTradeReport — 원가 미상 필드를 리포트까지 실어 나른다', () => {
  test('lifoPnlKRW 는 원가를 아는 부분만, 건수·종목별 미상 수량이 함께 나온다', async () => {
    const rows = [
      row('AAA', 'buy', 100, 1, T0 + 1 * HOUR),
      row('AAA', 'sell', 110, 1, T0 + 2 * HOUR),   // 매칭 +10
      row('BBB', 'sell', 300, 2, T0 + 3 * HOUR),   // 원가 미상
    ];
    const rep = await buildTradeReport({
      rangeStart: new Date(T0), rangeEnd: new Date(T0 + 8 * HOUR), totalKRW: 1000, baselineKRW: 1000, rows,
    });
    expect(rep.lifoPnlKRW).toBeCloseTo(10, 9);
    expect(rep.unmatchedSellCount).toBe(1);
    expect(rep.matchedSellCount).toBe(1);
    // 거래 요약(매도 금액·headerPnl)은 바꾸지 않는다 — 이 task 는 실현손익만 고친다
    expect(rep.sellsAmountKRW).toBeCloseTo(110 + 600, 9);
    const bbb = rep.perSymbol.find(p => p.symbol === 'BBB');
    expect(bbb).toMatchObject({ realizedKRW: 0, sellCount: 1, unmatchedSellCount: 1, unmatchedQty: 2 });
    const aaa = rep.perSymbol.find(p => p.symbol === 'AAA');
    expect(aaa).toMatchObject({ unmatchedSellCount: 0, unmatchedQty: 0 });
  });
});

// ── 6. 리포트 문자열 ─────────────────────────────────────────────────────────

describe('리포트 문자열 — 부분합임을 숨기지 않는다', () => {
  const build = (rows: OrderRow[]) => buildTradeReport({
    rangeStart: new Date(T0), rangeEnd: new Date(T0 + 3 * HOUR), totalKRW: 1000, baselineKRW: 1000, rows,
  });
  /** `*거래 요약*` 다음 줄부터 다음 빈 줄 전까지 */
  const summaryBlock = (msg: string): string[] => {
    const lines = msg.split('\n');
    const i = lines.indexOf('*거래 요약*');
    const out: string[] = [];
    for (let j = i + 1; j < lines.length && lines[j] !== ''; j++) out.push(lines[j]);
    return out;
  };

  test('문구는 설계서 그대로', () => {
    expect(UNMATCHED_SELL_NOTE(3)).toBe('원가 미상 매도 3건 — 실현손익에서 제외');
  });

  test('unmatchedSellCount = 0 → 예전 문자열과 동일', async () => {
    const rep = await build([row('AAA', 'buy', 100, 1, T0 + HOUR), row('AAA', 'sell', 110, 1, T0 + 2 * HOUR)]);
    expect(rep.unmatchedSellCount).toBe(0);
    const msg = formatReportMessage(rep, 1000, 1000);
    expect(summaryBlock(msg)).toEqual([
      '• 매수 1건 / ₩100',
      '• 매도 1건 / ₩110',
      '• 실현 손익: +₩10',
    ]);
    expect(msg).not.toMatch(/원가 미상/);
  });

  test('일부 원가 미상 → 숫자는 남기고 표지 줄을 붙인다', async () => {
    const rep = await build([
      row('AAA', 'buy', 100, 1, T0 + HOUR),
      row('AAA', 'sell', 110, 1, T0 + 1.5 * HOUR),
      row('BBB', 'sell', 300, 2, T0 + 2 * HOUR),
    ]);
    const msg = formatReportMessage(rep, 1000, 1000);
    expect(summaryBlock(msg)).toEqual([
      '• 매수 1건 / ₩100',
      '• 매도 2건 / ₩710',
      '• 실현 손익: +₩10',
      '• 원가 미상 매도 1건 — 실현손익에서 제외',
    ]);
  });

  test('모든 매도가 원가 미상 → 합계 칸은 숫자 대신 "원가 미상"', async () => {
    const rep = await build([
      row('AAA', 'sell', 500, 4, T0 + HOUR),
      row('BBB', 'sell', 300, 2, T0 + 2 * HOUR),
    ]);
    const msg = formatReportMessage(rep, 1000, 1000);
    expect(summaryBlock(msg)).toEqual([
      '• 매수 0건 / ₩0',
      '• 매도 2건 / ₩2,600',
      '• 실현 손익: 원가 미상',
      '• 원가 미상 매도 2건 — 실현손익에서 제외',
    ]);
    // "+₩0" 처럼 본전으로 읽히는 숫자를 쓰지 않는다
    expect(msg).not.toMatch(/실현 손익: [+−]?₩/);
  });
});

// ── 7. 소비자 정적 점검 ──────────────────────────────────────────────────────

describe('소비자 정적 점검 — lifoPnlKRW 를 낡은 의미로 읽는 경로가 없다', () => {
  const SRC = join(__dirname, '..', '..', '..');          // <repo>/src
  const SELF = 'lib/reports/trade-report.ts';

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === '__tests__' || name === 'node_modules') continue;
        walk(p, out);
      } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        out.push(p);
      }
    }
    return out;
  }
  const files = walk(SRC).map(p => ({ rel: relative(SRC, p).split('\\').join('/'), text: readFileSync(p, 'utf8') }));

  test('computeLifoPnl 을 호출하는 운영 코드는 trade-report.ts 하나뿐', () => {
    const callers = files.filter(f => /computeLifoPnl\s*\(/.test(f.text)).map(f => f.rel);
    expect(callers).toEqual([SELF]);
  });

  test('lifoPnlKRW 를 읽는 파일은 모두 unmatchedSellCount 도 읽는다', () => {
    const readers = files.filter(f => f.rel !== SELF && /\blifoPnlKRW\b/.test(f.text));
    // 현재 소비자 목록 — 새 소비자가 생기면 이 목록과 함께 표지 처리 여부를 다시 본다.
    expect(readers.map(f => f.rel).sort()).toEqual(['app/api/cron/trade-report/route.ts']);
    for (const f of readers) {
      expect({ file: f.rel, handles: /\bunmatchedSellCount\b/.test(f.text) }).toEqual({ file: f.rel, handles: true });
    }
  });

  test('화면 컴포넌트(.tsx)는 lifoPnlKRW 를 렌더링하지 않는다 (렌더링하게 되면 데모 게이트 대상)', () => {
    const tsx = files.filter(f => f.rel.endsWith('.tsx') && /\blifoPnlKRW\b/.test(f.text)).map(f => f.rel);
    expect(tsx).toEqual([]);
  });
});
