/**
 * T-169 B1 — 비서 채팅에 매 질문 붙이는 「시스템 수집 데이터 요약」.
 *
 * 질문에 종목이 없어도(예: 「지금의 수집데이터와 지표나 경제흐름으로 추천해줄 종목 5개」) 시스템이 이미 모으고 판정한 데이터를
 * 근거로 답하게 한다. **읽기 전용 SELECT 만** 하고, KIS·외부 호출은 없다. 각 절은 독립 try/catch — 한 절 실패가 다른 절·답변을
 * 막지 않는다. 전체 길이 상한 {@link OVERVIEW_MAX_CHARS}(3,200자 — Leader 2차 결정). 뉴스 절은 최신 {@link NEWS_MAX_ITEMS}건·약
 * {@link NEWS_SECTION_MAX_CHARS}자 예산을 먼저 확보하고, 넘치면 즐겨찾기 → 후보 지표 → 엔진 후보(8 → 최소 {@link MIN_CANDIDATES}, 사용자 결정 D1
 * 「최대 5개 상세」) 순으로 끝 줄부터 줄인다({@link fitOverviewSections}). 결과에는 요약에 실제로 남은 엔진 후보 목록(심볼·이름·상태)을 함께
 * 돌려준다 — route 가 새 답 후처리(언급한 후보의 상태 줄)에 그대로 넘긴다.
 *
 * 절(우선순위 순)
 *  1. 경제 흐름 — `macro_regime_label_log` 최신 1행의 **원자료만**(사용자 결정 「원자료만」): CPI 전년비·기준월(기대 기준월과 다르면
 *     「…월분 발표는 아직 반영 안 됨」 — 최신 발표 미반영 표시)·금리 상단·6개월 변화(부호로 인상/인하/동결)·다음 결정일(조회일로부터
 *     남은 날수)·기준 시각. 라벨·사유 코드·type5·기록 JSON 은
 *     **읽지도 넣지도 않는다**(C0 라벨은 AI 프롬프트에 쓰지 않는다 — T-165 의존 경계). macro-regime 모듈은 import 하지 않는다.
 *     두 시장(domestic·overseas) 행은 같은 미국 CPI·연준 금리 값을 담으므로(2026-11-14 실측) 판정 시각이 가장 늦은 1행만 쓴다.
 *  2. 엔진 최근 매수 후보 — 최근 3일 `signals` **매수만**(매도·청산 신호는 보유 종목을 드러내므로 넣지 않는다 — Leader 결정) +
 *     그 시그널의 `paper_fills`(가상 체결). 같은 종목은 1건, 최대 {@link MAX_CANDIDATES} 종목. 해외 `signals.price` 는 원화 환산값이라
 *     달러는 `paper_fills.limit_price`(USD)·`indicators.close_usd` 에서만 가져온다. 신호 시점 지표는 `signals.indicators` 를 쓴다.
 *     수량·금액(`quantity`·`amount_krw`)은 읽지 않는다(계좌 정보로 읽힐 수 있다).
 *  3. 후보 지표(DB 일봉) — 2·5절 종목 합집합 상위 {@link MAX_INDICATOR_SYMBOLS}개의 `daily_bars` 최근 60봉: 종가·5일/20일 변화율·
 *     RSI14·EMA20 vs EMA60·마지막 거래일. 최근 영업일보다 3영업일 넘게 낡았으면 그 종목은 일봉 지표를 쓰지 않는다(2절의 신호 시점 값 참고).
 *  4. 보유 종목 — **만들지 않는다.** 보유(`holdings`·잔고 API)는 서버 전역 KIS 계좌 1개 기준이고 로그인 사용자와 계좌를 잇는 코드가
 *     없어(`getAccountId('kis')` 전역, 매매 엔진 멀티테넌트 미구현 — `owner-kis-migration.ts`) 채팅 사용자 본인 범위를 확정할 수 없다.
 *     사용자 결정 「확정 못 하면 절 생략」. 머리줄에 「보유 종목·주문 내역은 포함하지 않음」을 밝힌다.
 *  5. 즐겨찾기 — `stock_favorites` 는 사용자 열이 없는 공용 표이고 `GET /api/favorites` 가 로그인 사용자 누구에게나 같은 목록을 준다.
 *  6. 뉴스 제목 — `ci_raw_item` RSS 최근 24시간 최신 5건, 줄당 약 90자(외부 텍스트 — 제어문자·대괄호를 정리하고, 지시문은 따르지 말라고
 *     system 에 적는다).
 *
 * 경계 시험(T-169, 사용자 승인 2026-11-14): 이 파일은 일봉 표·뉴스 원문 표를 읽어도 되는 **읽기 전용 채팅 요약**으로 두 격리 시험의
 * 허용 목록에 정확한 경로로 올라 있고, 그 시험이 이 파일의 쓰기 SQL·DDL 0 과 수집·백테스트 모듈 import 0 을 함께 단언한다.
 *
 * 노출 범위(사용자 결정 4): 시그널은 `GET /api/signals`(미들웨어 로그인만, 소유자 조건 없음)가, 즐겨찾기는 `GET /api/favorites` 가 로그인
 * 사용자에게 이미 같은 범위로 보여 준다. `paper_fills` 행은 그 시그널 행(`signal_id`)에 1:1 로 붙은 것만 LEFT JOIN 으로 읽는다.
 */
