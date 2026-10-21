/**
 * `edgar-sync` 본체 (T-059 Part A) — SEC EDGAR 읽기 전용 수집 → 신규 테이블 4개 적재.
 *
 * 순서 (네트워크는 전부 `SecClient` 한 개를 거친다 — 직렬·≤4 req/s·429/403 즉시 중단):
 *  0. 동시 실행 방지(프로세스 안). 신규 테이블 확인 → 없으면 `skipped:'tables_missing'`(SEC 호출 0). `SEC_USER_AGENT` 확인 → 없으면
 *     `skipped:'sec_user_agent_missing'`(SEC 호출 0, console.error).
 *  1. 대상 = 보유 ∪ 즐겨찾기 ∪ universe 50 (해외 형식만). `company_tickers.json` 1회로 CIK 매핑 → `symbol_cik_map` upsert.
 *     매핑 실패(ETF·미등재)는 `unmapped` 로 남기고 건너뛴다. company_tickers 자체가 실패하면 **기존 매핑으로 계속**한다(지우지 않음).
 *  2. CIK 마다(마지막 시도가 오래된 것부터 — 시간 예산을 넘겨 끊겨도 다음 날 뒤쪽부터 이어 간다):
 *     a. submissions 1회. 본문 sha256 이 직전과 같으면 파싱·쓰기 생략(증분). 다르면 `us_filings` upsert + `estimated` 창 갱신.
 *        `entityType` 이 'operating' 이 아니면(신탁·펀드 등 — 보통주 아님) 그 CIK 는 facts·추정 없이 건너뛴다.
 *     b. companyfacts 1회 — **필요할 때만**: 워터마크가 없거나, submissions 에 워터마크 이후 접수된 정기보고서(10-Q·10-K 등)가 있을 때.
 *  3. 종목(CIK) 단위 격리 — 한 CIK 의 파싱·HTTP 실패는 `last_error` 에 남기고 다음 CIK 로. **기존 행은 지우지 않는다.**
 *     `SecBlockedError`(429/403/쿨다운)만 job 전체를 멈춘다.
 *
 * 시간 예산(기본 100초 — R-4 로 150→100): cron-runner.sh 는 잡을 **동기 curl** 로 부르고, 하트비트는 tick 맨 앞에서만 쓰며
 * tick 뒤에 `sleep 60` 이 붙는다. 하트비트 간격이 300초(`CRON_HEARTBEAT_STALE_SEC`)를 넘으면 워치독이 "cron 정지" critical 을 낸다.
 * 예산은 **CIK 를 시작하기 전에만** 검사하므로 진행 중인 마지막 CIK 는 끝까지 간다. 최악 경로 계산:
 *   예산 직전(≈100초)에 시작한 마지막 CIK — submissions(간격 0.25 + 타임아웃 30 + 재시도 대기 1 + 타임아웃 30 ≈ 61초)
 *   + companyfacts(같은 ≈ 61초) + DB 쓰기(수 초) ≈ 100 + 122 + 5 = 약 227초.
 *   같은 07시 tick 의 entry-watcher·holding-checker·research-cycle-overseas 등 수 초를 더해도 약 235초 + sleep 60 = 약 295초 < 300초.
 *   (150초였다면 약 345초로 한도 초과 — Reviewer R-4.) 예산을 넘기면 남은 CIK 는 다음 날로 넘기고 `partial:true` 로 끝낸다.
 *
 * 쓰는 테이블: symbol_cik_map · us_filings · us_financial_facts · us_earnings_events 뿐. signals·orders·position_state 쓰기 없음.
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { toKstDatetime } from '@/lib/time';
import { EDGAR_TABLES, findMissingTables, loadUsTargetSymbols, type Queryable } from '../us-data-db';
import {
  SEC_COMPANY_TICKERS_URL, SecBlockedError, SecClient, readSecUserAgent, secCompanyFactsUrl, secSubmissionsUrl,
} from './sec-client';
import {
  FACTS_TRIGGER_FORMS, daysBetween, etDateString, extractEarningsReleaseDates, parseCompanyTickers, parseSubmissions, toSecTicker,
  type FilingRow, type ParsedSubmissions,
} from './parse';
import { extractFramedFacts, type FactRow } from './xbrl-facts';
import { estimateNextEarningsWindow } from './earnings-schedule';

export const EDGAR_SYNC_DEFAULT_BUDGET_MS = 100_000;
const FACTS_CHUNK = 500;

export interface EdgarSyncDeps {
  db: Queryable;
  env?: NodeJS.ProcessEnv;
  /** 테스트용 주입. 없으면 `SEC_USER_AGENT` 로 만든다. */
  client?: SecClient;
  now?: () => Date;
  budgetMs?: number;
  log?: (line: string) => void;
}

