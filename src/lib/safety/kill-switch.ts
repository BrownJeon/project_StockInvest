import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { sendAlert } from '@/lib/notify';
import { sendAlertThrottled } from '@/lib/notify/throttle';
import { checkSnapshotFreshness } from './volatility-guard';
import { decodeFlagValue, parseBoolFlag, shouldReportUnparsable } from './flags';
import { assessDrawdownComposition, parseSnapshotPositions, VANISH_MIN_SHARE, type CompositionPosition } from './snapshot-composition';
import {
  assessHiddenUsdCarry, describeHiddenSides, hasHiddenUsdRow,
  HIDDEN_USD_CARRY_HISTORY_LIMIT, HIDDEN_USD_CARRY_WINDOW_HOURS, type CarryPrior,
} from './hidden-usd-carry';

/**
 * (T-056) **전환 규칙 E — USD 행 대칭 제거.**
 *
 * 기준선·현재 중 **한쪽이라도 USD 행이 없으면, 양쪽 모두에서 USD 행과 그 값을 뺀 뒤** 총액·구성을 비교한다.
 * 둘 다 있으면(신형 대 신형) 아무것도 하지 않는다. 둘 다 없으면 뺄 것이 없다.
 *
 * ## 왜 필요한가
 *  - 배포 전 운영 스냅샷 4,667행은 전부 USD 행이 없다(USD 예수금 조회가 늘 실패했다). 배포 후 24h 동안 기준선(구형)에는 없고
 *    현재(신형)에는 있다 → 그대로 비교하면 현재가 USD 만큼 부풀어 **실제 손실을 덜 보인다**(설계 S6 은폐).
 *  - 원설계("현재 총액에서 현재 USD 전액을 뺀다")는 전환 중 정상 해외 매도의 대금까지 빼서 -64% **거짓 발동**을 냈다(Codex C1-1, S7).
 *    E 는 positions 의 USD 행도 함께 빼므로 매도 대금은 구성 판정에서 "소실 + 현금 이동 없음"으로 보여 T-041 보류 경로로 간다
 *    — **오늘 운영 코드와 정확히 같은 동작**이다(양쪽 모두 USD 없는 상태로 비교).
 *  - 반대 방향(기준선엔 있고 현재엔 없음: 해외 비활성화·부분 롤백)도 같은 규칙으로 거짓 발동 없이 처리한다(S8).
 *
 * 상태가 없다(오프셋·이력 질의 없음). E 가 보지 못하는 것은 전환 구간의 "USD 값 자체의 변동"(환율·출금)뿐이다(설계 R7, 수용).
 * positions 를 읽을 수 없는 쪽이 있으면 USD 유무를 알 수 없으므로 **적용하지 않는다**(기존 총액 비교 그대로 — 검증 불가는 발동 쪽).
 */
export interface UsdSymmetricRemoval {
  applied: boolean;
  baselineKRW: number;
  currentKRW: number;
  basePositions: CompositionPosition[] | null;
  curPositions: CompositionPosition[] | null;
  removedBaseUsdKRW: number;
  removedCurUsdKRW: number;
}

const isUsdRow = (p: unknown): boolean =>
  !!p && typeof p === 'object' && (p as { currency?: unknown }).currency === 'USD';

/**
 * (T-056 R-5) 전환 구간(E 적용) 보류 알림 맨 앞에 붙일 **USD 포함 기록상 총액 변화** 한 줄. 문구 전용 — 판정에 쓰지 않는다.
 *
 * 🔴 **절대 던지지 않는다.** 이 문구는 구성 판정(④) try 블록 안에서 조립되고, 그 블록의 예외는 "검증 불가 → 발동"으로
 * 처리된다. 문구 코드가 던지면 보류가 발동으로 뒤집히는 거짓 발동이 된다. 그래서 입력을 엄격히 읽고(숫자 또는 숫자 문자열만),
 * 비유한·기준 0 이하는 `n/a` 로 표시하며, 전체를 try/catch 로 감싼다. E 미적용이면 빈 문자열(문구 불변).
 */
export function transitionRawNote(applied: boolean, rawBaselineKRW: unknown, rawCurrentKRW: unknown): string {
  if (!applied) return '';
  try {
    const num = (v: unknown): number | null => {
      if (typeof v === 'number') return Number.isFinite(v) ? v : null;
      if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) {
        const n = Number(v.trim());
        return Number.isFinite(n) ? n : null;
      }
      return null;
    };
    const rawBase = num(rawBaselineKRW);
    const rawCurKRW = num(rawCurrentKRW);
    const ok = rawBase != null && rawBase > 0 && rawCurKRW != null;
    const rawPct = ok ? (((rawCurKRW as number) - (rawBase as number)) / (rawBase as number)) * 100 : NaN;
    const diff = ok ? (rawCurKRW as number) - (rawBase as number) : NaN;
    const pctText = Number.isFinite(rawPct) ? `${rawPct.toFixed(1)}%` : 'n/a';
    const amtText = Number.isFinite(diff) ? `${Math.round(diff).toLocaleString('ko-KR')}원` : 'n/a';
    return `기록상(USD 포함) 24h ${pctText} (${amtText}) — 전환 24h 한정 비교(아래 수치는 USD 를 양쪽에서 뺀 값).\n`;
  } catch {
    return '';
  }
}

