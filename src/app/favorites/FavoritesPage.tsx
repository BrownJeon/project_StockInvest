'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { formatSymbolShort } from '@/lib/symbols';
import { isAwaitingApproval } from '@/lib/signals/statuses';
import { runFundamentalsRefresh } from './refresh-fundamentals';

interface KeyFactor {
  label: string;
  value: string;
  description: string;
}

interface LatestSignal {
  id: number;
  side: string;
  status: string;
  created_at: string;
}

interface Favorite {
  id: number;
  symbol: string;
  name: string | null;
  memo: string | null;
  added_at: string;
  market: string;
  price: number | null;
  priceUsd: number | null;
  changeRate: number | null;
  priceError?: boolean;
  latestSignal: LatestSignal | null;
  // fundamentals
  pbr: number | null;
  per: number | null;
  eps: number | null;
  market_cap_bn: number | null;
  dividend_yield: number | null;
  roe: number | null;
  key_factors: KeyFactor[] | null;
  ai_summary: string | null;
  data_source: string | null;
  fundamentals_updated_at: string | null;
}

interface SearchResult {
  symbol: string;
  name: string;
  market: string;
}

const krw = (v: number) => v.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
const usd = (v: number) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v: number) => (v > 0 ? '+' : '') + v.toFixed(2) + '%';

function getSignalLabel(signal: LatestSignal): { text: string; color: string } {
  const isPending = isAwaitingApproval(signal.status) || signal.status === 'detected';
  const isApproved =
    signal.status === 'approved' || signal.status === 'approved_pending_entry';
  const side = signal.side === 'buy' ? '매수' : '매도';
  if (isPending) return { text: `${side} 대기`, color: '#f59e0b' };
  if (isApproved) return { text: `${side} 승인`, color: '#22c55e' };
  return { text: side, color: 'var(--muted)' };
}

