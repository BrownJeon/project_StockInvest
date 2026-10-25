/**
 * T-087 (T-081 WP-D1a) — 수집 **커버리지** 판정(설계 §3.4 H-1·L-2·L-6). D3(`src/lib/ledger/` 후보 설명)가 쓸 순수 함수 + 읽기 질의.
 * DB 연결은 호출자가 주입한다(`@/lib/db` import 없음 — 정적 시험).
 *
 * 규칙:
 *  1. (계좌·시장·종류)별 `status='complete'` run 의 구간 `[TIMESTAMP(window_from) 00:00, effective_to]` 를 모은다.
 *     `effective_to = min(window_to 24:00, started_at)` 는 DB 생성열이다 — 실행 뒤에 생긴 체결은 그 창이 보증하지 않는다.
 *  2. **`effective_to` 기준 병합**: 다음 구간의 시작 ≤ 앞 구간의 끝일 때만 잇는다. "window_to + 1일 = 다음 window_from" 같은 **날짜 인접 병합은 금지**
 *     (앞 창이 당일 07:25 에 돌았으면 그날 오후를 커버됨으로 읽는다 — 검토 재현, L-2).
 *  3. 스냅샷 단계 `prev → cur` 는 구간 **`[prev.ts − L, cur.ts]`**(L = 체결 매칭 여유, 기본 1일 — L-6)가 병합 구간 하나에 통째로 들어갈 때만 커버됨.
 *  4. 표가 없으면(1146) 예외를 올리지 않고 `not_migrated` — 소비자는 **모든 단계를 coverage_gap** 으로 다룬다.
 *  ⚠ 커버됨(complete)은 "받은 행은 사실·창을 끝까지 봤다"일 뿐 **"없음"의 증거가 아니다**(M-B). 부재 주장은 positive_check='confirmed' 창에서만 —
 *     그 판정은 D2 소유라 여기서 하지 않는다. {@link loadCoverage} 는 창별 positive_check 를 함께 돌려줄 뿐이다.
 *
 * 시각은 전부 **KST 벽시계**로 비교한다(DB DATETIME 이 KST — 서버 TZ). 문자열 `YYYY-MM-DD[ HH:MM:SS]` 또는 Date(→ KST 로 환산)를 받는다.
 */
import type { BrokerMarket, BrokerRunKind, PositiveCheck } from './types';
import { isLedgerTableMissing, type SqlQueryable } from './store';

/** 체결 매칭 여유 L(설계 §5.2 — 1일). */
export const COVERAGE_MATCH_MARGIN_MS = 24 * 3_600_000;

/** KST 벽시계 시각을 비교용 정수로(벽시계를 UTC 로 읽은 ms — 같은 자로만 비교한다). 해석할 수 없으면 null. */
export function kstWallMs(v: string | Date): number | null {
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t + 9 * 3_600_000 : null;
  }
  if (typeof v !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(v.trim());
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;
  const t = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  const back = new Date(t);
  if (back.getUTCFullYear() !== Number(y) || back.getUTCMonth() !== Number(mo) - 1 || back.getUTCDate() !== Number(d)) return null;
  if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return null;
  return t;
}

export interface CoverageWindow {
  /** `YYYY-MM-DD`(그날 00:00 KST 부터). */
  windowFrom: string;
  /** DB 생성열 effective_to(KST `YYYY-MM-DD HH:MM:SS`). */
  effectiveTo: string;
  positiveCheck?: PositiveCheck;
}

export interface CoverageInterval { startMs: number; endMs: number }

/**
 * complete 창들 → effective_to 기준으로 병합한 구간(시작 순). 해석할 수 없는 창·끝이 시작보다 이른 창은 버린다(커버리지를 넓히는 쪽으로 추측하지 않는다).
 * 병합 조건: `next.start ≤ cur.end` (같으면 이어짐 — 구간 끝과 다음 시작이 같은 순간이면 틈이 없다).
 */
