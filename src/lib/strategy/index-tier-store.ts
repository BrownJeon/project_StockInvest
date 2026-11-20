/**
 * T-184 — 국내 종목의 **지수 편입 등급 보존소**(코어 비율 가드 전용).
 *
 * 왜 따로 두나: T-181 부터 국내 등급은 universe 갱신 때 받은 시세의 지수 편입 표시(`tierFromIndexTag`)로 매기는데,
 * 그 값은 전략 점수 선별(30·40·30)을 통과한 종목에만 `symbol_universe` 로 저장된다. 가드(`portfolio-stability.ts`)가
 * `symbol_universe` 를 읽으면 보유 종목이 선별에서 빠졌을 때
 *   ① 강등돼도 과거 core 행이 최대 48시간 남아 가드가 낡은 core 로 통과하고(Codex 지적, T-181 Reviewer 23:12)
 *   ② 48시간 뒤에는 행이 지워져 unknown 이 되어 국내 매수가 전면 차단된다(T-181 Analyst §6).
 * 그래서 갱신 때 **시세를 받은 전 종목**의 등급을 선별과 무관하게 이 보존소에 남기고, 가드는 여기서
 * **관측 시각이 최신성 한도(24시간) 안인 값만** 쓴다. 한도를 넘었거나 없으면 unknown(=비core, 차단 방향).
 *
 * 저장 위치: `system_config` 의 한 행(키 `domestic_index_tier`, JSON 값) — DDL 이 필요 없다. 행 하나에 종목별
 * `{ tier, at }`(at = 관측 시각 ISO 문자열)를 담는다. `symbol_universe` 에 섞지 않는 이유: 그 테이블은
 * `getUniverseSymbols`·`ai-filter`·`rs-rating` 이 profile·rank_pos 로 읽어 전략과 무관한 행이 섞이면 후보가 오염된다.
 *
 * 병합 규칙: 이번에 시세를 못 받은 종목은 이전 관측(그 시각 그대로)을 남긴다 — 종목 하나의 일시 실패로 바로 unknown 이
 * 되지 않게 하되, 최신성 한도가 지나면 가드가 쓰지 않는다. 마지막 관측이 보관 기한(48시간)을 넘은 종목은 쓸 때 지운다.
 * 이 모듈은 거래소를 부르지 않고 주문·안전장치 경로와 무관하다.
 *
 * 동시성(T-184 Codex C2 지적 반영):
 *  - 관측 시각은 **시세를 받기 전 시각**(호출부가 넘긴다)이고, 병합은 종목마다 **관측 시각이 더 늦은 쪽**만 남긴다.
 *    겹친 갱신 A(먼저 시세 → core)·B(나중 시세 → 강등)가 B, A 순으로 저장해도 A 의 더 이른 관측이 B 를 덮지 못한다.
 *  - 쓰기는 문서의 `rev` 를 비교하는 조건부 갱신(CAS)이다. 읽은 뒤 다른 쪽이 먼저 썼으면 다시 읽어 병합한다(최대 3회,
 *    그래도 실패하면 던진다 — 호출부가 경고). 다른 갱신의 관측을 통째로 덮어 지우는 일이 없다.
 *  - 같은 프로세스 안에서는 마지막 관측을 메모리에도 둔다(pm2 instances 1 — 갱신과 가드가 같은 프로세스다). 가드는
 *    DB 값과 이 메모리 값을 종목마다 관측 시각이 늦은 쪽으로 합쳐 쓴다. 그래서 DB 쓰기가 실패해도 방금 확인한 강등이
 *    곧바로 가드에 반영된다(저장 실패로 낡은 core 가 남는 경로 차단). 프로세스 재시작 뒤에는 DB 값만 남는다.
 */
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';

export type IndexTier = 'core' | 'satellite' | 'speculative';
export type HeldTier = IndexTier | 'unknown';

/** `system_config.key` (VARCHAR(64)) */
export const INDEX_TIER_CONFIG_KEY = 'domestic_index_tier';
/** 가드가 등급을 믿는 최신성 한도. 장중에는 갱신이 15~20분마다 돌아 이 안에 든다. 넘으면 unknown. */
export const INDEX_TIER_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** 보존소에 남기는 기한(마지막 관측 기준). 최신성 한도보다 길어야 한도 판정이 의미가 있다. */
export const INDEX_TIER_RETAIN_MS = 48 * 60 * 60 * 1000;
/** 관측 시각이 지금보다 이만큼 넘게 미래면(시계 오류·손상) 믿지 않는다. */
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_SYMBOL_LEN = 32;
/** CAS 충돌 시 다시 읽어 병합하는 최대 시도 횟수 */
const SAVE_MAX_ATTEMPTS = 3;

