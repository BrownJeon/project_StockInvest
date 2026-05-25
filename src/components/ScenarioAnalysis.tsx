'use client';

import type { ScenarioCard, ScenarioGrade } from '@/lib/signals/scenario-builder';
import type { BuilderValues } from './ScenarioBuilder';

interface AnalysisResult {
  market?: 'domestic' | 'overseas';
  grade: ScenarioGrade;
  ev: number;
  pWin: number;
  rr: number;
  buyRationale: string[];
  risks: string[];
  aiSuggestedScenario: ScenarioCard;
  currentPrice?: number;
  priceUnit?: string;
}

interface Props {
  values: BuilderValues;
  result: AnalysisResult;
  onConfirm: (scenario: ScenarioCard) => void;
  onEdit: () => void;
  submitting?: boolean;
}

const GRADE_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  'A':  { color: '#22c55e', bg: 'rgba(34,197,94,.15)',   border: 'rgba(34,197,94,.4)'  },
  'B+': { color: '#818cf8', bg: 'rgba(99,102,241,.18)',  border: 'rgba(99,102,241,.4)' },
  'B':  { color: '#f59e0b', bg: 'rgba(245,158,11,.15)',  border: 'rgba(245,158,11,.4)' },
  'C':  { color: '#6b7280', bg: 'var(--bg3)',            border: 'var(--border2)'      },
};

function domesticTick(price: number): number {
  if (price < 2000)   return 1;
  if (price < 5000)   return 5;
  if (price < 20000)  return 10;
  if (price < 50000)  return 50;
  if (price < 200000) return 100;
  if (price < 500000) return 500;
  return 1000;
}

/** 해외주식 price도 KRW 환산값이므로 국내 호가단위 적용 */
function roundToTick(price: number): number {
  const tick = domesticTick(price);
  return Math.round(price / tick) * tick;
}

function fmtPrice(price: number): string {
  return `₩${price.toLocaleString('ko-KR')}`;
}

