/**
 * T-143 WP-B — 해외 분석 대상 저장소 (구현 가이드 §4·§5). **DB 만 읽고 쓴다.**
 *
 * 경계(가이드 §0.3 · §4 공통 규칙):
 *  - KIS·SEC·외부 호출 **0건**. 주문·시그널·알림 생성 **0건**. `orders`·`signals`·`position_state` 에 **쓰지 않는다**
 *    (`position_state` 는 보유 종목 이름·수량만 SELECT). `src/lib/safety/**` 를 import 하지 않는다.
 *  - 쓰는 곳은 T-143 전용 표 2개뿐 — `overseas_universe_revision`(가산 전용) · `overseas_universe_proposal`(상태 전이).
 *  - 마이그레이션(`scripts/migrations/T-143-overseas-universe.sql`) 적용 전에는 errno 1146 을 받아
 *    `not_migrated` 로 돌려준다(라우트가 503, 화면은 「준비 중」 — T-074 선례).
 *
 * 충돌 처리(가이드 §4.2·§4.3): 수동 목록은 **개정판 번호를 명시해 INSERT** 하므로 잠금 없이 「전부 아니면 전무」가 성립한다.
 * 같은 교체·같은 제안 처리를 두 번 보내면 두 번째는 409 이고 DB 는 그대로다.
 */
import type { RowDataPacket } from 'mysql2/promise';
import { getPool } from '@/lib/db';
import { isOverseasSymbol } from '@/lib/exchanges/kis-symbols';
import { fallbackOverseasUniverse, parseRevisionSymbols } from '@/lib/strategy/universe-overseas-static';
import { MANUAL_LIST_MAX, checkManualSymbols } from './parse-manual-list';
import {
  AUTO_REFRESH_CONFIG_KEY, AUTO_REFRESH_DEFAULT, parseHhmm, readAutoRefreshConfig, readAutoRefreshSwitch,
  type AutoRefreshConfig, type AutoRefreshSwitch,
} from './refresh-config';
import {
  actionLabel, actionVerb, applyProposalToManual, heldWarnText, proposalDoneText, proposalEffect, proposalKindLabel,
} from './proposal-copy';
import type {
  ManualReplaceResult, Proposal, ProposalActionType, ProposalDo, ProposalState, UniverseRow, UniverseScreenDTO,
  UniverseSection, UniverseSource, UniverseSummary, UniverseWatch, WatchCoverage, WatchSourceId,
} from './types';

// ── 시각 (DB·앱 풀 모두 KST — T-046·T-112 규칙) ─────────────────────────────

const KST_OFFSET_MS = 9 * 3600_000;
const DAY_MS = 86_400_000;

/** epoch ms → `YYYY-MM-DDTHH:mm:ss+09:00`. */
export function kstIso(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000 + KST_OFFSET_MS).toISOString().slice(0, 19) + '+09:00';
}
/** epoch ms → DB DATETIME 바인딩용 KST 벽시계 `YYYY-MM-DD HH:MM:SS`. */
export function kstSql(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000 + KST_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');
}
/** DB DATETIME(문자열·Date) → ISO +09:00. 값이 없거나 해석 불가면 null. */
export function dbTimeToIso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    // mysql2 가 Date 로 주면 그 값은 KST 벽시계를 로컬 시각으로 읽은 것이다(풀이 KST) → 벽시계 그대로 표기한다
    const p = new Date(v.getTime() - v.getTimezoneOffset() * 60_000);
    return p.toISOString().slice(0, 19) + '+09:00';
  }
  const s = String(v).trim().replace(' ', 'T');
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s) ? s.slice(0, 19) + '+09:00' : null;
}
/** KST 날짜 차(일). 둘 중 하나라도 모르면 null. */
export function daysAgoKst(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d0 = Math.floor((t + KST_OFFSET_MS) / DAY_MS);
  const d1 = Math.floor((nowMs + KST_OFFSET_MS) / DAY_MS);
  return d1 - d0;
}

// ── 오류 분류 ───────────────────────────────────────────────────────────────

/** MariaDB/MySQL 「테이블 없음」(errno 1146, ER_NO_SUCH_TABLE) — 마이그레이션 적용 전. */
export function isNoSuchTable(e: unknown): boolean {
  const x = e as { code?: string; errno?: number } | null;
  return !!x && (x.code === 'ER_NO_SUCH_TABLE' || x.errno === 1146);
}
/** 유니크 키 충돌(1062) — 개정판 번호가 이미 쓰였다 = 다른 기기가 먼저 저장했다. */
export function isDupEntry(e: unknown): boolean {
  const x = e as { code?: string; errno?: number } | null;
  return !!x && (x.code === 'ER_DUP_ENTRY' || x.errno === 1062);
}
function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
/** 섹션 1개 — 던지지 않는다. 실패는 그 섹션만 error(HTTP 200). 「테이블 없음」은 호출자가 먼저 가른다. */
async function section<T>(label: string, fn: () => Promise<T>): Promise<UniverseSection<T>> {
  try {
    return { state: 'ok', data: await fn() };
  } catch (e) {
    const code = isNoSuchTable(e) ? 'not_migrated' : 'db_error';
    console.warn(`[universe/store] ${label} 섹션 실패: ${code}`);
    return { state: 'error', error: code };
  }
}

// ── 최소 쿼리 인터페이스 (시험 대역 주입용 — us-data-db.ts 와 같은 모양) ────

export interface Queryable {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<[T, unknown]>;
}

/** 트랜잭션 연결 — mysql2 `PoolConnection` 과 시험 대역이 모두 만족하는 최소 모양(m-1 시험 주입). */
export interface TxConnection extends Queryable {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
  destroy(): void;
}

function pool(): Queryable {
  return getPool() as unknown as Queryable;
}

