/**
 * 보유 종목 개장 전 공시 체크포인트 (T-119 — 2차 설계 단계 4 대체안 "B"). **기록·알림 재료 전용** — 주문·시그널·분석 입력과 무관.
 *
 * 라우트 `src/app/api/cron/holdings-premarket/route.ts` 가 하루 1회(ET 08:00, 러너가 America/New_York 로 계산) 부른다.
 * 역할 나눔(경계 시험 `__tests__/isolation.test.ts`):
 *  - **라우트**: 인증·보유 목록(DB 스냅샷) 읽기·CIK 매핑 읽기·SEC 호출(`SecClient`)·알림 발송(`dispatchAlert`).
 *  - **이 모듈**: 스위치 판독·스냅샷 보유 목록 해석(순수)·24시간 창 후보 선별(순수)·"새 공시" 판정과 `ci_raw_item` 기록·
 *    상태 키 기록·알림 문구(순수). 네트워크·알림·거래 모듈을 import 하지 않는다(T-116 격리 규칙 그대로).
 *
 * ## 쓰기
 *  - `ci_raw_item`(`source_kind='sec_filing'`) — T-116 의 `CI_RAW_ITEM_UPSERT_SQL`(ON DUPLICATE KEY UPDATE last_seen_at 만 —
 *    `first_seen_at` 은 덮어쓰지 않는다)을 그대로 쓴다.
 *  - `system_config` 의 `holdings_premarket_status` 한 키.
 *  - 🔴 `us_filings` 에는 쓰지 않는다(07:00 edgar-sync 수집과 08:00 분석 입력 불변 → 관찰 기준선 불변). 읽기(접수번호 존재 확인)만 한다.
 *
 * ## source_key (설계서 §6.2 "SEC 공시 = 접수번호")
 * `source_key` = 접수번호 원문(`0000320193-26-000010` — `^\d{10}-\d{2}-\d{6}$` 검증 통과분만). 해시를 쓰지 않는 이유: 설계서 §6.2 가
 * SEC 공시 키를 접수번호로 정해 두었고, 단계 2 의 `us_filings` → `ci_raw_item` 리더(§6.1 (C))가 같은 키를 쓰면 이 task 가 남긴 행과
 * 자연히 한 행으로 묶인다(접수번호는 SEC 가 전역 유일로 부여한다). 길이 20자 — `source_key VARCHAR(190)` 안.
 *
 * ## "새 공시" 판정 (task 설계 4·5)
 * 후보 = 접수 시각(SEC acceptanceDateTime, UTC)이 (지금 − 24시간, 지금 + 10분] 안. 그중
 *   ① `us_filings` 에 그 접수번호가 없고 ② `ci_raw_item(sec_filing)` 에도 없던 것 → INSERT 가 **새 행을 만들었을 때만** "새 공시".
 * ②는 INSERT 직전 SELECT 와 INSERT 결과(affectedRows = 1) **둘 다**로 판정한다 — mysql2 는 FOUND_ROWS 플래그가 기본이라 같은 초에
 * 다시 본 기존 행도 affectedRows 1 을 줄 수 있다(T-116 Reviewer L-1). 미리 있던 키는 affectedRows 와 무관하게 "새 공시 아님".
 * 접수 시각이 없거나 해석할 수 없는 공시는 창에 넣을 수 없으므로 후보에서 뺀다(`noAcceptance` 로 센다 — 시각을 지어내지 않는다).
 *
 * **절대 던지지 않는다** — DB 오류는 결과 객체의 상태로 돌려준다.
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { toKstDatetime } from '@/lib/time';
import { sha256Hex } from './keys';
import { CI_RAW_ITEM_UPSERT_SQL, captureSwitchValueEnabled, isNoSuchTable } from './raw-capture';

export const HP_SWITCH_KEY = 'holdings_premarket_enabled';
export const HP_STATUS_KEY = 'holdings_premarket_status';
/** ci_raw_item.parser_version VARCHAR(24) */
export const HP_PARSER_VERSION = 't119-sec-premarket';
/** 새 공시 창 — 접수 시각이 최근 24시간 안(첫 실행에서 과거 공시가 쏟아지지 않게). */
export const HP_WINDOW_MS = 24 * 60 * 60_000;
/** 시계 차이 허용 — 접수 시각이 지금보다 이만큼 넘게 미래면 버린다. */
export const HP_FUTURE_SKEW_MS = 10 * 60_000;
/** 보유 스냅샷이 이보다 오래되면 건너뛴다(`stale_holdings`). 스냅샷은 60분 주기(장 닫힘 + 90분 안 스냅샷이면 생략 → 실측 간격 최대 약 2시간). */
export const HP_STALE_HOLDINGS_MS = 3 * 60 * 60_000;
/** SEC 요청 상한(재시도 포함, 실행 1회) — 보유 약 3~5 + 여유. */
export const HP_MAX_REQUESTS = 8;
/** 한 번에 보내는 개별 알림 상한 — 넘으면 요약 1건만. */
export const HP_MAX_ALERTS = 10;
/** 연속 실패(failed·blocked) 몇 번째부터 실패 알림을 내는가(하루 1회 실행 → 연속 2일). */
export const HP_FAILURE_ALERT_AFTER = 2;

