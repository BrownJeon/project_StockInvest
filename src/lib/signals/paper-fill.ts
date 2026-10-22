/**
 * T-072 (D-2) — 검증 관문에 **막힌 매수의 기록.** 사용자 결정 D-2 "가상 체결로 기록해서 검증 데이터로 사용".
 *
 * 두 가지를 남긴다:
 *  (a) `signals` 에 **승인 불가 감사 행** — `status='skipped'` + `indicators.gate='validation_gate'`.
 *      `skipped` 는 어떤 주문 경로(approveSignal/Hybrid·custom/confirm 원 카드 선점·entry-watcher)에도 들어가지 않고, HEAD 에서
 *      `skipped` 를 읽는 소비자가 없어 기존 9개 소비자(signal-quality·missed·학습셋 등)의 의미가 바뀌지 않는다(Stage 0 F 절).
 *      `price`·`price_at_skip` 을 채운다 — T-070 사후검증(`postmortem-core.js`)은 매수 시그널을 상태 무관하게 읽고 `price` 를 쓴다.
 *  (b) `paper_fills` 에 **가상 체결(진입) 1행** — 멱등 키 `UNIQUE(signal_id)`. 청산·손익은 여기서 계산하지 않는다
 *      (T-070/T-064 가 일봉으로 평가 — L-6).
 *      ⚠ WP-2b — `INSERT IGNORE` 를 쓰지 않는다: IGNORE 는 중복뿐 아니라 STRICT 의 데이터 오류(길이 초과·범위 초과)까지 경고로 낮춰
 *      **조용히 잘라 넣는다**. 일반 INSERT 로 두고 **중복(1062)만** "이미 있음"으로 받고, 그 밖의 오류는 던져서 아래 catch 가 삼키고
 *      로그한다(기록 실패 — 차단은 유지). `ON DUPLICATE KEY UPDATE` 는 쓰지 않는다: mysql2 기본 FOUND_ROWS 에서 "새 삽입"과
 *      "변경 없는 중복"이 둘 다 affectedRows 1 이라 새로 넣었는지 알 수 없다(WP-2a 일회용 DB 실증, `t072-disposable-mariadb.test.ts` D-3).
 *  (c) 막힌 매수 중 **새 행을 만들지 않는 경로**(G3 custom/confirm · G4 승인 · G5 entry-watcher)의 흔적 — `trade_logs`
 *      `signal_validation_gate` 이벤트({@link recordValidationGateEvent}).
 *
 * ## 실 장부와 격리 (L-3 확정)
 * `orders`·`executions`·`position_state`·`portfolio_snapshots`·`holdings` 에는 **쓰지 않는다.** 그 테이블들은 일일 한도·종목 한도·
 * 체결 손익·킬스위치 낙폭이 상태 필터만으로 합산하므로 가상 행이 섞이면 실계좌 판정이 오염된다(Stage 0 E 절).
 *
 * ## 실패 격리 (F-13)
 * 이 모듈의 함수는 **어떤 DB 오류도 던지지 않는다** — 로그만 남기고 null 을 돌려준다. 기록 실패가 차단을 풀면 안 되고(차단은 호출부가
 * 이미 결정했다), 엔진 런을 죽여서도 안 된다. 마이그레이션 전(테이블 없음)에도 같다.
 *
 * ## 통화 (Stage 0 E 절)
 * 해외는 **현지 통화(USD) 단가**를 같이 저장한다 — 어댑터와 같은 `overseasLimitUnitUsd`(원화 지정가 ÷ 환율 → 호가 반올림) 로 만든다.
 * 환율은 `fx_rates` DB 행이 **1시간 이내**일 때만 쓴다(외부 조회 없음). 모르면 USD 단가·환율 NULL 로 두고 기록은 남긴다.
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { getMarketFromSymbol, type Market } from '@/lib/exchanges/kis-symbols';
import type { ValidationGateReason } from '@/lib/safety/validation-gate';
import { judgeFxRow, overseasLimitUnitUsd } from './signal-cash-gate';

/** 감사 행 상태 — 승인 불가(어떤 주문 경로도 이 상태를 집지 않는다) */
export const VALIDATION_AUDIT_STATUS = 'skipped' as const;
/** 감사 행 `indicators.gate` 값 */
export const VALIDATION_GATE_INDICATOR = 'validation_gate' as const;

