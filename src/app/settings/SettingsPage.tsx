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
import { OverseasUniverseSummaryRow } from './OverseasUniverseSummaryRow';
import { AppSection } from './AppSection';
import { EnforcedStrip } from '@/components/risk/EnforcedStrip';
import { liveTradingFromDryRun, dryRunFromLiveTrading, LIVE_TRADING_LABEL } from '@/lib/safety/live-trading';
import type { AutopilotMode } from '@/lib/signals/autopilot';

/** 안전 값을 못 읽었을 때(safety 없음) — OFF·ON 어느 쪽도 단정하지 않는다(R-UI ①) */
const SAFETY_UNREAD = '값을 읽지 못했습니다 — 지금 상태를 알 수 없습니다';

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
  /** T-101 — 해외 장마감 후 분석(system_config.post_market_overseas_enabled). 엔진과 같은 판정(키 없음 = false). */
  postMarketOverseasEnabled: boolean;
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
  /** (T-143 WP-A) 해외 분석 대상 변경 알림 — 꺼도 홈 「확인 필요」 줄은 그대로 나온다(텔레그램만 멈춘다). */
  universe: boolean;
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

/**
 * `disabled`(T-108 Codex C2 high — Leader 승인): 안전 값을 못 읽은 동안 안전 토글을 잠근다. 잠긴 토글은 눌러도
 * onChange 를 부르지 않는다. disabled 가 없으면(정상 상태) 동작은 이전과 같다.
 *
 * T-130 WP1(D2-A, 데모 v1 승인) — 겉을 `div` 에서 **`<button type="button" role="switch">`** 로 바꿨다. 예전 div 는 tabIndex 가 없어
 * 실거래여부·모든거래차단이 키보드로 닿지 않았다. 이제 Tab 으로 포커스되고 Space·Enter 는 버튼 기본 동작(click)으로 같은 onClick 을 탄다
 * — 전환을 키 처리기에서 따로 하지 않는다(두 경로가 갈라지지 않게). 누르는 영역은 44×44, 그림(44×24·손잡이 20×20·색)은 안쪽 span 으로 그대로다.
 * `margin: -10px 0` 으로 행 높이는 예전과 같다.
 *  - **Enter 길게 누름(auto-repeat)만 막는다**(T-130 Reviewer F2): 네이티브 button 은 Enter 의 keypress 마다 click 이고 keypress 는 반복마다 나가므로,
 *    포커스된 안전 스위치에서 Enter 를 누르고 있으면 전환·저장 요청(autoSave)이 반복된다(예전 div 는 키보드로 닿지 않아 없던 노출).
 *    반복 keydown 만 기본 동작을 취소해 keypress→click 을 없앤다. 첫 Enter·Space 는 건드리지 않는다. Space 반복은 막지 않는다 — Space 는 keyup 에서
 *    한 번만 click 이라(누르고 있어도 1회) 반복 전환이 생기지 않고, 반복 keydown 을 취소하면 엔진에 따라 누름 상태 추적에 끼어들 수 있어 얻는 것 없이 위험만 는다.
 *  - 잠김은 예전처럼 `aria-disabled` + onClick 무시다. **`disabled` 속성은 쓰지 않는다** — 쓰면 포커스·읽기에서 빠져 잠긴 이유를 못 듣는다.
 *    안전 스위치 3개의 onChange 안 `if (!safety) return` 이중 확인은 호출부에 그대로 있다.
 *  - 행 전체를 누르게 하지 않는다(스크롤 중 실거래여부·모든거래차단 오조작 방지 — 데모 D2-A). 이 버튼 안에 다른 버튼·입력칸을 넣지 않는다.
 *  - `label` = 행 제목 그대로(스크린리더가 「실거래여부, 스위치, 꺼짐」처럼 읽는다). 포커스 링은 브라우저 기본 `:focus-visible` 을 지우지 않는다.
 */
