/**
 * D-6/D-7 회귀 — format.ts 의 redactReasoning + isValidKbHit + filterValidHits.
 */
import { redactReasoning, isValidKbHit, filterValidHits, buildSignalText } from '../format';
import type { KbHit } from '../m4-kb';

describe('D-6 redactReasoning', () => {
  test('이메일 마스킹', () => {
    const out = redactReasoning('user@example.com 이 RSI 30 매수 추천');
    expect(out).toContain('[EMAIL]');
    expect(out).not.toContain('user@example.com');
  });

  test('전화번호 마스킹', () => {
    const out = redactReasoning('연락 010-1234-5678 매수 신호');
    expect(out).toContain('[PHONE]');
    expect(out).not.toContain('010-1234-5678');
  });

  test('카드번호 마스킹', () => {
    const out = redactReasoning('1234-5678-9012-3456 노출 위험');
    expect(out).toContain('[CARD]');
    expect(out).not.toContain('1234-5678-9012-3456');
  });

  test('Bearer token 마스킹', () => {
    const out = redactReasoning('Bearer abcdef1234567890ABCDEFGHIJKLMNOPQRST 인증');
    expect(out).toContain('Bearer [TOKEN]');
  });

  test('JWT 마스킹', () => {
    const out = redactReasoning('Authorization eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 노출');
    expect(out).toContain('[JWT]');
  });

  test('mk_/sk_ API key 마스킹', () => {
    const out = redactReasoning('키 mk_dSkOhqXoBgSBlB9tO1aSXdqLS_AyMGYn 사용');
    expect(out).toContain('[API_KEY]');
    expect(out).not.toContain('mk_dSkOhqXoBgSBlB9tO1aSXdqLS_AyMGYn');
  });

  test('AWS Access Key 마스킹', () => {
    const out = redactReasoning('AKIAIOSFODNN7EXAMPLE');
    expect(out).toContain('[AWS_KEY]');
  });

  test('빈 입력 → 빈 문자열', () => {
    expect(redactReasoning('')).toBe('');
    expect(redactReasoning(null)).toBe('');
    expect(redactReasoning(undefined)).toBe('');
  });

  test('200자 초과 → truncate', () => {
    const long = '가'.repeat(300);
    const out = redactReasoning(long);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith('…')).toBe(true);
  });

  test('정상 텍스트는 변경 없음', () => {
    const safe = 'BTC RSI 30 과매도 매수 추천 (변동성 평이)';
    expect(redactReasoning(safe)).toBe(safe);
  });
});

describe('D-6 buildSignalText 통합', () => {
  test('reasoning 의 PII 가 signal text 에 노출 안 됨', () => {
    const text = buildSignalText({
      symbol: '005930', side: 'buy',
      reasoning: '제보자 user@example.com 010-1234-5678 추천 mk_abcdef1234567890ABCDEFGHIJKL',
      createdAt: '2026-05-07T10:00:00Z',
    });
    expect(text).not.toContain('user@example.com');
    expect(text).not.toContain('010-1234-5678');
    expect(text).not.toContain('mk_abcdef1234567890');
    expect(text).toContain('[EMAIL]');
    expect(text).toContain('[PHONE]');
    expect(text).toContain('[API_KEY]');
  });
});

describe('D-7 isValidKbHit', () => {
  const valid: KbHit = { id: 'a', score: 0.9, text: 't', metadata: {} };

  test('정상 hit → true', () => {
    expect(isValidKbHit(valid)).toBe(true);
  });

  test('id 누락/타입 오류 → false', () => {
    expect(isValidKbHit({ ...valid, id: undefined })).toBe(false);
    expect(isValidKbHit({ ...valid, id: 123 })).toBe(false);
  });

  test('score 음수/NaN/Infinity → false', () => {
    expect(isValidKbHit({ ...valid, score: -0.1 })).toBe(false);
    expect(isValidKbHit({ ...valid, score: NaN })).toBe(false);
    expect(isValidKbHit({ ...valid, score: Infinity })).toBe(false);
  });

  test('text 빈 문자열·공백 only → false', () => {
    expect(isValidKbHit({ ...valid, text: '' })).toBe(false);
    expect(isValidKbHit({ ...valid, text: '   ' })).toBe(false);
  });

  test('metadata array → false', () => {
    expect(isValidKbHit({ ...valid, metadata: [1, 2, 3] })).toBe(false);
  });

  test('metadata null/undefined → true (옵션)', () => {
    expect(isValidKbHit({ ...valid, metadata: null })).toBe(true);
    const without = { id: 'a', score: 0.9, text: 't' };
    expect(isValidKbHit(without)).toBe(true);
  });

  test('null/undefined/primitive → false', () => {
    expect(isValidKbHit(null)).toBe(false);
    expect(isValidKbHit(undefined)).toBe(false);
    expect(isValidKbHit('x')).toBe(false);
  });
});

describe('D-7 filterValidHits', () => {
  test('정상 + 깨진 hit 혼합 → 정상만 통과 + invalid 카운트', () => {
    const hits = [
      { id: 'a', score: 0.9, text: 'good', metadata: {} },
      { id: 123, score: 0.8, text: 'bad-id', metadata: {} } as any,
      { id: 'c', score: -0.1, text: 'bad-score', metadata: {} },
      { id: 'd', score: 0.7, text: '', metadata: {} },
      { id: 'e', score: 0.6, text: 'good2', metadata: {} },
    ];
    const r = filterValidHits(hits);
    expect(r.valid.map(h => h.id)).toEqual(['a', 'e']);
    expect(r.invalidCount).toBe(3);
  });

  test('전체 정상 → invalidCount 0', () => {
    const hits = [{ id: 'a', score: 0.9, text: 't', metadata: {} }];
    expect(filterValidHits(hits).invalidCount).toBe(0);
  });
});
