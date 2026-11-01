/**
 * T-143 WP-B 해외 분석 대상 화면 — **문구·서식 순수 함수** (구현 가이드 §2.2·§2.4·§2.6·§2.7). 시험 대상.
 *
 * 규칙:
 *  - **값이 null 인 조각은 그 구절을 뺀다** — 0 으로 채우지 않는다(T-108 §2.3.2 과 같은 규칙).
 *  - (부록 B) **모든 「기본 목록」 분기의 조건은 `summary.manualSource` 하나**다 — 화면이 따로 판단하지 않는다.
 *  - 「3곳 모두 확인」은 **서버가 그렇게 말할 때만**(`watch.allChecked`) 쓴다 — 화면이 원천 수를 세지 않는다(§2.7).
 *  - 종목 코드는 **전체 코드**다 — `formatSymbolShort` 를 쓰지 않는다(이 화면은 거래소 이동 제안을 다루므로 접두사가 뜻을 가진다, §2.5).
 *  - 시각 문자열은 서버가 만든 ISO `+09:00` 이라 **자리 잘라 쓰기만** 한다(브라우저 표준시로 다시 바꾸지 않는다).
 */
import type { ProposalActionType, ProposalEffect, UniverseSummary, UniverseWatch, WatchSourceId } from '@/lib/universe/types';

// ── 수동 목록의 출처 이름 (부록 B.1) ────────────────────────────────────────

/** 수동 목록이 어디서 왔나 — `'fallback'` = 아직 저장한 목록이 없어 쓰이는 목록. */
export type ManualSource = UniverseSummary['manualSource'];

/**
 * 출처 이름 — 저장한 적 없는 목록을 **「수동」이라 부르지 않는다**(부록 B.1.1).
 *
 * 「기본」을 고른 이유: 「수동(내가 저장)」·「자동(산출)」과 같은 2음절 짝이고 **출처를 주장하지 않는다**.
 * 「코드 기본 목록」을 쓰지 않는 이유 둘 — ① 이 화면에서 「코드」는 이미 **종목코드**다(「코드 바꾸기」·「거래소:코드」)
 * ② 값이 코드에서 온다고 **단정할 수 없다**(`fallbackOverseasUniverse()` 는 환경변수 `OVERSEAS_UNIVERSE_SYMBOLS` 가
 * 있으면 그것을 쓴다). 그래서 모든 문장이 「어디서 왔는지」 대신 **「저장한 목록이 없는 동안 쓰는 목록」**이라고만 말한다.
 */
export function manualSourceLabel(src: ManualSource): string {
  return src === 'fallback' ? '기본' : '수동';
}
const isFallback = (src: ManualSource): boolean => src === 'fallback';

// ── 반영 시점 (부록 B.4.2) ──────────────────────────────────────────────────

/**
 * 🔴 **반영 시점을 말하는 문장은 이 상수 하나뿐이다.** 세 곳(`SHEET_TAIL`·`PROPOSAL_DONE_TAIL`·`bulkSuccessText`)이
 * 이것을 참조해, 한 곳만 고쳐져 서로 어긋나는 일을 막는다(부록 B.4.2).
 *
 * 왜 「해외 장마감 분석부터」가 아닌가(B.4.1 — 전부 코드로 확인): 저장한 목록을 읽는 곳은 **다섯**이다 —
 * 해외 장마감 분석(08:00) · 장중 전략 평가(5분 틱, 해외장 열림 ∧ 엔진 ON ∧ 15분 TTL 경과) · 미국 공시 수집(07:00) ·
 * 해외 재무 지표 수집 · 화면 조회. 해외장이 열려 있으면 **장중 전략 평가가 먼저** 읽어 그날 시그널 대상을 바꾼다.
 * 운영 엔진 스위치 값은 미확인이라 **「먼저일 수 있습니다」로 단정하지 않고**, 분 단위 약속도 하지 않는다.
 * 작업 이름은 앱이 이미 쓰는 말(`JOB_NAME_KO`)이다 — 새 말을 만들지 않는다.
 */
