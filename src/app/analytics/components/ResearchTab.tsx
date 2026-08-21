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
  note: string;
}

interface SellAssessment {
  action: 'sell' | 'hold' | 'insufficient_data';
  daysSinceEntry: number | null;
  gainPct: number | null;
  reason: 'target_reached' | 'duration_exceeded' | 'in_progress' | null;
  note: string;
}

interface Recommendation {
  asOfDate: string | null;
  buy: BuyRecommendation;
  sell: SellAssessment | null;
  holding: {
    entryPriceKRW: number;
    qty: number;
    daysSinceEntry: number | null;
    nowPriceKRW: number | null;
    targetProgressPct: number | null;
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
  short_history: '상장 이력이 짧아 표본이 부족합니다 — "패턴 없음"이 아니라 "아직 판단 불가"입니다.',
  no_events: '설정한 기준(저점 대비 급등)에 해당하는 구간이 관측되지 않았습니다.',
  insufficient_for_precursors: '이벤트가 없어 선행지표 분석을 수행하지 않았습니다.',
  pending_recent_trough: '최근 저점은 관측 기간이 남아 있어 판단을 보류했습니다.',
};

const pct = (v: number | null, digits = 1) => (v == null ? '—' : v.toFixed(digits) + '%');

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
      <div style={S.disclaimer}>
        과거 데이터의 <b>사후 관찰 통계</b>입니다. 자동매매에 연결돼 있지 않으며 매매 신호가 아닙니다.
      </div>

