/**
 * 키 단위로 스로틀되는 알림 (T-012).
 *
 * ## 왜 필요한가
 *
 * 안전장치가 "값이 이상해서 건너뛴다"고 판단했을 때 **조용히 넘어가면 안 된다** — 건너뛰기가
 * 계속되면 스냅샷 기아가 되고, 킬스위치는 낡은 값을 현재값으로 읽는다. 그렇다고 매번 알리면
 * 폭주한다: 대시보드는 열려 있는 동안 ~30초마다 스냅샷을 시도하고, 전략 cron 은 5분 주기다.
 *
 * → 사유(key)별로 창을 두고 **첫 발생만 알린다.** 로그는 매번 남기고 알림만 줄이는 것이 원칙.
 *
 * 프로세스 메모리 기반이라 재시작 시 초기화된다. 그건 의도된 동작이다 — 재시작 직후의
 * 첫 실패는 다시 알릴 가치가 있다.
 */
import { sendAlert } from './index';
import type { AlertLevel } from './slack';

const DEFAULT_TTL_MS = 30 * 60 * 1000;

const lastSentAt = new Map<string, number>();

/**
 * `key` 창이 열려 있을 때만 알림을 보낸다.
 * @returns 실제로 보냈으면 true
 */
export function sendAlertThrottled(
  key: string,
  level: AlertLevel,
  title: string,
  body: string,
  ttlMs: number = DEFAULT_TTL_MS,
): boolean {
  const now = Date.now();
  if (now - (lastSentAt.get(key) ?? 0) < ttlMs) return false;
  lastSentAt.set(key, now);
  sendAlert(level, title, body);
  return true;
}

/** 테스트/진단용 — 스로틀 창 초기화. */
export function resetAlertThrottle(key?: string): void {
  if (key === undefined) lastSentAt.clear();
  else lastSentAt.delete(key);
}
