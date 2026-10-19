/**
 * custom-confirm-guard.ts — 사용자 시나리오 확정(`POST /api/signals/custom/confirm`) 하드닝의 순수 계산. T-052.
 *
 * 그 라우트는 시나리오를 **사람 승인 없이 곧바로 `approved_pending_entry`(진입 감시)** 로 넣는다(T-029). 그래서:
 *  - D-2: 보유 마감일이 이미 지난 시나리오가 진입 감시에 들어가면 마감 뒤에 실주문이 나갈 수 있다 — 청산 엔진이 꺼져 있어
 *         자동 정리도 없다. → 만료를 `min(지금+24h, 마감일 23:59:59 KST)` 로 당기고, 이미 지난 마감은 거절한다.
 *  - D-1(c): 직접 작성 경로는 원본 시그널이 없어 선점할 대상이 없다 → 같은 (종목·방향·구간)의 활성 사용자 시나리오로 중복을 판정한다.
 *
 * DB·네트워크 접근이 없다(라우트가 트랜잭션·락을 맡는다).
 */
import { createHash } from 'node:crypto';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 사용자 시나리오 진입 감시 기본 수명 — T-050 에서 의도대로(24h) 복원된 값. */
export const CONFIRM_TTL_MS = 24 * 60 * 60 * 1000;

const DEADLINE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `holding_deadline`('YYYY-MM-DD') → 그날 **23:59:59 KST** 의 시점(epoch ms). 형식·달력 오류면 `null`.
 *
 * `entry-watcher` 의 `resolveHoldingDeadline` 이 같은 필드를 `new Date(`${dl}T23:59:59+09:00`)` 로 읽는다 — 유효한 날짜에서는
 * 이 함수와 1ms 도 다르지 않다(시험으로 고정). 다른 점은 달력에 없는 날짜(`2026-02-30`)다: 그쪽은 V8 이 3월 2일로 넘겨 받아들이고,
 * 여기서는 `null`(= 마감 없음 취급, 24시간)로 둔다. **거절 근거로 쓰는 값이라 애매하면 거절하지 않는 쪽**을 택했다(과도차단 금지, T-029).
 *
 * 구형 `holding_days`('당일'·'1~2일'·'1주')는 해석하지 않는다 — entry-watcher 도 그것을 "지금 + N일(N≥1)" 로 읽어
 * 항상 24시간보다 늦으므로 `min` 에 영향이 없다.
 */
export function holdingDeadlineEndMs(raw: unknown): number | null {
  if (typeof raw !== 'string' || !DEADLINE_RE.test(raw)) return null;
  const [y, m, d] = raw.split('-').map(Number);
  const utcMidnightOfDay = Date.UTC(y, m - 1, d);
  const check = new Date(utcMidnightOfDay);
  // Date.UTC 는 범위 밖 월·일을 넘겨 버리고(2-30 → 3-2), 0~99년은 1900년대로 바꾼다 → 되돌려 보아 같을 때만 인정
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return utcMidnightOfDay + (23 * 3600 + 59 * 60 + 59) * 1000 - KST_OFFSET_MS;
}

export type ConfirmExpiry =
  | { ok: true; expiresAtMs: number; clampedToDeadline: boolean }
  | { ok: false; error: string };

/**
 * 확정 시 저장할 만료 시점. `min(now + 24h, 마감일 23:59:59 KST)`.
 *  - 마감이 없거나 형식이 다르면 24시간(기존 동작).
 *  - 마감 시점이 `now` 이하(이미 지남)면 `ok:false` — 라우트가 400 으로 돌려준다(화면은 `data.error` 를 그대로 토스트로 보인다).
 */
export function resolveConfirmExpiry(scenario: unknown, nowMs: number): ConfirmExpiry {
  const ttlEnd = nowMs + CONFIRM_TTL_MS;
  const exit = (scenario && typeof scenario === 'object')
    ? (scenario as { exit?: unknown }).exit
    : undefined;
  const raw = (exit && typeof exit === 'object') ? (exit as { holding_deadline?: unknown }).holding_deadline : undefined;
  const deadlineEnd = holdingDeadlineEndMs(raw);
  if (deadlineEnd === null) return { ok: true, expiresAtMs: ttlEnd, clampedToDeadline: false };
  if (deadlineEnd <= nowMs) {
    return {
      ok: false,
      error: `보유 마감일(${String(raw)})이 이미 지났습니다. 마감일을 오늘 이후로 바꾼 뒤 다시 확정하세요.`,
    };
  }
  return deadlineEnd < ttlEnd
    ? { ok: true, expiresAtMs: deadlineEnd, clampedToDeadline: true }
    : { ok: true, expiresAtMs: ttlEnd, clampedToDeadline: false };
}

/**
 * 진입 구간 문자열의 비교 키. `'68600 ~ 69300'`·`'68600.0~69300'` → `'68600~69300'`. 수치가 아니면 앞뒤 공백만 걷어 낸다.
 * 같은 코드(라우트)가 만든 문자열끼리 비교하므로 실제로는 표기가 같지만, 표기 차이로 중복을 놓치지 않게 정규화한다.
 */
export function zoneKey(zone: string): string {
  const parts = zone.split('~').map(s => s.trim());
  if (parts.length === 2 && parts.every(p => p !== '' && Number.isFinite(Number(p)))) {
    return `${Number(parts[0])}~${Number(parts[1])}`;
  }
  return zone.trim();
}

export interface ActiveScenarioRow { id: unknown; indicators: unknown }

