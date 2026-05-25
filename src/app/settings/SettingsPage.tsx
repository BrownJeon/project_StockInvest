'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fmtNum } from '@/lib/format';
import { LlmProviderSection } from './LlmProviderSection';
import { ExchangeAccountSection } from './ExchangeAccountSection';
import { NotifyChannelSection } from './NotifyChannelSection';

interface StrategyItem {
  id: string;
  enabled: boolean;
  backtestIntervalM: number;
  nextBacktestAt: string | null;
}

interface SafetyData {
  dryRun: boolean; killSwitch: boolean;
  orderMaxPct: number; dailyOrderMaxPct: number;
  universeEnabled: boolean;
  analystEnabled: boolean;
  blockedSymbols: string[];
  blockedSymbolsOverseas: string[];
  volGuardEnabled: boolean;
  volGuardWindowMin: number;
  volGuardWarnPct: number;
  volGuardBlockPct: number;
  volGuardPanicPct: number;
}

interface NotifySignalData {
  autoSubmit: boolean;
  pending: boolean;
}

interface ReportData {
  enabled: boolean;
  channel: 'slack' | 'telegram' | 'both' | 'none';
  mode: 'rolling' | 'fixed';
  intervalMin: number;
  anchorKst: string | null;
  lastSentAt: string | null;
}

interface ExchangeData {
  kis: { configured: boolean; mock: boolean; overseasEnabled: boolean };
}

type SaveState = 'idle' | 'saving' | 'saved';

function Toggle({ checked, onChange, danger }: { checked: boolean; onChange: (v: boolean) => void; danger?: boolean }) {
  return (
    <div
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        position: 'relative', width: 44, height: 24, borderRadius: 12,
        cursor: 'pointer', flexShrink: 0,
        background: checked
          ? (danger ? 'var(--down)' : 'var(--ok)')
          : 'var(--bg3)',
        transition: 'background .2s',
      }}
    >
      <div style={{
        position: 'absolute', top: 2, left: checked ? 22 : 2,
        width: 20, height: 20, borderRadius: '50%', background: '#fff',
        transition: 'left .2s',
      }} />
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', padding: '8px 0 4px' }}>
      {title}
    </div>
  );
}

function InfoRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
      <div>
        <div style={{ fontSize: 14 }}>{label}</div>
        {sub && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{value}</div>
    </div>
  );
}

function StatusBadge({ ok, labelOk, labelNo }: { ok: boolean; labelOk: string; labelNo: string }) {
  return (
    <span style={{
      fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 10,
      background: ok ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.15)',
      color: ok ? 'var(--ok)' : 'var(--down)',
    }}>
      {ok ? labelOk : labelNo}
    </span>
  );
}

