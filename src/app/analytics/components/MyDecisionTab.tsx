'use client';

import { useEffect, useState } from 'react';
import { formatRelativeTime } from '@/lib/time';
import { useSymbolMeta } from '@/lib/hooks/useSymbolMeta';
import { fmtNum } from '@/lib/format';

type Period = '1d' | '7d' | '30d';
type FilterType = 'all' | 'approved' | 'rejected' | 'expired';

const PERIOD_LABEL: Record<Period, string> = { '1d': '1일', '7d': '7일', '30d': '30일' };
const PAGE_SIZE = 7;

interface DecisionSignal {
  id: number;
  symbol: string;
  side: 'buy' | 'sell';
  status: string;
  amount_krw: string;
  price_change_pct: string | null;
  created_at: string;
}

function isApproved(status: string): boolean {
  return ['approved', 'approved_pending_entry', 'executing', 'auto_submitted'].includes(status);
}

function decisionBadge(status: string): { text: string; bg: string; color: string } {
  if (isApproved(status)) return { text: '승인', bg: 'rgba(96,165,250,0.15)', color: '#60a5fa' };
  if (status === 'rejected') return { text: '거절', bg: 'rgba(100,100,100,0.12)', color: 'var(--muted)' };
  return { text: '만료', bg: 'rgba(100,100,100,0.10)', color: 'var(--muted)' };
}

function outcomeText(status: string): { text: string; color: string } | null {
  switch (status) {
    case 'approved_pending_entry': return { text: '진입 감시 중', color: '#fbbf24' };
    case 'executing':              return { text: '주문 실행됨',   color: 'var(--up)' };
    case 'auto_submitted':         return { text: '자동 제출됨',   color: 'var(--up)' };
    case 'approved':               return { text: '즉시 승인',     color: 'var(--up)' };
    default: return null;
  }
}

function sinceMs(period: Period): number {
  if (period === '1d') {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime() - 9 * 3600_000;
  }
  return Date.now() - (period === '7d' ? 7 : 30) * 86_400_000;
}

