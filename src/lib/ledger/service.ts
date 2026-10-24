/**
 * T-074 자금 이동 원장 — 조회·쓰기 흐름 (서버 전용). HTTP 를 모른다(handlers.ts 가 응답으로 바꾼다).
 *
 * 조회(buildFeed) 순서:
 *   기준·최신 스냅샷·기록·후보 표시 읽기 → 스냅샷 연속 행 읽기(기준 시각과 지금−scanDays 중 늦은 쪽, USD 왕복 판별용으로 최소 4일)
 *   → 지연 매칭(반영 대기·불일치만, /rematch 면 전부) → **바뀐 것만** 조건부 UPDATE(실패해도 이번 계산은 그대로 돌려주고 persisted=false)
 *   → 후보 탐지 → 요약 계산(compute.ts — 화면 미리보기와 같은 함수).
 * 쓰기는 서버가 화면과 같은 검증(validate.ts)을 다시 하고, 성공 응답에 최신 화면 데이터(feed)를 함께 싣는다(화면은 그것으로 교체 — Designer 4절).
 * 스냅샷 생성·cron 코드는 건드리지 않는다(Leader 확정: 반영 전환 = 조회 시 지연 매칭).
 */
import type {
  BaselineOption, BaselineView, CandidateView, EntryField, FieldError, LedgerEntryView, LedgerErrorBody, LedgerFeed,
  SnapshotView, UsdGapHint,
} from './types';
import { RULE } from './rules';
import { DAY_MS, dbDatetimeToWallMs, formatKstWall, HOUR_MS, instantToWallMs, MINUTE_MS, wallHour } from './kst';
import { baselineUnconfirmed, baseTotal, computeSummary, sameAmount, toCents } from './compute';
import {
  isCandidateKey, isClientEntryId, isCurrency, isEntryKind, parseAmount, parseCash, parseShortText, toFieldErrors, validateEntryInput,
  type NormalizedEntry,
} from './validate';
import { parseKstMinute } from './kst';
import { buildSteps, detectUsdFlips, parseSeries, parseSnapshotRow, type LedgerSnapshot } from './snapshots';
import { matchEntries, type AnchorResult, type MatchEntry } from './match';
import { detectCandidates, type CandidateMark } from './candidates';
import * as store from './store';
import type { StoredBaseline, StoredEntry } from './store';

export interface ServiceResult {
  status: number;
  body: Record<string, unknown>;
}

const err = (status: number, body: Omit<LedgerErrorBody, 'ok'>): ServiceResult => ({ status, body: { ok: false, ...body } });

// ─── 보기 변환 ────────────────────────────────────────────────────────────

export function toBaselineView(doc: StoredBaseline): BaselineView {
  const b = {
    totalKrw: doc.snapshot.totalKrw, krwCash: doc.snapshot.krwCash, usdCash: doc.snapshot.usdCash, fx: doc.snapshot.fx,
    confirmed: { krwCash: doc.confirmed.krwCash, usdCash: doc.confirmed.usdCash, at: doc.confirmed.at, note: doc.confirmed.note },
  };
  return {
    version: doc.version, updatedAt: doc.updatedAt, at: doc.baselineAt, snapshotId: doc.snapshotId, ...b,
    baselineTotalKrw: baseTotal(b), unconfirmed: baselineUnconfirmed(b), history: doc.history,
  };
}

function wallStr(ms: number | null): string | null {
  return ms == null ? null : formatKstWall(ms);
}

export function toEntryView(
  e: StoredEntry,
  r: AnchorResult | undefined,
  supersededBy: ReadonlyMap<number, number>,
  baselineAtMs: number | null,
): LedgerEntryView {
  const by = supersededBy.get(e.id) ?? null;
  return {
    id: e.id, clientEntryId: e.clientEntryId, kind: e.kind, occurredAt: formatKstWall(e.occurredAtMs).slice(0, 16),
    currency: e.currency, amount: e.amount, counterCurrency: e.counterCurrency, counterAmount: e.counterAmount,
    memo: e.memo, source: e.source, createdAt: formatKstWall(e.createdAtMs), createdByUserId: e.createdByUserId,
    anchor: r
      ? { status: r.status, snapshotId: r.snapshotId, snapshotTs: r.snapshotTs, detail: r.detail, suggest: r.suggest }
      : { status: e.anchorStatus, snapshotId: e.anchorSnapshotId, snapshotTs: wallStr(e.anchorSnapshotTsMs), detail: e.anchorDetail, suggest: null },
    fxRateUsed: r ? r.fxRateUsed : e.fxRateUsed,
    fxSource: r ? r.fxSource : e.fxSource,
    krwEquiv: r ? r.krwEquiv : e.krwEquiv,
    supersedes: e.supersedesId,
    supersededBy: by,
    void: e.deletedAtMs != null
      ? { type: by != null ? 'super' : 'cancel', reason: e.deleteReason, at: wallStr(e.deletedAtMs), byUserId: e.deletedByUserId, by }
      : null,
    beforeBaseline: baselineAtMs != null && e.occurredAtMs <= baselineAtMs,
  };
}

