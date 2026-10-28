/**
 * 뉴스 0건 연속 감시 (T-106) — "뉴스가 같은 시장에서 연속 N일 0건이면 알린다".
 *
 * ## 왜 필요한가 (T-105)
 *
 * 장마감 후 분석에 뉴스가 0건 반영된 상태가 최소 5주간 아무 알림 없이 이어졌다(국내 분석 31/31회 `news=0`).
 * 수집 로그는 "OK upserted=20" 이었다 — 해외는 낡은 기사 20건을 매일 다시 저장해 `upserted` 가 항상 20 이었다.
 * 그래서 **수집 성공 여부만 보는 감시로는 못 잡는다** → 두 채널을 따로 센다.
 *  - `fetch`     : `/api/cron/news-fetch` 시장별 결과(실패 소진 = 0, 성공 = `fresh` 가 있으면 그것, 없으면 `upserted`).
 *  - `retrieval` : 장마감 후 분석의 `retrieveRagContext()` 결과 `recentNews.length`. **뉴스를 믿을 수 없는 실행**은 세지 않는다 —
 *    그 시장 뉴스 컬렉션 라벨 오류(`news.kr_market: …`/`news.us_market: …`) 또는 컬렉션 라벨이 없는 전역 오류(KB 클라이언트 실패·
 *    서킷 차단·전체 타임아웃). `signals.*`·`news.macro` 오류만 있으면 뉴스 검색은 성공했으므로 **센다**(그 오류 때문에 감시가
 *    꺼지면 T-105 와 같은 "조용히 꺼진 감시"가 된다). 판정 = `isNewsRetrievalReliable()`.
 *  - `retrieval_error` : 같은 검색 실행이 **믿을 수 없었던 날**(그 시장 뉴스 컬렉션·전역 오류)을 센다. 분석 경로의 RAG 오류에는
 *    다른 알림이 없으므로(T-106 Reviewer M-2 — 키 재발급 401·컬렉션 삭제가 계속돼도 침묵) 별도 채널로 같은 임계에 알린다.
 *    믿을 수 있는 실행 = count 1(정상, 초기화), 믿을 수 없는 실행 = count 0. 뉴스 0건(`retrieval`)과 장애를 섞지 않는다.
 *
 * ## 세는 규칙
 *
 * - KST 날짜 단위. 0 인 관측이 **서로 다른 날** 연속으로 이어진 횟수가 streak 이다(관측이 없는 날 — 주말·휴장 — 은 건너뛴다).
 *   한 번이라도 0 이 아니면 0 으로 초기화.
 * - 단 직전 관측과 **`NEWS_ZERO_MAX_GAP_DAYS`(7)일 초과** 떨어지면(감시 중지·스위치 OFF 기간) 이전 연속을 버리고 새로 시작한다
 *   (오늘 0 이면 1, > 0 이면 0). 7일 간격은 이어 센다. 날짜가 거꾸로 가면(오늘 < 마지막 관측일 — 서버 시계 이상) 역시 새로 시작한다
 *   — 이유는 `nextNewsZeroState` 주석.
 * - 같은 KST 날짜의 재실행은 하루로 센다: streak 를 늘리지 않는다. 같은 날 앞선 실행이 0 이고 지금 > 0 이면 초기화(그날 뉴스가
 *   들어왔다). 같은 날 앞선 실행이 > 0 인데 지금 0 이면 streak 를 건드리지 않는다(오늘은 이미 정상).
 * - streak ≥ 임계(기본 3, 환경변수 `NEWS_ZERO_ALERT_STREAK` 로 덮어쓰기, 최솟값 2)이면 `news-zero:<channel>:<market>` warning 알림.
 *   고쳐질 때까지 하루 1회는 계속 울린다(프로세스 메모리 스로틀 창 20시간 — 같은 날 재실행은 막고, 다음 날 같은 잡은 통과).
 *
 * ## 상태 저장
 *
 * `system_config` 키 `news_zero_streak:<channel>:<market>` 에 JSON `{ streak, lastDate, lastCount, lastOkDate }`.
 * `lastOkDate`(0 이 아닌 관측이 있었던 마지막 KST 날짜, 없으면 null)는 알림 본문의 "마지막 정상일"용으로 덧붙였다 — 없는 옛 값도 읽는다.
 *
 * ## 절대 던지지 않는다
 *
 * 수집·분석 흐름에 영향 0 이 원칙이다. DB 읽기/쓰기 오류는 `console.warn` 후 `{ streak: 0, alerted: false }`.
 * 저장 값이 손상됐으면 경고 후 **이전 기록 없음(0)** 으로 보고 새로 세어 덮어쓴다(손상이 감시를 영구히 멈추지 않게).
 * **기다리는 시간도 상한이 있다**: 한 번의 기록 전체가 `NEWS_HEALTH_TIMEOUT_MS`(4초)를 넘기면 경고 후 `{0,false}` 로 돌아간다
 * (DB 가 반쯤 열린 연결로 멈춰도 news-fetch 크론 틱·분석이 막히지 않게 — Reviewer M-1). 상한 뒤 늦게 끝난 본문은 그대로 끝나게
 * 두고(쓰기·알림이 뒤늦게 일어날 수 있다) 그 오류는 흡수한다.
 *
 * ## 알려진 한계(수용 — Leader 판단: 영향이 하루 이내이고 다음 정상 관측에서 풀린다)
 *
 * - 읽기→계산→쓰기에 잠금이 없어 같은 키를 동시에 두 번 부르면 마지막 쓰기가 이긴다(같은 날 5 와 0 이 겹치면 하루 거짓 +1 가능).
 * - 알림 스로틀(프로세스 메모리 20시간 창)과 "같은 KST 날짜" 규칙은 서로 다른 시계라, 전날 늦은 수동 재실행이 있으면 다음 날 정기 알림이 하루 건너뛸 수 있다.
 */
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { sendAlertThrottled } from '@/lib/notify/throttle';
import { toKstDatetime } from '@/lib/time';

