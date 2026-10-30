import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { sendAlert } from '@/lib/notify';
import { sendAlertThrottled, resetAlertThrottle } from '@/lib/notify/throttle';
import { minutesSinceSessionOpen } from '@/lib/strategy/market-hours';
import { evaluateVanish } from './snapshot-composition';

async function getVolGuardEnabled(): Promise<boolean> {
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { value: string })[]>(
      "SELECT value FROM system_config WHERE `key` = 'vol_guard_enabled' LIMIT 1",
    );
    if (rows.length > 0) return JSON.parse(rows[0].value) === true;
  } catch { /* fall through */ }
  return process.env.VOL_GUARD_ENABLED === 'true';
}

export interface VolatilityGuardResult {
  ok: boolean;
  level?: 'warn' | 'block' | 'panic';
  changePct?: number;
  detail?: string;
}

export interface VolatilityConfig {
  warnPct:   number;   // default -2%
  blockPct:  number;   // default -4%
  panicPct:  number;   // default -7%
  windowMin: number;   // default 60
}

export async function getVolatilityConfig(): Promise<VolatilityConfig> {
  const partial: Partial<VolatilityConfig> = {};
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { key: string; value: string })[]>(
      "SELECT `key`, value FROM system_config WHERE `key` LIKE 'vol_guard_%'",
    );
    for (const r of rows) {
      const v = Number(JSON.parse(r.value));
      if (r.key === 'vol_guard_warn_pct')   partial.warnPct   = v;
      if (r.key === 'vol_guard_block_pct')  partial.blockPct  = v;
      if (r.key === 'vol_guard_panic_pct')  partial.panicPct  = v;
      if (r.key === 'vol_guard_window_min') partial.windowMin = v;
    }
  } catch { /* fall through */ }
  return {
    warnPct:   partial.warnPct   ?? Number(process.env.VOL_GUARD_WARN_PCT   ?? -2),
    blockPct:  partial.blockPct  ?? Number(process.env.VOL_GUARD_BLOCK_PCT  ?? -4),
    panicPct:  partial.panicPct  ?? Number(process.env.VOL_GUARD_PANIC_PCT  ?? -7),
    windowMin: partial.windowMin ?? Number(process.env.VOL_GUARD_WINDOW_MIN ?? 60),
  };
}

/**
 * 심볼별 변동성 배율 (BTC 1.0x, ETH 1.3x, 신규 1.5x)
 */
function symbolMultiplier(symbol?: string): number {
  if (!symbol) return 1.5;
  const s = symbol.toUpperCase();
  if (s.includes('BTC')) return 1.0;
  if (s.includes('ETH')) return 1.3;
  return 1.5;
}

/**
 * 최근 windowMin 내 포트폴리오 변동률 확인.
 * - warn:  changePct ≤ warnPct  → 경고만
 * - block: changePct ≤ blockPct → KILL_SWITCH 권고 (호출부에서 처리)
 * - panic: changePct ≤ panicPct → 패닉 청산 권고
 */