function Toggle({ checked, onChange, danger, disabled, label, descriptionId }: { checked: boolean; onChange: (v: boolean) => void; danger?: boolean; disabled?: boolean; label: string; descriptionId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled ? true : undefined}
      aria-label={label}
      aria-describedby={descriptionId}
      onClick={() => { if (!disabled) onChange(!checked); }}
      onKeyDown={e => { if (e.key === 'Enter' && e.repeat) e.preventDefault(); }}
      style={{
        width: 44, height: 44, margin: '-10px 0', padding: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'none', border: 0, borderRadius: 8, flexShrink: 0,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <span style={{
        position: 'relative', display: 'block', width: 44, height: 24, borderRadius: 12,
        background: checked
          ? (danger ? 'var(--down)' : 'var(--ok)')
          : 'var(--bg3)',
        transition: 'background .2s',
        ...(disabled ? { opacity: 0.45 } : {}),
      }}>
        <span style={{
          position: 'absolute', top: 2, left: checked ? 22 : 2,
          width: 20, height: 20, borderRadius: '50%', background: '#fff',
          transition: 'left .2s',
        }} />
      </span>
    </button>
  );
}

const AUTOPILOT_URL = '/api/settings/safety/autopilot';

interface AutopilotSnapshot {
  ok: true;
  mode: AutopilotMode | null;
  dryRun: boolean;
  killSwitch: boolean;
}

function isAutopilotSnapshot(data: unknown): data is AutopilotSnapshot {
  if (!data || typeof data !== 'object') return false;
  const { ok, mode, dryRun, killSwitch } = data as Record<string, unknown>;
  return ok === true && (mode === null || mode === 'assist' || mode === 'auto' || mode === 'manual')
    && typeof dryRun === 'boolean' && typeof killSwitch === 'boolean';
}

async function readAutopilot() {
  const result = await requestJson(AUTOPILOT_URL, { cache: 'no-store' });
  return result.ok && isAutopilotSnapshot(result.data) ? result.data : null;
}

function tradingModeText({ dryRun, killSwitch }: AutopilotSnapshot): string {
  const trading = dryRun ? '실거래여부 OFF · 가상 주문' : '실거래여부 ON · 실제 주문 가능';
  return killSwitch ? `${trading} · 모든거래차단 ON` : trading;
}

function AutoApprovalModeRow() {
  const [snapshot, setSnapshot] = useState<AutopilotSnapshot | null>(null);
  const [confirmation, setConfirmation] = useState<AutopilotSnapshot | null>(null);
  const [pending, setPending] = useState(true);
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);

  const reload = useCallback(async (confirmAuto = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setNotice('');
    const current = await readAutopilot();
    setSnapshot(current);
    if (confirmAuto && current?.mode === 'assist') setConfirmation(current);
    inFlight.current = false;
    setPending(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (confirmation && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [confirmation]);

  async function save(mode: 'assist' | 'auto', expected: AutopilotSnapshot) {
    if (inFlight.current || !expected.mode) return;
    inFlight.current = true;
    setPending(true);
    setNotice('저장 중입니다.');
    const result = await requestJson(AUTOPILOT_URL, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, expectedMode: expected.mode, expectedDryRun: expected.dryRun, expectedKillSwitch: expected.killSwitch }),
    });
    if (result.ok && isAutopilotSnapshot(result.data) && result.data.mode === mode) {
      setSnapshot(result.data);
      setNotice(mode === 'auto' ? '자동형으로 저장했습니다.' : '승인형으로 저장했습니다. 이미 생성된 자동 시그널의 주문은 계속 처리될 수 있습니다.');
    } else {
      const current = await readAutopilot();
      setSnapshot(current);
      setNotice(current?.mode
        ? '저장 응답을 확인하지 못해 현재 모드를 다시 읽었습니다.'
        : '저장 결과를 확인하지 못했습니다. 다시 읽어 주세요.');
    }
    inFlight.current = false;
    setPending(false);
  }

  const mode = snapshot?.mode;
  const checked = mode === 'auto';
  const isToggle = mode === 'auto' || mode === 'assist';
  const modeText = checked ? '자동형 · 조건을 충족한 새 시그널은 승인 없이 제출'
    : mode === 'assist' ? '승인형 · 승인한 시그널의 주문을 제출'
    : mode === 'manual' ? '현재 수동형'
    : pending ? '자동승인모드를 읽는 중입니다.' : '현재 모드를 읽지 못했습니다.';

  return (
    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14 }}>자동승인모드</div>
          <div id="auto-approval-mode-description" style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            {modeText}
          </div>
        </div>
        {isToggle && snapshot && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: checked ? 'var(--ok)' : 'var(--muted)' }}>{checked ? 'ON' : 'OFF'}</span>
            <Toggle label="자동승인모드" descriptionId="auto-approval-mode-description" checked={checked} disabled={pending}
              onChange={enabled => { if (enabled) void reload(true); else void save('assist', snapshot); }} />
          </div>
        )}
      </div>
      {snapshot && checked && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{tradingModeText(snapshot)} · 국내·해외 공통</div>}
      {(!mode || mode === 'manual') && !pending && (
        <button type="button" style={autoApprovalButtonStyle}
          onClick={() => { if (mode === 'manual' && snapshot) void save('assist', snapshot); else void reload(); }}>
          {mode === 'manual' ? '승인형으로 변경' : '다시 읽기'}
        </button>
      )}
      {notice && <div role="status" style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{notice}</div>}
      {confirmation && (
        <dialog ref={dialog} aria-labelledby="auto-approval-confirm-title" aria-describedby="auto-approval-confirm-text"
          onClose={() => setConfirmation(null)} onCancel={() => setNotice('자동형 전환을 취소했습니다.')}
          style={{ width: 'calc(100% - 32px)', maxWidth: 420, padding: 16, borderRadius: 12, background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--muted)' }}>
          <h2 id="auto-approval-confirm-title" style={{ margin: '0 0 8px', fontSize: 17 }}>자동승인모드를 켤까요?</h2>
          <div id="auto-approval-confirm-text" style={{ fontSize: 13, lineHeight: 1.5 }}>
            국내·해외 신규 시그널이 조건을 충족하면 승인 없이 주문 단계로 넘어갑니다.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" autoFocus style={autoApprovalButtonStyle}
              onClick={() => { setNotice('자동형 전환을 취소했습니다.'); dialog.current?.close(); }}>취소</button>
            <button type="button" style={autoApprovalButtonStyle}
              onClick={() => { dialog.current?.close(); void save('auto', confirmation); }}>자동형으로 저장</button>
          </div>
        </dialog>
      )}
    </div>
  );
}

const autoApprovalButtonStyle = {
  minHeight: 44, marginTop: 8, padding: '0 12px', borderRadius: 8,
  background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', cursor: 'pointer',
};

/**
 * T-101 — 안전장치 카드의 '해외 장마감 후 분석' 행. 모양은 같은 카드의 실거래·KILL_SWITCH·자동 청산 행과 같고,
 * 저장도 그 행들처럼 토글 즉시(autoSave — 실패 시 서버 값으로 되돌림) 한다. 시험에서 행만 그려 볼 수 있게 export.
 */