export interface EdgarSyncResult {
  ok: boolean;
  skipped?: 'tables_missing' | 'sec_user_agent_missing' | 'already_running';
  missing?: string[];
  aborted?: 'sec_blocked';
  targets?: number;
  mapped?: number;
  unmapped?: string[];
  tickersSource?: 'sec' | 'existing_map';
  ciks?: number;
  ciksDone?: number;
  ciksUnchanged?: number;
  ciksFailed?: Array<{ cik: number; error: string }>;
  nonOperating?: number[];
  filingsUpserted?: number;
  factsUpserted?: number;
  factsFetched?: number;
  estimates?: Array<{ symbol: string; window?: [string, string]; reason?: string }>;
  partial?: boolean;
  remaining?: number;
  requests?: number;
  durationMs?: number;
}

let running = false;

interface MapRow {
  symbol: string;
  cik: number;
  submissions_sha256: string | null;
  facts_sha256: string | null;
  facts_filed_watermark: string | Date | null;   // 실제 mysql2 는 Date(KST 자정)
  last_attempt_at: Date | string | null;
}

/**
 * DATE 컬럼 값 → 'YYYY-MM-DD'. 실제 mysql2 는 DATE 를 `Date` 로 준다(앱 풀 timezone '+09:00' → **KST 자정** 인스턴트, UTC 로는 전날 15:00).
 * `toISOString().slice(0,10)` 은 하루 앞선 날짜가 된다 — 그래서 KST(+9h) 벽시계 날짜로 되돌린다. 프로세스 TZ 와 무관하다.
 * export 는 시험용(R-7).
 */
export function dateStr(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return toKstDatetime(v).slice(0, 10);
  }
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

function shortErr(e: unknown): string {
  const m = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return m.slice(0, 250);
}

export async function runEdgarSync(deps: EdgarSyncDeps): Promise<EdgarSyncResult> {
  if (running) return { ok: false, skipped: 'already_running' };
  running = true;
  try {
    return await runInner(deps);
  } finally {
    running = false;
  }
}

