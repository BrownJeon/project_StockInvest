'use client';

import { useEffect, useState, useMemo } from 'react';

interface ReasonRow   { reason: string; total: number }
interface SideReasonRow { side: 'buy' | 'sell'; reason: string; total: number }
interface RepeatRow   { symbol: string; strategyId: string; side: 'buy' | 'sell'; fireCount: number; skippedCount: number; firstFire: string; lastFire: string }
interface CategoryRow { category: string; total: number }
interface Summary     { total: number; approved: number; skipped: number; approvalRate: number; health: 'good' | 'caution' | 'review' }

interface ApiResp {
  ok: boolean;
  period: string;
  summary: Summary;
  byReason: ReasonRow[];
  bySkipCategory: CategoryRow[];
  repeatFires: RepeatRow[];
  bySide: SideReasonRow[];
}

type SideFilter = 'all' | 'buy' | 'sell';

const REASON_META_APPROVED = { label: '✅ 승인', color: '#22c55e', hint: 'AI가 매매 가치 인정 — 시그널 발화' };
const REASON_META: Record<string, { label: string; color: string; hint: string }> = {
  approved:        REASON_META_APPROVED,
  late_entry:      { label: '🐢 타이밍 늦음',     color: '#ef4444', hint: '룰 발화 시점이 이미 급등·과열 후. 룰 후행성 또는 cron tick 지연 의심' },
  liquidity:       { label: '💧 유동성 부족',     color: '#3b82f6', hint: '거래량 희박. universe 종목 재검토 필요' },
  counter_trend:   { label: '↩️ 추세 역행',       color: '#f59e0b', hint: '전체 추세 반대 방향 진입. 룰 자체 적합성 의심' },
  already_held:    { label: '✅ 이미 보유',       color: '#a3a3a3', hint: '동일 종목 이미 보유 중. dedup으로 차단되어야 함' },
  session_close:   { label: '🌙 세션 종료 임박',  color: '#a78bfa', hint: '시장 마감 직전. 청산 시간 부족' },
  dedup_reuse:     { label: '♻️ Dedup 재사용',    color: '#10b981', hint: '동일 regime에서 이전 거절 재사용 — 정상 절감' },
  portfolio_guard: { label: '🛡️ 안정성 가드',    color: '#0ea5e9', hint: 'core 비율·종목한도 위반' },
  rule_prefilter:  { label: '🚫 사전 필터',       color: '#6b7280', hint: 'AI 호출 전 명백한 거절 패턴' },
  other:           { label: '❓ 기타',           color: '#6b7280', hint: 'AI가 EV<0 등 일반 사유로 거절' },
};

