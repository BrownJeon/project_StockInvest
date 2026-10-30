'use client';

import { useEffect, useState } from 'react';
import { useSymbolMeta } from '@/lib/hooks/useSymbolMeta';

interface SymbolResult {
  symbol:        string;
  signalCount:   number;
  avgConfidence: number | null;
  execCount:     number;
  skipCount:     number;
  lastAt:        string;
}

interface TopData {
  symbols: SymbolResult[];
  since:   string;
  until:   string;
}

const MEDALS = ['🥇', '🥈', '🥉'];

// 과거 N시간 슬롯 생성 (현재 시각 기준 내림차순)
function buildHourSlots(count = 12): { since: number; until: number; label: string }[] {
  const slots = [];
  const now   = new Date();
  const base  = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
  for (let i = 0; i < count; i++) {
    const until = new Date(base.getTime() - i * 3_600_000);
    const since = new Date(until.getTime() - 3_600_000);
    const h     = until.getHours();
    const isNow = i === 0;
    slots.push({
      since: since.getTime(),
      until: until.getTime(),
      label: isNow ? `${h}시 (현재)` : `${h}시`,
    });
  }
  return slots;
}

function fmtTs(iso: string): string {
  const d   = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TopSymbolsSection() {
  const slots = buildHourSlots(12);
  const [slotIdx, setSlotIdx] = useState(0);
  const [data, setData]       = useState<TopData | null>(null);
  const [loading, setLoading] = useState(true);
  const { displaySymbol, marketFlag } = useSymbolMeta();

  useEffect(() => {
    const s = slots[slotIdx];
    setLoading(true);
    fetch(`/api/analytics/top-symbols?since=${s.since}&until=${s.until}`)
      .then(r => r.json())
      .then(j => { if (j.ok) setData(j as TopData); })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotIdx]);

  return (
    <section style={{ borderBottom: '1px solid var(--border)' }}>
      {/* 헤더 */}
      <div style={{ padding: '10px 16px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
          시간별 주목 종목 TOP 3
        </span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          {slots[slotIdx].label}
        </span>
      </div>

      {/* 시간 슬롯 선택 */}
      <div style={{
        display: 'flex', gap: 6, padding: '0 16px 10px',
        overflowX: 'auto', scrollbarWidth: 'none', minWidth: 0,
      }}>
        {slots.map((s, i) => (
          <button
            key={i}
            onClick={() => setSlotIdx(i)}
            style={{
              flexShrink: 0, padding: '5px 12px', borderRadius: 14, fontSize: 12, fontWeight: 600,
              background: slotIdx === i ? 'var(--accent)' : 'var(--bg3)',
              color:      slotIdx === i ? '#000' : 'var(--muted)',
              border: 'none', cursor: 'pointer',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* 결과 */}
      <div style={{ padding: '0 16px 14px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--muted)', fontSize: 13 }}>
            분석 중…
          </div>
        ) : !data || data.symbols.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--muted)', fontSize: 13 }}>
            해당 시간대 시그널 없음
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.symbols.map((sym, i) => (
              <div key={sym.symbol} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                background: 'var(--bg2)', borderRadius: 12, padding: '11px 14px',
                border: '1px solid var(--border)',
              }}>
                {/* 메달 + 심볼 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 20, flexShrink: 0 }}>{MEDALS[i]}</span>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {marketFlag(sym.symbol) && <span aria-hidden>{marketFlag(sym.symbol)}</span>}
                      {displaySymbol(sym.symbol)}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                      마지막 {fmtTs(sym.lastAt)}
                    </div>
                  </div>
                </div>

                {/* 지표 */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{
                      fontSize: 11, padding: '2px 7px', borderRadius: 8, fontWeight: 700,
                      background: 'rgba(99,102,241,.15)', color: '#818cf8',
                    }}>
                      신호 {sym.signalCount}건
                    </span>
                    {sym.avgConfidence != null && (
                      <span style={{
                        fontSize: 11, padding: '2px 7px', borderRadius: 8, fontWeight: 600,
                        background: 'var(--bg3)', color: 'var(--text)',
                      }}>
                        {sym.avgConfidence}%
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                    실행 {sym.execCount}  ·  안 함 {sym.skipCount}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
