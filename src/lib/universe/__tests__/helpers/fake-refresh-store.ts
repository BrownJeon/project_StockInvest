/**
 * T-143 WP-A — `refresh-store` 의 **메모리 모형**(시험 전용). SQL 없이 엔진의 단계·예산 판단만 본다.
 *
 * 실제 저장소와 같은 계약만 지킨다: `pending` 을 `ord` 순으로 주고, 상태를 종목마다 바꾸고,
 * 커서는 뒤로 가지 않고, `finalize` 는 상위가 비면 거부한다.
 */
import type {
  AutoRow, CandidateInsert, CandidateVerdict, FinalizeRow, PendingCandidate, RunPhase, RunRow,
  ScanOutcome, ScanProgress, StoreOutcome,
} from '../../refresh-store';

interface Cand {
  ord: number;
  symbol: string;
  kisSymb: string | null;
  /**
   * 🔴 (Reviewer r4) 실제 저장소는 이 값을 `kis_enam` 열에 넣는다. 모형에 이 필드가 **없어서**
   * 「listing 이 `kisEnam` 을 버린다」는 변이가 엔진 시험에서 살아남았다 — 모형이 실제와 모양이
   * 다르면 그 차이만큼 시험이 아무것도 지키지 않는다. 실제 저장소 쪽 고정은 B1·B2
   * (`refresh-store-disposable-mariadb.test.ts`)에 있다.
   */
  kisEnam: string | null;
  kisStis: string | null;
  kisIsdr: string | null;
  kisEtyp: string | null;
  status: 'pending' | 'ok' | 'kis_missing' | 'kis_error' | 'excluded';
  exclusion: string | null;
  attempts: number;
}

interface State {
  run: RunRow | null;
  cands: Cand[];
  auto: AutoRow[];
  autoComputedAt: string[];
  verdicts: CandidateVerdict[];
  finalizeRows: FinalizeRow[] | null;
  prevTop: string[];
  listingMeta: unknown;
  countsJson: string | null;
  notMigrated: boolean;
  pendingError: Error | null;
  /** `readPendingCandidates` 가 **분류된 오류**를 돌려주게 한다(T-145 ⑥-4 — 일시/영구 분기). */
  pendingFail: { error: string; retryable: boolean } | null;
  /**
   * 🔴 (Reviewer M-2) `saveListing`·`finalizeRun` 도 분류된 오류를 돌려주게 한다. 전에는 `scan_read` 한 곳만
   * 주입할 수 있어서 엔진의 `listing_save`·`finalize_write` 가 **항상 영구로 닫아도** 시험 52개가 전부 통과했다.
   * ⑥ 이 실제로 고친 결함은 finalize 쪽이라, 그 배선이 회귀하면 고친 결함이 조용히 돌아온다.
   */
  listingFail: { error: string; retryable: boolean } | null;
  finalizeFail: { error: string; retryable: boolean } | null;
  /**
   * 🔴 (Codex C2 지적 2) `closeRun` 이 **던지게** 한다. 실제 `closeRun` 은 try 없이 `await db.query` 라
   * DB 오류를 그대로 던진다 — 전에는 엔진이 그 예외를 삼키고 「종결됐다」고 응답했고, 그 경로를
   * 어떤 시험도 보지 못했다(모형이 던질 수 없었다).
   */
  closeFail: { code: string } | null;
  proposalsInserted: number;
  /** 최근 스냅샷 집합(T-145 ⑧-1). `null` = 조회 실패(모름). */
  recentSnapshot: Set<string> | null;
  /** 이 run 의 스캔 결과(T-145 ⑧-2) — 심볼 → KIS 가 답했나. */
  runKisStatus: Map<string, boolean>;
}

const s: State = blank();

function blank(): State {
  return {
    run: null, cands: [], auto: [], autoComputedAt: [], verdicts: [], finalizeRows: null,
    prevTop: [], listingMeta: null, countsJson: null, notMigrated: false, pendingError: null,
    pendingFail: null, listingFail: null, finalizeFail: null, closeFail: null,
    proposalsInserted: 0, recentSnapshot: new Set(), runKisStatus: new Map(),
  };
}

