/**
 * 승인 요청·결과 메시지 본문 (T-042) — **순수 모듈** (db·notify·fetch import 0개, 시간은 인자로 받는다).
 *
 * ## 이스케이프 — 이 파일의 존재 이유 중 하나
 * 텔레그램은 `parse_mode: 'HTML'` 이라 `<`·`>`·`&` 를 이스케이프하지 않은 문자열을 HTTP 400 으로 **통째로 거부**한다.
 * 이전 승인 요청 본문은 사유 줄(`RSI14=37.4 < 38, …`)을 그대로 실어 2026-09-21~10-10 사이 승인 요청의 약 78% 가
 * 사용자에게 도착하지 않았다(HTTP 400 `can't parse entities` 492건). 그래서 **동적 값은 전부 `h()` 를 통과**하고,
 * 이 파일에서 만드는 태그(`<b>`)는 정적 리터럴뿐이다. 테스트가 "본문에 짝 없는 `<` 가 남지 않는다"를 퍼징으로 고정한다.
 *
 * ## 문구 정본
 * 목업(`agent-vault/10-Flow/tasks/T-042-telegram-approval-buttons.md` "데모")이 정본이다. 문구를 바꾸려면 목업을 먼저 바꾼다.
 */
import { escapeAlertText } from '../notify/escape';
import type { InlineKeyboard } from '../notify/telegram-api';
import { encodeCallbackData } from './telegram-callback-data';

/** 동적 문자열은 반드시 이걸 통과한다. */
const h = (v: unknown): string => escapeAlertText(typeof v === 'string' ? v : v == null ? '' : String(v));

export const won = (n: number): string => `₩${Math.round(n).toLocaleString('ko-KR')}`;