/**
 * 진입 편도 수수료율(%) — 행마다 `fee_rate_pct` 로 남겨 평가 단계에서 바꿀 수 있게 한다(F-5).
 *  - 해외 0.25% (사용자 확정)
 *  - 국내 0.014% — 실제 매수 위탁수수료(`style.ts` 주석). 매도 제세금·수수료는 평가 단계(T-064/T-070)가 적용한다.
 */
export const PAPER_FILL_FEE_RATE_PCT: Record<Market, number> = { overseas: 0.25, domestic: 0.014 };

export type PaperFillOrigin = 'engine' | 'post_market' | 'api_signals' | 'analyst_run' | 'unspecified';
/**
 * 체결 가정 라벨 — 낙관적 가정이므로 분석 때 이 라벨로 보정한다.
 *  - `signal_limit_immediate`  : 룰 시그널(지정가) — "즉시 승인했다면" (승인 지연·30분 TTL 무시)
 *  - `signal_market_immediate` : 시장가 시그널 — 지정가가 없어 기준가 = 시그널 가격 (현재 룰 매수는 전부 지정가라 API 경로에서만 생긴다)
 *  - `zone_touch_pending`      : post-market 카드(구간 진입형) — 체결 여부는 평가 단계가 valid_from~valid_until 일봉 고저로 판정
 */
export type PaperFillModel = 'signal_limit_immediate' | 'signal_market_immediate' | 'zone_touch_pending';

export interface PaperFillInput {
  /** 원 시그널(감사 행·카드 행) id — 멱등 키 */
  signalId: number;
  strategyId: string | null;
  gateReason: ValidationGateReason;
  origin: PaperFillOrigin;
  symbol: string;
  orderType: 'limit' | 'market';
  /** 원화 지정가(해외는 원화 환산값) — 호가 추격까지 반영한 실제 주문가. 모르면 null */
  limitPriceKrw: number | null | undefined;
  /** 실제 주문과 같은 사이징의 정수 주식 수. 시장가 등 미확정이면 null */
  quantity: number | null | undefined;
  /** 의도 금액(시그널 amount_krw) — 재계산하지 않는다 */
  amountKrw: number;
  fillModel: PaperFillModel;
  /** 구간 진입형(카드) — **현지 통화** 값을 호출부가 넘긴다 */
  zoneLo?: number | null;
  zoneHi?: number | null;
  /**
   * KST. `Date` 이거나 **DB `DATETIME` 문자열**(`YYYY-MM-DD HH:MM:SS`, KST 벽시계 — post-market 카드의 `valid_from`·`expires_at`
   * 과 같은 값을 그대로 넘긴다. 다시 `Date` 로 바꾸면 시간대 해석이 한 번 더 끼어든다).
   */
  validFrom?: Date | string | null;
  validUntil?: Date | string | null;
  /** 원 시그널 생성 시각. 없으면 DB NOW() */
  signalCreatedAt?: Date | null;
}

export interface PaperFillWriteResult {
  /** 이번 호출로 새 행이 생겼는가 (같은 signal_id 가 이미 있으면 false) */
  inserted: boolean;
  id: number | null;
  /** 같은 signal_id 행이 이미 있었다(1062) — 오류가 아니다 */
  duplicate?: boolean;
  /** 중복이 아닌 기록 실패(테이블 없음·STRICT 데이터 오류·DB 장애) */
  error?: string;
}

