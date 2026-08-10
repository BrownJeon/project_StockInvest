/**
 * KIS 요청 유량 제어 — **프로세스 전역 토큰 버킷 + 우선순위 대기열** (T-017).
 *
 * ## 왜 필요한가
 *
 * KIS 가 `EGW00201`/`EGW00215`("초당 거래건수를 초과하였습니다")를 상시 반환한다.
 * 운영 로그 실측(2026-08-10): 누적 2,237 + 513건, 그중 **오늘 하루만 521건**.
 * 발생 시각의 **88%가 `:08`~`:10`초**에 몰려 있다.
 *
 * ⚠️ 이 초 단위 정렬은 cron 이 아니라 **브라우저**가 만든다. `/api/portfolio` 를 폴링하는
 *    대시보드 탭이 백그라운드로 내려가면 브라우저가 `setInterval` 을 60초로 클램프하므로,
 *    폴링이 특정 초에 고정돼 계속 같은 자리에 찍힌다. cron 의 `entry-watcher` 완료 초는
 *    `:00`~`:03` 이고 회차마다 표류하며, `holding-checker` 는 KIS 를 아예 호출하지 않는다.
 *
 * 근본 원인은 "요청이 너무 많다"가 아니라 **동시성이 통제되지 않는다**는 것이다:
 *  - 논리적 잔고 조회 1회 = 국내 1 + 해외 1~2 요청이 `Promise.all` 로 **동시** 발사
 *  - `/api/portfolio` = 잔고 + 보유종목 시세가 `Promise.allSettled` 로 **동시** 발사.
 *    게다가 `Dashboard.tsx` 와 `TradingBoard.tsx` 가 **각자** 호출하며 중복 제거가 없어
 *    실제 버스트는 한 화면당 ~20건이 아니라 **~40건**이다.
 *  - `universe.ts` = 상위 150종목 캔들이 **동시** 발사 (`UNIVERSE_TOP_N = 150`)
 *  → 순간 유량이 초당 수십~수백 건으로 튄다. 어느 한도든 넘는다.
 *
 * 이 모듈은 그 순간 유량을 **하나의 버킷으로 평탄화**한다.
 *
 * ## 프로세스 전역성이 성립하는 근거 (in-memory 인 이유)
 *
 * 이 버킷은 **한 프로세스 안에서만** 유효하다. 아래를 실측으로 확인했다(2026-08-10):
 *  - `pm2 describe stockinvest` → `exec mode: cluster_mode`, `instances: 1`
 *  - `ps -eo pid,args` → `next-server` 프로세스 **정확히 1개** (pid 659688)
 *  - `stockinvest-cron` 은 bash 루프이며 KIS 를 직접 부르지 않는다 —
 *    `curl http://localhost:3003/api/cron/*` 로 위 단일 프로세스에 위임한다
 *  - 자매 프로젝트 `TradingInvest` 는 KIS 를 쓰지 않는다(코인원 전용, grep 확인)
 *
 * ⚠️ **`instances` 를 2 이상으로 올리면 이 버킷은 그 즉시 트래픽의 1/N 만 통제한다.**
 *    스케일아웃이 필요해지면 Redis 등 프로세스 밖 카운터로 옮겨야 한다.
 *
 * ## 우선순위 — 주문이 대량 스캔 뒤에 서지 않게 한다
 *
 * | lane | 용도 | 근거 |
 * |---|---|---|
 * | `critical` | 주문 송신·취소, 토큰 발급, 주문 한도 산정용 잔고 조회 | 150건 스캔 뒤에 매도 주문이 줄 서면 **돈이 새는 결함**이다 |
 * | `normal`   | 단건 시세, cron 틱, UI 조회 (기본값) | |
 * | `bulk`     | universe 스캔·RS 갱신·포트폴리오 팬아웃·시그널 후속추적 | 지연돼도 무해한 배치 성격 |
 *
 * lane 은 배열이 분리돼 있어 **bulk 가 아무리 밀려도 critical/normal 의 대기 자리를 잠식하지
 * 못한다.** 토큰이 생기면 항상 critical → normal → bulk 순으로 배분한다.
 *
 * ⚠️ **`bulk` 는 "무거우니까"가 아니라 "늦어도 안전하니까" 붙인다.** 잔고 조회·청산 평가처럼
 *    안전에 관여하는 경로는 아무리 무거워도 `bulk` 로 내리지 않는다 (reviewer HIGH-1:
 *    `strategy-eval` 라우트를 통째로 `bulk` 로 감쌌더니, 이미 스스로 `bulk` 를 선언한 배치는
 *    그대로인 채 **손절 평가와 T-014 잔고 조회만** 최하위로 강등됐다).
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { RowDataPacket } from 'mysql2';

// ── 우선순위 ────────────────────────────────────────────────────────────────
export type KisPriority = 'critical' | 'normal' | 'bulk';

/** 배분 순서. 인덱스가 작을수록 먼저 토큰을 받는다. */
const LANE_ORDER: readonly KisPriority[] = ['critical', 'normal', 'bulk'] as const;

