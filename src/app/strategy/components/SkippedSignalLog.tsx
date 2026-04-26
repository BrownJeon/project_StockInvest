'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatRelativeTime, kstTodayStart } from '@/lib/time';
import { useSymbolMeta } from '@/lib/hooks/useSymbolMeta';

interface SignalRow {
  id: number;
  strategy_id: string | null;
  symbol: string;
  side: 'buy' | 'sell';
  status: string;
  reasoning: string | null;
  indicators: { ai?: { confidence: number; warnings: string[] } } | null;
  amount_krw: string;
  created_at: string;
}

const COLLAPSED_COUNT = 5;

function extractAiReasoning(reasoning: string | null): string {
  if (!reasoning) return '';
  const match = reasoning.match(/\[AI \d+%\]\s*(.+)/s);
  return match ? match[1].slice(0, 120) : reasoning.slice(0, 120);
}

export function SkippedSignalLog() {
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const { displaySymbol, marketFlag } = useSymbolMeta();

  const load = useCallback(async () => {
    try {
      const since = kstTodayStart().getTime();
      const res = await fetch(`/api/signals?status=ai_skipped&limit=200&since=${since}`);
      const data = await res.json() as { ok: boolean; data?: SignalRow[] };
      if (data.ok) setSignals(data.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const visible = expanded ? signals : signals.slice(0, COLLAPSED_COUNT);
  const hidden = signals.length - COLLAPSED_COUNT;

  return (
    <div style={{ borderTop: '1px solid var(--border)', marginTop: 4 }}>
      <div style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: '.5px' }}>
          ⏭ AI 스킵 이력
        </span>
        {signals.length > 0 && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
            background: 'var(--bg3)', fontSize: 11, fontWeight: 700, color: 'var(--muted)',
          }}>{signals.length}</span>
        )}
        <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>오늘</span>
      </div>

      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading ? (
          <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            불러오는 중…
          </div>
        ) : signals.length === 0 ? (
          <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            오늘 스킵된 시그널 없음
          </div>
        ) : (
          <>
            {visible.map(sig => {
              const ai = sig.indicators?.ai;
              const confidence = ai?.confidence ?? null;
              const warnings = ai?.warnings ?? [];
              const aiText = extractAiReasoning(sig.reasoning);
              const amtKRW = Math.round(Number(sig.amount_krw)).toLocaleString('ko-KR');

              return (
                <div key={sig.id} style={{
                  background: 'var(--bg2)', borderRadius: 12, padding: '10px 13px',
                  border: '1px solid var(--border)', opacity: 0.75,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>
                      {marketFlag(sig.symbol) && <span style={{ marginRight: 4 }} aria-hidden>{marketFlag(sig.symbol)}</span>}
                      {displaySymbol(sig.symbol)}
                    </span>
                    <span style={{
                      fontSize: 11, padding: '1px 6px', borderRadius: 7, fontWeight: 600,
                      background: sig.side === 'buy' ? 'rgba(239,68,68,.15)' : 'rgba(59,130,246,.15)',
                      color: sig.side === 'buy' ? '#ef4444' : '#3b82f6',
                    }}>
                      {sig.side === 'buy' ? '매수' : '매도'}
                    </span>
                    {confidence != null && (
                      <span style={{
                        fontSize: 11, padding: '1px 6px', borderRadius: 7, fontWeight: 600,
                        background: 'var(--bg3)', color: 'var(--muted)', marginLeft: 'auto',
                      }}>
                        SKIP {confidence}%
                      </span>
                    )}
                  </div>

                  {aiText && (
                    <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 5, lineHeight: 1.45 }}>
                      {aiText}
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' as const }}>
                    {warnings.map((w, i) => (
                      <span key={i} style={{
                        fontSize: 10, padding: '1px 5px', borderRadius: 5,
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

            {hidden > 0 && !expanded && (
              <button
                onClick={() => setExpanded(true)}
                style={{
                  width: '100%', padding: '10px', borderRadius: 10, fontSize: 13,
                  background: 'var(--bg2)', border: '1px dashed var(--border)',
                  color: 'var(--muted)', cursor: 'pointer',
                }}
              >
                {hidden}개 더 보기 ▼
              </button>
            )}
            {expanded && hidden > 0 && (
              <button
                onClick={() => setExpanded(false)}
                style={{
                  width: '100%', padding: '10px', borderRadius: 10, fontSize: 13,
                  background: 'var(--bg2)', border: '1px dashed var(--border)',
                  color: 'var(--muted)', cursor: 'pointer',
                }}
              >
                접기 ▲
              </button>
            )}
          </>
        )}
      </div>
      <div style={{ height: 16 }} />
    </div>
  );
}
