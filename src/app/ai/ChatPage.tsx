'use client';

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

  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('sonnet');
  const [skipDraft, setSkipDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listEndRef = useRef<HTMLDivElement>(null);

  // 초기 로드
  useEffect(() => {
    fetch('/api/chat/threads').then(r => r.json()).then(d => {
      if (d.ok) setThreads(d.threads ?? []);
    });
    fetch('/api/chat/models').then(r => r.json()).then((d: ModelInfo & { ok: boolean }) => {
      if (d.ok) {
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

  // 활성 스레드 메시지 로드
  useEffect(() => {
    if (activeThreadId == null) { setMessages([]); return; }
    fetch(`/api/chat/threads/${activeThreadId}/messages`).then(r => r.json()).then(d => {
      if (d.ok) setMessages(d.messages ?? []);
    });
  }, [activeThreadId]);

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
    const res = await fetch('/api/chat/threads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const d = await res.json();
    if (!d.ok) return null;
    setActiveThreadId(d.id);
    setThreads(prev => [{ id: d.id, title: '새 대화', symbol: null, updatedAt: new Date().toISOString(), messageCount: 0, archived: false }, ...prev]);
    return d.id as number;
  }, [activeThreadId]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || stage !== 'idle') return;
    setError(null);

    const tid = await ensureThread();
    if (tid == null) { setError('스레드 생성 실패'); return; }

    const content = input.trim();
    if (skipDraft) {
      // 직진 모드: 바로 본 응답
      setStage('generating');
      try {
        const res = await fetch(`/api/chat/threads/${tid}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, modelOverride: selectedModel, skipDraftStage: true }),
        });
        const d = await res.json();
        if (!d.ok) { setError(d.error ?? '응답 실패'); return; }
        await reloadMessages(tid);
        setInput('');
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
      const res = await fetch(`/api/chat/threads/${tid}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, modelOverride: selectedModel }),
      });
      const d = await res.json();
      if (!d.ok) { setError(d.error ?? '정제 실패'); setStage('idle'); return; }
      setDraftPrompt(d.draftPrompt as string);
      setDraftContext((d.attachedContext ?? []) as SymbolContext[]);
      setDraftMeta({ provider: d.draftProvider, model: d.draftModel, latencyMs: d.draftLatencyMs });
      setDraftEdited(false);
      setStage('review');
    } catch (e) {
      setError(String(e));
      setStage('idle');
    }
  }, [input, stage, ensureThread, skipDraft, selectedModel]);

  const reloadMessages = useCallback(async (tid: number) => {
    const r = await fetch(`/api/chat/threads/${tid}/messages`);
    const d = await r.json();
    if (d.ok) setMessages(d.messages ?? []);
    // 스레드 목록 갱신
    fetch('/api/chat/threads').then(r => r.json()).then(td => {
      if (td.ok) setThreads(td.threads ?? []);
    });
  }, []);

  const handleConfirmDraft = useCallback(async () => {
    if (activeThreadId == null) return;
    setStage('generating');
    try {
      const res = await fetch(`/api/chat/threads/${activeThreadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: input.trim(),
          draftPrompt,
          attachedContext: draftContext,
          modelOverride: selectedModel,
        }),
      });
      const d = await res.json();
      if (!d.ok) { setError(d.error ?? '응답 실패'); return; }
      await reloadMessages(activeThreadId);
      setInput('');
      setDraftPrompt('');
      setDraftContext([]);
      setDraftMeta(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setStage('idle');
    }
  }, [activeThreadId, input, draftPrompt, draftContext, selectedModel, reloadMessages]);

  const handleCancelDraft = useCallback(() => {
    setStage('idle');
    setDraftPrompt('');
    setDraftContext([]);
    setDraftMeta(null);
  }, []);

  const handleNewThread = useCallback(async () => {
    setActiveThreadId(null);
    setMessages([]);
    setShowThreadList(false);
  }, []);

  const handleDeleteThread = useCallback(async (id: number) => {
    if (!confirm('이 대화를 삭제할까요?')) return;
    await fetch(`/api/chat/threads/${id}`, { method: 'DELETE' });
    setThreads(prev => prev.filter(t => t.id !== id));
    if (activeThreadId === id) { setActiveThreadId(null); setMessages([]); }
  }, [activeThreadId]);

  const dropContext = (symbol: string) =>
    setDraftContext(prev => prev.filter(c => c.symbol !== symbol));

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

      {error && (
        <div style={{ padding: 8, background: 'rgba(239,68,68,.15)', color: 'var(--down)', fontSize: 12, textAlign: 'center' }}>
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--down)', cursor: 'pointer' }}>×</button>
        </div>
      )}

      {/* Thread list overlay */}
      {showThreadList && (
        <ThreadListOverlay
          threads={threads}
          activeId={activeThreadId}
          onSelect={(id) => { setActiveThreadId(id); setShowThreadList(false); }}
          onDelete={handleDeleteThread}
          onClose={() => setShowThreadList(false)}
          onNew={handleNewThread}
        />
      )}
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
  prompt, onPromptChange, context, onDropContext, meta, edited, onConfirm, onCancel,
}: {
  prompt: string;
  onPromptChange: (p: string) => void;
  context: SymbolContext[];
  onDropContext: (sym: string) => void;
  meta: { provider: string; model: string; latencyMs: number } | null;
  edited: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{ borderTop: '2px solid var(--accent)', padding: '8px 10px', background: 'var(--bg2)', flexShrink: 0 }}>
      <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>
        🤖 분석가 정제 프롬프트
        {meta && <span style={{ marginLeft: 6 }}>· {meta.model} · {(meta.latencyMs / 1000).toFixed(1)}s</span>}
      </div>
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
            title={modelInfo.fixed ? '설정에서 변경 가능' : 'CLI 모델 선택'}
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
function ThreadListOverlay({
  threads, activeId, onSelect, onDelete, onClose, onNew,
}: {
  threads: Thread[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
  onNew: () => void;
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
