/**
 * T-169 A4 — 비서(분석가 채팅) 답변 정규화. **어떤 경우에도 LLM 의 JSON 을 그대로 사용자에게 보여 주지 않는다**(사용자 결정).
 *
 * 규칙 ({@link normalizeChatAnswerDetailed} — 새 답·예전 답 공통)
 *  - 앞뒤 공백을 떼고, 답 전체를 감싼 코드펜스의 안이 JSON 이면 펜스를 뗀다.
 *  - 전체가(또는 펜스 안이) JSON 객체·배열로 파싱되면 문장으로 바꾼다: `answer|response|message|content|text|reasoning` 중
 *    첫 문자열 필드가 본문, `warnings`(문자열 배열)는 `참고: …` 줄. `selectedIndices`·`confidence`·`ev` 같은 수치 키는 읽지 않는다.
 *  - 파싱은 되는데 쓸 문자열이 없거나, `{` 로 시작하는데 파싱이 안 되면 고정 안내문({@link CHAT_ANSWER_FALLBACK}).
 *  - 문장 사이에 끼어 있는 JSON(펜스 블록·줄 머리 `{` 블록·문장 중간 조각)도 같은 규칙으로 바꾸거나 버린다 — 원본 JSON 을 그대로
 *    돌려주는 경로는 없다. 문장 중간 조각은 파싱되고 키가 1개 이상인 객체·객체를 담은 배열만 대상이고(`{RSI 30}`·`[1, 2]`·`{}` 는 그대로),
 *    코드 블록·인라인 코드 안은 건드리지 않는다. 지운 자리의 앞뒤 공백·남은 「라벨:」·빈 괄호를 정리한다(Reviewer M2).
 *  - 일반 문장은 그대로(앞뒤 공백·3줄 이상 빈 줄만 정리). JSON 이 아닌 코드펜스도 그대로 둔다.
 *
 * 새 답 전용 후처리 ({@link normalizeNewChatAnswer} = 정규화 + {@link finalizeNewChatAnswer}, Leader 결정 2026-11-14)
 *  - 승인 데모 구조(마크다운 기호 없음 · 끝 줄 = 참고용 고지 한 줄)를 코드로 보장한다: `**`·`__` 굵게 표시를 떼고(글자는 남김),
 *    줄 머리 `#` 제목 기호를 떼고, 마지막 줄이 {@link CHAT_DISCLAIMER} 가 아니면 덧붙인다.
 *  - 코드펜스 안 내용과 인라인 코드(`…`)는 건드리지 않는다(펜스 줄 자체만 뗀다). 홑 `*`(곱셈·수식)는 지우지 않는다.
 *  - **예전 답의 표시용 변환(messages GET)·LLM 에 다시 넣는 최근 대화에는 쓰지 않는다**(사용자 결정 D2 = 문장만). 고정 안내문에도 붙이지 않는다.
 *
 * 쓰는 곳: messages POST(저장 **전**, 새 답 후처리 포함), drafter 결과({@link cleanDraftPrompt}), messages GET(assistant 메시지 **표시용** —
 * 정규화만, DB 원본 불변), LLM 에 다시 넣는 최근 대화(assistant 메시지 — 예전 JSON 답이 다시 JSON 답을 부르지 않게).
 */

export const CHAT_ANSWER_FALLBACK = '답변을 대화 형식으로 만들지 못했습니다. 질문을 조금 바꿔 다시 보내 주세요.';
/** 비서 답 끝 줄 고지 — 승인 데모 v1 의 문구 그대로(`DISCLAIM`). 지시문(system-prompt.ts)도 이 상수를 쓴다. */
export const CHAT_DISCLAIMER = '이 내용은 이 시스템의 검증된 전략 판정이 아니라 참고용입니다.';
/** 모델이 고지를 조금 바꿔 쓴 줄(「…아닌 참고용…」 등)도 고지로 본다 — 홀로 선 짧은 줄일 때만 */
const DISCLAIMER_LINE_RE = /검증된\s*전략\s*판정이\s*아(?:니라|닌)\s*참고용/;
const DISCLAIMER_LINE_MAX = 80;

