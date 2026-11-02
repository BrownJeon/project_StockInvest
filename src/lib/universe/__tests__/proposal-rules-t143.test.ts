/**
 * T-143 WP-A — 변경 제안 규칙 A~F 와 멱등 지문 (사양 §8 · §12.3).
 *
 * 🔴 **「모름」을 「실패」로 보지 않는다**는 것이 이 표의 핵심이다. `kisOk` 가 null 일 때 제안을 만들면
 * 스냅샷 표를 한 번 못 읽은 날에 **멀쩡한 종목 100개를 빼라고** 권하게 된다.
 */
import { FINGERPRINT_MAX, buildProposals, fingerprint } from '../proposal-rules';
import { indexByCik, indexByTicker, parseSecExchangeResponse } from '../sec-listing';
import { toSecTicker } from '@/lib/data/us-edgar/parse';

const SEC = parseSecExchangeResponse({
  fields: ['cik', 'name', 'ticker', 'exchange'],
  data: [
    [1045810, 'NVIDIA CORP', 'NVDA', 'Nasdaq'],
    [1067983, 'BERKSHIRE HATHAWAY INC', 'BRK-B', 'NYSE'],
    [70858, 'BANK OF AMERICA CORP', 'BAC-PL', 'NYSE'],
    [1823000, 'Kensington Capital', 'KCAC-UN', 'NYSE'],
    [1276187, 'Energy Transfer LP', 'ET', 'TXSE'],
    [1006415, 'Cyanotech', 'CYATY', 'OTC'],
    [1823604, 'Intelligent Bio', 'INBT', null],
    [1067983, 'BERKSHIRE HATHAWAY INC', 'BRK-A', 'NYSE'],
    [927971, 'BANK OF MONTREAL', 'FNGD', 'NYSE'],
    [104169, 'Walmart Inc.', 'WMT', 'Nasdaq'],
    [1326801, 'Meta Platforms, Inc.', 'META', 'Nasdaq'],
    [320193, 'Apple Inc.', 'AAPL', 'Nasdaq'],
  ],
}).rows;

function build(args: {
  manual: string[];
  kisOk?: Record<string, boolean>;
  cik?: Record<string, number>;
  sha?: string;
}) {
  return buildProposals({
    manual: args.manual,
    secByTicker: indexByTicker(SEC),
    secByCik: indexByCik(SEC),
    cikOf: (s) => args.cik?.[s] ?? null,
    secTickerOf: toSecTicker,
    kisOk: (s) => (args.kisOk && s in args.kisOk ? args.kisOk[s] : null),
    secShaPrefix: args.sha ?? '76b92fba',
  });
}

describe('사양 §12.3 — 수동 목록 4종목에 규칙을 적용한 결과', () => {
  const drafts = build({
    manual: ['NYS:WMT', 'NYS:BRK.B', 'NAS:AAPL', 'NYS:GONE'],
    kisOk: { 'NYS:BRK.B': false, 'NYS:GONE': false, 'NYS:WMT': true, 'NAS:AAPL': true },
  });

  it('WMT → 거래소 이동(recode NAS:WMT) · BRK.B → KIS 조회 불가(remove) · GONE → 상장폐지(remove) · AAPL 없음', () => {
    expect(drafts.map((d) => [d.symbol, d.kind, d.actionType, d.nextSymbol])).toEqual([
      ['NYS:WMT', 'exchange_move', 'recode', 'NAS:WMT'],
      ['NYS:BRK.B', 'kis_unavailable', 'remove', null],
      ['NYS:GONE', 'delisting', 'remove', null],
    ]);
  });

  it('지문 3개가 정해진 문자열과 같다(월·일자·run_id 가 들어 있지 않다)', () => {
    expect(drafts.map((d) => d.basisFingerprint)).toEqual([
      'listing|NYS:WMT|exchange_move|sec_exchange=Nasdaq',
      'listing|NYS:BRK.B|kis_unavailable|kis_missing',
      'listing|NYS:GONE|delisting|sec_missing;kis_missing',
    ]);
  });

  it('근거 문장에 SEC 파일 해시 앞 8자가 붙는다(어느 파일로 판정했는지 남는다)', () => {
    for (const d of drafts) expect(d.basisText).toContain('(SEC 76b92fba)');
    expect(drafts[0].basisText).toBe('SEC 상장 목록: exchange=Nasdaq (SEC 76b92fba)');
  });

  it('원천은 전부 listing 이다(`WatchSourceId` 에 kis 가 없다 — W-6)', () => {
    for (const d of drafts) expect(d.basisSource).toBe('listing');
  });

  it('KIS 조회 불가에는 권고 문장이 붙는다(표기 문제일 수 있어 「빼기」로 단정하지 않는다)', () => {
    expect(drafts[1].recommendation).toBe('표기 확인(클래스주 . 표기 등) 또는 빼기');
    // 코드 바꾸기·빼기는 화면이 action.label 을 쓴다
    expect([drafts[0].recommendation, drafts[2].recommendation]).toEqual([null, null]);
  });
});

