/**
 * T-042 — 승인 요청·결과 메시지.
 *
 * 🔴 최대 목적: **텔레그램이 거부하는 메시지를 만들지 않는다.** 2026-09-21~10-10 사이 승인 요청의 약 78% 가
 * 사유 줄의 `<` 때문에 HTTP 400 으로 사라졌다. 아래 퍼징이 어떤 동적 값이 와도 "정적 태그 외의 `<` 가 없다"를 고정한다.
 */
import {
  buildDecisionKeyboard,
  describeOrderFailure,
  renderApprovalRequest,
  renderDecision,
  renderSelfTest,
  strategyTitle,
  won,
  type ApprovalRequestView,
  type DecisionView,
} from '../approval-message';
import { deriveApprovalKey, parseCallbackData, verifyCallbackData } from '../telegram-callback-data';
import { escapeAlertText } from '../../notify/escape';

const KEY = deriveApprovalKey('a-session-secret-that-is-long-enough-1234567890')!;
const NOW = new Date('2026-10-12T04:20:00Z');          // 13:20 KST

const base = (over: Partial<ApprovalRequestView> = {}): ApprovalRequestView => ({
  signalId: 17546, label: 'BOOKING HOLDINGS INC', symbol: 'NAS:BKNG', market: 'overseas', side: 'buy',
  amountKRW: 1_121_925, strategyId: 'rsi-oversold-v1',
  reasonLine: 'RSI14=37.4 < 38, price=215496.95 < MA20=219156, 양봉 반전 → 과매도 반등 시작',
  expiresAt: new Date(NOW.getTime() + 28 * 60_000), now: NOW,
  totalAssetPct: 4.9, dailyRemainingKRW: 1_168_000, cashKRW: 80_000, cashNeededKRW: 1_121_925,
  ...over,
});

/** 허용된 정적 태그(`<b>`·`</b>`·`<i>`·`</i>`)를 지우고 남은 `<` 의 개수. 0 이어야 텔레그램이 받는다. */
const strayAngles = (text: string): number =>
  (text.replace(/<\/?(?:b|i)>/g, '').match(/</g) ?? []).length;
/** 엔티티가 아닌 맨몸 `&` 의 개수 */
const bareAmpersands = (text: string): number => (text.replace(/&(?:amp|lt|gt);/g, '').match(/&/g) ?? []).length;

