/**
 * 승인 요청 알림 발송 (T-042) — `createSignal` 이 승인 대기 시그널을 만들 때 부른다.
 *
 * 하는 일 (순서가 계약):
 *  1. `notify_signal_pending` 이 꺼져 있으면 아무것도 보내지 않는다 (기존 스위치 존중)
 *  2. 매수인데 **지금 실행될 수 없으면**(현금 부족·한도 초과) **알림을 보내지 않고 서버 로그 1줄만** 남긴다
 *     (T-044 — T-042 D2-b 의 시간당 요약을 제거. 생략은 `notify_skip_unexecutable` 가 키 없음 또는 정확히 `true` 일 때만이고,
 *      그 밖의 값·읽기 오류면 실행 불가여도 개별 요청을 보낸다. 실시간 현금 부족 매수는 T-058 게이트가 시그널 자체를 만들지 않는다)
 *  3. 버튼 승인이 켜져 있으면(`telegram_approval_enabled` + 서명 키) 풍부한 본문 + 버튼, 아니면 **기존과 같은 간단한 본문**
 *
 * 🔴 두 형식 모두 모든 동적 값을 이스케이프한다 — 이전 본문은 사유 줄의 `<` 때문에 텔레그램이 400 으로 거부해
 *    2026-09-21~10-10 사이 승인 요청의 약 78% 가 도착하지 않았다. 버튼 스위치가 꺼져 있어도 이 수정은 적용된다.
 *
 * 간단한 본문(스위치 꺼짐)은 일부러 **기존 형식 그대로**다 — 사용자가 목업을 확인하고 켜기 전에는 보이는 모양이 바뀌지 않는다.
 */
import { escapeAlertText } from '../notify/escape';
import { dispatchAlertWithTelegram, getSymbolLabel, sendAlert } from '../notify';
import { NOTIFY_OK, NOTIFY_SKIPPED, notifyFailed, type NotifyResult } from '../notify/result';
import { sendTelegramAlert } from '../notify/telegram';
import { sendTelegramMessage, type BotCallResult, type InlineKeyboard, type SentMessage } from '../notify/telegram-api';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { getSessionSecret } from '@/lib/auth/session';
import type { Market } from '@/lib/exchanges/kis-symbols';
import { roundToTick } from '@/lib/exchanges/kis-domestic';
import { assessExecutability, type ExecutabilityAssessment, type NonExecutableReason } from './approval-context';
import { renderApprovalRequest, strategyTitle, type ApprovalRequestView, type QuantityLineView } from './approval-message';
import { extractEntryZone } from './approval-transitions';
import { judgeFxRow, overseasLimitUnitUsd } from './signal-cash-gate';
import { computeRealizedKrw, readSizingSnapshot } from './sizing-snapshot';
import { deriveApprovalKey } from './telegram-callback-data';
import { displayExitReason } from './exit-reason-display';

const h = (v: unknown): string => escapeAlertText(typeof v === 'string' ? v : v == null ? '' : String(v));

export interface ApprovalNotifyArgs {
  signalId: number;
  symbol: string;
  side: 'buy' | 'sell';
  amountKRW: number;
  price?: number;
  /**
   * T-097 Q-E — 시그널 주문 유형. "수량" 줄은 `'limit'` 일 때만 만든다(시장가·미전달은 줄 없음 — `buildQuantityLine` 머리말).
   * 선택 항목 — 옛 호출부가 넘기지 않으면 줄이 빠질 뿐 알림·버튼·서명은 그대로다.
   */
  orderType?: 'limit' | 'market';
  strategyId?: string | null;
  reasoning?: string;
  indicators: unknown;
  market: Market;
  expiresAt: Date | null;
}

export type NotifyOutcome =
  | { kind: 'disabled_flag' }
  | { kind: 'suppressed'; reasons: NonExecutableReason[] }
  | { kind: 'sent'; format: 'plain' | 'buttons' };

