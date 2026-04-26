'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatRelativeTime } from '@/lib/time';

interface Safety {
  analystEnabled: boolean;
  killSwitch: boolean;
  dryRun: boolean;
}

interface MarketsStatus {
  current: 'domestic' | 'overseas' | null;
  domestic: { open: boolean };
  overseas: { open: boolean };
}

interface Props {
  /** 후방 호환용 — 본 배너에서는 직접적 변경이 없으므로 호출되지 않음 */
  onStatusChange?: () => void;
}

export function AnalystStatusBanner(_props: Props = {}) {
  void _props;
  const [safety, setSafety]       = useState<Safety | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [markets, setMarkets]     = useState<MarketsStatus | null>(null);

  useEffect(() => {
    fetch('/api/settings/safety')
      .then(r => r.json())
      .then(d => { if (d.ok) setSafety(d.safety); });
    fetch('/api/signals?limit=1')
      .then(r => r.json())
      .then(d => { setLastRunAt(d.data?.[0]?.created_at ?? null); });
    const loadMarkets = () => fetch('/api/markets/status')
      .then(r => r.json())
      .then(d => { if (d.ok) setMarkets(d); })
      .catch(() => {});
    loadMarkets();
    const id = setInterval(loadMarkets, 60_000);
    return () => clearInterval(id);
  }, []);

  if (!safety) return null;

  const isKill   = safety.killSwitch;
  const isActive = safety.analystEnabled && !isKill;
  const isLive   = !safety.dryRun;   // 실거래 ON 여부 (DRY_RUN의 반전)
  const relTime  = lastRunAt ? formatRelativeTime(lastRunAt) : null;

  // 메인 라벨 + 아이콘
  const mainIcon  = isKill ? '🚨' : isActive ? '🟢' : '⏸';
  const mainLabel = isKill ? '긴급 정지 중' : isActive ? '분석가 운영 중' : '분석가 일시 중지';

  // 메타 (보조) 텍스트
  let metaText = '';
  if (isKill) {
    metaText = '모든 주문 송신이 차단됩니다';
  } else if (isActive) {
    metaText = relTime ? `마지막 시그널: ${relTime}` : '시그널 대기 중';
  } else {
    metaText = relTime ? `분석가가 비활성 상태입니다 · 마지막 시그널: ${relTime}` : '분석가가 비활성 상태입니다';
  }

  // 배경/보더 — 실거래 ON 시 보더만 빨강 강조
  const bgColor = isKill ? '#2a0a0a' : isActive ? '#0a1a0a' : '#1a1500';
  const borderColor = isKill
    ? '#ef444466'
    : isLive && !isKill
      ? '#ef444499'    // 실거래 ON → 빨강 보더로 강조
      : isActive
        ? '#22c55e44'
        : '#f59e0b44';

  return (
    <div style={{
      margin: '12px 16px 0', padding: '14px', borderRadius: 12,
      background: bgColor, border: `1px solid ${borderColor}`,
    }}>
      {/* 상단: 메인 라벨 + 상태 칩들 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        {/* 좌측: 아이콘 + 라벨 + 메타 */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 20, flexShrink: 0, lineHeight: '20px' }}>{mainIcon}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{mainLabel}</div>
            <div style={{ fontSize: 11, color: isKill ? '#ef4444' : 'var(--muted)', marginTop: 2 }}>
              {metaText}
            </div>
          </div>
        </div>

        {/* 우측: 상태 칩 */}
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {isKill ? (
            <StatusChip label="긴급 정지" value="ON" tone="danger" />
          ) : (
            <>
              <StatusChip
                label="분석가"
                value={safety.analystEnabled ? 'ON' : 'OFF'}
                tone={safety.analystEnabled ? 'ok' : 'muted'}
              />
              <StatusChip
                label="실거래"
                value={isLive ? 'ON' : 'OFF'}
                tone={isLive ? 'danger' : 'ok'}
              />
            </>
          )}
        </div>
      </div>

      {/* 시장 개장/마감 정보 (Kill 아닐 때) */}
      {markets && !isKill && (
        <div style={{
          marginTop: 8, fontSize: 11, color: 'var(--muted)',
          borderTop: '1px solid var(--border)', paddingTop: 8,
          display: 'flex', gap: 10, flexWrap: 'wrap',
        }}>
          <span style={{ color: markets.domestic.open ? 'var(--ok)' : 'var(--muted)', fontWeight: 600 }}>
            🇰🇷 {markets.domestic.open ? '개장' : '마감'}
          </span>
          <span style={{ color: markets.overseas.open ? 'var(--ok)' : 'var(--muted)', fontWeight: 600 }}>
            🇺🇸 {markets.overseas.open ? '개장' : '마감'}
          </span>
          {markets.current === null && (
            <span>· 양시장 마감 중 — 시그널 발화 보류</span>
          )}
        </div>
      )}

      {/* 하단: 모드 안내 + 설정 링크 */}
      {!isKill && (
        <div style={{
          marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 11, color: isLive ? '#ef4444' : 'var(--accent)', fontWeight: isLive ? 600 : 400 }}>
            {isLive
              ? '🔴 실거래 모드 — KIS API에 실제 주문이 송신됩니다'
              : '⚠️ 모의 주문 모드 — 실제 주문이 전송되지 않습니다'}
          </span>
          <Link href="/settings" style={{ fontSize: 11, color: 'var(--muted)', textDecoration: 'none' }}>
            설정에서 변경 →
          </Link>
        </div>
      )}
      {isKill && (
        <div style={{
          marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)',
          display: 'flex', justifyContent: 'flex-end',
        }}>
          <Link href="/settings" style={{ fontSize: 11, color: 'var(--muted)', textDecoration: 'none' }}>
            설정에서 변경 →
          </Link>
        </div>
      )}
    </div>
  );
}

function StatusChip({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'danger' | 'muted' }) {
  const colorMap = {
    ok:     { bg: 'rgba(34,197,94,.18)',  fg: 'var(--ok)',    border: 'rgba(34,197,94,.4)'  },
    danger: { bg: 'rgba(239,68,68,.20)',  fg: '#ef4444',      border: 'rgba(239,68,68,.5)'  },
    muted:  { bg: 'var(--bg3)',            fg: 'var(--muted)', border: 'var(--border)'      },
  } as const;
  const c = colorMap[tone];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
      background: c.bg, color: c.fg, border: `1px solid ${c.border}`,
    }}>
      <span style={{ opacity: 0.8 }}>{label}</span>
      <span>{value}</span>
    </span>
  );
}
