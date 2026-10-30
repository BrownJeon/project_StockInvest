'use client';

/**
 * 분석 탭 → "리서치" 서브탭 (T-032).
 *
 * 즐겨찾기에서 추적을 켠 종목의 급등·급락 사이클 통계를 보여준다.
 * 카드 구조는 FavoritesPage 와 동일하게 유지한다(헤더+배지 → 요약 → 경고).
 * 매매 지시가 아니라 **관찰 결과**임을 화면에서 명시한다 — 자동매매와 연결돼 있지 않다.
 */
import { useCallback, useEffect, useState } from 'react';
import { formatSymbolShort } from '@/lib/symbols';
import {
  displayableBuyZone,
  displayableSellTarget,
  formatTargetPrice,
  unreachableReasonKo,
} from '@/lib/research/pattern/price-targets';
import { targetVsEntryPct } from '@/lib/research/pattern/recommendation';
import { isFxConverted, isFxFallback, type DisplayAmount } from '@/lib/display-amount';
import type { PriceTargets } from '@/lib/research/types';

const RESEARCH_COLOR = '#14b8a6';

interface RallyEvent {
  troughDate: string;
  peakDate: string;
  rallyPct: number;
  daysToRally: number;
  confirmedCycle: boolean | null;
  declinePct: number | null;
}

interface PrecursorRuleStat {
  id: string;
  label: string;
  triggerCount: number;
  hitCount: number;
  precision: number | null;
  lift: number | null;
}

interface PrecursorAnalysis {
  evaluatedDays: number;
  positiveDays: number;
  baseRate: number | null;
  labelToleranceDays: number;
  lowSampleWarning: boolean;
  note: string;
  rules: PrecursorRuleStat[];
}

interface ResearchResult {
  symbol: string;
  market: string;
  runDate: string;
  dataRangeFrom: string | null;
  dataRangeTo: string | null;
  eventCount: number;
  events: RallyEvent[];
  avgRallyPct: number | null;
  avgDaysToRally: number | null;
  precursorAnalysis: PrecursorAnalysis | null;
  todayActiveRuleIds: string[] | null;
  dataWarnings: string[];
  error: string | null;
  createdAt: string | null;
}

/** T-033 — 매수 추천. `precision` 은 확률이 아니라 **과거 조건부 적중률**이다. */
interface BuyRecommendation {
  action: 'buy' | 'hold' | 'insufficient_data';
  ruleId: string | null;
  ruleLabel: string | null;
  precision: number | null;
  lift: number | null;
  triggerCount: number;
  confidence: 'low' | 'medium' | 'high' | null;
  /** 차트 게이트로 buy → hold 로 내려간 사유 — T-034 */
  downgradeReason: 'no_support_level' | 'buy_zone_unreachable' | null;
  note: string;
}

interface SellAssessment {
  action: 'sell' | 'hold' | 'insufficient_data';
  /** 보유 달력일 — **표시 전용**. 매도 판정에 쓰지 않는다(T-034에서 기간초과 판정 폐기) */
  daysSinceEntry: number | null;
  /** 진입가 대비 손익(%) — **사용자 참고 표시 전용**. 목표가·판정과 무관하다(T-034) */
  gainPct: number | null;
  reason: 'target_reached' | 'in_progress' | null;
  horizonDays: number | null;
  note: string;
}

interface Recommendation {
  asOfDate: string | null;
  /** T-034 — 차트 기반 목표가. 통화는 `targets.currency`(해외 종목은 USD) */
  targets: PriceTargets | null;
  buy: BuyRecommendation;
  sell: SellAssessment | null;
  holding: {
    entryPriceKRW: number;
    qty: number;
    daysSinceEntry: number | null;
    nowPriceKRW: number | null;
    /**
     * T-035 — 화면 표기용 금액. 해외 종목은 USD, 국내는 KRW.
     * 🔴 달러 진입가는 **현재 환율 환산본**이지 매수 당시 체결가가 아니다(아래 문구로 고지).
     * 구버전 API 응답에는 없을 수 있으므로 optional 로 받고 KRW 로 폴백한다.
     */
    display?: {
      entryPrice: DisplayAmount;
      nowPrice: DisplayAmount;
    } | null;
  } | null;
}

interface TrackedItem {
  symbol: string;
  name: string | null;
  market: string;
  result: ResearchResult | null;
  recommendation: Recommendation | null;
}