const LOG = '[corp-intel/holdings-premarket]';
const ACCN_RE = /^\d{10}-\d{2}-\d{6}$/;
/** 앱의 해외 심볼(`NAS:AAPL`·`NYS:BRK.B`·`AMS:SPY`) — kis-symbols 의 해외 형식 중 미국 거래소 3개만. */
const US_SYMBOL_RE = /^(NAS|NYS|AMS):[A-Z][A-Z0-9.]*$/;
/** 양식 이름 꼴 — 라우트가 `us_filings` 와 같은 양식 집합(KEPT_FORMS)으로 이미 거른다. 여기서는 형식만 한 번 더 본다. */
const FORM_RE = /^[A-Z0-9][A-Z0-9/ -]{0,15}$/;

export type HpStatus =
  | 'ok' | 'blocked' | 'failed' | 'no_holdings' | 'stale_holdings' | 'skipped_no_table' | 'no_user_agent' | 'switch_off';

// ─────────────────────────────────────────────────────────────────────────────
// 스위치
// ─────────────────────────────────────────────────────────────────────────────

/** `holdings_premarket_enabled` — 키 없음·해석 불가·읽기 오류 = 꺼짐, 정확히 JSON `true` 만 켜짐(T-116 과 같은 판정). 던지지 않는다. */
export async function readPremarketSwitch(): Promise<{ enabled: boolean; source: 'missing' | 'value' | 'read_error' }> {
  try {
    const [rows] = await getPool().query<(RowDataPacket & { value: unknown })[]>(
      'SELECT value FROM system_config WHERE `key` = ? LIMIT 1',
      [HP_SWITCH_KEY],
    );
    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row) return { enabled: false, source: 'missing' };
    return { enabled: captureSwitchValueEnabled(row.value), source: 'value' };
  } catch (e) {
    console.warn(`${LOG} 스위치(${HP_SWITCH_KEY}) 읽기 실패 — 꺼짐으로 본다: ${e instanceof Error ? e.message : String(e)}`);
    return { enabled: false, source: 'read_error' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 보유 목록 — 스냅샷 positions 해석(순수)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `portfolio_snapshots.positions`(JSON 문자열 또는 배열 — `[{currency:'KRW'…},{currency:'USD'…},{currency:'NAS:AAPL', qty, price, value_krw}]`)
 * → 보유 미국 심볼(중복 제거·정렬). 현금 행(KRW·USD)·국내 6자리·수량 0 이하·형식 밖은 버린다. 손상이면 빈 배열.
 */
export function usHoldingsFromPositions(raw: unknown): string[] {
  let v: unknown = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return []; }
  }
  if (!Array.isArray(v)) return [];
  const out = new Set<string>();
  for (const p of v) {
    if (!p || typeof p !== 'object') continue;
    const sym = (p as { currency?: unknown }).currency;
    const qty = Number((p as { qty?: unknown }).qty);
    if (typeof sym !== 'string' || !US_SYMBOL_RE.test(sym)) continue;
    if (!Number.isFinite(qty) || qty <= 0) continue;
    out.add(sym);
  }
  return [...out].sort();
}

/** 스냅샷 시각이 기준보다 오래됐는가(시각을 모르면 오래된 것으로 본다). */
export function isSnapshotStale(snapshotAt: Date | null, now: Date): boolean {
  if (!snapshotAt || Number.isNaN(snapshotAt.getTime())) return true;
  return now.getTime() - snapshotAt.getTime() > HP_STALE_HOLDINGS_MS;
}