export function PostMarketOverseasRow({ enabled, onToggle }: { enabled: boolean; onToggle: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14 }}>해외 장마감 후 분석 (미국 시나리오)</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
          {enabled
            ? 'ON — 미국 정규장이 열린 날의 다음 날 아침 08:00(KST)에 미국 종목 매수 시그널을 만듭니다(미국 휴장일 다음날은 건너뜀).'
            : 'OFF — 켜면 미국 정규장이 열린 날의 다음 날 아침 08:00(KST)에 미국 종목 매수 시그널을 만듭니다(미국 휴장일 다음날은 건너뜀).'}
          {' '}주문은 하지 않으며 승인·모든거래차단·검증 관문이 그대로 적용됩니다.
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: enabled ? 'var(--ok)' : 'var(--muted)' }}>
          {enabled ? 'ON' : 'OFF'}
        </span>
        <Toggle checked={enabled} onChange={onToggle} label="해외 장마감 후 분석 (미국 시나리오)" />
      </div>
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
  const [notifySignal, setNotifySignal]   = useState<NotifySignalData>({ autoSubmit: true, pending: true, entry: true, manual: true, universe: true });
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
      // T-108 — 안전 조회 실패(네트워크·JSON 아님)는 null 로 — safety 가 비어 있는 채로 남고 안전 토글은 잠긴다(아래 [다시 읽기])
      fetch('/api/settings/safety').then(r => r.json()).catch(() => null),
      // T-128 A1 — 전략 조회 실패도 null 로. 예전에는 이 요청 하나가 실패하면 Promise.all 전체가 거부돼 안전 값까지 상태에
      // 못 들어가고(토글 잠김) unhandled rejection 이 났다. 이제 전략 목록만 비고 나머지 조회 결과는 그대로 쓴다.
      fetch('/api/settings/strategies').then(r => r.json()).catch(() => null),
      fetch('/api/settings/hybrid').then(r => r.json()).catch(() => null),
    ]).then(([safetyData, stratData, hybridData]) => {
      if (safetyData?.ok) {
        setSafety(safetyData.safety);
        setExchanges(safetyData.exchanges);
        if (safetyData.notifySignal) setNotifySignal(safetyData.notifySignal as NotifySignalData);
        if (safetyData.report) setReport(safetyData.report as ReportData);
      }
      if (stratData?.ok) {
        setStrategies(stratData.strategies);
      }
      if (hybridData?.ok) {
        setHybridMode(hybridData.enabled ?? false);
      }
    }).finally(() => setLoading(false));
  }, []);

  /**
   * T-108 [다시 읽기] — 안전 값을 못 읽었을 때 안전 조회(`/api/settings/safety` GET 1회)만 다시 한다.
   * 성공하면 처음 불러올 때와 같은 칸(safety·exchanges·알림·리포트)을 채운다 — 알림·리포트를 기본값으로 둔 채
   * 저장 바가 서버 값을 기본값으로 덮어쓰지 않게. 실패하면 아무것도 바꾸지 않는다(토글은 잠긴 채).
   */
  const reloadSafety = useCallback(async () => {
    const r = await requestJson<{ safety?: SafetyData; exchanges?: ExchangeData; notifySignal?: NotifySignalData; report?: ReportData }>(
      '/api/settings/safety', { cache: 'no-store' },
    );
    if (!r.ok || !r.data?.safety) return;
    setSafety(r.data.safety);
    if (r.data.exchanges) setExchanges(r.data.exchanges);
    if (r.data.notifySignal) setNotifySignal(r.data.notifySignal);
    if (r.data.report) setReport(r.data.report);
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
        ? `${label} 값은 서버의 실제 상태로 되돌렸습니다 (다른 미저장 편집은 그대로 둡니다).`
        : `${label} 값을 직전 값으로 되돌렸습니다 — 서버 상태를 확인하지 못했으니 새로고침으로 확인하세요.`),
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
      // T-101 — 해외 장마감 후 분석 스위치는 자기 토글(autoSave)로만 저장한다. 저장 바의 일괄 저장이 다른 필드를
      // 저장하면서 이 키를 화면에 남은(오래됐을 수 있는) 값으로 덮어쓰지 않게 뺀다.
      const { postMarketOverseasEnabled: _postMarketOverseasOwnToggle, ...safetyForBulkSave } = safety;
      void _postMarketOverseasOwnToggle;
      const results = await Promise.all([
        patchSetting('/api/settings/safety', {
          ...safetyForBulkSave,
          notifySignalAutoSubmit: notifySignal.autoSubmit,
          notifySignalPending:    notifySignal.pending,
          notifySignalEntry:      notifySignal.entry,
          notifySignalManual:     notifySignal.manual,
          notifySignalUniverse:   notifySignal.universe,
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

  // T-108 §3.5 — 화면 「실거래여부」(ON = 실거래 가능)는 내부 dryRun 과 방향이 반대다. 뒤집기는 live-trading.ts 한 곳에서만.
  // 값을 못 읽었으면(safety 없음) dryRun=true 로 보고 실거래 아님(OFF)으로 그린다 — 토글·경고 상자가 같은 값을 쓴다.
  const liveTrading = liveTradingFromDryRun(safety?.dryRun ?? true);

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
                flexShrink: 0, minHeight: 44,
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
              ON 시 거래 › 운용 현황에서 진입가·수량을 편집한 뒤 감시를 시작할 수 있습니다.
            </div>
            {/*
              이 스위치가 자동매매 스위치로 오인되면 안 된다.
              ⚠️ 단, "모든 주문에 승인이 필요하다"고 쓰면 **거짓**이다 — routeSignal 은
                 hard_stop·eod_loss_cut 청산을 모드와 무관하게 무조건 자동 제출한다.
                 UI 의 거짓 안전 보장은 모호한 문구보다 나쁘므로 예외를 눈에 띄게 명시한다.
            */}
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>
              이 설정은 <b>승인한 주문을 언제 넣을지</b> 정합니다. 새 시그널의 주문에 사람이 승인할지는
              아래 <b>자동승인모드</b>에서 설정합니다.
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
                손실한도 손절·장마감 전 손절·트레일링 스탑·목표 익절 <b>네 가지 모두</b> 주문이
                만들어지지 않습니다. 아래 <b>안전장치 (공통) &gt; 자동 청산 엔진</b>에서 다시 켤 수 있습니다.
              </div>
            ) : (
              <div style={{
                fontSize: 11, color: '#f59e0b', marginTop: 6, lineHeight: 1.5,
                background: 'rgba(245,158,11,.10)', border: '1px solid rgba(245,158,11,.35)',
                borderRadius: 8, padding: '8px 10px',
              }}>
                ⚠️ <b>예외 — 보유 종목 보호 청산은 승인 없이 즉시 주문됩니다.</b><br />
                손실한도 손절과 장마감 전 손절 매도는 <b>이 설정·자동조종 모드와 무관하게</b> 자동
                제출됩니다. 손실이 커지는 것을 막는 기능이라 사람의 응답을 기다리지 않습니다.
                (목표 익절·트레일링 스탑 매도는 현재 주문 모드를 따릅니다.)
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
              label="승인 후 진입 감시 (하이브리드)"
            />
          </div>
        </div>
      </div>

      {/* Safety — global */}
      <SectionHeader title="안전장치 (공통)" />
      <div style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>

        {/* T-066 — 이 카드는 실제 주문에 적용된다(집행 중). 아래 '리스크 정책' 행은 표시·위험 계산·알림(주문·매도 없음)이라 구분한다. */}
        <EnforcedStrip />

        {/* T-108 — 안전 값을 못 읽은 동안: 세 안전 토글(실거래여부·모든거래차단·자동 청산 엔진)을 잠그고 다시 읽기를 둔다 */}
        {!safety && (
          <div role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'rgba(245,158,11,.08)' }}>
            <span style={{ fontSize: 12, color: '#f59e0b', lineHeight: 1.5, minWidth: 0 }}>
              안전 값을 읽지 못해 세 안전 토글(실거래여부·모든거래차단·자동 청산 엔진)을 잠갔습니다 — 다시 읽은 뒤에 바꿀 수 있습니다
            </span>
            <button
              type="button"
              onClick={() => { void reloadSafety(); }}
              style={{ flexShrink: 0, minHeight: 44, padding: '0 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)' }}
            >
              다시 읽기
            </button>
          </div>
        )}

        {/* 실거래 여부 toggle (내부 dryRun 의미를 반전해 노출) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 14 }}>{LIVE_TRADING_LABEL}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {!safety ? SAFETY_UNREAD : liveTrading ? 'ON — 실거래 가능(실제 주문)' : 'OFF — 실거래 차단(기록만)'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              ON 이면 주문이 거래소로 나가고, OFF 이면 기록만 남깁니다
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: !safety ? 'var(--muted)' : liveTrading ? 'var(--down)' : 'var(--ok)' }}>
              {!safety ? '—' : liveTrading ? 'ON' : 'OFF'}
            </span>
            <Toggle
              checked={liveTrading}
              label={LIVE_TRADING_LABEL}
              disabled={!safety}
              onChange={v => {
                if (!safety) return;   // 값을 못 읽은 동안은 저장하지 않는다(잠금 이중 확인)
                // 저장 본문 키·값은 이전과 같다(ON → dryRun:false, OFF → dryRun:true) — 변환만 live-trading.ts 경유.
                const prev = safety?.dryRun ?? true;
                const nextDryRun = dryRunFromLiveTrading(v);
                update({ dryRun: nextDryRun });
                autoSave({ dryRun: nextDryRun }, { dryRun: prev }, LIVE_TRADING_LABEL);
              }}
            />
          </div>
        </div>

        {/* KILL_SWITCH toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 14 }}>모든거래차단</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              {!safety ? SAFETY_UNREAD : safety.killSwitch ? 'ON — 모든 주문 차단' : 'OFF — 이 스위치로는 막지 않음'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              ON 이면 매수·매도·청산 모두 송신하지 않습니다
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: !safety ? 'var(--muted)' : safety.killSwitch ? 'var(--down)' : 'var(--ok)' }}>
              {!safety ? '—' : safety.killSwitch ? 'ON' : 'OFF'}
            </span>
            <Toggle
              checked={safety?.killSwitch ?? false}
              label="모든거래차단"
              disabled={!safety}
              onChange={v => {
                if (!safety) return;   // 값을 못 읽은 동안은 저장하지 않는다(잠금 이중 확인)
                const prev = safety?.killSwitch ?? false;
                update({ killSwitch: v });
                autoSave({ killSwitch: v }, { killSwitch: prev }, '모든거래차단');
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
                {!safety
                  ? SAFETY_UNREAD
                  : safety.exitEngineEnabled
                  ? `ON — 손실한도 손절·장마감 전 손절·트레일링 스탑·목표 익절 시그널 판단 중${safety.exitHardStopEnabled === false ? ' (손실한도 손절만 개별 OFF)' : ''}`
                  : 'OFF — 자동 손절·익절 매도 주문을 내지 않습니다'}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: !safety ? 'var(--muted)' : safety.exitEngineEnabled ? 'var(--ok)' : '#ef4444' }}>
                {!safety ? '—' : safety.exitEngineEnabled ? 'ON' : 'OFF'}
              </span>
              <Toggle
                checked={safety?.exitEngineEnabled ?? false}
                label="자동 청산 엔진"
                disabled={!safety}
                onChange={v => {
                  if (!safety) return;   // 값을 못 읽은 동안은 저장하지 않는다(잠금 이중 확인)
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
              보유 종목이 얼마나 떨어져도 시스템은 <b>스스로 팔지 않습니다.</b> 손실한도 손절,
              장마감 전 손절, 트레일링 스탑, 목표 익절 <b>네 가지 모두</b> 시그널조차 만들지
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

        <AutoApprovalModeRow />

        {/* T-101 해외 장마감 후 분석 — 같은 카드의 토글들처럼 즉시 저장, 실패 시 서버 값으로 되돌림 */}
        <PostMarketOverseasRow
          enabled={safety?.postMarketOverseasEnabled ?? false}
          onToggle={v => {
            const prev = safety?.postMarketOverseasEnabled ?? false;
            update({ postMarketOverseasEnabled: v });
            autoSave({ postMarketOverseasEnabled: v }, { postMarketOverseasEnabled: prev }, '해외 장마감 후 분석');
          }}
        />

        {/* 1회 주문 최대 — T-130 D1-A: 행 전체가 버튼(값 컴포넌트가 행을 함께 그린다), 저장은 예전처럼 저장 바 [저장] */}
        <LimitInput
          title="1회 주문 최대 (%)"
          sub="포트폴리오 평가총액 × pct%. 0 = 무제한"
          value={safety?.orderMaxPct ?? 0}
          onChange={v => update({ orderMaxPct: v })}
          allowZero
          suffix="%"
        />

        {/* 일일 누적 최대 */}
        <LimitInput
          title="일일 누적 최대 (%)"
          sub="포트폴리오 평가총액 × pct%. 오늘 0시~자정 누적 상한. 0 = 무제한"
          value={safety?.dailyOrderMaxPct ?? 0}
          onChange={v => update({ dailyOrderMaxPct: v })}
          allowZero
          suffix="%"
        />

      </div>

      {/* T-066 리스크 정책 요약 — 값 변경은 /settings/risk-policy 에서만 (자체 조회·자체 저장, 이 페이지 저장 바와 무관) */}
      <RiskPolicySummaryRow />

      {/* T-108 §2.6 자동매매 자금 — 두 행 모두 이동 전용(데이터 조회·저장 없음). 운용액 입력 화면은 이번 범위 밖이라
          첫 행은 누를 곳이 없는 비활성 행, 둘째 행은 기존 자산 기록 화면으로 이동한다. */}
      <SectionHeader title="자동매매 자금" />
      <div style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 56, padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <span aria-hidden style={{ width: 22, textAlign: 'center', color: 'var(--muted)', flexShrink: 0 }}>◌</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14 }}>운용액 배정 — 미설정</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              자동매매에 쓸 금액을 직접 정합니다(D4). 입력 화면은 다음 범위
            </div>
          </div>
        </div>
        <Link
          href="/settings/cash-ledger"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 56, padding: '12px 16px' }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span aria-hidden style={{ width: 22, textAlign: 'center', color: 'var(--muted)', flexShrink: 0 }}>◷</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 14 }}>손익 기준 — 실거래 전환일 첫 스냅샷</span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                자산 기록의 「기준 정하기」를 재사용(D5) · 관찰 기간엔 홈 손익 미표시
              </span>
            </span>
          </span>
          <span style={{ fontSize: 18, color: 'var(--muted)' }} aria-hidden>›</span>
        </Link>
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
              label="변동폭 가드 활성화"
            />
          </div>
        </div>

        {/* Window — 가드 OFF 면 흐리게(예전처럼 흐려도 편집은 된다) */}
        <MinutesInput
          title="비교 윈도우"
          sub="이 시간 내 변동률 기준 (분)"
          dim={!safety?.volGuardEnabled}
          value={safety?.volGuardWindowMin ?? 60}
          onChange={v => update({ volGuardWindowMin: v })}
        />

        {/* Warn */}
        <PctInput
          title="경고 임계치"
          sub="로그만 기록 (주문 차단 없음)"
          dim={!safety?.volGuardEnabled}
          value={safety?.volGuardWarnPct ?? -2}
          onChange={v => update({ volGuardWarnPct: v })}
        />

        {/* Block */}
        <PctInput
          title="차단 임계치"
          sub="신규 주문 차단 + Slack 경고"
          dim={!safety?.volGuardEnabled}
          value={safety?.volGuardBlockPct ?? -4}
          onChange={v => update({ volGuardBlockPct: v })}
        />

        {/* Panic — 카드 마지막 행(아래 줄 없음, 예전 그대로) */}
        <PctInput
          title="패닉 임계치"
          sub="패닉 청산 권고 + Slack 긴급 알림"
          dim={!safety?.volGuardEnabled}
          last
          value={safety?.volGuardPanicPct ?? -7}
          onChange={v => update({ volGuardPanicPct: v })}
        />
      </div>

      {/* Strategy settings */}
      <SectionHeader title="전략 설정" />
      <div style={{ background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>

        {/* T-143 — 해외 분석 대상 요약 행(자체 조회, 저장 바와 섞이지 않는다). 데모 v1 §0 대로 「동적 종목 선별」 바로 위 */}
        <OverseasUniverseSummaryRow />

        {/* Universe toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 14 }}>동적 종목 선별 (Universe)</div>
            {/*
              T-143 D6 — 코인 시절 문구를 사실대로 고친다(ON·OFF 공통 한 줄).
              사용자 결정(2026-11-01): 「동적 토글은 항상 켜지는 것으로 동작하면 된다」 → 현 동작이 원하는 동작이므로 기능 변경은 없고,
              「끌 수 있는 것처럼 보이지 않게」 문구만 바로잡는다. 실제로 `refreshUniverse()` 는 이 스위치와 무관하게
              `runEngine` 안에서 조건 없이 돈다(`src/lib/strategy/engine.ts`) — 값은 저장되지만 읽는 곳이 설정 화면뿐이다.
              숫자를 쓰지 않는 이유: 후보 풀·전략별 선별 수는 `universe.ts`·`engine.ts` 상수라 여기 적으면 또 어긋난다
              — 지운 옛 문구의 수치가 실제 상수(150 · 30/40/30)와 달랐던 것이 그 사례다.
              토글 자체를 없애는 것은 화면 구조 변경이라 별 task 로 분리했다(Leader L-2).
            */}
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              거래대금 상위에서 전략별로 자동 선별 — 항상 켜진 상태로 동작합니다 (이 스위치로는 끌 수 없습니다)
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: safety?.universeEnabled ? 'var(--ok)' : 'var(--muted)' }}>
              {safety?.universeEnabled ? 'ON' : 'OFF'}
            </span>
            <Toggle
              checked={safety?.universeEnabled ?? false}
              onChange={v => update({ universeEnabled: v })}
              label="동적 종목 선별 (Universe)"
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
              label="분석가 (Analyst)"
            />
          </div>
        </div>

        {/* Global interval — applies to all strategies (행 여백 12px 16px — 예전 그대로) */}
        {strategies.length > 0 && (
          <MinutesInput
            title="평가 주기"
            sub="모든 전략에 동일 적용"
            padding="12px 16px"
            value={strategies[0].backtestIntervalM}
            onChange={v => {
              setStrategies(prev => prev.map(s => ({ ...s, backtestIntervalM: v })));
              setIsDirty(true);
            }}
          />
        )}

      </div>

      {/* Warning when 실거래 여부 = ON (DRY_RUN OFF) */}
      {liveTrading && (
        <div style={{ background: 'rgba(239,68,68,.1)', borderRadius: 12, padding: '12px 16px', border: '1px solid rgba(239,68,68,.3)', fontSize: 13, color: 'var(--down)', lineHeight: 1.7 }}>
          ⚠ 실거래여부가 ON 입니다. 전략 실행 시 실제 KIS API로 주문이 전송됩니다.
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
          <Toggle checked={notifySignal.autoSubmit} label="자동 제출 알람" onChange={v => { setNotifySignal(s => ({ ...s, autoSubmit: v })); setIsDirty(true); }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 14 }}>승인 요청 알람</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>수동 승인 대기 시그널 생성 시 발송</div>
          </div>
          <Toggle checked={notifySignal.pending} label="승인 요청 알람" onChange={v => { setNotifySignal(s => ({ ...s, pending: v })); setIsDirty(true); }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 14 }}>진입 감시 발동 알람</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>진입 구간 도달 → 자동 주문 실행 시 발송</div>
          </div>
          <Toggle checked={notifySignal.entry} label="진입 감시 발동 알람" onChange={v => { setNotifySignal(s => ({ ...s, entry: v })); setIsDirty(true); }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 14 }}>수동 시나리오 등록 알람</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>내 시나리오 만들기 등록 완료 시 발송</div>
          </div>
          <Toggle checked={notifySignal.manual} label="수동 시나리오 등록 알람" onChange={v => { setNotifySignal(s => ({ ...s, manual: v })); setIsDirty(true); }} />
        </div>
        {/* (T-143 WP-A) 해외 분석 대상 변경 알림 — 알람 4개 뒤·정기 거래 리포트 앞. 위 네 행과 같은 모양·같은 저장 흐름이다.
            꺼도 홈 「확인 필요」 줄은 그대로 나온다(이 토글은 텔레그램만 멈춘다). */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px' }}>
          <div>
            <div style={{ fontSize: 14 }}>해외 분석 대상 변경 알림</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>변경 제안이 새로 생기거나 자동 목록이 바뀔 때 발송 · 꺼도 홈 「확인 필요」에는 그대로 올라옵니다</div>
          </div>
          <Toggle checked={notifySignal.universe} label="해외 분석 대상 변경 알림" onChange={v => { setNotifySignal(s => ({ ...s, universe: v })); setIsDirty(true); }} />
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
              <Toggle checked={report.enabled} label="리포트 수신 활성화" onChange={v => updateReport({ enabled: v })} />
            </div>
            {/* T-130 WP1 — 선택칸·발송 방식 버튼 높이 44px. 행 여백을 6px 16px 로 줄여 행 높이(약 56px)는 그대로 둔다 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 16px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 14 }}>수신 채널</div>
              <select
                aria-label="수신 채널"
                value={report.channel}
                onChange={e => updateReport({ channel: e.target.value as ReportData['channel'] })}
                style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6, minHeight: 44, padding: '0 10px', color: 'var(--text)', fontSize: 14 }}
              >
                <option value="slack">Slack</option>
                <option value="telegram">Telegram</option>
                <option value="both">둘 다</option>
                <option value="none">없음</option>
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 16px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: 14 }}>발송 방식</div>
              <div role="group" aria-label="발송 방식" style={{ display: 'flex', gap: 4, background: 'var(--bg3)', borderRadius: 8, padding: 2 }}>
                {(['rolling', 'fixed'] as const).map(m => {
                  const active = report.mode === m;
                  return (
                    <button
                      key={m}
                      aria-pressed={active}
                      onClick={() => updateReport({ mode: m })}
                      style={{
                        fontSize: 13, padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                        minHeight: 44, minWidth: 52,
                        background: active ? 'var(--accent)' : 'transparent',
                        // T-130 — 주황 바탕 위 흰 글자 대비 약 2.1:1 → 검정 약 10:1 (데모 v1 제안 칸과 같음)
                        color: active ? '#000' : 'var(--text)',
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 16px' }}>
                <div style={{ fontSize: 14 }}>발송 간격</div>
                <select
                  aria-label="발송 간격"
                  value={report.intervalMin}
                  onChange={e => updateReport({ intervalMin: Number(e.target.value) })}
                  style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6, minHeight: 44, padding: '0 10px', color: 'var(--text)', fontSize: 14 }}
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

      {/* T-084 앱 (안드로이드) — 맨 아래 안내 상자 바로 위. 머리글(id="app", 업데이트 띠의 이동 목표)은 섹션이 직접 그린다.
          자체 조회라 이 페이지의 조회·저장 바와 무관 */}
      <AppSection />

      <div style={{ background: 'var(--bg2)', borderRadius: 12, padding: 14, border: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
        실거래여부 / 모든거래차단 / 주문 한도는 DB에 저장되어 서버 재시작 없이 즉시 반영됩니다.
        거래소 API 키·알람 자격은 위 카드에서 등록·수정 시 평문으로 DB에 저장되며 즉시 반영됩니다.
      </div>

      <div style={{ height: 16 }} />
    </div>
  );
}

/**
 * T-130 WP1(D1-A, 데모 v1 승인) — 값 행 7개(1회 주문 최대·일일 누적 최대·비교 윈도우·경고/차단/패닉 임계치·평가 주기)의 행 모양.
 * 예전에는 오른쪽 값 글자(「미적용 ›」「60분 ›」 등, 높이 약 18px)만 누를 수 있었다. 이제 값 컴포넌트가 **행 전체를 함께 그리고**
 * 편집 전 행 전체가 버튼(높이 56px 이상)이다. 보이는 글자·색·「›」·여백·아래 줄·흐림은 예전 행 그대로.
 */
interface ValueRowLayout {
  title: string;
  sub: string;
  /** 행 여백 — 기본 '14px 16px'(평가 주기만 '12px 16px', 예전 행 그대로) */
  padding?: string;
  /** 카드 마지막 행이면 아래 줄을 긋지 않는다(예전 패닉 임계치 행 그대로) */
  last?: boolean;
  /** 변동폭 가드 OFF 때 흐리게(opacity .4) — 예전처럼 흐려도 편집은 된다 */
  dim?: boolean;
}

function valueRowBox({ padding = '14px 16px', last, dim }: Pick<ValueRowLayout, 'padding' | 'last' | 'dim'>): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    width: '100%', minHeight: 56, padding,
    ...(last ? {} : { borderBottom: '1px solid var(--border)' }),
    ...(dim ? { opacity: 0.4 } : {}),
  };
}

