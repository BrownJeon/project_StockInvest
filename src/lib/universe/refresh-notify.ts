/**
 * T-143 WP-A — 월간 산출 알림 조립·발송 (사양 §9 · 구현 가이드 §7).
 *
 * ## 조건 — 「새 제안 ≥1 **또는** 자동 목록 변동 ≥1 **또는 1회차**」일 때 1회. 그 밖에는 **침묵한다.**
 *
 * 🔴 **1회차가 조건에 따로 있는 이유**(Reviewer WP-A high-2): 직전 complete run 이 없으면 diff 가 없어
 * `added`·`removed` 가 **비는 것이 맞다**. 그런데 「변화 0 = 침묵」이 그 빈 값을 보고 **0 → 상위 N 이라는
 * 가장 큰 변화를 유일하게 조용히** 만들었다 — L-A1 의 근거(「사용자가 모르는 사이 분석 대상이 바뀌는 쪽이 위험」)와
 * 정면으로 어긋난다. 그래서 1회차는 「목록이 처음 만들어졌다」는 **사건 자체**로 알린다.
 * 「변동 없음」 메시지를 보내지 않는다 — 뉴스 0건 경고가 분석일마다 반복된 **T-125 의 재발 방지**다.
 *
 * ## 자동 목록만 바뀌었을 때도 보낸다 (Leader 결정 L-A1)
 * 자동 목록(NYSE 상위 N)은 **제안·승인을 거치지 않고 바로 분석 대상이 된다**(제안은 수동 목록만 받는다).
 * 사용자가 모르는 사이 분석 대상이 바뀌는 쪽이 월 1회 알림 하나보다 위험하다.
 *
 * ## 토글은 텔레그램만 멈춘다
 * `system_config.notify_signal_universe`(기본 **켜짐**)가 꺼져 있으면 발송을 생략한다. 홈 「확인 필요」 줄은
 * 제안 행 존재로 **독립 동작**하므로(`readOpenProposalBrief`) 이 토글과 무관하게 늘 나온다.
 *
 * ## 이 모듈은 주문·시그널을 만들지 않는다
 * 보유 중인 종목에 「빼기」 제안이 있으면 수준을 `warning` 으로 올려 **사람이 결정하게** 한다.
 * 자동 매도는 `createSignal → submitOrder` 안전장치 경로 밖에서 만들지 않는다.
 *
 * ## 🔴 창이 끝났는데 미완이면 한 번 알린다 (T-145 ④-조각 — `notifyUniverseWindowIncomplete`)
 * ⑥-4 로 **일시 오류가 그 달을 닫지 않게** 바꾸면서 새 침묵이 생긴다: 전에는 영구 실패로 닫혀 적어도
 * `failed` 가 남았지만, 재시도로 바꾸면 창이 끝날 때 **아무 종결 기록 없이 미완**(`scan` 등)으로 남는다.
 * 그래서 창이 닫힌 뒤 첫 호출이 그 상태를 보고 **warning 1회**를 보낸다. 홈 「데이터 이상」 질의 교체는 범위 밖이다.
 */
import type { RowDataPacket } from 'mysql2/promise';
import { dispatchAlertWithTelegram } from '@/lib/notify';
import { escapeAlertText } from '@/lib/notify/escape';
import { sendTelegramMessage, type BotCallResult, type InlineKeyboard, type SentMessage } from '@/lib/notify/telegram-api';
import { sendTelegramAlert } from '@/lib/notify/telegram';
import { NOTIFY_OK, NOTIFY_SKIPPED, notifyFailed, type NotifyResult } from '@/lib/notify/result';
import { applyProposalToManual, proposalKindLabel } from './proposal-copy';
import { isTerminalPhase, markRunNotified, markProposalsNotified, readProgress, readRun } from './refresh-store';
import { kstSql, readUniverseParts, type Queryable } from './store';
import type { ProposalActionType } from './types';

/** 설정 › 알람 의 토글 키. 기본 **켜짐** — 키가 없으면 보낸다(기존 알람 4개와 같은 방향). */
export const NOTIFY_UNIVERSE_KEY = 'notify_signal_universe';
/** 본문에 싣는 제안 수 상한. 넘으면 「외 n건」(보유 종목 개장 전 공시 확인 알림의 요약 규칙과 같다). */
export const MAX_LISTED_PROPOSALS = 10;
/** 1회차 본문에 싣는 종목 수 상한. 상위 N 이 50이라 전부 적으면 말풍선이 길어진다 → 앞 10개 + 「외 n종목」. */
export const MAX_LISTED_SYMBOLS = 10;

