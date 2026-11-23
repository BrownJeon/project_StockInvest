'use client';

import { CHAT_HEARTBEAT_HEADER } from '@/lib/chat/response-heartbeat';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface Thread {
  id: number;
  title: string;
  symbol: string | null;
  updatedAt: string;
  messageCount: number;
  archived: boolean;
}

interface SymbolContext {
  symbol: string;
  name: string;
  matchedText?: string;
  price: number;
  priceChange5: number;
  rsi14: number | null;
  ema20: number | null;
  ema60: number | null;
  macdHistogram: number | null;
  atrPct: number | null;
}

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  draftPrompt?: string | null;
  contextAttached?: SymbolContext[] | null;
  llmProvider?: string | null;
  llmModel?: string | null;
  latencyMs?: number | null;
  createdAt: string;
}

interface ModelOption { id: string; label: string }
interface ModelInfo { provider: string; models: ModelOption[]; fixed: boolean; default: string }

type Stage = 'idle' | 'drafting' | 'review' | 'generating';

const SKIP_DRAFT_KEY = 'chat_skip_draft';
const CLAUDE_MODEL_KEY = 'chat_claude_model';

/** T-157 — 채팅 API 가 401(세션 만료·없는 계정)을 주면 로그인 화면으로. 로그인 뒤 비서(/ai)로 돌아온다. */
export const CHAT_LOGIN_PATH = '/login?next=%2Fai';
/** T-157 — 대화가 지워졌거나 내 대화가 아닐 때(404) 안내. 이전 대화 메시지는 남기지 않고 목록을 다시 읽는다. */
export const THREAD_GONE_MESSAGE = '삭제됐거나 열 수 없는 대화입니다. 대화 목록을 새로 불러왔습니다.';

/**
 * T-161 — 「전송은 됐다」로 시작하는 **안내** 띠의 접두. `ChatErrorBar` 는 이 접두만 보고 오류 띠(빨강·`alert`)와
 * 안내 띠(호박색·`status`)를 가른다. `error` 가 단일 문자열 상태이고 `setError` 호출이 열 곳을 넘어, 종류를
 * 상태로 들고 다니면 한 곳만 빠져도 색이 틀린다(Leader 결정 — 상태를 늘리지 않고 문구로 유도한다).
 */
export const SENT_NOTICE_PREFIX = '전송 완료 — ';
/** T-161 — 초안을 만든 대화가 사라져 보낼 곳이 없다. **이때만** 검토 중이던 초안을 버린다. */
export const DRAFT_THREAD_GONE_MESSAGE =
  '보낼 대화가 삭제돼 전송하지 못했습니다. 검토 중이던 초안도 닫혔습니다 — 질문을 다시 입력해 주세요.';
/** T-161 — 초안을 만든 대화(= 지금 보고 있는 대화가 아니다)로 전송했을 때 어디에 저장됐는지 알린다. */
export const SENT_TO_OTHER_THREAD_MESSAGE = (title: string) =>
  `${SENT_NOTICE_PREFIX}「${title}」 대화에 저장했습니다. 보려면 그 대화를 여세요.`;
/** T-161 — 전송(POST)은 200 인데 뒤이은 메시지 재조회가 실패했다. 전송 성공을 **먼저** 말해 중복 전송을 막는다. */
export const SENT_RELOAD_FAILED_PREFIX = `${SENT_NOTICE_PREFIX}화면 갱신만 실패했습니다`;
/**
 * 재조회 실패 안내 조립. `detail` 은 `chatFetch` 가 만든 문구 — 기본값이면 이미 접두로 시작하므로
 * `… (HTTP 500). 대화를…` 형식이 그대로 나오고, 서버가 자기 `error` 를 줬으면 접두를 앞에 붙인다.
 * 접두가 빠지면 띠가 빨강(실패)으로 보여 「전송은 됐다」는 뜻이 뒤집히므로 여기서 반드시 보장한다.
 */
export function sentReloadFailedMessage(detail: string): string {
  const head = detail.startsWith(SENT_RELOAD_FAILED_PREFIX) ? detail : `${SENT_RELOAD_FAILED_PREFIX} — ${detail}`;
  return `${head}. 대화를 다시 열면 답변이 보입니다.`;
}

/** 채팅 API 응답 분류 — `error` 는 기존 오류 띠에 그대로 쓰는 문구. */
export type ChatResponse =
  | { kind: 'ok'; body: Record<string, any> }
  | { kind: 'unauthorized' }
  | { kind: 'not_found'; error: string }
  | { kind: 'error'; error: string };

/**
 * 응답을 401 · 404 · 오류(5xx·비JSON·`ok:true` 아님) · 정상으로 나눈다. 본문이 JSON 이 아니어도 던지지 않는다.
 * `fallback` 은 화면의 기존 오류 문구(예: '응답 실패') — 서버가 `error` 를 주지 않을 때만 쓰고 HTTP 상태를 붙인다.
 */