export function ScenarioAnalysis({ values, result, onConfirm, onEdit, submitting = false }: Props) {
  const gs = GRADE_STYLE[result.grade] ?? GRADE_STYLE['C'];
  const ai = result.aiSuggestedScenario;
  const market = result.market ?? values.market;
  const cp = result.currentPrice ?? values.currentPrice ?? 0;

  const slices = (values.manualSlices ?? []).filter(s => parseInt(s.qty, 10) > 0);
  // price_zone: manualSlices 전체 범위의 최소~최대 (표시용)
  const derivedPriceZone = slices.length > 0
    ? (() => {
        const allLo = slices.map(s => parseFloat(s.zoneLo)).filter(Number.isFinite);
        const allHi = slices.map(s => parseFloat(s.zoneHi)).filter(Number.isFinite);
        if (allLo.length === 0 || allHi.length === 0) return ai.entry?.price_zone ?? '0~0';
        return `${Math.min(...allLo)}~${Math.max(...allHi)}`;
      })()
    : (ai.entry?.price_zone ?? '0~0');

  // 진입 구간 텍스트 (trigger용)
  const entryRangeText = slices.length === 1
    ? `진입 구간: ${fmtPrice(parseFloat(slices[0].zoneLo))} ~ ${fmtPrice(parseFloat(slices[0].zoneHi))}`
    : slices.length > 1
      ? `${slices.length}분할 진입 (${fmtPrice(parseFloat(slices[0].zoneLo))} ~ ${fmtPrice(parseFloat(slices[slices.length-1].zoneHi))})`
      : ai.entry?.trigger ?? '진입 구간 기준 진입';

  const userScenario: ScenarioCard = {
    grade: result.grade,
    entry: {
      trigger: entryRangeText,
      price_zone: derivedPriceZone,
    },
    exit: {
      trailing_activate_pct: 0,
      holding_days: values.holdingDeadline,
      holding_deadline: values.holdingDeadline,
    },
    risk_factors: result.risks,
    why_now: ai.why_now,
    context: ai.context,
    ev: result.ev,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '16px 0' }}>

      {/* 입력 요약 */}
      <div style={sx.section}>
        <div style={sx.sectionLabel}>입력 시나리오 요약</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 13 }}>
          <span style={{
            padding: '3px 10px', borderRadius: 8, fontWeight: 700,
            background: values.direction === 'buy' ? 'rgba(239,68,68,.18)' : 'rgba(59,130,246,.18)',
            color: values.direction === 'buy' ? 'var(--up)' : 'var(--down)',
          }}>
            {values.direction === 'buy' ? '매수' : '매도'}
          </span>
          <span style={{ padding: '3px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: 'var(--bg3)', color: 'var(--muted)', border: '1px solid var(--border2)' }}>
            {market === 'overseas' ? '🌐 해외' : '🇰🇷 국내'}
          </span>
          <span style={{ color: 'var(--text)', fontWeight: 600 }}>{values.symbol}</span>
          {cp > 0 && (
            <span className="num" style={{ color: 'var(--accent)', fontWeight: 700 }}>
              {fmtPrice(cp)}
            </span>
          )}
          {values.splits > 1 && (
            <span style={{ padding: '3px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: 'rgba(99,102,241,.12)', color: '#818cf8', border: '1px solid rgba(99,102,241,.3)' }}>
              {values.splits}분할
            </span>
          )}
          <span style={{ color: 'var(--muted)' }}>{values.holdingDeadline} 까지</span>
        </div>

        {/* 분할 슬라이스 미리보기 */}
        {slices.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 4 }}>
            {slices.map((s, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                <span style={{ color: 'var(--muted)', minWidth: 48 }}>{i + 1}회차</span>
                <span className="num" style={{ color: 'var(--accent)', flex: 1, textAlign: 'center' }}>
                  ₩{Number(s.zoneLo).toLocaleString()} ~ ₩{Number(s.zoneHi).toLocaleString()}
                </span>
                <span className="num" style={{ color: 'var(--text)', fontWeight: 700 }}>
                  {s.qty}주
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI 평가 */}
      <div style={sx.section}>
        <div style={sx.sectionLabel}>AI 평가</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ ...sx.kpi, background: gs.bg, border: `1px solid ${gs.border}` }}>
            <div style={{ fontSize: 11, color: gs.color, fontWeight: 700 }}>등급</div>
            <div className="num" style={{ fontSize: 22, fontWeight: 700, color: gs.color }}>{result.grade}</div>
          </div>
          <div style={sx.kpi}>
            <div style={sx.kpiLabel}>EV</div>
            <div className="num" style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>
              {(result.ev * 100).toFixed(0)}%
            </div>
          </div>
          <div style={sx.kpi}>
            <div style={sx.kpiLabel}>승률 추정</div>
            <div className="num" style={{ fontSize: 18, fontWeight: 700 }}>
              {(result.pWin * 100).toFixed(0)}%
            </div>
          </div>
          <div style={sx.kpi}>
            <div style={sx.kpiLabel}>R/R</div>
            <div className="num" style={{ fontSize: 18, fontWeight: 700, color: result.rr >= 1.5 ? 'var(--up)' : 'var(--muted)' }}>
              {result.rr.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* 매수 근거 */}
      {result.buyRationale.length > 0 && (
        <div style={sx.section}>
          <div style={sx.sectionLabel}>매수 근거</div>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {result.buyRationale.map((r, i) => (
              <li key={i} style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 리스크 요인 */}
      {result.risks.length > 0 && (
        <div style={sx.section}>
          <div style={sx.sectionLabel}>리스크 요인</div>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {result.risks.map((r, i) => (
              <li key={i} style={{ fontSize: 13, color: '#f59e0b', lineHeight: 1.5 }}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {/* AI 권장 수치 비교 */}
      <div style={sx.section}>
        <div style={sx.sectionLabel}>AI 권장 수치 (참고)</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
          <div style={sx.compareRow}>
            <span style={{ color: 'var(--muted)' }}>AI 진입 구간</span>
            <span className="num" style={{ color: 'var(--accent)' }}>
              {ai.entry?.price_zone ?? '—'}
            </span>
          </div>
          <div style={sx.compareRow}>
            <span style={{ color: 'var(--muted)' }}>트레일링 활성화</span>
            <span className="num">+{ai.exit.trailing_activate_pct ?? 0}%</span>
          </div>
        </div>
      </div>

      {/* 버튼 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 4 }}>
        <button
          onClick={() => onConfirm(userScenario)}
          disabled={submitting}
          style={{
            height: 52, borderRadius: 10, fontSize: 15, fontWeight: 700,
            background: submitting ? 'var(--bg3)' : 'var(--up)',
            color: submitting ? 'var(--muted)' : '#fff',
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? '처리 중...' : `✅ ${values.splits > 1 ? `${values.splits}개 시그널` : '시그널'} 등록`}
        </button>
        <button
          onClick={onEdit}
          disabled={submitting}
          style={{
            height: 52, borderRadius: 10, fontSize: 15, fontWeight: 700,
            background: 'var(--bg3)', color: 'var(--muted)',
            border: '1px solid var(--border2)',
          }}
        >
          수정하기
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
  kpi: {
    background: 'var(--bg)', border: '1px solid var(--border2)',
    borderRadius: 10, padding: '10px 14px',
    display: 'flex', flexDirection: 'column', gap: 3, minWidth: 72,
  },
  kpiLabel: { fontSize: 11, color: 'var(--muted)', fontWeight: 600 },
  compareRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
  },
};
