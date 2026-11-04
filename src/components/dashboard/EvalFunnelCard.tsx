'use client';

import { useEffect, useRef, useState } from 'react';
import type { FunnelDTO, Market } from '@/lib/ops/metrics/types';
import { StatusChip } from '@/components/ops/ui';
import { CHIP } from '@/components/ops/format';

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

/** T-108 — 세션 모드에서 부모(거래 › 운영 기록)에 넘기는 머리 정보(기본 시장·시장별 세션일·이상 수). */
export type FunnelMeta = Pick<FunnelDTO, 'defaultMarket' | 'sessions' | 'market' | 'generatedAt'>;

/**
 * 세션 모드 응답 1회 해석(순수). 기준 세션 조회가 실패하면(`basis.state='error'`) 응답의 시장·세션일은 **추정값**이라
 * 부모에 머리 정보로 넘기지 않고 실패로 알린다 — 추정 세션일로 「오늘 주문」을 거르거나 날짜·「이상 n」을 정상값처럼 그리지 않게.
 */
export function readFunnelResponse(status: number, j: unknown): {
  meta: FunnelMeta | null; metaError: string | null; data: EvalFunnelSummary | null; error: string | null;
} {
  if (status === 401) return { meta: null, metaError: 'unauthorized', data: null, error: 'unauthorized' };
  const b = j as { ok?: unknown; data?: unknown } | null;
  if (!b || b.ok !== true || !b.data) { const code = b ? 'api_error' : 'bad_json'; return { meta: null, metaError: code, data: null, error: code }; }
  const dto = b.data as FunnelDTO;
  const summary = dto.summary?.state === 'ok'
    ? { data: dto.summary.data as unknown as EvalFunnelSummary, error: null }
    : { data: null, error: dto.summary?.state === 'error' ? dto.summary.error : 'api_error' };
  if (dto.basis && dto.basis.state === 'error') return { meta: null, metaError: dto.basis.error, ...summary };
  return { meta: { defaultMarket: dto.defaultMarket, sessions: dto.sessions, market: dto.market, generatedAt: dto.generatedAt }, metaError: null, ...summary };
}

/** 세션 모드 조회 주소 — market 이 없으면 서버가 defaultMarket(마지막 세션이 더 최근인 시장)으로 채운다. */
export function sessionFunnelUrl(market?: Market): string {
  return market ? `/api/ops/funnel?market=${market}` : '/api/ops/funnel';
}

/**
 * 오늘의 평가 깔때기 카드 (T-002 §4) — 국내장 기준.
 * "시그널이 왜 안 나오는가"를 3초 안에 읽게: 헤더 → 이상 배너 → 병목 1줄 → 6단계 바 → 최다 차단 top3.
 *
 * T-108 §2.4.5 — `source: 'session'` 이면 새 읽기 라우트 `/api/ops/funnel`(시장별 **세션일** 범위 — 해외는 ET 날짜)을 읽는다.
 * 기존 사용처(legacy, 기본값)는 그대로 `/api/dashboard/eval-funnel?market=domestic`(KST 자정 기준)이고 동작이 같다.
 * 세션 모드는 거래 › 운영 기록의 본문이라 조회 실패를 숨기지 않고 「! 조회 실패 · {code}」로 보인다.
 */
