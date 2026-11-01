/**
 * 안전장치 불리언 플래그 파서 (Phase 0, 2026-08-02).
 *
 * 배경: `isDryRun()` / `isKillSwitchActive()` 가 `val === true || val === 'true'` 로만
 * 판정해서 `1` · `"1"` · `"ON"` 같은 비표준 truthy 값이 들어오면 **조용히 false 로 해석**됐다.
 *  - DRY_RUN 이 false 로 해석되면 → 실거래 개시 (fail-open, 자금 위험)
 *  - KILL_SWITCH 가 false 로 해석되면 → 차단 해제 (fail-open, 자금 위험)
 * `/api/settings/safety` PATCH 는 body 값을 그대로 JSON.stringify 해서 저장하므로
 * 클라이언트가 보낸 `1` 이 DB 에 그대로 들어갈 수 있다.
 *
 * ## 3분기 판정 (2026-08-02 교정)
 * "미설정"과 "값이 있는데 해석 불가"를 **반드시 구분**한다. 둘의 안전 기본값이 다르기 때문이다.
 *
 * | state        | 의미                              | 호출부 기본값 원칙                 |
 * |--------------|-----------------------------------|------------------------------------|
 * | `unset`      | 키 부재 / null / 빈 문자열        | 평상시 운영값 (KILL_SWITCH=off 등) |
 * | `parsed`     | 정규화 후 인식 성공               | 그 값 그대로                       |
 * | `unparsable` | 값은 있는데 인식 실패 (오타 등)   | **항상 안전 방향** + 경고/알림     |
 *
 * `unparsable` 을 안전 방향으로 보는 이유: 사용자가 무언가를 **설정하려 한 흔적**이 있는데
 * 파서가 못 알아들은 상황이다. 긴급 상황에서 KILL_SWITCH 를 켜려고 값을 넣었는데 파서가
 * 무시해서 거래가 계속되는 것이 최악의 시나리오다. 반대로 잘못 멈추는 것은 기회 손실일 뿐이며
 * 경고·알림으로 즉시 인지되어 복구할 수 있다.
 *
 * 대소문자·앞뒤 공백은 정규화 후 판정한다 — `" TRUE "` 는 `unparsable` 이 아니라 `parsed(true)`.
 */

const TRUE_TOKENS = new Set(['true', '1', 'on', 'yes', 'y']);
const FALSE_TOKENS = new Set(['false', '0', 'off', 'no', 'n']);

export type BoolFlagResult =
  /** 키 부재 / null / undefined / 빈(공백뿐인) 문자열 — 설정된 적 없음 */
  | { state: 'unset' }
  /** 정규화 후 인식 성공 */
  | { state: 'parsed'; value: boolean }
  /** 값은 존재하나 인식 실패 — 호출부는 안전 방향 + 경고 처리해야 한다 */
  | { state: 'unparsable'; raw: string };

/** 불리언 플래그 3분기 해석. */
export function parseBoolFlag(val: unknown): BoolFlagResult {
  if (val === null || val === undefined) return { state: 'unset' };

  if (typeof val === 'boolean') return { state: 'parsed', value: val };

  if (typeof val === 'number') {
    if (val === 1) return { state: 'parsed', value: true };
    if (val === 0) return { state: 'parsed', value: false };
    return { state: 'unparsable', raw: String(val) };
  }

  if (typeof val === 'string') {
    const t = val.trim().toLowerCase();
    if (t === '') return { state: 'unset' };
    if (TRUE_TOKENS.has(t)) return { state: 'parsed', value: true };
    if (FALSE_TOKENS.has(t)) return { state: 'parsed', value: false };
    return { state: 'unparsable', raw: val };
  }

  // 객체·배열 등 — 값은 있으나 플래그로 해석 불가
  let raw: string;
  try { raw = JSON.stringify(val) ?? String(val); } catch { raw = String(val); }
  return { state: 'unparsable', raw };
}

// ─── system_config 한 칸 되읽기 ──────────────────────────────────────────────
/**
 * `system_config.value` 한 칸을 플래그 값으로 되읽는다 (T-142).
 *
 * **이 함수는 방어층이다 — 운영 표는 비 JSON 저장을 이미 막는다.** `system_config.value` 에는
 * `CHECK (json_valid(value))` 가 걸려 있어(운영 스키마 실측) 평범한 INSERT·UPDATE·REPLACE 는 errno 4025
 * 로 거부된다. 비 JSON 값이 실제로 들어오는 경로는 **제약이 없는 환경**이다 — 복원본·마이그레이션 중
 * 테이블·`SET SESSION check_constraint_checks=0` 세션·다른 스토리지.
 *
 * 그런 환경에서 `yes` 같은 날 값을 만나면, 호출부가 `JSON.parse` 를 DB 조회와 **같은 `try` 안**에서 하고
 * 있었기 때문에 파싱 예외가 「DB 를 못 읽었다」용 `catch` 에 걸려 **DB 값이 아예 없었던 것처럼** env
 * 폴백으로 내려갔다. env 가 미설정이면 킬스위치는 `false`(제동 없음)다 — 위 3분기 표의 `unparsable`
 * 계약과 정반대다(T-141 QA F-2 의 B·G 경로. 그 재현은 **모의 풀**이고, 운영 도달에는 위 제약 우회가 필요하다).
 *
 * 그래서 JSON 이 아니면 **원문 문자열을 그대로** 돌려준다. `parseBoolFlag` 가 `yes`·`ON` 을 알아보므로
 * 대개 `parsed` 로 제대로 해석되고, 그래도 모르는 값이면 `unparsable` 로 분류돼 호출부가 안전 방향으로
 * 처리한다(킬스위치·DRY_RUN 모두 활성).
 *
 * **DB 조회 자체의 실패는 이 함수가 건드리지 않는다** — 그쪽 거동(env 폴백)은 그대로다.
 * 선례: `order-sync.ts` 가 `broker_payload` 를 같은 방식으로 되읽는다(비 JSON 이면 원문 그대로).
 */
export function decodeFlagValue(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw) as unknown; } catch { return raw; }
}

// ─── 해석 불가 보고 중복 억제 ────────────────────────────────────────────────
// isDryRun/isKillSwitchActive 는 주문마다·/api/health 호출마다 실행되므로
// 같은 값에 대해 매번 로그·알림을 내면 스팸이 된다. (key, raw) 조합당 프로세스 1회로 제한.
// 값이 바뀌면 다시 보고된다 (새 오타를 놓치지 않기 위해).
const reported = new Set<string>();

/** 이 (key, raw) 조합을 지금 보고해야 하는가. 첫 호출만 true. */
export function shouldReportUnparsable(key: string, raw: string): boolean {
  const k = `${key}=${raw}`;
  if (reported.has(k)) return false;
  reported.add(k);
  return true;
}

/** 테스트용 — 보고 중복 억제 상태 초기화 */
export function resetUnparsableReports(): void {
  reported.clear();
}