/** MariaDB/MySQL 유니크 키 충돌(1062, ER_DUP_ENTRY) */
function isDuplicateKeyError(e: unknown): boolean {
  const err = e as { errno?: unknown; code?: unknown } | null | undefined;
  return err?.errno === 1062 || err?.code === 'ER_DUP_ENTRY';
}

function finitePositive(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}
function finiteNonNegative(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}
function round2(n: number): number { return Math.round(n * 100) / 100; }
function errMsg(e: unknown): string { return e instanceof Error ? e.message : String(e); }

/**
 * `fx_rates` 의 USD_KRW 가 **1시간 이내**면 그 값, 아니면 null. 외부 조회를 유발하지 않는다(`getUsdKrwRate` 를 부르지 않음).
 * 판정 규칙(나이·상식 범위)은 T-058 현금 게이트와 같은 `judgeFxRow` 를 쓴다. 던지지 않는다.
 */
export async function readFreshUsdKrw(): Promise<number | null> {
  try {
    const [rows] = await getPool().query<RowDataPacket[]>(
      'SELECT rate, TIMESTAMPDIFF(SECOND, fetched_at, NOW()) AS age_sec FROM fx_rates WHERE pair = ? LIMIT 1',
      ['USD_KRW'],
    );
    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row) return null;
    const j = judgeFxRow(row.rate, row.age_sec);
    return j.kind === 'known' ? j.rate : null;
  } catch {
    return null;
  }
}

/**
 * 가상 체결 1행. 멱등(`UNIQUE(signal_id)` — 중복 1062 만 "이미 있음"). **던지지 않는다.**
 * 중복이 아닌 오류(STRICT 데이터 오류 포함)는 잘라 넣지 않고 기록하지 않은 채 `error` 로 돌려준다.
 */
export async function insertPaperFill(p: PaperFillInput): Promise<PaperFillWriteResult> {
  try {
    const market = getMarketFromSymbol(p.symbol);
    const currency = market === 'overseas' ? 'USD' : 'KRW';
    const priceKrw = finitePositive(p.limitPriceKrw);

    let fx: number | null = null;
    let limitPrice: number | null = null;
    if (market === 'overseas') {
      fx = await readFreshUsdKrw();
      if (p.orderType === 'limit' && priceKrw != null && fx != null) limitPrice = overseasLimitUnitUsd(priceKrw, fx);
    } else if (p.orderType === 'limit') {
      limitPrice = priceKrw;   // 국내: 원화 그대로 (어댑터가 송신 시 호가단위로 반올림 — 최대 1호가 차이)
    }

    const quantity = finiteNonNegative(p.quantity);
    const feeRatePct = PAPER_FILL_FEE_RATE_PCT[market];
    const notionalKrw = quantity != null && priceKrw != null ? quantity * priceKrw : finitePositive(p.amountKrw);
    const feeEstKrw = notionalKrw != null ? round2((notionalKrw * feeRatePct) / 100) : null;

    let res: ResultSetHeader;
    try {
      [res] = await getPool().query<ResultSetHeader>(
        `INSERT INTO paper_fills
           (signal_id, strategy_id, gate_reason, origin, market, symbol, side, order_type, currency,
            limit_price, limit_price_krw, fx_usdkrw, zone_lo, zone_hi, quantity, amount_krw,
            fee_rate_pct, fee_est_krw, fill_model, valid_from, valid_until, signal_created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'buy', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()))`,
        [
          p.signalId, p.strategyId, p.gateReason, p.origin, market, p.symbol, p.orderType, currency,
          limitPrice, priceKrw, fx, p.zoneLo ?? null, p.zoneHi ?? null, quantity, p.amountKrw,
          feeRatePct, feeEstKrw, p.fillModel, p.validFrom ?? null, p.validUntil ?? null, p.signalCreatedAt ?? null,
        ],
      );
    } catch (e) {
      // 같은 signal_id 가 이미 있다 = 멱등(오류 아님). 먼저 들어간 행을 덮어쓰지 않는다. 그 밖의 오류는 아래 catch 로 — 기록 실패.
      if (isDuplicateKeyError(e)) return { inserted: false, id: null, duplicate: true };
      throw e;
    }
    const inserted = Number(res?.affectedRows) === 1;
    return { inserted, id: inserted ? Number(res.insertId) : null };
  } catch (e) {
    const error = errMsg(e);
    console.error(`[paper-fill] 가상 체결 기록 실패(차단은 유지) signal=${p.signalId} ${p.symbol}: ${error}`);
    return { inserted: false, id: null, error };
  }
}

