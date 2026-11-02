/**
 * T-143 WP-A — SEC 상장 목록 판독·사전 필터 (사양 §1·§2·§12.3).
 *
 * 🔴 **접미사 규칙의 회귀망**: 이 정규식이 느슨해지면 우선주·워런트 수백 건이 KIS 스캔 대상에 들어오고(유량 낭비),
 * 조여지면 **보통주 클래스가 조용히 빠진다**(`BRK-B` 가 상위 50 에서 사라진다). 그래서 2026-11-01 운영 파일의
 * **하이픈 티커 530건 전부**를 fixture 로 두고 506/24 분할을 수치로 고정한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  CLASS_SUFFIX, NONCOMMON_SUFFIX, SEC_EXCHANGE_TO_EXCD, SecListingShapeError, excdForSecExchange,
  indexByCik, indexByTicker, internalSymbolFor, isNoncommonTicker, kisSymbolCandidates,
  noncommonSuffixOf, nyseRows, parseSecExchangeResponse,
} from '../sec-listing';
import { isOverseasSymbol } from '@/lib/exchanges/kis-symbols';

const FIXTURE = path.join(__dirname, 'fixtures', 't143-nyse-hyphen-tickers-20261101.txt');

/** 사양 §12.3 의 축소 fixture 10행. */
const SMALL = {
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
  ],
};

describe('응답 판독 — 열 이름으로 찾는다', () => {
  it('열 순서가 바뀌어도 같은 값을 읽는다(위치를 가정하지 않는다)', () => {
    const shuffled = {
      fields: ['exchange', 'ticker', 'cik', 'name'],
      data: [['NYSE', 'BRK-B', 1067983, 'BERKSHIRE HATHAWAY INC']],
    };
    expect(parseSecExchangeResponse(shuffled).rows).toEqual([
      { cik: 1067983, name: 'BERKSHIRE HATHAWAY INC', ticker: 'BRK-B', exchange: 'NYSE' },
    ]);
  });

  it('열이 하나라도 없으면 던진다 — 추측해서 읽지 않는다', () => {
    for (const fields of [['cik', 'name', 'ticker'], ['cik', 'name', 'exchange'], []]) {
      expect(() => parseSecExchangeResponse({ fields, data: [] })).toThrow(SecListingShapeError);
    }
  });

  it('본문 모양이 다르면 던진다', () => {
    for (const bad of [null, 'x', 42, {}, { fields: ['cik'] }, { data: [] }, { fields: 'x', data: [] }]) {
      expect(() => parseSecExchangeResponse(bad)).toThrow(SecListingShapeError);
    }
  });

  it('cik·ticker 를 못 읽은 **그 행만** 버리고 센다(전체를 실패시키지 않는다)', () => {
    const r = parseSecExchangeResponse({
      fields: ['cik', 'name', 'ticker', 'exchange'],
      data: [
        [1, 'A', 'AAA', 'NYSE'],
        'not-an-array',
        [0, 'B', 'BBB', 'NYSE'],          // cik 0
        [2, 'C', '', 'NYSE'],             // 빈 티커
        [-5, 'D', 'DDD', 'NYSE'],         // 음수 cik
        [3, null, 'eee', 'NYSE'],         // 이름 없음·소문자 티커 → 대문자로
      ],
    });
    expect(r.dropped).toBe(4);
    expect(r.rows).toEqual([
      { cik: 1, name: 'A', ticker: 'AAA', exchange: 'NYSE' },
      { cik: 3, name: null, ticker: 'EEE', exchange: 'NYSE' },
    ]);
  });

  it('exchange 는 원값 그대로 — null 과 빈 문자열 모두 null(제안 근거 문장에 그대로 싣는다)', () => {
    const r = parseSecExchangeResponse({
      fields: ['cik', 'name', 'ticker', 'exchange'],
      data: [[1, 'A', 'AAA', null], [2, 'B', 'BBB', '  '], [3, 'C', 'CCC', ' OTC ']],
    });
    expect(r.rows.map((x) => x.exchange)).toEqual([null, null, 'OTC']);
  });
});

describe('NYSE 판정은 정확 일치', () => {
  it('축소 fixture — NYSE 5건(Nasdaq·TXSE·OTC·null 은 아니다)', () => {
    const { rows } = parseSecExchangeResponse(SMALL);
    expect(rows).toHaveLength(10);
    expect(nyseRows(rows).map((r) => r.ticker)).toEqual(['BRK-B', 'BAC-PL', 'KCAC-UN', 'BRK-A', 'FNGD']);
  });

  it('비슷한 값은 NYSE 가 아니다 — 파일에 그런 값이 없고, 생기면 검토를 거쳐야 한다', () => {
    const { rows } = parseSecExchangeResponse({
      fields: ['cik', 'name', 'ticker', 'exchange'],
      data: [[1, 'A', 'AAA', 'NYSE American'], [2, 'B', 'BBB', 'NYSE Arca'], [3, 'C', 'CCC', 'nyse'], [4, 'D', 'DDD', 'NYSE']],
    });
    expect(nyseRows(rows).map((r) => r.ticker)).toEqual(['DDD']);
  });

  it('거래 가능한 거래소는 두 값뿐 — OTC·TXSE·CBOE·null 은 KIS 코드가 없다', () => {
    expect(SEC_EXCHANGE_TO_EXCD).toEqual({ Nasdaq: 'NAS', NYSE: 'NYS' });
    expect(excdForSecExchange('Nasdaq')).toBe('NAS');
    expect(excdForSecExchange('NYSE')).toBe('NYS');
    for (const v of ['OTC', 'TXSE', 'CBOE', 'NYSE Arca', '', null]) expect(excdForSecExchange(v)).toBeNull();
  });
});

