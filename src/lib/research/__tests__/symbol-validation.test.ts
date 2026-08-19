/**
 * 심볼 검증 — URL 인젝션 방지가 핵심 (T-032).
 * 이 모듈의 출력이 외부 URL 경로에 그대로 붙으므로 allowlist 통과 여부를 엄격히 본다.
 */
import {
  isSafeYahooSymbol,
  normalizeResearchSymbol,
  toYahooPathSegment,
} from '../data/symbol-validation';

describe('normalizeResearchSymbol — 정상 경로', () => {
  test('국내 6자리는 .KS → .KQ 순 후보를 만든다', () => {
    const r = normalizeResearchSymbol('005930');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.market).toBe('domestic');
    expect(r.yahooCandidates).toEqual(['005930.KS', '005930.KQ']);
  });

  test('해외 NAS:MU 는 티커만 남긴다', () => {
    const r = normalizeResearchSymbol('NAS:MU');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.market).toBe('overseas');
    expect(r.yahooCandidates).toEqual(['MU']);
  });

  test('점 포함 티커(BRK.B)는 Yahoo 표기(-)를 우선 후보로 둔다', () => {
    const r = normalizeResearchSymbol('NYS:BRK.B');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.yahooCandidates).toEqual(['BRK-B', 'BRK.B']);
  });

  test('앞뒤 공백은 제거한다', () => {
    const r = normalizeResearchSymbol('  NAS:SNDK  ');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.symbol).toBe('NAS:SNDK');
    expect(r.yahooCandidates).toEqual(['SNDK']);
  });
});

describe('normalizeResearchSymbol — 거부 경로 (URL 인젝션 방지)', () => {
  test.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['MU', 'unsupported_format'],                       // 거래소 접두어 없는 해외 티커
    ['00593', 'unsupported_format'],                    // 5자리
    ['0059300', 'unsupported_format'],                  // 7자리
    ['../../etc/passwd', 'unsupported_format'],
    ['NAS:MU/../../v8', 'unsupported_format'],
    ['NAS:MU?range=max', 'unsupported_format'],
    ['NAS:MU#frag', 'unsupported_format'],
    ['NAS:MU%2F..', 'unsupported_format'],
    ['nas:mu', 'unsupported_format'],                   // 소문자 접두어
    ['NAS:MU MSFT', 'unsupported_format'],
    ['005930.KS', 'unsupported_format'],                // 이미 Yahoo 표기 — 내부 심볼 아님
    ['NAS:', 'unsupported_format'],
    ['javascript:alert(1)', 'unsupported_format'],
  ])('%s 는 거부된다 (%s)', (input, reason) => {
    const r = normalizeResearchSymbol(input);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe(reason);
  });
});

describe('isSafeYahooSymbol / toYahooPathSegment', () => {
  test('allowlist 통과 문자열만 안전 판정', () => {
    expect(isSafeYahooSymbol('005930.KS')).toBe(true);
    expect(isSafeYahooSymbol('BRK-B')).toBe(true);
    expect(isSafeYahooSymbol('MU')).toBe(true);
    expect(isSafeYahooSymbol('')).toBe(false);
    expect(isSafeYahooSymbol('MU/../x')).toBe(false);
    expect(isSafeYahooSymbol('MU?a=1')).toBe(false);
    expect(isSafeYahooSymbol('MU MSFT')).toBe(false);
    expect(isSafeYahooSymbol('.MU')).toBe(false);        // 선두 문자는 영숫자만
    expect(isSafeYahooSymbol('A'.repeat(21))).toBe(false); // 길이 상한
  });

  test('allowlist 통과분도 encodeURIComponent 를 한 번 더 적용한다(이중 방어)', () => {
    expect(toYahooPathSegment('005930.KS')).toBe('005930.KS');
    expect(toYahooPathSegment('BRK-B')).toBe('BRK-B');
  });

  test('allowlist 미통과 값이 들어오면 조용히 넘기지 않고 던진다', () => {
    expect(() => toYahooPathSegment('MU/../v8/finance')).toThrow(/unsafe yahoo symbol/);
    expect(() => toYahooPathSegment('')).toThrow(/unsafe yahoo symbol/);
  });
});