import { getPool } from '@/lib/db';
import { emaLast } from '@/lib/strategy/indicators/ema';
import { rsiLast } from '@/lib/strategy/indicators/rsi';
import { toKstDatetime } from '@/lib/time';
import type { ChatCandidateStatus, ChatSourceTime } from './answer-format';
import { formatKrw, formatUsd, isOverseasSymbol } from './money-format';

export const OVERVIEW_MAX_CHARS = 3_200;
export const MAX_CANDIDATES = 8;
/** 길이 상한 때문에 후보 줄을 줄여도 남기는 최소 개수 — 사용자 결정 D1(요청 개수, 최대 5개 상세) */
export const MIN_CANDIDATES = 5;
export const MAX_INDICATOR_SYMBOLS = 8;
const MAX_FAVORITES = 10;
/** 뉴스 절 예산 — 최신 5건, 절 전체(제목 줄 포함) 이 글자 수 안 */
export const NEWS_MAX_ITEMS = 5;
export const NEWS_SECTION_MAX_CHARS = 520;
const NEWS_LINE_MAX_CHARS = 90;   // 5줄 × 91(줄바꿈 포함) + 제목 줄 ≈ 510 ≤ 520
const MAX_NEWS = NEWS_MAX_ITEMS;
const CANDIDATE_LOOKBACK_DAYS = 3;
const NEWS_LOOKBACK_HOURS = 24;
const BAR_LOOKBACK_DAYS = 130;    // 60 거래일 + 공휴일 여유
const BARS_USED = 60;
export const STALE_BUSINESS_DAYS = 3;

export type OverviewSectionKey = 'macro' | 'candidates' | 'indicators' | 'favorites' | 'news';
/** 글에 싣는 순서(우선순위 순) — 보유 절(4)은 만들지 않는다 */
const PRIORITY: readonly OverviewSectionKey[] = ['macro', 'candidates', 'indicators', 'favorites', 'news'];

/** DB 접근 — 기본은 앱 풀. 시험·하네스가 읽기 전용 연결을 넣는다. */
export interface OverviewDb {
  query(sql: string, values?: unknown[]): Promise<unknown>;
}

export interface OverviewInput {
  /** 채팅 사용자 — 사용자 범위 데이터(보유) 판단용. 현재 사용자별 계좌 매핑이 없어 보유 절을 만들지 않으므로 읽지 않는다. */
  userId: number;
  now?: Date;
  db?: OverviewDb;
}

export interface OverviewResult {
  text: string;
  sections: OverviewSectionKey[];
  /** 요약 글에 실제로 남은 엔진 후보(줄 순서) — 새 답 후처리의 「언급한 후보의 상태」 판정 기준 */
  candidates: ChatCandidateStatus[];
  /** 요약에 실제로 남은 절의 기준 시각(경제 지표·엔진 후보·일봉·뉴스 순) — 새 답 후처리의 「자료 기준」 줄(QA F4) */
  sourceTimes: ChatSourceTime[];
}

export interface OverviewSection {
  key: OverviewSectionKey;
  title: string;
  lines: string[];
  /** candidates 절만 — lines 와 같은 순서·같은 길이(「최근 3일 매수 신호 없음」 줄이면 빈 배열) */
  candidates?: ChatCandidateStatus[];
  /** 절 전체의 기준 시각(KST `YYYY-MM-DD HH:mm`) — 경제 흐름 */
  stamp?: string;
  /** 줄마다의 기준 시각(lines 와 같은 길이, 없으면 null) — 남은 줄 중 가장 늦은 값이 그 절의 기준 시각(후보·일봉·뉴스) */
  lineStamps?: (string | null)[];
}

/** 「자료 기준」 줄에 쓰는 절 이름 — 즐겨찾기는 시각이 없어 넣지 않는다 */
const SOURCE_TIME_LABEL: Partial<Record<OverviewSectionKey, string>> = {
  macro: '경제 지표', candidates: '엔진 후보', indicators: '일봉', news: '뉴스',
};