      {items.map((item) => {
        const r = item.result;
        const isOpen = expanded.has(item.symbol);
        const recent = r ? r.events.slice(-3).reverse() : [];

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
              <RecommendationBlock rec={item.recommendation} avgRallyPct={r.avgRallyPct} />
            )}

            {r && !r.error && (
              <>
                <div style={S.metricsRow}>
                  <Metric label="사이클 수" value={String(r.eventCount)} />
                  <Metric label="평균 상승" value={pct(r.avgRallyPct)} />
                  <Metric label="평균 소요" value={r.avgDaysToRally == null ? '—' : `${r.avgDaysToRally.toFixed(0)}일`} />
                </div>

                {r.dataRangeFrom && r.dataRangeTo && (
                  <div style={S.rangeText}>데이터 범위: {r.dataRangeFrom} ~ {r.dataRangeTo}</div>
                )}

                {recent.length > 0 && (
                  <div style={S.eventsWrap}>
                    <div style={S.subTitle}>최근 이벤트</div>
                    {recent.map((e, i) => (
                      <div key={i} style={S.eventRow}>
                        <span style={S.eventDate}>{e.troughDate} → {e.peakDate}</span>
                        <span style={S.eventRally}>+{e.rallyPct.toFixed(1)}%</span>
                        <span style={S.eventDays}>{e.daysToRally}일</span>
                        <span style={{
                          ...S.cycleChip,
                          color: e.confirmedCycle === true ? RESEARCH_COLOR : 'var(--muted)',
                        }}>
                          {e.confirmedCycle === true
                            ? `재하락 ${pct(e.declinePct)}`
                            : e.confirmedCycle === false ? '재하락 없음' : '관측중'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

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

/**
 * 매수/매도 "고려" 배지 — T-033.
 *
 * 🔴 문구 규율:
 *  - "확률"이라고 쓰지 않는다. 우리가 가진 건 **과거 조건부 적중률**뿐이다.
 *  - 표본이 적으면 추천 대신 "판단 보류(표본부족)"를 보여준다.
 *  - 기준일(`asOfDate`)을 항상 함께 노출한다 — 국내는 전일 종가, 해외는 당일 종가 기준이라
 *    실시간이 아니다. 이걸 감추면 사용자가 "지금 값"으로 오해한다.
 *  - 면책 문구(`note`)를 배지 바로 아래에 붙인다.
 */
function RecommendationBlock({ rec, avgRallyPct }: { rec: Recommendation; avgRallyPct: number | null }) {
  const { buy, sell, holding } = rec;
  const asOf = rec.asOfDate ? `${rec.asOfDate} 종가 기준` : '기준일 데이터 없음';

  const buyBadge =
    buy.action === 'buy'
      ? { icon: '🟢', text: '매수 고려', color: '#ef4444' }
      : buy.action === 'hold'
        ? { icon: '⚪', text: '관망', color: 'var(--muted)' }
        : { icon: '⚪', text: '판단 보류(표본부족)', color: 'var(--muted)' };

  const sellBadge = !sell
    ? null
    : sell.action === 'sell'
      ? { icon: '🔴', text: '매도 고려', color: '#3b82f6' }
      : sell.action === 'hold'
        ? { icon: '⚪', text: '보유 관망', color: 'var(--muted)' }
        : { icon: '⚪', text: '매도 판단 보류(표본부족)', color: 'var(--muted)' };

  const evidence =
    buy.ruleLabel != null && buy.precision != null
      ? `${buy.ruleLabel} — 과거 적중률 ${(buy.precision * 100).toFixed(0)}%(${buy.triggerCount}건 중 ${Math.round(buy.precision * buy.triggerCount)}건)` +
        (buy.lift != null ? ` · lift ×${buy.lift.toFixed(2)}` : '') +
        (buy.confidence ? ` · 표본 신뢰도 ${CONFIDENCE_KO[buy.confidence] ?? buy.confidence}` : '')
      : buy.action === 'hold'
        ? '기준일 종가에서 충족한 선행지표 규칙이 없습니다.'
        : '판단에 쓸 만한 과거 표본이 부족합니다.';

  const sellReason = !sell
    ? null
    : sell.action === 'insufficient_data'
      ? '리서치 표본이 부족해 매도 판단을 보류합니다.'
      : [
          avgRallyPct != null
            ? `목표(과거평균 ${avgRallyPct >= 0 ? '+' : ''}${avgRallyPct.toFixed(1)}%) 대비 ${holding?.targetProgressPct != null ? `${holding.targetProgressPct.toFixed(0)}% 진행` : '진행률 데이터 없음'}`
            : '목표 데이터 없음',
          sell.daysSinceEntry != null ? `보유 ${sell.daysSinceEntry}일째` : '보유기간 데이터 없음',
          sell.reason === 'duration_exceeded' ? '과거 평균 소요기간 초과' : null,
        ].filter(Boolean).join(' · ');

  return (
    <div style={S.recWrap}>
      <div style={S.recBadgeRow}>
        <span style={{ ...S.recBadge, color: buyBadge.color }}>{buyBadge.icon} {buyBadge.text}</span>
        {sellBadge && (
          <span style={{ ...S.recBadge, color: sellBadge.color }}>{sellBadge.icon} {sellBadge.text}</span>
        )}
        <span style={S.recAsOf}>{asOf}</span>
      </div>
      <div style={S.recEvidence}>근거: {evidence}</div>
      {sellReason && <div style={S.recEvidence}>보유: {sellReason}</div>}
      <div style={S.noteText}>{buy.note}</div>
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 60 }}>
      <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)' }}>{value}</div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  center: { textAlign: 'center', padding: 40, color: 'var(--muted)' },
  empty: { textAlign: 'center', padding: '32px 16px', color: 'var(--muted)', fontSize: 13, lineHeight: 1.8 },
  list: { display: 'flex', flexDirection: 'column', gap: 12 },
  disclaimer: {
    fontSize: 11, color: 'var(--muted)', lineHeight: 1.6,
    background: 'var(--bg3)', borderRadius: 10, padding: '8px 12px',
  },
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
  metricsRow: { display: 'flex', gap: 18, paddingTop: 2 },
  rangeText: { fontSize: 10, color: 'var(--muted)' },
  subTitle: { fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 6 },
  eventsWrap: { display: 'flex', flexDirection: 'column', gap: 4 },
  eventRow: {
    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    background: 'var(--bg3)', borderRadius: 8, padding: '7px 10px', fontSize: 11,
  },
  eventDate: { color: 'var(--muted)', flex: 1, minWidth: 130 },
  eventRally: { color: 'var(--red)', fontWeight: 700, fontSize: 12 },
  eventDays: { color: 'var(--muted)' },
  cycleChip: { fontSize: 10, fontWeight: 600 },
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