export const APPLY_TIMING_TEXT =
  '다음 차례에 도는 분석·수집 작업부터 쓰입니다 — 「해외 장마감 분석」은 다음 아침, 해외장이 열려 있으면 「장중 전략 평가」가 그보다 먼저일 수 있습니다.';

// ── 시각 ────────────────────────────────────────────────────────────────────

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** `2026-12-02T09:14:00+09:00` → `12-02`. 해석 불가면 null. */
export function md(iso: string | null | undefined): string | null {
  return iso && ISO_RE.test(iso) ? iso.slice(5, 10) : null;
}
/** → `12-02 09:14`. */
export function mdhm(iso: string | null | undefined): string | null {
  return iso && ISO_RE.test(iso) ? `${iso.slice(5, 10)} ${iso.slice(11, 16)}` : null;
}
/** → `2025-12-19`(수동 갱신일은 연도까지 — 12월 재구성을 놓쳤는지 보는 단서다). */
export function ymd(iso: string | null | undefined): string | null {
  return iso && ISO_RE.test(iso) ? iso.slice(0, 10) : null;
}

// ── 머리 숫자 4칸 (§2.2) ────────────────────────────────────────────────────

/** 「자동 — NYSE 상위 50」 — 개수(Q4)를 화면에 박지 않는다. 모르면 수를 빼고 말한다. */
export function autoTileLabel(topN: number | null | undefined): string {
  return topN != null ? `자동 — NYSE 상위 ${topN}` : '자동 — NYSE 상위';
}

/**
 * 「갱신 2025-12-19 · 349일 전」. 기록이 없으면 「갱신 기록 없음」.
 *
 * 🔴 `manualSource === 'fallback'` 이면(저장한 목록이 아직 없다) **갱신 기록이 있든 없든** 아래 문장을 쓴다 —
 * 「갱신 기록 없음」은 **아무 일도 안 일어나고 있다**고 읽히는데, 사실은 이 목록으로 매일 분석이 돈다(부록 B.5 #3).
 *
 * ⚠ 「지금 이 목록으로 분석합니다」라고 **단정하지 않는다**: 이 문장은 **규칙**을 말하므로 시점·상태와 무관하게 참이고,
 * 숫자·상태를 단정하지 않아 **목록 조회가 실패한 저하 구간에서도 틀리지 않는다**(판독기가 그 회차만
 * 마지막 성공 값·환경변수로 돌 수 있다 — `universe-overseas-static.ts` 의 폴백).
 *
 * (2026-11-01 정정) 앞서 이 자리에 근거로 적혀 있던 「웹과 크론이 별개 프로세스라 캐시가 공유되지 않는다」는
 * **사실이 아니다** — `stockinvest-cron` 은 `scripts/cron-runner.sh`(bash)이고 그 스크립트가
 * `BASE_URL=http://localhost:3003` 으로 웹 앱을 호출하므로, 목록을 읽는 JS 는 `instances: 1` 인 웹 프로세스 하나에만 있다.
 * 즉 분석과 화면 조회는 **같은 Node 프로세스 안에서** 돈다. (캐시를 공유한다는 뜻은 아니다 — 판독기의
 * 마지막 성공 목록은 **폴백 전용**이라 조회가 성공한 화면 경로는 그 값을 쓰지 않는다.)
 * 문장은 위 근거만으로 성립하므로 그대로 둔다.
 */
export function manualTileMeta(
  s: Pick<UniverseSummary, 'manualUpdatedAt' | 'manualUpdatedDaysAgo' | 'manualSource'>,
): string {
  if (isFallback(s.manualSource)) return '저장 전 — 저장한 목록이 없는 동안 쓰는 목록입니다';
  const d = ymd(s.manualUpdatedAt);
  if (!d) return '갱신 기록 없음';
  const ago = s.manualUpdatedDaysAgo;
  return ago != null ? `갱신 ${d} · ${ago}일 전` : `갱신 ${d}`;
}