export interface ValidationAuditSignalInput {
  strategyId: string | null;
  symbol: string;
  orderType: 'limit' | 'market';
  /** 시그널 원 가격(호가 추격 전 — 실제 시그널 INSERT 와 같은 값). `price`·`price_at_skip` 에 들어간다 */
  price: number | null | undefined;
  quantity: number | null | undefined;
  amountKrw: number;
  reasoning: string | null | undefined;
  indicators: unknown;
  expiresAt: Date | null;
  gateReason: ValidationGateReason;
  /** 읽은 검증 상태 원값 (없으면 null) */
  gateStatus: string | null;
  origin: PaperFillOrigin;
}

/**
 * 막힌 시그널·카드의 `indicators` 에 관문 표지를 더한 JSON 문자열(`gate='validation_gate'` + `validation_gate:{reason,status,origin}`).
 * 원래 indicators(카드의 진입 구간·목표·손절 = 검증 데이터)는 그대로 둔다. 객체가 아니면 표지만 남긴다. 던지지 않는다.
 */
export function withValidationGateIndicators(
  indicators: unknown,
  g: { reason: ValidationGateReason; status: string | null; origin: PaperFillOrigin },
): string {
  const mark = { gate: VALIDATION_GATE_INDICATOR, validation_gate: { reason: g.reason, status: g.status, origin: g.origin } };
  const base = indicators != null && typeof indicators === 'object' && !Array.isArray(indicators)
    ? { ...(indicators as Record<string, unknown>) }
    : {};
  try {
    return JSON.stringify({ ...base, ...mark });
  } catch {
    return JSON.stringify(mark);
  }
}