describe('🔴 텔레그램이 거부하는 메시지를 만들지 않는다 (78% 유실의 재발 방지)', () => {
  test('실제로 유실을 일으킨 사유 줄을 그대로 넣어도 안전하다', () => {
    const { text } = renderApprovalRequest(base(), KEY);
    expect(strayAngles(text)).toBe(0);
    expect(bareAmpersands(text)).toBe(0);
    expect(text).toContain('RSI14=37.4 &lt; 38');
    expect(text).toContain('price=215496.95 &lt; MA20=219156');
  });

  test('퍼징: label·symbol·reasonLine 에 위험 문자가 아무리 섞여도 정적 태그 외의 < 가 없다', () => {
    const alphabet = ['<', '>', '&', '<b>', '</b>', '<script>', '&amp;', '&lt;', '"', "'", 'a', 'RSI', ' ', '\n', '한글', '😀', '< 38', 'AT&T', 'P&G'];
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const junk = () => Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('');
    for (let i = 0; i < 400; i++) {
      // label 은 `getSymbolLabel` 의 반환 계약대로 *이미 이스케이프된* 값으로 넣는다 (symbol·reasonLine·strategyId 는 원문)
      const { text } = renderApprovalRequest(base({ label: escapeAlertText(junk()), symbol: junk(), reasonLine: junk(), strategyId: junk() }), KEY);
      expect(strayAngles(text)).toBe(0);
      expect(bareAmpersands(text)).toBe(0);
    }
  });

  test('결과 메시지도 마찬가지 — 사유·종목명에 위험 문자가 있어도 안전', () => {
    const views: DecisionView[] = [
      { kind: 'order_placed', orderId: 3250 }, { kind: 'entry_watch' }, { kind: 'order_rejected', reason: 'order_not_accepted: <b>x</b> & y < z' },
      { kind: 'order_uncertain', reason: 'order_uncertain: <b>x</b> & y', orderId: 7 },
      { kind: 'rejected' }, { kind: 'expired' }, { kind: 'already_handled', status: '<weird>' }, { kind: 'kill_switch' },
      { kind: 'changed' }, { kind: 'failed', reason: '<oops> & more' },
    ];
    for (const v of views) {
      const { text } = renderDecision(v, { label: escapeAlertText('AT&T <Inc>'), side: 'buy', amountKRW: 1000, now: NOW });
      expect(strayAngles(text)).toBe(0);
      expect(bareAmpersands(text)).toBe(0);
    }
  });

  test('자가 점검에도 앱 링크 버튼이 붙는다 — 잘못된 URL 이 기능을 켜기 전에 잡히도록 (감사 Low)', () => {
    const withLink = renderSelfTest(KEY, NOW, 'https://stock.example.com/strategy').keyboard.inline_keyboard;
    expect(withLink).toHaveLength(2);
    expect(withLink[1][0]).toEqual({ text: '🔗 앱에서 자세히', url: 'https://stock.example.com/strategy' });
    expect(renderSelfTest(KEY, NOW).keyboard.inline_keyboard).toHaveLength(1);
    expect(renderSelfTest(KEY, NOW, 'http://insecure.example.com').keyboard.inline_keyboard).toHaveLength(1);
    expect(renderSelfTest(KEY, NOW, null).keyboard.inline_keyboard).toHaveLength(1);
  });

  test('🔴 [2라운드 R2-1] 라벨은 이미 이스케이프된 값 — 다시 이스케이프하지 않는다 (Johnson & Johnson 이 &amp;amp; 로 보이던 퇴행)', () => {
    const label = escapeAlertText('Johnson & Johnson');            // getSymbolLabel 이 돌려주는 형태: "Johnson &amp; Johnson"
    expect(label).toBe('Johnson &amp; Johnson');
    const { text } = renderApprovalRequest(base({ label, symbol: 'NYS:JNJ' }), KEY);
    expect(text).toContain('<b>Johnson &amp; Johnson</b> (NYS:JNJ)');
    expect(text).not.toContain('&amp;amp;');
    const decided = renderDecision({ kind: 'order_placed', orderId: 1 }, { label, side: 'buy', amountKRW: 1, now: NOW }).text;
    expect(decided).toContain('<b>Johnson &amp; Johnson</b>');
    expect(decided).not.toContain('&amp;amp;');
  });

  test('원본 심볼(symbol)은 여전히 이스케이프한다 — 라벨과 달리 날 값이다', () => {
    expect(renderApprovalRequest(base({ symbol: 'A&B<x>' }), KEY).text).toContain('(A&amp;B&lt;x&gt;)');
  });

  test('자가 점검 메시지도 안전', () => {
    const { text } = renderSelfTest(KEY, NOW);
    expect(strayAngles(text)).toBe(0);
    expect(bareAmpersands(text)).toBe(0);
  });

  test('텔레그램 본문 한도(4096자) 안 — 사유 줄은 호출처에서 100자로 자르지만 방어적으로도 확인', () => {
    const { text } = renderApprovalRequest(base({ reasonLine: 'x'.repeat(100), label: 'L'.repeat(200) }), KEY);
    expect(text.length).toBeLessThan(4096);
  });
});

