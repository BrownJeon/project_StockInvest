/**
 * SEC EDGAR 읽기 전용 HTTP 클라이언트 (T-059 Part A).
 *
 * ## SEC 접근 규칙 — https://www.sec.gov/os/accessing-edgar-data (조회 2026-10-20, T-057 §3)
 *  - 모든 요청에 "회사명 + 연락 이메일" User-Agent 를 선언한다 → `SEC_USER_AGENT` env.
 *    **값이 없거나 '@' 가 없으면 이 클라이언트를 만들 수 없다**(`readSecUserAgent()` 가 null) — 호출부는 SEC 를 부르지 않고 job 을 건너뛴다.
 *    연락처 없는 UA 가 `www.sec.gov/files/*` 403 의 원인이었다(T-057 Leader 기록 10-20 23:58).
 *  - 10 req/s 를 넘기지 않는다. 여기서는 **요청 시작 간격 ≥ 250ms(최대 4 req/s), 완전 직렬**이다.
 *    재시도도 같은 간격 게이트를 지난다. 동시에 여러 번 불러도 내부 체인이 한 줄로 세운다.
 *  - 429·403 은 **재시도하지 않는다.** SEC 의 한도 초과 차단은 약 10분 지속되고, 그동안 다시 때리면 차단이 길어진다.
 *    대신 프로세스 전역 쿨다운(10분 → 20분 → 40분 → 상한 60분, 연속 차단마다 2배 = "지수 백오프")을 걸고
 *    `SecBlockedError` 를 던진다. 호출한 job 은 이 오류를 받으면 **그 자리에서 전체를 중단**한다.
 *    쿨다운 중에는 네트워크에 나가지 않고 바로 같은 오류를 던진다(수동 재실행도 막힌다). 성공 응답이 오면 단계가 초기화된다.
 *  - 5xx·네트워크 오류는 1회만 재시도(1초 뒤). 그래도 실패하면 `SecHttpError` — 호출부가 **종목 단위로 격리**한다.
 *  - 404 는 오류가 아니라 `{ status: 404 }` (예: XBRL 이 없는 회사의 companyfacts).
 *
 * ## 증분
 * `data.sec.gov` 응답에는 **ETag·Last-Modified 헤더가 없다**(2026-10-21 실측: submissions·companyfacts 헤더에 둘 다 없음,
 * `www.sec.gov/files/company_tickers.json` 은 Last-Modified 만 있음). 그래서 `If-None-Match` 대신
 * **본문 sha256** 을 돌려주고, 호출부가 직전 값과 같으면 파싱·DB 쓰기를 건너뛴다. companyfacts 는 submissions 의
 * `filed` 워터마크로 아예 호출 여부를 정한다(`sync-job.ts`).
 *
 * 보유 수량·평단 등 사용자 정보는 이 클라이언트의 어떤 요청에도 실리지 않는다 — URL 은 CIK 와 고정 경로뿐이다.
 */
import { createHash } from 'node:crypto';

export const SEC_MIN_INTERVAL_MS = 250;           // 최대 4 req/s (SEC 상한 10 req/s 의 절반 미만)
export const SEC_TIMEOUT_MS = 30_000;
export const SEC_BLOCK_COOLDOWN_BASE_MS = 10 * 60_000;
export const SEC_BLOCK_COOLDOWN_MAX_MS = 60 * 60_000;

/** 이 클라이언트가 부를 수 있는 호스트. 그 밖의 URL 은 요청하지 않고 던진다. */
const ALLOWED_PREFIXES = ['https://data.sec.gov/', 'https://www.sec.gov/'];

/**
 * `SEC_USER_AGENT` → 사용할 값 또는 null. 비었거나 공백뿐이거나 '@'(연락 이메일)가 없으면 null.
 * 반환값을 로그에 남기지 않는다(연락처가 들어 있다).
 */
export function readSecUserAgent(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.SEC_USER_AGENT;
  if (typeof raw !== 'string') return null;
  const v = raw.trim().replace(/^"(.*)"$/, '$1').trim();
  if (!v || !v.includes('@')) return null;
  return v;
}

/** 429·403(또는 쿨다운 중). 받으면 job 전체를 멈춘다. */
export class SecBlockedError extends Error {
  constructor(public readonly status: number | 'cooldown', public readonly cooldownMs: number) {
    super(`SEC 접근 차단(${status}) — ${Math.round(cooldownMs / 60000)}분 동안 SEC 호출 중단`);
    this.name = 'SecBlockedError';
  }
}

/** 5xx·네트워크·본문 파싱 실패 등. 종목 단위로 격리한다. */
export class SecHttpError extends Error {
  constructor(public readonly status: number | 'network' | 'parse', message: string) {
    super(message);
    this.name = 'SecHttpError';
  }
}