export async function readChatResponse(
  res: Pick<Response, 'status' | 'ok' | 'json'> & Partial<Pick<Response, 'headers'>>,
  fallback: string,
): Promise<ChatResponse> {
  if (res.status === 401) return { kind: 'unauthorized' };
  let body: unknown = null;
  try { body = await res.json(); } catch { body = null; }
  let status = res.status;
  let ok = res.ok;
  if (res.headers?.get(CHAT_HEARTBEAT_HEADER) === '1' && body !== null && typeof body === 'object') {
    const result = body as { status?: unknown; body?: unknown };
    if (typeof result.status === 'number' && Number.isInteger(result.status) &&
        result.status >= 200 && result.status <= 599) {
      status = result.status;
      ok = status >= 200 && status < 300;
      body = result.body;
    }
  }
  if (status === 401) return { kind: 'unauthorized' };
  const obj = body !== null && typeof body === 'object' ? (body as Record<string, any>) : null;
  const serverError = obj && typeof obj.error === 'string' && obj.error ? (obj.error as string) : null;
  if (status === 404) return { kind: 'not_found', error: serverError ?? `${fallback} (HTTP 404)` };
  if (!ok || !obj || obj.ok !== true) return { kind: 'error', error: serverError ?? `${fallback} (HTTP ${status})` };
  return { kind: 'ok', body: obj };
}

/** fetch + 분류. 네트워크 오류도 `error` 로 돌려준다(던지지 않음). 401 이면 여기서 로그인 화면으로 보낸다. */
export async function chatFetch(url: string, fallback: string, init?: RequestInit): Promise<ChatResponse> {
  let r: ChatResponse;
  try {
    const isMessagePost = init?.method === 'POST' && /^\/api\/chat\/threads\/\d+\/(?:draft|messages)$/u.test(url);
    if (isMessagePost) {
      const headers = new Headers(init?.headers);
      headers.set(CHAT_HEARTBEAT_HEADER, '1');
      init = { ...init, headers };
    }
    r = await readChatResponse(await fetch(url, init), fallback);
  } catch (e) {
    r = { kind: 'error', error: String(e) };
  }
  if (r.kind === 'unauthorized' && typeof window !== 'undefined') window.location.replace(CHAT_LOGIN_PATH);
  return r;
}