/** 남은 절들의 기준 시각 — 절 기준 시각이 있으면 그것, 없으면 남은 줄 시각 중 가장 늦은 값 */
export function overviewSourceTimes(sections: readonly OverviewSection[]): ChatSourceTime[] {
  const out: ChatSourceTime[] = [];
  for (const sec of sections) {
    const label = SOURCE_TIME_LABEL[sec.key];
    if (!label) continue;
    const stamps = (sec.lineStamps ?? []).slice(0, sec.lines.length).filter((x): x is string => !!x).sort();
    const at = sec.stamp ?? stamps[stamps.length - 1];
    if (at) out.push({ label, at });
  }
  return out;
}
type Section = OverviewSection;

// ── 공통 도우미 ────────────────────────────────────────────────────────────

const MACRO_SQL =
  'SELECT as_of_kst, cpi_yoy_pct, cpi_reference_month, cpi_expected_reference_month, '
  + 'rate_upper_pct, rate_upper_6m_ago_pct, rate_delta_pct, rate_next_known_decision_date '
  + 'FROM macro_regime_label_log ORDER BY as_of_utc DESC, id DESC LIMIT 1';

const CANDIDATES_SQL =
  'SELECT s.id, s.symbol, s.strategy_id, s.status, s.price, s.indicators, s.created_at, '
  + 'm.name AS meta_name, pf.limit_price AS pf_limit_price, pf.currency AS pf_currency, '
  + 'pf.gate_reason AS pf_gate_reason, pf.zone_lo AS pf_zone_lo, pf.zone_hi AS pf_zone_hi, pf.id AS pf_id '
  + 'FROM signals s '
  + 'LEFT JOIN stock_meta m ON m.symbol = s.symbol '
  + 'LEFT JOIN paper_fills pf ON pf.signal_id = s.id '
  + "WHERE s.side = 'buy' AND s.created_at >= ? "
  + 'ORDER BY s.created_at DESC, s.id DESC LIMIT 300';

const FAVORITES_SQL =
  'SELECT f.symbol, f.name AS fav_name, m.name AS meta_name FROM stock_favorites f '
  + 'LEFT JOIN stock_meta m ON m.symbol = f.symbol '
  + `ORDER BY f.sort_order ASC, f.added_at DESC LIMIT ${MAX_FAVORITES}`;

const BARS_SQL =
  'SELECT market, symbol, trade_date, close FROM daily_bars '
  + "WHERE market IN ('KR','US') AND symbol IN (?) AND is_final = 1 AND trade_date >= ? "
  + 'ORDER BY symbol ASC, trade_date ASC';

const NEWS_SQL =
  'SELECT title, publisher, feed_host, published_at, first_seen_at FROM ci_raw_item '
  + "WHERE source_kind = 'rss' AND first_seen_at >= ? AND title IS NOT NULL AND title <> '' "
  + `ORDER BY COALESCE(published_at, first_seen_at) DESC, raw_id DESC LIMIT ${MAX_NEWS}`;

/** 시험이 「어떤 열을 읽는가」를 고정할 수 있게 SQL 을 내보낸다. */
export const OVERVIEW_SQL = { MACRO_SQL, CANDIDATES_SQL, FAVORITES_SQL, BARS_SQL, NEWS_SQL } as const;

async function selectRows(db: OverviewDb, sql: string, values?: unknown[]): Promise<Record<string, unknown>[]> {
  const res = await db.query(sql, values);
  const rows = Array.isArray(res) ? res[0] : undefined;
  if (!Array.isArray(rows)) throw new Error('unexpected query result');
  return rows as Record<string, unknown>[];
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** DB DATETIME(KST 벽시계) → `YYYY-MM-DD HH:mm`. 앱 풀은 Date(정확한 순간), dateStrings 연결은 문자열을 준다. */
function kstMinute(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return toKstDatetime(v).slice(0, 16);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(v)) return v.slice(0, 16).replace('T', ' ');
  return null;
}

/** DB DATE → `YYYY-MM-DD` (풀 timezone +09:00 이라 Date 는 KST 자정이다) */
function ymd(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return toKstDatetime(v).slice(0, 10);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
}