/**
 * lane 별 대기열 상한.
 *
 * **대기열은 반드시 유한해야 한다.** 무한 대기열은 "요청 과다" 문제를 "무한 지연" 문제로
 * 바꿔치기할 뿐이고, 매매 시스템에서 무한 지연은 조용한 실패다. 상한을 넘으면 기다리지 않고
 * 즉시 `KisThrottleQueueFullError` 로 실패시킨다 — 호출부가 그 사실을 **알 수 있는** 편이
 * 영원히 매달려 있는 것보다 낫다.
 *
 * critical 이 64인 이유: 주문은 드물다(하루 수십 건). 64가 차 있다면 그것은 대기열 문제가
 * 아니라 시스템 이상이므로 실패시키는 것이 옳다.
 */
const LANE_CAPACITY: Record<KisPriority, number> = {
  critical: 64,
  normal:   192,
  bulk:     640,
};

/** 대기열 초과 — 기다리지 않고 즉시 실패한다. */
export class KisThrottleQueueFullError extends Error {
  readonly priority: KisPriority;
  readonly queued: number;
  constructor(priority: KisPriority, queued: number) {
    super(
      `KIS 요청 대기열 초과 (lane=${priority}, 대기 ${queued}건 ≥ 상한 ${LANE_CAPACITY[priority]}건) — `
      + '무한 대기 대신 즉시 실패시켰습니다. 유량 설정(system_config.kis_rate_limit_per_sec) 또는 '
      + '호출량을 확인하세요.',
    );
    this.name = 'KisThrottleQueueFullError';
    this.priority = priority;
    this.queued = queued;
  }
}

/** 대기열 초과로 인한 실패인가 — 잔고 "0건"과 혼동하면 안 되는 실패를 식별한다. */
export function isKisThrottleQueueFull(e: unknown): boolean {
  return e instanceof KisThrottleQueueFullError
    || (e instanceof Error && e.name === 'KisThrottleQueueFullError');
}

/**
 * 대기 시간 상한. **줄에 서는 것 자체에 데드라인이 없으면 무한 대기가 된다.**
 *
 * `kisFetch` 는 타임아웃 타이머를 "토큰을 받은 뒤"에 건다(대기 시간이 타임아웃을 잡아먹지
 * 않게 하려고). 그 설계는 옳지만, 뒤집어 보면 **토큰을 기다리는 동안에는 아무 타임아웃도
 * 걸려 있지 않다**는 뜻이다. 그리고 `scripts/cron-runner.sh` 는 `--max-time` 없는 blocking
 * curl 을 **직렬로** 도는 루프다 — 요청 하나가 영원히 기다리면 그 회차가 끝나지 않고,
 * **cron 루프 전체(그 잡 하나가 아니라 전부)가 조용히 멈춘다.**
 *
 * 이 코드베이스가 T-007·T-012·T-014 에서 계속 제거해 온 것이 바로 그 "조용한 멈춤"이다.
 * 그래서 대기에도 데드라인을 두고, 만료 시 **큰 소리로** 던진다.
 */
export const DEFAULT_MAX_QUEUE_WAIT_MS = 30_000;

/**
 * 대기 시간 상한 초과. **`KisThrottleQueueFullError` 와 구분되는 별개의 실패다.**
 *  - QueueFull  = "줄이 이미 꽉 차서 서지도 못했다" (즉시)
 *  - Timeout    = "줄에 섰는데 제한 시간 안에 차례가 오지 않았다" (대기 후)
 * 로그·대응이 다르므로 섞지 않는다 — 전자는 호출량, 후자는 유량 설정을 의심해야 한다.
 */