/**
 * 값 행 하나 — 편집 상태(editing·draft)는 행마다 자기 것을 가진다(예전 값 컴포넌트와 같다).
 *  - 편집 전: 행 전체 `<button type="button">`. 이름 = 「{제목}, 현재 {값}, 바꾸기」(값 글자는 이름에 들어 있어 aria-hidden).
 *  - 편집 중: 같은 자리를 **div 행**으로 바꾸고 오른쪽 값 자리에 입력칸(높이 44px)을 연다 — 버튼 안에 입력칸을 넣지 않는다.
 *  - 확정 = Enter·바깥 누르기(blur), 취소 = Esc — 예전과 같다. 확정 값은 `parse` 가 받아들일 때만 onChange(상태에만 반영, 저장은 저장 바 [저장]).
 *  - 닫은 뒤 포커스를 그 행 버튼으로 돌린다(키보드 사용자가 제자리에서 이어 가게). 단 바깥 누르기로 포커스가 **다른 컨트롤로 이미 옮겨 갔으면**
 *    (blur 의 relatedTarget 있음) 돌리지 않는다 — 사용자가 누른 검색칸·다른 행을 빼앗지 않는다. 돌릴 때 `preventScroll` — 편집 중 스크롤했다면
 *    화면을 그 행으로 되감지 않는다.
 *  - `open` 은 한 번 닫힌 편집에 뒤늦게 오는 blur(입력칸이 빠질 때 브라우저가 보내는 경우)가 다시 확정하지 않게 막는다 — Esc 로 취소한 값이
 *    blur 로 저장되거나, Enter 확정이 두 번 불리는 일이 없다.
 */
