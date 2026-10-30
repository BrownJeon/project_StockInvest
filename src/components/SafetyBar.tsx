'use client';

import { useEffect, useState } from 'react';
import { fmtNum } from '@/lib/format';
import { requestJson } from '@/lib/http';
import { liveTradingFromDryRun } from '@/lib/safety/live-trading';

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

interface OrderSyncStatus {
  count: number;
  structuralCount: number;
  oldestAgeMs: number;
}

type EmergencyState = 'idle' | 'confirm' | 'running' | 'done' | 'failed';

/**
 * 비상 청산 **성공 응답**의 의미 분류.
 *
 * `cancelled:0 · failed:0` 은 "취소할 주문이 없었다"는 뜻이지 작업 완료가 아니다.
 * 기존 UI 는 이걸 "✓ 취소 완료 — 0건 성공" 으로 표시했고, 요청 실패까지 같은 문구로
 * 흘러들어 **정반대 의미 세 가지가 한 화면**이 됐다. 여기서 셋을 분리한다.
 * (요청 자체의 실패는 이 함수에 오지 않는다 — `emState='failed'` 로 따로 간다)
 */
export type CancelAllOutcome = 'nothing_to_cancel' | 'partial' | 'success';

export function classifyCancelAll(r: { cancelled: number; failed: number }): CancelAllOutcome {
  if (r.cancelled === 0 && r.failed === 0) return 'nothing_to_cancel';
  if (r.failed > 0) return 'partial';
  return 'success';
}