export type NewsChannel = 'fetch' | 'retrieval' | 'retrieval_error';
export type NewsMarket = 'domestic' | 'overseas';

/** 기본 임계 — 연속 0건 일수. */
export const NEWS_ZERO_ALERT_STREAK = 3;
/** 환경변수로 덮어쓸 때의 최솟값(1 이면 하루 0건마다 울려 소음이 된다). */
export const NEWS_ZERO_ALERT_STREAK_MIN = 2;
/** 알림 스로틀 창 — 하루 1회 잡이 다음 날 다시 울리도록 24시간보다 짧게, 같은 날 재실행은 막도록 충분히 길게. */
export const NEWS_ZERO_ALERT_TTL_MS = 20 * 60 * 60 * 1000;
/** 기록 1건(읽기·쓰기·알림 전체)의 대기 상한. news-fetch 러너 curl 에 --max-time 이 없어 여기서 막는다. */
export const NEWS_HEALTH_TIMEOUT_MS = 4000;

/**
 * 관측 사이 최대 공백(달력 일수). 이보다 길게 끊기면 이전 연속을 이어 세지 않는다.
 * 근거(Leader 지정): 추석·설 같은 최장 연휴(관측 없는 날 5~6일) + 여유. 실제 정상 운영 간격은 더 짧다 — fetch 는 매일, 국내 분석은
 * 주말만 건너뛰어(공휴일도 실행) 최대 3일, 해외 분석은 미국 휴장+주말로 최대 약 4일(Reviewer 확인).
 * 몇 주 공백 뒤 첫 0 으로 바로 알림이 울리는 가짜 연속을 막는다. 한계: 관측 없는 날이 7일인 초장기 연휴(앞뒤 관측 간격 8일)는
 * 새로 시작한다 — 놓치는 쪽(알림 지연)이지 가짜 알림 쪽이 아니다.
 */
export const NEWS_ZERO_MAX_GAP_DAYS = 7;

const LOG = '[news-health]';

/** 시장 → 그 시장 뉴스 컬렉션 이름(`retrieval.ts` 의 chooseNewsCollection 과 같아야 한다). */
export const NEWS_COLLECTION_BY_MARKET: Record<NewsMarket, string> = {
  domestic: 'news.kr_market',
  overseas: 'news.us_market',
};
/**
 * `retrieveRagContext()` 가 오류 문자열 앞에 붙이는 컬렉션 라벨 전체(`${label}: ${message}` — retrieval.ts settledOr).
 * 이 목록에 없는 접두어의 오류는 전역 실패로 본다(안전한 쪽 — 세지 않음).
 */