async function runInner(deps: EdgarSyncDeps): Promise<EdgarSyncResult> {
  const { db } = deps;
  const log = deps.log ?? ((l: string) => console.log(l));
  const now = deps.now ?? (() => new Date());
  const t0 = now().getTime();
  // env 로는 낮추기만 가능(상한 = 기본 100초) — 올리면 위 최악 경로 계산이 워치독 300초를 넘는다.
  const budget = Math.min(EDGAR_SYNC_DEFAULT_BUDGET_MS, Math.max(10_000, deps.budgetMs ?? (Number(deps.env?.EDGAR_SYNC_BUDGET_MS ?? process.env.EDGAR_SYNC_BUDGET_MS) || EDGAR_SYNC_DEFAULT_BUDGET_MS)));

  const missing = await findMissingTables(db, EDGAR_TABLES);
  if (missing.length > 0) {
    log(`[edgar-sync] skipped: tables_missing (${missing.join(',')}) — scripts/migrations/T-059-us-data-collector.sql 미적용`);
    return { ok: true, skipped: 'tables_missing', missing };
  }

  let client = deps.client;
  if (!client) {
    const ua = readSecUserAgent(deps.env ?? process.env);
    if (!ua) {
      console.error('[edgar-sync] SEC_USER_AGENT 가 비었거나 연락 이메일이 없다 — SEC 를 호출하지 않고 건너뛴다');
      return { ok: false, skipped: 'sec_user_agent_missing' };
    }
    client = new SecClient({ userAgent: ua });
  }

  const res: EdgarSyncResult = {
    ok: true, unmapped: [], ciksFailed: [], nonOperating: [], estimates: [],
    filingsUpserted: 0, factsUpserted: 0, factsFetched: 0, ciksDone: 0, ciksUnchanged: 0,
  };
  const { symbols: targets } = await loadUsTargetSymbols(db);
  res.targets = targets.length;

  try {
    // ── 1. CIK 매핑 ──────────────────────────────────────────────────────────
    try {
      const r = await client.getJson(SEC_COMPANY_TICKERS_URL);
      if (r.status !== 200) throw new Error(`company_tickers HTTP ${r.status}`);
      const map = parseCompanyTickers(r.json);
      res.tickersSource = 'sec';
      for (const symbol of targets) {
        const t = toSecTicker(symbol);
        const hit = t ? map.get(t) : undefined;
        if (!t || !hit) { res.unmapped!.push(symbol); continue; }
        // cik 가 바뀌면(티커 재배정) 동기화 상태를 비운다 — 대입 순서상 cik 갱신보다 먼저 와야 한다.
        await db.query(
          `INSERT INTO symbol_cik_map (symbol, cik, sec_ticker, entity_title, source, verified_at)
           VALUES (?, ?, ?, ?, 'sec_company_tickers', NOW())
           ON DUPLICATE KEY UPDATE
             submissions_sha256    = IF(cik <> VALUES(cik), NULL, submissions_sha256),
             facts_sha256          = IF(cik <> VALUES(cik), NULL, facts_sha256),
             facts_filed_watermark = IF(cik <> VALUES(cik), NULL, facts_filed_watermark),
             cik = VALUES(cik), sec_ticker = VALUES(sec_ticker), entity_title = VALUES(entity_title),
             source = VALUES(source), verified_at = NOW()`,
          [symbol, hit.cik, t, hit.title || null],
        );
      }
    } catch (e) {
      if (e instanceof SecBlockedError) throw e;
      res.tickersSource = 'existing_map';
      log(`[edgar-sync] company_tickers 실패 — 기존 매핑으로 계속: ${shortErr(e)}`);
    }

    // ── 2. 매핑된 대상 로드 → CIK 그룹 ────────────────────────────────────
    const [mapRows] = targets.length === 0 ? [[] as MapRow[]] : await db.query<(MapRow & RowDataPacket)[]>(
      `SELECT symbol, cik, submissions_sha256, facts_sha256, facts_filed_watermark, last_attempt_at
         FROM symbol_cik_map WHERE symbol IN (?)`,
      [targets],
    );
    const groups = new Map<number, MapRow[]>();
    for (const r of mapRows as MapRow[]) {
      const cik = Number(r.cik);
      if (!Number.isSafeInteger(cik) || cik <= 0) continue;
      if (!groups.has(cik)) groups.set(cik, []);
      groups.get(cik)!.push(r);
    }
    if (res.tickersSource === 'existing_map') {
      res.unmapped = targets.filter((s) => !(mapRows as MapRow[]).some((r) => r.symbol === s));
    }
    res.mapped = (mapRows as MapRow[]).length;
    const ts = (v: MapRow['last_attempt_at']) => (v == null ? -1 : new Date(v as string).getTime());
    const order = [...groups.entries()].sort((a, b) => Math.min(...a[1].map((r) => ts(r.last_attempt_at)))
      - Math.min(...b[1].map((r) => ts(r.last_attempt_at))) || a[0] - b[0]);
    res.ciks = order.length;

    const todayEt = etDateString(now());
    let idx = 0;
    for (; idx < order.length; idx++) {
      if (now().getTime() - t0 > budget) break;
      const [cik, rows] = order[idx];
      try {
        // (C-3) 이 CIK 의 DB 쓰기(시도 시각 포함)도 전부 이 try 안 — 한 CIK 의 DB 오류가 다음 CIK 를 막지 않는다.
        await db.query(`UPDATE symbol_cik_map SET last_attempt_at = NOW() WHERE cik = ?`, [cik]);
        const out = await syncOneCik(db, client, cik, rows, todayEt);
        res.filingsUpserted! += out.filings;
        res.factsUpserted! += out.facts;
        if (out.factsFetched) res.factsFetched!++;
        if (out.unchanged) res.ciksUnchanged!++;
        if (out.nonOperating) res.nonOperating!.push(cik);
        res.estimates!.push(...out.estimates);
        res.ciksDone!++;
        await db.query(`UPDATE symbol_cik_map SET last_error = NULL WHERE cik = ?`, [cik]);
      } catch (e) {
        if (e instanceof SecBlockedError) throw e;
        const msg = shortErr(e);
        res.ciksFailed!.push({ cik, error: msg });
        await db.query(`UPDATE symbol_cik_map SET last_error = ? WHERE cik = ?`, [msg, cik]).catch(() => undefined);
      }
    }
    res.remaining = order.length - idx;
    res.partial = res.remaining > 0;
  } catch (e) {
    if (!(e instanceof SecBlockedError)) throw e;
    res.ok = false;
    res.aborted = 'sec_blocked';
    console.error(`[edgar-sync] ${e.message} — job 중단`);
  }

  res.requests = client.requestCount;
  res.durationMs = now().getTime() - t0;
  log(`[edgar-sync] done ok=${res.ok} targets=${res.targets} mapped=${res.mapped ?? 0} unmapped=${res.unmapped?.length ?? 0}`
    + ` ciks=${res.ciksDone ?? 0}/${res.ciks ?? 0} unchanged=${res.ciksUnchanged ?? 0} failed=${res.ciksFailed?.length ?? 0}`
    + ` filings=${res.filingsUpserted} facts=${res.factsUpserted} requests=${res.requests}`
    + (res.partial ? ` partial remaining=${res.remaining}` : '') + (res.aborted ? ` aborted=${res.aborted}` : '')
    + (res.unmapped?.length ? ` unmapped_list=${res.unmapped.join(',')}(cik_unmapped: ETF·SEC 미등재)` : ''));
  return res;
}

