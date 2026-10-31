'use client';

import { useEffect, useState } from 'react';
import { fmtNum } from '@/lib/format';
import { formatDateTimeSecondsKST as fmtTime } from '@/lib/time';
import { useSymbolMeta } from '@/lib/hooks/useSymbolMeta';
import type { Execution, Order, SignalInfo, TradeLog } from '@/types/order';
import { orderReasonText } from '@/lib/ops/reason-dictionary';

interface DetailData {
  order: Order;
  executions: Execution[];
  logs: TradeLog[];
}

const LOG_EVENT_META: Record<string, { icon: string; color: string }> = {
  submit_attempt: { icon: '→', color: 'var(--muted)' },
  accepted:       { icon: '✓', color: 'var(--ok)'    },
  filled:         { icon: '✅', color: 'var(--ok)'   },
  cancelled:      { icon: '✕', color: 'var(--muted)' },
  cancel_failed:  { icon: '!', color: '#ef4444'       },
  blocked:        { icon: '🔒', color: '#555'         },
  dry_run:        { icon: '🧪', color: '#555'         },
  rejected:       { icon: '✕', color: '#ef4444'       },
  error:          { icon: '⚠', color: '#ef4444'       },
};

export const SOURCE_META: Record<string, { text: string; color: string; bg: string }> = {
  auto:   { text: '자동',   color: 'var(--ok)',    bg: 'rgba(34,197,94,.18)'  },
  signal: { text: '시그널', color: '#818cf8',      bg: 'rgba(99,102,241,.18)' },
  manual: { text: '수동',   color: 'var(--muted)', bg: 'var(--bg3)'           },
};

interface Props {
  orderId: number | null;
  onClose: () => void;
  onCancelDone: () => void;
}

