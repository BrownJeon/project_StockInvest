/**
 * 알림 본문 엔티티 이스케이프 (T-010 reviewer MEDIUM 후속, 2026-08-09).
 *
 * 회귀 방어 포인트:
 *  1. `dispatchAlert` 는 같은 body 를 **텔레그램(HTML)과 슬랙(mrkdwn)** 양쪽에 꽂는다.
 *     한쪽만 막는 이스케이프는 다른 쪽에서 클릭 가능한 링크를 만들어낸다
 *  2. `mrkdwnToTelegramHtml` 은 이 함수를 재사용하도록 **추출**됐다 —
 *     T-004 의 동작(`*굵게*` → `<b>`, 이스케이프가 먼저)이 그대로 보존돼야 한다
 */
import { escapeAlertText } from '../escape';
import { mrkdwnToTelegramHtml } from '../telegram';

describe('escapeAlertText — 두 채널 공통 방어', () => {
  test('& < > 세 글자를 엔티티로 바꾼다', () => {
    expect(escapeAlertText('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
  });

  test('& 를 먼저 처리해 이중 이스케이프가 생기지 않는다', () => {
    expect(escapeAlertText('&lt;')).toBe('&amp;lt;');
  });

  test('텔레그램 HTML 링크가 무력화된다 (피싱 벡터)', () => {
    const payload = '<a href="https://phish.example">지금 확인</a>';
    const out = escapeAlertText(payload);
    expect(out).not.toContain('<a href');
    expect(out).not.toContain('</a>');
    expect(out).not.toMatch(/[<>]/);
    // 원문은 텍스트로 읽을 수 있게 남는다 (관리자가 시도 자체를 인지해야 한다)
    expect(out).toContain('지금 확인');
  });

  test('슬랙 mrkdwn 링크가 무력화된다 (피싱 벡터)', () => {
    const payload = '<https://phish.example|지금 확인>';
    const out = escapeAlertText(payload);
    expect(out).not.toContain('<https://');
    expect(out).not.toMatch(/[<>]/);
    expect(out).toContain('지금 확인');
  });

  test('슬랙 멘션(<!channel>·<@U123>)도 무력화된다', () => {
    expect(escapeAlertText('<!channel> <@U123>')).not.toMatch(/[<>]/);
  });

  test('짝이 맞지 않는 < 하나도 남기지 않는다 (텔레그램 400 → 알림 유실 방지)', () => {
    expect(escapeAlertText('a < b')).toBe('a &lt; b');
  });

  test('별표는 건드리지 않는다 (구조를 만들지 못하고, 지우면 원문이 왜곡된다)', () => {
    expect(escapeAlertText('*강조*')).toBe('*강조*');
  });

  test('줄바꿈·한글·이모지는 보존된다', () => {
    expect(escapeAlertText('가\n나 🚨')).toBe('가\n나 🚨');
  });

  test('문자열이 아니면 빈 문자열', () => {
    expect(escapeAlertText(null)).toBe('');
    expect(escapeAlertText(undefined)).toBe('');
    expect(escapeAlertText(42)).toBe('');
  });
});

describe('mrkdwnToTelegramHtml — 추출 후에도 T-004 동작 보존', () => {
  test('짝이 맞는 *…* 만 <b>…</b> 로 바꾼다', () => {
    expect(mrkdwnToTelegramHtml('*굵게* 보통')).toBe('<b>굵게</b> 보통');
  });

  test('이스케이프가 먼저다 — 우리가 만든 <b> 는 살아남는다', () => {
    // 입력의 <는 이스케이프되고, 변환으로 만든 <b>만 태그로 남아야 한다.
    expect(mrkdwnToTelegramHtml('<i>x</i> *굵게*')).toBe('&lt;i&gt;x&lt;/i&gt; <b>굵게</b>');
  });

  test('입력의 & < > 는 엔티티가 된다', () => {
    expect(mrkdwnToTelegramHtml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
  });

  test('짝이 없는 별표는 그대로 둔다', () => {
    expect(mrkdwnToTelegramHtml('*열기만')).toBe('*열기만');
  });

  test('줄을 넘는 별표 쌍은 변환하지 않는다', () => {
    expect(mrkdwnToTelegramHtml('*가\n나*')).toBe('*가\n나*');
  });
});
