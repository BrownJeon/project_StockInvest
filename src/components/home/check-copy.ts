/**
 * T-108 홈 「확인 필요」 — 서버 `checks[]`(kind + params) → 화면 문구 (가이드 §2.3.2 표가 정본, 순수 함수 · 시험 B-2).
 *
 * - 순서는 표 순서 고정(`CHECK_ORDER`) — 서버가 보낸 순서와 무관하게 다시 정렬한다.
 * - params 키는 `src/lib/ops/metrics/types.ts` `CheckItem` 주석(WP-A)과 같다. 값이 null 이면 그 빈칸이 든 구절을 뺀다(0 으로 채우지 않음).
 * - 데이터 이상(data_anomaly)은 최대 3줄 — 서버가 잘라 보낸 마지막 줄의 `more` 가 있으면 그 줄을 「외 {n}건」 으로 그린다.
 * - 분석 결과 모름(analysis_unknown)은 시장별로 와도 한 줄로 합친다(데모 문구가 시장을 말하지 않음).
 * - 종목은 코드 표시(`formatSymbolShort` — 홈은 종목 이름 조회 `/api/ticker/*` 를 부르지 않는다, 가이드 §2.3).
 * - 청산 종류는 내부 이름 → 표시 이름(용어 정정표 §3.1): eod_loss_cut → 장마감 전 손절 등.
 */
import type { CheckItem, CheckKind } from '@/lib/ops/metrics/types';
import { formatSymbolShort } from '@/lib/symbols';
import { fmtKstDateTime, fmtKstTime, kstDateKey, kstParts } from '@/components/ops/format';
import type { CheckSeverity } from '@/components/ops/ui/CheckRow';
import { orderReasonText, safetyErrorsText } from '@/components/ops/reason-copy';

export const CHECK_ORDER: readonly CheckKind[] = [
  'safety_unknown', 'kill_switch_on', 'exit_live_orders', 'buy_blocked', 'awaiting_approval', 'order_rejected', 'order_blocked',
  'hard_stop_off_hit', 'virtual_exit', 'data_anomaly', 'analysis_unknown',
];

/** 안전 상태를 못 읽었을 때 확인 필요 첫 줄·빈 상태 대신 쓰는 문구(「지금 확인할 것 없음」 을 쓰지 않는다). */
export const SAFETY_UNKNOWN_TITLE = '안전 상태를 불러오지 못해 확인할 수 없습니다';

/** 청산 종류 표시 이름(용어 정정표 — 「EOD 손절」「하드손절」을 화면에 쓰지 않는다). */
export const EXIT_KIND_LABEL: Readonly<Record<string, string>> = {
  hard_stop: '손실한도 손절',
  eod_loss_cut: '장마감 전 손절',
  trailing_stop: '트레일링',
  target_profit: '익절',
};
export function exitKindLabel(code: string | null | undefined): string {
  if (!code) return '청산';
  return EXIT_KIND_LABEL[code] ?? '청산';
}

export interface CheckLine { key: string; severity: CheckSeverity; glyph: string; title: string; sub: string | null; href: string }

const num = (v: string | number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: string | number | null | undefined): string | null => (v == null || v === '' ? null : String(v));
const join = (...parts: Array<string | null | false | undefined>) => parts.filter(Boolean).join(' · ');

/** 「오늘 09:08」 / 다른 날이면 「10-29 09:08」. */
function whenText(iso: string | null, nowMs: number): string | null {
  if (!iso) return null;
  const p = kstParts(iso);
  if (!p) return null;
  return p.dateKey === kstDateKey(nowMs) ? `오늘 ${fmtKstTime(iso, nowMs)}` : fmtKstDateTime(iso);
}

/**
 * 데이터 이상 1건(원천 신선도 · 실행 기록 잡) → 제목·부제. 홈 「확인 필요」 줄과 A4 칸 첫 줄이 같이 쓴다.
 * - 뉴스 0건 연속: 「국내 뉴스 0건 2일 연속」 / 「장마감 분석 입력 품질 저하(degraded)」 (데모 문구)
 * - 실행 기록 잡(source='job_run', label=job_id 원문): 장마감 분석 잡은 표시 이름으로, 그 밖은 job_id 그대로 + 상태 말
 * - 그 밖 원천: 서버 표시 이름(예: 「환율 USD/KRW」) + 상태 말(오래됨 · 조회 실패 · 기록 없음)
 */