export const KNOWN_RAG_COLLECTION_LABELS: readonly string[] = [
  'signals.stockinvest', 'signals.tradinginvest', 'news.kr_market', 'news.us_market', 'news.macro',
];

const CHANNEL_LABEL: Record<NewsChannel, string> = {
  fetch: '수집 단계(/api/cron/news-fetch)',
  retrieval: '분석 검색 단계(장마감 후 분석 RAG)',
  retrieval_error: '분석 검색 오류(장마감 후 분석 RAG — 뉴스 컬렉션·지식베이스 조회 실패)',
};

/** 채널별 "가능한 원인" 안내(진단 절차 문서 경로는 공통). */
const CAUSE_HINT: Record<NewsChannel, string> = {
  fetch: '원천 피드 정지 / 기사 발행일 날짜 형식 / M4 장애',
  retrieval: '원천 피드 정지 / 기사 발행일 날짜 형식 / M4 장애 / 검색 유사도 점수 임계(0.5) 미달로 전부 제외됐거나(로그 `droppedByScore`)',
  retrieval_error: 'M4 장애·연결 / M4 API 키 재발급(401) / 컬렉션 삭제·이름 변경 / 응답 5초 제한 초과',
};
const T105_DOC = 'agent-vault/10-Flow/tasks/T-105-news-rag-zero-hits.md';
const MARKET_LABEL: Record<NewsMarket, string> = { domestic: '국내', overseas: '해외' };

export interface NewsZeroState {
  streak: number;
  /** 마지막 관측 KST 날짜 YYYY-MM-DD */
  lastDate: string;
  /** 그 날짜에 관측한 최대 건수 */
  lastCount: number;
  /** 0 이 아닌 관측이 있었던 마지막 KST 날짜(없으면 null) */
  lastOkDate: string | null;
}

export interface RecordNewsOutcomeInput {
  channel: NewsChannel;
  market: NewsMarket;
  count: number;
  now?: Date;
}

export interface RecordNewsOutcomeResult {
  streak: number;
  alerted: boolean;
}

export function newsZeroStreakKey(channel: NewsChannel, market: NewsMarket): string {
  return `news_zero_streak:${channel}:${market}`;
}

export function newsZeroAlertKey(channel: NewsChannel, market: NewsMarket): string {
  return `news-zero:${channel}:${market}`;
}

/** KST 날짜 `YYYY-MM-DD` — `time.ts` 의 `toKstDatetime`(서버 TZ 무관 +9h 산술) 앞 10자리. */
export function kstDateOf(now: Date): string {
  return toKstDatetime(now).slice(0, 10);
}

/**
 * 임계 해석. 비었거나 숫자가 아니면 기본 3, 소수는 내림, 최솟값 2.
 */