describe('승인 요청 본문 (목업 1·4)', () => {
  test('해외 매수: 금액·총자산 비율·한도 잔여·현금 부족 경고·만료', () => {
    const { text } = renderApprovalRequest(base(), KEY);
    expect(text).toContain('📩 <b>승인 요청</b> · 매수 · 해외');
    expect(text).toContain('<b>BOOKING HOLDINGS INC</b> (NAS:BKNG)');
    expect(text).toContain('RSI 과매도 반등 — ');
    expect(text).toContain('금액   ₩1,121,925 (총자산의 4.9%)');
    expect(text).toContain('오늘 한도 잔여 ₩1,168,000');
    expect(text).toContain('현금 ₩80,000 ⚠ 부족');
    expect(text).toContain('승인하면  지정가 주문 (신호가 기준)');
    expect(text).toContain('만료   13:48 KST  (28분 남음)');
  });

  test('현금이 충분하면 경고를 붙이지 않는다', () => {
    const { text } = renderApprovalRequest(base({ cashKRW: 2_000_000 }), KEY);
    expect(text).toContain('현금 ₩2,000,000');
    expect(text).not.toContain('⚠');
  });

  test('🔴 모르는 값은 적지 않는다 — 조회 실패(null)를 0원이나 안심 문구로 바꾸지 않는다', () => {
    const { text } = renderApprovalRequest(base({ totalAssetPct: null, dailyRemainingKRW: null, cashKRW: null }), KEY);
    expect(text).not.toContain('총자산의');
    expect(text).not.toContain('한도 잔여');
    expect(text).not.toContain('현금');
    expect(text).toContain('금액   ₩1,121,925');
  });

  test('매도에는 현금·한도 줄이 없다', () => {
    const { text } = renderApprovalRequest(base({ side: 'sell' }), KEY);
    expect(text).toContain('매도');
    expect(text).not.toContain('현금');
    expect(text).not.toContain('한도 잔여');
  });

  test('시나리오 카드: 진입 구간이 있으면 승인 = 진입 감시 등록', () => {
    const { text } = renderApprovalRequest(base({ market: 'domestic', zone: [245000, 248500], strategyId: 'scenario' }), KEY);
    expect(text).toContain('진입 구간  245,000 ~ 248,500');
    expect(text).toContain('승인하면  진입 감시 등록 (구간 도달 시 자동 주문)');
    expect(text).not.toContain('지정가 주문');
  });

  test('만료가 이미 지났으면 0분, 만료 시각이 없으면 줄 자체가 없다', () => {
    expect(renderApprovalRequest(base({ expiresAt: new Date(NOW.getTime() - 60_000) }), KEY).text).toContain('(0분 남음)');
    expect(renderApprovalRequest(base({ expiresAt: null }), KEY).text).not.toContain('만료');
  });

  test('🔴 자정 직후 시각이 "24:05" 로 찍히지 않는다 (hour12:false 의 함정 — 실측)', () => {
    const night = new Date('2026-10-12T15:05:00Z');                  // 00:05 KST (다음 날)
    const { text } = renderApprovalRequest(base({ now: night, expiresAt: new Date(night.getTime() + 30 * 60_000) }), KEY);
    expect(text).toContain('만료   00:35 KST');
    expect(text).not.toMatch(/\b24:\d\d/);
    const done = renderDecision({ kind: 'rejected' }, { label: 'x', side: 'buy', amountKRW: 1, now: night }).text;
    expect(done).not.toMatch(/\b24:\d\d/);
    expect(done).toContain('00:05');
  });

  test('청산 시그널은 exit 유형 이름으로 보인다', () => {
    expect(renderApprovalRequest(base({ side: 'sell', exitKind: 'hard_stop' }), KEY).text).toContain('손실한도 손절');
  });
});

