'use client';

import { useEffect, useState } from 'react';
import { fmtNum } from '@/lib/format';
import { formatSymbolShort, symbolUnit } from '@/lib/symbols';

function marketFlag(sym: string): string {
  if (sym === 'KRW' || sym === 'USD') return '';
  return sym.includes(':') ? '🇺🇸 ' : '🇰🇷 ';
}

type Period = '1d' | '7d' | '30d';

interface Position {
  currency: string;
  qty?: number;
  value_krw?: number;
}

interface PortfolioData {
  latest: { ts: string; totalKRW: number; positions: Position[] } | null;
  changePct: number | null;
  period: string;
  periodReturns: Record<string, number | null>;
  volGuard: { ok: boolean; level: string; changePct?: number };
}

const VOL_GUARD_COLOR: Record<string, string> = {
  ok:    'var(--ok)',
  warn:  'var(--accent)',
  block: 'var(--down)',
  panic: 'var(--down)',
};

function pctColor(v: number | null) {
  if (v == null) return 'var(--muted)';
  return v >= 0 ? 'var(--up)' : 'var(--down)';
}

function fmtPct(v: number | null) {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

import { formatRelativeTime as relTime } from '@/lib/time';

export function PortfolioTab() {
  const [data, setData]           = useState<PortfolioData | null>(null);
  const [period, setPeriod]       = useState<Period>('7d');
  const [loading, setLoading]     = useState(true);
  const [hideSmall, setHideSmall] = useState(true);
  const [meta, setMeta]           = useState<Record<string, string>>({});

  useEffect(() => {
    setLoading(true);
    fetch(`/api/analytics/portfolio?period=${period}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setData(d); })
      .finally(() => setLoading(false));
  }, [period]);

  // 종목명 캐시 lazy 로드 (data가 로드된 시점에서 1회)
  useEffect(() => {
    if (!data?.latest?.positions) return;
    const symbols = data.latest.positions
      .map(p => p.currency)
      .filter(s => s !== 'KRW' && s !== 'USD');
    if (symbols.length === 0) return;
    fetch('/api/ticker/all')
      .then(r => r.json())
      .then(j => {
        if (j.ok && j.meta) setMeta(j.meta as Record<string, string>);
      })
      .catch(() => {});
  }, [data]);

  const displayName = (sym: string): string => {
    if (sym === 'KRW' || sym === 'USD') return sym;
    const name = meta[sym];
    const short = formatSymbolShort(sym);
    if (name && name !== sym && name !== short) return `${name} (${short})`;
    return short;
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>불러오는 중…</div>;

  if (!data?.latest) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13, lineHeight: 1.8 }}>
        포트폴리오 스냅샷 없음<br />
        <span style={{ fontSize: 12 }}>크론 `/api/cron/portfolio-snapshot` 실행 후 표시됩니다</span>
      </div>
    );
  }

  const { latest, changePct, periodReturns, volGuard } = data;
  const guardColor = VOL_GUARD_COLOR[volGuard.level] ?? 'var(--muted)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* 총 자산 카드 */}
      <div style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)', padding: '16px' }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>총 자산 · {relTime(latest.ts)} 기준</div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>₩{fmtNum(latest.totalKRW)}</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: pctColor(changePct) }}>{fmtPct(changePct)}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: guardColor }} />
          <span style={{ fontSize: 12, color: guardColor }}>
            변동폭 가드: {volGuard.level.toUpperCase()}
            {volGuard.changePct != null && ` (${volGuard.changePct.toFixed(2)}%)`}
          </span>
        </div>
      </div>

      {/* 기간 토글 */}
      <div style={{ display: 'flex', gap: 6 }}>
        {(['1d', '7d', '30d'] as Period[]).map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            style={{
              padding: '5px 14px', borderRadius: 16, fontSize: 12, fontWeight: 600,
              background: period === p ? 'var(--accent)' : 'var(--bg3)',
              color: period === p ? '#000' : 'var(--muted)',
              border: 'none', cursor: 'pointer',
            }}
          >
            {p.toUpperCase()}
          </button>
        ))}
      </div>

      {/* 기간별 수익률 */}
      <div style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
        {Object.entries(periodReturns).map(([p, pct], i, arr) => (
          <div
            key={p}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 16px',
              borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
            }}
          >
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>
              {p === '1d' ? '1일' : p === '7d' ? '7일' : '30일'} 수익률
            </span>
            <span style={{ fontSize: 14, fontWeight: 700, color: pctColor(pct) }}>{fmtPct(pct)}</span>
          </div>
        ))}
      </div>

      {/* 자산 구성 */}
      {latest.positions.length > 0 && (() => {
        const held = latest.positions.filter(p => (p.value_krw ?? 0) > 0);
        const visible = hideSmall ? held.filter(p => (p.value_krw ?? 0) >= 10_000) : held;
        const hiddenCount = held.length - visible.length;
        if (held.length === 0) return null;
        return (
        <div style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>자산 구성</span>
            <button
              onClick={() => setHideSmall(v => !v)}
              style={{ fontSize: 11, color: hideSmall ? 'var(--accent)' : 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              {hideSmall ? `소액 숨김 (${hiddenCount}개)` : '소액 표시'}
            </button>
          </div>
          {visible.map((pos, i) => {
            const val = pos.value_krw ?? 0;
            const pct = latest.totalKRW > 0 ? (val / latest.totalKRW) * 100 : 0;
            return (
              <div
                key={pos.currency}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '11px 16px',
                  borderBottom: i < visible.length - 1 ? '1px solid var(--border)' : 'none',
                }}
              >
                <div>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    {marketFlag(pos.currency)}{displayName(pos.currency)}
                  </span>
                  {pos.qty != null && pos.currency !== 'KRW' && pos.currency !== 'USD' && (
                    <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6 }}>{pos.qty}{symbolUnit(pos.currency)}</span>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>₩{fmtNum(val)}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{pct.toFixed(1)}%</div>
                </div>
              </div>
            );
          })}
        </div>
        );
      })()}
    </div>
  );
}
