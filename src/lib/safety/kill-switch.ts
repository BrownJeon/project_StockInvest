import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { sendAlert } from '@/lib/notify';
import { parseBoolFlag, shouldReportUnparsable } from './flags';

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
 * 24h drawdown 기반 Kill Switch 자동 발동.
 * portfolio_snapshots에서 24h 전(±30분 허용) 스냅샷 자본을 기준으로 손실률을 계산하고,
 * thresholdPct 이상 손실이면 DB에 kill switch를 영속 저장 후 텔레그램 critical 알림 발송.
 *
 * 호출 위치: strategy-eval cron 전략 평가 실행 전.
 * 이미 kill switch가 활성화된 경우 재발동하지 않는다 (불필요한 알림 중복 방지).
 */
export async function checkAndTriggerDrawdownKillSwitch(thresholdPct = 10): Promise<void> {
  try {
    const pool = getPool();

    // 이미 kill switch 활성 상태면 재발동하지 않음
    const alreadyActive = await isKillSwitchActive();
    if (alreadyActive) return;

    // 24h 전(±30분) 스냅샷에서 가장 가까운 레코드 1건 조회
    const [snapRows] = await pool.query<(RowDataPacket & { total_krw: number })[]>(
      `SELECT total_krw FROM portfolio_snapshots
       WHERE ts BETWEEN DATE_SUB(NOW(), INTERVAL 90 MINUTE) AND DATE_SUB(NOW(), INTERVAL 30 MINUTE)
          OR ts BETWEEN DATE_SUB(NOW(), INTERVAL 1500 MINUTE) AND DATE_SUB(NOW(), INTERVAL 1380 MINUTE)
       ORDER BY ABS(TIMESTAMPDIFF(MINUTE, ts, DATE_SUB(NOW(), INTERVAL 24 HOUR))) ASC
       LIMIT 1`,
    );

    if (snapRows.length === 0) {
      console.warn('[kill-switch:drawdown] 24h 전 포트폴리오 스냅샷 없음 — drawdown 검사 생략');
      return;
    }

    const baseline = Number(snapRows[0].total_krw);
    if (baseline <= 0) {
      console.warn('[kill-switch:drawdown] 기준 자본 0 이하 — drawdown 검사 생략');
      return;
    }

    // 현재 자본: 가장 최근 스냅샷 사용
    const [curRows] = await pool.query<(RowDataPacket & { total_krw: number })[]>(
      'SELECT total_krw FROM portfolio_snapshots ORDER BY ts DESC LIMIT 1',
    );

    if (curRows.length === 0) {
      console.warn('[kill-switch:drawdown] 현재 포트폴리오 스냅샷 없음 — drawdown 검사 생략');
      return;
    }

    const current = Number(curRows[0].total_krw);
    const drawdownPct = ((current - baseline) / baseline) * 100;

    if (drawdownPct > -thresholdPct) return; // 손실 미달 — 발동 불필요

    // Kill Switch 영속 저장 (DB SSOT)
    await pool.query(
      'INSERT INTO system_config (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      ['safety_kill_switch', JSON.stringify(true)],
    );

    const lostKRW = current - baseline;
    const msg = `24h 손실 ${drawdownPct.toFixed(1)}% (${lostKRW.toLocaleString('ko-KR')}원) — 임계 -${thresholdPct}% 초과`;
    console.error(`[kill-switch:drawdown] 자동 발동: ${msg}`);
    sendAlert('critical', 'Kill Switch 자동 발동', msg);
  } catch (e) {
    console.error(`[kill-switch:drawdown] 오류: ${e instanceof Error ? e.message : String(e)}`);
  }
}