/** 머리 3번째 칸 이름 — 저장 전에는 「수동 — 나스닥100」이라고 부르지 않는다(부록 B.5 #2). */
export function manualTileLabel(src: ManualSource): string {
  return isFallback(src) ? '기본 목록' : '수동 — 나스닥100';
}

/** 「산출 12-01 02:40 · 다음 01-01」. 산출 기록이 없으면 「아직 산출하지 않았습니다」. */
export function autoTileMeta(s: Pick<UniverseSummary, 'autoRefreshedAt' | 'autoNextAt'>): string {
  const at = mdhm(s.autoRefreshedAt);
  if (!at) return '아직 산출하지 않았습니다';
  const next = md(s.autoNextAt);
  return next ? `산출 ${at} · 다음 ${next}` : `산출 ${at}`;
}

/** 변경 제안 칸 meta — 0건이면 「지금 확인할 것 없음」(데모 `t-prop-meta`). */
export function proposalTileMeta(open: number): string {
  return open > 0 ? '확인 필요' : '지금 확인할 것 없음';
}

/** 설정 요약 행 부제 — 「150종목 · 수동 98 · 자동 50 · 수동 갱신 2025-12-19」. null 조각은 구절째 뺀다. */
export function summaryRowSub(s: UniverseSummary): string {
  const parts: string[] = [`${s.total}종목`, `${manualSourceLabel(s.manualSource)} ${s.manual}`, `자동 ${s.auto}`];
  const d = ymd(s.manualUpdatedAt);
  if (d) parts.push(`수동 갱신 ${d}`);
  return parts.join(' · ');
}

// ── 보유 (§2.4.2 — 4곳 전부 남아야 한다) ────────────────────────────────────

/** 보유 칩 — 수량을 모르면 **「보유」**(0 으로 채우지 않는다). */
export function heldChipText(qty: number | null | undefined): string {
  if (qty == null || !Number.isFinite(qty) || qty <= 0) return '보유';
  // 소수 수량(분할 매수)도 그대로 보인다 — 정수면 소수점 없이
  const n = Number.isInteger(qty) ? String(qty) : String(Number(qty.toFixed(4)));
  return `보유 ${n}주`;
}

/** 일괄 교체 대조의 빼는 줄 꼬리 — 「· 보유 2주 — 빼도 분석은 계속」(§2.6.3). 보유가 아니면 null. */
export function diffHeldNote(qty: number | null | undefined, isHeld: boolean): string | null {
  return isHeld ? `· ${heldChipText(qty)} — 빼도 분석은 계속` : null;
}

// ── 확인 시트 (§2.4.3) ──────────────────────────────────────────────────────

/** 시트 본문의 효과 한 줄. `effect` 가 null 이면(목록 조회 실패) **그 줄을 뺀다**. */
export function effectText(type: ProposalActionType, e: ProposalEffect | null): string | null {
  if (!e) return null;
  if (type === 'recode') {
    const count = e.manualFrom === e.manualTo
      ? `${e.manualTo} 종목 그대로`
      : `${e.manualFrom} → ${e.manualTo} 종목`;
    return `수동 목록의 코드만 바뀝니다(${count}). 바꾸지 않으면 KIS 조회가 매일 실패해 「데이터 이상」으로 올라옵니다.`;
  }
  const lead = type === 'remove'
    ? `수동 목록에서 빼면 ${e.manualFrom} → ${e.manualTo} 종목`
    : `수동 목록에 넣으면 ${e.manualFrom} → ${e.manualTo} 종목`;
  if (e.heldKeepsAnalysis) return `${lead}. 보유 중이라 분석 대상 수는 ${e.totalFrom} 그대로입니다.`;
  if (e.totalFrom === e.totalTo) return `${lead}. 분석 대상 수는 ${e.totalFrom} 그대로입니다.`;
  return `${lead}, 분석 대상 ${e.totalFrom} → ${e.totalTo} 종목.`;
}