export function __reset(): void {
  Object.assign(s, blank());
}
export function __run(): (RunRow & { countsJson: string | null }) | null {
  return s.run ? { ...s.run, countsJson: s.countsJson } : null;
}
export function __candidates(): Cand[] { return s.cands; }
export function __auto(): AutoRow[] { return s.auto; }
export function __autoComputedAtCount(): number { return new Set(s.autoComputedAt).size; }
export function __verdicts(): CandidateVerdict[] { return s.verdicts; }
export function __listingMeta(): unknown { return s.listingMeta; }
export function __setAuto(rows: AutoRow[]): void { s.auto = rows; }
export function __setPrevTop(xs: string[]): void { s.prevTop = xs; }
export function __setNotMigrated(v: boolean): void { s.notMigrated = v; }
export function __throwOnPending(e: Error): void { s.pendingError = e; }
/** T-145 ⑥-4 — 저장소가 「일시/영구」를 가려 돌려주는 경로를 흉내 낸다. `null` 이면 해제(회복). */
export function __failPending(fail: { error: string; retryable: boolean } | null): void { s.pendingFail = fail; }
/** (Reviewer M-2) `saveListing` 이 분류된 오류를 돌려주게 한다. `null` 이면 해제. */
export function __failListing(fail: { error: string; retryable: boolean } | null): void { s.listingFail = fail; }
/** (Reviewer M-2) `finalizeRun` 이 분류된 오류를 돌려주게 한다. `null` 이면 해제. */
export function __failFinalize(fail: { error: string; retryable: boolean } | null): void { s.finalizeFail = fail; }
/** (Codex C2 지적 2) `closeRun` 이 던지게 한다(= 종결 기록 실패). `null` 이면 해제(회복). */
export function __failClose(fail: { code: string } | null): void { s.closeFail = fail; }
/** T-145 ⑧-1 — 최근 스냅샷 집합(`null` = 조회 실패). */
export function __setRecentSnapshot(v: Set<string> | null): void { s.recentSnapshot = v; }
/** T-145 ⑧-2 — 이 run 의 스캔 결과(심볼 → KIS 가 답했나). */
export function __setRunKisStatus(m: Map<string, boolean>): void { s.runKisStatus = m; }
export function __setRun(r: RunRow): void { s.run = r; }
export function __setPhase(p: RunPhase): void { if (s.run) s.run.phase = p; }
export function __setFinalizeRows(rows: FinalizeRow[]): void { s.finalizeRows = rows; }
export function __proposalsInserted(): number { return s.proposalsInserted; }

export function __clearPending(): void {
  for (const c of s.cands) if (c.status === 'pending') c.status = 'ok';
}
export function __setStatus(symbol: string, status: Cand['status'], attempts = 0): void {
  const c = s.cands.find((x) => x.symbol === symbol);
  if (c) { c.status = status; c.attempts = attempts; }
}
/** 후보 n 개를 pending 으로 깐다(예산·스로틀 시험용). */
export function __seedPending(n: number, opts: { kisSymb?: string | null } = {}): void {
  const base = s.cands.length;
  for (let i = 0; i < n; i += 1) {
    const ord = base + i;
    s.cands.push({
      ord, symbol: `NYS:S${ord}`,
      kisSymb: opts.kisSymb === undefined ? `S${ord}` : opts.kisSymb,
      kisStis: '2', kisIsdr: 'N', kisEtyp: null, status: 'pending', exclusion: null, attempts: 0,
    });
  }
}
export function __progress(): ScanProgress {
  return progressOf();
}

function progressOf(): ScanProgress {
  const p: ScanProgress = { pending: 0, ok: 0, excluded: 0, kisMissing: 0, kisError: 0, total: s.cands.length };
  for (const c of s.cands) {
    if (c.status === 'pending') p.pending += 1;
    else if (c.status === 'ok') p.ok += 1;
    else if (c.status === 'excluded') p.excluded += 1;
    else if (c.status === 'kis_missing') p.kisMissing += 1;
    else p.kisError += 1;
  }
  return p;
}

const ok = <T>(data: T): StoreOutcome<T> => ({ kind: 'ok', data });

// ── 저장소 계약 ─────────────────────────────────────────────────────────────

export async function readRun(runKey: string): Promise<StoreOutcome<RunRow | null>> {
  if (s.notMigrated) return { kind: 'not_migrated' };
  return ok(s.run && s.run.runKey === runKey ? s.run : null);
}

export async function createRun(args: { runKey: string; topN: number }): Promise<StoreOutcome<RunRow>> {
  if (s.notMigrated) return { kind: 'not_migrated' };
  s.run = {
    runId: 1, runKey: args.runKey, phase: 'listing', topN: args.topN, cursorPos: 0,
    secSha256: null, lastError: null, notifiedAt: null,
  };
  return ok(s.run);
}

export async function saveListing(args: {
  runId: number; candidates: readonly CandidateInsert[];
  sec: { fetchedAtMs: number; sha256: string; rows: number };
  master: { fetchedAtMs: number; sha256: string; rows: number };
  countsJson: string;
}): Promise<StoreOutcome<{ inserted: number }>> {
  if (s.listingFail) return { kind: 'error', error: s.listingFail.error, retryable: s.listingFail.retryable };
  if (s.notMigrated) return { kind: 'not_migrated' };
  s.cands = args.candidates.map((c) => ({
    ord: c.ord, symbol: c.symbol, kisSymb: c.kisSymb, kisEnam: c.kisEnam, kisStis: c.kisStis, kisIsdr: c.kisIsdr,
    kisEtyp: c.kisEtyp, status: c.status, exclusion: c.exclusion, attempts: 0,
  }));
  s.listingMeta = { sec: args.sec, master: args.master };
  s.countsJson = args.countsJson;
  if (s.run) { s.run.phase = 'scan'; s.run.cursorPos = 0; }
  return ok({ inserted: s.cands.length });
}

