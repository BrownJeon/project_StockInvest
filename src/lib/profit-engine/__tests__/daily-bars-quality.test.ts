/**
 * T-070 품질 게이트(T-064 §5.4) — 통화 혼합 거부·±30% 표시(제외 아님)·거래량 0·중복·역순·조정 변경 감지·결측.
 */
import {
  annotateBars, assertSingleCurrency, CORP_ACTION_RATIO, CurrencyMismatchError, detectAdjustmentChange, findGaps,
  FLAG_ADJ_STALE, FLAG_CORP_ACTION, FLAG_DUP_CONFLICT, FLAG_ZERO_VOLUME, flagsFromColumn, flagsToColumn, mergePages, normalizeBar,
  type RawBar, type StoredBar,
} from '../daily-bars-quality';

const bar = (tradeDate: string, close: number, volume = 100): RawBar => ({
  tradeDate, open: close, high: close, low: close, close, volume, turnover: null,
});

describe('통화 혼합 거부', () => {
  test('시장 통화 하나면 통과', () => {
    expect(() => assertSingleCurrency('US', ['USD', 'USD'])).not.toThrow();
    expect(() => assertSingleCurrency('KR', [])).not.toThrow();
  });
  test('미국 종목에 KRW 가 섞이면 거부', () => {
    expect(() => assertSingleCurrency('US', ['USD', 'KRW'])).toThrow(CurrencyMismatchError);
    expect(() => assertSingleCurrency('KR', ['USD'])).toThrow(/currency_mismatch: market=KR expected=KRW found=USD/);
  });
});

describe('normalizeBar', () => {
  test('USD 원값 그대로(환산 없음), 시·고·저가 0 은 null', () => {
    expect(normalizeBar({ tradeDate: '2026-10-21', open: '0', high: '0', low: '0', close: '187.4500', volume: '1200', turnover: '' }))
      .toEqual({ tradeDate: '2026-10-21', open: null, high: null, low: null, close: 187.45, volume: 1200, turnover: null });
  });
  test('종가 0·음수·비숫자, 거래량 음수, 날짜 없음은 버린다', () => {
    const base = { tradeDate: '2026-10-21', open: 1, high: 1, low: 1, volume: 1, turnover: 1 };
    expect(normalizeBar({ ...base, close: 0 })).toBeNull();
    expect(normalizeBar({ ...base, close: 'x' })).toBeNull();
    expect(normalizeBar({ ...base, close: 1, volume: -1 })).toBeNull();
    expect(normalizeBar({ ...base, tradeDate: null, close: 1 })).toBeNull();
  });
});