export function ChatPage() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [showThreadList, setShowThreadList] = useState(false);

  const [input, setInput] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [draftPrompt, setDraftPrompt] = useState('');
  const [draftMeta, setDraftMeta] = useState<{ provider: string; model: string; latencyMs: number } | null>(null);
  const [draftContext, setDraftContext] = useState<SymbolContext[]>([]);
  const [draftEdited, setDraftEdited] = useState(false);
  /** T-161 — 초안을 만든 대화. 「확정 전송」은 지금 보고 있는 대화가 아니라 이 대화로 간다(ⓑ). */
  const [draftThreadId, setDraftThreadId] = useState<number | null>(null);
  /** T-161 — 초안을 만든 **그 글**. 확정 시점의 입력칸 값이 아니다(그 사이 다른 대화에서 새로 썼을 수 있다). */
  const [draftContent, setDraftContent] = useState('');

  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('sonnet');
  const [skipDraft, setSkipDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listEndRef = useRef<HTMLDivElement>(null);
  /** 비동기 응답이 도착했을 때의 활성 대화(404 처리에서 다른 대화를 지우지 않으려고). */
  const activeIdRef = useRef<number | null>(null);
  activeIdRef.current = activeThreadId;
  /**
   * 메시지 조회 순번 — **같은 대화 안에서** 조회가 겹쳤을 때 늦게 끝난 옛 조회가 최신 결과를 덮지 않게 한다.
   * `activeIdRef` 는 대화 **ID** 를 비교하므로 대화 사이의 경합만 막는다. 최초 로드가 보류된 동안 같은 대화에서
   * 전송·재조회가 먼저 끝나면 ID 가 **같아서** 그 가드를 통과하고, 뒤늦게 온 실패가 방금 받은 메시지를 지우거나
   * 오래된 스냅샷으로 되돌린다(T-157 Codex C2 지적 1 — 메시지 조회는 `stage` 를 바꾸지 않아 조회 중에도
   * 전송할 수 있다). 두 가드는 막는 경합이 달라 **함께** 둔다.
   *
   * ⚠ 순번은 **활성 대화의 조회에만** 매긴다(0 부터 증가하므로 `-1` 은 어떤 조회의 순번과도 같지 않다).
   * 비활성 대화의 재조회가 순번을 올리면 그 재조회는 ID 가드로 버려지는데 **활성 대화의 진행 중 조회까지**
   * 순번 불일치로 함께 버려져, 아무도 화면을 쓰지 않은 채 옛 대화의 메시지가 남는다(라운드 5 회귀).
   */
  const msgSeqRef = useRef(0);
  /**
   * T-161 — 초안을 만든 대화 ID. `activeIdRef` 와 같은 패턴으로 **바꾸는 지점에서 즉시 대입**해 비동기
   * 가드에서 읽는다(콜백 deps 를 늘리지 않기 위함). 렌더에서 상태를 되비추지 **않는다** — 초안이 아직
   * 살아 있는지를 이 ref 하나로 판정하기 때문이다(`handleConfirmDraft` 의 재조회 404 처리).
   */
  const draftThreadIdRef = useRef<number | null>(null);

  /** 초안 상태만 비운다 — `stage` 는 건드리지 않는다(전송 중 stage 를 덮지 않으려고). */
  const clearDraft = useCallback(() => {
    draftThreadIdRef.current = null;
    setDraftThreadId(null);
    setDraftContent('');
    setDraftPrompt('');
    setDraftContext([]);
    setDraftMeta(null);
  }, []);

  /** 검토 중이던 초안을 버린다 — 검토 화면이면 입력 단계로 돌아간다(전송 중이면 stage 는 그대로 둔다). */
  const discardDraft = useCallback(() => {
    clearDraft();
    setStage(s => (s === 'review' ? 'idle' : s));
  }, [clearDraft]);

  const loadThreads = useCallback(async () => {
    const r = await chatFetch('/api/chat/threads', '대화 목록 조회 실패');
    if (r.kind === 'ok') setThreads(r.body.threads ?? []);
    else if (r.kind !== 'unauthorized') setError(r.error);
  }, []);

  /**
   * 대화가 없어졌다(404) — 그 대화를 보고 있었다면 선택 해제·메시지 비움, 안내 후 목록 다시 읽기.
   * `sent` 는 **전송(POST)이 이미 `ok` 로 끝난 뒤**의 404 라는 뜻이다(전송 뒤 재조회). 그때는 초안이
   * 이미 소비됐으므로 「보낼 대화가 삭제돼 전송하지 못했습니다」가 사실이 아니다 — 초안은 그대로
   * 버리되 문구는 기존 404 안내를 쓴다(T-161 Reviewer L-1).
   */
  const handleThreadGone = useCallback((tid: number, opts?: { sent?: boolean }) => {
    if (activeIdRef.current === tid) {
      activeIdRef.current = null;
      setActiveThreadId(null);
      setMessages([]);
    }
    // T-161 — 그 대화로 보낼 초안이 걸려 있으면 보낼 곳이 없다. 초안을 버리고 그 사실을 알린다.
    // 다른 대화의 404 는 초안을 건드리지 않고 기존 안내 그대로다.
    const draftGone = draftThreadIdRef.current === tid;
    if (draftGone) discardDraft();
    setError(draftGone && opts?.sent !== true ? DRAFT_THREAD_GONE_MESSAGE : THREAD_GONE_MESSAGE);
    void loadThreads();
  }, [loadThreads, discardDraft]);

  // 초기 로드
  useEffect(() => {
    void loadThreads();
    chatFetch('/api/chat/models', '모델 정보 조회 실패').then(r => {
      if (r.kind === 'error' || r.kind === 'not_found') { setError(r.error); return; }
      if (r.kind === 'ok') {
        const d = r.body as ModelInfo & { ok: boolean };
        setModelInfo(d);
        const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(CLAUDE_MODEL_KEY) : null;
        const fallback = d.default;
        const initial = !d.fixed && stored && d.models.some(m => m.id === stored) ? stored : fallback;
        setSelectedModel(initial);
      }
    });
    if (typeof localStorage !== 'undefined') {
      setSkipDraft(localStorage.getItem(SKIP_DRAFT_KEY) === '1');
    }
  }, []);

  // 활성 스레드 메시지 로드 — 늦게 온 이전 대화 응답은 버린다. 실패하면 이전 대화 메시지를 남기지 않는다.
  useEffect(() => {
    if (activeThreadId == null) { setMessages([]); return; }
    const tid = activeThreadId;
    const seq = ++msgSeqRef.current;
    let stale = false;
    chatFetch(`/api/chat/threads/${tid}/messages`, '메시지 조회 실패').then(r => {
      if (stale) return;
      // 같은 대화의 더 새로운 조회가 **시작됐다**(끝났는지와 무관하다) — 화면은 그 조회가 쓸 것이라 건드리지 않는다.
      if (msgSeqRef.current !== seq) return;
      if (r.kind === 'ok') setMessages(r.body.messages ?? []);
      else if (r.kind === 'not_found') handleThreadGone(tid);
      else if (r.kind === 'error') { setMessages([]); setError(r.error); }
    });
    return () => { stale = true; };
  }, [activeThreadId]); // eslint-disable-line react-hooks/exhaustive-deps -- handleThreadGone 은 setter·ref 만 쓴다

  // 새 메시지 도착 시 스크롤
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, stage]);

  const persistModel = useCallback((model: string) => {
    setSelectedModel(model);
    if (modelInfo && !modelInfo.fixed && typeof localStorage !== 'undefined') {
      localStorage.setItem(CLAUDE_MODEL_KEY, model);
    }
  }, [modelInfo]);

  const toggleSkipDraft = useCallback(() => {
    setSkipDraft(v => {
      const next = !v;
      if (typeof localStorage !== 'undefined') localStorage.setItem(SKIP_DRAFT_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  const ensureThread = useCallback(async (): Promise<number | null> => {
    if (activeThreadId != null) return activeThreadId;
    const r = await chatFetch('/api/chat/threads', '스레드 생성 실패', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (r.kind !== 'ok') {
      if (r.kind !== 'unauthorized') setError('스레드 생성 실패');
      return null;
    }
    const d = r.body;
    activeIdRef.current = d.id as number;
    setActiveThreadId(d.id);
    setThreads(prev => [{ id: d.id, title: '새 대화', symbol: null, updatedAt: new Date().toISOString(), messageCount: 0, archived: false }, ...prev]);
    return d.id as number;
  }, [activeThreadId]);

  /**
   * 보낸 글을 입력칸에서 지운다 — 그동안 입력칸 내용이 달라졌으면(다른 대화로 옮겨 새로 쓴 글 등) 건드리지 않는다.
   * T-157 QA 결함 #1 — 입력칸은 「지금 보고 있는 대화」의 것이라 늦게 끝난 전송이 남의 글을 지우면 안 된다.
   * 보낸 글이 그대로 남아 있으면(전환 여부와 무관) 지운다 — 이미 보낸 글을 그냥 두면 다른 대화에 다시 보낼 수 있다.
   */
  const clearSentInput = useCallback((sent: string) => {
    setInput(prev => (prev.trim() === sent ? '' : prev));
  }, []);

  const handleSend = useCallback(async () => {
    if (!input.trim() || stage !== 'idle') return;
    setError(null);

    const tid = await ensureThread();
    if (tid == null) return; // 오류 표시·로그인 이동은 ensureThread 가 했다

    const content = input.trim();
    if (skipDraft) {
      // 직진 모드: 바로 본 응답
      setStage('generating');
      try {
        const r = await chatFetch(`/api/chat/threads/${tid}/messages`, '응답 실패', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, modelOverride: selectedModel, skipDraftStage: true }),
        });
        if (r.kind === 'not_found') { handleThreadGone(tid); return; }
        if (r.kind !== 'ok') { if (r.kind === 'error') setError(r.error); return; }
        await reloadMessages(tid, { afterSend: true });   // T-161 — 재조회가 실패해도 「전송은 됐다」를 먼저 알린다
        clearSentInput(content);
      } catch (e) {
        setError(String(e));
      } finally {
        setStage('idle');
      }
      return;
    }

    // 2단계 흐름: drafting → review → generating
    setStage('drafting');
    try {
      const r = await chatFetch(`/api/chat/threads/${tid}/draft`, '정제 실패', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, modelOverride: selectedModel }),
      });
      if (r.kind !== 'ok') {
        if (r.kind === 'not_found') handleThreadGone(tid);
        else if (r.kind === 'error') setError(r.error);
        setStage('idle');
        return;
      }
      const d = r.body;
      // T-161 — 이 초안은 `tid` 대화의 이력으로 만들어졌다. 확정 전송의 목적지를 **지금** 고정한다
      // (정제가 도는 동안 사용자가 다른 대화로 옮겼더라도 초안은 요청한 대화에 속한다).
      draftThreadIdRef.current = tid;
      setDraftThreadId(tid);
      setDraftContent(content);
      setDraftPrompt(d.draftPrompt as string);
      setDraftContext((d.attachedContext ?? []) as SymbolContext[]);
      setDraftMeta({ provider: d.draftProvider, model: d.draftModel, latencyMs: d.draftLatencyMs });
      setDraftEdited(false);
      setStage('review');
    } catch (e) {
      setError(String(e));
      setStage('idle');
    }
  }, [input, stage, ensureThread, skipDraft, selectedModel, handleThreadGone, clearSentInput]);

  /**
   * 메시지를 다시 읽는다. 응답이 도착했을 때 사용자가 이미 다른 대화로 옮겼으면(늦은 응답) 화면(메시지·오류 띠)은
   * 그 다른 대화의 것이므로 건드리지 않고 목록만 갱신한다 — T-157 QA 결함 #1.
   * 대화 전환 로드 effect 의 `stale` 가드는 그 effect 의 조회만 막는다(여기는 전송·확정 뒤 재조회 경로라 그 가드가 닿지 않는다).
   */
  const reloadMessages = useCallback(async (tid: number, opts?: { afterSend?: boolean }) => {
    // T-161 — `afterSend` 면 POST 가 이미 200 이었다. 조회가 실패해도 「전송이 됐는지」를 문구가 말해야 한다.
    // 기본 문구를 바꿔 넘겨 `(HTTP nnn)` 형식을 유지하고, 조립은 `sentReloadFailedMessage` 가 보장한다.
    const afterSend = opts?.afterSend === true;
    // 대상이 활성 대화일 때만 순번을 매긴다. 비활성이면 순번을 **건드리지 않고**(활성 대화의 진행 중 조회를
    // 무효화하지 않게) `-1` 로 둬 아래 가드에서 반드시 버려지게 한다 — 결과는 어차피 화면에 쓸 것이 아니다.
    const seq = activeIdRef.current === tid ? ++msgSeqRef.current : -1;
    const r = await chatFetch(
      `/api/chat/threads/${tid}/messages`,
      afterSend ? SENT_RELOAD_FAILED_PREFIX : '메시지 조회 실패',
    );
    if (r.kind === 'unauthorized') return;      // 로그인 화면으로 이동 중 — 아무 상태도 쓰지 않는다
    // 늦은 응답 두 경우 — 보고 있는 대화가 바뀌었거나(ID), 같은 대화에서 더 새로운 조회가 시작됐다(순번).
    // 시작할 때 비활성이었던 재조회도 `seq === -1` 로 여기서 걸린다.
    // 화면(메시지·오류 띠)은 최신 결과의 것이므로 건드리지 않고, 목록만 갱신한다(보낸 메시지로 updatedAt 이 바뀐다).
    if (activeIdRef.current !== tid || msgSeqRef.current !== seq) { void loadThreads(); return; }
    // `afterSend` 면 POST 가 이미 200 이었다 — 「전송하지 못했습니다」로 안내하지 않는다(L-1).
    if (r.kind === 'not_found') { handleThreadGone(tid, { sent: afterSend }); return; }
    if (r.kind === 'ok') setMessages(r.body.messages ?? []);
    else setError(afterSend ? sentReloadFailedMessage(r.error) : r.error);
    // 스레드 목록 갱신
    void loadThreads();
  }, [handleThreadGone, loadThreads]);

  const handleConfirmDraft = useCallback(async () => {
    // T-161 (ⓑ) — 목적지는 **초안을 만든 대화**다. 클릭 시점의 `activeThreadId` 를 쓰지 않는다. 그러지 않으면
    // 옛 대화 이력으로 만든 초안이 지금 보고 있는 남의 대화에 저장된다(「7번 질문이 8번에 들어간다」).
    const tid = draftThreadIdRef.current;
    if (tid == null) { discardDraft(); setError(DRAFT_THREAD_GONE_MESSAGE); return; }
    // 본문은 초안을 만든 그 글이다 — 그 사이 입력칸이 달라졌을 수 있다.
    const content = draftContent;
    setStage('generating');
    try {
      const r = await chatFetch(`/api/chat/threads/${tid}/messages`, '응답 실패', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          draftPrompt,
          attachedContext: draftContext,
          modelOverride: selectedModel,
        }),
      });
      if (r.kind === 'not_found') { handleThreadGone(tid); return; }
      if (r.kind !== 'ok') { if (r.kind === 'error') setError(r.error); return; }
      await reloadMessages(tid, { afterSend: true });
      clearSentInput(content);
      // 보고 있는 대화가 보낸 대화가 아니면 어디에 저장했는지 알린다 — 판정은 **응답이 온 뒤**에 한다
      // (전송하는 동안 옮겼을 수 있다). 재조회가 404 였으면 `handleThreadGone` 이 초안을 버려 ref 가
      // 비어 있으므로 그 404 안내를 이 문구로 덮지 않는다.
      const draftAlive = draftThreadIdRef.current === tid;
      if (draftAlive && activeIdRef.current !== tid) {
        setError(SENT_TO_OTHER_THREAD_MESSAGE(threads.find(t => t.id === tid)?.title ?? '대화'));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      // 성공·실패 모두 검토 카드를 닫는다(기존 동작). 전송 중에는 handleSend 가 막혀 새 초안이 생길 수 없으므로
      // 여기서 지울 초안은 이 전송 것뿐이다.
      clearDraft();
      setStage('idle');
    }
  }, [draftContent, draftPrompt, draftContext, selectedModel, threads, reloadMessages, handleThreadGone, clearSentInput, clearDraft, discardDraft]);

  const handleCancelDraft = useCallback(() => {
    setStage('idle');
    clearDraft();
  }, [clearDraft]);

  const handleNewThread = useCallback(async () => {
    activeIdRef.current = null;   // 늦은 응답 가드가 렌더 시점에 기대지 않게(아래 onSelect 도 같다)
    setActiveThreadId(null);
    setMessages([]);
    setShowThreadList(false);
  }, []);

  const handleDeleteThread = useCallback(async (id: number) => {
    if (!confirm('이 대화를 삭제할까요?')) return;
    // 서버가 ok:true 로 답했을 때만 목록에서 뺀다. 실패하면 목록을 그대로 두고 오류를 보인다.
    const r = await chatFetch(`/api/chat/threads/${id}`, '삭제 실패', { method: 'DELETE' });
    if (r.kind === 'not_found') { handleThreadGone(id); return; }
    if (r.kind !== 'ok') { if (r.kind === 'error') setError(r.error); return; }
    setThreads(prev => prev.filter(t => t.id !== id));
    if (activeIdRef.current === id) { activeIdRef.current = null; setActiveThreadId(null); setMessages([]); }
    // T-161 — 지운 대화로 보낼 초안이 걸려 있으면 보낼 곳이 없다(「확정 전송」이 무반응이 되던 경로).
    if (draftThreadIdRef.current === id) { discardDraft(); setError(DRAFT_THREAD_GONE_MESSAGE); }
  }, [handleThreadGone, discardDraft]);

  const dropContext = (symbol: string) =>
    setDraftContext(prev => prev.filter(c => c.symbol !== symbol));

  /**
   * T-161 — 초안을 만든 대화가 지금 보고 있는 대화와 **다를 때만** 그 제목(검토 카드 머리글 한 줄용).
   * 같으면 null → 한 줄이 나타나지 않는다. 목록에 없는 대화(막 지워졌다 등)는 헤더와 같은 표기(`대화`)를 쓴다.
   */
  const draftAwayTitle = useMemo(() => {
    if (draftThreadId == null || draftThreadId === activeThreadId) return null;
    return threads.find(t => t.id === draftThreadId)?.title ?? '대화';
  }, [draftThreadId, activeThreadId, threads]);

  const stageLabel = useMemo(() => {
    if (stage === 'drafting')   return '🤖 분석가가 정제 중...';
    if (stage === 'generating') return '✍️ 분석가가 답변 중...';
    return '';
  }, [stage]);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      // S25+ 모바일 주소창 변동 대응 — 100vh 대신 dvh (dynamic viewport height) 사용
      height: 'calc(100dvh - var(--nav-h) - var(--safe-bottom))',
      // RootLayout의 paddingBottom과 중복 방지
      marginBottom: 'calc(-1 * (var(--nav-h) + var(--safe-bottom)))',
      position: 'relative',
    }}>
      {/* 상단 헤더 — 컴팩트 (S25+ 모바일 화면 절약) */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 12px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg2)', flexShrink: 0, height: 38,
      }}>
        <button
          onClick={() => setShowThreadList(true)}
          aria-label="대화 목록"
          style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text)' }}
        >☰</button>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>
          {activeThreadId == null ? '새 대화' : (threads.find(t => t.id === activeThreadId)?.title ?? '대화')}
        </span>
        <button
          onClick={handleNewThread}
          aria-label="새 대화"
          style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--accent)', fontWeight: 700 }}
        >+</button>
      </header>

      {/* 메시지 영역 — flex:1로 가용 공간 점유, 메시지만 스크롤 */}
      <main style={{
        flex: 1, minHeight: 0, overflowY: 'auto',
        padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        {messages.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            종목 추천·전망·기업 분석 등 자유롭게 질문해보세요.
            <div style={{ fontSize: 11, marginTop: 8 }}>예) &quot;삼성전자 어때?&quot; · &quot;반도체 섹터 전망&quot; · &quot;005930 매수 타이밍 적정한가?&quot;</div>
          </div>
        )}
        {messages.map(m => <MessageItem key={m.id} message={m} />)}
        {stage === 'drafting' && <StatusBubble label={stageLabel} />}
        {stage === 'generating' && <StatusBubble label={stageLabel} />}
        <div ref={listEndRef} />
      </main>

      {/* DraftReview */}
      {stage === 'review' && (
        <DraftReview
          prompt={draftPrompt}
          onPromptChange={(p) => { setDraftPrompt(p); setDraftEdited(true); }}
          context={draftContext}
          onDropContext={dropContext}
          meta={draftMeta}
          edited={draftEdited}
          awayTitle={draftAwayTitle}
          onConfirm={handleConfirmDraft}
          onCancel={handleCancelDraft}
        />
      )}

      {/* Composer */}
      {stage !== 'review' && (
        <Composer
          input={input}
          onInputChange={setInput}
          onSend={handleSend}
          disabled={stage !== 'idle'}
          modelInfo={modelInfo}
          selectedModel={selectedModel}
          onModelChange={persistModel}
          skipDraft={skipDraft}
          onToggleSkipDraft={toggleSkipDraft}
        />
      )}

      {/* 대화 목록이 열려 있으면 오류 띠는 목록 안에 보인다(덮개 아래에 겹쳐 두 번 읽히지 않게) */}
      {error && !showThreadList && <ChatErrorBar message={error} onClose={() => setError(null)} />}

      {/* Thread list overlay */}
      {showThreadList && (
        <ThreadListOverlay
          threads={threads}
          activeId={activeThreadId}
          onSelect={(id) => { activeIdRef.current = id; setActiveThreadId(id); setShowThreadList(false); }}
          onDelete={handleDeleteThread}
          onClose={() => setShowThreadList(false)}
          onNew={handleNewThread}
          error={error}
          onDismissError={() => setError(null)}
        />
      )}
    </div>
  );
}

