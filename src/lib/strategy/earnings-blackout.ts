/**
 * earnings-blackout.ts — 실적 발표 블랙아웃 프리필터 (T-062 요구 7, T-057 Q6 (b)).
 *
 * 규칙(결정론적 — 프롬프트에 맡기지 않는다, 2026-08-02 결정 #2):
 * - `confirmed`·`manual` 일정이 D0 다음 **5 미국 거래일**(S1..S5) 안에 있으면 그 종목의 BUY 카드를 만들지 않는다.
 *   거래일이 아닌 날짜(주말·휴장)에 잡힌 일정도 D0 < 날짜 ≤ S5 이면 같은 범위로 본다(반응은 그 다음 거래일 ≤ S5 또는 S6 에 온다 —
 *   막는 쪽으로 넓게 잡는다).
 * - D0 당일 일정은 `BMO`(장 시작 전)만 통과한다 — 이미 D0 종가에 반영됐다. `AMC`·`unknown` 은 반응이 S1 에 오므로 막는다.
 * - `estimated`(추정 창)는 **막지 않고** 카드 `indicators.earnings` 에만 기록한다(Q-2 결정).
 * - 일정 조회 실패·테이블 없음은 `unknown` — 호출부가 해외 실행 전체를 건너뛴다(Q-1 (a), fail-closed).
 *
 * 한계(가리지 않는다): P1 수집기는 `estimated` 만 자동으로 채운다. `confirmed`·`manual` 은 사람이 입력해야 하므로, 입력 전에는
 * 이 필터가 아무것도 막지 않는다(T-057 §0-4).
 */
import type { RowDataPacket } from 'mysql2';
import { findMissingTables, type Queryable } from '@/lib/data/us-data-db';

/** Q6 (b) — 블랙아웃 길이(미국 거래일). */
export const EARNINGS_BLACKOUT_DAYS = 5;

export type EarningsEventStatus = 'confirmed' | 'estimated' | 'manual';
export type EarningsTimeClass = 'BMO' | 'AMC' | 'unknown';

/** `us_earnings_events` 활성 행(superseded_by IS NULL) 한 줄. 날짜는 ET `YYYY-MM-DD`. */
export interface EarningsEventRow {
  symbol: string;
  status: EarningsEventStatus;
  eventDateEt: string | null;
  windowStartEt: string | null;
  windowEndEt: string | null;
  eventTimeClass: EarningsTimeClass;
}

/** 카드 `indicators.earnings` (화면 데이터 계약 G5). `confirmed_blackout` 은 카드가 만들어지지 않으므로 저장되지 않는다. */
export interface EarningsSummary {
  status: 'none' | 'estimated_window' | 'confirmed_blackout';
  /** status = estimated_window 일 때만 — 겹친 추정 창(ET 날짜). */
  window?: { from: string; to: string };
  /** 아직 발표 전인 가장 이른 confirmed/manual 일정(ET 날짜). 없으면 null. */
  nextConfirmed: string | null;
  blackout_days: typeof EARNINGS_BLACKOUT_DAYS;
  /** 판정 시각(ISO 8601 + 오프셋). */
  observedAt: string;
}

export interface BlackoutVerdict {
  blocked: boolean;
  summary: EarningsSummary;
}

const isDated = (e: EarningsEventRow) => (e.status === 'confirmed' || e.status === 'manual') && !!e.eventDateEt;

/** D0 시점에 아직 발표되지 않은 확정 일정인가(D0 BMO 는 이미 발표됨). */
function isUnreleased(e: EarningsEventRow, d0: string): boolean {
  if (!isDated(e)) return false;
  const d = e.eventDateEt as string;
  return d > d0 || (d === d0 && e.eventTimeClass !== 'BMO');
}

/**
 * 한 종목의 블랙아웃 판정(순수 함수). `sessions` = D0 다음 거래일 S1..S5 (길이 {@link EARNINGS_BLACKOUT_DAYS}).
 * 날짜 비교는 `YYYY-MM-DD` 문자열 사전순(= 날짜순)이다.
 */
