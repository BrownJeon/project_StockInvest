'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fmtNum, fmtPnl, pnlColor } from '@/lib/format';
import { useSymbolMeta } from '@/lib/hooks/useSymbolMeta';
import type { SignalWithScenario } from './ScenarioCard';

interface PortfolioHolding {
  currency: string;
  symbol: string | null;
  qty: number;
  price: number;          // 평균 매입가
  value_krw: number;
  open24h_krw: number;
  change_24h_pct: number | null;
  is_cash: boolean;
}

interface PortfolioData {
  holdings: PortfolioHolding[];
}

interface Props {
  reloadKey?: number;
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{
      height: 5, borderRadius: 99, background: 'var(--bg3)',
      marginTop: 6, overflow: 'hidden',
    }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 99, transition: 'width .3s' }} />
    </div>
  );
}

function PositionCard({ holding, displayName }: { holding: PortfolioHolding; displayName: string }) {
  const pct = holding.change_24h_pct;
  const entryPrice = holding.price;
  const currentValue = holding.value_krw;
  const entryValue = entryPrice * holding.qty;
  const pnlKrw = currentValue - entryValue;
  const pnlPct = entryValue > 0 ? (pnlKrw / entryValue) * 100 : 0;

  // 목표/손절 대략 계산 (실제 시나리오 미연결 상태; 표시용)
  const targetProgress = pnlPct;

  return (
    <div style={{
      background: 'var(--bg2)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '12px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{displayName}</div>
          <div className="num" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            진입 {fmtNum(entryPrice)} · {Math.floor(holding.qty).toLocaleString('ko-KR')}주
          </div>
        </div>
        <div style={{ textAlign: 'right' as const }}>
          <div className="num" style={{ fontSize: 15, fontWeight: 700 }}>{fmtNum(currentValue)}</div>
          <div className="num" style={{ fontSize: 13, fontWeight: 600, color: pnlColor(pnlPct), marginTop: 2 }}>
            {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
            <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>
              ({pnlKrw >= 0 ? '+' : ''}{fmtNum(pnlKrw)})
            </span>
          </div>
        </div>
      </div>
      {/* 손익 진행바 — 양수=빨강(목표 방향), 음수=파랑(손절 방향) */}
      <ProgressBar
        value={Math.abs(targetProgress)}
        max={5}
        color={pnlPct >= 0 ? 'var(--up)' : 'var(--down)'}
      />
    </div>
  );
}

function WatchCard({ signal, displayName }: { signal: SignalWithScenario; displayName: string }) {
  const sc = signal.indicators?.ai?.scenario;
  // `entry` 객체 자체가 없는 저장 JSON 이 존재한다 (T-021) — 옵셔널 체이닝 필수.
  const priceZone = sc?.entry?.price_zone ?? '-';
  const grade = sc?.grade ?? '?';

  const GRADE_COLOR: Record<string, string> = {
    'A': '#22c55e', 'B+': '#818cf8', 'B': '#f59e0b', 'C': '#6b7280',
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      background: 'var(--bg2)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '10px 12px',
    }}>
      <span style={{
        fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 8,
        background: signal.side === 'buy' ? 'rgba(239,68,68,.18)' : 'rgba(59,130,246,.18)',
        color: signal.side === 'buy' ? 'var(--up)' : 'var(--down)',
        flexShrink: 0,
      }}>
        {signal.side === 'buy' ? '매수' : '매도'}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayName}
        </div>
        <div className="num" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
          구간 {priceZone}원
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{
          fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 8,
          color: GRADE_COLOR[grade] ?? '#6b7280',
          background: 'var(--bg3)', border: '1px solid var(--border2)',
        }}>
          {grade}
        </span>
        <Link
          href={`/recommend/${signal.id}`}
          style={{
            fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 8,
            background: 'rgba(99,102,241,.15)', color: '#818cf8',
            border: '1px solid rgba(99,102,241,.3)', textDecoration: 'none',
          }}
        >보기</Link>
      </div>
    </div>
  );
}

export function TradingBoard({ reloadKey = 0 }: Props) {
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);
  const [watchSignals, setWatchSignals] = useState<SignalWithScenario[]>([]);
  const [loading, setLoading] = useState(true);
  const { displaySymbol, marketFlag } = useSymbolMeta();

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch('/api/portfolio').then(r => r.json()).catch(() => null),
      fetch('/api/signals?status=approved_pending_entry&limit=50').then(r => r.json()).catch(() => null),
    ]).then(([portRes, sigRes]) => {
      if (portRes?.ok) setPortfolio(portRes.data as PortfolioData);
      if (sigRes?.ok) setWatchSignals((sigRes.data ?? []) as SignalWithScenario[]);
    }).finally(() => setLoading(false));
  }, [reloadKey]);

  const positions = portfolio?.holdings.filter(h => !h.is_cash && h.qty > 0) ?? [];

  if (loading) {
    return (
      <div style={{ padding: '16px', color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>
        불러오는 중...
      </div>
    );
  }

  const hasContent = positions.length > 0 || watchSignals.length > 0;
  if (!hasContent) {
    return (
      <div style={{ padding: '16px 16px 0' }}>
        <div style={{
          padding: '20px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 13,
          background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)',
        }}>
          진행 중인 포지션 및 감시 대상 없음
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* 섹션 1: 진행중 포지션 */}
      {positions.length > 0 && (
        <div style={{ borderBottom: '1px solid var(--border)' }}>
          <div style={sx.sectionHeader}>
            <span style={sx.sectionLabel}>진행중 포지션</span>
            <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>{positions.length}건</span>
          </div>
          <div style={{ padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {positions.map(h => (
              <PositionCard
                key={h.currency}
                holding={h}
                displayName={h.symbol
                  ? `${marketFlag(h.symbol)} ${displaySymbol(h.symbol)}`
                  : h.currency}
              />
            ))}
          </div>
        </div>
      )}

      {/* 섹션 2: 진입 감시 중 */}
      {watchSignals.length > 0 && (
        <div>
          <div style={sx.sectionHeader}>
            <span style={sx.sectionLabel}>진입 감시 중</span>
            <Link href="/recommend" style={{ fontSize: 11, color: 'var(--muted)', textDecoration: 'none' }}>
              전체 →
            </Link>
          </div>
          <div style={{ padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {watchSignals.map(s => (
              <WatchCard
                key={s.id}
                signal={s}
                displayName={`${marketFlag(s.symbol)} ${displaySymbol(s.symbol)}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const sx: Record<string, React.CSSProperties> = {
  sectionHeader: {
    padding: '10px 16px 6px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  sectionLabel: {
    fontSize: 12, fontWeight: 700, color: 'var(--muted)',
    textTransform: 'uppercase', letterSpacing: '.5px',
  },
};
