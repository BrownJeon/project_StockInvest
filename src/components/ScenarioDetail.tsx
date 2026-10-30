'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback, useRef } from 'react';
import { UsMarketBadge, type SignalWithScenario } from './ScenarioCard';
import {
  parseIndicators, scenarioOf, isOverseasSignal, overseasZoneView, detailZoneAux, sessionLine, earningsLine,
} from './scenario-card-display';
import {
  aiEvalItems, hasAiEval, riskFactors, entryZoneDisplay, buildConfirmScenario,
} from './scenario-view-model';
import { useSymbolMeta } from '@/lib/hooks/useSymbolMeta';
import { useFxRate } from '@/lib/hooks/useFxRate';
import { fmtMarketPrice } from '@/lib/format';
import { cx, ops } from '@/components/ops/ui';

interface Props {
  signalId: number;
}

interface SliceInput {
  zoneLo: string;
  zoneHi: string;
  zoneLoPct: string;
  zoneHiPct: string;
  qty: string;
}

// ─── 호가단위 ───────────────────────────────────────────
function domesticTick(price: number): number {
  if (price < 2000)   return 1;
  if (price < 5000)   return 5;
  if (price < 20000)  return 10;
  if (price < 50000)  return 50;
  if (price < 200000) return 100;
  if (price < 500000) return 500;
  return 1000;
}
function roundToTick(price: number): number {
  const tick = domesticTick(price);
  return Math.round(price / tick) * tick;
}
function pctToKrw(cp: number, pct: number): number {
  return roundToTick(cp * (1 + pct / 100));
}
// fmtPrice는 컴포넌트 내부에서 market/fxRate 바인딩 후 사용

function initSlices(direction: 'buy' | 'sell', splits: number, cp: number | null): SliceInput[] {
  return Array.from({ length: splits }, (_, i) => {
    const [pctLo, pctHi] = direction === 'buy' ? [-2.0, -0.5] : [0.5, 2.0];
    const step = (pctHi - pctLo) / splits;
    const lo = pctLo + i * step;
    const hi = pctLo + (i + 1) * step;
    if (!cp || cp <= 0)
      return { zoneLo: '', zoneHi: '', zoneLoPct: lo.toFixed(1), zoneHiPct: hi.toFixed(1), qty: '' };
    return {
      zoneLo: String(pctToKrw(cp, lo)),
      zoneHi: String(pctToKrw(cp, hi)),
      zoneLoPct: lo.toFixed(1),
      zoneHiPct: hi.toFixed(1),
      qty: '',
    };
  });
}

// ─── T-062 해외 카드 표시 조각 (승인 데모 v2 장면 3) ─────────────────────────────
// 판정은 전부 `scenario-card-display.ts` 순수 함수 — 여기는 그리기만. 서버 키가 없으면 아무것도 그리지 않는다.

const ZONE_BOX: React.CSSProperties = {
  fontSize: 12, color: 'var(--muted)', padding: '6px 10px', borderRadius: 8,
  background: 'var(--bg2)', border: '1px solid var(--border)', lineHeight: 1.55,
};

/** 현재가 아래: "유효: 미국 정규장 …" 줄 + 실적 한 줄(해외 카드만). */
export function OverseasDetailLines({ validFrom, expiresAt, indicators }: {
  validFrom: unknown; expiresAt: unknown; indicators: unknown;
}) {
  const session = sessionLine(validFrom, expiresAt);
  const earnings = earningsLine(indicators);
  if (!session && !earnings) return null;
  return (
    <>
      {session && <div style={{ ...ZONE_BOX, color: 'var(--text)' }}>유효: {session}</div>}
      {earnings && (earnings.tone === 'warn' ? (
        <div style={{ ...ZONE_BOX, color: 'var(--warn)', borderColor: 'rgba(245,158,11,.45)', background: 'rgba(245,158,11,.08)' }}>
          <span aria-hidden>⚠</span> {earnings.text} {earnings.note}
        </div>
      ) : (
        <div style={ZONE_BOX}>{earnings.text} {earnings.note}</div>
      ))}
    </>
  );
}

/**
 * "AI 권장 진입 구간" 상자. 해외: 서버 저장 달러 구간 주표기 + 원화 보조 줄(카드 환율·자동 진입 기준 안내),
 * 달러 값이 없으면 원화 구간에 단위를 붙여 폴백(화면에서 환산하지 않는다). 국내: 기존 문자열 그대로.
 */
