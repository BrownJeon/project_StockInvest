'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { SymbolGroupHeader } from '@/components/orders/SymbolGroupHeader';
import { fmtNum } from '@/lib/format';
import { useSymbolMeta } from '@/lib/hooks/useSymbolMeta';
import { groupByDateThenSymbol, UNKNOWN_SYMBOL } from '@/lib/orders/group-orders';
import { symbolUnit } from '@/lib/symbols';
import { formatTimeKST } from '@/lib/time';
import type { OrderStatus } from '@/types/order';

/** 대시보드가 넘겨주는 주문 행의 최소 형태 (Dashboard 로컬 `OrderRow`가 구조적으로 이 타입을 만족) */
export interface RecentOrderRow {
  id: number;
  symbol: string;
  side: 'buy' | 'sell';
  price: string | null;
  quantity: string | null;
  amount_krw: string | null;
  status: OrderStatus;
  created_at: string;
}

/** 표시 건수 — 그룹핑 도입 후에도 현행 유지 (T-026 결정 4) */
const RECENT_LIMIT = 10;

export const ORDER_STATUS_META: Record<OrderStatus, { text: string; color: string; bg: string }> = {
  pending:          { text: '대기',     color: 'var(--muted)',   bg: 'var(--bg3)'              },
  accepted:         { text: '접수됨',   color: '#818cf8',        bg: 'rgba(99,102,241,.18)'    },
  partially_filled: { text: '부분체결', color: 'var(--accent)',  bg: 'rgba(245,158,11,.18)'    },
  filled:           { text: '체결됨',   color: 'var(--ok)',      bg: 'rgba(34,197,94,.18)'     },
  cancelled:        { text: '취소됨',   color: 'var(--muted)',   bg: 'var(--bg3)'              },
  rejected:         { text: '거부됨',   color: 'var(--down)',    bg: 'rgba(239,68,68,.15)'     },
  failed:           { text: '실패',     color: 'var(--down)',    bg: 'rgba(239,68,68,.15)'     },
  dry_run:          { text: '테스트',   color: 'var(--accent)',  bg: 'rgba(245,158,11,.15)'    },
  blocked:          { text: '차단됨',   color: 'var(--down)',    bg: 'rgba(239,68,68,.15)'     },
};

function fmtOrderAmount(o: RecentOrderRow): string {
  if (o.amount_krw) return `₩${fmtNum(parseFloat(o.amount_krw))}`;
  if (o.quantity)   return `${parseFloat(o.quantity).toFixed(4)} ${symbolUnit(o.symbol)}`;
  if (o.price && o.quantity) return `₩${fmtNum(parseFloat(o.price) * parseFloat(o.quantity))}`;
  return '-';
}

const card: React.CSSProperties = { background: 'var(--bg2)', borderBottom: '1px solid var(--border)' };
const cardHeader: React.CSSProperties = {
  padding: '10px 14px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
};

/**
 * 대시보드 "최근 주문" — 최근 10건을 **날짜 → 종목** 2단 그룹으로 표시 (기본 접힘).
 *
 * 그룹핑 로직은 분석 탭 거래 이력과 `@/lib/orders/group-orders`를 공유한다.
 * 주의: 그룹 요약은 "최근 10건" 범위 안의 건수·시각범위다(그날 전체가 아님).
 * 그날 전체는 "전체 보기 →"(분석 탭 거래 이력)에서 확인한다.
 */
export function RecentExecutionsSection({ orders }: { orders: RecentOrderRow[] }) {
  const { displaySymbol, marketFlag } = useSymbolMeta();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggleGroup = useCallback((key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const dateGroups = useMemo(
    () => groupByDateThenSymbol(orders.slice(0, RECENT_LIMIT)),
    [orders],
  );

  return (
    <section style={card}>
      <div style={cardHeader}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
          <span style={{
            fontSize: 12, color: 'var(--muted)', letterSpacing: '.6px',
            textTransform: 'uppercase', whiteSpace: 'nowrap',
          }}>
            최근 주문
          </span>
          {/* 그룹 요약이 "그날 전체"가 아니라 이 N건 범위임을 화면에서도 알린다 (T-026 LOW).
              하드코딩하지 않고 실제 표시 상수를 참조 — 건수를 바꿔도 표기가 어긋나지 않는다. */}
          <span style={{ fontSize: 11, color: 'var(--muted)', opacity: .75, whiteSpace: 'nowrap' }}>
            · 최근 {RECENT_LIMIT}건
          </span>
        </div>
        {/* `/order`는 `/strategy`로 redirect 되므로 거래 이력 서브탭으로 직접 보낸다 (T-026) */}
        <Link href="/analytics?tab=orders" style={{
          fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          전체 보기 →
        </Link>
      </div>

      {dateGroups.length === 0 ? (
        <div style={{ padding: '16px 14px', textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
          주문 이력 없음
        </div>
      ) : (
        dateGroups.map(({ dateKey, dateLabel, symbolGroups }) => (
          <div key={dateKey}>
            <div style={{
              padding: '6px 14px 2px', fontSize: 11, fontWeight: 700,
              color: 'var(--muted)', borderTop: '1px solid var(--border)',
            }}>{dateLabel}</div>

            {symbolGroups.map((group, gi) => {
              const groupKey  = `${dateKey}|${group.symbol}`;
              const isOpen    = expanded.has(groupKey);
              const panelId   = `dash-order-group-${dateKey}-${gi}`;
              const isUnknown = group.symbol === UNKNOWN_SYMBOL;

              return (
                <div key={groupKey} style={{ borderTop: '1px solid var(--border)' }}>
                  <SymbolGroupHeader
                    flag={isUnknown ? '' : marketFlag(group.symbol)}
                    name={isUnknown ? UNKNOWN_SYMBOL : displaySymbol(group.symbol)}
                    count={group.count}
                    firstAt={group.firstAt}
                    lastAt={group.lastAt}
                    expanded={isOpen}
                    onToggle={() => toggleGroup(groupKey)}
                    controlsId={panelId}
                    style={{ padding: '8px 14px' }}
                    nameStyle={{ fontSize: 13 }}
                  />

                  <div id={panelId} hidden={!isOpen}>
                    {isOpen && group.orders.map(o => {
                      const meta = ORDER_STATUS_META[o.status];
                      return (
                        <div key={o.id} style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '8px 14px 8px 32px', gap: 8,
                          borderTop: '1px solid var(--border)',
                        }}>
                          <span style={{
                            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, flexShrink: 0,
                            background: o.side === 'buy' ? 'rgba(239,68,68,.18)' : 'rgba(59,130,246,.18)',
                            color: o.side === 'buy' ? 'var(--up)' : 'var(--down)',
                          }}>{o.side === 'buy' ? '매수' : '매도'}</span>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 'auto' }}>
                            <span className="num" style={{ fontSize: 12, color: 'var(--text)' }}>
                              {fmtOrderAmount(o)}
                            </span>
                            <span style={{
                              fontSize: 10, padding: '2px 6px', borderRadius: 8, fontWeight: 600,
                              color: meta?.color ?? 'var(--muted)', background: meta?.bg ?? 'var(--bg3)',
                            }}>{meta?.text ?? o.status}</span>
                            <span className="num" style={{ fontSize: 10, color: 'var(--muted)' }}>
                              {formatTimeKST(o.created_at)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ))
      )}
    </section>
  );
}
