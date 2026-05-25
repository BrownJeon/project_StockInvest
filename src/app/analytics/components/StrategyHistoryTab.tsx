'use client';

import { useEffect, useState } from 'react';
import { formatRelativeTime } from '@/lib/time';
import { useSymbolMeta } from '@/lib/hooks/useSymbolMeta';
import { Paginator } from './Paginator';

const PAGE_SIZE = 7;

type Period = '1d' | '7d' | '30d';
const PERIOD_LABEL: Record<Period, string> = { '1d': '1일', '7d': '7일', '30d': '30일' };

const STRATEGY_NAME: Record<string, string> = {
  'rsi-oversold-v1':         'RSI 역추세',
  'ma-cross-v1':             'MA 골든크로스',
  'bb-breakout-v1':          '볼린저 돌파',
  'rsi-macd-reversal-v1':    'RSI+MACD 반전',
  'bb-squeeze-expansion-v1': '볼린저 Squeeze 확장',
  'rsi-divergence-v1':       'RSI 다이버전스',
  'triple-confirmation-v1':  '3중 확인',
};

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  auto_submitted: { text: '자동제출', color: 'var(--up)' },
  executed:       { text: '체결',     color: 'var(--up)' },
  accepted:       { text: '승인됨',   color: 'var(--up)' },
  approved:       { text: '승인',     color: '#60a5fa' },
  ai_skipped:     { text: 'AI 스킵', color: 'var(--muted)' },
  pending:        { text: '대기중',   color: '#fbbf24' },
  rejected:       { text: '거부됨',   color: 'var(--down)' },
  expired:        { text: '만료',     color: 'var(--muted)' },
  superseded:     { text: '대체됨',   color: 'var(--muted)' },
};

interface SignalRow {
  id: number;
  strategy_id: string | null;
  symbol: string;
  side: 'buy' | 'sell';
  order_type: string;
  amount_krw: string;
  reasoning: string | null;
  indicators: { ai?: { confidence: number; warnings: string[]; selectedFrom?: number } } | null;
  status: string;
  created_at: string;
}

function sinceMs(period: Period): number {
  if (period === '1d') {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime() - 9 * 3600_000; // KST 기준 오늘 00:00
  }
  const days = period === '7d' ? 7 : 30;
  return Date.now() - days * 86_400_000;
}

