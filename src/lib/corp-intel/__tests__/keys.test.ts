/**
 * T-116 — RSS 멱등 키(keys.ts) 시험: 안정성 · 정규화 · guid 우선 · 구분자 충돌 없음 · 형식.
 */
import { createHash } from 'node:crypto';
import { normalizeKeyPart, parseIsoUtcStrict, publishedAtKeyPart, rssSourceKey, RSS_KEY_SCHEME } from '../keys';

const base = { feedHost: 'www.yna.co.kr', guid: 'g-1', link: 'https://www.yna.co.kr/a/1', title: '제목 하나', publishedAt: '2026-10-28T01:02:03+00:00' };

describe('rssSourceKey', () => {
  test('형식 — 소문자 16진 64자', () => {
    expect(rssSourceKey(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('같은 입력 → 같은 키(여러 번 계산해도)', () => {
    expect(rssSourceKey({ ...base })).toBe(rssSourceKey(base));
  });

  test('🔴 직렬화 규칙 고정 — JSON 4값 배열의 sha256, 발행시각은 UTC 정규화 toISOString(바꾸면 기존 키가 전부 바뀐다)', () => {
    const expected = createHash('sha256')
      .update(JSON.stringify(['www.yna.co.kr', 'g-1', '제목 하나', '2026-10-28T01:02:03.000Z']), 'utf8').digest('hex');
    expect(rssSourceKey(base)).toBe(expected);
    expect(RSS_KEY_SCHEME).toBe('json4-utc');
  });

  test('🔴 (M-3) 같은 시각의 서로 다른 표기 → 같은 키, 다른 시각 → 다른 키', () => {
    const k = (publishedAt: string) => rssSourceKey({ ...base, publishedAt });
    const same = ['2026-10-28T09:42:03+00:00', '2026-10-28T09:42:03Z', '2026-10-28T18:42:03+09:00', '2026-10-28T09:42:03.000Z',
      '2026-10-28T09:42:03+0000', '2026-10-28T04:42:03-05:00'];
    expect(new Set(same.map(k)).size).toBe(1);
    expect(k('2026-10-28T09:42:04Z')).not.toBe(k('2026-10-28T09:42:03Z'));
    expect(k('2026-10-28T09:42:03.001Z')).not.toBe(k('2026-10-28T09:42:03Z'));
    expect(k('2026-10-28T09:42:03+09:00')).not.toBe(k('2026-10-28T09:42:03Z'));
  });

  test('발행시각 해석 불가·없음·롤오버 날짜는 빈 문자열(서로 같은 키)', () => {
    const none = rssSourceKey({ ...base, publishedAt: null });
    for (const v of ['Tue, 28 Oct 2026 10:02:03 +0900', '2026-10-28', '2026-02-30T00:00:00Z', '2026-10-28T24:00:00Z', '', undefined, 5]) {
      expect(rssSourceKey({ ...base, publishedAt: v })).toBe(none);
    }
  });

  test('정규화 — 앞뒤 공백·안쪽 연속 공백(줄바꿈·탭)·호스트 대소문자는 키를 바꾸지 않는다', () => {
    const messy = { ...base, feedHost: '  WWW.Yna.CO.kr ', guid: ' g-1\n', title: '  제목\t\n  하나 ', publishedAt: ' 2026-10-28T01:02:03+00:00 ' };
    expect(rssSourceKey(messy)).toBe(rssSourceKey(base));
  });

  test('guid 가 있으면 link 는 키에 영향 없음, guid 가 없으면 link 를 쓴다', () => {
    expect(rssSourceKey({ ...base, link: 'https://other.example.com/x' })).toBe(rssSourceKey(base));
    const noGuid = { ...base, guid: null };
    expect(rssSourceKey({ ...noGuid, link: 'https://other.example.com/x' })).not.toBe(rssSourceKey(noGuid));
    // guid 가 공백뿐이면 없는 것과 같다 → link 사용
    expect(rssSourceKey({ ...base, guid: '   ' })).toBe(rssSourceKey(noGuid));
    // guid 값 = link 값이면 guid 없음 + 같은 link 와 같은 키(같은 기사)
    expect(rssSourceKey({ ...base, guid: base.link })).toBe(rssSourceKey(noGuid));
  });

  test('값이 하나라도 다르면 다른 키(제목·발행시각·피드·guid 대소문자)', () => {
    const k = rssSourceKey(base);
    expect(rssSourceKey({ ...base, title: '제목 둘' })).not.toBe(k);
    expect(rssSourceKey({ ...base, publishedAt: '2026-10-28T01:02:04+00:00' })).not.toBe(k);
    expect(rssSourceKey({ ...base, publishedAt: null })).not.toBe(k);
    expect(rssSourceKey({ ...base, feedHost: 'www.mk.co.kr' })).not.toBe(k);
    expect(rssSourceKey({ ...base, guid: 'G-1' })).not.toBe(k);
  });

  test('🔴 구분자 충돌 없음 — 값 경계를 옮긴 입력들은 서로 다른 키', () => {
    const t = '2026-10-28T00:00:00Z';
    const keys = [
      rssSourceKey({ feedHost: 'a|b', guid: 'c', title: 'd', publishedAt: t }),
      rssSourceKey({ feedHost: 'a', guid: 'b|c', title: 'd', publishedAt: t }),
      rssSourceKey({ feedHost: 'a', guid: 'b', title: 'c|d', publishedAt: t }),
      rssSourceKey({ feedHost: 'a', guid: 'b', title: 'c|d|', publishedAt: t }),
      rssSourceKey({ feedHost: 'a', guid: '","b', title: 'c', publishedAt: t }),
      rssSourceKey({ feedHost: 'a","', guid: 'b', title: 'c', publishedAt: t }),
      rssSourceKey({ feedHost: 'a', guid: 'b', title: `c","${t}`, publishedAt: '' }),
      rssSourceKey({ feedHost: '', guid: '', title: '', publishedAt: '' }),
      rssSourceKey({ feedHost: '', guid: '', title: '""', publishedAt: '' }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('문자열이 아닌 값은 빈 문자열로 본다(던지지 않음)', () => {
    expect(() => rssSourceKey({ feedHost: 1, guid: {}, link: [], title: null, publishedAt: undefined })).not.toThrow();
    expect(rssSourceKey({ feedHost: 1, guid: {}, title: null })).toBe(rssSourceKey({}));
  });
});

describe('normalizeKeyPart', () => {
  test.each([
    [undefined, ''], [null, ''], [5, ''], ['  a  b ', 'a b'], ['a\n\tb', 'a b'], ['', ''],
  ])('%p → %p', (input, out) => {
    expect(normalizeKeyPart(input)).toBe(out);
  });
});

describe('parseIsoUtcStrict · publishedAtKeyPart (M-3·L-3)', () => {
  test.each([
    ['2026-10-28T09:42:03Z', '2026-10-28T09:42:03.000Z'],
    ['2026-10-28T18:42:03+09:00', '2026-10-28T09:42:03.000Z'],
    ['2026-10-28T09:42:03.123456Z', '2026-10-28T09:42:03.123Z'],
    ['2026-10-28T09:42Z', '2026-10-28T09:42:00.000Z'],
    ['2024-02-29T00:00:00Z', '2024-02-29T00:00:00.000Z'],
    ['  2026-10-28T09:42:03Z ', '2026-10-28T09:42:03.000Z'],
  ])('%p → %p', (v, iso) => {
    expect(parseIsoUtcStrict(v)?.toISOString()).toBe(iso);
    expect(publishedAtKeyPart(v)).toBe(iso);
  });

  test.each([
    '2026-02-30T00:00:00Z', '2025-02-29T00:00:00Z', '2026-10-28T24:00:00Z', '2026-10-28T23:60:00Z', '2026-10-28T23:59:60Z',
    '2026-13-01T00:00:00Z', '2026-10-32T00:00:00Z', '2026-10-28T00:00:00+24:00', '2026-10-28T00:00:00+09:60',
    '2026-10-28T00:00:00', '2026-10-28', 'Tue, 28 Oct 2026 10:02:03 +0900', '1969-12-31T23:59:59Z', '2101-01-01T00:00:00Z', '', null, 7,
  ])('🔴 %p → null(롤오버·형식·범위)', (v) => {
    expect(parseIsoUtcStrict(v)).toBeNull();
    expect(publishedAtKeyPart(v)).toBe('');
  });
});