/**
 * 활성 사용자 시나리오 행들 가운데 새 확정의 진입 구간 중 하나라도 **같은 구간**을 가진 행을 찾는다.
 * `indicators.ai.scenario.entry.price_zone` 은 라우트가 슬라이스마다 써 넣는 값이다. 파싱할 수 없는 행은 건너뛴다
 * (그 행 때문에 정상 확정을 막지 않는다).
 */
export function findActiveZoneDuplicate(
  rows: readonly ActiveScenarioRow[],
  zones: readonly string[],
): { id: number; zone: string } | null {
  const wanted = new Set(zones.map(zoneKey));
  for (const r of rows) {
    let ind: unknown = r.indicators;
    if (typeof ind === 'string') {
      try { ind = JSON.parse(ind); } catch { continue; }
    }
    const zone = (ind as { ai?: { scenario?: { entry?: { price_zone?: unknown } } } } | null)?.ai?.scenario?.entry?.price_zone;
    if (typeof zone !== 'string') continue;
    if (wanted.has(zoneKey(zone))) return { id: Number(r.id), zone };
  }
  return null;
}

/**
 * (종목·방향) 단위 MariaDB 명명 락 이름. 이름 한도가 64자라 종목 문자열을 그대로 넣지 않고 해시한다.
 * `JSON.stringify([symbol, side])` 를 해시해 구분자 충돌이 없다.
 *
 * 해시 전에 **정규화**한다(종목 `trim`+대문자, 방향 `trim`+소문자) — 중복 조회 `symbol = ? AND side = ?` 는 테이블 collation
 * (utf8mb4_general_ci)이라 대소문자·후행 공백을 무시하는데, 락 이름이 철자 그대로면 `NAS:AAPL`/`nas:aapl`·`005930`/`'005930 '`·
 * `buy`/`BUY` 동시 요청이 서로 다른 락을 쥐고 둘 다 통과했다(T-052 Reviewer R-8, 실DB 5/5). 정규화는 **락 이름에만** 쓰고
 * DB 에 저장하는 값은 바꾸지 않는다. 앞쪽 공백까지 걷어 내는 것은 DB 비교보다 넓은 묶음이라 직렬화만 더 할 뿐 막지는 않는다.
 */
export function confirmLockName(symbol: string, side: string): string {
  const key = [String(symbol).trim().toUpperCase(), String(side).trim().toLowerCase()];
  const h = createHash('sha256').update(JSON.stringify(key)).digest('hex').slice(0, 40);
  return `si:custom-confirm:${h}`;   // 18 + 40 = 58자
}

/**
 * (종목·방향) 명명 락 대기(초) — **0, 기다리지 않는다.** 락 안의 작업은 조회 1~2번 + INSERT 몇 번이라 정상이면 수 ms 다.
 * 기다리는 동안 풀 연결(connectionLimit 10)을 쥐므로, 같은 키 요청이 몰리면 무관한 DB 작업(entry-watcher 등)이 연결을 못 얻었다
 * (5초에서 4.7초 지연 실측 — T-052 Reviewer R-5, Codex C2 medium). 못 잡으면 곧바로 409 로 연결을 돌려준다.
 */
export const CONFIRM_LOCK_WAIT_SEC = 0;

/** 원본 시그널이 이미 진입 감시·주문 쪽으로 넘어간(=다시 등록하면 중복인) 상태. 일반 승인은 곧바로 주문하고 auto_submitted 는 자동 제출이다. */
const ALREADY_ENTERED_STATUSES = new Set(['approved', 'approved_pending_entry', 'executing', 'auto_submitted']);

/** 처리·만료된 원본 상태의 사용자용 한국어 라벨. 목록에 없으면 '처리됨'. */
const HANDLED_STATUS_LABEL: Record<string, string> = {
  expired: '만료됨',
  rejected: '거절됨',
  superseded: '새 시그널로 대체됨',
};

/**
 * 원본 시그널 선점에 실패했을 때(이미 승인 대기가 아님) 화면 토스트에 그대로 보일 문장. 영문 상태 코드를 보이지 않고,
 * "중복"은 이미 진입 감시로 넘어간 경우에만 말한다(만료·거절은 중복이 아니다 — T-052 Reviewer R-4).
 */
export function sourceAlreadyHandledMessage(sourceSignalId: number, status: string): string {
  if (ALREADY_ENTERED_STATUSES.has(status)) {
    return `이미 진입 감시 또는 주문이 시작된 시나리오입니다(#${sourceSignalId}). 같은 시나리오가 두 번 등록되지 않도록 다시 등록하지 않았습니다 — 진행 상황은 추천 목록·대시보드에서 확인해 주세요.`;
  }
  const label = HANDLED_STATUS_LABEL[status] ?? '처리됨';
  return `이 시그널(#${sourceSignalId})은 이미 처리되었거나 만료되어 등록할 수 없습니다(${label}).`;
}

/** 직접 작성 경로에서 같은 (종목·방향·구간)의 활성 사용자 시나리오가 있을 때의 문장. */
export function activeDuplicateMessage(dup: { id: number; zone: string }): string {
  return `같은 종목·방향·구간(${dup.zone})의 시나리오 #${dup.id} 이(가) 이미 진행 중입니다. 기존 시나리오가 만료되거나 체결된 뒤 다시 등록해 주세요.`;
}

/** (종목·방향) 락 대기 초과 시의 문장. */
export const CONFIRM_BUSY_MESSAGE = '같은 종목·방향의 다른 확정이 처리 중입니다. 잠시 후 다시 시도해 주세요.';
