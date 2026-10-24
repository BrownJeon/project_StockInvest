'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { fmtNum } from '@/lib/format';
import { requestJson, type RequestFailure } from '@/lib/http';
import { LlmProviderSection } from './LlmProviderSection';
import { ExchangeAccountSection } from './ExchangeAccountSection';
import { NotifyChannelSection } from './NotifyChannelSection';
import { RiskPolicySummaryRow } from './RiskPolicySummaryRow';
import { CashLedgerSummaryRow } from './CashLedgerSummaryRow';
import { EnforcedStrip } from '@/components/risk/EnforcedStrip';

interface StrategyItem {
  id: string;
  enabled: boolean;
  backtestIntervalM: number;
  nextBacktestAt: string | null;
}

interface SafetyData {
  dryRun: boolean; killSwitch: boolean;
  /** 자동 청산(하드손절·EOD손절·트레일링·목표익절) 마스터 스위치 */
  exitEngineEnabled: boolean;
  /** 마스터 ON 일 때의 하위 hard_stop 스위치 (읽기 전용) */
  exitHardStopEnabled: boolean;
  /** 값을 어디서 읽었는가 — config / absent / unparsable / db_error */
  exitSwitchSource: 'config' | 'absent' | 'unparsable' | 'db_error';
  exitSwitchSummary: string;
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
  entry: boolean;
  manual: boolean;
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

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

type SaveFailure = RequestFailure;

/**
 * 설정 저장 요청 1건.
 *
 * 기존 `handleSave` 는 fetch 의 네트워크 예외만 잡고 **HTTP 4xx/5xx 를 성공으로 취급**해
 * 거부된 저장에도 "저장됨 ✓" 를 표시했다. `/api/settings/strategies` 는 이미
 * `backtestIntervalM` 범위 위반을 400 으로 거절하고 있었으므로 이는 잠재 결함이 아니라
 * 실제로 살아있던 false-success 다.
 *
 * 판정은 `requestJson`(res.ok + 본문 ok 둘 다 검사)에 위임하고, 여기서는
 * 저장 호출부가 쓰기 좋은 형태(실패면 사유, 성공이면 null)로만 바꾼다.
 */
/**
 * 낙관적 토글(DRY_RUN·KILL_SWITCH) 저장 실패 후 화면에 적용할 상태.
 *
 * 되돌리는 값의 우선순위 — 서버 재조회 값이 있으면 **그것이 진실이다**.
 * 네트워크 오류였다면 요청이 실제로는 서버에 닿아 적용됐을 수도 있어,
 * 직전 값으로 되돌리는 것이 오히려 거짓이 될 수 있다.
 * 재조회까지 실패했을 때만 낙관적 변경을 직전 값으로 복원한다.
 *
 * 되돌리는 **범위는 이번 토글이 건드린 키뿐**이다. 서버 전체 객체로 덮으면 같은 폼의
 * 다른 미저장 편집(주문 한도 %·vol guard 임계·차단 종목 등 10여 개 필드)이 경고 없이
 * 사라진다. 화면이 거짓을 말하진 않지만, 모바일 네트워크가 한 번 끊기는 것만으로
 * 사용자 입력이 날아가는 별개의 사고다. 미저장 편집이 있는 필드는 사용자의 값을
 * 그대로 두는 것이 맞다 — 그것이 "미저장 편집"의 의미다.
 */
export function revertSafetyState(
  current: SafetyData | null,
  previous: Partial<SafetyData>,
  serverSafety?: SafetyData | null,
): SafetyData | null {
  // 로컬 상태가 없으면(초기 로드 실패) 보존할 편집분도 없다 — 서버 값을 그대로 채택.
  if (!current) return serverSafety ?? null;

  const restored: Partial<SafetyData> = {};
  for (const key of Object.keys(previous) as (keyof SafetyData)[]) {
    (restored as Record<string, unknown>)[key] = serverSafety ? serverSafety[key] : previous[key];
  }
  return { ...current, ...restored };
}

export async function patchSetting(url: string, body: unknown): Promise<SaveFailure | null> {
  const r = await requestJson(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.ok ? null : r.failure;
}

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
  const [notifySignal, setNotifySignal]   = useState<NotifySignalData>({ autoSubmit: true, pending: true, entry: true, manual: true });
  const [report, setReport]               = useState<ReportData | null>(null);
  const [exchanges, setExchanges]         = useState<ExchangeData | null>(null);
  const [strategies, setStrategies]       = useState<StrategyItem[]>([]);
  const [loading, setLoading]             = useState(true);
  const [saveState, setSaveState]         = useState<SaveState>('idle');
  const [saveError, setSaveError]         = useState<string | null>(null);
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

  /**
   * DRY_RUN·KILL_SWITCH 즉시 저장 — **낙관적 UI** 라 실패 처리가 특히 중요하다.
   *
   * 기존 구현은 응답을 전혀 보지 않고 실패를 삼켰다. 그래서 사용자가 KILL_SWITCH 를 켜고
   * 요청이 실패해도 토글은 켜진 채로 남아, **매매가 멈춘 줄 알고 자리를 뜨는** 상태가 됐다.
   * 실거래 시스템에서 이건 "리포트가 전송을 거짓 보고"보다 위험하다.
   *
   * 따라서 알리는 것만으로 끝내지 않고 **컨트롤을 서버 실제 상태로 되돌린다**:
   *  1순위 재조회(GET) — 네트워크 오류였다면 요청이 서버에 닿았을 수도 있어 실제 값 확인이 유일한 정답
   *  2순위 직전 값 복원 — 재조회마저 실패했을 때의 폴백
   */
  const autoSave = useCallback(async (
    delta: Partial<SafetyData>,
    previous: Partial<SafetyData>,
    label: string,
  ) => {
    const failure = await patchSetting('/api/settings/safety', delta);
    if (!failure) return;

    const reread = await requestJson<{ safety?: SafetyData }>('/api/settings/safety', { cache: 'no-store' });
    const serverSafety = reread.ok ? (reread.data?.safety ?? null) : null;
    const fromServer = serverSafety !== null;
    setSafety(current => revertSafetyState(current, previous, serverSafety));

    setSaveError(
      `${label} 전환이 저장되지 않았습니다 — ${failure.message} ` +
      (fromServer
        ? `${label} 은 서버의 실제 상태로 되돌렸습니다 (다른 미저장 편집은 그대로 둡니다).`
        : `${label} 을 직전 값으로 되돌렸습니다 — 서버 상태를 확인하지 못했으니 새로고침으로 확인하세요.`),
    );
    setSaveState('error');
  }, []);

  const updateReport = (delta: Partial<ReportData>) => {
    setReport(prev => prev ? { ...prev, ...delta } : prev);
    setIsDirty(true);
  };

  const handleSave = useCallback(async () => {
    if (!safety) return;
    setSaveState('saving');
    setSaveError(null);
    try {
      const results = await Promise.all([
        patchSetting('/api/settings/safety', {
          ...safety,
          notifySignalAutoSubmit: notifySignal.autoSubmit,
          notifySignalPending:    notifySignal.pending,
          notifySignalEntry:      notifySignal.entry,
          notifySignalManual:     notifySignal.manual,
          ...(report ? {
            reportEnabled:     report.enabled,
            reportChannel:     report.channel,
            reportMode:        report.mode,
            reportIntervalMin: report.intervalMin,
            reportAnchorKst:   report.anchorKst,
          } : {}),
        }),
        ...strategies.map(s =>
          patchSetting('/api/settings/strategies', {
            id: s.id, enabled: s.enabled, backtestIntervalM: s.backtestIntervalM,
          })
        ),
      ]);

      const failures = results.filter((r): r is SaveFailure => r !== null);
      if (failures.length > 0) {
        // 거부 사유(사용자가 고칠 수 있는 정보)를 네트워크 오류보다 우선 노출한다.
        const primary = failures.find(f => f.kind === 'rejected') ?? failures[0];
        const extra = failures.length > 1 ? ` (외 ${failures.length - 1}건 실패)` : '';
        setSaveError(primary.message + extra);
        setSaveState('error');
        return;   // isDirty 유지 — 저장 버튼이 남아 바로 재시도할 수 있다
      }

      setSaveState('saved');
      setIsDirty(false);
      setTimeout(() => setSaveState('idle'), 2000);
    } catch (e) {
      // patchSetting 은 던지지 않지만, 예기치 못한 예외로 '저장 중…'에 갇혀
      // 버튼이 영구 비활성되는 것을 막는다.
      setSaveError(e instanceof Error ? e.message : String(e));
      setSaveState('error');
    }
  }, [safety, notifySignal, report, strategies]);

  if (loading) return <div style={{ textAlign: 'center', padding: 48, color: 'var(--muted)' }}>불러오는 중…</div>;

  return (
    <div style={{ overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Save bar */}
      {(isDirty || saveState !== 'idle') && (
        <div style={{
          position: 'sticky', top: 0, zIndex: 20,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          padding: '10px 14px', borderRadius: 10, marginBottom: 4,
          background: saveState === 'error' ? 'rgba(239,68,68,.12)' : isDirty ? 'rgba(251,191,36,.12)' : 'rgba(34,197,94,.1)',
          border: `1px solid ${saveState === 'error' ? 'rgba(239,68,68,.45)' : isDirty ? 'rgba(251,191,36,.4)' : 'rgba(34,197,94,.3)'}`,
        }}>
          {/* 저장 실패는 사용자가 값을 고쳐야 풀리므로 자동 소멸하는 토스트가 아니라
              재시도 버튼 옆 sticky 바에 계속 남긴다 (minWidth:0 — 긴 사유도 줄바꿈으로 수용) */}
          <span
            role={saveState === 'error' ? 'alert' : undefined}
            style={{
              fontSize: 12, fontWeight: 600, minWidth: 0, flex: 1, wordBreak: 'break-word',
              color: saveState === 'error' ? '#ef4444' : isDirty ? 'var(--accent)' : 'var(--ok)',
            }}
          >
            {saveState === 'saving' ? '저장 중…'
              : saveState === 'saved' ? '저장됨 ✓'
              : saveState === 'error' ? `저장 실패 — ${saveError ?? '알 수 없는 오류'}`
              : '변경 사항 있음'}
          </span>
          {isDirty && (
            <button
              onClick={handleSave}
              disabled={saveState === 'saving'}
              style={{
                flexShrink: 0,
                padding: '6px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                background: 'var(--accent)', color: '#000', border: 'none', cursor: 'pointer',
                opacity: saveState === 'saving' ? 0.6 : 1,
              }}
            >
              {saveState === 'error' ? '다시 시도' : '저장'}
            </button>
          )}
        </div>
      )}

      {/* 내 계정 — 회원별 화면(T-008). 이 페이지의 안전장치는 **서버 공용** 값이고,
          /profile 의 안전장치는 회원별 값이다(Step 4 전까지 엔진 미배선). */}
      <SectionHeader title="내 계정" />
      <Link
        href="/profile"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          minHeight: 56, padding: '12px 16px', marginBottom: 16,
          background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)',
        }}
      >
        <div>
          <div style={{ fontSize: 14 }}>내 계정 · 증권계좌 연결</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            비밀번호 변경 · KIS 키 연결 · 회원별 매매 설정
          </div>
        </div>
        <span style={{ fontSize: 18, color: 'var(--muted)' }} aria-hidden>›</span>
      </Link>