function SignalCard({ sig, expanded, onToggle, displaySymbol, marketFlag }: {
  sig: SignalRow; expanded: boolean; onToggle: () => void;
  displaySymbol: (s: string) => string; marketFlag: (s: string) => string;
}) {
  const ai = sig.indicators?.ai;
  const status = STATUS_LABEL[sig.status] ?? { text: sig.status, color: 'var(--muted)' };
  const stratName = sig.strategy_id ? (STRATEGY_NAME[sig.strategy_id] ?? sig.strategy_id) : '—';
  const isSkipped = sig.status === 'ai_skipped';

  return (
    <div
      style={{
        background: 'var(--bg2)', borderRadius: 10, border: '1px solid var(--border)',
        marginBottom: 8, overflow: 'hidden', opacity: isSkipped ? 0.72 : 1,
      }}
    >
      {/* 헤더 행 */}
      <div
        style={{ padding: '10px 14px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4 }}
        onClick={onToggle}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* 매수/매도 뱃지 */}
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
              background: sig.side === 'buy' ? 'rgba(239,68,68,0.15)' : 'rgba(59,130,246,0.15)',
              color: sig.side === 'buy' ? 'var(--up)' : 'var(--down)',
            }}>
              {sig.side === 'buy' ? '매수' : '매도'}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              {marketFlag(sig.symbol) && <span style={{ marginRight: 4 }} aria-hidden>{marketFlag(sig.symbol)}</span>}
              {displaySymbol(sig.symbol)}
            </span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{stratName}</span>
          </div>
          <span style={{ fontSize: 11, fontWeight: 600, color: status.color }}>{status.text}</span>
        </div>

        {/* AI 신뢰도 + 시간 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {ai?.confidence != null && (
              <span style={{ fontSize: 11, color: ai.confidence >= 70 ? 'var(--up)' : ai.confidence >= 55 ? 'var(--accent)' : 'var(--muted)' }}>
                신뢰도 {ai.confidence}%
              </span>
            )}
            {ai?.selectedFrom != null && (
              <span style={{ fontSize: 10, color: 'var(--muted)' }}>후보 {ai.selectedFrom}개 중 선택</span>
            )}
          </div>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{formatRelativeTime(sig.created_at)}</span>
        </div>

        {/* 근거 미리보기 (접힌 상태) */}
        {!expanded && sig.reasoning && (
          <div style={{
            fontSize: 11, color: 'var(--muted)', lineHeight: 1.4,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {sig.reasoning}
          </div>
        )}
      </div>

      {/* 펼친 상태: 상세 근거 + 경고 */}
      {expanded && (
        <div style={{ padding: '0 14px 12px', borderTop: '1px solid var(--border)' }}>
          {sig.reasoning && (
            <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6, marginTop: 10, whiteSpace: 'pre-wrap' }}>
              {sig.reasoning}
            </div>
          )}
          {ai?.warnings && ai.warnings.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {ai.warnings.map((w, i) => (
                <div key={i} style={{
                  fontSize: 11, color: '#fbbf24', background: 'rgba(251,191,36,0.1)',
                  borderRadius: 6, padding: '4px 8px',
                }}>
                  ⚠ {w}
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: 10, color: 'var(--muted)' }}>
            금액: ₩{Number(sig.amount_krw).toLocaleString('ko-KR')} · ID #{sig.id}
          </div>
        </div>
      )}
    </div>
  );
}

export function StrategyHistoryTab() {
  const [period, setPeriod]       = useState<Period>('1d');
  const [signals, setSignals]     = useState<SignalRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [expanded, setExpanded]   = useState<Set<number>>(new Set());
  const [filterSide, setFilter]   = useState<'all' | 'buy' | 'sell'>('all');
  const [page, setPage]           = useState(0);
  const { displaySymbol, marketFlag } = useSymbolMeta();

  useEffect(() => {
    setLoading(true);
    setExpanded(new Set());
    const since = sinceMs(period);
    fetch(`/api/signals?since=${since}&limit=500`)
      .then(r => r.json())
      .then(d => { if (d.ok) setSignals(d.data as SignalRow[]); })
      .finally(() => setLoading(false));
  }, [period]);

  const toggleExpand = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  useEffect(() => { setPage(0); }, [period, filterSide]);

  const filtered = filterSide === 'all' ? signals : signals.filter(s => s.side === filterSide);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const counts = {
    total:   signals.length,
    executed: signals.filter(s => ['auto_submitted','executed','accepted','approved'].includes(s.status)).length,
    skipped: signals.filter(s => s.status === 'ai_skipped').length,
    buy:     signals.filter(s => s.side === 'buy' && s.status !== 'ai_skipped').length,
    sell:    signals.filter(s => s.side === 'sell' && s.status !== 'ai_skipped').length,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 기간 + 방향 필터 */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(['1d', '7d', '30d'] as Period[]).map(p => (
          <button key={p} onClick={() => setPeriod(p)} style={{
            padding: '5px 14px', borderRadius: 16, fontSize: 12, fontWeight: 600,
            background: period === p ? 'var(--accent)' : 'var(--bg3)',
            color: period === p ? '#000' : 'var(--muted)',
            border: 'none', cursor: 'pointer',
          }}>
            {PERIOD_LABEL[p]}
          </button>
        ))}
        <div style={{ width: 1, background: 'var(--border)', margin: '0 2px' }} />
        {(['all', 'buy', 'sell'] as const).map(s => (
          <button key={s} onClick={() => setFilter(s)} style={{
            padding: '5px 14px', borderRadius: 16, fontSize: 12, fontWeight: 600,
            background: filterSide === s ? 'var(--bg3)' : 'transparent',
            color: filterSide === s
              ? (s === 'buy' ? 'var(--up)' : s === 'sell' ? 'var(--down)' : 'var(--text)')
              : 'var(--muted)',
            border: `1px solid ${filterSide === s ? 'var(--border)' : 'transparent'}`,
            cursor: 'pointer',
          }}>
            {s === 'all' ? '전체' : s === 'buy' ? '매수' : '매도'}
          </button>
        ))}
      </div>

      {/* 요약 통계 */}
      {!loading && signals.length > 0 && (
        <div style={{
          display: 'flex', gap: 0,
          background: 'var(--bg2)', borderRadius: 10, border: '1px solid var(--border)',
          overflow: 'hidden',
        }}>
          {[
            { label: '전체 시그널', value: counts.total, color: 'var(--text)' },
            { label: '실행됨',     value: counts.executed, color: 'var(--up)' },
            { label: 'AI 스킵',    value: counts.skipped,  color: 'var(--muted)' },
            { label: '매수',       value: counts.buy,       color: 'var(--up)' },
            { label: '매도',       value: counts.sell,      color: 'var(--down)' },
          ].map((item, i) => (
            <div key={i} style={{
              flex: 1, padding: '10px 4px', textAlign: 'center',
              borderRight: i < 4 ? '1px solid var(--border)' : 'none',
            }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: item.color }}>{item.value}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{item.label}</div>
            </div>
          ))}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>불러오는 중…</div>
      )}
      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>
          {PERIOD_LABEL[period]} 내 시그널 없음
        </div>
      )}
      {!loading && paged.map(sig => (
        <SignalCard
          key={sig.id}
          sig={sig}
          expanded={expanded.has(sig.id)}
          onToggle={() => toggleExpand(sig.id)}
          displaySymbol={displaySymbol}
          marketFlag={marketFlag}
        />
      ))}
      {!loading && <Paginator page={page} totalPages={totalPages} onPage={setPage} />}
    </div>
  );
}