function ValueEditor({ title, sub, padding, last, dim, value, display, color, inputMode, parse, onChange }: ValueRowLayout & {
  value: number;
  /** 행에 보이는 값 글자(예 「미적용」「60분」「-2%」) */
  display: string;
  color: string;
  /** PctInput 은 지정하지 않는다 — 안드로이드 숫자 자판에 `-` 가 없어 음수를 못 넣을 수 있다 */
  inputMode?: 'decimal';
  /** 입력 글자 → 받아들일 값, 범위 밖·숫자 아님이면 null (값 컴포넌트마다 예전 검증 그대로) */
  parse: (draft: string) => number | null;
  onChange: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');
  const rowRef  = useRef<HTMLButtonElement>(null);
  const open    = useRef(false);
  const refocus = useRef(false);

  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false;
      rowRef.current?.focus({ preventScroll: true });
    }
  }, [editing]);

  const start = () => { open.current = true; setDraft(String(value)); setEditing(true); };
  const close = (save: boolean, backToRow: boolean) => {
    if (!open.current) return;
    open.current = false;
    if (save) {
      const n = parse(draft);
      if (n !== null) onChange(n);
    }
    refocus.current = backToRow;
    setEditing(false);
  };

  const box = valueRowBox({ padding, last, dim });
  const titleBlock = (
    <span style={{ minWidth: 0, flex: 1 }}>
      <span style={{ display: 'block', fontSize: 14 }}>{title}</span>
      <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{sub}</span>
    </span>
  );

  if (editing) {
    return (
      <div style={box}>
        {titleBlock}
        <input
          autoFocus
          aria-label={title}
          inputMode={inputMode}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={e => close(true, e.relatedTarget === null)}
          onKeyDown={e => {
            // T-130 Reviewer F1 — Enter keydown 의 기본 동작을 **먼저** 취소한다. 안 그러면 close 가 렌더·effect 로 포커스를 행 버튼에
            // 옮긴 뒤 아직 안 나간 keypress(Enter)가 그 버튼으로 가서 click → 편집 칸이 곧바로 다시 열린다(Chromium 실재현).
            // 다른 키(숫자·`-`·Backspace·Tab)는 취소하지 않는다 — 입력과 Tab 이동은 그대로.
            if (e.key === 'Enter') { e.preventDefault(); close(true, true); }
            if (e.key === 'Escape') close(false, true);
          }}
          style={{
            width: 96, minHeight: 44, flexShrink: 0, textAlign: 'right', fontSize: 14, fontWeight: 600,
            background: 'var(--bg3)', border: '1px solid var(--accent)',
            borderRadius: 8, padding: '4px 8px', color: 'var(--text)',
            outline: 'none',
          }}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      ref={rowRef}
      onClick={start}
      aria-label={`${title}, 현재 ${display}, 바꾸기`}
      style={{ ...box, textAlign: 'left', cursor: 'pointer' }}
    >
      {titleBlock}
      <span aria-hidden style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, fontSize: 14, fontWeight: 600, color }}>
        {display} <span style={{ color: 'var(--muted)', fontSize: 12 }}>›</span>
      </span>
    </button>
  );
}

