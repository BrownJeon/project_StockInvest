/**
 * 연준 정책금리(FFR) 목표 범위 정적 표 + 정례 FOMC 결정일 — T-165 거시 레짐 라벨(C0) 전용.
 *
 * ⚠ 이 파일은 **기록용 라벨**의 입력이다. 매매 판단·게이트·사이징·AI 프롬프트에 쓰지 않는다
 *   (사용처는 `classify.ts` 하나 — 의존 경계 시험이 고정한다).
 *
 * ## 출처 (검증 가능하게)
 * - 목표 범위 변경 이력: https://www.federalreserve.gov/monetarypolicy/openmarket.htm
 *   (페이지 "Last Update: September 16, 2026", 확인 2026-11-11 23:57 KST)
 *   - 날짜 = 표의 **효력 발생일**(FOMC 성명 다음 영업일). 예: 성명 2026-09-16 → 효력 2026-09-17.
 *   - 2009~2014·2021 은 변경이 없어 행이 없다. 2020-03-04 행은 원문에 각주 `*`(2024-07-10 정정).
 * - `VERIFIED_THROUGH = 2026-11-11`: 2026-10-28 FOMC 성명 "maintain the target range … at 3-3/4 to 4 percent"
 *   로 10월 회의 뒤에도 표가 최신임을 확인(monetary20261028a.htm).
 * - 정례 결정일(= 회의 마지막 날, 성명 14:00 ET): https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
 *   (페이지 "Last Update: October 28, 2026", 확인 2026-11-11 23:57 KST).
 *   2025-08-22 notation vote(전략 성명)는 금리 결정이 아니라 제외. **2027 일정은 tentative**.
 * - 생성: Analyst 산출 JSON(`fomc-target-range-history.json` sha256 ad49082d53c35f33 ·
 *   `fomc-scheduled-meetings.json` sha256 627102cd26a86095)을 변환 스크립트로 옮겼다(손으로 치지 않음).
 *
 * ## 낡음 규칙 (Analyst §5) — 라벨을 `unknown` 으로 낮춘다
 * - `rate_table_stale`: 결정일 < 오늘(ET) 인 회의가 있고 그 결정일 > `VERIFIED_THROUGH`
 * - `rate_schedule_exhausted`: 오늘(ET) > 마지막 알려진 결정일
 * - 한계: 임시(긴급) 회의·회의 간 변경(2020-03-03/15 유형)은 감지하지 못한다 — 다음 정례 결정일까지
 *   옛 상단을 쓴다(C0 는 기록만이라 판단 영향 0, 운영자 갱신으로 해소).
 *
 * ## 운영자 갱신 절차
 * 1. FOMC 성명 다음 날 openmarket.htm 을 연다. 변경이 있으면 `FOMC_TARGET_RANGE_ROWS` 끝에
 *    `{ effectiveDate, lowerPct, upperPct }` 한 줄을 추가한다(없으면 추가 없음).
 * 2. 어느 경우든 `VERIFIED_THROUGH` 를 그 결정일 이상으로 올린다.
 * 3. 연준이 다음 연도 일정을 공개하면 `FOMC_DECISION_DATES` 에 결정일 8개를 추가한다.
 * 4. 이 파일은 `^src/lib/strategy/` 안이라 커밋에 Reviewer 판정 줄이 필요하다(의도된 마찰).
 *    무결성 시험(`__tests__/static-tables.test.ts`)의 행 수·표본도 함께 갱신한다.
 */

export interface FomcTargetRangeRow {
  /** 효력 발생일 (YYYY-MM-DD, 미 동부 달력일) */
  readonly effectiveDate: string;
  /** 목표 범위 하단 (%) */
  readonly lowerPct: number;
  /** 목표 범위 상단 (%) */
  readonly upperPct: number;
}

/** 표가 최신임을 사람이 확인한 마지막 날짜 (YYYY-MM-DD, ET) */
export const VERIFIED_THROUGH = '2026-11-11';

