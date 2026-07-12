'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { formatSymbolShort } from '@/lib/symbols';

interface KeyFactor { label: string; value: string; description: string; }

interface LatestSignal { id: number; side: string; status: string; created_at: string; }

interface FavoriteItem {
  symbol: string; name: string | null; market: string;
  price: number | null; priceUsd: number | null; changeRate: number | null;
  latestSignal: LatestSignal | null;
  pbr: number | null; per: number | null; roe: number | null;
  eps: number | null; market_cap_bn: number | null; dividend_yield: number | null;
  key_factors: KeyFactor[] | null; ai_summary: string | null;
  fundamentals_updated_at: string | null;
}

interface TechnicalData {
  rsi14: number | null;
  macd: number | null; macdSignal: number | null; macdHistogram: number | null;
  ema20: number | null; ema60: number | null;
  bbUpper: number | null; bbMiddle: number | null; bbLower: number | null; bbPosition: number | null;
  marketState: string; volumeRatio: number;
  periodHighDays: number; periodHigh: number | null; periodLow: number | null; periodPosition: number | null;
  atr14: number | null;
  poc: number | null; vah: number | null; val: number | null;
  priceChange5: number; currentPrice: number;
  updatedAt: string;
}

interface FundamentalsData {
  symbol: string;
  pbr: number | null;
  per: number | null;
  roe: number | null;
  eps: number | null;
  market_cap_bn: number | null;
  dividend_yield: number | null;
  key_factors: KeyFactor[] | string | null;
  ai_summary: string | null;
  updated_at: string | null;
}

const krw = (v: number) => v.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
const usd = (v: number) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v: number) => (v > 0 ? '+' : '') + v.toFixed(2) + '%';
const fmt = (v: number | null, isOverseas: boolean) =>
  v == null ? '—' : isOverseas ? usd(v) : krw(v) + '원';

const MARKET_STATE_KO: Record<string, string> = {
  divergence_signal: '다이버전스',
  oversold_bounce: '과매도 반등',
  volume_momentum: '거래량 급등',
  breakout_watch: '돌파 대기',
  trend_following: '추세 추종',
  neutral: '중립',
};

const MARKET_STATE_DESC: Record<string, string> = {
  divergence_signal: 'RSI 기반 다이버전스 — 추세 전환 가능성',
  oversold_bounce: '과매도 구간 — 단기 반등 매수 기회 탐색 중',
  volume_momentum: '거래량 급등 — 강한 매수/매도 세력 유입',
  breakout_watch: '핵심 가격대 근접 — 돌파 방향 확인 필요',
  trend_following: '단기 이평선이 장기 위 — 상승 추세 진행 중',
  neutral: '뚜렷한 방향성 신호 없음',
};

const MARKET_STATE_COLOR: Record<string, string> = {
  divergence_signal: '#f59e0b',
  oversold_bounce: '#3b82f6',
  volume_momentum: '#8b5cf6',
  breakout_watch: '#f97316',
  trend_following: '#ef4444',
  neutral: '#6b7280',
};

function SignalBadge({ signal }: { signal: LatestSignal }) {
  const isPending = signal.status === 'pending' || signal.status === 'pending_approval';
  const isApproved = signal.status === 'approved' || signal.status === 'approved_pending_entry';
  const side = signal.side === 'buy' ? '매수' : '매도';
  const color = isPending ? '#f59e0b' : isApproved ? '#22c55e' : '#6b7280';
  const label = isPending ? `${side} 대기` : isApproved ? `${side} 승인` : side;
  const date = new Date(signal.created_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  return (
    <div style={{ ...S.section, borderColor: color + '44', background: color + '11' }}>
      <div style={S.sectionTitle}>활성 시그널</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color }}>{label}</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{date}</span>
      </div>
    </div>
  );
}