export function SafetyBar() {
  const [health, setHealth]       = useState<HealthResponse | null>(null);
  const [orderSyncStatus, setOrderSyncStatus] = useState<OrderSyncStatus | null>(null);
  const [open, setOpen]           = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [emState, setEmState]     = useState<EmergencyState>('idle');
  const [emResult, setEmResult]   = useState<{ cancelled: number; failed: number } | null>(null);
  const [emError, setEmError]     = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/health')
      .then((r) => r.json())
      .then((j: HealthResponse) => { if (alive) setHealth(j); })
      .catch((e) => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    fetch('/api/safety/order-sync-status')
      .then((r) => r.json())
      .then((j) => { if (alive && j.ok) setOrderSyncStatus(j.data); })
      .catch(() => { /* 배지는 부가 정보라 실패해도 나머지 화면에 영향 없음 */ });
    return () => { alive = false; };
  }, []);

  // T-108 §3.1·§3.5 — 화면 이름은 실거래여부(ON = 실거래 가능)·모든거래차단. 방향 변환은 live-trading.ts 한 곳에서만.
  const liveTrading = health ? liveTradingFromDryRun(health.safety.dryRun) : false;
  const warnings: string[] = [];
  if (health) {
    if (liveTrading) warnings.push('실거래여부 ON');
    if (health.safety.killSwitch) warnings.push('모든거래차단 ON');
  }
  const dotBg     = warnings.length === 0 ? 'var(--ok)' : warnings.length >= 2 ? 'var(--danger)' : 'var(--warn)';
  const dotShadow = warnings.length === 0 ? 'rgba(34,197,94,.15)' : warnings.length >= 2 ? 'rgba(239,68,68,.15)' : 'rgba(245,158,11,.15)';

  let summary = '로딩...';
  if (error) summary = `health error: ${error}`;
  else if (health) {
    summary = warnings.length === 0
      ? `정상 · 실거래여부 ${liveTrading ? 'ON' : 'OFF'} · 모든거래차단 ${health.safety.killSwitch ? 'ON' : 'OFF'} · BL ${health.safety.blockedSymbols.length}`
      : warnings.join(' · ');
  }

  /**
   * 비상 청산(전 주문 취소).
   *
   * 기존 구현은 `res.ok` 도 본문 `ok` 도 보지 않아, 실패 응답이 `{cancelled:0, failed:0}`
   * 으로 읽히며 **"✓ 취소 완료 — 0건 성공"** 으로 표시됐다. 즉 "요청이 실패했다"와
   * "취소할 주문이 없다"가 화면상 구분되지 않았고, 둘은 정반대 의미다.
   * 비상 정지 컨트롤에서 이 혼동은 그 자체로 위험하므로 상태를 분리한다.
   */
  const handleEmergency = async () => {
    setEmState('running');
    setEmError(null);
    const r = await requestJson<{ cancelled?: number; failed?: number }>(
      '/api/safety/cancel-all', { method: 'POST' },
    );
    if (!r.ok) {
      setEmResult(null);          // 실패 시 완료 요약을 절대 남기지 않는다
      setEmError(r.failure.message);
      setEmState('failed');
      return;
    }
    setEmResult({
      cancelled: Number(r.data?.cancelled ?? 0),
      failed:    Number(r.data?.failed ?? 0),
    });
    setEmState('done');
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

      {orderSyncStatus != null && orderSyncStatus.count > 0 && (
        <div style={{
          marginTop: 8, padding: '6px 10px', borderRadius: 6,
          background: orderSyncStatus.structuralCount > 0 ? 'rgba(239,68,68,.12)' : 'rgba(245,158,11,.12)',
          border: `1px solid ${orderSyncStatus.structuralCount > 0 ? 'var(--danger)' : 'var(--warn)'}`,
          fontSize: 13, color: 'var(--text)',
        }}>
          {orderSyncStatus.count}건 판단 보류 중
          (최장 {Math.floor(orderSyncStatus.oldestAgeMs / 3_600_000)}시간
          {orderSyncStatus.structuralCount > 0 && `, 그중 ${orderSyncStatus.structuralCount}건 구조적`})
        </div>
      )}

      <div style={{
        background: 'var(--bg2)', maxHeight: open ? 260 : 0,
        overflow: 'hidden', transition: 'max-height .25s ease',
      }}>
        {/* Safety chips */}
        <div style={{ display: 'flex', gap: 6, padding: '10px 12px 6px', overflowX: 'auto' }}>
          {health ? (
            <>
              <SafetyChip label="실거래여부" value={liveTrading ? 'ON' : 'OFF'} ok={!liveTrading} />
              <SafetyChip label="모든거래차단" value={health.safety.killSwitch ? 'ON' : 'OFF'} ok={!health.safety.killSwitch} />
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
            {health && !liveTrading && (
              <span style={{ marginLeft: 6, color: '#555' }}>(실거래여부 OFF: 실거래소 미호출)</span>
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

          {/* 요청 자체가 실패 — 완료 요약 대신 경보. 자동 소멸하지 않는다 */}
          {emState === 'failed' && (
            <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const }}>
              <span style={{ fontSize: 13, color: '#ef4444', fontWeight: 600, minWidth: 0, wordBreak: 'break-word' }}>
                🚨 비상 청산 실패 — {emError ?? '알 수 없는 오류'} · 주문이 취소되지 않았을 수 있습니다. 주문 화면에서 직접 확인하세요.
              </span>
              <button
                onClick={handleEmergency}
                style={{
                  flexShrink: 0, padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                  background: '#ef4444', color: '#fff',
                }}
              >다시 시도</button>
              <button
                onClick={() => { setEmState('idle'); setEmError(null); }}
                style={{ flexShrink: 0, fontSize: 11, color: 'var(--muted)', padding: '3px 8px', borderRadius: 6, background: 'var(--bg3)' }}
              >닫기</button>
            </div>
          )}

          {emState === 'done' && emResult && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* 취소 0건·실패 0건은 "할 일이 없었다"는 뜻이지 작업 완료가 아니다 — ✓ 를 붙이지 않는다 */}
              {classifyCancelAll(emResult) === 'nothing_to_cancel' ? (
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                  취소할 진행 주문이 없었습니다
                </span>
              ) : classifyCancelAll(emResult) === 'partial' ? (
                <span style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>
                  ⚠ 일부 실패 — {emResult.cancelled}건 취소 · {emResult.failed}건 실패 (주문 화면에서 확인하세요)
                </span>
              ) : (
                <span style={{ fontSize: 13, color: 'var(--ok)' }}>
                  ✓ 취소 완료 — {emResult.cancelled}건
                </span>
              )}
              <button
                onClick={() => { setEmState('idle'); setEmResult(null); }}
                style={{ flexShrink: 0, fontSize: 11, color: 'var(--muted)', padding: '3px 8px', borderRadius: 6, background: 'var(--bg3)' }}
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
