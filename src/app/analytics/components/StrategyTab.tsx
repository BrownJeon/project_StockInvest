'use client';

import { useEffect, useState } from 'react';
import { formatRelativeTime } from '@/lib/time';
import { Paginator } from './Paginator';

const PAGE_SIZE = 7;

type Period = '1d' | '7d' | '30d';

const PERIOD_LABEL: Record<Period, string> = { '1d': '1일', '7d': '7일', '30d': '30일' };

interface StrategyMetrics {
  totalReturnPct: number | null;
  sharpe: number | null;
  mdd: number | null;
  winRate: number | null;
  tradeCount: number | null;
}

interface StrategyItem {
  id: string;
  lastBacktestAt: string | null;
  metrics: StrategyMetrics | null;
  signals: {
    total: number;
    buy: number;
    sell: number;
    avgAiConfidence: number | null;
  };
}

const STRATEGY_META: Record<string, { name: string; desc: string }> = {
  'rsi-oversold-v1': {
    name: 'RSI 역추세',
    desc: 'RSI(14)가 30 이하 과매도 구간 진입 시 매수, 70 이상 과매수 시 매도. 단기 반등을 노리는 평균 회귀 전략.',
  },
  'ma-cross-v1': {
    name: 'MA 골든크로스',
    desc: '단기(MA5)가 장기(MA20)를 상향 돌파하면 매수(골든크로스), 하향 돌파하면 매도(데드크로스). 추세 추종 전략.',
  },
  'bb-breakout-v1': {
    name: '볼린저 밴드 돌파',
    desc: '종가가 볼린저 밴드 상단을 상향 돌파할 때 매수, 중앙선 아래로 하락하면 매도. 변동성 확대 구간을 포착하는 돌파 전략.',
  },
};

function relTime(iso: string | null) {
  if (!iso) return '없음';
  return formatRelativeTime(iso);
}

function pctColor(v: number | null, invert = false) {
  if (v == null) return 'var(--muted)';
  return (invert ? v <= 0 : v >= 0) ? 'var(--up)' : 'var(--down)';
}

function fmtPct(v: number | null, sign = true) {
  if (v == null) return '—';
  return `${sign && v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function MetricPill({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 56 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: color ?? 'var(--text)' }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function StrategyCard({ s, period }: { s: StrategyItem; period: Period }) {
  const m = s.metrics;
  const meta = STRATEGY_META[s.id];
  return (
    <div style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden', marginBottom: 10 }}>
      {/* 헤더 */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>{meta?.name ?? s.id}</span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>평가 {relTime(s.lastBacktestAt)}</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>{meta?.desc ?? s.id}</div>
      </div>

      {/* 백테스트 지표 */}
      {m ? (
        <div style={{ display: 'flex', justifyContent: 'space-around', padding: '14px 8px', borderBottom: '1px solid var(--border)' }}>
          <MetricPill label="수익률" value={fmtPct(m.totalReturnPct)} color={pctColor(m.totalReturnPct)} />
          <MetricPill label="샤프" value={m.sharpe != null ? m.sharpe.toFixed(2) : '—'} color={m.sharpe != null && m.sharpe >= 1 ? 'var(--up)' : 'var(--muted)'} />
          <MetricPill label="MDD" value={fmtPct(m.mdd, false)} color={pctColor(m.mdd, true)} />
          <MetricPill label="승률" value={m.winRate != null ? `${m.winRate.toFixed(0)}%` : '—'} />
          <MetricPill label="거래" value={m.tradeCount != null ? `${m.tradeCount}건` : '—'} />
        </div>
      ) : (
        <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
          백테스트 결과 없음
        </div>
      )}

      {/* 기간별 시그널 */}
      <div style={{ padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          {PERIOD_LABEL[period]} 시그널:&nbsp;
          <span style={{ color: 'var(--text)', fontWeight: 600 }}>{s.signals.total}건</span>
          {s.signals.total > 0 && (
            <span style={{ marginLeft: 6 }}>
              <span style={{ color: 'var(--up)' }}>매수 {s.signals.buy}</span>
              {' / '}
              <span style={{ color: 'var(--down)' }}>매도 {s.signals.sell}</span>
            </span>
          )}
        </div>
        {s.signals.avgAiConfidence != null && (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            AI 신뢰도 <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{s.signals.avgAiConfidence}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function StrategyTab() {
  const [strategies, setStrategies] = useState<StrategyItem[]>([]);
  const [loading, setLoading]       = useState(true);
  const [period, setPeriod]         = useState<Period>('7d');
  const [page, setPage]             = useState(0);

  useEffect(() => {
    setPage(0);
    setLoading(true);
    fetch(`/api/analytics/strategies?period=${period}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setStrategies(d.strategies); })
      .finally(() => setLoading(false));
  }, [period]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 기간 선택 */}
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
            {PERIOD_LABEL[p]}
          </button>
        ))}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>불러오는 중…</div>}
      {!loading && strategies.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>등록된 전략 없음</div>
      )}
      {!loading && (() => {
        const totalPages = Math.ceil(strategies.length / PAGE_SIZE);
        const paged = strategies.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
        return (
          <>
            {paged.map(s => <StrategyCard key={s.id} s={s} period={period} />)}
            <Paginator page={page} totalPages={totalPages} onPage={setPage} />
          </>
        );
      })()}
    </div>
  );
}