function GaugeBar({ value, min, max, lowThresh, highThresh, lowColor, highColor }:
  { value: number; min: number; max: number; lowThresh: number; highThresh: number; lowColor: string; highColor: string }) {
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  const color = value < lowThresh ? lowColor : value > highThresh ? highColor : '#6b7280';
  return (
    <div style={{ position: 'relative', height: 10, background: 'var(--bg3)', borderRadius: 5, margin: '6px 0' }}>
      <div style={{
        position: 'absolute', left: `${(lowThresh / max) * 100}%`, top: 0, bottom: 0,
        width: `${((highThresh - lowThresh) / max) * 100}%`,
        background: 'var(--bg2)', opacity: 0.5,
      }} />
      <div style={{
        position: 'absolute', left: `${(lowThresh / max) * 100}%`,
        top: -3, bottom: -3, width: 1, background: '#3b82f6', opacity: 0.5,
      }} />
      <div style={{
        position: 'absolute', left: `${(highThresh / max) * 100}%`,
        top: -3, bottom: -3, width: 1, background: '#ef4444', opacity: 0.5,
      }} />
      <div style={{
        position: 'absolute', left: `${pct}%`, top: '50%',
        transform: 'translate(-50%, -50%)',
        width: 14, height: 14, borderRadius: '50%',
        background: color, border: '2px solid var(--bg)',
        boxShadow: `0 0 6px ${color}88`,
      }} />
    </div>
  );
}