function toMatchEntry(e: StoredEntry): MatchEntry {
  return {
    id: e.id, kind: e.kind, occurredAtMs: e.occurredAtMs, currency: e.currency, amount: e.amount,
    counterCurrency: e.counterCurrency, counterAmount: e.counterAmount, anchorStatus: e.anchorStatus,
    anchorSnapshotId: e.anchorSnapshotId, voided: e.deletedAtMs != null,
  };
}

/** 저장 상태와 이번 매칭 결과가 같은가(같으면 UPDATE 하지 않는다) */
export function anchorSame(e: StoredEntry, r: AnchorResult): boolean {
  const fx4 = (v: number | null) => (v == null ? null : Math.round(v * 10_000));
  const krw = (v: number | null) => (v == null ? null : Math.round(v));
  return e.anchorStatus === r.status
    && e.anchorSnapshotId === r.snapshotId
    && wallStr(e.anchorSnapshotTsMs) === r.snapshotTs
    && (e.anchorDetail ?? null) === (r.detail ?? null)
    && fx4(e.fxRateUsed) === fx4(r.fxRateUsed)
    && (e.fxSource ?? null) === (r.fxSource ?? null)
    && krw(e.krwEquiv) === krw(r.krwEquiv);
}

function toSnapshotView(s: LedgerSnapshot, nowWall: number, gap: UsdGapHint | null): SnapshotView {
  const age = nowWall - s.tsMs;
  return {
    id: s.id, ts: s.ts, totalKrw: s.totalKrw,
    krwCash: s.krw ? s.krw.free : null,
    usdCash: s.usd ? s.usd.cents / 100 : null,
    fx: s.usd?.fx ?? null,
    stale: age > RULE.staleH * HOUR_MS,
    ageMin: Math.max(0, Math.round(age / MINUTE_MS)),
    usdGapHint: gap,
  };
}

/** 기준 정하기 선택지 — 오늘 아침(07~09시 첫 스냅샷, 권장) · 최신 · 어제 아침 (데모 BASE_OPTS) */
function toBaselineOptions(series: readonly LedgerSnapshot[], nowWall: number): BaselineOption[] {
  if (series.length === 0) return [];
  const today = formatKstWall(nowWall).slice(0, 10);
  const yesterday = formatKstWall(nowWall - DAY_MS).slice(0, 10);
  const morning = (d: string) => series.find((s) => s.ts.slice(0, 10) === d && wallHour(s.tsMs) >= 7 && wallHour(s.tsMs) < 9) ?? null;
  const picks: [LedgerSnapshot | null, BaselineOption['tags'][number]][] = [
    [morning(today), 'today_morning'], [series[series.length - 1], 'latest'], [morning(yesterday), 'yesterday_morning'],
  ];
  const out: BaselineOption[] = [];
  for (const [s, tag] of picks) {
    if (!s) continue;
    const found = out.find((o) => o.id === s.id);
    if (found) { found.tags.push(tag); continue; }
    out.push({
      id: s.id, ts: s.ts, totalKrw: s.totalKrw, krwCash: s.krw ? s.krw.free : null,
      usdCash: s.usd ? s.usd.cents / 100 : null, fx: s.usd?.fx ?? null, tags: [tag],
    });
  }
  return out;
}

// ─── 조회 ─────────────────────────────────────────────────────────────────

export interface FeedOptions {
  /** 반영됨까지 처음부터 다시 맞춘다 (POST /rematch) */
  rematchAll?: boolean;
  /** 매칭 결과 저장 실패를 던진다 (POST /rematch). 조회는 false — 계산 결과는 그대로 돌려준다 */
  strict?: boolean;
}

export interface FeedBuild {
  feed: LedgerFeed;
  stored: StoredEntry[];
  changed: number;
}

