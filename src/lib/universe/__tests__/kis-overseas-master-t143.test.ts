/**
 * T-143 WP-A — KIS 해외 종목 마스터 판독 (사양 §2.3 · §12.1-1 선행 확인).
 *
 * 🔴 **`etyp` 가 공백 3칸이라는 사실의 회귀망**: 2026-11-01 실측 `NYSMST.COD` 2,841행에서 보통주 2,462건의
 * `etyp` 는 빈 문자열이 아니라 **공백 3칸**이다. `trim()` 을 빼면 보통주 전체가 ETP 로 제외되고 **상위 50 이
 * 통째로 비어** `insufficient_candidates` 로 끝난다. 그래서 공백 입력을 명시적으로 고정한다.
 *
 * 🔴 **클래스주는 슬래시**(`BRK/B`)라는 사실도 여기서 고정한다 — 그 표기를 모르면 NYSE 시총 상위 종목이
 * 조용히 빠진다(2026-10-21~11-01 운영에서 11일 연속 실패했다).
 */
import iconv from 'iconv-lite';
import {
  OVERSEAS_MASTER_COLUMNS, OverseasMasterError, classifyByMaster, indexMaster, parseOverseasMaster,
} from '../kis-overseas-master';
import { kisSymbolCandidates } from '../sec-listing';

/** 24열 한 줄 만들기 — 쓰는 열만 채우고 나머지는 자리만 메운다. */
function row(o: {
  symb: string; rsym?: string; excd?: string; enam?: string; stis?: string; isdr?: string; etyp?: string;
}): string {
  const c = new Array(OVERSEAS_MASTER_COLUMNS).fill('');
  c[0] = 'US';
  c[1] = '21';
  c[2] = o.excd ?? 'NYS';
  c[3] = '뉴욕';
  c[4] = o.symb;
  c[5] = o.rsym ?? `NYS${o.symb}`;
  c[6] = '한글명';
  c[7] = o.enam ?? 'ENGLISH NAME';
  c[8] = o.stis ?? '2';
  c[9] = 'USD';
  c[17] = o.isdr ?? 'N';
  // 🔴 실측 기본값은 **공백 3칸**이다(빈 문자열이 아니다)
  c[22] = o.etyp ?? '   ';
  return c.join('\t');
}

function buf(lines: string[]): Buffer {
  return iconv.encode(`${lines.join('\n')}\n`, 'cp949');
}

describe('판독 — 탭 구분 · cp949 · 24열', () => {
  it('실측 모양 그대로 읽는다(한글 종목명이 깨지지 않는다)', () => {
    const p = parseOverseasMaster(buf([
      row({ symb: 'BRK/A', rsym: 'NYSBRK/A', enam: 'BERKSHIRE HATHAWAY INC' }),
      row({ symb: 'BRK/B', rsym: 'NYSBRK/B', enam: 'BERKSHIRE HATHAWAY INC' }),
    ]));
    expect(p.dropped).toBe(0);
    expect(p.entries).toEqual([
      { symb: 'BRK/A', rsym: 'NYSBRK/A', excd: 'NYS', enam: 'BERKSHIRE HATHAWAY INC', stis: '2', isdr: 'N', etyp: '' },
      { symb: 'BRK/B', rsym: 'NYSBRK/B', excd: 'NYS', enam: 'BERKSHIRE HATHAWAY INC', stis: '2', isdr: 'N', etyp: '' },
    ]);
  });

  it('🔴 `etyp` 공백 3칸은 「ETP 아님」이다 — trim 이 없으면 보통주가 전부 제외된다', () => {
    const p = parseOverseasMaster(buf([row({ symb: 'AAA', etyp: '   ' }), row({ symb: 'BBB', etyp: '001' })]));
    expect(p.entries.map((e) => e.etyp)).toEqual(['', '001']);
  });

  it('열 수가 24가 아닌 줄은 버리고 센다', () => {
    const p = parseOverseasMaster(buf([row({ symb: 'AAA' }), 'a\tb\tc', row({ symb: 'BBB' }), '']));
    expect([p.entries.length, p.dropped]).toEqual([2, 1]);
  });

  it('버린 줄이 읽은 줄보다 많으면 던진다 — 형식이 바뀐 파일로 상위 50 을 만들지 않는다', () => {
    expect(() => parseOverseasMaster(buf([row({ symb: 'AAA' }), 'x', 'y', 'z']))).toThrow(OverseasMasterError);
  });

  it('쓸 수 있는 행이 0건이면 던진다', () => {
    expect(() => parseOverseasMaster(buf([''])), ).toThrow(OverseasMasterError);
    expect(() => parseOverseasMaster(Buffer.alloc(0))).toThrow(OverseasMasterError);
  });

  it('CRLF 도 읽는다 · symb 는 대문자로 정리한다', () => {
    const text = `${row({ symb: 'aaa' })}\r\n${row({ symb: 'BBB' })}\r\n`;
    const p = parseOverseasMaster(iconv.encode(text, 'cp949'));
    expect(p.entries.map((e) => e.symb)).toEqual(['AAA', 'BBB']);
  });
});

