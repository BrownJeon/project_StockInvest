/**
 * POST /api/cron/news-fetch — M4 KB news.kr_market + news.us_market RSS 갱신 (T-036).
 *
 * ## 이관 배경 — 107일 무성 실패
 *
 * 원래 `scripts/cron-runner.sh` 가 bash 안에서 직접 M4 API를 curl 호출했다(다른 11개 cron
 * 잡과 달리 라우트를 거치지 않는 유일한 예외). 재시도·타임아웃·실패 알림이 전부 없었고,
 * 뉴스 KB의 마지막 성공 갱신은 2026-05-13, 이후 107일간 매일 실패했지만 아무도 몰랐다
 * (실측 누적 실패 12,060건 / 성공 2건). `src/lib/rag/retrieval.ts`가 이 KB를 전략 분석 RAG
 * 입력으로 먹이므로, 그 107일 내내 낡은 뉴스로 분석이 진행되고 있었다.
 *
 * 게다가 날짜파일(dedup) 기록이 **성공했을 때만** 이루어져, 실패가 지속되면 그 시각 한 시간
 * 내내 매분 재시도해 낭비 호출이 폭주했다. 이제 `cron-runner.sh` 는 성공·실패 무관하게
 * 하루 1회만 이 라우트를 호출하고 날짜파일을 기록한다(cron-runner.sh 주석 참고) — 일시 장애
 * 흡수(제한적 재시도)는 이 라우트가 시장별로 담당한다. 실패를 조용히 삼키지 않는 것은
 * 재시도가 아니라 알림의 역할이므로, 부분/전체 실패는 `sendAlertThrottled`로 통지한다.
 *
 * ## 인증
 *
 * 다른 cron 라우트와 동일하게 `checkCronAuth()` (x-cron-secret 헤더, fail-closed).
 *
 * ## HTTP 상태 코드
 *
 * 날짜파일이 이제 성공/실패 무관하게 기록되므로, 이 라우트가 500을 반환해도 cron-runner의
 * 재시도 폭주로 이어지지 않는다. 다른 cron 라우트(post-market-analysis, research-cycle-*)의
 * 관례를 그대로 따라 — 예상된 부분/전체 실패는 본문에서 흡수해 200으로 응답하고(호출자가
 * 결과를 파싱해 판단), 프로그램 오류 등 진짜 예외만 500으로 흡수한다.
 *
 * ## 시장 지정 — `?market=domestic|overseas` (T-103)
 *
 * cron-runner 는 06시에 두 시장을 **서로 다른 틱의 독립 잡**으로 부른다(news-fetch-overseas →
 * news-fetch-domestic, 날짜파일·알림 키도 따로). 같은 틱에 두 번 순차 호출하면 최악 약 372초로
 * 하트비트 워치독 한도(300초)를 넘기 때문이다(cron-runner.sh 06시 블록 주석 참고).
 *  - `market` 미지정: **기존과 동일하게 두 시장 모두** 병렬 처리(하위 호환 — 수동 호출·배포 중 옛 러너·롤백).
 *    알림 키·심각도도 그대로(`news-fetch:partial_failed` warning / `news-fetch:all_failed` critical).
 *  - `market` 지정: 그 시장 하나만. 응답 형식은 같다(`markets` 배열 길이 1). 전량 실패 시
 *    `news-fetch:<market>:failed` critical — 한 시장 전체 실패도 숨기지 않는다(T-036 교훈).
 *  - 허용 밖 값(빈 값·대소문자 다름 포함): 인증 통과 **후** `400 invalid_market`, M4 호출 0.
 *  - 인증이 항상 먼저, 토큰 누락 fail-safe(알림 1회 후 스킵)는 시장 지정 여부와 무관하게 그대로.
 *
 * ## 건수·국내 두 번째 수집 (T-115)
 *
 * M4 요청 `limit` 은 시장별 상수 `NEWS_FETCH_LIMITS`(국내 100·해외 100). cron-runner 는 국내를 06시에 더해 **15:30~15:59 에
 * 한 번 더**(`news-fetch-domestic-pm`) 부른다 — 장중 기사가 16:00 국내 분석 전에 KB 에 들어가게. 라우트 동작은 호출 시각과 무관하다.
 *
 * ## 뉴스 0건 연속 감시 (T-106)
 *
 * 시장별 결과가 확정되고 기존 실패 알림을 보낸 뒤, `recordNewsOutcome({channel:'fetch'})` 로 그 시장의 건수를 기록한다
 * (실패 소진 = 0, 성공 = M4 응답의 숫자 `fresh` 가 있으면 그것, 없으면 `upserted`). 같은 시장 연속 3일 0건이면
 * `news-zero:fetch:<market>` warning. 기록 실패는 응답·재시도·기존 알림에 영향 0. 토큰 누락 스킵·400 은 기록하지 않는다.
 *
 * ## 뉴스 최초 관측 캡처 (T-116) — `?mode=peek` 와 ingest 의 `items`
 *
 * M4(task-009)는 응답에 기사 메타 `items[]` 를 싣는다. 이것을 `src/lib/corp-intel/raw-capture.ts` 의 `captureFetchOutcome` 으로
 * `ci_raw_item` 에 남긴다(스위치 `system_config.ci_capture_enabled`, 키 없음 = 꺼짐). 캡처는 **가산 전용**이다 — 캡처가 실패하거나
 * 던져도 응답·HTTP 상태·재시도·알림은 그대로다(캡처 함수 자체도 던지지 않고, 스위치 읽기·저장·상태 기록이 **마감 하나를 공유해 합계 4초**
 * 안에 돌아온다 — Leader 결정 Q8. peek 는 M4 호출 전 스위치 확인에 따로 최대 4초를 더 쓴다).
 *  - `mode` 쿼리: 정확히 `peek` 이면 peek, 그 밖의 값·없음은 ingest(기존 동작). 인증 → `market` 검사(400) 뒤에 해석한다.
 *  - **ingest**(06시·T-115 15:30): 동작·요청 본문(`{market, limit}`)·응답 형식·재시도·알림·T-106 기록 전부 그대로. 시장별 결과가
 *    확정되고 기존 알림을 보낸 뒤 T-106 기록과 **병렬로** 캡처한다 — M4 가 성공했고 응답에 `items` 가 있을 때만 저장(+ 상태
 *    `ci_capture_status:<market>`), 없거나(구 M4) 재시도 소진 실패면 캡처 모듈을 부르지 않는다(실패는 기존 알림이 알린다).
 *  - **peek**(T-116 러너 블록 — 낮 시간 7회): 스위치가 꺼져 있으면 **M4 를 부르지 않고** `{ok:true, skipped:'capture_disabled'}`(200).
 *    켜져 있으면 요청 본문에 `mode:'peek'` 를 실어(임베딩·upsert 없이 피드만 읽음) 재시도 규칙 그대로 부르고 `items` 를 캡처한다.
 *    🔴 peek 결과는 `recordNewsOutcome({channel:'fetch'})` 에 **넘기지 않는다** — peek 응답은 항상 `upserted: 0` 이라 T-106 수집 0건
 *    감시에 거짓 경고가 난다(M4 계약 §9.8 호출자 주의 ①). peek 실패는 `news-fetch:*` 알림을 내지 않고(06시 ingest 가 같은 장애를
 *    알린다) 로그 + 캡처 상태의 `consecutiveFailures` 만 올린다. 토큰 누락도 peek 에서는 설정 알림 없이 로그만 남기고 끝낸다.
 *    peek 응답 형식: `{ ok, mode:'peek', markets, capture:[{market, status, inserted, duplicates, rejected}] }`. capture.status 는
 *    캡처 결과(ok·skipped_no_table·failed …)이고, 저장은 했지만 공유 마감 때문에 상태 기록을 건너뛰었으면 `partial` 이다
 *    (저장을 건너뛰었으면 `failed`).
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cron-auth';
import { trackCall } from '@/lib/api-usage';
import { sendAlertThrottled } from '@/lib/notify/throttle';
import { recordNewsOutcome } from '@/lib/rag/news-health';
import { captureFetchOutcome, readCaptureSwitch, type CaptureFetchOutcomeResult } from '@/lib/corp-intel/raw-capture';

export const dynamic = 'force-dynamic';

const MARKETS = ['domestic', 'overseas'] as const;
type Market = (typeof MARKETS)[number];
/** 알림 본문용 시장 이름. */
const MARKET_LABEL: Record<Market, string> = { domestic: '국내', overseas: '해외' };