/** 시트 고정 꼬리말 — 주문이 아니라는 사실을 **문구로** 남긴다(§2.4.3 4번) + 반영 시점은 공용 상수. */
export const SHEET_TAIL =
  `주문이 아닙니다 — 실거래여부·모든거래차단과 무관하고, 이미 만든 시그널·보유 종목에도 영향이 없습니다. ${APPLY_TIMING_TEXT}`;

/**
 * 일괄 교체 시트 고정 꼬리말. 「직전 목록으로 되돌릴 수 있습니다」를 **쓰지 않는다** —
 * 되돌리기 화면이 없으므로 없는 기능을 약속하지 않는다(Leader L-4). DB 는 직전 목록을 계속 보관한다.
 */
export const BULK_SHEET_TAIL = `${SHEET_TAIL} 바꾼 뒤에도 직전 목록이 변경 이력에 남습니다.`;

// ── 제안 카드 결과 줄 (§2.4.1) ──────────────────────────────────────────────

export const PROPOSAL_DONE_TAIL = `${APPLY_TIMING_TEXT} 이미 만든 시그널·보유 종목에는 영향 없습니다.`;
export const PROPOSAL_IGNORED_TEXT = '무시 — 같은 근거로는 다시 제안하지 않습니다.';
export const PROPOSAL_CANCEL_TEXT = '취소했습니다 — 목록은 그대로입니다.';
export const PROPOSAL_FAILED_TEXT = '저장하지 못했습니다 — 데이터베이스 오류. 목록은 바뀌지 않았습니다. 잠시 뒤 다시 해 보세요.';
export const PROPOSAL_CONFLICT_TEXT = '이 제안은 이미 처리됐습니다 — 최신 상태로 다시 그렸습니다.';

/** 보류 줄 — 해제 시각을 **서버 값으로** 말한다(화면이 날짜를 계산하지 않는다, D4). */
export function proposalHeldText(heldUntil: string | null): string {
  const d = md(heldUntil);
  const when = d ? `다음 「해외 분석 대상 갱신」(${d})까지` : '다음 「해외 분석 대상 갱신」까지';
  return `보류 — ${when} 숨깁니다. 공시가 갱신되면 그때 다시 올라옵니다.`;
}

// ── 빈 상태 (§2.7) ──────────────────────────────────────────────────────────

export const WATCH_SOURCE_KO: Readonly<Record<WatchSourceId, string>> = {
  us_filings: '미국 공시',
  news_overseas: '해외 뉴스',
  listing: '상장 목록',
};

export const DECEMBER_NOTE = '⚠ 12월 정기 재구성은 공시에 나오지 않습니다 — 12-19 에 목록을 직접 확인하세요.';

/** 첫 줄 — 제안이 있었고 전부 처리·보류·무시됐으면 말을 바꾼다(데모 `pempty-lead`). */
export function emptyLeadText(touched: number): string {
  return touched > 0 ? '확인할 변경을 모두 처리했습니다.' : '지금 확인할 변경 없음.';
}

/**
 * 둘째 줄 — **「3곳 모두 확인」은 `allChecked` 가 참일 때만** 쓴다.
 * 확인 기록이 없으면 그 사실을 말한다(확인하지 않은 것을 확인했다고 쓰지 않는다 — 가이드 §2.7).
 */
export function watchSummaryText(w: UniverseWatch | null): string {
  if (!w || !w.lastCheckedAt) return '아직 변경 확인 기록이 없습니다 — 변경 확인이 처음 돌면 여기에 시각이 보입니다.';
  const when = mdhm(w.lastCheckedAt);
  const names = (['us_filings', 'news_overseas', 'listing'] as WatchSourceId[]).map((s) => WATCH_SOURCE_KO[s]).join(' · ');
  if (w.allChecked) return `마지막 확인 ${when} — ${names} 3곳 모두 확인했습니다.`;
  const failed = w.coverage.filter((c) => !c.ok).map((c) => WATCH_SOURCE_KO[c.source]);
  const which = failed.length > 0 ? failed.join(' · ') : '일부 원천';
  // 조사(을/를)가 원천 이름의 받침에 따라 달라지므로 조사를 쓰지 않는 문장으로 둔다
  return `마지막 확인 ${when} — ${which} 확인 실패로 일부만 확인했습니다.`;
}