describe('🔴 사전 제외 접미사 — 2026-11-01 운영 파일의 하이픈 티커 530건 전부', () => {
  const tickers = fs.readFileSync(FIXTURE, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);

  it('fixture 를 읽었다(빈 검사 방지)', () => {
    expect(tickers).toHaveLength(530);
  });

  it('506 은 비보통주로 빠지고 24 는 보통주 클래스로 남는다', () => {
    const dropped = tickers.filter((t) => isNoncommonTicker(t));
    const kept = tickers.filter((t) => !isNoncommonTicker(t));
    expect([dropped.length, kept.length]).toEqual([506, 24]);
    expect(kept.sort()).toEqual([
      'AGM-A', 'AKO-A', 'AKO-B', 'BF-A', 'BF-B', 'BH-A', 'BIO-B', 'BRK-A', 'BRK-B', 'CIG-C',
      'CRD-A', 'CRD-B', 'GEF-B', 'GTN-A', 'HEI-A', 'HVT-A', 'LEN-B', 'MKC-V', 'MOG-A', 'MOG-B',
      'PBR-A', 'TAP-A', 'UHAL-B', 'WSO-B',
    ]);
  });

  it('남은 24건은 전부 「영문 1~5자 + 하이픈 + 한 글자」 꼴이다', () => {
    for (const t of tickers.filter((x) => !isNoncommonTicker(x))) expect(CLASS_SUFFIX.test(t)).toBe(true);
  });

  it('빠진 506건의 접미사별 수 — 상위 분포가 사양 §1.3 과 같다', () => {
    const by: Record<string, number> = {};
    for (const t of tickers.filter((x) => isNoncommonTicker(x))) {
      by[noncommonSuffixOf(t)] = (by[noncommonSuffixOf(t)] ?? 0) + 1;
    }
    expect(by.PA).toBe(73);
    expect(by.WT).toBe(60);
    expect(by.UN).toBe(50);
    expect(by.PB).toBe(46);
    expect(by.RI).toBe(18);
    expect(Object.values(by).reduce((a, b) => a + b, 0)).toBe(506);
  });

  it('하이픈이 없는 티커는 건드리지 않는다', () => {
    for (const t of ['AAPL', 'NVDA', 'A', 'BRK', 'WT', 'UN', 'RI']) expect(isNoncommonTicker(t)).toBe(false);
  });

  it('규칙이 잡는 것·놓치는 것을 수치가 아니라 예로도 고정한다', () => {
    for (const t of ['BAC-PL', 'ABR-PD', 'AAC-WT', 'KCAC-UN', 'X-RI', 'Y-WI', 'Z-WS', 'Q-U', 'Q-R', 'Q-W', 'Q-P']) {
      expect(isNoncommonTicker(t)).toBe(true);
    }
    for (const t of ['BRK-B', 'MKC-V', 'AKO-A', 'CIG-C', 'GEF-B']) expect(isNoncommonTicker(t)).toBe(false);
    expect(NONCOMMON_SUFFIX.source).toContain('WT[A-Z]?');
  });
});

describe('심볼 변환', () => {
  it('SEC 하이픈 → 내부 점 표기이고, 내부 규약(kis-symbols)을 통과한다', () => {
    expect(internalSymbolFor('NYS', 'BRK-B')).toBe('NYS:BRK.B');
    expect(internalSymbolFor('NAS', 'aapl')).toBe('NAS:AAPL');
    for (const t of ['BRK-B', 'AKO-A', 'MKC-V', 'AAPL']) {
      expect(isOverseasSymbol(internalSymbolFor('NYS', t))).toBe(true);
    }
  });

  it('KIS 표기 후보는 원본·슬래시·점 셋이고 중복을 만들지 않는다', () => {
    expect(kisSymbolCandidates('BRK-B')).toEqual(['BRK-B', 'BRK/B', 'BRK.B']);
    expect(kisSymbolCandidates('AAPL')).toEqual(['AAPL']);
  });
});

describe('색인', () => {
  const { rows } = parseSecExchangeResponse(SMALL);

  it('같은 CIK 의 여러 티커가 한 묶음으로 모인다(BRK-A·BRK-B)', () => {
    expect(indexByCik(rows).get(1067983)?.map((r) => r.ticker)).toEqual(['BRK-B', 'BRK-A']);
  });

  it('티커 색인은 배열이다 — 두 거래소 중복 등재를 조용히 덮어쓰지 않는다', () => {
    const dup = parseSecExchangeResponse({
      fields: ['cik', 'name', 'ticker', 'exchange'],
      data: [[1, 'A', 'XX', 'NYSE'], [2, 'B', 'XX', 'Nasdaq']],
    }).rows;
    expect(indexByTicker(dup).get('XX')).toHaveLength(2);
  });
});