// ─────────────────────────────────────────────────────────────────────────────
// 후보 선별(순수)
// ─────────────────────────────────────────────────────────────────────────────

/** 라우트가 SEC submissions 를 `parseSubmissions`(us_filings 와 같은 양식 집합)로 해석해 넘기는 한 건. */
export interface PremarketFilingInput {
  /** 이 CIK 를 가진 보유 심볼(GOOG·GOOGL 처럼 둘 이상일 수 있다) */
  symbols: string[];
  cik: number;
  accession: string;
  form: string;
  items: string;
  /** SEC filingDate(동부 접수일) */
  filed: string;
  /** SEC acceptanceDateTime ISO(…Z) — 없으면 null */
  acceptedAtUtc: string | null;
  primaryDocUrl: string | null;
}

export interface PremarketCandidate extends PremarketFilingInput {
  acceptedAt: Date;
  url: string;
  isEarningsRelease: boolean;
}

/** items 문자열에 2.02(실적 발표)가 있는가 — '12.02' 오탐 방지(parse.ts hasItem202 와 같은 규칙). */
export function itemsHas202(items: unknown): boolean {
  return typeof items === 'string' && items.split(',').map((s) => s.trim()).includes('2.02');
}

/** SEC 문서 링크 — 주 문서가 없으면 접수 폴더. 저장·알림 표시만 하고 요청은 보내지 않는다. */
export function filingUrl(f: Pick<PremarketFilingInput, 'cik' | 'accession' | 'primaryDocUrl'>): string {
  const doc = f.primaryDocUrl;
  if (typeof doc === 'string' && /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/\d+\/\d{18}\/[\w.-]+$/.test(doc)) return doc;
  return `https://www.sec.gov/Archives/edgar/data/${f.cik}/${f.accession.replace(/-/g, '')}/`;
}

/**
 * 24시간 창 안의 후보만 고른다(같은 접수번호는 한 번만). 접수 시각이 없거나 해석 불가·미래(10분 초과)면 버린다.
 * 반환 `noAcceptance` = 접수 시각이 없거나 해석 불가해 판정하지 못한 건수.
 */
export function selectPremarketCandidates(
  filings: readonly PremarketFilingInput[], now: Date,
): { candidates: PremarketCandidate[]; outOfWindow: number; noAcceptance: number; invalid: number } {
  const nowMs = now.getTime();
  const seen = new Set<string>();
  const candidates: PremarketCandidate[] = [];
  let outOfWindow = 0;
  let noAcceptance = 0;
  let invalid = 0;
  for (const f of filings) {
    if (!f || typeof f.accession !== 'string' || !ACCN_RE.test(f.accession) || typeof f.form !== 'string' || !FORM_RE.test(f.form)
      || !Number.isSafeInteger(f.cik) || f.cik <= 0 || !Array.isArray(f.symbols) || f.symbols.length === 0) {
      invalid++;
      continue;
    }
    if (seen.has(f.accession)) continue;
    const acc = typeof f.acceptedAtUtc === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(f.acceptedAtUtc)
      ? new Date(f.acceptedAtUtc) : null;
    if (!acc || Number.isNaN(acc.getTime())) { noAcceptance++; continue; }
    const t = acc.getTime();
    if (t <= nowMs - HP_WINDOW_MS || t > nowMs + HP_FUTURE_SKEW_MS) { outOfWindow++; continue; }
    seen.add(f.accession);
    candidates.push({
      ...f,
      symbols: [...new Set(f.symbols)].sort(),
      acceptedAt: acc,
      url: filingUrl(f),
      isEarningsRelease: f.form === '8-K' && itemsHas202(f.items),
    });
  }
  candidates.sort((a, b) => a.acceptedAt.getTime() - b.acceptedAt.getTime() || a.accession.localeCompare(b.accession));
  return { candidates, outOfWindow, noAcceptance, invalid };
}

// ─────────────────────────────────────────────────────────────────────────────
// 판정·기록 — us_filings 읽기 + ci_raw_item 기록
// ─────────────────────────────────────────────────────────────────────────────