export async function checkVolatilityGuard(
  symbol?: string,
): Promise<VolatilityGuardResult> {
  if (!(await getVolGuardEnabled())) return { ok: true };

  const cfg = await getVolatilityConfig();
  const mult = symbolMultiplier(symbol);
  const warnPct  = cfg.warnPct  * mult;
  const blockPct = cfg.blockPct * mult;
  const panicPct = cfg.panicPct * mult;

  try {
    const pool = getPool();
    const windowMs = cfg.windowMin * 60_000;
    const cutoff = new Date(Date.now() - windowMs);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT total_krw FROM portfolio_snapshots
       WHERE ts >= ? ORDER BY ts ASC LIMIT 1`,
      [cutoff],
    );
    if (rows.length === 0) return { ok: true }; // 기준 스냅샷 없음 → 통과

    const baseline = Number(rows[0].total_krw);
    const [cur] = await pool.query<RowDataPacket[]>(
      `SELECT total_krw FROM portfolio_snapshots ORDER BY ts DESC LIMIT 1`,
    );
    if (!cur[0]) return { ok: true };

    const current = Number(cur[0].total_krw);
    if (baseline <= 0) return { ok: true };

    const changePct = ((current - baseline) / baseline) * 100;

    if (changePct <= panicPct) {
      return { ok: false, level: 'panic', changePct, detail: `${changePct.toFixed(2)}% ≤ panic ${panicPct}%` };
    }
    if (changePct <= blockPct) {
      return { ok: false, level: 'block', changePct, detail: `${changePct.toFixed(2)}% ≤ block ${blockPct}%` };
    }
    if (changePct <= warnPct) {
      // warn은 차단하지 않고 로그만
      console.warn(`[vol-guard] WARN ${changePct.toFixed(2)}% ≤ ${warnPct}%`);
      return { ok: true, level: 'warn', changePct };
    }
    return { ok: true, changePct };
  } catch (e) {
    // DB 실패 시 보수적 통과 (장애 시 주문 막지 않음)
    console.error('[vol-guard] check failed:', e);
    return { ok: true };
  }
}

// ─── 스냅샷 sanity guard (T-012, 2026-08-09 재설계) ───────────────────────────
//
// `portfolio_snapshots.total_krw` 는 표시값이 아니라 **안전장치 입력값**이다:
//   - kill-switch.ts   : 24h drawdown 기준선 (오염 → 오발동 또는 실제 폭락 은폐)
//   - volatility-guard : 변동성 가드 baseline/current
//   - order-limits     : order_max_pct 가 포트폴리오 총액의 %
// 따라서 "그럴듯해 보이는 틀린 값"을 넣는 것이 값을 넣지 않는 것보다 위험하다.
//
// ## 실측으로 확인된 고장 유형 (2026-04-27 ~ 2026-08-09)
//
//  (A) **보유 종목이 0원으로 평가됨** — 12행. 전부 `source='dashboard'`.
//      `/api/portfolio` 가 `price = t?.price ?? 0` 으로 **시세 조회 실패를 0원 sentinel 로**
//      기록한다. 총액은 그 종목만큼 조용히 축소된다(-5.4% ~ -73.7%).
//      cron 경로는 같은 실패에 avgPrice 폴백이 있어 이 유형이 한 건도 없다.
//  (B) **보유 종목이 통째로 사라짐** — cron 은 시세 실패 + avgPrice 부재 시 종목을 `continue`
//      로 빼버리고, `kis.getBalances()` 는 한쪽 시장 실패 시 그 시장 잔고 전체를 `[]` 로
//      돌려준다. 이때 positions 에는 **0원 항목조차 남지 않아** (A) 검사로는 못 잡는다.
//      (2026-06-04·06-06 로그의 ratio 0.15~0.16 거부 2건이 이 유형)
//  (C) **단위 오류** — USD raw 가격이 KRW 로 환산되지 않아 ~1500배 어긋남 (2026-04-28, 16건).
//
// ## 4단 방어
//
//  1. `validateSnapshotPositions` — (A) 담당. qty>0 인데 price<=0 이면 거부. **인과적 근본 검사.**
//     Σvalue_krw 와 totalKRW 정합성도 함께 본다.
//  2. 절대 밴드 [1,000, 100,000,000] — (C) 담당. 기존 유지.
//  3. 24h median ±5배 — (C) 의 완만한 변종 담당. 기존 유지. **넓게 두는 것이 의도**다.
//     실제 시장 급락(-30% 하한가)·입출금을 거부하지 않기 위한 폭이므로 좁히지 않는다.
//  4. `checkHoldingVanished` — (B) 담당. **비율이 아니라 "구성 변화"로 판정**한다.
//     보유 종목이 사라졌는데 그 금액이 현금으로 이동하지 않고 총액에서 증발했으면 거부.
//     시세 하락은 종목을 사라지게 하지 못하므로 진짜 폭락을 오거부하지 않는다.
//
// 어느 단계든 걸리면 INSERT 를 건너뛰고 경고 로그 + (스로틀된) 알림. 예외는 던지지 않는다
// (cron 실패 회피).
//
// ## 거부의 반대편 위험 — 무한 실명(blindness) (reviewer HIGH 1, 2026-08-09)
//
// 거부는 "값을 지어내지 않는다"를 지키지만, **영원히 거부하면 그 자체가 위험**이 된다.
// 거래정지·상장폐지로 단가가 *정말로* 0인 종목이 생기면 1단은 모든 INSERT 를 무기한 막고,
// 킬스위치의 "현재값"과 "기준선"이 정지 직전 값에 얼어붙는다 — 데이터를 위조해서가 아니라
// **관측을 멈춰서** 실제 폭락을 은폐하게 된다. 이 작업이 막으려던 바로 그 결과다.
//
// ### 실측 (전이력 리플레이, 2026-08-09 · reviewer 지적으로 재측정)
//
// 관측 공백을 "직전 정상 스냅샷 → 다음 정상 스냅샷" 으로 올바르게 재면:
// **중앙값 150분, 39%(43건)가 3시간 초과, 최장 6시간**, 가장 최근 3시간 초과는 2026-07-29.
// (내가 처음 보고한 71분·7건은 에피소드 시작을 *첫 거부 행*에 맞춘 계산 오류였다 —
//  마지막 *정상* 행부터 재야 하고, 그 차이가 공백의 절반이다.)
// 킬스위치 기준선 조회창은 24h±60분, 즉 **폭 2시간**이라 3시간 공백이면 통째로 비어버린다.
//
// ### 그래서 택한 것: 자동 밸브 없음 + 명시적 탈출구 + 시끄러운 실명 경보
//
//  - **1단에 시간 기반 자동 밸브를 두지 않는다.** 밸브는 N시간 뒤 "보유 종목을 0원으로 평가한
//    총액"을 승인한다는 뜻인데, 그 0원이 *조회 실패* 였다면 -74% 짜리 총액이 킬스위치에
//    들어가 **전 매매를 오정지**시킨다. 밸브는 정지/상폐와 조회 실패를 구분할 수 없다.
//    구분할 수 있는 것은 사람뿐이다.
//  - **탈출구는 사람이 기록으로 남기는 판단**: `system_config.snapshot_zero_price_symbols`
//    에 심볼을 넣으면 그 종목의 0원을 정상으로 인정한다. 값을 지어내는 것이 아니라
//    **사람의 판정을 감사 가능하게 기록**하는 것이다.
//  - **실명은 시끄럽게 만든다**: `checkSnapshotFreshness()` 가 마지막 성공 스냅샷의 나이를
//    보고, 90분 경과 시 warning, 3시간 경과 시 **critical** 로 승격한다(2시간마다 재알림,
//    복구 시 회복 알림). 경보문에 **막고 있는 심볼과 조치 방법**을 함께 넣어, 운영자가
//    무엇을 allowlist 에 넣어야 하는지 바로 알 수 있게 한다.
//
// 실명 감시는 **거부 원인과 무관하게** 동작해야 한다(잔고 부분 실패로 cron 이 아예 저장을
// 시도조차 못 하는 경우도 같은 실명이다). 그래서 내부 카운터가 아니라 테이블의 `MAX(ts)` 를
// 본다 — 원인이 무엇이든 "마지막으로 포트폴리오를 본 시각"이 유일한 진실이다.

/** 스냅샷 1행의 보유 항목. 두 저장 경로가 공통으로 만드는 모양. */
export interface SnapshotPosition {
  currency:  string;
  qty:       number;
  /** KRW 환산 단가. 현금 KRW 는 1, USD 는 환율. */
  price:     number;
  value_krw: number;
  locked?:   number;
  /** 현금 행의 출처 (T-056 — USD 는 `'CTRP6504R'`). 판정에 쓰지 않는다. */
  src?:      string;
  /**
   * (USD 행 전용, T-056) KIS `output3.ustl_sll_amt_smtl`(미결제매도금액합계) 원값 — 0 보다 클 때만 기록. **총액에 넣지 않는다.**
   * 첫 해외 매도 직후(단계 4) 예수금이 체결기준인지 판별하는 사후 자료다.
   */
  ustl_sll_amt_smtl?: number;
}

/**
 * 이 틱에 **반드시 있어야 하는 현금 행** (T-056). 크론이 그 틱에 실제로 쓴 시장 활성 값을 그대로 넘긴다.
 * 직전 행과 비교하지 않는다 — 그래서 최초 배포 첫 행·비활성→활성 첫 행도 정상으로 저장되고,
 * 활성→비활성 뒤에는 USD 를 요구하지 않아 데드락이 없다(Codex C1-3).
 */
export interface SnapshotCashRequirement {
  /** 해외 시장 활성 틱이면 true — USD 행이 정확히 1개, qty 유한·≥0, price(환율) > 0 이어야 저장한다 */
  usdCashRequired: boolean;
  /** 국내 KRW 행 (Q3) — 크론은 항상 true. KRW 행이 정확히 1개, qty 유한·≥0, price 가 1 이어야 저장한다 */
  krwCashRequired: boolean;
}

export type SnapshotRejectCode =
  | 'position_price_zero'   // qty>0 인데 단가가 0/음수 — 시세 조회 실패 sentinel
  | 'position_malformed'    // positions 구조·수치 이상
  | 'total_mismatch'        // Σvalue_krw ≠ totalKRW
  | 'abs_band'              // 절대 상·하한 이탈
  | 'median_band'           // 24h median ±5배 이탈
  | 'holding_vanished'      // 보유 종목이 현금 이동 없이 소실
  | 'cash_row_missing';     // (T-056) 이 틱에 있어야 할 현금 행(USD·KRW)이 없거나 값이 이상 — 릴리스 밸브 없음

export interface SnapshotReject {
  code:   SnapshotRejectCode;
  detail: string;
}

const SANITY_MAX_KRW = 100_000_000;       // 1억원 절대 상한
const SANITY_MIN_KRW = 1_000;             // 1000원 절대 하한 (오타·1원짜리 노이즈 차단)
const SANITY_RATIO   = 5;                 // 직전 24h median 대비 ±5배 허용

/** Σvalue_krw 와 totalKRW 허용 오차 — 반올림·부동소수 오차만 흡수하면 된다. */
const TOTAL_TOLERANCE_PCT = 0.005;
const TOTAL_TOLERANCE_KRW = 1_000;

/**
 * 직전 스냅샷이 이보다 오래되면 구성 비교(4단)를 **하지 않는다**.
 *
 * 이것이 릴리스 밸브다. 보유 종목이 *진짜로* 계좌에서 빠져나간 경우(대체출고 등) 구성 비교는
 * 매 tick 거부를 반복하며 스냅샷을 영구 기아 상태로 만들 수 있다. 거부가 이어지면 직전
 * 스냅샷의 나이가 계속 늘어나고, 3시간을 넘는 순간 이 검사가 스스로 비활성화되어 새 현실이
 * 기록된다. 정상 최대 간격은 cron 이 보장하는 90분이므로 2배 여유다.
 */
const COMPOSITION_MAX_AGE_MS = 3 * 60 * 60 * 1000;
// 소실 판정의 임계값(VANISH_MIN_SHARE 10% / VANISH_DROP_RATIO 70%)과 현금 항목 정의는
// `./snapshot-composition` 한 곳에 있다 (T-041). 킬스위치의 24h 드로다운 검사도 같은 파일의 상수·현금 정의를
// 쓴다 — 어긋나면 "저장 가드는 증발이라 거부했는데 킬스위치는 -72% 손실로 읽는" 사고가 재발한다.

// ─── 실명 임계 — **거래 세션 인식** (2026-08-09) ──────────────────────────────
//
// 왜 세션을 보는가: 고정 임계(90분 warn / 3시간 critical / 2시간 재알림)는 **매일 밤·주말·
// 공휴일마다** 경보를 보낸다. 스냅샷이 안 늘어나는 것이 그 시간대에는 **정상**이기 때문이다.
// 경보 피로는 안전장치를 약화시킨다 — 매일 오는 알림 속에서 진짜 한 건을 놓친다.
//
// ⚠️ 이 포트폴리오는 KRX 종목(005930·000660)과 **미국 종목(NAS:SNPS·NYS:ORCL)을 함께**
//    들고 있다. 따라서 "장중"은 KRX 09:00~15:30 KST 만이 아니다. 두 세션 중 **하나라도**
//    열려 있으면 데이터가 흘러야 한다 — `getCurrentMarket()` 이 정확히 그 판정이며,
//    시장별 공휴일 캘린더(`market_holidays`)와 US DST 를 이미 반영한다.
//
// 폐장 중이라고 감시를 끄지는 않는다. cron 은 폐장 중에도 계속 돌고(`shouldSkipFetch` 가
// 마지막 스냅샷 90분 이내일 때만 건너뛰므로 실효 간격 약 2시간), 무엇보다 **다음 개장을
// 낡은 기준선으로 맞는 것**이 위험하다. 임계만 넉넉하게 둔다.

/** 장중: cron 1주기(60분)를 통째로 놓친 수준. */
const BLIND_WARN_MS     = 90 * 60 * 1000;
/** 장중: 킬스위치 기준선 조회창(폭 2시간)이 통째로 빌 수 있는 수준 → critical. */
const BLIND_CRITICAL_MS = 3 * 60 * 60 * 1000;
/** 폐장 중: 실효 간격 약 2시간의 3배. 밤새 한 번 놓친 정도로는 울리지 않는다. */
const BLIND_WARN_CLOSED_MS     = 6 * 60 * 60 * 1000;
/** 폐장 중: 이 정도면 다음 개장을 관측 없이 맞는다 → critical. */
const BLIND_CRITICAL_CLOSED_MS = 12 * 60 * 60 * 1000;
/** critical 재알림 간격(장중). 6시간 실명에 알림 3건 수준으로 억제한다. */
const BLIND_REALERT_MS  = 2 * 60 * 60 * 1000;
/** critical 재알림 간격(폐장 중). 주말 내내 반복되지 않도록 더 길게. */
const BLIND_REALERT_CLOSED_MS = 6 * 60 * 60 * 1000;

/**
 * **0원을 정상으로 인정할 심볼** — 거래정지·상장폐지처럼 단가가 진짜로 0인 경우의 탈출구.
 *
 * `system_config.snapshot_zero_price_symbols` = `["NAS:XYZ", ...]` (JSON 배열).
 * 자동 밸브를 두지 않는 대신 **사람이 판단을 기록으로 남기는** 통로다. 자세한 이유는 파일
 * 상단 "무한 실명" 절 참고. 비어 있는 것이 정상 상태이며, 넣을 때마다 로그가 남는다.
 */
const ALLOWLIST_TTL_MS = 60_000;
let allowlistCache: { value: ReadonlySet<string>; at: number } | null = null;

export async function getZeroPriceAllowlist(): Promise<ReadonlySet<string>> {
  if (allowlistCache && Date.now() - allowlistCache.at < ALLOWLIST_TTL_MS) return allowlistCache.value;
  let value: ReadonlySet<string> = new Set();
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { value: string })[]>(
      "SELECT value FROM system_config WHERE `key` = 'snapshot_zero_price_symbols' LIMIT 1",
    );
    if (rows.length > 0) {
      const parsed: unknown = JSON.parse(rows[0].value);
      if (Array.isArray(parsed)) {
        value = new Set(parsed.filter((s): s is string => typeof s === 'string' && s.length > 0));
      }
    }
  } catch { /* 조회 실패 시 빈 집합 — 즉 평소처럼 엄격하게 검사한다 (fail-safe 방향) */ }
  allowlistCache = { value, at: Date.now() };
  return value;
}

/** 테스트/진단용 — allowlist 캐시 무효화 */
export function clearZeroPriceAllowlistCache(): void {
  allowlistCache = null;
}

/**
 * 보유 항목 무결성 검사 (DB 불필요 — 순수 함수).
 *
 * **왜 "0원 종목이 큰 비중일 때만" 거부하지 않는가**: 실측 12행의 총액 과소 폭은
 * -5.4% ~ -73.7% 로 연속 분포한다. 킬스위치 임계가 -10% 이므로 그 아래에 안전한 경계선이
 * 없다 — -10.3% 짜리(id=1287) 하나만으로도 킬스위치가 오발동할 수 있다. 또한 기준선으로
 * 쓰일 때는 부호가 뒤집혀 실제 -10% 폭락을 **은폐**한다. 크기와 무관하게 거부한다.
 *
 * **왜 원인을 따지지 않는가**: 거래정지·상장폐지로 단가가 정당하게 0일 가능성이 남더라도,
 * 보유 중인 종목을 "0원짜리"로 총액에 반영하는 것은 어느 쪽이든 틀렸다. 안전장치가 필요한
 * 값은 "포트폴리오 가치"이고, *모르는 값*을 *0원*으로 조용히 부호화하면 안 된다.
 */
export function validateSnapshotPositions(
  totalKRW: number,
  positions: SnapshotPosition[],
  /** 0원을 정상으로 인정할 심볼(운영자가 기록한 판단). 기본값 없음 = 전부 엄격 검사. */
  allowZero: ReadonlySet<string> = new Set(),
): SnapshotReject | null {
  if (!Array.isArray(positions) || positions.length === 0) {
    return { code: 'position_malformed', detail: 'positions 가 비어 있거나 배열이 아님' };
  }

  let sum = 0;
  for (const p of positions) {
    if (!p || typeof p.currency !== 'string' || p.currency === '') {
      return { code: 'position_malformed', detail: 'currency 없는 항목이 있음' };
    }
    const qty   = Number(p.qty);
    const price = Number(p.price);
    const value = Number(p.value_krw);
    if (!Number.isFinite(qty) || !Number.isFinite(price) || !Number.isFinite(value)) {
      return {
        code: 'position_malformed',
        detail: `${p.currency}: 수치 아님 (qty=${p.qty} price=${p.price} value_krw=${p.value_krw})`,
      };
    }
    if (qty > 0 && !(price > 0)) {
      if (!allowZero.has(p.currency)) {
        return {
          code: 'position_price_zero',
          detail: `${p.currency}: qty=${qty} 인데 price=${price}`
                + ' — 이 종목이 거래정지·상장폐지로 정말 0원이라면'
                + ' system_config.snapshot_zero_price_symbols 에 심볼을 추가하세요',
        };
      }
      // 운영자가 "이 종목의 0원은 정상"이라고 기록해 둔 경우 — 통과시키되 매번 흔적을 남긴다.
      console.warn(`[portfolio-snapshot] ${p.currency} price=0 을 allowlist 근거로 인정 (qty=${qty})`);
    }
    if (value < 0) {
      return { code: 'position_malformed', detail: `${p.currency}: value_krw=${value} < 0` };
    }
    sum += value;
  }

  const tol = Math.max(TOTAL_TOLERANCE_KRW, Math.abs(totalKRW) * TOTAL_TOLERANCE_PCT);
  if (Math.abs(sum - totalKRW) > tol) {
    return {
      code: 'total_mismatch',
      detail: `Σvalue_krw=${Math.round(sum)} ≠ total=${Math.round(totalKRW)} (허용 ±${Math.round(tol)})`,
    };
  }
  return null;
}

/**
 * (T-056) **이 틱에 있어야 할 현금 행 검사** — DB 불필요 순수 함수.
 *
 * 왜 필요한가: 저장 가드의 소실 판정(`checkHoldingVanished`)은 현금을 판정 대상에서 뺀다(출금은 정상이므로). 그래서 해외 매도로
 * USD 행이 총액의 64% 가 된 뒤 그 행이 조용히 빠지면, 그 행은 "현금 출금"처럼 보여 그대로 저장되고 킬스위치가 -64% 를 본다
 * (설계 S4). 크론의 보류 경로가 1차 방어이고 이 검사는 회귀·실수로 행이 빠졌을 때의 **2차 방어**다.
 *
 * 릴리스 밸브(3시간 뒤 통과)를 **적용하지 않는다** — 밸브가 바로 S4 를 다시 연다. 무한 실명 위험은 크론이 요구 플래그를
 * 시장 활성 값으로만 정하기 때문에 생기지 않는다(비활성이면 요구하지 않음). 행이 계속 빠지는 결함은 실명 경보가 알린다.
 */
export function checkRequiredCashRows(
  positions: SnapshotPosition[],
  req: SnapshotCashRequirement | undefined | null,
): SnapshotReject | null {
  if (!req || typeof req !== 'object'
      || typeof req.usdCashRequired !== 'boolean' || typeof req.krwCashRequired !== 'boolean') {
    // 타입상 필수 인자다. 그래도 빠졌다면(타입 우회) "요구하지 않음"으로 읽지 않는다 — 모르면 저장하지 않는다.
    return { code: 'cash_row_missing', detail: '현금 행 요구 플래그(usdCashRequired·krwCashRequired)를 받지 못함 — 저장하지 않음' };
  }
  const check = (currency: 'USD' | 'KRW', priceOk: (p: number) => boolean): SnapshotReject | null => {
    const rows = (Array.isArray(positions) ? positions : []).filter(p => p && p.currency === currency);
    if (rows.length !== 1) {
      return {
        code: 'cash_row_missing',
        detail: `${currency} 현금 행이 ${rows.length}개 — 이 틱에는 정확히 1개 있어야 한다`
          + (rows.length === 0 ? ' (행 없음을 현금 0 으로 기록하지 않는다)' : ''),
      };
    }
    const qty = Number(rows[0].qty);
    const price = Number(rows[0].price);
    if (!Number.isFinite(qty) || qty < 0) {
      return { code: 'cash_row_missing', detail: `${currency} 현금 행 qty=${rows[0].qty} 가 유한한 0 이상 값이 아님` };
    }
    if (!Number.isFinite(price) || !priceOk(price)) {
      return { code: 'cash_row_missing', detail: `${currency} 현금 행 price=${rows[0].price} 가 유효하지 않음` };
    }
    return null;
  };
  if (req.krwCashRequired) {
    const r = check('KRW', p => p === 1);
    if (r) return r;
  }
  if (req.usdCashRequired) {
    const r = check('USD', p => p > 0);
    if (r) return r;
  }
  return null;
}

export interface PrevSnapshot {
  ts:       Date;
  totalKRW: number;
  positions: SnapshotPosition[];
}

/**
 * 직전 스냅샷 대비 **보유 종목 소실** 검사.
 *
 * 판정: 직전에 값이 있던 비현금 종목이 지금 없거나 0원 → 그 합(missing)이 직전 총액의 10%
 * 이상 → 그리고 총액 감소분이 missing 의 70% 이상이면 거부.
 *
 * 정상 이벤트를 거부하지 않는 이유:
 *  - **실제 폭락**: 종목은 그대로 있고 단가만 내린다 → 소실 목록이 비어 판정 자체를 안 한다.
 *  - **매도**: 종목은 사라지지만 대금이 현금으로 들어와 총액이 보존된다 → drop ≈ 0 이라 통과.
 *  - **출금**: 줄어드는 것은 현금이고, 현금은 소실 판정 대상이 아니다 → 통과.
 *  - **입금**: 총액이 늘어 drop 이 음수 → 통과.
 *  - **대체출고 등 진짜 소실**: 여기서는 거부되지만 `COMPOSITION_MAX_AGE_MS` 경과 후 통과한다.
 */
export function checkHoldingVanished(
  totalKRW: number,
  positions: SnapshotPosition[],
  prev: PrevSnapshot,
  nowMs: number,
  /**
   * 0원이 정상으로 승인된 심볼. 상장폐지 종목의 가치가 실제로 0이 된 것은 **진짜 변화**이므로
   * 소실 판정에서 제외한다 — 그러지 않으면 allowlist 에 넣어도 4단이 3시간 동안 계속 막는다.
   */
  allowZero: ReadonlySet<string> = new Set(),
): SnapshotReject | null {
  if (!(prev.totalKRW > 0)) return null;
  if (!Array.isArray(prev.positions) || prev.positions.length === 0) return null;
  const ageMs = nowMs - prev.ts.getTime();
  if (!Number.isFinite(ageMs) || ageMs > COMPOSITION_MAX_AGE_MS) return null;

  // 판정 본체는 snapshot-composition.ts 의 evaluateVanish (T-041 이전 본문과 동작 동일 — 비유한 총액은 거부).
  // 킬스위치는 이 정의를 쓰지 않는다(총액 감소를 소실의 증거로 쓰기 때문) — assessDrawdownComposition 참고.
  const v = evaluateVanish(prev.totalKRW, totalKRW, prev.positions, positions, { allowZero });
  if (!v.evaporated) return null;   // 소실 없음 / 소액 / 현금 등으로 이동 = 매도·정상

  return {
    code: 'holding_vanished',
    detail:
      `보유 종목 소실 [${v.vanished.join(', ')}] ${Math.round(v.missingKRW)}KRW `
      + `(직전 총액의 ${(v.share * 100).toFixed(1)}%) 이 현금으로 이동하지 않고 총액에서 증발 `
      + `(${Math.round(prev.totalKRW)} → ${Math.round(totalKRW)}, 직전 스냅샷 ${Math.round(ageMs / 60000)}분 전)`,
  };
}

async function getRecentMedianKRW(): Promise<number | null> {
  const pool = getPool();
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT total_krw FROM portfolio_snapshots
        WHERE ts >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
          AND total_krw > 0
        ORDER BY total_krw ASC`,
    );
    if (rows.length === 0) return null;
    const mid = Math.floor(rows.length / 2);
    return Number(rows[mid].total_krw);
  } catch {
    return null;
  }
}