// ── Error ───────────────────────────────────────────────────────────────
/**
 * 기존 오류 띠(모양 그대로). 대화 목록이 열려 있으면 목록 안에도 같은 띠를 보인다(덮개에 가려지지 않게 — T-157 삭제 실패).
 * T-161 — `SENT_NOTICE_PREFIX` 로 시작하는 문구는 **전송이 성공한** 안내다. 빨강으로 두면 실패로 읽혀
 * 사용자가 같은 글을 다시 보내게 되므로 호박색 + `role="status"` 로 바꾼다(`--accent` 재사용, 새 색 아님).
 */
function ChatErrorBar({ message, onClose }: { message: string; onClose: () => void }) {
  const notice = message.startsWith(SENT_NOTICE_PREFIX);
  return (
    <div role={notice ? 'status' : 'alert'} style={{ padding: 8, background: notice ? 'rgba(245,158,11,.15)' : 'rgba(239,68,68,.15)', color: notice ? 'var(--accent)' : 'var(--down)', fontSize: 12, textAlign: 'center' }}>
      {message}
      <button onClick={onClose} aria-label={notice ? '안내 닫기' : '오류 닫기'} style={{ marginLeft: 8, background: 'none', border: 'none', color: notice ? 'var(--accent)' : 'var(--down)', cursor: 'pointer' }}>×</button>
    </div>
  );
}