const WARNING_KO: Record<string, string> = {
  short_history: '상장 이력이 짧아 건수가 적습니다 — "패턴 없음"이 아니라 "아직 판단 불가"입니다.',
  no_events: '설정한 기준(저점 대비 급등)에 해당하는 구간이 관측되지 않았습니다.',
  insufficient_for_precursors: '이벤트가 없어 선행지표 분석을 수행하지 않았습니다.',
  pending_recent_trough: '최근 저점은 관측 기간이 남아 있어 판단을 보류했습니다.',
};

const pct = (v: number | null, digits = 1) => (v == null ? '—' : v.toFixed(digits) + '%');
const krw = (v: number | null) => (v == null ? '—' : '₩' + Math.round(v).toLocaleString('ko-KR'));

/**
 * 종목별 금액 표기 (T-035) — 해외는 달러, 국내는 원화.
 *
 * 목표가와 **같은 포맷터**(`formatTargetPrice`)를 쓴다. 한 줄 안에서 목표가는 `$`, 진입가는 `₩`
 * 로 갈리던 것이 사용자가 지적한 문제였으므로 표기가 어긋날 여지를 남기지 않는다.
 * 달러로 못 바꿨으면(시세 조회 실패 등) 원화로 폴백하고 그 사실을 함께 적는다 —
 * 숫자를 지어내거나 기호만 바꾸지 않는다.
 *
 * @param fallbackKRW `display` 가 없는 구버전 응답을 위한 원화 원본
 */
function amount(d: DisplayAmount | null | undefined, fallbackKRW: number | null): string {
  if (!d || d.value == null) return krw(fallbackKRW);
  const main = formatTargetPrice(d.value, d.currency);
  return isFxFallback(d) ? `${main}(달러 환산 불가)` : main;
}

/** "지금 분석" 직후 화면상 확인 수단 — 값이 이전과 동일해도 이 시각은 항상 바뀐다. */
function formatKstTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' });
}