/** mysql2 가 배열 대신 ResultSetHeader 를 줄 수 있으므로(시험 대역·쓰기 결과) 항상 확인한다. */
function rowsOf<T>(out: unknown): T[] {
  return Array.isArray(out) ? (out as T[]) : [];
}
function intOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Math.trunc(Number(v.trim()));
  return null;
}
function numOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}
/**
 * JSON 텍스트 → 문자열 배열. **판독기와 같은 함수**(`parseRevisionSymbols`)로 읽고, 읽기 실패는 빈 배열 + `valid: false` 다.
 *
 * 🔴 전에는 이 모듈이 자체 파서로 손상 값을 **빈 배열**로 바꿔 「정상 개정판」처럼 돌려줬다(⑤·3차 L-d) —
 * 그래서 화면은 「수동 0종목」, 판독기는 「저하(마지막 성공 목록 사용)」로 **같은 값을 다르게** 읽었고,
 * 그 위에서 제안 처리가 빈 목록을 기준으로 **거의 빈 개정판을 확정**할 수 있었다. 이제 한 함수만 쓴다.
 */
export function parseSymbolArray(v: unknown): { symbols: string[]; valid: boolean } {
  const parsed = parseRevisionSymbols(v);
  return parsed == null ? { symbols: [], valid: false } : { symbols: parsed, valid: true };
}

// ── 설정 (Q2 주기 · Q4 개수) ────────────────────────────────────────────────

/**
 * 🔴 설정 판독은 **`./refresh-config` 한 벌**이다(T-145 ③). 분석 쪽 판독기
 * (`src/lib/strategy/universe-overseas-static.ts`)가 자동 목록을 읽기 **전에** 같은 스위치를 봐야 하는데,
 * 이 모듈은 그 판독기를 거꾸로 import 하므로(위 `fallbackOverseasUniverse`) 그쪽에서 이 모듈을 부르면
 * `strategy → universe/store → strategy` 순환이 된다. 그래서 설정만 떼어내고 여기서는 **재수출만** 한다 —
 * `AUTO_REFRESH_CONFIG_KEY` 리터럴과 `enabled` 해석이 두 벌이 되면 한쪽만 고쳐 어긋난다.
 * 종전 import 경로(`from './store'`)는 그대로 쓸 수 있다.
 */
export {
  AUTO_REFRESH_CONFIG_KEY, AUTO_REFRESH_DEFAULT, parseHhmm, readAutoRefreshConfig, readAutoRefreshSwitch,
};
export type { AutoRefreshConfig, AutoRefreshSwitch };

/**
 * 그 달(KST 벽시계)의 `nth` 번째 `weekday` 날짜(1~31). 그 달에 그런 날이 없으면(예: 5번째 일요일) null.
 * KST 벽시계 날짜 Y-M-D 를 `Date.UTC(Y, M, D)` 로 다루므로 `getUTCDay()` 가 그 벽시계 날짜의 요일이다.
 */
export function nthWeekdayOfMonth(year: number, month0: number, weekday: number, nth: number): number | null {
  const firstDow = new Date(Date.UTC(year, month0, 1)).getUTCDay();
  const day = 1 + ((weekday - firstDow + 7) % 7) + (nth - 1) * 7;
  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  return day <= daysInMonth ? day : null;
}

/**
 * 다음 자동 산출 예정(ISO +09:00) — **`nth` 번째 `weekday` 의 `windowStart`**(Q2, W-1). 화면이 계산하지 않는다(§2.2).
 * 기준 시각보다 **뒤**인 첫 시각을 돌려준다(같은 시각은 이미 지난 것으로 본다).
 *
 * 보류 해제 시각(`held_until`)도 이 값을 쓴다 — `enabled` 가 꺼져 있어도 그렇게 한다. 산출이 꺼진 동안
 * 보류가 영구히 숨겨지면 「공시가 갱신되면 그때 다시 올라옵니다」가 거짓이 되므로, 날짜는 **예정표대로** 둔다.
 */