// ── Message ─────────────────────────────────────────────────────────────
function MessageItem({ message }: { message: ChatMessage }) {
  const [showDraft, setShowDraft] = useState(false);
  const isUser = message.role === 'user';
  const meta = !isUser && message.llmModel
    ? `${message.llmProvider ?? '?'} · ${message.llmModel}${message.latencyMs ? ` · ${(message.latencyMs / 1000).toFixed(1)}s` : ''}`
    : null;
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <div style={{
        maxWidth: '85%', padding: '10px 12px', borderRadius: 14,
        background: isUser ? 'rgba(251,191,36,.15)' : 'var(--bg2)',
        border: `1px solid ${isUser ? 'rgba(251,191,36,.3)' : 'var(--border)'}`,
      }}>
        {meta && <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>🤖 {meta}</div>}
        <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{message.content}</div>
        {isUser && message.draftPrompt && message.draftPrompt !== message.content && (
          <div style={{ marginTop: 6 }}>
            <button
              onClick={() => setShowDraft(v => !v)}
              style={{ background: 'none', border: 'none', fontSize: 10, color: 'var(--muted)', cursor: 'pointer', textDecoration: 'underline' }}
            >
              정제 프롬프트 {showDraft ? '숨기기' : '보기'} {showDraft ? '▴' : '▾'}
            </button>
            {showDraft && (
              <div style={{ marginTop: 4, padding: 8, background: 'var(--bg3)', borderRadius: 8, fontSize: 11, color: 'var(--muted)', whiteSpace: 'pre-wrap' }}>
                {message.draftPrompt}
              </div>
            )}
          </div>
        )}
        {message.contextAttached && message.contextAttached.length > 0 && (
          <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
            {message.contextAttached.map(c => (
              <ContextChip key={c.symbol} ctx={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ContextChip({ ctx, onRemove }: { ctx: SymbolContext; onRemove?: () => void }) {
  const isUp = ctx.priceChange5 >= 0;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, padding: '2px 6px', borderRadius: 8,
      background: 'var(--bg3)', color: 'var(--muted)', border: '1px solid var(--border2)',
    }}>
      <span style={{ color: 'var(--text)', fontWeight: 600 }}>{ctx.name}</span>
      <span className="num">{ctx.price.toLocaleString()}</span>
      <span className="num" style={{ color: isUp ? 'var(--up)' : 'var(--down)' }}>
        {isUp ? '+' : ''}{ctx.priceChange5.toFixed(1)}%
      </span>
      {onRemove && (
        <button onClick={onRemove} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0, marginLeft: 2 }}>×</button>
      )}
    </span>
  );
}

function StatusBubble({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
      <div style={{ padding: '8px 12px', borderRadius: 12, background: 'var(--bg3)', fontSize: 12, color: 'var(--muted)' }}>
        {label}
      </div>
    </div>
  );
}

// ── DraftReview ─────────────────────────────────────────────────────────
function DraftReview({
  prompt, onPromptChange, context, onDropContext, meta, edited, onConfirm, onCancel, awayTitle = null,
}: {
  prompt: string;
  onPromptChange: (p: string) => void;
  context: SymbolContext[];
  onDropContext: (sym: string) => void;
  meta: { provider: string; model: string; latencyMs: number } | null;
  edited: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** T-161 — 초안을 만든 대화가 보고 있는 대화와 다를 때 그 제목. 같으면 null(한 줄이 나타나지 않는다). */
  awayTitle?: string | null;
}) {
  return (
    <div style={{ borderTop: '2px solid var(--accent)', padding: '8px 10px', background: 'var(--bg2)', flexShrink: 0 }}>
      <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>
        🤖 분석가 정제 프롬프트
        {meta && <span style={{ marginLeft: 6 }}>· {meta.model} · {(meta.latencyMs / 1000).toFixed(1)}s</span>}
      </div>
      {/* T-161 — 어느 대화로 가는지 누르기 전에 알린다. 색만으로 전달하지 않고 글로 담는다(↩ 는 장식). */}
      {awayTitle && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'baseline', marginBottom: 5, fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>
          <span aria-hidden="true">↩</span>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 700 }}>「{awayTitle}」</span>
          <span style={{ flexShrink: 0 }}>대화로 전송합니다</span>
        </div>
      )}
      <textarea
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        rows={4}
        style={{
          width: '100%', padding: 6, fontSize: 12, fontFamily: 'inherit',
          borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)',
          resize: 'vertical', minHeight: 72, maxHeight: 160,
        }}
      />
      {context.length > 0 && (
        <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
          {context.map(c => (
            <ContextChip key={c.symbol} ctx={c} onRemove={() => onDropContext(c.symbol)} />
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          style={{ padding: '6px 12px', fontSize: 12, borderRadius: 8, background: 'var(--bg3)', color: 'var(--muted)', border: '1px solid var(--border)', cursor: 'pointer' }}
        >취소</button>
        <button
          onClick={onConfirm}
          style={{ padding: '6px 12px', fontSize: 12, borderRadius: 8, background: 'var(--accent)', color: '#000', border: 'none', cursor: 'pointer', fontWeight: 600 }}
        >
          {edited ? '편집됨 — 전송 ▶' : '확정 전송 ▶'}
        </button>
      </div>
    </div>
  );
}

// ── Composer ────────────────────────────────────────────────────────────
function Composer({
  input, onInputChange, onSend, disabled, modelInfo, selectedModel, onModelChange,
  skipDraft, onToggleSkipDraft,
}: {
  input: string;
  onInputChange: (s: string) => void;
  onSend: () => void;
  disabled: boolean;
  modelInfo: ModelInfo | null;
  selectedModel: string;
  onModelChange: (m: string) => void;
  skipDraft: boolean;
  onToggleSkipDraft: () => void;
}) {
  return (
    <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg2)', padding: '6px 8px', flexShrink: 0 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
        <textarea
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder={disabled ? '응답 생성 중...' : '종목·전망·기업 분석을 자유롭게 질문하세요'}
          disabled={disabled}
          rows={1}
          style={{
            flex: 1, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit',
            borderRadius: 10, border: '1px solid var(--border)',
            background: 'var(--bg3)', color: 'var(--text)', resize: 'none',
            minHeight: 38, maxHeight: 100, lineHeight: 1.4,
          }}
        />
        <button
          onClick={onSend}
          disabled={disabled || !input.trim()}
          style={{
            padding: '0 12px', height: 38, borderRadius: 10, border: 'none',
            background: !disabled && input.trim() ? 'var(--accent)' : 'var(--bg3)',
            color: !disabled && input.trim() ? '#000' : 'var(--muted)',
            fontWeight: 700, cursor: !disabled && input.trim() ? 'pointer' : 'not-allowed',
            fontSize: 12, flexShrink: 0,
          }}
        >전송</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 10 }}>
        <button
          onClick={onToggleSkipDraft}
          title={skipDraft ? '직진 모드 (정제 단계 생략)' : '2단계 모드 (정제 검토 후 전송)'}
          style={{
            background: skipDraft ? 'rgba(251,191,36,.15)' : 'var(--bg3)',
            border: `1px solid ${skipDraft ? 'var(--accent)' : 'var(--border)'}`,
            color: skipDraft ? 'var(--accent)' : 'var(--muted)',
            fontSize: 10, padding: '2px 8px', borderRadius: 6, cursor: 'pointer',
          }}
        >⚡ {skipDraft ? '직진' : '검토'}</button>
        {modelInfo && (
          <select
            value={selectedModel}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={modelInfo.fixed}
            title={modelInfo.fixed ? '챗봇 전용 모델' : 'CLI 모델 선택'}
            style={{
              fontSize: 10, padding: '3px 6px', borderRadius: 6,
              background: 'var(--bg3)', color: 'var(--text)',
              border: '1px solid var(--border)',
              cursor: modelInfo.fixed ? 'not-allowed' : 'pointer',
            }}
          >
            {modelInfo.models.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        )}
        <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 9 }}>전송 버튼으로 보내기</span>
      </div>
    </div>
  );
}

