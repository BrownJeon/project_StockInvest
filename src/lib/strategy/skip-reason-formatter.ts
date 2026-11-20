/**
 * Skip 사유 사용자 친화 포맷터.
 * AI/룰이 시그널을 거절했을 때 reasoning 텍스트를 한국어로 의미 있게 변환.
 *
 * 사용 시점: signals.reasoning INSERT 직전.
 * 원본 reasoning(보통 영어/중국어/JSON tail)이 보존되도록 prefix 형태로 추가만 함.
 */
import type { SkipCategory, Candidate } from './ai-filter';

export interface FormatSkipArgs {
  category: SkipCategory;
  side: 'buy' | 'sell';
  confidence: number;
  rawReasoning: string;
  /** 스타일별 임계 confidence (UI 가시화용) */
  minConfidence?: number;
  styleName?: string;
}

const CATEGORY_LABEL: Record<SkipCategory, { label: string; explain: (a: FormatSkipArgs) => string }> = {
  ai_failed: {
    label: 'AI 호출 실패',
    explain: () => 'AI 응답을 받지 못해 다음 평가 주기에 재시도합니다.',
  },
  ai_low_confidence: {
    label: 'AI 신뢰도 부족',
    explain: a => `AI 신뢰도 ${a.confidence}%${a.minConfidence != null ? ` < 임계 ${a.minConfidence}%` : ''}${a.styleName ? ` (${a.styleName})` : ''} — 진입 조건 미달`,
  },
  ai_rejected: {
    label: 'AI 거절',
    explain: a =>
      a.side === 'sell'
        ? `AI가 매도 시점이 아니라 판단 (현재 추세 유지 권고)`
        : `AI가 매수 시점이 아니라 판단 (룰 신호는 있었지만 위험 신호 우세)`,
  },
  rule_prefilter: {
    label: '룰 사전 차단',
    explain: () => '명백한 거절 패턴(유동성 고갈/과열 RSI/추세 역행 등)으로 AI 호출 전 차단',
  },
  dedup_reuse: {
    label: '중복 제거',
    explain: () => '최근 같은 시장 상태에서 동일 결정 — 재평가 생략 (TTL 내 같은 regime)',
  },
  portfolio_guard: {
    label: '포트폴리오 안전 가드',
    explain: () => '코어(KOSPI200 편입) 비율 미달 또는 종목당 24h 매수 한도 초과로 차단',
  },
  market_state_neutral: {
    label: '시장 상태 관망',
    explain: () => '현재 지표 상태가 뚜렷한 진입 카테고리에 해당하지 않음 — 신호 대기',
  },
};

/**
 * skip 사유를 사용자 친화 텍스트로 변환.
 * 출력: "[<라벨>] <설명> | (원본: <원본 reasoning 일부>)"
 *
 * 원본 reasoning은 디버깅 용도로 100자까지 보존.
 */
export function formatSkipReason(args: FormatSkipArgs): string {
  const meta = CATEGORY_LABEL[args.category];
  const sideKor = args.side === 'sell' ? '매도' : '매수';
  const explain = meta.explain(args);
  const rawTrimmed = (args.rawReasoning ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
  const rawNote = rawTrimmed ? ` | 모델 응답: "${rawTrimmed}"` : '';
  return `[${sideKor} ${meta.label}] ${explain}${rawNote}`;
}

/**
 * 룰 prefilter 거절 사유 별 사용자 친화 라벨.
 * (rule_prefilter 카테고리 안에서도 세부 reason이 다양)
 */
const PREFILTER_REASON_LABEL: Record<string, string> = {
  liquidity_dead: '유동성 고갈 (1시간+ 거래 없음)',
  atr_zero: '변동성 계산 불가 (ATR=0)',
  rsi_extreme_counter: '극단 RSI 역행 (매수 RSI≥90 / 매도 RSI≤10)',
  strong_counter_trend: '강한 하락 추세 + 큰 음봉',
  blowoff_top: '급등 후 과열 (Blow-off top)',
};

export function formatPrefilterReason(reason: string, detail: string, side: 'buy' | 'sell'): string {
  const label = PREFILTER_REASON_LABEL[reason] ?? reason;
  const sideKor = side === 'sell' ? '매도' : '매수';
  return `[${sideKor} 룰 사전 차단] ${label} — ${detail}`;
}

/**
 * Engine 측 silent skip 사유 (signals 테이블 미기록되던 path) 친화 메시지.
 * 추후 audit log INSERT 추가될 때 사용.
 */
export const SILENT_SKIP_REASONS = {
  sell_no_holding: (sym: string) => `[매도 차단] ${sym} 미보유 — 매도할 수량 없음`,
  sell_recent_submitted: (sym: string) => `[매도 차단] ${sym} 최근 60분 내 매도 시그널 이미 발화됨 (중복 방지)`,
  sell_value_mismatch: (sym: string, held: number, want: number) =>
    `[매도 차단] ${sym} 보유 가치 ${held.toLocaleString('ko-KR')} KRW < 매도 요청 ${want.toLocaleString('ko-KR')} KRW`,
  buy_held_already: (sym: string) => `[매수 차단] ${sym} 이미 보유 중 — 신규 매수 안 함 (분할 매수는 portfolio_stability 가드 통과 시만)`,
  buy_recent_sell: (sym: string, cooldownMin: number) =>
    `[매수 차단] ${sym} 최근 ${cooldownMin}분 내 매도 체결 — 재매수 쿨다운 중`,
} as const;