describe('mergePages — 중복 제거·역순 검출', () => {
  test('페이지 겹침은 날짜당 1행, 오름차순', () => {
    const r = mergePages([[bar('2026-10-21', 3), bar('2026-10-20', 2)], [bar('2026-10-20', 2), bar('2026-10-19', 1)]]);
    expect(r.bars.map((b) => b.tradeDate)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21']);
    expect(r.duplicates).toBe(1);
    expect(r.conflicts.size).toBe(0);
    expect(r.orderViolations).toBe(0);
  });
  test('같은 날짜 값이 다르면 나중 값 + 충돌 표시', () => {
    const r = mergePages([[bar('2026-10-20', 2)], [bar('2026-10-20', 2.5)]]);
    expect(r.bars[0].close).toBe(2.5);
    expect([...r.conflicts]).toEqual(['2026-10-20']);
    expect(annotateBars(r.bars, [], r.conflicts)[0].flags).toContain(FLAG_DUP_CONFLICT);
  });
  test('페이지 안 오름차순(역순)·같은 날 반복은 위반으로 센다', () => {
    expect(mergePages([[bar('2026-10-19', 1), bar('2026-10-20', 2)]]).orderViolations).toBe(1);
    expect(mergePages([[bar('2026-10-20', 1), bar('2026-10-20', 1)]]).orderViolations).toBe(1);
  });
});

describe('annotateBars — 전일 대비 [0.70, 1.43] 밖은 표시(제외 아님)', () => {
  test('경계값 자체는 정상, 경계 밖은 corp_action_suspect', () => {
    expect(CORP_ACTION_RATIO).toEqual([0.70, 1.43]);
    const a = annotateBars([bar('2026-10-01', 100), bar('2026-10-02', 70), bar('2026-10-05', 100.09)], []);
    expect(a.map((b) => b.flags)).toEqual([[], [], []]);     // 정확히 0.70, 100.09/70 ≈ 1.4299
    const e = annotateBars([bar('2026-10-01', 100), bar('2026-10-02', 143)], []);
    expect(e[1].flags).toEqual([]);                          // 정확히 1.43
    const b = annotateBars([bar('2026-10-01', 100), bar('2026-10-02', 69.99)], []);
    expect(b[1].flags).toEqual([FLAG_CORP_ACTION]);
    const c = annotateBars([bar('2026-10-01', 100), bar('2026-10-02', 143.01)], []);
    expect(c[1].flags).toEqual([FLAG_CORP_ACTION]);
    expect(c.length).toBe(2);   // 행은 그대로 남는다
  });
  test('분할(1/2)·병합(×4) 모두 표시', () => {
    const a = annotateBars([bar('2026-10-01', 400), bar('2026-10-02', 200), bar('2026-10-05', 800)], []);
    expect(a.map((b) => b.flags.includes(FLAG_CORP_ACTION))).toEqual([false, true, true]);
  });
  test('거래량 0 표시', () => {
    expect(annotateBars([bar('2026-10-01', 10, 0)], [])[0].flags).toEqual([FLAG_ZERO_VOLUME]);
  });
  test('페이지 경계 — 전일 종가를 저장분(문맥)에서 찾는다', () => {
    const a = annotateBars([bar('2026-10-02', 50)], [{ tradeDate: '2026-10-01', close: 100 }]);
    expect(a[0].hasPredecessor).toBe(true);
    expect(a[0].flags).toEqual([FLAG_CORP_ACTION]);
    const b = annotateBars([bar('2026-10-02', 50)], []);
    expect(b[0].hasPredecessor).toBe(false);
    expect(b[0].flags).toEqual([]);
  });
});

describe('flags 열 직렬화', () => {
  test('정렬·중복 제거, 빈 목록은 NULL', () => {
    expect(flagsToColumn([FLAG_ZERO_VOLUME, FLAG_CORP_ACTION, FLAG_ZERO_VOLUME])).toBe('corp_action_suspect,zero_volume');
    expect(flagsToColumn([])).toBeNull();
    expect(flagsFromColumn('a, b')).toEqual(['a', 'b']);
    expect(flagsFromColumn(null)).toEqual([]);
  });
});

describe('detectAdjustmentChange — 조정 기준 변경 감지(R-10)', () => {
  const stored = (tradeDate: string, close: number, extra: Partial<StoredBar> = {}): StoredBar => ({ tradeDate, close, isFinal: true, flags: [], ...extra });
  test('겹친 확정 구간 종가가 같으면 변경 없음', () => {
    const r = detectAdjustmentChange([bar('2026-10-20', 10), bar('2026-10-21', 11)], [stored('2026-10-20', 10), stored('2026-10-19', 9)]);
    expect(r).toEqual({ compared: 1, mismatches: [], changed: false, unitMismatch: false });
  });
  test('허용 오차(0.0001) 이내는 같다고 본다, 넘으면 변경', () => {
    expect(detectAdjustmentChange([bar('2026-10-20', 10.00005)], [stored('2026-10-20', 10)]).changed).toBe(false);
    const r = detectAdjustmentChange([bar('2026-10-20', 9.98)], [stored('2026-10-20', 10)]);
    expect(r.changed).toBe(true);
    expect(r.unitMismatch).toBe(false);
    expect(r.mismatches).toEqual([{ tradeDate: '2026-10-20', stored: 10, fresh: 9.98 }]);
  });
  test('장중(미확정)·adj_stale 저장 행은 비교하지 않는다', () => {
    const r = detectAdjustmentChange([bar('2026-10-20', 12), bar('2026-10-21', 13)], [
      stored('2026-10-20', 10, { isFinal: false }), stored('2026-10-21', 10, { flags: [FLAG_ADJ_STALE] }),
    ]);
    expect(r).toEqual({ compared: 0, mismatches: [], changed: false, unitMismatch: false });
  });
  test('수십 배 차이는 조정이 아니라 단위·통화 혼입', () => {
    expect(detectAdjustmentChange([bar('2026-10-20', 187.45)], [stored('2026-10-20', 187.45 * 1400)]).unitMismatch).toBe(true);
  });
});

describe('findGaps — 결측 후보', () => {
  test('9일 넘는 빈틈만 보고', () => {
    expect(findGaps([{ tradeDate: '2026-09-30' }, { tradeDate: '2026-10-08' }, { tradeDate: '2026-10-20' }]))
      .toEqual([{ from: '2026-10-08', to: '2026-10-20', days: 12 }]);
  });
});