export function FavoritesPage() {
  const router = useRouter();
  const [items, setItems] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [expandedSummary, setExpandedSummary] = useState<Set<string>>(new Set());
  const [refreshProgress, setRefreshProgress] = useState<Map<string, { step: number; label: string }>>(new Map());

  function setProgress(symbol: string, info: { step: number; label: string } | null) {
    setRefreshProgress(prev => {
      const next = new Map(prev);
      if (info === null) next.delete(symbol);
      else next.set(symbol, info);
      return next;
    });
  }

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/favorites');
      const json = await res.json() as { ok: boolean; data: Favorite[] };
      if (json.ok) {
        setItems(json.data);
        setLastUpdated(new Date());
        setError(null);
      } else {
        setError('load failed');
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  // 심볼 검색
  useEffect(() => {
    if (searchQ.length < 1) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await fetch(`/api/symbols/search?q=${encodeURIComponent(searchQ)}`);
        const json = await res.json() as { ok: boolean; results: SearchResult[] };
        if (json.ok) setSearchResults(json.results.slice(0, 6));
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQ]);

  async function addFavorite(symbol: string) {
    await fetch('/api/favorites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ symbol }),
    });
    setSearchQ('');
    setSearchResults([]);
    void load();
  }

  async function removeFavorite(symbol: string, name: string | null) {
    const label = name ?? symbol;
    if (!confirm(`${label}을(를) 즐겨찾기에서 삭제할까요?`)) return;
    await fetch(`/api/favorites?symbol=${encodeURIComponent(symbol)}`, { method: 'DELETE' });
    setItems((prev) => prev.filter((i) => i.symbol !== symbol));
  }

  async function refreshFundamentals(symbol: string) {
    // 성공·실패 양쪽에서 load() 로 재동기화한다 — 실패해도 서버 캐시는 이미 비워졌으므로
    // 화면이 옛 값을 계속 보여주면 안 된다 (T-030).
    await runFundamentalsRefresh({
      symbol,
      setProgress: (info) => setProgress(symbol, info),
      resync: load,
    });
  }

  function toggleSummary(symbol: string) {
    setExpandedSummary((s) => {
      const n = new Set(s);
      if (n.has(symbol)) n.delete(symbol); else n.add(symbol);
      return n;
    });
  }

  if (loading) return <div style={S.center}>로딩 중...</div>;
  if (error) return <div style={S.center}>{error}</div>;

  return (
    <div style={S.page}>
      {/* 검색 추가 바 */}
      <div style={S.searchWrap}>
        <input
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          placeholder="종목명 또는 코드 검색..."
          style={S.searchInput}
        />
        {searchLoading && <span style={S.searchHint}>검색 중...</span>}
        {searchResults.length > 0 && (
          <div style={S.dropdown}>
            {searchResults.map((r) => (
              <button key={r.symbol} style={S.dropItem} onClick={() => void addFavorite(r.symbol)}>
                <span style={S.dropSymbol}>{formatSymbolShort(r.symbol)}</span>
                <span style={S.dropName}>{r.name}</span>
                <span style={S.dropMarket}>{r.market === 'overseas' ? '해외' : '국내'}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {lastUpdated && (
        <div style={S.lastUpdatedBar}>
          마지막 갱신: {lastUpdated.toLocaleTimeString('ko-KR')}
        </div>
      )}

      {items.length === 0 && (
        <div style={S.empty}>즐겨찾기가 없습니다. 위 검색창에서 종목을 추가해보세요.</div>
      )}

      {/* 카드 목록 */}
      <div style={S.list}>
        {items.map((item) => {
          const up = (item.changeRate ?? 0) > 0;
          const down = (item.changeRate ?? 0) < 0;
          const priceColor = up ? 'var(--red)' : down ? 'var(--blue)' : 'var(--fg)';
          const isExpanded = expandedSummary.has(item.symbol);
          const progress = refreshProgress.get(item.symbol) ?? null;
          const isRefreshing = progress !== null;
          const factors: KeyFactor[] = item.key_factors
            ? (typeof item.key_factors === 'string' ? JSON.parse(item.key_factors) : item.key_factors)
            : [];
          const sigLabel = item.latestSignal ? getSignalLabel(item.latestSignal) : null;

          return (
            <div
              key={item.symbol}
              style={{ ...S.card, cursor: 'pointer' }}
              onClick={() => router.push(`/favorites/${encodeURIComponent(item.symbol)}`)}
            >
              {/* 헤더 */}
              <div style={S.cardHeader}>
                <div>
                  <div style={S.cardTitle}>
                    {item.name ?? formatSymbolShort(item.symbol)}
                    <span style={S.cardCode}>{formatSymbolShort(item.symbol)}</span>
                    {/* 시그널 배지 */}
                    {sigLabel && (
                      <span style={{ ...S.signalBadge, background: sigLabel.color + '22', color: sigLabel.color }}>
                        {sigLabel.text}
                      </span>
                    )}
                  </div>
                  {item.price != null ? (
                    <div style={{ ...S.cardPrice, color: priceColor }}>
                      {item.market === 'overseas' && item.priceUsd != null
                        ? usd(item.priceUsd)
                        : krw(item.price) + '원'}
                      {item.changeRate != null && (
                        <span style={S.cardChange}>{pct(item.changeRate)}</span>
                      )}
                    </div>
                  ) : item.priceError ? (
                    <div style={S.priceErrorBadge}>● 조회 실패</div>
                  ) : null}
                </div>
                <button style={S.removeBtn} onClick={(e) => { e.stopPropagation(); void removeFavorite(item.symbol, item.name); }}>✕</button>
              </div>

              {/* 재무 지표 */}
              <div style={S.metricsRow}>
                <MetricChip label="PBR" value={item.pbr != null ? Number(item.pbr).toFixed(2) + 'x' : '—'} />
                <MetricChip label="PER" value={item.per != null ? Number(item.per).toFixed(1) + 'x' : '—'} />
                <MetricChip label="ROE" value={item.roe != null ? Number(item.roe).toFixed(1) + '%' : '—'} />
                {item.market_cap_bn != null && (
                  <MetricChip label="시총" value={Number(item.market_cap_bn) >= 10000 ? (Number(item.market_cap_bn) / 10000).toFixed(1) + '조' : Number(item.market_cap_bn).toLocaleString() + '억'} />
                )}
              </div>

              {/* 핵심 판단 요소 */}
              {factors.length > 0 && (
                <div style={S.factorsWrap}>
                  {factors.map((f, i) => (
                    <div key={i} style={S.factorChip} title={f.description}>
                      <span style={S.factorLabel}>{f.label}</span>
                      {f.value && <span style={S.factorValue}>{f.value}</span>}
                    </div>
                  ))}
                </div>
              )}

              {/* AI 가치 요약 */}
              {item.ai_summary && (
                <div>
                  <div
                    style={{ ...S.aiSummary, WebkitLineClamp: isExpanded ? undefined : 2, display: isExpanded ? 'block' : '-webkit-box' }}
                  >
                    {item.ai_summary}
                  </div>
                  {item.ai_summary.length > 100 && (
                    <button style={S.expandBtn} onClick={() => toggleSummary(item.symbol)}>
                      {isExpanded ? '접기' : '더보기'}
                    </button>
                  )}
                </div>
              )}

              {/* 하단: 진행상태(좌) + 갱신 버튼(우) */}
              <div style={S.cardFooter}>
                {isRefreshing && progress ? (
                  <div style={S.progressWrap}>
                    <div style={S.progressDots}>
                      {[1, 2, 3].map(n => (
                        <span
                          key={n}
                          style={{
                            width: 7, height: 7, borderRadius: '50%',
                            background: n <= progress.step ? '#f59e0b' : 'var(--bg3)',
                            transition: 'background 0.3s',
                            flexShrink: 0,
                          }}
                        />
                      ))}
                    </div>
                    <div style={S.progressText}>
                      <span style={S.progressStep}>{progress.step}/3</span>
                      <span style={S.progressLabel}>{progress.label}</span>
                    </div>
                  </div>
                ) : item.fundamentals_updated_at ? (
                  <span style={S.updatedAt}>
                    {new Date(item.fundamentals_updated_at).toLocaleDateString('ko-KR')} 기준
                  </span>
                ) : (
                  <span style={S.updatedAt}>재무 데이터 없음</span>
                )}
                <button
                  style={S.refreshBtn}
                  onClick={(e) => { e.stopPropagation(); void refreshFundamentals(item.symbol); }}
                  disabled={isRefreshing}
                >
                  {isRefreshing ? '...' : '재무 갱신'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 52 }}>
      <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg)' }}>{value}</div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { maxWidth: 480, margin: '0 auto', padding: '12px 16px', paddingBottom: 80 },
  center: { textAlign: 'center', padding: 40, color: 'var(--muted)' },
  searchWrap: { position: 'relative', marginBottom: 16 },
  searchInput: {
    width: '100%', boxSizing: 'border-box', padding: '10px 14px',
    background: 'var(--bg2)', border: '1px solid var(--border)',
    borderRadius: 10, color: 'var(--fg)', fontSize: 14,
  },
  searchHint: { position: 'absolute', right: 12, top: 11, fontSize: 11, color: 'var(--muted)' },
  dropdown: {
    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
    background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10,
    marginTop: 4, overflow: 'hidden',
  },
  dropItem: {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
    padding: '10px 14px', background: 'transparent', border: 'none',
    cursor: 'pointer', textAlign: 'left', color: 'var(--fg)', fontSize: 13,
    borderBottom: '1px solid var(--border)',
  },
  dropSymbol: { fontWeight: 700, color: 'var(--accent)', minWidth: 44, fontSize: 12 },
  dropName: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  dropMarket: { fontSize: 10, color: 'var(--muted)', background: 'var(--bg3)', padding: '2px 6px', borderRadius: 8 },
  empty: { textAlign: 'center', padding: '32px 16px', color: 'var(--muted)', fontSize: 13 },
  list: { display: 'flex', flexDirection: 'column', gap: 12 },
  card: {
    background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14,
    padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10,
  },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardTitle: { fontSize: 15, fontWeight: 700, color: 'var(--fg)', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  cardCode: { fontSize: 11, color: 'var(--muted)', fontWeight: 400 },
  cardPrice: { fontSize: 18, fontWeight: 700, marginTop: 4 },
  cardChange: { fontSize: 13, fontWeight: 600, marginLeft: 6 },
  removeBtn: {
    background: 'transparent', border: 'none', color: 'var(--muted)',
    fontSize: 16, cursor: 'pointer', padding: '0 4px', lineHeight: 1, flexShrink: 0,
  },
  signalBadge: {
    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
  },
  metricsRow: { display: 'flex', gap: 16, paddingTop: 2 },
  factorsWrap: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  factorChip: {
    display: 'flex', flexDirection: 'column', gap: 2,
    background: 'var(--bg3)', borderRadius: 8, padding: '5px 10px',
  },
  factorLabel: { fontSize: 11, color: 'var(--muted)', fontWeight: 600 },
  factorValue: { fontSize: 12, color: 'var(--accent)', fontWeight: 700 },
  aiSummary: {
    fontSize: 12, color: 'var(--muted)', lineHeight: 1.6,
    WebkitBoxOrient: 'vertical', overflow: 'hidden',
  },
  expandBtn: {
    background: 'transparent', border: 'none', color: 'var(--accent)',
    fontSize: 11, cursor: 'pointer', padding: '2px 0',
  },
  cardFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  updatedAt: { fontSize: 10, color: 'var(--muted)' },
  refreshBtn: {
    background: 'var(--bg3)', border: 'none', borderRadius: 8,
    color: 'var(--fg)', fontSize: 11, padding: '5px 10px', cursor: 'pointer',
    flexShrink: 0,
  },
  progressWrap: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  progressDots: { display: 'flex', gap: 4, flexShrink: 0 },
  progressText: { display: 'flex', alignItems: 'baseline', gap: 5, minWidth: 0 },
  progressStep: { fontSize: 10, fontWeight: 700, color: '#f59e0b', flexShrink: 0 },
  progressLabel: { fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  lastUpdatedBar: { fontSize: 10, color: 'var(--muted)', textAlign: 'right', marginBottom: 8 },
  priceErrorBadge: { fontSize: 12, color: 'var(--red)', marginTop: 4, fontWeight: 600 },
};
