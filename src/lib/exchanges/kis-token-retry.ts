/**
 * KIS 토큰 만료 응답을 받았을 때의 **단일 출처** 처리 (T-136).
 *
 * ## 왜 모듈을 따로 두는가
 *
 * 재발급(`invalidateKisToken`)은 `kis-auth` 에 있고 `kis-auth` 는 `kis-http` 의 `kisFetch` 를
 * import 한다(`kis-auth.ts:3`). 그래서 이 조합을 `kis-http` 에 넣으면 **순환 import** 가 된다.
 * 판정은 의존성 없는 잎 모듈 `kis-token-codes` 에 두고, 그것을 쓰는 이 헬퍼를 한 단계 위로 뺀다.
 *
 * ## 왜 재발급을 먼저 하지 않는가 (T-133 감사 M-2)
 *
 * 토큰 만료를 보면 곧바로 `invalidateKisToken()` 을 부르던 모양이 어댑터 7곳에 복제돼 있었다. 그런데
 * 토큰은 **여러 프로세스가 공유하는 DB 행**이다(`system_config.kis_access_token`). 다른 프로세스가 이미
 * 회전시켜 뒀는데 우리가 그 **멀쩡한 새 토큰을 지우고** 재발급을 요청하면, KIS 의 "앱키당 1분에 1회"
 * 제한(`EGW00133`)에 걸려 `kis-auth.issueAndStore` 가 **60초를 기다린다.** 그 동안 같은 프로세스의
 * 모든 `getKisToken()` 호출이 막히는데 — **`createOrder` 도 그 경로다.** 조회 한 건을 구하려다 주문을
 * 1분 막는 셈이다.
 *
 * 그래서 순서를 뒤집는다: **DB 를 다시 읽어 보고**, 값이 이번 요청에 실린 것과 **다르면 재발급 없이**
 * 그 토큰으로 재시도하고, **같을 때만** 재발급한다. 60초 대기 위험을 "DB 토큰도 정말 죽었을 때" 로 좁힌다.
 *
 * ⚠ `getKisToken()` 은 **순수한 읽기가 아니다** — DB 행이 있으면 그 값을 돌려주지만, **행이 없으면
 * 스스로 발급한다**(`kis-auth.ts` 의 캐시 조회 → `issueAndStore`). 바로 아래 §동시성이 그 때문이다.
 *
 * ## §동시성 — 같은 죽은 토큰에는 판단 하나만 (T-136 감사 M-1)
 *
 * 토큰이 죽으면 그 순간 **진행 중이던 조회 여러 건이 동시에** 같은 응답을 받는다. 각자 재읽기를 하면,
 * 먼저 도착한 호출의 `invalidateKisToken()` 이 DB 행을 지운 뒤라 **나머지는 "행 없음" 을 만나 제각각
 * 발급**한다. 그 중복 발급이 KIS 의 1분 1회 제한에 걸려 60초 대기를 만든다 — 없애려던 바로 그 증상이다.
 * (감사자 모델: 4건 동시·도착 간격 8ms 에서 104/120 회가 60초 대기.)
 *
 * 그래서 **죽은 토큰(`usedAuth`)을 키로 판단을 공유**한다. 같은 토큰으로 동시에 실패한 호출들은
 * 하나의 결정을 함께 기다리고, 발급은 한 번만 일어난다. 끝나면 키를 지우므로 다음 사망에는 새로 판단한다.
 * 이 단일화는 **한 프로세스 안**의 것이다 — 웹·크론처럼 다른 프로세스 사이의 중복 발급과, 재발급 구간에
 * 끼어드는 주문 경로의 `getKisToken()` 은 그대로 남는다(종전에도 있던 것, T-136 후속 후보 5).
 *
 * ## 왜 손으로 적지 않는가 (T-133 QA #2)
 *
 * 7곳이 저마다 `body.includes('EGW00123')` 를 적어 둬서, 게이트웨이가 `EGW00121` 도 토큰 오류로 보고
 * **재시도를 건너뛰는데**(`isTransientKisFailure` 가 토큰 계열을 제외한다) 호출부는 재발급도 하지 않는
 * 사각지대가 생겼다. 아무도 복구하지 않는 조합이다. 판정은 한 곳에서만 한다.
 *
 * 🔴 **읽기 전용 조회에만 쓴다.** 주문 송신(`createOrder`·`cancelOrder`)에는 토큰 분기가 **없고**,
 * 넣지도 않는다 — 주문은 멱등하지 않아 "한 번 더 보낸다" 자체가 다른 판단이다.
 */
