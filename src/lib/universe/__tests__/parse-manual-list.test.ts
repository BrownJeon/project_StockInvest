/**
 * T-143 WP-B — 수동 목록 파싱·대조·서버 재검사 시험 (구현 가이드 §2.6.2 규칙 6개 + §4.3 서버 재검사).
 *
 * 데모 §4 의 입력 3종(정상·형식 오류 포함·빈 입력)을 그대로 쓴다 — 데모가 오류로 보여 준 5가지가
 * 전부 `bad` 로 떨어지는지가 핵심이다(소문자를 자동 대문자로 바꾸지 않는다 — Leader L-3).
 */
import {
  MANUAL_LIST_MAX,
  OVERSEAS_LIST_PATTERN,
  buildManualListDiff,
  checkManualSymbols,
  diffSymbols,
  parseManualList,
} from '../parse-manual-list';

/** 데모 PRESETS.good(20줄) 중 현재 목록과 겹치는 부분 + 새 3종목 */
const CURRENT = [
  'NAS:AAAA', 'NAS:ABBB', 'NAS:ACCC', 'NAS:ADDD', 'NAS:AEEE', 'NAS:AFFF', 'NAS:AGGG', 'NAS:AHHH', 'NAS:AIII', 'NAS:AJJJ',
  'NAS:AKKK', 'NAS:ALLL', 'NAS:AMMM', 'NAS:ANNN', 'NAS:AOOO', 'NAS:APPP', 'NAS:AQQQ', 'NAS:ARRR', 'NAS:ASSS', 'NAS:ATTT',
];

describe('parseManualList — 자르기·형식·중복', () => {
  test('줄바꿈·쉼표로 자르고 공백·빈 줄을 정리한다(데모 hint 문구가 약속한 동작)', () => {
    const r = parseManualList('  NAS:AAAA \n\nNYS:BBBB,  AMS:CCCC  \n');
    expect(r.good).toEqual(['NAS:AAAA', 'NYS:BBBB', 'AMS:CCCC']);
    expect(r.bad).toEqual([]);
    expect(r.dup).toEqual([]);
  });

  test('🔴 데모가 오류로 보여 준 5가지가 전부 bad — 거래소 없음·소문자·빈 코드·뒤에 글자·알 수 없는 거래소', () => {
    const r = parseManualList(['AAPL', 'nas:aggg', 'NAS:', 'NAS:ANNN 삼성', 'TSE:7203'].join('\n'));
    expect(r.good).toEqual([]);
    expect(r.bad).toEqual(['AAPL', 'nas:aggg', 'NAS:', 'NAS:ANNN 삼성', 'TSE:7203']);
  });

  test('소문자를 대문자로 바꾸지 않는다(L-3) — 입력한 것과 저장된 것이 달라지지 않게', () => {
    expect(parseManualList('nas:aggg').good).toEqual([]);
    expect(parseManualList('nas:aggg').bad).toEqual(['nas:aggg']);
  });

  test('KIS 로 변환되는 거래소 3개만 통과 — 기존 isOverseasSymbol 보다 엄격하다(불편한 사실 7)', () => {
    for (const s of ['NAS:A', 'NYS:BRK.B', 'AMS:XYZ9']) expect(OVERSEAS_LIST_PATTERN.test(s)).toBe(true);
    for (const s of ['ABC:AAA', 'NASD:AAA', 'NAS:1AAA', 'NAS:AAAAAAAA']) expect(OVERSEAS_LIST_PATTERN.test(s)).toBe(false);
  });

  test('중복은 첫 것만 남기고 두 번째 이후가 dup(오류가 아니다)', () => {
    const r = parseManualList('NAS:AAAA\nNAS:AAAA\nNAS:ABBB\nNAS:AAAA');
    expect(r.good).toEqual(['NAS:AAAA', 'NAS:ABBB']);
    expect(r.dup).toEqual(['NAS:AAAA', 'NAS:AAAA']);
    expect(r.bad).toEqual([]);
  });

  test('빈 입력·null·undefined → 세 목록 모두 빈 배열(막지 않는다 — 규칙 6)', () => {
    for (const v of ['', '   \n\n , ', null, undefined]) {
      expect(parseManualList(v)).toEqual({ good: [], bad: [], dup: [] });
    }
  });
});

