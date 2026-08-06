export type { AlertLevel } from './slack';
export type { NotifyResult } from './result';
import type { AlertLevel } from './slack';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import { sendSlackAlert }    from './slack';
import { sendTelegramAlert } from './telegram';
import { notifyFailed, redactSecrets, type NotifyResult } from './result';

type NotifyChannel = 'none' | 'telegram' | 'slack' | 'both';
type ChannelName = 'telegram' | 'slack';

let channelCache: { value: NotifyChannel; ts: number } | null = null;
const TTL_MS = 30_000;

async function getChannel(): Promise<NotifyChannel> {
  if (channelCache && Date.now() - channelCache.ts < TTL_MS) return channelCache.value;
  let value: NotifyChannel = 'both';   // 미설정 시 기본 — 둘 다 시도 (기존 동작 유지)
  try {
    const pool = getPool();
    const [rows] = await pool.query<(RowDataPacket & { value: string })[]>(
      "SELECT value FROM system_config WHERE `key` = 'notify_channel' LIMIT 1",
    );
    if (rows.length > 0) {
      try {
        const parsed = JSON.parse(rows[0].value);
        if (parsed === 'none' || parsed === 'telegram' || parsed === 'slack' || parsed === 'both') {
          value = parsed;
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  channelCache = { value, ts: Date.now() };
  return value;
}

export interface AlertDispatch {
  /** 설정된 채널 정책 */
  channel: NotifyChannel;
  /** 실제 전달된 채널 */
  delivered: ChannelName[];
  /** 전송 시도했으나 실패한 채널 (재시도 가치 있음) */
  failed: { channel: ChannelName; error: string }[];
  /** 자격증명 미설정으로 시도조차 하지 않은 채널 */
  unconfigured: ChannelName[];
}

/**
 * 전송 함수가 (계약을 어기고) 던지더라도 dispatch 전체가 죽지 않도록 감싼다.
 * 여기서 만든 문자열은 로그로 나가므로 전송 함수 내부와 동일하게 **반드시 redact** 한다.
 */
async function attempt(
  channel: ChannelName,
  fn: () => Promise<NotifyResult>,
): Promise<{ channel: ChannelName; result: NotifyResult }> {
  try {
    return { channel, result: await fn() };
  } catch (e) {
    return { channel, result: notifyFailed(redactSecrets(e instanceof Error ? e.message : String(e))) };
  }
}

/**
 * 알림 실패 로깅.
 *
 * 이 경로는 kill-switch·DRY_RUN·drawdown 등 **안전 관련 알림**을 운반한다.
 * 조용히 버려진 critical 알림은 유실된 리포트보다 위험하므로, 아무 채널에도
 * 전달되지 못한 critical 은 grep 가능한 고정 토큰으로 남긴다.
 *
 *   pm2 logs stockinvest --err | grep CRITICAL_ALERT_UNDELIVERED
 */
function logDispatch(level: AlertLevel, title: string, d: AlertDispatch): void {
  for (const f of d.failed) {
    console.error(
      `[notify] ${f.channel} 전송 실패 — level=${level} title="${title}" reason=${f.error}`,
    );
  }
  if (level === 'critical' && d.delivered.length === 0) {
    const why = d.channel === 'none'
      ? 'notify_channel=none'
      : `failed=[${d.failed.map(f => f.channel).join(',') || '-'}] unconfigured=[${d.unconfigured.join(',') || '-'}]`;
    console.error(
      `[notify] 🚨 CRITICAL_ALERT_UNDELIVERED — title="${title}" channel=${d.channel} ${why} ` +
      '— 이 치명 알림은 어느 채널에도 전달되지 않았다',
    );
  }
}

/**
 * 알림 전송 + 결과 반환. 실패해도 예외를 던지지 않는다.
 * 안전 경로는 `sendAlert`(fire-and-forget)를 쓰고, 결과가 필요한 호출부만 이걸 await 한다.
 */
export async function dispatchAlert(
  level: AlertLevel,
  title: string,
  body: string,
): Promise<AlertDispatch> {
  const ch = await getChannel();

  const tasks: Promise<{ channel: ChannelName; result: NotifyResult }>[] = [];
  if (ch === 'slack'    || ch === 'both') tasks.push(attempt('slack',    () => sendSlackAlert(level, title, body)));
  if (ch === 'telegram' || ch === 'both') tasks.push(attempt('telegram', () => sendTelegramAlert(level, title, body)));
  const results = await Promise.all(tasks);   // 기존과 동일하게 두 채널 동시 전송

  const dispatch: AlertDispatch = {
    channel: ch,
    delivered:    results.filter(r => r.result.ok).map(r => r.channel),
    failed:       results.filter(r => !r.result.ok && !r.result.skipped)
                         .map(r => ({ channel: r.channel, error: r.result.error ?? 'unknown' })),
    unconfigured: results.filter(r => r.result.skipped).map(r => r.channel),
  };
  logDispatch(level, title, dispatch);
  return dispatch;
}

/**
 * fire-and-forget 알림 — 호출부를 절대 블록하지 않는다.
 * (kill-switch·주문 차단 등 안전 경로가 알림 I/O 를 기다리면 안 되기 때문)
 * 실패는 삼키지 않고 `logDispatch` 가 로그로 남긴다.
 */
export function sendAlert(level: AlertLevel, title: string, body: string): void {
  void dispatchAlert(level, title, body).catch(e => {
    console.error(
      `[notify] dispatch 예외 — level=${level} title="${title}"`,
      e instanceof Error ? e.message : String(e),
    );
  });
}
