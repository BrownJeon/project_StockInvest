/**
 * T-074 자금 이동 원장 — 규칙 상수 (서버·클라이언트 공용, 순수 모듈).
 *
 * 탐지·검증·매칭의 임계값은 **이 파일 한 곳**에만 둔다. 화면 문장(알림 기준·안내)도 이 값으로 찍는다(Designer 구현 가이드 7절).
 * 키 이름은 승인 데모(`mockups/T-074-cash-flow-ledger-v1.html`)의 `RULE` 과 같게 두고(krw·usd·tolKrw·tolUsd·windowH·bigPct·fxWarnPct),
 * 데모에 없던 서버 쪽 값은 아래에 덧붙였다. 출처: Analyst Q1⑤·Q3 (task T-074).
 *
 * 이 모듈의 어떤 값도 주문·시그널·안전장치 경로가 읽지 않는다(표시·기록·계산 전용).
 */
import type { Currency } from './types';

export const RULE = Object.freeze({
  /** 기록 안 된 입출금 후보: 보유 수량 불변 단계에서 원화 현금 변화 하한(원) — Analyst Q3 */
  krw: 50_000,
  /** 기록 안 된 입출금 후보: 달러 현금 변화 하한($) — Analyst Q3 */
  usd: 50,
  /** 매칭 허용치 하한 — 원화(원). 실제 허용치 = max(tolKrw, 금액 × tolPct%) */
  tolKrw: 1_000,
  /** 매칭 허용치 하한 — 달러($) */
  tolUsd: 1,
  /** 매칭 허용치 비율 % (금액의 0.1%) — Analyst Q3 */
  tolPct: 0.1,
  /** 기록 시각 뒤 스냅샷을 찾는 창(시간) — Analyst Q1⑤ */
  windowH: 36,
  /** 큰 금액 경고: 현재 총자산의 이 % 이상 — Designer 결정 3(분석가 '총자산 초과' 보다 낮춤) */
  bigPct: 50,
  /** 환전 적용 환율이 앱 환율과 이 % 넘게 다르면 경고, 후보 탐지에서 환전처럼 보는 범위 */
  fxWarnPct: 3,
  /** 같은 금액 재입력 경고 창(시간) */
  dupWarnH: 24,
  /** 스냅샷이 이 시간보다 오래되면 '오래됨' 표지 (T-066 SNAPSHOT_STALE_MS 와 같은 3시간) */
  staleH: 3,
  /** 메모·사유 최대 글자 수(코드포인트) — DDL VARCHAR(200) */
  memoMax: 200,
  /** USD 예수금 Y ↔ Y+X 왕복(Analyst Q3·Q5 의 'X')을 같은 X 로 묶는 허용치($) — T-069 RULES.usdFlipTolUsd 와 같다 */
  usdFlipTolUsd: 0.05,
  /** X 가 영업일마다 약 +$0.03 씩 변하는 것(Analyst A 표)을 흡수하는 하루당 추가 허용치($) */
  usdFlipDriftUsdPerDay: 0.05,
  /** 왕복으로 보는 최소 전환 수(양 방향 포함) — T-069 RULES.usdFlipMinFlips 와 같다 */
  usdFlipMinFlips: 2,
  /** 왕복 패턴의 마지막 전환이 이 일수 안이어야 '지금도 진행 중'으로 본다 */
  usdFlipActiveDays: 3,
  /** 화면 안내용: X 가 빠져 보이는 시간대(KST) — Analyst A 표의 관측(16~17시 빠짐, 06~07시 복귀) */
  usdGapHoursKst: '16~06',
  /** 매칭·후보 탐지에 읽는 스냅샷 범위(일) — 기준 시각과 (지금 − 이 일수) 중 늦은 쪽부터 */
  scanDays: 120,
  /** 한 번에 읽는 스냅샷 행 상한(최신 쪽 유지) */
  scanMaxRows: 6_000,
  /** 입력 금액 상한 — DECIMAL(18,2) 안전 범위 + 자릿수 실수 차단(원) */
  maxKrw: 1_000_000_000_000,
  /** 입력 금액 상한($) */
  maxUsd: 1_000_000_000,
});

/** 규칙 값 묶음 타입(시험·미리보기에서 값을 바꿔 넣을 수 있게 숫자·문자열로 넓힌다) */
export type LedgerRules = {
  readonly [K in keyof typeof RULE]: (typeof RULE)[K] extends number ? number : (typeof RULE)[K] extends string ? string : (typeof RULE)[K];
};

/**
 * 원장 통화(닫힌 유니온 'KRW' | 'USD')가 달러인가 — 원장 기록·검증·표기의 통화 분기가 모두 거치는 한 곳(가독성).
 * 원장 값 비교이지 잔고 배열(`Balance[]`)에서 USD 행을 골라 읽는 코드가 아니다. T-056 울타리 시험
 * (`src/lib/__tests__/usd-cash-balance-fence.test.ts`)은 이 비교를 **세고**, 허용 목록에 이 사유로 올라 있다(Reviewer 항목 5 (c)).
 */
export function isUsd(currency: Currency): boolean {
  return currency === 'USD';
}

/** 원장 범위 — `accounts` 1행(id 1, kis/default). orders.account_id 와 같은 범위 (Analyst Q2) */
export const LEDGER_ACCOUNT_ID = 1;

/** 손익 기준(opening) — system_config 한 키 (T-066 policy-store 패턴) */
export const BASELINE_KEY = 'cash_ledger_baseline';
/** 기록 안 된 입출금 후보의 '입출금 아님' 표시 — system_config 한 키 */
export const CANDIDATE_MARKS_KEY = 'cash_ledger_candidate_marks';
/** 기준 이력 보관 건수 */
export const BASELINE_HISTORY_LIMIT = 20;
/** 후보 표시 작업 기록(표시·되돌리기) 보관 건수 */
export const MARKS_LOG_LIMIT = 200;
/** 보관하는 '입출금 아님' 표시 최대 건수(오래된 것부터 정리) */
export const MARKS_LIMIT = 1_000;

/** 매칭 허용치 — 원화(원). 금액 × 0.1% 와 1,000원 중 큰 값 */
export function tolKrwFor(amountKrw: number, rules: LedgerRules = RULE): number {
  return Math.max(rules.tolKrw, (Math.abs(amountKrw) * rules.tolPct) / 100);
}

/** 매칭 허용치 — 달러($). 금액 × 0.1% 와 $1 중 큰 값 */
export function tolUsdFor(amountUsd: number, rules: LedgerRules = RULE): number {
  return Math.max(rules.tolUsd, (Math.abs(amountUsd) * rules.tolPct) / 100);
}

function groupInt(n: number): string {
  return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 후보 카드에 그대로 인쇄하는 알림 기준 문장 (데모 candHtml 의 `.rule` 문장과 같다) */
export function candidateRuleSentence(rules: LedgerRules = RULE): string {
  return `알림 기준: 보유 수량이 그대로인데 원화 현금이 ${groupInt(rules.krw)}원 이상, 또는 달러 현금이 $${rules.usd} 이상 바뀐 스냅샷. `
    + '매매·배당·이자일 수도 있어 자동으로 기록하지 않습니다.';
}