export function EvalFunnelCard({ reloadKey, market, source = 'legacy', onMeta, onMetaError }: {
  reloadKey: number;
  /** session 모드에서만 — 없으면 서버 기본 시장 */
  market?: Market;
  source?: 'legacy' | 'session';
  onMeta?: (meta: FunnelMeta) => void;
  /** session 모드 — 응답 자체를 못 받았을 때(세션일을 모름) 실패 코드. 부모가 세션일에 기대는 목록을 「실패」로 바꾼다 */
  onMetaError?: (code: string) => void;
}) {
  const [data, setData] = useState<EvalFunnelSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const session = source === 'session';
  const onMetaRef = useRef(onMeta);
  onMetaRef.current = onMeta;
  const onMetaErrorRef = useRef(onMetaError);
  onMetaErrorRef.current = onMetaError;
  const lastMarket = useRef<string | undefined>(market);

  useEffect(() => {
    let alive = true;
    if (!session) {
      fetch('/api/dashboard/eval-funnel?market=domestic')
        .then(r => r.json())
        .then(j => {
          if (!alive) return;
          if (j.ok) { setData(j.data); setError(null); }
          else setError(j.error ?? 'unknown');
        })
        .catch(e => { if (alive) setError(String(e)); });
      return () => { alive = false; };
    }
    // 시장을 바꾸면 이전 시장 숫자를 남기지 않는다(같은 시장 재조회는 값을 유지해 깜빡이지 않게)
    if (lastMarket.current !== market) { setData(null); setError(null); lastMarket.current = market; }
    fetch(sessionFunnelUrl(market), { cache: 'no-store' })
      .then(async r => ({ status: r.status, j: await r.json().catch(() => null) }))
      .then(({ status, j }) => {
        if (!alive) return;
        const out = readFunnelResponse(status, j);
        if (out.meta) onMetaRef.current?.(out.meta);
        else if (out.metaError) onMetaErrorRef.current?.(out.metaError);
        setData(out.data);
        setError(out.error);
      })
      .catch(() => { if (alive) { setError('network'); onMetaErrorRef.current?.('network'); } });
    return () => { alive = false; };
  }, [reloadKey, session, market]);

  if (error) {
    if (!session) return null; // 관측 실패는 조용히 숨김 — 매매 화면을 가릴 이유 없음
    return (
      <div style={{ padding: '8px 16px 12px' }}>
        <StatusChip kind="error">{CHIP.error(error)}</StatusChip>
      </div>
    );
  }
  if (!data) {
    if (!session) return null;
    return <div style={{ padding: '8px 16px 12px', fontSize: 12, color: 'var(--muted)' }} aria-busy="true">불러오는 중…</div>;
  }

  const strategySignals = data.buySignals + data.sellSignals;
  const signalsCreated = strategySignals + data.exitSignals;
  const top = data.bottlenecks[0];
  const evaluated = data.steps.find(s => s.key === 'evaluated')?.count ?? 0;

  return (
    <section style={sx.card}>
      <div
        onClick={session ? undefined : () => setExpanded(v => !v)}
        style={session ? sx.cardHeader : { ...sx.cardHeader, cursor: 'pointer', userSelect: 'none' as const }}
      >
        <span style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '.6px', textTransform: 'uppercase' }}>
          {session ? '평가 필터' : '오늘의 평가 필터'}
        </span>
        {!session && <span style={{
          fontSize: 14, color: 'var(--muted)', transition: 'transform .15s',
          display: 'inline-block', transform: expanded ? 'rotate(180deg)' : 'rotate(0)',
        }}>▾</span>}
      </div>

      {/* 헤더(결론) */}
      <div style={{ padding: '2px 14px 10px' }}>
        <div style={{ fontSize: 13 }}>
          {session ? '시그널' : '오늘 시그널'}{' '}
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

      {(session || expanded) && (
        <>
          {/* 6단계 미니 깔때기 바 */}
          <div style={{ padding: '4px 14px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.steps.map(s => (
              <FunnelStepBar key={s.key} step={s} maxCount={evaluated} session={session} />
            ))}
          </div>

          {/* exit 트랙 — 위 6단계와 모수가 달라 사슬에 합산하지 않는다 (T-004) */}
          {data.exitSignals > 0 && (
            <div style={{ padding: '0 14px 12px', fontSize: 11, color: 'var(--muted)' }}>
              청산(보유관리) 매도 {data.exitSignals}건 — 평가 필터와 별도 트랙
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

function FunnelStepBar({ step, maxCount, session }: { step: FunnelStepCount; maxCount: number; session: boolean }) {
  // count가 0이면 막대를 아예 그리지 않는다. Math.max(2,…)를 무조건 적용하면
  // "프리필터 통과 0" 같은 0건 단계도 2% 막대가 남아 잔존 종목이 있는 것처럼 보인다.
  const widthPct = step.count > 0 && maxCount > 0
    ? Math.max(2, Math.round((step.count / maxCount) * 100))
    : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
      <div style={{ width: session ? 86 : 68, flexShrink: 0, whiteSpace: session ? 'nowrap' : undefined, color: 'var(--muted)' }}>{step.label}</div>
      <div style={{ flex: 1, minWidth: session ? 0 : undefined, background: 'var(--bg3)', borderRadius: 4, overflow: 'hidden', height: 14 }}>
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
