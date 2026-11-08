'use client';

/**
 * T-108 거래 › 운용 현황 (가이드 §2.4.1) — 옛 `/recommend` 페이지 본문을 그대로 옮겨 왔다.
 *
 * ⚠ useState 순서 고정: signals → pendingEntry → loading → blockBanner (`scenario-pages-wiring.test.ts` 가 이 4개의
 *   초기값을 바꿔 그린다). 새 useState 는 **이 4개 뒤에만** 둔다. 안전 상태·거래 지표(/api/ops/*) 조회는 이 파일이 하지 않고
 *   부모(`TradePage`)가 읽어 props 로 넘긴다 — 시험이 목으로 바꾸는 훅(useSymbolMeta·useFxRate) 밖의 새 훅을 늘리지 않기 위해서.
 *
 * 바뀐 것(그 밖은 옛 화면 그대로 — 카드·정렬·진입 감시 줄 서식·차단 배너·내 시나리오 만들기):
 *  - 승인 대기 목록에서 `detected` 를 뺐다(D8) — 「관측 기록」 건수로 따로 보인다. 머리 숫자는 서버 COUNT(`/api/ops/trade`).
 *  - 진입 감시 취소는 `window.confirm` 대신 확인 대화상자(같은 `DELETE /api/signals/{id}`).
 *  - 「주문 선점 중」(executing) 줄·「다음 세션 예정」 표지·전략 상태 줄을 더했다.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ScenarioCard, type SignalWithScenario } from '@/components/ScenarioCard';
import { useSymbolMeta } from '@/lib/hooks/useSymbolMeta';
import { useFxRate } from '@/lib/hooks/useFxRate';
import { useToast } from '@/components/ui/Toast';
import { fmtMarketPrice } from '@/lib/format';
import {
  sortScenarioCards, gradeOf, confidenceOf, fmtApproxKrw, usdZoneText, isOverseasSignal,
} from '@/components/scenario-card-display';
import type { OpsStage, SafetyStateDTO, TradeDTO } from '@/lib/ops/metrics/types';
import type { PollStatus } from '@/components/ops/useOpsPoll';
import { CHIP, fmtEtSession, fmtKstDateTime, fmtKstHm, fmtSessionDate } from '@/components/ops/format';
import { skippedFate } from '@/components/ops/reason-copy';
import { CheckRow, EmptyNote, Rows, RetryButton, Section, SectionBody, SectionLink, StatusChip, cx, ops } from '@/components/ops/ui';
import { decisionOutcome, HINT_TEXT } from '@/components/dashboard/decision-outcome';
import { WatchCancelSheet, type WatchCancelTarget } from './WatchCancelSheet';

interface PendingEntrySignal {
  id: number;
  symbol: string;
  side: string;
  market: string;
  indicators: unknown;
  expires_at: string;
  created_at: string;
  /** T-062 — 진입 가능 시작 시각(해외 = 다음 정규장 09:30 ET 의 KST). 미래면 「다음 세션 예정」. */
  valid_from?: string | null;
  quantity?: number | null;
  /** DB DECIMAL — mysql2 는 문자열로 준다. 표시는 fmtApproxKrw() 경유(T-063). */
  amount_krw?: number | string | null;
}

interface BlockBanner {
  reason: string;
  pct: number;
}

/** 부모(TradePage)가 읽어 넘기는 값 — 없으면(시험·첫 렌더) 해당 줄은 「불러오는 중」·모름으로 그린다. */
export interface TradeNowProps {
  stage?: OpsStage | null;
  safety?: SafetyStateDTO | null;
  safetyStatus?: 'loading' | 'ok' | 'error';
  trade?: TradeDTO | null;
  tradeStatus?: PollStatus;
  tradeError?: string | null;
  onRetryTrade?: () => void;
  /** 바뀔 때마다 목록을 다시 읽는다(부모의 60초 재조회와 맞춤) */
  reloadKey?: number;
  /** 감시 취소 대화상자가 닫힐 때 포커스할 id(세그먼트 「운용 현황」 버튼) */
  returnFocusIds?: () => readonly (string | null | undefined)[];
}

