'use client';

import { useEffect, useState } from 'react';
import { fmtNum } from '@/lib/format';

type Period = '6h' | '24h' | '7d' | '30d';

interface VolConfig {
  windowMin: number;
  warnPct:   number;
  blockPct:  number;
  panicPct:  number;
}

interface Snapshot {
  ts:           string;
  totalKRW:     number;
  source:       string;
  prices:       Record<string, number>;
  compositions: Record<string, number>;
  level:        string;
  changePct:    number | null;
}

interface VolData {
  snapshots: Snapshot[];
  current: {
    totalKRW:  number;
    ts:        string | null;
    changePct: number | null;
    level:     string;
    config:    VolConfig;
  };
  coins: string[];
}

const LEVEL_META: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  ok:    { label: '정상', color: 'var(--ok)',     bg: 'rgba(34,197,94,.12)',  dot: '#22c55e' },
  warn:  { label: '경고', color: '#f59e0b',       bg: 'rgba(245,158,11,.12)', dot: '#f59e0b' },
  block: { label: '차단', color: '#f97316',       bg: 'rgba(249,115,22,.12)', dot: '#f97316' },
  panic: { label: '패닉', color: 'var(--down)',   bg: 'rgba(239,68,68,.12)',  dot: '#ef4444' },
};

const PERIOD_LABELS: Record<Period, string> = { '6h': '6H', '24h': '24H', '7d': '7D', '30d': '30D' };

function fmtPct(v: number | null) {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function fmtTs(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return time;
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

// ─── SVG 라인 차트 ────────────────────────────────────────────────────────────
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1]; const c = pts[i];
    const cp1x = (p.x + (c.x - p.x) * 0.5).toFixed(1);
    const cp2x = (c.x - (c.x - p.x) * 0.5).toFixed(1);
    d += ` C ${cp1x},${p.y.toFixed(1)} ${cp2x},${c.y.toFixed(1)} ${c.x.toFixed(1)},${c.y.toFixed(1)}`;
  }
  return d;
}