export function OrderDetail({ orderId, onClose, onCancelDone }: Props) {
  const [detail, setDetail]         = useState<DetailData | null>(null);
  const [signal, setSignal]         = useState<SignalInfo | null>(null);
  const [loading, setLoading]       = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const { displaySymbol, marketFlag } = useSymbolMeta();

  useEffect(() => {
    if (orderId === null) { setDetail(null); setSignal(null); return; }
    setLoading(true);
    setSignal(null);
    fetch(`/api/orders/${orderId}`)
      .then(r => r.json())
      .then(d => {
        if (!d.ok) return;
        setDetail(d.data);
        const src = d.data.order.source as string;
        if (src === 'auto' || src === 'signal') {
          fetch(`/api/signals?consumedOrderId=${orderId}&limit=1`)
            .then(r => r.json())
            .then(sd => { if (sd.ok && sd.data.length > 0) setSignal(sd.data[0]); });
        }
      })
      .finally(() => setLoading(false));
  }, [orderId]);

  const handleCancel = async () => {
    if (!detail) return;
    setCancelling(true);
    try {
      await fetch(`/api/orders/${detail.order.id}`, { method: 'DELETE' });
      onCancelDone();
      onClose();
    } finally {
      setCancelling(false);
    }
  };

  const visible = orderId !== null;

  return (
    <>
      {visible && (
        <div
          onClick={onClose}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 40 }}
        />
      )}

      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0,
        maxHeight: '80vh', background: 'var(--bg2)',
        borderRadius: '16px 16px 0 0',
        border: '1px solid var(--border)', borderBottom: 'none',
        zIndex: 50, display: 'flex', flexDirection: 'column',
        transform: visible ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform .25s ease',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 0' }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border2)' }} />
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px 12px', borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>주문 상세</span>
          <button onClick={onClose} style={{ fontSize: 20, color: 'var(--muted)', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>불러오는 중…</div>
          )}

          {detail && (() => {
            const { order, executions, logs } = detail;
            const src = SOURCE_META[order.source] ?? SOURCE_META.manual;
            const canCancel = !!order.exchange_order_id &&
              (order.status === 'pending' || order.status === 'accepted');
            const amount = order.amount_krw
              ? `₩${fmtNum(parseFloat(order.amount_krw))}`
              : order.quantity ?? '-';

            return (
              <>
                {/* Order overview */}
                <div style={{ background: 'var(--bg)', borderRadius: 10, padding: 14, border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <span style={{
                      fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 6,
                      background: order.side === 'buy' ? 'rgba(239,68,68,.18)' : 'rgba(59,130,246,.18)',
                      color: order.side === 'buy' ? 'var(--up)' : 'var(--down)',
                    }}>{order.side === 'buy' ? '매수' : '매도'}</span>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>
                      {marketFlag(order.symbol) && <span style={{ marginRight: 4 }} aria-hidden>{marketFlag(order.symbol)}</span>}
                      {displaySymbol(order.symbol)}
                    </span>
                    <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 8, color: src.color, background: src.bg }}>
                      {src.text}
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {[
                      { k: '유형', v: order.type === 'limit' ? '지정가' : '시장가' },
                      { k: '금액', v: amount },
                      ...(order.price    ? [{ k: '진입가', v: fmtNum(parseFloat(order.price)) }]    : []),
                      ...(order.quantity ? [{ k: '수량',   v: order.quantity }]                      : []),
                    ].map(item => (
                      <div key={item.k}>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{item.k}</div>
                        <div className="num" style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{item.v}</div>
                      </div>
                    ))}
                  </div>
                  {order.blocked_by && (
                    <div style={{ marginTop: 10, fontSize: 12, color: '#555', padding: '6px 10px', background: 'var(--bg2)', borderRadius: 6 }}>
                      차단 사유: {orderReasonText(order.blocked_by)}
                    </div>
                  )}
                </div>

                {/* Signal linkage section */}
                {signal && (
                  <div style={{
                    background: 'var(--bg)', borderRadius: 10, padding: 14,
                    border: '1px solid rgba(129,140,248,.3)',
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#818cf8', marginBottom: 10 }}>
                      🔗 연결된 시그널 #{signal.id}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      {signal.strategy_id && (
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>전략</div>
                          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{signal.strategy_id}</div>
                        </div>
                      )}
                      {signal.indicators?.ai?.confidence != null && (
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>신뢰도</div>
                          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2, color: 'var(--ok)' }}>
                            {signal.indicators.ai.confidence}%
                          </div>
                        </div>
                      )}
                    </div>
                    {signal.reasoning && (
                      <div style={{ marginTop: 10, fontSize: 12, color: '#aaa', lineHeight: 1.6 }}>
                        {signal.reasoning}
                      </div>
                    )}
                    {signal.indicators?.ai?.warnings && signal.indicators.ai.warnings.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                        {signal.indicators.ai.warnings.map((w, i) => (
                          <span key={i} style={{
                            fontSize: 11, padding: '2px 7px', borderRadius: 8,
                            background: 'rgba(239,68,68,.12)', color: '#ef4444',
                          }}>⚠ {w}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Executions */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
                    체결 이력
                  </div>
                  {executions.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0' }}>체결 이력 없음</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {executions.map(ex => (
                        <div key={ex.id} style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '8px 12px', background: 'var(--bg)', borderRadius: 8,
                          border: '1px solid var(--border)',
                        }}>
                          <div>
                            <div className="num" style={{ fontSize: 13, fontWeight: 600 }}>
                              {fmtNum(parseFloat(ex.price))} × {ex.quantity}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                              수수료 {fmtNum(parseFloat(ex.fee))}
                            </div>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtTime(ex.executed_at)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Trade logs timeline */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
                    이벤트 로그
                  </div>
                  {logs.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0' }}>로그 없음</div>
                  ) : (
                    <div style={{ position: 'relative', paddingLeft: 24 }}>
                      <div style={{
                        position: 'absolute', left: 9, top: 8, bottom: 8,
                        width: 2, background: 'var(--border)',
                      }} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {logs.map(log => {
                          const lm = LOG_EVENT_META[log.event] ?? { icon: '·', color: 'var(--muted)' };
                          return (
                            <div key={log.id} style={{ position: 'relative' }}>
                              <div style={{
                                position: 'absolute', left: -20, top: 2,
                                width: 10, height: 10, borderRadius: '50%',
                                background: lm.color, border: '2px solid var(--bg2)',
                              }} />
                              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: lm.color }}>{log.event}</span>
                                <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{fmtTime(log.occurred_at)}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {canCancel && (
                  <button
                    onClick={handleCancel}
                    disabled={cancelling}
                    style={{
                      width: '100%', height: 44, borderRadius: 10, fontSize: 14, fontWeight: 700,
                      background: cancelling ? 'var(--bg3)' : 'rgba(239,68,68,.15)',
                      color: cancelling ? 'var(--muted)' : '#ef4444',
                      border: '1px solid rgba(239,68,68,.3)',
                    }}
                  >
                    {cancelling ? '취소 중…' : '주문 취소'}
                  </button>
                )}
                <div style={{ height: 8 }} />
              </>
            );
          })()}
        </div>
      </div>
    </>
  );
}