interface CikOutcome {
  filings: number;
  facts: number;
  factsFetched: boolean;
  unchanged: boolean;
  nonOperating: boolean;
  estimates: Array<{ symbol: string; window?: [string, string]; reason?: string }>;
}

async function syncOneCik(db: Queryable, client: SecClient, cik: number, rows: MapRow[], todayEt: string): Promise<CikOutcome> {
  const out: CikOutcome = { filings: 0, facts: 0, factsFetched: false, unchanged: false, nonOperating: false, estimates: [] };
  const prev = rows[0];

  // ── a. submissions ──
  const sub = await client.getJson(secSubmissionsUrl(cik));
  if (sub.status !== 200) throw new Error(`submissions HTTP ${sub.status}`);
  const parsed: ParsedSubmissions = parseSubmissions(sub.json, cik);   // 형식 이상이면 던진다 → 이 CIK 만 실패
  if (parsed.entityType && parsed.entityType !== 'operating') {
    out.nonOperating = true;
    await db.query(`UPDATE symbol_cik_map SET submissions_sha256 = ?, submissions_synced_at = NOW() WHERE cik = ?`, [sub.sha256, cik]);
    return out;
  }

  if (sub.sha256 === prev.submissions_sha256) {
    out.unchanged = true;
  } else {
    out.filings = await upsertFilings(db, parsed.filings);
    const releases = extractEarningsReleaseDates(parsed.filings);
    for (const r of rows) {
      const est = estimateNextEarningsWindow(releases, todayEt);
      if (!est.ok) { out.estimates.push({ symbol: r.symbol, reason: est.reason }); continue; }
      const [ins] = await db.query<ResultSetHeader>(
        `INSERT INTO us_earnings_events
           (symbol, cik, fiscal_period, event_date_et, window_start_et, window_end_et, event_time_class, status,
            source_kind, source_url, basis, observed_at)
         VALUES (?, ?, ?, NULL, ?, ?, 'unknown', 'estimated', 'edgar_8k_202_pattern', ?, ?, NOW())
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), cik = VALUES(cik),
           window_start_et = VALUES(window_start_et), window_end_et = VALUES(window_end_et),
           source_url = VALUES(source_url), basis = VALUES(basis), observed_at = NOW()`,
        [r.symbol, cik, est.fiscalPeriod, est.windowStart, est.windowEnd, secSubmissionsUrl(cik), JSON.stringify(est.basis)],
      );
      const id = ins?.insertId;
      if (id) {
        await db.query(
          `UPDATE us_earnings_events SET superseded_by = ?
            WHERE symbol = ? AND status = 'estimated' AND id <> ? AND superseded_by IS NULL`,
          [id, r.symbol, id],
        );
      }
      out.estimates.push({ symbol: r.symbol, window: [est.windowStart, est.windowEnd] });
    }
    await db.query(`UPDATE symbol_cik_map SET submissions_sha256 = ?, submissions_synced_at = NOW() WHERE cik = ?`, [sub.sha256, cik]);
  }

  // ── b. companyfacts — filed 워터마크 기준 증분 ──
  const trigger = latestTriggerFiling(parsed.filings);
  const watermark = dateStr(prev.facts_filed_watermark);
  const needFacts = watermark == null || (trigger != null && trigger.filed > watermark);
  if (!needFacts) return out;

  const facts = await client.getJson(secCompanyFactsUrl(cik));
  out.factsFetched = true;
  if (facts.status === 200 && facts.sha256 !== prev.facts_sha256) {
    const factRows = extractFramedFacts(facts.json, cik);   // 형식 이상이면 던진다(워터마크 유지 → 다음 날 재시도)
    out.facts = await upsertFacts(db, factRows);
  }
  const decision = decideFactsWatermark({
    trigger,
    fetched: facts.status === 200 ? { json: facts.json } : null,
    todayEt,
  });
  if (decision.warn) {
    console.warn(`[edgar-sync] companyfacts 반영 확인 안 됨 — cik=${cik} symbols=${rows.map((r) => r.symbol).join(',')} `
      + `사유=${decision.warn} (접수 ${FACTS_REFLECT_GRACE_DAYS}일 경과 → 워터마크 전진)`);
  }
  await db.query(
    `UPDATE symbol_cik_map SET facts_sha256 = ?, facts_filed_watermark = ?, facts_synced_at = NOW() WHERE cik = ?`,
    [facts.status === 200 ? facts.sha256 : null, decision.advance ? decision.watermark : (watermark ?? null), cik],
  );
  return out;
}