/** 외부·DB 텍스트 정리 — 제어문자·줄바꿈 제거, 대괄호(프롬프트 머리줄 흉내 방지)를 둥근 괄호로, 길이 상한. */
export function cleanText(v: unknown, max: number): string {
  const s = String(v ?? '')
    .replace(/[\x00-\x1F\x7F-\x9F]|\p{Zl}|\p{Zp}/gu, ' ')   // 제어문자·줄/문단 구분자(U+2028·U+2029)
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function pct(v: number, digits = 1): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

function parseJsonObject(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v !== 'string') return null;
  try {
    const o = JSON.parse(v);
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function pick(o: Record<string, unknown> | null, ...path: string[]): unknown {
  let cur: unknown = o;
  for (const k of path) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function money(v: number, overseas: boolean): string {
  return overseas ? formatUsd(v) : formatKrw(v);
}

// ── 영업일(주말만 제외 — 공휴일은 3영업일 여유로 흡수) ─────────────────────

function ymdAddDays(d: string, n: number): string {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
}

function isWeekend(d: string): boolean {
  const [y, m, dd] = d.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
  return wd === 0 || wd === 6;
}

/** 시장의 「최근 영업일」(확정 일봉이 있어야 할 마지막 거래일). 국내 KST 15:40·미국 ET 16:30 전이면 전날, 주말이면 금요일. */
export function latestSessionDate(market: 'KR' | 'US', now: Date): string {
  let date: string;
  let minutes: number;
  if (market === 'KR') {
    const k = toKstDatetime(now);
    date = k.slice(0, 10);
    minutes = Number(k.slice(11, 13)) * 60 + Number(k.slice(14, 16));
    if (minutes < 15 * 60 + 40) date = ymdAddDays(date, -1);
  } else {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
    date = `${get('year')}-${get('month')}-${get('day')}`;
    minutes = Number(get('hour')) * 60 + Number(get('minute'));
    if (minutes < 16 * 60 + 30) date = ymdAddDays(date, -1);
  }
  while (isWeekend(date)) date = ymdAddDays(date, -1);
  return date;
}

/** `last` 다음 날부터 `ref` 까지의 평일 수(ref 가 last 이전이면 0). */
export function businessDaysAfter(last: string, ref: string): number {
  let n = 0;
  for (let d = ymdAddDays(last, 1); d <= ref && n < 400; d = ymdAddDays(d, 1)) {
    if (!isWeekend(d)) n++;
  }
  return n;
}

// ── 절 1: 경제 흐름 ─────────────────────────────────────────────────────────

async function macroSection(db: OverviewDb, now: Date): Promise<Section | null> {
  const [r] = await selectRows(db, MACRO_SQL);
  if (!r) return null;
  const lines: string[] = [];

  const cpi = num(r.cpi_yoy_pct);
  const refMonth = typeof r.cpi_reference_month === 'string' ? r.cpi_reference_month : null;
  const expMonth = typeof r.cpi_expected_reference_month === 'string' ? r.cpi_expected_reference_month : null;
  if (cpi !== null) {
    // 모델이 「9월·10월분 둘 다 미발표」로 오독한 표기(2026-11-14 스모크)를 피해 기준월과 미반영 월을 따로 적는다
    const monthNote = refMonth
      ? ` — ${monthLabel(refMonth)}분 기준${expMonth && expMonth !== refMonth ? `(${monthLabel(expMonth)}분 발표는 아직 반영 안 됨)` : ''}`
      : '';
    lines.push(`- 소비자물가(CPI) 전년 대비 ${cpi.toFixed(1)}%${monthNote}`);
  } else {
    lines.push('- 소비자물가(CPI): 기록 없음');
  }

  const upper = num(r.rate_upper_pct);
  const sixAgo = num(r.rate_upper_6m_ago_pct);
  const delta = num(r.rate_delta_pct);
  if (upper !== null) {
    let change = '';
    if (delta !== null) {
      const word = delta > 0 ? '인상' : delta < 0 ? '인하' : '동결';
      change = delta === 0
        ? `, 6개월 전${sixAgo !== null ? ` ${sixAgo.toFixed(2)}%` : ''}과 같음(${word})`
        : `, 6개월 전${sixAgo !== null ? ` ${sixAgo.toFixed(2)}%` : ''} 대비 ${delta > 0 ? '+' : ''}${delta.toFixed(2)}%p(${word})`;
    }
    lines.push(`- 미국 정책금리 목표 상단 ${upper.toFixed(2)}%${change}`);
  }
  const next = ymd(r.rate_next_known_decision_date);
  if (next) {
    // 「다음 주 FOMC」 같은 질문의 전제를 모델이 확인할 수 있게 조회일 기준 남은 날수를 붙인다(같은 행의 값에서 계산)
    const days = daysBetween(toKstDatetime(now).slice(0, 10), next);
    const rel = days > 0 ? `, 조회일로부터 ${days}일 뒤` : days === 0 ? ', 오늘' : '';
    lines.push(`- 다음 미국 금리 결정일(알려진 일정) ${next}${rel}`);
  }

  const asOf = kstMinute(r.as_of_kst);
  return { key: 'macro', title: `경제 흐름 · 미국 물가·금리 (기준 ${asOf ?? '시각 미상'} KST)`, lines, ...(asOf ? { stamp: asOf } : {}) };
}

/** `2026-09` → `2026년 9월` */
function monthLabel(ym: string): string {
  const m = ym.match(/^(\d{4})-(\d{2})$/);
  return m ? `${m[1]}년 ${Number(m[2])}월` : ym;
}

/** 달력일 차이(b − a, 일) */
function daysBetween(a: string, b: string): number {
  const toMs = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd); };
  return Math.round((toMs(b) - toMs(a)) / 86_400_000);
}

// ── 절 2: 엔진 최근 매수 후보 ───────────────────────────────────────────────

/**
 * 줄마다 붙이는 「상태:」 — 사람이 읽는 말(Leader 결정 2026-11-14: 후보를 말할 때 상태를 함께 말하게).
 * 승인 이후 단계(approved·auto_submitted·executing 등)는 「승인 처리」 하나로 묶어 계좌의 주문 진행을 세분하지 않는다.
 */
const STATUS_TEXT: Record<string, string> = {
  awaiting_approval: '승인 대기', pending: '승인 대기', pending_approval: '승인 대기',
  detected: '관측 기록만', approved: '승인 처리', approved_pending_entry: '승인 처리',
  auto_submitted: '승인 처리', executing: '승인 처리',
  expired: '만료', rejected: '거절', superseded: '대체됨', ai_skipped: 'AI 보류', skipped: '관문 보류',
};
/** 가상 체결이 붙은 행 — 검증 관문 사유별(실제 주문 없이 가상 체결로만 기록) */
const GATE_TEXT: Record<string, string> = {
  unvalidated: '미검증 전략·가상 체결만', unregistered: '미등록 전략·가상 체결만', null_strategy: '전략 없음·가상 체결만',
  invalid_status: '검증 상태 이상·가상 체결만', lookup_error: '검증 조회 실패·가상 체결만',
};
/** 뒤로 미루는(덜 유력한) 상태 — 가상 체결이 붙은 행은 상태와 무관하게 앞 그룹이다. */
const LOW_RANK_STATUSES = new Set(['ai_skipped', 'rejected', 'superseded', 'skipped']);

export interface CandidateSymbol {
  symbol: string;
  name: string;
}

/** 후보 줄의 「상태:」 문구 — 요약 줄과 새 답 후처리(언급한 후보의 상태)가 같은 값을 쓴다 */
function candidateStatusText(r: Record<string, unknown>): string {
  const hasPaper = r.pf_id !== null && r.pf_id !== undefined;
  const status = String(r.status ?? '');
  return hasPaper
    ? (GATE_TEXT[String(r.pf_gate_reason ?? '')] ?? '검증 관문·가상 체결만')
    : (STATUS_TEXT[status] ?? cleanText(status, 20));
}

function candidateLine(r: Record<string, unknown>, name: string): string {
  const symbol = String(r.symbol);
  const overseas = isOverseasSymbol(symbol);
  const ind = parseJsonObject(r.indicators);
  const statusText = candidateStatusText(r);
  const parts: string[] = [
    `${name}(${symbol}) ${kstMinute(r.created_at)?.slice(5) ?? ''}`.trim(),
    `상태: ${statusText}`,
    r.strategy_id ? `전략 ${cleanText(r.strategy_id, 32)}` : '전략 미지정',
  ];

  const rsi = num(pick(ind, 'rsi14'));
  if (rsi !== null) parts.push(`RSI ${rsi.toFixed(1)}`);

  const usdOk = r.pf_currency === 'USD';
  if (overseas) {
    const lim = usdOk ? num(r.pf_limit_price) : null;
    const closeUsd = num(pick(ind, 'close_usd'));
    if (lim !== null) parts.push(`가상 지정가 ${formatUsd(lim)}`);
    else if (closeUsd !== null) parts.push(`신호가 ${formatUsd(closeUsd)}`);
  } else {
    const p = num(pick(ind, 'close')) ?? num(pick(ind, 'price')) ?? num(r.price);
    if (p !== null) parts.push(`신호가 ${formatKrw(p)}`);
  }

  let lo: number | null = null;
  let hi: number | null = null;
  if (!overseas || usdOk) {
    lo = num(r.pf_zone_lo);
    hi = num(r.pf_zone_hi);
  }
  if ((lo === null || hi === null) && overseas) {
    lo = num(pick(ind, 'price_zone_usd', 'lo'));
    hi = num(pick(ind, 'price_zone_usd', 'hi'));
  }
  if ((lo === null || hi === null) && !overseas) {
    const z = pick(ind, 'ai', 'scenario', 'entry', 'price_zone');
    const m = typeof z === 'string' ? z.match(/^\s*([\d.]+)\s*~\s*([\d.]+)\s*$/) : null;
    if (m) { lo = num(m[1]); hi = num(m[2]); }
  }
  if (lo !== null && hi !== null) parts.push(`진입 구간 ${money(lo, overseas)}~${money(hi, overseas)}`);

  const tp = num(pick(ind, 'ai', 'scenario', 'exit', 'target_pct'));
  const sl = num(pick(ind, 'ai', 'scenario', 'exit', 'stop_pct'));
  if (tp !== null && sl !== null) parts.push(`목표 +${tp}%·손절 -${Math.abs(sl)}%`);

  return `- ${parts.join(' · ')}`;
}

async function candidatesSection(db: OverviewDb, now: Date): Promise<{ section: Section | null; symbols: CandidateSymbol[] }> {
  const since = toKstDatetime(new Date(now.getTime() - CANDIDATE_LOOKBACK_DAYS * 86_400_000));
  const rows = await selectRows(db, CANDIDATES_SQL, [since]);
  const ranked = [
    ...rows.filter((r) => r.pf_id != null || !LOW_RANK_STATUSES.has(String(r.status))),
    ...rows.filter((r) => !(r.pf_id != null || !LOW_RANK_STATUSES.has(String(r.status)))),
  ];
  const seen = new Set<string>();
  const picked: { row: Record<string, unknown>; name: string }[] = [];
  for (const r of ranked) {
    const symbol = typeof r.symbol === 'string' ? r.symbol : null;
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    picked.push({ row: r, name: cleanText(r.meta_name ?? symbol, 28) || symbol });
    if (picked.length >= MAX_CANDIDATES) break;
  }
  const symbols = picked.map((p) => ({ symbol: String(p.row.symbol), name: p.name }));
  if (picked.length === 0) {
    return {
      section: {
        key: 'candidates', title: `엔진 최근 매수 후보 (최근 ${CANDIDATE_LOOKBACK_DAYS}일, 기준 ${toKstDatetime(now).slice(0, 16)} KST)`,
        lines: ['- 최근 3일 매수 신호 없음'], candidates: [],
      },
      symbols,
    };
  }
  return {
    section: {
      key: 'candidates',
      title: `엔진 최근 매수 후보 (최근 ${CANDIDATE_LOOKBACK_DAYS}일 신호, 값은 신호 시점 · 기준 ${toKstDatetime(now).slice(0, 16)} KST)`,
      lines: picked.map((p) => candidateLine(p.row, p.name)),
      candidates: picked.map((p) => ({ symbol: String(p.row.symbol), name: p.name, status: candidateStatusText(p.row) })),
      lineStamps: picked.map((p) => kstMinute(p.row.created_at)),
    },
    symbols,
  };
}

// ── 절 5: 즐겨찾기 ──────────────────────────────────────────────────────────

async function favoritesSection(db: OverviewDb, now: Date): Promise<{ section: Section | null; symbols: CandidateSymbol[] }> {
  const rows = await selectRows(db, FAVORITES_SQL);
  const symbols: CandidateSymbol[] = [];
  for (const r of rows) {
    if (typeof r.symbol !== 'string' || !r.symbol) continue;
    const raw = (typeof r.fav_name === 'string' && r.fav_name.trim()) ? r.fav_name : (r.meta_name ?? r.symbol);
    symbols.push({ symbol: r.symbol, name: cleanText(raw, 28) || r.symbol });
  }
  if (symbols.length === 0) return { section: null, symbols };
  return {
    section: {
      key: 'favorites',
      title: `즐겨찾기 (공용 목록, 기준 ${toKstDatetime(now).slice(0, 16)} KST)`,
      lines: symbols.map((s) => `- ${s.name}(${s.symbol})`),
    },
    symbols,
  };
}

// ── 절 3: 후보 지표(DB 일봉) ────────────────────────────────────────────────

async function indicatorsSection(db: OverviewDb, now: Date, targets: CandidateSymbol[]): Promise<Section | null> {
  if (targets.length === 0) return null;
  const since = toKstDatetime(new Date(now.getTime() - BAR_LOOKBACK_DAYS * 86_400_000)).slice(0, 10);
  const rows = await selectRows(db, BARS_SQL, [targets.map((t) => t.symbol), since]);
  const bySymbol = new Map<string, { market: 'KR' | 'US'; date: string; close: number }[]>();
  for (const r of rows) {
    const symbol = typeof r.symbol === 'string' ? r.symbol : null;
    const date = ymd(r.trade_date);
    const close = num(r.close);
    const market = r.market === 'US' ? 'US' : r.market === 'KR' ? 'KR' : null;
    if (!symbol || !date || close === null || close <= 0 || !market) continue;
    const list = bySymbol.get(symbol) ?? [];
    list.push({ market, date, close });
    bySymbol.set(symbol, list);
  }

  const lines: string[] = [];
  const lineStamps: (string | null)[] = [];
  const skipped: string[] = [];
  for (const t of targets) {
    const bars = (bySymbol.get(t.symbol) ?? []).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).slice(-BARS_USED);
    if (bars.length < 6) {
      skipped.push(`${t.name}(${t.symbol}, 일봉 없음)`);
      continue;
    }
    const last = bars[bars.length - 1];
    const ref = latestSessionDate(last.market, now);
    if (businessDaysAfter(last.date, ref) > STALE_BUSINESS_DAYS) {
      skipped.push(`${t.name}(${t.symbol}, 마지막 ${last.date.slice(5)})`);
      continue;
    }
    const closes = bars.map((b) => b.close);
    const n = closes.length - 1;
    const overseas = last.market === 'US';
    const parts = [`${t.name}(${t.symbol}) ${last.date.slice(5)} 종가 ${money(last.close, overseas)}`];
    parts.push(`5일 ${pct(((closes[n] - closes[n - 5]) / closes[n - 5]) * 100)}`);
    if (closes.length >= 21) parts.push(`20일 ${pct(((closes[n] - closes[n - 20]) / closes[n - 20]) * 100)}`);
    const rsi = rsiLast(closes, 14);
    if (rsi !== null) parts.push(`RSI14 ${rsi.toFixed(1)}`);
    const e20 = emaLast(closes, 20);
    const e60 = emaLast(closes, 60);
    if (e20 !== null && e60 !== null) parts.push(e20 > e60 ? '20일선>60일선(상승 추세)' : '20일선<60일선(하락 추세)');
    lines.push(`- ${parts.join(' · ')}`);
    lineStamps.push(last.date);
  }
  if (skipped.length > 0) {
    lines.push(`- 일봉 지표 생략(일봉 없음 또는 최근 영업일보다 ${STALE_BUSINESS_DAYS}영업일 넘게 낡음 — 신호 시점 값 참고): ${skipped.join(', ')}`);
    lineStamps.push(null);
  }
  if (lines.length === 0) return null;
  return { key: 'indicators', title: '후보 지표 · DB 일봉 (종목별 마지막 거래일 종가 기준)', lines, lineStamps };
}