/**
 * `?market=` 해석 (T-103). 없으면 두 시장(하위 호환), 허용 값이면 그 시장 하나, 그 밖이면 null(→ 400).
 * `nextUrl` 이 없는 최소 요청 객체(기존 시험의 `{}`)는 미지정과 같게 본다 — 운영 Next 요청에는 항상 있다.
 */
function resolveTargetMarkets(req: NextRequest): readonly Market[] | null {
  const raw = req.nextUrl?.searchParams.get('market') ?? null;
  if (raw === null) return MARKETS;
  const hit = MARKETS.find((m) => m === raw);
  return hit ? [hit] : null;
}

type FetchMode = 'ingest' | 'peek';
/** (T-116) `?mode=` 해석 — 정확히 'peek' 만 peek, 그 밖(없음·빈 값·대소문자 다름 포함)은 ingest. nextUrl 없는 최소 요청도 ingest. */
function resolveMode(req: NextRequest): FetchMode {
  return req.nextUrl?.searchParams.get('mode') === 'peek' ? 'peek' : 'ingest';
}

/**
 * 시장별 M4 요청 건수(`limit`) — T-115 에서 두 시장 공통 20 → 시장별 100(M4 요청 상한 100).
 * 근거(T-115): 연합뉴스 경제 피드는 약 120건·약 6.6시간 창이라 20건이면 최근 약 50분뿐이고, 해외 4개 피드(합계 약 80건)는
 * 20 이면 피드당 5건뿐이었다. M4 임베딩 평균 0.07초 × 100 ≈ 7초라 시도당 상한(60초) 안이다. 재시도·상한·대기는 그대로.
 * export 하지 않는다 — Next App Router 는 route.ts 의 HTTP 메서드·설정 외 export 를 빌드 타입 검사에서 거부한다.
 * 시험은 요청 본문의 `limit` 으로 값을 확인한다.
 */
