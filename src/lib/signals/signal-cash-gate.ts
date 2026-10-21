/**
 * T-058 — **시그널 생성 시점 실시간 현금 게이트.** 현금이 모자라는 매수는 시그널 행을 만들지 않는다
 * (그러면 RAG 색인·텔레그램·슬랙 승인 요청도 생기지 않는다). `createSignal` 이 블랙리스트 검사 뒤 · 중복 검사/INSERT 앞에서 부른다.
 *
 * ## 판정
 * - 대상은 **매수**뿐이다. 매도는 보유 수량이 기준이라 이 게이트를 타지 않는다.
 * - 수량·가격은 호출부가 `buildOrderRequest`(사이징 + 호가 추격)로 만든 **실제 주문과 같은 값**을 넘긴다(`size()`).
 * - 국내: 필요 금액 = 수량 × 지정가 × (1 + 0.002) 원, 현금 = 국내 KRW 예수금(T-051 과 같은 출처·캐시).
 * - 해외: 시그널의 가격·금액은 **원화 환산값**이다(KIS 해외 시세를 fetch 직후 KRW 로 바꾼다 — `kis-overseas.ts` getTicker).
 *   주문 어댑터(`kis-overseas.ts` createOrder)는 원화 지정가를 환율로 나눠 USD 단가를 만들고 `roundToTickOverseas` 로 반올림해
 *   송신한다. 게이트는 그 단가를 {@link overseasLimitUnitUsd} 로 **똑같이** 만들어 필요 USD = 수량 × 단가 × (1 + 0.002) 를
 *   `cash.USD`(T-056)와 센트 단위로 비교한다. 환율은 {@link readGateUsdKrwRate}(신선한 `fx_rates` 행만) — 폴백 환율은 쓰지 않는다.
 * - 현금이 필요 금액보다 **엄격히 적을 때만** `insufficient`(같으면 통과).
 *
 * ## 🔴 모르면 막지 않는다 (T-051·T-044 와 같은 원칙)
 * 조회 실패·상한 초과·`unknown`/`not_queried`·값 이상·시장가·수량/가격 미확정·수량 0·환율 없음/오래됨/이상·
 * 스위치 읽기 오류·게이트 내부 예외 → 전부 `unknown`(또는 `disabled`) — 호출부는 **기존대로 시그널을 만든다.**
 * 이 함수는 어떤 경우에도 던지지 않는다.
 *
 * ## 끄는 방법 (재배포 없이)
 * `system_config` 의 `signal_cash_gate_domestic_enabled` / `signal_cash_gate_overseas_enabled`.
 * **키 없음 = 켜짐, JSON 불리언 `true` = 켜짐, 그 밖의 모든 값(`false`·문자열 `"true"`/`"false"`·0·null·파싱 불가)과 읽기 오류 = 꺼짐.**
 * 30초 캐시.
 *
 * ## 흔적 (알림 채널로는 절대 보내지 않는다)
 * 건너뜀은 매번 일어나지만 로그·`trade_logs` 기록은 (시장, 심볼, 방향)마다 **1시간 1회**로 줄인다(룰은 매 틱 재발화한다).
 * 스로틀 상태는 **프로세스 로컬**이다 — "1시간 1회"는 프로세스별 제한이고 재시작(배포 포함)하면 창이 새로 시작한다.
 * 지금 구성에서는 이 코드가 `stockinvest`(Next) 프로세스에서만 돈다(`stockinvest-cron` 은 bash 가 HTTP 로 라우트를 부른다 —
 * `ecosystem.config.js`·`scripts/cron-runner.sh`). Node 프로세스를 늘리면 그 수만큼 기록이 늘어난다.
 * 기록에는 금액·잔고 수치를 싣지 않는다(시장·심볼·방향·사유 코드·억제 건수만).
 */
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { getMarketFromSymbol, type Market } from '@/lib/exchanges/kis-symbols';
import {
  CASH_READ_TIMEOUT_MS,
  ENTRY_CASH_BUFFER_RATIO,
  judgeEntryCash,
  readAvailableCash,
  type AvailableCash,
} from './entry-cash-precheck';

// ─────────────────────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────────────────────

