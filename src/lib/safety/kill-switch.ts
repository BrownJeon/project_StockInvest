import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { sendAlert } from '@/lib/notify';
import { sendAlertThrottled } from '@/lib/notify/throttle';
import { checkSnapshotFreshness } from './volatility-guard';
import { parseBoolFlag, shouldReportUnparsable } from './flags';
import { assessDrawdownComposition, parseSnapshotPositions } from './snapshot-composition';

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
  const msg = `${source} 값을 해석할 수 없음(${JSON.stringify(raw)}) — 안전을 위해 KILL_SWITCH 활성으로 처리합니다. 값을 true/false 로 바로잡으면 즉시 해제됩니다.`;
  console.error(`[safety] ${msg}`);
  sendAlert('critical', 'KILL_SWITCH 값 해석 불가 — 활성 처리', msg);
}

export async function isKillSwitchActive(): Promise<boolean> {
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { value: string })[]>(
      'SELECT value FROM system_config WHERE `key` = ? LIMIT 1',
      ['safety_kill_switch'],
    );
    if (rows.length > 0) {
      const r = parseBoolFlag(JSON.parse(rows[0].value));
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
        | 'error';
      detail?: string;
    }
  | { status: 'evaluated'; drawdownPct: number; triggered: boolean };

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
        '⚠️ Kill Switch 24h drawdown 검사 생략 — 현재 자본을 믿을 수 없음',
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
        'Kill Switch 24h drawdown 검사 생략 — 기준선 없음',
        `${detail}.\n`
        + '최근 스냅샷을 "24시간 전"으로 대신 쓰면 손실률이 ~0% 로 계산돼 킬스위치가 조용히 '
        + '무력화되므로 대체하지 않습니다.\n'
        + '**이 회차의 24h drawdown 자동 발동은 동작하지 않습니다.**\n'
        + '반복되면 hourly 스냅샷 cron 이 정상 동작하는지 확인하세요.',
        3 * 60 * 60 * 1000,
      );
      return { status: 'skipped', reason: 'baseline_missing', detail };
    }

    const baseline = Number(snapRows[0].total_krw);
    if (!Number.isFinite(baseline) || baseline <= 0) {
      console.warn('[kill-switch:drawdown] 기준 자본 0 이하 — drawdown 검사 생략');
      return { status: 'skipped', reason: 'baseline_invalid' };
    }

    // ── ③ 현재 자본 — ①에서 나이를 검증한 바로 그 최신 행 ──────────────────
    const [curRows] = await pool.query<(RowDataPacket & { total_krw: number; positions?: unknown })[]>(
      'SELECT total_krw, positions FROM portfolio_snapshots ORDER BY ts DESC LIMIT 1',
    );

    if (curRows.length === 0) {
      console.warn('[kill-switch:drawdown] 현재 포트폴리오 스냅샷 없음 — drawdown 검사 생략');
      return { status: 'skipped', reason: 'snapshot_missing' };
    }

    const current = Number(curRows[0].total_krw);
    const drawdownPct = ((current - baseline) / baseline) * 100;

    if (drawdownPct > -thresholdPct) {
      return { status: 'evaluated', drawdownPct, triggered: false }; // 손실 미달 — 발동 불필요
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
      const basePositions = parseSnapshotPositions(snapRows[0].positions);
      const curPositions  = parseSnapshotPositions(curRows[0].positions);
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
              + `현금 유입·신규 보유·추가 매수 등 거래 정황은 없다(${won(a.tradingEvidenceKRW)}원). `
              + `설명되지 않는 소실을 제외한 같은 조건 비교는 ${a.adjustedDrawdownPct.toFixed(1)}%`;
            console.error(`[kill-switch:drawdown] 자동 발동 보류 — ${detail}`);
            sendAlertThrottled(
              // 사건(소실 종목 조합)마다 키를 달리해 다른 사건의 알림이 스로틀에 먹히지 않게 한다
              `kill-switch:composition-suspected:${[...a.vanished].sort().join(',')}`,
              'critical',
              '⚠️ Kill Switch 자동 발동 보류 — 보유 종목 소실 의심',
              `${detail}.\n`
              + '매도 대금 정산 대기·잔고 조회 누락 등 **관측 불능일 수 있어** 자동 발동을 보류했습니다 (시장 손실이면 종목은 남고 단가만 내립니다).\n'
              + '단, 상장폐지·정리매매로 종목이 계좌에서 제거된 **실손실**도 이렇게 보일 수 있습니다.\n'
              + '**실제 손실이라면 설정 > 안전장치에서 킬스위치를 수동으로 켜세요.**\n'
              + '스냅샷 저장 가드의 `holding_vanished` 경보가 함께 왔는지, KIS 체결내역에 매도가 있는지 확인하세요.',
              6 * 60 * 60 * 1000,
            );
            return { status: 'skipped', reason: 'composition_change_suspected', detail };
          }
          // 보류하지 않는 경우 — 사유를 남기고 발동한다:
          //  · 거래 정황(현금 유입·신규 보유·추가 매수)이 있다 → 소실을 관측 불능으로 읽을 근거가 없다 (C-2)
          //  · 미설명 소실을 걷어내고도 임계 초과(또는 보정 불가) → 남은 보유가 실제로 빠졌다
          compositionNote = !a.pureDisappearance
            ? ` · 보유 소실 [${codes}] 이 있으나 거래 정황(현금 유입·신규 보유·추가 매수 ${won(a.tradingEvidenceKRW)}원)이 `
              + '있어 관측 불능으로 보지 않음'
            : ` · 보유 소실 [${codes}] 중 설명되지 않는 ${won(a.unexplainedKRW)}원 포함, 이를 제외하면 `
              + (a.adjustedDrawdownPct != null ? `${a.adjustedDrawdownPct.toFixed(1)}%` : '계산 불가');
        }
      }
    } catch (e) {
      // 이 단계는 *보류*를 결정하는 유일한 경로다. 검증을 못 했으면 보류할 근거가 없다 → 총액 기준으로 발동한다.
      console.error(`[kill-switch:drawdown] 구성 검증 실패 — 보정 없이 총액 기준으로 발동: ${e instanceof Error ? e.message : String(e)}`);
      compositionNote = ' · 구성 검증 실패(보정 없이 발동)';
    }

    // Kill Switch 영속 저장 (DB SSOT)
    await pool.query(
      'INSERT INTO system_config (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      ['safety_kill_switch', JSON.stringify(true)],
    );

    const lostKRW = current - baseline;
    const msg = `24h 손실 ${drawdownPct.toFixed(1)}% (${lostKRW.toLocaleString('ko-KR')}원) — 임계 -${thresholdPct}% 초과${compositionNote}`;
    console.error(`[kill-switch:drawdown] 자동 발동: ${msg}`);
    sendAlert('critical', 'Kill Switch 자동 발동', msg);
    return { status: 'evaluated', drawdownPct, triggered: true };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error(`[kill-switch:drawdown] 오류: ${detail}`);
    return { status: 'skipped', reason: 'error', detail };
  }
}