import { getKisToken, invalidateKisToken } from './kis-auth';
import { isKisTokenError } from './kis-token-codes';

/**
 * 실패 응답 본문이 토큰 만료인지 보고, 필요하면 재발급까지 한다.
 *
 * @param body     실패 응답 본문(문자열). 토큰 오류가 아니면 아무것도 하지 않는다.
 * @param usedAuth 이번 요청에 실제로 실린 `Authorization` 헤더(`Bearer <token>`). 호출부는 루프 안에서
 *                 만든 `headers.Authorization` 을 그대로 넘긴다 — 토큰을 다시 읽지 않으려는 것이고,
 *                 두 번 읽는 사이에 회전하는 경쟁도 함께 없앤다(T-133 Reviewer L-7).
 * @param label    로그 접두. 코드 상수만 쓴다(사용자 입력·토큰 값을 넣지 않는다).
 * @returns `true` 면 호출부가 **헤더를 새로 만들어 1회 재시도**해야 한다. `false` 면 토큰 문제가 아니므로
 *          호출부의 기존 실패 처리(던지기·`stop()`)로 간다.
 *
 * 던질 수 있다 — `getKisToken()`·`invalidateKisToken()` 이 던지면 그대로 전파한다(fail-closed).
 * 예전 모양도 `invalidateKisToken()` 이 던질 수 있었으므로 위험 성질은 같다. 호출부가 예외를 자기
 * 방식으로 바꿔야 하면(원장 조회의 `stop('auth_error')`) 호출을 try/catch 로 감싼다.
 */
export async function shouldRetryAfterTokenError(
  body: string,
  usedAuth: string | undefined,
  label: string,
): Promise<boolean> {
  // 토큰 오류가 아니면 **DB 를 읽지 않는다** — 흔한 실패(게이트웨이 5xx·업무실패)마다 SELECT 를 더하지 않는다.
  if (!isKisTokenError(body)) return false;

  // §동시성 — 같은 죽은 토큰이면 이미 도는 판단에 올라탄다.
  const key = usedAuth ?? '';
  const running = inFlight.get(key);
  if (running) return running;

  const decision = decide(usedAuth, label).finally(() => { inFlight.delete(key); });
  inFlight.set(key, decision);
  return decision;
}

/** 같은 죽은 토큰으로 동시에 실패한 호출이 공유하는 판단. 끝나면 지운다(§동시성). */
const inFlight = new Map<string, Promise<boolean>>();

async function decide(usedAuth: string | undefined, label: string): Promise<boolean> {
  const fresh = await getKisToken();
  if (`Bearer ${fresh}` !== usedAuth) {
    // 다른 프로세스가 이미 회전시켰다 — 지우지 않고 그 토큰으로 간다.
    console.warn(`[${label}] token rotated elsewhere — 재읽기로 재시도`);
    return true;
  }

  // DB 토큰도 방금 쓴 것과 같다 = 정말 죽었다. 이때만 재발급한다.
  console.warn(`[${label}] token expired, re-issuing`);
  await invalidateKisToken();
  return true;
}

/** 시험 전용 — 진행 중인 판단을 비운다. 운영 코드에서 부르지 않는다. */
export function __resetTokenRetryForTest(): void {
  inFlight.clear();
}