/** 승인 불가 감사 행(`skipped`). 새 행 id, 실패면 null. **던지지 않는다.** */
export async function insertValidationAuditSignal(a: ValidationAuditSignalInput): Promise<number | null> {
  try {
    const market = getMarketFromSymbol(a.symbol);
    const price = finitePositive(a.price);
    if (price == null) {
      console.warn(`[paper-fill] 감사 행 가격 없음 — price/price_at_skip NULL 로 기록: ${a.symbol} (${a.orderType})`);
    }
    const indicatorsJson = withValidationGateIndicators(a.indicators, { reason: a.gateReason, status: a.gateStatus, origin: a.origin });
    const [res] = await getPool().query<ResultSetHeader>(
      `INSERT INTO signals
         (strategy_id, symbol, side, order_type, price, quantity, amount_krw,
          reasoning, indicators, status, expires_at, price_at_skip, market)
       VALUES (?, ?, 'buy', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        a.strategyId, a.symbol, a.orderType, price, finiteNonNegative(a.quantity), a.amountKrw,
        a.reasoning ?? null, indicatorsJson, VALIDATION_AUDIT_STATUS, a.expiresAt, price, market,
      ],
    );
    const id = Number(res?.insertId);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch (e) {
    console.error(`[paper-fill] 감사 행 기록 실패(차단은 유지) ${a.symbol}: ${errMsg(e)}`);
    return null;
  }
}

export interface RecordBlockedBuyInput extends ValidationAuditSignalInput {
  /** 실제 주문과 같은 사이징 결과(호가 추격 반영 지정가·정수 수량) — 가상 체결에 쓴다. 감사 행에는 시그널 원값이 들어간다 */
  sized: { limitPriceKrw: number | null | undefined; quantity: number | null | undefined };
}

export interface RecordBlockedBuyResult {
  auditSignalId: number | null;
  paperFillId: number | null;
  paperFillInserted: boolean;
}

/**
 * 시그널 경로(G1) 한 건: 감사 행 → 그 id 로 가상 체결. 감사 행이 실패하면 가상 체결도 만들지 않는다(멱등 키가 없다).
 * **던지지 않는다.** 중복 방지(쿨다운 선점)는 호출부 몫이다 — 이 함수는 부를 때마다 감사 행을 하나 만든다.
 */
export async function recordValidationBlockedBuy(r: RecordBlockedBuyInput): Promise<RecordBlockedBuyResult> {
  try {
    const auditSignalId = await insertValidationAuditSignal(r);
    if (auditSignalId == null) return { auditSignalId: null, paperFillId: null, paperFillInserted: false };
    const pf = await insertPaperFill({
      signalId: auditSignalId,
      strategyId: r.strategyId,
      gateReason: r.gateReason,
      origin: r.origin,
      symbol: r.symbol,
      orderType: r.orderType,
      limitPriceKrw: r.sized.limitPriceKrw,
      quantity: r.sized.quantity,
      amountKrw: r.amountKrw,
      fillModel: r.orderType === 'limit' ? 'signal_limit_immediate' : 'signal_market_immediate',
      validUntil: r.expiresAt,
    });
    return { auditSignalId, paperFillId: pf.id, paperFillInserted: pf.inserted };
  } catch (e) {
    console.error(`[paper-fill] 기록 예외(차단은 유지) ${r.symbol}: ${errMsg(e)}`);
    return { auditSignalId: null, paperFillId: null, paperFillInserted: false };
  }
}

/**
 * `trade_logs.event` — **varchar(32)·STRICT** 라 33자면 INSERT 가 실패하고, 감사 보조 기록이라 삼키므로 아무 데도 남지 않는다
 * (`service.ts` TRADE_LOG_EVENTS 주석). 22자. 시험이 길이를 단언한다.
 */
export const VALIDATION_GATE_TRADE_LOG_EVENT = 'signal_validation_gate' as const;

export interface ValidationGateEventInput {
  /** 어느 관문에서 막혔는가 — `custom-confirm`(G3)·`signal-approve`·`signal-approve-hybrid`(G4)·`entry-watcher`(G5) */
  where: string;
  signalId: number | null;
  strategyId: string | null;
  symbol: string;
  side: string;
  reason: ValidationGateReason;
}

/**
 * G3·G4·G5 의 차단 흔적 1행(`trade_logs`). 이 경로들은 새 시그널 행을 만들지 않으므로(가상 체결도 없음) 감사 원칙 3
 * (성공·거부·에러 모두 남긴다)의 기록처가 여기다. payload = `{where, signalId, strategyId, symbol, side, reason}`.
 * **던지지 않는다**(기록 실패가 차단 결과를 바꾸지 않는다). 성공하면 true.
 */
export async function recordValidationGateEvent(e: ValidationGateEventInput): Promise<boolean> {
  try {
    await getPool().query(
      'INSERT INTO trade_logs (order_id, event, payload) VALUES (?, ?, ?)',
      [null, VALIDATION_GATE_TRADE_LOG_EVENT, JSON.stringify({
        where: e.where, signalId: e.signalId, strategyId: e.strategyId, symbol: e.symbol, side: e.side, reason: e.reason,
      })],
    );
    return true;
  } catch (err) {
    console.error(`[validation-gate] trade_logs 기록 실패(차단은 유지) where=${e.where} signal=${e.signalId ?? '-'} ${e.symbol}: ${errMsg(err)}`);
    return false;
  }
}