export const SIGNAL_CASH_GATE_KEYS: Record<Market, string> = {
  domestic: 'signal_cash_gate_domestic_enabled',
  overseas: 'signal_cash_gate_overseas_enabled',
};
export const GATE_SWITCH_TTL_MS = 30_000;
/**
 * 게이트가 믿는 환율의 최대 나이(초). `fx.ts` 는 5분 TTL 로 외부 조회 → `fx_rates` 갱신을 하고, 해외 시세 조회(`getTicker`)마다
 * 그 경로를 탄다 — 정상이면 행의 나이는 5분 안팎이다. 1시간은 외부 조회가 12번 연속 실패했다는 뜻이고, 그때 `fx.ts` 는 오래된 행이나
 * 폴백 1380 을 돌려준다. 그 값으로 막으면 틀린 기준으로 막게 된다 → 모름. 더 짧게 잡아도 정밀도가 늘지 않는다(외부 원천 자체가 일 단위 갱신).
 */
export const FX_MAX_AGE_SEC = 60 * 60;
/** 환율 상식 범위. 이 밖의 값(0·1·소수점 밀림 등)은 필요 USD 를 터무니없이 키워 전부 막을 수 있다 → 모름. */
export const FX_PLAUSIBLE_MIN = 100;
export const FX_PLAUSIBLE_MAX = 10_000;
/** 게이트 전체 상한 — 현금(8초)·환율 갱신(8초)은 병렬이고 그 뒤 DB 1회. 넘으면 모름(기존 동작). */
export const GATE_TIMEOUT_MS = CASH_READ_TIMEOUT_MS + 2_000;
export const GATE_LOG_WINDOW_MS = 60 * 60_000;
/** 스로틀 키 정리 기준(이 수를 넘으면 만료 키를 지운다)과 절대 상한(넘으면 오래된 것부터 지운다) */
export const THROTTLE_PRUNE_AT = 256;
export const THROTTLE_MAX_KEYS = 1_000;
/** `trade_logs.event` 는 varchar(32) — 이 이름은 21자 */
export const CASH_GATE_TRADE_LOG_EVENT = 'signal_cash_gate_skip';

// ─────────────────────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────────────────────

export type GateSwitchSource = 'missing' | 'value' | 'read_error';
export interface GateSwitch { enabled: boolean; source: GateSwitchSource }
export type GateSwitches = Record<Market, GateSwitch>;

export type FxReading = { kind: 'known'; rate: number } | { kind: 'unknown'; reason: 'fx_missing' | 'fx_stale' | 'fx_invalid' | 'fx_read_failed' };

export type SignalCashGateVerdict =
  | { kind: 'not_applicable' }
  | { kind: 'disabled'; market: Market; source: GateSwitchSource }
  | { kind: 'sufficient'; market: Market; unit: 'KRW' | 'USD'; required: number; available: number }
  | { kind: 'insufficient'; market: Market; unit: 'KRW' | 'USD'; required: number; available: number }
  | { kind: 'unknown'; market: Market; reason: string };

export interface SignalCashGateInput {
  symbol: string;
  side: 'buy' | 'sell';
  orderType: 'limit' | 'market';
  /**
   * 실제 주문과 같은 사이징(`buildOrderRequest`) — 수량과 **호가 추격까지 반영된** 지정가(국내는 원, 해외도 원화 환산값).
   * 스위치가 켜져 있고 지정가일 때만 부른다(꺼져 있으면 I/O 를 하나도 늘리지 않는다).
   */
  size: () => Promise<{ quantity: number | undefined; price: number | undefined }>;
}