export function mergeCoverage(windows: readonly CoverageWindow[]): CoverageInterval[] {
  const iv: CoverageInterval[] = [];
  for (const w of windows) {
    const s = kstWallMs(w.windowFrom);
    const e = kstWallMs(w.effectiveTo);
    if (s == null || e == null || e < s) continue;
    iv.push({ startMs: s, endMs: e });
  }
  iv.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const out: CoverageInterval[] = [];
  for (const x of iv) {
    const last = out[out.length - 1];
    if (last && x.startMs <= last.endMs) last.endMs = Math.max(last.endMs, x.endMs);
    else out.push({ ...x });
  }
  return out;
}

/** 단계 `prev → cur` 의 확인 구간 `[prev − L, cur]`(L-6). */
export function stepRange(prevTs: string | Date, curTs: string | Date, marginMs = COVERAGE_MATCH_MARGIN_MS): { fromMs: number; toMs: number } | null {
  const p = kstWallMs(prevTs);
  const c = kstWallMs(curTs);
  if (p == null || c == null || c < p) return null;
  return { fromMs: p - marginMs, toMs: c };
}

/** 병합 구간 하나가 `[fromMs, toMs]` 를 통째로 포함하는가. */
export function isRangeCovered(intervals: readonly CoverageInterval[], fromMs: number, toMs: number): boolean {
  return intervals.some((x) => x.startMs <= fromMs && x.endMs >= toMs);
}

/** 순수 판정 — 단계가 커버되면 'covered', 아니면 'coverage_gap'(시각 해석 불가 포함). */
export function stepCoverage(windows: readonly CoverageWindow[], prevTs: string | Date, curTs: string | Date, marginMs = COVERAGE_MATCH_MARGIN_MS): 'covered' | 'coverage_gap' {
  const r = stepRange(prevTs, curTs, marginMs);
  if (!r) return 'coverage_gap';
  return isRangeCovered(mergeCoverage(windows), r.fromMs, r.toMs) ? 'covered' : 'coverage_gap';
}

export type CoverageLoad =
  | { status: 'ok'; windows: CoverageWindow[] }
  | { status: 'not_migrated' };

/**
 * (계좌·시장·종류)의 complete 창 목록(읽기 전용). 시각은 `DATE_FORMAT` 문자열로 받아 풀 설정과 무관하게 KST 벽시계를 유지한다.
 * 표가 없으면 `not_migrated`(예외 아님 — 소비자는 전 단계 coverage_gap). 그 밖의 DB 오류는 던진다.
 */
export async function loadCoverage(q: SqlQueryable, accountId: number, market: BrokerMarket, kind: BrokerRunKind): Promise<CoverageLoad> {
  try {
    const [r] = await q.query(
      `SELECT DATE_FORMAT(window_from, '%Y-%m-%d') AS wf, DATE_FORMAT(effective_to, '%Y-%m-%d %H:%i:%s') AS et, positive_check AS pc
         FROM broker_fill_runs
        WHERE account_id = ? AND market = ? AND kind = ? AND status = 'complete'
        ORDER BY window_from, id`,
      [accountId, market, kind]);
    const list = (Array.isArray(r) ? r : []) as { wf: string; et: string; pc: PositiveCheck }[];
    return { status: 'ok', windows: list.map((x) => ({ windowFrom: String(x.wf), effectiveTo: String(x.et), positiveCheck: x.pc })) };
  } catch (e) {
    if (isLedgerTableMissing(e)) return { status: 'not_migrated' };
    throw e;
  }
}

/** DB 에서 읽어 단계 커버리지를 판정한다. 표 없음 → 'coverage_gap'(예외 아님 · 설계 §3.4). */
export async function isStepCovered(
  q: SqlQueryable, accountId: number, market: BrokerMarket, kind: BrokerRunKind, prevTs: string | Date, curTs: string | Date,
): Promise<'covered' | 'coverage_gap'> {
  const c = await loadCoverage(q, accountId, market, kind);
  if (c.status === 'not_migrated') return 'coverage_gap';
  return stepCoverage(c.windows, prevTs, curTs);
}