export interface NotifiableProposal {
  id: number;
  symbol: string;
  kind: string;
  basisText: string;
  recommendation: string | null;
  actionType: ProposalActionType;
  nextSymbol: string | null;
}

export interface NotifyOutcome {
  sent: boolean;
  /** 보내지 않은 이유 — `no_change`(침묵) · `toggle_off` · `send_failed` · `read_failed`. */
  reason: string | null;
  proposals: number;
  added: number;
  removed: number;
  /** 1회차(직전 complete run 없음)였나 — 침묵 판정에서 제외된 이유를 호출자가 알 수 있게. */
  firstRun: boolean;
  level: 'info' | 'warning' | null;
}

function rowsOf<T>(out: unknown): T[] {
  return Array.isArray(out) ? (out as T[]) : [];
}

/** 봇 호출 결과 → 알림 결과. `approval-notify.ts` 의 같은 이름 지역 함수와 같은 규칙이다(그쪽은 export 되지 않는다). */
const toNotifyResult = (r: BotCallResult<SentMessage>): NotifyResult =>
  (r.ok ? NOTIFY_OK : r.skipped ? NOTIFY_SKIPPED : notifyFailed(r.error));

/** 아직 알리지 않은 **열린** 제안만. 보류·무시·처리된 제안은 싣지 않는다. */
export async function readUnnotifiedProposals(db: Queryable): Promise<NotifiableProposal[] | null> {
  try {
    const [out] = await db.query<RowDataPacket[]>(
      `SELECT proposal_id, symbol, kind, basis_text, recommendation, action_type, next_symbol
         FROM overseas_universe_proposal
        WHERE state = 'open' AND notified_at IS NULL
        ORDER BY proposal_id ASC`,
    );
    return rowsOf<RowDataPacket>(out).map((r) => ({
      id: Number(r.proposal_id),
      symbol: String(r.symbol ?? ''),
      kind: String(r.kind ?? ''),
      basisText: String(r.basis_text ?? ''),
      recommendation: r.recommendation == null ? null : String(r.recommendation),
      actionType: (String(r.action_type ?? 'remove') as ProposalActionType),
      nextSymbol: r.next_symbol == null ? null : String(r.next_symbol),
    }));
  } catch (e) {
    console.warn(`[universe/refresh-notify] 제안 조회 실패: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** 토글 — **읽기 실패는 「켜짐」으로 본다.** 알림을 줄이는 쪽으로 기울면 사용자가 모르는 사이 조용해진다. */
export async function readNotifyToggle(db: Queryable): Promise<boolean> {
  try {
    const [out] = await db.query<RowDataPacket[]>(
      'SELECT value FROM system_config WHERE `key` = ? LIMIT 1', [NOTIFY_UNIVERSE_KEY],
    );
    const raw = rowsOf<RowDataPacket>(out)[0]?.value;
    if (raw == null) return true;
    try {
      return JSON.parse(String(raw)) !== false;
    } catch {
      return String(raw).trim().toLowerCase() !== 'false';
    }
  } catch {
    return true;
  }
}

async function readAppUrl(db: Queryable): Promise<string | null> {
  try {
    const [out] = await db.query<RowDataPacket[]>(
      'SELECT value FROM system_config WHERE `key` = ? LIMIT 1', ['app_public_url'],
    );
    const raw = rowsOf<RowDataPacket>(out)[0]?.value;
    if (raw == null) return null;
    let v = String(raw).trim();
    try { const p = JSON.parse(v); if (typeof p === 'string') v = p.trim(); } catch { /* 비 JSON 원문 */ }
    return v || null;
  } catch {
    return null;
  }
}

/** 상장 상태 변화로 빠진 것과 단순 순위 하락을 가른다(사양 §8.5) — 제안이 있는 종목은 상태 변화다. */
function removalNote(symbol: string, proposalSymbols: ReadonlySet<string>): string {
  return proposalSymbols.has(symbol) ? '(상장 상태 변화)' : '';
}

export interface BuiltMessage {
  title: string;
  /** 슬랙·폴백용 평문. */
  plain: string;
  /** 텔레그램 HTML. */
  html: string;
  keyboard: InlineKeyboard | undefined;
  level: 'info' | 'warning';
}

/**
 * 본문 조립. **순수 함수**(DB·발송 없음) — 시험이 글자를 그대로 고정한다.
 *
 * 외부에서 온 값(종목 이름·근거 원문)이 들어가므로 HTML 쪽은 `escapeAlertText` 를 거친다.
 */
export function buildMessage(args: {
  proposals: readonly NotifiableProposal[];
  added: readonly string[];
  removed: readonly string[];
  /** 1회차면 `top`(산출된 상위 N)을 「처음 만들어졌다」로 알린다 — diff 가 아니라 사건이다. */
  firstRun?: boolean;
  top?: readonly string[];
  manual: readonly string[];
  held: ReadonlyMap<string, number | null>;
  manualUpdatedAt: string | null;
  manualUpdatedDaysAgo: number | null;
  computedAtLabel: string;
  appUrl: string | null;
}): BuiltMessage {
  const { proposals, added, removed, manual, held, computedAtLabel, appUrl } = args;
  const firstRun = args.firstRun === true;
  const top = args.top ?? [];
  const h = escapeAlertText;
  const proposalSymbols = new Set(proposals.map((p) => p.symbol));
  // 보유 중인 종목을 「빼기」로 제안하면 수준을 올린다 — 사람이 결정해야 한다
  const heldRemove = proposals.some((p) => p.actionType === 'remove' && held.has(p.symbol));
  const level: 'info' | 'warning' = heldRemove ? 'warning' : 'info';

  const listed = proposals.slice(0, MAX_LISTED_PROPOSALS);
  const rest = proposals.length - listed.length;
  const plain: string[] = [];
  const html: string[] = [];

  if (proposals.length > 0) {
    plain.push(`📋 해외 분석 대상 — 변경 제안 ${proposals.length}건`);
    html.push(`📋 <b>해외 분석 대상 — 변경 제안 ${proposals.length}건</b>`);
    listed.forEach((p, i) => {
      const label = proposalKindLabel(p.kind, p.nextSymbol);
      plain.push(`${i + 1}. ${p.symbol} · ${label}`);
      html.push(`${i + 1}. <b>${h(p.symbol)}</b> · ${h(label)}`);
      plain.push(`   근거 ${p.basisText}`);
      html.push(`   근거 ${h(p.basisText)}`);
      const rec = p.recommendation
        ?? (p.actionType === 'recode' && p.nextSymbol ? `코드 바꾸기 ${p.symbol} → ${p.nextSymbol}`
          : p.actionType === 'remove' ? '목록에서 빼기' : '목록에 넣기');
      plain.push(`   권고 ${rec}`);
      html.push(`   권고 ${h(rec)}`);
      if (held.has(p.symbol)) {
        const qty = held.get(p.symbol);
        const q = qty == null ? '보유 중' : `보유 중 ${qty}주`;
        plain.push(`   ⚠ ${q}`);
        html.push(`   ⚠ ${h(q)}`);
      }
    });
    if (rest > 0) {
      plain.push(`   외 ${rest}건`);
      html.push(`   외 ${rest}건`);
    }
  }

  if (firstRun) {
    // 🔴 1회차 — diff 가 아니라 「처음 만들어졌다」를 말한다. 어휘는 기존 알림·화면과 맞춘다
    //   (「다음 「해외 장마감 분석」부터」는 WP-B 일괄 교체 성공 문구와 같은 말이다).
    if (plain.length > 0) { plain.push(''); html.push(''); }
    const head = `📈 NYSE 상위 목록 첫 산출 (${computedAtLabel}) — ${top.length}종목`;
    plain.push(head);
    html.push(`📈 <b>${h(head.slice(2).trim())}</b>`);
    const shown = top.slice(0, MAX_LISTED_SYMBOLS);
    if (shown.length > 0) {
      const line = `+ ${shown.join(' ')}${top.length > shown.length ? ` 외 ${top.length - shown.length}종목` : ''}`;
      plain.push(`   ${line}`);
      html.push(`   ${h(line)}`);
    }
    const note = '다음 「해외 장마감 분석」부터 이 목록을 씁니다';
    plain.push(`   ${note}`);
    html.push(`   ${h(note)}`);
  } else if (added.length > 0 || removed.length > 0) {
    if (plain.length > 0) { plain.push(''); html.push(''); }
    const head = `📈 NYSE 상위 목록 갱신 (${computedAtLabel}) — 들어옴 ${added.length} · 나감 ${removed.length}`;
    plain.push(head);
    html.push(`📈 <b>${h(head.slice(2).trim())}</b>`);
    if (added.length > 0) {
      const line = `+ ${added.join(' ')}`;
      plain.push(`   ${line}`);
      html.push(`   ${h(line)}`);
    }
    if (removed.length > 0) {
      const line = `− ${removed.map((s) => `${s}${removalNote(s, proposalSymbols)}`).join(' ')}`;
      plain.push(`   ${line}`);
      html.push(`   ${h(line)}`);
    }
  }

  // 「수동 N종목 · 다 반영하면 M」 — 제안을 차례로 적용해 **실제로 세어** 만든다(더하기·빼기로 추정하지 않는다)
  let after: string[] = [...manual];
  for (const p of proposals) {
    after = applyProposalToManual(after, { type: p.actionType, symbol: p.symbol, nextSymbol: p.nextSymbol });
  }
  if (plain.length > 0) { plain.push(''); html.push(''); }
  const countLine = proposals.length > 0 && after.length !== manual.length
    ? `수동 ${manual.length}종목 · 다 반영하면 ${after.length}`
    : `수동 ${manual.length}종목`;
  plain.push(countLine);
  html.push(h(countLine));
  if (args.manualUpdatedAt) {
    const ago = args.manualUpdatedDaysAgo == null ? '' : ` (${args.manualUpdatedDaysAgo}일 전)`;
    const line = `수동 갱신 ${args.manualUpdatedAt.slice(0, 10)}${ago}`;
    plain.push(line);
    html.push(h(line));
  }
  // 12월 정기 재구성은 어떤 공시에도 나오지 않는다 — 알림이 조용한 것이 「목록이 맞다」는 뜻이 아니다
  const dec = '⚠ 12월 정기 재구성은 공시에 안 나옵니다 — 12월에 목록을 직접 확인하세요';
  plain.push(dec);
  html.push(h(dec));

  const url = appUrl && /^https:\/\/[^\s]+$/i.test(appUrl)
    ? `${appUrl.endsWith('/') ? appUrl : `${appUrl}/`}settings/overseas-universe?tab=proposals`
    : null;
  const keyboard: InlineKeyboard | undefined = url
    // 기존 글자를 그대로 쓴다 — `src/lib/signals/approval-message.ts` 의 「🔗 앱에서 자세히」. 조작 버튼은 만들지 않는다(D3)
    ? { inline_keyboard: [[{ text: '🔗 앱에서 자세히', url }]] }
    : undefined;

  const title = proposals.length > 0
    ? `해외 분석 대상 — 변경 제안 ${proposals.length}건`
    : firstRun
      ? `해외 분석 대상 — 자동 목록 첫 산출 (${top.length}종목)`
      : `해외 분석 대상 — 자동 목록 갱신 (들어옴 ${added.length} · 나감 ${removed.length})`;

  return { title, plain: plain.join('\n'), html: html.join('\n'), keyboard, level };
}

/**
 * 산출이 확정된 뒤 1회 호출. **던지지 않는다** — 알림 실패로 산출을 되돌리지 않는다.
 */
export async function notifyUniverseRefresh(args: {
  runId: number;
  added: readonly string[];
  removed: readonly string[];
  /** 1회차(직전 complete run 없음) — 침묵 판정에서 제외한다(high-2). */
  firstRun?: boolean;
  /** 1회차 본문에 싣는 산출 결과(상위 N). */
  top?: readonly string[];
  nowMs: number;
  db: Queryable;
}): Promise<NotifyOutcome> {
  const { runId, added, removed, nowMs, db } = args;
  const firstRun = args.firstRun === true;
  const top = args.top ?? [];
  const proposals = await readUnnotifiedProposals(db);
  if (proposals == null) {
    return {
      sent: false, reason: 'read_failed', proposals: 0,
      added: added.length, removed: removed.length, firstRun, level: null,
    };
  }
  // 🔴 1회차는 diff 가 비어도 알린다(high-2). 그 밖에는 변화가 0이면 침묵한다(T-125)
  const changed = proposals.length > 0 || added.length > 0 || removed.length > 0 || firstRun;
  if (!changed) {
    return { sent: false, reason: 'no_change', proposals: 0, added: 0, removed: 0, firstRun, level: null };
  }

  if (!(await readNotifyToggle(db))) {
    // 토글은 **텔레그램만** 멈춘다. 홈 줄은 제안 행 존재로 독립 동작하므로 여기서 `notified_at` 을 채우지 않는다
    // (나중에 토글을 켰을 때 그 제안이 한 번은 알려지게 둔다).
    return {
      sent: false, reason: 'toggle_off', proposals: proposals.length,
      added: added.length, removed: removed.length, firstRun, level: null,
    };
  }

  let parts: Awaited<ReturnType<typeof readUniverseParts>> | null = null;
  try {
    parts = await readUniverseParts(db, nowMs);
  } catch (e) {
    console.warn(`[universe/refresh-notify] 목록 조회 실패(숫자 줄 없이 보낸다): ${e instanceof Error ? e.message : String(e)}`);
  }

  const msg = buildMessage({
    proposals,
    added, removed, firstRun, top,
    manual: parts?.manual ?? [],
    held: parts?.held ?? new Map(),
    manualUpdatedAt: parts?.manualUpdatedAt ?? null,
    manualUpdatedDaysAgo: parts?.manualUpdatedAt
      ? Math.floor((nowMs - Date.parse(parts.manualUpdatedAt)) / 86_400_000)
      : null,
    computedAtLabel: kstSql(nowMs).slice(5, 16),
    appUrl: await readAppUrl(db),
  });

  let delivered = false;
  try {
    const d = await dispatchAlertWithTelegram(msg.level, msg.title, msg.plain, async () => {
      const r = await sendTelegramMessage(msg.html, msg.keyboard);
      if (r.ok || r.skipped) return toNotifyResult(r);
      // 버튼 메시지가 거부되면 버튼 없는 평문으로라도 알린다(앱에서 열어 처리할 수 있다)
      console.error(`[universe/refresh-notify] 버튼 메시지 전송 실패 → 평문으로 대체: ${r.error}`);
      return sendTelegramAlert(msg.level, msg.title, msg.plain);
    });
    delivered = d.delivered.length > 0;
  } catch (e) {
    console.error(`[universe/refresh-notify] 발송 실패: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!delivered) {
    // 🔴 보내지 못했으면 `notified_at` 을 채우지 않는다 — 다음 산출이 같은 제안을 다시 알릴 수 있어야 한다
    return {
      sent: false, reason: 'send_failed', proposals: proposals.length,
      added: added.length, removed: removed.length, firstRun, level: msg.level,
    };
  }
  await markProposalsNotified({ ids: proposals.map((p) => p.id), nowMs, db }).catch((e) => {
    console.warn(`[universe/refresh-notify] 제안 알림 표시 실패: ${e instanceof Error ? e.message : String(e)}`);
  });
  // 1회차도 run 의 알림 시각을 채운다 — 「이 run 의 산출을 알렸다」가 사실이다
  if (firstRun || added.length > 0 || removed.length > 0) {
    await markRunNotified({ runId, nowMs, db }).catch(() => undefined);
  }
  return {
    sent: true, reason: null, proposals: proposals.length,
    added: added.length, removed: removed.length, firstRun, level: msg.level,
  };
}

/** 창 종료 점검 결과 — 라우트가 응답에 싣는다(로그·관측용). */
export interface WindowIncompleteOutcome {
  /** 경고를 보냈나 */
  sent: boolean;
  /**
   * 보내지 않은 이유 — `no_run`(이달 run 이 아예 없다) · `complete`(끝났다) ·
   * `closed`(`failed`·`expired` — 종전 경로가 이미 기록한다) · `already_notified` · `toggle_off` ·
   * `send_failed` · `read_failed`.
   */
  reason: string | null;
  /** 미완이었던 단계(있을 때만) */
  phase: string | null;
}

/**
 * 창이 끝났는데 이달 산출이 **미완**이면 텔레그램 warning 을 **1회** 보낸다(T-145 ④-조각). **던지지 않는다.**
 *
 * 무엇을 집나: `phase` 가 `listing`·`scan`·`retry`·`finalize` 인 이달 run. `complete` 는 알릴 것이 없고,
 * `failed`·`expired` 는 **집지 않는다** — 그쪽은 `job_run_log.error_code` 와 다음 달 `prevMonthIncomplete` 로
 * 이미 드러나고, 여기서 또 보내면 같은 사건을 두 경로로 알린다.
 *
 * 🔴 중복 발송을 막는 수단은 **기존 `overseas_universe_run.notified_at`** 이다(새 열·새 DDL 을 들이지 않는다).
 * 그 열은 「자동 목록 변동을 알렸다」용인데 그 알림은 **`complete` 일 때만** 나가므로(`notifyUniverseRefresh`)
 * 미완 run 에서는 비어 있고, 창이 끝난 뒤 이달 run 이 다시 진행될 경로도 없다(라우트 관문 3이 창 밖 호출을
 * 거절한다) → 두 알림이 같은 열을 다툴 수 없다.
 *
 * 보낸 **뒤에** 표시한다(이 모듈의 기존 규칙과 같다) — 발송이 실패하면 표시하지 않아 사람이 다시 부르면
 * 한 번 더 해 볼 수 있다. 대가는 **같은 순간에 두 호출이 겹치면 두 번 갈 수 있다**는 것이고,
 * pm2 `stockinvest` 가 `instances: 1` 이고 러너가 직렬이라는 기존 전제에서 그 창은 사실상 없다.
 */
export async function notifyUniverseWindowIncomplete(args: {
  runKey: string;
  nowMs: number;
  db: Queryable;
}): Promise<WindowIncompleteOutcome> {
  const { runKey, nowMs, db } = args;
  const run = await readRun(runKey, db);
  if (run.kind !== 'ok') {
    // 표가 없거나(아직 적용 전) 조회가 실패했다 — 알릴 근거가 없다(산출을 막지 않는다)
    return { sent: false, reason: 'read_failed', phase: null };
  }
  if (!run.data) return { sent: false, reason: 'no_run', phase: null };
  const phase = run.data.phase;
  if (phase === 'complete') return { sent: false, reason: 'complete', phase };
  if (isTerminalPhase(phase)) return { sent: false, reason: 'closed', phase };
  if (run.data.notifiedAt != null) return { sent: false, reason: 'already_notified', phase };

  // 토글은 이 잡의 텔레그램 전체를 끄는 사용자 스위치다 — 꺼 둔 알림을 경고라는 이름으로 우회하지 않는다
  if (!(await readNotifyToggle(db))) return { sent: false, reason: 'toggle_off', phase };

  const prog = await readProgress({ runId: run.data.runId, db });
  const p = prog.kind === 'ok' ? prog.data : null;
  const h = escapeAlertText;
  const title = `해외 분석 대상 — 자동 목록 산출 미완 (${runKey})`;
  const lines = [
    `⚠ ${runKey} NYSE 상위 목록 산출이 창 안에 끝나지 않았습니다 (단계 ${phase})`,
    p ? `   후보 ${p.total}종목 · 조회 완료 ${p.ok} · 남음 ${p.pending} · 조회 실패 ${p.kisError + p.kisMissing}` : null,
    '   자동 목록은 바뀌지 않았습니다 — 지난 산출 결과가 그대로입니다',
    '   다음 창은 다음 달 첫째 일요일입니다',
  ].filter((x): x is string => x != null);
  const plain = lines.join('\n');
  const html = lines.map((l, i) => (i === 0 ? `⚠ <b>${h(l.slice(2).trim())}</b>` : h(l))).join('\n');

  let delivered = false;
  try {
    const d = await dispatchAlertWithTelegram('warning', title, plain, async () => {
      const r = await sendTelegramMessage(html, undefined);
      if (r.ok || r.skipped) return toNotifyResult(r);
      console.error(`[universe/refresh-notify] 미완 경고 전송 실패 → 평문으로 대체: ${r.error}`);
      return sendTelegramAlert('warning', title, plain);
    });
    delivered = d.delivered.length > 0;
  } catch (e) {
    console.error(`[universe/refresh-notify] 미완 경고 발송 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!delivered) return { sent: false, reason: 'send_failed', phase };
  await markRunNotified({ runId: run.data.runId, nowMs, db }).catch((e) => {
    console.warn(`[universe/refresh-notify] 미완 경고 표시 실패: ${e instanceof Error ? e.message : String(e)}`);
  });
  return { sent: true, reason: null, phase };
}