      {/* T-074 자산 기록 — 입출금 기록 요약 행. 기록·계산 전용(주문·계좌 이동 없음), 자체 조회라 이 페이지 저장 바와 무관 */}
      <SectionHeader title="자산 기록" />
      <CashLedgerSummaryRow />

      {/* 승인 방식 — 두 상태 모두 "사람 승인 후 주문"이다 (자율성과 무관) */}
      <SectionHeader title="승인 방식" />
      <div style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px' }}>
          <div>
            <div style={{ fontSize: 14 }}>승인 후 진입 감시 (하이브리드)</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {hybridMode
                ? 'ON — 승인하면 즉시 주문하지 않고, 지정한 진입 구간에 도달할 때 체결'
                : 'OFF — 승인하면 즉시 주문'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              ON 시 추천(💡) 탭에서 진입가·수량을 편집한 뒤 감시를 시작할 수 있습니다.
            </div>
            {/*
              이 스위치가 자동매매 스위치로 오인되면 안 된다.
              ⚠️ 단, "모든 주문에 승인이 필요하다"고 쓰면 **거짓**이다 — routeSignal 은
                 hard_stop·eod_loss_cut 청산을 모드와 무관하게 무조건 자동 제출한다.
                 UI 의 거짓 안전 보장은 모호한 문구보다 나쁘므로 예외를 눈에 띄게 명시한다.
            */}
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>
              ℹ️ 이 설정은 <b>승인한 주문을 언제 넣을지</b>만 정합니다. 어느 쪽이든{' '}
              <b>신규 진입(매수) 주문은 사람이 승인해야 나갑니다.</b> 승인 없이 신규 진입을
              자동 주문하는 동작은 이 스위치로는 절대 켜지지 않고, 별도의 자동조종 설정
              (<code>autopilot_mode</code>)에서만 켤 수 있습니다.
            </div>
            {/*
              🔕 T-015 — 이 안내는 **자동 청산 엔진이 켜져 있을 때만 참**이다.
                 꺼진 상태에서 "손절은 승인 없이 즉시 나갑니다"를 계속 보여주면 UI 가
                 사용자에게 있지도 않은 보호막을 약속하게 된다. 상태에 따라 문구를 바꾼다.
            */}
            {safety && !safety.exitEngineEnabled ? (
              <div style={{
                fontSize: 11, color: '#fca5a5', marginTop: 6, lineHeight: 1.5,
                background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.45)',
                borderRadius: 8, padding: '8px 10px',
              }}>
                🔕 <b>현재 자동 청산 엔진이 꺼져 있습니다 — 손절도 자동으로 나가지 않습니다.</b><br />
                하드 손절·장마감 손실 차단·트레일링 스탑·목표 익절 <b>네 가지 모두</b> 주문이
                만들어지지 않습니다. 아래 <b>안전장치 (공통) &gt; 자동 청산 엔진</b>에서 다시 켤 수 있습니다.
              </div>
            ) : (
              <div style={{
                fontSize: 11, color: '#f59e0b', marginTop: 6, lineHeight: 1.5,
                background: 'rgba(245,158,11,.10)', border: '1px solid rgba(245,158,11,.35)',
                borderRadius: 8, padding: '8px 10px',
              }}>
                ⚠️ <b>예외 — 보유 종목 보호 청산은 승인 없이 즉시 주문됩니다.</b><br />
                하드 손절과 장마감 손실 차단 매도는 <b>이 설정·자동조종 모드와 무관하게</b> 자동
                제출됩니다. 손실이 커지는 것을 막는 기능이라 사람의 응답을 기다리지 않습니다.
                (목표 익절·트레일링 스탑 매도는 일반 승인 경로를 따릅니다.)
              </div>
            )}
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

