'use client';

import { useEffect, useState, useCallback } from 'react';
import { formatSymbolShort } from '@/lib/symbols';

type JournalStatus = 'watching' | 'active' | 'closed';
type Phase = 'analysis' | 'plan' | 'entry' | 'holding' | 'exit' | 'review';

interface JournalSummary {
  id: number;
  symbol: string;
  name: string | null;
  status: JournalStatus;
  entry_price: number | null;
  entry_qty: number | null;
  exit_price: number | null;
  pnl_pct: number | null;
  created_at: string;
  closed_at: string | null;
  entry_count: number;
  last_entry_at: string | null;
  last_content: string | null;
  last_phase: Phase | null;
}

interface JournalEntry {
  id: number;
  journal_id: number;
  phase: Phase;
  content: string;
  price_at: number | null;
  created_at: string;
}

interface JournalDetail extends JournalSummary {
  entries: JournalEntry[];
}

interface SearchResult { symbol: string; name: string; market: string }

// ─── 상수 ────────────────────────────────────────────────────────────────────

const PHASE_ORDER: Phase[] = ['analysis', 'plan', 'entry', 'holding', 'exit', 'review'];

const PHASE_META: Record<Phase, { label: string; icon: string; color: string; hint: string }> = {
  analysis: { label: '분석',  icon: '🔍', color: '#6366f1', hint: '왜 이 종목인가? 산업·재무·모멘텀 분석' },
  plan:     { label: '계획',  icon: '📋', color: '#0891b2', hint: '목표가, 손절가, 매수 시나리오 계획' },
  entry:    { label: '매수',  icon: '🟢', color: '#16a34a', hint: '실제 매수 이유, 매수가, 수량' },
  holding:  { label: '관찰',  icon: '👁',  color: '#d97706', hint: '보유 중 주가 변동 이유, 추가 판단' },
  exit:     { label: '매도',  icon: '🔴', color: '#dc2626', hint: '매도 이유, 실제 결과' },
  review:   { label: '회고',  icon: '📝', color: '#7c3aed', hint: '잘한 점·못한 점·다음 개선 사항' },
};

const STATUS_META: Record<JournalStatus, { label: string; color: string; next?: JournalStatus; nextLabel?: string }> = {
  watching: { label: '관찰 중', color: '#6b7280', next: 'active',  nextLabel: '매수 완료' },
  active:   { label: '보유 중', color: '#16a34a', next: 'closed', nextLabel: '매도 완료' },
  closed:   { label: '완료',    color: '#6366f1' },
};

const krw = (v: number) => v.toLocaleString('ko-KR', { maximumFractionDigits: 0 });

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────