describe('색인·분류', () => {
  const master = indexMaster(parseOverseasMaster(buf([
    row({ symb: 'BRK/B' }),
    row({ symb: 'AAPL' }),
    row({ symb: 'FNGD', stis: '3', etyp: '002' }),   // ETN
    row({ symb: 'SPY', stis: '3', etyp: '001' }),    // ETF
    row({ symb: 'IDX', stis: '1' }),                 // 지수
    row({ symb: 'TSM', isdr: 'Y' }),                 // DR
  ])), 'f'.repeat(64));

  it('🔴 클래스주는 슬래시 표기로 찾힌다 — 내부 점 표기로는 못 찾는다', () => {
    expect(classifyByMaster(master, kisSymbolCandidates('BRK-B'))).toEqual({
      kind: 'ready', entry: expect.objectContaining({ symb: 'BRK/B' }),
    });
    expect(classifyByMaster(master, ['BRK.B']).kind).toBe('master_missing');
    expect(classifyByMaster(master, ['BRK-B']).kind).toBe('master_missing');
  });

  it('보통주는 ready', () => {
    expect(classifyByMaster(master, ['AAPL']).kind).toBe('ready');
  });

  it('종류 판정이 먼저다 — 지수·ETP·워런트는 `stis` 값과 함께 master_type 으로 빠진다', () => {
    // 사양 §3.3 의 순서(stis → isdr → etyp)를 그대로 따른다. 2026-11-01 실측에서 `stis=3`(379건)과
    // 「`etyp` 가 비어 있지 않음」(379건)은 **같은 집합**이라 ETP 는 언제나 이쪽으로 먼저 빠진다.
    // `entry` 를 함께 준다 — 제외된 행도 마스터 값(특히 `enam`)을 남겨 1회차 사람 검토가 SELECT 로 되게(r2 ①)
    expect(classifyByMaster(master, ['IDX'])).toMatchObject({ kind: 'master_type', value: '1' });
    expect(classifyByMaster(master, ['FNGD'])).toMatchObject({
      kind: 'master_type', value: '3', entry: expect.objectContaining({ symb: 'FNGD', enam: 'ENGLISH NAME' }),
    });
    expect(classifyByMaster(master, ['SPY'])).toMatchObject({ kind: 'master_type', value: '3' });
  });

  it('master_etp 는 「주식인데 ETP 분류가 붙은」 경우의 뒷문이다 — 지금 파일에는 그런 행이 없다', () => {
    // 두 열이 어긋나는 행이 생기면(마스터 지연·분류 변경) 이쪽이 받는다. 받지 못하면 ETF 가 보통주로 스캔된다
    const m = indexMaster(parseOverseasMaster(buf([row({ symb: 'ODD', stis: '2', etyp: '001' })])), 'b'.repeat(64));
    expect(classifyByMaster(m, ['ODD'])).toMatchObject({ kind: 'master_etp', value: '001' });
  });

  it('`stis` 가 비어 있으면 주식으로 보지 않는다(모르면 넣지 않는다)', () => {
    const m = indexMaster(parseOverseasMaster(buf([row({ symb: 'BLANK', stis: '' })])), 'c'.repeat(64));
    expect(classifyByMaster(m, ['BLANK'])).toMatchObject({ kind: 'master_type', value: '(빈값)' });
  });

  it('🔴 DR 은 여기서 빼지 않는다 — 가상 순위를 알아야 하므로 스캔한 뒤 finalize 가 뺀다(L-A2)', () => {
    const v = classifyByMaster(master, ['TSM']);
    expect(v.kind).toBe('ready');
    expect(v.kind === 'ready' && v.entry.isdr).toBe('Y');
  });

  it('마스터에 없으면 master_missing(KIS 미취급)', () => {
    expect(classifyByMaster(master, ['NOPE'])).toEqual({ kind: 'master_missing' });
  });

  it('같은 표기가 두 번 나오면 먼저 나온 행을 쓴다', () => {
    const m = indexMaster(parseOverseasMaster(buf([
      row({ symb: 'DUP', enam: 'FIRST' }), row({ symb: 'DUP', enam: 'SECOND' }),
    ])), 'a'.repeat(64));
    expect(m.bySymb.get('DUP')?.enam).toBe('FIRST');
    expect(m.rows).toBe(2);
  });
});
