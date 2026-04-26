'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fmtNum } from '@/lib/format';
import { LlmProviderSection } from './LlmProviderSection';

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

type AnalystStyle = 'aggressive' | 'neutral' | 'stable';

const STYLE_INFO: Record<AnalystStyle, { icon: string; label: string; rsi: string; cooldown: string; minProfit: string; coins: string }> = {
  aggressive: { icon: '🔥', label: '공격적', rsi: 'RSI < 40 / > 60', cooldown: '15분',  minProfit: '0.15%', coins: '5억↑ top 40' },
  neutral:    { icon: '⚖️', label: '중립적', rsi: 'RSI < 35 / > 65', cooldown: '30분',  minProfit: '0.25%', coins: '10억↑ top 30' },
  stable:     { icon: '🛡️', label: '안정적', rsi: 'RSI < 28 / > 72', cooldown: '60분',  minProfit: '0.40%', coins: '30억↑ top 15' },
};

export function SettingsPage() {
  const [safety, setSafety]               = useState<SafetyData | null>(null);
  const [exchanges, setExchanges]         = useState<ExchangeData | null>(null);
  const [strategies, setStrategies]       = useState<StrategyItem[]>([]);
  const [analystStyle, setAnalystStyle]   = useState<AnalystStyle>('neutral');
  const [loading, setLoading]             = useState(true);
  const [saveState, setSaveState]         = useState<SaveState>('idle');
  const [isDirty, setIsDirty]             = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/settings/safety').then(r => r.json()),
      fetch('/api/settings/strategies').then(r => r.json()),
    ]).then(([safetyData, stratData]) => {
      if (safetyData.ok) { setSafety(safetyData.safety); setExchanges(safetyData.exchanges); }
      if (stratData.ok) {
        setStrategies(stratData.strategies);
        if (stratData.analystStyle) setAnalystStyle(stratData.analystStyle as AnalystStyle);
      }
    }).finally(() => setLoading(false));
  }, []);

  const patchStrategy = useCallback((id: string, delta: { backtestIntervalM?: number; enabled?: boolean }) => {
    setStrategies(prev => prev.map(s => s.id === id ? { ...s, ...delta } : s));
    setIsDirty(true);
  }, []);

  const update = (delta: Partial<SafetyData>) => {
    setSafety(prev => prev ? { ...prev, ...delta } : prev);
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
          body: JSON.stringify(safety),
        }),
        fetch('/api/settings/strategies', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ analystStyle }),
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
  }, [safety, strategies, analystStyle]);

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
              onChange={v => update({ dryRun: !v })}
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
              onChange={v => update({ killSwitch: v })}
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

        <SymbolEditor
          symbols={safety?.blockedSymbols ?? []}
          onChange={v => update({ blockedSymbols: v })}
          label="국내 차단 심볼 (블랙리스트)"
          placeholder="예: 005930"
          chipColor="rgba(239,68,68,.15)"
          chipBorder="rgba(239,68,68,.3)"
        />

        <SymbolEditor
          symbols={safety?.blockedSymbolsOverseas ?? []}
          onChange={v => update({ blockedSymbolsOverseas: v })}
          label="해외 차단 심볼 (블랙리스트)"
          placeholder="예: NAS:AAPL"
          chipColor="rgba(239,68,68,.15)"
          chipBorder="rgba(239,68,68,.3)"
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

      {/* Analyst Style */}
      <SectionHeader title="투자 성향" />
      <div style={{ display: 'flex', gap: 8 }}>
        {(Object.keys(STYLE_INFO) as AnalystStyle[]).map(key => {
          const info = STYLE_INFO[key];
          const active = analystStyle === key;
          return (
            <button
              key={key}
              onClick={() => { setAnalystStyle(key); setIsDirty(true); }}
              style={{
                flex: 1, padding: '12px 8px', borderRadius: 12, cursor: 'pointer',
                border: `2px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                background: active ? 'rgba(251,191,36,.1)' : 'var(--bg2)',
                textAlign: 'center', transition: 'all .15s',
              }}
            >
              <div style={{ fontSize: 22, marginBottom: 4 }}>{info.icon}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: active ? 'var(--accent)' : 'var(--text)', marginBottom: 6 }}>{info.label}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.7 }}>
                <div>{info.rsi}</div>
                <div>쿨다운 {info.cooldown}</div>
                <div>최소익 {info.minProfit}</div>
                <div style={{ marginTop: 2, fontSize: 9 }}>{info.coins}</div>
              </div>
            </button>
          );
        })}
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

      {/* Exchange — KIS */}
      <SectionHeader title="거래소 계정" />
      <div style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>한국투자증권 (KIS)</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>국내 · 해외 주식 실매매</div>
          </div>
          <StatusBadge ok={exchanges?.kis.configured ?? false} labelOk={exchanges?.kis.mock ? '모의투자' : '실전투자'} labelNo="미설정" />
        </div>
      </div>

      <div style={{ background: 'var(--bg2)', borderRadius: 12, padding: 14, border: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
        DRY_RUN / KILL_SWITCH / 주문 한도는 DB에 저장되어 서버 재시작 없이 즉시 반영됩니다.
        거래소 API 키는 .env에서 관리 (변경 시 재시작 필요).
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

function SymbolEditor({ symbols, onChange, label = '차단 심볼', placeholder = '예: 005930', chipColor = 'rgba(34,197,94,.15)', chipBorder = 'rgba(34,197,94,.3)' }: { symbols: string[]; onChange: (v: string[]) => void; label?: string; placeholder?: string; chipColor?: string; chipBorder?: string }) {
  const [available, setAvailable]     = useState<string[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [open, setOpen]               = useState(false);
  const [dropStyle, setDropStyle]     = useState<React.CSSProperties>({});
  const btnRef = useRef<HTMLButtonElement>(null);

  const openDropdown = () => {
    if (available.length === 0 && !loadingList) {
      setLoadingList(true);
      fetch('/api/ticker/all')
        .then(r => r.json())
        .then(d => { if (d.ok) setAvailable(d.symbols); })
        .finally(() => setLoadingList(false));
    }
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
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
    }
    setOpen(v => !v);
  };

  const toggle = (sym: string) => {
    if (symbols.includes(sym)) onChange(symbols.filter(s => s !== sym));
    else onChange([...symbols, sym]);
  };

  const unselected = available.filter(s => !symbols.includes(s));

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
            {s}
            <button
              onClick={() => toggle(s)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 14, lineHeight: 1, padding: 0 }}
            >×</button>
          </span>
        ))}
      </div>

      {/* Dropdown trigger */}
      <button
        ref={btnRef}
        onClick={openDropdown}
        style={{
          width: '100%', textAlign: 'left', fontSize: 13, padding: '7px 12px',
          background: 'var(--bg3)', border: '1px solid var(--border2)',
          borderRadius: 8, color: loadingList ? 'var(--muted)' : 'var(--text)',
          cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}
      >
        <span>{loadingList ? '종목 목록 불러오는 중…' : '종목 선택 +'}</span>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>{open ? '▲' : '▼'}</span>
      </button>

      {/* Dropdown — rendered at fixed viewport position to escape overflow:hidden */}
      {open && !loadingList && (
        <>
          {/* Backdrop to close on outside click */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
            onClick={() => setOpen(false)}
          />
          <div style={dropStyle}>
            {unselected.length === 0 && (
              <div style={{ padding: '12px 16px', fontSize: 13, color: 'var(--muted)' }}>추가할 심볼 없음</div>
            )}
            {unselected.map(s => (
              <button
                key={s}
                onClick={() => { toggle(s); setOpen(false); }}
                style={{
                  width: '100%', textAlign: 'left', padding: '10px 16px', fontSize: 13,
                  background: 'none', border: 'none', borderBottom: '1px solid var(--border)',
                  color: 'var(--text)', cursor: 'pointer',
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </>
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