function DecisionCard({ sig, displaySymbol, marketFlag }: {
  sig: DecisionSignal;
  displaySymbol: (s: string) => string;
  marketFlag: (s: string) => string;
}) {
  const badge    = decisionBadge(sig.status);
  const outcome  = outcomeText(sig.status);
  const rejected = sig.status === 'rejected';
  const expired  = sig.status === 'expired';

  const pct = sig.price_change_pct != null ? Number(sig.price_change_pct) : null;
  const pctColor = pct == null ? 'var(--muted)' : pct > 3 ? '#f97316' : pct < -3 ? 'var(--down)' : 'var(--muted)';

  const flag = marketFlag(sig.symbol);

  return (
    <div style={{
      background: 'var(--bg2)',
      borderRadius: 10,
      border: '1px solid var(--border)',
      overflow: 'hidden',
      opacity: expired ? 0.65 : 1,
    }}>
      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>

        {/* 행1: 매수/매도 + 심볼 (말줄임) | 상대시간 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{
            flexShrink: 0,
            fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
            background: sig.side === 'buy' ? 'rgba(239,68,68,0.15)' : 'rgba(59,130,246,0.15)',
            color: sig.side === 'buy' ? 'var(--up)' : 'var(--down)',
          }}>
            {sig.side === 'buy' ? '매수' : '매도'}
          </span>
          {flag && (
            <span style={{ flexShrink: 0, fontSize: 12 }} aria-hidden>{flag}</span>
          )}
          <span style={{
            fontSize: 13, fontWeight: 700,
            flex: 1, minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {displaySymbol(sig.symbol)}
          </span>
          <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--muted)' }}>
            {formatRelativeTime(sig.created_at)}
          </span>
        </div>

        {/* 행2: 결정 뱃지 + 결과 | 투자금 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{
            flexShrink: 0,
            fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 10,
            background: badge.bg, color: badge.color,
          }}>
            {badge.text}
          </span>

          <span style={{ fontSize: 11, color: 'var(--muted)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {isApproved(sig.status) && outcome && (
              <span style={{ color: outcome.color }}>{outcome.text}</span>
            )}
            {rejected && pct != null && (
              <span style={{ color: pctColor }}>
                1h 후: {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
              </span>
            )}
            {rejected && pct == null && '거절됨'}
            {expired && '만료 — 조치 없음'}
          </span>

          <span style={{ flexShrink: 0, fontSize: 11, color: 'var(--muted)' }}>
            {fmtNum(Number(sig.amount_krw))}원
          </span>
        </div>

      </div>
    </div>
  );
}

export function MyDecisionTab() {
  const [period, setPeriod]   = useState<Period>('7d');
  const [signals, setSignals] = useState<DecisionSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState<FilterType>('all');
  const [page, setPage]       = useState(0);
  const { displaySymbol, marketFlag } = useSymbolMeta();

  useEffect(() => {
    setLoading(true);
    setPage(0);
    const statuses = 'approved,rejected,approved_pending_entry,executing,expired,auto_submitted';
    const since    = new Date(sinceMs(period)).toISOString();
    fetch(`/api/signals?status=${statuses}&since=${since}&limit=200`)
      .then(r => r.json())
      .then(d => { if (d.ok) setSignals(d.data as DecisionSignal[]); })
      .finally(() => setLoading(false));
  }, [period]);

  // 필터 변경 시 첫 페이지로
  useEffect(() => { setPage(0); }, [filter]);

  const counts = {
    all:      signals.length,
    approved: signals.filter(s => isApproved(s.status)).length,
    rejected: signals.filter(s => s.status === 'rejected').length,
    expired:  signals.filter(s => s.status === 'expired').length,
  };

  const filtered = signals.filter(s => {
    if (filter === 'all')      return true;
    if (filter === 'approved') return isApproved(s.status);
    if (filter === 'rejected') return s.status === 'rejected';
    if (filter === 'expired')  return s.status === 'expired';
    return true;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const FILTERS: { id: FilterType; label: string }[] = [
    { id: 'all',      label: `전체 ${counts.all}` },
    { id: 'approved', label: `승인 ${counts.approved}` },
    { id: 'rejected', label: `거절 ${counts.rejected}` },
    { id: 'expired',  label: `만료 ${counts.expired}` },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* 기간 토글 */}
      <div style={{ display: 'flex', gap: 6 }}>
        {(['1d', '7d', '30d'] as Period[]).map(p => (
          <button key={p} onClick={() => setPeriod(p)} style={{
            padding: '5px 14px', borderRadius: 16, fontSize: 12, fontWeight: 600,
            background: period === p ? 'var(--accent)' : 'var(--bg3)',
            color: period === p ? '#000' : 'var(--muted)',
            border: 'none', cursor: 'pointer',
          }}>
            {PERIOD_LABEL[p]}
          </button>
        ))}
      </div>

      {/* 필터 탭 (카운트 포함, 요약 칩과 통합) */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {FILTERS.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            padding: '5px 14px', borderRadius: 16, fontSize: 12, fontWeight: 600,
            background: filter === f.id ? 'var(--bg3)' : 'transparent',
            color: filter === f.id ? 'var(--text)' : 'var(--muted)',
            border: `1px solid ${filter === f.id ? 'var(--border)' : 'transparent'}`,
            cursor: 'pointer',
          }}>
            {f.label}
          </button>
        ))}
      </div>

      {/* 로딩 */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>
          불러오는 중...
        </div>
      )}

      {/* 빈 상태 */}
      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>
          해당 기간 결정 내역 없음
        </div>
      )}

      {/* 카드 리스트 (7개/페이지) */}
      {!loading && paged.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {paged.map(sig => (
            <DecisionCard
              key={sig.id}
              sig={sig}
              displaySymbol={displaySymbol}
              marketFlag={marketFlag}
            />
          ))}
        </div>
      )}

      {/* 페이지네이션 */}
      {!loading && totalPages > 1 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 4,
        }}>
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              background: 'var(--bg3)', color: page === 0 ? 'var(--border)' : 'var(--muted)',
              border: '1px solid var(--border)', cursor: page === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            ← 이전
          </button>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              background: 'var(--bg3)', color: page >= totalPages - 1 ? 'var(--border)' : 'var(--muted)',
              border: '1px solid var(--border)', cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer',
            }}
          >
            다음 →
          </button>
        </div>
      )}

    </div>
  );
}
