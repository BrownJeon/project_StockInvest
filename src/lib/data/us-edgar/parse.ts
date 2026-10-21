/**
 * SEC 응답 파서 — 순수 함수(네트워크·DB 없음) (T-059 Part A).
 *
 * 규칙: 형식이 기대와 다르면 **던진다**(`EdgarParseError`). 0·빈 값으로 채워 넣지 않는다(T-056 원칙).
 * 호출부(`sync-job.ts`)가 종목 단위로 잡아서 그 종목만 건너뛴다.
 */
import { isOverseasSymbol, parseOverseas } from '@/lib/exchanges/kis-symbols';

export class EdgarParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EdgarParseError';
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ACCN_RE = /^\d{10}-\d{2}-\d{6}$/;

// ── company_tickers.json ─────────────────────────────────────────────────────

export interface TickerEntry { cik: number; title: string }

/**
 * `{"0":{"cik_str":1045810,"ticker":"NVDA","title":"NVIDIA CORP"}, ...}` → ticker(대문자) → {cik,title}.
 * 같은 티커가 두 번 나오면(관측된 적 없음) 먼저 나온 것을 쓴다. 항목 하나가 이상하면 그 항목만 버린다.
 * 전체가 객체가 아니거나 유효 항목이 0개면 던진다(빈 매핑으로 기존 매핑을 덮지 않게).
 */