function StackedBar({ rows, total }: { rows: ReasonRow[]; total: number }) {
  if (total === 0) return <div style={{ fontSize: 12, color: 'var(--muted)', padding: 8 }}>데이터 없음</div>;
  return (
    <div style={{ display: 'flex', height: 28, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
      {rows.map(r => {
        const meta = REASON_META[r.reason] ?? REASON_META.other;
        const pct = (r.total / total) * 100;
        return (
          <div
            key={r.reason}
            title={`${meta.label}: ${r.total}건 (${pct.toFixed(0)}%)`}
            style={{ width: `${pct}%`, background: meta.color }}
          />
        );
      })}
    </div>
  );
}

export function SignalDiagnosticsTab() {
  const [hours, setHours] = useState(24);
  const [side, setSide] = useState<SideFilter>('all');
  const [data, setData]   = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/analytics/signal-quality?hours=${hours}`)
      .then(r => r.json())
      .then((d: ApiResp) => { if (d.ok) setData(d); })
      .finally(() => setLoading(false));
  }, [hours]);

  // side 필터 적용한 reason 집계 (승인 제외, 거절만 — 기존 byReason 호환)
  const filteredReasons = useMemo<ReasonRow[]>(() => {
    if (!data) return [];
    if (side === 'all') return data.byReason;
    const acc = new Map<string, number>();
    for (const row of data.bySide) {
      if (row.side !== side) continue;
      if (row.reason === 'approved') continue;  // 거절만 집계
      acc.set(row.reason, (acc.get(row.reason) ?? 0) + row.total);
    }
    return Array.from(acc, ([reason, total]) => ({ reason, total })).sort((a, b) => b.total - a.total);
  }, [data, side]);

  // side 필터 적용한 summary
  const filteredSummary = useMemo(() => {
    if (!data) return null;
    if (side === 'all') return data.summary;
    let total = 0, approved = 0, skipped = 0;
    for (const row of data.bySide) {
      if (row.side !== side) continue;
      total += row.total;
      if (row.reason === 'approved') approved += row.total;
      else                            skipped  += row.total;
    }
    const approvalRate = total > 0 ? Math.round((approved / total) * 1000) / 10 : 0;
    return { total, approved, skipped, approvalRate, health: 'good' as const };
  }, [data, side]);

  const totalSkipped = useMemo(
    () => filteredReasons.reduce((s, r) => s + r.total, 0),
    [filteredReasons],
  );

  if (loading) return <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>불러오는 중…</div>;
  if (!data || !filteredSummary) return <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>데이터 없음</div>;

  const lateEntryPct = totalSkipped > 0
    ? Math.round(((filteredReasons.find(r => r.reason === 'late_entry')?.total ?? 0) / totalSkipped) * 100)
    : 0;

  const filteredRepeatFires = side === 'all'
    ? data.repeatFires
    : data.repeatFires.filter(r => r.side === side);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 기간 선택 */}
      <div style={{ display: 'flex', gap: 6 }}>
        {[6, 24, 72, 168].map(h => (
          <button
            key={h}
            onClick={() => setHours(h)}
            style={{
              flex: 1, padding: '6px 0', fontSize: 12, borderRadius: 8, cursor: 'pointer',
              background: hours === h ? 'var(--accent)' : 'var(--bg3)',
              color: hours === h ? '#000' : 'var(--muted)',
              border: 'none', fontWeight: 600,
            }}
          >
            {h <= 72 ? `${h}h` : `${Math.round(h / 24)}d`}
          </button>
        ))}
      </div>

      {/* 매수/매도 필터 */}
      <div style={{ display: 'flex', gap: 6 }}>
        {(['all', 'buy', 'sell'] as SideFilter[]).map(s => {
          const label = s === 'all' ? '전체' : s === 'buy' ? '🟥 매수' : '🟦 매도';
          const buyCount  = data.bySide.filter(r => r.side === 'buy').reduce((sum, r) => sum + r.total, 0);
          const sellCount = data.bySide.filter(r => r.side === 'sell').reduce((sum, r) => sum + r.total, 0);
          const count = s === 'all' ? buyCount + sellCount : s === 'buy' ? buyCount : sellCount;
          const activeColor = s === 'buy' ? 'var(--up)' : s === 'sell' ? 'var(--down)' : 'var(--accent)';
          return (
            <button
              key={s}
              onClick={() => setSide(s)}
              style={{
                flex: 1, padding: '8px 0', fontSize: 12, borderRadius: 8, cursor: 'pointer',
                background: side === s ? activeColor : 'var(--bg3)',
                color: side === s ? '#fff' : 'var(--muted)',
                border: 'none', fontWeight: 600,
              }}
            >
              {label} <span style={{ fontWeight: 400, opacity: 0.85 }}>({count})</span>
            </button>
          );
        })}
      </div>

      {/* 요약 KPI */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        <KpiBox label="총 후보" value={String(filteredSummary.total)} />
        <KpiBox label="승인" value={String(filteredSummary.approved)} color="var(--ok)" />
        <KpiBox label="거절" value={String(filteredSummary.skipped)} color="var(--down)" />
      </div>

      {/* 거절 사유 분포 */}
      <section style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)', padding: 14 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 8 }}>
          거절 사유 분포 ({side === 'all' ? '전체' : side === 'buy' ? '매수' : '매도'} · {hours}h · {totalSkipped}건)
        </div>
        <StackedBar rows={filteredReasons} total={totalSkipped} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
          {filteredReasons.map(r => {
            const meta = REASON_META[r.reason] ?? REASON_META.other;
            const pct = totalSkipped > 0 ? (r.total / totalSkipped) * 100 : 0;
            return (
              <div key={r.reason} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: meta.color, flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{meta.label}</span>
                <span className="num" style={{ color: 'var(--muted)' }}>{r.total}건 · {pct.toFixed(0)}%</span>
              </div>
            );
          })}
        </div>
        {lateEntryPct >= 20 && (
          <div style={{ marginTop: 10, padding: 10, background: 'rgba(239,68,68,.10)', borderRadius: 8, fontSize: 11, color: 'var(--down)' }}>
            ⚠️ 타이밍 늦음 거절이 {lateEntryPct}% — 룰의 후행성 점검 또는 봉 단위 단축 검토
          </div>
        )}
      </section>

      {/* 반복 발화 패턴 */}
      <section style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)', padding: 14 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 8 }}>
          반복 발화 패턴 ({side === 'all' ? '전체' : side === 'buy' ? '매수' : '매도'} · 2회 이상)
        </div>
        {filteredRepeatFires.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', padding: 12 }}>반복 발화 없음 ✓</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filteredRepeatFires.slice(0, 12).map((r, i) => {
              const isAllSkipped = r.skippedCount >= r.fireCount;
              const sideLabel = r.side === 'buy' ? '매수' : '매도';
              const sideColor = r.side === 'buy' ? 'var(--up)' : 'var(--down)';
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10, fontSize: 12,
                  padding: '8px 10px', background: 'var(--bg3)', borderRadius: 8,
                  borderLeft: isAllSkipped ? '3px solid var(--down)' : '3px solid var(--accent)',
                }}>
                  <span style={{ fontWeight: 700, minWidth: 80 }}>{r.symbol}</span>
                  <span style={{ color: sideColor, fontWeight: 600, fontSize: 11 }}>{sideLabel}</span>
                  <span style={{ flex: 1, color: 'var(--muted)', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.strategyId}</span>
                  <span className="num" style={{ color: isAllSkipped ? 'var(--down)' : 'var(--accent)', fontWeight: 700 }}>
                    {r.fireCount}회
                  </span>
                  {isAllSkipped && (
                    <span style={{ fontSize: 10, color: 'var(--muted)' }}>전부 거절</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {filteredRepeatFires.filter(r => r.skippedCount >= r.fireCount && r.fireCount >= 3).length > 0 && (
          <div style={{ marginTop: 10, padding: 10, background: 'rgba(245,158,11,.10)', borderRadius: 8, fontSize: 11, color: 'var(--accent)' }}>
            ⚠️ 같은 신호가 반복 거절되는 종목 다수 — dedup 또는 24h 광역 가드 점검
          </div>
        )}
      </section>

      {/* skipCategory 원형 분포 (보조) */}
      <section style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)', padding: 14 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 8 }}>
          skipCategory 분포 (시스템 기준)
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {data.bySkipCategory.map(c => (
            <div key={c.category} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
              <span style={{ color: 'var(--muted)' }}>{c.category}</span>
              <span className="num">{c.total}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function KpiBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)', padding: '10px 12px' }}>
      <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }}>{label}</div>
      <div className="num" style={{ fontSize: 18, fontWeight: 700, color: color ?? 'var(--text)', marginTop: 2 }}>{value}</div>
    </div>
  );
}