describe('규칙 B — KIS 미지원 거래소', () => {
  it('OTC·TXSE·null 로 보이면 otc_move / remove 다(거래 자체가 불가능하다)', () => {
    const d = build({ manual: ['NYS:CYATY', 'NYS:ET', 'NYS:INBT'] });
    expect(d.map((x) => [x.symbol, x.kind, x.actionType])).toEqual([
      ['NYS:CYATY', 'otc_move', 'remove'],
      ['NYS:ET', 'otc_move', 'remove'],
      ['NYS:INBT', 'otc_move', 'remove'],
    ]);
    expect(d.map((x) => x.basisFingerprint)).toEqual([
      'listing|NYS:CYATY|otc_move|sec_exchange=OTC',
      'listing|NYS:ET|otc_move|sec_exchange=TXSE',
      'listing|NYS:INBT|otc_move|sec_exchange=null',
    ]);
  });

  it('🔴 B 는 KIS 조회 상태와 무관하다 — 거래 불가 거래소는 조회가 되더라도 빼야 한다', () => {
    expect(build({ manual: ['NYS:CYATY'], kisOk: { 'NYS:CYATY': true } })).toHaveLength(1);
  });
});

describe('규칙 C — 코드 변경(같은 CIK, 다른 티커)', () => {
  it('CIK 매핑이 있으면 새 티커로 recode 를 제안한다', () => {
    const d = build({ manual: ['NAS:FB'], cik: { 'NAS:FB': 1326801 }, kisOk: { 'NAS:FB': false } });
    expect(d.map((x) => [x.kind, x.nextSymbol, x.basisFingerprint])).toEqual([
      ['ticker_change', 'NAS:META', 'listing|NAS:FB|ticker_change|cik=1326801;new=META'],
    ]);
  });

  it('🔴 CIK 매핑이 없으면 C 를 만들지 않는다 — 추측으로 코드를 바꾸라고 하지 않는다', () => {
    expect(build({ manual: ['NAS:FB'], kisOk: { 'NAS:FB': false } })).toEqual([
      expect.objectContaining({ kind: 'delisting' }),
    ]);
  });

  it('같은 CIK 에 거래 가능한 티커가 둘 이상이면 만들지 않는다(어느 쪽인지 모른다)', () => {
    const d = build({ manual: ['NYS:BRKX'], cik: { 'NYS:BRKX': 1067983 }, kisOk: { 'NYS:BRKX': false } });
    // BRK-B·BRK-A 둘 다 NYSE → 애매하므로 C 는 없고 D(상장폐지)로 간다
    expect(d.map((x) => x.kind)).toEqual(['delisting']);
  });
});

