/**
 * Phase H — 분석가 채팅 시스템 프롬프트.
 *
 * 두 가지 프롬프트:
 *  (A) 분석가 본 응답 — 사용자 정제 프롬프트 + 첨부 컨텍스트로 구체 답변 생성
 *  (B) 프롬프트 빌더(Drafter) — 사용자 자유 질의를 정제된 프롬프트로 다듬어 사용자 검토용으로 반환
 */
import type { AnalystStyle, StyleConfig } from '@/lib/strategy/style';

export interface PromptContext {
  analystStyle: AnalystStyle;
  style: StyleConfig;
  attachedSummary: string;  // 첨부 종목 시세·지표 텍스트 요약
  recentMessages: string;   // 최근 N개 대화 (role: text 형식)
}

export function buildAnalystSystemPrompt(ctx: PromptContext): string {
  const { analystStyle, style } = ctx;
  return `당신은 한국·미국 주식 시장에 특화된 퀀트 분석가입니다.
사용자가 종목·섹터·전망에 대해 자유롭게 질의하면 다음 원칙으로 답하세요:

1. 첨부된 종목 컨텍스트(시세·RSI/EMA/MACD·5봉 변화율)가 있으면 우선 활용해 구체 수치로 답하세요.
2. 컨텍스트가 부족하면 데이터 부재를 명시하고 일반론으로 답하지 말고 "어떤 데이터가 있으면 더 정확한 답이 가능합니다" 식으로 보완 요청하세요.
3. 매수·매도 추천은 "지금 바로 매수" 같은 단정형보다 "RSI X·추세 Y 기준 P_win 추정 N% — 보유 기간 M일 기준 적정"처럼 조건과 근거를 제시하세요.
4. 사용자 투자 성향(현재: ${analystStyle}, 보유기간 ${style.holdingPeriodDays.min}~${style.holdingPeriodDays.max}일, 목표 +${style.targetProfitPct}%)에 맞춰 답하세요.
5. 회계연도·실적 발표 같은 최신 펀더멘털 데이터는 부재함을 인정하세요 (홈서버 뉴스 통합 전).
6. 답변은 한국어로, 마크다운 사용 가능. 핵심 결론을 첫 줄에 두세요.`;
}

export function buildDrafterSystemPrompt(ctx: PromptContext): string {
  const { analystStyle, style } = ctx;
  return `당신은 사용자의 자유 질의를 받아, 분석가 LLM이 가장 양질의 답을 낼 수 있도록 **정제된 프롬프트**를 생성합니다.

규칙:
1. 사용자 원문에 모호함이 있으면 첨부 컨텍스트(시세·RSI/EMA/MACD)를 활용해 명확화하세요.
2. 매수 추천 질의면 "(1) P_win/R_win/R_loss 가정 (2) 손절가 (3) 핵심 위험 3가지" 같은 구조로 분리.
3. 일반 질의(전망·뉴스 요약 등)면 사용자 의도를 그대로 유지하되 첨부 데이터의 핵심 수치를 본문에 포함.
4. 출력은 정제된 프롬프트 텍스트만 (마크다운 OK, 메타 설명·따옴표·"여기 정제된..." 같은 prefix 금지).
5. 사용자 투자 성향(${analystStyle}, 보유기간 ${style.holdingPeriodDays.min}~${style.holdingPeriodDays.max}일, 목표 +${style.targetProfitPct}%)에 맞춘 보유 기간·목표 수익률을 prepend하세요.
6. 한국어로 작성. 길이는 200~600자 권장.`;
}

/** drafter LLM에 보낼 최종 user 메시지 (system + this = full prompt) */
export function buildDrafterUserMessage(userInput: string, attachedSummary: string): string {
  const ctx = attachedSummary.trim().length > 0
    ? `\n\n## 첨부 컨텍스트\n${attachedSummary}\n`
    : '';
  return `## 사용자 원문\n${userInput.trim()}${ctx}\n\n위 정보를 바탕으로 정제된 프롬프트만 출력하세요.`;
}

/** analyst LLM에 보낼 최종 user 메시지 — 정제된 프롬프트 + 최근 대화 + 첨부 */
export function buildAnalystUserMessage(refinedPrompt: string, attachedSummary: string, recentMessages: string): string {
  const parts: string[] = [];
  if (recentMessages.trim().length > 0) {
    parts.push(`## 최근 대화\n${recentMessages}`);
  }
  if (attachedSummary.trim().length > 0) {
    parts.push(`## 첨부 컨텍스트\n${attachedSummary}`);
  }
  parts.push(`## 질의\n${refinedPrompt.trim()}`);
  return parts.join('\n\n');
}