const BODY_KEYS = ['answer', 'response', 'message', 'content', 'text', 'reasoning'] as const;
/** 줄 머리 JSON 블록을 찾을 때 한 블록으로 이어 볼 최대 줄 수(답 길이가 비정상이어도 계산량을 묶는다). */
const MAX_BLOCK_LINES = 200;

/** `text` = 일반 문장 그대로 · `json` = JSON(일부 또는 전체)을 문장으로 바꿈 · `fallback` = 고정 안내문 */
export type ChatAnswerSource = 'text' | 'json' | 'fallback';

export interface NormalizedChatAnswer {
  text: string;
  source: ChatAnswerSource;
}

const FALLBACK: NormalizedChatAnswer = { text: CHAT_ANSWER_FALLBACK, source: 'fallback' };

function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * JSON 처럼 보이는 문자열(중첩 JSON 을 본문으로 내보내지 않기 위해). `{` 시작, `[{`·`["`·`[]` 시작, 또는 `[` 로 시작해 실제로
 * 파싱되는 값(`[0,1]`). `[1] 첫째 후보…`·`[요약] …` 같은 일반 문장은 JSON 이 아니다.
 */
function looksLikeJson(s: string): boolean {
  const t = s.trim();
  if (t.startsWith('{') || /^\[\s*[{"\]]/.test(t)) return true;
  return t.startsWith('[') && tryParseJson(t) !== undefined;
}

/** 문자열 본문 하나를 정리 — 그 자체가 JSON 이면 다시 문장으로, 깨진 JSON 이면 버린다. */
function cleanBodyString(s: string, depth: number): string | null {
  const t = s.trim();
  if (!t) return null;
  if (!looksLikeJson(t)) return t;
  const parsed = tryParseJson(t);
  return parsed === undefined ? null : jsonToSentence(parsed, depth + 1);
}

/** JSON 값 → 문장. 쓸 문자열이 없으면 null. */
function jsonToSentence(v: unknown, depth = 0): string | null {
  if (depth > 3) return null;
  if (typeof v === 'string') return cleanBodyString(v, depth);
  if (Array.isArray(v)) {
    const parts = v
      .map((x) => jsonToSentence(x, depth + 1))
      .filter((x): x is string => typeof x === 'string' && x.length > 0);
    return parts.length > 0 ? parts.join('\n') : null;
  }
  if (!isPlainObject(v)) return null;

  let body: string | null = null;
  for (const key of BODY_KEYS) {
    const val = v[key];
    if (typeof val === 'string') {
      body = cleanBodyString(val, depth);
    } else if (key === 'message' && isPlainObject(val) && typeof val.content === 'string') {
      body = cleanBodyString(val.content, depth);   // {"message":{"content":"…"}} 모양
    }
    if (body) break;
  }
  if (!body) return null;

  const warnings = Array.isArray(v.warnings)
    ? v.warnings
        .filter((w): w is string => typeof w === 'string')
        .map((w) => w.trim())
        .filter((w) => w.length > 0 && !looksLikeJson(w))
    : [];
  return warnings.length > 0 ? `${body}\n\n참고: ${warnings.join(' / ')}` : body;
}

/** 문장 사이의 펜스 블록 — JSON 이면 문장으로(쓸 글이 없으면 버림), 깨진 JSON 이면 버림, 그 밖은 펜스 기호만 뗀다. */
function replaceFencedBlocks(s: string): { text: string; usedJson: boolean } {
  let usedJson = false;
  const text = s.replace(/```[^\n`]*\n?([\s\S]*?)```/g, (m: string, inner: string) => {
    const t = inner.trim();
    if (looksLikeJson(t)) {
      usedJson = true;
      const parsed = tryParseJson(t);
      return parsed === undefined ? '' : (jsonToSentence(parsed) ?? '');
    }
    return m;   // JSON 이 아닌 코드펜스는 그대로(새 답은 finalizeNewChatAnswer 가 펜스 줄만 뗀다)
  });
  return { text, usedJson };
}

/** 펜스 여닫는 줄(``` 로 시작) */
const FENCE_LINE_RE = /^\s*```/;

/**
 * 줄 머리가 `{`(또는 `[{`·`["`)인 블록 — 이어지는 줄까지 붙여 JSON 으로 파싱되는 가장 짧은 블록을 문장으로 바꾼다.
 * 끝내 파싱되지 않는데 `{"키"` 모양으로 시작하면(잘린 JSON) 그 줄부터 빈 줄 전까지 버린다.
 */
function replaceBareJsonBlocks(s: string): { text: string; usedJson: boolean } {
  const lines = s.split('\n');
  const out: string[] = [];
  let usedJson = false;
  // 짝이 맞는 펜스 줄만 펜스로 본다 — 닫히지 않은 마지막 펜스(잘린 답) 뒤의 JSON 이 「펜스 안」으로 숨지 않게
  const fenceIdx = lines.map((l, i) => (FENCE_LINE_RE.test(l) ? i : -1)).filter((i) => i >= 0);
  const unclosed = fenceIdx.length % 2 === 1 ? fenceIdx[fenceIdx.length - 1] : -1;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].trimStart();
    if (i === unclosed) {
      if (/^```\s*json\s*$/i.test(head)) { usedJson = true; continue; }   // 닫히지 않은 json 펜스 줄은 버린다
    } else if (FENCE_LINE_RE.test(lines[i])) {
      inFence = !inFence;   // 펜스 안(JSON 이 아닌 코드)은 건드리지 않는다
    } else if (!inFence && (head.startsWith('{') || /^\[\s*[{"]/.test(head))) {
      let consumedTo = -1;
      for (let j = i; j < lines.length && j < i + MAX_BLOCK_LINES; j++) {
        const cand = lines.slice(i, j + 1).join('\n').trim();
        if (!cand.endsWith('}') && !cand.endsWith(']')) continue;
        const parsed = tryParseJson(cand);
        if (parsed !== undefined && typeof parsed === 'object' && parsed !== null) {
          const conv = jsonToSentence(parsed);
          if (conv) out.push(conv);
          consumedTo = j;
          break;
        }
      }
      if (consumedTo >= 0) {
        usedJson = true;
        i = consumedTo;
        continue;
      }
      // 줄 머리의 완결된 조각 뒤에 문장이 이어지면(「{"a":1} 뒤 문장」) 잘린 JSON 이 아니다 — 문장 중간 조각 단계가 처리한다
      const headEnd = matchBracket(head, 0);
      const headIsFragment = headEnd > 0 && tryParseJson(head.slice(0, headEnd + 1)) !== undefined;
      if (!headIsFragment && (/^[{[]\s*"/.test(head) || /^\{\s*$/.test(head))) {
        // 잘린·깨진 JSON — 그 줄과, 이어지는 「JSON 이어짐」 줄(따옴표 키·괄호·숫자·true/false/null 로 시작)만 버린다.
        // 그 밖의 다음 줄(문장)은 남긴다(QA F1 — 「다음 줄부터는 남기세요」).
        usedJson = true;
        while (i + 1 < lines.length && lines[i + 1].trim() !== '' && JSON_CONTINUATION_RE.test(lines[i + 1])) i++;
        continue;
      }
    }
    out.push(lines[i]);
  }
  return { text: out.join('\n'), usedJson };
}

/** 답변 정규화(출처 포함). */
export function normalizeChatAnswerDetailed(raw: unknown): NormalizedChatAnswer {
  if (typeof raw !== 'string') return FALLBACK;
  let s = raw.replace(/\r\n?/g, '\n').trim();
  if (!s) return FALLBACK;

  // 1) 답 전체가 펜스 하나 — 안이 비었으면 안내문, 안이 JSON(또는 `{` 시작)이면 펜스를 떼고 아래 JSON 규칙으로
  const whole = s.match(/^```[^\n`]*\n?([\s\S]*?)\n?```$/);
  if (whole && !whole[1].includes('```')) {
    const inner = whole[1].trim();
    if (!inner) return FALLBACK;
    if (inner.startsWith('{') || looksLikeJson(inner)) s = inner;
  }

  // 2) 답 전체가 JSON
  if (s.startsWith('{') || s.startsWith('[')) {
    const parsed = tryParseJson(s);
    if (parsed !== undefined) {
      const conv = jsonToSentence(parsed);
      return conv ? { text: conv, source: 'json' } : FALLBACK;
    }
    // 파싱이 안 되면(앞쪽만 JSON·잘린 JSON·`[요약] …` 같은 일반 문장) 아래 단계로 — 선행 조각만 지우고 뒤 문장을 살린다(QA F5).
    // 남는 문장이 없으면 그때 고정 안내문.
  }

  // 3) 문장 사이의 JSON — 펜스 블록 → 줄 머리 블록 → 문장 중간 조각(Reviewer M2)
  const fenced = replaceFencedBlocks(s);
  const bare = replaceBareJsonBlocks(fenced.text);
  const inline = replaceInlineJsonOutsideCode(bare.text);
  s = inline.text.replace(/\n{3,}/g, '\n\n').trim();
  // 안전망 — 처리 뒤에도 따옴표 키로 시작하는 JSON 이 머리에 남았거나 남은 글이 없으면 고정 안내문
  if (!s || JSON_KEY_START_RE.test(s)) return FALLBACK;
  return { text: s, source: fenced.usedJson || bare.usedJson || inline.usedJson ? 'json' : 'text' };
}

// ── 문장 중간 JSON 조각 (Reviewer M2 — 「어떤 경우에도 JSON 을 보여 주지 않는다」) ─────────────

/** 조각 표시(제어문자 — 원문에서 미리 지운다): 지운 자리 1글자 · 바꾼 문장의 여는/닫는 표시 */
const MARK = String.fromCharCode(1);
const CONV_OPEN = String.fromCharCode(3);
const CONV_CLOSE = String.fromCharCode(4);
const MARK_RE = new RegExp(`[${MARK}${CONV_OPEN}${CONV_CLOSE}]`, 'g');
/** 인라인 코드 자리표(제어문자 — 원문에서 미리 지운다) */
const INLINE = String.fromCharCode(2);
const INLINE_RE = new RegExp(INLINE, 'g');
/** 짝 맞추기 상한(답 길이가 비정상이어도 계산량을 묶는다) */
const MAX_FRAGMENT_CHARS = 4000;
/** JSON 시작 모양 — `{` 또는 `[{` 뒤에 따옴표 키와 `:` (QA F1). `{RSI 30`·`{ 가격 > 100` 같은 일반 중괄호는 아니다. */
const JSON_KEY_START_RE = /^(?:\{|\[\s*\{)\s*"[^"\n]*"\s*:/;
/** 잘린 줄 머리 JSON 다음에 이어지는 JSON 줄 — 따옴표·괄호로 시작하거나, 값 하나(숫자·true·false·null)만 있는 줄 */
const JSON_CONTINUATION_RE = /^\s*(?:["{}\[\]]|(?:-?\d+(?:\.\d+)?|true|false|null)\s*[,}\]]*\s*$)/;

/** 처리 대상 — 파싱되고 키가 1개 이상인 객체, 또는 객체를 하나 이상 담은 배열. `[1, 2]`·`{}`·문자열·숫자는 대상이 아니다. */
function isJsonFragmentTarget(v: unknown): boolean {
  if (isPlainObject(v)) return Object.keys(v).length > 0;
  return Array.isArray(v) && v.some((x) => isPlainObject(x));
}

/** `s[i]` 가 `{`·`[` 일 때 짝이 맞는 닫는 위치(JSON 문자열 안의 괄호·이스케이프는 건너뜀). 짝이 안 맞으면 -1. */
function matchBracket(s: string, i: number): number {
  const stack: string[] = [];
  let inStr = false;
  for (let j = i; j < s.length && j - i < MAX_FRAGMENT_CHARS; j++) {
    const ch = s[j];
    if (inStr) {
      if (ch === '\\') j++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return j;
    }
  }
  return -1;
}

/** 한 덩이(코드 밖 글)에서 조각을 찾아 「문장」 또는 「지움 표시」로 바꾼 뒤 앞뒤 공백·문장부호를 정리한다. */
function replaceInlineJsonInText(seg: string): { text: string; usedJson: boolean } {
  let out = '';
  let usedJson = false;
  for (let i = 0; i < seg.length; i++) {
    const ch = seg[i];
    if (ch === '{' || ch === '[') {
      const end = matchBracket(seg, i);
      const keyStart = JSON_KEY_START_RE.test(seg.slice(i, i + 200));
      if (end < 0 && keyStart) {
        // 닫히지 않은 JSON 시작 조각(`{"키":` · `[{"키":`) — 그 위치부터 그 줄 끝까지 지운다(다음 줄은 남긴다, QA F1)
        const lineEnd = seg.indexOf('\n', i);
        out += MARK;
        usedJson = true;
        i = (lineEnd < 0 ? seg.length : lineEnd) - 1;
        continue;
      }
      if (end > i) {
        const parsed = tryParseJson(seg.slice(i, end + 1));
        if (parsed === undefined && keyStart) {
          // 괄호 짝은 맞지만 파싱이 안 되는 JSON 모양(`{"a": }`) — 그 조각만 지운다
          out += MARK;
          usedJson = true;
          i = end;
          continue;
        }
        if (parsed !== undefined && isJsonFragmentTarget(parsed)) {
          const conv = jsonToSentence(parsed);
          // 쓸 문자열이 있으면 그 문장(한 줄로), 없으면 지움 표시
          // (JSON 문자열의 \u 이스케이프로 표시 문자가 들어올 수 있어 지운다)
          const flat = conv ? conv.replace(MARK_RE, '').replace(INLINE_RE, '').replace(/\s*\n+\s*/g, ' ') : '';
          out += flat ? `${CONV_OPEN}${flat}${CONV_CLOSE}` : MARK;
          usedJson = true;
          i = end;
          continue;
        }
      }
    }
    out += ch;
  }
  if (!usedJson) return { text: seg, usedJson };
  const R = MARK;
  const text = out
    // 바꾼 문장: 왼쪽에 공백이 있었으면 한 칸만 남긴다
    .replace(new RegExp(`([ \\t]*)${CONV_OPEN}([^${CONV_CLOSE}]*)${CONV_CLOSE}`, 'g'), (_m, sp: string, c: string) => `${sp ? ' ' : ''}${c}`)
    // 지운 자리: 괄호만 남은 「( )」 → 지움 표시
    .replace(new RegExp(`\\(\\s*${R}\\s*\\)`, 'g'), R)
    // 줄 끝에 남은 「라벨:」·「=」 → 라벨 쪽 기호까지 지운다(「추천: [...]」 → 「추천」)
    .replace(new RegExp(`[ \\t]*[:：=][ \\t]*${R}(?=[ \\t]*(?:\\n|$))`, 'g'), '')
    // 문장부호·줄 끝 앞 → 공백 없이
    .replace(new RegExp(`[ \\t]*${R}[ \\t]*(?=[.,!?;:)\\]」』。]|\\n|$)`, 'g'), '')
    // 줄 머리 → 공백 없이
    .replace(new RegExp(`(^|\\n)[ \\t]*${R}[ \\t]*`, 'g'), '$1')
    // 문장 가운데 → 한 칸
    .replace(new RegExp(`[ \\t]*${R}[ \\t]*`, 'g'), ' ');
  return { text: text.replace(MARK_RE, ''), usedJson };
}

/** 코드 블록(짝 맞는 펜스)과 인라인 코드 안은 건드리지 않고(기존 규칙), 그 밖의 글에서만 조각을 처리한다. */
function replaceInlineJsonOutsideCode(text: string): { text: string; usedJson: boolean } {
  let usedJson = false;
  const cleaned = text.replace(MARK_RE, '').replace(INLINE_RE, '');
  const out = splitFences(cleaned, true).map((p) => {
    if (p.code) return p.text;
    // 인라인 코드는 자리표(조각 표시와 다른 제어문자)로 감싸 보호한다
    const inline: string[] = [];
    const protectedSeg = p.text.replace(/`[^`\n]+`/g, (m) => {
      inline.push(m);
      return `${INLINE}${inline.length - 1}${INLINE}`;
    });
    const r = replaceInlineJsonInText(protectedSeg);
    if (r.usedJson) usedJson = true;
    return r.text.replace(new RegExp(`${INLINE}(\\d+)${INLINE}`, 'g'), (_m, n: string) => inline[Number(n)]);
  }).join('');
  return { text: out, usedJson };
}

/** 답변 정규화 — 화면·DB 에 쓸 문장만. */
export function normalizeChatAnswer(raw: unknown): string {
  return normalizeChatAnswerDetailed(raw).text;
}

/**
 * drafter(질문 다듬기) 결과 정리 — 일반 문장이면 정리한 문장, JSON 이 섞였거나 비었으면 **사용자 원문 질문**으로 대체한다
 * (JSON 의 reasoning 은 다듬은 질문이 아니라 메타 설명이라 질문으로 쓸 수 없다).
 */
export function cleanDraftPrompt(raw: unknown, userContent: string): string {
  const n = normalizeChatAnswerDetailed(raw);
  return n.source === 'text' ? n.text : userContent.trim();
}

// ── 새 답 전용 후처리 ───────────────────────────────────────────────────────

/** 펜스 밖 글에서만: 인라인 코드는 자리표로 감싸 보호하고, 굵게 표시·제목 기호를 뗀다. */
function stripMarkdownOutsideCode(seg: string): string {
  const inline: string[] = [];
  let s = seg.replace(/`[^`\n]+`/g, (m) => {
    inline.push(m);
    return `\u0000${inline.length - 1}\u0000`;
  });
  // `**글자**` → 글자. 수식 보호: 여는 표시 앞이 영문·숫자(`x**2`·`2**3`)이거나 여는 표시 뒤·닫는 표시 앞이 공백(`a ** b`)이면
  // 굵게가 아니다. 홑 `*`(곱셈 `3 * 4`·`a*b`)는 건드리지 않는다.
  s = s.replace(/(^|[^\w*])\*\*(?=[^\s*])([^\n]*?[^\s*])\*\*(?![\w*])/g, '$1$2');
  // `__글자__` → 글자. 앞뒤가 영문·숫자면 식별자(`a__b__c`)라 건드리지 않는다.
  s = s.replace(/(^|[^\w])__(?=[^\s_])([^\n]*?[^\s_])__(?!\w)/g, '$1$2');
  // 줄 머리 `#` 제목 기호(`# 제목`·`### 제목`, 기호만 있는 줄). `#1` 처럼 바로 붙은 글자는 제목이 아니다.
  s = s.replace(/^[ \t]{0,3}#{1,6}(?:[ \t]+|$)/gm, '');
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => inline[Number(i)]);
}

/**
 * 짝이 맞는 펜스 블록과 그 밖을 나눈다. 닫히지 않은 펜스는 밖(글)으로 본다.
 * `keepFence` 가 false(새 답 후처리)면 코드 조각은 펜스 줄을 뗀 안 내용, true(정규화)면 펜스까지 원문 그대로.
 */
function splitFences(text: string, keepFence = false): { code: boolean; text: string }[] {
  const parts: { code: boolean; text: string }[] = [];
  const re = /^[ \t]*```[^\n]*\n([\s\S]*?)\n?[ \t]*```[ \t]*$/gm;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ code: false, text: text.slice(last, at) });
    parts.push({ code: true, text: keepFence ? m[0] : m[1] });   // 후처리: 펜스 줄은 떼고 안의 내용은 그대로 · 정규화: 원문 그대로
    last = at + m[0].length;
  }
  if (last < text.length) parts.push({ code: false, text: text.slice(last) });
  return parts;
}

/**
 * 새 답 후처리 — 승인 데모 구조를 코드로 보장한다(마크다운 굵게·제목 기호 없음, 끝 줄 = {@link CHAT_DISCLAIMER} 한 줄).
 * 홀로 선 고지 줄(조금 바꿔 쓴 것 포함)은 끝으로 모아 정확한 문구 한 줄로 만든다.
 * `candidates`(그 질문의 요약에 실제로 들어간 엔진 후보 — route 가 요약을 만들 때 쓴 목록을 그대로 넘긴다)가 있으면, 본문이 언급한 후보 중
 * 상태 문구를 말하지 않은 것을 모아 고지 줄 **바로 앞**에 「언급한 후보의 상태: …」 한 줄을 붙인다(Leader 결정 2026-11-14 2차).
 */
export function finalizeNewChatAnswer(text: string, opts: FinalizeOptions = {}): string {
  const body = splitFences(text)
    .map((p) => (p.code ? p.text : stripMarkdownOutsideCode(p.text)))
    .join('')
    .replace(/^[ \t]*```[\w+-]*[ \t]*$/gm, '');   // 남은 홑 펜스 줄(닫히지 않은 것, 언어 표시만 있는 줄) — 화면에 기호로 보이지 않게
  const lines = body
    .split('\n')
    .filter((l) => !(l.trim().length <= DISCLAIMER_LINE_MAX && DISCLAIMER_LINE_RE.test(l)));
  const content = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!content) return CHAT_ANSWER_FALLBACK;
  // 끝부분 순서: 본문 → (자료 기준 시각 줄) → (언급한 후보의 상태 줄) → 고지 끝 줄
  const extra = [
    sourceTimeLine(content, opts.sourceTimes ?? []),
    candidateStatusLine(content, opts.candidates ?? []),
  ].filter((l): l is string => !!l);
  return extra.length > 0
    ? `${content}\n\n${extra.join('\n')}\n${CHAT_DISCLAIMER}`
    : `${content}\n\n${CHAT_DISCLAIMER}`;
}

/** 새 답(저장 전) — 정규화 뒤 후처리. 고정 안내문(정규화 실패)에는 후처리·고지를 붙이지 않는다. */
export function normalizeNewChatAnswer(raw: unknown, opts: FinalizeOptions = {}): NormalizedChatAnswer {
  const n = normalizeChatAnswerDetailed(raw);
  if (n.source === 'fallback') return n;
  const text = finalizeNewChatAnswer(n.text, opts);
  return text === CHAT_ANSWER_FALLBACK ? FALLBACK : { text, source: n.source };
}

// ── 언급한 엔진 후보의 상태 줄 ───────────────────────────────────────────────

/** 요약에 들어간 엔진 후보 1건 — `overview-context.ts` 가 요약 줄과 같은 값으로 만든다 */
export interface ChatCandidateStatus {
  /** 앱 심볼(`NAS:MCHP`·`042660`) */
  symbol: string;
  /** 요약에 적은 이름(`MICROCHIP TECHNOLOGY`·`한화오션`) */
  name: string;
  /** 요약 줄의 「상태:」 문구(`미검증 전략·가상 체결만`·`AI 보류`) */
  status: string;
}

export interface FinalizeOptions {
  candidates?: readonly ChatCandidateStatus[];
  /** 그 질문의 요약에 실제로 들어간 절의 기준 시각(요약 빌더가 만든 값 — route 가 그대로 넘긴다) */
  sourceTimes?: readonly ChatSourceTime[];
}

// ── 자료 기준 시각 줄 (QA F4) ───────────────────────────────────────────────

/** 요약 절 하나의 기준 시각 — `at` 은 KST `YYYY-MM-DD HH:mm` 또는 `YYYY-MM-DD`(일봉) */
export interface ChatSourceTime {
  label: string;
  at: string;
}

/**
 * 본문이 요약의 기준 날짜·시각 중 하나라도 적었는가 — `11-14`·`2026-11-14`·`11월 14일`·`11/14`·`05:55` 꼴.
 * Leader 지시 문구는 「날짜·시각 표기가 하나도 없으면」이지만, 스모크 답 다수가 다음 금리 결정일(「12월 9일」)만 적고 기준 시각은
 * 빠뜨렸다 — 아무 날짜나 세면 그 경우 줄이 붙지 않아, **요약 절의 기준 날짜·시각을 적었는지**로 본다(더 엄격한 쪽).
 */
function citesSourceTime(body: string, times: readonly ChatSourceTime[]): boolean {
  for (const t of times) {
    const m = t.at.match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/);
    if (!m) continue;
    const [, y, mo, d, hh, mi] = m;
    const M = Number(mo);
    const D = Number(d);
    const pats = [
      `${y}-${mo}-${d}`,
      `${y}\\.\\s?${M}\\.\\s?${D}(?!\\d)`,
      `(?<!\\d)${mo}-${d}(?!\\d)`,
      `(?<!\\d)${M}-${D}(?!\\d)`,
      `(?<!\\d)${M}월\\s*${D}일`,
      `(?<!\\d)${M}/${D}(?!\\d)`,
    ];
    if (hh && mi) pats.push(`(?<!\\d)${hh}:${mi}(?!\\d)`, `(?<!\\d)${Number(hh)}:${mi}(?!\\d)`);
    if (pats.some((p) => new RegExp(p).test(body))) return true;
  }
  return false;
}

/**
 * 「자료 기준: 경제 지표 11-14 05:55 · 엔진 후보 11-14 08:01 · 뉴스 11-14 17:00 (KST)」 — 요약이 붙었고(기준 시각이 1개 이상),
 * 본문에 숫자가 있고(인사 등 숫자 없는 답 제외), 본문이 기준 날짜·시각을 하나도 적지 않았을 때만. 아니면 null.
 */
export function sourceTimeLine(body: string, times: readonly ChatSourceTime[]): string | null {
  if (times.length === 0 || !/\d/.test(body) || citesSourceTime(body, times)) return null;
  return `자료 기준: ${times.map((t) => `${t.label} ${t.at.slice(5)}`).join(' · ')} (KST)`;
}

/** 영문 이름의 첫 낱말로 언급을 볼 때 너무 흔한 낱말은 뺀다(오탐 방지) */
const GENERIC_NAME_WORDS = new Set(['STRATEGY', 'GLOBAL', 'AMERICAN', 'UNITED', 'GENERAL', 'FIRST', 'INTERNATIONAL', 'NATIONAL', 'ADVANCED']);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 비교용 — 공백·가운뎃점·쉼표를 지운다(「미검증 전략·가상 체결만」 ≈ 「미검증 전략, 가상 체결만」) */
function compact(s: string): string {
  return s.replace(/[\s·・,]/g, '');
}

/** 본문이 후보를 언급했는가 — 티커(국내는 6자리 코드)·이름 전체(대소문자 무시)·영문 이름 첫 낱말(5자 이상, 대문자 그대로). */
function mentionsCandidate(body: string, c: ChatCandidateStatus): boolean {
  const ticker = c.symbol.includes(':') ? c.symbol.split(':').pop() ?? c.symbol : c.symbol;
  if (ticker && new RegExp(`(?<![A-Za-z0-9])${escapeRe(ticker)}(?![A-Za-z0-9])`).test(body)) return true;
  const name = c.name.trim();
  if (name.length >= 2 && name !== c.symbol) {
    // 영문·숫자로만 된 이름(SK·LG·FORTINET INC 등)은 단어 경계를 요구한다 — 「risk」 안의 「sk」 같은 오탐 방지(Reviewer L2).
    // 한글이 섞인 이름(SK하이닉스·한화오션)은 조사가 바로 붙으므로 부분 일치 그대로.
    if (/^[A-Za-z0-9&.\- ]+$/.test(name)) {
      if (new RegExp(`(?<![A-Za-z0-9])${escapeRe(name)}(?![A-Za-z0-9])`, 'i').test(body)) return true;
    } else if (body.toLowerCase().includes(name.toLowerCase())) {
      return true;
    }
  }
  const first = name.split(/\s+/)[0] ?? '';
  return /^[A-Z][A-Z0-9&.-]{4,}$/.test(first) && !GENERIC_NAME_WORDS.has(first)
    && new RegExp(`(?<![A-Za-z0-9])${escapeRe(first)}(?![A-Za-z0-9])`).test(body);
}

/** 상태를 이미 말했는가 — 상태 문구(끝의 「만」은 있어도 없어도)가 본문 어디에든 있으면 말한 것으로 본다(중복 줄 금지). */
function statusAlreadySaid(compactBody: string, status: string): boolean {
  const s = compact(status);
  return s.length > 0 && (compactBody.includes(s) || compactBody.includes(s.replace(/만$/, '')));
}

/** 「언급한 후보의 상태: MCHP 미검증 전략·가상 체결만, FTNT AI 보류」 — 언급했는데 상태를 말하지 않은 후보가 없으면 null */
export function candidateStatusLine(body: string, candidates: readonly ChatCandidateStatus[]): string | null {
  const compactBody = compact(body);
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.symbol) || !c.status) continue;
    seen.add(c.symbol);
    if (!mentionsCandidate(body, c) || statusAlreadySaid(compactBody, c.status)) continue;
    const label = c.symbol.includes(':') ? (c.symbol.split(':').pop() ?? c.symbol) : (c.name || c.symbol);
    parts.push(`${label} ${c.status}`);
  }
  return parts.length > 0 ? `언급한 후보의 상태: ${parts.join(', ')}` : null;
}