/** 승인 대기 목록 조회 — 홈·서버 COUNT 와 같은 집합(`AWAITING_APPROVAL_STATUSES` = awaiting_approval·pending·pending_approval). detected 제외(D8). */
export const APPROVAL_LIST_URL = '/api/signals?status=awaiting_approval,pending,pending_approval&limit=100';
export const PENDING_ENTRY_URL = '/api/signals?status=approved_pending_entry&limit=50';

/** 목록 조회 1회 — 응답 본문과 실패 코드(401 unauthorized · 네트워크 network · JSON 아님 bad_json · 그 밖 api_error). */
async function readList(url: string): Promise<{ body: { ok?: boolean; data?: unknown } | null; code: string }> {
  let res: Response;
  try { res = await fetch(url); } catch { return { body: null, code: 'network' }; }
  let body: { ok?: boolean; data?: unknown } | null = null;
  try { body = await res.json(); } catch { return { body: null, code: res.status === 401 ? 'unauthorized' : 'bad_json' }; }
  return { body, code: res.status === 401 ? 'unauthorized' : 'api_error' };
}

function marketText(m: string | null | undefined): string {
  return m === 'overseas' ? '해외' : '국내';
}

export function TradeNowPanel(props: TradeNowProps = {}) {
  const router = useRouter();
  const [signals, setSignals] = useState<SignalWithScenario[]>([]);
  const [pendingEntry, setPendingEntry] = useState<PendingEntrySignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [blockBanner, setBlockBanner] = useState<BlockBanner | null>(null);
  const { displaySymbol, marketFlag } = useSymbolMeta();
  const fxRate = useFxRate();
  // ↓ T-108 — 위 4개 뒤에만 추가
  const [listError, setListError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<WatchCancelTarget | null>(null);
  /** 진입 감시 목록 조회 실패 코드 — 실패를 「진입 감시 없음 ✓」으로 보이지 않기 위해 승인 대기와 따로 둔다(R-UI-M1) */
  const [pendingError, setPendingError] = useState<string | null>(null);
  const toast = useToast();
  const { stage = null, safety = null, safetyStatus, trade = null, tradeStatus, tradeError, onRetryTrade, reloadKey = 0 } = props;

  const fetchSignals = useCallback(async () => {
    setLoading(true);
    try {
      // T-108 — 세 조회를 따로 판정한다(한 곳이 실패해도 다른 구역을 「실패」·「0」으로 섞지 않게)
      const [aiR, pendingR, qualityR] = await Promise.all([
        readList(APPROVAL_LIST_URL), readList(PENDING_ENTRY_URL), readList('/api/analytics/signal-quality?hours=2'),
      ]);
      const aiData = aiR.body, pendingData = pendingR.body;
      const qualityData = (qualityR.body ?? {}) as { ok?: boolean; summary?: { total?: number; skipped?: number }; byPrefilterReason?: unknown };
      if (aiData?.ok) { setSignals((aiData.data ?? []) as SignalWithScenario[]); setListError(null); }
      else setListError(aiR.code);
      if (pendingData?.ok) { setPendingEntry((pendingData.data ?? []) as PendingEntrySignal[]); setPendingError(null); }
      else setPendingError(pendingR.code);

      // 최근 2시간 rule_prefilter 비율 ≥ 80%이면 배너 표시
      if (qualityData.ok && (qualityData.summary?.total ?? 0) > 0) {
        const pfReasons = (qualityData.byPrefilterReason ?? []) as { reason: string; total: number }[];
        const totalSkipped = (qualityData.summary?.skipped ?? 0) as number;
        const ctCount = pfReasons.find(r => r.reason === 'strong_counter_trend')?.total ?? 0;
        const ctPct = totalSkipped > 0 ? Math.round((ctCount / totalSkipped) * 100) : 0;
        if (ctPct >= 80) {
          setBlockBanner({ reason: 'strong_counter_trend', pct: ctPct });
        } else {
          setBlockBanner(null);
        }
      } else {
        setBlockBanner(null);
      }
    } catch {
      // T-108 — 실패를 빈 목록(「승인 대기 없음」·「진입 감시 없음」)으로 보이지 않는다
      setListError('network');
      setPendingError('network');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSignals(); }, [fetchSignals, reloadKey]);

  function openCancel(sig: PendingEntrySignal) {
    setCancelTarget({ id: sig.id, name: displaySymbol(sig.symbol), market: sig.market, side: sig.side });
  }
  function onCancelled(id: number) {
    setPendingEntry(prev => prev.filter(s => s.id !== id));
    setCancelTarget(null);
    toast.show('진입 감시를 취소했습니다', 'success');
    // 서버 집계(감시 중 n)도 바로 다시 읽는다 — 60초 재조회를 기다리면 「목록과 집계가 다릅니다」가 방금 토스트와 모순된다(R-UI-N2)
    onRetryTrade?.();
  }

  function getPriceZone(sig: PendingEntrySignal): { text: string; pct?: string } {
    try {
      const ind = (typeof sig.indicators === 'string' ? JSON.parse(sig.indicators) : sig.indicators) as Record<string, unknown>;
      const zoneRaw = (ind?.['ai'] as Record<string, unknown>)?.['scenario' as never] as Record<string, unknown> | undefined;
      const zoneStr = (zoneRaw?.['entry'] as Record<string, unknown>)?.['price_zone'] as string | undefined;
      const zoneMeta = ind?.['zone'] as { loPct?: number; hiPct?: number } | undefined;

      let text = '—';
      // T-062 G8: 해외 카드에 서버가 저장한 달러 구간(카드 시점 환율)이 있으면 그것을 그대로 쓴다.
      // 없으면 기존처럼 원화 구간을 지금 환율로 환산해 보인다(fmtMarketPrice 폴백).
      const usdZone = isOverseasSignal(sig) ? usdZoneText(ind) : null;
      if (usdZone) {
        text = usdZone;
      } else if (typeof zoneStr === 'string' && zoneStr.includes('~')) {
        const [lo, hi] = zoneStr.split('~').map(Number);
        const mkt = sig.market ?? 'domestic';
        const loFmt = Number.isFinite(lo) ? fmtMarketPrice(lo, mkt, fxRate) : '?';
        const hiFmt = Number.isFinite(hi) ? fmtMarketPrice(hi, mkt, fxRate) : '?';
        text = `${loFmt} ~ ${hiFmt}`;
      }

      let pct: string | undefined;
      if (zoneMeta?.loPct !== undefined && zoneMeta?.hiPct !== undefined) {
        const lo = zoneMeta.loPct >= 0 ? `+${zoneMeta.loPct}` : String(zoneMeta.loPct);
        const hi = zoneMeta.hiPct >= 0 ? `+${zoneMeta.hiPct}` : String(zoneMeta.hiPct);
        pct = `${lo}% ~ ${hi}%`;
      }

      return { text, pct };
    } catch { return { text: '—' }; }
  }

  function getExitInfo(sig: PendingEntrySignal): { target?: string; stop?: string } {
    try {
      const ind = typeof sig.indicators === 'string' ? JSON.parse(sig.indicators) : sig.indicators;
      const exit = (ind as Record<string, unknown>)?.['ai']?.['scenario' as never]?.['exit' as never] as Record<string, number> | undefined;
      if (!exit) return {};
      return {
        target: exit.target_pct ? `+${exit.target_pct}~${exit.target_pct_hi ?? exit.target_pct}%` : undefined,
        stop: exit.stop_pct ? `-${Math.abs(exit.stop_pct)}%` : undefined,
      };
    } catch { return {}; }
  }

  // T-062: 평가등급순(A>B+>B>C>없음 → 같은 등급은 신뢰도 높은 순 → 서버 순서 = 최신순).
  // 목록 API 의 indicators 는 문자열이라 gradeOf/confidenceOf 가 내부에서 파싱한다.
  const enriched = sortScenarioCards(
    signals.map(s => ({
      ...s,
      displayName: displaySymbol(s.symbol),
      marketFlag: marketFlag(s.symbol),
    })),
    s => ({ grade: gradeOf(s.indicators), confidence: confidenceOf(s.indicators) }),
  );

  // ── 서버 COUNT·안전 상태 (부모가 넘긴 값) ──
  const counts = trade?.counts.state === 'ok' ? trade.counts.data : null;
  const approvalN = counts ? counts.approval.domestic + counts.approval.overseas : null;
  const strategies = safety?.strategies ?? null;
  const validatedEnabled = strategies?.validatedEnabled ?? null;
  const observing = stage === 'observe' || stage === 'halt';
  const executing = trade?.executing.state === 'ok' ? trade.executing.data : [];
  /** 주문 선점 목록 상태 — ok(읽음) / error(실패) / pending(아직 못 읽음) */
  const executingState: 'ok' | 'error' | 'pending' = tradeStatus === 'error' || tradeStatus === 'stale' ? 'error' : trade?.executing.state === 'ok' ? 'ok'
    : trade?.executing.state === 'error' ? 'error' : 'pending';
  const executingError = trade?.executing.state === 'error' ? trade.executing.error : (tradeError ?? 'api_error');
  const blockedCards = trade?.blockedPostMarket.state === 'ok' ? trade.blockedPostMarket.data.slice(0, 2) : [];
  const nowMs = Date.now();

  // ── 승인 대기 본문 ──
  let approvalBody: ReactNode;
  if (loading && enriched.length === 0) {
    approvalBody = (
      <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>
        불러오는 중...
      </div>
    );
  } else if (enriched.length === 0 && listError) {
    approvalBody = (
      <SectionBody>
        <StatusChip kind="error">{CHIP.error(listError)}</StatusChip>{' '}
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>비어 있는 것이 아닙니다</span>
        <div style={{ marginTop: 8 }}><RetryButton onClick={fetchSignals} /></div>
      </SectionBody>
    );
  } else if (enriched.length === 0 && observing && validatedEnabled === 0) {
    approvalBody = (
      <>
        <EmptyNote>
          <b>승인 대기 없음</b> — 검증 통과 전략이 없어 새 매수 시그널은 검증 관문 차단 기록으로 남습니다(승인 버튼 없음).
        </EmptyNote>
        {blockedCards.map(c => {
          // T-130 D7-A: 이 카드의 시그널은 skipped — 검증 관문에 막힌 것(gate)이면 「차단」, 그 밖이면 「건너뜀」(둘을 같은 말로 부르지 않는다)
          const fate = skippedFate(c.gate);
          return (
            <div key={c.id} className={ops.card}>
              <div className={ops.h}>
                {displaySymbol(c.symbol)} <span className={ops.pill}>{marketText(c.market)}</span>
                <span className={cx(ops.pill, ops.buy)}>매수 시그널</span>
                <StatusChip kind={fate.blocked ? 'blocked' : 'off'}>{fate.chip}</StatusChip>
              </div>
              <div className={ops.s}>
                {c.market === 'overseas'
                  ? `${fmtEtSession(c.session.sessionDate)} 세션 · ${fmtKstHm(c.createdAt)} 장마감 분석`
                  : `${fmtSessionDate(c.session.sessionDate)} ${fmtKstHm(c.createdAt)} 장마감 분석`}
                {c.confidence != null ? ` · AI 신뢰도 ${Math.round(c.confidence)}` : ''}
                {fate.blocked ? ' · 전략 미검증 — 사후 결과 추적 대상으로만 씁니다' : ''}
              </div>
            </div>
          );
        })}
      </>
    );
  } else if (enriched.length === 0) {
    approvalBody = (
      <EmptyNote>
        <b>승인 대기 없음</b> <StatusChip kind="zero">{CHIP.zero}</StatusChip>
        {stage === 'mixed' ? ' — 매수 차단(검증 통과 0) 중' : ''}
      </EmptyNote>
    );
  } else {
    approvalBody = (
      <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ margin: '0 0 -2px', fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span>정렬: <b style={{ color: 'var(--text)' }}>평가등급순</b> (같은 등급은 신뢰도 높은 순)</span>
        </div>
        {enriched.map(s => (
          <ScenarioCard key={s.id} signal={s} />
        ))}
      </div>
    );
  }

  // ── 관측 기록 (detected — 승인 대기 숫자에 넣지 않음, D8) ──
  let observedRow: ReactNode;
  if (counts) {
    observedRow = <CheckRow severity="n" glyph="◌" title={`${counts.detected}건 — 수동 관측용 기록(detected)`} sub="승인 대기 숫자에 넣지 않습니다(D8)" />;
  } else if (tradeStatus === 'error' || tradeStatus === 'stale' || trade?.counts.state === 'error') {
    const code = trade?.counts.state === 'error' ? trade.counts.error : (tradeError ?? 'api_error');
    observedRow = <CheckRow severity="n" glyph="◌" title={<>— <StatusChip kind="error">{CHIP.error(code)}</StatusChip></>} sub="승인 대기 숫자에 넣지 않습니다(D8)" />;
  } else {
    observedRow = <CheckRow severity="n" glyph="◌" title="확인 중…" sub="승인 대기 숫자에 넣지 않습니다(D8)" />;
  }

  // ── 전략 상태 ──
  let strategyRow: ReactNode;
  if (strategies) {
    const v = strategies.validatedEnabled;
    strategyRow = (
      <CheckRow
        severity={v === 0 ? 'w' : 'i'}
        glyph={v === 0 ? '⊘' : String(v)}
        title={`켜진 전략 ${strategies.enabled} · 검증 통과 ${v}/${strategies.total}${v === 0 ? ' → 신규 매수 차단' : ''}`}
        sub="전략 편집·세부 정책은 상세(기존 /strategy)"
      />
    );
  } else if (safetyStatus === 'error' || (safety && !safety.strategies)) {
    strategyRow = <CheckRow severity="n" glyph="!" title={<>— <StatusChip kind="error">{CHIP.error('strategies_error')}</StatusChip></>} sub="전략 편집·세부 정책은 상세(기존 /strategy)" />;
  } else {
    strategyRow = <CheckRow severity="n" glyph="·" title="확인 중…" sub="전략 편집·세부 정책은 상세(기존 /strategy)" />;
  }

  const watchingN = counts ? counts.watching.domestic + counts.watching.overseas : null;
  const executingN = counts ? counts.executing : null;

  // ── 진입 감시 빈 상태 (R-UI-M1) — 「확인된 0」은 목록·선점 목록 둘 다 조회 성공 + 0 이고 서버 COUNT 와도 맞을 때만 ──
  let watchEmpty: ReactNode = null;
  if (pendingEntry.length === 0 && executing.length === 0) {
    if (loading) {
      watchEmpty = <EmptyNote>확인 중…</EmptyNote>;
    } else if (pendingError) {
      watchEmpty = (
        <SectionBody>
          <StatusChip kind="error">{CHIP.error(pendingError)}</StatusChip>{' '}
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>비어 있는 것이 아닙니다</span>
          <div style={{ marginTop: 8 }}><RetryButton onClick={fetchSignals} /></div>
        </SectionBody>
      );
    } else if (executingState === 'error') {
      watchEmpty = (
        <SectionBody>
          진입 감시 목록 0건 · 주문 선점 여부 <StatusChip kind="error">{CHIP.error(executingError)}</StatusChip>{' '}
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>비어 있는 것이 아닙니다</span>
          {onRetryTrade ? <div style={{ marginTop: 8 }}><RetryButton onClick={onRetryTrade} /></div> : null}
        </SectionBody>
      );
    } else if (executingState === 'pending') {
      watchEmpty = <EmptyNote>확인 중…</EmptyNote>;
    } else if (!counts) {
      watchEmpty = (
        <SectionBody>
          <StatusChip kind="error">집계를 확인하지 못했습니다</StatusChip>{' '}
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>비어 있는 것이 아닙니다</span>
          {onRetryTrade ? <div style={{ marginTop: 8 }}><RetryButton onClick={onRetryTrade} /></div> : null}
        </SectionBody>
      );
    } else if ((watchingN ?? 0) + (executingN ?? 0) + (counts?.nextSession ?? 0) > 0) {
      // 목록(만료 포함 조회)과 서버 COUNT(미만료)가 어긋남 — 0 이라고 말하지 않는다
      watchEmpty = (
        <SectionBody>
          <StatusChip kind="stale">목록과 집계가 다릅니다</StatusChip>{' '}
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>감시 중 {watchingN ?? '—'} · 선점 {executingN ?? '—'} — 다시 읽어 확인하세요</span>
          <div style={{ marginTop: 8 }}><RetryButton onClick={fetchSignals} /></div>
        </SectionBody>
      );
    } else {
      watchEmpty = <EmptyNote>진입 감시 없음 <StatusChip kind="zero">{CHIP.zero}</StatusChip></EmptyNote>;
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 16 }}>
      {/* 하락추세 차단 배너 — 승인 대기 위 (옛 화면 그대로) */}
      {blockBanner && (
        <div style={{
          margin: '10px 16px 0',
          padding: '10px 14px',
          borderRadius: 12,
          background: 'rgba(245,158,11,.10)',
          border: '1px solid rgba(245,158,11,.35)',
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>⚠️</span>
          <div style={{ fontSize: 12, color: '#d97706', lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>강한 하락추세 감지 — 매수 시그널 차단 중</div>
            <div style={{ color: 'var(--muted)' }}>
              최근 2시간 신호 중 {blockBanner.pct}%가 하락추세로 차단됨
              (EMA20 &lt; EMA60). 시장 추세 전환 후 시그널이 재개됩니다.
            </div>
          </div>
        </div>
      )}

      <div className={ops.scr}>
        <div className={ops.col}>
          <Section id="t-appr" title="승인 대기" small={approvalN != null ? `${approvalN}건 · 홈과 같은 집합` : '홈과 같은 집합'}>
            {approvalBody}
          </Section>
          <Section id="t-obsv" title="관측 기록" small="승인 버튼 없음"
            foot={(tradeStatus === 'error' || tradeStatus === 'stale') && onRetryTrade ? <RetryButton onClick={onRetryTrade} /> : undefined}>
            <Rows>{observedRow}</Rows>
          </Section>
        </div>
        <div className={ops.col}>
          <Section id="t-watch" title="진입 감시" small={`감시 중 ${watchingN ?? '—'} · 주문 선점 ${executingN ?? '—'} · 다음 세션 ${counts?.nextSession ?? '—'}`}>
            {watchEmpty}

            {/* 진입 감시 중 시그널 (옛 화면 목록 그대로) */}
            {pendingEntry.length > 0 && (
              <div style={{ padding: '4px 16px 8px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>
                  👁 진입 감시 중 ({pendingEntry.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {pendingEntry.map(sig => {
                    const { target, stop } = getExitInfo(sig);
                    const { text: zoneText, pct: zonePct } = getPriceZone(sig);
                    // DB DECIMAL(36,18) 컬럼은 mysql2 가 문자열로 반환한다 — Number 로 정직하게 변환 후 다룬다.
                    const qty = sig.quantity != null ? Number(sig.quantity) : null;
                    const approxKrw = fmtApproxKrw(sig.amount_krw);
                    const fromMs = sig.valid_from ? Date.parse(sig.valid_from) : NaN;
                    const nextSession = Number.isFinite(fromMs) && fromMs > nowMs;
                    return (
                      <div key={sig.id} style={{
                        background: 'var(--bg2)', borderRadius: 12,
                        border: '1px solid rgba(99,102,241,.3)',
                        padding: '12px 14px',
                        display: 'flex', flexDirection: 'column', gap: 8,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          {/* 국기 + 종목명 (길면 말줄임) */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                            <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{sig.market === 'overseas' ? '🌐' : '🇰🇷'}</span>
                            <span style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {displaySymbol(sig.symbol)}
                            </span>
                          </div>
                          {/* 매수/매도 + 감시 중 배지 — 항상 오른쪽 고정 */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                            <span style={{
                              fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 6,
                              background: sig.side === 'buy' ? 'rgba(239,68,68,.15)' : 'rgba(59,130,246,.15)',
                              color: sig.side === 'buy' ? 'var(--up)' : 'var(--down)',
                            }}>
                              {sig.side === 'buy' ? '매수' : '매도'}
                              {qty != null && qty > 0 && (
                                <span style={{ marginLeft: 4, fontWeight: 600 }}>
                                  · {Number.isInteger(qty) ? qty : (Math.floor(qty * 100) / 100).toFixed(2)}주
                                </span>
                              )}
                              {(qty == null || qty <= 0) && approxKrw && (
                                <span style={{ marginLeft: 4, fontWeight: 600 }}>
                                  · {approxKrw}
                                </span>
                              )}
                            </span>
                            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'rgba(99,102,241,.15)', color: '#818cf8', fontWeight: 600 }}>
                              {nextSession ? '다음 세션 예정' : '감시 중'}
                            </span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, color: 'var(--muted)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span>진입구간 <span className="num" style={{ color: 'var(--text)' }}>{zoneText}</span></span>
                            {zonePct && (
                              <span style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 11 }}>{zonePct}</span>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 12 }}>
                            {sig.side === 'buy' && target && <span>목표 <span className="num" style={{ color: 'var(--up)' }}>{target}</span></span>}
                            {sig.side === 'sell' && stop && <span>손절 <span className="num" style={{ color: 'var(--down)' }}>{stop}</span></span>}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 11, color: 'var(--muted)' }}>
                          <span>
                            {nextSession ? `시작 ${fmtKstDateTime(sig.valid_from)} · ` : ''}
                            만료 {new Date(sig.expires_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <button type="button" className={ops.btn} onClick={() => openCancel(sig)}>
                            감시 취소
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {pendingEntry.length > 0 && pendingError ? (
              <SectionBody><StatusChip kind="stale">새로 고치지 못했습니다 · {pendingError}</StatusChip></SectionBody>
            ) : null}

            {/* 원본 executing 잠금은 유지하고 주문 기록 결과만 표시한다. */}
            {(pendingEntry.length > 0 || executing.length > 0) && !counts ? (
              <SectionBody>
                <StatusChip kind="error">집계를 확인하지 못했습니다</StatusChip>{' '}
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>비어 있는 것이 아닙니다</span>
                {onRetryTrade ? <div style={{ marginTop: 8 }}><RetryButton onClick={onRetryTrade} /></div> : null}
              </SectionBody>
            ) : null}
            {pendingEntry.length > 0 && executingState === 'error' ? (
              <SectionBody><StatusChip kind="error">{CHIP.error(executingError)}</StatusChip>
                {onRetryTrade ? <RetryButton onClick={onRetryTrade} /> : null}
              </SectionBody>
            ) : null}
            {executing.length > 0 && (
              <Rows>
                {executing.map(x => {
                  const outcome = decisionOutcome({
                    status: 'executing', consumed_order_id: x.consumedOrderId ?? null,
                    order_status: x.orderStatus ?? null, updated_at: x.since,
                  }, nowMs);
                  return (
                    <CheckRow
                      key={x.id}
                      severity="w"
                      glyph={outcome.kind === 'check' ? '!' : '…'}
                      title={`${displaySymbol(x.symbol)} ${marketText(x.market)} · ${outcome.text}`}
                      sub={outcome.hint ? HINT_TEXT : outcome.kind === 'test' ? '실주문 아님' : '주문 처리 중 (취소 불가)'}
                    />
                  );
                })}
              </Rows>
            )}
            {executing.length > 0 && (tradeStatus === 'stale' || tradeStatus === 'error') ? (
              <SectionBody><StatusChip kind="stale">새로 고치지 못했습니다 · {CHIP.error(tradeError ?? 'api_error')}</StatusChip>
                {onRetryTrade ? <RetryButton onClick={onRetryTrade} /> : null}
              </SectionBody>
            ) : null}
          </Section>
          <Section id="t-strat" title="전략 상태" link={<SectionLink href="/strategy" ariaLabel="전략 관리 화면 열기">관리</SectionLink>}>
            <Rows>{strategyRow}</Rows>
          </Section>
        </div>
      </div>

      {/* 내 시나리오 만들기 버튼 (옛 화면 그대로) */}
      <div style={{ padding: '4px 16px 12px' }}>
        <button
          onClick={() => router.push('/recommend/build')}
          style={{
            width: '100%', height: 50, borderRadius: 12,
            background: 'rgba(99,102,241,.15)',
            border: '1px dashed rgba(99,102,241,.4)',
            color: '#818cf8', fontSize: 15, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          내 시나리오 만들기 +
        </button>
      </div>

      {cancelTarget && (
        <WatchCancelSheet
          target={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onCancelled={onCancelled}
          onGone={() => { void fetchSignals(); }}
          returnFocusIds={props.returnFocusIds}
        />
      )}
    </div>
  );
}