export interface TierObservation {
  tier: IndexTier;
  atMs: number;
}

export type IndexTierSnapshot = Map<string, TierObservation>;

function isIndexTier(v: unknown): v is IndexTier {
  return v === 'core' || v === 'satellite' || v === 'speculative';
}

/**
 * 저장된 값 → 스냅샷. MariaDB 의 JSON 열은 문자열로 올 수 있어 둘 다 받는다.
 * 형식이 틀린 값·항목은 버린다(버린 종목은 가드에서 unknown — 차단 방향). 예외를 던지지 않는다.
 */
export function parseIndexTierSnapshot(raw: unknown): IndexTierSnapshot {
  const out: IndexTierSnapshot = new Map();
  let doc: unknown = raw;
  if (typeof doc === 'string') {
    try { doc = JSON.parse(doc); } catch { return out; }
  }
  if (doc === null || typeof doc !== 'object') return out;
  const symbols = (doc as { symbols?: unknown }).symbols;
  if (symbols === null || typeof symbols !== 'object' || Array.isArray(symbols)) return out;
  for (const [symbol, entry] of Object.entries(symbols as Record<string, unknown>)) {
    if (symbol.length === 0 || symbol.length > MAX_SYMBOL_LEN) continue;
    if (entry === null || typeof entry !== 'object') continue;
    const { tier, at } = entry as { tier?: unknown; at?: unknown };
    if (!isIndexTier(tier) || typeof at !== 'string') continue;
    const atMs = Date.parse(at);
    if (!Number.isFinite(atMs)) continue;
    out.set(symbol, { tier, atMs });
  }
  return out;
}

/** 저장 문서의 `rev`(CAS 비교값). 없거나 0 이상 안전 정수가 아니면 0. */
export function parseIndexTierRev(raw: unknown): number {
  let doc: unknown = raw;
  if (typeof doc === 'string') {
    try { doc = JSON.parse(doc); } catch { return 0; }
  }
  if (doc === null || typeof doc !== 'object') return 0;
  const rev = (doc as { rev?: unknown }).rev;
  return typeof rev === 'number' && Number.isSafeInteger(rev) && rev >= 0 ? rev : 0;
}

/**
 * 이전 스냅샷 위에 이번 관측(관측 시각 `observedAtMs`)을 병합하고, 보관 기한이 지난 종목을 지운다. 입력은 바꾸지 않는다.
 * 종목마다 **관측 시각이 늦은 쪽**이 이긴다(같으면 이번 관측). 그래서 더 이른 관측이 뒤늦게 저장돼도 최신 등급을 덮지 못한다.
 */
export function mergeIndexTierObservations(
  prev: IndexTierSnapshot,
  observed: ReadonlyArray<{ symbol: string; tier: IndexTier }>,
  observedAtMs: number,
): IndexTierSnapshot {
  const next: IndexTierSnapshot = new Map();
  for (const [symbol, obs] of prev) {
    if (observedAtMs - obs.atMs <= INDEX_TIER_RETAIN_MS) next.set(symbol, obs);
  }
  for (const { symbol, tier } of observed) {
    if (typeof symbol !== 'string' || symbol.length === 0 || symbol.length > MAX_SYMBOL_LEN) continue;
    if (!isIndexTier(tier)) continue;
    const cur = next.get(symbol);
    if (cur && cur.atMs > observedAtMs) continue;
    next.set(symbol, { tier, atMs: observedAtMs });
  }
  return next;
}

/** 두 스냅샷을 종목마다 관측 시각이 늦은 쪽으로 합친다(같으면 `b`). */
export function combineIndexTierSnapshots(a: IndexTierSnapshot, b: IndexTierSnapshot): IndexTierSnapshot {
  const out: IndexTierSnapshot = new Map(a);
  for (const [symbol, obs] of b) {
    const cur = out.get(symbol);
    if (!cur || cur.atMs <= obs.atMs) out.set(symbol, obs);
  }
  return out;
}

export function serializeIndexTierSnapshot(snapshot: IndexTierSnapshot, rev = 0): string {
  const symbols: Record<string, { tier: IndexTier; at: string }> = {};
  for (const [symbol, obs] of [...snapshot].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    symbols[symbol] = { tier: obs.tier, at: new Date(obs.atMs).toISOString() };
  }
  return JSON.stringify({ v: 1, rev, symbols });
}