export class KisThrottleTimeoutError extends Error {
  readonly priority: KisPriority;
  readonly waitedMs: number;
  readonly maxWaitMs: number;
  constructor(priority: KisPriority, waitedMs: number, maxWaitMs: number, queued: string) {
    super(
      `KIS 요청 유량 대기 시간 초과 (lane=${priority}, ${waitedMs}ms 대기 ≥ 상한 ${maxWaitMs}ms) — `
      + `무한 대기로 cron 루프가 멈추는 것을 막기 위해 실패시켰습니다. 대기열: ${queued}. `
      + '유량 설정(system_config.kis_rate_limit_per_sec)을 올리거나 호출량을 줄이세요.',
    );
    this.name = 'KisThrottleTimeoutError';
    this.priority = priority;
    this.waitedMs = waitedMs;
    this.maxWaitMs = maxWaitMs;
  }
}

/** 대기 시간 초과로 인한 실패인가. */
export function isKisThrottleTimeout(e: unknown): boolean {
  return e instanceof KisThrottleTimeoutError
    || (e instanceof Error && e.name === 'KisThrottleTimeoutError');
}

/** 스로틀이 만든 실패(대기열 초과 또는 대기 시간 초과)인가 — 진단 분류용. */
export function isKisThrottleFailure(e: unknown): boolean {
  return isKisThrottleQueueFull(e) || isKisThrottleTimeout(e);
}

// ── 유량 설정 ────────────────────────────────────────────────────────────────

/** 런타임 조정 키 — `exit_engine_enabled` 와 같은 방식으로 재배포 없이 바꾼다. */
export const KIS_RATE_LIMIT_KEY = 'kis_rate_limit_per_sec';

/**
 * 🔺 **초기값 5 req/s 는 검증되지 않은 추정치다. KIS 가 공표한 한도가 아니다.**
 *
 * 코드베이스·주석·`agent-vault/` 전체를 검색했으나 **KIS 의 실제 허용 초당 요청수를 기록한
 * 문서는 이 저장소에 존재하지 않는다.** 따라서 아래 값은 "알려진 한도"가 아니라 아래 근거로
 * 고른 **보수적 출발점**이며, 실측 후 올려야 하는 값이다.
 *
 * 고른 근거:
 *  1. **위쪽 안전 마진** — 현재 에러는 순간 20~150건 동시 발사에서 나온다. 5 req/s 는 그
 *     버스트를 완전히 제거한다. 실제 한도가 얼마든 5 req/s 가 그보다 낮을 개연성이 높다.
 *  2. **아래쪽(지연) 한계** — 실측상 `strategy-eval` 틱은 종목 25~36개 × 2~3요청 ≈ 120요청,
 *     universe 갱신(15분 주기) 포함 시 최대 ~470요청이다. 5 req/s 면 각각 약 24초 / 94초로,
 *     오늘 이미 관측되는 값(p90 13초 / 최대 77초)과 같은 자릿수다. 더 낮추면
 *     `entry-watcher` 의 60초 주기가 눈에 띄게 늘어난다.
 *  3. 즉 5는 "가장 낮은 값"이 아니라 **버스트를 없애면서 cron 주기를 망가뜨리지 않는 가장
 *     낮은 값**이다.
 *
 * 조정 방법(재배포 불필요): `system_config.kis_rate_limit_per_sec` → 없으면 env
 * `KIS_RATE_LIMIT_PER_SEC` → 없으면 이 기본값. 변경은 최대 {@link CONFIG_TTL_MS}ms 안에 반영된다.
 * 올릴 때는 한 번에 크게 올리지 말고 `EGW00201`/`EGW00215` 발생 건수를 보며 단계적으로 올린다.
 */
export const DEFAULT_RATE_PER_SEC = 5;

/** 설정 재조회 주기. 조정 후 이 시간 안에 반영된다. */
const CONFIG_TTL_MS = 15_000;

/** 방어적 상한·하한 — 오타(`500`)나 `0` 이 그대로 반영돼 시스템을 멈추지 않게 한다. */
const MIN_RATE_PER_SEC = 0.2;
const MAX_RATE_PER_SEC = 50;

export function clampRatePerSec(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return DEFAULT_RATE_PER_SEC;
  return Math.min(MAX_RATE_PER_SEC, Math.max(MIN_RATE_PER_SEC, v));
}

