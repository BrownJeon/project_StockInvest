'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Paginator } from './Paginator';

import { fmtNum } from '@/lib/format';
import { formatTimeKST } from '@/lib/time';
import { OrderDetail, SOURCE_META } from '@/components/OrderDetail';
import { SymbolGroupHeader } from '@/components/orders/SymbolGroupHeader';
import { useSymbolMeta } from '@/lib/hooks/useSymbolMeta';
import { groupByDateThenSymbol, UNKNOWN_SYMBOL } from '@/lib/orders/group-orders';
import type { Order, OrderStatus, SignalInfo } from '@/types/order';

/**
 * 페이지 단위는 "주문 건수"가 아니라 **날짜 그룹 수**다 (T-026 결정 3).
 * 종목 그룹이 기본 접힘이라 한 날짜는 접힌 상태에서 헤더 몇 줄만 차지한다 —
 * 5개면 412px 모바일에서 대략 2~3 스크린 이내(그룹 헤더 44px 기준)로 유지된다.
 * 🔴 그룹핑을 페이징보다 **먼저** 해야 그룹 요약(건수·시각범위)이 실제와 일치한다.
 */
const DATE_PAGE_SIZE = 5;

const TERMINAL_STATUSES = new Set<OrderStatus>([
  'filled', 'cancelled', 'rejected', 'failed', 'dry_run', 'blocked',
]);

type FilterKey = 'all' | 'filled' | 'dryrun' | 'blocked' | 'failed';

const FILTERS: { id: FilterKey; label: string }[] = [
  { id: 'all',     label: '전체'     },
  { id: 'filled',  label: '체결'     },
  { id: 'dryrun',  label: '가상'     },
  { id: 'blocked', label: '차단'     },
  { id: 'failed',  label: '실패/거부' },
];

const STATUS_META: Record<OrderStatus, { text: string; color: string }> = {
  filled:           { text: '체결됨',   color: 'var(--ok)'    },
  partially_filled: { text: '부분체결', color: 'var(--ok)'    },
  cancelled:        { text: '취소됨',   color: 'var(--muted)' },
  rejected:         { text: '거부됨',   color: '#ef4444'      },
  failed:           { text: '실패',     color: '#ef4444'      },
  dry_run:          { text: '가상',     color: '#555'         },
  blocked:          { text: '차단됨',   color: '#555'         },
  pending:          { text: '대기',     color: 'var(--accent)'},
  accepted:         { text: '접수됨',   color: 'var(--accent)'},
};

function kstDateKey(ts: string): string {
  return new Date(ts).toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  });
}

