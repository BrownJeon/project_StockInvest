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
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cron-auth';
import { sendAlertThrottled } from '@/lib/notify/throttle';

export const dynamic = 'force-dynamic';

const MARKETS = ['domestic', 'overseas'] as const;
type Market = (typeof MARKETS)[number];

const NEWS_FETCH_LIMIT = 20;
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

async function fetchNewsOnce(base: string, adminToken: string, market: Market): Promise<number> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/v1/news/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken },
      body: JSON.stringify({ market, limit: NEWS_FETCH_LIMIT }),
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json().catch(() => ({}))) as { upserted?: number };
    return data.upserted ?? 0;
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`timeout after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMarketWithRetry(base: string, adminToken: string, market: Market): Promise<MarketResult> {
  let lastError = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const upserted = await fetchNewsOnce(base, adminToken, market);
      console.log(`[cron/news-fetch] ${market} OK upserted=${upserted} attempt=${attempt}`);
      return { market, ok: true, upserted, attempts: attempt };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      console.error(`[cron/news-fetch] ${market} FAILED attempt=${attempt}/${MAX_ATTEMPTS} error=${lastError}`);
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_BACKOFF_MS);
      }
    }
  }
  return { market, ok: false, upserted: 0, attempts: MAX_ATTEMPTS, error: lastError };
}

export async function POST(req: NextRequest) {
  const authErr = checkCronAuth(req);
  if (authErr) return authErr;

  try {
    const base = resolveM4Base();
    const adminToken = resolveM4AdminToken();

    // Fail-safe: 설정 누락은 무한 재시도·크래시가 아니라 알림 1회 후 조용히 종료한다.
    // (M4_ADMIN_TOKEN 이 비어 있으면 매 attempt 가 어차피 401로 실패할 뿐이라, 3회 재시도 ×
    //  2개 시장을 낭비할 이유가 없다.)
    if (!adminToken) {
      const msg = 'M4_ADMIN_TOKEN(또는 ADMIN_TOKEN) 미설정 — news-fetch 스킵';
      console.error(`[cron/news-fetch] ${msg}`);
      sendAlertThrottled('news-fetch:config', 'critical', 'news-fetch 설정 오류', msg);
      return NextResponse.json({ ok: false, error: msg, markets: [] });
    }

    console.log(`[cron/news-fetch] start base=${base}`);
    const results = await Promise.all(MARKETS.map((market) => fetchMarketWithRetry(base, adminToken, market)));
    const failed = results.filter((r) => !r.ok);

    if (failed.length > 0) {
      const allFailed = failed.length === MARKETS.length;
      const summary = failed.map((r) => `${r.market}: ${r.error}`).join('; ');
      sendAlertThrottled(
        allFailed ? 'news-fetch:all_failed' : 'news-fetch:partial_failed',
        allFailed ? 'critical' : 'warning',
        allFailed ? 'news-fetch 전체 실패' : 'news-fetch 부분 실패',
        `M4 뉴스 KB 갱신 실패 (${failed.length}/${MARKETS.length}개 시장, 시장별 최대 ${MAX_ATTEMPTS}회 시도 후)\n${summary}`,
      );
    }

    const ok = failed.length === 0;
    console.log(`[cron/news-fetch] done ok=${ok}`, results);
    return NextResponse.json({ ok, markets: results });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[cron/news-fetch] fatal error:', e);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
