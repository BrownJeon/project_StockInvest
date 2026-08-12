'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ScenarioCard, type SignalWithScenario } from '@/components/ScenarioCard';
import { useSymbolMeta } from '@/lib/hooks/useSymbolMeta';
import { useFxRate } from '@/lib/hooks/useFxRate';
import { fmtMarketPrice } from '@/lib/format';

interface PendingEntrySignal {
  id: number;
  symbol: string;
  side: string;
  market: string;
  indicators: unknown;
  expires_at: string;
  created_at: string;
  quantity?: number | null;
  amount_krw?: number | null;
}

interface BlockBanner {
  reason: string;
  pct: number;
}

export default function RecommendPage() {
  const router = useRouter();
  const [signals, setSignals] = useState<SignalWithScenario[]>([]);
  const [pendingEntry, setPendingEntry] = useState<PendingEntrySignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [blockBanner, setBlockBanner] = useState<BlockBanner | null>(null);
  const { displaySymbol, marketFlag } = useSymbolMeta();
  const fxRate = useFxRate();

  const fetchSignals = useCallback(async () => {
    setLoading(true);
    try {
      const [aiRes, pendingRes, qualityRes] = await Promise.all([
        // 구 pending/pending_approval + 신규 awaiting_approval/detected 를 모두 조회 (T-003 §4-2 호환)
        fetch('/api/signals?status=awaiting_approval,pending,pending_approval,detected&limit=100'),
        fetch('/api/signals?status=approved_pending_entry&limit=50'),
        fetch('/api/analytics/signal-quality?hours=2'),
      ]);
      const [aiData, pendingData, qualityData] = await Promise.all([
        aiRes.json(), pendingRes.json(), qualityRes.json(),
      ]);
      if (aiData.ok) setSignals((aiData.data ?? []) as SignalWithScenario[]);
      if (pendingData.ok) setPendingEntry((pendingData.data ?? []) as PendingEntrySignal[]);

      // 최근 2시간 rule_prefilter 비율 ≥ 80%이면 배너 표시
      if (qualityData.ok && qualityData.summary?.total > 0) {
        const pfReasons = (qualityData.byPrefilterReason ?? []) as { reason: string; total: number }[];
        const totalSkipped = qualityData.summary.skipped as number;
        const ctCount = pfReasons.find(r => r.reason === 'strong_counter_trend')?.total ?? 0;
        const ctPct = totalSkipped > 0 ? Math.round((ctCount / totalSkipped) * 100) : 0;
        if (ctPct >= 80) {
          setBlockBanner({ reason: 'strong_counter_trend', pct: ctPct });
        } else {
          setBlockBanner(null);
        }
      } else {
        setBlockBanner(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSignals(); }, [fetchSignals]);

  async function handleCancelPending(id: number) {
    if (!window.confirm('진입 감시를 취소하고 시나리오를 삭제하시겠습니까?')) return;
    const res = await fetch(`/api/signals/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) {
      setPendingEntry(prev => prev.filter(s => s.id !== id));
    } else {
      alert(`삭제 실패: ${data.error ?? '알 수 없는 오류'}`);
    }
  }

  function getPriceZone(sig: PendingEntrySignal): { text: string; pct?: string } {
    try {
      const ind = (typeof sig.indicators === 'string' ? JSON.parse(sig.indicators) : sig.indicators) as Record<string, unknown>;
      const zoneRaw = (ind?.['ai'] as Record<string, unknown>)?.['scenario' as never] as Record<string, unknown> | undefined;
      const zoneStr = (zoneRaw?.['entry'] as Record<string, unknown>)?.['price_zone'] as string | undefined;
      const zoneMeta = ind?.['zone'] as { loPct?: number; hiPct?: number } | undefined;

      let text = '—';
      if (typeof zoneStr === 'string' && zoneStr.includes('~')) {
        const [lo, hi] = zoneStr.split('~').map(Number);
        const mkt = sig.market ?? 'domestic';
        const loFmt = Number.isFinite(lo) ? fmtMarketPrice(lo, mkt, fxRate) : '?';
        const hiFmt = Number.isFinite(hi) ? fmtMarketPrice(hi, mkt, fxRate) : '?';
        text = `${loFmt} ~ ${hiFmt}`;
      }

      let pct: string | undefined;
      if (zoneMeta?.loPct !== undefined && zoneMeta?.hiPct !== undefined) {
        const lo = zoneMeta.loPct >= 0 ? `+${zoneMeta.loPct}` : String(zoneMeta.loPct);
        const hi = zoneMeta.hiPct >= 0 ? `+${zoneMeta.hiPct}` : String(zoneMeta.hiPct);
        pct = `${lo}% ~ ${hi}%`;
      }

      return { text, pct };
    } catch { return { text: '—' }; }
  }

  function getExitInfo(sig: PendingEntrySignal): { target?: string; stop?: string } {
    try {
      const ind = typeof sig.indicators === 'string' ? JSON.parse(sig.indicators) : sig.indicators;
      const exit = (ind as Record<string, unknown>)?.['ai']?.['scenario' as never]?.['exit' as never] as Record<string, number> | undefined;
      if (!exit) return {};
      return {
        target: exit.target_pct ? `+${exit.target_pct}~${exit.target_pct_hi ?? exit.target_pct}%` : undefined,
        stop: exit.stop_pct ? `-${Math.abs(exit.stop_pct)}%` : undefined,
      };
    } catch { return {}; }
  }

  const enriched = signals.map(s => ({
    ...s,
    displayName: displaySymbol(s.symbol),
    marketFlag: marketFlag(s.symbol),
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 16 }}>
      {/* 상단 헤더 */}
      <div style={{
        padding: '12px 16px 10px', position: 'sticky', top: 0,
        background: 'var(--bg)', zIndex: 10, borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 17, fontWeight: 700 }}>💡 AI 추천</span>
        <button
          onClick={fetchSignals}
          style={{
            width: 34, height: 34, borderRadius: 8,
            background: 'var(--bg3)', border: '1px solid var(--border2)',
            fontSize: 16, color: 'var(--muted)',
          }}
          aria-label="새로고침"
        >↻</button>
      </div>

      {/* 하락추세 차단 배너 */}
      {blockBanner && (
        <div style={{
          margin: '10px 16px 0',
          padding: '10px 14px',
          borderRadius: 12,
          background: 'rgba(245,158,11,.10)',
          border: '1px solid rgba(245,158,11,.35)',
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>⚠️</span>
          <div style={{ fontSize: 12, color: '#d97706', lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>강한 하락추세 감지 — 매수 시그널 차단 중</div>
            <div style={{ color: 'var(--muted)' }}>
              최근 2시간 신호 중 {blockBanner.pct}%가 하락추세로 차단됨
              (EMA20 &lt; EMA60). 시장 추세 전환 후 시그널이 재개됩니다.
            </div>
          </div>
        </div>
      )}

      {/* 목록 */}
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>
            불러오는 중...
          </div>
        )}

        {!loading && enriched.length === 0 && (
          <div style={{
            textAlign: 'center', padding: '40px 20px',
            background: 'var(--bg2)', borderRadius: 16,
            border: '1px solid var(--border)',
          }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>💡</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
              현재 추천 종목이 없습니다
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
              분석가가 새로운 시그널을 탐색 중입니다.
            </div>
          </div>
        )}

        {enriched.map(s => (
          <ScenarioCard key={s.id} signal={s} />
        ))}
      </div>

      {/* 진입 감시 중 시그널 */}
      {pendingEntry.length > 0 && (
        <div style={{ padding: '4px 16px 0' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>
            👁 진입 감시 중 ({pendingEntry.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pendingEntry.map(sig => {
              const { target, stop } = getExitInfo(sig);
              const { text: zoneText, pct: zonePct } = getPriceZone(sig);
              // DB DECIMAL(36,18) 컬럼은 mysql2 가 문자열로 반환한다 — Number 로 정직하게 변환 후 다룬다.
              const qty = sig.quantity != null ? Number(sig.quantity) : null;
              return (
                <div key={sig.id} style={{
                  background: 'var(--bg2)', borderRadius: 12,
                  border: '1px solid rgba(99,102,241,.3)',
                  padding: '12px 14px',
                  display: 'flex', flexDirection: 'column', gap: 8,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    {/* 국기 + 종목명 (길면 말줄임) */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{sig.market === 'overseas' ? '🌐' : '🇰🇷'}</span>
                      <span style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {displaySymbol(sig.symbol)}
                      </span>
                    </div>
                    {/* 매수/매도 + 감시 중 배지 — 항상 오른쪽 고정 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 6,
                        background: sig.side === 'buy' ? 'rgba(239,68,68,.15)' : 'rgba(59,130,246,.15)',
                        color: sig.side === 'buy' ? 'var(--up)' : 'var(--down)',
                      }}>
                        {sig.side === 'buy' ? '매수' : '매도'}
                        {qty != null && qty > 0 && (
                          <span style={{ marginLeft: 4, fontWeight: 600 }}>
                            · {Number.isInteger(qty) ? qty : (Math.floor(qty * 100) / 100).toFixed(2)}주
                          </span>
                        )}
                        {(qty == null || qty <= 0) && sig.amount_krw != null && sig.amount_krw > 0 && (
                          <span style={{ marginLeft: 4, fontWeight: 600 }}>
                            · 약 {sig.amount_krw.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}원
                          </span>
                        )}
                      </span>
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'rgba(99,102,241,.15)', color: '#818cf8', fontWeight: 600 }}>
                        감시 중
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, color: 'var(--muted)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span>진입구간 <span className="num" style={{ color: 'var(--text)' }}>{zoneText}</span></span>
                      {zonePct && (
                        <span style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 11 }}>{zonePct}</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 12 }}>
                      {sig.side === 'buy' && target && <span>목표 <span className="num" style={{ color: 'var(--up)' }}>{target}</span></span>}
                      {sig.side === 'sell' && stop && <span>손절 <span className="num" style={{ color: 'var(--down)' }}>{stop}</span></span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)' }}>
                    <span>만료 {new Date(sig.expires_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    <button
                      onClick={() => handleCancelPending(sig.id)}
                      style={{ fontSize: 11, color: 'var(--muted)', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 5, background: 'var(--bg3)' }}
                    >
                      취소
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 내 시나리오 만들기 버튼 */}
      <div style={{ padding: '4px 16px 12px' }}>
        <button
          onClick={() => router.push('/recommend/build')}
          style={{
            width: '100%', height: 50, borderRadius: 12,
            background: 'rgba(99,102,241,.15)',
            border: '1px dashed rgba(99,102,241,.4)',
            color: '#818cf8', fontSize: 15, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          내 시나리오 만들기 +
        </button>
      </div>
    </div>
  );
}