describe('버튼', () => {
  test('승인·거절 한 줄, 앱 주소가 유효한 https 일 때만 링크 한 줄', () => {
    const kb = buildDecisionKeyboard(KEY, 5, 1000, 'https://stock.example.com/strategy').inline_keyboard;
    expect(kb).toHaveLength(2);
    expect(kb[0].map((b) => b.text)).toEqual(['✅ 승인', '❌ 거절']);
    expect(kb[1][0]).toEqual({ text: '🔗 앱에서 자세히', url: 'https://stock.example.com/strategy' });
    for (const url of [null, undefined, '', 'http://insecure.example.com', 'javascript:alert(1)', 'not a url', 'https://a b']) {
      expect(buildDecisionKeyboard(KEY, 5, 1000, url as string | null).inline_keyboard).toHaveLength(1);
    }
  });

  test('🔴 버튼의 서명은 같은 입력으로 다시 만들어도 같고, 그 금액에만 유효하다', () => {
    const a = buildDecisionKeyboard(KEY, 17546, 1_121_925).inline_keyboard[0][0].callback_data!;
    const b = buildDecisionKeyboard(KEY, 17546, 1_121_925).inline_keyboard[0][0].callback_data!;
    expect(a).toBe(b);
    const p = parseCallbackData(a)!;
    expect(p.action).toBe('a');
    expect(verifyCallbackData(KEY, p, 1_121_925)).toBe(true);
    expect(verifyCallbackData(KEY, p, 1_121_926)).toBe(false);
  });

  test('🔴 서명은 DB 에 저장된 금액으로 한다 — 소수 금액의 반올림 차이로 정상 버튼이 무효가 되지 않는다', () => {
    // 입력 1121925.4999 → DECIMAL(18,2) 저장 1121925.50 → 탭 시 서버는 Math.round(1121925.50)=1121926 으로 검증한다
    const { keyboard } = renderApprovalRequest(base({ signalId: 8, amountKRW: 1_121_925.4999, signedAmountKRW: 1_121_925.5 }), KEY);
    const p = parseCallbackData(keyboard.inline_keyboard[0][0].callback_data)!;
    expect(verifyCallbackData(KEY, p, Number('1121925.50'))).toBe(true);
    // 대조: signedAmountKRW 가 없으면 입력값(1121925)으로 서명돼 저장값(1121926)과 어긋난다 — 이게 막으려는 결함
    const naive = parseCallbackData(renderApprovalRequest(base({ signalId: 8, amountKRW: 1_121_925.4999 }), KEY).keyboard.inline_keyboard[0][0].callback_data)!;
    expect(verifyCallbackData(KEY, naive, Number('1121925.50'))).toBe(false);
  });

  test('요청 메시지의 버튼이 그 금액에 서명돼 있다', () => {
    const { keyboard } = renderApprovalRequest(base({ signalId: 31, amountKRW: 777_000 }), KEY);
    const p = parseCallbackData(keyboard.inline_keyboard[0][1].callback_data)!;
    expect(p).toMatchObject({ action: 'r', signalId: 31 });
    expect(verifyCallbackData(KEY, p, 777_000)).toBe(true);
  });
});

