'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatRelativeTime, kstTodayStart } from '@/lib/time';
import { useSymbolMeta } from '@/lib/hooks/useSymbolMeta';

interface SignalRow {
  id:         number;
  strategy_id: string | null;
  symbol:     string;
  side:       'buy' | 'sell';
  status:     string;
  reasoning:  string | null;
  indicators: { ai?: { confidence: number; warnings: string[] } } | null;
  amount_krw: string;
  created_at: string;
}

type Period = '1d' | '7d' | '30d';

const PERIOD_LABEL: Record<Period, string> = { '1d': '오늘', '7d': '7일', '30d': '30일' };
const PAGE_SIZE = 5;

function sinceMs(period: Period): number {
  if (period === '1d') return kstTodayStart().getTime();
  const d = period === '7d' ? 7 : 30;
  return Date.now() - d * 86_400_000;
}

function extractAiReasoning(reasoning: string | null): string {
  if (!reasoning) return '';
  const match = reasoning.match(/\[AI \d+%\]\s*(.+)/s);
  return match ? match[1].slice(0, 100) : reasoning.slice(0, 100);
}

export function SignalDecisionLog() {
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod]   = useState<Period>('1d');
  const [page, setPage]       = useState(0);
  const { displaySymbol, marketFlag } = useSymbolMeta();

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    try {
      const limit = p === '1d' ? 200 : 500;
      const res  = await fetch(`/api/signals?status=auto_submitted&limit=${limit}&since=${sinceMs(p)}`);
      const data = await res.json() as { ok: boolean; data?: SignalRow[] };
      if (data.ok) setSignals(data.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPage(0);
    load(period);
    const id = setInterval(() => load(period), 30_000);
    return () => clearInterval(id);
  }, [period, load]);

  const totalPages = Math.max(1, Math.ceil(signals.length / PAGE_SIZE));
  const pageSignals = signals.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div>
      {/* 기간 필터 */}
      <div style={{ display: 'flex', gap: 6, padding: '4px 16px 10px' }}>
        {(Object.keys(PERIOD_LABEL) as Period[]).map(p => (
          <button key={p} onClick={() => setPeriod(p)} style={{
            padding: '4px 12px', borderRadius: 14, fontSize: 12, fontWeight: 600,
            background: period === p ? 'var(--accent)' : 'var(--bg3)',
            color:      period === p ? '#000' : 'var(--muted)',
            border: 'none', cursor: 'pointer',
          }}>{PERIOD_LABEL[p]}</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)', alignSelf: 'center' }}>
          총 {signals.length}건
        </span>
      </div>

      {/* 목록 */}
      {loading ? (
        <div style={{ padding: '16px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>불러오는 중…</div>
      ) : signals.length === 0 ? (
        <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          {PERIOD_LABEL[period]} 운영 이력이 없습니다
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 16px' }}>
          {pageSignals.map(sig => {
            const isSkip     = sig.status === 'ai_skipped';
            const ai         = sig.indicators?.ai;
            const confidence = ai?.confidence ?? null;
            const warnings   = ai?.warnings ?? [];
            const aiText     = extractAiReasoning(sig.reasoning);
            const amtKRW     = Math.round(Number(sig.amount_krw)).toLocaleString('ko-KR');

            return (
              <div key={sig.id} style={{
                background: 'var(--bg2)', borderRadius: 12, padding: '12px 14px',
                border: '1px solid var(--border)', opacity: isSkip ? 0.65 : 1,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>
                    {marketFlag(sig.symbol) && <span style={{ marginRight: 4 }} aria-hidden>{marketFlag(sig.symbol)}</span>}
                    {displaySymbol(sig.symbol)}
                  </span>
                  <span style={{
                    fontSize: 11, padding: '2px 7px', borderRadius: 8, fontWeight: 600,
                    background: sig.side === 'buy' ? 'rgba(239,68,68,.15)' : 'rgba(59,130,246,.15)',
                    color:      sig.side === 'buy' ? '#ef4444' : '#3b82f6',
                  }}>{sig.side === 'buy' ? '매수' : '매도'}</span>
                  <span style={{
                    fontSize: 11, padding: '2px 7px', borderRadius: 8, fontWeight: 700,
                    marginLeft: 'auto',
                    background: isSkip ? 'var(--bg3)' : 'rgba(34,197,94,.15)',
                    color:      isSkip ? 'var(--muted)' : 'var(--ok)',
                  }}>
                    {isSkip ? '⏭ SKIP' : '✅ EXEC'}{confidence != null ? ` ${confidence}%` : ''}
                  </span>
                </div>

                {aiText && (
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 6, lineHeight: 1.45 }}>
                    {aiText}
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const }}>
                  {warnings.map((w, i) => (
                    <span key={i} style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 6,
                      background: 'rgba(245,158,11,.12)', color: '#f59e0b',
                    }}>⚠ {w}</span>
                  ))}
                  <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto', whiteSpace: 'nowrap' as const }}>
                    ₩{amtKRW} · {formatRelativeTime(sig.created_at)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '12px 16px 4px' }}>
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{
              width: 36, height: 36, borderRadius: 10, fontSize: 16,
              background: 'var(--bg3)', color: page === 0 ? 'var(--border2)' : 'var(--text)',
              border: '1px solid var(--border2)', cursor: page === 0 ? 'default' : 'pointer',
            }}
          >‹</button>
          <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 70, textAlign: 'center' }}>
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page === totalPages - 1}
            style={{
              width: 36, height: 36, borderRadius: 10, fontSize: 16,
              background: 'var(--bg3)', color: page === totalPages - 1 ? 'var(--border2)' : 'var(--text)',
              border: '1px solid var(--border2)', cursor: page === totalPages - 1 ? 'default' : 'pointer',
            }}
          >›</button>
        </div>
      )}
    </div>
  );
}
