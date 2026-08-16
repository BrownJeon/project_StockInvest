import {
  groupByDateThenSymbol,
  formatGroupTimeRange,
  formatGroupSummary,
  countOrdersInDateGroup,
  UNKNOWN_SYMBOL,
  UNKNOWN_DATE_KEY,
  UNKNOWN_DATE_LABEL,
} from '../group-orders';

/** KST 기준 시각을 UTC ISO 로 — `2026-08-16 09:12 KST` = `2026-08-16T00:12:00.000Z` */
function kst(y: number, mo: number, d: number, h: number, mi: number): string {
  return new Date(Date.UTC(y, mo - 1, d, h - 9, mi, 0)).toISOString();
}

interface TestOrder {
  id: number;
  symbol: string;
  created_at: string;
}

function o(id: number, symbol: string, created_at: string): TestOrder {
  return { id, symbol, created_at };
}

/** '오늘'/'어제' 판정 기준 — 2026-08-16 14:00 KST */
const NOW = new Date(kst(2026, 8, 16, 14, 0));

describe('groupByDateThenSymbol', () => {
  describe('0건', () => {
    it('빈 배열이면 빈 결과', () => {
      expect(groupByDateThenSymbol([], NOW)).toEqual([]);
    });

    it('null/undefined/비배열도 던지지 않고 빈 결과', () => {
      expect(groupByDateThenSymbol(null, NOW)).toEqual([]);
      expect(groupByDateThenSymbol(undefined, NOW)).toEqual([]);
      // 런타임에 배열이 아닌 값이 들어와도 크래시하지 않아야 한다 (T-021 선례)
      expect(groupByDateThenSymbol({ length: 2 } as never, NOW)).toEqual([]);
    });
  });

  describe('1건', () => {
    const groups = groupByDateThenSymbol([o(1, '005930', kst(2026, 8, 16, 10, 5))], NOW);

    it('1건짜리 종목도 예외 없이 그룹이 된다 (결정 1·2)', () => {
      expect(groups).toHaveLength(1);
      expect(groups[0].symbolGroups).toHaveLength(1);
      expect(groups[0].symbolGroups[0].symbol).toBe('005930');
      expect(groups[0].symbolGroups[0].count).toBe(1);
      expect(groups[0].symbolGroups[0].orders.map(x => x.id)).toEqual([1]);
    });

    it('오늘 라벨이 붙는다', () => {
      expect(groups[0].dateLabel).toBe('오늘');
      expect(groups[0].dateKey).toBe('2026-08-16');
    });

    it('firstAt === lastAt 이므로 요약은 단일 시각 (결정 6)', () => {
      expect(formatGroupSummary(groups[0].symbolGroups[0])).toBe('1건 · 10:05');
    });
  });

  describe('같은 종목 다건', () => {
    const orders = [
      o(3, '005930', kst(2026, 8, 16, 14, 30)),
      o(2, '005930', kst(2026, 8, 16, 11, 0)),
      o(1, '005930', kst(2026, 8, 16, 9, 12)),
    ];
    const groups = groupByDateThenSymbol(orders, NOW);
    const g = groups[0].symbolGroups[0];

    it('한 종목 그룹으로 합쳐진다', () => {
      expect(groups).toHaveLength(1);
      expect(groups[0].symbolGroups).toHaveLength(1);
      expect(g.count).toBe(3);
    });

    it('firstAt=가장 이른 시각, lastAt=가장 늦은 시각', () => {
      expect(g.firstAt).toBe(kst(2026, 8, 16, 9, 12));
      expect(g.lastAt).toBe(kst(2026, 8, 16, 14, 30));
      expect(formatGroupSummary(g)).toBe('3건 · 09:12~14:30');
    });

    it('입력 순서가 뒤섞여도 firstAt/lastAt·정렬이 동일하다', () => {
      const shuffled = groupByDateThenSymbol([orders[1], orders[2], orders[0]], NOW);
      const sg = shuffled[0].symbolGroups[0];
      expect(sg.firstAt).toBe(g.firstAt);
      expect(sg.lastAt).toBe(g.lastAt);
      expect(sg.orders.map(x => x.id)).toEqual([3, 2, 1]); // 최신순
    });

    it('분 단위로 같은 시각만 있으면 범위 대신 단일 시각', () => {
      const same = groupByDateThenSymbol([
        o(1, '005930', kst(2026, 8, 16, 9, 12)),
        o(2, '005930', kst(2026, 8, 16, 9, 12)),
      ], NOW);
      expect(formatGroupSummary(same[0].symbolGroups[0])).toBe('2건 · 09:12');
    });
  });

  describe('여러 종목 혼재', () => {
    const groups = groupByDateThenSymbol([
      o(1, '005930',   kst(2026, 8, 16, 9, 12)),
      o(2, 'NAS:AAPL', kst(2026, 8, 16, 10, 5)),
      o(3, '005930',   kst(2026, 8, 16, 14, 30)),
      o(4, '000660',   kst(2026, 8, 16, 13, 0)),
    ], NOW);

    it('하루 안에서 종목별로 나뉜다', () => {
      expect(groups).toHaveLength(1);
      expect(groups[0].symbolGroups.map(g => g.symbol)).toEqual(['005930', '000660', 'NAS:AAPL']);
    });

    it('종목 그룹은 최신 주문이 늦은 순으로 정렬', () => {
      expect(groups[0].symbolGroups.map(g => g.count)).toEqual([2, 1, 1]);
      expect(groups[0].symbolGroups[0].lastAt).toBe(kst(2026, 8, 16, 14, 30));
    });

    it('날짜 그룹 총 건수는 입력 건수와 일치 — 조용히 버리지 않는다', () => {
      expect(countOrdersInDateGroup(groups[0])).toBe(4);
    });
  });

  describe('날짜 경계 (KST 자정)', () => {
    const groups = groupByDateThenSymbol([
      o(1, '005930', kst(2026, 8, 16, 0, 0)),   // 오늘 00:00 KST
      o(2, '005930', kst(2026, 8, 15, 23, 59)), // 어제 23:59 KST
      o(3, '005930', kst(2026, 8, 14, 10, 0)),  // 그저께
    ], NOW);

    it('자정을 경계로 날짜 그룹이 갈린다', () => {
      expect(groups.map(g => g.dateKey)).toEqual(['2026-08-16', '2026-08-15', '2026-08-14']);
      expect(groups.map(g => g.dateLabel)).toEqual(['오늘', '어제', '8. 14.']);
    });

    it('같은 종목이어도 날짜가 다르면 그룹이 분리된다', () => {
      expect(groups.every(g => g.symbolGroups.length === 1)).toBe(true);
      expect(groups.map(g => g.symbolGroups[0].count)).toEqual([1, 1, 1]);
    });

    it('UTC 자정(=KST 09:00)은 날짜를 넘기지 않는다', () => {
      const g = groupByDateThenSymbol([o(1, '005930', '2026-08-16T00:00:00.000Z')], NOW);
      expect(g[0].dateKey).toBe('2026-08-16'); // KST 09:00 → 같은 날
    });

    it('UTC 기준 다음날이지만 KST로는 같은 날인 경우', () => {
      // 2026-08-16 23:30 KST = 2026-08-16T14:30Z
      const g = groupByDateThenSymbol([o(1, '005930', '2026-08-16T14:30:00.000Z')], NOW);
      expect(g[0].dateKey).toBe('2026-08-16');
    });

    it('KST 00:30 (= 전날 UTC 15:30) 은 새 날짜로 분류된다', () => {
      const g = groupByDateThenSymbol([o(1, '005930', '2026-08-15T15:30:00.000Z')], NOW);
      expect(g[0].dateKey).toBe('2026-08-16');
      expect(g[0].dateLabel).toBe('오늘');
    });

    it('now 를 바꾸면 오늘/어제 라벨도 따라 이동한다', () => {
      const later = new Date(kst(2026, 8, 17, 10, 0));
      const g = groupByDateThenSymbol([o(1, '005930', kst(2026, 8, 16, 10, 0))], later);
      expect(g[0].dateLabel).toBe('어제');
    });
  });

  describe('created_at 이상값', () => {
    it('파싱 불가 문자열은 (날짜 미상) 그룹으로 모인다 — 버리지 않음', () => {
      const groups = groupByDateThenSymbol([
        o(1, '005930', kst(2026, 8, 16, 9, 0)),
        o(2, '005930', 'not-a-date'),
      ], NOW);
      expect(groups).toHaveLength(2);
      expect(groups.map(g => g.dateKey)).toEqual(['2026-08-16', UNKNOWN_DATE_KEY]);
      expect(groups[1].dateLabel).toBe(UNKNOWN_DATE_LABEL);
      expect(groups[1].symbolGroups[0].orders.map(x => x.id)).toEqual([2]);
    });

    it('(날짜 미상) 그룹은 항상 맨 뒤', () => {
      const groups = groupByDateThenSymbol([
        o(1, '005930', ''),
        o(2, '005930', kst(2026, 8, 10, 9, 0)),
        o(3, '005930', kst(2026, 8, 16, 9, 0)),
      ], NOW);
      expect(groups.map(g => g.dateKey)).toEqual(['2026-08-16', '2026-08-10', UNKNOWN_DATE_KEY]);
    });

    it('null / undefined / 빈문자 / NaN Date 전부 (날짜 미상)', () => {
      const groups = groupByDateThenSymbol([
        { id: 1, symbol: 'A', created_at: null },
        { id: 2, symbol: 'A', created_at: undefined },
        { id: 3, symbol: 'A', created_at: '   ' },
        { id: 4, symbol: 'A', created_at: new Date('garbage') },
        { id: 5, symbol: 'A', created_at: NaN },
      ], NOW);
      expect(groups).toHaveLength(1);
      expect(groups[0].dateKey).toBe(UNKNOWN_DATE_KEY);
      expect(groups[0].symbolGroups[0].count).toBe(5);
    });

    it('시각을 전부 모르면 firstAt/lastAt 은 null 이고 요약은 시각 미상', () => {
      const groups = groupByDateThenSymbol([o(1, '005930', 'bad')], NOW);
      const g = groups[0].symbolGroups[0];
      expect(g.firstAt).toBeNull();
      expect(g.lastAt).toBeNull();
      expect(formatGroupSummary(g)).toBe('1건 · 시각 미상');
    });

    it('epoch 숫자·Date 객체도 정상 처리한다', () => {
      const t = new Date(kst(2026, 8, 16, 9, 12));
      const groups = groupByDateThenSymbol([
        { id: 1, symbol: 'A', created_at: t },
        { id: 2, symbol: 'A', created_at: t.getTime() },
      ], NOW);
      expect(groups[0].dateKey).toBe('2026-08-16');
      expect(groups[0].symbolGroups[0].count).toBe(2);
      expect(formatGroupSummary(groups[0].symbolGroups[0])).toBe('2건 · 09:12');
    });

    it('배열 안의 null 원소는 건너뛰되 나머지는 유지한다', () => {
      const groups = groupByDateThenSymbol([
        null as never,
        o(1, '005930', kst(2026, 8, 16, 9, 0)),
      ], NOW);
      expect(countOrdersInDateGroup(groups[0])).toBe(1);
    });
  });

  describe('symbol 결측', () => {
    it('null/빈문자/공백은 (알 수 없음) 그룹으로 모인다', () => {
      const groups = groupByDateThenSymbol([
        { id: 1, symbol: null,     created_at: kst(2026, 8, 16, 9, 0) },
        { id: 2, symbol: '',       created_at: kst(2026, 8, 16, 9, 30) },
        { id: 3, symbol: '   ',    created_at: kst(2026, 8, 16, 10, 0) },
        { id: 4, symbol: '005930', created_at: kst(2026, 8, 16, 11, 0) },
      ], NOW);
      const symbols = groups[0].symbolGroups.map(g => g.symbol);
      expect(symbols).toContain(UNKNOWN_SYMBOL);
      expect(symbols).toContain('005930');
      const unknown = groups[0].symbolGroups.find(g => g.symbol === UNKNOWN_SYMBOL)!;
      expect(unknown.count).toBe(3);
      expect(countOrdersInDateGroup(groups[0])).toBe(4);
    });

    it('symbol 필드 자체가 없어도 던지지 않는다', () => {
      const groups = groupByDateThenSymbol(
        [{ id: 1, created_at: kst(2026, 8, 16, 9, 0) }],
        NOW,
      );
      expect(groups[0].symbolGroups[0].symbol).toBe(UNKNOWN_SYMBOL);
    });

    it('symbol 이 문자열이 아닌 값이어도 (알 수 없음) 처리', () => {
      const groups = groupByDateThenSymbol([
        { id: 1, symbol: 123 as never, created_at: kst(2026, 8, 16, 9, 0) },
      ], NOW);
      expect(groups[0].symbolGroups[0].symbol).toBe(UNKNOWN_SYMBOL);
    });
  });

  describe('symbol 공백 정규화 (Reviewer LOW)', () => {
    it("' 005930 '과 '005930'은 같은 종목 그룹으로 묶인다", () => {
      const groups = groupByDateThenSymbol([
        o(1, '005930',   kst(2026, 8, 16, 9, 12)),
        o(2, ' 005930 ', kst(2026, 8, 16, 11, 0)),
        o(3, '005930\n', kst(2026, 8, 16, 14, 30)),
        o(4, '\t005930', kst(2026, 8, 16, 10, 0)),
      ], NOW);

      expect(groups).toHaveLength(1);
      expect(groups[0].symbolGroups).toHaveLength(1);
      const g = groups[0].symbolGroups[0];
      expect(g.symbol).toBe('005930');          // 반환값도 trim 된 값
      expect(g.count).toBe(4);
      expect(formatGroupSummary(g)).toBe('4건 · 09:12~14:30');
    });

    it('해외 심볼(콜론 포함)도 공백만 다르면 한 그룹', () => {
      const groups = groupByDateThenSymbol([
        o(1, 'NAS:AAPL',  kst(2026, 8, 16, 9, 0)),
        o(2, ' NAS:AAPL', kst(2026, 8, 16, 10, 0)),
      ], NOW);
      expect(groups[0].symbolGroups).toHaveLength(1);
      expect(groups[0].symbolGroups[0].symbol).toBe('NAS:AAPL');
    });

    it('공백만 있는 심볼은 trim 후 빈 문자열이므로 (알 수 없음) 으로 떨어진다', () => {
      const groups = groupByDateThenSymbol([
        o(1, '   ',    kst(2026, 8, 16, 9, 0)),
        o(2, '\t\n',   kst(2026, 8, 16, 10, 0)),
        o(3, '005930', kst(2026, 8, 16, 11, 0)),
      ], NOW);

      const symbols = groups[0].symbolGroups.map(g => g.symbol);
      expect(symbols).toContain(UNKNOWN_SYMBOL);
      expect(symbols).toContain('005930');
      // trim 결과가 빈 문자열인 그룹이 '' 로 남지 않아야 한다
      expect(symbols).not.toContain('');
      const unknown = groups[0].symbolGroups.find(g => g.symbol === UNKNOWN_SYMBOL)!;
      expect(unknown.count).toBe(2);
      expect(countOrdersInDateGroup(groups[0])).toBe(3);
    });

    it('공백 정규화가 종목 그룹 요약 건수·시각범위를 정확하게 만든다', () => {
      // 정규화 전이라면 '005930' 1건 / ' 005930' 2건 으로 쪼개져 요약이 실제와 달라진다
      const groups = groupByDateThenSymbol([
        o(1, '005930',  kst(2026, 8, 16, 9, 0)),
        o(2, ' 005930', kst(2026, 8, 16, 12, 0)),
        o(3, '005930 ', kst(2026, 8, 16, 15, 0)),
      ], NOW);
      expect(groups[0].symbolGroups).toHaveLength(1);
      expect(formatGroupSummary(groups[0].symbolGroups[0])).toBe('3건 · 09:00~15:00');
    });
  });

  describe('페이징 정확성 (T-026 선결 과제)', () => {
    // 같은 날 같은 종목 5건 — 예전 구현은 "7건 slice 후 그룹핑"이라 경계에서 쪼개졌다.
    const orders = [
      o(1, '005930', kst(2026, 8, 16, 9, 0)),
      o(2, '005930', kst(2026, 8, 16, 10, 0)),
      o(3, '005930', kst(2026, 8, 16, 11, 0)),
      o(4, '005930', kst(2026, 8, 16, 12, 0)),
      o(5, '005930', kst(2026, 8, 16, 13, 0)),
    ];

    it('그룹핑 먼저 하면 같은 날 같은 종목이 하나의 그룹으로만 나온다', () => {
      const groups = groupByDateThenSymbol(orders, NOW);
      expect(groups[0].symbolGroups).toHaveLength(1);
      expect(formatGroupSummary(groups[0].symbolGroups[0])).toBe('5건 · 09:00~13:00');
    });

    it('날짜 단위로 잘라도 각 날짜 그룹의 요약은 온전하다', () => {
      const many = [
        ...orders,
        o(6, '005930', kst(2026, 8, 15, 9, 0)),
        o(7, '005930', kst(2026, 8, 14, 9, 0)),
      ];
      const groups = groupByDateThenSymbol(many, NOW);
      const page = groups.slice(0, 2); // 날짜 그룹 2개만 노출
      expect(page).toHaveLength(2);
      expect(formatGroupSummary(page[0].symbolGroups[0])).toBe('5건 · 09:00~13:00');
      expect(formatGroupSummary(page[1].symbolGroups[0])).toBe('1건 · 09:00');
    });
  });

  describe('결정성', () => {
    it('같은 입력이면 항상 같은 결과 (동률 정렬 포함)', () => {
      const sameTime = kst(2026, 8, 16, 9, 0);
      const input = [o(1, 'ZZZ', sameTime), o(2, 'AAA', sameTime), o(3, 'MMM', sameTime)];
      const a = groupByDateThenSymbol(input, NOW);
      const b = groupByDateThenSymbol(input, NOW);
      expect(a[0].symbolGroups.map(g => g.symbol)).toEqual(b[0].symbolGroups.map(g => g.symbol));
      expect(a[0].symbolGroups.map(g => g.symbol)).toEqual(['AAA', 'MMM', 'ZZZ']);
    });

    it('원본 배열을 변형하지 않는다', () => {
      const input = [
        o(1, '005930', kst(2026, 8, 16, 9, 0)),
        o(2, '005930', kst(2026, 8, 16, 11, 0)),
      ];
      const snapshot = input.map(x => x.id);
      groupByDateThenSymbol(input, NOW);
      expect(input.map(x => x.id)).toEqual(snapshot);
    });
  });
});

describe('formatGroupTimeRange', () => {
  it('서로 다른 시각은 범위로 표기', () => {
    expect(formatGroupTimeRange(kst(2026, 8, 16, 9, 12), kst(2026, 8, 16, 14, 30)))
      .toBe('09:12~14:30');
  });

  it('같은 시각이면 단일 표기', () => {
    const t = kst(2026, 8, 16, 9, 12);
    expect(formatGroupTimeRange(t, t)).toBe('09:12');
  });

  it('한쪽만 있으면 있는 쪽만', () => {
    const t = kst(2026, 8, 16, 9, 12);
    expect(formatGroupTimeRange(t, null)).toBe('09:12');
    expect(formatGroupTimeRange(null, t)).toBe('09:12');
  });

  it('둘 다 없으면 시각 미상', () => {
    expect(formatGroupTimeRange(null, null)).toBe('시각 미상');
  });
});