// ── ThreadList overlay ─────────────────────────────────────────────────
export function ThreadListOverlay({
  threads, activeId, onSelect, onDelete, onClose, onNew, error = null, onDismissError,
}: {
  threads: Thread[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
  onNew: () => void;
  error?: string | null;
  onDismissError?: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0, background: 'rgba(0,0,0,.5)',
        display: 'flex', alignItems: 'stretch', zIndex: 30,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 280, maxWidth: '85%', background: 'var(--bg)', height: '100%',
          padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
          borderRight: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>대화 목록</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--muted)' }}>×</button>
        </div>
        <button
          onClick={onNew}
          style={{
            padding: '8px 10px', fontSize: 12, borderRadius: 8,
            background: 'var(--accent)', color: '#000', border: 'none', fontWeight: 700, cursor: 'pointer',
          }}
        >+ 새 대화</button>
        {error && <ChatErrorBar message={error} onClose={onDismissError ?? (() => {})} />}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {threads.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', fontSize: 11, color: 'var(--muted)' }}>대화 없음</div>
          )}
          {threads.map(t => (
            <div
              key={t.id}
              onClick={() => onSelect(t.id)}
              style={{
                padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                background: t.id === activeId ? 'rgba(251,191,36,.1)' : 'var(--bg2)',
                border: `1px solid ${t.id === activeId ? 'var(--accent)' : 'var(--border)'}`,
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{t.messageCount}개 · {new Date(t.updatedAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(t.id); }}
                style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13, padding: 4 }}
                aria-label="삭제"
              >🗑</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