export function resolveNewsZeroAlertStreak(raw: string | undefined = process.env.NEWS_ZERO_ALERT_STREAK): number {
  if (raw === undefined || raw.trim() === '') return NEWS_ZERO_ALERT_STREAK;
  const n = Number(raw.trim());
  if (!Number.isFinite(n)) return NEWS_ZERO_ALERT_STREAK;
  return Math.max(NEWS_ZERO_ALERT_STREAK_MIN, Math.floor(n));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` → UTC 자정 epoch ms. 형식이 틀리거나 실재하지 않는 날짜(2026-02-30 등)면 null. */
function ymdToUtcMs(ymd: string): number | null {
  if (!DATE_RE.test(ymd)) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return ms;
}

/** 달력 일수 차 `to - from` (UTC 날짜 산술 — 문자열 비교가 아니다). 날짜가 틀리면 null. */
export function calendarDaysBetween(from: string, to: string): number | null {
  const a = ymdToUtcMs(from);
  const b = ymdToUtcMs(to);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86_400_000);
}

const isValidYmd = (s: unknown): s is string => typeof s === 'string' && ymdToUtcMs(s) !== null;
const nonNegInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** 저장 값 → 상태. 형식이 맞지 않으면 null. mysql2 JSON 컬럼은 객체로, 문자열 저장분은 문자열로 올 수 있다. */
export function parseNewsZeroState(raw: unknown): NewsZeroState | null {
  let v: unknown = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return null; }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!nonNegInt(o.streak) || !nonNegInt(o.lastCount)) return null;
  if (!isValidYmd(o.lastDate)) return null;
  let lastOkDate: string | null = null;
  if (isValidYmd(o.lastOkDate)) lastOkDate = o.lastOkDate;
  return { streak: o.streak, lastDate: o.lastDate, lastCount: o.lastCount, lastOkDate };
}

/**
 * 순수 계산 — 이전 상태 + 오늘 관측 → 다음 상태. (시험·변이 확인용으로 분리)
 *
 * 새 날짜의 연속 여부:
 * - 직전 관측과의 달력 일수 차 1~`NEWS_ZERO_MAX_GAP_DAYS` → 이어 센다(0 이면 +1, > 0 이면 0).
 * - 차 > `NEWS_ZERO_MAX_GAP_DAYS` → 이전 연속을 버리고 새로 시작(0 이면 1, > 0 이면 0). `lastOkDate` 는 보존.
 * - **차 < 0(날짜 역행 — 서버 시계 이상)** → 역시 새로 시작한다(이전 연속을 유지도 증가도 하지 않음). 이렇게 정한 이유:
 *   ① 역행 관측만으로 임계에 닿지 않는다(새 시작은 최대 1) — 시계 이상이 가짜 알림을 만들지 않는다.
 *   ② 상태의 `lastDate` 가 오늘(시계 기준)로 내려와 다음 관측부터 정상적으로 이어진다. 기록을 거부하면 미래 날짜의 `lastDate` 가
 *      남아 시계가 그 날짜를 지날 때까지 모든 관측이 무시되는 "조용히 꺼진 감시"가 된다.
 *   ③ 시계가 바로잡혀 크게 앞으로 뛰면 공백 상한 규칙으로 다시 새로 시작하므로 역행 구간의 값이 오래 남지 않는다.
 * - 날짜가 해석되지 않으면(이론상 없음 — parse 가 거른다) 새로 시작.
 */
export function nextNewsZeroState(prev: NewsZeroState | null, count: number, today: string): NewsZeroState {
  const isZero = count === 0;
  if (!prev) {
    return { streak: isZero ? 1 : 0, lastDate: today, lastCount: count, lastOkDate: isZero ? null : today };
  }
  if (prev.lastDate === today) {
    // 같은 날 재실행 — 하루로 센다.
    const resetToday = prev.lastCount === 0 && !isZero;
    return {
      streak: resetToday ? 0 : prev.streak,
      lastDate: today,
      lastCount: Math.max(prev.lastCount, count),
      lastOkDate: isZero ? prev.lastOkDate : today,
    };
  }
  // 새 날짜 — 공백이 상한을 넘거나 날짜가 역행하면 이전 연속을 버린다.
  const gap = calendarDaysBetween(prev.lastDate, today);
  if (gap === null || gap < 0 || gap > NEWS_ZERO_MAX_GAP_DAYS) {
    return {
      streak: isZero ? 1 : 0,
      lastDate: today,
      lastCount: count,
      lastOkDate: isZero ? prev.lastOkDate : today,
    };
  }
  return {
    streak: isZero ? prev.streak + 1 : 0,
    lastDate: today,
    lastCount: count,
    lastOkDate: isZero ? prev.lastOkDate : today,
  };
}

export function buildNewsZeroAlert(
  channel: NewsChannel,
  market: NewsMarket,
  state: NewsZeroState,
  threshold: number,
): { title: string; body: string } {
  const marketName = `${MARKET_LABEL[market]}(${market})`;
  const isError = channel === 'retrieval_error';
  const title = isError
    ? `뉴스 검색 오류 ${state.streak}일 연속 — ${MARKET_LABEL[market]} 분석 검색`
    : `뉴스 0건 ${state.streak}일 연속 — ${MARKET_LABEL[market]} ${channel === 'fetch' ? '수집' : '분석 검색'}`;
  const body = [
    `채널: ${CHANNEL_LABEL[channel]}`,
    `시장: ${marketName}`,
    `${isError ? '연속 검색 오류' : '연속 0건'}: ${state.streak}일 (알림 기준 ${threshold}일, 마지막 확인 ${state.lastDate} KST)`,
    `마지막 정상일: ${state.lastOkDate ?? '기록 없음(감시 시작 뒤 정상 관측 없음)'}`,
    `가능한 원인: ${CAUSE_HINT[channel]} — 진단 절차는 ${T105_DOC} 참고`,
  ].join('\n');
  return { title, body };
}

/**
 * 이 검색 실행의 뉴스 건수를 믿을 수 있는가 — `retrieveRagContext()` 의 `errors` 로 판정(순수 함수).
 * - 그 시장 뉴스 컬렉션 라벨(`news.kr_market: ` / `news.us_market: `)로 시작하는 오류 → 믿을 수 없음(뉴스 조회 장애).
 * - 알려진 컬렉션 라벨 어느 것으로도 시작하지 않는 오류(전역 실패: getKbClient 실패·`KB circuit breaker open`·
 *   `RAG retrieval timeout 5000ms` 등) → 믿을 수 없음.
 * - 문자열이 아닌 원소 → 믿을 수 없음(안전한 쪽).
 * - `signals.*`·`news.macro`·다른 시장 뉴스 라벨 오류만 → 믿을 수 있음(그 시장 뉴스 검색은 성공했다).
 * - 빈 배열 → 믿을 수 있음.
 */
export function isNewsRetrievalReliable(market: NewsMarket, errors: readonly unknown[]): boolean {
  const newsLabel = `${NEWS_COLLECTION_BY_MARKET[market]}: `;
  for (const e of errors) {
    if (typeof e !== 'string') return false;
    if (e.startsWith(newsLabel)) return false;
    if (!KNOWN_RAG_COLLECTION_LABELS.some((l) => e.startsWith(`${l}: `))) return false;
  }
  return true;
}

export interface RetrievalHealthResult {
  /** `isNewsRetrievalReliable` 판정 */
  reliable: boolean;
  /** `retrieval`(뉴스 0건) 채널 결과 — 믿을 수 없는 실행이면 기록하지 않아 null */
  retrieval: RecordNewsOutcomeResult | null;
  /** `retrieval_error`(검색 오류) 채널 결과 — 항상 기록(믿을 수 있으면 1=초기화, 없으면 0) */
  retrievalError: RecordNewsOutcomeResult;
}

/**
 * 검색 채널(장마감 후 분석) 호출부용 — `retrieveRagContext()` 결과 하나로 두 채널을 기록한다.
 * - 믿을 수 있는 실행(`isNewsRetrievalReliable`): `retrieval` 에 `recentNews.length`, `retrieval_error` 에 1(정상 → 초기화).
 * - 믿을 수 없는 실행: `retrieval_error` 에 0 만. `retrieval` 은 건드리지 않는다(뉴스 0건과 장애를 섞지 않는다).
 * 두 기록은 병렬이고 각각 4초 상한이라 전체 최악도 약 4초. 형식이 예상과 다르면(시험용 부분 객체 등) 아무것도 기록하지 않고 null.
 * 절대 던지지 않는다.
 */
export async function recordRetrievalNewsOutcome(
  market: NewsMarket,
  ctx: { errors?: unknown; recentNews?: unknown } | null | undefined,
  now?: Date,
): Promise<RetrievalHealthResult | null> {
  try {
    if (!ctx || !Array.isArray(ctx.errors) || !Array.isArray(ctx.recentNews)) return null;
    if (!isNewsRetrievalReliable(market, ctx.errors)) {
      const retrievalError = await recordNewsOutcome({ channel: 'retrieval_error', market, count: 0, now });
      return { reliable: false, retrieval: null, retrievalError };
    }
    const [retrieval, retrievalError] = await Promise.all([
      recordNewsOutcome({ channel: 'retrieval', market, count: ctx.recentNews.length, now }),
      recordNewsOutcome({ channel: 'retrieval_error', market, count: 1, now }),
    ]);
    return { reliable: true, retrieval, retrievalError };
  } catch (e) {
    console.warn(`${LOG} retrieval:${market} 예외 흡수: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/**
 * 관측 1건을 기록하고 연속 0건 일수가 임계 이상이면 알린다. **절대 던지지 않고, `NEWS_HEALTH_TIMEOUT_MS` 안에 반드시 돌아온다.**
 */
export async function recordNewsOutcome(input: RecordNewsOutcomeInput): Promise<RecordNewsOutcomeResult> {
  const fallback: RecordNewsOutcomeResult = { streak: 0, alerted: false };
  // 상한 뒤 늦게 끝나는 본문의 오류 흡수. Promise.race 가 이미 body 에 핸들러를 달아 늦은 거부는 unhandled 가 되지 않지만
  // (변이 시험에서 확인 — 이 .catch 를 빼도 동등), 경로를 명시하고 로그를 남기려고 둔다. 본문은 원래 던지지 않는다.
  const body = recordNewsOutcomeBody(input).catch((e: unknown) => {
    try { console.warn(`${LOG} 예외 흡수: ${e instanceof Error ? e.message : String(e)}`); } catch { /* 로그 실패도 흡수 */ }
    return fallback;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<RecordNewsOutcomeResult>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`${LOG} ${String(input?.channel)}:${String(input?.market)} 기록이 ${NEWS_HEALTH_TIMEOUT_MS}ms 안에 끝나지 않아 건너뜀(DB 대기 상한)`);
      resolve(fallback);
    }, NEWS_HEALTH_TIMEOUT_MS);
  });
  try {
    return await Promise.race([body, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function recordNewsOutcomeBody(input: RecordNewsOutcomeInput): Promise<RecordNewsOutcomeResult> {
  const fallback: RecordNewsOutcomeResult = { streak: 0, alerted: false };
  try {
    const { channel, market } = input;
    if (!Object.prototype.hasOwnProperty.call(CHANNEL_LABEL, channel) || !Object.prototype.hasOwnProperty.call(MARKET_LABEL, market)) {
      console.warn(`${LOG} 알 수 없는 채널/시장(${String(channel)}/${String(market)}) — 기록하지 않음`);
      return fallback;
    }
    if (typeof input.count !== 'number' || !Number.isFinite(input.count) || input.count < 0) {
      console.warn(`${LOG} ${channel}:${market} 건수가 올바르지 않음(${String(input.count)}) — 기록하지 않음`);
      return fallback;
    }
    const count = Math.floor(input.count);
    const now = input.now ?? new Date();
    const today = kstDateOf(now);
    const key = newsZeroStreakKey(channel, market);

    let prev: NewsZeroState | null = null;
    try {
      const [rows] = await getPool().query<(RowDataPacket & { value: unknown })[]>(
        'SELECT value FROM system_config WHERE `key` = ? LIMIT 1',
        [key],
      );
      if (Array.isArray(rows) && rows.length > 0) {
        prev = parseNewsZeroState(rows[0].value);
        if (!prev) console.warn(`${LOG} ${key} 저장 값이 손상돼 이전 기록 없음(0)으로 보고 새로 센다`);
      }
    } catch (e) {
      console.warn(`${LOG} ${key} 읽기 실패 — 이번 관측은 세지 않음: ${e instanceof Error ? e.message : String(e)}`);
      return fallback;
    }

    if (prev && prev.lastDate !== today) {
      const gap = calendarDaysBetween(prev.lastDate, today);
      if (gap !== null && gap < 0) console.warn(`${LOG} ${key} 날짜 역행(마지막 ${prev.lastDate} > 오늘 ${today}) — 서버 시계 확인 필요, 연속을 새로 시작`);
      else if (gap !== null && gap > NEWS_ZERO_MAX_GAP_DAYS) console.log(`${LOG} ${key} 관측 공백 ${gap}일(> ${NEWS_ZERO_MAX_GAP_DAYS}) — 연속을 새로 시작`);
    }
    const next = nextNewsZeroState(prev, count, today);

    try {
      await getPool().query(
        'INSERT INTO system_config (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [key, JSON.stringify(next)],
      );
    } catch (e) {
      console.warn(`${LOG} ${key} 저장 실패 — 이번 관측은 세지 않음: ${e instanceof Error ? e.message : String(e)}`);
      return fallback;
    }

    const threshold = resolveNewsZeroAlertStreak();
    let alerted = false;
    if (next.streak >= threshold) {
      const { title, body } = buildNewsZeroAlert(channel, market, next, threshold);
      alerted = sendAlertThrottled(newsZeroAlertKey(channel, market), 'warning', title, body, NEWS_ZERO_ALERT_TTL_MS);
      console.warn(`${LOG} ${channel}:${market} 0 관측 ${next.streak}일 연속(기준 ${threshold}) alerted=${alerted}`);
    } else if (count === 0) {
      console.log(`${LOG} ${channel}:${market} 0 관측 — 연속 ${next.streak}일(기준 ${threshold})`);
    }
    return { streak: next.streak, alerted };
  } catch (e) {
    console.warn(`${LOG} 예외 흡수: ${e instanceof Error ? e.message : String(e)}`);
    return fallback;
  }
}