function envRatePerSec(): number | null {
  const raw = (process.env.KIS_RATE_LIMIT_PER_SEC ?? '').trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── 버킷 상태 ────────────────────────────────────────────────────────────────
interface Waiter {
  resolve:    () => void;
  reject:     (e: Error) => void;
  lane:       KisPriority;
  /** 대기 데드라인 타이머. 차례가 오면 해제한다. */
  timer:      ReturnType<typeof setTimeout> | null;
  /** 이미 resolve/reject 됐는가 — 타이머와 pump 의 경합을 막는다. */
  settled:    boolean;
  enqueuedAt: number;
}

interface BucketState {
  ratePerSec: number;
  /** 버스트 허용량 = 1초치. 순간 동시성이 곧 초당 유량을 넘지 않게 한다. */
  capacity:   number;
  tokens:     number;
  lastRefill: number;
  queues:     Record<KisPriority, Waiter[]>;
  timer:      ReturnType<typeof setTimeout> | null;
  /** 설정 원천 — 진단용 */
  source:     'config' | 'env' | 'default';
  configAt:   number;
  /** 누적 계측 */
  granted:    number;
  rejected:   number;
  timedOut:   number;
}

function freshState(rate: number, source: BucketState['source']): BucketState {
  return {
    ratePerSec: rate,
    capacity:   rate,
    tokens:     rate,
    lastRefill: Date.now(),
    queues:     { critical: [], normal: [], bulk: [] },
    timer:      null,
    source,
    configAt:   0,
    granted:    0,
    rejected:   0,
    timedOut:   0,
  };
}

const initialEnvRate = envRatePerSec();
let state: BucketState = freshState(
  clampRatePerSec(initialEnvRate ?? DEFAULT_RATE_PER_SEC),
  initialEnvRate != null ? 'env' : 'default',
);

function totalQueued(): number {
  return state.queues.critical.length + state.queues.normal.length + state.queues.bulk.length;
}

function refill(now: number): void {
  const elapsedSec = (now - state.lastRefill) / 1000;
  if (elapsedSec <= 0) return;
  state.tokens = Math.min(state.capacity, state.tokens + elapsedSec * state.ratePerSec);
  state.lastRefill = now;
}

/** 토큰이 있는 만큼 우선순위 순으로 배분. 남은 대기자가 있으면 다음 토큰 시각에 재실행 예약. */
function pump(): void {
  refill(Date.now());
  while (state.tokens >= 1) {
    let w: Waiter | undefined;
    for (const lane of LANE_ORDER) {
      if (state.queues[lane].length > 0) { w = state.queues[lane].shift(); break; }
    }
    if (!w) break;
    if (w.settled) continue;          // 데드라인으로 이미 실패한 대기자 — 토큰을 쓰지 않는다
    w.settled = true;
    if (w.timer) { clearTimeout(w.timer); w.timer = null; }
    state.tokens -= 1;
    state.granted += 1;
    w.resolve();
  }
  if (state.timer) { clearTimeout(state.timer); state.timer = null; }
  if (totalQueued() > 0) {
    const deficit = Math.max(0, 1 - state.tokens);
    const waitMs = Math.max(1, Math.ceil((deficit / state.ratePerSec) * 1000));
    state.timer = setTimeout(() => { state.timer = null; pump(); }, waitMs);
    // 스로틀 타이머가 프로세스·테스트 종료를 붙잡지 않게 한다.
    state.timer.unref?.();
  }
}

// ── 런타임 설정 반영 ─────────────────────────────────────────────────────────
let configInFlight: Promise<void> | null = null;

/**
 * `system_config` 에서 유량을 다시 읽는다. **절대 throw 하지 않고, 호출부를 블록하지 않는다.**
 * (hot path 에서 DB 왕복을 기다리면 스로틀 자체가 병목이 된다 — 캐시된 값으로 즉시 진행하고
 *  갱신은 뒤에서 한다.)
 */
function maybeRefreshConfig(): void {
  if (configInFlight) return;
  if (Date.now() - state.configAt < CONFIG_TTL_MS) return;
  state.configAt = Date.now();
  configInFlight = (async () => {
    try {
      const { getPool } = await import('@/lib/db');
      const [rows] = await getPool().query<(RowDataPacket & { value: string })[]>(
        'SELECT value FROM system_config WHERE `key` = ? LIMIT 1',
        [KIS_RATE_LIMIT_KEY],
      );
      let next: number | null = null;
      let source: BucketState['source'] = 'default';
      if (rows.length > 0) {
        const raw = String(rows[0].value);
        let decoded: unknown = raw;
        try { decoded = JSON.parse(raw); } catch { /* 비 JSON 원문 그대로 */ }
        const n = Number(decoded);
        if (Number.isFinite(n) && n > 0) { next = n; source = 'config'; }
      }
      if (next == null) {
        const env = envRatePerSec();
        if (env != null) { next = env; source = 'env'; }
        else             { next = DEFAULT_RATE_PER_SEC; source = 'default'; }
      }
      applyRate(clampRatePerSec(next), source);
    } catch {
      /* DB 조회 실패 — 직전 값을 그대로 쓴다. 유량 설정 때문에 매매가 멈추면 안 된다. */
    } finally {
      configInFlight = null;
    }
  })();
}

function applyRate(rate: number, source: BucketState['source']): void {
  if (state.ratePerSec === rate && state.source === source) return;
  const prev = state.ratePerSec;
  state.ratePerSec = rate;
  state.capacity   = rate;
  state.tokens     = Math.min(state.tokens, rate);
  state.source     = source;
  if (prev !== rate) {
    console.log(
      `[kis-throttle] 유량 변경 ${prev} → ${rate} req/s (source=${source}). `
      + '※ 이 값은 KIS 공표 한도가 아니라 운영 중 조정하는 추정치입니다.',
    );
  }
  pump();
}

// ── 우선순위 컨텍스트 ────────────────────────────────────────────────────────
const priorityStore = new AsyncLocalStorage<KisPriority>();

/**
 * 이 콜백의 **비동기 하위 전체**가 지정한 lane 을 쓰게 한다.
 *
 * 호출부 16곳에 인자를 넣고 다니는 대신 실행 컨텍스트로 전달한다 — 새 호출 경로가 생겨도
 * 자동으로 상속되고, 누락으로 조용히 잘못된 lane 을 타는 일이 없다.
 *
 * 의미는 **덮어쓰기**다(상승·하강 모두 가능). 주문 경로가 bulk 로 강등될 위험은
 * `createOrder`/`cancelOrder`/`tokenP` 가 호출 지점에서 `priority:'critical'` 을
 * **명시**하기 때문에 컨텍스트와 무관하게 차단된다.
 */
export function withKisPriority<T>(priority: KisPriority, fn: () => Promise<T>): Promise<T> {
  return priorityStore.run(priority, fn);
}

/** 현재 실행 컨텍스트의 lane. 지정이 없으면 `normal`. */
export function currentKisPriority(): KisPriority {
  return priorityStore.getStore() ?? 'normal';
}

// ── 획득 ────────────────────────────────────────────────────────────────────

/**
 * 토큰 1개를 얻을 때까지 기다린다. 대기열이 가득 차 있으면 기다리지 않고 던진다.
 *
 * @throws {KisThrottleQueueFullError}
 */
export function acquireKisSlot(
  priority: KisPriority = currentKisPriority(),
  opts: { maxWaitMs?: number } = {},
): Promise<void> {
  maybeRefreshConfig();
  refill(Date.now());

  // 대기자가 아무도 없고 토큰이 남아 있을 때만 즉시 통과.
  // (대기자가 있으면 반드시 줄을 서야 순서·우선순위가 보장된다.)
  if (state.tokens >= 1 && totalQueued() === 0) {
    state.tokens -= 1;
    state.granted += 1;
    return Promise.resolve();
  }

  const lane = state.queues[priority];
  if (lane.length >= LANE_CAPACITY[priority]) {
    state.rejected += 1;
    return Promise.reject(new KisThrottleQueueFullError(priority, lane.length));
  }

  const maxWaitMs = opts.maxWaitMs ?? DEFAULT_MAX_QUEUE_WAIT_MS;

  return new Promise<void>((resolve, reject) => {
    const w: Waiter = {
      resolve, reject, lane: priority, timer: null, settled: false, enqueuedAt: Date.now(),
    };

    /**
     * ⏱️ 대기 데드라인 (reviewer HIGH-2).
     *
     * 데드라인이 없으면 "요청 하나가 영원히 대기" → `cron-runner.sh` 의 직렬 blocking curl
     * 루프가 통째로 멈춘다(그 잡 하나가 아니라 **모든** 잡이). 조용한 정지는 이 프로젝트가
     * 반복해서 제거해 온 실패 유형이므로, 만료 시 **반드시 소리를 내고** 실패시킨다.
     */
    if (maxWaitMs > 0 && Number.isFinite(maxWaitMs)) {
      w.timer = setTimeout(() => {
        if (w.settled) return;
        w.settled = true;
        const idx = state.queues[priority].indexOf(w);
        if (idx >= 0) state.queues[priority].splice(idx, 1);   // 토큰을 낭비하지 않게 줄에서 뺀다
        state.timedOut += 1;
        const waited = Date.now() - w.enqueuedAt;
        const snapshot = `critical=${state.queues.critical.length} `
          + `normal=${state.queues.normal.length} bulk=${state.queues.bulk.length}`;
        // 🔊 조용히 던지지 않는다 — 이 로그가 없으면 "cron 이 왜 느려졌지?" 를 추적할 수 없다.
        console.error(
          `[kis-throttle] ⏱️ 대기 시간 초과 — lane=${priority} waited=${waited}ms `
          + `max=${maxWaitMs}ms rate=${state.ratePerSec}req/s 대기열(${snapshot}). `
          + '요청을 실패시켜 cron 루프의 무한 정지를 막았습니다. '
          + '반복되면 system_config.kis_rate_limit_per_sec 상향 또는 호출량 감축이 필요합니다.',
        );
        reject(new KisThrottleTimeoutError(priority, waited, maxWaitMs, snapshot));
      }, maxWaitMs);
      w.timer.unref?.();
    }

    lane.push(w);
    pump();
  });
}

// ── 동시성 제한 map — 한 번의 요청이 대기열을 통째로 채우지 않게 ────────────────

/**
 * `Promise.allSettled(xs.map(f))` 의 **동시성 제한판**.
 *
 * 스로틀만으로도 유량은 평탄해지지만, 150건을 한꺼번에 밀어 넣으면 그 한 번의 호출이 lane 을
 * 독차지해 뒤따르는 요청이 `KisThrottleQueueFullError` 를 맞는다. 대기열 자체를 얕게 유지한다.
 *
 * 반환값은 `Promise.allSettled` 와 **동일한 형태·동일한 순서**다.
 */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const out = new Array<PromiseSettledResult<R>>(items.length);
  if (items.length === 0) return out;
  const width = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;
  const workers = Array.from({ length: width }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        out[i] = { status: 'fulfilled', value: await fn(items[i], i) };
      } catch (reason) {
        out[i] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

/** `/api/portfolio` · universe 스캔 등 팬아웃의 기본 동시성. 대기열을 얕게 유지한다. */
export const DEFAULT_FANOUT_CONCURRENCY = 4;

// ── 진단 ────────────────────────────────────────────────────────────────────
export interface KisThrottleStats {
  ratePerSec: number;
  source:     BucketState['source'];
  tokens:     number;
  queued:     Record<KisPriority, number>;
  granted:    number;
  rejected:   number;
  /** 대기 데드라인 초과로 실패한 누적 건수. 0 이 아니면 유량이 부족하다는 신호다. */
  timedOut:   number;
}

export function getKisThrottleStats(): KisThrottleStats {
  refill(Date.now());
  return {
    ratePerSec: state.ratePerSec,
    source:     state.source,
    tokens:     Math.round(state.tokens * 100) / 100,
    queued: {
      critical: state.queues.critical.length,
      normal:   state.queues.normal.length,
      bulk:     state.queues.bulk.length,
    },
    granted:  state.granted,
    rejected: state.rejected,
    timedOut: state.timedOut,
  };
}

/** 사람이 읽는 한 줄 요약 — 부팅 로그가 쓰는 문구. */
export function describeKisThrottle(): string {
  const s = getKisThrottleStats();
  const src =
    s.source === 'config' ? `system_config.${KIS_RATE_LIMIT_KEY}`
    : s.source === 'env'  ? 'env KIS_RATE_LIMIT_PER_SEC'
    :                       '코드 기본값';
  return `KIS 요청 유량 ${s.ratePerSec} req/s (출처: ${src}) — 검증된 KIS 공표 한도가 아니라 조정 가능한 추정치`;
}

// ── 테스트 전용 ─────────────────────────────────────────────────────────────
/**
 * 버킷을 초기화한다. **테스트 전용** — 대기 중인 요청은 전부 reject 된다.
 */
export function __resetKisThrottleForTest(rate = DEFAULT_RATE_PER_SEC): void {
  for (const lane of LANE_ORDER) {
    for (const w of state.queues[lane]) {
      if (w.timer) clearTimeout(w.timer);
      if (w.settled) continue;
      w.settled = true;
      w.reject(new Error('kis-throttle reset'));
    }
  }
  if (state.timer) clearTimeout(state.timer);
  state = freshState(clampRatePerSec(rate), 'default');
  // 설정 재조회를 즉시 유발하지 않도록 TTL 을 살려 둔다 (테스트는 DB 를 쓰지 않는다).
  state.configAt = Date.now();
}

/** lane 별 대기열 상한 — 테스트가 경계를 검증할 때 참조. */
export const __LANE_CAPACITY = LANE_CAPACITY;
