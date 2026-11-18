/**
 * T-175 WP-2 — 결과가 필요한 알림 1건을 **같은 실행 안에서** 간격을 두고 다시 보낸다(`dispatchAlert` 위에 얹는 얇은 층).
 *
 * 배경(2026-11-18 22:01): 개장 전 공시 확인 크론이 새 공시를 찾았지만 텔레그램 전송이 `fetch failed` 로 실패했다. 그 공시는
 * 이미 기록돼 다음 실행에서 「새 공시」가 아니므로, 그 한 번의 실패로 알림이 영구 유실됐다. 텔레그램 계층의 자체 재시도
 * (0.5초 뒤 1회)는 같은 순간의 네트워크 문제를 넘기기에 짧았다.
 *
 * 지금은 그 크론 라우트 한 곳만 쓴다 — 다른 알림 경로(`sendAlert` fire-and-forget·주문·청산 알림)의 재시도 정책은 바꾸지 않는다.
 *
 * 규칙
 *  - 재시도는 **실제 전송 실패**(`failed` 채널이 있거나 발송 함수가 던짐)일 때만 한다. 채널 없음·자격증명 미설정은 다시 해도 같다.
 *  - 한 채널이라도 전달되면 성공이다 — 이미 전달된 채널에 같은 알림을 두 번 보내지 않는다(`both` 에서 슬랙만 성공해도 재시도 없음).
 *  - **대기 상한(timeout)에 걸린 시도는 결과가 미확정**이다 — 늦게라도 도착할 수 있다. 그 위에 새 시도를 겹치면 중복 발송이 되므로,
 *    다음 간격 동안 그 시도의 결과를 기다린다. 간격 안에 실패로 끝나면 바로 다시 보내고, 전달됐으면 성공, 끝내 미확정이면
 *    더 보내지 않고 `unresolved` 로 돌려준다(중복보다 유실 표시가 낫다 — 호출부가 식별자를 로그로 남긴다).
 *  - 새 시도는 `canStart(간격)` 이 허락할 때만 시작한다 — 호출부의 시간 예산 안에서만.
 *
 * 실행 간(다음 틱·다음 날) 재전송은 하지 않는다 — 상태 저장소(DDL)가 필요해 T-175 범위 밖이다.
 * 던지지 않는다.
 */
import type { AlertDispatch } from '@/lib/notify';

export interface SendRetryOptions {
  /** 시도 1회 대기 상한(ms) */
  timeoutMs: number;
  /** 재시도 전 간격(ms). 길이 = 최대 재시도 횟수(총 시도 = 길이 + 1) */
  gapsMs: readonly number[];
  /** `gapMs` 만큼 기다린 뒤 새 시도를 시작해도 되는가(시간 예산). 첫 시도는 0 으로 묻는다. */
  canStart: (gapMs: number) => boolean;
  /** 시험용 — 기본은 setTimeout */
  sleep?: (ms: number) => Promise<void>;
}

export type SendRetryReason =
  /** 실제로 보냈으나 모든 시도가 실패 */
  | 'failed'
  /** 보낼 채널이 없거나 자격증명 미설정 — 재시도 무의미 */
  | 'unconfigured'
  /** 마지막 시도가 대기 상한에 걸려 결과를 모른다 — 늦게 도착했을 수 있다 */
  | 'unresolved'
  /** 시간 예산 때문에 (더) 시도하지 못했다 */
  | 'budget';

export interface SendRetryResult {
  delivered: boolean;
  /** 실제로 시작한 시도 수 */
  attempts: number;
  /** delivered=false 일 때만 */
  reason?: SendRetryReason;
  /** 마지막 실패 사유(채널별 오류 — 비밀값은 발송 계층이 이미 지운 문자열) */
  lastError?: string;
}

type Settled = { kind: 'dispatch'; d: AlertDispatch } | { kind: 'error'; message: string };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

function settle(send: () => Promise<AlertDispatch>): Promise<Settled> {
  try {
    return send().then(
      (d): Settled => ({ kind: 'dispatch', d }),
      (e): Settled => ({ kind: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
  } catch (e) {
    return Promise.resolve({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}

function race<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), ms); });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

export async function sendWithRetry(send: () => Promise<AlertDispatch>, o: SendRetryOptions): Promise<SendRetryResult> {
  const sleep = o.sleep ?? defaultSleep;
  let attempts = 0;
  let lastError: string | undefined;
  /** 직전 시도가 미확정이어서 그 결과를 간격만큼 이미 기다렸다 — 다음 시도 전에 또 기다리지 않는다 */
  let alreadyWaited = false;

  for (let i = 0; ; i++) {
    const gap = i === 0 ? 0 : o.gapsMs[i - 1];
    if (gap === undefined) return { delivered: false, attempts, reason: 'failed', lastError };
    const wait = alreadyWaited ? 0 : gap;
    if (!o.canStart(wait)) return { delivered: false, attempts, reason: 'budget', ...(lastError ? { lastError } : {}) };
    if (wait > 0) await sleep(wait);
    alreadyWaited = false;

    attempts++;
    const pending = settle(send);
    let out = await race(pending, o.timeoutMs);
    if (out === 'timeout') {
      // 결과 미확정 — 겹쳐 보내지 않는다. 다음 간격 동안 이 시도의 결과를 기다린다.
      const nextGap = o.gapsMs[i];
      if (nextGap === undefined || !o.canStart(nextGap)) return { delivered: false, attempts, reason: 'unresolved', ...(lastError ? { lastError } : {}) };
      out = await race(pending, nextGap);
      if (out === 'timeout') return { delivered: false, attempts, reason: 'unresolved', ...(lastError ? { lastError } : {}) };
      alreadyWaited = true;
    }

    if (out.kind === 'dispatch') {
      if (out.d.delivered.length > 0) return { delivered: true, attempts };
      if (out.d.failed.length === 0) return { delivered: false, attempts, reason: 'unconfigured' };
      lastError = out.d.failed.map((f) => `${f.channel}:${f.error}`).join(' / ').slice(0, 300);
    } else {
      lastError = out.message.slice(0, 300);
    }
  }
}