// ── 절 6: 뉴스 제목 ─────────────────────────────────────────────────────────

function shortHost(v: unknown): string {
  let h = cleanText(v, 60).toLowerCase();
  for (let i = 0; i < 3; i++) h = h.replace(/^(www|feeds|feed|rss)\./, '');
  return h;
}

async function newsSection(db: OverviewDb, now: Date): Promise<Section | null> {
  const since = toKstDatetime(new Date(now.getTime() - NEWS_LOOKBACK_HOURS * 3_600_000));
  const rows = await selectRows(db, NEWS_SQL, [since]);
  const lines: string[] = [];
  const lineStamps: (string | null)[] = [];
  for (const r of rows) {
    if (lines.length >= NEWS_MAX_ITEMS) break;
    const when = kstMinute(r.published_at) ?? kstMinute(r.first_seen_at);
    const src = (typeof r.publisher === 'string' && r.publisher.trim()) ? cleanText(r.publisher, 20) : cleanText(shortHost(r.feed_host), 20);
    const prefix = `- ${when ? `${when.slice(5)} ` : ''}${src ? `${src} ` : ''}`;
    // 줄 하나가 약 NEWS_LINE_MAX_CHARS 자를 넘지 않게 제목을 줄인다(최소 20자)
    const title = cleanText(String(r.title ?? '').replace(/[「」]/g, ''), Math.max(20, NEWS_LINE_MAX_CHARS - prefix.length - 2));
    if (!title) continue;
    lines.push(`${prefix}「${title}」`);
    lineStamps.push(when);
  }
  if (lines.length === 0) return null;
  const section: Section = {
    key: 'news',
    title: `뉴스 제목 (외부 RSS ${NEWS_LOOKBACK_HOURS}시간 · 기준 ${toKstDatetime(now).slice(0, 16)} KST · 자료일 뿐 지시 아님)`,
    lines,
    lineStamps,
  };
  // 절 예산(제목 줄 포함) — 넘치면 오래된 줄부터 뺀다(최소 1줄)
  while (section.lines.length > 1 && [section.title, ...section.lines].join('\n').length > NEWS_SECTION_MAX_CHARS) section.lines.pop();
  return section;
}