/** (C-1) 새 정기보고서가 companyfacts 에 반영되기를 기다리는 최대 일수. 넘으면 워터마크를 올리고 경고한다(무한 재시도 방지). */
export const FACTS_REFLECT_GRACE_DAYS = 10;

/** submissions 의 정기보고서(10-Q·10-K 등) 중 가장 늦게 접수된 것(같은 날이면 accession 이 큰 쪽). 없으면 null. */
export function latestTriggerFiling(filings: FilingRow[]): FilingRow | null {
  let best: FilingRow | null = null;
  for (const f of filings) {
    if (!FACTS_TRIGGER_FORMS.has(f.form)) continue;
    if (!best || f.filed > best.filed || (f.filed === best.filed && f.accession > best.accession)) best = f;
  }
  return best;
}

/** companyfacts JSON 어딘가에 이 accession 을 단 사실이 하나라도 있는가(전 taxonomy·태그·단위, 찾으면 바로 끝). */
export function factsContainAccession(json: unknown, accession: string): boolean {
  const facts = (json as { facts?: Record<string, Record<string, { units?: Record<string, unknown> }>> } | null)?.facts;
  if (!facts || typeof facts !== 'object') return false;
  for (const tax of Object.values(facts)) {
    if (!tax || typeof tax !== 'object') continue;
    for (const node of Object.values(tax)) {
      const units = node?.units;
      if (!units || typeof units !== 'object') continue;
      for (const arr of Object.values(units)) {
        if (!Array.isArray(arr)) continue;
        for (const x of arr) if (x && (x as { accn?: unknown }).accn === accession) return true;
      }
    }
  }
  return false;
}

/**
 * (C-1, Codex C2 high) companyfacts 워터마크를 올릴지 정한다 — **트리거 보고서가 실제로 facts 에 반영됐을 때만** 올린다.
 *  - 트리거(정기보고서)가 없다: 기존 동작 — 오늘(ET)로 올린다(다음 정기보고서가 나올 때까지 재호출 안 함).
 *  - 트리거가 있다: 받은 facts 에 그 accession 의 사실이 있으면 트리거 접수일로 올린다.
 *    본문이 그대로(SHA 동일)이거나 404 이거나 accession 이 없으면 **올리지 않는다**(SEC 반영 지연 — 다음 날 재요청).
 *    단 트리거 접수일로부터 10일이 지났으면 올리고 경고한다(XBRL 없는 보고서 등으로 영원히 반영되지 않는 경우).
 * "SHA 가 바뀌었다"만으로는 올리지 않는다 — 다른 제출(정정·8-K XBRL)이 먼저 반영돼 바뀐 것일 수 있다(지시보다 엄격하게 구현).
 */
