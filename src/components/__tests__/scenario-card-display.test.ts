/**
 * T-062 WP-U — 시나리오 카드 표시 판정 순수 함수 시험 (가이드 G3·G4·G6 표).
 * 승인 데모: mockups/T-062-post-market-overseas-v2.html (사용자 "v2승인" 2026-10-21).
 */
import {
  parseIndicators, scenarioOf, gradeOf, confidenceOf, isOverseasSignal, sortScenarioCards,
  fmtKrw, fmtApproxKrw, usdZoneOf, usdZoneText, krwZoneText, overseasZoneView,
  sessionLine, fxView, detailZoneAux, earningsLine, overseasFootnote,
  type CardGrade,
} from '@/components/scenario-card-display';
import { T062_FIXTURE, T062_TOMORROW, T062_SCENE4, CMCSA_INDICATORS, cmcsaWithoutUsd } from './fixtures/t062-signals-fixture';
import { useForeignHost } from './fixtures/host-sim';

// R-5: 이 파일 전체를 "KST·ko-KR 이 아닌 호스트"(로컬 시각 = UTC, 기본 로케일 = de-DE) 흉내 아래에서 돌린다.
// 구현이 로컬 시각·기본 로케일에 기대면 실행 머신과 무관하게 여기서 실패한다(host-sim.ts 머리 주석).
useForeignHost();

describe('R-5 호스트 흉내가 실제로 켜져 있다 (전제 확인)', () => {
  test('기본 로케일 숫자 서식 = de-DE, 로컬 시각 = UTC', () => {
    expect((100000).toLocaleString()).toBe('100.000');
    expect(new Date('2026-10-21T13:30:00Z').getHours()).toBe(13);
    expect(new Date('2026-10-21T20:00:00Z').getDay()).toBe(3); // UTC 수요일 (KST 로는 목요일)
  });
  test('그래도 금액·환율·구간 서식은 쉼표(ko-KR)', () => {
    expect(fmtApproxKrw('100000.00')).toBe('약 100,000원');
    expect(krwZoneText(CMCSA_INDICATORS)).toBe('36,176 ~ 36,708원');
    expect(fxView(CMCSA_INDICATORS)).toBe('시그널 환율 1,330 (10-21 08:00)');
  });
});

type R = { id: number; grade: CardGrade | null; conf: number | null; side?: string };
const ids = (rows: R[]) => rows.map(r => r.id);
const pick = (r: R) => ({ grade: r.grade, confidence: r.conf });