export function AiEntryZoneBox({ overseas, indicators, domesticZone }: {
  overseas: boolean; indicators: unknown; domesticZone: string | null;
}) {
  if (!overseas) {
    if (!domesticZone) return null;
    return (
      <div style={{ fontSize: 12, color: 'var(--muted)', padding: '6px 10px', borderRadius: 8, background: 'var(--bg2)', border: '1px solid var(--border)' }}>
        AI 권장 진입 구간: <span className="num" style={{ color: 'var(--accent)', fontWeight: 700 }}>{domesticZone}</span>
      </div>
    );
  }
  const view = overseasZoneView(indicators);
  if (!view) return null;
  const aux = detailZoneAux(indicators);
  return (
    <div style={ZONE_BOX}>
      AI 권장 진입 구간: <span className="num" style={{ color: 'var(--accent)', fontWeight: 700 }}>{view.usd ?? view.krw}</span>
      {aux && (
        <span className="num" style={{ display: 'block', marginTop: 2, fontSize: 11, color: 'var(--muted)', fontWeight: 500 }}>{aux}</span>
      )}
    </div>
  );
}

// ─── T-108 §2.4.3 승인·거절 결과 표시 (데모 v3 시트 결과 상태) ─────────────────────
// API·요청 본문·편집 폼·확인 단계는 그대로다. 바뀌는 것은 응답을 **읽어 나눠 보이는 것**뿐(이전: 토스트 1줄, 거절은 결과를 보지 않음).
// 매수·매도 모두 `custom/confirm` 은 진입 감시(approved_pending_entry)를 만든다 — 바로 주문을 내지 않는다 [확인: confirm route 반환값].

export type DetailResultKind = 'ok' | 'fail' | 'blocked' | 'unknown' | 'rejected' | 'reject_fail' | 'reject_unknown';
export interface DetailResult { kind: DetailResultKind; text: string }

export const APPROVE_UNKNOWN_TEXT = '! 오류: 연결이 끊겼습니다 — 승인됐는지 알 수 없습니다. 목록을 새로 고쳐 상태를 확인한 뒤 다시 시도하세요.';
export const REJECT_UNKNOWN_TEXT = '! 오류: 연결이 끊겼습니다 — 거절됐는지 알 수 없습니다. 목록을 새로 고쳐 상태를 확인하세요.';
const BLOCK_CODES = new Set(['validation_gate', 'validation_lookup_error']);

/** 승인 응답(HTTP 상태 + 본문) → 결과. 본문을 못 읽었거나(undefined) 5xx 면 「알 수 없음」 — 서버가 일부를 처리했을 수 있다. */
export function approveResultOf(status: number, data: unknown): DetailResult {
  const d = (data && typeof data === 'object' ? data : null) as { ok?: unknown; status?: unknown; error?: unknown; errorCode?: unknown; blockedBy?: unknown } | null;
  if (!d) return { kind: 'unknown', text: APPROVE_UNKNOWN_TEXT };
  if (d.ok === true) {
    return { kind: 'ok', text: d.status === 'approved_pending_entry' ? '✓ 진입 감시가 시작됐습니다' : '✓ 승인했습니다' };
  }
  const err = typeof d.error === 'string' && d.error ? d.error : '알 수 없는 오류';
  if ((typeof d.errorCode === 'string' && BLOCK_CODES.has(d.errorCode)) || d.blockedBy != null) {
    return { kind: 'blocked', text: `⊘ 차단: ${err} — 승인되지 않았습니다.` };
  }
  if (status >= 500) {
    return { kind: 'unknown', text: `! 오류: ${err} — 승인됐는지 알 수 없습니다. 목록을 새로 고쳐 상태를 확인한 뒤 다시 시도하세요.` };
  }
  return { kind: 'fail', text: `! 오류: ${err} — 승인되지 않았습니다. 목록으로 돌아가 다시 확인하세요.` };
}

/** 거절 응답 → 결과. 거절 성공은 놓친 기회(사후 추적)에 남는다. */
export function rejectResultOf(status: number, data: unknown): DetailResult {
  const d = (data && typeof data === 'object' ? data : null) as { ok?: unknown } | null;
  if (d && d.ok === true) return { kind: 'rejected', text: '거절했습니다 — 놓친 기회(사후 추적)에 기록됩니다' };
  if (!d || status >= 500) return { kind: 'reject_unknown', text: REJECT_UNKNOWN_TEXT };
  return { kind: 'reject_fail', text: '! 거절하지 못했습니다 — 시그널은 그대로입니다' };
}

/** 승인 버튼 위 안내(데모 `.gate`). 실거래여부 값은 `/api/ops/safety-state` 의 liveTrading(서버가 live-trading.ts 로 변환한 값). */
/** 「등록하면 **진입 감시가 시작**」 뒤에 붙는 문장(버튼 「✅ 등록」과 어휘를 맞춤 — R-UI ⑦). 매도도 같은 진입 감시 경로다 — 다만 주문 한도·검증 관문은 매도에 적용되지 않는다(dry-run.ts·validation-gate). */
export function approveGateText(side: 'buy' | 'sell', liveTrading: boolean | null): { body: string; live: boolean } {
  const live = liveTrading === true;
  return side === 'sell'
    ? { body: '됩니다 — 이 단계에서는 주문이 나가지 않습니다. 매도 주문은 지정한 구간에 닿을 때 안전장치(모든거래차단·실거래여부)를 거쳐 나갑니다(매도는 주문 한도·검증 관문을 거치지 않음)', live }
    : { body: '됩니다 — 이 단계에서는 주문이 나가지 않습니다. 주문은 진입 구간에 닿을 때 안전장치(모든거래차단·한도·실거래여부)를 거쳐 나갑니다', live };
}

