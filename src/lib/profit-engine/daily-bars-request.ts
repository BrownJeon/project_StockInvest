/**
 * T-070 `POST /api/cron/daily-bars` 본문 검증 — 모르는 키·형식 오류는 거부(KIS·DB 호출 0). 빈 본문은 기본값.
 * (Next.js 라우트 파일은 라우트 외 이름을 export 할 수 없어 여기 둔다.)
 */
import { MAX_CALLS_CAP, MAX_YEARS, ROUTE_SYMBOL_MAX_LEN, ROUTE_SYMBOL_PATTERN, type CollectOptions } from './daily-bars-collector';
import { MAX_SIGNAL_TARGETS } from './daily-bars-store';

export type ParsedDailyBarsBody = { ok: true; opts: CollectOptions } | { ok: false; error: string };

const ALLOWED_KEYS = ['symbols', 'years', 'maxCalls'];

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
  return { ok: true, opts };
}