/** 「일부만 확인」 경고 줄(§2.8) — 읽지 못한 원천과 그 시각을 말한다. `allChecked` 면 null. */
export function partialWatchRow(w: UniverseWatch | null): { title: string; sub: string } | null {
  if (!w || !w.lastCheckedAt || w.allChecked) return null;
  const failed = w.coverage.filter((c) => !c.ok);
  const names = failed.length > 0 ? failed.map((c) => WATCH_SOURCE_KO[c.source]).join(' · ') : '일부 원천';
  const at = mdhm(failed.find((c) => c.failedAt)?.failedAt ?? w.lastCheckedAt);
  return {
    title: '변경 확인이 일부만 끝났습니다',
    sub: `${names} 확인 실패 (${at}) — 인수·합병·상장폐지를 놓쳤을 수 있습니다`,
  };
}

// ── 일괄 교체 (§2.6.3·§2.6.4) ───────────────────────────────────────────────

export const BULK_HINT_1 = '한 줄에 한 종목. 형식은 NAS:AAAA(거래소:코드). 쉼표·공백·빈 줄은 알아서 정리합니다.';

/**
 * 입력 전에 보는 유일한 설명이다(부록 B.2.2 권고). 저장 전에는 「수동 목록 전체를 대신합니다」가 거짓이다 —
 * 대신할 수동 목록이 없다. 같은 사실을 **붙여넣기 전에** 한 번 말한다.
 */
export function bulkHint2(src: ManualSource): string {
  return isFallback(src)
    ? '여기 내용이 지금 쓰이는 기본 목록을 대신합니다 — 즐겨찾기·보유는 건드리지 않습니다.'
    : '여기 내용이 수동 목록 전체를 대신합니다 — 즐겨찾기·보유는 건드리지 않습니다.';
}

export const DIFF_BAD_NOTE = (n: number) =>
  `형식 오류 ${n}건이 있어 저장할 수 없습니다. 일부만 반영되는 상태를 만들지 않습니다 — 고치고 다시 대조하세요.`;

/** 상한 초과(m-3) — 형식 오류와 같은 자리에 사유를 보인다. 저장 버튼은 꺼진다 */
export const DIFF_TOO_MANY_NOTE = (n: number, max: number) =>
  `종목이 ${n}개로 한 번에 넣을 수 있는 ${max}개를 넘어 저장할 수 없습니다. 분석 시간 예산을 넘기지 않으려는 제한입니다 — 줄이고 다시 대조하세요.`;

/**
 * 🔴 B.3 경우 **C** — 처리는 끝났고 **다시 읽기만** 실패했다(제안 1건).
 * 카드가 `{doneText} · {이 문장}` 으로 그린다(`act` 가 아니면 이 문장만). 보류·무시·되돌리기의 조회 실패도 같은 문장이다.
 * 「목록은 바뀌지 않았습니다」·「처리되지 않았습니다」를 쓰지 않는다 — 같은 저장을 다시 누르면 409 로 간다.
 */
export const PROPOSAL_SAVED_UNREADABLE_TEXT =
  '저장은 끝났습니다. 다만 바뀐 수를 다시 불러오지 못해 위 칸의 숫자는 아직 옛 값입니다 — 다시 누르지 않아도 됩니다. 화면을 새로 열면 최신 상태가 보입니다.';