export function parseCompanyTickers(json: unknown): Map<string, TickerEntry> {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new EdgarParseError('company_tickers: 객체가 아님');
  const out = new Map<string, TickerEntry>();
  for (const v of Object.values(json as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const cik = typeof o.cik_str === 'number' ? o.cik_str : Number(o.cik_str);
    const ticker = typeof o.ticker === 'string' ? o.ticker.trim().toUpperCase() : '';
    if (!Number.isSafeInteger(cik) || cik <= 0 || !ticker) continue;
    if (!out.has(ticker)) out.set(ticker, { cik, title: typeof o.title === 'string' ? o.title.slice(0, 200) : '' });
  }
  if (out.size === 0) throw new EdgarParseError('company_tickers: 유효 항목 0개');
  return out;
}

/**
 * 앱 심볼 → SEC 티커. 'NAS:AAPL' → 'AAPL', 'NYS:BRK.B' → 'BRK-B'(SEC 는 클래스 구분자를 '-' 로 쓴다 — 실측 BRK-B).
 * 해외 심볼이 아니면 null.
 */
export function toSecTicker(symbol: string): string | null {
  if (!isOverseasSymbol(symbol)) return null;
  return parseOverseas(symbol).ticker.toUpperCase().replace(/[./]/g, '-');
}

// ── submissions ──────────────────────────────────────────────────────────────

/** 적재하는 양식. 나머지(Form 4·13F·S-8 등)는 버린다 — 실적·재무 판단과 무관하고 행 수만 늘린다. */
export const KEPT_FORMS = new Set([
  '8-K', '8-K/A', '10-Q', '10-Q/A', '10-K', '10-K/A', '20-F', '20-F/A', '40-F', '40-F/A', '6-K', '6-K/A',
]);
/** companyfacts 를 다시 받아야 하는 양식(새 XBRL 재무값이 생기는 정기 보고서). */
export const FACTS_TRIGGER_FORMS = new Set(['10-Q', '10-Q/A', '10-K', '10-K/A', '20-F', '20-F/A', '40-F', '40-F/A']);

export interface FilingRow {
  accession: string;
  cik: number;
  form: string;
  items: string;              // '2.02,9.01' 원문 그대로(빈 문자열 가능)
  reportDate: string | null;  // YYYY-MM-DD
  filed: string;              // YYYY-MM-DD (SEC filingDate — 미국 동부 기준 접수일, 시각 없음)
  acceptedAtUtc: string | null; // ISO 원문(…Z). SEC 는 UTC 로 준다(실측: INTC 장 마감 후 8-K = 20:09Z = 16:09 EDT)
  primaryDocUrl: string | null;
  isEarningsRelease: boolean; // 8-K(원본) + items 에 2.02
}

export interface ParsedSubmissions {
  cik: number;
  name: string;
  entityType: string;
  tickers: string[];
  fiscalYearEnd: string | null;
  filings: FilingRow[];
}

/** items 문자열에 2.02(Results of Operations and Financial Condition)가 있는가. '12.02' 같은 오탐을 막는다. */
export function hasItem202(items: string): boolean {
  return items.split(',').map((s) => s.trim()).includes('2.02');
}

/**
 * submissions JSON → 필요한 양식만. `filings.recent` 의 병렬 배열 길이가 서로 다르면 던진다.
 * 개별 행의 accession·filingDate 형식이 틀리면 그 행만 버린다(다른 행은 정상 적재).
 * `filings.files`(오래된 페이지)는 받지 않는다 — recent 만으로 수년(실측 INTC 2019~)이 나온다.
 */
export function parseSubmissions(json: unknown, expectedCik: number): ParsedSubmissions {
  if (!json || typeof json !== 'object') throw new EdgarParseError('submissions: 객체가 아님');
  const s = json as Record<string, unknown>;
  const cik = Number(s.cik);
  if (!Number.isSafeInteger(cik) || cik !== expectedCik) throw new EdgarParseError(`submissions: cik 불일치 (${String(s.cik)})`);
  const filings = s.filings as Record<string, unknown> | undefined;
  const r = filings?.recent as Record<string, unknown> | undefined;
  if (!r || typeof r !== 'object') throw new EdgarParseError('submissions: filings.recent 없음');
  const cols = ['accessionNumber', 'filingDate', 'reportDate', 'acceptanceDateTime', 'form', 'items', 'primaryDocument'] as const;
  const arrs: Record<string, unknown[]> = {};
  for (const c of cols) {
    const a = r[c];
    if (!Array.isArray(a)) throw new EdgarParseError(`submissions: recent.${c} 가 배열이 아님`);
    arrs[c] = a;
  }
  const n = arrs.accessionNumber.length;
  if (cols.some((c) => arrs[c].length !== n)) throw new EdgarParseError('submissions: recent 배열 길이 불일치');

  const out: FilingRow[] = [];
  const archiveBase = `https://www.sec.gov/Archives/edgar/data/${cik}`;
  for (let i = 0; i < n; i++) {
    const form = String(arrs.form[i] ?? '').trim();
    if (!KEPT_FORMS.has(form)) continue;
    const accession = String(arrs.accessionNumber[i] ?? '').trim();
    const filed = String(arrs.filingDate[i] ?? '').trim();
    if (!ACCN_RE.test(accession) || !DATE_RE.test(filed)) continue;
    const rd = String(arrs.reportDate[i] ?? '').trim();
    const acc = String(arrs.acceptanceDateTime[i] ?? '').trim();
    const items = String(arrs.items[i] ?? '').trim().slice(0, 128);
    const doc = String(arrs.primaryDocument[i] ?? '').trim();
    out.push({
      accession,
      cik,
      form,
      items,
      reportDate: DATE_RE.test(rd) ? rd : null,
      filed,
      acceptedAtUtc: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(acc) ? acc : null,
      primaryDocUrl: doc && /^[\w.\-]+$/.test(doc) ? `${archiveBase}/${accession.replace(/-/g, '')}/${doc}` : null,
      isEarningsRelease: form === '8-K' && hasItem202(items),
    });
  }
  return {
    cik,
    name: typeof s.name === 'string' ? s.name.slice(0, 200) : '',
    entityType: typeof s.entityType === 'string' ? s.entityType : '',
    tickers: Array.isArray(s.tickers) ? s.tickers.filter((t): t is string => typeof t === 'string') : [],
    fiscalYearEnd: typeof s.fiscalYearEnd === 'string' && /^\d{4}$/.test(s.fiscalYearEnd) ? s.fiscalYearEnd : null,
    filings: out,
  };
}

/**
 * 과거 실적 발표일 목록(오름차순, YYYY-MM-DD).
 *
 * - 원본 8-K 의 items 에 2.02 가 있는 행의 **filingDate** 를 쓴다. reportDate 는 쓰지 않는다 — 다른 사건(2.05 등)과 묶인 8-K 는
 *   reportDate 가 그 사건일로 앞당겨진다(실측: INTC 2024 Q3 발표 8-K reportDate 2024-10-28, filingDate 2024-10-31 = 실제 발표일).
 * - 8-K/A(정정)는 새 발표가 아니므로 뺀다.
 * - 21일 안에 2건 이상이면 **나중 것 하나**만 남긴다 — 예비 실적(prelim) 뒤에 정식 발표가 오는 경우
 *   (실측: INTC 2021-01-14 예비 + 2021-01-21 정식).
 */
export function extractEarningsReleaseDates(filings: FilingRow[]): string[] {
  const dates = [...new Set(filings.filter((f) => f.isEarningsRelease).map((f) => f.filed))].sort();
  const out: string[] = [];
  for (const d of dates) {
    const prev = out[out.length - 1];
    if (prev && daysBetween(prev, d) <= 21) out[out.length - 1] = d;
    else out.push(d);
  }
  return out;
}

// ── 날짜 산술 (YYYY-MM-DD, 시간대 없음) ─────────────────────────────────────

export function toDayNumber(d: string): number {
  if (!DATE_RE.test(d)) throw new EdgarParseError(`날짜 형식 아님: ${d}`);
  const [y, m, dd] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, dd) / 86_400_000;
}
export function fromDayNumber(n: number): string {
  return new Date(n * 86_400_000).toISOString().slice(0, 10);
}
export function addDays(d: string, days: number): string {
  return fromDayNumber(toDayNumber(d) + days);
}
export function daysBetween(a: string, b: string): number {
  return toDayNumber(b) - toDayNumber(a);
}

/** 지금의 미국 동부(America/New_York) 현지 날짜 YYYY-MM-DD. DST 는 Intl 이 처리한다. */
export function etDateString(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
