'use client';

import { useEffect, useState } from 'react';
import type { MissedSignal } from '@/app/api/signals/missed/route';
import { useSymbolMeta } from '@/lib/hooks/useSymbolMeta';
import { Paginator } from './Paginator';

const PAGE_SIZE = 7;

function changeBadge(pct: number | null) {
  if (pct == null) return <span style={{ color: 'var(--muted)', fontSize: 12 }}>추적 중…</span>;
  const abs = Math.abs(pct);
  // 매수 스킵 후 상승 = 놓친 기회 → 빨강, 하락 = 올바른 스킵 → 파랑
  const isBad = pct >= 3;
  const isGood = pct <= -3;
  const color = isBad ? 'var(--up)' : isGood ? 'var(--down)' : 'var(--muted)';
  const label = pct >= 0 ? `+${abs.toFixed(2)}%` : `-${abs.toFixed(2)}%`;
  return (
    <span style={{
      fontSize: 12, fontWeight: 700, color,
      background: isBad ? 'rgba(246,70,93,0.12)' : isGood ? 'rgba(38,166,154,0.12)' : 'var(--bg3)',
      padding: '2px 7px', borderRadius: 10,
    }}>
      {label}
    </span>
  );
}

function cleanReasoning(raw: string): string {
  // "[AI skip 42%] " 접두사 제거
  return raw.replace(/^\[AI skip \d+%\]\s*/i, '');
}

export function MissedOpportunityTab() {
  const [data, setData] = useState<MissedSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'ai_skipped' | 'user_rejected'>('all');
  const [page, setPage] = useState(0);
  const { displaySymbol, marketFlag } = useSymbolMeta();

  useEffect(() => {
    setLoading(true);
    fetch(`/api/signals/missed?days=${days}`)
      .then(r => r.json())
      .then((res: { ok: boolean; data: MissedSignal[] }) => {
        if (res.ok) setData(res.data);
      })
      .finally(() => setLoading(false));
  }, [days]);

  const summary = {
    total: data.length,
    missedBuy: data.filter(d => d.side === 'buy' && (d.priceChangePct ?? 0) >= 3).length,
    correctSkip: data.filter(d => d.side === 'buy' && (d.priceChangePct ?? 0) <= -3).length,
    userRejectedMissed: data.filter(d => d.source === 'user_rejected' && (d.priceChangePct ?? 0) >= 3).length,
  };

  const filteredData = sourceFilter !== 'all' ? data.filter(d => d.source === sourceFilter) : data;

  useEffect(() => { setPage(0); }, [days, sourceFilter]);

  const totalPages = Math.ceil(filteredData.length / PAGE_SIZE);
  const paged = filteredData.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div>
      {/* 요약 바 */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <Chip label="전체" value={summary.total} />
        <Chip label="놓친 기회 (+3%↑)" value={summary.missedBuy} color="var(--up)" />
        <Chip label="매수 안 함이 맞음 (-3%↓)" value={summary.correctSkip} color="var(--down)" />
        <Chip label="내 거절 기회" value={summary.userRejectedMissed} color="var(--up)" />
        {/* 기간 필터 */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {[1, 3, 7, 14].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              style={{
                padding: '4px 10px', borderRadius: 16, fontSize: 12, fontWeight: 600,
                background: days === d ? 'var(--accent)' : 'var(--bg3)',
                color: days === d ? '#000' : 'var(--muted)',
                border: 'none', cursor: 'pointer',
              }}
            >
              {d}일
            </button>
          ))}
        </div>
      </div>

      {/* 출처 필터 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {(['all', 'ai_skipped', 'user_rejected'] as const).map(f => (
          <button key={f} onClick={() => setSourceFilter(f)} style={{
            padding: '4px 12px', borderRadius: 16, fontSize: 12, fontWeight: 600,
            background: sourceFilter === f ? 'var(--accent)' : 'var(--bg3)',
            color: sourceFilter === f ? '#000' : 'var(--muted)',
            border: 'none', cursor: 'pointer',
          }}>
            {f === 'all' ? '전체' : f === 'ai_skipped' ? 'AI 매매 안 함' : '내 거절'}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: 'var(--muted)', fontSize: 13 }}>불러오는 중…</p>}

      {!loading && filteredData.length === 0 && (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>최근 {days}일간 해당하는 시그널이 없습니다.</p>
      )}

      {!loading && paged.map(sig => (
        <div key={sig.id} style={{
          background: 'var(--bg2)', borderRadius: 10, padding: '12px 14px',
          marginBottom: 10, borderLeft: `3px solid ${
            (sig.priceChangePct ?? 0) >= 3 ? 'var(--up)' :
            (sig.priceChangePct ?? 0) <= -3 ? 'var(--down)' : 'var(--border)'
          }`,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>
                {marketFlag(sig.symbol) && <span style={{ marginRight: 4 }} aria-hidden>{marketFlag(sig.symbol)}</span>}
                {displaySymbol(sig.symbol)}
              </span>
              <span style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
                background: sig.side === 'buy' ? 'rgba(246,70,93,0.15)' : 'rgba(38,166,154,0.15)',
                color: sig.side === 'buy' ? 'var(--up)' : 'var(--down)',
              }}>
                {sig.side === 'buy' ? '매수' : '매도'}
              </span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{sig.strategyId}</span>
              {sig.source === 'user_rejected' && (
                <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 8, background: 'var(--bg3)', color: 'var(--muted)' }}>
                  내 거절
                </span>
              )}
            </div>
            {changeBadge(sig.priceChangePct)}
          </div>

          {/* 가격 정보 */}
          {sig.priceAtSkip != null && (
            <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
              <span>판단 시 ₩{sig.priceAtSkip.toLocaleString('ko-KR')}</span>
              {sig.price1hAfter != null && (
                <span>1h 후 ₩{sig.price1hAfter.toLocaleString('ko-KR')}</span>
              )}
              {sig.confidence != null && (
                <span>AI 신뢰도 {sig.confidence}%</span>
              )}
            </div>
          )}

          {/* AI 판단 이유 */}
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
            {cleanReasoning(sig.reasoning).slice(0, 200)}
            {sig.reasoning.length > 200 ? '…' : ''}
          </p>

          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
            {new Date(sig.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })}
          </div>
        </div>
      ))}
      {!loading && <Paginator page={page} totalPages={totalPages} onPage={setPage} />}
    </div>
  );
}

function Chip({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{
      background: 'var(--bg3)', borderRadius: 10, padding: '6px 12px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 70,
    }}>
      <span style={{ fontSize: 18, fontWeight: 700, color: color ?? 'var(--text)' }}>{value}</span>
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</span>
    </div>
  );
}