export function judgeBlackout(
  events: readonly EarningsEventRow[],
  d0: string,
  sessions: readonly string[],
  observedAt: string,
): BlackoutVerdict {
  if (sessions.length !== EARNINGS_BLACKOUT_DAYS) {
    throw new Error(`블랙아웃 판정에는 다음 거래일 ${EARNINGS_BLACKOUT_DAYS}개가 필요하다 (받은 수 ${sessions.length})`);
  }
  const sLast = sessions[sessions.length - 1];

  const blocked = events.some((e) => {
    if (!isDated(e)) return false;
    const d = e.eventDateEt as string;
    if (d === d0) return e.eventTimeClass !== 'BMO';
    return d > d0 && d <= sLast;
  });

  const nextConfirmed = events
    .filter((e) => isUnreleased(e, d0))
    .map((e) => e.eventDateEt as string)
    .sort()[0] ?? null;

  const base = { nextConfirmed, blackout_days: EARNINGS_BLACKOUT_DAYS, observedAt } as const;
  if (blocked) return { blocked: true, summary: { status: 'confirmed_blackout', ...base } };

  // 추정 창이 [D0, S5] 와 겹치면 기록만 한다 — 가장 먼저 시작하는 창 하나.
  const overlapping = events
    .filter((e) => e.status === 'estimated' && e.windowStartEt && e.windowEndEt)
    .filter((e) => (e.windowStartEt as string) <= sLast && (e.windowEndEt as string) >= d0)
    .sort((a, b) => (a.windowStartEt as string).localeCompare(b.windowStartEt as string));
  if (overlapping.length > 0) {
    const w = overlapping[0];
    return {
      blocked: false,
      summary: { status: 'estimated_window', window: { from: w.windowStartEt as string, to: w.windowEndEt as string }, ...base },
    };
  }
  return { blocked: false, summary: { status: 'none', ...base } };
}

export type EarningsLoad =
  | { kind: 'ok'; bySymbol: Map<string, EarningsEventRow[]> }
  | { kind: 'unknown'; reason: 'table_missing' | 'read_failed' };

const STATUSES: ReadonlySet<string> = new Set(['confirmed', 'estimated', 'manual']);
const TIME_CLASSES: ReadonlySet<string> = new Set(['BMO', 'AMC', 'unknown']);
const ymdOrNull = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/**
 * 후보 종목들의 **활성**(superseded_by IS NULL) 실적 일정 중 D0 이후와 관련된 행만 읽는다. 던지지 않는다.
 * 테이블 없음 → `unknown/table_missing`, 조회 오류 → `unknown/read_failed`. 행을 해석할 수 없는 값(enum 밖)은 버리지 않고
 * `read_failed` 로 본다 — 모르는 형식의 확정 일정을 조용히 빼면 막아야 할 카드를 만든다.
 */
export async function loadEarningsEvents(db: Queryable, symbols: readonly string[], d0: string): Promise<EarningsLoad> {
  try {
    const missing = await findMissingTables(db, ['us_earnings_events']);
    if (missing.length > 0) return { kind: 'unknown', reason: 'table_missing' };
  } catch {
    return { kind: 'unknown', reason: 'read_failed' };
  }
  const bySymbol = new Map<string, EarningsEventRow[]>();
  if (symbols.length === 0) return { kind: 'ok', bySymbol };
  try {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT symbol, status, event_time_class,
              DATE_FORMAT(event_date_et, '%Y-%m-%d')   AS event_date_et,
              DATE_FORMAT(window_start_et, '%Y-%m-%d') AS window_start_et,
              DATE_FORMAT(window_end_et, '%Y-%m-%d')   AS window_end_et
         FROM us_earnings_events
        WHERE symbol IN (?)
          AND superseded_by IS NULL
          AND ((status IN ('confirmed', 'manual') AND event_date_et >= ?)
               OR (status = 'estimated' AND window_end_et >= ?))`,
      [symbols as string[], d0, d0],
    );
    for (const r of rows ?? []) {
      const status = String(r?.status ?? '');
      const cls = String(r?.event_time_class ?? '');
      if (!STATUSES.has(status) || !TIME_CLASSES.has(cls)) return { kind: 'unknown', reason: 'read_failed' };
      const row: EarningsEventRow = {
        symbol: String(r.symbol),
        status: status as EarningsEventStatus,
        eventDateEt: ymdOrNull(r.event_date_et),
        windowStartEt: ymdOrNull(r.window_start_et),
        windowEndEt: ymdOrNull(r.window_end_et),
        eventTimeClass: cls as EarningsTimeClass,
      };
      if ((row.status === 'confirmed' || row.status === 'manual') && !row.eventDateEt) {
        return { kind: 'unknown', reason: 'read_failed' };   // DB CHECK 가 막지만, 날짜 없는 확정 일정은 판정할 수 없다
      }
      const list = bySymbol.get(row.symbol) ?? [];
      list.push(row);
      bySymbol.set(row.symbol, list);
    }
    return { kind: 'ok', bySymbol };
  } catch {
    return { kind: 'unknown', reason: 'read_failed' };
  }
}
