/**
 * T-070 `POST /api/cron/daily-bars` 본문 검증 — 모르는 키·형식 오류는 거부(KIS·DB 호출 0). 빈 본문은 기본값.
 * (T-170) 쿼리 `?market=KR|US` 도 받는다(`parseDailyBarsRequest`) — 모르는 쿼리 키·중복·본문과 겹침은 거부.
 * (Next.js 라우트 파일은 라우트 외 이름을 export 할 수 없어 여기 둔다.)
 */
import { MAX_CALLS_CAP, MAX_YEARS, ROUTE_SYMBOL_MAX_LEN, ROUTE_SYMBOL_PATTERN, type CollectOptions } from './daily-bars-collector';
import { MAX_SIGNAL_TARGETS } from './daily-bars-store';

export type ParsedDailyBarsBody = { ok: true; opts: CollectOptions } | { ok: false; error: string };

const ALLOWED_KEYS = ['symbols', 'years', 'maxCalls', 'market'];
/** (T-170) 기본 대상 시장 필터 허용값. */
const MARKETS = ['KR', 'US'] as const;

function isInt(v: unknown, lo: number, hi: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
}

export function parseDailyBarsBody(raw: unknown): ParsedDailyBarsBody {
  if (raw === null || raw === undefined) return { ok: true, opts: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'body must be an object' };
  const b = raw as Record<string, unknown>;
  const unknownKeys = Object.keys(b).filter((k) => !ALLOWED_KEYS.includes(k));
  if (unknownKeys.length) return { ok: false, error: `unknown keys: ${unknownKeys.join(',').slice(0, 80)}` };
  const opts: CollectOptions = {};
  if (b.symbols !== undefined) {
    if (!Array.isArray(b.symbols) || b.symbols.length === 0 || b.symbols.length > MAX_SIGNAL_TARGETS) {
      return { ok: false, error: `symbols must be a non-empty array (<=${MAX_SIGNAL_TARGETS})` };
    }
    const bad = b.symbols.filter((s) => typeof s !== 'string' || s.length > ROUTE_SYMBOL_MAX_LEN || !ROUTE_SYMBOL_PATTERN.test(s));
    if (bad.length) return { ok: false, error: `invalid symbols: ${bad.slice(0, 5).map((x) => String(x).slice(0, 40)).join(',').slice(0, 80)}` };
    opts.symbols = [...new Set(b.symbols as string[])];
  }
  if (b.years !== undefined) {
    if (!isInt(b.years, 1, MAX_YEARS)) return { ok: false, error: `years must be an integer 1..${MAX_YEARS}` };
    opts.years = b.years;
  }
  if (b.maxCalls !== undefined) {
    if (!isInt(b.maxCalls, 1, MAX_CALLS_CAP)) return { ok: false, error: `maxCalls must be an integer 1..${MAX_CALLS_CAP}` };
    opts.maxCalls = b.maxCalls;
  }
  // (T-170) market = 기본 대상(보유 → 분석 목록 → 시그널)을 한 시장으로 좁힌다. symbols 를 직접 주면 그 목록이 곧 대상이라 함께 쓸 수 없다.
  if (b.market !== undefined) {
    if (typeof b.market !== 'string' || !(MARKETS as readonly string[]).includes(b.market)) {
      return { ok: false, error: `market must be one of ${MARKETS.join('|')}` };
    }
    if (opts.symbols) return { ok: false, error: 'market cannot be combined with symbols' };
    opts.market = b.market as (typeof MARKETS)[number];
  }
  return { ok: true, opts };
}

/**
 * (T-170) 쿼리까지 합쳐 검증한다. 쿼리 `market` 은 본문 `market` 과 같은 뜻이다.
 * 왜 쿼리도 받나: cron-runner 의 call() 은 셋째 인자(본문)를 넘기면 끝에 `}` 를 하나 더 붙인다(`local body="${3:-{}}"` —
 *   bash 가 기본값 `{` 뒤의 첫 `}` 에서 확장을 닫아 나머지 `}` 가 글자로 남는다. 지금까지 본문을 넘긴 호출이 없어 드러나지 않았다).
 *   call() 은 모든 잡(주문 잡 포함)이 쓰므로 고치지 않고, 국내 저녁 실행은 뉴스 수집 잡처럼(`?market=`) 쿼리로 시장을 넘긴다.
 * 거부(400): 모르는 쿼리 키 · market 을 두 번 · 본문에도 market · 본문이 객체가 아님 · (본문과 같은 규칙) 값이 KR|US 아님 · symbols 와 함께.
 */
export function parseDailyBarsRequest(raw: unknown, query: URLSearchParams): ParsedDailyBarsBody {
  const keys = [...new Set(query.keys())];
  const unknownQ = keys.filter((k) => k !== 'market');
  if (unknownQ.length) return { ok: false, error: `unknown query keys: ${unknownQ.join(',').slice(0, 80)}` };
  const qm = query.getAll('market');
  if (qm.length === 0) return parseDailyBarsBody(raw);
  if (qm.length > 1) return { ok: false, error: 'market query must be given once' };
  if (raw === null || raw === undefined) return parseDailyBarsBody({ market: qm[0] });
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'body must be an object' };
  if (Object.prototype.hasOwnProperty.call(raw, 'market')) return { ok: false, error: 'market cannot be given in both query and body' };
  return parseDailyBarsBody({ ...(raw as Record<string, unknown>), market: qm[0] });
}
