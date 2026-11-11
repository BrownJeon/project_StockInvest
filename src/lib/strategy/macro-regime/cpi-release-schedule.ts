/**
 * BLS CPI(CPI-U, 비계절조정 CUUR0000SA0) 발표 일정 정적 표 — T-165 거시 레짐 라벨(C0) 전용.
 *
 * ⚠ 기록용 라벨의 입력이다. 매매 판단에 쓰지 않는다.
 *
 * ## 규칙 (Analyst §3 + Leader G7-2)
 * - 기준월 M 의 CPI 는 `releaseAtUtc`(08:30 America/New_York 을 UTC 로 변환한 시각) **이후에만** 쓴다.
 *   EDT(3월 둘째 일요일 ~ 11월 첫째 일요일) 08:30 = 12:30Z(21:30 KST), EST 08:30 = 13:30Z(22:30 KST).
 * - 표에 없는 월·`releaseAtUtc: null`(미공표) 월은 '미발표'(fail-safe). 표가 끝나면 3개월 뒤 자동 `cpi_stale`.
 * - `confirmed`: 실제 발표가 확인된 행이면 `true`, 일정표에서 온 미래 행은 `false`.
 *   운영 기록(`releaseBasis: 'live'`)은 두 값을 구분하지 않는다 — 연기되면 API 에 값이 아직 없어 자동 안전.
 *   과거 재계산·백테스트(`releaseBasis: 'confirmed_only'`)는 `confirmed: true` 행만 '발표됨' 으로 본다
 *   (예정 T → 실제 T+1 로 연기된 달을 사후에 재계산할 때 T~T+1 구간 look-ahead 방지).
 * - 2025-10 치는 **공표되지 않았다**(2025 연방정부 예산 공백 — BLS API `value: "-"`, footnote code X).
 *   `releaseAtUtc: null` 이고, 그 사실이 확인됐으므로 `confirmed: true`.
 *
 * ## 출처
 * - 2021-01 ~ 2026-10 치: BLS 뉴스릴리스 아카이브 https://www.bls.gov/bls/news-release/cpi.htm
 *   (파일명 날짜 코드 `cpi_MMDDYYYY` 에서 추출), 2025-11 치 일정 https://www.bls.gov/schedule/2025/12_sched.htm
 * - 2026-11 ~ 2027-11 치: https://www.bls.gov/schedule/news_release/cpi.htm · https://www.bls.gov/schedule/2026/home.htm
 *   (확인 2026-11-11 23:58 KST, 전부 08:30 AM ET)
 * - 생성: Analyst 산출 JSON(`bls-cpi-release-schedule.json` sha256 2be3eb74a682aba1)을 변환 스크립트로 옮겼다.
 *   `confirmed` 는 Leader G7-2 기준(기준월 ≤ 2026-10 → true)으로 변환 때 붙였다.
 *
 * ## 운영자 갱신 절차
 * 1. 매달 발표 뒤 해당 행을 `confirmed: true` 로 바꾼다. 실제 발표 날짜가 표와 달랐으면 `releaseAtUtc` 를
 *    실제 날짜의 08:30 ET(UTC 변환)로 고친 뒤 `confirmed: true`.
 * 2. BLS 가 다음 연도 일정을 공개하면 행을 추가한다(`confirmed: false`).
 * 3. `^src/lib/strategy/` 안이라 커밋에 Reviewer 판정 줄이 필요하다. 무결성 시험의 행 수도 함께 갱신한다.
 */

export interface CpiReleaseRow {
  /** 기준월 (YYYY-MM) */
  readonly referenceMonth: string;
  /** 발표 시각 (ISO8601 UTC, 08:30 ET 환산). `null` = 미공표 */
  readonly releaseAtUtc: string | null;
  /** 실제 발표가 확인된 행인가 (G7-2) */
  readonly confirmed: boolean;
}

