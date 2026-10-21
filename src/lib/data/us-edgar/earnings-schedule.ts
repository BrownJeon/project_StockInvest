/**
 * 다음 실적 발표 **창(±7일)** 추정 — 순수 함수 (T-059 Part A, T-057 §5 P1).
 *
 * 🔴 날짜를 단정하지 않는다. 결과는 `windowStart ~ windowEnd`(양끝 포함 15일)뿐이고 `event_date_et` 는 비운다.
 *    DB 도 CHECK 제약으로 `status='estimated'` 행에 날짜가 들어가지 못하게 막는다(`scripts/migrations/T-059-us-data-collector.sql`).
 *    미래 일정의 공식 출처는 회사 IR 보도자료이고 그건 사람이 `confirmed`/`manual` 로 넣는다(자동 스크래핑은 범위 밖).
 *
 * ## 규칙 (입력 = 과거 실적 발표일, `extractEarningsReleaseDates()` 결과)
 * 1. 발표일이 2건 미만 → 추정하지 않는다(`insufficient_history`).
 * 2. 4건 이상 → **4분기 전 발표일 + 364일**(52주 — 요일 보존)을 중심으로 한다. 회사는 대개 "작년 같은 주"에 발표한다.
 *    (r0 = 가장 최근, r3 = 네 번째 최근. 다음 발표는 r3 의 정확히 4분기 뒤다.)
 *    중심이 r0 + 60일 ~ r0 + 120일 밖이면(분기 주기와 안 맞음) 3번으로 간다.
 * 3. 그 밖 → r0 + 91일(13주).
 * 4. 창 = 중심 ± 7일. **창 끝이 오늘(미국 동부 날짜)보다 이전이면 추정하지 않는다**(`window_passed` — 이미 지난 창을 앞으로의 일정처럼 쓰지 않게).
 * 5. `fiscalPeriod` 는 회계 분기 이름(FY·Q)을 만들지 않고 `after-<r0>` 로 둔다 — 8-K 에는 회계 분기 정보가 없고, 회계연도 대응을
 *    추정하면 그것도 단정이 된다. "r0 다음 발표"라는 사실만 키로 쓴다.
 */
import { addDays, daysBetween } from './parse';

export const ESTIMATE_HALF_WINDOW_DAYS = 7;

export type EstimateResult =
  | {
      ok: true;
      fiscalPeriod: string;
      windowStart: string;
      windowEnd: string;
      basis: { method: 'yoy_364d' | 'last_plus_91d'; anchor: string; latest: string; releasesUsed: number };
    }
  | { ok: false; reason: 'insufficient_history' | 'window_passed'; latest?: string };

export function estimateNextEarningsWindow(releaseDatesAsc: string[], todayEt: string): EstimateResult {
  const rs = [...releaseDatesAsc].sort();
  if (rs.length < 2) return { ok: false, reason: 'insufficient_history', latest: rs[rs.length - 1] };
  const r0 = rs[rs.length - 1];

  let method: 'yoy_364d' | 'last_plus_91d' = 'last_plus_91d';
  let anchor = r0;
  let center = addDays(r0, 91);
  if (rs.length >= 4) {
    const r3 = rs[rs.length - 4];
    const c = addDays(r3, 364);
    const gap = daysBetween(r0, c);
    if (gap >= 60 && gap <= 120) {
      method = 'yoy_364d';
      anchor = r3;
      center = c;
    }
  }
  const windowStart = addDays(center, -ESTIMATE_HALF_WINDOW_DAYS);
  const windowEnd = addDays(center, ESTIMATE_HALF_WINDOW_DAYS);
  if (windowEnd < todayEt) return { ok: false, reason: 'window_passed', latest: r0 };
  return {
    ok: true,
    fiscalPeriod: `after-${r0}`,
    windowStart,
    windowEnd,
    basis: { method, anchor, latest: r0, releasesUsed: Math.min(rs.length, method === 'yoy_364d' ? 4 : 1) },
  };
}
