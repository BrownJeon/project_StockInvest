import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { sendAlert } from '@/lib/notify';

/** DB system_config override takes precedence over env var. */
export async function isKillSwitchActive(): Promise<boolean> {
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { value: string })[]>(
      'SELECT value FROM system_config WHERE `key` = ? LIMIT 1',
      ['safety_kill_switch'],
    );
    if (rows.length > 0) {
      const val = JSON.parse(rows[0].value);
      return val === true || val === 'true';
    }
  } catch {
    // DB unavailable — fall through to env
  }
  return String(process.env.KILL_SWITCH ?? 'false').toLowerCase() === 'true';
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