/** 빈 목록 경고 — 남는 수를 **서버 값으로** 말한다. 모르면 그 구절을 뺀다(데모의 「약 11종목」은 합성값이다). */
export function diffEmptyNote(heldOrFavoritesOnlyCount: number | null): string {
  const tail = heldOrFavoritesOnlyCount != null
    ? ` 이대로 저장하면 해외 분석은 보유·즐겨찾기만 남아 약 ${heldOrFavoritesOnlyCount}종목으로 떨어집니다.`
    : ' 이대로 저장하면 해외 분석은 보유·즐겨찾기만 남습니다.';
  return `목록이 비어 있습니다.${tail}`;
}

/** 대조 메모. 저장 전에는 「수동 목록이 50 → 100」처럼 **두 기준을 한 문장에 섞지 않는다**(부록 B.2.2). */
export const DIFF_OK_NOTE = (from: number, to: number, src: ManualSource = 'db') =>
  (isFallback(src)
    ? `저장하면 기본 목록 ${from}종목 대신 내 목록 ${to}종목으로 분석합니다.`
    : `저장하면 수동 목록이 ${from} → ${to}종목이 됩니다.`) + ' 즐겨찾기·보유는 건드리지 않습니다.';

/** 저장 버튼 글자 — 빈 목록이면 위험 꼴로 말을 바꾼다(§2.6.3). */
export function bulkSaveLabel(nextCount: number): string {
  return nextCount === 0 ? '목록 전부 비우기' : '이 내용으로 바꾸기';
}
/** 확인 버튼 글자. */
export function bulkConfirmVerb(nextCount: number): string {
  return nextCount === 0 ? '전부 비우기' : '바꾸기';
}

export function bulkSuccessText(next: number, added: number, removed: number): string {
  return `바꿨습니다 — 수동 목록 ${next}종목 (넣기 ${added} · 빼기 ${removed}). 변경 이력에 남았습니다. ${APPLY_TIMING_TEXT}`;
}

/**
 * 🔴 B.3 경우 **B** — 저장은 끝났고 **화면만** 못 불러왔다(일괄 교체).
 * 「목록은 바뀌지 않았습니다」를 쓰지 않는다. 「다시 저장하지 않아도 된다」가 A(실패)와의 갈림길이다.
 * 숫자를 말해도 되는 근거: 보낸 목록과 서버가 확정한 넣기·빼기는 **읽기 실패와 무관하게 사실**이다 —
 * 못 믿을 것은 화면 위쪽 요약 숫자뿐이라 거기만 「확인하세요」로 가리킨다.
 */
export function bulkSavedUnreadableText(next: number, added: number, removed: number): string {
  return `바꿨습니다 — 수동 목록 ${next}종목 (넣기 ${added} · 빼기 ${removed}). 저장은 끝났고 변경 이력에 남았습니다. `
    + '다만 바뀐 목록을 다시 불러오지 못했습니다 — 다시 저장하지 않아도 됩니다. 「해외 분석 대상」으로 돌아가 숫자를 확인하세요.';
}

export const BULK_FAIL_TEXT =
  '저장하지 못했습니다 — 데이터베이스 오류. 목록은 바뀌지 않았습니다(전부 반영되거나 전부 안 되거나 둘 중 하나입니다). 붙여넣은 내용은 그대로 두었으니 다시 저장해 보세요.';

export const BULK_CONFLICT_TEXT =
  '저장하지 못했습니다 — 다른 기기에서 먼저 저장했습니다. 목록은 바뀌지 않았습니다. 「다시 대조」로 최신 목록과 다시 맞춰 보세요.';

/**
 * 빈 목록 확인 시트의 되묻는 줄. 남는 수를 모르면 그 구절을 뺀다.
 * 🔴 저장 전에는 한 문장을 더 붙인다(부록 B.2.1) — 지금 문구만 보면 **기본 목록이 안전망으로 남는다**고 읽히는데,
 * 전환 전에 비우는 것이 **가장 많이 줄어드는 경로**다.
 */