export function decideFactsWatermark(input: {
  trigger: Pick<FilingRow, 'accession' | 'filed'> | null;
  fetched: { json: unknown } | null;   // null = 404
  todayEt: string;
}): { advance: boolean; watermark: string | null; warn?: string } {
  const { trigger, fetched, todayEt } = input;
  if (!trigger) return { advance: true, watermark: todayEt };
  if (fetched && factsContainAccession(fetched.json, trigger.accession)) return { advance: true, watermark: trigger.filed };
  if (daysBetween(trigger.filed, todayEt) >= FACTS_REFLECT_GRACE_DAYS) {
    return { advance: true, watermark: trigger.filed, warn: fetched ? `trigger_accession_absent:${trigger.accession}` : 'companyfacts_404' };
  }
  return { advance: false, watermark: null };
}

export async function upsertFilings(db: Queryable, filings: FilingRow[]): Promise<number> {
  if (filings.length === 0) return 0;
  const values = filings.map((f) => [
    f.accession, f.cik, f.form, f.items, f.reportDate, f.filed,
    f.acceptedAtUtc ? toKstDatetime(new Date(f.acceptedAtUtc)) : null,   // UTC → KST 벽시계(T-046)
    f.primaryDocUrl, f.isEarningsRelease ? 1 : 0,
  ]);
  await db.query(
    `INSERT INTO us_filings (accession, cik, form, items, report_date, filed, accepted_at, primary_doc_url, is_earnings_release)
     VALUES ?
     ON DUPLICATE KEY UPDATE form = VALUES(form), items = VALUES(items), report_date = VALUES(report_date),
       filed = VALUES(filed), accepted_at = VALUES(accepted_at), primary_doc_url = VALUES(primary_doc_url),
       is_earnings_release = VALUES(is_earnings_release)`,
    [values],
  );
  return filings.length;
}

/**
 * (C-4) 덮어쓰기 조건 — `xbrl-facts.ts` 추출과 **같은 우선순위**: 더 늦은 filed, 같은 filed 면 accession 이 같거나 큰 쪽.
 * 모든 대상 열이 이 조건 하나를 쓴다. MariaDB 는 ON DUPLICATE KEY UPDATE 대입을 **왼쪽부터** 적용하고 뒤 식은 갱신된 값을 보므로
 * 조건이 참조하는 `accn`·`filed` 는 맨 뒤(accn → filed 순)에 대입한다. filed 는 GREATEST 라 accn 갱신과 무관하다.
 */
export const FACT_OVERWRITE_COND = '(VALUES(filed) > filed OR (VALUES(filed) = filed AND VALUES(accn) >= accn))';
const FACT_COND_COLUMNS = ['period_start', 'period_end', 'val', 'fy', 'fp', 'form', 'accn'] as const;

export async function upsertFacts(db: Queryable, rows: FactRow[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += FACTS_CHUNK) {
    const chunk = rows.slice(i, i + FACTS_CHUNK);
    const values = chunk.map((r) => [
      r.cik, r.taxonomy, r.tag, r.unit, r.frame, r.periodStart, r.periodEnd, r.val, r.fy, r.fp, r.form, r.filed, r.accn,
    ]);
    await db.query(
      `INSERT INTO us_financial_facts (cik, taxonomy, tag, unit, frame, period_start, period_end, val, fy, fp, form, filed, accn)
       VALUES ?
       ON DUPLICATE KEY UPDATE
         ${FACT_COND_COLUMNS.map((c) => `${c} = IF(${FACT_OVERWRITE_COND}, VALUES(${c}), ${c})`).join(',\n         ')},
         filed = GREATEST(filed, VALUES(filed))`,
      [values],
    );
    n += chunk.length;
  }
  return n;
}