export type SecJsonResult =
  | { status: 200; json: unknown; sha256: string }
  | { status: 404 };

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface SecClientOptions {
  userAgent: string;
  fetchImpl?: FetchLike;
  minIntervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

// ── 프로세스 전역 차단 상태 — 여러 클라이언트 인스턴스(수동 실행·cron)가 공유한다 ──
let blockedUntil = 0;
let blockStreak = 0;

/** 테스트 전용 — 전역 쿨다운 초기화. */
export function __resetSecBlockStateForTest(): void {
  blockedUntil = 0;
  blockStreak = 0;
}

/** 현재 쿨다운이 남아 있으면 남은 ms, 아니면 0. */
export function secCooldownRemainingMs(now: number = Date.now()): number {
  return Math.max(0, blockedUntil - now);
}

const defaultSleep = (ms: number) => new Promise<void>((r) => { const t = setTimeout(r, ms); t.unref?.(); });

export class SecClient {
  private readonly ua: string;
  private readonly fetchImpl: FetchLike;
  private readonly minIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private lastStartAt = 0;
  private chain: Promise<unknown> = Promise.resolve();
  /** 실제로 네트워크에 나간 요청 수(재시도 포함). 결과 보고용. */
  requestCount = 0;

  constructor(opts: SecClientOptions) {
    if (!opts.userAgent || !opts.userAgent.includes('@')) {
      throw new Error('SecClient: SEC_USER_AGENT(연락 이메일 포함)가 없다 — SEC 를 호출하지 않는다');
    }
    this.ua = opts.userAgent;
    this.fetchImpl = opts.fetchImpl ?? ((u, i) => fetch(u, i));
    this.minIntervalMs = Math.max(SEC_MIN_INTERVAL_MS, opts.minIntervalMs ?? SEC_MIN_INTERVAL_MS);
    this.timeoutMs = opts.timeoutMs ?? SEC_TIMEOUT_MS;
    this.sleep = opts.sleep ?? defaultSleep;
    this.now = opts.now ?? Date.now;
  }

  /** JSON GET. 직렬화된다 — 앞 요청이 끝나야 다음 요청이 시작된다. */
  getJson(url: string): Promise<SecJsonResult> {
    const run = this.chain.then(() => this.doGetJson(url), () => this.doGetJson(url));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async gate(): Promise<void> {
    const wait = this.lastStartAt + this.minIntervalMs - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastStartAt = this.now();
  }

  private block(status: number, retryAfterSec: number | null): never {
    const exp = Math.min(SEC_BLOCK_COOLDOWN_MAX_MS, SEC_BLOCK_COOLDOWN_BASE_MS * 2 ** blockStreak);
    const ra = retryAfterSec != null ? retryAfterSec * 1000 : 0;
    const cooldown = Math.min(SEC_BLOCK_COOLDOWN_MAX_MS, Math.max(exp, ra));
    blockStreak++;
    blockedUntil = this.now() + cooldown;
    throw new SecBlockedError(status, cooldown);
  }

  private async doGetJson(url: string): Promise<SecJsonResult> {
    if (!ALLOWED_PREFIXES.some((p) => url.startsWith(p))) {
      throw new Error(`SecClient: 허용되지 않은 URL — ${url.slice(0, 80)}`);
    }
    const MAX_ATTEMPTS = 2;
    for (let attempt = 1; ; attempt++) {
      const remain = blockedUntil - this.now();
      if (remain > 0) throw new SecBlockedError('cooldown', remain);
      await this.gate();
      this.requestCount++;
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: 'GET',
          headers: { 'User-Agent': this.ua, 'Accept-Encoding': 'gzip, deflate', Accept: 'application/json' },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (e) {
        if (attempt < MAX_ATTEMPTS) { await this.sleep(1000); continue; }
        throw new SecHttpError('network', `SEC network error: ${e instanceof Error ? e.name : 'unknown'}`);
      }
      if (res.status === 429 || res.status === 403) {
        const ra = Number(res.headers.get('retry-after'));
        await res.body?.cancel().catch(() => undefined);
        this.block(res.status, Number.isFinite(ra) && ra > 0 ? ra : null);
      }
      if (res.status === 404) {
        await res.body?.cancel().catch(() => undefined);
        blockStreak = 0;
        return { status: 404 };
      }
      if (res.status >= 500 && attempt < MAX_ATTEMPTS) {
        await res.body?.cancel().catch(() => undefined);
        await this.sleep(1000);
        continue;
      }
      if (res.status !== 200) {
        await res.body?.cancel().catch(() => undefined);
        throw new SecHttpError(res.status, `SEC HTTP ${res.status}`);
      }
      let text: string;
      try {
        text = await res.text();
      } catch (e) {
        throw new SecHttpError('network', `SEC body read error: ${e instanceof Error ? e.name : 'unknown'}`);
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new SecHttpError('parse', 'SEC 응답이 JSON 이 아님');
      }
      blockStreak = 0;
      return { status: 200, json, sha256: createHash('sha256').update(text).digest('hex') };
    }
  }
}

/** CIK 숫자 → `CIK0000050863` 형식(10자리 0 채움). */
export function cikPadded(cik: number): string {
  if (!Number.isSafeInteger(cik) || cik <= 0 || cik > 9_999_999_999) throw new Error(`잘못된 CIK: ${cik}`);
  return String(cik).padStart(10, '0');
}

export const SEC_COMPANY_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
export const secSubmissionsUrl = (cik: number) => `https://data.sec.gov/submissions/CIK${cikPadded(cik)}.json`;
export const secCompanyFactsUrl = (cik: number) => `https://data.sec.gov/api/xbrl/companyfacts/CIK${cikPadded(cik)}.json`;
