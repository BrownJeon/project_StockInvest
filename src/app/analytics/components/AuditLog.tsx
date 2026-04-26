'use client';

import { useEffect, useState } from 'react';
import { fmtNum } from '@/lib/format';

interface TradeLog {
  id: number;
  event: string;
  payload: Record<string, unknown> | null;
  occurred_at: string;
  order_id: number | null;
}

type FilterKey = 'all' | 'order' | 'blocked' | 'signal';

const FILTER_EVENTS: Record<FilterKey, string | null> = {
  all:     null,
  order:   'accepted',
  blocked: 'blocked',
  signal:  'signal_rejected',
};

const FILTER_LABELS: Record<FilterKey, string> = {
  all: '전체', order: '주문', blocked: '차단', signal: '시그널',
};

const EVENT_META: Record<string, { icon: string; label: string; color: string }> = {
  submit_attempt:  { icon: '📤', label: '주문 시도',   color: 'var(--muted)' },
  accepted:        { icon: '✅', label: '주문 접수',   color: 'var(--ok)' },
  dry_run:         { icon: '🔵', label: '모의 주문',   color: 'var(--accent)' },
  blocked:         { icon: '🚫', label: '주문 차단',   color: 'var(--down)' },
  rejected:        { icon: '❌', label: '주문 거부',   color: 'var(--down)' },
  error:           { icon: '⚠️', label: '주문 오류',   color: 'var(--down)' },
  signal_rejected: { icon: '📵', label: '시그널 거부', color: 'var(--muted)' },
};

const BLOCK_REASON: Record<string, string> = {
  kill_switch:        'Kill Switch 발동',
  symbol_not_allowed: '허용되지 않은 심볼',
  order_limit:        '주문 한도 초과',
  daily_limit:        '일일 한도 초과',
  vol_block:          '변동폭 차단',
  vol_panic:          '변동폭 패닉',
};

function summarize(event: string, p: Record<string, unknown> | null): string | null {
  if (!p) return null;
  try {
    if (event === 'submit_attempt') {
      const req = p.req as Record<string, unknown> | undefined;
      if (!req) return null;
      const symbol    = String(req.symbol ?? '');
      const side      = req.side === 'buy' ? '매수' : '매도';
      const typeLabel = req.type === 'limit' ? '지정가' : '시장가';
      const amount    = req.amountKRW != null ? `₩${fmtNum(Number(req.amountKRW))}` : '';
      return `${symbol} ${side} ${amount} (${typeLabel})`.trim();
    }
    if (event === 'accepted') {
      const id = p.exchangeOrderId ? ` · ${p.exchangeOrderId}` : '';
      return `거래소 접수 완료${id}`;
    }
    if (event === 'dry_run') {
      const orderMax = p.effOrderMax != null ? `₩${fmtNum(Number(p.effOrderMax))}` : '—';
      const dailyMax = p.effDailyMax != null ? `₩${fmtNum(Number(p.effDailyMax))}` : '—';
      return `모의 실행 · 1회 한도 ${orderMax} / 일 ${dailyMax}`;
    }
    if (event === 'blocked') {
      const reason = String(p.reason ?? '');
      const label  = BLOCK_REASON[reason] ?? reason;
      const detail = p.detail ? ` · ${p.detail}` : '';
      return `차단: ${label}${detail}`;
    }
    if (event === 'rejected') {
      return `거부: ${p.error ?? p.blockedBy ?? '알 수 없음'}`;
    }
    if (event === 'error') {
      return `오류: ${p.error ?? '알 수 없음'}`;
    }
    if (event === 'signal_rejected') {
      const symbol = String(p.symbol ?? '');
      const side   = p.side === 'buy' ? '매수' : '매도';
      return `${symbol} ${side} 시그널 거부`;
    }
  } catch { /* fall through */ }
  return null;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay) return time;
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

export function AuditLog() {
  const [logs, setLogs]       = useState<TradeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState<FilterKey>('all');

  useEffect(() => {
    setLoading(true);
    const event = FILTER_EVENTS[filter];
    const url = event ? `/api/orders/logs?limit=100&event=${event}` : '/api/orders/logs?limit=100';
    fetch(url)
      .then(r => r.json())
      .then(d => { if (d.ok) setLogs(d.logs ?? []); })
      .finally(() => setLoading(false));
  }, [filter]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {(Object.keys(FILTER_LABELS) as FilterKey[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '5px 12px', borderRadius: 16, fontSize: 12, fontWeight: 600,
              background: filter === f ? 'var(--accent)' : 'var(--bg3)',
              color: filter === f ? '#000' : 'var(--muted)',
              border: 'none', cursor: 'pointer',
            }}
          >
            {FILTER_LABELS[f]}
          </button>
        ))}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>불러오는 중…</div>}
      {!loading && logs.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>이벤트 없음</div>
      )}
      {!loading && logs.length > 0 && (
        <div style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
          {logs.map((log, i) => {
            const meta    = EVENT_META[log.event];
            const summary = summarize(log.event, log.payload);
            return (
              <div
                key={log.id}
                style={{
                  padding: '10px 16px', display: 'flex', alignItems: 'flex-start', gap: 10,
                  borderBottom: i < logs.length - 1 ? '1px solid var(--border)' : 'none',
                }}
              >
                <span style={{ fontSize: 16, lineHeight: '20px', flexShrink: 0 }}>
                  {meta?.icon ?? '•'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: meta?.color ?? 'var(--muted)' }}>
                      {meta?.label ?? log.event}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{fmtDate(log.occurred_at)}</span>
                  </div>
                  {summary && (
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{summary}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