export interface RecordPremarketResult {
  /** 'ok' | 'skipped_no_table'(us_filings·ci_raw_item 없음) | 'failed'(DB 오류) */
  status: 'ok' | 'skipped_no_table' | 'failed';
  /** 새로 기록된(= 알릴) 공시 */
  fresh: PremarketCandidate[];
  inUsFilings: number;
  alreadyCaptured: number;
  insertFailed: number;
  missingTable?: string;
}

/** `ci_raw_item` 한 행의 값(CI_RAW_ITEM_UPSERT_SQL 열 순서). */
export function premarketRowValues(c: PremarketCandidate, now: Date): unknown[] {
  const seen = toKstDatetime(now);
  const title = `${c.form} ${c.symbols.join(',')}`.slice(0, 400);
  const content = sha256Hex(JSON.stringify([c.accession, c.cik, c.form, c.items, c.filed, c.acceptedAtUtc, c.url]));
  return ['sec_filing', c.accession, 1, content, 'captured', toKstDatetime(c.acceptedAt), seen, seen, c.url, null, null, title, HP_PARSER_VERSION];
}

/**
 * 후보 → 새 공시. ① `us_filings` 에 있으면 제외(07:00 수집이 이미 본 것) ② `ci_raw_item(sec_filing)` 에 이미 있으면 제외 ③ 나머지를 한 건씩
 * INSERT(ODKU last_seen_at) — 새 행이면 fresh. 테이블이 없으면 `skipped_no_table`(fresh 없음 = 알림 없음). 던지지 않는다.
 */
