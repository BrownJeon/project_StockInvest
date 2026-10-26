/**
 * T-096 P3 일봉 백테스트 — 공용 타입(사전 등록 v1.0 §C-1 계약).
 *
 * 이 폴더(`src/lib/profit-engine/backtest/`)는 **연구 전용 순수 계산**이다: DB·파일·네트워크·환경변수·시계를 쓰지 않는다.
 * 입력은 호출자가 넘긴 일봉(Frame)과 사전 등록 값(registry)뿐이다. 앱 매매 경로와 격리(`__tests__/isolation.test.ts`).
 *
 * §C-1 과 다른 점(보고 대상): ExitKind 에 'unfilled'(지정가 미체결, 민감도 모델 전용)를 더했고,
 * d1openFill/limitFill 은 보유 창이 데이터 끝을 넘으면 Fill 대신 null(= 아직 청산되지 않은 에피소드)을 돌려준다.
 */

export type Market = 'US' | 'KR';

export interface Bar {
  date: string;            // 'YYYY-MM-DD' 거래소 현지 거래일
  open: number;            // 결측은 NaN (거래 불가일로 처리)
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number | null; // 거래대금(현지 통화) — counts 단계는 읽지 않는다(null)
  flags: string | null;    // daily_bars.flags 원문(쉼표 목록)
}

export interface Frame {
  market: Market;
  symbol: string;
  bars: Bar[];             // 날짜 오름차순
  excluded: boolean[];     // adj_stale | adj_orphan — 빈틈 처리(신호·체결·기준선에 쓰지 않음)
  corpSuspect: boolean[];  // corp_action_suspect — 포함하되 별도 표
}

export type ParamValue = number | boolean;
export type Params = Record<string, ParamValue>;

export interface StrategySpec {
  id: string;
  tier: 'A' | 'B' | 'control';
  params: Params;
  grid: Record<string, ParamValue[]>;
  rank: (f: Frame, i: number) => number;
}

/** score 는 우선순위 키 — **작을수록 먼저**(동률은 종목 코드 사전순). */
export interface Signal {
  symbol: string;
  d0: string;
  d0Index: number;
  score: number;
  note?: string;
}

export type ExitKind = 'time' | 'stop' | 'gap_skip' | 'liquidity_skip' | 'price_skip' | 'unfilled';

export interface Fill {
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  exitKind: ExitKind;
  grossRet: number;        // 비용 전 (건너뜀이면 0)
  netRet: number;          // 비용 후 (건너뜀이면 0)
}

export interface Episode {
  signal: Signal;
  fill: Fill | null;                      // null = 보유 창이 데이터 끝을 넘음(미청산)
  horizonRets: Record<number, number>;    // d1open, 비용 전
  excess: Record<number, number>;         // horizonRets − 같은 D0 유니버스 평균(비용 전)
  week: string;                           // D0 가 속한 주의 월요일
  corpSuspect: boolean;
}

/** 비용 모델 — 왕복 = feeRoundTrip + slippage, 손절 = feeRoundTrip + stopSlippage (§B-4). */
export interface CostModel {
  feeRoundTrip: number;
  slippage: number;
  stopSlippage: number;
}

export interface Series {
  dates: string[];
  values: number[];
}

export interface PortfolioConfig {
  capital: number;
  slots: number;
  slotPct: number;
  hold: number;
  stopPct: number | null;
  cost: CostModel;
  gapUp: number;
  gapDown: number;
  gapBoundary: 'skip' | 'enter';
  adtvWindow: number;
  adtvMaxShare: number;
  integerShares: boolean;  // registry portfolio.integerShares — false 면 분수 주식(시험·민감도용)
  /** 재발화 차단(v1.1 ⑧): 종목별 마지막 에피소드 시작 D0 뒤 이 거래일 수 안의 신호는 후보에서 뺀다(= max(windowDays, hold)). 0 이면 끔. */
  cooldownBars: number;
  startDate: string;       // 이 날짜(포함)부터 신호를 받는다
  endDate: string;         // 이 날짜(포함)까지 평가
}

export interface Trade {
  symbol: string;
  d0: string;
  entryDate: string;
  entryPrice: number;
  shares: number;
  exitDate: string;
  exitPrice: number;
  exitKind: 'time' | 'stop';
  pnl: number;             // 비용 후 현금 손익
  netRet: number;
}

export interface FoldWindow {
  trainTo: string;
  testFrom: string;
  testTo: string;
}