describe('diffSymbols / buildManualListDiff — 현재 수동 목록만 상대한다', () => {
  test('넣을 것·뺄 것·그대로', () => {
    const d = diffSymbols(['A', 'B', 'C'], ['B', 'C', 'D']);
    expect(d).toEqual({ add: ['D'], rm: ['A'], same: ['B', 'C'] });
  });

  test('데모 정상 입력(AAAA·ACCC 빼고 BXXX·BYYY·BZZZ 넣기) 그대로 나온다', () => {
    const next = CURRENT.filter((s) => s !== 'NAS:AAAA' && s !== 'NAS:ACCC').concat(['NAS:BXXX', 'NAS:BYYY', 'NAS:BZZZ']);
    const d = buildManualListDiff(CURRENT, next.join('\n'));
    expect(d.add).toEqual(['NAS:BXXX', 'NAS:BYYY', 'NAS:BZZZ']);
    expect(d.rm).toEqual(['NAS:AAAA', 'NAS:ACCC']);
    expect(d.same).toHaveLength(18);
    expect(d.next).toHaveLength(21);
    expect(d.blocked).toBe(false);
  });

  test('🔴 형식 오류 1건이면 blocked — 통과한 줄이 add 에 있어도 저장을 막는다(부분 반영 없음)', () => {
    const d = buildManualListDiff(CURRENT, 'NAS:BXXX\nAAPL');
    expect(d.add).toEqual(['NAS:BXXX']);
    expect(d.bad).toEqual(['AAPL']);
    expect(d.blocked).toBe(true);
  });

  test('빈 입력은 blocked 가 아니다 — 전부 빼기이고 확인 시트가 그 결과를 말한다', () => {
    const d = buildManualListDiff(CURRENT, '');
    expect(d.blocked).toBe(false);
    expect(d.next).toEqual([]);
    expect(d.rm).toEqual(CURRENT);
    expect(d.same).toEqual([]);
  });

  test('즐겨찾기·보유는 비교에 넣지 않는다 — 현재 수동 목록 밖의 종목은 rm 에 나오지 않는다', () => {
    const d = buildManualListDiff(['NAS:AAAA'], 'NAS:AAAA');
    expect(d.rm).toEqual([]);
    expect(d.same).toEqual(['NAS:AAAA']);
  });
});

describe('checkManualSymbols — 서버 재검사(§4.3)', () => {
  test('통과: 형식 정상 + 중복은 첫 것만(dropped 로 알린다)', () => {
    const r = checkManualSymbols(['NAS:AAAA', ' NAS:ABBB ', 'NAS:AAAA']);
    expect(r).toEqual({ ok: true, symbols: ['NAS:AAAA', 'NAS:ABBB'], dropped: ['NAS:AAAA'] });
  });

  test('🔴 형식 오류가 1건이라도 있으면 거부 — invalid 에 그 줄들이 담긴다', () => {
    const r = checkManualSymbols(['NAS:AAAA', 'AAPL', 'nas:bbb']);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toBe('invalid_symbol');
    expect(r.invalid).toEqual(['AAPL', 'nas:bbb']);
  });

  test('문자열이 아닌 원소도 형식 오류로 떨어진다(배열 안에 숫자·객체가 와도 통과하지 않는다)', () => {
    const r = checkManualSymbols([1, null, { s: 'NAS:AAAA' }]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.invalid).toHaveLength(3);
  });

  test('긴 쓰레기 입력은 32자로 잘려 응답에 들어간다(응답·로그가 부풀지 않게)', () => {
    const r = checkManualSymbols(['x'.repeat(500)]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.invalid[0]).toHaveLength(32);
  });

  test('배열이 아니면 not_array', () => {
    for (const v of [null, undefined, 'NAS:AAAA', 42, {}]) {
      expect(checkManualSymbols(v)).toEqual({ ok: false, reason: 'not_array', invalid: [] });
    }
  });

  test(`상한 ${MANUAL_LIST_MAX} 초과는 too_many — 붙여넣기 사고로 수만 줄이 들어오는 것을 막는다`, () => {
    const many = Array.from({ length: MANUAL_LIST_MAX + 1 }, () => 'NAS:AAAA');
    expect(checkManualSymbols(many)).toEqual({ ok: false, reason: 'too_many', invalid: [] });
    expect(checkManualSymbols(Array.from({ length: MANUAL_LIST_MAX }, () => 'NAS:AAAA')).ok).toBe(true);
  });

  test('🔴 상한은 **500** — 표 백스톱 `chk_rev_count CHECK (symbol_count <= 500)` 과 같은 수다 (T-146)', () => {
    // 전에는 150(앱 정책) 과 500(표 백스톱)이 **일부러** 달랐다. 2026-11-03 사용자 지시로 정책 상한을 없애고
    // 둘을 같은 수로 맞췄다 — 검사를 지우면 500 초과가 표의 CHECK(errno 3819)로 떨어져 깔끔한 400 이 사라진다.
    // 위의 상한 시험은 `MANUAL_LIST_MAX` **상대값**이라 수가 바뀌어도 통과한다 → 절대값은 여기서만 고정된다.
    // 이 수를 바꿀 때는 `scripts/migrations/T-143-overseas-universe.sql` 의 CHECK 도 같이 본다(그 반대도 같다).
    expect(MANUAL_LIST_MAX).toBe(500);
  });

  test('빈 배열은 통과한다(규칙 6 — 금지하지 않되 화면이 경고한다)', () => {
    expect(checkManualSymbols([])).toEqual({ ok: true, symbols: [], dropped: [] });
  });

  test('화면 파싱과 서버 재검사의 판정이 같다 — 같은 입력에서 통과 집합이 일치한다', () => {
    const text = ['NAS:AAAA', 'AAPL', 'nas:aggg', 'NAS:ABBB', 'NAS:AAAA'].join('\n');
    const client = parseManualList(text);
    const server = checkManualSymbols(client.good);
    expect(server.ok).toBe(true);
    if (!server.ok) throw new Error('unreachable');
    expect(server.symbols).toEqual(client.good);
    // 화면이 bad 를 걸러내지 않고 그대로 보냈다면 서버가 거부한다
    expect(checkManualSymbols([...client.good, ...client.bad]).ok).toBe(false);
  });
});