const NEWS_FETCH_LIMITS: Readonly<Record<Market, number>> = { domestic: 100, overseas: 100 };
/** 시장별 최대 2회 재시도 = 최초 시도 포함 총 3회. */
const MAX_ATTEMPTS = 3;
/** bash 원본의 `--max-time 60` 과 동일 — 시도당 상한. */
const REQUEST_TIMEOUT_MS = 60_000;
/** 재시도 사이 고정 대기. 하루 1회 잡이라 지수 백오프까지는 불필요. */
const RETRY_BACKOFF_MS = 3_000;

interface MarketResult {
  market: Market;
  ok: boolean;
  upserted: number;
  attempts: number;
  error?: string;
}

/**
 * (T-106) 시장별 결과 + 응답에 싣지 않는 내부 값. `fresh` = M4 가 알려 준 "최근 3일 날짜를 가진 항목 수"
 * (M4 task-008 이 추가 예정 — 숫자가 아니면 undefined). 응답 형식(`markets`)은 바꾸지 않는다.
 */
interface MarketOutcome {
  result: MarketResult;
  fresh?: number;
  /** (T-116) M4 응답의 `items`(배열일 때만) — 캡처 전용, 응답에 싣지 않는다. */
  items?: unknown[];
}

/** M4 응답의 선택 필드 `fresh` — 0 이상 유한한 숫자일 때만 인정. */
function readFresh(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/**
 * (T-106) 뉴스 0건 연속 감시용 건수. 실패(재시도 소진) = 0, 성공 = `fresh` 가 있으면 그것, 없으면 `upserted`.
 * (`upserted` 만 보면 낡은 기사 재저장도 20 으로 보인다 — T-105.)
 */
function newsHealthCount(o: MarketOutcome): number {
  if (!o.result.ok) return 0;
  return o.fresh ?? o.result.upserted;
}

/** (T-106) 감시 기록 — 실패해도 라우트 응답·재시도·기존 알림에 영향 0(recordNewsOutcome 자체도 던지지 않는다). */
async function recordFetchHealth(outcomes: MarketOutcome[]): Promise<void> {
  await Promise.all(outcomes.map(async (o) => {
    try {
      await recordNewsOutcome({ channel: 'fetch', market: o.result.market, count: newsHealthCount(o) });
    } catch (e) {
      console.warn(`[cron/news-fetch] ${o.result.market} 뉴스 0건 감시 기록 실패(무시): ${e instanceof Error ? e.message : String(e)}`);
    }
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** m4-kb.ts의 기존 관례(getKbClient)와 동일한 폴백 순서. */
function resolveM4Base(): string {
  return process.env.AI_API_BASE ?? 'http://192.168.219.100:8000';
}
function resolveM4AdminToken(): string {
  return process.env.M4_ADMIN_TOKEN ?? process.env.ADMIN_TOKEN ?? '';
}

async function fetchNewsOnce(
  base: string, adminToken: string, market: Market, mode: FetchMode = 'ingest',
): Promise<{ upserted: number; fresh?: number; items?: unknown[] }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  // (T-116) ingest 본문은 기존과 같은 {market, limit} — peek 만 mode 를 싣는다.
  const reqBody = mode === 'peek'
    ? { market, limit: NEWS_FETCH_LIMITS[market], mode: 'peek' }
    : { market, limit: NEWS_FETCH_LIMITS[market] };
  try {
    // T-040 호출 기록 — 시도 1번 = 한 줄(재시도 루프 안쪽). 자체 타이머 abort 는 timeout.
    const res = await trackCall('m4', 'news.fetch', () => fetch(`${base}/v1/news/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken },
      body: JSON.stringify(reqBody),
      signal: ctrl.signal,
      cache: 'no-store',
    }), { err: () => (ctrl.signal.aborted ? 'timeout' : undefined) });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json().catch(() => ({}))) as { upserted?: number; fresh?: unknown; items?: unknown };
    return {
      upserted: data.upserted ?? 0,
      fresh: readFresh(data.fresh),
      items: Array.isArray(data?.items) ? (data.items as unknown[]) : undefined,
    };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`timeout after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMarketWithRetry(base: string, adminToken: string, market: Market, mode: FetchMode = 'ingest'): Promise<MarketOutcome> {
  let lastError = '';
  const tag = mode === 'peek' ? `${market} peek` : market;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { upserted, fresh, items } = await fetchNewsOnce(base, adminToken, market, mode);
      console.log(`[cron/news-fetch] ${tag} OK upserted=${upserted} attempt=${attempt}` + (fresh !== undefined ? ` fresh=${fresh}` : '')
        + (mode === 'peek' && items !== undefined ? ` items=${items.length}` : ''));   // ingest 로그 줄은 기존과 같다
      return { result: { market, ok: true, upserted, attempts: attempt }, fresh, items };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      console.error(`[cron/news-fetch] ${tag} FAILED attempt=${attempt}/${MAX_ATTEMPTS} error=${lastError}`);
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_BACKOFF_MS);
      }
    }
  }
  return { result: { market, ok: false, upserted: 0, attempts: MAX_ATTEMPTS, error: lastError } };
}

/** (T-116) 캡처 1건 — 캡처 함수는 원래 던지지 않지만, 던져도 여기서 흡수한다(응답·재시도·알림 영향 0). */
async function safeCapture(market: Market, mode: FetchMode, o: MarketOutcome, assumeEnabled: boolean): Promise<CaptureFetchOutcomeResult> {
  try {
    return await captureFetchOutcome({ market, mode, ok: o.result.ok, items: o.items, assumeEnabled });
  } catch (e) {
    console.warn(`[cron/news-fetch] ${market} ${mode} 캡처 실패(무시): ${e instanceof Error ? e.message : String(e)}`);
    return { capture: null, status: null, deadline: 'ok' };
  }
}

/**
 * (T-116) ingest 의 캡처 — **성공했고 `items` 배열이 있을 때만** 부른다. 구 M4(items 없음)·재시도 소진 실패는 캡처 모듈을 부르지 않는다
 * (실패는 이미 news-fetch:* 알림이 알린다 — ingest 경로에 DB 접근을 하나도 늘리지 않는다). 스위치는 captureFetchOutcome 이 읽는다(꺼짐 = 무동작).
 */
async function captureIngest(outcomes: MarketOutcome[]): Promise<void> {
  await Promise.all(outcomes.map((o) => {
    if (!o.result.ok || o.items === undefined) return undefined;
    return safeCapture(o.result.market, 'ingest', o, false);
  }));
}

/**
 * (T-116) peek — 스위치 확인(꺼짐 = M4 호출 0) → 시장별 M4 peek(재시도 규칙 그대로) → 캡처.
 * 🔴 recordNewsOutcome 를 부르지 않고, news-fetch:* 알림을 내지 않는다(머리 주석).
 */
async function handlePeek(targets: readonly Market[], single: Market | null): Promise<NextResponse> {
  let enabled = false;
  let source = 'read_error';
  try {
    const sw = await readCaptureSwitch();
    enabled = sw.enabled;
    source = sw.source;
  } catch { /* 꺼짐으로 본다 */ }
  if (!enabled) {
    console.log(`[cron/news-fetch] peek 건너뜀 — 캡처 스위치 꺼짐(ci_capture_enabled: ${source}), M4 호출 없음` + (single ? ` market=${single}` : ''));
    return NextResponse.json({ ok: true, skipped: 'capture_disabled' });
  }

  const base = resolveM4Base();
  const adminToken = resolveM4AdminToken();
  if (!adminToken) {
    const msg = 'M4_ADMIN_TOKEN(또는 ADMIN_TOKEN) 미설정 — news-fetch peek 스킵(알림은 06시 ingest 가 낸다)' + (single ? ` (market=${single})` : '');
    console.error(`[cron/news-fetch] ${msg}`);
    return NextResponse.json({ ok: false, mode: 'peek', error: msg, markets: [] });
  }

  console.log(`[cron/news-fetch] peek start base=${base}` + (single ? ` market=${single}` : ''));
  const outcomes = await Promise.all(targets.map((market) => fetchMarketWithRetry(base, adminToken, market, 'peek')));
  const results = outcomes.map((o) => o.result);
  for (const r of results) {
    if (!r.ok) console.error(`[cron/news-fetch] peek ${r.market} 실패(알림 없음 — 캡처 상태에 실패로 센다): ${r.error}`);
  }
  const caps = await Promise.all(outcomes.map((o) => safeCapture(o.result.market, 'peek', o, true)));
  const capture = outcomes.map((o, i) => {
    const c = caps[i].capture;
    // 저장은 했는데(ok) 공유 마감 때문에 상태 기록만 건너뛰었으면 partial — 저장을 건너뛴 경우는 capture.status 가 이미 failed.
    const status = c?.status === 'ok' && caps[i].deadline === 'status_skipped'
      ? 'partial'
      : c?.status ?? (!o.result.ok ? 'fetch_failed' : o.items === undefined ? 'no_items' : 'failed');
    return { market: o.result.market, status, inserted: c?.inserted ?? 0, duplicates: c?.duplicates ?? 0, rejected: c?.rejected ?? 0 };
  });
  const ok = results.every((r) => r.ok);
  console.log(`[cron/news-fetch] peek done ok=${ok}`, capture);
  return NextResponse.json({ ok, mode: 'peek', markets: results, capture });
}

export async function POST(req: NextRequest) {
  const authErr = checkCronAuth(req);
  if (authErr) return authErr;

  try {
    // (T-103) 시장 지정 해석 — 인증 뒤, 설정 확인·M4 호출 전. 허용 밖 값은 아무것도 하지 않고 400.
    const targets = resolveTargetMarkets(req);
    if (targets === null) {
      console.error('[cron/news-fetch] invalid market param — 400, M4 호출 없음');
      return NextResponse.json({ ok: false, error: 'invalid_market' }, { status: 400 });
    }
    const single: Market | null = targets.length === 1 ? targets[0] : null;

    // (T-116) peek 은 별도 경로 — 스위치 꺼짐이면 M4 호출 0, T-106 기록·news-fetch:* 알림 없음.
    if (resolveMode(req) === 'peek') return await handlePeek(targets, single);

    const base = resolveM4Base();
    const adminToken = resolveM4AdminToken();

    // Fail-safe: 설정 누락은 무한 재시도·크래시가 아니라 알림 1회 후 조용히 종료한다.
    // (M4_ADMIN_TOKEN 이 비어 있으면 매 attempt 가 어차피 401로 실패할 뿐이라, 3회 재시도 ×
    //  2개 시장을 낭비할 이유가 없다.) 시장 지정 호출도 같은 키·심각도 — 메시지에 시장만 덧붙인다.
    if (!adminToken) {
      const msg = 'M4_ADMIN_TOKEN(또는 ADMIN_TOKEN) 미설정 — news-fetch 스킵' + (single ? ` (market=${single})` : '');
      console.error(`[cron/news-fetch] ${msg}`);
      sendAlertThrottled('news-fetch:config', 'critical', 'news-fetch 설정 오류', msg);
      return NextResponse.json({ ok: false, error: msg, markets: [] });
    }

    console.log(`[cron/news-fetch] start base=${base}` + (single ? ` market=${single}` : ''));
    const outcomes = await Promise.all(targets.map((market) => fetchMarketWithRetry(base, adminToken, market)));
    const results = outcomes.map((o) => o.result);
    const failed = results.filter((r) => !r.ok);

    if (single && failed.length > 0) {
      // (T-103) 시장 지정 호출의 전량 소진 실패 — 부분 실패가 있을 수 없으므로 critical 한 종류.
      const r = failed[0];
      const name = `${MARKET_LABEL[r.market]}(${r.market})`;
      sendAlertThrottled(
        `news-fetch:${r.market}:failed`,
        'critical',
        `news-fetch ${name} 실패`,
        `M4 뉴스 KB 갱신 실패 — ${name} 시장, 최대 ${MAX_ATTEMPTS}회 시도 후\n${r.market}: ${r.error}`,
      );
    } else if (failed.length > 0) {
      // 두 시장(미지정) 경로 — 기존 키·심각도·문구 그대로.
      const allFailed = failed.length === MARKETS.length;
      const summary = failed.map((r) => `${r.market}: ${r.error}`).join('; ');
      sendAlertThrottled(
        allFailed ? 'news-fetch:all_failed' : 'news-fetch:partial_failed',
        allFailed ? 'critical' : 'warning',
        allFailed ? 'news-fetch 전체 실패' : 'news-fetch 부분 실패',
        `M4 뉴스 KB 갱신 실패 (${failed.length}/${MARKETS.length}개 시장, 시장별 최대 ${MAX_ATTEMPTS}회 시도 후)\n${summary}`,
      );
    }

    // (T-106) 시장별 결과 확정·기존 알림 뒤 — 뉴스 0건 연속 감시. 응답·기존 알림 키·심각도는 그대로.
    // (T-116) 같은 자리에서 캡처를 병렬로 — 감시 기록(4초 상한)과 캡처(공유 마감 4초)가 서로를 기다리지 않는다. 둘 다 던지지 않는다.
    await Promise.all([recordFetchHealth(outcomes), captureIngest(outcomes)]);

    const ok = failed.length === 0;
    console.log(`[cron/news-fetch] done ok=${ok}`, results);
    return NextResponse.json({ ok, markets: results });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[cron/news-fetch] fatal error:', e);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