export interface SignalCashGateDeps {
  switches(): Promise<GateSwitches>;
  readCash(): Promise<AvailableCash | null>;
  readFx(): Promise<FxReading>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 스위치 (3상태: 키 없음 = 켜짐 / 값 있음 = 정확히 true 만 켜짐 / 읽기 오류 = 꺼짐)
// ─────────────────────────────────────────────────────────────────────────────

/** 저장된 값 하나 → 켜짐 여부. JSON 불리언 `true` 만 켜짐(문자열 `"true"` 는 꺼짐). */
export function gateSwitchValueEnabled(raw: unknown): boolean {
  if (raw === true) return true;                       // 드라이버가 이미 파싱한 경우
  if (typeof raw !== 'string') return false;
  try { return JSON.parse(raw) === true; } catch { return false; }
}

let switchCache: { at: number; value: GateSwitches } | null = null;

export async function readGateSwitches(now: () => number = Date.now): Promise<GateSwitches> {
  if (switchCache && now() - switchCache.at < GATE_SWITCH_TTL_MS) return switchCache.value;
  let value: GateSwitches;
  try {
    const [rows] = await getPool().query<(RowDataPacket & { key: string; value: unknown })[]>(
      'SELECT `key`, value FROM system_config WHERE `key` IN (?, ?)',
      [SIGNAL_CASH_GATE_KEYS.domestic, SIGNAL_CASH_GATE_KEYS.overseas],
    );
    const one = (m: Market): GateSwitch => {
      const row = (rows ?? []).find((r) => r && r.key === SIGNAL_CASH_GATE_KEYS[m]);
      return row ? { enabled: gateSwitchValueEnabled(row.value), source: 'value' } : { enabled: true, source: 'missing' };
    };
    value = { domestic: one('domestic'), overseas: one('overseas') };
  } catch {
    // 🔴 읽기 오류는 "키 없음(켜짐)"으로 합치지 않는다 — 모르면 막지 않는다(S-5 ①).
    value = { domestic: { enabled: false, source: 'read_error' }, overseas: { enabled: false, source: 'read_error' } };
  }
  switchCache = { at: now(), value };
  return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// 환율 (게이트 전용 — 폴백 숫자를 "모름"으로 읽는다, S-1)
// ─────────────────────────────────────────────────────────────────────────────

/** 숫자 또는 숫자 모양 문자열만. `Number('')`=0 함정을 피한다. */
function strictNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

/** `fx_rates` 행 하나 → 판정. 나이는 DB 가 계산한다(`TIMESTAMPDIFF(SECOND, fetched_at, NOW())` — 시간대 해석 차이가 없다). */
export function judgeFxRow(rateRaw: unknown, ageSecRaw: unknown): FxReading {
  const rate = strictNumber(rateRaw);
  const age = strictNumber(ageSecRaw);
  if (rate == null || age == null || age < 0) return { kind: 'unknown', reason: 'fx_invalid' };
  if (age > FX_MAX_AGE_SEC) return { kind: 'unknown', reason: 'fx_stale' };
  if (!(rate >= FX_PLAUSIBLE_MIN && rate <= FX_PLAUSIBLE_MAX)) return { kind: 'unknown', reason: 'fx_invalid' };
  return { kind: 'known', rate };
}

/**
 * ① `getUsdKrwRate()` 로 캐시·`fx_rates` 갱신을 유도하되 **반환값은 쓰지 않는다**(외부·DB 가 다 실패해도 오래된 값이나 1380 을
 * 숫자로 돌려주기 때문에 "모름"을 표현할 수 없다). ② `fx_rates` 를 읽어 {@link FX_MAX_AGE_SEC} 이내일 때만 known.
 * 폴백을 쓴 상황 = DB 행이 오래됐거나 없다 = 모름. `fx.ts` 는 수정하지 않는다.
 */
export async function readGateUsdKrwRate(timeoutMs: number = CASH_READ_TIMEOUT_MS): Promise<FxReading> {
  // 지연 import — 국내 매수만 다루는 경로(entry-watcher·국내 시그널)가 fx 모듈을 끌어오지 않게 한다. 실패해도 ②로 간다.
  const refresh = import('@/lib/exchanges/fx').then((m) => m.getUsdKrwRate()).then(() => undefined, () => undefined);
  await raceWithTimeout(refresh, timeoutMs, undefined);
  try {
    const [rows] = await getPool().query<RowDataPacket[]>(
      'SELECT rate, TIMESTAMPDIFF(SECOND, fetched_at, NOW()) AS age_sec FROM fx_rates WHERE pair = ? LIMIT 1',
      ['USD_KRW'],
    );
    const row = (rows ?? [])[0];
    if (!row) return { kind: 'unknown', reason: 'fx_missing' };
    return judgeFxRow(row.rate, row.age_sec);
  } catch {
    return { kind: 'unknown', reason: 'fx_read_failed' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 해외 주문 단가 — `kis-overseas.ts` createOrder 와 같은 계산
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 해외 **지정가** 주문이 실제로 송신할 USD 단가. `kis-overseas.ts` createOrder 의 `usdPrice = krwPrice / fx` →
 * `roundToTickOverseas`($1 이상은 1달러 단위 반올림, 미만은 0.0001 단위)를 그대로 따른다. 어댑터가 바뀌면
 * `signal-cash-gate-order-parity.test.ts` 가 실제 송신 본문(`OVRS_ORD_UNPR`)과 대조해 깨진다. 비정상이면 null.
 */
export function overseasLimitUnitUsd(krwPrice: number, fx: number): number | null {
  if (!Number.isFinite(krwPrice) || krwPrice <= 0 || !Number.isFinite(fx) || fx <= 0) return null;
  const usd = krwPrice / fx;
  const tick = usd >= 1 ? String(Math.round(usd)) : (Math.round(usd * 10000) / 10000).toFixed(4);
  const n = Number(tick);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 판정
// ─────────────────────────────────────────────────────────────────────────────

export function defaultGateDeps(): SignalCashGateDeps {
  return {
    switches: () => readGateSwitches(),
    readCash: () => readAvailableCash(),
    readFx: () => readGateUsdKrwRate(),
  };
}

/** 던지지 않는다. 매도는 `not_applicable`. */
export async function evaluateSignalCashGate(
  input: SignalCashGateInput,
  deps: SignalCashGateDeps = defaultGateDeps(),
  timeoutMs: number = GATE_TIMEOUT_MS,
): Promise<SignalCashGateVerdict> {
  if (input.side !== 'buy') return { kind: 'not_applicable' };
  let market: Market = 'domestic';
  try {
    market = getMarketFromSymbol(input.symbol);
    const timedOut: SignalCashGateVerdict = { kind: 'unknown', market, reason: 'gate_timeout' };
    return (await raceWithTimeout(evaluateInner(input, market, deps), timeoutMs, timedOut)) ?? timedOut;
  } catch {
    return { kind: 'unknown', market, reason: 'gate_exception' };
  }
}

async function evaluateInner(input: SignalCashGateInput, market: Market, deps: SignalCashGateDeps): Promise<SignalCashGateVerdict> {
  const unknown = (reason: string): SignalCashGateVerdict => ({ kind: 'unknown', market, reason });

  const sw = (await deps.switches())[market];
  if (!sw || !sw.enabled) return { kind: 'disabled', market, source: sw?.source ?? 'read_error' };

  // 시장가는 가격을 모른다(국내는 단가 0 으로 송신, 해외는 송신 직전 호가로 파생) — 판단하지 않는다.
  if (input.orderType !== 'limit') return unknown('market_order');

  let sized: { quantity: number | undefined; price: number | undefined };
  try { sized = await input.size(); } catch { return unknown('sizing_failed'); }
  const { quantity, price } = sized ?? { quantity: undefined, price: undefined };
  if (quantity === undefined || quantity === null) return unknown('quantity_unresolved');
  if (quantity === 0) return unknown('quantity_zero');      // 1주 미만 — 기존 `quantity_below_min` 경로가 다룬다
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 0) return unknown('quantity_invalid');
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return unknown('price_invalid');

  if (market === 'domestic') {
    const cash = await deps.readCash();
    if (!cash) return unknown('cash_timeout');
    if (cash.domesticKRW == null) return unknown('domestic_cash_unknown');
    const v = judgeEntryCash({ availableCashKRW: cash.domesticKRW, quantity, price, bufferRatio: ENTRY_CASH_BUFFER_RATIO });
    if (v.kind === 'unknown') return unknown('judge_unknown');
    return { kind: v.kind, market, unit: 'KRW', required: v.requiredKRW, available: v.availableKRW };
  }

  const [cash, fx] = await Promise.all([deps.readCash(), deps.readFx()]);
  if (!cash) return unknown('cash_timeout');
  if (cash.overseasUSD == null) return unknown(cash.overseasUnknownReason ?? 'usd_unknown');
  if (!fx || fx.kind !== 'known') return unknown(fx?.reason ?? 'fx_invalid');
  const unitUsd = overseasLimitUnitUsd(price, fx.rate);
  if (unitUsd == null) return unknown('unit_price_invalid');
  // 센트 단위로 비교한다 — 원 단위 올림 함수(`estimateEntryCostKRW`)를 달러에 그대로 쓰면 1달러 단위로 올려 과하게 막는다.
  const v = judgeEntryCash({
    availableCashKRW: Math.round(cash.overseasUSD * 100),
    quantity,
    price: unitUsd * 100,
    bufferRatio: ENTRY_CASH_BUFFER_RATIO,
  });
  if (v.kind === 'unknown') return unknown('judge_unknown');
  return { kind: v.kind, market, unit: 'USD', required: v.requiredKRW / 100, available: v.availableKRW / 100 };
}

// ─────────────────────────────────────────────────────────────────────────────
// 관측 — 스로틀(프로세스 로컬) + best-effort 기록
// ─────────────────────────────────────────────────────────────────────────────

const throttle = new Map<string, { at: number; suppressed: number }>();

/** 테스트용 — 스로틀·스위치 캐시를 비운다 */
export function resetSignalCashGateState(): void { throttle.clear(); switchCache = null; }
/** 테스트용 */
export function throttleSize(): number { return throttle.size; }

/**
 * 이 키로 지금 기록해도 되는가. 창 안이면 억제 건수만 센다. 반환 `suppressed` 는 직전 기록 이후 억제된 건수.
 * 키가 쌓이면 만료 키를 지우고, 그래도 상한을 넘으면 오래된 것부터 지운다(장기 가동 메모리 고정).
 */
export function throttleCheck(key: string, now: number): { emit: boolean; suppressed: number } {
  const cur = throttle.get(key);
  if (cur && now - cur.at < GATE_LOG_WINDOW_MS) { cur.suppressed++; return { emit: false, suppressed: cur.suppressed }; }
  const suppressed = cur?.suppressed ?? 0;
  throttle.delete(key);
  throttle.set(key, { at: now, suppressed: 0 });
  if (throttle.size > THROTTLE_PRUNE_AT) {
    for (const [k, v] of throttle) if (now - v.at >= GATE_LOG_WINDOW_MS) throttle.delete(k);
    while (throttle.size > THROTTLE_MAX_KEYS) {
      const oldest = throttle.keys().next().value;
      if (oldest === undefined) break;
      throttle.delete(oldest);
    }
  }
  return { emit: true, suppressed };
}

/**
 * 판정 결과를 남긴다. **던지지 않는다** — 관측이 실패해도 판정(건너뜀)은 그대로다(S-5 ③).
 * - insufficient: 로그 1줄 + `trade_logs`(`signal_cash_gate_skip`) — (시장, 심볼, 방향)마다 1시간 1회
 * - unknown: 로그 1줄 — (시장, 사유)마다 1시간 1회 (게이트가 어떤 이유로 일을 못 하는지 보이게)
 * - disabled: 로그 1줄 — (시장, 출처)마다 1시간 1회
 * - sufficient: 로그 1줄 — 시장마다 1시간 1회 (배포 후 게이트가 살아 있는지 확인용)
 */
export async function observeSignalCashGate(
  args: { symbol: string; side: 'buy' | 'sell' },
  verdict: SignalCashGateVerdict,
  now: number = Date.now(),
): Promise<void> {
  try {
    if (verdict.kind === 'not_applicable') return;
    const m = verdict.market;
    if (verdict.kind === 'insufficient') {
      const t = throttleCheck(`skip:${m}:${args.symbol}:${args.side}`, now);
      if (!t.emit) return;
      console.info(
        `[signal-cash-gate] 현금 부족 매수 — 시그널·알림을 만들지 않음: market=${m} symbol=${args.symbol} side=${args.side} `
        + `reason=insufficient_cash suppressed_since_last=${t.suppressed}`,
      );
      try {
        await getPool().query(
          'INSERT INTO trade_logs (order_id, event, payload) VALUES (?, ?, ?)',
          [null, CASH_GATE_TRADE_LOG_EVENT, JSON.stringify({
            market: m, symbol: args.symbol, side: args.side, reason: 'insufficient_cash', suppressedSinceLast: t.suppressed,
          })],
        );
      } catch (e) {
        console.error('[signal-cash-gate] trade_logs 기록 실패(건너뜀은 유지):', e instanceof Error ? e.message : String(e));
      }
      return;
    }
    if (verdict.kind === 'unknown') {
      const t = throttleCheck(`unknown:${m}:${verdict.reason}`, now);
      if (t.emit) console.info(`[signal-cash-gate] 현금 판단 불가 — 막지 않고 기존대로 생성: market=${m} reason=${verdict.reason} suppressed_since_last=${t.suppressed}`);
      return;
    }
    if (verdict.kind === 'disabled') {
      const t = throttleCheck(`disabled:${m}:${verdict.source}`, now);
      if (t.emit) console.info(`[signal-cash-gate] 스위치 꺼짐 — 점검 생략: market=${m} source=${verdict.source}`);
      return;
    }
    const t = throttleCheck(`ok:${m}`, now);
    if (t.emit) console.info(`[signal-cash-gate] 점검 통과(현금 충분) — 시그널 생성: market=${m} suppressed_since_last=${t.suppressed}`);
  } catch { /* 관측 실패는 무시 */ }
}

// ─────────────────────────────────────────────────────────────────────────────

/** `p` 를 최대 `ms` 기다린다. 넘으면 `fallback`. 타이머는 항상 정리한다. `p` 의 거부는 그대로 전파한다. */
async function raceWithTimeout<T, F>(p: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<F>((resolve) => { timer = setTimeout(() => resolve(fallback), ms); });
  try {
    return await Promise.race([p, limit]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
