/**
 * T-108 운용 화면 공통 서식 — 가이드 §2.1 표가 정본 (순수 함수, 시험 B-3).
 *
 * - 시각은 서버가 만든 ISO 8601(+09:00)을 받아 **KST 기준**으로 그린다(브라우저 시간대와 무관).
 * - 「0」은 조회 성공 + 0 일 때만 — 값이 없으면 `—`(DASH) + 사유 칩. 이 파일은 숫자를 지어내지 않는다.
 * - 음수 부호는 U+2212(−). 손익은 부호 + 색 클래스 + 글자 `(이익)`/`(손실)` — 색만으로 구분하지 않는다.
 * - 상태 칩 문구(데모 C 절)도 여기 한 곳에 둔다(CHIP).
 */

export const DASH = '—';
export const MINUS = '−';
const KST_OFFSET_MS = 9 * 3600_000;

/** 정수 천 단위 구분(ko-KR). 소수는 반올림. */
function groupInt(n: number): string {
  return Math.round(Math.abs(n)).toLocaleString('ko-KR');
}

/** 원화 `₩1,240,000` — 소수 없음. 음수는 `−₩…`. */
export function fmtKrw(n: number): string {
  const r = Math.round(n);
  return (r < 0 ? MINUS : '') + '₩' + groupInt(r);
}

/** 달러 `$310.00` — 소수 2자리(천 단위 구분). 음수는 `−$…`. */
export function fmtUsd(n: number): string {
  const r = Math.round(n * 100) / 100;
  const body = Math.abs(r).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (r < 0 ? MINUS : '') + '$' + body;
}

export type Tone = 'up' | 'down' | null;

/** 손익 금액 `+₩12,300 (이익)` / `−₩8,100 (손실)` / `₩0` — tone 은 전역 클래스 `up`(빨강)·`down`(파랑). */
export function fmtPnlKrw(n: number): { text: string; tone: Tone } {
  const r = Math.round(n);
  if (r === 0) return { text: '₩0', tone: null };
  return r > 0
    ? { text: '+₩' + groupInt(r) + ' (이익)', tone: 'up' }
    : { text: MINUS + '₩' + groupInt(r) + ' (손실)', tone: 'down' };
}

/** 손익률 `+2.7%` / `−2.1%` / `0.0%` — 소수 1자리, 음수 U+2212. */
export function fmtPct(n: number): { text: string; tone: Tone } {
  const r = Math.round(n * 10) / 10;
  if (r === 0) return { text: '0.0%', tone: null };
  const body = Math.abs(r).toFixed(1) + '%';
  return r > 0 ? { text: '+' + body, tone: 'up' } : { text: MINUS + body, tone: 'down' };
}

/** 건수 `44종목` · `3건` (정수 + 단위). */
export function fmtCount(n: number, unit: '건' | '종목' | '' = '건'): string {
  return Math.round(n).toLocaleString('ko-KR') + unit;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** ISO → KST 달력 값. 해석 불가면 null. */
export function kstParts(iso: string | null | undefined): { y: number; mo: number; d: number; h: number; mi: number; dateKey: string } | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const k = new Date(ms + KST_OFFSET_MS);
  const y = k.getUTCFullYear(), mo = k.getUTCMonth() + 1, d = k.getUTCDate();
  return { y, mo, d, h: k.getUTCHours(), mi: k.getUTCMinutes(), dateKey: `${y}-${pad2(mo)}-${pad2(d)}` };
}

/** KST 오늘 날짜 키(YYYY-MM-DD). */
export function kstDateKey(nowMs: number): string {
  const k = new Date(nowMs + KST_OFFSET_MS);
  return `${k.getUTCFullYear()}-${pad2(k.getUTCMonth() + 1)}-${pad2(k.getUTCDate())}`;
}

/** KST `HH:MM` — 날짜가 오늘(KST)이 아니면 `MM-DD HH:MM`. 해석 불가면 `—`. */
export function fmtKstTime(iso: string | null | undefined, nowMs: number): string {
  const p = kstParts(iso);
  if (!p) return DASH;
  const hm = `${pad2(p.h)}:${pad2(p.mi)}`;
  return p.dateKey === kstDateKey(nowMs) ? hm : `${pad2(p.mo)}-${pad2(p.d)} ${hm}`;
}