/**
 * (T-155) 스냅샷 positions 원문에서 미결제 매도 대금(`ustl_sll_amt_smtl`) 합을 읽는다.
 *
 * 크론이 USD 행에만, 그리고 양수일 때만 기록하고(`src/app/api/cron/portfolio-snapshot/route.ts:166`),
 * **T-056 설계상 `total_krw` 에는 들어가지 않는다** — 해외 매도 뒤 결제(T+2) 전까지는 그만큼 총액이 작게
 * 잡혀 손실률이 부풀어 보인다. 2026-11-06 00:03 첫 실제 발동이 그 경우였다(대금 1,408,391원).
 *
 * **문구 전용이다.** 무엇이 들어와도 던지지 않고 0 을 돌려준다 — 이 값으로 발동을 보류하거나 손실률을
 * 다시 계산하지 않는다(그러면 미결제 대금의 결제 기준 미판정 문제가 판정에 들어온다. T-056·M-3 참조).
 * 알려진 한계: 파싱 불가와 "미결제 대금 없음"을 구별하지 않는다(둘 다 0 → 문구 없음).
 */
export function unsettledSellKRW(raw: unknown): number {
  try {
    const rows: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(rows)) return 0;
    let sum = 0;
    for (const r of rows) {
      if (!r || typeof r !== 'object') continue;
      const v = (r as { ustl_sll_amt_smtl?: unknown }).ustl_sll_amt_smtl;
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) sum += v;
    }
    return sum;
  } catch {
    return 0;
  }
}

export function applyUsdSymmetricRemoval(
  baselineKRW: number,
  currentKRW: number,
  basePositions: CompositionPosition[] | null,
  curPositions: CompositionPosition[] | null,
): UsdSymmetricRemoval {
  const same: UsdSymmetricRemoval = {
    applied: false, baselineKRW, currentKRW, basePositions, curPositions, removedBaseUsdKRW: 0, removedCurUsdKRW: 0,
  };
  if (!basePositions || !curPositions) return same;
  const baseHas = basePositions.some(isUsdRow);
  const curHas = curPositions.some(isUsdRow);
  if (baseHas === curHas) return same;     // 둘 다 있음(신형 대 신형) 또는 둘 다 없음 — 그대로
  const usdSum = (ps: CompositionPosition[]) =>
    ps.filter(isUsdRow).reduce((s, p) => s + (Number(p.value_krw) || 0), 0);
  const removedBaseUsdKRW = usdSum(basePositions);
  const removedCurUsdKRW = usdSum(curPositions);
  return {
    applied: true,
    baselineKRW: baselineKRW - removedBaseUsdKRW,
    currentKRW: currentKRW - removedCurUsdKRW,
    basePositions: basePositions.filter(p => !isUsdRow(p)),
    curPositions: curPositions.filter(p => !isUsdRow(p)),
    removedBaseUsdKRW,
    removedCurUsdKRW,
  };
}

/**
 * DB system_config override takes precedence over env var.
 *
 * **Phase 0 (2026-08-02)**: `val === true || val === 'true'` 만 인정하던 판정을 넓혔다.
 * `KILL_SWITCH=1` 이나 DB 에 저장된 `1` 이 "차단 해제"로 해석되던 fail-open 을 제거한다.
 *
 *  - 미설정(DB 키 부재 + env 미설정) → `false` (비활성 = 평상시 정상 운영 상태)
 *  - 정상 인식                        → 그 값
 *  - **해석 불가(오타 등)**           → `true`(활성) + console.error + critical 알림
 *
 * 해석 불가를 활성으로 보는 이유: 사용자가 값을 넣었다는 것은 **끄거나 켜려는 의도**가 있었다는
 * 뜻인데, 그 의도가 "긴급 정지"였을 때 파서가 무시해서 거래가 계속되는 것이 최악이다.
 * 반대로 잘못 멈추는 것은 기회 손실일 뿐이며, 알림으로 즉시 인지해 복구할 수 있다.
 * (isDryRun 과 동일한 원칙 — 안전장치는 애매하면 안전 방향)
 */
function reportUnparsableKillSwitch(source: string, raw: string): void {
  if (!shouldReportUnparsable(source, raw)) return;
  // T-129: console 문구는 운영 로그 grep 이 기대하므로 이전과 같은 글자 그대로, 경보 본문만 화면 용어(모든거래차단).
  // 로그 문장은 console 호출 안에 둔다 — 용어 울타리(t129-alert-terms-fence)가 로그로 인식하는 기준이다.
  const head = `${source} 값을 해석할 수 없음(${JSON.stringify(raw)}) — 안전을 위해`;
  console.error(`[safety] ${head} KILL_SWITCH 활성으로 처리합니다. 값을 true/false 로 바로잡으면 즉시 해제됩니다.`);
  sendAlert('critical', '모든거래차단 값 해석 불가 — 활성 처리', `${head} 모든거래차단 활성으로 처리합니다. 값을 true/false 로 바로잡으면 즉시 해제됩니다.`);
}

export async function isKillSwitchActive(): Promise<boolean> {
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { value: string })[]>(
      'SELECT value FROM system_config WHERE `key` = ? LIMIT 1',
      ['safety_kill_switch'],
    );
    if (rows.length > 0) {
      const r = parseBoolFlag(decodeFlagValue(rows[0].value));
      if (r.state === 'parsed') return r.value;
      if (r.state === 'unparsable') {
        reportUnparsableKillSwitch('system_config.safety_kill_switch', r.raw);
        return true;
      }
      // unset — env 폴백으로 진행
    }
  } catch {
    // DB unavailable — fall through to env
  }

  const e = parseBoolFlag(process.env.KILL_SWITCH);
  if (e.state === 'parsed') return e.value;
  if (e.state === 'unparsable') {
    reportUnparsableKillSwitch('환경변수 KILL_SWITCH', e.raw);
    return true;
  }
  return false;  // unset — 평상시 비활성
}