export function SettingsPage() {
  const [safety, setSafety]               = useState<SafetyData | null>(null);
  const [notifySignal, setNotifySignal]   = useState<NotifySignalData>({ autoSubmit: true, pending: true });
  const [report, setReport]               = useState<ReportData | null>(null);
  const [exchanges, setExchanges]         = useState<ExchangeData | null>(null);
  const [strategies, setStrategies]       = useState<StrategyItem[]>([]);
  const [loading, setLoading]             = useState(true);
  const [saveState, setSaveState]         = useState<SaveState>('idle');
  const [isDirty, setIsDirty]             = useState(false);
  const [hybridMode, setHybridMode]       = useState<boolean>(false);
  const [hybridSaving, setHybridSaving]   = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/settings/safety').then(r => r.json()),
      fetch('/api/settings/strategies').then(r => r.json()),
      fetch('/api/settings/hybrid').then(r => r.json()).catch(() => null),
    ]).then(([safetyData, stratData, hybridData]) => {
      if (safetyData.ok) {
        setSafety(safetyData.safety);
        setExchanges(safetyData.exchanges);
        if (safetyData.notifySignal) setNotifySignal(safetyData.notifySignal as NotifySignalData);
        if (safetyData.report) setReport(safetyData.report as ReportData);
      }
      if (stratData.ok) {
        setStrategies(stratData.strategies);
      }
      if (hybridData?.ok) {
        setHybridMode(hybridData.enabled ?? false);
      }
    }).finally(() => setLoading(false));
  }, []);

  const toggleHybridMode = useCallback(async (enabled: boolean) => {
    setHybridMode(enabled);
    setHybridSaving(true);
    try {
      await fetch('/api/settings/hybrid', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
    } catch { /* non-fatal */ } finally {
      setHybridSaving(false);
    }
  }, []);

  const patchStrategy = useCallback((id: string, delta: { backtestIntervalM?: number; enabled?: boolean }) => {
    setStrategies(prev => prev.map(s => s.id === id ? { ...s, ...delta } : s));
    setIsDirty(true);
  }, []);

  const update = (delta: Partial<SafetyData>) => {
    setSafety(prev => prev ? { ...prev, ...delta } : prev);
    setIsDirty(true);
  };

  const autoSave = useCallback(async (delta: Partial<SafetyData>) => {
    try {
      await fetch('/api/settings/safety', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(delta),
      });
    } catch { /* non-fatal */ }
  }, []);

  const updateReport = (delta: Partial<ReportData>) => {
    setReport(prev => prev ? { ...prev, ...delta } : prev);
    setIsDirty(true);
  };

  const handleSave = useCallback(async () => {
    if (!safety) return;
    setSaveState('saving');
    try {
      await Promise.all([
        fetch('/api/settings/safety', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...safety,
            notifySignalAutoSubmit: notifySignal.autoSubmit,
            notifySignalPending:    notifySignal.pending,
            ...(report ? {
              reportEnabled:     report.enabled,
              reportChannel:     report.channel,
              reportMode:        report.mode,
              reportIntervalMin: report.intervalMin,
              reportAnchorKst:   report.anchorKst,
            } : {}),
          }),
        }),
        ...strategies.map(s =>
          fetch('/api/settings/strategies', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: s.id, enabled: s.enabled, backtestIntervalM: s.backtestIntervalM }),
          })
        ),
      ]);
      setSaveState('saved');
      setIsDirty(false);
      setTimeout(() => setSaveState('idle'), 2000);
    } catch {
      setSaveState('idle');
    }
  }, [safety, notifySignal, report, strategies]);

  if (loading) return <div style={{ textAlign: 'center', padding: 48, color: 'var(--muted)' }}>불러오는 중…</div>;

  return (
    <div style={{ overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Save bar */}
      {(isDirty || saveState !== 'idle') && (
        <div style={{
          position: 'sticky', top: 0, zIndex: 20,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderRadius: 10, marginBottom: 4,
          background: isDirty ? 'rgba(251,191,36,.12)' : 'rgba(34,197,94,.1)',
          border: `1px solid ${isDirty ? 'rgba(251,191,36,.4)' : 'rgba(34,197,94,.3)'}`,
        }}>
          <span style={{ fontSize: 12, color: isDirty ? 'var(--accent)' : 'var(--ok)', fontWeight: 600 }}>
            {saveState === 'saving' ? '저장 중…' : saveState === 'saved' ? '저장됨 ✓' : '변경 사항 있음'}
          </span>
          {isDirty && (
            <button
              onClick={handleSave}
              disabled={saveState === 'saving'}
              style={{
                padding: '6px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                background: 'var(--accent)', color: '#000', border: 'none', cursor: 'pointer',
                opacity: saveState === 'saving' ? 0.6 : 1,
              }}
            >
              저장
            </button>
          )}
        </div>
      )}

      {/* 하이브리드 매매 모드 */}
      <SectionHeader title="하이브리드 매매 모드" />
      <div style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px' }}>
          <div>
            <div style={{ fontSize: 14 }}>하이브리드 모드</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {hybridMode
                ? 'ON — AI 시그널 승인 후 진입 구간 도달 시 자동 체결'
                : 'OFF — 기존 즉시 승인 방식'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              활성화 시 추천(💡) 탭에서 수치 편집 후 진입 감시 가능
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            {hybridSaving && <span style={{ fontSize: 11, color: 'var(--muted)' }}>저장 중...</span>}
            <span style={{ fontSize: 12, fontWeight: 600, color: hybridMode ? '#818cf8' : 'var(--muted)' }}>
              {hybridMode ? 'ON' : 'OFF'}
            </span>
            <Toggle
              checked={hybridMode}
              onChange={toggleHybridMode}
            />
          </div>
        </div>
      </div>

      {/* Safety — global */}
      <SectionHeader title="안전장치 (공통)" />
      <div style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>

        {/* 실거래 여부 toggle (내부 dryRun 의미를 반전해 노출) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 14 }}>실거래 여부</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {safety?.dryRun ? 'OFF — 실제 거래소 API 차단 (안전, DRY_RUN)' : 'ON — 실제 주문 전송 중'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: safety?.dryRun ? 'var(--ok)' : 'var(--down)' }}>
              {safety?.dryRun ? 'OFF' : 'ON'}
            </span>
            <Toggle
              checked={!(safety?.dryRun ?? true)}
              onChange={v => { update({ dryRun: !v }); autoSave({ dryRun: !v }); }}
            />
          </div>
        </div>

        {/* KILL_SWITCH toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 14 }}>KILL_SWITCH</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {safety?.killSwitch ? '모든 주문 즉시 차단 중' : 'OFF — 주문 정상 처리'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: safety?.killSwitch ? 'var(--down)' : 'var(--ok)' }}>
              {safety?.killSwitch ? 'ON' : 'OFF'}
            </span>
            <Toggle
              checked={safety?.killSwitch ?? false}
              onChange={v => { update({ killSwitch: v }); autoSave({ killSwitch: v }); }}
              danger
            />
          </div>
        </div>

        {/* 1회 주문 최대 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 14 }}>1회 주문 최대 (%)</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>포트폴리오 평가총액 × pct%. 0 = 무제한</div>
          </div>
          <LimitInput
            value={safety?.orderMaxPct ?? 0}
            onChange={v => update({ orderMaxPct: v })}
            allowZero
            suffix="%"
          />
        </div>

        {/* 일일 누적 최대 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 14 }}>일일 누적 최대 (%)</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>포트폴리오 평가총액 × pct%. 오늘 0시~자정 누적 상한. 0 = 무제한</div>
          </div>
          <LimitInput
            value={safety?.dailyOrderMaxPct ?? 0}
            onChange={v => update({ dailyOrderMaxPct: v })}
            allowZero
            suffix="%"
          />
        </div>

      </div>

      {/* 거래 보호 — 종목별 거래 차단 */}
      <SectionHeader title="거래 보호" />
      <div style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
            등록된 종목은 매수·매도 시그널 생성 단계에서 즉시 차단됩니다. AI 분석·주문 전송 모두 수행하지 않습니다.
          </div>
        </div>
        <SymbolEditor
          symbols={safety?.blockedSymbols ?? []}
          onChange={v => update({ blockedSymbols: v })}
          label="국내 거래 차단 종목"
          placeholder="예: 005930 (삼성전자)"
          chipColor="rgba(239,68,68,.15)"
          chipBorder="rgba(239,68,68,.3)"
          marketFilter="domestic"
        />
        <SymbolEditor
          symbols={safety?.blockedSymbolsOverseas ?? []}
          onChange={v => update({ blockedSymbolsOverseas: v })}
          label="해외 거래 차단 종목"
          placeholder="예: NAS:AAPL"
          chipColor="rgba(239,68,68,.15)"
          chipBorder="rgba(239,68,68,.3)"
          marketFilter="overseas"
        />
      </div>

      {/* Volatility Guard */}
      <SectionHeader title="변동폭 가드" />
      <div style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>

        {/* enabled toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 14 }}>변동폭 가드 활성화</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {safety?.volGuardEnabled ? '포트폴리오 변동률 실시간 모니터링 중' : 'OFF — 변동폭 체크 없음'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: safety?.volGuardEnabled ? 'var(--ok)' : 'var(--muted)' }}>
              {safety?.volGuardEnabled ? 'ON' : 'OFF'}
            </span>
            <Toggle
              checked={safety?.volGuardEnabled ?? false}
              onChange={v => update({ volGuardEnabled: v })}
            />
          </div>
        </div>

        {/* Window */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border)', opacity: safety?.volGuardEnabled ? 1 : 0.4 }}>
          <div>
            <div style={{ fontSize: 14 }}>비교 윈도우</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>이 시간 내 변동률 기준 (분)</div>
          </div>
          <MinutesInput
            value={safety?.volGuardWindowMin ?? 60}
            onChange={v => update({ volGuardWindowMin: v })}
          />
        </div>

        {/* Warn */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border)', opacity: safety?.volGuardEnabled ? 1 : 0.4 }}>
          <div>
            <div style={{ fontSize: 14 }}>경고 임계치</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>로그만 기록 (주문 차단 없음)</div>
          </div>
          <PctInput value={safety?.volGuardWarnPct ?? -2} onChange={v => update({ volGuardWarnPct: v })} />
        </div>

        {/* Block */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border)', opacity: safety?.volGuardEnabled ? 1 : 0.4 }}>
          <div>
            <div style={{ fontSize: 14 }}>차단 임계치</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>신규 주문 차단 + Slack 경고</div>
          </div>
          <PctInput value={safety?.volGuardBlockPct ?? -4} onChange={v => update({ volGuardBlockPct: v })} />
        </div>

        {/* Panic */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', opacity: safety?.volGuardEnabled ? 1 : 0.4 }}>
          <div>
            <div style={{ fontSize: 14 }}>패닉 임계치</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>패닉 청산 권고 + Slack 긴급 알림</div>
          </div>
          <PctInput value={safety?.volGuardPanicPct ?? -7} onChange={v => update({ volGuardPanicPct: v })} />
        </div>
      </div>

      {/* Strategy settings */}
      <SectionHeader title="전략 설정" />
      <div style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>

        {/* Universe toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 14 }}>동적 종목 선별 (Universe)</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {safety?.universeEnabled
                ? '거래대금 상위 20개 중 전략별 최적 3종목 자동 선별'
                : '전략에 하드코딩된 종목 사용 (BTC, ETH)'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: safety?.universeEnabled ? 'var(--ok)' : 'var(--muted)' }}>
              {safety?.universeEnabled ? 'ON' : 'OFF'}
            </span>
            <Toggle
              checked={safety?.universeEnabled ?? false}
              onChange={v => update({ universeEnabled: v })}
            />
          </div>
        </div>

        {/* Analyst toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 14 }}>분석가 (Analyst)</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {safety?.analystEnabled ? '시그널 생성 및 전략 실행 활성화' : 'OFF — 전략 메뉴 실행 차단'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: safety?.analystEnabled ? 'var(--ok)' : 'var(--muted)' }}>
              {safety?.analystEnabled ? 'ON' : 'OFF'}
            </span>
            <Toggle
              checked={safety?.analystEnabled ?? false}
              onChange={v => update({ analystEnabled: v })}
            />
          </div>
        </div>

        {/* Global interval — applies to all strategies */}
        {strategies.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <div>
              <div style={{ fontSize: 14 }}>평가 주기</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>모든 전략에 동일 적용</div>
            </div>
            <MinutesInput
              value={strategies[0].backtestIntervalM}
              onChange={v => {
                setStrategies(prev => prev.map(s => ({ ...s, backtestIntervalM: v })));
                setIsDirty(true);
              }}
            />
          </div>
        )}

      </div>

      {/* Warning when 실거래 여부 = ON (DRY_RUN OFF) */}
      {!safety?.dryRun && (
        <div style={{ background: 'rgba(239,68,68,.1)', borderRadius: 12, padding: '12px 16px', border: '1px solid rgba(239,68,68,.3)', fontSize: 13, color: 'var(--down)', lineHeight: 1.7 }}>
          ⚠ 실거래 모드가 ON입니다. 전략 실행 시 실제 KIS API로 주문이 전송됩니다.
        </div>
      )}

      {/* AI 제공자 (LLM) */}
      <SectionHeader title="AI 제공자 (LLM)" />
      <LlmProviderSection />

      {/* 거래소 계정 (KIS — 등록·수정 통합) */}
      <SectionHeader title="거래소 계정" />
      <ExchangeAccountSection />

      {/* 알람 (채널 선택 + 연동 정보) */}
      <SectionHeader title="알람" />
      <NotifyChannelSection />

      {/* 시그널 알람 on/off */}
      <div style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 14 }}>자동 제출 알람</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>시그널 자동 주문 체결 시 알람 발송</div>
          </div>
          <Toggle checked={notifySignal.autoSubmit} onChange={v => { setNotifySignal(s => ({ ...s, autoSubmit: v })); setIsDirty(true); }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px' }}>
          <div>
            <div style={{ fontSize: 14 }}>승인 요청 알람</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>수동 승인 필요 시그널 발생 시 알람 발송</div>
          </div>
          <Toggle checked={notifySignal.pending} onChange={v => { setNotifySignal(s => ({ ...s, pending: v })); setIsDirty(true); }} />
        </div>
      </div>

      {/* 정기 거래 리포트 */}
      {report && (
        <>
          <SectionHeader title="정기 거래 리포트" />
          <div style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontSize: 14 }}>리포트 수신 활성화</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>분석 기간 거래·잔액 변동 자동 발송</div>
              </div>
              <Toggle checked={report.enabled} onChange={v => updateReport({ enabled: v })} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 14 }}>수신 채널</div>
              <select
                value={report.channel}
                onChange={e => updateReport({ channel: e.target.value as ReportData['channel'] })}
                style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', color: 'var(--text)', fontSize: 14 }}
              >
                <option value="slack">Slack</option>
                <option value="telegram">Telegram</option>
                <option value="both">둘 다</option>
                <option value="none">없음</option>
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 14 }}>발송 방식</div>
              <div style={{ display: 'flex', gap: 4, background: 'var(--bg3)', borderRadius: 8, padding: 2 }}>
                {(['rolling', 'fixed'] as const).map(m => {
                  const active = report.mode === m;
                  return (
                    <button
                      key={m}
                      onClick={() => updateReport({ mode: m })}
                      style={{
                        fontSize: 13, padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                        background: active ? 'var(--accent)' : 'transparent',
                        color: active ? '#fff' : 'var(--text)',
                        fontWeight: active ? 700 : 400,
                      }}
                    >
                      {m === 'rolling' ? '주기' : '고정'}
                    </button>
                  );
                })}
              </div>
            </div>

            {report.mode === 'rolling' ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px' }}>
                <div style={{ fontSize: 14 }}>발송 간격</div>
                <select
                  value={report.intervalMin}
                  onChange={e => updateReport({ intervalMin: Number(e.target.value) })}
                  style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', color: 'var(--text)', fontSize: 14 }}
                >
                  <option value={60}>1시간</option>
                  <option value={180}>3시간</option>
                  <option value={360}>6시간</option>
                  <option value={720}>12시간</option>
                  <option value={1440}>24시간</option>
                </select>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px' }}>
                <div>
                  <div style={{ fontSize: 14 }}>고정 발송 시각 <span style={{ color: 'var(--down)' }}>*</span></div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>KST HH:MM — 콤마로 여러 시각 (예: 08:00, 17:00)</div>
                </div>
                <input
                  type="text"
                  value={report.anchorKst ?? ''}
                  placeholder="08:00, 17:00"
                  onChange={e => updateReport({ anchorKst: e.target.value })}
                  onBlur={e => {
                    const v = e.target.value.trim();
                    updateReport({ anchorKst: v || '08:00' });
                  }}
                  style={{
                    background: 'var(--bg3)',
                    border: `1px solid ${report.anchorKst?.trim() ? 'var(--border)' : 'var(--down)'}`,
                    borderRadius: 6, padding: '6px 8px', color: 'var(--text)', fontSize: 14, width: 160, textAlign: 'right',
                  }}
                />
              </div>
            )}
          </div>
        </>
      )}

      <div style={{ background: 'var(--bg2)', borderRadius: 12, padding: 14, border: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
        실거래 여부 / KILL_SWITCH / 주문 한도는 DB에 저장되어 서버 재시작 없이 즉시 반영됩니다.
        거래소 API 키·알람 자격은 위 카드에서 등록·수정 시 평문으로 DB에 저장되며 즉시 반영됩니다.
      </div>

      <div style={{ height: 16 }} />
    </div>
  );
}

function MinutesInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');

  const start = () => { setDraft(String(value)); setEditing(true); };
  const commit = () => {
    const n = Number(draft);
    if (!isNaN(n) && n >= 1 && n <= 10080) onChange(n);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        style={{
          width: 72, textAlign: 'right', fontSize: 14, fontWeight: 600,
          background: 'var(--bg3)', border: '1px solid var(--accent)',
          borderRadius: 8, padding: '4px 8px', color: 'var(--text)',
          outline: 'none',
        }}
      />
    );
  }

  return (
    <button
      onClick={start}
      style={{
        fontSize: 14, fontWeight: 600, color: 'var(--accent)',
        background: 'none', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 4,
      }}
    >
      {value}분 <span style={{ color: 'var(--muted)', fontSize: 12 }}>›</span>
    </button>
  );
}

function SymbolEditor({ symbols, onChange, label = '차단 심볼', chipColor = 'rgba(34,197,94,.15)', chipBorder = 'rgba(34,197,94,.3)', marketFilter }: { symbols: string[]; onChange: (v: string[]) => void; label?: string; placeholder?: string; chipColor?: string; chipBorder?: string; marketFilter?: 'domestic' | 'overseas' }) {
  const [available, setAvailable]     = useState<string[]>([]);
  const [meta, setMeta]               = useState<Record<string, string>>({});
  const [loadingList, setLoadingList] = useState(false);
  const [query, setQuery]             = useState('');
  const [focused, setFocused]         = useState(false);
  const [dropStyle, setDropStyle]     = useState<React.CSSProperties>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoadingList(true);
    fetch('/api/ticker/all')
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setAvailable(d.symbols ?? []);
          setMeta(d.meta ?? {});
        }
      })
      .finally(() => setLoadingList(false));
  }, []);

  const display = (sym: string): string => {
    const name = meta[sym];
    const short = sym.includes(':') ? sym.slice(sym.indexOf(':') + 1) : sym;
    if (name && name !== sym && name !== short) return `${name} (${short})`;
    return short;
  };

  const positionDropdown = () => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setDropStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
      background: 'var(--bg2)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      maxHeight: Math.min(260, window.innerHeight - rect.bottom - 16),
      overflowY: 'auto',
      boxShadow: '0 4px 20px rgba(0,0,0,.5)',
    });
  };

  const toggle = (sym: string) => {
    if (symbols.includes(sym)) onChange(symbols.filter(s => s !== sym));
    else onChange([...symbols, sym]);
  };

  const q = query.trim().toLowerCase();
  const isOverseas = (s: string) => s.includes(':');
  const marketScoped = available.filter(s =>
    marketFilter === 'overseas' ? isOverseas(s) :
    marketFilter === 'domestic' ? !isOverseas(s) : true
  );
  const unselected = marketScoped.filter(s => !symbols.includes(s));
  const filtered = q
    ? unselected.filter(s => s.toLowerCase().includes(q) || (meta[s] ?? '').toLowerCase().includes(q))
    : unselected;
  const visible = filtered.slice(0, 50);
  const open = focused;

  return (
    <div style={{ padding: '12px 16px' }}>
      <div style={{ fontSize: 14, marginBottom: 8 }}>{label}</div>

      {/* Selected chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {symbols.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>등록된 차단 심볼 없음</span>
        )}
        {symbols.map(s => (
          <span key={s} style={{
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 12, padding: '3px 10px', borderRadius: 10,
            background: chipColor, border: `1px solid ${chipBorder}`, color: 'var(--text)',
          }}>
            {display(s)}
            <button
              onClick={() => toggle(s)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 14, lineHeight: 1, padding: 0 }}
            >×</button>
          </span>
        ))}
      </div>

      {/* Search input */}
      <input
        ref={inputRef}
        value={query}
        onChange={e => setQuery(e.target.value)}
        onFocus={() => { positionDropdown(); setFocused(true); }}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder={loadingList ? '종목 목록 불러오는 중…' : '종목명 또는 코드로 검색'}
        style={{
          width: '100%', fontSize: 13, padding: '7px 12px',
          background: 'var(--bg3)', border: '1px solid var(--border2)',
          borderRadius: 8, color: 'var(--text)', outline: 'none',
        }}
      />

      {open && !loadingList && (
        <div style={dropStyle}>
          {visible.length === 0 && (
            <div style={{ padding: '12px 16px', fontSize: 13, color: 'var(--muted)' }}>
              {q ? '일치하는 종목 없음' : '추가할 종목 없음'}
            </div>
          )}
          {visible.map(s => (
            <button
              key={s}
              onMouseDown={e => e.preventDefault()}
              onClick={() => { toggle(s); setQuery(''); }}
              style={{
                width: '100%', textAlign: 'left', padding: '10px 16px', fontSize: 13,
                background: 'none', border: 'none', borderBottom: '1px solid var(--border)',
                color: 'var(--text)', cursor: 'pointer',
              }}
            >
              {display(s)}
            </button>
          ))}
          {filtered.length > visible.length && (
            <div style={{ padding: '8px 16px', fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>
              {filtered.length - visible.length}개 더 — 검색어를 좁혀주세요
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LimitInput({ value, onChange, allowZero, suffix }: { value: number; onChange: (v: number) => void; allowZero?: boolean; suffix?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');

  const start = () => { setDraft(String(value)); setEditing(true); };
  const commit = () => {
    const n = Number(draft.replace(/,/g, ''));
    if (!isNaN(n) && (allowZero ? n >= 0 : n > 0)) onChange(n);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        style={{
          width: 100, textAlign: 'right', fontSize: 14, fontWeight: 600,
          background: 'var(--bg3)', border: '1px solid var(--accent)',
          borderRadius: 8, padding: '4px 8px', color: 'var(--text)',
          outline: 'none',
        }}
      />
    );
  }

  return (
    <button
      onClick={start}
      style={{
        fontSize: 14, fontWeight: 600, color: 'var(--accent)',
        background: 'none', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 4,
      }}
    >
      {allowZero && value === 0
        ? (suffix === '%' ? '미적용' : '무제한')
        : suffix ? `${value}${suffix}` : `₩${fmtNum(value)}`}
      <span style={{ color: 'var(--muted)', fontSize: 12 }}>›</span>
    </button>
  );
}

function PctInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');

  const start = () => { setDraft(String(value)); setEditing(true); };
  const commit = () => {
    const n = Number(draft);
    if (!isNaN(n) && n <= 0 && n >= -100) onChange(n);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        style={{
          width: 72, textAlign: 'right', fontSize: 14, fontWeight: 600,
          background: 'var(--bg3)', border: '1px solid var(--accent)',
          borderRadius: 8, padding: '4px 8px', color: 'var(--text)',
          outline: 'none',
        }}
      />
    );
  }

  return (
    <button
      onClick={start}
      style={{
        fontSize: 14, fontWeight: 600, color: 'var(--down)',
        background: 'none', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 4,
      }}
    >
      {value}% <span style={{ color: 'var(--muted)', fontSize: 12 }}>›</span>
    </button>
  );
}

