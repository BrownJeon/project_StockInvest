'use client';

import { useEffect, useState } from 'react';
import { formatSymbolShort } from '@/lib/symbols';

interface PositionStatus {
  symbol: string;
  name: string | null;
  market: string;
  entryPrice: number;
  peakPrice: number;
  currentPrice: number | null;
  qty: number;
  pnlPct: number | null;
  peakGainPct: number;
  trailingActive: boolean;
  stopPrice: number | null;
  drawdownFromPeak: number | null;
  danger: boolean;
  usdRate: number | null;
}

const krw = (v: number) => v.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
const usd = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v: number, digits = 2) => (v > 0 ? '+' : '') + v.toFixed(digits) + '%';

function formatPrice(krwValue: number, usdRate: number | null): string {
  if (usdRate && usdRate > 0) return '$' + usd(krwValue / usdRate);
  return krw(krwValue) + '원';
}

export function TrailingStopTab() {
  const [positions, setPositions] = useState<PositionStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/positions/status')
      .then((r) => r.json())
      .then((json: { ok: boolean; data: PositionStatus[]; error?: string }) => {
        if (json.ok) setPositions(json.data);
        else setError(json.error ?? 'load failed');
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={S.center}>포지션 조회 중...</div>;
  if (error) return <div style={S.center}>{error}</div>;
  if (positions.length === 0) return <div style={S.center}>보유 포지션이 없습니다.</div>;

  const domestic = positions.filter((p) => p.market === 'domestic');
  const overseas = positions.filter((p) => p.market === 'overseas');

  return (
    <div style={S.wrap}>
      <div style={S.hint}>트레일링 스탑 활성화 기준: 진입 대비 +2.5% / 손절 조건: peak 대비 -1.5%</div>

      {domestic.length > 0 && (
        <section>
          <div style={S.sectionHeader}>🇰🇷 국내주식</div>
          <div style={S.list}>
            {domestic.map((p) => <PositionCard key={p.symbol} p={p} />)}
          </div>
        </section>
      )}

      {overseas.length > 0 && (
        <section>
          <div style={S.sectionHeader}>🇺🇸 해외주식</div>
          {overseas[0].usdRate == null && (
            <div style={S.fxWarn}>환율 정보 없음 — KRW로 표시</div>
          )}
          <div style={S.list}>
            {overseas.map((p) => <PositionCard key={p.symbol} p={p} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function PositionCard({ p }: { p: PositionStatus }) {
  const pnlColor = (p.pnlPct ?? 0) > 0 ? 'var(--red)' : (p.pnlPct ?? 0) < 0 ? 'var(--blue)' : 'var(--fg)';
  const statusLabel = p.danger ? '위험' : p.trailingActive ? '활성' : '대기';
  const statusColor = p.danger ? '#dc2626' : p.trailingActive ? '#16a34a' : '#6b7280';
  const fmt = (v: number) => formatPrice(v, p.usdRate);

  return (
    <div style={{ ...S.card, borderLeft: `3px solid ${statusColor}` }}>
      {/* 헤더 */}
      <div style={S.cardHeader}>
        <div>
          <span style={S.name}>{p.name ?? formatSymbolShort(p.symbol)}</span>
          <span style={S.code}>{formatSymbolShort(p.symbol)}</span>
        </div>
        <span style={{ ...S.badge, background: statusColor + '22', color: statusColor }}>
          {statusLabel}
        </span>
      </div>

      {/* 가격 행 */}
      <div style={S.priceRow}>
        {p.currentPrice != null && (
          <div style={S.mainPrice}>
            <span style={{ color: pnlColor, fontWeight: 700, fontSize: 18 }}>
              {fmt(p.currentPrice)}
            </span>
            {p.pnlPct != null && (
              <span style={{ color: pnlColor, fontSize: 13, marginLeft: 6 }}>
                {pct(p.pnlPct)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* 지표 그리드 */}
      <div style={S.grid}>
        <StatCell label="진입가" value={fmt(p.entryPrice)} />
        <StatCell label="최고가" value={fmt(p.peakPrice)} highlight={p.trailingActive} />
        {p.stopPrice != null && (
          <StatCell label="손절가" value={fmt(p.stopPrice)} danger />
        )}
        <StatCell label="Peak 수익" value={pct(p.peakGainPct)} />
        {p.drawdownFromPeak != null && (
          <StatCell
            label="Peak 대비 하락"
            value={p.drawdownFromPeak.toFixed(2) + '%'}
            danger={p.drawdownFromPeak >= 1.0}
          />
        )}
        <StatCell label="수량" value={p.qty.toFixed(p.qty % 1 === 0 ? 0 : 4) + '주'} />
      </div>

      {/* 트레일링 활성화 프로그레스 바 */}
      {!p.trailingActive && (
        <div style={S.progressWrap}>
          <div style={S.progressLabel}>
            활성화까지 {Math.max(0, 2.5 - p.peakGainPct).toFixed(2)}% 남음
          </div>
          <div style={S.progressBg}>
            <div
              style={{
                ...S.progressBar,
                width: `${Math.min(100, (p.peakGainPct / 2.5) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function StatCell({ label, value, highlight, danger }: {
  label: string; value: string; highlight?: boolean; danger?: boolean;
}) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 2 }}>{label}</div>
      <div style={{
        fontSize: 13, fontWeight: 700,
        color: danger ? '#dc2626' : highlight ? '#16a34a' : 'var(--fg)',
      }}>
        {value}
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 16 },
  center: { textAlign: 'center', padding: 40, color: 'var(--muted)' },
  hint: { fontSize: 11, color: 'var(--muted)', padding: '4px 0' },
  sectionHeader: {
    fontSize: 13, fontWeight: 700, color: 'var(--muted)',
    marginBottom: 8, paddingBottom: 6,
    borderBottom: '1px solid var(--border)',
  },
  fxWarn: { fontSize: 11, color: '#d97706', marginBottom: 6 },
  list: { display: 'flex', flexDirection: 'column', gap: 10 },
  card: {
    background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14,
    padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10,
  },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 14, fontWeight: 700, color: 'var(--fg)', marginRight: 6 },
  code: { fontSize: 11, color: 'var(--muted)' },
  badge: { fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20 },
  priceRow: { display: 'flex', alignItems: 'baseline', gap: 8 },
  mainPrice: { display: 'flex', alignItems: 'baseline' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px 4px' },
  progressWrap: { display: 'flex', flexDirection: 'column', gap: 4 },
  progressLabel: { fontSize: 11, color: 'var(--muted)' },
  progressBg: { height: 6, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' },
  progressBar: { height: '100%', background: 'var(--accent)', borderRadius: 3, transition: 'width 0.3s' },
};