export interface NotifyDeps {
  now(): Date;
  pendingFlag(): Promise<boolean>;
  skipUnexecutable(): Promise<boolean>;
  buttons(): Promise<{ key: Buffer | null; enabled: boolean; appUrl: string | null }>;
  /** 종목명 — 이미 이스케이프된 값을 돌려준다(`getSymbolLabel` 계약) */
  label(symbol: string): Promise<string>;
  /** DB 에 저장된 시그널 금액 — 버튼 서명에 쓴다. 못 읽으면 null (입력 금액으로 대체) */
  storedAmount(signalId: number): Promise<number | null>;
  assess: typeof assessExecutability;
  /** 간단한 본문 — 기존과 같은 경로 (채널 정책·텔레그램 재시도 그대로) */
  sendPlain(level: 'info', title: string, body: string): void;
  /** 버튼이 달린 본문 — 채널 정책·슬랙 동시 전송은 `dispatchAlertWithTelegram` 이 지킨다 */
  sendRich(title: string, plainBody: string, text: string, keyboard: InlineKeyboard): Promise<void>;
  /**
   * T-097 Q-E — 해외 "수량" 줄의 정수 달러 단가용 USD/KRW 환율. 현금 게이트(T-058 `readGateUsdKrwRate`)와 같은 `fx_rates` 행·같은
   * 신선도·타당성 판정(`judgeFxRow`)이고, 외부 환율 조회를 유도하지 않는다. 모르면 `null` → 해외 "수량" 줄 생략.
   * 선택 항목 — 없으면 해외 줄을 적지 않는다.
   */
  fxRate?(): Promise<number | null>;
}

// ─────────────────────────────────────────────────────────────────────────────
// T-097 Q-E "수량" 줄 값
// ─────────────────────────────────────────────────────────────────────────────

/** 해외 지정가 매수이고 기록된 수량·단가가 있어 "수량" 줄에 환율이 필요한가 — 필요 없으면(시장가 포함) 환율을 읽지 않는다. */
function quantityLineNeedsFx(a: Pick<ApprovalNotifyArgs, 'side' | 'market' | 'indicators' | 'orderType'>): boolean {
  if (a.orderType !== 'limit') return false;
  if (a.side !== 'buy' || a.market !== 'overseas') return false;
  const s = readSizingSnapshot(a.indicators);
  return s != null && s.quantity != null && s.quantity >= 1 && s.unitPriceKrw != null;
}

/**
 * 시그널의 `indicators.sizing`(T-097 1단계 기록)으로 "수량" 줄 값을 만든다. 순수 함수.
 * 줄이 없는 경우(`null`): 지정가가 아님(시장가·`orderType` 미전달 — 아래) · 매도 · `sizing` 없음(옛 시그널·카드)·규칙 버전 다름 ·
 * 수량 0/미확정 · 단가·실현액 없음 · 해외인데 환율 모름 · 정수 달러 단가를 만들 수 없음(1달러 미만 포함 — 승인된 형식이 아니다).
 * 시장가 매수를 빼는 이유(T-097 Q-E Codex C2): 아래 단가 계산은 지정가 송신가와 같은 계산이고, 시장가는 송신가가 다르다 —
 * 국내 어댑터는 시장가에 `ORD_UNPR: req.type === 'market' ? '0' : String(roundToTick(price))`(`kis-domestic.ts` createOrder)로 단가 0 을 보내고,
 * 해외 어댑터는 시장가를 지정가로 바꾸면서 `req.type === 'market' ? (isBuy ? usdPrice * 1.005 : usdPrice * 0.995) : usdPrice`
 * (`kis-overseas.ts` createOrder — 매수 +0.5%)를 더 적용해 이 계산에 없는 더 높은 가격이 나간다. 승인된 데모는 지정가 매수의 줄이다.
 * 표시 전용이라 모르는 값(미전달 포함)은 줄을 빼는 쪽(fail-closed)으로 둔다.
 * 해외 정수 달러 단가는 어댑터와 같은 계산(`overseasLimitUnitUsd`), 괄호 금액은 `computeRealizedKrw`(수량 × 정수 달러 × 환율)를 그대로 쓴다.
 * 국내 단가는 어댑터의 호가단위 반올림(`roundToTick` — 같은 함수), "=" 금액은 그 단가 × 수량.
 */
