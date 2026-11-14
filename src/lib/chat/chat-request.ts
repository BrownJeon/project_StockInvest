/**
 * T-169 — 비서 채팅 LLM 요청 조립(route 2곳과 스모크 하네스가 같은 함수를 쓴다).
 *
 * - 지시(system)와 본문(user)을 **나눠서** 돌려준다 — `runLlm(user, { system, numCtx: CHAT_NUM_CTX })`.
 *   home-m4-api 는 첫 메시지가 system 이 아니면 「시그널 평가·JSON 단일 객체」 지시를 자동으로 붙인다(분석가 채팅 JSON 답의 원인).
 * - 프롬프트 예산(B2): system ≤ 1,200자 · 수집 데이터 요약 ≤ 2,500자 · 최근 대화 8개 × 300자 · 종목 첨부 ≤ 3개.
 */
import type { LlmProvider, LlmProviderConfig } from '@/lib/llm/types';
import type { AnalystStyle, StyleConfig } from '@/lib/strategy/style';
import { normalizeChatAnswer } from './answer-format';
import {
  buildAnalystSystemPrompt,
  buildAnalystUserMessage,
  buildDrafterSystemPrompt,
  buildDrafterUserMessage,
} from './system-prompt';

/** Ollama num_ctx — qwen2.5 지원 범위 안. 요약·대화가 붙어 기본 컨텍스트에서 앞부분(system)이 잘리지 않게 한다. */
export const CHAT_NUM_CTX = 8192;
/** 최근 대화 개수·메시지당 글자 수(B2) */
export const CHAT_HISTORY_LIMIT = 8;
export const CHAT_HISTORY_CHARS = 300;
const DEFAULT_LOCAL_MODEL = 'qwen2.5:14b-instruct';

export interface ChatLlmRequest {
  system: string;
  user: string;
}

export interface ChatStyleInput {
  analystStyle: AnalystStyle;
  style: StyleConfig;
}

export function buildDrafterRequest(
  input: ChatStyleInput & { userInput: string; attachedSummary: string; recentMessages?: string },
): ChatLlmRequest {
  const ctx = {
    analystStyle: input.analystStyle,
    style: input.style,
    attachedSummary: input.attachedSummary,
    recentMessages: input.recentMessages ?? '',
  };
  return {
    system: buildDrafterSystemPrompt(ctx),
    user: buildDrafterUserMessage(input.userInput, input.attachedSummary),
  };
}

export function buildAnalystRequest(
  input: ChatStyleInput & { refinedPrompt: string; attachedSummary: string; recentMessages: string; overviewText: string },
): ChatLlmRequest {
  const ctx = {
    analystStyle: input.analystStyle,
    style: input.style,
    attachedSummary: input.attachedSummary,
    recentMessages: input.recentMessages,
  };
  return {
    system: buildAnalystSystemPrompt(ctx),
    user: buildAnalystUserMessage(input.refinedPrompt, input.attachedSummary, input.recentMessages, input.overviewText),
  };
}

/**
 * 최근 대화(오래된 → 최신) → 프롬프트 글. assistant 메시지는 표시용 정규화를 거친다 — 예전에 저장된 JSON 답이 그대로 들어가면
 * 모델이 다시 JSON 으로 답하기 쉽다(DB 원본은 그대로).
 */
export function formatRecentMessages(
  rowsOldestFirst: ReadonlyArray<Record<string, unknown>>,
  perMessageChars = CHAT_HISTORY_CHARS,
): string {
  return rowsOldestFirst
    .map((r) => {
      const isUser = r.role === 'user';
      const text = isUser ? String(r.content ?? '') : normalizeChatAnswer(String(r.content ?? ''));
      return `${isUser ? '사용자' : '비서'}: ${text.slice(0, perMessageChars)}`;
    })
    .join('\n');
}

/**
 * T-169 A5 — 실제로 호출한 모델 이름(기록·응답용). hybrid 의 채팅 호출은 stage 1(홈서버)이라 `stage1_model` 이 실제 모델이다
 * (예전에는 `home_m4_api_model` 을 적었다). claude 는 route 가 고른 모델(sonnet|opus|haiku).
 */
export function chatModelLabel(
  provider: LlmProvider,
  cfg: Pick<LlmProviderConfig, 'homeM4ApiModel' | 'stage1Model'>,
  claudeModel: string,
): string {
  if (provider === 'hybrid') return cfg.stage1Model ?? DEFAULT_LOCAL_MODEL;
  if (provider === 'home-m4-api') return cfg.homeM4ApiModel ?? DEFAULT_LOCAL_MODEL;
  return claudeModel;
}