/** KST `HH:MM` 만(날짜 없이) — 같은 날임이 문맥상 분명할 때(예: 「10-30 · 16:00 실행」의 시각 부분). */
export function fmtKstHm(iso: string | null | undefined): string {
  const p = kstParts(iso);
  return p ? `${pad2(p.h)}:${pad2(p.mi)}` : DASH;
}

/** KST `MM-DD HH:MM` (항상 날짜 포함). */
export function fmtKstDateTime(iso: string | null | undefined): string {
  const p = kstParts(iso);
  return p ? `${pad2(p.mo)}-${pad2(p.d)} ${pad2(p.h)}:${pad2(p.mi)}` : DASH;
}

/** `YYYY-MM-DD` → `MM-DD` (국내 세션일 — KST 날짜). 형식이 아니면 `—`. */
export function fmtSessionDate(date: string | null | undefined): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date ?? '');
  return m ? `${m[1]}-${m[2]}` : DASH;
}

/** 해외 세션일 `ET MM-DD` (ET 날짜 그대로 — KST 로 바꾸지 않는다). */
export function fmtEtSession(date: string | null | undefined): string {
  const s = fmtSessionDate(date);
  return s === DASH ? DASH : `ET ${s}`;
}

/** 시장별 세션일 표기 — 국내 `MM-DD`, 해외 `ET MM-DD`. */
export function fmtSession(ref: { sessionDate: string; tz: 'KST' | 'ET' } | null | undefined): string {
  if (!ref) return DASH;
  return ref.tz === 'ET' ? fmtEtSession(ref.sessionDate) : fmtSessionDate(ref.sessionDate);
}

/** 환율(소수 1자리, 천 단위) `1,380.0`. */
export function fmtFxRate(rate: number): string {
  return rate.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export const FX_MAX_AGE_MS = 24 * 3600_000;

/**
 * 달러 금액 + 원화 환산(가이드 §2.1·D9). 환산은 **환율 시각이 있고(fx_rates 출처) 24시간 이내일 때만** 붙인다.
 * 기본값(fallback)·환율 없음·24시간 초과면 환산을 숨기고 meta 에 사유를 돌려준다 — 기본 환율로 지어낸 원화 금액을 보이지 않는다.
 */
export function fmtUsdWithKrw(input: {
  usd: number; krw: number | null; fxAt: string | null; fxSource: 'fx_rates' | 'fallback' | null; rate?: number | null; nowMs: number;
}): { text: string; converted: boolean; fxMeta: string } {
  const usd = fmtUsd(input.usd);
  const fxMs = input.fxAt ? Date.parse(input.fxAt) : NaN;
  const fresh = Number.isFinite(fxMs) && input.nowMs - fxMs <= FX_MAX_AGE_MS;
  if (input.fxSource === 'fx_rates' && input.krw != null && fresh) {
    return { text: `${usd} ≈ ${fmtKrw(input.krw)}`, converted: true, fxMeta: `환율 ${fmtKstTime(input.fxAt, input.nowMs)}` };
  }
  if (input.fxSource === 'fx_rates' && Number.isFinite(fxMs) && !fresh) {
    return { text: usd, converted: false, fxMeta: `환율 ${CHIP.stale(fmtKstTime(input.fxAt, input.nowMs))} — 원화 환산 숨김` };
  }
  const rate = typeof input.rate === 'number' && Number.isFinite(input.rate) ? `${fmtFxRate(input.rate)} ` : '';
  return { text: usd, converted: false, fxMeta: `환율 ${rate}기본값(fallback) — 원화 환산 숨김` };
}

/** 상태 칩 문구 — 데모 C 절 그대로(가이드 §2.1 마지막 줄). 모양(클래스)은 `StatusChip kind`. */
export const CHIP = {
  zero: '✓ 확인된 0',
  noIssue: '✓ 이상 없음',
  unknown: '◌ 미수집',
  error: (code: string) => `! 조회 실패 · ${code}`,
  stale: (at: string) => `오래됨 · 기준 ${at}`,
  fewer: (n: number) => `건수 적음 · ${n}건 (30건 미만)`,
  blocked: (why: string) => `⊘ 차단 · ${why}`,
  offHours: (open: string) => `장외 · 개장 ${open} KST`,
  prep: (what: string) => `준비 중 · ${what} 뒤`,
} as const;

/** 건수 적음 기준(T-095 경고 규칙): 30건 미만. */
export const FEW_SAMPLE_LIMIT = 30;
