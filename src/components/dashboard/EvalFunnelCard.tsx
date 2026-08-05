'use client';

import { useEffect, useState } from 'react';

interface FunnelStepCount {
  key: string;
  label: string;
  count: number;
  pctOfPrev: number | null;
}

interface FunnelReasonCount {
  gate: string;
  label: string;
  count: number;
}

interface FunnelAnomaly {
  label: string;
  count: number;
}

interface EvalFunnelSummary {
  runs: number;
  fullEvalRuns: number;
  symbolsEvaluated: number;
  /** 평가 트랙 전용 (exit 엔진 발화분 제외) */
  buySignals: number;
  /** 평가 트랙 전용 (exit 엔진 발화분 제외) */
  sellSignals: number;
  /** exit 엔진(보유 관리) 청산 시그널 — 깔때기 6단계와 모수가 다른 별도 트랙 */
  exitSignals: number;
  steps: FunnelStepCount[];
  bottlenecks: FunnelReasonCount[];
  anomalies: FunnelAnomaly[];
  neutralPct: number | null;
}

/**
 * 오늘의 평가 깔때기 카드 (T-002 §4) — 국내장 기준.
 * "시그널이 왜 안 나오는가"를 3초 안에 읽게: 헤더 → 이상 배너 → 병목 1줄 → 6단계 바 → 최다 차단 top3.
 */
export function EvalFunnelCard({ reloadKey }: { reloadKey: number }) {
  const [data, setData] = useState<EvalFunnelSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/dashboard/eval-funnel?market=domestic')
      .then(r => r.json())
      .then(j => {
        if (!alive) return;
        if (j.ok) { setData(j.data); setError(null); }
        else setError(j.error ?? 'unknown');
      })
      .catch(e => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, [reloadKey]);

  if (error) return null; // 관측 실패는 조용히 숨김 — 매매 화면을 가릴 이유 없음
  if (!data) return null;

  const strategySignals = data.buySignals + data.sellSignals;
  const signalsCreated = strategySignals + data.exitSignals;
  const top = data.bottlenecks[0];
  const evaluated = data.steps.find(s => s.key === 'evaluated')?.count ?? 0;

  return (
    <section style={sx.card}>
      <div
        onClick={() => setExpanded(v => !v)}
        style={{ ...sx.cardHeader, cursor: 'pointer', userSelect: 'none' as const }}
      >
        <span style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '.6px', textTransform: 'uppercase' }}>
          오늘의 평가 깔때기
        </span>
        <span style={{
          fontSize: 14, color: 'var(--muted)', transition: 'transform .15s',
          display: 'inline-block', transform: expanded ? 'rotate(180deg)' : 'rotate(0)',
        }}>▾</span>
      </div>

      {/* 헤더(결론) */}
      <div style={{ padding: '2px 14px 10px' }}>
        <div style={{ fontSize: 13 }}>
          오늘 시그널{' '}
          <strong style={{ color: signalsCreated > 0 ? 'var(--ok)' : 'var(--text)' }}>{signalsCreated}건</strong>
          {signalsCreated > 0 && (
            <span style={{ color: 'var(--muted)' }}> (전략 {strategySignals} · 청산 {data.exitSignals})</span>
          )}
          <span style={{ color: 'var(--muted)' }}> · 런 {data.runs}회{data.fullEvalRuns !== data.runs ? ` (풀평가 ${data.fullEvalRuns}회)` : ''}</span>
        </div>

        {/* 이상 배너 */}
        {data.anomalies.length > 0 && (
          <div style={{
            marginTop: 6, padding: '6px 10px', borderRadius: 8, fontSize: 11.5,
            background: 'rgba(239,68,68,.12)', color: '#f87171', lineHeight: 1.5,
          }}>
            ⚠ 이상: {data.anomalies.map(a => `${a.label} ${a.count}회`).join(' · ')}
          </div>
        )}

        {/* 병목 1줄 */}
        {top && evaluated > 0 && (
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>
            병목: <strong style={{ color: 'var(--text)' }}>{top.label}</strong>{' '}
            {top.count}/{evaluated}종목 (-{Math.round((top.count / evaluated) * 100)}%)
          </div>
        )}
      </div>

      {expanded && (
        <>
          {/* 6단계 미니 깔때기 바 */}
          <div style={{ padding: '4px 14px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.steps.map(s => (
              <FunnelStepBar key={s.key} step={s} maxCount={evaluated} />
            ))}
          </div>

          {/* exit 트랙 — 위 6단계와 모수가 달라 사슬에 합산하지 않는다 (T-004) */}
          {data.exitSignals > 0 && (
            <div style={{ padding: '0 14px 12px', fontSize: 11, color: 'var(--muted)' }}>
              청산(보유관리) 매도 {data.exitSignals}건 — 깔때기 별도 트랙
            </div>
          )}

          {/* 최다 차단 top3 */}
          {data.bottlenecks.length > 0 && (
            <div style={{ padding: '0 14px 12px' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>최다 차단</div>
              {data.bottlenecks.map((b, i) => (
                <div key={b.gate} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
                  <span>{i + 1}위 {b.label}</span>
                  <span className="num" style={{ color: 'var(--muted)' }}>{b.count}건</span>
                </div>
              ))}
            </div>
          )}

          {data.neutralPct != null && data.neutralPct > 0 && (
            <div style={{ padding: '0 14px 12px', fontSize: 11, color: 'var(--muted)' }}>
              시장상태 neutral 비율 {data.neutralPct}% (neutral이면 30m 룰 전체 비활성)
            </div>
          )}
        </>
      )}
    </section>
  );
}

function FunnelStepBar({ step, maxCount }: { step: FunnelStepCount; maxCount: number }) {
  // count가 0이면 막대를 아예 그리지 않는다. Math.max(2,…)를 무조건 적용하면
  // "프리필터 통과 0" 같은 0건 단계도 2% 막대가 남아 잔존 종목이 있는 것처럼 보인다.
  const widthPct = step.count > 0 && maxCount > 0
    ? Math.max(2, Math.round((step.count / maxCount) * 100))
    : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
      <div style={{ width: 68, flexShrink: 0, color: 'var(--muted)' }}>{step.label}</div>
      <div style={{ flex: 1, background: 'var(--bg3)', borderRadius: 4, overflow: 'hidden', height: 14 }}>
        <div style={{ width: `${widthPct}%`, background: 'var(--accent)', height: '100%', opacity: 0.8 }} />
      </div>
      <div className="num" style={{ width: 70, flexShrink: 0, textAlign: 'right' as const, color: 'var(--text)' }}>
        {step.count}{step.pctOfPrev != null ? ` (${step.pctOfPrev}%)` : ''}
      </div>
    </div>
  );
}

const sx: Record<string, React.CSSProperties> = {
  card: { background: 'var(--bg2)', borderBottom: '1px solid var(--border)' },
  cardHeader: {
    padding: '10px 14px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
};
