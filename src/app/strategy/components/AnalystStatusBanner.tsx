'use client';

import { useEffect, useState } from 'react';

interface Safety {
  analystEnabled: boolean;
  killSwitch: boolean;
  dryRun: boolean;
}

interface MarketsStatus {
  current: 'domestic' | 'overseas' | null;
  domestic: { open: boolean };
  overseas: { open: boolean };
}

interface Props {
  onStatusChange?: () => void;
}

import { formatRelativeTime } from '@/lib/time';

export function AnalystStatusBanner({ onStatusChange }: Props) {
  const [safety, setSafety]       = useState<Safety | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [markets, setMarkets]     = useState<MarketsStatus | null>(null);
  const [busy, setBusy]           = useState<'kill' | 'analyst' | null>(null);

  useEffect(() => {
    fetch('/api/settings/safety')
      .then(r => r.json())
      .then(d => { if (d.ok) setSafety(d.safety); });
    fetch('/api/signals?limit=1')
      .then(r => r.json())
      .then(d => { setLastRunAt(d.data?.[0]?.created_at ?? null); });
    const loadMarkets = () => fetch('/api/markets/status')
      .then(r => r.json())
      .then(d => { if (d.ok) setMarkets(d); })
      .catch(() => {});
    loadMarkets();
    const id = setInterval(loadMarkets, 60_000);
    return () => clearInterval(id);
  }, []);

  const patchSafety = async (key: 'kill' | 'analyst', val: boolean) => {
    setBusy(key);
    const body = key === 'kill' ? { killSwitch: val } : { analystEnabled: val };
    await fetch('/api/settings/safety', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSafety(s => s ? { ...s, ...(key === 'kill' ? { killSwitch: val } : { analystEnabled: val }) } : s);
    setBusy(null);
    onStatusChange?.();
  };

  if (!safety) return null;

  const isKill   = safety.killSwitch;
  const isActive = safety.analystEnabled && !isKill;
  const relTime  = lastRunAt ? formatRelativeTime(lastRunAt) : null;

  const bgColor     = isKill ? '#2a0a0a' : isActive ? '#0a1a0a' : '#1a1500';
  const borderColor = isKill ? '#ef444444' : isActive ? '#22c55e44' : '#f59e0b44';

  return (
    <div style={{
      margin: '12px 16px 0', padding: '14px', borderRadius: 12,
      background: bgColor, border: `1px solid ${borderColor}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        {/* Status text */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 20, flexShrink: 0 }}>
            {isKill ? '🚨' : isActive ? '🟢' : '⏸'}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              {isKill ? '긴급 정지 중' : isActive ? '분석가 운영 중' : '일시 중지'}
            </div>
            {!isKill && (
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                {isActive ? '자동 매매 중' : '분석가가 비활성 상태입니다'}
                {relTime ? ` · 마지막 시그널: ${relTime}` : ''}
              </div>
            )}
            {isKill && (
              <div style={{ fontSize: 11, color: '#ef4444', marginTop: 2 }}>
                모든 주문 송신이 차단됩니다
              </div>
            )}
          </div>
        </div>

        {/* Control buttons */}
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {!isKill && (
            <button
              onClick={() => patchSafety('analyst', !safety.analystEnabled)}
              disabled={busy === 'analyst'}
              aria-label={safety.analystEnabled ? '분석가 일시 중지' : '분석가 활성화'}
              style={{
                padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                background: safety.analystEnabled ? 'var(--bg3)' : 'rgba(34,197,94,.18)',
                color: safety.analystEnabled ? 'var(--muted)' : 'var(--ok)',
                opacity: busy === 'analyst' ? 0.5 : 1,
              }}
            >
              {busy === 'analyst' ? '…' : safety.analystEnabled ? 'OFF' : 'ON'}
            </button>
          )}
          <button
            onClick={() => patchSafety('kill', !isKill)}
            disabled={busy === 'kill'}
            aria-label={isKill ? '긴급 정지 해제' : '긴급 정지 활성화'}
            style={{
              padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              background: isKill ? 'rgba(239,68,68,.3)' : 'var(--bg3)',
              color: isKill ? '#ef4444' : 'var(--muted)',
              border: isKill ? '1px solid #ef444466' : '1px solid transparent',
              opacity: busy === 'kill' ? 0.5 : 1,
            }}
          >
            {busy === 'kill' ? '…' : isKill ? '정지 해제' : '긴급 정지'}
          </button>
        </div>
      </div>

      {markets && !isKill && (
        <div style={{
          marginTop: 8, fontSize: 11, color: 'var(--muted)',
          borderTop: '1px solid var(--border)', paddingTop: 8,
          display: 'flex', gap: 10, flexWrap: 'wrap',
        }}>
          <span style={{ color: markets.domestic.open ? 'var(--ok)' : 'var(--muted)', fontWeight: 600 }}>
            🇰🇷 {markets.domestic.open ? '개장' : '마감'}
          </span>
          <span style={{ color: markets.overseas.open ? 'var(--ok)' : 'var(--muted)', fontWeight: 600 }}>
            🇺🇸 {markets.overseas.open ? '개장' : '마감'}
          </span>
          {markets.current === null && (
            <span>· 양시장 마감 중 — 시그널 발화 보류</span>
          )}
        </div>
      )}

      {safety.dryRun && !isKill && (
        <div style={{
          marginTop: 8, fontSize: 11, color: 'var(--accent)',
          borderTop: '1px solid var(--border)', paddingTop: 8,
        }}>
          ⚠️ DRY RUN 모드 — 실제 주문이 전송되지 않습니다
        </div>
      )}
    </div>
  );
}