export async function recordPremarketFilings(candidates: readonly PremarketCandidate[], now: Date): Promise<RecordPremarketResult> {
  const res: RecordPremarketResult = { status: 'ok', fresh: [], inUsFilings: 0, alreadyCaptured: 0, insertFailed: 0 };
  if (candidates.length === 0) return res;
  const pool = getPool();
  const keys = candidates.map((c) => c.accession);

  let inUs: Set<string>;
  try {
    const [rows] = await pool.query<(RowDataPacket & { accession: string })[]>(
      'SELECT accession FROM us_filings WHERE accession IN (?)', [keys],
    );
    inUs = new Set((rows ?? []).map((r) => String(r.accession)));
  } catch (e) {
    if (isNoSuchTable(e)) return { ...res, status: 'skipped_no_table', missingTable: 'us_filings' };
    console.warn(`${LOG} us_filings 읽기 실패: ${e instanceof Error ? e.message : String(e)}`);
    return { ...res, status: 'failed' };
  }
  const rest = candidates.filter((c) => !inUs.has(c.accession));
  res.inUsFilings = candidates.length - rest.length;
  if (rest.length === 0) return res;

  let existed: Set<string>;
  try {
    const [rows] = await pool.query<(RowDataPacket & { source_key: string })[]>(
      "SELECT source_key FROM ci_raw_item WHERE source_kind = 'sec_filing' AND version = 1 AND source_key IN (?)",
      [rest.map((c) => c.accession)],
    );
    existed = new Set((rows ?? []).map((r) => String(r.source_key)));
  } catch (e) {
    if (isNoSuchTable(e)) return { ...res, status: 'skipped_no_table', missingTable: 'ci_raw_item' };
    console.warn(`${LOG} ci_raw_item 읽기 실패: ${e instanceof Error ? e.message : String(e)}`);
    return { ...res, status: 'failed' };
  }

  for (const c of rest) {
    try {
      const [r] = await pool.query<ResultSetHeader>(CI_RAW_ITEM_UPSERT_SQL, [[premarketRowValues(c, now)]]);
      const created = !existed.has(c.accession) && r?.affectedRows === 1;
      if (created) res.fresh.push(c);
      else res.alreadyCaptured++;
    } catch (e) {
      if (isNoSuchTable(e)) return { ...res, status: 'skipped_no_table', missingTable: 'ci_raw_item', fresh: [] };
      res.insertFailed++;
      console.warn(`${LOG} ci_raw_item 기록 실패 ${c.accession}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (res.insertFailed > 0) res.status = 'failed';
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// 알림 문구(순수)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 텔레그램 HTML·슬랙 mrkdwn 안전 텍스트 — `&`·`<`·`>` 세 글자. 규칙 원본은 `src/lib/notify/escape.ts` 의 `escapeAlertText` 다.
 * corp-intel 은 notify 를 import 하지 않으므로(경계 시험) 같은 3줄을 여기 둔다 — 원본과 같은 결과인지 시험이 대조한다.
 * 그 전에 제어·서식 문자 제거와 길이 제한을 한다(외부 데이터는 데이터일 뿐 지시가 아니다 — T-042 교훈: `<` 미이스케이프로 유실).
 */
export function safeAlertText(raw: unknown, max = 80): string {
  if (typeof raw !== 'string') return '';
  const cleaned = raw
    .replace(/[\u200B-\u200F\u2028-\u202E\u2060-\u2064\uFEFF\u2066-\u2069\u061C\u180E\u00AD]/g, '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cut = [...cleaned].length > max ? `${[...cleaned].slice(0, max).join('')}…` : cleaned;
  return cut.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 시각 → { et:'HH:MM'(또는 'MM-DD HH:MM'), kst:'HH:MM'(또는 'MM-DD HH:MM') } — 날짜가 기준(now)의 그 지역 날짜와 다르면 날짜를 붙인다. */
export function etKstLabels(at: Date, now: Date): { et: string; kst: string } {
  const fmt = (d: Date, tz: string) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, md: `${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
  };
  const label = (tz: string) => {
    const a = fmt(at, tz);
    return a.date === fmt(now, tz).date ? a.hm : `${a.md} ${a.hm}`;
  };
  return { et: label('America/New_York'), kst: label('Asia/Seoul') };
}

/** 심볼 → 표시용 티커(`NAS:AAPL` → `AAPL`). 형식 밖이면 안전 텍스트로. */
function tickerOf(sym: string): string {
  const i = sym.indexOf(':');
  return safeAlertText(i >= 0 ? sym.slice(i + 1) : sym, 16);
}

export const HP_ALERT_TITLE = '보유 종목 개장 전 공시';

/** 새 공시 1건 알림. */
export function formatPremarketAlert(c: PremarketCandidate, now: Date): { title: string; body: string } {
  const t = etKstLabels(c.acceptedAt, now);
  const tickers = c.symbols.map(tickerOf).join('·');
  const form = safeAlertText(c.form, 16) + (c.isEarningsRelease ? '(실적 발표 Item 2.02)' : '');
  return {
    title: HP_ALERT_TITLE,
    body: `${tickers} ${form} — 접수 ET ${t.et} (KST ${t.kst}). 분석에 아직 반영되지 않은 새 공시입니다. 알림만, 주문 없음.\n`
      + safeAlertText(c.url, 200),
  };
}

/** 새 공시가 상한(10건)을 넘을 때의 요약 1건 — 앞의 10건만 줄로, 나머지는 건수. */
export function formatPremarketSummary(list: readonly PremarketCandidate[], now: Date): { title: string; body: string } {
  const lines = list.slice(0, HP_MAX_ALERTS).map((c) => {
    const t = etKstLabels(c.acceptedAt, now);
    return `• ${c.symbols.map(tickerOf).join('·')} ${safeAlertText(c.form, 16)}${c.isEarningsRelease ? '(실적 Item 2.02)' : ''} — ET ${t.et}`;
  });
  const more = list.length > HP_MAX_ALERTS ? `\n… 외 ${list.length - HP_MAX_ALERTS}건` : '';
  return {
    title: `${HP_ALERT_TITLE} ${list.length}건(요약)`,
    body: `새 공시가 ${list.length}건이라 요약 1건으로 보냅니다. 알림만, 주문 없음.\n${lines.join('\n')}${more}\n`
      + '원문은 SEC EDGAR 에서 종목별로 확인하세요(ci_raw_item 에 링크 저장됨).',
  };
}

/** 연속 실패 알림. */
export function formatPremarketFailureAlert(s: HpStatusValue): { title: string; body: string } {
  return {
    title: '보유 종목 개장 전 공시 확인 실패',
    body: `${s.consecutiveFailures}일 연속 확인하지 못했습니다(마지막 상태 ${safeAlertText(s.status, 20)}`
      + `${s.detail ? `, ${safeAlertText(s.detail, 120)}` : ''}). 알림만, 주문·분석과 무관합니다. `
      + '끄려면 system_config.holdings_premarket_enabled 를 false 로.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 상태 — system_config.holdings_premarket_status
// ─────────────────────────────────────────────────────────────────────────────

export interface HpStatusValue {
  /** KST 벽시계 */
  lastAt: string;
  status: HpStatus;
  holdings: number;
  /** SEC 를 실제로 조회한 CIK 수 */
  checked: number;
  newFilings: number;
  alerted: number;
  consecutiveFailures: number;
  /** 짧은 사유(오류 종류·상한 등, 비밀·원문 없음) */
  detail?: string;
  /** 실패 알림을 마지막으로 보낸 ET 날짜(같은 날 두 번 보내지 않는다) */
  failureAlertEtDate?: string;
}

export interface HpStatusInput {
  status: HpStatus;
  holdings: number;
  checked: number;
  newFilings: number;
  alerted: number;
  detail?: string;
}

/** 실패로 세는 상태 — 확인을 시도했는데 끝내지 못한 경우. */
export function isHpFailure(s: HpStatus): boolean {
  return s === 'failed' || s === 'blocked';
}

const nonNegInt = (n: unknown): number => (typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : 0);

/** 이전 값 해석(손상·없음이면 null). mysql2 JSON 컬럼은 객체, 문자열 저장분은 문자열. */
export function parseHpStatus(raw: unknown): { consecutiveFailures: number; failureAlertEtDate?: string } | null {
  let v: unknown = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return null; }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const d = typeof o.failureAlertEtDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.failureAlertEtDate) ? o.failureAlertEtDate : undefined;
  return { consecutiveFailures: nonNegInt(o.consecutiveFailures), ...(d ? { failureAlertEtDate: d } : {}) };
}

/**
 * 다음 상태(순수). 연속 실패: failed·blocked → +1 / ok·no_holdings(확인 완료) → 0 /
 * 그 밖(switch_off·stale_holdings·skipped_no_table·no_user_agent — 확인을 시도하지 못함) → 이전 값 유지.
 */
export function nextHpStatus(
  prev: { consecutiveFailures: number; failureAlertEtDate?: string } | null, input: HpStatusInput, now: Date,
): HpStatusValue {
  const p = prev ?? { consecutiveFailures: 0 };
  const cf = isHpFailure(input.status) ? p.consecutiveFailures + 1
    : (input.status === 'ok' || input.status === 'no_holdings') ? 0 : p.consecutiveFailures;
  return {
    lastAt: toKstDatetime(now),
    status: input.status,
    holdings: nonNegInt(input.holdings),
    checked: nonNegInt(input.checked),
    newFilings: nonNegInt(input.newFilings),
    alerted: nonNegInt(input.alerted),
    consecutiveFailures: cf,
    ...(input.detail ? { detail: input.detail.slice(0, 120) } : {}),
    ...(p.failureAlertEtDate ? { failureAlertEtDate: p.failureAlertEtDate } : {}),
  };
}

/** 실패 알림을 보낼 차례인가(연속 2회 이상·오늘(ET) 아직 안 보냄). */
export function shouldSendFailureAlert(s: HpStatusValue, etToday: string): boolean {
  return isHpFailure(s.status) && s.consecutiveFailures >= HP_FAILURE_ALERT_AFTER && s.failureAlertEtDate !== etToday;
}

/** 이전 상태 읽기 — 실패·없음이면 null. 던지지 않는다. */
export async function readHpStatus(): Promise<ReturnType<typeof parseHpStatus>> {
  try {
    const [rows] = await getPool().query<(RowDataPacket & { value: unknown })[]>(
      'SELECT value FROM system_config WHERE `key` = ? LIMIT 1',
      [HP_STATUS_KEY],
    );
    return Array.isArray(rows) && rows.length > 0 ? parseHpStatus(rows[0].value) : null;
  } catch (e) {
    console.warn(`${LOG} ${HP_STATUS_KEY} 읽기 실패 — 연속 실패를 0 에서 센다: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** 상태 쓰기 — 실패는 경고만(라우트 응답에 영향 없음). 성공 여부를 돌려준다. */
export async function writeHpStatus(value: HpStatusValue): Promise<boolean> {
  try {
    await getPool().query(
      'INSERT INTO system_config (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      [HP_STATUS_KEY, JSON.stringify(value)],
    );
    return true;
  } catch (e) {
    console.warn(`${LOG} ${HP_STATUS_KEY} 저장 실패(무시): ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/** 지금의 미국 동부 날짜 YYYY-MM-DD(실패 알림 하루 1건 판정용). */
export function etDateOf(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
