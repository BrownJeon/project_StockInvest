'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fmtNum } from '@/lib/format';
import { OrderDetail } from '@/components/OrderDetail';
import type { Order } from '@/types/order';
import { useSymbolMeta } from '@/lib/hooks/useSymbolMeta';

const ACTIVE_STATUSES = new Set(['pending', 'accepted', 'partially_filled']);

const STATUS_META: Record<string, { text: string; color: string }> = {
  pending:          { text: '대기',     color: 'var(--accent)' },
  accepted:         { text: '접수됨',   color: 'var(--accent)' },
  partially_filled: { text: '부분체결', color: 'var(--ok)'     },
};

const SOURCE_META: Record<string, { text: string; color: string; bg: string }> = {
  auto:   { text: '자동',   color: 'var(--ok)',    bg: 'rgba(34,197,94,.18)'  },
  signal: { text: '시그널', color: '#818cf8',      bg: 'rgba(99,102,241,.18)' },
  manual: { text: '수동',   color: 'var(--muted)', bg: 'var(--bg3)'           },
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export function ActiveOrdersSection() {
  const [orders, setOrders]         = useState<Order[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState<Set<number>>(new Set());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { displaySymbol, marketFlag } = useSymbolMeta();

  const fetchOrders = useCallback(async () => {
    try {
      const res  = await fetch('/api/orders?limit=200');
      const data = await res.json();
      if (data.ok) {
        setOrders((data.data as Order[]).filter(o => ACTIVE_STATUSES.has(o.status)));
      }
    } catch { /* network error — keep stale data */ }
  }, []);

  useEffect(() => {
    fetchOrders();
    intervalRef.current = setInterval(fetchOrders, 30000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchOrders]);

  const handleCancel = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    setCancelling(prev => new Set(prev).add(id));
    try {
      await fetch(`/api/orders/${id}`, { method: 'DELETE' });
      fetchOrders();
    } finally {
      setCancelling(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  return (
    <>
      <div style={{ borderTop: '1px solid var(--border)', marginTop: 4 }}>
        {/* Section header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px 10px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
              ⚡ 진행 중 주문
            </span>
            {orders.length > 0 && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
                background: 'var(--up)', fontSize: 11, fontWeight: 700, color: '#fff',
              }}>{orders.length}</span>
            )}
          </div>
        </div>

        <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {orders.length === 0 ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: 12, borderRadius: 10,
              background: 'var(--bg2)', border: '1px dashed var(--border)',
              fontSize: 12, color: 'var(--muted)',
            }}>
              <span style={{ fontSize: 16 }}>🤖</span>
              <span>진행 중 없음 — 자동매매 대기 중</span>
            </div>
          ) : (
            orders.map(order => {
              const sm  = STATUS_META[order.status] ?? { text: order.status, color: 'var(--muted)' };
              const src = SOURCE_META[order.source] ?? SOURCE_META.manual;
              const canCancel = !!order.exchange_order_id &&
                (order.status === 'pending' || order.status === 'accepted');
              const amount = order.amount_krw
                ? `₩${fmtNum(parseFloat(order.amount_krw))}`
                : order.quantity ?? '-';

              return (
                <div
                  key={order.id}
                  onClick={() => setSelectedId(order.id)}
                  style={{
                    background: 'var(--bg2)', borderRadius: 10, padding: 12,
                    border: '1px solid var(--border)',
                    borderLeft: '3px solid var(--up)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 5,
                        background: order.side === 'buy' ? 'rgba(239,68,68,.18)' : 'rgba(59,130,246,.18)',
                        color: order.side === 'buy' ? 'var(--up)' : 'var(--down)',
                      }}>{order.side === 'buy' ? '매수' : '매도'}</span>
                      <span style={{ fontSize: 14, fontWeight: 700 }}>
                        {marketFlag(order.symbol) && <span style={{ marginRight: 4 }} aria-hidden>{marketFlag(order.symbol)}</span>}
                        {displaySymbol(order.symbol)}
                      </span>
                      <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 8, fontWeight: 600, color: src.color, background: src.bg }}>
                        {src.text}
                      </span>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: sm.color }}>{sm.text}</span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, marginTop: 8 }}>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>금액</div>
                      <div className="num" style={{ fontSize: 12, fontWeight: 600, marginTop: 1 }}>{amount}</div>
                    </div>
                    {order.price && (
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>지정가</div>
                        <div className="num" style={{ fontSize: 12, fontWeight: 600, marginTop: 1 }}>
                          {fmtNum(parseFloat(order.price))}
                        </div>
                      </div>
                    )}
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>생성</div>
                      <div style={{ fontSize: 12, fontWeight: 600, marginTop: 1 }}>{relativeTime(order.created_at)}</div>
                    </div>
                  </div>

                  {canCancel && (
                    <button
                      onClick={(e) => handleCancel(e, order.id)}
                      disabled={cancelling.has(order.id)}
                      style={{
                        width: '100%', height: 34, marginTop: 10, borderRadius: 7,
                        fontSize: 12, fontWeight: 600,
                        background: cancelling.has(order.id) ? 'var(--bg3)' : 'rgba(239,68,68,.12)',
                        color: cancelling.has(order.id) ? 'var(--muted)' : '#ef4444',
                        border: '1px solid rgba(239,68,68,.25)',
                      }}
                    >
                      {cancelling.has(order.id) ? '취소 중…' : '주문 취소'}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <OrderDetail
        orderId={selectedId}
        onClose={() => setSelectedId(null)}
        onCancelDone={fetchOrders}
      />
    </>
  );
}