export function bulkEmptyConfirmText(heldOrFavoritesOnlyCount: number | null, src: ManualSource = 'db'): string {
  const head = heldOrFavoritesOnlyCount != null
    ? `목록이 비면 해외 분석은 보유·즐겨찾기만 남아 약 ${heldOrFavoritesOnlyCount}종목이 됩니다. 정말 비울까요?`
    : '목록이 비면 해외 분석은 보유·즐겨찾기만 남습니다. 정말 비울까요?';
  return isFallback(src) ? `${head} 지금 쓰이는 기본 목록도 더 쓰이지 않습니다.` : head;
}

// ── 일괄 교체 확인 시트 (부록 B.2.1) ────────────────────────────────────────

/** 시트 제목 4갈래(정상·빈 × 저장됨·저장 전). 저장 전에는 「바꿀 수동 목록」이 없다 — 이 저장의 정체는 **교체**다. */
export function bulkSheetTitle(empty: boolean, src: ManualSource): string {
  if (isFallback(src)) return empty ? '기본 목록을 비우고 내 목록도 두지 않을까요?' : '기본 목록을 내 목록으로 바꿀까요?';
  return empty ? '수동 목록을 전부 비울까요?' : '수동 목록을 바꿀까요?';
}

/** 저장 전 시트 본문 첫 줄 — 늘리는 줄 알고 **바꾸는** 조작임을 말한다(「0 → 100」이라고 쓰면 그 사실이 사라진다). */
export function bulkSheetLead(currentCount: number, nextCount: number): string {
  return `지금은 저장한 목록이 없어 기본 목록 ${currentCount}종목으로 분석하고 있습니다. `
    + `저장하면 그 자리를 여기 붙여넣은 ${nextCount}종목이 대신합니다.`;
}

/**
 * 🔴 저장 전 **뺄 것이 무엇인지** 말한다(부록 B.2.1 — Reviewer 가 짚은 「말하지 않는 사실」).
 * 마지막 문장이 없으면 §2.4.2 의 「보유는 계속 분석된다」 규칙과 어긋나 보인다.
 */
export function bulkRemovedExplainText(n: number): string {
  return `뺄 것 ${n}종목은 기본 목록에는 있지만 새 목록에는 없는 것입니다 — 저장하면 분석에서 빠집니다. `
    + '보유·즐겨찾기인 것은 계속 분석됩니다.';
}

// ── 목록 탭 (§2.5) ──────────────────────────────────────────────────────────

/**
 * 목록 탭 꼬리 설명. 저장 전에는 **맨 앞에 한 구절**을 붙인다(부록 B.1.2) — 칩 글자(기본)만으로는
 * 「내가 바꿀 수 있는 것인가」를 모르므로 바꾸는 길을 같은 자리에서 알려 준다.
 * 「4가지가 섞이기 때문입니다」는 **그대로 둔다** — 기본이 수동 자리를 대신하므로 가짓수가 늘지 않는다(승인 문구 유지).
 */
export const LIST_FOOT_BASE =
  '종목마다 출처가 보입니다 — 4가지가 섞이기 때문입니다. 「자동 n위」는 시가총액 순위, 「보유 n주」는 그 종목이 목록에서 빠져도 분석된다는 표시입니다. 즐겨찾기·보유는 여기서 바꾸지 않습니다(각자 원래 화면에서).';
export const LIST_FOOT_FALLBACK_LEAD =
  '「기본」은 아직 내 목록을 저장하지 않은 동안 쓰이는 목록입니다 — 「12월 정기 재구성」에서 바꾸면 그 자리를 내 목록이 대신합니다.';

export function listFoot(src: ManualSource): string {
  return isFallback(src) ? `${LIST_FOOT_FALLBACK_LEAD} ${LIST_FOOT_BASE}` : LIST_FOOT_BASE;
}

export const BULK_ENTRY_LABEL = '12월 정기 재구성 — 목록 한 번에 바꾸기';

export const NOT_READY_TEXT = '준비 중 — 서버 준비 뒤 쓸 수 있습니다';