/** 분 값 행(비교 윈도우·평가 주기) — 보이는 값 `{n}분`(강조색), 받아들이는 값 1~10080(예전 그대로). */
function MinutesInput({ value, onChange, ...row }: ValueRowLayout & { value: number; onChange: (v: number) => void }) {
  return (
    <ValueEditor
      {...row}
      value={value}
      display={`${value}분`}
      color="var(--accent)"
      inputMode="decimal"
      parse={draft => {
        const n = Number(draft);
        return !isNaN(n) && n >= 1 && n <= 10080 ? n : null;
      }}
      onChange={onChange}
    />
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

      {/* Selected chips — T-130 WP1: 칩 높이 36px, × 누르는 영역 44×44(margin -4px 로 칩 높이 안에 맞춤) */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        {symbols.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>등록된 차단 심볼 없음</span>
        )}
        {symbols.map(s => (
          <span key={s} style={{
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 12, minHeight: 36, padding: '0 0 0 10px', borderRadius: 10,
            background: chipColor, border: `1px solid ${chipBorder}`, color: 'var(--text)',
          }}>
            {display(s)}
            <button
              onClick={() => toggle(s)}
              aria-label={`${display(s)} 빼기`}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 14, lineHeight: 1, padding: 0,
                width: 44, height: 44, margin: '-4px 0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10,
              }}
            >×</button>
          </span>
        ))}
      </div>

      {/* Search input */}
      <input
        ref={inputRef}
        aria-label={`${label} 검색`}
        value={query}
        onChange={e => setQuery(e.target.value)}
        onFocus={() => { positionDropdown(); setFocused(true); }}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder={loadingList ? '종목 목록 불러오는 중…' : '종목명 또는 코드로 검색'}
        style={{
          width: '100%', minHeight: 44, fontSize: 14, padding: '7px 12px',
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

/**
 * 한도 값 행(1회 주문 최대·일일 누적 최대) — 보이는 값: 0 이고 allowZero 면 `미적용`(%)·`무제한`, 아니면 `{n}{suffix}`·`₩{n}`(강조색).
 * 받아들이는 값: 쉼표를 지운 숫자, allowZero 면 0 이상·아니면 0 초과(예전 그대로).
 */
function LimitInput({ value, onChange, allowZero, suffix, ...row }: ValueRowLayout & { value: number; onChange: (v: number) => void; allowZero?: boolean; suffix?: string }) {
  return (
    <ValueEditor
      {...row}
      value={value}
      display={allowZero && value === 0
        ? (suffix === '%' ? '미적용' : '무제한')
        : suffix ? `${value}${suffix}` : `₩${fmtNum(value)}`}
      color="var(--accent)"
      inputMode="decimal"
      parse={draft => {
        const n = Number(draft.replace(/,/g, ''));
        return !isNaN(n) && (allowZero ? n >= 0 : n > 0) ? n : null;
      }}
      onChange={onChange}
    />
  );
}

/**
 * 변동폭 임계치 행(경고·차단·패닉) — 보이는 값 `{n}%`(하락색), 받아들이는 값 −100~0(예전 그대로).
 * `inputMode` 를 지정하지 않는다 — 음수 `-` 입력을 막지 않게(가이드 T-130 §3(b)).
 */
function PctInput({ value, onChange, ...row }: ValueRowLayout & { value: number; onChange: (v: number) => void }) {
  return (
    <ValueEditor
      {...row}
      value={value}
      display={`${value}%`}
      color="var(--down)"
      parse={draft => {
        const n = Number(draft);
        return !isNaN(n) && n <= 0 && n >= -100 ? n : null;
      }}
      onChange={onChange}
    />
  );
}

