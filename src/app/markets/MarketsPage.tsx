'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface MarketBalance {
  cash: number;
  cashCurrency: 'KRW' | 'USD';
  cashKRW: number;
  holdingsCount: number;
  holdingsValueKRW: number;
  totalKRW: number;
}

interface MarketSection {
  open: boolean;
  nextOpenAt: string;
  nextOpenInMs: number;
  sessionLabel: string;
  balance: MarketBalance | null;
}

interface MarketsStatus {
  ok: true;
  current: 'domestic' | 'overseas' | null;
  domestic: MarketSection;
  overseas: MarketSection;
  usDST: boolean;
  fx: { usdKrw: number; fetchedAt: string } | null;
  now: string;
}

const krw = (v: number) => v.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
const usd = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 });

function fmtUntil(ms: number): string {
  if (ms <= 0) return '개장 중';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}일 ${h % 24}시간 후`;
  if (h >= 1) return `${h}시간 ${m}분 후`;
  return `${m}분 후`;
}

function fmtNextOpen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', {
    month: '2-digit', day: '2-digit', weekday: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function MarketsPage() {
  const [status, setStatus] = useState<MarketsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const fetchStatus = async () => {
      try {
        const r = await fetch('/api/markets/status?balance=1', { cache: 'no-store' });
        const j = await r.json();
        if (!alive) return;
        if (j.ok) { setStatus(j); setErr(null); }
        else setErr(j.error ?? 'unknown');
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    };
    fetchStatus();
    const id = setInterval(fetchStatus, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (loading) return <div style={{ padding: 16, color: 'var(--muted)' }}>시장 정보 로딩 중…</div>;
  if (err || !status) return <div style={{ padding: 16, color: '#ef4444' }}>오류: {err ?? '알 수 없음'}</div>;

  const totalKRW = (status.domestic.balance?.totalKRW ?? 0) + (status.overseas.balance?.totalKRW ?? 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 16px' }}>
      <div style={sx.summary}>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>총 평가액 (KRW 환산)</div>
        <div className="num" style={{ fontSize: 22, fontWeight: 700 }}>{krw(totalKRW)} ₩</div>
        {status.fx && (
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            USD/KRW <span className="num" style={{ color: 'var(--text)' }}>{status.fx.usdKrw.toFixed(2)}</span>
            <span style={{ marginLeft: 8 }}>· {new Date(status.fx.fetchedAt).toLocaleString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 갱신</span>
          </div>
        )}
      </div>

      <MarketCard
        title="🇰🇷 한국장 (KRX)"
        section={status.domestic}
        isCurrent={status.current === 'domestic'}
        cashFmt={(v) => `${krw(v)} ₩`}
      />
      <MarketCard
        title={`🇺🇸 미국장 (NYSE/NASDAQ) ${status.usDST ? '· EDT' : '· EST'}`}
        section={status.overseas}
        isCurrent={status.current === 'overseas'}
        cashFmt={(v) => `$${usd(v)}`}
        cashKRWHint
      />

      <div style={sx.foot}>
        <Link href="/" style={{ fontSize: 12, color: 'var(--muted)' }}>← 대시보드</Link>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          {new Date(status.now).toLocaleString('ko-KR')}
        </span>
      </div>
    </div>
  );
}

function MarketCard({
  title, section, isCurrent, cashFmt, cashKRWHint,
}: {
  title: string;
  section: MarketSection;
  isCurrent: boolean;
  cashFmt: (v: number) => string;
  cashKRWHint?: boolean;
}) {
  const b = section.balance;
  const statusLabel = section.open ? '개장 중' : '마감';
  const accent = section.open ? '#22c55e' : 'var(--muted)';
  return (
    <div style={{
      ...sx.card,
      borderColor: isCurrent ? 'rgba(34,197,94,.4)' : 'var(--border)',
    }}>
      <div style={sx.cardHead}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 11, color: accent, fontWeight: 700 }}>● {statusLabel}</div>
      </div>

      <div style={sx.row}>
        <span style={sx.k}>세션</span>
        <span style={sx.v}>{section.sessionLabel}</span>
      </div>
      <div style={sx.row}>
        <span style={sx.k}>{section.open ? '현재 상태' : '다음 개장'}</span>
        <span style={sx.v}>
          {section.open ? '거래 가능' : `${fmtNextOpen(section.nextOpenAt)} (${fmtUntil(section.nextOpenInMs)})`}
        </span>
      </div>

      {b ? (
        <>
          <div style={sx.divider} />
          <div style={sx.row}>
            <span style={sx.k}>예수금</span>
            <span className="num" style={sx.v}>
              {cashFmt(b.cash)}
              {cashKRWHint && b.cash > 0 && (
                <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 6 }}>
                  ≈ {krw(b.cashKRW)} ₩
                </span>
              )}
            </span>
          </div>
          <div style={sx.row}>
            <span style={sx.k}>보유 종목</span>
            <span className="num" style={sx.v}>{b.holdingsCount} 종목</span>
          </div>
          <div style={sx.row}>
            <span style={sx.k}>보유 평가액</span>
            <span className="num" style={sx.v}>{krw(b.holdingsValueKRW)} ₩</span>
          </div>
          <div style={{ ...sx.row, ...sx.totalRow }}>
            <span style={sx.k}>합계 (KRW 환산)</span>
            <span className="num" style={{ ...sx.v, fontWeight: 700, fontSize: 14 }}>{krw(b.totalKRW)} ₩</span>
          </div>
        </>
      ) : (
        <>
          <div style={sx.divider} />
          <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--muted)' }}>
            잔고 정보 없음 (KIS 호출 실패 또는 미구성)
          </div>
        </>
      )}
    </div>
  );
}

const sx: Record<string, React.CSSProperties> = {
  summary: {
    background: 'var(--bg2)', border: '1px solid var(--border)',
    borderRadius: 12, padding: '12px 14px',
    display: 'flex', flexDirection: 'column', gap: 4,
  },
  card: {
    background: 'var(--bg2)', border: '1px solid var(--border)',
    borderRadius: 12, overflow: 'hidden',
  },
  cardHead: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 14px', borderBottom: '1px solid var(--border)',
  },
  row: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    padding: '8px 14px', fontSize: 13,
  },
  totalRow: {
    background: 'var(--bg3)', borderTop: '1px solid var(--border)',
  },
  divider: { height: 1, background: 'var(--border)' },
  k: { color: 'var(--muted)', fontSize: 12 },
  v: { color: 'var(--text)' },
  foot: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '8px 4px',
  },
};