/** 이 프로세스가 마지막으로 관측한 등급(DB 쓰기 실패·경합과 무관하게 가드가 함께 본다). */
let processSnapshot: IndexTierSnapshot = new Map();

/** 시험 전용 — 프로세스 메모리 관측을 비운다. */
export function resetIndexTierProcessStateForTest(): void {
  processSnapshot = new Map();
}

async function readStored(): Promise<{ exists: boolean; rev: number; snapshot: IndexTierSnapshot }> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT value FROM system_config WHERE `key` = ? LIMIT 1',
    [INDEX_TIER_CONFIG_KEY],
  );
  if (rows.length === 0) return { exists: false, rev: 0, snapshot: new Map() };
  const raw = rows[0].value;
  return { exists: true, rev: parseIndexTierRev(raw), snapshot: parseIndexTierSnapshot(raw) };
}

/**
 * 가드가 쓰는 스냅샷 = DB 보존소 ⊕ 이 프로세스의 마지막 관측(종목마다 늦은 관측 우선). 행이 없으면 메모리 값만.
 * DB 오류는 그대로 던진다(종전 `lookupTier` 와 같은 동작 — 호출부에서 그 종목 평가가 실패해 매수가 만들어지지 않는다).
 */
export async function loadIndexTierSnapshot(): Promise<IndexTierSnapshot> {
  const { snapshot } = await readStored();
  return combineIndexTierSnapshots(snapshot, processSnapshot);
}

function affectedRows(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  const n = (header as { affectedRows?: unknown } | null)?.affectedRows;
  return typeof n === 'number' ? n : 0;
}

/**
 * 이번 갱신에서 시세를 받은 종목들의 등급을 보존소에 병합 저장한다(universe 갱신 전용).
 * `observedAtMs` 는 **시세를 받기 전 시각**을 넘긴다(겹친 갱신에서 더 이른 관측이 이기지 않게).
 * 메모리 관측을 먼저 갱신하고(DB 실패와 무관하게 이 프로세스의 가드에 반영), DB 는 `rev` 조건부 갱신으로 쓴다.
 * 충돌이 계속되거나 DB 가 실패하면 던진다 — 호출부가 잡아 경고만 남기고 갱신을 계속한다.
 */
export async function saveIndexTierObservations(
  observed: ReadonlyArray<{ symbol: string; tier: IndexTier }>,
  observedAtMs: number = Date.now(),
): Promise<void> {
  if (observed.length === 0) return;
  processSnapshot = mergeIndexTierObservations(processSnapshot, observed, observedAtMs);

  const pool = getPool();
  for (let attempt = 1; attempt <= SAVE_MAX_ATTEMPTS; attempt++) {
    const cur = await readStored();
    const next = mergeIndexTierObservations(cur.snapshot, observed, observedAtMs);
    const body = serializeIndexTierSnapshot(next, cur.rev + 1);
    const result = cur.exists
      ? await pool.query(
        "UPDATE system_config SET value = ? WHERE `key` = ? AND COALESCE(JSON_VALUE(value, '$.rev'), '0') = ?",
        [body, INDEX_TIER_CONFIG_KEY, String(cur.rev)],
      )
      : await pool.query(
        'INSERT IGNORE INTO system_config (`key`, value) VALUES (?, ?)',
        [INDEX_TIER_CONFIG_KEY, body],
      );
    if (affectedRows(result) === 1) return;
  }
  throw new Error(`index tier save conflict after ${SAVE_MAX_ATTEMPTS} attempts`);
}

/**
 * 가드가 쓰는 등급. 없음·최신성 한도 초과·미래 시각이면 'unknown'(코어로 세지 않는다 — 차단 방향).
 * 경계: 경과 시간이 정확히 한도와 같으면 아직 유효하다(`>` 로 비교).
 */
export function resolveHeldTier(
  snapshot: IndexTierSnapshot,
  symbol: string,
  nowMs: number,
  maxAgeMs: number = INDEX_TIER_MAX_AGE_MS,
): HeldTier {
  const obs = snapshot.get(symbol);
  if (!obs) return 'unknown';
  if (obs.atMs - nowMs > FUTURE_SKEW_MS) return 'unknown';
  if (nowMs - obs.atMs > maxAgeMs) return 'unknown';
  return obs.tier;
}