        {/* T-066 — 이 카드는 실제 주문에 적용된다(집행 중). 아래 '리스크 정책' 행은 표시·위험 계산·알림(주문·매도 없음)이라 구분한다. */}
        <EnforcedStrip />

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
              onChange={v => {
                const prev = safety?.dryRun ?? true;
                update({ dryRun: !v });
                autoSave({ dryRun: !v }, { dryRun: prev }, 'DRY_RUN');
              }}
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
              onChange={v => {
                const prev = safety?.killSwitch ?? false;
                update({ killSwitch: v });
                autoSave({ killSwitch: v }, { killSwitch: prev }, 'KILL_SWITCH');
              }}
              danger
            />
          </div>
        </div>

        {/* 🔕 자동 청산 엔진 마스터 스위치 (T-015) —
            OFF 상태를 오해할 수 없게 만드는 것이 이 블록의 전부다. */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14 }}>자동 청산 엔진</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                {safety?.exitEngineEnabled
                  ? `ON — 하드손절·EOD손절·트레일링스탑·목표익절 자동 매도 동작 중${safety?.exitHardStopEnabled === false ? ' (하드손절만 개별 OFF)' : ''}`
                  : 'OFF — 자동 손절·익절 매도 주문을 내지 않습니다'}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: safety?.exitEngineEnabled ? 'var(--ok)' : '#ef4444' }}>
                {safety?.exitEngineEnabled ? 'ON' : 'OFF'}
              </span>
              <Toggle
                checked={safety?.exitEngineEnabled ?? false}
                onChange={v => {
                  const prev = safety?.exitEngineEnabled ?? false;
                  update({ exitEngineEnabled: v });
                  autoSave({ exitEngineEnabled: v }, { exitEngineEnabled: prev }, '자동 청산 엔진');
                }}
              />
            </div>
          </div>

          {/* OFF 이면 사실을 크게 말한다 — "손절이 지켜주고 있다"는 오해가 유일한 치명적 실패다 */}
          {safety && !safety.exitEngineEnabled && (
            <div style={{
              marginTop: 10, padding: '10px 12px', borderRadius: 8,
              background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.45)',
              fontSize: 12, color: '#fca5a5', lineHeight: 1.7,
            }}>
              🔕 <b>손절이 자동으로 걸리지 않습니다.</b><br />
              보유 종목이 얼마나 떨어져도 시스템은 <b>스스로 팔지 않습니다.</b> 하드 손절,
              장마감 손실 차단, 트레일링 스탑, 목표 익절 <b>네 가지 모두</b> 시그널조차 만들지
              않습니다. 청산이 필요하면 <b>직접 주문</b>하세요.<br />
              <span style={{ color: 'var(--muted)' }}>
                진입가·고점(peak) 추적은 계속되므로 다시 켜면 올바른 트레일링 기준으로 재개됩니다.
                매수 시그널과 승인 대기 큐는 영향받지 않습니다.
              </span>
              {safety.exitSwitchSource !== 'config' && (
                <>
                  <br />
                  <span style={{ color: '#fbbf24' }}>
                    ⚠️ 설정 값을 정상적으로 읽지 못해 안전 방향(OFF)으로 처리했습니다 — {safety.exitSwitchSummary}
                  </span>
                </>
              )}
            </div>
          )}
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

      {/* T-066 리스크 정책 요약 — 값 변경은 /settings/risk-policy 에서만 (자체 조회·자체 저장, 이 페이지 저장 바와 무관) */}
      <RiskPolicySummaryRow />

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
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>전략 엔진이 시그널을 자동 주문 체결 시 발송</div>
          </div>
          <Toggle checked={notifySignal.autoSubmit} onChange={v => { setNotifySignal(s => ({ ...s, autoSubmit: v })); setIsDirty(true); }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 14 }}>승인 요청 알람</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>수동 승인 대기 시그널 생성 시 발송</div>
          </div>
          <Toggle checked={notifySignal.pending} onChange={v => { setNotifySignal(s => ({ ...s, pending: v })); setIsDirty(true); }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 14 }}>진입 감시 발동 알람</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>진입 구간 도달 → 자동 주문 실행 시 발송</div>
          </div>
          <Toggle checked={notifySignal.entry} onChange={v => { setNotifySignal(s => ({ ...s, entry: v })); setIsDirty(true); }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px' }}>
          <div>
            <div style={{ fontSize: 14 }}>수동 시나리오 등록 알람</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>내 시나리오 만들기 등록 완료 시 발송</div>
          </div>
          <Toggle checked={notifySignal.manual} onChange={v => { setNotifySignal(s => ({ ...s, manual: v })); setIsDirty(true); }} />
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

