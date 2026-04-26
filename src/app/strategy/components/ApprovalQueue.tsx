'use client';

import { useCallback, useEffect, useState } from 'react';
import { fmtNum } from '@/lib/format';
import type { Signal } from './SignalFeed';
import { useSymbolMeta } from '@/lib/hooks/useSymbolMeta';

interface Props {
  onCountChange: (n: number) => void;
}

function minutesUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.max(0, Math.floor((new Date(dateStr).getTime() - Date.now()) / 60000));
}

function ApprovalItem({
  signal,
  onApprove,
  onReject,
  displaySymbol,
  marketFlag,
}: {
  signal: Signal;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
  displaySymbol: (s: string) => string;
  marketFlag: (s: string) => string;
}) {
  const minsLeft = minutesUntil(signal.expires_at);

  return (
    <div style={{
      background: 'var(--bg2)', borderRadius: 12, padding: 14,
      border: '1px solid #f59e0b44',
    }}>
      {/* Expiry warning */}
      {minsLeft !== null && (
        <div style={{ fontSize: 12, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 10 }}>
          ⏱ {minsLeft}분 후 만료
        </div>
      )}

      {/* Symbol + direction row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 13, fontWeight: 700, padding: '4px 12px', borderRadius: 6,
            background: signal.side === 'buy' ? 'rgba(239,68,68,.18)' : 'rgba(59,130,246,.18)',
            color: signal.side === 'buy' ? 'var(--up)' : 'var(--down)',
          }}>{signal.side === 'buy' ? '매수' : '매도'}</span>
          <span style={{ fontSize: 16, fontWeight: 700 }}>
            {marketFlag(signal.symbol) && <span style={{ marginRight: 4 }} aria-hidden>{marketFlag(signal.symbol)}</span>}
            {displaySymbol(signal.symbol)}
          </span>
        </div>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          {signal.order_type === 'limit' ? '지정가' : '시장가'}
        </span>
      </div>

      {/* Amount + price */}
      <div style={{
        display: 'grid', gridTemplateColumns: signal.price ? '1fr 1fr' : '1fr', gap: 8,
        marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)',
      }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>주문 금액</div>
          <div className="num" style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>
            ₩{fmtNum(parseFloat(signal.amount_krw))}
          </div>
        </div>
        {signal.price && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>진입가</div>
            <div className="num" style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>
              {fmtNum(parseFloat(signal.price))}
            </div>
          </div>
        )}
      </div>

      {/* Reasoning */}
      {signal.reasoning && (
        <div style={{
          fontSize: 13, color: 'var(--text)', marginTop: 10, lineHeight: 1.6,
          padding: '8px 10px', background: 'var(--bg)', borderRadius: 8,
          border: '1px solid var(--border)',
        }}>
          {signal.reasoning}
        </div>
      )}

      {/* Buttons */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
        <button
          onClick={() => onApprove(signal.id)}
          style={{ height: 48, borderRadius: 8, fontSize: 15, fontWeight: 700, background: 'var(--up)', color: '#fff' }}
        >✓ 승인</button>
        <button
          onClick={() => onReject(signal.id)}
          style={{ height: 48, borderRadius: 8, fontSize: 15, fontWeight: 700, background: 'var(--bg3)', color: 'var(--muted)' }}
        >✗ 거부</button>
      </div>
    </div>
  );
}

export function ApprovalQueue({ onCountChange }: Props) {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const { displaySymbol, marketFlag } = useSymbolMeta();

  const fetchPending = useCallback(async () => {
    try {
      const res  = await fetch('/api/signals?status=pending&limit=100');
      const data = await res.json();
      if (data.ok) {
        const raw: Signal[] = data.data ?? [];
        const sorted = [...raw].sort((a, b) => {
          const at = a.expires_at ? new Date(a.expires_at).getTime() : Infinity;
          const bt = b.expires_at ? new Date(b.expires_at).getTime() : Infinity;
          return at - bt;
        });
        setSignals(sorted);
        onCountChange(sorted.length);
      }
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => { fetchPending(); }, [fetchPending]);

  const handleApprove = async (id: number) => {
    await fetch(`/api/signals/${id}/approve`, { method: 'POST' });
    fetchPending();
  };

  const handleReject = async (id: number) => {
    await fetch(`/api/signals/${id}/reject`, { method: 'POST' });
    fetchPending();
  };

  return (
    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0 4px' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
          승인 대기
        </span>
        {signals.length > 0 && (
          <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>{signals.length}건</span>
        )}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>불러오는 중…</div>
      )}

      {!loading && signals.length === 0 && (
        <div style={{
          textAlign: 'center', padding: 32, color: 'var(--muted)',
          background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>승인 대기 없음</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>분석가가 자동으로 처리 중</div>
        </div>
      )}

      {signals.map(s => (
        <ApprovalItem key={s.id} signal={s} onApprove={handleApprove} onReject={handleReject} displaySymbol={displaySymbol} marketFlag={marketFlag} />
      ))}
    </div>
  );
}