export async function buildFeed(now: Date, opts: FeedOptions = {}): Promise<FeedBuild> {
  const nowWall = instantToWallMs(now);
  const [baseRead, latestRow, entries, marksRead, recentRows] = await Promise.all([
    store.readBaseline(), store.readLatestSnapshot(), store.readEntries(), store.readMarks(),
    store.readSnapshotsSince(formatKstWall(Math.floor((nowWall - DAY_MS) / DAY_MS) * DAY_MS)),
  ]);
  if (baseRead.status === 'invalid') {
    throw new store.LedgerDataError(`저장된 손익 기준을 읽을 수 없습니다 (${baseRead.detail}) — ${store.BASELINE_RECOVERY_HINT}`);
  }
  if (marksRead.status === 'invalid') console.warn('[ledger] cash_ledger_candidate_marks 손상 — 표시 없이 계산:', marksRead.detail);
  const baselineDoc = baseRead.status === 'ok' ? baseRead.doc : null;
  const baseline = baselineDoc ? toBaselineView(baselineDoc) : null;
  const baselineAtMs = baselineDoc ? dbDatetimeToWallMs(baselineDoc.baselineAt) : null;
  const latest = latestRow ? parseSnapshotRow(latestRow) : null;
  const marks: Record<string, CandidateMark> = marksRead.status === 'ok' ? marksRead.doc.marks : {};

  let results = new Map<number, AnchorResult>();
  let consumed = new Set<string>();
  let candidates: CandidateView[] = [];
  let gapHint: UsdGapHint | null = null;
  let scanTruncated = false;
  let persisted = true;
  let changed = 0;

  if (baselineAtMs != null && latest) {
    const scanFromMs = Math.max(baselineAtMs, nowWall - RULE.scanDays * DAY_MS);
    const readFromMs = Math.min(scanFromMs, nowWall - (RULE.usdFlipActiveDays + 1) * DAY_MS);
    const s = await store.readSnapshotSeries(formatKstWall(readFromMs), RULE.scanMaxRows);
    scanTruncated = s.truncated;
    const series = parseSeries(s.rows);
    const steps = buildSteps(series);
    const flips = detectUsdFlips(steps);
    gapHint = series.length && series[series.length - 1].id === latest.id ? flips.gapHint : null;
    const m = matchEntries(entries.map(toMatchEntry), series, steps, { rematchAll: opts.rematchAll, scanFromMs });
    results = m.results;
    consumed = m.consumed;
    const byId = new Map(entries.map((e) => [e.id, e]));
    for (const [id, r] of results) {
      const e = byId.get(id);
      if (!e || anchorSame(e, r)) continue;
      try {
        changed += await store.updateAnchor(id, { status: e.anchorStatus, snapshotId: e.anchorSnapshotId }, r);
      } catch (ex) {
        persisted = false;
        if (opts.strict) throw ex;
        console.error('[ledger] 반영 상태 저장 실패(이번 계산은 그대로 응답):', ex instanceof Error ? ex.message : String(ex));
      }
    }
    candidates = detectCandidates(steps, { baselineAtMs, consumed, flipStepIds: flips.flipStepIds, marks });
  }

  const supersededBy = new Map<number, number>();
  for (const e of entries) if (e.supersedesId != null) supersededBy.set(e.supersedesId, e.id);
  const views = entries.map((e) => toEntryView(e, results.get(e.id), supersededBy, baselineAtMs));
  const snapshot = latest ? toSnapshotView(latest, nowWall, gapHint) : null;
  const summary = computeSummary({ baseline, snapshot, entries: views });
  const optionSeries = parseSeries(recentRows);
  const feed: LedgerFeed = {
    baseline, snapshot, entries: views, summary, candidates,
    baselineOptions: toBaselineOptions(optionSeries, nowWall),
    rules: RULE, now: formatKstWall(nowWall), persisted, scanTruncated,
  };
  return { feed, stored: entries, changed };
}

// ─── 쓰기 공통 ────────────────────────────────────────────────────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

const BAD_BODY = err(400, { code: 'bad_request', error: '요청 본문이 올바른 JSON 객체가 아닙니다' });

function validationError(fieldErrors: Partial<Record<string, FieldError>>, retrySafe?: boolean): ServiceResult {
  const first = Object.values(fieldErrors)[0];
  return err(422, {
    code: 'validation', error: first ? first.message : '입력을 확인해 주세요', fieldErrors: fieldErrors as LedgerErrorBody['fieldErrors'],
    ...(retrySafe ? { retrySafe } : {}),
  });
}