function RangeBar({ position, color = 'var(--accent)' }: { position: number; color?: string }) {
  const pos = Math.min(100, Math.max(0, position));
  return (
    <div style={{ position: 'relative', height: 8, background: 'var(--bg3)', borderRadius: 4, margin: '6px 0', overflow: 'visible' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${pos}%`, background: color, borderRadius: 4, opacity: 0.35 }} />
      <div style={{
        position: 'absolute', left: `${pos}%`, top: '50%',
        transform: 'translate(-50%, -50%)',
        width: 12, height: 12, borderRadius: '50%',
        background: color, border: '2px solid var(--bg)',
      }} />
    </div>
  );
}

export function FavoriteDetailPage({ symbol }: { symbol: string }) {
  const router = useRouter();
  const [item, setItem] = useState<FavoriteItem | null>(null);
  const [tech, setTech] = useState<TechnicalData | null>(null);
  const [fund, setFund] = useState<FundamentalsData | null>(null);
  const [chartAnalysis, setChartAnalysis] = useState<{aiAnalysis: string; updatedAt: string} | null>(null);
  const [loadingItem, setLoadingItem] = useState(true);
  const [loadingTech, setLoadingTech] = useState(true);
  const [loadingChart, setLoadingChart] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAll = useCallback(async () => {
    const [favRes, techRes, fundRes, chartRes] = await Promise.allSettled([
      fetch('/api/favorites').then(r => r.json() as Promise<{ ok: boolean; data: FavoriteItem[] }>),
      fetch(`/api/favorites/${encodeURIComponent(symbol)}/technical`).then(r => r.json() as Promise<{ ok: boolean; data: TechnicalData }>),
      fetch(`/api/fundamentals/${encodeURIComponent(symbol)}`).then(r => r.json() as Promise<{ ok: boolean; data: FundamentalsData }>),
      fetch(`/api/favorites/${encodeURIComponent(symbol)}/chart-analysis`).then(r => r.json() as Promise<{ ok: boolean; data: { symbol: string; aiAnalysis: string; updatedAt: string } }>),
    ]);
    if (favRes.status === 'fulfilled' && favRes.value.ok) {
      const found = favRes.value.data.find(f => f.symbol === symbol) ?? null;
      setItem(found);
    }
    setLoadingItem(false);
    if (techRes.status === 'fulfilled' && techRes.value.ok) {
      setTech(techRes.value.data);
    }
    setLoadingTech(false);
    if (fundRes.status === 'fulfilled' && fundRes.value.ok) {
      setFund(fundRes.value.data);
    }
    if (chartRes.status === 'fulfilled' && chartRes.value.ok) {
      setChartAnalysis(chartRes.value.data);
    }
    setLoadingChart(false);
  }, [symbol]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  async function refreshFundamentals() {
    setRefreshing(true);
    try {
      await fetch(`/api/fundamentals/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
      await fetch(`/api/fundamentals/${encodeURIComponent(symbol)}`);
      await fetchAll();
    } finally {
      setRefreshing(false);
    }
  }

  async function refreshChartAnalysis() {
    setLoadingChart(true);
    try {
      await fetch(`/api/favorites/${encodeURIComponent(symbol)}/chart-analysis`, { method: 'DELETE' });
      await fetch(`/api/favorites/${encodeURIComponent(symbol)}/chart-analysis`);
      await fetchAll();
    } finally {
      setLoadingChart(false);
    }
  }

  if (loadingItem) {
    return <div style={S.center}>로딩 중...</div>;
  }
  if (!item) {
    return (
      <div style={S.center}>
        <p>종목 정보를 찾을 수 없습니다.</p>
        <button style={S.backBtn} onClick={() => router.back()}>← 돌아가기</button>
      </div>
    );
  }

  const isOverseas = item.market === 'overseas';
  const priceDisplay = isOverseas && item.priceUsd != null
    ? usd(item.priceUsd)
    : item.price != null ? krw(item.price) + '원' : '—';
  const up = (item.changeRate ?? 0) > 0;
  const down = (item.changeRate ?? 0) < 0;
  const priceColor = up ? '#ef4444' : down ? '#3b82f6' : 'var(--fg)';

  const rawKeyFactors = fund?.key_factors ?? item.key_factors;
  const factors: KeyFactor[] = rawKeyFactors
    ? (typeof rawKeyFactors === 'string' ? JSON.parse(rawKeyFactors as string) : rawKeyFactors as KeyFactor[])
    : [];

  const stateColor = tech ? (MARKET_STATE_COLOR[tech.marketState] ?? '#6b7280') : '#6b7280';
  const stateLabel = tech ? (MARKET_STATE_KO[tech.marketState] ?? tech.marketState) : '—';
  const stateDesc = tech ? (MARKET_STATE_DESC[tech.marketState] ?? '') : '';

  // RSI 해석
  const rsiDesc = tech?.rsi14 == null ? null
    : tech.rsi14 < 30 ? '과매도 구간 — 바닥 근접, 반등 가능성 높음'
    : tech.rsi14 > 70 ? '과매수 구간 — 고점 과열, 조정 가능성 높음'
    : '중립 구간 (30~70) — 현재 특별한 과열/침체 신호 없음';

  // BB 해석
  const bbDesc = tech?.bbPosition == null ? null
    : tech.bbPosition >= 0.75 ? '상단 근접 — 단기 과열, 조정 가능성'
    : tech.bbPosition >= 0.35 ? '중간대 — 안정적인 변동 범위 내'
    : '하단 근접 — 지지선 부근, 반등 가능성';

  // EMA 해석
  const emaDesc = (tech?.ema20 != null && tech?.ema60 != null)
    ? tech.ema20 > tech.ema60
      ? '단기(20일) > 장기(60일) — 골든크로스, 상승 추세'
      : '단기(20일) < 장기(60일) — 데드크로스, 하락 추세'
    : null;

  // MACD 해석
  const macdDesc = tech?.macdHistogram == null ? null
    : tech.macdHistogram > 0
      ? 'MACD > Signal — 상승 모멘텀 지속 중'
      : 'MACD < Signal — 하락 모멘텀 지속 중';

  // N일 고저 해석
  const periodDesc = tech?.periodPosition == null ? null
    : tech.periodPosition >= 80 ? '최근 고점 부근 — 추가 상승 여력 제한적'
    : tech.periodPosition <= 20 ? '최근 저점 부근 — 하방 압력 강함'
    : '중간 구간 — 고저 사이 위치';

  return (
    <div style={S.page}>
      {/* 헤더 */}
      <div style={S.header}>
        <button style={S.backBtn} onClick={() => router.back()}>←</button>
        <div style={{ flex: 1 }}>
          <div style={S.headerTitle}>
            {item.name ?? formatSymbolShort(symbol)}
            <span style={S.headerCode}>{formatSymbolShort(symbol)}</span>
          </div>
        </div>
      </div>

      {/* 현재가 + 시장상태 */}
      <div style={S.priceSection}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ ...S.price, color: priceColor }}>{priceDisplay}</span>
          {item.changeRate != null && (
            <span style={{ fontSize: 14, fontWeight: 600, color: priceColor }}>{pct(item.changeRate)}</span>
          )}
        </div>
        {tech && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <span style={{ ...S.badge, background: stateColor + '22', color: stateColor }}>
              {stateLabel}
            </span>
            <span style={{ fontSize: 11, color: 'var(--muted)', flex: 1 }}>{stateDesc}</span>
          </div>
        )}
        {item.latestSignal && <SignalBadge signal={item.latestSignal} />}
      </div>

      {/* 기술 분석 섹션들 */}
      {loadingTech && <div style={S.center}>기술 분석 로딩 중...</div>}

      {tech && (
        <>
          {/* RSI */}
          {tech.rsi14 != null && (
            <div style={S.section}>
              <div style={S.sectionTitle}>
                RSI <span style={S.sectionSub}>과매수/과매도 강도</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
                <span style={{ fontSize: 11, color: '#3b82f6' }}>과매도 (30)</span>
                <span style={{
                  fontSize: 22, fontWeight: 800,
                  color: tech.rsi14 < 30 ? '#3b82f6' : tech.rsi14 > 70 ? '#ef4444' : 'var(--fg)',
                }}>
                  {tech.rsi14.toFixed(1)}
                </span>
                <span style={{ fontSize: 11, color: '#ef4444' }}>과매수 (70)</span>
              </div>
              <GaugeBar value={tech.rsi14} min={0} max={100} lowThresh={30} highThresh={70} lowColor="#3b82f6" highColor="#ef4444" />
              <div style={S.descRow}>
                <span style={S.descIcon}>{tech.rsi14 < 30 ? '📉' : tech.rsi14 > 70 ? '📈' : '➡️'}</span>
                <span style={S.desc}>{rsiDesc}</span>
              </div>
            </div>
          )}

          {/* 볼린저밴드 */}
          {tech.bbPosition != null && tech.bbUpper != null && tech.bbLower != null && (
            <div style={S.section}>
              <div style={S.sectionTitle}>
                볼린저밴드 <span style={S.sectionSub}>가격 변동 범위</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>
                <span>하단 {isOverseas && tech.bbLower ? usd(tech.bbLower / (item.price ?? 1) * (item.priceUsd ?? 1)) : krw(tech.bbLower)}원</span>
                <span>중단 {tech.bbMiddle != null ? (isOverseas ? '—' : krw(tech.bbMiddle) + '원') : '—'}</span>
                <span>상단 {isOverseas && tech.bbUpper ? usd(tech.bbUpper / (item.price ?? 1) * (item.priceUsd ?? 1)) : krw(tech.bbUpper)}원</span>
              </div>
              <RangeBar position={tech.bbPosition * 100} color="#8b5cf6" />
              <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                밴드 내 {(tech.bbPosition * 100).toFixed(0)}% 위치
              </div>
              <div style={S.descRow}>
                <span style={S.descIcon}>{tech.bbPosition >= 0.75 ? '⚠️' : tech.bbPosition <= 0.25 ? '🔄' : '✅'}</span>
                <span style={S.desc}>{bbDesc}</span>
              </div>
            </div>
          )}

          {/* 이동평균 */}
          {(tech.ema20 != null || tech.ema60 != null) && (
            <div style={S.section}>
              <div style={S.sectionTitle}>
                이동평균 <span style={S.sectionSub}>추세 방향 판단</span>
              </div>
              <div style={S.emaRow}>
                <div style={S.emaItem}>
                  <div style={S.emaLabel}>EMA 20일 (단기)</div>
                  <div style={{ ...S.emaValue, color: tech.ema20 != null && tech.ema60 != null && tech.ema20 > tech.ema60 ? '#ef4444' : '#3b82f6' }}>
                    {tech.ema20 != null ? (isOverseas ? '—' : krw(tech.ema20) + '원') : '—'}
                  </div>
                </div>
                <div style={{ fontSize: 18, color: 'var(--muted)', alignSelf: 'center' }}>
                  {tech.ema20 != null && tech.ema60 != null
                    ? tech.ema20 > tech.ema60 ? '>' : '<'
                    : '='}
                </div>
                <div style={S.emaItem}>
                  <div style={S.emaLabel}>EMA 60일 (장기)</div>
                  <div style={S.emaValue}>
                    {tech.ema60 != null ? (isOverseas ? '—' : krw(tech.ema60) + '원') : '—'}
                  </div>
                </div>
              </div>
              {emaDesc && (
                <div style={S.descRow}>
                  <span style={S.descIcon}>{tech.ema20 != null && tech.ema60 != null && tech.ema20 > tech.ema60 ? '📈' : '📉'}</span>
                  <span style={S.desc}>{emaDesc}</span>
                </div>
              )}
            </div>
          )}

          {/* MACD */}
          {tech.macd != null && (
            <div style={S.section}>
              <div style={S.sectionTitle}>
                MACD <span style={S.sectionSub}>추세 전환 신호</span>
              </div>
              <div style={S.macdGrid}>
                <div style={S.macdItem}>
                  <div style={S.macdLabel}>MACD</div>
                  <div style={{ ...S.macdValue, color: (tech.macd ?? 0) > 0 ? '#ef4444' : '#3b82f6' }}>
                    {tech.macd != null ? (tech.macd > 0 ? '+' : '') + tech.macd.toFixed(4) : '—'}
                  </div>
                </div>
                <div style={S.macdItem}>
                  <div style={S.macdLabel}>Signal</div>
                  <div style={S.macdValue}>
                    {tech.macdSignal != null ? (tech.macdSignal > 0 ? '+' : '') + tech.macdSignal.toFixed(4) : '—'}
                  </div>
                </div>
                <div style={S.macdItem}>
                  <div style={S.macdLabel}>Histogram</div>
                  <div style={{ ...S.macdValue, color: (tech.macdHistogram ?? 0) > 0 ? '#ef4444' : '#3b82f6' }}>
                    {tech.macdHistogram != null
                      ? (tech.macdHistogram > 0 ? '▲ +' : '▼ ') + tech.macdHistogram.toFixed(4)
                      : '—'}
                  </div>
                </div>
              </div>
              {macdDesc && (
                <div style={S.descRow}>
                  <span style={S.descIcon}>{(tech.macdHistogram ?? 0) > 0 ? '⬆️' : '⬇️'}</span>
                  <span style={S.desc}>{macdDesc}</span>
                </div>
              )}
            </div>
          )}

          {/* N일 고저 */}
          {tech.periodHigh != null && tech.periodLow != null && tech.periodPosition != null && (
            <div style={S.section}>
              <div style={S.sectionTitle}>
                최근 {tech.periodHighDays}일 가격 범위 <span style={S.sectionSub}>현재가 위치</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>
                <span>저가 {fmt(tech.periodLow, isOverseas)}</span>
                <span style={{ color: 'var(--accent)', fontWeight: 700 }}>
                  {fmt(item.price, isOverseas)} ({tech.periodPosition.toFixed(1)}%)
                </span>
                <span>고가 {fmt(tech.periodHigh, isOverseas)}</span>
              </div>
              <RangeBar position={tech.periodPosition} color="var(--accent)" />
              {periodDesc && (
                <div style={S.descRow}>
                  <span style={S.descIcon}>{tech.periodPosition >= 80 ? '🔝' : tech.periodPosition <= 20 ? '🔻' : '↔️'}</span>
                  <span style={S.desc}>{periodDesc}</span>
                </div>
              )}
            </div>
          )}

          {/* 거래량 + ATR */}
          <div style={S.section}>
            <div style={S.sectionTitle}>
              거래량 & 변동성
            </div>
            <div style={S.twoCol}>
              <div style={S.statBox}>
                <div style={S.statLabel}>거래량 비율</div>
                <div style={{ ...S.statValue, color: tech.volumeRatio >= 2.5 ? '#8b5cf6' : tech.volumeRatio >= 1.5 ? '#f59e0b' : 'var(--fg)' }}>
                  {tech.volumeRatio.toFixed(1)}배
                </div>
                <div style={S.statDesc}>
                  {tech.volumeRatio >= 2.5 ? '급등 수준 (2.5배+)' : tech.volumeRatio >= 1.5 ? '평소보다 활발' : '평균 수준'}
                </div>
              </div>
              <div style={S.statBox}>
                <div style={S.statLabel}>ATR 14 (일평균 변동폭)</div>
                <div style={S.statValue}>
                  {tech.atr14 != null ? fmt(Math.round(tech.atr14), isOverseas) : '—'}
                </div>
                <div style={S.statDesc}>
                  {tech.atr14 != null && item.price != null && item.price > 0
                    ? `현재가의 약 ${((tech.atr14 / item.price) * 100).toFixed(1)}%`
                    : '일평균 변동 예상 범위'}
                </div>
              </div>
            </div>
            <div style={{ ...S.descRow, marginTop: 4 }}>
              <span style={S.descIcon}>📊</span>
              <span style={S.desc}>
                오늘 거래량은 최근 20봉 평균의 {tech.volumeRatio.toFixed(1)}배.
                {tech.volumeRatio >= 2.5 ? ' 세력 진입 또는 이슈 발생 가능성.' : tech.volumeRatio >= 1.5 ? ' 관심 증가 중.' : ' 일반적인 거래 수준.'}
              </span>
            </div>
          </div>

          {/* 매물대 */}
          {tech.poc != null && tech.vah != null && tech.val != null && (
            <div style={S.section}>
              <div style={S.sectionTitle}>
                매물대 <span style={S.sectionSub}>거래 집중 가격대</span>
              </div>
              <div style={S.vpGrid}>
                <div style={S.vpItem}>
                  <div style={{ ...S.vpBadge, background: '#ef444422', color: '#ef4444' }}>저항선 VAH</div>
                  <div style={S.vpValue}>{fmt(Math.round(tech.vah), isOverseas)}</div>
                  <div style={S.vpDesc}>이 가격 돌파 시 추가 상승 가능</div>
                </div>
                <div style={{ ...S.vpItem, border: '1px solid var(--accent)44' }}>
                  <div style={{ ...S.vpBadge, background: 'var(--accent)22', color: 'var(--accent)' }}>핵심가 POC</div>
                  <div style={{ ...S.vpValue, color: 'var(--accent)' }}>{fmt(Math.round(tech.poc), isOverseas)}</div>
                  <div style={S.vpDesc}>거래량이 가장 집중된 가격</div>
                </div>
                <div style={S.vpItem}>
                  <div style={{ ...S.vpBadge, background: '#3b82f622', color: '#3b82f6' }}>지지선 VAL</div>
                  <div style={S.vpValue}>{fmt(Math.round(tech.val), isOverseas)}</div>
                  <div style={S.vpDesc}>이 가격 이탈 시 추가 하락 가능</div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* AI 기술 분석 섹션 */}
      <div style={{ background: '#1a1a2e', borderRadius: 12, padding: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#aaa', marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>🤖 AI 기술 분석</span>
          <button
            onClick={() => void refreshChartAnalysis()}
            style={{ fontSize: 11, color: '#4a9eff', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
          >
            갱신
          </button>
        </div>
        {loadingChart ? (
          <span style={{ color: '#666', fontSize: 13 }}>분석 중...</span>
        ) : chartAnalysis?.aiAnalysis ? (
          <>
            <p style={{ fontSize: 13, lineHeight: 1.7, color: '#ddd', margin: 0, whiteSpace: 'pre-wrap' }}>
              {chartAnalysis.aiAnalysis}
            </p>
            <div style={{ fontSize: 11, color: '#555', marginTop: 8 }}>
              {chartAnalysis.updatedAt ? new Date(chartAnalysis.updatedAt).toLocaleString('ko-KR') : ''} 기준 (30분 캐시)
            </div>
          </>
        ) : (
          <span style={{ color: '#555', fontSize: 13 }}>분석 데이터 없음 — API 키를 확인하세요</span>
        )}
      </div>

      {/* 재무 정보 */}
      <div style={S.section}>
        <div style={S.sectionTitle}>재무 지표</div>
        <div style={S.metricsGrid}>
          <MetricBox label="PBR" value={(fund?.pbr ?? item.pbr) != null ? (fund?.pbr ?? item.pbr)!.toFixed(2) + 'x' : '—'} desc="주가순자산비율" />
          <MetricBox label="PER" value={(fund?.per ?? item.per) != null ? (fund?.per ?? item.per)!.toFixed(1) + 'x' : '—'} desc="주가수익비율" />
          <MetricBox label="ROE" value={(fund?.roe ?? item.roe) != null ? (fund?.roe ?? item.roe)!.toFixed(1) + '%' : '—'} desc="자기자본이익률" />
          <MetricBox label="배당" value={(fund?.dividend_yield ?? item.dividend_yield) != null ? (fund?.dividend_yield ?? item.dividend_yield)!.toFixed(2) + '%' : '—'} desc="배당수익률" />
        </div>
        {(fund?.market_cap_bn ?? item.market_cap_bn) != null && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
            {(() => {
              const mcap = (fund?.market_cap_bn ?? item.market_cap_bn)!;
              return '시가총액: ' + (mcap >= 10000 ? (mcap / 10000).toFixed(1) + '조원' : mcap.toLocaleString() + '억원');
            })()}
          </div>
        )}

        {factors.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={S.subTitle}>핵심 판단 요소</div>
            <div style={S.factorsWrap}>
              {factors.map((f, i) => (
                <div key={i} style={S.factorChip} title={f.description}>
                  <span style={S.factorLabel}>{f.label}</span>
                  {f.value && <span style={S.factorValue}>{f.value}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {(fund?.ai_summary ?? item.ai_summary) && (
          <div style={{ marginTop: 12 }}>
            <div style={S.subTitle}>AI 종합 분석</div>
            <div style={S.aiText}>{fund?.ai_summary ?? item.ai_summary}</div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          {(fund?.updated_at ?? item.fundamentals_updated_at) ? (
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>
              {new Date((fund?.updated_at ?? item.fundamentals_updated_at)!).toLocaleDateString('ko-KR')} 기준
            </span>
          ) : <span />}
          <button style={S.refreshBtn} onClick={() => void refreshFundamentals()} disabled={refreshing}>
            {refreshing ? '조회 중...' : '재무 갱신'}
          </button>
        </div>
      </div>

      {tech && (
        <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--muted)', paddingBottom: 80, paddingTop: 4 }}>
          기술 분석 기준: {new Date(tech.updatedAt).toLocaleString('ko-KR')}
        </div>
      )}
    </div>
  );
}

function MetricBox({ label, value, desc }: { label: string; value: string; desc: string }) {
  return (
    <div style={S.metricBox}>
      <div style={S.metricLabel}>{label}</div>
      <div style={S.metricValue}>{value}</div>
      <div style={S.metricDesc}>{desc}</div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { maxWidth: 480, margin: '0 auto', padding: '12px 16px', paddingBottom: 80 },
  center: { textAlign: 'center', padding: 40, color: 'var(--muted)' },
  header: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 },
  backBtn: {
    background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8,
    color: 'var(--fg)', fontSize: 16, cursor: 'pointer', padding: '6px 12px', flexShrink: 0,
  },
  headerTitle: { fontSize: 16, fontWeight: 700, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 8 },
  headerCode: { fontSize: 11, color: 'var(--muted)', fontWeight: 400 },
  priceSection: { marginBottom: 16 },
  price: { fontSize: 26, fontWeight: 800 },
  badge: { fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 10 },
  section: {
    background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14,
    padding: '14px 16px', marginBottom: 10,
  },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: 'var(--fg)', marginBottom: 10 },
  sectionSub: { fontSize: 11, fontWeight: 400, color: 'var(--muted)', marginLeft: 6 },
  subTitle: { fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 6 },
  descRow: { display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 8 },
  descIcon: { fontSize: 13, flexShrink: 0, marginTop: 1 },
  desc: { fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 },
  emaRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  emaItem: { flex: 1, textAlign: 'center' },
  emaLabel: { fontSize: 10, color: 'var(--muted)', marginBottom: 4 },
  emaValue: { fontSize: 14, fontWeight: 700, color: 'var(--fg)' },
  macdGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 },
  macdItem: { textAlign: 'center', background: 'var(--bg3)', borderRadius: 8, padding: '8px 4px' },
  macdLabel: { fontSize: 10, color: 'var(--muted)', marginBottom: 4 },
  macdValue: { fontSize: 13, fontWeight: 700, color: 'var(--fg)' },
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  statBox: { background: 'var(--bg3)', borderRadius: 10, padding: '10px 12px', textAlign: 'center' },
  statLabel: { fontSize: 10, color: 'var(--muted)', marginBottom: 4 },
  statValue: { fontSize: 18, fontWeight: 800, color: 'var(--fg)', marginBottom: 2 },
  statDesc: { fontSize: 10, color: 'var(--muted)' },
  vpGrid: { display: 'flex', flexDirection: 'column', gap: 8 },
  vpItem: { background: 'var(--bg3)', borderRadius: 10, padding: '10px 12px' },
  vpBadge: { display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 8, marginBottom: 4 },
  vpValue: { fontSize: 16, fontWeight: 800, color: 'var(--fg)', marginBottom: 2 },
  vpDesc: { fontSize: 11, color: 'var(--muted)' },
  metricsGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 },
  metricBox: { background: 'var(--bg3)', borderRadius: 10, padding: '8px 4px', textAlign: 'center' },
  metricLabel: { fontSize: 10, color: 'var(--muted)', marginBottom: 4 },
  metricValue: { fontSize: 14, fontWeight: 700, color: 'var(--fg)' },
  metricDesc: { fontSize: 9, color: 'var(--muted)', marginTop: 2 },
  factorsWrap: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  factorChip: {
    display: 'flex', flexDirection: 'column', gap: 2,
    background: 'var(--bg3)', borderRadius: 8, padding: '5px 10px',
  },
  factorLabel: { fontSize: 11, color: 'var(--muted)', fontWeight: 600 },
  factorValue: { fontSize: 12, color: 'var(--accent)', fontWeight: 700 },
  aiText: { fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 },
  refreshBtn: {
    background: 'var(--bg3)', border: 'none', borderRadius: 8,
    color: 'var(--fg)', fontSize: 11, padding: '5px 10px', cursor: 'pointer',
  },
};
