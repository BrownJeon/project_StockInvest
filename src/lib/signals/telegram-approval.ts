/**
 * 텔레그램 버튼(승인·거절) 콜백 처리기 (T-042).
 *
 * 🔴 **버튼 한 번이 곧 거래 승인이다.** 이 파일이 그 문의 경비다. 순서가 계약이다:
 *
 *   1. 형식 확인 — 우리 접두(`si1:`)가 아니면 **조용히 무시**(같은 봇을 쓰는 다른 프로젝트의 콜백일 수 있다)
 *   2. 발신자 확인 — 눌린 사람(`from.id`)과 채팅(`message.chat.id`)이 소유자 허용 목록에 있는가. **상태를 읽기 전에.**
 *   3. 기능 스위치 — `telegram_approval_enabled`. 꺼져 있으면 거래 동작은 하지 않는다(자가 점검 `t` 만 예외).
 *   4. 서명 확인 — 서명은 **지금 DB 의 금액**으로 다시 계산한다. 보여 준 금액과 지금 금액이 다르면 거부.
 *   5. 상태 재확인 — 이미 처리됐는가, 만료됐는가, 킬스위치가 켜져 있는가 (오래된 메시지의 버튼도 안전해야 한다)
 *   6. 원자적 전이 — `approve`/`reject` 는 조건부 UPDATE 로 한 쪽만 이긴다(`approval-transitions.ts`)
 *   7. 결과를 **같은 메시지에 반영**하고(버튼 제거/유지) 감사 기록을 남긴다
 *
 * 안전층은 건드리지 않는다: 승인은 기존 `approveSignal`/`approveSignalHybrid`(→ `submitOrder` 게이트)를 그대로 부른다.
 * 이 파일은 DB·텔레그램·시계를 직접 import 하지 않는다 — 전부 `ApprovalDeps` 로 주입받아 분기별로 시험한다.
 */
import { escapeAlertText } from '../notify/escape';
import type { TelegramCallbackQuery } from '../notify/telegram-api';
import {
  buildDecisionKeyboard,
  renderDecision,
  renderSelfTestDone,
  type DecisionContext,
  type DecisionView,
} from './approval-message';
import { resolveApprovalPath, type ApprovalPath } from './approval-transitions';
import { isAwaitingApproval } from './statuses';
import { parseCallbackData, verifyCallbackData } from './telegram-callback-data';

export interface ApprovalSignalView {
  id: number;
  status: string;
  symbol: string;
  side: 'buy' | 'sell';
  amount_krw: string | number;
  indicators: unknown;
  expires_at?: Date | string | null;
}

export interface ApproveOutcome {
  ok: boolean;
  orderId?: number;
  dryRun?: boolean;
  error?: string;
  errorCode?: string;
}

export interface ApprovalDeps {
  /** 서명 키. 없으면(비밀 미설정) 모든 거래 동작을 거부한다. */
  key: Buffer | null;
  now(): Date;
  /** `telegram_approval_enabled` */
  enabled(): Promise<boolean>;
  allowedUserIds(): Promise<ReadonlySet<string>>;
  allowedChatIds(): Promise<ReadonlySet<string>>;
  getSignal(id: number): Promise<ApprovalSignalView | null>;
  isKillSwitchActive(): Promise<boolean>;
  isHybridEnabled(): Promise<boolean>;
  approve(id: number, path: ApprovalPath): Promise<ApproveOutcome>;
  reject(id: number): Promise<{ ok: boolean; error?: string }>;
  /** 종목명 — **이미 이스케이프된 값**(`getSymbolLabel` 계약). 결과 메시지에 그대로 들어간다 */
  label(symbol: string): Promise<string>;
  appUrl(): Promise<string | null>;
  audit(event: string, payload: Record<string, unknown>): Promise<void>;
  /** 허용 목록 밖에서 누른 경우(공유 봇 토큰 유출 징후) */
  onUnauthorized?(info: { fromId: number; chatId: number | undefined; action: string }): void;
  telegram: {
    answer(queryId: string, text?: string, showAlert?: boolean): Promise<unknown>;
    edit(chatId: number, messageId: number, text: string, keepKeyboard?: ReturnType<typeof buildDecisionKeyboard>): Promise<unknown>;
    /** 본문은 두고 버튼만 제거 — 이미 처리된 메시지의 첫 결과(주문 번호)를 덮어쓰지 않으려고 */
    clearKeyboard(chatId: number, messageId: number): Promise<unknown>;
    /** 결과 수정이 실패했을 때 새 메시지로 결과를 알린다 */
    send(text: string, keyboard?: ReturnType<typeof buildDecisionKeyboard>): Promise<unknown>;
  };
}