function LineChart({ data, thresholds, baseValue, stroke = '#f59e0b', gradId = 'lg1' }: {
  data:        { x: number; y: number }[];
  thresholds?: { pct: number; color: string }[];
  baseValue?:  number;
  stroke?:     string;
  gradId?:     string;
}) {
  if (data.length < 2) {
    return (
      <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 12 }}>
        데이터 부족 (스냅샷 2개 이상 필요)
      </div>
    );
  }

  const W = 400; const H = 80;
  const PL = 2; const PR = 2; const PT = 8; const PB = 6;

  const minX = data[0].x; const maxX = data.at(-1)!.x;
  const ys   = data.map(d => d.y);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const yRange = maxY - minY || maxY * 0.02 || 1;
  const yMin = minY - yRange * 0.12;
  const yMax = maxY + yRange * 0.12;

  const toX = (x: number) => PL + ((x - minX) / (maxX - minX || 1)) * (W - PL - PR);
  const toY = (y: number) => PT + (1 - (y - yMin) / (yMax - yMin)) * (H - PT - PB);

  const svgPts  = data.map(d => ({ x: toX(d.x), y: toY(d.y) }));
  const linePath = smoothPath(svgPts);
  const areaPath = `${linePath} L ${toX(maxX).toFixed(1)},${(H - PB).toFixed(1)} L ${toX(minX).toFixed(1)},${(H - PB).toFixed(1)} Z`;

  const base = baseValue ?? data[0].y;
  const threshLines = (thresholds ?? []).flatMap(t => {
    const y = toY(base * (1 + t.pct / 100));
    if (y < PT - 2 || y > H - PB + 2) return [];
    return [{ y: y.toFixed(1), color: t.color }];
  });

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={stroke} stopOpacity="0.1" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0"   />
          </linearGradient>
        </defs>

        {threshLines.map((t, i) => (
          <line key={i} x1={PL} y1={t.y} x2={W - PR} y2={t.y}
            stroke={t.color} strokeWidth="0.5" strokeDasharray="3 4" opacity="0.35" />
        ))}

        <path d={areaPath} fill={`url(#${gradId})`} />
        <path d={linePath} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      {/* HTML 타임스탬프 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 4px 0', fontSize: 10, color: 'var(--muted)' }}>
        <span>{fmtTs(new Date(data[0].x).toISOString())}</span>
        <span>{fmtTs(new Date(data.at(-1)!.x).toISOString())}</span>
      </div>
    </div>
  );
}

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export function VolatilityTab() {
  const [period, setPeriod] = useState<Period>('24h');
  const [data, setData]     = useState<VolData | null>(null);
  const [loading, setLoading] = useState(true);
  const [coin, setCoin]       = useState<string | null>(null);
  const [histExpanded, setHistExpanded] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/analytics/volatility?period=${period}`)
      .then(r => r.json())
      .then(j => {
        if (j.ok) {
          setData(j as VolData);
          setCoin(prev => prev ?? (j.coins[0] ?? null));
        }
      })
      .finally(() => setLoading(false));
  }, [period]);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>불러오는 중…</div>;
  }
  if (!data || data.snapshots.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13, lineHeight: 1.8 }}>
        스냅샷 없음<br />
        <span style={{ fontSize: 12 }}>`/api/cron/portfolio-snapshot` 실행 후 표시됩니다</span>
      </div>
    );
  }

  const { snapshots, current, coins } = data;
  const cfg   = current.config;
  const lmeta = LEVEL_META[current.level] ?? LEVEL_META.ok;

  // 차트용 데이터
  const chartData = snapshots.map(s => ({ x: new Date(s.ts).getTime(), y: s.totalKRW }));

  // 종목 가격 차트 데이터
  const coinChartData = coin
    ? snapshots
        .filter(s => s.prices[coin] != null)
        .map(s => ({ x: new Date(s.ts).getTime(), y: s.prices[coin] }))
    : [];

  // 최신 자산 구성
  const latestSnap  = snapshots.at(-1);
  const compEntries = latestSnap
    ? Object.entries(latestSnap.compositions).filter(([, pct]) => pct > 0).sort((a, b) => b[1] - a[1])
    : [];

  // 이력 테이블 (최신순 30개)
  const allTableRows = [...snapshots].reverse().slice(0, 30);
  const tableRows    = histExpanded ? allTableRows : allTableRows.slice(0, 10);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* 기간 선택 */}
      <div style={{ display: 'flex', gap: 6 }}>
        {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
          <button key={p} onClick={() => setPeriod(p)} style={{
            padding: '5px 14px', borderRadius: 16, fontSize: 12, fontWeight: 600,
            background: period === p ? 'var(--accent)' : 'var(--bg3)',
            color:      period === p ? '#000' : 'var(--muted)',
            border: 'none', cursor: 'pointer',
          }}>{PERIOD_LABELS[p]}</button>
        ))}
      </div>

      {/* ── Section 1: 현재 상태 카드 ── */}
      <div style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
        {/* 상태 헤더 */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', background: lmeta.bg, borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: lmeta.dot, display: 'inline-block', flexShrink: 0 }} />
            <span style={{ fontWeight: 700, fontSize: 14, color: lmeta.color }}>
              Vol Guard · {lmeta.label}
            </span>
          </div>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>기준 {cfg.windowMin}분</span>
        </div>

        {/* 수치 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', padding: '12px 14px', gap: 8 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>현재 총액</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>₩{fmtNum(current.totalKRW)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{cfg.windowMin}분 변동률</div>
            <div style={{
              fontSize: 18, fontWeight: 700, marginTop: 2,
              color: current.changePct == null ? 'var(--muted)' : current.changePct >= 0 ? 'var(--ok)' : lmeta.color,
            }}>{fmtPct(current.changePct)}</div>
          </div>
        </div>

        {/* 임계치 필 */}
        <div style={{ display: 'flex', gap: 6, padding: '0 14px 12px', flexWrap: 'wrap' as const }}>
          {[
            { label: `경고 ${cfg.warnPct}%`,  color: LEVEL_META.warn.dot,  bg: LEVEL_META.warn.bg  },
            { label: `차단 ${cfg.blockPct}%`, color: LEVEL_META.block.dot, bg: LEVEL_META.block.bg },
            { label: `패닉 ${cfg.panicPct}%`, color: LEVEL_META.panic.dot, bg: LEVEL_META.panic.bg },
          ].map(t => (
            <span key={t.label} style={{
              fontSize: 11, padding: '3px 8px', borderRadius: 8,
              background: t.bg, color: t.color, fontWeight: 600,
            }}>{t.label}</span>
          ))}
        </div>
      </div>

      {/* ── Section 2: 총액 추이 차트 ── */}
      <div style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px 6px', fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
          포트폴리오 총액 추이
        </div>
        <div style={{ padding: '0 2px 6px' }}>
          <LineChart
            data={chartData}
            baseValue={chartData[0]?.y}
            thresholds={[
              { pct: cfg.warnPct,  color: LEVEL_META.warn.dot  },
              { pct: cfg.blockPct, color: LEVEL_META.block.dot },
              { pct: cfg.panicPct, color: LEVEL_META.panic.dot },
            ]}
            stroke="#f59e0b"
            gradId="volTotalGrad"
          />
        </div>
      </div>

      {/* ── Section 3: 종목별 가격 추이 ── */}
      {coins.length > 0 && (
        <div style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px 8px', fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
            종목별 가격 추이
          </div>
          <div style={{ display: 'flex', gap: 6, padding: '0 14px 10px', overflowX: 'auto', scrollbarWidth: 'none', minWidth: 0 }}>
            {coins.map(c => (
              <button key={c} onClick={() => setCoin(c)} style={{
                flexShrink: 0, padding: '4px 12px', borderRadius: 14, fontSize: 12, fontWeight: 600,
                background: coin === c ? '#818cf8' : 'var(--bg3)',
                color:      coin === c ? '#fff'    : 'var(--muted)',
                border: 'none', cursor: 'pointer',
              }}>{c}</button>
            ))}
          </div>
          <div style={{ padding: '0 2px 6px' }}>
            <LineChart data={coinChartData} stroke="#818cf8" gradId="volCoinGrad" />
          </div>
          {coin && coinChartData.length >= 2 && (
            <div style={{ padding: '0 14px 12px', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: 'var(--muted)' }}>시작 ₩{fmtNum(coinChartData[0].y)}</span>
              <span style={{ color: 'var(--muted)' }}>현재 ₩{fmtNum(coinChartData.at(-1)!.y)}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Section 4: 자산 구성 (최신) ── */}
      {compEntries.length > 0 && (
        <div style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', borderBottom: '1px solid var(--border)' }}>
            자산 구성 (최신 스냅샷)
          </div>
          <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {compEntries.map(([currency, pct]) => (
              <div key={currency}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
                  <span style={{ fontWeight: 600 }}>{currency}</span>
                  <span style={{ color: 'var(--muted)' }}>{pct.toFixed(1)}%</span>
                </div>
                <div style={{ background: 'var(--bg3)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.min(pct, 100)}%`, height: '100%', borderRadius: 4,
                    background: currency === 'KRW' ? '#4b5563' : '#818cf8',
                    transition: 'width .3s ease',
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Section 5: 스냅샷 이력 ── */}
      <div style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', borderBottom: '1px solid var(--border)' }}>
          스냅샷 이력
        </div>
        {tableRows.map((s, i) => {
          const m = LEVEL_META[s.level] ?? LEVEL_META.ok;
          const isLast = i === tableRows.length - 1 && (histExpanded || allTableRows.length <= 10);
          return (
            <div key={s.ts} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px', gap: 10,
              borderBottom: isLast ? 'none' : '1px solid var(--border)',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{fmtTs(s.ts)}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  {s.source === 'hourly' ? '자동' : s.source}
                  {s.changePct != null && (
                    <span style={{ marginLeft: 6, color: s.changePct >= 0 ? 'var(--ok)' : m.color }}>
                      {fmtPct(s.changePct)} ({cfg.windowMin}분)
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>₩{fmtNum(s.totalKRW)}</span>
                {s.level !== 'ok' && (
                  <span style={{
                    fontSize: 10, padding: '2px 7px', borderRadius: 8, fontWeight: 700,
                    background: m.bg, color: m.color,
                  }}>{m.label}</span>
                )}
              </div>
            </div>
          );
        })}
        {allTableRows.length > 10 && (
          <button
            onClick={() => setHistExpanded(v => !v)}
            style={{
              width: '100%', padding: '10px 0', fontSize: 12, fontWeight: 600,
              color: 'var(--muted)', borderTop: '1px solid var(--border)',
              background: 'var(--bg3)', cursor: 'pointer',
            }}
          >
            {histExpanded ? '접기 ▲' : `더보기 (${allTableRows.length - 10}건 더) ▼`}
          </button>
        )}
      </div>

    </div>
  );
}