/** 기준월 오름차순, 83행 (2021-01 ~ 2027-11) */
export const CPI_RELEASE_SCHEDULE: readonly CpiReleaseRow[] = Object.freeze([
  Object.freeze({ referenceMonth: '2021-01', releaseAtUtc: '2021-02-10T13:30:00Z', confirmed: true }), // ET 2021-02-10 08:30
  Object.freeze({ referenceMonth: '2021-02', releaseAtUtc: '2021-03-10T13:30:00Z', confirmed: true }), // ET 2021-03-10 08:30
  Object.freeze({ referenceMonth: '2021-03', releaseAtUtc: '2021-04-13T12:30:00Z', confirmed: true }), // ET 2021-04-13 08:30
  Object.freeze({ referenceMonth: '2021-04', releaseAtUtc: '2021-05-12T12:30:00Z', confirmed: true }), // ET 2021-05-12 08:30
  Object.freeze({ referenceMonth: '2021-05', releaseAtUtc: '2021-06-10T12:30:00Z', confirmed: true }), // ET 2021-06-10 08:30
  Object.freeze({ referenceMonth: '2021-06', releaseAtUtc: '2021-07-13T12:30:00Z', confirmed: true }), // ET 2021-07-13 08:30
  Object.freeze({ referenceMonth: '2021-07', releaseAtUtc: '2021-08-11T12:30:00Z', confirmed: true }), // ET 2021-08-11 08:30
  Object.freeze({ referenceMonth: '2021-08', releaseAtUtc: '2021-09-14T12:30:00Z', confirmed: true }), // ET 2021-09-14 08:30
  Object.freeze({ referenceMonth: '2021-09', releaseAtUtc: '2021-10-13T12:30:00Z', confirmed: true }), // ET 2021-10-13 08:30
  Object.freeze({ referenceMonth: '2021-10', releaseAtUtc: '2021-11-10T13:30:00Z', confirmed: true }), // ET 2021-11-10 08:30
  Object.freeze({ referenceMonth: '2021-11', releaseAtUtc: '2021-12-10T13:30:00Z', confirmed: true }), // ET 2021-12-10 08:30
  Object.freeze({ referenceMonth: '2021-12', releaseAtUtc: '2022-01-12T13:30:00Z', confirmed: true }), // ET 2022-01-12 08:30
  Object.freeze({ referenceMonth: '2022-01', releaseAtUtc: '2022-02-10T13:30:00Z', confirmed: true }), // ET 2022-02-10 08:30
  Object.freeze({ referenceMonth: '2022-02', releaseAtUtc: '2022-03-10T13:30:00Z', confirmed: true }), // ET 2022-03-10 08:30
  Object.freeze({ referenceMonth: '2022-03', releaseAtUtc: '2022-04-12T12:30:00Z', confirmed: true }), // ET 2022-04-12 08:30
  Object.freeze({ referenceMonth: '2022-04', releaseAtUtc: '2022-05-11T12:30:00Z', confirmed: true }), // ET 2022-05-11 08:30
  Object.freeze({ referenceMonth: '2022-05', releaseAtUtc: '2022-06-10T12:30:00Z', confirmed: true }), // ET 2022-06-10 08:30
  Object.freeze({ referenceMonth: '2022-06', releaseAtUtc: '2022-07-13T12:30:00Z', confirmed: true }), // ET 2022-07-13 08:30
  Object.freeze({ referenceMonth: '2022-07', releaseAtUtc: '2022-08-10T12:30:00Z', confirmed: true }), // ET 2022-08-10 08:30
  Object.freeze({ referenceMonth: '2022-08', releaseAtUtc: '2022-09-13T12:30:00Z', confirmed: true }), // ET 2022-09-13 08:30
  Object.freeze({ referenceMonth: '2022-09', releaseAtUtc: '2022-10-13T12:30:00Z', confirmed: true }), // ET 2022-10-13 08:30
  Object.freeze({ referenceMonth: '2022-10', releaseAtUtc: '2022-11-10T13:30:00Z', confirmed: true }), // ET 2022-11-10 08:30
  Object.freeze({ referenceMonth: '2022-11', releaseAtUtc: '2022-12-13T13:30:00Z', confirmed: true }), // ET 2022-12-13 08:30
  Object.freeze({ referenceMonth: '2022-12', releaseAtUtc: '2023-01-12T13:30:00Z', confirmed: true }), // ET 2023-01-12 08:30
  Object.freeze({ referenceMonth: '2023-01', releaseAtUtc: '2023-02-14T13:30:00Z', confirmed: true }), // ET 2023-02-14 08:30
  Object.freeze({ referenceMonth: '2023-02', releaseAtUtc: '2023-03-14T12:30:00Z', confirmed: true }), // ET 2023-03-14 08:30
  Object.freeze({ referenceMonth: '2023-03', releaseAtUtc: '2023-04-12T12:30:00Z', confirmed: true }), // ET 2023-04-12 08:30
  Object.freeze({ referenceMonth: '2023-04', releaseAtUtc: '2023-05-10T12:30:00Z', confirmed: true }), // ET 2023-05-10 08:30
  Object.freeze({ referenceMonth: '2023-05', releaseAtUtc: '2023-06-13T12:30:00Z', confirmed: true }), // ET 2023-06-13 08:30
  Object.freeze({ referenceMonth: '2023-06', releaseAtUtc: '2023-07-12T12:30:00Z', confirmed: true }), // ET 2023-07-12 08:30
  Object.freeze({ referenceMonth: '2023-07', releaseAtUtc: '2023-08-10T12:30:00Z', confirmed: true }), // ET 2023-08-10 08:30
  Object.freeze({ referenceMonth: '2023-08', releaseAtUtc: '2023-09-13T12:30:00Z', confirmed: true }), // ET 2023-09-13 08:30
  Object.freeze({ referenceMonth: '2023-09', releaseAtUtc: '2023-10-12T12:30:00Z', confirmed: true }), // ET 2023-10-12 08:30
  Object.freeze({ referenceMonth: '2023-10', releaseAtUtc: '2023-11-14T13:30:00Z', confirmed: true }), // ET 2023-11-14 08:30
  Object.freeze({ referenceMonth: '2023-11', releaseAtUtc: '2023-12-12T13:30:00Z', confirmed: true }), // ET 2023-12-12 08:30
  Object.freeze({ referenceMonth: '2023-12', releaseAtUtc: '2024-01-11T13:30:00Z', confirmed: true }), // ET 2024-01-11 08:30
  Object.freeze({ referenceMonth: '2024-01', releaseAtUtc: '2024-02-13T13:30:00Z', confirmed: true }), // ET 2024-02-13 08:30
  Object.freeze({ referenceMonth: '2024-02', releaseAtUtc: '2024-03-12T12:30:00Z', confirmed: true }), // ET 2024-03-12 08:30
  Object.freeze({ referenceMonth: '2024-03', releaseAtUtc: '2024-04-10T12:30:00Z', confirmed: true }), // ET 2024-04-10 08:30
  Object.freeze({ referenceMonth: '2024-04', releaseAtUtc: '2024-05-15T12:30:00Z', confirmed: true }), // ET 2024-05-15 08:30
  Object.freeze({ referenceMonth: '2024-05', releaseAtUtc: '2024-06-12T12:30:00Z', confirmed: true }), // ET 2024-06-12 08:30
  Object.freeze({ referenceMonth: '2024-06', releaseAtUtc: '2024-07-11T12:30:00Z', confirmed: true }), // ET 2024-07-11 08:30
  Object.freeze({ referenceMonth: '2024-07', releaseAtUtc: '2024-08-14T12:30:00Z', confirmed: true }), // ET 2024-08-14 08:30
  Object.freeze({ referenceMonth: '2024-08', releaseAtUtc: '2024-09-11T12:30:00Z', confirmed: true }), // ET 2024-09-11 08:30
  Object.freeze({ referenceMonth: '2024-09', releaseAtUtc: '2024-10-10T12:30:00Z', confirmed: true }), // ET 2024-10-10 08:30
  Object.freeze({ referenceMonth: '2024-10', releaseAtUtc: '2024-11-13T13:30:00Z', confirmed: true }), // ET 2024-11-13 08:30
  Object.freeze({ referenceMonth: '2024-11', releaseAtUtc: '2024-12-11T13:30:00Z', confirmed: true }), // ET 2024-12-11 08:30
  Object.freeze({ referenceMonth: '2024-12', releaseAtUtc: '2025-01-15T13:30:00Z', confirmed: true }), // ET 2025-01-15 08:30
  Object.freeze({ referenceMonth: '2025-01', releaseAtUtc: '2025-02-12T13:30:00Z', confirmed: true }), // ET 2025-02-12 08:30
  Object.freeze({ referenceMonth: '2025-02', releaseAtUtc: '2025-03-12T12:30:00Z', confirmed: true }), // ET 2025-03-12 08:30
  Object.freeze({ referenceMonth: '2025-03', releaseAtUtc: '2025-04-10T12:30:00Z', confirmed: true }), // ET 2025-04-10 08:30
  Object.freeze({ referenceMonth: '2025-04', releaseAtUtc: '2025-05-13T12:30:00Z', confirmed: true }), // ET 2025-05-13 08:30
  Object.freeze({ referenceMonth: '2025-05', releaseAtUtc: '2025-06-11T12:30:00Z', confirmed: true }), // ET 2025-06-11 08:30
  Object.freeze({ referenceMonth: '2025-06', releaseAtUtc: '2025-07-15T12:30:00Z', confirmed: true }), // ET 2025-07-15 08:30
  Object.freeze({ referenceMonth: '2025-07', releaseAtUtc: '2025-08-12T12:30:00Z', confirmed: true }), // ET 2025-08-12 08:30
  Object.freeze({ referenceMonth: '2025-08', releaseAtUtc: '2025-09-11T12:30:00Z', confirmed: true }), // ET 2025-09-11 08:30
  Object.freeze({ referenceMonth: '2025-09', releaseAtUtc: '2025-10-24T12:30:00Z', confirmed: true }), // ET 2025-10-24 08:30
  Object.freeze({ referenceMonth: '2025-10', releaseAtUtc: null, confirmed: true }), // 미공표 (2025 appropriations lapse)
  Object.freeze({ referenceMonth: '2025-11', releaseAtUtc: '2025-12-18T13:30:00Z', confirmed: true }), // ET 2025-12-18 08:30
  Object.freeze({ referenceMonth: '2025-12', releaseAtUtc: '2026-01-13T13:30:00Z', confirmed: true }), // ET 2026-01-13 08:30
  Object.freeze({ referenceMonth: '2026-01', releaseAtUtc: '2026-02-13T13:30:00Z', confirmed: true }), // ET 2026-02-13 08:30
  Object.freeze({ referenceMonth: '2026-02', releaseAtUtc: '2026-03-11T12:30:00Z', confirmed: true }), // ET 2026-03-11 08:30
  Object.freeze({ referenceMonth: '2026-03', releaseAtUtc: '2026-04-10T12:30:00Z', confirmed: true }), // ET 2026-04-10 08:30
  Object.freeze({ referenceMonth: '2026-04', releaseAtUtc: '2026-05-12T12:30:00Z', confirmed: true }), // ET 2026-05-12 08:30
  Object.freeze({ referenceMonth: '2026-05', releaseAtUtc: '2026-06-10T12:30:00Z', confirmed: true }), // ET 2026-06-10 08:30
  Object.freeze({ referenceMonth: '2026-06', releaseAtUtc: '2026-07-14T12:30:00Z', confirmed: true }), // ET 2026-07-14 08:30
  Object.freeze({ referenceMonth: '2026-07', releaseAtUtc: '2026-08-12T12:30:00Z', confirmed: true }), // ET 2026-08-12 08:30
  Object.freeze({ referenceMonth: '2026-08', releaseAtUtc: '2026-09-11T12:30:00Z', confirmed: true }), // ET 2026-09-11 08:30
  Object.freeze({ referenceMonth: '2026-09', releaseAtUtc: '2026-10-14T12:30:00Z', confirmed: true }), // ET 2026-10-14 08:30
  Object.freeze({ referenceMonth: '2026-10', releaseAtUtc: '2026-11-10T13:30:00Z', confirmed: true }), // ET 2026-11-10 08:30
  Object.freeze({ referenceMonth: '2026-11', releaseAtUtc: '2026-12-10T13:30:00Z', confirmed: false }), // ET 2026-12-10 08:30
  Object.freeze({ referenceMonth: '2026-12', releaseAtUtc: '2027-01-13T13:30:00Z', confirmed: false }), // ET 2027-01-13 08:30
  Object.freeze({ referenceMonth: '2027-01', releaseAtUtc: '2027-02-11T13:30:00Z', confirmed: false }), // ET 2027-02-11 08:30
  Object.freeze({ referenceMonth: '2027-02', releaseAtUtc: '2027-03-10T13:30:00Z', confirmed: false }), // ET 2027-03-10 08:30
  Object.freeze({ referenceMonth: '2027-03', releaseAtUtc: '2027-04-13T12:30:00Z', confirmed: false }), // ET 2027-04-13 08:30
  Object.freeze({ referenceMonth: '2027-04', releaseAtUtc: '2027-05-12T12:30:00Z', confirmed: false }), // ET 2027-05-12 08:30
  Object.freeze({ referenceMonth: '2027-05', releaseAtUtc: '2027-06-10T12:30:00Z', confirmed: false }), // ET 2027-06-10 08:30
  Object.freeze({ referenceMonth: '2027-06', releaseAtUtc: '2027-07-14T12:30:00Z', confirmed: false }), // ET 2027-07-14 08:30
  Object.freeze({ referenceMonth: '2027-07', releaseAtUtc: '2027-08-11T12:30:00Z', confirmed: false }), // ET 2027-08-11 08:30
  Object.freeze({ referenceMonth: '2027-08', releaseAtUtc: '2027-09-14T12:30:00Z', confirmed: false }), // ET 2027-09-14 08:30
  Object.freeze({ referenceMonth: '2027-09', releaseAtUtc: '2027-10-14T12:30:00Z', confirmed: false }), // ET 2027-10-14 08:30
  Object.freeze({ referenceMonth: '2027-10', releaseAtUtc: '2027-11-10T13:30:00Z', confirmed: false }), // ET 2027-11-10 08:30
  Object.freeze({ referenceMonth: '2027-11', releaseAtUtc: '2027-12-10T13:30:00Z', confirmed: false }), // ET 2027-12-10 08:30
]);