describe('🔴 「모름」은 제안을 만들지 않는다 (규칙 F)', () => {
  it('SEC 에 있고 거래소도 맞는데 KIS 상태를 모르면 제안 0건', () => {
    expect(build({ manual: ['NYS:BRK.B'] })).toEqual([]);
  });

  it('SEC 에 없고 KIS 상태도 모르면 제안 0건(파일 지연일 수 있다)', () => {
    expect(build({ manual: ['NYS:GONE'] })).toEqual([]);
  });

  it('SEC 에 있고 거래소도 맞고 KIS 도 정상이면 제안 0건', () => {
    expect(build({ manual: ['NYS:BRK.B'], kisOk: { 'NYS:BRK.B': true } })).toEqual([]);
  });

  it('같은 티커가 두 거래소에 중복 등재면 제안하지 않는다(어느 쪽이 맞는지 모른다)', () => {
    const dup = parseSecExchangeResponse({
      fields: ['cik', 'name', 'ticker', 'exchange'],
      data: [[1, 'A', 'XX', 'NYSE'], [2, 'B', 'XX', 'Nasdaq']],
    }).rows;
    const d = buildProposals({
      manual: ['NYS:XX'], secByTicker: indexByTicker(dup), secByCik: indexByCik(dup),
      cikOf: () => null, secTickerOf: toSecTicker, kisOk: () => false, secShaPrefix: 'aa',
    });
    expect(d).toEqual([]);
  });
});

describe('목표 상태가 이미 반영돼 있으면 만들지 않는다 (§8.1)', () => {
  it('수동 목록에 NAS:WMT 가 이미 있으면 NYS:WMT 의 recode 를 만들지 않는다', () => {
    const d = build({ manual: ['NYS:WMT', 'NAS:WMT'] });
    expect(d).toEqual([]);
  });

  it('코드 변경의 목표가 이미 목록에 있으면 만들지 않는다', () => {
    const d = build({ manual: ['NAS:FB', 'NAS:META'], cik: { 'NAS:FB': 1326801 }, kisOk: { 'NAS:FB': false } });
    expect(d).toEqual([]);
  });
});

describe('대상 밖·입력 방어', () => {
  it('국내 종목(6자리)·빈 값은 건너뛴다', () => {
    expect(build({ manual: ['005930', '', 'garbage'] })).toEqual([]);
  });

  it('수동 목록이 비면 제안도 없다', () => {
    expect(build({ manual: [] })).toEqual([]);
  });

  it('입력 순서를 보존한다', () => {
    const d = build({
      manual: ['NYS:GONE', 'NYS:WMT'],
      kisOk: { 'NYS:GONE': false, 'NYS:WMT': false },
    });
    expect(d.map((x) => x.symbol)).toEqual(['NYS:GONE', 'NYS:WMT']);
  });
});

describe('지문 — 멱등의 근거', () => {
  it('같은 관측 사실이면 같은 지문이다(달이 바뀌어도)', () => {
    expect(fingerprint('NYS:WMT', 'exchange_move', 'sec_exchange=Nasdaq'))
      .toBe(fingerprint('NYS:WMT', 'exchange_move', 'sec_exchange=Nasdaq'));
  });

  it('사실이 바뀌면 지문이 달라진다 — 그때는 다시 올라와야 한다', () => {
    expect(fingerprint('NYS:X', 'otc_move', 'sec_exchange=Nasdaq'))
      .not.toBe(fingerprint('NYS:X', 'otc_move', 'sec_exchange=OTC'));
  });

  it('190자를 넘기지 않고 구분자·비 ASCII 를 흘리지 않는다(UNIQUE 인덱스 안전)', () => {
    const fp = fingerprint('NYS:X', 'delisting', `${'가'.repeat(100)}|${'z'.repeat(300)}`);
    expect(fp.length).toBeLessThanOrEqual(FINGERPRINT_MAX);
    expect(fp.slice('listing|NYS:X|delisting|'.length)).not.toContain('|');
    expect(fp).toMatch(/^[\x20-\x7E]+$/);
  });

  it('근거 문장은 255자 안으로 자른다', () => {
    const long = 'x'.repeat(400);
    const d = buildProposals({
      manual: ['NYS:AAA'],
      secByTicker: indexByTicker(parseSecExchangeResponse({
        fields: ['cik', 'name', 'ticker', 'exchange'], data: [[1, long, 'AAA', 'OTC']],
      }).rows),
      secByCik: new Map(), cikOf: () => null, secTickerOf: toSecTicker, kisOk: () => false,
      secShaPrefix: long,
    });
    expect(d[0].basisText.length).toBeLessThanOrEqual(255);
  });
});