const JOB_NAME: Readonly<Record<string, string>> = {
  'post-market-domestic': '국내 장마감 분석',
  'post-market-overseas': '해외 장마감 분석',
};
const JOB_STATUS_WORD: Readonly<Record<string, string>> = {
  failed: '실패', missing: '실행 기록 없음', degraded: '입력 품질 저하(degraded)', partial: '일부만 완료',
};
export const ANOMALY_STATE_WORD: Readonly<Record<string, string>> = {
  stale: '오래됨', error: '조회 실패', unknown: '기록 없음', partial: '저하(degraded)', blocked: '차단', off_hours: '장외',
};
export function anomalyText(a: {
  source?: string | null; label?: string | null; state?: string | null; streak?: number | null; jobId?: string | null; jobStatus?: string | null;
}): { title: string; sub: string | null } {
  const label = a.label || '데이터 이상';
  if ((a.source === 'news_domestic' || a.source === 'news_overseas') && a.streak != null && a.streak >= 1) {
    return { title: `${a.source === 'news_domestic' ? '국내' : '해외'} 뉴스 0건 ${a.streak}일 연속`, sub: '장마감 분석 입력 품질 저하(degraded)' };
  }
  if (a.source === 'job_run') {
    const id = a.jobId || label;
    const word = (a.jobStatus && JOB_STATUS_WORD[a.jobStatus]) || (a.state && ANOMALY_STATE_WORD[a.state]) || null;
    return { title: [JOB_NAME[id] ?? id, word].filter(Boolean).join(' '), sub: null };
  }
  const word = a.state ? ANOMALY_STATE_WORD[a.state] : undefined;
  return { title: word ? `${label} ${word}` : label, sub: null };
}

/** 한 항목 → 한 줄. 알 수 없는 kind 는 null(그리지 않음). */
export function checkLine(item: CheckItem, nowMs: number): CheckLine | null {
  const p = item.params ?? {};
  const n = item.count ?? null;
  switch (item.kind) {
    case 'safety_unknown':
      return { key: 'safety-unknown', severity: 'e', glyph: '!', title: SAFETY_UNKNOWN_TITLE,
        sub: join(safetyErrorsText(str(p.errors)), '주문 송신 여부를 알 수 없습니다'), href: item.href };
    case 'kill_switch_on': {
      const since = whenText(str(p.since), nowMs);
      const blocked = num(p.exitSignalsBlocked);
      return { key: 'kill', severity: 'e', glyph: '!', title: '모든거래차단 ON — 모든 주문 차단',
        sub: join(since && `${since} 부터`, blocked != null && `청산 시그널 ${blocked}건도 송신 안 됨`) || null, href: item.href };
    }
    case 'exit_live_orders': {
      const fills = num(p.exitFillsToday);
      return { key: 'exit-live', severity: 'e', glyph: '!', title: '청산 주문이 실제로 송신됩니다',
        sub: join('실거래여부 ON', fills != null && `오늘 청산 체결 ${fills}건`), href: item.href };
    }
    case 'buy_blocked': {
      const v = num(p.validatedEnabled), t = num(p.total);
      return { key: 'buy-blocked', severity: 'w', glyph: '⊘',
        title: v != null && t != null ? `신규 매수 차단 — 검증 통과 전략 ${v}/${t}` : '신규 매수 차단',
        sub: '매수 시그널은 차단 기록으로만 남습니다', href: item.href };
    }
    case 'awaiting_approval': {
      const d = num(p.domestic), o = num(p.overseas);
      const total = n ?? (d != null && o != null ? d + o : null);
      const sym = str(p.earliestSymbol), at = str(p.earliestAt);
      return { key: 'approval', severity: 'w', glyph: total != null ? String(total) : '!',
        title: `승인 대기${total != null ? ` ${total}건` : ''}${d != null && o != null ? ` — 국내 ${d} · 해외 ${o}` : ''}`,
        sub: sym && at ? `가장 빨리 만료: ${formatSymbolShort(sym)} ${fmtKstDateTime(at)}` : null, href: item.href };
    }
    case 'order_rejected': {
      const sym = str(p.symbol), side = str(p.side), reason = str(p.reason);
      const sideText = side === 'buy' ? '매수' : side === 'sell' ? '매도' : null;
      return { key: 'rejected', severity: 'e', glyph: '!',
        title: `주문 거부${n != null ? ` ${n}건` : ''}${sym ? ` — ${formatSymbolShort(sym)}${sideText ? ` ${sideText}` : ''}` : ''}`,
        sub: join(orderReasonText(reason), '재시도하지 않음'), href: item.href };
    }
    case 'order_blocked': {
      // 오늘 안전장치(한도·검증 관문 등 — 모든거래차단 제외)에 막혀 송신되지 않은 주문 (가이드 표에 없던 줄 — WP-A 추가, 문구는 Leader·designer 확인 대상)
      const sym = str(p.symbol), side = str(p.side), reason = str(p.reason);
      const sideText = side === 'buy' ? '매수' : side === 'sell' ? '매도' : null;
      return { key: 'order-blocked', severity: 'w', glyph: '⊘',
        title: `주문 차단${n != null ? ` ${n}건` : ''}${sym ? ` — ${formatSymbolShort(sym)}${sideText ? ` ${sideText}` : ''}` : ''}`,
        // 사유가 비어 있어도(blocked_by IS NULL) 「송신 안 됨」 만 남기지 않는다 — 어느 장치 때문인지 모른다는 사실을 말한다(designer 필수 2)
        sub: join(orderReasonText(reason) ?? '사유 기록 없음', '송신 안 됨'), href: item.href };
    }
    case 'hard_stop_off_hit': {
      const syms = num(p.symbols) ?? n, days = num(p.days), capped = num(p.daysCapped) === 1;
      const dayText = capped ? '30일 이상' : days != null ? `${days}일째` : null;
      return { key: 'hard-off', severity: 'w', glyph: '⊘',
        title: join(`손실한도 손절 OFF — 한도 도달${syms != null ? ` ${syms}종목` : ''}`, dayText),
        sub: '손실 한도에 닿았지만 스위치가 꺼져 손절 시그널을 만들지 않습니다', href: item.href };
    }
    case 'virtual_exit': {
      const when = whenText(str(p.at), nowMs);
      const notify = num(p.notifyAutoSubmit);
      const notifyText = notify === 1 ? '텔레그램 자동 제출 알림은 켜져 있음' : notify === 0 ? '텔레그램 자동 제출 알림은 꺼져 있음' : null;
      return { key: 'virtual-exit', severity: 'i', glyph: 'D',
        title: `가상 청산${n != null ? ` ${n}건` : ''}${when ? ` — ${when} ${exitKindLabel(str(p.exitKind))}` : ''}`,
        sub: join('주문은 기록만, 송신 없음', notifyText), href: item.href };
    }
    case 'data_anomaly': {
      const t = anomalyText({ source: str(p.source), label: str(p.label), state: str(p.state), streak: num(p.streak), jobId: str(p.jobId), jobStatus: str(p.jobStatus) });
      return { key: `anomaly-${str(p.source) ?? ''}-${str(p.jobId) ?? str(p.label) ?? ''}`, severity: 'w', glyph: '!', title: t.title, sub: t.sub, href: item.href };
    }
    case 'analysis_unknown':
      return { key: 'analysis-unknown', severity: 'n', glyph: '◌', title: '분석 실패 여부는 아직 알 수 없습니다',
        sub: '실행 기록(T-112)이 쌓인 뒤부터 보입니다', href: item.href };
    default:
      return null;
  }
}

