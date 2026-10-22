/**
 * T-066 리스크 정책 — 기본값·읽기 전용 정책 상수 (서버·클라이언트 공용, 순수 모듈).
 *
 * 저장소는 `system_config.risk_policy` 한 키이며 **편집 가능한 3값 + version·updatedAt·history** 만 쓴다.
 * 아래 읽기 전용 값·출처 배지는 DB 에 저장하지 않고 응답할 때마다 이 상수에서 채운다
 * (사용자가 곧 바꿀 수 있는 값이 첫 저장 시점 값으로 DB 에 굳지 않게 — Leader 명세 조정 2026-10-22).
 *
 * 이 모듈·`compute.ts`·`policy-store.ts` 는 **표시·위험 계산 전용**이다.
 * 청산 엔진(exit-engine)·시그널·안전장치 경로는 이 값을 읽지 않는다 — 주문·매도에 쓰이지 않는다.
 * (T-068: 손절가 도달 텔레그램 알림 cron 이 손절폭·기준가를 읽어 **알림만** 보낸다 — 주문·매도 없음.)
 */

export type StopBasis = 'avg' | 'peak';

/** 편집 가능한 정책 값 3개 */
export interface RiskPolicyEditable {
  /** 손절폭 % — 모든 보유 종목 공통 */
  stopPct: number;
  /** 손실 손절 합 한도 % — 총자산 대비 (한 번에 감내할 손실) */
  heatCapPct: number;
  /** 손절 기준가 — 평균단가(avg) / 보유 중 고점(peak) */
  stopBasis: StopBasis;
}

export type PolicySource = 'user' | 'proposal' | 'doc';

export interface RiskPolicyReadOnly {
  maxHoldings: number;
  marketPriority: ('overseas' | 'domestic')[];
  tradeRiskPct: number;
  /**
   * 현금 하한 — **규칙 없음**(null). 현금 비중은 정보로만 보인다(T-068, 2026-10-22 사용자 확정 "권고대로 처리").
   * 문서 정책(trading-strategy.md §5)의 10% 는 코드로 집행된 적이 없어 경고·미달 표시를 하지 않는다.
   */
  cashFloorPct: null;
  symbolMaxPct: number;
  weeklyLossPct: number;
  monthlyLossPct: number;
  annualLossPct: number;
  /** 분할 매수 최대 횟수 — 비율은 고정하지 않는다(구간·수량은 시나리오에서 정함, T-068) */
  splitBuy: { max: number };
}

export type RiskPolicySources = Record<keyof RiskPolicyReadOnly | keyof RiskPolicyEditable, PolicySource>;

/**
 * 분할 매수 정책과 비교해 보이는 **실제 집행 값** (GET /api/settings/risk-policy 의 `execution`, T-068 WP-A).
 * 값은 서버가 집행 경로의 출처에서 읽어 채운다 — 이 모듈은 타입만 정의한다.
 */
export interface RiskExecutionLimits {
  /** 시나리오 확정 요청 1회당 조각 상한 (`MAX_SCENARIO_SPLITS`, 시장 무관) */
  scenarioSplitCap: number;
  /** 국내 룰 엔진 같은 종목 24시간 매수 주문 한도 (`maxPositionsPerSymbol`) — 읽지 못하면 null */
  domesticMaxBuysPerSymbol24h: number | null;
}

/** 정책이 아직 저장되지 않았을 때의 제안값 (손절폭 3% 제안 · 한도 2% 사용자 확정 · 평균단가 권고) */
export const DEFAULT_EDITABLE: Readonly<RiskPolicyEditable> = Object.freeze({
  stopPct: 3,
  heatCapPct: 2,
  stopBasis: 'avg',
});

/** 읽기 전용 정책 — 변경은 사용자 승인 후 코드로 반영한다. */
export const READ_ONLY_POLICY: Readonly<RiskPolicyReadOnly> = Object.freeze({
  maxHoldings: 10,
  marketPriority: ['overseas', 'domestic'],
  tradeRiskPct: 0.25,
  // T-068(2026-10-22 사용자 확정): 현금 하한 규칙 없음 — 현금 비중은 정보 표시만.
  cashFloorPct: null,
  symbolMaxPct: 15,
  weeklyLossPct: -3,
  monthlyLossPct: -5,
  annualLossPct: -15,
  // T-068(2026-10-22 사용자 확정): 분할 최대 3회(40/30/30 제안) → 4회, 비율 표기 없음.
  // 시나리오 빌더가 1~4분할을 고르고, 서버는 확정 1회당 조각을 MAX_SCENARIO_SPLITS(=4)로 막는다.
  // 화면은 이 값과 실제 집행 값(GET 응답 `execution`)이 다르면 그 줄에 '정책과 다름'을 보인다.
  splitBuy: { max: 4 },
}) as Readonly<RiskPolicyReadOnly>;

/** 출처 배지 — user: 사용자 확정 · proposal: 제안·승인 전 · doc: 문서 정책 */
export const POLICY_SOURCES: Readonly<RiskPolicySources> = Object.freeze({
  stopPct: 'proposal',
  heatCapPct: 'user',
  stopBasis: 'user',
  maxHoldings: 'user',
  marketPriority: 'user',
  tradeRiskPct: 'proposal',
  cashFloorPct: 'user',
  symbolMaxPct: 'proposal',
  weeklyLossPct: 'doc',
  monthlyLossPct: 'doc',
  annualLossPct: 'doc',
  splitBuy: 'user',
});

/** 입력 범위 (서버 검증·클라이언트 검증 공용) */
export const LIMITS = Object.freeze({
  stopPct: { min: 0.5, max: 20, warnAbove: 10 },
  heatCapPct: { min: 0.5, max: 10 },
});

/** 스냅샷 오래됨 기준 — 3시간 초과 */
export const SNAPSHOT_STALE_MS = 3 * 60 * 60 * 1000;

/** 클라이언트 재조회 주기 */
export const POLL_INTERVAL_MS = 60_000;

/** 저장 JSON 의 변경 이력 보관 건수 */
export const HISTORY_LIMIT = 20;

/** system_config 키 (safety_ 접두 금지 — 안전장치 키와 구분) */
export const RISK_POLICY_KEY = 'risk_policy';

/** 자동 청산 엔진의 기본 하드 손절 % (안내 문구용 — 엔진 설정을 읽지 않는다) */
export const EXIT_ENGINE_DEFAULT_HARD_STOP_PCT = 1.5;
