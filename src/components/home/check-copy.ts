/**
 * T-108 홈 「확인 필요」 — 서버 `checks[]`(kind + params) → 화면 문구 (가이드 §2.3.2 표가 정본, 순수 함수 · 시험 B-2).
 *
 * - 순서는 표 순서 고정(`CHECK_ORDER`) — 서버가 보낸 순서와 무관하게 다시 정렬한다.
 * - params 키는 `src/lib/ops/metrics/types.ts` `CheckItem` 주석(WP-A)과 같다. 값이 null 이면 그 빈칸이 든 구절을 뺀다(0 으로 채우지 않음).
 * - 데이터 이상(data_anomaly)은 **한 줄로 묶는다**(T-130 D3-B) — 「데이터 이상·분석 실패 {n}건」 + 부제에 앞 2개 이름과 「외 {n-2}건」.
 *   n = 서버가 보낸 항목 수(최대 3) + 마지막 항목 `params.more`(서버가 잘라낸 수). 운용현황 「데이터 이상·분석 실패」 칸 숫자와 같은 수다.
 * - 분석 결과 모름(analysis_unknown)은 시장별로 와도 한 줄로 합친다(데모 문구가 시장을 말하지 않음).
 * - 종목은 코드 표시(`formatSymbolShort` — 홈은 종목 이름 조회 `/api/ticker/*` 를 부르지 않는다, 가이드 §2.3).
 * - 청산 종류는 내부 이름 → 표시 이름(용어 정정표 §3.1·§12): eod_loss_cut → 장마감 전 손절 등. 이름표는 사전 한 벌(`reason-dictionary` EXIT_KIND_LABEL).
 */
import type { CheckItem, CheckKind } from '@/lib/ops/metrics/types';
import { formatSymbolShort } from '@/lib/symbols';
import { fmtKstDateTime, fmtKstTime, kstDateKey, kstParts } from '@/components/ops/format';
import type { CheckSeverity } from '@/components/ops/ui/CheckRow';
import { EXIT_KIND_LABEL, exitKindLabel, jobNameText, orderReasonText, safetyErrorsText } from '@/components/ops/reason-copy';

// 청산 이름표는 사전(`reason-dictionary`)이 한 벌로 갖는다 — 기존 import 경로(ExitLogicSection·VerifyPanel)를 지키려고 여기서 다시 내보낸다.
export { EXIT_KIND_LABEL, exitKindLabel };

export const CHECK_ORDER: readonly CheckKind[] = [
  'safety_unknown', 'kill_switch_on', 'exit_live_orders', 'buy_blocked', 'awaiting_approval', 'order_rejected', 'order_blocked',
  'hard_stop_off_hit', 'virtual_exit', 'universe_change_proposed', 'data_anomaly', 'analysis_unknown',
];

/** 안전 상태를 못 읽었을 때 확인 필요 첫 줄·빈 상태 대신 쓰는 문구(「지금 확인할 것 없음」 을 쓰지 않는다). */
export const SAFETY_UNKNOWN_TITLE = '안전 상태를 불러오지 못해 확인할 수 없습니다';

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
 * - 뉴스 0건 연속: 「국내 뉴스 0건 2일 연속」 / 「장마감 분석 입력 품질 저하」 (데모 문구 — 영문 괄호 없음, T-130 4-4)
 * - 실행 기록 잡(source='job_run', label=job_id 원문): 사전의 잡 이름(`jobNameText`, 모르는 잡은 「알 수 없는 작업」) + 상태 말
 * - 그 밖 원천: 서버 표시 이름(예: 「환율 USD/KRW」) + 상태 말(오래됨 · 조회 실패 · 기록 없음)
 */
const JOB_STATUS_WORD: Readonly<Record<string, string>> = {
  failed: '실패', missing: '실행 기록 없음', degraded: '입력 품질 저하', partial: '일부만 완료',
};
export const ANOMALY_STATE_WORD: Readonly<Record<string, string>> = {
  stale: '오래됨', error: '조회 실패', unknown: '기록 없음', partial: '일부 저하', blocked: '차단', off_hours: '장외',
};
export function anomalyText(a: {
  source?: string | null; label?: string | null; state?: string | null; streak?: number | null; jobId?: string | null; jobStatus?: string | null;
}): { title: string; sub: string | null } {
  const label = a.label || '데이터 이상';
  if ((a.source === 'news_domestic' || a.source === 'news_overseas') && a.streak != null && a.streak >= 1) {
    return { title: `${a.source === 'news_domestic' ? '국내' : '해외'} 뉴스 0건 ${a.streak}일 연속`, sub: '장마감 분석 입력 품질 저하' };
  }
  if (a.source === 'job_run') {
    const id = a.jobId || label;
    const word = (a.jobStatus && JOB_STATUS_WORD[a.jobStatus]) || (a.state && ANOMALY_STATE_WORD[a.state]) || null;
    return { title: [jobNameText(id), word].filter(Boolean).join(' '), sub: null };
  }
  const word = a.state ? ANOMALY_STATE_WORD[a.state] : undefined;
  return { title: word ? `${label} ${word}` : label, sub: null };
}