export function buildQuantityLine(args: {
  side: 'buy' | 'sell';
  market: Market;
  orderType?: 'limit' | 'market';
  indicators: unknown;
  fxRate?: number | null;
}): QuantityLineView | null {
  if (args.orderType !== 'limit') return null;
  if (args.side !== 'buy') return null;
  const s = readSizingSnapshot(args.indicators);
  if (s == null) return null;
  const q = s.quantity;
  if (q == null || !Number.isInteger(q) || q < 1) return null;
  if (s.unitPriceKrw == null || s.realizedKrw == null) return null;
  if (args.market === 'domestic') {
    // 단가는 어댑터가 실제로 송신하는 가격(`kis-domestic.ts` createOrder 의 `ORD_UNPR = roundToTick(price)` — 호가단위 가장 가까운 값)을
    // 같은 함수로 만들고, "=" 금액은 그 단가 × 수량이다. 기록된 단가(호가 추격 반영)를 그대로 쓰면 송신가와 달라진다(T-097 Q-E Leader 결정 ①).
    const unitKrw = roundToTick(s.unitPriceKrw);
    if (!Number.isFinite(unitKrw) || unitKrw <= 0) return null;
    return { market: 'domestic', quantity: q, unitKrw, totalKrw: q * unitKrw };
  }
  if (args.market === 'overseas') {
    const fx = args.fxRate;
    if (typeof fx !== 'number' || !Number.isFinite(fx) || fx <= 0) return null;
    const unitUsd = overseasLimitUnitUsd(s.unitPriceKrw, fx);
    if (unitUsd == null || !Number.isInteger(unitUsd) || unitUsd < 1) return null;
    const approxKrw = computeRealizedKrw({ market: 'overseas', quantity: q, unitPriceKrw: s.unitPriceKrw, fxRate: fx });
    if (approxKrw == null || !Number.isFinite(approxKrw) || approxKrw <= 0) return null;
    return { market: 'overseas', quantity: q, unitUsd, approxKrw };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 간단한 본문 (기존 형식 + 이스케이프)
// ─────────────────────────────────────────────────────────────────────────────

const EXIT_LABEL: Record<string, string> = {
  hard_stop: '🔴 손실한도 손절 (자금보호)',
  target_profit: '🟢 목표 익절',
  trailing_stop: '🟡 트레일링 스탑',
  eod_loss_cut: '🔴 장마감 전 손절',
};

function readExitKind(indicators: unknown): string | undefined {
  if (indicators == null || typeof indicators !== 'object') return undefined;
  const v = (indicators as Record<string, unknown>)['exit_kind'];
  return typeof v === 'string' ? v : undefined;
}

/**
 * 사유 핵심 한 줄 (기존 규칙 그대로): exit 는 첫 줄, AI 선택은 `[AI N%]` 줄 우선, 그 외 첫 비어있지 않은 줄 — 100자.
 * T-128 A4 — 고른 줄의 청산 앞머리(`[하드 손절]`·`[EOD 손절]`)는 표시 용어로 바꾼 뒤 자른다(`displayExitReason` — 저장 텍스트는 그대로).
 * 간단 본문 「사유:」 와 버튼 본문(`approval-message.ts` reasonLine)이 모두 이 함수를 거친다.
 */
export function pickReasonLine(reasoning: string | undefined, exitKind: string | undefined): string | undefined {
  if (!reasoning) return undefined;
  const lines = reasoning.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return undefined;
  if (exitKind) return displayExitReason(lines[0]).slice(0, 100);
  return displayExitReason(lines.find((l) => l.startsWith('[AI ')) ?? lines[0]).slice(0, 100);
}

/** `label` 은 `getSymbolLabel` 의 반환값 — **이미 이스케이프돼 있다.** 다시 이스케이프하면 `&amp;amp;` 가 된다(2라운드 감사 R2-1). */
export function renderPlainRequest(a: ApprovalNotifyArgs, label: string, now: Date): { title: string; body: string } {
  const exitKind = readExitKind(a.indicators);
  const ttlMin = a.expiresAt ? Math.round((a.expiresAt.getTime() - now.getTime()) / 60_000) : 30;
  const reasonLine = pickReasonLine(a.reasoning, exitKind);
  const body = [
    `${a.side === 'buy' ? '매수' : '매도'} ₩${Math.round(a.amountKRW).toLocaleString('ko-KR')} · TTL ${ttlMin}분`,
    exitKind && EXIT_LABEL[exitKind] ? `유형: ${EXIT_LABEL[exitKind]}` : undefined,
    reasonLine ? `사유: ${h(reasonLine)}` : undefined,
  ].filter(Boolean).join('\n');
  return { title: `📩 승인 요청: ${label}`, body };
}

// ─────────────────────────────────────────────────────────────────────────────
// 본체
// ─────────────────────────────────────────────────────────────────────────────

export async function notifyApprovalRequest(a: ApprovalNotifyArgs, deps: NotifyDeps = defaultDeps()): Promise<NotifyOutcome> {
  if (!(await deps.pendingFlag())) return { kind: 'disabled_flag' };

  const now = deps.now();
  // 조회 실패 시 대신 쓰는 원본 심볼은 여기서 이스케이프한다 (정상 경로의 라벨은 이미 안전한 값이다)
  const label = await deps.label(a.symbol).catch(() => h(a.symbol));

  // T-044: 실행 불가 매수는 알림을 아무것도 보내지 않는다(요약도 없음 — T-042 D2-b 의 요약을 사용자 요구로 제거).
  // 판정 실패·불확실은 "실행 가능"(보낸다) — 알림을 줄이는 쪽이라 의심스러우면 보낸다. 매도는 판정하지 않는다(항상 보낸다).
  let assessment: ExecutabilityAssessment | null = null;
  if (a.side === 'buy' && (await deps.skipUnexecutable().catch(() => false))) {
    assessment = await deps.assess({ symbol: a.symbol, side: a.side, amountKRW: a.amountKRW, price: a.price, now: now.getTime() }).catch(() => null);
    if (assessment && !assessment.executable) {
      // 조용히 사라지지 않게 서버 로그 1줄 — 알림 채널이 아니다. 금액·잔고 등 수치는 싣지 않는다.
      console.info(`[approval-notify] 실행 불가 매수 알림 생략: signal ${a.signalId} ${a.symbol} reasons=${assessment.reasons.join(',')}`);
      return { kind: 'suppressed', reasons: assessment.reasons };
    }
  }

  const plain = renderPlainRequest(a, label, now);
  const btn = await deps.buttons().catch(() => ({ key: null, enabled: false, appUrl: null }));
  if (!btn.enabled || !btn.key) {
    deps.sendPlain('info', plain.title, plain.body);
    return { kind: 'sent', format: 'plain' };
  }

  const exitKind = readExitKind(a.indicators);
  const view: ApprovalRequestView = {
    signalId: a.signalId, label, symbol: a.symbol, market: a.market, side: a.side, amountKRW: a.amountKRW,
    strategyId: a.strategyId, exitKind, reasonLine: pickReasonLine(a.reasoning, exitKind),
    zone: extractEntryZone(a.indicators), expiresAt: a.expiresAt, now,
    totalAssetPct: assessment?.ctx.totalKRW ? (a.amountKRW / assessment.ctx.totalKRW) * 100 : null,
    dailyRemainingKRW: assessment?.ctx.dailyRemainingKRW ?? null,
    cashKRW: assessment?.ctx.cashKRW ?? null, cashNeededKRW: a.amountKRW, appUrl: btn.appUrl,
  };
  // 🔴 서명은 DB 에 *저장된* 금액으로 한다 — 탭할 때 서버가 그 값으로 다시 계산한다(DECIMAL 반올림 차이 방지).
  view.signedAmountKRW = await deps.storedAmount(a.signalId).catch(() => null);
  // T-097 Q-E — "수량" 줄. 표시 전용이라 어떤 실패도 줄을 빼는 것으로 끝난다(알림·버튼·서명에 영향 없음).
  try {
    const fx = quantityLineNeedsFx(a) && deps.fxRate ? await deps.fxRate().catch(() => null) : null;
    view.quantityLine = buildQuantityLine({ side: a.side, market: a.market, orderType: a.orderType, indicators: a.indicators, fxRate: fx });
  } catch {
    view.quantityLine = null;
  }
  const rich = renderApprovalRequest(view, btn.key);
  await deps.sendRich(plain.title, plain.body, rich.text, rich.keyboard);
  return { kind: 'sent', format: 'buttons' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 기본 배선
// ─────────────────────────────────────────────────────────────────────────────

async function readConfig(key: string): Promise<unknown> {
  try {
    const [rows] = await getPool().query<(RowDataPacket & { value: string })[]>(
      'SELECT value FROM system_config WHERE `key` = ? LIMIT 1', [key],
    );
    if (rows.length === 0) return undefined;
    try { return JSON.parse(rows[0].value); } catch { return rows[0].value; }
  } catch { return undefined; }
}

/**
 * `readConfig` 와 달리 **읽기 오류를 "키 없음"과 구분한다**(T-044 Codex low). 알림을 줄이는 스위치는
 * 오류를 기본값(켜짐 = 생략)으로 합치면 "모르는데 줄이는" 방향이 된다.
 */
async function readConfigState(key: string): Promise<{ state: 'missing' } | { state: 'value'; value: unknown } | { state: 'error' }> {
  try {
    const [rows] = await getPool().query<(RowDataPacket & { value: string })[]>(
      'SELECT value FROM system_config WHERE `key` = ? LIMIT 1', [key],
    );
    if (rows.length === 0) return { state: 'missing' };
    try { return { state: 'value', value: JSON.parse(rows[0].value) }; } catch { return { state: 'value', value: rows[0].value }; }
  } catch { return { state: 'error' }; }
}

/**
 * `notify_skip_unexecutable` — **키 없음 또는 정확히 JSON 불리언 `true` 일 때만** 생략한다(기본 켜짐은 유지).
 * 그 밖의 값(`false`·문자열 `"false"`/`"true"`·0·null·파싱 불가)과 읽기 오류는 "불확실 → 보낸다"(T-044 Codex low).
 * 예전에는 `!== false` 로 읽어 `"false"`·0·null 같은 비정상 값이 생략을 켰다.
 */
export function skipUnexecutableFromConfig(c: { state: 'missing' } | { state: 'value'; value: unknown } | { state: 'error' }): boolean {
  if (c.state === 'missing') return true;
  if (c.state === 'value') return c.value === true;
  return false;
}

const toNotifyResult = (r: BotCallResult<SentMessage>): NotifyResult =>
  r.ok ? NOTIFY_OK : r.skipped ? NOTIFY_SKIPPED : notifyFailed(r.error);

export function defaultDeps(): NotifyDeps {
  return {
    now: () => new Date(),
    pendingFlag: async () => {
      const v = await readConfig('notify_signal_pending');
      return v === undefined ? true : Boolean(v);              // 기존 기본값: 켜짐
    },
    skipUnexecutable: async () => skipUnexecutableFromConfig(await readConfigState('notify_skip_unexecutable')),   // 키 없음·true 만 켜짐
    buttons: async () => {
      const [enabled, url] = await Promise.all([readConfig('telegram_approval_enabled'), readConfig('app_public_url')]);
      return {
        key: deriveApprovalKey(getSessionSecret()),
        enabled: enabled === true,
        appUrl: typeof url === 'string' && url.trim() ? url.trim() : null,
      };
    },
    label: (s) => getSymbolLabel(s),
    storedAmount: async (signalId) => {
      const [rows] = await getPool().query<RowDataPacket[]>('SELECT amount_krw FROM signals WHERE id = ? LIMIT 1', [signalId]);
      const n = Number(rows[0]?.amount_krw);
      return Number.isFinite(n) ? n : null;
    },
    assess: assessExecutability,
    // 현금 게이트 `readGateUsdKrwRate` ②와 같은 행·같은 판정. ①(fx.ts 갱신 유도 — 외부 조회 가능)은 하지 않는다: 표시 줄 하나 때문에
    // 외부 호출을 늘리지 않는다. 해외 매수 시그널은 생성 직전 현금 게이트가 이미 갱신을 유도했다(게이트가 켜져 있을 때).
    fxRate: async () => {
      const [rows] = await getPool().query<RowDataPacket[]>(
        'SELECT rate, TIMESTAMPDIFF(SECOND, fetched_at, NOW()) AS age_sec FROM fx_rates WHERE pair = ? LIMIT 1',
        ['USD_KRW'],
      );
      const row = (rows ?? [])[0];
      if (!row) return null;
      const r = judgeFxRow(row.rate, row.age_sec);
      return r.kind === 'known' ? r.rate : null;
    },
    sendPlain: (level, title, body) => sendAlert(level, title, body),
    sendRich: async (title, plainBody, text, keyboard) => {
      await dispatchAlertWithTelegram('info', title, plainBody, async () => {
        const r = await sendTelegramMessage(text, keyboard);
        if (r.ok || r.skipped) return toNotifyResult(r);
        // 버튼 메시지가 실패하면 버튼 없는 간단한 본문으로라도 알린다 (앱에서 승인할 수 있다)
        console.error(`[approval-notify] 버튼 메시지 전송 실패 → 간단한 본문으로 대체: ${r.error}`);
        return sendTelegramAlert('info', title, plainBody);
      });
    },
  };
}