export function TradeJournalTab() {
  const [journals, setJournals] = useState<JournalSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<JournalStatus | 'all'>('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<JournalDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = filterStatus !== 'all' ? `?status=${filterStatus}` : '';
      const res = await fetch(`/api/journals${params}`);
      const json = await res.json() as { ok: boolean; data: JournalSummary[] };
      if (json.ok) setJournals(json.data);
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  useEffect(() => { void load(); }, [load]);

  // 일지 상세 로드
  async function openDetail(id: number) {
    if (expandedId === id) { setExpandedId(null); setDetail(null); return; }
    setExpandedId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/journals/${id}`);
      const json = await res.json() as { ok: boolean; data: JournalDetail };
      if (json.ok) setDetail(json.data);
    } finally {
      setDetailLoading(false);
    }
  }

  // 새 일지 생성
  useEffect(() => {
    if (searchQ.length < 1) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/symbols/search?q=${encodeURIComponent(searchQ)}`);
      const json = await res.json() as { ok: boolean; results: SearchResult[] };
      if (json.ok) setSearchResults(json.results.slice(0, 5));
    }, 300);
    return () => clearTimeout(t);
  }, [searchQ]);

  async function createJournal(symbol: string) {
    setCreating(true);
    try {
      const res = await fetch('/api/journals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });
      const json = await res.json() as { ok: boolean; id: number };
      if (json.ok) {
        setShowNewForm(false);
        setSearchQ('');
        setSearchResults([]);
        await load();
        void openDetail(json.id);
      }
    } finally {
      setCreating(false);
    }
  }

  async function deleteJournal(id: number) {
    if (!confirm('이 거래 일지를 삭제하시겠습니까?')) return;
    await fetch(`/api/journals/${id}`, { method: 'DELETE' });
    if (expandedId === id) { setExpandedId(null); setDetail(null); }
    setJournals((j) => j.filter((x) => x.id !== id));
  }

  const counts = {
    all: journals.length,
    watching: journals.filter((j) => j.status === 'watching').length,
    active: journals.filter((j) => j.status === 'active').length,
    closed: journals.filter((j) => j.status === 'closed').length,
  };

  return (
    <div style={S.wrap}>
      {/* 상단: 필터 + 새 일지 */}
      <div style={S.topBar}>
        <div style={S.statusTabs}>
          {(['all', 'watching', 'active', 'closed'] as const).map((s) => (
            <button
              key={s}
              style={{
                ...S.statusTab,
                background: filterStatus === s ? 'var(--accent)' : 'var(--bg3)',
                color: filterStatus === s ? '#000' : 'var(--muted)',
              }}
              onClick={() => setFilterStatus(s)}
            >
              {s === 'all' ? '전체' : STATUS_META[s].label}
              <span style={S.tabCount}>{counts[s]}</span>
            </button>
          ))}
        </div>
        <button style={S.newBtn} onClick={() => setShowNewForm(true)}>+ 새 일지</button>
      </div>

      {/* 새 일지 생성 폼 */}
      {showNewForm && (
        <div style={S.newForm}>
          <div style={{ position: 'relative' }}>
            <input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="종목 검색 (이름 또는 코드)..."
              style={S.input}
              autoFocus
            />
            {searchResults.length > 0 && (
              <div style={S.dropdown}>
                {searchResults.map((r) => (
                  <button
                    key={r.symbol}
                    style={S.dropItem}
                    onClick={() => void createJournal(r.symbol)}
                    disabled={creating}
                  >
                    <span style={{ fontWeight: 700, color: 'var(--accent)', marginRight: 8, fontSize: 12 }}>
                      {formatSymbolShort(r.symbol)}
                    </span>
                    <span>{r.name}</span>
                    <span style={S.marketTag}>{r.market === 'overseas' ? '해외' : '국내'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button style={S.cancelBtn} onClick={() => { setShowNewForm(false); setSearchQ(''); setSearchResults([]); }}>
            취소
          </button>
        </div>
      )}

      {/* 일지 목록 */}
      {loading ? (
        <div style={S.center}>로딩 중...</div>
      ) : journals.length === 0 ? (
        <div style={S.center}>
          {filterStatus === 'all' ? '거래 일지가 없습니다. 새 일지를 만들어보세요.' : '해당 상태의 일지가 없습니다.'}
        </div>
      ) : (
        <div style={S.list}>
          {journals.map((j) => (
            <JournalCard
              key={j.id}
              journal={j}
              isExpanded={expandedId === j.id}
              detail={expandedId === j.id ? detail : null}
              detailLoading={expandedId === j.id && detailLoading}
              onToggle={() => void openDetail(j.id)}
              onDelete={() => void deleteJournal(j.id)}
              onRefresh={async () => {
                await load();
                if (expandedId === j.id) {
                  setDetail(null);
                  setDetailLoading(true);
                  const res = await fetch(`/api/journals/${j.id}`);
                  const json = await res.json() as { ok: boolean; data: JournalDetail };
                  if (json.ok) setDetail(json.data);
                  setDetailLoading(false);
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 일지 카드 ────────────────────────────────────────────────────────────

function JournalCard({
  journal, isExpanded, detail, detailLoading, onToggle, onDelete, onRefresh,
}: {
  journal: JournalSummary;
  isExpanded: boolean;
  detail: JournalDetail | null;
  detailLoading: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onRefresh: () => Promise<void>;
}) {
  const sm = STATUS_META[journal.status];
  const pnlColor = journal.pnl_pct == null ? 'var(--fg)'
    : journal.pnl_pct > 0 ? 'var(--red)' : journal.pnl_pct < 0 ? 'var(--blue)' : 'var(--fg)';

  return (
    <div style={{ ...S.card, borderLeft: `3px solid ${sm.color}` }}>
      {/* 카드 헤더 (항상 표시) */}
      <div style={S.cardHead} onClick={onToggle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={S.cardTitle}>
            <span style={S.symbolName}>{journal.name ?? formatSymbolShort(journal.symbol)}</span>
            <span style={S.symbolCode}>{formatSymbolShort(journal.symbol)}</span>
            <span style={{ ...S.statusBadge, background: sm.color + '22', color: sm.color }}>{sm.label}</span>
            {journal.pnl_pct != null && (
              <span style={{ fontSize: 12, fontWeight: 700, color: pnlColor }}>
                {journal.pnl_pct > 0 ? '+' : ''}{journal.pnl_pct.toFixed(2)}%
              </span>
            )}
          </div>
          {/* 마지막 메모 미리보기 */}
          {journal.last_content && (
            <div style={S.preview}>
              {journal.last_phase && (
                <span style={{ ...S.phaseMini, color: PHASE_META[journal.last_phase].color }}>
                  {PHASE_META[journal.last_phase].icon} {PHASE_META[journal.last_phase].label}
                </span>
              )}
              {journal.last_content.slice(0, 60)}{journal.last_content.length > 60 ? '...' : ''}
            </div>
          )}
          <div style={S.cardMeta}>
            <span>메모 {journal.entry_count}개</span>
            {journal.last_entry_at && (
              <span>{new Date(journal.last_entry_at).toLocaleDateString('ko-KR')}</span>
            )}
            {journal.entry_price != null && <span>매수 {krw(journal.entry_price)}원</span>}
            {journal.exit_price != null && <span>매도 {krw(journal.exit_price)}원</span>}
          </div>
        </div>
        <div style={S.cardActions}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{isExpanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* 펼쳐진 상세 뷰 */}
      {isExpanded && (
        <JournalDetail
          journal={journal}
          detail={detail}
          loading={detailLoading}
          onRefresh={onRefresh}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}

// ─── 일지 상세 뷰 ─────────────────────────────────────────────────────────

function JournalDetail({
  journal, detail, loading, onRefresh, onDelete,
}: {
  journal: JournalSummary;
  detail: JournalDetail | null;
  loading: boolean;
  onRefresh: () => Promise<void>;
  onDelete: () => void;
}) {
  const [addPhase, setAddPhase] = useState<Phase | null>(null);
  const [content, setContent] = useState('');
  const [priceAt, setPriceAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [editEntry, setEditEntry] = useState<JournalEntry | null>(null);
  const [editContent, setEditContent] = useState('');

  async function addEntry() {
    if (!addPhase || !content.trim()) return;
    setSaving(true);
    try {
      await fetch(`/api/journals/${journal.id}/entries`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          phase: addPhase,
          content: content.trim(),
          price_at: priceAt ? Number(priceAt) : undefined,
        }),
      });
      setAddPhase(null);
      setContent('');
      setPriceAt('');
      await onRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function updateEntry() {
    if (!editEntry || !editContent.trim()) return;
    setSaving(true);
    try {
      await fetch(`/api/journals/${journal.id}/entries/${editEntry.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: editContent.trim() }),
      });
      setEditEntry(null);
      setEditContent('');
      await onRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(entryId: number) {
    await fetch(`/api/journals/${journal.id}/entries/${entryId}`, { method: 'DELETE' });
    await onRefresh();
  }

  async function updateStatus(next: JournalStatus, extra?: { entry_price?: number; exit_price?: number; pnl_pct?: number }) {
    await fetch(`/api/journals/${journal.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: next, ...extra }),
    });
    await onRefresh();
  }

  const sm = STATUS_META[journal.status];

  return (
    <div style={S.detail}>
      {/* 단계 스텝 표시 */}
      <div style={S.stepBar}>
        {PHASE_ORDER.map((p) => {
          const pm = PHASE_META[p];
          const hasEntries = detail?.entries.some((e) => e.phase === p);
          return (
            <button
              key={p}
              style={{
                ...S.stepBtn,
                borderBottom: addPhase === p ? `2px solid ${pm.color}` : '2px solid transparent',
                color: hasEntries ? pm.color : 'var(--muted)',
                fontWeight: hasEntries ? 700 : 400,
              }}
              onClick={() => { setAddPhase(addPhase === p ? null : p); setContent(''); }}
              title={pm.hint}
            >
              {pm.icon} {pm.label}
              {hasEntries && <span style={{ ...S.dot, background: pm.color }} />}
            </button>
          );
        })}
      </div>

      {/* 메모 입력 폼 */}
      {addPhase && (
        <div style={S.entryForm}>
          <div style={S.formHint}>{PHASE_META[addPhase].hint}</div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={`${PHASE_META[addPhase].label} 메모를 입력하세요...`}
            style={S.textarea}
            rows={3}
            autoFocus
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="number"
              value={priceAt}
              onChange={(e) => setPriceAt(e.target.value)}
              placeholder="가격 (선택)"
              style={{ ...S.input, width: 140, fontSize: 12 }}
            />
            <button style={S.saveBtn} onClick={() => void addEntry()} disabled={saving || !content.trim()}>
              {saving ? '저장 중...' : '저장'}
            </button>
            <button style={S.cancelBtn} onClick={() => { setAddPhase(null); setContent(''); }}>취소</button>
          </div>
        </div>
      )}

      {/* 타임라인 */}
      {loading && <div style={S.center}>로딩 중...</div>}
      {!loading && detail && (
        <div style={S.timeline}>
          {detail.entries.length === 0 && (
            <div style={{ ...S.center, padding: '12px 0', fontSize: 12 }}>
              위 단계 버튼을 눌러 첫 메모를 작성하세요.
            </div>
          )}
          {detail.entries.map((entry) => {
            const pm = PHASE_META[entry.phase];
            const isEditing = editEntry?.id === entry.id;
            return (
              <div key={entry.id} style={S.timelineItem}>
                <div style={{ ...S.timelineDot, background: pm.color }} />
                <div style={S.timelineBody}>
                  <div style={S.entryHeader}>
                    <span style={{ ...S.phaseTag, color: pm.color, background: pm.color + '18' }}>
                      {pm.icon} {pm.label}
                    </span>
                    {entry.price_at != null && (
                      <span style={S.entryPrice}>{krw(entry.price_at)}원</span>
                    )}
                    <span style={S.entryDate}>
                      {new Date(entry.created_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                      <button style={S.iconBtn} onClick={() => { setEditEntry(entry); setEditContent(entry.content); }}>✏️</button>
                      <button style={S.iconBtn} onClick={() => void deleteEntry(entry.id)}>🗑</button>
                    </div>
                  </div>
                  {isEditing ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        style={S.textarea}
                        rows={3}
                        autoFocus
                      />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button style={S.saveBtn} onClick={() => void updateEntry()} disabled={saving}>저장</button>
                        <button style={S.cancelBtn} onClick={() => { setEditEntry(null); setEditContent(''); }}>취소</button>
                      </div>
                    </div>
                  ) : (
                    <div style={S.entryContent}>{entry.content}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 하단 액션 */}
      <div style={S.detailFooter}>
        {sm.next && (
          <button
            style={{ ...S.statusBtn, background: STATUS_META[sm.next].color + '22', color: STATUS_META[sm.next].color }}
            onClick={() => void updateStatus(sm.next!)}
          >
            {sm.nextLabel} →
          </button>
        )}
        <button style={S.deleteBtn} onClick={onDelete}>일지 삭제</button>
      </div>
    </div>
  );
}

// ─── 스타일 ──────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  wrap:        { display: 'flex', flexDirection: 'column', gap: 12 },
  topBar:      { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  statusTabs:  { display: 'flex', gap: 6, flexWrap: 'wrap' },
  statusTab:   { padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 },
  tabCount:    { fontSize: 10, background: 'rgba(0,0,0,0.15)', borderRadius: 10, padding: '0 5px' },
  newBtn:      { padding: '8px 14px', background: 'var(--accent)', border: 'none', borderRadius: 10, color: '#000', fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' },
  newForm:     { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' },
  input:       { width: '100%', boxSizing: 'border-box', padding: '9px 12px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--fg)', fontSize: 13 },
  dropdown:    { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, marginTop: 3, overflow: 'hidden' },
  dropItem:    { display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '9px 12px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--fg)', fontSize: 13, borderBottom: '1px solid var(--border)', textAlign: 'left' },
  marketTag:   { marginLeft: 'auto', fontSize: 10, color: 'var(--muted)', background: 'var(--bg3)', padding: '1px 6px', borderRadius: 8 },
  cancelBtn:   { padding: '8px 14px', background: 'var(--bg3)', border: 'none', borderRadius: 8, color: 'var(--muted)', fontSize: 12, cursor: 'pointer' },
  center:      { textAlign: 'center', padding: '24px 0', color: 'var(--muted)', fontSize: 13 },
  list:        { display: 'flex', flexDirection: 'column', gap: 8 },
  card:        { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' },
  cardHead:    { padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 8 },
  cardTitle:   { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  symbolName:  { fontSize: 14, fontWeight: 700, color: 'var(--fg)' },
  symbolCode:  { fontSize: 11, color: 'var(--muted)' },
  statusBadge: { fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20 },
  preview:     { fontSize: 12, color: 'var(--muted)', marginTop: 4, lineHeight: 1.4 },
  phaseMini:   { fontWeight: 700, marginRight: 4 },
  cardMeta:    { display: 'flex', gap: 10, marginTop: 4, fontSize: 11, color: 'var(--muted)' },
  cardActions: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 },
  detail:      { borderTop: '1px solid var(--border)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 },
  stepBar:     { display: 'flex', gap: 2, overflowX: 'auto', scrollbarWidth: 'none' },
  stepBtn:     { flexShrink: 0, padding: '6px 10px', background: 'transparent', border: 'none', borderBottom: '2px solid transparent', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 3, position: 'relative' },
  dot:         { width: 5, height: 5, borderRadius: '50%', position: 'absolute', top: 3, right: 3 },
  entryForm:   { background: 'var(--bg3)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 },
  formHint:    { fontSize: 11, color: 'var(--muted)' },
  textarea:    { padding: '8px 10px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--fg)', fontSize: 13, resize: 'vertical', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' },
  saveBtn:     { padding: '7px 14px', background: 'var(--accent)', border: 'none', borderRadius: 8, color: '#000', fontWeight: 700, fontSize: 12, cursor: 'pointer' },
  timeline:    { display: 'flex', flexDirection: 'column', gap: 0 },
  timelineItem:{ display: 'flex', gap: 10, paddingBottom: 12 },
  timelineDot: { width: 10, height: 10, borderRadius: '50%', marginTop: 5, flexShrink: 0 },
  timelineBody:{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 },
  entryHeader: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  phaseTag:    { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20 },
  entryPrice:  { fontSize: 11, color: 'var(--muted)' },
  entryDate:   { fontSize: 10, color: 'var(--muted)' },
  entryContent:{ fontSize: 13, color: 'var(--fg)', lineHeight: 1.6, whiteSpace: 'pre-wrap' },
  iconBtn:     { background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, padding: '0 2px', opacity: 0.7 },
  detailFooter:{ display: 'flex', gap: 8, justifyContent: 'space-between', paddingTop: 4 },
  statusBtn:   { padding: '7px 14px', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer' },
  deleteBtn:   { padding: '7px 14px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--muted)', fontSize: 12, cursor: 'pointer' },
};