describe('결과 문구 (목업 2·3)', () => {
  const ctx = { label: 'BOOKING HOLDINGS INC', side: 'buy' as const, amountKRW: 1_121_925, now: NOW };

  test('주문 접수 / 진입 감시 / 거절 / 만료 / 결과 불명은 버튼을 남기지 않는다', () => {
    for (const v of [{ kind: 'order_uncertain', reason: 'x' }, { kind: 'order_placed', orderId: 3250 }, { kind: 'entry_watch' }, { kind: 'rejected' }, { kind: 'expired' }, { kind: 'already_handled', status: 'approved' }, { kind: 'changed' }] as DecisionView[]) {
      expect(renderDecision(v, ctx).keepButtons).toBe(false);
    }
  });

  test('🔴 주문 거부·킬스위치·처리 실패는 버튼을 남긴다 — 사람이 다시 판단한다', () => {
    for (const v of [{ kind: 'order_rejected', reason: 'insufficient_balance' }, { kind: 'kill_switch' }, { kind: 'failed', reason: 'x' }] as DecisionView[]) {
      expect(renderDecision(v, ctx).keepButtons).toBe(true);
    }
  });

  test('🔴 "승인됨"과 "주문 거부"를 구분해 적는다 (이전에는 거부된 주문도 승인으로 보였다)', () => {
    expect(renderDecision({ kind: 'order_placed', orderId: 3250 }, ctx).text).toContain('주문 접수 #3250');
    const rej = renderDecision({ kind: 'order_rejected', reason: 'order_not_accepted: insufficient_balance' }, ctx).text;
    expect(rej).toContain('승인했지만 주문이 거부됨');
    expect(rej).toContain('현금 부족');
    expect(rej).not.toContain('✅');
  });

  test('🔴 결과 불명: 주문 번호·잠금·"다시 승인하지 마세요"를 알린다 (이중 주문 방지 — 감사 D-1)', () => {
    const { text, keepButtons } = renderDecision({ kind: 'order_uncertain', reason: 'order_uncertain: fetch failed (ECONNRESET)', orderId: 2001 }, ctx);
    expect(keepButtons).toBe(false);
    expect(text).toContain('주문 결과를 확인하지 못했습니다');
    expect(text).toContain('주문 #2001');
    expect(text).toContain('fetch failed (ECONNRESET)');
    expect(text).not.toContain('order_uncertain:');             // 접두사는 사람에게 보이지 않는다
    expect(text).toContain('이중 주문을 막으려고');
    expect(text).toContain('다시 승인하지 마세요');
    expect(text).not.toContain('✅');
  });

  test('🔴 긴 오류 사유는 잘린다 — 한 줄이 화면을 도배하거나 4096자를 넘지 않게', () => {
    const long = 'x'.repeat(2000);
    for (const v of [{ kind: 'failed', reason: long }, { kind: 'order_rejected', reason: long }, { kind: 'order_uncertain', reason: long }] as DecisionView[]) {
      const { text } = renderDecision(v, ctx);
      expect(text.length).toBeLessThan(700);
      expect(text).toContain('…');
    }
  });

  test('DRY_RUN 주문은 실제 주문이 아니라고 명시', () => {
    expect(renderDecision({ kind: 'order_placed', orderId: 1, dryRun: true }, ctx).text).toContain('가상 주문');
  });

  test('이미 처리된 시그널은 상태를 한국어로 알린다', () => {
    expect(renderDecision({ kind: 'already_handled', status: 'approved_pending_entry' }, ctx).text).toContain('승인됨 (진입 감시 중)');
    expect(renderDecision({ kind: 'already_handled', status: 'mystery' }, ctx).text).toContain('mystery');
  });

  test('describeOrderFailure — 알려진 코드는 풀어 쓰고, 모르는 코드는 숨기지 않는다', () => {
    expect(describeOrderFailure('order_not_accepted: kill_switch')).toBe('모든거래차단이 켜져 있음');
    expect(describeOrderFailure('order_not_accepted: daily_limit')).toBe('일 한도 초과');
    expect(describeOrderFailure('order_not_accepted: order_limit')).toContain('한도');
    expect(describeOrderFailure('insufficient_balance')).toContain('현금 부족');
    expect(describeOrderFailure('something_new')).toBe('something_new');
    expect(describeOrderFailure('')).toBe('알 수 없음');
  });
});

describe('보조', () => {
  test('won — 원화 표기', () => {
    expect(won(1_121_925.4)).toBe('₩1,121,925');
    expect(won(0)).toBe('₩0');
  });

  test('strategyTitle — exit 유형 우선, 모르는 전략은 ID 그대로', () => {
    expect(strategyTitle('rsi-oversold-v1')).toBe('RSI 과매도 반등');
    expect(strategyTitle('rsi-oversold-v1', 'trailing_stop')).toBe('트레일링 스탑');
    expect(strategyTitle('brand-new-v9')).toBe('brand-new-v9');
    expect(strategyTitle(null)).toBe('시그널');
  });
});
