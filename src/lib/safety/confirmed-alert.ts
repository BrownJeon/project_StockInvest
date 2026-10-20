/**
 * **전달이 확인된 뒤에만 억제하는** 경보 (T-056, Codex C1-4 선택지 (b)).
 *
 * ## 왜 공용 `sendAlertThrottled` 를 쓰지 않는가
 *
 * `notify/throttle.ts` 는 `lastSentAt` 을 **먼저** 기록하고 fire-and-forget `sendAlert` 를 부른다. 그래서 텔레그램·슬랙이
 * 모두 실패한 첫 경보도 "보냈다"로 기록되어 창(예: 2시간) 내내 재전송되지 않는다. 스냅샷이 현금 조회 실패로 보류되는 동안에는
 * 킬스위치도 돌지 않으므로(`kill-switch:stale-current` 는 저장 성공 뒤에만 실행된다) 이 경보가 운영자에게 닿는 거의 유일한
 * 통로다. 첫 전달 실패를 2시간 삼키면 안 된다.
 *
 * 공용 모듈은 다른 경보 전부가 쓰므로 바꾸지 않고(설계 결정), 이 키들만 여기서 처리한다.
 *
 * ## 동작
 *  - `dispatchAlert` 결과를 **기다리지 않는다**(호출부 = 크론 응답을 알림 I/O 로 막지 않는다). `.then` 으로 결과만 받는다.
 *  - 한 채널이라도 전달되면(`delivered.length > 0`) 그때부터 `suppressMs` 동안 억제한다.
 *  - 전달 실패면 억제하지 않는다 → 다음 호출(다음 크론 틱)에 다시 보낸다.
 *  - 같은 키의 전송이 진행 중이면 겹쳐 보내지 않는다(in-flight). 진행 중 표시가 `IN_FLIGHT_STALE_MS` 보다 오래되면
 *    응답 없이 걸린 것으로 보고 다시 보낸다 — 걸린 전송 하나가 경보를 영구히 막지 않게.
 *  - 프로세스 메모리 상태라 재시작 시 초기화된다(재시작 직후 한 번 더 울릴 수 있다 — 설계 R9, 수용).
 */
import { dispatchAlert } from '@/lib/notify';
import type { AlertLevel } from '@/lib/notify/slack';

export const IN_FLIGHT_STALE_MS = 10 * 60 * 1000;

interface KeyState { deliveredAt: number | null; inFlightSince: number | null }
const state = new Map<string, KeyState>();

export type ConfirmedAlertOutcome = 'sent' | 'suppressed' | 'in_flight';

/** 테스트에서 전송 함수를 바꿔 끼우기 위한 seam. 기본은 실제 `dispatchAlert`. */
type Dispatch = (level: AlertLevel, title: string, body: string) => Promise<{ delivered: readonly unknown[] }>;
let dispatchImpl: Dispatch = dispatchAlert;

export function sendAlertUntilDelivered(
  key: string,
  level: AlertLevel,
  title: string,
  body: string,
  suppressMs: number,
  now: number = Date.now(),
): ConfirmedAlertOutcome {
  const s: KeyState = state.get(key) ?? { deliveredAt: null, inFlightSince: null };
  state.set(key, s);
  if (s.inFlightSince != null && now - s.inFlightSince < IN_FLIGHT_STALE_MS) return 'in_flight';
  if (s.deliveredAt != null && now - s.deliveredAt < suppressMs) return 'suppressed';

  const startedAt = now;
  s.inFlightSince = startedAt;
  let p: Promise<{ delivered: readonly unknown[] }>;
  try {
    p = dispatchImpl(level, title, body);
  } catch (e) {
    p = Promise.reject(e);
  }
  void p.then(
    (d) => {
      if (Array.isArray(d?.delivered) && d.delivered.length > 0) s.deliveredAt = Date.now();
      else console.error(`[confirmed-alert] ${key} 전달 실패 — 억제하지 않음(다음 틱에 다시 보낸다)`);
    },
    (e) => {
      console.error(`[confirmed-alert] ${key} 전송 예외 — 억제하지 않음:`, e instanceof Error ? e.message : String(e));
    },
  ).finally(() => {
    // 더 새로운 전송이 시작됐다면(오래 걸린 전송을 버리고 재전송한 경우) 그쪽 표시를 지우지 않는다.
    if (s.inFlightSince === startedAt) s.inFlightSince = null;
  });
  return 'sent';
}

/** 테스트/진단용 */
export function resetConfirmedAlerts(): void { state.clear(); }

/** 테스트용 — 전송 함수 교체. 인자 없이 부르면 실제 `dispatchAlert` 로 되돌린다. */
export function __setConfirmedAlertDispatchForTest(fn?: Dispatch): void { dispatchImpl = fn ?? dispatchAlert; }