export async function readPendingCandidates(args: { runId: number; limit: number }): Promise<StoreOutcome<PendingCandidate[]>> {
  if (s.pendingError) throw s.pendingError;
  if (s.pendingFail) return { kind: 'error', error: s.pendingFail.error, retryable: s.pendingFail.retryable };
  if (s.notMigrated) return { kind: 'not_migrated' };
  return ok(s.cands.filter((c) => c.status === 'pending').sort((a, b) => a.ord - b.ord).slice(0, args.limit)
    .map((c) => ({ ord: c.ord, symbol: c.symbol, kisSymb: c.kisSymb, attempts: c.attempts })));
}

export async function readRetryCandidates(args: { runId: number; limit: number }): Promise<StoreOutcome<PendingCandidate[]>> {
  if (s.notMigrated) return { kind: 'not_migrated' };
  return ok(s.cands.filter((c) => c.status === 'kis_error' && c.attempts < 2).sort((a, b) => a.ord - b.ord)
    .slice(0, args.limit).map((c) => ({ ord: c.ord, symbol: c.symbol, kisSymb: c.kisSymb, attempts: c.attempts })));
}

export async function applyScanOutcome(args: { runId: number; outcome: ScanOutcome }): Promise<void> {
  const c = s.cands.find((x) => x.ord === args.outcome.ord);
  if (!c) return;
  c.status = args.outcome.status;
  c.attempts += 1;
}

export async function advanceRun(args: { runId: number; phase?: RunPhase; cursorPos?: number }): Promise<void> {
  if (!s.run) return;
  if (args.phase) s.run.phase = args.phase;
  if (args.cursorPos != null) s.run.cursorPos = Math.max(s.run.cursorPos, args.cursorPos);
}

export async function closeRun(args: { runId: number; phase: 'failed' | 'expired'; error: string }): Promise<void> {
  // 실제 저장소와 같은 계약 — `closeRun` 은 DB 오류를 **던진다**(try 로 감싸지 않는다)
  if (s.closeFail) throw Object.assign(new Error('close failed'), { code: s.closeFail.code });
  if (!s.run) return;
  s.run.phase = args.phase;
  s.run.lastError = args.error;
}

export async function expireOldRuns(): Promise<StoreOutcome<number>> {
  return ok(0);
}

export async function readFinalizeRows(): Promise<StoreOutcome<FinalizeRow[]>> {
  if (s.notMigrated) return { kind: 'not_migrated' };
  return ok(s.finalizeRows ?? []);
}

export async function readPrevTopSymbols(): Promise<StoreOutcome<string[]>> {
  return ok(s.prevTop);
}

export async function finalizeRun(args: {
  runId: number; verdicts: readonly CandidateVerdict[]; auto: readonly AutoRow[];
  countsJson: string; added: readonly string[]; removed: readonly string[]; nowMs: number;
}): Promise<StoreOutcome<{ autoRows: number }>> {
  if (s.finalizeFail) return { kind: 'error', error: s.finalizeFail.error, retryable: s.finalizeFail.retryable };
  // 실제 저장소와 같은 계약 — 상위가 비는 것은 **영구**다(T-145 ⑥-4)
  if (args.auto.length === 0) return { kind: 'error', error: 'empty_top', retryable: false };
  if (s.notMigrated) return { kind: 'not_migrated' };
  s.verdicts = [...args.verdicts];
  s.auto = args.auto.map((a) => ({ ...a }));
  s.autoComputedAt = args.auto.map(() => String(args.nowMs));
  s.countsJson = args.countsJson;
  if (s.run) s.run.phase = 'complete';
  return ok({ autoRows: args.auto.length });
}

export async function insertProposals(args: { drafts: readonly unknown[] }): Promise<StoreOutcome<{ inserted: { id: number; symbol: string; kind: string; nextSymbol: string | null }[] }>> {
  s.proposalsInserted += args.drafts.length;
  return ok({
    inserted: args.drafts.map((d, i) => {
      const x = d as { symbol: string; kind: string; nextSymbol: string | null };
      return { id: i + 1, symbol: x.symbol, kind: x.kind, nextSymbol: x.nextSymbol };
    }),
  });
}

export async function markProposalsNotified(): Promise<void> { /* 모형 */ }
export async function markRunNotified(): Promise<void> { /* 모형 */ }

export async function readProgress(): Promise<StoreOutcome<ScanProgress>> {
  if (s.notMigrated) return { kind: 'not_migrated' };
  return ok(progressOf());
}

export async function readRecentSnapshotSymbols(): Promise<Set<string> | null> {
  return s.recentSnapshot;
}

/** T-145 ⑧-2 — 실제 저장소와 같은 계약: 모르는 종목은 **지도에 없다**(false 가 아니다). */
export async function readRunKisStatus(): Promise<Map<string, boolean>> {
  return s.runKisStatus;
}

export async function readSymbolCikMap(): Promise<Map<string, number>> {
  return new Map();
}

/** 엔진이 이 모듈에서 가져오는 순수 헬퍼 — 실제 저장소와 같은 값이어야 한다. */
export const TERMINAL_PHASES: readonly RunPhase[] = ['complete', 'failed', 'expired'];
export function isTerminalPhase(p: RunPhase): boolean {
  return TERMINAL_PHASES.includes(p);
}