/**
 * 킬스위치가 "현재 자본"으로 **신뢰할 수 있는 최대 나이**.
 *
 * ⚠️ 일부러 `checkSnapshotFreshness()` 의 세션 인식 `level` 을 쓰지 않고 **원시 나이(`ageMs`)**
 * 를 이 고정 임계와 비교한다. 그 `level` 은 *경보 피로*를 줄이려고 폐장 중 임계를 6~12시간으로
 * 늘린 값이라, 그대로 신뢰 판단에 쓰면 "주말이니까 10시간 된 값도 ok" 가 되어버린다.
 * **무엇을 알릴지와 무엇을 믿을지는 다른 문제다.** 여기서는 항상 엄격한 쪽을 쓴다.
 *
 * 3시간인 이유: 기준선 조회창이 24h±60분(폭 2시간)이므로, 현재값이 3시간 이상 낡으면
 * "지금 대 24시간 전"이 아니라 "3시간 전 대 27시간 전"을 비교하는 셈이 된다.
 */
const MAX_CURRENT_SNAPSHOT_AGE_MS = 3 * 60 * 60 * 1000;

/** 기준선이 반드시 들어 있어야 하는 창 — 24시간 전 ±60분. */
const BASELINE_WINDOW_MIN_AGO = 1380;   // 23h
const BASELINE_WINDOW_MAX_AGO = 1500;   // 25h

export type DrawdownCheckResult =
  | {
      status: 'skipped';
      reason:
        | 'already_active'      // 이미 발동 중 — 재발동 불필요
        | 'snapshot_stale'      // 현재값을 믿을 수 없음
        | 'snapshot_missing'    // 스냅샷이 아예 없음
        | 'baseline_missing'    // 24h 전 창이 비어 있음
        | 'baseline_invalid'    // 기준 자본 0 이하
        | 'composition_change_suspected' // 임계 초과이나 보유 종목이 현금 이동 없이 사라진 탓 (T-041) — 발동 보류 + critical 알림
        | 'hidden_usd_carry_suspected'   // 임계 초과이나 qty 0 으로 가려진 USD 를 이월하면 손실이 임계의 절반보다 얕음 (T-080) — 발동 보류 + critical 알림
        | 'error';
      detail?: string;
    }
  | {
      status: 'evaluated'; drawdownPct: number; triggered: boolean;
      /** (T-056) 전환 규칙 E 가 적용됐다 — 한쪽에 USD 행이 없어 양쪽에서 USD 를 빼고 비교했다 */
      usdSymmetricRemoval?: true;
    };

/**
 * 24h drawdown 기반 Kill Switch 자동 발동.
 *
 * `portfolio_snapshots` 에서 **24h 전 ±60분** 스냅샷을 기준선으로 손실률을 계산하고,
 * `thresholdPct` 이상 손실이면 DB 에 kill switch 를 영속 저장 후 critical 알림을 보낸다.
 *
 * 호출 위치: `/api/cron/portfolio-snapshot` 이 스냅샷 저장 직후.
 * 이미 kill switch 가 활성인 경우 재발동하지 않는다 (알림 중복 방지).
 *
 * ## 🔴 고친 것 1 — 낡은 값으로 drawdown 을 계산하지 않는다 (T-012)
 *
 * 예전에는 `ORDER BY ts DESC LIMIT 1` 을 나이 검사 없이 현재값으로 썼다. 스냅샷 저장이
 * sanity guard 에 거부되면(이번 작업이 늘린 경로다) 그 낡은 행이 계속 "현재값"이 되어,
 * 실제로는 폭락 중인데 정지 직전의 값끼리 비교해 **0% 로 보이는** 상태가 된다.
 * 이제 나이를 검사해 낡았으면 **계산하지 않고 건너뛰되 시끄럽게 알린다.**
 *
 * ## 🔴 고친 것 2 — 최근 스냅샷이 "24시간 전"을 사칭하지 못하게 한다
 *
 * 예전 기준선 SQL 에는 24h 창과 **`OR` 로 묶인 "30~90분 전" 창**이 있었다:
 *
 * ```sql
 * WHERE ts BETWEEN NOW()-90MIN  AND NOW()-30MIN      -- ← 사칭 경로
 *    OR ts BETWEEN NOW()-1500MIN AND NOW()-1380MIN
 * ORDER BY ABS(TIMESTAMPDIFF(MINUTE, ts, NOW()-24H)) ASC LIMIT 1
 * ```
 *
 * 24h 창에 행이 있으면 그쪽이 이기지만, **비어 있으면 45분 전 값이 조용히 "24시간 전
 * 기준선"이 된다.** 그러면 24시간 -15% 폭락 중에도 drawdown 이 ~0% 로 계산돼
 * **킬스위치가 가장 필요한 순간에 침묵한다.** 반대 방향으로는, 최근 30~90분 사이의 급락이
 * "24h 손실"로 잘못 라벨링돼 오발동할 수도 있다. 양방향 모두 틀렸다.
 *
 * 운영 DB 실측(2026-08-09, 전체 이력 3,595행): hourly 단독 주기로 시뮬레이션하면 96.6% 의
 * 틱에서 24h 창에 행이 있고, 비는 3.4% 중 실제로 이 사칭이 일어나는 경우는 8건이었다.
 * 드물지만 **일어나면 정확히 최악의 순간에 침묵한다.** → OR 절을 제거하고, 창이 비면
 * 대체하지 않고 **건너뛰되 알린다.**
 *
 * 건너뛰기는 "조용히 꺼짐"이 아니다 — 두 건너뛰기 경로 모두 스로틀된 알림을 보낸다.
 */