/** 정수 id 경로 파라미터 */
export function parseId(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^[1-9]\d{0,17}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

interface WriteContext {
  nowWall: number;
  nowWallStr: string;
  baselineDoc: StoredBaseline;
  baselineAtMs: number;
  entries: StoredEntry[];
  latest: LedgerSnapshot | null;
}

/** 기록 쓰기 공통 선행 검사: 본문 형식 → 기준(없음·버전) */
async function prepareEntryWrite(
  body: Record<string, unknown>, now: Date,
): Promise<{ ok: true; ctx: WriteContext; clientEntryId: string } | { ok: false; res: ServiceResult }> {
  const fe: Partial<Record<EntryField, FieldError>> = {};
  if (!isClientEntryId(body.clientEntryId)) fe.clientEntryId = { code: 'format', message: '저장 키(clientEntryId, 8~36자)가 필요합니다. 화면을 새로 고쳐 주세요.' };
  if (typeof body.baseVersion !== 'number' || !Number.isInteger(body.baseVersion) || body.baseVersion < 1) {
    fe.baseVersion = { code: 'format', message: '기준 버전(baseVersion)이 필요합니다. 화면을 새로 고쳐 주세요.' };
  }
  if (body.fromCandidateKey != null && !isCandidateKey(body.fromCandidateKey)) {
    fe.fromCandidateKey = { code: 'format', message: '후보 키 형식이 아닙니다.' };
  }
  if (Object.keys(fe).length) return { ok: false, res: validationError(fe) };
  const nowWall = instantToWallMs(now);
  const [baseRead, latestRow, entries] = await Promise.all([store.readBaseline(), store.readLatestSnapshot(), store.readEntries()]);
  if (baseRead.status === 'invalid') {
    throw new store.LedgerDataError(`저장된 손익 기준을 읽을 수 없습니다 (${baseRead.detail}) — ${store.BASELINE_RECOVERY_HINT}`);
  }
  if (baseRead.status === 'absent') {
    return { ok: false, res: err(409, { code: 'no_baseline', error: '손익 기준이 아직 없습니다 — 먼저 기준을 정하세요', latest: null }) };
  }
  if (baseRead.doc.version !== body.baseVersion) {
    return {
      ok: false,
      res: err(409, {
        code: 'baseline_version', error: '다른 기기에서 기준이 먼저 바뀌었습니다 — 새 기준으로 다시 확인한 뒤 기록하세요',
        latest: toBaselineView(baseRead.doc),
      }),
    };
  }
  const baselineAtMs = dbDatetimeToWallMs(baseRead.doc.baselineAt);
  if (baselineAtMs == null) throw new store.LedgerDataError('손익 기준 시각 형식 오류');
  return {
    ok: true,
    clientEntryId: body.clientEntryId as string,
    ctx: {
      nowWall, nowWallStr: formatKstWall(nowWall), baselineDoc: baseRead.doc, baselineAtMs, entries,
      latest: latestRow ? parseSnapshotRow(latestRow) : null,
    },
  };
}

function validateWith(body: Record<string, unknown>, ctx: WriteContext, targetId: number | null) {
  const supersededBy = new Map<number, number>();
  const lite = ctx.entries.map((e) => toEntryView(e, undefined, supersededBy, ctx.baselineAtMs));
  return validateEntryInput(
    {
      kind: body.kind, occurredAt: body.occurredAt, currency: body.currency, amount: body.amount,
      counterCurrency: body.counterCurrency, counterAmount: body.counterAmount, memo: body.memo, targetId,
    },
    {
      nowMs: ctx.nowWall, baselineAtMs: ctx.baselineAtMs,
      snapshot: ctx.latest ? { totalKrw: ctx.latest.totalKrw, fx: ctx.latest.usd?.fx ?? null } : null,
      entries: lite,
    },
  );
}

async function replayResponse(existing: StoredEntry, now: Date, fromCandidateKey: unknown): Promise<ServiceResult> {
  const { feed } = await buildFeed(now);
  const entry = feed.entries.find((e) => e.id === existing.id) as LedgerEntryView;
  const original = existing.supersedesId != null ? feed.entries.find((e) => e.id === existing.supersedesId) : undefined;
  return {
    status: 200,
    body: {
      ok: true, data: feed, entry, ...(original ? { original } : {}), warnings: [], replayed: true,
      candidateResolved: typeof fromCandidateKey === 'string' ? !feed.candidates.some((c) => c.key === fromCandidateKey && c.state === 'open') : null,
    },
  };
}

/** 같은 clientEntryId 로 내용이 다른 요청이 왔을 때의 문장 (Reviewer M1) */
export const CLIENT_ENTRY_CONFLICT_TEXT = '같은 요청 번호로 다른 내용이 와서 저장하지 않았습니다. 방금 저장된 기록을 확인해 주세요';

/**
 * 같은 clientEntryId 재전송이 저장된 기록과 **같은 내용**인가 (Reviewer M1). 정규화된 입력 전부를 본다 —
 * 종류·통화·금액(원 정수/달러 센트)·발생 시각(분)·환전 상대 통화·금액·메모(앞뒤 공백 제거, 빈 칸 = 없음)·정정 대상(supersedes).
 * 기준 시각·미래 같은 '지금' 기준 검사는 하지 않는다(처음 요청이 이미 통과해 저장된 뒤라, 재전송 시점에 기준이 바뀌었어도 같은 내용이면 같은 기록이다).
 */
export function sameEntryContent(e: StoredEntry, body: Record<string, unknown>, supersedesId: number | null): boolean {
  if ((e.supersedesId ?? null) !== supersedesId) return false;
  if (!isEntryKind(body.kind) || body.kind !== e.kind) return false;
  if (!isCurrency(body.currency) || body.currency !== e.currency) return false;
  const t = parseKstMinute(body.occurredAt);
  if (t == null || t !== e.occurredAtMs) return false;
  const a = parseAmount(body.amount, e.currency);
  if (!('value' in a) || !sameAmount(e.currency, a.value, e.amount)) return false;
  if (e.kind === 'exchange') {
    if (!isCurrency(body.counterCurrency) || body.counterCurrency !== e.counterCurrency || e.counterAmount == null) return false;
    const b = parseAmount(body.counterAmount, body.counterCurrency);
    if (!('value' in b) || !sameAmount(body.counterCurrency, b.value, e.counterAmount)) return false;
  }
  const m = parseShortText(body.memo, { label: '메모' });
  if (!('value' in m)) return false;
  return (m.value ?? null) === (e.memo ?? null);
}

/** 같은 clientEntryId 가 이미 저장돼 있을 때: 같은 내용이면 그 기록(replayed), 다르면 409 client_entry_conflict(최신 데이터·저장된 기록 id) */
async function replayOrConflict(existing: StoredEntry, body: Record<string, unknown>, supersedesId: number | null, now: Date): Promise<ServiceResult> {
  if (sameEntryContent(existing, body, supersedesId)) return replayResponse(existing, now, body.fromCandidateKey);
  const { feed } = await buildFeed(now);
  return err(409, { code: 'client_entry_conflict', error: CLIENT_ENTRY_CONFLICT_TEXT, existingId: existing.id, data: feed });
}

async function duplicateResponse(n: NormalizedEntry): Promise<ServiceResult> {
  const existingId = await store.findLiveDuplicate(n);
  return err(409, {
    code: 'duplicate',
    error: '기록하지 않았습니다 — 같은 종류·통화·금액·시각(분)의 기록이 이미 있습니다. 다른 돈이면 시각을 1분 이상 다르게 넣으세요.',
    ...(existingId != null ? { existingId } : {}),
  });
}

// ─── 쓰기: 기록 추가 ──────────────────────────────────────────────────────

export async function createEntry(body: unknown, userId: number | null, now: Date): Promise<ServiceResult> {
  if (!isObj(body)) return BAD_BODY;
  const prep = await prepareEntryWrite(body, now);
  if (!prep.ok) return prep.res;
  const { ctx, clientEntryId } = prep;
  const existing = ctx.entries.find((e) => e.clientEntryId === clientEntryId) ?? (await store.findByClientEntryId(clientEntryId));
  if (existing) return replayOrConflict(existing, body, null, now);

  const v = validateWith(body, ctx, null);
  if (v.count > 0 || !v.value) return validationError(toFieldErrors(v), true);
  let id: number;
  try {
    id = await store.insertEntryRow(v.value, { clientEntryId, userId, nowWall: ctx.nowWallStr, supersedesId: null });
  } catch (e) {
    const d = store.dupKeyOf(e);
    if (d === 'client') {
      const again = await store.findByClientEntryId(clientEntryId);
      if (again) return replayOrConflict(again, body, null, now);
    }
    if (d === 'live') return duplicateResponse(v.value);
    throw e;
  }
  const { feed } = await buildFeed(now);
  const entry = feed.entries.find((e) => e.id === id) as LedgerEntryView;
  const key = typeof body.fromCandidateKey === 'string' ? body.fromCandidateKey : null;
  return {
    status: 200,
    body: {
      ok: true, data: feed, entry, warnings: v.warnings, replayed: false,
      candidateResolved: key ? !feed.candidates.some((c) => c.key === key && c.state === 'open') : null,
    },
  };
}

// ─── 쓰기: 정정 ───────────────────────────────────────────────────────────

export async function correctEntry(idRaw: unknown, body: unknown, userId: number | null, now: Date): Promise<ServiceResult> {
  const id = parseId(idRaw);
  if (id == null) return err(404, { code: 'not_found', error: '기록을 찾을 수 없습니다' });
  if (!isObj(body)) return BAD_BODY;
  const reason = parseShortText(body.reason, { label: '정정 사유' });
  if ('error' in reason) return validationError({ reason: reason.error });
  const prep = await prepareEntryWrite(body, now);
  if (!prep.ok) return prep.res;
  const { ctx, clientEntryId } = prep;
  const existing = ctx.entries.find((e) => e.clientEntryId === clientEntryId) ?? (await store.findByClientEntryId(clientEntryId));
  // 같은 키 = 같은 정정 대상·같은 내용일 때만 그 기록(replayed). 대상이나 내용이 다르면 409 client_entry_conflict (Reviewer M1)
  if (existing) return replayOrConflict(existing, body, id, now);
  const orig = ctx.entries.find((e) => e.id === id);
  if (!orig) return err(404, { code: 'not_found', error: '기록을 찾을 수 없습니다' });
  if (orig.deletedAtMs != null) {
    const { feed } = await buildFeed(now);
    return err(409, { code: 'already_voided', error: '정정하지 않았습니다 — 이 기록은 이미 취소되었거나 정정되었습니다', data: feed });
  }
  const v = validateWith(body, ctx, id);
  if (v.count > 0 || !v.value) return validationError(toFieldErrors(v), true);
  const tx = await store.correctEntryTx(id, v.value, {
    clientEntryId, userId, nowWall: ctx.nowWallStr, reason: reason.value ?? '정정',
  });
  if (tx.kind === 'not_found') return err(404, { code: 'not_found', error: '기록을 찾을 수 없습니다' });
  if (tx.kind === 'already_voided') {
    const { feed } = await buildFeed(now);
    return err(409, { code: 'already_voided', error: '정정하지 않았습니다 — 이 기록은 다른 기기에서 먼저 취소되었거나 정정되었습니다', data: feed });
  }
  if (tx.kind === 'dup_client') {
    const again = await store.findByClientEntryId(clientEntryId);
    if (again) return replayOrConflict(again, body, id, now);
    throw new Error('정정 저장 키 충돌 뒤 기록을 찾지 못했습니다');
  }
  if (tx.kind === 'dup_live') return duplicateResponse(v.value);
  const { feed } = await buildFeed(now);
  return {
    status: 200,
    body: {
      ok: true, data: feed,
      entry: feed.entries.find((e) => e.id === tx.newId),
      original: feed.entries.find((e) => e.id === id),
      warnings: v.warnings, replayed: false, candidateResolved: null,
    },
  };
}

// ─── 쓰기: 취소·복구 ──────────────────────────────────────────────────────

export async function cancelEntry(idRaw: unknown, body: unknown, userId: number | null, now: Date): Promise<ServiceResult> {
  const id = parseId(idRaw);
  if (id == null) return err(404, { code: 'not_found', error: '기록을 찾을 수 없습니다' });
  if (!isObj(body)) return BAD_BODY;
  const reason = parseShortText(body.reason, { label: '취소 사유', required: true });
  if ('error' in reason) return validationError({ reason: reason.error });
  const n = await store.voidEntryRow(id, reason.value as string, userId, store.nowWallString(now));
  if (n === 0) {
    const row = await store.findEntry(id);
    if (!row) return err(404, { code: 'not_found', error: '기록을 찾을 수 없습니다' });
    const { feed } = await buildFeed(now);
    return err(409, { code: 'already_voided', error: '표시하지 않았습니다 — 이 기록은 이미 취소되었거나 정정되었습니다', data: feed });
  }
  const { feed } = await buildFeed(now);
  return { status: 200, body: { ok: true, data: feed, entry: feed.entries.find((e) => e.id === id) } };
}

export async function restoreEntry(idRaw: unknown, now: Date): Promise<ServiceResult> {
  const id = parseId(idRaw);
  if (id == null) return err(404, { code: 'not_found', error: '기록을 찾을 수 없습니다' });
  const r = await store.restoreEntryTx(id);
  if (r.kind === 'not_found') return err(404, { code: 'not_found', error: '기록을 찾을 수 없습니다' });
  if (r.kind === 'superseded') {
    return err(409, { code: 'superseded', error: `정정으로 대체된 기록은 되살리지 않습니다 — 바꾸려면 새 기록 #${r.by} 를 정정하세요`, existingId: r.by });
  }
  if (r.kind === 'dup_live') {
    const row = await store.findEntry(id);
    const existingId = row ? await store.findLiveDuplicate({
      kind: row.kind, occurredAt: formatKstWall(row.occurredAtMs).slice(0, 16), occurredAtMs: row.occurredAtMs, currency: row.currency,
      amount: row.amount, counterCurrency: row.counterCurrency, counterAmount: row.counterAmount, memo: row.memo,
    }) : null;
    return err(409, {
      code: 'duplicate', error: '되살리지 않았습니다 — 같은 종류·통화·금액·시각(분)의 기록이 이미 살아 있습니다(두 번 빠집니다)',
      ...(existingId != null ? { existingId } : {}),
    });
  }
  const { feed } = await buildFeed(now);
  if (r.kind === 'not_voided') {
    return err(409, { code: 'not_voided', error: '이미 다른 기기에서 되살렸습니다 — 두 번 되살아나지 않습니다', data: feed });
  }
  return { status: 200, body: { ok: true, data: feed, entry: feed.entries.find((e) => e.id === id) } };
}

// ─── 쓰기: 기준 ───────────────────────────────────────────────────────────

export async function putBaseline(body: unknown, now: Date): Promise<ServiceResult> {
  if (!isObj(body)) return BAD_BODY;
  const fe: Partial<Record<string, FieldError>> = {};
  const snapshotId = body.snapshotId;
  if (typeof snapshotId !== 'number' || !Number.isSafeInteger(snapshotId) || snapshotId < 1) {
    fe.snapshotId = { code: 'format', message: '기준 스냅샷을 골라 주세요.' };
  }
  if (typeof body.baseVersion !== 'number' || !Number.isInteger(body.baseVersion) || body.baseVersion < 0) {
    fe.baseVersion = { code: 'format', message: '기준 버전(baseVersion)이 필요합니다(첫 저장은 0).' };
  }
  const c = body.confirmed == null ? {} : body.confirmed;
  if (!isObj(c)) fe.krwCash = { code: 'format', message: 'confirmed 는 객체입니다.' };
  const cObj = isObj(c) ? c : {};
  const k = parseCash(cObj.krwCash, 'KRW');
  const u = parseCash(cObj.usdCash, 'USD');
  if ('error' in k) fe.krwCash = k.error;
  if ('error' in u) fe.usdCash = u.error;
  const note = parseShortText(cObj.note, { label: '메모' });
  if ('error' in note) fe.note = note.error;
  if (Object.keys(fe).length) return validationError(fe);

  // QA D-2: 원장 표가 없으면(마이그레이션 전) system_config 에 아무것도 쓰기 전에 503 not_migrated — 저장 뒤 503 이 나던 순서를 바꿨다
  await store.assertLedgerTable();
  const row = await store.readSnapshotById(snapshotId as number);
  const snap = row ? parseSnapshotRow(row) : null;
  if (!snap) return validationError({ snapshotId: { code: 'not_found', message: '그 스냅샷을 찾을 수 없습니다. 목록을 새로 고쳐 주세요.' } });
  const cKrw = 'value' in k ? k.value : null;
  const cUsd = 'value' in u ? u.value : null;
  if (cUsd != null && (!snap.usd || snap.usd.fx == null)) {
    return validationError({ usdCash: { code: 'no_fx', message: '이 스냅샷에는 달러 현금 행(환율)이 없어 달러 현금을 확인할 수 없습니다.' } });
  }
  const nowWallStr = store.nowWallString(now);
  const snapshotPart = {
    totalKrw: snap.totalKrw, krwCash: snap.krw ? snap.krw.free : 0,
    usdCash: snap.usd ? snap.usd.cents / 100 : null, fx: snap.usd?.fx ?? null,
  };
  const confirmed = {
    krwCash: cKrw, usdCash: cUsd == null ? null : toCents(cUsd) / 100,
    at: cKrw != null || cUsd != null ? nowWallStr : null, note: 'value' in note ? note.value : null,
  };
  const baselineTotalKrw = baseTotal({ ...snapshotPart, confirmed });
  const saved = await store.saveBaseline(
    { baselineAt: snap.ts, snapshotId: snap.id, snapshot: snapshotPart, confirmed, baselineTotalKrw },
    body.baseVersion as number, nowWallStr,
  );
  const { feed } = await buildFeed(now);
  if (!saved.ok) {
    return err(409, {
      code: 'version', error: '저장하지 않았습니다 — 다른 기기에서 기준이 먼저 바뀌었습니다. 최신 기준을 확인한 뒤 다시 저장하세요',
      latest: saved.latest ? toBaselineView(saved.latest) : null, data: feed,
    });
  }
  return { status: 200, body: { ok: true, data: feed, baseline: feed.baseline } };
}

// ─── 쓰기: 후보 표시 ──────────────────────────────────────────────────────

export async function dismissCandidate(keyRaw: unknown, body: unknown, userId: number | null, now: Date): Promise<ServiceResult> {
  if (!isCandidateKey(keyRaw)) return err(404, { code: 'not_found', error: '후보를 찾을 수 없습니다' });
  const key = keyRaw;
  if (!isObj(body)) return BAD_BODY;
  const reason = parseShortText(body.reason, { label: '사유', required: true });
  if ('error' in reason) return validationError({ reason: reason.error });
  const before = await buildFeed(now);
  if (!before.feed.baseline) return err(409, { code: 'no_baseline', error: '손익 기준이 아직 없습니다', latest: null });
  const cand = before.feed.candidates.find((x) => x.key === key);
  if (!cand || cand.state !== 'open') {
    return err(409, { code: 'already_handled', error: '이미 처리한 변화입니다 — 최신 상태를 불러왔습니다', data: before.feed });
  }
  const nowWallStr = store.nowWallString(now);
  const r = await store.updateMarks<'ok' | 'already'>((doc) => {
    if (doc.marks[key]) return { write: false, result: 'already' };
    doc.marks[key] = { state: 'dismissed', reason: reason.value as string, at: nowWallStr, byUserId: userId };
    doc.log.push({ key, action: 'dismiss', reason: reason.value, at: nowWallStr, byUserId: userId });
    return { write: true, result: 'ok' };
  }, nowWallStr);
  const { feed } = await buildFeed(now);
  if (r === 'already') return err(409, { code: 'already_handled', error: '다른 기기에서 이미 처리한 변화입니다', data: feed });
  return { status: 200, body: { ok: true, data: feed, candidate: feed.candidates.find((x) => x.key === key) ?? null } };
}

export async function reopenCandidate(keyRaw: unknown, userId: number | null, now: Date): Promise<ServiceResult> {
  if (!isCandidateKey(keyRaw)) return err(404, { code: 'not_found', error: '후보를 찾을 수 없습니다' });
  const key = keyRaw;
  const nowWallStr = store.nowWallString(now);
  const r = await store.updateMarks<'ok' | 'none'>((doc) => {
    if (!doc.marks[key]) return { write: false, result: 'none' };
    delete doc.marks[key];
    doc.log.push({ key, action: 'reopen', reason: null, at: nowWallStr, byUserId: userId });
    return { write: true, result: 'ok' };
  }, nowWallStr);
  const { feed } = await buildFeed(now);
  if (r === 'none') return err(409, { code: 'not_dismissed', error: '되돌릴 표시가 없습니다 — 최신 상태를 불러왔습니다', data: feed });
  return { status: 200, body: { ok: true, data: feed, candidate: feed.candidates.find((x) => x.key === key) ?? null } };
}

// ─── 조회·다시 맞추기 ─────────────────────────────────────────────────────

export async function getFeed(now: Date): Promise<ServiceResult> {
  const { feed } = await buildFeed(now);
  return { status: 200, body: { ok: true, data: feed } };
}

export async function rematch(now: Date): Promise<ServiceResult> {
  const { feed, changed } = await buildFeed(now, { rematchAll: true, strict: true });
  return { status: 200, body: { ok: true, data: feed, changed } };
}

/** 시험용 */
export const _internal = { toBaselineOptions, toSnapshotView };