export function nextAutoRefreshAt(afterMs: number, cfg: AutoRefreshConfig): string {
  const [hh, mm] = cfg.windowStart.split(':').map((x) => Number(x));
  const w = new Date(afterMs + KST_OFFSET_MS);
  let y = w.getUTCFullYear();
  let m = w.getUTCMonth();
  // 설정이 clamp 를 거쳤으므로 두 달 안에 반드시 나온다. 24개월은 방어용 상한이다(무한 반복 금지)
  for (let i = 0; i < 24; i += 1) {
    const day = nthWeekdayOfMonth(y, m, cfg.weekday, cfg.nth);
    if (day != null) {
      const ms = Date.UTC(y, m, day, hh, mm) - KST_OFFSET_MS;
      if (ms > afterMs) return kstIso(ms);
    }
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  // 도달 불가(설정이 범위 밖이면 clamp 가 막는다). 날짜를 꼭 주어야 하는 호출자가 있어 null 을 돌려주지 않는다
  return kstIso(afterMs + 30 * DAY_MS);
}

// ── 수동 목록 (현재 개정판) ─────────────────────────────────────────────────

export interface ManualRevision {
  revisionNo: number;
  symbols: string[];
  /**
   * 🔴 저장된 `symbols` 열을 **제대로 읽었는가**(⑤). `false` 면 `symbols` 는 빈 배열이고 **그 값을 기준으로
   * 쓰기를 하면 안 된다** — 제안 처리는 중단하고(빈 목록을 확정하지 않게), 일괄 교체는 **허용한다**
   * (사용자가 전체 목록을 붙여 넣는 것이 손상된 개정판의 복구 경로다).
   */
  symbolsValid: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

const MANUAL_LATEST_SQL =
  'SELECT revision_no, symbols, created_at, updated_by FROM overseas_universe_revision ORDER BY revision_no DESC LIMIT 1';

/**
 * 현재 수동 목록. 개정판이 **0건이면 null** 이다(빈 목록과 구분한다 — 0건은 「아직 DB 로 전환하지 않음」,
 * 빈 목록은 「사용자가 일부러 비웠음」이다. 판독기 B0 의 폴백 판정이 이 차이에 걸려 있다).
 * 표가 없으면 errno 1146 을 **그대로 던진다** — 호출자가 `not_migrated` 로 가른다.
 */
export async function readManualRevision(db: Queryable = pool()): Promise<ManualRevision | null> {
  const [out] = await db.query<RowDataPacket[]>(MANUAL_LATEST_SQL);
  const r = rowsOf<RowDataPacket>(out)[0];
  if (!r) return null;
  const no = intOf(r.revision_no);
  if (no == null) return null;
  const parsed = parseSymbolArray(r.symbols);
  return {
    revisionNo: no,
    symbols: parsed.symbols,
    symbolsValid: parsed.valid,
    updatedAt: dbTimeToIso(r.created_at),
    updatedBy: r.updated_by == null ? null : String(r.updated_by),
  };
}

// ── 목록 재료 (수동·자동·즐겨찾기·보유) ─────────────────────────────────────

export interface UniverseParts {
  manual: string[];
  /**
   * 🔴 수동 목록이 어디서 왔나(high-2). 개정판이 0건이면 **판독기와 같은 폴백**(환경변수 → 코드 하드코딩)을
   * 합산한다 — 그러지 않으면 화면이 「수동 0 · 분석 대상 11」을 보이는데 실제 분석은 50종목을 돈다.
   * 보이는 문구는 designer 가 정한다(이 값은 그 판단의 입력이다).
   */
  manualSource: 'db' | 'fallback';
  /**
   * 🔴 저장된 개정판을 제대로 읽었는가(⑤). 폴백을 쓰는 중이면(개정판 없음) `true` 다 — 폴백은 늘 유효하다.
   * `false` 면 **제안 처리(`act`)를 막는다**: 빈 목록을 기준으로 새 개정판을 확정하면 분석이 조용히 비어 버린다.
   */
  manualValid: boolean;
  manualVersion: number;
  manualUpdatedAt: string | null;
  auto: { symbol: string; rank: number }[];
  autoRefreshedAt: string | null;
  favorites: string[];
  held: Map<string, number | null>;
}

/**
 * 네 출처를 한 번에 읽는다. **자동·즐겨찾기·보유 조회 실패는 삼키지 않는다** — 목록 수가 틀리면 효과 숫자가 틀리고
 * 「분석 대상 150」이 거짓이 된다. 섹션 단위로 실패하는 쪽이 낫다(호출자가 `section()` 으로 감싼다).
 * 즐겨찾기는 국내 종목도 담기므로 **해외 형식만** 센다(`us-data-db.loadUsTargetSymbols` 와 같은 규칙).
 */
export async function readUniverseParts(db: Queryable = pool(), nowMs: number = Date.now()): Promise<UniverseParts> {
  const [rev, autoOut, favOut, posOut] = await Promise.all([
    readManualRevision(db),
    db.query<RowDataPacket[]>('SELECT symbol, rank_no, computed_at FROM overseas_universe_auto ORDER BY rank_no ASC'),
    db.query<RowDataPacket[]>('SELECT symbol FROM stock_favorites'),
    db.query<RowDataPacket[]>("SELECT symbol, qty FROM position_state WHERE market = 'overseas'"),
  ]);
  void nowMs;
  const auto: { symbol: string; rank: number }[] = [];
  let autoRefreshedAt: string | null = null;
  for (const r of rowsOf<RowDataPacket>(autoOut[0])) {
    const symbol = String(r.symbol ?? '');
    const rank = intOf(r.rank_no);
    if (!symbol || rank == null) continue;
    auto.push({ symbol, rank });
    const at = dbTimeToIso(r.computed_at);
    if (at && (autoRefreshedAt == null || at > autoRefreshedAt)) autoRefreshedAt = at;
  }
  const favorites = rowsOf<RowDataPacket>(favOut[0]).map((r) => String(r.symbol ?? '')).filter((s) => isOverseasSymbol(s));
  const held = new Map<string, number | null>();
  for (const r of rowsOf<RowDataPacket>(posOut[0])) {
    const symbol = String(r.symbol ?? '');
    if (!symbol) continue;
    held.set(symbol, numOf(r.qty));
  }
  // 🔴 high-2 — 개정판이 없으면 분석이 실제로 쓰는 값(판독기의 폴백)을 합산한다. 0 을 보여 주면 거짓이다
  const manual = rev ? rev.symbols : fallbackOverseasUniverse();
  return {
    manual,
    manualSource: rev ? 'db' : 'fallback',
    manualValid: rev ? rev.symbolsValid : true,
    manualVersion: rev?.revisionNo ?? 0,
    manualUpdatedAt: rev?.updatedAt ?? null,
    auto,
    autoRefreshedAt,
    favorites,
    held,
  };
}

/** 분석 대상 = 보유 ∪ 즐겨찾기 ∪ 목록(수동 ∪ 자동) — `us-data-db.loadUsTargetSymbols` 와 같은 합집합. */
export function universeTotal(parts: Pick<UniverseParts, 'manual' | 'auto' | 'favorites' | 'held'>): Set<string> {
  const set = new Set<string>();
  for (const s of parts.manual) set.add(s);
  for (const a of parts.auto) set.add(a.symbol);
  for (const s of parts.favorites) set.add(s);
  for (const s of parts.held.keys()) set.add(s);
  return set;
}

/** 「목록을 비우면 남는 수」(보유 ∪ 즐겨찾기) — 데모의 「약 11종목」. */
export function heldOrFavoritesOnly(parts: Pick<UniverseParts, 'favorites' | 'held'>): number {
  const set = new Set<string>(parts.favorites);
  for (const s of parts.held.keys()) set.add(s);
  return set.size;
}

export function buildSummary(parts: UniverseParts, cfg: AutoRefreshConfig, nowMs: number): UniverseSummary {
  return {
    total: universeTotal(parts).size,
    manual: parts.manual.length,
    manualSource: parts.manualSource,
    auto: parts.auto.length,
    favorites: parts.favorites.length,
    held: parts.held.size,
    manualUpdatedAt: parts.manualUpdatedAt,
    manualUpdatedDaysAgo: daysAgoKst(parts.manualUpdatedAt, nowMs),
    manualVersion: parts.manualVersion,
    autoRefreshedAt: parts.autoRefreshedAt,
    // 산출 기록이 없거나 **스위치가 꺼져 있으면** 「다음」을 말하지 않는다 — 돌지 않는 작업의 예정 시각은 약속이 아니다
    // (WP-A 미착수·`enabled:false` 가 기본). 보류 해제 시각은 이와 달리 예정표대로 계산한다(nextAutoRefreshAt 주석)
    autoNextAt: parts.autoRefreshedAt && cfg.enabled ? nextAutoRefreshAt(nowMs, cfg) : null,
    autoTopN: cfg.topN,
    heldOrFavoritesOnlyCount: heldOrFavoritesOnly(parts),
  };
}

/** 목록 탭 줄 — 출처 칩·자동 순위·보유 수량·제안 유무. 이름은 `stock_meta` 에 있는 것만(외부 조회 0). */
export async function buildRows(
  parts: UniverseParts,
  proposalSymbols: ReadonlySet<string>,
  db: Queryable = pool(),
): Promise<UniverseRow[]> {
  const all = [...universeTotal(parts)].sort();
  const names = new Map<string, string>();
  if (all.length > 0) {
    try {
      const [out] = await db.query<RowDataPacket[]>('SELECT symbol, name FROM stock_meta WHERE symbol IN (?)', [all]);
      for (const r of rowsOf<RowDataPacket>(out)) {
        const s = String(r.symbol ?? '');
        const n = r.name == null ? '' : String(r.name);
        if (s && n) names.set(s, n);
      }
    } catch {
      // 이름을 못 읽는 것은 줄을 못 그리는 일이 아니다 — 코드만 그린다(홈 규칙과 같다)
    }
  }
  const manualSet = new Set(parts.manual);
  const favSet = new Set(parts.favorites);
  const autoRank = new Map(parts.auto.map((a) => [a.symbol, a.rank]));
  return all.map((symbol) => {
    const sources: UniverseSource[] = [];
    if (manualSet.has(symbol)) sources.push('manual');
    if (autoRank.has(symbol)) sources.push('auto');
    if (favSet.has(symbol)) sources.push('favorite');
    if (parts.held.has(symbol)) sources.push('held');
    return {
      symbol,
      name: names.get(symbol) ?? null,
      sources,
      autoRank: autoRank.get(symbol) ?? null,
      heldQty: parts.held.get(symbol) ?? null,
      hasProposal: proposalSymbols.has(symbol),
    };
  });
}

// ── 변경 제안 ───────────────────────────────────────────────────────────────

interface ProposalRow extends RowDataPacket {
  proposal_id: number | string;
  symbol: string;
  kind: string;
  basis_text: string;
  basis_source: string;
  collected_at: unknown;
  recommendation: string | null;
  action_type: string;
  next_symbol: string | null;
  state: string;
  held_until: unknown;
}

const PROPOSAL_COLS =
  'proposal_id, symbol, kind, basis_text, basis_source, collected_at, recommendation, action_type, next_symbol, state, held_until';

/**
 * 화면에 보일 제안. `open`·`held`·`ignored` 는 늘 보이고, `done` 은 **오늘 처리한 것만** 보인다
 * (처리 직후 새로 고쳐도 방금 한 일이 남아 있게. 영구히 쌓이면 카드가 끝없이 늘어난다).
 * 보류·무시는 탭 라벨 건수에서 빠진다 — 그것이 보류·무시의 뜻이다(D4).
 */
const PROPOSAL_LIST_SQL =
  `SELECT ${PROPOSAL_COLS} FROM overseas_universe_proposal
    WHERE state <> 'done' OR decided_at >= ?
    ORDER BY FIELD(state, 'open', 'held', 'ignored', 'done'), created_at DESC, proposal_id DESC
    LIMIT 200`;

/** 보류 해제 시각이 지난 제안은 **다시 `open` 으로 보인다** — 「공시가 갱신되면 그때 다시 올라옵니다」의 화면 쪽 절반. */
function effectiveState(state: string, heldUntilIso: string | null, nowMs: number): ProposalState {
  const s = state === 'held' || state === 'ignored' || state === 'done' ? state : 'open';
  if (s === 'held' && heldUntilIso) {
    const t = Date.parse(heldUntilIso);
    if (Number.isFinite(t) && t <= nowMs) return 'open';
  }
  return s;
}

function actionTypeOf(v: string): ProposalActionType {
  return v === 'add' ? 'add' : v === 'recode' ? 'recode' : 'remove';
}

/** 효과 계산의 재료(목록·요약 조회가 성공했을 때만 넘어온다). */
export interface EffectBase { manual: string[]; totalFrom: number; otherTotal: Set<string> }

function effectBaseOf(parts: UniverseParts): EffectBase {
  const other = new Set<string>();
  for (const a of parts.auto) other.add(a.symbol);
  for (const s of parts.favorites) other.add(s);
  for (const s of parts.held.keys()) other.add(s);
  return { manual: parts.manual, totalFrom: universeTotal(parts).size, otherTotal: other };
}

function toProposal(r: ProposalRow, nowMs: number, base: EffectBase | null): Proposal {
  const symbol = String(r.symbol ?? '');
  const type = actionTypeOf(String(r.action_type ?? ''));
  const nextSymbol = r.next_symbol == null ? null : String(r.next_symbol);
  const heldUntil = dbTimeToIso(r.held_until);
  const basisWhen = dbTimeToIso(r.collected_at);
  // 효과는 **적용 뒤 목록을 실제로 만들어** 센다. 보유 여부는 `withHeld` 가 따로 채운다(보유 칩·경고·완료 문구)
  let effect = null as Proposal['effect'];
  if (base) {
    const nextManual = applyProposalToManual(base.manual, { type, symbol, nextSymbol });
    const nextTotal = new Set<string>(nextManual);
    for (const s of base.otherTotal) nextTotal.add(s);
    effect = proposalEffect({
      manualFrom: base.manual.length,
      manualTo: nextManual.length,
      totalFrom: base.totalFrom,
      totalTo: nextTotal.size,
    });
  }
  return {
    id: String(r.proposal_id),
    symbol,
    kind: String(r.kind ?? ''),
    kindLabel: proposalKindLabel(r.kind, nextSymbol),
    // 근거는 잡이 넣은 한 줄 그대로. 수집일을 모르면 그 구절을 뺀다(0·오늘로 꾸미지 않는다)
    basis: basisWhen ? `${String(r.basis_text ?? '')} (${basisWhen.slice(5, 10)} 수집)` : String(r.basis_text ?? ''),
    recommendation: r.recommendation == null || String(r.recommendation).trim() === '' ? null : String(r.recommendation),
    action: { type, label: actionLabel(type, symbol, nextSymbol), verb: actionVerb(type), nextSymbol },
    effect,
    held: null,
    state: effectiveState(String(r.state ?? ''), heldUntil, nowMs),
    heldUntil,
    warn: null,
    doneText: proposalDoneText(type, false),
  };
}

/** 보유·즐겨찾기를 아는 상태에서 보유 칩·경고·완료 문구를 채운다(가이드 §2.4.2 — 4곳 중 카드 쪽 셋). */
function withHeld(p: Proposal, parts: UniverseParts | null): Proposal {
  if (!parts) return p;
  const isHeld = parts.held.has(p.symbol);
  if (!isHeld) return p;
  return {
    ...p,
    held: { qty: parts.held.get(p.symbol) ?? null },
    warn: heldWarnText(p.action.type, true),
    doneText: proposalDoneText(p.action.type, true),
  };
}

export async function readProposals(
  parts: UniverseParts | null,
  nowMs: number,
  db: Queryable = pool(),
): Promise<Proposal[]> {
  const todayStart = kstSql(Math.floor((nowMs + KST_OFFSET_MS) / DAY_MS) * DAY_MS - KST_OFFSET_MS);
  const [out] = await db.query<ProposalRow[]>(PROPOSAL_LIST_SQL, [todayStart]);
  const base = parts ? effectBaseOf(parts) : null;
  return rowsOf<ProposalRow>(out).map((r) => withHeld(toProposal(r, nowMs, base), parts));
}

/** 홈 「확인 필요」 입력 — 처리하지 않은 제안 수와 첫 줄 요약. **fail-closed 집합에 넣지 않는다**(가이드 §3.4). */
export interface OpenProposalBrief { open: number; first: string | null }

const OPEN_PROPOSAL_SQL =
  `SELECT symbol, kind, next_symbol FROM overseas_universe_proposal
    WHERE state = 'open' OR (state = 'held' AND held_until IS NOT NULL AND held_until <= ?)
    ORDER BY created_at DESC, proposal_id DESC LIMIT 100`;

/**
 * 제안 건수·첫 줄. 홈이 쓰는 값이라 **던지지 않는다** — 실패는 `null` 이고 그 줄만 빠진다
 * (섹션 전체를 오류로 만들면 「모든거래차단 ON」까지 가린다 — 가이드 §0.1 불편한 사실 6).
 * 첫 줄 문자열은 **서버가 완성해 준다**(홈이 조립하지 않는다 · 종목 코드는 전체 코드 — §3.1).
 */
export async function readOpenProposalBrief(nowMs: number = Date.now(), db: Queryable = pool()): Promise<OpenProposalBrief | null> {
  try {
    const [out] = await db.query<RowDataPacket[]>(OPEN_PROPOSAL_SQL, [kstSql(nowMs)]);
    const rows = rowsOf<RowDataPacket>(out);
    if (rows.length === 0) return { open: 0, first: null };
    const r = rows[0];
    const symbol = String(r.symbol ?? '');
    const label = proposalKindLabel(r.kind, r.next_symbol == null ? null : String(r.next_symbol));
    return { open: rows.length, first: `${symbol} ${label}`.trim() };
  } catch (e) {
    if (!isNoSuchTable(e)) console.warn(`[universe/store] 제안 건수 조회 실패: ${errText(e).slice(0, 120)}`);
    return null;
  }
}

// ── 변경 확인 기록 ──────────────────────────────────────────────────────────

const WATCH_SOURCES: readonly WatchSourceId[] = ['us_filings', 'news_overseas', 'listing'];

function parseCoverage(v: unknown): WatchCoverage[] {
  let arr: unknown = v;
  if (typeof v === 'string') {
    try { arr = JSON.parse(v); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  const out: WatchCoverage[] = [];
  for (const x of arr) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const source = String(o.source ?? '') as WatchSourceId;
    if (!WATCH_SOURCES.includes(source)) continue;
    out.push({ source, ok: o.ok === true, failedAt: typeof o.failedAt === 'string' ? o.failedAt : null });
  }
  return out;
}

const WATCH_LATEST_SQL =
  'SELECT checked_at, coverage, all_checked FROM overseas_universe_watch ORDER BY checked_at DESC, run_id DESC LIMIT 1';

/**
 * 마지막 변경 확인. 기록이 **0건이면 `lastCheckedAt=null`·`allChecked=false`** 다 — 그 상태에서 화면은
 * 「3곳 모두 확인」을 쓰지 않는다(가이드 §2.7 — 확인하지 않은 것을 확인했다고 쓰지 않는다).
 * `allChecked` 는 잡이 단정한 값을 그대로 읽는다(화면·이 함수가 원천 수를 세지 않는다).
 */
export async function readWatch(db: Queryable = pool()): Promise<UniverseWatch> {
  const [out] = await db.query<RowDataPacket[]>(WATCH_LATEST_SQL);
  const r = rowsOf<RowDataPacket>(out)[0];
  if (!r) return { lastCheckedAt: null, coverage: [], allChecked: false };
  return {
    lastCheckedAt: dbTimeToIso(r.checked_at),
    coverage: parseCoverage(r.coverage),
    allChecked: intOf(r.all_checked) === 1,
  };
}

// ── 화면 조회 (GET) ─────────────────────────────────────────────────────────

export type ScreenRead =
  | { kind: 'not_migrated' }
  | { kind: 'ok'; dto: UniverseScreenDTO };

/**
 * 화면 1회 조회(가이드 §4.1). **섹션 단위 실패 격리** — 한 섹션 실패는 그 섹션만 `error`, HTTP 200.
 * 요약·목록은 같은 재료(네 출처)를 쓰므로 함께 실패한다(숫자 칸 `—` + 「목록을 불러오지 못했습니다」).
 * 제안·변경 확인은 각자 따로 실패한다(§2.8).
 */
export async function readUniverseScreen(nowMs: number = Date.now(), db: Queryable = pool()): Promise<ScreenRead> {
  // T-143 표가 아직 없으면 화면 전체가 「준비 중」이다 — 섹션별 오류로 흉내 내지 않는다
  try {
    await readManualRevision(db);
  } catch (e) {
    if (isNoSuchTable(e)) return { kind: 'not_migrated' };
    // 그 밖의 오류는 섹션별로 드러나게 둔다(아래에서 다시 읽힌다)
  }
  const cfg = await readAutoRefreshConfig(db);
  const partsSec = await section('parts', () => readUniverseParts(db, nowMs));
  const parts = partsSec.state === 'ok' ? partsSec.data : null;
  const [proposalsSec, watchSec] = await Promise.all([
    section('proposals', () => readProposals(parts, nowMs, db)),
    section('watch', () => readWatch(db)),
  ]);
  const proposalSymbols = new Set(
    proposalsSec.state === 'ok' ? proposalsSec.data.filter((p) => p.state === 'open').map((p) => p.symbol) : [],
  );
  const summary: UniverseSection<UniverseSummary> = parts
    ? { state: 'ok', data: buildSummary(parts, cfg, nowMs) }
    : { state: 'error', error: partsSec.state === 'error' ? partsSec.error : 'db_error' };
  const list: UniverseSection<UniverseRow[]> = parts
    ? await section('list', () => buildRows(parts, proposalSymbols, db))
    : { state: 'error', error: partsSec.state === 'error' ? partsSec.error : 'db_error' };
  return { kind: 'ok', dto: { generatedAt: kstIso(nowMs), summary, watch: watchSec, proposals: proposalsSec, list } };
}

// ── 수동 목록 일괄 교체 (PUT) ───────────────────────────────────────────────

export type ReplaceOutcome =
  | { kind: 'ok'; data: ManualReplaceResult }
  | { kind: 'conflict'; version: number; summary: UniverseSummary | null }
  | { kind: 'not_migrated' }
  /**
   * 🔴 m-2 — **저장은 끝났고** 그 뒤 요약 조회만 실패했다. 이것을 `error` 로 묶으면 화면이
   * 「목록은 바뀌지 않았습니다」라고 **거짓을 말한다**(실제로는 바뀌었다). 호출자는 성공으로 응답하고
   * 「저장은 됐고 화면을 불러오지 못했다」 쪽 문구를 쓴다.
   */
  | { kind: 'saved_unreadable'; version: number; applied: { added: number; removed: number; kept: number } }
  | { kind: 'error'; error: string };

const REVISION_INSERT_SQL =
  `INSERT INTO overseas_universe_revision
     (revision_no, symbols, symbol_count, added_symbols, removed_symbols, kept_count, change_source, proposal_id, updated_by, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

interface RevisionInsert {
  revisionNo: number; symbols: string[]; added: string[]; removed: string[]; kept: number;
  source: 'bulk' | 'proposal' | 'seed'; proposalId: number | null; actor: string; nowMs: number;
}

function revisionParams(x: RevisionInsert): unknown[] {
  return [
    x.revisionNo, JSON.stringify(x.symbols), x.symbols.length,
    JSON.stringify(x.added), JSON.stringify(x.removed), x.kept,
    x.source, x.proposalId, x.actor, kstSql(x.nowMs),
  ];
}

/**
 * 수동 목록을 통째로 바꾼다 — **전부 아니면 전무**(가이드 §4.3).
 * 한 문장(INSERT) 이라 부분 반영이 구조적으로 불가능하다. `revision_no` 를 명시하므로 다른 기기가 먼저 저장했으면
 * 중복키(1062)로 실패하고 **DB 는 그대로**다 → 409. 같은 요청을 두 번 보내도 두 번째는 409 다.
 */
export async function replaceManualList(args: {
  symbols: string[]; baseVersion: number; actor: string; nowMs?: number; db?: Queryable;
}): Promise<ReplaceOutcome> {
  const { symbols, baseVersion, actor } = args;
  const nowMs = args.nowMs ?? Date.now();
  const db = args.db ?? pool();
  try {
    const cfg = await readAutoRefreshConfig(db);
    const current = await readManualRevision(db);
    const currentNo = current?.revisionNo ?? 0;
    if (currentNo !== baseVersion) {
      const parts = await readUniverseParts(db, nowMs).catch(() => null);
      return { kind: 'conflict', version: currentNo, summary: parts ? buildSummary(parts, cfg, nowMs) : null };
    }
    /**
     * 🔴 C-2 — 개정판이 없으면 기준선은 **빈 목록이 아니라 폴백 목록**이다.
     *
     * 왜: 전환 전 화면은 기본 목록(폴백)을 「현재」로 놓고 대조하므로 확인 시트가 「뺄 것 M종목 … 저장하면 분석에서
     * 빠집니다」라고 말한다. 여기서 `[]` 를 기준선으로 쓰면 결과 문구가 「빼기 0」이 되어 **시트와 모순**되고,
     * 개정판 1 의 `removed_symbols`·`kept_count` 가 비어 남아 **전환점에서 무엇이 분석에서 빠졌는지의 유일한 이력이
     * 사라진다.** 제안 처리 경로(`actOnProposal`)는 이미 `parts.manual`(= 폴백)을 기준으로 하므로
     * 두 쓰기 경로의 기준선도 이렇게 해서 같아진다.
     */
    const prev = current ? current.symbols : fallbackOverseasUniverse();
    // ⑤ — 개정판이 **손상**이면 `current.symbols` 는 빈 배열이다. 그래도 **막지 않는다**: 이 경로가 복구 경로이고,
    //   읽지 못한 옛 목록을 「빼기」로 적을 수는 없으므로 빈 기준선이 그 상황에서 가장 정직한 값이다.
    //   (제안 처리는 같은 상태에서 중단한다 — 그쪽은 사용자가 전체 목록을 주지 않는다.)
    const nextSet = new Set(symbols);
    const prevSet = new Set(prev);
    const added = symbols.filter((s) => !prevSet.has(s));
    const removed = prev.filter((s) => !nextSet.has(s));
    const kept = prev.length - removed.length;
    const revisionNo = currentNo + 1;
    try {
      await db.query(REVISION_INSERT_SQL, revisionParams({
        revisionNo, symbols, added, removed, kept, source: 'bulk', proposalId: null, actor, nowMs,
      }));
    } catch (e) {
      if (isDupEntry(e)) {
        const latest = await readManualRevision(db).catch(() => null);
        const parts = await readUniverseParts(db, nowMs).catch(() => null);
        return { kind: 'conflict', version: latest?.revisionNo ?? revisionNo, summary: parts ? buildSummary(parts, cfg, nowMs) : null };
      }
      throw e;
    }
    // ⚠ 여기서부터는 **이미 저장됐다**. 아래 조회가 실패해도 「바뀌지 않았다」고 말하지 않는다(m-2)
    const applied = { added: added.length, removed: removed.length, kept };
    try {
      const parts = await readUniverseParts(db, nowMs);
      return { kind: 'ok', data: { summary: buildSummary(parts, cfg, nowMs), applied, version: revisionNo } };
    } catch (e) {
      console.error('[universe/store] 교체는 됐으나 요약 조회 실패:', errText(e).slice(0, 200));
      return { kind: 'saved_unreadable', version: revisionNo, applied };
    }
  } catch (e) {
    if (isNoSuchTable(e)) return { kind: 'not_migrated' };
    console.error('[universe/store] 수동 목록 교체 실패:', errText(e).slice(0, 200));
    return { kind: 'error', error: errText(e) };
  }
}

// ── 제안 1건 처리 (POST) ────────────────────────────────────────────────────

export type ProposalOutcome =
  | { kind: 'ok'; proposal: Proposal; summary: UniverseSummary }
  /** 🔴 m-2 — 상태 전이·목록 변경은 커밋됐고 그 뒤 다시 읽기만 실패했다. 「처리되지 않았다」고 말하지 않는다 */
  | { kind: 'saved_unreadable' }
  | { kind: 'conflict'; proposal: Proposal | null }
  | { kind: 'not_found' }
  | { kind: 'bad_request'; error: string }
  | { kind: 'not_migrated' }
  | { kind: 'error'; error: string };

const PROPOSAL_ONE_SQL = `SELECT ${PROPOSAL_COLS} FROM overseas_universe_proposal WHERE proposal_id = ? LIMIT 1`;

/**
 * 제안 1건 처리(가이드 §4.2). `baseState` 가 현재 상태와 다르면 **409 이고 아무것도 바꾸지 않는다**
 * (다른 기기·텔레그램에서 먼저 처리한 경우 — `risk-policy` 의 `baseVersion` → 409 와 같은 방식).
 *
 * `act` 만 수동 목록을 바꾼다. 목록 INSERT 와 제안 상태 UPDATE 를 **한 트랜잭션**에 둔다 —
 * 목록은 바뀌었는데 제안이 `open` 으로 남으면 같은 변경이 두 번 적용될 수 있다.
 */
export async function actOnProposal(args: {
  id: string; action: ProposalDo; baseState: ProposalState; actor: string; nowMs?: number;
  /** 시험 주입(m-1) — 없으면 공용 풀 */
  db?: Queryable;
  /** 시험 주입(m-1) — 없으면 공용 풀의 연결 */
  getConnection?: () => Promise<TxConnection>;
}): Promise<ProposalOutcome> {
  const { id, action, baseState, actor } = args;
  const nowMs = args.nowMs ?? Date.now();
  const pid = intOf(id);
  if (pid == null || pid <= 0) return { kind: 'bad_request', error: '제안 id 가 올바르지 않습니다' };
  const db = args.db ?? pool();
  try {
    const cfg = await readAutoRefreshConfig(db);
    const [out] = await db.query<ProposalRow[]>(PROPOSAL_ONE_SQL, [pid]);
    const row = rowsOf<ProposalRow>(out)[0];
    if (!row) return { kind: 'not_found' };
    const parts = await readUniverseParts(db, nowMs);
    const current = withHeld(toProposal(row, nowMs, effectBaseOf(parts)), parts);
    if (current.state !== baseState) return { kind: 'conflict', proposal: current };
    if (action === 'reopen' && current.state !== 'held' && current.state !== 'ignored') {
      return { kind: 'bad_request', error: '되돌리기는 보류·무시만 할 수 있습니다' };
    }
    if (action !== 'reopen' && current.state !== 'open') {
      return { kind: 'conflict', proposal: current };
    }

    if (action === 'hold' || action === 'ignore' || action === 'reopen') {
      const nextState: ProposalState = action === 'hold' ? 'held' : action === 'ignore' ? 'ignored' : 'open';
      const heldUntil = action === 'hold' ? kstSql(Date.parse(nextAutoRefreshAt(nowMs, cfg))) : null;
      const [res] = await db.query(
        `UPDATE overseas_universe_proposal
           SET state = ?, held_until = ?, decided_at = ?, decided_by = ?
         WHERE proposal_id = ? AND state = ?`,
        [nextState, heldUntil, action === 'reopen' ? null : kstSql(nowMs), action === 'reopen' ? null : actor, pid, row.state],
      );
      const affected = (res as { affectedRows?: number } | null)?.affectedRows;
      if (affected === 0) {
        const again = await db.query<ProposalRow[]>(PROPOSAL_ONE_SQL, [pid]);
        const r2 = rowsOf<ProposalRow>(again[0])[0];
        return { kind: 'conflict', proposal: r2 ? withHeld(toProposal(r2, nowMs, effectBaseOf(parts)), parts) : null };
      }
      // UPDATE 가 끝났다 — 아래 재조회가 실패해도 「처리되지 않았다」고 말하지 않는다(m-2)
      try {
        const after = await db.query<ProposalRow[]>(PROPOSAL_ONE_SQL, [pid]);
        const r3 = rowsOf<ProposalRow>(after[0])[0];
        const parts2 = await readUniverseParts(db, nowMs);
        return {
          kind: 'ok',
          proposal: r3 ? withHeld(toProposal(r3, nowMs, effectBaseOf(parts2)), parts2) : current,
          summary: buildSummary(parts2, cfg, nowMs),
        };
      } catch (e) {
        console.error('[universe/store] 상태 전이는 됐으나 재조회 실패:', errText(e).slice(0, 200));
        return { kind: 'saved_unreadable' };
      }
    }

    // act — 수동 목록을 바꾼다
    // 🔴 ⑤ — 저장된 개정판을 **제대로 읽지 못했으면 트랜잭션을 열기 전에 중단**한다. 그 상태의 `parts.manual` 은
    //   빈 배열이라, 그대로 적용하면 「거의 빈 개정판」을 정상처럼 확정해 분석이 조용히 비어 버린다.
    //   일괄 교체(`replaceManualList`)는 **막지 않는다** — 사용자가 전체 목록을 붙여 넣는 것이 복구 경로다.
    if (!parts.manualValid) {
      console.error(`[universe/store] 저장된 개정판을 읽을 수 없어 제안 적용을 중단했다 proposal=${pid} revision=${parts.manualVersion}`);
      return {
        kind: 'bad_request',
        error: '저장된 목록을 읽을 수 없어 이 제안을 적용할 수 없습니다 — 「목록 한 번에 바꾸기」로 전체 목록을 다시 저장한 뒤 시도하세요',
      };
    }
    const nextManual = applyProposalToManual(parts.manual, {
      type: current.action.type, symbol: current.symbol, nextSymbol: current.action.nextSymbol,
    });
    // 🔴 m-5 — **서버가 클라이언트를 믿지 않는다.** 제안 행의 `symbol`·`next_symbol` 은 WP-A 의 잡이 넣는 값이고
    //   일괄 교체와 달리 사람이 확인하지 않는다. 적용 결과를 **일괄 교체와 같은 순수 함수**로 다시 검사해,
    //   형식이 깨진 코드나 상한 초과가 개정판에 들어가지 못하게 한다(들어가면 KIS 조회가 매일 실패한다).
    const recheck = checkManualSymbols(nextManual);
    if (!recheck.ok) {
      const detail = recheck.reason === 'too_many'
        ? `수동 목록은 ${MANUAL_LIST_MAX}종목을 넘을 수 없습니다`
        : `형식이 잘못된 종목이 있습니다 (${recheck.invalid.slice(0, 3).join(', ')})`;
      console.error(`[universe/store] 제안 적용 거부(${recheck.reason}) proposal=${pid}`);
      return { kind: 'bad_request', error: detail };
    }
    const prevSet = new Set(parts.manual);
    const nextSet = new Set(nextManual);
    const added = nextManual.filter((s) => !prevSet.has(s));
    const removed = parts.manual.filter((s) => !nextSet.has(s));
    const revisionNo = parts.manualVersion + 1;

    let conn: TxConnection;
    try {
      conn = args.getConnection
        ? await args.getConnection()
        : ((await getPool().getConnection()) as unknown as TxConnection);
    } catch (e) {
      return { kind: 'error', error: `connection:${errText(e)}` };
    }
    let discard = false;
    try {
      await conn.beginTransaction();
      try {
        await conn.query(REVISION_INSERT_SQL, revisionParams({
          revisionNo, symbols: recheck.symbols, added, removed, kept: parts.manual.length - removed.length,
          source: 'proposal', proposalId: pid, actor, nowMs,
        }));
        const [res] = await conn.query(
          `UPDATE overseas_universe_proposal
             SET state = 'done', held_until = NULL, decided_at = ?, decided_by = ?
           WHERE proposal_id = ? AND state = ?`,
          [kstSql(nowMs), actor, pid, row.state],
        );
        if ((res as { affectedRows?: number } | null)?.affectedRows === 0) {
          // 그 사이에 다른 기기가 처리했다 — 목록도 되돌린다(부분 반영을 만들지 않는다)
          await conn.rollback().catch(() => { discard = true; });
          const again = await db.query<ProposalRow[]>(PROPOSAL_ONE_SQL, [pid]);
          const r2 = rowsOf<ProposalRow>(again[0])[0];
          return { kind: 'conflict', proposal: r2 ? withHeld(toProposal(r2, nowMs, effectBaseOf(parts)), parts) : null };
        }
        await conn.commit();
      } catch (e) {
        await conn.rollback().catch(() => { discard = true; });
        if (isDupEntry(e)) {
          const latest = await readManualRevision(db).catch(() => null);
          void latest;
          const again = await db.query<ProposalRow[]>(PROPOSAL_ONE_SQL, [pid]);
          const r2 = rowsOf<ProposalRow>(again[0])[0];
          return { kind: 'conflict', proposal: r2 ? withHeld(toProposal(r2, nowMs, effectBaseOf(parts)), parts) : null };
        }
        throw e;
      }
    } catch (e) {
      discard = true;
      if (isNoSuchTable(e)) return { kind: 'not_migrated' };
      console.error('[universe/store] 제안 처리 실패:', errText(e).slice(0, 200));
      return { kind: 'error', error: errText(e) };
    } finally {
      if (discard) conn.destroy();
      else conn.release();
    }

    // ⚠ 커밋이 끝났다 — 아래 조회가 실패해도 「처리되지 않았다」고 말하지 않는다(m-2)
    try {
      const parts2 = await readUniverseParts(db, nowMs);
      const after = await db.query<ProposalRow[]>(PROPOSAL_ONE_SQL, [pid]);
      const r4 = rowsOf<ProposalRow>(after[0])[0];
      return {
        kind: 'ok',
        proposal: r4 ? withHeld(toProposal(r4, nowMs, effectBaseOf(parts2)), parts2) : current,
        summary: buildSummary(parts2, cfg, nowMs),
      };
    } catch (e) {
      console.error('[universe/store] 제안 적용은 됐으나 재조회 실패:', errText(e).slice(0, 200));
      return { kind: 'saved_unreadable' };
    }
  } catch (e) {
    if (isNoSuchTable(e)) return { kind: 'not_migrated' };
    console.error('[universe/store] 제안 처리 실패:', errText(e).slice(0, 200));
    return { kind: 'error', error: errText(e) };
  }
}
