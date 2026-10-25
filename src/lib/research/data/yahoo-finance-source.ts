/**
 * Yahoo Finance 비공식 chart API 일봉 조회 — T-032.
 *
 * 배경: Stooq CSV는 JS Proof-of-Work 봇 차단에 막혀 서버 `fetch()`로 받을 수 없다(실측).
 * Yahoo chart API는 **브라우저 User-Agent 헤더가 있어야** 200을 준다(없으면 429).
 *
 * 방어 구조는 `src/lib/exchanges/fx.ts`(외부 API 폴백 체인, 키 불필요)를 차용:
 *  - 호스트 폴백(query1 → query2)
 *  - 타임아웃(AbortSignal.timeout)
 *  - 실패는 예외로 올리되 사유를 문자열로 남긴다(호출자가 심볼 단위로 흡수)
 *
 * 분할·배당 보정: `adjclose`를 종가로 쓰고, 같은 비율을 OHL에도 곱한다.
 * 원본 종가를 그대로 쓰면 액면분할이 가짜 폭락으로 잡혀 랠리 탐지가 통째로 오염된다.
 */
import type { DailyCandle } from '../types';
import { toYahooPathSegment } from './symbol-validation';
import { trackCall } from '@/lib/api-usage';

const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];

/** Yahoo는 UA가 없으면 429를 준다 — 실측 확인된 필수 헤더. */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const DEFAULT_TIMEOUT_MS = 8000;

export interface YahooFetchOptions {
  /** '1y' | '2y' | '5y' | '10y' | 'max' — 기본 '5y' */
  range?: string;
  timeoutMs?: number;
  /** 테스트 주입용 */
  fetchImpl?: typeof fetch;
}

interface YahooChartQuote {
  open?: (number | null)[];
  high?: (number | null)[];
  low?: (number | null)[];
  close?: (number | null)[];
  volume?: (number | null)[];
}

interface YahooChartResult {
  meta?: { gmtoffset?: number };
  timestamp?: number[];
  indicators?: {
    quote?: YahooChartQuote[];
    adjclose?: { adjclose?: (number | null)[] }[];
  };
}

interface YahooChartResponse {
  chart?: {
    result?: YahooChartResult[] | null;
    error?: { code?: string; description?: string } | null;
  };
}

/** epoch초 + 거래소 offset → 거래소 현지 'YYYY-MM-DD' */
export function toLocalDateString(epochSec: number, gmtOffsetSec: number): string {
  const d = new Date((epochSec + gmtOffsetSec) * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Yahoo chart 응답 → 조정 완료 일봉 배열. 파싱 전담(테스트 대상). */
export function parseYahooChart(body: unknown): DailyCandle[] {
  const res = (body as YahooChartResponse)?.chart?.result;
  if (!Array.isArray(res) || res.length === 0) return [];
  const r = res[0];
  const ts = r.timestamp;
  const quote = r.indicators?.quote?.[0];
  if (!Array.isArray(ts) || !quote) return [];

  const adj = r.indicators?.adjclose?.[0]?.adjclose;
  const gmtOffset = Number(r.meta?.gmtoffset ?? 0) || 0;

  const out: DailyCandle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const close = quote.close?.[i];
    const open = quote.open?.[i];
    const high = quote.high?.[i];
    const low = quote.low?.[i];
    const volume = quote.volume?.[i];
    // 휴장·결측 봉은 통째로 버린다 — 보간하면 없는 가격 움직임을 만들어낸다.
    if (
      close == null || open == null || high == null || low == null ||
      !Number.isFinite(close) || !Number.isFinite(open) ||
      !Number.isFinite(high) || !Number.isFinite(low) || close <= 0
    ) continue;

    const adjClose = adj?.[i];
    const factor = adjClose != null && Number.isFinite(adjClose) && adjClose > 0 ? adjClose / close : 1;

    out.push({
      date: toLocalDateString(ts[i], gmtOffset),
      open: open * factor,
      high: high * factor,
      low: low * factor,
      close: close * factor,
      volume: volume != null && Number.isFinite(volume) ? volume : 0,
    });
  }

  // Yahoo는 오름차순으로 주지만 계약으로 보장되지 않으므로 명시 정렬(탐지 알고리즘이 순서에 의존).
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

/**
 * 일봉 이력 조회. 성공 시 오름차순 조정 일봉 배열, 데이터가 없으면 빈 배열.
 * 네트워크·HTTP 실패는 예외로 던진다(마지막 호스트 사유 포함).
 */
export async function fetchYahooDailyHistory(
  yahooSymbol: string,
  opts: YahooFetchOptions = {},
): Promise<DailyCandle[]> {
  const seg = toYahooPathSegment(yahooSymbol); // allowlist 통과 + encodeURIComponent 이중 방어
  const range = opts.range ?? '5y';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = opts.fetchImpl ?? fetch;

  let lastErr = '';
  for (const host of HOSTS) {
    const url = `${host}/v8/finance/chart/${seg}?range=${encodeURIComponent(range)}&interval=1d&events=div%2Csplit`;
    try {
      // T-040 호출 기록 — 종목·URL 은 남기지 않는다(op 는 상수). 호스트별 시도 1번 = 한 줄.
      const res = await trackCall('yahoo-finance', 'chart.daily', () => doFetch(url, {
        headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      }));
      if (!res.ok) {
        lastErr = `HTTP ${res.status} from ${host}`;
        continue;
      }
      const body = await res.json();
      const errDesc = (body as YahooChartResponse)?.chart?.error?.description;
      if (errDesc) {
        lastErr = `yahoo error: ${errDesc}`;
        continue;
      }
      const candles = parseYahooChart(body);
      if (candles.length > 0) return candles;
      lastErr = `empty series from ${host}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`yahoo fetch failed for ${yahooSymbol}: ${lastErr || 'unknown'}`);
}