export function ResearchTab() {
  const [items, setItems] = useState<TrackedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [runError, setRunError] = useState<Map<string, string>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/research/tracked');
      const json = await res.json() as { ok: boolean; data?: TrackedItem[]; error?: string };
      if (json.ok && json.data) {
        setItems(json.data);
        setError(null);
      } else {
        setError(json.error ?? '불러오지 못했습니다.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function toggle(symbol: string) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(symbol)) n.delete(symbol); else n.add(symbol);
      return n;
    });
  }

  /**
   * 장마감까지 기다리지 않고 지금 바로 재분석 (T-032 후속).
   * 서버는 심볼당 8초 상한(SYMBOL_TIMEOUT_MS)을 걸지만, 클라이언트도 별도로 12초 타임아웃을
   * 둔다 — 네트워크 구간에서 응답이 아예 안 오는 경우까지 대비해 버튼이 "분석 중..."에 무한정
   * 멈춰 있지 않게 하기 위함(방어적 이중화).
   */
  async function runNow(symbol: string) {
    if (running.has(symbol)) return;
    setRunning((s) => new Set(s).add(symbol));
    setRunError((m) => { const n = new Map(m); n.delete(symbol); return n; });
    try {
      const res = await fetch(`/api/research/tracked/${encodeURIComponent(symbol)}/run`, {
        method: 'POST',
        signal: AbortSignal.timeout(12_000),
      });
      const json = await res.json() as { ok: boolean; data?: TrackedItem; error?: string };
      if (json.ok && json.data) {
        setItems((prev) => prev.map((i) => (i.symbol === symbol ? json.data as TrackedItem : i)));
      } else {
        setRunError((m) => new Map(m).set(symbol, json.error ?? '분석에 실패했습니다.'));
      }
    } catch (e) {
      const timedOut = e instanceof Error && e.name === 'TimeoutError';
      setRunError((m) => new Map(m).set(symbol, timedOut ? '응답이 너무 오래 걸려 중단했습니다.' : (e instanceof Error ? e.message : String(e))));
    } finally {
      setRunning((s) => { const n = new Set(s); n.delete(symbol); return n; });
    }
  }

  if (loading) return <div style={S.center}>로딩 중...</div>;
  if (error) return <div style={S.center}>{error}</div>;

  if (items.length === 0) {
    return (
      <div style={S.empty}>
        추적 중인 종목이 없습니다.
        <br />
        즐겨찾기 종목 상세에서 <b>리서치 추적</b>을 켜보세요.
      </div>
    );
  }

  return (
    <div style={S.list}>
      {items.map((item) => {
        const r = item.result;
        const isOpen = expanded.has(item.symbol);

        return (
          <div key={item.symbol} style={S.card}>
            <div style={S.cardHeader}>
              <div style={S.cardTitle}>
                {item.name ?? formatSymbolShort(item.symbol)}
                <span style={S.cardCode}>{formatSymbolShort(item.symbol)}</span>
                <span style={{ ...S.badge, background: RESEARCH_COLOR + '22', color: RESEARCH_COLOR }}>
                  추적중
                </span>
                <span style={S.marketChip}>{item.market === 'overseas' ? '해외' : '국내'}</span>
              </div>
              <div style={S.headerRight}>
                {r && (
                  <span style={S.runDate}>
                    {r.runDate} 분석{formatKstTime(r.createdAt) ? ` (${formatKstTime(r.createdAt)} 갱신)` : ''}
                  </span>
                )}
                <button
                  style={S.runNowBtn}
                  disabled={running.has(item.symbol)}
                  onClick={() => void runNow(item.symbol)}
                >
                  {running.has(item.symbol) ? '분석 중...' : '지금 분석'}
                </button>
              </div>
            </div>

            {runError.has(item.symbol) && (
              <div style={S.errorBox}>지금 분석 실패: {runError.get(item.symbol)}</div>
            )}

            {!r && <div style={S.pending}>아직 분석 결과가 없습니다 — 다음 장 마감 후 생성됩니다. 기다리지 않으려면 위 "지금 분석"을 눌러주세요.</div>}

            {r?.error && <div style={S.errorBox}>분석 실패: {r.error}</div>}

            {r && !r.error && item.recommendation && (
              <RecommendationBlock rec={item.recommendation} />
            )}

            {r && !r.error && (
              <>
                {r.dataWarnings.length > 0 && (
                  <div style={S.warnWrap}>
                    {r.dataWarnings.map((w) => (
                      <div key={w} style={S.warnRow}>⚠ {WARNING_KO[w] ?? w}</div>
                    ))}
                  </div>
                )}

                {r.precursorAnalysis && (
                  <>
                    <button style={S.expandBtn} onClick={() => toggle(item.symbol)}>
                      {isOpen ? '선행지표 접기' : '선행지표 보기'}
                    </button>
                    {isOpen && <PrecursorPanel analysis={r.precursorAnalysis} />}
                  </>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

const CONFIDENCE_KO: Record<string, string> = { low: '낮음', medium: '보통', high: '높음' };

const DOWNGRADE_KO: Record<string, string> = {
  no_support_level: '현재가 아래 지지 근거가 없어 매수 희망가를 제시할 수 없습니다.',
  buy_zone_unreachable: '가장 가까운 지지선이 기한 내 기대 변동폭 밖이라 매수를 권하지 않습니다.',
};

/**
 * 매수/매도 "고려" — T-033, 목표가 차트 기반 재설계 T-034.
 *
 * 🔴 문구 규율:
 *  - "확률"이라고 쓰지 않는다. 우리가 가진 건 **과거 조건부 적중률**뿐이다.
 *  - 표본이 적으면 추천 대신 "판단 보류(표본부족)"를 보여준다.
 *  - **기한 내 도달 근거가 없으면 목표가 숫자를 만들어 보여주지 않는다** — 대신 그 사실을 쓴다.
 *  - 기준일(`asOfDate`)을 항상 함께 노출한다 — 국내는 전일 종가, 해외는 당일 종가 기준이라
 *    실시간이 아니다. 이걸 감추면 사용자가 "지금 값"으로 오해한다.
 *  - 목표가는 **차트 레벨**이며 진입가·손익과 무관하다. 통화 기호(`$`/`₩`)를 항상 붙인다.
 *  - T-035 — 종목별 금액(진입가·현재가)도 목표가와 **같은 통화**로 찍는다(해외는 USD).
 *    한 줄 안에서 목표가만 `$`, 진입가는 `₩` 로 갈리던 것이 사용자가 지적한 문제였다.
 *    🔴 달러 진입가는 **현재 환율 환산본**이며 매수 당시 체결가가 아니다 — 원화 원본과 함께
 *    그 사실을 문구(`fxNote`)로 반드시 노출한다.
 *  - 전부 **참고치**다(도달·기한 준수를 보장하지 않는다) — 면책 문구를 항상 동반.
 */
function RecommendationBlock({ rec }: { rec: Recommendation }) {
  const { buy, sell, holding, targets } = rec;
  const asOf = rec.asOfDate ? `${rec.asOfDate} 종가 기준` : '기준일 데이터 없음';
  // "기한"은 오직 **목표가 도달 판단 창**을 뜻한다 — 보유기간과 무관하다(T-034).
  const horizonText = targets
    ? `분석 기준일로부터 ${targets.horizonDays}일 이내`
    : '기한 데이터 없음';

  const buyBadge =
    buy.action === 'buy'
      ? { icon: '🟢', text: '매수 고려', color: '#ef4444' }
      : buy.action === 'hold'
        ? { icon: '⚪', text: '관망', color: 'var(--muted)' }
        : { icon: '⚪', text: '판단 보류(건수 적음)', color: 'var(--muted)' };

  const sellBadge = !sell
    ? null
    : sell.action === 'sell'
      ? { icon: '🔴', text: '매도 고려', color: '#3b82f6' }
      : sell.action === 'hold'
        ? { icon: '⚪', text: '보유 관망', color: 'var(--muted)' }
        : { icon: '⚪', text: '매도 판단 보류', color: 'var(--muted)' };

  const buyHint =
    buy.action === 'hold'
      ? (buy.downgradeReason
          ? DOWNGRADE_KO[buy.downgradeReason]
          : '오늘 종가 기준 충족한 선행지표 조건이 없습니다.')
      : buy.action === 'insufficient_data'
        ? `판단에 쓸 과거 건수가 적습니다${buy.triggerCount > 0 ? `(트리거 ${buy.triggerCount}건)` : ''}.`
        : null;

  const buyZone = displayableBuyZone(targets);
  const sellTarget = displayableSellTarget(targets);

  /**
   * 매도 목표가 옆에 **사용자가 산 금액**을 함께 보여준다(사용자 요청).
   * 보유 중일 때만 붙으며 **표시 전용** — 매도 판정은 여전히 차트 목표가 기준이다.
   *
   * 🔴 통화 주의: 목표가는 캔들 통화(해외는 USD), 진입가는 KRW 라 나란히 두면 대소 비교가
   * 불가능하다. 그래서 금액과 **함께** `targetVsEntryPct`(같은 통화끼리의 비 두 개를 곱해
   * 통화를 섞지 않고 구한 값)로 "목표가가 내 진입가 대비 몇 %인지"를 붙인다 —
   * 목표가에 팔면 이득인지 손해인지가 이 숫자 하나로 드러난다.
   */
  const entryPct = targetVsEntryPct(sellTarget?.price, targets?.asOfPrice, sell?.gainPct);
  // T-035 — 진입가도 목표가와 **같은 통화**로 찍는다(해외는 USD). 통화가 한 줄에서 섞이던 것이
  // 사용자가 지적한 문제였다. 값 자체는 환산 전 KRW 를 쓴 `entryPct` 와 독립이다.
  const entryDisplay = holding ? amount(holding.display?.entryPrice, holding.entryPriceKRW) : '—';
  const entryComparison = holding?.entryPriceKRW
    ? ` · 내 진입가 ${entryDisplay}`
      + (entryPct != null ? ` 대비 ${entryPct >= 0 ? '+' : ''}${entryPct.toFixed(1)}%` : '')
    : '';

  /**
   * 🔴 달러 진입가는 **현재 시세의 환율로 환산한 값**이지 매수 당시 체결가가 아니다.
   * DB 에는 원화 진입가만 있고 매수 시점 환율은 남아 있지 않다. 환율이 움직였으면 실제
   * 체결 단가와 다르므로, 원화 원본과 함께 이 성격을 반드시 드러낸다.
   */
  const fxNote = isFxConverted(holding?.display?.entryPrice)
    ? `달러 금액은 현재 시세 기준 환율로 환산한 값입니다 — 진입가 ${krw(holding?.entryPriceKRW ?? null)}(원화 기록)의 환산본이며 매수 당시 체결가가 아닙니다.`
    : null;

  // 🔴 매도 사유는 **차트 문장만** 나온다. 보유기간·손익은 아래 "보유" 정보 줄로 분리했다.
  const sellReasonText =
    !sell ? null
      : sell.action === 'insufficient_data' ? `${unreachableReasonKo(targets, 'sell')} — 매도 판단을 보류합니다.`
      : sell.reason === 'target_reached'
        ? (targets?.sellTarget == null
            ? '현재가 위에 저항 근거가 없습니다(저항선 돌파).'
            : '현재가가 매도 목표가(저항선)에 근접했습니다.')
        : '아직 매도 목표가(저항선) 아래입니다.';

  return (
    <div style={S.recWrap}>
      {/* ── 차트 목표가: 포지션과 무관한 분석 결과라 배지보다 먼저, 한 번만 보여준다 ── */}
      <div style={S.recBadgeRow}>
        <span style={S.recBadge}>🎯 차트 목표가</span>
        <span style={S.recAsOf}>{asOf}</span>
      </div>
      <div style={S.predictWrap}>
        <PredictRow
          label="현재가"
          value={targets ? formatTargetPrice(targets.asOfPrice, targets.currency) : '—'}
        />
        <PredictRow
          label="매수"
          value={buyZone && targets
            ? `${formatTargetPrice(buyZone.price, targets.currency)} · ${buyZone.basis}`
            : unreachableReasonKo(targets, 'buy')}
        />
        <PredictRow
          label="매도"
          value={sellTarget && targets
            ? `${formatTargetPrice(sellTarget.price, targets.currency)} · ${sellTarget.basis}${entryComparison}`
            : unreachableReasonKo(targets, 'sell')}
        />
        <PredictRow label="기한" value={horizonText} />
      </div>

      {/* ── 매수 판단 ── */}
      <div style={S.recBadgeRow}>
        <span style={{ ...S.recBadge, color: buyBadge.color }}>{buyBadge.icon} {buyBadge.text}</span>
      </div>
      {buy.action === 'buy' ? (
        <div style={S.recEvidence}>
          근거: {buy.ruleLabel ?? '—'} — 과거 적중률{' '}
          {pct(buy.precision != null ? buy.precision * 100 : null, 0)}
          {` (${buy.triggerCount}건 중 ${buy.precision != null ? Math.round(buy.precision * buy.triggerCount) : '—'}건)`}
          {buy.confidence ? ` · 표본 신뢰도 ${CONFIDENCE_KO[buy.confidence] ?? buy.confidence}` : ''}
        </div>
      ) : (
        buyHint && <div style={S.recEvidence}>{buyHint}</div>
      )}

      {/* ── 매도 판단(보유중일 때만) ── */}
      {sellBadge && (
        <>
          <div style={S.recBadgeRow}>
            <span style={{ ...S.recBadge, color: sellBadge.color }}>{sellBadge.icon} {sellBadge.text}</span>
          </div>
          {sellReasonText && <div style={S.recEvidence}>{sellReasonText}</div>}
          {/* 🔴 진입가·손익·보유일수는 **참고 정보**다 — 위 목표가·매도 판정에는 쓰이지 않는다 */}
          <div style={S.predictWrap}>
            <PredictRow
              label="보유"
              value={`진입가 ${entryDisplay} · 현재가 ${amount(holding?.display?.nowPrice, holding?.nowPriceKRW ?? null)}`
                + `${sell?.gainPct != null ? ` (${sell.gainPct >= 0 ? '+' : ''}${sell.gainPct.toFixed(1)}%)` : ''}`
                + `${sell?.daysSinceEntry != null ? ` · ${sell.daysSinceEntry}일째` : ''}`}
            />
            <div style={S.noteText}>위 보유 정보는 참고용이며 매도 판단 근거가 아닙니다 — 판단은 차트 목표가 기준입니다.</div>
            {fxNote && <div style={S.noteText}>{fxNote}</div>}
          </div>
        </>
      )}

      <div style={S.noteText}>{buy.note}</div>
    </div>
  );
}

/** 라벨 + 값 한 줄. 사용자가 원한 "얼마에·언제까지" 형식. */
function PredictRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={S.predictRow}>
      <span style={S.predictLabel}>{label}</span>
      <span style={S.predictValue}>{value}</span>
    </div>
  );
}

function PrecursorPanel({ analysis }: { analysis: PrecursorAnalysis }) {
  // lift 높은 순 — 다만 표본이 작으면 순위 자체가 의미 없다는 경고를 함께 띄운다.
  const sorted = [...analysis.rules].sort((a, b) => (b.lift ?? -1) - (a.lift ?? -1));
  return (
    <div style={S.precursorWrap}>
      <div style={S.precursorMeta}>
        평가 {analysis.evaluatedDays}일 · 양성 {analysis.positiveDays}일
        {analysis.baseRate != null && ` · 기저율 ${(analysis.baseRate * 100).toFixed(1)}%`}
        {` · 라벨 ±${analysis.labelToleranceDays}일`}
      </div>
      {analysis.lowSampleWarning && (
        <div style={S.warnRow}>⚠ 양성 표본이 너무 적습니다 — 아래 수치는 통계적 근거로 쓸 수 없습니다.</div>
      )}
      <div style={S.ruleTable}>
        {sorted.map((rule) => (
          <div key={rule.id} style={S.ruleRow}>
            <span style={S.ruleLabel}>{rule.label}</span>
            <span style={S.ruleStat}>{rule.hitCount}/{rule.triggerCount}</span>
            <span style={S.ruleStat}>{rule.precision == null ? '—' : (rule.precision * 100).toFixed(0) + '%'}</span>
            <span style={{ ...S.ruleStat, color: (rule.lift ?? 0) > 1 ? RESEARCH_COLOR : 'var(--muted)' }}>
              {rule.lift == null ? '—' : '×' + rule.lift.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
      <div style={S.noteText}>{analysis.note}</div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  center: { textAlign: 'center', padding: 40, color: 'var(--muted)' },
  empty: { textAlign: 'center', padding: '32px 16px', color: 'var(--muted)', fontSize: 13, lineHeight: 1.8 },
  list: { display: 'flex', flexDirection: 'column', gap: 12 },
  card: {
    background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14,
    padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10,
  },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: 700, color: 'var(--fg)', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  cardCode: { fontSize: 11, color: 'var(--muted)', fontWeight: 400 },
  badge: { fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10 },
  marketChip: { fontSize: 10, color: 'var(--muted)', background: 'var(--bg3)', padding: '2px 6px', borderRadius: 8 },
  headerRight: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 },
  runDate: { fontSize: 10, color: 'var(--muted)' },
  runNowBtn: {
    background: 'var(--bg3)', border: 'none', borderRadius: 8,
    color: 'var(--fg)', fontSize: 11, padding: '5px 10px', cursor: 'pointer',
    minHeight: 28,
  },
  pending: { fontSize: 12, color: 'var(--muted)' },
  errorBox: { fontSize: 12, color: 'var(--red)', lineHeight: 1.5, wordBreak: 'break-all' },
  warnWrap: { display: 'flex', flexDirection: 'column', gap: 4 },
  warnRow: { fontSize: 11, color: '#f59e0b', lineHeight: 1.5 },
  expandBtn: {
    background: 'transparent', border: 'none', color: 'var(--accent)',
    fontSize: 11, cursor: 'pointer', padding: '6px 0', textAlign: 'left', minHeight: 32,
  },
  recWrap: {
    display: 'flex', flexDirection: 'column', gap: 5,
    background: 'var(--bg3)', borderRadius: 10, padding: '9px 12px',
  },
  recBadgeRow: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  recBadge: { fontSize: 12, fontWeight: 700 },
  recAsOf: { fontSize: 10, color: 'var(--muted)', marginLeft: 'auto' },
  recEvidence: { fontSize: 11, color: 'var(--fg)', lineHeight: 1.6 },
  predictWrap: { display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 2 },
  predictRow: { display: 'flex', gap: 8, fontSize: 11, lineHeight: 1.5 },
  predictLabel: { color: 'var(--muted)', minWidth: 32, flexShrink: 0 },
  predictValue: { color: 'var(--fg)' },
  precursorWrap: { display: 'flex', flexDirection: 'column', gap: 8 },
  precursorMeta: { fontSize: 10, color: 'var(--muted)' },
  ruleTable: { display: 'flex', flexDirection: 'column', gap: 3 },
  ruleRow: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: 'var(--bg3)', borderRadius: 8, padding: '6px 10px', fontSize: 11,
  },
  ruleLabel: { flex: 1, color: 'var(--fg)', minWidth: 0 },
  ruleStat: { color: 'var(--muted)', fontVariantNumeric: 'tabular-nums', minWidth: 40, textAlign: 'right' },
  noteText: { fontSize: 10, color: 'var(--muted)', lineHeight: 1.6 },
};