// `hour12:false` 는 자정 직후를 "24:05" 로 찍는다(실측) — `hourCycle:'h23'` 으로 00~23 시.
function kst(d: Date): string {
  return d.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
}
function kstDateTime(d: Date): string {
  return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hourCycle: 'h23', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** 오류 사유 문자열 상한 — 메시지가 텔레그램 4096자 한도를 넘거나 한 줄이 화면을 도배하지 않게 한다 */
const REASON_MAX = 160;
const clip = (v: string): string => (v.length > REASON_MAX ? `${v.slice(0, REASON_MAX)}…` : v);

const STRATEGY_TITLES: Readonly<Record<string, string>> = {
  'rsi-oversold-v1': 'RSI 과매도 반등',
  'pullback-trend-v1': '눌림목 추세',
  'bb-squeeze-expansion-v1': '볼린저 수축 확장',
  'rsi-overbought-exit-v1': 'RSI 과열 청산',
  'inside-bar-v1': '인사이드 바',
};
const EXIT_LABELS: Readonly<Record<string, string>> = {
  hard_stop: '손실한도 손절',
  target_profit: '목표 익절',
  trailing_stop: '트레일링 스탑',
  eod_loss_cut: '장마감 전 손절',
};
export function strategyTitle(strategyId: string | null | undefined, exitKind?: string | null): string {
  if (exitKind && EXIT_LABELS[exitKind]) return EXIT_LABELS[exitKind];
  if (!strategyId) return '시그널';
  return STRATEGY_TITLES[strategyId] ?? strategyId;
}

// ─────────────────────────────────────────────────────────────────────────────
// 승인 요청
// ─────────────────────────────────────────────────────────────────────────────

export interface ApprovalRequestView {
  signalId: number;
  /**
   * 종목명 — **이미 텔레그램 HTML·슬랙에 안전하게 이스케이프된 값**(`getSymbolLabel` 의 반환 계약). 여기서 다시 이스케이프하지 않는다:
   * `Johnson & Johnson` 이 `Johnson &amp;amp; Johnson` 으로 보이는 이중 이스케이프가 된다(2라운드 감사 R2-1).
   * 조회 실패 시 대신 쓰는 원본 심볼은 *호출처가* 이스케이프해서 넘긴다.
   */
  label: string;
  symbol: string;
  market: 'domestic' | 'overseas';
  side: 'buy' | 'sell';
  amountKRW: number;
  strategyId?: string | null;
  exitKind?: string | null;
  /** 사유 첫 줄(100자 이내로 잘린 것) */
  reasonLine?: string;
  /** 시나리오 카드의 진입 구간. 있으면 승인 = 진입 감시 등록 */
  zone?: [number, number] | null;
  expiresAt: Date | null;
  now: Date;
  /** 이하는 조회에 실패하면 null — 모르는 값은 적지 않는다(추측해서 안심시키지 않는다) */
  totalAssetPct?: number | null;
  dailyRemainingKRW?: number | null;
  cashKRW?: number | null;
  /** 현금이 이 금액에 못 미치면 ⚠ 표시 (보통 amountKRW) */
  cashNeededKRW?: number | null;
  /** `app_public_url` — 있을 때만 "앱에서 자세히" 버튼 */
  appUrl?: string | null;
  /**
   * 버튼 서명에 쓸 금액 — **DB 에 저장된 값**. 탭할 때 서버는 DB 의 `amount_krw`(DECIMAL(18,2))로 서명을 다시 계산하므로,
   * 보낼 때도 같은 값으로 서명해야 반올림 차이(예: 1121925.4999 → 저장 1121925.50)로 정상 버튼이 무효가 되지 않는다(감사 Low).
   * 없으면 `amountKRW`.
   */
  signedAmountKRW?: number | null;
  /**
   * T-097 Q-E "수량" 줄 — 호출처(`approval-notify`)가 시그널의 `indicators.sizing` 과 환율로 미리 계산해 넘긴다.
   * 없거나 값이 이상하면 줄을 적지 않는다(추측해서 적지 않는다). 버튼·서명과 무관하다.
   */
  quantityLine?: QuantityLineView | null;
}

/**
 * "수량" 줄에 쓸 값 — 승인된 데모 `mockups/T-097-telegram-sizing-line-v1.html` 의 두 형식뿐이다.
 *  - 해외: `수량   N주 × $정수  (≈ ₩원화)` — 단가는 실제 송신 단가와 같은 **정수 달러**(`overseasLimitUnitUsd`), 괄호는 수량 × 정수 달러 × 환율
 *  - 국내: `수량   N주 × ₩단가  (= ₩금액)` — 단가는 실제 송신가와 같은 **호가단위 반올림** 값(어댑터 `roundToTick`), 금액은 그 단가 × 수량
 * 이 모듈은 순수하므로 환율·정수 달러·호가단위 계산은 하지 않는다 — 호출처가 계산한 값을 그대로 적는다.
 */
export type QuantityLineView =
  | { market: 'overseas'; quantity: number; unitUsd: number; approxKrw: number }
  | { market: 'domestic'; quantity: number; unitKrw: number; totalKrw: number };

const isPosFinite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * "수량" 줄 한 줄. 값이 하나라도 이상하면 `null`(줄 없음) — 해외 단가가 정수 달러가 아니면(1달러 미만 등) 승인되지 않은 형식이라 적지 않는다.
 * 숫자만 들어가지만 이 파일의 규칙대로 동적 값은 전부 `h()` 를 통과한다.
 */
export function renderQuantityLine(q: QuantityLineView | null | undefined): string | null {
  if (q == null || typeof q !== 'object') return null;
  if (!Number.isInteger(q.quantity) || q.quantity < 1) return null;
  const qty = h(q.quantity.toLocaleString('ko-KR'));
  if (q.market === 'overseas') {
    if (!isPosFinite(q.unitUsd) || !Number.isInteger(q.unitUsd) || !isPosFinite(q.approxKrw)) return null;
    return `수량   ${qty}주 × $${h(q.unitUsd.toLocaleString('ko-KR'))}  (≈ ${h(won(q.approxKrw))})`;
  }
  if (q.market === 'domestic') {
    if (!isPosFinite(q.unitKrw) || !isPosFinite(q.totalKrw)) return null;
    return `수량   ${qty}주 × ${h(won(q.unitKrw))}  (= ${h(won(q.totalKrw))})`;
  }
  return null;
}

export interface RenderedMessage { text: string; keyboard: InlineKeyboard }

export function renderApprovalRequest(v: ApprovalRequestView, key: Buffer): RenderedMessage {
  const sideKo = v.side === 'buy' ? '매수' : '매도';
  const marketKo = v.market === 'overseas' ? '해외' : '국내';
  const lines: string[] = [];
  lines.push(`📩 <b>승인 요청</b> · ${sideKo} · ${marketKo}`);
  lines.push(`<b>${v.label}</b> (${h(v.symbol)})`);
  const title = strategyTitle(v.strategyId, v.exitKind);
  lines.push(v.reasonLine ? `${h(title)} — ${h(v.reasonLine)}` : h(title));
  lines.push('');

  const pct = v.totalAssetPct != null && Number.isFinite(v.totalAssetPct) ? ` (총자산의 ${v.totalAssetPct.toFixed(1)}%)` : '';
  lines.push(`금액   ${won(v.amountKRW)}${pct}`);

  // T-097 Q-E — "금액" 줄 바로 아래. 매수이고, 진입 구간(감시 등록 — 주문 단가·수량이 구간 도달 때 다시 정해진다)이 아니고,
  // 시장이 일치할 때만. 그 밖에는 줄 없음.
  if (v.side === 'buy' && !v.zone && v.quantityLine && v.quantityLine.market === v.market) {
    const q = renderQuantityLine(v.quantityLine);
    if (q) lines.push(q);
  }

  if (v.side === 'buy') {
    const parts: string[] = [];
    if (v.dailyRemainingKRW != null) parts.push(`오늘 한도 잔여 ${won(Math.max(0, v.dailyRemainingKRW))}`);
    if (v.cashKRW != null) {
      const short = v.cashNeededKRW != null && v.cashKRW < v.cashNeededKRW;
      parts.push(`현금 ${won(v.cashKRW)}${short ? ' ⚠ 부족' : ''}`);
    }
    if (parts.length) lines.push(parts.join('  ·  '));
  }

  if (v.zone) {
    lines.push(`진입 구간  ${v.zone[0].toLocaleString('ko-KR')} ~ ${v.zone[1].toLocaleString('ko-KR')}`);
    lines.push('승인하면  진입 감시 등록 (구간 도달 시 자동 주문)');
  } else {
    lines.push('승인하면  지정가 주문 (신호가 기준)');
  }

  if (v.expiresAt) {
    const mins = Math.max(0, Math.round((v.expiresAt.getTime() - v.now.getTime()) / 60_000));
    lines.push(`만료   ${kst(v.expiresAt)} KST  (${mins}분 남음)`);
  }

  const keyboard = buildDecisionKeyboard(key, v.signalId, v.signedAmountKRW ?? v.amountKRW, v.appUrl);
  return { text: lines.join('\n'), keyboard };
}

/** 승인/거절 버튼 (+ 선택적 앱 링크). 결정 뒤에도 같은 입력으로 똑같이 다시 만들 수 있다(HMAC 은 결정적). */
export function buildDecisionKeyboard(key: Buffer, signalId: number, amountKRW: number, appUrl?: string | null): InlineKeyboard {
  const rows: InlineKeyboard['inline_keyboard'] = [[
    { text: '✅ 승인', callback_data: encodeCallbackData(key, 'a', signalId, amountKRW) },
    { text: '❌ 거절', callback_data: encodeCallbackData(key, 'r', signalId, amountKRW) },
  ]];
  if (appUrl && /^https:\/\/[^\s]+$/i.test(appUrl)) rows.push([{ text: '🔗 앱에서 자세히', url: appUrl }]);
  return { inline_keyboard: rows };
}

// ─────────────────────────────────────────────────────────────────────────────
// 결과 (같은 메시지를 수정해 덮어쓴다)
// ─────────────────────────────────────────────────────────────────────────────

export type DecisionView =
  | { kind: 'order_placed'; orderId?: number; dryRun?: boolean }
  | { kind: 'entry_watch' }
  | { kind: 'order_rejected'; reason: string }
  /** 주문이 거래소에 접수됐는지 알 수 없다 — 시그널을 잠가 두었다 (이중 주문 방지) */
  | { kind: 'order_uncertain'; reason: string; orderId?: number }
  | { kind: 'rejected' }
  | { kind: 'expired' }
  | { kind: 'already_handled'; status: string }
  | { kind: 'kill_switch' }
  | { kind: 'changed' }
  | { kind: 'failed'; reason: string };

/** `label` 은 `ApprovalRequestView.label` 과 같은 계약 — 이미 이스케이프된 값이라 그대로 넣는다 */
export interface DecisionContext { label: string; side: 'buy' | 'sell'; amountKRW: number; now: Date }

const STATUS_KO: Readonly<Record<string, string>> = {
  approved: '승인됨',
  approved_pending_entry: '승인됨 (진입 감시 중)',
  executing: '주문 처리 중',
  rejected: '거절됨',
  expired: '만료됨',
  auto_submitted: '자동 제출됨',
  superseded: '다른 시그널로 대체됨',
};

/** 사람이 읽는 차단 사유. 모르는 코드는 그대로(이스케이프해서) 보인다 — 숨기지 않는다. */
export function describeOrderFailure(raw: string): string {
  const s = raw.replace(/^order_not_accepted:\s*/, '');
  if (/kill_switch|KILL_SWITCH/i.test(s)) return '모든거래차단이 켜져 있음';
  if (/insufficient/i.test(s)) return '현금 부족 (insufficient_balance)';
  if (/daily_limit/i.test(s)) return '일 한도 초과';
  if (/order_limit/i.test(s)) return '1회 한도 초과 또는 미설정';
  if (/symbol_not_allowed/i.test(s)) return '차단된 종목';
  return s || '알 수 없음';
}

/** 결정 결과 메시지. 버튼이 남는 상태인지(`keepButtons`)도 함께 돌려준다. */
export function renderDecision(d: DecisionView, c: DecisionContext): { text: string; keepButtons: boolean } {
  const head = `<b>${c.label}</b> · ${c.side === 'buy' ? '매수' : '매도'} ${won(c.amountKRW)}`;
  const at = kstDateTime(c.now);
  switch (d.kind) {
    case 'order_placed':
      return {
        keepButtons: false,
        text: `✅ <b>승인됨</b>  ${h(at)}\n${head}\n주문 접수${d.orderId != null ? ` #${h(d.orderId)}` : ''} · 지정가${d.dryRun ? ' (가상 주문 — 실제 주문 아님)' : ''}`,
      };
    case 'entry_watch':
      return { keepButtons: false, text: `✅ <b>승인됨</b>  ${h(at)}\n${head}\n진입 감시 등록 — 구간 도달 시 자동 주문` };
    case 'order_rejected':
      return {
        keepButtons: true,
        text: `⛔ <b>승인했지만 주문이 거부됨</b>  ${h(at)}\n${head}\n사유: ${h(clip(describeOrderFailure(d.reason)))}\n시그널은 만료 전까지 승인 대기로 남아 있습니다.`,
      };
    case 'order_uncertain':
      return {
        keepButtons: false,
        text: `⚠️ <b>주문 결과를 확인하지 못했습니다</b>  ${h(at)}\n${head}${d.orderId != null ? `\n주문 #${h(d.orderId)}` : ''}\n사유: ${h(clip(d.reason.replace(/^order_uncertain:\s*/, '')))}\n`
          + '거래소에 접수됐는지 알 수 없어 <b>이중 주문을 막으려고 이 시그널을 잠갔습니다.</b> KIS 체결/미체결 내역을 확인하세요. 다시 승인하지 마세요.',
      };
    case 'rejected':
      return { keepButtons: false, text: `❌ <b>거절됨</b>  ${h(at)}\n${head}\n같은 종목은 4시간 동안 다시 제안하지 않습니다.` };
    case 'expired':
      return { keepButtons: false, text: `⌛ <b>만료됨</b>  ${h(at)}\n${head}` };
    case 'already_handled':
      return { keepButtons: false, text: `ℹ️ <b>이미 처리된 시그널입니다</b> — ${h(STATUS_KO[d.status] ?? d.status)}\n${head}` };
    case 'kill_switch':
      return { keepButtons: true, text: `⛔ <b>모든거래차단이 켜져 있어 승인하지 않았습니다</b>  ${h(at)}\n${head}\n해제한 뒤 다시 누르거나 거절하세요.` };
    case 'changed':
      return { keepButtons: false, text: `⚠️ <b>시그널이 바뀌어 이 버튼은 더 이상 유효하지 않습니다</b>\n${head}\n앱에서 확인하세요.` };
    case 'failed':
      return { keepButtons: true, text: `⚠️ <b>처리하지 못했습니다</b>  ${h(at)}\n${head}\n사유: ${h(clip(d.reason))}\n앱에서 확인하거나 다시 시도하세요.` };
  }
}

/** 자가 점검 메시지 — 거래를 일으키지 않는 버튼. 실제 승인 요청과 같은 모양을 시험 값으로 보여 준다. */
export function renderSelfTest(key: Buffer, now: Date, appUrl?: string | null): RenderedMessage {
  const text = [
    '🧪 <b>승인 버튼 자가 점검</b>',
    '아래 버튼은 <b>거래를 일으키지 않습니다.</b> 눌러서 콜백 사슬이 동작하는지만 확인합니다.',
    '',
    '<i>(아래는 형식을 보이기 위한 시험 값입니다)</i>',
    '📩 <b>승인 요청</b> · 매수 · 해외',
    '<b>시험 종목</b> (TEST:000)',
    'RSI 과매도 반등 — RSI14=37.4 &lt; 38',
    '금액   ₩1,000,000 (총자산의 4.3%)',
    '승인하면  지정가 주문 (신호가 기준)',
    `확인 시각  ${h(kstDateTime(now))} KST`,
  ].join('\n');
  const keyboard: InlineKeyboard = {
    inline_keyboard: [[{ text: '🧪 점검 확인', callback_data: encodeCallbackData(key, 't', 0, 0) }]],
  };
  // 실제 요청과 같은 링크 버튼을 달아 둔다 — 텔레그램이 거부하는 URL 이면 이 점검 메시지가 400 으로 실패해
  // 기능을 켜기 **전에** 잡힌다 (켠 뒤에는 모든 요청 키보드가 400 이 되어 버튼 없는 메시지로 대체된다).
  if (appUrl && /^https:\/\/[^\s]+$/i.test(appUrl)) keyboard.inline_keyboard.push([{ text: '🔗 앱에서 자세히', url: appUrl }]);
  return { text, keyboard };
}

export function renderSelfTestDone(now: Date): string {
  return `🧪 <b>자가 점검 통과</b>  ${h(kstDateTime(now))}\n버튼 → 콜백 수신 → 발신자·서명 검증 → 응답이 정상입니다. 거래는 일어나지 않았습니다.`;
}
