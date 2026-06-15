'use client';

import { useEffect, useState } from 'react';
import { formatSymbolShort } from '@/lib/symbols';

interface Leader {
  symbol: string;
  name: string | null;
  market: string;
  rsRating: number;
  near52wHigh: boolean;
  volRatio20d: number;
  rsUpdatedAt?: string;
}

export function LeaderboardTab() {
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [minRs, setMinRs] = useState(0);
  const [near52w, setNear52w] = useState(false);
  const [volSpike, setVolSpike] = useState(false);
  const [market, setMarket] = useState<'domestic' | 'overseas' | 'all'>('domestic');
  const [addingFav, setAddingFav] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ market });
    if (minRs > 0) params.set('min_rs', String(minRs));
    if (near52w) params.set('near52w', '1');
    if (volSpike) params.set('vol_spike', '1');

    fetch(`/api/leaderboard?${params.toString()}`)
      .then((r) => r.json())
      .then((json: { ok: boolean; data: Leader[]; error?: string }) => {
        if (json.ok) setLeaders(json.data);
        else setError(json.error ?? 'load failed');
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [market, minRs, near52w, volSpike]);

  async function addToFavorites(symbol: string) {
    setAddingFav(symbol);
    try {
      await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });
    } finally {
      setAddingFav(null);
    }
  }

  const VOL_THRESHOLD = 1.5;

  return (
    <div style={S.wrap}>
      {/* 필터 */}
      <div style={S.filterRow}>
        <select value={market} onChange={(e) => setMarket(e.target.value as typeof market)} style={S.select}>
          <option value="domestic">국내</option>
          <option value="overseas">해외</option>
          <option value="all">전체</option>
        </select>
        <ToggleChip active={minRs >= 80} onClick={() => setMinRs(minRs >= 80 ? 0 : 80)} label="RS ≥ 80" />
        <ToggleChip active={near52w} onClick={() => setNear52w(!near52w)} label="신고가 근접" />
        <ToggleChip active={volSpike} onClick={() => setVolSpike(!volSpike)} label="거래량 급증" />
      </div>

      {/* RS Rating 설명 */}
      <div style={S.hint}>
        RS Rating: 전체 종목 대비 상대 수익률 백분위 (0~99). RS 80 이상 = 상위 20% 강세 종목.
      </div>

      {loading && <div style={S.center}>주도주 탐색 중...</div>}
      {error && !loading && (
        <div style={S.center}>
          {error}
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
            RS Rating은 장 마감 후 17:30에 자동 업데이트됩니다.
            <br />수동 업데이트: <code>/api/cron/rs-update?market=domestic</code>
          </div>
        </div>
      )}

      {!loading && !error && leaders.length === 0 && (
        <div style={S.center}>
          조건에 맞는 종목이 없습니다.
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
            RS Rating이 아직 계산되지 않았을 수 있습니다. 장 마감 후 17:30에 업데이트됩니다.
          </div>
        </div>
      )}

      {!loading && leaders.length > 0 && (
        <div style={S.list}>
          {leaders.map((item, idx) => {
            const rsColor = item.rsRating >= 90 ? '#16a34a' : item.rsRating >= 80 ? '#d97706' : 'var(--muted)';
            const isVolSpike = item.volRatio20d >= VOL_THRESHOLD;

            return (
              <div key={item.symbol} style={S.row}>
                {/* 순위 */}
                <div style={{ ...S.rank, color: idx < 3 ? 'var(--accent)' : 'var(--muted)' }}>
                  #{idx + 1}
                </div>

                {/* 종목 정보 */}
                <div style={S.info}>
                  <div style={S.nameRow}>
                    <span style={S.name}>{item.name ?? formatSymbolShort(item.symbol)}</span>
                    <span style={S.code}>{formatSymbolShort(item.symbol)}</span>
                    {item.market === 'overseas' && (
                      <span style={S.marketBadge}>해외</span>
                    )}
                  </div>
                  <div style={S.chips}>
                    {item.near52wHigh && <span style={S.chip52w}>52w 신고가</span>}
                    {isVolSpike && (
                      <span style={S.chipVol}>거래량 {item.volRatio20d.toFixed(1)}x</span>
                    )}
                  </div>
                </div>

                {/* RS Rating 바 */}
                <div style={S.rsWrap}>
                  <div style={{ ...S.rsValue, color: rsColor }}>{item.rsRating}</div>
                  <div style={S.rsBarBg}>
                    <div style={{ ...S.rsBar, width: `${item.rsRating}%`, background: rsColor }} />
                  </div>
                </div>

                {/* 즐겨찾기 추가 */}
                <button
                  style={S.favBtn}
                  onClick={() => void addToFavorites(item.symbol)}
                  disabled={addingFav === item.symbol}
                  title="즐겨찾기 추가"
                >
                  {addingFav === item.symbol ? '...' : '⭐'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ToggleChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
        border: 'none', cursor: 'pointer',
        background: active ? 'var(--accent)' : 'var(--bg3)',
        color: active ? '#000' : 'var(--muted)',
      }}
    >
      {label}
    </button>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 10 },
  filterRow: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
  select: {
    padding: '6px 10px', background: 'var(--bg2)', border: '1px solid var(--border)',
    borderRadius: 8, color: 'var(--fg)', fontSize: 13,
  },
  hint: { fontSize: 11, color: 'var(--muted)' },
  center: { textAlign: 'center', padding: 32, color: 'var(--muted)', fontSize: 13 },
  list: { display: 'flex', flexDirection: 'column', gap: 6 },
  row: {
    display: 'flex', alignItems: 'center', gap: 10,
    background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12,
    padding: '10px 12px',
  },
  rank: { fontSize: 12, fontWeight: 700, minWidth: 28, textAlign: 'center' },
  info: { flex: 1, minWidth: 0 },
  nameRow: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  name: { fontSize: 13, fontWeight: 700, color: 'var(--fg)' },
  code: { fontSize: 11, color: 'var(--muted)' },
  marketBadge: {
    fontSize: 10, color: 'var(--muted)', background: 'var(--bg3)',
    padding: '1px 6px', borderRadius: 8,
  },
  chips: { display: 'flex', gap: 4, marginTop: 3 },
  chip52w: {
    fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 10,
    background: '#16a34a22', color: '#16a34a',
  },
  chipVol: {
    fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 10,
    background: '#d9770622', color: '#d97706',
  },
  rsWrap: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, minWidth: 60 },
  rsValue: { fontSize: 16, fontWeight: 700 },
  rsBarBg: { width: 60, height: 5, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' },
  rsBar: { height: '100%', borderRadius: 3, transition: 'width 0.3s' },
  favBtn: {
    background: 'transparent', border: 'none', fontSize: 16, cursor: 'pointer',
    padding: '2px 4px', opacity: 0.7,
  },
};
