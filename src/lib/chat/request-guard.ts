/**
 * T-169 Reviewer M1 — 비서 채팅 요청 본문 상한(draft·messages route 공통).
 *
 * 요약(≤ 3,200자)·지시(≤ 1,200자)는 서버가 막지만 사용자가 붙여넣는 질문·다듬은 질문과 클라이언트가 되돌려 보내는 첨부 종목은
 * 상한이 없어 프롬프트가 `num_ctx` 8192 를 넘길 수 있었다. 보안 상한이 아니라 답변 품질·잘림 방지다.
 *  - `content`(질문 원문)·`draftPrompt`(다듬은 질문): 각각 {@link CHAT_TEXT_MAX_CHARS}자(유니코드 글자 수, 앞뒤 공백 제외) — 넘으면 400 +
 *    화면의 기존 오류 띠가 그대로 보여 주는 한국어 `error`(ChatPage `classifyChatResponse` 는 `error` 문자열을 그대로 쓴다).
 *  - `attachedContext`(draft 응답을 되돌려 보내는 종목 첨부): 배열 최대 {@link ATTACHED_CONTEXT_MAX}개, 항목마다 필드 타입 검증.
 *    하나라도 어긋나면 그 값 전체를 버리고 서버가 다시 계산한다(예전에는 `symbol` 이 문자열이 아니면 500). 통과한 항목도 알려진 필드만 남긴다.
 */
import type { SymbolContext } from './context-builder';

export const CHAT_TEXT_MAX_CHARS = 2_000;
export const ATTACHED_CONTEXT_MAX = 3;
const SYMBOL_MAX_CHARS = 32;
const NAME_MAX_CHARS = 64;

/** 유니코드 글자 수(이모지·보조 평면 글자를 2로 세지 않는다) */
export function charCount(s: string): number {
  return Array.from(s).length;
}

/** 상한 초과 오류 문구 — 화면 오류 띠에 그대로 나온다 */
export function textTooLongError(field: 'content' | 'draftPrompt', length: number): string {
  const what = field === 'content' ? '질문' : '다듬은 질문';
  return `${what}이 너무 깁니다. ${CHAT_TEXT_MAX_CHARS.toLocaleString('ko-KR')}자 이하로 줄여 다시 보내 주세요. (지금 ${length.toLocaleString('ko-KR')}자)`;
}

/** 문자열 본문 꺼내기 — 문자열이 아니면(숫자·객체 등) 없는 것으로 본다(예전에는 `.trim()` 에서 500). */
export function bodyText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** 상한 검사 — 넘는 첫 필드의 오류 문구, 없으면 null */
export function checkChatTextLimits(fields: { content?: string; draftPrompt?: string }): string | null {
  for (const field of ['content', 'draftPrompt'] as const) {
    const v = fields[field];
    if (typeof v !== 'string') continue;
    const n = charCount(v);
    if (n > CHAT_TEXT_MAX_CHARS) return textTooLongError(field, n);
  }
  return null;
}

const REQUIRED_NUMBERS = ['price', 'priceChange5'] as const;
const NULLABLE_NUMBERS = ['priceUsd', 'rsi14', 'ema20', 'ema60', 'macdHistogram', 'atrPct', 'high24h', 'low24h'] as const;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 항목 하나 — 통과하면 알려진 필드만 담은 새 객체, 어긋나면 null */
function validContextItem(v: unknown): SymbolContext | null {
  if (!isPlainObject(v)) return null;
  const { symbol, name, matchedText } = v;
  if (typeof symbol !== 'string' || symbol.length === 0 || symbol.length > SYMBOL_MAX_CHARS) return null;
  if (typeof name !== 'string' || name.length > NAME_MAX_CHARS) return null;
  if (matchedText !== undefined && matchedText !== null && (typeof matchedText !== 'string' || matchedText.length > NAME_MAX_CHARS)) return null;
  for (const k of REQUIRED_NUMBERS) if (!isFiniteNumber(v[k])) return null;
  for (const k of NULLABLE_NUMBERS) {
    const x = v[k];
    if (x !== undefined && x !== null && !isFiniteNumber(x)) return null;
  }
  const num = (k: (typeof NULLABLE_NUMBERS)[number]) => (isFiniteNumber(v[k]) ? (v[k] as number) : null);
  return {
    symbol,
    name,
    ...(typeof matchedText === 'string' ? { matchedText } : {}),
    price: v.price as number,
    priceUsd: num('priceUsd'),
    priceChange5: v.priceChange5 as number,
    rsi14: num('rsi14'),
    ema20: num('ema20'),
    ema60: num('ema60'),
    macdHistogram: num('macdHistogram'),
    atrPct: num('atrPct'),
    high24h: num('high24h') ?? undefined,
    low24h: num('low24h') ?? undefined,
  };
}

/** 명시 첨부 심볼(`attachedSymbols`) — 배열이 아니면 없음, 문자열·길이 {@link SYMBOL_MAX_CHARS} 이하만, 최대 {@link ATTACHED_CONTEXT_MAX}개 */
export function explicitSymbols(v: unknown): { symbol: string; name: string; matchedText: string }[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length <= SYMBOL_MAX_CHARS)
    .slice(0, ATTACHED_CONTEXT_MAX)
    .map((s) => ({ symbol: s, name: s, matchedText: s }));
}

/**
 * 클라이언트가 되돌려 보낸 `attachedContext` 검증 — 1~{@link ATTACHED_CONTEXT_MAX}개이고 모든 항목이 통과하면 정리한 배열,
 * 아니면 null(호출부가 서버에서 다시 계산한다). 빈 배열·없음도 null.
 */
export function validAttachedContext(v: unknown): SymbolContext[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > ATTACHED_CONTEXT_MAX) return null;
  const out: SymbolContext[] = [];
  for (const item of v) {
    const ok = validContextItem(item);
    if (!ok) return null;
    out.push(ok);
  }
  return out;
}