export async function checkAndTriggerDrawdownKillSwitch(thresholdPct = 10): Promise<DrawdownCheckResult> {
  try {
    const pool = getPool();

    // 이미 kill switch 활성 상태면 재발동하지 않음
    const alreadyActive = await isKillSwitchActive();
    if (alreadyActive) return { status: 'skipped', reason: 'already_active' };

    // ── ① 현재값을 믿을 수 있는가 ──────────────────────────────────────────
    const fresh = await checkSnapshotFreshness();
    if (fresh.latestTs == null || fresh.ageMs == null) {
      console.warn('[kill-switch:drawdown] 포트폴리오 스냅샷 없음 — drawdown 검사 생략');
      return { status: 'skipped', reason: 'snapshot_missing' };
    }
    if (fresh.ageMs > MAX_CURRENT_SNAPSHOT_AGE_MS) {
      const mins = Math.round(fresh.ageMs / 60_000);
      const detail =
        `마지막 스냅샷이 ${mins}분 전(${fresh.latestTs.toISOString()}) — `
        + `${Math.round(MAX_CURRENT_SNAPSHOT_AGE_MS / 60_000)}분 임계 초과`;
      console.error(`[kill-switch:drawdown] 현재값이 낡아 drawdown 미계산: ${detail}`);
      // 폐장 중이면 값이 낡는 것이 정상 범위라 warning, 장중이면 실제 관측 중단이라 critical.
      sendAlertThrottled(
        'kill-switch:stale-current',
        fresh.session === 'closed' ? 'warning' : 'critical',
        '⚠️ 모든거래차단 24h drawdown 검사 생략 — 현재 자본을 믿을 수 없음',
        `${detail}\n`
        + '낡은 값으로 손실률을 계산하면 실제 폭락이 0% 로 보일 수 있어 계산 자체를 건너뜁니다.\n'
        + '**이 시간 동안 24h drawdown 자동 발동은 동작하지 않습니다.**\n'
        + '스냅샷이 왜 갱신되지 않는지(시세·잔고 조회 실패, sanity 거부) 확인하세요.',
        2 * 60 * 60 * 1000,
      );
      return { status: 'skipped', reason: 'snapshot_stale', detail };
    }

    // ── ② 기준선은 반드시 24h 전 ±60분 창에서만 온다 ────────────────────────
    const [snapRows] = await pool.query<(RowDataPacket & { total_krw: number; ts: Date; positions?: unknown })[]>(
      `SELECT total_krw, positions, ts FROM portfolio_snapshots
       WHERE ts BETWEEN DATE_SUB(NOW(), INTERVAL ? MINUTE) AND DATE_SUB(NOW(), INTERVAL ? MINUTE)
       ORDER BY ABS(TIMESTAMPDIFF(MINUTE, ts, DATE_SUB(NOW(), INTERVAL 24 HOUR))) ASC
       LIMIT 1`,
      [BASELINE_WINDOW_MAX_AGO, BASELINE_WINDOW_MIN_AGO],
    );

    if (snapRows.length === 0) {
      const detail = '24h 전 ±60분 창에 스냅샷이 없음';
      console.error(`[kill-switch:drawdown] ${detail} — drawdown 검사 생략 (근처 값으로 대체하지 않음)`);
      sendAlertThrottled(
        'kill-switch:no-baseline',
        'warning',
        '모든거래차단 24h drawdown 검사 생략 — 기준선 없음',
        `${detail}.\n`
        + '최근 스냅샷을 "24시간 전"으로 대신 쓰면 손실률이 ~0% 로 계산돼 모든거래차단이 조용히 '
        + '무력화되므로 대체하지 않습니다.\n'
        + '**이 회차의 24h drawdown 자동 발동은 동작하지 않습니다.**\n'
        + '반복되면 hourly 스냅샷 cron 이 정상 동작하는지 확인하세요.',
        3 * 60 * 60 * 1000,
      );
      return { status: 'skipped', reason: 'baseline_missing', detail };
    }

    const rawBaseline = Number(snapRows[0].total_krw);
    if (!Number.isFinite(rawBaseline) || rawBaseline <= 0) {
      console.warn('[kill-switch:drawdown] 기준 자본 0 이하 — drawdown 검사 생략');
      return { status: 'skipped', reason: 'baseline_invalid' };
    }

    // ── ③ 현재 자본 — ①에서 나이를 검증한 바로 그 최신 행 ──────────────────
    const [curRows] = await pool.query<(RowDataPacket & { total_krw: number; positions?: unknown; ts?: Date })[]>(
      'SELECT total_krw, positions, ts FROM portfolio_snapshots ORDER BY ts DESC LIMIT 1',
    );

    if (curRows.length === 0) {
      console.warn('[kill-switch:drawdown] 현재 포트폴리오 스냅샷 없음 — drawdown 검사 생략');
      return { status: 'skipped', reason: 'snapshot_missing' };
    }

    // ── ③-b (T-056) 전환 규칙 E — 한쪽에만 USD 행이 있으면 양쪽에서 USD 행·값을 뺀다 ──────────
    const usdNorm = applyUsdSymmetricRemoval(
      rawBaseline,
      Number(curRows[0].total_krw),
      parseSnapshotPositions(snapRows[0].positions),
      parseSnapshotPositions(curRows[0].positions),
    );
    const baseline = usdNorm.baselineKRW;
    const current = usdNorm.currentKRW;
    const won0 = (n: number) => Math.round(n).toLocaleString('ko-KR');
    const usdNote = usdNorm.applied
      ? ` · 기준선·현재 중 한쪽에 USD 행이 없어 양쪽에서 USD(기준 ${won0(usdNorm.removedBaseUsdKRW)}원·현재 `
        + `${won0(usdNorm.removedCurUsdKRW)}원)를 빼고 비교(전환 규칙 E)`
      : '';
    if (usdNorm.applied) {
      console.warn(`[kill-switch:drawdown] 전환 규칙 E 적용${usdNote}`);
      if (!Number.isFinite(baseline) || baseline <= 0) {
        console.warn('[kill-switch:drawdown] USD 제외 후 기준 자본 0 이하 — drawdown 검사 생략');
        return { status: 'skipped', reason: 'baseline_invalid', detail: `USD 제외 후 기준 자본 ${Math.round(baseline)}원${usdNote}` };
      }
    }
    const drawdownPct = ((current - baseline) / baseline) * 100;
    const usdFlag = usdNorm.applied ? { usdSymmetricRemoval: true as const } : {};

    if (drawdownPct > -thresholdPct) {
      return { status: 'evaluated', drawdownPct, triggered: false, ...usdFlag }; // 손실 미달 — 발동 불필요
    }

    // ── ③-c (T-080) 발동 후보 — qty 0 으로 가려진 USD 를 직전 20h 양수 값으로 이월하면 손실이 남는가 ──────
    //
    // 2026-10-23 자동 발동: 기준선·현재 모두 USD 행이 있고 qty 0(평일 야간 가려짐)이라 규칙 E 가 적용되지 않았고,
    // 그 사이의 KRW→USD 환전분이 총액에서 사라져 거짓 손실이 됐다. 또 현재만 가려진 시간대이면 USD 비중만큼 손실로 보인다.
    //
    //  - 규칙 E 가 적용됐으면(한쪽 USD 행 부재) 이 단계는 건너뛴다 — 그 경우는 E 가 다룬다.
    //  - 가려진 행이 없으면 조회조차 하지 않는다(기존 경로 그대로).
    //  - 보류는 보정 손실률이 임계의 **절반보다 엄격히 얕을 때만**(assessHiddenUsdCarry.suppress). 그 밖은 아래 기존 경로.
    //  - **검증 불가는 발동 쪽**: 조회 실패·시각 불명·파싱 실패·예외는 보류 근거가 되지 않는다(T-041 원칙).
    let carryNote = '';
    // `!usdNorm.applied` 는 규칙 E 가 이미 USD 행을 뺀 positions 에서 가려진 행이 나올 수 없으므로 의미상 중복(동치)이지만,
    // 이 단계가 E 의 영역을 건드리지 않는다는 의도를 코드에 남기려고 둔다. 가려짐 판별도 try 안에서 한다(L-1: 던지면 발동 쪽).
    if (!usdNorm.applied) {
      try {
        if (hasHiddenUsdRow(usdNorm.basePositions) || hasHiddenUsdRow(usdNorm.curPositions)) {
          const baseTs = snapRows[0].ts;
          const curTs = curRows[0].ts;
          if (!(baseTs instanceof Date) || !Number.isFinite(baseTs.getTime())
            || !(curTs instanceof Date) || !Number.isFinite(curTs.getTime())) {
            throw new Error('기준선·현재 스냅샷 시각을 읽을 수 없음');
          }
          const priors: CarryPrior[] = [];
          for (const t of [baseTs, curTs]) {
            const [rows] = await pool.query<(RowDataPacket & { ts: Date; total_krw: number; positions?: unknown })[]>(
              `SELECT ts, total_krw, positions FROM portfolio_snapshots
               WHERE ts < ? AND ts >= DATE_SUB(?, INTERVAL ? HOUR)
               ORDER BY ts DESC
               LIMIT ?`,
              [t, t, HIDDEN_USD_CARRY_WINDOW_HOURS, HIDDEN_USD_CARRY_HISTORY_LIMIT],
            );
            if (!Array.isArray(rows)) throw new Error('직전 스냅샷 조회 결과가 배열이 아님');
            for (const r of rows) priors.push({ ts: r.ts, positions: r.positions });
          }
          const carry = assessHiddenUsdCarry({
            baseline: { ts: baseTs, total: baseline, positions: usdNorm.basePositions },
            current: { ts: curTs, total: current, positions: usdNorm.curPositions },
            priors,
            thresholdPct,
          });
          const sidesText = describeHiddenSides(carry);
          if (carry.suppress && carry.adjustedDrawdownPct != null) {
            const detail =
              `24h ${drawdownPct.toFixed(1)}% 이지만 USD 예수금 행이 수량 0 으로 가려진 쪽[${sidesText}]에 `
              + `직전 ${HIDDEN_USD_CARRY_WINDOW_HOURS}시간 안의 마지막 양수 값을 이월하면 ${carry.adjustedDrawdownPct.toFixed(1)}% `
              + `(임계 -${thresholdPct}% 의 절반보다 얕음)`;
            console.error(`[kill-switch:drawdown] 자동 발동 보류 — ${detail}`);
            try {
              sendAlertThrottled(
                // 사건(가려진 쪽 + 마지막으로 보인 시각)마다 키를 달리한다
                `kill-switch:hidden-usd-carry:${carry.hiddenSides.map(n => `${n}=${(n === 'baseline' ? carry.baseline : carry.current).lastSeenMs ?? 'na'}`).join(',')}`,
                'critical',
                '⚠️ 모든거래차단 자동 발동 보류 — USD 예수금 가려짐 의심',
                `원시 24h 손실률 ${drawdownPct.toFixed(1)}% · 보정 손실률 ${carry.adjustedDrawdownPct.toFixed(1)}%\n`
                + `가려진 쪽: ${sidesText}\n`
                + 'USD 예수금 행이 수량 0 으로 기록돼(평일 야간 가려짐 의심) 손실이 부풀었을 수 있어 자동 발동을 보류했습니다.\n'
                + '단, 가려진 동안 USD 를 원화로 환전·출금했다면 보정값이 낡았을 수 있습니다(주식 매수 정황이 보이면 이미 보정하지 않습니다).\n'
                + '**실제 손실이라면 설정 > 안전장치에서 모든거래차단을 수동으로 켜세요.**',
                12 * 60 * 60 * 1000,
              );
            } catch (alertErr) {
              // 알림 실패는 판정을 바꾸지 않는다 — 로그로 남긴다
              console.error(`[kill-switch:drawdown] USD 가려짐 보류 알림 실패: ${alertErr instanceof Error ? alertErr.message : String(alertErr)}`);
            }
            return { status: 'skipped', reason: 'hidden_usd_carry_suspected', detail };
          }
          if (carry.hiddenSides.length > 0) {
            carryNote = carry.carried && carry.adjustedDrawdownPct != null
              ? ` · USD 가려짐[${sidesText}] 이월 보정 시 ${carry.adjustedDrawdownPct.toFixed(1)}%(보류 기준 미달 — 발동)`
              : ` · USD 가려짐[${sidesText}] — ${carry.reason}`;
          }
        }
      } catch (e) {
        console.error(`[kill-switch:drawdown] USD 가려짐 점검 실패 — 보정 없이 기존 경로: ${e instanceof Error ? e.message : String(e)}`);
        carryNote = ' · USD 가려짐 점검 실패(보정 없이 발동)';
      }
    }

    // ── ④ 임계 초과 — 그 손실이 "시장 손실"인가, 소실된 보유가 관측에서 사라진 것인가 (T-041) ──────────
    //
    // 2026-10-03 오발동: 보유 NAS:SNPS·NAS:SMH(총액의 72%)가 평가에서 사라지고 매도 대금은 총액에
    // 잡히지 않았다(해외 잔고 `locked` 는 항상 0). 저장 가드는 두 번 거부했지만 직전 스냅샷이 3시간을
    // 넘기자 릴리스 밸브가 검사를 끄고 그 행을 저장했고, 여기서 그 행이 "-72.3% 손실"로 읽혔다.
    //
    // 판정은 "종목이 사라졌는가"가 아니라 "**사라진 가치가 어딘가에 설명되는가**"다. 정상 매도는 종목을 사라지게
    // 하지만 대금이 현금 증가나 신규 보유로 잡힌다. 그렇게 설명되지 않는 몫(U)만이 관측 불능이고, 총 변화에서
    // U 만 걷어낸 같은 조건 손실률이 나머지의 실제 시장 움직임이다 (snapshot-composition.ts 머리 주석).
    //
    // ⚠️ 1차 설계(총액 감소 ≥ 소실액×70% 를 "증발"로 판정)는 Reviewer C-1 로 폐기됐다: 정상 매도 뒤 남은 보유의
    //    **실제 하락**도 총액을 줄이므로 진짜 손실이 "관측 불능"으로 오인돼 발동이 보류됐다(새 fail-open).
    //
    //  - **거래 정황(현금 유입·신규 보유·추가 매수)이 보이면 → 발동** (C-2: 스냅샷만으로는 관측 불능과 "낮은 가격에
    //    청산한 실현 손실·그 대금으로 산 보유의 하락"을 구별할 수 없다 — 보류는 순수 소실로 한정)
    //  - 보정 후에도 임계 초과 → **그대로 발동** (사유에 소실 사실을 덧붙임)
    //  - 순수 소실이고 보정 후 엄격히 임계 이내 → 발동 **보류** + critical 알림 (조용한 보류 금지)
    //  - **검증 불가는 발동 쪽**: 구성(positions)을 읽을 수 없는 행, 보정 기준 ≤ 0, 이 단계의 예외
    //
    // 0원으로 *기록된* 보유(상장폐지·거래정지)는 관측된 실제 손실이라 소실이 아니다. 반면 상장폐지·정리로 종목
    // **행 자체**가 계좌에서 제거된 실손실은 미설명 소실과 구별되지 않는다 — 알려진 한계이며 그래서 보류는
    // 반드시 critical 알림으로 사람에게 알린다.
    let compositionNote = '';
    try {
      // (T-056) E 가 적용됐으면 USD 행을 뺀 구성으로 판정한다 — 총액과 구성이 같은 집합이어야 한다.
      const basePositions = usdNorm.basePositions;
      const curPositions  = usdNorm.curPositions;
      if (basePositions && curPositions) {
        const a = assessDrawdownComposition(baseline, current, basePositions, curPositions);
        if (a.suspected) {
          const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
          const codes = a.vanished.join(', ');
          if (a.suppressible && a.adjustedDrawdownPct != null && a.adjustedDrawdownPct > -thresholdPct) {
            const detail =
              `24h ${drawdownPct.toFixed(1)}% (${won(current - baseline)}원) 이지만 기준선에 있던 [${codes}] `
              + `${won(a.vanishedKRW)}원이 현재 스냅샷에서 사라졌고, 그중 ${won(a.unexplainedKRW)}원`
              + `(기준 총액의 ${(a.unexplainedShare * 100).toFixed(1)}%)은 현금 증가·신규 보유로 설명되지 않는다. `
              + `현금 유입·신규 보유·추가 매수 등 거래 정황은 미미하다(허용치 이내 ${won(a.tradingEvidenceKRW)}원). `
              + `설명되지 않는 소실을 제외한 같은 조건 비교는 ${a.adjustedDrawdownPct.toFixed(1)}%${usdNote}`;
            console.error(`[kill-switch:drawdown] 자동 발동 보류 — ${detail}`);
            // (T-056 R-5) 전환 구간이면 USD 포함 기록상 변화를 맨 앞에 — 문구 전용, 던지지 않는다(transitionRawNote 주석)
            const rawNote = transitionRawNote(usdNorm.applied, rawBaseline, curRows[0].total_krw);
            sendAlertThrottled(
              // 사건(소실 종목 조합)마다 키를 달리해 다른 사건의 알림이 스로틀에 먹히지 않게 한다
              `kill-switch:composition-suspected:${[...a.vanished].sort().join(',')}`,
              'critical',
              '⚠️ 모든거래차단 자동 발동 보류 — 보유 종목 소실 의심',
              `${rawNote}${detail}.\n`
              + '매도 대금 정산 대기·잔고 조회 누락 등 **관측 불능일 수 있어** 자동 발동을 보류했습니다 (시장 손실이면 종목은 남고 단가만 내립니다).\n'
              + '단, 상장폐지·정리매매로 종목이 계좌에서 제거된 **실손실**도 이렇게 보일 수 있습니다.\n'
              + '**실제 손실이라면 설정 > 안전장치에서 모든거래차단을 수동으로 켜세요.**\n'
              + '스냅샷 저장 가드의 `holding_vanished` 경보가 함께 왔는지, KIS 체결내역에 매도가 있는지 확인하세요.',
              6 * 60 * 60 * 1000,
            );
            return { status: 'skipped', reason: 'composition_change_suspected', detail };
          }
          // 보류하지 않는 경우 — 사유를 남기고 발동한다:
          //  · 거래 정황(현금 유입·신규 보유·추가 매수)이 있다 → 소실을 관측 불능으로 읽을 근거가 없다 (C-2)
          //  · 미설명 소실을 걷어내고도 임계 초과(또는 보정 불가) → 남은 보유가 실제로 빠졌다
          compositionNote = !a.pureDisappearance
            ? ` · 보유 소실 [${codes}] 이 있으나 거래 정황(현금 유입·신규 보유·추가 매수 ${won(a.tradingEvidenceKRW)}원`
              + (a.unpricedTradingCodes.length > 0 ? `, 가치 미기록 보유 [${a.unpricedTradingCodes.join(', ')}]` : '')
              + ')이 있어 관측 불능으로 보지 않음'
            : ` · 보유 소실 [${codes}] 중 설명되지 않는 ${won(a.unexplainedKRW)}원 포함, 이를 제외하면 `
              + (a.adjustedDrawdownPct != null ? `${a.adjustedDrawdownPct.toFixed(1)}%` : '계산 불가');
        } else if (a.vanished.length > 0) {
          // (T-155) 미설명 몫이 VANISH_MIN_SHARE 미달이라 *보류 판정*에는 끼지 않는다 — 그 판정은 그대로 둔다.
          // 그런데 그때 문구가 아무 말도 하지 않아, 사람이 원시 손실률만 보고 실제 손실인지 판단해야 했다
          // (2026-11-06 00:03 첫 실제 발동: AAPL 매도 대금이 미결제라 cashDelta=0 → 미설명 6.8% < 10%,
          //  원시 -17.7% 뒤에 설명이 한 줄도 없었다). 이미 계산돼 있는 값만 덧붙인다.
          const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
          compositionNote = a.unexplainedKRW > 0
            // 미설명 몫이 남는다 — 보정값을 적고, 사람이 실손실인지 가릴 방법(체결내역)을 덧붙인다 (Reviewer M-2)
            ? ` · 보유 소실 [${a.vanished.join(', ')}] ${won(a.vanishedKRW)}원 중 현금 증가·신규 보유로 `
              + `설명되지 않는 ${won(a.unexplainedKRW)}원(기준 총액의 ${(a.unexplainedShare * 100).toFixed(1)}% — `
              + `보류 임계 ${(VANISH_MIN_SHARE * 100).toFixed(0)}% 미달이라 판정에 반영하지 않음), `
              + '이를 제외한 같은 조건 비교는 '
              + (a.adjustedDrawdownPct != null ? `${a.adjustedDrawdownPct.toFixed(1)}%` : '계산 불가')
              + ' · KIS 체결내역에 그 매도가 있는지 확인하세요'
            // 대금이 전액 현금·신규 보유로 설명되는 평범한 매도 — "설명되지 않는 0원" 은 잡음이다 (Reviewer L-3)
            : ` · 보유 소실 [${a.vanished.join(', ')}] ${won(a.vanishedKRW)}원은 현금 증가·신규 보유로 전액 설명된다`
              + '(손실률 판정에 영향 없음)';
        }
      }
    } catch (e) {
      // 이 단계는 *보류*를 결정하는 유일한 경로다. 검증을 못 했으면 보류할 근거가 없다 → 총액 기준으로 발동한다.
      console.error(`[kill-switch:drawdown] 구성 검증 실패 — 보정 없이 총액 기준으로 발동: ${e instanceof Error ? e.message : String(e)}`);
      compositionNote = ' · 구성 검증 실패(보정 없이 발동)';
    }

    // (T-155) 미결제 매도 대금은 T-056 설계상 총액에 없다. 판정은 바꾸지 않고 사실만 남긴다
    // (`unsettledSellKRW` 는 던지지 않는다). **치우치는 방향은 양쪽 차이가 정한다** (Reviewer M-1):
    // 보고 손실률은 (현재-기준)/기준 이고 양쪽 총액이 각자 미결제분만큼 작게 잡혀 있으므로,
    //  · 현재 쪽이 크면  → 분자가 더 음수가 되어 손실이 부풀어 보인다
    //  · 기준 쪽이 크면  → 분자가 덜 음수가 되어 손실이 작게 보인다(결제가 진행된 경우. 현재 쪽이 0 이
    //                        아니면 부분 결제이므로 문구에서 "결제 완료"를 단정하지 않는다 — QA L-QA1)
    //  · 같으면         → 금액은 그대로이고 분모만 작아 손실률만 크게 보인다
    // 한 문장으로 "그만큼 손실로 보인다"고 쓰면 뒤 두 경우에 거꾸로 말하게 된다.
    // INSERT 보다 앞에서 계산한다 — 지금은 던질 수 없지만 순서로 보장해 둔다 (Reviewer L-4).
    //
    // 🔴 이 블록 전체가 try 안이다 (Reviewer L-4′). 인자 `snapRows[0].positions` 의 **평가는 함수 밖**에서
    // 일어나므로 `unsettledSellKRW` 의 내부 try 로는 못 막는다 — 행 속성이 던지면 예외가 상위 catch 로
    // 올라가 `status:'skipped'` 가 되고 **킬스위치가 켜지지 않는다(fail-open)**. 문구 때문에 발동을
    // 잃을 수는 없으므로 여기서 삼키고 문구만 버린다.
    let unsettledNote = '';
    try {
      const baseUnsettled = unsettledSellKRW(snapRows[0].positions);
      const curUnsettled = unsettledSellKRW(curRows[0].positions);
      // (Reviewer L-8) 전환 규칙 E 가 적용됐으면 양쪽에서 USD 행을 이미 뺐다 — 미결제 대금은 그 행에만
      // 붙으므로 치우침의 전제가 사라진다. 그때 "작게/크게 보인다"고 적으면 틀린 말이 된다 → 문구 없음.
      if (!usdNorm.applied && (baseUnsettled > 0 || curUnsettled > 0)) {
        unsettledNote = ` · 미결제 매도 대금(기준 ${won0(baseUnsettled)}원·현재 ${won0(curUnsettled)}원)은 총액에 넣지 않는다(T-056) — `
          + (curUnsettled > baseUnsettled
            ? `현재 쪽이 ${won0(curUnsettled - baseUnsettled)}원 많아 그만큼 손실이 부풀어 보인다`
            // (QA L-QA1) 「(결제 완료)」를 붙이지 않는다 — 이 분기는 기준 쪽이 크다는 것만 말하고,
            // 현재 쪽이 0 이 아니면 부분 결제다. 금액 방향은 맞지만 결제 완료는 확인한 사실이 아니다.
            : baseUnsettled > curUnsettled
              ? `기준 쪽이 ${won0(baseUnsettled - curUnsettled)}원 많아 그만큼 손실이 작게 보인다`
              // (Reviewer L-7) 정도를 단정하지 않는다 — u/B 가 크면 "조금" 은 틀린 완화가 된다
              : '양쪽이 같아 손실 금액은 그대로이고 기준이 작게 잡혀 손실률만 크게 보인다');
      }
    } catch {
      // (Reviewer L-10) 예외를 문자열화하지 않는다 — 프로토타입 없는 값이 던져지면 `String(e)` 가 다시
      // 던져 이 catch 가 상위로 새고, 그러면 문구 때문에 발동을 잃는다(이 블록의 존재 이유와 정반대).
      // 진단 가치보다 발동 보존이 우선이라 고정 문구만 남긴다.
      console.error('[kill-switch:drawdown] 미결제 매도 대금 문구 생략(발동·판정은 그대로)');
      unsettledNote = '';
    }

    // Kill Switch 영속 저장 (DB SSOT)
    await pool.query(
      'INSERT INTO system_config (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      ['safety_kill_switch', JSON.stringify(true)],
    );

    const lostKRW = current - baseline;
    const msg = `24h 손실 ${drawdownPct.toFixed(1)}% (${lostKRW.toLocaleString('ko-KR')}원) — 임계 -${thresholdPct}% 초과${compositionNote}${carryNote}${unsettledNote}${usdNote}`;
    console.error(`[kill-switch:drawdown] 자동 발동: ${msg}`);
    sendAlert('critical', '모든거래차단 자동 발동', msg);
    return { status: 'evaluated', drawdownPct, triggered: true, ...usdFlag };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error(`[kill-switch:drawdown] 오류: ${detail}`);
    return { status: 'skipped', reason: 'error', detail };
  }
}
