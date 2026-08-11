'use client';

import { useRouter } from 'next/navigation';
import { cardSummary, type StoredScenario } from './scenario-view-model';

export interface SignalWithScenario {
  id: number;
  symbol: string;
  side: 'buy' | 'sell';
  status: string;
  expires_at: string | null;
  created_at: string;
  quantity?: number | null;
  amount_krw?: number | null;
  indicators: {
    ai?: {
      /**
       * DB 에 저장된 시나리오 JSON. **전 필드 옵셔널** — post-market 엔진 경로는
       * grade/entry/exit 만 채우고 나머지를 넣지 않는다(T-021). 타입 정의는
       * `./scenario-view-model` 참고.
       */
      scenario?: StoredScenario;
    };
  } | null;
  reasoning?: string | null;
  market?: 'domestic' | 'overseas';
  /** 사용자 생성 시나리오 여부 */
  scenario_source?: 'ai' | 'user';
  displayName?: string;
  marketFlag?: string;
}

interface Props {
  signal: SignalWithScenario;
}

const GRADE_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  'A':  { color: '#22c55e', bg: 'rgba(34,197,94,.15)',   border: 'rgba(34,197,94,.4)'  },
  'B+': { color: '#818cf8', bg: 'rgba(99,102,241,.18)',  border: 'rgba(99,102,241,.4)' },
  'B':  { color: '#f59e0b', bg: 'rgba(245,158,11,.15)',  border: 'rgba(245,158,11,.4)' },
  'C':  { color: '#6b7280', bg: 'var(--bg3)',            border: 'var(--border2)'      },
};

function minutesUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.max(0, Math.floor((new Date(dateStr).getTime() - Date.now()) / 60000));
}

function fmtQty(qty: number | null | undefined, amountKrw: number | null | undefined): string | null {
  if (qty != null && qty > 0) {
    return qty % 1 === 0 ? `${qty}주` : `${qty.toFixed(2)}주`;
  }
  if (amountKrw != null && amountKrw > 0) {
    return `약 ${amountKrw.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}원`;
  }
  return null;
}

export function ScenarioCard({ signal }: Props) {
  const router = useRouter();
  const scenario = signal.indicators?.ai?.scenario;
  // 결측 필드는 전부 null 로 정규화 — `exit`/`entry` 객체 자체가 없어도 여기서 죽지 않는다.
  const { grade, targetPct, targetPctHi, stopPct, stopPctHi, trigger, holdingDays, riskFactors } =
    cardSummary(scenario);
  const gs = GRADE_STYLE[grade ?? 'C'] ?? GRADE_STYLE['C'];
  const minsLeft = minutesUntil(signal.expires_at);
  const isExpiringSoon = minsLeft !== null && minsLeft <= 60;
  const isUserScenario = signal.scenario_source === 'user';
  const qtyLabel = fmtQty(signal.quantity, signal.amount_krw);

  return (
    <div
      onClick={() => router.push(`/recommend/${signal.id}`)}
      style={{
        background: 'var(--bg2)',
        border: `1px solid ${isExpiringSoon ? 'rgba(245,158,11,.5)' : 'var(--border)'}`,
        borderRadius: 12,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        cursor: 'pointer',
      }}
    >
      {/* 만료 임박 배지 */}
      {isExpiringSoon && minsLeft !== null && (
        <div style={{ fontSize: 12, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
          ⏱ {minsLeft}분 후 만료
        </div>
      )}

      {/* Row 1: 종목 + 등급 + 소스 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, flexShrink: 0,
            background: signal.side === 'buy' ? 'rgba(239,68,68,.18)' : 'rgba(59,130,246,.18)',
            color: signal.side === 'buy' ? 'var(--up)' : 'var(--down)',
          }}>
            {signal.side === 'buy' ? '매수' : '매도'}
            {qtyLabel && <span style={{ marginLeft: 4, fontWeight: 600 }}>· {qtyLabel}</span>}
          </span>
          {signal.marketFlag && <span aria-hidden style={{ flexShrink: 0 }}>{signal.marketFlag}</span>}
          <span style={{ fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {signal.displayName ?? signal.symbol}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
          {isUserScenario && (
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
              background: 'rgba(99,102,241,.18)', color: '#818cf8',
              border: '1px solid rgba(99,102,241,.3)',
            }}>내 시나리오</span>
          )}
          {grade && (
            <span style={{
              fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 10,
              background: gs.bg, color: gs.color, border: `1px solid ${gs.border}`,
            }}>
              {grade}
            </span>
          )}
        </div>
      </div>

      {/* Row 2: 매수 → 목표%, 매도 → 손절% */}
      {signal.side === 'buy' && targetPct != null && (
        <div style={{ fontSize: 13 }}>
          <span className="num" style={{ color: 'var(--up)', fontWeight: 700 }}>
            +{targetPct}{targetPctHi != null && targetPctHi !== targetPct ? `~${targetPctHi}` : ''}% 목표
          </span>
        </div>
      )}
      {signal.side === 'sell' && stopPct != null && (
        <div style={{ fontSize: 13 }}>
          <span className="num" style={{ color: 'var(--down)', fontWeight: 700 }}>
            -{Math.abs(stopPct)}{stopPctHi != null && stopPctHi !== stopPct ? `~${Math.abs(stopPctHi)}` : ''}% 손절
          </span>
        </div>
      )}

      {/* Row 3: 진입 트리거 + 보유기간 */}
      {(trigger || holdingDays) && (
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
          {trigger && (
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>
              {trigger}
            </span>
          )}
          {holdingDays && (
            <span style={{ marginLeft: trigger ? 8 : 0, color: 'var(--muted)', fontWeight: 600 }}>· {holdingDays}</span>
          )}
        </div>
      )}

      {/* Row 4: 리스크 요인 */}
      {riskFactors.length > 0 && (
        <div style={{ fontSize: 12, color: '#f59e0b', background: 'rgba(245,158,11,.08)', padding: '6px 10px', borderRadius: 8 }}>
          ⚠ {riskFactors[0]}
        </div>
      )}

    </div>
  );
}