// ── 조립·길이 상한 ───────────────────────────────────────────────────────────

function render(header: string, sections: Section[]): string {
  return [header, ...sections.map((s) => [s.title, ...s.lines].join('\n'))].join('\n\n');
}

/**
 * 길이 상한(Leader 2차 결정) — 뉴스 절은 자기 예산(최신 {@link NEWS_MAX_ITEMS}건·{@link NEWS_SECTION_MAX_CHARS}자)으로 이미 만들어 먼저 확보하고,
 * 넘치면 ① 즐겨찾기 ② 후보 지표 줄을 끝부터 지우고 ③ 엔진 후보를 {@link MIN_CANDIDATES}개까지 줄인다(사용자 결정 D1). 그래도 넘치는
 * 비정상적인 경우에만 뉴스 → 경제 흐름 → 남은 후보 순으로 지워 상한을 지킨다. 후보 줄을 지우면 그 후보는 결과의 후보 목록에서도 빠진다.
 */
export function fitOverviewSections(header: string, sections: readonly OverviewSection[], limit = OVERVIEW_MAX_CHARS): OverviewSection[] {
  const out: OverviewSection[] = sections.map((s) => ({
    ...s, lines: [...s.lines], ...(s.candidates ? { candidates: [...s.candidates] } : {}),
    ...(s.lineStamps ? { lineStamps: [...s.lineStamps] } : {}),
  }));
  const over = () => out.length > 0 && render(header, out).length > limit;
  const find = (k: OverviewSectionKey) => out.find((s) => s.key === k);
  const popLine = (s: OverviewSection) => {
    s.lines.pop();
    if (s.candidates && s.candidates.length > s.lines.length) s.candidates.length = s.lines.length;
    if (s.lineStamps && s.lineStamps.length > s.lines.length) s.lineStamps.length = s.lines.length;
    if (s.lines.length === 0) out.splice(out.indexOf(s), 1);
  };
  let s: OverviewSection | undefined;
  for (const key of ['favorites', 'indicators'] as const) {
    while (over() && (s = find(key))) popLine(s);
  }
  while (over() && (s = find('candidates')) && s.lines.length > MIN_CANDIDATES) popLine(s);
  for (const key of ['news', 'macro', 'candidates'] as const) {
    while (over() && (s = find(key))) popLine(s);
  }
  return out;
}