/** 데이터 이상 항목 1건 → 제목·부제 (params 키는 `CheckItem` 주석 data_anomaly). */
function anomalyOf(item: CheckItem): { title: string; sub: string | null } {
  const p = item.params ?? {};
  return anomalyText({ source: str(p.source), label: str(p.label), state: str(p.state), streak: num(p.streak), jobId: str(p.jobId), jobStatus: str(p.jobStatus) });
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
        sub: '매수 시그널은 검증 관문 차단 기록으로만 남습니다', href: item.href };
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
        // T-128 A3 — 사유가 비어 있으면(blocked_by IS NULL) 「재시도하지 않음」 만 남기지 않는다 — 아래 order_blocked 와 같은 처리
        sub: join(orderReasonText(reason) ?? '사유 기록 없음', '재시도하지 않음'), href: item.href };
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
    case 'universe_change_proposed': {
      // T-143 — 「해외 분석 대상 변경 제안 3건」 / 부제 「NAS:AAAA 상장폐지 예정 · 외 2건」.
      // 부제 규칙이 data_anomaly 와 다르다(앞 1개 + 외 n−1건) — 종목 코드가 길어 412px 에서 두 개를 넣으면 줄이 넘친다(승인 데모 §2 표).
      // 종목 코드는 **전체 코드**다 — `formatSymbolShort` 를 쓰지 않는다(거래소 이동 제안을 다루므로 접두사가 뜻을 가진다).
      // `first` 는 서버가 완성해 준 문자열이라 홈이 조립하지 않는다.
      const first = str(p.first);
      const more = num(p.more);
      // 「외 n건」은 **첫 줄 요약이 있을 때만** 붙인다 — 앞말이 없으면 「외 1건」만 남아 무엇의 밖인지 말하지 못한다
      // (값이 null 이면 그 빈칸이 든 구절째 뺀다는 공통 규칙)
      return { key: 'universe-proposed', severity: 'w', glyph: n != null ? String(n) : '!',
        title: `해외 분석 대상 변경 제안${n != null ? ` ${n}건` : ''}`,
        sub: first ? join(first, more != null && more >= 1 && `외 ${more}건`) || null : null, href: item.href };
    }
    case 'data_anomaly': {
      const t = anomalyOf(item);
      return { key: `anomaly-${str(p.source) ?? ''}-${str(p.jobId) ?? str(p.label) ?? ''}`, severity: 'w', glyph: '!', title: t.title, sub: t.sub, href: item.href };
    }
    case 'analysis_unknown':
      return { key: 'analysis-unknown', severity: 'n', glyph: '◌', title: '분석 실패 여부는 아직 알 수 없습니다',
        sub: '실행 기록(T-112)이 쌓인 뒤부터 보입니다', href: item.href };
    default:
      return null;
  }
}

/** 서버 목록 → 화면 줄(순서 고정 · 데이터 이상은 묶음 한 줄 · 분석 모름 한 줄). */
export function checkLines(items: readonly CheckItem[], nowMs: number): CheckLine[] {
  const rank = (k: CheckKind) => { const i = CHECK_ORDER.indexOf(k); return i < 0 ? CHECK_ORDER.length : i; };
  const sorted = items.map((it, i) => ({ it, i })).sort((a, b) => rank(a.it.kind) - rank(b.it.kind) || a.i - b.i).map((x) => x.it);
  const out: CheckLine[] = [];
  let anomaliesDone = false;
  let analysisUnknownDone = false;
  for (const it of sorted) {
    if (it.kind === 'data_anomaly') {
      if (!anomaliesDone) out.push(...anomalyLines(sorted.filter((x) => x.kind === 'data_anomaly')));
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

/**
 * 데이터 이상 → **묶음 한 줄**(T-130 D3-B). 머리 숫자 「N가지」 는 봐야 할 가짓수라 이상 여러 건을 한 가지로 센다 —
 * 줄 제목의 건수는 운용현황 「데이터 이상·분석 실패」 칸의 숫자와 같다(서버가 항목을 최대 3개로 자르고 마지막 항목 `more` 에 잘린 수를 준다).
 * 부제 = 앞 2개 이름 + 넘치면 「외 n건」. 건수가 늘어도 줄은 하나다(「외 n건」 단독 줄은 없다).
 */
function anomalyLines(items: readonly CheckItem[]): CheckLine[] {
  if (items.length === 0) return [];
  const total = items.length + (num(items[items.length - 1].params?.more) ?? 0);
  const names = items.slice(0, 2).map((it) => anomalyOf(it).title).join(' · ');
  return [{
    key: 'anomaly-group', severity: 'w', glyph: '!', title: `데이터 이상·분석 실패 ${total}건`,
    sub: total > 2 ? `${names} 외 ${total - 2}건` : names, href: items[0].href,
  }];
}
