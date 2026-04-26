'use client';

import { useEffect, useState } from 'react';
import { fmtNum } from '@/lib/format';

interface HealthResponse {
  ok: boolean;
  db: boolean;
  safety: {
    dryRun: boolean;
    killSwitch: boolean;
    orderMaxKRW: number;
    dailyOrderMaxKRW: number;
    blockedSymbols: string[];
  };
}

type EmergencyState = 'idle' | 'confirm' | 'running' | 'done';

export function SafetyBar() {
  const [health, setHealth]       = useState<HealthResponse | null>(null);
  const [open, setOpen]           = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [emState, setEmState]     = useState<EmergencyState>('idle');
  const [emResult, setEmResult]   = useState<{ cancelled: number; failed: number } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/health')
      .then((r) => r.json())
      .then((j: HealthResponse) => { if (alive) setHealth(j); })
      .catch((e) => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, []);

  const warnings: string[] = [];
  if (health) {
    if (!health.safety.dryRun) warnings.push('DRY_RUN OFF');
    if (health.safety.killSwitch) warnings.push('KILL ON');
  }
  const dotBg     = warnings.length === 0 ? 'var(--ok)' : warnings.length >= 2 ? 'var(--danger)' : 'var(--warn)';
  const dotShadow = warnings.length === 0 ? 'rgba(34,197,94,.15)' : warnings.length >= 2 ? 'rgba(239,68,68,.15)' : 'rgba(245,158,11,.15)';

  let summary = '로딩...';
  if (error) summary = `health error: ${error}`;
  else if (health) {
    summary = warnings.length === 0
      ? `정상 · DRY_RUN ${health.safety.dryRun ? 'ON' : 'OFF'} · KILL ${health.safety.killSwitch ? 'ON' : 'OFF'} · BL ${health.safety.blockedSymbols.length}`
      : warnings.join(' · ');
  }

  const handleEmergency = async () => {
    setEmState('running');
    try {
      const res  = await fetch('/api/safety/cancel-all', { method: 'POST' });
      const data = await res.json();
      setEmResult({ cancelled: data.cancelled ?? 0, failed: data.failed ?? 0 });
      setEmState('done');
    } catch {
      setEmState('idle');
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          minHeight: 44, padding: '10px 16px', textAlign: 'left',
          background: 'var(--bg2)', borderTop: '1px solid var(--border)',
        }}
      >
        <span style={{
          width: 10, height: 10, borderRadius: '50%',
          background: dotBg, boxShadow: `0 0 0 3px ${dotShadow}`, flex: '0 0 auto',
        }} />
        <span style={{ fontSize: 13, fontWeight: 700 }}>Safety</span>
        <span style={{
          fontSize: 12, color: 'var(--muted)', flex: 1, minWidth: 0,
          overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
        }}>{summary}</span>
        <span style={{ fontSize: 12, color: 'var(--muted)', transition: 'transform .2s', transform: open ? 'rotate(180deg)' : undefined }}>▲</span>
      </button>

      <div style={{
        background: 'var(--bg2)', maxHeight: open ? 260 : 0,
        overflow: 'hidden', transition: 'max-height .25s ease',
      }}>
        {/* Safety chips */}
        <div style={{ display: 'flex', gap: 6, padding: '10px 12px 6px', overflowX: 'auto' }}>
          {health ? (
            <>
              <SafetyChip label="DRY_RUN" value={health.safety.dryRun ? 'ON' : 'OFF'} ok={health.safety.dryRun} />
              <SafetyChip label="KILL" value={health.safety.killSwitch ? 'ON' : 'OFF'} ok={!health.safety.killSwitch} />
              <SafetyChip label="ORDER_MAX" value={fmtNum(health.safety.orderMaxKRW)} />
              <SafetyChip label="DAILY_MAX" value={fmtNum(health.safety.dailyOrderMaxKRW)} />
              <SafetyChip label="BL" value={health.safety.blockedSymbols.length === 0 ? '없음' : health.safety.blockedSymbols.map((s) => s.replace('KRW-', '')).join(', ')} />
              <SafetyChip label="DB" value={health.db ? 'OK' : 'FAIL'} ok={health.db} />
            </>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>로딩...</span>
          )}
        </div>

        {/* Emergency section */}
        <div style={{ padding: '8px 12px 14px', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
            비상 청산 — 진행 중인 주문 전체 취소
            {health?.safety.dryRun && (
              <span style={{ marginLeft: 6, color: '#555' }}>(DRY_RUN: 실거래소 미호출)</span>
            )}
          </div>

          {emState === 'idle' && (
            <button
              onClick={() => setEmState('confirm')}
              style={{
                padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                background: 'rgba(239,68,68,.15)', color: '#ef4444',
                border: '1px solid rgba(239,68,68,.3)',
              }}
            >
              🚨 비상 청산
            </button>
          )}

          {emState === 'confirm' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
              <span style={{ fontSize: 12, color: '#ef4444', fontWeight: 600 }}>모든 진행 주문을 취소합니다. 계속?</span>
              <button
                onClick={handleEmergency}
                style={{
                  padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                  background: '#ef4444', color: '#fff',
                }}
              >확인</button>
              <button
                onClick={() => setEmState('idle')}
                style={{
                  padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  background: 'var(--bg3)', color: 'var(--muted)',
                }}
              >취소</button>
            </div>
          )}

          {emState === 'running' && (
            <span style={{ fontSize: 13, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                display: 'inline-block', width: 12, height: 12,
                border: '2px solid var(--border2)', borderTopColor: 'var(--accent)',
                borderRadius: '50%', animation: 'ti-spin .8s linear infinite',
              }} />
              취소 중…
            </span>
          )}

          {emState === 'done' && emResult && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, color: emResult.failed > 0 ? 'var(--accent)' : 'var(--ok)' }}>
                ✓ 취소 완료 — {emResult.cancelled}건 성공
                {emResult.failed > 0 && ` · ${emResult.failed}건 실패`}
              </span>
              <button
                onClick={() => { setEmState('idle'); setEmResult(null); }}
                style={{ fontSize: 11, color: 'var(--muted)', padding: '3px 8px', borderRadius: 6, background: 'var(--bg3)' }}
              >닫기</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function SafetyChip({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  const border = ok === true ? '#14532d' : ok === false ? '#7f1d1d' : 'var(--border)';
  const color  = ok === true ? '#86efac' : ok === false ? '#fca5a5' : '#cbd5e1';
  return (
    <span style={{
      flex: '0 0 auto', padding: '6px 10px', borderRadius: 999,
      background: 'var(--bg3)', border: `1px solid ${border}`,
      fontSize: 11, whiteSpace: 'nowrap', color,
    }}>
      <b style={{ fontWeight: 700, marginRight: 4, color: '#cbd5e1' }}>{label}</b>
      {value}
    </span>
  );
}
