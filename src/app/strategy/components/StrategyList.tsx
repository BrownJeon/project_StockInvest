'use client';

import { useCallback, useEffect, useState } from 'react';

type AnalystStyle = 'aggressive' | 'neutral' | 'stable';

interface Strategy {
  id: string;
  name: string;
  description: string;
  tags: string[];
  enabled: boolean;
  applicable_styles: AnalystStyle[];
  last_backtest_at: string | null;
  next_backtest_at: string | null;
}

import { formatRelativeKST } from '@/lib/time';

const STYLE_BADGE: Record<AnalystStyle, { icon: string; label: string }> = {
  aggressive: { icon: '🔥', label: '공격' },
  neutral:    { icon: '⚖️', label: '중립' },
  stable:     { icon: '🛡️', label: '안정' },
};

function fmtRunTime(iso: string | null, isFuture: boolean): string {
  if (!iso) return isFuture ? '예정 없음' : '없음';
  return formatRelativeKST(iso, isFuture ? 'future' : 'past');
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        position: 'relative', width: 44, height: 24, borderRadius: 12,
        cursor: 'pointer', flexShrink: 0,
        background: checked ? 'var(--ok)' : 'var(--bg3)',
        transition: 'background .2s',
      }}
    >
      <div style={{
        position: 'absolute', top: 2, left: checked ? 22 : 2,
        width: 20, height: 20, borderRadius: '50%', background: '#fff',
        transition: 'left .2s',
      }} />
    </div>
  );
}

function StrategyCard({
  strategy,
  currentStyle,
  onToggle,
}: {
  strategy: Strategy;
  currentStyle: AnalystStyle;
  onToggle: (id: string, v: boolean) => void;
}) {
  const appliesToCurrent = strategy.applicable_styles.includes(currentStyle);
  return (
    <div style={{
      background: 'var(--bg2)', borderRadius: 12, padding: 14,
      border: '1px solid var(--border)', opacity: strategy.enabled ? 1 : 0.55,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{strategy.name}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{strategy.description}</div>
          <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' as const }}>
            {strategy.tags.map(t => (
              <span key={t} style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 10,
                background: 'var(--bg3)', color: 'var(--muted)', border: '1px solid var(--border2)',
              }}>{t}</span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' as const }}>
            {(['aggressive', 'neutral', 'stable'] as AnalystStyle[]).map(k => {
              const applies = strategy.applicable_styles.includes(k);
              const isCurrent = currentStyle === k;
              return (
                <span key={k} style={{
                  fontSize: 10, padding: '2px 6px', borderRadius: 8,
                  background: applies ? (isCurrent ? 'rgba(251,191,36,.18)' : 'var(--bg3)') : 'transparent',
                  color: applies ? (isCurrent ? 'var(--accent)' : 'var(--text)') : 'var(--muted)',
                  border: `1px solid ${isCurrent && applies ? 'var(--accent)' : 'var(--border2)'}`,
                  opacity: applies ? 1 : 0.4,
                  fontWeight: isCurrent && applies ? 700 : 400,
                }}>
                  {STYLE_BADGE[k].icon} {STYLE_BADGE[k].label}
                </span>
              );
            })}
          </div>
          {!appliesToCurrent && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, fontStyle: 'italic' }}>
              현재 성향({STYLE_BADGE[currentStyle].label})에서는 평가 대상 아님
            </div>
          )}
          <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>
            <span>마지막: {fmtRunTime(strategy.last_backtest_at, false)}</span>
            <span>다음: {fmtRunTime(strategy.next_backtest_at, true)}</span>
          </div>
        </div>
        <Toggle checked={strategy.enabled} onChange={v => onToggle(strategy.id, v)} />
      </div>
    </div>
  );
}

export function StrategyList() {
  const [strategies, setStrategies]     = useState<Strategy[]>([]);
  const [analystStyle, setAnalystStyle] = useState<AnalystStyle>('neutral');
  const [loading, setLoading]           = useState(true);

  const fetchStrategies = useCallback(async () => {
    try {
      const res  = await fetch('/api/strategies');
      const data = await res.json();
      if (data.ok) {
        setStrategies(data.strategies ?? []);
        if (data.analystStyle) setAnalystStyle(data.analystStyle);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStrategies(); }, [fetchStrategies]);

  const handleToggle = async (id: string, value: boolean) => {
    setStrategies(prev => prev.map(s => s.id === id ? { ...s, enabled: value } : s));
    await fetch(`/api/strategies/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: value }),
    });
  };

  if (loading) return (
    <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>불러오는 중…</div>
  );

  const active   = strategies.filter(s => s.enabled);
  const inactive = strategies.filter(s => !s.enabled);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {active.length === 0 && inactive.length === 0 && (
        <div style={{ textAlign: 'center', padding: 24, color: 'var(--muted)', fontSize: 13 }}>
          전략 없음
        </div>
      )}
      {active.map(s => <StrategyCard key={s.id} strategy={s} currentStyle={analystStyle} onToggle={handleToggle} />)}
      {inactive.length > 0 && (
        <>
          {active.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--muted)', padding: '4px 0', textTransform: 'uppercase', letterSpacing: '.5px' }}>
              비활성
            </div>
          )}
          {inactive.map(s => <StrategyCard key={s.id} strategy={s} currentStyle={analystStyle} onToggle={handleToggle} />)}
        </>
      )}
    </div>
  );
}