export type HandleOutcome =
  | { kind: 'ignored' }
  | { kind: 'denied' }
  | { kind: 'no_key' }
  | { kind: 'disabled' }
  | { kind: 'selftest' }
  | { kind: 'invalid'; reason: 'not_found' | 'bad_signature' }
  | { kind: 'decision'; action: 'approve' | 'reject'; view: DecisionView; path?: ApprovalPath };

/**
 * 텔레그램 호출은 실패해도 처리 결과를 바꾸지 않는다 — 이미 DB 에 반영된 거래 결정을 되돌릴 수 없다.
 * 성공 여부를 돌려준다: Bot API 클라이언트는 던지지 않고 `{ ok: false }` 를 **돌려주므로** 예외만 잡으면 실패를 놓친다
 * (T-042 감사 D-4). 호출처는 결과 수정이 실패했을 때 새 메시지로 대체한다.
 */
async function safe(p: Promise<unknown> | undefined): Promise<boolean> {
  try {
    const r = await p;
    if (r !== null && typeof r === 'object' && (r as { ok?: unknown }).ok === false) {
      const err = String((r as { error?: unknown }).error ?? 'unknown');
      // 같은 내용으로 다시 수정하면 텔레그램이 400 을 준다 — 실패가 아니라 이미 그 상태다
      if (/message is not modified/i.test(err)) return true;
      console.error(`[telegram-approval] 텔레그램 호출 실패: ${err.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[telegram-approval] 텔레그램 호출 예외:', e instanceof Error ? e.message : String(e));
    return false;
  }
}

/** 서비스 계층의 실패 코드를 사람에게 보일 결과로 옮긴다. */
export function mapFailure(error: string | undefined, errorCode?: string): DecisionView {
  const e = error ?? '';
  if (errorCode === 'order_uncertain' || e.startsWith('order_uncertain')) return { kind: 'order_uncertain', reason: e };
  if (errorCode === 'order_not_accepted' || e.startsWith('order_not_accepted')) return { kind: 'order_rejected', reason: e };
  if (e === 'signal_expired') return { kind: 'expired' };
  if (e.startsWith('invalid_status:')) {
    const status = e.slice('invalid_status:'.length);
    return status === 'expired' ? { kind: 'expired' } : { kind: 'already_handled', status };
  }
  if (e === 'transition_conflict') return { kind: 'failed', reason: '동시에 처리되었습니다 — 앱에서 상태를 확인하세요' };
  if (e === 'not_found') return { kind: 'failed', reason: '시그널을 찾을 수 없습니다' };
  if (errorCode === 'quantity_below_min' || e.startsWith('quantity_below_min')) {
    return { kind: 'failed', reason: '1주도 살 수 없는 금액입니다 (quantity_below_min)' };
  }
  return { kind: 'failed', reason: e || '알 수 없는 오류' };
}

export async function handleCallbackQuery(cq: TelegramCallbackQuery, deps: ApprovalDeps): Promise<HandleOutcome> {
  // 1. 우리 형식인가
  const parsed = parseCallbackData(cq.data);
  if (!parsed) return { kind: 'ignored' };

  const chatId = cq.message?.chat.id;
  const messageId = cq.message?.message_id;

  // 2. 발신자 — 상태를 읽기 전에
  const [users, chats] = await Promise.all([deps.allowedUserIds(), deps.allowedChatIds()]);
  const senderOk = cq.from.is_bot !== true && users.has(String(cq.from.id));
  const chatOk = chatId != null && chats.has(String(chatId));
  if (!senderOk || !chatOk) {
    await safe(deps.audit('telegram_callback_denied', { fromId: cq.from.id, chatId: chatId ?? null, action: parsed.action, signalId: parsed.signalId }));
    try { deps.onUnauthorized?.({ fromId: cq.from.id, chatId, action: parsed.action }); } catch { /* 경보 실패가 응답을 막지 않는다 */ }
    await safe(deps.telegram.answer(cq.id, '권한이 없습니다', true));
    return { kind: 'denied' };
  }

  // 서명 키가 없으면 검증할 수단이 없다 — 거래 동작은 전부 거부 (fail-closed)
  if (!deps.key) {
    await safe(deps.telegram.answer(cq.id, '버튼 승인을 사용할 수 없습니다 (서버 설정). 앱에서 처리하세요', true));
    return { kind: 'no_key' };
  }

  // 자가 점검: 거래 없음. 기능 스위치가 꺼져 있어도 동작해야 켜기 전에 사슬을 시험할 수 있다.
  if (parsed.action === 't') {
    if (parsed.signalId !== 0 || !verifyCallbackData(deps.key, parsed, 0)) {
      await safe(deps.telegram.answer(cq.id, '버튼이 유효하지 않습니다', true));
      return { kind: 'invalid', reason: 'bad_signature' };
    }
    await safe(deps.telegram.answer(cq.id, '✅ 점검 통과'));
    if (chatId != null && messageId != null) await safe(deps.telegram.edit(chatId, messageId, renderSelfTestDone(deps.now())));
    await safe(deps.audit('telegram_selftest_ok', { fromId: cq.from.id, chatId: chatId ?? null }));
    return { kind: 'selftest' };
  }

  // 3. 기능 스위치
  if (!(await deps.enabled())) {
    await safe(deps.telegram.answer(cq.id, '버튼 승인이 꺼져 있습니다. 앱에서 처리하세요', true));
    return { kind: 'disabled' };
  }

  // 4. 서명 — 지금 DB 의 금액으로 다시 계산
  const row = await deps.getSignal(parsed.signalId);
  if (!row) {
    await safe(deps.telegram.answer(cq.id, '시그널을 찾을 수 없습니다', true));
    return { kind: 'invalid', reason: 'not_found' };
  }
  const amountKRW = Number(row.amount_krw);
  const ctxBase = { side: row.side, amountKRW, now: deps.now() };
  if (!verifyCallbackData(deps.key, parsed, amountKRW)) {
    await safe(deps.audit('telegram_callback_bad_signature', { signalId: row.id, action: parsed.action, fromId: cq.from.id }));
    await safe(deps.telegram.answer(cq.id, '버튼이 유효하지 않습니다', true));
    if (chatId != null && messageId != null) {
      const label = await deps.label(row.symbol).catch(() => escapeAlertText(row.symbol));
      await safe(deps.telegram.edit(chatId, messageId, renderDecision({ kind: 'changed' }, { ...ctxBase, label }).text));
    }
    return { kind: 'invalid', reason: 'bad_signature' };
  }

  const label = await deps.label(row.symbol).catch(() => escapeAlertText(row.symbol));
  const ctx: DecisionContext = { ...ctxBase, label };
  const action = parsed.action === 'a' ? 'approve' : 'reject';

  const audit = (result: string, path?: ApprovalPath) => safe(deps.audit('signal_decision_channel', {
    signalId: row.id, action, via: 'telegram', fromId: cq.from.id, chatId: chatId ?? null, result, path: path ?? null,
  }));

  // 5. 상태 재확인 — **읽기만 하는 빠른 판정**. 거래 동작이 없으므로 콜백 응답 한 번으로 끝낸다.
  //    (진짜 보증은 6의 원자적 전이. 여기서 걸러내는 건 오래된 메시지의 버튼이 불필요하게 거래 경로를 타지 않게 하려는 것)
  const actionable = isAwaitingApproval(row.status) || (action === 'reject' && row.status === 'detected');
  if (!actionable) {
    if (row.status === 'expired') {
      await safe(deps.telegram.answer(cq.id, '⌛ 만료된 시그널입니다'));
      if (chatId != null && messageId != null) await safe(deps.telegram.edit(chatId, messageId, renderDecision({ kind: 'expired' }, ctx).text));
      await audit('expired');
      return { kind: 'decision', action, view: { kind: 'expired' } };
    }
    // 🔴 이미 처리된 시그널은 본문을 덮어쓰지 않는다 — 첫 처리의 결과(주문 번호 등)가 사라진다(감사 D-4). 토스트 + 버튼 제거만.
    const view: DecisionView = { kind: 'already_handled', status: row.status };
    await safe(deps.telegram.answer(cq.id, renderDecision(view, ctx).text.split('\n')[0].replace(/<\/?b>/g, ''), true));
    if (chatId != null && messageId != null) await safe(deps.telegram.clearKeyboard(chatId, messageId));
    await audit('already_handled');
    return { kind: 'decision', action, view };
  }
  if (action === 'approve' && (await deps.isKillSwitchActive())) {
    // 메시지는 그대로 두고(버튼 유지 — 해제 후 다시 누를 수 있게) 토스트로만 알린다
    await safe(deps.telegram.answer(cq.id, '⛔ 킬스위치가 켜져 있어 승인할 수 없습니다. 해제 후 다시 누르거나 거절하세요', true));
    await audit('kill_switch');
    return { kind: 'decision', action, view: { kind: 'kill_switch' } };
  }

  // Telegram 의 콜백 응답 제한 시간(약 15초)을 지키려고 거래 처리 **전에** 먼저 응답한다(한 번만 가능).
  // 결과는 메시지 수정으로 보여 준다.
  await safe(deps.telegram.answer(cq.id, '처리 중…'));

  let view: DecisionView;
  let path: ApprovalPath | undefined;
  try {
    if (action === 'reject') {
      const r = await deps.reject(row.id);
      view = r.ok ? { kind: 'rejected' } : mapFailure(r.error);
    } else {
      path = resolveApprovalPath({ hybridEnabled: await deps.isHybridEnabled(), indicators: row.indicators });
      const r = await deps.approve(row.id, path);
      if (r.ok) view = path === 'hybrid' ? { kind: 'entry_watch' } : { kind: 'order_placed', orderId: r.orderId, dryRun: r.dryRun };
      else view = mapFailure(r.error, r.errorCode);
      if (view.kind === 'order_uncertain' && view.orderId == null && r.orderId != null) view = { ...view, orderId: r.orderId };
    }
  } catch (e) {
    // 서비스 계층은 선점을 되돌린 뒤 예외를 전파한다. 사용자에게는 실패를 알리고 버튼을 남겨 다시 판단하게 한다.
    view = { kind: 'failed', reason: e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120) };
  }

  // 7. 결과 반영 + 감사. 🔴 결과 수정이 실패하면 새 메시지로 대체한다 — "처리 중…" 토스트만 보고 실주문이 나갔는지 모르는 상태를 만들지 않는다.
  const rendered = renderDecision(view, ctx);
  if (chatId != null && messageId != null) {
    const keyboard = rendered.keepButtons ? buildDecisionKeyboard(deps.key, row.id, amountKRW, await deps.appUrl().catch(() => null)) : undefined;
    const edited = await safe(deps.telegram.edit(chatId, messageId, rendered.text, keyboard));
    if (!edited) await safe(deps.telegram.send(rendered.text, keyboard));
  } else {
    await safe(deps.telegram.send(rendered.text));
  }
  await audit(view.kind, path);
  return { kind: 'decision', action, view, path };
}
