'use client';

import { useEffect, useState } from 'react';
import { fmtNum } from '@/lib/format';
import { kstTodayStart } from '@/lib/time';
import { useSymbolMeta } from '@/lib/hooks/useSymbolMeta';

// signals.status 의 진실은 `@/lib/signals/statuses` (순수 모듈이라 클라이언트에서도 안전).
// 화면에서 임의 유니온을 따로 들고 있으면 새 상태가 추가될 때 조용히 '알 수 없음'이 된다.
export type { SignalStatus } from '@/lib/signals/statuses';
import type { SignalStatus } from '@/lib/signals/statuses';

export interface Signal {
  id: number;
  strategy_id: string | null;
  symbol: string;
  side: 'buy' | 'sell';
  order_type: 'limit' | 'market';
  price: string | null;
  quantity: string | null;
  amount_krw: string;
  reasoning: string | null;
  indicators: Record<string, number> | null;
  status: SignalStatus;
  expires_at: string | null;
  consumed_order_id: number | null;
  created_at: string;
}

export const STATUS_META: Record<SignalStatus, { text: string; color: string; bg: string }> = {
  // ── 승인 대기 (신규 awaiting_approval + 구 pending / pending_approval) ──
  awaiting_approval:      { text: '승인 대기', color: 'var(--accent)',  bg: 'rgba(245,158,11,.18)' },
  pending:                { text: '승인 대기', color: 'var(--accent)',  bg: 'rgba(245,158,11,.18)' },
  pending_approval:       { text: '승인 대기', color: 'var(--accent)',  bg: 'rgba(245,158,11,.18)' },
  detected:               { text: '관측됨',    color: '#94a3b8',        bg: 'rgba(148,163,184,.18)' },
  auto_submitted:         { text: '자동 제출', color: 'var(--ok)',      bg: 'rgba(34,197,94,.18)'  },
  approved:               { text: '승인됨',    color: '#818cf8',        bg: 'rgba(99,102,241,.18)' },
  approved_pending_entry: { text: '진입 감시', color: '#38bdf8',        bg: 'rgba(56,189,248,.18)' },
  executing:              { text: '체결 대기', color: '#38bdf8',        bg: 'rgba(56,189,248,.18)' },
  rejected:               { text: '거부됨',    color: 'var(--muted)',   bg: 'var(--bg3)'           },
  expired:                { text: '만료됨',    color: '#555',           bg: 'var(--bg)'            },
  superseded:             { text: '대체됨',    color: '#555',           bg: 'var(--bg)'            },
  skipped:                { text: '건너뜀',    color: '#555',           bg: 'var(--bg)'            },
  ai_skipped:             { text: 'AI 매매 안 함', color: '#555',        bg: 'var(--bg)'            },
};

import { formatTimeKST } from '@/lib/time';

export function TodayAutoTradeFeed() {
  const [rows, setRows]     = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const { displaySymbol, marketFlag } = useSymbolMeta();

  useEffect(() => {
    fetch('/api/signals?limit=50')
      .then(r => r.json())
      .then(d => {
        const list: Signal[] = d.data ?? [];
        const todayStart = kstTodayStart();
        const filtered = list.filter(s =>
          (s.status === 'auto_submitted' || s.status === 'approved') &&
          new Date(s.created_at).getTime() >= todayStart.getTime()
        );
        setRows(filtered);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ padding: '12px 16px' }}>
      <div style={{ padding: '8px 0 4px', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
          오늘의 자동 매매
        </span>
      </div>

      {loading && (
        <div style={{ padding: '16px 0', color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>불러오는 중…</div>
      )}

      {!loading && rows.length === 0 && (
        <div style={{
          padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13,
          background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)',
        }}>
          오늘 자동 매매 없음
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map(s => {
            const meta = STATUS_META[s.status];
            return (
              <div key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', background: 'var(--bg2)',
                borderRadius: 10, border: '1px solid var(--border)',
              }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, flexShrink: 0,
                  background: s.side === 'buy' ? 'rgba(239,68,68,.18)' : 'rgba(59,130,246,.18)',
                  color: s.side === 'buy' ? 'var(--up)' : 'var(--down)',
                }}>{s.side === 'buy' ? '매수' : '매도'}</span>

                <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>
                  {marketFlag(s.symbol) && <span style={{ marginRight: 4 }} aria-hidden>{marketFlag(s.symbol)}</span>}
                  {displaySymbol(s.symbol)}
                </span>

                <span className="num" style={{ fontSize: 13, color: 'var(--text)', flexShrink: 0 }}>
                  ₩{fmtNum(parseFloat(s.amount_krw))}
                </span>

                <span style={{
                  fontSize: 10, padding: '2px 6px', borderRadius: 8, flexShrink: 0,
                  color: meta.color, background: meta.bg,
                }}>{meta.text}</span>

                <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>
                  {formatTimeKST(s.created_at)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