/** 목표 범위 변경 이력 — 효력일 오름차순, 33행 (2008-12-16 ~) */
export const FOMC_TARGET_RANGE_ROWS: readonly FomcTargetRangeRow[] = Object.freeze([
  Object.freeze({ effectiveDate: '2008-12-16', lowerPct: 0.00, upperPct: 0.25 }),
  Object.freeze({ effectiveDate: '2015-12-17', lowerPct: 0.25, upperPct: 0.50 }),
  Object.freeze({ effectiveDate: '2016-12-15', lowerPct: 0.50, upperPct: 0.75 }),
  Object.freeze({ effectiveDate: '2017-03-16', lowerPct: 0.75, upperPct: 1.00 }),
  Object.freeze({ effectiveDate: '2017-06-15', lowerPct: 1.00, upperPct: 1.25 }),
  Object.freeze({ effectiveDate: '2017-12-14', lowerPct: 1.25, upperPct: 1.50 }),
  Object.freeze({ effectiveDate: '2018-03-22', lowerPct: 1.50, upperPct: 1.75 }),
  Object.freeze({ effectiveDate: '2018-06-14', lowerPct: 1.75, upperPct: 2.00 }),
  Object.freeze({ effectiveDate: '2018-09-27', lowerPct: 2.00, upperPct: 2.25 }),
  Object.freeze({ effectiveDate: '2018-12-20', lowerPct: 2.25, upperPct: 2.50 }),
  Object.freeze({ effectiveDate: '2019-08-01', lowerPct: 2.00, upperPct: 2.25 }),
  Object.freeze({ effectiveDate: '2019-09-19', lowerPct: 1.75, upperPct: 2.00 }),
  Object.freeze({ effectiveDate: '2019-10-31', lowerPct: 1.50, upperPct: 1.75 }),
  Object.freeze({ effectiveDate: '2020-03-04', lowerPct: 1.00, upperPct: 1.25 }),
  Object.freeze({ effectiveDate: '2020-03-16', lowerPct: 0.00, upperPct: 0.25 }),
  Object.freeze({ effectiveDate: '2022-03-17', lowerPct: 0.25, upperPct: 0.50 }),
  Object.freeze({ effectiveDate: '2022-05-05', lowerPct: 0.75, upperPct: 1.00 }),
  Object.freeze({ effectiveDate: '2022-06-16', lowerPct: 1.50, upperPct: 1.75 }),
  Object.freeze({ effectiveDate: '2022-07-28', lowerPct: 2.25, upperPct: 2.50 }),
  Object.freeze({ effectiveDate: '2022-09-22', lowerPct: 3.00, upperPct: 3.25 }),
  Object.freeze({ effectiveDate: '2022-11-03', lowerPct: 3.75, upperPct: 4.00 }),
  Object.freeze({ effectiveDate: '2022-12-15', lowerPct: 4.25, upperPct: 4.50 }),
  Object.freeze({ effectiveDate: '2023-02-02', lowerPct: 4.50, upperPct: 4.75 }),
  Object.freeze({ effectiveDate: '2023-03-23', lowerPct: 4.75, upperPct: 5.00 }),
  Object.freeze({ effectiveDate: '2023-05-04', lowerPct: 5.00, upperPct: 5.25 }),
  Object.freeze({ effectiveDate: '2023-07-27', lowerPct: 5.25, upperPct: 5.50 }),
  Object.freeze({ effectiveDate: '2024-09-19', lowerPct: 4.75, upperPct: 5.00 }),
  Object.freeze({ effectiveDate: '2024-11-08', lowerPct: 4.50, upperPct: 4.75 }),
  Object.freeze({ effectiveDate: '2024-12-19', lowerPct: 4.25, upperPct: 4.50 }),
  Object.freeze({ effectiveDate: '2025-09-18', lowerPct: 4.00, upperPct: 4.25 }),
  Object.freeze({ effectiveDate: '2025-10-30', lowerPct: 3.75, upperPct: 4.00 }),
  Object.freeze({ effectiveDate: '2025-12-11', lowerPct: 3.50, upperPct: 3.75 }),
  Object.freeze({ effectiveDate: '2026-09-17', lowerPct: 3.75, upperPct: 4.00 }),
]);

/** 정례 FOMC 결정일(회의 마지막 날) — 오름차순, 24건. 2027 은 tentative. */
export const FOMC_DECISION_DATES: readonly string[] = Object.freeze([
  '2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18', '2025-07-30', '2025-09-17', '2025-10-29', '2025-12-10',
  '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
  '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-09', '2027-07-28', '2027-09-15', '2027-10-27', '2027-12-08',
]);