/** 서버 목록 → 화면 줄(순서 고정 · 데이터 이상 최대 3줄 · 분석 모름 한 줄). */
export function checkLines(items: readonly CheckItem[], nowMs: number): CheckLine[] {
  const rank = (k: CheckKind) => { const i = CHECK_ORDER.indexOf(k); return i < 0 ? CHECK_ORDER.length : i; };
  const sorted = items.map((it, i) => ({ it, i })).sort((a, b) => rank(a.it.kind) - rank(b.it.kind) || a.i - b.i).map((x) => x.it);
  const out: CheckLine[] = [];
  let anomaliesDone = false;
  let analysisUnknownDone = false;
  for (const it of sorted) {
    if (it.kind === 'data_anomaly') {
      if (!anomaliesDone) out.push(...anomalyLines(sorted.filter((x) => x.kind === 'data_anomaly'), nowMs));
      anomaliesDone = true;
      continue;
    }
    if (it.kind === 'analysis_unknown') {
      if (analysisUnknownDone) continue;
      analysisUnknownDone = true;
    }
    const ln = checkLine(it, nowMs);
    if (ln) out.push(ln);
  }
  return out;
}

function anomalyLines(items: readonly CheckItem[], nowMs: number): CheckLine[] {
  if (items.length === 0) return [];
  const shown = items.slice(0, 3);
  const extra = Math.max(0, items.length - 3) + (num(shown[shown.length - 1].params?.more) ?? 0);
  const lines = shown.map((it) => checkLine(it, nowMs)).filter((x): x is CheckLine => x !== null);
  if (extra > 0 && lines.length > 0) {
    // 마지막 줄을 「외 {n}건」 으로 — 그 줄 자신 + 잘린 수
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = { ...last, key: 'anomaly-more', title: `외 ${extra + 1}건`, sub: null };
  }
  return lines;
}