// ─── G3 sortScenarioCards ───────────────────────────────────────────────────
describe('G3 sortScenarioCards — 평가등급순', () => {
  test('(1) 등급 순 A > B+ > B', () => {
    expect(ids(sortScenarioCards<R>([{ id: 1, grade: 'B', conf: 66 }, { id: 2, grade: 'A', conf: 82 }, { id: 3, grade: 'B+', conf: 74 }], pick))).toEqual([2, 3, 1]);
  });
  test('(2) 같은 등급은 신뢰도 높은 순', () => {
    expect(ids(sortScenarioCards<R>([{ id: 1, grade: 'A', conf: 81 }, { id: 2, grade: 'A', conf: 82 }], pick))).toEqual([2, 1]);
  });
  test('(3) 같은 등급·같은 신뢰도 → 입력(서버 최신순) 순서 유지', () => {
    expect(ids(sortScenarioCards<R>([{ id: 1, grade: 'B+', conf: 74 }, { id: 2, grade: 'B+', conf: 74 }], pick))).toEqual([1, 2]);
  });
  test('(4) 신뢰도 없음은 같은 등급 맨 뒤', () => {
    expect(ids(sortScenarioCards<R>([{ id: 1, grade: 'B+', conf: null }, { id: 2, grade: 'B+', conf: 70 }], pick))).toEqual([2, 1]);
  });
  test('(5) 등급 없음은 맨 아래 (신뢰도가 높아도)', () => {
    expect(ids(sortScenarioCards<R>([{ id: 1, grade: null, conf: 95 }, { id: 2, grade: 'C', conf: 10 }], pick))).toEqual([2, 1]);
  });
  test('(6) 등급 이상값 D · "" · a · undefined → 등급 없음 취급', () => {
    const raw = ['D', '', 'a', undefined];
    for (const g of raw) {
      const ind = { ai: { scenario: { grade: g } } };
      expect(gradeOf(ind)).toBeNull();
    }
    const rows = [
      { id: 1, ind: { ai: { confidence: 99, scenario: { grade: 'D' } } } },
      { id: 2, ind: { ai: { confidence: 10, scenario: { grade: 'C' } } } },
    ];
    expect(sortScenarioCards(rows, r => ({ grade: gradeOf(r.ind), confidence: confidenceOf(r.ind) })).map(r => r.id)).toEqual([2, 1]);
  });
  test('(7) 국내·해외 혼합 v2 재현 (fixture, indicators 문자열 섞임)', () => {
    const sorted = sortScenarioCards(T062_FIXTURE, s => ({ grade: gradeOf(s.indicators), confidence: confidenceOf(s.indicators) }));
    expect(sorted.map(s => s.symbol)).toEqual(['NYS:BAC', '005930', 'NAS:CMCSA', '066570', 'NAS:NFLX', '035720', 'NAS:PFE']);
  });
  test('(7-b) "내일" 탭 (post-market 만) — PFE 없음', () => {
    const sorted = sortScenarioCards(T062_TOMORROW, s => ({ grade: gradeOf(s.indicators), confidence: confidenceOf(s.indicators) }));
    expect(sorted.map(s => s.symbol)).toEqual(['NYS:BAC', '005930', 'NAS:CMCSA', '066570', 'NAS:NFLX', '035720']);
  });
  test('(8) 매도 시그널도 같은 규칙 (매수/매도 구분 안 함)', () => {
    expect(ids(sortScenarioCards<R>([{ id: 1, side: 'sell', grade: 'A', conf: 60 }, { id: 2, side: 'buy', grade: 'B', conf: 90 }], pick))).toEqual([1, 2]);
  });
  test('(9) 빈 배열 → 빈 배열, 입력 배열 불변', () => {
    expect(sortScenarioCards<R>([], pick)).toEqual([]);
    const input: R[] = [{ id: 1, grade: 'B', conf: 1 }, { id: 2, grade: 'A', conf: 1 }];
    const snapshot = JSON.stringify(input);
    const out = sortScenarioCards(input, pick);
    expect(out).not.toBe(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(ids(out)).toEqual([2, 1]);
  });
  test('(9-b) 큰 동률 집합도 입력 순서 유지 (안정성을 인덱스로 보장)', () => {
    const rows: R[] = Array.from({ length: 50 }, (_, i) => ({ id: i, grade: 'B', conf: 70 }));
    expect(ids(sortScenarioCards(rows, pick))).toEqual(rows.map(r => r.id));
  });
});

// ─── G3 parseIndicators / gradeOf / confidenceOf ───────────────────────────
describe('G3 parseIndicators · gradeOf · confidenceOf', () => {
  test('(10) parseIndicators: 객체·JSON 문자열·깨진 문자열·null·숫자', () => {
    const obj = { a: 1 };
    expect(parseIndicators(obj)).toBe(obj);
    expect(parseIndicators('{"a":1}')).toEqual({ a: 1 });
    expect(parseIndicators('{')).toBeNull();
    expect(parseIndicators(null)).toBeNull();
    expect(parseIndicators(undefined)).toBeNull();
    expect(parseIndicators(5)).toBeNull();
    expect(parseIndicators('[1,2]')).toBeNull();
    expect(parseIndicators([1])).toBeNull();
    expect(parseIndicators('null')).toBeNull();
  });
  test('(11) gradeOf/confidenceOf: 문자열 indicators 를 거쳐도 같은 결과', () => {
    const s = JSON.stringify(CMCSA_INDICATORS);
    expect(gradeOf(s)).toBe('B+');
    expect(gradeOf(CMCSA_INDICATORS)).toBe('B+');
    expect(confidenceOf(s)).toBe(74);
    expect(confidenceOf(CMCSA_INDICATORS)).toBe(74);
    expect(scenarioOf(s)?.entry?.price_zone).toBe('36176~36708');
  });
  test('(11-b) confidence "74" · NaN · -1 · 101 · Infinity → null, 0·100 은 통과', () => {
    for (const c of ['74', NaN, -1, 101, Infinity, null]) {
      expect(confidenceOf({ ai: { confidence: c } })).toBeNull();
    }
    expect(confidenceOf({ ai: { confidence: 0 } })).toBe(0);
    expect(confidenceOf({ ai: { confidence: 100 } })).toBe(100);
  });
  test('gradeOf: 네 값만 통과 (b+ 소문자·hasOwnProperty 류 키 이름 거부)', () => {
    for (const g of ['A', 'B+', 'B', 'C'] as const) expect(gradeOf({ ai: { scenario: { grade: g } } })).toBe(g);
    for (const g of ['b+', 'A+', 'constructor', 'toString', 4]) expect(gradeOf({ ai: { scenario: { grade: g } } })).toBeNull();
    expect(gradeOf({ ai: { scenario: 'A' } })).toBeNull();
  });
  test('isOverseasSignal: market 우선, 없을 때만 심볼 형식', () => {
    expect(isOverseasSignal({ market: 'overseas', symbol: '005930' })).toBe(true);
    expect(isOverseasSignal({ market: 'domestic', symbol: 'NAS:AAPL' })).toBe(false);
    expect(isOverseasSignal({ market: null, symbol: 'NAS:AAPL' })).toBe(true);
    expect(isOverseasSignal({ symbol: 'NAS:AAPL' })).toBe(true);
    expect(isOverseasSignal({ symbol: '005930' })).toBe(false);
  });
});

// ─── G4 fmtApproxKrw (T-063) ────────────────────────────────────────────────
describe('G4 fmtApproxKrw — "약 100,000원"', () => {
  test.each<[unknown, string | null]>([
    ['100000.00', '약 100,000원'],
    [100000, '약 100,000원'],
    ['1234567.89', '약 1,234,568원'],
    ['1234567.49', '약 1,234,567원'],
    [' 100000.00 ', '약 100,000원'],
    [null, null],
    [undefined, null],
    ['', null],
    ['abc', null],
    [0, null],
    ['0.00', null],
    [-5, null],
    ['1e5', '약 100,000원'],
    [NaN, null],
    [Infinity, null],
    [true, null],
  ])('%p → %p', (raw, want) => {
    expect(fmtApproxKrw(raw)).toBe(want);
  });
  test('fmtKrw 는 "약" 없이', () => {
    expect(fmtKrw('100000.00')).toBe('100,000원');
    expect(fmtKrw(null)).toBeNull();
  });
});

// ─── G6 진입 구간 · 환율 · 정규장 · 실적 ────────────────────────────────────
describe('G6 overseasZoneView · usdZoneText · krwZoneText · detailZoneAux', () => {
  test('정상: 달러 주표기 + 원화(쉼표·원)', () => {
    expect(overseasZoneView(JSON.stringify(CMCSA_INDICATORS))).toEqual({ usd: '$27.20 ~ $27.60', krw: '36,176 ~ 36,708원' });
    expect(detailZoneAux(CMCSA_INDICATORS)).toBe('≈ 36,176 ~ 36,708원 · 시그널 환율 1,330 (10-21 08:00) · 자동 진입은 이 원화 구간으로 판단');
  });
  test('price_zone_usd 없음(Q-g) → 원화 폴백, 보조 줄 없음', () => {
    const ind = cmcsaWithoutUsd().indicators;
    expect(overseasZoneView(ind)).toEqual({ usd: null, krw: '36,176 ~ 36,708원' });
    expect(detailZoneAux(ind)).toBeNull();
  });
  test('둘 다 없음 → null (줄 미표시)', () => {
    expect(overseasZoneView({ ai: { scenario: {} } })).toBeNull();
    expect(overseasZoneView(null)).toBeNull();
  });
  test('달러만 있고 원화 구간 없음 → 보조 줄은 환율 문구만', () => {
    const ind = { price_zone_usd: { lo: 1, hi: 2 }, fx: { rate: 1330 } };
    expect(overseasZoneView(ind)).toEqual({ usd: '$1.00 ~ $2.00', krw: null });
    expect(detailZoneAux(ind)).toBe('시그널 환율 1,330');
    expect(detailZoneAux({ price_zone_usd: { lo: 1, hi: 2 } })).toBeNull();
  });
  test.each<[unknown]>([
    [{ lo: 0, hi: 2 }], [{ lo: -1, hi: 2 }], [{ lo: 3, hi: 2 }], [{ lo: '27.2', hi: 27.6 }],
    [{ lo: NaN, hi: 1 }], [{ lo: 1 }], ['27.2~27.6'], [null], [[27.2, 27.6]],
  ])('usdZoneOf 형식 오류 %p → null', (z) => {
    expect(usdZoneOf({ price_zone_usd: z })).toBeNull();
    expect(usdZoneText({ price_zone_usd: z })).toBeNull();
  });
  test('usdZoneOf lo === hi 허용', () => {
    expect(usdZoneText({ price_zone_usd: { lo: 27.2, hi: 27.2 } })).toBe('$27.20 ~ $27.20');
  });
  test.each<[unknown, string | null]>([
    ['36176~36708', '36,176 ~ 36,708원'],
    [' 36176 ~ 36708 ', '36,176 ~ 36,708원'],
    ['36176.4~36708.6', '36,176 ~ 36,709원'],
    ['0~0', null],
    ['abc', null],
    ['1~2~3', null],
    ['~36708', null],
    [36176, null],
    [undefined, null],
  ])('krwZoneText %p → %p', (zone, want) => {
    expect(krwZoneText({ ai: { scenario: { entry: { price_zone: zone } } } })).toBe(want);
  });
});

// T-108 §3.2 — 시그널 뜻의 「카드」를 「시그널」로 정정(카드 환율·카드 금액·미국 카드는 → 시그널 …). 이 파일은 기대 문구만 갱신, 시험 논리 불변.
describe('G6 fxView', () => {
  test('rate + asOf → "시그널 환율 1,330 (10-21 08:00)"', () => {
    expect(fxView(CMCSA_INDICATORS)).toBe('시그널 환율 1,330 (10-21 08:00)');
  });
  test('asOf UTC 표기도 KST 로', () => {
    expect(fxView({ fx: { rate: 1330.456, asOf: '2026-10-20T23:00:00Z' } })).toBe('시그널 환율 1,330.46 (10-21 08:00)');
  });
  test('asOf 없음·Invalid → 괄호 생략, rate 없음·0·문자열 → null', () => {
    expect(fxView({ fx: { rate: 1330 } })).toBe('시그널 환율 1,330');
    expect(fxView({ fx: { rate: 1330, asOf: 'nope' } })).toBe('시그널 환율 1,330');
    expect(fxView({ fx: { asOf: '2026-10-21T08:00:00+09:00' } })).toBeNull();
    expect(fxView({ fx: { rate: 0 } })).toBeNull();
    expect(fxView({ fx: { rate: '1330' } })).toBeNull();
    expect(fxView({})).toBeNull();
  });
});

describe('G6 sessionLine — 미국 정규장 KST (실행 환경 TZ 무관)', () => {
  test('EDT(서머타임): 09:30~16:00 ET = 22:30 ~ 다음 날 05:00 KST', () => {
    expect(sessionLine('2026-10-21T13:30:00.000Z', '2026-10-21T20:00:00.000Z')).toBe('미국 정규장 10-21(수) 22:30 ~ 10-22(목) 05:00 KST');
  });
  test('EST(서머타임 해제 뒤 11-03): 23:30 ~ 다음 날 06:00 KST', () => {
    expect(sessionLine('2026-11-03T14:30:00.000Z', '2026-11-03T21:00:00.000Z')).toBe('미국 정규장 11-03(화) 23:30 ~ 11-04(수) 06:00 KST');
  });
  test('금요일 장 → 토요일 새벽 끝 (요일 표기)', () => {
    expect(sessionLine('2026-10-23T13:30:00.000Z', '2026-10-23T20:00:00.000Z')).toBe('미국 정규장 10-23(금) 22:30 ~ 10-24(토) 05:00 KST');
  });
  test('Date 객체도 허용', () => {
    expect(sessionLine(new Date('2026-10-21T13:30:00Z'), new Date('2026-10-21T20:00:00Z'))).toBe('미국 정규장 10-21(수) 22:30 ~ 10-22(목) 05:00 KST');
  });
  test.each<[unknown, unknown]>([
    [null, '2026-10-21T20:00:00Z'], ['2026-10-21T13:30:00Z', null], ['', ''], ['x', '2026-10-21T20:00:00Z'],
    ['2026-10-21T20:00:00Z', '2026-10-21T13:30:00Z'], ['2026-10-21T13:30:00Z', '2026-10-21T13:30:00Z'], [undefined, undefined],
  ])('없음·Invalid·끝≤시작 (%p, %p) → null', (a, b) => {
    expect(sessionLine(a, b)).toBeNull();
  });
});

describe('G6 earningsLine', () => {
  test('estimated_window + window → 노랑 겹침', () => {
    expect(earningsLine(JSON.stringify(CMCSA_INDICATORS))).toEqual({ tone: 'warn', text: '실적 발표 추정 기간과 겹침 · 10-24 ~ 10-31', note: '(추정, 미확정)' });
  });
  test('none + nextConfirmed null/없음 → 회색 없음', () => {
    const want = { tone: 'muted', text: '실적 일정: 앞으로 5거래일 안 없음', note: '(추정치 기준 · 확정일 미입력)' };
    expect(earningsLine({ earnings: { status: 'none', nextConfirmed: null } })).toEqual(want);
    expect(earningsLine({ earnings: { status: 'none' } })).toEqual(want);
  });
  test('none + nextConfirmed 있음 → null (G11-① 줄 미표시)', () => {
    expect(earningsLine({ earnings: { status: 'none', nextConfirmed: '2026-11-06' } })).toBeNull();
  });
  test.each<[unknown]>([
    [{}], [{ earnings: null }], [{ earnings: 'none' }], [{ earnings: { status: 'confirmed_blackout' } }],
    [{ earnings: { status: 'unknown' } }], [{ earnings: { status: 'estimated_window' } }],
    [{ earnings: { status: 'estimated_window', window: { from: '10-24', to: '2026-10-31' } } }],
    [{ earnings: { status: 'estimated_window', window: { from: '2026-10-24' } } }],
  ])('키 없음·형식 오류·blackout %p → null', (ind) => {
    expect(earningsLine(ind)).toBeNull();
  });
});

describe('G7 overseasFootnote — "내일" 탭 하단 고정 문구', () => {
  test('해외 카드 1장 이상(장면 4) → 문구, 금액은 카드 amount_krw', () => {
    expect(overseasFootnote(T062_SCENE4)).toBe('미국 시그널은 매일 08:00 분석 · 1주 가격이 100,000원 이하인 종목만 만들어집니다(보유·관심 종목 중 비싼 종목은 나오지 않음).');
  });
  test('해외 0장 → null (스위치 꺼짐 상태와 같은 화면)', () => {
    expect(overseasFootnote(T062_FIXTURE.filter(r => r.market === 'domestic'))).toBeNull();
    expect(overseasFootnote([])).toBeNull();
  });
  test('해외 카드 금액 없음 → "시그널 금액"', () => {
    expect(overseasFootnote([{ market: 'overseas', symbol: 'NAS:CMCSA', amount_krw: null }]))
      .toContain('1주 가격이 시그널 금액 이하인 종목만');
  });
  test('국내 카드 금액은 쓰지 않는다', () => {
    expect(overseasFootnote([
      { market: 'domestic', symbol: '005930', amount_krw: '50000.00' },
      { market: 'overseas', symbol: 'NAS:CMCSA', amount_krw: '120000.00' },
    ])).toContain('1주 가격이 120,000원 이하인');
  });
});

describe('국내 카드 — 해외 전용 키가 없으므로 해외 줄 판정이 전부 null', () => {
  test.each(T062_FIXTURE.filter(r => r.market === 'domestic').map(r => [r.symbol, r] as const))('%s', (_sym, r) => {
    expect(usdZoneOf(r.indicators)).toBeNull();
    expect(fxView(r.indicators)).toBeNull();
    expect(earningsLine(r.indicators)).toBeNull();
    expect(detailZoneAux(r.indicators)).toBeNull();
  });
});