const GRADE_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  'A':  { color: '#22c55e', bg: 'rgba(34,197,94,.15)',   border: 'rgba(34,197,94,.4)'  },
  'B+': { color: '#818cf8', bg: 'rgba(99,102,241,.18)',  border: 'rgba(99,102,241,.4)' },
  'B':  { color: '#f59e0b', bg: 'rgba(245,158,11,.15)',  border: 'rgba(245,158,11,.4)' },
  'C':  { color: '#6b7280', bg: 'var(--bg3)',            border: 'var(--border2)'      },
};

export function ScenarioDetail({ signalId }: Props) {
  const router = useRouter();
  const { displaySymbol, marketFlag } = useSymbolMeta();
  const fxRate = useFxRate();
  // 로드된 signal의 market 기준으로 가격 포맷 — signal이 없으면 domestic 기본
  const fmtPrice = (price: number) => fmtMarketPrice(price, signal?.market ?? 'domestic', fxRate);

  const [signal, setSignal] = useState<SignalWithScenario | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  // 진입 설정
  const [splits, setSplits] = useState<1|2|3|4>(1);
  const [sliceInputs, setSliceInputs] = useState<SliceInput[]>([]);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [holdingQty, setHoldingQty] = useState<number>(0);
  const [formError, setFormError] = useState<string | null>(null);
  // T-108 §2.4.3 — 결과 표시·실거래여부 안내 (위 useState 뒤에만 추가: 시험이 앞 2개 순서에 기댄다)
  const [result, setResult] = useState<DetailResult | null>(null);
  const [liveTrading, setLiveTrading] = useState<boolean | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);

  // 결과가 바뀌면 결과 상자로 포커스(role=status 없이 tabIndex=-1 — 두 번 읽힘 방지, 가이드 §8.2)
  useEffect(() => { if (result) resultRef.current?.focus(); }, [result]);

  // 실거래여부(안내 문구용) — 읽기 전용 라우트. 실패하면 null(빨간 「실제 주문」 꼬리를 붙이지 않는다)
  useEffect(() => {
    let alive = true;
    fetch('/api/ops/safety-state', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (alive && j?.ok && j.data) setLiveTrading(typeof j.data.liveTrading === 'boolean' ? j.data.liveTrading : null); })
      .catch(() => { /* 안내 꼬리만 빠진다 */ });
    return () => { alive = false; };
  }, []);

  // 시그널 로드
  useEffect(() => {
    fetch(`/api/signals/${signalId}`)
      .then(r => r.json())
      .then(j => {
        if (j.ok) {
          const sig = j.data as SignalWithScenario;
          setSignal(sig);
        } else {
          setPageError(j.error ?? '시그널을 불러올 수 없습니다');
        }
      })
      .catch(e => setPageError(String(e)))
      .finally(() => setLoading(false));
  }, [signalId]);

  // 현재가 조회
  const fetchPrice = useCallback(async (symbol: string) => {
    if (!symbol) return;
    setPriceLoading(true);
    try {
      const res = await fetch(`/api/ticker?symbol=${encodeURIComponent(symbol)}`);
      const data = await res.json();
      if (data.ok && data.data?.price) setCurrentPrice(data.data.price);
    } catch { /* ignore */ }
    finally { setPriceLoading(false); }
  }, []);

  // 보유 수량 조회 (매도 전용)
  const fetchHolding = useCallback(async (symbol: string) => {
    try {
      const res = await fetch('/api/portfolio');
      const data = await res.json();
      if (!data.ok) return;
      const found = (data.data?.holdings ?? []).find(
        (h: Record<string, unknown>) => h.symbol === symbol && !h.is_cash
      );
      if (found) setHoldingQty(Math.floor(Number(found.qty)));
    } catch { /* ignore */ }
  }, []);

  // 시그널 로드 후 현재가 + 보유 수량 조회
  useEffect(() => {
    if (!signal) return;
    fetchPrice(signal.symbol);
    if (signal.side === 'sell') fetchHolding(signal.symbol);
  }, [signal, fetchPrice, fetchHolding]);

  // 초기 슬라이스 생성
  useEffect(() => {
    if (!signal) return;
    setSliceInputs(initSlices(signal.side, splits, currentPrice));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal?.side]);

  // 현재가 로드 완료 시 슬라이스 KRW 갱신
  useEffect(() => {
    if (!currentPrice || !signal) return;
    setSliceInputs(prev =>
      prev.map(s => {
        const lo = parseFloat(s.zoneLoPct);
        const hi = parseFloat(s.zoneHiPct);
        if (Number.isFinite(lo) && Number.isFinite(hi)) {
          return { ...s, zoneLo: String(pctToKrw(currentPrice, lo)), zoneHi: String(pctToKrw(currentPrice, hi)) };
        }
        return s;
      })
    );
  }, [currentPrice, signal]);

  function handleSplitsChange(n: 1|2|3|4) {
    setSplits(n);
    setSliceInputs(prev => {
      const next = initSlices(signal!.side, n, currentPrice);
      return next.map((s, i) => prev[i]
        ? { ...s, qty: prev[i].qty, zoneLo: prev[i].zoneLo || s.zoneLo, zoneHi: prev[i].zoneHi || s.zoneHi, zoneLoPct: prev[i].zoneLoPct || s.zoneLoPct, zoneHiPct: prev[i].zoneHiPct || s.zoneHiPct }
        : s
      );
    });
  }

  function updateSlicePct(i: number, field: 'zoneLoPct' | 'zoneHiPct', value: string) {
    setSliceInputs(prev => prev.map((s, idx) => {
      if (idx !== i) return s;
      const pct = parseFloat(value);
      const krwField = field === 'zoneLoPct' ? 'zoneLo' : 'zoneHi';
      const krwValue = currentPrice && Number.isFinite(pct) ? String(pctToKrw(currentPrice, pct)) : '';
      return { ...s, [field]: value, [krwField]: krwValue };
    }));
  }

  function updateSellQty(idx: number, value: string) {
    setSliceInputs(prev => {
      const next = prev.map((s, i) => i === idx ? { ...s, qty: value } : { ...s });
      let used = 0;
      for (let i = 0; i < next.length; i++) {
        const q = parseInt(next[i].qty, 10) || 0;
        if (i <= idx) {
          used += q;
        } else {
          const rem = Math.max(0, holdingQty - used);
          next[i] = { ...next[i], qty: rem <= 0 ? '0' : String(Math.min(parseInt(next[i].qty, 10) || 0, rem)) };
          used += parseInt(next[i].qty, 10) || 0;
        }
      }
      return next;
    });
  }

  function updateBuyQty(idx: number, value: string) {
    setSliceInputs(prev => prev.map((s, i) => i === idx ? { ...s, qty: value } : s));
  }

  function handleCopyFirst() {
    setSliceInputs(prev => {
      if (prev.length < 2) return prev;
      const first = prev[0];
      const lo = parseFloat(first.zoneLoPct);
      const hi = parseFloat(first.zoneHiPct);
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) return prev;
      const step = hi - lo;
      return prev.map((s, i) => {
        if (i === 0) return s;
        const sliceLo = hi + (i - 1) * step;
        const sliceHi = hi + i * step;
        return {
          ...s,
          qty: first.qty,
          zoneLoPct: sliceLo.toFixed(1),
          zoneHiPct: sliceHi.toFixed(1),
          zoneLo: currentPrice ? String(pctToKrw(currentPrice, sliceLo)) : '',
          zoneHi: currentPrice ? String(pctToKrw(currentPrice, sliceHi)) : '',
        };
      });
    });
  }

  function validate(): { slices: SliceInput[] } | null {
    if (!signal) return null;
    const dir = signal.side;
    const finalSlices: SliceInput[] = [];
    let usedSellQty = 0;
    let hasValidQty = false;

    for (let i = 0; i < sliceInputs.length; i++) {
      const s = sliceInputs[i];
      const qty = parseInt(s.qty, 10);
      const loPct = parseFloat(s.zoneLoPct);
      const hiPct = parseFloat(s.zoneHiPct);

      if (!Number.isFinite(loPct)) { setFormError(`${i+1}회차: 진입 구간 하단 %를 입력하세요`); return null; }
      if (!Number.isFinite(hiPct)) { setFormError(`${i+1}회차: 진입 구간 상단 %를 입력하세요`); return null; }
      if (loPct >= hiPct) { setFormError(`${i+1}회차: 하단 %가 상단 %보다 작아야 합니다`); return null; }

      const zoneLo = currentPrice ? String(pctToKrw(currentPrice, loPct)) : s.zoneLo;
      const zoneHi = currentPrice ? String(pctToKrw(currentPrice, hiPct)) : s.zoneHi;

      if (dir === 'sell') {
        const rem = Math.max(0, holdingQty - usedSellQty);
        if (rem <= 0) { finalSlices.push({ ...s, zoneLo, zoneHi, qty: '0' }); continue; }
        if (!Number.isFinite(qty) || qty <= 0) { setFormError(`${i+1}회차: 수량(주)을 입력하세요`); return null; }
        if (qty > rem) { setFormError(`${i+1}회차: 매도 수량(${qty})이 잔여 수량(${rem})보다 많습니다`); return null; }
        usedSellQty += qty;
        hasValidQty = true;
        finalSlices.push({ ...s, zoneLo, zoneHi, qty: String(qty) });
      } else {
        if (!Number.isFinite(qty) || qty <= 0) { setFormError(`${i+1}회차: 수량(주)을 정수로 입력하세요`); return null; }
        hasValidQty = true;
        finalSlices.push({ ...s, zoneLo, zoneHi, qty: String(qty) });
      }
    }

    if (!hasValidQty) { setFormError('수량이 설정된 회차가 없습니다'); return null; }
    setFormError(null);
    return { slices: finalSlices };
  }

  async function handleApprove() {
    if (!signal) return;
    const result = validate();
    if (!result) return;

    setSubmitting(true);
    try {
      const sc = signal.indicators?.ai?.scenario;
      const res = await fetch('/api/signals/custom/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          market: signal.side === 'buy' ? (signal.symbol.includes(':') ? 'overseas' : 'domestic') : (signal.symbol.includes(':') ? 'overseas' : 'domestic'),
          symbol: signal.symbol,
          direction: signal.side,
          currentPrice: currentPrice ?? 0,
          // 부분 결측 시나리오도 그대로 실어보내되, 서버가 요구하는 구조만 병합으로 보장한다.
          // (없는 평가치를 0·'C' 로 지어내 DB 에 저장하지 않는다 — scenario-view-model 주석 참고)
          scenario: buildConfirmScenario(sc),
          manualSlices: result.slices
            .filter(s => Number(s.qty) > 0)
            .map(s => ({ zoneLo: Number(s.zoneLo), zoneHi: Number(s.zoneHi), qty: Number(s.qty) })),
          splits,
          sourceSignalId: signal.id,
        }),
      });
      const data = await res.json().catch(() => undefined);
      const outcome = approveResultOf(res.status, data);
      setResult(outcome);
      if (outcome.kind === 'ok') setTimeout(() => router.push('/recommend'), 1800);
    } catch {
      setResult({ kind: 'unknown', text: APPROVE_UNKNOWN_TEXT });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReject() {
    if (!signal) return;
    setRejecting(true);
    try {
      const res = await fetch(`/api/signals/${signal.id}/reject`, { method: 'POST' });
      const data = await res.json().catch(() => undefined);
      const outcome = rejectResultOf(res.status, data);
      setResult(outcome);
      // 이동 목적지는 이전과 같다(/recommend). 결과 문구를 읽을 수 있게 승인 성공과 같은 1.8초 뒤에 이동한다.
      if (outcome.kind === 'rejected') setTimeout(() => router.push('/recommend'), 1800);
    } catch {
      setResult({ kind: 'reject_unknown', text: REJECT_UNKNOWN_TEXT });
    } finally {
      setRejecting(false);
    }
  }

  if (loading) {
    return <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>불러오는 중...</div>;
  }
  if (pageError || !signal) {
    return <div style={{ padding: 32, textAlign: 'center', color: 'var(--danger)', fontSize: 13 }}>{pageError ?? '시그널을 찾을 수 없습니다'}</div>;
  }

  // 상세 API 는 indicators 를 파싱해 주지만, 파싱 실패 시 문자열 그대로 둔다 — 같은 경로로 방어(T-062 G1).
  const ind = parseIndicators(signal.indicators);
  const sc = scenarioOf(ind);
  const overseas = isOverseasSignal(signal);
  // DB JSON 은 필드 존재를 보장하지 않는다 — 표시 판정을 순수 함수에 위임한다(T-021).
  const evalItems  = aiEvalItems(sc);
  const risks      = riskFactors(sc);
  const aiEntryZone = entryZoneDisplay(sc);
  // 등급이 없으면 'C' 로 지어내지 않는다(배지 미표시). gs 는 색상 폴백 용도로만 'C' 사용.
  const grade = evalItems.grade;
  const gs = GRADE_STYLE[grade ?? 'C'] ?? GRADE_STYLE['C'];

  const inputStyle: React.CSSProperties = {
    flex: 1, padding: '9px 10px', borderRadius: 8, fontSize: 13,
    background: 'var(--bg)', border: '1px solid var(--border2)',
    color: 'var(--text)', fontWeight: 600, boxSizing: 'border-box', minWidth: 0,
  };

  return (
    // 하단 고정 바(버튼 52 + 여백)가 결과 상자만큼 커지면 본문 끝이 가려진다 — 그만큼 아래 여백을 늘린다(R-UI ⑦)
    <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: (submitting || rejecting || result) ? 160 : 100 }}>
      {/* 헤더 */}
      <div style={{
        padding: '12px 16px 10px', position: 'sticky', top: 0,
        background: 'var(--bg)', zIndex: 10, borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <button onClick={() => router.back()} style={{ fontSize: 20, color: 'var(--muted)', lineHeight: 1 }}>←</button>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, flexShrink: 0,
            background: signal.side === 'buy' ? 'rgba(239,68,68,.18)' : 'rgba(59,130,246,.18)',
            color: signal.side === 'buy' ? 'var(--up)' : 'var(--down)',
          }}>
            {signal.side === 'buy' ? '매수' : '매도'}
          </span>
          {overseas ? <UsMarketBadge /> : marketFlag(signal.symbol) && (
            <span style={{ flexShrink: 0, fontSize: 15 }} aria-hidden>{marketFlag(signal.symbol)}</span>
          )}
          <span style={{ fontSize: 17, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {displaySymbol(signal.symbol)}
          </span>
          {grade && (
            <span style={{
              fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 8, flexShrink: 0,
              background: gs.bg, color: gs.color, border: `1px solid ${gs.border}`,
            }}>
              {grade}
            </span>
          )}
        </div>
      </div>

      <div style={{ padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* 현재가 */}
        <div style={{
          padding: '10px 14px', borderRadius: 10,
          background: 'var(--bg2)', border: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>현재가</span>
          <span className="num" style={{ fontSize: 18, fontWeight: 700 }}>
            {priceLoading ? '조회 중...' : currentPrice ? fmtPrice(currentPrice) : '—'}
          </span>
        </div>

        {/* T-062 해외: 유효 시간(미국 정규장) · 실적 한 줄 */}
        {overseas && (
          <OverseasDetailLines validFrom={signal.valid_from} expiresAt={signal.expires_at} indicators={ind} />
        )}

        {/* AI 평가 — 표시할 항목이 하나도 없으면 빈 껍데기 섹션을 남기지 않는다 */}
        {hasAiEval(evalItems) && (
          <section style={sx.section}>
            <div style={sx.sectionLabel}>AI 평가</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {grade && (
                <div style={{ ...sx.kpiBox, background: gs.bg, border: `1px solid ${gs.border}` }}>
                  <div style={{ fontSize: 11, color: gs.color, fontWeight: 700 }}>등급</div>
                  <div className="num" style={{ fontSize: 22, fontWeight: 700, color: gs.color }}>{grade}</div>
                </div>
              )}
              {/* EV 결측·비유한이면 박스 자체를 렌더하지 않는다 — 과거 `NaN%` 노출 지점 */}
              {evalItems.evPct !== null && (
                <div style={sx.kpiBox}>
                  <div style={sx.kpiLabel}>EV</div>
                  <div className="num" style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>
                    {evalItems.evPct}%
                  </div>
                </div>
              )}
              {evalItems.targetPct !== null && (
                <div style={sx.kpiBox}>
                  <div style={sx.kpiLabel}>목표</div>
                  <div className="num" style={{ fontSize: 16, fontWeight: 700, color: 'var(--up)' }}>+{evalItems.targetPct}%</div>
                </div>
              )}
              {evalItems.stopPct !== null && (
                <div style={sx.kpiBox}>
                  <div style={sx.kpiLabel}>손절</div>
                  <div className="num" style={{ fontSize: 16, fontWeight: 700, color: 'var(--down)' }}>{evalItems.stopPct}%</div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* 왜 지금? */}
        {sc?.why_now && (
          <section style={sx.section}>
            <div style={sx.sectionLabel}>왜 지금?</div>
            <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>{sc.why_now}</div>
          </section>
        )}

        {/* 리스크 요인 — 결측이면 섹션 미표시 (🔴 T-021 크래시 지점) */}
        {risks.length > 0 && (
          <section style={sx.section}>
            <div style={sx.sectionLabel}>리스크 요인</div>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {risks.map((r, i) => (
                <li key={i} style={{ fontSize: 13, color: '#f59e0b', lineHeight: 1.5 }}>{r}</li>
              ))}
            </ul>
          </section>
        )}

        {/* 분석 사유 (시나리오 없을 때 전략 엔진 reasoning 표시, 있어도 보조로 표시) */}
        {signal.reasoning && (
          <section style={sx.section}>
            <div style={sx.sectionLabel}>{sc ? '분석 사유' : '시그널 생성 사유'}</div>
            {!sc && (
              <div style={{
                fontSize: 11, color: 'var(--accent)', background: 'rgba(245,158,11,.08)',
                padding: '6px 10px', borderRadius: 8, marginBottom: 4,
              }}>
                ⚠ AI 시나리오 평가 없음 — 규칙 기반 시그널
              </div>
            )}
            <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
              {signal.reasoning}
            </div>
          </section>
        )}

        {/* AI 진입 구간 참고 — entry 객체 자체가 없어도 안전. 해외는 달러 주표기(T-062) */}
        <AiEntryZoneBox overseas={overseas} indicators={ind} domesticZone={aiEntryZone} />

        {/* ─── 진입 설정 ─── */}
        <section style={sx.section}>
          <div style={sx.sectionLabel}>진입 설정</div>

          {/* 분할 횟수 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 10 }}>
            {([1, 2, 3, 4] as const).map(n => (
              <button
                key={n}
                onClick={() => handleSplitsChange(n)}
                style={{
                  height: 40, borderRadius: 8, fontSize: 13, fontWeight: 700,
                  background: splits === n ? 'rgba(99,102,241,.2)' : 'var(--bg3)',
                  color: splits === n ? '#818cf8' : 'var(--muted)',
                  border: `2px solid ${splits === n ? 'rgba(99,102,241,.5)' : 'var(--border2)'}`,
                }}
              >
                {n === 1 ? '1회' : `${n}분할`}
              </button>
            ))}
          </div>

          {/* 보유 수량 표시 (매도) */}
          {signal.side === 'sell' && holdingQty > 0 && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
              보유 수량: <span className="num" style={{ color: 'var(--text)', fontWeight: 700 }}>{holdingQty}주</span>
            </div>
          )}

          {/* 슬라이스 카드 */}
          {sliceInputs.map((s, i) => {
            const usedQty = signal.side === 'sell'
              ? sliceInputs.slice(0, i).reduce((acc, sl) => acc + (parseInt(sl.qty, 10) || 0), 0)
              : 0;
            const remaining = signal.side === 'sell' ? Math.max(0, holdingQty - usedQty) : Infinity;
            const disabled = signal.side === 'sell' && remaining <= 0;

            return (
              <div key={i} style={{
                background: 'var(--bg)', border: '1px solid var(--border2)',
                borderRadius: 10, padding: '12px 12px', marginBottom: 8,
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginBottom: 10 }}>
                  {i + 1}회차
                  {splits > 1 && (
                    <span style={{ fontWeight: 500, color: 'var(--muted)', marginLeft: 6 }}>
                      {signal.side === 'buy'
                        ? i === 0 ? '(1차 매수)' : i === splits - 1 ? '(최종 매수)' : ''
                        : i === splits - 1 ? '(최종 익절)' : '(익절)'}
                    </span>
                  )}
                </div>

                {/* % 구간 */}
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 4 }}>
                  진입 구간 (현재가 대비 %)
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <input
                    type="number" value={s.zoneLoPct} step="0.1"
                    onChange={e => updateSlicePct(i, 'zoneLoPct', e.target.value)}
                    placeholder={signal.side === 'buy' ? '-2.0' : '+0.5'}
                    style={inputStyle}
                  />
                  <span style={{ color: 'var(--muted)', flexShrink: 0 }}>~</span>
                  <input
                    type="number" value={s.zoneHiPct} step="0.1"
                    onChange={e => updateSlicePct(i, 'zoneHiPct', e.target.value)}
                    placeholder={signal.side === 'buy' ? '-0.5' : '+2.0'}
                    style={inputStyle}
                  />
                  <span style={{ color: 'var(--muted)', flexShrink: 0, fontSize: 13, fontWeight: 700 }}>%</span>
                </div>
                {/* KRW 미리보기 */}
                {s.zoneLo && s.zoneHi && Number.isFinite(parseFloat(s.zoneLo)) && Number.isFinite(parseFloat(s.zoneHi)) && (
                  <div style={{ marginBottom: 8, fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>
                    {fmtPrice(parseFloat(s.zoneLo))} ~ {fmtPrice(parseFloat(s.zoneHi))}
                  </div>
                )}

                {/* 수량 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>수량 (주)</span>
                  {signal.side === 'sell' && holdingQty > 0 && (
                    <span style={{ fontSize: 11, color: disabled ? 'var(--danger)' : 'var(--muted)' }}>
                      잔여 <span className="num" style={{ fontWeight: 700, color: disabled ? 'var(--danger)' : 'var(--accent)' }}>{remaining === Infinity ? 0 : remaining}</span>주
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="number" inputMode="numeric" min="0" step="1"
                    value={disabled ? '0' : s.qty}
                    disabled={disabled}
                    onChange={e => {
                      if (signal.side === 'sell') {
                        const v = parseInt(e.target.value, 10);
                        const clamped = Number.isFinite(v) && v > (remaining as number) ? (remaining as number) : (Number.isFinite(v) ? v : 0);
                        updateSellQty(i, String(clamped));
                      } else {
                        updateBuyQty(i, e.target.value);
                      }
                    }}
                    placeholder={disabled ? '0' : '수량'}
                    style={{ ...inputStyle, opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'text' }}
                  />
                  {signal.side === 'sell' && !disabled && (
                    <button
                      onClick={() => updateSellQty(i, String(remaining))}
                      style={{
                        padding: '0 14px', height: 40, borderRadius: 8, fontSize: 13, fontWeight: 700,
                        background: 'rgba(59,130,246,.15)', color: 'var(--down)',
                        border: '1px solid rgba(59,130,246,.3)', flexShrink: 0,
                      }}
                    >잔량</button>
                  )}
                </div>

                {/* 예상 금액 */}
                {(() => {
                  const qty = parseInt(s.qty, 10);
                  const lo = parseFloat(s.zoneLo);
                  const hi = parseFloat(s.zoneHi);
                  if (!Number.isInteger(qty) || qty <= 0) return null;
                  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
                  const mid = roundToTick((lo + hi) / 2);
                  return (
                    <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>
                      예상 금액: <span className="num" style={{ color: 'var(--text)', fontWeight: 700 }}>{fmtPrice(qty * mid)}</span>
                      <span style={{ marginLeft: 4 }}>({qty}주 × {fmtPrice(mid)})</span>
                    </div>
                  );
                })()}
              </div>
            );
          })}

          {/* 설정내용 복사 */}
          {splits > 1 && (
            <button
              onClick={handleCopyFirst}
              style={{
                width: '100%', height: 38, borderRadius: 8, fontSize: 13, fontWeight: 600,
                background: 'rgba(99,102,241,.12)', color: '#818cf8',
                border: '1px solid rgba(99,102,241,.3)', marginTop: 2,
              }}
            >
              설정내용 복사 (1회차 → 전체)
            </button>
          )}

          {/* 폼 에러 */}
          {formError && (
            <div style={{
              fontSize: 13, color: 'var(--danger)', padding: '8px 12px',
              background: 'rgba(239,68,68,.1)', borderRadius: 8, border: '1px solid rgba(239,68,68,.3)',
            }}>
              {formError}
            </div>
          )}
        </section>

        {/* T-108 §2.4.3 — 승인 버튼 위 안내(데모 .gate). 실거래여부 ON 이면 빨간 상자 + 「실제 주문」 */}
        {(() => {
          const g = approveGateText(signal.side === 'sell' ? 'sell' : 'buy', liveTrading);
          return (
            <div className={cx(ops.gate, g.live && ops.bad)} style={{ margin: 0, fontSize: 12, lineHeight: 1.55 }}>
              등록하면 <b>진입 감시가 시작</b>{g.body}
              {g.live ? <> — 지금 실거래여부 ON = <b>실제 주문</b>.</> : '.'}
            </div>
          );
        })()}

      </div>

      {/* 하단 고정 버튼 */}
      <div style={{
        position: 'fixed', bottom: 60, left: 0, right: 0,
        padding: '12px 16px',
        background: 'var(--bg)', borderTop: '1px solid var(--border)',
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
        zIndex: 20,
      }}>
        {/* T-108 §2.4.3 결과 — 처리 중·성공·실패·차단·알 수 없음·거절 (버튼 위, 포커스 이동) */}
        {(submitting || rejecting || result) && (
          <div
            ref={resultRef}
            tabIndex={-1}
            className={cx(ops.res, !(submitting || rejecting) && result && (result.kind === 'ok' ? ops.ok : result.kind === 'rejected' ? null : ops.e))}
            style={{ gridColumn: '1 / -1', margin: 0 }}
          >
            {submitting || rejecting
              ? <><span className={ops.spin} aria-hidden="true" /> 처리 중… (다시 누를 수 없음)</>
              : result?.text}
          </div>
        )}
        <button
          onClick={handleApprove}
          disabled={submitting || rejecting || result?.kind === 'ok' || result?.kind === 'rejected'}
          style={{
            height: 52, borderRadius: 10, fontSize: 16, fontWeight: 700,
            background: submitting ? 'var(--bg3)' : 'var(--up)',
            color: submitting ? 'var(--muted)' : '#fff',
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? '처리 중...' : `✅ ${splits > 1 ? `${splits}분할 ` : ''}등록`}
        </button>
        <button
          onClick={handleReject}
          disabled={rejecting || submitting || result?.kind === 'ok' || result?.kind === 'rejected'}
          style={{
            height: 52, borderRadius: 10, fontSize: 16, fontWeight: 700,
            background: 'var(--bg3)', color: 'var(--muted)',
            border: '1px solid var(--border2)',
            opacity: rejecting ? 0.6 : 1,
          }}
        >
          {rejecting ? '처리 중...' : '거절'}
        </button>
      </div>
    </div>
  );
}

const sx: Record<string, React.CSSProperties> = {
  section: {
    background: 'var(--bg2)', borderRadius: 12,
    border: '1px solid var(--border)', padding: '12px 14px',
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  sectionLabel: {
    fontSize: 11, fontWeight: 700, color: 'var(--muted)',
    textTransform: 'uppercase', letterSpacing: '.5px',
  },
  kpiBox: {
    background: 'var(--bg)', border: '1px solid var(--border2)',
    borderRadius: 10, padding: '10px 14px',
    display: 'flex', flexDirection: 'column', gap: 4, minWidth: 72,
  },
  kpiLabel: {
    fontSize: 11, color: 'var(--muted)', fontWeight: 600,
  },
};
