'use client';

import { useEffect, useState, useCallback } from 'react';
import { formatSymbolShort } from '@/lib/symbols';

type NoteType = 'buy_reason' | 'stop_loss_plan' | 'sell_reason' | 'price_movement' | 'general';

interface Note {
  id: number;
  symbol: string;
  type: NoteType;
  title: string | null;
  content: string;
  price_at: number | null;
  signal_id: number | null;
  created_at: string;
}

interface SearchResult { symbol: string; name: string; market: string }

const TYPE_LABELS: Record<NoteType | 'all', string> = {
  all:            '전체',
  buy_reason:     '매수 이유',
  stop_loss_plan: '손절 계획',
  sell_reason:    '매도 이유',
  price_movement: '주가 변동',
  general:        '메모',
};

const TYPE_COLORS: Record<NoteType, string> = {
  buy_reason:     '#16a34a',
  stop_loss_plan: '#dc2626',
  sell_reason:    '#2563eb',
  price_movement: '#d97706',
  general:        '#6b7280',
};

export function TradeNotesTab() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSymbol, setFilterSymbol] = useState('');
  const [filterType, setFilterType] = useState<NoteType | 'all'>('all');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);

  // 폼 상태
  const [fSymbol, setFSymbol] = useState('');
  const [fType, setFType] = useState<NoteType>('general');
  const [fTitle, setFTitle] = useState('');
  const [fContent, setFContent] = useState('');
  const [fSaving, setFSaving] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterSymbol) params.set('symbol', filterSymbol);
      if (filterType !== 'all') params.set('type', filterType);
      const res = await fetch(`/api/notes?${params.toString()}`);
      const json = await res.json() as { ok: boolean; data: Note[] };
      if (json.ok) setNotes(json.data);
    } finally {
      setLoading(false);
    }
  }, [filterSymbol, filterType]);

  useEffect(() => { void load(); }, [load]);

  // 심볼 검색 (폼)
  useEffect(() => {
    if (fSymbol.length < 1) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/symbols/search?q=${encodeURIComponent(fSymbol)}`);
      const json = await res.json() as { ok: boolean; results: SearchResult[] };
      if (json.ok) setSearchResults(json.results.slice(0, 5));
    }, 300);
    return () => clearTimeout(timer);
  }, [fSymbol]);

  async function saveNote() {
    if (!fSymbol || !fContent.trim()) return;
    setFSaving(true);
    try {
      if (editId != null) {
        await fetch(`/api/notes/${editId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: fType, title: fTitle || undefined, content: fContent }),
        });
      } else {
        await fetch('/api/notes', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ symbol: fSymbol, type: fType, title: fTitle || undefined, content: fContent }),
        });
      }
      resetForm();
      void load();
    } finally {
      setFSaving(false);
    }
  }

  async function deleteNote(id: number) {
    await fetch(`/api/notes/${id}`, { method: 'DELETE' });
    setNotes((n) => n.filter((x) => x.id !== id));
  }

  function openEdit(note: Note) {
    setEditId(note.id);
    setFSymbol(note.symbol);
    setFType(note.type);
    setFTitle(note.title ?? '');
    setFContent(note.content);
    setShowForm(true);
  }

  function resetForm() {
    setShowForm(false);
    setEditId(null);
    setFSymbol(''); setFType('general'); setFTitle(''); setFContent('');
    setSearchResults([]);
  }

  const krw = (v: number) => v.toLocaleString('ko-KR', { maximumFractionDigits: 0 });

  return (
    <div style={S.wrap}>
      {/* 필터 */}
      <div style={S.filterRow}>
        <input
          value={filterSymbol}
          onChange={(e) => setFilterSymbol(e.target.value)}
          placeholder="종목 코드 필터..."
          style={S.filterInput}
        />
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as NoteType | 'all')}
          style={S.select}
        >
          {(Object.keys(TYPE_LABELS) as Array<NoteType | 'all'>).map((k) => (
            <option key={k} value={k}>{TYPE_LABELS[k]}</option>
          ))}
        </select>
        <button style={S.addBtn} onClick={() => { setShowForm(true); setEditId(null); }}>+ 작성</button>
      </div>

      {/* 작성 폼 */}
      {showForm && (
        <div style={S.form}>
          <div style={{ position: 'relative' }}>
            <input
              value={fSymbol}
              onChange={(e) => setFSymbol(e.target.value)}
              placeholder="종목 검색..."
              style={{ ...S.filterInput, width: '100%', boxSizing: 'border-box' }}
              readOnly={editId != null}
            />
            {searchResults.length > 0 && (
              <div style={S.dropdown}>
                {searchResults.map((r) => (
                  <button key={r.symbol} style={S.dropItem} onClick={() => { setFSymbol(r.symbol); setSearchResults([]); }}>
                    <span style={{ fontWeight: 700, marginRight: 6 }}>{formatSymbolShort(r.symbol)}</span>
                    {r.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <select value={fType} onChange={(e) => setFType(e.target.value as NoteType)} style={S.select}>
            {(Object.keys(TYPE_LABELS).filter((k) => k !== 'all') as NoteType[]).map((k) => (
              <option key={k} value={k}>{TYPE_LABELS[k]}</option>
            ))}
          </select>
          <input
            value={fTitle}
            onChange={(e) => setFTitle(e.target.value)}
            placeholder="제목 (선택)"
            style={S.filterInput}
          />
          <textarea
            value={fContent}
            onChange={(e) => setFContent(e.target.value)}
            placeholder="내용을 입력하세요..."
            style={S.textarea}
            rows={4}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={S.saveBtn} onClick={() => void saveNote()} disabled={fSaving}>
              {fSaving ? '저장 중...' : editId != null ? '수정' : '저장'}
            </button>
            <button style={S.cancelBtn} onClick={resetForm}>취소</button>
          </div>
        </div>
      )}

      {/* 메모 목록 */}
      {loading ? (
        <div style={S.center}>로딩 중...</div>
      ) : notes.length === 0 ? (
        <div style={S.center}>메모가 없습니다.</div>
      ) : (
        <div style={S.list}>
          {notes.map((note) => (
            <div key={note.id} style={S.noteCard}>
              <div style={S.noteHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ ...S.typeBadge, background: TYPE_COLORS[note.type] + '22', color: TYPE_COLORS[note.type] }}>
                    {TYPE_LABELS[note.type]}
                  </span>
                  <span style={S.noteSymbol}>{formatSymbolShort(note.symbol)}</span>
                  {note.price_at != null && (
                    <span style={S.notePrice}>{krw(note.price_at)}원</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={S.iconBtn} onClick={() => openEdit(note)}>✏️</button>
                  <button style={S.iconBtn} onClick={() => void deleteNote(note.id)}>🗑</button>
                </div>
              </div>
              {note.title && <div style={S.noteTitle}>{note.title}</div>}
              <div style={S.noteContent}>{note.content}</div>
              <div style={S.noteDate}>
                {new Date(note.created_at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 12 },
  filterRow: { display: 'flex', gap: 8, alignItems: 'center' },
  filterInput: {
    flex: 1, padding: '8px 12px', background: 'var(--bg2)',
    border: '1px solid var(--border)', borderRadius: 8, color: 'var(--fg)', fontSize: 13,
  },
  select: {
    padding: '8px 10px', background: 'var(--bg2)', border: '1px solid var(--border)',
    borderRadius: 8, color: 'var(--fg)', fontSize: 13,
  },
  addBtn: {
    padding: '8px 14px', background: 'var(--accent)', border: 'none',
    borderRadius: 8, color: '#000', fontWeight: 700, fontSize: 13, cursor: 'pointer',
  },
  form: {
    background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12,
    padding: 14, display: 'flex', flexDirection: 'column', gap: 8, position: 'relative',
  },
  dropdown: {
    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
    background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, marginTop: 2,
  },
  dropItem: {
    display: 'block', width: '100%', padding: '8px 12px',
    background: 'transparent', border: 'none', cursor: 'pointer',
    textAlign: 'left', color: 'var(--fg)', fontSize: 13,
    borderBottom: '1px solid var(--border)',
  },
  textarea: {
    padding: '8px 12px', background: 'var(--bg3)', border: '1px solid var(--border)',
    borderRadius: 8, color: 'var(--fg)', fontSize: 13, resize: 'vertical',
    fontFamily: 'inherit',
  },
  saveBtn: {
    padding: '8px 16px', background: 'var(--accent)', border: 'none',
    borderRadius: 8, color: '#000', fontWeight: 700, fontSize: 13, cursor: 'pointer',
  },
  cancelBtn: {
    padding: '8px 16px', background: 'var(--bg3)', border: 'none',
    borderRadius: 8, color: 'var(--muted)', fontSize: 13, cursor: 'pointer',
  },
  center: { textAlign: 'center', padding: 24, color: 'var(--muted)' },
  list: { display: 'flex', flexDirection: 'column', gap: 10 },
  noteCard: {
    background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12,
    padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6,
  },
  noteHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  typeBadge: { fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 20 },
  noteSymbol: { fontSize: 12, fontWeight: 700, color: 'var(--accent)' },
  notePrice: { fontSize: 11, color: 'var(--muted)' },
  noteTitle: { fontSize: 13, fontWeight: 700, color: 'var(--fg)' },
  noteContent: { fontSize: 13, color: 'var(--fg)', lineHeight: 1.6, whiteSpace: 'pre-wrap' },
  noteDate: { fontSize: 10, color: 'var(--muted)' },
  iconBtn: { background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14, padding: 2 },
};