async function getPrevSnapshot(): Promise<PrevSnapshot | null> {
  try {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT ts, total_krw, positions FROM portfolio_snapshots ORDER BY ts DESC LIMIT 1`,
    );
    const r = rows[0];
    if (!r) return null;
    const raw: unknown = r.positions;
    const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return null;
    return {
      ts:        new Date(r.ts),
      totalKRW:  Number(r.total_krw),
      positions: parsed as SnapshotPosition[],
    };
  } catch {
    return null;   // 직전 스냅샷을 못 읽으면 구성 비교는 생략 (기존 단계는 그대로 동작)
  }
}

/**
 * 거부 알림 — 사유(code)별 30분 스로틀.
 *
 * 대시보드는 열려 있는 동안 ~30초마다 스냅샷을 저장하므로 스로틀 없이는 분당 2건씩 알림이
 * 나간다. 반대로 **조용한 거부는 스냅샷 기아를 보이지 않게** 만들기 때문에 알림 자체를
 * 생략할 수는 없다 (거부가 이어지면 킬스위치가 낡은 값을 현재값으로 쓰게 된다).
 */
export interface SnapshotFreshness {
  /** 마지막으로 성공한 스냅샷 시각. 한 건도 없으면 null. */
  latestTs: Date | null;
  /** 그 이후 경과 시간(ms). 스냅샷이 없으면 null. **데이터 신뢰 판단은 이 값으로 한다.** */
  ageMs:    number | null;
  level:    'ok' | 'warn' | 'critical' | 'unknown';
  /**
   * 지금 데이터가 흘러야 하는 시간대인가.
   *  - `open`    : KRX 또는 US 정규장 중 하나 이상 개장
   *  - `closed`  : 둘 다 폐장 (주말·공휴일 포함)
   *  - `unknown` : 개장 여부 판정 실패 → **엄격한(장중) 임계**를 적용한다
   */
  session:  'open' | 'closed' | 'unknown';
  /**
   * 경보 판정에 실제로 쓰인 나이. 장중이면 `min(ageMs, 개장 후 경과)` 다 —
   * 폐장 중에 쌓인 나이를 개장 직후에 경보 사유로 쓰지 않기 위한 값이다.
   * ⚠️ 이 값은 **경보용**이다. "이 숫자를 믿어도 되는가" 판단에는 `ageMs` 를 써야 한다.
   */
  effectiveAgeMs: number | null;
}

/**
 * **관측 공백(실명) 측정** — 원인과 무관하게 "마지막으로 포트폴리오를 본 지 얼마나 됐는가".
 *
 * 내부 카운터가 아니라 테이블의 `MAX(ts)` 를 보는 이유: 실명은 sanity 거부뿐 아니라 잔고
 * 부분 실패(cron 이 저장 시도조차 못 함)·KIS 장애로도 생긴다. 저장 경로의 카운터는 그중
 * 하나만 안다. 테이블만이 모든 원인을 합친 진실을 갖고 있다.
 */
export async function checkSnapshotFreshness(nowMs: number = Date.now()): Promise<SnapshotFreshness> {
  try {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT MAX(ts) AS latest FROM portfolio_snapshots',
    );
    const raw = rows[0]?.latest;
    if (!raw) {
      return { latestTs: null, ageMs: null, level: 'unknown', session: 'unknown', effectiveAgeMs: null };
    }
    const latestTs = new Date(raw as string | Date);
    const ageMs = nowMs - latestTs.getTime();

    /**
     * 개장 후 경과 분. null 이면 폐장, 판정 실패면 `undefined` 로 구분한다.
     * 판정에 실패했을 때 "폐장"으로 보면 **경보를 조용하게 만드는 방향**이라 위험하다 —
     * 모르면 장중(엄격)으로 취급한다.
     */
    let sinceOpenMin: number | null | undefined;
    try {
      sinceOpenMin = await minutesSinceSessionOpen(new Date(nowMs));
    } catch {
      sinceOpenMin = undefined;
    }

    const session: SnapshotFreshness['session'] =
      sinceOpenMin === undefined ? 'unknown' : sinceOpenMin === null ? 'closed' : 'open';

    // 폐장 중에는 실제 나이를, 장중에는 "개장 후 실제로 비어 있던 시간"을 본다.
    const effectiveAgeMs = session === 'open'
      ? Math.min(ageMs, (sinceOpenMin as number) * 60_000)
      : ageMs;

    const warnMs     = session === 'closed' ? BLIND_WARN_CLOSED_MS     : BLIND_WARN_MS;
    const criticalMs = session === 'closed' ? BLIND_CRITICAL_CLOSED_MS : BLIND_CRITICAL_MS;

    const level: SnapshotFreshness['level'] =
      effectiveAgeMs >= criticalMs ? 'critical' : effectiveAgeMs >= warnMs ? 'warn' : 'ok';
    return { latestTs, ageMs, level, session, effectiveAgeMs };
  } catch {
    return { latestTs: null, ageMs: null, level: 'unknown', session: 'unknown', effectiveAgeMs: null };
  }
}

/** critical 실명을 이미 알린 시각 — 회복 알림 판단에도 쓴다. */
let blindCriticalAt: number | null = null;

/** 테스트/진단용 — 알림 스로틀·실명 상태 초기화 */
export function resetSnapshotRejectThrottle(): void {
  resetAlertThrottle();
  blindCriticalAt = null;
}

/**
 * 실명이 길어지면 경보를 **승격**한다. 어떤 이유로든 스냅샷이 안 써질 때 호출한다
 * (sanity 거부, 잔고 부분 실패로 인한 cron 건너뛰기 등).
 *
 * @param blocking 지금 저장을 막고 있는 사유 — 경보문에 넣어 조치 대상을 특정한다.
 */
export async function reportSnapshotBlindness(blocking: string, source: string): Promise<SnapshotFreshness> {
  const f = await checkSnapshotFreshness();
  if (f.ageMs == null) return f;
  const mins = Math.round(f.ageMs / 60_000);

  const realertMs = f.session === 'closed' ? BLIND_REALERT_CLOSED_MS : BLIND_REALERT_MS;

  if (f.level === 'critical') {
    const now = Date.now();
    if (blindCriticalAt == null || now - blindCriticalAt >= realertMs) {
      blindCriticalAt = now;
      sendAlert(
        'critical',
        `🚨 포트폴리오를 ${Math.floor(mins / 60)}시간 ${mins % 60}분째 관측하지 못했습니다`,
        `마지막 정상 스냅샷: ${f.latestTs?.toISOString() ?? '없음'}\n`
        + `시장 상태: ${f.session === 'closed' ? '전 시장 폐장 중' : f.session === 'open' ? '장중' : '개장 여부 판정 실패'}\n`
        + `현재 저장을 막는 사유: ${blocking} (source=${source})\n\n`
        + '이 값은 모든거래차단 24h drawdown 기준선입니다. 관측이 멈춘 동안에는 실제 급락을 '
        + '감지하지 못할 수 있습니다.\n'
        + '· 시세·잔고 조회 실패라면 KIS 레이트리밋(EGW00201)·토큰 상태를 확인하세요.\n'
        + '· 특정 종목이 거래정지·상장폐지로 **정말 0원**이라면 '
        + 'system_config.snapshot_zero_price_symbols 에 해당 심볼을 추가하면 즉시 해소됩니다.',
      );
    }
    return f;
  }

  if (f.level === 'warn') {
    sendAlertThrottled(
      'snapshot:blind:warn', 'warning',
      `포트폴리오 스냅샷 ${mins}분째 미갱신`,
      `마지막 정상 스냅샷 이후 ${mins}분 경과. 현재 사유: ${blocking} (source=${source})`,
    );
  }
  return f;
}

/** 성공 저장 후 호출 — critical 실명을 알렸다면 회복을 알린다. */
function reportSnapshotRecovered(): void {
  if (blindCriticalAt == null) return;
  const blindMins = Math.round((Date.now() - blindCriticalAt) / 60_000);
  blindCriticalAt = null;
  sendAlert(
    'info',
    '✅ 포트폴리오 스냅샷 정상화',
    `관측이 재개됐습니다 (critical 경보 이후 ${blindMins}분). 모든거래차단 기준선이 다시 갱신됩니다.`,
  );
}

function rejectSnapshot(r: SnapshotReject, source: string): void {
  console.error(
    `[portfolio-snapshot] sanity reject(${r.code}): ${r.detail} — INSERT skipped (source=${source})`,
  );
  sendAlertThrottled(
    `snapshot:reject:${r.code}`,
    'warning',
    '포트폴리오 스냅샷 저장 거부',
    `사유(${r.code}): ${r.detail}\n`
    + `source=${source}\n`
    + '스냅샷은 모든거래차단 24h 기준선·변동성 가드·주문한도의 입력값이라, 오염된 값을 넣는 대신 '
    + '이번 tick 을 건너뜁니다. 반복되면 KIS 시세·잔고 조회 상태를 확인하세요.',
  );
  // 거부가 길어지면 그 자체가 위험이다 — 실명 시간을 따로 재서 승격 경보한다.
  void reportSnapshotBlindness(`${r.code}: ${r.detail}`, source)
    .catch(() => { /* 경보 실패가 저장 경로를 깨지 않는다 */ });
}

/**
 * 현재 포트폴리오 스냅샷을 DB에 저장. 위 4단 sanity guard 를 모두 통과할 때만 INSERT 한다.
 *
 * @param cashReq (T-056) 이 틱에 있어야 할 현금 행 — **필수 인자**. 크론이 그 틱에 실제로 쓴 시장 활성 값을 넘긴다.
 *                "못 받으면 요구하지 않음"이 되지 않게 기본값을 두지 않는다.
 */
export async function savePortfolioSnapshot(
  totalKRW: number,
  positions: SnapshotPosition[],
  source: 'hourly' | 'trade' | 'manual' | 'dashboard',
  cashReq: SnapshotCashRequirement,
): Promise<void> {
  if (!Number.isFinite(totalKRW) || !(totalKRW > 0)) return;

  // 운영자가 "이 종목의 0원은 정상"이라고 기록해 둔 심볼 (거래정지·상장폐지 탈출구)
  const allowZero = await getZeroPriceAllowlist();

  // 1. 보유 항목 무결성 — 인과적 근본 검사 (실측 12행 전부 여기서 걸린다)
  const bad = validateSnapshotPositions(totalKRW, positions, allowZero);
  if (bad) { rejectSnapshot(bad, source); return; }

  // 1b. (T-056) 이 틱에 있어야 할 현금 행 — 릴리스 밸브 없음
  const cashBad = checkRequiredCashRows(positions, cashReq);
  if (cashBad) { rejectSnapshot(cashBad, source); return; }

  // 2. 절대 한도 — 1억원 초과 또는 1000원 미만은 결함 가능성 매우 높음
  if (totalKRW > SANITY_MAX_KRW || totalKRW < SANITY_MIN_KRW) {
    rejectSnapshot({
      code: 'abs_band',
      detail: `total=${Math.round(totalKRW)} KRW out of [${SANITY_MIN_KRW}, ${SANITY_MAX_KRW}]`,
    }, source);
    return;
  }

  // 3. 직전 24h median 대비 ±5배 — 단위 오류(1500배)급 outlier 차단. 폭은 의도적으로 넓다.
  const median = await getRecentMedianKRW();
  if (median != null && median > 0) {
    const ratio = totalKRW / median;
    if (ratio > SANITY_RATIO || ratio < 1 / SANITY_RATIO) {
      rejectSnapshot({
        code: 'median_band',
        detail: `total=${Math.round(totalKRW)} vs 24h median=${Math.round(median)} ratio=${ratio.toFixed(2)}x`,
      }, source);
      return;
    }
  }

  // 4. 직전 스냅샷 대비 구성 소실 — 비율 밴드가 못 잡는 "종목이 통째로 빠진" 유형
  const prev = await getPrevSnapshot();
  if (prev) {
    const vanish = checkHoldingVanished(totalKRW, positions, prev, Date.now(), allowZero);
    if (vanish) { rejectSnapshot(vanish, source); return; }
  }

  const pool = getPool();
  await pool.query(
    `INSERT INTO portfolio_snapshots (ts, total_krw, positions, source) VALUES (NOW(), ?, ?, ?)`,
    [Math.round(totalKRW), JSON.stringify(positions), source],
  );
  reportSnapshotRecovered();
}