export function OrderHistoryTab() {
  const [orders, setOrders]         = useState<Order[]>([]);
  const [signalMap, setSignalMap]   = useState<Map<number, SignalInfo>>(new Map());
  const [loading, setLoading]       = useState(true);
  const [filter, setFilter]         = useState<FilterKey>('all');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [page, setPage]             = useState(0);
  /** 펼쳐진 종목 그룹 키(`dateKey|symbol`) — 기본 전부 접힘 */
  const [expanded, setExpanded]     = useState<Set<string>>(() => new Set());
  const { displaySymbol, marketFlag } = useSymbolMeta();

  const toggleGroup = useCallback((key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const [ordersRes, signalsRes] = await Promise.all([
        fetch('/api/orders?limit=100'),
        fetch('/api/signals?status=auto_submitted,approved&limit=200'),
      ]);
      const [ordersData, signalsData] = await Promise.all([
        ordersRes.json(),
        signalsRes.json(),
      ]);

      if (ordersData.ok) {
        setOrders((ordersData.data as Order[]).filter(o => TERMINAL_STATUSES.has(o.status)));
      }
      if (signalsData.ok) {
        const m = new Map<number, SignalInfo>();
        for (const sig of signalsData.data as (SignalInfo & { consumed_order_id: number | null })[]) {
          if (sig.consumed_order_id != null) m.set(sig.consumed_order_id, sig as SignalInfo);
        }
        setSignalMap(m);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  /* Today summary — KST 기준 오늘 */
  const todayKeyNow = kstDateKey(new Date().toISOString());
  const todayOrders = orders.filter(o => kstDateKey(o.created_at) === todayKeyNow);
  const todayFilled  = todayOrders.filter(o => o.status === 'filled').length;
  const todayDryRun  = todayOrders.filter(o => o.status === 'dry_run').length;
  const todayBlocked = todayOrders.filter(o => o.status === 'blocked').length;

  const filtered = filter === 'all' ? orders : orders.filter(o => {
    if (filter === 'dryrun')  return o.status === 'dry_run';
    if (filter === 'blocked') return o.status === 'blocked';
    if (filter === 'failed')  return o.status === 'failed' || o.status === 'rejected';
    return o.status === filter;
  });

  useEffect(() => { setPage(0); }, [filter]);

  /* 🔴 필터 → 그룹핑 → 페이징 순서 (T-026).
     페이징을 먼저 하면 같은 날 같은 종목이 페이지 경계에서 쪼개져
     그룹 요약 건수·시각범위가 실제와 다른 값을 표시한다. */
  const dateGroups = useMemo(() => groupByDateThenSymbol(filtered), [filtered]);

  const totalPages = Math.ceil(dateGroups.length / DATE_PAGE_SIZE);
  // 데이터 새로고침으로 페이지 수가 줄어도 빈 화면이 되지 않게 클램프
  const safePage = totalPages === 0 ? 0 : Math.min(page, totalPages - 1);
  const groups = dateGroups.slice(safePage * DATE_PAGE_SIZE, (safePage + 1) * DATE_PAGE_SIZE);

  return (
    <>
      {/* Filter chips */}
      <div style={{
        display: 'flex', gap: 6, padding: '10px 0 8px',
        overflowX: 'auto', scrollbarWidth: 'none', flexShrink: 0,
      }}>
        {FILTERS.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            flexShrink: 0, padding: '4px 10px', borderRadius: 12, fontSize: 12,
            border: `1px solid ${filter === f.id ? 'var(--accent)' : 'var(--border)'}`,
            background: filter === f.id ? 'rgba(245,158,11,.1)' : 'transparent',
            color: filter === f.id ? 'var(--accent)' : 'var(--muted)',
          }}>{f.label}</button>
        ))}
      </div>

      {/* Today summary bar */}
      <div style={{
        background: 'var(--bg2)', borderRadius: 10, padding: '10px 14px',
        border: '1px solid var(--border)', marginBottom: 4,
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4,
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ok)' }}>{todayFilled}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>체결</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>{todayDryRun}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>가상 주문</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--up)' }}>{todayBlocked}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>차단</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--muted)' }}>{todayOrders.length}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>오늘 합계</div>
        </div>
      </div>

      {/* Order list */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--muted)' }}>불러오는 중…</div>
      )}
      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: 64, color: 'var(--muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
          <div>이력 없음</div>
        </div>
      )}

      {groups.map(({ dateKey, dateLabel, symbolGroups }) => (
        <div key={dateKey}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: 'var(--muted)',
            padding: '10px 0 4px',
          }}>{dateLabel}</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {symbolGroups.map((group, gi) => {
              const groupKey  = `${dateKey}|${group.symbol}`;
              const isOpen    = expanded.has(groupKey);
              const panelId   = `order-group-${dateKey}-${gi}`;
              const isUnknown = group.symbol === UNKNOWN_SYMBOL;

              return (
                <div key={groupKey} style={{
                  background: 'var(--bg2)', borderRadius: 10,
                  border: '1px solid var(--border)', overflow: 'hidden',
                }}>
                  <SymbolGroupHeader
                    flag={isUnknown ? '' : marketFlag(group.symbol)}
                    name={isUnknown ? UNKNOWN_SYMBOL : displaySymbol(group.symbol)}
                    count={group.count}
                    firstAt={group.firstAt}
                    lastAt={group.lastAt}
                    expanded={isOpen}
                    onToggle={() => toggleGroup(groupKey)}
                    controlsId={panelId}
                    style={{ padding: '8px 12px' }}
                  />

                  <div
                    id={panelId}
                    hidden={!isOpen}
                    style={isOpen
                      ? { display: 'flex', flexDirection: 'column', gap: 6, padding: '0 8px 8px' }
                      : undefined}
                  >
                    {group.orders.map(order => (
                      <OrderCard
                        key={order.id}
                        order={order}
                        sig={signalMap.get(order.id)}
                        displaySymbol={displaySymbol}
                        marketFlag={marketFlag}
                        onSelect={setSelectedId}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <Paginator page={safePage} totalPages={totalPages} onPage={setPage} />

      <div style={{ height: 16 }} />

      <OrderDetail
        orderId={selectedId}
        onClose={() => setSelectedId(null)}
        onCancelDone={fetchData}
      />
    </>
  );
}

/** 펼쳐진 종목 그룹 안의 주문 카드 1건 (기존 카드 마크업 그대로 분리) */
function OrderCard({ order, sig, displaySymbol, marketFlag, onSelect }: {
  order: Order;
  sig: SignalInfo | undefined;
  displaySymbol: (s: string) => string;
  marketFlag: (s: string) => string;
  onSelect: (id: number) => void;
}) {
  const sm     = STATUS_META[order.status];
  const src    = SOURCE_META[order.source] ?? SOURCE_META.manual;
  const amount = order.amount_krw
    ? `₩${fmtNum(parseFloat(order.amount_krw))}`
    : order.quantity ?? '-';
  const dimmed = order.status === 'dry_run' || order.status === 'blocked';
  const flag   = marketFlag(order.symbol);

  return (
    <div
      onClick={() => onSelect(order.id)}
      style={{
        background: 'var(--bg3)', borderRadius: 10, padding: '10px 12px',
        border: '1px solid var(--border)', cursor: 'pointer',
        opacity: dimmed ? 0.65 : 1,
      }}
    >
      {/* Row 1: side + symbol + source + status */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 5,
            background: order.side === 'buy' ? 'rgba(239,68,68,.18)' : 'rgba(59,130,246,.18)',
            color: order.side === 'buy' ? 'var(--up)' : 'var(--down)',
          }}>{order.side === 'buy' ? '매수' : '매도'}</span>
          <span style={{ fontSize: 14, fontWeight: 700 }}>
            {flag && <span style={{ marginRight: 4 }} aria-hidden>{flag}</span>}
            {displaySymbol(order.symbol)}
          </span>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 8,
            color: src.color, background: src.bg,
          }}>{src.text}</span>
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: sm.color }}>{sm.text}</span>
      </div>

      {/* Row 2: amount + time */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="num" style={{ fontSize: 13, fontWeight: 600 }}>{amount}</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          {formatTimeKST(order.created_at)}
        </span>
      </div>

      {/* Signal reasoning preview */}
      {sig?.reasoning && (
        <div style={{
          fontSize: 11, color: '#666', marginTop: 5,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{sig.reasoning}</div>
      )}

      {/* Signal link */}
      {sig && (
        <div style={{ fontSize: 11, color: '#818cf8', marginTop: 3 }}>
          시그널 #{sig.id}{sig.strategy_id ? ` · ${sig.strategy_id}` : ''} →
        </div>
      )}

      {/* Blocked reason */}
      {order.blocked_by && (
        <div style={{ fontSize: 11, color: order.status === 'dry_run' ? 'var(--accent)' : '#555', marginTop: 4 }}>
          🚫 {order.blocked_by}
        </div>
      )}
    </div>
  );
}