async function guarded<T>(key: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[chat-overview] ${key} 절 실패: ${e instanceof Error ? e.message : String(e)}`);
    return fallback;
  }
}

export async function buildOverviewContext(input: OverviewInput): Promise<OverviewResult> {
  const now = input.now ?? new Date();
  let db: OverviewDb;
  try {
    db = input.db ?? (getPool() as unknown as OverviewDb);
  } catch (e) {
    console.warn(`[chat-overview] DB 풀 없음: ${e instanceof Error ? e.message : String(e)}`);
    return { text: `${headerLine(now)}\n(수집 데이터를 불러오지 못했습니다)`, sections: [], candidates: [], sourceTimes: [] };
  }

  const [macro, cand, fav, news] = await Promise.all([
    guarded('macro', () => macroSection(db, now), null),
    guarded('candidates', () => candidatesSection(db, now), { section: null, symbols: [] as CandidateSymbol[] }),
    guarded('favorites', () => favoritesSection(db, now), { section: null, symbols: [] as CandidateSymbol[] }),
    guarded('news', () => newsSection(db, now), null),
  ]);

  const targets: CandidateSymbol[] = [];
  for (const s of [...cand.symbols, ...fav.symbols]) {
    if (targets.length >= MAX_INDICATOR_SYMBOLS) break;
    if (!targets.some((t) => t.symbol === s.symbol)) targets.push(s);
  }
  const indicators = await guarded('indicators', () => indicatorsSection(db, now, targets), null);

  const header = headerLine(now);
  const all = [macro, cand.section, indicators, fav.section, news]
    .filter((s): s is Section => s !== null && s.lines.length > 0)
    .sort((a, b) => PRIORITY.indexOf(a.key) - PRIORITY.indexOf(b.key));
  const kept = fitOverviewSections(header, all, OVERVIEW_MAX_CHARS);
  if (kept.length === 0) {
    return { text: `${header}\n(수집 데이터를 불러오지 못했습니다)`, sections: [], candidates: [], sourceTimes: [] };
  }
  return {
    text: render(header, kept),
    sections: kept.map((s) => s.key),
    candidates: kept.find((s) => s.key === 'candidates')?.candidates ?? [],
    sourceTimes: overviewSourceTimes(kept),
  };
}

function headerLine(now: Date): string {
  return `[수집 데이터 요약 · 조회 ${toKstDatetime(now).slice(0, 16)} KST · 보유 종목·주문 내역은 포함하지 않음]`;
}
